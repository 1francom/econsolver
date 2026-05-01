// ─── ECON STUDIO · src/components/tabs/SimulateTab.jsx ────────────────────────
// Phase 9.8 — Simulate Tab: DGP builder for synthetic dataset generation.
// Props: onAddDataset(name, rows, headers)

import { useState } from "react";

const C = {
  bg:"#080808", surface:"#0f0f0f", surface2:"#131313",
  border:"#1c1c1c", border2:"#252525",
  gold:"#c8a96e", goldDim:"#7a6040", goldFaint:"#1a1408",
  text:"#ddd8cc", textDim:"#888", textMuted:"#444",
  green:"#7ab896", red:"#c47070",
  blue:"#6e9ec8", teal:"#6ec8b4", purple:"#a87ec8",
};
const mono = "'IBM Plex Mono','JetBrains Mono',Consolas,monospace";

// ─── ATOMS ────────────────────────────────────────────────────────────────────
function Lbl({ children, color = C.textMuted, mb = 6 }) {
  return <div style={{ fontSize: 9, color, letterSpacing: "0.2em", textTransform: "uppercase", marginBottom: mb, fontFamily: mono }}>{children}</div>;
}
function Btn({ onClick, ch, color = C.gold, v = "out", dis = false, sm = false }) {
  const b = { padding: sm ? "0.28rem 0.65rem" : "0.45rem 0.9rem", borderRadius: 3, cursor: dis ? "not-allowed" : "pointer", fontFamily: mono, fontSize: sm ? 10 : 11, transition: "all 0.13s", opacity: dis ? 0.4 : 1 };
  if (v === "solid") return <button onClick={onClick} disabled={dis} style={{ ...b, background: color, color: C.bg, border: `1px solid ${color}`, fontWeight: 700 }}>{ch}</button>;
  if (v === "ghost") return <button onClick={onClick} disabled={dis} style={{ ...b, background: "transparent", border: "none", color: dis ? C.textMuted : color }}>{ch}</button>;
  return <button onClick={onClick} disabled={dis} style={{ ...b, background: "transparent", border: `1px solid ${C.border2}`, color: dis ? C.textMuted : C.textDim }}>{ch}</button>;
}
const fieldStyle = C => ({ background: C.surface2, border: `1px solid ${C.border2}`, borderRadius: 3, color: C.text, fontFamily: mono, fontSize: 11, padding: "0.28rem 0.55rem", outline: "none" });
const thStyle = C => ({ padding: "0.4rem 0.75rem", textAlign: "left", fontFamily: mono, fontWeight: 400, fontSize: 9, letterSpacing: "0.16em", textTransform: "uppercase", borderBottom: `1px solid ${C.border}`, color: C.textMuted, background: C.surface2, whiteSpace: "nowrap" });
const tdStyle = C => ({ padding: "0.32rem 0.65rem", borderBottom: `1px solid ${C.border}`, verticalAlign: "middle" });

// ─── SEEDED PRNG (mulberry32) ─────────────────────────────────────────────────
function mulberry32(seed) {
  let s = seed >>> 0;
  return function () {
    s |= 0; s = s + 0x6D2B79F5 | 0;
    let t = Math.imul(s ^ s >>> 15, 1 | s);
    t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t;
    return ((t ^ t >>> 14) >>> 0) / 4294967296;
  };
}

// Box-Muller using the seeded rng
function normalSample(rng, mean, sd) {
  const u1 = rng(), u2 = rng();
  const z = Math.sqrt(-2 * Math.log(u1 + 1e-15)) * Math.cos(2 * Math.PI * u2);
  return mean + sd * z;
}

function drawSamples(rng, n, dist, params) {
  const arr = [];
  for (let i = 0; i < n; i++) {
    const u = rng();
    switch (dist) {
      case "Normal":     arr.push(normalSample(rng, +params.mean ?? 0, +params.sd ?? 1)); break;
      case "Uniform":    arr.push((+params.min ?? 0) + u * ((+params.max ?? 1) - (+params.min ?? 0))); break;
      case "Bernoulli":  arr.push(u < (+params.p ?? 0.5) ? 1 : 0); break;
      case "Poisson": {
        // Knuth algorithm
        const lam = +params.lambda ?? 1;
        const L = Math.exp(-lam); let k = 0, p = 1;
        do { k++; p *= rng(); } while (p > L);
        arr.push(k - 1);
        break;
      }
      case "Exponential": arr.push(-Math.log(1 - u + 1e-15) / (+params.lambda ?? 1)); break;
      case "t": {
        // t via ratio of normals / chi
        const df = +params.df ?? 5;
        const z1 = normalSample(rng, 0, 1);
        let chi = 0;
        for (let j = 0; j < df; j++) { const z = normalSample(rng, 0, 1); chi += z * z; }
        arr.push(z1 / Math.sqrt(chi / df));
        break;
      }
      case "Chi-squared": {
        const df2 = +params.df ?? 3;
        let chi2 = 0;
        for (let j = 0; j < df2; j++) { const z = normalSample(rng, 0, 1); chi2 += z * z; }
        arr.push(chi2);
        break;
      }
      default: arr.push(0);
    }
  }
  return arr;
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
  Expression:  { expr: "" },
  ForLoop:     { init: "0", update: "prev * 0.9 + eps[i]" },
  WhileLoop:   { init: "1", update: "prev * 0.95", condition: "Math.abs(prev) > 0.001", maxIter: "1000" },
};

const DIST_OPTIONS = ["Normal","Uniform","Bernoulli","Poisson","Exponential","t","Chi-squared","Expression","ForLoop","WhileLoop"];

const DIST_COLOR = {
  Normal: C.blue, Uniform: C.teal, Bernoulli: C.purple,
  Poisson: C.gold, Exponential: "#c88e6e", t: C.green,
  "Chi-squared": "#c87e9e", Expression: C.textDim,
  ForLoop: "#9ec87e", WhileLoop: "#c87e6e",
};

// ─── PARAM EDITOR ─────────────────────────────────────────────────────────────
function ParamEditor({ dist, params, onChange }) {
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

  const lines = [];
  if (language === "r") {
    lines.push(`set.seed(${seed})`, `n <- ${n}`);
    variables.forEach(v => {
      if (v.dist === "Expression") {
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
    lines.push("import numpy as np", "import pandas as pd", `rng = np.random.default_rng(${seed})`, `n = ${n}`);
    variables.forEach(v => {
      if (v.dist === "Expression") {
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
    lines.push(`set seed ${seed}`, `set obs ${n}`);
    variables.forEach(v => {
      if (v.dist === "Expression") {
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

export default function SimulateTab({ onAddDataset }) {
  const [n,          setN]          = useState(500);
  const [seed,       setSeed]       = useState(42);
  const [variables,  setVariables]  = useState([
    { id:1, name:"X1",  dist:"Normal",     params:{ mean:0, sd:1 } },
    { id:2, name:"eps", dist:"Normal",     params:{ mean:0, sd:0.5 } },
    { id:3, name:"Y",   dist:"Expression", params:{ expr:"1 + 2*X1 + eps" } },
  ]);
  const [generated,  setGenerated]  = useState(null); // { rows, headers }
  const [dsName,     setDsName]     = useState("simulated_data");
  const [newVarName, setNewVarName] = useState("");
  const [newDist,    setNewDist]    = useState("Normal");
  const [genErr,     setGenErr]     = useState("");
  const [saved,      setSaved]      = useState(false);
  const [scriptLang, setScriptLang] = useState("r");
  const [scriptOpen, setScriptOpen] = useState(false);

  // ── Generate ───────────────────────────────────────────────────────────────
  function generate() {
    setGenErr(""); setSaved(false);
    const rng = mulberry32(+seed || 0);
    const nObs = Math.max(1, Math.min(100000, +n || 500));
    const scope = {}; // built-up variable arrays

    for (const v of variables) {
      if (!v.name.trim()) { setGenErr(`Variable with empty name — fix before generating.`); return; }
      if (v.dist === "Expression") {
        const expr = (v.params.expr || "").trim();
        if (!expr) { setGenErr(`${v.name}: expression is empty.`); return; }
        try {
          const varNames = Object.keys(scope);
          const varArrays = Object.values(scope);
          const arr = [];
          for (let i = 0; i < nObs; i++) {
            const scalars = varArrays.map(a => a[i]);
            // eslint-disable-next-line no-new-func
            const val = new Function(...varNames, `"use strict"; return (${expr});`)(...scalars);
            arr.push(typeof val === "number" ? val : 0);
          }
          scope[v.name] = arr;
        } catch (e) {
          setGenErr(`${v.name}: expression error — ${e.message}`);
          return;
        }
      } else if (v.dist === "ForLoop") {
        const initExpr  = (v.params.init   || "0").trim();
        const updExpr   = (v.params.update || "prev").trim();
        const varNames  = Object.keys(scope);
        const varArrays = Object.values(scope);
        try {
          const arr = new Array(nObs);
          // eslint-disable-next-line no-new-func
          const initFn = new Function(...varNames, `"use strict"; return (${initExpr});`);
          const scalarsAt0 = varArrays.map(a => a[0]);
          arr[0] = initFn(...scalarsAt0);
          for (let i = 1; i < nObs; i++) {
            const prev = arr[i - 1];
            const scalars = varArrays.map(a => a[i]);
            // eslint-disable-next-line no-new-func
            arr[i] = new Function("prev", "i", ...varNames, `"use strict"; return (${updExpr});`)(prev, i, ...scalars);
          }
          scope[v.name] = arr;
        } catch (e) {
          setGenErr(`${v.name} (ForLoop): ${e.message}`);
          return;
        }
      } else if (v.dist === "WhileLoop") {
        const initExpr  = (v.params.init      || "1").trim();
        const updExpr   = (v.params.update    || "prev").trim();
        const condExpr  = (v.params.condition || "false").trim();
        const maxIter   = Math.max(1, Math.min(100000, +(v.params.maxIter) || 1000));
        try {
          // eslint-disable-next-line no-new-func
          let val = new Function(`"use strict"; return (${initExpr});`)();
          let iter = 0;
          // eslint-disable-next-line no-new-func
          const condFn = new Function("prev", `"use strict"; return !!(${condExpr});`);
          // eslint-disable-next-line no-new-func
          const updFn  = new Function("prev", `"use strict"; return (${updExpr});`);
          while (condFn(val) && iter < maxIter) {
            val = updFn(val);
            iter++;
          }
          // WhileLoop produces a scalar — broadcast to all rows
          scope[v.name] = new Array(nObs).fill(typeof val === "number" ? val : 0);
        } catch (e) {
          setGenErr(`${v.name} (WhileLoop): ${e.message}`);
          return;
        }
      } else {
        scope[v.name] = drawSamples(rng, nObs, v.dist, v.params);
      }
    }

    const headers = variables.map(v => v.name);
    const rows = [];
    for (let i = 0; i < nObs; i++) {
      const row = {};
      headers.forEach(h => { row[h] = scope[h][i]; });
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
    setSaved(true);
  }

  // ── Preview table ──────────────────────────────────────────────────────────
  const previewRows = generated?.rows.slice(0, 5) ?? [];

  return (
    <div style={{ height: "100%", overflowY: "auto", padding: "1.8rem 2.2rem", fontFamily: mono, color: C.text, maxWidth: 900 }}>
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
                <th style={{ ...thStyle, width: 24 }}>#</th>
                <th style={thStyle(C)}>Name</th>
                <th style={thStyle(C)}>Distribution</th>
                <th style={thStyle(C)}>Parameters</th>
                <th style={{ ...thStyle, textAlign: "right" }}>Actions</th>
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
                    <th key={h} style={{ ...thStyle, color: C.teal }}>{h}</th>
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
