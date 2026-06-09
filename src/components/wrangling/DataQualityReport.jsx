// ─── ECON STUDIO · components/wrangling/DataQualityReport.jsx ────────────────
// Visual data quality report. Consumes output of buildDataQualityReport().
// Pure SVG — no external charting libraries.
//
// Props:
//   report        DataQualityReport   — from buildDataQualityReport()
//   rows          object[]            — raw data rows (needed for Smart signals E1/E2/E3)
//   onApplyStep   fn(step)            — adds a step to the pipeline
//   onExportMd    fn()                — triggers markdown export

import { useState, useMemo } from "react";
import { useTheme } from "../../ThemeContext.jsx";
import {
  detectCoordIssues,
  detectCaseAnomalies,
  detectOCRContamination,
} from "../../core/validation/dataQuality.js";


// ─── SEVERITY PALETTE ─────────────────────────────────────────────────────────
function makeSEV(C) {
  return {
    critical: { color: "#e06c75", bg: C.surface,  border: "#e06c7530", icon: "●" },
    high:     { color: C.red,     bg: C.surface,  border: `${C.red}30`,    icon: "▲" },
    medium:   { color: C.yellow,  bg: C.surface,  border: `${C.yellow}30`, icon: "◆" },
    low:      { color: C.blue,    bg: C.surface,  border: `${C.blue}30`,   icon: "○" },
    ok:       { color: C.green,   bg: C.surface,  border: `${C.green}20`,  icon: "✓" },
  };
}

function SevBadge({ sev, sm = false }) {
  const { C, T } = useTheme();
  const SEV = makeSEV(C);
  const s = SEV[sev] || SEV.ok;
  return (
    <span style={{
      fontSize: sm ? 8 : 9, padding: sm ? "1px 4px" : "2px 6px",
      border: `1px solid ${s.color}`, color: s.color,
      borderRadius: 2, letterSpacing: "0.08em", fontFamily: T.code.fontFamily,
      whiteSpace: "nowrap", background: s.bg,
    }}>
      {s.icon} {sev}
    </span>
  );
}

// ─── MISSING HEATMAP ─────────────────────────────────────────────────────────
// SVG bar chart: one bar per column showing % missing
function MissingHeatmap({ columns }) {
  const { C, T } = useTheme();
  const cols = columns.filter(c => c.stats.naPct > 0).slice(0, 30);
  if (!cols.length) return (
    <div style={{ fontSize: T.code.fontSize, color: C.green, fontFamily: T.code.fontFamily, padding: "0.75rem 0" }}>
      ✓ No missing values detected
    </div>
  );

  const W = 520, BAR_H = 18, GAP = 3, LABEL_W = 120;
  const H = cols.length * (BAR_H + GAP) + 20;

  return (
    <svg width="100%" viewBox={`0 0 ${W} ${H}`} style={{ fontFamily: T.code.fontFamily, overflow: "visible" }}>
      {cols.map((c, i) => {
        const pct  = c.stats.naPct;
        const barW = Math.max(2, (W - LABEL_W - 60) * pct);
        const col  = pct > 0.3 ? C.red : pct > 0.1 ? C.yellow : C.blue;
        const y    = i * (BAR_H + GAP);
        return (
          <g key={c.col}>
            {/* Column label */}
            <text x={LABEL_W - 6} y={y + BAR_H * 0.72}
              textAnchor="end" fontSize={T.caption.fontSize} fill={C.textDim}
              style={{ fontFamily: T.code.fontFamily }}>
              {c.col.length > 14 ? c.col.slice(0, 13) + "…" : c.col}
            </text>
            {/* Background track */}
            <rect x={LABEL_W} y={y} width={W - LABEL_W - 55} height={BAR_H}
              fill={C.surface2} rx={2} />
            {/* Fill bar */}
            <rect x={LABEL_W} y={y} width={barW} height={BAR_H}
              fill={col} opacity={0.75} rx={2} />
            {/* Percentage label */}
            <text x={LABEL_W + (W - LABEL_W - 55) + 6} y={y + BAR_H * 0.72}
              fontSize={T.caption.fontSize} fill={col} style={{ fontFamily: T.code.fontFamily }}>
              {(pct * 100).toFixed(1)}%
            </text>
            {/* Systematic marker */}
            {c.missingPattern?.isSystematic && (
              <text x={W - 8} y={y + BAR_H * 0.72}
                fontSize={T.caption.fontSize} fill={C.orange} textAnchor="end"
                style={{ fontFamily: T.code.fontFamily }}>sys</text>
            )}
          </g>
        );
      })}
    </svg>
  );
}

// ─── CORRELATION MATRIX ───────────────────────────────────────────────────────
function CorrelationList({ pairs }) {
  const { C, T } = useTheme();
  if (!pairs.length) return (
    <div style={{ fontSize: T.code.fontSize, color: C.green, fontFamily: T.code.fontFamily, padding: "0.75rem 0" }}>
      ✓ No high correlations detected (threshold |r| ≥ 0.85)
    </div>
  );
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
      {pairs.map(({ a, b, r }, i) => {
        const abs  = Math.abs(r);
        const col  = abs > 0.95 ? C.red : C.yellow;
        const pct  = abs * 100;
        return (
          <div key={i} style={{
            padding: "0.5rem 0.75rem", background: C.surface2,
            border: `1px solid ${C.border}`, borderLeft: `3px solid ${col}`,
            borderRadius: 3,
          }}>
            <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 4 }}>
              <span style={{ fontSize: T.code.fontSize, color: C.text, fontFamily: T.code.fontFamily, flex: 1 }}>
                <span style={{ color: col }}>{a}</span>
                <span style={{ color: C.textMuted }}> × </span>
                <span style={{ color: col }}>{b}</span>
              </span>
              <span style={{ fontSize: T.code.fontSize, color: col, fontFamily: T.code.fontFamily, fontWeight: 700 }}>
                r = {r.toFixed(3)}
              </span>
            </div>
            {/* Correlation bar */}
            <div style={{ height: 3, background: C.border, borderRadius: 2, overflow: "hidden" }}>
              <div style={{ width: `${pct}%`, height: "100%", background: col, borderRadius: 2 }} />
            </div>
            <div style={{ fontSize: T.caption.fontSize, color: C.textMuted, fontFamily: T.code.fontFamily, marginTop: 4 }}>
              {abs > 0.95
                ? "Near-perfect collinearity — including both will likely cause identification failure."
                : "Strong correlation — VIF may be elevated. Consider dropping one or constructing a composite."}
            </div>
          </div>
        );
      })}
    </div>
  );
}

// ─── COLUMN DETAIL CARD ───────────────────────────────────────────────────────
function ColDetail({ col, onApplyStep }) {
  const { C, T } = useTheme();
  const SEV = makeSEV(C);
  const s   = col.stats;
  const sev = SEV[col.severity] || SEV.ok;

  return (
    <div style={{
      border: `1px solid ${sev.border}`,
      borderLeft: `3px solid ${sev.color}`,
      borderRadius: 4, background: sev.bg,
      padding: "0.75rem 1rem", marginBottom: 8,
    }}>
      {/* Header row */}
      <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 6 }}>
        <span style={{ fontSize: T.body.fontSize, color: sev.color, fontFamily: T.code.fontFamily, flex: 1 }}>
          {col.col}
        </span>
        <span style={{ fontSize: T.caption.fontSize, color: C.textMuted, fontFamily: T.code.fontFamily, padding: "1px 5px",
          border: `1px solid ${C.border2}`, borderRadius: 2 }}>
          {col.type}
        </span>
        <SevBadge sev={col.severity} sm />
      </div>

      {/* Stats row */}
      {s.mean != null && (
        <div style={{ display: "flex", gap: 16, marginBottom: 8, flexWrap: "wrap" }}>
          {[
            ["mean",   s.mean?.toFixed(4)],
            ["sd",     s.std?.toFixed(4)],
            ["median", s.median?.toFixed(4)],
            ["min",    s.min],
            ["max",    s.max],
            ["n",      s.total],
            ["NA",     `${(s.naPct * 100).toFixed(1)}%`],
          ].map(([label, val]) => val != null && (
            <div key={label} style={{ fontSize: T.caption.fontSize, fontFamily: T.code.fontFamily }}>
              <span style={{ color: C.textMuted }}>{label} </span>
              <span style={{ color: C.text }}>{val}</span>
            </div>
          ))}
        </div>
      )}

      {/* Outlier detail */}
      {col.outlierReport && col.outlierReport.iqrCount > 0 && (
        <div style={{ fontSize: T.caption.fontSize, color: C.textMuted, fontFamily: T.code.fontFamily, marginBottom: 6, lineHeight: 1.6 }}>
          <span style={{ color: C.orange }}>IQR outliers: {col.outlierReport.iqrCount}</span>
          {" · z-score (|z|>3): "}{col.outlierReport.zCount}
          {" · skew: "}<span style={{ color: Math.abs(col.outlierReport.skewness) > 1 ? C.yellow : C.textMuted }}>
            {col.outlierReport.skewLabel} ({col.outlierReport.skewness.toFixed(2)})
          </span>
          <br />
          Extreme low: [{col.outlierReport.extremeLow.map(v => typeof v === "number" ? v.toFixed(3) : v).join(", ")}]
          {" · "}
          Extreme high: [{col.outlierReport.extremeHigh.map(v => typeof v === "number" ? v.toFixed(3) : v).join(", ")}]
        </div>
      )}

      {/* Issues + action buttons */}
      <div style={{ display: "flex", flexDirection: "column", gap: 5 }}>
        {col.issues.map((iss, i) => (
          <div key={i} style={{
            display: "flex", alignItems: "flex-start", gap: 8,
            padding: "0.4rem 0.6rem", background: C.surface,
            border: `1px solid ${C.border}`, borderRadius: 3,
          }}>
            <div style={{ flex: 1 }}>
              <div style={{ fontSize: T.code.fontSize, color: (SEV[iss.severity] || SEV.ok).color, fontFamily: T.code.fontFamily, marginBottom: 2 }}>
                {iss.title}
              </div>
              <div style={{ fontSize: T.caption.fontSize, color: C.textMuted, lineHeight: 1.5 }}>{iss.detail}</div>
            </div>
            {iss.suggestedStep && onApplyStep && (
              <button
                onClick={() => {
                  const step = { type: iss.suggestedStep, col: col.col };
                  // Enrich step with sensible defaults for common cases
                  if (iss.suggestedStep === "winz" && col.stats.q1 != null) {
                    const iqr = col.stats.iqr || 0;
                    step.lo = col.stats.q1 - 1.5 * iqr;
                    step.hi = col.stats.q3 + 1.5 * iqr;
                    step.nn = col.col;
                  }
                  if (iss.suggestedStep === "fill_na") {
                    step.strategy = col.stats.mean != null ? "mean" : "mode";
                  }
                  if (iss.suggestedStep === "drop_na") {
                    step.cols = [col.col];
                    step.how  = "any";
                  }
                  if (iss.suggestedStep === "type_cast") {
                    step.to = "number";
                  }
                  onApplyStep({ ...step, desc: `${iss.suggestedStep} ${col.col}` });
                }}
                style={{
                  padding: "0.25rem 0.6rem", borderRadius: 3, cursor: "pointer",
                  fontFamily: T.code.fontFamily, fontSize: T.caption.fontSize, flexShrink: 0,
                  background: "transparent",
                  border: `1px solid ${(SEV[iss.severity] || SEV.ok).color}`,
                  color: (SEV[iss.severity] || SEV.ok).color,
                  transition: "all 0.12s",
                }}
              >
                Fix →
              </button>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}

// ─── META SUMMARY BAR ─────────────────────────────────────────────────────────
function MetaBar({ meta, panelSummary }) {
  const { C, T } = useTheme();
  const comp     = meta.completeness;
  const compCol  = comp > 0.95 ? C.green : comp > 0.8 ? C.yellow : C.red;

  return (
    <div style={{
      display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(120px, 1fr))",
      gap: 8, marginBottom: "1.4rem",
    }}>
      {[
        ["rows",         meta.nRows.toLocaleString(),              C.text],
        ["columns",      meta.nCols,                               C.text],
        ["completeness", `${(comp * 100).toFixed(1)}%`,            compCol],
        ["numeric",      meta.numericCols,                         C.blue],
        ["categorical",  meta.categoricalCols,                     C.purple],
        ["mixed type",   meta.mixedCols,                           meta.mixedCols > 0 ? C.orange : C.textMuted],
      ].map(([label, val, color]) => (
        <div key={label} style={{
          padding: "0.65rem 0.8rem", background: C.surface2,
          border: `1px solid ${C.border}`, borderRadius: 3, textAlign: "center",
        }}>
          <div style={{ fontSize: T.h2.fontSize, color, fontFamily: T.code.fontFamily, marginBottom: 2 }}>{val}</div>
          <div style={{ fontSize: T.caption.fontSize, color: C.textMuted, fontFamily: T.code.fontFamily, letterSpacing: "0.1em", textTransform: "uppercase" }}>{label}</div>
        </div>
      ))}

      {panelSummary && (() => {
        const ps  = panelSummary;
        const col = ps.severity === "critical" ? C.red : ps.severity === "high" ? C.yellow : ps.severity === "medium" ? C.yellow : C.green;
        return (
          <div style={{
            padding: "0.65rem 0.8rem", background: C.surface2,
            border: `1px solid ${col}30`, borderRadius: 3, textAlign: "center",
            gridColumn: "span 2",
          }}>
            <div style={{ fontSize: T.code.fontSize, color: col, fontFamily: T.code.fontFamily, marginBottom: 3 }}>
              {ps.balance === "strongly_balanced" ? "✓ Balanced panel" : "⚠ Unbalanced panel"}
            </div>
            <div style={{ fontSize: T.caption.fontSize, color: C.textMuted, fontFamily: T.code.fontFamily }}>
              {ps.nEntities} entities · {ps.nPeriods} periods
              {ps.hasDups && " · DUPLICATES ⚠"}
              {ps.attritionPct > 0 && ` · ${(ps.attritionPct * 100).toFixed(0)}% attrition`}
            </div>
          </div>
        );
      })()}
    </div>
  );
}

// ─── SECTION HEADER ───────────────────────────────────────────────────────────
function SectionHeader({ title, count, color }) {
  const { C, T } = useTheme();
  color = color ?? C.gold;
  return (
    <div style={{
      display: "flex", alignItems: "center", gap: 8,
      marginBottom: "0.8rem", paddingBottom: "0.4rem",
      borderBottom: `1px solid ${C.border}`,
    }}>
      <span style={{ fontSize: T.caption.fontSize, color, letterSpacing: "0.18em", textTransform: "uppercase", fontFamily: T.code.fontFamily }}>
        {title}
      </span>
      {count != null && (
        <span style={{ fontSize: T.caption.fontSize, color: C.textMuted, fontFamily: T.code.fontFamily }}>
          ({count})
        </span>
      )}
    </div>
  );
}

// ─── E-TRACK: SMART QUALITY SIGNALS ──────────────────────────────────────────
// Runs E1/E2/E3 checks lazily (only when this component mounts or rows change).
// Surfaces signals as colored badges per column.
const COORD_COLS = /^(lat(itude)?|lon(gitude)?|x|y)$/i;
const CAT_COL_THRESHOLD = 0.05; // 5% case anomaly rate triggers warning

function SmartQualitySignals({ columns, rows }) {
  const { C, T } = useTheme();

  const signals = useMemo(() => {
    const out = [];

    columns.forEach(colReport => {
      const col = colReport.col;

      // E1 — coord issues: only for coord-named numeric columns
      if (COORD_COLS.test(col.trim())) {
        const result = detectCoordIssues(rows, col);
        if (result.badRows.length > 0) {
          out.push({
            type: "coord",
            col,
            count: result.badRows.length,
            sample: result.sample,
          });
        }
      }

      // E2 — case anomalies: only for categorical (string) columns
      if (colReport.type === "categorical" || colReport.type === "mixed") {
        const result = detectCaseAnomalies(rows, col);
        if (result.rate > CAT_COL_THRESHOLD && result.anomalies.length > 0) {
          out.push({
            type: "case",
            col,
            rate: result.rate,
            anomalies: result.anomalies,
          });
        }
      }

      // E3 — OCR contamination: only for categorical/mixed columns
      if (colReport.type === "categorical" || colReport.type === "mixed") {
        const result = detectOCRContamination(rows, col);
        if (result.hits.length > 0) {
          out.push({
            type: "ocr",
            col,
            hits: result.hits,
            rate: result.rate,
          });
        }
      }
    });

    return out;
  }, [columns, rows]);

  if (!signals.length) {
    return (
      <div style={{ fontSize: T.code.fontSize, color: C.green, fontFamily: T.code.fontFamily, padding: "0.75rem 0" }}>
        ✓ No smart quality signals detected.
      </div>
    );
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
      {signals.map((sig, i) => {
        if (sig.type === "coord") {
          return (
            <div key={i} style={{
              padding: "0.55rem 0.85rem",
              background: `${C.orange}0d`,
              border: `1px solid ${C.orange}40`,
              borderLeft: `3px solid ${C.orange}`,
              borderRadius: 3,
              display: "flex", alignItems: "flex-start", gap: 10,
            }}>
              <div style={{ flex: 1 }}>
                <div style={{ fontSize: T.code.fontSize, color: C.orange, fontFamily: T.code.fontFamily, marginBottom: 3 }}>
                  ⚠ {sig.count} malformed coordinate{sig.count > 1 ? "s" : ""} in{" "}
                  <span style={{ color: C.text }}>{sig.col}</span>
                </div>
                {sig.sample.length > 0 && (
                  <div style={{ fontSize: T.caption.fontSize, color: C.textMuted, fontFamily: T.code.fontFamily }}>
                    Samples: {sig.sample.map(s => (
                      <span key={s} style={{
                        marginRight: 6, padding: "1px 5px",
                        background: C.surface2, border: `1px solid ${C.border}`,
                        borderRadius: 2, color: C.red,
                      }}>{s}</span>
                    ))}
                  </div>
                )}
              </div>
              <span style={{
                fontSize: T.caption.fontSize, padding: "2px 6px", borderRadius: 2, flexShrink: 0,
                background: `${C.orange}20`, border: `1px solid ${C.orange}50`,
                color: C.orange, fontFamily: T.code.fontFamily, letterSpacing: "0.08em",
              }}>E1 COORD</span>
            </div>
          );
        }

        if (sig.type === "case") {
          return (
            <div key={i} style={{
              padding: "0.55rem 0.85rem",
              background: `${C.yellow}0a`,
              border: `1px solid ${C.yellow}35`,
              borderLeft: `3px solid ${C.yellow}`,
              borderRadius: 3,
              display: "flex", alignItems: "flex-start", gap: 10,
            }}>
              <div style={{ flex: 1 }}>
                <div style={{ fontSize: T.code.fontSize, color: C.yellow, fontFamily: T.code.fontFamily, marginBottom: 3 }}>
                  ⚠ {(sig.rate * 100).toFixed(1)}% case anomalies in{" "}
                  <span style={{ color: C.text }}>{sig.col}</span>
                </div>
                {sig.anomalies.length > 0 && (
                  <div style={{ fontSize: T.caption.fontSize, color: C.textMuted, fontFamily: T.code.fontFamily }}>
                    Examples: {sig.anomalies.slice(0, 5).map(s => (
                      <span key={s} style={{
                        marginRight: 6, padding: "1px 5px",
                        background: C.surface2, border: `1px solid ${C.border}`,
                        borderRadius: 2, color: C.yellow,
                      }}>{s}</span>
                    ))}
                    {sig.anomalies.length > 5 && (
                      <span style={{ color: C.textMuted }}> +{sig.anomalies.length - 5} more</span>
                    )}
                  </div>
                )}
              </div>
              <span style={{
                fontSize: T.caption.fontSize, padding: "2px 6px", borderRadius: 2, flexShrink: 0,
                background: `${C.yellow}18`, border: `1px solid ${C.yellow}40`,
                color: C.yellow, fontFamily: T.code.fontFamily, letterSpacing: "0.08em",
              }}>E2 CASE</span>
            </div>
          );
        }

        if (sig.type === "ocr") {
          return (
            <div key={i} style={{
              padding: "0.55rem 0.85rem",
              background: `${C.red}0a`,
              border: `1px solid ${C.red}35`,
              borderLeft: `3px solid ${C.red}`,
              borderRadius: 3,
              display: "flex", alignItems: "flex-start", gap: 10,
            }}>
              <div style={{ flex: 1 }}>
                <div style={{ fontSize: T.code.fontSize, color: C.red, fontFamily: T.code.fontFamily, marginBottom: 3 }}>
                  ⚠ {sig.hits.length} OCR substitution{sig.hits.length > 1 ? "s" : ""} detected in{" "}
                  <span style={{ color: C.text }}>{sig.col}</span>
                </div>
                {sig.hits.length > 0 && (
                  <div style={{ fontSize: T.caption.fontSize, color: C.textMuted, fontFamily: T.code.fontFamily, lineHeight: 1.7 }}>
                    {sig.hits.slice(0, 4).map((h, hi) => (
                      <span key={hi} style={{ marginRight: 10 }}>
                        <span style={{ color: C.red }}>{h.original}</span>
                        <span style={{ color: C.border2, margin: "0 3px" }}>→</span>
                        <span style={{ color: C.green }}>{h.suggested}</span>
                      </span>
                    ))}
                    {sig.hits.length > 4 && (
                      <span style={{ color: C.textMuted }}>+{sig.hits.length - 4} more</span>
                    )}
                  </div>
                )}
              </div>
              <span style={{
                fontSize: T.caption.fontSize, padding: "2px 6px", borderRadius: 2, flexShrink: 0,
                background: `${C.red}18`, border: `1px solid ${C.red}40`,
                color: C.red, fontFamily: T.code.fontFamily, letterSpacing: "0.08em",
              }}>E3 OCR</span>
            </div>
          );
        }

        return null;
      })}
    </div>
  );
}

// ─── MAIN COMPONENT ───────────────────────────────────────────────────────────
export default function DataQualityReport({ report, rows = [], onApplyStep, onExportMd }) {
  const { C, T } = useTheme();
  const SEV = makeSEV(C);
  const [section, setSection] = useState("flags");

  if (!report) return (
    <div style={{ padding: "2rem", textAlign: "center", color: C.textMuted, fontFamily: T.code.fontFamily, fontSize: T.code.fontSize }}>
      Run quality scan to see results.
    </div>
  );

  const { meta, columns, correlations, panelSummary, flags } = report;
  const criticalCount = flags.filter(f => f.severity === "critical").length;
  const highCount     = flags.filter(f => f.severity === "high").length;
  const issueCount    = flags.filter(f => f.severity !== "ok").length;

  const sections = [
    ["flags",    `⚑ Flags`,         issueCount > 0 ? `${issueCount}` : null],
    ["missing",  `⬡ Missing`,        null],
    ["outliers", `◆ Outliers`,       null],
    ["corr",     `× Correlations`,   correlations.length > 0 ? `${correlations.length}` : null],
    ["columns",  `▤ All columns`,    `${columns.length}`],
    ["smart",    `◉ Smart`,          null],
  ];

  return (
    <div style={{ fontFamily: T.code.fontFamily }}>
      {/* Meta summary */}
      <MetaBar meta={meta} panelSummary={panelSummary} />

      {/* Critical banner */}
      {criticalCount > 0 && (
        <div style={{
          padding: "0.65rem 1rem", marginBottom: "1rem",
          background: C.surface, border: `1px solid ${C.red}40`,
          borderLeft: `4px solid ${C.red}`, borderRadius: 4,
          display: "flex", alignItems: "center", gap: 10,
        }}>
          <span style={{ fontSize: T.body.fontSize, color: C.red }}>●</span>
          <div style={{ flex: 1 }}>
            <div style={{ fontSize: T.code.fontSize, color: C.red, fontFamily: T.code.fontFamily }}>
              {criticalCount} critical issue{criticalCount > 1 ? "s" : ""} detected
            </div>
            <div style={{ fontSize: T.caption.fontSize, color: C.textMuted, marginTop: 2 }}>
              These must be resolved before running any estimator.
            </div>
          </div>
          {onExportMd && (
            <button onClick={onExportMd} style={{
              padding: "0.3rem 0.75rem", borderRadius: 3, cursor: "pointer",
              fontFamily: T.code.fontFamily, fontSize: T.caption.fontSize, background: "transparent",
              border: `1px solid ${C.border2}`, color: C.textDim,
            }}>
              ↓ Export .md
            </button>
          )}
        </div>
      )}

      {/* Export button (no critical issues) */}
      {criticalCount === 0 && onExportMd && (
        <div style={{ display: "flex", justifyContent: "flex-end", marginBottom: "0.8rem" }}>
          <button onClick={onExportMd} style={{
            padding: "0.28rem 0.7rem", borderRadius: 3, cursor: "pointer",
            fontFamily: T.code.fontFamily, fontSize: T.caption.fontSize, background: "transparent",
            border: `1px solid ${C.border2}`, color: C.textDim,
            transition: "all 0.12s",
          }}>
            ↓ Export report (.md)
          </button>
        </div>
      )}

      {/* Section tabs */}
      <div style={{
        display: "flex", gap: 1, background: C.border,
        borderRadius: 4, overflow: "hidden", marginBottom: "1.2rem",
      }}>
        {sections.map(([key, label, badge]) => (
          <button key={key} onClick={() => setSection(key)} style={{
            flex: 1, padding: "0.5rem 0.4rem",
            background: section === key ? C.goldFaint : C.surface,
            border: "none",
            color: section === key ? C.gold : C.textDim,
            cursor: "pointer", fontFamily: T.code.fontFamily, fontSize: T.caption.fontSize,
            borderBottom: section === key ? `2px solid ${C.gold}` : "2px solid transparent",
            transition: "all 0.12s", whiteSpace: "nowrap",
          }}>
            {label}
            {badge && (
              <span style={{
                marginLeft: 4, fontSize: T.caption.fontSize, padding: "1px 4px",
                background: C.goldFaint, border: `1px solid ${C.goldDim}`,
                borderRadius: 2, color: C.gold,
              }}>
                {badge}
              </span>
            )}
          </button>
        ))}
      </div>

      {/* ── FLAGS ── */}
      {section === "flags" && (
        <div>
          <SectionHeader title="Actionable flags" count={issueCount} color={C.gold} />
          {issueCount === 0 ? (
            <div style={{ fontSize: T.code.fontSize, color: C.green, fontFamily: T.code.fontFamily, padding: "0.75rem 0" }}>
              ✓ No issues detected — dataset looks clean.
            </div>
          ) : (
            <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
              {flags.filter(f => f.severity !== "ok").map((f, i) => {
                const sev = SEV[f.severity] || SEV.ok;
                return (
                  <div key={i} style={{
                    padding: "0.6rem 0.9rem", background: sev.bg,
                    border: `1px solid ${sev.border}`,
                    borderLeft: `3px solid ${sev.color}`, borderRadius: 3,
                  }}>
                    <div style={{ display: "flex", alignItems: "flex-start", gap: 8 }}>
                      <div style={{ flex: 1 }}>
                        <div style={{ fontSize: T.code.fontSize, color: sev.color, fontFamily: T.code.fontFamily, marginBottom: 3 }}>
                          {f.col && <span style={{ color: C.textDim }}>[{f.col}] </span>}
                          {f.title}
                        </div>
                        <div style={{ fontSize: T.caption.fontSize, color: C.textMuted, lineHeight: 1.5 }}>{f.detail}</div>
                      </div>
                      <SevBadge sev={f.severity} sm />
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      )}

      {/* ── MISSING ── */}
      {section === "missing" && (
        <div>
          <SectionHeader title="Missing values by column" color={C.blue} />
          <MissingHeatmap columns={columns} />
          {columns.filter(c => c.missingPattern?.isSystematic).length > 0 && (
            <div style={{
              marginTop: "1rem", padding: "0.5rem 0.75rem",
              background: `${C.orange}0a`, border: `1px solid ${C.orange}30`,
              borderRadius: 3, fontSize: T.caption.fontSize, color: C.orange, fontFamily: T.code.fontFamily, lineHeight: 1.6,
            }}>
              ⚠ Systematic missingness detected in: {
                columns.filter(c => c.missingPattern?.isSystematic).map(c => c.col).join(", ")
              } — likely a merge artifact or data truncation. Verify data source.
            </div>
          )}
        </div>
      )}

      {/* ── OUTLIERS ── */}
      {section === "outliers" && (
        <div>
          <SectionHeader title="Outlier summary — numeric columns" color={C.orange} />
          {columns.filter(c => c.outlierReport && c.outlierReport.iqrCount > 0).length === 0 ? (
            <div style={{ fontSize: T.code.fontSize, color: C.green, fontFamily: T.code.fontFamily, padding: "0.75rem 0" }}>
              ✓ No IQR-based outliers detected in any numeric column.
            </div>
          ) : (
            <div>
              <div style={{
                display: "grid",
                gridTemplateColumns: "repeat(auto-fill, minmax(260px, 1fr))",
                gap: 8,
              }}>
                {columns
                  .filter(c => c.outlierReport && c.outlierReport.iqrCount > 0)
                  .map(c => {
                    const o   = c.outlierReport;
                    const col = o.iqrPct > 0.05 ? C.red : C.orange;
                    return (
                      <div key={c.col} style={{
                        padding: "0.65rem 0.8rem", background: C.surface2,
                        border: `1px solid ${C.border}`, borderLeft: `3px solid ${col}`,
                        borderRadius: 3,
                      }}>
                        <div style={{ fontSize: T.code.fontSize, color: col, fontFamily: T.code.fontFamily, marginBottom: 5 }}>
                          {c.col}
                        </div>
                        <div style={{ fontSize: T.caption.fontSize, color: C.textMuted, fontFamily: T.code.fontFamily, lineHeight: 1.7 }}>
                          <span style={{ color: C.text }}>IQR:</span> {o.iqrCount} ({(o.iqrPct * 100).toFixed(1)}%)<br />
                          <span style={{ color: C.text }}>z-score:</span> {o.zCount}<br />
                          <span style={{ color: C.text }}>skew:</span>{" "}
                          <span style={{ color: Math.abs(o.skewness) > 1 ? C.yellow : C.textMuted }}>
                            {o.skewLabel}
                          </span>
                          <br />
                          <span style={{ color: C.text }}>low extremes:</span> [{o.extremeLow.map(v => typeof v === "number" ? v.toFixed(2) : v).join(", ")}]<br />
                          <span style={{ color: C.text }}>high extremes:</span> [{o.extremeHigh.map(v => typeof v === "number" ? v.toFixed(2) : v).join(", ")}]
                        </div>
                        {onApplyStep && (
                          <button onClick={() => onApplyStep({
                            type: "winz", col: c.col,
                            lo: c.stats.q1 - 1.5 * c.stats.iqr,
                            hi: c.stats.q3 + 1.5 * c.stats.iqr,
                            nn: c.col,
                            desc: `winsorize ${c.col}`,
                          })} style={{
                            marginTop: 8, padding: "0.22rem 0.6rem",
                            borderRadius: 3, cursor: "pointer", fontFamily: T.code.fontFamily,
                            fontSize: T.caption.fontSize, background: "transparent",
                            border: `1px solid ${col}`, color: col,
                          }}>
                            Winsorize →
                          </button>
                        )}
                      </div>
                    );
                  })}
              </div>
            </div>
          )}
        </div>
      )}

      {/* ── CORRELATIONS ── */}
      {section === "corr" && (
        <div>
          <SectionHeader title="High correlations (|r| ≥ 0.85)" count={correlations.length} color={C.yellow} />
          <CorrelationList pairs={correlations} />
        </div>
      )}

      {/* ── ALL COLUMNS ── */}
      {section === "columns" && (
        <div>
          <SectionHeader title="All columns" count={columns.length} color={C.teal} />
          {/* Summary table */}
          <div style={{ overflowX: "auto", marginBottom: "1.2rem" }}>
            <table style={{ borderCollapse: "collapse", fontSize: T.caption.fontSize, width: "100%", fontFamily: T.code.fontFamily }}>
              <thead>
                <tr style={{ background: C.surface2 }}>
                  {["Column", "Type", "Missing", "Outliers (IQR)", "Unique", "Severity"].map(h => (
                    <th key={h} style={{
                      padding: "0.4rem 0.6rem", textAlign: "left", fontWeight: 400,
                      color: C.textMuted, borderBottom: `1px solid ${C.border}`,
                      whiteSpace: "nowrap", fontSize: T.caption.fontSize, letterSpacing: "0.1em",
                    }}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {columns.map((c, i) => (
                  <tr key={c.col} style={{ background: i % 2 ? C.surface2 : C.surface }}>
                    <td style={{ padding: "0.35rem 0.6rem", color: C.text, borderBottom: `1px solid ${C.border}` }}>{c.col}</td>
                    <td style={{ padding: "0.35rem 0.6rem", color: C.textMuted, borderBottom: `1px solid ${C.border}` }}>{c.type}</td>
                    <td style={{ padding: "0.35rem 0.6rem", borderBottom: `1px solid ${C.border}` }}>
                      <span style={{ color: c.stats.naPct > 0.1 ? C.red : c.stats.naPct > 0 ? C.yellow : C.green }}>
                        {c.stats.naCount} ({(c.stats.naPct * 100).toFixed(1)}%)
                      </span>
                    </td>
                    <td style={{ padding: "0.35rem 0.6rem", color: c.outlierReport?.iqrCount > 0 ? C.orange : C.textMuted, borderBottom: `1px solid ${C.border}` }}>
                      {c.outlierReport ? c.outlierReport.iqrCount : "—"}
                    </td>
                    <td style={{ padding: "0.35rem 0.6rem", color: C.textMuted, borderBottom: `1px solid ${C.border}` }}>{c.stats.uCount}</td>
                    <td style={{ padding: "0.35rem 0.6rem", borderBottom: `1px solid ${C.border}` }}>
                      <SevBadge sev={c.severity} sm />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {/* Detail cards — only non-ok columns */}
          {columns.filter(c => c.severity !== "ok").map(c => (
            <ColDetail key={c.col} col={c} onApplyStep={onApplyStep} />
          ))}
        </div>
      )}

      {/* ── SMART QUALITY SIGNALS ── */}
      {section === "smart" && (
        <div>
          <SectionHeader title="Smart quality signals — E1 Coord · E2 Case · E3 OCR" color={C.teal} />
          <div style={{
            fontSize: T.caption.fontSize, color: C.textMuted, fontFamily: T.code.fontFamily, lineHeight: 1.6,
            marginBottom: "1rem", padding: "0.5rem 0.75rem",
            background: C.surface2, border: `1px solid ${C.border}`, borderRadius: 3,
          }}>
            E1: malformed lat/lon/x/y coordinates (multi-dot, out-of-range).{" "}
            E2: mixed-case anomalies (e.g. "mARTIN", "ArgEntina") in string columns.{" "}
            E3: OCR substitution errors (0↔O, 1→I, rn→m, cl→d, etc.).
          </div>
          <SmartQualitySignals columns={columns} rows={rows} />
        </div>
      )}
    </div>
  );
}
