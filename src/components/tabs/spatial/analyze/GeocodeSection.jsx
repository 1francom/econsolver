// ─── ECON STUDIO · spatial/analyze/GeocodeSection.jsx ─ (moved verbatim from SpatialTab.jsx)
import { useState, useMemo } from "react";
import { useTheme } from "../../../../ThemeContext.jsx";
import { ColSelect, NumInput, TextInput, ApplyBtn, ResultPreview, ErrBanner } from "../shared/atoms.jsx";
import { guessAddressCol } from "../shared/guess.js";
import { GEOCODE_BBOX_PRESETS, geocodeAddress, parseBBox, readGeocodeCache } from "../../../../services/data/geocoding.js";
import { useSessionLog } from "../../../../services/session/sessionLog.jsx";

export function GeocodeSection({ rows, headers, C, onResult }) {
  const { T } = useTheme();
  const { appendLog } = useSessionLog();
  const [addressCol, setAddressCol] = useState(() => guessAddressCol(headers));
  const [latCol,     setLatCol]     = useState("lat");
  const [lonCol,     setLonCol]     = useState("lon");
  const [provider,   setProvider]   = useState("photon");
  const [bboxPreset, setBboxPreset] = useState("munich");
  const [customBbox, setCustomBbox] = useState("");
  const [endpoint,   setEndpoint]   = useState("");
  const [apiKey,     setApiKey]     = useState("");
  const [maxRequests, setMaxRequests] = useState(25);
  const [running,    setRunning]    = useState(false);
  const [progress,   setProgress]   = useState(null);
  const [result,     setResult]     = useState(null);
  const [err,        setErr]        = useState("");

  const presetBbox = GEOCODE_BBOX_PRESETS[bboxPreset]?.bbox ?? null;
  const bbox = bboxPreset === "custom" ? parseBBox(customBbox) : presetBbox;
  const uniqueAddresses = useMemo(() => {
    const seen = new Set();
    return rows
      .map(r => String(r[addressCol] ?? "").trim().replace(/\s+/g, " "))
      .filter(Boolean)
      .filter(a => { const k = a.toLowerCase(); if (seen.has(k)) return false; seen.add(k); return true; });
  }, [rows, addressCol]);
  const canApply = addressCol && latCol && lonCol && !running &&
    (provider === "photon" || endpoint) &&
    (bboxPreset !== "custom" || bbox);

  async function apply() {
    setErr("");
    setResult(null);
    setRunning(true);
    setProgress({ done: 0, total: uniqueAddresses.length, fetched: 0, cached: 0 });
    try {
      const opts = {
        provider,
        endpoint: endpoint.trim(),
        apiKey: apiKey.trim(),
        bbox,
      };
      const lookup = new Map();
      let fetched = 0, cached = 0;
      for (let i = 0; i < uniqueAddresses.length; i++) {
        const address = uniqueAddresses[i];
        const cachedHit = readGeocodeCache(address, opts);
        if (cachedHit) {
          lookup.set(address.toLowerCase(), cachedHit);
          cached++;
          setProgress({ done: i + 1, total: uniqueAddresses.length, fetched, cached });
          continue;
        }
        if (fetched >= Number(maxRequests || 0)) {
          lookup.set(address.toLowerCase(), { lat: null, lon: null });
          setProgress({ done: i + 1, total: uniqueAddresses.length, fetched, cached });
          continue;
        }
        const hit = await geocodeAddress(address, opts);
        lookup.set(address.toLowerCase(), hit);
        fetched++;
        setProgress({ done: i + 1, total: uniqueAddresses.length, fetched, cached });
        if (i < uniqueAddresses.length - 1) await new Promise(resolve => setTimeout(resolve, 1100));
      }
      const out = rows.map(row => {
        const key = String(row[addressCol] ?? "").trim().replace(/\s+/g, " ").toLowerCase();
        const hit = lookup.get(key);
        return {
          ...row,
          [latCol]: hit?.lat ?? null,
          [lonCol]: hit?.lon ?? null,
        };
      });
      const matched = out.filter(r => Number.isFinite(r[latCol]) && Number.isFinite(r[lonCol])).length;
      setResult({ rows: out, matched });
      appendLog({ module: "spatial", opType: "geocode", reproducible: false, params: { addressCol, latCol, lonCol, provider, bbox: bboxPreset }, label: `Geocode ${addressCol} → (${latCol}, ${lonCol}): ${matched}/${rows.length} matched` });
      onResult(out, [latCol, lonCol]);
    } catch (e) {
      setErr(e.message || "Geocoding failed");
    } finally {
      setRunning(false);
    }
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
      <div style={{ fontSize: T.caption.fontSize, color: C.textMuted, lineHeight: 1.7 }}>
        Converts address strings to latitude/longitude with Photon/Komoot by default.
        Requests are rate-limited and cached in sessionStorage.
      </div>
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8 }}>
        <ColSelect label="Address column" value={addressCol} onChange={setAddressCol} headers={headers} C={C} />
        <TextInput label="Latitude output col" value={latCol} onChange={setLatCol} C={C} placeholder="lat" />
        <TextInput label="Longitude output col" value={lonCol} onChange={setLonCol} C={C} placeholder="lon" />
        <NumInput label="Max uncached requests" value={maxRequests} onChange={setMaxRequests} C={C} min={1} step={1} />
      </div>

      <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
        {[["photon", "Photon/Komoot"], ["custom", "Nominatim-compatible"]].map(([v, label]) => (
          <button key={v} onClick={() => setProvider(v)}
            style={{
              padding: "3px 10px", fontFamily: T.code.fontFamily, fontSize: T.caption.fontSize, cursor: "pointer",
              background: provider === v ? `${C.teal}18` : "transparent",
              border: `1px solid ${provider === v ? C.teal : C.border2}`,
              borderRadius: 3, color: provider === v ? C.teal : C.textDim,
            }}
          >{label}</button>
        ))}
      </div>

      <div style={{ display: "grid", gridTemplateColumns: provider === "custom" ? "1fr 1fr" : "1fr", gap: 8 }}>
        <div style={{ display: "flex", flexDirection: "column", gap: 3 }}>
          <label style={{ fontSize: T.caption.fontSize, color: C.textMuted, letterSpacing: "0.12em", textTransform: "uppercase" }}>
            Bounding box
          </label>
          <select value={bboxPreset} onChange={e => setBboxPreset(e.target.value)}
            style={{ padding: "4px 8px", background: C.surface, border: `1px solid ${C.border2}`, borderRadius: 3, color: C.text, fontFamily: T.code.fontFamily, fontSize: T.caption.fontSize, outline: "none" }}
          >
            {Object.entries(GEOCODE_BBOX_PRESETS).map(([k, v]) => <option key={k} value={k}>{v.label}</option>)}
            <option value="custom">Custom bbox</option>
          </select>
        </div>
        {bboxPreset === "custom" && (
          <TextInput label="minLon,minLat,maxLon,maxLat" value={customBbox} onChange={setCustomBbox} C={C} placeholder="11.35,48.02,11.75,48.25" />
        )}
        {provider === "custom" && (
          <>
            <TextInput label="Endpoint URL" value={endpoint} onChange={setEndpoint} C={C} placeholder="https://.../search" />
            <TextInput label="API key (optional)" value={apiKey} onChange={setApiKey} C={C} placeholder="key" />
          </>
        )}
      </div>

      <div style={{ fontSize: T.caption.fontSize, color: C.gold, lineHeight: 1.6 }}>
        This sends selected address strings to the configured geocoder. Use cached results or a private endpoint for sensitive data.
      </div>

      <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
        <ApplyBtn onClick={apply} disabled={!canApply} label={running ? "Geocoding..." : "Geocode"} C={C} />
        {progress && (
          <span style={{ fontSize: T.caption.fontSize, color: running ? C.gold : C.teal }}>
            {progress.done}/{progress.total} addresses · {progress.fetched} fetched · {progress.cached} cached
          </span>
        )}
        {result && <span style={{ fontSize: T.caption.fontSize, color: C.teal }}>{result.matched} / {rows.length} rows matched</span>}
      </div>
      <ErrBanner msg={err} C={C} />
      {result && <ResultPreview rows={result.rows} newCols={[addressCol, latCol, lonCol]} C={C} />}
    </div>
  );
}

// ─── 7. MAP VIEWER ───────────────────────────────────────────────────────────
