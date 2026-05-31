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
  // Welfare mode: when a finite reference y is set, integrate (f − ref) and split
  // the signed area into gain (curve above ref) and loss (curve below ref),
  // splitting each segment at its zero crossing so the parts stay exact.
  const ref = Number.isFinite(eq.integralRef) ? eq.integralRef : null;
  let area = 0, gain = 0, loss = 0;
  for (let i = 1; i < pts.length; i++) {
    const x0 = pts[i - 1].x, x1 = pts[i].x;
    if (ref == null) { area += (x1 - x0) * (pts[i].y + pts[i - 1].y) / 2; continue; }
    const d0 = pts[i - 1].y - ref, d1 = pts[i].y - ref;
    area += (x1 - x0) * (d0 + d1) / 2;
    if (d0 === 0 && d1 === 0) continue;
    if ((d0 >= 0 && d1 >= 0) || (d0 <= 0 && d1 <= 0)) {
      const seg = (x1 - x0) * (d0 + d1) / 2;
      if (seg >= 0) gain += seg; else loss += -seg;
    } else {
      const t = d0 / (d0 - d1);
      const xc = x0 + t * (x1 - x0);
      const aL = (xc - x0) * d0 / 2, aR = (x1 - xc) * d1 / 2;
      if (aL >= 0) gain += aL; else loss += -aL;
      if (aR >= 0) gain += aR; else loss += -aR;
    }
  }
  let anti = null, closed = false;
  try { anti = cas.parse(`integrate(${eq.expr}, ${eq.axis})`); closed = true; } catch { /* numeric only */ }
  return buildOpResult("integral", {
    symbolicExpr: closed ? anti : null,
    numeric: ref == null ? { value: area, a, b, points: pts }
      : { value: area, a, b, points: pts, ref, gain, loss },
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
    numeric: { mode: "unconstrained", x: r.x, value: r.value, kind: r.kind,
      interior: r.interior, unbounded: r.unbounded, atUpper: r.atUpper, sense: eq.sense,
      foc: foc?.solutions ?? [] },
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

// Comparative statics — family of curves (Step 1). Sweeps session.sweep.param
// across [from,to] in `steps` discrete values and samples each plotted objective
// that depends on the param, holding the other params at their slider baseline.
// Compiles each expression ONCE and re-samples per value (cheaper than sampleCurve,
// which recompiles each call). Returns a flat curve list the canvas colors by p.
export function runSweepFamily(session) {
  const sw = session.sweep;
  if (!sw || !sw.param || sw.showFamily === false) return null;
  const from = Number.isFinite(sw.from) ? sw.from : null;
  const to = Number.isFinite(sw.to) ? sw.to : null;
  if (from == null || to == null || from === to) return null;
  const steps = Math.min(12, Math.max(2, Math.round(sw.steps) || 5));
  const base = paramScope(session.params);
  const values = [];
  for (let i = 0; i < steps; i++) values.push(from + (to - from) * (i / (steps - 1)));

  const [a, b] = session.view.xRange;
  if (!Number.isFinite(a) || !Number.isFinite(b) || a === b) return null;
  const n = 160, dx = (b - a) / (n - 1);

  const objectives = session.equations.filter((e) => e.kind !== "constraint" && e.ops.plot && e.axis);
  const curves = [];
  for (const eq of objectives) {
    const free = safeFree(eq.expr);
    if (!free.includes(sw.param)) continue; // expr doesn't depend on the swept param
    let f;
    try { f = cas.compile(eq.expr, free); } catch { continue; }
    for (const p of values) {
      const scope = { ...base, [sw.param]: p };
      const pts = [];
      for (let i = 0; i < n; i++) {
        const x = a + i * dx;
        let y;
        try { y = f({ ...scope, [eq.axis]: x }); } catch { y = NaN; }
        if (Number.isFinite(y)) pts.push({ x, y });
      }
      if (pts.length) curves.push({ eqId: eq.id, p, points: pts });
    }
  }
  if (!curves.length) return null;
  return { param: sw.param, pMin: Math.min(from, to), pMax: Math.max(from, to), curves };
}

// Comparative statics — optimum locus (Step 2). Sweeps the parameter on a fine
// grid and re-optimizes each objective that depends on it, recording both the
// argmax/argmin (xStar) and the optimal value f(x*). Boundary points (no interior
// optimum, per the item-B flag) carry interior:false so the locus breaks there
// instead of drawing a fake optimum. Returns one series per qualifying objective.
export function runSweepLocus(session) {
  const sw = session.sweep;
  if (!sw || !sw.param || !sw.locus || sw.locus === "off") return null;
  const from = Number.isFinite(sw.from) ? sw.from : null;
  const to = Number.isFinite(sw.to) ? sw.to : null;
  if (from == null || to == null || from === to) return null;
  const base = paramScope(session.params);
  const [a, b] = session.view.xRange;
  if (!Number.isFinite(a) || !Number.isFinite(b) || a === b) return null;
  const N = 41;

  const objectives = session.equations.filter(
    (e) => e.kind !== "constraint" && e.axis && safeFree(e.expr).includes(sw.param),
  );
  const series = [];
  for (const eq of objectives) {
    let f;
    try { f = cas.compile(eq.expr, safeFree(eq.expr)); } catch { continue; }
    const points = [];
    for (let i = 0; i < N; i++) {
      const p = from + (to - from) * (i / (N - 1));
      const scope = { ...base, [sw.param]: p };
      const fn = (x) => f({ ...scope, [eq.axis]: x });
      let r = null;
      try { r = optimizeUnconstrained(fn, a, b, eq.sense); } catch { /* skip */ }
      points.push(r
        ? { p, xStar: r.x, value: r.value, interior: r.interior !== false }
        : { p, xStar: NaN, value: NaN, interior: false });
    }
    if (points.length) series.push({ eqId: eq.id, sense: eq.sense, points });
  }
  if (!series.length) return null;
  return { param: sw.param, mode: sw.locus, from, to, series };
}

// ── Conditions (item C) — named-equation intersections & FOC systems ──────────
// A condition is `lhs = rhs w.r.t v1, v2, …`. Each operand is either a literal
// expression ("0", "100") or an equation NAME (eq.label). A trailing apostrophe
// ("1'") means "the derivative of that operand w.r.t each solved variable" — so
// `1' = 2' w.r.t X1, X2` solves the componentwise system ∂f/∂Xᵢ = ∂g/∂Xᵢ (the
// stationary point of the gap), while `1 = 2 w.r.t K` solves the level equation
// f = g for K. Single var → cas.solve; multiple → cas.solveSystem.

function fmtNum(x) {
  if (!Number.isFinite(x)) return "—";
  const a = Math.abs(x);
  if (a !== 0 && (a < 1e-3 || a >= 1e6)) return x.toExponential(3);
  return (Math.round(x * 1e6) / 1e6).toString();
}

// Parse one side of a condition. Returns { core, deriv, eq, expr } or null.
function resolveOperand(s, byName) {
  const t = String(s || "").trim();
  if (!t) return null;
  const deriv = t.endsWith("'");
  const core = (deriv ? t.slice(0, -1) : t).trim();
  const eq = byName.get(core) || null;
  return { core, deriv, eq, expr: eq ? eq.expr : core };
}

// Numeric roots of a gap expression in one variable over [a,b]: scan for sign
// changes then bisect. Used when the symbolic solver returns no closed form
// (e.g. transcendental gaps like A·K^α − K). Params held fixed at scope.
function numericRoots(gapExpr, v, scope, [a, b], n = 400) {
  let f;
  try { f = cas.compile(gapExpr, safeFree(gapExpr)); } catch { return []; }
  const g = (x) => { try { return f({ ...scope, [v]: x }); } catch { return NaN; } };
  const roots = [];
  const dx = (b - a) / n;
  let xp = a, yp = g(a);
  for (let i = 1; i <= n; i++) {
    const x = a + i * dx, y = g(x);
    if (Number.isFinite(yp) && Number.isFinite(y) && yp !== 0 && (yp < 0) !== (y < 0)) {
      let lo = xp, hi = x, ylo = yp;
      for (let it = 0; it < 60 && Math.abs(hi - lo) > 1e-10; it++) {
        const mid = (lo + hi) / 2, ym = g(mid);
        if (!Number.isFinite(ym)) break;
        if ((ylo < 0) !== (ym < 0)) hi = mid; else { lo = mid; ylo = ym; }
      }
      const r = (lo + hi) / 2;
      if (!roots.some((q) => Math.abs(q - r) < dx * 0.5)) roots.push(r);
    }
    xp = x; yp = y;
  }
  return roots;
}

function solveCondition(cond, byName, dupes, scope, view) {
  const label = `${cond.lhs || "?"} ${cond.rhs ? "= " + cond.rhs : ""}${cond.wrt ? " w.r.t " + cond.wrt : ""}`.trim();
  const fail = (error) => ({ id: cond.id, label, results: [], closed: false, points: [], markKind: null, error });

  const wrt = String(cond.wrt || "").split(",").map((s) => s.trim()).filter(Boolean);
  if (!wrt.length) return fail("no w.r.t variable");
  const L = resolveOperand(cond.lhs, byName);
  const R = resolveOperand(cond.rhs, byName);
  if (!L || !R) return fail("incomplete condition");
  for (const op of [L, R]) if (op.eq && dupes.has(op.core)) return fail(`ambiguous name "${op.core}"`);

  // Build one gap equation per solved variable.
  const eqExprs = [];
  try {
    for (const v of wrt) {
      const Lv = L.deriv ? cas.diff(L.expr, v) : L.expr;
      const Rv = R.deriv ? cas.diff(R.expr, v) : R.expr;
      eqExprs.push(`(${Lv}) - (${Rv})`);
    }
  } catch (e) { return fail(String(e?.message || e)); }

  const axisEq = (L.eq && L.eq.axis) ? L.eq : (R.eq && R.eq.axis) ? R.eq : null;
  const xr = view?.xRange;
  const haveRange = Array.isArray(xr) && Number.isFinite(xr[0]) && Number.isFinite(xr[1]) && xr[0] !== xr[1];

  // Solve: single variable closed-form root, else simultaneous system.
  let closed = false;
  let results = [];
  try {
    if (wrt.length === 1) {
      const v = wrt[0];
      const sol = cas.solve(eqExprs[0], v); // { closed, solutions:[{[v]: expr}] }
      closed = sol.closed;
      for (const s of sol.solutions) {
        const expr = s[v];
        let value = NaN;
        try { value = cas.evalAt(expr, scope); } catch { /* non-numeric */ }
        results.push({ var: v, expr, value });
      }
      // Numeric fallback: when no closed form evaluates to a finite root, scan the
      // gap for sign-change roots over the visible range (requires v be the axis).
      if (!results.some((r) => Number.isFinite(r.value)) && haveRange && axisEq && axisEq.axis === v) {
        const roots = numericRoots(eqExprs[0], v, scope, xr);
        if (roots.length) { closed = false; results = roots.map((value) => ({ var: v, expr: null, value })); }
      }
    } else {
      const sys = cas.solveSystem(eqExprs, wrt); // { closed, solutions:[{v1:expr,…}] }
      closed = sys.closed;
      const first = sys.solutions[0] || {};
      for (const v of wrt) {
        const expr = first[v];
        let value = NaN;
        try { value = cas.evalAt(expr, scope); } catch { /* non-numeric */ }
        results.push({ var: v, expr: expr ?? null, value });
      }
    }
  } catch (e) { return fail(String(e?.message || e)); }

  if (!results.some((r) => Number.isFinite(r.value))) return fail(closed ? "no solution in range" : "no solution");

  // Plot markers: only when solving a single variable that is a plotted axis.
  const points = [];
  let markKind = null;
  if (wrt.length === 1 && axisEq && axisEq.axis === wrt[0]) {
    const derivOnly = L.deriv && R.deriv;
    for (const res of results) {
      if (!Number.isFinite(res.value)) continue;
      const x = res.value;
      if (!derivOnly) {
        let y = NaN;
        try { const f = cas.compile(axisEq.expr, safeFree(axisEq.expr)); y = f({ ...scope, [wrt[0]]: x }); } catch { /* skip */ }
        if (Number.isFinite(y)) { points.push({ x, y, label: `${wrt[0]}* = ${fmtNum(x)}` }); markKind = "point"; continue; }
      }
      points.push({ x, y: null, label: `${wrt[0]}* = ${fmtNum(x)}` });
      markKind = markKind || "vline";
    }
  }

  return { id: cond.id, label, results, closed, points, markKind, error: null };
}

// Solve every enabled condition on the session against the current param scope.
// Returns [{ id, label, results:[{var,expr,value}], closed, points, markKind, error }].
export function runConditions(session) {
  const conds = Array.isArray(session.conditions) ? session.conditions : [];
  if (!conds.length) return [];
  const byName = new Map();
  const seen = new Set(), dupes = new Set();
  for (const e of session.equations) {
    const nm = (e.label || "").trim();
    if (!nm) continue;
    if (seen.has(nm)) dupes.add(nm); else seen.add(nm);
    if (!byName.has(nm)) byName.set(nm, e);
  }
  const scope = paramScope(session.params);
  return conds.filter((c) => c.enabled !== false).map((c) => solveCondition(c, byName, dupes, scope, session.view));
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
