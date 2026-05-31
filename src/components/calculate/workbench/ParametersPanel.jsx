import { useTheme } from "../../../ThemeContext.jsx";

const mono = "'IBM Plex Mono', monospace";

// Shared slider pool for one session. Each detected symbol is either a
// Parameter (slider, fixed value) or a Choice variable (optimized over).
// Props:
//   detectedSymbols : string[]  — union of free symbols across all cards minus axes
//   params          : [{name,value,min,max,step}]
//   choiceVars      : string[]
//   onParamChange   : (name, patch) => void
//   onToggleRole    : (name) => void   // Parameter <-> Choice var
export default function ParametersPanel({ detectedSymbols, params, choiceVars, onParamChange, onToggleRole }) {
  const { C } = useTheme();
  const paramMap = Object.fromEntries(params.map((p) => [p.name, p]));

  if (!detectedSymbols.length) {
    return (
      <div style={{ fontFamily: mono, fontSize: 11, color: C.textDim || "#888", padding: "8px 0" }}>
        Parameters appear here once an equation has free symbols.
      </div>
    );
  }

  return (
    <div style={{ fontFamily: mono, marginTop: 12 }}>
      <div style={{ fontSize: 9, color: C.gold, letterSpacing: "0.22em", textTransform: "uppercase", marginBottom: 8 }}>
        Parameters
      </div>
      {detectedSymbols.map((sym) => {
        const isChoice = choiceVars.includes(sym);
        const p = paramMap[sym] || { name: sym, value: 1, min: 0, max: 10, step: 0.1 };
        return (
          <div key={sym} style={{ marginBottom: 10, opacity: isChoice ? 0.6 : 1 }}>
            <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 3 }}>
              <span style={{ fontSize: 12, color: C.teal, minWidth: 34 }}>{sym}</span>
              <button onClick={() => onToggleRole(sym)}
                title="Toggle Parameter / Choice variable"
                style={{ fontSize: 9, padding: "2px 6px", borderRadius: 4, cursor: "pointer",
                  background: "transparent", color: isChoice ? C.gold : C.blue,
                  border: `1px solid ${isChoice ? C.gold : C.blue}` }}>
                {isChoice ? "choice var" : "parameter"}
              </button>
              {!isChoice && (
                <span style={{ fontSize: 12, color: C.text, marginLeft: "auto" }}>
                  {Number(p.value).toFixed(2)}
                </span>
              )}
            </div>
            {!isChoice && (
              <input type="range" min={p.min} max={p.max} step={p.step} value={p.value}
                onChange={(e) => onParamChange(sym, { value: Number(e.target.value) })}
                style={{ width: "100%", accentColor: C.teal }} />
            )}
          </div>
        );
      })}
    </div>
  );
}
