# Excel-Grid Editing in the Data Viewer (design)

**Date:** 2026-06-05
**Status:** OPEN
**Author / Executor:** Claude.
**Source conversation:** roadmap item 2 — "Excel functions in the dataviewer (add columns, rows, change values after filtering, contains, replace by, etc)" plus a positional character editor (insert/delete/overwrite characters at a chosen index, like append/prepend but anywhere in the value).

## Purpose

Bring spreadsheet-style editing into the Data Viewer grid while preserving the non-destructive pipeline: every grid action emits a replayable pipeline step (never mutates `rawData`). The grid already supports per-cell edit (`patch`), whole-column fill (`ai_tr`), and column injection (`inject_column`). This adds the operations users expect from Excel: add column, add rows, bulk-edit a filtered subset, find & replace, and positional character editing.

## Current state (verified 2026-06-05)

- The grid is the `DataViewer` component **inline in `src/App.jsx`** (def. ~line 339): props `{ rows, headers, filename, onPatch, onFillColumn, duckdbMeta }`. It has an `editMode` toggle, per-cell `startEdit`/`handleCommit` → `onPatch(ri, col, value)`, and a "Fill column" panel (Set/Append/Prepend → `onFillColumn(col, op, text)`), plus a display-only column-name filter and pagination.
- Callbacks route through `studioRef` (`src/DataStudio.jsx`): `addPatchStep(ri,col,value)` → `patch` step; `addFillColumnStep(col,op,text)` → an `ai_tr` step; `addInjectColumnStep` → `inject_column`. All dispatch via `wranglingAddStepRef.current(step)`.
- `patch` step (`runner.js` ~1581) targets a row by `__ri` (stable identity assigned in DataStudio `ensureRowIds`). `s.ri != null` guard prevents matching all rows.
- No `add_column`/`add_row`/`set_where`/`replace`/`str_splice` steps exist.

## Architectural invariants

- **Non-destructive.** Every grid action emits a pipeline step; steps replay on `rawData`.
- **Registry/runner sync.** Each new `type` gets a matching `STEP_REGISTRY` entry in the same change.
- **Deterministic replay.** No operation may depend on transient UI state (current page, scroll, ad-hoc selection). Bulk edits encode a **declarative predicate**, never row positions.
- **Row identity stability.** Appended rows get deterministic `__ri` so later `patch` edits on them survive replay.
- **Replication fidelity.** Each new step gets R/Python/Stata translations — but this part is **sequenced after Codex's Batch-1 export work merges** (shared `services/export/` files).
- **Big-data rule.** Bulk edits run on the **full dataset** (not the visible page); preview shows a sample. For DuckDB-backed data, the step still runs through the standard pipeline path.

---

## Part A — New pipeline steps

### A1. `add_column`
`{ type:"add_column", nn, fill, dtype }` — append a new column.
- `nn`: name. `fill`: constant value (or `null`/empty). `dtype`: `"string"|"number"` (coerces `fill`).
- Runner: `R = rows.map(r => ({ ...r, [nn]: coerced(fill) })); if (!H.includes(nn)) H=[...H,nn];`
- Registry: `category:"features"`, schema `nn`(text), `fill`(text), `dtype`(select string/number).

### A2. `add_row`
`{ type:"add_row", values, count, _seq }` — append `count` rows.
- `values`: `{ [col]: value }` for provided columns; all other columns `null`.
- **Row identity:** each appended row gets `__ri = ADD_ROW_BASE + _seq*1000 + k`, where `ADD_ROW_BASE = 1e9` and `_seq` is a monotonically increasing per-step sequence stamped at step-creation time (like `winz` freezing p1/p99 at creation). This guarantees deterministic, collision-free `__ri` across replays, so a later `patch` on a new row stays stable.
- Runner: builds `count` row objects over the full header set (`values[col] ?? null`), assigns `__ri`, appends.
- Registry: `category:"cleaning"`, schema `count`(number), `values`(map). `internal` stays false.

### A3. `set_where`
`{ type:"set_where", col, where:{ col, op, value }, action, value }` — bulk edit rows matching a predicate.
- `action`: `"set"` (write `value`) | `"clear"` (write `null`).
- `where.op` ∈ `equals | not_equals | contains | starts | ends | gt | lt | between | empty | notempty`. For `between`, `where.value` is `[lo, hi]`. String ops use `String(x)`; numeric ops (`gt/lt/between`) coerce.
- Runner: `R = rows.map(r => predicate(r) ? { ...r, [col]: action==="clear" ? null : coerced(value) } : r);` Predicate compiled once from `where`.
- Registry: `category:"cleaning"`, schema `col`(col), and a structured `where`/`action`/`value` handled by the DataViewer UI (the registry default-form is a fallback).

### A4. `replace`
`{ type:"replace", col, match:{ mode, find }, replaceWith, nn }` — find & replace within a column.
- `match.mode`: `"exact"` (whole-value equality) | `"contains"` (substring) | `"regex"`.
- `replaceWith`: replacement string. `nn` optional: write to a new column; default overwrites `col`.
- Runner: per value, `exact` → replace whole value when equal; `contains` → `String(v).split(find).join(replaceWith)`; `regex` → `String(v).replace(new RegExp(find,"g"), replaceWith)` (compile in try/catch; invalid regex → no-op). Null-safe (null passes through).
- Registry: `category:"cleaning"`, schema `col`(col), `find`(text), `replaceWith`(text), `mode`(select), `nn`(text optional).

### A5. `str_splice` (positional character editor)
`{ type:"str_splice", col, position, mode, text, count, nn }` — insert/delete/overwrite characters at a position.
- `position`: 1-based index into the string form of the value. Negative = from the end (`-1` = last char). Clamped to `[0, len]` for insert.
- `mode`: `"insert"` (insert `text` at `position`) | `"delete"` (remove `count` chars from `position`) | `"overwrite"` (replace `count` chars from `position` with `text`).
- Operates on `String(value)`. If the source column is numeric and the result is a finite number, re-coerce to number (preserves numeric dtype); otherwise result is a string. `nn` optional new column; default overwrites.
- Runner: implement a pure `splice(str, position, mode, text, count)` helper; null passes through.
- Registry: `category:"features"`, schema `col`(col), `position`(number), `mode`(select insert/delete/overwrite), `text`(text), `count`(number), `nn`(text optional).

> **DRY:** Append/Prepend in the existing Fill panel are positional special cases (`position = len` / `position = 0`). Keep the existing `ai_tr`-based Fill for backward compat; do not refactor it in this batch (YAGNI).

---

## Part B — DataViewer UI (App.jsx)

Extend the existing `editMode` toolbar. New callbacks added to `DataViewer` props and wired in App's render to new `studioRef` methods (Part C).

### B1. Structured filter bar (the WHERE predicate)
A filter row in the toolbar: **[column ▾] [op ▾] [value]**, `op` matching `set_where.where.op`. Behavior:
- Filters the **displayed** rows by evaluating the predicate over the full dataset (not just the current page); pagination then applies to the filtered set. Show a "showing N of M rows (filtered)" indicator.
- The active predicate is the WHERE source for `set_where` actions.
- Clearing the filter shows all rows.
- This is **display + predicate capture only** — it does not itself emit a step.

### B2. Set / Clear on the filtered subset
When a filter is active (or even when not — then it targets all rows), an action row: **Set [column ▾] = [value]** and a **Clear** button → emit `set_where` with the current filter predicate (or a tautology predicate when no filter). Preview: "will affect N rows".

### B3. Add column / Add row
- **＋ Column**: small form (name, dtype, fill value) → `add_column`.
- **＋ Row**: appends one blank row (`add_row` count=1, values={}); the new row is then per-cell editable via existing `patch`. Optional "add N rows" count input.

### B4. Find & Replace
A form: **[column ▾] [find] → [replaceWith] [mode: exact/contains/regex] [□ new column name]** → `replace`.

### B5. Positional editor
A form: **[column ▾] [mode: insert/delete/overwrite] [position] [text] [count] [□ new column]** → `str_splice`. Inline hint: "position 1 = first character; negative counts from the end".

All new panels live under the existing `editMode` toggle, styled with the `C` palette + `mono` (match the current Fill panel). Group them so the toolbar doesn't overflow (a compact row of action chips that each reveal their mini-form).

---

## Part C — DataStudio studio methods

Mirror the existing `addPatchStep`/`addFillColumnStep` pattern — new methods on the `studioRef` imperative handle, each emitting one step via `wranglingAddStepRef.current(step)` with a `desc` for the History label:
- `addColumnStep(nn, fill, dtype)` → `add_column`
- `addRowStep(values, count)` → `add_row` (stamps `_seq` from a ref counter at creation)
- `addSetWhereStep(col, where, action, value)` → `set_where`
- `addReplaceStep(col, match, replaceWith, nn)` → `replace`
- `addStrSpliceStep(col, position, mode, text, count, nn)` → `str_splice`

Wire each into `DataViewer` via new props in App's render (the `onPatch`/`onFillColumn` siblings).

---

## Part D — Replication translations (SEQUENCED LAST)

Add R/Python/Stata translations for `add_column`, `add_row`, `set_where`, `replace`, `str_splice` in `rScript.js`/`pythonScript.js`/`stataScript.js`. **Gate: start only after Codex's Batch-1 export work has merged** (those files are in flight). Sketch:
- `add_column` → `mutate(nn = fill)` / `df["nn"]=fill` / `gen nn = ...`
- `set_where` → `mutate(col = ifelse(<pred>, val, col))` / `df.loc[<pred>, col]=val` / `replace col = val if <pred>`
- `replace` → `mutate(col = str_replace_all / case)` / `df[col].str.replace` / `replace`/`regexr`
- `str_splice` → `stringr::str_sub<-` / Python slice assignment / Stata `substr`/`subinstr`
- `add_row` → `add_row()` / `pd.concat` / `set obs` + `replace in`

If a clean translation is impractical for a given step (e.g. `add_row` with synthetic identities), emit a clearly commented manual-edit placeholder rather than silently dropping it.

---

## Testing / validation (no JS unit runner)

- Node harness `src/pipeline/__validation__/gridSteps.test.mjs`: pure-logic checks for each new runner step via `runPipeline` on a small fixture — `add_column` adds the column; `add_row` appends with stable `__ri`; `set_where` edits only matching rows (test `contains` + `gt` + `between`); `replace` exact/contains/regex; `str_splice` insert/delete/overwrite incl. negative position and numeric re-coercion.
- `npm run build` clean.
- Browser validation (Franco): in the Data Viewer, add a column, add a row + edit its cells, filter (contains) + set a column on the subset, find & replace (regex), and splice characters mid-value; confirm each appears in History and Undo reverts it; confirm a pipeline re-run reproduces identical results.

## File checklist

- [ ] `src/pipeline/runner.js` — `add_column`, `add_row`, `set_where`, `replace`, `str_splice` cases (+ a pure `splice` helper).
- [ ] `src/pipeline/registry.js` — five matching entries.
- [ ] `src/pipeline/__validation__/gridSteps.test.mjs` — Node harness.
- [ ] `src/App.jsx` — `DataViewer` toolbar: filter bar, set/clear-where, add column/row, find & replace, positional editor; new props.
- [ ] `src/DataStudio.jsx` — five new `studioRef` methods + `_seq` counter ref; wire into `<DataViewer>`.
- [ ] **(sequenced last)** `src/services/export/{rScript,pythonScript,stataScript}.js` — translations.
- [ ] `CLAUDE.md` / `ClaudePlan.md` — step count + structure + spec status.

## Out of scope

- Multi-cell rectangular selection / copy-paste ranges (future).
- Formula columns referencing other columns (use existing `mutate`).
- Undo of individual sub-edits beyond the existing pipeline History undo/redo.
- Refactoring the existing Fill (append/prepend) panel into `str_splice`.
