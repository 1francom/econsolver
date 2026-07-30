# Distinct Values Panel Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let a user view every distinct value of a column (with counts), from a floating, minimizable, non-blocking panel reachable from Clean's Workbench tab.

**Architecture:** A SQL query (DuckDB) or JS fallback computes `{value, count}` pairs over the FULL dataset (never the 500-row preview), sorted by count descending, capped at 500 rows. A new self-contained panel component renders the result as a fixed-position floating window with its own minimize/close controls; its mount state (which column, minimized or not) is lifted to `WorkbenchTab.jsx` so the panel keeps floating above Feature/Reshape/Merge regardless of scroll position, while the trigger (a column picker + button) lives inside `FeatureTab.jsx`'s existing "Formatting" section.

**Tech Stack:** React (existing wrangling components), DuckDB-WASM (existing `services/data/duckdb.js` singleton), no new dependencies.

**Known scope limit (confirmed by reading `WranglingModule.jsx:696-722`):** Clean's top-level sub-tabs (`clean`/`quality`/`structure`/`workbench`/`dictionary`) are rendered with `{tab === "x" && (...)}` — a plain conditional, not `display:none` — so switching AWAY from "workbench" to a different Clean sub-tab unmounts everything inside it, including this panel. This is the same pre-existing limitation already tracked in `BugTriage.md` for `case_when` state loss. The panel survives scrolling and switching between Feature/Reshape/Merge (all stacked on one Workbench page) and, if `App.jsx` keeps top-level app tabs mounted via `display:none` as CLAUDE.md's "5b" section states, survives switching to Model/Explore/etc. — but not switching to Clean's own Quality/Structure/Dictionary tabs. This is a real, disclosed scope reduction from the spec's "stay visible while working elsewhere" wording, not a silent gap.

---

### Task 1: Pure JS fallback — distinct-value counting (genuinely unit-testable, no browser needed)

**Files:**
- Create: `src/services/data/distinctValuesFallback.js`
- Test: `src/services/data/__validation__/distinctValuesFallbackValidation.mjs`

This is the one piece of the feature with zero DuckDB/React dependency, so it's the one piece we can actually run under plain Node — matches this project's existing pattern of small `__validation__/*.mjs` scripts (e.g. `src/services/export/__validation__/plotTileFacetValidation.mjs`), since there is no `npm test` runner configured (`package.json` only has `dev`/`build`/`lint`/`lint:undef`).

- [ ] **Step 1: Write the function**

```javascript
// src/services/data/distinctValuesFallback.js
// Pure JS distinct-value counter — used when no DuckDB table backs the
// current dataset (small files stay entirely in JS `rows`, which for a
// non-DuckDB dataset already IS the full data, never a preview).
export function jsDistinctValues(rows, col, limit = 500) {
  const counts = new Map();
  for (const r of rows) {
    const v = r[col];
    if (v === null || v === undefined) continue;
    counts.set(v, (counts.get(v) ?? 0) + 1);
  }
  const sorted = [...counts.entries()].sort((a, b) => b[1] - a[1]);
  return {
    values: sorted.slice(0, limit).map(([value, count]) => ({ value, count })),
    total: counts.size,
  };
}
```

- [ ] **Step 2: Write the validation script**

```javascript
// src/services/data/__validation__/distinctValuesFallbackValidation.mjs
import { jsDistinctValues } from "../distinctValuesFallback.js";

let pass = 0, fail = 0;
function check(label, cond) {
  console.log(`  ${cond ? "PASS" : "FAIL"}  ${label}`);
  cond ? pass++ : fail++;
}

// Basic counting + descending sort by count
const rows1 = [
  { country: "USA" }, { country: "USA" }, { country: "USA" },
  { country: "Chile" }, { country: "Chile" },
  { country: "Peru" },
];
const r1 = jsDistinctValues(rows1, "country");
check("total distinct = 3", r1.total === 3);
check("most frequent first", r1.values[0].value === "USA" && r1.values[0].count === 3);
check("least frequent last", r1.values[2].value === "Peru" && r1.values[2].count === 1);

// Nulls/undefined excluded from both the list and the total
const rows2 = [{ x: 1 }, { x: null }, { x: undefined }, { x: 1 }, { x: 2 }];
const r2 = jsDistinctValues(rows2, "x");
check("nulls/undefined excluded from total", r2.total === 2);
check("nulls/undefined excluded from values", r2.values.every(v => v.value != null));

// Cap at `limit`, total still reflects the true distinct count
const rows3 = Array.from({ length: 800 }, (_, i) => ({ id: i }));
const r3 = jsDistinctValues(rows3, "id", 500);
check("capped list length", r3.values.length === 500);
check("total reflects true distinct count beyond the cap", r3.total === 800);

// Empty input
const r4 = jsDistinctValues([], "x");
check("empty input -> total 0", r4.total === 0);
check("empty input -> empty values", r4.values.length === 0);

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail === 0 ? 0 : 1);
```

- [ ] **Step 3: Run it, confirm it fails first (file doesn't exist yet if run out of order) or passes**

Run: `node src/services/data/__validation__/distinctValuesFallbackValidation.mjs`
Expected: `8 passed, 0 failed`

If any check fails, fix `jsDistinctValues` (not the test) and re-run until green.

- [ ] **Step 4: Commit**

```bash
git add src/services/data/distinctValuesFallback.js src/services/data/__validation__/distinctValuesFallbackValidation.mjs
git commit -m "Add pure-JS distinct-value fallback counter"
```

---

### Task 2: DuckDB query — `getDistinctValues`

**Files:**
- Modify: `src/services/data/duckdb.js`

Mirrors the existing `computeColStats` (same file, ~line 149): one query for the capped top-N list, a second for the true distinct count (needed because `LIMIT` alone doesn't tell you how many rows it cut off). Runs against the full DuckDB table, never the JS preview.

- [ ] **Step 1: Add the function**

Insert directly after `computeColStats` (after its closing `}` at line 164):

```javascript
export async function getDistinctValues(tableName, col, limit = 500) {
  const { conn } = await getDuckDB();
  const c = col.replace(/"/g, '""');
  const listResult = await conn.query(`
    SELECT "${c}" AS value, COUNT(*) AS n
    FROM "${tableName}"
    WHERE "${c}" IS NOT NULL
    GROUP BY "${c}"
    ORDER BY n DESC
    LIMIT ${limit}
  `);
  const totalResult = await conn.query(`
    SELECT COUNT(DISTINCT "${c}") AS total
    FROM "${tableName}"
    WHERE "${c}" IS NOT NULL
  `);
  const rows = listResult.toArray().map(arrowRowToObj);
  const total = Number(totalResult.toArray()[0].total);
  return {
    values: rows.map(r => ({ value: r.value, count: r.n })),
    total,
  };
}
```

- [ ] **Step 2: Verify by reading, not running**

This function needs a live DuckDB-WASM instance (browser WASM runtime) — it cannot run under plain Node the way Task 1's pure function can, same as every other function in this file. Verify by comparing side-by-side against `computeColStats` immediately above it in the same file:
- Same `getDuckDB()` singleton access pattern.
- Same `col.replace(/"/g, '""')` identifier-escaping (prevents a column name containing a `"` from breaking the query).
- Same `"${tableName}"` / `"${c}"` double-quoted SQL identifier quoting throughout.
- Uses the already-imported `arrowRowToObj` (defined earlier in this same file, line 87) to convert the BigInt `COUNT(*)` result to a JS number — `computeColStats` doesn't need this helper because none of its columns are BigInt, but `getDistinctValues`'s `n` column is a `COUNT(*)`, which DuckDB-WASM returns as BigInt.

Confirm `arrowRowToObj` and `getDuckDB` are both already in scope in this file (they are — `getDuckDB` is used two lines below `computeColStats`'s definition, `arrowRowToObj` at line 87) so no new imports are needed.

- [ ] **Step 3: Commit**

```bash
git add src/services/data/duckdb.js
git commit -m "Add getDistinctValues DuckDB query"
```

---

### Task 3: The floating panel component

**Files:**
- Create: `src/components/wrangling/DistinctValuesPanel.jsx`

Self-contained: does its own querying (DuckDB path or JS fallback) keyed on `(col, tableName)`, renders its own minimize/expand chrome. The PARENT (`WorkbenchTab.jsx`, wired in Task 5) owns whether it's mounted at all, which column it shows, and the minimized flag — this component just renders what it's told and reports user actions back via callbacks.

- [ ] **Step 1: Write the component**

```jsx
// src/components/wrangling/DistinctValuesPanel.jsx
// Floating, non-modal, minimizable panel showing every distinct value of a
// column (with counts). Unlike this app's existing modals (AuditTrail.jsx's
// full-screen dimmed overlay), this one does NOT block the rest of the UI —
// the point is to stay visible as a reference while the user keeps working
// elsewhere on the page (e.g. checking country names while building a
// country_code mapping).
import { useState, useEffect } from "react";
import { useTheme } from "./shared.jsx";
import { getDistinctValues } from "../../services/data/duckdb.js";
import { jsDistinctValues } from "../../services/data/distinctValuesFallback.js";

// Props:
//   col            string   — column to show (component re-queries when this changes)
//   tableName      string|null — DuckDB table name; null routes to the JS fallback
//   rows           object[] — full JS row array (used only in the JS-fallback path)
//   minimized      boolean
//   onToggleMinimize  () => void
//   onClose        () => void
export default function DistinctValuesPanel({ col, tableName, rows, minimized, onToggleMinimize, onClose }) {
  const { C, T } = useTheme();
  const [data, setData] = useState(null);     // { values: [{value,count}], total } | null
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError("");
    setData(null);
    (async () => {
      try {
        const result = tableName
          ? await getDistinctValues(tableName, col)
          : jsDistinctValues(rows, col);
        if (!cancelled) setData(result);
      } catch (e) {
        if (!cancelled) setError(e?.message ?? "Failed to compute distinct values.");
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
    // Deliberately NOT depending on `rows`/`tableName` reference churn — only
    // re-query when the user picks a different COLUMN. A v1 read-only
    // inspector; if the underlying data changes while the panel is open it
    // will not auto-refresh (reopen the panel to see fresh values).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [col]);

  const titleBarStyle = {
    display: "flex", alignItems: "center", gap: 8,
    padding: "0.5rem 0.7rem", background: C.surface,
    borderBottom: minimized ? "none" : `1px solid ${C.border}`,
    cursor: "default",
  };

  return (
    <div style={{
      position: "fixed", bottom: 16, right: 16, zIndex: 900,
      width: 320, maxWidth: "calc(100vw - 32px)",
      background: C.bg, border: `1px solid ${C.border2}`, borderRadius: 5,
      boxShadow: "0 8px 28px #000a", overflow: "hidden",
      fontFamily: T.code.fontFamily,
    }}>
      <div style={titleBarStyle}>
        <span style={{ fontSize: T.caption.fontSize, color: C.teal, letterSpacing: "0.1em", textTransform: "uppercase", flex: 1, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
          {col}
        </span>
        {!loading && !error && data && (
          <span style={{ fontSize: T.caption.fontSize, color: C.textMuted }}>
            {data.total > data.values.length ? `top ${data.values.length} of ${data.total}` : `${data.total} distinct`}
          </span>
        )}
        <button onClick={onToggleMinimize} title={minimized ? "Expand" : "Minimize"}
          style={{ background: "none", border: "none", color: C.textDim, cursor: "pointer", fontSize: 13, padding: "0 4px" }}>
          {minimized ? "▢" : "—"}
        </button>
        <button onClick={onClose} title="Close"
          style={{ background: "none", border: "none", color: C.textDim, cursor: "pointer", fontSize: 13, padding: "0 4px" }}>
          ✕
        </button>
      </div>

      {!minimized && (
        <div style={{ maxHeight: 320, overflowY: "auto", padding: "0.4rem 0" }}>
          {loading && (
            <div style={{ padding: "0.7rem", fontSize: T.caption.fontSize, color: C.textMuted }}>Computing…</div>
          )}
          {error && (
            <div style={{ padding: "0.7rem", fontSize: T.caption.fontSize, color: C.red }}>{error}</div>
          )}
          {!loading && !error && data && data.values.length === 0 && (
            <div style={{ padding: "0.7rem", fontSize: T.caption.fontSize, color: C.textMuted }}>No non-null values.</div>
          )}
          {!loading && !error && data && data.values.map((v, i) => (
            <div key={i} style={{
              display: "flex", justifyContent: "space-between", gap: 10,
              padding: "0.3rem 0.7rem", fontSize: T.caption.fontSize,
              color: C.text, borderBottom: i < data.values.length - 1 ? `1px solid ${C.border}` : "none",
            }}>
              <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{String(v.value)}</span>
              <span style={{ color: C.textMuted, flexShrink: 0 }}>{v.count}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
```

- [ ] **Step 2: Verify by reading against the spec**

Check off each spec requirement against the code above:
- "Anchored floating panel (bottom-right), does not dim/block the rest of the screen" → `position: fixed; bottom: 16; right: 16`, no full-screen overlay div, no `background: rgba(...)` scrim.
- "Title bar: column name + count, minimize toggle, close button" → present.
- "Expanded: title bar + scrollable two-column list (value · count)" → present, `maxHeight: 320, overflowY: "auto"`.
- "Minimized: only the title bar renders" → the list block is gated on `!minimized`.
- "Query result cached in state — minimizing does not re-query" → `useEffect` depends only on `[col]`; toggling `minimized` (a prop from the parent) never re-triggers the effect.
- "Capped at 500 / shows top 500 of N distinct" → the `data.total > data.values.length` banner text.

- [ ] **Step 3: Commit**

```bash
git add src/components/wrangling/DistinctValuesPanel.jsx
git commit -m "Add floating minimizable DistinctValuesPanel component"
```

---

### Task 4: Trigger UI in FeatureTab.jsx's Formatting section

**Files:**
- Modify: `src/components/wrangling/FeatureTab.jsx`

`FeatureEngineeringTab` (this file's default export, imported as `FeatureTab` elsewhere) currently has signature `function FeatureEngineeringTab({rows,headers,panel,info,onAdd,duckdbTableName}){` (line 565) and its "Formatting" section is:

```jsx
      {/* ── Formatting (Numbers + Strings) ── */}
      <Collapsible title="Formatting" color={C.gold}>
      <Collapsible title="Numbers" color={C.teal} defaultOpen>
        <FormatTab rows={rows} headers={headers} info={info} onAdd={onAdd} mode="numbers"/>
      </Collapsible>
      <Collapsible title="Strings" color={C.gold}>
        <FormatTab rows={rows} headers={headers} info={info} onAdd={onAdd} mode="strings"/>
      </Collapsible>
      </Collapsible>
```
(lines 876-884)

- [ ] **Step 1: Add the `onViewDistinct` prop and local picker state**

In `src/components/wrangling/FeatureTab.jsx`, change line 565 from:
```javascript
function FeatureEngineeringTab({rows,headers,panel,info,onAdd,duckdbTableName}){
```
to:
```javascript
function FeatureEngineeringTab({rows,headers,panel,info,onAdd,duckdbTableName,onViewDistinct}){
```

Then, near the top of the function body (right after the existing `const numC=headers.filter(h=>info[h]?.isNum);` at line 576), add:
```javascript
  const [distinctPickCol, setDistinctPickCol] = useState("");
```

- [ ] **Step 2: Add the picker + button, as a third section inside "Formatting"**

Replace the Formatting block (lines 876-884) with:
```jsx
      {/* ── Formatting (Numbers + Strings) ── */}
      <Collapsible title="Formatting" color={C.gold}>
      <Collapsible title="Numbers" color={C.teal} defaultOpen>
        <FormatTab rows={rows} headers={headers} info={info} onAdd={onAdd} mode="numbers"/>
      </Collapsible>
      <Collapsible title="Strings" color={C.gold}>
        <FormatTab rows={rows} headers={headers} info={info} onAdd={onAdd} mode="strings"/>
      </Collapsible>
      <Collapsible title="Distinct Values" color={C.violet}>
        <div style={{ display: "flex", alignItems: "center", gap: 8, padding: "0.6rem 0.9rem" }}>
          <Lbl mb={0}>column</Lbl>
          <select value={distinctPickCol} onChange={e => setDistinctPickCol(e.target.value)}
            style={{ background: C.bg, border: `1px solid ${C.border}`, borderRadius: 3, fontFamily: T.code.fontFamily, fontSize: T.caption.fontSize, padding: "3px 6px", color: C.text }}>
            <option value="">— col —</option>
            {headers.map(h => <option key={h} value={h}>{h}</option>)}
          </select>
          <Btn onClick={() => distinctPickCol && onViewDistinct?.(distinctPickCol)}
            color={C.violet} v="solid" dis={!distinctPickCol} ch="View distinct values →"/>
        </div>
      </Collapsible>
      </Collapsible>
```

- [ ] **Step 3: Run the project's build gate**

Run: `npm run build`
Expected: `ok — no undefined-identifier (no-undef) violations...` followed by a successful Vite build (no new errors). This project has no unit test runner; `npm run build` (which chains `lint:undef`) is the standing acceptance gate used throughout this session's other fixes.

- [ ] **Step 4: Commit**

```bash
git add src/components/wrangling/FeatureTab.jsx
git commit -m "Add distinct-values column picker to Formatting section"
```

---

### Task 5: Lift panel state into WorkbenchTab.jsx

**Files:**
- Modify: `src/components/wrangling/WorkbenchTab.jsx`

Current full file (21 lines, reproduced from the earlier read):
```jsx
// ─── ECON STUDIO · components/wrangling/WorkbenchTab.jsx ───────────────────
// Merged "Workbench" tab: feature engineering + reshape + merge, all visible
// at once, separated by GroupTitle bands (no nested subtabs). Each child was
// flattened (its internal <Tabs> removed) so every operation renders stacked.
import FeatureTab from "./FeatureTab.jsx";
import ReshapeTab from "./ReshapeTab.jsx";
import MergeTab   from "./MergeTab.jsx";

function WorkbenchTab({ rows, headers, info, panel, filename, allDatasets, onAdd, duckdbTableName }) {
  return (
    <div>
      <FeatureTab rows={rows} headers={headers} panel={panel} info={info}
        onAdd={onAdd} duckdbTableName={duckdbTableName}/>
      <ReshapeTab rows={rows} headers={headers} info={info} onAdd={onAdd}/>
      <MergeTab rows={rows} headers={headers} filename={filename}
        allDatasets={allDatasets} onAdd={onAdd}/>
    </div>
  );
}

export default WorkbenchTab;
```

This is placed one level above `FeatureTab`/`ReshapeTab`/`MergeTab` (not inside `FeatureTab.jsx` itself) specifically so the panel keeps floating above the whole Workbench page — including if the user scrolls down into the Reshape or Merge sections — rather than being tied to Feature's own scroll position.

- [ ] **Step 1: Replace the file**

```jsx
// ─── ECON STUDIO · components/wrangling/WorkbenchTab.jsx ───────────────────
// Merged "Workbench" tab: feature engineering + reshape + merge, all visible
// at once, separated by GroupTitle bands (no nested subtabs). Each child was
// flattened (its internal <Tabs> removed) so every operation renders stacked.
import { useState, useCallback } from "react";
import FeatureTab from "./FeatureTab.jsx";
import ReshapeTab from "./ReshapeTab.jsx";
import MergeTab   from "./MergeTab.jsx";
import DistinctValuesPanel from "./DistinctValuesPanel.jsx";

function WorkbenchTab({ rows, headers, info, panel, filename, allDatasets, onAdd, duckdbTableName }) {
  // Rendered one level above FeatureTab/ReshapeTab/MergeTab (not inside
  // FeatureTab.jsx) so it floats above the whole Workbench page — including
  // if the user has scrolled into the Reshape or Merge sections — instead of
  // being tied to Feature's own scroll position.
  const [distinctCol, setDistinctCol] = useState(null);       // string | null — null = not mounted
  const [distinctMinimized, setDistinctMinimized] = useState(false);

  const openDistinct = useCallback((col) => {
    setDistinctCol(col);
    // Opening a (possibly different) column always re-expands — the user
    // just took an action to view something, so it shouldn't stay hidden.
    setDistinctMinimized(false);
  }, []);

  return (
    <div>
      <FeatureTab rows={rows} headers={headers} panel={panel} info={info}
        onAdd={onAdd} duckdbTableName={duckdbTableName} onViewDistinct={openDistinct}/>
      <ReshapeTab rows={rows} headers={headers} info={info} onAdd={onAdd}/>
      <MergeTab rows={rows} headers={headers} filename={filename}
        allDatasets={allDatasets} onAdd={onAdd}/>
      {distinctCol && (
        <DistinctValuesPanel
          col={distinctCol}
          tableName={duckdbTableName}
          rows={rows}
          minimized={distinctMinimized}
          onToggleMinimize={() => setDistinctMinimized(m => !m)}
          onClose={() => setDistinctCol(null)}
        />
      )}
    </div>
  );
}

export default WorkbenchTab;
```

- [ ] **Step 2: Run the project's build gate**

Run: `npm run build`
Expected: green, same as Task 4 Step 3.

- [ ] **Step 3: Commit**

```bash
git add src/components/wrangling/WorkbenchTab.jsx
git commit -m "Mount DistinctValuesPanel at the Workbench level"
```

---

### Task 6: Franco's manual browser verification (cannot be automated in this session)

Per this project's standing rule (`feedback_no_browser_validation.md` / CLAUDE.md), no browser-automation tool is used in this repo — Franco validates in-browser himself. This task is a checklist for that pass, not something to execute here.

- [ ] Open a dataset small enough to stay JS-only (no DuckDB badge), go to Clean → Workbench → Formatting → Distinct Values, pick a categorical column, click "View distinct values →". Panel appears bottom-right, values sorted by count descending, no crash.
- [ ] Open a large dataset (>10MB, DuckDB-backed) and repeat. Confirm the count/list reflects the FULL table, not just the 500-row preview (e.g. compare the panel's total against a column known to have more than 500 distinct values, or against a `group_summarize` count in Explore).
- [ ] Click the minimize control (`—`) — panel collapses to just the title bar. Click again (`▢`) — expands, list still there (no re-query flash/reload).
- [ ] While the panel is open, pick a *different* column and click "View distinct values →" again — panel's content replaces (not a second panel stacking), and if it was minimized it re-expands.
- [ ] Scroll down into the Reshape/Merge sections of the same Workbench page — panel stays floating in the corner.
- [ ] Click ✕ — panel unmounts. Reopen a distinct-values view — starts fresh (loading state, no stale content).
- [ ] Switch to a different Clean sub-tab (e.g. Quality) and back to Workbench — confirm the panel does NOT persist (expected per this plan's disclosed scope limit, not a bug to report).

---

## Self-Review

**Spec coverage:**
- Column picker + button in Clean > Formatting — Task 4. ✓
- Query over full dataset (DuckDB) with JS fallback — Tasks 1–2. ✓
- Sorted by count descending — both `jsDistinctValues` and `getDistinctValues` `ORDER BY n DESC` / `.sort((a,b) => b[1]-a[1])`. ✓
- Capped at 500, "top N of total" messaging — `limit` param in both, panel's banner text. ✓
- Floating, non-modal, minimizable, single-instance panel — Task 3 (component) + Task 5 (single `distinctCol` state, replaced not stacked). ✓
- Minimized state doesn't re-query — `useEffect` depends only on `[col]`. ✓
- Re-expands on opening a new column while minimized — `openDistinct` always sets `distinctMinimized` to `false`. ✓
- No drag/resize, no copy/export — not implemented, matches "out of scope" list. ✓

**Placeholder scan:** No TBD/TODO; every step has complete, literal code.

**Type consistency:** `DistinctValuesPanel` props (`col`, `tableName`, `rows`, `minimized`, `onToggleMinimize`, `onClose`) are named identically in the component definition (Task 3) and at its call site (Task 5). `getDistinctValues(tableName, col, limit)` and `jsDistinctValues(rows, col, limit)` share the same `{ values: [{value, count}], total }` return shape, consumed identically in the panel regardless of which path ran.
