// Browser validation harness for the Workbench symbolic+numeric engine.
// Exposes window.__validation.workbench() -> Promise<{ cells, allPass }>.
// Ground truth is analytic (textbook closed forms), cross-checkable in R.
// SECURITY (§10): numeric evaluation goes through cas.evalAt / cas.compile only.
import { cas, buildOpResult } from "../cas/casAdapter.js";
import { extractSymbols, optimizeUnconstrained, optimizeConstrained } from "../calcEngine.js";

const approx = (a, b, tol = 1e-5) => Math.abs(a - b) <= tol;

export async function runWorkbenchValidation() {
  await cas.ready();
  const cells = [];

  // Cell 1: Cobb-Douglas MPK. d/dK [A*K^alpha*L^(1-alpha)] at A=1,alpha=0.3,K=4,L=9.
  {
    const d = cas.diff("A*K^alpha*L^(1-alpha)", "K");
    const val = cas.evalAt(d, { A: 1, alpha: 0.3, K: 4, L: 9 });
    cells.push({ name: "cobb-douglas-MPK", expected: 0.529231, got: val, pass: approx(val, 0.529231) });
  }

  // Cell 2: extractSymbols on a Cobb-Douglas production function.
  {
    const syms = extractSymbols("A*K^alpha*L^(1-alpha)");
    const exp = ["A", "K", "L", "alpha"];
    const pass = syms.length === exp.length && exp.every((s, i) => s === syms[i]);
    cells.push({ name: "extract-symbols", expected: exp, got: syms, pass });
  }

  // Cell 3: Profit max pi(K)=4*sqrt(K)-K-2 on [0.01, 20]. Expect K*=4, pi*=2, max.
  {
    const pi = (K) => 4 * Math.sqrt(K) - K - 2;
    const r = optimizeUnconstrained(pi, 0.01, 20, "max");
    const pass = approx(r.x, 4, 1e-3) && approx(r.value, 2, 1e-3) && r.kind === "max";
    cells.push({ name: "profit-max", expected: { x: 4, value: 2, kind: "max" }, got: r, pass });
  }

  // Cell 4: lagrangianFOC structure for utility max s.t. budget.
  // obj = x^0.4*y^0.6 ; constraint g = 2*x+5*y-100 ; choiceVars [x,y].
  {
    const foc = cas.lagrangianFOC("x^0.4*y^0.6", ["2*x+5*y-100"], ["x", "y"]);
    const pass = foc.equations.length === 3 && foc.multipliers.length === 1 && foc.multipliers[0] === "lambda_1";
    cells.push({ name: "lagrangian-structure", expected: { eqs: 3, mult: "lambda_1" }, got: { eqs: foc.equations.length, mult: foc.multipliers[0] }, pass });
  }

  // Cell 5: max x^0.4*y^0.6 s.t. 2x+5y=100. Expect x*=20, y*=12, lambda_1≈0.147210.
  {
    const obj = (s) => Math.pow(s.x, 0.4) * Math.pow(s.y, 0.6);
    const cons = [{ g: (s) => 2 * s.x + 5 * s.y - 100 }];
    const r = optimizeConstrained(obj, cons, ["x", "y"], {});
    const pass = approx(r.choices.x, 20, 1e-2) && approx(r.choices.y, 12, 1e-2) && approx(r.multipliers.lambda_1, 0.147210, 1e-3);
    cells.push({ name: "utility-max-constrained", expected: { x: 20, y: 12, lambda_1: 0.147210 }, got: r, pass });
  }

  // Cell 6: compile the symbolic MPK and evaluate — must match Cell 1's 0.529231.
  {
    const d = cas.diff("A*K^alpha*L^(1-alpha)", "K");
    const f = cas.compile(d, ["A", "alpha", "K", "L"]);
    const val = f({ A: 1, alpha: 0.3, K: 4, L: 9 });
    cells.push({ name: "compile-MPK", expected: 0.529231, got: val, pass: approx(val, 0.529231) });
  }

  // Cell 7: result contract shape (§5.6).
  {
    const d = cas.diff("A*K^alpha*L^(1-alpha)", "K");
    const r = buildOpResult("deriv", { symbolicExpr: d, numeric: { value: 0.529231 }, closed: true });
    const pass =
      r.op === "deriv" &&
      r.source === "symbolic" &&
      r.symbolic.closed === true &&
      typeof r.symbolic.latex === "string" &&
      r.numeric.value === 0.529231 &&
      r.error === null;
    cells.push({ name: "result-contract", expected: "dual shape, source=symbolic", got: r, pass });
  }

  const allPass = cells.every((c) => c.pass);
  return { cells, allPass };
}

if (typeof window !== "undefined") {
  window.__validation = window.__validation || {};
  window.__validation.workbench = runWorkbenchValidation;
}
