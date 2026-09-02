// ─── ECON STUDIO · components/explore/MultiSeriesChart.jsx ───────────────────
// R's plot.zoo — one stacked panel per variable, sharing the time axis and each
// keeping its own y scale. That per-panel scale is the whole point: an interest
// rate and an index level share a date axis and nothing else, and forcing them
// onto one y axis flattens the smaller of the two into a line.
//
// Props:
//   rows      object[]        — the rows Explore is showing (JS fallback path)
//   tCol      string          — time column
//   yCols     string[]        — one panel each, in the order given
//   agg       string          — mean | sum | median (count is not offered: it is
//                               the same number for every variable)
//   duckTable string | null   — when present, aggregation happens in SQL over
//                               the FULL table instead of the preview rows
//   colors    string[]        — palette, shared with the single-series chart

import { useState, useEffect, useMemo, useRef } from "react";
import { useTheme } from "../../ThemeContext.jsx";
import PlotExportBar from "../shared/PlotExportBar.jsx";
import { aggregateTimeSeries, fetchAggregateTimeSeriesSQL } from "../../services/data/timeSeriesAggregate.js";
import { buildMultiSeriesScript } from "../../services/export/multiSeriesScript.js";
import { niceTicks } from "./axisTicks.js";

const LANGS = [["r", "R"], ["python", "Python"], ["stata", "Stata"]];

export default function MultiSeriesChart({ rows, tCol, yCols = [], agg = "mean", duckTable = null, colors = [] }) {
  const { C, T } = useTheme();
  const [sqlSeries, setSqlSeries] = useState(null);
  const [loading, setLoading]     = useState(false);
  const [error, setError]         = useState(null);
  const [copied, setCopied]       = useState("");
  const boxRef = useRef(null);

  const colKey = yCols.join("|");

  // JS fallback — one aggregation per variable, ungrouped (plot.zoo has no
  // grouping: one line per variable is the whole idea).
  const jsSeries = useMemo(
    () => yCols.map(y => ({ col: y, pts: aggregateTimeSeries(rows, tCol, y, "", agg)[0]?.pts ?? [] })),
    [rows, tCol, colKey, agg]  // eslint-disable-line react-hooks/exhaustive-deps
  );

  useEffect(() => {
    setSqlSeries(null); setError(null);
    if (!duckTable || !tCol || !yCols.length) return;
    setLoading(true);
    Promise.all(yCols.map(y => fetchAggregateTimeSeriesSQL(duckTable, tCol, y, "", agg)))
      .then(res => setSqlSeries(res.map((s, i) => ({ col: yCols[i], pts: s[0]?.pts ?? [] }))))
      .catch(e => {
        console.error("[MultiSeriesChart] SQL aggregation failed:", e);
        setError(e?.message || "aggregation query failed");
      })
      .finally(() => setLoading(false));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [duckTable, tCol, colKey, agg]);

  const panels = (sqlSeries ?? jsSeries).filter(p => p.pts.length > 0);

  function copyScript(lang) {
    const text = buildMultiSeriesScript(lang, tCol, yCols, { agg });
    if (!text) return;
    navigator.clipboard?.writeText(text).then(() => {
      setCopied(lang); setTimeout(() => setCopied(""), 2000);
    }).catch(() => {});
  }

  // ── geometry ───────────────────────────────────────────────────────────────
  const W = 700;
  const PANEL_H = Math.max(70, Math.min(130, Math.round(420 / Math.max(1, panels.length))));
  const PAD = { l: 62, r: 16, t: 10, b: 34 };   // b: the shared x axis, drawn once
  const iW = W - PAD.l - PAD.r;
  const H = PAD.t + panels.length * PANEL_H + PAD.b;

  const tAll = panels.flatMap(p => p.pts.map(pt => pt.t));
  const tMin = tAll.length ? Math.min(...tAll) : 0;
  const tMax = tAll.length ? Math.max(...tAll) : 1;
  const sx = t => PAD.l + ((t - tMin) / (tMax - tMin || 1)) * iW;
  const xTicks = niceTicks(tMin, tMax, 6);

  if (!panels.length) {
    return (
      <div style={{ padding: "2rem", textAlign: "center", color: C.textMuted, fontSize: T.code.fontSize, fontFamily: T.code.fontFamily }}>
        {loading ? "⏳ aggregating…" : "No points to plot — pick a time column and at least one numeric variable."}
      </div>
    );
  }

  const chipStyle = active => ({
    padding: "2px 10px", fontFamily: T.code.fontFamily, fontSize: T.caption.fontSize,
    border: `1px solid ${active ? C.teal : C.border2}`, borderRadius: 2,
    background: active ? `${C.teal}1a` : "transparent", color: active ? C.teal : C.textMuted, cursor: "pointer",
  });

  return (
    <div style={{ border: `1px solid ${C.border}`, borderRadius: 4, overflow: "hidden" }}>
      <div style={{ display: "flex", alignItems: "center", gap: 8, padding: "0.4rem 0.9rem", background: C.surface2, borderBottom: `1px solid ${C.border}` }}>
        <span style={{ fontSize: T.caption.fontSize, color: C.textMuted, letterSpacing: "0.18em", textTransform: "uppercase", fontFamily: T.code.fontFamily }}>
          {panels.length} series by {tCol} · one y scale per panel
        </span>
        <span style={{ marginLeft: "auto", fontSize: T.caption.fontSize, color: C.textMuted, fontFamily: T.code.fontFamily }}>copy as</span>
        {LANGS.map(([id, label]) => (
          <button key={id} onClick={() => copyScript(id)} style={chipStyle(copied === id)}>{copied === id ? "✓" : label}</button>
        ))}
      </div>

      {duckTable && loading && <div style={{ padding: "0.4rem 0.9rem", fontSize: T.caption.fontSize, color: C.textMuted, fontFamily: T.body.fontFamily }}>⏳ aggregating over the full table…</div>}
      {error && <div style={{ padding: "0.4rem 0.9rem", fontSize: T.caption.fontSize, color: C.red, fontFamily: T.body.fontFamily }}>⚠ {error} — showing values from the loaded rows instead.</div>}

      <div ref={boxRef} style={{ background: C.bg, padding: "0.5rem", overflowX: "auto" }}>
        <svg viewBox={`0 0 ${W} ${H}`} style={{ width: "100%", maxWidth: W, display: "block", fontFamily: T.code.fontFamily }}>
          <rect width={W} height={H} fill={C.bg} />
          {panels.map((p, i) => {
            const y0 = PAD.t + i * PANEL_H;
            const inner = PANEL_H - 12;
            const ys = p.pts.map(pt => pt.y);
            let lo = Math.min(...ys), hi = Math.max(...ys);
            if (!(hi > lo)) { lo -= 1; hi += 1; }
            const padY = (hi - lo) * 0.12;
            lo -= padY; hi += padY;
            const sy = v => y0 + inner - ((v - lo) / (hi - lo || 1)) * inner;
            const col = colors[i % Math.max(1, colors.length)] || C.teal;
            const yTicks = niceTicks(lo, hi, 3);
            const d = p.pts.map((pt, k) => `${k === 0 ? "M" : "L"}${sx(pt.t).toFixed(1)},${sy(pt.y).toFixed(1)}`).join(" ");
            return (
              <g key={p.col}>
                {/* panel frame + grid */}
                <rect x={PAD.l} y={y0} width={iW} height={inner} fill="none" stroke={C.border} strokeWidth={1} />
                {yTicks.map((t, k) => (
                  <g key={k}>
                    <line x1={PAD.l} x2={PAD.l + iW} y1={sy(t)} y2={sy(t)} stroke={C.border} strokeWidth={1} strokeDasharray="3 3" opacity={0.35} />
                    <text x={PAD.l - 6} y={sy(t) + 3} textAnchor="end" fill={C.textMuted}
                      fontSize={Math.max(6, Math.min(9, inner / 8))} fontFamily={T.data.fontFamily}>
                      {Math.abs(t) >= 10000 ? t.toExponential(1) : String(parseFloat(t.toPrecision(4)))}
                    </text>
                  </g>
                ))}
                {/* zero line, when the panel straddles it */}
                {lo < 0 && hi > 0 && (
                  <line x1={PAD.l} x2={PAD.l + iW} y1={sy(0)} y2={sy(0)} stroke={C.border2} strokeWidth={1} strokeDasharray="4 3" />
                )}
                <path d={d} fill="none" stroke={col} strokeWidth={1.6} opacity={0.95} />
                {/* variable name, rotated at the left as plot.zoo labels its panels */}
                <text transform={`translate(14,${y0 + inner / 2}) rotate(-90)`} textAnchor="middle"
                  fill={col} fontSize={Math.max(7, Math.min(10, inner / 7))} fontFamily={T.data.fontFamily}>{p.col}</text>
              </g>
            );
          })}

          {/* shared x axis, drawn once under the bottom panel */}
          {(() => {
            const yAxis = PAD.t + panels.length * PANEL_H - 12;
            return (
              <g>
                <line x1={PAD.l} x2={PAD.l + iW} y1={yAxis} y2={yAxis} stroke={C.border2} strokeWidth={1} />
                {xTicks.map((t, i) => (
                  <g key={i}>
                    <line x1={sx(t)} x2={sx(t)} y1={yAxis} y2={yAxis + 4} stroke={C.border2} strokeWidth={1} />
                    <text x={sx(t)} y={yAxis + 15} textAnchor="middle" fill={C.textMuted} fontSize={T.caption.fontSize} fontFamily={T.data.fontFamily}>
                      {Number.isInteger(t) ? t : t.toFixed(1)}
                    </text>
                  </g>
                ))}
                <text x={PAD.l + iW / 2} y={H - 4} textAnchor="middle" fill={C.textDim} fontSize={T.caption.fontSize} fontFamily={T.data.fontFamily}>{tCol}</text>
              </g>
            );
          })()}
        </svg>
      </div>
      <PlotExportBar getEl={() => boxRef.current?.querySelector("svg")} filename={`multiseries_by_${tCol}`} />
    </div>
  );
}
