const test = require("node:test");
const assert = require("node:assert/strict");
const { runProcess, smokeTestToolchains } = require("../src/executor");

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

test("local availability requires every toolchain smoke test to pass", async () => {
  const seen = [];
  const result = await smokeTestToolchains(async ({ language }) => {
    seen.push(language);
    return language === "java" ? { status: "system_error", error: "javac missing" } : { status: "success", stdout: "ready\n" };
  });
  assert.deepEqual(seen.sort(), ["c", "cpp", "java", "python"]);
  assert.equal(result.cpp.available, true);
  assert.deepEqual(result.java, { available: false, error: "javac missing" });
});
