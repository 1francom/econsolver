// ─── ECON STUDIO · spatial/analyze/BufferSection.jsx ─ (moved verbatim from SpatialTab.jsx)
import { useState } from "react";
import { useTheme } from "../../../../ThemeContext.jsx";
import { ColSelect, NumInput, TextInput, ApplyBtn, ResultPreview, ErrBanner } from "../shared/atoms.jsx";
import { guessLatCol, guessLonCol } from "../shared/guess.js";
import { assignBuffer } from "../../../../math/SpatialEngine.js";
import { useSessionLog } from "../../../../services/session/sessionLog.jsx";

export function BufferSection({ rows, headers, onResult, C }) {
  const { T } = useTheme();
  const { appendLog } = useSessionLog();
  const [latCol,   setLatCol]   = useState(() => guessLatCol(headers));
  const [lonCol,   setLonCol]   = useState(() => guessLonCol(headers));
  const [refLat,   setRefLat]   = useState("");
  const [refLon,   setRefLon]   = useState("");
  const [radius,   setRadius]   = useState(50);
  const [outCol,   setOutCol]   = useState("in_buffer");
  const [result,   setResult]   = useState(null);
  const [err,      setErr]      = useState("");

  const canApply = latCol && lonCol && refLat !== "" && refLon !== "" && radius > 0 && outCol;

  function apply() {
    setErr("");
    try {
      const out = assignBuffer(rows, latCol, lonCol, Number(refLat), Number(refLon), Number(radius), outCol);
      const treated = out.filter(r => r[outCol] === 1).length;
      setResult({ rows: out, treated });
      appendLog({ module: "spatial", opType: "buffer_assign", params: { latCol, lonCol, refLat: Number(refLat), refLon: Number(refLon), radius: Number(radius), outCol }, label: `Buffer ${radius}km → ${outCol} (${treated} treated)` });
      onResult(out, [outCol]);
    } catch (e) {
      setErr(e.message);
    }
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
      <div style={{ fontSize: T.caption.fontSize, color: C.textMuted, lineHeight: 1.7 }}>
        Creates a binary treatment indicator (0/1) — 1 if the observation is within the specified radius of a reference point.
        Useful as an instrumental variable or treatment assignment variable.
      </div>
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8 }}>
        <ColSelect label="Latitude column" value={latCol} onChange={setLatCol} headers={headers} C={C} />
        <ColSelect label="Longitude column" value={lonCol} onChange={setLonCol} headers={headers} C={C} />
        <NumInput label="Reference latitude" value={refLat} onChange={setRefLat} C={C} step="any" placeholder="e.g. 48.1374" />
        <NumInput label="Reference longitude" value={refLon} onChange={setRefLon} C={C} step="any" placeholder="e.g. 11.5755" />
        <NumInput label="Radius (km)" value={radius} onChange={setRadius} C={C} min={0.1} step={1} />
        <TextInput label="Output column name" value={outCol} onChange={setOutCol} C={C} placeholder="in_buffer" />
      </div>
      <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
        <ApplyBtn onClick={apply} disabled={!canApply} C={C} />
        {result && (
          <span style={{ fontSize: T.caption.fontSize, color: C.teal }}>
            ✓ {result.treated} treated / {rows.length - result.treated} control
          </span>
        )}
      </div>
      <ErrBanner msg={err} C={C} />
      {result && <ResultPreview rows={result.rows} newCols={[outCol, latCol, lonCol]} C={C} />}
    </div>
  );
}
