import { trimResult } from "../trimResult.js";

let pass = 0, fail = 0;
const check = (n, c) => c ? (pass++, console.log("  [pass]", n)) : (fail++, console.log("  [FAIL]", n));

const big = {
  id: "m1", type: "OLS", modelLabel: "OLS", spec: { yVar: "y", xVars: ["x"] },
  varNames: ["(Intercept)", "x"], beta: [1, 2], se: [0.1, 0.2], pVals: [0.5, 0.01],
  R2: 0.8, n: 100,
  fittedValues: new Array(100).fill(0), residuals: new Array(100).fill(0), vcov: [[1, 0], [0, 1]],
};
const t = trimResult(big);

check("keeps coefficients", t.beta.length === 2 && t.se.length === 2);
check("keeps fit + spec + label", t.R2 === 0.8 && t.spec.yVar === "y" && t.label === "OLS");
check("strips fittedValues", t.fittedValues === undefined);
check("strips residuals", t.residuals === undefined);
check("strips vcov", t.vcov === undefined);
check("json round-trips", JSON.parse(JSON.stringify(t)).beta[1] === 2);
check("null in → null out", trimResult(null) === null);

console.log(`\ntrimResult: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
