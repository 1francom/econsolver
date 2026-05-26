// ─── ECON STUDIO · src/services/exprEvalService.js ───────────────────────────
// Singleton wrapper around exprEval.worker.js.
// Provides Promise-based APIs for expression evaluation in the isolated Worker.
//
// evalColumn(step, rows) → Promise<{ newColValues }>
// evalScope(variables, nObs, seed) → Promise<{ scope } | { error }>

let _worker = null;
let _reqId  = 0;
const _pending = new Map();   // id → { resolve, reject }

function getWorker() {
  if (!_worker) {
    _worker = new Worker(
      new URL("../workers/exprEval.worker.js", import.meta.url),
      { type: "module" }
    );
    _worker.onmessage = ({ data }) => {
      const cb = _pending.get(data.id);
      _pending.delete(data.id);
      if (!cb) return;
      data.ok ? cb.resolve(data.result) : cb.reject(new Error(data.error));
    };
    _worker.onerror = e => console.error("[exprEvalService] worker error:", e.message);
  }
  return _worker;
}

function request(type, payload) {
  const id = ++_reqId;
  return new Promise((resolve, reject) => {
    _pending.set(id, { resolve, reject });
    getWorker().postMessage({ id, type, payload });
  });
}

/**
 * Evaluate a mutate or ai_tr pipeline step in the Worker.
 *
 * @param {object} step - The pipeline step ({ type, expr|js, col, nn })
 * @param {object[]} rows - Full row objects (needed for mutate column references)
 * @returns {Promise<{ newColValues: any[] }>}
 */
export function evalColumn(step, rows) {
  if (step.type === "ai_tr") {
    return request("eval_col", {
      mode:      "ai_tr",
      expr:      step.js,
      colValues: rows.map(r => r[step.col]),
      col:       step.col,
      newCol:    step.col,
    });
  }
  // mutate
  return request("eval_col", {
    mode:   "mutate",
    expr:   step.expr,
    rows,
    col:    step.col,
    newCol: step.nn,
  });
}

/**
 * Build a DGP scope (SimulateTab) in the Worker.
 *
 * @param {object[]} variables - Variable definitions array
 * @param {number} nObs - Number of observations
 * @param {number} seed - PRNG seed
 * @returns {Promise<{ scope: Record<string,number[]> } | { error: string }>}
 */
export function evalScope(variables, nObs, seed) {
  return request("eval_scope", { variables, nObs, seed });
}
