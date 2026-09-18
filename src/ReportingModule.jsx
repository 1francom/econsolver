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
import { interpretRegression, generateScriptNotes } from "./services/AI/AIService.js";
import { buildSessionSnapshot } from "./services/AI/sessionSnapshot.js";
import { useSessionLog } from "./services/session/sessionLog.jsx";
import { useSessionState } from "./services/session/sessionState.jsx";
import { toDfVar } from "./pipeline/exporter.js";
import { transpileSpatialOp } from "./services/export/spatialScript.js";
import { buildUnifiedScript, modelConfigFromResult } from "./services/export/unifiedScript.js";
import { buildLeafletR, buildFoliumPy } from "./services/export/mapScript.js";
import { getPlotHistory, getMapHistory } from "./services/Persistence/plotHistory.js";
import { getArtifactOrder, saveArtifactOrder, makeArtifactId, orderArtifacts } from "./services/Persistence/artifactOrder.js";
import { planExecutionOrder, detectInterleaving } from "./services/export/timelinePlan.js";
import { loadProjectPipelines } from "./services/Persistence/indexedDB.js";
import { ForestPlot } from "./components/modeling/resultDisplay.jsx";
import { buildCoefGroups, hiddenCoefNames } from "./components/modeling/coefGroups.js";
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

// The forest plot is the SHARED component in components/modeling/resultDisplay.jsx.
// This module used to carry a byte-for-byte copy of it, so the row-count scaling
// bug (and its fix) existed in two places at once.

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
           style={{ width: "100%", maxWidth: 700, minWidth: 400, height: "auto", maxHeight: "45vh", display: "block", fontFamily: T.code.fontFamily }}>
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
                overflowWrap: "break-word", wordBreak: "break-word",
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
// How many chips are worth reading at a glance. Past this the callout stops
// being a callout — a 93-level factor drowned the two terms that were estimated.
const SIG_CHIP_MAX = 12;

function SigCallout({ result }) {
  const { C, T } = useTheme();
  const { varNames, beta, se, pVals } = result;
  const [showAll, setShowAll] = useState(false);
  // Factor levels are parameters, not findings — same rule as the forest plot.
  const { levelOf } = useMemo(
    () => buildCoefGroups(varNames, result.spec?.factorVars ?? []),
    [varNames, result.spec?.factorVars],
  );
  const allSig = varNames
    .map((v, i) => ({ v, b: beta[i], s: se[i], p: pVals[i] }))
    .filter(d => d.v !== "(Intercept)" && isFinite(d.b) && isFinite(d.s) && d.p < 0.05);
  const levelSig = allSig.filter(d => levelOf.has(d.v));
  // Rank what is left by |t|, so the strongest result is the first chip rather
  // than whichever column happened to sit first in the design matrix.
  const ranked = allSig
    .filter(d => !levelOf.has(d.v))
    .sort((a, b) => Math.abs(b.b / b.s) - Math.abs(a.b / a.s));
  const sig = showAll ? [...ranked, ...levelSig] : ranked.slice(0, SIG_CHIP_MAX);
  const hiddenN = allSig.length - sig.length;

  if (!allSig.length) return (
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
      {(hiddenN > 0 || showAll) && (
        <button
          onClick={() => setShowAll(v => !v)}
          style={{ padding: "0.45rem 0.85rem", background: "none",
            border: `1px dashed ${C.border2}`, borderRadius: 4, cursor: "pointer",
            fontFamily: T.code.fontFamily, fontSize: T.caption.fontSize, color: C.textDim }}>
          {showAll
            ? "▾ show fewer"
            : `▸ ${hiddenN} more significant${levelSig.length ? ` (${levelSig.length} factor levels)` : ""}`}
        </button>
      )}
    </div>
  );
}

// ─── AI UNIFIED SCRIPT ───────────────────────────────────────────────────────
// Phase 9.10 — generates a polished, combined replication script via Claude.
// Props:
//   result       — normalised EstimationResult (for model section)
//   cleanedData  — { cleanRows, headers, pipeline, dataDictionary, filename }
function AIUnifiedScript({ result, cleanedData, snapshot, availableDatasets = [], pinnedModels = [], pid = null, globalPipeline = [] }) {
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
  // AI commentary is optional and additive: a comment block above the
  // deterministic script. The script never depends on it.
  const [aiNotes, setAiNotes]       = useState(false);
  const [notesState, setNotesState] = useState(null); // null | "loading" | "done" | message
  const [replicateMode,     setReplicateMode]     = useState("active"); // "active" | "all"
  const [artOrder, setArtOrder] = useState([]);
  const [artList,  setArtList]  = useState([]); // [{ artifactId, label, kind, savedAt }]

  const LANGS = [
    { id: "r",      label: "R" },
    { id: "python", label: "Python" },
    { id: "stata",  label: "Stata" },
  ];

  const STRUCTURES = [
    { id: "module",    label: "Per module",          disabled: false, tip: "Sections grouped by workspace module" },
    { id: "execution", label: "Per execution order", disabled: false, tip: "Blocks in the exact order you ran them (best for interleaved workflows)" },
  ];

  // ── Interleaving detection (Fase 3.2) — when the session interleaves datasets
  //    (e.g. Clean A → Model A → load B → Clean B → Model B), "Per execution
  //    order" is the faithful default. Set once when the panel opens; never
  //    override an explicit user pick afterwards.
  const timeline = snapshot?.sessionLog ?? [];
  const [interleaveHint, setInterleaveHint] = useState(null);
  const interleaveApplied = useRef(false);
  useEffect(() => {
    if (!open || interleaveApplied.current) return;
    interleaveApplied.current = true;
    try {
      const det = detectInterleaving(timeline);
      if (det?.interleaved) {
        setStructureMode("execution");
        setInterleaveHint(det.reason ?? "Interleaved workflow detected");
      }
    } catch { /* planner not available — keep module default */ }
  }, [open]); // eslint-disable-line react-hooks/exhaustive-deps

  // ── Manual cell edits (Fase 0.3, D2): `patch` steps are keyed on internal row
  //    ids (__row_id/__ri) that don't exist in the raw file — not faithfully
  //    replicable in R/Stata. Python's pandas handles them; R/Stata get a
  //    warning + a cleaned-dataset download instead.
  //    Patches are counted across ALL session datasets — edits on a non-active
  //    dataset must keep the warning visible when the user switches the Report
  //    dataset (Franco, browser-test 2026-06-12). Non-active pipelines come
  //    from the per-project IDB record; the active one uses its live pipeline.
  const [editsByDataset, setEditsByDataset] = useState({}); // { dsName: patchCount }
  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    (async () => {
      const counts = {};
      let map = {};
      try { map = (await loadProjectPipelines(pid))?.datasetPipelines ?? {}; } catch { /* no IDB record yet */ }
      if (availableDatasets.length) {
        for (const ds of availableDatasets) {
          const isActive = ds.filename === cleanedData?.filename;
          const pipe = isActive
            ? (cleanedData?.pipeline ?? map[ds.id]?.pipeline ?? [])
            : (map[ds.id]?.pipeline ?? []);
          const n = (Array.isArray(pipe) ? pipe : []).filter(s => s.type === "patch").length;
          if (n > 0) counts[ds.name ?? ds.filename ?? ds.id] = n;
        }
      } else {
        const n = (cleanedData?.pipeline ?? []).filter(s => s.type === "patch").length;
        if (n > 0) counts[cleanedData?.filename ?? "dataset"] = n;
      }
      if (!cancelled) setEditsByDataset(counts);
    })();
    return () => { cancelled = true; };
  }, [open, pid, availableDatasets, cleanedData]);

  const editedNames     = Object.keys(editsByDataset);
  const manualEdits     = editedNames.reduce((s, k) => s + editsByDataset[k], 0);
  const showEditWarning = manualEdits > 0 && lang !== "python";
  const activeHasEdits  = (cleanedData?.pipeline ?? []).some(s => s.type === "patch");

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

  function modelReplicationKey(model) {
    const spec = model?.spec ?? {};
    return JSON.stringify([
      model?.type ?? model?.label ?? "model",
      spec.filename ?? "", spec.yVar ?? "", spec.xVars ?? [], spec.wVars ?? [], spec.zVars ?? [],
      spec.entityCol ?? null, spec.timeCol ?? null, spec.postVar ?? null, spec.treatVar ?? null,
      spec.runningVar ?? null, spec.cutoff ?? null, spec.bandwidth ?? null, spec.kernel ?? null,
      model?.seType ?? null,
    ]);
  }

  function modelsToReplicate() {
    let base;
    if (replicateMode !== "all") base = result ? [result] : [];
    else {
      const activeKey = modelReplicationKey(result);
      base = [result, ...pinnedModels.filter(model => modelReplicationKey(model) !== activeKey)].filter(Boolean);
    }
    // Honor the global artifact order (panel) so reordering a model moves it in
    // the script too. Models absent from the order keep their natural position.
    if (!artOrder.length) return base;
    const rank = (m) => { const i = artOrder.indexOf(makeArtifactId("model", m.id)); return i < 0 ? Infinity : i; };
    return base.map((m, i) => [m, i]).sort((a, b) => (rank(a[0]) - rank(b[0])) || (a[1] - b[1])).map(([m]) => m);
  }

  // Stable primitive keys for the artifact-list effect deps — avoids a re-fetch
  // loop if a parent ever passes a new array ref each render.
  const _dsKey = availableDatasets.map(d => d.id).join(",");
  const _pmKey = pinnedModels.map(m => m.id).join(",");

  // Build the unified artifact list (plots + maps + models) and load the saved
  // global order so the user can drag it into the order the script emits.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      const hp = Array.from(new Set([pid, ...availableDatasets.map(d => d.id)].filter(Boolean)));
      const plots = (await Promise.all(hp.map(p => getPlotHistory(p).catch(() => [])))).flat();
      const maps  = (await Promise.all(hp.map(p => getMapHistory(p).catch(() => [])))).flat();
      const seen = new Set();
      const items = [];
      for (const e of plots) { const k = makeArtifactId("plot", e.id); if (!seen.has(k)) { seen.add(k); items.push({ artifactId: k, label: e.name ?? "plot", kind: "plot", savedAt: e.savedAt ?? 0 }); } }
      for (const e of maps)  { const k = makeArtifactId("map",  e.id); if (!seen.has(k)) { seen.add(k); items.push({ artifactId: k, label: e.name ?? "map",  kind: "map",  savedAt: e.savedAt ?? 0 }); } }
      for (const m of [result, ...pinnedModels].filter(Boolean)) { const k = makeArtifactId("model", m.id); if (m.id != null && !seen.has(k)) { seen.add(k); items.push({ artifactId: k, label: m.label ?? m.type ?? "model", kind: "model", savedAt: 0 }); } }
      const ord = await getArtifactOrder(pid).catch(() => []);
      if (!cancelled) { setArtList(orderArtifacts(items, ord)); setArtOrder(ord); }
    })();
    return () => { cancelled = true; };
  }, [pid, _dsKey, _pmKey, result?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  const moveArt = (i, dir) => {
    const j = i + dir;
    if (j < 0 || j >= artList.length) return;
    const next = [...artList];
    [next[i], next[j]] = [next[j], next[i]];
    setArtList(next);
    const ord = next.map(a => a.artifactId);
    setArtOrder(ord);
    if (pid) saveArtifactOrder(pid, ord).catch(() => {});
  };

  async function generate() {
    setLoading(true);
    setError("");
    setScript("");
    setNotesState(null);
    try {
      const multiDataset = availableDatasets.length > 1 || globalPipeline.length > 0;
      const comment = lang === "stata" ? "*" : "#";

      // ── Per-dataset build map (used by every path) ─────────────────────────
      // Per-dataset pipelines come from IDB; the Report-active dataset uses its
      // live (possibly newer) pipeline.
      let map = {};
      try { map = (await loadProjectPipelines(pid))?.datasetPipelines ?? {}; } catch { /* no IDB record yet */ }
      const built = {};
      const dsMap = {};
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
          // A derived dataset with no lineage record gets an explicit NOTE in the script.
          origin:   ds.origin ?? null,
        };
        dsMap[ds.id] = { name: ds.name ?? ds.filename, filename: ds.filename };
      }

      // ── Per-item source-dataset resolvers ──────────────────────────────────
      // Every visual/spatial artifact must bind to ITS OWN source dataset, never
      // the Report-active dataset (that bug made every pin/plot read off
      // `df_spatial_result`). Resolve by id (plot/map history key, spatial ref),
      // by filename (explore pin records `params.dataset`), or — for spatial
      // points, whose source dataset is not logged — by matching the op's lat/lon
      // columns against each loaded dataset's headers.
      const pointsSrcFor = (p) => {
        const c1 = p?.latCol ?? p?.yCol, c2 = p?.lonCol ?? p?.xCol;
        if (c1 && c2) {
          const d = availableDatasets.find(x => Array.isArray(x.headers) && x.headers.includes(c1) && x.headers.includes(c2));
          if (d) return { v: toDfVar(d.name ?? d.filename), known: true };
        }
        return { v: "points_df", known: false };
      };
      // Grids constructed in-script (grid_create_map) — consumer ops that
      // reference these must NOT get an "export this grid" note (it's rebuilt).
      const builtGridIds = new Set(
        timeline.filter(ev => ev?.module === "spatial" && ev.opType === "grid_create_map")
                .map(ev => ev.params?.gridDsId).filter(Boolean)
      );

      // ── Items, each bound to ITS OWN dataset ─────────────────────────────
      // The script itself is deterministic (services/export/unifiedScript.js):
      // every dataset is built once from its raw file + lineage, then these
      // items run in order, each on its own data. Nothing here goes through
      // an LLM — the model rewrote data prep before (PS5 lost a filter) and the
      // raw concatenation it fell back to could not run in Stata (PS4).
      const modelItem = (model) => ({
        kind: "model",
        label: model?.label ?? model?.modelLabel ?? model?.type ?? "Model",
        dataset: model?.datasetId ?? model?.spec?.filename ?? cleanedData?.filename,
        model: modelConfigFromResult(model),
        pipeline: model?.spec?.pipeline ?? [],
      });
      const exploreItem = (ev) => ({
        kind: "explore", label: ev.label ?? ev.params?.kind ?? "Explore",
        dataset: ev.params?.dataset ?? cleanedData?.filename, params: ev.params,
      });
      const spatialItem = (ev) => {
        const c = transpileSpatialOp(ev.opType, ev.params, lang, dsMap, pointsSrcFor(ev.params), builtGridIds);
        return c ? { kind: "code", label: ev.label ?? ev.opType, code: c } : null;
      };

      // Saved plots + maps, in the order the artifact panel shows.
      let visualItems = [];
      try {
        const histPids = Array.from(new Set([pid, ...availableDatasets.map(d => d.id)].filter(Boolean)))
          .flatMap(p => [p, `${p}_model`, `${p}_spec`, `${p}_bacon`]);
        const dedupeHistory = (arr) => {
          const seen = new Set();
          return arr.filter(e => {
            const k = e?.id ?? `${e?.name ?? ""}|${JSON.stringify(e?.layers ?? e?.geoms ?? e?.config ?? "")}`;
            return !seen.has(k) && seen.add(k);
          });
        };
        const savedPlots = dedupeHistory((await Promise.all(
          histPids.map(async p => (await getPlotHistory(p).catch(() => [])).map(e => ({ ...e, _srcId: p.replace(/_(model|spec|bacon)$/, "") })))
        )).flat());
        const savedMaps = dedupeHistory((await Promise.all(histPids.map(p => getMapHistory(p).catch(() => [])))).flat());
        const plotArts = savedPlots.map(e => ({ kind: "plot", artifactId: makeArtifactId("plot", e.id), savedAt: e.savedAt ?? 0, entry: e }));
        const mapArts  = savedMaps.map(e => ({ kind: "map", artifactId: makeArtifactId("map", e.id), savedAt: e.savedAt ?? 0, entry: e }));
        visualItems = orderArtifacts([...plotArts, ...mapArts], artOrder).map(a => {
          if (a.kind === "plot") {
            // A plot saved under the project id belongs to whichever dataset it
            // was drawn from; fall back to the Report's dataset.
            const src = a.entry.datasetId ?? a.entry._srcId;
            const dataset = dsMap[src] ? src : cleanedData?.filename;
            return { kind: "plot", label: `Plot: ${a.entry.name ?? "untitled"}`, dataset, entry: a.entry };
          }
          const code = lang === "python" ? buildFoliumPy(a.entry, { datasets: availableDatasets })
            : lang === "stata" ? `${comment} Map "${a.entry.name ?? ""}" — Stata has no leaflet; reproduce in R (leaflet) or Python (folium)`
            : buildLeafletR(a.entry, { datasets: availableDatasets });
          return { kind: "code", label: `Map: ${a.entry.name ?? "untitled"}`, code };
        });
      } catch { /* histories are best-effort; never block script generation */ }

      const items = [];
      if (structureMode === "execution" && timeline.length) {
        // Analysis blocks in the order they were run. Data prep is not
        // interleaved any more: every dataset has to exist before anything
        // reads it, and a derived one can only be built after its parent.
        const all = [result, ...pinnedModels].filter(Boolean);
        const matchModel = ev => {
          const f = ev?.params?.filename, t = ev?.params?.type, y = ev?.params?.yVar;
          return all.find(m => (m.spec?.filename ?? null) === f && (m.type ?? null) === t && (m.spec?.yVar ?? null) === y)
              ?? all.find(m => (m.type ?? null) === t && (m.spec?.yVar ?? null) === y)
              ?? null;
        };
        const seenModels = new Set();
        for (const blk of (planExecutionOrder(timeline)?.blocks ?? [])) {
          if (blk.kind === "estimate") {
            const m = matchModel(blk.events?.[0]);
            if (m && !seenModels.has(m)) { seenModels.add(m); items.push(modelItem(m)); }
            else if (!m) items.push({ kind: "code", label: blk.label, code: `${comment} ${blk.label} — model not pinned; pin it in the Model tab to replicate` });
          } else if (blk.kind === "explore") {
            for (const ev of (blk.events ?? [])) if (ev?.opType === "explore_stat") items.push(exploreItem(ev));
          } else if (blk.kind === "spatial") {
            const seen = new Set();
            for (const ev of (blk.events ?? [])) {
              const it = spatialItem(ev);
              if (it && !seen.has(it.code)) { seen.add(it.code); items.push(it); }
            }
          }
        }
      } else {
        items.push(...modelsToReplicate().map(modelItem));
        for (const ev of timeline.filter(e => e?.module === "explore" && e.opType === "explore_stat")) items.push(exploreItem(ev));
        const seenSpatial = new Set();
        for (const ev of timeline.filter(e => e?.module === "spatial" && e.opType !== "geocode")) {
          const it = spatialItem(ev);
          if (it && !seenSpatial.has(it.code)) { seenSpatial.add(it.code); items.push(it); }
        }
      }
      items.push(...visualItems);

      let out = buildUnifiedScript({ lang, datasets: built, globalPipeline, items, title: "Unified replication script" });
      if (showEditWarning) {
        const files = editedNames.map(n => `"${n.replace(/\.[^.]+$/, "")}_cleaned.csv"`).join(", ");
        out = `${comment} NOTE: ${manualEdits} manual cell edit(s) on ${editedNames.map(n => `"${n}"`).join(", ")} cannot be\n`
            + `${comment} replayed from the raw file. For an exact replication load ${files} (download it from Litux).\n\n${out}`;
      }
      setScript(out);
      // Optional commentary: a comment block above the code, never a rewrite.
      if (aiNotes) {
        setNotesState("loading");
        try {
          const notes = await generateScriptNotes(out, lang, { snapshot });
          if (notes.trim()) setScript(`${notes}\n\n${out}`);
          setNotesState("done");
        } catch (e) {
          setNotesState(e?.message === "INSUFFICIENT_CREDITS"
            ? "AI notes skipped: no credits left this month. The script above is complete."
            : `AI notes skipped (${e?.message ?? "request failed"}). The script above is complete.`);
        }
      }
    } catch (e) {
      const msg = e.message === "REPLICATION_PAID_ONLY"
        ? "AI script replication is a paid-tier feature. Upgrade to Pro or Premium to generate the unified replication script. (You can still export the deterministic R / Stata / Python scripts from the model tab.)"
        : e.message === "INSUFFICIENT_CREDITS"
        ? "You've used all your credits for this month. They reset automatically every 30 days."
        : (e.message ?? "Generation failed.");
      setError(msg);
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
          ✦ Unified Replication Script
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
            One script for the whole project: every dataset rebuilt from its raw file
            and recorded lineage, then your models, descriptive stats and saved plots,
            each on its own dataset. The code is generated deterministically — the
            same code Litux checks against R, Stata and Python — and runs as is.
          </div>

          {/* Manual-edit warning (Fase 0.3) — R/Stata only */}
          {showEditWarning && (
            <div style={{ marginBottom: "0.9rem", padding: "0.6rem 0.8rem",
                          border: `1px solid ${C.gold}60`, borderRadius: 3, background: `${C.gold}0d` }}>
              <div style={{ fontSize: T.code.fontSize, color: C.gold, fontFamily: T.code.fontFamily, lineHeight: 1.55 }}>
                ⚠ This session contains {manualEdits} manual cell edit{manualEdits === 1 ? "" : "s"} on{" "}
                {editedNames.map(n => `"${n}"`).join(", ")} that can't be faithfully replicated
                in {lang === "r" ? "R" : "Stata"}. For an exact replication, download the cleaned
                dataset{editedNames.length === 1 ? "" : "s"} and load {editedNames.length === 1 ? "it" : "them"} directly in your script.
              </div>
              {activeHasEdits ? (
                <button onClick={downloadCleanCSV}
                  style={{ marginTop: 6, padding: "0.26rem 0.7rem", borderRadius: 3, cursor: "pointer",
                           fontFamily: T.code.fontFamily, fontSize: T.caption.fontSize,
                           border: `1px solid ${C.gold}`, background: "transparent", color: C.gold }}>
                  ↓ Download cleaned dataset (CSV)
                </button>
              ) : (
                <div style={{ marginTop: 6, fontSize: T.caption.fontSize, color: C.textDim, fontFamily: T.code.fontFamily }}>
                  Switch the Report dataset to {editedNames.map(n => `"${n}"`).join(" / ")} to download its cleaned CSV.
                </div>
              )}
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
            {interleaveHint && structureMode === "execution" && (
              <div style={{ marginTop: 6, fontSize: T.caption.fontSize, color: C.teal, fontFamily: T.code.fontFamily }}>
                ⤳ Execution order auto-selected: {interleaveHint}
              </div>
            )}
          </div>

          {/* Model replication scope (Fase 2.4) */}
          <div style={{ marginBottom: "0.9rem" }}>
            <div style={{ fontSize: T.caption.fontSize, color: C.textMuted, fontFamily: T.code.fontFamily,
                          letterSpacing: "0.18em", textTransform: "uppercase", marginBottom: 6 }}>
              Replicate:
            </div>
            <div style={{ display: "flex", gap: 4, flexWrap: "wrap" }}>
              {[
                { id: "active", label: "Active model", disabled: false },
                { id: "all", label: `All pinned models (${pinnedModels.length})`, disabled: pinnedModels.length === 0 },
              ].map(mode => (
                <button key={mode.id} onClick={() => !mode.disabled && setReplicateMode(mode.id)}
                  disabled={mode.disabled}
                  style={{
                    padding: "0.26rem 0.7rem", borderRadius: 3,
                    cursor: mode.disabled ? "not-allowed" : "pointer",
                    fontFamily: T.code.fontFamily, fontSize: T.caption.fontSize, transition: "all 0.12s",
                    background: replicateMode === mode.id ? `${C.teal}15` : "transparent",
                    border: `1px solid ${replicateMode === mode.id ? C.teal : C.border2}`,
                    color: mode.disabled ? C.textMuted : replicateMode === mode.id ? C.teal : C.textDim,
                    opacity: mode.disabled ? 0.55 : 1,
                  }}>
                  {replicateMode === mode.id ? "●" : "○"} {mode.label}
                </button>
              ))}
            </div>
          </div>

          {artList.length > 0 && (
            <div style={{ border: `1px solid ${C.border}`, borderRadius: 4, marginBottom: "0.9rem" }}>
              <div style={{ padding: "0.4rem 0.7rem", borderBottom: `1px solid ${C.border}`, fontSize: T.caption.fontSize, color: C.textMuted, fontFamily: T.code.fontFamily, letterSpacing: "0.18em", textTransform: "uppercase" }}>
                Saved artifacts — script order
              </div>
              <div style={{ display: "flex", flexDirection: "column" }}>
                {artList.map((a, i) => (
                  <div key={a.artifactId} style={{ display: "flex", alignItems: "center", gap: 8, padding: "0.28rem 0.7rem", borderBottom: i < artList.length - 1 ? `1px solid ${C.border}` : "none" }}>
                    <span style={{ width: 44, fontFamily: T.code.fontFamily, fontSize: T.caption.fontSize, color: a.kind === "model" ? C.gold : a.kind === "map" ? C.blue : C.teal }}>{a.kind}</span>
                    <span style={{ flex: 1, minWidth: 0, fontFamily: T.code.fontFamily, fontSize: T.code.fontSize, color: C.text, overflow: "hidden", whiteSpace: "nowrap", textOverflow: "ellipsis" }}>{a.label}</span>
                    <button onClick={() => moveArt(i, -1)} disabled={i === 0} title="Move up"
                      style={{ background: "none", border: "none", color: i === 0 ? C.border : C.textMuted, cursor: i === 0 ? "default" : "pointer", fontSize: T.code.fontSize, padding: 0 }}>▲</button>
                    <button onClick={() => moveArt(i, 1)} disabled={i === artList.length - 1} title="Move down"
                      style={{ background: "none", border: "none", color: i === artList.length - 1 ? C.border : C.textMuted, cursor: i === artList.length - 1 ? "default" : "pointer", fontSize: T.code.fontSize, padding: 0 }}>▼</button>
                  </div>
                ))}
              </div>
            </div>
          )}

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
          <div style={{ marginTop: -6, marginBottom: "0.9rem" }}>
            <label style={{ display: "inline-flex", alignItems: "center", gap: 6, cursor: "pointer",
                            fontSize: T.caption.fontSize, color: C.textDim, fontFamily: T.code.fontFamily }}>
              <input type="checkbox" checked={aiNotes} onChange={e => setAiNotes(e.target.checked)} />
              Add AI commentary (a comment header describing the analysis — the code is not changed)
            </label>
            {notesState === "loading" && (
              <div style={{ marginTop: 4, fontSize: T.caption.fontSize, color: C.gold, fontFamily: T.code.fontFamily }}>Claude is writing the commentary…</div>
            )}
            {notesState && notesState !== "loading" && notesState !== "done" && (
              <div style={{ marginTop: 4, fontSize: T.caption.fontSize, color: C.gold, fontFamily: T.code.fontFamily }}>⚠ {notesState}</div>
            )}
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
              <span>Building the script…</span>
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
export default function ReportingModule({ result: propResult, cleanedData, availableDatasets = [], pinnedModels = [], pid = null, onClose }) {
  const { C, T } = useTheme();
  const [tab, setTab] = useState("forest");
  // Which factor groups the forest plot has open. Owned HERE, not inside the
  // plot, because the "Copy LaTeX" button beside it must omit the same rows —
  // a figure and a table in one tab disagreeing about the model is the
  // export-drift failure this codebase keeps hitting.
  // `forestOmit` itself has to sit AFTER `result` is declared: `result` is a
  // const below, so reading it up here is a temporal-dead-zone ReferenceError,
  // not an undefined — it crashed the whole module.
  const [forestExpanded, setForestExpanded] = useState(() => new Set());

  // Which model the report currently displays — defaults to the model that
  // was active when this tab opened, but the user can switch to any pinned
  // model via the selector below "How to report" without leaving the page.
  const [selectedId, setSelectedId] = useState(null);
  const rawResult = (selectedId && pinnedModels.find(m => m.id === selectedId)) || propResult;

  const result = useMemo(() => normaliseResult(rawResult), [rawResult]);

  // Rows the forest plot is collapsing, so "Copy LaTeX" omits the same ones.
  // `result` can be null before a model is pinned, so everything here tolerates
  // an absent varNames rather than assuming the shape.
  const forestOmit = useMemo(() => {
    const names = result?.varNames ?? [];
    const { levelOf } = buildCoefGroups(names, result?.spec?.factorVars ?? []);
    return hiddenCoefNames(names, levelOf, forestExpanded);
  }, [result, forestExpanded]);

  // ── Build session snapshot once per render — passed to AI calls so Claude
  //    sees data load opts (sep, sheet, encoding), pipeline, dictionary, etc.
  //    `datasets` lists EVERY session dataset so multi-dataset workspaces
  //    replicate all loads, and `globalPipeline` carries cross-dataset G-steps.
  const { log: sessionLog } = useSessionLog();
  const { globalPipeline } = useSessionState();
  // Datasets that are derive-children (recipe-backed, Fase 2.1) are rebuilt
  // IN-SCRIPT from their parent — the snapshot marks them so REQUIRED LOAD
  // CALLS never instructs the AI to also load them from a (nonexistent) file.
  const snapshot = useMemo(() => {
    const deriveChildIds = new Set(
      (globalPipeline ?? [])
        .filter(g => g.opType === "derive" && g.leftDatasetId && g.params?.recipe)
        .map(g => g.leftDatasetId)
    );
    const datasets = availableDatasets.map(d =>
      deriveChildIds.has(d.id) ? { ...d, derived: true } : d
    );
    return buildSessionSnapshot({ cleanedData, result: rawResult, pinnedModels, sessionLog, datasets });
  }, [cleanedData, rawResult, pinnedModels, sessionLog, availableDatasets, globalPipeline]);

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
      <div style={{ flex: 1, minWidth: 0, minHeight: 0, overflowY: "auto", overflowX: "hidden",
                    padding: "1.4rem", paddingBottom: "3rem" }}>
      <div style={{ maxWidth: 1400, margin: "0 auto" }}>

        <HintBox color={C.gold} title="Report" sections={[
          { heading: "Requirements", items: [
            "Pin at least one model in the Model tab first — use the ◈ pin icon next to any result",
            "All pinned models appear here automatically",
            "With several pinned, a model selector appears at the top to switch which one the report describes",
          ]},
          { heading: "Outputs", items: [
            "LaTeX Stargazer table: multi-column comparison of all pinned models, publication-ready",
            "Forest plot: coefficient + 95% CI across all pinned specifications",
            "Levels of a factor variable are collapsed behind a per-factor toggle — expand one and the LaTeX table drops the same rows, so figure and table always agree",
            "AI Narrative: 2–3 academic paragraphs interpreting the results",
            "Replication bundle: R + Stata + Python scripts plus the data, as a zip",
          ]},
          { heading: "Replication scripts", items: [
            "The script is built from what you actually did: the load call, every pipeline step, and the model spec",
            "Load options are honoured — a semicolon CSV exports as read_delim(delim=\";\"), an Excel sheet keeps its sheet name, a .dta uses read_dta",
            "Multi-dataset sessions load every dataset with the right reader and estimate on the model's own source dataset",
            "Unified Replication Script: every dataset is rebuilt once from its raw file and recorded lineage, then your models, Explore pins and saved plots run in order, each on its own dataset — the code is generated, not written by AI, and runs as is in R, Stata and Python",
            "Add AI commentary puts a comment header above the script (what the analysis does, identifying assumptions); it never changes the code",
            "A dataset derived before Litux recorded lineage cannot be rebuilt — the script says so above its load line; re-derive it (Save as dataset) to fix that",
            "Renaming a dataset in the Data tab changes the df_<name> it gets in the script",
            "Scripts are editable before download — but edits are yours to maintain, they are not fed back into the app",
          ]},
          { heading: "Tips", items: [
            "Pin the same spec with different SE types to show robustness in a single table",
            "Label your variables in Clean → Dictionary — the AI narrative reads those labels and writes better prose with them",
            "LaTeX output works with Overleaf and standard journal templates",
            "Running a spec across subsets in Model gives you a multi-subset bundle here",
          ]},
        ]} />

        {/* ── Pinned-model selector — switch which model this report shows ── */}
        {(() => {
          const currentId = propResult?.id;
          const alreadyPinned = currentId && pinnedModels.some(m => m.id === currentId);
          const modelChips = [
            ...(alreadyPinned ? [] : (propResult ? [{ ...propResult, __isCurrent: true }] : [])),
            ...pinnedModels,
          ];
          if (modelChips.length < 2) return null;
          return (
            <div style={{ display: "flex", gap: 6, flexWrap: "wrap", alignItems: "center", marginBottom: "1.2rem" }}>
              <span style={{ fontSize: T.caption.fontSize, color: C.textMuted, letterSpacing: "0.2em", textTransform: "uppercase" }}>
                Model:
              </span>
              {modelChips.map(m => {
                const isActive = m.__isCurrent ? !selectedId : selectedId === m.id;
                const label = m.label ?? m.modelLabel ?? m.type ?? "Model";
                return (
                  <button key={m.__isCurrent ? "__current__" : m.id}
                    onClick={() => setSelectedId(m.__isCurrent ? null : m.id)}
                    style={{
                      padding: "4px 10px", borderRadius: 3, cursor: "pointer",
                      fontFamily: T.code.fontFamily, fontSize: T.caption.fontSize,
                      border: `1px solid ${isActive ? C.teal : C.border2}`,
                      background: isActive ? `${C.teal}18` : "transparent",
                      color: isActive ? C.teal : C.textDim, transition: "all 0.12s",
                    }}>
                    {label}{m.yVar ? ` · ${m.yVar}` : ""}{m.__isCurrent ? " (current)" : ""}
                  </button>
                );
              })}
            </div>
          );
        })()}

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
                text={buildStargazer([{ label: modelLabel, result, yVar }], { omitVars: forestOmit })}
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
              factorVars={result.spec?.factorVars ?? []}
              expanded={forestExpanded}
              onExpandedChange={setForestExpanded}
              svgId="forest-report"
              filename="report_coefficients.svg"
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
                key={rawResult?.id ?? "active"}
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
        <AIUnifiedScript key={rawResult?.id ?? "active"} result={result} cleanedData={cleanedData} snapshot={snapshot} availableDatasets={availableDatasets} pinnedModels={pinnedModels} pid={pid} globalPipeline={globalPipeline} />

      </div>
      </div>
    </div>
  );
}
