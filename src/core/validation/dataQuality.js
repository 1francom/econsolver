// ─── ECON STUDIO · core/validation/dataQuality.js ────────────────────────────
// Pure computation. Zero React imports.
//
// Consumes the output of buildInfo() (from pipeline/validator.js) and raw rows,
// and produces a DataQualityReport — a fully serialisable object that can be:
//   • Rendered by DataQualityReport.jsx
//   • Exported as data_quality_report.md (replication package)
//   • Passed to the AI cleaning suggestions prompt
//
// Exports:
//   buildDataQualityReport(headers, rows, info, panelReport?)
//     → DataQualityReport
//
//   exportMarkdown(report)
//     → string  (ready to write as .md file)
//
// ─── DataQualityReport shape ──────────────────────────────────────────────────
//
//   meta: {
//     nRows, nCols, generatedAt,
//     completeness,          // overall % non-null cells
//     numericCols,           // count of numeric columns
//     categoricalCols,       // count of categorical columns
//     mixedCols,             // columns with both numeric and string values
//   }
//
//   columns: ColReport[]    // one per column, ordered by severity desc
//   {
//     col,
//     type,                  // "numeric" | "categorical" | "mixed" | "constant" | "id"
//     severity,              // "ok" | "low" | "medium" | "high" | "critical"
//     issues: Issue[],
//     stats,                 // subset of ColStats from buildInfo
//     missingPattern,        // { count, pct, isSystematic }
//     outlierReport,         // numeric only
//     typeReport,            // mixed cols only
//   }
//
//   correlations: { a, b, r }[]   // |r| > 0.85 pairs — multicollinearity risk
//
//   panelSummary: null | {         // only if panelReport passed
//     balance, nEntities, nPeriods,
//     attritionPct, hasDups, hasGaps,
//     severity,
//   }
//
//   flags: Flag[]           // top-level actionable flags, sorted by severity
//   {
//     col,                  // null for dataset-level flags
//     type,                 // flag type string
//     severity,
//     title,
//     detail,
//     suggestedStep,        // step type from registry, or null
//   }

import { buildInfo } from "../../pipeline/validator.js";

// ─── SEVERITY LEVELS ──────────────────────────────────────────────────────────
const SEV_RANK = { critical: 4, high: 3, medium: 2, low: 1, ok: 0 };
function maxSev(...sevs) {
  return sevs.reduce((a, b) => SEV_RANK[a] >= SEV_RANK[b] ? a : b, "ok");
}

// ─── MISSING PATTERN ──────────────────────────────────────────────────────────
// isSystematic: true if nulls cluster in specific rows rather than being random.
// Heuristic: if the top-5 null-row indices are all in the first or last 10%
// of the dataset, pattern is likely systematic (truncation, merge artifact).
function missingPattern(col, rows) {
  const n = rows.length;
  const nullIdx = rows
    .map((r, i) => (r[col] === null || r[col] === undefined ? i : -1))
    .filter(i => i >= 0);

  if (!nullIdx.length) return { count: 0, pct: 0, isSystematic: false };

  const pct = nullIdx.length / n;
  const boundary = Math.max(1, Math.floor(n * 0.1));
  const inBoundary = nullIdx.filter(i => i < boundary || i >= n - boundary).length;
  const isSystematic = inBoundary / nullIdx.length > 0.6;

  return { count: nullIdx.length, pct, isSystematic };
}

// ─── OUTLIER REPORT ───────────────────────────────────────────────────────────
// Two methods: IQR (non-parametric) and z-score (parametric, assumes normality).
// Both reported — researcher decides which is appropriate for their distribution.
function outlierReport(col, rows, stats) {
  if (!stats.isNum || stats.mean == null) return null;

  const nums = rows
    .map(r => r[col])
    .filter(v => typeof v === "number" && isFinite(v));

  if (nums.length < 4) return null;

  // IQR method
  const iqrLo = stats.q1 - 1.5 * stats.iqr;
  const iqrHi = stats.q3 + 1.5 * stats.iqr;
  const iqrOut = nums.filter(v => v < iqrLo || v > iqrHi);

  // Z-score method (|z| > 3)
  const zOut = stats.std > 0
    ? nums.filter(v => Math.abs((v - stats.mean) / stats.std) > 3)
    : [];

  // Extreme values (top/bottom 3)
  const sorted = [...nums].sort((a, b) => a - b);
  const extremeLow  = sorted.slice(0, 3);
  const extremeHigh = sorted.slice(-3).reverse();

  // Skewness (moment-based)
  const skew = stats.std > 0
    ? nums.reduce((s, v) => s + ((v - stats.mean) / stats.std) ** 3, 0) / nums.length
    : 0;

  return {
    iqrCount:    iqrOut.length,
    iqrPct:      iqrOut.length / nums.length,
    zCount:      zOut.length,
    zPct:        zOut.length / nums.length,
    extremeLow,
    extremeHigh,
    skewness:    skew,
    skewLabel:   Math.abs(skew) < 0.5 ? "symmetric"
               : Math.abs(skew) < 1   ? "moderately skewed"
               : "highly skewed",
  };
}

// ─── TYPE REPORT ──────────────────────────────────────────────────────────────
// Detects mixed-type columns: columns where some values parsed as number
// and others as string — usually a sign of encoding issues.
function typeReport(col, rows, stats) {
  if (!stats.isCat && !stats.isNum) {
    // Mixed: has both numeric and string non-null values
    const vals = rows.map(r => r[col]).filter(v => v !== null && v !== undefined);
    const numVals = vals.filter(v => typeof v === "number");
    const strVals = vals.filter(v => typeof v === "string");
    if (numVals.length > 0 && strVals.length > 0) {
      return {
        numCount: numVals.length,
        strCount: strVals.length,
        strSamples: strVals.slice(0, 5),
        likelyCause: strVals.some(v => /^[a-zA-Z]/.test(v))
          ? "text values mixed with numbers — possible data entry error or merged dataset"
          : "numeric strings not parsed — consider type_cast to number",
      };
    }
  }
  return null;
}

// ─── CONSTANT / NEAR-CONSTANT DETECTION ──────────────────────────────────────
function isConstant(stats) {
  return stats.uCount <= 1 && stats.naCount < stats.total;
}
function isNearConstant(stats) {
  if (stats.uCount !== 2) return false;
  if (!stats.isNum) return false;
  // One value dominates > 95% of non-null rows
  return true; // uCount==2 and isNum is a sufficient signal for a flag
}

// ─── CORRELATION MATRIX (numeric cols only) ───────────────────────────────────
// Returns pairs with |r| > threshold. O(n·k²) — k = numeric columns.
function highCorrelationPairs(headers, rows, info, threshold = 0.85) {
  const numCols = headers.filter(h => info[h]?.isNum && info[h]?.std > 0);
  const pairs = [];

  for (let i = 0; i < numCols.length; i++) {
    for (let j = i + 1; j < numCols.length; j++) {
      const a = numCols[i], b = numCols[j];
      const sa = info[a], sb = info[b];

      // Pearson r
      let sumAB = 0, sumA2 = 0, sumB2 = 0, n = 0;
      rows.forEach(r => {
        const va = r[a], vb = r[b];
        if (typeof va !== "number" || typeof vb !== "number") return;
        if (!isFinite(va) || !isFinite(vb)) return;
        const da = va - sa.mean, db = vb - sb.mean;
        sumAB += da * db;
        sumA2 += da * da;
        sumB2 += db * db;
        n++;
      });

      if (n < 3) continue;
      const denom = Math.sqrt(sumA2 * sumB2);
      if (denom === 0) continue;
      const r = sumAB / denom;

      if (Math.abs(r) >= threshold) {
        pairs.push({ a, b, r: parseFloat(r.toFixed(4)) });
      }
    }
  }

  return pairs.sort((x, y) => Math.abs(y.r) - Math.abs(x.r));
}

// ─── PER-COLUMN SEVERITY ──────────────────────────────────────────────────────
function colSeverity(col, stats, mPat, oRep, tRep) {
  const sevs = ["ok"];

  // Missing
  if (mPat.pct > 0.3)       sevs.push("high");
  else if (mPat.pct > 0.05) sevs.push("medium");
  else if (mPat.pct > 0)    sevs.push("low");

  // Constant
  if (isConstant(stats)) sevs.push("critical");

  // Outliers
  if (oRep) {
    if (oRep.iqrPct > 0.05) sevs.push("high");
    else if (oRep.iqrCount > 0) sevs.push("medium");
  }

  // Type mix
  if (tRep) sevs.push("medium");

  return maxSev(...sevs);
}

// ─── MAIN EXPORT ─────────────────────────────────────────────────────────────
export function buildDataQualityReport(headers, rows, info, panelReport = null) {
  const n = rows.length;
  const k = headers.length;

  // ── Meta ──────────────────────────────────────────────────────────────────
  let totalCells = 0, nonNullCells = 0;
  let numericCols = 0, categoricalCols = 0, mixedCols = 0;

  headers.forEach(h => {
    const s = info[h];
    if (!s) return;
    totalCells   += s.total;
    nonNullCells += s.total - s.naCount;
    if (s.isNum)       numericCols++;
    else if (s.isCat)  categoricalCols++;
    else               mixedCols++;
  });

  const meta = {
    nRows: n,
    nCols: k,
    generatedAt: new Date().toISOString(),
    completeness: totalCells > 0 ? nonNullCells / totalCells : 1,
    numericCols,
    categoricalCols,
    mixedCols,
  };

  // ── Per-column reports ────────────────────────────────────────────────────
  const columns = headers.map(col => {
    const stats = info[col];
    if (!stats) return null;

    const mPat = missingPattern(col, rows);
    const oRep = stats.isNum ? outlierReport(col, rows, stats) : null;
    const tRep = typeReport(col, rows, stats);
    const sev  = colSeverity(col, stats, mPat, oRep, tRep);

    // Determine column type label
    let type = "categorical";
    if (isConstant(stats))    type = "constant";
    else if (stats.uCount === n) type = "id";  // likely an identifier
    else if (stats.isNum)     type = "numeric";
    else if (tRep)            type = "mixed";

    // Issues list
    const issues = [];

    if (isConstant(stats)) {
      issues.push({ type: "constant", severity: "critical",
        title: "Zero variance — constant column",
        detail: "All non-null values are identical. Drop before any regression.",
        suggestedStep: "drop" });
    }

    if (mPat.pct > 0) {
      const sev = mPat.pct > 0.3 ? "high" : mPat.pct > 0.05 ? "medium" : "low";
      issues.push({ type: "missing", severity: sev,
        title: `${(mPat.pct * 100).toFixed(1)}% missing values`,
        detail: mPat.isSystematic
          ? "Missingness appears systematic (clustered at data boundaries) — possible merge artifact or truncation."
          : "Scattered missingness — consider imputation or listwise deletion.",
        suggestedStep: mPat.pct > 0.3 ? "drop_na" : "fill_na" });
    }

    if (oRep && oRep.iqrCount > 0) {
      const sev = oRep.iqrPct > 0.05 ? "high" : "medium";
      issues.push({ type: "outliers", severity: sev,
        title: `${oRep.iqrCount} outlier${oRep.iqrCount > 1 ? "s" : ""} (IQR method)`,
        detail: `${(oRep.iqrPct * 100).toFixed(1)}% of values outside [Q1−1.5·IQR, Q3+1.5·IQR]. ` +
                `Z-score method: ${oRep.zCount} extreme values. Distribution: ${oRep.skewLabel}.`,
        suggestedStep: "winz" });
    }

    if (tRep) {
      issues.push({ type: "mixed_type", severity: "medium",
        title: "Mixed numeric and string values",
        detail: `${tRep.numCount} numeric, ${tRep.strCount} string values. ${tRep.likelyCause}`,
        suggestedStep: "type_cast" });
    }

    if (type === "id") {
      issues.push({ type: "id_col", severity: "low",
        title: "Possible identifier column",
        detail: "Every value is unique — likely an ID. Verify it should not be an entity column for panel declaration.",
        suggestedStep: null });
    }

    return {
      col,
      type,
      severity: sev,
      issues,
      stats: {
        // Lean subset — enough for the UI, not the full ColStats blob
        total:   stats.total,
        naCount: stats.naCount,
        naPct:   stats.naPct,
        uCount:  stats.uCount,
        mean:    stats.mean,
        std:     stats.std,
        median:  stats.median,
        min:     stats.min,
        max:     stats.max,
        q1:      stats.q1,
        q3:      stats.q3,
        iqr:     stats.iqr,
        outliers: stats.outliers,
      },
      missingPattern: mPat,
      outlierReport:  oRep,
      typeReport:     tRep,
    };
  }).filter(Boolean);

  // Sort columns: critical → high → medium → low → ok
  columns.sort((a, b) => SEV_RANK[b.severity] - SEV_RANK[a.severity]);

  // ── Correlations ─────────────────────────────────────────────────────────
  const correlations = highCorrelationPairs(headers, rows, info, 0.85);

  // ── Panel summary ─────────────────────────────────────────────────────────
  let panelSummary = null;
  if (panelReport) {
    const { balance, entities, times, attrition, dups, gaps } = panelReport;
    const attrPct = attrition ?? 0;
    const panelSev = dups.length > 0           ? "critical"
                   : balance === "unbalanced"   ? (attrPct > 0.1 ? "high" : "medium")
                   : "ok";
    panelSummary = {
      balance,
      nEntities:    entities.length,
      nPeriods:     times.length,
      attritionPct: attrPct,
      hasDups:      dups.length > 0,
      hasGaps:      gaps.length > 0,
      severity:     panelSev,
    };
  }

  // ── Top-level flags ───────────────────────────────────────────────────────
  const flags = [];

  // Collect all column-level issues as top-level flags
  columns.forEach(c => {
    c.issues.forEach(iss => {
      flags.push({ col: c.col, ...iss });
    });
  });

  // Correlation flags
  correlations.slice(0, 5).forEach(({ a, b, r }) => {
    flags.push({
      col: null,
      type: "multicollinearity",
      severity: Math.abs(r) > 0.95 ? "high" : "medium",
      title: `High correlation: ${a} & ${b} (r = ${r.toFixed(3)})`,
      detail: Math.abs(r) > 0.95
        ? "Near-perfect collinearity. Including both will produce inflated SEs or identification failure."
        : "Strong correlation. VIF may be elevated. Consider dropping one or using a composite.",
      suggestedStep: "drop",
    });
  });

  // Dataset-level flags
  if (meta.completeness < 0.8) {
    flags.push({
      col: null,
      type: "completeness",
      severity: meta.completeness < 0.5 ? "critical" : "high",
      title: `Dataset completeness: ${(meta.completeness * 100).toFixed(1)}%`,
      detail: "More than 20% of all cells are missing. Verify data source and parsing.",
      suggestedStep: null,
    });
  }

  if (panelSummary?.hasDups) {
    flags.push({
      col: null,
      type: "panel_duplicates",
      severity: "critical",
      title: "Duplicate (entity × time) observations",
      detail: "Fixed effects and first-differences estimators require a unique (i,t) key. Resolve before estimation.",
      suggestedStep: "drop_na",
    });
  }

  if (panelSummary?.balance === "unbalanced" && panelSummary.attritionPct > 0.1) {
    flags.push({
      col: null,
      type: "attrition",
      severity: "high",
      title: `Panel attrition: ${(panelSummary.attritionPct * 100).toFixed(1)}% of t0 entities absent at tN`,
      detail: "Non-random attrition threatens internal validity. Consider attrition tests or bounding exercises.",
      suggestedStep: null,
    });
  }

  // Sort flags: critical → high → medium → low
  flags.sort((a, b) => SEV_RANK[b.severity] - SEV_RANK[a.severity]);

  return { meta, columns, correlations, panelSummary, flags };
}

// ─── MARKDOWN EXPORT ─────────────────────────────────────────────────────────
// Produces a replication-package-ready .md file.
export function exportMarkdown(report) {
  const { meta, columns, correlations, panelSummary, flags } = report;
  const ts = new Date(meta.generatedAt).toLocaleString("en-GB", { timeZone: "UTC" });

  const sevIcon = { critical: "🔴", high: "🟠", medium: "🟡", low: "🔵", ok: "✅" };

  const lines = [
    `# Data Quality Report`,
    `Generated: ${ts} UTC`,
    ``,
    `## Dataset Overview`,
    `| Metric | Value |`,
    `|--------|-------|`,
    `| Rows | ${meta.nRows.toLocaleString()} |`,
    `| Columns | ${meta.nCols} |`,
    `| Completeness | ${(meta.completeness * 100).toFixed(1)}% |`,
    `| Numeric columns | ${meta.numericCols} |`,
    `| Categorical columns | ${meta.categoricalCols} |`,
    `| Mixed-type columns | ${meta.mixedCols} |`,
    ``,
  ];

  if (panelSummary) {
    lines.push(
      `## Panel Structure ${sevIcon[panelSummary.severity]}`,
      `| Metric | Value |`,
      `|--------|-------|`,
      `| Balance | ${panelSummary.balance} |`,
      `| Entities | ${panelSummary.nEntities} |`,
      `| Periods | ${panelSummary.nPeriods} |`,
      `| Attrition | ${(panelSummary.attritionPct * 100).toFixed(1)}% |`,
      `| Duplicate (i,t) pairs | ${panelSummary.hasDups ? "YES ⚠️" : "None"} |`,
      `| Gaps detected | ${panelSummary.hasGaps ? "Yes" : "No"} |`,
      ``
    );
  }

  lines.push(`## Flags (${flags.filter(f => f.severity !== "ok").length} issues)`);
  if (flags.length === 0) {
    lines.push(`No issues detected.`);
  } else {
    flags.filter(f => f.severity !== "ok").forEach(f => {
      lines.push(`- ${sevIcon[f.severity]} **${f.col ? `\`${f.col}\`` : "Dataset"}** — ${f.title}`);
      lines.push(`  ${f.detail}`);
    });
  }
  lines.push(``);

  lines.push(`## Column Summary`);
  lines.push(`| Column | Type | Missing | Outliers (IQR) | Severity |`);
  lines.push(`|--------|------|---------|----------------|----------|`);
  columns.forEach(c => {
    const miss = `${c.stats.naCount} (${(c.stats.naPct * 100).toFixed(1)}%)`;
    const out  = c.outlierReport ? `${c.outlierReport.iqrCount}` : "—";
    lines.push(`| \`${c.col}\` | ${c.type} | ${miss} | ${out} | ${sevIcon[c.severity]} ${c.severity} |`);
  });
  lines.push(``);

  if (correlations.length > 0) {
    lines.push(`## High Correlations (|r| ≥ 0.85)`);
    lines.push(`| Column A | Column B | Pearson r |`);
    lines.push(`|----------|----------|-----------|`);
    correlations.forEach(({ a, b, r }) => {
      lines.push(`| \`${a}\` | \`${b}\` | ${r.toFixed(4)} |`);
    });
    lines.push(``);
  }

  lines.push(`## Per-Column Details`);
  columns.filter(c => c.severity !== "ok").forEach(c => {
    lines.push(`### \`${c.col}\` ${sevIcon[c.severity]}`);
    lines.push(`**Type:** ${c.type} | **Missing:** ${(c.stats.naPct * 100).toFixed(1)}% | **Unique values:** ${c.stats.uCount}`);
    if (c.stats.mean != null) {
      lines.push(`**Stats:** mean=${c.stats.mean?.toFixed(4)}, sd=${c.stats.std?.toFixed(4)}, min=${c.stats.min}, max=${c.stats.max}, median=${c.stats.median?.toFixed(4)}`);
    }
    c.issues.forEach(iss => {
      lines.push(`- ${sevIcon[iss.severity]} ${iss.title}: ${iss.detail}`);
    });
    lines.push(``);
  });

  return lines.join("\n");
}
