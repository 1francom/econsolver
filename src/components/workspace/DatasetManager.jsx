// ─── ECON STUDIO · DatasetManager.jsx ────────────────────────────────────────
// Collapsible dataset registry panel rendered inside the WorkspaceBar.
// A compact button shows dataset count at all times; clicking opens a dropdown
// listing all session datasets with metadata and the active indicator.
// Reads from sessionState — mounted inside SessionStateProvider.

import { useState, useRef, useEffect } from "react";
import { useSessionState, useSessionDispatch } from "../../services/session/sessionState.jsx";
import { useTheme } from "../../ThemeContext.jsx";

const mono = "'IBM Plex Mono','JetBrains Mono',Consolas,monospace";

// ─── CASCADE HELPERS ──────────────────────────────────────────────────────────
// Given a root G-step, BFS to find all downstream G-steps and derived datasets.
function computeGStepCascade(rootStep, allSteps) {
  const gStepIds  = new Set([rootStep.id]);
  const datasetIds = new Set([rootStep.outputDatasetId].filter(Boolean));

  let changed = true;
  while (changed) {
    changed = false;
    for (const s of allSteps) {
      if (gStepIds.has(s.id)) continue;
      if ([s.leftDatasetId, s.rightDatasetId].some(d => d && datasetIds.has(d))) {
        gStepIds.add(s.id);
        if (s.outputDatasetId) datasetIds.add(s.outputDatasetId);
        changed = true;
      }
    }
  }

  return { gStepIds: [...gStepIds], datasetIds: [...datasetIds] };
}

// Given a source dataset ID, BFS to find all G-steps + datasets in the cascade.
function computeDatasetCascade(dsId, allSteps) {
  const rootSteps  = allSteps.filter(s => s.leftDatasetId === dsId || s.rightDatasetId === dsId);
  const gStepIds   = new Set(rootSteps.map(s => s.id));
  const datasetIds = new Set([dsId, ...rootSteps.map(s => s.outputDatasetId).filter(Boolean)]);

  let changed = true;
  while (changed) {
    changed = false;
    for (const s of allSteps) {
      if (gStepIds.has(s.id)) continue;
      if ([s.leftDatasetId, s.rightDatasetId].some(d => d && datasetIds.has(d))) {
        gStepIds.add(s.id);
        if (s.outputDatasetId) datasetIds.add(s.outputDatasetId);
        changed = true;
      }
    }
  }

  // Remove the source dataset itself from the cascade dataset list
  // (it's tracked separately as the deleted item)
  datasetIds.delete(dsId);
  return { gStepIds: [...gStepIds], datasetIds: [...datasetIds] };
}

// ─── CASCADE CONFIRM DIALOG ───────────────────────────────────────────────────
// Inline panel shown below a G-step row or a dataset row when deletion is pending.
function CascadeConfirm({ cascade, datasets, globalPipeline, label, onSaveSnapshot, onDeleteAll, onCancel, C }) {
  const { gStepIds, datasetIds } = cascade;

  const affectedStepLabels = gStepIds.map(id => {
    const idx = globalPipeline.findIndex(s => s.id === id);
    const s   = globalPipeline.find(s => s.id === id);
    return `G${idx + 1} ${s?.opType ?? ""}`;
  });

  const affectedDsNames = datasetIds.map(id => datasets[id]?.name ?? id);

  return (
    <div style={{
      padding: "0.5rem 0.85rem",
      background: "#130808",
      borderBottom: `1px solid ${C.border}`,
      fontFamily: mono,
    }}>
      <div style={{ fontSize: 9, color: "#c47070", fontWeight: 700, marginBottom: 4 }}>
        {label}
      </div>

      {affectedStepLabels.length > 0 && (
        <div style={{ marginBottom: 4 }}>
          <div style={{ fontSize: 8, color: C.textMuted, letterSpacing: "0.1em", marginBottom: 2 }}>
            INTERACTIONS REMOVED
          </div>
          {affectedStepLabels.map(l => (
            <div key={l} style={{ fontSize: 9, color: "#c47070", paddingLeft: 4 }}>— {l}</div>
          ))}
        </div>
      )}

      {affectedDsNames.length > 0 && (
        <div style={{ marginBottom: 8 }}>
          <div style={{ fontSize: 8, color: C.textMuted, letterSpacing: "0.1em", marginBottom: 2 }}>
            DERIVED DATASETS REMOVED
          </div>
          {affectedDsNames.map(n => (
            <div key={n} style={{ fontSize: 9, color: "#c47070", paddingLeft: 4 }}>— {n}</div>
          ))}
        </div>
      )}

      <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
        {onSaveSnapshot && affectedDsNames.length > 0 && (
          <button
            onClick={onSaveSnapshot}
            style={{
              padding: "0.22rem 0.6rem",
              background: "#0a1a10",
              border: `1px solid ${C.teal}80`,
              borderRadius: 3,
              color: C.teal,
              cursor: "pointer",
              fontFamily: mono, fontSize: 9, fontWeight: 700,
            }}
          >Save snapshot first</button>
        )}
        <button
          onClick={onDeleteAll}
          style={{
            padding: "0.22rem 0.6rem",
            background: "#2a0808",
            border: "1px solid #c47070",
            borderRadius: 3,
            color: "#c47070",
            cursor: "pointer",
            fontFamily: mono, fontSize: 9, fontWeight: 700,
          }}
        >Delete cascade</button>
        <button
          onClick={onCancel}
          style={{
            padding: "0.22rem 0.6rem",
            background: "transparent",
            border: `1px solid ${C.border2}`,
            borderRadius: 3,
            color: C.textMuted,
            cursor: "pointer",
            fontFamily: mono, fontSize: 9,
          }}
        >Cancel</button>
      </div>
    </div>
  );
}

// ─── MAIN COMPONENT ───────────────────────────────────────────────────────────
export default function DatasetManager({ activeDatasetId, onSelectDataset }) {
  const { C } = useTheme();
  const { datasets, primaryDatasetId, globalPipeline } = useSessionState();
  const dispatch = useSessionDispatch();
  const [open, setOpen] = useState(false);
  const [interactionsOpen, setInteractionsOpen] = useState(true);
  // pendingDelete: { kind: "gstep"|"dataset", id, cascade } | null
  const [pendingDelete, setPendingDelete] = useState(null);
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

  const list    = Object.values(datasets);
  const count   = list.length;
  const active  = activeDatasetId ?? primaryDatasetId;
  const primary = datasets[active];

  // ── Dispatch helpers ────────────────────────────────────────────────────────
  function execCascade({ gStepIds, datasetIds }) {
    gStepIds.forEach(id  => dispatch({ type: "REMOVE_GLOBAL_STEP", id }));
    datasetIds.forEach(id => dispatch({ type: "REMOVE_DATASET",     id }));
  }

  function execSaveSnapshot({ gStepIds, datasetIds }) {
    // Promote derived datasets to 'loaded' (snapshot preserved)
    datasetIds.forEach(id => dispatch({ type: "UPDATE_DATASET_META", id, patch: { source: "loaded" } }));
    // Remove only G-steps
    gStepIds.forEach(id => dispatch({ type: "REMOVE_GLOBAL_STEP", id }));
  }

  // ── G-step deletion initiator ───────────────────────────────────────────────
  function initiateGStepDelete(step) {
    if (pendingDelete?.id === step.id) { setPendingDelete(null); return; }
    const cascade = computeGStepCascade(step, globalPipeline);
    setPendingDelete({ kind: "gstep", id: step.id, cascade });
  }

  // ── Dataset deletion initiator ──────────────────────────────────────────────
  function initiateDatasetDelete(e, ds) {
    e.stopPropagation();
    if (pendingDelete?.id === ds.id) { setPendingDelete(null); return; }
    const cascade = computeDatasetCascade(ds.id, globalPipeline);
    setPendingDelete({ kind: "dataset", id: ds.id, cascade });
  }

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
          width: 280,
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
            <span style={{ fontSize: 9, color: C.textMuted }}>{count} loaded</span>
          </div>

          {/* Dataset list */}
          <div style={{ maxHeight: 280, overflowY: "auto" }}>
            {count === 0 && (
              <div style={{ padding: "1rem 0.85rem", fontSize: 10, color: C.textMuted }}>
                No datasets in session.
              </div>
            )}
            {list.map(ds => {
              const isActive  = ds.id === active;
              const isDerived = ds.source === "derived";
              const isDelPending = pendingDelete?.id === ds.id;

              return (
                <div key={ds.id}>
                  {/* Dataset row */}
                  <div
                    onClick={() => { if (!isDelPending) { onSelectDataset?.(ds.id); setOpen(false); } }}
                    style={{
                      display: "flex",
                      alignItems: "center",
                      gap: 8,
                      padding: "0.5rem 0.85rem",
                      borderBottom: `1px solid ${C.border}`,
                      background: isDelPending ? "#130808" : isActive ? `${C.teal}0a` : "transparent",
                      cursor: onSelectDataset ? "pointer" : "default",
                      transition: "background 0.1s",
                    }}
                    onMouseEnter={e => { if (!isActive && !isDelPending) e.currentTarget.style.background = C.surface2; }}
                    onMouseLeave={e => { if (!isActive && !isDelPending) e.currentTarget.style.background = "transparent"; }}
                  >
                    <span style={{ fontSize: 10, color: isDerived ? C.violet : C.teal, flexShrink: 0 }}>
                      {isDerived ? "◎" : "●"}
                    </span>

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

                    {/* Delete button */}
                    <button
                      onClick={e => initiateDatasetDelete(e, ds)}
                      title="Remove dataset"
                      style={{
                        background: "transparent", border: "none",
                        color: isDelPending ? "#c47070" : C.textMuted,
                        cursor: "pointer",
                        fontSize: 13, padding: "0 2px", flexShrink: 0,
                        fontFamily: mono, lineHeight: 1,
                      }}
                      onMouseEnter={e => { e.stopPropagation(); e.currentTarget.style.color = "#c47070"; }}
                      onMouseLeave={e => {
                        e.stopPropagation();
                        if (pendingDelete?.id !== ds.id) e.currentTarget.style.color = C.textMuted;
                      }}
                    >×</button>
                  </div>

                  {/* Cascade confirm for dataset */}
                  {isDelPending && (
                    <CascadeConfirm
                      cascade={pendingDelete.cascade}
                      datasets={datasets}
                      globalPipeline={globalPipeline}
                      label={`Remove "${ds.name}" and all dependents?`}
                      C={C}
                      onSaveSnapshot={() => {
                        const { gStepIds, datasetIds } = pendingDelete.cascade;
                        execSaveSnapshot({ gStepIds, datasetIds });
                        dispatch({ type: "REMOVE_DATASET", id: ds.id });
                        setPendingDelete(null);
                      }}
                      onDeleteAll={() => {
                        const { gStepIds, datasetIds } = pendingDelete.cascade;
                        execCascade({ gStepIds, datasetIds });
                        dispatch({ type: "REMOVE_DATASET", id: ds.id });
                        setPendingDelete(null);
                      }}
                      onCancel={() => setPendingDelete(null)}
                    />
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
                {globalPipeline.length > 0
                  ? `${globalPipeline.length} step${globalPipeline.length > 1 ? "s" : ""}`
                  : "none"}
                {" "}{interactionsOpen ? "▲" : "▼"}
              </span>
            </button>

            {interactionsOpen && (
              <div style={{ maxHeight: 200, overflowY: "auto" }}>
                {globalPipeline.length === 0 && (
                  <div style={{ padding: "0.35rem 0.85rem 0.55rem", fontSize: 9, color: C.border2, fontFamily: mono }}>
                    No cross-dataset operations yet.
                  </div>
                )}
                {globalPipeline.map((g, i) => {
                  const leftName   = datasets[g.leftDatasetId]?.name  ?? g.leftDatasetId;
                  const rightName  = datasets[g.rightDatasetId]?.name ?? g.rightDatasetId ?? "?";
                  const isDelPending = pendingDelete?.id === g.id;

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
                        background: isDelPending ? "#130808" : "transparent",
                      }}>
                        <span style={{
                          fontSize: 8, padding: "1px 4px",
                          border: `1px solid ${C.border2}`,
                          borderRadius: 2, color: C.textMuted,
                          flexShrink: 0,
                        }}>
                          G{i + 1}
                        </span>

                        <span style={{
                          fontSize: 9, color: C.textDim, flex: 1, minWidth: 0,
                          overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap",
                        }}>
                          <span style={{ color: C.teal }}>{g.opType}</span>
                          {" "}
                          <span style={{ color: C.textMuted }}>
                            {leftName} ← {rightName}
                            {g.params?.leftKey ? ` on ${g.params.leftKey}` : ""}
                          </span>
                        </span>

                        <button
                          onClick={() => initiateGStepDelete(g)}
                          title="Remove interaction"
                          style={{
                            background: "transparent", border: "none",
                            color: isDelPending ? "#c47070" : C.textMuted,
                            cursor: "pointer",
                            fontSize: 11, padding: "0 2px", flexShrink: 0,
                            fontFamily: mono, lineHeight: 1,
                          }}
                          onMouseEnter={e => e.currentTarget.style.color = "#c47070"}
                          onMouseLeave={e => {
                            if (pendingDelete?.id !== g.id) e.currentTarget.style.color = C.textMuted;
                          }}
                        >×</button>
                      </div>

                      {/* Cascade confirm for G-step */}
                      {isDelPending && (
                        <CascadeConfirm
                          cascade={pendingDelete.cascade}
                          datasets={datasets}
                          globalPipeline={globalPipeline}
                          label={`Remove G${i + 1} and all dependents?`}
                          C={C}
                          onSaveSnapshot={() => {
                            execSaveSnapshot(pendingDelete.cascade);
                            setPendingDelete(null);
                          }}
                          onDeleteAll={() => {
                            execCascade(pendingDelete.cascade);
                            setPendingDelete(null);
                          }}
                          onCancel={() => setPendingDelete(null)}
                        />
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
