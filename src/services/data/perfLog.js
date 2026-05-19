// ─── ECON STUDIO · src/services/data/perfLog.js ────────────────────────────────
// Per-estimate performance ring buffer + measure() helper.
//
// Used by ModelingTab to record path (sql|js), n, k, seType, and timing for
// each estimation. Hidden from normal users — surfaced via window.__perfLog
// (set up in ModelingTab) for inspection in DevTools.

const BUFFER_MAX = 50;
const buffer = [];

// Use globalThis.performance if available (Node 16+, all browsers); fall back
// to Date.now() which is millisecond-resolution but always present.
const nowFn = (globalThis.performance && typeof globalThis.performance.now === "function")
  ? () => globalThis.performance.now()
  : () => Date.now();

export function logEstimate(entry) {
  buffer.push({ ts: nowFn(), ...entry });
  while (buffer.length > BUFFER_MAX) buffer.shift();
}

export function getEntries() {
  return buffer.slice();
}

export function clearLog() {
  buffer.length = 0;
}

// Wrap an async fn, return { result, ms }. The caller decides whether to log.
export async function measure(fn) {
  const start = nowFn();
  const result = await fn();
  return { result, ms: nowFn() - start };
}
