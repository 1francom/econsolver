// Pure-JS bridge: equation card + parameter scope -> §5.6 result contracts.
// No React. All symbolic work via cas.*; numeric fallback via calcEngine.
// SECURITY (§10.1/§10.2): user expressions only ever reach cas.* (nerdamer's
// parser) and cas.compile (nerdamer buildFunction) — never an app-side compile.
import { cas, buildOpResult } from "../../../math/cas/casAdapter.js";
import { optimizeUnconstrained, optimizeConstrained } from "../../../math/calcEngine.js";

// Build a numeric scope { name: value } from the param pool.
export function paramScope(params) {
  const scope = {};
  for (const p of params) scope[p.name] = p.value;
  return scope;
}

// Sample a compiled fn over [a,b] at n points, holding params fixed.
// Returns [{x, y}] skipping non-finite y. axis is the swept symbol.
export function sampleCurve(expr, axis, freeVars, scope, [a, b], n = 240) {
  let f;
  try { f = cas.compile(expr, freeVars); } catch { return []; }
  const pts = [];
  const dx = (b - a) / (n - 1);
  for (let i = 0; i < n; i++) {
    const x = a + i * dx;
    let y;
    try { y = f({ ...scope, [axis]: x }); } catch { y = NaN; }
    if (Number.isFinite(y)) pts.push({ x, y });
  }
  return pts;
}

// ── Per-op result builders ────────────────────────────────────────────────────

export function runPlot(eq, scope, view) {
  const freeVars = safeFree(eq.expr);
  const points = eq.axis ? sampleCurve(eq.expr, eq.axis, freeVars, scope, view.xRange) : [];
  return buildOpResult("plot", { symbolicExpr: eq.expr, numeric: { points }, closed: true });
}

export function runDeriv(eq, scope, view) {
  if (!eq.axis) return buildOpResult("deriv", { symbolicExpr: null, numeric: {}, closed: false, error: "no axis" });
  let d;
  try { d = cas.diff(eq.expr, eq.axis); } catch (e) {
    return buildOpResult("deriv", { symbolicExpr: null, numeric: {}, closed: false, error: String(e?.message || e) });
  }
  const freeVars = safeFree(d);
  const points = sampleCurve(d, eq.axis, freeVars, scope, view.xRange);
  return buildOpResult("deriv", { symbolicExpr: d, numeric: { points }, closed: true });
}

export function runIntegral(eq, scope, view) {
  // Numeric definite integral (trapezoid). Uses the equation's explicit
  // integration bounds when set & valid, else falls back to the visible range.
  // Symbolic antiderivative is best-effort (nerdamer integration is weak).
  const ir = eq.integralRange;
  const useIr = Array.isArray(ir) && ir.length === 2
    && Number.isFinite(ir[0]) && Number.isFinite(ir[1]) && ir[0] < ir[1];
  const [a, b] = useIr ? ir : view.xRange;
  const pts = eq.axis ? sampleCurve(eq.expr, eq.axis, safeFree(eq.expr), scope, [a, b]) : [];
  let area = 0;
  for (let i = 1; i < pts.length; i++) area += (pts[i].x - pts[i - 1].x) * (pts[i].y + pts[i - 1].y) / 2;
  let anti = null, closed = false;
  try { anti = cas.parse(`integrate(${eq.expr}, ${eq.axis})`); closed = true; } catch { /* numeric only */ }
  return buildOpResult("integral", {
    symbolicExpr: closed ? anti : null,
    numeric: { value: area, a, b, points: pts },
    closed,
    error: null,
  });
}

export function runSolveZero(eq, scope, view) {
  if (!eq.axis) return buildOpResult("solveZero", { symbolicExpr: null, numeric: {}, closed: false, error: "no axis" });
  const sol = cas.solve(eq.expr, eq.axis); // { closed, solutions:[{[axis]: expr}] }
  // Numeric roots within the visible range, evaluating each symbolic root at scope.
  const roots = [];
  if (sol.closed) {
    for (const s of sol.solutions) {
      try {
        const v = cas.evalAt(s[eq.axis], scope);
        if (Number.isFinite(v) && v >= view.xRange[0] && v <= view.xRange[1]) roots.push(v);
      } catch { /* skip non-numeric root */ }
    }
  }
  return buildOpResult("solveZero", {
    symbolicExpr: sol.closed ? eq.expr : null,
    numeric: { roots, solutions: sol.solutions },
    closed: sol.closed,
    error: sol.closed ? null : "no closed-form root",
  });
}

export function runOptimize(eq, session, scope) {
  const constraints = session.equations.filter((e) => e.kind === "constraint");
  if (constraints.length === 0) return runOptimizeA(eq, session, scope);
  return runOptimizeC(eq, session, constraints, scope);
}

// Unconstrained (A): symbolic FOC, numeric scan+Newton fallback.
function runOptimizeA(eq, session, scope) {
  const axis = eq.axis;
  if (!axis) return buildOpResult("optimize", { symbolicExpr: null, numeric: {}, closed: false, error: "no axis" });
  let fp = null, symbolicClosed = false, foc = null;
  try { fp = cas.diff(eq.expr, axis); foc = cas.solve(fp, axis); symbolicClosed = foc.closed; } catch { /* fall to numeric */ }

  // Numeric optimum over the visible range, params fixed.
  let f;
  try { f = cas.compile(eq.expr, safeFree(eq.expr)); } catch {
    return buildOpResult("optimize", { symbolicExpr: fp, numeric: {}, closed: false, error: "compile failed" });
  }
  const fn = (x) => f({ ...scope, [axis]: x });
  const [a, b] = session.view.xRange;
  const r = optimizeUnconstrained(fn, a, b, eq.sense);
  return buildOpResult("optimize", {
    symbolicExpr: fp,
    numeric: { mode: "unconstrained", x: r.x, value: r.value, kind: r.kind, foc: foc?.solutions ?? [] },
    closed: symbolicClosed,
    error: null,
  });
}

// Constrained (C): Lagrangian FOC; symbolic system + numeric solveSystem fallback.
function runOptimizeC(eq, session, constraints, scope) {
  const choiceVars = session.choiceVars.length
    ? session.choiceVars
    : Array.from(new Set(constraints.flatMap((c) => safeFree(`(${c.relation.lhs}) - (${c.relation.rhs})`)))).slice(0, 2);
  const gExprs = constraints.map((c) => `(${c.relation.lhs}) - (${c.relation.rhs})`);
  // No detectable decision variables → Lagrangian is degenerate; surface an error
  // instead of returning a silently-empty (wrong) result.
  if (!choiceVars.length) {
    return buildOpResult("optimize", { symbolicExpr: null, numeric: { mode: "constrained" }, closed: false, error: "no choice variables" });
  }
  const foc = cas.lagrangianFOC(eq.expr, gExprs, choiceVars); // { L, equations, multipliers }

  // Symbolic system solve (best effort).
  let symbolicClosed = false, symbolicSol = [];
  try {
    const sys = cas.solveSystem(foc.equations, [...choiceVars, ...foc.multipliers]);
    symbolicClosed = sys.closed; symbolicSol = sys.solutions;
  } catch { /* numeric fallback below */ }

  // Numeric fallback through calcEngine.optimizeConstrained, which requires a
  // callable objective and callable constraints — compile the symbolic forms
  // (strings) into numeric fns via cas.compile first. compile() reads only the
  // declared free vars from scope, so extra lambda_i keys are ignored.
  let numeric = {};
  try {
    const objFn = cas.compile(eq.expr, safeFree(eq.expr));
    const consFns = gExprs.map((g) => ({ g: cas.compile(g, safeFree(g)) }));
    const r = optimizeConstrained(objFn, consFns, choiceVars, scope);
    numeric = r.error
      ? { mode: "constrained", error: r.error }
      : { mode: "constrained", choices: r.choices, multipliers: r.multipliers, objectiveValue: r.objectiveValue };
  } catch (e) { numeric = { mode: "constrained", error: String(e?.message || e) }; }

  return buildOpResult("optimize", {
    symbolicExpr: foc.L,
    numeric: { ...numeric, multiplierNames: foc.multipliers, choiceVars, symbolicSolutions: symbolicSol },
    closed: symbolicClosed,
    error: null,
  });
}

// Run every active op on a card; returns { [op]: ResultContract }.
export function runCard(eq, session) {
  const scope = paramScope(session.params);
  const out = {};
  if (eq.kind === "constraint") return out; // constraints contribute to optimize only
  if (eq.ops.plot)      out.plot      = runPlot(eq, scope, session.view);
  if (eq.ops.deriv)     out.deriv     = runDeriv(eq, scope, session.view);
  if (eq.ops.integral)  out.integral  = runIntegral(eq, scope, session.view);
  if (eq.ops.solveZero) out.solveZero = runSolveZero(eq, scope, session.view);
  if (eq.ops.optimize)  out.optimize  = runOptimize(eq, session, scope);
  return out;
}

function safeFree(expr) {
  try { return cas.freeSymbols(expr); } catch { return []; }
}
