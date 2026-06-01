// ─── ECON STUDIO · spatial/analyze/BoundaryDistanceSection.jsx ─ (moved verbatim from SpatialTab.jsx)
import { useState, useMemo } from "react";
import { mono } from "../shared/constants.js";
import { ColSelect, TextInput, ApplyBtn, ResultPreview, ErrBanner } from "../shared/atoms.jsx";
import { guessLatCol, guessLonCol } from "../shared/guess.js";
import { assignBoundaryDistance } from "../../../../math/SpatialEngine.js";
import { useSessionLog } from "../../../../../services/session/sessionLog.jsx";

export function BoundaryDistanceSection({ rows, headers, availableDatasets, onResult, C }) {
  const { appendLog } = useSessionLog();
  const [latCol,    setLatCol]    = useState(() => guessLatCol(headers));
  const [lonCol,    setLonCol]    = useState(() => guessLonCol(headers));
  const [polyDsId,  setPolyDsId]  = useState("");
  const [wktCol,    setWktCol]    = useState("");
  const [outPrefix, setOutPrefix] = useState("boundary");
  const [result,    setResult]    = useState(null);
  const [err,       setErr]       = useState("");

  const polyDs      = availableDatasets.find(d => d.id === polyDsId);
  const polyHeaders = polyDs?.headers ?? [];
  const guessedWkt  = useMemo(() =>
    polyHeaders.find(h => {
      const s = polyDs?.rows?.find(r => r[h] != null)?.[h];
      return typeof s === "string" && /^(POINT|POLYGON|MULTIPOLYGON)/i.test(s.trim());
    }) ?? "",
  [polyDs, polyHeaders]);
  const effectiveWkt = wktCol || guessedWkt;

  const canApply = latCol && lonCol && polyDs?.rows?.length && effectiveWkt && outPrefix;

  function apply() {
    setErr("");
    try {
      const out = assignBoundaryDistance(rows, latCol, lonCol, polyDs.rows, effectiveWkt, outPrefix);
      const treated  = out.filter(r => r[`${outPrefix}_treat`] === 1).length;
      const newCols  = [`${outPrefix}_dist_km`, `${outPrefix}_treat`, `${outPrefix}_running`];
      setResult({ rows: out, treated, newCols });
      appendLog({ module: "spatial", opType: "boundary_distance", params: { latCol, lonCol, polyDsId, wktCol: effectiveWkt, outPrefix }, label: `Boundary distance → ${outPrefix}_dist_km, ${outPrefix}_running (${treated} treated)` });
      onResult(out, newCols);
    } catch (e) {
      setErr(e.message);
    }
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
      <div style={{ fontSize: 10, color: C.textMuted, lineHeight: 1.7 }}>
        Computes the minimum distance from each point to the nearest polygon boundary edge,
        plus a treatment indicator and signed running variable for Spatial RD.
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8 }}>
        <ColSelect label="Latitude column" value={latCol} onChange={setLatCol} headers={headers} C={C} />
        <ColSelect label="Longitude column" value={lonCol} onChange={setLonCol} headers={headers} C={C} />
      </div>

      {/* Polygon dataset picker */}
      <div style={{ display: "flex", flexDirection: "column", gap: 3 }}>
        <label style={{ fontSize: 9, color: C.textMuted, letterSpacing: "0.12em", textTransform: "uppercase", fontFamily: mono }}>
          Boundary polygon dataset
        </label>
        <select
          value={polyDsId}
          onChange={e => { setPolyDsId(e.target.value); setWktCol(""); }}
          style={{ padding: "4px 8px", background: C.surface, border: `1px solid ${C.border2}`, borderRadius: 3, color: polyDsId ? C.text : C.textMuted, fontFamily: mono, fontSize: 10, outline: "none" }}
        >
          <option value="">— select polygon dataset —</option>
          {availableDatasets.map(d => <option key={d.id} value={d.id}>{d.filename ?? d.name ?? d.id}</option>)}
        </select>
      </div>

      {polyDs && (
        <ColSelect label={`WKT geometry column${guessedWkt ? ` (auto: ${guessedWkt})` : ""}`}
          value={effectiveWkt} onChange={setWktCol} headers={polyHeaders} C={C} />
      )}

      <TextInput label="Output column prefix" value={outPrefix} onChange={setOutPrefix} C={C} placeholder="boundary" />

      {outPrefix && (
        <div style={{ fontSize: 9, color: C.textMuted, fontFamily: mono, lineHeight: 1.7 }}>
          Outputs: <span style={{ color: C.teal }}>{outPrefix}_dist_km</span> · <span style={{ color: C.teal }}>{outPrefix}_treat</span> · <span style={{ color: C.teal }}>{outPrefix}_running</span> (signed, use as RD running variable)
        </div>
      )}

      <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
        <ApplyBtn onClick={apply} disabled={!canApply} C={C} />
        {result && (
          <span style={{ fontSize: 9, color: C.teal }}>
            ✓ {result.rows.length} rows · {result.treated} treated
          </span>
        )}
      </div>
      <ErrBanner msg={err} C={C} />
      {result && <ResultPreview rows={result.rows} newCols={result.newCols} C={C} />}
    </div>
  );
}

// ─── SPATIAL REGRESSION DISCONTINUITY ─────────────────────────────────────────
// Keele & Titiunik 2015: local linear RD using distance-to-boundary as the
// running variable. Delegates to math/SpatialRDDEngine.runSpatialRDD which
// itself re-uses CausalEngine.runSharpRDD on a signed running variable.
// Result wrapped via EstimationResult.wrapResult("SpatialRDD") and pinned to
// the module-level modelBuffer so the Modeling tab can pick it up.
