import { useEffect, useRef } from "react";
import { useTheme } from "../../../ThemeContext.jsx";
import { loadKatex, renderInto } from "./katexLoader.js";

const mono = "'IBM Plex Mono', monospace";

const OP_LABEL = { plot: "f(x)", deriv: "f′", integral: "∫ f", solveZero: "f = 0", optimize: "optimum" };

// Renders one LaTeX string safely (§10.4): katex.render into a ref node,
// trust:false. Never assigns any expression string as innerHTML.
function Latex({ latex }) {
  const { C } = useTheme();
  const ref = useRef(null);
  useEffect(() => {
    let alive = true;
    const el = ref.current;
    if (!el) return;
    if (!latex) { el.textContent = "—"; return; }
    el.textContent = latex; // plain-text placeholder until KaTeX loads
    loadKatex().then((k) => { if (alive && ref.current) renderInto(k, ref.current, latex); }).catch(() => {});
    return () => { alive = false; };
  }, [latex]);
  return <span ref={ref} style={{ fontFamily: mono, color: C.text }} />;
}

export default function ResultsPanel({ equations, results }) {
  const { C } = useTheme();
  const objectives = equations.filter((e) => e.kind !== "constraint");

  function copy(text) { try { navigator.clipboard?.writeText(text); } catch { /* ignore */ } }

  if (!objectives.length) return null;

  return (
    <div style={{ fontFamily: mono, marginTop: 14 }}>
      <div style={{ fontSize: 9, color: C.teal, letterSpacing: "0.22em", textTransform: "uppercase", marginBottom: 8 }}>Results</div>
      {objectives.map((eq, i) => {
        const accent = [C.teal, C.gold, C.blue][i % 3];
        const r = results[eq.id] || {};
        const ops = Object.keys(r);
        if (!ops.length) return null;
        return (
          <div key={eq.id} style={{ borderLeft: `3px solid ${accent}`, paddingLeft: 10, marginBottom: 12 }}>
            <div style={{ fontSize: 11, color: accent, marginBottom: 4 }}>{eq.label}</div>
            {ops.map((op) => {
              const res = r[op];
              if (!res) return null;
              const fallback = res.source === "numeric-fallback";
              return (
                <div key={op} style={{ marginBottom: 8 }}>
                  <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 2 }}>
                    <span style={{ fontSize: 10, color: C.textDim || "#888", minWidth: 56 }}>{OP_LABEL[op] || op}</span>
                    {fallback && (
                      <span style={{ fontSize: 8, color: C.gold, border: `1px solid ${C.gold}`, borderRadius: 3, padding: "1px 4px" }}>
                        numeric-fallback
                      </span>
                    )}
                    {res.symbolic?.latex && (
                      <button onClick={() => copy(res.symbolic.latex)}
                        style={{ fontSize: 8, marginLeft: "auto", background: "transparent", color: C.textDim || "#888",
                          border: `1px solid ${C.line || "#222"}`, borderRadius: 3, padding: "1px 5px", cursor: "pointer" }}>
                        copy LaTeX
                      </button>
                    )}
                  </div>
                  {res.symbolic?.latex && (
                    <div style={{ fontSize: 13, color: C.text, marginBottom: 3, overflowX: "auto" }}>
                      <Latex latex={res.symbolic.latex} />
                    </div>
                  )}
                  <NumericReadout op={op} numeric={res.numeric} C={C} />
                </div>
              );
            })}
          </div>
        );
      })}
    </div>
  );
}

function NumericReadout({ op, numeric, C }) {
  if (!numeric) return null;
  const dim = C.textDim || "#888";
  const fmt = (x) => (Number.isFinite(x) ? x.toFixed(4) : "—");
  if (op === "integral") return <span style={{ fontSize: 11, color: dim }}>∫ over [{numeric.a}, {numeric.b}] = <b style={{ color: C.text }}>{fmt(numeric.value)}</b></span>;
  if (op === "solveZero") return <span style={{ fontSize: 11, color: dim }}>roots: <b style={{ color: C.text }}>{(numeric.roots || []).map(fmt).join(", ") || "none in view"}</b></span>;
  if (op === "optimize") {
    if (numeric.mode === "unconstrained")
      return <span style={{ fontSize: 11, color: dim }}>x* = <b style={{ color: C.text }}>{fmt(numeric.x)}</b>, f(x*) = <b style={{ color: C.text }}>{fmt(numeric.value)}</b> ({numeric.kind})</span>;
    // constrained
    if (numeric.error) return <span style={{ fontSize: 11, color: C.red || "#c86e6e" }}>{numeric.error}</span>;
    const choices = numeric.choices || {};
    const mults = numeric.multipliers || {};
    return (
      <div style={{ fontSize: 11, color: dim }}>
        {Object.entries(choices).map(([k, v]) => <span key={k} style={{ marginRight: 10 }}>{k}* = <b style={{ color: C.text }}>{fmt(v)}</b></span>)}
        {Object.entries(mults).map(([k, v]) => <span key={k} style={{ marginRight: 10, color: C.gold }}>λ({k.replace("lambda_", "")}) = {fmt(v)}</span>)}
        {Number.isFinite(numeric.objectiveValue) && <span>value = <b style={{ color: C.text }}>{fmt(numeric.objectiveValue)}</b></span>}
      </div>
    );
  }
  return null; // plot/deriv numeric is markers-only
}
