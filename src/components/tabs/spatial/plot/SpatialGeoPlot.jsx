// ─── ECON STUDIO · spatial/plot/SpatialGeoPlot.jsx ─ (moved verbatim from SpatialTab.jsx)
import { useState, useMemo, useEffect, useRef } from "react";
import { useTheme } from "../../../../ThemeContext.jsx";
import { getGeoPlotConfig, getPlotHistory, saveGeoPlotConfig, savePlotHistory } from "../../../../services/Persistence/plotHistory.js";
import { loadGeoPlt, mkGeoLayer } from "./geo.js";
import { GeoLayerConfig } from "./GeoLayerConfig.jsx";
import { GeoPlotCanvas } from "./GeoPlotCanvas.jsx";
import { guessLatCol, guessLonCol } from "../shared/guess.js";
import { buildGeoGgplot } from "../../../../services/export/plotScript.js";

export function SpatialGeoPlot({ rows, headers, availableDatasets, C, pid }) {
  const { T } = useTheme();
  const [Plt,     setPlt]     = useState(null);
  const [pltErr,  setPltErr]  = useState(null);
  const [layers,  setLayers]  = useState([]);
  const [activeId,setActiveId]= useState(null);
  const [title,   setTitle]   = useState("");
  const [subtitle,setSubtitle]= useState("");
  const [caption, setCaption] = useState("");
  const [plotHistory, setPlotHistory] = useState([]);
  const [histIdx,     setHistIdx]     = useState(null);
  const [histOpen,    setHistOpen]    = useState(false);
  const [rCopied,     setRCopied]     = useState(false);
  const [compareIds,  setCompareIds]  = useState(new Set());
  const [userH,       setUserH]       = useState(null); // null = auto
  const [basemap,     setBasemap]     = useState("none"); // none | light | dark | osm
  const wrapRef    = useRef(null);
  const geoPlotRef = useRef(null);
  const hydratedRef = useRef(false);
  const [canvasW, setCanvasW] = useState(700);
  const [canvasH, setCanvasH] = useState(500);

  useEffect(() => { loadGeoPlt().then(setPlt).catch(e => setPltErr(e.message)); }, []);
  useEffect(() => { if (!pid) return; getPlotHistory(pid).then(h => setPlotHistory(h ?? [])).catch(() => {}); }, [pid]);
  useEffect(() => {
    let cancelled = false;
    hydratedRef.current = false;
    if (!pid) {
      hydratedRef.current = true;
      return () => { cancelled = true; };
    }
    getGeoPlotConfig(pid).then(cfg => {
      if (cancelled) return;
      if (!cfg) {
        hydratedRef.current = true;
        return;
      }
      if (Array.isArray(cfg.layers)) setLayers(cfg.layers);
      if (cfg.activeId != null) setActiveId(cfg.activeId);
      if (typeof cfg.title === "string") setTitle(cfg.title);
      if (typeof cfg.subtitle === "string") setSubtitle(cfg.subtitle);
      if (typeof cfg.caption === "string") setCaption(cfg.caption);
      if (cfg.userH != null) setUserH(cfg.userH);
      if (typeof cfg.basemap === "string") setBasemap(cfg.basemap);
      else if (cfg.showTiles === true) setBasemap("light"); // migrate old boolean toggle
      hydratedRef.current = true;
    }).catch(() => {
      if (!cancelled) hydratedRef.current = true;
    });
    return () => { cancelled = true; };
  }, [pid]);
  useEffect(() => {
    if (!pid || !hydratedRef.current) return;
    const t = setTimeout(() => {
      saveGeoPlotConfig(pid, { layers, activeId, title, subtitle, caption, userH, basemap }).catch(() => {});
    }, 400);
    return () => clearTimeout(t);
  }, [pid, layers, activeId, title, subtitle, caption, userH, basemap]);
  useEffect(() => {
    if (!wrapRef.current) return;
    const ro = new ResizeObserver(([e]) => {
      setCanvasW(e.contentRect.width);
      setCanvasH(e.contentRect.height);
    });
    ro.observe(wrapRef.current);
    return () => ro.disconnect();
  }, []);

  const wktHeaders = useMemo(() => headers.filter(h => {
    const s = rows.find(r => r[h] != null)?.[h];
    return typeof s === "string" && /^(POINT|POLYGON|MULTI|LINE)/i.test(s.trim());
  }), [rows, headers]);

  const addLayer    = type => {
    const ly = mkGeoLayer(type, layers.length);
    if (type === "point" || type === "heatmap") {
      ly.latCol = guessLatCol(headers);
      ly.lonCol = guessLonCol(headers);
    }
    setLayers(p => [...p, ly]);
    setActiveId(ly.id);
    setHistIdx(null);
  };
  const updateLayer = upd  => setLayers(p => p.map(l => l.id === upd.id ? upd : l));
  const removeLayer = id   => { setLayers(p => p.filter(l => l.id !== id)); setActiveId(p => p === id ? null : p); };
  const activeLayer = layers.find(l => l.id === activeId) ?? null;

  const currentEntry = () => ({ layers, title, subtitle, caption });

  function exportPng() {
    geoPlotRef.current?.exportToPng(`${dTitle || "geo_plot"}.png`);
  }

  function exportPdf() {
    geoPlotRef.current?.exportToPdf();
  }

  async function savePlot() {
    if (!pid) return;
    const name = window.prompt("Plot name:", `Map ${plotHistory.length + 1}`);
    if (!name) return;
    let next;
    if (histIdx !== null) {
      next = plotHistory.map((e, i) => i === histIdx ? { ...e, ...currentEntry(), name } : e);
    } else {
      next = [...plotHistory, { id: Date.now(), name, ...currentEntry(), savedAt: Date.now() }];
      setHistIdx(next.length - 1);
    }
    setPlotHistory(next);
    await savePlotHistory(pid, next);
  }

  async function deletePlot(id) {
    const next = plotHistory.filter(e => e.id !== id);
    setPlotHistory(next); setHistIdx(null);
    if (pid) await savePlotHistory(pid, next);
  }

  function newPlot() { setLayers([]); setActiveId(null); setTitle(""); setSubtitle(""); setCaption(""); setHistIdx(null); }

  function copyRScript() {
    if (layers.length === 0) return;
    const script = buildGeoGgplot(currentEntry(), { datasets: availableDatasets, basemap });
    navigator.clipboard.writeText(script).then(() => {
      setRCopied(true);
      setTimeout(() => setRCopied(false), 1600);
    }).catch(() => setRCopied(false));
  }

  const view      = histIdx !== null ? plotHistory[histIdx] : null;
  const dLayers   = view ? view.layers   : layers;
  const dTitle    = view ? view.title    : title;
  const dSubtitle = view ? view.subtitle : subtitle;
  const dCaption  = view ? view.caption  : caption;
  const comparePlots = plotHistory.filter(e => compareIds.has(e.id));
  const maxW = Math.max(280, canvasW - 48);

  return (
    <div style={{ display: "flex", flexDirection: "column", height: "100%", overflowY: "auto" }}>

      {/* Toolbar */}
      <div style={{ padding: "8px 14px", borderBottom: `1px solid ${C.border}`, flexShrink: 0, display: "flex", flexDirection: "column", gap: 6 }}>

        {/* Row 1 — layer chips + add buttons */}
        <div style={{ display: "flex", alignItems: "center", gap: 5, flexWrap: "wrap" }}>
          {layers.map(ly => (
            <div key={ly.id} onClick={() => { setActiveId(ly.id); setHistIdx(null); }}
              style={{ display: "flex", alignItems: "center", gap: 4, padding: "2px 8px 2px 6px", borderRadius: 12, cursor: "pointer",
                background: activeId === ly.id ? `${C.teal}18` : C.surface,
                border: `1px solid ${activeId === ly.id ? C.teal + "55" : C.border2}` }}
            >
              <div style={{ width: 8, height: 8, borderRadius: ly.type === "point" ? "50%" : 1, flexShrink: 0,
                background: ly.fill !== "none" ? (ly.fill ?? ly.stroke) : ly.stroke }} />
              <span style={{ fontFamily: T.code.fontFamily, fontSize: T.caption.fontSize, color: activeId === ly.id ? C.teal : C.text }}>
                {ly.type}{(ly.wktCol || ly.latCol) ? ` · ${ly.wktCol || ly.latCol}` : ""}
              </span>
              <button onClick={e => { e.stopPropagation(); removeLayer(ly.id); }}
                style={{ background: "none", border: "none", cursor: "pointer", fontSize: T.code.fontSize, color: C.textMuted, padding: "0 0 0 2px", lineHeight: 1 }}>×</button>
            </div>
          ))}
          {[["polygon","Polygon"], ["boundary","Boundary"], ["point","Point"], ["heatmap","Heatmap"], ["line","Line"], ["grid","Grid"]].map(([t, lbl]) => (
            <button key={t} onClick={() => addLayer(t)}
              style={{ padding: "2px 8px", borderRadius: 12, fontFamily: T.code.fontFamily, fontSize: T.caption.fontSize, background: "none", border: `1px dashed ${C.border2}`, color: C.textMuted, cursor: "pointer" }}
            >+{lbl}</button>
          ))}
        </div>

        {/* Row 2 — active layer config */}
        {activeLayer && histIdx === null && (
          <div style={{ padding: "8px 10px", background: C.surface, borderRadius: 4, border: `1px solid ${C.border2}` }}>
            <GeoLayerConfig ly={activeLayer} onChange={updateLayer} headers={headers} wktHeaders={wktHeaders} rows={rows} availableDatasets={availableDatasets} C={C} />
          </div>
        )}

        {/* Row 3 — title/subtitle/source + save/nav */}
        <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
          {[["TITLE", title, setTitle, "title", 110], ["SUBTITLE", subtitle, setSubtitle, "subtitle", 140], ["SOURCE", caption, setCaption, "source / caption", 140]].map(([lbl, val, set, ph, w]) => (
            <div key={lbl} style={{ display: "flex", alignItems: "center", gap: 4 }}>
              <span style={{ fontSize: T.caption.fontSize, color: C.textMuted, fontFamily: T.code.fontFamily }}>{lbl}</span>
              <input value={val} onChange={e => set(e.target.value)} placeholder={ph}
                style={{ padding: "2px 6px", background: C.surface, border: `1px solid ${C.border2}`, borderRadius: 3, fontFamily: "serif", fontSize: T.caption.fontSize, color: C.text, outline: "none", width: w }} />
            </div>
          ))}
          {/* Height slider */}
          <div style={{ display: "flex", alignItems: "center", gap: 5 }}>
            <span style={{ fontSize: T.caption.fontSize, color: C.textMuted, fontFamily: T.code.fontFamily }}>H</span>
            <input type="range" min={300} max={Math.max(500, (typeof window !== "undefined" ? window.innerHeight : 850) - 170)} step={20}
              value={userH ?? Math.min(Math.max(420, canvasH - 60), (typeof window !== "undefined" ? window.innerHeight : 850) - 170)}
              onChange={e => setUserH(parseInt(e.target.value))}
              style={{ width: 70, accentColor: C.teal }} />
            <span style={{ fontFamily: T.code.fontFamily, fontSize: T.caption.fontSize, color: C.textMuted, minWidth: 32 }}>
              {userH ?? "auto"}
            </span>
            {userH !== null && (
              <button onClick={() => setUserH(null)}
                style={{ background: "none", border: "none", cursor: "pointer", fontSize: T.caption.fontSize, color: C.textMuted, padding: 0, lineHeight: 1 }}>↺</button>
            )}
          </div>

          {/* Basemap selector */}
          <div style={{ display: "flex", alignItems: "center", gap: 4 }}>
            <span style={{ fontSize: T.caption.fontSize, color: C.textMuted, fontFamily: T.code.fontFamily }}>MAP</span>
            {[["none", "Off"], ["light", "Light"], ["dark", "Dark"], ["osm", "OSM"]].map(([key, lbl]) => (
              <button key={key} onClick={() => setBasemap(key)}
                style={{ padding: "2px 7px", borderRadius: 3, fontFamily: T.code.fontFamily, fontSize: T.caption.fontSize, cursor: "pointer",
                  background: basemap === key ? `${C.teal}20` : "none",
                  border: `1px solid ${basemap === key ? C.teal + "60" : C.border2}`,
                  color: basemap === key ? C.teal : C.textMuted }}>
                {lbl}
              </button>
            ))}
          </div>

          <div style={{ marginLeft: "auto", display: "flex", alignItems: "center", gap: 5 }}>
            {dLayers.length > 0 && (<>
              <button onClick={exportPng}
                style={{ padding: "2px 8px", borderRadius: 3, fontFamily: T.code.fontFamily, fontSize: T.caption.fontSize, background: `${C.teal}12`, border: `1px solid ${C.teal}40`, color: C.teal, cursor: "pointer" }}>⬇ PNG</button>
              <button onClick={exportPdf}
                style={{ padding: "2px 8px", borderRadius: 3, fontFamily: T.code.fontFamily, fontSize: T.caption.fontSize, background: `${C.teal}12`, border: `1px solid ${C.teal}40`, color: C.teal, cursor: "pointer" }}>⬇ PDF</button>
            </>)}
            {plotHistory.length > 0 && (<>
              <button onClick={() => setHistIdx(i => i === null ? plotHistory.length - 1 : Math.max(0, i - 1))}
                style={{ padding: "2px 8px", borderRadius: 3, fontFamily: T.code.fontFamily, fontSize: T.caption.fontSize, background: "none", border: `1px solid ${C.border2}`, color: C.textMuted, cursor: "pointer" }}>←</button>
              <span style={{ fontFamily: T.code.fontFamily, fontSize: T.caption.fontSize, color: C.textMuted }}>
                {histIdx !== null ? `${histIdx + 1}/${plotHistory.length}` : `–/${plotHistory.length}`}
              </span>
              <button onClick={() => setHistIdx(i => i === null ? 0 : Math.min(plotHistory.length - 1, i + 1))}
                style={{ padding: "2px 8px", borderRadius: 3, fontFamily: T.code.fontFamily, fontSize: T.caption.fontSize, background: "none", border: `1px solid ${C.border2}`, color: C.textMuted, cursor: "pointer" }}>→</button>
            </>)}
            {pid && <button onClick={savePlot}
              style={{ padding: "2px 10px", borderRadius: 3, fontFamily: T.code.fontFamily, fontSize: T.caption.fontSize, background: `${C.teal}18`, border: `1px solid ${C.teal}60`, color: C.teal, cursor: "pointer" }}>Save</button>}
            <button onClick={newPlot}
              style={{ padding: "2px 8px", borderRadius: 3, fontFamily: T.code.fontFamily, fontSize: T.caption.fontSize, background: "none", border: `1px solid ${C.border2}`, color: C.textMuted, cursor: "pointer" }}>New</button>
            <button onClick={copyRScript} disabled={layers.length === 0} title="Copy current spatial plot as R/ggplot2 + sf"
              style={{ padding: "2px 8px", borderRadius: 3, fontFamily: T.code.fontFamily, fontSize: T.caption.fontSize,
                background: rCopied ? `${C.teal}18` : "none",
                border: `1px solid ${rCopied ? C.teal : C.border2}`,
                color: rCopied ? C.teal : layers.length > 0 ? C.textMuted : C.border,
                cursor: layers.length > 0 ? "pointer" : "not-allowed" }}>
              {rCopied ? "Copied ✓" : "R"}
            </button>
          </div>
        </div>
      </div>

      {/* Canvas + history */}
      <div ref={wrapRef} style={{ padding: "16px 20px", background: C.bg }}>
        {pltErr && <div style={{ color: C.red, fontFamily: T.code.fontFamily, fontSize: T.caption.fontSize, marginBottom: 8 }}>Observable Plot load error: {pltErr}</div>}
        {!Plt && !pltErr && <div style={{ color: C.textMuted, fontFamily: T.code.fontFamily, fontSize: T.caption.fontSize }}>Loading Observable Plot…</div>}
        {Plt && dLayers.length === 0 && (
          <div style={{ textAlign: "center", color: C.textMuted, fontFamily: T.code.fontFamily, fontSize: T.caption.fontSize, marginTop: 60 }}>
            Add a +Polygon / +Boundary / +Point / +Line / +Grid layer to build your map.
          </div>
        )}
        {Plt && dLayers.length > 0 && (
          <GeoPlotCanvas ref={geoPlotRef} Plt={Plt} layers={dLayers} rows={rows} availableDatasets={availableDatasets}
            title={dTitle} subtitle={dSubtitle} caption={dCaption} maxW={maxW}
            maxH={Math.max(420, (typeof window !== "undefined" ? window.innerHeight : 850) - 170)}
            forceH={userH ?? 0} basemap={basemap} C={C} />
        )}

        {/* History strip */}
        {plotHistory.length > 0 && (
          <div style={{ marginTop: 20 }}>
            <div style={{ display: "flex", alignItems: "center", gap: 8, paddingTop: 12, borderTop: `1px solid ${C.border}` }}>
              <span style={{ fontFamily: T.code.fontFamily, fontSize: T.caption.fontSize, color: C.textMuted, textTransform: "uppercase", letterSpacing: "0.15em" }}>Saved</span>
              <button onClick={() => setHistOpen(o => !o)}
                style={{ padding: "2px 8px", borderRadius: 3, fontFamily: T.code.fontFamily, fontSize: T.caption.fontSize, background: "none", border: `1px solid ${C.border2}`, color: C.textMuted, cursor: "pointer" }}>
                {histOpen ? "▲" : "▼"} {plotHistory.length}
              </button>
            </div>
            {histOpen && (
              <div style={{ display: "flex", flexWrap: "wrap", gap: 6, marginTop: 8 }}>
                {plotHistory.map((entry, i) => (
                  <div key={entry.id} onClick={() => setHistIdx(histIdx === i ? null : i)}
                    style={{ display: "flex", alignItems: "center", gap: 6, padding: "4px 10px", borderRadius: 4, cursor: "pointer",
                      background: histIdx === i ? `${C.teal}15` : C.surface,
                      border: `1px solid ${histIdx === i ? C.teal + "50" : C.border2}` }}
                  >
                    <input type="checkbox" checked={compareIds.has(entry.id)} onClick={e => e.stopPropagation()}
                      onChange={e => setCompareIds(prev => { const s = new Set(prev); e.target.checked ? s.add(entry.id) : s.delete(entry.id); return s; })}
                      style={{ accentColor: C.teal, cursor: "pointer" }} />
                    <span style={{ fontFamily: T.code.fontFamily, fontSize: T.caption.fontSize, color: C.text }}>{entry.name}</span>
                    <button onClick={e => { e.stopPropagation(); deletePlot(entry.id); }}
                      style={{ background: "none", border: "none", cursor: "pointer", fontSize: T.code.fontSize, color: C.textMuted, padding: "0 0 0 2px", lineHeight: 1 }}>×</button>
                  </div>
                ))}
              </div>
            )}
            {comparePlots.length >= 2 && Plt && (
              <div style={{ display: "flex", gap: 16, flexWrap: "wrap", marginTop: 16 }}>
                {comparePlots.map(entry => (
                  <div key={entry.id} style={{ flex: "1 1 340px" }}>
                    <div style={{ fontFamily: T.code.fontFamily, fontSize: T.caption.fontSize, color: C.textMuted, marginBottom: 6 }}>{entry.name}</div>
                    <GeoPlotCanvas Plt={Plt} layers={entry.layers ?? []} rows={rows} availableDatasets={availableDatasets}
                      title={entry.title} subtitle={entry.subtitle} caption={entry.caption}
                      maxW={Math.max(240, (maxW - 32) / 2)}
                      forceH={userH ?? 0} C={C} />
                  </div>
                ))}
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
