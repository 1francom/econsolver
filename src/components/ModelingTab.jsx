// ─── ECON STUDIO · ModelingTab.jsx ───────────────────────────────────────────
// Clean orchestrator. Owns all model state, the estimate() callback,
// and the results rendering pipeline. UI chrome extracted to:
//   src/components/modeling/EstimatorSidebar.jsx
//   src/components/modeling/VariableSelector.jsx
//   src/components/modeling/ModelConfiguration.jsx
// Math lives in src/math/index.js (split from the monolithic EconometricsEngine.js).

import { useState, useMemo, useCallback, useEffect, useRef } from "react";
import {
  runOLS, runOLSFromSuffStats, run2SLSFromSuffStats, runWLSFromSuffStats,
  runGMMFromSuffStats, runLIMLFromSuffStats,
  runIRLSFromSuffStats, applyRobustSEToIRLSResult,
  runFEFromSuffStats, runFDFromSuffStats, runTWFEFromSuffStats,
  runSharpRDD, runMcCrary,
  fCDF, matInv,
  stars,
  buildBinaryLatex, buildBinaryCSV,
  buildSpatialWeights,
  runSharpRDDFromSuffStats, runFuzzyRDDFromSuffStats,
  wrapResult,
  firstStageFFromSuffStats,
} from "../math/index.js";
import { predict }              from "../math/calcEngine.js";
import { extractAllRows }       from "../services/data/duckdb.js";
import { buildOLSSuffStats }    from "../services/data/duckdbOLS.js";
import { buildIVSuffStats }     from "../services/data/duckdbIV.js";
import { shouldUseSQLPath }     from "../services/data/duckdbDispatch.js";
import { CACHE_MAX_ENTRIES, IRLS_MAX_ITER, IRLS_TOL } from "../services/data/dispatchConfig.js";
import { expandFactors }        from "../services/data/duckdbFactors.js";
import {
  buildDiD2x2Synthetic,
  buildTWFEDiDSynthetic,
  buildEventStudySynthetic,
} from "../services/data/duckdbDiDSynthetic.js";
import { computeHCMeat, computeHCMeatWithLeverage } from "../services/data/duckdbRobustSE.js";
import {
  countClusters, computeClusterMeat, computeTwowayClusterMeat,
} from "../services/data/duckdbClusterSE.js";
import { computeHACMeat } from "../services/data/duckdbHACSE.js";
import { sampleResiduals }      from "../services/data/duckdbResiduals.js";
import {
  computeIVHCMeat,
  computeIVHCMeatWithLeverage,
  computeIVClusterMeat,
  computeIVTwowayClusterMeat,
  computeIVHACMeat,
} from "../services/data/duckdbIVRobustSE.js";
import { buildGMMSuffStats }    from "../services/data/duckdbGMM.js";
import { computeGMMOmega }      from "../services/data/duckdbGMMOmega.js";
import { buildLIMLSuffStats }   from "../services/data/duckdbLIML.js";
import { buildWLSSuffStats }    from "../services/data/duckdbWLS.js";
import {
  computeWLSHCMeat,
  computeWLSHCMeatWithLeverage,
  computeWLSClusterMeat,
  computeWLSTwowayClusterMeat,
  computeWLSHACMeat,
} from "../services/data/duckdbWLSRobustSE.js";
import { buildWithinSuffStats }         from "../services/data/duckdbWithin.js";
import { computeWithinHCMeat }          from "../services/data/duckdbWithinRobustSE.js";
import { computeWithinClusterMeat }     from "../services/data/duckdbWithinClusterSE.js";
import { computeWithinHCMeatWithLeverage } from "../services/data/duckdbWithinHC23.js";
import { computeWithinDriscollKraayMeat }  from "../services/data/duckdbWithinHAC.js";
import {
  createSuffStatsCache, makeCacheKey, validateSuffStatsEntry,
} from "../services/data/suffStatsCache.js";
import {
  logEstimate, measure, getEntries as getPerfEntries, clearLog as clearPerfLog,
} from "../services/data/perfLog.js";
import { downloadMultiSubsetBundle } from "../services/export/replicationBundle.js";
import ReportingModule from "../ReportingModule.jsx";
import * as modelBuffer from "../services/modelBuffer.js";
import ModelBufferBar   from "./modeling/ModelBufferBar.jsx";
import ModelComparison  from "./modeling/ModelComparison.jsx";

import EstimatorSidebar, { FAMILY_SUPPORT } from "../components/modeling/EstimatorSidebar.jsx";
import VariableSelector   from "../components/modeling/VariableSelector.jsx";
import ModelConfiguration  from "../components/modeling/ModelConfiguration.jsx";
import InferenceOptions    from "../components/modeling/InferenceOptions.jsx";
import CodeEditor          from "../components/modeling/CodeEditor.jsx";
import CoefficientTestPanel from "../components/modeling/CoefficientTestPanel.jsx";
import ExtractPanel         from "./modeling/ExtractPanel.jsx";
import SubsetManager, { applySubsetFilter } from "./wrangling/SubsetManager.jsx";
import { runPipeline } from "../pipeline/runner.js";
import { useTheme, mono }  from "../components/modeling/shared.jsx";
import PlotBuilder          from "./PlotBuilder.jsx";
import { buildMetadataReport }    from "../core/validation/metadataExtractor.js";
import { generateCoachingSignals } from "../core/validation/coachingTriggers.js";
import { PlotSelector, YFittedPlot, PartialPlot, YXhatPlot, XvsXhatPlot, EndogeneityPlot, RDDPlot, DiDPlot, EventStudyPlot, EventCoeffsPlot, SyntheticGapPlot, SyntheticDiffPlot, SyntheticPlaceboPlot, SyntheticMSPEPlot, FirstStagePlot, RDDBandwidthPlot, RDDCovariateBalance, McCraryPlot, ROCCurve, PredProbHistogram } from "../components/modeling/ModelPlots.jsx";
import { HintBox } from "./HelpSystem.jsx";
import { ResidualVsFitted, QQPlot } from "../components/modeling/ResidualPlots.jsx";
import DiagnosticsPanel    from "../components/modeling/DiagnosticsPanel.jsx";

// ─── LOCAL DISPLAY PRIMITIVES & RESULT PANELS ─────────────────────────────────
// Shared display atoms extracted to ./modeling/resultDisplay.jsx; per-estimator
// result panels extracted to ./modeling/results/. Both depend on result shapes,
// not on the UI chrome that was extracted earlier.
import {
  Lbl, Badge, InfoBox, RegressionEquation, ForestPlot, CoeffTable, FitBar, ExportBar,
} from "./modeling/resultDisplay.jsx";
import {
  PanelResults, TwoSLSResults, GMMResults, LIMLResults, FuzzyRDDResults,
} from "./modeling/results/index.js";

// ─── HELPERS ─────────────────────────────────────────────────────────────────
// Pure (no-React) helpers extracted to ./modeling/helpers.js: buildModelAvail,
// buildModelHint, applyFactors (factor expansion), resolveEstimator (strategy ×
// family → legacy estimator id).
import {
  buildModelAvail, buildModelHint, resolveEstimator,
} from "./modeling/helpers.js";
import { dispatchEstimation } from "./modeling/runners/estimationDispatch.js";

// ─── B5: SESSION MODEL HISTORY ────────────────────────────────────────────────
function ModelHistory({ history, onRestore, onClear }) {
  const { C } = useTheme();
  const [open, setOpen] = useState(false);
  const fmt = ts => {
    const d = new Date(ts);
    return d.toTimeString().slice(0, 8);
  };
  const fmtSpec = entry => {
    const y = entry.yVar ?? entry.spec?.yVar ?? "?";
    const xs = entry.xVars ?? entry.spec?.xVars ?? [];
    const parts = xs.slice(0, 4);
    const tail  = xs.length > 4 ? ` +${xs.length - 4}` : "";
    return `${y} ~ ${parts.join(" + ")}${tail}`;
  };
  return (
    <div style={{ marginTop: 6 }}>
      <div style={{
        display: "flex", alignItems: "center", justifyContent: "space-between",
        padding: "0.4rem 0.65rem",
        background: open ? `${C.teal}0a` : C.surface,
        border: `1px solid ${open ? C.teal + "40" : C.border}`,
        borderRadius: open ? "4px 4px 0 0" : 4,
        cursor: "pointer",
      }}
        onClick={() => setOpen(v => !v)}
      >
        <span style={{ fontFamily: mono, fontSize: 9, color: C.teal, letterSpacing: "0.18em", textTransform: "uppercase" }}>
          {open ? "▾" : "▸"} Session history ({history.length} models)
        </span>
        {history.length > 0 && (
          <button
            onClick={e => { e.stopPropagation(); onClear?.(); }}
            style={{ background: "none", border: "none", cursor: "pointer", fontFamily: mono, fontSize: 9, color: C.textMuted, padding: "0 2px" }}
          >
            Clear
          </button>
        )}
      </div>
      {open && (
        <div style={{
          border: `1px solid ${C.teal}40`, borderTop: "none",
          borderRadius: "0 0 4px 4px",
          background: C.surface2,
        }}>
          {history.length === 0 ? (
            <div style={{ padding: "0.6rem 0.75rem", fontSize: 9, color: C.textMuted, fontFamily: mono }}>
              No models estimated yet.
            </div>
          ) : (
            <>
              <div style={{ maxHeight: 220, overflowY: "auto" }}>
                {[...history].reverse().map(entry => (
                  <div
                    key={entry._histId}
                    onClick={() => onRestore(entry)}
                    style={{
                      display: "flex", alignItems: "center", gap: 8,
                      padding: "0.35rem 0.65rem",
                      borderBottom: `1px solid ${C.border}`,
                      cursor: "pointer",
                    }}
                    onMouseEnter={e => { e.currentTarget.style.background = C.teal + "12"; }}
                    onMouseLeave={e => { e.currentTarget.style.background = ""; }}
                  >
                    <span style={{ fontFamily: mono, fontSize: 9, color: C.teal, flexShrink: 0, letterSpacing: "0.05em" }}>
                      {entry.type ?? entry.label ?? "Model"}
                    </span>
                    <span style={{ fontFamily: mono, fontSize: 9, color: C.textDim, flex: 1, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                      {fmtSpec(entry)}
                    </span>
                    <span style={{ fontFamily: mono, fontSize: 9, color: C.textMuted, flexShrink: 0 }}>
                      n={entry.n ?? "—"}
                    </span>
                    <span style={{ fontFamily: mono, fontSize: 9, color: C.textMuted, flexShrink: 0 }}>
                      {fmt(entry._histTs)}
                    </span>
                  </div>
                ))}
              </div>
            </>
          )}
        </div>
      )}
    </div>
  );
}

// ─── MAIN COMPONENT ──────────────────────────────────────────────────────────
export default function ModelingTab({ cleanedData, availableDatasets = [], onBack, onResultChange, onSessionStateChange, onCoachQuestion, onExtract, pid }) {
  const { C } = useTheme();
  const rows    = cleanedData?.cleanRows ?? [];
  const dict    = cleanedData?.dataDictionary ?? {};
  const headers = cleanedData?.headers   ?? [];
  const panel   = cleanedData?.panelIndex ?? null;

  const fullPipeline    = cleanedData?.pipeline          ?? [];
  const branchPointIdx  = cleanedData?.branchPointIndex  ?? null;
  const pipelineCtx     = cleanedData?.context           ?? {};

  // Build allDatasets map for CodeEditor join/append script resolution
  const allDatasetsMap  = useMemo(
    () => Object.fromEntries((availableDatasets || []).map(d => [d.id, { name: d.name ?? d.filename, filename: d.filename }])),
    [availableDatasets]
  );

  const numericCols = useMemo(
    () => headers.filter(h => rows.some(r => typeof r[h] === "number" && isFinite(r[h]))),
    [headers, rows]
  );

  // ── Factor variables ─────────────────────────────────────────────────────────
  const [factorVars, setFactorVars] = useState(
    () => new Set(headers.filter(h => !numericCols.includes(h)))
  );
  // Re-initialize when dataset changes
  useEffect(() => {
    setFactorVars(new Set(headers.filter(h => !numericCols.includes(h))));
    // Clear all variable selectors so stale column names from the previous
    // dataset don't bleed into the new estimation.
    setYVar([]);
    setXVars([]);
    setWVars([]);
    setZVars([]);
    setPostVar([]);
    setTreatVar([]);
  }, [cleanedData]); // eslint-disable-line react-hooks/exhaustive-deps

  // ── Sufficient-statistics cache (Fase 0) ─────────────────────────────────────
  // LRU cache keyed by (table, y, sorted xCols). Invalidated whenever the
  // dataset/pipeline changes. Held in a ref so it survives renders without
  // triggering re-renders on set/get.
  const suffStatsCacheRef = useRef(null);
  if (suffStatsCacheRef.current === null) {
    suffStatsCacheRef.current = createSuffStatsCache(CACHE_MAX_ENTRIES);
  }
  useEffect(() => {
    suffStatsCacheRef.current?.invalidate();
  }, [cleanedData]);

  // Expose the perf log for DevTools inspection. Hidden from regular users.
  useEffect(() => {
    if (typeof window !== "undefined") {
      window.__perfLog = { getEntries: getPerfEntries, clear: clearPerfLog };
    }
  }, []);

  // ── Spec state ───────────────────────────────────────────────────────────────
  const [model,      setModel]      = useState("OLS");
  const [family,     setFamily]     = useState("linear"); // "linear"|"poisson"|"logit"|"probit"
  const [yVar,       setYVar]       = useState([]);
  const [xVars,      setXVars]      = useState([]);
  const [wVars,      setWVars]      = useState([]);
  const [zVars,      setZVars]      = useState([]);
  const [postVar,    setPostVar]    = useState([]);
  const [treatVar,   setTreatVar]   = useState([]);
  const [runningVar, setRunningVar] = useState([]);
  const [cutoff,     setCutoff]     = useState("");
  const [bwMode,     setBwMode]     = useState("ik");
  const [bwManual,   setBwManual]   = useState("");
  const [kernel,     setKernel]     = useState("triangular");
  const [polyOrder,  setPolyOrder]  = useState(1);     // local polynomial order (RDD / FuzzyRDD / SpatialRDD)
  const [weightVar, setWeightVar] = useState([]);

  // ── New estimator state ───────────────────────────────────────────────────
  const [treatTimeCol,   setTreatTimeCol]   = useState([]);
  const [kPre,           setKPre]           = useState(3);
  const [kPost,          setKPost]          = useState(3);
  const [lsdvTimeFE,     setLsdvTimeFE]     = useState(false);
  const [treatedUnit,    setTreatedUnit]    = useState("");
  const [synthTreatTime, setSynthTreatTime] = useState("");
  const [poissonEntityCol, setPoissonEntityCol] = useState("");
  const [poissonOffsetCol, setPoissonOffsetCol] = useState("");
  const [poissonExtraFE,   setPoissonExtraFE]   = useState([]);   // additional FE dims ⇒ multi-way Poisson FE
  // Sun & Abraham (2021) IW event study over Poisson PPML
  const [cohortCol,     setCohortCol]     = useState([]);
  const [periodCol,     setPeriodCol]     = useState([]);
  const [saUnitCol,     setSaUnitCol]     = useState("");      // unit FE when no panel declared
  const [saControlMode, setSaControlMode] = useState("auto");  // "auto" | "never"
  const [saRefPeriod,   setSaRefPeriod]   = useState(-1);
  // Callaway & Sant'Anna (2021)
  const [csTreatCol,  setCsTreatCol]  = useState([]);   // first-treatment-period column
  const [csEntityCol, setCsEntityCol] = useState([]);   // entity col (if no panel)
  const [csTimeCol,   setCsTimeCol]   = useState([]);   // time col (if no panel)
  const [csCompGroup, setCsCompGroup] = useState("nevertreated");
  const [csRelMin,    setCsRelMin]    = useState("");
  const [csRelMax,    setCsRelMax]    = useState("");
  const [spatialModel, setSpatialModel] = useState("SAR");
  const [spatialWeightsMode, setSpatialWeightsMode] = useState("inline");
  const [spatialGeomCol, setSpatialGeomCol] = useState("");
  const [spatialWeightsType, setSpatialWeightsType] = useState("queen");
  const [spatialWeightsStyle, setSpatialWeightsStyle] = useState("W");
  const [spatialWeightsK, setSpatialWeightsK] = useState(4);
  const [spatialWeightsD, setSpatialWeightsD] = useState(1000);
  const [spatialWeightsDatasetId, setSpatialWeightsDatasetId] = useState("");
  const [spatialWeightsICol, setSpatialWeightsICol] = useState("i");
  const [spatialWeightsJCol, setSpatialWeightsJCol] = useState("j");
  const [spatialWeightsWCol, setSpatialWeightsWCol] = useState("w");

  // ── Inference / SE options ────────────────────────────────────────────────
  const [seType,      setSeType]      = useState("classical");
  const [clusterVar,  setClusterVar]  = useState(null);
  const [clusterVar2, setClusterVar2] = useState(null);
  const [timeVar,     setTimeVar]     = useState(null);
  const [maxLag,      setMaxLag]      = useState(null);

  const seOpts = useMemo(() => ({
    seType, clusterVar, clusterVar2,
    timeVar: timeVar ?? panel?.timeCol ?? null,
    maxLag: maxLag ? parseInt(maxLag) : null,
  }), [seType, clusterVar, clusterVar2, timeVar, maxLag, panel]);

  const resolveSpatialWeights = useCallback((dataRows) => {
    if (spatialWeightsMode === "inline") {
      if (!spatialGeomCol) return { error: "Select a geometry WKT column for W." };
      try {
        return buildSpatialWeights(dataRows, spatialGeomCol, {
          type: spatialWeightsType,
          style: spatialWeightsStyle,
          k: Number(spatialWeightsK) || 4,
          d: Number(spatialWeightsD) || 1000,
        });
      } catch (e) {
        return { error: e.message || "Could not build spatial weights from geometry." };
      }
    }

    const ds = (availableDatasets ?? []).find(d => d.id === spatialWeightsDatasetId);
    if (!ds?.rows?.length) return { error: "Select a saved spatial weights triples dataset." };
    const iCol = spatialWeightsICol || "i";
    const jCol = spatialWeightsJCol || "j";
    const wCol = spatialWeightsWCol || "w";
    const raw = ds.rows
      .map(r => ({ i: Number(r[iCol]), j: Number(r[jCol]), w: Number(r[wCol] ?? 1) }))
      .filter(t => Number.isFinite(t.i) && Number.isFinite(t.j) && Number.isFinite(t.w));
    if (!raw.length) return { error: "Weights dataset must contain numeric i, j, and w columns." };
    const minIdx = Math.min(...raw.flatMap(t => [t.i, t.j]));
    const maxIdx = Math.max(...raw.flatMap(t => [t.i, t.j]));
    const shift = minIdx === 1 && maxIdx === dataRows.length ? 1 : 0;
    const weights = raw.map(t => ({ i: t.i - shift, j: t.j - shift, w: t.w }));
    const counts = dataRows.map((_, i) => weights.filter(t => t.i === i).length);
    return {
      ids: dataRows.map((_, i) => i),
      weights,
      summary: {
        n: dataRows.length,
        links: weights.length,
        avgNeighbors: counts.reduce((s, v) => s + v, 0) / Math.max(1, dataRows.length),
        islands: counts.filter(v => v === 0).length,
        type: "triples",
        style: "custom",
      },
    };
  }, [
    spatialWeightsMode, spatialGeomCol, spatialWeightsType, spatialWeightsStyle,
    spatialWeightsK, spatialWeightsD, availableDatasets, spatialWeightsDatasetId,
    spatialWeightsICol, spatialWeightsJCol, spatialWeightsWCol,
  ]);

  // ── Results state ─────────────────────────────────────────────────────────
  const [result,       setResult]       = useState(null);
  const [panelFE,      setPanelFE]      = useState(null);
  const [panelFD,      setPanelFD]      = useState(null);
  const [running,      setRunning]      = useState(false);
  const [err,          setErr]          = useState(null);
  const [reportResult, setReportResult] = useState(null);

  // ── Subsets ───────────────────────────────────────────────────────────────
  const [subsets, setSubsets] = useState([]);

  // ── Model buffer (pinned models) ──────────────────────────────────────────
  const [bufferVersion, setBufferVersion] = useState(0);
  const [compareOpen,   setCompareOpen]   = useState(false);
  const [activeBufferId, setActiveBufferId] = useState(null);
  const pinnedModels = useMemo(() => modelBuffer.getAll(), [bufferVersion]);

  // Restore this project's pinned-model buffer when the project opens / changes.
  useEffect(() => {
    let cancelled = false;
    modelBuffer.setProject(pid).then(() => { if (!cancelled) setBufferVersion(v => v + 1); });
    return () => { cancelled = true; };
  }, [pid]);

  // ── Predict from Model ────────────────────────────────────────────────────
  const [predOpen,     setPredOpen]    = useState(false);
  const [predModelId,  setPredModelId] = useState("");
  const [predInputs,   setPredInputs]  = useState({});   // { varName: stringValue }
  const [predResult,   setPredResult]  = useState(null);

  // ── H8: Specification curve (state only — callback defined after _runEstimation) ──
  const [specOpen,    setSpecOpen]    = useState(false);
  const [specConfig,  setSpecConfig]  = useState({ col: "", op: ">=", start: "", end: "", step: "", coefVar: "" });
  const [specRows,    setSpecRows]    = useState([]);
  const [specRunning, setSpecRunning] = useState(false);

  // ── B5: Session model history ─────────────────────────────────────────────
  const [modelHistory,    setModelHistory]    = useState([]);

  // ── B2: Quick variation panel ─────────────────────────────────────────────
  const [varOpen,         setVarOpen]         = useState(false);
  const [swapOut,         setSwapOut]         = useState("");
  const [swapIn,          setSwapIn]          = useState("");
  const [pendingEstimate, setPendingEstimate] = useState(false);

  // ── B3: Data peek panel ───────────────────────────────────────────────────
  const [peekOpen,        setPeekOpen]        = useState(false);

  // ── G12: Plot Builder panel ───────────────────────────────────────────────
  const [plotOpen,        setPlotOpen]        = useState(false);
  const [plotTemplateKey, setPlotTemplateKey]  = useState(0);
  const [plotInitLayers,  setPlotInitLayers]   = useState([]);

  // Result-augmented rows: append __resid__ and __yhat__ columns (G12)
  const resultRows = useMemo(() => {
    if (!result?.resid?.length || !rows?.length) return rows ?? [];
    const n = Math.min(result.resid.length, rows.length);
    return rows.slice(0, n).map((row, i) => ({
      ...row,
      __resid__: result.resid[i],
      __yhat__:  result.Yhat[i],
    }));
  }, [result, rows]);

  const resultHeaders = useMemo(() => {
    if (!result?.resid?.length) return headers ?? [];
    return [...(headers ?? []), "__resid__", "__yhat__"];
  }, [result, headers]);

  // G13 — multi-model comparison rows (one row per variable × model)
  const [plotDataMode, setPlotDataMode] = useState("result"); // "result" | "comparison"

  const compRows = useMemo(() => {
    if (pinnedModels.length < 2) return [];
    return pinnedModels.flatMap(m =>
      (m.varNames ?? [])
        .filter(v => v !== "(Intercept)")
        .map(v => {
          const i = (m.varNames ?? []).indexOf(v);
          const b = m.beta?.[i] ?? 0;
          const s = m.se?.[i]  ?? 0;
          return {
            variable: v,
            estimate: b,
            se:       s,
            ciLow:    b - 1.96 * s,
            ciHigh:   b + 1.96 * s,
            pVal:     m.pVals?.[i] ?? 1,
            model:    m.label ?? m.type ?? "Model",
          };
        })
    );
  }, [pinnedModels]);

  const compHeaders = ["variable", "estimate", "se", "ciLow", "ciHigh", "pVal", "model"];

  const activePlotRows    = plotDataMode === "comparison" ? compRows    : resultRows;
  const activePlotHeaders = plotDataMode === "comparison" ? compHeaders : resultHeaders;

  // Notify parent when result changes (for global AI sidebar context)
  useEffect(() => { onResultChange?.(result); }, [result]);

  // Surface modeling session state (pinned models, subsets, inference) so the
  // global AI coach sidebar can build a full session snapshot.
  useEffect(() => {
    onSessionStateChange?.({
      pinnedModels,
      subsets,
      inferenceOpts: { seType, clusterVar, clusterVar2 },
    });
  }, [pinnedModels, subsets, seType, clusterVar, clusterVar2]);

  // B5: push non-null results to session history
  useEffect(() => {
    if (!result) return;
    setModelHistory(prev => [...prev, {
      ...result,
      _histTs: Date.now(),
      _histId: Math.random().toString(36).slice(2),
    }]);
  }, [result]); // eslint-disable-line react-hooks/exhaustive-deps

  const panelOk    = !!panel;
  const panelFdOk  = !!panel && !panel.blockFD;
  const modelAvail = useMemo(() => buildModelAvail(panelOk, panelFdOk),        [panelOk, panelFdOk]);
  const modelHint  = useMemo(() => buildModelHint(panel, panelOk, panelFdOk), [panel, panelOk, panelFdOk]);

  // ── Metadata & coaching signals ──────────────────────────────────────────────
  const metadataReport = useMemo(
    () => buildMetadataReport(headers, rows, panel),
    [headers, rows, panel]
  );
  const modelSpec = useMemo(() => ({
    type: model, yVar: yVar[0], xVars, wVars, zVars,
  }), [model, yVar, xVars, wVars, zVars]);
  const coachingSignals = useMemo(
    () => generateCoachingSignals(metadataReport, result, modelSpec),
    [metadataReport, result, modelSpec]
  );

  const handleModelSelect = useCallback((id) => {
    setModel(id);
    setResult(null);
    setErr(null);
    setSeType("classical");
    setFamily(prev => {
      const support = FAMILY_SUPPORT[id] ?? {};
      return (prev === "linear" || support[prev] === "available") ? prev : "linear";
    });
  }, []);

  const toggleFactor = useCallback((col) => {
    setFactorVars(prev => {
      const next = new Set(prev);
      if (next.has(col)) {
        next.delete(col);
        // String columns must be factored to be usable — deselect if un-factored
        if (!numericCols.includes(col)) {
          setXVars(v => v.filter(x => x !== col));
          setWVars(v => v.filter(x => x !== col));
        }
      } else {
        next.add(col);
      }
      return next;
    });
  }, [numericCols]);

  // ── PURE ESTIMATION HELPER (no setState) ────────────────────────────────────
  // Returns { result, panelFE, panelFD } on success, { error } on failure.
  // dataRows is passed explicitly so runAllSubsets can call it on filtered data.
  const _runEstimation = useCallback((dataRows) => dispatchEstimation(dataRows, {
    yVar, xVars, wVars, factorVars,
    model, family, weightVar, seOpts, seType, panel,
    zVars, postVar, treatVar,
    runningVar, cutoff, bwMode, bwManual, kernel, polyOrder,
    treatedUnit, synthTreatTime, treatTimeCol, kPre, kPost, lsdvTimeFE,
    poissonEntityCol, poissonOffsetCol, poissonExtraFE,
    cohortCol, periodCol, saUnitCol, saControlMode, saRefPeriod,
    csTreatCol, csEntityCol, csTimeCol, csCompGroup, csRelMin, csRelMax,
    spatialModel, spatialWeightsMode, spatialGeomCol, spatialWeightsDatasetId,
    resolveSpatialWeights,
  }), [model, family, yVar, xVars, wVars, zVars, postVar, treatVar, runningVar, cutoff, bwMode, bwManual, kernel, polyOrder, weightVar, seOpts, seType, panel, treatedUnit, synthTreatTime, treatTimeCol, kPre, kPost, lsdvTimeFE, factorVars, poissonEntityCol, poissonOffsetCol, poissonExtraFE, cohortCol, periodCol, saUnitCol, saControlMode, saRefPeriod, csTreatCol, csEntityCol, csTimeCol, csCompGroup, csRelMin, csRelMax, spatialModel, spatialWeightsMode, spatialGeomCol, spatialWeightsDatasetId, resolveSpatialWeights]);

  // ── H8: runSpecCurve (after _runEstimation to avoid TDZ) ─────────────────────
  const runSpecCurve = useCallback(() => {
    const { col, op, start, end, step, coefVar } = specConfig;
    if (!col || !coefVar || start === "" || end === "" || step === "") return;
    const s = Math.abs(Number(step)) || 1;
    const pts = [];
    setSpecRunning(true);
    try {
      for (let t = Number(start); t <= Number(end) + 1e-9; t += s) {
        const filtered = (rows ?? []).filter(row => {
          const v = Number(row[col]);
          switch (op) {
            case ">=": return !isNaN(v) && v >= t;
            case "<=": return !isNaN(v) && v <= t;
            case ">":  return !isNaN(v) && v > t;
            case "<":  return !isNaN(v) && v < t;
            default:   return String(row[col]) === String(t);
          }
        });
        if (filtered.length < 5) continue;
        const out = _runEstimation(filtered);
        if (out.result && !out.error) {
          const idx = (out.result.varNames ?? []).indexOf(coefVar);
          if (idx >= 0) {
            const b = out.result.beta[idx];
            const se = out.result.se[idx];
            pts.push({ threshold: +t.toFixed(6), estimate: b, se, ciLow: b - 1.96 * se, ciHigh: b + 1.96 * se, n: filtered.length });
          }
        }
      }
    } finally {
      setSpecRunning(false);
    }
    setSpecRows(pts);
  }, [specConfig, rows, _runEstimation]);

  // ── RUN ALL SUBSETS ───────────────────────────────────────────────────────────
  const runAllSubsets = useCallback(() => {
    if (!subsets.length) return;
    setRunning(true);
    try {
      const hasSubsetSteps = branchPointIdx !== null && branchPointIdx < fullPipeline.length - 1;
      const perSubsetSteps = hasSubsetSteps ? fullPipeline.slice(branchPointIdx + 1) : [];

      // Full sample (with per-subset steps applied if a branch point is set)
      const fullRows = hasSubsetSteps
        ? (runPipeline(rows, headers, perSubsetSteps, pipelineCtx)?.rows ?? rows)
        : rows;
      const fullOut = _runEstimation(fullRows);
      if (!fullOut.error && fullOut.result) {
        const r = { ...fullOut.result, label: `${fullOut.result.type} · Full sample`, subsetName: "Full sample", subsetFilters: [] };
        modelBuffer.add(r);
        setBufferVersion(v => v + 1);
      }

      // Each named subset
      for (const s of subsets) {
        const filtered = applySubsetFilter(rows, s.filters);
        const subsetRows = hasSubsetSteps
          ? (runPipeline(filtered, headers, perSubsetSteps, pipelineCtx)?.rows ?? filtered)
          : filtered;
        const out = _runEstimation(subsetRows);
        if (!out.error && out.result) {
          const r = { ...out.result, label: `${out.result.type} · ${s.name}`, subsetName: s.name, subsetFilters: s.filters ?? [] };
          modelBuffer.add(r);
          setBufferVersion(v => v + 1);
        }
      }
    } finally {
      setRunning(false);
    }
  }, [subsets, rows, headers, fullPipeline, branchPointIdx, pipelineCtx, _runEstimation]);

  // ── ESTIMATE (single run on full rows) ───────────────────────────────────────
  const estimate = useCallback(async () => {
    setErr(null); setResult(null); setPanelFE(null); setPanelFD(null); setRunning(true);
    try {
      const duckTable = cleanedData?._duckdb?.tableName;
      const rowCount  = cleanedData?._duckdb?.rowCount ?? 0;
      const allX      = [...xVars, ...wVars];
      const cutoffNum = Number.parseFloat(cutoff);
      const manualRDDH = bwMode === "manual" ? Number.parseFloat(bwManual) : null;

      // ── Single dispatch point (Fase 0) ─────────────────────────────────────
      // shouldUseSQLPath decides between SQL suff-stats fast path and the
      // classic JS path (extractAllRows + runOLS et al). Cheap checks first.
      // Normalize SE casing — UI emits lowercase. dispatcher + engine compare
      // uppercase HC*, lowercase clustered/twoway, uppercase HAC (matching
      // core/inference/robustSE.js dispatch).
      const rawSE = (seType ?? "classical").toLowerCase();
      const seTypeNorm =
          rawSE === "hac"        ? "HAC"
        : rawSE.startsWith("hc") ? rawSE.toUpperCase()
        : rawSE;
      const effModel = resolveEstimator(model, family, !!weightVar[0]);
      const dispatchCtx = {
        tableName:     duckTable ?? null,
        n:             rowCount > rows.length ? rowCount : rows.length,
        xColsExpanded: allX,
        estimator:     effModel,
        seType:        seTypeNorm,
        hasWeights:    !!weightVar[0],
        weightCol:     weightVar[0] || null,
        hasFactors:    factorVars.size > 0,
        clusterVar:    clusterVar ?? null,
        clusterVar2:   clusterVar2 ?? null,
        timeVar:       seTypeNorm === "HAC" ? (timeVar ?? panel?.timeCol ?? null) : null,
        xColsEndog:    ["2SLS", "GMM", "LIML"].includes(effModel) ? xVars : [],
        zVars:         ["2SLS", "GMM", "LIML"].includes(effModel) ? zVars : [],
        endogCount:    ["2SLS", "GMM", "LIML"].includes(effModel) ? xVars.length : 0,
        unitCol:       ["FE", "FD", "TWFE", "EventStudy"].includes(effModel)
          ? (panel?.entityCol ?? null)
          : (effModel === "PoissonFE" ? (panel?.entityCol || poissonEntityCol || null) : null),
        timeCol:       ["FD", "TWFE", "EventStudy"].includes(effModel) ? (panel?.timeCol ?? null)
          : (seTypeNorm === "HAC" ? (panel?.timeCol ?? null) : null),
        postCol:       postVar[0] || null,
        treatCol:      treatVar[0] || null,
        treatTimeCol:  treatTimeCol[0] || null,
        kPre:          typeof kPre === "number" ? kPre : null,
        kPost:         typeof kPost === "number" ? kPost : null,
        controls:      wVars,
        runningCol:    runningVar[0] || null,
        cutoff:        Number.isFinite(cutoffNum) ? cutoffNum : null,
        bandwidth:     Number.isFinite(manualRDDH) ? manualRDDH : null,
        kernelType:    kernel,
        fuzzyTreatCol: treatVar[0] || null,
      };

      if (effModel !== "SpatialRegression" && shouldUseSQLPath(dispatchCtx) && yVar[0] && (allX.length > 0 || ["DiD", "TWFE", "EventStudy", "RDD", "FuzzyRDD"].includes(effModel))) {
        try {
          if (effModel === "2SLS") {
            // ── 2SLS SQL branch (Fase 3a + Fase 8 robust-SE backfill) ──
            if (!["classical", "HC0", "HC1", "HC2", "HC3", "clustered", "twoway", "HAC"].includes(seTypeNorm)) {
              throw new Error(`2SLS SQL path does not support ${seTypeNorm} - fallback to JS`);
            }

            // X = endogenous + exogenous controls; Z = exogenous + excluded instruments.
            const xAll2 = [...xVars, ...wVars];
            const zAll2 = [...wVars, ...zVars];

            // Expand factors for X and Z separately. If a column appears in both,
            // its dummySQL definition is identical — last write wins, no conflict.
            const xExpansion = await expandFactors({ xCols: xAll2, tableName: duckTable });
            const zExpansion = await expandFactors({ xCols: zAll2, tableName: duckTable });
            const xExp = xExpansion.xColsExpanded;
            const zExp = zExpansion.xColsExpanded;
            const dummySQL2 = { ...xExpansion.dummySQL, ...zExpansion.dummySQL };

            // Endogenous factor variables: robust fitted-score paths need careful
            // first-stage beta alignment after dummy expansion. Fall back for now.
            const anyEndogFactor = xVars.some(v => factorVars.has(v));
            if (anyEndogFactor && seTypeNorm !== "classical") {
              throw new Error("Endogenous factor variables not supported in 2SLS SQL robust SE - fallback to JS");
            }

            // Re-check (k+q) post-expansion against K_THRESHOLD via the dispatcher.
            if (!shouldUseSQLPath({ ...dispatchCtx, xColsExpanded: xExp })) {
              throw new Error("Post-expansion k+q exceeds threshold — fallback to JS");
            }

            // Cache lookup: IV suff-stats keyed by (table, y, xExp, zExp).
            const ivCache = suffStatsCacheRef.current;
            const ivKey   = makeCacheKey(duckTable, yVar[0], xExp, zExp);
            let ivEntry   = ivCache.get(ivKey);
            const ivHit   = ivEntry != null && validateSuffStatsEntry(ivEntry, xExp, zExp);
            if (!ivHit) {
              const mSS = await measure(() => buildIVSuffStats(duckTable, yVar[0], xExp, zExp, { dummySQL: dummySQL2 }));
              ivEntry = { ...mSS.result, dummySQL: dummySQL2 };
              ivCache.set(ivKey, ivEntry);
              logEstimate({
                path: "sql", phase: "ivSuffStats",
                n: rowCount, k: xExp.length, q: zExp.length, msTotal: mSS.ms,
              });
            }

            const mSolve = await measure(() => run2SLSFromSuffStats({
              ...ivEntry, meat: null, hcType: null,
            }));
            const second = mSolve.result;
            if (!second) throw new Error("Suff-stats 2SLS solve returned null (singular)");
            logEstimate({
              path: "sql", phase: "engine-2SLS",
              n: rowCount, k: xExp.length, seType: "classical", msTotal: mSolve.ms,
            });

            // ── First-stage F per endogenous regressor ──
            const wExpansion = await expandFactors({ xCols: wVars, tableName: duckTable });
            const exogExp = wExpansion.xColsExpanded;
            const dummySQLAll = { ...dummySQL2, ...wExpansion.dummySQL };

            const firstStages = [];
            const firstStageBetas = new Map();
            for (let xIdx0 = 0; xIdx0 < xVars.length; xIdx0++) {
              const endVar = xVars[xIdx0];
              const uSS = await buildOLSSuffStats(
                duckTable, endVar,
                [...exogExp, ...zVars],
                { dummySQL: dummySQLAll }
              );
              const uSolve = runOLSFromSuffStats(uSS);
              // intercept = index 0, first endogenous = index 1, etc.
              firstStageBetas.set(xIdx0 + 1, uSolve.beta);

              let rSolve;
              if (exogExp.length > 0) {
                const rSS = await buildOLSSuffStats(duckTable, endVar, exogExp, { dummySQL: dummySQLAll });
                rSolve = runOLSFromSuffStats(rSS);
              } else {
                // Intercept-only restricted: SSR_r = Σ(y − ȳ)² = YtY − sumY²/n
                rSolve = {
                  SSR: uSS.YtY - (uSS.sumY * uSS.sumY) / uSS.n,
                  ssr: uSS.YtY - (uSS.sumY * uSS.sumY) / uSS.n,
                  df:  uSS.n - 1,
                };
              }

              const F = firstStageFFromSuffStats(uSolve, rSolve, zVars.length);
              const Fpval = F ? (1 - fCDF(F.Fstat, F.dfNum, F.dfDen)) : NaN;
              firstStages.push({
                endVar,
                Fstat: F?.Fstat ?? NaN,
                Fpval,
                weak: F?.weak ?? false,
                dfNum: F?.dfNum ?? zVars.length,
                dfDen: F?.dfDen ?? NaN,
              });
            }

            // ── Robust SE meat (Fase 8) ──
            let meat = null;
            if (seTypeNorm !== "classical") {
              const sharedIVMeat = {
                tableName: duckTable,
                yCol: yVar[0],
                xCols: xExp,
                zCols: zExp,
                dummySQL: dummySQL2,
                beta: second.beta,
                firstStageBeta: firstStageBetas,
              };
              const mMeat = await measure(() => {
                if (seTypeNorm === "HC0" || seTypeNorm === "HC1") {
                  return computeIVHCMeat(sharedIVMeat);
                }
                if (seTypeNorm === "HC2" || seTypeNorm === "HC3") {
                  return computeIVHCMeatWithLeverage({
                    ...sharedIVMeat,
                    Ainv: second.XtPzXinv,
                    hcType: seTypeNorm,
                  });
                }
                if (seTypeNorm === "clustered") {
                  return computeIVClusterMeat({
                    ...sharedIVMeat,
                    clusterCol: clusterVar,
                  });
                }
                if (seTypeNorm === "twoway") {
                  return computeIVTwowayClusterMeat({
                    ...sharedIVMeat,
                    clusterCol: clusterVar,
                    clusterCol2: clusterVar2,
                  });
                }
                return computeIVHACMeat({
                  ...sharedIVMeat,
                  orderCol: timeVar,
                  maxLag,
                });
              });
              meat = mMeat.result.meat;
              logEstimate({
                path: "sql", phase: `meat-2SLS-${seTypeNorm}`,
                n: rowCount, k: xExp.length, msTotal: mMeat.ms,
              });
            }

            // ── Re-solve with robust meat ──
            let finalSecond = second;
            if (meat) {
              const engineHcType = (seTypeNorm === "HC1") ? "HC1" : null;
              const mSolve2 = await measure(() => run2SLSFromSuffStats({
                ...ivEntry, meat, hcType: engineHcType,
              }));
              if (!mSolve2.result) throw new Error("Suff-stats 2SLS robust solve returned null");
              finalSecond = mSolve2.result;
              logEstimate({
                path: "sql", phase: `solve-2SLS-${seTypeNorm}`,
                n: rowCount, k: xExp.length, msTotal: mSolve2.ms,
              });
            }

            const wrapped = wrapResult("2SLS",
              { firstStages, second: { ...finalSecond, resid: [], Yhat: [] } },
              { yVar: yVar[0], xVars, wVars, zVars }
            );
            setResult(wrapped);
            return;
          }

          if (effModel === "WLS") {
            // ── WLS SQL branch (Fase 3c + Fase 8 robust-SE backfill) ──
            if (!["classical", "HC0", "HC1", "HC2", "HC3", "clustered", "twoway", "HAC"].includes(seTypeNorm)) {
              throw new Error(`WLS SQL path does not support ${seTypeNorm} - fallback to JS`);
            }
            const wCol = weightVar[0];
            if (!wCol) throw new Error("WLS SQL path: weight column not selected — fallback to JS");

            const { xColsExpanded: wlsX, dummySQL: wlsDummy } = await expandFactors({
              xCols: allX, tableName: duckTable,
            });
            if (!shouldUseSQLPath({ ...dispatchCtx, xColsExpanded: wlsX })) {
              throw new Error("Post-expansion k exceeds threshold — fallback to JS");
            }

            const wlsCache = suffStatsCacheRef.current;
            const wlsKey   = makeCacheKey(duckTable, yVar[0], wlsX, null, wCol);
            let wlsEntry   = wlsCache.get(wlsKey);
            const wlsHit   = wlsEntry != null && validateSuffStatsEntry(wlsEntry, wlsX, null, wCol);
            if (!wlsHit) {
              const m = await measure(() => buildWLSSuffStats(duckTable, yVar[0], wlsX, wCol, { dummySQL: wlsDummy }));
              wlsEntry = { ...m.result, dummySQL: wlsDummy };
              wlsCache.set(wlsKey, wlsEntry);
              logEstimate({ path: "sql", phase: "wlsSuffStats", n: rowCount, k: wlsX.length, msTotal: m.ms });
            }

            // Classical solve first — gives β even when robust SE requested (meat needs β).
            const rCls = runWLSFromSuffStats({ ...wlsEntry, meat: null, hcType: null });
            if (!rCls) throw new Error("Suff-stats WLS solve returned null (singular X'WX)");

            let rFinal;
            if (seTypeNorm === "classical") {
              rFinal = rCls;
            } else {
              const sharedWLSMeat = {
                tableName: duckTable,
                yCol: yVar[0],
                xCols: wlsX,
                wCol,
                dummySQL: wlsDummy,
                beta: rCls.beta,
              };
              const mm = await measure(() => {
                if (seTypeNorm === "HC0" || seTypeNorm === "HC1") {
                  return computeWLSHCMeat(sharedWLSMeat);
                }
                if (seTypeNorm === "HC2" || seTypeNorm === "HC3") {
                  return computeWLSHCMeatWithLeverage({
                    ...sharedWLSMeat,
                    Ainv: rCls.XtXinv,
                    hcType: seTypeNorm,
                  });
                }
                if (seTypeNorm === "clustered") {
                  return computeWLSClusterMeat({
                    ...sharedWLSMeat,
                    clusterCol: clusterVar,
                  });
                }
                if (seTypeNorm === "twoway") {
                  return computeWLSTwowayClusterMeat({
                    ...sharedWLSMeat,
                    clusterCol: clusterVar,
                    clusterCol2: clusterVar2,
                  });
                }
                return computeWLSHACMeat({
                  ...sharedWLSMeat,
                  orderCol: timeVar,
                  maxLag,
                });
              });
              logEstimate({ path: "sql", phase: `meat-WLS-${seTypeNorm}`, n: rowCount, k: wlsX.length, msTotal: mm.ms });
              const engineHcType = seTypeNorm === "HC1" ? "HC1" : null;
              rFinal = runWLSFromSuffStats({ ...wlsEntry, meat: mm.result.meat, hcType: engineHcType });
              if (!rFinal) throw new Error("Suff-stats WLS robust solve returned null");
            }

            const wrapped = wrapResult("WLS", rFinal, {
              yVar: yVar[0], xVars, wVars, weightCol: wCol,
            });
            setResult(wrapped);
            return;
          }

          if (effModel === "Logit" || effModel === "Probit" || effModel === "PoissonFE") {
            const irlsFamily = effModel === "Logit" ? "logit"
              : effModel === "Probit" ? "probit"
              : "poisson";
            let irlsX = allX;
            let irlsDummy = {};
            let entityCol = null;

            if (effModel === "PoissonFE") {
              entityCol = panel?.entityCol || poissonEntityCol || null;
              if (!entityCol) throw new Error("Poisson FE SQL path: entity column missing - fallback to JS");
              // Multi-way FE has no SQL fast path yet — use the validated JS engine.
              const extraFE = poissonExtraFE.filter(c => c && c !== entityCol && !allX.includes(c));
              if (extraFE.length) throw new Error("Multi-way Poisson FE: no SQL path - fallback to JS runPoissonFEMulti");
              const expansion = await expandFactors({
                xCols: [...allX, `factor(${entityCol})`],
                tableName: duckTable,
              });
              irlsX = expansion.xColsExpanded;
              irlsDummy = expansion.dummySQL;
            } else {
              const expansion = await expandFactors({ xCols: allX, tableName: duckTable });
              irlsX = expansion.xColsExpanded;
              irlsDummy = expansion.dummySQL;
            }

            if (!shouldUseSQLPath({
              ...dispatchCtx,
              xColsExpanded: irlsX,
              unitCol: entityCol ?? dispatchCtx.unitCol,
            })) {
              throw new Error("Post-expansion IRLS design exceeds dispatcher scope - fallback to JS");
            }

            const mFit = await measure(() => runIRLSFromSuffStats({
              tableName: duckTable,
              yCol: yVar[0],
              xCols: irlsX,
              family: irlsFamily,
              dummySQL: irlsDummy,
              maxIter: IRLS_MAX_ITER,
              tol: IRLS_TOL,
            }));
            let irlsResult = mFit.result;
            if (!irlsResult || irlsResult.error) {
              throw new Error(irlsResult?.error ?? "IRLS SQL solve failed");
            }
            logEstimate({
              path: "sql",
              phase: `irls-${effModel}`,
              n: rowCount,
              k: irlsX.length,
              seType: "classical",
              msTotal: mFit.ms,
            });

            if (seTypeNorm === "HC0" || seTypeNorm === "HC1") {
              const mRobust = await measure(() => applyRobustSEToIRLSResult({
                result: irlsResult,
                tableName: duckTable,
                yCol: yVar[0],
                xCols: irlsX,
                family: irlsFamily,
                dummySQL: irlsDummy,
                hcType: seTypeNorm,
              }));
              irlsResult = mRobust.result;
              logEstimate({
                path: "sql",
                phase: `irls-${effModel}-${seTypeNorm}`,
                n: rowCount,
                k: irlsX.length,
                seType: seTypeNorm,
                msTotal: mRobust.ms,
              });
            }

            if (!irlsResult.converged) {
              console.warn(`${effModel} SQL IRLS did not converge after ${irlsResult.iterations} iterations.`);
            }

            const wrapped = wrapResult(effModel, irlsResult, {
              yVar: yVar[0],
              xVars,
              wVars,
              entityCol,
            });
            setResult(wrapped);
            return;
          }

          if (effModel === "RDD" || effModel === "FuzzyRDD") {
            if (!runningVar[0] || !Number.isFinite(cutoffNum)) {
              throw new Error("RDD SQL path: running variable or cutoff missing - fallback to JS");
            }
            if (polyOrder > 1) {
              throw new Error("RDD SQL path: polynomial order > 1 not supported via SQL — fallback to JS");
            }
            const controlsExpansion = await expandFactors({
              xCols: wVars.filter(v => v !== runningVar[0] && v !== yVar[0]),
              tableName: duckTable,
            });
            const sharedRDD = {
              tableName: duckTable,
              yCol: yVar[0],
              runningCol: runningVar[0],
              cutoff: cutoffNum,
              bandwidth: Number.isFinite(manualRDDH) ? manualRDDH : null,
              controls: controlsExpansion.xColsExpanded,
              dummySQL: controlsExpansion.dummySQL,
              seType: seTypeNorm,
            };
            const mRDD = await measure(() => effModel === "RDD"
              ? runSharpRDDFromSuffStats(sharedRDD)
              : runFuzzyRDDFromSuffStats({ ...sharedRDD, treatCol: treatVar[0] }));
            const rddRaw = mRDD.result;
            if (!rddRaw || rddRaw.error) {
              throw new Error(rddRaw?.error ?? `${effModel} SQL solve failed`);
            }
            logEstimate({
              path: "sql",
              phase: `rdd-${effModel}`,
              n: rowCount,
              k: controlsExpansion.xColsExpanded.length + 3,
              seType: seTypeNorm,
              msTotal: mRDD.ms,
            });
            const wrapped = effModel === "RDD"
              ? wrapResult("RDD", rddRaw, {
                yVar: yVar[0],
                wVars,
                runningVar: runningVar[0],
                cutoff: cutoffNum,
                bandwidth: rddRaw.h,
                kernel: "triangular",
              }, { h: rddRaw.h })
              : wrapResult("FuzzyRDD", rddRaw, {
                yVar: yVar[0],
                wVars,
                treatVar: treatVar[0],
                runningVar: runningVar[0],
                cutoff: cutoffNum,
                bandwidth: rddRaw.h,
                kernel: "triangular",
              });
            setResult(wrapped);
            return;
          }

          if (effModel === "GMM") {
            // ── GMM SQL branch (Fase 3b — classical SE only; 2-step efficient) ──
            if (seTypeNorm !== "classical") {
              throw new Error(`GMM SQL path only supports classical SE in Fase 3b (got ${seTypeNorm}) — fallback to JS`);
            }
            const { xColsExpanded: wExp, dummySQL: wDummy } = await expandFactors({ xCols: wVars, tableName: duckTable });
            const { xColsExpanded: xExp, dummySQL: xDummy } = await expandFactors({ xCols: xVars, tableName: duckTable });
            const { xColsExpanded: zExp, dummySQL: zDummy } = await expandFactors({ xCols: zVars, tableName: duckTable });
            const dummySQL = { ...wDummy, ...xDummy, ...zDummy };

            // Re-check post-expansion (k+q) against threshold.
            if (!shouldUseSQLPath({ ...dispatchCtx, xColsExpanded: [...xExp, ...wExp] })) {
              throw new Error("Post-expansion (w+x+z) exceeds threshold — fallback to JS");
            }

            const ss = await measure(() => buildGMMSuffStats(duckTable, yVar[0], xExp, wExp, zExp, { dummySQL }));
            logEstimate({ path: "sql", phase: "gmmSuffStats", n: rowCount, k: ss.result.xColsAll.length, msTotal: ss.ms });

            // Step 1: 2SLS β̂₁ using the same suff stats (uses ZtZ, ZtX, XtX, ZtY, XtY).
            const step1 = run2SLSFromSuffStats({ ...ss.result, meat: null, hcType: null });
            if (!step1) throw new Error("GMM step-1 (2SLS) returned null (singular)");

            // Step 2: Ω̂ via SQL pass over residuals.
            const om = await measure(() => computeGMMOmega({
              tableName: duckTable, yCol: yVar[0],
              xColsAll: ss.result.xColsAll, zColsAll: ss.result.zColsAll, dummySQL,
              beta: step1.beta,
            }));
            logEstimate({ path: "sql", phase: "gmmOmega", n: rowCount, k: ss.result.xColsAll.length, msTotal: om.ms });

            const overidDf = zVars.length - xVars.length;
            const step2 = runGMMFromSuffStats({ ...ss.result, Omega: om.result.Omega, overidDf });
            if (!step2) throw new Error("GMM step-2 returned null (singular Ω̂)");

            const wrapped = wrapResult("GMM", step2, { yVar: yVar[0], xVars, wVars, zVars });
            setResult(wrapped);
            return;
          }

          if (effModel === "LIML") {
            // ── LIML SQL branch (Fase 3b + Fase 8 robust-SE backfill) ──
            if (!["classical", "HC0", "HC1", "clustered", "HAC"].includes(seTypeNorm)) {
              throw new Error(`LIML SQL path does not support ${seTypeNorm} - fallback to JS`);
            }
            const { xColsExpanded: wExp, dummySQL: wDummy } = await expandFactors({ xCols: wVars, tableName: duckTable });
            const { xColsExpanded: xExp, dummySQL: xDummy } = await expandFactors({ xCols: xVars, tableName: duckTable });
            const { xColsExpanded: zExp, dummySQL: zDummy } = await expandFactors({ xCols: zVars, tableName: duckTable });
            const dummySQL = { ...wDummy, ...xDummy, ...zDummy };

            if (!shouldUseSQLPath({ ...dispatchCtx, xColsExpanded: [...xExp, ...wExp] })) {
              throw new Error("Post-expansion (w+x+z) exceeds threshold — fallback to JS");
            }

            const ss = await measure(() => buildLIMLSuffStats(duckTable, yVar[0], xExp, wExp, zExp, { dummySQL }));
            logEstimate({ path: "sql", phase: "limlSuffStats", n: rowCount, k: ss.result.xColsAll.length, msTotal: ss.ms });

            const r = runLIMLFromSuffStats({ ...ss.result, meat: null, hcType: null });
            if (!r) throw new Error("LIML solve returned null (singular Z'Z, W'W, or eigenvalue failure)");

            let rFinal = r;
            if (seTypeNorm !== "classical") {
              const xAllLiml = [...wExp, ...xExp];
              const sharedLIMLMeat = {
                tableName: duckTable,
                yCol: yVar[0],
                xColsExpanded: xAllLiml,
                dummySQL,
                beta: r.beta,
              };
              const mm = await measure(() => {
                if (seTypeNorm === "HC0" || seTypeNorm === "HC1") {
                  return computeHCMeat(sharedLIMLMeat);
                }
                if (seTypeNorm === "clustered") {
                  return computeClusterMeat({
                    ...sharedLIMLMeat,
                    clusterCol: clusterVar,
                  });
                }
                return computeHACMeat({
                  ...sharedLIMLMeat,
                  orderCol: timeVar,
                  maxLag,
                });
              });
              logEstimate({
                path: "sql",
                phase: `meat-LIML-${seTypeNorm}`,
                n: rowCount,
                k: xAllLiml.length,
                msTotal: mm.ms,
              });
              rFinal = runLIMLFromSuffStats({
                ...ss.result,
                meat: mm.result.meat,
                hcType: seTypeNorm === "HC1" ? "HC1" : null,
              });
              if (!rFinal) throw new Error("LIML robust solve returned null");
            }

            const wrapped = wrapResult("LIML", rFinal, { yVar: yVar[0], xVars, wVars, zVars });
            setResult(wrapped);
            return;
          }

          if (effModel === "FE" || effModel === "FD" || effModel === "TWFE" || effModel === "EventStudy") {
            // ── Panel FE/FD/TWFE SQL branch (Fase 4b — classical/HC0/HC1/HC2/HC3/clustered/HAC) ──
            const unitCol = panel?.entityCol;
            const timeCol = panel?.timeCol;
            if (!unitCol) throw new Error("Panel SQL path: entityCol missing — fallback to JS");
            if ((effModel === "FD" || effModel === "TWFE" || effModel === "EventStudy") && !timeCol)
              throw new Error(`Panel ${effModel} SQL path: timeCol missing — fallback to JS`);
            // HAC on FE requires a time column for Driscoll-Kraay cross-sectional aggregation
            if (seTypeNorm === "HAC" && !timeCol)
              throw new Error("HAC standard errors require a time column. Set one in the Panel tab.");

            const panelMode = effModel === "EventStudy" ? "TWFE" : effModel;
            let eventStudySynth = null;
            let twfeSynth = null;
            let wExp;
            let wDummy;

            if (effModel === "EventStudy") {
              const controlsExpansion = await expandFactors({ xCols: wVars, tableName: duckTable });
              eventStudySynth = buildEventStudySynthetic({
                timeCol,
                treatTimeCol: treatTimeCol[0],
                kPre: Math.max(1, kPre || 3),
                kPost: Math.max(1, kPost || 3),
                controls: controlsExpansion.xColsExpanded,
              });
              wExp = eventStudySynth.xColsExpanded;
              wDummy = { ...controlsExpansion.dummySQL, ...eventStudySynth.dummySQL };
            } else if (effModel === "TWFE") {
              const controlsExpansion = await expandFactors({ xCols: wVars, tableName: duckTable });
              twfeSynth = buildTWFEDiDSynthetic({
                treatCol: treatVar[0],
                controls: controlsExpansion.xColsExpanded,
              });
              wExp = twfeSynth.xColsExpanded;
              wDummy = controlsExpansion.dummySQL;
            } else {
              const expansion = await expandFactors({ xCols: allX, tableName: duckTable });
              wExp = expansion.xColsExpanded;
              wDummy = expansion.dummySQL;
            }
            // Dispatcher already checked HC2/HC3 dim budget; re-check post-expansion
            if (!shouldUseSQLPath({
              ...dispatchCtx, estimator: effModel,
              xColsExpanded: wExp, timeCol,
              unitCol, clusterVar: seOpts?.clusterVar ?? null,
            })) {
              throw new Error("Post-expansion: dispatcher refused — fallback to JS");
            }

            const panelDescriptor = {
              mode: panelMode, unitCol,
              timeCol: (panelMode === "FD" || panelMode === "TWFE") ? timeCol : null,
            };
            const panelCache = suffStatsCacheRef.current;
            const panelKey   = makeCacheKey(duckTable, yVar[0], wExp, null, null, panelDescriptor);
            let panelEntry   = panelCache.get(panelKey);
            const panelHit   = panelEntry != null && validateSuffStatsEntry(panelEntry, wExp, null, null, panelDescriptor);
            if (!panelHit) {
              const m = await measure(() => buildWithinSuffStats(
                duckTable, yVar[0], wExp, unitCol,
                { mode: panelMode, timeCol: timeCol ?? undefined, dummySQL: wDummy },
              ));
              panelEntry = { ...m.result, dummySQL: wDummy };
              panelCache.set(panelKey, panelEntry);
              logEstimate({
                path: "sql", phase: `withinSuffStats-${effModel}`,
                n: rowCount, k: wExp.length, msTotal: m.ms,
              });
            }

            const solver = panelMode === "FE" ? runFEFromSuffStats
              : panelMode === "FD" ? runFDFromSuffStats
              : runTWFEFromSuffStats;

            // Classical solve (always needed for β and XtXinv even when robust SE follows)
            const rCls = solver({ ...panelEntry, meat: null, hcType: null });
            if (!rCls) throw new Error(`Suff-stats ${effModel} solve returned null (singular within X'X)`);

            // ── Robust meat dispatch ──
            let rFinal = rCls;
            if (seTypeNorm !== "classical") {
              let meatResult = null;
              let engineHcType = null;

              if (seTypeNorm === "HC0" || seTypeNorm === "HC1") {
                const mm = await measure(() => computeWithinHCMeat({
                  withinCTEPrefix: panelEntry.withinCTEPrefix,
                  k: wExp.length,
                  beta: rCls._betaFull,
                }));
                logEstimate({ path: "sql", phase: `meat-${effModel}-${seTypeNorm}`, n: rowCount, k: wExp.length, msTotal: mm.ms });
                meatResult = mm.result.meat;
                engineHcType = seTypeNorm === "HC1" ? "HC1" : null;

              } else if (seTypeNorm === "HC2" || seTypeNorm === "HC3") {
                // dim² > 1000 guard already fired in dispatcher; safe here
                const mm = await measure(() => computeWithinHCMeatWithLeverage({
                  withinCTEPrefix: panelEntry.withinCTEPrefix,
                  k: wExp.length,
                  beta: rCls._betaFull,
                  Ainv: rCls.XtXinv,
                  hcType: seTypeNorm,
                }));
                logEstimate({ path: "sql", phase: `meat-${effModel}-${seTypeNorm}`, n: rowCount, k: wExp.length, msTotal: mm.ms });
                meatResult = mm.result.meat;
                engineHcType = seTypeNorm;

              } else if (seTypeNorm === "clustered") {
                // Default cluster = entity (natural cluster for FE/FD/TWFE)
                // _g in wf is always _u_ per Option A in duckdbWithin.js
                const mm = await measure(() => computeWithinClusterMeat({
                  withinCTEPrefix: panelEntry.withinCTEPrefix,
                  k: wExp.length,
                  beta: rCls._betaFull,
                }));
                logEstimate({ path: "sql", phase: `meat-${effModel}-clustered`, n: rowCount, k: wExp.length, msTotal: mm.ms });
                meatResult = mm.result.meat;
                engineHcType = null; // meat already scaled inside computeWithinClusterMeat

              } else if (seTypeNorm === "HAC") {
                const mm = await measure(() => computeWithinDriscollKraayMeat({
                  withinCTEPrefix: panelEntry.withinCTEPrefix,
                  k: wExp.length,
                  beta: rCls._betaFull,
                  lag: seOpts?.lag ?? null,
                }));
                logEstimate({ path: "sql", phase: `meat-${effModel}-HAC`, n: rowCount, k: wExp.length, msTotal: mm.ms });
                meatResult = mm.result.meat;
                engineHcType = null; // meat pre-scaled by DK
              }

              if (meatResult !== null) {
                rFinal = solver({ ...panelEntry, meat: meatResult, hcType: engineHcType });
                if (!rFinal) throw new Error(`Suff-stats ${effModel} robust solve returned null`);
              }
            }

            if (effModel === "EventStudy") {
              const idxByName = new Map(wExp.map((name, idx) => [name, idx]));
              const eventCoeffs = eventStudySynth.eventTerms.map(({ k, name }) => {
                const idx = idxByName.get(name);
                return {
                  k,
                  beta: rFinal.beta[idx],
                  se: rFinal.se[idx],
                  t: rFinal.tStats[idx],
                  p: rFinal.pVals[idx],
                };
              });
              eventCoeffs.push({ k: eventStudySynth.refK, beta: 0, se: 0, t: null, p: null, isRef: true });
              eventCoeffs.sort((a, b) => a.k - b.k);

              const preIdxs = eventStudySynth.eventTerms
                .filter(({ k }) => k < eventStudySynth.refK)
                .map(({ name }) => (idxByName.get(name) ?? -1) + 1)
                .filter(idx => idx > 0);
              let preTestStat = null;
              let preTestPval = null;
              if (preIdxs.length > 0 && rCls.XtXinv && Number.isFinite(rCls.s2)) {
                const subV = preIdxs.map(rowIdx =>
                  preIdxs.map(colIdx => rCls.XtXinv[rowIdx][colIdx] * rCls.s2)
                );
                const subVinv = matInv(subV);
                if (subVinv) {
                  const preBeta = preIdxs.map(idx => rCls._betaFull[idx]);
                  const temp = subVinv.map(row =>
                    row.reduce((sum, value, idx) => sum + value * preBeta[idx], 0)
                  );
                  preTestStat = temp.reduce((sum, value, idx) => sum + value * preBeta[idx], 0) / preIdxs.length;
                  preTestPval = 1 - fCDF(preTestStat, preIdxs.length, rCls.df);
                }
              }

              const eventRaw = {
                ...rFinal,
                varNames: eventStudySynth.varNames,
                R2: rFinal.R2_within ?? null,
                adjR2: null,
                eventCoeffs,
                preTestStat,
                preTestPval,
                windowPre: Math.max(1, kPre || 3),
                windowPost: Math.max(1, kPost || 3),
              };
              const wrapped = wrapResult("EventStudy", eventRaw, {
                yVar: yVar[0],
                xVars,
                wVars,
                entityCol: unitCol,
                timeCol,
                treatTimeCol: treatTimeCol[0],
                kPre: Math.max(1, kPre || 3),
                kPost: Math.max(1, kPost || 3),
              });
              setResult(wrapped);
              setPanelFE(null);
              setPanelFD(null);
              return;
            }

            if (effModel === "TWFE") {
              const twfeNames = [...twfeSynth.varNames];
              const twfeRaw = {
                ...rFinal,
                varNames: twfeNames,
                R2: rFinal.R2_within ?? null,
                adjR2: null,
                att: rFinal.beta[twfeSynth.attIdx] ?? null,
                attSE: rFinal.se[twfeSynth.attIdx] ?? null,
                attT: rFinal.tStats[twfeSynth.attIdx] ?? null,
                attP: rFinal.pVals[twfeSynth.attIdx] ?? null,
              };
              const wrapped = wrapResult("TWFE", twfeRaw, {
                yVar: yVar[0],
                wVars,
                entityCol: unitCol,
                timeCol,
                treatVar: treatVar[0],
              });
              setResult(wrapped);
              setPanelFE(null);
              setPanelFD(null);
              return;
            }

            const panelSpec = { yVar: yVar[0], xVars, wVars, entityCol: unitCol, timeCol };
            const wrapped = wrapResult(effModel, rFinal, panelSpec);
            const resultBundle = effModel === "FE"
              ? { type: "FE", fe: wrapped, fd: null }
              : { type: "FD", fe: null, fd: wrapped };
            setResult(resultBundle);
            if (effModel === "FE") { setPanelFE(wrapped); setPanelFD(null); }
            else                   { setPanelFD(wrapped); setPanelFE(null); }
            return;
          }

          // ── OLS SQL branch (existing) ──
          let xColsExpanded;
          let dummySQL;
          let didSynth = null;
          if (effModel === "DiD") {
            const controlsExpansion = await expandFactors({ xCols: wVars, tableName: duckTable });
            didSynth = buildDiD2x2Synthetic({
              postCol: postVar[0],
              treatCol: treatVar[0],
              controls: controlsExpansion.xColsExpanded,
            });
            xColsExpanded = didSynth.xColsExpanded;
            dummySQL = { ...controlsExpansion.dummySQL, ...didSynth.dummySQL };
          } else {
            const expansion = await expandFactors({ xCols: allX, tableName: duckTable });
            xColsExpanded = expansion.xColsExpanded;
            dummySQL = expansion.dummySQL;
          }
          // Re-check post-expansion k against threshold
          if (!shouldUseSQLPath({ ...dispatchCtx, xColsExpanded })) {
            throw new Error("Post-expansion k exceeds threshold — fallback to JS");
          }

          const cache = suffStatsCacheRef.current;
          const key   = makeCacheKey(duckTable, yVar[0], xColsExpanded);
          let entry   = cache.get(key);
          let cacheHit = entry != null && validateSuffStatsEntry(entry, xColsExpanded);
          if (!cacheHit) {
            const m = await measure(() => buildOLSSuffStats(duckTable, yVar[0], xColsExpanded, { dummySQL }));
            entry = { ...m.result, dummySQL };
            cache.set(key, entry);
            logEstimate({ path: "sql", phase: "suffStats", n: rowCount, k: xColsExpanded.length, msTotal: m.ms });
          }

          // Compute β and Ainv once (needed for HC2/HC3 leverage). Cached on entry.
          if (!entry.beta) {
            const classicalRaw = runOLSFromSuffStats({
              n: entry.n, XtX: entry.XtX, XtY: entry.XtY,
              YtY: entry.YtY, sumY: entry.sumY, varNames: entry.varNames,
            });
            if (!classicalRaw) throw new Error("Suff-stats solve returned null (singular X'X)");
            entry.beta = classicalRaw.beta;
            entry.Ainv = classicalRaw.XtXinv;
          }

          // Meat pass — unified branch over all robust SE types
          let meat = null;
          const seUp = seTypeNorm;  // canonicalized above

          if (seUp === "HC0" || seUp === "HC1") {
            const mm = await measure(() => computeHCMeat({
              tableName: duckTable, yCol: yVar[0], xColsExpanded, dummySQL, beta: entry.beta,
            }));
            meat = mm.result.meat;
            logEstimate({ path: "sql", phase: `meat-${seUp}`, n: rowCount, k: xColsExpanded.length, msTotal: mm.ms });
          }
          else if (seUp === "HC2" || seUp === "HC3") {
            const mm = await measure(() => computeHCMeatWithLeverage({
              tableName: duckTable, yCol: yVar[0], xColsExpanded, dummySQL,
              beta: entry.beta, Ainv: entry.Ainv, hcType: seUp,
            }));
            meat = mm.result.meat;
            logEstimate({ path: "sql", phase: `meat-${seUp}`, n: rowCount, k: xColsExpanded.length, msTotal: mm.ms });
          }
          else if (seUp === "clustered") {
            // Preflight: G > n/2 → fallback (too many clusters for SQL path)
            const { G, n: nC } = await countClusters(duckTable, clusterVar);
            if (G > nC / 2) {
              throw new Error(`cluster degenerate (G=${G}, n=${nC}) — fallback to JS`);
            }
            const mm = await measure(() => computeClusterMeat({
              tableName: duckTable, yCol: yVar[0], xColsExpanded, dummySQL,
              beta: entry.beta, clusterCol: clusterVar,
            }));
            meat = mm.result.meat;
            logEstimate({ path: "sql", phase: "meat-clustered", n: rowCount, k: xColsExpanded.length, G, msTotal: mm.ms });
          }
          else if (seUp === "twoway") {
            const mm = await measure(() => computeTwowayClusterMeat({
              tableName: duckTable, yCol: yVar[0], xColsExpanded, dummySQL,
              beta: entry.beta, clusterCol: clusterVar, clusterCol2: clusterVar2,
            }));
            meat = mm.result.meat;
            logEstimate({ path: "sql", phase: "meat-twoway", n: rowCount, k: xColsExpanded.length,
                          G1: mm.result.G1, G2: mm.result.G2, G12: mm.result.G12, msTotal: mm.ms });
          }
          else if (seUp === "HAC") {
            const orderCol = timeVar ?? panel?.timeCol ?? null;
            const entityCol = panel?.entityCol ?? null;
            const mm = await measure(() => computeHACMeat({
              tableName: duckTable, yCol: yVar[0], xColsExpanded, dummySQL,
              beta: entry.beta, orderCol, entityCol,
              maxLag: maxLag != null ? Number(maxLag) : undefined,
            }));
            meat = mm.result.meat;
            logEstimate({ path: "sql", phase: "meat-HAC", n: rowCount, k: xColsExpanded.length, L: mm.result.L, msTotal: mm.ms });
          }
          // classical → meat stays null; engine reports classical SE only

          // Engine: pass hcType only for HC1 (engine applies n/(n-k) scaling there).
          // For clustered/twoway/HAC the meat is already pre-scaled inside the builder.
          const engineHcType = (seUp === "HC1") ? "HC1" : null;

          const m2 = await measure(() => runOLSFromSuffStats({
            n: entry.n, XtX: entry.XtX, XtY: entry.XtY,
            YtY: entry.YtY, sumY: entry.sumY, varNames: entry.varNames,
            meat, hcType: engineHcType,
          }));
          const raw = m2.result;
          logEstimate({
            path: "sql", phase: "solve", n: rowCount, k: xColsExpanded.length,
            seType: seUp, cacheHit, msTotal: m2.ms,
          });

          if (raw) {
            raw._hasLazyResiduals = true;
            raw._residualsThunk   = () => sampleResiduals({
              tableName: duckTable, yCol: yVar[0], xColsExpanded, dummySQL,
              beta: raw.beta, sampleSize: 5000,
            });
            const wrapped = effModel === "DiD"
              ? wrapResult("DiD", {
                ...raw,
                varNames: didSynth.varNames,
                att: raw.beta[didSynth.attIdx] ?? null,
                attSE: raw.se[didSynth.attIdx] ?? null,
                attT: raw.tStats[didSynth.attIdx] ?? null,
                attP: raw.pVals[didSynth.attIdx] ?? null,
              }, {
                yVar: yVar[0],
                wVars,
                postVar: postVar[0],
                treatVar: treatVar[0],
              })
              : wrapResult("OLS", raw, {
                yVar: yVar[0], xVars, wVars, weightCol: null,
              });
            setResult(wrapped);
            return;
          }
          // raw === null → singular X'X or n < k; fall through to JS path
        } catch (e) {
          console.warn("[ModelingTab] SQL path failed, falling back to JS:", e);
        }
      }

      // ── Standard path: extract full rows into JS, run engine ───────────────
      // For DuckDB datasets, `rows` is only a 500-row preview.
      let estimationRows = rows;
      if (duckTable && rows.length < (rowCount || Infinity)) {
        const me = await measure(() => extractAllRows(duckTable));
        estimationRows = me.result;
        logEstimate({ path: "js", phase: "extract", n: rowCount, msTotal: me.ms });
      }
      const mj = await measure(async () => _runEstimation(estimationRows));
      const out = mj.result;
      logEstimate({
        path: "js", phase: "estimate",
        n: estimationRows.length, k: allX.length,
        estimator: effModel, seType, msTotal: mj.ms,
      });
      if (out.error) { setErr(out.error); }
      else { setResult(out.result); setPanelFE(out.panelFE ?? null); setPanelFD(out.panelFD ?? null); }
    } catch (e) {
      setErr("Failed to load dataset for estimation: " + (e?.message ?? e));
    } finally {
      setRunning(false);
    }
  }, [subsets, rows, cleanedData, headers, fullPipeline, branchPointIdx, pipelineCtx, _runEstimation,
      model, family, yVar, xVars, wVars, zVars, weightVar, factorVars, seType,
      clusterVar, clusterVar2, timeVar, maxLag, panel, seOpts,
      postVar, treatVar, treatTimeCol, kPre, kPost, poissonEntityCol]);

  // B2: fire estimate() after xVars state update has settled
  useEffect(() => {
    if (!pendingEstimate) return;
    setPendingEstimate(false);
    estimate();
  }, [pendingEstimate, estimate]); // eslint-disable-line react-hooks/exhaustive-deps

  const openReport = useCallback((raw) => setReportResult(raw), []);
  const diagX = [...xVars, ...wVars];

  // ── Replicate config — base object shared by all ExportBar callsites ─────────
  // Each callsite merges this with its specific model params.
  const baseReplicateConfig = useMemo(() => ({
    filename:        cleanedData?.filename ?? "dataset.csv",
    pipeline:        cleanedData?.changeLog ?? [],
    dataDictionary:  cleanedData?.dataDictionary ?? null,
    auditTrail:      null,  // auditor runs on-demand inside generateRScript
    model: {
      entityCol:  panel?.entityCol ?? null,
      timeCol:    panel?.timeCol   ?? null,
      factorVars: Array.from(factorVars),
    },
  }), [cleanedData, panel, factorVars]);

  // ── RENDER ──────────────────────────────────────────────────────────────────
  return (
    <div style={{ background: C.bg, color: C.text, fontFamily: mono, height: "100%", display: "flex", flexDirection: "column", position: "relative" }}>
      <style>{`
        @keyframes fadeUp  { from { opacity:0; transform:translateY(6px);  } to { opacity:1; transform:translateY(0); } }
        @keyframes spin    { to   { transform:rotate(360deg); } }
        @keyframes slideIn { from { opacity:0; transform:translateX(32px); } to { opacity:1; transform:translateX(0); } }
      `}</style>

      {/* ══ Reporting Overlay ══ */}
      {reportResult && (
        <div
          style={{ position: "absolute", inset: 0, zIndex: 100, display: "flex", background: "rgba(8,8,8,0.72)", backdropFilter: "blur(2px)" }}
          onClick={e => { if (e.target === e.currentTarget) setReportResult(null); }}
        >
          <div style={{
            marginLeft: "auto", width: "min(780px,95vw)", height: "100%",
            background: C.bg, borderLeft: `1px solid ${C.border}`,
            display: "flex", flexDirection: "column",
            animation: "slideIn 0.22s ease", overflow: "hidden",
          }}>
            <ReportingModule result={reportResult} cleanedData={cleanedData} onClose={() => setReportResult(null)} />
          </div>
        </div>
      )}

      {/* ══ Lab Header ══ */}
      <div style={{ borderBottom: `1px solid ${C.border}`, padding: "0.6rem 1.4rem", display: "flex", alignItems: "center", gap: 12, background: C.surface, flexShrink: 0 }}>
        <button onClick={onBack} style={{ background: "transparent", border: "none", color: C.textMuted, cursor: "pointer", fontFamily: mono, fontSize: 11 }}>
          ← Back
        </button>
        <span style={{ color: C.border2 }}>|</span>
        <span style={{ fontSize: 9, color: C.teal, letterSpacing: "0.24em", textTransform: "uppercase" }}>◈ Modeling Lab</span>
        <span style={{ marginLeft: "auto", fontSize: 9, color: C.textMuted, letterSpacing: "0.12em" }}>
          {rows.length} obs · {numericCols.length} numeric cols
          {panel && <span style={{ color: C.blue }}> · Panel {panel.entityCol}×{panel.timeCol}</span>}
        </span>
      </div>

      {/* ══ Body ══ */}
      <div style={{ flex: 1, display: "flex", minHeight: 0 }}>

        {/* ── LEFT: Spec Panel ── */}
        <div style={{ width: 300, flexShrink: 0, borderRight: `1px solid ${C.border}`, overflowY: "auto", padding: "1.2rem", paddingBottom: "3rem" }}>

          <HintBox color={C.teal} title="How to model" overlayLeft={300} sections={[
            { heading: "Estimators", items: [
              "OLS — ordinary least squares",
              "WLS — weighted least squares (supply a weight column in W)",
              "FE — fixed effects within estimator (panel required)",
              "FD — first differences (panel required)",
              "TWFE — two-way fixed effects DiD (panel required)",
              "2×2 DiD — classic difference-in-differences",
              "2SLS / IV — instrumental variables; Z = instrument columns",
              "Sharp RDD — local polynomial with IK bandwidth selection",
              "Logit / Probit — binary outcome MLE, marginal effects at mean",
              "GMM / LIML — generalized method of moments",
              "Synthetic Control — Frank-Wolfe, placebo inference",
            ]},
            { heading: "Workflow", items: [
              "1. Estimator sidebar (left): pick model group → estimator",
              "2. Variable Selector: assign Y (outcome), X (regressors), W (weights / instruments / controls)",
              "3. Model Configuration: set estimator-specific options (Z instruments, cutoff, treated unit…)",
              "4. Inference Options: choose SE type",
              "5. Click Estimate",
            ]},
            { heading: "Standard Errors", items: [
              "Classical — homoskedastic (default)",
              "HC1 / HC2 / HC3 — heteroskedasticity-robust (HC3 best for small N)",
              "Clustered — one-way cluster-robust; specify the cluster column",
              "Two-Way CGM — Cameron-Gelbach-Miller two-way clustering",
              "Newey-West HAC — time-series robust with lag selection",
            ]},
            { heading: "After Estimating", items: [
              "Pin any result to the Model Buffer (◈ icon) — compare specs side-by-side",
              "Model Buffer bar: coefficient comparison table across all pinned models",
              "Code Editor: view and copy R / Python / Stata replication scripts",
              "Plot Builder: build result-augmented charts from estimated data",
              "Spec Curve: test coefficient stability across a threshold range",
              "Export: LaTeX table, CSV coefficients, or full replication zip bundle",
              "AI Coach (? button): get methodological feedback on your specification",
            ]},
            { heading: "Panel Requirements", items: [
              "FE, FD, TWFE, Event Study require entity + time declared in Clean → Panel Structure tab",
              "Without panel declaration, these estimators are disabled",
            ]},
          ]} />

          <EstimatorSidebar
            model={model}
            onSelect={handleModelSelect}
            modelAvail={modelAvail}
            modelHint={modelHint}
            panel={panel}
            family={family}
            onFamilySelect={setFamily}
          />

          <VariableSelector
            model={model}
            numericCols={numericCols}
            allCols={headers}
            yVar={yVar}   setYVar={setYVar}
            xVars={xVars} setXVars={setXVars}
            wVars={wVars} setWVars={setWVars}
            factorVars={factorVars}
            onToggleFactor={toggleFactor}
          />

          <ModelConfiguration
            model={model}
            family={family}
            numericCols={numericCols}
            yVar={yVar}
            xVars={xVars}         setXVars={setXVars}
            wVars={wVars}         setWVars={setWVars}
            zVars={zVars}         setZVars={setZVars}
            treatVar={treatVar}   setTreatVar={setTreatVar}
            postVar={postVar}     setPostVar={setPostVar}
            runningVar={runningVar} setRunningVar={setRunningVar}
            cutoff={cutoff}       setCutoff={setCutoff}
            bwMode={bwMode}       setBwMode={setBwMode}
            bwManual={bwManual}   setBwManual={setBwManual}
            kernel={kernel}       setKernel={setKernel}
            polyOrder={polyOrder} setPolyOrder={setPolyOrder}
            weightVar={weightVar} setWeightVar={setWeightVar}
            treatTimeCol={treatTimeCol}     setTreatTimeCol={setTreatTimeCol}
            kPre={kPre}                     setKPre={setKPre}
            kPost={kPost}                   setKPost={setKPost}
            lsdvTimeFE={lsdvTimeFE}         setLsdvTimeFE={setLsdvTimeFE}
            treatedUnit={treatedUnit}       setTreatedUnit={setTreatedUnit}
            synthTreatTime={synthTreatTime} setSynthTreatTime={setSynthTreatTime}
            poissonEntityCol={poissonEntityCol} setPoissonEntityCol={setPoissonEntityCol}
            poissonOffsetCol={poissonOffsetCol} setPoissonOffsetCol={setPoissonOffsetCol}
            poissonExtraFE={poissonExtraFE}     setPoissonExtraFE={setPoissonExtraFE}
            cohortCol={cohortCol}           setCohortCol={setCohortCol}
            periodCol={periodCol}           setPeriodCol={setPeriodCol}
            saUnitCol={saUnitCol}           setSaUnitCol={setSaUnitCol}
            saControlMode={saControlMode}   setSaControlMode={setSaControlMode}
            saRefPeriod={saRefPeriod}       setSaRefPeriod={setSaRefPeriod}
            csTreatCol={csTreatCol}         setCsTreatCol={setCsTreatCol}
            csEntityCol={csEntityCol}       setCsEntityCol={setCsEntityCol}
            csTimeCol={csTimeCol}           setCsTimeCol={setCsTimeCol}
            csCompGroup={csCompGroup}       setCsCompGroup={setCsCompGroup}
            csRelMin={csRelMin}             setCsRelMin={setCsRelMin}
            csRelMax={csRelMax}             setCsRelMax={setCsRelMax}
            spatialModel={spatialModel}     setSpatialModel={setSpatialModel}
            spatialWeightsMode={spatialWeightsMode} setSpatialWeightsMode={setSpatialWeightsMode}
            spatialGeomCol={spatialGeomCol} setSpatialGeomCol={setSpatialGeomCol}
            spatialWeightsType={spatialWeightsType} setSpatialWeightsType={setSpatialWeightsType}
            spatialWeightsStyle={spatialWeightsStyle} setSpatialWeightsStyle={setSpatialWeightsStyle}
            spatialWeightsK={spatialWeightsK} setSpatialWeightsK={setSpatialWeightsK}
            spatialWeightsD={spatialWeightsD} setSpatialWeightsD={setSpatialWeightsD}
            spatialWeightsDatasetId={spatialWeightsDatasetId} setSpatialWeightsDatasetId={setSpatialWeightsDatasetId}
            spatialWeightsICol={spatialWeightsICol} setSpatialWeightsICol={setSpatialWeightsICol}
            spatialWeightsJCol={spatialWeightsJCol} setSpatialWeightsJCol={setSpatialWeightsJCol}
            spatialWeightsWCol={spatialWeightsWCol} setSpatialWeightsWCol={setSpatialWeightsWCol}
            availableDatasets={availableDatasets}
            rows={rows}
            headers={headers}
            panel={panel}
          />

          <InferenceOptions
            modelType={model}
            headers={headers}
            seType={seType}           setSeType={setSeType}
            clusterVar={clusterVar}   setClusterVar={setClusterVar}
            clusterVar2={clusterVar2} setClusterVar2={setClusterVar2}
            timeVar={timeVar}         setTimeVar={setTimeVar}
            panelTimeCol={panel?.timeCol ?? null}
            maxLag={maxLag}           setMaxLag={setMaxLag}
          />

          {/* ── B2: Quick Variation ── */}
          {result && (
            <div style={{ marginTop: 6 }}>
              <button
                onClick={() => setVarOpen(v => !v)}
                style={{
                  width: "100%", display: "flex", alignItems: "center", justifyContent: "space-between",
                  padding: "0.4rem 0.65rem",
                  background: varOpen ? `${C.gold}0a` : C.surface,
                  border: `1px solid ${varOpen ? C.gold + "40" : C.border}`,
                  borderRadius: varOpen ? "4px 4px 0 0" : 4,
                  cursor: "pointer", fontFamily: mono,
                }}
              >
                <span style={{ fontSize: 9, color: C.gold, letterSpacing: "0.18em", textTransform: "uppercase" }}>
                  {varOpen ? "▾" : "▸"} Quick variation
                </span>
              </button>
              {varOpen && (
                <div style={{
                  border: `1px solid ${C.gold}40`, borderTop: "none",
                  borderRadius: "0 0 4px 4px", padding: "0.6rem 0.65rem",
                  background: C.surface,
                }}>
                  <div style={{ display: "flex", gap: 4, marginBottom: 6 }}>
                    <div style={{ flex: 1 }}>
                      <div style={{ fontSize: 8, color: C.textMuted, fontFamily: mono, letterSpacing: "0.12em", marginBottom: 3 }}>SWAP OUT</div>
                      <select
                        value={swapOut}
                        onChange={e => setSwapOut(e.target.value)}
                        style={{ width: "100%", background: C.bg, color: C.text, border: `1px solid ${C.border}`, borderRadius: 3, fontFamily: mono, fontSize: 10, padding: "3px 5px" }}
                      >
                        <option value="">— current X —</option>
                        {xVars.map(v => <option key={v} value={v}>{v}</option>)}
                      </select>
                    </div>
                    <div style={{ flex: 1 }}>
                      <div style={{ fontSize: 8, color: C.textMuted, fontFamily: mono, letterSpacing: "0.12em", marginBottom: 3 }}>SWAP IN</div>
                      <select
                        value={swapIn}
                        onChange={e => setSwapIn(e.target.value)}
                        style={{ width: "100%", background: C.bg, color: C.text, border: `1px solid ${C.border}`, borderRadius: 3, fontFamily: mono, fontSize: 10, padding: "3px 5px" }}
                      >
                        <option value="">— available —</option>
                        {headers.filter(h => !xVars.includes(h) && h !== yVar[0]).map(v => <option key={v} value={v}>{v}</option>)}
                      </select>
                    </div>
                  </div>
                  <button
                    disabled={!swapOut || !swapIn}
                    onClick={() => {
                      if (!swapOut || !swapIn) return;
                      setXVars(prev => prev.map(v => v === swapOut ? swapIn : v));
                      setSwapOut(""); setSwapIn("");
                      setPendingEstimate(true);
                    }}
                    style={{
                      width: "100%", padding: "4px 0",
                      background: swapOut && swapIn ? `${C.gold}18` : "none",
                      border: `1px solid ${swapOut && swapIn ? C.gold : C.border}`,
                      borderRadius: 3, cursor: swapOut && swapIn ? "pointer" : "not-allowed",
                      fontFamily: mono, fontSize: 9, color: swapOut && swapIn ? C.gold : C.textMuted,
                      letterSpacing: "0.1em",
                    }}
                  >
                    Re-estimate ↺
                  </button>
                </div>
              )}
            </div>
          )}

          <CodeEditor result={result} allDatasets={allDatasetsMap} />

          {/* ── B5: Session History ── */}
          <ModelHistory
            history={modelHistory}
            onRestore={entry => setResult(entry)}
            onClear={() => setModelHistory([])}
          />

          <SubsetManager
            headers={headers}
            rows={rows}
            subsets={subsets}
            onChange={setSubsets}
            onRunAll={runAllSubsets}
            running={running}
          />

          {/* ── H7: Download multi-subset bundle ── */}
          {subsets.length > 0 && (
            <button
              onClick={() => {
                const sharedSteps  = branchPointIdx !== null ? fullPipeline.slice(0, branchPointIdx + 1) : fullPipeline;
                const perSubSteps  = branchPointIdx !== null && branchPointIdx < fullPipeline.length - 1
                  ? fullPipeline.slice(branchPointIdx + 1) : [];
                downloadMultiSubsetBundle({
                  filename:       cleanedData?.filename       ?? "dataset.csv",
                  pipeline:       sharedSteps,
                  perSubsetSteps: perSubSteps,
                  subsets,
                  model: {
                    type: model, yVar: yVar[0] ?? "", xVars, wVars,
                    entityCol: panel?.entityCol ?? null,
                    timeCol:   panel?.timeCol   ?? null,
                  },
                  dataDictionary: cleanedData?.dataDictionary ?? null,
                });
              }}
              style={{
                width: "100%", marginTop: 6, padding: "4px 0",
                background: "none", border: `1px solid ${C.border2}`,
                borderRadius: 3, cursor: "pointer",
                fontFamily: mono, fontSize: 9, color: C.textMuted,
                letterSpacing: "0.1em",
              }}
            >
              ↓ Download subset bundle (.zip)
            </button>
          )}

          {/* ── H8: Specification curve ── */}
          {result && headers?.length > 0 && (
            <div style={{ marginTop: "0.75rem" }}>
              <button
                onClick={() => setSpecOpen(v => !v)}
                style={{
                  width: "100%", display: "flex", alignItems: "center",
                  justifyContent: "space-between", padding: "0.5rem 0.75rem",
                  background: specOpen ? `${C.blue}0d` : C.surface,
                  border: `1px solid ${specOpen ? C.blue + "50" : C.border}`,
                  borderRadius: specOpen ? "4px 4px 0 0" : 4,
                  cursor: "pointer", fontFamily: mono, transition: "all 0.13s",
                }}
              >
                <span style={{ fontSize: 9, color: C.blue, letterSpacing: "0.22em", textTransform: "uppercase" }}>
                  ◈ Spec Curve {specRows.length > 0 ? `(${specRows.length} pts)` : ""}
                </span>
                <span style={{ fontSize: 9, color: C.textMuted }}>{specOpen ? "▲" : "▼"}</span>
              </button>

              {specOpen && (
                <div style={{
                  border: `1px solid ${C.blue}50`, borderTop: "none",
                  borderRadius: "0 0 4px 4px", padding: "0.85rem 0.75rem",
                  background: C.surface,
                }}>
                  <div style={{ fontSize: 9, color: C.textMuted, fontFamily: mono, marginBottom: 8, lineHeight: 1.6 }}>
                    Vary a threshold and plot how the coefficient of interest changes.
                  </div>
                  {/* Threshold column + op */}
                  <div style={{ display: "flex", gap: 4, marginBottom: 5 }}>
                    <select
                      value={specConfig.col}
                      onChange={e => setSpecConfig(c => ({ ...c, col: e.target.value }))}
                      style={{ flex: 3, background: C.bg, color: C.text, border: `1px solid ${C.border}`, borderRadius: 3, fontFamily: mono, fontSize: 10, padding: "3px 5px" }}
                    >
                      <option value="">— threshold column —</option>
                      {(headers ?? []).map(h => <option key={h} value={h}>{h}</option>)}
                    </select>
                    <select
                      value={specConfig.op}
                      onChange={e => setSpecConfig(c => ({ ...c, op: e.target.value }))}
                      style={{ flex: 1, background: C.bg, color: C.teal, border: `1px solid ${C.border}`, borderRadius: 3, fontFamily: mono, fontSize: 10, padding: "3px 5px" }}
                    >
                      {[">=", "<=", ">", "<"].map(op => <option key={op} value={op}>{op}</option>)}
                    </select>
                  </div>
                  {/* Range inputs */}
                  <div style={{ display: "flex", gap: 4, marginBottom: 5 }}>
                    {[["start", "from"], ["end", "to"], ["step", "step"]].map(([k, lbl]) => (
                      <input
                        key={k}
                        type="number"
                        value={specConfig[k]}
                        onChange={e => setSpecConfig(c => ({ ...c, [k]: e.target.value }))}
                        placeholder={lbl}
                        style={{ flex: 1, background: C.bg, border: `1px solid ${C.border}`, borderRadius: 3, fontFamily: mono, fontSize: 10, padding: "3px 5px", color: C.text, outline: "none" }}
                      />
                    ))}
                  </div>
                  {/* Coefficient of interest */}
                  <select
                    value={specConfig.coefVar}
                    onChange={e => setSpecConfig(c => ({ ...c, coefVar: e.target.value }))}
                    style={{ width: "100%", background: C.bg, color: C.text, border: `1px solid ${C.border}`, borderRadius: 3, fontFamily: mono, fontSize: 10, padding: "3px 5px", marginBottom: 8 }}
                  >
                    <option value="">— coefficient of interest —</option>
                    {(result?.varNames ?? []).filter(v => v !== "(Intercept)").map(v => <option key={v} value={v}>{v}</option>)}
                  </select>
                  <button
                    onClick={runSpecCurve}
                    disabled={specRunning || !specConfig.col || !specConfig.coefVar}
                    style={{
                      width: "100%", padding: "5px 0", borderRadius: 3,
                      background: specRunning ? "transparent" : `${C.blue}15`,
                      border: `1px solid ${specRunning ? C.border : C.blue + "60"}`,
                      color: specRunning ? C.textMuted : C.blue,
                      fontFamily: mono, fontSize: 9, cursor: "pointer", letterSpacing: "0.12em",
                    }}
                  >
                    {specRunning ? "◌ running…" : "▶ Run spec curve"}
                  </button>

                  {/* Inline chart */}
                  {specRows.length > 0 && (
                    <div style={{ marginTop: 10 }}>
                      <PlotBuilder
                        key={specRows.length}
                        pid={pid && `${pid}_spec`}
                        headers={["threshold", "estimate", "se", "ciLow", "ciHigh", "n"]}
                        rows={specRows}
                        initialLayers={[
                          { id: "sc_a", geom: "ribbon",   aes: { x: "threshold", y: "", color: "", yMin: "ciLow", yMax: "ciHigh" }, value: "", position: "identity", fill: C.blue, visible: true },
                          { id: "sc_b", geom: "line",     aes: { x: "threshold", y: "estimate", color: "", yMin: "", yMax: "" },     value: "", position: "identity", fill: C.blue, visible: true },
                          { id: "sc_c", geom: "point",    aes: { x: "threshold", y: "estimate", color: "", yMin: "", yMax: "" },     value: "", position: "identity", fill: C.blue, visible: true },
                          { id: "sc_d", geom: "hline",    aes: { x: "", y: "", color: "", yMin: "", yMax: "" },                      value: "0", position: "identity", fill: C.textDim, visible: true },
                        ]}
                        style={{ minHeight: 260 }}
                      />
                      <div style={{ fontSize: 9, color: C.textMuted, fontFamily: mono, marginTop: 4, textAlign: "center" }}>
                        {specConfig.col} {specConfig.op} threshold → coef({specConfig.coefVar}) · {specRows.length} pts
                      </div>
                    </div>
                  )}
                </div>
              )}
            </div>
          )}

          <button
            onClick={estimate}
            disabled={running || !yVar.length}
            style={{
              width: "100%", padding: "0.75rem",
              background: !running && yVar.length ? `${C.teal}18` : "transparent",
              border: `1px solid ${!running && yVar.length ? C.teal : C.border}`,
              color: !running && yVar.length ? C.teal : C.textMuted,
              borderRadius: 4, cursor: !running && yVar.length ? "pointer" : "not-allowed",
              fontFamily: mono, fontSize: 13, letterSpacing: "0.12em",
              transition: "all 0.15s", marginTop: "0.5rem",
            }}
          >
            {running
              ? <span style={{ display: "inline-block", animation: "spin 1s linear infinite" }}>◌</span>
              : "▶ Estimate"}
          </button>

          {err && (
            <div style={{
              marginTop: "0.8rem", padding: "0.6rem 0.8rem",
              background: C.surface, border: `1px solid ${C.red}40`,
              borderLeft: `3px solid ${C.red}`, borderRadius: 4,
              fontSize: 11, color: C.red, fontFamily: mono, lineHeight: 1.6,
            }}>
              {err}
            </div>
          )}
        </div>

        {/* ── RIGHT: Results Panel (column flex so buffer bar sticks to bottom) ── */}
        <div style={{ flex: 1, display: "flex", flexDirection: "column", minHeight: 0, minWidth: 0 }}>
        <div style={{ flex: 1, overflowY: "auto", overflowX: "hidden", padding: "1.4rem 1.6rem", paddingBottom: "3rem" }}>

          {/* ── B3: Data Peek ── */}
          {rows.length > 0 && (() => {
            const peekCols = headers;
            const peekRows = rows.slice(0, 8);
            return (
              <div style={{ marginBottom: "0.9rem" }}>
                <button
                  onClick={() => setPeekOpen(v => !v)}
                  style={{
                    width: "100%", display: "flex", alignItems: "center", justifyContent: "space-between",
                    padding: "0.35rem 0.7rem",
                    background: peekOpen ? `${C.blue}0a` : C.surface,
                    border: `1px solid ${peekOpen ? C.blue + "40" : C.border}`,
                    borderRadius: peekOpen ? "4px 4px 0 0" : 4,
                    cursor: "pointer", fontFamily: mono,
                  }}
                >
                  <span style={{ fontSize: 9, color: C.blue, letterSpacing: "0.18em", textTransform: "uppercase" }}>
                    {peekOpen ? "▾" : "▸"} Data ({rows.length} obs, {headers.length} cols)
                  </span>
                </button>
                {peekOpen && (
                  <div style={{
                    border: `1px solid ${C.blue}40`, borderTop: "none",
                    borderRadius: "0 0 4px 4px",
                    background: C.surface2,
                    maxHeight: 180, overflowY: "auto", overflowX: "auto",
                  }}>
                    <table style={{ width: "100%", borderCollapse: "collapse", fontFamily: mono, fontSize: 9 }}>
                      <thead>
                        <tr>
                          {peekCols.map(col => (
                            <th key={col} style={{
                              padding: "3px 8px", borderBottom: `1px solid ${C.border}`,
                              color: C.teal, fontWeight: 600, textAlign: "left",
                              whiteSpace: "nowrap", letterSpacing: "0.06em",
                              background: C.surface,
                            }}>{col}</th>
                          ))}
                        </tr>
                      </thead>
                      <tbody>
                        {peekRows.map((row, i) => (
                          <tr key={i} style={{ borderBottom: `1px solid ${C.border}` }}>
                            {peekCols.map(col => (
                              <td key={col} style={{
                                padding: "2px 8px", color: C.textDim,
                                whiteSpace: "nowrap", maxWidth: 120,
                                overflow: "hidden", textOverflow: "ellipsis",
                              }}>
                                {row[col] == null ? <span style={{ color: C.textMuted }}>NA</span>
                                  : typeof row[col] === "number" ? (Number.isInteger(row[col]) ? row[col] : row[col].toFixed(4))
                                  : String(row[col]).slice(0, 20)}
                              </td>
                            ))}
                          </tr>
                        ))}
                      </tbody>
                    </table>
                    {peekCols.length < headers.length && (
                      <div style={{ padding: "3px 8px", fontSize: 8, color: C.textMuted, fontFamily: mono, borderTop: `1px solid ${C.border}` }}>
                        Showing {peekCols.length} of {headers.length} cols · first 8 rows
                      </div>
                    )}
                  </div>
                )}
              </div>
            );
          })()}

          {!result && !err && (
            <div style={{ display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", height: "60%", gap: "1rem" }}>
              <div style={{ fontSize: 32, opacity: 0.15 }}>◈</div>
              <div style={{ fontSize: 11, color: C.textMuted, letterSpacing: "0.15em", textTransform: "uppercase" }}>
                Configure your model specification and click Estimate
              </div>
              <div style={{ fontSize: 10, color: C.textMuted, maxWidth: 420, textAlign: "center", lineHeight: 1.8 }}>
                Supported estimators: OLS · Fixed Effects · First Differences · 2SLS/IV · DiD 2×2 · TWFE · Sharp RDD · Logit · Probit
              </div>
            </div>
          )}

          {/* ── Pin / Clear result buttons ── */}
          {result && (
            <div style={{ display: "flex", justifyContent: "flex-end", gap: 6, marginBottom: 8 }}>
              <button
                onClick={() => {
                  setResult(null); setErr(null); setPanelFE(null); setPanelFD(null);
                }}
                style={{
                  padding: "3px 12px", borderRadius: 3, cursor: "pointer",
                  fontFamily: mono, fontSize: 9, letterSpacing: "0.1em",
                  border: `1px solid ${C.border2}`, background: "transparent",
                  color: C.textMuted, transition: "all 0.12s",
                }}
                title="Clear estimated result"
              >
                ✕ Clear
              </button>
              <button
                onClick={() => {
                  const id = modelBuffer.add(result);
                  setActiveBufferId(id);
                  setBufferVersion(v => v + 1);
                }}
                style={{
                  padding: "3px 12px", borderRadius: 3, cursor: "pointer",
                  fontFamily: mono, fontSize: 9, letterSpacing: "0.1em",
                  border: `1px solid ${C.border2}`, background: "transparent",
                  color: C.textDim, transition: "all 0.12s",
                }}
                title="Pin this result for comparison"
              >
                ⊕ Pin
              </button>
            </div>
          )}

          {/* ── Coach Insights ── */}
          {coachingSignals.length > 0 && (
            <div style={{ marginBottom: "1.2rem" }}>
              <div style={{ fontSize: 10, color: C.textMuted, letterSpacing: "0.2em", textTransform: "uppercase", marginBottom: 8 }}>
                Coach Insights
              </div>
              <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
                {coachingSignals.map(s => {
                  const clr = s.severity === "warn" ? C.gold : s.severity === "suggest" ? C.teal : C.blue;
                  const clickable = !!onCoachQuestion && !!s.question;
                  return (
                    <button key={s.id} title={s.detail + "\n\n" + s.suggestion + (clickable ? "\n\nClick to ask the AI coach" : "")}
                      onClick={clickable ? () => onCoachQuestion(s.question) : undefined}
                      style={{ fontSize: 10, color: clr, border: `1px solid ${clr}`, borderRadius: 3,
                               padding: "3px 8px", cursor: clickable ? "pointer" : "default", fontFamily: mono,
                               background: clr + "12", transition: "opacity 0.12s" }}
                      onMouseEnter={e => { if (clickable) e.currentTarget.style.opacity = "0.75"; }}
                      onMouseLeave={e => { e.currentTarget.style.opacity = "1"; }}
                    >
                      {s.severity === "warn" ? "⚠ " : s.severity === "suggest" ? "→ " : "i "}{s.title}
                    </button>
                  );
                })}
              </div>
            </div>
          )}

          {/* OLS / WLS */}
          {(result?.type === "OLS" || result?.type === "WLS") && (() => {
            const r = result;
            return (
              <div style={{ animation: "fadeUp 0.22s ease" }}>
                <div style={{ marginBottom: "1.2rem", display: "flex", alignItems: "baseline", gap: 10 }}>
                  <span style={{ fontSize: 10, color: C.green, letterSpacing: "0.24em", textTransform: "uppercase" }}>{r.label} Results</span>
                  <Badge label={`n = ${r.n}`} color={C.textDim} />
                  <span style={{ fontSize: 12, color: C.textMuted }}>{yVar[0]} ~ {[...xVars, ...wVars].join(" + ")}</span>
                </div>
                <RegressionEquation varNames={r.varNames} beta={r.beta} yVar={yVar[0]} />
                <FitBar items={[
                  { label: "R²",     value: r.R2?.toFixed(4)    ?? "—", color: C.green },
                  { label: "Adj. R²",value: r.adjR2?.toFixed(4) ?? "—", color: C.green },
                  { label: "F-stat", value: r.Fstat?.toFixed(3) ?? "—", color: C.gold },
                  { label: "p(F)",   value: r.Fpval != null ? (r.Fpval < 0.001 ? "<0.001" : r.Fpval.toFixed(4)) : "—", color: r.Fpval != null && r.Fpval < 0.05 ? C.gold : C.textMuted },
                  { label: "n", value: r.n, color: C.text },
                  { label: "df",value: r.df, color: C.textDim },
                ]} />
                <Lbl color={C.textMuted}>Coefficient Table — 95% Confidence Intervals</Lbl>
                <div style={{ marginBottom: "1.2rem" }}>
                  <CoeffTable dict={dict} rows={rows} varNames={r.varNames} beta={r.beta} se={r.se} tStats={r.testStats} pVals={r.pVals} yVar={yVar[0]} df={r.df} />
                </div>
                <Lbl color={C.textMuted}>Coefficient Plot & Diagnostics</Lbl>
                <PlotSelector
                  accentColor={C.green}
                  defaultId={[...xVars, ...wVars].length > 0 ? `partial_${[...xVars, ...wVars][0]}` : "yhat"}
                  plots={[
                    ...[...xVars, ...wVars].map((xc, i) => {
                      const idx = r.varNames.indexOf(xc);
                      return {
                        id: `partial_${xc}`,
                        label: `Y ~ ${xc}`,
                        node: <PartialPlot
                          rows={rows} yCol={yVar[0]} xCol={xc}
                          otherX={[...xVars, ...wVars].filter(x => x !== xc)}
                          beta_i={idx >= 0 ? r.beta[idx] : null}
                          pVal_i={idx >= 0 ? r.pVals[idx] : null}
                          runOLS={runOLS}
                          svgIdSuffix={`-${i}`}
                        />,
                      };
                    }),
                    { id: "yhat",  label: "Y vs Ŷ",
                      node: <YFittedPlot resid={r.resid} Yhat={r.Yhat} yLabel={yVar[0]} /> },
                    { id: "forest", label: "Coefficient plot",
                      node: <ForestPlot varNames={r.varNames} beta={r.beta} se={r.se} pVals={r.pVals} svgId="forest-ols" filename="ols_coefficients.svg" /> },
                    { id: "resid",  label: "Residuals vs Fitted",
                      node: <ResidualVsFitted resid={r.resid} Yhat={r.Yhat} /> },
                    { id: "qq",     label: "Q-Q",
                      node: <QQPlot resid={r.resid} /> },
                  ]}
                />
                <Lbl color={C.textMuted}>Note on Significance</Lbl>
                <div style={{ fontSize: 10, color: C.textMuted, fontFamily: mono, marginBottom: "1.4rem" }}>
                  *** p &lt; 0.01 · ** p &lt; 0.05 · * p &lt; 0.1 · Standard errors in parentheses
                </div>
                <DiagnosticsPanel resid={r.resid} rows={rows} xCols={diagX} model={r.type} />
                <ExportBar yVar={yVar[0]} results={r} model={r.type}
                  onReport={() => openReport({ ...r, modelLabel: r.label, yVar: yVar[0], xVars: [...xVars, ...wVars] })}
                  replicateConfig={{ ...baseReplicateConfig, model: { ...baseReplicateConfig.model, type: r.type, yVar: yVar[0], xVars, wVars, weightCol: r.spec?.weightCol ?? null } }} />
              </div>
            );
          })()}

          {result?.type === "SpatialRegression" && (() => {
            const r = result;
            const paramValue = r.spatialParam === "lambda" ? r.lambda : r.rho;
            const ws = r.weightsSummary ?? {};
            return (
              <div style={{ animation: "fadeUp 0.22s ease" }}>
                <div style={{ marginBottom: "1.2rem", display: "flex", alignItems: "baseline", gap: 10, flexWrap: "wrap" }}>
                  <span style={{ fontSize: 10, color: C.teal, letterSpacing: "0.24em", textTransform: "uppercase" }}>{r.label} Results</span>
                  <Badge label={`n = ${r.n}`} color={C.textDim} />
                  {r.spatialParam && <Badge label={`${r.spatialParam} = ${paramValue?.toFixed?.(4) ?? "—"}`} color={C.gold} />}
                  {ws.links != null && <Badge label={`W links = ${ws.links}`} color={C.textDim} />}
                </div>
                <RegressionEquation varNames={r.varNames} beta={r.beta} yVar={yVar[0]} />
                <FitBar items={[
                  { label: "R²", value: r.R2?.toFixed(4) ?? "—", color: C.teal },
                  { label: "Adj. R²", value: r.adjR2?.toFixed(4) ?? "—", color: C.teal },
                  { label: "logLik", value: r.logLik?.toFixed?.(3) ?? "—", color: C.gold },
                  { label: "AIC", value: r.AIC?.toFixed?.(2) ?? "—", color: C.gold },
                  { label: "BIC", value: r.BIC?.toFixed?.(2) ?? "—", color: C.gold },
                  { label: "islands", value: ws.islands ?? "—", color: C.textDim },
                ]} />
                <Lbl color={C.textMuted}>Spatial Coefficients</Lbl>
                <div style={{ marginBottom: "1.2rem" }}>
                  <CoeffTable dict={dict} rows={rows} varNames={r.varNames} beta={r.beta} se={r.se} tStats={r.testStats} pVals={r.pVals} yVar={yVar[0]} df={r.df} />
                </div>
                {r.warnings?.length > 0 && (
                  <div style={{ fontSize: 10, color: C.gold, fontFamily: mono, marginBottom: "1rem", lineHeight: 1.6 }}>
                    {r.warnings.map((w, i) => <div key={i}>- {w}</div>)}
                  </div>
                )}
                <PlotSelector
                  accentColor={C.teal}
                  defaultId="forest"
                  plots={[
                    { id: "forest", label: "Coefficient plot",
                      node: <ForestPlot varNames={r.varNames} beta={r.beta} se={r.se} pVals={r.pVals} svgId="forest-spatial" filename="spatial_regression_coefficients.svg" /> },
                    { id: "yhat", label: "Y vs Ŷ",
                      node: <YFittedPlot resid={r.resid} Yhat={r.Yhat} yLabel={yVar[0]} svgIdSuffix="-spatial" /> },
                    { id: "resid", label: "Residuals vs Fitted",
                      node: <ResidualVsFitted resid={r.resid} Yhat={r.Yhat} svgIdSuffix="-spatial-resid" /> },
                    { id: "qq", label: "Q-Q",
                      node: <QQPlot resid={r.resid} svgIdSuffix="-spatial-qq" /> },
                  ]}
                />
                <DiagnosticsPanel resid={r.resid} rows={rows} xCols={diagX} model={r.type} />
                <ExportBar yVar={yVar[0]} results={r} model={r.type}
                  onReport={() => openReport({ ...r, modelLabel: r.label, yVar: yVar[0], xVars: [...xVars, ...wVars] })}
                  replicateConfig={{ ...baseReplicateConfig, model: { ...baseReplicateConfig.model, type: r.type, yVar: yVar[0], xVars, wVars, spatialModel: r.spatialModel } }} />
              </div>
            );
          })()}

          {/* Panel FE / FD */}
          {(result?.type === "FE" || result?.type === "FD") && (
            <PanelResults result={result} panel={panel} xVars={xVars} wVars={wVars} yVar={yVar} rows={rows} dict={dict} panelFE={panelFE} panelFD={panelFD} openReport={openReport} baseReplicateConfig={baseReplicateConfig} />
          )}

          {/* 2SLS */}
          {result?.type === "2SLS" && (
            <TwoSLSResults result={result} yVar={yVar} xVars={xVars} wVars={wVars} zVars={zVars} rows={rows} dict={dict} openReport={openReport} baseReplicateConfig={baseReplicateConfig} />
          )}

          {/* GMM */}
          {result?.type === "GMM" && (
            <GMMResults result={result} yVar={yVar} xVars={xVars} wVars={wVars} zVars={zVars} rows={rows} dict={dict} openReport={openReport} baseReplicateConfig={baseReplicateConfig} />
          )}

          {/* LIML */}
          {result?.type === "LIML" && (
            <LIMLResults result={result} yVar={yVar} xVars={xVars} wVars={wVars} zVars={zVars} rows={rows} dict={dict} openReport={openReport} baseReplicateConfig={baseReplicateConfig} />
          )}

          {/* IV-Poisson */}
          {result?.type === "IVPoisson" && (() => {
            const r = result;
            return (
              <div style={{ animation: "fadeUp 0.22s ease" }}>
                <div style={{ marginBottom: "1rem", display: "flex", alignItems: "baseline", gap: 10 }}>
                  <span style={{ fontSize: 10, color: C.blue, letterSpacing: "0.24em", textTransform: "uppercase" }}>IV-Poisson Results</span>
                  <Badge label={`n = ${r.n}`} color={C.textDim} />
                  {r.jDf > 0 && <Badge label={`J ${r.jStat?.toFixed(3)} (p=${r.jPval?.toFixed(3)})`} color={r.jPval < 0.05 ? C.gold : C.teal} />}
                </div>
                {r.firstStages?.map(fs => fs && (
                  <InfoBox key={fs.endVar} color={fs.weak ? C.gold : C.teal}>
                    First stage F ({fs.endVar}): {fs.Fstat?.toFixed(2)} {fs.weak ? "⚠ Weak instrument" : "✓"}
                  </InfoBox>
                ))}
                <Lbl color={C.textMuted}>Coefficients — IV-Poisson (exp link)</Lbl>
                <CoeffTable dict={dict} rows={rows} varNames={r.varNames} beta={r.beta} se={r.se}
                  tStats={r.tStats} pVals={r.pVals} yVar={yVar[0]} df={r.df} statLabel="z" />
                <ExportBar yVar={yVar[0]} results={r} model="IVPoisson"
                  onReport={() => openReport({ ...r, modelLabel: "IV-Poisson", yVar: yVar[0], xVars: [...xVars, ...wVars] })}
                  replicateConfig={baseReplicateConfig ? { ...baseReplicateConfig, model: { ...baseReplicateConfig.model, type: "IVPoisson", yVar: yVar[0] } } : null}
                />
              </div>
            );
          })()}

          {/* Fuzzy RDD */}
          {result?.type === "FuzzyRDD" && (
            <FuzzyRDDResults
              result={result}
              yVar={yVar[0]}
              treatVarName={treatVar[0]}
              runningVar={runningVar[0]}
              dict={dict}
              rows={rows}
              openReport={openReport}
              baseReplicateConfig={baseReplicateConfig}
            />
          )}

          {/* Event Study */}
          {result?.type === "EventStudy" && (() => {
            const r = result;
            return (
              <div style={{ animation: "fadeUp 0.22s ease" }}>
                <div style={{ marginBottom: "1rem", display: "flex", alignItems: "baseline", gap: 10 }}>
                  <span style={{ fontSize: 10, color: C.teal, letterSpacing: "0.24em", textTransform: "uppercase" }}>Event Study Results</span>
                  <Badge label={`n = ${r.n}`} color={C.textDim} />
                  <Badge label={`${r.units ?? "?"} units`} color={C.textDim} />
                </div>
                {r.preTestStat != null && (
                  <div style={{ padding: "0.7rem 1rem", marginBottom: "1rem", background: C.surface2, border: `1px solid ${C.teal}30`, borderLeft: `3px solid ${r.preTestPval < 0.05 ? C.red : C.teal}`, borderRadius: 4 }}>
                    <div style={{ fontSize: 10, color: C.textDim, fontFamily: mono }}>
                      Pre-trend F-test: F = {r.preTestStat?.toFixed(3) ?? "—"} · p = {r.preTestPval < 0.001 ? "<0.001" : r.preTestPval?.toFixed(4) ?? "—"}
                      {r.preTestPval < 0.05
                        ? <span style={{ color: C.red }}> ⚠ Pre-trend detected</span>
                        : <span style={{ color: C.teal }}> ✓ No pre-trend</span>}
                    </div>
                  </div>
                )}
                <FitBar items={[
                  { label: "R²",      value: r.R2?.toFixed(4)    ?? "—", color: C.teal },
                  { label: "Adj. R²", value: r.adjR2?.toFixed(4) ?? "—", color: C.teal },
                  { label: "n",       value: r.n,                         color: C.text },
                  { label: "units",   value: r.units ?? "—",              color: C.textDim },
                ]} />
                <Lbl color={C.textMuted}>Event-Time Coefficient Plot</Lbl>
                <EventCoeffsPlot eventCoeffs={r.eventCoeffs} yLabel={yVar[0]} />
                <Lbl color={C.textMuted}>Coefficient Table</Lbl>
                <CoeffTable dict={dict} rows={rows} varNames={r.varNames} beta={r.beta} se={r.se} tStats={r.testStats} pVals={r.pVals} yVar={yVar[0]} df={r.df} />
                <ExportBar yVar={yVar[0]} results={r} model="EventStudy"
                  onReport={() => openReport({ ...r, modelLabel: "Event Study", yVar: yVar[0], xVars: [...xVars, ...wVars] })}
                  replicateConfig={baseReplicateConfig ? { ...baseReplicateConfig, model: {
                    ...baseReplicateConfig.model, type: "EventStudy",
                    yVar: yVar[0], xVars, wVars, entityCol: panel?.entityCol, timeCol: panel?.timeCol,
                  }} : null}
                />
              </div>
            );
          })()}

          {/* Sun & Abraham (2021) event study over Poisson PPML */}
          {result?.type === "SunAbraham" && (() => {
            const r = result;
            const ref = Array.isArray(r.refPeriod) ? r.refPeriod.join(", ") : r.refPeriod;
            return (
              <div style={{ animation: "fadeUp 0.22s ease" }}>
                <div style={{ marginBottom: "1rem", display: "flex", alignItems: "baseline", gap: 10, flexWrap: "wrap" }}>
                  <span style={{ fontSize: 10, color: C.teal, letterSpacing: "0.24em", textTransform: "uppercase" }}>Sun & Abraham Event Study</span>
                  <Badge label={`n = ${r.n}`} color={C.textDim} />
                  {r.nCohorts != null && <Badge label={`${r.nCohorts} treated cohorts`} color={C.textDim} />}
                  {r.droppedAlwaysTreated?.length > 0 && <Badge label={`${r.droppedAlwaysTreated.length} always-treated dropped`} color={C.gold} />}
                  {r.converged ? <Badge label={`✓ converged (${r.iterations} iter)`} color={C.green} />
                               : <Badge label="⚠ did not converge" color={C.red} />}
                </div>
                {(r.preTestStat != null || r.postTestStat != null) && (
                  <div style={{ display: "flex", gap: 10, marginBottom: "1rem", flexWrap: "wrap" }}>
                    {r.preTestStat != null && (
                      <div style={{ flex: "1 1 220px", padding: "0.7rem 1rem", background: C.surface2, border: `1px solid ${C.teal}30`, borderLeft: `3px solid ${r.preTestPval < 0.05 ? C.red : C.teal}`, borderRadius: 4 }}>
                        <div style={{ fontSize: 10, color: C.textDim, fontFamily: mono }}>
                          Pre-trend Wald: χ²({r.preTestDf}) = {r.preTestStat?.toFixed(3) ?? "—"} · p = {r.preTestPval < 0.001 ? "<0.001" : r.preTestPval?.toFixed(4) ?? "—"}
                          {r.preTestPval < 0.05
                            ? <span style={{ color: C.red }}> ⚠ Pre-trend detected</span>
                            : <span style={{ color: C.teal }}> ✓ No pre-trend</span>}
                        </div>
                      </div>
                    )}
                    {r.postTestStat != null && (
                      <div style={{ flex: "1 1 220px", padding: "0.7rem 1rem", background: C.surface2, border: `1px solid ${C.teal}30`, borderLeft: `3px solid ${C.teal}`, borderRadius: 4 }}>
                        <div style={{ fontSize: 10, color: C.textDim, fontFamily: mono }}>
                          Post-treatment Wald: χ²({r.postTestDf}) = {r.postTestStat?.toFixed(3) ?? "—"} · p = {r.postTestPval < 0.001 ? "<0.001" : r.postTestPval?.toFixed(4) ?? "—"}
                        </div>
                      </div>
                    )}
                  </div>
                )}
                <FitBar items={[
                  { label: "McF. R²", value: r.mcFaddenR2?.toFixed(4) ?? "—", color: C.teal },
                  { label: "Log-lik", value: r.logLik?.toFixed(3)     ?? "—", color: C.textDim },
                  { label: "AIC",     value: r.AIC?.toFixed(1)         ?? "—", color: C.textDim },
                  { label: "ref. period", value: ref,                       color: C.textDim },
                  { label: "n",       value: r.n,                              color: C.text },
                ]} />
                <Lbl color={C.textMuted}>Event-Time ATT Plot (log points; PPML)</Lbl>
                <EventCoeffsPlot eventCoeffs={r.eventCoeffs} yLabel={yVar[0]} />
                <Lbl color={C.textMuted}>Saturated Coefficient Table (interactions + controls)</Lbl>
                <CoeffTable dict={dict} rows={rows} varNames={r.varNames} beta={r.beta} se={r.se} tStats={r.testStats} pVals={r.pVals} yVar={yVar[0]} df={r.df} statLabel={r.testStatLabel} />
                <ExportBar yVar={yVar[0]} results={r} model="SunAbraham"
                  onReport={() => openReport({ ...r, modelLabel: "Sun & Abraham Event Study", yVar: yVar[0], xVars: [...xVars, ...wVars] })}
                  replicateConfig={baseReplicateConfig ? { ...baseReplicateConfig, model: {
                    ...baseReplicateConfig.model, type: "SunAbraham",
                    yVar: yVar[0], xVars: r.spec?.xVars ?? xVars, wVars,
                    cohortCol: r.spec?.cohortCol, periodCol: r.spec?.periodCol,
                    feCols: r.spec?.feCols, entityCol: r.spec?.entityCol, timeCol: r.spec?.timeCol,
                  }} : null}
                />
              </div>
            );
          })()}

          {/* Callaway & Sant'Anna (2021) staggered DiD */}
          {result?.type === "CallawayCS" && (() => {
            const r = result;
            return (
              <div style={{ animation: "fadeUp 0.22s ease" }}>
                <div style={{ marginBottom: "1rem", display: "flex", alignItems: "baseline", gap: 10, flexWrap: "wrap" }}>
                  <span style={{ fontSize: 10, color: C.teal, letterSpacing: "0.24em", textTransform: "uppercase" }}>Callaway-Sant'Anna DiD</span>
                  <Badge label={`n = ${r.n}`} color={C.textDim} />
                  {r.csNGroups != null && <Badge label={`${r.csNGroups} cohorts`} color={C.textDim} />}
                  {r.units != null && <Badge label={`${r.units} units`} color={C.textDim} />}
                  <Badge label={r.csCompGroup === "nevertreated" ? "Never-treated control" : "Not-yet-treated control"} color={C.blue} />
                </div>
                {r.att != null && (
                  <div style={{ padding: "0.7rem 1rem", marginBottom: "1rem", background: C.surface2, border: `1px solid ${C.teal}30`, borderLeft: `3px solid ${C.teal}`, borderRadius: 4, fontSize: 11, fontFamily: mono }}>
                    <span style={{ color: C.textMuted }}>Overall ATT: </span>
                    <span style={{ color: r.att >= 0 ? C.teal : C.red }}>{r.att >= 0 ? "+" : ""}{r.att.toFixed(4)}</span>
                    <span style={{ color: C.textMuted }}> (SE = {r.attSE?.toFixed(4) ?? "—"})</span>
                    <span style={{ color: C.textMuted }}> · p = {r.attP < 0.001 ? "<0.001" : r.attP?.toFixed(4) ?? "—"}</span>
                    <span style={{ marginLeft: 6, color: C.gold }}>{r.attP < 0.01 ? "***" : r.attP < 0.05 ? "**" : r.attP < 0.1 ? "*" : ""}</span>
                  </div>
                )}
                <FitBar items={[
                  { label: "Overall ATT", value: r.att?.toFixed(4) ?? "—", color: C.teal },
                  { label: "SE",          value: r.attSE?.toFixed(4) ?? "—", color: C.textDim },
                  { label: "p-value",     value: r.attP != null ? (r.attP < 0.001 ? "<0.001" : r.attP.toFixed(4)) : "—", color: r.attP < 0.05 ? C.gold : C.textDim },
                  { label: "n",           value: r.n, color: C.text },
                  { label: "cohorts",     value: r.csNGroups ?? "—", color: C.textDim },
                ]} />
                <Lbl color={C.textMuted}>Event-Study ATT Plot (by relative period)</Lbl>
                <EventCoeffsPlot eventCoeffs={r.eventCoeffs} yLabel={yVar[0]} />
                <Lbl color={C.textMuted}>Event-Study Coefficient Table</Lbl>
                <CoeffTable dict={dict} rows={rows} varNames={r.varNames} beta={r.beta} se={r.se} tStats={r.testStats} pVals={r.pVals} yVar={yVar[0]} df={r.df} statLabel="z" />
                <ExportBar yVar={yVar[0]} results={r} model="CallawayCS"
                  onReport={() => openReport({ ...r, modelLabel: "Callaway-Sant'Anna DiD", yVar: yVar[0], xVars: [] })}
                  replicateConfig={null}
                />
              </div>
            );
          })()}

          {/* Panel LSDV */}
          {result?.type === "LSDV" && (() => {
            const r = result;
            return (
              <div style={{ animation: "fadeUp 0.22s ease" }}>
                <div style={{ marginBottom: "1rem", display: "flex", alignItems: "baseline", gap: 10 }}>
                  <span style={{ fontSize: 10, color: C.blue, letterSpacing: "0.24em", textTransform: "uppercase" }}>Panel LSDV Results</span>
                  <Badge label={`n = ${r.n}`} color={C.textDim} />
                  {r.units != null && <Badge label={`${r.units} units`} color={C.textDim} />}
                  {r.timeFE && <Badge label="Time FE included" color={C.blue} />}
                </div>
                <FitBar items={[
                  { label: "R²",      value: r.R2?.toFixed(4)    ?? "—", color: C.blue },
                  { label: "Adj. R²", value: r.adjR2?.toFixed(4) ?? "—", color: C.blue },
                  { label: "F-stat",  value: r.Fstat?.toFixed(3) ?? "—", color: C.gold },
                  { label: "n",       value: r.n,                         color: C.text },
                ]} />
                <RegressionEquation varNames={r.varNames} beta={r.beta} yVar={yVar[0]} />
                <Lbl color={C.textMuted}>Structural Coefficient Table (excl. dummies)</Lbl>
                <CoeffTable dict={dict} rows={rows} varNames={r.varNames} beta={r.beta} se={r.se} tStats={r.testStats} pVals={r.pVals} yVar={yVar[0]} df={r.df} />
                <PlotSelector accentColor={C.blue} defaultId="forest" plots={[
                  { id: "forest", label: "Coefficient plot",
                    node: <ForestPlot varNames={r.varNames} beta={r.beta} se={r.se} pVals={r.pVals} svgId="forest-lsdv" filename="lsdv_coefficients.svg" /> },
                  { id: "resid", label: "Residuals", node: <ResidualVsFitted resid={r.resid} Yhat={r.Yhat} /> },
                ]} />
                <ExportBar yVar={yVar[0]} results={r} model="LSDV"
                  onReport={() => openReport({ ...r, modelLabel: "Panel LSDV", yVar: yVar[0], xVars: [...xVars, ...wVars] })}
                  replicateConfig={baseReplicateConfig ? { ...baseReplicateConfig, model: { ...baseReplicateConfig.model, type: "LSDV", yVar: yVar[0], xVars, wVars } } : null}
                />
              </div>
            );
          })()}

          {/* Poisson GLM */}
          {result?.type === "Poisson" && (() => {
            const r = result;
            return (
              <div style={{ animation: "fadeUp 0.22s ease" }}>
                <div style={{ marginBottom: "1rem", display: "flex", alignItems: "baseline", gap: 10 }}>
                  <span style={{ fontSize: 10, color: "#9e7ec8", letterSpacing: "0.24em", textTransform: "uppercase" }}>Poisson GLM Results</span>
                  {r.hasOffset && <Badge label="rate model (offset)" color={C.teal} />}
                  <Badge label={`n = ${r.n}`} color={C.textDim} />
                  {r.converged ? <Badge label={`✓ converged (${r.iterations} iter)`} color={C.green} />
                               : <Badge label="⚠ did not converge" color={C.red} />}
                </div>
                <FitBar items={[
                  { label: "McF. R²", value: r.mcFaddenR2?.toFixed(4) ?? "—", color: "#9e7ec8" },
                  { label: "Log-lik", value: r.logLik?.toFixed(3)     ?? "—", color: C.textDim },
                  { label: "AIC",     value: r.AIC?.toFixed(1)         ?? "—", color: C.textDim },
                  { label: "BIC",     value: r.BIC?.toFixed(1)         ?? "—", color: C.textDim },
                  { label: "n",       value: r.n,                              color: C.text },
                ]} />
                <Lbl color={C.textMuted}>Coefficient Table (log-linear; IRR = exp(β))</Lbl>
                <CoeffTable dict={dict} rows={rows} varNames={r.varNames} beta={r.beta} se={r.se} tStats={r.testStats} pVals={r.pVals} yVar={yVar[0]} df={r.df} />
                {r.IRR?.length > 0 && (
                  <div style={{ marginTop: "1rem" }}>
                    <Lbl color={C.textMuted}>Incidence Rate Ratios (IRR = exp(β))</Lbl>
                    <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
                      {r.varNames.map((v, i) => (
                        <div key={v} style={{ fontSize: 10, fontFamily: mono, color: C.textDim, background: C.surface2, padding: "4px 8px", borderRadius: 3, border: `1px solid ${C.border}` }}>
                          {v}: <span style={{ color: C.text }}>{r.IRR[i]?.toFixed(4) ?? "—"}</span>
                        </div>
                      ))}
                    </div>
                  </div>
                )}
                <PlotSelector accentColor={"#9e7ec8"} defaultId="forest" plots={[
                  { id: "forest", label: "Coefficient plot",
                    node: <ForestPlot varNames={r.varNames} beta={r.beta} se={r.se} pVals={r.pVals} svgId="forest-poisson" filename="poisson_coefficients.svg" /> },
                ]} />
              </div>
            );
          })()}

          {/* Poisson FE */}
          {result?.type === "PoissonFE" && (() => {
            const r = result;
            return (
              <div style={{ animation: "fadeUp 0.22s ease" }}>
                <div style={{ marginBottom: "1rem", display: "flex", alignItems: "baseline", gap: 10 }}>
                  <span style={{ fontSize: 10, color: "#9e7ec8", letterSpacing: "0.24em", textTransform: "uppercase" }}>Poisson FE Results</span>
                  <Badge label={`n = ${r.n}`} color={C.textDim} />
                  {r.nFE > 1 && <Badge label={`${r.nFE}-way FE`} color="#9e7ec8" />}
                  {r.converged ? <Badge label={`✓ converged (${r.iterations} iter)`} color={C.green} />
                               : <Badge label="⚠ did not converge" color={C.red} />}
                  {r.droppedZeroUnits > 0 && <Badge label={`${r.droppedZeroUnits} zero-Y units dropped`} color={C.yellow} />}
                  {r.droppedZeroLevels > 0 && <Badge label={`${r.droppedZeroLevels} all-zero FE levels dropped`} color={C.yellow} />}
                  {r.droppedSingletons > 0 && <Badge label={`${r.droppedSingletons} singleton levels dropped`} color={C.yellow} />}
                </div>
                <FitBar items={[
                  { label: "McF. R²", value: r.mcFaddenR2?.toFixed(4) ?? "—", color: "#9e7ec8" },
                  { label: "Log-lik", value: r.logLik?.toFixed(3)     ?? "—", color: C.textDim },
                  { label: "AIC",     value: r.AIC?.toFixed(1)         ?? "—", color: C.textDim },
                  { label: "BIC",     value: r.BIC?.toFixed(1)         ?? "—", color: C.textDim },
                  { label: "n",       value: r.n,                              color: C.text },
                ]} />
                <div style={{ fontSize: 9, color: C.textMuted, fontFamily: mono, marginBottom: "0.8rem" }}>
                  {r.nFE > 1
                    ? `AIC/BIC penalty includes all FE dims (k = ${r.k} regressors + ${(r.feDims ?? []).reduce((s, d) => s + d.nLevels, 0)} FE levels − ${r.nFE - 1} normalization${r.nFE - 1 > 1 ? "s" : ""} — comparable to R fixest::fepois AIC)`
                    : `AIC/BIC penalty includes entity FEs (k = ${r.k} regressors + ${r.nUnits ?? Object.keys(r.alphas ?? {}).length} entity FEs — comparable to R LSDV AIC)`}
                </div>
                <Lbl color={C.textMuted}>Coefficient Table (log-linear, with IRR)</Lbl>
                <CoeffTable dict={dict} rows={rows} varNames={r.varNames} beta={r.beta} se={r.se} tStats={r.testStats} pVals={r.pVals} yVar={yVar[0]} df={r.df} />
                {r.nFE > 1 && r.feDims && (
                  <div style={{ marginTop: "1rem" }}>
                    <Lbl color={C.textMuted}>Absorbed Fixed-Effect Dimensions</Lbl>
                    <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
                      {r.feDims.map(d => (
                        <div key={d.col} style={{ fontSize: 10, fontFamily: mono, color: C.textDim, background: C.surface2, padding: "4px 8px", borderRadius: 3, border: `1px solid ${C.border}` }}>
                          {d.col}: <span style={{ color: C.text }}>{d.nLevels} levels</span>
                        </div>
                      ))}
                    </div>
                  </div>
                )}
                {r.alphas && Object.keys(r.alphas).length > 0 && (
                  <details style={{ marginTop: "1rem" }}>
                    <summary style={{ fontSize: 10, color: C.textMuted, letterSpacing: "0.15em", textTransform: "uppercase", cursor: "pointer", userSelect: "none" }}>
                      Entity fixed effects — {Object.keys(r.alphas).length} units (log-scale α̂ᵢ)
                    </summary>
                    <div style={{ marginTop: 8, display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(170px, 1fr))", gap: 4 }}>
                      {Object.entries(r.alphas).sort(([a], [b]) => String(a).localeCompare(String(b), undefined, { numeric: true })).map(([unit, alpha]) => (
                        <div key={unit} style={{ fontSize: 10, fontFamily: mono, color: C.textDim, background: C.surface2, padding: "3px 8px", borderRadius: 3, border: `1px solid ${C.border}` }}>
                          {unit}:&nbsp;<span style={{ color: C.text }}>{Number(alpha).toFixed(4)}</span>
                        </div>
                      ))}
                    </div>
                  </details>
                )}
                {r.IRR?.length > 0 && (
                  <div style={{ marginTop: "1rem" }}>
                    <Lbl color={C.textMuted}>Incidence Rate Ratios (IRR = exp(β))</Lbl>
                    <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
                      {r.varNames.map((v, i) => (
                        <div key={v} style={{ fontSize: 10, fontFamily: mono, color: C.textDim, background: C.surface2, padding: "4px 8px", borderRadius: 3, border: `1px solid ${C.border}` }}>
                          {v}: <span style={{ color: C.text }}>{r.IRR[i]?.toFixed(4) ?? "—"}</span>
                        </div>
                      ))}
                    </div>
                  </div>
                )}
                <PlotSelector accentColor={"#9e7ec8"} defaultId="forest" plots={[
                  { id: "forest", label: "Coefficient plot",
                    node: <ForestPlot varNames={r.varNames} beta={r.beta} se={r.se} pVals={r.pVals} svgId="forest-poissonfe" filename="poissonfe_coefficients.svg" /> },
                ]} />
              </div>
            );
          })()}

          {/* Synthetic Control */}
          {result?.type === "SyntheticControl" && (() => {
            const r = result;
            return (
              <div style={{ animation: "fadeUp 0.22s ease" }}>
                <div style={{ marginBottom: "1rem", display: "flex", alignItems: "baseline", gap: 10 }}>
                  <span style={{ fontSize: 10, color: C.gold, letterSpacing: "0.24em", textTransform: "uppercase" }}>Synthetic Control Results</span>
                  <Badge label={`treated: ${r.scTreatedUnit}`} color={C.gold} />
                  <Badge label={`T* = ${r.scTreatTime}`} color={C.textDim} />
                </div>
                <div style={{ padding: "1rem 1.2rem", marginBottom: "1.2rem", background: C.surface2, border: `1px solid ${C.gold}30`, borderLeft: `3px solid ${C.gold}`, borderRadius: 4 }}>
                  <div style={{ fontSize: 9, color: C.gold, letterSpacing: "0.2em", textTransform: "uppercase", marginBottom: 6 }}>Fit Quality & Inference</div>
                  <div style={{ fontSize: 11, color: C.textDim, fontFamily: mono }}>
                    Pre-RMSPE: {r.scRmspePre?.toFixed(6) ?? "—"} · Post-RMSPE: {r.scRmspePost?.toFixed(6) ?? "—"}
                    {r.scPValue != null && <span> · Placebo p-value: {r.scPValue?.toFixed(3)}</span>}
                  </div>
                  {r.scAtt != null && (
                    <div style={{ fontSize: 11, color: C.gold, fontFamily: mono, marginTop: 4 }}>
                      ATT (avg. post-treatment effect): <span style={{ fontWeight: 600 }}>{r.scAtt.toFixed(4)}</span>
                    </div>
                  )}
                </div>
                <Lbl color={C.textMuted}>Donor Weights</Lbl>
                <div style={{ display: "flex", flexWrap: "wrap", gap: 8, marginBottom: "1.2rem" }}>
                  {Object.entries(r.scWeights ?? {})
                    .sort(([, a], [, b]) => b - a)
                    .filter(([, w]) => w > 0.001)
                    .map(([unit, w]) => (
                      <div key={unit} style={{ fontSize: 10, fontFamily: mono, color: C.textDim, background: C.surface2, padding: "4px 10px", borderRadius: 3, border: `1px solid ${C.border}` }}>
                        {unit}: <span style={{ color: C.gold }}>{(w * 100).toFixed(1)}%</span>
                      </div>
                    ))}
                </div>
                <PlotSelector accentColor={C.gold} defaultId="trends" plots={[
                  { id: "trends",   label: "Trends",
                    node: <SyntheticGapPlot preFit={r.scPreFit} postGap={r.scPostGap} treatTime={r.scTreatTime} yLabel={yVar[0]} treatedUnit={r.scTreatedUnit} /> },
                  { id: "gap",      label: "Gap",
                    node: <SyntheticDiffPlot preFit={r.scPreFit} postGap={r.scPostGap} treatTime={r.scTreatTime} yLabel={yVar[0]} /> },
                  { id: "placebos", label: "Placebos",
                    node: <SyntheticPlaceboPlot preFit={r.scPreFit} postGap={r.scPostGap} placebos={r.scPlacebos} treatTime={r.scTreatTime} rmspePre={r.scRmspePre} /> },
                  { id: "mspe",     label: "MSPE Ratio",
                    node: <SyntheticMSPEPlot preFit={r.scPreFit} postGap={r.scPostGap} placebos={r.scPlacebos} treatTime={r.scTreatTime} treatedUnit={r.scTreatedUnit} /> },
                ]} />
                <ExportBar yVar={yVar[0]} results={r} model="SyntheticControl"
                  onReport={() => openReport({ ...r, modelLabel: "Synthetic Control", yVar: yVar[0], xVars })}
                  replicateConfig={baseReplicateConfig ? { ...baseReplicateConfig, model: {
                    ...baseReplicateConfig.model, type: "SyntheticControl",
                    yVar: yVar[0], xVars,
                    entityCol: panel?.entityCol, timeCol: panel?.timeCol,
                    treatedUnit: r.scTreatedUnit, treatTime: r.scTreatTime,
                  }} : null}
                />
              </div>
            );
          })()}

          {/* DiD / TWFE */}
          {(result?.type === "DiD" || result?.type === "TWFE") && (() => {
            const r = result;
            const isATT = r.att != null;
            return (
              <div style={{ animation: "fadeUp 0.22s ease" }}>
                <div style={{ marginBottom: "1rem", display: "flex", alignItems: "baseline", gap: 10 }}>
                  <span style={{ fontSize: 10, color: C.teal, letterSpacing: "0.24em", textTransform: "uppercase" }}>
                    {result.type === "DiD" ? "DiD 2×2 Results" : "TWFE DiD Results"}
                  </span>
                  <Badge label={`n = ${r.n}`} color={C.textDim} />
                </div>
                {isATT && (
                  <div style={{ padding: "1rem 1.2rem", marginBottom: "1.2rem", background: C.surface, border: `1px solid ${C.teal}30`, borderLeft: `3px solid ${C.teal}`, borderRadius: 4 }}>
                    <div style={{ fontSize: 9, color: C.teal, letterSpacing: "0.2em", textTransform: "uppercase", marginBottom: 6 }}>
                      Average Treatment Effect on the Treated (ATT)
                    </div>
                    <div style={{ fontSize: 24, color: r.attP < 0.05 ? C.teal : C.textDim, fontFamily: mono }}>
                      {r.att >= 0 ? "+" : ""}{r.att.toFixed(4)}{stars(r.attP)}
                    </div>
                    <div style={{ fontSize: 11, color: C.textDim, marginTop: 4 }}>
                      SE = {r.attSE.toFixed(4)} · t = {r.attT.toFixed(3)} · p = {r.attP < 0.001 ? "<0.001" : r.attP.toFixed(4)}
                    </div>
                  </div>
                )}
                <RegressionEquation varNames={r.varNames} beta={r.beta} yVar={yVar[0]} />
                <FitBar items={[
                  { label: "R²",     value: r.R2?.toFixed(4)    ?? "—", color: C.teal },
                  { label: "Adj. R²",value: r.adjR2?.toFixed(4) ?? "—", color: C.teal },
                  { label: "n",  value: r.n,        color: C.text },
                  { label: "df", value: r.df ?? "—", color: C.textDim },
                ]} />
                <Lbl color={C.textMuted}>Full Coefficient Table</Lbl>
                <div style={{ marginBottom: "1.2rem" }}>
                  <CoeffTable dict={dict} rows={rows} varNames={r.varNames} beta={r.beta} se={r.se} tStats={r.testStats} pVals={r.pVals} yVar={yVar[0]} df={r.df} binaryVars={result.type === "DiD" ? ["Post", "Treated"] : []} />
                </div>
                <PlotSelector
                  accentColor={C.teal}
                  defaultId="main"
                  plots={[
                    result.type === "DiD"
                      ? { id: "main", label: "Parallel trends", node: <DiDPlot result={r} yLabel={yVar[0]} /> }
                      : { id: "main", label: "Event study",     node: <EventStudyPlot result={r} yLabel={yVar[0]} /> },
                    { id: "forest", label: "Coefficient plot",
                      node: <ForestPlot varNames={r.varNames} beta={r.beta} se={r.se} pVals={r.pVals} svgId={`forest-${result.type.toLowerCase()}`} filename={`${result.type.toLowerCase()}_coefficients.svg`} /> },
                  ]}
                />
                <ExportBar yVar={yVar[0]} results={r} model={result.type}
                  onReport={() => openReport({ ...r, modelLabel: result.type === "DiD" ? "DiD 2×2" : "TWFE DiD", yVar: yVar[0], xVars: [...wVars] })}
                  replicateConfig={{ ...baseReplicateConfig, model: { ...baseReplicateConfig.model, type: result.type, yVar: yVar[0], wVars,
                    postVar: postVar[0], treatVar: treatVar[0] } }}
                />
              </div>
            );
          })()}

          {/* Logit / Probit */}
          {(result?.type === "Logit" || result?.type === "Probit") && (() => {
            const r      = result;
            const family = r.type.toLowerCase();
            const color  = C.violet;
            const meMap  = Object.fromEntries((r.marginalEffects ?? []).map(m => [m.variable, m.dy_dx]));
            const safeF  = (v, d = 4) => (v != null && isFinite(v)) ? v.toFixed(d) : "—";
            const convergenceWarn = !r.converged;
            // Y array for the valid rows (matches engine filtering logic)
            const allX = [...xVars, ...wVars];
            const validY = rows
              .filter(row => {
                const yv = row[yVar[0]];
                return (yv === 0 || yv === 1) && allX.every(c => typeof row[c] === "number" && isFinite(row[c]));
              })
              .map(row => row[yVar[0]]);

            return (
              <div style={{ animation: "fadeUp 0.22s ease" }}>
                {/* ── Header ── */}
                <div style={{ marginBottom: "1rem", display: "flex", alignItems: "baseline", gap: 10, flexWrap: "wrap" }}>
                  <span style={{ fontSize: 10, color, letterSpacing: "0.24em", textTransform: "uppercase" }}>
                    {family === "logit" ? "Logistic Regression" : "Probit"} Results
                  </span>
                  <Badge label={`n = ${r.n}`}  color={C.textDim} />
                  <Badge label={`k = ${r.k}`}  color={C.textDim} />
                  {convergenceWarn && <Badge label={`⚠ did not converge (${r.iterations} iter)`} color={C.red} />}
                  {r.converged    && <Badge label={`✓ converged (${r.iterations} iter)`} color={C.green} />}
                </div>

                {convergenceWarn && (
                  <InfoBox color={C.red}>
                    ⚠ IRLS did not converge in {r.iterations} iterations. Results may be unreliable. Check for perfect separation or near-multicollinearity.
                  </InfoBox>
                )}

                {/* ── Fit statistics bar ── */}
                <FitBar items={[
                  { label: "McFadden R²", value: safeF(r.mcFaddenR2),          color,       hint: "1 − ℓ(β̂)/ℓ₀ — analogous to R² but not directly comparable" },
                  { label: "Log-lik",     value: safeF(r.logLik, 3),            color: C.gold },
                  { label: "AIC",         value: safeF(r.AIC, 2),               color: C.textDim },
                  { label: "BIC",         value: safeF(r.BIC, 2),               color: C.textDim },
                  { label: "n",           value: r.n,                            color: C.text },
                  { label: "df",          value: r.df,                           color: C.textDim },
                ]} />

                {/* ── Coefficient table ── */}
                <Lbl color={C.textMuted}>Coefficient Table (z-statistics · asymptotic SE)</Lbl>
                <div style={{ marginBottom: "1.2rem" }}>
                  <CoeffTable
                    dict={dict} rows={rows}
                    varNames={r.varNames} beta={r.beta} se={r.se}
                    tStats={r.testStats} pVals={r.pVals}
                    yVar={yVar[0]} df={null}
                    statLabel="z"
                    meMap={meMap}
                  />
                </div>

                {/* ── Marginal Effects at the Mean ── */}
                {r.marginalEffects?.length > 0 && (
                  <>
                    <Lbl color={C.textMuted}>Marginal Effects at the Mean (MEM) · dP(Y=1)/dx</Lbl>
                    <div style={{ border: `1px solid ${C.border}`, borderRadius: 4, overflow: "hidden", marginBottom: "1.2rem" }}>
                      <div style={{ display: "grid", gridTemplateColumns: "2fr 1fr", background: C.surface, padding: "0.45rem 0.75rem", fontSize: 9, color: C.textMuted, letterSpacing: "0.13em", textTransform: "uppercase", borderBottom: `1px solid ${C.border}`, fontFamily: mono }}>
                        <div>Variable</div>
                        <div style={{ textAlign: "right" }}>dP/dx at x̄</div>
                      </div>
                      {r.marginalEffects.map(({ variable, dy_dx }, i) => (
                        <div key={variable} style={{ display: "grid", gridTemplateColumns: "2fr 1fr", padding: "0.55rem 0.75rem", borderTop: i > 0 ? `1px solid ${C.border}` : "none", background: i % 2 === 0 ? C.surface : C.surface2, fontFamily: mono }}>
                          <div style={{ fontSize: 12, color: C.text }}>{variable}</div>
                          <div style={{ textAlign: "right", fontSize: 13, color: dy_dx >= 0 ? C.green : C.red, fontFamily: mono }}>
                            {dy_dx >= 0 ? "+" : ""}{dy_dx.toFixed(4)}
                          </div>
                        </div>
                      ))}
                      <div style={{ padding: "0.35rem 0.75rem", background: C.surface, borderTop: `1px solid ${C.border}`, fontSize: 9, color: C.textMuted, fontFamily: mono }}>
                        Evaluated at sample means of all covariates
                      </div>
                    </div>
                  </>
                )}

                {/* ── Odds Ratios (Logit only) ── */}
                {family === "logit" && r.oddsRatios?.length > 0 && (
                  <>
                    <Lbl color={C.textMuted}>Odds Ratios · exp(β) with 95% CI</Lbl>
                    <div style={{ border: `1px solid ${C.border}`, borderRadius: 4, overflow: "hidden", marginBottom: "1.2rem" }}>
                      <div style={{ display: "grid", gridTemplateColumns: "2fr 1fr 1fr 1fr", background: C.surface, padding: "0.45rem 0.75rem", fontSize: 9, color: C.textMuted, letterSpacing: "0.13em", textTransform: "uppercase", borderBottom: `1px solid ${C.border}`, fontFamily: mono }}>
                        <div>Variable</div>
                        <div style={{ textAlign: "right" }}>OR</div>
                        <div style={{ textAlign: "right" }}>2.5%</div>
                        <div style={{ textAlign: "right" }}>97.5%</div>
                      </div>
                      {r.oddsRatios.map(({ variable, or, ciLo, ciHi }, i) => {
                        const isRef = variable === "(Intercept)";
                        return (
                          <div key={variable} style={{ display: "grid", gridTemplateColumns: "2fr 1fr 1fr 1fr", padding: "0.55rem 0.75rem", borderTop: i > 0 ? `1px solid ${C.border}` : "none", background: i % 2 === 0 ? C.surface : C.surface2, fontFamily: mono }}>
                            <div style={{ fontSize: 12, color: isRef ? C.textMuted : C.text }}>{variable}</div>
                            <div style={{ textAlign: "right", fontSize: 13, color: or >= 1 ? C.green : C.red }}>{or.toFixed(4)}</div>
                            <div style={{ textAlign: "right", fontSize: 11, color: C.textDim }}>{ciLo.toFixed(4)}</div>
                            <div style={{ textAlign: "right", fontSize: 11, color: C.textDim }}>{ciHi.toFixed(4)}</div>
                          </div>
                        );
                      })}
                      <div style={{ padding: "0.35rem 0.75rem", background: C.surface, borderTop: `1px solid ${C.border}`, fontSize: 9, color: C.textMuted, fontFamily: mono }}>
                        OR &gt; 1 = positive association · OR &lt; 1 = negative association · CI based on ±1.96 × SE
                      </div>
                    </div>
                  </>
                )}

                {/* ── Plots ── */}
                <Lbl color={C.textMuted}>Model Diagnostics</Lbl>
                <PlotSelector
                  accentColor={color}
                  defaultId="roc"
                  plots={[
                    { id: "roc",  label: "ROC Curve",
                      node: <ROCCurve fitted={r.Yhat} Y={validY} /> },
                    { id: "hist", label: "Predicted Probabilities",
                      node: <PredProbHistogram fitted={r.Yhat} Y={validY} /> },
                    { id: "forest", label: "Coefficient plot",
                      node: <ForestPlot varNames={r.varNames} beta={r.beta} se={r.se} pVals={r.pVals} svgId={`forest-${family}`} filename={`${family}_coefficients.svg`} /> },
                  ]}
                />

                {/* ── Significance note ── */}
                <div style={{ fontSize: 10, color: C.textMuted, fontFamily: mono, marginBottom: "1.4rem" }}>
                  *** p &lt; 0.01 · ** p &lt; 0.05 · * p &lt; 0.1 · z-statistics · SE from Fisher information matrix
                </div>

                {/* ── Export ── */}
                <ExportBar
                  yVar={yVar[0]}
                  results={r}
                  model={family === "logit" ? "Logit" : "Probit"}
                  latexBuilder={(yv, res) => buildBinaryLatex(yv, res)}
                  csvBuilder={(yv, res)   => buildBinaryCSV(yv, res)}
                  onReport={() => openReport({ ...r, modelLabel: family === "logit" ? "Logistic Regression" : "Probit", yVar: yVar[0], xVars: [...xVars, ...wVars] })}
                  replicateConfig={baseReplicateConfig ? { ...baseReplicateConfig, model: { ...baseReplicateConfig.model, type: result.type, yVar: yVar[0], xVars, wVars } } : null}
                />
              </div>
            );
          })()}

          {/* RDD / SpatialRDD */}
          {(result?.type === "RDD" || result?.type === "SpatialRDD") && (() => {
            const r   = result;
            const rdd = r.rddData ?? {};
            const isSpatial = r.type === "SpatialRDD";
            return (
              <div style={{ animation: "fadeUp 0.22s ease" }}>
                <div style={{ marginBottom: "1rem", display: "flex", alignItems: "baseline", gap: 10 }}>
                  <span style={{ fontSize: 10, color: C.orange, letterSpacing: "0.24em", textTransform: "uppercase" }}>
                    {isSpatial ? "Spatial RD Results" : "Sharp RDD Results"}
                  </span>
                  <Badge label={`bw = ${rdd.h?.toFixed(3) ?? "—"}`} color={C.textDim} />
                  <Badge label={`n = ${r.n}`} color={C.textDim} />
                  {isSpatial && r.nTreated != null && r.nControl != null && (
                    <Badge label={`treated/control = ${r.nTreated}/${r.nControl}`} color={C.textDim} />
                  )}
                </div>
                <div style={{ padding: "1rem 1.2rem", marginBottom: "1.2rem", background: C.surface2, border: `1px solid ${C.orange}30`, borderLeft: `3px solid ${C.orange}`, borderRadius: 4 }}>
                  <div style={{ fontSize: 9, color: C.orange, letterSpacing: "0.2em", textTransform: "uppercase", marginBottom: 6 }}>
                    {isSpatial
                      ? "Local Average Treatment Effect (LATE) at the boundary"
                      : `Local Average Treatment Effect (LATE) at cutoff = ${rdd.cutoff}`}
                  </div>
                  <div style={{ fontSize: 24, color: r.lateP != null && r.lateP < 0.05 ? C.orange : C.textDim }}>
                    {r.late != null && isFinite(r.late) ? (r.late >= 0 ? "+" : "") + r.late.toFixed(4) : "N/A"}{r.lateP != null ? stars(r.lateP) : ""}
                  </div>
                  <div style={{ fontSize: 11, color: C.textDim, marginTop: 4 }}>
                    SE = {r.lateSE != null && isFinite(r.lateSE) ? r.lateSE.toFixed(4) : "N/A"} · p = {r.lateP != null && isFinite(r.lateP) ? (r.lateP < 0.001 ? "<0.001" : r.lateP.toFixed(4)) : "N/A"} · Kernel: {rdd.kernelType}
                  </div>
                </div>
                <RegressionEquation varNames={r.varNames} beta={r.beta} yVar={yVar[0]} />
                <FitBar items={[
                  { label: "R²",        value: r.R2?.toFixed(4) ?? "—", color: C.orange },
                  { label: "n in bw",   value: r.n,                     color: C.text },
                  { label: "cutoff",    value: rdd.cutoff,               color: C.textDim },
                  { label: "bandwidth", value: rdd.h?.toFixed(3) ?? "—", color: C.textDim },
                ]} />
                <Lbl color={C.textMuted}>RDD Coefficient Table</Lbl>
                <div style={{ marginBottom: "1.2rem" }}>
                  <CoeffTable dict={dict} rows={rows} varNames={r.varNames} beta={r.beta} se={r.se} tStats={r.testStats} pVals={r.pVals} yVar={yVar[0]} df={r.df} />
                </div>
                <PlotSelector
                  accentColor={C.orange}
                  defaultId="scatter"
                  plots={[
                    { id: "scatter", label: isSpatial ? "Binned scatter (signed distance)" : "Binned scatter",
                      node: <RDDPlot
                        result={{ ...rdd, late: r.late, lateP: r.lateP }}
                        yLabel={yVar[0]}
                        xLabel={isSpatial ? `signed dist to boundary (${runningVar[0]})` : runningVar[0]}
                      /> },
                    // Bandwidth-sensitivity + McCrary on the original column are
                    // ill-defined for SpatialRDD (running var is internal/signed),
                    // so hide them in that case.
                    ...(isSpatial ? [] : [
                      { id: "bw",      label: "Bandwidth sensitivity",
                        node: <RDDBandwidthPlot
                          rows={rows} yCol={yVar[0]} runCol={runningVar[0]}
                          cutoff={parseFloat(cutoff)} optH={rdd.h}
                          kernel={kernel} controls={wVars} runSharpRDD={runSharpRDD}
                        /> },
                      { id: "mccrary", label: "McCrary density",
                        node: <McCraryPlot
                          result={r.mcCrary ?? runMcCrary(rows, runningVar[0], parseFloat(cutoff))}
                          xLabel={runningVar[0]}
                        /> },
                    ]),
                    ...wVars.map(xc => ({
                      id: `bal_${xc}`,
                      label: `Balance: ${xc}`,
                      node: <RDDCovariateBalance result={rdd} controls={[xc]} rows={rows} />,
                    })),
                  ]}
                />
                <ExportBar
                  yVar={yVar[0]}
                  results={r}
                  model={isSpatial ? "SpatialRDD" : "RDD"}
                  onReport={() => openReport({ ...r, modelLabel: isSpatial ? "Spatial RD" : "Sharp RDD", yVar: yVar[0], xVars: [...wVars] })}
                  replicateConfig={{ ...baseReplicateConfig, model: { ...baseReplicateConfig.model, type: isSpatial ? "SpatialRDD" : "RDD", yVar: yVar[0], wVars,
                    runningVar: runningVar[0], cutoff: isSpatial ? 0 : parseFloat(cutoff), bandwidth: rdd.h, kernel, polyOrder,
                    ...(isSpatial ? { distCol: runningVar[0], treatmentCol: treatVar[0], treatVar: treatVar[0] } : {}) } }}
                />
              </div>
            );
          })()}

          {/* ── Two-pass: extract model outputs back to the dataset ── */}
          {/* nRows = full dataset count (rows is a 500-row preview for DuckDB). */}
          <ExtractPanel
            result={result}
            nRows={cleanedData?._duckdb?.rowCount ?? rows.length}
            yVar={yVar[0]}
            xVars={[...xVars, ...wVars]}
            onExtract={onExtract}
          />

        </div>

        {/* ── G12: Plot Builder panel ── */}
        {result && (
          <div style={{ borderTop: `1px solid ${C.border}`, background: C.surface }}>
            {/* Toggle header */}
            <button
              onClick={() => setPlotOpen(v => !v)}
              style={{
                width: "100%", display: "flex", alignItems: "center", gap: 8,
                padding: "0.55rem 1rem", background: "none", border: "none",
                cursor: "pointer", fontFamily: mono, fontSize: 10, color: C.textMuted,
                textAlign: "left",
              }}
            >
              <span style={{ color: C.teal, fontSize: 11 }}>◈</span>
              <span>Plot Builder</span>
              <span style={{ marginLeft: "auto", fontSize: 9 }}>{plotOpen ? "▲" : "▼"}</span>
            </button>

            {plotOpen && (
              <div style={{ padding: "0 0.75rem 0.75rem" }}>

                {/* G13 — data mode toggle (only when 2+ models pinned) */}
                {pinnedModels.length >= 2 && (
                  <div style={{ display: "flex", gap: 4, marginBottom: 8 }}>
                    {["result", "comparison"].map(mode => (
                      <button
                        key={mode}
                        onClick={() => { setPlotDataMode(mode); setPlotTemplateKey(k => k + 1); setPlotInitLayers([]); }}
                        style={{
                          padding: "3px 10px", fontFamily: mono, fontSize: 9, cursor: "pointer", borderRadius: 3,
                          background: plotDataMode === mode ? `${C.teal}18` : "none",
                          border: `1px solid ${plotDataMode === mode ? C.teal + "60" : C.border}`,
                          color: plotDataMode === mode ? C.teal : C.textMuted,
                        }}
                      >
                        {mode === "result" ? "Result data" : `Comparison (${pinnedModels.length} models)`}
                      </button>
                    ))}
                  </div>
                )}

                {/* G10 — Estimator templates */}
                <div style={{ display: "flex", gap: 5, flexWrap: "wrap", marginBottom: 8 }}>
                  <span style={{ fontFamily: mono, fontSize: 9, color: C.textMuted, alignSelf: "center", marginRight: 2 }}>
                    Templates:
                  </span>
                  {[
                    {
                      label: "Resid vs Fitted",
                      layers: [
                        { id: "g10_a", geom: "point",  aes: { x: "__yhat__", y: "__resid__", color: "", yMin: "", yMax: "" }, value: "", position: "identity", fill: C.teal,    visible: true },
                        { id: "g10_b", geom: "hline",  aes: { x: "", y: "", color: "", yMin: "", yMax: "" },                  value: "0", position: "identity", fill: C.textDim, visible: true },
                      ],
                      xLabel: "Fitted values", yLabel: "Residuals", title: "Residuals vs Fitted",
                    },
                    {
                      label: "Resid distribution",
                      layers: [
                        { id: "g10_c", geom: "histogram", aes: { x: "__resid__", y: "", color: "", yMin: "", yMax: "" }, value: "", position: "identity", fill: C.teal, visible: true },
                      ],
                      xLabel: "Residuals", yLabel: "Count", title: "Residual distribution",
                    },
                    {
                      label: "Actual vs Fitted",
                      layers: [
                        { id: "g10_d", geom: "point", aes: { x: "__yhat__", y: yVar[0] || "", color: "", yMin: "", yMax: "" }, value: "", position: "identity", fill: C.gold, visible: true },
                        { id: "g10_e", geom: "smooth", aes: { x: "__yhat__", y: yVar[0] || "", color: "", yMin: "", yMax: "" }, value: "", position: "identity", fill: C.gold, visible: true },
                      ],
                      xLabel: "Fitted values", yLabel: yVar[0] || "Y", title: "Actual vs Fitted",
                    },
                    ...(xVars[0] ? [{
                      label: `Y vs ${xVars[0]}`,
                      mode: "result",
                      layers: [
                        { id: "g10_f", geom: "point",  aes: { x: xVars[0], y: yVar[0] || "", color: "", yMin: "", yMax: "" }, value: "", position: "identity", fill: C.blue, visible: true },
                        { id: "g10_g", geom: "smooth", aes: { x: xVars[0], y: yVar[0] || "", color: "", yMin: "", yMax: "" }, value: "", position: "identity", fill: C.blue, visible: true },
                      ],
                      xLabel: xVars[0], yLabel: yVar[0] || "Y", title: `${yVar[0] || "Y"} vs ${xVars[0]}`,
                    }] : []),
                    // G13 — multi-model coefficient comparison template
                    ...(pinnedModels.length >= 2 ? [{
                      label: "Coef comparison",
                      mode: "comparison",
                      layers: [
                        { id: "g13_a", geom: "point",    aes: { x: "variable", y: "estimate", color: "model", yMin: "", yMax: "" }, value: "", position: "identity", fill: C.teal, visible: true },
                        { id: "g13_b", geom: "errorbar", aes: { x: "variable", y: "", color: "model", yMin: "ciLow", yMax: "ciHigh" }, value: "", position: "identity", fill: C.teal, visible: true },
                        { id: "g13_c", geom: "hline",    aes: { x: "", y: "", color: "", yMin: "", yMax: "" }, value: "0", position: "identity", fill: C.textDim, visible: true },
                      ],
                      xLabel: "Variable", yLabel: "Estimate", title: "Coefficient comparison",
                    }] : []),
                  ].map(tmpl => (
                    <button
                      key={tmpl.label}
                      onClick={() => {
                        if (tmpl.mode) setPlotDataMode(tmpl.mode);
                        setPlotInitLayers(tmpl.layers);
                        setPlotTemplateKey(k => k + 1);
                      }}
                      style={{
                        padding: "3px 8px", fontFamily: mono, fontSize: 9,
                        background: "none", border: `1px solid ${C.border2}`,
                        borderRadius: 3, color: C.textDim, cursor: "pointer",
                      }}
                    >{tmpl.label}</button>
                  ))}
                </div>

                {/* PlotBuilder — key resets when template applied (G12+G13) */}
                <PlotBuilder
                  key={plotTemplateKey}
                  pid={pid && `${pid}_model`}
                  headers={activePlotHeaders}
                  rows={activePlotRows}
                  initialLayers={plotInitLayers}
                  style={{ minHeight: 340 }}
                />
              </div>
            )}
          </div>
        )}

        {/* ── Predict from Model ── */}
        {pinnedModels.length > 0 && (() => {
          const predModel = pinnedModels.find(m => m.id === predModelId) ?? pinnedModels[pinnedModels.length - 1];
          const predVarNames = predModel?.varNames ?? [];
          // Ensure predInputs has entries for every var
          const inputs = {};
          predVarNames.forEach(v => { inputs[v] = predInputs[v] ?? "0"; });

          function runPredict() {
            if (!predModel?.beta) return;
            const xVec = predModel.varNames.map(v => {
              const val = parseFloat(inputs[v] ?? "0");
              return isFinite(val) ? val : 0;
            });
            const res = predict(predModel.beta, xVec, predModel.XtXinv, predModel.s2, predModel.df);
            setPredResult(res);
          }

          return (
            <div style={{ border: `1px solid ${C.border}`, borderRadius: 4, overflow: "hidden", marginBottom: "1.4rem" }}>
              <div onClick={() => { setPredOpen(o => !o); setPredResult(null); }}
                style={{ background: C.surface2, padding: "0.55rem 0.85rem", borderBottom: predOpen ? `1px solid ${C.border}` : "none", cursor: "pointer", display: "flex", alignItems: "center", gap: 8 }}>
                <span style={{ fontSize: 9, color: C.textMuted }}>{predOpen ? "▾" : "▸"}</span>
                <span style={{ fontSize: 9, color: C.textDim, letterSpacing: "0.2em", textTransform: "uppercase", fontFamily: mono }}>Predict from Model</span>
                <span style={{ marginLeft: "auto", fontSize: 9, color: C.textMuted }}>{pinnedModels.length} pinned</span>
              </div>
              {predOpen && (
                <div style={{ padding: "0.85rem", background: C.surface, display: "flex", flexDirection: "column", gap: 10 }}>
                  {/* Model selector */}
                  <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
                    <span style={{ fontSize: 9, color: C.textMuted, fontFamily: mono, letterSpacing: "0.14em", textTransform: "uppercase" }}>Model</span>
                    <select value={predModelId || predModel?.id || ""}
                      onChange={e => { setPredModelId(e.target.value); setPredResult(null); }}
                      style={{ background: C.surface2, border: `1px solid ${C.border2}`, borderRadius: 3, color: C.text, fontFamily: mono, fontSize: 11, padding: "0.28rem 0.55rem", outline: "none" }}>
                      {pinnedModels.map(m => (
                        <option key={m.id} value={m.id}>{m.label ?? m.estimator ?? m.id}</option>
                      ))}
                    </select>
                  </div>
                  {/* Variable inputs */}
                  {predVarNames.length > 0 && (
                    <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
                      {predVarNames.map(v => (
                        <div key={v} style={{ display: "flex", flexDirection: "column", gap: 3, minWidth: 90 }}>
                          <span style={{ fontSize: 9, color: C.gold, fontFamily: mono }}>{v}</span>
                          <input type="number" step="any" value={inputs[v]}
                            onChange={e => setPredInputs(prev => ({ ...prev, [v]: e.target.value }))}
                            style={{ background: C.surface2, border: `1px solid ${C.border2}`, borderRadius: 3, color: C.text, fontFamily: mono, fontSize: 11, padding: "0.28rem 0.55rem", outline: "none", width: 90 }} />
                        </div>
                      ))}
                    </div>
                  )}
                  <div>
                    <button onClick={runPredict}
                      style={{ padding: "0.45rem 0.9rem", borderRadius: 3, cursor: "pointer", fontFamily: mono, fontSize: 11, background: C.teal, color: C.bg, border: `1px solid ${C.teal}`, fontWeight: 700 }}>
                      Predict ŷ
                    </button>
                  </div>
                  {predResult && (
                    <div style={{ background: `${C.teal}0a`, border: `1px solid ${C.teal}30`, borderRadius: 3, padding: "0.65rem 0.9rem", fontFamily: mono, fontSize: 11, color: C.text, lineHeight: 1.9 }}>
                      <div><span style={{ color: C.textMuted }}>ŷ = </span><span style={{ color: C.teal, fontSize: 13 }}>{predResult.yhat.toFixed(6)}</span></div>
                      {predResult.se > 0 && <>
                        <div><span style={{ color: C.textMuted }}>SE </span>{predResult.se.toFixed(6)}</div>
                        <div><span style={{ color: C.textMuted }}>95% CI </span>
                          <span style={{ color: C.gold }}>[{predResult.ciLow.toFixed(4)}, {predResult.ciHigh.toFixed(4)}]</span>
                        </div>
                      </>}
                    </div>
                  )}
                </div>
              )}
            </div>
          );
        })()}

        {/* ── Coefficient Test (post-estimation hypothesis test) ── */}
        {pinnedModels.length > 0 && (
          <CoefficientTestPanel models={pinnedModels} />
        )}

        {/* ── Model Buffer Bar ── */}
        <ModelBufferBar
          models={pinnedModels}
          activeId={activeBufferId}
          onRestore={(id) => {
            const r = modelBuffer.get(id);
            if (r) { setResult(r); setActiveBufferId(id); }
          }}
          onRemove={(id) => {
            modelBuffer.remove(id);
            if (activeBufferId === id) setActiveBufferId(null);
            setBufferVersion(v => v + 1);
          }}
          onCompare={() => setCompareOpen(true)}
        />
        </div>{/* closes RIGHT outer column wrapper */}
      </div>{/* closes body flex */}

      {/* ── Model Comparison Modal ── */}
      {compareOpen && pinnedModels.length >= 2 && (
        <ModelComparison
          models={pinnedModels}
          dataDictionary={cleanedData?.dataDictionary ?? null}
          pipeline={fullPipeline}
          filename={cleanedData?.filename ?? "dataset.csv"}
          onClose={() => setCompareOpen(false)}
        />
      )}
    </div>
  );
}
