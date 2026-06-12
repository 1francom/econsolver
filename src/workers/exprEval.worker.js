// ─── ECON STUDIO · src/workers/exprEval.worker.js ────────────────────────────
// Expression evaluator running in a dedicated Worker context.
//
// SECURITY RATIONALE:
//   Workers have NO access to localStorage, sessionStorage, indexedDB, or the
//   DOM. A malicious expression can call fetch(), but cannot read API keys or
//   stored datasets from the main thread. This is a meaningful isolation
//   improvement over main-thread evaluation.
//
// Message API (postMessage in / postMessage out):
//   IN:  { id, type: "eval_col",   payload: { mode, expr, colValues?, rows?, col, newCol } }
//   IN:  { id, type: "eval_scope", payload: { variables, nObs, seed } }
//   OUT: { id, ok: true,  result: { newColValues } | { scope } }
//   OUT: { id, ok: false, error: "..." }
//
// eval_col — mutate / ai_tr steps
//   mutate: expr references row columns by name; output is newColValues[]
//   ai_tr:  expr is a (value, rowIndex) => ... function; input is colValues[]
//
// eval_scope — SimulateTab DGP builder
//   Full variable list evaluated in sequence; returns { scope } or { error }.

"use strict";

import { drawSamples } from "../math/dgpDraw.js";
import { assertSafeExpr } from "../pipeline/exprGuard.js";
import { HELPERS } from "../pipeline/expressionHelpers.js";

// ── SECURITY: scrub exfiltration / escape globals from the worker scope ────────
// Even if an evaluated expression reconstructs a function via the constructor
// escape, the reconstructed function runs in THIS global scope — which has no
// network primitives after this loop. Combined with the worker's inherent lack
// of localStorage/sessionStorage/indexedDB/DOM, an evaluated expression becomes
// compute-only: it cannot read credentials or open an exfiltration channel.
for (const k of ["fetch", "XMLHttpRequest", "WebSocket", "EventSource", "importScripts", "Worker", "navigator", "Notification"]) {
  try { self[k] = undefined; } catch { /* getter-only on some runtimes; denylist still covers it */ }
}

// ── Helpers injected into mutate expressions ──────────────────────────────────
// ── eval_col ──────────────────────────────────────────────────────────────────
function evalCol({ mode, expr, colValues, rows, col, newCol, trueVal, falseVal, cases, defaultVal, rules, elseValue }) {
  if (mode === "ai_tr") {
    // ai_tr: full arrow-fn or body expression operating on a single column value
    const js = (expr || "").trim();
    assertSafeExpr(js);
    const isFnExpr = /^(\(?\s*[\w$,\s]*\s*\)?\s*=>|\bfunction\b)/.test(js);
    const fn = isFnExpr
      ? Function(`return (${js})`)()           // extract the arrow/function
      : Function("value", "rowIndex", js);      // body format
    const newColValues = colValues.map((v, i) => { try { return fn(v, i); } catch { return v; } });
    return { newColValues };
  }

  // filter: boolean expr per row → mask[]
  if (mode === "filter") {
    if (!rows || rows.length === 0) return { mask: [] };
    assertSafeExpr(expr);
    const fH = Object.keys(rows[0]).filter(h => /^[a-zA-Z_$][a-zA-Z0-9_$]*$/.test(h));
    const fFn = Function(...fH, `"use strict"; return !!(${expr});`);
    return { mask: rows.map(r => { try { return fFn(...fH.map(h => r[h] ?? null)); } catch { return true; } }) };
  }

  // if_else: cond expr → trueVal/falseVal per row
  // payload: { mode, expr: cond, trueVal, falseVal, rows }
  if (mode === "if_else") {
    if (!rows || rows.length === 0) return { newColValues: [] };
    assertSafeExpr(expr);
    const iH  = Object.keys(rows[0]).filter(h => /^[a-zA-Z_$][a-zA-Z0-9_$]*$/.test(h));
    const iFn = Function(...iH, `"use strict"; return !!(${expr});`);
    const allH = Object.keys(rows[0]);
    const newColValues = rows.map(r => {
      let ok = false;
      try { ok = iFn(...iH.map(h => r[h] ?? null)); } catch {}
      const tv = allH.includes(trueVal)  ? r[trueVal]  : trueVal;
      const fv = allH.includes(falseVal) ? r[falseVal] : falseVal;
      return ok ? tv : fv;
    });
    return { newColValues };
  }

  // case_when: array of {cond,val} → first match wins
  // payload: { mode, cases, defaultVal, rows }
  if (mode === "case_when") {
    if (!rows || rows.length === 0) return { newColValues: [] };
    (cases ?? []).forEach(c => assertSafeExpr(c.cond));
    const cwH  = Object.keys(rows[0]).filter(h => /^[a-zA-Z_$][a-zA-Z0-9_$]*$/.test(h));
    const fns  = (cases ?? []).map(c => { try { return Function(...cwH, `"use strict"; return !!(${c.cond});`); } catch { return null; } });
    const newColValues = rows.map(r => {
      const args = cwH.map(h => r[h] ?? null);
      for (let i = 0; i < (cases ?? []).length; i++) {
        if (!fns[i]) continue;
        try { if (fns[i](...args)) return cases[i].val; } catch {}
      }
      return defaultVal ?? null;
    });
    return { newColValues };
  }

  // vector_assign (conditional mode): rules[{expr,value}] first-match-wins, else elseValue
  if (mode === "vector_assign") {
    if (!rows || rows.length === 0) return { newColValues: [] };
    (rules ?? []).forEach(rule => assertSafeExpr(rule.expr));
    const vH  = Object.keys(rows[0]).filter(h => /^[a-zA-Z_$][a-zA-Z0-9_$]*$/.test(h));
    const fns = (rules ?? []).map(rule => { try { return Function(...vH, `"use strict"; return !!(${rule.expr});`); } catch { return null; } });
    const newColValues = rows.map(r => {
      const args = vH.map(h => r[h] ?? null);
      for (let i = 0; i < (rules ?? []).length; i++) {
        if (!fns[i]) continue;
        try { if (fns[i](...args)) return rules[i].value; } catch {}
      }
      return elseValue ?? null;
    });
    return { newColValues };
  }

  // mutate: expression can reference any column by name
  if (!rows || rows.length === 0) return { newColValues: [] };
  assertSafeExpr(expr);
  const headers = Object.keys(rows[0]);
  const safeH   = headers.filter(h => /^[a-zA-Z_$][a-zA-Z0-9_$]*$/.test(h));
  const pNames  = [...Object.keys(HELPERS), "row", ...safeH];
  const fn = Function(...pNames, `"use strict";return (${expr});`);
  const newColValues = rows.map(r => {
    const pVals = [...Object.values(HELPERS), r, ...safeH.map(h => r[h] ?? null)];
    try {
      const val = fn(...pVals);
      if (val === undefined || (typeof val === "number" && !isFinite(val))) return null;
      return val;
    } catch { return null; }
  });
  return { newColValues };
}

// ── eval_scope (DGP builder for SimulateTab) ──────────────────────────────────
// drawSamples/normalSample/coerceLevel/parseLevels are imported from the shared
// src/math/dgpDraw.js (single source — no drift vs the main-thread preview).
// The worker keeps its own seeded mulberry32 to feed drawSamples.

function mulberry32(seed) {
  let s = seed >>> 0;
  return function () {
    s |= 0; s = s + 0x6D2B79F5 | 0;
    let t = Math.imul(s ^ s >>> 15, 1 | s);
    t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t;
    return ((t ^ t >>> 14) >>> 0) / 4294967296;
  };
}

function evalScope({ variables, nObs, seed }) {
  const rng   = mulberry32(+seed || 0);
  const scope = {};

  for (const v of variables) {
    if (!v.name.trim()) return { error: "Variable with empty name." };

    if (v.dist === "Expression") {
      const expr = (v.params.expr || "").trim();
      if (!expr) return { error: `${v.name}: expression is empty.` };
      try {
        assertSafeExpr(expr);
        const varNames  = Object.keys(scope);
        const varArrays = Object.values(scope);
        const helperNames = Object.keys(HELPERS);
        const helperFns = Object.values(HELPERS);
        const fn = Function(...varNames, ...helperNames, "N", "observations", `"use strict"; return (${expr});`);
        const arr = [];
        for (let i = 0; i < nObs; i++) arr.push(fn(...varArrays.map(a => a[i]), ...helperFns, nObs, nObs));
        scope[v.name] = arr;
      } catch (e) { return { error: `${v.name}: ${e.message}` }; }

    } else if (v.dist === "Constant") {
      const raw = (v.params.value ?? "0").trim();
      try {
        assertSafeExpr(raw);
        const val = Function("N", "observations", `"use strict"; return (${raw});`)(nObs, nObs);
        scope[v.name] = new Array(nObs).fill(typeof val === "number" || typeof val === "string" ? val : 0);
      } catch (e) { return { error: `${v.name}: ${e.message}` }; }

    } else if (v.dist === "Sequence") {
      const from = +(v.params.from ?? 1), by = +(v.params.by ?? 1);
      scope[v.name] = Array.from({ length: nObs }, (_, i) => from + i * by);

    } else if (v.dist === "ForLoop") {
      const initExpr = (v.params.init || "0").trim();
      const updExpr  = (v.params.update || "prev").trim();
      const varNames  = Object.keys(scope);
      const varArrays = Object.values(scope);
      const helperNames = Object.keys(HELPERS);
      const helperFns = Object.values(HELPERS);
      try {
        assertSafeExpr(initExpr); assertSafeExpr(updExpr);
        const arr    = new Array(nObs);
        const initFn = Function(...varNames, ...helperNames, "N", "observations", `"use strict"; return (${initExpr});`);
        arr[0] = initFn(...varArrays.map(a => a[0]), ...helperFns, nObs, nObs);
        const updFn = Function("prev", "i", ...varNames, ...helperNames, "N", "observations", `"use strict"; return (${updExpr});`);
        for (let i = 1; i < nObs; i++) arr[i] = updFn(arr[i - 1], i, ...varArrays.map(a => a[i]), ...helperFns, nObs, nObs);
        scope[v.name] = arr;
      } catch (e) { return { error: `${v.name}: ${e.message}` }; }

    } else if (v.dist === "WhileLoop") {
      const initExpr = (v.params.init || "1").trim();
      const updExpr  = (v.params.update || "prev").trim();
      const condExpr = (v.params.condition || "false").trim();
      const maxIter  = Math.max(1, Math.min(100000, +(v.params.maxIter) || 1000));
      try {
        assertSafeExpr(initExpr); assertSafeExpr(condExpr); assertSafeExpr(updExpr);
        let val = Function(`"use strict"; return (${initExpr});`)();
        let iter = 0;
        const condFn = Function("prev", `"use strict"; return !!(${condExpr});`);
        const updFn  = Function("prev", `"use strict"; return (${updExpr});`);
        while (condFn(val) && iter < maxIter) { val = updFn(val); iter++; }
        scope[v.name] = new Array(nObs).fill(typeof val === "number" ? val : 0);
      } catch (e) { return { error: `${v.name}: ${e.message}` }; }

    } else {
      scope[v.name] = drawSamples(rng, nObs, v.dist, v.params);
    }
  }

  return { scope };
}

// ── Message router ────────────────────────────────────────────────────────────
self.onmessage = function ({ data }) {
  const { id, type, payload } = data;
  try {
    let result;
    if      (type === "eval_col")   result = evalCol(payload);
    else if (type === "eval_scope") result = evalScope(payload);
    else throw new Error(`Unknown type: ${type}`);
    self.postMessage({ id, ok: true, result });
  } catch (e) {
    self.postMessage({ id, ok: false, error: e.message });
  }
};
