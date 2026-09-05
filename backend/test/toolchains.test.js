const test = require("node:test");
const assert = require("node:assert/strict");
const { executeCode } = require("../src/executor");

for (const sample of [
  ["c", '#include <stdio.h>\nint main(void) { puts("C works"); }', "C works"],
  ["cpp", '#include <iostream>\nint main() { std::cout << "C++ works\\n"; }', "C++ works"],
  ["java", 'public class Main { public static void main(String[] args) { System.out.println("Java works"); } }', "Java works"],
  ["python", 'print("Python works")', "Python works"],
]) {
  test(`${sample[0]} toolchain runs inside the backend image`, async () => {
    const result = await executeCode({ language: sample[0], code: sample[1], stdin: "" });
    assert.equal(result.status, "success", result.error || result.stderr);
    assert.equal(result.stdout.trim(), sample[2]);
  });
}
