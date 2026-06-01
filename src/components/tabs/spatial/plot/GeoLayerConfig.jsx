// ─── ECON STUDIO · spatial/plot/GeoLayerConfig.jsx ─ (moved verbatim from SpatialTab.jsx)
import { useMemo, useState, useEffect } from "react";
import { mono } from "../shared/constants.js";

// Staged numeric input — value only commits to layer state (which drives the
// canvas recompute) on explicit confirm (✓ button or Enter). Prevents the grid
// from recomputing on every keystroke, which froze on transient tiny cell sizes.
function NumIn({ label, value, onChg, min, max, step, suffix, C }) {
  const [draft, setDraft] = useState(String(value));
  useEffect(() => { setDraft(String(value)); }, [value]);
  const dirty = draft !== String(value);
  const commit = () => {
    let v = Number(draft);
    if (!Number.isFinite(v)) v = min;
    v = Math.min(max, Math.max(min, v));
    onChg(v);
    setDraft(String(v));
  };
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 2, minWidth: 92 }}>
      <span style={{ fontSize: 7, color: C.textMuted, fontFamily: mono, textTransform: "uppercase", letterSpacing: "0.1em", whiteSpace: "nowrap" }}>{label}</span>
      <div style={{ display: "flex", alignItems: "stretch", gap: 4 }}>
        <div style={{ display: "flex", alignItems: "stretch", flex: 1, background: C.surface, border: `1px solid ${dirty ? C.gold + "99" : C.border2}`, borderLeft: `2px solid ${C.teal}88`, borderRadius: 3, overflow: "hidden" }}>
          <input type="number" min={min} max={max} step={step} value={draft}
            onChange={e => setDraft(e.target.value)}
            onKeyDown={e => { if (e.key === "Enter") { e.preventDefault(); commit(); } else if (e.key === "Escape") setDraft(String(value)); }}
            style={{ width: 58, padding: "3px 5px", background: "transparent", border: "none", fontFamily: mono, fontSize: 10, color: C.text, outline: "none" }} />
          {suffix && <span style={{ fontFamily: mono, fontSize: 8, color: C.teal, padding: "0 6px", borderLeft: `1px solid ${C.border2}`, display: "flex", alignItems: "center" }}>{suffix}</span>}
        </div>
        {dirty && (
          <button onClick={commit} title="Apply (Enter)"
            style={{ padding: "0 8px", background: `${C.teal}22`, border: `1px solid ${C.teal}99`, borderRadius: 3, color: C.teal, fontFamily: mono, fontSize: 11, cursor: "pointer", lineHeight: 1 }}>✓</button>
        )}
      </div>
    </div>
  );
}

export function GeoLayerConfig({ ly, onChange, headers, wktHeaders, availableDatasets, C }) {
  const upd = patch => onChange({ ...ly, ...patch });

  // Resolve headers for the currently selected dataset
  const dsHeaders = useMemo(() => {
    if (!ly.datasetId || ly.datasetId === "active") return headers;
    const ds = availableDatasets.find(d => d.id === ly.datasetId);
    return ds?.headers ?? headers;
  }, [ly.datasetId, headers, availableDatasets]);

  const dsWktHeaders = useMemo(() =>
    dsHeaders.filter(h => {
      const ds = (!ly.datasetId || ly.datasetId === "active") ? null : availableDatasets.find(d => d.id === ly.datasetId);
      const rows = ds?.rows ?? [];
      const s = rows.find(r => r[h] != null)?.[h];
      return typeof s === "string" && /^(POINT|POLYGON|MULTI|LINE)/i.test(s.trim());
    }),
  [dsHeaders, ly.datasetId, availableDatasets]);

  const geomCols = dsWktHeaders.length ? dsWktHeaders : (wktHeaders.length ? wktHeaders : dsHeaders);

  const Sel = ({ label, value, onChg, opts }) => (
    <div style={{ display: "flex", flexDirection: "column", gap: 2, flex: 1, minWidth: 80 }}>
      <div style={{ fontSize: 7, color: C.textMuted, textTransform: "uppercase", letterSpacing: "0.11em", fontFamily: mono }}>{label}</div>
      <select value={value} onChange={e => onChg(e.target.value)}
        style={{ padding: "2px 4px", background: C.surface, border: `1px solid ${C.border2}`, borderRadius: 3, fontFamily: mono, fontSize: 9, color: C.text, outline: "none" }}>
        <option value="">— none —</option>
        {opts.map(h => <option key={h} value={h}>{h}</option>)}
      </select>
    </div>
  );
  const Rng = ({ label, value, onChg, min, max, step, fmt }) => (
    <div style={{ display: "flex", alignItems: "center", gap: 5 }}>
      <span style={{ fontSize: 7, color: C.textMuted, fontFamily: mono, textTransform: "uppercase", letterSpacing: "0.1em", whiteSpace: "nowrap" }}>{label}</span>
      <input type="range" min={min} max={max} step={step} value={value} onChange={e => onChg(parseFloat(e.target.value))}
        style={{ width: 60, accentColor: C.teal }} />
      <span style={{ fontFamily: mono, fontSize: 8, color: C.textMuted, minWidth: 28 }}>{fmt ? fmt(value) : value}</span>
    </div>
  );
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
      {/* Dataset selector */}
      <div style={{ display: "flex", flexDirection: "column", gap: 2 }}>
        <div style={{ fontSize: 7, color: C.textMuted, textTransform: "uppercase", letterSpacing: "0.11em", fontFamily: mono }}>Dataset</div>
        <select value={ly.datasetId ?? "active"} onChange={e => upd({ datasetId: e.target.value, wktCol: "", boundaryCol: "", latCol: "", lonCol: "" })}
          style={{ padding: "2px 4px", background: C.surface, border: `1px solid ${C.teal}55`, borderRadius: 3, fontFamily: mono, fontSize: 9, color: C.text, outline: "none" }}>
          <option value="active">— active dataset —</option>
          {availableDatasets.map(d => <option key={d.id} value={d.id}>{d.filename ?? d.name ?? d.id}</option>)}
        </select>
      </div>
      {ly.type === "grid" && (
        <div style={{ display: "flex", gap: 3, flexWrap: "wrap" }}>
          {[["wkt", "Existing WKT"], ["boundary", "Boundary"], ["latlon", "Lat/Lon"]].map(([m, lbl]) => (
            <button key={m} onClick={() => upd({ mode: m })}
              style={{
                flex: 1, padding: "2px 0", borderRadius: 3, fontFamily: mono, fontSize: 9, cursor: "pointer",
                background: (ly.mode ?? "boundary") === m ? `${C.teal}18` : "transparent",
                border: `1px solid ${(ly.mode ?? "boundary") === m ? C.teal + "55" : C.border2}`,
                color: (ly.mode ?? "boundary") === m ? C.teal : C.textMuted,
              }}
            >{lbl}</button>
          ))}
        </div>
      )}
      {ly.type === "grid" && ly.mode === "wkt" && (
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 6 }}>
          <Sel label="Grid WKT" value={ly.wktCol} onChg={v => upd({ wktCol: v })} opts={geomCols} />
          <Sel label="Color by" value={ly.colorByCol ?? ""} onChg={v => upd({ colorByCol: v })} opts={dsHeaders} />
          {ly.colorByCol && (
            <Rng label="Color opacity" value={ly.colorFillOpacity ?? 0.65} onChg={v => upd({ colorFillOpacity: v })} min={0} max={1} step={0.05} fmt={v => (v * 100).toFixed(0) + "%"} />
          )}
        </div>
      )}
      {ly.type === "grid" && (ly.mode ?? "boundary") === "latlon" && (
        <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
          <Sel label="Lat" value={ly.latCol} onChg={v => upd({ latCol: v })} opts={dsHeaders} />
          <Sel label="Lon" value={ly.lonCol} onChg={v => upd({ lonCol: v })} opts={dsHeaders} />
          <NumIn label="Cell size" value={ly.cellsize ?? 500} onChg={v => upd({ cellsize: v })} min={50} max={20000} step={50} suffix="m" C={C} />
        </div>
      )}
      {ly.type === "grid" && (ly.mode ?? "boundary") === "boundary" && (
        <div style={{ display: "flex", gap: 6, flexWrap: "wrap", alignItems: "end" }}>
          <Sel label="Boundary WKT" value={ly.boundaryCol ?? ly.wktCol ?? ""} onChg={v => upd({ boundaryCol: v, wktCol: v })} opts={geomCols} />
          <NumIn label="Cell size" value={ly.cellsize ?? 500} onChg={v => upd({ cellsize: v })} min={50} max={20000} step={50} suffix="m" C={C} />
          <label style={{ display: "flex", alignItems: "center", gap: 4, fontFamily: mono, fontSize: 8, color: C.textMuted, marginBottom: 3 }}>
            <input type="checkbox" checked={ly.clipBorder !== false} onChange={e => upd({ clipBorder: e.target.checked })} style={{ accentColor: C.teal }} />
            clip
          </label>
        </div>
      )}
      {(ly.type === "polygon" || ly.type === "boundary" || ly.type === "line") && (
        <Sel label="Geometry (WKT)" value={ly.wktCol} onChg={v => upd({ wktCol: v })} opts={geomCols} />
      )}
      {ly.type === "point" && (
        <div style={{ display: "flex", gap: 6 }}>
          <Sel label="Latitude" value={ly.latCol} onChg={v => upd({ latCol: v })} opts={dsHeaders} />
          <Sel label="Longitude" value={ly.lonCol} onChg={v => upd({ lonCol: v })} opts={dsHeaders} />
        </div>
      )}
      {(ly.type === "polygon" || ly.type === "point" || ly.type === "grid") && (
        <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
          <div style={{ display: "flex", alignItems: "center", gap: 5 }}>
            <span style={{ fontSize: 7, color: C.textMuted, fontFamily: mono, textTransform: "uppercase", letterSpacing: "0.1em" }}>Fill</span>
            <input type="color" value={ly.fill === "none" ? "#6e9ec8" : (ly.fill ?? "#6e9ec8")}
              onChange={e => upd({ fill: e.target.value })}
              style={{ width: 26, height: 18, cursor: "pointer", border: "none", padding: 0, background: "none" }} />
          </div>
          <Rng label="Opacity" value={ly.fillOpacity ?? 0.3} onChg={v => upd({ fillOpacity: v })} min={0} max={1} step={0.05} fmt={v => (v * 100).toFixed(0) + "%"} />
        </div>
      )}
      {ly.type !== "point" && (
        <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
          <div style={{ display: "flex", alignItems: "center", gap: 5 }}>
            <span style={{ fontSize: 7, color: C.textMuted, fontFamily: mono, textTransform: "uppercase", letterSpacing: "0.1em" }}>Stroke</span>
            <input type="color" value={ly.stroke ?? "#333333"} onChange={e => upd({ stroke: e.target.value })}
              style={{ width: 26, height: 18, cursor: "pointer", border: "none", padding: 0, background: "none" }} />
          </div>
          <Rng label="Width" value={ly.strokeWidth ?? 0.8} onChg={v => upd({ strokeWidth: v })} min={0.1} max={4} step={0.1} fmt={v => v.toFixed(1) + "px"} />
        </div>
      )}
      {ly.type === "point" && (
        <Rng label="Radius" value={ly.radius ?? 4} onChg={v => upd({ radius: v })} min={1} max={14} step={0.5} fmt={v => v.toFixed(1)} />
      )}
    </div>
  );
}

