// ─── ECON STUDIO · scatterplot-matrix export validation ──────────────────────
//   node src/services/export/__validation__/scatterMatrixValidation.mjs
//
// Pins what each emitter must contain, including the two places where the
// script can silently disagree with what the app draws: Stata's `half` (lower
// triangle only) and the column list itself.

import { buildScatterMatrixScript } from "../scatterMatrixScript.js";

let pass = 0;
const failures = [];
const must = (label, text, needle) => {
  if (typeof text === "string" && text.includes(needle)) pass++;
  else failures.push(`${label}: expected ${JSON.stringify(needle)}\n    got: ${String(text).replace(/\n/g, "\n         ")}`);
};
const mustNot = (label, text, needle) => {
  if (typeof text === "string" && !text.includes(needle)) pass++;
  else failures.push(`${label}: must NOT contain ${JSON.stringify(needle)}`);
};

const cols = ["gdp", "infl", "ret"];

// R
must("R pairs call", buildScatterMatrixScript("r", cols, { upperCorr: false }), 'pairs(df[, c("gdp", "infl", "ret")])');
must("R upper.panel",  buildScatterMatrixScript("r", cols, { upperCorr: true }), "upper.panel = panel.cor");
must("R panel.cor defined before use", buildScatterMatrixScript("r", cols, { upperCorr: true }), "panel.cor <- function(x, y, ...)");
mustNot("R points view defines no unused helper", buildScatterMatrixScript("r", cols, { upperCorr: false }), "panel.cor");

// Python
const py = buildScatterMatrixScript("python", cols, { upperCorr: true });
must("py scatter_matrix", py, 'pd.plotting.scatter_matrix(df[["gdp", "infl", "ret"]], diagonal="hist"');
must("py figsize is a number pair", py, "figsize=(6, 6)");
must("py prints the correlations", py, ".corr()");
mustNot("py points view prints no correlations", buildScatterMatrixScript("python", cols, { upperCorr: false }), ".corr()");

// Stata — `half` must track the view, or the do-file draws a different matrix.
must("stata half with correlations above",  buildScatterMatrixScript("stata", cols, { upperCorr: true }),  "graph matrix gdp infl ret, half");
must("stata full matrix for the points view", buildScatterMatrixScript("stata", cols, { upperCorr: false }), "graph matrix gdp infl ret");
mustNot("stata points view is not halved", buildScatterMatrixScript("stata", cols, { upperCorr: false }), "half");
must("stata prints the correlations", buildScatterMatrixScript("stata", cols, { upperCorr: true }), "pwcorr gdp infl ret, sig");

// Degenerate input
for (const lang of ["r", "python", "stata"]) {
  if (buildScatterMatrixScript(lang, []) === "") pass++;
  else failures.push(`${lang}: no columns must emit nothing, not a call with an empty list`);
}
// Column names are quoted/escaped rather than pasted raw.
must("R quotes an awkward column", buildScatterMatrixScript("r", ["my col"], { upperCorr: false }), '"my col"');

console.log(`\nscatter-matrix export validation — ${pass} checks passed, ${failures.length} failed`);
if (failures.length) { for (const f of failures) console.log("  ✗ " + f); process.exit(1); }
console.log("✓ all green");
