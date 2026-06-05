# Batch 1 — Clean/Explore parity + Vector Join (design)

**Date:** 2026-06-05
**Status:** OPEN
**Owner of implementation:** Codex (solo). This spec is authored by Claude; Codex executes the entire batch from this document.
**Scope boundary:** This is Batch 1 only. Items 2–5 of the roadmap (Excel-grid functions in the Data Viewer, AI-coach context, cross-device persistence, Tauri) each get their own spec later and are explicitly out of scope here.

## Purpose

Close the gap between EconSolver's wrangling pipeline and the dplyr/pandas operations users expect (joins, set operations, dedup, group-transform), and add a new **Vector Join** primitive that assigns a small value vector across a large dataset by a user-selected mode. All work lands as pipeline steps (replayable on `rawData`), registry entries, UI surfaces, and replication-script translations.

## Architectural invariants (must hold)

- **Non-destructive pipeline.** Every new operation is a step in `runner.js`; steps replay on `rawData`, never mutate in place.
- **Registry/runner sync.** Every new `type` added to `runner.js` gets a matching `STEP_REGISTRY` entry in `registry.js` in the same change.
- **Deterministic replay.** Any randomness (Vector Join `random`/`quota` modes) uses a seeded RNG (mulberry32) with the seed stored in the step. No `Math.random()` anywhere in the pipeline. Replaying the pipeline must reproduce identical assignments.
- **Zero React in core/math.** The Vector Join assignment logic lives in a pure module `src/core/generate/vectorAssign.js` — no React imports.
- **Replication fidelity.** Every new step gets an R / Python / Stata translation so exported scripts reproduce the result.

---

## Part A — Join types

**Files:** `src/pipeline/runner.js` (`join` case), `src/pipeline/registry.js` (`join` entry), `src/components/wrangling/MergeTab.jsx` (join-type selector).

Current `join` supports `left` and `inner`. Add `right`, `full`, `anti`, `semi`.

### Semantics
- **left** (existing) — all left rows; right columns null when unmatched.
- **inner** (existing) — only matched left rows.
- **right** — all right rows; for each right row, attach matching left row's columns (null where no left match). Implementation: build a left map keyed by `leftKey`; iterate right rows; output `{...leftMatchOrNulls, ...rightCols}`. Column order: left headers first, then right-only columns (suffix on conflict), matching the left/inner column convention.
- **full** — every left row (matched or not) plus every right row that had no left match. Implementation: run the left-join pass, track which right keys matched, then append unmatched right rows with left columns null.
- **anti** — left rows whose key has **no** match in right. **No right columns added** — output schema = current headers unchanged. Pure row filter.
- **semi** — left rows whose key **has** a match in right. No right columns added. Pure row filter.

### UI (MergeTab)
- Extend the join-type selector from `[left, inner]` to `[left, inner, right, full, anti, semi]`.
- When `how` is `anti` or `semi`: hide the suffix input and the "+N columns" formula preview (no columns are added); keep the match-preview bar (it still communicates match rate). Show a one-line note: "Filters rows only — no columns added."
- `headerChain` logic in MergeTab: for `anti`/`semi`, the chained header set is unchanged (no right columns appended).

### Registry
Extend the `how` select options to all six. `toLabel` already uses `${s.how}_join`.

---

## Part B — Combine tab (set & bind operations)

**New UI:** a dedicated **Combine** sub-tab in MergeTab. MergeTab sub-tabs become: `Join / Append / Combine / Vector`.

**New steps** (all reference a second loaded dataset by `rightId`, like `append`):

### B1. `bind_cols`
Horizontal bind by **row position** (dplyr `bind_cols`). 
- Conflicting column names get `suffix` (default `_r`).
- Row-count mismatch: truncate to the shorter length and surface a warning in the UI preview ("⚠ Row counts differ: 10,000 vs 8,000 — result truncated to 8,000"). Do not recycle.
- Output headers: current headers + right headers (suffixed on conflict).

### B2. `union`
Vertical stack then drop **full-row** duplicates (dplyr `union` / SQL `UNION`). Columns matched by name; unmatched filled null before dedup. Dedup key = JSON of the full row over the union column set.

### B3. `intersect`
Keep current rows that also appear in the other dataset (dplyr `intersect`). Match on **shared columns** (intersection of header sets). A current row is kept if a row with identical shared-column values exists in the other dataset. Result columns = current headers unchanged.

### B4. `setdiff`
Keep current rows that do **not** appear in the other dataset (dplyr `setdiff`). Same shared-column matching as `intersect`. Result columns = current headers unchanged.

### Combine tab UI
- Dataset picker (reuse the button-list pattern from Append).
- Operation selector: `bind_cols / union / intersect / setdiff` with one-line descriptions each.
- Live preview: result row/col count, and for `bind_cols` the row-count-mismatch warning; for set ops the shared-column list used as the match key.
- "Add to pipeline →" button emits the step.

### Registry
Four new entries, `category: "merge"`. Schema: `rightId` (text), plus `suffix` for `bind_cols`. `toLabel`: e.g. `union ← ${rightId}`.

---

## Part C — `distinct` step

**Files:** `runner.js`, `registry.js`, surface in `CleanTab.jsx`.

Drop duplicate rows (dplyr `distinct` / pandas `drop_duplicates`).
- `subset`: columns to dedup on (default = all columns).
- `keep`: `"first"` | `"last"` (default `first`).
- Implementation: iterate rows, key = JSON of subset values; for `first` keep first occurrence, for `last` keep last (iterate and overwrite, preserving final order by last index).
- Registry: `category: "cleaning"`, schema `subset` (cols), `keep` (select first/last).

---

## Part D — `group_transform` step

**Files:** `runner.js`, `registry.js`, surface in `ReshapeTab.jsx` (next to group_summarize) or `FeatureTab.jsx` — place under Reshape to sit beside group_summarize.

Compute a group statistic and **broadcast it back to every row** as a new column. Does **not** collapse rows (this is the key difference from `group_summarize`). Equivalent to dplyr `group_by() |> mutate(new = fn(x))`.
- `by`: group-by columns.
- `col`: source column.
- `fn`: `mean | sum | sd | min | max | count | median | rank`.
- `nn`: output column name (default `${fn}_${col}_by_${by.join("_")}`).
- Implementation: first pass builds per-group aggregate; second pass writes the group's value onto each row. `rank` = within-group rank of `col` (ascending, ties = average or min — use **min rank** for simplicity, document it).
- Registry: `category: "reshape"`, schema `by` (cols), `col` (col), `fn` (select), `nn` (text).

---

## Part E — Vector Join (`vector_assign`)

**New pure engine:** `src/core/generate/vectorAssign.js` exporting `assignVector(rows, opts)` and a `mulberry32(seed)` RNG helper. No React.

**New step:** `vector_assign` in `runner.js` + `registry.js`.

**Two UI entry points, same step:**
1. New **Vector** sub-tab in MergeTab.
2. New **Generate column** section in FeatureTab.

**Shared UI component:** `src/components/wrangling/VectorAssignForm.jsx`.
- Export `VectorAssignForm({ rows, headers, onAdd })` as the single custom form for both entry points. Do not duplicate Vector Join state or submit logic inside `MergeTab.jsx` or `FeatureTab.jsx`.
- The component owns the local form state for output column name, raw values text, mode, seed, per-value weights, conditional rules, and conditional fallback.
- It parses the values textarea on comma or newline, trims values, and drops empty entries before emitting the step.
- On submit, it calls `onAdd({ type: "vector_assign", nn, values, mode, seed, ...modeSpecificFields, desc })`, with `weights` set only for `random`/`quota` and `rules`/`elseValue` set only for `conditional`.
- It may import React hooks and wrangling shared UI helpers (`useTheme`, `mono`, `Lbl`, `Btn`), but all assignment math remains in `src/core/generate/vectorAssign.js`.

### Step shape
```js
{
  type: "vector_assign",
  nn: "colour",                 // output column name
  values: ["red","blue", ...],  // the value pool (parsed from typed/pasted input)
  mode: "random",               // "random" | "conditional" | "recycle" | "quota"
  weights: [0.6, 0.4, ...] | null, // random/quota: per-value weight; null = uniform
  rules: [{ expr: "income > 5000", value: "high" }, ...], // conditional only
  elseValue: "other",           // conditional fallback
  seed: 42                       // seeds random & quota
}
```

### Modes (user-selected — these are alternatives the user picks, not a fixed rule)
- **random** — for each row draw a value from `values` by `weights` (normalized; null → uniform). Uses `mulberry32(seed)` advanced once per row. Reproducible.
- **conditional** — evaluate `rules` in order; first row where `expr` is truthy → that rule's `value`; no match → `elseValue`. **Reuse the `mutate` expression evaluator** in `runner.js` (same column-ref + helper-function environment: `ifelse`, `between`, `log`, etc.) so expressions behave identically to mutate. Factor the mutate evaluator into a reusable helper if not already callable.
- **recycle** — row `i` → `values[i % values.length]` (R-style recycling, deterministic, no seed needed).
- **quota** — compute exact integer counts per value from `weights` as proportions (or equal split if null) using largest-remainder rounding to sum exactly to `n`; build the full assignment list; shuffle deterministically with a seeded Fisher–Yates (`mulberry32(seed)`); assign by row order.

### UI requirements (both entry points)
- **Values input:** textarea; parse on comma **or** newline; trim; drop empties.
- **Mode selector:** four options with one-line help each.
- **Weights** (random/quota): optional per-value numeric inputs revealed after values are entered; blank = uniform/equal.
- **Rules** (conditional): repeatable `{expr, value}` rows + an else value, mirroring the existing if_else/recode editors.
- **Seed:** numeric input, default 42, shown for random/quota with a note "Change the seed to reshuffle; same seed reproduces the same column."
- **Output column name** input.
- Preview: a small sample (first ~8 assigned rows) + a value-count summary (e.g. `red: 6,012 · blue: 3,988`).

### Registry
`category`: list under both `features` and `merge`? Registry entries are keyed by `type` (one entry). Use `category: "features"` for the registry record; the Merge "Vector" sub-tab emits the same `vector_assign` step directly (the registry category only governs the default config-form grouping, not which tabs can emit it). Schema: `nn` (text), `values` (text — comma/newline), `mode` (select), `seed` (number); rules/weights are mode-specific and handled by the custom UI rather than the generic schema form.

---

## Part F — Replication-script translations

**Files:** `src/services/export/rScript.js`, `pythonScript.js`, `stataScript.js`.

Add a translator for every new step:

| Step | R (dplyr) | Python (pandas) | Stata |
|---|---|---|---|
| join `right` | `right_join(...)` | `merge(how="right")` | `merge ... ` (keep matched) |
| join `full` | `full_join(...)` | `merge(how="outer")` | `merge ...` |
| join `anti` | `anti_join(...)` | `~isin` filter | `merge ... keep(master)` then drop matched |
| join `semi` | `semi_join(...)` | `isin` filter | `merge ... keep(match)` |
| `bind_cols` | `bind_cols(...)` | `pd.concat(axis=1)` | `merge ... using, _n` |
| `union` | `union(...)` | `pd.concat().drop_duplicates()` | `append` + `duplicates drop` |
| `intersect` | `intersect(...)` | `merge(how="inner")` on shared | `merge` keep match |
| `setdiff` | `setdiff(...)` | anti-join pattern | `merge` keep master |
| `distinct` | `distinct(.keep_all=TRUE)` | `drop_duplicates(subset=, keep=)` | `duplicates drop` |
| `group_transform` | `group_by() |> mutate(nn = fn(col))` | `groupby().transform()` | `bysort: egen` |
| `vector_assign` random | `set.seed(seed); df$nn <- sample(values, n, replace=TRUE, prob=weights)` | `np.random.default_rng(seed).choice(values, n, p=weights)` | `set seed`; `gen` with `runiform()` bins |
| `vector_assign` conditional | `case_when(...)` | `np.select(conds, choices, default)` | nested `replace ... if` |
| `vector_assign` recycle | `rep_len(values, n)` | `np.resize(values, n)` | `gen nn = ... mod _n` |
| `vector_assign` quota | `sample(rep(values, counts))` with `set.seed` | shuffled repeat with seeded rng | `set seed`; shuffled expand |

Note in each generated script that random/quota seeds reproduce EconSolver's assignment **only in EconSolver's mulberry32**; the exported language uses its own RNG, so values will differ but the *distribution* matches. Document this caveat as a comment in the generated script.

---

## Testing / validation

- Manual browser validation by Franco per the project convention (validate before next task).
- Determinism check: add the same `vector_assign` step, run the pipeline twice, confirm identical output column (seeded).
- Each join type: verify row counts against the match-preview math on a small fixture.
- `union`/`intersect`/`setdiff`/`distinct`: verify against a hand-checked 5-row fixture.

## File checklist for Codex

- [ ] `src/pipeline/runner.js` — extend `join`; add `bind_cols`, `union`, `intersect`, `setdiff`, `distinct`, `group_transform`, `vector_assign` cases. Factor mutate evaluator into a callable helper for `vector_assign` conditional mode.
- [ ] `src/core/generate/vectorAssign.js` — new pure engine (`assignVector`, `mulberry32`).
- [ ] `src/pipeline/registry.js` — entries for all new steps; extend `join` `how` options.
- [ ] `src/components/wrangling/MergeTab.jsx` — six join types + anti/semi UI handling; new Combine sub-tab; new Vector sub-tab.
- [ ] `src/components/wrangling/VectorAssignForm.jsx` — shared Vector Join form consumed by MergeTab and FeatureTab.
- [ ] `src/components/wrangling/CleanTab.jsx` — `distinct` UI.
- [ ] `src/components/wrangling/ReshapeTab.jsx` — `group_transform` UI.
- [ ] `src/components/wrangling/FeatureTab.jsx` — "Generate column" (vector_assign) section.
- [ ] `src/services/export/rScript.js`, `pythonScript.js`, `stataScript.js` — translators for every new step.
- [ ] `CLAUDE.md` — bump pipeline step count (23 → new total) and step-type lists.
