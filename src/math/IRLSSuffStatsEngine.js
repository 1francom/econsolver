// ECON STUDIO - src/math/IRLSSuffStatsEngine.js
// JS IRLS driver over DuckDB-built weighted sufficient statistics.

import { matInv, matMul } from "./LinearEngine.js";
import { normCDF } from "./NonLinearEngine.js";
import { buildIRLSSuffStats } from "../services/data/duckdbIRLS.js";
import { computeIRLSHCMeat } from "../services/data/duckdbIRLSRobustSE.js";

function vmul(M, v) {
  return M.map(row => row.reduce((sum, value, idx) => sum + value * v[idx], 0));
}

function maxAbs(values) {
  return values.reduce((max, value) => Math.max(max, Math.abs(value)), 0);
}

function zPValue(z) {
  return 2 * (1 - normCDF(Math.abs(z)));
}

function diagSE(V) {
  return V.map((row, idx) => {
    const d = row[idx];
    return Number.isFinite(d) && d >= 0 ? Math.sqrt(d) : NaN;
  });
}

function inferStats(beta, se) {
  const zStats = beta.map((value, idx) =>
    Number.isFinite(value) && se[idx] > 0 ? value / se[idx] : NaN
  );
  return {
    zStats,
    pVals: zStats.map(stat => Number.isFinite(stat) ? zPValue(stat) : NaN),
  };
}

function nullLogLik(family, suff) {
  const yBar = suff.sumY / suff.n;
  if (family === "logit" || family === "probit") {
    const p = Math.min(Math.max(yBar, 1e-12), 1 - 1e-12);
    return suff.n * (p * Math.log(p) + (1 - p) * Math.log(1 - p));
  }

  const mu = Math.max(yBar, 1e-12);
  return suff.sumY * Math.log(mu) - suff.n * mu - suff.sumLogFactorial;
}

export async function runIRLSFromSuffStats({
  tableName,
  yCol,
  xCols,
  family,
  dummySQL = {},
  maxIter = 50,
  tol = 1e-8,
}) {
  const dim = xCols.length + 1;
  let beta = Array(dim).fill(0);
  let iter = 0;
  let converged = false;
  let lastSuff = null;

  while (iter < maxIter) {
    const suff = await buildIRLSSuffStats({
      tableName,
      yCol,
      xCols,
      family,
      beta,
      dummySQL,
    });
    lastSuff = suff;
    if (!(suff.n > dim)) {
      return { error: `Insufficient observations: need at least ${dim + 1}.` };
    }
    if ((family === "logit" || family === "probit") &&
        (suff.positiveY === 0 || suff.positiveY === suff.n)) {
      return { error: "Outcome has no variation - all observations are 0 or all are 1." };
    }

    const XtWXinv = matInv(suff.XtWX);
    if (!XtWXinv) return { error: `IRLS X'WX is singular at iteration ${iter + 1}.` };

    const nextBeta = vmul(XtWXinv, suff.XtWZ);
    const delta = nextBeta.map((value, idx) => value - beta[idx]);
    beta = nextBeta;
    iter += 1;
    if (maxAbs(delta) < tol) {
      converged = true;
      break;
    }
  }

  if (!lastSuff) return { error: "IRLS did not run any iterations." };

  const finalSuff = await buildIRLSSuffStats({
    tableName,
    yCol,
    xCols,
    family,
    beta,
    dummySQL,
  });
  const XtXinv = matInv(finalSuff.XtWX);
  if (!XtXinv) return { error: "IRLS final information matrix is singular." };

  const se = diagSE(XtXinv);
  const { zStats, pVals } = inferStats(beta, se);
  const k = dim;
  const df = finalSuff.n - k;
  const logLikNull = nullLogLik(family, finalSuff);
  const mcFaddenR2 = logLikNull !== 0 ? 1 - finalSuff.logLik / logLikNull : 0;

  return {
    family,
    beta,
    se,
    zStats,
    pVals,
    varNames: ["(Intercept)", ...xCols],
    n: finalSuff.n,
    k,
    df,
    logLik: finalSuff.logLik,
    logLikNull,
    nullLogLik: logLikNull,
    mcFaddenR2,
    McFaddenR2: mcFaddenR2,
    AIC: -2 * finalSuff.logLik + 2 * k,
    BIC: -2 * finalSuff.logLik + k * Math.log(finalSuff.n),
    deviance: -2 * finalSuff.logLik,
    fitted: [],
    residuals: [],
    resid: [],
    converged,
    iterations: iter,
    XtXinv,
    _suffFinal: finalSuff,
  };
}

export async function applyRobustSEToIRLSResult({
  result,
  tableName,
  yCol,
  xCols,
  family,
  dummySQL = {},
  hcType,
}) {
  if (!["HC0", "HC1"].includes(hcType)) return result;
  const mm = await computeIRLSHCMeat({
    tableName,
    yCol,
    xCols,
    family,
    beta: result.beta,
    dummySQL,
  });
  const scale = hcType === "HC1" ? result.n / Math.max(1, result.df) : 1;
  const meat = mm.meat.map(row => row.map(value => value * scale));
  const V = matMul(matMul(result.XtXinv, meat), result.XtXinv);
  const se = diagSE(V);
  const { zStats, pVals } = inferStats(result.beta, se);
  return { ...result, se, zStats, pVals, _robustHC: hcType };
}
