const configured = import.meta.env || {};

export const RUNNER_BASES = Object.freeze({
  local: configured.VITE_LOCAL_RUNNER_URL || "http://127.0.0.1:8787",
  sandbox: configured.VITE_SANDBOX_RUNNER_URL || "",
});

export function runnerUrl(mode, path, pageUrl = window.location.href) {
  return new URL(path, RUNNER_BASES[mode] || pageUrl).href;
}

export function preferredMode(availability) {
  return availability.local?.available ? "local" : "sandbox";
}

export function preferredServiceMode(availability) {
  return availability.sandbox?.available ? "sandbox" : availability.local?.available ? "local" : null;
}

export function isRunShortcut(event) {
  return (event.ctrlKey || event.metaKey) && event.key === "Enter";
}
