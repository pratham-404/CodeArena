import * as monaco from "monaco-editor/editor/editor.api.js";
import EditorWorker from "monaco-editor/editor/editor.worker.js?worker";
import "monaco-editor/languages/definitions/cpp/register.js";
import "monaco-editor/languages/definitions/java/register.js";
import "monaco-editor/languages/definitions/python/register.js";
import "monaco-editor/editor/contrib/comment/browser/comment.js";
import "monaco-editor/editor/contrib/find/browser/findController.js";
import "monaco-editor/editor/contrib/folding/browser/folding.js";
import "monaco-editor/editor/contrib/hover/browser/hoverContribution.js";
import "monaco-editor/editor/contrib/indentation/browser/indentation.js";
import "monaco-editor/editor/contrib/parameterHints/browser/parameterHints.js";
import "monaco-editor/editor/contrib/snippet/browser/snippetController2.js";
import "monaco-editor/editor/contrib/suggest/browser/suggestController.js";
import { LANGUAGES, loadCode, loadTestCases, outputsMatch, resetTestCases, storageKey, testCaseStorageKey } from "./config.js";
import { LspClient, registerLanguageFeatures, setDiagnostics } from "./lsp-client.js";
import { registerSnippets } from "./snippets.js";
import { isRunShortcut, preferredMode, preferredServiceMode, runnerUrl } from "./runner.js";

self.MonacoEnvironment = { getWorker: () => new EditorWorker() };

const languageSelect = document.querySelector("#language");
const filename = document.querySelector("#filename");
const resetButton = document.querySelector("#reset");
const runnerToggle = document.querySelector("#runner-toggle");
const runnerStatus = document.querySelector("#runner-status");
const testCasesElement = document.querySelector("#test-cases");
const testSummary = document.querySelector("#test-summary");
const addTestButton = document.querySelector("#add-test");
const runButton = document.querySelector("#run-all");

const models = new Map(Object.entries(LANGUAGES).map(([language, config]) => [language,
  monaco.editor.createModel(loadCode(language, localStorage), config.id, monaco.Uri.parse(`file:///workspace/${config.filename}`)),
]));
const testCasesByLanguage = new Map(Object.keys(LANGUAGES).map((modelLanguage) => [modelLanguage,
  loadTestCases(modelLanguage, localStorage).map((testCase) => ({ ...testCase, status: "idle", actual: "", error: "", resultStatus: null, durationMs: null, open: true })),
]));
let language = languageSelect.value;
let activeClient;
let changeSubscription;
let running = false;
let executionMode = "sandbox";
const runnerAvailability = {
  local: { available: false, error: "Local runner is not running." },
  sandbox: { available: false, error: "Sandbox is not available." },
};

const editor = monaco.editor.create(document.querySelector("#editor"), {
  model: models.get(language),
  theme: "vs-dark",
  automaticLayout: true,
  fontFamily: '"Cascadia Code", Consolas, monospace',
  fontSize: 14,
  lineHeight: 23,
  mouseWheelZoom: true,
  minimap: { enabled: false },
  padding: { top: 12 },
  quickSuggestions: { other: true, comments: false, strings: false },
  suggestOnTriggerCharacters: true,
  snippetSuggestions: "top",
  tabCompletion: "on",
  parameterHints: { enabled: true },
  scrollBeyondLastLine: false,
});

registerSnippets(monaco);
registerLanguageFeatures(monaco, Object.keys(LANGUAGES), (model) => activeClient?.model === model ? activeClient : null);

for (const [modelLanguage, model] of models) {
  let saveTimer;
  model.onDidChangeContent(() => {
    clearTimeout(saveTimer);
    saveTimer = setTimeout(() => {
      try { localStorage.setItem(storageKey(modelLanguage), model.getValue()); } catch { /* Storage can be disabled. */ }
    }, 200);
  });
}

async function connectLanguageService() {
  changeSubscription?.dispose();
  activeClient?.dispose();
  const model = editor.getModel();
  const serviceMode = preferredServiceMode(runnerAvailability);
  if (!serviceMode) {
    setDiagnostics(monaco, model, []);
    return;
  }
  const client = activeClient = new LspClient(language, model, {
    diagnostics: (diagnostics) => setDiagnostics(monaco, model, diagnostics),
  }, runnerUrl(serviceMode, "/"));
  try {
    await client.connect();
    if (client !== activeClient) return client.dispose();
    changeSubscription = model.onDidChangeContent((event) => client.change(event));
  } catch (error) {
    setLanguageServiceStatus("error", error.message);
  }
}

function currentTestCases() {
  return testCasesByLanguage.get(language);
}

function saveTestCases() {
  const saved = currentTestCases().map(({ input, expected }) => ({ input, expected }));
  try { localStorage.setItem(testCaseStorageKey(language), JSON.stringify(saved)); } catch { /* Storage can be disabled. */ }
}

function updateTestSummary() {
  const testCases = currentTestCases();
  const passed = testCases.filter((testCase) => testCase.status === "passed").length;
  testSummary.textContent = `${passed} / ${testCases.length} passed`;
  languageSelect.disabled = running;
  resetButton.disabled = running;
  runnerToggle.disabled = running || !runnerAvailability[executionMode === "local" ? "sandbox" : "local"].available;
  addTestButton.disabled = running;
  runButton.disabled = running || testCases.length === 0 || !runnerAvailability[executionMode].available;
  runButton.textContent = running ? "Running…" : "Run all";
}

function resizeTextarea(textarea) {
  textarea.style.height = "0";
  textarea.style.height = `${textarea.scrollHeight}px`;
}

async function reindentCode() {
  await editor.getAction("editor.action.reindentlines")?.run();
}

function renderTestCases() {
  const labels = { idle: "", waiting: "Waiting", running: "Running…", passed: "Passed", failed: "Failed" };
  const failureLabels = { timeout: "Timed out", compile_error: "Compile error", runtime_error: "Runtime error", system_error: "Runner error" };
  testCasesElement.replaceChildren();

  currentTestCases().forEach((testCase, index) => {
    const item = document.createElement("details");
    item.className = "test-case";
    item.dataset.index = index;
    item.dataset.status = testCase.status;
    item.open = testCase.status === "failed" || testCase.open;
    const stateLabel = testCase.status === "failed" ? failureLabels[testCase.resultStatus] || labels.failed : labels[testCase.status];
    const duration = Number.isFinite(testCase.durationMs) ? `${Math.round(testCase.durationMs)} ms` : "";
    item.innerHTML = `
      <summary>
        <span class="test-name">Test ${index + 1}</span>
        <span class="test-state">${stateLabel}</span>
        <span class="test-duration">${duration}</span>
        <button class="run-test" type="button" data-run aria-label="Run test ${index + 1}" title="Run test">▶</button>
        <button class="delete-test" type="button" data-delete aria-label="Delete test ${index + 1}">×</button>
      </summary>
      <div class="test-body">
        <label>Input<textarea data-field="input" rows="1" spellcheck="false"></textarea></label>
        <label>Expected output<textarea data-field="expected" rows="1" spellcheck="false"></textarea></label>
        <div class="test-result">
          <span>Received output</span>
          <pre data-output></pre>
          <pre class="test-error" data-error></pre>
        </div>
      </div>`;
    item.querySelector('[data-field="input"]').value = testCase.input;
    item.querySelector('[data-field="expected"]').value = testCase.expected;
    const result = item.querySelector(".test-result");
    result.hidden = !["passed", "failed"].includes(testCase.status);
    item.querySelector("[data-output]").textContent = testCase.actual || "(no output)";
    const error = item.querySelector("[data-error]");
    error.hidden = !testCase.error;
    error.textContent = testCase.error;
    for (const control of item.querySelectorAll("textarea, button")) control.disabled = running;
    testCasesElement.append(item);
    for (const textarea of item.querySelectorAll("textarea")) resizeTextarea(textarea);
  });

  updateTestSummary();
}

languageSelect.addEventListener("change", () => {
  language = languageSelect.value;
  const config = LANGUAGES[language];
  editor.setModel(models.get(language));
  filename.textContent = config.filename;
  renderTestCases();
  editor.focus();
  connectLanguageService();
});

resetButton.addEventListener("click", () => {
  const model = editor.getModel();
  if (model.getValue() !== LANGUAGES[language].code && !window.confirm("Reset this language to its starter code?")) return;
  model.setValue(LANGUAGES[language].code);
  testCasesByLanguage.set(language, resetTestCases(language, localStorage).map((testCase) => ({
    ...testCase, status: "idle", actual: "", error: "", resultStatus: null, durationMs: null, open: true,
  })));
  renderTestCases();
  editor.focus();
});

function renderRunner() {
  const selected = runnerAvailability[executionMode];
  const otherMode = executionMode === "local" ? "sandbox" : "local";
  const other = runnerAvailability[otherMode];
  const selectedName = executionMode === "local" ? "Local" : "Sandbox";
  const otherName = otherMode === "local" ? "Local" : "Sandbox";
  runnerToggle.dataset.mode = executionMode;
  runnerToggle.setAttribute("aria-label", `Switch from ${selectedName} to ${otherName}`);
  runnerToggle.title = other.available ? `Switch to ${otherName}` : other.error;
  runnerStatus.dataset.status = selected.available ? "ready" : "error";
  runnerStatus.textContent = selected.available
    ? `${selectedName} ready · ${other.available ? `${otherName} ready` : `${otherName} unavailable`}`
    : selected.error;
  runnerStatus.title = runnerStatus.textContent;
  updateTestSummary();
}

async function checkRunner(mode) {
  try {
    const response = await fetch(runnerUrl(mode, "/api/health"), {
      cache: "no-store",
      signal: AbortSignal.timeout(3_000),
      ...(mode === "local" ? { targetAddressSpace: "loopback" } : {}),
    });
    const result = await response.json().catch(() => { throw new Error("No runner answered at this address."); });
    if (!response.ok || !["ok", "available"].includes(result.status)) throw new Error(result.error || `${mode} runner is unavailable.`);
    runnerAvailability[mode] = { available: true, error: "" };
  } catch (error) {
    runnerAvailability[mode] = {
      available: false,
      error: mode === "local"
        ? `Local unavailable — ${error.message || "start it with npm run local"}`
        : `Sandbox unavailable — ${error.message || "start Docker"}`,
    };
  }
}

async function initializeRunners() {
  await Promise.all([checkRunner("local"), checkRunner("sandbox")]);
  executionMode = preferredMode(runnerAvailability);
  renderRunner();
  connectLanguageService();
}

runnerToggle.addEventListener("click", () => {
  const nextMode = executionMode === "local" ? "sandbox" : "local";
  if (running || !runnerAvailability[nextMode].available) return;
  executionMode = nextMode;
  renderRunner();
  connectLanguageService();
});

async function executeTest(testCase, runLanguage, code) {
  let result;
  try {
    const response = await fetch(runnerUrl(executionMode, "/api/execute"), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ language: runLanguage, code, stdin: testCase.input }),
      ...(executionMode === "local" ? { targetAddressSpace: "loopback" } : {}),
    });
    result = await response.json();
  } catch {
    result = { status: "system_error", error: "Could not reach the CodeArena server." };
  }
  testCase.actual = result.stdout || "";
  testCase.error = result.stderr || result.error || "";
  testCase.resultStatus = result.status;
  testCase.durationMs = Number.isFinite(result.durationMs) ? result.durationMs : null;
  testCase.status = result.status === "success" && outputsMatch(testCase.actual, testCase.expected) ? "passed" : "failed";
}

async function runOne(index) {
  if (running) return;
  running = true;
  const testCase = currentTestCases()[index];
  Object.assign(testCase, { status: "running", actual: "", error: "", resultStatus: null, durationMs: null });
  renderTestCases();
  try {
    await reindentCode();
    await executeTest(testCase, language, editor.getValue());
    testCase.open = testCase.status === "failed";
  } finally {
    running = false;
    renderTestCases();
  }
}

async function runAll() {
  if (running) return;
  running = true;
  const testCases = currentTestCases();
  const runLanguage = language;
  const previousStates = testCases.map(({ status, open }) => ({ status, open }));
  for (const testCase of testCases) Object.assign(testCase, { status: "waiting", actual: "", error: "", resultStatus: null, durationMs: null });
  renderTestCases();

  try {
    await reindentCode();
    const code = editor.getValue();
    for (const [index, testCase] of testCases.entries()) {
      testCase.status = "running";
      renderTestCases();
      await executeTest(testCase, runLanguage, code);
      testCase.open = testCase.status === "failed" ? true : previousStates[index].status === "passed" ? previousStates[index].open : false;
      renderTestCases();
    }
  } finally {
    running = false;
    renderTestCases();
  }
}

testCasesElement.addEventListener("input", (event) => {
  const field = event.target.dataset.field;
  if (!field) return;
  const item = event.target.closest(".test-case");
  const testCase = currentTestCases()[Number(item.dataset.index)];
  testCase[field] = event.target.value;
  Object.assign(testCase, { status: "idle", actual: "", error: "", resultStatus: null, durationMs: null });
  resizeTextarea(event.target);
  item.dataset.status = "idle";
  item.open = true;
  item.querySelector(".test-state").textContent = "";
  item.querySelector(".test-duration").textContent = "";
  item.querySelector(".test-result").hidden = true;
  saveTestCases();
  updateTestSummary();
});

testCasesElement.addEventListener("toggle", (event) => {
  const item = event.target.closest?.(".test-case");
  if (item) currentTestCases()[Number(item.dataset.index)].open = item.open;
}, true);

testCasesElement.addEventListener("click", (event) => {
  const item = event.target.closest(".test-case");
  const runCaseButton = event.target.closest("[data-run]");
  if (runCaseButton) {
    event.preventDefault();
    runOne(Number(item.dataset.index));
    return;
  }
  if (!event.target.closest("[data-delete]")) return;
  event.preventDefault();
  currentTestCases().splice(Number(item.dataset.index), 1);
  saveTestCases();
  renderTestCases();
});

addTestButton.addEventListener("click", () => {
  currentTestCases().push({ input: "", expected: "", status: "idle", actual: "", error: "", resultStatus: null, durationMs: null, open: true });
  saveTestCases();
  renderTestCases();
  testCasesElement.lastElementChild.querySelector("textarea").focus();
});

runButton.addEventListener("click", runAll);
window.addEventListener("keydown", (event) => {
  if (!isRunShortcut(event)) return;
  event.preventDefault();
  runAll();
}, { capture: true });
window.addEventListener("beforeunload", () => activeClient?.dispose());
renderTestCases();
initializeRunners();
