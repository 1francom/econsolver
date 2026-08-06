// src/math/__validation__/factorExpansionValidation.js
// Validates the applyFactors() fix in components/modeling/helpers.js:
//   Bug 1 — numeric factor levels must sort numerically (Year 9/10/11), not
//           lexicographically ("10","11","9").
//   Bug 2 — NA in a factor column must trigger listwise deletion, not silently
//           fold the row into the reference category.
// Run with: node src/math/__validation__/factorExpansionValidation.js
//
// R comparison: factorExpansionRValidation.R → factorExpansionBenchmarks.json
// (R 4.4.1 lm(), stamped meta.source — not circular). Tolerance: 1e-6 coef, 1e-4 SE.

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { applyFactors, sortFactorLevels } from "../../components/modeling/helpers.js";
import { runOLS } from "../LinearEngine.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
function assert(cond, msg) { if (!cond) throw new Error(`FAIL: ${msg}`); console.log(`  ok — ${msg}`); }

// ── Behavior fixed by Bug 1/2, in isolation (no CSV/R needed) ────────────────

console.log("Test 1: numeric levels [9,10,11] sort numerically → reference is 9, dummies are _10/_11");
{
  const rows = [{ y: 1, year: 9 }, { y: 2, year: 10 }, { y: 3, year: 11 }];
  const { rows: er, vars } = applyFactors(rows, ["year"], new Set(["year"]));
  assert(vars.length === 2 && vars.includes("year_10") && vars.includes("year_11"),
    `dummies are year_10/year_11, got ${JSON.stringify(vars)}`);
  assert(er[0].year_10 === 0 && er[0].year_11 === 0, "row with year=9 (reference) has both dummies 0");
  assert(er[1].year_10 === 1 && er[1].year_11 === 0, "row with year=10 has year_10=1");
  assert(er[2].year_10 === 0 && er[2].year_11 === 1, "row with year=11 has year_11=1");
}

console.log("Test 2: string levels ['9','10','11'] stay lexicographic (matches R factor() on character) — documented, not 'fixed'");
{
  const levels = sortFactorLevels(["9", "10", "11"]);
  assert(JSON.stringify(levels) === JSON.stringify(["10", "11", "9"]),
    `lexicographic order expected: ${JSON.stringify(levels)}`);
}

console.log("Test 3: a row with factor=null is excluded from the estimated sample (listwise deletion)");
{
  const rows = [
    { y: 1, x: 1, g: "A" },
    { y: 2, x: 2, g: "B" },
    { y: 3, x: 3, g: null },   // should be dropped entirely
    { y: 4, x: 4, g: "A" },
    { y: 5, x: 5, g: "B" },
  ];
  const { rows: er, vars } = applyFactors(rows, ["x", "g"], new Set(["g"]));
  const withNA = runOLS(er, "y", vars);
  const withoutRow = rows.filter(r => r.g != null);
  const { rows: er2, vars: vars2 } = applyFactors(withoutRow, ["x", "g"], new Set(["g"]));
  const withoutNA = runOLS(er2, "y", vars2);
  assert(withNA.n === 4, `n=${withNA.n} should be 4 (5 rows minus 1 NA)`);
  assert(withNA.n === withoutNA.n, "n matches the manually-pre-filtered run");
  withNA.beta.forEach((b, i) => {
    assert(Math.abs(b - withoutNA.beta[i]) < 1e-9, `coef[${i}] matches manually-pre-filtered run (${b} vs ${withoutNA.beta[i]})`);
  });
}

// ── R comparison on a real fixture (numeric multi-digit factor + NA factor) ──

console.log("Test 4: vs R lm() on factorExpansionFixture.csv (year: numeric 9/10/11, grader: string with NA)");
{
  const csv = readFileSync(join(__dirname, "factorExpansionFixture.csv"), "utf8").trim().split("\n");
  const header = csv[0].split(",");
  const rows = csv.slice(1).map(line => {
    const cells = line.split(",");
    const r = {};
    header.forEach((h, i) => { r[h] = cells[i]; });
    return {
      id: Number(r.id), y: Number(r.y), x1: Number(r.x1),
      year: Number(r.year), grader: r.grader === "" ? null : r.grader,
    };
  });

  const bench = JSON.parse(readFileSync(join(__dirname, "factorExpansionBenchmarks.json"), "utf8"));
  assert(bench.meta.source.startsWith("R "), "benchmarks are R-sourced, not engine-self-generated (meta.source check)");

  const { rows: er, vars } = applyFactors(rows, ["x1", "year", "grader"], new Set(["year", "grader"]));
  const res = runOLS(er, "y", vars);

  assert(res.n === bench.n, `n=${res.n} matches R's post-na.action n=${bench.n}`);
  assert(rows.length - res.n === bench.nDroppedNA, `dropped ${rows.length - res.n} rows, R dropped ${bench.nDroppedNA}`);

  // varNames[0] is "(Intercept)"; vars/beta line up after that.
  const rNames = ["(Intercept)", "x1", "factor(year)10", "factor(year)11", "factor(grader)B", "factor(grader)C"];
  const litNames = ["(Intercept)", ...vars];
  assert(JSON.stringify(litNames) === JSON.stringify(["(Intercept)", "x1", "year_10", "year_11", "grader_B", "grader_C"]),
    `param order/names: ${JSON.stringify(litNames)}`);

  rNames.forEach((rName, i) => {
    const rCoef = bench.coefficients[rName];
    const rSE   = bench.se[rName];
    const litCoef = res.beta[i];
    const litSE   = res.se[i];
    assert(Math.abs(litCoef - rCoef) < 1e-6, `coef[${rName}]: R=${rCoef} Litux=${litCoef}`);
    assert(Math.abs(litSE - rSE) < 1e-4, `SE[${rName}]: R=${rSE} Litux=${litSE}`);
  });
}

console.log("\nAll factor-expansion checks passed (Bug 1 + Bug 2 fixed, validated against R 4.4.1 lm()).");
