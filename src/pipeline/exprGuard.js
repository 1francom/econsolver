// ─── ECON STUDIO · pipeline/exprGuard.js ─────────────────────────────────────
// Static denylist guard for dynamically-evaluated pipeline expressions
// (mutate / if_else / case_when / vector_assign-conditional / ai_tr / DGP).
//
// SECURITY MODEL: this denylist is the FAST UX / early-reject layer. The robust
// boundary is the scrubbed Worker global scope (see src/workers/exprEval.worker.js,
// which nulls fetch/XMLHttpRequest/WebSocket/importScripts/navigator/… so an
// evaluated expression — even one that reconstructs a function via the
// constructor escape — has no network or credential reach). A determined
// attacker can split identifier strings ('fet'+'ch') to evade a substring
// denylist, which is exactly why the worker scrub is the real defense; this
// guard exists to reject obvious payloads early with a clear message.
//
// Matching is case-SENSITIVE on the exact JS builtin spellings so legitimate
// column names like "worker", "location", or "process" are not false-positives.

const DENY = /\b(window|self|globalThis|document|localStorage|sessionStorage|indexedDB|fetch|XMLHttpRequest|WebSocket|EventSource|importScripts|Worker|navigator|eval|Function|constructor|prototype|__proto__|import|postMessage)\b/;

export function isSafeExpr(expr) {
  if (expr === null || expr === undefined) return true;
  if (typeof expr !== "string") return true;
  if (expr.includes("`")) return false; // template literals enable string-built evasion
  return !DENY.test(expr);
}

export function assertSafeExpr(expr) {
  if (!isSafeExpr(expr)) {
    throw new Error(
      "Unsafe expression: references a forbidden identifier " +
      "(e.g. fetch, localStorage, constructor, globalThis) or a template literal."
    );
  }
}
