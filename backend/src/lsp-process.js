const { spawn } = require("node:child_process");
const { EventEmitter } = require("node:events");

function encodeMessage(message) {
  const body = Buffer.from(JSON.stringify(message), "utf8");
  return Buffer.concat([Buffer.from(`Content-Length: ${body.length}\r\n\r\n`, "ascii"), body]);
}

class LspMessageReader {
  constructor() {
    this.buffer = Buffer.alloc(0);
  }

  append(chunk) {
    this.buffer = Buffer.concat([this.buffer, chunk]);
    const messages = [];
    while (true) {
      const headerEnd = this.buffer.indexOf("\r\n\r\n");
      if (headerEnd < 0) break;
      const header = this.buffer.subarray(0, headerEnd).toString("ascii");
      const length = Number(/(?:^|\r\n)Content-Length:\s*(\d+)/i.exec(header)?.[1]);
      if (!Number.isInteger(length)) throw new Error("Language server sent an invalid Content-Length header.");
      const bodyStart = headerEnd + 4;
      if (this.buffer.length < bodyStart + length) break;
      messages.push(JSON.parse(this.buffer.subarray(bodyStart, bodyStart + length).toString("utf8")));
      this.buffer = this.buffer.subarray(bodyStart + length);
    }
    return messages;
  }
}

class LspProcess extends EventEmitter {
  constructor(command, args, options = {}) {
    super();
    this.pending = new Map();
    this.nextId = 1;
    this.reader = new LspMessageReader();
    this.child = spawn(command, args, {
      cwd: options.cwd,
      env: options.env || process.env,
      stdio: ["pipe", "pipe", "pipe"],
      shell: false,
      windowsHide: true,
    });
    this.child.stdout.on("data", (chunk) => {
      try {
        for (const message of this.reader.append(chunk)) this.receive(message);
      } catch (error) {
        this.fail(error);
      }
    });
    this.child.stderr.on("data", (chunk) => console.warn(`[lsp] ${chunk.toString("utf8").trimEnd()}`));
    this.child.on("error", (error) => this.fail(error));
    this.child.on("close", (code) => this.fail(new Error(`Language server exited with code ${code}.`)));
  }

  send(message) {
    if (!this.child.stdin.destroyed) this.child.stdin.write(encodeMessage(message));
  }

  notify(method, params) {
    this.send({ jsonrpc: "2.0", method, params });
  }

  request(method, params, timeoutMs = 30_000) {
    const id = this.nextId++;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error(`${method} timed out.`));
      }, timeoutMs);
      this.pending.set(id, {
        resolve: (value) => { clearTimeout(timer); resolve(value); },
        reject: (error) => { clearTimeout(timer); reject(error); },
      });
      this.send({ jsonrpc: "2.0", id, method, params });
    });
  }

  receive(message) {
    if (message.method && message.id != null) return this.handleServerRequest(message);
    if (message.method) return this.emit("notification", message.method, message.params);
    const pending = this.pending.get(message.id);
    if (!pending) return;
    this.pending.delete(message.id);
    if (message.error) pending.reject(new Error(message.error.message || "Language server request failed."));
    else pending.resolve(message.result);
  }

  handleServerRequest(message) {
    let result = null;
    if (message.method === "workspace/configuration") result = (message.params?.items || []).map(() => null);
    else if (message.method === "workspace/workspaceFolders") result = this.workspaceFolders || [];
    else if (message.method === "workspace/applyEdit") result = { applied: false, failureReason: "Client-side edits are not supported." };
    this.send({ jsonrpc: "2.0", id: message.id, result });
  }

  fail(error) {
    if (this.failed) return;
    this.failed = true;
    for (const pending of this.pending.values()) pending.reject(error);
    this.pending.clear();
    this.emit("failure", error);
  }

  stop() {
    if (!this.child.killed) this.child.kill("SIGKILL");
  }
}

module.exports = { encodeMessage, LspMessageReader, LspProcess };
