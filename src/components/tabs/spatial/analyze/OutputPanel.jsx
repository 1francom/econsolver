// ─── ECON STUDIO · spatial/analyze/OutputPanel.jsx ─ (moved verbatim from SpatialTab.jsx)
import { useState } from "react";
import { mono } from "../shared/constants.js";
import { SaveBtn } from "../shared/atoms.jsx";

export function OutputPanel({ pendingRows, pendingCols, onSave, C }) {
  const [name, setName] = useState("spatial_result");

  if (!pendingRows) return null;
  return (
    <div style={{
      padding: "0.8rem 1rem",
      border: `1px solid ${C.teal}40`,
      borderRadius: 4,
      background: `${C.teal}08`,
      display: "flex", flexDirection: "column", gap: 8,
    }}>
      <span style={{ fontSize: 10, color: C.teal }}>
        Ready — {pendingRows.length} rows · new col{pendingCols.length > 1 ? "s" : ""}: <strong>{pendingCols.join(", ")}</strong>
      </span>
      <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
        <input
          value={name} onChange={e => setName(e.target.value)}
          placeholder="dataset name"
          style={{
            padding: "3px 8px", background: C.surface, border: `1px solid ${C.border2}`,
            borderRadius: 3, color: C.text, fontFamily: mono, fontSize: 10, outline: "none", width: 160,
          }}
        />
        <SaveBtn onClick={() => onSave(name, pendingRows)} disabled={!name} C={C} />
      </div>
    </div>
  );
}

// ─── PLOT TAB ─────────────────────────────────────────────────────────────────

// Compact color + opacity/width row used in layer editors
