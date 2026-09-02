// ─── ECON STUDIO · multi-series (plot.zoo) export validation ─────────────────
//   node src/services/export/__validation__/multiSeriesValidation.mjs
//
// The trap this pins: the chart plots ONE point per period, so a dataset with
// several rows per period is aggregated before it is drawn. A script that
// skipped that step would run fine and plot a different series.

import { buildMultiSeriesScript } from "../multiSeriesScript.js";

let pass = 0;
const failures = [];
const must = (label, text, needle) => {
  if (typeof text === "string" && text.includes(needle)) pass++;
  else failures.push(`${label}: expected ${JSON.stringify(needle)}\n    got: ${String(text).replace(/\n/g, "\n         ")}`);
};

const cols = ["gdp", "infl"];

// Every language must aggregate, and must aggregate with the SAME function.
const AGG = { mean: ["mean", "mean", "mean"], sum: ["sum", "sum", "sum"], median: ["median", "median", "median"] };
for (const [agg, [r, py, st]] of Object.entries(AGG)) {
  must(`R aggregates (${agg})`,      buildMultiSeriesScript("r", "year", cols, { agg }),      `FUN = ${r}`);
  must(`py aggregates (${agg})`,     buildMultiSeriesScript("python", "year", cols, { agg }), `.${py}()`);
  must(`stata aggregates (${agg})`,  buildMultiSeriesScript("stata", "year", cols, { agg }),  `collapse (${st}) gdp infl, by(year)`);
}

const r = buildMultiSeriesScript("r", "year", cols);
must("R builds a zoo object", r, "zoo::zoo(");
must("R orders by the time column", r, 'order.by = agg[["year"]]');
must("R names the package requirement", r, "install.packages(\"zoo\")");

const py = buildMultiSeriesScript("python", "year", cols);
must("py one panel per variable", py, "subplots=True");
must("py shares the time axis", py, "sharex=True");
must("py sorts by period", py, ".sort_index()");

const st = buildMultiSeriesScript("stata", "year", cols);
must("stata sets the time index", st, "tsset year");
must("stata one tsline per variable", st, "tsline gdp, name(g_gdp, replace) nodraw");
must("stata stacks them in one column", st, "graph combine g_gdp g_infl, cols(1)");
// collapse destroys the data — without preserve/restore the do-file leaves the
// user with an aggregated dataset and no warning.
must("stata preserves the data", st, "preserve");
must("stata restores the data", st, "restore");
const stLines = st.split("\n");
if (stLines.indexOf("preserve") < stLines.findIndex(l => l.startsWith("collapse"))
 && stLines.lastIndexOf("restore") > stLines.findIndex(l => l.startsWith("graph combine"))) pass++;
else failures.push("stata: collapse and the graph must both sit inside preserve/restore");

// Degenerate input emits nothing rather than a call with an empty list.
for (const lang of ["r", "python", "stata"]) {
  if (buildMultiSeriesScript(lang, "year", []) === "" && buildMultiSeriesScript(lang, "", cols) === "") pass++;
  else failures.push(`${lang}: missing time column or variables must emit nothing`);
}

console.log(`\nmulti-series export validation — ${pass} checks passed, ${failures.length} failed`);
if (failures.length) { for (const f of failures) console.log("  ✗ " + f); process.exit(1); }
console.log("✓ all green");
