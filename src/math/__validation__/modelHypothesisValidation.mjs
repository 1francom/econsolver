// ─── ECON STUDIO · math/__validation__/modelHypothesisValidation.mjs ────────
// Validates the joint (linear) hypothesis test in ModelHypothesis.js against
// R's car::linearHypothesis, for BOTH statistics the panel exposes.
//
// Benchmarks come from modelHypothesisRValidation.R, which exports R's own
// beta and vcov so waldTest() is fed exactly the inputs R tested — any
// difference is then attributable to the test, not to a differing fit.
//
// Run:  node src/math/__validation__/modelHypothesisValidation.mjs

import { readFileSync } from "node:fs";
import { waldTest, waldStatistic, generateJointHypothesisScript } from "../ModelHypothesis.js";

const BENCH = JSON.parse(readFileSync(new URL("./modelHypothesisBenchmarks.json", import.meta.url), "utf8"));

// Project convention: 6dp on the statistic, 4dp on p-values.
const TOL_STAT = 1e-6;
const TOL_P    = 1e-4;

let pass = 0;
const failures = [];
function check(name, ok, detail = "") {
  if (ok) { pass++; return; }
  failures.push(`${name}${detail ? ` — ${detail}` : ""}`);
}
function near(a, b, tol) {
  return Number.isFinite(a) && Number.isFinite(b) && Math.abs(a - b) <= tol;
}

// ── Guard against a self-generated benchmark file ───────────────────────────
// A harness whose every diff is exactly 0 is usually comparing the engine to
// itself. Stamp-check the source, and require at least one non-zero residual.
check("meta.source is car::linearHypothesis",
  BENCH?.meta?.source === "car::linearHypothesis", JSON.stringify(BENCH?.meta ?? null));

const diffs = [];
// jsonlite's auto_unbox collapses length-1 vectors to scalars, so a
// single-restriction case arrives as terms:"x1" rather than ["x1"].
const arr = v => Array.isArray(v) ? v : [v];

for (const raw of BENCH.cases) {
  const c = { ...raw, terms: arr(raw.terms), h0s: arr(raw.h0s) };
  const indices = c.terms.map(t => c.varNames.indexOf(t));
  check(`${c.name}: every term resolves to a coefficient index`, indices.every(i => i >= 0), JSON.stringify(c.terms));
  if (indices.some(i => i < 0)) continue;

  const got = waldTest(c.beta, c.vcov, indices, c.h0s, { resDf: c.resDf, statLabel: "t" });
  if (got.error) { check(`${c.name}: waldTest runs`, false, got.error); continue; }

  check(`${c.name}: q = ${c.q}`, got.df === c.q, `got ${got.df}`);
  check(`${c.name}: chi2 matches R`, near(got.chiSq, c.chiSq, TOL_STAT), `got ${got.chiSq} vs R ${c.chiSq}`);
  check(`${c.name}: chi2 p matches R`, near(got.chiSqPval, c.chiSqP, TOL_P), `got ${got.chiSqPval} vs R ${c.chiSqP}`);
  check(`${c.name}: F matches R`, near(got.F, c.F, TOL_STAT), `got ${got.F} vs R ${c.F}`);
  check(`${c.name}: F p matches R`, near(got.fPval, c.fP, TOL_P), `got ${got.fPval} vs R ${c.fP}`);
  check(`${c.name}: residual df carried through`, got.dfResid === c.resDf, `got ${got.dfResid}`);

  diffs.push(Math.abs(got.chiSq - c.chiSq), Math.abs(got.F - c.F));

  // The identity R itself relies on: F = chi2 / q.
  check(`${c.name}: F = chi2/q`, near(got.F, got.chiSq / got.df, 1e-10), `${got.F} vs ${got.chiSq / got.df}`);

  // waldStatistic must report what was asked for, and the F/chi2 p-values must
  // order correctly — chi2 is the liberal one at any finite n.
  const asF = waldStatistic(got, "F");
  const asChi = waldStatistic(got, "chisq");
  check(`${c.name}: explicit F choice honoured`, asF.kind === "F" && near(asF.stat, c.F, TOL_STAT));
  check(`${c.name}: explicit chi2 choice honoured`, asChi.kind === "chisq" && near(asChi.stat, c.chiSq, TOL_STAT));
  check(`${c.name}: chi2 p <= F p`, asChi.pValue <= asF.pValue + 1e-12, `chi2 ${asChi.pValue} vs F ${asF.pValue}`);
}

check("benchmarks are not engine-self-generated (some non-zero residual)",
  diffs.some(d => d > 0), "every diff was exactly 0");

// ── A z-statistic model has no residual df, so no F is offered ─────────────
{
  const beta = [0.4, -0.2];
  const vcov = [[0.01, 0.001], [0.001, 0.02]];
  const ml = waldTest(beta, vcov, [0, 1], [0, 0], { resDf: 500, statLabel: "z" });
  check("ML (z) model reports chi2 only", ml.F === null && ml.dfResid === null && ml.preferred === "chisq",
    JSON.stringify({ F: ml.F, dfResid: ml.dfResid, preferred: ml.preferred }));
  check("asking for F on a z model falls back to chi2", waldStatistic(ml, "F").kind === "chisq");

  const t = waldTest(beta, vcov, [0, 1], [0, 0], { resDf: 500, statLabel: "t" });
  check("t model prefers F", t.preferred === "F" && waldStatistic(t, null).kind === "F");
  check("missing resDf on a t model still yields chi2",
    waldTest(beta, vcov, [0, 1], [0, 0], { statLabel: "t" }).F === null);
}

// ── Emitted replication code must name the chosen test ────────────────────
{
  const c = { ...BENCH.cases[0], terms: arr(BENCH.cases[0].terms), h0s: arr(BENCH.cases[0].h0s) };
  const indices = c.terms.map(t => c.varNames.indexOf(t));
  const test = waldTest(c.beta, c.vcov, indices, c.h0s, { resDf: c.resDf, statLabel: "t" });
  const terms = c.terms.map((label, j) => ({ id: `coef:${indices[j]}`, label, source: "coefficient" }));
  const meta = { modelLabel: "m1", modelType: "OLS", spec: {}, terms };

  const rChi = generateJointHypothesisScript("r", test, { ...meta, statChoice: "chisq" });
  const rF   = generateJointHypothesisScript("r", test, { ...meta, statChoice: "F" });
  check("R emits car::linearHypothesis", rChi.includes("car::linearHypothesis(fit,"), rChi);
  check("R honours test = Chisq", rChi.includes('test = "Chisq"'), rChi);
  check("R honours test = F", rF.includes('test = "F"'), rF);
  check("R carries the constraint strings", rChi.includes('"x2 = 0"') && rChi.includes('"x3 = 0"'), rChi);

  const py = generateJointHypothesisScript("python", test, { ...meta, statChoice: "chisq" });
  check("Python uses wald_test with use_f=False for chi2", py.includes("use_f=False") && py.includes("wald_test"), py);
  const pyF = generateJointHypothesisScript("python", test, { ...meta, statChoice: "F" });
  check("Python switches to use_f=True for F", pyF.includes("use_f=True"), pyF);

  const st = generateJointHypothesisScript("stata", test, { ...meta, statChoice: "chisq" });
  check("Stata emits a test command with parenthesised constraints",
    /^test \(x2 = 0\) \(x3 = 0\)$/m.test(st), st);

  // Non-zero nulls must survive into the emitted constraints — a script that
  // silently tested "= 0" would look right and reproduce a different number.
  const c2 = { ...BENCH.cases[1], terms: arr(BENCH.cases[1].terms), h0s: arr(BENCH.cases[1].h0s) };
  const idx2 = c2.terms.map(t => c2.varNames.indexOf(t));
  const t2 = waldTest(c2.beta, c2.vcov, idx2, c2.h0s, { resDf: c2.resDf, statLabel: "t" });
  const r2 = generateJointHypothesisScript("r", t2, {
    modelLabel: "m1", modelType: "OLS", spec: {},
    terms: c2.terms.map((label, j) => ({ id: `coef:${idx2[j]}`, label, source: "coefficient" })),
    statChoice: "F",
  });
  check("non-zero nulls reach the emitted R constraints",
    r2.includes('"x1 = 0.5"') && r2.includes('"x3 = 0.1"'), r2);
}

console.log(`modelHypothesis — ${pass} passed, ${failures.length} failed`);
failures.forEach(f => console.log(`  ✗ ${f}`));
process.exit(failures.length ? 1 : 0);
