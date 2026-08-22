// ─── ECON STUDIO · components/modeling/ModelIOButtons.jsx ────────────────────
// Export/Import for pinned model SPECS — the Model-side sibling of Clean's
// ExportMenu + ImportPipelineButton.
//
// Importing carries the RECIPE, never the result: it fills the sidebar and the
// user presses Estimate against their own data. Nothing is pinned, nothing is
// estimated automatically, and no foreign coefficients enter the model buffer.
//
// Props:
//   models        — pinned EstimationResult[] (for export)
//   filenameBase  — download name stem
//   onApply(spec) — called with the chosen spec; the parent runs applySpec

import { useRef, useState } from "react";
import { useTheme } from "./shared.jsx";
import { MODELS } from "./EstimatorSidebar.jsx";
import { SE_TYPE_IDS, FAMILIES, specFormula } from "./modelSpec.js";
import { buildModelFile, parseModelFile, downloadJSON } from "../../services/export/artifactIO.js";

const VOCAB = { modelIds: MODELS.map(m => m.id), seTypeIds: SE_TYPE_IDS, families: FAMILIES };

export default function ModelIOButtons({ models = [], filenameBase = "models", onApply }) {
  const { C, T } = useTheme();
  const fileRef = useRef(null);
  const [error, setError]   = useState("");
  const [picker, setPicker] = useState(null);   // { models, source }

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
      setPicker({ models: res.models, source: f.name });
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
        title="Load a previously-exported model.json into the estimator sidebar"
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

      {/* Pick-one modal: a spec has to occupy THE sidebar, which is singular. */}
      {picker && (
        <>
          <div style={{ position: "fixed", inset: 0, background: "#000a", zIndex: 200 }}
            onClick={() => setPicker(null)} />
          <div style={{
            position: "fixed", top: "50%", left: "50%", transform: "translate(-50%, -50%)",
            background: C.surface, border: `1px solid ${C.border2}`, borderRadius: 6,
            padding: "1.2rem 1.4rem", minWidth: 420, maxWidth: 620, maxHeight: "70vh",
            overflowY: "auto", zIndex: 201, boxShadow: "0 12px 40px #000c",
          }}>
            <div style={{ fontSize: T.caption.fontSize, color: C.gold, letterSpacing: "0.18em",
              textTransform: "uppercase", marginBottom: 4, fontFamily: T.code.fontFamily }}>
              Load a model spec
            </div>
            <div style={{ fontSize: T.caption.fontSize, color: C.textMuted,
              fontFamily: T.code.fontFamily, marginBottom: 12 }}>
              From {picker.source}. This fills the sidebar — press Estimate to run it on the
              current dataset. Nothing is pinned and no coefficients are imported.
            </div>
            {picker.models.map((m, i) => (
              <button key={i}
                onClick={() => { onApply?.(m.spec ?? {}); setPicker(null); }}
                style={{
                  width: "100%", textAlign: "left", display: "block",
                  padding: "0.6rem 0.75rem", marginBottom: 6,
                  background: "transparent", border: `1px solid ${C.border2}`, borderRadius: 3,
                  color: C.text, cursor: "pointer", fontFamily: T.code.fontFamily,
                }}
                onMouseEnter={e => { e.currentTarget.style.borderColor = C.teal; }}
                onMouseLeave={e => { e.currentTarget.style.borderColor = C.border2; }}>
                <div style={{ fontSize: T.code.fontSize }}>
                  <span style={{ color: C.gold }}>{m.type}</span>
                  {m.label ? <span style={{ color: C.textDim }}> · {m.label}</span> : null}
                </div>
                <div style={{ fontSize: T.caption.fontSize, color: C.textMuted, marginTop: 2 }}>
                  {specFormula(m.spec ?? {})}
                </div>
              </button>
            ))}
            <div style={{ display: "flex", justifyContent: "flex-end", marginTop: 8 }}>
              <button onClick={() => setPicker(null)}
                style={{ padding: "0.4rem 0.85rem", background: "transparent",
                  border: `1px solid ${C.border2}`, color: C.textDim, borderRadius: 3,
                  cursor: "pointer", fontSize: T.code.fontSize, fontFamily: T.code.fontFamily }}>
                Cancel
              </button>
            </div>
          </div>
        </>
      )}
    </div>
  );
}
