# Fase V4 — Plot Validation

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans.

**Track:** B — Module hardening
**Status:** Queued.
**Blocks:** nothing.

**Goal:** Validate every plot rendered by EconSolver against `ggplot2` structural conventions. The bar is **structural parity**, not pixel-diff: same number of layers, same scale expansion, same legend ordering, same color mapping, same reference lines, same axis ranges, same annotation positions. If R `ggplot2` would draw the plot one way and EconSolver draws it differently, that's a discrepancy worth flagging.

**Why this matters:** plots are the final artifact a thesis student paste into their paper. A misaligned event-study zero line, a flipped axis on RDD, or a missing CI ribbon undermines an otherwise correct estimate. Estimators have R parity; plots do not.

**Tech Stack:** Observable Plot 0.6 CDN (EconSolver), R `ggplot2` + `cowplot` + `patchwork` (reference). Comparison via structural JSON exports — never pixel diffs.

**Reference materials:**
- `.claude/skills/ggplot2/*.pdf` — ggplot2 grammar of graphics, axis/scale defaults, legend semantics.
- Existing skill: `~/.claude/skills/ggplot2-plot-design/SKILL.md` — auto-triggers on plot work; rules for zero rules, scale expansion, boxplot grouping, param classification.

---

## Plot surface covered

### `src/components/modeling/ModelPlots.jsx` (22 exports)

| Plot function | Estimator | What it draws |
|---|---|---|
| `PlotSelector` | any | Tab strip wrapper — structural only (tab order, default selection) |
| `YFittedPlot` | OLS / panel | scatter of fitted vs residual; 0-line; mean residual annotation |
| `PartialPlot` | OLS | partial regression scatter (Frisch-Waugh-Lovell) + fit line + slope label |
| `RDDPlot` | Sharp/Fuzzy RDD | bin-mean scatter, cutoff vline, local linear fits on each side, CI ribbon |
| `DiDPlot` | DiD 2x2 | 4-point means plot (pre/post × treat/control), parallel-trends slope, counterfactual line |
| `EventStudyPlot` | Event Study | dynamic coefficients with 95% CIs around event time; **k=−1 must be omitted (reference period)**; vline at k=0 |
| `FirstStagePlot` | 2SLS | endog ~ instrument scatter + fit line + F-stat annotation |
| `RDDBandwidthPlot` | Sharp RDD | LATE estimate ± SE band as h varies; vline at IK optimal h |
| `RDDCovariateBalance` | Sharp RDD | per-covariate jump at cutoff (point + CI per row) |
| `McCraryPlot` | RDD diagnostic | density of running variable, cutoff vline, ratio test annotation |
| `YXhatPlot` | 2SLS | Y vs X̂ (second-stage scatter) + fit line |
| `XvsXhatPlot` | 2SLS | X vs X̂ scatter, F-stat + weak-instrument flag |
| `EndogeneityPlot` | 2SLS | first-stage residual vs second-stage residual (Hausman visual) |
| `ROCCurve` | Logit/Probit | FPR vs TPR, diagonal reference, AUC annotation |
| `PredProbHistogram` | Logit/Probit | overlapping histogram of P̂ for y=0 vs y=1 |
| `EventCoeffsPlot` | Event Study | alternate event-coeff renderer (used by `ResearchCoach`) |
| `SyntheticGapPlot` | Synth Control | actual vs synthetic line + treat-time vline |
| `SyntheticDiffPlot` | Synth Control | gap (actual − synthetic) over time + treat-time vline + 0-line |
| `SyntheticPlaceboPlot` | Synth Control | treated unit gap + N placebo gaps (grey lines) + treat-time vline |
| `SyntheticMSPEPlot` | Synth Control | post/pre MSPE ratio histogram, treated unit highlight |

### `src/components/modeling/ResidualPlots.jsx` (3 exports)
- `ResidualVsFitted` — scatter + LOESS smoother + 0-line.
- `QQPlot` — sample vs theoretical normal quantiles + 45° reference.
- `ResidualPlots` — composite wrapper (counts as structural-only).

### `src/components/PlotBuilder.jsx`
11 geoms: `point`, `line`, `bar`, `histogram`, `density`, `smooth`, `boxplot`, `errorbar`, `ribbon`, `hline`, `vline`. Plus `position` (stack/jitter) and `palette` presets.

### `src/ReportingModule.jsx`
Forest plot for multi-model coefficient comparison.

---

## File structure

Create:
```
src/components/__validation__/
├── faseV4Validation.js         ← browser harness: render each plot, export structural JSON, diff vs reference
├── faseV4StructuralSnapshot.js ← helper: walks an SVG and emits {layers, axes, legend, refs, annotations}
└── faseV4References.json       ← committed reference JSON from R (one entry per plot fixture)

src/components/__validation__/R/
└── faseV4RReferences.R          ← R script that generates ggplot2 reference plots → exports ggplot_build() data → JSON
```

Reuse existing fixture rows from `engineValidation.js` where the estimator outputs already feed the plot.

---

## Validation tolerances

| Aspect | Tolerance |
|---|---|
| Number of layers | exact match |
| Layer order | exact match (reference lines below data; annotations on top) |
| Scale expansion | ggplot2 default = 5% (`expansion(mult = 0.05)`); EconSolver must match within 1% absolute on the [min, max] range |
| Legend label order | exact match — factor-level order, NOT alphabetical |
| Color palette | each series must map to expected `C.teal`/`C.gold`/`C.blue`/`C.muted` slot |
| CI ribbon half-width | 1.96·SE within 1e-6 |
| Reference line positions | numeric exact (e.g. RDD cutoff, EventStudy k=0, DiD treat-time) |
| Axis tick count | within ±1 of ggplot2 `scales::breaks_pretty()` choice |
| Annotation count and position | exact text match; position within 5% of axis range |
| Forest plot ordering | bottom-to-top by user-defined order; intercept omitted unless explicit |
| ROC axes | [0,1] × [0,1] with diagonal reference line at slope 1 |

Pixel diffs are **out of scope** — Observable Plot and ggplot2 use different renderers.

---

## Task 0 — Build the structural-snapshot helper

**File:** `src/components/__validation__/faseV4StructuralSnapshot.js`

Walk a rendered SVG and emit a normalized JSON snapshot:

```js
{
  plotId: "RDDPlot",
  axes:   { x: {min, max, ticks: [...]}, y: {min, max, ticks: [...]} },
  layers: [
    { type: "vline",  x: 0,    style: "dashed" },
    { type: "point",  count: 80, color: "C.teal" },
    { type: "line",   slope: 0.34, intercept: 1.2, color: "C.teal" },
    { type: "ribbon", halfWidth: 1.96, color: "C.teal", opacity: 0.2 },
    { type: "text",   content: "LATE = 0.34 (0.04)", x: 0.05, y: 0.95 }
  ],
  legend: { entries: ["Below cutoff", "Above cutoff"] }
}
```

Helper API:
```js
snapshot(svgNode) → snapshotJSON
diffSnapshots(actual, expected, tolerances) → { ok, diffs: [...] }
```

This helper is reused by every fixture. Build it once, test it against a trivial scatter plot first.

---

## Task 1 — Generate ggplot2 reference renders

**File:** `src/components/__validation__/R/faseV4RReferences.R`

For each plot fixture, render the ggplot2 equivalent and emit `ggplot_build(p)$data` as JSON:

```r
library(ggplot2); library(jsonlite); library(rdrobust); library(plm); library(AER); library(Synth)

# Fixture: RDD plot
set.seed(42)
n <- 500; x <- runif(n, -1, 1); y <- 1 + 0.3*(x>=0) + 0.5*x + rnorm(n, sd=0.2)
fit <- rdrobust(y, x)
p <- ggplot(data.frame(x, y), aes(x, y)) +
  geom_point(alpha = 0.3) +
  geom_vline(xintercept = 0, linetype = "dashed") +
  geom_smooth(data = subset(data.frame(x,y), x < 0), method = "lm", color = "#6ec8b4") +
  geom_smooth(data = subset(data.frame(x,y), x >= 0), method = "lm", color = "#c8a96e") +
  annotate("text", x = -0.9, y = max(y), label = sprintf("LATE = %.3f (%.3f)", fit$coef[1,1], fit$se[1,1]))

snap <- list(
  plotId = "RDDPlot",
  axes   = list(x = list(min = -1, max = 1), y = list(min = min(y), max = max(y))),
  layers = ggplot_build(p)$data
)
write_json(snap, "faseV4References.json", auto_unbox = TRUE, pretty = TRUE)
```

Generate references for the **22 ModelPlots functions + 3 ResidualPlots + 11 PlotBuilder geoms + forest plot = 37 fixtures**. Group by estimator family. Each fixture seeded with `set.seed(42)`.

---

## Task 2 — Browser harness

**File:** `src/components/__validation__/faseV4Validation.js`

```js
export async function runFaseV4Validation() {
  const references = await fetch("/__validation__/faseV4References.json").then(r => r.json());
  const results = [];

  for (const ref of references) {
    const fixture = await buildFixture(ref.plotId);     // rows + result obj
    const svg     = await renderPlot(ref.plotId, fixture);
    const actual  = snapshot(svg);
    const diff    = diffSnapshots(actual, ref, tolerances[ref.plotId]);
    results.push({ plotId: ref.plotId, ok: diff.ok, diffs: diff.diffs });
  }

  console.table(results.map(r => ({ plot: r.plotId, ok: r.ok, n_diffs: r.diffs.length })));
  window.__validation.faseV4 = results;
  return results;
}
```

Render plots in a hidden offscreen div. Use `requestAnimationFrame` to ensure layout settles before snapshotting.

---

## Task 3 — Fix discrepancies

**Expected hotspots** (based on known ggplot2 vs Observable Plot drift):

1. **Scale expansion.** Observable Plot defaults to tight bounds; ggplot2 expands by 5%. Patch `nice` flags or pass explicit `domain` extended by 5%.
2. **Legend order.** Observable Plot sorts alphabetically by default; ggplot2 uses factor-level order. Audit every plot with a categorical aesthetic.
3. **Boxplot grouping.** Side-by-side boxplots (one per category) — verify dodge is correct, not stacked.
4. **EventStudyPlot k=−1.** Reference period must be omitted (not drawn at 0) — verify the data filter actually removes that row before plotting.
5. **DiD pre/post annotation.** ggplot2 convention places means slightly outside the plot area; EconSolver should mimic.
6. **RDD ribbon half-width.** Must be 1.96·SE for 95% CI. Bug-prone — verify.
7. **ROC diagonal.** Must use `geom_abline(slope=1, intercept=0)` exact match.
8. **Forest plot ordering.** Bottom-to-top with intercept omitted unless explicit. ggplot2 reverses `factor` levels for `coord_flip()` — EconSolver renders horizontally without flip, so order is reversed.
9. **Color palette mapping.** Each estimator family should map consistently: treated = `C.teal`, control = `C.gold`, neutral = `C.blue`.
10. **Synthetic placebo grey lines.** Must be drawn **below** the treated unit line (layer order), with low alpha (~0.3).

Each fix is a surgical `Edit` against the offending plot function. No full rewrites.

---

## Task 4 — CLAUDE.md update + commits

After all 37 fixtures pass, update CLAUDE.md "Estimators implemented" / "Plot surface" with a new line referencing `window.__validation.faseV4` and `faseV4References.json`.

Commit pattern (one commit per logical group):
- `test(plots): Fase V4 — ggplot2 structural references for ModelPlots`
- `test(plots): Fase V4 — browser harness vs ggplot2 references`
- `fix(plots): Fase V4 — scale expansion, legend order, CI ribbon corrections`
- `docs: Fase V4 — plot validation complete`

---

## Out of scope

- Pixel-perfect rendering — different renderers, not worth pursuing.
- Animation / transitions — no plots have these.
- Interactive tooltips — UX feature, not a numerical correctness issue.
- Map plots (`SpatialTab`) — covered by Fase V1.
- LaTeX table output — covered by Fase X2 (replication integrity).

---

## Pre-merge gate — Supabase feedback check (MANDATORY)

Before marking this fase complete, run the `feedback-collector` agent to pull unprocessed rows from the Supabase `feedback` table into `ClaudeFB.md`. Then:

1. **Filter** feedback by scope tags that touch this fase: `plot`, `chart`, `figure`, `axis`, `legend`, `color`, `palette`, `ggplot`, `RDD plot`, `DiD plot`, `event study`, `forest`, `ROC`, `residual`, `QQ`.
2. For every open row in scope:
   - **Fix-now:** address before concluding.
   - **Fix-later:** file in `BugTriage.md` with a `FaseV4 →` reference.
   - **Wontfix:** document rationale in `ClaudeFB.md` and resolve in Supabase.
3. Concluding this fase without an empty in-scope queue in `ClaudeFB.md` is a blocker.

The structural harness catches layer count and ordering; user-reported issues catch the things that make a plot publication-unready (illegible tick density, overlapping labels, color choices that fail print).

---

## Done criteria

- [ ] 37 fixtures committed in `faseV4References.json`.
- [ ] `window.__validation.faseV4` returns `ok=true` for every fixture.
- [ ] Diff log shows zero discrepancies for layer count, layer order, reference lines, legend order, CI ribbon half-width, axis ranges.
- [ ] CLAUDE.md updated with V4 status line.
- [ ] All known hotspots in Task 3 audited (passing or fixed).
