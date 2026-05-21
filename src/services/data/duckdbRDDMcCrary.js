// ECON STUDIO - src/services/data/duckdbRDDMcCrary.js
// McCrary density-test bins in DuckDB, local density fits on tiny JS bin data.

import { getDuckDB } from "./duckdb.js";

function esc(c) {
  return `"${String(c).replace(/"/g, '""')}"`;
}

function num(v) {
  return v == null ? NaN : (typeof v === "bigint" ? Number(v) : Number(v));
}

function localLinearDensity(bins, evalPt, hFit) {
  const active = bins
    .map(bin => ({
      ...bin,
      w: Math.max(0, 1 - Math.abs(bin.x - evalPt) / hFit),
    }))
    .filter(bin => bin.w > 0);
  if (active.length < 2) return null;

  let sw = 0;
  let swx = 0;
  let swy = 0;
  let swxx = 0;
  let swxy = 0;
  active.forEach(bin => {
    const xc = bin.x - evalPt;
    sw += bin.w;
    swx += bin.w * xc;
    swy += bin.w * bin.density;
    swxx += bin.w * xc * xc;
    swxy += bin.w * xc * bin.density;
  });
  const det = sw * swxx - swx * swx;
  if (Math.abs(det) < 1e-15) return null;

  const a = (swxx * swy - swx * swxy) / det;
  const b = (sw * swxy - swx * swy) / det;
  let weightedSSR = 0;
  active.forEach(bin => {
    const resid = bin.density - (a + b * (bin.x - evalPt));
    weightedSSR += bin.w * resid * resid;
  });
  const sigmaW2 = weightedSSR / Math.max(1, active.length - 2);
  return {
    fhat: a,
    varFhat: sigmaW2 * swxx / det,
    nActive: active.length,
  };
}

function fitLine(bins, hFit) {
  const hSmooth = hFit * 1.5;
  return bins.map(bin => {
    const fit = localLinearDensity(
      bins.filter(candidate => Math.abs(candidate.x - bin.x) <= hSmooth),
      bin.x,
      hFit,
    );
    return { x: bin.x, yhat: fit ? Math.max(0, fit.fhat) : bin.density };
  });
}

function normalPValue(z) {
  const absZ = Math.abs(z);
  const t = 1 / (1 + 0.2316419 * absZ);
  const poly = t * (0.319381530
    + t * (-0.356563782
    + t * (1.781477937
    + t * (-1.821255978
    + t * 1.330274429))));
  return Math.min(1, Math.max(0,
    2 * Math.exp(-0.5 * absZ * absZ) / Math.sqrt(2 * Math.PI) * poly
  ));
}

export async function runMcCrarySQL({
  tableName,
  runningCol,
  cutoff,
  h = null,
  bins = null,
}) {
  const { conn } = await getDuckDB();
  const runExpr = `TRY_CAST(${esc(runningCol)} AS DOUBLE)`;
  const stats = (await conn.query(`
    SELECT
      COUNT(*) AS n,
      MIN(${runExpr}) AS xmin,
      MAX(${runExpr}) AS xmax,
      AVG(${runExpr}) AS xmean,
      STDDEV_POP(${runExpr}) AS xsd,
      QUANTILE_CONT(${runExpr}, 0.25) AS q1,
      QUANTILE_CONT(${runExpr}, 0.75) AS q3
    FROM ${esc(tableName)}
    WHERE isfinite(${runExpr})
  `)).toArray()[0];

  const n = num(stats.n);
  const xMin = num(stats.xmin);
  const xMax = num(stats.xmax);
  const range = xMax - xMin;
  if (!(n >= 20) || !(range > 0) || cutoff <= xMin || cutoff >= xMax) return null;

  const q1 = num(stats.q1);
  const q3 = num(stats.q3);
  const iqr = q3 - q1;
  const autoBins = iqr > 0
    ? Math.ceil(range / (2 * iqr * Math.pow(n, -1 / 3)))
    : Math.ceil(Math.sqrt(n));
  const nBins = bins ?? Math.min(Math.max(autoBins, 10), 100);
  const bw = range / nBins;
  const cutoffBin = Math.floor((cutoff - xMin) / bw);
  const gridStart = cutoff - cutoffBin * bw;
  const maxBinIndex = nBins + 1;

  const countRows = (await conn.query(`
    WITH bins AS (
      SELECT FLOOR((${runExpr} - ${gridStart}) / ${bw})::INTEGER AS bin_idx
      FROM ${esc(tableName)}
      WHERE isfinite(${runExpr})
    )
    SELECT bin_idx, COUNT(*) AS c
    FROM bins
    WHERE bin_idx BETWEEN 0 AND ${maxBinIndex}
    GROUP BY bin_idx
  `)).toArray();
  const counts = new Map(countRows.map(row => [num(row.bin_idx), num(row.c)]));
  const binData = [];
  for (let idx = 0; idx <= maxBinIndex; idx++) {
    const x = gridStart + (idx + 0.5) * bw;
    if (x < xMin - bw || x > xMax + bw) continue;
    const density = (counts.get(idx) ?? 0) / (n * bw);
    binData.push({ x, density, side: x < cutoff ? "left" : "right" });
  }

  const leftBins = binData.filter(bin => bin.side === "left" && bin.x >= xMin);
  const rightBins = binData.filter(bin => bin.side === "right" && bin.x <= xMax);
  if (leftBins.length < 3 || rightBins.length < 3) return null;

  const xsd = num(stats.xsd);
  const hAuto = 1.06 * Math.min(xsd, iqr / 1.34) * Math.pow(n, -0.2);
  const hFit = h ?? Math.max(hAuto, range * 0.15);
  const leftFitAtCutoff = localLinearDensity(leftBins, cutoff, hFit);
  const rightFitAtCutoff = localLinearDensity(rightBins, cutoff, hFit);
  if (!leftFitAtCutoff || !rightFitAtCutoff) return null;

  const fhatLeft = Math.max(leftFitAtCutoff.fhat, 1e-10);
  const fhatRight = Math.max(rightFitAtCutoff.fhat, 1e-10);
  const theta = Math.log(fhatRight / fhatLeft);
  const varTheta = rightFitAtCutoff.varFhat / (fhatRight ** 2)
    + leftFitAtCutoff.varFhat / (fhatLeft ** 2);
  const thetaSE = Math.sqrt(Math.max(0, varTheta));
  if (!Number.isFinite(theta) || !(thetaSE > 0)) return null;

  const zStat = theta / thetaSE;
  const pVal = normalPValue(zStat);
  return {
    bins: binData,
    leftBins,
    rightBins,
    leftFit: fitLine(leftBins, hFit),
    rightFit: fitLine(rightBins, hFit),
    fhatLeft,
    fhatRight,
    theta,
    thetaSE,
    zStat,
    pVal,
    manipulation: pVal < 0.05,
    h: hFit,
    bw,
    nBins,
    cutoff,
    n,
  };
}
