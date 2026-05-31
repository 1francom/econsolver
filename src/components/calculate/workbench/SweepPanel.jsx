import { useTheme } from "../../../ThemeContext.jsx";

const mono = "'IBM Plex Mono', monospace";

// Comparative-statics controls. Picks one parameter to sweep, the value range
// and number of family curves, and (Step 2) the optimum-locus mode.
// Props:
//   detectedSymbols : string[]   — candidate params to sweep
//   params          : [{name,min,max,...}]
//   sweep           : { param, from, to, steps, showFamily, locus }
//   onChange        : (patch) => void
export default function SweepPanel({ detectedSymbols, params, sweep, onChange }) {
  const { C } = useTheme();
  const sw = sweep || {};

  // Choosing a param seeds from/to from that param's slider bounds.
  const pickParam = (name) => {
    if (!name) { onChange({ param: null }); return; }
    const p = params.find((q) => q.name === name);
    onChange({
      param: name,
      from: Number.isFinite(sw.from) && sw.param === name ? sw.from : (p?.min ?? 0),
      to: Number.isFinite(sw.to) && sw.param === name ? sw.to : (p?.max ?? 10),
    });
  };

  const setNum = (key, raw) => {
    const v = Number(raw);
    if (raw === "" || !Number.isFinite(v)) return;
    onChange({ [key]: v });
  };

  return (
    <div style={{ fontFamily: mono, marginTop: 14, borderTop: `1px solid ${C.border2}`, paddingTop: 10 }}>
      <div style={{ fontSize: 9, color: C.blue, letterSpacing: "0.22em", textTransform: "uppercase", marginBottom: 8 }}>
        Comparative statics
      </div>

      <label style={row(C)}>
        sweep parameter
        <select value={sw.param || ""} onChange={(e) => pickParam(e.target.value)} style={sel(C)}>
          <option value="">none</option>
          {detectedSymbols.map((s) => <option key={s} value={s}>{s}</option>)}
        </select>
      </label>

      {sw.param && (
        <>
          <div style={{ display: "flex", alignItems: "center", gap: 12, flexWrap: "wrap", marginTop: 6 }}>
            <label style={row(C)}>from<input type="number" value={sw.from ?? ""} onChange={(e) => setNum("from", e.target.value)} style={num(C)} /></label>
            <label style={row(C)}>to<input type="number" value={sw.to ?? ""} onChange={(e) => setNum("to", e.target.value)} style={num(C)} /></label>
            <label style={row(C)}>
              steps
              <input type="number" min={2} max={12} step={1} value={sw.steps ?? 5}
                onChange={(e) => { const v = Math.round(Number(e.target.value)); if (Number.isFinite(v)) onChange({ steps: Math.min(12, Math.max(2, v)) }); }}
                style={num(C)} />
            </label>
          </div>

          <label style={{ ...row(C), marginTop: 6, cursor: "pointer" }}>
            <input type="checkbox" checked={sw.showFamily !== false}
              onChange={(e) => onChange({ showFamily: e.target.checked })} style={{ accentColor: C.teal }} />
            show family of curves
          </label>

          <div style={{ ...row(C), marginTop: 6, gap: 10 }}>
            <span>optimum locus</span>
            {[["off", "off"], ["argmax", "x*"], ["value", "f(x*)"]].map(([val, label]) => (
              <label key={val} style={{ display: "flex", alignItems: "center", gap: 3, cursor: "pointer", color: (sw.locus || "off") === val ? C.gold : C.textDim }}>
                <input type="radio" name="sweep-locus" checked={(sw.locus || "off") === val}
                  onChange={() => onChange({ locus: val })} style={{ accentColor: C.gold }} />
                {label}
              </label>
            ))}
          </div>
        </>
      )}
    </div>
  );
}

function row(C) {
  return { display: "flex", alignItems: "center", gap: 6, fontSize: 10, color: C.textDim || "#888" };
}
function num(C) {
  return { width: 64, background: C.bg, color: C.text, border: `1px solid ${C.border2}`,
    fontFamily: mono, fontSize: 11, padding: "2px 4px" };
}
function sel(C) {
  return { background: C.bg, color: C.text, border: `1px solid ${C.border2}`,
    fontFamily: mono, fontSize: 11, padding: "2px 4px" };
}
