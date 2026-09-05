export const LANGUAGES = Object.freeze({
  c: {
    id: "c",
    filename: "main.c",
    code: '#include <stdio.h>\n\nint main(void) {\n    char name[100];\n    fgets(name, sizeof(name), stdin);\n    printf("Hello, %s", name);\n    return 0;\n}\n',
    testCases: [{ input: "World", expected: "Hello, World" }],
  },
  cpp: {
    id: "cpp",
    filename: "main.cpp",
    code: '#include <bits/stdc++.h>\n\nusing namespace std;\n\nint main() {\n    string name;\n\n    cin >> name;\n    cout << "Hello, " << name << endl;\n\n    return 0;\n}\n',
    testCases: [{ input: "World", expected: "Hello, World!" }],
  },
  java: {
    id: "java",
    filename: "Main.java",
    code: 'import java.util.Scanner;\n\npublic class Main {\n    public static void main(String[] args) {\n        Scanner input = new Scanner(System.in);\n        String name = input.nextLine();\n        System.out.println("Hello, " + name + "!");\n    }\n}\n',
    testCases: [{ input: "World", expected: "Hello, World!" }],
  },
  python: {
    id: "python",
    filename: "main.py",
    code: 'name = input()\nprint(f"Hello, {name}!")\n',
    testCases: [{ input: "World", expected: "Hello, World!" }],
  },
});

export function storageKey(language) {
  return `codearena.code.${language}`;
}

export function loadCode(language, storage) {
  try {
    return storage.getItem(storageKey(language)) ?? LANGUAGES[language].code;
  } catch {
    return LANGUAGES[language].code;
  }
}

export function testCaseStorageKey(language) {
  return `codearena.tests.${language}`;
}

export function loadTestCases(language, storage) {
  try {
    const saved = JSON.parse(storage.getItem(testCaseStorageKey(language)) || "null");
    if (Array.isArray(saved) && saved.every((testCase) => typeof testCase?.input === "string" && typeof testCase.expected === "string")) return saved;
  } catch { /* Use the starter test case. */ }
  return LANGUAGES[language].testCases.map((testCase) => ({ ...testCase }));
}

export function outputsMatch(actual, expected) {
  const normalize = (value) => value.replaceAll("\r\n", "\n").trimEnd();
  return normalize(actual) === normalize(expected);
}

export function presentResult(result) {
  const labels = {
    success: "Completed",
    compile_error: "Compilation error",
    runtime_error: "Runtime error",
    timeout: "Timed out",
    validation_error: "Invalid request",
    busy: "Runner busy",
    system_error: "Runner error",
  };
  return {
    label: labels[result.status] || "Error",
    stdout: result.stdout || (result.status === "success" ? "Program completed with no output." : "No output."),
    stderr: result.stderr || result.error || "",
  };
}
