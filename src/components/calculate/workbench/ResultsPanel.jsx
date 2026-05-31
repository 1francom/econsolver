import { useEffect, useRef, useState } from "react";
import { useTheme } from "../../../ThemeContext.jsx";
import { loadKatex, renderInto } from "./katexLoader.js";
import { interpretOptimization } from "../../../services/AI/AIService.js";

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

export default function ResultsPanel({ session, equations, results, backend, escalating, escalateError, onEscalate }) {
  const { C } = useTheme();
  const objectives = equations.filter((e) => e.kind !== "constraint");

  // Any op that fell back to numeric → offer the SymPy "solve exactly" escalation.
  const hasFallback = objectives.some((eq) => {
    const r = results[eq.id] || {};
    return Object.values(r).some((res) => res && res.source === "numeric-fallback");
  });
  const canEscalate = hasFallback && backend !== "sympy" && typeof onEscalate === "function";

  const [aiNarrative, setAiNarrative] = useState(null);
  const [aiLoading, setAiLoading] = useState(false);
  const [aiError, setAiError] = useState(null);

  function copy(text) { try { navigator.clipboard?.writeText(text); } catch { /* ignore */ } }

  // Has at least one objective produced an optimize/solveZero result worth interpreting?
  const hasInterpretable = objectives.some((eq) => {
    const r = results[eq.id] || {};
    return r.optimize || r.solveZero || r.deriv;
  });

  async function runInterpret() {
    setAiLoading(true);
    setAiError(null);
    setAiNarrative(null);
    try {
      const text = await interpretOptimization({ session, results });
      setAiNarrative(text);
    } catch (err) {
      setAiError(err?.message === "PREMIUM_REQUIRED"
        ? "AI interpretation is a premium feature."
        : (err?.message || "AI interpretation failed."));
    } finally {
      setAiLoading(false);
    }
  }

  if (!objectives.length) return null;

  return (
    <div style={{ fontFamily: mono, marginTop: 14 }}>
      <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 8 }}>
        <span style={{ fontSize: 9, color: C.teal, letterSpacing: "0.22em", textTransform: "uppercase" }}>Results</span>
        {backend === "sympy" && (
          <span style={{ fontSize: 8, color: C.blue, border: `1px solid ${C.blue}`, borderRadius: 3, padding: "1px 4px" }}>SymPy</span>
        )}
        {canEscalate && (
          <button onClick={onEscalate} disabled={escalating}
            style={{ fontSize: 8, background: "transparent", color: escalating ? (C.textDim || "#888") : C.blue,
              border: `1px solid ${C.blue}`, borderRadius: 3, padding: "2px 7px", cursor: escalating ? "default" : "pointer",
              letterSpacing: "0.08em", textTransform: "uppercase" }}>
            {escalating ? "loading exact solver…" : "Solve exactly (SymPy)"}
          </button>
        )}
        {hasInterpretable && (
          <button onClick={runInterpret} disabled={aiLoading}
            style={{ fontSize: 8, marginLeft: "auto", background: "transparent", color: aiLoading ? (C.textDim || "#888") : C.gold,
              border: `1px solid ${C.gold}`, borderRadius: 3, padding: "2px 7px", cursor: aiLoading ? "default" : "pointer",
              letterSpacing: "0.08em", textTransform: "uppercase" }}>
            {aiLoading ? "interpreting…" : "Interpret (AI)"}
          </button>
        )}
      </div>
      {escalateError && (
        <div style={{ fontSize: 10, color: C.red || "#c86e6e", marginBottom: 8 }}>Exact solver: {escalateError}</div>
      )}
      {aiError && (
        <div style={{ fontSize: 10, color: C.red || "#c86e6e", marginBottom: 8 }}>{aiError}</div>
      )}
      {aiNarrative && (
        <div style={{ fontSize: 11, lineHeight: 1.5, color: C.text, background: C.surface2,
          border: `1px solid ${C.border2}`, borderRadius: 4, padding: "8px 10px", marginBottom: 10, whiteSpace: "pre-wrap" }}>
          {aiNarrative}
        </div>
      )}
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
                    <span style={{ fontSize: 10, color: C.text, fontWeight: 600, minWidth: 56 }}>{OP_LABEL[op] || op}</span>
                    {fallback && (
                      <span style={{ fontSize: 8, color: C.gold, border: `1px solid ${C.gold}`, borderRadius: 3, padding: "1px 4px" }}>
                        numeric-fallback
                      </span>
                    )}
                    {res.symbolic?.latex && (
                      <button onClick={() => copy(res.symbolic.latex)}
                        style={{ fontSize: 8, marginLeft: "auto", background: C.surface2, color: C.textDim,
                          border: `1px solid ${C.border2}`, borderRadius: 3, padding: "2px 6px", cursor: "pointer" }}>
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
  if (op === "integral") {
    if (Number.isFinite(numeric.ref)) {
      return (
        <span style={{ fontSize: 11, color: dim }}>
          ∫ over [{numeric.a}, {numeric.b}] vs y={numeric.ref}: net = <b style={{ color: C.text }}>{fmt(numeric.value)}</b>
          {" · "}<span style={{ color: C.teal }}>gain {fmt(numeric.gain)}</span>
          {" · "}<span style={{ color: C.red || "#c86e6e" }}>loss {fmt(numeric.loss)}</span>
        </span>
      );
    }
    return <span style={{ fontSize: 11, color: dim }}>∫ over [{numeric.a}, {numeric.b}] = <b style={{ color: C.text }}>{fmt(numeric.value)}</b></span>;
  }
  if (op === "solveZero") return <span style={{ fontSize: 11, color: dim }}>roots: <b style={{ color: C.text }}>{(numeric.roots || []).map(fmt).join(", ") || "none in view"}</b></span>;
  if (op === "optimize") {
    if (numeric.mode === "unconstrained") {
      if (numeric.interior === false) {
        const isMax = numeric.sense !== "min";
        const extr = isMax ? "maximum" : "minimum";
        const bound = isMax ? "sup" : "inf";
        return (
          <span style={{ fontSize: 11, color: dim }}>
            no interior {extr} — f is monotone on the range; {bound} at boundary x = <b style={{ color: C.text }}>{fmt(numeric.x)}</b>, f = <b style={{ color: C.text }}>{fmt(numeric.value)}</b>
            {numeric.unbounded && (
              <span style={{ color: C.gold }}> · limit is infinite: no finite {extr} exists</span>
            )}
          </span>
        );
      }
      return <span style={{ fontSize: 11, color: dim }}>x* = <b style={{ color: C.text }}>{fmt(numeric.x)}</b>, f(x*) = <b style={{ color: C.text }}>{fmt(numeric.value)}</b> ({numeric.kind})</span>;
    }
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
