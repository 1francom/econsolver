// ─── ECON STUDIO · components/wrangling/History.jsx ──────────────────────────
// Pipeline step sidebar. Shows ordered steps with remove buttons.
// Includes undo / redo controls powered by WranglingModule's snapshot stacks.
//
// Props:
//   pipeline        — step[]
//   onRm(i)         — remove step at index i
//   onClear()       — clear all steps
//   onUndo()        — revert to previous snapshot
//   onRedo()        — advance to next snapshot
//   canUndo         — boolean
//   canRedo         — boolean
//   pendingDelete   — { index, downstreamCount } | null
//   onConfirmDelete(mode) — "single" | "cascade"
//   onCancelDelete  — cancel pending delete

import { useTheme, mono, Lbl } from "./shared.jsx";

// ── Step type → accent color ──────────────────────────────────────────────────
const typeColor = C => ({
  recode:C.teal, quickclean:C.teal, winz:C.orange, log:C.blue, sq:C.blue,
  std:C.blue, drop:C.red, filter:C.yellow, ai_tr:C.purple, dummy:C.green,
  did:C.gold, lag:C.orange, lead:C.orange, diff:C.orange, ix:C.blue,
  date_parse:C.gold, date_extract:C.violet, join:C.teal, append:C.violet,
  mutate:C.green, pivot_longer:C.teal, group_summarize:C.orange,
  fill_na:C.yellow, fill_na_grouped:C.yellow,
  trim_outliers:C.red, flag_outliers:C.orange,
  extract_regex:C.violet, normalize_cats:C.teal, factor_interactions:C.blue,
  arrange:C.textMuted, type_cast:C.orange,
});

// ── Step type → short icon ────────────────────────────────────────────────────
const TYPE_ICON = {
  recode:"⬡", quickclean:"⚡", winz:"~", log:"ln", sq:"x²", std:"z",
  drop:"✕", filter:"⊧", ai_tr:"✦", dummy:"D", did:"×", lag:"L",
  lead:"F", diff:"Δ", ix:"×", rename:"↩", date_parse:"⟳", date_extract:"📅",
  join:"⊞", append:"⊕", mutate:"ƒ", pivot_longer:"⟲", group_summarize:"⊞",
  fill_na:"□", fill_na_grouped:"◈", trim_outliers:"✂", flag_outliers:"⚑",
  extract_regex:"rx", normalize_cats:"≈", factor_interactions:"×",
  arrange:"↕", type_cast:"T",
};

// ── Undo / Redo button ────────────────────────────────────────────────────────
function UndoBtn({ label, title, onClick, enabled }) {
  const { C } = useTheme();
  return (
    <button
      onClick={onClick}
      disabled={!enabled}
      title={title}
      style={{
        background: "transparent",
        border: "none",
        color: enabled ? C.textDim : C.textMuted,
        cursor: enabled ? "pointer" : "default",
        fontFamily: mono,
        fontSize: 13,
        padding: "1px 5px",
        borderRadius: 3,
        opacity: enabled ? 1 : 0.3,
        transition: "color 0.1s, opacity 0.1s",
        lineHeight: 1,
      }}
    >
      {label}
    </button>
  );
}

function History({ pipeline, onRm, onClear, onUndo, onRedo, canUndo, canRedo, branchPointIndex, onSetBranch, pendingDelete, onConfirmDelete, onCancelDelete }) {
  const { C } = useTheme();
  if (!pipeline.length && !canUndo && !canRedo) return null;

  return (
    <div style={{
      width: 230, flexShrink: 0,
      borderLeft: `1px solid ${C.border}`,
      background: C.surface,
      display: "flex", flexDirection: "column",
      overflow: "hidden",
    }}>
      {/* ── Header ── */}
      <div style={{
        padding: "0.75rem 1rem 0.5rem",
        borderBottom: `1px solid ${C.border}`,
        display: "flex", alignItems: "center", gap: 4, flexShrink: 0,
      }}>
        <Lbl mb={0} style={{ flex: 1 }}>Pipeline</Lbl>

        <UndoBtn label="↩" title="Undo last step" onClick={onUndo} enabled={canUndo} />
        <UndoBtn label="↪" title="Redo"            onClick={onRedo} enabled={canRedo} />

        <button
          onClick={onClear}
          disabled={pipeline.length === 0}
          title="Clear all pipeline steps"
          style={{
            marginLeft: 2,
            fontSize: 9, background: "transparent", border: "none",
            color: pipeline.length ? C.textMuted : C.border,
            cursor: pipeline.length ? "pointer" : "default",
            fontFamily: mono, padding: "2px 4px",
            opacity: pipeline.length ? 1 : 0.4,
          }}
        >
          clear all
        </button>
      </div>

      {/* ── Step list ── */}
      <div style={{ flex: 1, overflowY: "auto", padding: "0.6rem 1rem" }}>
        {branchPointIndex !== null && (
          <div style={{
            fontSize: 9, color: C.gold, fontFamily: mono, lineHeight: 1.6,
            padding: "4px 6px", marginBottom: 4,
            background: `${C.gold}0d`, borderRadius: 3, border: `1px solid ${C.gold}30`,
          }}>
            Shared: {branchPointIndex + 1} step{branchPointIndex !== 0 ? "s" : ""}<br/>
            Per-subset: {pipeline.length - branchPointIndex - 1} step{pipeline.length - branchPointIndex - 1 !== 1 ? "s" : ""}
          </div>
        )}
        {pipeline.length === 0 ? (
          <div style={{ fontSize: 9, color: C.textMuted, fontFamily: mono,
            textAlign: "center", paddingTop: "1rem", lineHeight: 1.8 }}>
            No steps yet.<br/>
            Add transformations<br/>in any tab.
          </div>
        ) : (
          <div style={{ display: "flex", flexDirection: "column", gap: 1 }}>
            {pipeline.map((s, i) => {
              const col = typeColor(C)[s.type] || C.textMuted;
              const ico = TYPE_ICON[s.type]  || "·";
              const isActiveBranch = branchPointIndex === i;

              // Deletion state roles
              const isTarget     = pendingDelete?.index === i;
              const isDownstream = pendingDelete != null && i > pendingDelete.index;
              const isBlocked    = pendingDelete != null && !isTarget;

              return (
                <div key={s.id || i}>
                  <div style={{
                    display: "flex", alignItems: "center", gap: 4,
                    padding: "0.35rem 0.5rem",
                    background: isTarget ? "#2a0a0a" : isDownstream ? "#1a1500" : C.surface2,
                    borderRadius: 3,
                    border: `1px solid ${isTarget ? C.red + "60" : isDownstream ? C.yellow + "50" : C.border}`,
                    borderLeft: `2px solid ${isTarget ? C.red : isDownstream ? C.yellow : col}`,
                    opacity: isBlocked && !isTarget && !isDownstream ? 0.45 : 1,
                    transition: "all 0.12s",
                  }}>
                    <span style={{
                      fontSize: 8, color: isTarget ? C.red : isDownstream ? C.yellow : C.textMuted,
                      fontFamily: mono, flexShrink: 0, minWidth: 12, textAlign: "right",
                    }}>
                      {i + 1}
                    </span>
                    <span style={{
                      fontSize: 8, color: isTarget ? C.red : isDownstream ? C.yellow : col,
                      fontFamily: mono, flexShrink: 0, minWidth: 14, textAlign: "center",
                    }}>
                      {isDownstream ? "!" : ico}
                    </span>
                    <span style={{
                      flex: 1, fontSize: 10,
                      color: isTarget ? C.red : isDownstream ? C.yellow : C.textDim,
                      fontFamily: mono,
                      overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap",
                      textDecoration: isTarget ? "line-through" : "none",
                    }}>
                      {s.desc || s.type}
                    </span>
                    <button
                      onClick={() => !isBlocked && onRm(i)}
                      title={isBlocked ? "Resolve pending delete first" : `Remove step ${i + 1}`}
                      style={{
                        background: "transparent", border: "none",
                        color: isTarget ? C.red : C.textMuted,
                        cursor: isBlocked ? "not-allowed" : "pointer",
                        fontSize: 11, padding: "0 2px", flexShrink: 0,
                        opacity: isBlocked && !isTarget ? 0.3 : 1,
                      }}
                    >
                      ×
                    </button>
                  </div>

                  {/* Inline confirmation UI — shown immediately below the target step */}
                  {isTarget && (
                    <div style={{
                      padding: "0.55rem 0.5rem",
                      background: "#1a0808",
                      border: `1px solid ${C.red}40`,
                      borderTop: "none",
                      borderRadius: "0 0 3px 3px",
                      marginBottom: 2,
                    }}>
                      <div style={{ fontSize: 9, color: C.red, fontFamily: mono, marginBottom: 6 }}>
                        {pendingDelete.downstreamCount} step{pendingDelete.downstreamCount > 1 ? "s" : ""} after this may be affected.
                      </div>
                      <div style={{ display: "flex", gap: 4, flexWrap: "wrap" }}>
                        <button
                          onClick={() => onConfirmDelete("single")}
                          style={{
                            padding: "0.25rem 0.6rem", background: "transparent",
                            border: `1px solid ${C.red}70`, borderRadius: 3,
                            color: C.red, cursor: "pointer", fontFamily: mono, fontSize: 9,
                          }}
                        >
                          Delete this step
                        </button>
                        <button
                          onClick={() => onConfirmDelete("cascade")}
                          style={{
                            padding: "0.25rem 0.6rem", background: "#2a0808",
                            border: `1px solid ${C.red}`, borderRadius: 3,
                            color: C.red, cursor: "pointer", fontFamily: mono, fontSize: 9,
                            fontWeight: 700,
                          }}
                        >
                          Delete + {pendingDelete.downstreamCount} after
                        </button>
                        <button
                          onClick={onCancelDelete}
                          style={{
                            padding: "0.25rem 0.6rem", background: "transparent",
                            border: `1px solid ${C.border2}`, borderRadius: 3,
                            color: C.textMuted, cursor: "pointer", fontFamily: mono, fontSize: 9,
                          }}
                        >
                          Cancel
                        </button>
                      </div>
                    </div>
                  )}
                  {/* Branch point marker — click to set/clear */}
                  <div
                    onClick={() => onSetBranch && onSetBranch(i)}
                    title={isActiveBranch ? "Click to remove branch point" : "Set branch point here"}
                    onMouseEnter={e => { e.currentTarget.style.opacity = "1"; }}
                    onMouseLeave={e => { e.currentTarget.style.opacity = isActiveBranch ? "1" : "0"; }}
                    style={{
                      display: "flex", alignItems: "center", gap: 4,
                      margin: "1px 0", cursor: "pointer", padding: "2px 4px",
                      borderRadius: 2, opacity: isActiveBranch ? 1 : 0,
                    }}
                  >
                    <div style={{ flex: 1, height: 1, background: isActiveBranch ? C.gold : "#555" }} />
                    <span style={{
                      fontSize: 8, color: isActiveBranch ? C.gold : "#888",
                      fontFamily: mono, letterSpacing: "0.1em", flexShrink: 0,
                    }}>
                      {isActiveBranch ? "⊣ branch" : "⊣"}
                    </span>
                    <div style={{ flex: 1, height: 1, background: isActiveBranch ? C.gold : "#555" }} />
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>

      {pipeline.length > 0 && (
        <div style={{
          padding: "0.4rem 1rem",
          borderTop: `1px solid ${C.border}`,
          fontSize: 9, color: C.textMuted, fontFamily: mono,
          flexShrink: 0,
        }}>
          {branchPointIndex !== null
            ? `${branchPointIndex + 1} shared · ${pipeline.length - branchPointIndex - 1} per-subset · IDB ✓`
            : `${pipeline.length} step${pipeline.length !== 1 ? "s" : ""} · IDB ✓`
          }
        </div>
      )}
    </div>
  );
}

export default History;
