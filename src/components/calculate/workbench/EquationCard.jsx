import { useState, useEffect, useMemo } from "react";
import { useTheme } from "../../../ThemeContext.jsx";
import { cas } from "../../../math/cas/casAdapter.js";

const mono = "'IBM Plex Mono', monospace";
const swatch = { width: 22, height: 20, padding: 0, border: "1px solid #444", background: "transparent", cursor: "pointer", flexShrink: 0 };
const OPS = [
  { key: "plot", glyph: "▦", title: "Plot curve" },
  { key: "deriv", glyph: "f′", title: "Symbolic derivative" },
  { key: "integral", glyph: "∫", title: "Definite integral" },
  { key: "solveZero", glyph: "=0", title: "Solve f(x)=0" },
  { key: "optimize", glyph: "◇", title: "Optimize" },
];

// One equation/constraint card. Props:
//   eq, index, view, onPatch(patch), onRemove()
export default function EquationCard({ eq, index, view, onPatch, onRemove }) {
  const { C } = useTheme();
  const [copied, setCopied] = useState(false);
  const paletteColor = [C.teal, C.gold, C.blue][index % 3];
  const accent = eq.color || paletteColor;
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
          style={{ width: 54, background: C.bg, color: accent, border: `1px solid ${C.border2}`,
            fontFamily: mono, fontSize: 12, padding: "3px 5px" }} />
        {!isConstraint && (
          <input type="color" value={accent} title="Curve color"
            onChange={(e) => onPatch({ color: e.target.value })} style={swatch} />
        )}
        <span style={{ fontSize: 11, color: C.textDim }}>{isConstraint ? "s.t." : "="}</span>

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
        <>
        <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
          <label style={{ fontSize: 10, color: C.textDim }}>axis</label>
          <select value={eq.axis} onChange={(e) => onPatch({ axis: e.target.value })}
            style={{ background: C.bg, color: C.text, border: `1px solid ${C.border2}`, fontFamily: mono, fontSize: 11, padding: "2px 4px" }}>
            <option value="">—</option>
            {symbols.map((s) => <option key={s} value={s}>{s}</option>)}
          </select>

          {OPS.map((op) => {
            const on = !!eq.ops[op.key];
            return (
              <button key={op.key} title={op.title}
                onClick={() => {
                  const next = !on;
                  const patch = { ops: { ...eq.ops, [op.key]: next } };
                  // Pre-fill integration bounds from the current view on first enable.
                  if (op.key === "integral" && next && !eq.integralRange && view?.xRange)
                    patch.integralRange = [view.xRange[0], view.xRange[1]];
                  onPatch(patch);
                }}
                style={{ fontSize: 11, padding: "3px 7px", borderRadius: 4, cursor: "pointer",
                  background: on ? accent + "22" : "transparent", color: on ? accent : C.textDim,
                  border: `1px solid ${on ? accent : C.border2}` }}>
                {op.glyph}
              </button>
            );
          })}

          {eq.ops.optimize && (
            <>
              <button onClick={() => onPatch({ sense: eq.sense === "max" ? "min" : "max" })}
                style={{ fontSize: 10, padding: "3px 7px", borderRadius: 4, cursor: "pointer",
                  background: "transparent", color: C.gold, border: `1px solid ${C.gold}` }}>
                {eq.sense}
              </button>
              <input type="color" value={eq.optColor || C.red || "#c86e6e"} title="Optimum marker color"
                onChange={(e) => onPatch({ optColor: e.target.value })} style={swatch} />
            </>
          )}

          <button onClick={copyLatex} title="Copy LaTeX"
            style={{ fontSize: 10, padding: "3px 8px", borderRadius: 4, marginLeft: "auto", cursor: "pointer",
              background: copied ? "transparent" : C.surface2, color: copied ? C.teal : C.text,
              border: `1px solid ${copied ? C.teal : C.border2}`, fontWeight: 600 }}>
            {copied ? "copied" : "LaTeX"}
          </button>
        </div>

        {eq.ops.integral && (
          <div style={{ display: "flex", alignItems: "center", gap: 6, flexWrap: "wrap", marginTop: 8 }}
            title="Integration interval and optional welfare reference">
            <span style={{ fontSize: 11, color: C.gold }}>∫</span>
            <input type="number" value={eq.integralRange?.[0] ?? ""}
              placeholder={String(view?.xRange?.[0] ?? "a")}
              onChange={(e) => setIntegralBound(eq, onPatch, 0, e.target.value)}
              style={{ ...inp(C), width: 64, minWidth: 0 }} />
            <span style={{ fontSize: 10, color: C.textDim }}>→</span>
            <input type="number" value={eq.integralRange?.[1] ?? ""}
              placeholder={String(view?.xRange?.[1] ?? "b")}
              onChange={(e) => setIntegralBound(eq, onPatch, 1, e.target.value)}
              style={{ ...inp(C), width: 64, minWidth: 0 }} />
            <span style={{ fontSize: 10, color: C.textDim, marginLeft: 8 }}
              title="Welfare reference y: splits the area into gain (above) and loss (below). Empty → plain area under the curve.">ref y</span>
            <input type="number" value={eq.integralRef ?? ""}
              placeholder="—"
              onChange={(e) => { const n = Number(e.target.value); onPatch({ integralRef: e.target.value === "" || Number.isNaN(n) ? null : n }); }}
              style={{ ...inp(C), width: 64, minWidth: 0 }} />
          </div>
        )}
        </>
      )}
    </div>
  );
}

function inp(C) {
  return { background: C.bg, color: C.text, border: `1px solid ${C.border2}`,
    fontFamily: mono, fontSize: 12, padding: "3px 5px", minWidth: 60 };
}

// Patch one endpoint of the integration interval. Empty input clears that
// endpoint; clearing both resets to null so runIntegral falls back to the view.
function setIntegralBound(eq, onPatch, i, raw) {
  const cur = Array.isArray(eq.integralRange) ? [...eq.integralRange] : [null, null];
  const n = Number(raw);
  cur[i] = raw === "" || Number.isNaN(n) ? null : n;
  onPatch({ integralRange: cur[0] == null && cur[1] == null ? null : cur });
}
