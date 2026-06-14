# Fase X2 — Replication Bundle Integrity

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans.

**Track:** C — Cross-cutting hardening
**Status:** Structural half DONE 2026-06-14 (harness `src/services/export/__validation__/replicationIntegrityValidation.mjs`, 269 checks green). Surfaced + fixed a MAJOR bug: Python & Stata pipeline-step transpilers read a dead `params`-nested step schema → every non-grid-edit data-prep step emitted `undefined` operands; migrated both to the flat registry schema, added 11 missing R cases + 6 missing Py/Stata cases, fixed `buildStataVarlist` `rawW` crash. **Remaining (pending Franco's R/Python/Stata runtime):** the actual smoke test — run an exported script in R/statsmodels/Stata and assert coefficients match the UI within 1e-6. See ClaudePlan.md X2 row.
**Blocks:** Fase X5 (bug bash).

**Goal:** Guarantee that every replication script (R, Python, Stata) emitted by EconSolver executes cleanly in its native runtime and reproduces the same coefficients reported in the EconSolver UI within 1e-6.

**Why this matters:** the headline value proposition for thesis students and policy analysts is "click export → drop into your professor's R session and it just runs." A silently broken export script invalidates that promise.

**Tech Stack:** R 4.4.x + `fixest`, `AER`, `plm`, `rdrobust`, `modelsummary`, `gmm`, `Synth`. Python 3.12 + `statsmodels`, `linearmodels`, `pandas`. Stata 18 if available; lint-only otherwise.

---

## Surface covered

- `src/services/export/rScript.js` — pipeline + model → R script.
- `src/services/export/pythonScript.js` — same → Python.
- `src/services/export/stataScript.js` — same → Stata do-file.
- `src/services/export/replicationBundle.js` — ZIP bundle assembly + `buildMultiSubsetBundle`.

Every estimator on the implementation list must round-trip through all three exporters.

---

## File structure

Create:
```
src/services/export/__validation__/
├── faseX2Validation.js          ← browser harness: generate scripts + assemble bundle
├── faseX2RRunner.R              ← runs each generated R script, captures coefs, writes JSON
├── faseX2PyRunner.py            ← same for Python
├── faseX2StataRunner.do         ← same for Stata (lint-only if no Stata license)
└── faseX2Benchmarks.json        ← EconSolver-side coefficients to compare against
```

---

## Task 1 — Per-step exporter coverage

For each of the 23 pipeline step types, assert that all three exporters emit syntactically valid code:

```js
const script_r  = generateRScript(steps);
const script_py = generatePythonScript(steps);
const script_st = generateStataScript(steps);

assert(scriptCompilesR(script_r));      // run `Rscript --vanilla -e "parse(text=...)"`
assert(scriptCompilesPy(script_py));    // `python -c "compile(open(...).read(), ..., 'exec')"`
assert(scriptLintsStata(script_st));    // syntax check via `do-file editor` lint
```

Steps without a direct equivalent (e.g. `ai_tr`) must emit a `# Manual review:` comment, not silently skip.

---

## Task 2 — Per-estimator coefficient round-trip

For each estimator on `engineValidation.js` benchmarks:

1. Build a small project (rawData + pipeline + model config).
2. Estimate in EconSolver → record β̂, SE.
3. Export the replication bundle.
4. Unzip into a temp directory.
5. Run `Rscript main.R` (and the Python / Stata equivalents).
6. Parse the script's output table.
7. Compare coefficients to EconSolver's β̂ at 1e-6 absolute tolerance.

**Estimators covered:** OLS, WLS, FE, FD, TWFE, 2SLS, IV, GMM, LIML, Logit, Probit, Sharp RDD, Fuzzy RDD, DiD 2×2, TWFE DiD, Event Study, Synth Control, Poisson FE.

Per-estimator R reference library:
- OLS, WLS → `lm`
- FE, FD, TWFE, DiD, Event Study → `fixest::feols`
- 2SLS, IV → `AER::ivreg`
- GMM → `gmm::gmm`
- Sharp / Fuzzy RDD → `rdrobust::rdrobust`
- Logit, Probit → `glm(..., family = binomial(link="logit"|"probit"))`
- Poisson FE → `fixest::fepois`
- Synth Control → `Synth::synth`

---

## Task 3 — Multi-subset bundle

`buildMultiSubsetBundle(subsets, model)` must:

1. Emit one R script per subset using the `lapply` pattern from `generateSubsetRScript`.
2. Emit one Python script per subset using the dict-comprehension pattern.
3. Emit one Stata do-file with `preserve` / `restore` blocks per subset.
4. Each subset script independently produces the correct subset's β̂.
5. `downloadMultiSubsetBundle` ZIPs all three with a shared `data.csv`.

Acceptance: extract bundle, run all three subset scripts, every β̂ matches EconSolver's subset coefficients at 1e-6.

---

## Task 4 — Bundle integrity

- All three scripts in the bundle reference `data.csv` by relative path (no absolute paths).
- The shared `data.csv` matches `rawData` (or the post-pipeline derived data, depending on bundle mode).
- Random seed is set explicitly in each script (R: `set.seed(42)`, Python: `np.random.seed(42)`, Stata: `set seed 42`).
- Each script writes a `coefficients.csv` output file the harness can parse.

---

## Acceptance gate

- [ ] All 23 step types compile in all three exporters.
- [ ] All ~18 estimators round-trip with coef diff < 1e-6 (R; Python; Stata if available).
- [ ] Multi-subset bundle round-trips for 3 distinct subset configurations.
- [ ] No absolute path leaks, no missing seeds, all scripts produce `coefficients.csv`.

---

## Pre-merge gate — Supabase feedback check (MANDATORY)

Before marking this fase complete, run the `feedback-collector` agent to pull unprocessed rows from the Supabase `feedback` table into `ClaudeFB.md`. Then:

1. **Filter** feedback by scope tags that touch this fase: `export`, `replication`, `R script`, `Python script`, `Stata`, `bundle`, `download`, `script error`.
2. For every open row in scope:
   - **Fix-now:** address before concluding.
   - **Fix-later:** file in `BugTriage.md` with a `FaseX2 →` reference.
   - **Wontfix:** document rationale in `ClaudeFB.md` and resolve in Supabase.
3. Concluding without an empty in-scope queue is a blocker.

User-reported export bugs are the canonical failure mode here — the harness can confirm scripts compile, but only real users hit edge-case combinations of pipeline + estimator + export.

---

## Commits

- `test(export): Fase X2 — per-step exporter compile tests`
- `test(export): Fase X2 — per-estimator R/Python/Stata coef round-trip`
- `test(export): Fase X2 — multi-subset bundle integrity`
- `fix(export): Fase X2 — discrepancies surfaced by harness` (if any)
- `docs: Fase X2 — replication integrity validated`
