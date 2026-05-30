// Browser validation harness for the Workbench symbolic+numeric engine.
// Exposes window.__validation.workbench() -> Promise<{ cells, allPass }>.
// Ground truth is analytic (textbook closed forms), cross-checkable in R.
// SECURITY (§10): numeric evaluation goes through cas.evalAt / cas.compile only.
import { cas } from "../cas/casAdapter.js";

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

  const allPass = cells.every((c) => c.pass);
  return { cells, allPass };
}

if (typeof window !== "undefined") {
  window.__validation = window.__validation || {};
  window.__validation.workbench = runWorkbenchValidation;
}
