// ─── ECON STUDIO · spatial/shared/atoms.jsx ──────────────────────────────────
// Shared UI atoms for the Spatial module. Inline styles via the `C` color object.

import { useState, useEffect } from "react";
import { mono } from "./constants.js";

export function ColSelect({ label, value, onChange, headers, C, allowNone = false }) {
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 3 }}>
      <label style={{ fontSize: 9, color: C.textMuted, letterSpacing: "0.12em", textTransform: "uppercase" }}>
        {label}
      </label>
      <select
        value={value}
        onChange={e => onChange(e.target.value)}
        style={{
          padding: "4px 8px", background: C.surface, border: `1px solid ${C.border2}`,
          borderRadius: 3, color: value ? C.text : C.textMuted, fontFamily: mono,
          fontSize: 10, outline: "none", cursor: "pointer",
        }}
      >
        {allowNone && <option value="">— none —</option>}
        {headers.map(h => <option key={h} value={h}>{h}</option>)}
      </select>
    </div>
  );
}

export function NumInput({ label, value, onChange, C, min, max, step = "any", placeholder = "", confirm = false }) {
  // Staged mode (confirm): the value only commits to parent state on ✓/Enter,
  // so heavy consumers (grid generation) never recompute on transient keystrokes.
  const [draft, setDraft] = useState(String(value ?? ""));
  useEffect(() => { setDraft(String(value ?? "")); }, [value]);

  if (!confirm) {
    return (
      <div style={{ display: "flex", flexDirection: "column", gap: 3 }}>
        <label style={{ fontSize: 9, color: C.textMuted, letterSpacing: "0.12em", textTransform: "uppercase" }}>
          {label}
        </label>
        <input
          type="number"
          value={value}
          onChange={e => onChange(e.target.value === "" ? "" : Number(e.target.value))}
          min={min} max={max} step={step} placeholder={placeholder}
          style={{
            padding: "4px 8px", background: C.surface, border: `1px solid ${C.border2}`,
            borderRadius: 3, color: C.text, fontFamily: mono, fontSize: 10,
            outline: "none", width: "100%",
          }}
        />
      </div>
    );
  }

  const dirty = draft !== String(value ?? "");
  const commit = () => {
    let v = draft === "" ? NaN : Number(draft);
    if (!Number.isFinite(v)) v = min ?? 0;
    if (min != null) v = Math.max(min, v);
    if (max != null) v = Math.min(max, v);
    onChange(v);
    setDraft(String(v));
  };
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 3 }}>
      <label style={{ fontSize: 9, color: C.textMuted, letterSpacing: "0.12em", textTransform: "uppercase" }}>
        {label}
      </label>
      <div style={{ display: "flex", gap: 5 }}>
        <input
          type="number"
          value={draft}
          onChange={e => setDraft(e.target.value)}
          onKeyDown={e => { if (e.key === "Enter") { e.preventDefault(); commit(); } else if (e.key === "Escape") setDraft(String(value ?? "")); }}
          min={min} max={max} step={step} placeholder={placeholder}
          style={{
            padding: "4px 8px", background: C.surface, border: `1px solid ${dirty ? C.gold + "99" : C.border2}`,
            borderRadius: 3, color: C.text, fontFamily: mono, fontSize: 10,
            outline: "none", flex: 1, minWidth: 0,
          }}
        />
        <button
          onClick={commit}
          disabled={!dirty}
          title="Apply (Enter)"
          style={{
            padding: "0 10px", background: dirty ? `${C.teal}22` : "transparent",
            border: `1px solid ${dirty ? C.teal : C.border2}`, borderRadius: 3,
            color: dirty ? C.teal : C.textMuted, fontFamily: mono, fontSize: 11,
            cursor: dirty ? "pointer" : "default", lineHeight: 1,
          }}
        >✓</button>
      </div>
    </div>
  );
}

export function TextInput({ label, value, onChange, C, placeholder = "" }) {
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 3 }}>
      <label style={{ fontSize: 9, color: C.textMuted, letterSpacing: "0.12em", textTransform: "uppercase" }}>
        {label}
      </label>
      <input
        type="text"
        value={value}
        onChange={e => onChange(e.target.value)}
        placeholder={placeholder}
        style={{
          padding: "4px 8px", background: C.surface, border: `1px solid ${C.border2}`,
          borderRadius: 3, color: C.text, fontFamily: mono, fontSize: 10,
          outline: "none", width: "100%",
        }}
      />
    </div>
  );
}

export function ApplyBtn({ onClick, disabled, label = "Apply", C }) {
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      style={{
        padding: "0.4rem 1rem", background: disabled ? "transparent" : `${C.teal}18`,
        border: `1px solid ${disabled ? C.border2 : C.teal}`,
        borderRadius: 3, color: disabled ? C.textMuted : C.teal,
        cursor: disabled ? "not-allowed" : "pointer", fontFamily: mono, fontSize: 10,
        transition: "all 0.13s",
      }}
    >{label}</button>
  );
}

export function SaveBtn({ onClick, disabled, C }) {
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      style={{
        padding: "0.4rem 1rem", background: disabled ? "transparent" : `${C.gold}18`,
        border: `1px solid ${disabled ? C.border2 : C.gold}`,
        borderRadius: 3, color: disabled ? C.textMuted : C.gold,
        cursor: disabled ? "not-allowed" : "pointer", fontFamily: mono, fontSize: 10,
      }}
    >Save as dataset</button>
  );
}

export function ResultPreview({ rows, newCols, C }) {
  if (!rows || !rows.length || !newCols.length) return null;
  const preview = rows.slice(0, 8);
  return (
    <div style={{ marginTop: 10 }}>
      <div style={{ fontSize: 9, color: C.teal, letterSpacing: "0.14em", textTransform: "uppercase", marginBottom: 6 }}>
        Preview — {rows.length} rows
      </div>
      <div style={{ overflowX: "auto", border: `1px solid ${C.border2}`, borderRadius: 3 }}>
        <table style={{ borderCollapse: "collapse", fontFamily: mono, fontSize: 9, width: "100%" }}>
          <thead>
            <tr style={{ background: C.surface2 }}>
              {newCols.map(c => (
                <th key={c} style={{
                  padding: "4px 8px", borderBottom: `1px solid ${C.border}`,
                  color: C.teal, fontWeight: 400, whiteSpace: "nowrap",
                }}>{c}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {preview.map((row, i) => (
              <tr key={i} style={{ background: i % 2 ? C.surface2 : C.surface }}>
                {newCols.map(c => {
                  const v = row[c];
                  return (
                    <td key={c} style={{
                      padding: "3px 8px", color: v == null ? C.textMuted : C.text,
                      borderBottom: `1px solid ${C.border}`, whiteSpace: "nowrap",
                    }}>
                      {v == null ? "·" : typeof v === "number" ? v.toFixed(4).replace(/\.?0+$/, "") : String(v)}
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

export function ErrBanner({ msg, C }) {
  if (!msg) return null;
  return (
    <div style={{
      padding: "0.4rem 0.7rem", background: `${C.red ?? "#c84e4e"}18`,
      border: `1px solid ${C.red ?? "#c84e4e"}60`,
      borderRadius: 3, fontSize: 10, color: C.red ?? "#c84e4e", fontFamily: mono, marginTop: 8,
    }}>{msg}</div>
  );
}

// ─── COLLAPSIBLE SECTION WRAPPER ─────────────────────────────────────────────

export function Section({ title, badge, children, C, defaultOpen = false }) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <div style={{ border: `1px solid ${C.border2}`, borderRadius: 4, overflow: "hidden" }}>
      <button
        onClick={() => setOpen(o => !o)}
        style={{
          width: "100%", display: "flex", alignItems: "center", gap: 8,
          padding: "0.55rem 0.9rem", background: open ? C.surface2 : C.surface,
          border: "none", cursor: "pointer", textAlign: "left", fontFamily: mono,
          borderBottom: open ? `1px solid ${C.border}` : "none",
          transition: "background 0.12s",
        }}
      >
        <span style={{ fontSize: 9, color: C.teal }}>{open ? "▾" : "▸"}</span>
        <span style={{ fontSize: 11, color: C.text, flex: 1 }}>{title}</span>
        {badge && (
          <span style={{
            fontSize: 8, padding: "2px 6px", border: `1px solid ${C.border2}`,
            borderRadius: 2, color: C.textMuted, letterSpacing: "0.1em",
          }}>{badge}</span>
        )}
      </button>
      {open && (
        <div style={{ padding: "1rem", background: C.surface }}>
          {children}
        </div>
      )}
    </div>
  );
}
