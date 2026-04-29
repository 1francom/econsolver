// ─── ECON STUDIO · WranglingModule.jsx ───────────────────────────────────────
// Root orchestrator. Owns pipeline state, runs the pipeline, routes tabs.
// All UI is delegated to components/wrangling/*.jsx
// ~110 lines — add features in the tab files, not here.

import { useState, useCallback, useMemo, useEffect, useRef } from "react";
import { applyStep, runPipeline }  from "./pipeline/runner.js";
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
import DataQualityReport from "./components/wrangling/DataQualityReport.jsx";
import AuditTrail        from "./components/validation/AuditTrail.jsx";
import { auditPipeline } from "./pipeline/auditor.js";

// ── Shared atoms ───────────────────────────────────────────────────────────
import { C, mono, Tabs } from "./components/wrangling/shared.jsx";

// ── Persistence — IndexedDB (replaces localStorage 5MB cap) ───────────────
import {
  loadPipeline,
  savePipeline,
  saveRawData,
  migrateFromLocalStorage,
} from "./services/Persistence/indexedDB.js";

// ── Session state — two-tier pipeline registry ─────────────────────────────
import { useSessionDispatch } from "./services/session/sessionState.jsx";

// ── Re-exports (consumed by ModelingTab and other modules) ─────────────────
export { validatePanel, buildInfo }   from "./pipeline/validator.js";
export { applyStep, runPipeline }     from "./pipeline/runner.js";
export { fuzzyGroups }                from "./components/wrangling/utils.js";
export { Grid }                       from "./components/wrangling/shared.jsx";

// ─── ROOT ─────────────────────────────────────────────────────────────────────
export default function WranglingModule({ rawData, filename, onComplete, pid, allDatasets = [], onSaveSubset }) {
  // Session dispatch — may be null when rendered outside SessionStateProvider (tests/legacy)
  const sessionDispatch = useSessionDispatch();

  // State starts empty — IndexedDB load is async (see useEffect below)
  const [pipeline,         setPipeline]        = useState([]);
  const [panel,            setPanel]            = useState(null);
  const [dataDictionary,   setDataDictionary]   = useState(null);
  const [tab,              setTab]              = useState("clean");
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
      const rec = await loadPipeline(pid);
      if (cancelled) return;
      if (rec) {
        if (rec.pipeline)            setPipeline(rec.pipeline);
        if (rec.panel)               setPanel(rec.panel);
        if (rec.dataDictionary)      setDataDictionary(rec.dataDictionary);
        if (rec.branchPointIndex != null) setBranchPointIndex(rec.branchPointIndex);
      }
      setIdbReady(true);
    })();
    return () => { cancelled = true; };
  }, [pid]);

  const context = useMemo(() => ({
    datasets: Object.fromEntries((allDatasets || []).map(d => [d.id, d.rawData]))
  }), [allDatasets]);

  const { rows, headers } = useMemo(() => {
    const init = rawData.rows.map(r => {
      const c = {}; rawData.headers.forEach(h => { c[h] = r[h] ?? null; }); return c;
    });
    return runPipeline(init, rawData.headers, pipeline, context);
  }, [rawData, pipeline, context]);

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
      savePipeline(pid, {
        filename, pipeline, panel, dataDictionary, branchPointIndex,
        rowCount: rawData.rows.length, colCount: rawData.headers.length,
        pipelineLength: pipeline.length,
      });
      // Persist raw dataset once per session (skip if already stored this session)
      if (!rawDataSaved.current) {
        saveRawData(pid, rawData).then(({ stored }) => {
          if (stored) rawDataSaved.current = true;
        });
      }
    }, 400);
    return () => clearTimeout(saveTimer.current);
  }, [pipeline, panel, dataDictionary, idbReady]);

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
      panelIndex: panel
        ? { entityCol: panel.entityCol, timeCol: panel.timeCol,
            balance: panel.validation?.balance, blockFE: panel.validation?.blockFE }
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
      background:C.bg, color:C.text, fontFamily:mono, overflow:"hidden" }}>

      <div style={{ flex:1, minWidth:0, overflowY:"auto",
        padding:"1.4rem", paddingBottom:"3rem" }}>

        {/* ── Header ── */}
        <div style={{ marginBottom:"1.2rem", display:"flex", alignItems:"flex-start", gap:12 }}>
          <div style={{ flex:1 }}>
            <div style={{ fontSize:9, color:"#6ec8b4", letterSpacing:"0.26em",
              textTransform:"uppercase", marginBottom:3 }}>
              Data Studio · Wrangling
            </div>
            <div style={{ fontSize:19, letterSpacing:"-0.02em", marginBottom:3 }}>{filename}</div>
            <div style={{ fontSize:11, color:"#888" }}>
              <span style={{ color:"#c8a96e" }}>{rawData.rows.length}</span> raw ·{" "}
              <span>{rows.length}</span> current ·{" "}
              <span style={{ color: headers.length > rawData.headers.length ? "#7ab896" : "#444" }}>
                {headers.length}
              </span> cols
              {naCount > 0 && <span style={{ color:"#c8b46e" }}> · {naCount} rows with NAs</span>}
            </div>
          </div>

          <div style={{ display:"flex", gap:6, alignItems:"center", flexShrink:0 }}>
            {panel && (
              <span style={{ fontSize:9, padding:"2px 6px", border:"1px solid #6e9ec8",
                color:"#6e9ec8", borderRadius:2, letterSpacing:"0.1em",
                fontFamily:mono, whiteSpace:"nowrap" }}>
                i={panel.entityCol}·t={panel.timeCol}
              </span>
            )}
            {dataDictionary && Object.values(dataDictionary).some(v => v) && (
              <span style={{ fontSize:9, padding:"2px 6px", border:"1px solid #9e7ec8",
                color:"#9e7ec8", borderRadius:2, letterSpacing:"0.1em",
                fontFamily:mono, whiteSpace:"nowrap" }}>
                ◈ dict
              </span>
            )}
            {/* AI Data Actions dropdown */}
            <div style={{ position:"relative" }}>
              <button
                onClick={() => setAiActionsOpen(o => !o)}
                style={{
                  padding:"0.28rem 0.65rem", borderRadius:3, cursor:"pointer",
                  fontFamily:mono, fontSize:10, transition:"all 0.12s",
                  background: aiActionsOpen ? `${"#9e7ec8"}18` : "transparent",
                  color: aiActionsOpen ? "#9e7ec8" : "#888",
                  border:`1px solid ${aiActionsOpen ? "#9e7ec8" : "#252525"}`,
                }}>
                ✦ AI Actions
              </button>
              {aiActionsOpen && (
                <>
                  <div onClick={() => setAiActionsOpen(false)}
                    style={{ position:"fixed", inset:0, zIndex:98 }} />
                  <div style={{
                    position:"absolute", right:0, top:"calc(100% + 6px)",
                    background:"#131313", border:"1px solid #252525",
                    borderRadius:4, zIndex:99, minWidth:220,
                    boxShadow:"0 8px 24px #000c", overflow:"hidden",
                  }}>
                    <button
                      onClick={() => { setAiActionsOpen(false); setTab("quality"); }}
                      style={{
                        width:"100%", padding:"0.65rem 1rem", textAlign:"left",
                        background:"transparent", border:"none", borderBottom:"1px solid #1c1c1c",
                        cursor:"pointer", fontFamily:mono, fontSize:11, color:"#ddd8cc",
                        transition:"background 0.1s",
                      }}
                      onMouseEnter={e => e.currentTarget.style.background="#9e7ec818"}
                      onMouseLeave={e => e.currentTarget.style.background="transparent"}
                    >
                      <div style={{ fontSize:9, color:"#9e7ec8", letterSpacing:"0.14em", textTransform:"uppercase", marginBottom:2 }}>Suggest Cleaning</div>
                      <div style={{ fontSize:9, color:"#888" }}>AI-powered data quality recommendations</div>
                    </button>
                    <button
                      onClick={() => { setAiActionsOpen(false); setTab("dictionary"); }}
                      style={{
                        width:"100%", padding:"0.65rem 1rem", textAlign:"left",
                        background:"transparent", border:"none",
                        cursor:"pointer", fontFamily:mono, fontSize:11, color:"#ddd8cc",
                        transition:"background 0.1s",
                      }}
                      onMouseEnter={e => e.currentTarget.style.background="#9e7ec818"}
                      onMouseLeave={e => e.currentTarget.style.background="transparent"}
                    >
                      <div style={{ fontSize:9, color:"#9e7ec8", letterSpacing:"0.14em", textTransform:"uppercase", marginBottom:2 }}>Generate Data Dictionary</div>
                      <div style={{ fontSize:9, color:"#888" }}>Infer variable descriptions with AI</div>
                    </button>
                  </div>
                </>
              )}
            </div>
            <ExportMenu rows={rows} headers={headers} pipeline={pipeline} filename={filename}
              datasetName={filename ? filename.replace(/\.[^.]+$/, "") : "dataset"}
              allDatasets={Object.fromEntries((allDatasets || []).map(d => [d.id, { name: d.name || d.filename, filename: d.filename }]))}/>
            {onSaveSubset && (
              <div style={{ position:"relative" }}>
                <button
                  onClick={() => { setShowSaveSubset(o => !o); setSubsetName(""); }}
                  style={{ padding:"0.28rem 0.65rem", borderRadius:3, cursor:"pointer",
                    fontFamily:mono, fontSize:10, transition:"all 0.12s",
                    background: showSaveSubset ? `${"#6ec8b4"}18` : "transparent",
                    color: showSaveSubset ? "#6ec8b4" : "#888",
                    border:`1px solid ${showSaveSubset ? "#6ec8b4" : "#252525"}` }}>
                  ⊕ Save as dataset
                </button>
                {showSaveSubset && (
                  <>
                    <div onClick={() => setShowSaveSubset(false)}
                      style={{ position:"fixed", inset:0, zIndex:98 }}/>
                    <div style={{
                      position:"absolute", right:0, top:"calc(100% + 6px)",
                      background:"#131313", border:"1px solid #252525",
                      borderRadius:4, padding:"0.85rem", zIndex:99,
                      minWidth:280, boxShadow:"0 8px 24px #000c",
                    }}>
                      <div style={{ fontSize:9, color:"#6ec8b4", letterSpacing:"0.18em",
                        textTransform:"uppercase", fontFamily:mono, marginBottom:6 }}>
                        Save current dataset
                      </div>
                      <div style={{ fontSize:10, color:"#888", fontFamily:mono, marginBottom:8, lineHeight:1.5 }}>
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
                          padding:"0.38rem 0.6rem", background:"#0f0f0f",
                          border:"1px solid #252525", borderRadius:3,
                          color:"#ddd8cc", fontFamily:mono, fontSize:11,
                          outline:"none", marginBottom:8 }}/>
                      <button onClick={doSaveSubset} style={{
                        width:"100%", padding:"0.42rem",
                        background:"#6ec8b4", color:"#080808",
                        border:"1px solid #6ec8b4", borderRadius:3,
                        cursor:"pointer", fontFamily:mono, fontSize:11, fontWeight:700,
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
                  fontFamily:mono, fontSize:10, transition:"all 0.12s",
                  background:"transparent", color:"#6ec8b4",
                  border:"1px solid #6ec8b4" }}>
                ◈ Audit
              </button>
            )}
            <button onClick={proceed} style={{ padding:"0.28rem 0.65rem", borderRadius:3,
              cursor:"pointer", fontFamily:mono, fontSize:10,
              background:"#c8a96e", color:"#080808",
              border:"1px solid #c8a96e", fontWeight:700 }}>
              Proceed →
            </button>
          </div>
        </div>

        {/* ── Tab bar ── */}
        <Tabs tabs={[
          ["clean",     "⬡ Cleaning"],
          ["quality",   `◈ Quality${qualityBadge > 0 ? ` (${qualityBadge})` : "  ✓"}`],
          ["structure", "⊞ Panel Structure"],
          ["features",  "⊕ Features"],
          ["reshape",   "⟲ Reshape"],
          ["merge",     "⊞ Merge"],
          ["dictionary","◈ Dictionary"],
        ]} active={tab} set={setTab}/>

        {/* ── Tab panels ── */}
        {tab === "clean" && (
          <CleanTab rows={rows} headers={headers} info={info} rawData={rawData} onAdd={addStep}/>
        )}
        {tab === "quality" && (
          <DataQualityReport
            report={qualityReport}
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
          <PanelTab rows={rows} headers={headers} panel={panel} setPanel={setPanel}/>
        )}
        {tab === "features" && (
          <FeatureTab rows={rows} headers={headers} panel={panel} info={info} onAdd={addStep}/>
        )}
        {tab === "reshape" && (
          <ReshapeTab rows={rows} headers={headers} info={info} onAdd={addStep} onRmLastStep={rmLastStep} onSaveSubset={onSaveSubset} filename={filename}/>
        )}
        {tab === "merge" && (
          <MergeTab rows={rows} headers={headers} filename={filename}
            allDatasets={allDatasets} onAdd={addStep}/>
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
