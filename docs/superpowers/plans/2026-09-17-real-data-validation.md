# Real-data validation — plan (2026-09-17)

**Goal.** Everything Franco builds in Litux on real teaching/thesis data must
(1) match the original reference script's numbers, and (2) be reproduced by
EVERY script Litux emits — the full workspace/replication script AND each
section's partial script — in R, Stata and Python. Criterion: mutual agreement
(Litux = R = Stata = Python = reference) wherever the software allows it. Some
gaps are inherent to a package or language (different small-sample
conventions, optimiser tolerances, an estimator with no native implementation);
those are measured and documented as known gaps, never silently tolerated.

Replaces the simulated-data R benchmark suites deleted on 2026-09-17.

## Units of validation

| Unit | Reference script | Data | Litux project | Main content |
|---|---|---|---|---|
| PS2 | `PS2_sol_code.R` | `PS2_Ex1_Fulton_data.csv` (+ `PS2_Ex2_AJR.csv`, **missing**) | Waldinger Validation tutorial 2 | OLS/2SLS with HC SE, F-tests, date parsing, plots |
| PS3 | `PS3_sol_code.R` | `hansen_data.csv` | Waldinger Validation tutorial 3 | RDD (`rdrobust`, `rdplot`), McCrary, `feols` cluster |
| PS4 | `PS4_sol_code.R` | `PS4_education_data.csv` | Waldinger Validation tutorial 4 | multi-way FE (AKM), connected components, joins, reshape, `countrycode`, tile/facet plots |
| PS5 | `PS5_code_solutions (1).R` | `PS5_dinas2019_data.RData` | Waldinger Validation Tutorial 5 | subsets, OLS/2SLS/DiD through the origin |
| PS6 | `PS6_Ex2_staggered (2).R` (+ `_simulation.R`) | `PS6_Staggered_DiD.csv`, `PS6_Complete.csv` | Tutprial 6 Validation | TWFE, Goodman-Bacon, Callaway-Sant'Anna |
| LM6 | *(to confirm)* | `dubelesterreich_empdata_contig_minwage.dta` | Labor market Tutorial 6 | multi-way FE incl. `period^pair_id`, state-clustered SE |

Out of scope: PS1 and PS7 (no Litux project yet), the BA thesis and "Effect of
low-skill inmigration" (Franco, 2026-09-17).

Notebooks (`PS2–PS6_notebook.Rmd`) use `wooldridge` data and stay out of scope
until the bundled-teaching-datasets item lands.

## How Litux's numbers reach the comparison (no browser)

Litux's engines are pure JS, and a project is fully described by its RECIPES:
dataset registry (filename + loadOpts), per-dataset pipelines, the global
pipeline (derive/join edges), pinned model specs (`model.json` — specs, never
coefficients), saved plots, Explore pins. From those plus the data files the
harness recomputes exactly what the app shows (`runPipeline` +
`runEstimation`, the app's own code paths) and generates every script from the
same specs (the exporters are pure JS too). This is the mechanism of
`stataEstimatorSweep.mjs`, applied to real projects.

**Needed from the app — one new feature:** *Export project* → a single plain
`.litux.json` with everything above (the cloud-sync manifest builder already
assembles exactly this set, minus encryption). Franco exports each validation
project once into `validation/<unit>/project.litux.json`. Also useful to users
as a local backup. Contains recipes and dataset metadata only, never rows.

## Harness — `tools/validation/`

The harness code is tracked; everything under `validation/` (LMU scripts and
data, project exports, results) is git-ignored — the course material is not
ours to publish in a public repo.


1. `loadProject(unit)` — read `project.litux.json`, load each dataset from
   `validation/` with the app's own parsers (`parsers/tabular.js`, `rds.js`,
   `rdata.js`, `stata.js`), replay pipelines (`runPipeline`), apply global
   derive/join steps.
2. `lituxResults` — re-estimate every pinned model (`runEstimation`), recompute
   Explore pins (summary, group summarize, correlation, tests) and saved plots'
   aggregated data. → `results/litux.json`.
3. `emitScripts` — per unit, write:
   - **full**: workspace script (`generateWorkspaceScript`) + model sections,
     i.e. the deterministic skeleton of the Report unified script (the AI pass
     is not validated here);
   - **partial**: Clean pipeline export (`generateCleanScript`), per-model Code
     panel (`generate{R,Stata,Python}Script`), model comparison
     (`generateMultiModel*`), subset scripts, Explore pin scripts, PlotBuilder
     scripts (`plotScript`), spatial `sp_*` steps, Bacon/CS snippets;
   - each in R, Stata and Python. Every emitted script gets a small appended
     dump block that writes its estimates to JSON (like the Stata sweep's).
4. `runScripts` — Rscript / StataSE (`/e`) / python, paths rewritten to
   `validation/`; capture exit status, errors and dumps.
5. `reference` — run the ORIGINAL script once (setwd patched, `saveRDS`/JSON
   dump hooks appended after each model object) → `results/reference.json`.
   Matching reference objects to Litux models is by an explicit per-unit map
   (`validation/<unit>/map.json`: Litux model label → reference object name),
   written once by hand.
6. `compare` — matrix per unit × result × {Litux, R-full, R-partial, Stata-…,
   Python-…, reference}: coef 1e-6, SE 1e-4 relative, N exact; data steps
   compared by row count + column checksums; plots by the aggregated data
   behind them (bins, group means), not pixels. Known gaps come from one
   `KNOWN` table with the reason (convention decisions pending in CLAUDE.md).
   Output: `validation/report.md` + non-zero exit on any unexplained diff.

## Order

1. Export-project feature (small) + harness skeleton on **PS5 / Tutorial 5**
   (already built in the app) — proves the pipeline end to end.
2. PS3, PS6, LM6 (estimator-heavy, data ready).
3. PS4 (widest wrangling surface), PS2 (needs AJR data).
4. Fix what breaks, unit by unit; each fix gets a pinned node check like
   `stataEstimatorExportValidation.mjs`.

## Environment

- R 4.4.1 by full path. Missing packages for the reference scripts:
  estimatr modelsummary huxtable rdd rddensity stargazer plotly countrycode
  did tidyverse hrbrthemes SCtools rvest viridis ggthemes sf writexl readxl
  units readr knitr wooldridge plm gplots haven — install needs Franco's OK.
- Stata 19.5 (`/e`, `MSYS2_ARG_CONV_EXCL`); ssc: rdrobust, csdid, drdid,
  ppmlhdfe, synth pending approval.
- Python: pandas 2.3.3, statsmodels 0.14.6, linearmodels 7.0, geopandas present;
  pyfixest missing (only needed if the Python exporter emits it).

## Open questions for Franco

- `PS2_Ex2_AJR.csv` location.
- Reference script for "Labor market Tutorial 6" (the B6 course script?).
- Approve the package installs above.
