// ─── ECON STUDIO · src/components/modeling/EstimatorSidebar.jsx ───────────────
// Vertical sidebar for choosing the empirical strategy.
// Pure presentation: receives model state, emits onSelect.
// Props:
//   model         {string}   – currently selected model ID
//   onSelect      {fn}       – (id) => void
//   modelAvail    {object}   – { OLS: true, FE: false, … }
//   modelHint     {object}   – tooltip text per model when disabled
//   panel         {object|null} – panelIndex from cleanedData
//   rows          {number}   – observation count (for status line)
//   numericCols   {string[]} – column count (for status line)

import { C, mono, Section, ModelBtn, InfoBox } from "./shared.jsx";

// ─── MODEL REGISTRY ───────────────────────────────────────────────────────────
// Single source of truth for all estimator metadata.
// Order here determines sidebar order.
export const MODELS = [
  { id: "OLS",  label: "OLS",             color: C.green,  desc: "Ordinary Least Squares" },
  { id: "FE",   label: "Fixed Effects",   color: C.blue,   desc: "Within estimator — panel required" },
  { id: "FD",   label: "First Differences", color: C.blue, desc: "FD estimator — panel required" },
  { id: "2SLS", label: "2SLS / IV",       color: C.gold,   desc: "Two-Stage Least Squares" },
  { id: "DiD",  label: "DiD 2×2",         color: C.teal,   desc: "Classic Difference-in-Differences" },
  { id: "TWFE", label: "TWFE DiD",        color: C.teal,   desc: "Two-Way Fixed Effects DiD — panel required" },
  { id: "RDD",  label: "Sharp RDD",       color: C.orange, desc: "Regression Discontinuity Design" },
];

// ─── COMPONENT ────────────────────────────────────────────────────────────────
export default function EstimatorSidebar({
  model,
  onSelect,
  modelAvail,
  modelHint,
  panel,
}) {
  return (
    <>
      {/* ── Model picker ── */}
      <Section title="Strategy · Empirical Model" color={C.gold}>
        <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
          {MODELS.map(m => (
            <ModelBtn
              key={m.id}
              model={`${m.label} — ${m.desc}`}
              selected={model === m.id}
              disabled={!modelAvail[m.id]}
              onClick={() => onSelect(m.id)}
              color={m.color}
              hint={modelHint[m.id] || ""}
            />
          ))}
        </div>
      </Section>

      {/* ── Panel awareness notifications ── */}
      {!panel && (
        <InfoBox color={C.textMuted}>
          No panel declared. Go to Wrangling → Panel Structure to enable FE, FD, and TWFE DiD.
        </InfoBox>
      )}
      {panel && panel.blockFE && (
        <InfoBox color={C.red}>
          ⚠ Panel has duplicate observations — Fixed Effects blocked. Fix in Wrangling.
        </InfoBox>
      )}
    </>
  );
}
