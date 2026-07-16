// ─── ECON STUDIO · spatial/plot/GeoLayerConfig.jsx ─ (moved verbatim from SpatialTab.jsx)
import { useMemo, useState, useEffect } from "react";
import { useTheme } from "../../../../ThemeContext.jsx";
import { PALETTE_DEFS, paletteToCss } from "../shared/color.js";
import { isSafeExpr } from "../../../../pipeline/exprGuard.js";

// Staged text input — draft only commits to layer state on blur/Enter, so the
// (potentially expensive) canvas re-render doesn't fire on every keystroke.
function FilterInput({ value, onChg, C }) {
  const { T } = useTheme();
  const [draft, setDraft] = useState(value ?? "");
  useEffect(() => { setDraft(value ?? ""); }, [value]);
  const unsafe = draft.trim() !== "" && !isSafeExpr(draft);
  const commit = () => { if (!unsafe) onChg(draft); };
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 2 }}>
      <div style={{ fontSize: T.caption.fontSize, color: C.textMuted, textTransform: "uppercase", letterSpacing: "0.11em", fontFamily: T.code.fontFamily }}>
        Filter rows (optional)
      </div>
      <input value={draft} onChange={e => setDraft(e.target.value)}
        onBlur={commit}
        onKeyDown={e => { if (e.key === "Enter") { e.preventDefault(); commit(); } else if (e.key === "Escape") setDraft(value ?? ""); }}
        placeholder={'e.g. population > 1000  ·  region %in% c("A","B")'}
        style={{
          padding: "3px 6px", background: C.surface,
          border: `1px solid ${unsafe ? C.red ?? "#c47070" : C.border2}`,
          borderRadius: 3, fontFamily: T.code.fontFamily, fontSize: T.caption.fontSize, color: C.text, outline: "none",
        }} />
      {unsafe && (
        <div style={{ fontSize: T.caption.fontSize, color: C.red ?? "#c47070", fontFamily: T.code.fontFamily }}>
          Unsafe expression — rejected identifier or template literal.
        </div>
      )}
    </div>
  );
}

function PalettePicker({ value, onChange, C }) {
  const { T } = useTheme();
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 5, flexWrap: "wrap" }}>
      <span style={{ fontSize: T.caption.fontSize, color: C.textMuted, fontFamily: T.code.fontFamily, textTransform: "uppercase", letterSpacing: "0.1em", whiteSpace: "nowrap" }}>Scale</span>
      {Object.entries(PALETTE_DEFS).map(([key, pal]) => {
        const active = (value ?? "teal-gold") === key;
        return (
          <button key={key} onClick={() => onChange(key)} title={pal.label}
            style={{
              padding: 0, border: `2px solid ${active ? C.teal : C.border2}`,
              borderRadius: 3, cursor: "pointer", background: "none",
              outline: active ? `1px solid ${C.teal}` : "none", outlineOffset: 1,
            }}
          >
            <div style={{ width: 32, height: 9, borderRadius: 1, background: paletteToCss(pal) }} />
          </button>
        );
      })}
    </div>
  );
}

// Staged numeric input — value only commits to layer state (which drives the
// canvas recompute) on explicit confirm (✓ button or Enter). Prevents the grid
// from recomputing on every keystroke, which froze on transient tiny cell sizes.
function NumIn({ label, value, onChg, min, max, step, suffix, C }) {
  const { T } = useTheme();
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
      <span style={{ fontSize: T.caption.fontSize, color: C.textMuted, fontFamily: T.code.fontFamily, textTransform: "uppercase", letterSpacing: "0.1em", whiteSpace: "nowrap" }}>{label}</span>
      <div style={{ display: "flex", alignItems: "stretch", gap: 4 }}>
        <div style={{ display: "flex", alignItems: "stretch", flex: 1, background: C.surface, border: `1px solid ${dirty ? C.gold + "99" : C.border2}`, borderLeft: `2px solid ${C.teal}88`, borderRadius: 3, overflow: "hidden" }}>
          <input type="number" min={min} max={max} step={step} value={draft}
            onChange={e => setDraft(e.target.value)}
            onKeyDown={e => { if (e.key === "Enter") { e.preventDefault(); commit(); } else if (e.key === "Escape") setDraft(String(value)); }}
            style={{ width: 58, padding: "3px 5px", background: "transparent", border: "none", fontFamily: T.code.fontFamily, fontSize: T.caption.fontSize, color: C.text, outline: "none" }} />
          {suffix && <span style={{ fontFamily: T.code.fontFamily, fontSize: T.caption.fontSize, color: C.teal, padding: "0 6px", borderLeft: `1px solid ${C.border2}`, display: "flex", alignItems: "center" }}>{suffix}</span>}
        </div>
        {dirty && (
          <button onClick={commit} title="Apply (Enter)"
            style={{ padding: "0 8px", background: `${C.teal}22`, border: `1px solid ${C.teal}99`, borderRadius: 3, color: C.teal, fontFamily: T.code.fontFamily, fontSize: T.code.fontSize, cursor: "pointer", lineHeight: 1 }}>✓</button>
        )}
      </div>
    </div>
  );
}

// Staged range slider — local draft updates instantly; commits to parent only on
// pointer-up so the expensive Observable Plot rebuild fires once per gesture, not
// on every pixel of drag. Defined outside GeoLayerConfig so React doesn't remount
// it on every parent render (which would kill slider focus mid-drag).
function StagedRng({ label, value, onChg, min, max, step, fmt, C }) {
  const { T } = useTheme();
  const [draft, setDraft] = useState(value);
  useEffect(() => { setDraft(value); }, [value]);
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 5 }}>
      <span style={{ fontSize: T.caption.fontSize, color: C.textMuted, fontFamily: T.code.fontFamily, textTransform: "uppercase", letterSpacing: "0.1em", whiteSpace: "nowrap" }}>{label}</span>
      <input type="range" min={min} max={max} step={step} value={draft}
        onChange={e => setDraft(parseFloat(e.target.value))}
        onPointerUp={e => onChg(parseFloat(e.target.value))}
        style={{ width: 60, accentColor: C.teal }} />
      <span style={{ fontFamily: T.code.fontFamily, fontSize: T.caption.fontSize, color: C.textMuted, minWidth: 28 }}>{fmt ? fmt(draft) : draft}</span>
    </div>
  );
}

export function GeoLayerConfig({ ly, onChange, headers, wktHeaders, rows, availableDatasets, C }) {
  const { T } = useTheme();
  const upd = patch => onChange({ ...ly, ...patch });

  // Resolve headers for the currently selected dataset
  const dsHeaders = useMemo(() => {
    if (!ly.datasetId || ly.datasetId === "active") return headers;
    const ds = availableDatasets.find(d => d.id === ly.datasetId);
    return ds?.headers ?? headers;
  }, [ly.datasetId, headers, availableDatasets]);

  // Resolve rows for the currently selected dataset
  const dsRows = useMemo(() => {
    if (!ly.datasetId || ly.datasetId === "active") return rows ?? [];
    const ds = availableDatasets.find(d => d.id === ly.datasetId);
    return ds?.rows ?? rows ?? [];
  }, [ly.datasetId, rows, availableDatasets]);

  // Diagnostic: check lat/lon column values against WGS84 bounds
  const ptDiagnostic = useMemo(() => {
    if ((ly.type !== "point" && ly.type !== "heatmap") || !ly.latCol || !ly.lonCol || ly.mode === "wkt") return null;
    let total = 0, valid = 0, outOfBounds = 0;
    const sample = dsRows.slice(0, 200);
    for (const row of sample) {
      const lat = parseFloat(row[ly.latCol]), lon = parseFloat(row[ly.lonCol]);
      if (isNaN(lat) || isNaN(lon)) continue;
      total++;
      if (lat < -90 || lat > 90 || lon < -180 || lon > 180) outOfBounds++;
      else valid++;
    }
    if (total === 0) return null;
    return { total: sample.length, checked: total, valid, outOfBounds };
  }, [ly.type, ly.latCol, ly.lonCol, ly.mode, dsRows]);

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
      <div style={{ fontSize: T.caption.fontSize, color: C.textMuted, textTransform: "uppercase", letterSpacing: "0.11em", fontFamily: T.code.fontFamily }}>{label}</div>
      <select value={value} onChange={e => onChg(e.target.value)}
        style={{ padding: "2px 4px", background: C.surface, border: `1px solid ${C.border2}`, borderRadius: 3, fontFamily: T.code.fontFamily, fontSize: T.caption.fontSize, color: C.text, outline: "none" }}>
        <option value="">— none —</option>
        {opts.map(h => <option key={h} value={h}>{h}</option>)}
      </select>
    </div>
  );
  const Rng = StagedRng;
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
      {/* Dataset selector */}
      <div style={{ display: "flex", flexDirection: "column", gap: 2 }}>
        <div style={{ fontSize: T.caption.fontSize, color: C.textMuted, textTransform: "uppercase", letterSpacing: "0.11em", fontFamily: T.code.fontFamily }}>Dataset</div>
        <select value={ly.datasetId ?? "active"} onChange={e => upd({ datasetId: e.target.value, wktCol: "", boundaryCol: "", latCol: "", lonCol: "" })}
          style={{ padding: "2px 4px", background: C.surface, border: `1px solid ${C.teal}55`, borderRadius: 3, fontFamily: T.code.fontFamily, fontSize: T.caption.fontSize, color: C.text, outline: "none" }}>
          <option value="active">— active dataset —</option>
          {availableDatasets.map(d => <option key={d.id} value={d.id}>{d.filename ?? d.name ?? d.id}</option>)}
        </select>
      </div>
      {/* Row-level filter — scoped to this layer only, never touches rawData or the pipeline */}
      <FilterInput value={ly.filterExpr} onChg={v => upd({ filterExpr: v })} C={C} />
      {ly.type === "grid" && (
        <div style={{ display: "flex", gap: 3, flexWrap: "wrap" }}>
          {[["wkt", "Existing WKT"], ["boundary", "Boundary"], ["latlon", "Lat/Lon"]].map(([m, lbl]) => (
            <button key={m} onClick={() => upd({ mode: m })}
              style={{
                flex: 1, padding: "2px 0", borderRadius: 3, fontFamily: T.code.fontFamily, fontSize: T.caption.fontSize, cursor: "pointer",
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
          <Sel label="Fill by" value={ly.fillByCol ?? ly.colorByCol ?? ""} onChg={v => upd({ fillByCol: v, colorByCol: v })} opts={dsHeaders} />
          <Sel label="Label by" value={ly.labelCol ?? ""} onChg={v => upd({ labelCol: v })} opts={dsHeaders} />
          {ly.labelCol && (
            <Rng label="Label size" value={ly.labelSize ?? 10} onChg={v => upd({ labelSize: v })} min={6} max={24} step={1} fmt={v => v.toFixed(0) + "px"} C={C} />
          )}
          {(ly.fillByCol || ly.colorByCol) && (<>
            <div style={{ gridColumn: "1 / -1" }}>
              <PalettePicker value={ly.palette} onChange={v => upd({ palette: v })} C={C} />
            </div>
            <Rng label="Color opacity" value={ly.colorFillOpacity ?? 0.65} onChg={v => upd({ colorFillOpacity: v })} min={0} max={1} step={0.05} fmt={v => (v * 100).toFixed(0) + "%"} C={C} />
          </>)}
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
          <label style={{ display: "flex", alignItems: "center", gap: 4, fontFamily: T.code.fontFamily, fontSize: T.caption.fontSize, color: C.textMuted, marginBottom: 3 }}>
            <input type="checkbox" checked={ly.clipBorder !== false} onChange={e => upd({ clipBorder: e.target.checked })} style={{ accentColor: C.teal }} />
            clip
          </label>
        </div>
      )}
      {(ly.type === "polygon" || ly.type === "boundary" || ly.type === "line") && (
        <Sel label="Geometry (WKT)" value={ly.wktCol} onChg={v => upd({ wktCol: v })} opts={geomCols} />
      )}
      {ly.type === "polygon" && (
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 6 }}>
          <Sel label="Fill by" value={ly.fillByCol ?? ly.colorByCol ?? ""} onChg={v => upd({ fillByCol: v, colorByCol: v })} opts={dsHeaders} />
          <Sel label="Label by" value={ly.labelCol ?? ""} onChg={v => upd({ labelCol: v })} opts={dsHeaders} />
          {ly.labelCol && (
            <Rng label="Label size" value={ly.labelSize ?? 10} onChg={v => upd({ labelSize: v })} min={6} max={24} step={1} fmt={v => v.toFixed(0) + "px"} C={C} />
          )}
          {(ly.fillByCol || ly.colorByCol) && (<>
            <div style={{ gridColumn: "1 / -1" }}>
              <PalettePicker value={ly.palette} onChange={v => upd({ palette: v })} C={C} />
            </div>
            <Rng label="Color opacity" value={ly.colorFillOpacity ?? 0.65} onChg={v => upd({ colorFillOpacity: v })} min={0} max={1} step={0.05} fmt={v => (v * 100).toFixed(0) + "%"} C={C} />
          </>)}
        </div>
      )}
      {ly.type === "point" && (
        <>
          <div style={{ display: "flex", gap: 4 }}>
            {[["latlon", "Lat/Lon"], ["wkt", "WKT geometry"]].map(([m, lbl]) => (
              <button key={m} onClick={() => upd({ mode: m })}
                style={{
                  flex: 1, padding: "2px 0", borderRadius: 3, fontFamily: T.code.fontFamily, fontSize: T.caption.fontSize, cursor: "pointer",
                  background: (ly.mode ?? "latlon") === m ? `${C.teal}18` : "transparent",
                  border: `1px solid ${(ly.mode ?? "latlon") === m ? C.teal + "55" : C.border2}`,
                  color: (ly.mode ?? "latlon") === m ? C.teal : C.textMuted,
                }}
              >{lbl}</button>
            ))}
          </div>
          {(ly.mode === "latlon" || !ly.mode) && (
            <>
              <div style={{ display: "flex", gap: 6 }}>
                <Sel label="Latitude" value={ly.latCol} onChg={v => upd({ latCol: v })} opts={dsHeaders} />
                <Sel label="Longitude" value={ly.lonCol} onChg={v => upd({ lonCol: v })} opts={dsHeaders} />
              </div>
              {ptDiagnostic && ptDiagnostic.valid === 0 && (
                <div style={{ padding: "5px 8px", borderRadius: 3, background: `${C.gold}12`, border: `1px solid ${C.gold}50`, fontFamily: T.code.fontFamily, fontSize: T.caption.fontSize, color: C.gold, lineHeight: 1.5 }}>
                  ⚠ All sampled values outside WGS84 bounds (lat: −90…90, lon: −180…180).
                  If integer-encoded, use DataViewer → Position to insert the decimal point.
                </div>
              )}
              {ptDiagnostic && ptDiagnostic.valid > 0 && ptDiagnostic.outOfBounds > 0 && (
                <div style={{ padding: "4px 8px", borderRadius: 3, background: `${C.gold}0c`, border: `1px solid ${C.gold}30`, fontFamily: T.code.fontFamily, fontSize: T.caption.fontSize, color: C.gold }}>
                  ⚠ {ptDiagnostic.outOfBounds} of {ptDiagnostic.checked} sampled rows have out-of-bounds coordinates
                </div>
              )}
            </>
          )}
          {ly.mode === "wkt" && (
            <Sel label="WKT geometry" value={ly.wktCol ?? ""} onChg={v => upd({ wktCol: v })} opts={geomCols} />
          )}
          <Sel label="Fill by (optional)" value={ly.colorCol ?? ""} onChg={v => upd({ colorCol: v })} opts={dsHeaders} />
          {ly.colorCol && <PalettePicker value={ly.palette} onChange={v => upd({ palette: v })} C={C} />}
        </>
      )}
      {ly.type === "heatmap" && (
        <div style={{ display: "flex", gap: 6 }}>
          <Sel label="Latitude" value={ly.latCol} onChg={v => upd({ latCol: v })} opts={dsHeaders} />
          <Sel label="Longitude" value={ly.lonCol} onChg={v => upd({ lonCol: v })} opts={dsHeaders} />
        </div>
      )}
      {ly.type === "heatmap" && (
        <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 6 }}>
            <NumIn label="Bandwidth" value={ly.bandwidth ?? 250} onChg={v => upd({ bandwidth: v })} min={10} max={10000} step={10} suffix="m" C={C} />
            <NumIn label="Grid N" value={ly.gridN ?? 45} onChg={v => upd({ gridN: v })} min={10} max={120} step={1} C={C} />
          </div>
          <PalettePicker value={ly.palette} onChange={v => upd({ palette: v })} C={C} />
        </div>
      )}
      {(ly.type === "polygon" || ly.type === "point" || ly.type === "grid") && !(ly.type === "point" && ly.colorCol) && (
        <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
          <div style={{ display: "flex", alignItems: "center", gap: 5 }}>
            <span style={{ fontSize: T.caption.fontSize, color: C.textMuted, fontFamily: T.code.fontFamily, textTransform: "uppercase", letterSpacing: "0.1em" }}>Fill</span>
            <input type="color" value={ly.fill === "none" ? C.blue : (ly.fill ?? C.blue)}
              onChange={e => upd({ fill: e.target.value })}
              style={{ width: 26, height: 18, cursor: "pointer", border: "none", padding: 0, background: "none" }} />
          </div>
          <Rng label="Opacity" value={ly.fillOpacity ?? 0.3} onChg={v => upd({ fillOpacity: v })} min={0} max={1} step={0.05} fmt={v => (v * 100).toFixed(0) + "%"} C={C} />
        </div>
      )}
      {ly.type === "point" && ly.colorCol && (
        <Rng label="Opacity" value={ly.fillOpacity ?? 0.78} onChg={v => upd({ fillOpacity: v })} min={0} max={1} step={0.05} fmt={v => (v * 100).toFixed(0) + "%"} C={C} />
      )}
      {ly.type !== "point" && ly.type !== "heatmap" && (
        <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
          <div style={{ display: "flex", alignItems: "center", gap: 5 }}>
            <span style={{ fontSize: T.caption.fontSize, color: C.textMuted, fontFamily: T.code.fontFamily, textTransform: "uppercase", letterSpacing: "0.1em" }}>Stroke</span>
            <input type="color" value={ly.stroke ?? C.textMuted} onChange={e => upd({ stroke: e.target.value })}
              style={{ width: 26, height: 18, cursor: "pointer", border: "none", padding: 0, background: "none" }} />
          </div>
          <Rng label="Width" value={ly.strokeWidth ?? 0.8} onChg={v => upd({ strokeWidth: v })} min={0.1} max={4} step={0.1} fmt={v => v.toFixed(1) + "px"} C={C} />
        </div>
      )}
      {ly.type === "point" && (
        <Rng label="Radius" value={ly.radius ?? 4} onChg={v => upd({ radius: v })} min={1} max={14} step={0.5} fmt={v => v.toFixed(1)} C={C} />
      )}
    </div>
  );
}

