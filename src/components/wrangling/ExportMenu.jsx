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

import { useState } from "react";
import { C, mono } from "./shared.jsx";
import { generateCleanScript } from "../../pipeline/exporter.js";

function ExportMenu({ rows, headers, pipeline, filename, datasetName, allDatasets = {} }) {
  const [open, setOpen] = useState(false);
  const base        = filename ? filename.replace(/\.[^.]+$/, "") : "dataset";
  const dsName      = datasetName || base;

  function downloadCSV() {
    const esc = v => {
      if (v === null || v === undefined) return "";
      const s = String(v);
      return s.includes(",") || s.includes('"') || s.includes("\n")
        ? `"${s.replace(/"/g, '""')}"` : s;
    };
    const lines = [
      headers.map(esc).join(","),
      ...rows.map(r => headers.map(h => esc(r[h])).join(",")),
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
    { icon:"↓",   label:"Download CSV",           hint:"Current pipeline output",
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
      <button
        onClick={() => setOpen(o => !o)}
        style={{
          padding:"0.28rem 0.65rem", borderRadius:3, cursor:"pointer",
          fontFamily:mono, fontSize:10,
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
                color:C.textDim, cursor:"pointer", fontFamily:mono,
                textAlign:"left", transition:"background 0.1s",
              }}
                onMouseEnter={e => e.currentTarget.style.background = `${C.teal}0a`}
                onMouseLeave={e => e.currentTarget.style.background = "transparent"}
              >
                <span style={{ fontSize:11, color:C.text }}>
                  <span style={{ color:C.teal, marginRight:6 }}>{icon}</span>{label}
                </span>
                <span style={{ fontSize:9, color:C.textMuted, marginTop:2 }}>{hint}</span>
              </button>
            ))}
          </div>
        </>
      )}
    </div>
  );
}

export default ExportMenu;
