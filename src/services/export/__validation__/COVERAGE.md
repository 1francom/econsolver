# Phase 0.4 — Export Translation Coverage

**Generated:** 2026-05-23
**Scope:** Estimator and pipeline-step coverage across R, Stata, and Python transpilers
**Source files:** `src/services/export/rScript.js`, `stataScript.js`, `pythonScript.js`

> **Caveat:** This audit is a static read of the translator source. Cells marked `complete`
> indicate the translator *emits* code for that operation in idiomatic syntax; it does
> NOT prove the emitted code reproduces EconSolver's numbers to the SE tolerance.
> Phase A's `npm run validate-exports` harness is the empirical check that converts
> `complete` here into a green cell of `validation_report.md`.

---

## Table 1 — Estimators

| Estimator           | R                 | Stata             | Python  | Notes |
|---------------------|-------------------|-------------------|---------|-------|
| OLS                 | complete          | complete          | complete | `feols` / `reg, robust` / `statsmodels.OLS` |
| WLS                 | complete          | complete          | complete | Weighted least squares |
| FE (within)         | complete          | complete          | complete | `fixest::feols` / `xtreg, fe` / `linearmodels.PanelOLS` |
| FD                  | complete          | complete          | complete | `plm(model="fd")` / `xtreg, fd` / `linearmodels.FirstDifferenceOLS` |
| TWFE                | complete          | complete          | complete | Dual FE syntax in all three |
| TWFE DiD            | complete          | complete          | complete | Interaction term in TWFE |
| 2x2 DiD             | complete          | complete          | complete | `post × treat` interaction |
| 2SLS / IV           | complete          | complete          | complete | `feols(... \| Z)` / `ivregress 2sls` / `linearmodels.IV2SLS` |
| Sharp RDD           | known-divergent   | known-divergent   | complete | `rdrobust` Stata uses different bias-correction df vs R; Python: `rdrobust` pkg (try/except) + `smf.wls` fallback |
| Fuzzy RDD           | complete          | complete          | complete  | R `rdrobust(fuzzy=...)`; Stata `rdrobust fuzzy(D)`; Python `rdrobust(fuzzy=)` (try/except) + manual 2SLS fallback |
| McCrary density     | complete          | complete          | complete | R `rddensity`; Stata `rddensity`; Python `rddensity` package |
| Logit               | complete          | complete          | complete | `glm(..., family=binomial)` |
| Probit              | complete          | complete          | complete | `glm(..., family=binomial(probit))` |
| GMM                 | complete          | complete          | complete | R `gmm::gmm`; Stata `ivregress gmm`; Python `linearmodels.IVGMM` |
| LIML                | complete          | complete          | complete | R `ivreg::ivreg(...,method="liml")`; Stata `ivregress liml`; Python `linearmodels.IVLIML` |
| Event Study         | complete          | complete          | complete | R `fixest::feols i()`; Stata `reghdfe`; Python `pyfixest` |
| Panel LSDV          | complete          | complete          | complete  | All three recover alpha_i: R `fixef(fit)`; Stata `areg` + `predict _fe, dresiduals`; Python `model.estimated_effects` |
| Poisson FE          | complete          | complete          | complete | R `fepois`; Stata `ppmlhdfe`; Python `pyfixest.fepois` |
| Synthetic Control   | known-divergent   | complete          | complete  | Stata `synth` + `synth_runner` placebo; Python `pysynth` (try/except) + scipy SLSQP fallback; weights ~1e-2 vs R Synth::ipop (Frank-Wolfe vs nested-opt, tolerated) |
| **Spatial RD**      | complete          | complete          | complete    | R `rdrobust` on signed dist; Stata `rdrobust` + manual WLS fallback; Python `smf.wls` |

**Coverage stats (estimators)** — updated 2026-05-24
- R:      19/19 complete or known-divergent
- Stata:  19/19 complete or known-divergent
- Python: 19/19 complete or known-divergent
- All partial/missing entries resolved: Sharp RDD Python → rdrobust try/except; Fuzzy RDD Stata/Python → rdrobust; LSDV Stata/Python → FE recovery added; SyntheticControl Stata/Python → already had emitters (table was stale).

---

## Table 2 — Pipeline steps

| Step                 | R        | Stata    | Python   | Notes |
|----------------------|----------|----------|----------|-------|
| rename               | complete | complete | complete | |
| drop                 | complete | complete | complete | |
| filter               | complete | complete | complete | |
| drop_na              | complete | complete | complete | |
| fill_na              | complete | complete | complete | mean/median/mode/ffill/bfill/constant |
| fill_na_grouped      | complete | complete | complete | |
| type_cast            | complete | complete | complete | |
| quickclean           | complete | complete | complete | Dedup + all-NA filter |
| recode               | complete | complete | complete | |
| normalize_cats       | complete | complete | complete | |
| winz                 | complete | complete | complete | Percentile cap |
| trim_outliers        | complete | complete | complete | IQR-based |
| flag_outliers        | complete | complete | complete | |
| extract_regex        | complete | complete | complete | |
| ai_tr                | partial  | partial  | partial  | Parses `v => body` arrow fn, substitutes param → col ref, runs `jsExprToR/Stata/Python`; falls back to comment. Runtime validation still needed for complex exprs |
| log                  | complete | complete | complete | |
| sq                   | complete | complete | complete | |
| std                  | complete | complete | complete | |
| dummy                | complete | complete | complete | |
| lag                  | complete | complete | complete | Panel-aware (entity-grouped) |
| lead                 | complete | complete | complete | Panel-aware |
| diff                 | complete | complete | complete | Panel-aware |
| ix                   | complete | complete | complete | Interaction term |
| did                  | complete | complete | complete | post × treat |
| date_parse           | complete | complete | complete | |
| date_extract         | complete | complete | complete | year/month/day/etc. |
| mutate               | complete | complete | complete | `jsExprToR/Stata/Python` from `stepTranslators.js`; handles `ifelse`, `log`, `case_when`, JS ops; comment fallback for untranslatable syntax |
| factor_interactions  | complete | complete | complete | |
| arrange              | complete | complete | complete | |
| group_summarize      | complete | complete | complete | |
| pivot_longer         | complete | complete | complete | R `tidyr::pivot_longer` simple + multi/.value modes; Stata `reshape long`; Python `pd.melt` |
| join                 | complete | complete | complete | R `dplyr::left_join`/`inner_join`; Stata `preserve/merge/restore`; Python `pd.merge` |
| append               | complete | complete | complete | R `bind_rows`; Stata `preserve/append/restore`; Python `pd.concat` |
| geocode              | complete | complete | complete | R `tidygeocoder::geocode(method="osm")`; Stata export+merge workaround; Python `geopy` Nominatim + RateLimiter |
| patch (cell edits)   | complete  | complete  | complete  | Emits `__row_id`-based lookup when `step.rowId` set; `__ri` fallback with warning comment. Phase E will populate `rowId` on new patches. |

**Coverage stats (pipeline steps, 34 total)** — updated 2026-05-24
- R:      ~33 complete, 1 partial (ai_tr), 0 missing
- Stata:  ~33 complete, 1 partial (ai_tr), 0 missing
- Python: ~33 complete, 1 partial (ai_tr), 0 missing
- pivot_longer R → complete (tidyr::pivot_longer, simple + multi/.value modes)
- geocode all three → complete (tidygeocoder / Stata export+merge / geopy RateLimiter)
- ai_tr: upgraded from stub comment → arrow-fn parser + jsExprToR/Stata/Python; falls back to comment

---

## Known divergences (carry into seTolerances.js for Phase A)

| Estimator         | Language    | Why                                                                                  |
|-------------------|-------------|--------------------------------------------------------------------------------------|
| RDD               | Stata       | `rdrobust` Stata uses a different bias-correction df vs R                            |
| FE / TWFE         | any         | clubSandwich HC2/HC3 vs `plm::vcovHC` vs `fixest`/`sandwich` use different df adjustments |
| Synthetic Control | any         | Frank-Wolfe vs `Synth::ipop` converge to slightly different weights (~1e-2)          |
| HAC (DK-HAC)      | any         | `plm::vcovSCC` df adjustment vs in-house Driscoll-Kraay implementation               |
| HC2 / HC3 panel   | any         | Leverage-based meat differs slightly across `clubSandwich`, `plm`, in-house          |

(These five families are explicitly tolerated at 1e-3 on SE in `fase4bBenchmarks.json` already.)

---

## Action items for Phase A

1. ~~**Spatial RD**~~ — DONE. R/Stata/Python translators all wired.
2. ~~**GMM / LIML / Poisson FE / McCrary density**~~ — DONE. All three languages emit for all four estimators.
3. ~~**McCrary density**~~ — DONE (see above).
4. ~~**Validation harness**~~ — DONE. `exportValidation.js` — 19 estimators × 3 languages, pattern-match smoke tests, `window.__validateExports()`.
5. ~~**Join / Append in Stata/Python**~~ — DONE. Stata: `preserve/import/merge/restore` pattern with `__right_tmp.dta`; Python: `pd.read_csv` + `df.merge`/`pd.concat`.
6. ~~**`patch` step**~~ — DONE. All three emitters now emit `__row_id`-based lookup when `step.rowId` is set; fall back to `__ri` with a comment for legacy steps. `rowIdentity.js` wiring (Phase E) will populate `rowId` on new patches.
7. ~~**`mutate` step**~~ — DONE. `jsExprToR/Stata/Python` exported from `stepTranslators.js` and wired into all three export files. Translates `ifelse`, `log`, `sqrt`, `case_when`, `pmin/pmax`, JS operators (`===`, `&&`, `||`, `**`) to language equivalents. Falls back to a manual-translate comment for arrow functions / template literals.

Phase A.1 (`seTolerances.js`) and Phase A.2 (`goldenFileHarness.js`) are both ✓ DONE.
**Browser validation PENDING — Franco to run `window.__goldenHarness()` and `window.__validateExports()` by 2026-05-29.**
