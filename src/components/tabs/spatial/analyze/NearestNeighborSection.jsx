// ─── ECON STUDIO · spatial/analyze/NearestNeighborSection.jsx ─ (moved verbatim from SpatialTab.jsx)
import { useState } from "react";
import { useTheme } from "../../../../ThemeContext.jsx";
import { ColSelect, TextInput, ApplyBtn, ResultPreview, ErrBanner } from "../shared/atoms.jsx";
import { guessLatCol, guessLonCol } from "../shared/guess.js";
import { nearestNeighbor, nearestNeighborMetric, addDistanceBins } from "../../../../math/SpatialEngine.js";
import { useSessionLog } from "../../../../services/session/sessionLog.jsx";

export function NearestNeighborSection({ rows, headers, availableDatasets, C, onResult }) {
  const { T } = useTheme();
  const { appendLog } = useSessionLog();
  const [latCol,    setLatCol]    = useState(() => guessLatCol(headers));
  const [lonCol,    setLonCol]    = useState(() => guessLonCol(headers));
  const [refDsId,   setRefDsId]   = useState("self");   // "self" or a dataset id
  const [refLatCol, setRefLatCol] = useState("");
  const [refLonCol, setRefLonCol] = useState("");
  const [outDist,   setOutDist]   = useState("nn_dist_km");
  const [outIdx,    setOutIdx]    = useState("nn_idx");
  const [metric,    setMetric]    = useState(false);
  const [binCol,    setBinCol]    = useState("");
  const [result,    setResult]    = useState(null);
  const [err,       setErr]       = useState("");
  const [running,   setRunning]   = useState(false);

  const refDs = refDsId === "self" ? { headers, rows } : availableDatasets.find(ds => ds.id === refDsId);
  const refHeaders = refDs?.headers ?? [];

  const effectiveRefLat = refLatCol || guessLatCol(refHeaders);
  const effectiveRefLon = refLonCol || guessLonCol(refHeaders);

  const canApply = latCol && lonCol && refDs?.rows?.length && effectiveRefLat && effectiveRefLon;

  function apply() {
    setErr("");
    setRunning(true);
    // Run async to avoid blocking UI on large datasets
    setTimeout(() => {
      try {
        let out = (metric ? nearestNeighborMetric : nearestNeighbor)(
          rows, latCol, lonCol,
          refDs.rows, effectiveRefLat, effectiveRefLon,
          outDist, outIdx,
          "EPSG:32721"
        );
        const cols = [outDist, outIdx];
        if (metric && binCol.trim()) {
          out = addDistanceBins(out, outDist, binCol.trim());
          cols.push(binCol.trim());
        }
        setResult({ rows: out, cols });
        appendLog({ module: "spatial", opType: "nearest_neighbor", params: { latCol, lonCol, refDsId, refLatCol: effectiveRefLat, refLonCol: effectiveRefLon, outDist, outIdx, metric }, label: `Nearest neighbor → ${outDist}${metric ? " (metric)" : ""}` });
        onResult(out, cols, null, { kind: "step", step: {
          type: "sp_nearest", latCol, lonCol,
          refDatasetId: refDsId, refLatCol: effectiveRefLat, refLonCol: effectiveRefLon,
          outDist, outIdx, metric, binCol: metric ? binCol.trim() : "",
        }});
      } catch (e) {
        setErr(e.message);
      }
      setRunning(false);
    }, 0);
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
      <div style={{ fontSize: T.caption.fontSize, color: C.textMuted, lineHeight: 1.7 }}>
        For each observation, finds the nearest point in a reference dataset and returns distance plus the reference row index.

        Brute-force O(n×m) — suitable up to ~10 k × 1 k rows.
      </div>
      <label style={{ display: "flex", alignItems: "center", gap: 6, fontFamily: T.code.fontFamily, fontSize: T.caption.fontSize, color: C.textMuted }}>
        <input type="checkbox" checked={metric} onChange={e => {
          setMetric(e.target.checked);
          setOutDist(e.target.checked ? "nn_dist_m" : "nn_dist_km");
        }} style={{ accentColor: C.teal }} />
        Use EPSG:32721 metric distance
      </label>
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8 }}>
        <ColSelect label="Latitude column" value={latCol} onChange={setLatCol} headers={headers} C={C} />
        <ColSelect label="Longitude column" value={lonCol} onChange={setLonCol} headers={headers} C={C} />
      </div>

      <div style={{ display: "flex", flexDirection: "column", gap: 3 }}>
        <label style={{ fontSize: T.caption.fontSize, color: C.textMuted, letterSpacing: "0.12em", textTransform: "uppercase" }}>
          Reference dataset
        </label>
        <select
          value={refDsId}
          onChange={e => { setRefDsId(e.target.value); setRefLatCol(""); setRefLonCol(""); }}
          style={{
            padding: "4px 8px", background: C.surface, border: `1px solid ${C.border2}`,
            borderRadius: 3, color: C.text, fontFamily: T.code.fontFamily, fontSize: T.caption.fontSize, outline: "none",
          }}
        >
          <option value="self">Same dataset (self-join)</option>
          {availableDatasets.map(ds => (
            <option key={ds.id} value={ds.id}>{ds.filename ?? ds.id}</option>
          ))}
        </select>
      </div>

      {refDs && refHeaders.length > 0 && (
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8 }}>
          <ColSelect label="Ref. latitude column" value={effectiveRefLat} onChange={setRefLatCol} headers={refHeaders} C={C} />
          <ColSelect label="Ref. longitude column" value={effectiveRefLon} onChange={setRefLonCol} headers={refHeaders} C={C} />
        </div>
      )}

      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8 }}>
        <TextInput label="Distance output col" value={outDist} onChange={setOutDist} C={C} placeholder="nn_dist_km" />
        <TextInput label="Index output col" value={outIdx} onChange={setOutIdx} C={C} placeholder="nn_idx" />
        {metric && <TextInput label="Distance bin column" value={binCol} onChange={setBinCol} C={C} placeholder="dist_bin (optional)" />}
      </div>

      <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
        <ApplyBtn onClick={apply} disabled={!canApply || running} label={running ? "Computing…" : "Find neighbours"} C={C} />
        {result && <span style={{ fontSize: T.caption.fontSize, color: C.teal }}>✓ {result.rows.length} rows processed</span>}
      </div>
      <ErrBanner msg={err} C={C} />
      {result && <ResultPreview rows={result.rows} newCols={[latCol, lonCol, ...result.cols]} C={C} />}
    </div>
  );
}

// 6. Geocode
