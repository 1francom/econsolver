// Guards the single-owner rule for the condition language.
//
// This app accumulated SEVEN implementations of "compare a column against
// something" — evalPredicate in runner.js, a duplicate of it in CleanTab,
// buildPredicate for set_where, condToSQL in duckdbRunner, the Data Viewer's
// inline closure, applySubsetFilter, and matchOne inside grouped_mutate — plus
// five different operator spellings shown to the user for the same operation.
//
// Every one of them looked like a small, reasonable local helper at the moment
// it was written. Only a repo-wide check keeps the eighth from appearing.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const SURFACES = [
  "src/components/data/ColumnFilterMenu.jsx",
  "src/components/wrangling/CleanTab.jsx",
  "src/components/wrangling/SubsetManager.jsx",
  "src/components/wrangling/FeatureTab.jsx",
  "src/ExplorerModule.jsx",
  "src/App.jsx",
];

const failures = [];

// A literal array of comparison-operator STRINGS, e.g. ["==","!=",">="] — the
// shape all five UI dialects had.
const ROGUE_ARRAY = /\[\s*"(==|!=|>=|<=|starts_with|is_null|equals|notempty)"/;
for (const f of SURFACES) {
  if (ROGUE_ARRAY.test(readFileSync(f, "utf8"))) {
    failures.push(`${f} declares its own operator list — import OPERATORS from pipeline/predicate.js instead`);
  }
}

// An array literal of CANONICAL operator ids. The guard originally keyed only on
// legacy spellings ("==", "is_null"), so when the Data Viewer grew a column
// autofilter it hardcoded `["eq","neq","contains",…]` next to the inline row's
// own `["eq","contains",…]` and the two drifted apart immediately — one had
// `in`, the other had `neq`/`gte`/`lte`. Surfaces read FILTER_OPS instead.
// A deliberate SUBSET is legitimate — SubsetManager offers six operators because
// the exporters cannot translate the rest, and that is documented where it
// happens. It must say so with this marker, so the difference between "chose a
// subset on purpose" and "quietly grew a second vocabulary" stays auditable.
const SUBSET_MARKER = "FILTER_OPS-SUBSET";
const ROGUE_ID_ARRAY = /\[\s*"(eq|neq|contains|startswith|endswith|isblank|notblank|gte|lte)"\s*,/;
for (const f of SURFACES) {
  const lines = readFileSync(f, "utf8").split("\n");
  lines.forEach((line, i) => {
    if (!ROGUE_ID_ARRAY.test(line)) return;
    const context = [lines[i - 2], lines[i - 1], line].join("\n");
    if (context.includes(SUBSET_MARKER)) return;
    failures.push(`${f}:${i + 1} hardcodes a list of operator ids — import FILTER_OPS from pipeline/predicate.js, or mark it ${SUBSET_MARKER} with the reason`);
  });
}

// A symbol/label MAP keyed by canonical ids, e.g. {eq:"=",neq:"≠",…}. This is
// the shape the guard originally missed: CleanTab's step-description builder had
// one, so a pipeline card read "country ≠ World" while the dropdown directly
// above it offered "!= not equals" — the exact inconsistency this work removes,
// surviving in the description text rather than the selector.
const ROGUE_MAP = /\{\s*eq\s*:\s*["']|\bneq\s*:\s*["']/;
for (const f of SURFACES) {
  if (ROGUE_MAP.test(readFileSync(f, "utf8"))) {
    failures.push(`${f} maps operator ids to its own labels — use opLabel/opSymbol/menuLabel from pipeline/predicate.js`);
  }
}

// Nobody outside predicate.js / predicateExport.js may implement the operator
// switch. The tell is a null-operator branch: every local matcher this project
// grew opened with `op === "notna"` / `op === "isna"`, and no other code has a
// reason to compare an `op` variable against those strings.
//
// An earlier version keyed on "startswith" instead and MISSED a copy — matchFilt
// inside grouped_mutate's expr branch, which had no string operators at all. It
// arrived through a merge, so the guard has to catch shapes it has not seen.
const ROGUE_EVAL = /\bop\s*===\s*["'](notna|isna)["']|case\s+["'](startswith|notna)["']\s*:/;
for (const f of [...SURFACES, "src/pipeline/duckdbRunner.js", "src/pipeline/runner.js"]) {
  if (ROGUE_EVAL.test(readFileSync(f, "utf8"))) {
    failures.push(`${f} evaluates operators locally — use evalPredicate from pipeline/predicate.js`);
  }
}

// The permissive default is the specific bug this spec removed four times: a
// filter that could not be expressed returned EVERY row and looked correct.
// predicate.js and predicateExport.js throw instead; nothing may reintroduce it.
const PERMISSIVE_DEFAULT = /default:\s*return\s+(true|"TRUE"|"True"|"1")\s*;/;
for (const f of ["src/pipeline/duckdbRunner.js", "src/pipeline/predicate.js", "src/pipeline/predicateExport.js"]) {
  if (PERMISSIVE_DEFAULT.test(readFileSync(f, "utf8"))) {
    failures.push(`${f} has a permissive default in an operator switch — it must throw, not match every row`);
  }
}

if (failures.length) {
  assert.fail("\n  " + failures.join("\n  ") + "\n");
}

console.log("no rogue operator dialects OK");
