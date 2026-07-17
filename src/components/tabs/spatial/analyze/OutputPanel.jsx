// ─── ECON STUDIO · spatial/analyze/OutputPanel.jsx ─ (moved verbatim from SpatialTab.jsx)
import { useState } from "react";
import { useTheme } from "../../../../ThemeContext.jsx";
import { SaveBtn } from "../shared/atoms.jsx";

export function OutputPanel({ pendingRows, pendingCols, pendingStep, onSave, onAddStep, C }) {
  const { T } = useTheme();
  const [name, setName] = useState("spatial_result");

  if (!pendingRows) return null;
  const isStep = pendingStep?.kind === "step";
  return (
    <div style={{
      padding: "0.8rem 1rem",
      border: `1px solid ${C.teal}40`,
      borderRadius: 4,
      background: `${C.teal}08`,
      display: "flex", flexDirection: "column", gap: 8,
    }}>
      <span style={{ fontSize: T.caption.fontSize, color: C.teal }}>
        Ready — {pendingRows.length} rows · new col{pendingCols.length > 1 ? "s" : ""}: <strong>{pendingCols.join(", ")}</strong>
      </span>
      {isStep ? (
        <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
          <button
            onClick={onAddStep}
            style={{
              padding: "4px 14px", borderRadius: 3, cursor: "pointer",
              background: `${C.teal}18`, border: `1px solid ${C.teal}`,
              color: C.teal, fontFamily: T.code.fontFamily, fontSize: T.caption.fontSize,
            }}
          >➕ Add to pipeline</button>
          <span style={{ fontSize: T.caption.fontSize, color: C.textMuted }}>
            Appends a replayable step to this dataset's Clean pipeline (undo in History).
          </span>
        </div>
      ) : (
        <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
          <input
            value={name} onChange={e => setName(e.target.value)}
            placeholder="dataset name"
            style={{
              padding: "3px 8px", background: C.surface, border: `1px solid ${C.border2}`,
              borderRadius: 3, color: C.text, fontFamily: T.code.fontFamily, fontSize: T.caption.fontSize, outline: "none", width: 160,
            }}
          />
          <SaveBtn onClick={() => onSave(name, pendingRows)} disabled={!name} C={C} />
          {pendingStep?.kind === "dataset" && (
            <span style={{ fontSize: T.caption.fontSize, color: C.textMuted }}>
              Saves as a new dataset with its derivation recipe recorded.
            </span>
          )}
        </div>
      )}
    </div>
  );
}

// ─── PLOT TAB ─────────────────────────────────────────────────────────────────

// Compact color + opacity/width row used in layer editors
