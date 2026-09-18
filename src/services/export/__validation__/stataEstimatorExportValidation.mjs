// ─── ECON STUDIO · stataEstimatorExportValidation.mjs ────────────────────────
// Pins the estimator export fixes found by running every exported do-file in
// StataNow 19.5 (2026-09-17, stataEstimatorSweep.mjs). Node only — no Stata
// needed. Run it:
//   node src/services/export/__validation__/stataEstimatorExportValidation.mjs
//
// Every E-check below guards an emission that, before the fix, either died in
// Stata or ran and fitted a different model. The M-checks pin the GMM/LIML
// engine SEs against values computed independently: Stata (`ivregress`) and
// the same k-class / GMM sandwich coded by hand in R, which agree with each
// other and with these to ≤3e-8 (LIML HC1 vs Stata: 2e-6).

import assert from "node:assert/strict";
import { generateStataScript } from "../stataScript.js";
import { generateRScript } from "../rScript.js";
import { generatePythonScript } from "../pythonScript.js";
import { buildStataLoadLine } from "../loadLine.js";
import { exportSpecExtras } from "../exportSpecExtras.js";
import { runGMM, runLIML, runEventStudyMulti } from "../../../math/index.js";
import { buildSweepRows } from "./stataSweepFixture.mjs";

let pass = 0;
const check = (name, fn) => {
  try { fn(); pass++; console.log(`  ok   ${name}`); }
  catch (e) { console.error(`  FAIL ${name}\n       ${e.message}`); process.exitCode = 1; }
};
const st = (model) => generateStataScript({ filename: "fx.csv", model });
const iv = (type, seType = "classical") =>
  ({ type, yVar: "y", xVars: ["d"], wVars: ["x"], zVars: ["z1", "z2"], seType });

check("E1 CSV import keeps case and double precision", () => {
  // Default import lowercases names: a column D became d and the model line died r(111).
  assert.match(buildStataLoadLine("fx.csv"), /case\(preserve\) asdouble clear$/m);
  assert.match(buildStataLoadLine("fx.tsv"), /delimiter\(tab\) case\(preserve\) asdouble clear$/m);
});

check("E2 WLS keeps its weights end to end", () => {
  const result = { type: "WLS", spec: { yVar: "y", xVars: ["x"], weightCol: "w" } };
  const model = { ...exportSpecExtras(result), type: "WLS", yVar: "y", xVars: ["x"] };
  assert.equal(model.weightCol, "w");
  assert.match(st(model), /^reg y x \[aw=w\]$/m);
  assert.doesNotMatch(st(model), /falling back to OLS/);
  assert.match(generatePythonScript({ filename: "fx.csv", model }), /smf\.wls\(.*weights=df\["w"\]/);
});

check("E3 FD is an OLS on D., not xtreg's nonexistent fd option", () => {
  const s = st({ type: "FD", yVar: "y", xVars: ["x", "x2"], entityCol: "id", timeCol: "t" });
  assert.match(s, /^reg D\.\(y x x2\)$/m);
  assert.doesNotMatch(s, /, fd\b/, "xtreg y x, fd is r(198)");
});

check("E4 a string panel id is mapped to a numeric one at runtime", () => {
  const s = st({ type: "FE", yVar: "y", xVars: ["x"], entityCol: "ids", timeCol: "t" });
  assert.match(s, /^capture confirm numeric variable ids$/m);
  assert.match(s, /egen long _pid = group\(ids\)/);
  assert.doesNotMatch(s, /^xtset ids t$/m, "xtset on a string is r(109)");
});

check("E5 2SLS / LIML report n-k small-sample inference", () => {
  assert.match(st(iv("2SLS")), /^ivregress 2sls y \(d = z1 z2\) x, small$/m);
  assert.match(st(iv("LIML")), /^ivregress liml y x \(d = z1 z2\), small$/m);
  // bare `robust small` crashes StataNow's LIML table (Mata r(1))
  assert.match(st(iv("LIML", "HC1")), /^ivregress liml y x \(d = z1 z2\), vce\(robust\) small$/m);
});

check("E6 GMM instruments X (endogenous), keeps W exogenous, robust weights", () => {
  assert.match(st(iv("GMM")), /^ivregress gmm y x \(d = z1 z2\), wmatrix\(robust\) vce\(unadjusted\)$/m);
  assert.match(st(iv("GMM", "HC1")), /^ivregress gmm y x \(d = z1 z2\), wmatrix\(robust\) vce\(robust\) small$/m);
});

check("E7 R and Python GMM/LIML use the same roles", () => {
  const r = generateRScript({ filename: "fx.csv", model: iv("GMM") });
  assert.match(r, /gmm::gmm\(y ~ x \+ d,\n  ~ x \+ z1 \+ z2,/);
  assert.match(r, /vcov = "MDS"/, `"iid" weights make gmm::gmm a 2SLS`);
  assert.match(generateRScript({ filename: "fx.csv", model: iv("LIML") }), /ivreg\(y ~ x \+ d \| x \+ z1 \+ z2,/);
  for (const t of ["GMM", "LIML"]) {
    const p = generatePythonScript({ filename: "fx.csv", model: iv(t) });
    assert.match(p, /exog_vars  = sm\.add_constant\(df\[\["x"\]\]\)/);
    assert.match(p, /endog_vars = df\[\["d"\]\]/);
    assert.match(p, /instr_vars = df\[\["z1", "z2"\]\]/);
  }
});

check("E8 Event Study builds the app's design, not ib(-1).", () => {
  const s = st({ type: "EventStudy", yVar: "y", entityCol: "id", timeCol: "t",
                 treatTimeCol: "gev", windowPre: 2, windowPost: 1 });
  assert.match(s, /^gen double _k = t - gev if !missing\(gev\)$/m);
  assert.match(s, /^gen byte ev_post_bin = \(_k > 1\) & !missing\(_k\)$/m);
  assert.match(s, /^reghdfe y ev_m2 ev_p0 ev_p1 ev_pre_bin ev_post_bin, absorb\(id t\)$/m);
  assert.doesNotMatch(s, /ib\(-1\)/, "factor variables cannot be negative — r(452)");
  assert.doesNotMatch(s, /treat_time/);
});

check("E9 Probit SEs come from the expected information, like the engine", () => {
  assert.match(st({ type: "Probit", yVar: "yb", xVars: ["x"] }),
    /^glm yb x, family\(binomial\) link\(probit\) vce\(eim\)$/m);
});

check("E10 classical Poisson is not silently made robust", () => {
  assert.match(st({ type: "Poisson", yVar: "yc", xVars: ["x"] }), /^poisson yc x, irr$/m);
});

check("E11 csdid is one command with gvar normalised to 0", () => {
  const s = st({ type: "CallawayCS", yVar: "y", entityCol: "id", timeCol: "t", treatCol: "g" });
  assert.match(s, /^csdid y, ivar\(id\) time\(t\) gvar\(_gvar\) method\(dripw\)$/m);
  assert.match(s, /^gen double _gvar = cond\(missing\(g\), 0, g\)$/m);
});

check("E12 HC on a panel never goes through xtreg, and never as bare robust", () => {
  const fe = st({ type: "FE", yVar: "y", xVars: ["x"], entityCol: "id", timeCol: "t", seType: "HC1" });
  assert.match(fe, /^reghdfe y x, absorb\(id\) vce\(robust\)$/m);
  assert.doesNotMatch(fe, /^xtreg /m, "xtreg turns robust into a panel cluster");
  const tw = st({ type: "TWFE", yVar: "y", treatVar: "D", entityCol: "id", timeCol: "t", seType: "HC1" });
  assert.doesNotMatch(tw, /\) robust$/m, "reghdfe rejects bare robust with r(198)");
  const lsdv = st({ type: "LSDV", yVar: "y", xVars: ["x"], entityCol: "id", timeCol: "t", feCols: ["id"], seType: "HC1" });
  assert.doesNotMatch(lsdv, /^xtreg /m);
  assert.match(lsdv, /^areg y x, absorb\(`_pid'\) vce\(robust\)$/m);
});

check("E13 RDD kernels are rdrobust's, and the manual weights follow them", () => {
  const s = st({ type: "RDD", yVar: "y", runningVar: "run", cutoff: 0, bandwidth: 0.5, kernel: "uniform" });
  assert.match(s, /kernel\(uniform\)/);
  assert.doesNotMatch(s, /nw\(/);
  assert.match(s, /^gen double _w = 1 if abs\(_run_c\) <= 0\.5$/m);
  const f = st({ type: "FuzzyRDD", yVar: "y", runningVar: "run", treatVar: "take", cutoff: 0, bandwidth: 0.5 });
  assert.match(f, /^ivregress 2sls y _run_c _Z_run \(take = _Z\) \[aw=_w\], small$/m);
});

// ── Engine: GMM / LIML sandwich and the Event Study df ─────────────────────
const rows = buildSweepRows();
const close = (a, b, tol, what) =>
  assert.ok(Math.abs(a - b) <= tol, `${what}: ${a} vs ${b} (tol ${tol})`);

check("M1 GMM HC1 is the GMM sandwich (was 1.90 on the intercept)", () => {
  const se = runGMM(rows, "y", ["d"], ["x"], ["z1", "z2"], { seType: "HC1" }).se;
  // Stata: ivregress gmm, wmatrix(robust) vce(robust) small
  [0.16873305, 0.14562196, 0.17657984].forEach((v, i) => close(se[i], v, 1e-7, `se[${i}]`));
});

check("M2 LIML classical uses the k-class bread", () => {
  const se = runLIML(rows, "y", ["d"], ["x"], ["z1", "z2"], {}).se;
  // Stata: ivregress liml, small  /  R: s2 * solve(t(X - k*MZ%*%X) %*% X)
  close(se[2], 0.1758709, 1e-7, "se[d]");
});

check("M3 LIML HC1 uses k-class scores (was 0.275 on the endogenous regressor)", () => {
  const se = runLIML(rows, "y", ["d"], ["x"], ["z1", "z2"], { seType: "HC1" }).se;
  close(se[2], 0.1769078, 1e-7, "se[d] vs R");
  close(se[2], 0.17690563, 5e-6, "se[d] vs Stata vce(robust) small");
});

check("M4 Event Study df does not count the intercept twice", () => {
  const es = runEventStudyMulti(rows, "y", "id", "t", "gev", 3, 3, [], ["id", "t"], {});
  assert.equal(es.df, 343, "fixest and reghdfe: n - (Lu+Lt-1) - regressors = 343");
  close(es.se[1], 1.471861554, 1e-8, "se[ev_m3] vs fixest");
});

console.log(`\nstataEstimatorExport: ${pass} checks passed${process.exitCode ? " (with failures)" : ""}`);
