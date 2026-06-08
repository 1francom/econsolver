// ─── ECON STUDIO · src/components/modeling/ExtractPanel.jsx ───────────────────
// Collapsible panel shown at the bottom of each result block.
// Lets users save model outputs (fitted, residuals, first-stage fitted, SC gap)
// back to the working dataset as inject_column pipeline steps.
//
// Props:
//   result      {object}  — estimation result (type, beta, resid, Yhat, firstStages, etc.)
//   nRows       {number}  — FULL dataset row count the inject_column step will replay
//                           against (not the 500-row preview). Extraction is only
//                           offered when the result arrays span every row.
//   yVar        {string}  — outcome variable name (for column naming)
//   xVars       {string[]}— regressor names (for naming first-stage columns)
//   onExtract   {fn}      — (colName: string, values: number[]) => void

import { useState } from "react";
import { useTheme } from "./shared.jsx";

export default function ExtractPanel({ result, nRows, yVar, xVars, onExtract }) {
  const { C, T } = useTheme();
  const [open, setOpen] = useState(false);

  if (!result || !nRows) return null;

  // Build list of extractable columns based on result type
  const columns = buildExtractColumns(result, yVar, xVars);
  if (!columns.length) return null;

  // Alignment against the FULL dataset: inject_column replays on rawData and
  // requires values.length === full row count. Residual/fitted arrays only span
  // the rows used in estimation, so NA-dropped or SQL-sampled results (length <
  // nRows) are correctly blocked here — they cannot be spliced back row-for-row.
  const aligned = result.resid?.length === nRows || result.Yhat?.length === nRows;

  return (
    <div style={{
      marginTop: "1.2rem",
      border: `1px solid ${C.border}`,
      borderRadius: 4,
      background: C.surface2,
    }}>
      {/* Header */}
      <button
        onClick={() => setOpen(v => !v)}
        style={{
          width: "100%", display: "flex", alignItems: "center", justifyContent: "space-between",
          padding: "7px 12px", background: "transparent", border: "none",
          cursor: "pointer", fontFamily: T.code.fontFamily,
        }}
      >
        <span style={{ fontSize: T.caption.fontSize, letterSpacing: "0.18em", textTransform: "uppercase", color: C.textMuted }}>
          Extract to dataset
        </span>
        <span style={{ fontSize: T.caption.fontSize, color: C.textMuted }}>{open ? "▲" : "▼"}</span>
      </button>

      {open && (
        <div style={{ padding: "0 12px 12px" }}>
          {!aligned && (
            <div style={{ fontSize: T.caption.fontSize, color: C.orange, marginBottom: 8 }}>
              ⚠ Row count mismatch — re-run estimation before extracting.
            </div>
          )}
          <div style={{ fontSize: T.caption.fontSize, color: C.textMuted, marginBottom: 8, lineHeight: 1.6 }}>
            Saves a column to the current dataset as a pipeline step.
            Use extracted columns as inputs to a second estimator.
          </div>
          {columns.map(col => (
            <div key={col.name} style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 6 }}>
              <div>
                <span style={{ fontFamily: T.code.fontFamily, fontSize: T.code.fontSize, color: C.teal }}>{col.name}</span>
                <span style={{ fontSize: T.caption.fontSize, color: C.textMuted, marginLeft: 8 }}>{col.label}</span>
              </div>
              <button
                disabled={!aligned}
                onClick={() => aligned && onExtract(col.name, col.values)}
                style={{
                  fontSize: T.caption.fontSize, fontFamily: T.code.fontFamily, letterSpacing: "0.08em",
                  padding: "2px 10px", borderRadius: 3, cursor: aligned ? "pointer" : "not-allowed",
                  border: `1px solid ${C.teal}`, background: "transparent", color: C.teal,
                  opacity: aligned ? 1 : 0.35,
                }}
              >
                Add
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// Build the list of extractable columns for a given result type
function buildExtractColumns(result, yVar, xVars) {
  const cols = [];
  const y = yVar ?? "y";

  // Fitted values (Yhat / mu)
  if (result.Yhat?.length) {
    cols.push({ name: `${y}__hat`, label: "Fitted values (Ŷ)", values: result.Yhat });
  }
  // Residuals
  if (result.resid?.length) {
    cols.push({ name: `${y}__resid`, label: "Residuals (ê)", values: result.resid });
  }
  // Leverage (h_ii) — only for OLS
  if (result.leverage?.length) {
    cols.push({ name: `${y}__leverage`, label: "Leverage (hᵢᵢ)", values: result.leverage });
  }
  // First-stage fitted values (2SLS / IV-Poisson)
  if (result.firstStages?.length) {
    result.firstStages.forEach(fs => {
      if (fs?.Yhat?.length) {
        cols.push({
          name: `${fs.endVar}__hat1s`,
          label: `First-stage fitted (${fs.endVar})`,
          values: fs.Yhat,
        });
      }
    });
  }
  // Synthetic Control gap
  if (result.type === "SyntheticControl" && result.gapSeries?.length) {
    cols.push({ name: "sc__gap", label: "SC gap (y − ŷ_SC)", values: result.gapSeries.map(g => g.gap) });
  }
  // Poisson fitted rate
  if (["Poisson","PoissonFE","IVPoisson","SunAbraham"].includes(result.type) && result.Yhat?.length) {
    // Rename the Yhat entry to mu for Poisson types
    const idx = cols.findIndex(c => c.name === `${y}__hat`);
    if (idx >= 0) cols[idx].name = `${y}__mu`;
  }

  return cols;
}
