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

const PAD = { top: 30, right: 20, bottom: 45, left: 55 };

// Safe min/max helpers that don't blow the call stack on large arrays
const arrMin = (a, fallback = 0) => a.length ? a.reduce((m, v) => v < m ? v : m, a[0]) : fallback;
const arrMax = (a, fallback = 1) => a.length ? a.reduce((m, v) => v > m ? v : m, a[0]) : fallback;

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
  const cohorts = [...new Set(attgt.map(c => c.g))].sort((a, b) => a - b);
  if (!cohorts.length) return null;

  const H = 140;
  const W_FACET = 200;

  return (
    <div style={{ display: "flex", flexWrap: "wrap", gap: 12, marginTop: 8 }}>
      {cohorts.map(g => {
        const cells = attgt.filter(c => c.g === g).sort((a, b) => a.t - b.t);
        const tMin = arrMin(cells.map(c => c.t));
        const tMax = arrMax(cells.map(c => c.t));
        const attBounds = cells.flatMap(c => [c.att - critVal * c.se, c.att + critVal * c.se]);
        const yMin = Math.min(0, arrMin(attBounds)) - 0.05;
        const yMax = Math.max(0, arrMax(attBounds)) + 0.05;
        const fw = W_FACET;
        const xRange = Math.max(1, tMax - tMin);
        const yRange = yMax - yMin;
        const xScale = t => PAD.left + (t - tMin) / xRange * (fw - PAD.left - PAD.right);
        const yScale = v => PAD.top + (yMax - v) / yRange * (H - PAD.top - PAD.bottom);
        const yZero = yScale(0);

        // Y-axis tick values: yMin, 0, yMax (deduplicated)
        const yTicks = [yMin, 0, yMax].filter((v, i, arr) => arr.findIndex(x => Math.abs(x - v) < 1e-9) === i);

        return (
          <div key={g} style={{ background: C.surface, borderRadius: 6, padding: 8, border: `1px solid ${C.border}` }}>
            <div style={{ fontFamily: T.code.fontFamily, fontSize: 10, color: C.teal, marginBottom: 4 }}>
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
                    <circle cx={cx} cy={cy} r={3.5} fill={col} />
                    <text
                      x={cx} y={H - PAD.bottom + 14}
                      textAnchor="middle" fontSize={9} fill={C.textMuted}
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
                    x1={PAD.left - 3} x2={PAD.left}
                    y1={yScale(v)} y2={yScale(v)}
                    stroke={C.textMuted} strokeWidth={0.5}
                  />
                  <text
                    x={PAD.left - 5} y={yScale(v) + 3}
                    textAnchor="end" fontSize={8} fill={C.textMuted}
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
  );
}

// ── EventStudyDynamicPlot ─────────────────────────────────────────────────────
// Aggregated ATT by event-time e = t - g.
// byE: Array<{ e, att, se }>  (e < 0 = pre-treatment, e >= 0 = post)
export function EventStudyDynamicPlot({ byE = [], critVal = 1.96 }) {
  const { C, T } = useTheme();
  const ref = useRef();
  const w = useWidth(ref);
  const H = 260;

  if (!byE.length) return <div ref={ref} style={{ width: "100%" }} />;

  const eVals = byE.map(x => x.e);
  const eMin = arrMin(eVals);
  const eMax = arrMax(eVals);
  const attBounds = byE.flatMap(x => [x.att - critVal * x.se, x.att + critVal * x.se]);
  const yMin = Math.min(0, arrMin(attBounds)) - 0.05;
  const yMax = Math.max(0, arrMax(attBounds)) + 0.05;
  const fw = Math.max(w, 1);
  const xRange = Math.max(1, eMax - eMin);
  const yRange = yMax - yMin;
  const xScale = e => PAD.left + (e - eMin) / xRange * (fw - PAD.left - PAD.right);
  const yScale = v => PAD.top + (yMax - v) / yRange * (H - PAD.top - PAD.bottom);
  const yZero = yScale(0);
  const xRef = xScale(-0.5);

  const yTicks = [yMin, 0, yMax].filter((v, i, arr) => arr.findIndex(x => Math.abs(x - v) < 1e-9) === i);

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
              <circle cx={cx} cy={yScale(x.att)} r={3.5} fill={col} />
              <text
                x={cx} y={H - PAD.bottom + 14}
                textAnchor="middle" fontSize={9} fill={C.textMuted}
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
              x1={PAD.left - 3} x2={PAD.left}
              y1={yScale(v)} y2={yScale(v)}
              stroke={C.textMuted} strokeWidth={0.5}
            />
            <text
              x={PAD.left - 5} y={yScale(v) + 3}
              textAnchor="end" fontSize={9} fill={C.textMuted}
            >
              {v.toFixed(2)}
            </text>
          </g>
        ))}
        {/* Axis labels */}
        <text
          x={fw / 2} y={H - 5}
          textAnchor="middle" fontSize={10} fill={C.textMuted}
          fontFamily={T.body.fontFamily}
        >
          Event time (e = t − g)
        </text>
        <text
          x={12} y={H / 2}
          textAnchor="middle" fontSize={10} fill={C.textMuted}
          fontFamily={T.body.fontFamily}
          transform={`rotate(-90, 12, ${H / 2})`}
        >
          ATT
        </text>
      </svg>
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

  const rowH = 32;
  const H = byG.length * rowH + 50;
  const attBounds = byG.flatMap(x => [x.att - critVal * x.se, x.att + critVal * x.se]);
  const xMin = Math.min(0, arrMin(attBounds)) - 0.05;
  const xMax = Math.max(0, arrMax(attBounds)) + 0.05;
  const fw = Math.max(w, 1);
  const xRange = xMax - xMin;
  const xScale = v => PAD.left + (v - xMin) / xRange * (fw - PAD.left - PAD.right);
  const yScale = i => 25 + i * rowH;
  const xZero = xScale(0);

  return (
    <div ref={ref} style={{ width: "100%", marginTop: 8 }}>
      <svg width={fw} height={H} style={{ display: "block" }}>
        {/* Zero line */}
        <line
          x1={xZero} x2={xZero} y1={15} y2={H - 20}
          stroke={C.textMuted} strokeWidth={0.5} strokeDasharray="3,3"
        />
        {/* Rows */}
        {byG.map((x, i) => {
          const cy = yScale(i);
          const cLo = xScale(x.att - critVal * x.se);
          const cHi = xScale(x.att + critVal * x.se);
          return (
            <g key={i}>
              <text
                x={PAD.left - 5} y={cy + 3}
                textAnchor="end" fontSize={9} fill={C.textMuted}
                fontFamily={T.body.fontFamily}
              >
                g={x.g}
              </text>
              <line x1={cLo} x2={cHi} y1={cy} y2={cy} stroke="#6ec8b4" strokeWidth={1.5} />
              <circle cx={xScale(x.att)} cy={cy} r={4} fill="#6ec8b4" />
            </g>
          );
        })}
        {/* X-axis label */}
        <text
          x={(xZero + fw - PAD.right) / 2} y={H - 5}
          textAnchor="middle" fontSize={10} fill={C.textMuted}
          fontFamily={T.body.fontFamily}
        >
          ATT
        </text>
      </svg>
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
  const H = 220;

  if (!byT.length) return <div ref={ref} style={{ width: "100%" }} />;

  const tVals = byT.map(x => x.t);
  const tMin = arrMin(tVals);
  const tMax = arrMax(tVals);
  const attBounds = byT.flatMap(x => [x.att - critVal * x.se, x.att + critVal * x.se]);
  const yMin = Math.min(0, arrMin(attBounds)) - 0.05;
  const yMax = Math.max(0, arrMax(attBounds)) + 0.05;
  const fw = Math.max(w, 1);
  const xRange = Math.max(1, tMax - tMin);
  const yRange = yMax - yMin;
  const xScale = t => PAD.left + (t - tMin) / xRange * (fw - PAD.left - PAD.right);
  const yScale = v => PAD.top + (yMax - v) / yRange * (H - PAD.top - PAD.bottom);
  const yZero = yScale(0);

  const yTicks = [yMin, 0, yMax].filter((v, i, arr) => arr.findIndex(x => Math.abs(x - v) < 1e-9) === i);

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
            <circle cx={xScale(x.t)} cy={yScale(x.att)} r={3.5} fill="#6ec8b4" />
            <text
              x={xScale(x.t)} y={H - PAD.bottom + 14}
              textAnchor="middle" fontSize={9} fill={C.textMuted}
            >
              {x.t}
            </text>
          </g>
        ))}
        {/* Y-axis ticks */}
        {yTicks.map((v, i) => (
          <g key={i}>
            <line
              x1={PAD.left - 3} x2={PAD.left}
              y1={yScale(v)} y2={yScale(v)}
              stroke={C.textMuted} strokeWidth={0.5}
            />
            <text
              x={PAD.left - 5} y={yScale(v) + 3}
              textAnchor="end" fontSize={9} fill={C.textMuted}
            >
              {v.toFixed(2)}
            </text>
          </g>
        ))}
        {/* Axis label */}
        <text
          x={fw / 2} y={H - 5}
          textAnchor="middle" fontSize={10} fill={C.textMuted}
          fontFamily={T.body.fontFamily}
        >
          Calendar period
        </text>
      </svg>
    </div>
  );
}
