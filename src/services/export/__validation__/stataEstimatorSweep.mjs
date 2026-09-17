// ─── ECON STUDIO · stataEstimatorSweep.mjs ───────────────────────────────────
// LIVE check: for every estimator, estimate in Litux (the app's own
// dispatchEstimation), export the do-file exactly as the Code panel does, run
// it in real Stata and compare coefficients and SEs. Needs StataNow on this
// machine; skips cleanly otherwise. Run it:
//   node src/services/export/__validation__/stataEstimatorSweep.mjs [caseRegex]
//
// Tolerances: coef 1e-6, SE 1e-4 relative. The node-only pin of what this
// found is stataEstimatorExportValidation.mjs. KNOWN lists the gaps that are
// understood and documented rather than silently tolerated; SKIP_IF_MISSING
// the ones that need an ssc package this machine does not have.

import { writeFileSync, readFileSync, existsSync, rmSync, mkdirSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { dispatchEstimation } from "../../../components/modeling/runners/estimationDispatch.js";
import { generateStataScript } from "../stataScript.js";
import { exportSpecExtras } from "../exportSpecExtras.js";
import { buildSweepRows, rowsToCsv } from "./stataSweepFixture.mjs";

const STATA = process.env.STATA_EXE ?? "C:/Program Files/StataNow19/StataSE-64.exe";
if (!existsSync(STATA)) { console.log(`stataEstimatorSweep: SKIPPED (no Stata at ${STATA})`); process.exit(0); }
const ONLY = process.argv[2] ? new RegExp(process.argv[2]) : null;
const DIR  = join(tmpdir(), "litux-stata-sweep");
mkdirSync(DIR, { recursive: true });
const rows = buildSweepRows();
writeFileSync(join(DIR, "fx.csv"), rowsToCsv(rows));

// Understood differences. Each is a convention question, not an export bug.
const KNOWN = {
  // runWLS / runSharpRDD / runFuzzyRDD use the UNWEIGHTED SSR for σ²; R lm(weights=)
  // and Stata [aw] use the weighted one. HC SEs agree exactly.
  wls: "classical σ² convention (unweighted SSR)",
  rdd_tri: "classical σ² convention (unweighted SSR)",
  fuzzy_rdd: "classical σ² convention + delta-method LATE SE",
  // LATE SE is a delta method without the reduced-form/first-stage covariance.
  fuzzy_rdd_hc1: "delta-method LATE SE omits the cross covariance",
  // Panel HC1/cluster small-sample K excludes FE levels; fixest and reghdfe count
  // every FE not nested in the cluster. Litux's own LSDV HC1 matches Stata.
  fe_hc1: "panel robust K excludes FE levels",
  twfe_hc1: "panel robust K excludes FE levels",
  twfe_cluster: "panel cluster K excludes non-nested FE levels",
  fe2_cluster: "panel cluster K excludes non-nested FE levels",
  eventstudy_w2: "panel cluster K excludes non-nested FE levels",
  // Stata's robust VCE for poisson scales by n/(n-1); Litux (and sandwich) by n/(n-k).
  poisson_hc1: "poisson robust scaling n/(n-1) vs n/(n-k)",
};
const SKIP_IF_MISSING = { rdrobust: ["rdd_", "fuzzy_"], csdid: ["callaway"] };

const base = {
  xVars: [], wVars: [], zVars: [], factorVars: new Set(), factorRefs: {}, interactionTerms: [],
  family: "linear", weightVar: [], postVar: [], treatVar: [], runningVar: [], treatTimeCol: [],
  panel: { entityCol: "id", timeCol: "t" }, feCols: null, cutoff: "0", bwMode: "manual", bwManual: "0.5",
  kernel: "triangular", polyOrder: 1, poissonExtraFE: [],
};
const se = (seType, clusterVar = null) =>
  ({ seType, clusterVar, seOpts: { seType, clusterVar, clusterVar2: null, timeVar: "t", maxLag: null } });
const XX = { yVar: ["y"], xVars: ["x", "x2"] };
const IV = { yVar: ["y"], xVars: ["d"], wVars: ["x"], zVars: ["z1", "z2"] };
const STR = { panel: { entityCol: "ids", timeCol: "t" } };
const cases = [
  ["ols_classical", { model: "OLS", ...XX, ...se("classical") }],
  ["ols_hc1",       { model: "OLS", ...XX, ...se("HC1") }],
  ["ols_hc3",       { model: "OLS", ...XX, ...se("HC3") }],
  ["ols_cluster",   { model: "OLS", ...XX, ...se("clustered", "cl") }],
  ["wls",           { model: "OLS", ...XX, weightVar: ["w"], ...se("classical") }],
  ["wls_hc1",       { model: "OLS", ...XX, weightVar: ["w"], ...se("HC1") }],
  ["fe_1way",       { model: "FE", ...XX, ...se("classical") }],
  ["fe_cluster",    { model: "FE", ...XX, ...se("clustered", "id") }],
  ["fe_hc1",        { model: "FE", ...XX, ...se("HC1") }],
  ["fe_2way",       { model: "FE", ...XX, feCols: ["id", "t"], ...se("classical") }],
  ["fe2_cluster",   { model: "FE", ...XX, feCols: ["id", "t"], ...se("clustered", "id") }],
  ["fe_stringid",   { model: "FE", ...XX, ...STR, ...se("classical") }],
  ["fe_string_cl",  { model: "FE", ...XX, ...STR, ...se("clustered", "ids") }],
  ["fd",            { model: "FD", ...XX, ...se("classical") }],
  ["fd_hc1",        { model: "FD", ...XX, ...se("HC1") }],
  ["fd_cluster",    { model: "FD", ...XX, ...se("clustered", "id") }],
  ["iv_2sls",       { model: "2SLS", ...IV, ...se("classical") }],
  ["iv_2sls_hc1",   { model: "2SLS", ...IV, ...se("HC1") }],
  ["iv_cluster",    { model: "2SLS", ...IV, ...se("clustered", "cl") }],
  ["gmm",           { model: "GMM", ...IV, ...se("classical") }],
  ["gmm_hc1",       { model: "GMM", ...IV, ...se("HC1") }],
  ["liml",          { model: "LIML", ...IV, ...se("classical") }],
  ["liml_hc1",      { model: "LIML", ...IV, ...se("HC1") }],
  ["did",           { model: "DiD", yVar: ["y"], postVar: ["post"], treatVar: ["treat"], ...se("classical") }],
  ["twfe",          { model: "TWFE", yVar: ["y"], treatVar: ["D"], ...se("classical") }],
  ["twfe_hc1",      { model: "TWFE", yVar: ["y"], treatVar: ["D"], ...se("HC1") }],
  ["twfe_cluster",  { model: "TWFE", yVar: ["y"], treatVar: ["D"], ...se("clustered", "id") }],
  ["twfe_string",   { model: "TWFE", yVar: ["y"], treatVar: ["D"], ...STR, ...se("classical") }],
  ["lsdv_1way",     { model: "LSDV", ...XX, feCols: ["id"], ...se("classical") }],
  ["lsdv_hc1",      { model: "LSDV", ...XX, feCols: ["id"], ...se("HC1") }],
  ["lsdv_2way",     { model: "LSDV", ...XX, feCols: ["id", "t"], ...se("classical") }],
  ["lsdv_string",   { model: "LSDV", ...XX, ...STR, feCols: ["ids"], ...se("classical") }],
  ["logit",         { model: "OLS", family: "logit",  yVar: ["yb"], xVars: ["x", "x2"], ...se("classical") }],
  ["probit",        { model: "OLS", family: "probit", yVar: ["yb"], xVars: ["x", "x2"], ...se("classical") }],
  ["poisson",       { model: "OLS", family: "poisson", yVar: ["yc"], xVars: ["x", "x2"], ...se("classical") }],
  ["poisson_hc1",   { model: "OLS", family: "poisson", yVar: ["yc"], xVars: ["x", "x2"], ...se("HC1") }],
  ["rdd_tri",       { model: "RDD", yVar: ["y"], runningVar: ["run"], ...se("classical") }],
  ["rdd_tri_hc1",   { model: "RDD", yVar: ["y"], runningVar: ["run"], ...se("HC1") }],
  ["rdd_uni",       { model: "RDD", yVar: ["y"], runningVar: ["run"], kernel: "uniform", ...se("classical") }],
  ["fuzzy_rdd",     { model: "FuzzyRDD", yVar: ["y"], runningVar: ["run"], treatVar: ["take"], ...se("classical") }],
  ["fuzzy_rdd_hc1", { model: "FuzzyRDD", yVar: ["y"], runningVar: ["run"], treatVar: ["take"], ...se("HC1") }],
  ["eventstudy",    { model: "EventStudy", yVar: ["y"], treatTimeCol: ["gev"], kPre: 3, kPost: 3, ...se("classical") }],
  ["eventstudy_w2", { model: "EventStudy", yVar: ["y"], wVars: ["x"], treatTimeCol: ["gev"], kPre: 2, kPost: 2, ...se("clustered", "id") }],
  ["callaway",      { model: "CallawayCS", yVar: ["y"], csTreatCol: ["g"], csEntityCol: ["id"], csTimeCol: ["t"],
                      csCompGroup: "nevertreated", csEstMethod: "dr", csInfMethod: "analytic", csXCols: [], ...se("classical") }],
];

// The same config CodeEditor.buildScript builds.
function exportConfig(result, spec) {
  return {
    filename: "fx.csv",
    model: {
      ...exportSpecExtras({ ...result, spec }),
      type: result.type ?? "OLS",
      yVar: spec.yVar ?? "", xVars: spec.xVars ?? [], wVars: spec.wVars ?? [], zVars: spec.zVars ?? [],
      entityCol: spec.entityCol ?? null, timeCol: spec.timeCol ?? null,
      postVar: spec.postVar ?? null, treatVar: spec.treatVar ?? null,
      runningVar: spec.runningVar ?? null, cutoff: spec.cutoff ?? null, bandwidth: spec.bandwidth ?? null,
      kernel: spec.kernel ?? "triangular",
      factorVars: spec.factorVars ?? [], factorRefs: spec.factorRefs ?? {}, factorMap: result.factorMap ?? null,
      interactionTerms: spec.interactionTerms ?? [], xVarsRaw: spec.xVarsRaw ?? null, wVarsRaw: spec.wVarsRaw ?? null,
      seType: spec.seType ?? "classical", clusterVar: spec.clusterVar ?? null, clusterVar2: null,
      noIntercept: spec.noIntercept ?? false,
    },
  };
}

// Writes e(b) and the SEs right after the estimation command.
const DUMP = (name) => `
capture noisily {
  matrix __b = e(b)
  matrix __V = e(V)
  local __n : colfullnames __b
  file open __f using "${name}.out", write replace
  local __i 0
  foreach __c of local __n {
    local ++__i
    file write __f "\`__c'," %24.0g (__b[1,\`__i']) "," %24.0g (sqrt(__V[\`__i',\`__i'])) _n
  }
  file close __f
}`;
const ALIAS = { "Post": "post", "Treated": "treat", "Post × Treated (ATT)": "did", "Treatment (ATT)": "D",
  "D (treatment)": "_above", "run − c": "_run_c", "D × (run − c)": "_above_run",
  "take (LATE)": "take", "Z × (run − c)": "_Z_run" };
const stataName = (n) => /^\(intercept\)$/i.test(n) ? "_cons"
  : ALIAS[n] ?? n.replace(/^__ev_k_/, "ev_").replace(/^__ev_/, "ev_");
const EST = /^(reg|xtreg|reghdfe|areg|ivregress|logit|probit|glm|poisson|ppmlhdfe|nbreg|rdrobust|csdid)\b/;
// The within/absorbed estimators' intercept is a normalisation, not a parameter
// both sides define the same way; the unit:/time: rows are LSDV's own dummies.
const skipCoef = (type, vn) => (/^(TWFE|EventStudy|LSDV)$/.test(type) && /^\(intercept\)$/i.test(vn))
  || /^(unit|time):/.test(vn);

let fails = 0, known = 0, skipped = 0, ok = 0;
for (const [name, c] of cases) {
  if (ONLY && !ONLY.test(name)) continue;
  const ctx = { ...base, ...c, panel: c.panel ?? base.panel };
  const d = dispatchEstimation(rows, ctx);
  if (d.error) { console.log(`FAIL ${name}: Litux error ${d.error}`); fails++; continue; }
  const r = d.result.type === "FE" ? d.panelFE : d.result.type === "FD" ? d.panelFD : d.result;
  const spec = { ...(r.spec ?? {}), seType: ctx.seType, clusterVar: ctx.clusterVar };
  const lines = generateStataScript(exportConfig({ ...d.result, windowPre: r.windowPre, windowPost: r.windowPost }, spec)).split("\n");
  const hits = lines.map((l, j) => (EST.test(l) ? j : -1)).filter(j => j >= 0);
  // RDD blocks lead with rdrobust; the engine-equivalent regression is the last command.
  const at = /RDD/.test(d.result.type) ? hits[hits.length - 1] : hits[0];
  if (at == null) { console.log(`FAIL ${name}: no estimation command emitted`); fails++; continue; }
  lines.splice(at + 1, 0, DUMP(name));
  for (const f of [`${name}.out`, `${name}.log`]) rmSync(join(DIR, f), { force: true });
  writeFileSync(join(DIR, `${name}.do`), lines.join("\n").replace(/^(rdrobust|csdid)\b/gm, "capture noisily $1"));
  try { execFileSync(STATA, ["/e", "do", `${name}.do`], { cwd: DIR, stdio: "ignore", timeout: 180000 }); } catch { /* read the log */ }
  const log = existsSync(join(DIR, `${name}.log`)) ? readFileSync(join(DIR, `${name}.log`), "utf8") : "";
  const missingPkg = Object.entries(SKIP_IF_MISSING).find(([pkg, pre]) =>
    pre.some(p => name.startsWith(p)) && new RegExp(`command ${pkg} is unrecognized`).test(log));
  if (missingPkg) { console.log(`skip ${name}: ssc install ${missingPkg[0]}`); skipped++; if (!/RDD/.test(d.result.type)) continue; }
  const rc = [...log.matchAll(/^r\((\d+)\);/gm)].map(m => m[1]);
  const st = {};
  if (existsSync(join(DIR, `${name}.out`))) {
    for (const l of readFileSync(join(DIR, `${name}.out`), "utf8").trim().split("\n")) {
      const [n, b, e] = l.split(",");
      st[n.trim().replace(/^[^:]+:/, "").replace(/^D\./, "")] = { b: +b, se: +e };
    }
  }
  const bad = [];
  if (rc.length && !missingPkg) bad.push(`Stata r(${rc.join(",")})`);
  (r.varNames ?? []).forEach((vn, i) => {
    if (skipCoef(d.result.type, vn)) return;
    const h = st[stataName(vn)];
    if (!h) { bad.push(`${vn} missing in Stata`); return; }
    if (Math.abs(h.b - r.beta[i]) > 1e-6) bad.push(`${vn} b ${r.beta[i]} vs ${h.b}`);
    if (Math.abs(h.se - r.se[i]) > 1e-4 * Math.max(1, Math.abs(h.se))) bad.push(`${vn} se ${r.se[i]} vs ${h.se}`);
  });
  const onlySE = bad.length && bad.every(b => / se /.test(b));
  if (!bad.length) { ok++; console.log(`ok   ${name}`); }
  else if (onlySE && KNOWN[name]) { known++; console.log(`known ${name}: ${KNOWN[name]}`); }
  else { fails++; console.log(`FAIL ${name}\n       ${bad.join("\n       ")}`); }
}
console.log(`\nstataEstimatorSweep: ${ok} ok, ${known} known gaps, ${skipped} skipped, ${fails} failed  (do-files in ${DIR})`);
if (fails) process.exitCode = 1;
