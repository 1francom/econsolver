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
// switch. `startswith` is the tell: it appears in every copy and nowhere else.
const ROGUE_EVAL = /(op|f\.op|node\.op)\s*===\s*["']startswith["']|case\s+["']startswith["']\s*:/;
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
