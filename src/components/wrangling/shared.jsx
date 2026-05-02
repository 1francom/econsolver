// ─── ECON STUDIO · components/wrangling/shared.jsx ─────────────────────────
// Theme hook + stateless atom components shared across all wrangling tabs.
// No side effects beyond useTheme. Safe to import from any tab file.

import { useState } from "react";
import { useTheme } from "../../ThemeContext.jsx";

// Re-export useTheme so consumers can import from one place.
export { useTheme };

// Static fallback for non-React contexts (module-level utils, tests, etc.)
export { DARK as C } from "../../theme.js";

export const mono = "'IBM Plex Mono','JetBrains Mono',Consolas,monospace";

// ─── ATOMS ────────────────────────────────────────────────────────────────────
export function Lbl({ children, color, mb = 6 }) {
  const { C } = useTheme();
  return (
    <div style={{
      fontSize: 10, color: color ?? C.textMuted,
      letterSpacing: "0.2em", textTransform: "uppercase",
      marginBottom: mb, fontFamily: mono,
    }}>
      {children}
    </div>
  );
}

export function Tabs({ tabs, active, set, accent, sm = false }) {
  const { C } = useTheme();
  const ac = accent ?? C.gold;
  return (
    <div style={{ display: "flex", gap: 1, background: C.border, borderRadius: 4, overflow: "hidden", marginBottom: "1.2rem" }}>
      {tabs.map(([k, l]) => (
        <button key={k} onClick={() => set(k)} style={{
          flex: 1, padding: sm ? "0.45rem 0.5rem" : "0.6rem 0.7rem",
          background: active === k ? C.goldFaint : C.surface,
          border: "none",
          color: active === k ? ac : C.textDim,
          cursor: "pointer", fontFamily: mono, fontSize: sm ? 9 : 11,
          borderBottom: active === k ? `2px solid ${ac}` : "2px solid transparent",
          transition: "all 0.12s",
        }}>
          {l}
        </button>
      ))}
    </div>
  );
}

export function Btn({ onClick, ch, color, v = "out", dis = false, sm = false }) {
  const { C } = useTheme();
  const col = color ?? C.gold;
  const b = {
    padding: sm ? "0.28rem 0.65rem" : "0.48rem 0.95rem",
    borderRadius: 3, cursor: dis ? "not-allowed" : "pointer",
    fontFamily: mono, fontSize: sm ? 10 : 11,
    transition: "all 0.13s", opacity: dis ? 0.4 : 1,
  };
  if (v === "solid") return <button onClick={onClick} disabled={dis} style={{ ...b, background: col, color: C.bg, border: `1px solid ${col}`, fontWeight: 700 }}>{ch}</button>;
  if (v === "ghost") return <button onClick={onClick} disabled={dis} style={{ ...b, background: "transparent", border: "none", color: dis ? C.textMuted : col }}>{ch}</button>;
  return <button onClick={onClick} disabled={dis} style={{ ...b, background: "transparent", border: `1px solid ${C.border2}`, color: dis ? C.textMuted : C.textDim }}>{ch}</button>;
}

export function Badge({ ch, color }) {
  const { C } = useTheme();
  const col = color ?? C.textMuted;
  return (
    <span style={{
      fontSize: 9, padding: "2px 6px", border: `1px solid ${col}`,
      color: col, borderRadius: 2, letterSpacing: "0.1em",
      fontFamily: mono, whiteSpace: "nowrap",
    }}>
      {ch}
    </span>
  );
}

export function NA({ pct }) {
  const { C } = useTheme();
  const c = pct > .3 ? C.red : pct > .1 ? C.yellow : C.green;
  return (
    <span style={{ display: "inline-flex", alignItems: "center", gap: 3 }}>
      <span style={{ display: "inline-block", width: 24, height: 3, background: C.border, borderRadius: 2, overflow: "hidden" }}>
        <span style={{ display: "block", width: `${Math.min(pct * 100, 100)}%`, height: "100%", background: c }} />
      </span>
      {pct > 0 && <span style={{ fontSize: 9, color: c, fontFamily: mono }}>{(pct * 100).toFixed(0)}%</span>}
    </span>
  );
}

export function Spin() {
  const { C } = useTheme();
  return (
    <div style={{
      width: 14, height: 14, border: `2px solid ${C.border2}`,
      borderTopColor: C.gold, borderRadius: "50%",
      animation: "spin 0.7s linear infinite", flexShrink: 0,
    }} />
  );
}

export function Grid({ headers, rows, hi, max = 20, types, onType }) {
  const { C } = useTheme();
  const vis = rows.slice(0, max);
  if (!headers.length) return null;
  const tc = { numeric: C.blue, binary: C.purple, categorical: C.purple, string: C.textMuted, date: C.teal };
  return (
    <div style={{ overflowX: "auto", borderRadius: 4, border: `1px solid ${C.border}` }}>
      <table style={{ borderCollapse: "collapse", fontSize: 11, width: "100%", minWidth: 300 }}>
        <thead>
          <tr style={{ background: C.surface2 }}>
            {headers.map(h => (
              <th key={h} style={{
                padding: "0.45rem 0.75rem", textAlign: "left", fontFamily: mono,
                fontWeight: 400, fontSize: 10, color: h === hi ? C.teal : C.textDim,
                whiteSpace: "nowrap", borderBottom: `1px solid ${C.border}`,
                position: "sticky", top: 0, background: C.surface2,
              }}>
                <div style={{ display: "flex", flexDirection: "column", gap: 2 }}>
                  <span style={{ color: h === hi ? C.teal : C.textDim }}>{h}</span>
                  {onType && types && (
                    <select
                      value={types[h] || ""} onChange={e => onType(h, e.target.value)}
                      onClick={e => e.stopPropagation()}
                      style={{
                        fontSize: 9, padding: "1px 3px", background: C.surface,
                        border: `1px solid ${C.border2}`, borderRadius: 2,
                        color: tc[types[h]] || C.textMuted, fontFamily: mono,
                        cursor: "pointer", outline: "none",
                      }}
                    >
                      {["numeric", "categorical", "binary", "string", "date"].map(t => (
                        <option key={t} value={t}>{t}</option>
                      ))}
                    </select>
                  )}
                </div>
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {vis.map((row, i) => (
            <tr key={i} style={{ background: i % 2 ? C.surface2 : C.surface }}>
              {headers.map(h => {
                const v = row[h];
                const isNull = v === null || v === undefined;
                return (
                  <td key={h} style={{
                    padding: "0.35rem 0.75rem", fontFamily: mono, fontSize: 11,
                    color: isNull ? C.textMuted : h === hi ? C.teal : C.text,
                    borderBottom: `1px solid ${C.border}`,
                    whiteSpace: "nowrap", maxWidth: 180,
                    overflow: "hidden", textOverflow: "ellipsis",
                  }}>
                    {isNull ? "·" : typeof v === "number" ? v.toFixed(3).replace(/\.?0+$/, "") : String(v)}
                  </td>
                );
              })}
            </tr>
          ))}
        </tbody>
      </table>
      {rows.length > max && (
        <div style={{
          padding: "0.35rem 0.75rem", fontSize: 10, color: C.textMuted,
          fontFamily: mono, background: C.surface2, borderTop: `1px solid ${C.border}`,
        }}>
          … {rows.length - max} more rows
        </div>
      )}
    </div>
  );
}
