import { useState } from "react";
import { useTheme } from "../../../ThemeContext.jsx";
import EquationCard from "./EquationCard.jsx";
import { TEMPLATES } from "./templates.js";
import { newEquation } from "./workbenchStore.js";

const mono = "'IBM Plex Mono', monospace";

// Props: equations[], view, onAdd(eq), onPatch(id, patch), onRemove(id)
export default function EquationsPanel({ equations, view, onAdd, onPatch, onRemove }) {
  const { C } = useTheme();
  const [showTemplates, setShowTemplates] = useState(false);

  // Conditions reference equations by name, so every card needs a unique label.
  // Assign the first free single-letter name (falling back to a numbered one),
  // honoring a preferred seed when it is still available.
  const addNamed = (seed = {}) => {
    const taken = new Set(equations.map((e) => (e.label || "").trim()).filter(Boolean));
    onAdd(newEquation({ ...seed, label: uniqueLabel(taken, seed.label) }));
  };

  return (
    <div style={{ fontFamily: mono }}>
      <div style={{ display: "flex", gap: 8, marginBottom: 10 }}>
        <button onClick={() => addNamed()}
          style={btn(C, C.teal)}>+ Equation</button>
        <button onClick={() => addNamed({ kind: "constraint", label: "g" })}
          style={btn(C, C.blue)}>+ Constraint</button>
        <button onClick={() => setShowTemplates((v) => !v)}
          style={btn(C, C.gold)}>{showTemplates ? "Hide" : "Templates"}</button>
      </div>

      {showTemplates && (
        <div style={{ border: `1px solid ${C.border2}`, borderRadius: 8, padding: 10, marginBottom: 12 }}>
          {Object.entries(groupBy(TEMPLATES)).map(([group, items]) => (
            <div key={group} style={{ marginBottom: 8 }}>
              <div style={{ fontSize: 9, color: C.gold, letterSpacing: "0.2em", textTransform: "uppercase", marginBottom: 4 }}>{group}</div>
              <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
                {items.map((t) => (
                  <button key={t.group + "/" + t.label}
                    onClick={() => { addNamed(t.seed); setShowTemplates(false); }}
                    style={{ fontSize: 11, padding: "3px 8px", borderRadius: 4, cursor: "pointer",
                      background: C.surface2, color: C.text, border: `1px solid ${C.border2}` }}>
                    {t.label}
                  </button>
                ))}
              </div>
            </div>
          ))}
        </div>
      )}

      {equations.length === 0 && (
        <div style={{ fontSize: 11, color: C.textDim || "#888", padding: "6px 0" }}>
          Add an equation or pick a template to begin.
        </div>
      )}

      {equations.map((eq, i) => (
        <EquationCard key={eq.id} eq={eq} index={i} view={view}
          onPatch={(patch) => onPatch(eq.id, patch)}
          onRemove={() => onRemove(eq.id)} />
      ))}
    </div>
  );
}

function uniqueLabel(taken, preferred) {
  const seq = ["f", "g", "h", "k", "m", "n", "p", "q", "r", "s", "u", "v", "w"];
  const pref = (preferred || "").trim();
  if (pref && !taken.has(pref)) return pref;
  for (const s of seq) if (!taken.has(s)) return s;
  let i = 1;
  while (taken.has(`f${i}`)) i++;
  return `f${i}`;
}
function groupBy(arr) {
  const out = {};
  for (const t of arr) (out[t.group] = out[t.group] || []).push(t);
  return out;
}
function btn(C, color) {
  return { fontSize: 11, padding: "5px 10px", borderRadius: 6, cursor: "pointer",
    background: "transparent", color, border: `1px solid ${color}`, fontFamily: mono };
}
