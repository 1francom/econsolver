# Spec — DGP Builder upgrade: categorical, group IDs, strings, row helpers

**Date:** 2026-06-02
**Status:** OPEN
**Module:** Stat & Simulation — `SimulateTab.jsx` DGP builder (+ `exprEval.worker.js`)
**Source of requirements:** Franco — "make it easier to simulate data and create variables; in R you
combine the DGP with dplyr / math functions for creating IDs." Compared against the data-carpentry
patterns in `index_qte_covAdjs.qmd`, `part1_covariate_adjustment.qmd`, `part2_quantile_regression.qmd`.

## What the current DGP builder can do (baseline)

Per `src/components/tabs/SimulateTab.jsx` + the matching `buildScope` in the expression worker:

- **Random draws:** Normal, Uniform, Bernoulli, Poisson, Exponential, t, Chi-squared (seeded PRNG).
- **Deterministic:** Constant, Sequence (`from`,`by` → 1,2,3,…,n), Expression (arbitrary row-wise JS
  over prior variables + `N`), ForLoop (recursive `prev`,`i`), WhileLoop (converged scalar).
- Variables reference earlier variables in scope; n + seed; Monte Carlo (OLS β̂ / single-stat);
  save to session; R/Python/Stata replication-script export.

## Gap vs the R scripts (what's missing for real causal-analysis workflows)

The lecture scripts lean heavily on **factors and group structure** — exactly what the builder can't
express today:

1. **No categorical / factor sampler.** Every covariate in the scripts is a factor — `leg_party`,
   `leg_white`, `female`, `black`, treatment groups `treat_deshawn`, `tg`. Bernoulli only gives 0/1
   with one probability. There is no "sample from levels {A,B,C} with probabilities" draw, so you
   can't simulate an RCT with labeled arms or multi-level demographics.
2. **No string/label output — values are silently coerced to 0.** `generate()` builds rows with
   `row[h] = scope[h]?.[i] ?? 0`, and `Constant` coerces non-numbers to `0`. So even if an
   Expression returned `"Control"`, it would not survive to the saved dataset. Factor *labels*
   (`ifelse(tg==1,"Black name","White name")`) are impossible end-to-end.
3. **No group / panel ID generator.** Only `Sequence` (1..n) exists. R routinely builds
   `rep(1:G, each=T)` (entity id) and `rep(1:T, times=G)` (time id) for panel/clustered data — which
   the Modeling module already consumes (FE, TWFE, clustered/two-way SE). Today you must hand-roll
   `Math.floor(i/T)` inside an Expression, which is undiscoverable and error-prone.
4. **Expression mode has no dplyr-style row helpers.** It is raw JS with `Math.*` only. Common
   carpentry verbs the scripts use — `ifelse`, `case_when`/`cut` (binning), `sample` (categorical
   draw) — have no first-class affordance, so users reinvent them with nested ternaries.

The user's framing ("combine with dplyr or at least math functions for creating IDs") maps directly
onto gaps 1–4.

## Architectural invariants honoured

- **Zero React in math/scope logic** — `buildScope` stays pure; PRNG via `rng.js` (`mulberry32`,
  `makeRNG`, plus a seeded categorical draw helper).
- **Worker parity is mandatory.** `generate()` and `runMonteCarlo()` evaluate through
  `exprEval.worker.js`, which carries its **own copy** of `buildScope` + PRNG. *Every* new
  distribution type and the string-preservation fix must land in **both** the main module and the
  worker, or simulated output will silently diverge from the preview. Flag in the file-touch table.
- **No new UI libraries** — new `ParamEditor` branches use the existing inline-style atoms.
- **Script-export parity** — `generateSimScript` must emit correct R/Python/Stata for every new
  type, keeping the three generators in sync (project convention).
- **Surgical edits** — extend `DIST_OPTIONS` / `DIST_DEFAULTS` / `ParamEditor` / `buildScope` /
  `generateSimScript` in place.

---

## Proposed scope (phased — confirm before building)

### Phase A — Categorical / factor distribution  *(highest value)*

New distribution type **`Categorical`**:

- **Params:** `levels` (comma list, e.g. `Control,Treatment` or `0,1,2`), `probs` (comma list of
  weights, normalized; blank ⇒ uniform), `asCode` (bool — emit integer index `0..k-1` instead of the
  label string).
- **Draw:** seeded — cumulative-probability inverse-CDF pick from `rand()`.
- **Output:** string labels by default (drives gap #2 fix), or integer codes when `asCode`.
- **Script export:**
  - R: `sample(c("Control","Treatment"), n, replace=TRUE, prob=c(.5,.5))` (or `factor(...)`).
  - Python: `rng.choice(["Control","Treatment"], size=n, p=[.5,.5])`.
  - Stata: label-decode pattern or `runiform()`-thresholded `recode`.

### Phase B — Group / panel ID generators  *(enables panel/clustered DGP)*

Two deterministic types that auto-fit to n:

- **`GroupID`** ("rep each") — params `groups G` *or* `blockSize`; emits
  `1,1,…,2,2,…` (entity id; `rep(1:G, each = n/G)`). The complementary within-block index is
  available via `CycleID`.
- **`CycleID`** ("rep times") — params `period T`; emits `1,2,…,T,1,2,…` (time id within entity;
  `rep(1:T, length.out = n)`).
- Together they let a user lay down a balanced panel skeleton (G entities × T periods) in two rows,
  then build outcomes referencing both — feeding FE/TWFE/clustered estimators directly.
- **Script export:** R `rep(1:G, each=T)` / `rep(1:T, length.out=n)`; Python `np.repeat`/`np.tile`;
  Stata `ceil(_n/T)` / `mod(_n-1,T)+1`.

### Phase C — End-to-end string preservation  *(unblocks A; small but cross-cutting)*

- `generate()` row builder: keep non-numeric scope values instead of `?? 0` — use the actual value,
  defaulting only truly `undefined`/`null` to `""`.
- `Constant`: allow a quoted/string value to pass through (don't coerce to 0).
- Preview cell render already stringifies non-numbers — verify, and right-align numbers only.
- Same edits in the **worker** `buildScope`.
- Saved dataset: confirm `onAddDataset` and downstream wrangling tolerate string columns (they do —
  type_cast/factor steps exist) so categorical sims flow into Clean/Model.

### Phase D — dplyr-style row helpers in Expression scope  *(optional, lower priority)*

Expose a small, safe, documented helper set inside the Expression/ForLoop function scope (injected as
named args, same mechanism as the variable arrays):

- `ifelse(cond, a, b)` — vectorized-feel ternary.
- `cut(x, breaks, labels)` — binning → label (case_when/`cut` analogue).
- `pick(u, probs, labels)` — single categorical draw from a uniform `u` (lets Expression do a
  conditional categorical without a separate variable).

Document them in the SimulateTab `HintBox`. Keep the set tiny — this is a convenience layer, not a
language. Defer if A–C already cover the user's workflows.

---

## Validation / testing

- No R 6dp numeric harness needed for categorical/ID generators (they're structural), **but** add a
  small deterministic check: for a fixed seed, `Categorical` proportions converge to `probs`, and
  `GroupID`/`CycleID` produce the exact `rep(...)` integer pattern for a few (n,G,T) triples — assert
  against hand-computed arrays in a Node test.
- **Worker-vs-main parity test:** generate the same DGP through `buildScope` directly and through the
  worker for a fixed seed; assert identical output (guards gap #2 regressions).

## File-touch checklist

| File | Change |
|------|--------|
| `src/components/tabs/SimulateTab.jsx` | `DIST_OPTIONS`, `DIST_DEFAULTS`, `distColor`, `ParamEditor` branches (Categorical/GroupID/CycleID); `buildScope` draws; **string-preservation** in `generate()` row builder; `generateSimScript` R/Py/Stata for new types; HintBox docs (Phase D) |
| `src/services/exprEval.worker.js` (worker copy of `buildScope` + PRNG) | MIRROR every `buildScope` change + string preservation — **mandatory parity** |
| `src/math/rng.js` | add seeded categorical-pick helper if not derivable from `rand()` |
| `src/math/__validation__/` | structural checks for Categorical proportions + GroupID/CycleID patterns + worker-parity test |
| `ClaudePlan.md` | update this spec's index row as phases land |

## Recommendation

Build **A + B + C together** (they interlock: B and the RCT use-case need C's string support, and A
is the headline feature). Treat **D as optional polish** to schedule only if users still hit friction
after A–C. None of this is on the BA-thesis critical path, but A+B materially close the gap between
the builder and the kind of factor/panel data the course (and the Modeling module) actually work with.
