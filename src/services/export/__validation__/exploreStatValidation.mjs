// ─── Explore-pin replication harness ─────────────────────────────────────────
// `node src/services/export/__validation__/exploreStatValidation.mjs`
// Every pinnable Explore kind must produce real R / Python / Stata code
// (non-empty, no undefined/[object Object]).

import { transpileExploreStat } from "../exploreStatScript.js";

let pass = 0, fail = 0;
const check = (n, c, extra) => {
  if (c) { pass++; console.log("  [pass]", n); }
  else   { fail++; console.log("  [FAIL]", n, extra != null ? "→ " + extra : ""); }
};
const GARBAGE = /undefined|\[object Object\]/;

const FIX = {
  summary:       { kind: "summary", columns: ["wage", "educ"], groupBy: "region" },
  head:          { kind: "head", n: 10 },
  tail:          { kind: "tail", n: 5 },
  histogram:     { kind: "histogram", col: "wage", bins: 30, transform: "log" },
  barchart:      { kind: "barchart", col: "region", order: "count" },
  spaghetti:     { kind: "spaghetti", col: "y", entityCol: "id", timeCol: "t" },
  timeseries:    { kind: "timeseries", yCol: "price", timeCol: "date", groupCol: "city", agg: "mean" },
  correlation:   { kind: "correlation", method: "pearson", cols: ["a", "b", "c"] },
  acf_pacf:      { kind: "acf_pacf", yCol: "gdp", timeCol: "year", maxLag: 12 },
  adf:           { kind: "adf", yCol: "gdp", timeCol: "year", lagOrder: 2 },
  overdispersion:{ kind: "overdispersion", col: "count", test: "cameron-trivedi" },
};

console.log("── explore pin → R / Python / Stata coverage ──");
for (const [kind, params] of Object.entries(FIX)) {
  for (const lang of ["r", "python", "stata"]) {
    const code = transpileExploreStat(params, lang, "df");
    const ok = typeof code === "string" && code.trim().length > 0 && !GARBAGE.test(code);
    check(`${lang}: ${kind}`, ok, code ? (code.split("\n").find(l => GARBAGE.test(l)) ?? (ok ? "" : "empty")) : "null");
  }
}

console.log("\n── active-filter note is prepended ──");
{
  const code = transpileExploreStat({ kind: "histogram", col: "x", bins: 10, filters: [{ col: "y", op: "gt", value: 0 }] }, "r", "df");
  check("filter note present", /active Explore filter/.test(code));
}

console.log("\n── transform variants ──");
check("log transform → log()",  /log\(wage\)/.test(transpileExploreStat({ kind: "histogram", col: "wage", transform: "log" }, "r", "df")));
check("sqrt transform → sqrt()", /sqrt\(wage\)/.test(transpileExploreStat({ kind: "histogram", col: "wage", transform: "sqrt" }, "r", "df")));

console.log(`\nexploreStat: ${pass} passed, ${fail} failed`);
if (fail > 0) process.exit(1);
