// ─── ECON STUDIO · components/wrangling/ExportMenu.jsx ───────────────────────
// Header export dropdown: CSV, pipeline JSON, R/Stata/Python scripts.
//
// Props:
//   rows        — current pipeline output rows
//   headers     — current pipeline output headers
//   pipeline    — step[] (for JSON export and script generation)
//   filename    — original filename (used as base for download names)
//   datasetName — human-readable name for the active dataset
//   allDatasets — { id: { name, filename } } — for resolving join/append names
//   datasetId   — id of the dataset these steps were built on; stamped into the
//                 exported pipeline.json for cross-session portability checks

import { useState } from "react";
import { useTheme } from "./shared.jsx";
import { generateCleanScript } from "../../pipeline/exporter.js";

function ExportMenu({ rows, headers, pipeline, filename, datasetName, allDatasets = {}, datasetId = null, duckdbTableName = null, totalRows = null }) {
  const { C, T } = useTheme();
  const [open, setOpen]         = useState(false);
  const [exporting, setExporting] = useState(false);
  const [exportErr, setExportErr] = useState(null);
  // SECURITY (SECURITY_AUDIT_2026-08-02.md B-1): filename/datasetName can come from an
  // uploaded file or a user rename; browsers already sanitize a.download path
  // separators, but stripping to safe filename chars avoids odd/broken download names.
  const base        = filename ? filename.replace(/\.[^.]+$/, "").replace(/[^\w.-]/g, "_").slice(0, 100) : "dataset";
  const dsName      = datasetName || base;

  async function downloadCSV() {
    // `rows` is the 500-row PREVIEW for any DuckDB-backed dataset (>10MB), so
    // writing it straight to the file silently handed the user 500 of their
    // 550,000 rows — with a filename claiming to be the pipeline output. Pull
    // the real table first; refuse to write a truncated file if that fails,
    // because a short CSV that looks complete is the worst possible outcome.
    setExportErr(null);
    let outRows = rows;
    if (duckdbTableName) {
      setExporting(true);
      try {
        const { extractAllRows } = await import("../../services/data/duckdb.js");
        outRows = await extractAllRows(duckdbTableName);
      } catch (e) {
        setExporting(false);
        setExportErr(`Could not read the full table (${e?.message ?? e}) — nothing was downloaded, rather than a truncated file.`);
        return;
      }
      setExporting(false);
    }
    const esc = v => {
      if (v === null || v === undefined) return "";
      const s = String(v);
      return s.includes(",") || s.includes('"') || s.includes("\n")
        ? `"${s.replace(/"/g, '""')}"` : s;
    };
    const lines = [
      headers.map(esc).join(","),
      ...outRows.map(r => headers.map(h => esc(r[h])).join(",")),
    ];
    const blob = new Blob([lines.join("\r\n")], { type:"text/csv" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = `${base}_pipeline_output.csv`;
    a.click(); URL.revokeObjectURL(a.href);
    setOpen(false);
  }

  function downloadScript(language) {
    const ext    = { r: "R", stata: "do", python: "py" }[language];
    const script = generateCleanScript({
      language,
      datasetName: dsName,
      filename,
      pipeline,
      allDatasets,
    });
    const blob = new Blob([script], { type: "text/plain" });
    const a    = document.createElement("a");
    a.href     = URL.createObjectURL(blob);
    a.download = `${base}_clean.${ext}`;
    a.click(); URL.revokeObjectURL(a.href);
    setOpen(false);
  }

  function downloadPipeline() {
    const payload = {
      version: 1,
      filename,
      // Which dataset these steps were built on. Read by ImportPipelineButton to
      // decide whether row-identity steps (patch/inject_column, which match on
      // this dataset's __ri) can be replayed or must be dropped.
      datasetId,
      exportedAt: new Date().toISOString(),
      steps: pipeline,
    };
    const blob = new Blob([JSON.stringify(payload, null, 2)], { type:"application/json" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = `${base}_pipeline.json`;
    a.click(); URL.revokeObjectURL(a.href);
    setOpen(false);
  }

  const menuItems = [
    { icon:"↓",   label: exporting ? "Reading full table…" : "Download CSV",
      hint: totalRows != null
        ? `Current pipeline output — all ${totalRows.toLocaleString()} rows`
        : "Current pipeline output",
      action: downloadCSV },
    { icon:"{ }", label:"Download pipeline.json",  hint:`${pipeline.length} step${pipeline.length !== 1 ? "s" : ""}`,
      action: downloadPipeline },
    { icon:"R",   label:"Export R script",         hint:"dplyr pipeline · runnable",
      action: () => downloadScript("r") },
    { icon:"▶",   label:"Export Stata do-file",    hint:"Full pipeline · .do",
      action: () => downloadScript("stata") },
    { icon:"py",  label:"Export Python script",    hint:"pandas pipeline · runnable",
      action: () => downloadScript("python") },
  ];

  return (
    <div style={{ position:"relative" }}>
      {exportErr && (
        <div style={{ position:"absolute", top:"100%", right:0, marginTop:6, zIndex:60,
          width:320, padding:"0.5rem 0.7rem", background:C.surface,
          border:`1px solid ${C.gold}`, borderRadius:4, color:C.gold,
          fontFamily: T.code.fontFamily, fontSize: T.caption.fontSize, lineHeight:1.5 }}>
          ⚠ {exportErr}
          <button onClick={() => setExportErr(null)}
            style={{ marginLeft:8, background:"transparent", border:"none",
              color:C.textMuted, cursor:"pointer", fontFamily: T.code.fontFamily }}>×</button>
        </div>
      )}
      <button
        onClick={() => setOpen(o => !o)}
        style={{
          padding:"0.28rem 0.65rem", borderRadius:3, cursor:"pointer",
          fontFamily: T.code.fontFamily, fontSize: T.caption.fontSize,
          background: open ? `${C.teal}18` : "transparent",
          color:       open ? C.teal : C.textDim,
          border:`1px solid ${open ? C.teal : C.border2}`,
          transition:"all 0.12s",
        }}>
        ↓ Export {open ? "▾" : "▸"}
      </button>

      {open && (
        <>
          <div onClick={() => setOpen(false)}
            style={{ position:"fixed", inset:0, zIndex:99 }}/>
          <div style={{
            position:"absolute", right:0, top:"calc(100% + 4px)",
            background:C.surface2, border:`1px solid ${C.border2}`,
            borderRadius:4, boxShadow:"0 8px 24px #000a",
            zIndex:100, minWidth:220, overflow:"hidden",
          }}>
            {menuItems.map(({ icon, label, hint, action }) => (
              <button key={label} onClick={action} style={{
                width:"100%", display:"flex", flexDirection:"column",
                padding:"0.6rem 0.85rem",
                background:"transparent", border:"none",
                borderBottom:`1px solid ${C.border}`,
                color:C.textDim, cursor:"pointer", fontFamily: T.code.fontFamily,
                textAlign:"left", transition:"background 0.1s",
              }}
                onMouseEnter={e => e.currentTarget.style.background = `${C.teal}0a`}
                onMouseLeave={e => e.currentTarget.style.background = "transparent"}
              >
                <span style={{ fontSize: T.code.fontSize, color:C.text }}>
                  <span style={{ color:C.teal, marginRight:6 }}>{icon}</span>{label}
                </span>
                <span style={{ fontSize: T.caption.fontSize, color:C.textMuted, marginTop:2 }}>{hint}</span>
              </button>
            ))}
          </div>
        </>
      )}
    </div>
  );
}

export default ExportMenu;
