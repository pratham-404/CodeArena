import test from "node:test";
import assert from "node:assert/strict";
import { LANGUAGES, loadCode, loadTestCases, outputsMatch, presentResult, storageKey, testCaseStorageKey } from "../src/config.js";
import { SNIPPETS } from "../src/snippets.js";

test("editor drafts are stored separately for each language", () => {
  const storage = { getItem: (key) => key === storageKey("python") ? "print(42)" : null };
  assert.equal(loadCode("python", storage), "print(42)");
  assert.equal(loadCode("java", storage), LANGUAGES.java.code);
  assert.notEqual(storageKey("python"), storageKey("java"));
});

test("every language has an if-block snippet with a final cursor stop", () => {
  for (const language of Object.keys(LANGUAGES)) {
    const snippet = SNIPPETS[language].find(([label]) => label === "if")?.[1];
    assert.ok(snippet?.includes("${0}"), `${language} is missing an if snippet`);
  }
});

test("compiler errors retain partial stdout", () => {
  assert.deepEqual(presentResult({ status: "compile_error", stdout: "note\n", stderr: "expected ';'" }), {
    label: "Compilation error",
    stdout: "note\n",
    stderr: "expected ';'",
  });
});

test("test cases load safely and compare output without newline noise", () => {
  const storage = { getItem: (key) => key === testCaseStorageKey("cpp") ? JSON.stringify([{ input: "1 2", expected: "3" }]) : null };
  assert.deepEqual(loadTestCases("cpp", storage), [{ input: "1 2", expected: "3" }]);
  assert.equal(outputsMatch("3\r\n", "3"), true);
  assert.equal(outputsMatch("4\n", "3"), false);
});
