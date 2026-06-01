// ─── ECON STUDIO · spatial/analyze/_parked/SpatialRDDSection.jsx ─ (moved verbatim from SpatialTab.jsx)
import { useState, useMemo } from "react";
import { mono } from "../../shared/constants.js";
import { ColSelect, NumInput, ApplyBtn, ErrBanner } from "../../shared/atoms.jsx";
import { runSpatialRDD } from "../../../../../math/SpatialRDDEngine.js";
import { wrapResult } from "../../../../../math/EstimationResult.js";
import * as modelBuffer from "../../../../../services/modelBuffer.js";

export function SpatialRDDSection({ rows, headers, C }) {
  const numericHeaders = useMemo(
    () => headers.filter(h => rows.slice(0, 50).some(r => typeof r[h] === "number")),
    [rows, headers]
  );
  const binaryHeaders = useMemo(
    () => numericHeaders.filter(h => {
      const vals = rows.slice(0, 200).map(r => r[h]).filter(v => typeof v === "number" && isFinite(v));
      return vals.length > 0 && vals.every(v => v === 0 || v === 1);
    }),
    [rows, numericHeaders]
  );

  const [yCol,        setYCol]        = useState("");
  const [distCol,     setDistCol]     = useState(() => headers.find(h => /running|dist|signed/i.test(h)) ?? "");
  const [treatCol,    setTreatCol]    = useState(() => binaryHeaders.find(h => /treat/i.test(h)) ?? binaryHeaders[0] ?? "");
  const [kernel,      setKernel]      = useState("triangular");
  const [bwMode,      setBwMode]      = useState("auto");  // "auto" | "manual"
  const [bwManual,    setBwManual]    = useState("");
  const [seType,      setSeType]      = useState("HC1");
  const [result,      setResult]      = useState(null);
  const [err,         setErr]         = useState("");
  const [bufferedId,  setBufferedId]  = useState(null);

  const canApply = !!(yCol && distCol && treatCol);

  function apply() {
    setErr("");
    setResult(null);
    setBufferedId(null);
    try {
      const bandwidth = bwMode === "manual" && bwManual !== ""
        ? Number(bwManual)
        : null;
      const eng = runSpatialRDD({
        rows,
        y:         yCol,
        dist:      distCol,
        treatment: treatCol,
        kernel,
        bandwidth,
        seType,
      });
      const spec = {
        yVar:       yCol,
        runningVar: distCol,
        treatVar:   treatCol,
        distCol,
        treatmentCol: treatCol,
        cutoff:     0,
        bandwidth:  eng.bandwidth,
        kernel,
      };
      const wrapped = wrapResult("SpatialRDD", eng, spec, { h: eng.bandwidth });
      const id = modelBuffer.add(wrapped);
      setBufferedId(id);
      setResult({
        late:   eng.late,
        lateSE: eng.lateSE,
        lateP:  eng.lateP,
        h:      eng.bandwidth,
        n:      eng.n,
        nTreated: eng.nTreated,
        nControl: eng.nControl,
      });
    } catch (e) {
      setErr(e.message);
    }
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
      <div style={{ fontSize: 10, color: C.textMuted, lineHeight: 1.7 }}>
        Local linear RD with distance-to-boundary as the running variable
        (Keele &amp; Titiunik 2015). Pair with the <em>Distance to Boundary</em>
        section above to generate the distance &amp; treatment columns first.
        Result is pinned to the model buffer and accessible from the Model tab.
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 8 }}>
        <ColSelect label="Outcome (Y)" value={yCol} onChange={setYCol} headers={numericHeaders} C={C} />
        <ColSelect label="Distance column" value={distCol} onChange={setDistCol} headers={numericHeaders} C={C} />
        <ColSelect label="Treatment side (0/1)" value={treatCol} onChange={setTreatCol} headers={binaryHeaders.length ? binaryHeaders : numericHeaders} C={C} />
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr 1fr", gap: 8 }}>
        <div style={{ display: "flex", flexDirection: "column", gap: 3 }}>
          <label style={{ fontSize: 9, color: C.textMuted, letterSpacing: "0.12em", textTransform: "uppercase", fontFamily: mono }}>
            Kernel
          </label>
          <select value={kernel} onChange={e => setKernel(e.target.value)}
            style={{ padding: "4px 8px", background: C.surface, border: `1px solid ${C.border2}`, borderRadius: 3, color: C.text, fontFamily: mono, fontSize: 10, outline: "none" }}>
            <option value="triangular">triangular</option>
            <option value="uniform">uniform</option>
            <option value="epanechnikov">epanechnikov</option>
          </select>
        </div>

        <div style={{ display: "flex", flexDirection: "column", gap: 3 }}>
          <label style={{ fontSize: 9, color: C.textMuted, letterSpacing: "0.12em", textTransform: "uppercase", fontFamily: mono }}>
            Bandwidth
          </label>
          <select value={bwMode} onChange={e => setBwMode(e.target.value)}
            style={{ padding: "4px 8px", background: C.surface, border: `1px solid ${C.border2}`, borderRadius: 3, color: C.text, fontFamily: mono, fontSize: 10, outline: "none" }}>
            <option value="auto">auto (IK)</option>
            <option value="manual">manual</option>
          </select>
        </div>

        {bwMode === "manual" ? (
          <NumInput label="Bandwidth h" value={bwManual} onChange={setBwManual} C={C} min={0} step="any" placeholder="e.g. 5" />
        ) : <div />}

        <div style={{ display: "flex", flexDirection: "column", gap: 3 }}>
          <label style={{ fontSize: 9, color: C.textMuted, letterSpacing: "0.12em", textTransform: "uppercase", fontFamily: mono }}>
            SE type
          </label>
          <select value={seType} onChange={e => setSeType(e.target.value)}
            style={{ padding: "4px 8px", background: C.surface, border: `1px solid ${C.border2}`, borderRadius: 3, color: C.text, fontFamily: mono, fontSize: 10, outline: "none" }}>
            <option value="classical">classical</option>
            <option value="HC0">HC0</option>
            <option value="HC1">HC1</option>
            <option value="HC2">HC2</option>
            <option value="HC3">HC3</option>
          </select>
        </div>
      </div>

      <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
        <ApplyBtn onClick={apply} disabled={!canApply} label="Estimate Spatial RD" C={C} />
        {result && (
          <span style={{ fontSize: 9, color: C.teal, fontFamily: mono }}>
            ✓ LATE = {result.late?.toFixed(4)} (SE {result.lateSE?.toFixed(4)},
            p = {result.lateP?.toFixed(4)}) · h = {result.h?.toFixed(4)} ·
            n = {result.n} ({result.nTreated} treated / {result.nControl} control)
          </span>
        )}
      </div>
      {bufferedId && (
        <div style={{ fontSize: 9, color: C.gold, fontFamily: mono }}>
          → pinned to model buffer (id {bufferedId.slice(0, 8)}…). Open the Model tab to inspect.
        </div>
      )}
      <ErrBanner msg={err} C={C} />
    </div>
  );
}

// ─── DATASET OUTPUT PANEL ─────────────────────────────────────────────────────
