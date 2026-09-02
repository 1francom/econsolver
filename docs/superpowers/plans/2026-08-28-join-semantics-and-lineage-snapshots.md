# Join Semantics & Lineage Snapshots — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make Litux's `join` mean dplyr's `left_join`, add an explicit validated m:1 lookup op, and make every derived dataset carry a frozen, self-sufficient record of how it was built — so editing or deleting a parent can never break a child's replication script.

**Architecture:** Four independent phases. Phase 0 fixes join cardinality in the JS runner (the SQL path already expands — this is an alignment, not a new semantic) and adds a `lookup` step. Phase 1 introduces G-step schema v2: every derived dataset freezes its parents' `{name, filename, loadOpts, pipeline-as-of-now}`, so reconstruction never consults live state. Phase 2 lets a join write to a new dataset (`outputDatasetId`). Phase 3 rewrites the workspace exporter to use those frozen records with a three-case emission rule, and stops the AI from dropping the cross-dataset section.

**Tech Stack:** React 19 + Vite, pure-JS pipeline modules, `node`-run `.mjs` assertion harnesses (`node:assert/strict`) — this repo has no test runner. React files are verified by `npm run build` + `npm run lint:undef`; Franco does all browser validation (never use preview/browser tools).

---

## Non-goals (explicitly out of scope)

- **Null-key conflation.** `String(r[key] ?? "")` maps both `null` and `""` to `""`, so they match each other. dplyr's default `na_matches = "na"` makes NA match NA, so the null half is coincidentally right; the `null == ""` half is wrong. Not touched here — it would change row counts in a second, unrelated way.
- **`right`/`full`/`semi`/`anti` in the three local translators.** `stepTranslators.js:700` collapses every `how` to left/inner. Real gap, separate pass.
- **Retro-migrating existing G-steps to v2.** v1 records stay readable; the exporter falls back to today's by-reference emission for them.
- **DEFERRED 2026-08-28 (Franco's call) — Stata's many-to-many join.** Stata has no single instruction equivalent to dplyr's join: `merge 1:1` errors on any repeated key, `merge 1:m` errors when the *master* repeats the key, and `joinby` — the only one that truly expands — has no `suffixes()`, so homonym columns resolve differently than in the R/Python scripts. Both emitters (`stepTranslators.js` and the local copy in `stataScript.js`) now use `merge 1:m` plus a NOTE naming `joinby` and marking the block UNVERIFIED. This is correct for the common case (unique key in the master, e.g. attaching a panel onto metadata) and fails loudly rather than silently differently otherwise. **Franco will verify against a real Stata run at LMU and pick between `merge 1:m` and `joinby` then.** `joinCardinalityValidation.mjs` pins both emitters to the same cardinality and asserts the NOTE is present, so the decision cannot silently rot.

---

## File Structure

**Create**
- `src/pipeline/lineage.js` — pure helpers for frozen parent records: `freezeParent`, `emitMode`, `isPrefix`. Kept out of `exporter.js` so both the exporter and `DatasetManager` can import it without pulling in the translators.
- `src/pipeline/__validation__/joinCardinalityValidation.mjs` — join/lookup row-count harness.
- `src/pipeline/__validation__/lineageValidation.mjs` — frozen-record, topoSort and emission-mode harness.

**Modify**
- `src/pipeline/runner.js:773-841` — `join` expands; new `lookup` case.
- `src/pipeline/registry.js:702-724` — `join` description; new `lookup` entry.
- `src/pipeline/stepTranslators.js:699,1257,1837` — drop the dedup lines; add `lookup`.
- `src/pipeline/exporter.js:97,201,256-460` — `isInAppDataset`, `topoSort`, three-case emission.
- `src/components/wrangling/MergeTab.jsx:10,51,269` — cleaned right context, cardinality preview, copy, destination control.
- `src/WranglingModule.jsx:250,359,402,484` — pipeline error surface, G-step v2, `rmStep` cleanup, snapshot on save, `forkJoin`.
- `src/DataStudio.jsx:868-916` — `handleSaveSubset` accepts a frozen parent record.
- `src/components/workspace/DatasetManager.jsx:38,442` — cascade must not orphan children.
- `src/ReportingModule.jsx:1104` — cross-dataset section appended after the AI.

---

# PHASE 0 — Join semantics

## Task 1: `join` expands many-to-many in the JS runner

**Files:**
- Modify: `src/pipeline/runner.js:773-841`
- Test: `src/pipeline/__validation__/joinCardinalityValidation.mjs`

- [ ] **Step 1: Write the failing test**

Create `src/pipeline/__validation__/joinCardinalityValidation.mjs`:

```js
// Litux's `join` must mean dplyr's join, not a first-match lookup.
//
// The JS runner collapsed left/inner/full/right to ONE output row per left row
// (runner.js built a first-match Map). The DuckDB path (duckdbRunner.js "join")
// emits a real SQL LEFT JOIN and expands. So the same step returned 20 rows on a
// small dataset and 200 on a DuckDB-backed one, with nothing said either way.
import assert from "node:assert/strict";
import { applyStep } from "../runner.js";

// 3 comunas x 2 years = 6 panel rows; 3 metadata rows.
const comunas = [
  { id: "1", nombre: "A" },
  { id: "2", nombre: "B" },
  { id: "3", nombre: "C" },
];
const panel = [
  { id: "1", year: 2020, robos: 10 },
  { id: "1", year: 2021, robos: 11 },
  { id: "2", year: 2020, robos: 20 },
  { id: "2", year: 2021, robos: 21 },
  { id: "9", year: 2020, robos: 90 },  // no matching comuna
  { id: "9", year: 2021, robos: 91 },
];
const ctx = {
  datasets: {
    comunas: { rows: comunas, headers: ["id", "nombre"] },
    panel:   { rows: panel,   headers: ["id", "year", "robos"] },
  },
};
const join = (how, rightId) => ({ type: "join", how, rightId, leftKey: "id", rightKey: "id", suffix: "_r" });

// -- 1:m -- the case that was broken -----------------------------------------
// left_join(comunas, panel): comunas 1 and 2 match 2 rows each, comuna 3 matches
// none and is kept with nulls. dplyr gives 2 + 2 + 1 = 5.
const oneToMany = applyStep(comunas, ["id", "nombre"], join("left", "panel"), ctx);
assert.equal(oneToMany.rows.length, 5, "left join must expand 1:m (was collapsing to 3)");
assert.equal(oneToMany.rows.filter(r => r.id === "1").length, 2);
assert.equal(oneToMany.rows.find(r => r.id === "3").robos, null, "unmatched left row kept with null");
assert.deepEqual(oneToMany.headers, ["id", "nombre", "year", "robos"]);

// -- m:1 -- must be unchanged ------------------------------------------------
const manyToOne = applyStep(panel, ["id", "year", "robos"], join("left", "comunas"), ctx);
assert.equal(manyToOne.rows.length, 6, "m:1 left join must keep every left row exactly once");
assert.equal(manyToOne.rows.find(r => r.id === "9").nombre, null);

// -- inner -- drops unmatched left, still expands ----------------------------
const inner = applyStep(comunas, ["id", "nombre"], join("inner", "panel"), ctx);
assert.equal(inner.rows.length, 4, "inner join: 2 comunas x 2 years, comuna 3 dropped");

// -- full -- expands, then appends every unmatched right ROW -----------------
// 4 matched pairs + comuna 3 (no right) + id 9's TWO rows (no left) = 7.
const full = applyStep(comunas, ["id", "nombre"], join("full", "panel"), ctx);
assert.equal(full.rows.length, 7, "full join must append every unmatched right row, not one per key");

// -- right -- iterate right, expand over all left matches --------------------
const right = applyStep(comunas, ["id", "nombre"], join("right", "panel"), ctx);
assert.equal(right.rows.length, 6, "right join keeps every right row");
assert.equal(right.rows.filter(r => r.nombre === null).length, 2, "id 9's rows get null left cols");

// -- semi / anti -- filtering joins never expand -----------------------------
assert.equal(applyStep(comunas, ["id", "nombre"], join("semi", "panel"), ctx).rows.length, 2);
assert.equal(applyStep(comunas, ["id", "nombre"], join("anti", "panel"), ctx).rows.length, 1);

// -- suffix -- only the RIGHT side's conflicting column is renamed -----------
const clash = { datasets: { r: { rows: [{ id: "1", nombre: "X" }], headers: ["id", "nombre"] } } };
const suffixed = applyStep([{ id: "1", nombre: "A" }], ["id", "nombre"],
  { type: "join", how: "left", rightId: "r", leftKey: "id", rightKey: "id", suffix: "_r" }, clash);
assert.deepEqual(suffixed.headers, ["id", "nombre", "nombre_r"]);
assert.equal(suffixed.rows[0].nombre, "A");
assert.equal(suffixed.rows[0].nombre_r, "X");

console.log("joinCardinalityValidation: join OK");
```

- [ ] **Step 2: Run the test to verify it fails**

```bash
node src/pipeline/__validation__/joinCardinalityValidation.mjs
```

Expected: `AssertionError [ERR_ASSERTION]: left join must expand 1:m (was collapsing to 3)` — actual 3, expected 5.

- [ ] **Step 3: Replace the join case in `runner.js`**

In `src/pipeline/runner.js`, replace the entire body of `case "join": {` (from `const right = context?.datasets?.[s.rightId];` down to the `break;` immediately before `case "append":`) with:

```js
      const right = context?.datasets?.[s.rightId];
      if (!right) break;
      const rRows = right.rows, rHeaders = right.headers;
      const how = s.how || "left";
      const newCols = rHeaders.filter(h => h !== s.rightKey);
      const destOf = h => (H.includes(h) ? `${h}${s.suffix || "_r"}` : h);

      // Group the right side by key. A MULTIMAP, not a first-match Map: dplyr's
      // joins expand, and the DuckDB path (duckdbRunner.js "join") already emits
      // a real SQL JOIN. Collapsing here made the same step return a different
      // row count depending only on whether the dataset was DuckDB-backed.
      const rightGroups = new Map();
      rRows.forEach(r => {
        const k = String(r[s.rightKey] ?? "");
        const arr = rightGroups.get(k);
        if (arr) arr.push(r); else rightGroups.set(k, [r]);
      });

      // Filtering joins: add NO columns, just keep/drop left rows.
      if (how === "semi" || how === "anti") {
        R = rows.filter(r => {
          const has = rightGroups.has(String(r[s.leftKey] ?? ""));
          return how === "semi" ? has : !has;
        });
        break;
      }

      // Right join: iterate right rows, attach EVERY matching left row.
      if (how === "right") {
        const leftGroups = new Map();
        rows.forEach(r => {
          const k = String(r[s.leftKey] ?? "");
          const arr = leftGroups.get(k);
          if (arr) arr.push(r); else leftGroups.set(k, [r]);
        });
        const out = [];
        rRows.forEach(rr => {
          const lms = leftGroups.get(String(rr[s.rightKey] ?? "")) ?? [null];
          lms.forEach(lm => {
            const merged = {};
            H.forEach(h => { merged[h] = lm ? (lm[h] ?? null) : null; });
            newCols.forEach(h => { merged[destOf(h)] = rr[h] ?? null; });
            out.push(merged);
          });
        });
        R = out;
        newCols.forEach(h => { const d = destOf(h); if (!H.includes(d)) H = [...H, d]; });
        break;
      }

      // Left / inner / full.
      const matchedRightKeys = new Set();
      const outRows = [];
      rows.forEach(r => {
        const k = String(r[s.leftKey] ?? "");
        const matches = rightGroups.get(k);
        if (matches) {
          matchedRightKeys.add(k);
          matches.forEach(match => {
            const merged = { ...r };
            newCols.forEach(h => { merged[destOf(h)] = match[h] ?? null; });
            outRows.push(merged);
          });
        } else if (how === "left" || how === "full") {
          const merged = { ...r };
          newCols.forEach(h => { merged[destOf(h)] = null; });
          outRows.push(merged);
        }
        // inner: drop unmatched left rows
      });
      if (how === "full") {
        // Every unmatched right ROW, not one per unmatched key.
        rRows.forEach(rr => {
          if (matchedRightKeys.has(String(rr[s.rightKey] ?? ""))) return;
          const merged = {};
          H.forEach(h => { merged[h] = null; });
          newCols.forEach(h => { merged[destOf(h)] = rr[h] ?? null; });
          outRows.push(merged);
        });
      }
      R = outRows;
      newCols.forEach(h => { const d = destOf(h); if (!H.includes(d)) H = [...H, d]; });
      break;
```

- [ ] **Step 4: Run the test to verify it passes**

```bash
node src/pipeline/__validation__/joinCardinalityValidation.mjs
```

Expected: `joinCardinalityValidation: join OK`

- [ ] **Step 5: Run the existing pipeline harnesses for regressions**

```bash
node src/pipeline/__validation__/pipelineReliabilityValidation.mjs
```

```bash
node src/pipeline/__validation__/datasetContextValidation.mjs
```

Expected: both exit 0. If `datasetContextValidation.mjs` asserts a join row count computed under the old collapsing behaviour, update the expected number to the expanded count and add a one-line comment saying the join now expands.

- [ ] **Step 6: Commit**

```bash
git add src/pipeline/runner.js src/pipeline/__validation__/joinCardinalityValidation.mjs && git commit -m "fix(pipeline): join expands many-to-many, matching dplyr and the SQL path" -m "The JS runner collapsed left/inner/full/right to one output row per left row via a first-match Map, while duckdbRunner emitted a real SQL JOIN. The same step returned 20 rows on a small dataset and 200 on a DuckDB-backed one." -m "Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

## Task 2: `lookup` step — validated m:1 attach

**Files:**
- Modify: `src/pipeline/runner.js` (new case after `join`), `src/pipeline/registry.js:706,724`
- Test: `src/pipeline/__validation__/joinCardinalityValidation.mjs` (append)

- [ ] **Step 1: Write the failing test**

Append to `src/pipeline/__validation__/joinCardinalityValidation.mjs`, before its final `console.log`:

```js
// -- lookup: attach columns from a right side that MUST be unique per key ----
// Stata `merge m:1` / dplyr relationship = "many-to-one". This is the op people
// actually want when pinning metadata onto a panel. It never expands, and it
// REFUSES to run rather than silently picking one of several matches -- which is
// exactly what the old first-match join did.
const lookup = (rightId) => ({ type: "lookup", rightId, leftKey: "id", rightKey: "id", suffix: "_r" });

const attached = applyStep(panel, ["id", "year", "robos"], lookup("comunas"), ctx);
assert.equal(attached.rows.length, 6, "lookup never changes the left row count");
assert.equal(attached.rows[0].nombre, "A");
assert.equal(attached.rows.find(r => r.id === "9").nombre, null, "unmatched left row kept with null");
assert.deepEqual(attached.headers, ["id", "year", "robos", "nombre"]);

// The wrong direction must FAIL LOUDLY, not truncate the panel to one year.
assert.throws(
  () => applyStep(comunas, ["id", "nombre"], lookup("panel"), ctx),
  /not unique/,
  "lookup against a panel must throw, not collapse it"
);

console.log("joinCardinalityValidation: lookup OK");
```

- [ ] **Step 2: Run the test to verify it fails**

```bash
node src/pipeline/__validation__/joinCardinalityValidation.mjs
```

Expected: `AssertionError` on `assert.deepEqual(attached.headers, ...)` — `applyStep` matches no case, returns the rows untouched, so no `nombre` column exists.

- [ ] **Step 3: Add the `lookup` case to `runner.js`**

In `src/pipeline/runner.js`, immediately after the `case "join": { ... }` block's closing brace, insert:

```js
    case "lookup": {
      // m:1 attach -- Stata `merge m:1`, dplyr `relationship = "many-to-one"`.
      // Output row count ALWAYS equals the left row count. If the right key is
      // not unique the step throws instead of picking a match: silently keeping
      // "the first row in file order" is not a defined semantic -- a re-sorted
      // source file would change the result with nothing in the UI moving.
      const right = context?.datasets?.[s.rightId];
      if (!right) break;
      const rRows = right.rows, rHeaders = right.headers;
      const newCols = rHeaders.filter(h => h !== s.rightKey);
      const destOf = h => (H.includes(h) ? `${h}${s.suffix || "_r"}` : h);

      const byKey = new Map();
      for (const r of rRows) {
        const k = String(r[s.rightKey] ?? "");
        if (byKey.has(k)) {
          throw new Error(
            `Lookup failed: the right key "${s.rightKey}" is not unique — value "${k}" appears more than once. ` +
            `Use a Join (which expands to one row per match), or collapse the right dataset first with Group summarize.`
          );
        }
        byKey.set(k, r);
      }

      R = rows.map(r => {
        const match = byKey.get(String(r[s.leftKey] ?? ""));
        const merged = { ...r };
        newCols.forEach(h => { merged[destOf(h)] = match ? (match[h] ?? null) : null; });
        return merged;
      });
      newCols.forEach(h => { const d = destOf(h); if (!H.includes(d)) H = [...H, d]; });
      break;
    }
```

- [ ] **Step 4: Add the registry entry**

In `src/pipeline/registry.js`, immediately after the `join` entry's closing `},` (line 724), insert:

```js
  {
    type: "lookup",
    label: "Attach lookup columns",
    category: "merge",
    description: "Attach columns from another dataset whose key is unique (Stata merge m:1). Never changes the row count; fails if the right key repeats.",
    schema: [
      { key: "rightId",  type: "dataset", label: "Right dataset ID" },
      { key: "leftKey",  type: "col",     label: "Left key column" },
      { key: "rightKey", type: "text",    label: "Right key column" },
      { key: "suffix",   type: "text",    label: "Suffix for duplicate columns (default: _r)" },
    ],
    toLabel: s => `lookup ← ${s.rightId} on ${s.leftKey} = ${s.rightKey}`,
    defaultStep: () => ({ type: "lookup", rightId: "", leftKey: "", rightKey: "", suffix: "_r" }),
  },
```

In the same file, replace the `join` entry's `description` (line 706) with:

```js
    description: "Join against another loaded dataset on a key column: left, inner, right, full, semi, or anti. Matches dplyr — a key with several matches on the right produces several output rows.",
```

- [ ] **Step 5: Run the tests**

```bash
node src/pipeline/__validation__/joinCardinalityValidation.mjs
```

Expected: `joinCardinalityValidation: lookup OK`

```bash
node src/pipeline/__validation__/pipelineReliabilityValidation.mjs
```

Expected: exit 0. Its T5 check fails when a registry type has no runner case, so this proves runner and registry stayed in sync.

- [ ] **Step 6: Commit**

```bash
git add src/pipeline/runner.js src/pipeline/registry.js src/pipeline/__validation__/joinCardinalityValidation.mjs && git commit -m "feat(pipeline): add lookup step - validated m:1 attach" -m "Throws when the right key repeats instead of silently keeping the first match." -m "Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

## Task 3: Translators — stop compensating, and translate `lookup`

**Files:**
- Modify: `src/pipeline/stepTranslators.js:699-710` (R), `:1257-1274` (Stata), `:1837-1848` (Python)
- Test: `src/pipeline/__validation__/joinCardinalityValidation.mjs` (append)

- [ ] **Step 1: Write the failing test**

Append to `src/pipeline/__validation__/joinCardinalityValidation.mjs`, before its final `console.log`:

```js
// -- Translators must stop faking the old first-match behaviour --------------
// R/Python/Stata each emitted a dedup of the right side (distinct / drop_duplicates
// / bysort keep if _n==1) to reproduce the collapsing JS join. Now that the join
// expands, that dedup makes the SCRIPT disagree with the app.
import { toR, toPython, toStata } from "../stepTranslators.js";

const dsNames = { comunas: { name: "comunas", filename: "comunas.csv" } };
const jStep = { type: "join", how: "left", rightId: "comunas", leftKey: "id", rightKey: "id", suffix: "_r" };
const lStep = { type: "lookup", rightId: "comunas", leftKey: "id", rightKey: "id", suffix: "_r" };

const rJoin = toR(jStep, "df_panel", dsNames);
assert.doesNotMatch(rJoin, /distinct/, "R join must not dedup the right side any more");
assert.match(rJoin, /left_join/);
assert.match(rJoin, /suffix = c\("", "_r"\)/, "R must emit the asymmetric suffix Litux uses");

const pyJoin = toPython(jStep, "df_panel", dsNames);
assert.doesNotMatch(pyJoin, /drop_duplicates/, "Python join must not dedup the right side any more");

const stJoin = toStata(jStep, "df", dsNames);
assert.doesNotMatch(stJoin, /_n == 1/, "Stata join must not dedup the right side any more");
assert.match(stJoin, /merge 1:m/, "Stata join must allow expansion");

// lookup keeps the uniqueness contract in every language
assert.match(toR(lStep, "df_panel", dsNames), /relationship = "many-to-one"/);
assert.match(toPython(lStep, "df_panel", dsNames), /validate="m:1"/);
assert.match(toStata(lStep, "df", dsNames), /merge m:1/);

console.log("joinCardinalityValidation: translators OK");
```

- [ ] **Step 2: Run the test to verify it fails**

```bash
node src/pipeline/__validation__/joinCardinalityValidation.mjs
```

Expected: `AssertionError: R join must not dedup the right side any more`.

- [ ] **Step 3: Rewrite the R join case and add lookup**

In `src/pipeline/stepTranslators.js`, replace `case "join": {` at line 699 (through its closing brace) with:

```js
    case "join": {
      const how       = step.how === "inner" ? "inner_join" : "left_join";
      const rightName = safeDatasetName(step.rightId, allDatasets);
      return [
        `# Load right dataset: "${rightName}"`,
        `right_df <- ${rRightLoad(step.rightId, allDatasets)}`,
        `${df} <- dplyr::${how}(${df}, right_df, by = c(${rStr(step.leftKey)} = ${rStr(step.rightKey)}), suffix = c("", ${rStr(step.suffix ?? "_r")}))`,
      ].join("\n");
    }

    case "lookup": {
      const rightName = safeDatasetName(step.rightId, allDatasets);
      return [
        `# Attach lookup columns from: "${rightName}" (right key must be unique)`,
        `right_df <- ${rRightLoad(step.rightId, allDatasets)}`,
        `${df} <- dplyr::left_join(${df}, right_df, by = c(${rStr(step.leftKey)} = ${rStr(step.rightKey)}), suffix = c("", ${rStr(step.suffix ?? "_r")}), relationship = "many-to-one")`,
      ].join("\n");
    }
```

- [ ] **Step 4: Rewrite the Stata join case and add lookup**

Replace `case "join": {` at line 1257 (through its closing brace) with:

```js
    case "join": {
      const rightName = safeDatasetName(step.rightId, allDatasets);
      return [
        `* Join dataset: "${rightName}"`,
        `preserve`,
        `${stataRightLoad(step.rightId, allDatasets)}`,
        `rename ${stVar(step.rightKey)} ${stVar(step.leftKey)}`,
        `save _right_tmp.dta, replace`,
        `restore`,
        `* 1:m - a key with several matches on the right produces several rows`,
        `merge 1:m ${stVar(step.leftKey)} using _right_tmp.dta`,
        step.how === "inner" ? `keep if _merge == 3` : `drop if _merge == 2`,
        `drop _merge`,
      ].join("\n");
    }

    case "lookup": {
      const rightName = safeDatasetName(step.rightId, allDatasets);
      return [
        `* Attach lookup columns from: "${rightName}"`,
        `preserve`,
        `${stataRightLoad(step.rightId, allDatasets)}`,
        `rename ${stVar(step.rightKey)} ${stVar(step.leftKey)}`,
        `save _right_tmp.dta, replace`,
        `restore`,
        `* m:1 errors out if the right key is not unique - same contract as Litux`,
        `merge m:1 ${stVar(step.leftKey)} using _right_tmp.dta`,
        `drop if _merge == 2`,
        `drop _merge`,
      ].join("\n");
    }
```

- [ ] **Step 5: Rewrite the Python join case and add lookup**

Replace `case "join": {` at line 1837 (through its closing brace) with:

```js
    case "join": {
      const rightName = safeDatasetName(step.rightId, allDatasets);
      const how = step.how === "inner" ? "inner" : "left";
      return [
        `# Join dataset: "${rightName}"`,
        `right_df = ${pyRightLoad(step.rightId, allDatasets)}`,
        `${df} = pd.merge(${df}, right_df, left_on=${pyCol(step.leftKey)}, right_on=${pyCol(step.rightKey)}, how=${pyStr(how)}, suffixes=("", ${pyStr(step.suffix ?? "_r")}))`,
      ].join("\n");
    }

    case "lookup": {
      const rightName = safeDatasetName(step.rightId, allDatasets);
      return [
        `# Attach lookup columns from: "${rightName}" (validate raises if the right key repeats)`,
        `right_df = ${pyRightLoad(step.rightId, allDatasets)}`,
        `${df} = pd.merge(${df}, right_df, left_on=${pyCol(step.leftKey)}, right_on=${pyCol(step.rightKey)}, how="left", suffixes=("", ${pyStr(step.suffix ?? "_r")}), validate="m:1")`,
      ].join("\n");
    }
```

- [ ] **Step 6: Run the tests**

```bash
node src/pipeline/__validation__/joinCardinalityValidation.mjs
```

Expected: `joinCardinalityValidation: translators OK`

```bash
node src/services/export/__validation__/replicationIntegrityValidation.mjs
```

Expected: exit 0. This harness auto-enumerates registry types, so `lookup` having no translator would fail it.

- [ ] **Step 7: Commit**

```bash
git add src/pipeline/stepTranslators.js src/pipeline/__validation__/joinCardinalityValidation.mjs && git commit -m "fix(export): drop the first-match dedup from join translators; add lookup" -m "Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

## Task 4: MergeTab — cleaned right side, cardinality preview, honest copy

**Files:**
- Modify: `src/components/wrangling/MergeTab.jsx:10,11,38-56,58-90,269-271`, `src/WranglingModule.jsx:248-252`

No `.mjs` test — this is React. Verified by build + Franco's browser pass.

- [ ] **Step 1: Thread the cleaned right context into MergeTab**

`MergeTab` builds its preview context from `d.rawData.rows` (line 53) while the runner joins against the *cleaned* right side (`buildDatasetContext`, `WranglingModule.jsx:152`). The preview reports matches against data the join never sees, and the panel's help text documents that bug as if it were the behaviour.

In `src/WranglingModule.jsx`, find the `<MergeTab ... />` render and add the already-computed `context`:

```jsx
<MergeTab
  rows={rows} headers={headers} filename={filename}
  allDatasets={allDatasets} onAdd={addStep}
  joinContext={context}
/>
```

In `src/components/wrangling/MergeTab.jsx`, change the signature at line 11:

```jsx
function MergeTab({ rows, headers, filename, allDatasets, onAdd, joinContext = null }) {
```

Replace the `joinContext` memo (lines 51-56) with:

```jsx
  // Context for applyStep. Prefer the CLEANED right side supplied by
  // WranglingModule (buildDatasetContext replays each right dataset's pipeline) --
  // that is what the real join runs against. Falling back to raw would make the
  // preview report matches against data the join never sees.
  const joinCtx = useMemo(() => {
    if (joinContext?.datasets && Object.keys(joinContext.datasets).length) return joinContext;
    const datasets = {};
    allDatasets.forEach(d => { datasets[d.id] = { rows: d.rawData.rows, headers: d.rawData.headers }; });
    return { datasets };
  }, [joinContext, allDatasets]);

  const rightOf = (id) => {
    if (joinCtx.datasets[id]) return joinCtx.datasets[id];
    const d = allDatasets.find(x => x.id === id);
    return d ? { rows: d.rawData.rows, headers: d.rawData.headers } : { rows: [], headers: [] };
  };
```

Then inside `headerChain` replace `right.rawData.headers` with `rightOf(sj.rightId).headers`, and inside `matchPreviews` replace `r.rawData.rows` with `rightOf(j.rightId).rows` and the `joinContext` argument to `applyStep` with `joinCtx`.

- [ ] **Step 2: Compute output cardinality in the preview**

In `matchPreviews`, immediately after `const validRows = curRows.length - keyNulls;`, insert:

```js
      // Cardinality of the right side per key -- this is what decides whether the
      // join expands. "100% matched" says nothing about the output row count,
      // which is the number that surprised people.
      const rightCounts = new Map();
      rightOf(j.rightId).rows.forEach(rr => {
        const k = String(rr[j.rightKey] ?? "");
        rightCounts.set(k, (rightCounts.get(k) ?? 0) + 1);
      });
      let maxPerKey = 0;
      rightCounts.forEach(n => { if (n > maxPerKey) maxPerKey = n; });
      let outRows = 0;
      curRows.forEach(row => {
        const n = rightCounts.get(String(row[j.leftKey] ?? "")) ?? 0;
        outRows += n > 0 ? n : ((j.how === "left" || j.how === "full") ? 1 : 0);
      });
```

and add `maxPerKey` and `outRows` to the object pushed into `previews`.

- [ ] **Step 3: Render it**

Replace the match-count line (lines 269-270) with:

```jsx
<span style={{color:mc}}>{mp.matched.toLocaleString()}</span>
{" of "}{mp.validRows.toLocaleString()} left rows matched
{mp.maxPerKey > 1 && (
  <div style={{marginTop:4, color:C.gold}}>
    1:m — right key ‘{j.rightKey}’ has up to {mp.maxPerKey} rows per key.
    Result: {mp.outRows.toLocaleString()} rows.
    {" "}Want one row per left row instead? Use <b>Attach lookup columns</b>.
  </div>
)}
```

- [ ] **Step 4: Fix the two stale statements**

`src/components/wrangling/MergeTab.jsx` line 10:

```js
// RHS uses the CLEANED (post-pipeline) data of the referenced dataset.
```

And in the JOIN panel's help prose, replace *"Each right dataset is referenced in its raw (pre-pipeline) state."* with:

```
Each right dataset is referenced in its cleaned state — its own pipeline runs first.
```

- [ ] **Step 5: Surface a pipeline error instead of an infinite spinner**

`lookup` throws. `runPipeline` at `WranglingModule.jsx:250` runs inside a `setTimeout` with no `try/catch`, so a throw leaves `isProcessing` true forever with nothing on screen. Declare state alongside the other pipeline state:

```jsx
  const [pipelineError, setPipelineError] = useState(null);
```

Replace the `setTimeout` block (lines 248-252) with:

```jsx
        const timerId = setTimeout(() => {
          if (cancelled) return;
          try {
            setPipelineError(null);
            done(runPipeline(rawData.rows, rawData.headers, pipeline, context));
          } catch (e) {
            setPipelineError(e?.message ?? "Pipeline step failed.");
            done({ rows: rawData.rows, headers: rawData.headers });
          }
        }, 0);
```

And render it above the tab strip:

```jsx
{pipelineError && (
  <div style={{margin:"8px 0", padding:"10px 12px", border:`1px solid ${C.gold}`,
               background:"rgba(200,169,110,0.08)", color:C.gold,
               fontFamily:T.code.fontFamily, fontSize:T.code.fontSize}}>
    ⚠ {pipelineError} — showing the unprocessed data. Remove or fix the step in the pipeline sidebar.
  </div>
)}
```

`WranglingModule` must have `C` and `T` in scope at that render site (it uses `useTheme()` like the rest of the module). If `T` is not destructured there, add it — do **not** reach for a module-level `mono` constant: `shared.jsx` deliberately removed the static `DARK as C` / `mono` exports because they froze the palette at import time.

- [ ] **Step 6: Build**

```bash
npm run lint:undef
```

```bash
npm run build
```

Expected: both green.

- [ ] **Step 7: Commit**

```bash
git add src/components/wrangling/MergeTab.jsx src/WranglingModule.jsx && git commit -m "fix(clean): join preview uses the cleaned right side and reports output cardinality" -m "Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

# PHASE 1 — Frozen lineage snapshots

## Task 5: `lineage.js` — freeze and emission-mode helpers

**Files:**
- Create: `src/pipeline/lineage.js`
- Test: `src/pipeline/__validation__/lineageValidation.mjs`

- [ ] **Step 1: Write the failing test**

Create `src/pipeline/__validation__/lineageValidation.mjs`:

```js
// A derived dataset must be reconstructible from what IT carries -- never from
// the live state of a parent that may since have been edited or deleted.
import assert from "node:assert/strict";
import { freezeParent, emitMode, isPrefix } from "../lineage.js";

const ds = { id: "d1", name: "comunas_metadata", filename: "comunas_metadata.csv",
             loadOpts: { delimiter: ";" } };
const pipeAt = [{ id: 1, type: "drop", cols: ["col"] }];

// -- freezeParent captures everything needed to rebuild from the raw file ----
const frozen = freezeParent(ds, pipeAt);
assert.equal(frozen.datasetId, "d1");
assert.equal(frozen.name, "comunas_metadata");
assert.equal(frozen.filename, "comunas_metadata.csv");
assert.deepEqual(frozen.loadOpts, { delimiter: ";" });
assert.deepEqual(frozen.snapshot, pipeAt);

// It must be a COPY -- mutating the parent's array afterwards cannot reach it.
pipeAt.push({ id: 2, type: "filter" });
assert.equal(frozen.snapshot.length, 1, "snapshot must not alias the live pipeline array");

// -- isPrefix ----------------------------------------------------------------
assert.equal(isPrefix([{ id: 1 }], [{ id: 1 }, { id: 2 }]), true);
assert.equal(isPrefix([{ id: 1 }], [{ id: 1 }]), true);
assert.equal(isPrefix([{ id: 1 }], [{ id: 9 }, { id: 1 }]), false, "same ids, wrong order is not a prefix");
assert.equal(isPrefix([{ id: 1 }, { id: 2 }], [{ id: 1 }]), false);

// -- emitMode -- the three-case emission rule -------------------------------
assert.equal(emitMode(frozen, [{ id: 1 }]), "identical");
assert.equal(emitMode(frozen, [{ id: 1 }, { id: 2 }]), "prefix",
  "parent only APPENDED steps -- the join can still be emitted at its point in the chain");
assert.equal(emitMode(frozen, [{ id: 2 }]), "diverged",
  "the frozen step was deleted from the parent -- must expand from raw");
assert.equal(emitMode(frozen, []), "diverged");
assert.equal(emitMode(null, [{ id: 1 }]), "legacy", "a v1 G-step with no frozen record");

console.log("lineageValidation: helpers OK");
```

- [ ] **Step 2: Run the test to verify it fails**

```bash
node src/pipeline/__validation__/lineageValidation.mjs
```

Expected: `ERR_MODULE_NOT_FOUND` — `src/pipeline/lineage.js` does not exist.

- [ ] **Step 3: Write `src/pipeline/lineage.js`**

```js
// ─── ECON STUDIO · pipeline/lineage.js ───────────────────────────────────────
// Frozen provenance for derived datasets.
//
// R has value semantics: `df2 <- df1 %>% filter(...)` copies. Editing df1
// afterwards does not change df2. Litux promises "this replicates in R", so its
// lineage must behave the same way: when a dataset is derived (a join written to
// a new dataset, or "Save as dataset"), each parent's state is FROZEN into the
// G-step. Nothing about the parent can reach the child afterwards.
//
// The frozen record is deliberately self-sufficient -- it carries filename and
// loadOpts, not just a datasetId -- so the child stays reconstructible even after
// the parent is deleted from the session. That decouples correctness from the
// dependency graph: the topological order becomes a readability optimisation,
// not a requirement.
//
// Pure JS, no React imports.

/**
 * Snapshot a parent dataset at the moment a child is derived from it.
 *
 * @param {object} ds         - { id, name, filename, loadOpts }
 * @param {object[]} pipeline - the parent's pipeline AS OF NOW
 * @returns {{datasetId:string|null, name:string|null, filename:string|null, loadOpts:object|null, snapshot:object[]}}
 */
export function freezeParent(ds, pipeline) {
  return {
    datasetId: ds?.id ?? null,
    name:      ds?.name ?? ds?.filename ?? null,
    filename:  ds?.filename ?? null,
    loadOpts:  ds?.loadOpts ?? null,
    // A new array of shallow step copies. The live pipeline array is replaced by
    // setPipeline on every edit, but a caller could hand us the same reference --
    // copying here is what makes the snapshot actually frozen.
    snapshot:  (Array.isArray(pipeline) ? pipeline : []).map(s => ({ ...s })),
  };
}

/**
 * Is `a` a leading prefix of `b`? Compared by step id sequence -- step ids are
 * unique and stable (Date.now() + Math.random() at creation), and Litux only
 * ever appends or removes steps, never edits one in place.
 */
export function isPrefix(a, b) {
  if (!Array.isArray(a) || !Array.isArray(b)) return false;
  if (a.length > b.length) return false;
  for (let i = 0; i < a.length; i++) {
    if (a[i]?.id !== b[i]?.id) return false;
  }
  return true;
}

/**
 * How should the exporter emit a child built from this frozen parent?
 *
 *   "legacy"    - no frozen record (a v1 G-step). Caller falls back to the old
 *                 by-reference emission.
 *   "identical" - the parent has not moved. Emit the one-liner against df_parent.
 *   "prefix"    - the parent only APPENDED steps. Emit the child at its point in
 *                 the parent's chain, before those later steps.
 *   "diverged"  - a frozen step was removed or reordered. Rebuild the parent's
 *                 state from its raw file under a private name.
 *
 * @param {object|null} frozen  - a freezeParent() record
 * @param {object[]}    current - the parent's pipeline right now
 * @returns {"legacy"|"identical"|"prefix"|"diverged"}
 */
export function emitMode(frozen, current) {
  if (!frozen || !Array.isArray(frozen.snapshot)) return "legacy";
  const cur = Array.isArray(current) ? current : [];
  if (frozen.snapshot.length === cur.length && isPrefix(frozen.snapshot, cur)) return "identical";
  if (isPrefix(frozen.snapshot, cur)) return "prefix";
  return "diverged";
}
```

- [ ] **Step 4: Run the test to verify it passes**

```bash
node src/pipeline/__validation__/lineageValidation.mjs
```

Expected: `lineageValidation: helpers OK`

- [ ] **Step 5: Commit**

```bash
git add src/pipeline/lineage.js src/pipeline/__validation__/lineageValidation.mjs && git commit -m "feat(pipeline): lineage.js - frozen parent records and emission-mode rule" -m "Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

## Task 6: G-step schema v2 on join/append/lookup creation

**Files:**
- Modify: `src/WranglingModule.jsx:120-165, 353-386`
- Test: `src/pipeline/__validation__/lineageValidation.mjs` (append)

- [ ] **Step 1: Write the shape-contract test**

`addStep` lives inside a React component and cannot be imported by node. Assert the *shape contract* that the exporter (Task 13) depends on, so a change to either side without the other breaks here. Append to `src/pipeline/__validation__/lineageValidation.mjs`, before its final `console.log`:

```js
// -- G-step v2 shape contract -----------------------------------------------
// WranglingModule.addStep and exporter.generateWorkspaceScript must agree on
// this shape. Neither can be imported here (React / heavy deps), so the contract
// is pinned directly: changing one side without the other breaks this file.
const gStepV2 = {
  id: "G_123", v: 2, localStepId: 123,
  opType: "left_join",
  leftDatasetId: "d1", rightDatasetId: "d2",
  outputDatasetId: "d1",                      // forma 2 -- result stays in the left
  params: { how: "left", leftKey: "id", rightKey: "id", suffix: "_r" },
  left:  freezeParent({ id: "d1", name: "comunas", filename: "comunas.csv" }, [{ id: 1, type: "drop" }]),
  right: freezeParent({ id: "d2", name: "crimen",  filename: "crimen.csv"  }, []),
};

for (const k of ["id", "v", "opType", "leftDatasetId", "rightDatasetId", "outputDatasetId", "params", "left", "right"]) {
  assert.ok(k in gStepV2, `G-step v2 must carry '${k}'`);
}
assert.equal(gStepV2.v, 2);
assert.equal(gStepV2.outputDatasetId, gStepV2.leftDatasetId, "forma 2 writes back to the left dataset");
for (const side of ["left", "right"]) {
  for (const k of ["datasetId", "name", "filename", "loadOpts", "snapshot"]) {
    assert.ok(k in gStepV2[side], `G-step v2 '${side}' must carry '${k}' (self-sufficient after parent deletion)`);
  }
}
assert.equal(emitMode(gStepV2.left, [{ id: 1, type: "drop" }]), "identical");

// A v1 record (no `v`, no left/right) must stay recognisable, not crash.
const gStepV1 = { id: "G_1", opType: "left_join", leftDatasetId: "d1",
                  rightDatasetId: "d2", outputDatasetId: "d1", params: {} };
assert.equal(emitMode(gStepV1.left, []), "legacy");

console.log("lineageValidation: G-step v2 contract OK");
```

- [ ] **Step 2: Run it — it passes immediately**

```bash
node src/pipeline/__validation__/lineageValidation.mjs
```

Expected: `G-step v2 contract OK`. This is the one place in the plan where the test is a contract guard rather than a red-green driver: it exists so Step 3's shape cannot silently drift from the exporter's expectations.

- [ ] **Step 3: Expose the right datasets' pipelines to `addStep`**

`addStep` needs each right dataset's pipeline to freeze it. The context effect already loads that map from IndexedDB but discards it. In `src/WranglingModule.jsx`, declare state near the other pipeline state:

```jsx
  // Per-dataset pipelines for every OTHER dataset, loaded from IDB by the context
  // effect below. addStep needs them to freeze a join's right operand.
  const [rightPipelines, setRightPipelines] = useState({});
```

In the context effect, immediately after `stepsById = (await loadProjectPipelines(ownerPid))?.datasetPipelines ?? {};`, add:

```js
      if (!cancelled) setRightPipelines(stepsById);
```

- [ ] **Step 4: Emit v2 records from `addStep`**

Add the import at the top of `src/WranglingModule.jsx`:

```js
import { freezeParent } from "./pipeline/lineage.js";
```

Replace the `if (sessionDispatch && (s.type === "join" || s.type === "append"))` block (lines 360-376) with:

```js
    if (sessionDispatch && (s.type === "join" || s.type === "append" || s.type === "lookup")) {
      gStepId = `G_${stepId}`;
      const selfDs  = { id: pid, name: filename, filename, loadOpts: loadOpts ?? null };
      const rightDs = (allDatasets ?? []).find(d => d.id === s.rightId) ?? null;
      const rightPipe = rightPipelines?.[s.rightId]?.steps
                     ?? rightPipelines?.[s.rightId]?.pipeline
                     ?? [];
      sessionDispatch({
        type: "ADD_GLOBAL_STEP",
        step: {
          id:              gStepId,
          v:               2,
          localStepId:     stepId,
          opType:          s.type === "join" ? `${s.how || "left"}_join` : s.type,
          leftDatasetId:   pid,
          rightDatasetId:  s.rightId,
          // Forma 2 (default): the result augments the LEFT dataset in place.
          // Task 10 lets the user redirect this to a new dataset.
          outputDatasetId: s.outputDatasetId ?? pid,
          params:          (s.type === "join" || s.type === "lookup")
            ? { how: s.how ?? null, leftKey: s.leftKey, rightKey: s.rightKey, suffix: s.suffix }
            : {},
          // Frozen, self-sufficient parent records -- see pipeline/lineage.js.
          // Captured BEFORE this step is appended, so the snapshot is exactly the
          // state the join consumed.
          left:  freezeParent(selfDs, pipeline),
          right: rightDs
            ? freezeParent({ id: rightDs.id, name: rightDs.name ?? rightDs.filename,
                             filename: rightDs.filename ?? null, loadOpts: rightDs.loadOpts ?? null },
                           rightPipe)
            : null,
        },
      });
    }
```

Add `pipeline`, `allDatasets`, `rightPipelines` and `loadOpts` to `addStep`'s `useCallback` dependency array. **This matters:** a missing dep here reproduces the stale-closure class of bug listed in CLAUDE.md (`estimate()` for SC/EventStudy/LSDV) — `addStep` would freeze whatever `pipeline` was on first render, i.e. an empty array, silently.

- [ ] **Step 5: Verify**

```bash
node src/pipeline/__validation__/lineageValidation.mjs
```

```bash
npm run lint:undef && npm run build
```

Expected: harness green, build green.

- [ ] **Step 6: Commit**

```bash
git add src/WranglingModule.jsx src/pipeline/__validation__/lineageValidation.mjs && git commit -m "feat(clean): join/append/lookup register G-step v2 with frozen parent records" -m "Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

## Task 7: `rmStep` must clear the G-step it owns

**Files:**
- Modify: `src/WranglingModule.jsx:392-422`

- [ ] **Step 1: Understand the bug**

Deleting a join step from the History sidebar removes only the local step — `rmStep` and `confirmDeleteStep` never dispatch `REMOVE_GLOBAL_STEP`. The G-step survives, so the exporter keeps emitting a join the app no longer performs, and the script silently produces a *different* dataset than Litux shows. This is the orphaned `G3` Franco saw in the Dataset Manager after deleting the join from `comunas_metadata`.

- [ ] **Step 2: Add the cleanup helper**

In `src/WranglingModule.jsx`, immediately above `rmStep`:

```js
  // A cross-dataset step owns a G-step in the global pipeline. Removing the
  // local step without removing its G-step leaves the exporter emitting a join
  // the app no longer performs -- a script that silently disagrees with the app.
  const dropGStepFor = useCallback(step => {
    if (step?.gStepId && sessionDispatch) {
      sessionDispatch({ type: "REMOVE_GLOBAL_STEP", id: step.gStepId });
    }
  }, [sessionDispatch]);
```

- [ ] **Step 3: Wire it into all three removal paths**

Replace `rmStep`:

```js
  const rmStep = useCallback(i => {
    // Deleting the last step needs no warning -- nothing downstream.
    if (i >= pipeline.length - 1) {
      dropGStepFor(pipeline[i]);
      setPipeline(p => { snapshot(p); return p.filter((_, j) => j !== i); });
      return;
    }
    // Mid-pipeline delete -- warn the user about downstream steps.
    setPendingDelete({ index: i, downstreamCount: pipeline.length - 1 - i });
  }, [snapshot, pipeline, dropGStepFor]);
```

Replace `confirmDeleteStep`:

```js
  const confirmDeleteStep = useCallback(mode => {
    if (!pendingDelete) return;
    const i = pendingDelete.index;
    // Cascade removes this step AND everything after it, so every G-step owned
    // by that tail goes too -- not just the one at index i.
    const removed = mode === "cascade" ? pipeline.slice(i) : [pipeline[i]];
    removed.forEach(dropGStepFor);
    setPipeline(p => {
      snapshot(p);
      return mode === "cascade" ? p.slice(0, i) : p.filter((_, j) => j !== i);
    });
    setPendingDelete(null);
  }, [pendingDelete, snapshot, pipeline, dropGStepFor]);
```

And in the History "clear all" handler, before clearing the pipeline, add:

```js
    pipeline.forEach(dropGStepFor);
```

- [ ] **Step 4: Verify**

```bash
npm run lint:undef && npm run build
```

Expected: green.

- [ ] **Step 5: Commit**

```bash
git add src/WranglingModule.jsx && git commit -m "fix(clean): removing a join step also removes its G-step" -m "An orphaned G-step made the exported script perform a join the app no longer does - the script silently disagreed with what the user saw." -m "Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

## Task 8: "Save as dataset" freezes its parent

**Files:**
- Modify: `src/WranglingModule.jsx:480-487`, `src/DataStudio.jsx:868-916`

- [ ] **Step 1: Understand the bug**

`doSaveSubset` calls `onSaveSubset(name, rows, headers)` — three arguments, no recipe. `handleSaveSubset` registers a `derive` G-step only when it gets one, so a dataset saved from Clean has zero provenance: it is a materialised snapshot of rows and nothing else. That is why `joined_data` exported as *"produced inside Litux"* with no way to rebuild it.

- [ ] **Step 2: Pass a frozen parent from `doSaveSubset`**

In `src/WranglingModule.jsx`:

```jsx
  function doSaveSubset() {
    const name = subsetName.trim() ||
      (filename ? filename.replace(/\.[^.]+$/, "") + "_subset.csv" : "subset.csv");
    // Freeze the parent as of NOW. The child must stay reconstructible even if
    // this pipeline is later edited or this dataset is deleted -- R value
    // semantics: `df2 <- df1 %>% ...` copies, it does not alias.
    const frozen = freezeParent(
      { id: pid, name: filename, filename, loadOpts: loadOpts ?? null },
      pipeline
    );
    if (onSaveSubset) onSaveSubset(name, rows, headers, null, { parent: frozen });
    setShowSaveSubset(false);
    setSubsetName("");
  }
```

- [ ] **Step 3: Record it as a derive G-step in `handleSaveSubset`**

In `src/DataStudio.jsx`, replace the `if (recipe && parentId) { ... }` block (lines 894-906) with:

```js
      // Two shapes of provenance, both producing a `derive` G-step:
      //   options.parent -- a frozen parent record (Clean's "Save as dataset"):
      //                     the child is the parent's raw file plus the frozen
      //                     pipeline, and nothing more.
      //   recipe         -- a single step that transforms the parent (spatial
      //                     Aggregate-to-Grid, Explore saves, API fetchers).
      // A caller may pass both: the recipe runs on top of the frozen snapshot.
      const frozenParent = options?.parent ?? null;
      if ((recipe || frozenParent) && parentId) {
        dispatch({
          type: "ADD_GLOBAL_STEP",
          step: {
            // Random suffix: two saves in the same millisecond previously
            // collided on `G_${Date.now()}`, and REMOVE_GLOBAL_STEP filters by
            // id -- deleting one would have deleted both.
            id: `G_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
            v: 2,
            opType: "derive",
            leftDatasetId:   id,          // the child
            rightDatasetId:  parentId,    // the parent
            outputDatasetId: id,
            params: {
              ...(recipe ? { recipe } : {}),
              ...(options?.joins ? { joins: options.joins } : {}),
            },
            left:  null,                  // a derive has ONE parent -- it sits in `right`
            right: frozenParent,
          },
        });
      }
```

- [ ] **Step 4: Verify**

```bash
npm run lint:undef && npm run build
```

Expected: green.

- [ ] **Step 5: Commit**

```bash
git add src/WranglingModule.jsx src/DataStudio.jsx && git commit -m "feat(data): Save as dataset records a frozen parent record" -m "Previously it saved rows with no provenance, so the dataset exported as 'produced inside Litux' with no way to rebuild it." -m "Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

## Task 9: Deleting a dataset must not orphan its children

**Files:**
- Modify: `src/components/workspace/DatasetManager.jsx:30-47, 51-90`

- [ ] **Step 1: Understand the bug**

`computeDatasetCascade` removes every G-step referencing the deleted dataset as left *or right* operand. With frozen records that is exactly backwards: a child's `derive` G-step names its parent as `rightDatasetId`, and it is the only record of how that child was built. Deleting the parent would erase it.

- [ ] **Step 2: Rewrite the cascade helpers**

Replace the MODEL comment block and `computeDatasetCascade` (lines 30-47) with:

```js
// ─── CASCADE HELPERS ──────────────────────────────────────────────────────────
// MODEL (revised 2026-08-28, G-step v2): a G-step carries FROZEN parent records
// -- filename, loadOpts and the parent's pipeline as of that moment. A child is
// therefore reconstructible from its own G-step alone, with no live parent.
//
// So deleting a dataset must NOT remove G-steps that PRODUCE another dataset
// (outputDatasetId !== the deleted id) -- those are the only record of how their
// children were built. Only interactions whose OUTPUT was the deleted dataset
// become meaningless, and they go with it.
//
// Deleting a single G-step removes just that interaction (datasetIds always []).
function computeGStepCascade(rootStep, _allSteps) {
  return { gStepIds: [rootStep.id], datasetIds: [], keptCount: 0 };
}

function computeDatasetCascade(dsId, allSteps) {
  const producedHere = s => (s.outputDatasetId ?? s.leftDatasetId) === dsId;
  const gStepIds = allSteps.filter(producedHere).map(s => s.id);
  // Interactions that merely REFERENCE the deleted dataset as a source are kept:
  // their frozen record still carries filename + loadOpts + pipeline, so the
  // child's replication script survives its parent.
  const keptCount = allSteps.filter(
    s => !producedHere(s) && (s.leftDatasetId === dsId || s.rightDatasetId === dsId)
  ).length;
  return { gStepIds, datasetIds: [], keptCount };
}
```

- [ ] **Step 3: Tell the user what is kept**

In `CascadeConfirm`, after the affected-step list, add:

```jsx
{cascade.keptCount > 0 && (
  <div style={{marginTop:8, color:C.teal, fontSize:11}}>
    {cascade.keptCount} derived dataset{cascade.keptCount > 1 ? "s" : ""} reference
    {cascade.keptCount > 1 ? "" : "s"} this one. They are kept — each already carries
    its own frozen recipe, so their replication scripts still work.
  </div>
)}
```

- [ ] **Step 4: Verify**

```bash
npm run lint:undef && npm run build
```

Expected: green.

- [ ] **Step 5: Commit**

```bash
git add src/components/workspace/DatasetManager.jsx && git commit -m "fix(workspace): deleting a dataset no longer erases its children's lineage" -m "Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

# PHASE 2 — Join forma 1 (result → new dataset)

## Task 10: Redirect a join's output to a new dataset

**Files:**
- Modify: `src/components/wrangling/MergeTab.jsx`, `src/WranglingModule.jsx`, `src/DataStudio.jsx`

- [ ] **Step 1: Add the destination control to the JOIN panel**

In `src/components/wrangling/MergeTab.jsx`, add state next to the other JOIN state:

```jsx
  // "" = augment this dataset (forma 2, the default). Otherwise the name of the
  // NEW dataset the join writes to (forma 1).
  const [joinDest, setJoinDest] = useState("");
```

Render this directly above the "Add JOIN to pipeline" button:

`Btn` from `shared.jsx` takes `ch` (the label, as a prop — it does not render children) and `v` (`"out"` | `"solid"` | `"ghost"`); there is no `active` prop. The live theme tokens are `C.bg`, `C.gold`, `C.textDim`, `C.textMuted`, `C.border2` and `T.code.fontFamily` — **`C.dim`, `C.fg`, `C.line` and a bare `mono` do not exist** and would be caught by `npm run lint:undef`.

```jsx
<div style={{marginTop:12}}>
  <Lbl>RESULT</Lbl>
  <div style={{display:"flex", gap:8, alignItems:"center", marginTop:6}}>
    <Btn ch={`this dataset (${filename})`}
         v={joinDest === "" ? "solid" : "out"}
         onClick={() => setJoinDest("")} />
    <Btn ch="new dataset"
         v={joinDest !== "" ? "solid" : "out"}
         onClick={() => setJoinDest(joinDest || "joined_data")} />
    {joinDest !== "" && (
      <input
        value={joinDest}
        onChange={e => setJoinDest(e.target.value)}
        placeholder="joined_data"
        style={{flex:1, padding:"6px 8px", fontFamily:T.code.fontFamily, fontSize:T.code.fontSize,
                background:C.bg, color:C.textDim, border:`1px solid ${C.border2}`}}
      />
    )}
  </div>
  {joinDest !== "" && (
    <div style={{marginTop:6, fontSize:11, color:C.textMuted}}>
      Creates <b>{joinDest}</b> and leaves {filename} untouched — its pipeline is not modified.
    </div>
  )}
</div>
```

- [ ] **Step 2: Route the two forms**

Replace the "Add JOIN to pipeline" button's `onClick` with:

```jsx
onClick={() => {
  const staged = joins.filter(j => j.rightId && j.leftKey && j.rightKey);
  if (!staged.length) return;
  if (joinDest === "") {
    // Forma 2 -- augment this dataset in place. Steps enter this pipeline.
    staged.forEach(j => onAdd({ ...j, type: "join" }));
  } else {
    // Forma 1 -- write to a NEW dataset. The steps are deliberately NOT added to
    // this dataset's pipeline: the parent's history stays clean, and provenance
    // lives in the child's frozen record and in the INTERACTIONS list.
    onForkJoin?.(joinDest.trim() || "joined_data", staged);
  }
  setJoins([emptyJoin()]);
}}
```

Add `onForkJoin` to the `MergeTab` signature:

```jsx
function MergeTab({ rows, headers, filename, allDatasets, onAdd, onForkJoin, joinContext = null }) {
```

- [ ] **Step 3: Implement `forkJoin` in `WranglingModule`**

```jsx
  // Forma 1: run the staged joins against the CURRENT rows and save the result
  // as a NEW dataset, leaving this pipeline untouched. Provenance lives in the
  // child's frozen record, so editing or deleting this dataset later cannot
  // break the child's replication script.
  const forkJoin = useCallback((name, staged) => {
    let cur = { rows, headers };
    try {
      for (const j of staged) {
        cur = applyStep(cur.rows, cur.headers, { ...j, type: "join" }, context);
      }
    } catch (e) {
      setPipelineError(e?.message ?? "Join failed.");
      return;
    }
    const parentFrozen = freezeParent(
      { id: pid, name: filename, filename, loadOpts: loadOpts ?? null },
      pipeline
    );
    const joinRecords = staged.map(j => {
      const rd = (allDatasets ?? []).find(d => d.id === j.rightId) ?? { id: j.rightId };
      const rp = rightPipelines?.[j.rightId]?.steps ?? rightPipelines?.[j.rightId]?.pipeline ?? [];
      return {
        how: j.how ?? "left", leftKey: j.leftKey, rightKey: j.rightKey, suffix: j.suffix ?? "_r",
        right: freezeParent(
          { id: rd.id, name: rd.name ?? rd.filename, filename: rd.filename ?? null, loadOpts: rd.loadOpts ?? null },
          rp
        ),
      };
    });
    onSaveSubset?.(name, cur.rows, cur.headers, null, { parent: parentFrozen, joins: joinRecords });
  }, [rows, headers, context, pid, filename, loadOpts, pipeline, onSaveSubset, allDatasets, rightPipelines]);
```

Pass it down: `onForkJoin={forkJoin}` on the `<MergeTab />` render.

- [ ] **Step 4: Confirm `handleSaveSubset` stores the joins**

Task 8's G-step already spreads `options?.joins` into `params`. Verify that line is present in `src/DataStudio.jsx`:

```bash
grep -n "options?.joins" src/DataStudio.jsx
```

Expected: one hit inside the `derive` G-step's `params`.

- [ ] **Step 5: Verify**

```bash
npm run lint:undef && npm run build
```

Expected: green.

- [ ] **Step 6: Commit**

```bash
git add src/components/wrangling/MergeTab.jsx src/WranglingModule.jsx && git commit -m "feat(clean): join can write its result to a new dataset" -m "Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

# PHASE 3 — Exporter

## Task 11: Fix `topoSort`

**Files:**
- Modify: `src/pipeline/exporter.js:201-241`
- Test: `src/pipeline/__validation__/lineageValidation.mjs` (append)

- [ ] **Step 1: Write the failing test**

`topoSort` is module-private. Add `export` to its declaration first, then append to `lineageValidation.mjs`:

```js
// -- topoSort ----------------------------------------------------------------
// deps[left].add(right), then `inDegree[dep]++` counted DEPENDENTS, not in-degree.
// The queue started with nodes nobody depends on -- i.e. the LEFT dataset -- so a
// join's left operand was emitted before the right one it consumes.
import { topoSort } from "../exporter.js";

assert.deepEqual(
  topoSort([{ id: "A" }, { id: "B" }], [{ leftDatasetId: "A", rightDatasetId: "B" }]),
  ["B", "A"],
  "the right operand must come first"
);

// Chain: C consumes B, B consumes A.
assert.deepEqual(
  topoSort([{ id: "A" }, { id: "B" }, { id: "C" }],
           [{ leftDatasetId: "C", rightDatasetId: "B" }, { leftDatasetId: "B", rightDatasetId: "A" }]),
  ["A", "B", "C"]
);

// A derive: the child (outputDatasetId) waits for its parent.
assert.deepEqual(
  topoSort([{ id: "child" }, { id: "parent" }],
           [{ opType: "derive", outputDatasetId: "child", leftDatasetId: "child", rightDatasetId: "parent" }]),
  ["parent", "child"]
);

// A cycle (two datasets joined into each other, which the in-place model allows)
// must not hang or drop nodes -- every id appears exactly once.
const cyc = topoSort([{ id: "A" }, { id: "B" }],
                     [{ leftDatasetId: "A", rightDatasetId: "B" },
                      { leftDatasetId: "B", rightDatasetId: "A" }]);
assert.equal(cyc.length, 2);
assert.deepEqual([...cyc].sort(), ["A", "B"]);

console.log("lineageValidation: topoSort OK");
```

- [ ] **Step 2: Run the test to verify it fails**

```bash
node src/pipeline/__validation__/lineageValidation.mjs
```

Expected: `AssertionError: the right operand must come first` — actual `["A","B"]`.

- [ ] **Step 3: Rewrite `topoSort`**

Replace lines 201-241 of `src/pipeline/exporter.js` with:

```js
export function topoSort(datasets, globalPipeline) {
  const ids = datasets.map(d => d.id);
  const idSet = new Set(ids);

  // deps[id] = the ids `id` must wait for. The CONSUMER is the G-step's output
  // dataset (which for an in-place join is the left operand).
  const deps = {};
  for (const id of ids) deps[id] = new Set();
  for (const g of globalPipeline) {
    const consumer = g.outputDatasetId ?? g.leftDatasetId;
    if (!deps[consumer]) continue;
    for (const src of [g.leftDatasetId, g.rightDatasetId]) {
      if (src && src !== consumer && idSet.has(src)) deps[consumer].add(src);
    }
  }

  // Kahn: repeatedly take every node whose dependencies are already emitted.
  const remaining = new Set(ids);
  const result = [];
  let progress = true;
  while (remaining.size && progress) {
    progress = false;
    for (const id of ids) {
      if (!remaining.has(id)) continue;
      let ready = true;
      for (const d of deps[id]) if (remaining.has(d)) { ready = false; break; }
      if (ready) { result.push(id); remaining.delete(id); progress = true; }
    }
  }
  // Cycles are possible under the in-place model (two datasets joined into each
  // other) -- append what is left, in insertion order, rather than dropping it.
  for (const id of ids) if (remaining.has(id)) result.push(id);
  return result;
}
```

- [ ] **Step 4: Run the test to verify it passes**

```bash
node src/pipeline/__validation__/lineageValidation.mjs
```

Expected: `lineageValidation: topoSort OK`

- [ ] **Step 5: Commit**

```bash
git add src/pipeline/exporter.js src/pipeline/__validation__/lineageValidation.mjs && git commit -m "fix(export): topoSort emitted a join's left operand before its right" -m "It counted dependents instead of in-degree, so the queue started with the consumer." -m "Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

## Task 12: `isInAppDataset` stops guessing from the filename

**Files:**
- Modify: `src/pipeline/exporter.js:93-100, 279, 344, 414`
- Test: `src/pipeline/__validation__/lineageValidation.mjs` (append)

- [ ] **Step 1: Write the failing test**

Add `export` to `isInAppDataset`'s declaration, then append:

```js
// -- isInAppDataset ----------------------------------------------------------
// It guessed from the filename: no extension => "produced by the Spatial section".
// "joined_data" has no extension, so the script claimed it was regenerated by a
// Spatial section that did not exist -- and then offered a read_csv on the next
// line, contradicting itself.
import { isInAppDataset } from "../exporter.js";

assert.equal(isInAppDataset({ id: "d1", name: "comunas", filename: "comunas.csv" }, []), false);

// A dataset PRODUCED by a G-step is in-app -- regardless of what it is called.
const producedBy = [{ opType: "derive", outputDatasetId: "d9", rightDatasetId: "d1" }];
assert.equal(isInAppDataset({ id: "d9", name: "joined_data", filename: null }, producedBy), true,
  "a dataset produced by a G-step is rebuilt in-script");

// A bare-named dataset that NOTHING produces must fall back to a file load --
// silently skipping it leaves the script referencing an undefined variable.
assert.equal(isInAppDataset({ id: "d5", name: "joined_data", filename: null }, []), false,
  "no G-step produces it, so it must be loaded from a file, not assumed regenerated");

console.log("lineageValidation: isInAppDataset OK");
```

- [ ] **Step 2: Run the test to verify it fails**

```bash
node src/pipeline/__validation__/lineageValidation.mjs
```

Expected: `AssertionError` on the third case — the old heuristic returns `true` for any extensionless name.

- [ ] **Step 3: Rewrite it**

Replace the function and its comment (lines 93-100) with:

```js
// A dataset is "in-app" when something in the workspace REBUILDS it: a G-step
// whose output it is. That is a fact about the graph, not about whether its name
// happens to end in ".csv" -- the old filename heuristic declared "joined_data"
// regenerated by a Spatial section that did not exist, then contradicted itself
// with a read_csv on the very next line.
export function isInAppDataset(ds, globalPipeline = []) {
  return (globalPipeline ?? []).some(g => (g.outputDatasetId ?? null) === ds.id);
}
```

Update all three call sites — R (line 279), Stata (344), Python (414) — to `isInAppDataset(ds, globalPipeline)`, and change the R/Python comment they emit to:

```js
        lines.push(`# ${df} is built from its source datasets in the Cross-dataset section below.`);
```

and the Stata one to:

```js
        lines.push(`* ${ds.name} is built from its source datasets in the Cross-dataset section below.`);
```

(The Stata branch's `continue` after that line stays — it must not attempt a `use`.)

- [ ] **Step 4: Run the tests**

```bash
node src/pipeline/__validation__/lineageValidation.mjs
```

```bash
node src/services/export/__validation__/replicationIntegrityValidation.mjs
```

Expected: both green.

- [ ] **Step 5: Commit**

```bash
git add src/pipeline/exporter.js src/pipeline/__validation__/lineageValidation.mjs && git commit -m "fix(export): isInAppDataset reads the G-step graph, not the filename" -m "Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

## Task 13: Three-case emission in `generateWorkspaceScript`

> **AMENDMENT (found executing Task 7, 2026-08-28) — the `!s.gStepId` filter must be self-healing.**
> `undo`/`redo` restore only `pipeline`, not `globalPipeline` (`WranglingModule.jsx:539`). Undoing a
> join deletion therefore restores a local step whose `gStepId` names a G-step that no longer exists.
> The per-dataset loop skips local steps with a `gStepId` (they are meant to be emitted from the
> global section), so that join would be emitted **nowhere** — silently absent from the script.
> Coupling undo to `globalPipeline` is fragile plumbing; instead the exporter must emit from the
> G-step **when one exists**, and otherwise fall back to emitting the local step inline. That kills
> the whole class — undo, pipeline import, and any future path that drops a G-step. Concretely, the
> per-dataset filter becomes:
>
> ```js
> const gIds = new Set(globalPipeline.map(g => g.id));
> // A local cross-dataset step is emitted from the global section ONLY if its
> // G-step is still there. An orphaned gStepId (undo restored the step but not
> // the G-step) falls back to emitting the step inline — never nowhere.
> const local = (ds.pipeline ?? []).filter(s => !s.gStepId || !gIds.has(s.gStepId));
> ```
>
> Task 13's test must pin it: a pipeline containing a join step whose `gStepId` is absent from
> `globalPipeline` must still produce a join in the script.


**Files:**
- Modify: `src/pipeline/exporter.js:256-460`
- Test: `src/pipeline/__validation__/lineageValidation.mjs` (append)

- [ ] **Step 1: Write the failing test**

```js
// -- three-case emission -----------------------------------------------------
import { generateWorkspaceScript } from "../exporter.js";

const mkDs = (id, name, pipeline) => ({ id, name, filename: `${name}.csv`, pipeline, loadOpts: null });
const dropCol  = { id: 1, type: "drop", cols: ["col"] };
const filtStep = { id: 2, type: "filter",
                   predicate: { type: "condition", col: "nombre", op: "neq", value: "Comuna_1" } };

const gJoin = {
  id: "G_1", v: 2, opType: "left_join",
  leftDatasetId: "c", rightDatasetId: "p", outputDatasetId: "j",
  params: { how: "left", leftKey: "id", rightKey: "id", suffix: "_r" },
  left:  freezeParent({ id: "c", name: "comunas", filename: "comunas.csv" }, [dropCol]),
  right: freezeParent({ id: "p", name: "crimen",  filename: "crimen.csv"  }, []),
};
const wsR = (comunasPipe) => {
  const out = generateWorkspaceScript({
    language: "r",
    datasets: { c: mkDs("c", "comunas", comunasPipe), p: mkDs("p", "crimen", []),
                j: mkDs("j", "joined_data", []) },
    globalPipeline: [gJoin],
  });
  return `${out.perDataset}\n${out.crossDataset}`;
};

// (a) identical -- the parent has not moved since the join
const identical = wsR([dropCol]);
assert.match(identical, /df_joined_data <- dplyr::left_join\(df_comunas, df_crimen/);
assert.doesNotMatch(identical, /_at_join/, "no expansion needed when the parent has not moved");
assert.doesNotMatch(identical, /read_csv\("joined_data\.csv"\)/, "a produced dataset is never loaded from a file");
assert.match(identical, /suffix = c\("", "_r"\)/, "the workspace join must emit the suffix too");
assert.doesNotMatch(identical, /distinct/, "no first-match compensation any more");

// (b) prefix -- the parent APPENDED a step after the join
const prefix = wsR([dropCol, filtStep]);
assert.doesNotMatch(prefix, /_at_join/, "an appended step needs no expansion, just ordering");
const iJoin = prefix.indexOf("left_join");
const iFilt = prefix.indexOf("Comuna_1");
assert.ok(iJoin > -1 && iFilt > -1 && iJoin < iFilt,
  "the join must be emitted BEFORE the step the parent added afterwards");

// (c) diverged -- a frozen step was deleted from the parent
const diverged = wsR([filtStep]);
assert.match(diverged, /\.comunas_at_join/, "a deleted frozen step forces expansion from raw");
assert.match(diverged, /select\(-col\)/, "the expansion replays the FROZEN step the parent dropped");
assert.match(diverged, /changed after/, "the expansion must say why it is there");
const expBlock = diverged.slice(diverged.indexOf(".comunas_at_join"), diverged.indexOf("df_joined_data <-"));
assert.doesNotMatch(expBlock, /Comuna_1/, "the expansion must NOT include steps added after the join");

console.log("lineageValidation: emission OK");
```

- [ ] **Step 2: Run the test to verify it fails**

```bash
node src/pipeline/__validation__/lineageValidation.mjs
```

Expected: `TypeError: Cannot read properties of undefined (reading 'perDataset')` — `generateWorkspaceScript` still returns a string.

- [ ] **Step 3: Add the operand emitter to `exporter.js`**

Add after the existing imports:

```js
import { emitMode } from "./lineage.js";
```

and this helper below `isInAppDataset`:

```js
// Emit one operand of a cross-dataset G-step, plus any preamble lines needed to
// build it. Three cases (see lineage.js emitMode):
//   identical / prefix / legacy -> the live df variable
//   diverged                    -> a private `.name_at_join` rebuilt from the raw
//                                  file with the FROZEN pipeline only
//
// `toStep` and `loadLine` are the per-language translator and load-line builder,
// so this one function serves R, Stata and Python.
function emitOperand(frozen, liveDs, lang, allDatasets, toStep, loadLine) {
  const mode = emitMode(frozen, liveDs?.pipeline ?? []);
  const name = frozen?.name ?? liveDs?.name ?? "right";
  if (mode !== "diverged") return { expr: toDfVar(name), pre: [], mode };

  const tmp = `.${String(name).replace(/[^a-zA-Z0-9_]/g, "_")}_at_join`;
  const cm  = lang === "stata" ? "*" : "#";
  const file = frozen.filename ?? `${name}.csv`;
  const pre = [
    `${cm} NOTE: ${name} changed after this dataset was built — rebuilding its state as of then.`,
    loadLine(file, frozen.loadOpts ?? null).replace(/^df\b/, tmp),
    ...(frozen.snapshot ?? []).map(s => toStep(s, tmp, allDatasets)),
  ];
  return { expr: tmp, pre, mode };
}
```

- [ ] **Step 4: Rewrite the R branch's dataset loop and cross-dataset section**

In `generateWorkspaceScript`, before the R dataset loop, declare:

```js
  // G-steps whose frozen left snapshot is a PREFIX of the parent's pipeline were
  // taken partway through. They are emitted inline, at that point in the parent's
  // chain -- otherwise the child would appear to consume state that did not exist
  // yet. Collected here so the cross-dataset section can skip them.
  const emittedInline = new Set();
```

Replace the R per-dataset step loop with:

```js
      const local = (ds.pipeline ?? []).filter(s => !s.gStepId);
      const interleaved = globalPipeline
        .filter(g => g.left?.datasetId === ds.id && emitMode(g.left, ds.pipeline ?? []) === "prefix")
        .map(g => ({ at: g.left.snapshot.length, g }));
      for (let i = 0; i <= local.length; i++) {
        for (const { at, g } of interleaved) {
          if (at !== i || emittedInline.has(g.id)) continue;
          emittedInline.add(g.id);
          lines.push(...emitCrossStepR(g, datasets, allDatasets));
        }
        if (i < local.length) lines.push(toR(local[i], df, allDatasets));
      }
```

Add the shared per-G-step emitter above `generateWorkspaceScript`:

```js
// One cross-dataset G-step, in R. Returns the lines to emit. Used both inline
// (prefix mode, mid-chain) and in the trailing Cross-dataset section.
function emitCrossStepR(g, datasets, allDatasets) {
  const out = [];
  const outId = g.outputDatasetId ?? g.leftDatasetId;
  const outDs = datasets[outId];
  const leftLive  = datasets[g.leftDatasetId];
  const rightLive = datasets[g.rightDatasetId];
  if (!outDs && !leftLive) return out;
  const outDf = toDfVar(outDs?.name ?? leftLive?.name ?? "result");

  const L  = emitOperand(g.left,  leftLive,  "r", allDatasets, toR, buildRLoadLine);
  const R2 = emitOperand(g.right, rightLive, "r", allDatasets, toR, buildRLoadLine);
  out.push(...L.pre, ...R2.pre);

  const lk  = g.params?.leftKey  ? `"${g.params.leftKey}"`  : "<left_key>";
  const rk  = g.params?.rightKey ? `"${g.params.rightKey}"` : "<right_key>";
  const sfx = `suffix = c("", "${g.params?.suffix ?? "_r"}")`;

  if (/_join$/.test(g.opType ?? "")) {
    const how = g.opType.replace(/_join$/, "");
    const fn  = `${how}_join`;
    out.push(`${outDf} <- dplyr::${fn}(${L.expr}, ${R2.expr}, by = c(${lk} = ${rk}), ${sfx})`);
  } else if (g.opType === "lookup") {
    out.push(`${outDf} <- dplyr::left_join(${L.expr}, ${R2.expr}, by = c(${lk} = ${rk}), ${sfx}, relationship = "many-to-one")`);
  } else if (g.opType === "append") {
    out.push(`${outDf} <- dplyr::bind_rows(${L.expr}, ${R2.expr})`);
  } else if (g.opType === "derive") {
    // A derive has ONE parent, frozen in `right`. Optional staged joins ran on
    // top of it (Clean's "Save as dataset" after a forma-1 join).
    out.push(`# Derived dataset: ${outDs?.name ?? outId} from ${g.right?.name ?? "parent"}`);
    out.push(`${outDf} <- ${R2.expr}`);
    for (const j of (g.params?.joins ?? [])) {
      const jr = emitOperand(j.right, datasets[j.right?.datasetId], "r", allDatasets, toR, buildRLoadLine);
      out.push(...jr.pre);
      const fn = `${j.how || "left"}_join`;
      out.push(`${outDf} <- dplyr::${fn}(${outDf}, ${jr.expr}, by = c("${j.leftKey}" = "${j.rightKey}"), suffix = c("", "${j.suffix ?? "_r"}"))`);
    }
    if (g.params?.recipe) out.push(toR(g.params.recipe, outDf, allDatasets));
    for (const step of (outDs?.pipeline ?? []).filter(s => !s.gStepId)) {
      out.push(toR(step, outDf, allDatasets));
    }
  } else {
    out.push(`# G-step: ${g.opType} — ${outDs?.name ?? outId}`);
  }
  out.push(``);
  return out;
}
```

Replace the R `if (globalPipeline.length) { ... }` block with:

```js
    const crossLines = [];
    const trailing = globalPipeline.filter(g => !emittedInline.has(g.id));
    if (trailing.length) {
      crossLines.push(`# ${"─".repeat(60)}`);
      crossLines.push(`# Cross-dataset interactions`);
      crossLines.push(`# ${"─".repeat(60)}`);
      for (const g of trailing) crossLines.push(...emitCrossStepR(g, datasets, allDatasets));
    }
    return { perDataset: lines.join("\n"), crossDataset: crossLines.join("\n") };
```

- [ ] **Step 5: Mirror steps 3-4 in the Stata and Python branches**

Write `emitCrossStepStata` and `emitCrossStepPython` with the same structure, returning `{ perDataset, crossDataset }` from each branch. Substitutions:

| op | Stata | Python |
|---|---|---|
| join | `use "<left.dta>", clear` · `merge 1:m <key> using "<right.dta>"` · `drop if _merge == 2` (or `keep if _merge == 3` for inner) · `drop _merge` · `save "<out.dta>", replace` | `<out> = pd.merge(<L>, <R>, left_on=…, right_on=…, how="<how>", suffixes=("", "_r"))` |
| lookup | `merge m:1 <key> using "<right.dta>"` | same `pd.merge` with `how="left", validate="m:1"` |
| append | `use "<left.dta>", clear` · `append using "<right.dta>"` · `save` | `<out> = pd.concat([<L>, <R>], ignore_index=True)` |
| derive | `use "<right.dta>", clear` · staged joins · recipe · child's local steps · `save "<out.dta>", replace` | `<out> = <R>.copy()` then the same sequence |
| diverged operand | `use "<frozen.filename>", clear` · frozen steps · `save "<tmp>.dta", replace`, expr = `"<tmp>.dta"` | `<tmp> = <loadLine>` · frozen steps, expr = `<tmp>` |

Pass `toStata`/`buildStataLoadLine` and `toPython`/`buildPyLoadLine` into `emitOperand`. For Stata the diverged operand's `expr` is a **file path**, not a variable, because every Stata op is `use`-based — build it as `_${name}_at_join.dta` and have the join emit `using "${expr}"`.

- [ ] **Step 6: Run the tests**

```bash
node src/pipeline/__validation__/lineageValidation.mjs
```

```bash
node src/services/export/__validation__/replicationIntegrityValidation.mjs
```

```bash
node src/pipeline/__validation__/pipelineReliabilityValidation.mjs
```

Expected: all green, `emission OK` printed.

- [ ] **Step 7: Commit**

```bash
git add src/pipeline/exporter.js src/pipeline/__validation__/lineageValidation.mjs && git commit -m "feat(export): three-case emission from frozen lineage records" -m "identical -> one-liner; prefix -> join interleaved at its point in the parent's chain; diverged -> parent rebuilt from raw under .name_at_join with a note." -m "Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

## Task 14: The AI can no longer drop the cross-dataset section

**Files:**
- Modify: `src/ReportingModule.jsx:1040-1110`, `src/components/workspace/DatasetManager.jsx:221`

- [ ] **Step 1: Understand the bug**

`generateWorkspaceScript` produced a Cross-dataset section with three joins; the AI-generated script Franco exported has none. Visual and spatial sections already solved this — `ReportingModule.jsx:1040`'s own comment says they are *"appended to the FINAL script AFTER the AI returns (never sent through it) so the model can never drop them."* Cross-dataset interactions never got that treatment.

- [ ] **Step 2: Split the skeleton in `ReportingModule`**

Replace `ReportingModule.jsx:1104` (`cleanSc = generateWorkspaceScript(...)`) with:

```js
        const ws = generateWorkspaceScript({ language: lang, datasets: built, globalPipeline });
        cleanSc = ws.perDataset;
        // Cross-dataset joins are deterministic replication code and are appended
        // AFTER the AI returns, exactly like the visual/spatial sections below.
        // Sent THROUGH the model they get dropped -- that is how a session with
        // three joins exported a script with none, then estimated on a dataset
        // the script never built.
        if (ws.crossDataset.trim()) {
          visualSections = `\n\n${comment} ── Cross-dataset interactions ───────────────────────\n${ws.crossDataset}` + visualSections;
        }
        modelSc = modelsToReplicate().map(renderModel).filter(Boolean).join("\n\n");
```

- [ ] **Step 3: Update `DatasetManager`'s call site**

`src/components/workspace/DatasetManager.jsx:221`:

```js
      const ws = generateWorkspaceScript({ language, datasets: built, globalPipeline });
      const script = `${ws.perDataset}\n${ws.crossDataset}`;
```

- [ ] **Step 4: Check for other callers**

```bash
grep -rn "generateWorkspaceScript" src/
```

Expected: exactly the two call sites above plus the definition and its doc comment. Update any other hit to the `{ perDataset, crossDataset }` shape.

- [ ] **Step 5: Verify**

```bash
node src/services/export/__validation__/replicationIntegrityValidation.mjs
```

```bash
npm run lint:undef && npm run build
```

Expected: all green. If `replicationIntegrityValidation.mjs` calls `generateWorkspaceScript` and asserts on a string, update it to join the two fields.

- [ ] **Step 6: Commit**

```bash
git add src/ReportingModule.jsx src/components/workspace/DatasetManager.jsx && git commit -m "fix(report): cross-dataset joins are appended after the AI, not through it" -m "Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

## Task 15: Docs and help copy

**Files:**
- Modify: `CLAUDE.md`, `ClaudePlan.md`, `src/WranglingModule.jsx` (Clean HintBox), `src/services/AI/appCapabilityMap.js`

- [ ] **Step 1: Confirm `lookup` reaches the NL catalogue**

Pipeline steps are auto-derived from `STEP_REGISTRY`, so no edit should be needed — but `serializeAllowedSteps` carries an exclusion whitelist. Check it:

```bash
grep -n "serializeAllowedSteps" -A 20 src/services/AI/appCapabilityMap.js
```

Expected: `lookup` is not excluded (only the `sp_*` spatial category is).

- [ ] **Step 2: Update the Clean HintBox**

Per CLAUDE.md's working conventions, a module's help prose moves in the same change as its UI. In `src/WranglingModule.jsx`'s Clean `HintBox`, extend the Merge bullet:

> **Join** matches dplyr — if a key has several matches on the right, you get several rows, and the preview tells you how many. **Attach lookup columns** is the m:1 alternative: it never changes the row count and refuses to run if the right key repeats. A join can write its result to a new dataset instead of changing the current one.

No counts — name the things.

- [ ] **Step 3: Update `CLAUDE.md`**

Change the step-type header from `54 total` to `55 total` and add `lookup` to the Merge line:

```markdown
Merge (7): `join` (`left, inner, right, full, semi, anti`), `lookup` (m:1, validated), `append, bind_cols, union, intersect, setdiff`
```

Add to "Key bugs fixed (do not reintroduce)":

```markdown
- **`join` collapsed many-to-many in JS but expanded in SQL (fixed 2026-08-28)**: `runner.js`'s join built a first-match `Map` on the right key, so left/inner/full/right all emitted exactly one output row per left row — while `duckdbRunner.js`'s `join` case emits a real SQL `LEFT JOIN` and expands. The same step returned a different row count depending only on whether the dataset was DuckDB-backed (>10MB). On a 20-comuna × 10-year panel joined onto 20 metadata rows, Litux returned 20 rows — one silently-chosen year per comuna — where dplyr returns 200, and a regression was reported at N=20. All three replication translators carried a compensation for it (`distinct(.keep_all)` / `drop_duplicates` / `bysort … keep if _n==1`), so the scripts faithfully reproduced the wrong answer. **"First match" was never a defined semantic** — it means "first in current file order", so re-sorting the source CSV changes the result with nothing in the UI moving. Fixed by grouping the right side into a multimap; the compensations were removed; a `lookup` step (Stata `merge m:1`, dplyr `relationship="many-to-one"`, pandas `validate="m:1"`) now covers the attach-metadata case explicitly, **throwing** when the right key repeats rather than picking one. **The MergeTab preview said `"20 of 20 left rows matched — 100%"`, which was true and told the user nothing about the output row count** — it now reports cardinality and the resulting rows. It was also computing against the **raw** right dataset while the runner joined against the **cleaned** one, and the panel's help text asserted the raw behaviour — the copy documented the preview's bug rather than the app's behaviour.
- **Derived datasets had no lineage, so editing a parent silently broke the child's script (fixed 2026-08-28)**: "Save as dataset" called `onSaveSubset(name, rows, headers)` with no recipe, so `handleSaveSubset` registered no `derive` G-step — the dataset was a materialised snapshot of rows with no record of its origin. `rmStep` never dispatched `REMOVE_GLOBAL_STEP`, so deleting a join step left its G-step orphaned and the exporter kept emitting a join the app no longer performed. And `isInAppDataset` guessed from the filename (no extension ⇒ spatial output), so `joined_data` exported as *"regenerated by the Spatial operations section"* — which did not exist — immediately followed by a contradictory `read_csv`. Fixed with G-step v2: every derived dataset freezes each parent's `{name, filename, loadOpts, pipeline-as-of-then}` (`pipeline/lineage.js`), making it reconstructible from its own record with no live parent — R value semantics, where `df2 <- df1 %>% …` copies rather than aliases. The exporter picks one of three emissions via `emitMode`: identical → one-liner, prefix → join interleaved at its point in the parent's chain, diverged → parent rebuilt from raw under `.name_at_join` with a note saying why. **Because the frozen record is self-sufficient, correctness stops depending on the graph** — `topoSort` (which was inverted: it counted dependents rather than in-degree, so a join's left operand was emitted before the right one it consumes) becomes a readability optimisation rather than a requirement. Deleting a dataset no longer cascades away the G-steps that produce its children. Cross-dataset interactions are now appended AFTER the Report AI returns, like the visual/spatial sections — sent through the model they were being dropped wholesale.
```

- [ ] **Step 4: Flip the Spec & Plan Index row to DONE**

The row was added to `ClaudePlan.md`'s `## Spec & Plan Index` when this plan was written (CLAUDE.md's rule: index in the same change that creates the plan). Confirm it is there and change its status from `OPEN` to `DONE`:

```bash
grep -n "join-semantics-and-lineage-snapshots" ClaudePlan.md
```

Expected: one row. Edit `OPEN` → `DONE` and append to its Notes: `— implemented <date>; harnesses green; browser validation pending Franco.`

- [ ] **Step 5: Full verification**

```bash
node src/pipeline/__validation__/joinCardinalityValidation.mjs && node src/pipeline/__validation__/lineageValidation.mjs && node src/pipeline/__validation__/pipelineReliabilityValidation.mjs && node src/pipeline/__validation__/datasetContextValidation.mjs && node src/services/export/__validation__/replicationIntegrityValidation.mjs
```

```bash
npm run lint:undef && npm run build
```

Expected: every harness exits 0, build green.

- [ ] **Step 6: Commit**

```bash
git add CLAUDE.md ClaudePlan.md src/WranglingModule.jsx && git commit -m "docs: record join-semantics and lineage-snapshot work" -m "Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

## Franco's browser validation checklist

Nothing here was verified in a browser — per project convention (`feedback_no_browser_validation`), that is Franco's pass. Datasets: `comunas_metadata.csv` (20 rows) and `crimen_panel_data.csv` (200 rows = 20 comunas × 10 years).

1. **1:m join.** Join comunas ← crimen on `id`. The preview must warn `1:m — right key 'id' has up to 10 rows per key · Result: 200 rows`, and the result must be 200 rows, matching `left_join(comunas, crimen, by="id")` in R.
2. **m:1 join unchanged.** Join crimen ← comunas on `id` → 200 rows, as before.
3. **Lookup, right direction.** On `crimen_panel_data`, Attach lookup columns from `comunas_metadata` → 200 rows with the metadata attached.
4. **Lookup, wrong direction.** On `comunas_metadata`, attach from `crimen_panel_data` → gold error banner naming the duplicate key, data unchanged, no spinner hang.
5. **Forma 1.** Join with RESULT → new dataset `joined_data`. `comunas_metadata`'s pipeline sidebar must be unchanged; `joined_data` appears in the Dataset Manager with a `derive` row under INTERACTIONS.
6. **Edit the parent afterwards.** Add a filter to `comunas_metadata`. `joined_data` must not change. Export the R workspace script: the join appears *before* that filter, with no `_at_join` block.
7. **Delete a frozen step.** Remove the parent's `drop col` step. Export R: a `.comunas_metadata_at_join` block appears, replays `select(-col)`, carries the "changed after" note, and does **not** include the filter from step 6.
8. **Delete the parent dataset.** `joined_data` survives; the confirm dialog says the derived dataset is kept. Export R still rebuilds it from `comunas_metadata.csv`.
9. **Report AI script.** Generate the unified R script. The Cross-dataset section must be present and must build `df_joined_data` before the estimation that uses it.
10. **DuckDB parity.** Repeat step 1 with a >10MB CSV so the SQL path runs. Row counts must match the JS path.
11. **Reload.** Refresh the project: `joined_data`, its `derive` G-step and the frozen record must all survive.
