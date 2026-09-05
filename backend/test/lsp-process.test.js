const test = require("node:test");
const assert = require("node:assert/strict");
const { encodeMessage, LspMessageReader } = require("../src/lsp-process");

test("LSP reader handles fragmented and consecutive protocol frames", () => {
  const first = encodeMessage({ jsonrpc: "2.0", id: 1, result: ["if"] });
  const second = encodeMessage({ jsonrpc: "2.0", method: "ready" });
  const reader = new LspMessageReader();
  assert.deepEqual(reader.append(first.subarray(0, 9)), []);
  assert.deepEqual(reader.append(Buffer.concat([first.subarray(9), second])), [
    { jsonrpc: "2.0", id: 1, result: ["if"] },
    { jsonrpc: "2.0", method: "ready" },
  ]);
});
