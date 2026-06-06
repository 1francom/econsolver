// ─── ECON STUDIO · DatasetManager.jsx ────────────────────────────────────────
// Collapsible dataset registry panel rendered inside the WorkspaceBar.
// A compact button shows dataset count at all times; clicking opens a dropdown
// listing all session datasets with metadata and the active indicator.
// Reads from sessionState — mounted inside SessionStateProvider.

import { useState, useRef, useEffect } from "react";
import { useSessionState, useSessionDispatch } from "../../services/session/sessionState.jsx";
import { useTheme } from "../../ThemeContext.jsx";
import { useAuth } from "../../services/auth/AuthContext.jsx";
import {
  enableCloud,
  pushProject,
  pullProject,
  listCloudProjects,
  detectConflict,
  resolveConflict,
  unpublish,
  lockSession,
  hasSyncSession,
} from "../../services/sync/syncEngine.js";
import { createShare, listMyShares, revokeShare } from "../../services/sync/shareEngine.js";
import { getSyncMeta, listProjects } from "../../services/Persistence/indexedDB.js";

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
      background: `${C.red}15`,
      borderBottom: `1px solid ${C.border}`,
      fontFamily: mono,
    }}>
      <div style={{ fontSize: 9, color: C.red, fontWeight: 700, marginBottom: 4 }}>
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
              background: `${C.teal}15`,
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
            background: `${C.red}30`,
            border: `1px solid ${C.red}`,
            borderRadius: 3,
            color: C.red,
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

function CloudModal({ children, C, onClose }) {
  return (
    <>
      <div style={{ position: "fixed", inset: 0, background: "#000b", zIndex: 500 }} onClick={onClose} />
      <div style={{
        position: "fixed",
        top: "50%",
        left: "50%",
        transform: "translate(-50%, -50%)",
        width: "min(520px, calc(100vw - 28px))",
        maxHeight: "calc(100vh - 40px)",
        overflow: "auto",
        background: C.surface,
        border: `1px solid ${C.border2}`,
        borderTop: `2px solid ${C.teal}`,
        borderRadius: 6,
        boxShadow: "0 16px 48px #000c",
        zIndex: 501,
        fontFamily: mono,
      }}>
        {children}
      </div>
    </>
  );
}

// ─── MAIN COMPONENT ───────────────────────────────────────────────────────────
export default function DatasetManager({ activeDatasetId, pid, onSelectDataset, onRemoveDataset }) {
  const { C } = useTheme();
  const { user } = useAuth();
  const { datasets, primaryDatasetId, globalPipeline } = useSessionState();
  const dispatch = useSessionDispatch();
  const [open, setOpen] = useState(false);
  const [interactionsOpen, setInteractionsOpen] = useState(true);
  // pendingDelete: { kind: "gstep"|"dataset", id, cascade } | null
  const [pendingDelete, setPendingDelete] = useState(null);
  const [syncMeta, setSyncMetaState] = useState({ published: false, lastSyncedVersion: 0, dirty: false });
  const [syncState, setSyncState] = useState("local");
  const [syncBusy, setSyncBusy] = useState(false);
  const [syncError, setSyncError] = useState("");
  const [cloudProjects, setCloudProjects] = useState([]);
  const [localProjects, setLocalProjects] = useState([]);
  const [publishOpen, setPublishOpen] = useState(false);
  const [publishPass, setPublishPass] = useState("");
  const [recoveryKey, setRecoveryKey] = useState("");
  const [unlockOpen, setUnlockOpen] = useState(false);
  const [unlockPass, setUnlockPass] = useState("");
  const [unlockRecovery, setUnlockRecovery] = useState("");
  const [restoreOpen, setRestoreOpen] = useState(false);
  const [conflictOpen, setConflictOpen] = useState(false);
  const [unlocked, setUnlocked] = useState(hasSyncSession());
  // ── Share state ──────────────────────────────────────────────────────────────
  const [shareOpen,    setShareOpen]    = useState(false);
  const [shareEmail,   setShareEmail]   = useState("");
  const [shareCanEdit, setShareCanEdit] = useState(false);
  const [shareResult,  setShareResult]  = useState(null); // { shareUrl, shareId }
  const [shareBusy,    setShareBusy]    = useState(false);
  const [shareErr,     setShareErr]     = useState("");
  const [myShares,     setMyShares]     = useState([]);
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
  const cloudMissingLocally = cloudProjects.filter(cp => !localProjects.some(lp => lp.pid === cp.pid));

  async function refreshCloudState() {
    setSyncError("");
    setUnlocked(hasSyncSession());
    if (pid) {
      const meta = await getSyncMeta(pid);
      setSyncMetaState(meta);
      if (!user) {
        setSyncState(meta.published ? "offline" : "local");
      } else if (meta.published) {
        try {
          const conflict = await detectConflict(pid);
          setSyncState(conflict);
        } catch {
          setSyncState("offline");
        }
      } else {
        setSyncState("local");
      }
    }
    try {
      const [cloud, local] = user ? await Promise.all([listCloudProjects(), listProjects()]) : [[], await listProjects()];
      setCloudProjects(cloud);
      setLocalProjects(local);
      if (user && cloud.length && !hasSyncSession()) setUnlockOpen(true);
      if (user && cloud.length && hasSyncSession() && cloud.some(cp => !local.some(lp => lp.pid === cp.pid))) {
        setRestoreOpen(true);
      }
    } catch {
      if (user) setSyncState("offline");
    }
  }

  useEffect(() => {
    let cancelled = false;
    async function run() {
      if (cancelled) return;
      await refreshCloudState();
    }
    run();
    return () => { cancelled = true; };
  }, [user?.id, pid]);

  useEffect(() => {
    function onCloudLogin(e) {
      const projects = Array.isArray(e.detail?.projects) ? e.detail.projects : [];
      setCloudProjects(projects);
      if (projects.length && !hasSyncSession()) setUnlockOpen(true);
      refreshCloudState();
    }
    function onCloudLogout() {
      setUnlocked(false);
      setUnlockOpen(false);
      setRestoreOpen(false);
    }
    window.addEventListener("econsolver:cloud-login", onCloudLogin);
    window.addEventListener("econsolver:cloud-logout", onCloudLogout);
    return () => {
      window.removeEventListener("econsolver:cloud-login", onCloudLogin);
      window.removeEventListener("econsolver:cloud-logout", onCloudLogout);
    };
  }, []);

  function syncLabel() {
    if (!user) return "offline";
    if (!syncMeta.published) return "local";
    if (!unlocked) return "locked";
    if (syncBusy) return "syncing";
    if (syncState === "diverged") return "conflict";
    if (syncState === "server-ahead") return "cloud ahead";
    if (syncState === "local-ahead" || syncMeta.dirty) return "local changes";
    if (syncState === "offline") return "offline";
    return "synced";
  }

  function syncColor() {
    const label = syncLabel();
    if (label === "synced") return C.teal;
    if (label === "conflict") return C.red;
    if (label === "local changes" || label === "cloud ahead" || label === "syncing") return C.gold;
    return C.textMuted;
  }

  async function runSyncAction(fn) {
    setSyncBusy(true);
    setSyncError("");
    try {
      const result = await fn();
      await refreshCloudState();
      return result;
    } catch (err) {
      setSyncError(err?.message ?? "Cloud sync failed.");
      return null;
    } finally {
      setSyncBusy(false);
    }
  }

  async function publishCurrentProject() {
    if (!pid || publishPass.length < 10) return;
    const result = await runSyncAction(() => enableCloud(pid, publishPass));
    setPublishPass("");
    if (result?.recoveryKey) setRecoveryKey(result.recoveryKey);
  }

  function downloadRecoveryKey() {
    if (!recoveryKey) return;
    const payload = JSON.stringify({
      type: "econsolver-sync-recovery-key-v1",
      key: recoveryKey,
      createdAt: new Date().toISOString(),
    }, null, 2);
    const url = URL.createObjectURL(new Blob([payload], { type: "application/json" }));
    const a = document.createElement("a");
    a.href = url;
    a.download = `econsolver-recovery-${pid ?? "cloud"}.json`;
    a.click();
    URL.revokeObjectURL(url);
  }

  async function unlockCloud() {
    const recovery = unlockRecovery.trim();
    const passphrase = unlockPass;
    if (!recovery && !passphrase) return;
    const ok = await runSyncAction(() => lockSession(recovery ? { recoveryKey: recovery } : { passphrase }));
    if (ok !== null) {
      setUnlockOpen(false);
      setUnlockPass("");
      setUnlockRecovery("");
      setUnlocked(true);
      if (cloudMissingLocally.length) setRestoreOpen(true);
    }
  }

  async function readRecoveryFile(e) {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file) return;
    try {
      const text = await file.text();
      const parsed = JSON.parse(text);
      setUnlockRecovery(parsed?.key ?? text.trim());
    } catch {
      setUnlockRecovery("");
      setSyncError("Recovery key file could not be read.");
    }
  }

  async function chooseConflict(choice) {
    await runSyncAction(() => resolveConflict(pid, choice));
    setConflictOpen(false);
  }

  // ── Share handlers ───────────────────────────────────────────────────────────
  async function openSharePanel() {
    setShareOpen(true);
    setShareResult(null);
    setShareErr("");
    if (pid) {
      try { setMyShares(await listMyShares(pid)); } catch { setMyShares([]); }
    }
  }

  async function handleCreateShare() {
    if (!shareEmail.trim() || !pid) return;
    setShareBusy(true);
    setShareErr("");
    try {
      const result = await createShare(pid, shareEmail.trim(), shareCanEdit);
      setShareResult(result);
      setMyShares(await listMyShares(pid));
    } catch (e) {
      setShareErr(e?.message ?? "Share failed.");
    } finally {
      setShareBusy(false);
    }
  }

  async function handleRevokeShare(shareId) {
    try {
      await revokeShare(shareId);
      setMyShares(await listMyShares(pid));
    } catch (e) {
      setShareErr(e?.message ?? "Revoke failed.");
    }
  }

  // ── Dispatch helpers ────────────────────────────────────────────────────────
  function execCascade({ gStepIds, datasetIds }) {
    gStepIds.forEach(id  => dispatch({ type: "REMOVE_GLOBAL_STEP", id }));
    datasetIds.forEach(id => {
      dispatch({ type: "REMOVE_DATASET", id });
      onRemoveDataset?.(id); // sync DataStudio local state
    });
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
          fontSize: 9,
          padding: "2px 7px",
          background: open ? `${C.gold}28` : `${C.teal}22`,
          border: `1px solid ${open ? C.gold : C.teal + "80"}`,
          borderRadius: 3,
          color: open ? C.gold : C.teal,
          fontWeight: 700,
          letterSpacing: "0.06em",
        }}>
          {count || 0} dataset{count === 1 ? "" : "s"}
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
          width: 360,
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

          <div style={{ padding: "0.55rem 0.85rem", borderBottom: `1px solid ${C.border}` }}>
            <div style={{ display: "flex", alignItems: "center", gap: 8, justifyContent: "space-between" }}>
              <span style={{
                fontSize: 8,
                padding: "2px 7px",
                border: `1px solid ${syncColor()}80`,
                borderRadius: 3,
                color: syncColor(),
                textTransform: "uppercase",
                letterSpacing: "0.12em",
              }}>
                {syncLabel()}
              </span>
              {!syncMeta.published ? (
                <button
                  onClick={() => setPublishOpen(true)}
                  disabled={!user || !pid}
                  title={user ? "Publish this project as client-side encrypted cloud blobs" : "Sign in to publish this project"}
                  style={{
                    padding: "0.24rem 0.62rem",
                    background: `${C.teal}14`,
                    border: `1px solid ${C.teal}90`,
                    borderRadius: 3,
                    color: user && pid ? C.teal : C.textMuted,
                    cursor: user && pid ? "pointer" : "not-allowed",
                    fontFamily: mono,
                    fontSize: 9,
                  }}
                >
                  Publish to cloud
                </button>
              ) : (
                <div style={{ display: "flex", gap: 6 }}>
                  <button
                    onClick={() => runSyncAction(() => pushProject(pid, { immediate: true }))}
                    disabled={!unlocked || syncBusy}
                    style={{
                      padding: "0.24rem 0.52rem",
                      background: "transparent",
                      border: `1px solid ${C.border2}`,
                      borderRadius: 3,
                      color: unlocked ? C.textDim : C.textMuted,
                      cursor: unlocked ? "pointer" : "not-allowed",
                      fontFamily: mono,
                      fontSize: 9,
                    }}
                  >
                    Sync now
                  </button>
                  {(syncState === "diverged" || syncState === "server-ahead") && (
                    <button
                      onClick={() => setConflictOpen(true)}
                      style={{
                        padding: "0.24rem 0.52rem",
                        background: `${C.gold}16`,
                        border: `1px solid ${C.gold}`,
                        borderRadius: 3,
                        color: C.gold,
                        cursor: "pointer",
                        fontFamily: mono,
                        fontSize: 9,
                      }}
                    >
                      Resolve
                    </button>
                  )}
                  <button
                    onClick={openSharePanel}
                    disabled={!user}
                    style={{
                      padding: "0.24rem 0.52rem",
                      background: `${C.blue}18`,
                      border: `1px solid ${C.blue}`,
                      borderRadius: 3,
                      color: C.blue,
                      cursor: "pointer",
                      fontFamily: mono,
                      fontSize: 9,
                    }}
                  >
                    Share →
                  </button>
                  <button
                    onClick={() => runSyncAction(() => unpublish(pid))}
                    disabled={syncBusy}
                    style={{
                      padding: "0.24rem 0.52rem",
                      background: "transparent",
                      border: `1px solid ${C.border2}`,
                      borderRadius: 3,
                      color: C.textMuted,
                      cursor: syncBusy ? "wait" : "pointer",
                      fontFamily: mono,
                      fontSize: 9,
                    }}
                  >
                    Unpublish
                  </button>
                </div>
              )}
            </div>
            {syncError && (
              <div style={{ marginTop: 6, fontSize: 9, color: C.red, lineHeight: 1.45 }}>
                {syncError}
              </div>
            )}
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
                      background: isDelPending ? `${C.red}15` : isActive ? `${C.teal}0a` : "transparent",
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
                      {ds.crs?.label && (
                        <div
                          style={{ fontSize: 9, color: ds.crs.reprojected ? C.gold : C.teal, marginTop: 2, opacity: 0.85 }}
                          title={ds.crs.reprojected
                            ? `Reprojected from ${ds.crs.label} → ${ds.crs.target}`
                            : `CRS: ${ds.crs.label}${ds.crs.unit ? ` | unit: ${ds.crs.unit}` : ""}${ds.crs.source ? ` | source: ${ds.crs.source}` : ""}${ds.crs.warning ? ` | ${ds.crs.warning}` : ""}`}
                        >
                          {ds.crs.reprojected ? "↻ " : "◇ "}{ds.crs.label}
                        </div>
                      )}
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
                        onRemoveDataset?.(ds.id);
                        const cascadeIds = new Set(pendingDelete.cascade.datasetIds);
                        const fallback = Object.keys(datasets).find(id => id !== ds.id && !cascadeIds.has(id)) ?? null;
                        onSelectDataset?.(fallback);
                        setPendingDelete(null);
                        setOpen(false);
                      }}
                      onDeleteAll={() => {
                        const { gStepIds, datasetIds } = pendingDelete.cascade;
                        execCascade({ gStepIds, datasetIds });
                        dispatch({ type: "REMOVE_DATASET", id: ds.id });
                        onRemoveDataset?.(ds.id);
                        const cascadeIds = new Set(pendingDelete.cascade.datasetIds);
                        const fallback = Object.keys(datasets).find(id => id !== ds.id && !cascadeIds.has(id)) ?? null;
                        onSelectDataset?.(fallback);
                        setPendingDelete(null);
                        setOpen(false);
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
                        background: isDelPending ? `${C.red}15` : "transparent",
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

      {publishOpen && (
        <CloudModal C={C} onClose={() => setPublishOpen(false)}>
          <div style={{ padding: "1rem 1.1rem", borderBottom: `1px solid ${C.border}` }}>
            <div style={{ fontSize: 10, color: C.teal, letterSpacing: "0.18em", textTransform: "uppercase", marginBottom: 8 }}>
              Publish encrypted cloud copy
            </div>
            <div style={{ fontSize: 11, color: C.textDim, lineHeight: 1.55 }}>
              Choose a separate sync passphrase. Plaintext stays in this browser; the server receives only AES-GCM encrypted blobs and cannot recover this passphrase.
            </div>
          </div>
          <div style={{ padding: "1rem 1.1rem" }}>
            <input
              type="password"
              value={publishPass}
              onChange={e => setPublishPass(e.target.value)}
              placeholder="Sync passphrase"
              style={{ width: "100%", boxSizing: "border-box", padding: "0.55rem 0.7rem", background: C.bg, color: C.text, border: `1px solid ${C.border2}`, borderRadius: 3, fontFamily: mono }}
            />
            <div style={{ marginTop: 7, fontSize: 9, color: publishPass.length >= 16 ? C.teal : C.gold }}>
              {publishPass.length >= 16 ? "Strength: good" : "Use at least 16 characters for a stronger key."}
            </div>
            {recoveryKey && (
              <div style={{ marginTop: 12, paddingTop: 12, borderTop: `1px solid ${C.border}` }}>
                <div style={{ fontSize: 10, color: C.gold, marginBottom: 8 }}>
                  Save this recovery key once. Anyone with it can unlock your cloud copy.
                </div>
                <button onClick={downloadRecoveryKey} style={{ padding: "0.4rem 0.75rem", background: `${C.gold}14`, border: `1px solid ${C.gold}`, borderRadius: 3, color: C.gold, cursor: "pointer", fontFamily: mono, fontSize: 10 }}>
                  Download recovery key
                </button>
              </div>
            )}
            <div style={{ display: "flex", justifyContent: "flex-end", gap: 8, marginTop: 16 }}>
              <button onClick={() => setPublishOpen(false)} style={{ padding: "0.4rem 0.75rem", background: "transparent", border: `1px solid ${C.border2}`, borderRadius: 3, color: C.textDim, cursor: "pointer", fontFamily: mono, fontSize: 10 }}>
                Close
              </button>
              <button onClick={publishCurrentProject} disabled={syncBusy || publishPass.length < 10} style={{ padding: "0.4rem 0.75rem", background: `${C.teal}18`, border: `1px solid ${C.teal}`, borderRadius: 3, color: publishPass.length >= 10 ? C.teal : C.textMuted, cursor: publishPass.length >= 10 ? "pointer" : "not-allowed", fontFamily: mono, fontSize: 10 }}>
                {syncBusy ? "Publishing..." : "Publish"}
              </button>
            </div>
          </div>
        </CloudModal>
      )}

      {unlockOpen && (
        <CloudModal C={C} onClose={() => setUnlockOpen(false)}>
          <div style={{ padding: "1rem 1.1rem", borderBottom: `1px solid ${C.border}` }}>
            <div style={{ fontSize: 10, color: C.teal, letterSpacing: "0.18em", textTransform: "uppercase", marginBottom: 8 }}>
              Unlock cloud sync
            </div>
            <div style={{ fontSize: 11, color: C.textDim, lineHeight: 1.55 }}>
              Enter your sync passphrase or import the recovery key. Neither leaves this browser.
            </div>
          </div>
          <div style={{ padding: "1rem 1.1rem" }}>
            <input type="password" value={unlockPass} onChange={e => setUnlockPass(e.target.value)} placeholder="Sync passphrase" style={{ width: "100%", boxSizing: "border-box", padding: "0.55rem 0.7rem", background: C.bg, color: C.text, border: `1px solid ${C.border2}`, borderRadius: 3, fontFamily: mono }} />
            <div style={{ display: "flex", alignItems: "center", gap: 8, marginTop: 10 }}>
              <input type="file" accept="application/json,.json,.txt" onChange={readRecoveryFile} style={{ color: C.textMuted, fontFamily: mono, fontSize: 10 }} />
              {unlockRecovery && <span style={{ fontSize: 9, color: C.teal }}>recovery key loaded</span>}
            </div>
            <div style={{ display: "flex", justifyContent: "flex-end", gap: 8, marginTop: 16 }}>
              <button onClick={() => setUnlockOpen(false)} style={{ padding: "0.4rem 0.75rem", background: "transparent", border: `1px solid ${C.border2}`, borderRadius: 3, color: C.textDim, cursor: "pointer", fontFamily: mono, fontSize: 10 }}>
                Later
              </button>
              <button onClick={unlockCloud} disabled={syncBusy || (!unlockPass && !unlockRecovery)} style={{ padding: "0.4rem 0.75rem", background: `${C.teal}18`, border: `1px solid ${C.teal}`, borderRadius: 3, color: unlockPass || unlockRecovery ? C.teal : C.textMuted, cursor: unlockPass || unlockRecovery ? "pointer" : "not-allowed", fontFamily: mono, fontSize: 10 }}>
                Unlock
              </button>
            </div>
          </div>
        </CloudModal>
      )}

      {restoreOpen && cloudMissingLocally.length > 0 && (
        <CloudModal C={C} onClose={() => setRestoreOpen(false)}>
          <div style={{ padding: "1rem 1.1rem", borderBottom: `1px solid ${C.border}` }}>
            <div style={{ fontSize: 10, color: C.teal, letterSpacing: "0.18em", textTransform: "uppercase" }}>
              Restore cloud projects
            </div>
          </div>
          <div style={{ padding: "0.5rem 1.1rem 1rem" }}>
            {cloudMissingLocally.map(cp => (
              <div key={cp.pid} style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8, padding: "0.55rem 0", borderBottom: `1px solid ${C.border}` }}>
                <div style={{ minWidth: 0 }}>
                  <div style={{ fontSize: 11, color: C.textDim, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{cp.name ?? cp.pid}</div>
                  <div style={{ fontSize: 9, color: C.textMuted }}>version {cp.version} | {cp.updated_at ? new Date(cp.updated_at).toLocaleString() : "cloud"}</div>
                </div>
                <button onClick={() => runSyncAction(() => pullProject(cp.pid))} disabled={!unlocked || syncBusy} style={{ padding: "0.35rem 0.7rem", background: `${C.teal}14`, border: `1px solid ${C.teal}`, borderRadius: 3, color: unlocked ? C.teal : C.textMuted, cursor: unlocked ? "pointer" : "not-allowed", fontFamily: mono, fontSize: 10 }}>
                  Restore
                </button>
              </div>
            ))}
          </div>
        </CloudModal>
      )}

      {conflictOpen && (
        <CloudModal C={C} onClose={() => setConflictOpen(false)}>
          <div style={{ padding: "1rem 1.1rem", borderBottom: `1px solid ${C.border}` }}>
            <div style={{ fontSize: 10, color: C.gold, letterSpacing: "0.18em", textTransform: "uppercase", marginBottom: 8 }}>
              Choose sync version
            </div>
            <div style={{ fontSize: 11, color: C.textDim, lineHeight: 1.55 }}>
              This device has {count} dataset{count === 1 ? "" : "s"} and local version {syncMeta.lastSyncedVersion}. Cloud has version {cloudProjects.find(cp => cp.pid === pid)?.version ?? "?"}.
            </div>
          </div>
          <div style={{ padding: "1rem 1.1rem", display: "flex", gap: 8, justifyContent: "flex-end", flexWrap: "wrap" }}>
            <button onClick={() => chooseConflict("keep-local")} style={{ padding: "0.42rem 0.75rem", background: "transparent", border: `1px solid ${C.border2}`, borderRadius: 3, color: C.textDim, cursor: "pointer", fontFamily: mono, fontSize: 10 }}>Keep this device</button>
            <button onClick={() => chooseConflict("keep-cloud")} style={{ padding: "0.42rem 0.75rem", background: "transparent", border: `1px solid ${C.border2}`, borderRadius: 3, color: C.textDim, cursor: "pointer", fontFamily: mono, fontSize: 10 }}>Keep cloud</button>
            <button onClick={() => chooseConflict("fork")} style={{ padding: "0.42rem 0.75rem", background: `${C.gold}16`, border: `1px solid ${C.gold}`, borderRadius: 3, color: C.gold, cursor: "pointer", fontFamily: mono, fontSize: 10 }}>Keep both</button>
          </div>
        </CloudModal>
      )}

      {/* ── Share modal ── */}
      {shareOpen && (
        <CloudModal C={C} onClose={() => { setShareOpen(false); setShareResult(null); setShareErr(""); setShareEmail(""); }}>
          <div style={{ padding: "1rem 1.1rem", borderBottom: `1px solid ${C.border}` }}>
            <div style={{ fontSize: 10, color: C.blue, letterSpacing: "0.18em", textTransform: "uppercase", marginBottom: 4 }}>
              Share project
            </div>
            <div style={{ fontSize: 10, color: C.textMuted }}>
              An encrypted copy is created. The recipient imports it on their device.
            </div>
          </div>

          {!shareResult ? (
            <div style={{ padding: "1rem 1.1rem", display: "flex", flexDirection: "column", gap: 10 }}>
              <div>
                <div style={{ fontSize: 9, color: C.textMuted, letterSpacing: "0.16em", textTransform: "uppercase", marginBottom: 5 }}>Recipient email</div>
                <input
                  type="email"
                  value={shareEmail}
                  onChange={e => setShareEmail(e.target.value)}
                  onKeyDown={e => { if (e.key === "Enter") handleCreateShare(); }}
                  placeholder="colleague@university.edu"
                  style={{ width: "100%", padding: "0.45rem 0.6rem", fontFamily: mono, fontSize: 11, background: C.surface, border: `1px solid ${C.border2}`, borderRadius: 3, color: C.text, outline: "none", boxSizing: "border-box" }}
                  onFocus={e => e.target.style.borderColor = C.blue}
                  onBlur={e => e.target.style.borderColor = C.border2}
                />
              </div>
              <label style={{ display: "flex", alignItems: "center", gap: 8, cursor: "pointer", fontSize: 10, color: C.textDim }}>
                <input
                  type="checkbox"
                  checked={shareCanEdit}
                  onChange={e => setShareCanEdit(e.target.checked)}
                  style={{ accentColor: C.blue }}
                />
                Allow recipient to edit
              </label>
              {shareErr && <div style={{ fontSize: 10, color: "#e07070" }}>{shareErr}</div>}
              <div style={{ display: "flex", gap: 8, justifyContent: "flex-end" }}>
                <button
                  onClick={handleCreateShare}
                  disabled={shareBusy || !shareEmail.trim()}
                  style={{ padding: "0.42rem 1rem", background: shareBusy || !shareEmail.trim() ? C.surface2 : C.blue, border: "none", borderRadius: 3, color: shareBusy || !shareEmail.trim() ? C.textMuted : "#fff", cursor: "pointer", fontFamily: mono, fontSize: 10, fontWeight: 700 }}
                >
                  {shareBusy ? "Creating share…" : "Create share link"}
                </button>
              </div>

              {/* Existing shares */}
              {myShares.length > 0 && (
                <div style={{ borderTop: `1px solid ${C.border}`, paddingTop: 10 }}>
                  <div style={{ fontSize: 9, color: C.textMuted, letterSpacing: "0.16em", textTransform: "uppercase", marginBottom: 6 }}>Active shares</div>
                  {myShares.map(s => (
                    <div key={s.id} style={{ display: "flex", alignItems: "center", gap: 8, padding: "0.3rem 0", borderBottom: `1px solid ${C.border}` }}>
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <div style={{ fontSize: 10, color: C.textDim, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{s.recipient_email}</div>
                        <div style={{ fontSize: 9, color: C.textMuted }}>{s.can_edit ? "can edit" : "view only"}</div>
                      </div>
                      <button
                        onClick={() => handleRevokeShare(s.id)}
                        title="Revoke share"
                        style={{ background: "transparent", border: "none", color: C.textMuted, cursor: "pointer", fontSize: 12, padding: "0 2px" }}
                        onMouseEnter={e => e.currentTarget.style.color = "#e07070"}
                        onMouseLeave={e => e.currentTarget.style.color = C.textMuted}
                      >×</button>
                    </div>
                  ))}
                </div>
              )}
            </div>
          ) : (
            <div style={{ padding: "1rem 1.1rem", display: "flex", flexDirection: "column", gap: 12 }}>
              <div style={{ fontSize: 10, color: C.teal }}>✓ Share created for {shareEmail}</div>
              <div>
                <div style={{ fontSize: 9, color: C.textMuted, marginBottom: 5 }}>Share link — send this to the recipient:</div>
                <div style={{ display: "flex", gap: 6 }}>
                  <input
                    readOnly
                    value={shareResult.shareUrl}
                    style={{ flex: 1, padding: "0.4rem 0.55rem", fontFamily: mono, fontSize: 10, background: C.surface, border: `1px solid ${C.border2}`, borderRadius: 3, color: C.textDim, outline: "none" }}
                    onFocus={e => e.target.select()}
                  />
                  <button
                    onClick={() => navigator.clipboard?.writeText(shareResult.shareUrl)}
                    style={{ padding: "0.4rem 0.7rem", background: `${C.teal}18`, border: `1px solid ${C.teal}`, borderRadius: 3, color: C.teal, cursor: "pointer", fontFamily: mono, fontSize: 9 }}
                  >Copy</button>
                </div>
              </div>
              <a
                href={`mailto:${shareEmail}?subject=Litux project shared with you&body=I shared a research project with you on Litux.%0D%0AOpen this link to import it:%0D%0A%0D%0A${encodeURIComponent(shareResult.shareUrl)}%0D%0A%0D%0AYou will need to sign in (or create a free account) to access it.`}
                style={{ fontSize: 10, color: C.blue, textDecoration: "none" }}
              >
                ✉ Open in email client →
              </a>
              <button
                onClick={() => { setShareResult(null); setShareEmail(""); setShareCanEdit(false); }}
                style={{ alignSelf: "flex-end", padding: "0.32rem 0.8rem", background: "transparent", border: `1px solid ${C.border2}`, borderRadius: 3, color: C.textMuted, cursor: "pointer", fontFamily: mono, fontSize: 9 }}
              >Share another</button>
            </div>
          )}
        </CloudModal>
      )}
    </div>
  );
}
