/**
 * client/src/lib/error-buffer.js
 * Global error capture buffer for feedback widget.
 * Import at top of App.jsx — patches console/window handlers once.
 */

const MAX = 25;
const buffer = [];

function push(entry) {
  if (buffer.length >= MAX) buffer.shift();
  buffer.push({ ...entry, timestamp: new Date().toISOString() });
}

// HMR guard — only install once
if (!window.__errorBufferInstalled) {
  window.__errorBufferInstalled = true;

  window.addEventListener("error", (event) => {
    push({
      type: "error",
      message: event.message,
      source: event.filename,
      line: event.lineno,
      col: event.colno,
      stack: event.error?.stack?.substring(0, 500) || "",
    });
  });

  window.addEventListener("unhandledrejection", (event) => {
    push({
      type: "unhandledrejection",
      message: event.reason?.message || String(event.reason),
      stack: String(event.reason?.stack || "").substring(0, 500),
    });
  });

  function safeStringify(a) {
    if (typeof a !== "object" || a === null) return String(a);
    try { return JSON.stringify(a).substring(0, 300); } catch { return String(a); }
  }

  const origError = console.error;
  const origWarn = console.warn;

  console.error = (...args) => {
    push({ type: "console.error", message: args.map(safeStringify).join(" ") });
    origError.apply(console, args);
  };

  console.warn = (...args) => {
    push({ type: "console.warn", message: args.map(safeStringify).join(" ") });
    origWarn.apply(console, args);
  };
}

export function getErrors() { return [...buffer]; }
