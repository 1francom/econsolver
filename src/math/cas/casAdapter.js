// Backend-agnostic facade (§5.1). App code imports ONLY `cas`, never a backend.
import { nerdamerBackend } from "./nerdamerBackend.js";

let active = nerdamerBackend;          // default backend (Plan 1)
let readyPromise = null;

export const cas = {
  backend() { return active.name; },
  ready() {
    if (!readyPromise) readyPromise = active.ready();
    return readyPromise;
  },
  parse(src) { return active.parse(src); },
  freeSymbols(e) { return active.freeSymbols(e); },
  toLatex(e) { return active.toLatex(e); },
  evalAt(e, scope) { return active.evalAt(e, scope); },
  diff(e, v) { return active.diff(e, v); },
  simplify(e) { return active.simplify(e); },
  solve(e, v) { return active.solve(e, v); },
  solveSystem(eqs, vars) { return active.solveSystem(eqs, vars); },

  // Shared (backend-independent) Lagrangian FOC builder (§5.4).
  // L = obj - sum lambda_i (g_i); each g_i provided as "(lhs)-(rhs)" (=0 at feasibility).
  lagrangianFOC(obj, constraints, choiceVars) {
    const multipliers = constraints.map((_, i) => `lambda_${i + 1}`);
    let L = `(${obj})`;
    constraints.forEach((g, i) => { L += ` - ${multipliers[i]}*(${g})`; });
    const equations = [];
    for (const v of choiceVars) equations.push(active.diff(L, v));
    for (const m of multipliers) equations.push(active.diff(L, m));
    return { L, equations, multipliers };
  },

  substitute(e, scope) { return active.substitute(e, scope); },
  compile(e, freeVars) { return active.compile(e, freeVars); },
};

// For the SymPy escalation (backend B), expose a setter behind the same surface.
export function _setCasBackend(backend) { active = backend; readyPromise = null; }

// Dual symbolic+numeric result shape every operation stores in session.results (§5.6).
export function buildOpResult(op, { symbolicExpr = null, numeric = {}, closed = true, error = null }) {
  return {
    op,
    symbolic: {
      expr: symbolicExpr,
      latex: symbolicExpr != null ? safeLatex(symbolicExpr) : null,
      closed,
    },
    numeric,
    source: closed ? "symbolic" : "numeric-fallback",
    error,
  };
}

function safeLatex(expr) {
  try { return cas.toLatex(expr); } catch { return null; }
}
