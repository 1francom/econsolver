# Replication script completeness — Plot Builder load line + Simulate unification

Date: 2026-07-28
Status: OPEN (spec approved by Franco, implementation plan not yet written)

## Purpose

Two related Supabase feedback items (collected 2026-07-28) about replication
scripts being incomplete:

1. "Replication codes of the plots must have the lines to load datasets as
   well" (2026-07-05, resurfaced today).
2. "Update the replication script, currently it replicates only the DGP"
   (Simulate tab, 2026-07-28).

Both are instances of the same underlying principle already established
elsewhere in the app (CLAUDE.md's "Report AI" work, `loadLine.js`): a
replication script the user actually runs must be self-contained — it should
never assume a `df` that doesn't exist, and it should reflect everything the
user did, not just the first step.

## Part A — Plot Builder standalone script missing the dataset load line

### Root-cause finding (differs from the literal feedback text)

The bug is **not** Stata-specific, and it's **not** in the two places that
already work correctly:

- The Report tab's unified script already loads every session dataset
  upfront (the 2026-06-12 multi-dataset fix), so plots embedded there
  correctly reference an already-loaded `df_<name>`.
- Plots embedded inside a model result in `ModelingTab.jsx` get a
  `scriptPreamble` prop that reuses the model's own script (which already
  has its load line via `modelPlotScript.js`'s `buildModelPlotPreamble`).

The actual gap: `PlotBuilder.jsx`'s own **standalone** "copy script" button
(`copyPlotScript`, used when Explore's "◈ Plot Builder" tab is used in free
mode, no model/report context) never had a load line for **any** of the
three languages. `buildGgplot`/`buildMatplotlibPlot`/`buildStataPlot`
(`plotScript.js`) are pure plot-code generators that were never designed to
emit one — the R/Python `buildRLoadLine`/`buildPyLoadLine` calls elsewhere
in that file belong to `geoLoadLines`, a *different*, spatial-map-specific
function, not the general plot path.

### Fix

- `ExplorerModule.jsx`: pass the active dataset's real `filename` and
  `loadOpts` down to `<PlotBuilder>` as new props, read from the same
  dataset-registry source `sessionSnapshot.js` already uses for the Report
  tab.
- `PlotBuilder.jsx`: accept those props. In `copyPlotScript`, when there is
  no `scriptPreamble` (i.e. not model-embedded — that path already has its
  load line), prepend a real load line before the generated plot code, using
  the existing `buildRLoadLine` / `buildPyLoadLine` / `buildStataLoadLine`
  (`services/export/loadLine.js`) — the same three functions already used
  for model scripts, so behavior stays consistent across the app rather than
  introducing a fourth load-line implementation.
- `buildGgplot`/`buildMatplotlibPlot`/`buildStataPlot` themselves are **not
  modified** — they stay pure plot-code generators. Composition (load line +
  plot code) happens at the call site, mirroring the existing `geoLoadLines`
  pattern in the same file.

## Part B — Simulate replication script: unify DGP + downstream operations

### Current state (more fragmented than the feedback implies)

| Section | Has its own script export today? |
|---|---|
| DGP (main Simulate script) | Yes — the only thing currently in the main script |
| Variables / Computed (StatWorkspace) | Yes — separate download button, `generateCalcScript` |
| Resampling (StatWorkspace) | Yes — separate "copy script" button, `generateStatInferenceScript` |
| Sample Tests (SampleTestPanel) | Yes — separate per-test "copy script" button, `generateStatInferenceScript` |
| Distributions — draw + add as column (StatWorkspace) | **No script export, and doesn't even log the operation** — a real gap the feedback didn't name explicitly |
| Probability Calculator (StatWorkspace) | N/A — live calculator, creates no data, out of scope |

The user's actual expectation (confirmed in discussion): **one script** —
the one already opened from the Simulate tab — should reflect everything
done in that session, not just the DGP. The scattered per-section buttons
are not the problem by themselves; the missing aggregation is.

### Architecture

- **Reuse the existing cross-module session log**
  (`services/session/sessionLog.jsx`), not a state-lifting refactor.
  `appendLog` is already called by `StatWorkspace.jsx` (resampling/
  permutation ops) and `QTEPanel.jsx`, and the log's documented purpose is
  exactly this: *"so the Report AI can generate a faithful unified
  replication script."* Each entry already carries `module`, `opType`,
  `params`, `label`, in chronological order — which is what a script needs,
  since operation order matters for replication.
- **Session boundary (important, was ambiguous in an earlier draft of this
  spec):** the session log is a project-wide timeline, **persisted across
  visits** (IDB `timeline_<pid>`), not scoped to one tab visit. Filtering
  only by `module`/`opType` would let stale entries from a previous visit
  (e.g. resampling done on a DGP the user has since discarded or
  regenerated with a different seed) leak into today's script. Fix: capture
  the log's current length as a marker when `SimulateTab` mounts, and only
  include entries appended **after** that marker — i.e. only what happened
  in this page load. (`StatWorkspace`/`SampleTestPanel` are only ever
  mounted from `SimulateTab`, so no cross-module contamination risk beyond
  this — confirmed via `Grep`, both have exactly one call site.)
- **The main Simulate script generator** (already a plain JS function, no
  AI call — stays that way) is extended to: (1) emit the DGP as it does
  today, then (2) walk the session log's entries after the mount marker, in
  order, and for each, **call the existing generator already built for that
  `opType`** rather than writing new translation logic:
  - Resampling / permutation / sample-test entries →
    `generateStatInferenceScript(lang, op, params, result)` (already shared
    by the Resampling and Sample Test "copy script" buttons).
  - Variables / Computed entries → `generateCalcScript(lang, variables,
    computeds)`.
- **Gap to close**: the Distributions section (`DistributionsSection` in
  `StatWorkspace.jsx`) neither logs its operation nor has any script
  generator. Fix: (a) add the missing `appendLog` call in
  `addToDataset`/`newDataset` (module/opType/params describing the drawn
  distribution, sample size, seed, column name), (b) add a small generator
  function for that `opType` — this is nearly free, since it can call
  `distExprR` / `distExprPy` / `distExprStata` directly from
  `math/dgpScript.js`, the same functions already used to translate DGP
  variable draws.
- **Probability Calculator is out of scope** — it's a live calculator with
  no data/column output, nothing to replicate.
- **Existing per-section "copy script" buttons stay** — this is additive,
  not a replacement. If Franco finds them redundant/confusing once the
  unified script exists, they can be removed later; not doing that now.

## Testing / validation

Neither part touches `src/math/` engines, so the 6dp/4dp R-benchmark harness
doesn't apply. Validation is: `npm run build` + `npm run lint:undef` green,
and Franco manually verifying (per his standing instruction — no
browser-automation tools in this repo) that:
- A Plot Builder script copied standalone (Explore tab, no model context)
  runs top-to-bottom in a fresh R/Python/Stata session without a
  pre-existing `df`.
- A Simulate session that uses the DGP + at least one of
  Resampling/Sample-Test/Variables/Distributions produces one script
  covering all of them, in the order performed.

## Out of scope

- Removing/consolidating the existing per-section "copy script" buttons.
- Any change to the Report tab's unified script (already correct) or to
  model-embedded plots (already correct via `scriptPreamble`).
- Probability Calculator replication (no data output, nothing to replicate).
