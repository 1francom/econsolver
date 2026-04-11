// ─── ECON STUDIO · src/components/modeling/EstimatorSidebar.jsx ───────────────
// Grouped "Choose Model" dropdown — Phase 8.1.
// Pure presentation: receives model state, emits onSelect.
// Props:
//   model         {string}   – currently selected model ID
//   onSelect      {fn}       – (id) => void
//   modelAvail    {object}   – { OLS: true, FE: false, … }
//   modelHint     {object}   – tooltip text per model when disabled
//   panel         {object|null} – panelIndex from cleanedData
//   rows          {number}   – observation count (for status line)
//   numericCols   {string[]} – column count (for status line)

import { useState, useEffect, useRef } from "react";
import { C, mono, Section, InfoBox } from "./shared.jsx";

// ─── MODEL REGISTRY ───────────────────────────────────────────────────────────
// Single source of truth for all estimator metadata.
// Groups determine dropdown sections.
export const MODELS = [
  // Linear
  { id: "OLS",             label: "OLS",                group: "Linear",            desc: "Ordinary Least Squares",                       color: C.green  },
  { id: "WLS",             label: "WLS",                group: "Linear",            desc: "Weighted Least Squares",                        color: C.green  },
  // Panel
  { id: "FE",              label: "FE / FD",            group: "Panel",             desc: "Within estimator — panel required",             color: C.blue   },
  { id: "LSDV",            label: "LSDV",               group: "Panel",             desc: "Least Squares Dummy Variables — panel required", color: C.blue   },
  { id: "TWFE",            label: "TWFE DiD",           group: "Panel",             desc: "Two-Way Fixed Effects DiD — panel required",    color: C.teal   },
  { id: "EventStudy",      label: "Event Study",        group: "Panel",             desc: "Dynamic DiD / event study — panel required",   color: C.teal   },
  // Causal
  { id: "2SLS",            label: "2SLS / IV",          group: "Causal",            desc: "Two-Stage Least Squares",                       color: C.gold   },
  { id: "RDD",             label: "Sharp RDD",          group: "Causal",            desc: "Regression Discontinuity Design",               color: C.orange },
  { id: "FuzzyRDD",        label: "Fuzzy RDD",          group: "Causal",            desc: "Fuzzy Regression Discontinuity (planned)",      color: C.orange },
  { id: "DiD",             label: "DiD 2×2",            group: "Causal",            desc: "Classic Difference-in-Differences",             color: C.teal   },
  // Limited Dependent
  { id: "Logit",           label: "Logit",              group: "Limited Dependent", desc: "Binary Logistic Regression (MLE)",              color: C.violet },
  { id: "Probit",          label: "Probit",             group: "Limited Dependent", desc: "Probit — Normal Link (MLE)",                    color: C.violet },
  { id: "PoissonFE",       label: "Poisson FE",         group: "Limited Dependent", desc: "Poisson with Fixed Effects (planned)",          color: C.violet },
  // IV / GMM
  { id: "GMM",             label: "Two-Step GMM",       group: "IV/GMM",            desc: "Efficient GMM — HC-robust Ω̂ + J-test",         color: C.gold   },
  { id: "LIML",            label: "LIML",               group: "IV/GMM",            desc: "Limited Info. Max. Likelihood / k-class",       color: C.gold   },
  // Synthetic
  { id: "SyntheticControl",label: "Synthetic Control",  group: "Synthetic",         desc: "Synthetic control method (planned)",            color: C.blue   },
];

// ordered group list (controls render order)
const GROUP_ORDER = ["Linear", "Panel", "Causal", "Limited Dependent", "IV/GMM", "Synthetic"];

// ─── COMPONENT ────────────────────────────────────────────────────────────────
export default function EstimatorSidebar({
  model,
  onSelect,
  modelAvail,
  modelHint,
  panel,
}) {
  const [open, setOpen] = useState(false);
  const wrapRef = useRef(null);

  // Click-outside to close
  useEffect(() => {
    if (!open) return;
    function handleClick(e) {
      if (wrapRef.current && !wrapRef.current.contains(e.target)) {
        setOpen(false);
      }
    }
    document.addEventListener("mousedown", handleClick);
    return () => document.removeEventListener("mousedown", handleClick);
  }, [open]);

  const selected = MODELS.find(m => m.id === model) ?? MODELS[0];

  // Group models by group key
  const grouped = GROUP_ORDER.map(g => ({
    group: g,
    items: MODELS.filter(m => m.group === g),
  }));

  return (
    <>
      {/* ── Choose Model dropdown ── */}
      <Section title="Strategy · Empirical Model" color={C.gold}>
        <div ref={wrapRef} style={{ position: "relative" }}>

          {/* ── Trigger button ── */}
          <button
            onClick={() => setOpen(v => !v)}
            style={{
              width: "100%",
              display: "flex", alignItems: "center", justifyContent: "space-between",
              padding: "0.65rem 0.9rem",
              background: C.surface2,
              border: `1px solid ${C.gold}`,
              borderRadius: 4,
              color: selected.color,
              cursor: "pointer",
              fontFamily: mono, fontSize: 13,
              letterSpacing: "0.06em",
              transition: "border-color 0.13s",
            }}
          >
            <span>
              <span style={{ color: C.gold, marginRight: 7 }}>●</span>
              {selected.label}
            </span>
            <span style={{ fontSize: 10, color: C.textMuted }}>
              {open ? "▲" : "▼"}
            </span>
          </button>

          {/* ── Dropdown panel ── */}
          {open && (
            <div
              style={{
                position: "absolute",
                top: "calc(100% + 4px)",
                left: 0, right: 0,
                zIndex: 50,
                background: C.surface,
                border: `1px solid ${C.border2}`,
                borderRadius: 4,
                maxHeight: 420,
                overflowY: "auto",
                boxShadow: "0 8px 24px #00000080",
              }}
            >
              {grouped.map(({ group, items }) => (
                <div key={group}>
                  {/* Group header */}
                  <div style={{
                    padding: "5px 10px 3px",
                    fontSize: 9, letterSpacing: "0.22em",
                    textTransform: "uppercase",
                    color: C.textMuted,
                    fontFamily: mono,
                    borderBottom: `1px solid ${C.border}`,
                    background: C.surface2,
                    position: "sticky", top: 0,
                  }}>
                    {group}
                  </div>

                  {/* Estimator rows */}
                  {items.map(m => {
                    const avail  = modelAvail[m.id] !== false;
                    const isSelected = model === m.id;
                    const hint   = modelHint?.[m.id] ?? "";
                    return (
                      <button
                        key={m.id}
                        disabled={!avail}
                        title={!avail ? hint : m.desc}
                        onClick={() => { onSelect(m.id); setOpen(false); }}
                        style={{
                          width: "100%",
                          display: "flex",
                          alignItems: "baseline",
                          justifyContent: "space-between",
                          gap: 8,
                          padding: "7px 12px",
                          background: isSelected ? `${m.color}14` : "transparent",
                          border: "none",
                          borderLeft: `3px solid ${isSelected ? m.color : "transparent"}`,
                          borderBottom: `1px solid ${C.border}`,
                          color: !avail ? C.textMuted : isSelected ? m.color : C.textDim,
                          cursor: !avail ? "not-allowed" : "pointer",
                          fontFamily: mono, fontSize: 12,
                          textAlign: "left",
                          opacity: !avail ? 0.45 : 1,
                          transition: "background 0.1s",
                        }}
                        onMouseEnter={e => { if (avail && !isSelected) e.currentTarget.style.background = `${C.border}50`; }}
                        onMouseLeave={e => { e.currentTarget.style.background = isSelected ? `${m.color}14` : "transparent"; }}
                      >
                        <span style={{ display: "flex", alignItems: "center", gap: 6 }}>
                          {!avail && <span style={{ fontSize: 9 }}>🔒</span>}
                          {isSelected && <span style={{ color: m.color, fontSize: 10 }}>●</span>}
                          {m.label}
                        </span>
                        <span style={{
                          fontSize: 9, color: C.textMuted,
                          letterSpacing: "0.04em",
                          whiteSpace: "nowrap",
                          overflow: "hidden",
                          textOverflow: "ellipsis",
                          maxWidth: 140,
                        }}>
                          {m.desc}
                        </span>
                      </button>
                    );
                  })}
                </div>
              ))}
            </div>
          )}
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
          Panel has duplicate observations — Fixed Effects blocked. Fix in Wrangling.
        </InfoBox>
      )}
    </>
  );
}
