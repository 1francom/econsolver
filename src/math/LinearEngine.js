// ─── ECON STUDIO · src/math/LinearEngine.js ───────────────────────────────────
// Pure math. No React. No side effects.
// Owns: matrix algebra, core statistics, OLS engine, diagnostics, export helpers.

// ─── MATRIX ALGEBRA ──────────────────────────────────────────────────────────
export function transpose(M) {
  return M[0].map((_, c) => M.map(r => r[c]));
}

export function matMul(A, B) {
  return A.map(r => B[0].map((_, j) => r.reduce((s, v, k) => s + v * B[k][j], 0)));
}

export function matInv(M) {
  const n = M.length;
  const aug = M.map((row, i) => [
    ...row,
    ...Array(n).fill(0).map((_, j) => (i === j ? 1 : 0)),
  ]);
  for (let col = 0; col < n; col++) {
    let max = col;
    for (let r = col + 1; r < n; r++)
      if (Math.abs(aug[r][col]) > Math.abs(aug[max][col])) max = r;
    [aug[col], aug[max]] = [aug[max], aug[col]];
    const piv = aug[col][col];
    if (Math.abs(piv) < 1e-12) return null;
    aug[col] = aug[col].map(v => v / piv);
    for (let r = 0; r < n; r++) {
      if (r === col) continue;
      const f = aug[r][col];
      aug[r] = aug[r].map((v, c) => v - f * aug[col][c]);
    }
  }
  return aug.map(row => row.slice(n));
}

// ─── STATISTICS ───────────────────────────────────────────────────────────────
function lgamma(z) {
  const c = [
    76.18009172947146, -86.50532032941677, 24.01409824083091,
    -1.231739572450155, 0.1208650973866179e-2, -0.5395239384953e-5,
  ];
  let x = z, y = z, tmp = x + 5.5;
  tmp -= (x + 0.5) * Math.log(tmp);
  let ser = 1.000000000190015;
  for (const ci of c) ser += ci / ++y;
  return -tmp + Math.log(2.5066282746310005 * ser / x);
}

export function tCDF(t, df) {
  const x = df / (df + t * t);
  const a = df / 2, b = 0.5;
  let ib = 0;
  const steps = 2000;
  for (let i = 0; i < steps; i++) {
    const xi = x * (i + 0.5) / steps;
    ib += Math.pow(xi, a - 1) * Math.pow(1 - xi, b - 1);
  }
  ib *= x / steps;
  const beta = Math.exp(lgamma(a) + lgamma(b) - lgamma(a + b));
  return Math.min(1, Math.max(0, ib / beta));
}

export function fCDF(F, df1, df2) {
  const x = df2 / (df2 + df1 * F);
  const a = df2 / 2, b = df1 / 2;
  let ib = 0;
  const steps = 2000;
  for (let i = 0; i < steps; i++) {
    const xi = x * (i + 0.5) / steps;
    ib += Math.pow(xi, a - 1) * Math.pow(1 - xi, b - 1);
  }
  ib *= x / steps;
  const beta = Math.exp(lgamma(a) + lgamma(b) - lgamma(a + b));
  return Math.min(1, Math.max(0, ib / beta));
}

export function pValue(t, df) {
  return Math.min(1, 2 * tCDF(Math.abs(t), df));
}

export function stars(p) {
  return p < 0.01 ? "***" : p < 0.05 ? "**" : p < 0.1 ? "*" : "";
}

// ─── OLS ENGINE ───────────────────────────────────────────────────────────────
// Returns { beta, se, tStats, pVals, R2, adjR2, n, df, SSR, s2, resid, Yhat,
//           Fstat, Fpval, varNames }
export function runOLS(rows, yCol, xCols) {
  const valid = rows.filter(r =>
    typeof r[yCol] === "number" && isFinite(r[yCol]) &&
    xCols.every(c => typeof r[c] === "number" && isFinite(r[c]))
  );
  if (valid.length < xCols.length + 2) return null;
  const n = valid.length;
  const Y = valid.map(r => r[yCol]);
  const X = valid.map(r => [1, ...xCols.map(c => r[c])]);
  const Xt = transpose(X);
  const XtXinv = matInv(matMul(Xt, X));
  if (!XtXinv) return null;
  const beta = matMul(XtXinv, matMul(Xt, Y.map(v => [v]))).map(r => r[0]);
  const Yhat = X.map(row => row.reduce((s, v, i) => s + v * beta[i], 0));
  const resid = Y.map((y, i) => y - Yhat[i]);
  const SSR = resid.reduce((s, e) => s + e * e, 0);
  const df = n - xCols.length - 1;
  const s2 = SSR / Math.max(1, df);
  const Ym = Y.reduce((a, b) => a + b, 0) / n;
  const SST = Y.reduce((s, y) => s + (y - Ym) ** 2, 0);
  const R2 = 1 - SSR / SST;
  const adjR2 = 1 - (1 - R2) * (n - 1) / Math.max(1, df);
  const se = XtXinv.map((row, i) => Math.sqrt(Math.abs(row[i] * s2)));
  const tStats = beta.map((b, i) => b / se[i]);
  const pVals = tStats.map(t => pValue(t, df));
  const Fstat = ((SST - SSR) / xCols.length) / s2;
  const Fpval = fCDF(Fstat, xCols.length, df);
  const varNames = ["(Intercept)", ...xCols];
  return { beta, se, tStats, pVals, R2, adjR2, n, df, SSR, s2, resid, Yhat, Fstat, Fpval, varNames };
}

// ─── WLS ENGINE ──────────────────────────────────────────────────────────────
// Weighted Least Squares: β = (X'WX)⁻¹X'WY
// weights: array of non-negative numbers, one per row (e.g. sampling weights).
// Rows with weight ≤ 0 or non-finite weight are excluded.
// Returns same shape as runOLS plus { weightCol } for display.
export function runWLS(rows, yCol, xCols, weights) {
  const valid = rows
    .map((r, i) => ({ r, w: weights?.[i] ?? 1 }))
    .filter(({ r, w }) =>
      typeof r[yCol] === "number" && isFinite(r[yCol]) &&
      xCols.every(c => typeof r[c] === "number" && isFinite(r[c])) &&
      isFinite(w) && w > 0
    );
  if (valid.length < xCols.length + 2) return null;

  const n  = valid.length;
  const Y  = valid.map(({ r }) => r[yCol]);
  const X  = valid.map(({ r }) => [1, ...xCols.map(c => r[c])]);
  const W  = valid.map(({ w }) => w);  // raw weights

  // Build X'WX and X'WY
  const k = X[0].length;
  const XtWX = Array.from({ length: k }, () => Array(k).fill(0));
  const XtWY = Array(k).fill(0);
  for (let i = 0; i < n; i++) {
    const wi = W[i];
    for (let j = 0; j < k; j++) {
      XtWY[j] += wi * X[i][j] * Y[i];
      for (let l = 0; l < k; l++) XtWX[j][l] += wi * X[i][j] * X[i][l];
    }
  }

  const XtWXinv = matInv(XtWX);
  if (!XtWXinv) return null;

  const beta = XtWXinv.map((row) => row.reduce((s, v, j) => s + v * XtWY[j], 0));
  const Yhat = X.map(row => row.reduce((s, v, i) => s + v * beta[i], 0));
  const resid = Y.map((y, i) => y - Yhat[i]);

  // σ² uses UNWEIGHTED SSR / df (HC-consistent; do NOT weight SSR)
  const SSR = resid.reduce((s, e) => s + e * e, 0);
  const df  = n - k;
  const s2  = SSR / Math.max(1, df);

  // Weighted R² — compare weighted SST vs weighted SSR
  const Yw_mean = W.reduce((s, w, i) => s + w * Y[i], 0) / W.reduce((s, w) => s + w, 0);
  const SST_w   = Y.reduce((s, y, i) => s + W[i] * (y - Yw_mean) ** 2, 0);
  const SSR_w   = resid.reduce((s, e, i) => s + W[i] * e * e, 0);
  const R2      = SST_w > 0 ? 1 - SSR_w / SST_w : 0;
  const adjR2   = 1 - (1 - R2) * (n - 1) / Math.max(1, df);

  const se     = XtWXinv.map((row, i) => Math.sqrt(Math.abs(row[i] * s2)));
  const tStats = beta.map((b, i) => b / se[i]);
  const pVals  = tStats.map(t => pValue(t, df));
  const Fstat  = ((SST_w - SSR_w) / (k - 1)) / (SSR_w / Math.max(1, df));
  const Fpval  = fCDF(Fstat, k - 1, df);
  const varNames = ["(Intercept)", ...xCols];

  return { beta, se, tStats, pVals, R2, adjR2, n, df, SSR, s2, resid, Yhat, Fstat, Fpval, varNames };
}



// ─── DIAGNOSTICS ─────────────────────────────────────────────────────────────

// Breusch-Pagan test for heteroskedasticity (H0: homoskedastic)
export function breuschPagan(resid, Yhat) {
  const n = resid.length;
  const e2 = resid.map(e => e * e);
  const e2mean = e2.reduce((a, b) => a + b, 0) / n;
  const res = runOLS(
    Yhat.map((y, i) => ({ __yhat: y, __e2: e2[i] })),
    "__e2",
    ["__yhat"]
  );
  if (!res) return null;
  const LM = n * res.R2;
  const pVal = Math.exp(-LM / 2);
  return {
    LM: LM.toFixed(3),
    pVal: Math.min(1, pVal * 2).toFixed(4),
    reject: pVal * 2 < 0.05,
  };
}

// VIF — Variance Inflation Factor for multicollinearity
export function computeVIF(rows, xCols) {
  if (xCols.length < 2) return xCols.map(c => ({ col: c, vif: 1 }));
  return xCols.map((col, i) => {
    const others = xCols.filter((_, j) => j !== i);
    const res = runOLS(rows, col, others);
    if (!res || res.R2 >= 1) return { col, vif: Infinity };
    return { col, vif: 1 / (1 - res.R2) };
  });
}

// Hausman test: FE vs FD consistency check
export function hausmanTest(fe, fd, xCols) {
  if (!fe || !fd) return null;
  try {
    const diff = fe.beta.map((b, i) => b - (fd.beta[i] ?? 0));
    const varDiff = fe.se.map((s, i) => Math.max(0, s ** 2 - (fd.se[i] ?? 0) ** 2));
    const H = diff.reduce(
      (s, d, i) => s + (varDiff[i] > 1e-10 ? d ** 2 / varDiff[i] : 0),
      0
    );
    const df = xCols.length;
    const pVal = Math.exp(-H / 2);
    return { H: H.toFixed(3), df, pVal: Math.min(1, pVal).toFixed(4) };
  } catch {
    return null;
  }
}

// ─── EXPORT HELPERS ──────────────────────────────────────────────────────────
export function buildLatex(yVar, xVars, results, model = "OLS") {
  const vars = results.varNames || ["(Intercept)", ...xVars];
  const fmtP = p => (p == null ? "N/A" : p < 0.001 ? "<0.001" : p.toFixed(4));
  const rows = vars.map((v, i) => {
    const b  = results.beta?.[i];
    const se = results.se?.[i];
    const t  = results.tStats?.[i];
    const p  = results.pVals?.[i];
    const bFmt  = b  != null && isFinite(b)  ? b.toFixed(4)  : "N/A";
    const seFmt = se != null && isFinite(se) ? se.toFixed(4) : "N/A";
    const tFmt  = t  != null && isFinite(t)  ? t.toFixed(3)  : "N/A";
    const pFmt  = fmtP(p);
    const strs  = p != null ? stars(p) : "";
    return `  ${v.replace(/_/g, "\\_")} & ${bFmt}${strs} & ${seFmt} & ${tFmt} & ${pFmt} \\\\`;
  }).join("\n");
  return `\\begin{table}[htbp]
\\centering
\\caption{${model} Results: \\texttt{${yVar}}}
\\begin{tabular}{lrrrr}
\\hline\\hline
Variable & Estimate & Std. Error & t-value & Pr($>|t|$) \\\\
\\hline
${rows}
\\hline
\\multicolumn{5}{l}{$R^2 = ${results.R2?.toFixed(4) ?? "N/A"}$, Adj. $R^2 = ${results.adjR2?.toFixed(4) ?? "N/A"}$, $n = ${results.n ?? "N/A"}$} \\\\
\\multicolumn{5}{l}{Significance: *$p<0.1$, **$p<0.05$, ***$p<0.01$} \\\\
\\hline
\\end{tabular}
\\end{table}`;
}

export function buildCSVExport(yVar, results) {
  const vars = results.varNames || [];
  const header = "variable,estimate,std_error,t_value,p_value,sig";
  const rows = vars.map((v, i) => {
    const b  = results.beta?.[i];
    const se = results.se?.[i];
    const t  = results.tStats?.[i];
    const p  = results.pVals?.[i];
    return [
      v,
      b  != null ? b.toFixed(6)  : "NA",
      se != null ? se.toFixed(6) : "NA",
      t  != null ? t.toFixed(6)  : "NA",
      p  != null ? p.toFixed(6)  : "NA",
      p  != null ? stars(p)      : "",
    ].join(",");
  });
  return [
    header, ...rows, "",
    "# Fit",
    `r_squared,${results.R2?.toFixed(6) ?? "NA"}`,
    `adj_r_squared,${results.adjR2?.toFixed(6) ?? "NA"}`,
    `n,${results.n ?? "NA"}`,
  ].join("\n");
}

export function downloadText(content, filename) {
  const blob = new Blob([content], { type: "text/plain" });
  const url  = URL.createObjectURL(blob);
  const a    = document.createElement("a");
  a.href = url; a.download = filename; a.click();
  URL.revokeObjectURL(url);
}
