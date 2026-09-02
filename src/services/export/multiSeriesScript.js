// ─── ECON STUDIO · services/export/multiSeriesScript.js ─────────────────────
// Replication snippets for the Explore multi-series chart (R's plot.zoo).
//
// Kept out of the component so the emitted code can be tested without a DOM.
//
// The aggregation matters: the chart plots one point per period, so a dataset
// with several rows per period is aggregated before it is drawn. A script that
// skipped that step would plot a different series from the same data.

const R_AGG  = { mean: "mean", sum: "sum", median: "median", count: "length" };
// count is not offered by the multi-series chart — the count per period is the
// same number for every variable, so every panel would be identical — but the
// emitters agree on it anyway: R's length and pandas' count both count the
// non-missing values per column.
const PY_AGG = { mean: "mean", sum: "sum", median: "median", count: "count" };
const ST_AGG = { mean: "mean", sum: "sum", median: "median", count: "count" };

const rStr  = (v) => JSON.stringify(String(v));
const rVec  = (cols) => `c(${cols.map(rStr).join(", ")})`;
const pyList = (cols) => `[${cols.map(rStr).join(", ")}]`;

export function buildMultiSeriesScript(lang, tCol, yCols = [], { agg = "mean" } = {}) {
  if (!tCol || !yCols.length) return "";

  if (lang === "r") {
    return [
      "# Multi-panel time-series plot — one panel per variable (zoo::plot.zoo)",
      '# requires: install.packages("zoo")',
      `agg <- aggregate(df[, ${rVec(yCols)}, drop = FALSE], by = list(${tCol} = df[[${rStr(tCol)}]]), FUN = ${R_AGG[agg] ?? "mean"})`,
      `z <- zoo::zoo(agg[, ${rVec(yCols)}, drop = FALSE], order.by = agg[[${rStr(tCol)}]])`,
      "plot(z, main = \"\", xlab = " + rStr(tCol) + ")",
    ].join("\n");
  }

  if (lang === "python") {
    return [
      "# Multi-panel time-series plot — one panel per variable",
      "import matplotlib.pyplot as plt",
      `_d = df.groupby(${rStr(tCol)})[${pyList(yCols)}].${PY_AGG[agg] ?? "mean"}().sort_index()`,
      `_d.plot(subplots=True, sharex=True, figsize=(8, ${Math.max(2, 1.6 * yCols.length).toFixed(1)}))`,
      "plt.tight_layout()",
      "plt.show()",
    ].join("\n");
  }

  // Stata has no single command for this: one tsline per variable, combined.
  // collapse destroys the data, so it runs inside preserve/restore.
  return [
    "* Multi-panel time-series plot — one panel per variable",
    "preserve",
    `collapse (${ST_AGG[agg] ?? "mean"}) ${yCols.join(" ")}, by(${tCol})` ,
    `tsset ${tCol}`,
    ...yCols.map(v => `tsline ${v}, name(g_${v}, replace) nodraw`),
    `graph combine ${yCols.map(v => `g_${v}`).join(" ")}, cols(1)`,
    "restore",
  ].join("\n");
}
