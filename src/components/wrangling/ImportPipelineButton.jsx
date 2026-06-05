// ─── ECON STUDIO · components/wrangling/ImportPipelineButton.jsx ───────────
// One-click pipeline replication: pick a previously-exported pipeline.json and
// apply it to whatever data is currently loaded. Sibling to ExportMenu.
//
// Validation rules:
//   - Top-level must be { steps: [...] }  OR  a bare array of step objects
//     (we accept both shapes — the exporter writes { version, steps }, but
//     hand-built or legacy bundles may be plain arrays).
//   - Every step must have a string `type` in STEP_TYPES.
//   - Unknown types are reported and the import is aborted so the user is
//     never silently left with steps that no-op against an outdated runner.
//
// Props:
//   currentLength    — pipeline.length, used to decide whether to confirm.
//   onImport(steps)  — replace the current pipeline atomically.

import { useRef, useState } from "react";
import { useTheme, mono } from "./shared.jsx";
import { STEP_TYPES } from "../../pipeline/registry.js";
import { isSafeExpr } from "../../pipeline/exprGuard.js";

// Collect every dynamically-evaluated expression carried by a step.
function exprFieldsOf(s) {
  const out = [];
  if (typeof s.expr === "string") out.push(s.expr);
  if (typeof s.cond === "string") out.push(s.cond);
  if (typeof s.js === "string") out.push(s.js);
  if (Array.isArray(s.cases)) s.cases.forEach(c => { if (typeof c?.cond === "string") out.push(c.cond); });
  if (Array.isArray(s.rules)) s.rules.forEach(r => { if (typeof r?.expr === "string") out.push(r.expr); });
  return out;
}

function ImportPipelineButton({ currentLength = 0, onImport }) {
  const { C } = useTheme();
  const fileRef = useRef(null);
  const [error, setError]     = useState("");
  const [pending, setPending] = useState(null); // { steps, source } awaiting confirm

  function pick() {
    setError("");
    fileRef.current?.click();
  }

  function onFile(e) {
    const f = e.target.files?.[0];
    e.target.value = ""; // allow re-picking same file
    if (!f) return;

    const reader = new FileReader();
    reader.onload = () => {
      let parsed;
      try { parsed = JSON.parse(reader.result); }
      catch { setError("Not valid JSON."); return; }

      const steps = Array.isArray(parsed) ? parsed
                  : Array.isArray(parsed?.steps) ? parsed.steps
                  : null;
      if (!steps) {
        setError("Expected { steps: [...] } or a JSON array of steps.");
        return;
      }
      if (!steps.length) { setError("Pipeline is empty — nothing to import."); return; }

      const known = new Set(STEP_TYPES);
      const unknown = [];
      for (const s of steps) {
        if (!s || typeof s.type !== "string") { setError("A step is missing its `type` field."); return; }
        if (!known.has(s.type)) unknown.push(s.type);
      }
      if (unknown.length) {
        setError(`Unknown step types: ${[...new Set(unknown)].join(", ")}. This pipeline was built with a newer or older version.`);
        return;
      }

      // SECURITY: reject any step carrying a disallowed dynamic expression
      // (references a forbidden identifier such as fetch/localStorage/constructor).
      // Imported pipelines are untrusted and run automatically.
      for (const s of steps) {
        if (exprFieldsOf(s).some(e => !isSafeExpr(e))) {
          setError(`Step "${s.type}" contains a disallowed expression (references a forbidden identifier). Import blocked for safety.`);
          return;
        }
      }

      // If current pipeline is empty, just apply. Otherwise gate behind confirm.
      if (currentLength === 0) {
        onImport(steps);
      } else {
        setPending({ steps, source: f.name });
      }
    };
    reader.readAsText(f);
  }

  function confirmReplace() {
    if (pending) onImport(pending.steps);
    setPending(null);
  }

  return (
    <div style={{ position:"relative" }}>
      <button
        onClick={pick}
        style={{
          padding:"0.28rem 0.65rem", borderRadius:3, cursor:"pointer",
          fontFamily:mono, fontSize:10,
          background: "transparent", color: C.textDim,
          border:`1px solid ${C.border2}`, transition:"all 0.12s",
        }}
        onMouseEnter={e => { e.currentTarget.style.borderColor = C.teal; e.currentTarget.style.color = C.teal; }}
        onMouseLeave={e => { e.currentTarget.style.borderColor = C.border2; e.currentTarget.style.color = C.textDim; }}
        title="Apply a previously-exported pipeline.json to the current dataset"
      >
        ↑ Import pipeline
      </button>
      <input ref={fileRef} type="file" accept=".json,application/json"
        onChange={onFile} style={{ display:"none" }}/>

      {/* Inline error toast */}
      {error && (
        <div style={{
          position:"absolute", right:0, top:"calc(100% + 4px)",
          padding:"0.5rem 0.75rem", background:C.surface2,
          border:`1px solid ${C.red}`, borderLeft:`3px solid ${C.red}`,
          borderRadius:3, color:C.red, fontFamily:mono, fontSize:10,
          maxWidth:280, lineHeight:1.5, zIndex:100,
        }}>
          ⚠ {error}
          <div style={{ marginTop:6 }}>
            <button onClick={()=>setError("")}
              style={{ padding:"0.18rem 0.55rem", background:"transparent",
                border:`1px solid ${C.border2}`, color:C.textDim,
                borderRadius:2, cursor:"pointer", fontSize:10, fontFamily:mono }}>
              Dismiss
            </button>
          </div>
        </div>
      )}

      {/* Replace-confirm modal (only when current pipeline is non-empty) */}
      {pending && (
        <>
          <div style={{ position:"fixed", inset:0, background:"#000a", zIndex:200 }}
            onClick={()=>setPending(null)}/>
          <div style={{
            position:"fixed", top:"50%", left:"50%", transform:"translate(-50%, -50%)",
            background:C.surface, border:`1px solid ${C.border2}`,
            borderRadius:6, padding:"1.2rem 1.4rem", minWidth:360, maxWidth:480,
            zIndex:201, boxShadow:"0 12px 40px #000c",
          }}>
            <div style={{ fontSize:10, color:C.gold, letterSpacing:"0.18em",
              textTransform:"uppercase", marginBottom:8, fontFamily:mono }}>
              Replace pipeline?
            </div>
            <div style={{ fontSize:12, color:C.text, fontFamily:mono, lineHeight:1.6, marginBottom:14 }}>
              The current pipeline has <span style={{color:C.gold}}>{currentLength}</span>{" "}
              step{currentLength!==1?"s":""}. Importing{" "}
              <span style={{color:C.teal}}>{pending.source}</span> ({pending.steps.length} step{pending.steps.length!==1?"s":""}) will replace it.
              <div style={{ fontSize:10, color:C.textMuted, marginTop:8 }}>
                You can undo with the History panel.
              </div>
            </div>
            <div style={{ display:"flex", gap:8, justifyContent:"flex-end" }}>
              <button onClick={()=>setPending(null)}
                style={{ padding:"0.4rem 0.85rem", background:"transparent",
                  border:`1px solid ${C.border2}`, color:C.textDim,
                  borderRadius:3, cursor:"pointer", fontSize:11, fontFamily:mono }}>
                Cancel
              </button>
              <button onClick={confirmReplace}
                style={{ padding:"0.4rem 0.85rem", background:`${C.teal}18`,
                  border:`1px solid ${C.teal}`, color:C.teal,
                  borderRadius:3, cursor:"pointer", fontSize:11, fontFamily:mono }}>
                Replace
              </button>
            </div>
          </div>
        </>
      )}
    </div>
  );
}

export default ImportPipelineButton;
