# Excel-Grid Editing in the Data Viewer — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax.
>
> Source spec: `docs/superpowers/specs/2026-06-05-excel-grid-editing-design.md`. Executor: Claude.

**Goal:** Add spreadsheet-style editing to the Data Viewer — add column, add rows, filtered bulk-edit (set/clear WHERE), find & replace, and a positional character editor — each emitting a replayable pipeline step (never mutating `rawData`).

**Architecture:** Five new pure step types in `runner.js` (+ matching `registry.js` entries). The `DataViewer` grid (inline in `App.jsx`) gains toolbar panels under the existing `editMode` toggle; each action calls a new `studioRef` method in `DataStudio.jsx` that emits one step via `wranglingAddStepRef.current(step)`, mirroring the existing `addPatchStep`/`addFillColumnStep` pattern. A structured filter bar both filters the displayed rows and supplies the declarative WHERE predicate for `set_where`.

**Tech Stack:** React + Vite + plain JS, inline styles via `C`, `mono` font. No JS unit runner — gates: Node harness for the 5 steps, `npm run build`, Franco browser-validation.

**Invariants:**
- Non-destructive: every action emits a pipeline step; bulk edits encode a **predicate**, never row positions.
- Registry/runner sync: add the registry entry in the same task as the runner case.
- Deterministic replay: `add_row` assigns `__ri = 1e9 + seq*1000 + k` (seq stamped at step creation).
- Branch `Main-`. **Codex may be running its Batch-1 export-finish task** — it touches ONLY `src/services/export/*` + `CLAUDE.md`/`ClaudePlan.md`. This plan stays off `src/services/export/*` until Task 8 (sequenced last). Add only each task's files; never `git add -A`.

---

## Task 1: Pure step logic + Node harness (runner steps)

**Files:**
- Modify: `src/pipeline/runner.js` — add 5 cases + a `splice` helper.
- Create: `src/pipeline/__validation__/gridSteps.test.mjs`

- [ ] **Step 1: Add a pure `splice` helper near the top of runner.js (module scope, before `applyStep`)**

```js
// Positional string splice used by the str_splice step.
// position: 1-based; negative counts from end. mode: insert|delete|overwrite.
function splice(value, position, mode, text = "", count = 0) {
  if (value === null || value === undefined) return value;
  const s = String(value);
  const len = s.length;
  let pos = Number(position);
  if (!isFinite(pos)) pos = len;
  if (pos < 0) pos = Math.max(0, len + pos + 1) - 1; // -1 => last char index
  else pos = pos - 1;                                  // 1-based -> 0-based
  pos = Math.max(0, Math.min(pos, len));
  const n = Math.max(0, Number(count) || 0);
  if (mode === "insert")    return s.slice(0, pos) + text + s.slice(pos);
  if (mode === "delete")    return s.slice(0, pos) + s.slice(pos + n);
  if (mode === "overwrite") return s.slice(0, pos) + text + s.slice(pos + n);
  return s;
}

// Re-coerce a spliced result back to number when the source column was numeric
// and the new string parses to a finite number.
function maybeNumber(original, result) {
  if (typeof original === "number" && result !== null && result !== "") {
    const n = Number(result);
    if (isFinite(n)) return n;
  }
  return result;
}

// Coerce a raw form value to a target dtype for add_column / set_where.
function coerceTo(v, dtype) {
  if (dtype === "number") { const n = Number(v); return isFinite(n) ? n : null; }
  return v === undefined ? null : v;
}

// Build a row predicate from a structured where clause for set_where / filters.
function buildPredicate(where) {
  if (!where || !where.col || !where.op) return () => true;
  const { col, op, value } = where;
  const sval = value == null ? "" : String(value);
  const num = Number(value);
  return (r) => {
    const raw = r[col];
    const s = raw == null ? "" : String(raw);
    switch (op) {
      case "equals":     return s === sval;
      case "not_equals": return s !== sval;
      case "contains":   return s.includes(sval);
      case "starts":     return s.startsWith(sval);
      case "ends":       return s.endsWith(sval);
      case "gt":         return typeof raw === "number" ? raw > num : Number(raw) > num;
      case "lt":         return typeof raw === "number" ? raw < num : Number(raw) < num;
      case "between": {
        const lo = Number(Array.isArray(value) ? value[0] : value);
        const hi = Number(Array.isArray(value) ? value[1] : value);
        const x = typeof raw === "number" ? raw : Number(raw);
        return isFinite(x) && x >= lo && x <= hi;
      }
      case "empty":      return raw == null || s === "";
      case "notempty":   return raw != null && s !== "";
      default:           return true;
    }
  };
}
```

- [ ] **Step 2: Add the five cases inside `applyStep`'s switch**

```js
    case "add_column": {
      const nn = s.nn;
      if (!nn) break;
      const val = coerceTo(s.fill, s.dtype);
      R = rows.map(r => ({ ...r, [nn]: val }));
      if (!H.includes(nn)) H = [...H, nn];
      break;
    }

    case "add_row": {
      const base = 1e9 + (Number(s._seq) || 0) * 1000;
      const count = Math.max(1, Number(s.count) || 1);
      const vals = s.values || {};
      const newRows = [];
      for (let k = 0; k < count; k++) {
        const row = { __ri: base + k };
        H.forEach(h => { if (h !== "__ri") row[h] = (h in vals) ? vals[h] : null; });
        newRows.push(row);
      }
      R = [...rows, ...newRows];
      break;
    }

    case "set_where": {
      const pred = buildPredicate(s.where);
      const setVal = s.action === "clear" ? null : coerceTo(s.value, s.dtype);
      R = rows.map(r => pred(r) ? { ...r, [s.col]: setVal } : r);
      break;
    }

    case "replace": {
      const mode = s.match?.mode || "exact";
      const find = s.match?.find ?? "";
      const repl = s.replaceWith ?? "";
      const out = s.nn || s.col;
      let rx = null;
      if (mode === "regex") { try { rx = new RegExp(find, "g"); } catch { rx = null; } }
      R = rows.map(r => {
        const v = r[s.col];
        if (v === null || v === undefined) return out === s.col ? r : { ...r, [out]: v };
        let nv;
        if (mode === "exact")        nv = String(v) === find ? repl : v;
        else if (mode === "contains") nv = String(v).split(find).join(repl);
        else                          nv = rx ? String(v).replace(rx, repl) : v;
        return { ...r, [out]: nv };
      });
      if (!H.includes(out)) H = [...H, out];
      break;
    }

    case "str_splice": {
      const out = s.nn || s.col;
      R = rows.map(r => {
        const v = r[s.col];
        const spliced = splice(v, s.position, s.mode, s.text ?? "", s.count ?? 0);
        return { ...r, [out]: maybeNumber(v, spliced) };
      });
      if (!H.includes(out)) H = [...H, out];
      break;
    }
```

- [ ] **Step 3: Write the Node harness**

Create `src/pipeline/__validation__/gridSteps.test.mjs`:

```js
import { runPipeline } from "../runner.js";

let pass = 0, fail = 0;
const check = (n, c) => c ? (pass++, console.log("  [pass]", n)) : (fail++, console.log("  [FAIL]", n));

const base = [
  { __ri: 0, region: "north", n: 10, label: "ab12" },
  { __ri: 1, region: "south", n: 20, label: "cd34" },
  { __ri: 2, region: "north", n: 30, label: "ef56" },
];
const H = ["region", "n", "label"];
const run = step => runPipeline(base, H, [step], { datasets: {} });

// add_column
let o = run({ type: "add_column", nn: "flag", fill: "1", dtype: "number" });
check("add_column adds numeric col", o.headers.includes("flag") && o.rows.every(r => r.flag === 1));

// add_row
o = run({ type: "add_row", count: 2, values: { region: "west" }, _seq: 3 });
check("add_row appends 2 rows", o.rows.length === 5);
check("add_row stable __ri", o.rows[3].__ri === 1e9 + 3000 && o.rows[4].__ri === 1e9 + 3001);
check("add_row fills provided + nulls", o.rows[3].region === "west" && o.rows[3].n === null);

// set_where (contains)
o = run({ type: "set_where", col: "n", where: { col: "region", op: "contains", value: "nor" }, action: "set", value: "99", dtype: "number" });
check("set_where contains edits only matches", o.rows[0].n === 99 && o.rows[1].n === 20 && o.rows[2].n === 99);

// set_where (between on numeric)
o = run({ type: "set_where", col: "region", where: { col: "n", op: "between", value: [15, 25] }, action: "clear" });
check("set_where between+clear", o.rows[1].region === null && o.rows[0].region === "north");

// replace (regex)
o = run({ type: "replace", col: "label", match: { mode: "regex", find: "[0-9]+" }, replaceWith: "#" });
check("replace regex", o.rows[0].label === "ab#" && o.rows[1].label === "cd#");

// replace (contains, new column)
o = run({ type: "replace", col: "region", match: { mode: "contains", find: "th" }, replaceWith: "TH", nn: "region2" });
check("replace contains new col", o.headers.includes("region2") && o.rows[0].region2 === "norTH" && o.rows[0].region === "north");

// str_splice insert
o = run({ type: "str_splice", col: "label", position: 3, mode: "insert", text: "-" });
check("str_splice insert at pos 3", o.rows[0].label === "ab-12");

// str_splice delete from end
o = run({ type: "str_splice", col: "label", position: -1, mode: "delete", count: 1 });
check("str_splice delete last char", o.rows[0].label === "ab1");

// str_splice overwrite + numeric re-coercion
o = run({ type: "str_splice", col: "n", position: 1, mode: "overwrite", text: "9", count: 1 });
check("str_splice numeric re-coerce", o.rows[0].n === 90 && typeof o.rows[0].n === "number");

console.log(`\ngridSteps: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
```

- [ ] **Step 4: Run the harness**

Run: `node src/pipeline/__validation__/gridSteps.test.mjs`
Expected: `gridSteps: 12 passed, 0 failed`.

> If `runPipeline`'s return shape differs (it returns `{ rows, headers }`), the harness already assumes that. If a step case needs `R`/`H` variable names different from the surrounding switch, match the local convention in runner.js.

- [ ] **Step 5: Commit**

```bash
git add src/pipeline/runner.js src/pipeline/__validation__/gridSteps.test.mjs
git commit -m "feat(pipeline): add_column/add_row/set_where/replace/str_splice steps + harness

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Task 2: Registry entries

**Files:**
- Modify: `src/pipeline/registry.js`

- [ ] **Step 1: Add five entries to `STEP_REGISTRY`**

```js
  {
    type: "add_column",
    label: "Add column",
    category: "features",
    description: "Add a new column filled with a constant value.",
    schema: [
      { key: "nn",    type: "text",   label: "Column name" },
      { key: "fill",  type: "text",   label: "Fill value" },
      { key: "dtype", type: "select", label: "Type", options: [
        { value: "string", label: "String" }, { value: "number", label: "Number" } ] },
    ],
    toLabel: s => `add column ${s.nn}`,
    defaultStep: () => ({ type: "add_column", nn: "", fill: "", dtype: "string" }),
  },
  {
    type: "add_row",
    label: "Add row(s)",
    category: "cleaning",
    description: "Append blank or partially-filled rows. New rows get stable identities for later cell edits.",
    schema: [ { key: "count", type: "number", label: "Number of rows" } ],
    toLabel: s => `add ${s.count || 1} row(s)`,
    defaultStep: () => ({ type: "add_row", count: 1, values: {}, _seq: 0 }),
  },
  {
    type: "set_where",
    label: "Set value where…",
    category: "cleaning",
    description: "Set or clear a column's value on the rows matching a condition (the grid filter).",
    schema: [
      { key: "col",   type: "col",    label: "Column to set" },
      { key: "action",type: "select", label: "Action", options: [
        { value: "set", label: "Set to value" }, { value: "clear", label: "Clear (null)" } ] },
      { key: "value", type: "text",   label: "Value" },
    ],
    toLabel: s => `set ${s.col} ${s.action === "clear" ? "= NA" : `= ${s.value}`} where ${s.where?.col} ${s.where?.op} ${s.where?.value}`,
    defaultStep: () => ({ type: "set_where", col: "", where: { col: "", op: "equals", value: "" }, action: "set", value: "" }),
  },
  {
    type: "replace",
    label: "Find & replace",
    category: "cleaning",
    description: "Replace values in a column by exact match, substring, or regex.",
    schema: [
      { key: "col",         type: "col",    label: "Column" },
      { key: "find",        type: "text",   label: "Find" },
      { key: "replaceWith", type: "text",   label: "Replace with" },
      { key: "mode",        type: "select", label: "Match", options: [
        { value: "exact", label: "Exact" }, { value: "contains", label: "Contains" }, { value: "regex", label: "Regex" } ] },
      { key: "nn",          type: "text",   label: "New column (optional)" },
    ],
    toLabel: s => `replace in ${s.col}: "${s.match?.find ?? s.find}" → "${s.replaceWith}"`,
    defaultStep: () => ({ type: "replace", col: "", match: { mode: "exact", find: "" }, replaceWith: "", nn: "" }),
  },
  {
    type: "str_splice",
    label: "Edit characters at position",
    category: "features",
    description: "Insert, delete, or overwrite characters at a chosen position in each value (position 1 = first char; negative counts from the end).",
    schema: [
      { key: "col",      type: "col",    label: "Column" },
      { key: "mode",     type: "select", label: "Mode", options: [
        { value: "insert", label: "Insert" }, { value: "delete", label: "Delete" }, { value: "overwrite", label: "Overwrite" } ] },
      { key: "position", type: "number", label: "Position (1-based; -1 = end)" },
      { key: "text",     type: "text",   label: "Text" },
      { key: "count",    type: "number", label: "Count (delete/overwrite)" },
      { key: "nn",       type: "text",   label: "New column (optional)" },
    ],
    toLabel: s => `${s.mode} chars in ${s.col} at ${s.position}`,
    defaultStep: () => ({ type: "str_splice", col: "", mode: "insert", position: 1, text: "", count: 0, nn: "" }),
  },
```

> Note: `set_where.where` and `replace.match` are nested objects driven by the DataViewer UI (Task 4); the flat registry schema is a fallback editor. `toLabel` reads both shapes defensively.

- [ ] **Step 2: Build to verify**

Run: `npm run build`
Expected: success.

- [ ] **Step 3: Commit**

```bash
git add src/pipeline/registry.js
git commit -m "feat(pipeline): registry entries for grid-editing steps

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Task 3: DataStudio studio methods

**Files:**
- Modify: `src/DataStudio.jsx`

- [ ] **Step 1: Add a sequence counter ref**

Near the other refs in the component (e.g. by `wranglingAddStepRef`), add:

```js
  const addRowSeqRef = useRef(0);
```

- [ ] **Step 2: Add five methods to the `studioRef` imperative handle**

In the `useImperativeHandle`/`useMemo` object that already contains `addPatchStep`/`addFillColumnStep` (~line 993), add:

```js
    addColumnStep: (nn, fill, dtype) => {
      wranglingAddStepRef.current?.({
        type: "add_column", nn, fill, dtype,
        desc: `add column ${nn}`,
      });
    },
    addRowStep: (values = {}, count = 1) => {
      const seq = ++addRowSeqRef.current;
      wranglingAddStepRef.current?.({
        type: "add_row", values, count, _seq: seq,
        desc: `add ${count} row(s)`,
      });
    },
    addSetWhereStep: (col, where, action, value) => {
      wranglingAddStepRef.current?.({
        type: "set_where", col, where, action, value,
        desc: `set ${col} ${action === "clear" ? "= NA" : `= ${value}`} where ${where?.col} ${where?.op} ${where?.value}`,
      });
    },
    addReplaceStep: (col, match, replaceWith, nn) => {
      wranglingAddStepRef.current?.({
        type: "replace", col, match, replaceWith, nn: nn || "",
        desc: `replace in ${col}: "${match?.find}" → "${replaceWith}"`,
      });
    },
    addStrSpliceStep: (col, position, mode, text, count, nn) => {
      wranglingAddStepRef.current?.({
        type: "str_splice", col, position, mode, text, count, nn: nn || "",
        desc: `${mode} chars in ${col} at ${position}`,
      });
    },
```

> Confirm the imperative-handle object's dependency array includes nothing that would stale these closures; the existing methods there are the pattern to match. `useRef` is already imported (used elsewhere in DataStudio).

- [ ] **Step 3: Build to verify**

Run: `npm run build`
Expected: success.

- [ ] **Step 4: Commit**

```bash
git add src/DataStudio.jsx
git commit -m "feat(datastudio): studio methods for grid-editing steps

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Task 4: DataViewer toolbar UI (App.jsx)

**Files:**
- Modify: `src/App.jsx` (`DataViewer` component ~line 339; its render site ~line 1218)

- [ ] **Step 1: Add new props to DataViewer + wire them at the render site**

Extend the signature:

```js
function DataViewer({ rows, headers, filename, onPatch, onFillColumn, onAddColumn, onAddRow, onSetWhere, onReplace, onStrSplice, duckdbMeta }) {
```

At the render site (~1218, next to `onPatch`/`onFillColumn`):

```jsx
          onAddColumn={(nn, fill, dtype) => studioRef.current?.addColumnStep?.(nn, fill, dtype)}
          onAddRow={(values, count) => studioRef.current?.addRowStep?.(values, count)}
          onSetWhere={(col, where, action, value) => studioRef.current?.addSetWhereStep?.(col, where, action, value)}
          onReplace={(col, match, replaceWith, nn) => studioRef.current?.addReplaceStep?.(col, match, replaceWith, nn)}
          onStrSplice={(col, position, mode, text, count, nn) => studioRef.current?.addStrSpliceStep?.(col, position, mode, text, count, nn)}
```

- [ ] **Step 2: Add filter state + a structured filter bar**

Inside `DataViewer`, add state:

```js
  const [filterCol, setFilterCol] = useState("");
  const [filterOp, setFilterOp]   = useState("contains");
  const [filterVal, setFilterVal] = useState("");
```

Compute the filtered rows (predicate mirrors the runner's `buildPredicate`; the displayed `rows` should be replaced by `filteredRows` wherever the grid maps rows, and the count indicator updated):

```js
  const filterPredicate = useMemo(() => {
    if (!filterCol || !filterOp) return null;
    const sval = String(filterVal ?? "");
    const num = Number(filterVal);
    return (r) => {
      const raw = r[filterCol]; const s = raw == null ? "" : String(raw);
      switch (filterOp) {
        case "equals": return s === sval;
        case "contains": return s.includes(sval);
        case "starts": return s.startsWith(sval);
        case "ends": return s.endsWith(sval);
        case "gt": return Number(raw) > num;
        case "lt": return Number(raw) < num;
        case "empty": return raw == null || s === "";
        case "notempty": return raw != null && s !== "";
        default: return true;
      }
    };
  }, [filterCol, filterOp, filterVal]);

  const filteredRows = useMemo(
    () => filterPredicate ? rows.filter(filterPredicate) : rows,
    [rows, filterPredicate]
  );
```

Render a filter row in the toolbar (under the existing toolbar, near the Fill panel), with a column `<select>`, an op `<select>` (equals/contains/starts/ends/gt/lt/empty/notempty), and a value `<input>`, plus a "showing {filteredRows.length} of {rows.length}" indicator. **Replace the grid's row source** with `filteredRows` (and base pagination on `filteredRows`).

- [ ] **Step 3: Add the Set/Clear-where action (uses the filter predicate)**

Next to the filter bar, when `onSetWhere` is present, render: a target-column `<select>`, a value `<input>`, **Set** and **Clear** buttons. Both emit using the *structured filter* as the WHERE:

```jsx
const whereClause = { col: filterCol, op: filterOp, value: filterVal };
// Set:
onSetWhere(targetCol, whereClause, "set", setValue);
// Clear:
onSetWhere(targetCol, whereClause, "clear", null);
```

Show "will affect {filteredRows.length} rows". Disable when no `filterCol` (require a predicate so a bulk edit is never accidentally global — or allow global with a confirm; default: require a filter).

- [ ] **Step 4: Add ＋Column / ＋Row controls**

Two compact controls in the edit-mode toolbar:
- **＋ Column**: name input + dtype select + fill input → `onAddColumn(nn, fill, dtype)`.
- **＋ Row**: a button → `onAddRow({}, 1)` (appends one blank row; the existing per-cell `patch` editing fills it). Optional count input.

- [ ] **Step 5: Add Find & Replace + Positional editor panels**

- **Find & Replace**: column select, find, replaceWith, mode chips (exact/contains/regex), optional new-column name → `onReplace(col, { mode, find }, replaceWith, nn)`.
- **Positional**: column select, mode chips (insert/delete/overwrite), position number, text, count, optional new-column → `onStrSplice(col, position, mode, text, count, nn)`. Inline hint about 1-based / negative position.

All panels: render only in `editMode`, styled like the existing Fill panel (`C` palette, `mono`, small chips). Use a compact "action chip row" where each chip toggles its mini-form to avoid toolbar overflow.

- [ ] **Step 6: Build + browser-validate**

Run: `npm run build` → success.
Browser: add a column; add a row and edit its cells; filter (region contains "north") and Set a column on the subset; find & replace (regex) on a column; splice characters mid-value. Confirm each lands in History and Undo reverts; confirm pagination/indicator reflect the filter.

- [ ] **Step 7: Commit**

```bash
git add src/App.jsx
git commit -m "feat(dataviewer): Excel-grid toolbar — add col/row, filter+set-where, replace, positional edit

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Task 5: Docs (non-export)

**Files:**
- Modify: `CLAUDE.md`, `ClaudePlan.md`

- [ ] **Step 1: CLAUDE.md** — bump the pipeline step count by 5 and add the new steps to the category lists (Cleaning: `add_row, set_where, replace`; Features: `add_column, str_splice`). *(Coordinate the count with Codex's Batch-1 docs update — read the current number first; this adds 5 on top of whatever Codex set.)*

- [ ] **Step 2: ClaudePlan.md** — change the `2026-06-05 excel-grid-editing` row status from `OPEN` to `IN PROGRESS (export translations pending Codex merge)`.

- [ ] **Step 3: Commit**

```bash
git add CLAUDE.md ClaudePlan.md
git commit -m "docs: register grid-editing steps (export translations pending)

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Task 6: Replication translations (SEQUENCED LAST — gated on Codex export merge)

**Files:**
- Modify: `src/services/export/rScript.js`, `pythonScript.js`, `stataScript.js`

> ⚠ **Do not start until Codex's Batch-1 export-finish task has merged** (it edits these same files). Confirm `git log` shows Codex's Python/Stata export commits before beginning. This avoids a collision in `services/export/`.

- [ ] **Step 1: Add translators for each step in all three files**

| Step | R (dplyr) | Python (pandas) | Stata |
|---|---|---|---|
| `add_column` | `mutate(nn = fill)` | `df["nn"] = fill` | `gen nn = fill` |
| `add_row` | `add_row(...)` (commented; synthetic) | `pd.concat([df, pd.DataFrame([values])])` | `set obs` + `replace ... in` (commented) |
| `set_where` | `mutate(col = ifelse(<pred>, val, col))` | `df.loc[<pred>, "col"] = val` | `replace col = val if <pred>` |
| `replace` (exact) | `mutate(col = if_else(col == find, repl, col))` | `df["col"] = df["col"].replace(find, repl)` | `replace col = "repl" if col == "find"` |
| `replace` (contains) | `mutate(col = str_replace_all(col, fixed(find), repl))` | `df["col"] = df["col"].str.replace(find, repl, regex=False)` | `replace col = subinstr(col, "find", "repl", .)` |
| `replace` (regex) | `mutate(col = str_replace_all(col, find, repl))` | `df["col"] = df["col"].str.replace(find, repl, regex=True)` | `replace col = regexr(col, "find", "repl")` |
| `str_splice` | `stringr::str_sub` / `str_c` composition | string slice assignment | `substr`/`subinstr` composition |

Translate the `where` predicate (`set_where`) to each language's filter syntax via a shared helper per file (op → `==`/`grepl`/`>`/`between`, etc.). For `add_row`/`str_splice` where a faithful one-liner is awkward, emit a clearly commented manual-edit note rather than dropping the step.

- [ ] **Step 2: Build + spot-check exported scripts in the browser CodeEditor.**

Run: `npm run build` → success.

- [ ] **Step 3: Commit**

```bash
git add src/services/export/rScript.js src/services/export/pythonScript.js src/services/export/stataScript.js
git commit -m "feat(export): R/Python/Stata translations for grid-editing steps

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

- [ ] **Step 4: Mark the spec DONE in ClaudePlan.md and commit.**

---

## Self-review notes

- **Spec coverage:** A1–A5 → Tasks 1–2; Part B (UI) → Task 4; Part C (studio methods) → Task 3; Part D (exports) → Task 6 (gated); docs → Tasks 5/6.
- **Type consistency:** `set_where` shape `{col, where:{col,op,value}, action, value}` is identical across runner (Task 1), registry `toLabel` (Task 2), studio method (Task 3), and the UI emit (Task 4). `replace` uses `match:{mode,find}` everywhere. `str_splice` arg order `(col, position, mode, text, count, nn)` matches studio method and UI callback.
- **Determinism:** `add_row` `_seq` is stamped once at step creation (Task 3 counter ref), giving stable `__ri` across replays (Task 1 harness asserts this).
- **No JS unit runner:** Task 1's Node harness (12 checks) is the automated gate; UI is build + browser.
- **Collision discipline:** Tasks 1–5 avoid `services/export/*`; Task 6 is explicitly gated on Codex's export merge.
