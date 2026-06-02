// ─── ECON STUDIO · src/components/tabs/statsim/QTEPanel.jsx ───────────────────
// Collapsible Quantile Treatment Effects panel. Given a numeric outcome and a
// binary treatment, estimates QTE_τ = F₁⁻¹(τ) − F₀⁻¹(τ) over a τ grid with a
// seeded bootstrap band, and renders: (1) a QTE table, (2) a QTE-vs-τ SVG plot
// with a dashed ATE reference line, (3) overlaid empirical CDFs with a
// horizontal arrow visualizing the QTE at a selected τ. Math lives in
// src/math/QTE.js — this file is UI only.
//
// Props:
//   columns     [{ name, values:number[] }]  — numeric columns
//   title       string
//   defaultOpen bool

import { useState, useMemo } from "react";
import { useTheme } from "../../../ThemeContext.jsx";
import { useSessionLog } from "../../../services/session/sessionLog.jsx";
import { quantileTreatmentEffect } from "../../../math/QTE.js";

const mono = "'IBM Plex Mono','JetBrains Mono',Consolas,monospace";

function fmt(n, d = 4) {
  return (typeof n === "number" && isFinite(n)) ? n.toFixed(d) : "—";
}

const TAU_PRESETS = {
  "5-point": [0.1, 0.25, 0.5, 0.75, 0.9],
  "deciles": [0.1, 0.2, 0.3, 0.4, 0.5, 0.6, 0.7, 0.8, 0.9],
  "fine": Array.from({ length: 17 }, (_, i) => +(0.1 + i * 0.05).toFixed(2)), // 0.1..0.9 by .05
};

function parseTaus(preset, custom) {
  if (preset !== "custom") return TAU_PRESETS[preset];
  const list = String(custom).split(",").map(s => parseFloat(s.trim())).filter(x => isFinite(x) && x > 0 && x < 1);
  return list.length ? Array.from(new Set(list)).sort((a, b) => a - b) : TAU_PRESETS["5-point"];
}

// ── QTE-vs-τ plot ─────────────────────────────────────────────────────────────
function QTEPlot({ res, C }) {
  const W = 470, H = 230, m = { t: 16, r: 16, b: 34, l: 46 };
  const iw = W - m.l - m.r, ih = H - m.t - m.b;
  const { taus, qte, ate, ci } = res;
  const lows = ci ? ci.low : qte, highs = ci ? ci.high : qte;
  let yMin = Math.min(ate, ...lows, ...qte), yMax = Math.max(ate, ...highs, ...qte);
  if (yMin === yMax) { yMin -= 1; yMax += 1; }
  const pad = (yMax - yMin) * 0.08; yMin -= pad; yMax += pad;
  const tMin = Math.min(...taus), tMax = Math.max(...taus);
  const sx = t => m.l + (tMax === tMin ? iw / 2 : (t - tMin) / (tMax - tMin) * iw);
  const sy = v => m.t + (1 - (v - yMin) / (yMax - yMin)) * ih;

  const linePts = taus.map((t, i) => `${sx(t)},${sy(qte[i])}`).join(" ");
  const ribbon = ci
    ? taus.map((t, i) => `${sx(t)},${sy(highs[i])}`).join(" ") + " " +
      taus.map((t, i) => `${sx(t)},${sy(lows[i])}`).reverse().join(" ")
    : null;

  const yTicks = 4;
  return (
    <svg width="100%" viewBox={`0 0 ${W} ${H}`} style={{ display: "block" }}>
      {/* y grid + labels */}
      {Array.from({ length: yTicks + 1 }, (_, i) => {
        const v = yMin + (yMax - yMin) * i / yTicks;
        const y = sy(v);
        return (
          <g key={i}>
            <line x1={m.l} y1={y} x2={W - m.r} y2={y} stroke={C.border} strokeWidth="0.5" />
            <text x={m.l - 6} y={y + 3} textAnchor="end" fontFamily={mono} fontSize="8" fill={C.textMuted}>{v.toFixed(2)}</text>
          </g>
        );
      })}
      {/* x labels */}
      {taus.map((t, i) => (
        <text key={i} x={sx(t)} y={H - m.b + 14} textAnchor="middle" fontFamily={mono} fontSize="8" fill={C.textMuted}>{t}</text>
      ))}
      <text x={m.l + iw / 2} y={H - 4} textAnchor="middle" fontFamily={mono} fontSize="8" fill={C.textDim}>τ (quantile)</text>
      {/* zero line */}
      {yMin < 0 && yMax > 0 && <line x1={m.l} y1={sy(0)} x2={W - m.r} y2={sy(0)} stroke={C.border2} strokeWidth="0.7" />}
      {/* ATE dashed reference */}
      <line x1={m.l} y1={sy(ate)} x2={W - m.r} y2={sy(ate)} stroke={C.blue} strokeWidth="1" strokeDasharray="5 3" />
      <text x={W - m.r} y={sy(ate) - 4} textAnchor="end" fontFamily={mono} fontSize="8" fill={C.blue}>OLS (ATE) = {fmt(ate, 3)}</text>
      {/* CI ribbon */}
      {ribbon && <polygon points={ribbon} fill={`${C.gold}1e`} stroke="none" />}
      {/* QTE line + points */}
      <polyline points={linePts} fill="none" stroke={C.gold} strokeWidth="1.5" />
      {taus.map((t, i) => <circle key={i} cx={sx(t)} cy={sy(qte[i])} r="2.6" fill={C.gold} />)}
    </svg>
  );
}

// ── Overlaid empirical CDFs with QTE arrow at selected τ ──────────────────────
function CDFPlot({ res, selTau, C }) {
  const W = 470, H = 230, m = { t: 16, r: 16, b: 34, l: 40 };
  const iw = W - m.l - m.r, ih = H - m.t - m.b;
  const { ecdf0, ecdf1, taus, q0, q1 } = res;
  const allX = [...ecdf0.x, ...ecdf1.x];
  let xMin = Math.min(...allX), xMax = Math.max(...allX);
  if (xMin === xMax) { xMin -= 1; xMax += 1; }
  const px = (xMax - xMin) * 0.04; xMin -= px; xMax += px;
  const sx = v => m.l + (v - xMin) / (xMax - xMin) * iw;
  const sy = f => m.t + (1 - f) * ih;

  // Build SVG step path for an ECDF.
  const stepPath = (e) => {
    if (!e.x.length) return "";
    let d = `M ${sx(xMin)} ${sy(0)}`;
    let prevF = 0;
    for (let i = 0; i < e.x.length; i++) {
      const x = sx(e.x[i]);
      d += ` L ${x} ${sy(prevF)} L ${x} ${sy(e.F[i])}`;
      prevF = e.F[i];
    }
    d += ` L ${sx(xMax)} ${sy(prevF)}`;
    return d;
  };

  const j = taus.indexOf(selTau);
  const a0 = j >= 0 ? q0[j] : null, a1 = j >= 0 ? q1[j] : null;

  return (
    <svg width="100%" viewBox={`0 0 ${W} ${H}`} style={{ display: "block" }}>
      {/* y grid */}
      {[0, 0.25, 0.5, 0.75, 1].map((f, i) => (
        <g key={i}>
          <line x1={m.l} y1={sy(f)} x2={W - m.r} y2={sy(f)} stroke={C.border} strokeWidth="0.5" />
          <text x={m.l - 5} y={sy(f) + 3} textAnchor="end" fontFamily={mono} fontSize="8" fill={C.textMuted}>{f}</text>
        </g>
      ))}
      <text x={m.l + iw / 2} y={H - 4} textAnchor="middle" fontFamily={mono} fontSize="8" fill={C.textDim}>outcome{res.transform === "log" ? " (log)" : ""}</text>
      {/* CDF curves */}
      <path d={stepPath(ecdf0)} fill="none" stroke={C.teal} strokeWidth="1.4" />
      <path d={stepPath(ecdf1)} fill="none" stroke={C.gold} strokeWidth="1.4" />
      {/* QTE arrow at selected τ */}
      {a0 != null && a1 != null && (
        <g>
          <line x1={m.l} y1={sy(selTau)} x2={W - m.r} y2={sy(selTau)} stroke={C.textMuted} strokeWidth="0.5" strokeDasharray="2 2" />
          <line x1={sx(a0)} y1={sy(selTau)} x2={sx(a1)} y2={sy(selTau)} stroke={C.red ?? "#c87e7e"} strokeWidth="1.6" />
          {[a0, a1].map((q, i) => <circle key={i} cx={sx(q)} cy={sy(selTau)} r="2.6" fill={i === 0 ? C.teal : C.gold} />)}
          <text x={(sx(a0) + sx(a1)) / 2} y={sy(selTau) - 5} textAnchor="middle" fontFamily={mono} fontSize="8" fill={C.red ?? "#c87e7e"}>
            QTE(τ={selTau}) = {fmt(a1 - a0, 3)}
          </text>
        </g>
      )}
      {/* legend */}
      <g fontFamily={mono} fontSize="8">
        <rect x={W - m.r - 96} y={m.t + 2} width="9" height="3" fill={C.teal} />
        <text x={W - m.r - 84} y={m.t + 7} fill={C.textDim}>control</text>
        <rect x={W - m.r - 96} y={m.t + 14} width="9" height="3" fill={C.gold} />
        <text x={W - m.r - 84} y={m.t + 19} fill={C.textDim}>treated</text>
      </g>
    </svg>
  );
}

export default function QTEPanel({ columns = [], title = "Quantile Treatment Effects", defaultOpen = false }) {
  const { C } = useTheme();
  const { appendLog } = useSessionLog();
  const [open, setOpen] = useState(defaultOpen);
  const [yCol, setYCol] = useState("");
  const [dCol, setDCol] = useState("");
  const [tauPreset, setTauPreset] = useState("5-point");
  const [tauCustom, setTauCustom] = useState("0.1,0.25,0.5,0.75,0.9");
  const [transform, setTransform] = useState("none");
  const [ci, setCi] = useState("percentile");
  const [B, setB] = useState("2000");
  const [seed, setSeed] = useState("42");
  const [res, setRes] = useState(null);
  const [selTau, setSelTau] = useState(0.5);

  const field = { background: C.surface2, border: `1px solid ${C.border2}`, borderRadius: 3, color: C.text, fontFamily: mono, fontSize: 11, padding: "0.28rem 0.55rem", outline: "none" };

  const effY = columns.some(c => c.name === yCol) ? yCol : (columns[0]?.name ?? "");
  const effD = columns.some(c => c.name === dCol) ? dCol : (columns[1]?.name ?? columns[0]?.name ?? "");
  const selY = columns.find(c => c.name === effY) ?? null;
  const selD = columns.find(c => c.name === effD) ?? null;
  const taus = useMemo(() => parseTaus(tauPreset, tauCustom), [tauPreset, tauCustom]);
  const noData = columns.length === 0;

  function run() {
    if (!selY || !selD) { setRes({ error: "Pick an outcome and a treatment column." }); return; }
    const r = quantileTreatmentEffect(selY.values, selD.values, {
      taus, transform, ci, B: Number(B) || 2000, seed: seed === "" ? null : Number(seed),
    });
    setRes(r);
    if (r && !r.error) {
      if (!taus.includes(selTau)) setSelTau(taus[Math.floor(taus.length / 2)]);
      appendLog?.({
        module: "stat", opType: "qte",
        params: { outcome: effY, treatment: effD, taus, transform, ci, B: Number(B) || 2000, seed: r.seed },
        label: `QTE: ${effY} ~ ${effD} (${taus.length} τ, ATE=${fmt(r.ate, 3)}, seed=${r.seed})`,
      });
    }
  }

  const modeBtn = (cur, set, id, label) => (
    <button key={id} onClick={() => set(id)}
      style={{
        background: cur === id ? `${C.gold}18` : "transparent",
        border: `1px solid ${cur === id ? C.gold : C.border2}`,
        color: cur === id ? C.gold : C.textDim,
        fontFamily: mono, fontSize: 10, letterSpacing: "0.06em",
        padding: "0.3rem 0.65rem", borderRadius: 2, cursor: "pointer",
      }}>{label}</button>
  );

  return (
    <div style={{ border: `1px solid ${C.border}`, borderRadius: 4, overflow: "hidden", marginBottom: "1.4rem" }}>
      <div onClick={() => setOpen(o => !o)}
        style={{ background: C.surface2, padding: "0.55rem 0.85rem", borderBottom: open ? `1px solid ${C.border}` : "none", cursor: "pointer", display: "flex", alignItems: "center", gap: 8 }}>
        <span style={{ fontSize: 9, color: C.textMuted }}>{open ? "▾" : "▸"}</span>
        <span style={{ fontSize: 10, color: C.textDim, letterSpacing: "0.2em", textTransform: "uppercase", fontFamily: mono }}>{title}</span>
        {noData && <span style={{ marginLeft: "auto", fontSize: 9, color: C.textMuted }}>no numeric data</span>}
      </div>

      {open && (
        <div style={{ padding: "0.8rem 0.85rem", background: C.surface, display: "flex", flexDirection: "column", gap: 10 }}>
          {/* outcome + treatment */}
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center" }}>
            <span style={{ fontFamily: mono, fontSize: 9, color: C.textMuted }}>outcome Y</span>
            <select value={effY} onChange={e => setYCol(e.target.value)} style={{ ...field, maxWidth: 200 }} disabled={!columns.length}>
              {!columns.length && <option value="">— none —</option>}
              {columns.map(c => <option key={c.name} value={c.name}>{c.name}</option>)}
            </select>
            <span style={{ fontFamily: mono, fontSize: 9, color: C.textMuted }}>treatment D (binary)</span>
            <select value={effD} onChange={e => setDCol(e.target.value)} style={{ ...field, maxWidth: 200 }} disabled={!columns.length}>
              {!columns.length && <option value="">— none —</option>}
              {columns.map(c => <option key={c.name} value={c.name}>{c.name}</option>)}
            </select>
          </div>

          {/* τ grid */}
          <div style={{ display: "flex", gap: 6, flexWrap: "wrap", alignItems: "center" }}>
            <span style={{ fontFamily: mono, fontSize: 9, color: C.textMuted }}>τ grid</span>
            {modeBtn(tauPreset, setTauPreset, "5-point", "0.1·0.25·0.5·0.75·0.9")}
            {modeBtn(tauPreset, setTauPreset, "deciles", "deciles")}
            {modeBtn(tauPreset, setTauPreset, "fine", "seq .1–.9 ×.05")}
            {modeBtn(tauPreset, setTauPreset, "custom", "custom")}
            {tauPreset === "custom" && (
              <input value={tauCustom} onChange={e => setTauCustom(e.target.value)} placeholder="0.1,0.5,0.9" style={{ ...field, width: 180 }} />
            )}
          </div>

          {/* transform + CI + B + seed */}
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center" }}>
            <span style={{ fontFamily: mono, fontSize: 9, color: C.textMuted }}>transform</span>
            {modeBtn(transform, setTransform, "none", "none")}
            {modeBtn(transform, setTransform, "log", "log(Y)")}
            <span style={{ fontFamily: mono, fontSize: 9, color: C.textMuted, marginLeft: 8 }}>CI</span>
            <select value={ci} onChange={e => setCi(e.target.value)} style={field}>
              <option value="none">none</option>
              <option value="percentile">percentile</option>
              <option value="basic">basic</option>
              <option value="bca">BCa</option>
            </select>
            {ci !== "none" && (
              <>
                <label style={{ display: "flex", alignItems: "center", gap: 5, fontFamily: mono, fontSize: 9, color: C.textMuted }}>
                  B <input type="number" step="100" value={B} onChange={e => setB(e.target.value)} style={{ ...field, width: 80 }} />
                </label>
                <label style={{ display: "flex", alignItems: "center", gap: 5, fontFamily: mono, fontSize: 9, color: C.textMuted }}>
                  seed <input type="number" step="1" value={seed} onChange={e => setSeed(e.target.value)} style={{ ...field, width: 80 }} />
                </label>
              </>
            )}
            <button onClick={run} disabled={noData}
              style={{ marginLeft: "auto", background: C.teal, border: "none", color: C.bg, fontFamily: mono, fontSize: 10, fontWeight: 600, letterSpacing: "0.08em", padding: "0.35rem 1rem", borderRadius: 3, cursor: noData ? "not-allowed" : "pointer", opacity: noData ? 0.5 : 1 }}>
              RUN QTE
            </button>
          </div>

          {res?.error && <div style={{ fontFamily: mono, fontSize: 10, color: C.red ?? "#c87e7e" }}>{res.error}</div>}

          {res && !res.error && (
            <>
              <div style={{ fontFamily: mono, fontSize: 10, color: C.textDim }}>
                control = {String(res.controlLevel)} (n={res.n0}) · treated = {String(res.treatedLevel)} (n={res.n1}) · ATE = <span style={{ color: C.blue }}>{fmt(res.ate, 4)}</span>
                {res.transform === "log" && res.droppedLog > 0 && <span style={{ color: C.red ?? "#c87e7e" }}> · {res.droppedLog} non-positive dropped (log)</span>}
                {res.ci && <span> · {res.ci.type} band, B={res.ci.B}, seed={res.seed}</span>}
              </div>

              {/* QTE table */}
              <div style={{ overflowX: "auto" }}>
                <table style={{ borderCollapse: "collapse", fontFamily: mono, fontSize: 10.5, color: C.text }}>
                  <thead>
                    <tr style={{ color: C.textMuted }}>
                      <th style={{ textAlign: "right", padding: "2px 10px" }}>τ</th>
                      <th style={{ textAlign: "right", padding: "2px 10px" }}>Q̂₀</th>
                      <th style={{ textAlign: "right", padding: "2px 10px" }}>Q̂₁</th>
                      <th style={{ textAlign: "right", padding: "2px 10px", color: C.gold }}>QTE</th>
                      {res.ci && <th style={{ textAlign: "right", padding: "2px 10px" }}>CI low</th>}
                      {res.ci && <th style={{ textAlign: "right", padding: "2px 10px" }}>CI high</th>}
                    </tr>
                  </thead>
                  <tbody>
                    {res.taus.map((t, i) => (
                      <tr key={i} style={{ borderTop: `1px solid ${C.border}` }}>
                        <td style={{ textAlign: "right", padding: "2px 10px", color: C.textDim }}>{t}</td>
                        <td style={{ textAlign: "right", padding: "2px 10px" }}>{fmt(res.q0[i])}</td>
                        <td style={{ textAlign: "right", padding: "2px 10px" }}>{fmt(res.q1[i])}</td>
                        <td style={{ textAlign: "right", padding: "2px 10px", color: C.gold }}>{fmt(res.qte[i])}</td>
                        {res.ci && <td style={{ textAlign: "right", padding: "2px 10px", color: C.textDim }}>{fmt(res.ci.low[i])}</td>}
                        {res.ci && <td style={{ textAlign: "right", padding: "2px 10px", color: C.textDim }}>{fmt(res.ci.high[i])}</td>}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>

              {/* QTE-vs-τ plot */}
              <div style={{ background: C.surface2, border: `1px solid ${C.border}`, borderRadius: 3, padding: "0.4rem" }}>
                <QTEPlot res={res} C={C} />
              </div>

              {/* Overlaid CDFs with arrow */}
              <div>
                <div style={{ display: "flex", gap: 6, flexWrap: "wrap", alignItems: "center", marginBottom: 6 }}>
                  <span style={{ fontFamily: mono, fontSize: 9, color: C.textMuted }}>read QTE at τ</span>
                  {res.taus.map(t => modeBtn(selTau, setSelTau, t, String(t)))}
                </div>
                <div style={{ background: C.surface2, border: `1px solid ${C.border}`, borderRadius: 3, padding: "0.4rem" }}>
                  <CDFPlot res={res} selTau={selTau} C={C} />
                </div>
              </div>
            </>
          )}
        </div>
      )}
    </div>
  );
}
