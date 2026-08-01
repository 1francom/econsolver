// ─── ECON STUDIO · pipeline/__validation__/groupExprValidation.mjs ──────────
// Guards aggregate-over-an-expression in `grouped_mutate` (feedback 2026-07-31,
// filed twice — "add any() to the conditional functions" and
// "mutate(treat = any(trarrprop != 0 & year == 2015))").
//
// Reference semantics are dplyr's: inside `mutate()` on a grouped frame, an
// aggregate collapses the group to one value and recycles it to every row, and
// its argument is evaluated ELEMENTWISE. The old evaluator injected columns as
// arrays, so the argument was evaluated once against an array — `any(...)`
// returned 0 for every group with no error at all.
//
// Run:  node src/pipeline/__validation__/groupExprValidation.mjs

import { runPipeline } from "../runner.js";
import { extractAggregateCalls, reduceAggregate, AGG_FNS } from "../groupExpr.js";

let pass = 0;
const failures = [];
function check(name, ok, detail = "") {
  if (ok) { pass++; return; }
  failures.push(`${name}${detail ? ` — ${detail}` : ""}`);
}

const H = ["unit", "year", "trarrprop", "wage", "tag"];
const ROWS = [
  { unit: "a", year: 2014, trarrprop: 0, wage: 10, tag: "x" },
  { unit: "a", year: 2015, trarrprop: 5, wage: 30, tag: "y" },
  { unit: "b", year: 2014, trarrprop: 0, wage: 20, tag: "x" },
  { unit: "b", year: 2015, trarrprop: 0, wage: 40, tag: "x" },
  { unit: "c", year: 2015, trarrprop: 7, wage: 50, tag: "z" },
];
const run = (expr, by = ["unit"], extra = {}) => runPipeline(ROWS, H, [{
  type: "grouped_mutate", by, fn: "expr", expr, newCol: "out", ...extra,
}], { datasets: {} }).rows;
const byUnit = rows => Object.fromEntries(rows.map(r => [r.unit, r.out]));

// ── T1: the exact expression from the report ───────────────────────────────
{
  const g = byUnit(run("any(trarrprop != 0 & year == 2015)"));
  check("T1 any() over a compound row expression",
    g.a === 1 && g.b === 0 && g.c === 1, JSON.stringify(g));
}

// ── T2: the value is recycled to EVERY row of the group, as in dplyr ───────
{
  const rows = run("any(trarrprop != 0 & year == 2015)");
  check("T2 recycled across all rows of the group",
    rows.filter(r => r.unit === "a").every(r => r.out === 1), JSON.stringify(rows.map(r => r.out)));
}

// ── T3: all() is the strict counterpart ────────────────────────────────────
{
  const g = byUnit(run("all(trarrprop == 0)"));
  check("T3 all()", g.a === 0 && g.b === 1 && g.c === 0, JSON.stringify(g));
}

// ── T4: sum/mean over an expression (dplyr's counting idiom) ──────────────
{
  const g = byUnit(run("sum(trarrprop > 0)"));
  check("T4 sum() counts matching rows", g.a === 1 && g.b === 0 && g.c === 1, JSON.stringify(g));
  const m = byUnit(run("mean(year == 2015)"));
  check("T4b mean() of a predicate is a share", m.a === 0.5 && m.b === 0.5 && m.c === 1, JSON.stringify(m));
}

// ── T5: plain column aggregates must keep working ─────────────────────────
// This is the path that was already correct; the transform must not break it.
{
  const g = byUnit(run("mean(wage)"));
  check("T5 mean(column) unchanged", g.a === 20 && g.b === 30 && g.c === 50, JSON.stringify(g));
  const s = byUnit(run("max(wage) - min(wage)"));
  check("T5b arithmetic across two aggregates", s.a === 20 && s.b === 20 && s.c === 0, JSON.stringify(s));
}

// ── T6: NESTED aggregate — inner is a group scalar, outer is row-level ────
// R: any(wage > mean(wage)) compares each row against the group mean.
{
  const g = byUnit(run("any(wage > mean(wage))"));
  check("T6 nested aggregate resolves inner-first",
    g.a === 1 && g.b === 1 && g.c === 0, JSON.stringify(g));
}

// ── T7: string comparison inside the aggregate ────────────────────────────
{
  const g = byUnit(run('any(tag == "y")'));
  check("T7 string equality inside any()", g.a === 1 && g.b === 0 && g.c === 0, JSON.stringify(g));
  // A quoted "any(" must not be mistaken for a call.
  const lit = extractAggregateCalls('x == "any(z)"');
  check("T7b aggregate name inside a string literal is not a call",
    lit.calls.length === 0, JSON.stringify(lit));
}

// ── T8: count() with no argument keeps the old group-helper behaviour ────
{
  const g = byUnit(run("count()"));
  check("T8 count() is group size", g.a === 2 && g.b === 2 && g.c === 1, JSON.stringify(g));
}

// ── T9: the step's own row filter narrows what the aggregate sees ────────
{
  const g = byUnit(run("any(trarrprop != 0)", ["unit"], { filter: [{ col: "year", op: "==", val: 2014 }] }));
  check("T9 filter applied before aggregation", g.a === 0 && g.b === 0, JSON.stringify(g));
}

// ── T10: multi-column grouping ───────────────────────────────────────────
{
  const rows = runPipeline(ROWS, H, [{
    type: "grouped_mutate", by: ["unit", "year"], fn: "expr",
    expr: "any(trarrprop != 0)", newCol: "out",
  }], { datasets: {} }).rows;
  check("T10 grouped by two columns",
    rows.map(r => r.out).join(",") === "0,1,0,0,1", rows.map(r => r.out).join(","));
}

// ── T11: extractor mechanics ─────────────────────────────────────────────
{
  const e = extractAggregateCalls("any(a > 1) + all(b < 2)");
  check("T11 two calls extracted", e.calls.length === 2, JSON.stringify(e.calls));
  check("T11b outer source is placeholder arithmetic",
    e.source === "__agg0__ + __agg1__", e.source);

  const nested = extractAggregateCalls("any(x > mean(x))");
  check("T11c nested: inner comes first in dependency order",
    nested.calls.length === 2 && nested.calls[0].name === "mean" && nested.calls[1].name === "any",
    JSON.stringify(nested.calls.map(c => c.name)));
  check("T11d outer call's argument references the inner placeholder",
    !!nested.calls[1]?.inner?.includes(nested.calls[0]?.placeholder), JSON.stringify(nested.calls[1] ?? null));

  check("T11e property access is not an aggregate",
    extractAggregateCalls("obj.any(1)").calls.length === 0);
  check("T11f count() with no argument is left alone",
    extractAggregateCalls("count()").calls.length === 0);
  check("T11g a non-aggregate function is untouched",
    extractAggregateCalls("log(wage)").calls.length === 0);
  check("T11h every advertised aggregate is recognised",
    AGG_FNS.every(f => f === "count" || extractAggregateCalls(`${f}(x)`).calls.length === 1),
    AGG_FNS.filter(f => f !== "count" && extractAggregateCalls(`${f}(x)`).calls.length !== 1).join(","));
}

// ── T12: reducer edge cases ──────────────────────────────────────────────
// "0"/"false" arrive as strings from a CSV round-trip; treating them as truthy
// would make any() true for every group holding a text 0/1 dummy.
{
  check("T12 string \"0\" is falsy", reduceAggregate("any", ["0", "0"]) === 0);
  check("T12b string \"false\" is falsy", reduceAggregate("any", ["false"]) === 0);
  check("T12c string \"1\" is truthy", reduceAggregate("any", ["0", "1"]) === 1);
  check("T12d all() on an empty group is 0, not vacuously 1", reduceAggregate("all", []) === 0);
  check("T12e mean of an empty group is null", reduceAggregate("mean", []) === null);
  check("T12f non-numerics excluded from mean", reduceAggregate("mean", [2, "x", 4]) === 3);
}

// ── T13: a broken expression yields null, never a crash ──────────────────
{
  const g = byUnit(run("any(nonexistent_col > 1)"));
  check("T13 unknown column degrades to null", g.a === null, JSON.stringify(g));
}

console.log(`groupExpr — ${pass} passed, ${failures.length} failed`);
failures.forEach(f => console.log(`  ✗ ${f}`));
process.exit(failures.length ? 1 : 0);
