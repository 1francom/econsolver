# Factor reference category selection — design

Date: 2026-08-16
Status: OPEN (approved by Franco 2026-08-16 — mechanism + scope decided, spec written same session)

## Problem

Every place this app expands a categorical ("factor") column into dummy
variables picks the reference category the same way: sort the levels
(`sortFactorLevels`/`sortLevels` — numeric ascending if every level is a
finite number, else lexicographic) and drop the first one. There is no way
for the user to choose which level is omitted. R users expect
`relevel(factor(x), ref = "...")`; Stata users expect `ib(#).x`; this parity
gap is why Franco asked for it.

**This is bigger than a UI control** — the reference category is baked
into the dummy columns before any coefficient is estimated, so it has to be
threaded through every place that independently builds those dummies today.
Grading this the way IDEAS.md's protocol asks: **feasibility 3** — not hard
per site, but four independent engines plus three exporters with three
different native syntaxes.

## Decisions (Franco, 2026-08-16)

1. **UI mechanism**: no new interaction pattern. The existing "f" badge on
   `Chip` (`components/modeling/shared.jsx`) already toggles factor
   encoding on/off; when a variable IS already factored, clicking "f" again
   opens a small popover listing that column's distinct levels to pick the
   reference from, instead of un-factoring it. This deliberately avoids
   unparking IDEAS.md's Idea 1 (a general right-click `<ContextMenu>`) —
   that stays parked until Franco's UI-simplification pass, per its own
   note.
2. **Scope**: X regressors (`factorVars`) **and** LSDV's FE dummies. NOT
   true FE/FD/TWFE/EventStudy — those are demeaned/absorbed, so there is no
   per-level dummy and therefore no reference category to choose. This is
   also why the FE chip picker today has no "f" badge at all (`ModelConfiguration.jsx`'s
   `FEColumnPicker` passes no `factored`/`onFactor` to `Chip`) — LSDV's
   `FEColumnPicker` call gets one for the first time.

## Where the reference is baked in today (four places, independently)

| Site | File | Levels function | Return type of levels |
|---|---|---|---|
| X regressors (JS) | `components/modeling/helpers.js` `applyFactors` | `sortFactorLevels` | `string[]` (numbers `.map(String)`d) |
| Interactions (JS) | `components/modeling/helpers.js` `expandInteractions` | `sortFactorLevels` (same fn) | `string[]` |
| X regressors (SQL fast path, n≥50k) | `services/data/duckdbFactors.js` `expandFactors` | `sortLevels` | native type (number stays number) |
| LSDV FE dummies | `math/PanelEngine.js` `runLSDVMulti` | local closure also named `sortLevels` | native type |

Three independently-implemented sort functions, not one shared — and they
don't even agree on return type (`helpers.js` normalizes to strings,
`duckdbFactors.js` and `PanelEngine.js` keep native numbers). This is a
pre-existing, deliberate layering choice recorded in `duckdbFactors.js`'s
own comment ("kept as a separate copy since services/ must not import from
components/") — `math/` similarly may not import from `services/` or
`components/` (CLAUDE.md: "Zero React in math files"). **Do not try to
unify these three into one shared function in this change** — the return
types genuinely differ and each caller relies on its own. Instead: add one
tiny, independently-duplicated post-processing step at each site —
`reorderForReference(sortedLevels, ref)` — that floats the chosen level to
index 0 if present (loose/string-normalized compare, since `ref` arrives as
a string from the UI but a numeric column's levels are numbers) and leaves
everything else exactly as the existing sort already produced it. Small and
mechanical enough that duplicating it three times is the lower-risk choice,
consistent with how `sortLevels` itself is already duplicated for the same
layering reason.

If the requested reference is not present in the column's actual level set
(subsetted data, stale saved model, typo) — **silently fall back to the
existing first-level behavior**, exactly like an absent `factorRefs[col]`
entry. Do not throw: a model that already ran should keep running when the
subset changes shape, same tolerance the codebase already extends to
`refLevel`-adjacent existing features (e.g. `refPeriod` in event studies).

## Data shape

`factorRefs: Record<columnName, string>` — new state in `ModelingTab.jsx`,
sibling to `factorVars`. Absent key = current behavior (auto, first sorted
level). One flat map covers both X-regressor columns and LSDV FE columns
(a column is never both in the same model, so no collision risk); consumers
just look up `factorRefs[col]`.

Threaded through:
- `ModelingTab.jsx`: new `factorRefs` state + setter; passed into
  `dispatchEstimation(...)`; added to `specExtras` (serialized plain object,
  not a Set) so pinned models and replication scripts remember the
  reference actually used; added to the `_runEstimation` `useCallback` dep
  array (this project has shipped the "stale closure" bug — SC/EventStudy/LSDV
  state missing from that array — once already; do not repeat it).
- `estimationDispatch.js`: reads `factorRefs` from the options object,
  passes to `applyFactors`/`expandInteractions` (X path) and to
  `runLSDVMulti` (LSDV path, as a new optional param keyed by FE col).
- `duckdbFactors.js`: `expandFactors({..., factorRefs})`.
- `CodeEditor.jsx` and `ReportingModule.jsx` (their hand-built `config.model`
  whitelist objects — `spec.factorRefs ?? {}` added next to the existing
  `spec.factorVars` line in each), plus `pythonScript.js` and `stataScript.js`'s
  own internal single-model `transpileModel({ ... factorVars: model.factorVars
  ?? [], ... })` reconstructions (one call site each — `model.factorRefs ?? {}`
  added there too). **R needed none of this**: `rScript.js`'s `transpileModel`
  is called with the model object passed straight through at all 4 of its call
  sites (single-model, multi-model, subset), never field-by-field, so once
  `factorRefs` exists anywhere on `spec`/`model` it's picked up automatically —
  the `noIntercept` precedent's "10 call sites" gotcha turned out to be a
  Python/Stata-specific hazard (2 sites), not a universal one; worth checking
  per-language next time rather than assuming the count.

## UI

`Chip` (`shared.jsx`): `onFactor` behavior changes from a flat toggle to:
- not factored → click "f" → factored (unchanged).
- factored → click "f" → **opens a popover** (new small component,
  `FactorReferencePopover` or similar) with that column's distinct levels
  (reused `getDistinctValues`/`jsDistinctValues` pattern — full table via
  DuckDB when available, JS fallback otherwise, same as `country_code`'s
  preview and the Data Viewer's autofilter). Clicking a level sets it as
  reference and closes the popover; the currently-selected reference (or
  "auto" if none chosen) is marked. A visible "×" or "auto" option clears
  back to default behavior.
- factored AND a non-default reference is chosen → the "f" badge shows the
  chosen level (e.g. `f: 2020`) instead of a bare `f`, so the choice is
  visible without opening the popover — mirrors how `Chip`'s own `selected`
  state is legible without a tooltip.
- `FEColumnPicker` (`ModelConfiguration.jsx`) passes `factored`/`onFactor`
  into its `Chip` calls **only when `model === "LSDV"`** — every other
  estimator's FE picker stays exactly as it is today (no "f" badge).

## Export syntax (three exporters, three different mechanisms)

**Found while implementing: each exporter has TWO independent copies of
"wrap a factor variable in this language's syntax"** — one inside
`transpileModel` (`fmtR`/`fmtPy`/`fmtS`, used by the IV-family branches:
2SLS/GMM/LIML control lists), and a SEPARATE one inside the plain-formula
builder (`buildRFormulaStr`/`buildPyFormulaStr`/`buildStataVarlist`, used by
`xStr`/`pyFormStr`/`xList` for OLS/WLS/Logit/Probit/Poisson/DiD/TWFE — the
common case). `fmtR`/`fmtPy`/`fmtS` were live code but their formula-string
siblings were the ones actually reaching the estimation command; fixing only
the former (as the plan originally assumed, one ternary per language) would
have shipped a feature that visibly did nothing for OLS. Since both copies
live in the same file per language (no cross-layer import restriction, unlike
the `sortLevels`-style duplicates elsewhere in this codebase), each pair was
consolidated into one real function — `rFactorTerm`/`pyFactorTerm`/`stFactorTerm`
— rather than fixed twice and left to drift again.

- **R**: `factor(col)` → `relevel(factor(col), ref = "LEVEL")` when a
  reference is set.
- **Python**: `C(col)` → `C(col, Treatment(reference='LEVEL'))` (patsy).
  **Single-quoted, not double** — the term is assembled into a formula
  string that is itself double-quoted
  (`smf.ols("y ~ C(x, Treatment(reference="LEVEL"))", ...)` would close the
  outer string early and emit a Python `SyntaxError`). Caught by a dedicated
  quote-balance check in the new T6 harness section, not by inspection —
  the existing "no garbage" check only greps for `undefined`/`[object
  Object]`, which a syntactically-broken-but-otherwise-clean line sails
  through. `from patsy.contrasts import Treatment` added to the three
  top-level script preambles (unconditional alongside the existing
  `statsmodels.formula.api` import — harmless if unused, cheaper than
  tracking "does this specific model use `Treatment()`" through every branch
  that can reach an import block).
- **Stata**: `i.col` → `ib(#).col`, but **only when the chosen reference is
  a numeric literal** — Stata's `ib#.` syntax takes the reference's literal
  numeric VALUE, not a level name, so a string level (`"north"`, `"COD"`)
  cannot be expressed this way without first assigning it a numeric code via
  `encode`. **Scope cut, not a bug**: giving the exporter real column-type
  awareness (numeric vs. string) to decide when `encode` is needed is a
  separate, larger piece of plumbing this exporter has never had for
  ANYTHING — not even for the pre-existing `i.col`-on-a-string-column issue
  this spec's original draft found (see the entry two paragraphs up in the
  original write-up, now folded in here). Numeric factor columns (the
  common case — `Year`, a numeric group id) get full `ib(#).col` support.
  A string reference falls back to `i.col` (identical to pre-2026-08-16
  behavior) plus an explanatory `* NOTE:` comment naming the column and the
  `encode` command that would unblock it — honest gap over silent wrong or
  invalid output, same convention as the CR2/CR3 Stata note and the Bacon
  panel's "no Python port" message.

**LSDV's FE dummies are OUT of export scope, on reflection — not merely
deferred.** The Litux *engine* (`runLSDVMulti`) genuinely fits explicit
per-level dummies and genuinely has a droppable reference. But all three
exporters represent LSDV's common (≤2-way) case as **absorbed** FE —
`fixest::feols(y ~ x | fe1 + fe2)` in R, `PanelOLS(..., entity_effects=True)`
in Python, `xtreg/reghdfe` in Stata — which has no reference-category concept
at all; fixed effects are recovered afterward via `fixef()`/`estimated_effects`/
`_alpha_i` in whatever normalization that tool uses, not by dropping a level.
Only Python's 3+-way LSDV fallback branch happens to use an explicit `C(col)`
dummy formula where a reference WOULD apply — left un-referenced anyway for
consistency (no UI offers a reference there, and partially-correct support
across languages would be worse than a clean, documented boundary). Net
effect: pick a reference for an LSDV FE dimension in Litux, and the Litux
UI/results panel reflects it correctly (verified — the coefficient on X is
invariant to which reference was chosen, only `alphas`' keys/values shift);
the exported R/Python/Stata script is unaffected by that choice, because it
was never expressing per-level dummies for FE in the first place.

## Validation

Math change (dummy encoding + coefficient interpretation), so it gets the
project's standard R comparison. Done:

- `src/math/__validation__/factorExpansionValidation.js` (already existed —
  built for the `applyFactors`/`expandInteractions` NA-handling fix) — Test
  5 added: `factorExpansionRValidation.R` now also fits
  `lm(y ~ x1 + relevel(factor(year), ref="10") + factor(grader), data=df)`
  on the same fixture and writes a `customRef` block into
  `factorExpansionBenchmarks.json`. 6 R-validated coef/SE pairs (1e-6/1e-4),
  plus two identity checks that don't need R at all: the coefficient on
  `x1` and on `grader_B` are asserted **numerically identical** between the
  default- and custom-reference runs (a reference choice is a
  reparameterization of the same model, not a different one — if those
  moved, something would be wrong regardless of what R says), and an
  unknown reference level (not an actual level of the column) is asserted
  to fall back to the default dummy set rather than throwing or dropping a
  column.
- `src/services/data/__validation__/factorsValidation.js` (SQL path) — done
  in the FR2 pass: custom reference, numeric-column reference (string
  compare), and unknown-reference-falls-back cases, all structural (this
  harness doesn't carry its own R fixture — `duckdbFactors.js`'s output
  feeds the same `runOLSFromSuffStats` already validated elsewhere).
- `src/services/export/__validation__/replicationIntegrityValidation.mjs`
  T6 (added in the FR6 pass) — R/Python/Stata syntax correctness, including
  the Python nested-quote regression this pass found by generating and
  reading real output rather than by inspection.

**Deliberately not built**: a dedicated R fixture for `runLSDVMulti`'s FE
reference specifically. Reasoning: `runLSDVMulti` reorders which level is
dropped and then calls the same `runOLS` that is already exhaustively
R-validated elsewhere in this codebase — the only new logic is the reorder
itself, and its correctness property (the coefficient on every non-FE
regressor must be EXACTLY invariant to which FE level is dropped, since
that's what "reparameterization" means) was checked directly during
implementation (`node -e` smoke test, `x` coefficient identical to 6
decimal places across two reference choices on a synthetic panel) rather
than committed as a permanent fixture, since — per the Export syntax
section above — the LSDV reference choice never reaches an exported script
for anyone to compare against R's own LSDV output anyway.

## Out of scope

- Right-click / context menu (Idea 1) — stays parked.
- Reference selection for true FE/FD/TWFE/EventStudy/Sun-Abraham/Callaway-Sant'Anna
  — none of these report per-level dummy coefficients.
- A reference for interaction-only factor terms where the main effect isn't
  also in `xVars` — `expandInteractions`' `ensureAndGetCols` still applies
  `factorRefs` when building those dummies (no reason not to), but the UI
  entry point (the "f" badge) only exists on `VarPanel`/`FEColumnPicker`
  chips, not on the Interactions section's var-pickers — reachable via the
  same underlying `factorVars` set, just no popover trigger there in v1.
