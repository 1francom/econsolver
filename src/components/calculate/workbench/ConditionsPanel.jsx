import { useTheme } from "../../../ThemeContext.jsx";


// Named-equation intersection / FOC conditions (item C). Each row reads
// `[lhs] = [rhs] w.r.t [wrt]`, where lhs/rhs are equation NAMES (eq.label) or
// literals, optionally with a trailing apostrophe for "the derivative". The
// solved output (e.g. `K* = 4`, or a system `X1* = …, X2* = …`) renders inline
// beneath each row, or a red error if it cannot be solved.
// Props:
//   conditions  : [{ id, lhs, rhs, wrt, enabled }]
//   results     : [{ id, label, results:[{var,expr,value}], closed, error }]
//   names       : string[]   — equation names available to reference
//   onAdd onPatch onRemove
export default function ConditionsPanel({ conditions, results, names, onAdd, onPatch, onRemove }) {
  const { C, T } = useTheme();
  const conds = Array.isArray(conditions) ? conditions : [];
  const byId = new Map((results || []).map((r) => [r.id, r]));

  const fmt = (x) => {
    if (!Number.isFinite(x)) return "—";
    const a = Math.abs(x);
    if (a !== 0 && (a < 1e-3 || a >= 1e6)) return x.toExponential(3);
    return (Math.round(x * 1e6) / 1e6).toString();
  };

  return (
    <div style={{ fontFamily: T.code.fontFamily, marginTop: 14, borderTop: `1px solid ${C.border2}`, paddingTop: 10 }}>
      <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 8 }}>
        <div style={{ fontSize: T.caption.fontSize, color: C.gold, letterSpacing: "0.22em", textTransform: "uppercase" }}>
          Conditions
        </div>
        <button onClick={() => onAdd()} title="Add an intersection / first-order condition"
          style={{ fontSize: T.caption.fontSize, padding: "2px 8px", borderRadius: 4, cursor: "pointer",
            background: "transparent", color: C.gold, border: `1px solid ${C.gold}`, fontFamily: T.code.fontFamily }}>
          + condition
        </button>
        {names?.length > 0 && (
          <span style={{ fontSize: T.caption.fontSize, color: C.textDim || "#888" }}>names: {names.join(", ")}</span>
        )}
      </div>

      {conds.length === 0 && (
        <div style={{ fontSize: T.caption.fontSize, color: C.textDim || "#888" }}>
          e.g. <span style={{ color: C.text }}>f = g</span> w.r.t <span style={{ color: C.text }}>K</span>, or <span style={{ color: C.text }}>f' = g'</span> w.r.t <span style={{ color: C.text }}>X1, X2</span>
        </div>
      )}

      {conds.map((c) => {
        const res = byId.get(c.id);
        const dim = c.enabled === false;
        return (
          <div key={c.id} style={{ marginTop: 8, opacity: dim ? 0.5 : 1 }}>
            <div style={{ display: "flex", alignItems: "center", gap: 6, flexWrap: "wrap" }}>
              <input type="checkbox" checked={c.enabled !== false}
                onChange={(e) => onPatch(c.id, { enabled: e.target.checked })}
                style={{ accentColor: C.gold }} title="enable" />
              <input value={c.lhs} placeholder="f" onChange={(e) => onPatch(c.id, { lhs: e.target.value.slice(0, 64) })} style={fld(C, 56)} />
              <span style={{ color: C.textDim }}>=</span>
              <input value={c.rhs} placeholder="g" onChange={(e) => onPatch(c.id, { rhs: e.target.value.slice(0, 64) })} style={fld(C, 56)} />
              <span style={{ fontSize: T.caption.fontSize, color: C.textDim }}>w.r.t</span>
              <input value={c.wrt} placeholder="K" onChange={(e) => onPatch(c.id, { wrt: e.target.value.slice(0, 64) })} style={fld(C, 80)} />
              <button onClick={() => onRemove(c.id)} title="remove"
                style={{ marginLeft: "auto", fontSize: T.code.fontSize, lineHeight: 1, padding: "1px 6px", cursor: "pointer",
                  background: "transparent", color: C.textDim, border: `1px solid ${C.border2}`, borderRadius: 4, fontFamily: T.code.fontFamily }}>
                ×
              </button>
            </div>

            {c.enabled !== false && res && (
              <div style={{ fontSize: T.code.fontSize, marginTop: 3, marginLeft: 22 }}>
                {res.error ? (
                  <span style={{ color: C.red || "#d08070" }}>{res.error}</span>
                ) : (
                  <span style={{ color: C.textDim }}>
                    {res.results.map((r, i) => (
                      <span key={r.var}>
                        {i > 0 && ", "}
                        {r.var}* = <b style={{ color: C.text }}>{fmt(r.value)}</b>
                      </span>
                    ))}
                    {!res.closed && <span style={{ color: C.gold }}> · numeric</span>}
                  </span>
                )}
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}

function fld(C, w) {
  return { width: w, background: C.bg, color: C.text, border: `1px solid ${C.border2}`,
    fontFamily: T.code.fontFamily, fontSize: T.code.fontSize, padding: "2px 5px" };
}
