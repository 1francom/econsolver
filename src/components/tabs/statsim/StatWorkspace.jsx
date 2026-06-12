// ─── ECON STUDIO · src/components/tabs/statsim/StatWorkspace.jsx ──────────────
// Variable workspace + statistics, moved out of CalculateTab into the
// "Stat & Simulation" tab (Equation Workbench reorg §7).
//
// Self-contained: owns its own variable/computed state, independent of the
// Calculate tab's Math Tools scope.
//
// Sections:
//   1. User-defined variables (scalar, vector, slider, expression)
//   2. Computed from dataset (aggregate statistics)
//   3. New dataset from vectors
//   4. Probability calculator
//   5. Distributions (random variate generation)
//   + Resampling & permutation inference (bootstrap / subsample / permutation)
//
// Props: rows, headers, onAddDataset(name, rows, headers),
//        onAddColumn(colName, values), onCreateDataset(name, rows, headers)

import { useState, useMemo } from "react";
import { evalExpression, buildScope,
  dnorm, pnorm, qnorm, dt, pt, qt, dbinom, pbinom, dpois, ppois, dchisq, pchisq, qchisq,
} from "../../../math/calcEngine.js";
import { bootstrapMean, subsampleMean, permutationTwoSampleMean, bootstrapStatistic, permutationTest, permutationCompare, permutationRegressionCoef } from "../../../math/Resampling.js";
import { mulberry32 } from "../../../math/rng.js";
import { useSessionLog } from "../../../services/session/sessionLog.jsx";
import { generateStatInferenceScript } from "../../../services/export/statInferenceScript.js";
import { useTheme } from "../../../ThemeContext.jsx";
import SampleTestPanel from "./SampleTestPanel.jsx";
import QTEPanel from "./QTEPanel.jsx";

const RS_LANGS = [["r", "R"], ["python", "Python"], ["stata", "Stata"]];

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
function generateCalcScript(language, variables, computeds) {
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

// ─── SEEDED PRNG ──────────────────────────────────────────────────────────────
// mulberry32 now lives in src/math/rng.js (shared); local makeRNG kept for the
// random-variate generators below.
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
  const yp = c => H - PB - (H - PT - PB) * (c / maxC);
  const bwPx = (W - PL - PR) / NBINS;
  return (
    <svg width={W} height={H} style={{ display: "block", marginTop: 4 }}>
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

// ─── DISTRIBUTIONS SECTION ────────────────────────────────────────────────────
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

// ─── MAIN COMPONENT ───────────────────────────────────────────────────────────
export default function StatWorkspace({ rows = [], headers = [], onAddDataset, onAddColumn, onCreateDataset }) {
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

  // Slider form state
  const [newSliderMin,  setNewSliderMin]  = useState("0");
  const [newSliderMax,  setNewSliderMax]  = useState("10");
  const [newSliderStep, setNewSliderStep] = useState("0.1");

  // ── Resampling & permutation inference ────────────────────────────────────
  const [rsOpen,    setRsOpen]    = useState(false);
  const [rsMode,    setRsMode]    = useState("boot");
  const [rsCol,     setRsCol]     = useState("");
  const [rsGroupCol,setRsGroupCol]= useState("");
  const [rsLevelA,  setRsLevelA]  = useState("");
  const [rsLevelB,  setRsLevelB]  = useState("");
  const [rsB,       setRsB]       = useState(2000);
  const [rsM,       setRsM]       = useState(0);
  const [rsResult,  setRsResult]  = useState(null);
  const [rsRunSpec, setRsRunSpec] = useState(null);
  const [rsCopied,  setRsCopied]  = useState("");
  const [rsBusy,    setRsBusy]    = useState(false);
  const [rsStat,    setRsStat]    = useState("mean");        // bootstrap statistic
  const [rsCiType,  setRsCiType]  = useState("percentile");
  const [rsSeed,    setRsSeed]    = useState("");
  const [rsContrast,setRsContrast]= useState("diffMeans");
  const [rsAlt,     setRsAlt]     = useState("two-sided");
  const [rsCompare, setRsCompare] = useState(false);       // perm: raw vs studentized side-by-side
  const [rsYCol,    setRsYCol]    = useState("");           // regperm: outcome Y
  const [rsDCol,    setRsDCol]    = useState("");           // regperm: regressor D (coef under test)
  const [rsCovCols, setRsCovCols] = useState([]);           // regperm: covariate columns Z

  function copyResamplingScript(lang) {
    if (!rsRunSpec || !rsResult || rsResult.error) return;
    const snippet = generateStatInferenceScript(lang, rsRunSpec.op, rsRunSpec.params, rsResult);
    navigator.clipboard?.writeText(snippet.trimStart()).then(() => {
      setRsCopied(lang);
      setTimeout(() => setRsCopied(""), 2000);
    }).catch(() => {});
  }

  // ── Probability ─────────────────────────────────────────────────────────────
  const [probOpen,  setProbOpen]  = useState(false);

  const NAME_RE = /^[a-zA-Z_][a-zA-Z0-9_]*$/;
  const numericHeaders = headers.filter(h => rows.some(r => !isNaN(Number(r[h])) && r[h] !== null && r[h] !== ""));
  const allNames = () => [...variables.map(v => v.name), ...computeds.map(c => c.name)];

  const scope = useMemo(() => buildScope(variables), [variables]);
  const evaluatedVars = useMemo(() => variables.map(v => {
    if (v.type !== "Expression") return v;
    const { value, error } = evalExpression(v.rawValue, scope);
    return { ...v, computed: error ? null : value, evalError: error };
  }), [variables, scope]);

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
                    style={{ background: "transparent", border: "none", color: C.textMuted, cursor: "pointer", fontFamily: T.code.fontFamily, fontSize: T.body.fontSize }}
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
            style={{ background: "transparent", border: "none", color: C.textMuted, cursor: "pointer", fontFamily: T.code.fontFamily, fontSize: T.body.fontSize }}
            onMouseEnter={e => e.currentTarget.style.color = C.red}
            onMouseLeave={e => e.currentTarget.style.color = C.textMuted}>×</button>
        </td>
      </tr>
    );
  }

  const vectorVars = variables.filter(v => v.type === "Vector");

  return (
    <div style={{ fontFamily: T.code.fontFamily, color: C.text }}>

      {/* Header + export buttons */}
      <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: "1.4rem", flexWrap: "wrap" }}>
        <div>
          <div style={{ fontSize: T.caption.fontSize, color: C.teal, letterSpacing: "0.26em", textTransform: "uppercase", marginBottom: 3 }}>Stat &amp; Simulation</div>
          <div style={{ fontSize: T.h2.fontSize, color: C.text, letterSpacing: "-0.01em" }}>Variable Workspace &amp; Statistics</div>
        </div>
        <div style={{ marginLeft: "auto", display: "flex", gap: 6, alignItems: "center" }}>
          {[["↓R","r",C.gold],["↓Stata","stata",C.teal],["↓py","python",C.blue]].map(([label,lang,color]) => (
            <button key={lang}
              onClick={() => download(generateCalcScript(lang, variables, computeds), `workspace.${lang === "r" ? "R" : lang === "stata" ? "do" : "py"}`)}
              style={{ padding: "0.3rem 0.7rem", background: "transparent", border: `1px solid ${C.border2}`, borderRadius: 3, color: C.textDim, cursor: "pointer", fontFamily: T.code.fontFamily, fontSize: T.caption.fontSize, transition: "all 0.12s" }}
              onMouseEnter={e => { e.currentTarget.style.borderColor = color; e.currentTarget.style.color = color; }}
              onMouseLeave={e => { e.currentTarget.style.borderColor = C.border2; e.currentTarget.style.color = C.textDim; }}
            >{label}</button>
          ))}
        </div>
      </div>

      {/* ── 1. User-defined variables ──────────────────────────────────────── */}
      <div style={{ border: `1px solid ${C.border}`, borderRadius: 4, overflow: "hidden", marginBottom: "1.4rem" }}>
        <div style={{ background: C.surface2, padding: "0.55rem 0.85rem", borderBottom: `1px solid ${C.border}` }}>
          <Lbl color={C.textDim} mb={0}>User-defined variables</Lbl>
        </div>
        {variables.length > 0 && (
          <table style={{ borderCollapse: "collapse", width: "100%" }}>
            <thead><tr>{["Name","Type","Value",""].map(h => <th key={h} style={thStyle(C, T)}>{h}</th>)}</tr></thead>
            <tbody>{variables.map(v => <VarRow key={v.id} v={v} />)}</tbody>
          </table>
        )}
        <div style={{ padding: "0.7rem 0.85rem", background: C.surface, borderTop: variables.length ? `1px solid ${C.border}` : "none", display: "flex", gap: 6, flexWrap: "wrap", alignItems: "flex-start" }}>
          <input placeholder="var_name" value={newName} onChange={e => { setNewName(e.target.value); setNameErr(""); }}
            onKeyDown={e => e.key === "Enter" && addVariable()} style={{ ...fieldStyle(C, T), width: 130 }} />
          <select value={newType} onChange={e => { setNewType(e.target.value); setNewValue(""); }} style={fieldStyle(C, T)}>
            {["Integer","Float","Slider","String","Date","Boolean","Vector","Expression"].map(t => <option key={t}>{t}</option>)}
          </select>
          {newType === "Slider"
            ? <>
                <span style={{ fontFamily: T.code.fontFamily, fontSize: T.caption.fontSize, color: C.textMuted, alignSelf: "center" }}>default</span>
                <input type="number" step="any" placeholder="1" value={newValue} onChange={e => setNewValue(e.target.value)}
                  style={{ ...fieldStyle(C, T), width: 56 }} />
                <span style={{ fontFamily: T.code.fontFamily, fontSize: T.caption.fontSize, color: C.textMuted, alignSelf: "center" }}>min</span>
                <input type="number" step="any" value={newSliderMin} onChange={e => setNewSliderMin(e.target.value)}
                  style={{ ...fieldStyle(C, T), width: 56 }} />
                <span style={{ fontFamily: T.code.fontFamily, fontSize: T.caption.fontSize, color: C.textMuted, alignSelf: "center" }}>max</span>
                <input type="number" step="any" value={newSliderMax} onChange={e => setNewSliderMax(e.target.value)}
                  style={{ ...fieldStyle(C, T), width: 56 }} />
                <span style={{ fontFamily: T.code.fontFamily, fontSize: T.caption.fontSize, color: C.textMuted, alignSelf: "center" }}>step</span>
                <input type="number" step="any" value={newSliderStep} onChange={e => setNewSliderStep(e.target.value)}
                  style={{ ...fieldStyle(C, T), width: 56 }} />
              </>
            : <ValueInput type={newType} value={newValue} onChange={setNewValue} />
          }
          <Btn ch="Add" v="solid" color={C.gold} onClick={addVariable} sm />
        </div>
        {nameErr && <div style={{ padding: "0 0.85rem 0.5rem", fontSize: T.caption.fontSize, color: C.red }}>{nameErr}</div>}
      </div>

      {/* ── 2. Computed from dataset ────────────────────────────────────────── */}
      <div style={{ border: `1px solid ${C.border}`, borderRadius: 4, overflow: "hidden", marginBottom: "1.4rem" }}>
        <SectionHeader label="Computed from dataset" open={computedOpen} onToggle={() => setComputedOpen(o => !o)} badge={!rows.length ? "no active dataset" : null} />
        {computedOpen && (
          <>
            {computeds.length > 0 && (
              <table style={{ borderCollapse: "collapse", width: "100%" }}>
                <thead><tr>{["Name","Type","Expression","Value",""].map(h => <th key={h} style={thStyle(C, T)}>{h}</th>)}</tr></thead>
                <tbody>
                  {computeds.map(c => (
                    <tr key={c.id}>
                      <td style={tdStyle(C)}><span style={{ fontFamily: T.code.fontFamily, fontSize: T.code.fontSize, color: C.text }}>{c.name}</span></td>
                      <td style={tdStyle(C)}><span style={{ fontSize: T.caption.fontSize, padding: "2px 6px", border: `1px solid ${C.textMuted}`, color: C.textMuted, borderRadius: 2, fontFamily: T.code.fontFamily }}>Computed</span></td>
                      <td style={tdStyle(C)}><span style={{ fontFamily: T.code.fontFamily, fontSize: T.code.fontSize, color: C.textDim }}>{c.fn}({c.col})</span></td>
                      <td style={{ ...tdStyle(C), color: C.teal, fontFamily: T.code.fontFamily, fontSize: T.code.fontSize }}>{evalComputed(c.fn, c.col, rows)}</td>
                      <td style={{ ...tdStyle(C), textAlign: "right" }}>
                        <button onClick={() => setComputeds(cs => cs.filter(x => x.id !== c.id))}
                          style={{ background: "transparent", border: "none", color: C.textMuted, cursor: "pointer", fontFamily: T.code.fontFamily, fontSize: T.body.fontSize }}
                          onMouseEnter={e => e.currentTarget.style.color = C.red}
                          onMouseLeave={e => e.currentTarget.style.color = C.textMuted}>×</button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
            <div style={{ padding: "0.7rem 0.85rem", background: C.surface, borderTop: computeds.length ? `1px solid ${C.border}` : "none", display: "flex", gap: 6, flexWrap: "wrap", alignItems: "center" }}>
              <input placeholder="var_name" value={newCName} onChange={e => setNewCName(e.target.value)} onKeyDown={e => e.key === "Enter" && addComputed()} style={{ ...fieldStyle(C, T), width: 130 }} />
              <select value={newCFn} onChange={e => setNewCFn(e.target.value)} style={fieldStyle(C, T)}>
                {["mean","sum","count","min","max"].map(f => <option key={f}>{f}</option>)}
              </select>
              <select value={newCCol || numericHeaders[0] || ""} onChange={e => setNewCCol(e.target.value)} style={{ ...fieldStyle(C, T), maxWidth: 200 }}>
                {numericHeaders.length ? numericHeaders.map(h => <option key={h}>{h}</option>) : <option value="">— no numeric columns —</option>}
              </select>
              <Btn ch="Add" v="solid" color={C.blue} onClick={addComputed} sm dis={!numericHeaders.length} />
            </div>
          </>
        )}
      </div>
      {/* ── 2b. Resampling & permutation inference ─────────────────────────── */}
      <div style={{ border: `1px solid ${C.border}`, borderRadius: 4, overflow: "hidden", marginBottom: "1.4rem" }}>
        <SectionHeader label="Resampling & permutation" open={rsOpen} onToggle={() => setRsOpen(o => !o)} badge={!rows.length ? "no active dataset" : null} />
        {rsOpen && (() => {
          const modeBtn = (id, label) => (
            <button key={id} onClick={() => { setRsMode(id); setRsResult(null); }}
              style={{
                background: rsMode === id ? `${C.teal}18` : "transparent",
                border: `1px solid ${rsMode === id ? C.teal : C.border2}`,
                color: rsMode === id ? C.teal : C.textDim,
                fontFamily: T.code.fontFamily, fontSize: T.caption.fontSize, letterSpacing: "0.08em",
                padding: "0.3rem 0.7rem", borderRadius: 2, cursor: "pointer",
              }}>{label}</button>
          );
          const colVals = (col) => rows.map(r => Number(r[col])).filter(v => isFinite(v));
          const levelsOf = (col) => {
            const seen = new Set();
            for (const r of rows) {
              const v = r[col]; if (v == null || v === "") continue;
              seen.add(String(v));
              if (seen.size > 200) break;
            }
            return [...seen];
          };
          const groupCandidates = headers.filter(h => {
            const lv = levelsOf(h);
            return lv.length >= 2 && lv.length <= 50;
          });
          const levels = rsGroupCol ? levelsOf(rsGroupCol) : [];
          const n = rsCol ? colVals(rsCol).length : 0;
          const mEffective = rsMode === "subsample"
            ? (rsM > 0 ? rsM : Math.max(2, Math.floor(n / 2)))
            : null;
          const ratioWarn = rsMode === "subsample" && n > 0 && mEffective / n > 0.5;

          function runRS() {
            if (rsMode === "regperm" ? (!rsYCol || !rsDCol) : !rsCol) return;
            setRsBusy(true); setRsResult(null); setRsRunSpec(null);
            setTimeout(() => {
              try {
                let res, scriptSpec = null;
                const seedArg = rsSeed === "" ? null : Number(rsSeed);
                if (rsMode === "boot") {
                  const values = colVals(rsCol);
                  res = bootstrapStatistic(values, rsStat, { B: rsB, alpha: 0.05, ciType: rsCiType, seed: seedArg });
                  if (!res.error) scriptSpec = {
                    op: "bootstrapStatistic",
                    params: { values, statName: rsStat, B: rsB, alpha: 0.05, ciType: rsCiType, seed: res.seed },
                  };
                } else if (rsMode === "subsample") {
                  res = subsampleMean(colVals(rsCol), mEffective, rsB, 0.05, seedArg);
                } else if (rsMode === "regperm") {
                  if (rsYCol === rsDCol) {
                    res = { error: "Outcome Y and regressor D must differ." };
                  } else {
                    // Pass row-aligned columns (NOT colVals — that filters NaNs per
                    // column and would break row alignment). The engine does its own
                    // listwise-complete deletion across Y, D, Z by row index.
                    const rawCol = (col) => rows.map(r => Number(r[col]));
                    res = permutationRegressionCoef(rawCol(rsYCol), rawCol(rsDCol), rsCovCols.map(rawCol), { B: rsB, seed: seedArg, alternative: rsAlt });
                  }
                } else {
                  if (!rsGroupCol || !rsLevelA || !rsLevelB || rsLevelA === rsLevelB) {
                    res = { error: "Pick two distinct levels of the group column." };
                  } else {
                    const a = [], b = [];
                    for (const r of rows) {
                      const v = Number(r[rsCol]); if (!isFinite(v)) continue;
                      const g = String(r[rsGroupCol]);
                      if (g === rsLevelA) a.push(v);
                      else if (g === rsLevelB) b.push(v);
                    }
                    res = rsCompare
                      ? permutationCompare(a, b, { B: rsB, exact: null, seed: seedArg, alternative: rsAlt })
                      : permutationTest(a, b, rsContrast, { B: rsB, exact: null, seed: seedArg, alternative: rsAlt });
                    if (!rsCompare && !res.error) scriptSpec = {
                      op: "permutationTest",
                      params: { a, b, statName: rsContrast, B: res.nPerm, exact: res.exact, seed: res.seed, alternative: rsAlt },
                    };
                  }
                }
                setRsResult(res);
                setRsRunSpec(scriptSpec);
                if (res && !res.error) {
                  if (rsMode === "boot") {
                    appendLog?.({
                      module: "stat", opType: "bootstrap",
                      params: { col: rsCol, statistic: rsStat, ciType: rsCiType, B: rsB, seed: res.seed },
                      label: `Bootstrap ${rsStat}(${rsCol}): est=${res.estimate?.toFixed?.(4)}, 95% CI=[${res.ciLow?.toFixed?.(4)}, ${res.ciHigh?.toFixed?.(4)}] (${res.ciType}), seed=${res.seed}`,
                    });
                  } else if (rsMode === "subsample") {
                    appendLog?.({
                      module: "stat", opType: "subsample",
                      params: { col: rsCol, m: res.m, B: rsB, seed: res.seed },
                      label: `Subsample mean(${rsCol}): est=${res.meanHat?.toFixed?.(4)}, m=${res.m}, seed=${res.seed}`,
                    });
                  } else if (rsMode === "regperm") {
                    appendLog?.({
                      module: "stat", opType: "permutation",
                      params: { y: rsYCol, d: rsDCol, covariates: rsCovCols, method: "freedman-lane", alternative: rsAlt, B: rsB, seed: res.seed },
                      label: `Freedman–Lane β(${rsDCol}) on ${rsYCol}${rsCovCols.length ? ` | ${rsCovCols.join(", ")}` : ""}: β=${res.betaD?.toFixed?.(4)}, t=${res.tD?.toFixed?.(4)}, p_raw=${res.raw.pValue?.toFixed?.(4)}, p_stud=${res.stud.pValue?.toFixed?.(4)}, B=${res.nPerm}, seed=${res.seed}`,
                    });
                  } else if (res.compare) {
                    appendLog?.({
                      module: "stat", opType: "permutation",
                      params: { col: rsCol, groupCol: rsGroupCol, levelA: rsLevelA, levelB: rsLevelB, contrast: "raw_vs_studentized", alternative: rsAlt, B: rsB, exact: res.exact, seed: res.seed },
                      label: `Permutation raw vs studentized (${rsLevelA} vs ${rsLevelB}): p_raw=${res.raw.pValue?.toFixed?.(4)}, p_stud=${res.stud.pValue?.toFixed?.(4)}, ${res.exact ? `exact (${res.nPerm} perms)` : `MC B=${res.nPerm}, seed=${res.seed}`}`,
                    });
                  } else {
                    appendLog?.({
                      module: "stat", opType: "permutation",
                      params: { col: rsCol, groupCol: rsGroupCol, levelA: rsLevelA, levelB: rsLevelB, contrast: rsContrast, alternative: rsAlt, B: rsB, exact: res.exact, seed: res.seed },
                      label: `Permutation ${rsContrast} (${rsLevelA} vs ${rsLevelB}): obs=${res.observed?.toFixed?.(4)}, p=${res.pValue?.toFixed?.(4)}, ${res.exact ? `exact (${res.nPerm} perms)` : `MC B=${res.nPerm}, seed=${res.seed}`}`,
                    });
                  }
                }
              } catch (e) {
                setRsResult({ error: e.message });
              } finally {
                setRsBusy(false);
              }
            }, 0);
          }

          return (
            <div style={{ padding: "0.8rem 0.85rem", background: C.surface, display: "flex", flexDirection: "column", gap: 10 }}>
              <div style={{ display: "flex", gap: 6 }}>
                {modeBtn("boot", "Bootstrap (with replacement)")}
                {modeBtn("subsample", "Subsample (without replacement)")}
                {modeBtn("perm", "Permutation (2-sample)")}
                {modeBtn("regperm", "Regression coef (Freedman–Lane)")}
              </div>

              <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center" }}>
                {rsMode !== "regperm" && (<>
                <span style={{ fontFamily: T.code.fontFamily, fontSize: T.caption.fontSize, color: C.textMuted }}>variable</span>
                <select value={rsCol} onChange={e => { setRsCol(e.target.value); setRsResult(null); }} style={{ ...fieldStyle(C, T), maxWidth: 220 }}>
                  <option value="">— pick numeric column —</option>
                  {numericHeaders.map(h => <option key={h}>{h}</option>)}
                </select>
                </>)}

                {rsMode === "boot" && (
                  <>
                    <span style={{ fontFamily: T.code.fontFamily, fontSize: T.caption.fontSize, color: C.textMuted }}>statistic</span>
                    <select value={rsStat} onChange={e => { setRsStat(e.target.value); setRsResult(null); }} style={{ ...fieldStyle(C, T), maxWidth: 140 }}>
                      <option value="mean">mean</option>
                      <option value="median">median</option>
                      <option value="sd">sd</option>
                      <option value="variance">variance</option>
                      <option value="trimmedMean10">trimmed mean 10%</option>
                      <option value="iqr">IQR</option>
                    </select>
                    <span style={{ fontFamily: T.code.fontFamily, fontSize: T.caption.fontSize, color: C.textMuted }}>CI</span>
                    <select value={rsCiType} onChange={e => { setRsCiType(e.target.value); setRsResult(null); }} style={{ ...fieldStyle(C, T), maxWidth: 130 }}>
                      <option value="percentile">percentile</option>
                      <option value="basic">basic</option>
                      <option value="bca">BCa</option>
                    </select>
                  </>
                )}

                {rsMode === "perm" && (
                  <>
                    <span style={{ fontFamily: T.code.fontFamily, fontSize: T.caption.fontSize, color: C.textMuted }}>group</span>
                    <select value={rsGroupCol} onChange={e => { setRsGroupCol(e.target.value); setRsLevelA(""); setRsLevelB(""); setRsResult(null); }} style={{ ...fieldStyle(C, T), maxWidth: 200 }}>
                      <option value="">— pick group column —</option>
                      {groupCandidates.map(h => <option key={h}>{h}</option>)}
                    </select>
                    <span style={{ fontFamily: T.code.fontFamily, fontSize: T.caption.fontSize, color: C.textMuted }}>A</span>
                    <select value={rsLevelA} onChange={e => { setRsLevelA(e.target.value); setRsResult(null); }} style={{ ...fieldStyle(C, T), maxWidth: 140 }} disabled={!levels.length}>
                      <option value="">—</option>
                      {levels.map(l => <option key={l}>{l}</option>)}
                    </select>
                    <span style={{ fontFamily: T.code.fontFamily, fontSize: T.caption.fontSize, color: C.textMuted }}>B</span>
                    <select value={rsLevelB} onChange={e => { setRsLevelB(e.target.value); setRsResult(null); }} style={{ ...fieldStyle(C, T), maxWidth: 140 }} disabled={!levels.length}>
                      <option value="">—</option>
                      {levels.map(l => <option key={l}>{l}</option>)}
                    </select>
                    <span style={{ fontFamily: T.code.fontFamily, fontSize: T.caption.fontSize, color: C.textMuted }}>contrast</span>
                    <select value={rsContrast} onChange={e => { setRsContrast(e.target.value); setRsResult(null); }} disabled={rsCompare} style={{ ...fieldStyle(C, T), maxWidth: 180, opacity: rsCompare ? 0.5 : 1 }}>
                      <option value="diffMeans">diff of means</option>
                      <option value="studDiffMeans">studentized diff (Welch t)</option>
                      <option value="diffMedians">diff of medians</option>
                      <option value="diffSd">diff of sd</option>
                      <option value="meanRatio">ratio of means</option>
                    </select>
                    <select value={rsAlt} onChange={e => { setRsAlt(e.target.value); setRsResult(null); }} style={{ ...fieldStyle(C, T) }}>
                      <option value="two-sided">two-sided</option>
                      <option value="greater">greater</option>
                      <option value="less">less</option>
                    </select>
                    <label style={{ display: "flex", alignItems: "center", gap: 5, cursor: "pointer", fontFamily: T.code.fontFamily, fontSize: T.caption.fontSize, color: rsCompare ? C.teal : C.textMuted }}>
                      <input type="checkbox" checked={rsCompare} onChange={e => { setRsCompare(e.target.checked); setRsResult(null); }} />
                      compare raw vs studentized
                    </label>
                  </>
                )}

                {rsMode === "regperm" && (
                  <>
                    <span style={{ fontFamily: T.code.fontFamily, fontSize: T.caption.fontSize, color: C.textMuted }}>outcome Y</span>
                    <select value={rsYCol} onChange={e => { setRsYCol(e.target.value); setRsResult(null); }} style={{ ...fieldStyle(C, T), maxWidth: 160 }}>
                      <option value="">— pick Y —</option>
                      {numericHeaders.map(h => <option key={h}>{h}</option>)}
                    </select>
                    <span style={{ fontFamily: T.code.fontFamily, fontSize: T.caption.fontSize, color: C.textMuted }}>regressor D</span>
                    <select value={rsDCol} onChange={e => { setRsDCol(e.target.value); setRsResult(null); }} style={{ ...fieldStyle(C, T), maxWidth: 160 }}>
                      <option value="">— pick D —</option>
                      {numericHeaders.filter(h => h !== rsYCol).map(h => <option key={h}>{h}</option>)}
                    </select>
                    <span style={{ fontFamily: T.code.fontFamily, fontSize: T.caption.fontSize, color: C.textMuted }}>covariates Z</span>
                    <div style={{ display: "flex", gap: 4, flexWrap: "wrap" }}>
                      {numericHeaders.filter(h => h !== rsYCol && h !== rsDCol).map(h => {
                        const on = rsCovCols.includes(h);
                        return <button key={h} onClick={() => { setRsCovCols(cs => on ? cs.filter(c => c !== h) : [...cs, h]); setRsResult(null); }}
                          style={{ padding: "0.2rem 0.5rem", fontFamily: T.code.fontFamily, fontSize: T.caption.fontSize, cursor: "pointer", borderRadius: 3, background: on ? `${C.blue}22` : "transparent", border: `1px solid ${on ? C.blue : C.border2}`, color: on ? C.blue : C.textDim }}>{h}</button>;
                      })}
                      {numericHeaders.filter(h => h !== rsYCol && h !== rsDCol).length === 0 && <span style={{ fontFamily: T.code.fontFamily, fontSize: T.caption.fontSize, color: C.textDim }}>none</span>}
                    </div>
                    <select value={rsAlt} onChange={e => { setRsAlt(e.target.value); setRsResult(null); }} style={{ ...fieldStyle(C, T) }}>
                      <option value="two-sided">two-sided</option>
                      <option value="greater">greater</option>
                      <option value="less">less</option>
                    </select>
                  </>
                )}

                {rsMode === "subsample" && (
                  <>
                    <span style={{ fontFamily: T.code.fontFamily, fontSize: T.caption.fontSize, color: C.textMuted }}>m</span>
                    <input type="number" min={2} step={1} value={rsM || ""} placeholder={n ? `${Math.max(2, Math.floor(n/2))}` : "auto"}
                      onChange={e => setRsM(Math.max(0, parseInt(e.target.value) || 0))}
                      style={{ ...fieldStyle(C, T), width: 72 }} />
                    <span style={{ fontFamily: T.code.fontFamily, fontSize: T.caption.fontSize, color: C.textMuted }}>of n={n || "—"}</span>
                  </>
                )}

                <span style={{ fontFamily: T.code.fontFamily, fontSize: T.caption.fontSize, color: C.textMuted, marginLeft: 8 }}>replicates B</span>
                <input type="number" min={50} step={100} value={rsB}
                  onChange={e => setRsB(Math.max(50, parseInt(e.target.value) || 50))}
                  style={{ ...fieldStyle(C, T), width: 80 }} />

                <span style={{ fontFamily: T.code.fontFamily, fontSize: T.caption.fontSize, color: C.textMuted, marginLeft: 8 }}>seed</span>
                <input type="number" step="1" value={rsSeed} placeholder="auto"
                  onChange={e => setRsSeed(e.target.value)} style={{ ...fieldStyle(C, T), width: 80 }} />

                <Btn ch={rsBusy ? "Running…" : "Run"} v="solid" color={C.teal} onClick={runRS} sm
                  dis={rsBusy || (rsMode === "regperm"
                    ? (!rsYCol || !rsDCol || rsYCol === rsDCol)
                    : (!rsCol || (rsMode === "perm" && (!rsGroupCol || !rsLevelA || !rsLevelB || rsLevelA === rsLevelB))))} />
              </div>

              {ratioWarn && (
                <div style={{ fontFamily: T.code.fontFamily, fontSize: T.caption.fontSize, color: C.gold }}>
                  ⚠ Subsample ratio m/n = {(mEffective/n).toFixed(2)} &gt; 0.5 — Politis–Romano SE assumes m/n → 0; rescaled SE may be biased.
                </div>
              )}

              {rsResult?.error && <ErrBox msg={rsResult.error} />}

              {rsResult && !rsResult.error && rsResult.ciType && (
                <ResultBox color={C.teal}>
                  <div>{rsResult.stat}    = <span style={{ color: C.teal }}>{fmt(rsResult.estimate, 4)}</span> &nbsp;&nbsp; B = {rsResult.B} &nbsp;&nbsp; seed = {rsResult.seed}</div>
                  <div>SE_boot   = {fmt(rsResult.bootSE, 4)} &nbsp;&nbsp; bias = {fmt(rsResult.bias, 4)}</div>
                  <div>95% CI    = [{fmt(rsResult.ciLow, 4)}, {fmt(rsResult.ciHigh, 4)}] &nbsp;({rsResult.ciType})</div>
                  <ReplicateHistogram replicates={rsResult.replicates} marker={rsResult.estimate} ciLo={rsResult.ciLow} ciHi={rsResult.ciHigh} />
                </ResultBox>
              )}

              {rsResult && !rsResult.error && rsResult.method === "subsample" && (
                <ResultBox color={C.teal}>
                  <div>mean       = <span style={{ color: C.teal }}>{fmt(rsResult.meanHat, 4)}</span> &nbsp;&nbsp; n = {rsResult.nUsed} &nbsp;&nbsp; m = {rsResult.m} &nbsp;&nbsp; B = {rsResult.B}</div>
                  <div>SE_sub(m)  = {fmt(rsResult.seSubsample, 4)} &nbsp;(SE at sample size m)</div>
                  <div>SE_n       = {fmt(rsResult.seNScaled, 4)} &nbsp;(rescaled · √(m/n))</div>
                  <div>95% CI     = [{fmt(rsResult.ciLo, 4)}, {fmt(rsResult.ciHi, 4)}] &nbsp;(Politis–Romano)</div>
                  <ReplicateHistogram replicates={rsResult.replicates} marker={rsResult.meanHat} ciLo={rsResult.ciLo} ciHi={rsResult.ciHi} />
                </ResultBox>
              )}

              {rsResult && !rsResult.error && rsResult.contrast && (
                <ResultBox color={C.gold}>
                  <div>contrast  = {rsResult.contrast} &nbsp;&nbsp; ({rsLevelA} vs {rsLevelB})</div>
                  <div>observed  = <span style={{ color: C.gold }}>{fmt(rsResult.observed, 4)}</span></div>
                  <div>p ({rsResult.alternative}) = <span style={{ color: rsResult.pValue < 0.05 ? C.gold : C.textDim }}>{fmt(rsResult.pValue, 4)}</span> &nbsp; {rsResult.exact ? `exact (${rsResult.nPerm} perms)` : `MC B=${rsResult.nPerm}, seed=${rsResult.seed}`}</div>
                  <ReplicateHistogram replicates={rsResult.replicates} marker={rsResult.observed} color={C.gold} />
                </ResultBox>
              )}

              {rsRunSpec && rsResult && !rsResult.error && (
                <div style={{ display: "flex", gap: 6, alignItems: "center" }}>
                  <span style={{ fontSize: T.caption.fontSize, color: C.textMuted, fontFamily: T.code.fontFamily }}>copy test code</span>
                  {RS_LANGS.map(([id, label]) => (
                    <button key={id} onClick={() => copyResamplingScript(id)}
                      style={{ padding: "2px 10px", fontFamily: T.code.fontFamily, fontSize: T.caption.fontSize, letterSpacing: "0.08em", border: `1px solid ${rsCopied === id ? C.teal : C.border2}`, borderRadius: 2, background: rsCopied === id ? `${C.teal}1a` : "transparent", color: rsCopied === id ? C.teal : C.textMuted, cursor: "pointer" }}>
                      {rsCopied === id ? "✓" : label}
                    </button>
                  ))}
                </div>
              )}

              {rsResult && !rsResult.error && rsResult.compare && !rsResult.regression && (
                <>
                  <div style={{ fontFamily: T.code.fontFamily, fontSize: T.caption.fontSize, color: C.textMuted, lineHeight: 1.5, padding: "2px 0" }}>
                    Same {rsResult.exact ? `${rsResult.nPerm} exact` : `${rsResult.nPerm} Monte-Carlo`} relabellings of the group
                    label, two statistics. The <span style={{ color: C.gold }}>raw</span> difference-in-means tests the strong
                    null that both groups are <em>identically distributed</em> (exchangeable); the
                    <span style={{ color: C.teal }}> studentized</span> Welch-t divides by the SE recomputed inside each
                    permutation, so it stays calibrated under unequal variances and tests the weaker null of <em>equal means</em>.
                    The shuffle is identical for both — only the statistic differs. (Reading the shuffle as the design's own
                    re-randomization rather than population exchangeability is the permutation-vs-randomization distinction; the
                    arithmetic is the same.)
                  </div>
                  <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
                    <div style={{ flex: "1 1 240px", minWidth: 240 }}>
                      <ResultBox color={C.gold}>
                        <div>raw diff of means &nbsp;({rsLevelA} vs {rsLevelB})</div>
                        <div>observed = <span style={{ color: C.gold }}>{fmt(rsResult.raw.observed, 4)}</span></div>
                        <div>p ({rsResult.alternative}) = <span style={{ color: rsResult.raw.pValue < 0.05 ? C.gold : C.textDim }}>{fmt(rsResult.raw.pValue, 4)}</span></div>
                        <ReplicateHistogram replicates={rsResult.raw.replicates} marker={rsResult.raw.observed} color={C.gold} />
                      </ResultBox>
                    </div>
                    <div style={{ flex: "1 1 240px", minWidth: 240 }}>
                      <ResultBox color={C.teal}>
                        <div>studentized (Welch t) &nbsp;({rsLevelA} vs {rsLevelB})</div>
                        <div>observed = <span style={{ color: C.teal }}>{fmt(rsResult.stud.observed, 4)}</span></div>
                        <div>p ({rsResult.alternative}) = <span style={{ color: rsResult.stud.pValue < 0.05 ? C.teal : C.textDim }}>{fmt(rsResult.stud.pValue, 4)}</span></div>
                        <ReplicateHistogram replicates={rsResult.stud.replicates} marker={rsResult.stud.observed} color={C.teal} />
                      </ResultBox>
                    </div>
                  </div>
                  <div style={{ fontFamily: T.code.fontFamily, fontSize: T.caption.fontSize, color: C.textDim }}>
                    {rsResult.exact ? `exact enumeration (${rsResult.nPerm} permutations)` : `Monte-Carlo B=${rsResult.nPerm}, seed=${rsResult.seed}`}
                  </div>
                </>
              )}

              {rsResult && !rsResult.error && rsResult.regression && (
                <>
                  <div style={{ fontFamily: T.code.fontFamily, fontSize: T.caption.fontSize, color: C.textMuted, lineHeight: 1.5, padding: "2px 0" }}>
                    Freedman–Lane tests H₀: β(<span style={{ color: C.blue }}>{rsDCol}</span>) = 0 in&nbsp;
                    <span style={{ color: C.text }}>{rsYCol} ~ {rsDCol}{rsCovCols.length ? " + " + rsCovCols.join(" + ") : ""}</span>.
                    The reduced model {rsYCol} ~ 1{rsCovCols.length ? " + " + rsCovCols.join(" + ") : ""} is fit once; its residuals are
                    permuted and added back to the reduced fitted values to build each y*, which is re-regressed on the full design.
                    The <span style={{ color: C.gold }}>raw</span> slope β* and the <span style={{ color: C.teal }}>studentized</span> t* = β*/se(β*)
                    are read off the SAME permutations — only the studentized one stays calibrated under heteroskedasticity.
                  </div>
                  <ResultBox color={C.blue}>
                    <div>observed   β({rsDCol}) = <span style={{ color: C.blue }}>{fmt(rsResult.betaD, 4)}</span> &nbsp;&nbsp; se = {fmt(rsResult.seD, 4)} &nbsp;&nbsp; t = {fmt(rsResult.tD, 4)}</div>
                    <div>n = {rsResult.n} &nbsp;&nbsp; k = {rsResult.k} &nbsp;&nbsp; df = {rsResult.dfResid} &nbsp;&nbsp; covariates = {rsResult.nCov}</div>
                  </ResultBox>
                  <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
                    <div style={{ flex: "1 1 240px", minWidth: 240 }}>
                      <ResultBox color={C.gold}>
                        <div>raw slope β({rsDCol})</div>
                        <div>observed = <span style={{ color: C.gold }}>{fmt(rsResult.raw.observed, 4)}</span></div>
                        <div>p ({rsResult.alternative}) = <span style={{ color: rsResult.raw.pValue < 0.05 ? C.gold : C.textDim }}>{fmt(rsResult.raw.pValue, 4)}</span></div>
                        <ReplicateHistogram replicates={rsResult.raw.replicates} marker={rsResult.raw.observed} color={C.gold} />
                      </ResultBox>
                    </div>
                    <div style={{ flex: "1 1 240px", minWidth: 240 }}>
                      <ResultBox color={C.teal}>
                        <div>studentized t({rsDCol})</div>
                        <div>observed = <span style={{ color: C.teal }}>{fmt(rsResult.stud.observed, 4)}</span></div>
                        <div>p ({rsResult.alternative}) = <span style={{ color: rsResult.stud.pValue < 0.05 ? C.teal : C.textDim }}>{fmt(rsResult.stud.pValue, 4)}</span></div>
                        <ReplicateHistogram replicates={rsResult.stud.replicates} marker={rsResult.stud.observed} color={C.teal} />
                      </ResultBox>
                    </div>
                  </div>
                  <div style={{ fontFamily: T.code.fontFamily, fontSize: T.caption.fontSize, color: C.textDim }}>
                    Monte-Carlo B={rsResult.nPerm}, seed={rsResult.seed}
                  </div>
                </>
              )}
            </div>
          );
        })()}
      </div>

      {/* ── 2c. Hypothesis test (mean / variance / parameter) ──────────────── */}
      <SampleTestPanel
        title="∗ Hypothesis test"
        columns={numericHeaders.map(h => ({ name: h, values: rows.map(r => Number(r[h])) }))}
      />

      {/* ── 2d. Quantile Treatment Effects (unconditional) ─────────────────── */}
      <QTEPanel
        title="∗ Quantile Treatment Effects"
        columns={numericHeaders.map(h => ({ name: h, values: rows.map(r => Number(r[h])) }))}
      />

      {/* ── 3. Dataset from vectors ─────────────────────────────────────────── */}
      {vectorVars.length > 0 && (
        <div style={{ border: `1px solid ${C.border}`, borderRadius: 4, overflow: "hidden", marginBottom: "1.4rem" }}>
          <div style={{ background: C.surface2, padding: "0.55rem 0.85rem", borderBottom: `1px solid ${C.border}`, display: "flex", alignItems: "center", justifyContent: "space-between" }}>
            <Lbl color={C.textDim} mb={0}>New dataset from variables</Lbl>
            {!datasetForm && <Btn ch="+ Create dataset" sm v="solid" color={C.teal} onClick={() => setDatasetForm({ name: "", selectedVars: [] })} />}
          </div>
          {datasetForm
            ? <div style={{ padding: "0.8rem 0.85rem", background: C.surface, display: "flex", flexDirection: "column", gap: 10 }}>
                <input placeholder="dataset name" value={datasetForm.name} onChange={e => setDatasetForm(f => ({ ...f, name: e.target.value }))} style={{ ...fieldStyle(C, T), width: 220 }} />
                <div>
                  <Lbl color={C.textMuted} mb={6}>Select Vector columns</Lbl>
                  <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
                    {vectorVars.map(v => {
                      const sel = datasetForm.selectedVars.includes(v.name);
                      return <button key={v.name}
                        onClick={() => setDatasetForm(f => ({ ...f, selectedVars: sel ? f.selectedVars.filter(n => n !== v.name) : [...f.selectedVars, v.name] }))}
                        style={{ padding: "0.25rem 0.6rem", fontFamily: T.code.fontFamily, fontSize: T.caption.fontSize, cursor: "pointer", borderRadius: 3, background: sel ? `${C.purple}20` : "transparent", border: `1px solid ${sel ? C.purple : C.border2}`, color: sel ? C.purple : C.textDim }}>
                        {v.name}
                      </button>;
                    })}
                  </div>
                </div>
                <div style={{ display: "flex", gap: 6 }}>
                  <Btn ch="Create" v="solid" color={C.teal} sm dis={!datasetForm.name.trim() || !datasetForm.selectedVars.length} onClick={buildDataset} />
                  <Btn ch="Cancel" sm onClick={() => setDatasetForm(null)} />
                </div>
              </div>
            : <div style={{ padding: "0.5rem 0.85rem", background: C.surface, fontSize: T.caption.fontSize, color: C.textMuted }}>{vectorVars.map(v => v.name).join(", ")} · {vectorVars.length} vector{vectorVars.length > 1 ? "s" : ""} available</div>
          }
        </div>
      )}

      {/* ── 4. Probability Calculator ───────────────────────────────────────── */}
      <div style={{ border: `1px solid ${C.border}`, borderRadius: 4, overflow: "hidden", marginBottom: "1.4rem" }}>
        <SectionHeader label="∫ Probability" open={probOpen} onToggle={() => setProbOpen(o => !o)} />
        {probOpen && <div style={{ background: C.surface }}><ProbCalc /></div>}
      </div>

      {/* ── 5. Distributions ─────────────────────────────────────────────────── */}
      <DistributionsSection onAddColumn={onAddColumn} onCreateDataset={onCreateDataset ?? onAddDataset} />

    </div>
  );
}
