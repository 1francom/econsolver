// ─── ECON STUDIO · components/modeling/ModelBufferBar.jsx ────────────────────
// Horizontal strip of pinned models at the bottom of the results panel.
//
// Props:
//   models         EstimationResult[]  — from modelBuffer.getAll()
//   activeId       string | null       — currently displayed result id
//   onRestore(id)                      — click a card → restore it as active
//   onRemove(id)                       — X → remove from buffer
//   onCompare()                        — opens comparison panel (enabled when 2+)

import { C, mono } from "./shared.jsx";

function safeR2(r) {
  if (r == null) return null;
  const v = r.R2 ?? r.adjR2 ?? r.mcFaddenR2 ?? null;
  return (v != null && isFinite(v)) ? v.toFixed(3) : null;
}

function keyStatLabel(r) {
  if (r.type === "RDD")  return r.late  != null ? `LATE=${r.late.toFixed(3)}`  : null;
  if (r.type === "DiD" || r.type === "TWFE") return r.att != null ? `ATT=${r.att.toFixed(3)}` : null;
  const r2 = safeR2(r);
  return r2 ? `R²=${r2}` : null;
}

const TYPE_COLOR = {
  OLS:   "#7ab896",
  WLS:   "#7ab896",
  FE:    "#6e9ec8",
  FD:    "#6e9ec8",
  "2SLS":"#a87ec8",
  DiD:   "#c8a96e",
  TWFE:  "#c8a96e",
  RDD:   "#c88e6e",
  Logit: "#9e7ec8",
  Probit:"#9e7ec8",
};

export default function ModelBufferBar({ models, activeId, onRestore, onRemove, onCompare }) {
  if (!models?.length) return null;

  const canCompare = models.length >= 2;

  return (
    <div style={{
      borderTop: `1px solid ${C.border}`,
      background: C.surface,
      padding: "0.55rem 1rem",
      display: "flex", alignItems: "center", gap: 8,
      flexWrap: "wrap",
    }}>
      {/* Label */}
      <div style={{ fontSize: 9, color: C.textMuted, letterSpacing: "0.2em", textTransform: "uppercase", flexShrink: 0 }}>
        Pinned
      </div>

      {/* Model cards */}
      {models.map(r => {
        const isActive = r.id === activeId;
        const clr = TYPE_COLOR[r.type] ?? C.teal;
        const stat = keyStatLabel(r);
        const label = r.label ?? r.type ?? "Model";
        const n = r.n ?? "?";
        return (
          <div
            key={r.id}
            onClick={() => onRestore(r.id)}
            style={{
              display: "flex", alignItems: "center", gap: 5,
              padding: "3px 7px 3px 9px",
              border: `1px solid ${isActive ? clr : C.border2}`,
              borderLeft: `3px solid ${clr}`,
              borderRadius: 3,
              background: isActive ? `${clr}14` : C.bg,
              cursor: "pointer",
              transition: "all 0.12s",
            }}
          >
            <span style={{ fontSize: 10, color: clr, fontFamily: mono, letterSpacing: "0.05em" }}>
              {label}
            </span>
            <span style={{ fontSize: 9, color: C.textDim, fontFamily: mono }}>
              ·n={n}{stat ? `·${stat}` : ""}
            </span>
            {/* Remove button */}
            <button
              onClick={e => { e.stopPropagation(); onRemove(r.id); }}
              style={{
                background: "none", border: "none", cursor: "pointer",
                color: C.textMuted, fontSize: 12, padding: "0 2px",
                lineHeight: 1, marginLeft: 2,
              }}
              title="Remove from buffer"
            >
              ×
            </button>
          </div>
        );
      })}

      {/* Spacer */}
      <div style={{ flex: 1 }} />

      {/* Compare button */}
      <button
        onClick={onCompare}
        disabled={!canCompare}
        title={canCompare ? "Compare pinned models" : "Pin at least 2 models to compare"}
        style={{
          padding: "4px 12px", borderRadius: 3,
          border: `1px solid ${canCompare ? C.teal : C.border}`,
          background: canCompare ? `${C.teal}14` : "transparent",
          color: canCompare ? C.teal : C.textMuted,
          fontFamily: mono, fontSize: 10,
          letterSpacing: "0.1em", cursor: canCompare ? "pointer" : "not-allowed",
          transition: "all 0.12s", flexShrink: 0,
        }}
      >
        ⊞ Compare
      </button>
    </div>
  );
}
