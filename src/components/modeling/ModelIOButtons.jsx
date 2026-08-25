// ─── ECON STUDIO · components/modeling/ModelIOButtons.jsx ────────────────────
// Export/Import for pinned model SPECS — the Model-side sibling of Clean's
// ExportMenu + ImportPipelineButton.
//
// Importing carries the RECIPE, never the result: every spec in the file is
// estimated against the CURRENT dataset and pinned, so no foreign coefficients
// ever enter the model buffer — what you see pinned was computed here.
//
// There is no pick-one modal: a file with N specs exists to be COMPARED, and
// the Model Buffer Bar's ◀ ▶ navigation is that comparison surface. The parent
// (ModelingTab.importModelsFromFile) reports any spec that fails by name
// rather than dropping it.
//
// Props:
//   models              — pinned EstimationResult[] (for export)
//   filenameBase        — download name stem
//   onImportAll(models) — called with parseModelFile's full `models` array

import { useRef, useState } from "react";
import { useTheme } from "./shared.jsx";
import { MODELS } from "./EstimatorSidebar.jsx";
import { SE_TYPE_IDS, FAMILIES } from "./modelSpec.js";
import { buildModelFile, parseModelFile, downloadJSON } from "../../services/export/artifactIO.js";

const VOCAB = { modelIds: MODELS.map(m => m.id), seTypeIds: SE_TYPE_IDS, families: FAMILIES };

export default function ModelIOButtons({ models = [], filenameBase = "models", onImportAll }) {
  const { C, T } = useTheme();
  const fileRef = useRef(null);
  const [error, setError] = useState("");

  const btn = (active) => ({
    padding: "0.28rem 0.65rem", borderRadius: 3, cursor: "pointer",
    fontFamily: T.code.fontFamily, fontSize: T.caption.fontSize,
    background: "transparent", color: active ? C.textDim : C.border,
    border: `1px solid ${active ? C.border2 : C.border}`, transition: "all 0.12s",
  });

  function doExport() {
    if (!models.length) return;
    downloadJSON(buildModelFile(models), `${filenameBase}_models.json`);
  }

  function onFile(e) {
    const f = e.target.files?.[0];
    e.target.value = "";
    if (!f) return;
    const reader = new FileReader();
    reader.onload = () => {
      const res = parseModelFile(reader.result, VOCAB);
      if (!res.ok) { setError(res.error); return; }
      setError("");
      // Every spec, not one picked spec — the parent estimates them all
      // against the current dataset and pins whatever succeeds.
      onImportAll?.(res.models);
    };
    reader.readAsText(f);
  }

  return (
    <div style={{ display: "flex", gap: 6, alignItems: "center", marginBottom: "0.5rem" }}>
      <button onClick={doExport} disabled={!models.length} style={btn(models.length > 0)}
        title={models.length ? "Download the specs of every pinned model" : "Pin a model first"}
        onMouseEnter={e => { if (models.length) { e.currentTarget.style.borderColor = C.teal; e.currentTarget.style.color = C.teal; } }}
        onMouseLeave={e => { if (models.length) { e.currentTarget.style.borderColor = C.border2; e.currentTarget.style.color = C.textDim; } }}>
        ↓ Export models
      </button>

      <button onClick={() => { setError(""); fileRef.current?.click(); }} style={btn(true)}
        title="Estimate every spec in a previously-exported model.json against this dataset and pin the results"
        onMouseEnter={e => { e.currentTarget.style.borderColor = C.teal; e.currentTarget.style.color = C.teal; }}
        onMouseLeave={e => { e.currentTarget.style.borderColor = C.border2; e.currentTarget.style.color = C.textDim; }}>
        ↑ Import models
      </button>
      <input ref={fileRef} type="file" accept=".json,application/json" onChange={onFile} style={{ display: "none" }} />

      {error && (
        <div style={{
          padding: "0.35rem 0.6rem", background: C.surface2,
          border: `1px solid ${C.red}`, borderLeft: `3px solid ${C.red}`, borderRadius: 3,
          color: C.red, fontFamily: T.code.fontFamily, fontSize: T.caption.fontSize,
          maxWidth: 420, lineHeight: 1.5,
        }}>
          ⚠ {error}
          <button onClick={() => setError("")}
            style={{ marginLeft: 8, padding: "0.1rem 0.45rem", background: "transparent",
              border: `1px solid ${C.border2}`, color: C.textDim, borderRadius: 2,
              cursor: "pointer", fontSize: T.caption.fontSize, fontFamily: T.code.fontFamily }}>
            Dismiss
          </button>
        </div>
      )}
    </div>
  );
}
