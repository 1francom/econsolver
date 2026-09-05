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

// ── Custom reference category (2026-08-16 feature) vs R relevel() ────────────

console.log("Test 5: custom reference (year ref=10) vs R lm(relevel(factor(year), ref='10'))");
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
  const customRef = bench.customRef;
  assert(customRef != null, "benchmarks.json has a customRef block (re-run factorExpansionRValidation.R if missing)");

  const { rows: er, vars } = applyFactors(rows, ["x1", "year", "grader"], new Set(["year", "grader"]), { year: "10" });
  const res = runOLS(er, "y", vars);

  // Dummy naming: ref=10 means levels reorder to [10,9,11], drop first (10) →
  // dummies for 9 and 11 — year_9/year_11, NOT year_10/year_11.
  const litNames = ["(Intercept)", ...vars];
  assert(JSON.stringify(litNames) === JSON.stringify(["(Intercept)", "x1", "year_9", "year_11", "grader_B", "grader_C"]),
    `param order/names with custom ref: ${JSON.stringify(litNames)}`);

  const rNames = ["(Intercept)", "x1", `relevel(factor(year), ref = "10")9`, `relevel(factor(year), ref = "10")11`, "factor(grader)B", "factor(grader)C"];
  rNames.forEach((rName, i) => {
    const rCoef = customRef.coefficients[rName];
    const rSE   = customRef.se[rName];
    assert(Math.abs(res.beta[i] - rCoef) < 1e-6, `coef[${rName}]: R=${rCoef} Litux=${res.beta[i]}`);
    assert(Math.abs(res.se[i] - rSE) < 1e-4, `SE[${rName}]: R=${rSE} Litux=${res.se[i]}`);
  });

  // Reference choice is a reparameterization: x1 and grader's coefficients
  // must be BYTE-IDENTICAL (well, to the same tolerance) to the default-
  // reference model above — only the year block and the intercept move.
  const defaultRun = applyFactors(rows, ["x1", "year", "grader"], new Set(["year", "grader"]));
  const resDefault = runOLS(defaultRun.rows, "y", defaultRun.vars);
  assert(Math.abs(res.beta[1] - resDefault.beta[1]) < 1e-9, "x1 coefficient is invariant to the year reference choice");
  assert(Math.abs(res.beta[4] - resDefault.beta[4]) < 1e-9, "grader_B coefficient is invariant to the year reference choice");

  // Requesting a reference that isn't an actual level must fall back to the
  // default (first-level) behavior silently, not throw or drop the column.
  const missingRef = applyFactors(rows, ["x1", "year", "grader"], new Set(["year", "grader"]), { year: "1999" });
  assert(JSON.stringify(missingRef.vars) === JSON.stringify(defaultRun.vars),
    "an unknown reference level falls back to the default (first-level) dummy set");
}


console.log("\nTest 6: through the origin — first factor keeps every level, the rest keep a reference");
{
  const raw = readFileSync(join(__dirname, "factorExpansionFixture.csv"), "utf8").trim().split(/\r?\n/);
  const hdr = raw[0].split(",");
  const rows = raw.slice(1).map(line => {
    const p = line.split(",");
    const r = Object.fromEntries(hdr.map((h, i) => [h, p[i]]));
    return { y: Number(r.y), x1: Number(r.x1),
             year: Number(r.year), grader: r.grader === "" ? null : r.grader };
  });

  const bench = JSON.parse(readFileSync(join(__dirname, "factorExpansionBenchmarks.json"), "utf8"));
  const ni = bench.noIntercept;
  assert(ni != null, "benchmarks.json has a noIntercept block (re-run factorExpansionRValidation.R if missing)");

  // fullFirstFactor is consumed by `year` (first factor in formula order), so
  // year contributes 9/10/11 while grader still contributes only B/C.
  const { rows: er, vars, factorMap, usedFullExpansion } =
    applyFactors(rows, ["x1", "year", "grader"], new Set(["year", "grader"]), {}, { fullFirstFactor: true });
  assert(usedFullExpansion === true, "usedFullExpansion reports that the flag was consumed");
  assert(JSON.stringify(vars) === JSON.stringify(["x1", "year_9", "year_10", "year_11", "grader_B", "grader_C"]),
    "param names: year fully coded, grader on contrasts, got " + JSON.stringify(vars));
  assert(factorMap.year_9.ref === null,  "a fully-coded level carries ref === null (no omitted category)");
  assert(factorMap.grader_B.ref === "A", "the second factor still records its reference level");

  const res = runOLS(er, "y", vars, {}, { noIntercept: true });
  ni.names.forEach((rName, i) => {
    const rCoef = ni.coefficients[rName];
    const rSE   = ni.se[rName];
    assert(Math.abs(res.beta[i] - rCoef) < 1e-6, "coef[" + rName + "]: R=" + rCoef + " Litux=" + res.beta[i]);
    assert(Math.abs(res.se[i]  - rSE)   < 1e-4, "SE[" + rName + "]: R=" + rSE + " Litux=" + res.se[i]);
  });
  assert(res.df === ni.dfResidual, "residual df matches R (" + ni.dfResidual + "), got " + res.df);
  assert(vars.length === ni.nParams, "parameter count matches R (" + ni.nParams + "), got " + vars.length);

  // The regression that motivated the fix: dropping a reference from BOTH
  // factors is a DIFFERENT model, not a cosmetic relabelling. If this ever
  // stops differing, the fix above has silently become a no-op.
  const both = applyFactors(rows, ["x1", "year", "grader"], new Set(["year", "grader"]));
  const resBoth = runOLS(both.rows, "y", both.vars, {}, { noIntercept: true });
  assert(Math.abs(resBoth.beta[0] - ni.coefficients.x1) > 1e-6,
    "reference-on-both really does change x1 (guards against the fix silently no-op ing)");
}
console.log("\nAll factor-expansion checks passed (Bug 1 + Bug 2 + custom reference + through-the-origin factor coding, validated against R 4.4.1 lm()/relevel()).");
