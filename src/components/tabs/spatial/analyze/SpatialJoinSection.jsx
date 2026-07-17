// ─── ECON STUDIO · spatial/analyze/SpatialJoinSection.jsx ─ (moved verbatim from SpatialTab.jsx)
import { useState, useMemo } from "react";
import { useTheme } from "../../../../ThemeContext.jsx";
import { ColSelect, ApplyBtn, ResultPreview, ErrBanner } from "../shared/atoms.jsx";
import { guessLatCol, guessLonCol, guessWktCol, isGeometryHeader } from "../shared/guess.js";
import { spatialJoin } from "../../../../math/SpatialEngine.js";
import { useSessionLog } from "../../../../services/session/sessionLog.jsx";

export function SpatialJoinSection({ rows, headers, availableDatasets, C, onResult }) {
  const { T } = useTheme();
  const { appendLog } = useSessionLog();
  const [latCol,    setLatCol]    = useState(() => guessLatCol(headers));
  const [lonCol,    setLonCol]    = useState(() => guessLonCol(headers));
  const [polyDsId,  setPolyDsId]  = useState("");
  const [wktCol,    setWktCol]    = useState("");
  const [joinCols,  setJoinCols]  = useState([]);
  const [predicate, setPredicate] = useState("within");
  const [includeGeomAttrs, setIncludeGeomAttrs] = useState(false);
  const [result,    setResult]    = useState(null);
  const [err,       setErr]       = useState("");

  const polyDs = availableDatasets.find(ds => ds.id === polyDsId);
  const polyHeaders = polyDs?.headers ?? [];
  const guessedWkt = useMemo(() => guessWktCol(polyHeaders), [polyHeaders]);

  // Auto-set wkt col when polygon dataset changes
  const effectiveWkt = wktCol || guessedWkt;
  const joinableHeaders = polyHeaders.filter(h =>
    h !== effectiveWkt && (includeGeomAttrs || !isGeometryHeader(polyHeaders, polyDs?.rows ?? [], h))
  );

  const canApply = latCol && lonCol && polyDs?.rows?.length && effectiveWkt && joinCols.length > 0;

  function toggleJoinCol(col) {
    setJoinCols(prev => prev.includes(col) ? prev.filter(c => c !== col) : [...prev, col]);
  }

  function apply() {
    setErr("");
    try {
      const out = spatialJoin(rows, latCol, lonCol, polyDs.rows, effectiveWkt, joinCols, predicate);
      const matched = out.filter(r => r[joinCols[0]] != null).length;
      setResult({ rows: out, matched });
      appendLog({ module: "spatial", opType: "spatial_join", params: { latCol, lonCol, polyDsId, wktCol: effectiveWkt, joinCols, predicate }, label: `Spatial join (${predicate}) → ${joinCols.join(", ")} (${matched}/${rows.length} matched)` });
      onResult(out, joinCols, null, { kind: "step", step: {
        type: "sp_spatial_join", latCol, lonCol,
        polyDatasetId: polyDsId, wktCol: effectiveWkt, joinCols, predicate,
      }});
    } catch (e) {
      setErr(e.message);
    }
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
      <div style={{ fontSize: T.caption.fontSize, color: C.textMuted, lineHeight: 1.7 }}>
        Assigns polygon attributes to each point by testing containment (ray-casting).
        Requires a loaded polygon dataset with a WKT geometry column (e.g. from a .dbf/.shp upload).
        Geometry columns are excluded from joined attributes by default, matching an automatic st_drop_geometry() workflow.
      </div>
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8 }}>
        <ColSelect label="Latitude column" value={latCol} onChange={setLatCol} headers={headers} C={C} />
        <ColSelect label="Longitude column" value={lonCol} onChange={setLonCol} headers={headers} C={C} />
        <ColSelect label="Predicate" value={predicate} onChange={setPredicate} headers={["within", "intersects"]} C={C} />
      </div>

      {/* Polygon dataset picker */}
      <div style={{ display: "flex", flexDirection: "column", gap: 3 }}>
        <label style={{ fontSize: T.caption.fontSize, color: C.textMuted, letterSpacing: "0.12em", textTransform: "uppercase" }}>
          Polygon dataset
        </label>
        {availableDatasets.length <= 1 ? (
          <div style={{ fontSize: T.caption.fontSize, color: C.gold, padding: "6px 8px", border: `1px solid ${C.gold}40`, borderRadius: 3 }}>
            Load a shapefile/polygon dataset first (Data tab → Load dataset).
          </div>
        ) : (
          <select
            value={polyDsId}
            onChange={e => { setPolyDsId(e.target.value); setWktCol(""); setJoinCols([]); }}
            style={{
              padding: "4px 8px", background: C.surface, border: `1px solid ${C.border2}`,
              borderRadius: 3, color: C.text, fontFamily: T.code.fontFamily, fontSize: T.caption.fontSize, outline: "none",
            }}
          >
            <option value="">— select polygon dataset —</option>
            {availableDatasets.map(ds => (
              <option key={ds.id} value={ds.id}>{ds.filename ?? ds.id}</option>
            ))}
          </select>
        )}
      </div>

      {polyDs && (
        <>
          <ColSelect
            label="WKT geometry column"
            value={effectiveWkt}
            onChange={setWktCol}
            headers={polyHeaders}
            C={C}
          />
          <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
            <label style={{ fontSize: T.caption.fontSize, color: C.textMuted, letterSpacing: "0.12em", textTransform: "uppercase" }}>
              Columns to join
            </label>
            <label style={{ display: "flex", alignItems: "center", gap: 6, fontFamily: T.code.fontFamily, fontSize: T.caption.fontSize, color: C.textMuted, marginBottom: 4 }}>
              <input type="checkbox" checked={includeGeomAttrs} onChange={e => {
                setIncludeGeomAttrs(e.target.checked);
                if (!e.target.checked) {
                  setJoinCols(prev => prev.filter(c => !isGeometryHeader(polyHeaders, polyDs?.rows ?? [], c)));
                }
              }} style={{ accentColor: C.teal }} />
              Include geometry columns
            </label>
            <div style={{ display: "flex", flexWrap: "wrap", gap: 5 }}>
              {joinableHeaders.map(h => (
                <button
                  key={h}
                  onClick={() => toggleJoinCol(h)}
                  style={{
                    padding: "2px 8px", fontFamily: T.code.fontFamily, fontSize: T.caption.fontSize, cursor: "pointer",
                    background: joinCols.includes(h) ? `${C.teal}18` : "transparent",
                    border: `1px solid ${joinCols.includes(h) ? C.teal : C.border2}`,
                    borderRadius: 3, color: joinCols.includes(h) ? C.teal : C.textDim,
                  }}
                >{h}</button>
              ))}
            </div>
          </div>
        </>
      )}

      <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
        <ApplyBtn onClick={apply} disabled={!canApply} C={C} label="Join" />
        {result && (
          <span style={{ fontSize: T.caption.fontSize, color: C.teal }}>
            ✓ {result.matched} / {rows.length} matched
          </span>
        )}
      </div>
      <ErrBanner msg={err} C={C} />
      {result && <ResultPreview rows={result.rows} newCols={joinCols} C={C} />}
    </div>
  );
}
