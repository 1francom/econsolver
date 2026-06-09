// ─── ECON STUDIO · WranglingModule.jsx ───────────────────────────────────────
// Root orchestrator. Owns pipeline state, runs the pipeline, routes tabs.
// All UI is delegated to components/wrangling/*.jsx
// ~110 lines — add features in the tab files, not here.

import { useState, useCallback, useMemo, useEffect, useRef } from "react";
import { HintBox } from "./components/HelpSystem.jsx";
import { applyStep, runPipeline, runPipelineAsync } from "./pipeline/runner.js";
import { validatePanel, buildInfo } from "./pipeline/validator.js";
import { buildDataQualityReport, exportMarkdown } from "./core/validation/dataQuality.js";

// ── Tab components ─────────────────────────────────────────────────────────
import CleanTab        from "./components/wrangling/CleanTab.jsx";
import PanelTab        from "./components/wrangling/PanelTab.jsx";
import FeatureTab      from "./components/wrangling/FeatureTab.jsx";
import ReshapeTab      from "./components/wrangling/ReshapeTab.jsx";
import MergeTab        from "./components/wrangling/MergeTab.jsx";
import DictionaryTab   from "./components/wrangling/DictionaryTab.jsx";
import History         from "./components/wrangling/History.jsx";
import ExportMenu      from "./components/wrangling/ExportMenu.jsx";
import ImportPipelineButton from "./components/wrangling/ImportPipelineButton.jsx";
import DataQualityReport from "./components/wrangling/DataQualityReport.jsx";
import NLCommandBar     from "./components/wrangling/NLCommandBar.jsx";
import AuditTrail        from "./components/validation/AuditTrail.jsx";
import { auditPipeline } from "./pipeline/auditor.js";

// ── Shared atoms ───────────────────────────────────────────────────────────
import { useTheme, Tabs } from "./components/wrangling/shared.jsx";

// ── Persistence — IndexedDB (replaces localStorage 5MB cap) ───────────────
import {
  loadPipeline,
  savePipeline,
  saveRawData,
  saveProject,
  migrateFromLocalStorage,
} from "./services/Persistence/indexedDB.js";

// ── Session state — two-tier pipeline registry ─────────────────────────────
import { useSessionDispatch } from "./services/session/sessionState.jsx";

// ── Re-exports (consumed by ModelingTab and other modules) ─────────────────
export { validatePanel, buildInfo }   from "./pipeline/validator.js";
export { applyStep, runPipeline, runPipelineAsync } from "./pipeline/runner.js";
export { fuzzyGroups }                from "./components/wrangling/utils.js";
export { Grid }                       from "./components/wrangling/shared.jsx";

// ─── ROOT ─────────────────────────────────────────────────────────────────────
export default function WranglingModule({ rawData, filename, onComplete, onReady, pid, projectPid, allDatasets = [], onSaveSubset, addStepRef }) {
  // Per-dataset pipelines are stored under the parent project's pid (Phase 0.2
  // schema). Fall back to `pid` so single-dataset legacy paths still work —
  // they treat the project pid and the primary dataset id as the same value.
  const ownerPid = projectPid || pid;
  const { C, T } = useTheme();
  // Session dispatch — may be null when rendered outside SessionStateProvider (tests/legacy)
  const sessionDispatch = useSessionDispatch();

  // State starts empty — IndexedDB load is async (see useEffect below)
  const [pipeline,         setPipeline]        = useState([]);
  const [panel,            setPanel]            = useState(null);
  const [dataDictionary,   setDataDictionary]   = useState(null);
  const [tab,              setTab]              = useState(() => sessionStorage.getItem(`litux:wrangle_tab:${pid}`) || "clean");
  // Persist active sub-tab so refresh restores to the same wrangling view.
  useEffect(() => { sessionStorage.setItem(`litux:wrangle_tab:${pid}`, tab); }, [tab, pid]);
  const [idbReady,         setIdbReady]         = useState(false);
  const [auditTrail,       setAuditTrail]       = useState(null);
  const [branchPointIndex, setBranchPointIndex] = useState(null);
  // pendingDelete: { index, downstreamCount } — set when deleting a non-last step
  const [pendingDelete,    setPendingDelete]    = useState(null);

  // ── Initial load from IndexedDB ────────────────────────────────────────────
  useEffect(() => {
    let cancelled = false;
    (async () => {
      await migrateFromLocalStorage();
      const rec = await loadPipeline(ownerPid, pid);
      if (cancelled) return;
      if (rec) {
        // v4 schema: per-dataset slot uses `steps`. Older readers may still
        // hand us `pipeline` — accept both so we survive partial migrations.
        const steps = Array.isArray(rec.steps) ? rec.steps
                    : Array.isArray(rec.pipeline) ? rec.pipeline
                    : null;
        if (steps)                          setPipeline(steps);
        if (rec.panel)                      setPanel(rec.panel);
        if (rec.dataDictionary)             setDataDictionary(rec.dataDictionary);
        if (rec.branchPointIndex != null)   setBranchPointIndex(rec.branchPointIndex);
      }
      setIdbReady(true);
    })();
    return () => { cancelled = true; };
  }, [pid, ownerPid]);

  const context = useMemo(() => ({
    datasets: Object.fromEntries((allDatasets || []).map(d => [d.id, d.rawData]))
  }), [allDatasets]);

  // ── Pipeline execution: DuckDB path (async) or JS path (deferred) ──────────
  // Initial state: raw rows, no cloning — pipeline runs after first paint.
  // All applyStep handlers use .map() and never mutate rawData.rows in-place,
  // so passing the reference directly is safe.
  const [processed,    setProcessed]    = useState({ rows: rawData.rows, headers: rawData.headers });
  const [isProcessing, setIsProcessing] = useState(false);
  const [elapsedMs,    setElapsedMs]    = useState(0);
  const timerRef = useRef(null);

  useEffect(() => {
    let cancelled = false;

    // ── start spinner + elapsed clock ──────────────────────────────────────
    const t0 = Date.now();
    setIsProcessing(true);
    setElapsedMs(0);
    timerRef.current = setInterval(() => {
      if (!cancelled) setElapsedMs(Date.now() - t0);
    }, 250);
    const done = result => {
      if (cancelled) return;
      clearInterval(timerRef.current);
      setElapsedMs(Date.now() - t0);
      setProcessed(result);
      setIsProcessing(false);
    };

    if (rawData._duckdb?.tableName) {
      // Large dataset loaded via DuckDB — run pipeline as SQL (non-blocking)
      import("./pipeline/duckdbRunner.js").then(({ runPipelineDuck }) =>
        import("./services/data/duckdb.js").then(({ getDuckDB }) =>
          getDuckDB().then(({ conn }) =>
            runPipelineDuck(rawData._duckdb.tableName, rawData.headers, pipeline, conn)
              .then(done)
              .catch(e => {
                console.error("[WranglingModule] DuckDB pipeline failed, falling to JS:", e);
                // JS fallback — still deferred so spinner renders first
                setTimeout(() => {
                  if (!cancelled) done(runPipeline(rawData.rows, rawData.headers, pipeline, context));
                }, 0);
              })
          )
        )
      );
    } else {
      // JS path — defer by one frame so the spinner renders before we block.
      // If the pipeline contains mutate/ai_tr steps, use the Worker async path
      // (isolated from localStorage/indexedDB) instead of main-thread eval.
      const hasExprSteps = pipeline.some(s =>
        s.type === "mutate" || s.type === "ai_tr" ||
        s.type === "if_else" || s.type === "case_when" ||
        (s.type === "filter" && s.expr)
      );
      if (hasExprSteps) {
        runPipelineAsync(rawData.rows, rawData.headers, pipeline, context)
          .then(result => { if (!cancelled) done(result); })
          .catch(e => {
            console.warn("[WranglingModule] async pipeline failed, falling to sync:", e);
            if (!cancelled) done(runPipeline(rawData.rows, rawData.headers, pipeline, context));
          });
      } else {
        const timerId = setTimeout(() => {
          if (!cancelled) done(runPipeline(rawData.rows, rawData.headers, pipeline, context));
        }, 0);
        return () => { cancelled = true; clearTimeout(timerId); clearInterval(timerRef.current); };
      }
    }

    return () => { cancelled = true; clearInterval(timerRef.current); };
  }, [rawData, pipeline, context]);

  const { rows, headers } = processed;

  const info        = useMemo(() => buildInfo(headers, rows),                    [headers, rows]);
  const panelReport = useMemo(() => panel ? validatePanel(rows, panel.entityCol, panel.timeCol) : null, [rows, panel]);
  const qualityReport = useMemo(() => buildDataQualityReport(headers, rows, info, panelReport), [headers, rows, info, panelReport]);

  // ── Persist on every change (debounced 400ms to avoid thrashing IDB) ────────
  const saveTimer    = useRef(null);
  const rawDataSaved = useRef(false);   // save rawData only once per session — it never changes
  useEffect(() => {
    if (!idbReady) return;
    clearTimeout(saveTimer.current);
    saveTimer.current = setTimeout(() => {
      const pipelineRecord = {
        filename, pipeline, panel, dataDictionary, branchPointIndex,
        rowCount: rawData.rows.length, colCount: rawData.headers.length,
        pipelineLength: pipeline.length,
      };
      // Persist the per-dataset slot under the owning project's pid.
      savePipeline(ownerPid, pid, pipelineRecord);
      // Keep project store in sync — only for primary projects (pid starts with "proj_").
      // Secondary datasets use genId() keys and must not create project entries.
      if (pid?.startsWith("proj_")) {
        saveProject(pid, {
          filename,
          rowCount:       rawData.rows.length,
          colCount:       rawData.headers.length,
          pipelineLength: pipeline.length,
        });
      }
      // Persist raw dataset once per session (skip if already stored this session)
      if (!rawDataSaved.current) {
        saveRawData(pid, rawData).then(({ stored }) => {
          if (stored) rawDataSaved.current = true;
        });
      }
    }, 400);
    return () => clearTimeout(saveTimer.current);
  }, [pipeline, panel, dataDictionary, idbReady]);

  // ── Auto-push output to parent whenever pipeline output changes ──────────────
  // Fires on initial load (idbReady) AND whenever pipeline changes (user edits a
  // step), so Explorer, Model, PlotBuilder and Data Viewer always stay in sync.
  // Depends on `pipeline` (stable state), NOT `rows` (computed from allDatasets
  // which gets a new array ref every render — would cause an infinite loop).
  useEffect(() => {
    if (!idbReady || !onReady) return;
    const ci = {};
    headers.forEach(h => {
      const s = rows.find(r => r[h] !== undefined && r[h] !== null);
      const v = s?.[h];
      ci[h] = {
        isNumeric: typeof v === "number",
        isDate:    typeof v === "string" && /^\d{4}-\d{2}-\d{2}/.test(v),
      };
    });
    onReady({
      headers, cleanRows: rows, colInfo: ci,
      filename, issues: [], removed: 0,
      dataDictionary: dataDictionary || {},
      pipeline,
      loadOpts: rawData?._loadOpts ?? null,
      panelIndex: panel
        ? { entityCol: panel.entityCol, timeCol: panel.timeCol,
            balance: panel.validation?.balance, blockFD: panel.validation?.blockFD }
        : null,
      _duckdb: processed._duckdb ?? null,
    });
  }, [idbReady, processed, panel]); // eslint-disable-line react-hooks/exhaustive-deps

  // ── Auto-clamp branchPointIndex when pipeline shrinks ─────────────────────
  useEffect(() => {
    if (branchPointIndex !== null && branchPointIndex >= pipeline.length) {
      setBranchPointIndex(pipeline.length > 0 ? pipeline.length - 1 : null);
    }
  }, [pipeline.length, branchPointIndex]);

  // ── Undo / Redo stack ──────────────────────────────────────────────────────
  // Each entry is a full pipeline snapshot (step[]). Present state is NOT in
  // the stack — it lives in `pipeline`. Undo pushes current to redo stack and
  // pops from undo stack. Max 40 entries to bound memory.
  const MAX_UNDO = 40;
  const undoStack = useRef([]);   // stack of past pipeline states (oldest → newest)
  const redoStack = useRef([]);   // stack of future pipeline states

  // Snapshot before every mutation
  const snapshot = useCallback((prev) => {
    undoStack.current = [...undoStack.current.slice(-MAX_UNDO + 1), prev];
    redoStack.current = [];       // any new action clears redo
  }, []);

  const addStep = useCallback(s => {
    const stepId = Date.now() + Math.random();

    // Every step is tagged with its owner dataset (for export DAG traversal).
    // Cross-dataset steps (join/append) also register a G-step in the global
    // pipeline so the exporter can build the dependency graph.
    let gStepId = null;
    if (sessionDispatch && (s.type === "join" || s.type === "append")) {
      gStepId = `G_${stepId}`;
      sessionDispatch({
        type: "ADD_GLOBAL_STEP",
        step: {
          id:              gStepId,
          localStepId:     stepId,
          opType:          s.type === "join" ? `${s.how || "left"}_join` : "append",
          leftDatasetId:   pid,
          rightDatasetId:  s.rightId,
          outputDatasetId: pid,         // result stays in the left dataset's pipeline
          params:          s.type === "join"
            ? { leftKey: s.leftKey, rightKey: s.rightKey, suffix: s.suffix }
            : {},
        },
      });
    }

    setPipeline(p => {
      snapshot(p);
      return [...p, { ...s, id: stepId, datasetId: pid, ...(gStepId ? { gStepId } : {}) }];
    });
  }, [snapshot, pid, sessionDispatch]);

  // Expose addStep via ref so DataStudio can dispatch patch steps from DataViewer
  useEffect(() => {
    if (addStepRef) addStepRef.current = addStep;
  }); // intentionally no dep array — always keep ref in sync with latest addStep

  // Remove all cell-edit patch steps at once (called from History "clear edits" button)
  const clearPatches = useCallback(() => {
    setPipeline(p => {
      snapshot(p);
      return p.filter(s => s.type !== "patch");
    });
  }, [snapshot]);

  const rmStep = useCallback(i => {
    // Deleting the last step needs no warning — nothing downstream.
    if (i >= pipeline.length - 1) {
      setPipeline(p => { snapshot(p); return p.filter((_, j) => j !== i); });
      return;
    }
    // Mid-pipeline delete — warn the user about downstream steps.
    setPendingDelete({ index: i, downstreamCount: pipeline.length - 1 - i });
  }, [snapshot, pipeline.length]);

  // "Delete this step only" — leaves downstream steps (they may silently degrade).
  // "cascade" — removes this step and everything after it (clean slate from that point).
  const confirmDeleteStep = useCallback(mode => {
    if (!pendingDelete) return;
    const i = pendingDelete.index;
    setPipeline(p => {
      snapshot(p);
      return mode === "cascade" ? p.slice(0, i) : p.filter((_, j) => j !== i);
    });
    setPendingDelete(null);
  }, [pendingDelete, snapshot]);

  const cancelDelete = useCallback(() => setPendingDelete(null), []);

  const rmLastStep = useCallback(() => {
    setPipeline(p => {
      snapshot(p);
      return p.slice(0, -1);
    });
  }, [snapshot]);

  const clear = useCallback(() => {
    setPipeline(p => {
      if (p.length === 0) return p;
      snapshot(p);
      return [];
    });
    setBranchPointIndex(null);
  }, [snapshot]);

  // One-click pipeline replication — atomically replaces the entire pipeline
  // with steps from an imported pipeline.json. Undoable via the History panel.
  const replacePipeline = useCallback(next => {
    if (!Array.isArray(next)) return;
    setPipeline(p => { snapshot(p); return next; });
    setBranchPointIndex(null);
  }, [snapshot]);

  const undo = useCallback(() => {
    if (!undoStack.current.length) return;
    setPipeline(current => {
      const prev = undoStack.current[undoStack.current.length - 1];
      undoStack.current = undoStack.current.slice(0, -1);
      redoStack.current = [current, ...redoStack.current].slice(0, MAX_UNDO);
      return prev;
    });
  }, []);

  const redo = useCallback(() => {
    if (!redoStack.current.length) return;
    setPipeline(current => {
      const next = redoStack.current[0];
      redoStack.current = redoStack.current.slice(1);
      undoStack.current = [...undoStack.current.slice(-MAX_UNDO + 1), current];
      return next;
    });
  }, []);

  const canUndo = undoStack.current.length > 0;
  const canRedo = redoStack.current.length > 0;

  const setBranchPoint = useCallback(i => {
    setBranchPointIndex(prev => prev === i ? null : i);
  }, []);

  // ── Save subset ────────────────────────────────────────────────────────────
  const [showSaveSubset, setShowSaveSubset] = useState(false);
  const [subsetName,     setSubsetName]     = useState("");

  function doSaveSubset() {
    const name = subsetName.trim() ||
      (filename ? filename.replace(/\.[^.]+$/, "") + "_subset.csv" : "subset.csv");
    if (onSaveSubset) onSaveSubset(name, rows, headers);
    setShowSaveSubset(false);
    setSubsetName("");
  }

  const naCount = useMemo(() =>
    rows.filter(r => headers.some(h => { const v = r[h]; return v === null || v === undefined; })).length,
  [rows, headers]);

  const proceed = () => {
    const ci = {};
    headers.forEach(h => {
      const s = rows.find(r => r[h] !== undefined && r[h] !== null);
      ci[h] = { isNumeric: typeof s?.[h] === "number" };
    });
    onComplete({
      headers, cleanRows: rows, colInfo: ci,
      filename,
      issues: [], removed: naCount,
      dataDictionary: dataDictionary || {},
      pipeline,
      loadOpts: rawData?._loadOpts ?? null,
      panelIndex: panel
        ? { entityCol: panel.entityCol, timeCol: panel.timeCol,
            balance: panel.validation?.balance, blockFD: panel.validation?.blockFD }
        : null,
      changeLog: pipeline.map(s => ({
        type: s.type, description: s.desc,
        col: s.col || s.c1 || s.nn || "", map: s.map || null,
      })),
      pipeline,
      branchPointIndex,
      context,
    });
  };

  const qualityBadge = qualityReport?.flags?.filter(f => f.severity !== "ok").length;
  const [aiActionsOpen, setAiActionsOpen] = useState(false);

  return (
    <div style={{ display:"flex", height:"100%", minHeight:0,
      background:C.bg, color:C.text, fontFamily:T.body.fontFamily, overflow:"hidden" }}>

      <div style={{ flex:1, minWidth:0, overflowY:"auto",
        padding:"1.4rem", paddingBottom:"3rem" }}>

        {/* ── Header ── */}
        <div style={{ marginBottom:"1.2rem", display:"flex", alignItems:"flex-start", gap:12 }}>
          <div style={{ flex:1 }}>
            <div style={{ ...T.label, color:C.teal, marginBottom:3 }}>
              Data Studio · Wrangling
            </div>
            <div style={{ fontSize: T.h2.fontSize, letterSpacing:"-0.02em", marginBottom:3 }}>{filename}</div>
            <div style={{ fontSize: T.code.fontSize, color:C.textDim }}>
              <span style={{ color:C.gold }}>
                {rawData._duckdb ? rawData._duckdb.rowCount.toLocaleString() : rawData.rows.length}
              </span> raw ·{" "}
              <span>{rows.length}</span> current ·{" "}
              <span style={{ color: headers.length > rawData.headers.length ? C.green : C.textMuted }}>
                {headers.length}
              </span> cols
              {naCount > 0 && <span style={{ color:C.yellow }}> · {naCount} rows with NAs</span>}
              {isProcessing && (
                <span style={{ color:C.teal, marginLeft:6 }}>
                  {" "}· ⏳ {(elapsedMs / 1000).toFixed(1)}s
                </span>
              )}
            </div>
          </div>

          <div style={{ display:"flex", gap:6, alignItems:"center", flexShrink:0 }}>
            {rawData._duckdb && (
              <span style={{ fontSize: T.caption.fontSize, padding:"2px 6px", border:`1px solid ${C.teal}`,
                color:C.teal, borderRadius:2, letterSpacing:"0.1em",
                fontFamily: T.code.fontFamily, whiteSpace:"nowrap" }}>
                ⚡ DuckDB{rawData._duckdb.truncated ? ` · showing 2,000,000 of ${rawData._duckdb.rowCount.toLocaleString()}` : ""}
              </span>
            )}
            {panel && (
              <span style={{ fontSize: T.caption.fontSize, padding:"2px 6px", border:`1px solid ${C.blue}`,
                color:C.blue, borderRadius:2, letterSpacing:"0.1em",
                fontFamily: T.code.fontFamily, whiteSpace:"nowrap" }}>
                i={panel.entityCol}·t={panel.timeCol}
              </span>
            )}
            {dataDictionary && Object.values(dataDictionary).some(v => v) && (
              <span style={{ fontSize: T.caption.fontSize, padding:"2px 6px", border:`1px solid ${C.violet}`,
                color:C.violet, borderRadius:2, letterSpacing:"0.1em",
                fontFamily: T.code.fontFamily, whiteSpace:"nowrap" }}>
                ◈ dict
              </span>
            )}
            {/* AI Data Actions dropdown */}
            <div style={{ position:"relative" }}>
              <button
                onClick={() => setAiActionsOpen(o => !o)}
                style={{
                  padding:"0.28rem 0.65rem", borderRadius:3, cursor:"pointer",
                  fontFamily: T.code.fontFamily, fontSize: T.caption.fontSize, transition:"all 0.12s",
                  background: aiActionsOpen ? `${C.violet}18` : "transparent",
                  color: aiActionsOpen ? C.violet : C.textDim,
                  border:`1px solid ${aiActionsOpen ? C.violet : C.border2}`,
                }}>
                ✦ AI Actions
              </button>
              {aiActionsOpen && (
                <>
                  <div onClick={() => setAiActionsOpen(false)}
                    style={{ position:"fixed", inset:0, zIndex:98 }} />
                  <div style={{
                    position:"absolute", right:0, top:"calc(100% + 6px)",
                    background:C.surface2, border:`1px solid ${C.border2}`,
                    borderRadius:4, zIndex:99, minWidth:220,
                    boxShadow:"0 8px 24px #000c", overflow:"hidden",
                  }}>
                    <button
                      onClick={() => { setAiActionsOpen(false); setTab("quality"); }}
                      style={{
                        width:"100%", padding:"0.65rem 1rem", textAlign:"left",
                        background:"transparent", border:"none", borderBottom:`1px solid ${C.border}`,
                        cursor:"pointer", fontFamily: T.code.fontFamily, fontSize: T.code.fontSize, color:C.text,
                        transition:"background 0.1s",
                      }}
                      onMouseEnter={e => e.currentTarget.style.background=`${C.violet}18`}
                      onMouseLeave={e => e.currentTarget.style.background="transparent"}
                    >
                      <div style={{ ...T.label, color:C.violet, marginBottom:2 }}>Suggest Cleaning</div>
                      <div style={{ fontSize: T.caption.fontSize, color:C.textDim }}>AI-powered data quality recommendations</div>
                    </button>
                    <button
                      onClick={() => { setAiActionsOpen(false); setTab("dictionary"); }}
                      style={{
                        width:"100%", padding:"0.65rem 1rem", textAlign:"left",
                        background:"transparent", border:"none",
                        cursor:"pointer", fontFamily: T.code.fontFamily, fontSize: T.code.fontSize, color:C.text,
                        transition:"background 0.1s",
                      }}
                      onMouseEnter={e => e.currentTarget.style.background=`${C.violet}18`}
                      onMouseLeave={e => e.currentTarget.style.background="transparent"}
                    >
                      <div style={{ ...T.label, color:C.violet, marginBottom:2 }}>Generate Data Dictionary</div>
                      <div style={{ fontSize: T.caption.fontSize, color:C.textDim }}>Infer variable descriptions with AI</div>
                    </button>
                  </div>
                </>
              )}
            </div>
            <ExportMenu rows={rows} headers={headers} pipeline={pipeline} filename={filename}
              datasetName={filename ? filename.replace(/\.[^.]+$/, "") : "dataset"}
              allDatasets={Object.fromEntries((allDatasets || []).map(d => [d.id, { name: d.name || d.filename, filename: d.filename }]))}/>
            <ImportPipelineButton currentLength={pipeline.length} onImport={replacePipeline} />
            {onSaveSubset && (
              <div style={{ position:"relative" }}>
                <button
                  onClick={() => { setShowSaveSubset(o => !o); setSubsetName(""); }}
                  style={{ padding:"0.28rem 0.65rem", borderRadius:3, cursor:"pointer",
                    fontFamily: T.code.fontFamily, fontSize: T.caption.fontSize, transition:"all 0.12s",
                    background: showSaveSubset ? `${C.teal}18` : "transparent",
                    color: showSaveSubset ? C.teal : C.textDim,
                    border:`1px solid ${showSaveSubset ? C.teal : C.border2}` }}>
                  ⊕ Save as dataset
                </button>
                {showSaveSubset && (
                  <>
                    <div onClick={() => setShowSaveSubset(false)}
                      style={{ position:"fixed", inset:0, zIndex:98 }}/>
                    <div style={{
                      position:"absolute", right:0, top:"calc(100% + 6px)",
                      background:C.surface2, border:`1px solid ${C.border2}`,
                      borderRadius:4, padding:"0.85rem", zIndex:99,
                      minWidth:280, boxShadow:"0 8px 24px #000c",
                    }}>
                      <div style={{ ...T.label, color:C.teal, fontFamily: T.code.fontFamily, marginBottom:6 }}>
                        Save current dataset
                      </div>
                      <div style={{ fontSize: T.caption.fontSize, color:C.textDim, fontFamily: T.code.fontFamily, marginBottom:8, lineHeight:1.5 }}>
                        {rows.length.toLocaleString()} rows · {headers.length} cols
                        {pipeline.length > 0 && ` · ${pipeline.length} pipeline step${pipeline.length !== 1 ? "s" : ""} applied`}
                      </div>
                      <input
                        value={subsetName}
                        onChange={e => setSubsetName(e.target.value)}
                        onKeyDown={e => { if (e.key === "Enter") doSaveSubset(); if (e.key === "Escape") setShowSaveSubset(false); }}
                        placeholder={filename ? filename.replace(/\.[^.]+$/, "") + "_subset.csv" : "subset.csv"}
                        autoFocus
                        style={{ width:"100%", boxSizing:"border-box",
                          padding:"0.38rem 0.6rem", background:C.surface,
                          border:`1px solid ${C.border2}`, borderRadius:3,
                          color:C.text, fontFamily: T.code.fontFamily, fontSize: T.code.fontSize,
                          outline:"none", marginBottom:8 }}/>
                      <button onClick={doSaveSubset} style={{
                        width:"100%", padding:"0.42rem",
                        background:C.teal, color:C.bg,
                        border:`1px solid ${C.teal}`, borderRadius:3,
                        cursor:"pointer", fontFamily: T.code.fontFamily, fontSize: T.code.fontSize, fontWeight:700,
                      }}>
                        Add to Dataset Manager →
                      </button>
                    </div>
                  </>
                )}
              </div>
            )}
            {pipeline.length > 0 && (
              <button
                onClick={() => {
                  const trail = auditPipeline(rawData.rows, rawData.headers, pipeline, context);
                  setAuditTrail(trail);
                }}
                style={{ padding:"0.28rem 0.65rem", borderRadius:3, cursor:"pointer",
                  fontFamily: T.code.fontFamily, fontSize: T.caption.fontSize, transition:"all 0.12s",
                  background:"transparent", color:C.teal,
                  border:`1px solid ${C.teal}` }}>
                ◈ Audit
              </button>
            )}
            <button onClick={proceed} style={{ padding:"0.28rem 0.65rem", borderRadius:3,
              cursor:"pointer", fontFamily: T.code.fontFamily, fontSize: T.caption.fontSize,
              background:C.gold, color:C.bg,
              border:`1px solid ${C.gold}`, fontWeight:700 }}>
              Proceed →
            </button>
          </div>
        </div>

        <HintBox color={C.teal} title="How to wrangle" sections={[
          { heading: "Pipeline", items: [
            "Non-destructive: every step replays on raw data — nothing is permanently changed",
            "Undo any step from the History sidebar on the left",
            "Steps are auto-saved and restored on reload",
          ]},
          { heading: "Clean", items: [
            "Rename, drop columns / rows",
            "Filter: keep rows matching a condition",
            "Fill missing: mean, median, mode, forward/backward fill, constant, grouped fill",
            "Recode: map specific values to new labels",
            "Normalize categories: merge near-identical string variants",
            "Winsorize / Trim outliers / Flag outliers",
            "Extract regex: pull values from text columns",
            "AI Transform: describe a transformation in plain English",
          ]},
          { heading: "Feature Engineering", items: [
            "Log transform (log1p — safe for zeros)",
            "Square, standardize (z-score)",
            "Dummy encode: one-hot for a categorical column",
            "Lag / Lead: shift by t periods — groups by entity to prevent cross-unit contamination",
            "First difference (diff)",
            "Interaction term: A × B",
            "DiD interaction: creates treat × post for difference-in-differences",
            "Date parse / extract: year, month, quarter from date strings",
            "Mutate: custom JS expression (e.g. col_a / col_b * 100)",
          ]},
          { heading: "Panel Structure", items: [
            "Panel tab: declare entity column (i) and time column (t)",
            "Required to unlock FE, FD, TWFE, DiD, and Event Study in the Model tab",
          ]},
          { heading: "Reshape & Merge", items: [
            "Arrange: sort rows by one or more columns",
            "Group summarize: aggregate (mean, sum, count, min, max) by group",
            "Pivot longer: wide → long format",
            "Merge: LEFT or INNER join another dataset on a key column",
            "Append: UNION ALL — stack rows from a second dataset",
          ]},
        ]} />

        {/* ── Tab bar ── */}
        <Tabs tabs={[
          ["clean",     "⬡ Cleaning"],
          ["quality",   `◈ Quality${qualityBadge > 0 ? ` (${qualityBadge})` : "  ✓"}`],
          ["structure", "⊞ Panel Structure"],
          ["transform", "⊕ Transform"],
          ["dictionary","◈ Dictionary"],
          ["reshape",   "⟲ Reshape & Merge"],
        ]} active={tab} set={setTab}/>

        {/* ── AI command bar (NL → validated pipeline steps) ── */}
        <NLCommandBar rows={rows} headers={headers} onAddSteps={steps => steps.forEach(addStep)} />

        {/* ── Tab panels ── */}
        {tab === "clean" && (
          <CleanTab rows={rows} headers={headers} info={info} rawData={rawData} pipeline={pipeline} onAdd={addStep}/>
        )}
        {tab === "quality" && (
          <DataQualityReport
            report={qualityReport}
            rows={rows}
            onApplyStep={s => addStep(s)}
            onExportMd={() => {
              const md   = exportMarkdown(qualityReport);
              const blob = new Blob([md], { type:"text/markdown" });
              const a    = document.createElement("a");
              a.href     = URL.createObjectURL(blob);
              a.download = (filename ? filename.replace(/\.[^.]+$/, "") : "dataset") + "_quality_report.md";
              a.click(); URL.revokeObjectURL(a.href);
            }}
          />
        )}
        {tab === "structure" && (
          <PanelTab rows={rows} headers={headers} panel={panel} setPanel={setPanel} onAdd={addStep}/>
        )}
        {tab === "transform" && (
          <FeatureTab rows={rows} headers={headers} panel={panel} info={info} onAdd={addStep} duckdbTableName={rawData?._duckdb?.tableName}/>
        )}
        {tab === "reshape" && (
          <div>
            <div style={{marginBottom:"0.75rem",fontSize: T.caption.fontSize,color:C.teal,letterSpacing:"0.18em",textTransform:"uppercase",fontFamily: T.code.fontFamily}}>
              Reshape
            </div>
            <ReshapeTab rows={rows} headers={headers} info={info} onAdd={addStep}/>
            <div style={{margin:"1.2rem 0 0.75rem",borderTop:`1px solid ${C.border}`,paddingTop:"1.2rem"}}>
              <div style={{marginBottom:"0.75rem",fontSize: T.caption.fontSize,color:C.gold,letterSpacing:"0.18em",textTransform:"uppercase",fontFamily: T.code.fontFamily}}>
                Merge
              </div>
              <MergeTab rows={rows} headers={headers} filename={filename}
                allDatasets={allDatasets} onAdd={addStep}/>
            </div>
          </div>
        )}
        {tab === "dictionary" && (
          <DictionaryTab headers={headers} rows={rows}
            dict={dataDictionary} setDict={setDataDictionary}/>
        )}
      </div>

      <History
        pipeline={pipeline}
        onRm={rmStep}
        onClear={clear}
        onClearPatches={clearPatches}
        onUndo={undo}
        onRedo={redo}
        canUndo={canUndo}
        canRedo={canRedo}
        branchPointIndex={branchPointIndex}
        onSetBranch={setBranchPoint}
        pendingDelete={pendingDelete}
        onConfirmDelete={confirmDeleteStep}
        onCancelDelete={cancelDelete}
      />

      {auditTrail && (
        <AuditTrail
          trail={auditTrail}
          filename={filename}
          onClose={() => setAuditTrail(null)}
        />
      )}
    </div>
  );
}
