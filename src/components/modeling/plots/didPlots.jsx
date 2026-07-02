// ─── ECON STUDIO · src/components/modeling/plots/didPlots.jsx ─────────────────
// ggdid-style SVG plot components for Callaway-Sant'Anna DiD results.
// All components: useRef + ResizeObserver, inline styles, C theme, dark bg.
//
// Exports:
//   GroupTimePlot        — faceted by cohort g; per-period ATT(g,t) with CIs
//   EventStudyDynamicPlot — aggregated ATT by event-time e = t - g
//   GroupAggPlot         — dot-CI forest plot of simple group aggregation
//   CalendarAggPlot      — line + CI band of calendar-period aggregation

import { useRef, useEffect, useState } from "react";
import { useTheme } from "../shared.jsx";
import PlotExportBar from "../../shared/PlotExportBar.jsx";
import { downloadGridPNG } from "../../../services/export/plotExporter.js";

const PAD = { top: 34, right: 24, bottom: 54, left: 68 };

// Safe min/max helpers that don't blow the call stack on large arrays
const arrMin = (a, fallback = 0) => a.length ? a.reduce((m, v) => v < m ? v : m, a[0]) : fallback;
const arrMax = (a, fallback = 1) => a.length ? a.reduce((m, v) => v > m ? v : m, a[0]) : fallback;

// ggplot-style "pretty" axis breaks — nice round numbers, evenly spaced,
// instead of the naive [min, 0, max] which collapses/overlaps when close together.
// Unlike a plain tick generator, this also returns the *domain* (min/max) snapped
// to the outermost ticks, so the plotted range always reaches — and never strands
// a data point past — the last labeled gridline.
function niceDomain(dataMin, dataMax, count = 5) {
  if (!isFinite(dataMin) || !isFinite(dataMax)) return { ticks: [0], min: -0.5, max: 0.5 };
  if (dataMin === dataMax) {
    const pad = Math.abs(dataMin) * 0.1 || 0.5;
    dataMin -= pad; dataMax += pad;
  }
  const pad = (dataMax - dataMin) * 0.05;
  const paddedMin = dataMin - pad;
  const paddedMax = dataMax + pad;
  const rawStep = (paddedMax - paddedMin) / Math.max(1, count - 1);
  const mag = Math.pow(10, Math.floor(Math.log10(rawStep)));
  const norm = rawStep / mag;
  const step = norm < 1.5 ? mag : norm < 3 ? 2 * mag : norm < 7 ? 5 * mag : 10 * mag;
  const niceMin = Math.floor(paddedMin / step) * step;
  const niceMax = Math.ceil(paddedMax / step) * step;
  const ticks = [];
  for (let v = niceMin; v <= niceMax + step * 1e-6; v += step) {
    ticks.push(Math.round(v / step) * step);
  }
  return { ticks: ticks.length ? ticks : [niceMin, niceMax], min: niceMin, max: niceMax };
}

function useWidth(ref) {
  const [w, setW] = useState(400);
  useEffect(() => {
    if (!ref.current) return;
    const ro = new ResizeObserver(entries => setW(entries[0].contentRect.width));
    ro.observe(ref.current);
    return () => ro.disconnect();
  }, []);
  return w;
}

// ── GroupTimePlot ─────────────────────────────────────────────────────────────
// Faceted by cohort g. One mini-chart per cohort in a flex-wrap grid.
// attgt: Array<{ g, t, att, se, isPre }>
export function GroupTimePlot({ attgt = [], critVal = 1.96 }) {
  const { C, T } = useTheme();
  const gridRef = useRef(null);
  const cohorts = [...new Set(attgt.map(c => c.g))].sort((a, b) => a - b);
  if (!cohorts.length) return null;

  const H = 220;
  const W_FACET = 300;

  return (
    <div ref={gridRef} style={{ marginTop: 8 }}>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 14, marginBottom: 10 }}>
      <div style={{ display: "flex", alignItems: "center", gap: 14, fontFamily: T.body.fontFamily, fontSize: 12, color: C.textMuted }}>
        <span style={{ display: "flex", alignItems: "center", gap: 5 }}>
          <span style={{ width: 8, height: 8, borderRadius: "50%", background: "#e05c5c", display: "inline-block" }} />
          pre-treatment
        </span>
        <span style={{ display: "flex", alignItems: "center", gap: 5 }}>
          <span style={{ width: 8, height: 8, borderRadius: "50%", background: "#6ec8b4", display: "inline-block" }} />
          post
        </span>
      </div>
        <button
          onClick={() => downloadGridPNG(Array.from(gridRef.current?.querySelectorAll("svg") ?? []), "callaway_group_time")}
          title="Download all cohort panels as PNG"
          style={{
            background: "transparent", border: `1px solid ${C.border2}`, borderRadius: 3,
            color: C.textDim, cursor: "pointer", fontFamily: T.code.fontFamily,
            fontSize: T.caption.fontSize, padding: "3px 8px", flexShrink: 0,
          }}
          onMouseEnter={e => { e.currentTarget.style.borderColor = C.teal; e.currentTarget.style.color = C.teal; }}
          onMouseLeave={e => { e.currentTarget.style.borderColor = C.border2; e.currentTarget.style.color = C.textDim; }}
        >↓ PNG</button>
      </div>
      <div style={{ display: "flex", flexWrap: "wrap", gap: 14 }}>
      {cohorts.map(g => {
        const cells = attgt.filter(c => c.g === g).sort((a, b) => a.t - b.t);
        const tMin = arrMin(cells.map(c => c.t));
        const tMax = arrMax(cells.map(c => c.t));
        const attBounds = cells.flatMap(c => [c.att - critVal * c.se, c.att + critVal * c.se]);
        const rawYMin = Math.min(0, arrMin(attBounds));
        const rawYMax = Math.max(0, arrMax(attBounds));
        const { ticks: yTicks, min: yMin, max: yMax } = niceDomain(rawYMin, rawYMax, 5);
        const fw = W_FACET;
        const xRange = Math.max(1, tMax - tMin);
        const yRange = yMax - yMin;
        const xScale = t => PAD.left + (t - tMin) / xRange * (fw - PAD.left - PAD.right);
        const yScale = v => PAD.top + (yMax - v) / yRange * (H - PAD.top - PAD.bottom);
        const yZero = yScale(0);

        return (
          <div key={g} style={{ background: C.surface, borderRadius: 6, padding: 10, border: `1px solid ${C.border}` }}>
            <div style={{ fontFamily: T.code.fontFamily, fontSize: 13, color: C.teal, marginBottom: 6 }}>
              g = {g}
            </div>
            <svg width={fw} height={H} style={{ display: "block" }}>
              {/* Zero line */}
              <line
                x1={PAD.left} x2={fw - PAD.right}
                y1={yZero} y2={yZero}
                stroke={C.textMuted} strokeWidth={0.5} strokeDasharray="3,3"
              />
              {/* Data points */}
              {cells.map((c, i) => {
                const cx = xScale(c.t);
                const cy = yScale(c.att);
                const col = c.isPre ? "#e05c5c" : "#6ec8b4";
                return (
                  <g key={i}>
                    <line
                      x1={cx} x2={cx}
                      y1={yScale(c.att - critVal * c.se)} y2={yScale(c.att + critVal * c.se)}
                      stroke={col} strokeWidth={1.5}
                    />
                    <circle cx={cx} cy={cy} r={4} fill={col} />
                    <text
                      x={cx} y={H - PAD.bottom + 18}
                      textAnchor="middle" fontSize={11} fill={C.textMuted}
                    >
                      {c.t}
                    </text>
                  </g>
                );
              })}
              {/* Y-axis ticks */}
              {yTicks.map((v, i) => (
                <g key={i}>
                  <line
                    x1={PAD.left - 4} x2={PAD.left}
                    y1={yScale(v)} y2={yScale(v)}
                    stroke={C.textMuted} strokeWidth={0.5}
                  />
                  <text
                    x={PAD.left - 7} y={yScale(v) + 4}
                    textAnchor="end" fontSize={11} fill={C.textMuted}
                  >
                    {v.toFixed(2)}
                  </text>
                </g>
              ))}
            </svg>
          </div>
        );
      })}
      </div>
    </div>
  );
}

// ── EventStudyDynamicPlot ─────────────────────────────────────────────────────
// Aggregated ATT by event-time e = t - g.
// byE: Array<{ e, att, se }>  (e < 0 = pre-treatment, e >= 0 = post)
export function EventStudyDynamicPlot({ byE = [], critVal = 1.96 }) {
  const { C, T } = useTheme();
  const ref = useRef();
  const w = useWidth(ref);
  const H = 340;

  if (!byE.length) return <div ref={ref} style={{ width: "100%" }} />;

  const eVals = byE.map(x => x.e);
  const eMin = arrMin(eVals);
  const eMax = arrMax(eVals);
  const attBounds = byE.flatMap(x => [x.att - critVal * x.se, x.att + critVal * x.se]);
  const rawYMin = Math.min(0, arrMin(attBounds));
  const rawYMax = Math.max(0, arrMax(attBounds));
  const { ticks: yTicks, min: yMin, max: yMax } = niceDomain(rawYMin, rawYMax, 6);
  const fw = Math.max(w, 1);
  const xRange = Math.max(1, eMax - eMin);
  const yRange = yMax - yMin;
  const xScale = e => PAD.left + (e - eMin) / xRange * (fw - PAD.left - PAD.right);
  const yScale = v => PAD.top + (yMax - v) / yRange * (H - PAD.top - PAD.bottom);
  const yZero = yScale(0);
  const xRef = xScale(-0.5);

  return (
    <div ref={ref} style={{ width: "100%", marginTop: 8 }}>
      <svg width={fw} height={H} style={{ display: "block" }}>
        {/* Reference line at e = -0.5 (between pre and post) */}
        <line
          x1={xRef} x2={xRef} y1={PAD.top} y2={H - PAD.bottom}
          stroke={C.textMuted} strokeWidth={0.5} strokeDasharray="4,4"
        />
        {/* Zero ATT line */}
        <line
          x1={PAD.left} x2={fw - PAD.right} y1={yZero} y2={yZero}
          stroke={C.textMuted} strokeWidth={0.5} strokeDasharray="3,3"
        />
        {/* CI bars + dots */}
        {byE.map((x, i) => {
          const cx = xScale(x.e);
          const col = x.e < 0 ? "#e05c5c" : "#6ec8b4";
          return (
            <g key={i}>
              <line
                x1={cx} x2={cx}
                y1={yScale(x.att - critVal * x.se)} y2={yScale(x.att + critVal * x.se)}
                stroke={col} strokeWidth={1.5}
              />
              <circle cx={cx} cy={yScale(x.att)} r={4} fill={col} />
              <text
                x={cx} y={H - PAD.bottom + 18}
                textAnchor="middle" fontSize={11} fill={C.textMuted}
              >
                {x.e}
              </text>
            </g>
          );
        })}
        {/* Y-axis ticks */}
        {yTicks.map((v, i) => (
          <g key={i}>
            <line
              x1={PAD.left - 4} x2={PAD.left}
              y1={yScale(v)} y2={yScale(v)}
              stroke={C.textMuted} strokeWidth={0.5}
            />
            <text
              x={PAD.left - 7} y={yScale(v) + 4}
              textAnchor="end" fontSize={11} fill={C.textMuted}
            >
              {v.toFixed(2)}
            </text>
          </g>
        ))}
        {/* Legend */}
        <g>
          <circle cx={fw - PAD.right - 140} cy={18} r={4} fill="#e05c5c" />
          <text x={fw - PAD.right - 130} y={22} fontSize={11} fill={C.textMuted} fontFamily={T.body.fontFamily}>
            pre-treatment
          </text>
          <circle cx={fw - PAD.right - 44} cy={18} r={4} fill="#6ec8b4" />
          <text x={fw - PAD.right - 34} y={22} fontSize={11} fill={C.textMuted} fontFamily={T.body.fontFamily}>
            post
          </text>
        </g>
        {/* Axis labels */}
        <text
          x={fw / 2} y={H - 8}
          textAnchor="middle" fontSize={12} fill={C.textMuted}
          fontFamily={T.body.fontFamily}
        >
          Event time (e = t − g)
        </text>
        <text
          x={16} y={H / 2}
          textAnchor="middle" fontSize={12} fill={C.textMuted}
          fontFamily={T.body.fontFamily}
          transform={`rotate(-90, 16, ${H / 2})`}
        >
          ATT
        </text>
      </svg>
      <PlotExportBar getEl={() => ref.current} filename="callaway_dynamic" />
    </div>
  );
}

// ── GroupAggPlot ─────────────────────────────────────────────────────────────
// Horizontal dot-CI forest plot of simple group aggregation.
// byG: Array<{ g, att, se }>
export function GroupAggPlot({ byG = [], critVal = 1.96 }) {
  const { C, T } = useTheme();
  const ref = useRef();
  const w = useWidth(ref);

  if (!byG.length) return <div ref={ref} style={{ width: "100%" }} />;

  const rowH = 42;
  const axisH = 46; // room for tick marks + tick labels + axis title
  const H = byG.length * rowH + 30 + axisH;
  const attBounds = byG.flatMap(x => [x.att - critVal * x.se, x.att + critVal * x.se]);
  const rawXMin = Math.min(0, arrMin(attBounds));
  const rawXMax = Math.max(0, arrMax(attBounds));
  const { ticks: xTicks, min: xMin, max: xMax } = niceDomain(rawXMin, rawXMax, 5);
  const fw = Math.max(w, 1);
  const xRange = xMax - xMin;
  const xScale = v => PAD.left + (v - xMin) / xRange * (fw - PAD.left - PAD.right);
  const yScale = i => 30 + i * rowH;
  const xZero = xScale(0);
  const rowsEnd = 30 + byG.length * rowH;

  return (
    <div ref={ref} style={{ width: "100%", marginTop: 8 }}>
      <svg width={fw} height={H} style={{ display: "block" }}>
        {/* Zero line */}
        <line
          x1={xZero} x2={xZero} y1={18} y2={rowsEnd}
          stroke={C.textMuted} strokeWidth={0.5} strokeDasharray="3,3"
        />
        {/* X-axis baseline */}
        <line
          x1={PAD.left} x2={fw - PAD.right} y1={rowsEnd} y2={rowsEnd}
          stroke={C.textMuted} strokeWidth={0.5}
        />
        {/* X-axis ticks */}
        {xTicks.map((v, i) => (
          <g key={i}>
            <line
              x1={xScale(v)} x2={xScale(v)}
              y1={rowsEnd} y2={rowsEnd + 5}
              stroke={C.textMuted} strokeWidth={0.5}
            />
            <text
              x={xScale(v)} y={rowsEnd + 19}
              textAnchor="middle" fontSize={11} fill={C.textMuted}
            >
              {v.toFixed(2)}
            </text>
          </g>
        ))}
        {/* Rows */}
        {byG.map((x, i) => {
          const cy = yScale(i);
          const cLo = xScale(x.att - critVal * x.se);
          const cHi = xScale(x.att + critVal * x.se);
          const col = x.att >= 0 ? "#6ec8b4" : "#e05c5c";
          return (
            <g key={i}>
              <text
                x={PAD.left - 7} y={cy + 4}
                textAnchor="end" fontSize={12} fill={C.textMuted}
                fontFamily={T.body.fontFamily}
              >
                g={x.g}
              </text>
              <line x1={cLo} x2={cHi} y1={cy} y2={cy} stroke={col} strokeWidth={2} />
              <circle cx={xScale(x.att)} cy={cy} r={4.5} fill={col} />
            </g>
          );
        })}
        {/* X-axis label */}
        <text
          x={(xZero + fw - PAD.right) / 2} y={H - 6}
          textAnchor="middle" fontSize={12} fill={C.textMuted}
          fontFamily={T.body.fontFamily}
        >
          ATT
        </text>
      </svg>
      <PlotExportBar getEl={() => ref.current} filename="callaway_group_agg" />
    </div>
  );
}

// ── CalendarAggPlot ───────────────────────────────────────────────────────────
// Line + CI dots of calendar-period aggregation.
// byT: Array<{ t, att, se }>
export function CalendarAggPlot({ byT = [], critVal = 1.96 }) {
  const { C, T } = useTheme();
  const ref = useRef();
  const w = useWidth(ref);
  const H = 300;

  if (!byT.length) return <div ref={ref} style={{ width: "100%" }} />;

  const tVals = byT.map(x => x.t);
  const tMin = arrMin(tVals);
  const tMax = arrMax(tVals);
  const attBounds = byT.flatMap(x => [x.att - critVal * x.se, x.att + critVal * x.se]);
  const rawYMin = Math.min(0, arrMin(attBounds));
  const rawYMax = Math.max(0, arrMax(attBounds));
  const { ticks: yTicks, min: yMin, max: yMax } = niceDomain(rawYMin, rawYMax, 6);
  const fw = Math.max(w, 1);
  const xRange = Math.max(1, tMax - tMin);
  const yRange = yMax - yMin;
  const xScale = t => PAD.left + (t - tMin) / xRange * (fw - PAD.left - PAD.right);
  const yScale = v => PAD.top + (yMax - v) / yRange * (H - PAD.top - PAD.bottom);
  const yZero = yScale(0);

  return (
    <div ref={ref} style={{ width: "100%", marginTop: 8 }}>
      <svg width={fw} height={H} style={{ display: "block" }}>
        {/* Zero line */}
        <line
          x1={PAD.left} x2={fw - PAD.right} y1={yZero} y2={yZero}
          stroke={C.textMuted} strokeWidth={0.5} strokeDasharray="3,3"
        />
        {/* Connected line */}
        <polyline
          points={byT.map(x => `${xScale(x.t)},${yScale(x.att)}`).join(" ")}
          fill="none" stroke="#6ec8b4" strokeWidth={1.5}
        />
        {/* CI bars + dots */}
        {byT.map((x, i) => (
          <g key={i}>
            <line
              x1={xScale(x.t)} x2={xScale(x.t)}
              y1={yScale(x.att - critVal * x.se)} y2={yScale(x.att + critVal * x.se)}
              stroke="#6ec8b4" strokeWidth={1.5}
            />
            <circle cx={xScale(x.t)} cy={yScale(x.att)} r={4} fill="#6ec8b4" />
            <text
              x={xScale(x.t)} y={H - PAD.bottom + 18}
              textAnchor="middle" fontSize={11} fill={C.textMuted}
            >
              {x.t}
            </text>
          </g>
        ))}
        {/* Y-axis ticks */}
        {yTicks.map((v, i) => (
          <g key={i}>
            <line
              x1={PAD.left - 4} x2={PAD.left}
              y1={yScale(v)} y2={yScale(v)}
              stroke={C.textMuted} strokeWidth={0.5}
            />
            <text
              x={PAD.left - 7} y={yScale(v) + 4}
              textAnchor="end" fontSize={11} fill={C.textMuted}
            >
              {v.toFixed(2)}
            </text>
          </g>
        ))}
        {/* Axis label */}
        <text
          x={fw / 2} y={H - 8}
          textAnchor="middle" fontSize={12} fill={C.textMuted}
          fontFamily={T.body.fontFamily}
        >
          Calendar period
        </text>
      </svg>
      <PlotExportBar getEl={() => ref.current} filename="callaway_calendar" />
    </div>
  );
}
