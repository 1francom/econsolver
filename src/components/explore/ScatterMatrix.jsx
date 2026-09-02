// ─── ECON STUDIO · components/explore/ScatterMatrix.jsx ──────────────────────
// R's pairs() — a scatterplot matrix over the numeric columns.
//
// It sits beside the correlation heatmap because the two answer the same
// question at different resolutions: the heatmap gives one number per pair, this
// shows the shape behind that number. A correlation of 0.0 on a perfect U and a
// correlation of 0.0 on a cloud are the same cell in the heatmap and obviously
// different panels here.
//
// Props:
//   headers      string[]
//   rows         object[]                 — the rows Explore is already showing
//   info         { [col]: { isNum, mean } } — Explore's column summary
//   usingPreview bool                     — rows are a 500-row DuckDB preview
//
// Deliberately NOT a PlotBuilder geom: a matrix is a grid of panels, and
// Observable Plot has one panel per plot (its fx/fy facets are one variable, not
// a pairwise grid). Building it as its own SVG keeps the layer model honest.

import { useState, useMemo, useRef } from "react";
import { useTheme } from "../../ThemeContext.jsx";
import PlotExportBar from "../shared/PlotExportBar.jsx";
import { correlationTest } from "../../math/SampleTests.js";
import { buildScatterMatrixScript } from "../../services/export/scatterMatrixScript.js";

const MAX_COLS   = 8;     // 8² = 64 panels; past that every panel is unreadable
const MAX_POINTS = 2000;  // per panel, thinned deterministically

const LANGS = [["r", "R"], ["python", "Python"], ["stata", "Stata"]];

// Deterministic thinning: every m-th row, so the picture does not reshuffle on
// each render the way a sampled one would.
function thin(values, cap) {
  if (values.length <= cap) return values;
  const step = Math.ceil(values.length / cap);
  const out = [];
  for (let i = 0; i < values.length; i += step) out.push(values[i]);
  return out;
}

export default function ScatterMatrix({ headers = [], rows = [], info = {}, usingPreview = false }) {
  const { C, T } = useTheme();
  const numH = useMemo(
    () => headers.filter(h => info[h]?.isNum && info[h]?.mean != null),
    [headers, info]
  );
  const [sel, setSel]       = useState(null);   // null = "first few", set on first interaction
  const [upperCorr, setUp]  = useState(true);
  const [copied, setCopied] = useState("");
  const boxRef = useRef(null);

  const cols = useMemo(() => {
    const chosen = sel ?? numH.slice(0, Math.min(4, numH.length));
    return chosen.filter(c => numH.includes(c)).slice(0, MAX_COLS);
  }, [sel, numH]);

  // Per-column values in row order, and the pairwise-complete points per panel.
  const series = useMemo(() => {
    const map = {};
    for (const c of cols) map[c] = rows.map(r => Number(r[c]));
    return map;
  }, [cols, rows]);

  const extent = useMemo(() => {
    const e = {};
    for (const c of cols) {
      let lo = Infinity, hi = -Infinity;
      for (const v of series[c]) if (Number.isFinite(v)) { if (v < lo) lo = v; if (v > hi) hi = v; }
      e[c] = Number.isFinite(lo) && Number.isFinite(hi) && hi > lo ? [lo, hi] : [lo - 1, lo + 1];
    }
    return e;
  }, [cols, series]);

  const corr = useMemo(() => {
    const m = {};
    for (let i = 0; i < cols.length; i++) {
      for (let j = i + 1; j < cols.length; j++) {
        const res = correlationTest(series[cols[i]], series[cols[j]], { method: "pearson" });
        m[`${i}-${j}`] = res?.error ? null : res;
      }
    }
    return m;
  }, [cols, series]);

  function copyScript(lang) {
    const text = buildScatterMatrixScript(lang, cols, { upperCorr });
    if (!text) return;
    navigator.clipboard?.writeText(text).then(() => {
      setCopied(lang);
      setTimeout(() => setCopied(""), 2000);
    }).catch(() => {});
  }

  if (numH.length < 2) {
    return <div style={{ fontSize: T.code.fontSize, color: C.textMuted, fontFamily: T.body.fontFamily }}>Need ≥2 numeric columns.</div>;
  }

  const k    = cols.length;
  const cell = Math.max(70, Math.min(150, Math.floor(620 / Math.max(1, k))));
  const pad  = 6;
  const size = k * cell;

  const chip = active => ({
    padding: "0.18rem 0.5rem",
    background: active ? `${C.teal}18` : "transparent",
    border: `1px solid ${active ? C.teal : C.border2}`,
    borderRadius: 2, color: active ? C.teal : C.textDim,
    fontFamily: T.code.fontFamily, fontSize: T.caption.fontSize, cursor: "pointer",
  });

  return (
    <div>
      {/* Column picker */}
      <div style={{ display: "flex", gap: 5, flexWrap: "wrap", alignItems: "center", marginBottom: "0.7rem" }}>
        <span style={{ fontFamily: T.code.fontFamily, fontSize: T.caption.fontSize, color: C.textMuted }}>variables</span>
        {numH.map(h => {
          const on = cols.includes(h);
          return (
            <button key={h} style={chip(on)} onClick={() => {
              const base = sel ?? cols;
              setSel(on ? base.filter(c => c !== h) : [...base, h].slice(0, MAX_COLS));
            }}>{h}</button>
          );
        })}
        {numH.length > MAX_COLS && (
          <span style={{ fontFamily: T.code.fontFamily, fontSize: T.caption.fontSize, color: C.textMuted }}>
            (max {MAX_COLS} — past that every panel is a few pixels wide)
          </span>
        )}
      </div>

      <div style={{ display: "flex", gap: 8, alignItems: "center", marginBottom: "0.7rem", flexWrap: "wrap" }}>
        <button style={chip(upperCorr)} onClick={() => setUp(v => !v)}>
          upper panel: {upperCorr ? "correlation" : "points"}
        </button>
        <span style={{ marginLeft: "auto", fontSize: T.caption.fontSize, color: C.textMuted, fontFamily: T.code.fontFamily }}>copy as</span>
        {LANGS.map(([id, label]) => (
          <button key={id} onClick={() => copyScript(id)}
            style={{ ...chip(copied === id), padding: "2px 10px" }}>{copied === id ? "✓" : label}</button>
        ))}
      </div>

      {usingPreview && (
        <div style={{ marginBottom: 8, fontSize: T.caption.fontSize, color: C.gold, fontFamily: T.body.fontFamily }}>
          ⏳ full dataset still loading — these panels are drawn from the {rows.length}-row preview
        </div>
      )}

      {k < 2 ? (
        <div style={{ fontSize: T.code.fontSize, color: C.textMuted, fontFamily: T.body.fontFamily, padding: "1rem 0" }}>
          Pick at least two variables.
        </div>
      ) : (
        <div ref={boxRef} style={{ border: `1px solid ${C.border}`, borderRadius: 4, overflow: "hidden" }}>
          <div style={{ overflowX: "auto", padding: "0.5rem", background: C.bg }}>
            <svg viewBox={`0 0 ${size} ${size}`} style={{ width: "100%", maxWidth: size, display: "block", fontFamily: T.code.fontFamily }}>
              {cols.map((cy, i) => cols.map((cx, j) => {
                const x0 = j * cell, y0 = i * cell;
                const frame = (
                  <rect x={x0 + 0.5} y={y0 + 0.5} width={cell - 1} height={cell - 1}
                    fill="none" stroke={C.border} strokeWidth={1} />
                );

                // Diagonal: the variable name, as R's pairs() draws it.
                if (i === j) {
                  return (
                    <g key={`${i}-${j}`}>
                      {frame}
                      <text x={x0 + cell / 2} y={y0 + cell / 2 + 4} fill={C.teal}
                        fontSize={Math.max(8, Math.min(12, cell / 8))} textAnchor="middle">{cx}</text>
                      <text x={x0 + cell / 2} y={y0 + cell - 6} fill={C.textMuted}
                        fontSize={Math.max(6, Math.min(8, cell / 12))} textAnchor="middle">
                        {extent[cx][0].toPrecision(3)} … {extent[cx][1].toPrecision(3)}
                      </text>
                    </g>
                  );
                }

                // Upper triangle: the correlation, sized by |r| (the ?pairs
                // panel.cor idiom) rather than a second copy of the scatter.
                if (upperCorr && j > i) {
                  const res = corr[`${i}-${j}`];
                  const r = res ? res.estimate : null;
                  const stars = res ? (res.pValue < 0.001 ? "***" : res.pValue < 0.01 ? "**" : res.pValue < 0.05 ? "*" : "") : "";
                  return (
                    <g key={`${i}-${j}`}>
                      {frame}
                      <text x={x0 + cell / 2} y={y0 + cell / 2 + 4}
                        fill={r == null ? C.textMuted : r > 0 ? C.teal : C.red}
                        fontSize={Math.max(9, Math.min(22, (cell / 6) * (1 + Math.abs(r ?? 0))))}
                        textAnchor="middle">{r == null ? "—" : r.toFixed(2)}</text>
                      {stars && (
                        <text x={x0 + cell / 2} y={y0 + cell - 8} fill={C.gold}
                          fontSize={Math.max(7, Math.min(10, cell / 10))} textAnchor="middle">{stars}</text>
                      )}
                    </g>
                  );
                }

                // Scatter panel — pairwise complete cases, exactly as R pairs().
                const pts = [];
                const xs = series[cx], ys = series[cy];
                for (let t = 0; t < xs.length; t++) {
                  if (Number.isFinite(xs[t]) && Number.isFinite(ys[t])) pts.push([xs[t], ys[t]]);
                }
                const shown = thin(pts, MAX_POINTS);
                const [xLo, xHi] = extent[cx], [yLo, yHi] = extent[cy];
                const sx = v => x0 + pad + ((v - xLo) / (xHi - xLo || 1)) * (cell - 2 * pad);
                const sy = v => y0 + cell - pad - ((v - yLo) / (yHi - yLo || 1)) * (cell - 2 * pad);
                const rad = Math.max(0.7, Math.min(1.8, cell / 60));
                return (
                  <g key={`${i}-${j}`}>
                    {frame}
                    {shown.map(([px, py], t) => (
                      <circle key={t} cx={sx(px)} cy={sy(py)} r={rad} fill={C.teal} fillOpacity={0.5} />
                    ))}
                  </g>
                );
              }))}
            </svg>
          </div>
          <PlotExportBar getEl={() => boxRef.current?.querySelector("svg")} filename="scatter_matrix" />
        </div>
      )}
    </div>
  );
}
