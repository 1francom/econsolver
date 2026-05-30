import { useState, useEffect, useMemo } from "react";
import { useTheme } from "../../../ThemeContext.jsx";
import { cas } from "../../../math/cas/casAdapter.js";

const mono = "'IBM Plex Mono', monospace";
const OPS = [
  { key: "plot", glyph: "▦", title: "Plot curve" },
  { key: "deriv", glyph: "f′", title: "Symbolic derivative" },
  { key: "integral", glyph: "∫", title: "Definite integral" },
  { key: "solveZero", glyph: "=0", title: "Solve f(x)=0" },
  { key: "optimize", glyph: "◇", title: "Optimize" },
];

// One equation/constraint card. Props:
//   eq, index, symbolsOf(eq)->string[], onPatch(patch), onRemove()
export default function EquationCard({ eq, index, onPatch, onRemove }) {
  const { C } = useTheme();
  const [copied, setCopied] = useState(false);
  const accent = [C.teal, C.gold, C.blue][index % 3];
  const isConstraint = eq.kind === "constraint";

  // Free symbols of the expr/relation, for the axis dropdown (objectives only).
  const symbols = useMemo(() => {
    try {
      const src = isConstraint ? `(${eq.relation.lhs}) - (${eq.relation.rhs})` : eq.expr;
      if (src && src.trim()) return cas.freeSymbols(src);
    } catch { /* ignore */ }
    return [];
  }, [isConstraint, eq.relation.lhs, eq.relation.rhs, eq.expr]);

  // Self-heal: if the chosen axis is no longer a free symbol of the expr, clear it.
  useEffect(() => {
    if (!isConstraint && eq.axis && symbols.length && !symbols.includes(eq.axis)) {
      onPatch({ axis: "" });
    }
  }, [eq.axis, isConstraint, symbols, onPatch]);

  function copyLatex() {
    try {
      const src = isConstraint ? `(${eq.relation.lhs}) - (${eq.relation.rhs})` : eq.expr;
      const latex = cas.toLatex(src);
      navigator.clipboard?.writeText(latex);
      setCopied(true); setTimeout(() => setCopied(false), 1200);
    } catch { /* ignore */ }
  }

  return (
    <div style={{ border: `1px solid ${accent}55`, borderLeft: `3px solid ${accent}`,
      borderRadius: 8, padding: "10px 12px", marginBottom: 10, fontFamily: mono }}>

      <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 8 }}>
        <input value={eq.label} onChange={(e) => onPatch({ label: e.target.value.slice(0, 24) })}
          style={{ width: 54, background: C.bg, color: accent, border: `1px solid ${C.line || "#222"}`,
            fontFamily: mono, fontSize: 12, padding: "3px 5px" }} />
        <span style={{ fontSize: 11, color: C.textDim || "#888" }}>{isConstraint ? "s.t." : "="}</span>

        {isConstraint ? (
          <div style={{ display: "flex", alignItems: "center", gap: 4, flex: 1 }}>
            <input value={eq.relation.lhs} placeholder="p*x + q*y"
              onChange={(e) => onPatch({ relation: { ...eq.relation, lhs: e.target.value.slice(0, 256) } })}
              style={inp(C)} />
            <span style={{ color: C.text }}>=</span>
            <input value={eq.relation.rhs} placeholder="m"
              onChange={(e) => onPatch({ relation: { ...eq.relation, rhs: e.target.value.slice(0, 256) } })}
              style={inp(C)} />
          </div>
        ) : (
          <input value={eq.expr} placeholder="A*K^alpha*L^(1-alpha)"
            onChange={(e) => onPatch({ expr: e.target.value.slice(0, 512) })}
            style={{ ...inp(C), flex: 1 }} />
        )}

        <button onClick={onRemove} title="Remove card"
          style={{ color: C.red || "#c86e6e", background: "transparent", border: "none", cursor: "pointer", fontSize: 14 }}>×</button>
      </div>

      {!isConstraint && (
        <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
          <label style={{ fontSize: 10, color: C.textDim || "#888" }}>axis</label>
          <select value={eq.axis} onChange={(e) => onPatch({ axis: e.target.value })}
            style={{ background: C.bg, color: C.text, border: `1px solid ${C.line || "#222"}`, fontFamily: mono, fontSize: 11, padding: "2px 4px" }}>
            <option value="">—</option>
            {symbols.map((s) => <option key={s} value={s}>{s}</option>)}
          </select>

          {OPS.map((op) => {
            const on = !!eq.ops[op.key];
            return (
              <button key={op.key} title={op.title}
                onClick={() => onPatch({ ops: { ...eq.ops, [op.key]: !on } })}
                style={{ fontSize: 11, padding: "3px 7px", borderRadius: 4, cursor: "pointer",
                  background: on ? accent + "22" : "transparent", color: on ? accent : C.textDim || "#888",
                  border: `1px solid ${on ? accent : C.line || "#222"}` }}>
                {op.glyph}
              </button>
            );
          })}

          {eq.ops.optimize && (
            <button onClick={() => onPatch({ sense: eq.sense === "max" ? "min" : "max" })}
              style={{ fontSize: 10, padding: "3px 7px", borderRadius: 4, cursor: "pointer",
                background: "transparent", color: C.gold, border: `1px solid ${C.gold}` }}>
              {eq.sense}
            </button>
          )}

          <button onClick={copyLatex} title="Copy LaTeX"
            style={{ fontSize: 10, padding: "3px 7px", borderRadius: 4, marginLeft: "auto", cursor: "pointer",
              background: "transparent", color: copied ? C.teal : C.textDim || "#888", border: `1px solid ${C.line || "#222"}` }}>
            {copied ? "copied" : "LaTeX"}
          </button>
        </div>
      )}
    </div>
  );
}

function inp(C) {
  return { background: C.bg, color: C.text, border: `1px solid ${C.line || "#222"}`,
    fontFamily: mono, fontSize: 12, padding: "3px 5px", minWidth: 60 };
}
