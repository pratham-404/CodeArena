const test = require("node:test");
const assert = require("node:assert/strict");
const { runProcess } = require("../src/executor");

test("process execution passes stdin and captures stdout", async () => {
  const result = await runProcess(process.execPath, ["-e", "process.stdin.pipe(process.stdout)"], { input: "hello\n", timeoutMs: 1_000 });
  assert.equal(result.exitCode, 0);
  assert.equal(result.stdout, "hello\n");
});

test("process execution terminates an infinite process", async () => {
  const result = await runProcess(process.execPath, ["-e", "setInterval(() => {}, 1000)"], { timeoutMs: 100 });
  assert.equal(result.reason, "timeout");
  assert.ok(result.durationMs < 2_000);
});
