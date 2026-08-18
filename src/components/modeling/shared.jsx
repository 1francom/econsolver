// ─── ECON STUDIO · src/components/modeling/shared.jsx ───────────────────────
// Theme hook + micro-UI atoms shared across all Modeling sub-components.

import { useState } from "react";
import { useTheme } from "../../ThemeContext.jsx";

// Re-export so consumers can import from one place.
export { useTheme };

// NOTE: this module used to also export `DARK as C` and a static `mono` string.
// Both are gone deliberately. They were snapshots of the dark palette / default
// mono stack, so any component using them silently ignored the active theme and
// the user's font choice — a light-mode component reading that `C` would have
// rendered dark-palette colours on a white ground. Use `useTheme()` and read
// `C.*` / `T.code.fontFamily` / `T.data.fontFamily` instead.

// ─── ATOMS ────────────────────────────────────────────────────────────────────

export function Lbl({ children, color }) {
  const { C, T } = useTheme();
  return (
    <div style={{
      fontSize: T.caption.fontSize, color: color ?? C.textMuted,
      letterSpacing: "0.22em", textTransform: "uppercase",
      marginBottom: 8, fontFamily: T.label.fontFamily,
    }}>
      {children}
    </div>
  );
}

export function Badge({ label, color }) {
  const { T } = useTheme();
  return (
    <span style={{
      fontSize: T.caption.fontSize, padding: "2px 7px",
      border: `1px solid ${color}`, color,
      borderRadius: 2, letterSpacing: "0.1em", fontFamily: T.label.fontFamily,
    }}>
      {label}
    </span>
  );
}

export function Chip({ label, selected, color, onClick, disabled, title, factored, onFactor }) {
  const { C, T } = useTheme();
  const showF = onFactor !== undefined;
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      title={title}
      style={{
        padding: showF ? "0.35rem 0.5rem 0.35rem 0.8rem" : "0.35rem 0.8rem",
        border: `1px solid ${selected ? color : C.border2}`,
        background: selected ? `${color}1a` : "transparent",
        color: selected ? color : disabled ? C.textMuted : C.textDim,
        borderRadius: 3, cursor: disabled ? "not-allowed" : "pointer",
        fontSize: T.code.fontSize, fontFamily: T.body.fontFamily, transition: "all 0.12s",
        opacity: disabled ? 0.45 : 1,
        display: "inline-flex", alignItems: "center", gap: 0,
      }}
    >
      <span>{selected ? "✓ " : ""}{label}</span>
      {showF && (
        <span
          onClick={e => { e.stopPropagation(); onFactor(); }}
          title={factored ? "Remove factor encoding" : "Treat as factor (categorical)"}
          style={{
            marginLeft: 5,
            paddingLeft: 5,
            borderLeft: `1px solid ${selected ? `${color}50` : C.border2}`,
            color: factored ? C.gold : C.textMuted,
            fontSize: T.caption.fontSize,
            fontWeight: factored ? "bold" : "normal",
            cursor: "pointer",
            lineHeight: 1,
          }}
        >
          f
        </span>
      )}
    </button>
  );
}

export function ModelBtn({ model, selected, disabled, onClick, color, hint }) {
  const { C, T } = useTheme();
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      title={disabled ? hint : ""}
      style={{
        padding: "0.7rem 1rem",
        border: `1px solid ${selected ? color : C.border}`,
        background: selected ? `${color}12` : C.surface,
        color: selected ? color : disabled ? C.textMuted : C.textDim,
        borderRadius: 4, cursor: disabled ? "not-allowed" : "pointer",
        fontSize: T.code.fontSize, fontFamily: T.body.fontFamily, opacity: disabled ? 0.4 : 1,
        transition: "all 0.13s", textAlign: "left",
        display: "flex", alignItems: "center", gap: 8,
      }}
    >
      {disabled && <span style={{ fontSize: T.caption.fontSize }}>🔒</span>}
      {selected && <span style={{ color }}>●</span>}
      {model}
    </button>
  );
}

// `collapsible` turns the label into a disclosure header. `defaultOpen` is only
// read on mount (it seeds useState), which is deliberate: callers pass a value
// derived from their data, and re-syncing it on every render would collapse the
// section under the user mid-interaction. Do not "fix" it into a useEffect.
export function Section({ title, children, color, collapsible = false, defaultOpen = true }) {
  const { C, T } = useTheme();
  const [open, setOpen] = useState(defaultOpen);

  if (!collapsible) {
    return (
      <div style={{ marginBottom: "1.4rem" }}>
        <Lbl color={color ?? C.textMuted}>{title}</Lbl>
        {children}
      </div>
    );
  }

  return (
    // Collapsed sections tighten their bottom margin — the point of collapsing
    // here is reclaiming sidebar height, so the gap shrinks with the content.
    <div style={{ marginBottom: open ? "1.4rem" : "0.5rem" }}>
      <button
        onClick={() => setOpen(o => !o)}
        title={open ? "Collapse" : "Expand"}
        style={{
          display: "flex", alignItems: "baseline", gap: 6, width: "100%",
          background: "transparent", border: "none", padding: 0,
          cursor: "pointer", textAlign: "left",
        }}
      >
        <span style={{
          fontSize: T.caption.fontSize, color: color ?? C.textMuted,
          lineHeight: 1, flexShrink: 0,
        }}>
          {open ? "▾" : "▸"}
        </span>
        <Lbl color={color ?? C.textMuted}>{title}</Lbl>
      </button>
      {open && children}
    </div>
  );
}

export function InfoBox({ children, color, bg }) {
  const { C, T } = useTheme();
  const col = color ?? C.blue;
  return (
    <div style={{
      padding: "0.65rem 0.9rem",
      background: bg || `${col}08`,
      border: `1px solid ${col}30`,
      borderLeft: `3px solid ${col}`,
      borderRadius: 4, fontSize: T.code.fontSize,
      color: C.textDim, lineHeight: 1.7,
      fontFamily: T.body.fontFamily, marginBottom: "1rem",
    }}>
      {children}
    </div>
  );
}

// ─── VAR PANEL ────────────────────────────────────────────────────────────────
export function VarPanel({ title, color, vars, selected, onToggle, multi = true, info, factorVars, onToggleFactor }) {
  const { C, T } = useTheme();
  return (
    <Section
      title={`${title} — ${selected.length > 0 ? selected.join(", ") : "none"}`}
      color={color}
      collapsible
      // Already-configured panels start folded; an empty one stays open so the
      // first selection still invites a click. Mount-time only (see Section).
      defaultOpen={selected.length === 0}
    >
      {info && (
        <div style={{ fontSize: T.caption.fontSize, color: C.textMuted, fontFamily: T.body.fontFamily, marginBottom: 6 }}>
          {info}
        </div>
      )}
      <div style={{ display: "flex", flexWrap: "wrap", gap: 5 }}>
        {vars.map(v => (
          <Chip
            key={v}
            label={v}
            selected={selected.includes(v)}
            color={color}
            onClick={() => {
              if (!multi) {
                onToggle(selected.includes(v) ? [] : [v]);
              } else {
                onToggle(
                  selected.includes(v)
                    ? selected.filter(x => x !== v)
                    : [...selected, v]
                );
              }
            }}
            factored={factorVars ? factorVars.has(v) : undefined}
            onFactor={onToggleFactor ? () => onToggleFactor(v) : undefined}
          />
        ))}
      </div>
    </Section>
  );
}
