// ─── ECON STUDIO · HelpSystem.jsx ─────────────────────────────────────────────
// Central help system: TOUR_STEPS registry, HintBox, TourOverlay.
// All new tabs, modules, and estimators should add an entry to TOUR_STEPS.

import { useState } from "react";
import { useTheme } from "../ThemeContext.jsx";

const mono = "'IBM Plex Mono','JetBrains Mono',Consolas,monospace";

// ─── TOUR STEPS ───────────────────────────────────────────────────────────────
// Add entries here when adding new tabs, modules, or estimators.
export const TOUR_STEPS = [
  {
    id: "welcome",
    tab: null,
    title: "Welcome to Econ Studio",
    text: "A privacy-first econometrics platform. All computation runs in your browser — your data never leaves your machine. This tour walks through the full research workflow.",
  },
  {
    id: "data",
    tab: "data",
    title: "1 · Data",
    text: "Upload CSV, Excel (.xlsx), Stata (.dta), or R (.rds) files via drag & drop. Fetch live data from the World Bank or OECD APIs. Column types are auto-detected — click any badge to override.",
  },
  {
    id: "clean",
    tab: "clean",
    title: "2 · Clean & Wrangle",
    text: "Build a non-destructive pipeline — every step replays on raw data, nothing is lost. Clean (filter, fill NAs, recode) · Features (log, lag, z-score, dummies, interactions) · Panel (declare entity i & time t) · Merge (join/append datasets).",
  },
  {
    id: "explore",
    tab: "explore",
    title: "3 · Explore",
    text: "Explore cleaned data with summary stats, histograms, and a Pearson correlation heatmap. The ⊘ Filter bar slices data temporarily — it never touches the pipeline or raw data.",
  },
  {
    id: "model",
    tab: "model",
    title: "4 · Model",
    text: "Choose an estimator (OLS, FE, 2SLS, RDD, DiD, Logit, GMM, Synthetic Control…). Assign Y, X, Z variables, pick SE type, and estimate. Pin results to compare specifications. Export LaTeX tables and replication scripts in R / Stata / Python.",
  },
  {
    id: "report",
    tab: "report",
    title: "5 · Report",
    text: "Generate publication-ready output: LaTeX Stargazer tables from pinned models, forest plots, and AI-written narrative paragraphs.",
  },
  {
    id: "simulate",
    tab: "simulate",
    title: "Simulate",
    text: "Build a data-generating process (DGP) and synthesize datasets. Useful for power analysis, Monte Carlo experiments, and teaching.",
  },
  {
    id: "calculate",
    tab: "calculate",
    title: "Calculate",
    text: "Expression evaluator, equation solver, derivative calculator, and model prediction with 95% CI. All expressions work on your dataset variables.",
  },
  {
    id: "spatial",
    tab: "spatial",
    title: "Spatial",
    text: "Load shapefiles or geographic data, visualize variables on choropleth maps, and run spatial statistics.",
  },
];

// ─── HINT BOX ─────────────────────────────────────────────────────────────────
// Collapsible per-module hint panel.
// Props: tips (string[]), title (string), color (accent color string)
export function HintBox({ tips = [], title = "How to use", color }) {
  const { C } = useTheme();
  const accent = color ?? C.teal;
  const [open, setOpen] = useState(false);

  return (
    <div style={{
      marginBottom: "1rem",
      border: `1px solid ${C.border}`,
      borderLeft: `3px solid ${accent}`,
      borderRadius: 3,
      background: C.surface,
      fontFamily: mono,
      fontSize: 11,
    }}>
      {/* Toggle button */}
      <button
        onClick={() => setOpen(o => !o)}
        style={{
          display: "flex",
          alignItems: "center",
          gap: 6,
          width: "100%",
          background: "transparent",
          border: "none",
          padding: "0.45rem 0.75rem",
          cursor: "pointer",
          fontFamily: mono,
          fontSize: 10,
          color: C.textDim,
          textAlign: "left",
          letterSpacing: "0.06em",
        }}
      >
        <span style={{ color: accent, fontSize: 9 }}>{open ? "▾" : "▸"}</span>
        <span style={{ color: accent, letterSpacing: "0.12em", textTransform: "uppercase", fontSize: 9 }}>
          {title}
        </span>
      </button>

      {/* Tip list */}
      {open && (
        <ul style={{
          margin: 0,
          padding: "0 0.75rem 0.65rem 1.8rem",
          listStyle: "disc",
          borderTop: `1px solid ${C.border}`,
        }}>
          {tips.map((tip, i) => (
            <li
              key={i}
              style={{
                color: C.textDim,
                fontFamily: mono,
                fontSize: 11,
                lineHeight: 1.7,
                paddingTop: i === 0 ? "0.4rem" : 0,
              }}
            >
              {tip}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

// ─── TOUR OVERLAY ─────────────────────────────────────────────────────────────
// Floating step card — fixed bottom-right.
// Props: step (number), onNext, onPrev, onClose, onTabChange
export function TourOverlay({ step, onNext, onPrev, onClose, onTabChange }) {
  const { C } = useTheme();

  if (step < 0 || step >= TOUR_STEPS.length) return null;

  const current = TOUR_STEPS[step];
  const isLast  = step === TOUR_STEPS.length - 1;
  const isFirst = step === 0;

  function handleNext() {
    const nextStep = TOUR_STEPS[step + 1];
    if (nextStep?.tab) onTabChange?.(nextStep.tab);
    onNext?.();
  }

  function handlePrev() {
    const prevStep = TOUR_STEPS[step - 1];
    if (prevStep?.tab) onTabChange?.(prevStep.tab);
    onPrev?.();
  }

  return (
    <div style={{
      position: "fixed",
      bottom: 24,
      right: 24,
      zIndex: 9999,
      width: 320,
      background: C.surface,
      border: `1px solid ${C.border}`,
      borderLeft: `3px solid ${C.teal}`,
      borderRadius: 4,
      fontFamily: mono,
      boxShadow: "0 4px 24px rgba(0,0,0,0.55)",
    }}>
      {/* ── Header ── */}
      <div style={{
        display: "flex",
        alignItems: "center",
        justifyContent: "space-between",
        padding: "0.55rem 0.75rem 0.45rem",
        borderBottom: `1px solid ${C.border}`,
      }}>
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <span style={{ fontSize: 9, color: C.textMuted, letterSpacing: "0.1em" }}>
            {step + 1} / {TOUR_STEPS.length}
          </span>
          {current.tab && (
            <span style={{
              fontSize: 8,
              color: C.teal,
              border: `1px solid ${C.teal}40`,
              borderRadius: 2,
              padding: "1px 5px",
              letterSpacing: "0.12em",
              textTransform: "uppercase",
            }}>
              {current.tab}
            </span>
          )}
        </div>
        <button
          onClick={onClose}
          style={{
            background: "transparent",
            border: "none",
            color: C.textMuted,
            cursor: "pointer",
            fontFamily: mono,
            fontSize: 12,
            padding: "0 2px",
            lineHeight: 1,
          }}
          onMouseEnter={e => { e.currentTarget.style.color = C.text; }}
          onMouseLeave={e => { e.currentTarget.style.color = C.textMuted; }}
        >
          ×
        </button>
      </div>

      {/* ── Body ── */}
      <div style={{ padding: "0.85rem 0.75rem 0.7rem" }}>
        <div style={{
          fontSize: 13,
          color: C.text,
          marginBottom: "0.5rem",
          letterSpacing: "-0.01em",
        }}>
          {current.title}
        </div>
        <div style={{
          fontSize: 11,
          color: C.textDim,
          lineHeight: 1.7,
        }}>
          {current.text}
        </div>
      </div>

      {/* ── Footer ── */}
      <div style={{
        display: "flex",
        alignItems: "center",
        justifyContent: "space-between",
        padding: "0.45rem 0.75rem 0.6rem",
        borderTop: `1px solid ${C.border}`,
      }}>
        <button
          onClick={handlePrev}
          disabled={isFirst}
          style={{
            background: "transparent",
            border: `1px solid ${C.border2}`,
            borderRadius: 3,
            color: isFirst ? C.textMuted : C.textDim,
            cursor: isFirst ? "not-allowed" : "pointer",
            fontFamily: mono,
            fontSize: 10,
            padding: "0.28rem 0.65rem",
            opacity: isFirst ? 0.4 : 1,
            transition: "color 0.12s",
          }}
        >
          Prev
        </button>

        <button
          onClick={onClose}
          style={{
            background: "transparent",
            border: "none",
            color: C.textMuted,
            cursor: "pointer",
            fontFamily: mono,
            fontSize: 10,
            padding: "0.28rem 0.5rem",
            transition: "color 0.12s",
          }}
          onMouseEnter={e => { e.currentTarget.style.color = C.text; }}
          onMouseLeave={e => { e.currentTarget.style.color = C.textMuted; }}
        >
          Skip tour
        </button>

        <button
          onClick={isLast ? onClose : handleNext}
          style={{
            background: "transparent",
            border: `1px solid ${C.teal}60`,
            borderRadius: 3,
            color: C.teal,
            cursor: "pointer",
            fontFamily: mono,
            fontSize: 10,
            padding: "0.28rem 0.65rem",
            transition: "all 0.12s",
          }}
          onMouseEnter={e => {
            e.currentTarget.style.background = `${C.teal}18`;
          }}
          onMouseLeave={e => {
            e.currentTarget.style.background = "transparent";
          }}
        >
          {isLast ? "Done" : "Next →"}
        </button>
      </div>
    </div>
  );
}
