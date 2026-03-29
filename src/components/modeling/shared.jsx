// ─── ECON STUDIO · src/components/modeling/shared.jsx ─────────────────────────
// Theme constants + micro-UI atoms shared across all Modeling sub-components.
// No state, no side effects.

// ─── THEME ────────────────────────────────────────────────────────────────────
export const C = {
  bg: "#080808", surface: "#0f0f0f", surface2: "#131313", surface3: "#161616",
  border: "#1c1c1c", border2: "#252525",
  gold: "#c8a96e", goldDim: "#7a6040", goldFaint: "#1a1408",
  text: "#ddd8cc", textDim: "#888", textMuted: "#444",
  green: "#7ab896", red: "#c47070", yellow: "#c8b46e",
  blue: "#6e9ec8", purple: "#a87ec8", teal: "#6ec8b4", orange: "#c88e6e",
  violet: "#9e7ec8",
};

export const mono = "'IBM Plex Mono','JetBrains Mono',Consolas,monospace";

// ─── ATOMS ────────────────────────────────────────────────────────────────────

export function Lbl({ children, color = C.textMuted }) {
  return (
    <div style={{
      fontSize: 9, color, letterSpacing: "0.22em",
      textTransform: "uppercase", marginBottom: 8, fontFamily: mono,
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

export function Section({ title, children, color = C.textMuted }) {
  return (
    <div style={{ marginBottom: "1.4rem" }}>
      <Lbl color={color}>{title}</Lbl>
      {children}
    </div>
  );
}

export function InfoBox({ children, color = C.blue, bg }) {
  return (
    <div style={{
      padding: "0.65rem 0.9rem",
      background: bg || `${color}08`,
      border: `1px solid ${color}30`,
      borderLeft: `3px solid ${color}`,
      borderRadius: 4, fontSize: 11,
      color: C.textDim, lineHeight: 1.7,
      fontFamily: mono, marginBottom: "1rem",
    }}>
      {children}
    </div>
  );
}

// ─── VAR PANEL ────────────────────────────────────────────────────────────────
// Reusable variable-picker strip: title bar + chip grid.
// Used by VariableSelector and ModelConfiguration.
export function VarPanel({ title, color, vars, selected, onToggle, multi = true, info }) {
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
