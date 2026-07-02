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

// ─── CALLAWAY-SANT'ANNA GROUP-TIME ATT TABLE ───────────────────────────────
// Mirrors the Table tab in the CS DiD results panel (g, t, e, ATT, SE, 95% CI,
// p, pre/post). p-value convention matches the UI exactly: se === 0 with a
// non-zero ATT is a degenerate cell (p ~ 0, certain effect), only att ~ 0 with
// se === 0 is truly indeterminate (shown as "--").
export function attgtPValue(att, se) {
  if (att == null || se == null) return null;
  if (se === 0) return Math.abs(att) < 1e-9 ? null : 0;
  const z = Math.abs(att / se);
  if (!isFinite(z)) return null;
  const t = 1 / (1 + 0.2316419 * z);
  const dens = (1 / Math.sqrt(2 * Math.PI)) * Math.exp(-0.5 * z * z);
  const p = dens * t * (0.319381530 + t * (-0.356563782 + t * (1.781477937 + t * (-1.821255978 + t * 1.330274429))));
  return Math.min(2 * p, 1);
}

/**
 * Generate a LaTeX table of Callaway & Sant'Anna (2021) group-time ATT(g,t)
 * estimates, matching the app's Table tab.
 *
 * @param {Array<{g,t,att,se,isPre}>} attgt
 * @param {number} critVal  — critical value used for the CI (e.g. 1.96)
 * @param {string} yVar
 * @returns {string} LaTeX table source
 */
export function buildAttgtLatex(attgt = [], critVal = 1.96, yVar = "y") {
  const fmtP = p => (p == null ? "--" : p < 0.001 ? "$<$0.001" : p.toFixed(4));
  const rows = attgt.map(c => {
    const e = c.e != null ? c.e : (c.t != null && c.g != null ? c.t - c.g : "--");
    const att = c.att != null && isFinite(c.att) ? c.att.toFixed(4) : "N/A";
    const se  = c.se  != null && isFinite(c.se)  ? c.se.toFixed(4)  : "N/A";
    const ci  = c.att != null && c.se != null
      ? `[${(c.att - critVal * c.se).toFixed(3)}, ${(c.att + critVal * c.se).toFixed(3)}]`
      : "--";
    const p = attgtPValue(c.att, c.se);
    const pFmt = fmtP(p) + (p != null ? stars(p) : "");
    const prePost = c.isPre ? "pre" : "post";
    return `  ${c.g} & ${c.t} & ${e} & ${att} & ${se} & ${ci} & ${pFmt} & ${prePost} \\\\`;
  }).join("\n");

  return `% Generated by Litux · LMU Munich
\\begin{table}[htbp]
\\centering
\\caption{Callaway \\& Sant'Anna (2021) Group-Time ATT: \\texttt{${yVar.replace(/_/g, "\\_")}}}
\\label{tab:callaway_attgt}
\\begin{tabular}{llrrrlll}
\\hline\\hline
$g$ & $t$ & $e$ & ATT & SE & 95\\% CI & $p$ & Period \\\\
\\hline
${rows}
\\hline
\\multicolumn{8}{l}{\\textit{Note: }$e = t - g$ is event time; SE $=0$ with a non-zero ATT indicates a} \\\\
\\multicolumn{8}{l}{degenerate (zero-variance) cell, not an untested effect.} \\\\
\\multicolumn{8}{l}{Significance codes: *$p<0.1$, **$p<0.05$, ***$p<0.01$} \\\\
\\hline
\\end{tabular}
\\end{table}`;
}
