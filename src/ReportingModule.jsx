// ─── ECON STUDIO · ReportingModule.jsx ───────────────────────────────────────
// Publication-ready reporting layer.
// Consumes a `result` object emitted by ModelingTab (the active regression result).
//
// result shape (normalised inside this module — see normaliseResult()):
//   { varNames, beta, se, tStats, pVals, R2, adjR2, n, df,
//     modelLabel, yVar, xVars, Fstat?, Fpval?, att?, attSE?, attP? }
//
// Usage from ModelingTab (or App.jsx):
//   <ReportingModule result={activeResult} onClose={...} />

import { useState, useEffect, useRef, useMemo } from "react";
import { useTheme } from "./ThemeContext.jsx";
import { HintBox } from "./components/HelpSystem.jsx";
import { stars, buildLatex } from "./math/index.js";
import { interpretRegression, generateUnifiedScript } from "./services/AI/AIService.js";
import { buildSessionSnapshot } from "./services/AI/sessionSnapshot.js";
import { useSessionLog } from "./services/session/sessionLog.jsx";
import { useSessionState } from "./services/session/sessionState.jsx";
import { generateCleanScript, generateWorkspaceScript, toDfVar } from "./pipeline/exporter.js";
import { loadProjectPipelines } from "./services/Persistence/indexedDB.js";
import { generateRScript }     from "./services/export/rScript.js";
import { generatePythonScript } from "./services/export/pythonScript.js";
import { generateStataScript } from "./services/export/stataScript.js";
import { buildStargazer }      from "./services/export/latexTable.js";

// ─── THEME ────────────────────────────────────────────────────────────────────
// ─── SAFE NUMBER FORMATTER ────────────────────────────────────────────────────
// Central utility: returns val.toFixed(dp) for valid finite numbers, 'N/A' for
// anything else (null, undefined, NaN, Infinity). Used everywhere a number is
// displayed so a single bad value can never crash the render cycle.
function safeNum(val, dp = 4) {
  if (val == null || !isFinite(val)) return "N/A";
  return val.toFixed(dp);
}

// ─── RESULT NORMALISER ────────────────────────────────────────────────────────
// Thin alias shim — wrapResult() in EstimationResult.js already produces the
// canonical shape. We just hoist convenience fields so the rest of the module
// doesn't have to reach into spec.* or rename testStats everywhere.
function normaliseResult(raw) {
  if (!raw) return null;
  if (raw.error) return { __error: raw.error };
  // ── Unwrap FE/FD bundles: ModelingTab packages panel results as
  //    { type: "FE", fe: <flatResult>, fd: null } (and vice versa). The
  //    reporting UI expects flat varNames/beta/se/pVals at the root.
  if ((raw.type === "FE" || raw.type === "FD")) {
    const inner = raw.fe ?? raw.fd;
    if (inner) raw = { ...inner, type: raw.type };
  }
  return {
    ...raw,
    modelLabel: raw.label,
    yVar:       raw.spec?.yVar  ?? "y",
    xVars:      raw.spec?.xVars ?? [],
    tStats:     raw.testStats   ?? [],
  };
}

// ─── AI CALL ──────────────────────────────────────────────────────────────────
// Delegated to AIService.js — interpretRegression() handles prompts + API call.

// ─── ATOMS ────────────────────────────────────────────────────────────────────
function Lbl({ children, color, mb = 6 }) {
  const { C, T } = useTheme();
  color = color ?? C.textMuted;
  return (
    <div style={{ fontSize: T.caption.fontSize, color, letterSpacing: "0.2em", textTransform: "uppercase",
                  marginBottom: mb, fontFamily: T.code.fontFamily }}>
      {children}
    </div>
  );
}
function Btn({ onClick, ch, color, v = "out", dis = false, sm = false }) {
  const { C, T } = useTheme();
  color = color ?? C.gold;
  const b = { padding: sm ? "0.28rem 0.65rem" : "0.48rem 0.95rem", borderRadius: 3,
               cursor: dis ? "not-allowed" : "pointer", fontFamily: T.code.fontFamily,
               fontSize: sm ? T.caption.fontSize : T.code.fontSize, transition: "all 0.13s", opacity: dis ? 0.4 : 1 };
  if (v === "solid") return (
    <button onClick={onClick} disabled={dis}
      style={{ ...b, background: color, color: C.bg, border: `1px solid ${color}`, fontWeight: 700 }}>
      {ch}
    </button>
  );
  if (v === "ghost") return (
    <button onClick={onClick} disabled={dis}
      style={{ ...b, background: "transparent", border: "none", color: dis ? C.textMuted : color }}>
      {ch}
    </button>
  );
  return (
    <button onClick={onClick} disabled={dis}
      style={{ ...b, background: "transparent", border: `1px solid ${C.border2}`,
               color: dis ? C.textMuted : C.textDim }}>
      {ch}
    </button>
  );
}
function Spin() {
  const { C, T } = useTheme();
  return (
    <div style={{ width: 14, height: 14, border: `2px solid ${C.border2}`,
                  borderTopColor: C.gold, borderRadius: "50%",
                  animation: "spin 0.7s linear infinite", flexShrink: 0 }} />
  );
}
function CopyBtn({ text, label = "Copy", successLabel = "Copied ✓", color }) {
  const { C, T } = useTheme();
  color = color ?? C.teal;
  const [copied, setCopied] = useState(false);
  const copy = () => {
    navigator.clipboard.writeText(text).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    });
  };
  return (
    <button onClick={copy}
      style={{ padding: "0.28rem 0.75rem", borderRadius: 3, cursor: "pointer",
               fontFamily: T.code.fontFamily, fontSize: T.caption.fontSize, border: `1px solid ${copied ? color : C.border2}`,
               background: copied ? `${color}18` : "transparent",
               color: copied ? color : C.textDim, transition: "all 0.15s" }}>
      {copied ? successLabel : label}
    </button>
  );
}

// ─── 1. COEFFICIENT FOREST PLOT ───────────────────────────────────────────────
// Teal diamond = significant (p < 0.05), grey = not significant.
// Each row: label | CI whisker + point | β value
function ForestPlot({ varNames, beta, se, pVals }) {
  const { C, T } = useTheme();
  const items = useMemo(() =>
    varNames
      .map((v, i) => ({ v, b: beta[i], s: se[i], p: pVals[i] }))
      .filter(d => d.v !== "(Intercept)" && isFinite(d.b) && isFinite(d.s)),
  [varNames, beta, se, pVals]);

  if (!items.length) return (
    <div style={{ fontSize: T.code.fontSize, color: C.textMuted, fontFamily: T.code.fontFamily, padding: "1rem" }}>
      No coefficients to plot (intercept-only or empty result).
    </div>
  );

  // Dynamic sizing
  const rowH    = 34;
  const PAD     = { l: 148, r: 72, t: 20, b: 24 };
  const W       = 620;
  const iW      = W - PAD.l - PAD.r;
  const H       = items.length * rowH + PAD.t + PAD.b;

  // Scale: include all CI endpoints + zero
  const lo = Math.min(0, ...items.map(d => d.b - 1.96 * d.s));
  const hi = Math.max(0, ...items.map(d => d.b + 1.96 * d.s));
  const range = hi - lo || 1;
  const sx  = v => PAD.l + ((v - lo) / range) * iW;
  const zero = sx(0);

  // Nice axis ticks: 5 evenly spaced
  const ticks = Array.from({ length: 5 }, (_, i) => lo + (range * i) / 4);

  return (
    <div style={{ overflowX: "auto" }}>
      <svg viewBox={`0 0 ${W} ${H}`}
           style={{ width: "100%", minWidth: 400, display: "block", fontFamily: T.code.fontFamily }}>
        {/* Background */}
        <rect width={W} height={H} fill={C.bg} />

        {/* Alternating row bands */}
        {items.map((_, i) => (
          <rect key={i}
            x={PAD.l} y={PAD.t + i * rowH}
            width={iW} height={rowH}
            fill={i % 2 === 0 ? C.surface : C.surface2}
            opacity={0.6} />
        ))}

        {/* Tick grid lines */}
        {ticks.map((t, i) => (
          <line key={i}
            x1={sx(t)} x2={sx(t)} y1={PAD.t} y2={H - PAD.b}
            stroke={C.border} strokeWidth={1} strokeDasharray="3 3" />
        ))}

        {/* Zero reference line */}
        {zero >= PAD.l && zero <= PAD.l + iW && (
          <line x1={zero} x2={zero} y1={PAD.t} y2={H - PAD.b}
                stroke={C.border2} strokeWidth={1.5} />
        )}

        {/* Rows */}
        {items.map((d, i) => {
          const cy   = PAD.t + i * rowH + rowH / 2;
          const cx   = sx(d.b);
          const ciLo = Math.max(PAD.l, sx(d.b - 1.96 * d.s));
          const ciHi = Math.min(PAD.l + iW, sx(d.b + 1.96 * d.s));
          const sig  = d.p < 0.05;
          const dotC = sig ? C.teal : C.textMuted;
          const lblC = sig ? C.text : C.textDim;
          const capLen = 5;

          return (
            <g key={d.v}>
              {/* CI whisker */}
              <line x1={ciLo} x2={ciHi} y1={cy} y2={cy}
                    stroke={dotC} strokeWidth={sig ? 1.5 : 1} opacity={sig ? 0.8 : 0.45} />
              {/* CI caps */}
              <line x1={sx(d.b - 1.96 * d.s)} x2={sx(d.b - 1.96 * d.s)}
                    y1={cy - capLen} y2={cy + capLen}
                    stroke={dotC} strokeWidth={1} opacity={0.6} />
              <line x1={sx(d.b + 1.96 * d.s)} x2={sx(d.b + 1.96 * d.s)}
                    y1={cy - capLen} y2={cy + capLen}
                    stroke={dotC} strokeWidth={1} opacity={0.6} />
              {/* Point — filled diamond if sig, hollow if not */}
              <rect x={cx - 5} y={cy - 5} width={10} height={10}
                    fill={sig ? dotC : "transparent"}
                    stroke={dotC} strokeWidth={sig ? 0 : 1.5}
                    opacity={sig ? 0.9 : 0.55}
                    transform={`rotate(45,${cx},${cy})`} />
              {/* Variable label */}
              <text x={PAD.l - 10} y={cy + 4} textAnchor="end"
                    fill={lblC} fontSize={T.caption.fontSize}>
                {d.v.length > 18 ? d.v.slice(0, 17) + "…" : d.v}
              </text>
              {/* β value + stars */}
              <text x={PAD.l + iW + 8} y={cy + 4} textAnchor="start"
                    fill={dotC} fontSize={9.5} fontFamily={T.data.fontFamily}>
                {isFinite(d.b) && d.b > 0 ? "+" : ""}{safeNum(d.b, 3)}{stars(d.p)}
              </text>
              {/* p-value hint */}
              <text x={PAD.l + iW + 8} y={cy + 15} textAnchor="start"
                    fill={C.textMuted} fontSize={T.caption.fontSize} fontFamily={T.data.fontFamily}>
                p={!isFinite(d.p) ? "N/A" : d.p < 0.001 ? "<.001" : safeNum(d.p, 3)}
              </text>
            </g>
          );
        })}

        {/* X axis */}
        <line x1={PAD.l} x2={PAD.l + iW} y1={H - PAD.b} y2={H - PAD.b}
              stroke={C.border2} strokeWidth={1} />
        {ticks.map((t, i) => (
          <text key={i} x={sx(t)} y={H - PAD.b + 12}
                textAnchor="middle" fill={C.textMuted} fontSize={T.caption.fontSize}>
            {t === 0 ? "0" : safeNum(t, 2)}
          </text>
        ))}
        <text x={PAD.l + iW / 2} y={H - 3}
              textAnchor="middle" fill={C.textMuted} fontSize={T.caption.fontSize}>
          Coefficient estimate with 95% CI  ·  ◆ p&lt;0.05  ◇ n.s.
        </text>
      </svg>
    </div>
  );
}

// ─── 2. LATEX EXPORT ──────────────────────────────────────────────────────────
// buildStargazer is imported from services/export/latexTable.js (shared with ModelComparison).

function LatexPanel({ result, modelLabel, yVar }) {
  const { C, T } = useTheme();
  const [customLabel,    setCustomLabel]    = useState(modelLabel);
  const [showFirstStage, setShowFirstStage] = useState(false);

  // Keep in sync if parent modelLabel changes (e.g. new estimation)
  useEffect(() => setCustomLabel(modelLabel), [modelLabel]);

  const isIV = result?.type === "2SLS" || result?.type === "GMM" || result?.type === "LIML";
  const canShowFS = isIV && (result?.firstStages?.length > 0) && (result?.spec?.zVars?.length > 0);

  const latex = useMemo(
    () => buildStargazer(
      [{ label: customLabel, result, yVar }],
      { showFirstStage: canShowFS && showFirstStage }
    ),
    [result, yVar, customLabel, showFirstStage, canShowFS]
  );

  const inputStyle = {
    background: C.surface2, border: `1px solid ${C.border2}`, borderRadius: 3,
    color: C.text, fontFamily: T.code.fontFamily, fontSize: T.caption.fontSize, padding: "3px 7px",
    outline: "none", width: 180,
  };

  return (
    <div>
      <div style={{ fontSize: T.code.fontSize, color: C.textDim, fontFamily: T.code.fontFamily, lineHeight: 1.7,
                    marginBottom: "0.75rem", padding: "0.65rem 1rem",
                    background: C.surface, border: `1px solid ${C.border}`,
                    borderLeft: `3px solid ${C.gold}`, borderRadius: 4 }}>
        Stargazer-style table. Paste directly into your{" "}
        <span style={{ color: C.gold }}>LaTeX</span> document.
        Add <code style={{ color: C.teal, fontSize: T.caption.fontSize }}>{"\\usepackage{booktabs}"}</code>{" "}
        to your preamble if you use <code style={{ color: C.teal, fontSize: T.caption.fontSize }}>\\toprule</code>.
      </div>

      {/* Controls row */}
      <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 8, flexWrap: "wrap" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
          <span style={{ fontSize: T.caption.fontSize, color: C.textMuted, fontFamily: T.code.fontFamily }}>Column label</span>
          <input
            value={customLabel}
            onChange={e => setCustomLabel(e.target.value)}
            style={inputStyle}
            spellCheck={false}
          />
        </div>
        {canShowFS && (
          <label style={{ display: "flex", alignItems: "center", gap: 5, cursor: "pointer",
                          fontSize: T.caption.fontSize, color: C.textDim, fontFamily: T.code.fontFamily }}>
            <input
              type="checkbox"
              checked={showFirstStage}
              onChange={e => setShowFirstStage(e.target.checked)}
              style={{ accentColor: C.teal }}
            />
            Include first stage
          </label>
        )}
      </div>

      <div style={{ position: "relative" }}>
        <pre style={{
          background: C.surface2, border: `1px solid ${C.border}`, borderRadius: 4,
          padding: "1rem", fontSize: T.caption.fontSize, color: C.text,
          fontFamily: T.code.fontFamily, overflowX: "auto", lineHeight: 1.65,
          maxHeight: 440, overflowY: "auto", margin: 0,
        }}>
          {latex}
        </pre>
        <div style={{ position: "absolute", top: 8, right: 8 }}>
          <CopyBtn text={latex} label="⎘ Copy LaTeX" successLabel="✓ Copied!" color={C.gold} />
        </div>
      </div>
    </div>
  );
}

// ─── RDD BINNED SCATTER PLOT ──────────────────────────────────────────────────
// Pure SVG — no external libs.
// Bins raw data (~20 bins per side) for performance, draws two fitted lines
// (local linear from engine) that meet/jump at the cutoff threshold.
function RDDScatterPlot({ rddResult }) {
  const { C, T } = useTheme();
  const { valid, xc, D, Y, leftFit, rightFit, cutoff, h, kernelType } = rddResult ?? {};

  if (!valid || valid.length < 4) return (
    <div style={{ fontSize: T.code.fontSize, color: C.textMuted, fontFamily: T.code.fontFamily, padding: "1rem" }}>
      Not enough observations within bandwidth to render scatter.
    </div>
  );

  // Bin each side into ≤20 mean-points for performance
  const binSide = (pts, nbins = 20) => {
    if (!pts.length) return [];
    const xs = pts.map(p => p.x);
    const lo = Math.min(...xs), rng = (Math.max(...xs) - lo) || 1;
    const bw = rng / nbins;
    return Array.from({ length: nbins }, (_, i) => {
      const inside = pts.filter(p => p.x >= lo + i * bw && p.x < lo + (i + 1) * bw);
      if (!inside.length) return null;
      return {
        x: inside.reduce((s, p) => s + p.x, 0) / inside.length,
        y: inside.reduce((s, p) => s + p.y, 0) / inside.length,
      };
    }).filter(Boolean);
  };

  const rawLeft  = valid.map((_, i) => ({ x: xc[i] + cutoff, y: Y[i] })).filter((_, i) => D[i] === 0);
  const rawRight = valid.map((_, i) => ({ x: xc[i] + cutoff, y: Y[i] })).filter((_, i) => D[i] === 1);
  const bL = binSide(rawLeft);
  const bR = binSide(rawRight);

  // Layout
  const W = 620, H = 300;
  const PAD = { l: 52, r: 24, t: 22, b: 42 };
  const iW = W - PAD.l - PAD.r, iH = H - PAD.t - PAD.b;

  const allPts = [...bL, ...bR, ...(leftFit ?? []), ...(rightFit ?? [])];
  const allX = allPts.map(p => p.x ?? 0), allY = allPts.map(p => p.y ?? p.yhat ?? 0);
  const xLo = Math.min(...allX), xHi = Math.max(...allX);
  const yLo = Math.min(...allY), yHi = Math.max(...allY);
  const xR = (xHi - xLo) || 1, yR = (yHi - yLo) || 1;
  const xPad = xR * 0.04, yPad = yR * 0.1;

  const sx = x  => PAD.l + ((x - xLo + xPad) / (xR + 2 * xPad)) * iW;
  const sy = y  => PAD.t + iH - ((y - yLo + yPad) / (yR + 2 * yPad)) * iH;
  const cx0 = sx(cutoff);

  const linePath = (pts, acc) => {
    if (!pts || pts.length < 2) return "";
    return [...pts].sort((a, b) => a.x - b.x)
      .map((p, i) => `${i === 0 ? "M" : "L"}${sx(p.x).toFixed(1)} ${sy(acc(p)).toFixed(1)}`)
      .join(" ");
  };

  const yTicks = Array.from({ length: 5 }, (_, i) => yLo - yPad + ((yR + 2 * yPad) * i) / 4);

  return (
    <div style={{ overflowX: "auto" }}>
      <svg viewBox={`0 0 ${W} ${H}`}
           style={{ width: "100%", minWidth: 400, display: "block", fontFamily: T.code.fontFamily }}>
        <rect width={W} height={H} fill={C.bg} />

        {/* Horizontal grid */}
        {yTicks.map((t, i) => (
          <line key={i} x1={PAD.l} x2={PAD.l + iW} y1={sy(t)} y2={sy(t)}
                stroke={C.border} strokeWidth={1} strokeDasharray="3 3" />
        ))}

        {/* Control-side scatter */}
        {bL.map((p, i) => (
          <circle key={`L${i}`} cx={sx(p.x)} cy={sy(p.y)} r={3.5}
                  fill={C.blue} opacity={0.55} />
        ))}
        {/* Treatment-side scatter */}
        {bR.map((p, i) => (
          <circle key={`R${i}`} cx={sx(p.x)} cy={sy(p.y)} r={3.5}
                  fill={C.orange} opacity={0.55} />
        ))}

        {/* Fitted lines */}
        {leftFit  && <path d={linePath(leftFit,  p => p.yhat)} fill="none" stroke={C.blue}   strokeWidth={2} opacity={0.9} />}
        {rightFit && <path d={linePath(rightFit, p => p.yhat)} fill="none" stroke={C.orange} strokeWidth={2} opacity={0.9} />}

        {/* Cutoff threshold */}
        {cx0 >= PAD.l && cx0 <= PAD.l + iW && (
          <>
            <line x1={cx0} x2={cx0} y1={PAD.t} y2={PAD.t + iH}
                  stroke={C.gold} strokeWidth={1.5} strokeDasharray="6 3" opacity={0.85} />
            <text x={cx0 + 5} y={PAD.t + 13} fill={C.gold} fontSize={T.caption.fontSize} fontFamily={T.data.fontFamily}>
              c = {cutoff}
            </text>
          </>
        )}

        {/* Axes */}
        <line x1={PAD.l} x2={PAD.l + iW} y1={PAD.t + iH} y2={PAD.t + iH} stroke={C.border2} strokeWidth={1} />
        <line x1={PAD.l} x2={PAD.l}       y1={PAD.t}       y2={PAD.t + iH} stroke={C.border2} strokeWidth={1} />

        {/* Y-axis labels */}
        {yTicks.map((t, i) => (
          <text key={i} x={PAD.l - 5} y={sy(t) + 3} textAnchor="end" fill={C.textMuted} fontSize={T.caption.fontSize}>
            {safeNum(t, 2)}
          </text>
        ))}

        {/* X-axis label */}
        <text x={PAD.l + iW / 2} y={H - 4} textAnchor="middle" fill={C.textMuted} fontSize={T.caption.fontSize}>
          Running variable · h = {safeNum(h, 3)} · kernel: {kernelType ?? "—"}
        </text>

        {/* Legend */}
        <circle cx={PAD.l + 10} cy={PAD.t + 10} r={4} fill={C.blue}   opacity={0.7} />
        <text x={PAD.l + 18} y={PAD.t + 14} fill={C.textDim} fontSize={T.caption.fontSize}>Control side</text>
        <circle cx={PAD.l + 88} cy={PAD.t + 10} r={4} fill={C.orange} opacity={0.7} />
        <text x={PAD.l + 96} y={PAD.t + 14} fill={C.textDim} fontSize={T.caption.fontSize}>Treatment side</text>
        <line  x1={PAD.l + 168} x2={PAD.l + 186} y1={PAD.t + 10} y2={PAD.t + 10}
               stroke={C.gold} strokeWidth={1.5} strokeDasharray="4 2" />
        <text x={PAD.l + 190} y={PAD.t + 14} fill={C.textDim} fontSize={T.caption.fontSize}>Cutoff</text>
      </svg>
    </div>
  );
}

// ─── 3. AI NARRATIVE ──────────────────────────────────────────────────────────
// Delegates to AIService.interpretRegression which handles:
//   - Functional form detection (log-log / log-level / level-log)
//   - Natural language phrasing from dataDictionary
//   - Dummy variable group comparison framing
// Fires automatically when the Narrative tab is selected (component mounts).

// Loading skeleton — shown while API is generating
function NarrativeSkeleton() {
  const { C, T } = useTheme();
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 8, marginBottom: "1rem" }}>
      {[0, 1].map(i => (
        <div key={i} style={{
          padding: "0.9rem 1.1rem",
          background: C.surface,
          border: `1px solid ${C.border}`,
          borderLeft: `3px solid ${i === 0 ? C.teal : C.purple}`,
          borderRadius: 4,
        }}>
          <div style={{
            fontSize: T.caption.fontSize, color: i === 0 ? C.teal : C.purple,
            letterSpacing: "0.18em", textTransform: "uppercase",
            fontFamily: T.code.fontFamily, marginBottom: 10,
          }}>
            {i === 0 ? "¶1 · Statistical Findings" : "¶2 · Model Reliability"}
          </div>
          {/* Animated shimmer lines */}
          {[100, 92, 87, 60].map((w, j) => (
            <div key={j} style={{
              height: 10, borderRadius: 3, marginBottom: 7,
              width: `${w}%`,
              background: `linear-gradient(90deg, ${C.surface2} 25%, ${C.border2} 50%, ${C.surface2} 75%)`,
              backgroundSize: "200% 100%",
              animation: "shimmer 1.6s ease-in-out infinite",
              animationDelay: `${j * 0.12}s`,
            }} />
          ))}
        </div>
      ))}
    </div>
  );
}

function AINarrative({ result, modelLabel, yVar, dataDictionary, rows, snapshot }) {
  const { C, T } = useTheme();
  const [text, setText]       = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError]     = useState("");
  const [hasRun, setHasRun]   = useState(false);
  const abortRef              = useRef(null);

  const hasDictionary = dataDictionary && Object.values(dataDictionary).some(v => v?.trim());

  const run = async () => {
    if (loading) return;
    if (abortRef.current) abortRef.current = false;
    const token = {};
    abortRef.current = token;

    setLoading(true);
    setHasRun(true);
    setText("");
    setError("");

    try {
      const out = await interpretRegression(result, hasDictionary ? dataDictionary : null, null, rows, { snapshot });
      if (abortRef.current === token) {
        setText(out.trim());
      }
    } catch (e) {
      if (abortRef.current === token) {
        setError(`Generation failed: ${e?.message ?? "check your API connection"}.`);
      }
    } finally {
      if (abortRef.current === token) {
        setLoading(false);
      }
    }
  };

  // Fire automatically when this tab mounts — only once per result
  useEffect(() => {
    run();
    return () => { abortRef.current = null; }; // cancel on unmount
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const paragraphs = text.split(/\n\n+/).map(p => p.trim()).filter(Boolean);

  return (
    <div>
      {/* Context banner */}
      <div style={{
        fontSize: T.code.fontSize, color: C.textDim, fontFamily: T.code.fontFamily, lineHeight: 1.7,
        marginBottom: "1.2rem", padding: "0.65rem 1rem",
        background: C.surface, border: `1px solid ${C.border}`,
        borderLeft: `3px solid ${C.purple}`, borderRadius: 4,
        display: "flex", alignItems: "flex-start", gap: 10,
      }}>
        <span style={{ color: C.purple, fontSize: T.body.fontSize, lineHeight: 1 }}>✦</span>
        <div>
          <div style={{ color: C.text, marginBottom: 2 }}>
            AI-generated executive summary for{" "}
            <span style={{ color: C.gold }}>{modelLabel}</span> on{" "}
            <span style={{ color: C.teal }}>{yVar}</span>.
          </div>
          <div>
            Sends to Claude: estimated equation, R², N, all β̂, SE, 95% CI, p-values
            {hasDictionary
              ? <>, and <span style={{ color: C.violet }}>Data Dictionary</span>
                  {" "}— coefficients will be phrased in natural units.
                </>
              : <>. No Data Dictionary detected — add one in Data Studio for richer narrative.</>
            }
          </div>
          <div style={{ marginTop: 4, fontSize: T.caption.fontSize, color: C.textMuted }}>
            Verify before submitting — AI can err on economic plausibility.
          </div>
        </div>
      </div>

      {/* Loading state */}
      {loading && (
        <>
          <div style={{
            display: "flex", alignItems: "center", gap: 8,
            color: C.purple, fontSize: T.code.fontSize, fontFamily: T.code.fontFamily,
            marginBottom: "0.8rem",
          }}>
            <Spin />
            <span>Generating insight…</span>
            <span style={{ color: C.textMuted, fontSize: T.caption.fontSize }}>
              ({result.varNames?.filter(v => v !== "(Intercept)").length ?? 0} regressors
              {hasDictionary ? " · dictionary-aware" : ""})
            </span>
          </div>
          <NarrativeSkeleton />
        </>
      )}

      {/* Error state */}
      {error && !loading && (
        <div style={{
          fontSize: T.code.fontSize, color: C.red, fontFamily: T.code.fontFamily, lineHeight: 1.6,
          padding: "0.75rem 1rem", border: `1px solid ${C.red}40`,
          borderLeft: `3px solid ${C.red}`, borderRadius: 4, marginBottom: "1rem",
        }}>
          ⚠ {error}
        </div>
      )}

      {/* Paragraph output */}
      {paragraphs.length > 0 && !loading && (
        <div style={{ marginBottom: "1.2rem" }}>
          {paragraphs.map((p, i) => {
            const labels = ["¶1 · Statistical Findings", "¶2 · Model Reliability"];
            const accents = [C.teal, C.purple];
            return (
              <div key={i} style={{
                fontSize: T.body.fontSize, color: C.text, lineHeight: 1.9,
                fontFamily: "'Georgia','Times New Roman',serif",
                padding: "1rem 1.2rem",
                background: i % 2 === 0 ? C.surface : C.surface2,
                border: `1px solid ${C.border}`,
                borderLeft: `3px solid ${accents[i] ?? C.gold}`,
                borderRadius: 4, marginBottom: 8,
                animation: "fadeUp 0.22s ease",
              }}>
                <div style={{
                  fontSize: T.caption.fontSize, color: accents[i] ?? C.gold,
                  letterSpacing: "0.2em", textTransform: "uppercase",
                  fontFamily: T.code.fontFamily, marginBottom: 8,
                }}>
                  {labels[i] ?? `¶${i + 1}`}
                </div>
                {p}
              </div>
            );
          })}
        </div>
      )}

      {/* Actions */}
      <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
        {text && !loading && (
          <CopyBtn text={text} label="Copy Narrative" successLabel="✓ Copied!" color={C.purple} />
        )}
        <Btn
          onClick={run}
          dis={loading}
          color={C.purple}
          sm
          ch={loading ? "Generating…" : hasRun ? "↻ Regenerate narrative" : "✦ Generate narrative"}
        />
        {hasRun && !loading && !error && (
          <span style={{ fontSize: T.caption.fontSize, color: C.textMuted, fontFamily: T.code.fontFamily }}>
            Results are non-deterministic — regeneration may vary.
          </span>
        )}
      </div>
    </div>
  );
}

// ─── FIT STATS SUMMARY BAR ────────────────────────────────────────────────────
function FitBar({ result }) {
  const { C, T } = useTheme();
  const { R2, adjR2, n, df, Fstat, Fpval, modelLabel } = result;
  const items = [
    { l: "Model",    v: modelLabel ?? "—",               c: C.gold },
    { l: "R²",       v: safeNum(R2),                     c: C.teal },
    { l: "Adj. R²",  v: safeNum(adjR2),                  c: C.teal },
    { l: "n",        v: n  != null ? n  : "—",           c: C.text },
    { l: "df",       v: df != null ? df : "—",           c: C.textDim },
    ...(Fstat != null && isFinite(Fstat)
      ? [
          { l: "F-stat",  v: safeNum(Fstat, 3),           c: C.orange },
          { l: "F p-val", v: (Fpval != null && isFinite(Fpval))
              ? (Fpval < 0.001 ? "<.001" : safeNum(Fpval)) : "—",    c: C.orange },
        ]
      : []),
  ];
  return (
    <div style={{ display: "grid", gridTemplateColumns: `repeat(${items.length}, 1fr)`,
                  gap: 1, background: C.border, borderRadius: 4,
                  overflow: "hidden", marginBottom: "1.4rem" }}>
      {items.map(s => (
        <div key={s.l} style={{ background: C.surface, padding: "0.6rem 0.85rem" }}>
          <div style={{ fontSize: T.caption.fontSize, color: C.textMuted, letterSpacing: "0.1em",
                        textTransform: "uppercase", marginBottom: 3, fontFamily: T.code.fontFamily }}>
            {s.l}
          </div>
          <div style={{ fontSize: T.h2.fontSize, color: s.c, fontFamily: T.code.fontFamily }}>{s.v}</div>
        </div>
      ))}
    </div>
  );
}

// ─── SIGNIFICANT COEFFICIENTS CALLOUT ────────────────────────────────────────
function SigCallout({ result }) {
  const { C, T } = useTheme();
  const { varNames, beta, se, pVals } = result;
  const sig = varNames
    .map((v, i) => ({ v, b: beta[i], s: se[i], p: pVals[i] }))
    .filter(d => d.v !== "(Intercept)" && isFinite(d.b) && isFinite(d.s) && d.p < 0.05);

  if (!sig.length) return (
    <div style={{ fontSize: T.code.fontSize, color: C.textMuted, fontFamily: T.code.fontFamily,
                  padding: "0.65rem 1rem", border: `1px solid ${C.border}`,
                  borderRadius: 4, marginBottom: "1.2rem" }}>
      No regressors are significant at the 5% level.
    </div>
  );

  return (
    <div style={{ display: "flex", flexWrap: "wrap", gap: 6, marginBottom: "1.2rem" }}>
      {sig.map(d => (
        <div key={d.v} style={{
          padding: "0.45rem 0.85rem",
          background: `${C.teal}10`, border: `1px solid ${C.teal}40`,
          borderRadius: 4, fontFamily: T.code.fontFamily,
        }}>
          <div style={{ fontSize: T.caption.fontSize, color: C.textMuted, marginBottom: 2 }}>{d.v}</div>
          <div style={{ fontSize: T.body.fontSize, color: d.b >= 0 ? C.teal : C.red }}>
            {d.b >= 0 ? "+" : ""}{safeNum(d.b)}
            <span style={{ fontSize: T.caption.fontSize, color: C.gold, marginLeft: 4 }}>{stars(d.p)}</span>
          </div>
          <div style={{ fontSize: T.caption.fontSize, color: C.textMuted }}>
            95% CI [{safeNum(d.b - 1.96 * d.s, 3)}, {safeNum(d.b + 1.96 * d.s, 3)}]
          </div>
        </div>
      ))}
    </div>
  );
}

// ─── AI UNIFIED SCRIPT ───────────────────────────────────────────────────────
// Phase 9.10 — generates a polished, combined replication script via Claude.
// Props:
//   result       — normalised EstimationResult (for model section)
//   cleanedData  — { cleanRows, headers, pipeline, dataDictionary, filename }
function AIUnifiedScript({ result, cleanedData, snapshot, availableDatasets = [], pid = null, globalPipeline = [] }) {
  const { C, T } = useTheme();
  const [open,     setOpen]     = useState(false);
  const [lang,     setLang]     = useState("r");
  const [loading,  setLoading]  = useState(false);
  const [script,   setScript]   = useState("");
  const [error,    setError]    = useState("");
  const [copied,   setCopied]   = useState(false);
  // ── Structuring question (Fase 0.2): how the user wants the script organised.
  //    "execution" needs the unified timeline (Fase 3) — shown but disabled.
  const [structureMode,     setStructureMode]     = useState("module"); // "module" | "execution" | "custom"
  const [customInstruction, setCustomInstruction] = useState("");

  const LANGS = [
    { id: "r",      label: "R" },
    { id: "python", label: "Python" },
    { id: "stata",  label: "Stata" },
  ];

  const STRUCTURES = [
    { id: "module",    label: "Per module",          disabled: false, tip: "Sections grouped by workspace module (default)" },
    { id: "execution", label: "Per execution order", disabled: true,  tip: "Coming soon — needs the unified session timeline" },
    { id: "custom",    label: "Custom",              disabled: false, tip: "Give Claude your own structuring instruction" },
  ];

  // ── Manual cell edits (Fase 0.3, D2): `patch` steps are keyed on internal row
  //    ids (__row_id/__ri) that don't exist in the raw file — not faithfully
  //    replicable in R/Stata. Python's pandas handles them; R/Stata get a
  //    warning + a cleaned-dataset download instead.
  const manualEdits = (cleanedData?.pipeline ?? []).filter(s => s.type === "patch").length;
  const showEditWarning = manualEdits > 0 && lang !== "python";

  function downloadCleanCSV() {
    const headers = (cleanedData?.headers ?? []).filter(h => h !== "__ri" && h !== "__row_id");
    const rows    = cleanedData?.cleanRows ?? [];
    const esc = v => {
      const s = v == null ? "" : String(v);
      return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
    };
    const csv  = [headers.join(",")]
      .concat(rows.map(r => headers.map(h => esc(r[h])).join(",")))
      .join("\n");
    const base = (cleanedData?.filename ?? "dataset").replace(/\.[^.]+$/, "");
    const blob = new Blob([csv], { type: "text/csv" });
    const url  = URL.createObjectURL(blob);
    const a    = document.createElement("a");
    a.href = url; a.download = `${base}_cleaned.csv`; a.click();
    URL.revokeObjectURL(url);
  }

  function _buildModelScript(language) {
    if (!result) return "";
    const spec = result.spec ?? {};
    // The model's SOURCE dataset (spec.filename, stamped at estimation time) may
    // differ from the Report tab's active dataset — load opts and pipeline must
    // come from the source, never silently from the active one.
    const modelFile    = spec.filename ?? cleanedData?.filename ?? "dataset.csv";
    const modelDs      = availableDatasets.find(d => d.filename === modelFile) ?? null;
    const sameAsActive = modelFile === cleanedData?.filename;
    const config = {
      filename:       modelFile,
      pipeline:       spec.pipeline       ?? (sameAsActive ? cleanedData?.pipeline ?? [] : []),
      dataDictionary: spec.dataDictionary ?? (sameAsActive ? cleanedData?.dataDictionary : null),
      dataLoadOpts:   modelDs?.loadOpts ?? (sameAsActive ? cleanedData?.loadOpts : null) ?? null,
      model: {
        type:       result.type     ?? "OLS",
        yVar:       spec.yVar       ?? "",
        xVars:      spec.xVars      ?? [],
        wVars:      spec.wVars      ?? [],
        zVars:      spec.zVars      ?? [],
        entityCol:  spec.entityCol  ?? null,
        timeCol:    spec.timeCol    ?? null,
        postVar:    spec.postVar    ?? null,
        treatVar:   spec.treatVar   ?? null,
        runningVar: spec.runningVar ?? null,
        cutoff:     spec.cutoff     ?? null,
        bandwidth:  spec.bandwidth  ?? null,
        kernel:     spec.kernel     ?? "triangular",
      },
    };
    try {
      if (language === "r")      return generateRScript(config);
      if (language === "python") return generatePythonScript(config);
      if (language === "stata")  return generateStataScript(config);
    } catch { return ""; }
    return "";
  }

  async function generate() {
    setLoading(true);
    setError("");
    setScript("");
    try {
      const multiDataset = availableDatasets.length > 1 || globalPipeline.length > 0;
      let cleanSc;
      if (multiDataset) {
        // Workspace skeleton: ALL session datasets in topological order, each
        // loaded into its own df_<name> with its own load opts + pipeline,
        // then cross-dataset G-steps. Per-dataset pipelines come from IDB;
        // the Report-active dataset uses its live (possibly newer) pipeline.
        let map = {};
        try { map = (await loadProjectPipelines(pid))?.datasetPipelines ?? {}; } catch { /* no IDB record yet */ }
        const built = {};
        for (const ds of availableDatasets) {
          const dsRec    = map[ds.id] ?? {};
          const isActive = ds.filename === cleanedData?.filename;
          built[ds.id] = {
            id:       ds.id,
            name:     ds.name ?? ds.filename ?? ds.id,
            filename: dsRec.filename ?? ds.filename ?? null,
            pipeline: isActive
              ? (cleanedData?.pipeline ?? dsRec.pipeline ?? [])
              : (Array.isArray(dsRec.pipeline) ? dsRec.pipeline : []),
            loadOpts: ds.loadOpts ?? dsRec.loadOpts ?? null,
          };
        }
        cleanSc = generateWorkspaceScript({ language: lang, datasets: built, globalPipeline });
      } else {
        const dsName = cleanedData?.filename?.replace(/\.[^.]+$/, "") ?? "dataset";
        const dsMap  = Object.fromEntries(
          availableDatasets.map(ds => [ds.id, { name: ds.name ?? ds.filename, filename: ds.filename }])
        );
        cleanSc = generateCleanScript({
          language:    lang,
          datasetName: dsName,
          filename:    cleanedData?.filename ?? "dataset.csv",
          pipeline:    cleanedData?.pipeline ?? [],
          loadOpts:    cleanedData?.loadOpts ?? null,
          allDatasets: dsMap,
        });
      }
      let modelSc = _buildModelScript(lang);
      if (modelSc && lang !== "stata") {
        // Bind the model section to its source data frame so it matches the
        // workspace skeleton (df_<name>) instead of the generic `df`.
        const modelFile = result?.spec?.filename ?? cleanedData?.filename;
        const modelDs   = availableDatasets.find(d => d.filename === modelFile) ?? null;
        if (modelFile) modelSc = modelSc.replace(/\bdf\b/g, toDfVar(modelDs?.name ?? modelFile));
      }
      const dict = cleanedData?.dataDictionary ?? null;
      const userInstruction =
        structureMode === "custom" && customInstruction.trim()
          ? customInstruction.trim()
          : structureMode === "module"
            ? "Structure the script grouped by module section: Setup, Data Loading, Cleaning, Feature Engineering, Estimation, Results."
            : null;
      const base = (cleanedData?.filename ?? "dataset").replace(/\.[^.]+$/, "");
      const manualEditNote = showEditWarning
        ? `This session contains ${manualEdits} manual cell edit(s) ("patch" steps keyed on internal row ids __row_id/__ri that do NOT exist in the raw file). Do NOT emit row-id-based patch assignments. Instead, in the Data Loading section add a prominent comment telling the user to load the exported cleaned dataset "${base}_cleaned.csv" (downloadable from Litux) for an exact replication.`
        : null;
      const out = await generateUnifiedScript({ clean: cleanSc, model: modelSc }, lang, dict, { snapshot, userInstruction, manualEditNote });
      setScript(out);
    } catch (e) {
      setError(e.message ?? "Generation failed.");
    } finally {
      setLoading(false);
    }
  }

  function download() {
    const ext = lang === "stata" ? "do" : lang;
    const blob = new Blob([script], { type: "text/plain" });
    const url  = URL.createObjectURL(blob);
    const a    = document.createElement("a");
    a.href = url; a.download = `replication.${ext}`; a.click();
    URL.revokeObjectURL(url);
  }

  return (
    <div style={{ marginTop: "1.2rem" }}>
      <button
        onClick={() => setOpen(o => !o)}
        style={{
          width: "100%", display: "flex", alignItems: "center",
          justifyContent: "space-between",
          padding: "0.6rem 1rem",
          background: open ? `${C.gold}0d` : C.surface,
          border: `1px solid ${open ? C.gold + "50" : C.border}`,
          borderRadius: open ? "4px 4px 0 0" : 4,
          cursor: "pointer", fontFamily: T.code.fontFamily, transition: "all 0.13s",
        }}
      >
        <span style={{ fontSize: T.caption.fontSize, color: C.gold, letterSpacing: "0.22em", textTransform: "uppercase" }}>
          ✦ AI Unified Script Export
        </span>
        <span style={{ fontSize: T.caption.fontSize, color: C.textMuted }}>{open ? "▲" : "▼"}</span>
      </button>

      {open && (
        <div style={{
          border: `1px solid ${C.gold}50`, borderTop: "none",
          borderRadius: "0 0 4px 4px", padding: "1.2rem",
          background: C.surface, animation: "fadeUp 0.15s ease",
        }}>
          <div style={{ fontSize: T.code.fontSize, color: C.textDim, fontFamily: T.code.fontFamily, lineHeight: 1.6, marginBottom: "1rem" }}>
            Generates one complete, documented replication script combining your
            pipeline + model. Claude restructures, comments, and deduplicates the
            auto-generated code.
          </div>

          {/* Manual-edit warning (Fase 0.3) — R/Stata only */}
          {showEditWarning && (
            <div style={{ marginBottom: "0.9rem", padding: "0.6rem 0.8rem",
                          border: `1px solid ${C.gold}60`, borderRadius: 3, background: `${C.gold}0d` }}>
              <div style={{ fontSize: T.code.fontSize, color: C.gold, fontFamily: T.code.fontFamily, lineHeight: 1.55 }}>
                ⚠ This pipeline contains {manualEdits} manual cell edit{manualEdits === 1 ? "" : "s"} that
                can't be faithfully replicated in {lang === "r" ? "R" : "Stata"}. For an exact replication,
                download the cleaned dataset and load it directly in your script.
              </div>
              <button onClick={downloadCleanCSV}
                style={{ marginTop: 6, padding: "0.26rem 0.7rem", borderRadius: 3, cursor: "pointer",
                         fontFamily: T.code.fontFamily, fontSize: T.caption.fontSize,
                         border: `1px solid ${C.gold}`, background: "transparent", color: C.gold }}>
                ↓ Download cleaned dataset (CSV)
              </button>
            </div>
          )}

          {/* Structuring question (Fase 0.2) */}
          <div style={{ marginBottom: "0.9rem" }}>
            <div style={{ fontSize: T.caption.fontSize, color: C.textMuted, fontFamily: T.code.fontFamily,
                          letterSpacing: "0.18em", textTransform: "uppercase", marginBottom: 6 }}>
              How should the script be structured?
            </div>
            <div style={{ display: "flex", gap: 4, flexWrap: "wrap" }}>
              {STRUCTURES.map(s => (
                <button key={s.id} onClick={() => !s.disabled && setStructureMode(s.id)}
                  disabled={s.disabled} title={s.tip}
                  style={{
                    padding: "0.26rem 0.7rem", borderRadius: 3,
                    cursor: s.disabled ? "not-allowed" : "pointer",
                    fontFamily: T.code.fontFamily, fontSize: T.caption.fontSize, transition: "all 0.12s",
                    background: structureMode === s.id ? `${C.teal}15` : "transparent",
                    border:     `1px solid ${structureMode === s.id ? C.teal : C.border2}`,
                    color:      s.disabled ? C.textMuted : structureMode === s.id ? C.teal : C.textDim,
                    opacity:    s.disabled ? 0.55 : 1,
                  }}>
                  {s.label}{s.disabled ? " ⏳" : ""}
                </button>
              ))}
            </div>
            {structureMode === "custom" && (
              <textarea
                value={customInstruction}
                onChange={e => setCustomInstruction(e.target.value)}
                placeholder='e.g. "One section per dataset, model at the end, comment every step in Spanish"'
                rows={2}
                style={{ width: "100%", marginTop: 6, padding: "0.45rem 0.6rem", resize: "vertical",
                         background: C.bg, border: `1px solid ${C.teal}40`, borderRadius: 3,
                         color: C.text, fontFamily: T.code.fontFamily, fontSize: T.code.fontSize,
                         outline: "none", boxSizing: "border-box" }}
              />
            )}
          </div>

          {/* Language selector */}
          <div style={{ display: "flex", gap: 4, marginBottom: "1rem" }}>
            {LANGS.map(l => (
              <button key={l.id} onClick={() => setLang(l.id)}
                style={{
                  padding: "0.3rem 0.8rem", borderRadius: 3, cursor: "pointer",
                  fontFamily: T.code.fontFamily, fontSize: T.code.fontSize, transition: "all 0.12s",
                  background:  lang === l.id ? `${C.gold}18` : "transparent",
                  border:      `1px solid ${lang === l.id ? C.gold : C.border2}`,
                  color:       lang === l.id ? C.gold : C.textDim,
                }}>
                {l.label}
              </button>
            ))}
            <div style={{ flex: 1 }} />
            <button onClick={generate} disabled={loading}
              style={{
                padding: "0.3rem 0.9rem", borderRadius: 3, cursor: loading ? "not-allowed" : "pointer",
                fontFamily: T.code.fontFamily, fontSize: T.code.fontSize, opacity: loading ? 0.5 : 1,
                background: `${C.gold}18`, border: `1px solid ${C.gold}`,
                color: C.gold, fontWeight: 700,
              }}>
              {loading ? "Generating…" : script ? "↻ Regenerate" : "✦ Generate"}
            </button>
          </div>

          {/* Error */}
          {error && (
            <div style={{ fontSize: T.code.fontSize, color: C.red, fontFamily: T.code.fontFamily, marginBottom: "0.8rem",
                          padding: "0.5rem 0.8rem", border: `1px solid ${C.red}40`, borderRadius: 3 }}>
              ⚠ {error}
            </div>
          )}

          {/* Loading skeleton */}
          {loading && (
            <div style={{ display: "flex", alignItems: "center", gap: 8,
                          color: C.gold, fontSize: T.code.fontSize, fontFamily: T.code.fontFamily, marginBottom: "0.8rem" }}>
              <div style={{ width: 12, height: 12, border: `2px solid ${C.border2}`,
                            borderTopColor: C.gold, borderRadius: "50%",
                            animation: "spin 0.7s linear infinite" }} />
              <span>Claude is writing your script…</span>
            </div>
          )}

          {/* Script output */}
          {script && !loading && (
            <>
              <div style={{ display: "flex", gap: 6, marginBottom: 6, alignItems: "center" }}>
                <span style={{ fontSize: T.caption.fontSize, color: C.textMuted, fontFamily: T.code.fontFamily, flex: 1 }}>
                  {script.split("\n").length} lines
                </span>
                <button onClick={() => {
                  navigator.clipboard.writeText(script).then(() => {
                    setCopied(true); setTimeout(() => setCopied(false), 2000);
                  });
                }}
                  style={{ padding: "0.22rem 0.6rem", borderRadius: 3, cursor: "pointer",
                           fontFamily: T.code.fontFamily, fontSize: T.caption.fontSize,
                           border: `1px solid ${copied ? C.teal : C.border2}`,
                           background: copied ? `${C.teal}18` : "transparent",
                           color: copied ? C.teal : C.textDim }}>
                  {copied ? "Copied ✓" : "Copy"}
                </button>
                <button onClick={download}
                  style={{ padding: "0.22rem 0.6rem", borderRadius: 3, cursor: "pointer",
                           fontFamily: T.code.fontFamily, fontSize: T.caption.fontSize,
                           border: `1px solid ${C.border2}`, background: "transparent", color: C.textDim }}>
                  ↓ Download
                </button>
              </div>
              <textarea
                readOnly
                value={script}
                style={{
                  width: "100%", minHeight: 280, padding: "0.8rem",
                  background: C.bg, border: `1px solid ${C.border}`, borderRadius: 3,
                  fontFamily: T.code.fontFamily, fontSize: T.caption.fontSize, color: C.text, lineHeight: 1.55,
                  resize: "vertical", boxSizing: "border-box",
                }}
              />
            </>
          )}
        </div>
      )}
    </div>
  );
}

// ─── ROOT ─────────────────────────────────────────────────────────────────────
export default function ReportingModule({ result: rawResult, cleanedData, availableDatasets = [], pid = null, onClose }) {
  const { C, T } = useTheme();
  const [tab, setTab] = useState("forest");

  // ── Debug: log raw result so any NaN/undefined shows in console ──────────────
  console.log("DEBUG_RESULTS:", rawResult);

  const result = useMemo(() => normaliseResult(rawResult), [rawResult]);

  // ── Build session snapshot once per render — passed to AI calls so Claude
  //    sees data load opts (sep, sheet, encoding), pipeline, dictionary, etc.
  //    `datasets` lists EVERY session dataset so multi-dataset workspaces
  //    replicate all loads, and `globalPipeline` carries cross-dataset G-steps.
  const { log: sessionLog } = useSessionLog();
  const { globalPipeline } = useSessionState();
  const snapshot = useMemo(
    () => buildSessionSnapshot({ cleanedData, result: rawResult, sessionLog, datasets: availableDatasets }),
    [cleanedData, rawResult, sessionLog, availableDatasets]
  );

  // Detect Sharp RDD / Spatial RD — canonical shape uses type, legacy shape carries rddData or raw fields
  const isRDD = rawResult?.type === "RDD" || rawResult?.type === "SpatialRDD" || !!(rawResult?.valid && rawResult?.leftFit && rawResult?.rightFit);

  // ── ALL hooks must be unconditional — never placed after an early return ──────
  const [narrativeOpen, setNarrativeOpen] = useState(false);

  if (!result) return (
    <div style={{ padding: "2rem", color: C.textMuted, fontFamily: T.code.fontFamily, fontSize: T.code.fontSize }}>
      No regression result to display. Run a model first.
    </div>
  );

  // ── Safety guard: engine returned an error instead of valid results ───────────
  if (result.__error) return (
    <div style={{ padding: "2rem", fontFamily: T.code.fontFamily }}>
      <div style={{
        padding: "1.2rem 1.4rem",
        background: `${C.red}15`,
        border: `1px solid ${C.red}40`,
        borderLeft: `3px solid ${C.red}`,
        borderRadius: 4,
      }}>
        <div style={{ fontSize: T.caption.fontSize, color: C.red, letterSpacing: "0.22em",
                      textTransform: "uppercase", marginBottom: 8 }}>
          Estimation Error
        </div>
        <div style={{ fontSize: T.body.fontSize, color: C.text, marginBottom: 6 }}>
          {result.__error}
        </div>
        <div style={{ fontSize: T.code.fontSize, color: C.textMuted, lineHeight: 1.7 }}>
          Common causes: perfect multicollinearity, fewer observations than parameters,
          or a degenerate panel structure. Return to the Modeling Lab and verify your
          variable selection and data coverage.
        </div>
      </div>
      {onClose && (
        <button onClick={onClose}
          style={{ marginTop: "1rem", padding: "0.4rem 0.9rem", borderRadius: 3,
                   cursor: "pointer", fontFamily: T.code.fontFamily, fontSize: T.caption.fontSize,
                   background: "transparent", border: `1px solid ${C.border2}`,
                   color: C.textMuted }}>
          ✕ Close
        </button>
      )}
    </div>
  );

  const { modelLabel = "OLS", yVar = "y" } = result;

  const tabs = [
    ["forest",    "⬡ Forest Plot"],
    ...(isRDD ? [["rdd", "◉ RDD Scatter"]] : []),
  ];

  return (
    <div style={{ background: C.bg, color: C.text, fontFamily: T.code.fontFamily,
                  height: "100%", display: "flex", flexDirection: "column",
                  overflow: "hidden" }}>
      <style>{`
        @keyframes spin { to { transform: rotate(360deg) } }
        @keyframes fadeUp { from { opacity:0; transform:translateY(6px) } to { opacity:1; transform:translateY(0) } }
        @keyframes shimmer { 0%{background-position:200% 0} 100%{background-position:-200% 0} }
      `}</style>

      {/* ── Header ── */}
      <div style={{ flexShrink: 0, borderBottom: `1px solid ${C.border}`,
                    padding: "0.75rem 1.4rem",
                    display: "flex", alignItems: "center", gap: 12,
                    background: C.surface }}>
        <div style={{ flex: 1 }}>
          <div style={{ fontSize: T.caption.fontSize, color: C.teal, letterSpacing: "0.26em",
                        textTransform: "uppercase", marginBottom: 2 }}>
            Reporting Module
          </div>
          <div style={{ fontSize: T.h2.fontSize, color: C.text, letterSpacing: "-0.01em" }}>
            <span style={{ color: C.gold }}>{modelLabel}</span>
            {" · "}
            <span style={{ color: C.textDim }}>dep. var.: </span>
            <span style={{ color: C.teal }}>{yVar}</span>
          </div>
        </div>
        {onClose && (
          <button onClick={onClose}
            style={{ background: "transparent", border: `1px solid ${C.border2}`,
                     borderRadius: 3, color: C.textMuted, cursor: "pointer",
                     fontFamily: T.code.fontFamily, fontSize: T.caption.fontSize, padding: "0.3rem 0.7rem" }}>
            ✕ Close
          </button>
        )}
      </div>

      {/* ── Body ── */}
      <div style={{ flex: 1, minHeight: 0, overflowY: "auto",
                    padding: "1.4rem", paddingBottom: "3rem" }}>

        <HintBox color={C.gold} title="How to report" sections={[
          { heading: "Requirements", items: [
            "Pin at least one model in the Model tab first — use the ◈ pin icon next to any result",
            "All pinned models appear here automatically",
          ]},
          { heading: "Outputs", items: [
            "LaTeX Stargazer table: multi-column comparison of all pinned models, publication-ready",
            "Forest plot: coefficient + 95% CI across all pinned specifications",
            "AI Narrative: auto-generates 2–3 academic paragraphs interpreting the results",
            "Replication bundle: download R + Stata + Python scripts + data as a zip",
          ]},
          { heading: "Tips", items: [
            "Pin models with different SE types to compare robustness in one table",
            "The AI Narrative uses the data dictionary — label your variables in Clean → Dictionary for better output",
            "LaTeX output is compatible with Overleaf and standard journal templates",
          ]},
        ]} />

        {/* Fit stats always visible */}
        <FitBar result={result} />

        {/* Significant coefficients callout */}
        <Lbl color={C.teal}>Significant regressors (p &lt; 0.05)</Lbl>
        <SigCallout result={result} />

        {/* Tab navigation */}
        <div style={{ display: "flex", gap: 1, background: C.border, borderRadius: 4,
                      overflow: "hidden", marginBottom: "1.4rem" }}>
          {tabs.map(([k, l]) => (
            <button key={k} onClick={() => setTab(k)}
              style={{ flex: 1, padding: "0.6rem 0.7rem",
                       background: tab === k ? C.goldFaint : C.surface,
                       border: "none", color: tab === k ? C.gold : C.textDim,
                       cursor: "pointer", fontFamily: T.code.fontFamily, fontSize: T.code.fontSize,
                       borderBottom: tab === k ? `2px solid ${C.gold}` : "2px solid transparent",
                       transition: "all 0.12s" }}>
              {l}
            </button>
          ))}
        </div>

        {/* Tab content */}
        {tab === "forest" && (
          <div style={{ animation: "fadeUp 0.18s ease" }}>
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: "0.6rem" }}>
              <Lbl mb={0}>Coefficient Estimates · 95% Confidence Intervals</Lbl>
              <CopyBtn
                text={buildStargazer([{ label: modelLabel, result, yVar }])}
                label="Copy LaTeX"
                successLabel="Copied ✓"
                color={C.gold}
              />
            </div>
            <div style={{ marginBottom: "0.8rem", fontSize: T.code.fontSize, color: C.textDim,
                          fontFamily: T.code.fontFamily, lineHeight: 1.6 }}>
              <span style={{ color: C.teal }}>◆ Teal</span> = significant at 5% ·{" "}
              <span style={{ color: C.textMuted }}>◇ Grey</span> = not significant ·{" "}
              Intercept excluded from plot.
            </div>
            <ForestPlot
              varNames={result.varNames}
              beta={result.beta}
              se={result.se}
              pVals={result.pVals}
            />
          </div>
        )}

        {tab === "rdd" && isRDD && (
          <div style={{ animation: "fadeUp 0.18s ease" }}>
            <Lbl color={C.orange}>Sharp RDD · Binned Scatter + Fitted Lines</Lbl>
            <div style={{ marginBottom: "0.8rem", fontSize: T.code.fontSize, color: C.textDim,
                          fontFamily: T.code.fontFamily, lineHeight: 1.6 }}>
              <span style={{ color: C.blue }}>● Blue</span> = control side (running var &lt; cutoff) ·{" "}
              <span style={{ color: C.orange }}>● Orange</span> = treatment side ·{" "}
              Lines are local linear fits (kernel-weighted).{" "}
              <span style={{ color: C.gold }}>— Dashed</span> = cutoff threshold.
            </div>
            <div style={{ border: `1px solid ${C.border}`, borderRadius: 4,
                          padding: "0.5rem", background: C.bg, marginBottom: "1rem" }}>
              <RDDScatterPlot rddResult={rawResult?.rddData ?? rawResult} />
            </div>
          </div>
        )}

        {/* ── AI Narrative — inline collapsible ── */}
        <div style={{ marginTop: "1.2rem" }}>
          <button
            onClick={() => setNarrativeOpen(o => !o)}
            style={{
              width: "100%", display: "flex", alignItems: "center",
              justifyContent: "space-between",
              padding: "0.6rem 1rem",
              background: narrativeOpen ? `${C.purple}0d` : C.surface,
              border: `1px solid ${narrativeOpen ? C.purple + "50" : C.border}`,
              borderRadius: narrativeOpen ? "4px 4px 0 0" : 4,
              cursor: "pointer", fontFamily: T.code.fontFamily, transition: "all 0.13s",
            }}
          >
            <span style={{ fontSize: T.caption.fontSize, color: C.purple, letterSpacing: "0.22em", textTransform: "uppercase" }}>
              ✦ AI Narrative
            </span>
            <span style={{ fontSize: T.caption.fontSize, color: C.textMuted }}>{narrativeOpen ? "▲" : "▼"}</span>
          </button>
          {narrativeOpen && (
            <div style={{
              border: `1px solid ${C.purple}50`, borderTop: "none",
              borderRadius: "0 0 4px 4px", padding: "1.2rem",
              background: C.surface, animation: "fadeUp 0.15s ease",
            }}>
              <AINarrative
                result={result}
                modelLabel={modelLabel}
                yVar={yVar}
                dataDictionary={cleanedData?.dataDictionary ?? null}
                rows={cleanedData?.cleanRows ?? null}
                snapshot={snapshot}
              />
            </div>
          )}
        </div>

        {/* ── AI Unified Script Export — Phase 9.10 ── */}
        <AIUnifiedScript result={result} cleanedData={cleanedData} snapshot={snapshot} availableDatasets={availableDatasets} pid={pid} globalPipeline={globalPipeline} />

      </div>
    </div>
  );
}
