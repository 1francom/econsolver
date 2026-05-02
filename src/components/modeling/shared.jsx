// ─── ECON STUDIO · src/components/modeling/shared.jsx ───────────────────────
// Theme hook + micro-UI atoms shared across all Modeling sub-components.

import { useTheme } from "../../ThemeContext.jsx";

// Re-export so consumers can import from one place.
export { useTheme };

// Static fallback for non-React contexts.
export { DARK as C } from "../../theme.js";

export const mono = "'IBM Plex Mono','JetBrains Mono',Consolas,monospace";

// ─── ATOMS ────────────────────────────────────────────────────────────────────

export function Lbl({ children, color }) {
  const { C } = useTheme();
  return (
    <div style={{
      fontSize: 9, color: color ?? C.textMuted,
      letterSpacing: "0.22em", textTransform: "uppercase",
      marginBottom: 8, fontFamily: mono,
    }}>
      {children}
    </div>
  );
}

export function Badge({ label, color }) {
  return (
    <span style={{
      fontSize: 9, padding: "2px 7px",
      border: `1px solid ${color}`, color,
      borderRadius: 2, letterSpacing: "0.1em", fontFamily: mono,
    }}>
      {label}
    </span>
  );
}

export function Chip({ label, selected, color, onClick, disabled, title }) {
  const { C } = useTheme();
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      title={title}
      style={{
        padding: "0.35rem 0.8rem",
        border: `1px solid ${selected ? color : C.border2}`,
        background: selected ? `${color}1a` : "transparent",
        color: selected ? color : disabled ? C.textMuted : C.textDim,
        borderRadius: 3, cursor: disabled ? "not-allowed" : "pointer",
        fontSize: 11, fontFamily: mono, transition: "all 0.12s",
        opacity: disabled ? 0.45 : 1,
      }}
    >
      {selected ? "✓ " : ""}{label}
    </button>
  );
}

export function ModelBtn({ model, selected, disabled, onClick, color, hint }) {
  const { C } = useTheme();
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
        fontSize: 12, fontFamily: mono, opacity: disabled ? 0.4 : 1,
        transition: "all 0.13s", textAlign: "left",
        display: "flex", alignItems: "center", gap: 8,
      }}
    >
      {disabled && <span style={{ fontSize: 10 }}>🔒</span>}
      {selected && <span style={{ color }}>●</span>}
      {model}
    </button>
  );
}

export function Section({ title, children, color }) {
  const { C } = useTheme();
  return (
    <div style={{ marginBottom: "1.4rem" }}>
      <Lbl color={color ?? C.textMuted}>{title}</Lbl>
      {children}
    </div>
  );
}

export function InfoBox({ children, color, bg }) {
  const { C } = useTheme();
  const col = color ?? C.blue;
  return (
    <div style={{
      padding: "0.65rem 0.9rem",
      background: bg || `${col}08`,
      border: `1px solid ${col}30`,
      borderLeft: `3px solid ${col}`,
      borderRadius: 4, fontSize: 11,
      color: C.textDim, lineHeight: 1.7,
      fontFamily: mono, marginBottom: "1rem",
    }}>
      {children}
    </div>
  );
}

// ─── VAR PANEL ────────────────────────────────────────────────────────────────
export function VarPanel({ title, color, vars, selected, onToggle, multi = true, info }) {
  const { C } = useTheme();
  return (
    <Section title={`${title} — ${selected.length > 0 ? selected.join(", ") : "none"}`} color={color}>
      {info && (
        <div style={{ fontSize: 10, color: C.textMuted, fontFamily: mono, marginBottom: 6 }}>
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
          />
        ))}
      </div>
    </Section>
  );
}
