// ─── ECON STUDIO · src/components/tabs/SimulateTab.jsx ────────────────────────
// Phase 9.8 — Simulate Tab: DGP builder for synthetic dataset generation.
// Props: onAddDataset(name, rows, headers)

import { useState } from "react";
import { useTheme, mono } from "../modeling/shared.jsx";
import { HintBox } from "../HelpSystem.jsx";
import { evalScope as evalScopeInWorker } from "../../services/exprEvalService.js";
import { useSessionLog } from "../../services/session/sessionLog.jsx";
import { mulberry32 } from "../../math/rng.js";
import { drawSamples } from "../../math/dgpDraw.js";
import StatWorkspace from "./statsim/StatWorkspace.jsx";
import SampleTestPanel from "./statsim/SampleTestPanel.jsx";
import QTEPanel from "./statsim/QTEPanel.jsx";

// ─── ATOMS ────────────────────────────────────────────────────────────────────
function Lbl({ children, color, mb = 6 }) {
  const { C } = useTheme();
  return <div style={{ fontSize: 9, color: color ?? C.textMuted, letterSpacing: "0.2em", textTransform: "uppercase", marginBottom: mb, fontFamily: mono }}>{children}</div>;
}
function Btn({ onClick, ch, color, v = "out", dis = false, sm = false }) {
  const { C } = useTheme();
  const c = color ?? C.gold;
  const b = { padding: sm ? "0.28rem 0.65rem" : "0.45rem 0.9rem", borderRadius: 3, cursor: dis ? "not-allowed" : "pointer", fontFamily: mono, fontSize: sm ? 10 : 11, transition: "all 0.13s", opacity: dis ? 0.4 : 1 };
  if (v === "solid") return <button onClick={onClick} disabled={dis} style={{ ...b, background: c, color: C.bg, border: `1px solid ${c}`, fontWeight: 700 }}>{ch}</button>;
  if (v === "ghost") return <button onClick={onClick} disabled={dis} style={{ ...b, background: "transparent", border: "none", color: dis ? C.textMuted : c }}>{ch}</button>;
  return <button onClick={onClick} disabled={dis} style={{ ...b, background: "transparent", border: `1px solid ${C.border2}`, color: dis ? C.textMuted : C.textDim }}>{ch}</button>;
}
const fieldStyle = C => ({ background: C.surface2, border: `1px solid ${C.border2}`, borderRadius: 3, color: C.text, fontFamily: mono, fontSize: 11, padding: "0.28rem 0.55rem", outline: "none" });
const thStyle    = C => ({ padding: "0.4rem 0.75rem", textAlign: "left", fontFamily: mono, fontWeight: 400, fontSize: 9, letterSpacing: "0.16em", textTransform: "uppercase", borderBottom: `1px solid ${C.border}`, color: C.textMuted, background: C.surface2, whiteSpace: "nowrap" });
const tdStyle    = C => ({ padding: "0.32rem 0.65rem", borderBottom: `1px solid ${C.border}`, verticalAlign: "middle" });

// ─── SEEDED PRNG ──────────────────────────────────────────────────────────────
// mulberry32 now lives in src/math/rng.js (shared across the Stat & Simulation
// module). The shared algorithm is byte-identical to the previous local copy.

// normalSample / drawSamples / coerceLevel / parseLevels now live in the shared
// src/math/dgpDraw.js (imported above) — single source with the worker.

// ─── SCOPE BUILDER (pure — no React; shared by generate() and runMonteCarlo) ──
function buildScope(variables, nObs, rng) {
  const scope = {};
  for (const v of variables) {
    if (!v.name.trim()) return { error: "Variable with empty name." };
    if (v.dist === "Expression") {
      const expr = (v.params.expr || "").trim();
      if (!expr) return { error: `${v.name}: expression is empty.` };
      try {
        const varNames = Object.keys(scope), varArrays = Object.values(scope);
        // The expression evaluator is intentional — user-defined DGP expressions
        // are evaluated in a sandboxed scope with only DGP variables exposed.
        // eslint-disable-next-line no-new-func
        const fn = new Function(...varNames, "N", "observations", `"use strict"; return (${expr});`);
        const arr = [];
        for (let i = 0; i < nObs; i++) arr.push(fn(...varArrays.map(a => a[i]), nObs, nObs));
        scope[v.name] = arr;
      } catch (e) { return { error: `${v.name}: ${e.message}` }; }
    } else if (v.dist === "Constant") {
      const raw = (v.params.value ?? "0").trim();
      try {
        // eslint-disable-next-line no-new-func
        const val = new Function("N", "observations", `"use strict"; return (${raw});`)(nObs, nObs);
        scope[v.name] = new Array(nObs).fill(typeof val === "number" || typeof val === "string" ? val : 0);
      } catch (e) { return { error: `${v.name}: ${e.message}` }; }
    } else if (v.dist === "Sequence") {
      const from = +(v.params.from ?? 1), by = +(v.params.by ?? 1);
      scope[v.name] = Array.from({ length: nObs }, (_, i) => from + i * by);
    } else if (v.dist === "ForLoop") {
      const initExpr = (v.params.init || "0").trim(), updExpr = (v.params.update || "prev").trim();
      const varNames = Object.keys(scope), varArrays = Object.values(scope);
      try {
        const arr = new Array(nObs);
        // eslint-disable-next-line no-new-func
        const initFn = new Function(...varNames, "N", "observations", `"use strict"; return (${initExpr});`);
        arr[0] = initFn(...varArrays.map(a => a[0]), nObs, nObs);
        // eslint-disable-next-line no-new-func
        const updFn = new Function("prev", "i", ...varNames, "N", "observations", `"use strict"; return (${updExpr});`);
        for (let i = 1; i < nObs; i++) arr[i] = updFn(arr[i - 1], i, ...varArrays.map(a => a[i]), nObs, nObs);
        scope[v.name] = arr;
      } catch (e) { return { error: `${v.name}: ${e.message}` }; }
    } else if (v.dist === "WhileLoop") {
      const initExpr = (v.params.init || "1").trim(), updExpr = (v.params.update || "prev").trim();
      const condExpr = (v.params.condition || "false").trim();
      const maxIter = Math.max(1, Math.min(100000, +(v.params.maxIter) || 1000));
      try {
        // eslint-disable-next-line no-new-func
        let val = new Function(`"use strict"; return (${initExpr});`)();
        let iter = 0;
        // eslint-disable-next-line no-new-func
        const condFn = new Function("prev", `"use strict"; return !!(${condExpr});`);
        // eslint-disable-next-line no-new-func
        const updFn  = new Function("prev", `"use strict"; return (${updExpr});`);
        while (condFn(val) && iter < maxIter) { val = updFn(val); iter++; }
        scope[v.name] = new Array(nObs).fill(typeof val === "number" ? val : 0);
      } catch (e) { return { error: `${v.name}: ${e.message}` }; }
    } else {
      scope[v.name] = drawSamples(rng, nObs, v.dist, v.params);
    }
  }
  return { scope };
}

// ─── FAST OLS (single regressor + intercept, for MC loop) ─────────────────────
function tCrit95(df) {
  if (df >= 120) return 1.960;
  const lut = { 1:12.706,2:4.303,3:3.182,5:2.571,10:2.228,15:2.131,20:2.086,25:2.060,30:2.042,40:2.021,60:2.000,80:1.990,100:1.984 };
  const keys = Object.keys(lut).map(Number).sort((a,b)=>a-b);
  for (const k of keys) if (df <= k) return lut[k];
  return 1.960;
}
function fastOLS1(ys, xs) {
  const n = ys.length; if (n < 3) return null;
  let sx=0,sy=0,sxx=0,sxy=0;
  for(let i=0;i<n;i++){sx+=xs[i];sy+=ys[i];sxx+=xs[i]*xs[i];sxy+=xs[i]*ys[i];}
  const xb=sx/n,yb=sy/n,sxx2=sxx-n*xb*xb;
  if(Math.abs(sxx2)<1e-12) return null;
  const b1=(sxy-n*xb*yb)/sxx2, b0=yb-b1*xb;
  let ssr=0;
  for(let i=0;i<n;i++){const e=ys[i]-(b0+b1*xs[i]);ssr+=e*e;}
  const se=Math.sqrt((ssr/(n-2))/sxx2);
  return {b1, se, t:b1/se};
}

// ─── PARAM DEFAULTS ───────────────────────────────────────────────────────────
const DIST_DEFAULTS = {
  Normal:      { mean: 0, sd: 1 },
  Uniform:     { min: 0, max: 1 },
  Bernoulli:   { p: 0.5 },
  Poisson:     { lambda: 2 },
  Exponential: { lambda: 1 },
  t:           { df: 5 },
  "Chi-squared": { df: 3 },
  Constant:    { value: "0" },
  Sequence:    { from: "1", by: "1" },
  Categorical: { levels: "Control,Treatment", probs: "", asCode: false },
  GroupID:     { groups: "10" },
  CycleID:     { period: "5" },
  Expression:  { expr: "" },
  ForLoop:     { init: "0", update: "prev * 0.9 + eps[i]" },
  WhileLoop:   { init: "1", update: "prev * 0.95", condition: "Math.abs(prev) > 0.001", maxIter: "1000" },
};

const DIST_OPTIONS = ["Normal","Uniform","Bernoulli","Poisson","Exponential","t","Chi-squared","Constant","Sequence","Categorical","GroupID","CycleID","Expression","ForLoop","WhileLoop"];

function distColor(C) {
  return {
    Normal: C.blue, Uniform: C.teal, Bernoulli: C.purple,
    Poisson: C.gold, Exponential: "#c88e6e", t: C.green,
    "Chi-squared": "#c87e9e", Constant: C.textMuted, Sequence: C.teal, Expression: C.textDim,
    Categorical: C.purple, GroupID: C.gold, CycleID: "#9ec8c8",
    ForLoop: "#9ec87e", WhileLoop: "#c87e6e",
  };
}

// ─── PARAM EDITOR ─────────────────────────────────────────────────────────────
function ParamEditor({ dist, params, onChange }) {
  const { C } = useTheme();
  function field(key, label, placeholder) {
    return (
      <label key={key} style={{ display: "flex", alignItems: "center", gap: 5 }}>
        <span style={{ fontSize: 10, color: C.textMuted, fontFamily: mono, minWidth: 18 }}>{label}</span>
        <input
          value={params[key] ?? ""}
          onChange={e => onChange({ ...params, [key]: e.target.value })}
          placeholder={placeholder}
          style={{ ...fieldStyle(C), width: 68 }}
        />
      </label>
    );
  }
  if (dist === "Normal")      return <div style={{ display: "flex", gap: 8 }}>{field("mean","μ","0")}{field("sd","σ","1")}</div>;
  if (dist === "Uniform")     return <div style={{ display: "flex", gap: 8 }}>{field("min","min","0")}{field("max","max","1")}</div>;
  if (dist === "Bernoulli")   return field("p","p","0.5");
  if (dist === "Poisson")     return field("lambda","λ","1");
  if (dist === "Exponential") return field("lambda","λ","1");
  if (dist === "t" || dist === "Chi-squared") return field("df","df","5");
  if (dist === "Sequence")    return (
    <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
      <label style={{ display: "flex", alignItems: "center", gap: 5 }}>
        <span style={{ fontSize: 10, color: C.textMuted, fontFamily: mono, minWidth: 24 }}>from</span>
        <input value={params.from ?? "1"} onChange={e => onChange({ ...params, from: e.target.value })}
          placeholder="1" style={{ ...fieldStyle(C), width: 68 }} />
      </label>
      <label style={{ display: "flex", alignItems: "center", gap: 5 }}>
        <span style={{ fontSize: 10, color: C.textMuted, fontFamily: mono, minWidth: 18 }}>by</span>
        <input value={params.by ?? "1"} onChange={e => onChange({ ...params, by: e.target.value })}
          placeholder="1" style={{ ...fieldStyle(C), width: 68 }} />
      </label>
      <span style={{ fontSize: 9, color: C.textMuted, fontFamily: mono }}>→ 1, 2, 3, …, n</span>
    </div>
  );
  if (dist === "Categorical") return (
    <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
      <label style={{ display: "flex", alignItems: "center", gap: 4 }}>
        <span style={{ fontSize: 9, color: C.textMuted, fontFamily: mono }}>levels</span>
        <input value={params.levels ?? ""} onChange={e => onChange({ ...params, levels: e.target.value })}
          placeholder="Control,Treatment" style={{ ...fieldStyle(C), width: 150 }} />
      </label>
      <label style={{ display: "flex", alignItems: "center", gap: 4 }}>
        <span style={{ fontSize: 9, color: C.textMuted, fontFamily: mono }}>probs</span>
        <input value={params.probs ?? ""} onChange={e => onChange({ ...params, probs: e.target.value })}
          placeholder="0.5,0.5 (blank=equal)" style={{ ...fieldStyle(C), width: 130 }} />
      </label>
      <label style={{ display: "flex", alignItems: "center", gap: 4, cursor: "pointer" }} title="Emit integer codes 0..k-1 instead of labels">
        <input type="checkbox" checked={params.asCode === true || params.asCode === "true"}
          onChange={e => onChange({ ...params, asCode: e.target.checked })} />
        <span style={{ fontSize: 9, color: C.textMuted, fontFamily: mono }}>as code</span>
      </label>
    </div>
  );
  if (dist === "GroupID")     return (
    <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
      <label style={{ display: "flex", alignItems: "center", gap: 5 }}>
        <span style={{ fontSize: 10, color: C.textMuted, fontFamily: mono, minWidth: 38 }}>groups</span>
        <input value={params.groups ?? "10"} onChange={e => onChange({ ...params, groups: e.target.value })}
          placeholder="10" style={{ ...fieldStyle(C), width: 68 }} />
      </label>
      <span style={{ fontSize: 9, color: C.textMuted, fontFamily: mono }}>→ 1,1,…,2,2,… (rep each)</span>
    </div>
  );
  if (dist === "CycleID")     return (
    <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
      <label style={{ display: "flex", alignItems: "center", gap: 5 }}>
        <span style={{ fontSize: 10, color: C.textMuted, fontFamily: mono, minWidth: 38 }}>period</span>
        <input value={params.period ?? "5"} onChange={e => onChange({ ...params, period: e.target.value })}
          placeholder="5" style={{ ...fieldStyle(C), width: 68 }} />
      </label>
      <span style={{ fontSize: 9, color: C.textMuted, fontFamily: mono }}>→ 1,2,…,T,1,2,… (rep times)</span>
    </div>
  );
  if (dist === "Constant")    return (
    <label style={{ display: "flex", alignItems: "center", gap: 5 }}>
      <span style={{ fontSize: 10, color: C.textMuted, fontFamily: mono, minWidth: 28 }}>value</span>
      <input
        value={params.value ?? "0"}
        onChange={e => onChange({ ...params, value: e.target.value })}
        placeholder="e.g. 0.5 or 1000"
        style={{ ...fieldStyle(C), width: 120 }}
      />
    </label>
  );
  if (dist === "Expression")  return (
    <input
      value={params.expr ?? ""}
      onChange={e => onChange({ ...params, expr: e.target.value })}
      placeholder="e.g. 1 + 2*X1 + eps"
      style={{ ...fieldStyle(C), width: 240 }}
    />
  );
  if (dist === "ForLoop") return (
    <div style={{ display: "flex", gap: 6, flexWrap: "wrap", alignItems: "center" }}>
      <label style={{ display: "flex", alignItems: "center", gap: 4 }}>
        <span style={{ fontSize: 9, color: C.textMuted, fontFamily: mono }}>init</span>
        <input value={params.init ?? "0"} onChange={e => onChange({ ...params, init: e.target.value })}
          placeholder="0" style={{ ...fieldStyle(C), width: 70 }} />
      </label>
      <label style={{ display: "flex", alignItems: "center", gap: 4 }}>
        <span style={{ fontSize: 9, color: C.textMuted, fontFamily: mono }}>update(prev,i)</span>
        <input value={params.update ?? ""} onChange={e => onChange({ ...params, update: e.target.value })}
          placeholder="prev * 0.9 + eps[i]" style={{ ...fieldStyle(C), width: 180 }} />
      </label>
    </div>
  );
  if (dist === "WhileLoop") return (
    <div style={{ display: "flex", gap: 6, flexWrap: "wrap", alignItems: "center" }}>
      <label style={{ display: "flex", alignItems: "center", gap: 4 }}>
        <span style={{ fontSize: 9, color: C.textMuted, fontFamily: mono }}>init</span>
        <input value={params.init ?? "1"} onChange={e => onChange({ ...params, init: e.target.value })}
          placeholder="1" style={{ ...fieldStyle(C), width: 60 }} />
      </label>
      <label style={{ display: "flex", alignItems: "center", gap: 4 }}>
        <span style={{ fontSize: 9, color: C.textMuted, fontFamily: mono }}>update(prev)</span>
        <input value={params.update ?? ""} onChange={e => onChange({ ...params, update: e.target.value })}
          placeholder="prev * 0.95" style={{ ...fieldStyle(C), width: 130 }} />
      </label>
      <label style={{ display: "flex", alignItems: "center", gap: 4 }}>
        <span style={{ fontSize: 9, color: C.textMuted, fontFamily: mono }}>while</span>
        <input value={params.condition ?? ""} onChange={e => onChange({ ...params, condition: e.target.value })}
          placeholder="Math.abs(prev) > 0.001" style={{ ...fieldStyle(C), width: 170 }} />
      </label>
      <label style={{ display: "flex", alignItems: "center", gap: 4 }}>
        <span style={{ fontSize: 9, color: C.textMuted, fontFamily: mono }}>maxIter</span>
        <input value={params.maxIter ?? "1000"} onChange={e => onChange({ ...params, maxIter: e.target.value })}
          placeholder="1000" style={{ ...fieldStyle(C), width: 60 }} />
      </label>
    </div>
  );
  return null;
}

// ─── MC HISTOGRAM ─────────────────────────────────────────────────────────────
function MCHistogram({ betas, trueVal, meanVal }) {
  const { C } = useTheme();
  const W=400, H=110, BINS=24, pad={l:4,r:4,t:14,b:22};
  const mn=Math.min(...betas), mx=Math.max(...betas);
  const range=mx-mn||1, binW=range/BINS;
  const counts=new Array(BINS).fill(0);
  betas.forEach(b=>{let idx=Math.floor((b-mn)/binW);if(idx>=BINS)idx=BINS-1;counts[idx]++;});
  const maxC=Math.max(...counts)||1;
  const bW=(W-pad.l-pad.r)/BINS, cH=H-pad.t-pad.b;
  const xp=v=>pad.l+(v-mn)/range*(W-pad.l-pad.r);
  return (
    <svg width={W} height={H} style={{display:"block",overflow:"visible",fontFamily:mono}}>
      {counts.map((c,i)=>{
        const bh=c/maxC*cH;
        return <rect key={i} x={pad.l+i*bW+0.5} y={pad.t+cH-bh} width={Math.max(0,bW-1)} height={bh} fill={C.teal} opacity={0.65} rx={1}/>;
      })}
      <line x1={xp(meanVal)} x2={xp(meanVal)} y1={pad.t} y2={pad.t+cH+4} stroke={C.gold} strokeWidth={1.5} strokeDasharray="3,2"/>
      <text x={xp(meanVal)} y={pad.t+cH+14} fill={C.gold} fontSize={8} textAnchor="middle">x̄={meanVal.toFixed(3)}</text>
      {trueVal!=null && xp(trueVal)>=0 && xp(trueVal)<=W && <>
        <line x1={xp(trueVal)} x2={xp(trueVal)} y1={pad.t} y2={pad.t+cH+4} stroke="#c86e6e" strokeWidth={1.5}/>
        <text x={xp(trueVal)} y={pad.t-3} fill="#c86e6e" fontSize={8} textAnchor="middle">β={trueVal}</text>
      </>}
    </svg>
  );
}

// ─── SCRIPT GENERATOR ─────────────────────────────────────────────────────────
export function generateSimScript(language, n, seed, variables) {
  const distR = {
    Normal:       v => `rnorm(n, mean=${v.params.mean??0}, sd=${v.params.sd??1})`,
    Uniform:      v => `runif(n, min=${v.params.min??0}, max=${v.params.max??1})`,
    Bernoulli:    v => `rbinom(n, 1, prob=${v.params.p??0.5})`,
    Poisson:      v => `rpois(n, lambda=${v.params.lambda??1})`,
    Exponential:  v => `rexp(n, rate=${v.params.lambda??1})`,
    t:            v => `rt(n, df=${v.params.df??5})`,
    "Chi-squared":v => `rchisq(n, df=${v.params.df??3})`,
  };
  const distPy = {
    Normal:       v => `rng.normal(${v.params.mean??0}, ${v.params.sd??1}, n)`,
    Uniform:      v => `rng.uniform(${v.params.min??0}, ${v.params.max??1}, n)`,
    Bernoulli:    v => `rng.binomial(1, ${v.params.p??0.5}, n)`,
    Poisson:      v => `rng.poisson(${v.params.lambda??1}, n)`,
    Exponential:  v => `rng.exponential(1/${v.params.lambda??1}, n)`,
    t:            v => `rng.standard_t(${v.params.df??5}, n)`,
    "Chi-squared":v => `rng.chisquare(${v.params.df??3}, n)`,
  };
  const distStata = {
    Normal:       v => `rnormal(${v.params.mean??0}, ${v.params.sd??1})`,
    Uniform:      v => `runiform(${v.params.min??0}, ${v.params.max??1})`,
    Bernoulli:    v => `rbinomial(1, ${v.params.p??0.5})`,
    Poisson:      v => `rpoisson(${v.params.lambda??1})`,
    Exponential:  v => `rexponential(1/${v.params.lambda??1})`,
    t:            v => `rt(${v.params.df??5})`,
    "Chi-squared":v => `rchi2(${v.params.df??3})`,
  };

  const catParse = (params) => {
    const levels = String(params.levels ?? "").split(",").map(s => s.trim()).filter(s => s.length);
    let probs = String(params.probs ?? "").split(",").map(s => parseFloat(s)).filter(x => isFinite(x) && x >= 0);
    if (probs.length !== levels.length) probs = levels.map(() => 1);
    const sum = probs.reduce((a, b) => a + b, 0) || 1;
    probs = probs.map(p => p / sum);
    const allNum = levels.length > 0 && levels.every(s => /^-?\d*\.?\d+(?:e-?\d+)?$/i.test(s));
    const asCode = params.asCode === true || params.asCode === "true";
    return { levels, probs, allNum, asCode, k: levels.length };
  };

  const lines = [];
  if (language === "r") {
    lines.push(`set.seed(${seed})`, `n <- ${n}`, `N <- n`, `observations <- n`);
    variables.forEach(v => {
      if (v.dist === "Sequence") {
        const from = v.params.from ?? "1", by = v.params.by ?? "1";
        lines.push(`${v.name} <- seq(${from}, by=${by}, length.out=n)`);
      } else if (v.dist === "Constant") {
        lines.push(`${v.name} <- rep(${v.params.value ?? 0}, n)`);
      } else if (v.dist === "Categorical") {
        const { levels, probs, allNum, asCode, k } = catParse(v.params);
        const probR = `c(${probs.map(p => p.toFixed(4)).join(", ")})`;
        const vec = asCode ? `0:${Math.max(0, k - 1)}`
          : allNum ? `c(${levels.join(", ")})` : `c(${levels.map(s => `"${s}"`).join(", ")})`;
        lines.push(`${v.name} <- sample(${vec}, n, replace=TRUE, prob=${probR})`);
      } else if (v.dist === "GroupID") {
        const G = Math.max(1, Math.floor(+(v.params.groups ?? 1) || 1));
        lines.push(`${v.name} <- rep(1:${G}, each=ceiling(n/${G}))[1:n]`);
      } else if (v.dist === "CycleID") {
        const T = Math.max(1, Math.floor(+(v.params.period ?? 1) || 1));
        lines.push(`${v.name} <- rep(1:${T}, length.out=n)`);
      } else if (v.dist === "Expression") {
        lines.push(`# ${v.name} = ${v.params.expr||""}`, `${v.name} <- ${v.params.expr||"NA"}`);
      } else if (v.dist === "ForLoop") {
        const init = v.params.init || "0";
        const upd  = v.params.update || "prev";
        lines.push(
          `# ForLoop: ${v.name}`,
          `${v.name} <- numeric(n)`,
          `${v.name}[1] <- ${init}`,
          `for (i in 2:n) { ${v.name}[i] <- ${upd.replace(/\bprev\b/g, `${v.name}[i-1]`).replace(/\bi\b/g, "i")} }`,
        );
      } else if (v.dist === "WhileLoop") {
        const init = v.params.init || "1";
        const upd  = v.params.update || "prev";
        const cond = v.params.condition || "FALSE";
        const mi   = +(v.params.maxIter) || 1000;
        lines.push(
          `# WhileLoop: ${v.name} (converged scalar)`,
          `${v.name}_val <- ${init}; ${v.name}_iter <- 0L`,
          `while ((${cond.replace(/\bprev\b/g, `${v.name}_val`)}) && ${v.name}_iter < ${mi}) {`,
          `  ${v.name}_val <- ${upd.replace(/\bprev\b/g, `${v.name}_val`)}; ${v.name}_iter <- ${v.name}_iter + 1L`,
          `}`,
          `${v.name} <- rep(${v.name}_val, n)`,
        );
      } else {
        lines.push(`${v.name} <- ${distR[v.dist]?.(v) ?? "NA"}`);
      }
    });
    lines.push(`df <- data.frame(${variables.map(v=>v.name).join(", ")})`);
  } else if (language === "python") {
    lines.push("import numpy as np", "import pandas as pd", `rng = np.random.default_rng(${seed})`, `n = ${n}`, `N = n`, `observations = n`);
    variables.forEach(v => {
      if (v.dist === "Sequence") {
        const from = v.params.from ?? "1", by = v.params.by ?? "1";
        lines.push(`${v.name} = np.arange(${from}, ${from} + ${by} * n, ${by})`);
      } else if (v.dist === "Constant") {
        lines.push(`${v.name} = np.full(n, ${v.params.value ?? 0})`);
      } else if (v.dist === "Categorical") {
        const { levels, probs, allNum, asCode, k } = catParse(v.params);
        const probPy = `[${probs.map(p => p.toFixed(4)).join(", ")}]`;
        const vec = asCode ? `np.arange(${k})`
          : allNum ? `[${levels.join(", ")}]` : `[${levels.map(s => `"${s}"`).join(", ")}]`;
        lines.push(`${v.name} = rng.choice(${vec}, size=n, p=${probPy})`);
      } else if (v.dist === "GroupID") {
        const G = Math.max(1, Math.floor(+(v.params.groups ?? 1) || 1));
        lines.push(`${v.name} = np.repeat(np.arange(1, ${G} + 1), int(np.ceil(n / ${G})))[:n]`);
      } else if (v.dist === "CycleID") {
        const T = Math.max(1, Math.floor(+(v.params.period ?? 1) || 1));
        lines.push(`${v.name} = (np.arange(n) % ${T}) + 1`);
      } else if (v.dist === "Expression") {
        lines.push(`# ${v.name} = ${v.params.expr||""}`, `${v.name} = ${v.params.expr||"None"}`);
      } else if (v.dist === "ForLoop") {
        const init = v.params.init || "0";
        const upd  = v.params.update || "prev";
        lines.push(
          `# ForLoop: ${v.name}`,
          `${v.name} = np.empty(n)`,
          `${v.name}[0] = ${init}`,
          `for i in range(1, n):`,
          `    prev = ${v.name}[i-1]`,
          `    ${v.name}[i] = ${upd}`,
        );
      } else if (v.dist === "WhileLoop") {
        const init = v.params.init || "1";
        const upd  = v.params.update || "prev";
        const cond = v.params.condition || "False";
        const mi   = +(v.params.maxIter) || 1000;
        lines.push(
          `# WhileLoop: ${v.name} (converged scalar)`,
          `prev = ${init}; ${v.name}_iter = 0`,
          `while (${cond}) and ${v.name}_iter < ${mi}:`,
          `    prev = ${upd}; ${v.name}_iter += 1`,
          `${v.name} = np.full(n, prev)`,
        );
      } else {
        lines.push(`${v.name} = ${distPy[v.dist]?.(v) ?? "None"}`);
      }
    });
    lines.push(`df = pd.DataFrame({${variables.map(v=>`'${v.name}': ${v.name}`).join(", ")}})`);
  } else if (language === "stata") {
    lines.push(`set seed ${seed}`, `set obs ${n}`, `local N = ${n}`, `local observations = ${n}`);
    variables.forEach(v => {
      if (v.dist === "Sequence") {
        const from = +(v.params.from ?? 1), by = +(v.params.by ?? 1);
        lines.push(`generate ${v.name} = (_n - 1) * ${by} + ${from}`);
      } else if (v.dist === "Constant") {
        lines.push(`generate ${v.name} = ${v.params.value ?? 0}`);
      } else if (v.dist === "Categorical") {
        const { levels, probs, k } = catParse(v.params);
        let cum = 0; const thr = probs.map(p => (cum += p, cum));
        let expr = `${Math.max(0, k - 1)}`;
        for (let j = k - 2; j >= 0; j--) expr = `cond(_u_${v.name} < ${thr[j].toFixed(4)}, ${j}, ${expr})`;
        lines.push(
          `* Categorical: ${v.name} ∈ {${levels.join(", ")}} (integer codes 0..${Math.max(0, k - 1)})`,
          `generate double _u_${v.name} = runiform()`,
          `generate ${v.name} = ${expr}`,
          `drop _u_${v.name}`,
        );
      } else if (v.dist === "GroupID") {
        const G = Math.max(1, Math.floor(+(v.params.groups ?? 1) || 1));
        lines.push(`generate ${v.name} = ceil(_n / ceil(_N / ${G}))`);
      } else if (v.dist === "CycleID") {
        const T = Math.max(1, Math.floor(+(v.params.period ?? 1) || 1));
        lines.push(`generate ${v.name} = mod(_n - 1, ${T}) + 1`);
      } else if (v.dist === "Expression") {
        lines.push(`* ${v.name} = ${v.params.expr||""}`, `generate ${v.name} = ${v.params.expr||"."}`);
      } else if (v.dist === "ForLoop") {
        const init = v.params.init || "0";
        const upd  = v.params.update || "prev";
        const rUpd = upd.replace(/\bprev\b/g, `${v.name}[_n-1]`).replace(/\bi\b/g, "_n");
        lines.push(
          `* ForLoop: ${v.name}`,
          `generate ${v.name} = .`,
          `replace ${v.name} = ${init} in 1`,
          `forvalues i = 2/\`=_N' { quietly replace ${v.name} = ${rUpd} in \`i' }`,
        );
      } else if (v.dist === "WhileLoop") {
        const init = v.params.init || "1";
        const upd  = v.params.update || "prev";
        const cond = v.params.condition || "0";
        const mi   = +(v.params.maxIter) || 1000;
        lines.push(
          `* WhileLoop: ${v.name} (converged scalar)`,
          `local ${v.name}_val = ${init}`,
          `local ${v.name}_iter = 0`,
          `while (${cond.replace(/\bprev\b/g, `\`${v.name}_val'`)}) & \`${v.name}_iter' < ${mi} {`,
          `  local ${v.name}_val = ${upd.replace(/\bprev\b/g, `\`${v.name}_val'`)}`,
          `  local ${v.name}_iter = \`${v.name}_iter' + 1`,
          `}`,
          `generate ${v.name} = \`${v.name}_val'`,
        );
      } else {
        lines.push(`generate ${v.name} = ${distStata[v.dist]?.(v) ?? "."}`);
      }
    });
  }
  return lines.join("\n");
}

// ─── MAIN COMPONENT ───────────────────────────────────────────────────────────
let _nextId = 4;

export default function SimulateTab({ onAddDataset, rows = [], headers = [], onAddColumn, onCreateDataset }) {
  const { C } = useTheme();
  const { appendLog } = useSessionLog();
  const [n,          setN]          = useState(500);
  const [seed,       setSeed]       = useState(42);
  const [variables,  setVariables]  = useState([
    { id:1, name:"X1",  dist:"Normal",     params:{ mean:0, sd:1 } },
    { id:2, name:"eps", dist:"Normal",     params:{ mean:0, sd:0.5 } },
    { id:3, name:"Y",   dist:"Expression", params:{ expr:"1 + 2*X1 + eps" } },
  ]);
  const [generated,  setGenerated]  = useState(null);
  const [dsName,     setDsName]     = useState("simulated_data");
  const [newVarName, setNewVarName] = useState("");
  const [newDist,    setNewDist]    = useState("Normal");
  const [genErr,     setGenErr]     = useState("");
  const [saved,      setSaved]      = useState(false);
  const [scriptLang, setScriptLang] = useState("r");
  const [scriptOpen, setScriptOpen] = useState(false);
  const [mcOpen,     setMcOpen]     = useState(false);
  const [mcY,        setMcY]        = useState("");
  const [mcX,        setMcX]        = useState("");
  const [mcTrueBeta, setMcTrueBeta] = useState("2");
  const [mcReps,     setMcReps]     = useState(1000);
  const [mcResult,   setMcResult]   = useState(null);
  const [mcRunning,  setMcRunning]  = useState(false);
  const [mcMode,     setMcMode]     = useState("ols");   // "ols" | "single"
  const [mcVar,      setMcVar]      = useState("");
  const [mcStat,     setMcStat]     = useState("mean");

  const DIST_COLOR = distColor(C);

  // ── Generate ───────────────────────────────────────────────────────────────
  async function generate() {
    setGenErr(""); setSaved(false);
    const nObs = Math.max(1, Math.min(100000, +n || 500));
    const { scope, error } = await evalScopeInWorker(variables, nObs, +seed || 0);
    if (error) { setGenErr(error); return; }
    const headers = variables.map(v => v.name);
    const rows = [];
    for (let i = 0; i < nObs; i++) {
      const row = {};
      headers.forEach(h => {
        const val = scope[h]?.[i];
        // Preserve strings/labels end-to-end (Categorical, string Constant/Expression);
        // only truly missing values fall back to "".
        row[h] = val === undefined || val === null ? "" : val;
      });
      rows.push(row);
    }
    setGenerated({ rows, headers });
  }

  // ── Variable CRUD ──────────────────────────────────────────────────────────
  function addVariable() {
    const nm = newVarName.trim();
    if (!nm) return;
    const id = _nextId++;
    setVariables(vs => [...vs, { id, name: nm, dist: newDist, params: { ...DIST_DEFAULTS[newDist] } }]);
    setNewVarName("");
  }
  function updateVar(id, patch) {
    setVariables(vs => vs.map(v => v.id === id ? { ...v, ...patch } : v));
  }
  function updateDist(id, dist) {
    setVariables(vs => vs.map(v => v.id === id ? { ...v, dist, params: { ...DIST_DEFAULTS[dist] } } : v));
  }
  function removeVar(id) {
    setVariables(vs => vs.filter(v => v.id !== id));
  }
  function moveVar(id, dir) {
    setVariables(vs => {
      const idx = vs.findIndex(v => v.id === id);
      const next = idx + dir;
      if (next < 0 || next >= vs.length) return vs;
      const arr = [...vs];
      [arr[idx], arr[next]] = [arr[next], arr[idx]];
      return arr;
    });
  }

  // ── Save to session ────────────────────────────────────────────────────────
  function saveToSession() {
    if (!generated) return;
    const name = (dsName.trim() || "simulated_data") + ".csv";
    onAddDataset?.(name, generated.rows, generated.headers);
    appendLog({ module: "simulate", opType: "dgp_save", params: { name, n: +n || 500, seed: +seed || 0, variables: variables.map(v => ({ name: v.name, dist: v.dist, params: v.params })) }, label: `DGP saved as ${name} (n=${n}, seed=${seed})` });
    setSaved(true);
  }

  // ── Monte Carlo ─────────────────────────────────────────────────────────────
  async function runMonteCarlo() {
    if (mcMode === "single") {
      if (!mcVar) return;
      setMcRunning(true); setMcResult(null);
      const nObs = Math.max(1, Math.min(100000, +n || 500));
      const reps = Math.max(10, Math.min(10000, +mcReps || 1000));
      const vals = [];
      const BATCH = 100;
      for (let r = 0; r < reps; r++) {
        const { scope, error } = await evalScopeInWorker(variables, nObs, (+seed || 0) + r * 1_000_037);
        if (error) { setMcRunning(false); return; }
        const arr = scope[mcVar];
        if (!arr?.length) continue;
        let stat;
        if (mcStat === "mean")     stat = arr.reduce((s,v)=>s+v,0)/arr.length;
        else if (mcStat === "sd") { const m=arr.reduce((s,v)=>s+v,0)/arr.length; stat=Math.sqrt(arr.reduce((s,v)=>s+(v-m)**2,0)/arr.length); }
        else if (mcStat === "var") { const m=arr.reduce((s,v)=>s+v,0)/arr.length; stat=arr.reduce((s,v)=>s+(v-m)**2,0)/arr.length; }
        else if (mcStat === "median") { const s=[...arr].sort((a,b)=>a-b),mid=Math.floor(s.length/2); stat=s.length%2?s[mid]:(s[mid-1]+s[mid])/2; }
        else if (mcStat === "min") stat = Math.min(...arr);
        else                       stat = Math.max(...arr);
        vals.push(stat);
        if ((r + 1) % BATCH === 0) await new Promise(res => setTimeout(res, 0));
      }
      if (!vals.length) { setMcRunning(false); return; }
      const mean = vals.reduce((a,v)=>a+v,0)/vals.length;
      const sd   = Math.sqrt(vals.reduce((a,v)=>a+(v-mean)**2,0)/vals.length);
      setMcResult({ mode:"single", betas:vals, mean, sd, reps:vals.length, stat:mcStat, varName:mcVar });
      appendLog({ module: "simulate", opType: "mc_single", reproducible: false, params: { mcVar, mcStat, reps: vals.length, n: +n || 500 }, label: `MC simulation: ${mcStat}(${mcVar}) over ${vals.length} reps` });
      setMcRunning(false);
      return;
    }
    if (!mcY || !mcX) return;
    setMcRunning(true); setMcResult(null);
    const nObs  = Math.max(1, Math.min(100000, +n || 500));
    const reps  = Math.max(10, Math.min(10000, +mcReps || 1000));
    const trueBeta = parseFloat(mcTrueBeta);
    const crit  = tCrit95(nObs - 2);
    const betas = [];
    const BATCH = 100;
    for (let r = 0; r < reps; r++) {
      const { scope, error } = await evalScopeInWorker(variables, nObs, (+seed || 0) + r * 1_000_037);
      if (error) { setMcRunning(false); return; }
      const ys = scope[mcY], xs = scope[mcX];
      if (!ys || !xs) continue;
      const res = fastOLS1(ys, xs);
      if (res) betas.push(res);
      if ((r + 1) % BATCH === 0) await new Promise(res => setTimeout(res, 0));
    }
    if (!betas.length) { setMcRunning(false); return; }
    const bs   = betas.map(b => b.b1);
    const mean = bs.reduce((a,v)=>a+v,0)/bs.length;
    const sd   = Math.sqrt(bs.reduce((a,v)=>a+(v-mean)**2,0)/bs.length);
    const bias  = isFinite(trueBeta) ? mean - trueBeta : null;
    const rmse  = isFinite(trueBeta) ? Math.sqrt(bs.reduce((a,v)=>a+(v-trueBeta)**2,0)/bs.length) : null;
    const rejectRate = betas.filter(b=>Math.abs(b.t)>crit).length/betas.length;
    setMcResult({ mode:"ols", betas:bs, mean, sd, bias, rmse, rejectRate, reps:betas.length, trueBeta:isFinite(trueBeta)?trueBeta:null });
    appendLog({ module: "simulate", opType: "mc_ols", reproducible: false, params: { mcY, mcX, mcTrueBeta, reps: betas.length, n: +n || 500 }, label: `MC OLS: Y=${mcY}, X=${mcX}, β_true=${mcTrueBeta}, reps=${betas.length}` });
    setMcRunning(false);
  }

  const previewRows = generated?.rows.slice(0, 5) ?? [];

  return (
    <div style={{ height: "100%", overflowY: "auto", padding: "1.8rem 2.2rem", fontFamily: mono, color: C.text, maxWidth: 900 }}>
      <HintBox title="How to simulate" sections={[
        { heading: "DGP Variables", items: [
          "Define variables with distributions: normal, uniform, Bernoulli, Poisson",
          "Categorical: sample labeled levels with probabilities (e.g. Control,Treatment) — emits strings or integer codes",
          "GroupID / CycleID: build a balanced panel skeleton — entity ids (rep each) and time ids (rep times)",
          "Set mean, std, or probability parameters per variable",
          "Variables can reference each other to build structural equations",
        ]},
        { heading: "Structural Equations", items: [
          "Link variables with expressions: Y = 2*X + epsilon, D = 1*(Z > 0.5), etc.",
          "Supports any JS math expression — all DGP variables are in scope",
        ]},
        { heading: "Output", items: [
          "Set sample size N and click Generate",
          "Resulting dataset appears in the Data tab for wrangling and modeling",
          "Useful for power analysis, Monte Carlo experiments, and teaching demonstrations",
        ]},
      ]} />
      <Lbl color={C.teal} mb={4}>Simulate</Lbl>
      <div style={{ fontSize: 17, color: C.text, marginBottom: "0.3rem", letterSpacing: "-0.01em" }}>DGP Builder</div>
      <div style={{ fontSize: 10, color: C.textMuted, marginBottom: "1.8rem" }}>
        Define a data generating process — draw synthetic samples, evaluate expressions, save to session.
      </div>

      {/* ── Top controls ── */}
      <div style={{ display: "flex", gap: 16, alignItems: "flex-end", marginBottom: "1.6rem", flexWrap: "wrap" }}>
        <label style={{ display: "flex", flexDirection: "column", gap: 4 }}>
          <Lbl mb={2}>Observations (n)</Lbl>
          <input type="number" min={1} max={100000} value={n} onChange={e => setN(e.target.value)}
            style={{ ...fieldStyle(C), width: 100 }} />
        </label>
        <label style={{ display: "flex", flexDirection: "column", gap: 4 }}>
          <Lbl mb={2}>Seed</Lbl>
          <input type="number" value={seed} onChange={e => setSeed(e.target.value)}
            style={{ ...fieldStyle(C), width: 80 }} />
        </label>
        <div style={{ display: "flex", gap: 8, alignItems: "flex-end" }}>
          <Btn onClick={generate} v="solid" color={C.teal} ch="Generate" />
          {generated && <Btn onClick={generate} v="out" ch="Re-generate" sm />}
        </div>
      </div>

      {/* ── Variable builder table ── */}
      <div style={{ marginBottom: "1.4rem" }}>
        <Lbl mb={8}>Variables</Lbl>
        <div style={{ border: `1px solid ${C.border}`, borderRadius: 4, overflow: "hidden" }}>
          <table style={{ borderCollapse: "collapse", width: "100%", minWidth: 560 }}>
            <thead>
              <tr>
                <th style={{ ...thStyle(C), width: 24 }}>#</th>
                <th style={thStyle(C)}>Name</th>
                <th style={thStyle(C)}>Distribution</th>
                <th style={thStyle(C)}>Parameters</th>
                <th style={{ ...thStyle(C), textAlign: "right" }}>Actions</th>
              </tr>
            </thead>
            <tbody>
              {variables.map((v, idx) => (
                <tr key={v.id} style={{ background: idx % 2 ? C.surface2 : C.surface }}>
                  <td style={{ ...tdStyle(C), color: C.textMuted, fontSize: 9, textAlign: "center" }}>{idx + 1}</td>
                  <td style={tdStyle(C)}>
                    <input
                      value={v.name}
                      onChange={e => updateVar(v.id, { name: e.target.value })}
                      style={{ ...fieldStyle(C), width: 80 }}
                    />
                  </td>
                  <td style={tdStyle(C)}>
                    <select
                      value={v.dist}
                      onChange={e => updateDist(v.id, e.target.value)}
                      style={{ ...fieldStyle(C), width: 118 }}
                    >
                      {DIST_OPTIONS.map(d => <option key={d} value={d}>{d}</option>)}
                    </select>
                  </td>
                  <td style={tdStyle(C)}>
                    <ParamEditor
                      dist={v.dist}
                      params={v.params}
                      onChange={p => updateVar(v.id, { params: p })}
                    />
                  </td>
                  <td style={{ ...tdStyle(C), textAlign: "right", whiteSpace: "nowrap" }}>
                    <span style={{ display: "inline-flex", gap: 2 }}>
                      <button onClick={() => moveVar(v.id, -1)} disabled={idx === 0}
                        title="Move up"
                        style={{ background: "transparent", border: "none", color: idx === 0 ? C.border2 : C.textMuted, cursor: idx === 0 ? "default" : "pointer", fontSize: 11, padding: "0 3px" }}>
                        ↑
                      </button>
                      <button onClick={() => moveVar(v.id, 1)} disabled={idx === variables.length - 1}
                        title="Move down"
                        style={{ background: "transparent", border: "none", color: idx === variables.length - 1 ? C.border2 : C.textMuted, cursor: idx === variables.length - 1 ? "default" : "pointer", fontSize: 11, padding: "0 3px" }}>
                        ↓
                      </button>
                      <button onClick={() => removeVar(v.id)}
                        title="Remove"
                        style={{ background: "transparent", border: "none", color: C.textMuted, cursor: "pointer", fontSize: 13, padding: "0 4px", transition: "color 0.1s" }}
                        onMouseEnter={e => e.currentTarget.style.color = C.red}
                        onMouseLeave={e => e.currentTarget.style.color = C.textMuted}>
                        ×
                      </button>
                    </span>
                  </td>
                </tr>
              ))}

              {/* ── Add variable row ── */}
              <tr style={{ background: C.surface }}>
                <td style={{ ...tdStyle(C), color: C.textMuted, fontSize: 9, textAlign: "center" }}>+</td>
                <td style={tdStyle(C)}>
                  <input
                    value={newVarName}
                    onChange={e => setNewVarName(e.target.value)}
                    onKeyDown={e => e.key === "Enter" && addVariable()}
                    placeholder="name"
                    style={{ ...fieldStyle(C), width: 80 }}
                  />
                </td>
                <td style={tdStyle(C)}>
                  <select value={newDist} onChange={e => setNewDist(e.target.value)}
                    style={{ ...fieldStyle(C), width: 118 }}>
                    {DIST_OPTIONS.map(d => <option key={d} value={d}>{d}</option>)}
                  </select>
                </td>
                <td style={tdStyle(C)}>
                  <span style={{ fontSize: 10, color: C.textMuted }}>params after adding</span>
                </td>
                <td style={{ ...tdStyle(C), textAlign: "right" }}>
                  <Btn onClick={addVariable} dis={!newVarName.trim()} v="out" ch="+ Add" sm />
                </td>
              </tr>
            </tbody>
          </table>
        </div>
      </div>

      {/* ── Error ── */}
      {genErr && (
        <div style={{ fontSize: 10, color: C.red, fontFamily: mono, padding: "0.5rem 0.75rem", border: `1px solid ${C.red}40`, borderRadius: 3, marginBottom: 12 }}>
          {genErr}
        </div>
      )}

      {/* ── Preview ── */}
      {generated && (
        <div style={{ marginBottom: "1.6rem" }}>
          <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 8 }}>
            <Lbl mb={0}>Preview (first 5 rows)</Lbl>
            <span style={{ fontSize: 9, color: C.textMuted }}>· {generated.rows.length.toLocaleString()} rows · {generated.headers.length} cols</span>
          </div>
          <div style={{ overflowX: "auto", border: `1px solid ${C.border}`, borderRadius: 4 }}>
            <table style={{ borderCollapse: "collapse", fontSize: 11, width: "100%" }}>
              <thead>
                <tr style={{ background: C.surface2 }}>
                  {generated.headers.map(h => (
                    <th key={h} style={{ ...thStyle(C), color: C.teal }}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {previewRows.map((row, i) => (
                  <tr key={i} style={{ background: i % 2 ? C.surface2 : C.surface }}>
                    {generated.headers.map(h => {
                      const v = row[h];
                      return (
                        <td key={h} style={{ ...tdStyle(C), fontFamily: mono, fontSize: 11, color: C.text, whiteSpace: "nowrap" }}>
                          {typeof v === "number" ? v.toFixed(4).replace(/\.?0+$/, "") : String(v ?? "·")}
                        </td>
                      );
                    })}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {/* ── Save controls ── */}
          <div style={{ marginTop: 12, display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
            <input
              value={dsName}
              onChange={e => { setDsName(e.target.value); setSaved(false); }}
              placeholder="dataset name"
              style={{ ...fieldStyle(C), width: 200 }}
            />
            <Btn onClick={saveToSession} v="solid" color={C.gold} ch="Save to session" />
            {saved && (
              <span style={{ fontSize: 10, color: C.green, fontFamily: mono }}>✓ saved as "{dsName}.csv"</span>
            )}
          </div>
        </div>
      )}

      {/* ── Monte Carlo ── */}
      <div style={{ borderTop: `1px solid ${C.border}`, paddingTop: "1.2rem", marginBottom: "0.8rem" }}>
        <button onClick={() => setMcOpen(o=>!o)}
          style={{ background:"transparent", border:"none", color:C.textDim, cursor:"pointer", fontFamily:mono, fontSize:10, padding:0, display:"flex", alignItems:"center", gap:6 }}>
          <span style={{ fontSize:8 }}>{mcOpen?"▾":"▸"}</span>
          Monte Carlo
        </button>
        {mcOpen && (
          <div style={{ marginTop:12 }}>
            {/* ── Mode toggle ── */}
            <div style={{ display:"flex", gap:6, marginBottom:12 }}>
              {[["ols","OLS (β̂)"],["single","Single variable"]].map(([k,label])=>(
                <button key={k} onClick={()=>{ setMcMode(k); setMcResult(null); }}
                  style={{ padding:"2px 10px", borderRadius:3, cursor:"pointer", fontFamily:mono, fontSize:9,
                    background: mcMode===k ? `${C.blue}20` : "transparent",
                    border: `1px solid ${mcMode===k ? C.blue+"60" : C.border}`,
                    color: mcMode===k ? C.blue : C.textMuted }}>
                  {label}
                </button>
              ))}
            </div>

            {mcMode === "ols" && (variables.length < 2
              ? <div style={{ fontSize:10, color:C.textMuted }}>Need at least 2 variables (Y and X) to run OLS Monte Carlo.</div>
              : <>
                <div style={{ display:"flex", gap:12, flexWrap:"wrap", alignItems:"flex-end", marginBottom:12 }}>
                  <label style={{ display:"flex", flexDirection:"column", gap:3 }}>
                    <Lbl mb={1}>Y variable</Lbl>
                    <select value={mcY} onChange={e=>setMcY(e.target.value)} style={{...fieldStyle(C),width:110}}>
                      <option value="">— select —</option>
                      {variables.map(v=><option key={v.id} value={v.name}>{v.name}</option>)}
                    </select>
                  </label>
                  <label style={{ display:"flex", flexDirection:"column", gap:3 }}>
                    <Lbl mb={1}>X variable</Lbl>
                    <select value={mcX} onChange={e=>setMcX(e.target.value)} style={{...fieldStyle(C),width:110}}>
                      <option value="">— select —</option>
                      {variables.filter(v=>v.name!==mcY).map(v=><option key={v.id} value={v.name}>{v.name}</option>)}
                    </select>
                  </label>
                  <label style={{ display:"flex", flexDirection:"column", gap:3 }}>
                    <Lbl mb={1}>True β (for bias)</Lbl>
                    <input value={mcTrueBeta} onChange={e=>setMcTrueBeta(e.target.value)} placeholder="e.g. 2" style={{...fieldStyle(C),width:70}}/>
                  </label>
                  <label style={{ display:"flex", flexDirection:"column", gap:3 }}>
                    <Lbl mb={1}>Replications</Lbl>
                    <input type="number" min={10} max={10000} value={mcReps} onChange={e=>setMcReps(e.target.value)} style={{...fieldStyle(C),width:80}}/>
                  </label>
                  <Btn onClick={runMonteCarlo} dis={!mcY||!mcX||mcRunning} v="solid" color={C.blue} ch={mcRunning?"Running…":"Run MC"}/>
                </div>
              </>
            )}

            {mcMode === "single" && (variables.length < 1
              ? <div style={{ fontSize:10, color:C.textMuted }}>Add at least 1 variable to run Monte Carlo.</div>
              : <>
                <div style={{ display:"flex", gap:12, flexWrap:"wrap", alignItems:"flex-end", marginBottom:12 }}>
                  <label style={{ display:"flex", flexDirection:"column", gap:3 }}>
                    <Lbl mb={1}>Variable</Lbl>
                    <select value={mcVar} onChange={e=>setMcVar(e.target.value)} style={{...fieldStyle(C),width:110}}>
                      <option value="">— select —</option>
                      {variables.map(v=><option key={v.id} value={v.name}>{v.name}</option>)}
                    </select>
                  </label>
                  <label style={{ display:"flex", flexDirection:"column", gap:3 }}>
                    <Lbl mb={1}>Statistic</Lbl>
                    <select value={mcStat} onChange={e=>setMcStat(e.target.value)} style={{...fieldStyle(C),width:100}}>
                      {[["mean","Mean"],["sd","Std Dev"],["var","Variance"],["median","Median"],["min","Min"],["max","Max"]].map(([k,l])=>(
                        <option key={k} value={k}>{l}</option>
                      ))}
                    </select>
                  </label>
                  <label style={{ display:"flex", flexDirection:"column", gap:3 }}>
                    <Lbl mb={1}>Replications</Lbl>
                    <input type="number" min={10} max={10000} value={mcReps} onChange={e=>setMcReps(e.target.value)} style={{...fieldStyle(C),width:80}}/>
                  </label>
                  <Btn onClick={runMonteCarlo} dis={!mcVar||mcRunning} v="solid" color={C.blue} ch={mcRunning?"Running…":"Run MC"}/>
                </div>
              </>
            )}

            {mcRunning && <div style={{ fontSize:10, color:C.textMuted, fontFamily:mono, marginBottom:8 }}>Running {mcReps} replications…</div>}

            {mcResult?.mode === "ols" && (
              <div>
                <div style={{ overflowX:"auto", marginBottom:14 }}>
                  <table style={{ borderCollapse:"collapse", fontSize:11 }}>
                    <thead>
                      <tr>
                        {["Reps","Mean β̂","Bias","SD","RMSE","Reject H₀ (5%)"].map(h=>(
                          <th key={h} style={thStyle(C)}>{h}</th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      <tr>
                        <td style={tdStyle(C)}>{mcResult.reps}</td>
                        <td style={{...tdStyle(C),color:C.teal}}>{mcResult.mean.toFixed(4)}</td>
                        <td style={{...tdStyle(C),color:mcResult.bias!=null&&Math.abs(mcResult.bias)>0.05?C.gold:C.text}}>
                          {mcResult.bias!=null ? (mcResult.bias>=0?"+":"")+mcResult.bias.toFixed(4) : "—"}
                        </td>
                        <td style={tdStyle(C)}>{mcResult.sd.toFixed(4)}</td>
                        <td style={tdStyle(C)}>{mcResult.rmse!=null?mcResult.rmse.toFixed(4):"—"}</td>
                        <td style={{...tdStyle(C),color:Math.abs(mcResult.rejectRate-0.05)>0.015?(C.gold??C.text):(C.green??C.text)}}>
                          {(mcResult.rejectRate*100).toFixed(1)}%
                        </td>
                      </tr>
                    </tbody>
                  </table>
                </div>
                <Lbl mb={6}>Sampling distribution of β̂ ({mcResult.reps} reps, n={+n||500})</Lbl>
                <MCHistogram betas={mcResult.betas} trueVal={mcResult.trueBeta} meanVal={mcResult.mean}/>
              </div>
            )}

            {mcResult?.mode === "single" && (
              <div>
                <div style={{ overflowX:"auto", marginBottom:14 }}>
                  <table style={{ borderCollapse:"collapse", fontSize:11 }}>
                    <thead>
                      <tr>
                        {["Reps","Mean","SD"].map(h=>(
                          <th key={h} style={thStyle(C)}>{h}</th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      <tr>
                        <td style={tdStyle(C)}>{mcResult.reps}</td>
                        <td style={{...tdStyle(C),color:C.teal}}>{mcResult.mean.toFixed(4)}</td>
                        <td style={tdStyle(C)}>{mcResult.sd.toFixed(4)}</td>
                      </tr>
                    </tbody>
                  </table>
                </div>
                <Lbl mb={6}>Sampling distribution of {mcResult.stat} ({mcResult.varName}) — {mcResult.reps} reps, n={+n||500}</Lbl>
                <MCHistogram betas={mcResult.betas} trueVal={null} meanVal={mcResult.mean}/>
              </div>
            )}
          </div>
        )}
      </div>

      {/* ── Hypothesis test on simulated data ── */}
      {generated && (
        <SampleTestPanel
          title="∗ Hypothesis test — simulated data"
          columns={generated.headers.map(h => ({ name: h, values: generated.rows.map(r => Number(r[h])) }))}
        />
      )}

      {/* ── QTE on simulated data ── */}
      {generated && (
        <QTEPanel
          title="∗ Quantile Treatment Effects — simulated data"
          columns={generated.headers.map(h => ({ name: h, values: generated.rows.map(r => Number(r[h])) }))}
        />
      )}

      {/* ── Variable Workspace & Statistics (moved from Calculate) ── */}
      <div style={{ borderTop: `1px solid ${C.border}`, marginTop: "2rem", paddingTop: "1.8rem" }}>
        <StatWorkspace
          rows={rows}
          headers={headers}
          onAddDataset={onAddDataset}
          onAddColumn={onAddColumn}
          onCreateDataset={onCreateDataset}
        />
      </div>

      {/* ── Script export ── */}
      <div style={{ borderTop: `1px solid ${C.border}`, paddingTop: "1.2rem" }}>
        <button
          onClick={() => setScriptOpen(o => !o)}
          style={{ background: "transparent", border: "none", color: C.textDim, cursor: "pointer", fontFamily: mono, fontSize: 10, padding: 0, display: "flex", alignItems: "center", gap: 6 }}
        >
          <span style={{ fontSize: 8 }}>{scriptOpen ? "▾" : "▸"}</span>
          Replication script
        </button>

        {scriptOpen && (
          <div style={{ marginTop: 10 }}>
            <div style={{ display: "flex", gap: 6, marginBottom: 10 }}>
              {[["r","R"],["python","Python"],["stata","Stata"]].map(([k,label]) => (
                <button key={k} onClick={() => setScriptLang(k)}
                  style={{ padding: "0.25rem 0.7rem", borderRadius: 3, cursor: "pointer", fontFamily: mono, fontSize: 10, background: scriptLang === k ? C.teal : "transparent", color: scriptLang === k ? C.bg : C.textDim, border: `1px solid ${scriptLang === k ? C.teal : C.border2}`, transition: "all 0.12s" }}>
                  {label}
                </button>
              ))}
            </div>
            <pre style={{ background: C.surface2, border: `1px solid ${C.border}`, borderRadius: 4, padding: "0.9rem 1rem", fontSize: 10, color: C.text, overflowX: "auto", whiteSpace: "pre", margin: 0, lineHeight: 1.65 }}>
              {generateSimScript(scriptLang, +n || 500, +seed || 0, variables)}
            </pre>
          </div>
        )}
      </div>
    </div>
  );
}
