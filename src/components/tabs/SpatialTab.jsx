// ─── ECON STUDIO · SpatialTab.jsx ────────────────────────────────────────────
// Spatial analytics module — Phase 11.
// Sections: Distance · Buffer · Grid Assignment · Spatial Join · Nearest Neighbour · Geocode
// All operations call SpatialEngine.js (pure JS, no backend).

import { useState, useMemo, useCallback, useEffect } from "react";
import { useTheme } from "../../ThemeContext.jsx";
import { HintBox } from "../HelpSystem.jsx";
import { loadLeaflet } from "./spatial/shared/leaflet.js";
import { Section } from "./spatial/shared/atoms.jsx";
import { SpatialPlotTab } from "./spatial/map/SpatialPlotTab.jsx";
import { CRSTransformSection } from "./spatial/analyze/CRSTransformSection.jsx";
import { DistanceSection } from "./spatial/analyze/DistanceSection.jsx";
import { BufferSection } from "./spatial/analyze/BufferSection.jsx";
import { MetricBufferSection } from "./spatial/analyze/MetricBufferSection.jsx";
import { BufferExposureSection } from "./spatial/analyze/BufferExposureSection.jsx";
import { GridSection } from "./spatial/analyze/GridSection.jsx";
import { SpatialJoinSection } from "./spatial/analyze/SpatialJoinSection.jsx";
import { AggregateToGridSection } from "./spatial/analyze/AggregateToGridSection.jsx";
import { ArealInterpolateSection } from "./spatial/analyze/ArealInterpolateSection.jsx";
import { NearestNeighborSection } from "./spatial/analyze/NearestNeighborSection.jsx";
import { GeocodeSection } from "./spatial/analyze/GeocodeSection.jsx";
import { BoundaryDistanceSection } from "./spatial/analyze/BoundaryDistanceSection.jsx";
import { OutputPanel } from "./spatial/analyze/OutputPanel.jsx";
import { SpatialGeoPlot } from "./spatial/plot/SpatialGeoPlot.jsx";

// ─── MAIN COMPONENT ───────────────────────────────────────────────────────────

export default function SpatialTab({ rows = [], headers = [], availableDatasets = [], onAddDataset, pid }) {
  const { C, T } = useTheme();
  const [mainTab,     setMainTab]     = useState("analyze");
  const [pendingRows, setPendingRows] = useState(null);
  const [pendingCols, setPendingCols] = useState([]);
  const [pendingHeaders, setPendingHeaders] = useState(null);
  const [pendingKey, setPendingKey] = useState(null);

  const numericHeaders = useMemo(
    () => headers.filter(h => rows.slice(0, 20).some(r => typeof r[h] === "number")),
    [rows, headers]
  );

  // Eagerly preload Leaflet so Map Viewer and Plot tab open instantly.
  // loadLeaflet() is idempotent — uses window.L cache after first load.
  const hasRows = rows.length > 0;
  useEffect(() => {
    if (hasRows) loadLeaflet().catch(() => {});
  }, [hasRows]);

  const hasData = rows.length > 0 && headers.length > 0;

  // The tab receives post-pipeline rows for the active spatial dataset, while
  // availableDatasets is the raw manager mirror. Keep named selections for the
  // active dataset aligned with the same cleaned data used by "Active dataset".
  const spatialDatasets = useMemo(() => {
    if (!pid || !availableDatasets.length) return availableDatasets;
    let matched = false;
    const merged = availableDatasets.map(ds => {
      if (ds.id !== pid) return ds;
      matched = true;
      return { ...ds, rows, headers };
    });
    if (matched) return merged;
    return [{ id: pid, name: "Active dataset", filename: "Active dataset", rows, headers }, ...availableDatasets];
  }, [availableDatasets, pid, rows, headers]);

  // Key derived from the active dataset's column fingerprint.
  // When headers change (dataset switch), all section sub-components remount
  // so their useState() column selections reset to the new dataset's guesses.
  const sectionsKey = headers.join("\0");
  const visiblePendingRows = pendingKey === sectionsKey ? pendingRows : null;

  const handleResult = useCallback((resultRows, newCols, baseHeaders = null) => {
    setPendingRows(resultRows);
    setPendingCols(newCols);
    setPendingHeaders(baseHeaders);
    setPendingKey(sectionsKey);
  }, [sectionsKey]);

  function handleSave(name, resultRows) {
    const allHeaders = [...new Set([...(pendingHeaders ?? headers), ...pendingCols])];
    onAddDataset?.(name, resultRows, allHeaders);
    setPendingRows(null);
    setPendingCols([]);
    setPendingHeaders(null);
    setPendingKey(null);
  }

  return (
    <div style={{
      display: "flex", flexDirection: "column", height: "100%",
      fontFamily: T.code.fontFamily, color: C.text, overflow: "hidden",
    }}>
      <div style={{ padding: "0.75rem 1.2rem 0", flexShrink: 0 }}>
        <HintBox tips={[
          "Load a shapefile (.shp + .dbf) to map geographic boundaries",
          "Join your dataset to the shapefile by a common identifier column",
          "Spatial joins drop polygon geometry attributes by default; enable geometry only when you need to carry WKT forward",
          "Metric Buffers creates EPSG:32721 radius buffers from lat/lon points or counts points around grid centroids",
          "Choropleth maps color regions by any numeric variable",
          "Spatial statistics: Moran's I for spatial autocorrelation",
        ]} />
      </div>
      {/* ── Header + tab bar ── */}
      <div style={{
        padding: "0.6rem 1.2rem", borderBottom: `1px solid ${C.border}`,
        background: C.surface2, flexShrink: 0,
        display: "flex", alignItems: "center", gap: 12,
      }}>
        <span style={{ fontSize: T.caption.fontSize, color: C.teal, letterSpacing: "0.2em", textTransform: "uppercase" }}>
          Spatial Analytics
        </span>
        {hasData && (
          <span style={{ fontSize: T.caption.fontSize, color: C.textMuted }}>
            {rows.length.toLocaleString()} rows · {numericHeaders.length} numeric cols
          </span>
        )}
        {/* Tab toggle */}
        <div style={{ display: "flex", gap: 3, marginLeft: "auto" }}>
          {[["analyze", "Analyze"], ["map", "Map"], ["plot", "Plot"]].map(([tab, lbl]) => (
            <button key={tab} onClick={() => setMainTab(tab)}
              style={{
                padding: "3px 12px", borderRadius: 3, fontFamily: T.code.fontFamily, fontSize: T.caption.fontSize, cursor: "pointer",
                background: mainTab === tab ? `${C.teal}18` : "transparent",
                border: `1px solid ${mainTab === tab ? C.teal + "60" : C.border}`,
                color: mainTab === tab ? C.teal : C.textMuted,
              }}
            >{lbl}</button>
          ))}
        </div>
      </div>

      {/* ── No data guard ── */}
      {!hasData && (
        <div style={{
          flex: 1, display: "flex", flexDirection: "column", alignItems: "center",
          justifyContent: "center", gap: 10,
        }}>
          <div style={{ fontSize: T.h2.fontSize, color: C.border2 }}>⊙</div>
          <div style={{ fontSize: T.code.fontSize, color: C.textDim }}>No dataset active.</div>
          <div style={{ fontSize: T.caption.fontSize, color: C.textMuted }}>
            Run your pipeline in Clean → or load data in the Data tab.
          </div>
        </div>
      )}

      {/* ── Map tab (Leaflet layer builder) ── */}
      {hasData && mainTab === "map" && (
        <div style={{ flex: 1, overflow: "hidden" }}>
          <SpatialPlotTab
            rows={rows} headers={headers}
            availableDatasets={spatialDatasets}
            onAddDataset={onAddDataset}
            C={C}
            pid={pid}
          />
        </div>
      )}

      {/* ── Plot tab (ggplot2+sf style static map, with history) ── */}
      {hasData && mainTab === "plot" && (
        <div style={{ flex: 1, overflow: "hidden" }}>
          <SpatialGeoPlot
            rows={rows} headers={headers}
            availableDatasets={spatialDatasets}
            C={C}
            pid={pid}
          />
        </div>
      )}

      {/* ── Analyze sections ── */}
      {hasData && mainTab === "analyze" && (
        <div key={sectionsKey} style={{ flex: 1, overflowY: "auto", padding: "1.2rem 1.4rem", position: "relative" }}>
          <div style={{ display: "flex", flexDirection: "column", gap: 10, maxWidth: 860 }}>

            <Section title="Distance to Point" badge="haversine · km" C={C} defaultOpen>
              <DistanceSection rows={rows} headers={numericHeaders.length ? numericHeaders : headers} onResult={handleResult} C={C} />
            </Section>

            <Section title="CRS / EPSG Transformer" badge="4326 / 32721" C={C}>
              <CRSTransformSection rows={rows} headers={headers} onResult={handleResult} C={C} />
            </Section>

            <Section title="Buffer Indicator" badge="0 / 1 treatment" C={C}>
              <BufferSection rows={rows} headers={numericHeaders.length ? numericHeaders : headers} onResult={handleResult} C={C} />
            </Section>

            <Section title="Metric Buffers" badge="50m / 1km" C={C}>
              <MetricBufferSection
                rows={rows} headers={headers}
                availableDatasets={spatialDatasets}
                onResult={handleResult}
                C={C}
              />
            </Section>

            <Section title="Buffer Exposure" badge="dissolve / overlap" C={C}>
              <BufferExposureSection
                rows={rows} headers={headers}
                availableDatasets={spatialDatasets}
                onResult={handleResult}
                C={C}
              />
            </Section>

            <Section title="Grid Assignment" badge="existing grid / id" C={C}>
              <GridSection
                rows={rows}
                headers={headers}
                availableDatasets={spatialDatasets}
                onResult={handleResult}
                C={C}
              />
            </Section>

            <Section title="Areal Interpolation" badge="polygon x polygon" C={C}>
              <ArealInterpolateSection
                rows={rows} headers={headers}
                availableDatasets={spatialDatasets}
                C={C} onResult={handleResult}
              />
            </Section>

            <Section title="Spatial Join (point-in-polygon)" badge="requires polygon dataset" C={C}>
              <SpatialJoinSection
                rows={rows} headers={headers}
                availableDatasets={spatialDatasets}
                C={C} onResult={handleResult}
              />
            </Section>

            <Section title="Aggregate Points to Grid" badge="count / sum / mean / share" C={C}>
              <AggregateToGridSection
                rows={rows} headers={headers}
                availableDatasets={spatialDatasets}
                C={C} onResult={handleResult}
              />
            </Section>
            <Section title="Nearest Neighbour" badge="O(n × m) brute-force" C={C}>
              <NearestNeighborSection
                rows={rows} headers={numericHeaders.length ? numericHeaders : headers}
                availableDatasets={spatialDatasets}
                C={C} onResult={handleResult}
              />
            </Section>

            <Section title="Distance to Boundary" badge="Spatial RD running variable" C={C}>
              <BoundaryDistanceSection
                rows={rows} headers={numericHeaders.length ? numericHeaders : headers}
                availableDatasets={spatialDatasets}
                C={C} onResult={handleResult}
              />
            </Section>

            <Section title="Geocode — Address → Lat/Lon" badge="Photon · cached" C={C}>
              <GeocodeSection rows={rows} headers={headers} C={C} onResult={handleResult} />
            </Section>

          </div>

          {/* Sticky save bar — visible wherever the user is in the list */}
          {visiblePendingRows && (
            <div style={{ position: "sticky", bottom: 0, left: 0, right: 0, zIndex: 10, paddingTop: 8 }}>
              <OutputPanel
                pendingRows={visiblePendingRows}
                pendingCols={pendingCols}
                onSave={handleSave}
                C={C}
              />
            </div>
          )}
        </div>
      )}
    </div>
  );
}
