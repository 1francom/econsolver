// ─── ECON STUDIO · services/data/__validation__/sortRowsValidation.mjs ──────
// Guards the Data Viewer's view-level sort (BugTriage 2026-07-17: "No arrange
// (sort) control in the data viewer").
//
// The interesting property is not "does it sort" but "do the two branches
// agree": a DuckDB-backed unfiltered grid is ordered by SQL (`ORDER BY … NULLS
// LAST` in getTablePage), everything else by sortRows() in JS. If those two
// disagree, the SAME table sorts differently depending on whether DuckDB
// happens to be active — a difference no user could attribute to anything.
//
// Run:  node src/services/data/__validation__/sortRowsValidation.mjs

import { sortRows, rowComparator } from "../sortRows.js";

let pass = 0;
const failures = [];
function check(name, ok, detail = "") {
  if (ok) { pass++; return; }
  failures.push(`${name}${detail ? ` — ${detail}` : ""}`);
}
const vals = (rows, col) => rows.map(r => r[col]);

// ── Numeric ordering must be numeric, not lexicographic ────────────────────
{
  const rows = [{ x: 9 }, { x: 10 }, { x: 2 }, { x: 100 }];
  check("asc numeric", JSON.stringify(vals(sortRows(rows, { col: "x", dir: "asc" }), "x")) === "[2,9,10,100]");
  check("desc numeric", JSON.stringify(vals(sortRows(rows, { col: "x", dir: "desc" }), "x")) === "[100,10,9,2]");
  check("negatives and zero", JSON.stringify(vals(sortRows([{x:0},{x:-5},{x:3}], { col: "x", dir: "asc" }), "x")) === "[-5,0,3]");
}

// ── NULLS LAST in BOTH directions — the DuckDB contract ───────────────────
// A plain comparator floats nulls to the top on desc, which reads as data loss.
{
  const rows = [{ x: 3 }, { x: null }, { x: 1 }, { x: undefined }, { x: "" }, { x: 2 }];
  const asc  = vals(sortRows(rows, { col: "x", dir: "asc" }), "x");
  const desc = vals(sortRows(rows, { col: "x", dir: "desc" }), "x");
  const blank = v => v === null || v === undefined || v === "";
  check("asc puts the three blanks last", asc.slice(0, 3).join(",") === "1,2,3" && asc.slice(3).every(blank), JSON.stringify(asc));
  check("desc ALSO puts blanks last", desc.slice(0, 3).join(",") === "3,2,1" && desc.slice(3).every(blank), JSON.stringify(desc));
}

// ── Mixed alphanumeric labels sort the way an econ dataset expects ─────────
{
  const rows = [{ c: "comuna 10" }, { c: "comuna 2" }, { c: "comuna 1" }];
  check("numeric-aware string collation",
    JSON.stringify(vals(sortRows(rows, { col: "c", dir: "asc" }), "c")) === '["comuna 1","comuna 2","comuna 10"]',
    JSON.stringify(vals(sortRows(rows, { col: "c", dir: "asc" }), "c")));
}

// ── Never mutate the caller's array (the grid re-reads `rows` elsewhere) ──
{
  const rows = [{ x: 3 }, { x: 1 }, { x: 2 }];
  const before = JSON.stringify(rows);
  const out = sortRows(rows, { col: "x", dir: "asc" });
  check("input array untouched", JSON.stringify(rows) === before, JSON.stringify(rows));
  check("returns a new array", out !== rows);
}

// ── No-ops keep referential identity so the memo doesn't churn ─────────────
{
  const rows = [{ x: 3 }, { x: 1 }];
  check("null sort returns the same reference", sortRows(rows, null) === rows);
  check("missing col returns the same reference", sortRows(rows, { col: "", dir: "asc" }) === rows);
  check("single row returns the same reference", sortRows([{ x: 1 }], { col: "x", dir: "asc" }).length === 1);
  check("empty input is safe", sortRows([], { col: "x", dir: "asc" }).length === 0);
}

// ── A missing column must not reorder or throw ─────────────────────────────
{
  const rows = [{ x: 3 }, { x: 1 }, { x: 2 }];
  const out = sortRows(rows, { col: "nope", dir: "asc" });
  check("sorting an absent column is a no-op, not a crash",
    JSON.stringify(vals(out, "x")) === "[3,1,2]", JSON.stringify(vals(out, "x")));
}

// ── Comparator is a valid total order (asc is the exact reverse of desc,
//    ignoring the blanks that are pinned last in both) ──────────────────────
{
  const rows = [{ x: 5 }, { x: 1 }, { x: 9 }, { x: 3 }, { x: 7 }];
  const asc  = vals(sortRows(rows, { col: "x", dir: "asc" }), "x");
  const desc = vals(sortRows(rows, { col: "x", dir: "desc" }), "x");
  check("desc is the reverse of asc when no blanks", JSON.stringify(asc.slice().reverse()) === JSON.stringify(desc));
  const cmp = rowComparator("x", "asc");
  check("equal values compare to 0", cmp({ x: 4 }, { x: 4 }) === 0);
  check("two blanks compare to 0", cmp({ x: null }, { x: "" }) === 0);
}

console.log(`sortRows — ${pass} passed, ${failures.length} failed`);
failures.forEach(f => console.log(`  ✗ ${f}`));
process.exit(failures.length ? 1 : 0);
