// ─── ECON STUDIO · services/export/scatterMatrixScript.js ────────────────────
// Replication snippets for the Explore scatterplot matrix (R's pairs()).
//
// Separate from the component so the emitted code can be tested without a DOM —
// the plot emitters in plotScript.js live here for the same reason.

const rString = (v) => JSON.stringify(String(v));

export function buildScatterMatrixScript(lang, cols = [], { upperCorr = true } = {}) {
  if (!cols.length) return "";
  if (lang === "r") {
    const vec = `c(${cols.map(rString).join(", ")})`;
    if (!upperCorr) return [`# Scatterplot matrix`, `pairs(df[, ${vec}])`].join("\n");
    return [
      "# Scatterplot matrix with correlations above the diagonal",
      "# (panel.cor is the idiom from ?pairs)",
      "panel.cor <- function(x, y, ...) {",
      "  usr <- par(\"usr\"); on.exit(par(usr)); par(usr = c(0, 1, 0, 1))",
      "  r <- cor(x, y, use = \"pairwise.complete.obs\")",
      "  text(0.5, 0.5, format(round(r, 2), nsmall = 2), cex = 1 + abs(r))",
      "}",
      `pairs(df[, ${vec}], upper.panel = panel.cor)`,
    ].join("\n");
  }
  if (lang === "python") {
    const list = `[${cols.map(rString).join(", ")}]`;
    return [
      "# Scatterplot matrix",
      "import pandas as pd",
      "import matplotlib.pyplot as plt",
      `pd.plotting.scatter_matrix(df[${list}], diagonal="hist", figsize=(${2 * cols.length}, ${2 * cols.length}))`,
      ...(upperCorr ? [`print(df[${list}].corr())  # matplotlib has no upper-panel hook; the numbers print instead`] : []),
      "plt.show()",
    ].join("\n");
  }
  // Stata. `half` draws the lower triangle only — the right match for the
  // correlation-above-the-diagonal view, and wrong for the points-everywhere
  // one, where it would silently drop half the panels the app is showing.
  return [
    "* Scatterplot matrix",
    `graph matrix ${cols.join(" ")}${upperCorr ? ", half" : ""}`,
    ...(upperCorr ? [`* graph matrix has no upper-panel hook — the correlations print separately:`, `pwcorr ${cols.join(" ")}, sig`] : []),
  ].join("\n");
}
