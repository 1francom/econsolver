// ─── ECON STUDIO · src/components/tabs/CalculateTab.jsx ──────────────────────
// Phase 9.7 — Calculate Tab: structured variable workspace.
// User-defined variables + computed aggregates from active dataset.
//
// Props: rows, headers, onAddDataset(name, rows, headers)

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
  return <div style={{ fontSize: 10, color, letterSpacing: "0.2em", textTransform: "uppercase", marginBottom: mb, fontFamily: mono }}>{children}</div>;
}
function Btn({ onClick, ch, color = C.gold, v = "out", dis = false, sm = false }) {
  const b = { padding: sm ? "0.28rem 0.65rem" : "0.45rem 0.9rem", borderRadius: 3, cursor: dis ? "not-allowed" : "pointer", fontFamily: mono, fontSize: sm ? 10 : 11, transition: "all 0.13s", opacity: dis ? 0.4 : 1 };
  if (v === "solid") return <button onClick={onClick} disabled={dis} style={{ ...b, background: color, color: C.bg, border: `1px solid ${color}`, fontWeight: 700 }}>{ch}</button>;
  if (v === "ghost") return <button onClick={onClick} disabled={dis} style={{ ...b, background: "transparent", border: "none", color: dis ? C.textMuted : color }}>{ch}</button>;
  return <button onClick={onClick} disabled={dis} style={{ ...b, background: "transparent", border: `1px solid ${C.border2}`, color: dis ? C.textMuted : C.textDim }}>{ch}</button>;
}
const fieldStyle = { background: C.surface2, border: `1px solid ${C.border2}`, borderRadius: 3, color: C.text, fontFamily: mono, fontSize: 11, padding: "0.28rem 0.55rem", outline: "none" };
const TYPE_COLOR = { Integer: C.blue, Float: C.blue, String: C.teal, Date: C.teal, Boolean: "#c88e6e", Vector: C.purple, Computed: C.textMuted };
const thStyle = { padding: "0.4rem 0.75rem", textAlign: "left", fontFamily: mono, fontWeight: 400, fontSize: 9, letterSpacing: "0.16em", textTransform: "uppercase", borderBottom: `1px solid ${C.border}`, color: C.textMuted, background: C.surface2 };
const tdStyle = { padding: "0.35rem 0.75rem", borderBottom: `1px solid ${C.border}`, verticalAlign: "middle" };

// ─── SCRIPT GENERATOR (exported for tests) ────────────────────────────────────
export function generateCalcScript(language, variables, computeds) {
  const lines = [];
  if (language === "r") {
    variables.forEach(v => lines.push(`${v.name} <- ${rVal(v)}`));
    computeds.forEach(c => lines.push(`${c.name} <- ${c.fn}(df$${c.col})`));
  } else if (language === "stata") {
    variables.forEach(v => {
      if (v.type === "String") lines.push(`local ${v.name} "${v.rawValue}"`);
      else if (v.type === "Vector") lines.push(`matrix ${v.name} = (${v.rawValue})`);
      else lines.push(`scalar ${v.name} = ${v.type === "Boolean" ? (v.rawValue === "TRUE" ? "1" : "0") : v.rawValue}`);
    });
    computeds.forEach(c => {
      lines.push(`summarize ${c.col}, meanonly`);
      lines.push(`scalar ${c.name} = r(${{ mean:"mean", sum:"sum", count:"N", min:"min", max:"max" }[c.fn] || "mean"})`);
    });
  } else if (language === "python") {
    lines.push("import pandas as pd", "import numpy as np", "");
    variables.forEach(v => lines.push(`${v.name} = ${pyVal(v)}`));
    computeds.forEach(c => lines.push(`${c.name} = df["${c.col}"].${{ mean:"mean", sum:"sum", count:"count", min:"min", max:"max" }[c.fn] || "mean"}()`));
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
  return { Integer: "0", Float: "0.0", Boolean: "TRUE", Date: new Date().toISOString().slice(0, 10), Vector: "0" }[type] || "";
}

// ─── VALUE INPUT ──────────────────────────────────────────────────────────────
function ValueInput({ type, value, onChange }) {
  if (type === "Boolean") return (
    <select value={value} onChange={e => onChange(e.target.value)} style={{ ...fieldStyle, flex: 1 }}>
      <option>TRUE</option><option>FALSE</option>
    </select>
  );
  if (type === "Date") return <input type="date" value={value} onChange={e => onChange(e.target.value)} style={{ ...fieldStyle, flex: 1 }} />;
  const isNum = type === "Integer" || type === "Float";
  return <input type={isNum ? "number" : "text"} step={type === "Float" ? "any" : type === "Integer" ? "1" : undefined}
    placeholder={type === "Vector" ? "1.2, 0.8, -0.3" : isNum ? "0" : '…'}
    value={value} onChange={e => onChange(e.target.value)} style={{ ...fieldStyle, flex: 1, minWidth: 80 }} />;
}

// ─── MAIN COMPONENT ───────────────────────────────────────────────────────────
export default function CalculateTab({ rows = [], headers = [], onAddDataset }) {
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

  const NAME_RE = /^[a-zA-Z_][a-zA-Z0-9_]*$/;
  const numericHeaders = headers.filter(h => rows.some(r => !isNaN(Number(r[h])) && r[h] !== null && r[h] !== ""));
  const allNames = () => [...variables.map(v => v.name), ...computeds.map(c => c.name)];

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

  // Inline-editable cell
  function VarRow({ v }) {
    const [editing, setEditing] = useState(false);
    const [editVal, setEditVal] = useState(v.rawValue);
    function save() { setVariables(vs => vs.map(x => x.id === v.id ? { ...x, rawValue: editVal } : x)); setEditing(false); }
    return (
      <tr>
        <td style={tdStyle}><span style={{ fontFamily: mono, fontSize: 11, color: C.text }}>{v.name}</span></td>
        <td style={tdStyle}><span style={{ fontSize: 9, padding: "2px 6px", border: `1px solid ${TYPE_COLOR[v.type]}`, color: TYPE_COLOR[v.type], borderRadius: 2, fontFamily: mono }}>{v.type}</span></td>
        <td style={{ ...tdStyle, maxWidth: 260 }}>
          {editing
            ? <span style={{ display: "flex", gap: 4, alignItems: "center" }}>
                <ValueInput type={v.type} value={editVal} onChange={setEditVal} />
                <Btn ch="✓" sm v="ghost" color={C.green} onClick={save} />
                <Btn ch="✕" sm v="ghost" color={C.textMuted} onClick={() => setEditing(false)} />
              </span>
            : <span onClick={() => { setEditVal(v.rawValue); setEditing(true); }} title="Click to edit" style={{ cursor: "text", fontFamily: mono, fontSize: 11, color: C.text }}>{v.type === "String" ? `"${v.rawValue}"` : v.rawValue || <span style={{ color: C.textMuted }}>—</span>}</span>
          }
        </td>
        <td style={{ ...tdStyle, textAlign: "right" }}>
          <button onClick={() => setVariables(vs => vs.filter(x => x.id !== v.id))} style={{ background: "transparent", border: "none", color: C.textMuted, cursor: "pointer", fontFamily: mono, fontSize: 14 }}
            onMouseEnter={e => e.currentTarget.style.color = C.red} onMouseLeave={e => e.currentTarget.style.color = C.textMuted}>×</button>
        </td>
      </tr>
    );
  }

  const vectorVars = variables.filter(v => v.type === "Vector");

  return (
    <div style={{ height: "100%", overflowY: "auto", padding: "1.8rem 2.4rem", fontFamily: mono, color: C.text, maxWidth: 860 }}>

      {/* Header + export buttons */}
      <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: "1.6rem", flexWrap: "wrap" }}>
        <div>
          <div style={{ fontSize: 9, color: C.teal, letterSpacing: "0.26em", textTransform: "uppercase", marginBottom: 3 }}>Calculate</div>
          <div style={{ fontSize: 18, color: C.text, letterSpacing: "-0.01em" }}>Variable Workspace</div>
        </div>
        <div style={{ marginLeft: "auto", display: "flex", gap: 6 }}>
          {[["↓R","r",C.gold],["↓Stata","stata",C.teal],["↓py","python",C.blue]].map(([label,lang,color]) => (
            <button key={lang} onClick={() => download(generateCalcScript(lang, variables, computeds), `calculate.${lang === "r" ? "R" : lang === "stata" ? "do" : "py"}`)}
              style={{ padding: "0.3rem 0.7rem", background: "transparent", border: `1px solid ${C.border2}`, borderRadius: 3, color: C.textDim, cursor: "pointer", fontFamily: mono, fontSize: 10, transition: "all 0.12s" }}
              onMouseEnter={e => { e.currentTarget.style.borderColor = color; e.currentTarget.style.color = color; }}
              onMouseLeave={e => { e.currentTarget.style.borderColor = C.border2; e.currentTarget.style.color = C.textDim; }}
            >{label}</button>
          ))}
        </div>
      </div>

      {/* User-defined variables */}
      <div style={{ border: `1px solid ${C.border}`, borderRadius: 4, overflow: "hidden", marginBottom: "1.4rem" }}>
        <div style={{ background: C.surface2, padding: "0.55rem 0.85rem", borderBottom: `1px solid ${C.border}` }}>
          <Lbl color={C.textDim} mb={0}>User-defined variables</Lbl>
        </div>
        {variables.length > 0 && (
          <table style={{ borderCollapse: "collapse", width: "100%" }}>
            <thead><tr>{["Name","Type","Value",""].map(h => <th key={h} style={thStyle}>{h}</th>)}</tr></thead>
            <tbody>{variables.map(v => <VarRow key={v.id} v={v} />)}</tbody>
          </table>
        )}
        {/* Add row */}
        <div style={{ padding: "0.7rem 0.85rem", background: C.surface, borderTop: variables.length ? `1px solid ${C.border}` : "none", display: "flex", gap: 6, flexWrap: "wrap", alignItems: "flex-start" }}>
          <input placeholder="var_name" value={newName} onChange={e => { setNewName(e.target.value); setNameErr(""); }}
            onKeyDown={e => e.key === "Enter" && addVariable()} style={{ ...fieldStyle, width: 150 }} />
          <select value={newType} onChange={e => { setNewType(e.target.value); setNewValue(""); }} style={fieldStyle}>
            {["Integer","Float","String","Date","Boolean","Vector"].map(t => <option key={t}>{t}</option>)}
          </select>
          <ValueInput type={newType} value={newValue} onChange={setNewValue} />
          <Btn ch="Add" v="solid" color={C.gold} onClick={addVariable} sm />
        </div>
        {nameErr && <div style={{ padding: "0 0.85rem 0.5rem", fontSize: 10, color: C.red }}>{nameErr}</div>}
      </div>

      {/* Computed from dataset */}
      <div style={{ border: `1px solid ${C.border}`, borderRadius: 4, overflow: "hidden", marginBottom: "1.4rem" }}>
        <div onClick={() => setComputedOpen(o => !o)} style={{ background: C.surface2, padding: "0.55rem 0.85rem", borderBottom: computedOpen ? `1px solid ${C.border}` : "none", cursor: "pointer", display: "flex", alignItems: "center", gap: 8 }}>
          <span style={{ fontSize: 9, color: C.textMuted }}>{computedOpen ? "▾" : "▸"}</span>
          <Lbl color={C.textDim} mb={0}>Computed from dataset</Lbl>
          {!rows.length && <span style={{ marginLeft: "auto", fontSize: 9, color: C.textMuted }}>no active dataset</span>}
        </div>
        {computedOpen && (
          <>
            {computeds.length > 0 && (
              <table style={{ borderCollapse: "collapse", width: "100%" }}>
                <thead><tr>{["Name","Type","Expression","Value",""].map(h => <th key={h} style={thStyle}>{h}</th>)}</tr></thead>
                <tbody>
                  {computeds.map(c => (
                    <tr key={c.id}>
                      <td style={tdStyle}><span style={{ fontFamily: mono, fontSize: 11, color: C.text }}>{c.name}</span></td>
                      <td style={tdStyle}><span style={{ fontSize: 9, padding: "2px 6px", border: `1px solid ${C.textMuted}`, color: C.textMuted, borderRadius: 2, fontFamily: mono }}>Computed</span></td>
                      <td style={tdStyle}><span style={{ fontFamily: mono, fontSize: 11, color: C.textDim }}>{c.fn}({c.col})</span><span style={{ fontSize: 10, color: C.textMuted, marginLeft: 8 }}>[from: active dataset]</span></td>
                      <td style={{ ...tdStyle, color: C.teal, fontFamily: mono, fontSize: 11, whiteSpace: "nowrap" }}>{evalComputed(c.fn, c.col, rows)}</td>
                      <td style={{ ...tdStyle, textAlign: "right" }}>
                        <button onClick={() => setComputeds(cs => cs.filter(x => x.id !== c.id))} style={{ background: "transparent", border: "none", color: C.textMuted, cursor: "pointer", fontFamily: mono, fontSize: 14 }}
                          onMouseEnter={e => e.currentTarget.style.color = C.red} onMouseLeave={e => e.currentTarget.style.color = C.textMuted}>×</button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
            <div style={{ padding: "0.7rem 0.85rem", background: C.surface, borderTop: computeds.length ? `1px solid ${C.border}` : "none", display: "flex", gap: 6, flexWrap: "wrap", alignItems: "center" }}>
              <input placeholder="var_name" value={newCName} onChange={e => setNewCName(e.target.value)} onKeyDown={e => e.key === "Enter" && addComputed()} style={{ ...fieldStyle, width: 130 }} />
              <select value={newCFn} onChange={e => setNewCFn(e.target.value)} style={fieldStyle}>
                {["mean","sum","count","min","max"].map(f => <option key={f}>{f}</option>)}
              </select>
              <select value={newCCol || numericHeaders[0] || ""} onChange={e => setNewCCol(e.target.value)} style={{ ...fieldStyle, maxWidth: 200 }}>
                {numericHeaders.length ? numericHeaders.map(h => <option key={h}>{h}</option>) : <option value="">— no numeric columns —</option>}
              </select>
              <Btn ch="Add" v="solid" color={C.blue} onClick={addComputed} sm dis={!numericHeaders.length} />
            </div>
          </>
        )}
      </div>

      {/* New dataset from vectors */}
      {vectorVars.length > 0 && (
        <div style={{ border: `1px solid ${C.border}`, borderRadius: 4, overflow: "hidden", marginBottom: "1.4rem" }}>
          <div style={{ background: C.surface2, padding: "0.55rem 0.85rem", borderBottom: `1px solid ${C.border}`, display: "flex", alignItems: "center", justifyContent: "space-between" }}>
            <Lbl color={C.textDim} mb={0}>New dataset from variables</Lbl>
            {!datasetForm && <Btn ch="+ Create dataset" sm v="solid" color={C.teal} onClick={() => setDatasetForm({ name: "", selectedVars: [] })} />}
          </div>
          {datasetForm
            ? <div style={{ padding: "0.8rem 0.85rem", background: C.surface, display: "flex", flexDirection: "column", gap: 10 }}>
                <input placeholder="dataset name" value={datasetForm.name} onChange={e => setDatasetForm(f => ({ ...f, name: e.target.value }))} style={{ ...fieldStyle, width: 220 }} />
                <div>
                  <Lbl color={C.textMuted} mb={6}>Select Vector columns</Lbl>
                  <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
                    {vectorVars.map(v => {
                      const sel = datasetForm.selectedVars.includes(v.name);
                      return <button key={v.name} onClick={() => setDatasetForm(f => ({ ...f, selectedVars: sel ? f.selectedVars.filter(n => n !== v.name) : [...f.selectedVars, v.name] }))}
                        style={{ padding: "0.25rem 0.6rem", fontFamily: mono, fontSize: 10, cursor: "pointer", borderRadius: 3, background: sel ? `${C.purple}20` : "transparent", border: `1px solid ${sel ? C.purple : C.border2}`, color: sel ? C.purple : C.textDim, transition: "all 0.12s" }}>{v.name}</button>;
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

      {variables.length === 0 && computeds.length === 0 && (
        <div style={{ padding: "2.5rem", textAlign: "center", color: C.textMuted, fontSize: 11, lineHeight: 1.8 }}>
          Define scalars, vectors, and expressions above.<br />
          <span style={{ color: C.textDim }}>Variables declared here are exported to R / Stata / Python scripts.</span>
        </div>
      )}
    </div>
  );
}
