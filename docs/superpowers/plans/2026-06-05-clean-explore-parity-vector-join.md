# Clean/Explore Parity + Vector Join — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.
>
> **This plan is authored for execution by OpenAI Codex (solo).** Source spec: `docs/superpowers/specs/2026-06-05-clean-explore-parity-vector-join-design.md`.

**Goal:** Add the missing dplyr/pandas wrangling operations (join types, set/bind ops, distinct, group-transform) and a new seeded Vector Join primitive to EconSolver's non-destructive pipeline.

**Architecture:** Every operation is a pipeline step in `src/pipeline/runner.js` (replays on `rawData`, never mutates). New step types are mirrored in `src/pipeline/registry.js` (registry/runner sync is a hard invariant). The Vector Join's assignment logic lives in a pure, React-free engine `src/core/generate/vectorAssign.js` with a seeded RNG so pipeline replays are deterministic. UI surfaces in `MergeTab`, `CleanTab`, `ReshapeTab`, `FeatureTab`. Replication scripts (R/Python/Stata) translate every new step.

**Tech Stack:** React + Vite + plain JS. Inline styles via the `C` color object. No external UI libs. **No JS unit-test runner exists** — the validation gates are: (1) a Node validation harness for the pure engine, (2) `npm run build` clean, (3) Franco browser-validation. Pure logic gets a real Node assertion harness; UI gets build + browser.

**Invariants (do not violate):**
- Non-destructive: steps replay on `rawData`.
- Registry/runner must stay in sync — add the registry entry in the same task as the runner case.
- No `Math.random()` in the pipeline — Vector Join uses seeded `mulberry32`. Replay = identical output.
- Zero React in `src/core/`.
- Surgical edits, inline styles, `mono` font, `C` colors — match existing component patterns.
- **Expression evaluation reuses the existing runner pattern.** The conditional Vector mode compiles user predicates exactly the way `mutate`, `if_else`, and `case_when` already do in `runner.js` (a dynamic compiled predicate over whitelisted column names). This is deliberately consistent with the codebase — not a new mechanism. (A lint/security hook may warn about dynamic evaluation; it matches existing approved code.)

**Commit after every task.** Branch: work on `Main-` (project convention: push `Main-` only).

---

## Task 1: Vector-assign pure engine + Node validation harness

**Files:**
- Create: `src/core/generate/vectorAssign.js`
- Create: `src/core/generate/__validation__/vectorAssign.test.mjs`

- [ ] **Step 1: Write the engine**

Create `src/core/generate/vectorAssign.js`:

```js
// ─── ECON STUDIO · core/generate/vectorAssign.js ─────────────────────────────
// Pure, React-free assignment of a value vector across rows.
// Deterministic: all randomness flows through a seeded mulberry32 RNG so the
// non-destructive pipeline reproduces identical output on every replay.

// Seeded PRNG — returns a function producing floats in [0, 1).
export function mulberry32(seed) {
  let a = (seed >>> 0) || 1;
  return function () {
    a |= 0; a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// Normalize weights to a probability vector summing to 1.
// null/empty or any non-positive sum -> uniform.
function normalizeWeights(weights, n) {
  if (!Array.isArray(weights) || weights.length !== n) {
    return Array(n).fill(1 / n);
  }
  const clean = weights.map(w => (typeof w === "number" && w > 0 ? w : 0));
  const sum = clean.reduce((a, b) => a + b, 0);
  if (sum <= 0) return Array(n).fill(1 / n);
  return clean.map(w => w / sum);
}

// Weighted pick from `values` given cumulative probs and a uniform draw u.
function weightedPick(values, cum, u) {
  for (let i = 0; i < cum.length; i++) { if (u <= cum[i]) return values[i]; }
  return values[values.length - 1];
}

// Largest-remainder integer quota so counts sum exactly to total.
export function computeQuota(total, probs) {
  const raw = probs.map(p => p * total);
  const floors = raw.map(Math.floor);
  const assigned = floors.reduce((a, b) => a + b, 0);
  const remainder = total - assigned;
  const fracOrder = raw
    .map((v, i) => ({ i, frac: v - Math.floor(v) }))
    .sort((a, b) => b.frac - a.frac);
  const counts = floors.slice();
  for (let k = 0; k < remainder; k++) counts[fracOrder[k % fracOrder.length].i]++;
  return counts;
}

// Seeded Fisher-Yates shuffle (in place), returns the array.
function shuffle(arr, rng) {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}

// Main entry. Returns an array of assigned values, one per row.
//
// opts = {
//   values: string[]            // value pool (required, non-empty)
//   mode: "random"|"conditional"|"recycle"|"quota"
//   weights?: number[]|null     // random/quota
//   seed?: number               // random/quota (default 42)
//   evalRule?: (row, idx) => value | undefined   // conditional: caller supplies
//                                                // evaluator; undefined = no match
//   elseValue?: any             // conditional fallback
// }
export function assignVector(rows, opts) {
  const { values, mode } = opts;
  const n = rows.length;
  if (!Array.isArray(values) || values.length === 0) return Array(n).fill(null);
  const seed = Number.isFinite(opts.seed) ? opts.seed : 42;

  if (mode === "recycle") {
    return rows.map((_, i) => values[i % values.length]);
  }

  if (mode === "conditional") {
    const evalRule = opts.evalRule || (() => undefined);
    const elseValue = opts.elseValue ?? null;
    return rows.map((r, i) => {
      const v = evalRule(r, i);
      return v === undefined ? elseValue : v;
    });
  }

  const probs = normalizeWeights(opts.weights, values.length);

  if (mode === "quota") {
    const counts = computeQuota(n, probs);
    const pool = [];
    counts.forEach((c, i) => { for (let k = 0; k < c; k++) pool.push(values[i]); });
    shuffle(pool, mulberry32(seed));
    return pool;
  }

  // default: random weighted draw per row
  const rng = mulberry32(seed);
  const cum = [];
  probs.reduce((acc, p, i) => (cum[i] = acc + p), 0);
  return rows.map(() => weightedPick(values, cum, rng()));
}
```

- [ ] **Step 2: Write the Node validation harness**

Create `src/core/generate/__validation__/vectorAssign.test.mjs`:

```js
import { assignVector, mulberry32, computeQuota } from "../vectorAssign.js";

let pass = 0, fail = 0;
function check(name, cond) {
  if (cond) { pass++; console.log("  [pass]", name); }
  else { fail++; console.log("  [FAIL]", name); }
}

const rows = Array.from({ length: 1000 }, (_, i) => ({ i, income: i }));
const values = ["a", "b", "c", "d"];

// 1. Determinism: same seed -> identical output
const r1 = assignVector(rows, { values, mode: "random", seed: 7 });
const r2 = assignVector(rows, { values, mode: "random", seed: 7 });
check("random is deterministic for a fixed seed", r1.every((v, i) => v === r2[i]));

// 2. Different seed -> different output (extremely likely)
const r3 = assignVector(rows, { values, mode: "random", seed: 8 });
check("random changes with the seed", r1.some((v, i) => v !== r3[i]));

// 3. Recycle wraps the vector by position
const rec = assignVector(rows, { values, mode: "recycle" });
check("recycle row 0 = values[0]", rec[0] === "a");
check("recycle row 5 = values[1]", rec[5] === "b"); // 5 % 4 = 1
check("recycle wraps", rec[4] === "a");             // 4 % 4 = 0

// 4. Quota exact counts
const counts = computeQuota(1000, [0.25, 0.25, 0.25, 0.25]);
check("quota sums to n", counts.reduce((a, b) => a + b, 0) === 1000);
check("quota even split = 250 each", counts.every(c => c === 250));
const q = assignVector(rows, { values, mode: "quota", weights: [0.25, 0.25, 0.25, 0.25], seed: 1 });
const tally = {}; q.forEach(v => (tally[v] = (tally[v] || 0) + 1));
check("quota assignment honors exact counts", values.every(v => tally[v] === 250));

// 5. Quota with uneven weights still sums to n
const c2 = computeQuota(1000, [0.6, 0.4]);
check("uneven quota sums to n", c2[0] + c2[1] === 1000 && c2[0] === 600);

// 6. Conditional uses evalRule + elseValue
const cond = assignVector(rows, {
  values, mode: "conditional",
  evalRule: (r) => (r.income > 500 ? "hi" : undefined),
  elseValue: "lo",
});
check("conditional matches rule", cond[600] === "hi");
check("conditional falls through to else", cond[100] === "lo");

// 7. Empty pool -> all null
check("empty pool -> null", assignVector(rows, { values: [], mode: "random" }).every(v => v === null));

console.log(`\nvectorAssign: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
```

- [ ] **Step 3: Run the harness to verify it passes**

Run: `node src/core/generate/__validation__/vectorAssign.test.mjs`
Expected: `vectorAssign: 13 passed, 0 failed` (exit 0).

- [ ] **Step 4: Commit**

```bash
git add src/core/generate/vectorAssign.js src/core/generate/__validation__/vectorAssign.test.mjs
git commit -m "feat(generate): seeded vectorAssign engine + node validation harness"
```

---

## Task 2: Join types (right / full / anti / semi) in runner

**Files:**
- Modify: `src/pipeline/runner.js` — replace the `case "join":` block (currently ~lines 608-632).

- [ ] **Step 1: Replace the join case**

Replace the entire `case "join": { ... }` block with:

```js
    case "join": {
      const right = context?.datasets?.[s.rightId];
      if (!right) break;
      const rRows = right.rows, rHeaders = right.headers;
      const how = s.how || "left";
      const newCols = rHeaders.filter(h => h !== s.rightKey);
      const destOf = h => (H.includes(h) ? `${h}${s.suffix || "_r"}` : h);

      // Build right lookup (first match wins, matching prior behavior).
      const rightMap = new Map();
      rRows.forEach(r => { const k = String(r[s.rightKey] ?? ""); if (!rightMap.has(k)) rightMap.set(k, r); });

      // -- Filtering joins: add NO columns, just keep/drop left rows --
      if (how === "semi" || how === "anti") {
        R = rows.filter(r => {
          const k = String(r[s.leftKey] ?? "");
          const has = rightMap.has(k);
          return how === "semi" ? has : !has;
        });
        break; // headers unchanged
      }

      // -- right join: iterate right rows, attach matching left --
      if (how === "right") {
        const leftMap = new Map();
        rows.forEach(r => { const k = String(r[s.leftKey] ?? ""); if (!leftMap.has(k)) leftMap.set(k, r); });
        R = rRows.map(rr => {
          const k = String(rr[s.rightKey] ?? "");
          const lm = leftMap.get(k);
          const merged = {};
          H.forEach(h => { merged[h] = lm ? (lm[h] ?? null) : null; });
          newCols.forEach(h => { merged[destOf(h)] = rr[h] ?? null; });
          return merged;
        });
        newCols.forEach(h => { const d = destOf(h); if (!H.includes(d)) H = [...H, d]; });
        break;
      }

      // -- left / inner / full --
      const matchedRightKeys = new Set();
      const outRows = [];
      rows.forEach(r => {
        const k = String(r[s.leftKey] ?? "");
        const match = rightMap.get(k);
        if (match) {
          matchedRightKeys.add(k);
          const merged = { ...r };
          newCols.forEach(h => { merged[destOf(h)] = match[h] ?? null; });
          outRows.push(merged);
        } else if (how === "left" || how === "full") {
          const merged = { ...r };
          newCols.forEach(h => { merged[destOf(h)] = null; });
          outRows.push(merged);
        }
        // inner: drop unmatched left rows
      });
      // full: append right rows that never matched a left key
      if (how === "full") {
        rRows.forEach(rr => {
          const k = String(rr[s.rightKey] ?? "");
          if (matchedRightKeys.has(k)) return;
          const merged = {};
          H.forEach(h => { merged[h] = null; });
          newCols.forEach(h => { merged[destOf(h)] = rr[h] ?? null; });
          outRows.push(merged);
        });
      }
      R = outRows;
      newCols.forEach(h => { const d = destOf(h); if (!H.includes(d)) H = [...H, d]; });
      break;
    }
```

- [ ] **Step 2: Build to verify no syntax errors**

Run: `npm run build`
Expected: build succeeds (no errors mentioning runner.js).

- [ ] **Step 3: Commit**

```bash
git add src/pipeline/runner.js
git commit -m "feat(pipeline): right/full/anti/semi join types in runner"
```

---

## Task 3: Set & bind operations in runner

**Files:**
- Modify: `src/pipeline/runner.js` — add four new cases after the `append` case (~line 645).

- [ ] **Step 1: Add the four cases**

Insert after the `case "append": { ... }` block:

```js
    case "bind_cols": {
      const right = context?.datasets?.[s.rightId];
      if (!right) break;
      const rRows = right.rows, rHeaders = right.headers;
      const m = Math.min(rows.length, rRows.length); // truncate to shorter
      const destOf = h => (H.includes(h) ? `${h}${s.suffix || "_r"}` : h);
      R = [];
      for (let i = 0; i < m; i++) {
        const merged = { ...rows[i] };
        rHeaders.forEach(h => { merged[destOf(h)] = rRows[i][h] ?? null; });
        R.push(merged);
      }
      rHeaders.forEach(h => { const d = destOf(h); if (!H.includes(d)) H = [...H, d]; });
      break;
    }

    case "union": {
      // vertical stack + drop full-row duplicates over the union column set
      const right = context?.datasets?.[s.rightId];
      if (!right) break;
      const rRows = right.rows, rHeaders = right.headers;
      const onlyRight = rHeaders.filter(h => !H.includes(h));
      const allCols = [...H, ...onlyRight];
      const stacked = [
        ...rows.map(r => { const c = {}; allCols.forEach(h => { c[h] = r[h] ?? null; }); return c; }),
        ...rRows.map(r => { const c = {}; allCols.forEach(h => { c[h] = r[h] ?? null; }); return c; }),
      ];
      const seen = new Set();
      R = stacked.filter(r => {
        const key = JSON.stringify(allCols.map(h => r[h]));
        if (seen.has(key)) return false;
        seen.add(key); return true;
      });
      onlyRight.forEach(h => { if (!H.includes(h)) H = [...H, h]; });
      break;
    }

    case "intersect":
    case "setdiff": {
      // keep current rows that DO (intersect) / do NOT (setdiff) appear in the
      // other dataset, matched on shared columns
      const right = context?.datasets?.[s.rightId];
      if (!right) break;
      const shared = H.filter(h => right.headers.includes(h));
      const rightKeys = new Set(
        right.rows.map(r => JSON.stringify(shared.map(h => r[h] ?? null)))
      );
      R = rows.filter(r => {
        const key = JSON.stringify(shared.map(h => r[h] ?? null));
        const inRight = rightKeys.has(key);
        return s.type === "intersect" ? inRight : !inRight;
      });
      break; // headers unchanged
    }
```

- [ ] **Step 2: Build to verify**

Run: `npm run build`
Expected: success.

- [ ] **Step 3: Commit**

```bash
git add src/pipeline/runner.js
git commit -m "feat(pipeline): bind_cols/union/intersect/setdiff set ops in runner"
```

---

## Task 4: `distinct` step in runner

**Files:**
- Modify: `src/pipeline/runner.js` — add a `distinct` case in the CLEANING area (e.g. after the `quickclean`/`recode` group; placement is cosmetic).

- [ ] **Step 1: Add the case**

```js
    case "distinct": {
      // s.subset: string[] (cols to dedup on; empty = all)  s.keep: "first"|"last"
      const cols = (Array.isArray(s.subset) && s.subset.length) ? s.subset : H;
      const keep = s.keep === "last" ? "last" : "first";
      const keyOf = r => JSON.stringify(cols.map(h => r[h] ?? null));
      if (keep === "first") {
        const seen = new Set();
        R = rows.filter(r => { const k = keyOf(r); if (seen.has(k)) return false; seen.add(k); return true; });
      } else {
        const lastIdx = new Map();
        rows.forEach((r, i) => lastIdx.set(keyOf(r), i));
        const keepIdx = new Set(lastIdx.values());
        R = rows.filter((_, i) => keepIdx.has(i));
      }
      break;
    }
```

- [ ] **Step 2: Build to verify**

Run: `npm run build`
Expected: success.

- [ ] **Step 3: Commit**

```bash
git add src/pipeline/runner.js
git commit -m "feat(pipeline): distinct (drop duplicate rows) step"
```

---

## Task 5: `group_transform` step in runner

**Files:**
- Modify: `src/pipeline/runner.js` — add a `group_transform` case in the RESHAPE area (near `group_summarize`).

- [ ] **Step 1: Add the case**

```js
    case "group_transform": {
      // s.by: string[]   s.col: string   s.fn: mean|sum|sd|min|max|count|median|rank
      // s.nn: output column name (broadcast group stat back to every row)
      const by = Array.isArray(s.by) ? s.by : [];
      const col = s.col, fn = s.fn || "mean";
      const nn = s.nn || `${fn}_${col}_by_${by.join("_")}`;
      const keyOf = r => JSON.stringify(by.map(h => r[h] ?? null));

      // bucket row indices by group
      const groups = new Map();
      rows.forEach((r, i) => { const k = keyOf(r); if (!groups.has(k)) groups.set(k, []); groups.get(k).push(i); });

      const num = i => { const v = rows[i][col]; return typeof v === "number" && isFinite(v) ? v : null; };
      const agg = idxs => {
        const xs = idxs.map(num).filter(v => v !== null);
        if (fn === "count") return idxs.length;
        if (!xs.length) return null;
        const sum = xs.reduce((a, b) => a + b, 0);
        if (fn === "sum")  return sum;
        if (fn === "mean") return sum / xs.length;
        if (fn === "min")  return Math.min(...xs);
        if (fn === "max")  return Math.max(...xs);
        if (fn === "median") { const s2 = [...xs].sort((a, b) => a - b); const m = Math.floor(s2.length / 2); return s2.length % 2 ? s2[m] : (s2[m - 1] + s2[m]) / 2; }
        if (fn === "sd") { const mu = sum / xs.length; const v = xs.reduce((a, b) => a + (b - mu) ** 2, 0) / (xs.length - 1 || 1); return Math.sqrt(v); }
        return null;
      };

      const valByRow = new Array(rows.length).fill(null);
      if (fn === "rank") {
        // min-rank within group, ascending by `col`
        groups.forEach(idxs => {
          const ordered = [...idxs].sort((a, b) => (num(a) ?? Infinity) - (num(b) ?? Infinity));
          let rank = 0, prev = null, seen = 0;
          ordered.forEach(i => { seen++; const v = num(i); if (v !== prev) { rank = seen; prev = v; } valByRow[i] = rank; });
        });
      } else {
        groups.forEach(idxs => { const a = agg(idxs); idxs.forEach(i => { valByRow[i] = a; }); });
      }
      R = rows.map((r, i) => ({ ...r, [nn]: valByRow[i] }));
      if (!H.includes(nn)) H = [...H, nn];
      break;
    }
```

- [ ] **Step 2: Build to verify**

Run: `npm run build`
Expected: success.

- [ ] **Step 3: Commit**

```bash
git add src/pipeline/runner.js
git commit -m "feat(pipeline): group_transform (group stat broadcast) step"
```

---

## Task 6: `vector_assign` step in runner

**Files:**
- Modify: `src/pipeline/runner.js` — add the import at the top and a `vector_assign` case.

- [ ] **Step 1: Add the import**

At the top of `runner.js`, alongside the other imports, add:

```js
import { assignVector } from "../core/generate/vectorAssign.js";
```

- [ ] **Step 2: Add the case**

This reuses the SAME compiled-predicate pattern already used by `case_when`/`if_else`/`mutate` in this file — copy that idiom exactly so behavior matches.

```js
    case "vector_assign": {
      // s.nn, s.values[], s.mode, s.weights, s.seed, s.rules[{expr,value}], s.elseValue
      const nn = s.nn || "assigned";
      const values = Array.isArray(s.values) ? s.values : [];
      let evalRule;
      if (s.mode === "conditional") {
        const safeH = H.filter(h => /^[a-zA-Z_$][a-zA-Z0-9_$]*$/.test(h));
        // compile one predicate per rule — identical to the existing case_when case
        const ruleFns = (s.rules ?? []).map(rule => {
          // eslint-disable-next-line no-new-func
          try { return new Function(...safeH, `"use strict"; return !!(${rule.expr});`); }
          catch { return null; }
        });
        evalRule = (r) => {
          const args = safeH.map(h => r[h] ?? null);
          for (let i = 0; i < (s.rules ?? []).length; i++) {
            if (!ruleFns[i]) continue;
            try { if (ruleFns[i](...args)) return s.rules[i].value; } catch {}
          }
          return undefined; // no match -> engine uses elseValue
        };
      }
      const assigned = assignVector(rows, {
        values, mode: s.mode || "random",
        weights: s.weights ?? null, seed: s.seed,
        evalRule, elseValue: s.elseValue ?? null,
      });
      R = rows.map((r, i) => ({ ...r, [nn]: assigned[i] }));
      if (!H.includes(nn)) H = [...H, nn];
      break;
    }
```

- [ ] **Step 3: Build to verify**

Run: `npm run build`
Expected: success.

- [ ] **Step 4: Commit**

```bash
git add src/pipeline/runner.js
git commit -m "feat(pipeline): vector_assign step wired to seeded engine"
```

---

## Task 7: Registry entries (sync with runner)

**Files:**
- Modify: `src/pipeline/registry.js`

- [ ] **Step 1: Extend the `join` `how` options**

In the `join` entry, replace the `how` select options with all six:

```js
      { key: "how", type: "select", label: "Join type", options: [
        { value: "left",  label: "Left join (keep all left rows)" },
        { value: "inner", label: "Inner join (matched rows only)" },
        { value: "right", label: "Right join (keep all right rows)" },
        { value: "full",  label: "Full join (all rows, both sides)" },
        { value: "semi",  label: "Semi join (left rows with a match — no new cols)" },
        { value: "anti",  label: "Anti join (left rows without a match — no new cols)" },
      ]},
```

- [ ] **Step 2: Add the new merge/cleaning/reshape/feature entries**

Add these entries to `STEP_REGISTRY` (merge ones near `append`, `distinct` in cleaning, `group_transform` in reshape, `vector_assign` in features):

```js
  {
    type: "bind_cols",
    label: "Bind columns",
    category: "merge",
    description: "Horizontally bind another dataset's columns by row position (dplyr bind_cols). Row-count mismatch truncates to the shorter dataset.",
    schema: [
      { key: "rightId", type: "text", label: "Dataset to bind" },
      { key: "suffix",  type: "text", label: "Suffix for duplicate columns (default: _r)" },
    ],
    toLabel: s => `bind_cols <- ${s.rightId}`,
    defaultStep: () => ({ type: "bind_cols", rightId: "", suffix: "_r" }),
  },
  {
    type: "union",
    label: "Union (stack + dedup)",
    category: "merge",
    description: "Vertically stack another dataset and drop full-row duplicates (dplyr union).",
    schema: [{ key: "rightId", type: "text", label: "Dataset to union" }],
    toLabel: s => `union <- ${s.rightId}`,
    defaultStep: () => ({ type: "union", rightId: "" }),
  },
  {
    type: "intersect",
    label: "Intersect",
    category: "merge",
    description: "Keep rows present in both datasets, matched on shared columns (dplyr intersect).",
    schema: [{ key: "rightId", type: "text", label: "Other dataset" }],
    toLabel: s => `intersect ${s.rightId}`,
    defaultStep: () => ({ type: "intersect", rightId: "" }),
  },
  {
    type: "setdiff",
    label: "Set difference",
    category: "merge",
    description: "Keep rows in the current dataset that are NOT in the other, matched on shared columns (dplyr setdiff).",
    schema: [{ key: "rightId", type: "text", label: "Other dataset" }],
    toLabel: s => `setdiff ${s.rightId}`,
    defaultStep: () => ({ type: "setdiff", rightId: "" }),
  },
  {
    type: "distinct",
    label: "Distinct (drop duplicate rows)",
    category: "cleaning",
    description: "Remove duplicate rows. Optionally dedup on a subset of columns; keep first or last occurrence. Equivalent to dplyr distinct() / pandas drop_duplicates().",
    schema: [
      { key: "subset", type: "cols",   label: "Columns to dedup on (empty = all)" },
      { key: "keep",   type: "select", label: "Keep", options: [
        { value: "first", label: "First occurrence" },
        { value: "last",  label: "Last occurrence" },
      ]},
    ],
    toLabel: s => `distinct${(s.subset?.length) ? ` on ${s.subset.join(", ")}` : ""}`,
    defaultStep: () => ({ type: "distinct", subset: [], keep: "first" }),
  },
  {
    type: "group_transform",
    label: "Group transform (broadcast)",
    category: "reshape",
    description: "Compute a group statistic and write it back to every row as a new column (does NOT collapse rows). Equivalent to dplyr group_by() |> mutate().",
    schema: [
      { key: "by",  type: "cols",   label: "Group by columns" },
      { key: "col", type: "col",    label: "Source column" },
      { key: "fn",  type: "select", label: "Statistic", options: [
        { value: "mean",   label: "Mean" },
        { value: "sum",    label: "Sum" },
        { value: "sd",     label: "Std dev (sample)" },
        { value: "min",    label: "Min" },
        { value: "max",    label: "Max" },
        { value: "count",  label: "Count" },
        { value: "median", label: "Median" },
        { value: "rank",   label: "Rank (within group, asc)" },
      ]},
      { key: "nn", type: "text", label: "Output column name" },
    ],
    toLabel: s => `group_transform ${s.fn}(${s.col}) by ${(s.by || []).join(", ")} -> ${s.nn || "auto"}`,
    defaultStep: () => ({ type: "group_transform", by: [], col: "", fn: "mean", nn: "" }),
  },
  {
    type: "vector_assign",
    label: "Generate column from vector",
    category: "features",
    description: "Assign a small value vector across all rows by a chosen mode: random (seeded weighted draw), conditional (rules), recycle (by position), or quota (exact proportions). Seeded for reproducible replay.",
    schema: [
      { key: "nn",     type: "text",   label: "Output column name" },
      { key: "values", type: "text",   label: "Values (comma or newline separated)" },
      { key: "mode",   type: "select", label: "Mode", options: [
        { value: "random",      label: "Random (weighted draw)" },
        { value: "conditional", label: "Conditional (rules)" },
        { value: "recycle",     label: "Recycle (by row position)" },
        { value: "quota",       label: "Quota (exact proportions)" },
      ]},
      { key: "seed", type: "number", label: "Random seed (random/quota)" },
    ],
    toLabel: s => `vector_assign ${s.nn || "col"} [${s.mode || "random"}]`,
    defaultStep: () => ({ type: "vector_assign", nn: "", values: "", mode: "random", weights: null, rules: [], elseValue: "", seed: 42 }),
  },
```

> Note: `values` is stored as a string in the registry default, but the Vector UI (Tasks 10/13) parses it into `values: string[]` before emitting the step. The runner expects an array. The registry default-form is a fallback editor; the custom UI is the primary path.

- [ ] **Step 3: Build to verify**

Run: `npm run build`
Expected: success.

- [ ] **Step 4: Commit**

```bash
git add src/pipeline/registry.js
git commit -m "feat(pipeline): registry entries for joins/sets/distinct/group_transform/vector_assign"
```

---

## Task 8: MergeTab — six join types in the Join sub-tab

**Files:**
- Modify: `src/components/wrangling/MergeTab.jsx`

- [ ] **Step 1: Extend the join-type selector**

In the JOIN sub-tab, replace the join-type button group (currently `[["left","LEFT"],["inner","INNER"]]`) with all six:

```jsx
{[["left","LEFT"],["inner","INNER"],["right","RIGHT"],["full","FULL"],["semi","SEMI"],["anti","ANTI"]].map(([k,l])=>(
  <button key={k} onClick={()=>updateJoin(idx,{how:k})}
    style={{padding:"0.3rem 0.7rem",border:`1px solid ${j.how===k?C.teal:C.border2}`,
      background:j.how===k?`${C.teal}18`:"transparent",color:j.how===k?C.teal:C.textDim,
      borderRadius:3,cursor:"pointer",fontSize:11,fontFamily:mono}}>
    {j.how===k?"✓ ":""}{l}
  </button>
))}
```

- [ ] **Step 2: Hide suffix + column preview for anti/semi**

Define `const noCols = j.how === "anti" || j.how === "semi";` inside the `joins.map` render. Then:
- Wrap the suffix input column so it only renders when `!noCols` (for anti/semi show a note instead):

```jsx
{noCols ? (
  <div style={{fontSize:10,color:C.textMuted,fontFamily:mono,alignSelf:"center"}}>
    Filters rows only — no columns added.
  </div>
) : (
  /* existing suffix input block */
)}
```

- In the formula preview block, when `noCols` replace the `+N columns` span with `-> row filter`:

```jsx
{" -> "}{noCols
  ? <span style={{color:C.yellow}}>row filter ({j.how})</span>
  : <span style={{color:C.green}}>+{rHdrs.filter(h=>h!==j.rightKey).length} columns</span>}
```

- [ ] **Step 3: Keep `headerChain` correct for anti/semi**

In the `headerChain` useMemo, when the staged join is anti/semi, do not append right columns:

```js
if (!right || !sj.rightKey || sj.how === "anti" || sj.how === "semi") { chain.push(prev.slice()); continue; }
```

- [ ] **Step 4: Build + browser-validate**

Run: `npm run build` → success.
Browser: load two datasets, run an anti join (confirm row count drops, no new columns), a full join (confirm unmatched right rows appended).

- [ ] **Step 5: Commit**

```bash
git add src/components/wrangling/MergeTab.jsx
git commit -m "feat(merge): expose right/full/semi/anti join types in MergeTab"
```

---

## Task 9: MergeTab — dedicated Combine sub-tab

**Files:**
- Modify: `src/components/wrangling/MergeTab.jsx`

- [ ] **Step 1: Add the Combine + Vector tabs to the sub-tab bar**

Change the `Tabs` declaration to four tabs:

```jsx
<Tabs tabs={[["join","⊞ Join"],["append","⊕ Append"],["combine","⊜ Combine"],["vector","⊕ Vector"]]} active={subTab} set={setSubTab} accent={C.teal} sm/>
```

(The `vector` tab body comes in Task 10; add the `combine` body now.)

- [ ] **Step 2: Add Combine state**

Near the other `useState` calls:

```jsx
const [combineId, setCombineId] = useState("");
const [combineOp, setCombineOp] = useState("union");
const [combineSuffix, setCombineSuffix] = useState("_r");
const combineDs = allDatasets.find(d => d.id === combineId);
```

- [ ] **Step 3: Add the Combine preview + emit**

```jsx
const combinePreview = useMemo(() => {
  if (!combineDs) return null;
  const rH = combineDs.rawData.headers, rN = combineDs.rawData.rows.length;
  const shared = headers.filter(h => rH.includes(h));
  if (combineOp === "bind_cols") {
    return { kind:"bind_cols", outRows: Math.min(rows.length, rN),
      mismatch: rows.length !== rN, lN: rows.length, rN,
      outCols: headers.length + rH.length };
  }
  return { kind:"set", shared, rN };
}, [combineDs, combineOp, headers, rows.length]);

function doCombine() {
  if (!combineId) return;
  const base = { rightId: combineId };
  if (combineOp === "bind_cols") base.suffix = combineSuffix;
  onAdd({ type: combineOp, ...base,
    desc: `${combineOp.toUpperCase()} ${combineDs?.filename}` });
  setCombineId("");
}
```

- [ ] **Step 4: Render the Combine body**

Add a `{subTab==="combine" && ( ... )}` block (match the Append tab's visual style — dataset button-list, op selector, preview card, submit `Btn`):

```jsx
{subTab==="combine" && (
  <div>
    <div style={{padding:"0.55rem 0.9rem",background:C.surface,border:`1px solid ${C.border}`,
      borderLeft:`3px solid ${C.gold}`,borderRadius:4,marginBottom:"1.2rem",
      fontSize:10,color:C.textMuted,fontFamily:mono,lineHeight:1.6}}>
      Set & bind operations against another dataset — dplyr <span style={{color:C.gold}}>bind_cols</span> /{" "}
      <span style={{color:C.gold}}>union</span> / <span style={{color:C.gold}}>intersect</span> /{" "}
      <span style={{color:C.gold}}>setdiff</span>.
    </div>

    <Lbl color={C.gold}>Operation</Lbl>
    <div style={{display:"flex",gap:4,flexWrap:"wrap",marginBottom:"1.2rem"}}>
      {[["union","Union (stack + dedup)"],["bind_cols","Bind columns (by position)"],
        ["intersect","Intersect (rows in both)"],["setdiff","Set diff (rows not in other)"]].map(([k,l])=>(
        <button key={k} onClick={()=>setCombineOp(k)}
          style={{padding:"0.35rem 0.7rem",border:`1px solid ${combineOp===k?C.gold:C.border2}`,
            background:combineOp===k?`${C.gold}18`:"transparent",color:combineOp===k?C.gold:C.textDim,
            borderRadius:3,cursor:"pointer",fontSize:11,fontFamily:mono}}>
          {combineOp===k?"✓ ":""}{l}
        </button>
      ))}
    </div>

    <Lbl color={C.gold}>Other dataset</Lbl>
    <div style={{display:"flex",flexWrap:"wrap",gap:6,marginBottom:"1.2rem"}}>
      {allDatasets.map(d=>(
        <button key={d.id} onClick={()=>setCombineId(d.id)}
          style={{padding:"0.4rem 0.9rem",border:`1px solid ${combineId===d.id?C.gold:C.border2}`,
            background:combineId===d.id?`${C.gold}18`:"transparent",color:combineId===d.id?C.gold:C.textDim,
            borderRadius:3,cursor:"pointer",fontSize:11,fontFamily:mono}}>
          {combineId===d.id?"✓ ":""}{d.filename}
          <span style={{fontSize:9,color:C.textMuted,marginLeft:6}}>
            {d.rawData.rows.length.toLocaleString()}×{d.rawData.headers.length}
          </span>
        </button>
      ))}
    </div>

    {combineOp==="bind_cols" && (
      <div style={{marginBottom:"1rem"}}>
        <Lbl color={C.textDim}>Suffix for column conflicts</Lbl>
        <input value={combineSuffix} onChange={e=>setCombineSuffix(e.target.value)} placeholder="_r"
          style={{padding:"0.35rem 0.55rem",background:C.surface2,border:`1px solid ${C.border2}`,
            borderRadius:3,color:C.text,fontFamily:mono,fontSize:11,outline:"none"}}/>
      </div>
    )}

    {combinePreview && (
      <div style={{padding:"0.55rem 0.8rem",background:C.surface2,border:`1px solid ${C.border}`,
        borderRadius:4,marginBottom:"1rem",fontSize:11,color:C.textDim,fontFamily:mono,lineHeight:1.6}}>
        {combinePreview.kind==="bind_cols" ? (<>
          Result: <span style={{color:C.gold}}>{combinePreview.outRows.toLocaleString()}</span> rows ×{" "}
          <span style={{color:C.gold}}>{combinePreview.outCols}</span> cols
          {combinePreview.mismatch && (
            <div style={{color:C.yellow,marginTop:4}}>
              ⚠ Row counts differ ({combinePreview.lN.toLocaleString()} vs {combinePreview.rN.toLocaleString()}) — truncated to shorter.
            </div>
          )}
        </>) : (<>
          Matched on shared columns: <span style={{color:C.gold}}>{combinePreview.shared.join(", ") || "(none — no overlap!)"}</span>
        </>)}
      </div>
    )}

    <Btn onClick={doCombine} color={C.gold} v="solid" dis={!combineId}
      ch={`Add ${combineOp.toUpperCase()} to pipeline →`}/>
  </div>
)}
```

- [ ] **Step 5: Build + browser-validate**

Run: `npm run build` → success. Browser: union two datasets (dedup), bind_cols (truncate warning shows when row counts differ).

- [ ] **Step 6: Commit**

```bash
git add src/components/wrangling/MergeTab.jsx
git commit -m "feat(merge): dedicated Combine sub-tab (bind_cols/union/intersect/setdiff)"
```

---

## Task 10: MergeTab — Vector sub-tab

**Files:**
- Modify: `src/components/wrangling/MergeTab.jsx`

> The Vector UI built here is refactored into a shared `VectorAssignForm.jsx` in Task 13 so Feature can reuse it. Build it inline first to validate, then extract. (If you prefer, jump to Task 13's component first and render it here directly — either order works, but the end state is a single shared component.)

- [ ] **Step 1: Add Vector state**

```jsx
const [vNn, setVNn]       = useState("");
const [vValuesRaw, setVValuesRaw] = useState("");
const [vMode, setVMode]   = useState("random");
const [vSeed, setVSeed]   = useState(42);
const [vWeights, setVWeights] = useState({});            // value -> weight string
const [vRules, setVRules] = useState([{ expr:"", value:"" }]);
const [vElse, setVElse]   = useState("");

const vValues = useMemo(
  () => vValuesRaw.split(/[\n,]+/).map(s => s.trim()).filter(Boolean),
  [vValuesRaw]
);

function doVector() {
  if (!vNn || !vValues.length) return;
  const step = { type:"vector_assign", nn:vNn, values:vValues, mode:vMode, seed:Number(vSeed) };
  if (vMode === "random" || vMode === "quota") {
    const ws = vValues.map(v => { const n = parseFloat(vWeights[v]); return isFinite(n) && n > 0 ? n : null; });
    step.weights = ws.some(w => w !== null) ? ws.map(w => w ?? 0) : null;
  }
  if (vMode === "conditional") {
    step.rules = vRules.filter(r => r.expr.trim());
    step.elseValue = vElse;
  }
  onAdd({ ...step, desc:`vector_assign ${vNn} [${vMode}]` });
  setVNn(""); setVValuesRaw("");
}
```

- [ ] **Step 2: Render the Vector body**

```jsx
{subTab==="vector" && (
  <div>
    <div style={{padding:"0.55rem 0.9rem",background:C.surface,border:`1px solid ${C.border}`,
      borderLeft:`3px solid ${C.blue}`,borderRadius:4,marginBottom:"1.2rem",
      fontSize:10,color:C.textMuted,fontFamily:mono,lineHeight:1.6}}>
      Assign a small value vector across all <span style={{color:C.blue}}>{rows.length.toLocaleString()}</span> rows.
      Choose a mode below. Random & quota are seeded — same seed reproduces the same column on replay.
    </div>

    <Lbl color={C.blue}>Output column name</Lbl>
    <input value={vNn} onChange={e=>setVNn(e.target.value)} placeholder="e.g. colour"
      style={{width:"100%",boxSizing:"border-box",marginBottom:"1rem",padding:"0.4rem 0.6rem",
        background:C.surface2,border:`1px solid ${C.border2}`,borderRadius:3,color:C.text,fontFamily:mono,fontSize:12,outline:"none"}}/>

    <Lbl color={C.blue}>Values (comma or newline separated)</Lbl>
    <textarea value={vValuesRaw} onChange={e=>setVValuesRaw(e.target.value)} rows={3}
      placeholder={"red, blue, green\nor one per line"}
      style={{width:"100%",boxSizing:"border-box",marginBottom:"1rem",padding:"0.4rem 0.6rem",
        background:C.surface2,border:`1px solid ${C.border2}`,borderRadius:3,color:C.text,fontFamily:mono,fontSize:12,outline:"none",resize:"vertical"}}/>

    <Lbl color={C.blue}>Mode</Lbl>
    <div style={{display:"flex",gap:4,flexWrap:"wrap",marginBottom:"1.2rem"}}>
      {[["random","Random (weighted)"],["conditional","Conditional (rules)"],
        ["recycle","Recycle (by position)"],["quota","Quota (exact proportions)"]].map(([k,l])=>(
        <button key={k} onClick={()=>setVMode(k)}
          style={{padding:"0.35rem 0.7rem",border:`1px solid ${vMode===k?C.blue:C.border2}`,
            background:vMode===k?`${C.blue}18`:"transparent",color:vMode===k?C.blue:C.textDim,
            borderRadius:3,cursor:"pointer",fontSize:11,fontFamily:mono}}>
          {vMode===k?"✓ ":""}{l}
        </button>
      ))}
    </div>

    {(vMode==="random"||vMode==="quota") && vValues.length>0 && (
      <div style={{marginBottom:"1.2rem"}}>
        <Lbl color={C.textDim}>Weights (optional — blank = {vMode==="quota"?"equal split":"uniform"})</Lbl>
        <div style={{display:"grid",gridTemplateColumns:"repeat(auto-fill,minmax(120px,1fr))",gap:6}}>
          {vValues.map(v=>(
            <div key={v} style={{display:"flex",alignItems:"center",gap:4}}>
              <span style={{fontSize:10,color:C.textDim,fontFamily:mono,minWidth:40,overflow:"hidden",textOverflow:"ellipsis"}}>{v}</span>
              <input value={vWeights[v]??""} onChange={e=>setVWeights(w=>({...w,[v]:e.target.value}))}
                placeholder="1" style={{width:50,padding:"0.2rem 0.3rem",background:C.surface2,
                  border:`1px solid ${C.border2}`,borderRadius:3,color:C.text,fontFamily:mono,fontSize:10,outline:"none"}}/>
            </div>
          ))}
        </div>
      </div>
    )}

    {vMode==="conditional" && (
      <div style={{marginBottom:"1.2rem"}}>
        <Lbl color={C.textDim}>Rules (first match wins). Column names usable in the expression.</Lbl>
        {vRules.map((rule,i)=>(
          <div key={i} style={{display:"flex",gap:6,marginBottom:6}}>
            <input value={rule.expr} onChange={e=>setVRules(rs=>rs.map((r,k)=>k===i?{...r,expr:e.target.value}:r))}
              placeholder="e.g. income > 5000" style={{flex:2,padding:"0.3rem 0.5rem",background:C.surface2,
                border:`1px solid ${C.border2}`,borderRadius:3,color:C.text,fontFamily:mono,fontSize:11,outline:"none"}}/>
            <span style={{color:C.textMuted,alignSelf:"center"}}>-&gt;</span>
            <input value={rule.value} onChange={e=>setVRules(rs=>rs.map((r,k)=>k===i?{...r,value:e.target.value}:r))}
              placeholder="value" style={{flex:1,padding:"0.3rem 0.5rem",background:C.surface2,
                border:`1px solid ${C.border2}`,borderRadius:3,color:C.text,fontFamily:mono,fontSize:11,outline:"none"}}/>
            <button onClick={()=>setVRules(rs=>rs.length>1?rs.filter((_,k)=>k!==i):rs)}
              style={{padding:"0 0.5rem",border:`1px solid ${C.border2}`,background:"transparent",color:C.textMuted,borderRadius:3,cursor:"pointer"}}>×</button>
          </div>
        ))}
        <button onClick={()=>setVRules(rs=>[...rs,{expr:"",value:""}])}
          style={{padding:"0.25rem 0.6rem",border:`1px dashed ${C.blue}`,background:"transparent",color:C.blue,borderRadius:3,cursor:"pointer",fontSize:10,fontFamily:mono,marginBottom:8}}>
          + Add rule
        </button>
        <div style={{display:"flex",alignItems:"center",gap:6}}>
          <span style={{fontSize:10,color:C.textDim,fontFamily:mono}}>Else -&gt;</span>
          <input value={vElse} onChange={e=>setVElse(e.target.value)} placeholder="fallback value"
            style={{flex:1,padding:"0.3rem 0.5rem",background:C.surface2,border:`1px solid ${C.border2}`,borderRadius:3,color:C.text,fontFamily:mono,fontSize:11,outline:"none"}}/>
        </div>
      </div>
    )}

    {(vMode==="random"||vMode==="quota") && (
      <div style={{marginBottom:"1.2rem"}}>
        <Lbl color={C.textDim}>Seed</Lbl>
        <input type="number" value={vSeed} onChange={e=>setVSeed(e.target.value)}
          style={{width:90,padding:"0.3rem 0.5rem",background:C.surface2,border:`1px solid ${C.border2}`,borderRadius:3,color:C.text,fontFamily:mono,fontSize:11,outline:"none"}}/>
        <span style={{fontSize:9,color:C.textMuted,fontFamily:mono,marginLeft:8}}>Change to reshuffle; same seed reproduces the column.</span>
      </div>
    )}

    <Btn onClick={doVector} color={C.blue} v="solid" dis={!vNn || !vValues.length}
      ch={`Add vector column -> pipeline`}/>
  </div>
)}
```

- [ ] **Step 3: Build + browser-validate**

Run: `npm run build` → success. Browser: add a quota vector of 3 values over a dataset, confirm exact proportional counts in the result; re-run pipeline, confirm identical column (determinism).

- [ ] **Step 4: Commit**

```bash
git add src/components/wrangling/MergeTab.jsx
git commit -m "feat(merge): Vector sub-tab — assign value vector by mode"
```

---

## Task 11: CleanTab — distinct UI

**Files:**
- Modify: `src/components/wrangling/CleanTab.jsx`

- [ ] **Step 1: Add a Distinct section**

Add a new section (follow the existing section pattern in CleanTab — e.g. NormalizePanel/FillNaSection). Minimal functional version:

```jsx
function DistinctSection({ headers, onAdd, C }) {
  const [subset, setSubset] = useState([]);
  const [keep, setKeep] = useState("first");
  const toggle = h => setSubset(s => s.includes(h) ? s.filter(x=>x!==h) : [...s, h]);
  return (
    <div style={{marginBottom:"1.2rem"}}>
      <Lbl color={C.teal}>Distinct — drop duplicate rows</Lbl>
      <div style={{fontSize:10,color:C.textMuted,fontFamily:mono,marginBottom:6}}>
        Select columns to dedup on (none = entire row).
      </div>
      <div style={{display:"flex",flexWrap:"wrap",gap:4,marginBottom:8}}>
        {headers.map(h=>(
          <button key={h} onClick={()=>toggle(h)}
            style={{padding:"0.2rem 0.5rem",border:`1px solid ${subset.includes(h)?C.teal:C.border2}`,
              background:subset.includes(h)?`${C.teal}18`:"transparent",color:subset.includes(h)?C.teal:C.textDim,
              borderRadius:3,cursor:"pointer",fontSize:10,fontFamily:mono}}>{h}</button>
        ))}
      </div>
      <div style={{display:"flex",gap:8,alignItems:"center"}}>
        {[["first","Keep first"],["last","Keep last"]].map(([k,l])=>(
          <button key={k} onClick={()=>setKeep(k)}
            style={{padding:"0.25rem 0.6rem",border:`1px solid ${keep===k?C.teal:C.border2}`,
              background:keep===k?`${C.teal}18`:"transparent",color:keep===k?C.teal:C.textDim,
              borderRadius:3,cursor:"pointer",fontSize:10,fontFamily:mono}}>{l}</button>
        ))}
        <span style={{flex:1}}/>
        <Btn onClick={()=>onAdd({type:"distinct",subset,keep,desc:`distinct${subset.length?` on ${subset.join(", ")}`:""}`})}
          color={C.teal} v="solid" ch="Add distinct ->"/>
      </div>
    </div>
  );
}
```

Wire `<DistinctSection headers={headers} onAdd={onAdd} C={C}/>` into the CleanTab render (use the actual prop names CleanTab already receives for headers and the add-step callback — check the component's existing signature and match it).

- [ ] **Step 2: Build + browser-validate**

Run: `npm run build` → success. Browser: load a dataset with dup rows, apply distinct, confirm dedup.

- [ ] **Step 3: Commit**

```bash
git add src/components/wrangling/CleanTab.jsx
git commit -m "feat(clean): distinct (drop duplicate rows) UI"
```

---

## Task 12: ReshapeTab — group_transform UI

**Files:**
- Modify: `src/components/wrangling/ReshapeTab.jsx`

- [ ] **Step 1: Add a Group Transform section**

Follow ReshapeTab's existing group_summarize section pattern. Functional version:

```jsx
function GroupTransformSection({ headers, onAdd, C }) {
  const [by, setBy]   = useState([]);
  const [col, setCol] = useState("");
  const [fn, setFn]   = useState("mean");
  const [nn, setNn]   = useState("");
  const toggle = h => setBy(s => s.includes(h) ? s.filter(x=>x!==h) : [...s, h]);
  const auto = `${fn}_${col}_by_${by.join("_")}`;
  return (
    <div style={{marginBottom:"1.2rem"}}>
      <Lbl color={C.gold}>Group transform — broadcast a group stat back to every row</Lbl>
      <div style={{fontSize:10,color:C.textMuted,fontFamily:mono,marginBottom:6}}>
        Like group_by() |&gt; mutate(): adds a column, keeps all rows.
      </div>
      <Lbl color={C.gold}>Group by</Lbl>
      <div style={{display:"flex",flexWrap:"wrap",gap:4,marginBottom:8}}>
        {headers.map(h=>(
          <button key={h} onClick={()=>toggle(h)}
            style={{padding:"0.2rem 0.5rem",border:`1px solid ${by.includes(h)?C.gold:C.border2}`,
              background:by.includes(h)?`${C.gold}18`:"transparent",color:by.includes(h)?C.gold:C.textDim,
              borderRadius:3,cursor:"pointer",fontSize:10,fontFamily:mono}}>{h}</button>
        ))}
      </div>
      <div style={{display:"flex",gap:8,marginBottom:8,flexWrap:"wrap"}}>
        <select value={col} onChange={e=>setCol(e.target.value)}
          style={{padding:"0.3rem",background:C.surface2,border:`1px solid ${C.border2}`,borderRadius:3,color:C.text,fontFamily:mono,fontSize:11}}>
          <option value="">— column —</option>
          {headers.map(h=><option key={h} value={h}>{h}</option>)}
        </select>
        <select value={fn} onChange={e=>setFn(e.target.value)}
          style={{padding:"0.3rem",background:C.surface2,border:`1px solid ${C.border2}`,borderRadius:3,color:C.text,fontFamily:mono,fontSize:11}}>
          {["mean","sum","sd","min","max","count","median","rank"].map(f=><option key={f} value={f}>{f}</option>)}
        </select>
        <input value={nn} onChange={e=>setNn(e.target.value)} placeholder={auto}
          style={{flex:1,minWidth:120,padding:"0.3rem 0.5rem",background:C.surface2,border:`1px solid ${C.border2}`,borderRadius:3,color:C.text,fontFamily:mono,fontSize:11,outline:"none"}}/>
      </div>
      <Btn onClick={()=>onAdd({type:"group_transform",by,col,fn,nn:nn||auto,
        desc:`group_transform ${fn}(${col}) by ${by.join(", ")} -> ${nn||auto}`})}
        color={C.gold} v="solid" dis={!col||!by.length} ch="Add group transform ->"/>
    </div>
  );
}
```

Wire it into ReshapeTab's render with the component's actual headers/add-step props.

- [ ] **Step 2: Build + browser-validate**

Run: `npm run build` → success. Browser: group_transform mean of a numeric col by a category, confirm group mean appears on every row.

- [ ] **Step 3: Commit**

```bash
git add src/components/wrangling/ReshapeTab.jsx
git commit -m "feat(reshape): group_transform UI"
```

---

## Task 13: Extract VectorAssignForm + add Feature entry point

**Files:**
- Create: `src/components/wrangling/VectorAssignForm.jsx`
- Modify: `src/components/wrangling/MergeTab.jsx`, `src/components/wrangling/FeatureTab.jsx`

- [ ] **Step 1: Extract the Vector UI into a shared component (DRY)**

Create `src/components/wrangling/VectorAssignForm.jsx` exporting `VectorAssignForm({ rows, headers, onAdd })`. Move the state block (Task 10 Step 1) and the render body (Task 10 Step 2, minus the `{subTab==="vector" && (...)}` wrapper — render the inner `<div>` directly) into it. Import `useState, useMemo` from React and `useTheme, mono, Lbl, Btn` from `./shared.jsx`, mirroring MergeTab's imports.

- [ ] **Step 2: Consume it in MergeTab**

Replace the inline Vector body from Task 10 with:

```jsx
{subTab==="vector" && (
  <VectorAssignForm rows={rows} headers={headers} onAdd={onAdd}/>
)}
```

Remove the now-unused vector `useState`/`doVector`/`vValues` block from MergeTab (it lives in the shared component now). Add `import VectorAssignForm from "./VectorAssignForm.jsx";` at the top.

- [ ] **Step 3: Add the Feature entry point**

In `FeatureTab.jsx`, add a "Generate column" section rendering `<VectorAssignForm rows={rows} headers={headers} onAdd={onAdd}/>` (match FeatureTab's actual prop names for rows/headers/add-step; add the import).

- [ ] **Step 4: Build + browser-validate**

Run: `npm run build` → success. Browser: confirm the Vector form works identically from both Merge → Vector and Feature → Generate column, and both emit the same `vector_assign` step.

- [ ] **Step 5: Commit**

```bash
git add src/components/wrangling/VectorAssignForm.jsx src/components/wrangling/MergeTab.jsx src/components/wrangling/FeatureTab.jsx
git commit -m "refactor(feature): shared VectorAssignForm consumed by Merge + Feature"
```

---

## Task 14: Replication-script translations

**Files:**
- Modify: `src/services/export/rScript.js`, `src/services/export/pythonScript.js`, `src/services/export/stataScript.js`

- [ ] **Step 1: Locate the step-translation switch in each file**

Each export file has a per-step translator (a switch or map keyed by `step.type`). Find it (search for `case "join"` / `"append"` / `pivot_wider`). Add cases for: `bind_cols`, `union`, `intersect`, `setdiff`, `distinct`, `group_transform`, `vector_assign`, and the new join `how` values.

- [ ] **Step 2: R translations (`rScript.js`)**

```js
// join how -> dplyr verb (extend the existing join translator)
const joinVerb = { left:"left_join", inner:"inner_join", right:"right_join",
  full:"full_join", semi:"semi_join", anti:"anti_join" }[s.how || "left"];
// e.g. `df <- ${joinVerb}(df, ${rightName}, by = c("${s.leftKey}" = "${s.rightKey}"))`

case "bind_cols":  return `df <- bind_cols(df, ${rightName})`;
case "union":      return `df <- union(df, ${rightName})`;
case "intersect":  return `df <- intersect(df, ${rightName})`;
case "setdiff":    return `df <- setdiff(df, ${rightName})`;
case "distinct":   return `df <- distinct(df${s.subset?.length ? `, ${s.subset.join(", ")}` : ""}, .keep_all = TRUE)`;
case "group_transform":
  return `df <- df |> group_by(${s.by.join(", ")}) |> mutate(${s.nn} = ${s.fn === "count" ? "n()" : `${rFn(s.fn, s.col)}`}) |> ungroup()`;
case "vector_assign": {
  const vals = `c(${s.values.map(v => `"${v}"`).join(", ")})`;
  if (s.mode === "recycle") return `df$${s.nn} <- rep_len(${vals}, nrow(df))`;
  if (s.mode === "conditional") {
    const lines = (s.rules||[]).map(r => `    ${r.expr} ~ "${r.value}"`).join(",\n");
    return `df$${s.nn} <- with(df, dplyr::case_when(\n${lines},\n    TRUE ~ "${s.elseValue}"\n))`;
  }
  const prob = s.weights ? `, prob = c(${s.weights.join(", ")})` : "";
  if (s.mode === "quota")
    return `# NOTE: EconSolver uses a seeded mulberry32 RNG; values differ, distribution matches\nset.seed(${s.seed}); df$${s.nn} <- sample(rep_len(${vals}, nrow(df)))`;
  return `# NOTE: EconSolver uses a seeded mulberry32 RNG; values differ, distribution matches\nset.seed(${s.seed}); df$${s.nn} <- sample(${vals}, nrow(df), replace = TRUE${prob})`;
}
```

Add a small `rFn(fn, col)` helper: `mean->mean(col, na.rm=TRUE)`, `sum->sum(col, na.rm=TRUE)`, `sd->sd(col, na.rm=TRUE)`, `min`/`max`/`median` similar, `rank->min_rank(col)`.

- [ ] **Step 3: Python translations (`pythonScript.js`)**

```js
const pyJoinHow = { left:"left", inner:"inner", right:"right", full:"outer" };
// semi/anti: emit an isin filter rather than merge:
//   semi: df = df[df[leftKey].isin(other[rightKey])]
//   anti: df = df[~df[leftKey].isin(other[rightKey])]

case "bind_cols": return `df = pd.concat([df.reset_index(drop=True), ${rightName}.reset_index(drop=True)], axis=1)`;
case "union":     return `df = pd.concat([df, ${rightName}]).drop_duplicates().reset_index(drop=True)`;
case "intersect": return `df = df.merge(${rightName}, how="inner")`;
case "setdiff": return `df = df.merge(${rightName}, how="left", indicator=True).query('_merge == "left_only"').drop(columns="_merge")`;
case "distinct":  return `df = df.drop_duplicates(${s.subset?.length ? `subset=[${s.subset.map(c=>`"${c}"`).join(", ")}], ` : ""}keep="${s.keep || "first"}")`;
case "group_transform":
  return `df["${s.nn}"] = df.groupby([${s.by.map(c=>`"${c}"`).join(", ")}])["${s.col}"].transform("${s.fn === "count" ? "size" : s.fn === "sd" ? "std" : s.fn === "rank" ? "rank" : s.fn}")`;
case "vector_assign": {
  const vals = `[${s.values.map(v=>`"${v}"`).join(", ")}]`;
  if (s.mode === "recycle") return `df["${s.nn}"] = np.resize(${vals}, len(df))`;
  if (s.mode === "conditional") {
    const conds = (s.rules||[]).map(r => `df.eval("${r.expr}")`).join(", ");
    const choices = (s.rules||[]).map(r => `"${r.value}"`).join(", ");
    return `df["${s.nn}"] = np.select([${conds}], [${choices}], default="${s.elseValue}")`;
  }
  const p = s.weights ? `, p=np.array([${s.weights.join(", ")}])/np.sum([${s.weights.join(", ")}])` : "";
  return `# NOTE: EconSolver uses a seeded mulberry32 RNG; values differ, distribution matches\ndf["${s.nn}"] = np.random.default_rng(${s.seed}).choice(${vals}, size=len(df)${p})`;
}
```

Ensure `import numpy as np` is present in the Python preamble (add if the generator doesn't already include it).

- [ ] **Step 4: Stata translations (`stataScript.js`)**

```js
case "distinct":  return `duplicates drop ${s.subset?.length ? s.subset.join(" ") : ""}, force`;
case "group_transform":
  return `bysort ${s.by.join(" ")}: egen ${s.nn} = ${s.fn === "count" ? "count" : s.fn === "sd" ? "sd" : s.fn === "rank" ? "rank" : s.fn === "median" ? "median" : s.fn}(${s.col})`;
case "union":     return `append using "${rightName}"\nduplicates drop, force`;
case "bind_cols": return `* bind_cols: align by row order\nmerge 1:1 _n using "${rightName}", nogen`;
case "intersect": return `merge m:1 ${"/* shared keys */"} using "${rightName}", keep(match) nogen`;
case "setdiff":   return `merge m:1 ${"/* shared keys */"} using "${rightName}", keep(master) nogen`;
case "vector_assign": {
  if (s.mode === "recycle")
    return `gen ${s.nn} = ""\nlocal vals "${s.values.join(" ")}"\nforvalues i = 1/\`=_N' { local k = mod(\`i'-1, ${s.values.length}) + 1 \n replace ${s.nn} = word("\`vals'", \`k') in \`i' }`;
  return `* NOTE: EconSolver uses a seeded mulberry32 RNG; values differ, distribution matches\nset seed ${s.seed}\ngen double _u = runiform()\n* assign ${s.values.join("/")} by equal/weighted bins (approx)`;
}
// joins: extend the existing join translator with right/full via merge keep() options;
//   semi/anti via merge ... keep(match)/keep(master) then drop the merged vars.
```

- [ ] **Step 5: Build + browser-validate**

Run: `npm run build` → success. Browser: build a pipeline using each new step, open the CodeEditor / Report script export, confirm each step renders a sensible line in all three languages.

- [ ] **Step 6: Commit**

```bash
git add src/services/export/rScript.js src/services/export/pythonScript.js src/services/export/stataScript.js
git commit -m "feat(export): R/Python/Stata translations for new pipeline steps"
```

---

## Task 15: Docs — bump step count and lists

**Files:**
- Modify: `CLAUDE.md`, `ClaudePlan.md`

- [ ] **Step 1: Update the pipeline step section in CLAUDE.md**

The "Pipeline step types (runner.js) — 23 total" section: bump the count to 30 and add the new steps to the right category lists:
- Cleaning: add `distinct`
- Reshape: add `group_transform`
- Merge: add `bind_cols, union, intersect, setdiff`
- Features: add `vector_assign`
- Update the join line to note all six `how` values.

- [ ] **Step 2: Update the file-structure block in CLAUDE.md**

Add `src/core/generate/vectorAssign.js` and `src/components/wrangling/VectorAssignForm.jsx` to the file-structure listing.

- [ ] **Step 3: Mark the spec DONE in ClaudePlan.md**

In `ClaudePlan.md`'s Spec & Plan Index, change the `2026-06-05 clean-explore-parity-vector-join` row status from `OPEN` to `DONE`.

- [ ] **Step 4: Commit**

```bash
git add CLAUDE.md ClaudePlan.md
git commit -m "docs: register new pipeline steps + mark batch-1 spec done"
```

---

## Self-review notes (for the executor)

- **Registry/runner sync** is enforced per-part: Tasks 2-6 add runner cases, Task 7 adds every matching registry entry. Do not ship a runner case without its registry row.
- **Determinism** is covered by the Task 1 Node harness (re-run it after any engine change).
- **DRY:** the Vector UI lives in ONE component (`VectorAssignForm.jsx`, Task 13) consumed by both Merge and Feature. Task 10 builds it inline to validate; Task 13 extracts it.
- **No JS unit runner:** every UI task's gate is `npm run build` + Franco browser-validation; the only automated test is the Task 1 engine harness.
- **Anti/semi joins add no columns** — verified in runner (Task 2), reflected in MergeTab UI (Task 8) and `headerChain`.
- **Expression eval** in `vector_assign` conditional mode intentionally mirrors the existing `case_when`/`if_else`/`mutate` compiled-predicate idiom already in `runner.js`. Keep it identical; do not introduce a different evaluation mechanism.
