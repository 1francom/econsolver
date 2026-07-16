// ─── ECON STUDIO · spatial/plot/GeoPlotCanvas.jsx ─ (moved verbatim from SpatialTab.jsx)
import { useEffect, useRef, forwardRef, useImperativeHandle } from "react";
import { parseWktRings } from "../shared/wkt.js";
import { buildColorScale } from "../shared/color.js";
import { BASEMAPS, lonToTx, latToTy, txToLon, tyToLat, pickTileZ } from "../shared/leaflet.js";
import { makeCabaMetricGrid } from "../shared/crs.js";
import { geoBbox, applyLayerFilter } from "./geo.js";
import { GEO_MARGIN, appendSvgLegend } from "./legend.js";
import { kde2d, polygonCentroid, transformCoord } from "../../../../math/SpatialEngine.js";
import { useTheme } from "../../../../ThemeContext.jsx";

export const GeoPlotCanvas = forwardRef(function GeoPlotCanvas(
  { Plt, layers, rows, availableDatasets, title, subtitle, caption,
    maxW = 700, maxH = 0, forceH = 0, basemap = "none", C },
  ref
) {
  const { T } = useTheme();
  const showTiles = basemap != null && basemap !== "none";
  const canvasRef  = useRef(null);
  const tileCanRef = useRef(null);
  const wrapperRef = useRef(null);
  // Track computed plot size for tile canvas positioning
  const dimsRef    = useRef({ plotW: 0, plotH: 0, svgW: 0, innerW: 0, innerH: 0, xMin: 0, xMax: 1, yMin: 0, yMax: 1 });

  useImperativeHandle(ref, () => ({
    // Composite export: tiles canvas (if present) + SVG on top → PNG download
    exportToPng: (filename = "geo_plot.png") => new Promise(resolve => {
      const svg = canvasRef.current?.querySelector("svg");
      if (!svg) { resolve(); return; }
      const { plotW, plotH, svgW = plotW } = dimsRef.current;
      if (!plotW || !plotH) { resolve(); return; }
      const scale = 2;

      // Compute vertical space for title/subtitle and caption (drawn on canvas, not in SVG)
      const TH = (title ? 22 : 0) + (subtitle ? 18 : 0) + (title || subtitle ? 6 : 0);
      const BH = caption ? 22 : 0;
      const totalH = plotH + TH + BH;

      const canvas = document.createElement("canvas");
      canvas.width  = svgW * scale;
      canvas.height = totalH * scale;
      const ctx = canvas.getContext("2d");

      // Background
      ctx.fillStyle = showTiles ? "#f5f3f0" : (C?.bg ?? "#0e1117");
      ctx.fillRect(0, 0, canvas.width, canvas.height);

      // Draw title / subtitle text directly on canvas
      ctx.save();
      ctx.scale(scale, scale);
      const textColor = showTiles ? "#111" : (C?.text ?? "#c8c8c8");
      const mutedColor = showTiles ? "#555" : (C?.textMuted ?? "#8a9ab0");
      if (title) {
        ctx.font = `bold ${T.h2.fontSize} serif`;
        ctx.fillStyle = textColor;
        ctx.textAlign = "center";
        ctx.textBaseline = "alphabetic";
        ctx.fillText(title, svgW / 2, 20);
      }
      if (subtitle) {
        ctx.font = `${T.caption.fontSize} serif`;
        ctx.fillStyle = mutedColor;
        ctx.textAlign = "center";
        ctx.fillText(subtitle, svgW / 2, title ? 40 : 20);
      }
      // Caption at bottom
      if (caption) {
        ctx.font = `${T.caption.fontSize} serif`;
        ctx.fillStyle = mutedColor;
        ctx.textAlign = "right";
        ctx.fillText(caption, svgW - 8, totalH - 6);
      }
      ctx.restore();

      const drawSvgLayer = () => {
        const svgStr  = new XMLSerializer().serializeToString(svg);
        const svgBlob = new Blob([svgStr], { type: "image/svg+xml;charset=utf-8" });
        const svgUrl  = URL.createObjectURL(svgBlob);
        const img = new Image();
        img.onload = () => {
          // SVG drawn below title area
          ctx.drawImage(img, 0, TH * scale, svgW * scale, plotH * scale);
          URL.revokeObjectURL(svgUrl);
          const a = document.createElement("a");
          a.href = canvas.toDataURL("image/png");
          a.download = filename;
          a.click();
          resolve();
        };
        img.onerror = () => { URL.revokeObjectURL(svgUrl); resolve(); };
        img.src = svgUrl;
      };

      // Draw tile canvas first if tiles are shown (offset by TH so it aligns with the map in the SVG)
      const tileCanvas = tileCanRef.current;
      if (showTiles && tileCanvas && tileCanvas.width > 0) {
        try { ctx.drawImage(tileCanvas, 0, TH * scale, plotW * scale, plotH * scale); } catch (err) { void err; }
        drawSvgLayer();
      } else {
        drawSvgLayer();
      }
    }),
    exportToPdf: () => {
      const svg = canvasRef.current?.querySelector("svg");
      if (!svg) return;
      const { plotW, plotH, svgW = plotW } = dimsRef.current;
      const svgStr  = new XMLSerializer().serializeToString(svg);
      const blob    = new Blob([svgStr], { type: "image/svg+xml;charset=utf-8" });
      const blobUrl = URL.createObjectURL(blob);
      const iframe  = document.createElement("iframe");
      iframe.style.cssText = `position:fixed;top:-9999px;left:-9999px;width:${svgW}px;height:${plotH}px;border:none;`;
      iframe.src = blobUrl;
      iframe.onload = () => {
        try { iframe.contentWindow.print(); } catch (err) { void err; alert("PDF export: use the browser print dialog."); }
        setTimeout(() => { URL.revokeObjectURL(blobUrl); document.body.removeChild(iframe); }, 2000);
      };
      document.body.appendChild(iframe);
    },
  }), [basemap, C?.bg, title, subtitle, caption, T.caption.fontSize, T.h2.fontSize]);

  useEffect(() => {
    if (!Plt || !canvasRef.current || layers.length === 0) return;
    const el = canvasRef.current;
    while (el.firstChild) el.removeChild(el.firstChild);

    const [xMin, xMax, yMin, yMax] = geoBbox(layers, rows, availableDatasets);
    const midLat = (yMin + yMax) / 2;
    const cosLat = Math.max(0.1, Math.cos(midLat * Math.PI / 180));
    const plotLegend = (() => {
      for (const ly of [...layers].reverse()) {
        if (!ly.visible) continue;
        const r = applyLayerFilter(
          (!ly.datasetId || ly.datasetId === "active") ? rows : availableDatasets.find(d => d.id === ly.datasetId)?.rows ?? rows,
          ly
        );
        const fillCol = ly.fillByCol ?? ly.colorByCol;
        if ((ly.type === "grid" || ly.type === "polygon") && ly.mode !== "boundary" && fillCol) return buildColorScale(r, fillCol, ly.palette).legend;
        if (ly.type === "point" && ly.colorCol) return buildColorScale(r, ly.colorCol, ly.palette).legend;
        if (ly.type === "heatmap" && ly.latCol && ly.lonCol) return buildColorScale(kde2d(r, ly.latCol, ly.lonCol, { bandwidth: ly.bandwidth, gridN: ly.gridN }).rows, "density", ly.palette).legend;
      }
      return null;
    })();
    const legendW = plotLegend ? 160 : 0;

    // Compute dimensions: preserve geographic aspect ratio within maxW × maxH.
    // When height is constrained (by maxH or forceH), shrink width accordingly.
    const xRange = xMax - xMin, yRange = yMax - yMin;
    const ML = GEO_MARGIN.left, MR = GEO_MARGIN.right, MT = GEO_MARGIN.top, MB = GEO_MARGIN.bottom;
    const innerMaxW = Math.max(160, maxW - legendW - ML - MR);
    // idealH = height needed for full width at correct aspect ratio (cosLat correction)
    const idealH    = Math.round(innerMaxW * (yRange / Math.max(xRange, 1e-9)) / cosLat) + MT + MB;
    let plotW, plotH;
    const effectiveMaxH = maxH > 0 ? maxH : Infinity;
    if (forceH > 0) {
      plotH = Math.min(forceH, effectiveMaxH === Infinity ? forceH : effectiveMaxH);
    } else {
      plotH = Math.min(Math.max(idealH, 180), effectiveMaxH === Infinity ? Math.max(idealH, 180) : effectiveMaxH);
    }
    // Back-compute plotW from plotH to maintain correct aspect ratio
    const innerH    = Math.max(1, plotH - MT - MB);
    const idealInnerW = Math.round(innerH * (xRange / Math.max(yRange, 1e-9)) * cosLat);
    const innerW    = Math.min(idealInnerW, innerMaxW);
    plotW = innerW + ML + MR;
    const svgW = plotW + legendW;
    dimsRef.current = { plotW, plotH, svgW, innerW, innerH, xMin, xMax, yMin, yMax };

    const marks = [Plt.frame({ stroke: C?.border ?? "#2e3340", strokeWidth: 0.5 })];

    for (const ly of layers) {
      if (!ly.visible) continue;
      const r = applyLayerFilter(
        (!ly.datasetId || ly.datasetId === "active") ? rows : availableDatasets.find(d => d.id === ly.datasetId)?.rows ?? rows,
        ly
      );
      if (ly.type === "point" && ly.mode === "wkt" && ly.wktCol) {
        const ptData = r.flatMap(row => {
          const p = parseWktRings(row[ly.wktCol]);
          return p?.type === "point" ? [{ ...row, _lon: p.rings[0][0][0], _lat: p.rings[0][0][1] }] : [];
        });
        const { getColor: getPtColor } = buildColorScale(ptData, ly.colorCol, ly.palette);
        marks.push(Plt.dot(ptData, {
          x: d => d._lon, y: d => d._lat,
          fill: ly.colorCol ? (d => getPtColor(d) ?? ly.fill ?? "#6ec8b4") : (ly.fill ?? "#6ec8b4"),
          r: ly.radius ?? 4,
          fillOpacity: ly.fillOpacity ?? 0.78, stroke: "none",
        }));
      } else if (ly.type === "point" && ly.latCol && ly.lonCol) {
        const ptRows = r.filter(row => !isNaN(parseFloat(row[ly.latCol])) && !isNaN(parseFloat(row[ly.lonCol])));
        const { getColor: getPtColor } = buildColorScale(ptRows, ly.colorCol, ly.palette);
        marks.push(Plt.dot(ptRows, {
          x: row => parseFloat(row[ly.lonCol]), y: row => parseFloat(row[ly.latCol]),
          fill: ly.colorCol ? (row => getPtColor(row) ?? ly.fill ?? "#6ec8b4") : (ly.fill ?? "#6ec8b4"),
          r: ly.radius ?? 4,
          fillOpacity: ly.fillOpacity ?? 0.78, stroke: "none",
        }));
      } else if (ly.type === "heatmap" && ly.latCol && ly.lonCol) {
        const kde = kde2d(r, ly.latCol, ly.lonCol, {
          bandwidth: Number(ly.bandwidth) || undefined,
          gridN: Number(ly.gridN) || 45,
        });
        const { getColor } = buildColorScale(kde.rows, "density", ly.palette);
        const xStep = kde.x.length > 1 ? Math.abs(kde.x[1] - kde.x[0]) : 1;
        const yStep = kde.y.length > 1 ? Math.abs(kde.y[1] - kde.y[0]) : 1;
        const toLonLat = (x, y) => transformCoord(x, y, kde.metricCrs, "EPSG:4326");
        const cells = kde.rows.map(cell => {
          const [west] = toLonLat(cell.x - xStep / 2, cell.y);
          const [east] = toLonLat(cell.x + xStep / 2, cell.y);
          const [, south] = toLonLat(cell.x, cell.y - yStep / 2);
          const [, north] = toLonLat(cell.x, cell.y + yStep / 2);
          return { ...cell, x1: west, x2: east, y1: south, y2: north };
        });
        marks.push(Plt.rect(cells, {
          x1: d => d.x1, x2: d => d.x2, y1: d => d.y1, y2: d => d.y2,
          fill: d => getColor(d) ?? "#6ec8b4",
          fillOpacity: ly.fillOpacity ?? 0.72,
          stroke: "none",
        }));
      } else if (ly.type === "grid" && ly.mode === "wkt" && ly.wktCol) {
        const fillCol = ly.fillByCol ?? ly.colorByCol;
        const { getColor } = buildColorScale(r, fillCol, ly.palette);
        const labels = [];
        for (const row of r) {
          const parsed = parseWktRings(row[ly.wktCol]);
          if (!parsed) continue;
          const fill = fillCol ? (getColor(row) ?? ly.fill ?? "none") : (ly.fill ?? "none");
          const fillOpacity = fillCol ? (ly.colorFillOpacity ?? 0.65) : (ly.fillOpacity ?? 0.08);
          for (const ring of parsed.rings) {
            if (ring.length < 2) continue;
            marks.push(Plt.line([...ring, ring[0]], {
              x: d => d[0], y: d => d[1],
              fill,
              fillOpacity,
              stroke: ly.stroke ?? "#888", strokeWidth: ly.strokeWidth ?? 0.3,
              strokeLinejoin: "round", strokeLinecap: "round",
            }));
          }
          if (ly.labelCol && row[ly.labelCol] != null) {
            const cent = polygonCentroid([row], ly.wktCol)[0];
            if (Number.isFinite(cent?.centroid_lon) && Number.isFinite(cent?.centroid_lat)) {
              labels.push({ lon: cent.centroid_lon, lat: cent.centroid_lat, label: String(row[ly.labelCol]) });
            }
          }
        }
        if (labels.length) {
          marks.push(Plt.text(labels, {
            x: "lon", y: "lat", text: "label",
            fill: ly.labelColor ?? C?.text ?? "#222",
            fontSize: ly.labelSize ?? 10,
            textAnchor: "middle",
            dy: "0.32em",
          }));
        }
      } else if (ly.type === "grid" && (ly.mode ?? "boundary") === "boundary" && ly.boundaryCol) {
        try {
          const col = ly.boundaryCol;
          const boundaries = r.map(row => row[col]).filter(Boolean);
          for (const boundaryWkt of boundaries) {
            const cells = makeCabaMetricGrid(boundaryWkt, Number(ly.cellsize) || 500, ly.clipBorder !== false);
            for (const cell of cells) {
              const parsed = parseWktRings(cell.geometry);
              if (!parsed) continue;
              for (const ring of parsed.rings) {
                if (ring.length < 2) continue;
                marks.push(Plt.line([...ring, ring[0]], {
                  x: d => d[0], y: d => d[1],
                  fill: "none",
                  stroke: ly.stroke ?? "#888", strokeWidth: ly.strokeWidth ?? 0.3,
                  strokeLinejoin: "round", strokeLinecap: "round",
                }));
              }
            }
          }
        } catch (err) { void err; }
      } else if (ly.type === "grid" && (ly.mode ?? "boundary") === "latlon" && ly.latCol && ly.lonCol) {
        try {
          const lats = r.map(row => parseFloat(row[ly.latCol])).filter(v => !isNaN(v));
          const lons = r.map(row => parseFloat(row[ly.lonCol])).filter(v => !isNaN(v));
          if (lats.length && lons.length) {
            const pad = 0.0001;
            const lat0 = Math.min(...lats) - pad, lat1 = Math.max(...lats) + pad;
            const lon0 = Math.min(...lons) - pad, lon1 = Math.max(...lons) + pad;
            const bboxWkt = `POLYGON((${lon0} ${lat0}, ${lon1} ${lat0}, ${lon1} ${lat1}, ${lon0} ${lat1}, ${lon0} ${lat0}))`;
            const cells = makeCabaMetricGrid(bboxWkt, Number(ly.cellsize) || 500, false);
            for (const cell of cells) {
              const parsed = parseWktRings(cell.geometry);
              if (!parsed) continue;
              for (const ring of parsed.rings) {
                if (ring.length < 2) continue;
                marks.push(Plt.line([...ring, ring[0]], {
                  x: d => d[0], y: d => d[1],
                  fill: ly.fill ?? "none", fillOpacity: ly.fillOpacity ?? 0.35,
                  stroke: ly.stroke ?? "#888", strokeWidth: ly.strokeWidth ?? 0.3,
                  strokeLinejoin: "round",
                }));
              }
            }
          }
        } catch (err) { void err; }
      } else if (ly.wktCol) {
        const fillCol = ly.fillByCol ?? ly.colorByCol;
        const { getColor } = buildColorScale(r, fillCol, ly.palette);
        const labels = [];
        for (const row of r) {
          const parsed = parseWktRings(row[ly.wktCol]);
          if (!parsed) continue;
          for (const ring of parsed.rings) {
            if (ring.length < 2) continue;
            const closed = parsed.type === "polygon" ? [...ring, ring[0]] : ring;
            marks.push(Plt.line(closed, {
              x: d => d[0], y: d => d[1],
              fill: (parsed.type === "polygon" && ly.fill !== "none") ? (fillCol ? (getColor(row) ?? ly.fill ?? "none") : (ly.fill ?? "none")) : "none",
              fillOpacity: fillCol ? (ly.colorFillOpacity ?? 0.65) : (ly.fillOpacity ?? 0),
              stroke: ly.stroke ?? "#333", strokeWidth: ly.strokeWidth ?? 0.8,
              strokeLinejoin: "round", strokeLinecap: "round",
            }));
          }
          if (parsed.type === "polygon" && ly.labelCol && row[ly.labelCol] != null) {
            const cent = polygonCentroid([row], ly.wktCol)[0];
            if (Number.isFinite(cent?.centroid_lon) && Number.isFinite(cent?.centroid_lat)) {
              labels.push({ lon: cent.centroid_lon, lat: cent.centroid_lat, label: String(row[ly.labelCol]) });
            }
          }
        }
        if (labels.length) {
          marks.push(Plt.text(labels, {
            x: "lon", y: "lat", text: "label",
            fill: ly.labelColor ?? C?.text ?? "#222",
            fontSize: ly.labelSize ?? 10,
            textAnchor: "middle",
            dy: "0.32em",
          }));
        }
      }
    }

    try {
      const svg = Plt.plot({
        width: plotW, height: plotH,
        marginTop: MT, marginRight: MR, marginBottom: MB, marginLeft: ML,
        style: { background: showTiles ? "transparent" : (C?.bg ?? "#0e1117"), color: C?.text ?? "#c8c8c8", fontFamily: "serif", fontSize: T.caption.fontSize },
        x: { domain: [xMin, xMax], label: null, nice: false, grid: true,
             tickFormat: d => d < 0 ? `${Math.abs(d).toFixed(2)}°W` : `${d.toFixed(2)}°E` },
        y: { domain: [yMin, yMax], label: null, nice: false, grid: true,
             tickFormat: d => d < 0 ? `${Math.abs(d).toFixed(2)}°S` : `${d.toFixed(2)}°N` },
        marks,
      });
      appendSvgLegend(svg, plotLegend, C, plotW, plotH, legendW);
      el.appendChild(svg);
    } catch (e) {
      const errDiv = document.createElement("div");
      errDiv.style.cssText = `color:${C?.red ?? "#c47070"};font-family:monospace;font-size:${T.caption.fontSize};padding:8px`;
      errDiv.textContent = e.message;
      el.appendChild(errDiv);
    }

    // ── Draw CARTO tiles on the tile canvas ──────────────────────────────────
    if (showTiles && tileCanRef.current) {
      const tc = tileCanRef.current;
      tc.width  = plotW;
      tc.height = plotH;
      const ctx = tc.getContext("2d");
      ctx.fillStyle = C?.bg ?? "#0e1117"; // theme background
      ctx.fillRect(0, 0, plotW, plotH);

      const lonToPx = lon => ML + (lon - xMin) / (xMax - xMin) * innerW;
      const latToPy = lat => MT + (yMax - lat) / (yMax - yMin) * innerH;
      const z = pickTileZ(xMax - xMin, yMax - yMin);
      const tx0 = lonToTx(xMin, z), tx1 = lonToTx(xMax, z);
      const ty0 = latToTy(yMax, z), ty1 = latToTy(yMin, z);

      for (let tx = tx0; tx <= tx1; tx++) {
        for (let ty = ty0; ty <= ty1; ty++) {
          const lon0 = txToLon(tx,   z), lon1 = txToLon(tx + 1, z);
          const lat1 = tyToLat(ty,   z), lat0 = tyToLat(ty + 1, z); // lat1 > lat0
          const px0 = lonToPx(lon0), px1 = lonToPx(lon1);
          const py0 = latToPy(lat1), py1 = latToPy(lat0);
          const tcfg = BASEMAPS[basemap] ?? BASEMAPS.light;
          const url = tcfg.url
            .replace("{s}", "a")
            .replace("{z}", String(z))
            .replace("{x}", String(tx))
            .replace("{y}", String(ty))
            .replace("{r}", "");
          const img = new Image();
          img.crossOrigin = "anonymous";
          img.onload = () => { try { ctx.drawImage(img, px0, py0, px1 - px0, py1 - py0); } catch (err) { void err; } };
          img.onerror = () => undefined;
          img.src = url;
        }
      }
    }

    return () => { while (el.firstChild) el.removeChild(el.firstChild); };
  }, [Plt, layers, rows, availableDatasets, title, subtitle, caption, maxW, maxH, forceH, basemap, C, T.caption.fontSize]);

  return (
    <div ref={wrapperRef} style={{ fontFamily: "serif", color: C?.text ?? "#c8c8c8", background: C?.bg ?? "#0e1117", padding: "12px 8px 8px", borderRadius: 4, border: `1px solid ${C?.border ?? "#2e3340"}` }}>
      {title    && <div style={{ textAlign: "center", fontSize: T.h2.fontSize, fontWeight: "bold", marginBottom: 2 }}>{title}</div>}
      {subtitle && <div style={{ textAlign: "center", fontSize: T.caption.fontSize, color: C?.textMuted ?? "#8a9ab0", marginBottom: 6 }}>{subtitle}</div>}
      <div style={{ position: "relative" }}>
        {showTiles && <canvas ref={tileCanRef} style={{ position: "absolute", top: 0, left: 0, pointerEvents: "none" }} />}
        <div ref={canvasRef} style={{ position: "relative", textAlign: "center" }} />
      </div>
      {caption  && <div style={{ textAlign: "right", fontSize: T.caption.fontSize, color: C?.textMuted ?? "#5a6880", marginTop: 4 }}>{caption}</div>}
    </div>
  );
});
