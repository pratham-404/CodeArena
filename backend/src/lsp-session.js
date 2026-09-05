const { mkdtemp, rm, writeFile } = require("node:fs/promises");
const os = require("node:os");
const path = require("node:path");
const { pathToFileURL } = require("node:url");
const { languageServer, languages } = require("./languages");
const { LspProcess } = require("./lsp-process");

const MAX_CODE_LENGTH = 50_000;
const IDLE_MS = Number(process.env.LSP_IDLE_MS) || 5 * 60_000;

class LspSession {
  constructor(socket, language) {
    this.socket = socket;
    this.language = language;
    this.disposed = false;
  }

  async start() {
    const config = languages[this.language];
    this.workspace = await mkdtemp(path.join(os.tmpdir(), "codearena-lsp-"));
    this.sourcePath = path.join(this.workspace, config.filename);
    this.uri = pathToFileURL(this.sourcePath).href;
    await writeFile(this.sourcePath, "", "utf8");
    if (config.standard) await writeFile(path.join(this.workspace, "compile_flags.txt"), `${config.standard}\n`, "utf8");

    const server = languageServer(this.language, this.workspace);
    this.lsp = new LspProcess(server.command, server.args, { cwd: this.workspace });
    const workspaceUri = pathToFileURL(this.workspace).href;
    this.lsp.workspaceFolders = [{ uri: workspaceUri, name: "CodeArena" }];
    this.lsp.on("notification", (method, params) => {
      if (method === "textDocument/publishDiagnostics" && params?.uri === this.uri) {
        this.send({ type: "diagnostics", diagnostics: params.diagnostics || [] });
      }
    });
    this.lsp.on("failure", (error) => this.send({ type: "error", error: error.message }));

    await this.lsp.request("initialize", {
      processId: null,
      clientInfo: { name: "CodeArena", version: "2.0.0" },
      rootUri: workspaceUri,
      workspaceFolders: this.lsp.workspaceFolders,
      capabilities: {
        workspace: { configuration: true, workspaceFolders: true },
        textDocument: {
          synchronization: { dynamicRegistration: false, didSave: false },
          completion: {
            completionItem: {
              snippetSupport: true,
              documentationFormat: ["markdown", "plaintext"],
              resolveSupport: { properties: ["documentation", "detail", "additionalTextEdits"] },
            },
            contextSupport: true,
          },
          hover: { contentFormat: ["markdown", "plaintext"] },
          signatureHelp: {
            signatureInformation: {
              documentationFormat: ["markdown", "plaintext"],
              parameterInformation: { labelOffsetSupport: true },
              activeParameterSupport: true,
            },
          },
          publishDiagnostics: { relatedInformation: true, tagSupport: { valueSet: [1, 2] } },
        },
      },
    }, 45_000);
    this.lsp.notify("initialized", {});
    this.touch();
    this.send({ type: "ready" });
  }

  send(message) {
    if (this.socket.readyState === 1) this.socket.send(JSON.stringify(message));
  }

  touch() {
    clearTimeout(this.idleTimer);
    this.idleTimer = setTimeout(() => this.socket.close(1000, "Language service idle"), IDLE_MS);
    this.idleTimer.unref();
  }

  async handle(raw) {
    this.touch();
    let message;
    try {
      message = JSON.parse(raw.toString("utf8"));
    } catch {
      return this.send({ type: "error", error: "Invalid language-service message." });
    }

    try {
      if (message.type === "open") {
        if (typeof message.text !== "string" || message.text.length > MAX_CODE_LENGTH) throw new Error("Code must be at most 50000 characters.");
        await writeFile(this.sourcePath, message.text, "utf8");
        this.version = Number(message.version) || 1;
        this.opened = true;
        this.lsp.notify("textDocument/didOpen", {
          textDocument: { uri: this.uri, languageId: languages[this.language].languageId, version: this.version, text: message.text },
        });
        return;
      }
      if (!this.opened) throw new Error("Document is not open yet.");
      if (message.type === "change") {
        if (typeof message.text !== "string" || message.text.length > MAX_CODE_LENGTH) throw new Error("Code must be at most 50000 characters.");
        this.version = Number(message.version) || this.version + 1;
        // ponytail: full-document sync is cheap under the enforced 50 KB file limit.
        this.lsp.notify("textDocument/didChange", {
          textDocument: { uri: this.uri, version: this.version },
          contentChanges: [{ text: message.text }],
        });
        return;
      }

      const methods = {
        completion: "textDocument/completion",
        hover: "textDocument/hover",
        signature: "textDocument/signatureHelp",
      };
      if (!methods[message.type] || !Number.isInteger(message.id)) throw new Error("Unsupported language-service request.");
      const params = { textDocument: { uri: this.uri }, position: message.position };
      if (message.context) params.context = message.context;
      const result = await this.lsp.request(methods[message.type], params, 15_000);
      this.send({ type: "response", id: message.id, result });
    } catch (error) {
      if (Number.isInteger(message?.id)) this.send({ type: "response", id: message.id, error: error.message });
      else this.send({ type: "error", error: error.message });
    }
  }

  async dispose() {
    if (this.disposed) return;
    this.disposed = true;
    clearTimeout(this.idleTimer);
    if (this.opened) this.lsp?.notify("textDocument/didClose", { textDocument: { uri: this.uri } });
    this.lsp?.stop();
    if (this.workspace) await rm(this.workspace, { recursive: true, force: true, maxRetries: 3, retryDelay: 100 });
  }
}

module.exports = { LspSession };
