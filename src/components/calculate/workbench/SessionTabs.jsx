import { useState, useRef } from "react";
import { useTheme } from "../../../ThemeContext.jsx";


// Top bar: switch / add / rename (double-click) / close sessions.
export default function SessionTabs({ sessions, activeId, onSelect, onAdd, onRename, onClose }) {
  const { C, T } = useTheme();
  const [editingId, setEditingId] = useState(null);
  const [draft, setDraft] = useState("");
  const committedRef = useRef(false);

  function startRename(s) { committedRef.current = false; setEditingId(s.id); setDraft(s.name); }
  function commitRename() {
    if (committedRef.current) return;
    committedRef.current = true;
    if (editingId && draft.trim()) onRename(editingId, draft.trim().slice(0, 40));
    setEditingId(null);
  }
  function cancelRename() {
    committedRef.current = true; // block the trailing blur from committing
    setEditingId(null);
  }

  return (
    <div style={{ display: "flex", alignItems: "center", gap: 6, flexWrap: "wrap", marginBottom: 14 }}>
      {sessions.map((s) => {
        const active = s.id === activeId;
        return (
          <div key={s.id}
            onClick={() => onSelect(s.id)}
            onDoubleClick={() => startRename(s)}
            style={{
              display: "flex", alignItems: "center", gap: 6, cursor: "pointer",
              padding: "5px 10px", borderRadius: 6, fontFamily: T.code.fontFamily, fontSize: T.code.fontSize,
              background: active ? C.teal + "22" : "transparent",
              border: `1px solid ${active ? C.teal : C.border2}`,
              color: active ? C.teal : C.textDim,
            }}>
            {editingId === s.id ? (
              <input autoFocus value={draft}
                onChange={(e) => setDraft(e.target.value)}
                onBlur={commitRename}
                onKeyDown={(e) => { if (e.key === "Enter") commitRename(); if (e.key === "Escape") cancelRename(); }}
                style={{ background: C.bg, color: C.text, border: `1px solid ${C.teal}`, fontFamily: T.code.fontFamily, fontSize: T.code.fontSize, width: 90, padding: "2px 4px" }} />
            ) : (
              <span>{s.name}</span>
            )}
            {sessions.length > 1 && (
              <span onClick={(e) => { e.stopPropagation(); onClose(s.id); }}
                style={{ color: C.red || "#c86e6e", fontSize: T.body.fontSize, lineHeight: 1 }}>×</span>
            )}
          </div>
        );
      })}
      <button onClick={onAdd}
        style={{ padding: "5px 10px", borderRadius: 6, fontFamily: T.code.fontFamily, fontSize: T.code.fontSize,
          background: "transparent", border: `1px dashed ${C.gold}`, color: C.gold, cursor: "pointer" }}>
        + Session
      </button>
    </div>
  );
}
