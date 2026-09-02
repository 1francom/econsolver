// ─── ECON STUDIO · portmanteau + normality validation ────────────────────────
// Checks ljungBoxTest / normalityTest (src/math/SampleTests.js) against
// reference values in portmanteauBenchmarks.json.
//
//   node src/math/__validation__/portmanteauValidation.mjs
//
// The benchmarks were produced with statsmodels' acorr_ljungbox and scipy's
// jarque_bera, which implement the same formulas as R's Box.test(type="Ljung" /
// "Box") and tseries::jarque.bera.test. portmanteauRValidation.R regenerates
// the identical file from R itself — run it when R is available and the
// numbers must be pinned to this project's usual R reference.
//
// Tolerances follow the house standard: 1e-6 on statistics, 1e-4 on p-values.

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { ljungBoxTest, normalityTest } from "../SampleTests.js";

const here = dirname(fileURLToPath(import.meta.url));
const bench = JSON.parse(readFileSync(join(here, "portmanteauBenchmarks.json"), "utf8"));

const TOL_STAT = 1e-6;
const TOL_P    = 1e-4;

let pass = 0;
const failures = [];

function check(label, got, want, tol) {
  const ok = Number.isFinite(got) && Math.abs(got - want) <= tol;
  if (ok) pass++;
  else failures.push(`${label}: got ${got}, want ${want} (Δ ${Math.abs(got - want).toExponential(2)} > ${tol})`);
}

for (const c of bench.cases) {
  const values = bench.series[c.series];
  const tag = `${c.series}/${c.transform}`;

  if (c.test === "jarque-bera") {
    const r = normalityTest(values, { transform: c.transform });
    if (r.error) { failures.push(`${tag} JB: ${r.error}`); continue; }
    check(`${tag} JB stat`, r.stat, c.stat, TOL_STAT);
    check(`${tag} JB p`,    r.pValue, c.pValue, TOL_P);
    check(`${tag} skew`,    r.skewness, c.skewness, TOL_STAT);
    // scipy reports EXCESS kurtosis via stats.kurtosis (fisher=True), same as ours.
    check(`${tag} kurt`,    r.kurtosis, c.kurtosis, TOL_STAT);
    continue;
  }

  const r = ljungBoxTest(values, { lags: c.lags, type: c.type, transform: c.transform });
  if (r.error) { failures.push(`${tag} ${c.type}(${c.lags}): ${r.error}`); continue; }
  check(`${tag} ${c.type}(${c.lags}) stat`, r.stat, c.stat, TOL_STAT);
  check(`${tag} ${c.type}(${c.lags}) p`,    r.pValue, c.pValue, TOL_P);
  check(`${tag} ${c.type}(${c.lags}) df`,   r.df, c.df, 0);
}

// ── Guards: the contract, not the arithmetic ─────────────────────────────────
const guards = [
  ["missing values are dropped, not read as zeros",
   () => {
     const withNa = [1, 2, null, 3, "", 4, undefined, 5, 6, 7, 8];
     const clean  = [1, 2, 3, 4, 5, 6, 7, 8];
     const a = ljungBoxTest(withNa, { lags: 3 });
     const b = ljungBoxTest(clean,  { lags: 3 });
     return a.n === 8 && a.nDropped === 3 && Math.abs(a.stat - b.stat) < 1e-12;
   }],
  ["df below 1 is refused rather than returning a number",
   () => !!ljungBoxTest([1,2,3,4,5,6,7,8,9,10], { lags: 2, fitdf: 2 }).error],
  ["lags ≥ n is refused",
   () => !!ljungBoxTest([1,2,3,4,5,6], { lags: 6 }).error],
  ["fitdf shifts df and the p-value, nothing else",
   () => {
     const x = bench.series.ar1_phi06_n120;
     const a = ljungBoxTest(x, { lags: 10 });
     const b = ljungBoxTest(x, { lags: 10, fitdf: 2 });
     return a.df === 10 && b.df === 8 && Math.abs(a.stat - b.stat) < 1e-12 && b.pValue < a.pValue;
   }],
  ["|x| and x² are genuinely different tests on the same series",
   () => {
     const x = bench.series.garchish_n300;
     const raw = ljungBoxTest(x, { lags: 10 });
     const sq  = ljungBoxTest(x, { lags: 10, transform: "square" });
     return sq.stat > raw.stat;   // volatility clustering: squares are autocorrelated
   }],
  ["a constant series is refused, not reported as white noise",
   () => {
     const r = ljungBoxTest(Array(50).fill(3), { lags: 5 });
     return !!r.error || !Number.isFinite(r.stat);
   }],
  ["Jarque-Bera needs 8 observations",
   () => !!normalityTest([1,2,3,4,5,6,7]).error],
];

for (const [label, fn] of guards) {
  let ok = false;
  try { ok = !!fn(); } catch (e) { failures.push(`guard "${label}" threw: ${e.message}`); continue; }
  if (ok) pass++;
  else failures.push(`guard failed: ${label}`);
}

console.log(`\nportmanteau validation — source: ${bench.meta.source}`);
console.log(`${pass} checks passed, ${failures.length} failed`);
if (failures.length) {
  for (const f of failures) console.log("  ✗ " + f);
  process.exit(1);
}
console.log("✓ all green");
