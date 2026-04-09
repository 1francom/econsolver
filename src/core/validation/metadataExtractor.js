// ─── ECON STUDIO · src/core/validation/metadataExtractor.js ────────────────────
// Deep metadata extraction engine.
// Pure JS — no React, no side effects.
//
// Usage:
//   const report = buildMetadataReport(headers, rows, panelIndex);
//
// MetadataReport {
//   temporal    : TemporalMeta | null
//   panelQuality: PanelQuality | null
//   columns     : ColMetadata[]
//   highCorrelations: { a, b, r }[]
// }

// ─── HELPERS ──────────────────────────────────────────────────────────────────

function numVals(rows, col) {
  return rows.map(r => r[col]).filter(v => typeof v === "number" && isFinite(v));
}

function mean(arr) {
  if (!arr.length) return NaN;
  return arr.reduce((a, b) => a + b, 0) / arr.length;
}

function variance(arr) {
  if (arr.length < 2) return 0;
  const m = mean(arr);
  return arr.reduce((s, v) => s + (v - m) ** 2, 0) / (arr.length - 1);
}

function std(arr) {
  return Math.sqrt(variance(arr));
}

// Population kurtosis excess (Fisher)
function kurtosis(arr) {
  if (arr.length < 4) return null;
  const m = mean(arr);
  const n = arr.length;
  const s2 = variance(arr);
  if (s2 === 0) return null;
  const kurt = arr.reduce((s, v) => s + ((v - m) / Math.sqrt(s2)) ** 4, 0) / n - 3;
  return kurt;
}

function skewness(arr) {
  if (arr.length < 3) return null;
  const m = mean(arr);
  const s = std(arr);
  if (s === 0) return null;
  const n = arr.length;
  return arr.reduce((sum, v) => sum + ((v - m) / s) ** 3, 0) / n;
}

function kurtLabel(k) {
  if (k == null) return "unknown";
  if (Math.abs(k) < 1) return "normal";
  if (k > 3) return "leptokurtic";
  if (k < -1) return "platykurtic";
  return "normal";
}

function correlation(xs, ys) {
  if (xs.length !== ys.length || xs.length < 3) return null;
  const mx = mean(xs), my = mean(ys);
  let num = 0, dx2 = 0, dy2 = 0;
  for (let i = 0; i < xs.length; i++) {
    const dx = xs[i] - mx, dy = ys[i] - my;
    num += dx * dy;
    dx2 += dx * dx;
    dy2 += dy * dy;
  }
  const denom = Math.sqrt(dx2 * dy2);
  return denom === 0 ? null : num / denom;
}

// ─── TEMPORAL DETECTION ───────────────────────────────────────────────────────

function detectPeriodicity(diffs) {
  // diffs in days
  const counts = {};
  diffs.forEach(d => {
    const bucket = d <= 1.5 ? 1
      : d <= 4   ? 3    // ~tri-weekly
      : d <= 10  ? 7    // weekly
      : d <= 20  ? 14   // bi-weekly
      : d <= 35  ? 30   // monthly
      : d <= 100 ? 91   // quarterly
      : 365;            // annual
    counts[bucket] = (counts[bucket] ?? 0) + 1;
  });
  const mode = Object.entries(counts).sort((a, b) => b[1] - a[1])[0]?.[0];
  const map  = { 1: "daily", 3: "tri-weekly", 7: "weekly", 14: "bi-weekly",
                 30: "monthly", 91: "quarterly", 365: "annual" };
  return map[mode] ?? "irregular";
}

function tryParseDate(val) {
  if (val == null) return null;
  if (typeof val === "number") {
    // Numeric year column (1900–2100)?
    if (Number.isInteger(val) && val >= 1900 && val <= 2100) return new Date(val, 0, 1);
    return null;
  }
  const str = String(val).trim();
  if (!str) return null;
  const d = new Date(str);
  return isNaN(d.getTime()) ? null : d;
}

function analyzeTemporalColumn(rows, col) {
  const parsed = rows.map(r => tryParseDate(r[col])).filter(Boolean);
  if (parsed.length < 3) return null;

  const times = parsed.map(d => d.getTime()).sort((a, b) => a - b);
  const diffs = [];
  for (let i = 1; i < times.length; i++) {
    const dDays = (times[i] - times[i - 1]) / 86400000;
    if (dDays > 0) diffs.push(dDays);
  }
  if (!diffs.length) return null;

  return {
    dateCol:     col,
    periodicity: detectPeriodicity(diffs),
    minDate:     new Date(times[0]).toISOString().slice(0, 10),
    maxDate:     new Date(times[times.length - 1]).toISOString().slice(0, 10),
    span:        Math.round((times[times.length - 1] - times[0]) / 86400000), // days
  };
}

function extractTemporal(headers, rows) {
  for (const col of headers) {
    const result = analyzeTemporalColumn(rows, col);
    if (result) return result;
  }
  return null;
}

// ─── PANEL QUALITY ────────────────────────────────────────────────────────────

function buildPanelQuality(rows, panel, numericHeaders) {
  if (!panel?.entityCol || !panel?.timeCol) return null;
  const { entityCol, timeCol } = panel;

  // Entity counts
  const entityMap = {};
  rows.forEach(r => {
    const e = r[entityCol];
    if (e == null) return;
    entityMap[e] = (entityMap[e] ?? 0) + 1;
  });
  const tCounts = Object.values(entityMap);
  if (!tCounts.length) return null;

  const tMin    = Math.min(...tCounts);
  const tMax    = Math.max(...tCounts);
  const tMean   = mean(tCounts);
  const sorted  = [...tCounts].sort((a, b) => a - b);
  const tMedian = sorted[Math.floor(sorted.length / 2)];
  const balanced = tMin === tMax;

  // Gap rate: fraction of entities with non-consecutive time periods
  // (simple proxy: std(T_i) / mean(T_i))
  const gapRate = tMean > 0 ? std(tCounts) / tMean : 0;

  // Within/between decomposition for numeric columns
  let withinVar = null, betweenVar = null, withinShare = null;
  const numCols = numericHeaders.filter(h => h !== entityCol && h !== timeCol);
  if (numCols.length) {
    const col = numCols[0]; // use first numeric col as representative
    const entityMeans = {};
    Object.keys(entityMap).forEach(e => {
      const vals = rows.filter(r => String(r[entityCol]) === String(e)).map(r => r[col]).filter(v => isFinite(v));
      if (vals.length) entityMeans[e] = mean(vals);
    });
    const entMeanArr = Object.values(entityMeans);
    betweenVar = variance(entMeanArr);

    let withinSum = 0, withinCount = 0;
    Object.entries(entityMeans).forEach(([e, em]) => {
      const vals = rows.filter(r => String(r[entityCol]) === String(e)).map(r => r[col]).filter(v => isFinite(v));
      vals.forEach(v => {
        withinSum += (v - em) ** 2;
        withinCount++;
      });
    });
    withinVar = withinCount > 1 ? withinSum / (withinCount - 1) : 0;
    const total = withinVar + betweenVar;
    withinShare = total > 0 ? withinVar / total : null;
  }

  return {
    balance:          balanced,
    tDistribution:    { min: tMin, max: tMax, mean: tMean, median: tMedian },
    gapRate:          Math.min(gapRate, 1),
    withinVar,
    betweenVar,
    withinShare,
  };
}

// ─── COLUMN METADATA ─────────────────────────────────────────────────────────

function buildColMetadata(rows, col) {
  const vals = numVals(rows, col);
  if (!vals.length) return null;

  const mn   = Math.min(...vals);
  const mx   = Math.max(...vals);
  const m    = mean(vals);
  const s    = std(vals);
  const k    = kurtosis(vals);
  const sk   = skewness(vals);
  const logFeasible = mn > 0 && (vals.length < 2 || mx / mn > 10);
  const coeffOfVar  = m !== 0 ? s / Math.abs(m) : null;

  return {
    col,
    n:            vals.length,
    mean:         m,
    std:          s,
    min:          mn,
    max:          mx,
    kurtosis:     k,
    kurtosisLabel: kurtLabel(k),
    skewness:     sk,
    logFeasible,
    coeffOfVar,
  };
}

// ─── HIGH CORRELATIONS ────────────────────────────────────────────────────────

function findHighCorrelations(rows, numericHeaders, threshold = 0.85) {
  const result = [];
  const cols = numericHeaders.slice(0, 20); // cap at 20 columns (190 pairs max)
  const vecs = cols.map(c => numVals(rows, c));

  for (let i = 0; i < cols.length; i++) {
    for (let j = i + 1; j < cols.length; j++) {
      const minLen = Math.min(vecs[i].length, vecs[j].length);
      if (minLen < 10) continue;
      const r = correlation(vecs[i].slice(0, minLen), vecs[j].slice(0, minLen));
      if (r != null && Math.abs(r) >= threshold) {
        result.push({ a: cols[i], b: cols[j], r: Math.round(r * 1000) / 1000 });
      }
    }
  }

  return result.sort((a, b) => Math.abs(b.r) - Math.abs(a.r)).slice(0, 10);
}

// ─── PUBLIC API ───────────────────────────────────────────────────────────────

/**
 * buildMetadataReport — extract deep metadata for AI coaching.
 *
 * @param {string[]} headers        — column names
 * @param {Object[]} rows           — data rows (post-pipeline)
 * @param {Object|null} panelIndex  — { entityCol, timeCol, blockFE } from panelIndex
 * @returns {MetadataReport}
 */
export function buildMetadataReport(headers, rows, panelIndex = null) {
  if (!headers?.length || !rows?.length) {
    return { temporal: null, panelQuality: null, columns: [], highCorrelations: [] };
  }

  const numericHeaders = headers.filter(h =>
    rows.some(r => typeof r[h] === "number" && isFinite(r[h]))
  );

  const temporal    = extractTemporal(headers, rows);
  const panelQuality = buildPanelQuality(rows, panelIndex, numericHeaders);

  const columns = numericHeaders
    .map(col => buildColMetadata(rows, col))
    .filter(Boolean);

  const highCorrelations = findHighCorrelations(rows, numericHeaders);

  return { temporal, panelQuality, columns, highCorrelations };
}
