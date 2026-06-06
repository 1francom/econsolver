// ─── LITUX · services/export/latexTable.js ─────────────────────────────
// Stargazer-style LaTeX table generator.
// Pure JS, no React, no side effects.
//
// buildStargazer(models, options?) → string
//   models:  [{ label: string, result: EstimationResult, yVar: string }]
//   options: { showFirstStage?: boolean }
//
// Produces a \begin{table} ... \end{table} block ready to paste into LaTeX.
// Requires \usepackage{booktabs} if \toprule is desired; uses \hline by default.

import { stars } from "../../math/index.js";

/**
 * Generate a Stargazer-style LaTeX table for one or more models.
 *
 * @param {Array<{label: string, result: object, yVar: string}>} models
 * @param {{ showFirstStage?: boolean }} options
 * @returns {string} LaTeX table source
 */
export function buildStargazer(models, options = {}) {
  const { showFirstStage = false, varLabels = {} } = options;

  const fmtB = (b, p) => {
    if (b == null || !isFinite(b)) return "        N/A";
    return `${b >= 0 ? " " : ""}${b.toFixed(4)}${stars(p ?? 1)}`.padStart(12);
  };
  const fmtSE = se => {
    if (se == null || !isFinite(se)) return "      (N/A)";
    return `(${se.toFixed(4)})`.padStart(12);
  };
  const dash = "            ";
  const sep  = " & ";

  const colsN  = models.length;
  const colFmt = "l" + " r".repeat(colsN);

  // ─── Column headers ───────────────────────────────────────────────────────
  const header = ["Variable", ...models.map((m, i) => `(${i + 1}) ${m.label}`)];

  // ─── Second-stage variable union (non-intercept) ──────────────────────────
  const allVars = [];
  models.forEach(({ result: r }) => {
    (r.varNames ?? []).forEach(v => {
      if (v !== "(Intercept)" && !allVars.includes(v)) allVars.push(v);
    });
  });

  function modelVal(m, varName, key) {
    const idx = (m.result.varNames ?? []).indexOf(varName);
    if (idx < 0) return dash;
    const r = m.result;
    const b = r.beta?.[idx], p = r.pVals?.[idx], se = r.se?.[idx];
    if (key === "b")  return fmtB(b, p);
    if (key === "se") return fmtSE(se);
    return dash;
  }

  const rows = [];

  // ─── First-stage section ──────────────────────────────────────────────────
  // Shown when showFirstStage=true and at least one model is 2SLS/GMM with data.
  const ivModels = showFirstStage
    ? models.filter(m => m.result.firstStages?.length && m.result.spec?.zVars?.length)
    : [];

  if (ivModels.length > 0) {
    // Union of instrument names across all IV models
    const instrVars = [];
    ivModels.forEach(m => {
      (m.result.spec.zVars ?? []).forEach(z => {
        if (!instrVars.includes(z)) instrVars.push(z);
      });
    });

    // If multiple endogenous variables exist, group by endogenous var.
    // Most common case: one endogenous variable — no sub-header needed.
    const maxEndog = Math.max(...ivModels.map(m => m.result.firstStages.length));
    const endogNames = ivModels[0].result.firstStages.map(fs => fs.endVar ?? "");

    for (let j = 0; j < maxEndog; j++) {
      const endogLabel = maxEndog > 1
        ? `\\textit{First Stage: \\texttt{${(endogNames[j] ?? "").replace(/_/g, "\\_")}}}`
        : `\\textit{First Stage}`;

      rows.push(`  \\multicolumn{${colsN + 1}}{l}{${endogLabel}} \\\\`);
      rows.push(`  \\hline`);

      instrVars.forEach(instrVar => {
        const label = instrVar.replace(/_/g, "\\_");

        const bRow = models.map(m => {
          const fs = m.result.firstStages?.[j];
          if (!fs) return dash;
          const idx = (fs.varNames ?? []).indexOf(instrVar);
          return idx < 0 ? dash : fmtB(fs.beta?.[idx], fs.pVals?.[idx]);
        });
        const seRow = models.map(m => {
          const fs = m.result.firstStages?.[j];
          if (!fs) return dash;
          const idx = (fs.varNames ?? []).indexOf(instrVar);
          return idx < 0 ? dash : fmtSE(fs.se?.[idx]);
        });

        rows.push(`  ${label}${sep}${bRow.join(sep)} \\\\`);
        rows.push(`  ${" ".repeat(label.length)}${sep}${seRow.join(sep)} \\\\`);
      });

      // First-stage F-stat row
      const fRow = models.map(m => {
        const fs = m.result.firstStages?.[j];
        if (!fs?.Fstat) return dash;
        return `${fs.Fstat.toFixed(2)}${fs.weak ? "\\dag" : ""}`.padStart(12);
      });
      rows.push(`  \\textit{F-stat}${sep}${fRow.join(sep)} \\\\`);

      rows.push(`  \\hline`);
    }

    rows.push(`  \\multicolumn{${colsN + 1}}{l}{\\textit{Second Stage}} \\\\`);
    rows.push(`  \\hline`);
  }

  // ─── Main regressors ──────────────────────────────────────────────────────
  allVars.forEach(v => {
    const display = varLabels[v] ?? v;
    const label = display.replace(/_/g, "\\_");
    rows.push(`  ${label}${sep}${models.map(m => modelVal(m, v, "b")).join(sep)} \\\\`);
    rows.push(`  ${" ".repeat(label.length)}${sep}${models.map(m => modelVal(m, v, "se")).join(sep)} \\\\`);
  });

  // Intercept always last
  const intV = "(Intercept)";
  rows.push(`  \\hline`);
  rows.push(`  Intercept${sep}${models.map(m => modelVal(m, intV, "b")).join(sep)} \\\\`);
  rows.push(`  ${" ".repeat(9)}${sep}${models.map(m => modelVal(m, intV, "se")).join(sep)} \\\\`);

  // ─── Fit stats ────────────────────────────────────────────────────────────
  rows.push(`  \\hline`);
  rows.push(`  $R^2$${sep}${models.map(m =>
    (m.result.R2 != null && isFinite(m.result.R2)) ? m.result.R2.toFixed(4).padStart(12) : dash).join(sep)} \\\\`);
  rows.push(`  Adj. $R^2$${sep}${models.map(m =>
    (m.result.adjR2 != null && isFinite(m.result.adjR2)) ? m.result.adjR2.toFixed(4).padStart(12) : dash).join(sep)} \\\\`);
  rows.push(`  $n$${sep}${models.map(m =>
    m.result.n != null ? String(m.result.n).padStart(12) : dash).join(sep)} \\\\`);

  const yVarDisplay = models.map(m => `\\texttt{${(m.yVar ?? "y").replace(/_/g, "\\_")}}`);
  const caption = colsN === 1
    ? `Regression Results: ${yVarDisplay[0]}`
    : `Regression Results`;

  const footerNote = ivModels.length > 0
    ? [
        `\\multicolumn{${colsN + 1}}{l}{\\textit{Note: }Standard errors in parentheses. $\\dag$ weak instrument ($F<10$).} \\\\`,
        `\\multicolumn{${colsN + 1}}{l}{Significance codes: *$p<0.1$, **$p<0.05$, ***$p<0.01$} \\\\`,
      ]
    : [
        `\\multicolumn{${colsN + 1}}{l}{\\textit{Note: }Standard errors in parentheses.} \\\\`,
        `\\multicolumn{${colsN + 1}}{l}{Significance codes: *$p<0.1$, **$p<0.05$, ***$p<0.01$} \\\\`,
      ];

  return [
    `% Generated by Litux · LMU Munich`,
    `\\begin{table}[htbp]`,
    `\\centering`,
    `\\caption{${caption}}`,
    `\\label{tab:results}`,
    `\\begin{tabular}{${colFmt}}`,
    `\\hline\\hline`,
    header.map(h => h.replace(/_/g, "\\_")).join(sep) + " \\\\",
    `\\hline`,
    ...rows,
    `\\hline`,
    ...footerNote,
    `\\hline`,
    `\\end{tabular}`,
    `\\end{table}`,
  ].join("\n");
}
