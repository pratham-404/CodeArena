const test = require("node:test");
const assert = require("node:assert/strict");
const WebSocket = require("ws");
const { createServer } = require("../src/server");

async function withServer(app, run) {
  const server = app.listen(0);
  await new Promise((resolve) => server.once("listening", resolve));
  try { await run(`http://127.0.0.1:${server.address().port}`); }
  finally { await new Promise((resolve) => server.close(resolve)); }
}

test("execution requests are validated before work starts", async () => {
  let called = false;
  const app = createServer({ execute: async () => { called = true; } });
  await withServer(app, async (baseUrl) => {
    const response = await fetch(`${baseUrl}/api/execute`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ language: "javascript", code: "alert(1)" }),
    });
    assert.equal(response.status, 400);
    assert.equal(called, false);
  });
});

test("execution results retain the API contract", async () => {
  const app = createServer({ execute: async (request) => ({ status: "success", stdout: request.stdin, stderr: "", exitCode: 0, durationMs: 4 }) });
  await withServer(app, async (baseUrl) => {
    const response = await fetch(`${baseUrl}/api/execute`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ language: "python", code: "print(input())", stdin: "hello" }),
    });
    assert.equal(response.status, 200);
    assert.equal((await response.json()).stdout, "hello");
  });
});

test("same-origin WebSocket connections receive an LSP session", async () => {
  let selectedLanguage;
  const app = createServer({
    createLspSession: (socket, language) => ({
      async start() {
        selectedLanguage = language;
        socket.send(JSON.stringify({ type: "ready" }));
      },
      async handle() {},
      async dispose() {},
    }),
  });
  await withServer(app, async (baseUrl) => {
    const socket = new WebSocket(`${baseUrl.replace("http", "ws")}/lsp?language=cpp`, { origin: baseUrl });
    const message = await new Promise((resolve, reject) => {
      socket.once("message", (data) => resolve(JSON.parse(data.toString("utf8"))));
      socket.once("error", reject);
    });
    assert.deepEqual(message, { type: "ready" });
    assert.equal(selectedLanguage, "cpp");
    socket.close();
    await new Promise((resolve) => socket.once("close", resolve));
  });
});
