# Condition Language — Surfaces Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make every screen that lets the user pick a condition speak the one vocabulary defined in `predicate.js`, and delete the last duplicate evaluator.

**Architecture:** Each surface drops its private operator array and its private matcher, importing `OPERATORS`, `menuLabel`, `evalPredicate` and `normalizeOp` instead. Nothing new is invented — the engine landed in `plans/2026-08-04-condition-language-engine.md` (commits `47bf3d99`…`2b2810a3`).

**Tech Stack:** React 18, inline styles via `C`/`T`, `node:assert/strict` harnesses under node.

**Spec:** `docs/superpowers/specs/2026-08-03-unified-condition-language-design.md` — slices 3–8.

**Prerequisite:** the engine plan is DONE. `src/pipeline/predicate.js` exists and exports `OPERATORS`, `normalizeOp`, `isCanonicalOp`, `evalPredicate`, `predicateToSQL`.

---

## What changes for the user

| Screen | Today | After |
|---|---|---|
| Clean → FilterBuilder | `= equals`, `≠ not equals` | `== equals`, `!= not equals` |
| Explore → filter | `>` `<` `>=` `<=` `=` `≠` `in` `contains` | same list, prose labels, `=` becomes `==` |
| Data → viewer filter | `equals` `starts` `ends` `empty` | `equals` `starts with` `ends with` `is blank` |
| Model → SubsetManager | `==` `!=` `>=` `<=` `>` `<` | `== equals`, `!= not equals`, … |
| Clean → Feature (grouped_mutate) | `==` `!=` `>=` `<=` `>` `<` | same, via the shared table |

**Menus render `symbol + label` where a symbol exists** (`"== equals"`, `">= at least"`), so the dropdown teaches the form the user would type in a formula box. That is the whole point of Franco's original complaint: Explore showed `=` while SubsetManager showed `==` for the same operation, and neither matched what you type.

## Correction to the spec's count

The spec said six implementations of the condition concept. Writing this plan
found a **seventh**: `matchOne` inside `grouped_mutate` (`runner.js:1224`), with
two aliases nothing else uses (`=`, `<>`) and a *lenient* equality
(`String(rv) === String(val) || rv === nv`, so `== 10.0` matches `10`). Task 5
removes it and Task 8 guards against the eighth.

## The trap that makes Task 6 the expensive one

All three replication exporters emit the subset operator **verbatim** into the generated script — `rScript.js:1636`, `pythonScript.js:1292`, `stataScript.js:1192`, plus the inline `filterExpr` at `rScript.js:1785`, `pythonScript.js:1459` and `stataScript.js:1340`. This works today only because SubsetManager's operators (`==`, `!=`, `>=`, `<=`, `>`, `<`) happen to be valid in R, Python and Stata simultaneously.

Switching SubsetManager to canonical ids without touching the exporters would emit `region eq "north"` into an R script — broken replication, discovered by the user and not by us. Task 1 adds the translation and makes it throw for any operator that has no infix form, so extending SubsetManager's vocabulary later fails loudly at test time instead of silently producing invalid R.

---

### Task 1: Language infix map and menu labels

**Files:**
- Modify: `src/pipeline/predicate.js`
- Modify: `src/pipeline/__validation__/predicateValidation.mjs`

- [ ] **Step 1: Write the failing test**

Append to `src/pipeline/__validation__/predicateValidation.mjs`, before the final `console.log`:

```js
// ─── menu labels and language infix ───────────────────────────────────────────
// Menus show the symbol next to the prose so the dropdown teaches the typed form.
assert.equal(menuLabel("eq"),  "== equals");
assert.equal(menuLabel("gte"), ">= at least");
// Operators with no symbol show prose alone.
assert.equal(menuLabel("isna"),     "is null");
assert.equal(menuLabel("contains"), "contains");
// Legacy spellings resolve first.
assert.equal(menuLabel("equals"), "== equals");

// grouped_mutate's private matcher used two aliases nothing else did.
assert.equal(normalizeOp("<>"), "neq");
assert.equal(normalizeOp("="),  "eq");

// Exporters emit an infix form; the six comparison operators are defined for all
// three languages.
for (const op of ["eq", "neq", "gt", "gte", "lt", "lte"]) {
  for (const lang of ["r", "py", "stata"]) {
    assert.ok(opInfix(op, lang), `${op} missing infix for ${lang}`);
  }
}
assert.equal(opInfix("eq", "r"),     "==");
assert.equal(opInfix("neq", "stata"), "!=");
assert.equal(opInfix("equals", "py"), "==");  // legacy spelling

// An operator with NO infix form must throw rather than be emitted verbatim.
// `region contains "north"` is not valid R, and shipping it would surface as a
// broken replication script rather than as a failing test.
assert.throws(() => opInfix("contains", "r"), /no infix form/i);
assert.throws(() => opInfix("in", "stata"),   /no infix form/i);
```

And extend the import at the top of the file:

```js
import { OPERATORS, normalizeOp, evalPredicate, menuLabel, opInfix } from "../predicate.js";
```

- [ ] **Step 2: Run to verify it fails**

```bash
node src/pipeline/__validation__/predicateValidation.mjs
```

Expected: `SyntaxError: The requested module '../predicate.js' does not provide an export named 'menuLabel'`

- [ ] **Step 3: Implement**

First add the missing alias to the `ALIASES` table in `src/pipeline/predicate.js`,
beside the Explore symbols:

```js
  // grouped_mutate's matchOne (runner.js) — the only surface that used these
  "<>": "neq",
```

Then append to the same file:

```js
// ─── presentation and export helpers ──────────────────────────────────────────

const BY_ID = new Map(OPERATORS.map(o => [o.id, o]));

/**
 * Label for a dropdown: "== equals", ">= at least", "is null".
 * The symbol is the SAME token the user would type in a formula box — showing
 * `=` in a menu while the formula box wants `==` is the inconsistency this
 * whole module exists to remove.
 */
export function menuLabel(op) {
  const o = BY_ID.get(normalizeOp(op));
  if (!o) return String(op);
  return o.symbol ? `${o.symbol} ${o.label}` : o.label;
}

/** Every operator that has a plain infix spelling in the replication targets. */
const OP_INFIX = {
  eq:  { r: "==", py: "==", stata: "==" },
  neq: { r: "!=", py: "!=", stata: "!=" },
  gt:  { r: ">",  py: ">",  stata: ">"  },
  gte: { r: ">=", py: ">=", stata: ">=" },
  lt:  { r: "<",  py: "<",  stata: "<"  },
  lte: { r: "<=", py: "<=", stata: "<=" },
};

/**
 * Infix operator for a replication script. THROWS when the operator has no
 * infix form (in, contains, isna, …) — those need a function call per language
 * (`%in%`, `grepl`, `.isin`, `strpos`, `inlist`) and an exporter that emitted
 * them verbatim would produce a script that does not run. Failing here turns a
 * user-visible broken export into a failing test.
 */
export function opInfix(op, lang) {
  const row = OP_INFIX[normalizeOp(op)];
  if (!row) throw new Error(`Operator "${op}" has no infix form — ${lang} needs an explicit translation.`);
  return row[lang];
}
```

- [ ] **Step 4: Run to verify it passes**

```bash
node src/pipeline/__validation__/predicateValidation.mjs
```

Expected: `predicate operators OK` then `predicate eval OK`

- [ ] **Step 5: Commit**

```bash
git add src/pipeline/predicate.js src/pipeline/__validation__/predicateValidation.mjs
git commit -m "feat(predicate): menu labels and per-language infix operators"
```

---

### Task 2: CleanTab

**Files:**
- Modify: `src/components/wrangling/CleanTab.jsx:596-625` (operator arrays), `:761-794` (duplicate evaluator)

- [ ] **Step 1: Replace the operator arrays**

Replace `CleanTab.jsx:589-625` — the comment block listing the operator catalogue, both `OPS_NUM`/`OPS_CAT` arrays, and `opsFor` — with:

```jsx
// Operator catalogue and column-type gating both come from pipeline/predicate.js.
// Restating them here is how the five UI dialects drifted apart before.
function opsFor(col, info) {
  const type = (col && info[col]?.isNum) ? "numeric" : "categorical";
  return OPERATORS
    .filter(o => o.types.includes(type))
    .map(o => ({ v: o.id, l: menuLabel(o.id) }));
}
```

- [ ] **Step 2: Add the import**

At the top of `CleanTab.jsx`, with the other imports:

```jsx
import { OPERATORS, menuLabel, evalPredicate } from "../../pipeline/predicate.js";
```

- [ ] **Step 3: Replace the duplicate evaluator**

Replace the body of `FilterPreview`'s `useMemo` (`CleanTab.jsx:763-794`) — the whole inline `evalP` function and the `rows.filter` that uses it — with:

```jsx
  const passing = useMemo(() => {
    if (!predicate) return null;
    try {
      // Same evaluator the runner uses, so the preview count can never disagree
      // with what applying the step actually does. It throws on an unknown
      // operator; the catch degrades to "no preview", which is honest, whereas
      // the old local copy returned true and showed a confidently wrong count.
      return rows.filter(r => evalPredicate(predicate, r)).length;
    } catch { return null; }
  }, [rows, predicate]);
```

- [ ] **Step 4: Verify**

```bash
npm run build && npm run lint:undef
```

Expected: both succeed. If `lint:undef` reports `OPS_NUM` or `OPS_CAT` still referenced, a call site was missed — search with `grep -n "OPS_NUM\|OPS_CAT" src/components/wrangling/CleanTab.jsx` and point it at `opsFor`.

- [ ] **Step 5: Commit**

```bash
git add src/components/wrangling/CleanTab.jsx
git commit -m "refactor(clean): FilterBuilder reads OPERATORS; duplicate evaluator deleted"
```

---

### Task 3: Explore quick filter

**Files:**
- Modify: `src/ExplorerModule.jsx:2209` (`FILTER_OPS`), `:2213-2230` (`matchCond`), `:2321` (the `<select>`)

`matchCond` has one behaviour the canonical evaluator does not: an unparseable
numeric condition returns `true` (`ExplorerModule.jsx:2224`), so a half-typed
filter shows every row instead of none. That is deliberate for a live-typing
filter bar and is preserved explicitly below rather than silently lost.

- [ ] **Step 1: Replace the operator list and matcher**

Replace `ExplorerModule.jsx:2209-2230` with:

```jsx
// Operators come from pipeline/predicate.js so this bar speaks the same
// vocabulary as Clean's filter and the Data Viewer.
const FILTER_OPS = ["gt", "lt", "gte", "lte", "eq", "neq", "in", "contains"];

// "in" mirrors R's `col %in% c(...)` / Python's `col.isin([...])` — val is either
// an array (from the multi-select editor) or a comma-separated string typed by hand.
function matchCond(row, { col, op, val }) {
  const o = normalizeOp(op);
  if (o === "in") {
    const arr = Array.isArray(val) ? val : String(val ?? "").split(",").map(s => s.trim()).filter(Boolean);
    if (!arr.length) return true; // nothing selected yet — don't filter everything out
    return evalPredicate({ type: "condition", col, op: "in", values: arr }, row);
  }
  // A half-typed numeric condition keeps every row rather than blanking the
  // screen mid-keystroke. This bar filters as you type, so "no valid number yet"
  // must not read as "no matching rows".
  if (["gt", "lt", "gte", "lte"].includes(o)) {
    if (!isFinite(parseFloat(val)) || typeof row[col] !== "number") return true;
  }
  return evalPredicate({ type: "condition", col, op: o, value: val }, row);
}
```

- [ ] **Step 2: Add the import**

At the top of `ExplorerModule.jsx`, with the other imports:

```jsx
import { menuLabel, normalizeOp, evalPredicate } from "./pipeline/predicate.js";
```

- [ ] **Step 3: Render prose labels in the select**

At `ExplorerModule.jsx:2321`, change:

```jsx
                {FILTER_OPS.map(op=><option key={op} value={op}>{op}</option>)}
```

to:

```jsx
                {FILTER_OPS.map(op=><option key={op} value={op}>{menuLabel(op)}</option>)}
```

- [ ] **Step 4: Check for stored filter state**

```bash
grep -rn '"≠"\|op: *"="' src/ExplorerModule.jsx
```

Expected: no matches. Any default filter state still initialised to `"="` or `"≠"`
must move to `"eq"` / `"neq"` — `normalizeOp` would accept the old value at
evaluation time, but the `<select>` would render with nothing selected.

- [ ] **Step 5: Verify**

```bash
npm run build && npm run lint:undef
```

Expected: both succeed.

- [ ] **Step 6: Commit**

```bash
git add src/ExplorerModule.jsx
git commit -m "refactor(explore): quick filter uses the canonical operator vocabulary"
```

---

### Task 4: Data Viewer

**Files:**
- Modify: `src/App.jsx:488-507` (`filterPredicate`), `:744-748` (the operator `<select>`), `:749` (the value-input guard)

The Data Viewer's operators are `set_where`'s legacy spellings, because the same
state feeds both the view filter and the bulk-edit `whereClause`. Moving to
canonical ids keeps that working — `set_where` normalises on read — and `empty`
becomes `isblank`, which preserves the null-or-empty-string meaning a grid user
expects from "empty".

- [ ] **Step 1: Replace the predicate**

Replace `App.jsx:488-507` (the whole `filterPredicate` `useMemo`) with:

```jsx
  const filterPredicate = useMemo(() => {
    if (!filterCol || !filterOp) return null;
    const node = { type: "condition", col: filterCol, op: filterOp, value: filterVal };
    // Throws on an unknown operator; a filter that cannot be evaluated must not
    // silently pass every row, so it passes none and the count makes it obvious.
    return (r) => { try { return evalPredicate(node, r); } catch { return false; } };
  }, [filterCol, filterOp, filterVal]);
```

- [ ] **Step 2: Replace the operator select**

Replace `App.jsx:744-748` with:

```jsx
                {[
                  "eq", "contains", "startswith", "endswith",
                  "gt", "lt", "isblank", "notblank",
                ].map(op => <option key={op} value={op}>{menuLabel(op)}</option>)}
```

- [ ] **Step 3: Update the value-input guard**

At `App.jsx:749`, change:

```jsx
              {!["empty","notempty"].includes(filterOp) && (
```

to:

```jsx
              {!["isblank","notblank"].includes(filterOp) && (
```

- [ ] **Step 4: Update the `hasFilterValue` guard**

At `App.jsx:535`, change:

```jsx
  const hasFilterValue = ["empty","notempty"].includes(filterOp) || filterVal !== "";
```

to:

```jsx
  const hasFilterValue = ["isblank","notblank"].includes(filterOp) || filterVal !== "";
```

Missing this leaves bulk edit disabled for blank-filters, since `canBulkEdit`
depends on it (`App.jsx:536`).

- [ ] **Step 5: Set the initial operator**

At `App.jsx:427`, change:

```jsx
  const [filterOp,     setFilterOp]    = useState("contains");
```

Leave it as `"contains"` — already canonical. No edit needed; this step is a
confirmation, not a change.

- [ ] **Step 6: Add the import**

At the top of `App.jsx`, with the other imports:

```jsx
import { menuLabel, evalPredicate } from "./pipeline/predicate.js";
```

- [ ] **Step 7: Verify**

```bash
npm run build && npm run lint:undef
```

Expected: both succeed.

- [ ] **Step 8: Commit**

```bash
git add src/App.jsx
git commit -m "refactor(viewer): Data Viewer filter uses the canonical vocabulary"
```

---

### Task 5: FeatureTab grouped_mutate filters

**Files:**
- Modify: `src/components/wrangling/FeatureTab.jsx:155-156`

- [ ] **Step 1: Replace the operator array**

At `FeatureTab.jsx:155`, change:

```jsx
  const OPS=[["==","=="],["!=","!="],[">=",">="],["<=","<="],[">"," >"],["<"," <"]];
```

to:

```jsx
  const OPS=["eq","neq","gte","lte","gt","lt"].map(op=>[op, menuLabel(op)]);
```

- [ ] **Step 2: Update the default operator**

At `FeatureTab.jsx:156`, change `op:"=="` to `op:"eq"`:

```jsx
  function addFilt(){setGmFilter(fs=>[...fs,{col:headers[0]||"",op:"eq",val:""}]);}
```

- [ ] **Step 3: Add the import**

At the top of `FeatureTab.jsx`, with the other imports:

```jsx
import { menuLabel } from "../../pipeline/predicate.js";
```

- [ ] **Step 4: Replace `grouped_mutate`'s private matcher**

`runner.js:1224` carries a **seventh** dialect — `matchOne`, with two aliases no
other surface uses (`=` and `<>`) and a *lenient* equality:
`String(rv) === String(val) || rv === nv`, so `== 10.0` matches `10`.

Replace the whole `function matchOne(r, { col: c, op, val }) { … }` in
`runner.js` (starting at line 1224, ending at its closing brace) with:

```js
      // Same evaluator as `filter` and `set_where`. Deliberate delta: the old
      // local matcher also accepted numeric equality (`rv === nv`), so
      // `== 10.0` matched 10; the canonical `eq` compares as text only, which
      // is the convention the SQL compiler mirrors. Documented in the plan.
      const matchOne = (r, { col: c, op, val }) =>
        evalPredicate({ type: "condition", col: c, op, value: val }, r);
```

`normalizeOp` already accepts `=`; Task 1 Step 3 adds `<>`. Both keep working
for saved pipelines.

Do not skip this: emitting canonical ids into a step whose runner still switches
on `==` would make every grouped filter silently match nothing.

- [ ] **Step 5: Verify**

```bash
npm run build && npm run lint:undef && node src/pipeline/__validation__/pipelineReliabilityValidation.mjs
```

Expected: all three succeed.

- [ ] **Step 6: Commit**

```bash
git add src/components/wrangling/FeatureTab.jsx src/pipeline/runner.js
git commit -m "refactor(feature): grouped_mutate filters use the canonical vocabulary"
```

---

### Task 6: SubsetManager and the three exporters

**Files:**
- Modify: `src/components/wrangling/SubsetManager.jsx:22-40` (local matcher + `OPS`), `:46-51` (`filterLabel`)
- Modify: `src/services/export/rScript.js:1632-1636`, `:1785`
- Modify: `src/services/export/pythonScript.js:1288-1292`, `:1459`
- Modify: `src/services/export/stataScript.js:1188-1192`, `:1336-1340`
- Modify: `src/services/export/replicationBundle.js:197`

**Scope note:** SubsetManager keeps exactly its current six comparison operators.
Widening it to the full canonical set is a separate change, because `in`,
`contains` and the null operators need a function-call translation per language
that `opInfix` deliberately refuses to guess.

- [ ] **Step 1: Replace `OPS` and the label**

In `SubsetManager.jsx`, change line 40:

```js
const OPS = ["eq", "neq", "gte", "lte", "gt", "lt"];
```

and `filterLabel` (lines 46-51):

```js
function filterLabel(filters) {
  if (!filters.length) return "no filters";
  // The label shows the symbol, not the internal id — "region eq north" reads
  // like a typo to a user.
  return filters
    .map(f => `${f.col} ${OP_SYMBOL(f.op)} ${f.val}`)
    .join(" & ");
}
```

with a small helper above it:

```js
const OP_SYMBOL = (op) => OPERATORS.find(o => o.id === normalizeOp(op))?.symbol ?? op;
```

- [ ] **Step 2: Replace the local matcher**

Replace `applySubsetFilter` (`SubsetManager.jsx:19-37`) in full:

```js
export function applySubsetFilter(rows, filters) {
  if (!filters?.length) return rows;
  return rows.filter(row => {
    // The old switch ended in `default: return true`, so a subset carrying an
    // unrecognised operator silently matched every row. evalPredicate throws;
    // selecting nothing makes the breakage visible in the row count instead.
    try {
      return filters.every(f =>
        evalPredicate({ type: "condition", col: f.col, op: f.op, value: f.val }, row)
      );
    } catch { return false; }
  });
}
```

The old comparison semantics carry over unchanged: `==` compared as strings, the
numeric ops required both sides numeric, and a null value failed every condition
— all three are what the canonical evaluator already does.

- [ ] **Step 3: Add the imports**

```js
import { OPERATORS, normalizeOp, evalPredicate } from "../../pipeline/predicate.js";
```

- [ ] **Step 4: Translate in the R exporter**

In `src/services/export/rScript.js`, add the import:

```js
import { opInfix } from "../../pipeline/predicate.js";
```

At line 1636, change `${rName(f.col)} ${f.op} ${val}` to:

```js
    return `${rName(f.col)} ${opInfix(f.op, "r")} ${val}`;
```

and at line 1785, change `${col} ${f.op} ${val}` to:

```js
    return `${col} ${opInfix(f.op, "r")} ${val}`;
```

- [ ] **Step 5: Translate in the Python exporter**

In `src/services/export/pythonScript.js`, add:

```js
import { opInfix } from "../../pipeline/predicate.js";
```

At line 1292: `` return `(${dfName}["${f.col}"] ${opInfix(f.op, "py")} ${val})`; ``
At line 1459: `` return `(d[${JSON.stringify(f.col)}] ${opInfix(f.op, "py")} ${val})`; ``

- [ ] **Step 6: Translate in the Stata exporter**

In `src/services/export/stataScript.js`, add:

```js
import { opInfix } from "../../pipeline/predicate.js";
```

At line 1192: `` return `${f.col} ${opInfix(f.op, "stata")} ${val}`; ``
At line 1340: `` return `${col} ${opInfix(f.op, "stata")} ${val}`; ``

- [ ] **Step 7: Fix the bundle README line**

In `src/services/export/replicationBundle.js:197`, change
`` `${f.col} ${f.op} ${f.val}` `` to use the symbol, matching what the scripts contain:

```js
    ...subsets.map(s => `    ${s.name} — ${s.filters?.map(f => `${f.col} ${opInfix(f.op, "r")} ${f.val}`).join(" & ") || "no filter"}`),
```

and add the same `opInfix` import.

- [ ] **Step 8: Verify**

```bash
npm run build && npm run lint:undef && node src/services/export/__validation__/replicationIntegrityValidation.mjs
```

Expected: all three succeed. The replication harness is the one that would catch
an exporter still emitting a raw canonical id.

- [ ] **Step 9: Commit**

```bash
git add src/components/wrangling/SubsetManager.jsx src/services/export/rScript.js src/services/export/pythonScript.js src/services/export/stataScript.js src/services/export/replicationBundle.js
git commit -m "refactor(subsets): canonical operators, translated per language on export"
```

---

### Task 7: Help copy, tour and capability map

**Files:**
- Modify: `src/WranglingModule.jsx:744` (Clean HintBox)
- Modify: `src/ExplorerModule.jsx:2589` (Explore HintBox)
- Modify: `src/App.jsx:1292` (Data HintBox)
- Modify: `src/components/ModelingTab.jsx:2117` (Model HintBox)
- Modify: `src/components/tabs/CalculateTab.jsx:1537` (Calculate HintBox)

Required by the CLAUDE.md convention: renaming anything the user picks from the
UI updates that module's HintBox in the same change. **No counts in the prose.**

- [ ] **Step 1: Add a shared line to the four condition-bearing HintBoxes**

Add this item to the filter-related section of the Clean, Explore, Data and Model
HintBoxes (`sections` arrays at the line numbers above):

```jsx
            "Filter operators read the same everywhere — == equals, >= at least, is blank — and match what you type in a formula box",
```

- [ ] **Step 2: Pre-empt the confusion this change creates in Calculate**

Add to the Calculate HintBox's `sections`:

```jsx
          { heading: "= is not a comparison here", items: [
            "In the equation pad, = states a relation to solve: 2*x = 4*x - 10 finds x",
            "Everywhere else in Litux, == compares two values and = is not an operator",
            "That difference is deliberate — R, Python and Stata all keep the two apart",
          ]},
```

Nobody is confused today because the rest of the app is inconsistent and sets no
expectation. Once four screens say `==` in unison, Calculate's `=` starts to look
like an oversight.

- [ ] **Step 3: Check the tour**

```bash
grep -n '"=\|≠\|equals' src/components/HelpSystem.jsx
```

Expected: no operator names in `TOUR_STEPS`. If any appear, update them to the
canonical labels.

- [ ] **Step 4: Add the capability-map row**

In `src/services/AI/appCapabilityMap.js`, add a row following the shape of its
neighbours, recording that filter conditions share one operator vocabulary across
Clean, Explore, the Data Viewer and subsets. Mirror the surrounding entries'
keys exactly — the shape is defined there, not here.

- [ ] **Step 5: Verify**

```bash
npm run build && npm run lint:undef
```

Expected: both succeed.

- [ ] **Step 6: Commit**

```bash
git add src/WranglingModule.jsx src/ExplorerModule.jsx src/App.jsx src/components/ModelingTab.jsx src/components/tabs/CalculateTab.jsx src/services/AI/appCapabilityMap.js
git commit -m "docs(conditions): help copy for the unified operator vocabulary"
```

---

### Task 8: Prove the dialects are gone

**Files:**
- Create: `src/pipeline/__validation__/noRogueOperatorsValidation.mjs`

The spec's whole premise was that operator lists get re-declared and drift. A
grep-style guard is the only thing that stops the sixth copy from appearing.

- [ ] **Step 1: Write the test**

Create `src/pipeline/__validation__/noRogueOperatorsValidation.mjs`:

```js
// Guards the single-owner rule: no surface may re-declare an operator list.
// The five dialects this spec removed all looked like a small local array, and
// each was individually reasonable. Only a repo-wide check keeps them gone.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const SURFACES = [
  "src/components/wrangling/CleanTab.jsx",
  "src/components/wrangling/SubsetManager.jsx",
  "src/components/wrangling/FeatureTab.jsx",
  "src/ExplorerModule.jsx",
  "src/App.jsx",
];

// A literal array of comparison-operator STRINGS, e.g. ["==","!=",">="].
const ROGUE_ARRAY = /\[\s*"(==|!=|>=|<=|starts_with|is_null)"/;

for (const f of SURFACES) {
  const src = readFileSync(f, "utf8");
  assert.ok(
    !ROGUE_ARRAY.test(src),
    `${f} declares its own operator list — import OPERATORS from pipeline/predicate.js instead`
  );
}

// Nobody outside predicate.js may implement the operator switch.
for (const f of [...SURFACES, "src/pipeline/duckdbRunner.js"]) {
  const src = readFileSync(f, "utf8");
  assert.ok(
    !/op\s*===\s*"startswith"/.test(src),
    `${f} evaluates operators locally — use evalPredicate from pipeline/predicate.js`
  );
}

console.log("no rogue operator dialects OK");
```

- [ ] **Step 2: Run it**

```bash
node src/pipeline/__validation__/noRogueOperatorsValidation.mjs
```

Expected: `no rogue operator dialects OK`. A failure names the file that still
carries a private dialect — fix that file rather than relaxing the regex.

- [ ] **Step 3: Commit**

```bash
git add src/pipeline/__validation__/noRogueOperatorsValidation.mjs
git commit -m "test(predicate): guard against a sixth operator dialect appearing"
```

---

## Done criteria

- All five harnesses green:
  `predicateValidation.mjs`, `predicateAgreementValidation.mjs`,
  `noRogueOperatorsValidation.mjs`, `pipelineReliabilityValidation.mjs`,
  `replicationIntegrityValidation.mjs`
- `npm run build` and `npm run lint:undef` green
- Franco's browser pass:
  1. The operator dropdown reads identically in Clean, Explore, the Data Viewer and SubsetManager.
  2. A saved project from before this change still opens and its filters still produce the same row counts — the alias table doing its job.
  3. Export a multi-subset bundle and confirm the R, Python and Stata scripts contain `==`, not `eq`.
  4. Calculate's equation pad still solves `2*x = 4*x - 10`.
