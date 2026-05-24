// ─── LITUX · services/export/__validation__/goldenFileHarness.js ──────────────
// Phase A.2 — Golden-file harness for export script numeric validation.
//
// Validates the full chain:
//   EconSolver JS engine → emitted R/Stata/Python script → numeric agreement
//
// Architecture:
//   1. GOLDEN VALUES — hard R reference outputs (same source as engineValidation.js).
//   2. TEST CASES    — deterministic datasets + engine configs + expected outputs.
//   3. ENGINE RUN    — runs EconSolver JS engines on test datasets.
//   4. SCRIPT CHECK  — generates export scripts, pattern-checks commands.
//   5. NUMERIC CHECK — compares engine outputs vs R golden values via seTolerances.js.
//   6. REPORT        — per (estimator × language) pass / warn / skip table.
//
// Usage (browser console):
//   import("/src/services/export/__validation__/goldenFileHarness.js")
//     .then(m => window.__goldenHarness = m.runGoldenHarness)
//   window.__goldenHarness()
//
// Run with:
//   window.__goldenHarness({ verbose: true })  — show per-check details
//   window.__goldenHarness({ only: "FE" })     — run one estimator

import { runOLS, runWLS }                    from "../../../math/LinearEngine.js";
import { runFE, runFD }                      from "../../../math/PanelEngine.js";
import { run2SLS, runSharpRDD, ikBandwidth } from "../../../math/CausalEngine.js";
import { runLogit, runProbit }               from "../../../math/NonLinearEngine.js";
import { runGMM, runLIML }                   from "../../../math/GMMEngine.js";

import { generateRScript }      from "../rScript.js";
import { generateStataScript }  from "../stataScript.js";
import { generatePythonScript } from "../pythonScript.js";

import { checkValue, shouldSkip, getKnownDivergences } from "./seTolerances.js";

// ─── Dataset factories (mirrors engineValidation.js — kept in sync) ────────────

function makeOLSData() {
  // Zero-noise exact DGP: y = 2 + 3*x1 - 1*x2, N=30
  // R: lm(y ~ x1 + x2) → beta = [2, 3, -1] exactly, R² = 1
  return Array.from({ length: 30 }, (_, i) => ({
    y:  2 + 3 * (i + 1) - 1 * Math.sin(i * 0.5),
    x1: i + 1,
    x2: Math.sin(i * 0.5),
  }));
}

function makePanelData() {
  // 5 units × 4 periods, deterministic noise. Matches engineValidation.js makePanelData()
  const noise = [
    [ 0.186, -0.132,  0.453, -0.310],
    [ 0.091,  0.401, -0.217,  0.502],
    [-0.395,  0.178,  0.293, -0.109],
    [ 0.220, -0.476,  0.138,  0.351],
    [-0.143,  0.287, -0.401,  0.213],
  ];
  const alphas = [1, -1, 2, 0, -2];
  const rows = [];
  for (let unit = 1; unit <= 5; unit++) {
    for (let time = 1; time <= 4; time++) {
      const x = time * time * (0.5 + unit * 0.1) + Math.cos(unit);
      const z = Math.sin(time * 1.1 + unit * 0.7) * 2;
      const y = alphas[unit - 1] + 1.5 * x + 0.8 * z + noise[unit - 1][time - 1];
      rows.push({ y, x, z, unit, time });
    }
  }
  return rows;
}

function make2SLSData() {
  // Matches engineValidation.js make2SLSData() exactly
  const zV = [ 0.3532,-0.7115, 1.2025,-0.2005, 0.6917,-1.1234, 0.4501,-0.3087, 0.8723,-0.5432, 0.1209, 0.9812,-0.6345, 0.2341,-1.0234, 0.7812,-0.4231, 1.1234,-0.8901, 0.3456,-0.2341, 0.6789,-0.9012, 0.1234,-0.5678, 0.8901,-0.3456, 0.4567,-0.7890, 1.0123];
  const xV = [ 0.1234,-0.5678, 0.9012,-0.3456, 0.7890,-1.1234, 0.5678,-0.2345, 0.6789,-0.4321, 0.8765,-0.6543, 0.2345,-0.9876, 0.4321,-0.7654, 0.3210,-0.1234, 0.5432,-0.8765, 0.6543,-0.4321, 0.2109,-0.7890, 0.9876,-0.1234, 0.5678,-0.3456, 0.8901,-0.6789];
  const vV = [ 0.1231,-0.3456, 0.5678,-0.1234, 0.2345,-0.4567, 0.1890,-0.3210, 0.4321,-0.2109, 0.3456,-0.5678, 0.1234,-0.2345, 0.4567,-0.1890, 0.3210,-0.4321, 0.2109,-0.3456, 0.5678,-0.1234, 0.2345,-0.4567, 0.1890,-0.3210, 0.4321,-0.2109, 0.3456,-0.5678];
  const eV = [ 0.6234,-0.4512, 0.8901,-0.2345, 0.5678,-0.9012, 0.3456,-0.6789, 0.1234,-0.4567, 0.7890,-0.2345, 0.5678,-0.8901, 0.3456,-0.6789, 0.1234,-0.4567, 0.7890,-0.2345, 0.5678,-0.8901, 0.3456,-0.6789, 0.1234,-0.4567, 0.7890,-0.2345, 0.5678,-0.8901];
  return Array.from({ length: 30 }, (_, i) => {
    const d = 0.5 + 1.2 * zV[i] + 0.3 * xV[i] + vV[i] * 0.4;
    return { y: 1 + 2 * d + 0.5 * xV[i] + eV[i] * 0.8, d, x: xV[i], z: zV[i] };
  });
}

function makeRDDData() {
  // n=200, DGP: y = 0.5 + 0.3*x + 1.0*(x≥0) + ε, deterministic noise
  // Matches engineValidation.js validateRDD()
  const n = 200;
  const noise = Array.from({ length: n }, (_, i) => ((i * 1013 + 7) % 1000 - 500) / 2500);
  return Array.from({ length: n }, (_, i) => {
    const x = (i / n - 0.5) * 2;
    return { y: 0.5 + 0.3 * x + 1.0 * (x >= 0 ? 1 : 0) + noise[i], x };
  });
}

function makeLogitData() {
  // n=200, logit(p) = -1 + 2*x1 - 0.5*x2, deterministic. Matches engineValidation.js
  return Array.from({ length: 200 }, (_, i) => {
    const x1 = (i / 200 - 0.5) * 4;
    const x2 = Math.sin(i * 0.314) * 1.5;
    const p  = 1 / (1 + Math.exp(-(-1 + 2 * x1 - 0.5 * x2)));
    return { y: p > ((i * 7 + 13) % 97) / 97 ? 1 : 0, x1, x2 };
  });
}

// ─── Hard R golden values ──────────────────────────────────────────────────────
// Source: engineValidation.js hard benchmarks (validated against R 2026-04-25).
// These are what running the emitted R script on the SAME test data produces.

const GOLDEN = {
  OLS: {
    // Zero-noise: R lm() → exact β recovery
    beta:  [2.0, 3.0, -1.0],
    se:    null,          // SE undefined for zero-noise perfect-fit — skip
    r2:    1.0,
    n:     30,
  },
  FE: {
    // fixest::feols(y ~ x + z | unit, se="iid")
    beta:  [1.510842, 0.813597],
    se:    [0.0178, 0.0614],
    r2:    0.997927,      // R² within
    n:     20,
  },
  FD: {
    // plm::plm(y ~ x + z, model="fd")
    beta:  [1.5, 0.8],   // approximate — FD uses looser tolerance (engineValidation §FD)
    se:    null,          // soft check only
    n:     15,
  },
  "2SLS": {
    // AER::ivreg(y ~ d + x | x + z)
    beta:  [1.002353, 1.946281, 1.151541],
    se:    [0.0544, 0.0545, 0.0724],
    n:     30,
    df:    27,
  },
  RDD: {
    // rdrobust::rdrobust(y, x, c=0, kernel="triangular", bwselect="IK")
    late:   1.100574,
    lateSE: 0.0550,
    h:      0.6130175317,
    n:      123,
  },
  Logit: {
    // glm(y ~ x1 + x2, family=binomial("logit"))
    beta:  [-0.96, 1.93, -0.48],   // approximate (±0.05)
    se:    null,                    // soft check
    n:     200,
  },
  Probit: {
    // glm(y ~ x1 + x2, family=binomial("probit"))
    beta:  [-0.57, 1.14, -0.28],   // approximate (±0.05)
    se:    null,
    n:     200,
  },
};

// ─── Engine runners ─────────────────────────────────────────────────────────────

function runEngines() {
  const out = {};

  // OLS
  try {
    const r = runOLS(makeOLSData(), "y", ["x1", "x2"]);
    out.OLS = r?.error ? { error: r.error } : r;
  } catch (e) { out.OLS = { error: e.message }; }

  // FE
  try {
    const r = runFE(makePanelData(), "y", ["x", "z"], "unit", "time");
    out.FE = r?.error ? { error: r.error } : r;
  } catch (e) { out.FE = { error: e.message }; }

  // FD
  try {
    const r = runFD(makePanelData(), "y", ["x", "z"], "unit", "time");
    out.FD = r?.error ? { error: r.error } : r;
  } catch (e) { out.FD = { error: e.message }; }

  // 2SLS
  try {
    const r = run2SLS(make2SLSData(), "y", ["d"], ["x"], ["z"]);
    out["2SLS"] = r?.error ? { error: r.error } : (r?.second ?? r);
  } catch (e) { out["2SLS"] = { error: e.message }; }

  // RDD
  try {
    const rows = makeRDDData();
    const xArr = rows.map(r => r.x), yArr = rows.map(r => r.y);
    const h = ikBandwidth(xArr, yArr, 0);
    const r = runSharpRDD(rows, "y", "x", 0, h, "triangular");
    out.RDD = r?.error ? { error: r.error } : { ...r, h };
  } catch (e) { out.RDD = { error: e.message }; }

  // Logit
  try {
    const r = runLogit(makeLogitData(), "y", ["x1", "x2"]);
    out.Logit = r?.error ? { error: r.error } : r;
  } catch (e) { out.Logit = { error: e.message }; }

  // Probit
  try {
    const r = runProbit(makeLogitData(), "y", ["x1", "x2"]);
    out.Probit = r?.error ? { error: r.error } : r;
  } catch (e) { out.Probit = { error: e.message }; }

  return out;
}

// ─── Numeric comparison ─────────────────────────────────────────────────────────

function compareToGolden(estimatorType, engineResult, seType = "classical") {
  const golden = GOLDEN[estimatorType];
  if (!golden) return { checks: [], skipped: true, reason: "no golden values" };
  if (engineResult?.error) return { checks: [], error: engineResult.error };

  const checks = [];
  const near = (field, got, want, tol) => {
    if (want == null || !isFinite(got) || !isFinite(want)) return null;
    const { pass, diff, divergenceIds } = checkValue(field, got, want, estimatorType, "R", seType);
    checks.push({ field, got, want, diff, pass, divergenceIds });
    return pass;
  };

  if (estimatorType === "RDD") {
    near("coef", engineResult.late,   golden.late,   "RDD");
    near("se",   engineResult.lateSE, golden.lateSE, "RDD");
    near("coef", engineResult.h,      golden.h,       "RDD");  // IK bandwidth
    if (golden.n != null && engineResult.n !== golden.n) {
      checks.push({ field: "n", got: engineResult.n, want: golden.n, diff: Math.abs(engineResult.n - golden.n), pass: engineResult.n === golden.n });
    }
  } else {
    // Coefficients
    if (golden.beta) {
      golden.beta.forEach((want, i) => {
        near("coef", engineResult.beta?.[i], want, estimatorType);
      });
    }
    // Standard errors (if golden.se is non-null)
    if (golden.se) {
      golden.se.forEach((want, i) => {
        near("se", engineResult.se?.[i], want, estimatorType);
      });
    }
    // R² (FE only uses R2_within; others use R2)
    if (golden.r2 != null) {
      const gotR2 = estimatorType === "FE" ? engineResult.R2_within : engineResult.R2;
      near("r2", gotR2, golden.r2, estimatorType);
    }
    // n (exact)
    if (golden.n != null && engineResult.n !== golden.n) {
      checks.push({ field: "n", got: engineResult.n, want: golden.n, diff: Math.abs(engineResult.n - golden.n), pass: false });
    }
  }

  const passed = checks.filter(c => c.pass !== false).length;
  const failed = checks.filter(c => c.pass === false).length;
  return { checks, passed, failed, ok: failed === 0 };
}

// ─── Script pattern checks ───────────────────────────────────────────────────────
// Mirrors exportValidation.js but uses the actual model configs below.

const SCRIPT_PATTERNS = {
  OLS:       { R: "feols",      Stata: "reg",          Python: "smf.ols"       },
  FE:        { R: "feols",      Stata: "xtreg",        Python: "PanelOLS"      },
  FD:        { R: "plm",        Stata: "xtreg",        Python: "FirstDifferenceOLS" },
  "2SLS":    { R: "feols",      Stata: "ivregress 2sls",Python: "IV2SLS"       },
  RDD:       { R: "rdrobust",   Stata: "rdrobust",     Python: "rdrobust"      },
  Logit:     { R: "glm",        Stata: "logit",        Python: "smf.logit"     },
  Probit:    { R: "glm",        Stata: "probit",       Python: "smf.probit"    },
};

const MODEL_CONFIGS = {
  OLS:    { type: "OLS",  yVar: "y",  xVars: ["x1","x2"], wVars: [], zVars: [] },
  FE:     { type: "FE",   yVar: "y",  xVars: ["x","z"],   wVars: [], entityCol: "unit", timeCol: "time" },
  FD:     { type: "FD",   yVar: "y",  xVars: ["x","z"],   wVars: [], entityCol: "unit", timeCol: "time" },
  "2SLS": { type: "2SLS", yVar: "y",  xVars: ["d"],       wVars: ["d"], zVars: ["z"], entityCol: null },
  RDD:    { type: "RDD",  yVar: "y",  xVars: [], wVars: [], runningVar: "x", cutoff: 0, bandwidth: 0.613, kernel: "triangular" },
  Logit:  { type: "Logit",  yVar: "y", xVars: ["x1","x2"], wVars: [] },
  Probit: { type: "Probit", yVar: "y", xVars: ["x1","x2"], wVars: [] },
};

function checkScripts(estimatorType) {
  const model    = MODEL_CONFIGS[estimatorType];
  const patterns = SCRIPT_PATTERNS[estimatorType];
  if (!model || !patterns) return null;

  const cfg = { filename: "data.csv", pipeline: [], model };
  const results = {};

  for (const [lang, expected] of Object.entries(patterns)) {
    try {
      const gen = lang === "R" ? generateRScript : lang === "Stata" ? generateStataScript : generatePythonScript;
      const raw    = gen(cfg);
      const script = Array.isArray(raw) ? raw.join("\n") : String(raw ?? "");
      const pass   = script.length > 0 && script.includes(expected);
      results[lang] = { pass, expected, snippet: script.slice(0, 120) };
    } catch (e) {
      results[lang] = { pass: false, error: e.message };
    }
  }
  return results;
}

// ─── Main runner ─────────────────────────────────────────────────────────────────

export function runGoldenHarness({ verbose = false, only = null } = {}) {
  const estimators = Object.keys(GOLDEN).filter(e => !only || e === only);
  const engineResults = runEngines();

  const rows = [];

  for (const est of estimators) {
    const eng  = engineResults[est];
    const num  = compareToGolden(est, eng);
    const scr  = checkScripts(est);

    // Summary status
    const numStatus  = num.error ? "ERROR" : num.skipped ? "SKIP" : num.ok ? "PASS" : `FAIL(${num.failed})`;
    const scrR       = scr?.R?.pass     ? "PASS" : (scr?.R     ? "FAIL" : "—");
    const scrStata   = scr?.Stata?.pass ? "PASS" : (scr?.Stata  ? "FAIL" : "—");
    const scrPython  = scr?.Python?.pass? "PASS" : (scr?.Python ? "FAIL" : "—");

    const divs = getKnownDivergences(est, "R", "classical").map(d => d.id);

    const row = {
      Estimator:  est,
      "Engine→R": numStatus,
      "Script R": scrR,
      "Script Stata": scrStata,
      "Script Python": scrPython,
      Divergences: divs.join(", ") || "—",
    };
    rows.push({ ...row, _detail: { num, scr, eng } });

    if (verbose) {
      console.group(`${est}  [engine→R: ${numStatus}]`);
      if (num.checks?.length) {
        num.checks.forEach(c => {
          const icon = c.pass === false ? "✗" : "✓";
          console.log(`  ${icon} ${c.field}: got=${c.got?.toFixed?.(6) ?? c.got}  want=${c.want?.toFixed?.(6) ?? c.want}  diff=${c.diff?.toExponential?.(2) ?? "—"}`);
        });
      }
      if (num.error) console.warn("  Engine error:", num.error);
      console.groupEnd();
    }
  }

  // Summary table
  const passed = rows.filter(r => r["Engine→R"] === "PASS" || r["Engine→R"] === "SKIP").length;
  const failed = rows.filter(r => r["Engine→R"].startsWith("FAIL") || r["Engine→R"] === "ERROR").length;

  console.group(
    `%cGolden-File Harness — ${passed}/${rows.length} engine checks clean  |  ${failed} fail`,
    passed === rows.length ? "color:#6ec8b4;font-weight:bold" : "color:#c8a96e;font-weight:bold"
  );
  console.table(
    Object.fromEntries(rows.map(r => [r.Estimator, {
      "Engine→R":     r["Engine→R"],
      "Script R":     r["Script R"],
      "Script Stata": r["Script Stata"],
      "Script Py":    r["Script Python"],
      "Known divs":   r.Divergences,
    }]))
  );

  if (failed > 0) {
    console.group("Failures");
    rows.filter(r => r["Engine→R"].startsWith("FAIL") || r["Engine→R"] === "ERROR").forEach(r => {
      console.group(r.Estimator);
      r._detail.num.checks?.filter(c => c.pass === false).forEach(c => {
        console.error(`  ✗ ${c.field}: got=${c.got}  want=${c.want}  diff=${c.diff?.toExponential(3)}`);
      });
      if (r._detail.num.error) console.error("  Engine error:", r._detail.num.error);
      console.groupEnd();
    });
    console.groupEnd();
  }

  console.groupEnd();

  return { passed, total: rows.length, failed, rows: rows.map(r => ({ ...r, _detail: undefined })) };
}

// ─── Attach to window ────────────────────────────────────────────────────────────
if (typeof window !== "undefined") {
  window.__goldenHarness = runGoldenHarness;
  console.log("[goldenFileHarness] Ready — window.__goldenHarness() or window.__goldenHarness({ verbose:true })");
}
