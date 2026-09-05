export const SNIPPETS = Object.freeze({
  c: [
    ["if", "if (${1:condition}) {\n\t${0}\n}"],
    ["for", "for (${1:int i = 0}; ${2:i < count}; ${3:i++}) {\n\t${0}\n}"],
    ["while", "while (${1:condition}) {\n\t${0}\n}"],
  ],
  cpp: [
    ["if", "if (${1:condition}) {\n\t${0}\n}"],
    ["for", "for (${1:int i = 0}; ${2:i < count}; ${3:i++}) {\n\t${0}\n}"],
    ["while", "while (${1:condition}) {\n\t${0}\n}"],
  ],
  java: [
    ["if", "if (${1:condition}) {\n\t${0}\n}"],
    ["for", "for (${1:int i = 0}; ${2:i < count}; ${3:i++}) {\n\t${0}\n}"],
    ["while", "while (${1:condition}) {\n\t${0}\n}"],
  ],
  python: [
    ["if", "if ${1:condition}:\n\t${0}"],
    ["for", "for ${1:item} in ${2:items}:\n\t${0}"],
    ["while", "while ${1:condition}:\n\t${0}"],
  ],
});

export function registerSnippets(monaco) {
  return Object.entries(SNIPPETS).map(([language, snippets]) => monaco.languages.registerCompletionItemProvider(language, {
    provideCompletionItems(model, position) {
      const word = model.getWordUntilPosition(position);
      const range = new monaco.Range(position.lineNumber, word.startColumn, position.lineNumber, word.endColumn);
      return {
        suggestions: snippets.map(([label, insertText]) => ({
          label,
          detail: "CodeArena snippet",
          kind: monaco.languages.CompletionItemKind.Snippet,
          insertText,
          insertTextRules: monaco.languages.CompletionItemInsertTextRule.InsertAsSnippet,
          range,
          sortText: `0-${label}`,
        })),
      };
    },
  }));
}
