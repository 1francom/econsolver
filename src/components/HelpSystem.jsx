// ─── ECON STUDIO · HelpSystem.jsx ─────────────────────────────────────────────
// Central help system: TOUR_STEPS registry, HintBox, TourOverlay.
// All new tabs, modules, and estimators should add an entry to TOUR_STEPS.

import { useState, useEffect } from "react";
import { useTheme } from "../ThemeContext.jsx";


// ─── TOUR STEPS ───────────────────────────────────────────────────────────────
// Add entries here when adding new tabs, modules, or estimators.
export const TOUR_STEPS = [
  {
    id: "welcome",
    tab: null,
    title: "Welcome to Litux",
    text: "A privacy-first econometrics platform. All computation runs in your browser — your data never leaves your machine. This short tour walks through the full research workflow.",
  },
  {
    id: "data",
    tab: "data",
    title: "1 · Data",
    text: "Upload CSV, Excel (.xlsx/.xls), Stata (.dta), R (.rds), or shapefiles (.shp) via drag & drop. Fetch live datasets from the World Bank or OECD APIs. Column types are auto-detected.",
  },
  {
    id: "clean",
    tab: "clean",
    title: "2 · Clean & Wrangle",
    text: "Build a non-destructive pipeline — every step replays on raw data, nothing is permanently changed. Tabs: Clean · Feature Engineering · Panel Structure · Reshape · Merge · Dictionary · Quality Report. Undo any step from the History sidebar.",
  },
  {
    id: "explore",
    tab: "explore",
    title: "3 · Explore",
    text: "Descriptive stats, histograms (with live filter-aware stats), correlation heatmap, ACF/PACF, and the layered Plot Builder. The ⊘ Filter slices data temporarily — it never modifies the pipeline.",
  },
  {
    id: "model",
    tab: "model",
    title: "4 · Model",
    text: "14 estimators: OLS · WLS · FE · FD · TWFE · 2×2 DiD · 2SLS/IV · Sharp RDD · Logit · Probit · GMM · LIML · Synthetic Control. Assign Y, X, W variables, choose SE type (HC1–HC3, clustered, HAC), and estimate. Pin any result to compare specifications. Export LaTeX + replication scripts.",
  },
  {
    id: "report",
    tab: "report",
    title: "5 · Report",
    text: "Generate publication-ready output from pinned models: LaTeX Stargazer table, forest plot (coefficients + 95% CI), AI-written narrative paragraphs, and a full replication bundle (R + Stata + Python + data).",
  },
  {
    id: "simulate",
    tab: "simulate",
    title: "Simulate",
    text: "Define a data-generating process: set variable distributions (normal, uniform, Bernoulli, Poisson) and structural equations. Generate synthetic datasets for power analysis or Monte Carlo experiments. Output appears in the Data tab.",
  },
  {
    id: "calculate",
    tab: "calculate",
    title: "Calculate",
    text: "Symbolic calculator, equation pad (define TR, TC, π and differentiate for FOC), numerical derivatives, Brent root solver, and model prediction (ŷ ± 95% CI from any pinned model). Export expressions as LaTeX.",
  },
  {
    id: "spatial",
    tab: "spatial",
    title: "Spatial",
    text: "Load shapefiles or coordinate data. Assign buffer zones, grid cells (rectangular or H3), and run spatial joins. Nearest-neighbour matching and haversine/euclidean distance utilities.",
  },
];

// ─── HINT BOX ─────────────────────────────────────────────────────────────────
// Per-module help trigger.  Click → full overlay covers the main content area.
//
// Props:
//   title        – overlay heading (e.g. "How to model")
//   color        – accent color
//   tips         – string[] fallback (simple list)
//   sections     – {heading: string, items: string[]}[] richer format
//   overlayLeft  – px offset from left edge where the overlay starts (default 280)
export function HintBox({ tips = [], title = "How to use", color, sections = null, overlayLeft = 280 }) {
  const { C, T } = useTheme();
  const accent = color ?? C.teal;
  const [open, setOpen] = useState(false);

  useEffect(() => {
    if (!open) return;
    const onKey = (e) => { if (e.key === "Escape") setOpen(false); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open]);

  const hasRich = sections && sections.length > 0;

  return (
    <>
      {/* ── Trigger button (stays in sidebar) ── */}
      <button
        onClick={() => setOpen(true)}
        style={{
          display: "flex",
          alignItems: "center",
          gap: 6,
          width: "100%",
          background: "transparent",
          border: `1px solid ${C.border}`,
          borderLeft: `3px solid ${accent}`,
          borderRadius: 3,
          padding: "0.45rem 0.75rem",
          cursor: "pointer",
          fontFamily: T.code.fontFamily,
          fontSize: T.caption.fontSize,
          color: C.textDim,
          textAlign: "left",
          letterSpacing: "0.06em",
          marginBottom: "1rem",
          transition: "border-color 0.12s, color 0.12s",
        }}
        onMouseEnter={e => { e.currentTarget.style.color = accent; e.currentTarget.style.borderColor = `${accent}60`; }}
        onMouseLeave={e => { e.currentTarget.style.color = C.textDim; e.currentTarget.style.borderColor = C.border; }}
      >
        <span style={{ color: accent, fontSize: T.caption.fontSize }}>▸</span>
        <span style={{ color: accent, letterSpacing: "0.12em", textTransform: "uppercase", fontSize: T.caption.fontSize }}>
          {title}
        </span>
      </button>

      {/* ── Overlay ── */}
      {open && (
        <>
          {/* Backdrop — click to close */}
          <div
            onClick={() => setOpen(false)}
            style={{ position: "fixed", inset: 0, zIndex: 498, cursor: "pointer" }}
          />

          {/* Content panel */}
          <div style={{
            position: "fixed",
            top: 0,
            left: overlayLeft,
            right: 0,
            bottom: 0,
            zIndex: 499,
            background: C.bg,
            borderLeft: `3px solid ${accent}`,
            overflowY: "auto",
            fontFamily: T.code.fontFamily,
            boxShadow: "-8px 0 32px rgba(0,0,0,0.5)",
          }}>
            {/* Inner padding wrapper */}
            <div style={{ padding: "2.5rem 3.5rem 4rem", maxWidth: 1100 }}>

              {/* Header */}
              <div style={{
                display: "flex",
                alignItems: "flex-start",
                justifyContent: "space-between",
                marginBottom: "2.2rem",
                paddingBottom: "1.2rem",
                borderBottom: `1px solid ${C.border}`,
              }}>
                <div>
                  <div style={{ fontSize: T.caption.fontSize, color: accent, letterSpacing: "0.28em", textTransform: "uppercase", marginBottom: 6 }}>
                    User Guide
                  </div>
                  <div style={{ fontSize: T.h2.fontSize, color: C.text, letterSpacing: "-0.02em" }}>
                    {title}
                  </div>
                </div>
                <div style={{ display: "flex", alignItems: "center", gap: 12, marginTop: 4 }}>
                  <span style={{ fontSize: T.caption.fontSize, color: C.textMuted, fontFamily: T.code.fontFamily }}>ESC to close</span>
                  <button
                    onClick={() => setOpen(false)}
                    style={{
                      background: "transparent",
                      border: `1px solid ${C.border2}`,
                      borderRadius: 3,
                      color: C.textDim,
                      cursor: "pointer",
                      fontFamily: T.code.fontFamily,
                      fontSize: T.body.fontSize,
                      width: 30,
                      height: 30,
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "center",
                      flexShrink: 0,
                      transition: "all 0.12s",
                    }}
                    onMouseEnter={e => { e.currentTarget.style.color = C.text; e.currentTarget.style.borderColor = accent; }}
                    onMouseLeave={e => { e.currentTarget.style.color = C.textDim; e.currentTarget.style.borderColor = C.border2; }}
                  >×</button>
                </div>
              </div>

              {/* Sections grid or flat list */}
              {hasRich ? (
                <div style={{
                  display: "grid",
                  gridTemplateColumns: "repeat(auto-fill, minmax(300px, 1fr))",
                  gap: "2.2rem 3rem",
                }}>
                  {sections.map((sec, si) => (
                    <div key={si}>
                      <div style={{
                        fontSize: T.caption.fontSize,
                        color: accent,
                        letterSpacing: "0.22em",
                        textTransform: "uppercase",
                        marginBottom: "0.7rem",
                        paddingBottom: "0.4rem",
                        borderBottom: `1px solid ${C.border}`,
                      }}>
                        {sec.heading}
                      </div>
                      <ul style={{ margin: 0, padding: 0, listStyle: "none" }}>
                        {sec.items.map((item, ii) => (
                          <li key={ii} style={{
                            display: "flex",
                            gap: 8,
                            fontSize: T.code.fontSize,
                            lineHeight: 1.75,
                            color: C.textDim,
                            marginBottom: "0.15rem",
                          }}>
                            <span style={{ color: accent, flexShrink: 0, marginTop: "0.15rem" }}>·</span>
                            <span>{item}</span>
                          </li>
                        ))}
                      </ul>
                    </div>
                  ))}
                </div>
              ) : (
                <ul style={{ margin: 0, padding: 0, listStyle: "none" }}>
                  {tips.map((tip, i) => (
                    <li key={i} style={{
                      display: "flex",
                      gap: 8,
                      fontSize: T.code.fontSize,
                      lineHeight: 1.75,
                      color: C.textDim,
                      marginBottom: "0.5rem",
                    }}>
                      <span style={{ color: accent, flexShrink: 0 }}>·</span>
                      <span>{tip}</span>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </div>
        </>
      )}
    </>
  );
}

// ─── TOUR OVERLAY ─────────────────────────────────────────────────────────────
// Floating step card — fixed bottom-right.
// Props: step (number), onNext, onPrev, onClose, onTabChange
export function TourOverlay({ step, onNext, onPrev, onClose, onTabChange }) {
  const { C, T } = useTheme();

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
      fontFamily: T.code.fontFamily,
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
          <span style={{ fontSize: T.caption.fontSize, color: C.textMuted, letterSpacing: "0.1em" }}>
            {step + 1} / {TOUR_STEPS.length}
          </span>
          {current.tab && (
            <span style={{
              fontSize: T.caption.fontSize,
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
            fontFamily: T.code.fontFamily,
            fontSize: T.code.fontSize,
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
          fontSize: T.body.fontSize,
          color: C.text,
          marginBottom: "0.5rem",
          letterSpacing: "-0.01em",
        }}>
          {current.title}
        </div>
        <div style={{
          fontSize: T.code.fontSize,
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
            fontFamily: T.code.fontFamily,
            fontSize: T.caption.fontSize,
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
            fontFamily: T.code.fontFamily,
            fontSize: T.caption.fontSize,
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
            fontFamily: T.code.fontFamily,
            fontSize: T.caption.fontSize,
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
