import { useState } from "react";
import { useTheme } from "../../../ThemeContext.jsx";
import EquationCard from "./EquationCard.jsx";
import { TEMPLATES } from "./templates.js";
import { newEquation } from "./workbenchStore.js";

const mono = "'IBM Plex Mono', monospace";

// Props: equations[], onAdd(eq), onPatch(id, patch), onRemove(id)
export default function EquationsPanel({ equations, onAdd, onPatch, onRemove }) {
  const { C } = useTheme();
  const [showTemplates, setShowTemplates] = useState(false);

  return (
    <div style={{ fontFamily: mono }}>
      <div style={{ display: "flex", gap: 8, marginBottom: 10 }}>
        <button onClick={() => onAdd(newEquation())}
          style={btn(C, C.teal)}>+ Equation</button>
        <button onClick={() => onAdd(newEquation({ kind: "constraint", label: "g" }))}
          style={btn(C, C.blue)}>+ Constraint</button>
        <button onClick={() => setShowTemplates((v) => !v)}
          style={btn(C, C.gold)}>{showTemplates ? "Hide" : "Templates"}</button>
      </div>

      {showTemplates && (
        <div style={{ border: `1px solid ${C.line || "#222"}`, borderRadius: 8, padding: 10, marginBottom: 12 }}>
          {Object.entries(groupBy(TEMPLATES)).map(([group, items]) => (
            <div key={group} style={{ marginBottom: 8 }}>
              <div style={{ fontSize: 9, color: C.gold, letterSpacing: "0.2em", textTransform: "uppercase", marginBottom: 4 }}>{group}</div>
              <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
                {items.map((t) => (
                  <button key={t.label}
                    onClick={() => { onAdd(newEquation(t.seed)); setShowTemplates(false); }}
                    style={{ fontSize: 11, padding: "3px 8px", borderRadius: 4, cursor: "pointer",
                      background: "transparent", color: C.text, border: `1px solid ${C.line || "#333"}` }}>
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
        <EquationCard key={eq.id} eq={eq} index={i}
          onPatch={(patch) => onPatch(eq.id, patch)}
          onRemove={() => onRemove(eq.id)} />
      ))}
    </div>
  );
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
