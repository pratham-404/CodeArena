const { spawn } = require("node:child_process");
const { mkdtemp, rm, writeFile } = require("node:fs/promises");
const os = require("node:os");
const path = require("node:path");
const { languages } = require("./languages");

const EXECUTION_TIMEOUT_MS = Number(process.env.EXECUTION_TIMEOUT_MS) || 3_000;
const COMPILATION_TIMEOUT_MS = Number(process.env.COMPILATION_TIMEOUT_MS) || 10_000;
const MAX_OUTPUT_BYTES = 64 * 1024;

function stopProcess(child) {
  if (!child.pid) return;
  if (process.platform === "win32") {
    const killer = spawn("taskkill", ["/pid", String(child.pid), "/T", "/F"], { windowsHide: true, stdio: "ignore" });
    killer.unref();
    killer.on("error", () => child.kill("SIGKILL"));
  } else {
    try { process.kill(-child.pid, "SIGKILL"); } catch { child.kill("SIGKILL"); }
  }
}

function runProcess(command, args, { cwd, input = "", timeoutMs = EXECUTION_TIMEOUT_MS } = {}) {
  return new Promise((resolve) => {
    const startedAt = Date.now();
    let stdout = "";
    let stderr = "";
    let outputBytes = 0;
    let reason = null;
    let settled = false;
    const child = spawn(command, args, {
      cwd,
      detached: process.platform !== "win32",
      shell: false,
      windowsHide: true,
      env: {
        PATH: process.env.PATH,
        SystemRoot: process.env.SystemRoot,
        WINDIR: process.env.WINDIR,
        TEMP: process.env.TEMP,
        TMP: process.env.TMP,
        LANG: "C.UTF-8",
      },
    });

    function collect(target, chunk) {
      const remaining = MAX_OUTPUT_BYTES - outputBytes;
      if (remaining > 0) {
        const text = chunk.subarray(0, remaining).toString("utf8");
        if (target === "stdout") stdout += text;
        else stderr += text;
      }
      outputBytes += chunk.length;
      if (outputBytes > MAX_OUTPUT_BYTES && !reason) {
        reason = "output_limit";
        stopProcess(child);
      }
    }

    child.stdout.on("data", (chunk) => collect("stdout", chunk));
    child.stderr.on("data", (chunk) => collect("stderr", chunk));
    const timer = setTimeout(() => {
      reason = "timeout";
      stopProcess(child);
    }, timeoutMs);

    function finish(result) {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      const redact = (value) => cwd ? value.replaceAll(`${cwd}${path.sep}`, "").replaceAll(cwd, ".") : value;
      resolve({ stdout: redact(stdout), stderr: redact(stderr), durationMs: Date.now() - startedAt, ...result });
    }

    child.on("error", (error) => finish({ error: error.code === "ENOENT" ? `${command} is unavailable in the backend image.` : error.message }));
    child.on("close", (exitCode) => finish({ exitCode, reason }));
    child.stdin.on("error", () => {});
    child.stdin.end(input);
  });
}

function failedResult(status, processResult, fallback, timeoutMs = EXECUTION_TIMEOUT_MS) {
  const messages = {
    timeout: `Execution timed out after ${timeoutMs / 1000} seconds.`,
    output_limit: `Execution stopped after producing ${MAX_OUTPUT_BYTES / 1024} KB of output.`,
  };
  return {
    status,
    stdout: processResult.stdout,
    stderr: processResult.stderr || messages[processResult.reason] || fallback,
    exitCode: processResult.exitCode ?? null,
    durationMs: processResult.durationMs,
  };
}

async function executeCode({ language, code, stdin }) {
  const config = languages[language];
  const directory = await mkdtemp(path.join(os.tmpdir(), "codearena-run-"));
  const sourcePath = path.join(directory, config.filename);

  try {
    await writeFile(sourcePath, code, { encoding: "utf8", flag: "wx" });
    let command;
    let args;

    if (language === "c" || language === "cpp") {
      const executable = path.join(directory, process.platform === "win32" ? "program.exe" : "program");
      const compilation = await runProcess(config.compiler, [config.standard, "-O0", sourcePath, "-o", executable], {
        cwd: directory,
        timeoutMs: COMPILATION_TIMEOUT_MS,
      });
      if (compilation.error) return { status: "system_error", error: compilation.error };
      if (compilation.reason) return failedResult(compilation.reason === "timeout" ? "timeout" : "compile_error", compilation, "Compilation failed.", COMPILATION_TIMEOUT_MS);
      if (compilation.exitCode !== 0) return failedResult("compile_error", compilation, "Compilation failed.");
      command = executable;
      args = [];
    } else if (language === "java") {
      const compilation = await runProcess("javac", [sourcePath], { cwd: directory, timeoutMs: COMPILATION_TIMEOUT_MS });
      if (compilation.error) return { status: "system_error", error: compilation.error };
      if (compilation.reason) return failedResult(compilation.reason === "timeout" ? "timeout" : "compile_error", compilation, "Compilation failed.", COMPILATION_TIMEOUT_MS);
      if (compilation.exitCode !== 0) return failedResult("compile_error", compilation, "Compilation failed.");
      command = "java";
      args = ["-Xms16m", "-Xmx64m", "-cp", directory, "Main"];
    } else {
      command = process.env.PYTHON_BIN || "python3";
      args = [sourcePath];
    }

    const execution = await runProcess(command, args, { cwd: directory, input: stdin });
    if (execution.error) return { status: "system_error", error: execution.error };
    if (execution.reason) return failedResult(execution.reason === "timeout" ? "timeout" : "runtime_error", execution, "Execution failed.");
    if (execution.exitCode !== 0) return failedResult("runtime_error", execution, "Program exited with an error.");
    return { status: "success", ...execution };
  } finally {
    try {
      await rm(directory, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
    } catch (error) {
      // ponytail: cleanup failure must not replace a valid execution result.
      console.warn(`Could not remove run directory: ${error.code || error.message}`);
    }
  }
}

module.exports = { executeCode, runProcess };
