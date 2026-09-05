const http = require("node:http");
const { WebSocketServer } = require("ws");
const { executeCode } = require("./executor");
const { languages } = require("./languages");
const { LspSession } = require("./lsp-session");

const MAX_CODE_LENGTH = 50_000;
const MAX_INPUT_LENGTH = 10_000;
const MAX_BODY_BYTES = 64 * 1024;
const MAX_LSP_SESSIONS = Number(process.env.MAX_LSP_SESSIONS) || 20;

function validateExecutionRequest(body) {
  if (!body || typeof body !== "object" || Array.isArray(body)) return "Request body must be a JSON object.";
  if (!Object.hasOwn(languages, body.language)) return "Unsupported language.";
  if (typeof body.code !== "string" || !body.code.trim()) return "Code is required.";
  if (body.code.length > MAX_CODE_LENGTH) return `Code must be at most ${MAX_CODE_LENGTH} characters.`;
  if (body.stdin !== undefined && typeof body.stdin !== "string") return "stdin must be a string.";
  if ((body.stdin || "").length > MAX_INPUT_LENGTH) return `stdin must be at most ${MAX_INPUT_LENGTH} characters.`;
  return null;
}

function sendJson(response, statusCode, value) {
  const body = JSON.stringify(value);
  response.writeHead(statusCode, {
    "Content-Type": "application/json; charset=utf-8",
    "Content-Length": Buffer.byteLength(body),
    "X-Content-Type-Options": "nosniff",
    "Cache-Control": "no-store",
  });
  response.end(body);
}

async function readJson(request) {
  if (!request.headers["content-type"]?.toLowerCase().startsWith("application/json")) throw Object.assign(new Error("Content-Type must be application/json."), { statusCode: 415 });
  const chunks = [];
  let size = 0;
  for await (const chunk of request) {
    size += chunk.length;
    if (size > MAX_BODY_BYTES) throw Object.assign(new Error("Request body is too large."), { statusCode: 413 });
    chunks.push(chunk);
  }
  try {
    return JSON.parse(Buffer.concat(chunks).toString("utf8"));
  } catch {
    throw Object.assign(new Error("Request body contains invalid JSON."), { statusCode: 400 });
  }
}

function originAllowed(request) {
  const origin = request.headers.origin;
  if (!origin) return false;
  const allowed = (process.env.ALLOWED_ORIGINS || "").split(",").map((value) => value.trim()).filter(Boolean);
  if (allowed.includes(origin)) return true;
  try { return new URL(origin).host === request.headers.host; } catch { return false; }
}

function createServer({ execute = executeCode, maxConcurrentExecutions = 2, createLspSession = (socket, language) => new LspSession(socket, language) } = {}) {
  let activeExecutions = 0;
  let activeLspSessions = 0;
  const server = http.createServer(async (request, response) => {
    let pathname;
    try { pathname = decodeURIComponent(new URL(request.url, "http://localhost").pathname); }
    catch { return sendJson(response, 400, { status: "validation_error", error: "Invalid URL." }); }

    if (request.method === "GET" && pathname === "/api/health") {
      return sendJson(response, 200, { status: "ok", languages: Object.keys(languages) });
    }
    if (request.method !== "POST" || pathname !== "/api/execute") {
      return sendJson(response, 404, { status: "not_found", error: "Not found." });
    }

    let body;
    try { body = await readJson(request); }
    catch (error) { return sendJson(response, error.statusCode || 400, { status: "validation_error", error: error.message }); }
    const validationError = validateExecutionRequest(body);
    if (validationError) return sendJson(response, 400, { status: "validation_error", error: validationError });
    if (activeExecutions >= maxConcurrentExecutions) return sendJson(response, 429, { status: "busy", error: "The runner is busy. Try again shortly." });

    activeExecutions += 1;
    try {
      const result = await execute({ language: body.language, code: body.code, stdin: body.stdin || "" });
      sendJson(response, result.status === "system_error" ? 503 : 200, result);
    } catch (error) {
      console.error("Execution failed:", error);
      sendJson(response, 500, { status: "system_error", error: "The runner failed unexpectedly." });
    } finally {
      activeExecutions -= 1;
    }
  });

  const sockets = new WebSocketServer({ noServer: true, maxPayload: MAX_BODY_BYTES });
  server.on("upgrade", (request, socket, head) => {
    let url;
    try { url = new URL(request.url, "http://localhost"); } catch { return socket.destroy(); }
    const language = url.searchParams.get("language");
    if (url.pathname !== "/lsp" || !Object.hasOwn(languages, language) || !originAllowed(request) || activeLspSessions >= MAX_LSP_SESSIONS) {
      socket.write("HTTP/1.1 403 Forbidden\r\nConnection: close\r\n\r\n");
      return socket.destroy();
    }
    sockets.handleUpgrade(request, socket, head, (webSocket) => sockets.emit("connection", webSocket, language));
  });

  sockets.on("connection", async (socket, language) => {
    activeLspSessions += 1;
    const session = createLspSession(socket, language);
    socket.on("message", (message) => session.handle(message));
    socket.on("close", async () => {
      activeLspSessions -= 1;
      try { await session.dispose(); } catch (error) { console.warn(`LSP cleanup failed: ${error.message}`); }
    });
    try { await session.start(); }
    catch (error) {
      if (socket.readyState === 1) socket.send(JSON.stringify({ type: "error", error: error.message }));
      socket.close(1011, "Language server failed");
    }
  });

  return server;
}

if (require.main === module) {
  const port = Number(process.env.PORT) || 8000;
  const host = process.env.HOST || "0.0.0.0";
  createServer().listen(port, host, () => console.log(`CodeArena backend listening on http://${host}:${port}`));
}

module.exports = { createServer, originAllowed, validateExecutionRequest };
