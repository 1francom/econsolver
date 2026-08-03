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

// Collect every dynamically-evaluated expression carried by a step. Single
// source of truth for the field list — stepValidator.js, syncEngine.js and
// ImportPipelineButton.jsx used to each keep their own copy, and one of them
// (stepValidator.js) drifted and silently dropped `step.js` (ai_tr), which is
// how SECURITY_AUDIT_2026-08-02.md's C-1 chain got through. Import this
// instead of re-declaring the field list anywhere new.
export function exprFieldsOf(step) {
  const out = [];
  if (typeof step?.expr === "string") out.push(step.expr);
  if (typeof step?.cond === "string") out.push(step.cond);
  if (typeof step?.js === "string") out.push(step.js);
  if (Array.isArray(step?.cases)) {
    step.cases.forEach(c => { if (typeof c?.cond === "string") out.push(c.cond); });
  }
  if (Array.isArray(step?.rules)) {
    step.rules.forEach(r => { if (typeof r?.expr === "string") out.push(r.expr); });
  }
  return out;
}

// ── R-STYLE %in% TRANSLATION ──────────────────────────────────────────────────
// Litux users are R/Stata researchers who naturally type R's membership operator
// (`col %in% c("A","B")`, `col %in% 1:10`) into filter/mutate/condition boxes.
// `%in%` is not valid JS (`%` is modulo), so every boolean-condition expression
// (filter, mutate, if_else, case_when, vector_assign — sync AND worker paths)
// is rewritten to a JS array-membership check BEFORE it reaches Function().
// String-level transform only — no full R parser — covering the forms
// researchers actually use:
//   col %in% c(1, 2, 3)   → [1, 2, 3].includes(col)
//   col %in% 1:10         → Array.from({length:10-1+1},(_,_i)=>1+_i).includes(col)
//   col %in% otherArray   → [].concat(otherArray).includes(col)   (bare fallback)
const IN_IDENT = String.raw`[A-Za-z_$][\w$]*(?:\.[A-Za-z_$][\w$]*)*`;

// c(...) argument lists routinely contain string values with their own parens
// (e.g. `regionname %in% c("Spain (Espana)", "Basque Country (Pais Vasco)")`),
// so a flat `[^()]*` regex capture breaks on the first ")" inside the string.
// Scan for the matching close-paren by hand, tracking quote state, instead.
const C_CALL_HEAD = new RegExp(`(${IN_IDENT})\\s*%in%\\s*c\\(`, "g");
function translateInCLists(expr) {
  let out = "", last = 0;
  for (const m of expr.matchAll(C_CALL_HEAD)) {
    if (m.index < last) continue; // already consumed by a previous match's scan
    const lhs = m[1];
    const openIdx = m.index + m[0].length - 1; // index of the "("
    let depth = 1, i = openIdx + 1, quote = null;
    while (i < expr.length && depth > 0) {
      const ch = expr[i];
      if (quote) {
        if (ch === "\\") { i += 2; continue; }
        if (ch === quote) quote = null;
      } else if (ch === '"' || ch === "'") quote = ch;
      else if (ch === "(") depth++;
      else if (ch === ")") depth--;
      i++;
    }
    if (depth !== 0) continue; // unbalanced — leave this occurrence as-is
    const list = expr.slice(openIdx + 1, i - 1);
    out += expr.slice(last, m.index) + `[${list}].includes(${lhs})`;
    last = i;
  }
  return out + expr.slice(last);
}

export function translateRInOperator(expr) {
  if (typeof expr !== "string" || !expr.includes("%in%")) return expr;
  let out = translateInCLists(expr);
  out = out.replace(
    new RegExp(`(${IN_IDENT})\\s*%in%\\s*(-?\\d+)\\s*:\\s*(-?\\d+)`, "g"),
    (_, lhs, lo, hi) => `Array.from({length:(${hi})-(${lo})+1},(_,_i)=>(${lo})+_i).includes(${lhs})`
  );
  out = out.replace(
    new RegExp(`(${IN_IDENT})\\s*%in%\\s*(${IN_IDENT})`, "g"),
    (_, lhs, rhs) => `[].concat(${rhs}).includes(${lhs})`
  );
  return out;
}
