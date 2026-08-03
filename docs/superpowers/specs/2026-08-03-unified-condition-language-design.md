# Unified condition language

**Date:** 2026-08-03
**Status:** spec approved by Franco; implementation plan not yet written
**Origin:** IDEAS.md Idea 6 (Excel-like Data Viewer). Grading that idea surfaced a larger
problem underneath it, which Franco named directly: *"hay que unificar los dialectos de
escritura en el programa entero, si se escribe `year=2015` o `year==2015` tiene que ser
igual en todas las secciones."* That unification is this spec. The Data Viewer autofilter
that started the conversation is deliberately sequenced **after** it — see Follow-on.

---

## 1 · Problem

The same operation — compare a column value against something — is spelled five different
ways in the UI and four different ways in the engine. None of these are aliases of one
canonical thing; they are independent implementations that have drifted.

### What the user sees

| Screen | Source | Vocabulary shown |
|---|---|---|
| Clean → FilterBuilder | `components/wrangling/CleanTab.jsx:597` | `is not null` · `is null` · `not in list` · `starts with` |
| Explore → filter bar | `ExplorerModule.jsx:2209` | `>` `<` `>=` `<=` **`=`** `≠` `in` `contains` |
| Data → viewer filter | `App.jsx:745` | `equals` · `contains` · `starts` · `ends` |
| Model → SubsetManager | `components/wrangling/SubsetManager.jsx:40` | **`==`** `!=` `>=` `<=` `>` `<` |
| Clean → Feature (`if_else`) | `components/wrangling/FeatureTab.jsx:155` | `==` `!=` `>=` `<=` `>` `<` |

Franco's example is literally present: Explore renders `=` and SubsetManager renders `==`
for the same comparison. "No value" is called `is null` in Clean, `empty` in the Data
Viewer, and `is_null` in the SQL engine.

### What the engine does

| Implementation | Shape | Operator spellings |
|---|---|---|
| `evalPredicate` — `pipeline/runner.js:227` | predicate tree | `notna isna eq neq gt gte lt lte in nin between contains startswith endswith regex` |
| `buildPredicate` — `pipeline/runner.js:91` (serves `set_where`) | flat clause | `equals not_equals contains starts ends gt lt between empty notempty` |
| `condToSQL` — `pipeline/duckdbRunner.js:73` | semi-flat + `conditions[]` | `== != > < >= <= contains not_contains starts_with ends_with is_null is_not_null` |
| inline predicate — `App.jsx:488` (Data Viewer) | flat closure | `equals contains starts ends gt lt empty notempty` |
| duplicate `evalPredicate` — `CleanTab.jsx:772` | predicate tree | a second copy of the runner's tree evaluator |

Six implementations of one concept.

### The dangerous one

`condToSQL` ends in `default: return "TRUE"` (`duckdbRunner.js:96`). An operator it does not
recognise does not fail — it matches every row and returns a plausible, wrong table. The
file already guards against exactly this for `step.expr` (`duckdbRunner.js:117-122`),
which shows the trap was understood locally but not generalised. This is the same failure
signature as the bugs catalogued in CLAUDE.md: no crash, no banner, just a silently wrong
number.

### What is already right

`FilterBuilder` (`CleanTab.jsx:823`) already builds the canonical predicate tree, with
condition groups and and/or nesting, and the `filter` step already accepts that tree
(`runner.js:214-226`) including `in`, `nin`, `between` and `regex`. The reference UI and
the reference data structure both exist. This spec extends them; it does not invent them.

---

## 2 · Scope

**In scope — the *condition* family:** a column value compared against something,
combinable with and/or. Concretely: Clean's filter, Explore's filter bar, the Data Viewer's
filter, SubsetManager, `vector_assign`'s condition, and the conditions in `if_else` /
`case_when`.

**Out of scope, deliberately:**

- **Calculate's equation pad.** There `=` means *"this relation holds, solve it"*, not
  *"test equality"*. That is a different language with different semantics, and R, Python
  and Stata all keep the two distinct for the same reason. Forcing `==` there breaks the
  solver.
- **Calculation expressions** (`log(gdp) / pop`) in `mutate` and Simulate. These stay
  JavaScript evaluated in the scrubbed worker — that scrub *is* the security boundary
  (`pipeline/exprGuard.js:5-12`), and replacing the engine would invalidate the audited
  model. This spec governs how a **condition** is written, not how arithmetic is written.
- **The Data Viewer autofilter.** Follow-on spec; see §8.

**Success criterion:** a user who learned to filter in Clean can filter in Explore, in
SubsetManager and in the Data Viewer without learning anything new, and the exported
replication script says the same thing the screen says.

---

## 3 · The canonical module

New file `src/pipeline/predicate.js`. One dialect: the tree the `filter` step already
uses — chosen because it has the most consumers and is already persisted inside saved
pipelines, so adopting it costs no migration for the largest class of stored data.

```
PredicateNode
  { type: "and" | "or", children: PredicateNode[] }
  { type: "condition", col, op, value, values }
```

Four exports, each the single owner of its concern:

| Export | Responsibility | Replaces |
|---|---|---|
| `evalPredicate(node, row)` | evaluate in JS | the runner's copy, `CleanTab.jsx:772`, `buildPredicate`, the Data Viewer's inline closure |
| `predicateToSQL(node)` | compile to a SQL `WHERE` | `condToSQL` |
| `OPERATORS` | one table: id, menu label, symbol, arity, applicable column types | the five UI operator arrays |

| `normalizeOp(op)` | map any legacy spelling to the canonical id | *(new — see §5)* |

`OPERATORS`' "applicable column types" field is not a new idea to design: `CleanTab.jsx:590-592`
already documents the gating convention in a comment — `numeric` admits
`notna isna eq neq gt gte lt lte between in nin`, `categorical` admits
`notna isna eq neq in nin contains startswith endswith regex`, and `any` admits
`notna isna`. That convention moves into the table verbatim rather than being reinvented.

**Load-bearing rule: `predicateToSQL` throws on an operator it does not know.** It never
emits `TRUE` as a fallback. Callers catch and fall back to the JS runner, which is slower
but correct. Guessing is the current behaviour and it is the bug.

---

## 4 · Vocabulary

One internal id per operation, two presentations depending on how the value is entered.

Leaf operators (the `op` field of a `condition` node):

| id | Menu label (prose) | Typed |
|---|---|---|
| `eq` / `neq` | equals / not equals | `==` / `!=` |
| `gt` `gte` `lt` `lte` | greater than / at least / less than / at most | `>` `>=` `<` `<=` |
| `between` | between | *menu only* |
| `in` / `nin` | in list / not in list | *menu only* |
| `contains` `startswith` `endswith` `regex` | contains / starts with / ends with / matches | *menu only* |
| `isna` / `notna` | is null / is not null | *menu only* |

Combination is a *node type*, not a leaf operator: `{type:"and"}` / `{type:"or"}` in the
tree, rendered as AND / OR in menus and written `&&` / `||` in text.

*Menu only* is not a gap. Typed mode is JavaScript, so `in list` is written the JavaScript
way: `["AR","BR"].includes(country)`. What gets unified is that **`==` means `==` in every
text box in the app** and **"equals" reads "equals" in every dropdown** — today Explore
shows `=` and SubsetManager shows `==` for the identical operation.

**Resolved: `&` and `|` are accepted as parse-time aliases**, normalised to `&&` / `||`
before evaluation. The reason is not politeness toward R users. In JavaScript `&` is
*bitwise* AND, so an R user writing `gdp > 1000 & year >= 2000` gets the right answer
**by coincidence** — both operands happen to be booleans, which coerce to 0/1 and bitwise
back to a correct truthy value. The coincidence ends the moment an operand is not boolean.
Normalising makes the behaviour intentional instead of accidental; leaving it alone means
shipping a construct that works until it silently does not.

---

## 5 · Migration and back-compatibility

Persisted artefacts carrying operator spellings:

- `set_where` steps — `where: {col, op, value}` using `equals` / `not_equals` / `empty` / `notempty` / …
- `filter` steps in the flat shape `runner.js:217` already labels "Legacy"
- `filter` steps carrying a predicate tree — **already canonical, untouched**

Not persisted, therefore no migration: Explore's filter, the Data Viewer's filter, and
subsets (confirmed 2026-08-03 — subsets appear in `services/export/*` and
`sessionSnapshot.js`, but nowhere in `services/persistence/`).

**Why read-time normalisation is mandatory rather than optional:** pipelines do not live
only in this browser's IndexedDB. They live in `.json` files the user exported to their own
disk, in client-side-encrypted cloud sync blobs, and inside other people's shared projects.
None of those can be reached by a migration script. So every step entering the runner
passes through `normalizeOp()`, and lazy re-canonicalisation on write means anything
re-saved comes back canonical for free.

**Permanent rule: an alias is never deleted.** The alias table is cheap and it is the only
reason a six-month-old exported `.json` still opens.

---

## 6 · Conversion order

Independently shippable slices.

| # | Change | User-visible |
|---|---|---|
| 1 | `predicate.js` (`OPERATORS`, `evalPredicate`, `normalizeOp`); `runner.js` delegates both `filter` shapes and `set_where` | **no** |
| 2 | `predicateToSQL` replaces `condToSQL`; throws on unknown op, caller falls back to the JS runner | **no** |
| 3 | `CleanTab` deletes its duplicate `evalPredicate`; its dropdown reads `OPERATORS` | minimal |
| 4 | Explore: `FILTER_OPS` → `OPERATORS` | yes — `=` becomes "equals" |
| 5 | SubsetManager → `OPERATORS`, plus operator mapping in the three subset exporters | yes — `==` becomes "equals" |
| 6 | Data Viewer: inline predicate → `predicate.js` | yes — labels |
| 7 | FeatureTab `if_else` / `case_when` → `OPERATORS` | yes |
| 8 | Help copy, plus `TOUR_STEPS` and `APP_CAPABILITY_MAP` review | yes |

Slices 1 and 2 are pure refactors with **zero user-visible change**, on purpose: if
something breaks there, it is the refactor and not the redesign.

---

## 7 · Deliverables that are easy to forget

### Help copy

CLAUDE.md's working convention requires the module's `HintBox` to be updated *in the same
change* that renames anything the user picks from the UI. This change renames operators on
four screens.

| HintBox | Why it changes |
|---|---|
| Data · `App.jsx:1292` | Data Viewer filter labels |
| Clean · `WranglingModule.jsx:744` | FilterBuilder, `vector_assign`, `if_else` |
| Explore · `ExplorerModule.jsx:2589` | already has a "Filter" section; light edit |
| Model · `components/ModelingTab.jsx:2117` | SubsetManager |

Plus one addition this change *creates the need for*: **Calculate's HintBox
(`CalculateTab.jsx:1537`) should state explicitly that `=` there means an equation, not a
comparison.** Nobody is confused today because the rest of the app is inconsistent and sets
no expectation. Once four screens say "equals" in unison, Calculate's `=` starts to look
like an oversight, and someone — a user, or us in six months — will try to "fix" it.

`TOUR_STEPS` and `APP_CAPABILITY_MAP` are reviewed for operator names; neither is expected
to need more than a check. Per project rule, **no counts are written into help prose**
("8 operators") — the things are named instead.

### Validation

The central guarantee is one sentence: **the JS path and the SQL path must return the same
row set.** Tested with one fixture per operator id, run through both `evalPredicate` and
`predicateToSQL`, comparing sets — extending
`src/pipeline/__validation__/pipelineReliabilityValidation.mjs`, which already carries
`filter` and `set_where` fixtures.

Three negative controls:

1. An unknown operator **must throw** in `predicateToSQL`. The test fails if it returns
   `TRUE` — that is today's bug, asserted against.
2. Fixtures written in every legacy spelling must produce identical results after
   `normalizeOp`.
3. `src/services/export/__validation__/replicationIntegrityValidation.mjs` extended so
   R / Python / Stata emit the correct operator per canonical id.

No browser validation (project rule): `npm run build` and `npm run lint:undef` green, the
`.mjs` harnesses run under node, and Franco does the browser pass.

---

## 8 · Follow-on: the Data Viewer autofilter (Spec 2)

Sequenced after this spec so it is built once, already speaking the canonical language.
Recorded here so the context is not lost:

- **Design decisions already taken with Franco (2026-08-03):** the header filter is a
  *view* filter, like the existing sort — it never touches the data or the export — with an
  explicit "add to pipeline" button that promotes the active filter stack into a real
  `filter` step. One uniform dropdown per column with two sections (value list on top,
  operators/range below), identical for every column type; on continuous columns the list
  shows "top 500 of N by frequency" and the user drops to the operators. The active filter
  stack feeds the bulk-edit `set_where` panel, replacing its private single-column filter.
- **Because the `filter` step already accepts a predicate tree with `in` / `nin` /
  `between`, promotion needs no new step type and no translator changes.** The checkbox
  list maps to `op: "in"`.
- **`set_where` will need to accept a predicate tree** in addition to its flat clause —
  the same dual-shape pattern `filter` already has — since the stack can hold several
  conditions.

**A shipping correctness bug this follow-on must fix, found 2026-08-03:**
`DataViewer` computes `pageRows` as `isDuck && !filterPredicate ? dbPageRows :
sortedRows.slice(...)` (`App.jsx:531`), and `filteredRows` comes from `rows.filter(...)`
where `rows` is `activeDs.rows` — the **500-row preview** for any DuckDB-backed dataset
(`PREVIEW_ROWS = 500`, `services/data/duckdb.js:31`). So filtering a 900k-row table today
filters the first 500 rows and presents the result as the whole table, with no banner.
`getTablePage` pushes `ORDER BY` into SQL for precisely this reason
(`duckdb.js:138-140`) but never received a `WHERE`. `ExplorerModule` already shows warning
banners for this same hazard; the Data Viewer has none. This is CLAUDE.md's "Display limit
≠ computation limit" rule being violated in shipped code, and any autofilter inherits and
amplifies it unless the `WHERE` is pushed into SQL.
