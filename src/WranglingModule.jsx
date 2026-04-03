// ─── ECON STUDIO · WranglingModule.jsx ───────────────────────────────────────
// Root orchestrator. Owns pipeline state, runs the pipeline, routes tabs.
// All UI is delegated to components/wrangling/*.jsx
// ~110 lines — add features in the tab files, not here.

import { useState, useCallback, useMemo, useEffect } from "react";
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

// ── Shared atoms ───────────────────────────────────────────────────────────
import { C, mono, Tabs } from "./components/wrangling/shared.jsx";

// ── Persistence ────────────────────────────────────────────────────────────
import { lsGet, lsSave } from "./components/wrangling/utils.js";

// ── Re-exports (consumed by ModelingTab and other modules) ─────────────────
export { validatePanel, buildInfo }   from "./pipeline/validator.js";
export { applyStep, runPipeline }     from "./pipeline/runner.js";
export { fuzzyGroups }                from "./components/wrangling/utils.js";
export { Grid }                       from "./components/wrangling/shared.js";

// ─── ROOT ─────────────────────────────────────────────────────────────────────
export default function WranglingModule({ rawData, filename, onComplete, pid, allDatasets = [] }) {
  const [pipeline, setPipeline] = useState(() => {
    try { return lsGet().find(p => p.id === pid)?.pipeline || []; } catch { return []; }
  });
  const [panel, setPanel] = useState(() => {
    try { return lsGet().find(p => p.id === pid)?.panel || null; } catch { return null; }
  });
  const [dataDictionary, setDataDictionary] = useState(() => {
    try { return lsGet().find(p => p.id === pid)?.dataDictionary || null; } catch { return null; }
  });
  const [tab, setTab] = useState("clean");

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

  useEffect(() => {
    lsSave(pid, { filename, pipeline, panel, dataDictionary,
      rowCount: rawData.rows.length, colCount: rawData.headers.length,
      pipelineLength: pipeline.length });
  }, [pipeline, panel, dataDictionary]);

  const addStep = useCallback(s => setPipeline(p => [...p, { ...s, id: Date.now() + Math.random() }]), []);
  const rmStep     = useCallback(i => setPipeline(p => p.filter((_, j) => j !== i)), []);
  const rmLastStep = useCallback(() => setPipeline(p => p.slice(0, -1)), []);
  const clear   = useCallback(() => setPipeline([]), []);

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
    });
  };

  const qualityBadge = qualityReport?.flags?.filter(f => f.severity !== "ok").length;

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
            <ExportMenu rows={rows} headers={headers} pipeline={pipeline} filename={filename}/>
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
          <ReshapeTab rows={rows} headers={headers} info={info} onAdd={addStep} onRmLastStep={rmLastStep}/>
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

      <History pipeline={pipeline} onRm={rmStep} onClear={clear}/>
    </div>
  );
}
