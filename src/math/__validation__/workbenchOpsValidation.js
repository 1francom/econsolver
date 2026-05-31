// Browser harness for workbench operations.js. Needs cas.ready() (nerdamer CDN).
// Exposes window.__validation.workbenchOps() -> Promise<{cells, allPass}>.
import { cas } from "../cas/casAdapter.js";
import { newSession, newEquation } from "../../components/calculate/workbench/workbenchStore.js";
import { runCard } from "../../components/calculate/workbench/operations.js";

const approx = (a, b, tol = 1e-3) => Math.abs(a - b) <= tol;

export async function runWorkbenchOpsValidation() {
  await cas.ready();
  const cells = [];

  // Cell 1: plot of Y=A*K^a*L^(1-a) yields finite points; deriv ∂Y/∂K closed.
  {
    const s = newSession({
      params: [{ name: "A", value: 1 }, { name: "L", value: 9 }, { name: "alpha", value: 0.3 }],
      view: { xRange: [0.5, 8], positiveQuad: true },
    });
    const eq = newEquation({ label: "Y", expr: "A*K^alpha*L^(1-alpha)", axis: "K",
      ops: { plot: true, deriv: true, integral: false, solveZero: false, optimize: false } });
    const res = runCard(eq, { ...s, equations: [eq] });
    const pass = res.plot.numeric.points.length > 100
      && res.deriv.symbolic.closed === true
      && approx(res.deriv.numeric.points.find((p) => approx(p.x, 4, 0.05))?.y ?? NaN, 0.529231, 1e-2);
    cells.push({ name: "plot+deriv-MPK", expected: "MPK(4)≈0.529", got: { n: res.plot.numeric.points.length, deriv: res.deriv.symbolic.latex }, pass });
  }

  // Cell 2: solveZero on x^2-4 finds root 2 in [0,5].
  {
    const eq = newEquation({ expr: "x^2-4", axis: "x", ops: { plot: false, deriv: false, integral: false, solveZero: true, optimize: false } });
    const s = newSession({ view: { xRange: [0, 5], positiveQuad: true }, equations: [eq] });
    const res = runCard(eq, s);
    const pass = res.solveZero.symbolic.closed === true && res.solveZero.numeric.roots.some((r) => approx(r, 2));
    cells.push({ name: "solveZero-x2-4", expected: "root 2", got: res.solveZero.numeric.roots, pass });
  }

  // Cell 3: unconstrained optimize of 4*sqrt(K)-K-2 → K*≈4, max.
  {
    const eq = newEquation({ expr: "4*sqrt(K)-K-2", axis: "K", sense: "max",
      ops: { plot: false, deriv: false, integral: false, solveZero: false, optimize: true } });
    const s = newSession({ view: { xRange: [0.01, 20], positiveQuad: true }, equations: [eq] });
    const res = runCard(eq, s);
    const pass = approx(res.optimize.numeric.x, 4, 1e-2) && res.optimize.numeric.kind === "max";
    cells.push({ name: "optimizeA-profit", expected: "K*≈4 max", got: res.optimize.numeric, pass });
  }

  // Cell 4: constrained optimize x^0.4*y^0.6 s.t. 2x+5y=100 → x≈20,y≈12.
  {
    const obj = newEquation({ expr: "x^0.4*y^0.6", axis: "x",
      ops: { plot: false, deriv: false, integral: false, solveZero: false, optimize: true } });
    const con = newEquation({ kind: "constraint", label: "b",
      relation: { lhs: "2*x+5*y", op: "=", rhs: "100" } });
    const s = newSession({ choiceVars: ["x", "y"], equations: [obj, con] });
    const res = runCard(obj, s);
    const c = res.optimize.numeric.choices || {};
    const pass = approx(c.x, 20, 1e-1) && approx(c.y, 12, 1e-1);
    cells.push({ name: "optimizeC-utility", expected: "x≈20,y≈12", got: res.optimize.numeric, pass });
  }

  // Cell 5: integral of x^2 over [0,1] ≈ 0.333 (numeric trapezoid).
  {
    const eq = newEquation({ expr: "x^2", axis: "x", ops: { plot: false, deriv: false, integral: true, solveZero: false, optimize: false } });
    const s = newSession({ view: { xRange: [0, 1], positiveQuad: true }, equations: [eq] });
    const res = runCard(eq, s);
    const pass = approx(res.integral.numeric.value, 0.3333, 1e-2);
    cells.push({ name: "integral-x2", expected: "≈0.333", got: res.integral.numeric.value, pass });
  }

  const allPass = cells.every((c) => c.pass);
  return { cells, allPass };
}

if (typeof window !== "undefined") {
  window.__validation = window.__validation || {};
  window.__validation.workbenchOps = runWorkbenchOpsValidation;
}
