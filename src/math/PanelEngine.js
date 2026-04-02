// ─── ECON STUDIO · src/math/PanelEngine.js ────────────────────────────────────
// Panel-data estimators: Fixed Effects (within), First Differences, DiD 2×2, TWFE.
// No React. No side effects. Depends only on LinearEngine.js.

import {
  transpose, matMul, matInv,
  runOLS, pValue, fCDF, stars,
} from "./LinearEngine.js";

// ─── INTERNAL HELPERS ────────────────────────────────────────────────────────

/**
 * Filter + sort rows for panel estimation.
 * Groups by unitCol, then sorts by timeCol within each group.
 */
function prepPanel(rows, yCol, xCols, unitCol, timeCol) {
  const valid = rows
    .filter(r =>
      typeof r[yCol] === "number" && isFinite(r[yCol]) &&
      r[unitCol] != null && r[timeCol] != null &&
      xCols.every(x => typeof r[x] === "number" && isFinite(r[x]))
    )
    .sort((a, b) => {
      if (a[unitCol] < b[unitCol]) return -1;
      if (a[unitCol] > b[unitCol]) return  1;
      return a[timeCol] - b[timeCol];
    });
  const units = [...new Set(valid.map(r => r[unitCol]))];
  const times = [...new Set(valid.map(r => r[timeCol]))].sort((a, b) => a - b);
  return { valid, units, times };
}

// ─── FIXED EFFECTS (WITHIN) ──────────────────────────────────────────────────
export function runFE(rows, yCol, xCols, unitCol, timeCol) {
  const { valid, units } = prepPanel(rows, yCol, xCols, unitCol, timeCol);
  if (valid.length < xCols.length + 3 || units.length < 2)
    return { error: "Insufficient observations or units for Fixed Effects estimation." };

  const allCols = [yCol, ...xCols];

  // Unit means (for within-transformation)
  const unitMeans = {};
  units.forEach(u => {
    const sub = valid.filter(r => r[unitCol] === u);
    unitMeans[u] = {};
    allCols.forEach(c => {
      unitMeans[u][c] = sub.reduce((s, r) => s + r[c], 0) / sub.length;
    });
  });

  // Grand means (re-centre after demeaning to preserve intercept in OLS)
  const grandMeans = {};
  allCols.forEach(c => {
    grandMeans[c] = valid.reduce((s, r) => s + r[c], 0) / valid.length;
  });

  // Within-demean
  const demeaned = valid.map(r => {
    const d = { ...r };
    allCols.forEach(c => {
      d[`__dm_${c}`] = r[c] - unitMeans[r[unitCol]][c] + grandMeans[c];
    });
    return d;
  });

  const dmY = `__dm_${yCol}`;
  const dmX = xCols.map(c => `__dm_${c}`);
  const res = runOLS(demeaned, dmY, dmX);
  if (!res) return { error: "Within-group OLS failed — singular matrix after demeaning." };

  const df_fe = valid.length - units.length - xCols.length;
  if (df_fe <= 0)
    return { error: "Degrees of freedom ≤ 0 after demeaning — add more observations or reduce regressors." };

  const s2_fe = res.SSR / df_fe;
  const Xmat  = demeaned.map(r => [1, ...dmX.map(x => r[x])]);
  const Xt    = transpose(Xmat);
  const XtXinv = matInv(matMul(Xt, Xmat));
  const rawSE  = XtXinv
    ? XtXinv.map((row, i) => Math.sqrt(Math.abs(row[i] * s2_fe)))
    : res.se;
  const corrSE = rawSE.map(v => (isFinite(v) ? v : NaN));
  const corrT  = res.beta.map((b, i) => (isFinite(corrSE[i]) ? b / corrSE[i] : NaN));
  const corrP  = corrT.map(t => (isFinite(t) ? pValue(t, df_fe) : NaN));

  // R² within
  const dmYvals = demeaned.map(r => r[dmY]);
  const dmYmean = dmYvals.reduce((a, b) => a + b, 0) / dmYvals.length;
  const SST_w   = dmYvals.reduce((s, v) => s + (v - dmYmean) ** 2, 0);
  const R2_within = 1 - res.SSR / SST_w;

  // R² between (OLS on unit means)
  const unitRows = units.map(u => {
    const row = { __by: unitMeans[u][yCol] };
    xCols.forEach(c => { row[`__bx_${c}`] = unitMeans[u][c]; });
    return row;
  });
  const bRes = runOLS(unitRows, "__by", xCols.map(c => `__bx_${c}`));

  // Entity intercepts α̂_i
  const alphas = {};
  units.forEach(u => {
    let fitted = grandMeans[yCol];
    xCols.forEach((c, i) => { fitted += res.beta[i + 1] * unitMeans[u][c]; });
    alphas[u] = unitMeans[u][yCol] - (fitted - grandMeans[yCol]);
  });

  return {
    beta:     res.beta.slice(1),
    se:       corrSE.slice(1),
    tStats:   corrT.slice(1),
    pVals:    corrP.slice(1),
    varNames: xCols,
    R2_within,
    R2_between: bRes?.R2 ?? null,
    n:    valid.length,
    units: units.length,
    df:   df_fe,
    SSR:  res.SSR,
    s2:   s2_fe,
    resid: res.resid,
    Yhat:  res.Yhat,
    alphas,
    Fstat: res.Fstat,
    Fpval: res.Fpval,
  };
}

// ─── FIRST DIFFERENCES ───────────────────────────────────────────────────────
export function runFD(rows, yCol, xCols, unitCol, timeCol) {
  const { valid, units } = prepPanel(rows, yCol, xCols, unitCol, timeCol);
  if (valid.length < xCols.length + 3 || units.length < 2) return null;

  const diffRows = [];
  units.forEach(u => {
    const sub = valid
      .filter(r => r[unitCol] === u)
      .sort((a, b) => a[timeCol] - b[timeCol]);
    for (let i = 1; i < sub.length; i++) {
      const d = { __unit: u };
      const ok = [yCol, ...xCols].every(
        c => typeof sub[i][c] === "number" && typeof sub[i - 1][c] === "number"
      );
      if (!ok) continue;
      [yCol, ...xCols].forEach(c => {
        d[`__fd_${c}`] = sub[i][c] - sub[i - 1][c];
      });
      diffRows.push(d);
    }
  });

  if (diffRows.length < xCols.length + 2) return null;
  const fdY = `__fd_${yCol}`;
  const fdX = xCols.map(c => `__fd_${c}`);
  const res = runOLS(diffRows, fdY, fdX);
  if (!res) return null;

  return {
    beta:     res.beta.slice(1),
    se:       res.se.slice(1),
    tStats:   res.tStats.slice(1),
    pVals:    res.pVals.slice(1),
    varNames: xCols,
    R2:    res.R2,
    adjR2: res.adjR2,
    n:    diffRows.length,
    units: units.length,
    df:   res.df,
    SSR:  res.SSR,
    resid: res.resid,
    Yhat:  res.Yhat,
    Fstat: res.Fstat,
    Fpval: res.Fpval,
  };
}

// ─── DiD 2×2 ─────────────────────────────────────────────────────────────────
export function run2x2DiD(rows, yCol, postCol, treatCol, controls = []) {
  const valid = rows.filter(r =>
    typeof r[yCol] === "number" && isFinite(r[yCol]) &&
    (r[postCol]  === 0 || r[postCol]  === 1) &&
    (r[treatCol] === 0 || r[treatCol] === 1)
  );
  if (valid.length < 8) return null;

  const aug   = valid.map(r => ({ ...r, __did_inter: r[postCol] * r[treatCol] }));
  const xCols = [postCol, treatCol, "__did_inter", ...controls];
  const res   = runOLS(aug, yCol, xCols);
  if (!res) return null;

  const varNames = ["(Intercept)", "Post", "Treated", "Post × Treated (ATT)", ...controls];
  const attIdx   = 3;
  const att    = res.beta[attIdx];
  const attSE  = res.se[attIdx];
  const attT   = res.tStats[attIdx];
  const attP   = res.pVals[attIdx];

  // Raw group means for the parallel-trends visual
  const means  = { ctrl_pre: 0, ctrl_post: 0, trt_pre: 0, trt_post: 0 };
  const counts = { ctrl_pre: 0, ctrl_post: 0, trt_pre: 0, trt_post: 0 };
  valid.forEach(r => {
    const key = `${r[treatCol] ? "trt" : "ctrl"}_${r[postCol] ? "post" : "pre"}`;
    means[key] += r[yCol];
    counts[key]++;
  });
  Object.keys(means).forEach(k => {
    means[k] = counts[k] > 0 ? means[k] / counts[k] : null;
  });

  return { ...res, varNames, att, attSE, attT, attP, means, n: valid.length };
}

// ─── TWFE DiD (Two-Way Fixed Effects) ────────────────────────────────────────
export function runTWFEDiD(rows, yCol, unitCol, timeCol, treatCol, controls = []) {
  const valid = rows.filter(r =>
    typeof r[yCol] === "number" && isFinite(r[yCol]) &&
    r[unitCol] != null && r[timeCol] != null
  );
  if (valid.length < 10) return null;

  const units = [...new Set(valid.map(r => r[unitCol]))].sort();
  const times = [...new Set(valid.map(r => r[timeCol]))].sort((a, b) => a - b);
  if (units.length < 2 || times.length < 2) return null;

  // Compute grand, unit, and time means for double-demeaning
  const varCols = [yCol, treatCol, ...controls];
  const grandMeans = {}, unitMeans = {}, timeMeans = {};

  varCols.forEach(c => {
    grandMeans[c] = valid.reduce((s, r) => s + (r[c] ?? 0), 0) / valid.length;
  });
  units.forEach(u => {
    const sub = valid.filter(r => r[unitCol] === u);
    unitMeans[u] = {};
    varCols.forEach(c => {
      unitMeans[u][c] = sub.reduce((s, r) => s + (r[c] ?? 0), 0) / sub.length;
    });
  });
  times.forEach(t => {
    const sub = valid.filter(r => r[timeCol] === t);
    timeMeans[t] = {};
    varCols.forEach(c => {
      timeMeans[t][c] = sub.reduce((s, r) => s + (r[c] ?? 0), 0) / sub.length;
    });
  });

  const demeaned = valid.map(r => {
    const d = {};
    varCols.forEach(c => {
      d[c] = (r[c] ?? 0)
        - (unitMeans[r[unitCol]][c] ?? 0)
        - (timeMeans[r[timeCol]][c] ?? 0)
        + grandMeans[c];
    });
    return d;
  });

  const res = runOLS(demeaned, yCol, [treatCol, ...controls]);
  if (!res) return null;

  // Correct df: remove unit + time FE from denominator
  const df_fe = valid.length - (units.length + times.length - 1) - controls.length - 1;
  const s2_fe = res.SSR / Math.max(1, df_fe);

  const Xmat  = demeaned.map(r => [1, r[treatCol], ...controls.map(c => r[c])]);
  const Xt    = transpose(Xmat);
  const XtXinv = matInv(matMul(Xt, Xmat));
  const corrSE = XtXinv
    ? XtXinv.map((row, i) => Math.sqrt(Math.abs(row[i] * s2_fe)))
    : res.se;
  const corrT  = res.beta.map((b, i) => b / corrSE[i]);
  const corrP  = corrT.map(t => pValue(t, df_fe));

  const varNames = ["(Intercept)", "Treatment (ATT)", ...controls];
  const att    = res.beta[1];
  const attSE  = corrSE[1];
  const attT   = corrT[1];
  const attP   = corrP[1];

  // Identify ever-treated units (treatCol === 1 in any period)
  const everTreated = new Set(
    valid.filter(r => !!r[treatCol]).map(r => r[unitCol])
  );

  // Per-period means for event-study visual
  // ctrl = units never treated | trt = units ever treated (shown in all periods)
  const eventMeans = times.map(t => {
    const sub  = valid.filter(r => r[timeCol] === t);
    const ctrl = sub.filter(r => !everTreated.has(r[unitCol]));
    const trt  = sub.filter(r =>  everTreated.has(r[unitCol]));
    return {
      t,
      ctrl: ctrl.length > 0 ? ctrl.reduce((s, r) => s + r[yCol], 0) / ctrl.length : null,
      trt:  trt.length  > 0 ? trt.reduce((s, r)  => s + r[yCol], 0) / trt.length  : null,
    };
  });

  return {
    beta: res.beta, se: corrSE, tStats: corrT, pVals: corrP,
    varNames, att, attSE, attT, attP,
    R2: res.R2,
    adjR2: 1 - (1 - res.R2) * (valid.length - 1) / Math.max(1, df_fe),
    n: valid.length, df: df_fe,
    units: units.length, times: times.length,
    eventMeans, timesArr: times,
  };
}
