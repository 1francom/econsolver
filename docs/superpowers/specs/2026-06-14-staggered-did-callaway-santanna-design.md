# Staggered-DiD framework + Callaway-Sant'Anna complete + DiD/Event-Study UI reorg

**Date:** 2026-06-14
**Status:** OPEN
**Author:** Franco (design) + Claude (drafting)
**Scope owner:** this is **Spec 1** of a decomposed effort. Spec 2 (de Chaisemartin & D'Haultfœuille) and a roadmap (BJS, Gardner 2SDID, Liu-Wang-Xu, Wooldridge) are tracked separately.

---

## 1. Problem

Litux's Callaway-Sant'Anna (CS) estimator (`src/math/CallawayEngine.js`) does not match R's `did` package. Root causes, in order of impact:

1. **Covariates ignored.** The engine is a plain group-mean DiD. The `did` Rmd example uses `xformla = ~X` with a DGP where `Xᵢ ~ N(μ_{Dᵢ}, 1)` and `μ` differs by group — so *unconditional* parallel trends fails and CS only recovers the truth conditional on X. Against any `~X` run the engine is biased.
2. **Wrong base period.** The engine always uses `g−1` ("universal"). The `did` default is `"varying"` (pre-treatment placebos use `t−1`), which is why R reports non-zero `e = −1`. Every pre-trend coefficient diverges.
3. **Standard errors don't match `did`.** Hand-rolled influence function; `did` uses an analytic IF SE (`bstrap=FALSE`) or, by default, a Mammen **multiplier bootstrap with uniform/simultaneous confidence bands** (crit value ≠ 1.96).
4. **Only the dynamic aggregation exists.** The Rmd uses four `aggte` types (simple, dynamic, group, calendar), each with its own `ggdid` plot. The group-time `ggdid` facet plot — the core CS output — does not exist in Litux at all.

Separately, the DiD-family estimators are scattered across the UI ("Panel" holds TWFE/EventStudy/CS, "DiD" holds only 2×2), and Sun-Abraham exists in the engine/dispatch but isn't in the menu.

## 2. Goals & non-goals

**Goals (Spec 1):**
- Rewrite CS to match `did` to **6dp coefficients / 4dp analytic SE**, implementing the arguments `did` actually exposes: `est_method ∈ {dr, reg, ipw}`, `control_group ∈ {nevertreated, notyettreated}`, `base_period ∈ {varying, universal}`, `anticipation`, `xformla` (covariates).
- All four aggregations (simple, dynamic, group, calendar) + overall ATT (group aggregation = recommended summary) + parallel-trends Wald pre-test.
- Multiplier-bootstrap uniform bands (seeded) **and** analytic IF SE.
- The four `ggdid`-style plots, including the faceted group-time plot.
- Build these as a **shared, estimator-agnostic staggered-DiD framework** so CH and future estimators reuse the result contract, aggregation, inference, plots, UI, and export.
- Reorganize the estimator menu into **Panel / DiD / Event Study** groups (an estimator may appear in more than one group).
- Faithful R/Stata/Python replication export.

**Non-goals (roadmap, tracked OPEN):** CH (Spec 2); BJS / Gardner 2SDID / Liu-Wang-Xu / Wooldridge; repeated cross-sections (`panel=FALSE`); DuckDB large-n push-down; unbalanced-panel `allow_unbalanced_panel=TRUE` (v1 balances by dropping incomplete units, with a warning, matching `did` default).

## 3. Locked decisions

| # | Decision |
|---|----------|
| D1 | Covariate support = **doubly-robust** (Sant'Anna-Zhao 2020), plus `reg` and `ipw`. |
| D2 | Inference = **analytic IF SE always** (deterministic, tightly validated) + **Mammen multiplier bootstrap with uniform bands** (default view, B=999, seed=42). |
| D3 | Aggregations = simple, dynamic, group, calendar (all four). |
| D4 | Plots = group-time facet (`ggdid`), dynamic event study, group, calendar. |
| D5 | Scale = **JS-only, row-count guard** (~200k rows → warn + suggest aggregating). DuckDB deferred. |
| D6 | Menu groups: **Panel** {FE, FD, LSDV}; **DiD** {2×2, Staggered-DiD/CH [planned], TWFE, Sun-Abraham, Callaway-Sant'Anna}; **Event Study** {Classical, Sun-Abraham, Callaway-Sant'Anna}. SunAb & CS appear in both DiD and Event Study. |
| D7 | "Staggered DiD" standalone entry = **de Chaisemartin & D'Haultfœuille (CH)** — added dimmed/"planned" in Spec 1, implemented in Spec 2. |
| D8 | The two entry points (DiD vs Event Study) differ **only** in which result tab opens first and which aggregation the banner shows. Same engine, same config. |
| D9 | Panel data only for v1. |

## 4. Architecture

New subfolder `src/math/did/` (mirrors the reserved-subfolder convention):

### 4.1 `src/math/did/drdid.js` — 2×2 building block
Sant'Anna & Zhao (2020) doubly-robust DiD for two periods/two groups. Pure JS, no React.

`compute2x2({ treatedΔY, controlΔY, treatedX, controlX, estMethod })` → `{ att, psiTreated[], psiControl[] }` where `ΔYᵢ = Y_{i,t} − Y_{i,base}` and the ψ are per-unit influence-function contributions.
- **reg**: OLS of ΔY on `[1,X]` on controls → β̂; `att = mean_T(ΔY) − mean_T([1,X]β̂)`. (Reuses LinearEngine OLS.)
- **ipw**: logit of treated-vs-control on `[1,X]` → p̂; Abadie stabilized-weight ATT. (Reuses NonLinearEngine `runLogit`.)
- **dr**: Sant'Anna-Zhao improved estimator combining OR + IPW; doubly-robust IF.
- `~1` (no X): all three reduce to `mean_T(ΔY) − mean_C(ΔY)`.

### 4.2 `src/math/did/staggeredDiD.js` — estimator-agnostic core
Takes the full `(g,t)` collection `{att, psi-over-all-units}` and produces everything downstream:
- **base-period resolution**: `varying` → pre uses `t−1`, post uses `g−1`; `universal` → always `g−1`; `anticipation δ` shifts treatment boundary to `g−δ` (base `g−δ−1`).
- **control-group selection**: never-treated (`G=∞`); not-yet-treated (`G>t`, excluding own cohort); auto-fallback never→not-yet with warning when no never-treated.
- **aggregations** (CS 2021 §4), each returning overall + by-index series + aggregated IF:
  - `simple`: weighted avg over post cells (t≥g), weights ∝ group size.
  - `dynamic(e)`: `θ(e)=Σ_g 1{g+e≤T}·ATT(g,g+e)·P(G=g | g+e≤T)`; overall = avg over e≥0.
  - `group(g)`: `θ_S(g)=avg_{t≥g}ATT(g,t)`; overall `=Σ_g θ_S(g)P(G=g)` (recommended summary).
  - `calendar(t)`: avg over g≤t of ATT(g,t); overall = avg over t.
- **inference**: analytic SE = `sd(IF)/√n` per parameter; **Mammen multiplier bootstrap** (B draws, seed) over the IF matrix → uniform critical value from the max-|t| family → simultaneous bands.
- **parallel-trends Wald pre-test**: joint test that all pre-period ATT(g,t)=0 (reported like `summary(att_gt)`).

### 4.3 `src/math/CallawayEngine.js` — rewritten orchestrator
Build cohorts/periods (drop first-period-treated units with warning); for each `(g,t)` resolve base + control, slice samples, call `drdid.compute2x2`, place ψ into the full-universe IF vector; hand the collection to `staggeredDiD`; return the result contract (§5). Exposed via `src/math/index.js` and `src/math/did/index.js` barrel.

## 5. Result contract

```js
{
  type: "CallawayCS",
  attgt: [{ g, t, e, att, se, ciLo, ciHi, n_g, isPre }],
  aggregations: {
    simple:   { overall, se, ciLo, ciHi },
    dynamic:  { overall, se, ciLo, ciHi, byE:[{ e, att, se, ciLo, ciHi }] },
    group:    { overall, se, ciLo, ciHi, byG:[{ g, att, se, ciLo, ciHi }] },
    calendar: { overall, se, ciLo, ciHi, byT:[{ t, att, se, ciLo, ciHi }] },
  },
  cohorts, periods, nUnits, n,
  controlGroup, basePeriod, estMethod, anticipation,
  inference: { method:"bootstrap"|"analytic", nBoot, seed, critVal },
  ptestWald: { stat, df, p },
  warnings: [],
}
```

`wrapCallawayCS` (EstimationResult.js) maps this and **keeps `beta/se/varNames/testStats/pVals` populated** from the entry's default aggregation (group for DiD entry, dynamic for Event-Study entry) so the existing `CoeffTable`, `ExportBar`, and comparison buffer keep working unchanged.

## 6. UI

### 6.1 Sidebar (`EstimatorSidebar.jsx`)
Add a `groups: string[]` field to MODELS items (defaults to `[group]` for back-compat). Dropdown renders an estimator once under each of its groups; selecting records the originating group → `csDefaultView` ("group" | "dynamic"). New `GROUP_ORDER` inserts "DiD" and "Event Study". Add the missing **Sun-Abraham** entry (engine already exists). Add **Staggered DiD (CH)** as a `planned` (dimmed, non-clickable) entry.

### 6.2 Config (`ModelConfiguration.jsx → CallawayCSConfig`)
Add controls: covariates X selector; `est_method` chips (dr/reg/ipw); `base_period` chips (varying/universal); `anticipation` int input; inference chips (bootstrap/analytic) + `nBoot` + `seed`. Existing first-treat/entity/time/control/event-window controls retained. New state lifted into ModelingTab and threaded through dispatch.

### 6.3 Results (`ModelingTab.jsx`)
Replace the single event-study plot with the tabbed panel: banner (overall ATT for the active aggregation + uniform band) + 5 tabs (Group-time ATT(g,t), Event study dynamic, Group, Calendar, ATT(g,t) table) + the parallel-trends pre-test line + warnings. Default tab from `csDefaultView`.

### 6.4 Plots — new `src/components/modeling/plots/didPlots.jsx`
`GroupTimePlot` (ggdid facet, small-multiples by cohort, red pre / blue post, uniform CI bars), `EventStudyDynamicPlot` (e=−1 reference + bands), `GroupAggPlot` (horizontal by cohort), `CalendarAggPlot` (by calendar period). All consume the §5 contract → reused by CH unchanged. Follows the ggplot2-plot-design skill.

## 7. Export (replication fidelity)
R (primary, faithful): `did::att_gt(yname,gname,idname,tname, xformla, control_group, base_period, anticipation, est_method, data) + aggte(out, type=…)`. Stata `csdid`, Python `csdid`/`differences` best-effort. Wire through the existing ExportBar/CodeEditor path and `rScript.js`/`stataScript.js`/`pythonScript.js` CS branches.

## 8. Validation & skill docs
- Create `…/.claude/skills/Estimators/staggered-did/` with `math.md`, `algorithm.md`, `tests.md` (Step 0 of improve-estimator flagged it empty/missing).
- Rewrite `src/math/__validation__/callawayRValidation.R` to generate fixtures from **both** the Rmd `build_sim_dataset` DGP and `mpdta`, across `dr/reg × never/notyet × varying/universal × {simple,dynamic,group,calendar}`. Mark `meta.source = "R did x.y.z"` (avoid circular benchmarks).
- `callawayValidation.js`: compare engine vs fixtures. Tolerance **6dp coef / 4dp analytic SE**; bootstrap bands checked structurally (crit>1.96, nominal coverage). **Franco runs R** (no Rscript on the dev machine).
- Index this spec in `ClaudePlan.md`; add CH (Spec 2) and the roadmap estimators as OPEN rows.

## 9. Risks
- **Matching `did` bootstrap SE exactly** is infeasible (RNG/seed differences) — mitigated by validating point estimates + analytic SE tightly and bands structurally.
- **DR numerical edge cases** (propensity overlap, singular OR design) → return NA + warning per cell, never silent drop (Estimators CLAUDE.md rule 4).
- **`base_period` semantics** are the subtle part — `algorithm.md` will pin the exact index arithmetic against `did` source before implementation.

## 10. Out of scope → roadmap rows (add to ClaudePlan index as OPEN)
CH (Spec 2); BJS; Gardner 2SDID (did2/2SDID); Liu-Wang-Xu (2022); Wooldridge flexible TWFE / Poisson DiD (Poisson engine already exists); repeated cross-sections; DuckDB large-n CS path.
