// ─── ECON STUDIO · src/components/tabs/CalculateTab.jsx ──────────────────────
// Phase 9.7 + Phase 11 — Calculate Tab: variable workspace + math engine.
//
// Sections:
//   1. User-defined variables (scalar, vector, expression)
//   2. Computed from dataset (aggregate statistics)
//   3. New dataset from vectors
//   4. [NEW] Equation solver (Brent root finding)
//   5. [NEW] Derivatives (central-difference, multivariate)
//   6. [NEW] Model prediction (ŷ ± 95% CI from pinned models)
//
// Props: rows, headers, onAddDataset(name, rows, headers)

import { useState, useMemo } from "react";
import { evalExpression, buildScope, solveRoot, derivative, nthDerivative, predict } from "../../math/calcEngine.js";
import { getAll as getBufferedModels } from "../../services/modelBuffer.js";
import { interpretMarginalEffects } from "../../services/AI/AIService.js";

const C = {
  bg:"#080808", surface:"#0f0f0f", surface2:"#131313",
  border:"#1c1c1c", border2:"#252525",
  gold:"#c8a96e", goldDim:"#7a6040",
  text:"#ddd8cc", textDim:"#888", textMuted:"#444",
  green:"#7ab896", red:"#c47070",
  blue:"#6e9ec8", teal:"#6ec8b4", purple:"#a87ec8",
};
const mono = "'IBM Plex Mono','JetBrains Mono',Consolas,monospace";

// ─── ATOMS ────────────────────────────────────────────────────────────────────
function Lbl({ children, color = C.textMuted, mb = 6 }) {
  return <div style={{ fontSize: 10, color, letterSpacing: "0.2em", textTransform: "uppercase", marginBottom: mb, fontFamily: mono }}>{children}</div>;
}
function Btn({ onClick, ch, color = C.gold, v = "out", dis = false, sm = false }) {
  const b = { padding: sm ? "0.28rem 0.65rem" : "0.45rem 0.9rem", borderRadius: 3, cursor: dis ? "not-allowed" : "pointer", fontFamily: mono, fontSize: sm ? 10 : 11, transition: "all 0.13s", opacity: dis ? 0.4 : 1 };
  if (v === "solid") return <button onClick={onClick} disabled={dis} style={{ ...b, background: color, color: C.bg, border: `1px solid ${color}`, fontWeight: 700 }}>{ch}</button>;
  if (v === "ghost") return <button onClick={onClick} disabled={dis} style={{ ...b, background: "transparent", border: "none", color: dis ? C.textMuted : color }}>{ch}</button>;
  return <button onClick={onClick} disabled={dis} style={{ ...b, background: "transparent", border: `1px solid ${C.border2}`, color: dis ? C.textMuted : C.textDim }}>{ch}</button>;
}
function SectionHeader({ label, open, onToggle, badge }) {
  return (
    <div onClick={onToggle} style={{ background: C.surface2, padding: "0.55rem 0.85rem", borderBottom: open ? `1px solid ${C.border}` : "none", cursor: "pointer", display: "flex", alignItems: "center", gap: 8 }}>
      <span style={{ fontSize: 9, color: C.textMuted }}>{open ? "▾" : "▸"}</span>
      <Lbl color={C.textDim} mb={0}>{label}</Lbl>
      {badge && <span style={{ marginLeft: "auto", fontSize: 9, color: C.textMuted }}>{badge}</span>}
    </div>
  );
}
const fieldStyle = C => ({ background: C.surface2, border: `1px solid ${C.border2}`, borderRadius: 3, color: C.text, fontFamily: mono, fontSize: 11, padding: "0.28rem 0.55rem", outline: "none" });
const typeColor = C => ({ Integer: C.blue, Float: C.blue, String: C.teal, Date: C.teal, Boolean: "#c88e6e", Vector: C.purple, Expression: C.gold, Computed: C.textMuted });
const thStyle = C => ({ padding: "0.4rem 0.75rem", textAlign: "left", fontFamily: mono, fontWeight: 400, fontSize: 9, letterSpacing: "0.16em", textTransform: "uppercase", borderBottom: `1px solid ${C.border}`, color: C.textMuted, background: C.surface2 });
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
  return { Integer: "0", Float: "0.0", Boolean: "TRUE", Date: new Date().toISOString().slice(0, 10), Vector: "0", Expression: "" }[type] || "";
}
function fmt(n, d = 6) {
  if (n == null || !isFinite(n)) return "—";
  return Number(n).toFixed(d);
}

// ─── VALUE INPUT ──────────────────────────────────────────────────────────────
function ValueInput({ type, value, onChange }) {
  if (type === "Boolean") return (
    <select value={value} onChange={e => onChange(e.target.value)} style={{ ...fieldStyle(C), flex: 1 }}>
      <option>TRUE</option><option>FALSE</option>
    </select>
  );
  if (type === "Date") return <input type="date" value={value} onChange={e => onChange(e.target.value)} style={{ ...fieldStyle(C), flex: 1 }} />;
  if (type === "Expression") return (
    <input type="text" placeholder="e.g. 2*alpha + sqrt(beta)" value={value}
      onChange={e => onChange(e.target.value)} style={{ ...fieldStyle(C), flex: 1, minWidth: 160 }} />
  );
  const isNum = type === "Integer" || type === "Float";
  return <input type={isNum ? "number" : "text"} step={type === "Float" ? "any" : type === "Integer" ? "1" : undefined}
    placeholder={type === "Vector" ? "1.2, 0.8, -0.3" : isNum ? "0" : "…"}
    value={value} onChange={e => onChange(e.target.value)} style={{ ...fieldStyle(C), flex: 1, minWidth: 80 }} />;
}

// ─── RESULT BOX ───────────────────────────────────────────────────────────────
function ResultBox({ children, color = C.teal }) {
  return (
    <div style={{ background: `${color}0a`, border: `1px solid ${color}30`, borderRadius: 3, padding: "0.65rem 0.9rem", fontFamily: mono, fontSize: 11, color: C.text, lineHeight: 1.9, marginTop: 8 }}>
      {children}
    </div>
  );
}
function ErrBox({ msg }) {
  return <div style={{ color: C.red, fontFamily: mono, fontSize: 10, marginTop: 6 }}>{msg}</div>;
}

// ─── MAIN COMPONENT ───────────────────────────────────────────────────────────
export default function CalculateTab({ rows = [], headers = [], onAddDataset }) {
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

  // ── Equation solver ────────────────────────────────────────────────────────
  const [solverOpen,   setSolverOpen]  = useState(false);
  const [solExpr,      setSolExpr]     = useState("x**2 - 4");
  const [solA,         setSolA]        = useState("-10");
  const [solB,         setSolB]        = useState("10");
  const [solTol,       setSolTol]      = useState("1e-8");
  const [solResult,    setSolResult]   = useState(null);

  // ── Derivatives ───────────────────────────────────────────────────────────
  const [derivOpen,    setDerivOpen]   = useState(false);
  const [dExpr,        setDExpr]       = useState("x**3 + 2*x");
  const [dVar,         setDVar]        = useState("x");
  const [dPoint,       setDPoint]      = useState("2");
  const [dOrder,       setDOrder]      = useState("1");
  const [dResult,      setDResult]     = useState(null);

  // ── Model prediction ──────────────────────────────────────────────────────
  const [predOpen,     setPredOpen]    = useState(false);
  const [predModelId,  setPredModelId] = useState("");
  const [predInputs,   setPredInputs]  = useState({});  // { varName: string }
  const [predResult,   setPredResult]  = useState(null);
  const [bufVersion,   setBufVersion]  = useState(0);   // force re-read buffer
  const [interpLoading, setInterpLoading] = useState(false);
  const [interpText,    setInterpText]    = useState(null);
  const [interpErr,     setInterpErr]     = useState(null);

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

  // ── Handlers ──────────────────────────────────────────────────────────────
  function addVariable() {
    const n = newName.trim();
    if (!NAME_RE.test(n)) { setNameErr("Alphanumeric + underscore, no spaces."); return; }
    if (allNames().includes(n)) { setNameErr("Name already used."); return; }
    setNameErr("");
    setVariables(vs => [...vs, { id: Date.now(), name: n, type: newType, rawValue: newValue || defaultVal(newType) }]);
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
      const a = parseFloat(solA), b = parseFloat(solB), tol = parseFloat(solTol) || 1e-8;
      if (!isFinite(a) || !isFinite(b)) { setSolResult({ error: "a and b must be finite numbers." }); return; }
      const fn = new Function("x", ...Object.keys(scope), `"use strict"; return (${solExpr});`);
      const wrappedFn = x => fn(x, ...Object.values(scope));
      setSolResult(solveRoot(wrappedFn, a, b, tol));
    } catch (e) { setSolResult({ error: `Expression error: ${e.message}` }); }
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

  // ── Model prediction ──────────────────────────────────────────────────────
  const bufferedModels = useMemo(() => getBufferedModels().filter(m => m.beta?.length > 0), [bufVersion]);
  const predModel = bufferedModels.find(m => m.id === predModelId) ?? bufferedModels[0] ?? null;

  function runPredict() {
    if (!predModel) return;
    const { beta, varNames, XtXinv, s2, df } = predModel;
    const xVec = varNames.map((vn, i) => {
      if (i === 0 && vn === "(Intercept)") return 1;
      const raw = predInputs[vn] ?? "";
      return parseFloat(raw) || 0;
    });
    setPredResult(predict(beta, xVec, XtXinv, s2, df ?? 100));
  }

  // Inline-editable variable row
  function VarRow({ v }) {
    const ev = evaluatedVars.find(x => x.id === v.id) ?? v;
    const [editing, setEditing] = useState(false);
    const [editVal, setEditVal] = useState(v.rawValue);
    function save() { setVariables(vs => vs.map(x => x.id === v.id ? { ...x, rawValue: editVal } : x)); setEditing(false); }

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
        <td style={tdStyle(C)}><span style={{ fontFamily: mono, fontSize: 11, color: C.text }}>{v.name}</span></td>
        <td style={tdStyle(C)}><span style={{ fontSize: 9, padding: "2px 6px", border: `1px solid ${typeColor(C)[v.type]}`, color: typeColor(C)[v.type], borderRadius: 2, fontFamily: mono }}>{v.type}</span></td>
        <td style={{ ...tdStyle(C), maxWidth: 300 }}>
          {editing
            ? <span style={{ display: "flex", gap: 4, alignItems: "center" }}>
                <ValueInput type={v.type} value={editVal} onChange={setEditVal} />
                <Btn ch="✓" sm v="ghost" color={C.green} onClick={save} />
                <Btn ch="✕" sm v="ghost" color={C.textMuted} onClick={() => setEditing(false)} />
              </span>
            : <span onClick={() => { setEditVal(v.rawValue); setEditing(true); }} title="Click to edit"
                style={{ cursor: "text", fontFamily: mono, fontSize: 11 }}>
                {displayVal()}
              </span>
          }
        </td>
        <td style={{ ...tdStyle(C), textAlign: "right" }}>
          <button onClick={() => setVariables(vs => vs.filter(x => x.id !== v.id))}
            style={{ background: "transparent", border: "none", color: C.textMuted, cursor: "pointer", fontFamily: mono, fontSize: 14 }}
            onMouseEnter={e => e.currentTarget.style.color = C.red}
            onMouseLeave={e => e.currentTarget.style.color = C.textMuted}>×</button>
        </td>
      </tr>
    );
  }

  const vectorVars = variables.filter(v => v.type === "Vector");

  return (
    <div style={{ height: "100%", overflowY: "auto", padding: "1.8rem 2.4rem", fontFamily: mono, color: C.text, maxWidth: 900 }}>

      {/* Header + export buttons */}
      <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: "1.6rem", flexWrap: "wrap" }}>
        <div>
          <div style={{ fontSize: 9, color: C.teal, letterSpacing: "0.26em", textTransform: "uppercase", marginBottom: 3 }}>Calculate</div>
          <div style={{ fontSize: 18, color: C.text, letterSpacing: "-0.01em" }}>Variable Workspace</div>
        </div>
        <div style={{ marginLeft: "auto", display: "flex", gap: 6 }}>
          {[["↓R","r",C.gold],["↓Stata","stata",C.teal],["↓py","python",C.blue]].map(([label,lang,color]) => (
            <button key={lang}
              onClick={() => download(generateCalcScript(lang, variables, computeds), `calculate.${lang === "r" ? "R" : lang === "stata" ? "do" : "py"}`)}
              style={{ padding: "0.3rem 0.7rem", background: "transparent", border: `1px solid ${C.border2}`, borderRadius: 3, color: C.textDim, cursor: "pointer", fontFamily: mono, fontSize: 10, transition: "all 0.12s" }}
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
            <thead><tr>{["Name","Type","Value",""].map(h => <th key={h} style={thStyle(C)}>{h}</th>)}</tr></thead>
            <tbody>{variables.map(v => <VarRow key={v.id} v={v} />)}</tbody>
          </table>
        )}
        <div style={{ padding: "0.7rem 0.85rem", background: C.surface, borderTop: variables.length ? `1px solid ${C.border}` : "none", display: "flex", gap: 6, flexWrap: "wrap", alignItems: "flex-start" }}>
          <input placeholder="var_name" value={newName} onChange={e => { setNewName(e.target.value); setNameErr(""); }}
            onKeyDown={e => e.key === "Enter" && addVariable()} style={{ ...fieldStyle(C), width: 150 }} />
          <select value={newType} onChange={e => { setNewType(e.target.value); setNewValue(""); }} style={fieldStyle(C)}>
            {["Integer","Float","String","Date","Boolean","Vector","Expression"].map(t => <option key={t}>{t}</option>)}
          </select>
          <ValueInput type={newType} value={newValue} onChange={setNewValue} />
          <Btn ch="Add" v="solid" color={C.gold} onClick={addVariable} sm />
        </div>
        {nameErr && <div style={{ padding: "0 0.85rem 0.5rem", fontSize: 10, color: C.red }}>{nameErr}</div>}
      </div>

      {/* ── 2. Computed from dataset ────────────────────────────────────────── */}
      <div style={{ border: `1px solid ${C.border}`, borderRadius: 4, overflow: "hidden", marginBottom: "1.4rem" }}>
        <SectionHeader label="Computed from dataset" open={computedOpen} onToggle={() => setComputedOpen(o => !o)} badge={!rows.length ? "no active dataset" : null} />
        {computedOpen && (
          <>
            {computeds.length > 0 && (
              <table style={{ borderCollapse: "collapse", width: "100%" }}>
                <thead><tr>{["Name","Type","Expression","Value",""].map(h => <th key={h} style={thStyle(C)}>{h}</th>)}</tr></thead>
                <tbody>
                  {computeds.map(c => (
                    <tr key={c.id}>
                      <td style={tdStyle(C)}><span style={{ fontFamily: mono, fontSize: 11, color: C.text }}>{c.name}</span></td>
                      <td style={tdStyle(C)}><span style={{ fontSize: 9, padding: "2px 6px", border: `1px solid ${C.textMuted}`, color: C.textMuted, borderRadius: 2, fontFamily: mono }}>Computed</span></td>
                      <td style={tdStyle(C)}><span style={{ fontFamily: mono, fontSize: 11, color: C.textDim }}>{c.fn}({c.col})</span></td>
                      <td style={{ ...tdStyle(C), color: C.teal, fontFamily: mono, fontSize: 11 }}>{evalComputed(c.fn, c.col, rows)}</td>
                      <td style={{ ...tdStyle(C), textAlign: "right" }}>
                        <button onClick={() => setComputeds(cs => cs.filter(x => x.id !== c.id))}
                          style={{ background: "transparent", border: "none", color: C.textMuted, cursor: "pointer", fontFamily: mono, fontSize: 14 }}
                          onMouseEnter={e => e.currentTarget.style.color = C.red}
                          onMouseLeave={e => e.currentTarget.style.color = C.textMuted}>×</button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
            <div style={{ padding: "0.7rem 0.85rem", background: C.surface, borderTop: computeds.length ? `1px solid ${C.border}` : "none", display: "flex", gap: 6, flexWrap: "wrap", alignItems: "center" }}>
              <input placeholder="var_name" value={newCName} onChange={e => setNewCName(e.target.value)} onKeyDown={e => e.key === "Enter" && addComputed()} style={{ ...fieldStyle(C), width: 130 }} />
              <select value={newCFn} onChange={e => setNewCFn(e.target.value)} style={fieldStyle(C)}>
                {["mean","sum","count","min","max"].map(f => <option key={f}>{f}</option>)}
              </select>
              <select value={newCCol || numericHeaders[0] || ""} onChange={e => setNewCCol(e.target.value)} style={{ ...fieldStyle(C), maxWidth: 200 }}>
                {numericHeaders.length ? numericHeaders.map(h => <option key={h}>{h}</option>) : <option value="">— no numeric columns —</option>}
              </select>
              <Btn ch="Add" v="solid" color={C.blue} onClick={addComputed} sm dis={!numericHeaders.length} />
            </div>
          </>
        )}
      </div>

      {/* ── 3. Dataset from vectors ─────────────────────────────────────────── */}
      {vectorVars.length > 0 && (
        <div style={{ border: `1px solid ${C.border}`, borderRadius: 4, overflow: "hidden", marginBottom: "1.4rem" }}>
          <div style={{ background: C.surface2, padding: "0.55rem 0.85rem", borderBottom: `1px solid ${C.border}`, display: "flex", alignItems: "center", justifyContent: "space-between" }}>
            <Lbl color={C.textDim} mb={0}>New dataset from variables</Lbl>
            {!datasetForm && <Btn ch="+ Create dataset" sm v="solid" color={C.teal} onClick={() => setDatasetForm({ name: "", selectedVars: [] })} />}
          </div>
          {datasetForm
            ? <div style={{ padding: "0.8rem 0.85rem", background: C.surface, display: "flex", flexDirection: "column", gap: 10 }}>
                <input placeholder="dataset name" value={datasetForm.name} onChange={e => setDatasetForm(f => ({ ...f, name: e.target.value }))} style={{ ...fieldStyle(C), width: 220 }} />
                <div>
                  <Lbl color={C.textMuted} mb={6}>Select Vector columns</Lbl>
                  <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
                    {vectorVars.map(v => {
                      const sel = datasetForm.selectedVars.includes(v.name);
                      return <button key={v.name}
                        onClick={() => setDatasetForm(f => ({ ...f, selectedVars: sel ? f.selectedVars.filter(n => n !== v.name) : [...f.selectedVars, v.name] }))}
                        style={{ padding: "0.25rem 0.6rem", fontFamily: mono, fontSize: 10, cursor: "pointer", borderRadius: 3, background: sel ? `${C.purple}20` : "transparent", border: `1px solid ${sel ? C.purple : C.border2}`, color: sel ? C.purple : C.textDim }}>
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
            : <div style={{ padding: "0.5rem 0.85rem", background: C.surface, fontSize: 10, color: C.textMuted }}>{vectorVars.map(v => v.name).join(", ")} · {vectorVars.length} vector{vectorVars.length > 1 ? "s" : ""} available</div>
          }
        </div>
      )}

      {/* ── 4. Equation Solver ─────────────────────────────────────────────── */}
      <div style={{ border: `1px solid ${C.border}`, borderRadius: 4, overflow: "hidden", marginBottom: "1.4rem" }}>
        <SectionHeader label="Equation Solver — find x where f(x) = 0" open={solverOpen} onToggle={() => { setSolverOpen(o => !o); setSolResult(null); }} />
        {solverOpen && (
          <div style={{ padding: "0.85rem", background: C.surface, display: "flex", flexDirection: "column", gap: 10 }}>
            <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
              <span style={{ fontFamily: mono, fontSize: 11, color: C.textMuted, whiteSpace: "nowrap" }}>f(x) =</span>
              <input value={solExpr} onChange={e => setSolExpr(e.target.value)}
                placeholder="x**2 - 4"
                style={{ ...fieldStyle(C), flex: 1, minWidth: 180 }} />
            </div>
            <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center" }}>
              <span style={{ fontFamily: mono, fontSize: 10, color: C.textMuted }}>interval</span>
              <input value={solA} onChange={e => setSolA(e.target.value)} placeholder="a" style={{ ...fieldStyle(C), width: 80 }} />
              <span style={{ color: C.textMuted }}>to</span>
              <input value={solB} onChange={e => setSolB(e.target.value)} placeholder="b" style={{ ...fieldStyle(C), width: 80 }} />
              <span style={{ fontFamily: mono, fontSize: 10, color: C.textMuted }}>tol</span>
              <input value={solTol} onChange={e => setSolTol(e.target.value)} style={{ ...fieldStyle(C), width: 90 }} />
              <Btn ch="Solve" v="solid" color={C.gold} sm onClick={runSolver} />
            </div>
            <div style={{ fontSize: 9, color: C.textMuted }}>
              Variables in scope: {Object.keys(scope).join(", ") || "none (define numeric variables above)"}
            </div>
            {solResult && (solResult.error
              ? <ErrBox msg={solResult.error} />
              : <ResultBox>
                  <div><span style={{ color: C.textMuted }}>root </span><span style={{ color: C.gold }}>{fmt(solResult.root, 10)}</span></div>
                  <div><span style={{ color: C.textMuted }}>f(root) </span><span style={{ color: C.teal, fontSize: 10 }}>≈ 0</span></div>
                  <div><span style={{ color: C.textMuted }}>iterations </span>{solResult.iter}</div>
                  {!solResult.converged && <div style={{ color: C.red, fontSize: 10 }}>Warning: did not fully converge — try a tighter bracket.</div>}
                </ResultBox>
            )}
          </div>
        )}
      </div>

      {/* ── 5. Derivatives ─────────────────────────────────────────────────── */}
      <div style={{ border: `1px solid ${C.border}`, borderRadius: 4, overflow: "hidden", marginBottom: "1.4rem" }}>
        <SectionHeader label="Derivatives & Marginal Effects" open={derivOpen} onToggle={() => { setDerivOpen(o => !o); setDResult(null); }} />
        {derivOpen && (
          <div style={{ padding: "0.85rem", background: C.surface, display: "flex", flexDirection: "column", gap: 10 }}>
            <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center" }}>
              <span style={{ fontFamily: mono, fontSize: 11, color: C.textMuted, whiteSpace: "nowrap" }}>f( </span>
              <input value={dVar} onChange={e => setDVar(e.target.value)} placeholder="x"
                style={{ ...fieldStyle(C), width: 60 }} />
              <span style={{ fontFamily: mono, fontSize: 11, color: C.textMuted, whiteSpace: "nowrap" }}> ) =</span>
              <input value={dExpr} onChange={e => setDExpr(e.target.value)}
                placeholder="x**3 + 2*x"
                style={{ ...fieldStyle(C), flex: 1, minWidth: 180 }} />
            </div>
            <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center" }}>
              <span style={{ fontFamily: mono, fontSize: 10, color: C.textMuted }}>evaluate at</span>
              <input value={dPoint} onChange={e => setDPoint(e.target.value)} placeholder="point"
                style={{ ...fieldStyle(C), width: 90 }} />
              <span style={{ fontFamily: mono, fontSize: 10, color: C.textMuted }}>order</span>
              <select value={dOrder} onChange={e => setDOrder(e.target.value)} style={{ ...fieldStyle }}>
                {["1","2","3","4"].map(n => <option key={n}>{n}</option>)}
              </select>
              <Btn ch="Compute" v="solid" color={C.teal} sm onClick={runDerivative} />
            </div>
            <div style={{ fontSize: 9, color: C.textMuted }}>
              Other variables in scope: {Object.keys(scope).filter(k => k !== dVar.trim()).join(", ") || "none"}
            </div>
            {dResult && (dResult.error
              ? <ErrBox msg={dResult.error} />
              : <ResultBox color={C.teal}>
                  <div><span style={{ color: C.textMuted }}>f({dResult.varName} = {dResult.x0}) </span><span style={{ color: C.text }}>{fmt(dResult.val, 8)}</span></div>
                  {dResult.d1 != null && <div><span style={{ color: C.textMuted }}>f′({dResult.x0}) </span><span style={{ color: C.teal }}>{fmt(dResult.d1, 8)}</span></div>}
                  {dResult.n > 1 && dResult.dn != null && <div><span style={{ color: C.textMuted }}>f<sup>({dResult.n})</sup>({dResult.x0}) </span><span style={{ color: C.gold }}>{fmt(dResult.dn, 8)}</span></div>}
                  <div style={{ fontSize: 9, color: C.textMuted, marginTop: 4 }}>Numerical (central difference, h = 1e-6)</div>
                </ResultBox>
            )}
          </div>
        )}
      </div>

      {/* ── 6. Model Prediction ─────────────────────────────────────────────── */}
      <div style={{ border: `1px solid ${C.border}`, borderRadius: 4, overflow: "hidden", marginBottom: "1.4rem" }}>
        <SectionHeader
          label="Predict from Model"
          open={predOpen}
          onToggle={() => { setPredOpen(o => !o); setPredResult(null); setBufVersion(v => v + 1); }}
          badge={bufferedModels.length === 0 ? "no pinned models" : `${bufferedModels.length} model${bufferedModels.length > 1 ? "s" : ""} available`}
        />
        {predOpen && (
          <div style={{ padding: "0.85rem", background: C.surface, display: "flex", flexDirection: "column", gap: 12 }}>
            {bufferedModels.length === 0
              ? <div style={{ color: C.textMuted, fontSize: 11 }}>Pin a model in the Model tab first (click "Pin" after estimation).</div>
              : <>
                  {/* Model picker */}
                  <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                    <span style={{ fontFamily: mono, fontSize: 10, color: C.textMuted, whiteSpace: "nowrap" }}>Model</span>
                    <select
                      value={predModelId || predModel?.id || ""}
                      onChange={e => { setPredModelId(e.target.value); setPredInputs({}); setPredResult(null); setInterpText(null); setInterpErr(null); }}
                      style={{ ...fieldStyle(C), flex: 1 }}
                    >
                      {bufferedModels.map(m => (
                        <option key={m.id} value={m.id}>{m.label} — {m.spec?.yVar ?? "Y"} ~ {(m.spec?.xVars ?? []).join(" + ") || "…"}</option>
                      ))}
                    </select>
                  </div>

                  {/* X value inputs */}
                  {predModel && (
                    <div>
                      <Lbl color={C.textMuted} mb={8}>Covariate values (intercept = 1 fixed)</Lbl>
                      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(200px, 1fr))", gap: 8 }}>
                        {predModel.varNames.map((vn, i) => {
                          if (i === 0 && vn === "(Intercept)") return null;
                          const colMean = rows.length ? (() => {
                            const vals = rows.map(r => Number(r[vn])).filter(isFinite);
                            return vals.length ? (vals.reduce((a, b) => a + b, 0) / vals.length).toFixed(4) : "";
                          })() : "";
                          return (
                            <div key={vn} style={{ display: "flex", flexDirection: "column", gap: 3 }}>
                              <span style={{ fontFamily: mono, fontSize: 9, color: C.textMuted }}>{vn}</span>
                              <input
                                type="number" step="any"
                                placeholder={colMean || "value"}
                                value={predInputs[vn] ?? ""}
                                onChange={e => { setPredInputs(p => ({ ...p, [vn]: e.target.value })); setPredResult(null); }}
                                style={{ ...fieldStyle }}
                              />
                            </div>
                          );
                        }).filter(Boolean)}
                      </div>
                    </div>
                  )}

                  <div style={{ display: "flex", gap: 8 }}>
                    <Btn ch="Predict" v="solid" color={C.gold} sm dis={!predModel} onClick={runPredict} />
                    <Btn ch="Use dataset means" sm v="ghost" color={C.textDim}
                      dis={!predModel || !rows.length}
                      onClick={() => {
                        if (!predModel) return;
                        const inputs = {};
                        predModel.varNames.forEach((vn, i) => {
                          if (i === 0 && vn === "(Intercept)") return;
                          const vals = rows.map(r => Number(r[vn])).filter(isFinite);
                          if (vals.length) inputs[vn] = (vals.reduce((a, b) => a + b, 0) / vals.length).toFixed(6);
                        });
                        setPredInputs(inputs);
                        setPredResult(null);
                      }}
                    />
                  </div>

                  {predResult && (
                    <>
                      <ResultBox color={C.gold}>
                        <div style={{ display: "grid", gridTemplateColumns: "auto 1fr", rowGap: 4, columnGap: 24 }}>
                          <span style={{ color: C.textMuted }}>ŷ (predicted)</span>
                          <span style={{ color: C.gold, fontWeight: 700 }}>{fmt(predResult.yhat, 6)}</span>
                          <span style={{ color: C.textMuted }}>SE(ŷ)</span>
                          <span>{predResult.se > 0 ? fmt(predResult.se, 6) : <span style={{ color: C.textMuted }}>— (XtXinv not available)</span>}</span>
                          <span style={{ color: C.textMuted }}>95% CI</span>
                          <span>[{fmt(predResult.ciLow, 4)}, {fmt(predResult.ciHigh, 4)}]</span>
                        </div>
                        {predModel && (
                          <div style={{ marginTop: 10, borderTop: `1px solid ${C.border}`, paddingTop: 8 }}>
                            <div style={{ fontSize: 9, color: C.textMuted, marginBottom: 6, letterSpacing: "0.15em" }}>MARGINAL EFFECTS (β)</div>
                            {predModel.varNames.map((vn, i) => (
                              <div key={vn} style={{ display: "flex", gap: 16, fontSize: 10 }}>
                                <span style={{ color: C.textMuted, minWidth: 140 }}>{vn}</span>
                                <span style={{ color: Math.sign(predModel.beta[i]) >= 0 ? C.teal : C.red }}>{fmt(predModel.beta[i], 6)}</span>
                                <span style={{ color: C.textMuted }}>SE {fmt(predModel.se[i], 4)}</span>
                              </div>
                            ))}
                          </div>
                        )}
                      </ResultBox>

                      {/* ── AI Interpretation ─────────────────────────────────────── */}
                      <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
                        <Btn
                          ch={interpLoading ? "Interpreting…" : "✦ Interpret"}
                          v="solid" color={C.purple} sm
                          dis={interpLoading || !predModel}
                          onClick={async () => {
                            setInterpLoading(true); setInterpText(null); setInterpErr(null);
                            try {
                              const text = await interpretMarginalEffects({
                                model: predModel,
                                prediction: predResult,
                              });
                              setInterpText(text);
                            } catch (err) {
                              setInterpErr(err.message ?? "AI interpretation failed.");
                            } finally {
                              setInterpLoading(false);
                            }
                          }}
                        />
                        {interpText && <Btn ch="Clear" sm v="ghost" color={C.textMuted} onClick={() => { setInterpText(null); setInterpErr(null); }} />}
                        <span style={{ fontSize: 9, color: C.textMuted, marginLeft: 4 }}>Requires API key</span>
                      </div>
                      {interpErr && <ErrBox msg={interpErr} />}
                      {interpText && (
                        <div style={{ background: `${C.purple}12`, border: `1px solid ${C.purple}40`, borderRadius: 4, padding: "0.85rem 1rem", fontSize: 11, color: C.text, lineHeight: 1.75, whiteSpace: "pre-wrap" }}>
                          <div style={{ fontSize: 9, color: C.purple, letterSpacing: "0.18em", marginBottom: 8 }}>AI INTERPRETATION</div>
                          {interpText}
                        </div>
                      )}
                    </>
                  )}
                </>
            }
          </div>
        )}
      </div>

      {variables.length === 0 && computeds.length === 0 && (
        <div style={{ padding: "2.5rem", textAlign: "center", color: C.textMuted, fontSize: 11, lineHeight: 1.8 }}>
          Define scalars, vectors, and expressions above.<br />
          <span style={{ color: C.textDim }}>Use the Equation Solver and Derivative sections for math.<br />Predict from pinned models using the Predict panel.</span>
        </div>
      )}
    </div>
  );
}
