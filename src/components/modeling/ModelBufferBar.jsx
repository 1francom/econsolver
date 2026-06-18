// ─── ECON STUDIO · components/modeling/ModelBufferBar.jsx ────────────────────
// Horizontal strip of pinned models at the bottom of the results panel.
//
// Props:
//   models         EstimationResult[]  — from modelBuffer.getAll()
//   activeId       string | null       — currently displayed result id
//   onRestore(id)                      — click a card → restore it as active
//   onRemove(id)                       — X → remove from buffer
//   onCompare()                        — opens comparison panel (enabled when 2+)

import { useState } from "react";
import { useTheme } from "./shared.jsx";

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

const typeColor = C => ({
  OLS: C.green,
  WLS: C.green,
  FE: C.blue,
  FD: C.blue,
  "2SLS": C.purple,
  DiD: C.gold,
  TWFE: C.gold,
  RDD: C.orange,
  Logit: C.violet,
  Probit: C.violet,
});

export default function ModelBufferBar({ models, activeId, datasetNames = {}, currentDatasetId, onRestore, onRemove, onRename, onReorder, onSwitchDataset, onCompare }) {
  const { C, T } = useTheme();
  const [editId, setEditId] = useState(null);
  const [editVal, setEditVal] = useState("");
  if (!models?.length) return null;

  const canCompare = models.length >= 2;
  const move = (i, dir) => {
    const j = i + dir;
    if (j < 0 || j >= models.length) return;
    const ids = models.map(m => m.id);
    [ids[i], ids[j]] = [ids[j], ids[i]];
    onReorder?.(ids);
  };

  return (
    <div style={{
      borderTop: `1px solid ${C.border}`,
      background: C.surface,
      padding: "0.55rem 1rem",
      display: "flex", alignItems: "center", gap: 8,
      flexWrap: "wrap",
    }}>
      {/* Label */}
      <div style={{ fontSize: T.caption.fontSize, color: C.textMuted, letterSpacing: "0.2em", textTransform: "uppercase", flexShrink: 0 }}>
        Pinned
      </div>

      {/* Model cards */}
      {models.map((r, i) => {
        const isActive = r.id === activeId;
        const clr = typeColor(C)[r.type] ?? C.teal;
        const stat = keyStatLabel(r);
        const label = r.label ?? r.type ?? "Model";
        const n = r.n ?? "?";
        const dsId = r.datasetId;
        const dsName = datasetNames[dsId];
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
              cursor: "pointer", transition: "all 0.12s",
            }}
          >
            <button onClick={e => { e.stopPropagation(); move(i, -1); }} title="Move left"
              style={{ background: "none", border: "none", color: C.textMuted, cursor: "pointer", fontSize: T.caption.fontSize, padding: 0, lineHeight: 1 }}>◀</button>
            {editId === r.id ? (
              <input
                autoFocus value={editVal}
                onClick={e => e.stopPropagation()}
                onChange={e => setEditVal(e.target.value)}
                onBlur={() => { onRename?.(r.id, editVal.trim() || label); setEditId(null); }}
                onKeyDown={e => { if (e.key === "Enter") e.currentTarget.blur(); if (e.key === "Escape") setEditId(null); }}
                style={{ width: 90, background: C.surface2, border: `1px solid ${clr}`, borderRadius: 3, color: C.text, fontFamily: T.code.fontFamily, fontSize: T.caption.fontSize, padding: "1px 4px" }}
              />
            ) : (
              <span
                onDoubleClick={e => { e.stopPropagation(); setEditId(r.id); setEditVal(label); }}
                title="Double-click to rename"
                style={{ fontSize: T.caption.fontSize, color: clr, fontFamily: T.code.fontFamily, letterSpacing: "0.05em" }}>
                {label}
              </span>
            )}
            <span style={{ fontSize: T.caption.fontSize, color: C.textDim, fontFamily: T.code.fontFamily }}>
              ·n={n}{stat ? `·${stat}` : ""}
            </span>
            {dsName && dsId !== currentDatasetId && (
              <button onClick={e => { e.stopPropagation(); onSwitchDataset?.(dsId); }} title={`Switch to ${dsName}`}
                style={{ background: `${C.blue}18`, border: `1px solid ${C.blue}55`, borderRadius: 3, color: C.blue, cursor: "pointer", fontFamily: T.code.fontFamily, fontSize: T.caption.fontSize, padding: "0 4px", lineHeight: 1.4 }}>
                ⇄ {dsName}
              </button>
            )}
            <button onClick={e => { e.stopPropagation(); move(i, 1); }} title="Move right"
              style={{ background: "none", border: "none", color: C.textMuted, cursor: "pointer", fontSize: T.caption.fontSize, padding: 0, lineHeight: 1 }}>▶</button>
            <button onClick={e => { e.stopPropagation(); onRemove(r.id); }} title="Remove from buffer"
              style={{ background: "none", border: "none", cursor: "pointer", color: C.textMuted, fontSize: T.code.fontSize, padding: "0 2px", lineHeight: 1, marginLeft: 2 }}>×</button>
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
          fontFamily: T.code.fontFamily, fontSize: T.caption.fontSize,
          letterSpacing: "0.1em", cursor: canCompare ? "pointer" : "not-allowed",
          transition: "all 0.12s", flexShrink: 0,
        }}
      >
        ⊞ Compare
      </button>
    </div>
  );
}
