const path = require("node:path");

const languages = Object.freeze({
  c: { filename: "main.c", languageId: "c", compiler: "gcc", standard: "-std=c11", server: "clangd" },
  cpp: { filename: "main.cpp", languageId: "cpp", compiler: "g++", standard: "-std=c++17", server: "clangd" },
  java: { filename: "Main.java", languageId: "java", compiler: "javac", server: "jdtls" },
  python: { filename: "main.py", languageId: "python", server: "pyright" },
});

function languageServer(language, workspace) {
  const config = languages[language];
  if (config.server === "clangd") {
    return { command: process.env.CLANGD_BIN || "clangd", args: ["--background-index=false", "--clang-tidy=false"] };
  }
  if (config.server === "jdtls") {
    return {
      command: process.env.JDTLS_BIN || "/opt/jdtls/bin/jdtls",
      args: [`--jvm-arg=-Duser.home=${path.join(workspace, ".jdtls-home")}`, "-data", path.join(workspace, ".jdtls-data")],
    };
  }
  return {
    command: process.execPath,
    args: [require.resolve("pyright/langserver.index.js"), "--stdio"],
  };
}

module.exports = { languageServer, languages };
