// ─── ECON STUDIO · WranglingModule.jsx ───────────────────────────────────────
// Root orchestrator. Owns pipeline state, runs the pipeline, routes tabs.
// All UI is delegated to components/wrangling/*.jsx
// ~110 lines — add features in the tab files, not here.

import { useState, useCallback, useMemo, useEffect, useRef } from "react";
import { HintBox } from "./components/HelpSystem.jsx";
import { applyStep, runPipeline, runPipelineAsync } from "./pipeline/runner.js";
import { validatePanel, buildInfo } from "./pipeline/validator.js";
import { freezeParent } from "./pipeline/lineage.js";
import { buildDataQualityReport, exportMarkdown } from "./core/validation/dataQuality.js";

// ── Tab components ─────────────────────────────────────────────────────────
import CleanTab        from "./components/wrangling/CleanTab.jsx";
import PanelTab        from "./components/wrangling/PanelTab.jsx";
import WorkbenchTab    from "./components/wrangling/WorkbenchTab.jsx";
import DictionaryTab   from "./components/wrangling/DictionaryTab.jsx";
import History         from "./components/wrangling/History.jsx";
import ExportMenu      from "./components/wrangling/ExportMenu.jsx";
import ImportPipelineButton from "./components/wrangling/ImportPipelineButton.jsx";
import DataQualityReport from "./components/wrangling/DataQualityReport.jsx";
import NLCommandBar     from "./components/wrangling/NLCommandBar.jsx";
import DistinctValuesPanel from "./components/wrangling/DistinctValuesPanel.jsx";
import AuditTrail        from "./components/validation/AuditTrail.jsx";
import { auditPipeline } from "./pipeline/auditor.js";

// ── Shared atoms ───────────────────────────────────────────────────────────
import { useTheme, Tabs, Lbl, Grid } from "./components/wrangling/shared.jsx";
import { useContainerWidth } from "./hooks/useContainerWidth.js";

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
import { useSessionLogOptional } from "./services/session/sessionLog.jsx";

// ── Re-exports (consumed by ModelingTab and other modules) ─────────────────
export { validatePanel, buildInfo }   from "./pipeline/validator.js";
export { applyStep, runPipeline, runPipelineAsync } from "./pipeline/runner.js";
import { buildDatasetContext, referencedDatasetIds } from "./pipeline/datasetContext.js";
export { fuzzyGroups }                from "./components/wrangling/utils.js";
export { Grid }                       from "./components/wrangling/shared.jsx";

// ─── ROOT ─────────────────────────────────────────────────────────────────────
export default function WranglingModule({ rawData, filename, onComplete, onReady, pid, projectPid, allDatasets = [], onSaveSubset, addStepRef, assistantPrefill = null, onConsumePrefill = null }) {
  // Per-dataset pipelines are stored under the parent project's pid (Phase 0.2
  // schema). Fall back to `pid` so single-dataset legacy paths still work —
  // they treat the project pid and the primary dataset id as the same value.
  const ownerPid = projectPid || pid;
  const { C, T } = useTheme();
  // Session dispatch — may be null when rendered outside SessionStateProvider (tests/legacy)
  const sessionDispatch = useSessionDispatch();
  // Execution-timeline emitter (Fase 1.2) — no-op when outside the provider.
  const { appendLog } = useSessionLogOptional();

  // State starts empty — IndexedDB load is async (see useEffect below)
  const [pipeline,         setPipeline]        = useState([]);
  const [panel,            setPanel]            = useState(null);
  const [dataDictionary,   setDataDictionary]   = useState(null);
  const [tab,              setTab]              = useState(() => {
    // Old sub-tab values ("transform"/"reshape") collapsed into the merged
    // "workbench" tab — remap so a returning session lands on a live tab.
    const saved = sessionStorage.getItem(`litux:wrangle_tab:${pid}`);
    return (saved === "transform" || saved === "reshape") ? "workbench"
         : saved || "clean";
  });
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

  // ── Join/append context ────────────────────────────────────────────────────
  // This used to be `Object.fromEntries(allDatasets.map(d => [d.id, d.rawData]))`,
  // i.e. every referenced dataset in its ORIGINAL state. A join therefore pulled
  // the right dataset's raw rows and silently ignored every cleaning step
  // applied to it — nothing errored, you just merged the wrong data
  // (feedback 2026-07-31). Each referenced dataset now has its own pipeline
  // replayed first; see datasetContext.js for the recursion/cycle rules.
  //
  // null = not built yet. The pipeline effect below waits for it rather than
  // running once with an empty context, which would make a join briefly no-op
  // and then flip — the kind of flicker that reads as a race.
  const [context, setContext] = useState(null);
  const [contextWarnings, setContextWarnings] = useState([]);
  // Per-dataset pipelines for every OTHER dataset, loaded from IDB by the effect
  // below. addStep needs them to freeze a join's right operand (see lineage.js).
  const [rightPipelines, setRightPipelines] = useState({});
  // Rebuild only when the SET of referenced datasets changes — not on every
  // step. Depending on `pipeline` itself would replay every other dataset's
  // pipeline (and re-extract whole DuckDB tables) on each edit.
  const refIdKey = useMemo(() => referencedDatasetIds(pipeline).sort().join("|"), [pipeline]);

  // Every other dataset's pipeline, loaded once per project. Deliberately NOT
  // folded into the context effect below: that one early-returns while nothing
  // is referenced yet, which is exactly the moment the user stages their FIRST
  // join — the frozen right snapshot would then be [], silently claiming the
  // right dataset had no pipeline.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const { loadProjectPipelines } = await import("./services/Persistence/indexedDB.js");
        const byId = (await loadProjectPipelines(ownerPid))?.datasetPipelines ?? {};
        if (!cancelled) setRightPipelines(byId);
      } catch { /* no IDB record yet — freezeParent records an empty snapshot */ }
    })();
    return () => { cancelled = true; };
  }, [ownerPid, allDatasets]);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const others = allDatasets || [];
      const only = refIdKey ? refIdKey.split("|") : [];
      if (!others.length || !only.length) {
        if (!cancelled) { setContext({ datasets: {} }); setContextWarnings([]); }
        return;
      }
      let stepsById = {};
      try {
        const { loadProjectPipelines } = await import("./services/Persistence/indexedDB.js");
        stepsById = (await loadProjectPipelines(ownerPid))?.datasetPipelines ?? {};
      } catch { /* no IDB record yet — every dataset resolves to its raw rows */ }
      // A DuckDB-backed dataset's rawData.rows is only the 500-row preview, so
      // replaying its pipeline over that would join against 500 rows and report
      // no error. Pull the full table for exactly those datasets.
      const loadRows = async (ds) => {
        const tbl = ds.rawData?._duckdb?.tableName;
        if (tbl) {
          const { extractAllRows } = await import("./services/data/duckdb.js");
          return { rows: await extractAllRows(tbl), headers: ds.rawData.headers };
        }
        return { rows: ds.rawData.rows, headers: ds.rawData.headers };
      };
      const pipelineFor = (id) => {
        const rec = stepsById[id];
        return Array.isArray(rec?.steps) ? rec.steps
             : Array.isArray(rec?.pipeline) ? rec.pipeline
             : [];
      };
      try {
        const built = await buildDatasetContext(others, pipelineFor, loadRows, { only });
        if (!cancelled) { setContext({ datasets: built.datasets }); setContextWarnings(built.warnings); }
      } catch (e) {
        console.error("[WranglingModule] dataset context build failed — falling back to raw:", e);
        if (!cancelled) {
          setContext({ datasets: Object.fromEntries(others.map(d => [d.id, d.rawData])) });
          setContextWarnings(["Could not replay the other datasets' pipelines — joins are using their original rows."]);
        }
      }
    })();
    return () => { cancelled = true; };
  }, [allDatasets, ownerPid, refIdKey]);

  // ── Pipeline execution: DuckDB path (async) or JS path (deferred) ──────────
  // Initial state: raw rows, no cloning — pipeline runs after first paint.
  // All applyStep handlers use .map() and never mutate rawData.rows in-place,
  // so passing the reference directly is safe.
  const [processed,    setProcessed]    = useState({ rows: rawData.rows, headers: rawData.headers, _duckdb: rawData._duckdb ?? null });
  const [isProcessing, setIsProcessing] = useState(false);
  // A step may throw by design — `lookup` refuses to run when its right key is
  // not unique. runPipeline is called inside a setTimeout, so an uncaught throw
  // there would leave isProcessing stuck true with nothing on screen.
  const [pipelineError, setPipelineError] = useState(null);
  const [elapsedMs,    setElapsedMs]    = useState(0);
  const timerRef = useRef(null);

  // Distinct-values panel. Held at module level (not inside a tab) so it
  // survives switching between Clean's sub-tabs — see the render site below.
  const [distinctCol,       setDistinctCol]       = useState(null);  // string | null — null = closed
  const [distinctMinimized, setDistinctMinimized] = useState(false);
  const openDistinct = useCallback(col => {
    setDistinctCol(col);
    // Requesting a column is an explicit "show me this" action, so always
    // re-expand rather than leaving the panel collapsed.
    setDistinctMinimized(false);
  }, []);

  useEffect(() => {
    let cancelled = false;
    // Wait for the join/append context. Running once without it would make any
    // join silently produce zero merged columns, then flip once it arrived.
    if (context === null) return;

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
        import("./services/data/duckdb.js").then(({ getDuckDB, extractAllRows }) =>
          getDuckDB().then(({ conn }) =>
            // `context` was NOT passed here before, so on a DuckDB-backed
            // dataset a join step found no right dataset and became a complete
            // no-op — both in the SQL translation and in the JS fallback it
            // hands off to. Same user-visible symptom as the raw-context bug
            // above ("changes don't merge"), different mechanism.
            runPipelineDuck(rawData._duckdb.tableName, rawData.headers, pipeline, conn, context)
              .then(done)
              .catch(e => {
                console.error("[WranglingModule] DuckDB pipeline failed, falling to JS:", e);
                // JS fallback — rawData.rows is only a 500-row preview for DuckDB
                // datasets, so pull the full table before running the JS pipeline.
                extractAllRows(rawData._duckdb.tableName)
                  .catch(() => rawData.rows)
                  .then(fullRows => {
                    if (cancelled) return;
                    try {
                      setPipelineError(null);
                      done(runPipeline(fullRows, rawData.headers, pipeline, context));
                    } catch (err) {
                      setPipelineError(err?.message ?? "Pipeline step failed.");
                      done({ rows: fullRows, headers: rawData.headers });
                    }
                  });
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
            if (cancelled) return;
            try {
              setPipelineError(null);
              done(runPipeline(rawData.rows, rawData.headers, pipeline, context));
            } catch (err) {
              setPipelineError(err?.message ?? "Pipeline step failed.");
              done({ rows: rawData.rows, headers: rawData.headers });
            }
          });
      } else {
        const timerId = setTimeout(() => {
          if (cancelled) return;
          try {
            setPipelineError(null);
            done(runPipeline(rawData.rows, rawData.headers, pipeline, context));
          } catch (e) {
            setPipelineError(e?.message ?? "Pipeline step failed.");
            done({ rows: rawData.rows, headers: rawData.headers });
          }
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
            feCols: panel.feCols, interactionCols: panel.interactionCols,
            balance: panel.validation?.balance, blockFD: panel.validation?.blockFD }
        : null,
      _duckdb: processed._duckdb ?? null,
      _duckdbRestoreFailed: rawData?._duckdbRestoreFailed ?? false,
      _expectedRowCount: rawData?._expectedRowCount ?? null,
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
    if (sessionDispatch && (s.type === "join" || s.type === "append" || s.type === "lookup")) {
      gStepId = `G_${stepId}`;
      const selfDs  = { id: pid, name: filename, filename, loadOpts: rawData?._loadOpts ?? null };
      const rightDs = (allDatasets ?? []).find(d => d.id === s.rightId) ?? null;
      const rightRec  = rightPipelines?.[s.rightId] ?? {};
      const rightPipe = Array.isArray(rightRec.steps) ? rightRec.steps
                      : Array.isArray(rightRec.pipeline) ? rightRec.pipeline
                      : [];
      sessionDispatch({
        type: "ADD_GLOBAL_STEP",
        step: {
          id:              gStepId,
          v:               2,
          localStepId:     stepId,
          opType:          s.type === "join" ? `${s.how || "left"}_join` : s.type,
          leftDatasetId:   pid,
          rightDatasetId:  s.rightId,
          // Forma 2 (default): the result augments the LEFT dataset in place.
          outputDatasetId: s.outputDatasetId ?? pid,
          params:          (s.type === "join" || s.type === "lookup")
            ? { how: s.how ?? null, leftKey: s.leftKey, rightKey: s.rightKey, suffix: s.suffix }
            : {},
          // Frozen, self-sufficient parent records — see pipeline/lineage.js.
          // Captured BEFORE this step is appended, so the snapshot is exactly the
          // state the join consumed.
          left:  freezeParent(selfDs, pipeline),
          right: rightDs
            ? freezeParent({ id:       rightDs.id,
                             name:     rightDs.name ?? rightDs.filename,
                             filename: rightDs.filename ?? null,
                             loadOpts: rightDs.rawData?._loadOpts ?? null },
                           rightPipe)
            : null,
        },
      });
    }

    setPipeline(p => {
      snapshot(p);
      return [...p, { ...s, id: stepId, datasetId: pid, ...(gStepId ? { gStepId } : {}) }];
    });
    appendLog({
      module: "clean", opType: "pipeline_step", datasetId: pid,
      params: { stepType: s.type, desc: s.desc ?? s.description ?? null, ...(gStepId ? { gStepId } : {}) },
      label:  `[${filename ?? pid}] ${s.type}${s.desc ? " — " + s.desc : ""}`,
    });
    // `pipeline`, `allDatasets`, `rightPipelines` and `rawData` are load-bearing
    // deps: freezeParent reads them at call time. Omitting `pipeline` would
    // freeze whatever it was on first render — an empty array — which is the
    // stale-closure class of bug that hit estimate() for SC/EventStudy/LSDV.
  }, [snapshot, pid, sessionDispatch, appendLog, filename,
      pipeline, allDatasets, rightPipelines, rawData]);

  // Forma 1: run the staged joins against the CURRENT rows and save the result
  // as a NEW dataset, leaving this pipeline untouched. Provenance lives in the
  // child's frozen record (see pipeline/lineage.js), so editing or deleting this
  // dataset later cannot break the child's replication script.
  const forkJoin = useCallback((name, staged) => {
    if (!onSaveSubset || !Array.isArray(staged) || !staged.length) return;
    let cur = { rows, headers };
    try {
      for (const j of staged) {
        cur = applyStep(cur.rows, cur.headers, { ...j, type: "join" }, context ?? { datasets: {} });
      }
    } catch (e) {
      setPipelineError(e?.message ?? "Join failed.");
      return;
    }
    const parentFrozen = freezeParent(
      { id: pid, name: filename, filename, loadOpts: rawData?._loadOpts ?? null },
      pipeline
    );
    const joinRecords = staged.map(j => {
      const rd = (allDatasets ?? []).find(d => d.id === j.rightId) ?? { id: j.rightId };
      const rec = rightPipelines?.[j.rightId] ?? {};
      const rp  = Array.isArray(rec.steps) ? rec.steps
                : Array.isArray(rec.pipeline) ? rec.pipeline
                : [];
      return {
        how: j.how ?? "left", leftKey: j.leftKey, rightKey: j.rightKey, suffix: j.suffix ?? "_r",
        right: freezeParent({ id:       rd.id,
                              name:     rd.name ?? rd.filename,
                              filename: rd.filename ?? null,
                              loadOpts: rd.rawData?._loadOpts ?? null }, rp),
      };
    });
    setPipelineError(null);
    onSaveSubset(name, cur.rows, cur.headers, null, { parent: parentFrozen, joins: joinRecords });
  }, [rows, headers, context, pid, filename, rawData, pipeline,
      onSaveSubset, allDatasets, rightPipelines]);

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

  // A cross-dataset step owns a G-step in the global pipeline. Removing the
  // local step without removing its G-step leaves the exporter emitting a join
  // the app no longer performs — a script that silently disagrees with the app.
  const dropGStepFor = useCallback(step => {
    if (step?.gStepId && sessionDispatch) {
      sessionDispatch({ type: "REMOVE_GLOBAL_STEP", id: step.gStepId });
    }
  }, [sessionDispatch]);

  const rmStep = useCallback(i => {
    // Deleting the last step needs no warning — nothing downstream.
    if (i >= pipeline.length - 1) {
      dropGStepFor(pipeline[i]);
      setPipeline(p => { snapshot(p); return p.filter((_, j) => j !== i); });
      return;
    }
    // Mid-pipeline delete — warn the user about downstream steps.
    setPendingDelete({ index: i, downstreamCount: pipeline.length - 1 - i });
  }, [snapshot, pipeline, dropGStepFor]);

  // "Delete this step only" — leaves downstream steps (they may silently degrade).
  // "cascade" — removes this step and everything after it (clean slate from that point).
  const confirmDeleteStep = useCallback(mode => {
    if (!pendingDelete) return;
    const i = pendingDelete.index;
    // Cascade removes this step AND everything after it, so every G-step owned
    // by that tail goes too — not just the one at index i.
    (mode === "cascade" ? pipeline.slice(i) : [pipeline[i]]).forEach(dropGStepFor);
    setPipeline(p => {
      snapshot(p);
      return mode === "cascade" ? p.slice(0, i) : p.filter((_, j) => j !== i);
    });
    setPendingDelete(null);
  }, [pendingDelete, snapshot, pipeline, dropGStepFor]);

  const cancelDelete = useCallback(() => setPendingDelete(null), []);

  const rmLastStep = useCallback(() => {
    dropGStepFor(pipeline[pipeline.length - 1]);
    setPipeline(p => {
      snapshot(p);
      return p.slice(0, -1);
    });
  }, [snapshot, pipeline, dropGStepFor]);

  const clear = useCallback(() => {
    pipeline.forEach(dropGStepFor);
    setPipeline(p => {
      if (p.length === 0) return p;
      snapshot(p);
      return [];
    });
    setBranchPointIndex(null);
  }, [snapshot, pipeline, dropGStepFor]);

  // One-click pipeline replication — atomically replaces the entire pipeline
  // with steps from an imported pipeline.json. Undoable via the History panel.
  // The outgoing steps' G-steps go with them: an import wholesale replaces the
  // pipeline, so any join it drops must drop its interaction too.
  const replacePipeline = useCallback(next => {
    if (!Array.isArray(next)) return;
    pipeline.forEach(dropGStepFor);
    setPipeline(p => { snapshot(p); return next; });
    setBranchPointIndex(null);
  }, [snapshot, pipeline, dropGStepFor]);

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
    // Freeze the parent as of NOW. The child must stay reconstructible even if
    // this pipeline is later edited or this dataset is deleted — R value
    // semantics: `df2 <- df1 %>% ...` copies, it does not alias.
    const frozen = freezeParent(
      { id: pid, name: filename, filename, loadOpts: rawData?._loadOpts ?? null },
      pipeline
    );
    if (onSaveSubset) onSaveSubset(name, rows, headers, null, { parent: frozen });
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
            feCols: panel.feCols, interactionCols: panel.interactionCols,
            balance: panel.validation?.balance, blockFD: panel.validation?.blockFD }
        : null,
      // Full-table pointer — without this, ModelingTab sees only the 500-row
      // preview after "→ Analyze" and estimates on it (onReady already sends it).
      _duckdb: processed._duckdb ?? null,
      _duckdbRestoreFailed: rawData?._duckdbRestoreFailed ?? false,
      _expectedRowCount: rawData?._expectedRowCount ?? null,
      changeLog: pipeline.map(s => ({
        type: s.type, description: s.desc,
        col: s.col || s.c1 || s.nn || "", map: s.map || null,
      })),
      branchPointIndex,
      context,
    });
  };

  const qualityBadge = qualityReport?.flags?.filter(f => f.severity !== "ok").length;
  const [aiActionsOpen, setAiActionsOpen] = useState(false);

  // Below this width the 230px History sidebar folds to a rail. Lives here
  // (not in App) so it also helps small laptops with no split involved.
  const rootRef    = useRef(null);
  const rootWidth  = useContainerWidth(rootRef);
  const narrowRoot = rootWidth !== null && rootWidth < 700;

  // Manual collapse of the pipeline column, independent of the width fold.
  // sessionStorage (not IDB) because this is a view preference, not project
  // data, and it is scoped per dataset id — WranglingModule remounts on every
  // dataset switch, so an unscoped key would leak one dataset's choice to all.
  const histKey = `litux_pipeline_hidden_${pid}`;
  const [histHidden, setHistHidden] = useState(() => {
    try { return sessionStorage.getItem(histKey) === "1"; } catch { return false; }
  });
  const toggleHist = useCallback(() => {
    setHistHidden(h => {
      const next = !h;
      try { sessionStorage.setItem(histKey, next ? "1" : "0"); } catch { /* private mode */ }
      return next;
    });
  }, [histKey]);

  return (
    <div ref={rootRef} style={{ display:"flex", height:"100%", minHeight:0, position:"relative",
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
            {/* A join whose right dataset could not be replayed still produces
                a table — it just merges the wrong rows. Never let that be
                silent, which is exactly how the original bug survived. */}
            {contextWarnings.length > 0 && (
              <div style={{ marginTop:4, fontSize: T.caption.fontSize, color:C.yellow, fontFamily: T.code.fontFamily }}>
                ⚠ {contextWarnings.join(" · ")}
              </div>
            )}
            {/* A step that refuses to run (e.g. lookup against a non-unique key)
                must say so. Without this the spinner would just stop and the
                table would silently show the previous state. */}
            {pipelineError && (
              <div style={{ marginTop:4, fontSize: T.caption.fontSize, color:C.gold, fontFamily: T.code.fontFamily }}>
                ⚠ {pipelineError} — showing the unprocessed data. Remove or fix that step in the pipeline sidebar.
              </div>
            )}
          </div>

          <div style={{ display:"flex", gap:6, alignItems:"center", flexShrink:0 }}>
            {rawData._duckdb && (
              <span style={{ fontSize: T.caption.fontSize, padding:"2px 6px", border:`1px solid ${C.teal}`,
                color:C.teal, borderRadius:2, letterSpacing:"0.1em",
                fontFamily: T.code.fontFamily, whiteSpace:"nowrap" }}>
                ⚡ DuckDB{rawData._duckdb.rowCount ? ` · ${rawData._duckdb.rowCount.toLocaleString()} rows` : ""}
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
              allDatasets={Object.fromEntries((allDatasets || []).map(d => [d.id, { name: d.name || d.filename, filename: d.filename }]))}
              datasetId={pid}/>
            <ImportPipelineButton currentLength={pipeline.length} onImport={replacePipeline}
              currentDatasetId={pid}
              datasetIds={(allDatasets || []).map(d => d.id)} />
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

        <HintBox color={C.teal} title="Cleaning & Wrangling" sections={[
          { heading: "How the pipeline works", items: [
            "Non-destructive: every step replays on the raw data — the original file is never modified",
            "That means any step can be removed or reordered later without reloading anything",
            "Undo, redo and delete individual steps from the Pipeline column on the right — collapse it with ⟩ when you need the space",
            "Steps are auto-saved and restored when you reopen the project",
            "The pipeline is what gets exported as an R / Python / Stata script — it is the record of what you did",
            "Import pipeline applies a previously-exported pipeline.json — steps that reference another dataset, and cell edits made in the Data Viewer, are reported rather than replayed when they cannot be resolved against the dataset you are importing into",
          ]},
          { heading: "AI command bar", items: [
            "Describe a change in plain English and it is translated into real pipeline steps",
            "Steps are shown for preview before they are applied — nothing runs unseen",
            "Anything it emits is checked against the step registry, so it cannot invent an operation that does not exist",
          ]},
          { heading: "Clean", items: [
            "Rename and drop columns or rows",
            "Filter: keep rows matching one or more conditions, grouped with AND / OR",
            "Filter operators read the same everywhere in Litux — == equals, >= at least, is null — and match what you type in a formula box",
            "Fill missing: mean, median, mode, forward/backward fill, constant, or grouped fill",
            "Drop NA: remove rows with missing values, by column or across the row",
            "Recode: map specific values to new labels",
            "Normalize categories: merge near-identical string variants (numeric variants like \"comuna 1\" vs \"comuna 2\" are never merged)",
            "Winsorize, trim outliers, or just flag them as a new column",
            "Type cast, string cleaning, and regex extraction from text columns",
            "Distinct values: inspect every level of a column from its header menu, after the pipeline has run",
          ]},
          { heading: "Workbench — features", items: [
            "Log (log1p — safe for zeros), square, standardize (z-score)",
            "Dummy encode: one-hot for a categorical column",
            "Lag / Lead: shift by t periods — grouped by entity, so values never leak across units",
            "First difference, interaction terms, and DiD interaction (treat × post)",
            "Date parse / extract: year, month, quarter, and more from date strings",
            "Country code: convert a country name/ISO2/ISO3 to ISO2, ISO3, name, or continent — equivalent to R's countrycode()",
            "Mutate: a custom expression, e.g. col_a / col_b * 100",
            "if_else and case_when for conditional columns",
            "Grouped mutate: compute within groups without collapsing rows",
          ]},
          { heading: "Workbench — reshape & merge", items: [
            "Arrange: sort by one or more columns",
            "Group summarize: aggregate (mean, sum, count, min, max) by group — collapses rows",
            "Pivot longer / wider: reshape between wide and long",
            "Balance panel: fill in the missing entity-time cells",
            "Join another dataset: left, inner, right, full, semi or anti",
            "Append (stack rows), bind columns, union, intersect, setdiff",
            "Join steps remember the real filenames, so the exported script reads the right files",
          ]},
          { heading: "Panel Structure", items: [
            "Declare the entity column (i) and the time column (t)",
            "Required before FE, FD, LSDV, TWFE, DiD, CS DiD, Sun-Abraham and event studies become available in Model",
            "The heatmap shows how balanced the panel is and where the gaps are",
          ]},
          { heading: "Dictionary & Quality", items: [
            "Dictionary: label and describe each variable — the AI narrative in Report uses these labels",
            "Units can be inferred automatically, then edited by hand",
            "Quality: missing-value patterns, outlier flags and type inconsistencies, with a fix applicable in one click",
            "The badge on the Quality tab counts open issues; export the report as markdown",
          ]},
        ]} />

        {/* ── Tab bar ── */}
        <Tabs tabs={[
          ["clean",     "⬡ Clean"],
          ["workbench", "⧉ Workbench"],
          ["structure", "⊞ Panel Structure"],
          ["dictionary","◈ Dictionary"],
          ["quality",   `◈ Quality${qualityBadge > 0 ? ` (${qualityBadge})` : "  ✓"}`],
        ]} active={tab} set={setTab}/>

        {/* ── AI command bar (NL → validated pipeline steps) ── */}
        <NLCommandBar rows={rows} headers={headers} onAddSteps={steps => steps.forEach(addStep)}
          prefill={assistantPrefill} onConsumePrefill={onConsumePrefill}
          onPrefillNavigate={() => setTab("clean")} />

        {/* ── Tab panels ── */}
        {tab === "clean" && (
          <CleanTab rows={rows} headers={headers} info={info} rawData={rawData} pipeline={pipeline} onAdd={addStep}
            onViewDistinct={openDistinct}/>
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
          <PanelTab rows={rows} headers={headers} info={info} panel={panel} setPanel={setPanel} onAdd={addStep}/>
        )}
        {tab === "workbench" && (
          <WorkbenchTab rows={rows} headers={headers} info={info} panel={panel}
            filename={filename} allDatasets={allDatasets} onAdd={addStep}
            joinContext={context} onForkJoin={forkJoin}
            duckdbTableName={rawData?._duckdb?.tableName}/>
        )}
        {tab === "dictionary" && (
          <DictionaryTab headers={headers} rows={rows}
            dict={dataDictionary} setDict={setDataDictionary}/>
        )}

        {/* ── Pipeline output preview — visible at the end of every tab ── */}
        <div style={{ marginTop:"1.6rem" }}>
          <Lbl>Preview — pipeline output</Lbl>
          <Grid headers={headers} rows={rows} max={8}/>
        </div>

        {/* ── Distinct-values panel ──────────────────────────────────────────
            Mounted OUTSIDE the `tab === …` conditionals above: those unmount
            their subtree on every sub-tab switch, which is what previously
            threw the panel away when the user moved between Clean's tabs.
            Living here, it survives all of them. It is still inside
            WranglingModule, which App.jsx keeps mounted via display:none —
            so switching to Model/Explore hides the panel (display:none on an
            ancestor hides position:fixed descendants too) but preserves its
            state, and it returns intact when the user comes back to Clean.
            `processed._duckdb` — not `rawData._duckdb` — is the post-pipeline
            table, matching `rows`, which is what the JS fallback reads. */}
        {distinctCol && (
          <DistinctValuesPanel
            col={distinctCol}
            tableName={processed?._duckdb?.tableName}
            rows={rows}
            minimized={distinctMinimized}
            onToggleMinimize={() => setDistinctMinimized(m => !m)}
            onClose={() => setDistinctCol(null)}
          />
        )}
      </div>

      <History
        collapsed={narrowRoot}
        hidden={histHidden}
        onToggleHidden={toggleHist}
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
