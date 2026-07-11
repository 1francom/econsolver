// ─── ECON STUDIO · src/components/tabs/CalculateTab.jsx ──────────────────────
// Phase 9.7 + Phase 11 — Calculate Tab: variable workspace + math engine.
//
// Sections:
//   1. User-defined variables (scalar, vector, expression)
//   2. Computed from dataset (aggregate statistics)
//   3. New dataset from vectors
//   4. Equation solver (Brent root finding + Newton-Raphson system)
//   5. Numerical derivatives (central-difference, higher-order)
//   6. Symbolic derivative (unknown functions, product/chain rule)
//   7. Algebraic equation pad (named relations, batch differentiation)
//   8. Model prediction (ŷ ± 95% CI from pinned models)
//
// Props: rows, headers, onAddDataset(name, rows, headers)

import { useState, useMemo, useEffect, useRef } from "react";
import { HintBox } from "../HelpSystem.jsx";
import { evalExpression, buildScope, solveRootAuto, solveSystem, derivative, nthDerivative, integrate, limit,
  dnorm, pnorm, qnorm, dt, pt, qt, dbinom, pbinom, dpois, ppois, dchisq, pchisq, qchisq,
} from "../../math/calcEngine.js";
import { bootstrapMean, subsampleMean, permutationTwoSampleMean } from "../../math/Resampling.js";
import { symbolicDiff, latexName } from "../../math/symbolicDiff.js";
import { solveAlgebraicEquation } from "../../math/symbolicSolve.js";
import { assertSafeExpr } from "../../pipeline/exprGuard.js";
import { useTheme } from "../../ThemeContext.jsx";
import Workbench from "../calculate/workbench/Workbench.jsx";
import { useSessionLog } from "../../services/session/sessionLog.jsx";

// ─── ATOMS ────────────────────────────────────────────────────────────────────
function Lbl({ children, color, mb = 6 }) {
  const { C, T } = useTheme();
  return <div style={{ fontSize: T.caption.fontSize, color: color ?? C.textMuted, letterSpacing: "0.2em", textTransform: "uppercase", marginBottom: mb, fontFamily: T.code.fontFamily }}>{children}</div>;
}
function Btn({ onClick, ch, color, v = "out", dis = false, sm = false }) {
  const { C, T } = useTheme();
  const btnColor = color ?? C.gold;
  const b = { padding: sm ? "0.28rem 0.65rem" : "0.45rem 0.9rem", borderRadius: 3, cursor: dis ? "not-allowed" : "pointer", fontFamily: T.code.fontFamily, fontSize: sm ? T.caption.fontSize : T.code.fontSize, transition: "all 0.13s", opacity: dis ? 0.4 : 1 };
  if (v === "solid") return <button onClick={onClick} disabled={dis} style={{ ...b, background: btnColor, color: C.bg, border: `1px solid ${btnColor}`, fontWeight: 700 }}>{ch}</button>;
  if (v === "ghost") return <button onClick={onClick} disabled={dis} style={{ ...b, background: "transparent", border: "none", color: dis ? C.textMuted : btnColor }}>{ch}</button>;
  return <button onClick={onClick} disabled={dis} style={{ ...b, background: "transparent", border: `1px solid ${C.border2}`, color: dis ? C.textMuted : C.textDim }}>{ch}</button>;
}
function SectionHeader({ label, open, onToggle, badge }) {
  const { C, T } = useTheme();
  return (
    <div onClick={onToggle} style={{ background: C.surface2, padding: "0.55rem 0.85rem", borderBottom: open ? `1px solid ${C.border}` : "none", cursor: "pointer", display: "flex", alignItems: "center", gap: 8 }}>
      <span style={{ fontSize: T.caption.fontSize, color: C.textMuted }}>{open ? "▾" : "▸"}</span>
      <Lbl color={C.textDim} mb={0}>{label}</Lbl>
      {badge && <span style={{ marginLeft: "auto", fontSize: T.caption.fontSize, color: C.textMuted }}>{badge}</span>}
    </div>
  );
}
const fieldStyle = (C, T) => ({ background: C.surface2, border: `1px solid ${C.border2}`, borderRadius: 3, color: C.text, fontFamily: T.code.fontFamily, fontSize: T.code.fontSize, padding: "0.28rem 0.55rem", outline: "none" });
const typeColor = C => ({ Integer: C.blue, Float: C.blue, Slider: C.teal, String: C.teal, Date: C.teal, Boolean: C.orange, Vector: C.purple, Expression: C.gold, Computed: C.textMuted });
const thStyle = (C, T) => ({ padding: "0.4rem 0.75rem", textAlign: "left", fontFamily: T.code.fontFamily, fontWeight: 400, fontSize: T.caption.fontSize, letterSpacing: "0.16em", textTransform: "uppercase", borderBottom: `1px solid ${C.border}`, color: C.textMuted, background: C.surface2 });
const tdStyle = C => ({ padding: "0.35rem 0.75rem", borderBottom: `1px solid ${C.border}`, verticalAlign: "middle" });

// ─── SCRIPT GENERATOR ────────────────────────────────────────────────────────
export function generateCalcScript(language, variables, computeds) {
  const lines = [];
  if (language === "r") {
    variables.forEach(v => {
      if (v.type === "Expression") lines.push(`${v.name} <- ${v.rawValue}  # expression`);
      else lines.push(`${v.name} <- ${rVal(v)}`);
    });
    computeds.forEach(c => lines.push(`${c.name} <- ${c.fn}(df$${c.col})`));
  } else if (language === "stata") {
    variables.forEach(v => {
      if (v.type === "Expression") lines.push(`scalar ${v.name} = ${v.rawValue}`);
      else if (v.type === "String") lines.push(`local ${v.name} "${v.rawValue}"`);
      else if (v.type === "Vector") lines.push(`matrix ${v.name} = (${v.rawValue})`);
      else lines.push(`scalar ${v.name} = ${v.type === "Boolean" ? (v.rawValue === "TRUE" ? "1" : "0") : v.rawValue}`);
    });
    computeds.forEach(c => {
      lines.push(`summarize ${c.col}, meanonly`);
      lines.push(`scalar ${c.name} = r(${{ mean:"mean",sum:"sum",count:"N",min:"min",max:"max" }[c.fn]||"mean"})`);
    });
  } else if (language === "python") {
    lines.push("import pandas as pd", "import numpy as np", "");
    variables.forEach(v => {
      if (v.type === "Expression") lines.push(`${v.name} = ${v.rawValue}  # expression`);
      else lines.push(`${v.name} = ${pyVal(v)}`);
    });
    computeds.forEach(c => lines.push(`${c.name} = df["${c.col}"].${{ mean:"mean",sum:"sum",count:"count",min:"min",max:"max" }[c.fn]||"mean"}()`));
  }
  return lines.join("\n");
}
function rVal(v) {
  if (v.type === "Integer") return `${parseInt(v.rawValue) || 0}L`;
  if (v.type === "Float")   return String(parseFloat(v.rawValue) || 0);
  if (v.type === "String")  return `"${v.rawValue}"`;
  if (v.type === "Date")    return `as.Date("${v.rawValue}")`;
  if (v.type === "Boolean") return v.rawValue === "TRUE" ? "TRUE" : "FALSE";
  if (v.type === "Vector")  return `c(${v.rawValue})`;
  return `"${v.rawValue}"`;
}
function pyVal(v) {
  if (v.type === "Integer") return String(parseInt(v.rawValue) || 0);
  if (v.type === "Float")   return String(parseFloat(v.rawValue) || 0);
  if (v.type === "String")  return `"${v.rawValue}"`;
  if (v.type === "Date")    return `pd.Timestamp("${v.rawValue}")`;
  if (v.type === "Boolean") return v.rawValue === "TRUE" ? "True" : "False";
  if (v.type === "Vector")  return `[${v.rawValue}]`;
  return `"${v.rawValue}"`;
}
function evalComputed(fn, col, rows) {
  const vals = rows.map(r => r[col]).filter(v => v !== null && v !== undefined && !isNaN(Number(v))).map(Number);
  if (!vals.length) return "n/a";
  const sum = vals.reduce((a, b) => a + b, 0);
  if (fn === "mean")  return (sum / vals.length).toFixed(4);
  if (fn === "sum")   return sum.toFixed(4);
  if (fn === "count") return String(vals.length);
  if (fn === "min")   return Math.min(...vals).toFixed(4);
  if (fn === "max")   return Math.max(...vals).toFixed(4);
  return "?";
}
function download(text, filename) {
  const a = document.createElement("a");
  a.href = URL.createObjectURL(new Blob([text], { type: "text/plain" }));
  a.download = filename; a.click(); URL.revokeObjectURL(a.href);
}
function defaultVal(type) {
  return { Integer: "0", Float: "0.0", Slider: "1", Boolean: "TRUE", Date: new Date().toISOString().slice(0, 10), Vector: "0", Expression: "" }[type] || "";
}
function fmt(n, d = 6) {
  if (n == null || !isFinite(n)) return "—";
  return Number(n).toFixed(d);
}

// ─── REPLICATE HISTOGRAM ──────────────────────────────────────────────────────
// Tiny SVG histogram of resampling replicates. Bin count fixed (~28 — a clean
// Sturges-ish default for B ∈ [500, 50_000]). Optional vertical marker for the
// observed statistic (e.g. permutation Δ_obs) and shaded CI band.
function ReplicateHistogram({ replicates, marker, ciLo, ciHi, color }) {
  const { C, T } = useTheme();
  const col = color ?? C.teal;
  if (!replicates?.length) return null;
  const W = 360, H = 90, PAD = { l: 8, r: 8, t: 6, b: 14 };
  const lo = Math.min(...replicates), hi = Math.max(...replicates);
  const span = hi - lo || 1;
  const NBINS = 28;
  const w = span / NBINS;
  const counts = new Array(NBINS).fill(0);
  for (const v of replicates) {
    const i = Math.min(NBINS - 1, Math.max(0, Math.floor((v - lo) / w)));
    counts[i]++;
  }
  const maxC = Math.max(...counts);
  const x = v => PAD.l + (W - PAD.l - PAD.r) * (v - lo) / span;
  const y = c => H - PAD.b - (H - PAD.t - PAD.b) * (c / maxC);
  const bw = (W - PAD.l - PAD.r) / NBINS;
  return (
    <svg width={W} height={H} style={{ display: "block", marginTop: 6 }}>
      {ciLo != null && ciHi != null && (
        <rect x={x(ciLo)} y={PAD.t} width={x(ciHi) - x(ciLo)} height={H - PAD.t - PAD.b}
          fill={col} opacity={0.08}/>
      )}
      {counts.map((c, i) => (
        <rect key={i} x={PAD.l + i * bw + 0.5} y={y(c)} width={Math.max(0, bw - 1)}
          height={H - PAD.b - y(c)} fill={col} opacity={0.55}/>
      ))}
      {marker != null && isFinite(marker) && marker >= lo && marker <= hi && (
        <line x1={x(marker)} x2={x(marker)} y1={PAD.t} y2={H - PAD.b}
          stroke={C.gold} strokeWidth={1.5}/>
      )}
      <line x1={PAD.l} x2={W - PAD.r} y1={H - PAD.b} y2={H - PAD.b} stroke={C.border} />
      <text x={PAD.l} y={H - 2} fontSize={T.caption.fontSize} fontFamily={T.data.fontFamily} fill={C.textMuted}>{lo.toFixed(3)}</text>
      <text x={W - PAD.r} y={H - 2} textAnchor="end" fontSize={T.caption.fontSize} fontFamily={T.data.fontFamily} fill={C.textMuted}>{hi.toFixed(3)}</text>
    </svg>
  );
}

// ─── RESULT BOX ───────────────────────────────────────────────────────────────
function ResultBox({ children, color }) {
  const { C, T } = useTheme();
  const col = color ?? C.teal;
  return (
    <div style={{ background: `${col}0a`, border: `1px solid ${col}30`, borderRadius: 3, padding: "0.65rem 0.9rem", fontFamily: T.code.fontFamily, fontSize: T.code.fontSize, color: C.text, lineHeight: 1.9, marginTop: 8 }}>
      {children}
    </div>
  );
}
function ErrBox({ msg }) {
  const { C, T } = useTheme();
  return <div style={{ color: C.red, fontFamily: T.code.fontFamily, fontSize: T.caption.fontSize, marginTop: 6 }}>{msg}</div>;
}

// ─── VALUE INPUT ──────────────────────────────────────────────────────────────
function ValueInput({ type, value, onChange }) {
  const { C, T } = useTheme();
  if (type === "Boolean") return (
    <select value={value} onChange={e => onChange(e.target.value)} style={{ ...fieldStyle(C, T), flex: 1 }}>
      <option>TRUE</option><option>FALSE</option>
    </select>
  );
  if (type === "Date") return <input type="date" value={value} onChange={e => onChange(e.target.value)} style={{ ...fieldStyle(C, T), flex: 1 }} />;
  if (type === "Expression") return (
    <input type="text" placeholder="e.g. 2*alpha + sqrt(beta)" value={value}
      onChange={e => onChange(e.target.value)} style={{ ...fieldStyle(C, T), flex: 1, minWidth: 160 }} />
  );
  const isNum = type === "Integer" || type === "Float";
  return <input type={isNum ? "number" : "text"} step={type === "Float" ? "any" : type === "Integer" ? "1" : undefined}
    placeholder={type === "Vector" ? "1.2, 0.8, -0.3" : isNum ? "0" : "…"}
    value={value} onChange={e => onChange(e.target.value)} style={{ ...fieldStyle(C, T), flex: 1, minWidth: 80 }} />;
}

// ─── EQUATION PICKER (load saved equations into any expression input) ─────────
function EquationPicker({ savedEqs, onLoad, label = "Load ▾" }) {
  const { C, T } = useTheme();
  const [open, setOpen] = useState(false);
  const hasJs = savedEqs.filter(e => e.jsExpr);
  if (!hasJs.length) return null;
  return (
    <div style={{ position: "relative", flexShrink: 0 }}>
      <button onClick={() => setOpen(o => !o)}
        style={{ padding: "0.2rem 0.55rem", background: "transparent", border: `1px solid ${C.gold}`, borderRadius: 3,
          color: C.gold, cursor: "pointer", fontFamily: T.code.fontFamily, fontSize: T.caption.fontSize, whiteSpace: "nowrap" }}
        onMouseEnter={e => e.currentTarget.style.background = `${C.gold}18`}
        onMouseLeave={e => e.currentTarget.style.background = "transparent"}>
        {label}
      </button>
      {open && (
        <div
          style={{ position: "absolute", top: "110%", left: 0, zIndex: 300, background: C.surface2,
            border: `1px solid ${C.border}`, borderRadius: 4, minWidth: 210, maxHeight: 200, overflowY: "auto",
            boxShadow: "0 6px 24px rgba(0,0,0,0.55)" }}
          onMouseLeave={() => setOpen(false)}>
          {hasJs.map(eq => (
            <div key={eq.id} onClick={() => { onLoad(eq.jsExpr); setOpen(false); }}
              style={{ padding: "0.4rem 0.75rem", cursor: "pointer", borderBottom: `1px solid ${C.border}` }}
              onMouseEnter={e => e.currentTarget.style.background = `${C.gold}15`}
              onMouseLeave={e => e.currentTarget.style.background = "transparent"}>
              <div style={{ fontFamily: T.code.fontFamily, fontSize: T.caption.fontSize, color: C.gold }}>{eq.name}</div>
              <div style={{ fontFamily: T.code.fontFamily, fontSize: T.caption.fontSize, color: C.textMuted, marginTop: 2 }}>{eq.jsExpr}</div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// ─── MATH PAD (LaTeX editor + KaTeX live preview + Overleaf export) ──────────
function MathPad({ C: _C, savedEqs, setSavedEqs, padJsExpr, setPadJsExpr, activeFieldRef }) {
  const { C, T } = useTheme();
  const [latex, setLatex] = useState("Y = A K^{\\alpha} L^{1-\\alpha}");
  const [katexLoaded, setKatexLoaded] = useState(typeof window !== "undefined" && !!window.katex);
  const [eqName, setEqName] = useState("");
  const [sendFlash, setSendFlash] = useState(false);
  // padJsExpr is now lifted: use padJsExpr / setPadJsExpr
  const [copied, setCopied] = useState(false);
  const taRef = useRef(null);

  useEffect(() => {
    if (window.katex) { setKatexLoaded(true); return; }
    const link = document.createElement("link");
    link.rel = "stylesheet";
    link.href = "https://cdn.jsdelivr.net/npm/katex@0.16.11/dist/katex.min.css";
    link.integrity = "sha384-nB0miv6/jRmo5UMMR1wu3Gz6NLsoTkbqJghGIsx//Rlm+ZU03BU6SQNC66uf4l5+";
    link.crossOrigin = "anonymous";
    document.head.appendChild(link);
    const script = document.createElement("script");
    script.src = "https://cdn.jsdelivr.net/npm/katex@0.16.11/dist/katex.min.js";
    script.integrity = "sha384-7zkQWkzuo3B5mTepMUcHkMB5jZaolc2xDwL6VFqjFALcbeS9Ggm/Yr2r3Dy4lfFg";
    script.crossOrigin = "anonymous";
    script.onload = () => setKatexLoaded(true);
    document.head.appendChild(script);
  }, []);

  const rendered = useMemo(() => {
    if (!katexLoaded || !window.katex || !latex.trim()) return { html: null, error: null };
    try {
      return { html: window.katex.renderToString(latex, { displayMode: true, throwOnError: true, trust: false }), error: null };
    } catch (e) { return { html: null, error: e.message }; }
  }, [latex, katexLoaded]);

  function insert(text) {
    const ta = taRef.current; if (!ta) return;
    const s = ta.selectionStart, e = ta.selectionEnd;
    setLatex(latex.slice(0, s) + text + latex.slice(e));
    setTimeout(() => { ta.selectionStart = ta.selectionEnd = s + text.length; ta.focus(); }, 0);
  }

  function copyLatex() {
    navigator.clipboard.writeText(`$$\n${latex}\n$$`).then(() => {
      setCopied(true); setTimeout(() => setCopied(false), 1500);
    });
  }
  function downloadTex() {
    download(`\\documentclass{article}\n\\usepackage{amsmath}\n\\begin{document}\n\n\\[\n${latex}\n\\]\n\n\\end{document}`, "equation.tex");
  }
  function openOverleaf() {
    const doc = `\\documentclass{article}\n\\usepackage{amsmath}\n\\begin{document}\n\n\\[\n${latex}\n\\]\n\n\\end{document}`;
    const form = document.createElement("form");
    form.method = "POST"; form.action = "https://www.overleaf.com/docs"; form.target = "_blank";
    const inp = document.createElement("input"); inp.type = "hidden"; inp.name = "snip"; inp.value = doc;
    form.appendChild(inp); document.body.appendChild(form); form.submit(); document.body.removeChild(form);
  }

  const GREEKS = [
    ["α","\\alpha"],["β","\\beta"],["γ","\\gamma"],["δ","\\delta"],["ε","\\epsilon"],
    ["ζ","\\zeta"],["η","\\eta"],["θ","\\theta"],["κ","\\kappa"],["λ","\\lambda"],
    ["μ","\\mu"],["ν","\\nu"],["ξ","\\xi"],["π","\\pi"],["ρ","\\rho"],
    ["σ","\\sigma"],["τ","\\tau"],["φ","\\phi"],["χ","\\chi"],["ψ","\\psi"],["ω","\\omega"],
    ["Γ","\\Gamma"],["Δ","\\Delta"],["Λ","\\Lambda"],["Σ","\\Sigma"],
    ["Π","\\Pi"],["Φ","\\Phi"],["Ψ","\\Psi"],["Ω","\\Omega"],
  ];
  const OPS = [
    ["a/b","\\frac{a}{b}"],["√","\\sqrt{x}"],["ⁿ√","\\sqrt[n]{x}"],["xⁿ","^{n}"],["xᵢ","_{i}"],
    ["∫","\\int_{a}^{b}"],["∂","\\partial"],["Σ","\\sum_{i=1}^{n}"],["Π","\\prod_{i=1}^{n}"],
    ["lim","\\lim_{x\\to 0}"],["log","\\log"],["ln","\\ln"],["exp","\\exp"],
    ["∞","\\infty"],["≤","\\leq"],["≥","\\geq"],["≠","\\neq"],["≈","\\approx"],
    ["±","\\pm"],["→","\\to"],["⇒","\\Rightarrow"],["∈","\\in"],["‖·‖","\\|\\cdot\\|"],
  ];
  const TEMPLATES = [
    ["Cobb-Douglas",   "Y = A K^{\\alpha} L^{1-\\alpha}"],
    ["Capital share",  "\\frac{1}{1-\\alpha}"],
    ["Solow k*",       "k^* = \\left(\\frac{sA}{\\delta+n+g}\\right)^{\\frac{1}{1-\\alpha}}"],
    ["Euler eq.",      "u'(c_t) = \\beta R_{t+1} u'(c_{t+1})"],
    ["Log utility",    "u(c) = \\frac{c^{1-\\sigma}-1}{1-\\sigma}"],
    ["NKPC",           "\\pi_t = \\beta E_t[\\pi_{t+1}] + \\kappa\\tilde{y}_t"],
    ["Taylor rule",    "i_t = r^* + \\phi_\\pi(\\pi_t-\\pi^*) + \\phi_y\\tilde{y}_t"],
    ["OLS",            "\\hat{\\beta} = (X'X)^{-1}X'y"],
    ["IV / 2SLS",      "\\hat{\\beta}_{IV} = (Z'X)^{-1}Z'y"],
    ["Fixed effects",  "y_{it} = \\alpha_i + \\beta x_{it} + \\varepsilon_{it}"],
    ["Log-log",        "\\ln y_i = \\beta_0 + \\beta_1 \\ln x_i + \\varepsilon_i"],
    ["Ramsey RESET",   "\\hat{u}_i^2 = \\gamma_0 + \\gamma_1 \\hat{y}_i^2 + \\gamma_2 \\hat{y}_i^3"],
  ];

  const ghost = { background: "transparent", border: `1px solid ${C.border2}`, borderRadius: 3, cursor: "pointer", fontFamily: T.code.fontFamily, transition: "all 0.1s" };

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>

      {/* ── Header ── */}
      <div>
        <div style={{ fontSize: T.caption.fontSize, color: C.teal, letterSpacing: "0.26em", textTransform: "uppercase", marginBottom: 3 }}>Math Pad</div>
        <div style={{ fontSize: T.h2.fontSize, color: C.text, letterSpacing: "-0.01em" }}>Equation Editor</div>
        <div style={{ fontSize: T.caption.fontSize, color: C.textMuted, marginTop: 4 }}>
          Write LaTeX — live KaTeX preview + export to Overleaf
        </div>
      </div>

      {/* ── Greek letters ── */}
      <div>
        <div style={{ fontSize: T.caption.fontSize, color: C.textMuted, letterSpacing: "0.16em", textTransform: "uppercase", marginBottom: 5 }}>Greek</div>
        <div style={{ display: "flex", flexWrap: "wrap", gap: 3 }}>
          {GREEKS.map(([sym, cmd]) => (
            <button key={cmd} onClick={() => insert(cmd)} title={cmd}
              style={{ ...ghost, width: 26, height: 24, color: C.gold, fontSize: T.body.fontSize, padding: 0 }}
              onMouseEnter={e => { e.currentTarget.style.borderColor = C.gold; e.currentTarget.style.background = `${C.gold}18`; }}
              onMouseLeave={e => { e.currentTarget.style.borderColor = C.border2; e.currentTarget.style.background = "transparent"; }}>
              {sym}
            </button>
          ))}
        </div>
      </div>

      {/* ── Operators ── */}
      <div>
        <div style={{ fontSize: T.caption.fontSize, color: C.textMuted, letterSpacing: "0.16em", textTransform: "uppercase", marginBottom: 5 }}>Operators & Structures</div>
        <div style={{ display: "flex", flexWrap: "wrap", gap: 3 }}>
          {OPS.map(([sym, cmd]) => (
            <button key={cmd} onClick={() => insert(cmd)} title={cmd}
              style={{ ...ghost, padding: "0 7px", height: 24, color: C.teal, fontSize: T.caption.fontSize, whiteSpace: "nowrap" }}
              onMouseEnter={e => { e.currentTarget.style.borderColor = C.teal; e.currentTarget.style.background = `${C.teal}18`; }}
              onMouseLeave={e => { e.currentTarget.style.borderColor = C.border2; e.currentTarget.style.background = "transparent"; }}>
              {sym}
            </button>
          ))}
        </div>
      </div>

      {/* ── LaTeX input ── */}
      <div>
        <div style={{ fontSize: T.caption.fontSize, color: C.textMuted, letterSpacing: "0.16em", textTransform: "uppercase", marginBottom: 5 }}>LaTeX Input</div>
        <textarea
          ref={taRef}
          value={latex}
          onChange={e => setLatex(e.target.value)}
          rows={4}
          style={{ ...fieldStyle(C, T), width: "100%", resize: "vertical", lineHeight: 1.65, boxSizing: "border-box" }}
          placeholder="\frac{1}{1-\alpha}"
          spellCheck={false}
        />
      </div>

      {/* ── Live preview ── */}
      <div>
        <div style={{ fontSize: T.caption.fontSize, color: C.textMuted, letterSpacing: "0.16em", textTransform: "uppercase", marginBottom: 5 }}>Preview</div>
        <div style={{ border: `1px solid ${C.border}`, borderRadius: 4, padding: "1.2rem 1.5rem", minHeight: 72, background: C.surface2, display: "flex", alignItems: "center", justifyContent: "center" }}>
          {!katexLoaded
            ? <span style={{ color: C.textMuted, fontSize: T.caption.fontSize }}>Loading KaTeX…</span>
            : !latex.trim()
              ? <span style={{ color: C.textMuted, fontSize: T.caption.fontSize, fontFamily: T.code.fontFamily }}>Enter LaTeX above to preview</span>
              : rendered.error
                ? <span style={{ color: C.red, fontSize: T.caption.fontSize, fontFamily: T.code.fontFamily, lineHeight: 1.5 }}>{rendered.error}</span>
                : <div dangerouslySetInnerHTML={{ __html: rendered.html }} style={{ color: C.text }} />
          }
        </div>
      </div>

      {/* ── JS expression + Send to field ── */}
      <div style={{ background: `${C.teal}0a`, border: `1px solid ${C.teal}25`, borderRadius: 4, padding: "0.7rem 0.85rem", display: "flex", flexDirection: "column", gap: 6 }}>
        <div style={{ fontSize: T.caption.fontSize, color: C.teal, letterSpacing: "0.16em", textTransform: "uppercase", marginBottom: 2 }}>JS Expression (for computation)</div>
        <input value={padJsExpr} onChange={e => setPadJsExpr(e.target.value)}
          placeholder="e.g. 1/(1-alpha)  or  A * K**alpha * L**(1-alpha)"
          style={{ ...fieldStyle(C, T), width: "100%", boxSizing: "border-box", borderColor: padJsExpr.trim() ? C.teal : C.border2 }} />
        <button
          onClick={() => {
            if (!padJsExpr.trim()) return;
            if (activeFieldRef?.current) {
              activeFieldRef.current(padJsExpr.trim());
              setSendFlash(true); setTimeout(() => setSendFlash(false), 1200);
            }
          }}
          style={{ ...ghost, padding: "0.3rem 0.8rem", fontSize: T.caption.fontSize,
            color: sendFlash ? C.bg : (padJsExpr.trim() && activeFieldRef?.current ? C.teal : C.textMuted),
            borderColor: sendFlash ? C.teal : (padJsExpr.trim() && activeFieldRef?.current ? C.teal : C.border2),
            background: sendFlash ? C.teal : "transparent",
            alignSelf: "flex-start" }}>
          {sendFlash ? "✓ Sent!" : "→ Send to focused field"}
        </button>
        <div style={{ fontSize: T.caption.fontSize, color: C.textMuted, lineHeight: 1.5 }}>
          Click any expression input on the left, then click "Send" to inject this JS expression into it.
        </div>
      </div>

      {/* ── Export row ── */}
      <div style={{ display: "flex", gap: 5, flexWrap: "wrap" }}>
        <button onClick={copyLatex}
          style={{ ...ghost, padding: "0.3rem 0.7rem", fontSize: T.caption.fontSize, color: copied ? C.teal : C.textDim, borderColor: copied ? C.teal : C.border2 }}
          onMouseEnter={e => { if (!copied) { e.currentTarget.style.borderColor = C.teal; e.currentTarget.style.color = C.teal; }}}
          onMouseLeave={e => { if (!copied) { e.currentTarget.style.borderColor = C.border2; e.currentTarget.style.color = C.textDim; }}}>
          {copied ? "✓ Copied!" : "Copy $$…$$"}
        </button>
        <button onClick={downloadTex}
          style={{ ...ghost, padding: "0.3rem 0.7rem", fontSize: T.caption.fontSize, color: C.textDim }}
          onMouseEnter={e => { e.currentTarget.style.borderColor = C.gold; e.currentTarget.style.color = C.gold; }}
          onMouseLeave={e => { e.currentTarget.style.borderColor = C.border2; e.currentTarget.style.color = C.textDim; }}>
          ↓ .tex
        </button>
        <button onClick={openOverleaf}
          style={{ ...ghost, padding: "0.3rem 0.7rem", fontSize: T.caption.fontSize, color: C.textDim }}
          onMouseEnter={e => { e.currentTarget.style.borderColor = C.green; e.currentTarget.style.color = C.green; }}
          onMouseLeave={e => { e.currentTarget.style.borderColor = C.border2; e.currentTarget.style.color = C.textDim; }}>
          Open in Overleaf ↗
        </button>
      </div>

      {/* ── Save equations ── */}
      <div>
        <div style={{ fontSize: T.caption.fontSize, color: C.textMuted, letterSpacing: "0.16em", textTransform: "uppercase", marginBottom: 6 }}>Saved Equations</div>
        <div style={{ display: "flex", flexDirection: "column", gap: 4, marginBottom: 6 }}>
          <div style={{ display: "flex", gap: 5 }}>
            <input value={eqName} onChange={e => setEqName(e.target.value)}
              placeholder="equation name"
              onKeyDown={e => { if (e.key === "Enter" && eqName.trim() && latex.trim()) { setSavedEqs(s => [...s, { id: Date.now(), name: eqName.trim(), latex, jsExpr: padJsExpr.trim() }]); setEqName(""); setPadJsExpr(""); } }}
              style={{ ...fieldStyle(C, T), flex: 1 }} />
            <Btn ch="Save" v="solid" color={C.gold} sm
              dis={!eqName.trim() || !latex.trim()}
              onClick={() => { setSavedEqs(s => [...s, { id: Date.now(), name: eqName.trim(), latex, jsExpr: padJsExpr.trim() }]); setEqName(""); setPadJsExpr(""); }} />
          </div>
        </div>
        <div style={{ display: "flex", flexDirection: "column", gap: 3 }}>
          {savedEqs.map(eq => (
            <div key={eq.id} style={{ display: "flex", alignItems: "center", gap: 6, padding: "0.3rem 0.6rem", background: C.surface2, borderRadius: 3, border: `1px solid ${C.border}` }}>
              <span style={{ fontFamily: T.code.fontFamily, fontSize: T.caption.fontSize, color: C.gold, minWidth: 90, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{eq.name}</span>
              <span style={{ fontFamily: T.code.fontFamily, fontSize: T.caption.fontSize, color: C.textMuted, flex: 1, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{eq.latex}</span>
              <button onClick={() => setLatex(eq.latex)}
                style={{ ...ghost, padding: "0.1rem 0.45rem", fontSize: T.caption.fontSize, color: C.teal, borderColor: C.teal }}
                onMouseEnter={e => e.currentTarget.style.background = `${C.teal}20`}
                onMouseLeave={e => e.currentTarget.style.background = "transparent"}>Load</button>
              <button onClick={() => setSavedEqs(s => s.filter(x => x.id !== eq.id))}
                style={{ background: "transparent", border: "none", color: C.textMuted, cursor: "pointer", fontFamily: T.code.fontFamily, fontSize: T.h2.fontSize }}
                onMouseEnter={e => e.currentTarget.style.color = C.red}
                onMouseLeave={e => e.currentTarget.style.color = C.textMuted}>×</button>
            </div>
          ))}
        </div>
      </div>

      {/* ── Macro / econometrics templates ── */}
      <div>
        <div style={{ fontSize: T.caption.fontSize, color: C.textMuted, letterSpacing: "0.16em", textTransform: "uppercase", marginBottom: 6 }}>Templates</div>
        <div style={{ display: "flex", flexWrap: "wrap", gap: 4 }}>
          {TEMPLATES.map(([name, tmpl]) => (
            <button key={name} onClick={() => setLatex(tmpl)}
              style={{ ...ghost, padding: "0.2rem 0.6rem", fontSize: T.caption.fontSize, color: C.textDim }}
              onMouseEnter={e => { e.currentTarget.style.borderColor = C.teal; e.currentTarget.style.color = C.teal; e.currentTarget.style.background = `${C.teal}10`; }}
              onMouseLeave={e => { e.currentTarget.style.borderColor = C.border2; e.currentTarget.style.color = C.textDim; e.currentTarget.style.background = "transparent"; }}>
              {name}
            </button>
          ))}
        </div>
      </div>

    </div>
  );
}

// ─── PROBABILITY CALCULATOR ───────────────────────────────────────────────────
const PROB_DISTS = [
  { id:"normal",  label:"Normal",      params:[{k:"μ",def:"0"},{k:"σ",def:"1"}],     cont:true  },
  { id:"t",       label:"t",           params:[{k:"df",def:"5"}],                    cont:true  },
  { id:"chisq",   label:"Chi-squared", params:[{k:"df",def:"3"}],                    cont:true  },
  { id:"binom",   label:"Binomial",    params:[{k:"n",def:"10"},{k:"p",def:"0.5"}],  cont:false },
  { id:"poisson", label:"Poisson",     params:[{k:"λ",def:"3"}],                     cont:false },
];
function _ppdf(dist, p, x) {
  switch(dist) {
    case "normal":  return dnorm(x, +(p.μ??0), +(p.σ??1));
    case "t":       return dt(x, +(p.df??5));
    case "chisq":   return dchisq(x, +(p.df??3));
    case "binom":   return dbinom(x, +(p.n??10), +(p.p??0.5));
    case "poisson": return dpois(x, +(p.λ??3));
    default: return 0;
  }
}
function _pcdf(dist, p, x) {
  switch(dist) {
    case "normal":  return pnorm(x, +(p.μ??0), +(p.σ??1));
    case "t":       return pt(x, +(p.df??5));
    case "chisq":   return pchisq(x, +(p.df??3));
    case "binom":   return pbinom(x, +(p.n??10), +(p.p??0.5));
    case "poisson": return ppois(x, +(p.λ??3));
    default: return 0;
  }
}
function _pquant(dist, p, prob) {
  switch(dist) {
    case "normal": return qnorm(prob, +(p.μ??0), +(p.σ??1));
    case "t":      return qt(prob, +(p.df??5));
    case "chisq":  return qchisq(prob, +(p.df??3));
    default: return null;
  }
}
function _prange(dist, p) {
  switch(dist) {
    case "normal":  { const μ=+(p.μ??0),σ=+(p.σ??1); return [μ-4*σ, μ+4*σ]; }
    case "t":       return [-6, 6];
    case "chisq":   { const d=+(p.df??3); return [0, Math.max(10, d+5*Math.sqrt(2*d))]; }
    case "binom":   return [0, +(p.n??10)];
    case "poisson": { const λ=+(p.λ??3); return [0, Math.max(10, λ+5*Math.sqrt(λ))]; }
    default: return [-4, 4];
  }
}

function ProbCalc() {
  const { C, T } = useTheme();
  const [dist,   setDistId2] = useState("normal");
  const [params, setParams]  = useState({ μ:"0", σ:"1" });
  const [mode,   setMode]    = useState("cdf");
  const [xVal,   setXVal]    = useState("1.96");
  const [aVal,   setAVal]    = useState("-1.96");
  const [bVal,   setBVal]    = useState("1.96");
  const [pVal,   setPVal]    = useState("0.975");

  const cfg    = PROB_DISTS.find(d=>d.id===dist);
  const isCont = cfg?.cont ?? true;

  function switchDist(id) {
    const c = PROB_DISTS.find(d=>d.id===id);
    setDistId2(id);
    const def = {};
    c.params.forEach(({k,def:v})=>{ def[k]=v; });
    setParams(def);
  }

  const result = useMemo(()=>{
    try {
      if (mode==="cdf") {
        const x=parseFloat(xVal); if(!isFinite(x)) return null;
        return { val:_pcdf(dist,params,x), label:`P(X ≤ ${x})` };
      } else if (mode==="pdf") {
        const x=parseFloat(xVal); if(!isFinite(x)) return null;
        return { val:_ppdf(dist,params,x), label:isCont?`f(${x})`:`P(X = ${Math.round(x)})` };
      } else if (mode==="between") {
        const a=parseFloat(aVal),b=parseFloat(bVal); if(!isFinite(a)||!isFinite(b)) return null;
        return { val:_pcdf(dist,params,b)-_pcdf(dist,params,a), label:`P(${a} ≤ X ≤ ${b})` };
      } else if (mode==="quantile") {
        const p=parseFloat(pVal); if(!isFinite(p)||p<=0||p>=1) return null;
        if(!isCont) return { val:null, label:"Quantile not available for discrete distributions" };
        const x=_pquant(dist,params,p);
        return { val:x, label:`Q(${p})` };
      }
    } catch { return null; }
    return null;
  },[dist,params,mode,xVal,aVal,bVal,pVal,isCont]);

  // Mini SVG
  const SVG_W=300, SVG_H=80, PL=4, PR=4, PT=8, PB=4;
  const CW=SVG_W-PL-PR, CH=SVG_H-PT-PB;
  const [rMin,rMax]=_prange(dist,params);
  const sx=v=>PL+(v-rMin)/(rMax-rMin)*CW;
  const svgContent=useMemo(()=>{
    const steps=isCont?120:Math.min(60,Math.round(rMax-rMin)+1);
    const pts=[]; let maxY=0;
    if(isCont){
      for(let i=0;i<=steps;i++){
        const x=rMin+(rMax-rMin)*i/steps;
        const y=_ppdf(dist,params,x);
        if(isFinite(y)&&y>=0){pts.push({x,y});maxY=Math.max(maxY,y);}
      }
    } else {
      for(let k=Math.round(rMin);k<=Math.round(rMax);k++){
        const y=_ppdf(dist,params,k);
        if(isFinite(y)){pts.push({x:k,y});maxY=Math.max(maxY,y);}
      }
    }
    if(!maxY) return null;
    const sy=v=>PT+CH-(v/maxY)*CH;
    if(isCont){
      const shadePts=[];
      const sa=mode==="between"?parseFloat(aVal):mode==="cdf"?rMin:null;
      const sb=mode==="between"?parseFloat(bVal):mode==="cdf"?parseFloat(xVal):null;
      if(sa!=null&&sb!=null&&isFinite(sa)&&isFinite(sb)){
        const ca=Math.max(rMin,sa),cb=Math.min(rMax,sb);
        if(ca<cb){
          shadePts.push(`M${sx(ca).toFixed(1)} ${sy(0).toFixed(1)}`);
          for(let i=0;i<=40;i++){const xv=ca+(cb-ca)*i/40;shadePts.push(`L${sx(xv).toFixed(1)} ${sy(_ppdf(dist,params,xv)).toFixed(1)}`);}
          shadePts.push(`L${sx(cb).toFixed(1)} ${sy(0).toFixed(1)}Z`);
        }
      }
      const path=pts.map((pt,i)=>`${i===0?"M":"L"}${sx(pt.x).toFixed(1)} ${sy(pt.y).toFixed(1)}`).join(" ");
      return { isCont:true, path, shade:shadePts.join(""), sy, maxY };
    } else {
      const bw=Math.max(2,CW/pts.length-2);
      return { isCont:false, pts, sy, maxY, bw };
    }
  },[dist,params,mode,xVal,aVal,bVal,rMin,rMax,isCont,CW,CH]);

  return (
    <div style={{ padding:"0.85rem" }}>
      {/* Distribution + params */}
      <div style={{ display:"flex", gap:8, flexWrap:"wrap", alignItems:"flex-end", marginBottom:10 }}>
        <label style={{ display:"flex", flexDirection:"column", gap:3 }}>
          <span style={{ fontSize: T.caption.fontSize, color:C.textMuted, fontFamily: T.code.fontFamily, letterSpacing:"0.14em", textTransform:"uppercase" }}>Distribution</span>
          <select value={dist} onChange={e=>switchDist(e.target.value)} style={{...fieldStyle(C, T),width:122}}>
            {PROB_DISTS.map(d=><option key={d.id} value={d.id}>{d.label}</option>)}
          </select>
        </label>
        {cfg?.params.map(({k})=>(
          <label key={k} style={{ display:"flex", flexDirection:"column", gap:3 }}>
            <span style={{ fontSize: T.caption.fontSize, color:C.textMuted, fontFamily: T.code.fontFamily, letterSpacing:"0.14em", textTransform:"uppercase" }}>{k}</span>
            <input value={params[k]??""} onChange={e=>setParams(p=>({...p,[k]:e.target.value}))}
              style={{...fieldStyle(C, T),width:68}}/>
          </label>
        ))}
      </div>
      {/* Mode tabs */}
      <div style={{ display:"flex", borderBottom:`1px solid ${C.border}`, marginBottom:10 }}>
        {[["cdf","P(X ≤ x)"],["pdf",isCont?"f(x)":"P(X=k)"],["between","P(a ≤ X ≤ b)"],["quantile","Quantile"]].map(([id,label])=>(
          <button key={id} onClick={()=>setMode(id)}
            style={{ padding:"0.28rem 0.6rem", background:"transparent", border:"none",
              borderBottom:mode===id?`2px solid ${C.teal}`:"2px solid transparent",
              color:mode===id?C.teal:C.textMuted,
              cursor:"pointer", fontFamily: T.code.fontFamily, fontSize: T.caption.fontSize, letterSpacing:"0.06em", transition:"all 0.1s" }}>
            {label}
          </button>
        ))}
      </div>
      {/* Inputs */}
      <div style={{ display:"flex", gap:10, alignItems:"center", marginBottom:10, flexWrap:"wrap" }}>
        {(mode==="cdf"||mode==="pdf") && (
          <label style={{ display:"flex", alignItems:"center", gap:6 }}>
            <span style={{ fontSize: T.caption.fontSize, color:C.textMuted, fontFamily: T.code.fontFamily }}>x =</span>
            <input value={xVal} onChange={e=>setXVal(e.target.value)} style={{...fieldStyle(C, T),width:100}}/>
          </label>
        )}
        {mode==="between" && <>
          <label style={{ display:"flex", alignItems:"center", gap:6 }}>
            <span style={{ fontSize: T.caption.fontSize, color:C.textMuted, fontFamily: T.code.fontFamily }}>a =</span>
            <input value={aVal} onChange={e=>setAVal(e.target.value)} style={{...fieldStyle(C, T),width:88}}/>
          </label>
          <label style={{ display:"flex", alignItems:"center", gap:6 }}>
            <span style={{ fontSize: T.caption.fontSize, color:C.textMuted, fontFamily: T.code.fontFamily }}>b =</span>
            <input value={bVal} onChange={e=>setBVal(e.target.value)} style={{...fieldStyle(C, T),width:88}}/>
          </label>
        </>}
        {mode==="quantile" && (
          <label style={{ display:"flex", alignItems:"center", gap:6 }}>
            <span style={{ fontSize: T.caption.fontSize, color:C.textMuted, fontFamily: T.code.fontFamily }}>p =</span>
            <input value={pVal} onChange={e=>setPVal(e.target.value)} style={{...fieldStyle(C, T),width:100}}/>
          </label>
        )}
      </div>
      {/* Result */}
      {result && (
        <div style={{ marginBottom:10, display:"flex", alignItems:"baseline", gap:10 }}>
          <span style={{ fontSize: T.caption.fontSize, color:C.textMuted, fontFamily: T.code.fontFamily }}>{result.label} =</span>
          {result.val!=null
            ? <span style={{ fontSize: T.h2.fontSize, color:C.teal, fontFamily: T.code.fontFamily }}>{result.val.toFixed(6)}</span>
            : <span style={{ fontSize: T.caption.fontSize, color:C.textMuted, fontFamily: T.code.fontFamily }}>{result.label}</span>}
        </div>
      )}
      {/* Mini curve */}
      {svgContent && (
        <svg width={SVG_W} height={SVG_H} style={{ display:"block", overflow:"visible" }}>
          {svgContent.isCont ? <>
            {svgContent.shade && <path d={svgContent.shade} fill={C.teal} opacity={0.22}/>}
            <path d={svgContent.path} fill="none" stroke={C.teal} strokeWidth={1.5}/>
            {(mode==="cdf"||mode==="pdf")&&isFinite(parseFloat(xVal))&&(
              <line x1={sx(parseFloat(xVal)).toFixed(1)} x2={sx(parseFloat(xVal)).toFixed(1)}
                y1={PT} y2={PT+CH} stroke={C.gold} strokeWidth={1} strokeDasharray="3,2"/>
            )}
          </> : <>
            {svgContent.pts.map(({x,y})=>{
              const bh=y/svgContent.maxY*CH;
              const hl=(mode==="between"&&x>=parseFloat(aVal)&&x<=parseFloat(bVal))
                     ||(mode==="cdf"&&x<=parseFloat(xVal))
                     ||(mode==="pdf"&&Math.round(x)===Math.round(parseFloat(xVal)));
              return <rect key={x} x={(sx(x)-svgContent.bw/2).toFixed(1)} y={(PT+CH-bh).toFixed(1)}
                width={svgContent.bw.toFixed(1)} height={bh.toFixed(1)}
                fill={hl?C.teal:C.border2} opacity={hl?0.8:0.45} rx={1}/>;
            })}
          </>}
          <line x1={PL} x2={PL+CW} y1={PT+CH} y2={PT+CH} stroke={C.border} strokeWidth={1}/>
        </svg>
      )}
    </div>
  );
}

// ─── SEEDED PRNG (mulberry32) ─────────────────────────────────────────────────
function mulberry32(seed) {
  let s = seed >>> 0;
  return () => {
    s += 0x6D2B79F5;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
function makeRNG(seed) {
  if (seed == null || seed === "") return () => Math.random();
  const s = parseInt(seed, 10);
  return isFinite(s) ? mulberry32(s) : () => Math.random();
}

// ─── PURE-JS RANDOM VARIATE GENERATORS ───────────────────────────────────────
function genNormal(mean, sd, n, rng) {
  const out = [];
  for (let i = 0; i < n; i++) {
    const u1 = Math.max(rng(), 1e-15), u2 = rng();
    const z = Math.sqrt(-2 * Math.log(u1)) * Math.cos(2 * Math.PI * u2);
    out.push(mean + sd * z);
  }
  return out;
}
function genUniform(min, max, n, rng) {
  const out = [];
  for (let i = 0; i < n; i++) out.push(min + (max - min) * rng());
  return out;
}
function genBinomial(trials, p, n, rng) {
  const out = [];
  for (let i = 0; i < n; i++) {
    let k = 0;
    for (let j = 0; j < trials; j++) if (rng() < p) k++;
    out.push(k);
  }
  return out;
}
function genPoisson(lambda, n, rng) {
  const L = Math.exp(-lambda);
  const out = [];
  for (let i = 0; i < n; i++) {
    let k = 0, pp = 1;
    do { k++; pp *= rng(); } while (pp > L);
    out.push(k - 1);
  }
  return out;
}
function genExponential(rate, n, rng) {
  const out = [];
  for (let i = 0; i < n; i++) out.push(-Math.log(Math.max(rng(), 1e-15)) / rate);
  return out;
}
function _genGammaMT(shape, scale, rng) {
  let sh = shape, boost = 1;
  if (sh < 1) { boost = rng() ** (1 / sh); sh += 1; }
  const d = sh - 1 / 3, c2 = 1 / Math.sqrt(9 * d);
  for (;;) {
    let x, v;
    do { x = (rng() * 2 - 1) * 3.4641; v = 1 + c2 * x; } while (v <= 0);
    v = v * v * v;
    const u = rng(), x2 = x * x;
    if (u < 1 - 0.0331 * x2 * x2) return d * v * scale * boost;
    if (Math.log(u) < 0.5 * x2 + d * (1 - v + Math.log(v))) return d * v * scale * boost;
  }
}
function genGamma(shape, scale, n, rng) {
  const out = [];
  for (let i = 0; i < n; i++) out.push(_genGammaMT(shape, scale, rng));
  return out;
}

function generateSamples(dist, params, n, seed) {
  const rng = makeRNG(seed);
  const N = Math.max(1, Math.min(100000, parseInt(n) || 100));
  switch (dist) {
    case "normal":      return genNormal(+params.mean, +params.sd, N, rng);
    case "uniform":     return genUniform(+params.min, +params.max, N, rng);
    case "binomial":    return genBinomial(+params.n, +params.p, N, rng);
    case "poisson":     return genPoisson(+params.lambda, N, rng);
    case "exponential": return genExponential(+params.rate, N, rng);
    case "gamma":       return genGamma(+params.shape, +params.scale, N, rng);
    default:            return [];
  }
}

const DIST_CONFIGS = {
  normal:     { label:"Normal",      params:[{k:"mean",def:"0"},{k:"sd",def:"1"}] },
  uniform:    { label:"Uniform",     params:[{k:"min",def:"0"},{k:"max",def:"1"}] },
  binomial:   { label:"Binomial",    params:[{k:"n",def:"10"},{k:"p",def:"0.5"}] },
  poisson:    { label:"Poisson",     params:[{k:"lambda",def:"1"}] },
  exponential:{ label:"Exponential", params:[{k:"rate",def:"1"}] },
  gamma:      { label:"Gamma",       params:[{k:"shape",def:"2"},{k:"scale",def:"1"}] },
};

// ─── MINI INLINE HISTOGRAM ────────────────────────────────────────────────────
function MiniHist({ values, color }) {
  const { C, T } = useTheme();
  const col = color ?? C.teal;
  if (!values?.length) return null;
  const W = 340, H = 72, PL = 6, PR = 6, PT = 6, PB = 14;
  let lo = Infinity, hi = -Infinity;
  for (const v of values) { if (v < lo) lo = v; if (v > hi) hi = v; }
  const span = hi - lo || 1;
  const NBINS = 28;
  const bw = span / NBINS;
  const counts = new Array(NBINS).fill(0);
  for (const v of values) counts[Math.min(NBINS - 1, Math.max(0, Math.floor((v - lo) / bw)))]++;
  const maxC = Math.max(...counts);
  const xp = v => PL + (W - PL - PR) * (v - lo) / span;
  const yp = c => H - PB - (H - PT - PB) * (c / maxC);
  const bwPx = (W - PL - PR) / NBINS;
  return (
    <svg width={W} height={H} style={{ display:"block", marginTop:4 }}>
      {counts.map((c, i) => (
        <rect key={i} x={PL + i*bwPx + 0.5} y={yp(c)} width={Math.max(0, bwPx - 1)}
          height={H - PB - yp(c)} fill={col} opacity={0.55}/>
      ))}
      <line x1={PL} x2={W - PR} y1={H - PB} y2={H - PB} stroke={C.border}/>
      <text x={PL} y={H - 2} fontSize={T.caption.fontSize} fontFamily={T.data.fontFamily} fill={C.textMuted}>{lo.toFixed(2)}</text>
      <text x={W - PR} y={H - 2} textAnchor="end" fontSize={T.caption.fontSize} fontFamily={T.data.fontFamily} fill={C.textMuted}>{hi.toFixed(2)}</text>
    </svg>
  );
}

// ─── D2 + D4: DISTRIBUTIONS SECTION ──────────────────────────────────────────
function DistributionsSection({ onAddColumn, onCreateDataset }) {
  const { C, T } = useTheme();
  const [open, setOpen]     = useState(false);
  const [dist, setDist]     = useState("normal");
  const [params, setParams] = useState({ mean:"0", sd:"1" });
  const [nSamples, setNSamples] = useState("100");
  const [seed, setSeed]     = useState("");
  const [colName, setColName] = useState("sample_1");
  const [generated, setGenerated] = useState(null);
  const [addedMsg, setAddedMsg]   = useState("");

  function switchDist(d) {
    setDist(d);
    const def = {};
    DIST_CONFIGS[d].params.forEach(({ k, def: v }) => { def[k] = v; });
    setParams(def);
    setGenerated(null);
  }

  function generate() {
    try {
      const values = generateSamples(dist, params, nSamples, seed || null);
      setGenerated({ values });
    } catch (e) {
      setGenerated({ error: e.message });
    }
  }

  function addToDataset() {
    if (!generated?.values || !colName.trim()) return;
    onAddColumn?.(colName.trim(), generated.values);
    setAddedMsg("Added!"); setTimeout(() => setAddedMsg(""), 1800);
  }

  function newDataset() {
    if (!generated?.values || !colName.trim()) return;
    const name = colName.trim();
    onCreateDataset?.(name + "_dataset", generated.values.map(v => ({ [name]: v })), [name]);
    setAddedMsg("Dataset created!"); setTimeout(() => setAddedMsg(""), 1800);
  }

  const cfg = DIST_CONFIGS[dist];

  return (
    <div style={{ border:`1px solid ${C.border}`, borderRadius:4, overflow:"hidden", marginBottom:"1.4rem" }}>
      <SectionHeader label="∿ Distributions" open={open} onToggle={() => setOpen(o => !o)} />
      {open && (
        <div style={{ padding:"0.85rem", background:C.surface, display:"flex", flexDirection:"column", gap:10 }}>
          <div style={{ display:"flex", gap:8, flexWrap:"wrap", alignItems:"flex-end" }}>
            <label style={{ display:"flex", flexDirection:"column", gap:3 }}>
              <span style={{ fontSize: T.caption.fontSize, color:C.textMuted, fontFamily: T.code.fontFamily, letterSpacing:"0.14em", textTransform:"uppercase" }}>Distribution</span>
              <select value={dist} onChange={e => switchDist(e.target.value)} style={{ ...fieldStyle(C, T), width:130 }}>
                {Object.entries(DIST_CONFIGS).map(([k, v]) => <option key={k} value={k}>{v.label}</option>)}
              </select>
            </label>
            {cfg.params.map(({ k }) => (
              <label key={k} style={{ display:"flex", flexDirection:"column", gap:3 }}>
                <span style={{ fontSize: T.caption.fontSize, color:C.textMuted, fontFamily: T.code.fontFamily, letterSpacing:"0.14em", textTransform:"uppercase" }}>{k}</span>
                <input type="number" step="any" value={params[k] ?? ""}
                  onChange={e => setParams(p => ({ ...p, [k]: e.target.value }))}
                  style={{ ...fieldStyle(C, T), width:72 }}/>
              </label>
            ))}
          </div>

          <div style={{ display:"flex", gap:8, flexWrap:"wrap", alignItems:"flex-end" }}>
            <label style={{ display:"flex", flexDirection:"column", gap:3 }}>
              <span style={{ fontSize: T.caption.fontSize, color:C.textMuted, fontFamily: T.code.fontFamily, letterSpacing:"0.14em", textTransform:"uppercase" }}>N samples</span>
              <input type="number" min={1} max={100000} step={1} value={nSamples}
                onChange={e => setNSamples(e.target.value)} style={{ ...fieldStyle(C, T), width:90 }}/>
            </label>
            <label style={{ display:"flex", flexDirection:"column", gap:3 }}>
              <span style={{ fontSize: T.caption.fontSize, color:C.textMuted, fontFamily: T.code.fontFamily, letterSpacing:"0.14em", textTransform:"uppercase" }}>Seed (optional)</span>
              <input type="number" step={1} value={seed} placeholder="random"
                onChange={e => setSeed(e.target.value)} style={{ ...fieldStyle(C, T), width:100 }}/>
            </label>
            <label style={{ display:"flex", flexDirection:"column", gap:3 }}>
              <span style={{ fontSize: T.caption.fontSize, color:C.textMuted, fontFamily: T.code.fontFamily, letterSpacing:"0.14em", textTransform:"uppercase" }}>Column name</span>
              <input value={colName} onChange={e => setColName(e.target.value)}
                style={{ ...fieldStyle(C, T), width:130 }}/>
            </label>
            <div style={{ alignSelf:"flex-end" }}>
              <Btn ch="Generate ▸" v="solid" color={C.teal} sm onClick={generate} dis={!colName.trim()}/>
            </div>
          </div>

          {generated?.error && <ErrBox msg={generated.error}/>}

          {generated?.values && (
            <ResultBox color={C.teal}>
              <div style={{ fontSize: T.caption.fontSize, color:C.textMuted, marginBottom:4 }}>
                Preview (first 5 of {generated.values.length}):&nbsp;
                <span style={{ color:C.teal }}>{generated.values.slice(0,5).map(v => Number(v).toFixed(4)).join(", ")}</span>
              </div>
              <div style={{ fontSize: T.caption.fontSize, color:C.textMuted, marginBottom:2 }}>
                mean = {(generated.values.reduce((a,b)=>a+b,0)/generated.values.length).toFixed(4)}
                {" · "}sd = {(() => { const m=generated.values.reduce((a,b)=>a+b,0)/generated.values.length; return Math.sqrt(generated.values.reduce((a,b)=>a+(b-m)**2,0)/generated.values.length).toFixed(4); })()}
              </div>
              <MiniHist values={generated.values}/>
            </ResultBox>
          )}

          {generated?.values && (
            <div style={{ display:"flex", gap:6, flexWrap:"wrap", alignItems:"center" }}>
              <Btn ch="Add to dataset" v="solid" color={C.gold} sm onClick={addToDataset}
                dis={!colName.trim() || !onAddColumn}/>
              <Btn ch="New dataset from this column" v="out" sm onClick={newDataset}
                dis={!colName.trim()}/>
              {addedMsg && <span style={{ fontFamily: T.code.fontFamily, fontSize: T.caption.fontSize, color:C.teal }}>{addedMsg}</span>}
              {!onAddColumn && (
                <span style={{ fontFamily: T.code.fontFamily, fontSize: T.caption.fontSize, color:C.textMuted }}>
                  (onAddColumn not wired — TODO in parent)
                </span>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// ─── D5: MONTE CARLO SECTION ──────────────────────────────────────────────────
function _buildMCScope(rng) {
  return {
    rnorm:  (n, mean, sd)     => { const _m=mean??0, _s=sd??1; return (n??1)===1 ? genNormal(_m,_s,1,rng)[0] : genNormal(_m,_s,n??1,rng); },
    runif:  (n, min, max)     => { const _mn=min??0, _mx=max??1; return (n??1)===1 ? genUniform(_mn,_mx,1,rng)[0] : genUniform(_mn,_mx,n??1,rng); },
    rbinom: (n, p, trials)    => { const _t=trials??1; return (n??1)===1 ? genBinomial(_t,p??0.5,1,rng)[0] : genBinomial(_t,p??0.5,n??1,rng); },
    rpois:  (lambda, n)       => (n??1)===1 ? genPoisson(lambda??1,1,rng)[0] : genPoisson(lambda??1,n??1,rng),
    rexp:   (rate, n)         => (n??1)===1 ? genExponential(rate??1,1,rng)[0] : genExponential(rate??1,n??1,rng),
    rgamma: (shape, scale, n) => (n??1)===1 ? _genGammaMT(shape??2,scale??1,rng) : genGamma(shape??2,scale??1,n??1,rng),
  };
}

function MonteCarloSection({ onAddColumn, onCreateDataset }) {
  const { C, T } = useTheme();
  const [open, setOpen]         = useState(false);
  const [expr, setExpr]         = useState("rnorm(1) * 2 + runif(1)");
  const [nRep, setNRep]         = useState("1000");
  const [seed, setSeed]         = useState("");
  const [result, setResult]     = useState(null);
  const [busy, setBusy]         = useState(false);
  const [addedMsg, setAddedMsg] = useState("");
  const [resColName, setResColName] = useState("mc_result");

  function run() {
    const N = Math.max(1, Math.min(10000, parseInt(nRep) || 1000));
    setBusy(true); setResult(null);
    setTimeout(() => {
      try {
        const rng = makeRNG(seed || null);
        const sc = _buildMCScope(rng);
        const values = [];
        for (let i = 0; i < N; i++) {
          const { value, error } = evalExpression(expr, sc);
          if (error) throw new Error(`Expression error: ${error}`);
          if (typeof value !== "number" || !isFinite(value))
            throw new Error(`Expression returned ${value} on iteration ${i+1}. Must evaluate to a finite number.`);
          values.push(value);
        }
        const sorted = [...values].sort((a, b) => a - b);
        const mean = values.reduce((a, b) => a + b, 0) / N;
        const sd = Math.sqrt(values.reduce((a, b) => a + (b - mean) ** 2, 0) / N);
        setResult({ values: sorted, mean, sd, p025: sorted[Math.floor(0.025*N)], p975: sorted[Math.min(N-1, Math.floor(0.975*N))], N });
      } catch (e) {
        setResult({ error: e.message });
      } finally {
        setBusy(false);
      }
    }, 0);
  }

  function addResults() {
    if (!result?.values || !resColName.trim()) return;
    onAddColumn?.(resColName.trim(), result.values);
    setAddedMsg("Added!"); setTimeout(() => setAddedMsg(""), 1800);
  }

  function newDataset() {
    if (!result?.values || !resColName.trim()) return;
    const name = resColName.trim();
    onCreateDataset?.(name + "_mc", result.values.map(v => ({ [name]: v })), [name]);
    setAddedMsg("Dataset created!"); setTimeout(() => setAddedMsg(""), 1800);
  }

  return (
    <div style={{ border:`1px solid ${C.border}`, borderRadius:4, overflow:"hidden", marginBottom:"1.4rem" }}>
      <SectionHeader label="⊡ Monte Carlo" open={open} onToggle={() => setOpen(o => !o)} />
      {open && (
        <div style={{ padding:"0.85rem", background:C.surface, display:"flex", flexDirection:"column", gap:10 }}>
          <div style={{ fontSize: T.caption.fontSize, color:C.textMuted, lineHeight:1.65 }}>
            Expression evaluated N times. Scope:&nbsp;
            <span style={{ color:C.teal }}>rnorm(n,mean,sd)</span>&nbsp;
            <span style={{ color:C.teal }}>runif(n,min,max)</span>&nbsp;
            <span style={{ color:C.teal }}>rbinom(n,p,trials)</span>&nbsp;
            <span style={{ color:C.teal }}>rpois(lambda,n)</span>&nbsp;
            <span style={{ color:C.teal }}>rexp(rate,n)</span>&nbsp;
            <span style={{ color:C.teal }}>rgamma(shape,scale,n)</span>.
            Each returns a single draw when n=1 (default).
          </div>

          <div style={{ display:"flex", flexDirection:"column", gap:4 }}>
            <span style={{ fontSize: T.caption.fontSize, color:C.textMuted, fontFamily: T.code.fontFamily, letterSpacing:"0.14em", textTransform:"uppercase" }}>Expression (returns a number each iteration)</span>
            <textarea rows={2} value={expr} onChange={e => { setExpr(e.target.value); setResult(null); }}
              placeholder="rnorm(1) * 2 + runif(1)"
              style={{ ...fieldStyle(C, T), resize:"vertical", lineHeight:1.65, width:"100%", boxSizing:"border-box" }}
              spellCheck={false}/>
          </div>

          <div style={{ display:"flex", gap:8, flexWrap:"wrap", alignItems:"flex-end" }}>
            <label style={{ display:"flex", flexDirection:"column", gap:3 }}>
              <span style={{ fontSize: T.caption.fontSize, color:C.textMuted, fontFamily: T.code.fontFamily, letterSpacing:"0.14em", textTransform:"uppercase" }}>Repetitions (max 10000)</span>
              <input type="number" min={1} max={10000} step={100} value={nRep}
                onChange={e => setNRep(e.target.value)} style={{ ...fieldStyle(C, T), width:120 }}/>
            </label>
            <label style={{ display:"flex", flexDirection:"column", gap:3 }}>
              <span style={{ fontSize: T.caption.fontSize, color:C.textMuted, fontFamily: T.code.fontFamily, letterSpacing:"0.14em", textTransform:"uppercase" }}>Seed (optional)</span>
              <input type="number" step={1} value={seed} placeholder="random"
                onChange={e => setSeed(e.target.value)} style={{ ...fieldStyle(C, T), width:100 }}/>
            </label>
            <div style={{ alignSelf:"flex-end" }}>
              <Btn ch={busy ? "Running…" : "Run ▸"} v="solid" color={C.teal} sm
                onClick={run} dis={busy || !expr.trim()}/>
            </div>
          </div>

          <div style={{ display:"flex", gap:5, flexWrap:"wrap" }}>
            {[
              ["rnorm(1) * 2 + runif(1)", "Normal + Uniform"],
              ["rnorm(1) > 0 ? 1 : 0", "Bernoulli indicator"],
              ["rpois(3)", "Poisson(3) draw"],
              ["Math.max(rnorm(1), 0)", "Truncated normal"],
            ].map(([ex, label]) => (
              <button key={ex} onClick={() => { setExpr(ex); setResult(null); }}
                style={{ padding:"0.18rem 0.5rem", background:"transparent", border:`1px solid ${C.border2}`, borderRadius:3, color:C.textDim, cursor:"pointer", fontFamily: T.code.fontFamily, fontSize: T.caption.fontSize }}
                onMouseEnter={e => { e.currentTarget.style.borderColor=C.teal; e.currentTarget.style.color=C.teal; }}
                onMouseLeave={e => { e.currentTarget.style.borderColor=C.border2; e.currentTarget.style.color=C.textDim; }}>
                {label}
              </button>
            ))}
          </div>

          {result?.error && <ErrBox msg={result.error}/>}

          {result && !result.error && (
            <>
              <ResultBox color={C.teal}>
                <div>N = {result.N}</div>
                <div>mean  = <span style={{ color:C.teal }}>{result.mean.toFixed(6)}</span></div>
                <div>SD    = {result.sd.toFixed(6)}</div>
                <div>2.5%  = {result.p025.toFixed(6)}</div>
                <div>97.5% = {result.p975.toFixed(6)}</div>
              </ResultBox>
              <MiniHist values={result.values} color={C.blue}/>
              <div style={{ display:"flex", gap:8, flexWrap:"wrap", alignItems:"flex-end", marginTop:2 }}>
                <label style={{ display:"flex", flexDirection:"column", gap:3 }}>
                  <span style={{ fontSize: T.caption.fontSize, color:C.textMuted, fontFamily: T.code.fontFamily, letterSpacing:"0.14em", textTransform:"uppercase" }}>Column name</span>
                  <input value={resColName} onChange={e => setResColName(e.target.value)}
                    style={{ ...fieldStyle(C, T), width:130 }}/>
                </label>
                <div style={{ alignSelf:"flex-end", display:"flex", gap:6 }}>
                  <Btn ch="Add to dataset" v="solid" color={C.gold} sm onClick={addResults}
                    dis={!resColName.trim() || !onAddColumn}/>
                  <Btn ch="New dataset" v="out" sm onClick={newDataset}
                    dis={!resColName.trim()}/>
                  {addedMsg && <span style={{ fontFamily: T.code.fontFamily, fontSize: T.caption.fontSize, color:C.teal }}>{addedMsg}</span>}
                </div>
              </div>
              {!onAddColumn && (
                <span style={{ fontFamily: T.code.fontFamily, fontSize: T.caption.fontSize, color:C.textMuted }}>
                  (onAddColumn not wired — TODO in parent)
                </span>
              )}
            </>
          )}
        </div>
      )}
    </div>
  );
}

// ─── MAIN COMPONENT ───────────────────────────────────────────────────────────
export default function CalculateTab({ pid, rows = [], headers = [], onAddDataset, onAddColumn, onCreateDataset }) {
  const { C, T } = useTheme();
  const { appendLog } = useSessionLog();
  // ── Variable workspace ─────────────────────────────────────────────────────
  const [variables,    setVariables]   = useState([]);
  const [computeds,    setComputeds]   = useState([]);
  const [newName,      setNewName]     = useState("");
  const [newType,      setNewType]     = useState("Float");
  const [newValue,     setNewValue]    = useState("");
  const [nameErr,      setNameErr]     = useState("");
  const [computedOpen, setComputedOpen] = useState(true);
  const [datasetForm,  setDatasetForm] = useState(null);
  const [newCName,     setNewCName]    = useState("");
  const [newCFn,       setNewCFn]      = useState("mean");
  const [newCCol,      setNewCCol]     = useState("");

  // ── Resampling & permutation inference ────────────────────────────────────
  // mode: "boot" (with replacement) | "subsample" (without replacement) | "perm" (two-sample)
  const [rsOpen,    setRsOpen]    = useState(false);
  const [rsMode,    setRsMode]    = useState("boot");
  const [rsCol,     setRsCol]     = useState("");
  const [rsGroupCol,setRsGroupCol]= useState("");
  const [rsLevelA,  setRsLevelA]  = useState("");
  const [rsLevelB,  setRsLevelB]  = useState("");
  const [rsB,       setRsB]       = useState(2000);
  const [rsM,       setRsM]       = useState(0); // subsample size, 0 → auto = ⌊n/2⌋
  const [rsResult,  setRsResult]  = useState(null);
  const [rsBusy,    setRsBusy]    = useState(false);

  // ── Math Pad bridge: lifted JS expression + active field ref ─────────────
  const [padJsExpr,    setPadJsExpr]   = useState("");
  const activeFieldRef = useRef(null); // holds setter fn of the last focused expression input
  function focusField(setter) { activeFieldRef.current = setter; }

  // ── Active tool + grapher ─────────────────────────────────────────────────
  const [activeTool,   setActiveTool]  = useState("solver"); // "solver"|"derivative"|"symbolic"|"algebra"|"integral"|"limit"
  const [probOpen,     setProbOpen]    = useState(false);

  // ── Equation solver ────────────────────────────────────────────────────────
  const [solverMode,   setSolverMode]  = useState("single"); // "single" | "algebraic" | "system"
  const [solExpr,      setSolExpr]     = useState("x**2 - 4");
  const [solResult,    setSolResult]   = useState(null);
  const [algSolveExpr, setAlgSolveExpr] = useState("p = a - b*q");
  const [algSolveVar,  setAlgSolveVar]  = useState("q");
  const [algSolveResult, setAlgSolveResult] = useState(null);
  // System solver state
  const [sysVarStr,     setSysVarStr]    = useState("x, y");
  const [sysGuesses,    setSysGuesses]   = useState({ x: "1", y: "1" });
  const [sysEqs,        setSysEqs]       = useState(["x + y - 3", "x - y - 1"]);
  const [sysResult,     setSysResult]    = useState(null);
  const [sysParamVals,  setSysParamVals] = useState({});
  const [sysShowGuesses,setSysShowGuesses] = useState(false);
  const [sysLive,       setSysLive]       = useState(false);

  // Slider form state
  const [newSliderMin,  setNewSliderMin]  = useState("0");
  const [newSliderMax,  setNewSliderMax]  = useState("10");
  const [newSliderStep, setNewSliderStep] = useState("0.1");


  // ── Derivatives ───────────────────────────────────────────────────────────
  const [dExpr,        setDExpr]       = useState("x**3 + 2*x");
  const [dVar,         setDVar]        = useState("x");
  const [dPoint,       setDPoint]      = useState("2");
  const [dOrder,       setDOrder]      = useState("1");
  const [dResult,      setDResult]     = useState(null);

  // ── Limit ────────────────────────────────────────────────────────────────
  const [lExpr,        setLExpr]       = useState("sin(x)/x");
  const [lVar,         setLVar]        = useState("x");
  const [lPoint,       setLPoint]      = useState("0");
  const [lResult,      setLResult]     = useState(null);

  // ── Integral ─────────────────────────────────────────────────────────────
  const [intExpr,      setIntExpr]     = useState("x**2");
  const [intVar,       setIntVar]      = useState("x");
  const [intA,         setIntA]        = useState("0");
  const [intB,         setIntB]        = useState("1");
  const [intResult,    setIntResult]   = useState(null);

  // ── Symbolic derivative ───────────────────────────────────────────────────
  const [symbExpr,     setSymbExpr]    = useState("p(q)*q - c(q)");
  const [symbVar,      setSymbVar]     = useState("q");
  const [symbResult,   setSymbResult]  = useState(null);

  // ── Algebraic equation pad ────────────────────────────────────────────────
  const [algEqs,       setAlgEqs]      = useState([
    { id: 1, name: "TR",   expr: "p(q)*q" },
    { id: 2, name: "TC",   expr: "FC + c(q)" },
    { id: 3, name: "π",    expr: "p(q)*q - FC - c(q)" },
  ]);
  const [algVar,       setAlgVar]      = useState("q");
  const [algDeriv,     setAlgDeriv]    = useState({});  // { id: string result }
  const [algNewName,   setAlgNewName]  = useState("");
  const [algNewExpr,   setAlgNewExpr]  = useState("");

  // FOC (Lagrangian optimization) state
  const [deriveMode,   setDeriveMode]  = useState("single"); // "single" | "focs"
  const [focExpr,      setFocExpr]     = useState("sqrt(x_1) + x_2 - lambda*(p_1*x_1 + p_2*x_2 - m)");
  const [focVars,      setFocVars]     = useState(["x_1", "x_2", "lambda"]);
  const [focVarInput,  setFocVarInput] = useState("");
  const [focResults,   setFocResults]  = useState(null);
  const [focCopied,    setFocCopied]   = useState(false);

  // ── Shared equation library (Math Pad ↔ all sections) ───────────────────────
  const [savedEqs, setSavedEqs] = useState([
    { id: 1, name: "Cobb-Douglas",  latex: "Y = A K^{\\alpha} L^{1-\\alpha}", jsExpr: "A * K**alpha * L**(1-alpha)" },
    { id: 2, name: "Capital share", latex: "\\frac{1}{1-\\alpha}",             jsExpr: "1/(1-alpha)" },
    { id: 3, name: "Solow k*",      latex: "k^* = \\left(\\frac{sA}{\\delta+n+g}\\right)^{\\frac{1}{1-\\alpha}}", jsExpr: "(s*A/(delta+n+g))**(1/(1-alpha))" },
    { id: 4, name: "Euler eq.",     latex: "u'(c_t) = \\beta R_{t+1} u'(c_{t+1})", jsExpr: "" },
  ]);

  const NAME_RE = /^[a-zA-Z_][a-zA-Z0-9_]*$/;
  const numericHeaders = headers.filter(h => rows.some(r => !isNaN(Number(r[h])) && r[h] !== null && r[h] !== ""));
  const allNames = () => [...variables.map(v => v.name), ...computeds.map(c => c.name)];

  // Live expression scope: numeric variables only
  const scope = useMemo(() => buildScope(variables), [variables]);

  // Evaluate expression variables whenever scope changes
  const evaluatedVars = useMemo(() => variables.map(v => {
    if (v.type !== "Expression") return v;
    const { value, error } = evalExpression(v.rawValue, scope);
    return { ...v, computed: error ? null : value, evalError: error };
  }), [variables, scope]);

  // Live re-solve: re-runs solver whenever scope or params change while live mode is on
  useEffect(() => {
    if (!sysLive) return;
    const varNames = sysVarStr.split(",").map(s => s.trim()).filter(Boolean);
    if (varNames.length < 2) return;
    if (sysEqs.filter(e => e.trim()).length < varNames.length) return;
    const x0 = varNames.map(n => parseFloat(sysGuesses[n] ?? "1") || 1);
    try {
      const extScope = { ...scope };
      Object.entries(sysParamVals).forEach(([k, v]) => {
        const n = parseFloat(v); if (isFinite(n)) extScope[k] = n;
      });
      const fns = sysEqs.map(expr => xVec => {
        const fn = new Function(...varNames, ...Object.keys(extScope), `"use strict"; return (${expr});`);
        return fn(...xVec, ...Object.values(extScope));
      });
      setSysResult({ ...solveSystem(fns, x0), varNames });
    } catch (e) {
      setSysResult({ error: `Expression error: ${e.message}` });
    }
  }, [scope, sysParamVals, sysLive, sysVarStr, sysEqs, sysGuesses]); // eslint-disable-line react-hooks/exhaustive-deps

  // ── Handlers ──────────────────────────────────────────────────────────────
  function addVariable() {
    const n = newName.trim();
    if (!NAME_RE.test(n)) { setNameErr("Alphanumeric + underscore, no spaces."); return; }
    if (allNames().includes(n)) { setNameErr("Name already used."); return; }
    setNameErr("");
    const base = { id: Date.now(), name: n, type: newType, rawValue: newValue || defaultVal(newType) };
    if (newType === "Slider") {
      const min  = parseFloat(newSliderMin)  || 0;
      const max  = parseFloat(newSliderMax)  || 10;
      const step = parseFloat(newSliderStep) || 0.1;
      const val  = Math.min(max, Math.max(min, parseFloat(newValue) || 1));
      Object.assign(base, { rawValue: String(val), sliderMin: String(min), sliderMax: String(max), sliderStep: String(step) });
    }
    setVariables(vs => [...vs, base]);
    appendLog({ module: "calculate", opType: "add_variable", params: { name: n, type: newType, value: newValue || defaultVal(newType) }, label: `Variable ${n} = ${newValue || defaultVal(newType)} (${newType})` });
    setNewName(""); setNewValue("");
  }
  function addComputed() {
    const n = newCName.trim(); const col = newCCol || numericHeaders[0];
    if (!n || !NAME_RE.test(n) || allNames().includes(n) || !col) return;
    setComputeds(cs => [...cs, { id: Date.now(), name: n, fn: newCFn, col }]);
    setNewCName("");
  }
  function buildDataset() {
    if (!datasetForm) return;
    const { name, selectedVars } = datasetForm;
    if (!name.trim() || !selectedVars.length) return;
    const vectors = selectedVars.map(vname => ({ name: vname, vals: variables.find(x => x.name === vname).rawValue.split(",").map(s => s.trim()).filter(Boolean) }));
    const nRows = Math.max(...vectors.map(v => v.vals.length), 1);
    const hdrs = vectors.map(v => v.name);
    const newRows = Array.from({ length: nRows }, (_, i) => { const obj = {}; vectors.forEach(v => { obj[v.name] = v.vals[i] ?? null; }); return obj; });
    onAddDataset?.(name.trim(), newRows, hdrs);
    setDatasetForm(null);
  }

  // ── Equation solver ────────────────────────────────────────────────────────
  function runSolver() {
    try {
      // Support both "f(x) = 0" form and "LHS = RHS" form
      const eqStr = solExpr.trim();
      let jsExpr;
      const eqIdx = eqStr.indexOf("=");
      if (eqIdx !== -1 && !["!","<",">","="].includes(eqStr[eqIdx - 1])) {
        const lhs = eqStr.slice(0, eqIdx).trim();
        const rhs = eqStr.slice(eqIdx + 1).trim();
        jsExpr = `(${lhs}) - (${rhs})`;
      } else {
        jsExpr = eqStr;
      }
      const fn = new Function("x", ...Object.keys(scope), `"use strict"; return (${jsExpr});`);
      const wrappedFn = x => fn(x, ...Object.values(scope));
      setSolResult(solveRootAuto(wrappedFn));
    } catch (e) { setSolResult({ error: `Expression error: ${e.message}` }); }
  }

  // ── Integral ────────────────────────────────────────────────────────────────
  function runAlgebraicSolver() {
    setAlgSolveResult(solveAlgebraicEquation(algSolveExpr, algSolveVar));
  }

  function runIntegral() {
    try {
      const a = parseFloat(intA), b = parseFloat(intB);
      if (!isFinite(a) || !isFinite(b)) { setIntResult({ error: "Bounds must be finite numbers." }); return; }
      const varName = intVar.trim() || "x";
      const fn = new Function(varName, ...Object.keys(scope), `"use strict"; return (${intExpr});`);
      const wrappedFn = t => { try { const y = fn(t, ...Object.values(scope)); return Number.isFinite(y) ? y : NaN; } catch(e) { return NaN; } };
      setIntResult(integrate(wrappedFn, a, b));
    } catch (e) { setIntResult({ error: `Expression error: ${e.message}` }); }
  }

  // ── System solver ─────────────────────────────────────────────────────────
  // Detect variable names in equations that are not unknowns and not in scope
  function detectSysParams(eqs, varNames, scope) {
    const found = new Set();
    const re = /\b([a-zA-Z_][a-zA-Z0-9_]*)\b/g;
    eqs.forEach(eq => { let m; re.lastIndex = 0; while ((m = re.exec(eq)) !== null) found.add(m[1]); });
    const known = new Set([...varNames, ...Object.keys(scope),
      'true','false','null','undefined','NaN','Infinity','return','let','const','var']);
    return [...found].filter(id => !known.has(id));
  }

  function runSystem() {
    const varNames = sysVarStr.split(",").map(s => s.trim()).filter(Boolean);
    if (varNames.length < 2) { setSysResult({ error: "Define at least 2 unknowns (comma-separated)." }); return; }
    if (sysEqs.length < varNames.length) { setSysResult({ error: `Need at least ${varNames.length} equations for ${varNames.length} unknowns.` }); return; }
    const x0 = varNames.map(n => parseFloat(sysGuesses[n] ?? "1") || 1);
    try {
      // Merge scope with any inline parameter values
      const extScope = { ...scope };
      Object.entries(sysParamVals).forEach(([k, v]) => {
        const n = parseFloat(v);
        if (isFinite(n)) extScope[k] = n;
      });
      const fns = sysEqs.map(expr => xVec => {
        const fn = new Function(...varNames, ...Object.keys(extScope), `"use strict"; return (${expr});`);
        return fn(...xVec, ...Object.values(extScope));
      });
      const result = solveSystem(fns, x0);
      setSysResult({ ...result, varNames });
    } catch (e) {
      setSysResult({ error: `Expression error: ${e.message}` });
    }
  }

  // ── Derivatives ───────────────────────────────────────────────────────────
  function runDerivative() {
    try {
      const x0 = parseFloat(dPoint); const n = parseInt(dOrder) || 1;
      if (!isFinite(x0)) { setDResult({ error: "Point must be a number." }); return; }
      const varName = dVar.trim() || "x";
      const fn = new Function(varName, ...Object.keys(scope), `"use strict"; return (${dExpr});`);
      const wrappedFn = x => fn(x, ...Object.values(scope));
      const val  = wrappedFn(x0);
      const d1   = n >= 1 ? derivative(wrappedFn, x0) : null;
      const dn   = n > 1  ? nthDerivative(wrappedFn, x0, n) : null;
      setDResult({ val, d1, dn, n, x0, varName });
    } catch (e) { setDResult({ error: `Expression error: ${e.message}` }); }
  }

  // ── Limit ─────────────────────────────────────────────────────────────────
  function parseLimitPoint(raw) {
    const s = raw.trim().toLowerCase();
    if (s === "inf" || s === "infinity" || s === "+inf" || s === "+infinity") return Infinity;
    if (s === "-inf" || s === "-infinity") return -Infinity;
    const n = parseFloat(raw);
    return isFinite(n) ? n : null; // null = invalid, same signal dPoint's isFinite check uses
  }

  function runLimit() {
    try {
      const a = parseLimitPoint(lPoint);
      if (a === null) { setLResult({ error: "Point must be a number, or inf / -inf." }); return; }
      const varName = lVar.trim() || "x";
      // Same compilation technique as runDerivative, guarded by the shared
      // expression denylist (exprGuard is the single source of truth — §10.1).
      assertSafeExpr(lExpr);
      const fn = new Function(varName, ...Object.keys(scope), `"use strict"; return (${lExpr});`);
      const wrappedFn = x => fn(x, ...Object.values(scope));
      setLResult({ ...limit(wrappedFn, a), varName });
    } catch (e) { setLResult({ error: `Expression error: ${e.message}` }); }
  }

  // Inline-editable variable row
  function VarRow({ v }) {
    const ev = evaluatedVars.find(x => x.id === v.id) ?? v;
    const [editing, setEditing] = useState(false);
    const [editVal, setEditVal] = useState(v.rawValue);
    const [editingBounds, setEditingBounds] = useState(false);
    const [boundsForm, setBoundsForm] = useState({ min: v.sliderMin ?? "0", max: v.sliderMax ?? "10", step: v.sliderStep ?? "0.1" });
    function save() { setVariables(vs => vs.map(x => x.id === v.id ? { ...x, rawValue: editVal } : x)); setEditing(false); }
    function saveBounds() {
      setVariables(vs => vs.map(x => x.id === v.id ? { ...x, sliderMin: boundsForm.min, sliderMax: boundsForm.max, sliderStep: boundsForm.step } : x));
      setEditingBounds(false);
    }

    // Slider type: special row with range input
    if (v.type === "Slider") {
      const val  = parseFloat(v.rawValue)   || 0;
      const min  = parseFloat(v.sliderMin  ?? "0");
      const max  = parseFloat(v.sliderMax  ?? "10");
      const step = parseFloat(v.sliderStep ?? "0.1");
      return (
        <tr>
          <td style={tdStyle(C)}><span style={{ fontFamily: T.code.fontFamily, fontSize: T.code.fontSize, color: C.text }}>{v.name}</span></td>
          <td style={tdStyle(C)}><span style={{ fontSize: T.caption.fontSize, padding: "2px 6px", border: `1px solid ${C.teal}`, color: C.teal, borderRadius: 2, fontFamily: T.code.fontFamily }}>Slider</span></td>
          <td style={{ ...tdStyle(C), maxWidth: 340 }}>
            {editingBounds
              ? <span style={{ display: "flex", gap: 5, alignItems: "center", flexWrap: "wrap" }}>
                  {["min","max","step"].map(k => (
                    <span key={k} style={{ display: "flex", flexDirection: "column", gap: 2 }}>
                      <span style={{ fontSize: T.caption.fontSize, color: C.textMuted, fontFamily: T.code.fontFamily }}>{k}</span>
                      <input type="number" step="any" value={boundsForm[k]}
                        onChange={e => setBoundsForm(f => ({ ...f, [k]: e.target.value }))}
                        style={{ ...fieldStyle(C, T), width: 60 }} />
                    </span>
                  ))}
                  <Btn ch="✓" sm v="ghost" color={C.teal} onClick={saveBounds} />
                  <Btn ch="✕" sm v="ghost" color={C.textMuted} onClick={() => setEditingBounds(false)} />
                </span>
              : <span style={{ display: "flex", gap: 8, alignItems: "center" }}>
                  <span style={{ fontSize: T.caption.fontSize, color: C.textMuted, fontFamily: T.code.fontFamily, minWidth: 28 }}>{min}</span>
                  <input type="range" min={min} max={max} step={step} value={val}
                    onChange={e => setVariables(vs => vs.map(x => x.id === v.id ? { ...x, rawValue: e.target.value } : x))}
                    style={{ flex: 1, accentColor: C.teal, cursor: "pointer" }} />
                  <span style={{ fontSize: T.caption.fontSize, color: C.textMuted, fontFamily: T.code.fontFamily, minWidth: 28, textAlign: "right" }}>{max}</span>
                  <span style={{ fontFamily: T.code.fontFamily, fontSize: T.code.fontSize, color: C.teal, minWidth: 44, textAlign: "right" }}>{val}</span>
                  <button onClick={() => { setBoundsForm({ min: v.sliderMin ?? "0", max: v.sliderMax ?? "10", step: v.sliderStep ?? "0.1" }); setEditingBounds(true); }}
                    title="Edit range"
                    style={{ background: "transparent", border: "none", color: C.textMuted, cursor: "pointer", fontFamily: T.code.fontFamily, fontSize: T.code.fontSize, padding: "0 2px" }}
                    onMouseEnter={e => e.currentTarget.style.color = C.teal}
                    onMouseLeave={e => e.currentTarget.style.color = C.textMuted}>⚙</button>
                </span>
            }
          </td>
          <td style={{ ...tdStyle(C), textAlign: "right" }}>
            <button onClick={() => setVariables(vs => vs.filter(x => x.id !== v.id))}
              style={{ background: "transparent", border: "none", color: C.textMuted, cursor: "pointer", fontFamily: T.code.fontFamily, fontSize: T.h2.fontSize }}
              onMouseEnter={e => e.currentTarget.style.color = C.red}
              onMouseLeave={e => e.currentTarget.style.color = C.textMuted}>×</button>
          </td>
        </tr>
      );
    }

    const displayVal = () => {
      if (v.type === "Expression") {
        if (ev.evalError) return <span style={{ color: C.red }}>error: {ev.evalError}</span>;
        const computed = ev.computed;
        return <span>
          <span style={{ color: C.textMuted }}>{v.rawValue}</span>
          <span style={{ color: C.gold, marginLeft: 6 }}>= {computed != null ? fmt(computed, 4) : "?"}</span>
        </span>;
      }
      if (v.type === "String") return `"${v.rawValue}"`;
      return v.rawValue || <span style={{ color: C.textMuted }}>—</span>;
    };

    return (
      <tr>
        <td style={tdStyle(C)}><span style={{ fontFamily: T.code.fontFamily, fontSize: T.code.fontSize, color: C.text }}>{v.name}</span></td>
        <td style={tdStyle(C)}><span style={{ fontSize: T.caption.fontSize, padding: "2px 6px", border: `1px solid ${typeColor(C)[v.type]}`, color: typeColor(C)[v.type], borderRadius: 2, fontFamily: T.code.fontFamily }}>{v.type}</span></td>
        <td style={{ ...tdStyle(C), maxWidth: 300 }}>
          {editing
            ? <span style={{ display: "flex", gap: 4, alignItems: "center" }}>
                <ValueInput type={v.type} value={editVal} onChange={setEditVal} />
                <Btn ch="✓" sm v="ghost" color={C.green} onClick={save} />
                <Btn ch="✕" sm v="ghost" color={C.textMuted} onClick={() => setEditing(false)} />
              </span>
            : <span onClick={() => { setEditVal(v.rawValue); setEditing(true); }} title="Click to edit"
                style={{ cursor: "text", fontFamily: T.code.fontFamily, fontSize: T.code.fontSize }}>
                {displayVal()}
              </span>
          }
        </td>
        <td style={{ ...tdStyle(C), textAlign: "right" }}>
          <button onClick={() => setVariables(vs => vs.filter(x => x.id !== v.id))}
            style={{ background: "transparent", border: "none", color: C.textMuted, cursor: "pointer", fontFamily: T.code.fontFamily, fontSize: T.h2.fontSize }}
            onMouseEnter={e => e.currentTarget.style.color = C.red}
            onMouseLeave={e => e.currentTarget.style.color = C.textMuted}>×</button>
        </td>
      </tr>
    );
  }

  const vectorVars = variables.filter(v => v.type === "Vector");

  return (
    <div style={{ height: "100%", display: "grid", gridTemplateColumns: "minmax(0,1fr) minmax(0,460px)", fontFamily: T.code.fontFamily, color: C.text, overflow: "hidden" }}>

      {/* ── Left: variable workspace + tools ── */}
      <div style={{ overflowY: "auto", padding: "1.8rem 1.5rem 1.8rem 2.4rem" }}>

      <HintBox title="How to calculate" sections={[
        { heading: "Writing expressions (syntax)", items: [
          "Multiply with * — write 2*x, not 2x; A*K*L, not AKL",
          "Exponent with ** or ^ — x**2 or x^2 for x², K**alpha for Kᵅ",
          "Divide with / and group with parentheses: (1-alpha)/2, A*K^(1-alpha)",
          "Functions: sqrt(x), exp(x), log(x), sin(x); constants pi and e",
          "Use names for parameters (alpha, beta) — they appear as sliders below",
        ]},
        { heading: "Variable Workspace", items: [
          "Define scalars or vectors using dataset column names or numeric literals",
          "Variables persist across expressions in the same session",
        ]},
        { heading: "Expression Evaluator", items: [
          "Enter any math expression: log(wage) / sqrt(exper), col_a * col_b, etc.",
          "Results shown as scalar or vector depending on inputs",
        ]},
        { heading: "Symbolic Derivatives", items: [
          "Differentiate expressions containing unknown functions like p(q), c(q)",
          "Unknown functions stay symbolic: p'(q), c'(q) — useful for FOC analysis",
          "Supports chain rule, product rule, and mixed expressions",
        ]},
        { heading: "Equation Pad", items: [
          "Define named relations: TR = p(q)·q, TC = c(q), π = TR - TC",
          "Differentiate any named equation for first-order conditions",
          "Export any expression as LaTeX",
        ]},
        { heading: "Equation Solver & Derivatives", items: [
          "Root solver: find x where f(x) = 0 using Brent's method",
          "Numerical derivatives: first or higher-order at a specific point",
        ]},
        { heading: "Model Prediction", items: [
          "Generate ŷ ± 95% CI from any model pinned in the Model Buffer",
          "Set covariate values manually; prediction uses the full coefficient vector",
        ]},
      ]} />

      <Workbench pid={pid} />

      {/* Header */}
      <div style={{ marginBottom: "1.6rem" }}>
        <div style={{ fontSize: T.caption.fontSize, color: C.teal, letterSpacing: "0.26em", textTransform: "uppercase", marginBottom: 3 }}>Calculate</div>
        <div style={{ fontSize: T.h2.fontSize, color: C.text, letterSpacing: "-0.01em" }}>Math Tools</div>
      </div>

      {/* ── 6. Math Tools ─────────────────────────────────────────────────────── */}
      <div style={{ border: `1px solid ${C.border}`, borderRadius: 4, overflow: "hidden", marginBottom: "1.4rem" }}>

        {/* Tool selector strip */}
        <div style={{ display: "flex", background: C.surface2 }}>
          {[["solver","= Solve"],["derivative","∂ Derive"],["symbolic","f′ Symb."],["algebra","Σ Algebra"],["integral","∫ Integrate"],["limit","lim Limit"]].map(([id, label]) => (
            <button key={id} onClick={() => setActiveTool(id)}
              style={{ flex: 1, padding: "0.5rem 0.35rem", background: "transparent", border: "none",
                borderBottom: activeTool === id ? `2px solid ${C.teal}` : `2px solid ${C.border}`,
                color: activeTool === id ? C.teal : C.textMuted,
                cursor: "pointer", fontFamily: T.code.fontFamily, fontSize: T.caption.fontSize,
                letterSpacing: "0.04em", textTransform: "uppercase", transition: "all 0.12s" }}>
              {label}
            </button>
          ))}
        </div>

        {/* ── SOLVER ── */}
        {activeTool === "solver" && (
          <div style={{ background: C.surface }}>
            <div style={{ display: "flex", borderBottom: `1px solid ${C.border}` }}>
              {[["single","Single equation"],["algebraic","Algebraic"],["system","System of equations"]].map(([id, label]) => (
                <button key={id} onClick={() => { setSolverMode(id); setSolResult(null); setAlgSolveResult(null); setSysResult(null); }}
                  style={{ flex: 1, padding: "0.4rem 0.7rem", background: "transparent", border: "none",
                    borderBottom: solverMode === id ? `2px solid ${C.gold}` : "2px solid transparent",
                    color: solverMode === id ? C.gold : C.textMuted,
                    cursor: "pointer", fontFamily: T.code.fontFamily, fontSize: T.caption.fontSize, letterSpacing: "0.06em", transition: "all 0.12s" }}>
                  {label}
                </button>
              ))}
            </div>
            {solverMode === "single" && (
              <div style={{ padding: "0.85rem", display: "flex", flexDirection: "column", gap: 10 }}>
                <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
                  <input value={solExpr} onChange={e => { setSolExpr(e.target.value); setSolResult(null); }}
                    placeholder="2*x = 4*x - 10  or  x**2 - 4"
                    onKeyDown={e => e.key === "Enter" && runSolver()}
                    onFocus={() => focusField(setSolExpr)}
                    style={{ ...fieldStyle(C, T), flex: 1, minWidth: 180 }} />
                  <EquationPicker savedEqs={savedEqs} onLoad={setSolExpr} />
                  <Btn ch="Solve" v="solid" color={C.gold} sm onClick={runSolver} />
                </div>
                <div style={{ fontSize: T.caption.fontSize, color: C.textMuted }}>
                  Scope: {Object.keys(scope).filter(k => typeof scope[k] !== "function").join(", ") || "none"}
                  {" · "}pnorm, qnorm, pt, qt, pbinom, ppois, pchisq available
                </div>
                {solResult && (solResult.error ? <ErrBox msg={solResult.error} />
                  : <ResultBox>
                      <div><span style={{ color: C.textMuted }}>root </span><span style={{ color: C.gold }}>{fmt(solResult.root, 10)}</span></div>
                      <div><span style={{ color: C.textMuted }}>f(root) </span><span style={{ color: C.teal, fontSize: T.caption.fontSize }}>≈ 0</span></div>
                      <div><span style={{ color: C.textMuted }}>iterations </span>{solResult.iter}</div>
                      {!solResult.converged && <div style={{ color: C.red, fontSize: T.caption.fontSize }}>Warning: did not fully converge.</div>}
                    </ResultBox>
                )}
              </div>
            )}
            {solverMode === "algebraic" && (
              <div style={{ padding: "0.85rem", display: "flex", flexDirection: "column", gap: 10 }}>
                <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
                  <span style={{ fontFamily: T.code.fontFamily, fontSize: T.caption.fontSize, color: C.textMuted }}>solve for</span>
                  <input value={algSolveVar} onChange={e => { setAlgSolveVar(e.target.value); setAlgSolveResult(null); }}
                    placeholder="q" style={{ ...fieldStyle(C, T), width: 70 }} />
                  <input value={algSolveExpr} onChange={e => { setAlgSolveExpr(e.target.value); setAlgSolveResult(null); }}
                    placeholder="p = a - b*q"
                    onKeyDown={e => e.key === "Enter" && runAlgebraicSolver()}
                    onFocus={() => focusField(setAlgSolveExpr)}
                    style={{ ...fieldStyle(C, T), flex: 1, minWidth: 220 }} />
                  <EquationPicker savedEqs={savedEqs} onLoad={expr => { setAlgSolveExpr(expr); setAlgSolveResult(null); }} />
                  <Btn ch="Solve algebraically" v="solid" color={C.gold} sm onClick={runAlgebraicSolver} />
                </div>
                <div style={{ fontSize: T.caption.fontSize, color: C.textMuted, lineHeight: 1.5 }}>
                  Symbolic parameters stay symbolic. Supports linear and quadratic equations before falling back to numeric solving.
                </div>

                {algSolveResult && (algSolveResult.error ? (
                  <ResultBox color={C.gold}>
                    <div style={{ color: C.red, fontSize: T.caption.fontSize }}>{algSolveResult.error}</div>
                    {algSolveResult.normalized && <div><span style={{ color: C.textMuted }}>normalized </span>{algSolveResult.normalized}</div>}
                    {(algSolveResult.recommendation ?? []).map((line, i) => (
                      <div key={i} style={{ fontSize: T.caption.fontSize, color: C.textMuted }}>{line}</div>
                    ))}
                  </ResultBox>
                ) : (
                  <ResultBox color={C.gold}>
                    <div style={{ fontSize: T.caption.fontSize, color: C.textMuted, marginBottom: 8, letterSpacing: "0.14em" }}>
                      {String(algSolveResult.method ?? "ALGEBRAIC").toUpperCase()} {algSolveResult.degree != null ? `- DEGREE ${algSolveResult.degree}` : ""}
                    </div>
                    <div><span style={{ color: C.textMuted }}>normalized </span>{algSolveResult.normalized}</div>
                    {algSolveResult.discriminant && <div><span style={{ color: C.textMuted }}>discriminant </span>{algSolveResult.discriminant}</div>}
                    {(algSolveResult.solutions ?? []).length > 0
                      ? (algSolveResult.solutions ?? []).map((s, i) => (
                          <div key={i}>
                            <span style={{ color: C.gold }}>{algSolveResult.variable}{algSolveResult.solutions.length > 1 ? `_${i + 1}` : ""} = </span>
                            <span style={{ color: C.text }}>{s.expr}</span>
                            {s.condition && <span style={{ color: C.textMuted, fontSize: T.caption.fontSize }}> ; {s.condition}</span>}
                          </div>
                        ))
                      : <div style={{ color: C.textMuted }}>{algSolveResult.message}</div>}
                    {algSolveResult.coefficients && (
                      <div style={{ marginTop: 8, fontSize: T.caption.fontSize, color: C.textMuted }}>
                        coefficients: {Object.entries(algSolveResult.coefficients).map(([k, v]) => `${k}=${v}`).join(", ")}
                      </div>
                    )}
                    {(algSolveResult.recommendation ?? []).map((line, i) => (
                      <div key={i} style={{ fontSize: T.caption.fontSize, color: C.textMuted }}>{line}</div>
                    ))}
                  </ResultBox>
                ))}

                <div style={{ borderTop: `1px solid ${C.border}`, paddingTop: 10 }}>
                  <div style={{ fontSize: T.caption.fontSize, color: C.textMuted, marginBottom: 6, letterSpacing: "0.14em" }}>EXAMPLES</div>
                  <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
                    {[
                      ["p = a - b*q", "q", "Inverse demand"],
                      ["MR - MC = 0", "q", "FOC isolation"],
                      ["a*q^2 + b*q + c = 0", "q", "Quadratic"],
                      ["w = MPL", "L", "Factor condition"],
                    ].map(([eq, v, label]) => (
                      <button key={`${eq}-${v}`} onClick={() => { setAlgSolveExpr(eq); setAlgSolveVar(v); setAlgSolveResult(null); }}
                        style={{ padding: "0.22rem 0.6rem", background: "transparent", border: `1px solid ${C.border2}`, borderRadius: 3, color: C.textDim, cursor: "pointer", fontFamily: T.code.fontFamily, fontSize: T.caption.fontSize }}
                        onMouseEnter={e => { e.currentTarget.style.borderColor = C.gold; e.currentTarget.style.color = C.gold; }}
                        onMouseLeave={e => { e.currentTarget.style.borderColor = C.border2; e.currentTarget.style.color = C.textDim; }}>
                        {label}
                      </button>
                    ))}
                  </div>
                </div>
              </div>
            )}
            {solverMode === "system" && (() => {
              const varNames = sysVarStr.split(",").map(s => s.trim()).filter(Boolean);
              const detectedParams = detectSysParams(sysEqs, varNames, scope);
              return (
                <div style={{ padding: "0.85rem", display: "flex", flexDirection: "column", gap: 12 }}>

                  {/* Unknowns */}
                  <div>
                    <div style={{ fontSize: T.caption.fontSize, color: C.textMuted, letterSpacing: "0.14em", marginBottom: 6 }}>UNKNOWNS (comma-separated)</div>
                    <input value={sysVarStr} onChange={e => { setSysVarStr(e.target.value); setSysResult(null); const names = e.target.value.split(",").map(s => s.trim()).filter(Boolean); setSysGuesses(prev => { const next = {}; names.forEach(n => { next[n] = prev[n] ?? "1"; }); return next; }); }}
                      placeholder="x_1, x_2, lambda" style={{ ...fieldStyle(C, T), width: "100%" }} />
                  </div>

                  {/* Equations */}
                  <div>
                    <div style={{ fontSize: T.caption.fontSize, color: C.textMuted, letterSpacing: "0.14em", marginBottom: 6 }}>
                      EQUATIONS — each expression = 0
                    </div>
                    {sysEqs.map((eq, i) => (
                      <div key={i} style={{ display: "flex", gap: 6, alignItems: "center", marginBottom: 6 }}>
                        <span style={{ fontFamily: T.code.fontFamily, fontSize: T.caption.fontSize, color: C.textMuted, minWidth: 24 }}>f{i + 1}</span>
                        <input value={eq} onChange={e => { const next = [...sysEqs]; next[i] = e.target.value; setSysEqs(next); setSysResult(null); }}
                          placeholder={`expression = 0`} style={{ ...fieldStyle(C, T), flex: 1 }} />
                        <button onClick={() => { setSysEqs(sysEqs.filter((_, j) => j !== i)); setSysResult(null); }}
                          disabled={sysEqs.length <= 1}
                          style={{ background: "transparent", border: "none", color: C.textMuted, cursor: sysEqs.length <= 1 ? "default" : "pointer", fontFamily: T.code.fontFamily, fontSize: T.h2.fontSize, opacity: sysEqs.length <= 1 ? 0.3 : 1 }}
                          onMouseEnter={e => { if (sysEqs.length > 1) e.currentTarget.style.color = C.red; }}
                          onMouseLeave={e => e.currentTarget.style.color = C.textMuted}>×</button>
                      </div>
                    ))}
                    <button onClick={() => setSysEqs([...sysEqs, ""])}
                      style={{ padding: "0.22rem 0.7rem", background: "transparent", border: `1px solid ${C.border2}`, borderRadius: 3, color: C.textDim, cursor: "pointer", fontFamily: T.code.fontFamily, fontSize: T.caption.fontSize }}>
                      + Add equation</button>
                  </div>

                  {/* Auto-detected parameters */}
                  {detectedParams.length > 0 && (
                    <div style={{ background: `${C.gold}0a`, border: `1px solid ${C.gold}30`, borderRadius: 3, padding: "0.65rem 0.85rem" }}>
                      <div style={{ fontSize: T.caption.fontSize, color: C.gold, letterSpacing: "0.14em", marginBottom: 8 }}>PARAMETERS — set values to solve numerically</div>
                      <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
                        {detectedParams.map(p => (
                          <div key={p} style={{ display: "flex", flexDirection: "column", gap: 3 }}>
                            <span style={{ fontSize: T.caption.fontSize, color: C.gold, fontFamily: T.code.fontFamily }}>{p}</span>
                            <input type="number" step="any" placeholder="value"
                              value={sysParamVals[p] ?? ""}
                              onChange={e => { setSysParamVals(prev => ({ ...prev, [p]: e.target.value })); setSysResult(null); }}
                              style={{ ...fieldStyle(C, T), width: 80 }} />
                          </div>
                        ))}
                      </div>
                    </div>
                  )}

                  {/* Initial guesses — collapsible */}
                  <div>
                    <button onClick={() => setSysShowGuesses(v => !v)}
                      style={{ background: "transparent", border: "none", color: C.textMuted, cursor: "pointer", fontFamily: T.code.fontFamily, fontSize: T.caption.fontSize, letterSpacing: "0.12em", padding: 0, display: "flex", alignItems: "center", gap: 5 }}>
                      <span>{sysShowGuesses ? "▾" : "▸"}</span> STARTING GUESSES (default: 1)
                    </button>
                    {sysShowGuesses && varNames.length > 0 && (
                      <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginTop: 8 }}>
                        {varNames.map(n => (
                          <div key={n} style={{ display: "flex", flexDirection: "column", gap: 3, minWidth: 80 }}>
                            <span style={{ fontSize: T.caption.fontSize, color: C.textMuted, fontFamily: T.code.fontFamily }}>{n}₀</span>
                            <input type="number" step="any" value={sysGuesses[n] ?? "1"}
                              onChange={e => setSysGuesses(prev => ({ ...prev, [n]: e.target.value }))}
                              style={{ ...fieldStyle(C, T), width: "100%" }} />
                          </div>
                        ))}
                      </div>
                    )}
                  </div>

                  <div style={{ fontSize: T.caption.fontSize, color: C.textMuted }}>
                    Newton-Raphson · {varNames.length} × {sysEqs.length} system
                    {Object.keys(scope).filter(k => typeof scope[k] !== "function").length > 0 &&
                      ` · User vars in scope: ${Object.keys(scope).filter(k => typeof scope[k] !== "function").join(", ")}`}
                  </div>

                  <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
                    <Btn ch="Solve system" v="solid" color={C.gold} sm
                      dis={varNames.length < 2 || sysEqs.filter(e => e.trim()).length < varNames.length ||
                        (detectedParams.length > 0 && detectedParams.some(p => !sysParamVals[p]?.trim()))}
                      onClick={runSystem} />
                    <button
                      onClick={() => setSysLive(v => !v)}
                      title="Live mode: re-solves automatically when sliders or parameters change"
                      style={{ padding: "0.28rem 0.65rem", background: sysLive ? `${C.teal}20` : "transparent", border: `1px solid ${sysLive ? C.teal : C.border2}`, borderRadius: 3, color: sysLive ? C.teal : C.textMuted, cursor: "pointer", fontFamily: T.code.fontFamily, fontSize: T.caption.fontSize, transition: "all 0.13s" }}>
                      {sysLive ? "◉ Live" : "○ Live"}
                    </button>
                  </div>

                  {detectedParams.length > 0 && detectedParams.some(p => !sysParamVals[p]?.trim()) && (
                    <div style={{ fontSize: T.caption.fontSize, color: C.gold }}>Set all parameter values above to solve.</div>
                  )}

                  {sysResult && (sysResult.error ? <ErrBox msg={sysResult.error} />
                    : <ResultBox color={C.gold}>
                        <div style={{ fontSize: T.caption.fontSize, color: C.textMuted, marginBottom: 8, letterSpacing: "0.14em" }}>
                          SOLUTION · {sysResult.iter} iter · {sysResult.converged ? <span style={{ color: C.teal }}>converged</span> : <span style={{ color: C.red }}>may not have converged</span>}
                        </div>
                        <div style={{ display: "grid", gridTemplateColumns: "auto auto auto", columnGap: 24, rowGap: 4, alignItems: "baseline" }}>
                          {(sysResult.varNames ?? []).map((n, i) => (<>
                            <span key={`n${i}`} style={{ color: C.gold, fontFamily: T.code.fontFamily }}>{n}*</span>
                            <span key={`v${i}`} style={{ color: C.text, fontFamily: T.code.fontFamily }}>{fmt(sysResult.solution?.[i], 8)}</span>
                            <span key={`r${i}`} style={{ fontSize: T.caption.fontSize, color: C.textMuted }}>residual: {fmt(sysResult.fVals?.[i], 4)}</span>
                          </>))}
                        </div>
                        {!sysResult.converged && <div style={{ color: C.red, fontSize: T.caption.fontSize, marginTop: 8 }}>Did not fully converge — try different starting guesses.</div>}
                      </ResultBox>
                  )}
                </div>
              );
            })()}
          </div>
        )}

        {/* ── DERIVATIVES ── */}
        {activeTool === "derivative" && (
          <div style={{ background: C.surface }}>
            {/* Mode toggle */}
            <div style={{ display: "flex", borderBottom: `1px solid ${C.border}` }}>
              {[["single","Single"],["focs","FOCs (Lagrangian)"]].map(([id, label]) => (
                <button key={id} onClick={() => setDeriveMode(id)}
                  style={{ flex: 1, padding: "0.4rem 0.7rem", background: "transparent", border: "none",
                    borderBottom: deriveMode === id ? `2px solid ${C.teal}` : "2px solid transparent",
                    color: deriveMode === id ? C.teal : C.textMuted,
                    cursor: "pointer", fontFamily: T.code.fontFamily, fontSize: T.caption.fontSize, letterSpacing: "0.06em", transition: "all 0.12s" }}>
                  {label}
                </button>
              ))}
            </div>

            {/* ── Single derivative ── */}
            {deriveMode === "single" && (
              <div style={{ padding: "0.85rem", display: "flex", flexDirection: "column", gap: 10 }}>
                <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center" }}>
                  <span style={{ fontFamily: T.code.fontFamily, fontSize: T.code.fontSize, color: C.textMuted, whiteSpace: "nowrap" }}>f( </span>
                  <input value={dVar} onChange={e => setDVar(e.target.value)} placeholder="x" style={{ ...fieldStyle(C, T), width: 60 }} />
                  <span style={{ fontFamily: T.code.fontFamily, fontSize: T.code.fontSize, color: C.textMuted, whiteSpace: "nowrap" }}> ) =</span>
                  <input value={dExpr} onChange={e => setDExpr(e.target.value)} placeholder="x**3 + 2*x"
                    onFocus={() => focusField(setDExpr)}
                    style={{ ...fieldStyle(C, T), flex: 1, minWidth: 180 }} />
                  <EquationPicker savedEqs={savedEqs} onLoad={setDExpr} />
                </div>
                <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center" }}>
                  <span style={{ fontFamily: T.code.fontFamily, fontSize: T.caption.fontSize, color: C.textMuted }}>evaluate at</span>
                  <input value={dPoint} onChange={e => setDPoint(e.target.value)} placeholder="point" style={{ ...fieldStyle(C, T), width: 90 }} />
                  <span style={{ fontFamily: T.code.fontFamily, fontSize: T.caption.fontSize, color: C.textMuted }}>order</span>
                  <select value={dOrder} onChange={e => setDOrder(e.target.value)} style={{ ...fieldStyle(C, T) }}>
                    {["1","2","3","4"].map(n => <option key={n}>{n}</option>)}
                  </select>
                  <Btn ch="Compute" v="solid" color={C.teal} sm onClick={runDerivative} />
                </div>
                <div style={{ fontSize: T.caption.fontSize, color: C.textMuted }}>
                  Other variables in scope: {Object.keys(scope).filter(k => k !== dVar.trim()).join(", ") || "none"}
                </div>
                {dResult && (dResult.error ? <ErrBox msg={dResult.error} />
                  : <ResultBox color={C.teal}>
                      <div><span style={{ color: C.textMuted }}>f({dResult.varName} = {dResult.x0}) </span><span style={{ color: C.text }}>{fmt(dResult.val, 8)}</span></div>
                      {dResult.d1 != null && <div><span style={{ color: C.textMuted }}>f′({dResult.x0}) </span><span style={{ color: C.teal }}>{fmt(dResult.d1, 8)}</span></div>}
                      {dResult.n > 1 && dResult.dn != null && <div><span style={{ color: C.textMuted }}>f<sup>({dResult.n})</sup>({dResult.x0}) </span><span style={{ color: C.gold }}>{fmt(dResult.dn, 8)}</span></div>}
                      <div style={{ fontSize: T.caption.fontSize, color: C.textMuted, marginTop: 4 }}>Numerical (central difference, h = 1e-6)</div>
                    </ResultBox>
                )}
              </div>
            )}

            {/* ── FOC panel ── */}
            {deriveMode === "focs" && (
              <div style={{ padding: "0.85rem", display: "flex", flexDirection: "column", gap: 12 }}>
                {/* Expression row */}
                <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center" }}>
                  <span style={{ fontFamily: T.code.fontFamily, fontSize: T.code.fontSize, color: C.textMuted, whiteSpace: "nowrap" }}>L =</span>
                  <input value={focExpr} onChange={e => { setFocExpr(e.target.value); setFocResults(null); }}
                    placeholder="sqrt(x_1) + x_2 - lambda*(p_1*x_1 + p_2*x_2 - m)"
                    onFocus={() => focusField(setFocExpr)}
                    style={{ ...fieldStyle(C, T), flex: 1, minWidth: 220 }} />
                  <EquationPicker savedEqs={savedEqs} onLoad={v => { setFocExpr(v); setFocResults(null); }} />
                </div>

                {/* Variable chips */}
                <div>
                  <div style={{ fontSize: T.caption.fontSize, color: C.textMuted, letterSpacing: "0.14em", marginBottom: 6 }}>DIFFERENTIATE W.R.T.</div>
                  <div style={{ display: "flex", gap: 6, flexWrap: "wrap", alignItems: "center" }}>
                    {focVars.map(v => (
                      <div key={v} style={{ display: "flex", alignItems: "center", gap: 4, padding: "0.18rem 0.5rem 0.18rem 0.6rem", background: `${C.teal}14`, border: `1px solid ${C.teal}40`, borderRadius: 3 }}>
                        <span style={{ fontFamily: T.code.fontFamily, fontSize: T.caption.fontSize, color: C.teal }}>∂/{v}</span>
                        <button onClick={() => { setFocVars(prev => prev.filter(x => x !== v)); setFocResults(null); }}
                          style={{ background: "transparent", border: "none", color: C.teal, cursor: "pointer", fontFamily: T.code.fontFamily, fontSize: T.body.fontSize, lineHeight: 1, padding: "0 0 0 2px", opacity: 0.7 }}
                          onMouseEnter={e => e.currentTarget.style.opacity = "1"}
                          onMouseLeave={e => e.currentTarget.style.opacity = "0.7"}>×</button>
                      </div>
                    ))}
                    <div style={{ display: "flex", gap: 4, alignItems: "center" }}>
                      <input value={focVarInput} onChange={e => setFocVarInput(e.target.value)}
                        onKeyDown={e => {
                          if (e.key === "Enter") {
                            const v = focVarInput.trim();
                            if (v && !focVars.includes(v)) { setFocVars(prev => [...prev, v]); setFocVarInput(""); setFocResults(null); }
                          }
                        }}
                        placeholder="variable"
                        style={{ ...fieldStyle(C, T), width: 80 }} />
                      <Btn ch="+ Add" sm v="out"
                        dis={!focVarInput.trim() || focVars.includes(focVarInput.trim())}
                        onClick={() => {
                          const v = focVarInput.trim();
                          if (v && !focVars.includes(v)) { setFocVars(prev => [...prev, v]); setFocVarInput(""); setFocResults(null); }
                        }} />
                    </div>
                  </div>
                </div>

                {/* Compute */}
                <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                  <Btn ch="Compute FOCs" v="solid" color={C.teal}
                    dis={!focExpr.trim() || focVars.length === 0}
                    onClick={() => setFocResults(focVars.map(v => ({ varName: v, ...symbolicDiff(focExpr, v) })))} />
                  {focVars.length === 0 && <span style={{ fontSize: T.caption.fontSize, color: C.textMuted }}>Add at least one variable</span>}
                </div>

                {/* Result cards */}
                {focResults && (
                  <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                    {focResults.map(r => (
                      <div key={r.varName} style={{ background: r.error ? `${C.red}08` : `${C.teal}08`, border: `1px solid ${r.error ? C.red : C.teal}25`, borderRadius: 3, padding: "0.6rem 0.85rem" }}>
                        {r.error
                          ? <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                              <span style={{ color: C.textMuted, fontFamily: T.code.fontFamily, fontSize: T.caption.fontSize }}>∂L/∂{r.varName} =</span>
                              <span style={{ color: C.red, fontFamily: T.code.fontFamily, fontSize: T.caption.fontSize }}>{r.error}</span>
                            </div>
                          : <div style={{ display: "flex", gap: 10, alignItems: "center", justifyContent: "space-between", flexWrap: "wrap" }}>
                              <div style={{ fontFamily: T.code.fontFamily, fontSize: T.code.fontSize, lineHeight: 1.6 }}>
                                <span style={{ color: C.textMuted, fontSize: T.caption.fontSize }}>∂L/∂{r.varName} = </span>
                                <span style={{ color: C.teal }}>{r.expr}</span>
                                <span style={{ color: C.textMuted, fontSize: T.caption.fontSize }}> = 0</span>
                              </div>
                              <button
                                onClick={() => {
                                  setSysEqs(prev => [...prev.filter(e => e.trim()), r.expr]);
                                  setSysResult(null);
                                  setActiveTool("solver");
                                  setSolverMode("system");
                                }}
                                style={{ padding: "0.15rem 0.55rem", background: "transparent", border: `1px solid ${C.gold}`, borderRadius: 3, color: C.gold, cursor: "pointer", fontFamily: T.code.fontFamily, fontSize: T.caption.fontSize, whiteSpace: "nowrap", flexShrink: 0 }}
                                onMouseEnter={e => e.currentTarget.style.background = `${C.gold}18`}
                                onMouseLeave={e => e.currentTarget.style.background = "transparent"}>
                                → Solve
                              </button>
                            </div>
                        }
                      </div>
                    ))}

                    {/* Bulk actions */}
                    <div style={{ display: "flex", gap: 6, flexWrap: "wrap", marginTop: 2 }}>
                      <button
                        disabled={focResults.every(r => r.error)}
                        onClick={() => {
                          const valid = focResults.filter(r => !r.error);
                          const guesses = {};
                          focVars.forEach(v => { guesses[v] = "1"; });
                          setSysEqs(valid.map(r => r.expr));
                          setSysVarStr(focVars.join(", "));
                          setSysGuesses(guesses);
                          setSysResult(null);
                          setActiveTool("solver");
                          setSolverMode("system");
                        }}
                        style={{ padding: "0.3rem 0.75rem", background: C.teal, border: `1px solid ${C.teal}`, borderRadius: 3, color: C.bg, cursor: "pointer", fontFamily: T.code.fontFamily, fontSize: T.caption.fontSize, fontWeight: 700, opacity: focResults.every(r => r.error) ? 0.4 : 1 }}
                        onMouseEnter={e => { if (!focResults.every(r => r.error)) e.currentTarget.style.opacity = "0.82"; }}
                        onMouseLeave={e => { if (!focResults.every(r => r.error)) e.currentTarget.style.opacity = "1"; }}>
                        Send all FOCs to Solve
                      </button>
                      <button
                        disabled={focResults.every(r => r.error)}
                        onClick={() => {
                          const valid = focResults.filter(r => !r.error);
                          const lines = valid.map(r => `  \\frac{\\partial L}{\\partial ${latexName(r.varName)}} &= ${r.latex} = 0`);
                          navigator.clipboard.writeText(`\\begin{align*}\n${lines.join(' \\\\\n')}\n\\end{align*}`).then(() => {
                            setFocCopied(true); setTimeout(() => setFocCopied(false), 1500);
                          });
                        }}
                        style={{ padding: "0.3rem 0.75rem", background: "transparent", border: `1px solid ${focCopied ? C.teal : C.border2}`, borderRadius: 3, color: focCopied ? C.teal : C.textDim, cursor: "pointer", fontFamily: T.code.fontFamily, fontSize: T.caption.fontSize, opacity: focResults.every(r => r.error) ? 0.4 : 1 }}
                        onMouseEnter={e => { if (!focResults.every(r => r.error)) { e.currentTarget.style.borderColor = C.teal; e.currentTarget.style.color = C.teal; }}}
                        onMouseLeave={e => { if (!focCopied) { e.currentTarget.style.borderColor = C.border2; e.currentTarget.style.color = C.textDim; }}}>
                        {focCopied ? "✓ Copied!" : "Copy LaTeX"}
                      </button>
                    </div>
                    <div style={{ fontSize: T.caption.fontSize, color: C.textMuted, lineHeight: 1.5 }}>
                      Symbolic · rules applied: linearity, product, chain, power · parameters in scope treated as constants
                    </div>
                  </div>
                )}
              </div>
            )}
          </div>
        )}

        {/* ── SYMBOLIC ── */}
        {activeTool === "symbolic" && (
          <div style={{ padding: "0.85rem", background: C.surface, display: "flex", flexDirection: "column", gap: 12 }}>
            <div style={{ fontSize: T.caption.fontSize, color: C.textMuted, lineHeight: 1.7 }}>
              Enter an expression with unknown functions like <span style={{ color: C.teal }}>c(q)</span> or <span style={{ color: C.teal }}>p(q)</span>.
              Their derivatives are written as <span style={{ color: C.gold }}>c'(q)</span>, <span style={{ color: C.gold }}>p'(q)</span>.
              Applies the product, quotient, and chain rules symbolically.
            </div>
            <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
              <span style={{ fontFamily: T.code.fontFamily, fontSize: T.code.fontSize, color: C.textMuted, whiteSpace: "nowrap" }}>f( </span>
              <input value={symbVar} onChange={e => { setSymbVar(e.target.value); setSymbResult(null); }}
                placeholder="q" style={{ ...fieldStyle(C, T), width: 52 }} />
              <span style={{ fontFamily: T.code.fontFamily, fontSize: T.code.fontSize, color: C.textMuted }}> ) =</span>
              <input value={symbExpr} onChange={e => { setSymbExpr(e.target.value); setSymbResult(null); }}
                placeholder="p(q)*q - c(q)" onFocus={() => focusField(setSymbExpr)}
                style={{ ...fieldStyle(C, T), flex: 1, minWidth: 200 }} />
              <EquationPicker savedEqs={savedEqs} onLoad={expr => { setSymbExpr(expr); setSymbResult(null); }} />
              <Btn ch="Differentiate" v="solid" color={C.teal} sm onClick={() => setSymbResult(symbolicDiff(symbExpr, symbVar))} />
            </div>
            {symbResult && (symbResult.error ? <ErrBox msg={symbResult.error} />
              : <div>
                  <ResultBox color={C.teal}>
                    <div style={{ display: "flex", gap: 8, alignItems: "baseline", flexWrap: "wrap" }}>
                      <span style={{ color: C.textMuted, fontFamily: T.code.fontFamily, fontSize: T.code.fontSize }}>d/d{symbVar.trim() || "x"} =</span>
                      <span style={{ color: C.teal, fontFamily: T.code.fontFamily, fontSize: T.code.fontSize, letterSpacing: "0.01em" }}>{symbResult.expr}</span>
                    </div>
                    {symbResult.symbolicFns.length > 0 && (
                      <div style={{ marginTop: 8, fontSize: T.caption.fontSize, color: C.textMuted }}>
                        Symbolic functions: {symbResult.symbolicFns.map(fn => (
                          <span key={fn} style={{ color: C.gold, marginRight: 8 }}>{fn}(·) → {fn}'(·)</span>
                        ))}
                      </div>
                    )}
                  </ResultBox>
                  <div style={{ marginTop: 6, fontSize: T.caption.fontSize, color: C.textMuted }}>Rules applied: linearity, product rule, chain rule, power rule</div>
                </div>
            )}
            <div style={{ borderTop: `1px solid ${C.border}`, paddingTop: 10 }}>
              <div style={{ fontSize: T.caption.fontSize, color: C.textMuted, marginBottom: 6, letterSpacing: "0.14em" }}>EXAMPLES</div>
              <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
                {[["p(q)*q - c(q)","q","Revenue − Cost"],["a*x^2 + b*x + c(x)","x","Quadratic + unknown"],["ln(1 + r)^n","r","Compound growth"],["p(q)*q","q","Total Revenue"]].map(([ex,vr,label]) => (
                  <button key={ex} onClick={() => { setSymbExpr(ex); setSymbVar(vr); setSymbResult(null); }}
                    style={{ padding: "0.22rem 0.6rem", background: "transparent", border: `1px solid ${C.border2}`, borderRadius: 3, color: C.textDim, cursor: "pointer", fontFamily: T.code.fontFamily, fontSize: T.caption.fontSize }}
                    onMouseEnter={e => { e.currentTarget.style.borderColor = C.teal; e.currentTarget.style.color = C.teal; }}
                    onMouseLeave={e => { e.currentTarget.style.borderColor = C.border2; e.currentTarget.style.color = C.textDim; }}>{label}</button>
                ))}
              </div>
            </div>
          </div>
        )}

        {/* ── ALGEBRA ── */}
        {activeTool === "algebra" && (
          <div style={{ background: C.surface }}>
            <div style={{ padding: "0.65rem 0.85rem", borderBottom: `1px solid ${C.border}`, display: "flex", alignItems: "center", gap: 10 }}>
              <span style={{ fontFamily: T.code.fontFamily, fontSize: T.caption.fontSize, color: C.textMuted }}>Differentiate w.r.t.</span>
              <input value={algVar} onChange={e => { setAlgVar(e.target.value); setAlgDeriv({}); }}
                placeholder="q" style={{ ...fieldStyle(C, T), width: 60 }} />
              <span style={{ fontSize: T.caption.fontSize, color: C.textMuted, marginLeft: "auto" }}>Define symbolic relationships — click ∂ to differentiate</span>
            </div>
            <table style={{ borderCollapse: "collapse", width: "100%" }}>
              <thead><tr>{["Label","Expression","Derivative",""].map(h => <th key={h} style={thStyle(C, T)}>{h}</th>)}</tr></thead>
              <tbody>
                {algEqs.map(eq => (
                  <tr key={eq.id}>
                    <td style={{ ...tdStyle(C), width: 80 }}><span style={{ fontFamily: T.code.fontFamily, fontSize: T.code.fontSize, color: C.gold }}>{eq.name}</span></td>
                    <td style={tdStyle(C)}>
                      <input value={eq.expr}
                        onChange={e => { setAlgEqs(prev => prev.map(x => x.id === eq.id ? { ...x, expr: e.target.value } : x)); setAlgDeriv(prev => { const n = { ...prev }; delete n[eq.id]; return n; }); }}
                        onFocus={() => focusField(v => setAlgEqs(prev => prev.map(x => x.id === eq.id ? { ...x, expr: v } : x)))}
                        style={{ ...fieldStyle(C, T), width: "100%", minWidth: 180 }} />
                    </td>
                    <td style={{ ...tdStyle(C), fontFamily: T.code.fontFamily, fontSize: T.code.fontSize }}>
                      {algDeriv[eq.id] == null ? <span style={{ color: C.textMuted, fontSize: T.caption.fontSize }}>—</span>
                        : algDeriv[eq.id].error ? <span style={{ color: C.red, fontSize: T.caption.fontSize }}>{algDeriv[eq.id].error}</span>
                        : <span style={{ color: C.teal }}>d{eq.name}/d{algVar.trim() || "x"} = {algDeriv[eq.id].expr}</span>}
                    </td>
                    <td style={{ ...tdStyle(C), textAlign: "right", whiteSpace: "nowrap" }}>
                      <button onClick={() => setAlgDeriv(prev => ({ ...prev, [eq.id]: symbolicDiff(eq.expr, algVar) }))} title="Differentiate symbolically"
                        style={{ background: "transparent", border: `1px solid ${C.border2}`, borderRadius: 3, color: C.teal, cursor: "pointer", fontFamily: T.code.fontFamily, fontSize: T.caption.fontSize, padding: "0.15rem 0.45rem", marginRight: 4 }}
                        onMouseEnter={e => e.currentTarget.style.borderColor = C.teal}
                        onMouseLeave={e => e.currentTarget.style.borderColor = C.border2}>∂</button>
                      <button onClick={() => { setAlgEqs(prev => prev.filter(x => x.id !== eq.id)); setAlgDeriv(prev => { const n={...prev}; delete n[eq.id]; return n; }); }}
                        style={{ background: "transparent", border: "none", color: C.textMuted, cursor: "pointer", fontFamily: T.code.fontFamily, fontSize: T.h2.fontSize }}
                        onMouseEnter={e => e.currentTarget.style.color = C.red}
                        onMouseLeave={e => e.currentTarget.style.color = C.textMuted}>×</button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            <div style={{ padding: "0.65rem 0.85rem", borderTop: `1px solid ${C.border}`, display: "flex", gap: 6, alignItems: "center", flexWrap: "wrap" }}>
              <input placeholder="Label (e.g. π)" value={algNewName} onChange={e => setAlgNewName(e.target.value)} style={{ ...fieldStyle(C, T), width: 90 }} />
              <span style={{ fontFamily: T.code.fontFamily, fontSize: T.code.fontSize, color: C.textMuted }}>=</span>
              <input placeholder="Expression (e.g. p(q)*q - c(q))" value={algNewExpr} onChange={e => setAlgNewExpr(e.target.value)}
                onKeyDown={e => { if (e.key === 'Enter' && algNewName.trim() && algNewExpr.trim()) { setAlgEqs(prev => [...prev, { id: Date.now(), name: algNewName.trim(), expr: algNewExpr.trim() }]); setAlgNewName(""); setAlgNewExpr(""); } }}
                onFocus={() => focusField(setAlgNewExpr)}
                style={{ ...fieldStyle(C, T), flex: 1, minWidth: 200 }} />
              <EquationPicker savedEqs={savedEqs} onLoad={setAlgNewExpr} />
              <Btn ch="Add" v="solid" color={C.gold} sm dis={!algNewName.trim() || !algNewExpr.trim()}
                onClick={() => { setAlgEqs(prev => [...prev, { id: Date.now(), name: algNewName.trim(), expr: algNewExpr.trim() }]); setAlgNewName(""); setAlgNewExpr(""); }} />
              <Btn ch="∂ All" sm color={C.teal} dis={algEqs.length === 0}
                onClick={() => { const results = {}; algEqs.forEach(eq => { results[eq.id] = symbolicDiff(eq.expr, algVar); }); setAlgDeriv(results); }} />
            </div>
            <div style={{ padding: "0.3rem 0.85rem 0.6rem", fontSize: T.caption.fontSize, color: C.textMuted }}>
              Use unknown functions like <span style={{ color: C.teal }}>p(q)</span>, <span style={{ color: C.teal }}>c(q)</span>, <span style={{ color: C.teal }}>U(x)</span> — they stay symbolic in derivatives.
            </div>
          </div>
        )}

        {/* ── INTEGRAL ── */}
        {activeTool === "integral" && (
          <div style={{ padding: "0.85rem", background: C.surface, display: "flex", flexDirection: "column", gap: 10 }}>
            <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center" }}>
              <span style={{ fontFamily: T.code.fontFamily, fontSize: T.code.fontSize, color: C.textMuted, whiteSpace: "nowrap" }}>∫ f(</span>
              <input value={intVar} onChange={e => setIntVar(e.target.value)} placeholder="x"
                style={{ ...fieldStyle(C, T), width: 50 }} />
              <span style={{ fontFamily: T.code.fontFamily, fontSize: T.code.fontSize, color: C.textMuted, whiteSpace: "nowrap" }}>)</span>
              <span style={{ fontFamily: T.code.fontFamily, fontSize: T.code.fontSize, color: C.textMuted }}>d{intVar.trim() || "x"} =</span>
              <input value={intExpr} onChange={e => { setIntExpr(e.target.value); setIntResult(null); }}
                placeholder="x**2" onFocus={() => focusField(setIntExpr)}
                style={{ ...fieldStyle(C, T), flex: 1, minWidth: 180 }} />
              <EquationPicker savedEqs={savedEqs} onLoad={setIntExpr} />
            </div>
            <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center" }}>
              <span style={{ fontFamily: T.code.fontFamily, fontSize: T.caption.fontSize, color: C.textMuted }}>from</span>
              <input value={intA} onChange={e => { setIntA(e.target.value); setIntResult(null); }} placeholder="a"
                style={{ ...fieldStyle(C, T), width: 90 }} />
              <span style={{ fontFamily: T.code.fontFamily, fontSize: T.caption.fontSize, color: C.textMuted }}>to</span>
              <input value={intB} onChange={e => { setIntB(e.target.value); setIntResult(null); }} placeholder="b"
                style={{ ...fieldStyle(C, T), width: 90 }} />
              <Btn ch="Integrate" v="solid" color={C.blue} sm onClick={runIntegral} />
            </div>
            <div style={{ fontSize: T.caption.fontSize, color: C.textMuted }}>
              Composite Simpson's rule · 1000 intervals · Scope: {Object.keys(scope).filter(k => typeof scope[k] !== "function").join(", ") || "none"}
            </div>
            {intResult && (intResult.error ? <ErrBox msg={intResult.error} />
              : <ResultBox color={C.blue}>
                  <div>
                    <span style={{ color: C.textMuted }}>∫</span>
                    <span style={{ color: C.textMuted, fontSize: T.caption.fontSize }}>{intA}</span>
                    <span style={{ color: C.textMuted }}> → </span>
                    <span style={{ color: C.textMuted, fontSize: T.caption.fontSize }}>{intB}</span>
                    <span style={{ color: C.textMuted }}> f({intVar.trim() || "x"}) d{intVar.trim() || "x"} = </span>
                    <span style={{ color: C.blue, fontSize: T.body.fontSize }}>{fmt(intResult.value, 8)}</span>
                  </div>
                </ResultBox>
            )}
          </div>
        )}

        {activeTool === "limit" && (
          <div style={{ padding: "0.85rem", background: C.surface, display: "flex", flexDirection: "column", gap: 10 }}>
            <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center" }}>
              <span style={{ fontFamily: T.code.fontFamily, fontSize: T.code.fontSize, color: C.textMuted, whiteSpace: "nowrap" }}>f( </span>
              <input value={lVar} onChange={e => setLVar(e.target.value)} placeholder="x" style={{ ...fieldStyle(C, T), width: 60 }} />
              <span style={{ fontFamily: T.code.fontFamily, fontSize: T.code.fontSize, color: C.textMuted, whiteSpace: "nowrap" }}> ) =</span>
              <input value={lExpr} onChange={e => setLExpr(e.target.value)} placeholder="sin(x)/x"
                onFocus={() => focusField(setLExpr)}
                style={{ ...fieldStyle(C, T), flex: 1, minWidth: 180 }} />
              <EquationPicker savedEqs={savedEqs} onLoad={setLExpr} />
            </div>
            <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center" }}>
              <span style={{ fontFamily: T.code.fontFamily, fontSize: T.caption.fontSize, color: C.textMuted }}>as {lVar.trim() || "x"} →</span>
              <input value={lPoint} onChange={e => setLPoint(e.target.value)} placeholder="0, inf, -inf" style={{ ...fieldStyle(C, T), width: 90 }} />
              <Btn ch="Compute" v="solid" color={C.teal} sm onClick={runLimit} />
            </div>
            <div style={{ fontSize: T.caption.fontSize, color: C.textMuted }}>
              Other variables in scope: {Object.keys(scope).filter(k => k !== lVar.trim()).join(", ") || "none"}
            </div>
            {lResult && (lResult.error ? <ErrBox msg={lResult.error} />
              : <ResultBox color={lResult.exists ? C.teal : C.gold}>
                  <div>
                    <span style={{ color: C.textMuted }}>lim({lResult.varName} → {lResult.a === Infinity ? "∞" : lResult.a === -Infinity ? "−∞" : lResult.a}) f({lResult.varName}) = </span>
                    {lResult.exists
                      ? <span style={{ color: C.teal }}>{fmt(lResult.val, 8)}</span>
                      : <span style={{ color: C.gold }}>does not exist</span>}
                  </div>
                  {!lResult.exists && lResult.leftVal != null && lResult.rightVal != null && (
                    <div>
                      <span style={{ color: C.textMuted }}>left → </span><span style={{ color: C.text }}>{fmt(lResult.leftVal, 6)}</span>
                      <span style={{ color: C.textMuted }}> · right → </span><span style={{ color: C.text }}>{fmt(lResult.rightVal, 6)}</span>
                    </div>
                  )}
                  <div style={{ fontSize: T.caption.fontSize, color: C.textMuted, marginTop: 4 }}>{lResult.note} · numerical (sequence convergence)</div>
                </ResultBox>
            )}
          </div>
        )}
      </div>

      </div>{/* end left column */}

      {/* ── Right: Math Pad ── */}
      <div style={{ overflowY: "auto", padding: "1.8rem 2.4rem 1.8rem 1.5rem", borderLeft: `1px solid ${C.border}` }}>
        <MathPad C={C} savedEqs={savedEqs} setSavedEqs={setSavedEqs}
          padJsExpr={padJsExpr} setPadJsExpr={setPadJsExpr} activeFieldRef={activeFieldRef} />
      </div>

    </div>
  );
}
