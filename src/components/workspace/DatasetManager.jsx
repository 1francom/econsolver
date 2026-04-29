// ─── ECON STUDIO · DatasetManager.jsx ────────────────────────────────────────
// Collapsible dataset registry panel rendered inside the WorkspaceBar.
// A compact button shows dataset count at all times; clicking opens a dropdown
// listing all session datasets with metadata and the active indicator.
// Reads from sessionState — mounted inside SessionStateProvider.

import { useState, useRef, useEffect } from "react";
import { useSessionState, useSessionDispatch } from "../../services/session/sessionState.jsx";

const C = {
  bg:"#080808", surface:"#0f0f0f", surface2:"#131313", surface3:"#161616",
  border:"#1c1c1c", border2:"#252525",
  gold:"#c8a96e", goldDim:"#7a6040",
  text:"#ddd8cc", textDim:"#888", textMuted:"#444",
  green:"#7ab896", teal:"#6ec8b4", violet:"#9e7ec8",
};
const mono = "'IBM Plex Mono','JetBrains Mono',Consolas,monospace";

export default function DatasetManager({ activeDatasetId, onSelectDataset }) {
  const { datasets, primaryDatasetId, globalPipeline } = useSessionState();
  const dispatch = useSessionDispatch();
  const [open, setOpen] = useState(false);
  const [interactionsOpen, setInteractionsOpen] = useState(true);
  const [pendingGDelete, setPendingGDelete] = useState(null); // { step } | null
  const ref = useRef();

  // Close on outside click
  useEffect(() => {
    if (!open) return;
    function handler(e) {
      if (ref.current && !ref.current.contains(e.target)) setOpen(false);
    }
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [open]);

  const list   = Object.values(datasets);
  const count  = list.length;
  const active = activeDatasetId ?? primaryDatasetId;
  const primary = datasets[active];

  return (
    <div ref={ref} style={{ position: "relative", flexShrink: 0 }}>

      {/* ── Trigger button ─────────────────────────────────────────────── */}
      <button
        onClick={() => setOpen(o => !o)}
        title="Dataset Manager"
        style={{
          display: "flex",
          alignItems: "center",
          gap: 5,
          padding: "0 0.75rem",
          height: "100%",
          background: open ? C.bg : "transparent",
          border: "none",
          borderRight: `1px solid ${C.border}`,
          borderBottom: open ? `2px solid ${C.gold}` : "2px solid transparent",
          borderTop: "2px solid transparent",
          color: open ? C.gold : C.textDim,
          cursor: "pointer",
          fontFamily: mono,
          fontSize: 10,
          letterSpacing: "0.06em",
          transition: "color 0.12s, background 0.12s",
          whiteSpace: "nowrap",
        }}
        onMouseEnter={e => { if (!open) e.currentTarget.style.color = C.text; }}
        onMouseLeave={e => { if (!open) e.currentTarget.style.color = C.textDim; }}
      >
        {/* Dataset count badge */}
        <span style={{
          fontSize: 8,
          padding: "1px 5px",
          background: open ? `${C.gold}20` : `${C.teal}18`,
          border: `1px solid ${open ? C.goldDim : C.teal + "50"}`,
          borderRadius: 2,
          color: open ? C.gold : C.teal,
          fontWeight: 600,
          letterSpacing: "0.04em",
        }}>
          D·{count || 0}
        </span>

        {/* Primary dataset name (truncated) */}
        {primary && (
          <span style={{
            maxWidth: 120,
            overflow: "hidden",
            textOverflow: "ellipsis",
            color: open ? C.gold : C.textDim,
            fontSize: 10,
          }}>
            {primary.name}
          </span>
        )}

        <span style={{ fontSize: 8, color: open ? C.gold : C.textMuted }}>
          {open ? "▲" : "▼"}
        </span>
      </button>

      {/* ── Dropdown panel ─────────────────────────────────────────────── */}
      {open && (
        <div style={{
          position: "absolute",
          top: "100%",
          left: 0,
          zIndex: 200,
          width: 260,
          background: C.surface,
          border: `1px solid ${C.border2}`,
          borderTop: `2px solid ${C.gold}`,
          borderRadius: "0 0 4px 4px",
          boxShadow: "0 8px 24px #00000080",
          fontFamily: mono,
          overflow: "hidden",
        }}>

          {/* Header */}
          <div style={{
            padding: "0.55rem 0.85rem",
            borderBottom: `1px solid ${C.border}`,
            display: "flex",
            justifyContent: "space-between",
            alignItems: "center",
          }}>
            <span style={{ fontSize: 9, color: C.gold, letterSpacing: "0.2em", textTransform: "uppercase" }}>
              Dataset Manager
            </span>
            <span style={{ fontSize: 9, color: C.textMuted }}>
              {count} loaded
            </span>
          </div>

          {/* Dataset list */}
          <div style={{ maxHeight: 280, overflowY: "auto" }}>
            {count === 0 && (
              <div style={{ padding: "1rem 0.85rem", fontSize: 10, color: C.textMuted }}>
                No datasets in session.
              </div>
            )}
            {list.map(ds => {
              const isActive = ds.id === active;
              const isDerived = ds.source === "derived";
              return (
                <div
                  key={ds.id}
                  onClick={() => { onSelectDataset?.(ds.id); setOpen(false); }}
                  style={{
                    display: "flex",
                    alignItems: "center",
                    gap: 8,
                    padding: "0.5rem 0.85rem",
                    borderBottom: `1px solid ${C.border}`,
                    background: isActive ? `${C.teal}0a` : "transparent",
                    cursor: onSelectDataset ? "pointer" : "default",
                    transition: "background 0.1s",
                  }}
                  onMouseEnter={e => { if (!isActive) e.currentTarget.style.background = C.surface2; }}
                  onMouseLeave={e => { if (!isActive) e.currentTarget.style.background = isActive ? `${C.teal}0a` : "transparent"; }}
                >
                  {/* Source indicator */}
                  <span style={{
                    fontSize: 10,
                    color: isDerived ? C.violet : C.teal,
                    flexShrink: 0,
                  }}>
                    {isDerived ? "◎" : "●"}
                  </span>

                  {/* Name + meta */}
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{
                      fontSize: 11,
                      color: isActive ? C.teal : C.textDim,
                      fontWeight: isActive ? 600 : 400,
                      overflow: "hidden",
                      textOverflow: "ellipsis",
                      whiteSpace: "nowrap",
                    }}>
                      {ds.name}
                    </div>
                    <div style={{ fontSize: 9, color: C.textMuted, marginTop: 1 }}>
                      {ds.rowCount?.toLocaleString()} × {ds.colCount}
                      {ds.source && ds.source !== "loaded" && (
                        <span style={{ color: C.violet, marginLeft: 6 }}>{ds.source}</span>
                      )}
                    </div>
                  </div>

                  {/* Active badge */}
                  {isActive && (
                    <span style={{
                      fontSize: 8,
                      padding: "1px 5px",
                      border: `1px solid ${C.teal}50`,
                      borderRadius: 2,
                      color: C.teal,
                      flexShrink: 0,
                    }}>
                      active
                    </span>
                  )}
                </div>
              );
            })}
          </div>

          {/* ── Interaction log (global pipeline G-steps) ── */}
          <div style={{ borderTop: `1px solid ${C.border}` }}>
            <button
              onClick={() => setInteractionsOpen(o => !o)}
              style={{
                width: "100%",
                display: "flex",
                alignItems: "center",
                justifyContent: "space-between",
                padding: "0.4rem 0.85rem",
                background: "transparent",
                border: "none",
                cursor: "pointer",
                fontFamily: mono,
              }}
            >
              <span style={{ fontSize: 9, color: C.textMuted, letterSpacing: "0.14em", textTransform: "uppercase" }}>
                Interactions
              </span>
              <span style={{ fontSize: 8, color: C.textMuted }}>
                {globalPipeline.length > 0 ? `${globalPipeline.length} step${globalPipeline.length > 1 ? "s" : ""}` : "none"}
                {" "}{interactionsOpen ? "▲" : "▼"}
              </span>
            </button>

            {interactionsOpen && (
              <div style={{ maxHeight: 120, overflowY: "auto" }}>
                {globalPipeline.length === 0 && (
                  <div style={{ padding: "0.35rem 0.85rem 0.55rem", fontSize: 9, color: C.border2, fontFamily: mono }}>
                    No cross-dataset operations yet.
                  </div>
                )}
                {globalPipeline.map((g, i) => {
                  const leftName  = datasets[g.leftDatasetId]?.name  ?? g.leftDatasetId;
                  const rightName = datasets[g.rightDatasetId]?.name ?? g.rightDatasetId ?? "?";
                  return (
                    <div key={g.id}>
                      {/* G-step row */}
                      <div style={{
                        display: "flex",
                        alignItems: "center",
                        gap: 6,
                        padding: "0.3rem 0.85rem",
                        borderTop: `1px solid ${C.border}`,
                        fontFamily: mono,
                        background: pendingGDelete?.step.id === g.id ? "#1a0808" : "transparent",
                      }}>
                        {/* G-step index badge */}
                        <span style={{
                          fontSize: 8, padding: "1px 4px",
                          border: `1px solid ${C.border2}`,
                          borderRadius: 2, color: C.textMuted,
                          flexShrink: 0,
                        }}>
                          G{i + 1}
                        </span>

                        {/* Step description */}
                        <span style={{ fontSize: 9, color: C.textDim, flex: 1, minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                          <span style={{ color: C.teal }}>{g.opType}</span>
                          {" "}
                          <span style={{ color: C.textMuted }}>
                            {leftName} ← {rightName}
                            {g.params?.leftKey ? ` on ${g.params.leftKey}` : ""}
                          </span>
                        </span>

                        {/* Remove G-step — requires confirmation */}
                        <button
                          onClick={() => setPendingGDelete(pendingGDelete?.step.id === g.id ? null : { step: g })}
                          title="Remove interaction"
                          style={{
                            background: "transparent", border: "none",
                            color: pendingGDelete?.step.id === g.id ? "#c47070" : C.textMuted,
                            cursor: "pointer",
                            fontSize: 11, padding: "0 2px", flexShrink: 0,
                            fontFamily: mono, lineHeight: 1,
                          }}
                          onMouseEnter={e => e.currentTarget.style.color = "#c47070"}
                          onMouseLeave={e => {
                            if (pendingGDelete?.step.id !== g.id)
                              e.currentTarget.style.color = C.textMuted;
                          }}
                        >×</button>
                      </div>

                      {/* Inline G-step deletion confirmation */}
                      {pendingGDelete?.step.id === g.id && (
                        <div style={{
                          padding: "0.45rem 0.85rem",
                          background: "#1a0808",
                          borderBottom: `1px solid ${C.border}`,
                          fontFamily: mono,
                        }}>
                          <div style={{ fontSize: 9, color: "#c47070", marginBottom: 6 }}>
                            Remove from registry? Local pipeline steps are unaffected.
                          </div>
                          <div style={{ display: "flex", gap: 6 }}>
                            <button
                              onClick={() => {
                                dispatch({ type: "REMOVE_GLOBAL_STEP", id: g.id });
                                setPendingGDelete(null);
                              }}
                              style={{
                                padding: "0.22rem 0.6rem", background: "#2a0808",
                                border: "1px solid #c47070", borderRadius: 3,
                                color: "#c47070", cursor: "pointer",
                                fontFamily: mono, fontSize: 9, fontWeight: 700,
                              }}
                            >Remove</button>
                            <button
                              onClick={() => setPendingGDelete(null)}
                              style={{
                                padding: "0.22rem 0.6rem", background: "transparent",
                                border: `1px solid ${C.border2}`, borderRadius: 3,
                                color: C.textMuted, cursor: "pointer",
                                fontFamily: mono, fontSize: 9,
                              }}
                            >Cancel</button>
                          </div>
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
