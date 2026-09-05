const test = require("node:test");
const assert = require("node:assert/strict");
const WebSocket = require("ws");

const samples = {
  c: ["#include <stdio.h>\nint main(void) { pri| }", "printf"],
  cpp: ["#include <iostream>\nint main() { std::co| }", "cout"],
  java: ["public class Main { public static void main(String[] args) { System.out.pri| } }", "println"],
  python: ["import os\nos.pa|", "path"],
};

function cursorSample(marked) {
  const offset = marked.indexOf("|");
  const before = marked.slice(0, offset);
  const lines = before.split("\n");
  return { text: marked.slice(0, offset) + marked.slice(offset + 1), position: { line: lines.length - 1, character: lines.at(-1).length } };
}

function completion(language, marked) {
  return new Promise((resolve, reject) => {
    const base = process.env.CODEARENA_URL || "http://localhost:8080";
    const url = new URL(`/lsp?language=${language}`, base);
    url.protocol = url.protocol === "https:" ? "wss:" : "ws:";
    const socket = new WebSocket(url, { headers: { Origin: base } });
    const timer = setTimeout(() => fail(new Error(`${language} completion timed out`)), 90_000);
    const sample = cursorSample(marked);

    function fail(error) {
      clearTimeout(timer);
      socket.close();
      reject(error);
    }

    socket.on("error", fail);
    socket.on("message", (raw) => {
      const message = JSON.parse(raw.toString());
      if (message.type === "error") return fail(new Error(message.error));
      if (message.type === "ready") {
        socket.send(JSON.stringify({ type: "open", text: sample.text, version: 1 }));
        // ponytail: wait for standard-library indexing; upgrade to server progress tracking if this becomes flaky.
        setTimeout(() => socket.send(JSON.stringify({ type: "completion", id: 1, position: sample.position })), 1_500);
      }
      if (message.type === "response" && message.id === 1) {
        clearTimeout(timer);
        socket.close();
        if (message.error) reject(new Error(message.error));
        else resolve((Array.isArray(message.result) ? message.result : message.result?.items || []).map((item) => typeof item.label === "string" ? item.label : item.label?.label));
      }
    });
  });
}

test("the hosted language servers return semantic completions", { timeout: 240_000 }, async () => {
  for (const [language, [code, expected]] of Object.entries(samples)) {
    const labels = await completion(language, code);
    assert.ok(labels.some((label) => label?.includes(expected)), `${language} did not suggest ${expected}: ${labels.slice(0, 10).join(", ")}`);
  }
});
