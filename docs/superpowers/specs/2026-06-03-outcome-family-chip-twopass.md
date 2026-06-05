# Spec: Outcome Family Chip + Two-Pass Estimation

**Date:** 2026-06-03  
**Status:** OPEN  
**Author:** Franco Medero

---

## Problem

The estimator dropdown grows without bound as new identification × outcome combinations are added. Every hybrid (PoissonFE, SunAbraham, planned IV-Poisson) becomes a new named entry. With 8+ identification strategies and 4 outcome families, listing all combinations is untenable. Additionally, multi-step estimation (SCM→FE, RDD→IV, FE→IV) has no native workflow — users must manually copy columns between models.

---

## Solution Overview

Two parts, shipped in order:

**Part 1 — Outcome Family Chip:** Refactor the estimator selector into two orthogonal dimensions: identification strategy (dropdown) × outcome family (chip row). Existing named hybrids (PoissonFE, SunAbraham, Poisson GLM, Logit, Probit, WLS) are remapped to the new two-dimensional system. IV-Poisson (2SLS + Poisson chip) is added as new math.

**Part 2 — Two-Pass Extraction:** After any estimation, expose an "Extract to dataset" panel that saves model outputs (residuals, fitted values, first-stage fitted values, SC gap, etc.) back into the working dataset as auditable `mutate` pipeline steps.

---

## Part 1: Outcome Family Chip

### 1.1 Dropdown Refactor

`EstimatorSidebar.jsx` → `MODELS` array restructured to pure identification strategies. The `"Limited Dependent"` group is removed. WLS is absorbed into OLS (via a weights toggle in ModelConfiguration). New groups and order:

| Group | Strategies |
|---|---|
| **Linear** | OLS |
| **Panel** | FE, FD, LSDV, TWFE DiD, Event Study, CS DiD |
| **DiD** | DiD 2×2 |
| **IV** | 2SLS / IV, Two-Step GMM, LIML |
| **RD** | Sharp RDD, Fuzzy RDD, Spatial RD |
| **Synthetic** | Synthetic Control |

Group names mirror R package territory without using package names directly (fixest → Panel/DiD, AER/gmm → IV, rdrobust → RD, Synth → Synthetic).

### 1.2 Chip Row

A new "Outcome family" chip row renders **below** the strategy dropdown, inside the `EstimatorSidebar` `Section`. It is **hidden** when the selected strategy only supports Linear (no chip row rendered, no visual noise).

Chip states:
- **Active** (filled teal/purple border): currently selected family
- **Available** (default border): valid for this strategy, clickable
- **Planned** (dimmed, not clickable): valid in principle, not yet implemented
- **Not rendered**: family is not applicable to this strategy at all

Family × strategy support matrix:

| Strategy | Linear | Poisson | Logit | Probit |
|---|---|---|---|---|
| OLS | ✓ | ✓ | ✓ | ✓ |
| FE | ✓ | ✓ | planned | planned |
| TWFE DiD | ✓ | planned | — | — |
| Event Study | ✓ | ✓ | — | — |
| DiD 2×2 | ✓ | planned | — | — |
| CS DiD | ✓ | — | — | — |
| 2SLS | ✓ | ✓ (new) | — | — |
| GMM | ✓ | — | — | — |
| LIML | ✓ | — | — | — |
| FD | ✓ | — | — | — |
| LSDV | ✓ | — | — | — |
| Sharp RDD | ✓ | — | — | — |
| Fuzzy RDD | ✓ | — | — | — |
| Spatial RD | ✓ | — | — | — |
| Synthetic | ✓ | — | — | — |

Chip row **hides** for: FD, LSDV, CS DiD, GMM, LIML, Sharp RDD, Fuzzy RDD, Spatial RD, Synthetic Control.

When the chip row is visible, a result hint line below the chips shows the resolved estimator name and equation form. Example: strategy=2SLS + family=Poisson → `IV-Poisson · E[Y|X,Z] = exp(Xβ)`.

### 1.3 State Model

`ModelingTab.jsx` adds:

```js
const [family, setFamily] = useState("linear"); // "linear"|"poisson"|"logit"|"probit"
```

`EstimatorSidebar` receives `family` + `onFamilySelect(family)` as props. When `model` changes, `family` resets to `"linear"` unless the new strategy also supports the current family (e.g. OLS→FE while on Poisson stays on Poisson).

Internal dispatch in `estimate()`:

```
model="OLS"        + family="linear"  → runOLS()
model="OLS"        + family="poisson" → runPoisson()
model="OLS"        + family="logit"   → runLogit()
model="OLS"        + family="probit"  → runProbit()
model="FE"         + family="linear"  → runFE()
model="FE"         + family="poisson" → runPoissonFE()
model="EventStudy" + family="linear"  → runEventStudy()
model="EventStudy" + family="poisson" → runSunAbraham()
model="2SLS"       + family="linear"  → run2SLS()
model="2SLS"       + family="poisson" → runIVPoisson()   ← new
```

### 1.4 WLS Migration

WLS is removed from the dropdown. OLS ModelConfiguration gains a "Survey weights" collapsible toggle (already has `wCol` state). When `wCol` is set and `model="OLS"` and `family="linear"`, the dispatch routes to `runWLS()`. No state changes to `wCol`, `wVars`, or the WLS math path.

### 1.5 Old → New Mapping

| Old dropdown entry | New selection | Math change |
|---|---|---|
| Poisson GLM | OLS + Poisson chip | none |
| Logit | OLS + Logit chip | none |
| Probit | OLS + Probit chip | none |
| Poisson FE (PPML) | FE + Poisson chip | none |
| Event Study (Sun & Abraham) | Event Study + Poisson chip | none |
| WLS | OLS + Weights toggle | none |
| *(new)* IV-Poisson | 2SLS + Poisson chip | new engine |

Result type strings (`"PoissonFE"`, `"SunAbraham"`, `"Poisson"`, `"Logit"`, `"Probit"`) are **unchanged** — all result rendering, export, and AI interpretation code is unaffected.

### 1.6 IV-Poisson Math Engine

New function `runIVPoisson(rows, y, xCols, zCols, seOpts)` in `GMMEngine.js`.

**Structural equation:** E[Y|X,Z] = exp(Xβ), with endogenous regressors in X instrumented by Z.

**Moment conditions:** `g(β) = (1/n) Σ Zᵢ(yᵢ − exp(Xᵢβ))`

**Score Jacobian:** `G = −(1/n) Z'diag(μ)X` where `μᵢ = exp(Xᵢβ)`

**Two-step exponential GMM:**
1. Initialize β from 2SLS on log(Y+1) (or β=0 if Y has zeros)
2. Step 1: Newton-Raphson with W=I until convergence (`‖Δβ‖ < 1e-8`, max 100 iter): `β ← β − [G'G]⁻¹G'g`
3. Build `Ω = (1/n) Σ Zᵢ Zᵢ' εᵢ²` where `εᵢ = yᵢ − exp(Xᵢβ̂₁)`
4. Step 2: iterate with `W = Ω⁻¹`: `β ← β − [G'WG]⁻¹G'Wg` until convergence

**Asymptotic variance:** `V = (1/n)[G'Ω⁻¹G]⁻¹`

**SE types supported:**
- `classical`: sandwich as above
- `HC1`: `Ω` built with HC1 scaling `n/(n−k)`
- `clustered`: `Ω = (1/n) Σ_g [Σ_{i∈g} Zᵢεᵢ][Σ_{i∈g} Zᵢεᵢ]'` with G/(G−1) small-sample correction

**First-stage F-statistic:** OLS of each endogenous X on Z (same as `run2SLS` first stage). Weak-instrument warning if F < 10.

**Overidentification J-test:** when `dim(Z) > dim(X)`: `J = n·g'Ω⁻¹g ~ χ²(dim(Z)−dim(X))`

**Result type:** `"IVPoisson"`. Result shape mirrors `runGMM()` output: `{ type, beta, se, tStats, pVals, varNames, n, k, df, firstStageF, jStat, jDf, jPVal, ... }`.

**Validation target:** R `gmm::gmm(y ~ x, ~ z, family=poisson(link="log"))` — add fixtures to `engineValidation.js`.

---

## Part 2: Two-Pass Extraction

### 2.1 Concept

After any successful estimation, the result panel gains a collapsible **"Extract to dataset"** section. Clicking a column checkbox adds it to the current working dataset as a `mutate` pipeline step. The step is auditable in the History sidebar and included in R/Python/Stata replication scripts.

### 2.2 Columns per Estimator

| Estimator group | Extractable columns |
|---|---|
| All linear (OLS, FE, 2SLS, RDD, DiD…) | `ŷ` fitted values, `ê` residuals, `h` leverage (h_ii) |
| 2SLS / IV-Poisson | `+` `X̂_{endo}` first-stage fitted value (one per endogenous var) |
| Synthetic Control | `ŷ_SC` synthetic outcome, `gap` = y − ŷ_SC |
| Poisson variants | `μ̂` fitted rate exp(Xβ), `ê_pearson` Pearson residual (y−μ)/√μ |
| Event Study | `rel_time` relative period indicator (already in data after pipeline step) |

### 2.3 Workflow Examples

**FE + IV (Hausman-Taylor style):**
1. Run FE → extract `ê` (within residuals)
2. Run 2SLS with `ê` as additional control or transformed Y

**SCM + FE:**
1. Run Synthetic Control → extract `gap` column
2. Run FE on `gap` as outcome

**RDD + IV:**
1. Run 2SLS → extract `X̂_endo` (first-stage fitted value)
2. Run Sharp RDD using `X̂_endo` as running variable

### 2.4 Implementation

- UI: collapsible `<ExtractPanel>` component rendered at bottom of each result block in `ModelingTab.jsx`
- Each checkbox click dispatches an `addStep` with a **new step type `inject_column`** (added to `runner.js` + `registry.js`). The step stores `{ colName, values: Float64Array }` — a dense array aligned to the current pipeline row order. Runner replays by splicing the column back in; if row count has changed since extraction (pipeline mutated upstream), the step emits a warning and no-ops rather than corrupting the dataset.
- Column naming convention: `{yVar}__hat`, `{yVar}__resid`, `{xVar}__hat1s`, `sc__gap`, `poisson__mu`
- Replication scripts: `inject_column` is translated to a comment block with the fitted values as a vector literal (R `c(...)`, Python `np.array([...])`, Stata `matrix define`) — verbose but reproducible

---

## Out of Scope

- Logit FE (conditional logit) — planned chip but no math this cycle
- Poisson TWFE DiD + Poisson DiD 2×2 — planned chips, math deferred
- DuckDB SQL fast path for IV-Poisson — deferred; JS engine only for now
- Multi-step extraction UI (drag-and-drop chaining) — deferred post-MVP

---

## Files Touched

**Part 1:**
- `src/components/modeling/EstimatorSidebar.jsx` — MODELS array, chip row, family prop
- `src/components/ModelingTab.jsx` — `family` state, dispatch table, WLS routing
- `src/components/modeling/ModelConfiguration.jsx` — WLS weights toggle under OLS
- `src/math/GMMEngine.js` — `runIVPoisson()` + export
- `src/math/index.js` — re-export `runIVPoisson`
- `src/math/__validation__/engineValidation.js` — IV-Poisson R fixtures

**Part 2:**
- `src/components/ModelingTab.jsx` — render `<ExtractPanel>` per result block
- `src/components/modeling/ExtractPanel.jsx` — new component (collapsible, checkboxes)
- `src/pipeline/runner.js` — add `inject_column` step type
- `src/pipeline/registry.js` — register `inject_column`
- `src/services/export/rScript.js` / `pythonScript.js` / `stataScript.js` — translate `inject_column` to vector literal comment block
