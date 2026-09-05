function webSocketUrl(language) {
  const url = new URL("/lsp", window.location.href);
  url.protocol = url.protocol === "https:" ? "wss:" : "ws:";
  url.searchParams.set("language", language);
  return url;
}

export class LspClient {
  constructor(language, model, handlers = {}) {
    this.language = language;
    this.model = model;
    this.handlers = handlers;
    this.pending = new Map();
    this.nextId = 1;
    this.ready = false;
  }

  connect() {
    return new Promise((resolve, reject) => {
      const socket = this.socket = new WebSocket(webSocketUrl(this.language));
      const fail = (message) => {
        if (!this.ready) reject(new Error(message));
        this.handlers.status?.("error", message);
      };

      socket.addEventListener("open", () => this.handlers.status?.("starting", "IntelliSense starting…"));
      socket.addEventListener("error", () => fail("IntelliSense connection failed"));
      socket.addEventListener("close", () => {
        this.ready = false;
        for (const { reject: rejectRequest } of this.pending.values()) rejectRequest(new Error("Language service disconnected"));
        this.pending.clear();
        this.handlers.status?.("error", "IntelliSense disconnected");
      });
      socket.addEventListener("message", ({ data }) => {
        let message;
        try { message = JSON.parse(data); }
        catch { return fail("Language service sent an invalid response"); }
        if (message.type === "ready") {
          this.ready = true;
          this.notify("open", { text: this.model.getValue(), version: this.model.getVersionId() });
          this.handlers.status?.("ready", "IntelliSense ready");
          resolve(this);
        } else if (message.type === "response") {
          const pending = this.pending.get(message.id);
          if (!pending) return;
          this.pending.delete(message.id);
          if (message.error) pending.reject(new Error(message.error));
          else pending.resolve(message.result);
        } else if (message.type === "diagnostics") {
          this.handlers.diagnostics?.(message.diagnostics || []);
        } else if (message.type === "error") {
          fail(message.error || "Language service failed");
        }
      });
    });
  }

  notify(type, payload = {}) {
    if (this.socket?.readyState === WebSocket.OPEN) this.socket.send(JSON.stringify({ type, ...payload }));
  }

  request(type, payload = {}) {
    if (!this.ready) return Promise.resolve(null);
    const id = this.nextId++;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error(`${type} timed out`));
      }, 15_000);
      this.pending.set(id, {
        resolve: (value) => { clearTimeout(timer); resolve(value); },
        reject: (error) => { clearTimeout(timer); reject(error); },
      });
      this.socket.send(JSON.stringify({ type, id, ...payload }));
    });
  }

  change() {
    this.notify("change", {
      version: this.model.getVersionId(),
      // ponytail: full-document sync is fine under CodeArena's 50 KB file limit.
      text: this.model.getValue(),
    });
  }

  dispose() {
    this.handlers.diagnostics?.([]);
    if (this.socket?.readyState === WebSocket.OPEN) this.socket.close(1000, "Language changed");
    else if (this.socket?.readyState === WebSocket.CONNECTING) this.socket.addEventListener("open", () => this.socket.close(1000, "Language changed"), { once: true });
  }
}

function toRange(monaco, range) {
  return range && new monaco.Range(range.start.line + 1, range.start.character + 1, range.end.line + 1, range.end.character + 1);
}

function documentation(value) {
  if (!value) return undefined;
  if (typeof value === "string") return { value };
  if (value.language) return { value: `\`\`\`${value.language}\n${value.value}\n\`\`\`` };
  return { value: value.value || "" };
}

function completionKind(monaco, kind) {
  const kinds = [null, "Text", "Method", "Function", "Constructor", "Field", "Variable", "Class", "Interface", "Module", "Property", "Unit", "Value", "Enum", "Keyword", "Snippet", "Color", "File", "Reference", "Folder", "EnumMember", "Constant", "Struct", "Event", "Operator", "TypeParameter"];
  return monaco.languages.CompletionItemKind[kinds[kind]] ?? monaco.languages.CompletionItemKind.Text;
}

function completionItem(monaco, model, position, item) {
  const word = model.getWordUntilPosition(position);
  const fallbackRange = new monaco.Range(position.lineNumber, word.startColumn, position.lineNumber, word.endColumn);
  const edit = item.textEdit;
  const editRange = edit?.range || edit?.replace;
  return {
    label: typeof item.label === "string" ? item.label : item.label.label,
    kind: completionKind(monaco, item.kind),
    detail: item.detail,
    documentation: documentation(item.documentation),
    insertText: edit?.newText || item.insertText || (typeof item.label === "string" ? item.label : item.label.label),
    insertTextRules: item.insertTextFormat === 2 ? monaco.languages.CompletionItemInsertTextRule.InsertAsSnippet : undefined,
    filterText: item.filterText,
    sortText: item.sortText,
    commitCharacters: item.commitCharacters,
    range: toRange(monaco, editRange) || fallbackRange,
    additionalTextEdits: item.additionalTextEdits?.map((additionalEdit) => ({ range: toRange(monaco, additionalEdit.range), text: additionalEdit.newText })),
  };
}

function markerSeverity(monaco, severity) {
  return [null, monaco.MarkerSeverity.Error, monaco.MarkerSeverity.Warning, monaco.MarkerSeverity.Info, monaco.MarkerSeverity.Hint][severity] || monaco.MarkerSeverity.Info;
}

export function registerLanguageFeatures(monaco, languages, getClient) {
  return languages.flatMap((language) => [
    monaco.languages.registerCompletionItemProvider(language, {
      triggerCharacters: [".", ":", ">", "#", "\"", "'"],
      async provideCompletionItems(model, position, context) {
        const client = getClient(model);
        if (!client?.ready) return { suggestions: [] };
        try {
          const result = await client.request("completion", {
            position: { line: position.lineNumber - 1, character: position.column - 1 },
            context: { triggerKind: context.triggerKind + 1, triggerCharacter: context.triggerCharacter },
          });
          const items = Array.isArray(result) ? result : result?.items || [];
          return { suggestions: items.map((item) => completionItem(monaco, model, position, item)), incomplete: result?.isIncomplete };
        } catch {
          return { suggestions: [] };
        }
      },
    }),
    monaco.languages.registerHoverProvider(language, {
      async provideHover(model, position) {
        const result = await getClient(model)?.request("hover", { position: { line: position.lineNumber - 1, character: position.column - 1 } });
        if (!result) return null;
        const values = Array.isArray(result.contents) ? result.contents : [result.contents];
        return { range: toRange(monaco, result.range), contents: values.map((value) => documentation(value)).filter(Boolean) };
      },
    }),
    monaco.languages.registerSignatureHelpProvider(language, {
      signatureHelpTriggerCharacters: ["(", ","],
      async provideSignatureHelp(model, position) {
        const result = await getClient(model)?.request("signature", { position: { line: position.lineNumber - 1, character: position.column - 1 } });
        if (!result) return null;
        return {
          value: {
            activeSignature: result.activeSignature || 0,
            activeParameter: result.activeParameter || 0,
            signatures: result.signatures.map((signature) => ({
              label: signature.label,
              documentation: documentation(signature.documentation),
              parameters: signature.parameters?.map((parameter) => ({ label: parameter.label, documentation: documentation(parameter.documentation) })),
              activeParameter: signature.activeParameter,
            })),
          },
          dispose() {},
        };
      },
    }),
  ]);
}

export function setDiagnostics(monaco, model, diagnostics) {
  monaco.editor.setModelMarkers(model, "language-server", diagnostics.map((diagnostic) => ({
    ...toRange(monaco, diagnostic.range),
    severity: markerSeverity(monaco, diagnostic.severity),
    message: diagnostic.message,
    source: diagnostic.source || "language server",
    code: diagnostic.code == null ? undefined : String(diagnostic.code),
  })));
}
