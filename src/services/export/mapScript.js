import { toDfVar } from "../../pipeline/exporter.js";
import { buildPyLoadLine, buildRLoadLine } from "./loadLine.js";

const R_BASEMAPS = {
  light: "addProviderTiles(providers$CartoDB.Positron)",
  dark: "addProviderTiles(providers$CartoDB.DarkMatter)",
  osm: "addTiles()",
};

const PY_BASEMAPS = {
  light: "CartoDB positron",
  dark: "CartoDB dark_matter",
  osm: "OpenStreetMap",
};

function visibleLayers(mapEntry) {
  return (Array.isArray(mapEntry?.layers) ? mapEntry.layers : [])
    .filter(layer => layer?.visible !== false);
}

function datasetInfo(layer, datasets) {
  if (!layer?.datasetId || layer.datasetId === "active") {
    return { dfVar: "df", dataset: null };
  }
  const dataset = datasets.find(item => item.id === layer.datasetId) ?? null;
  return {
    dfVar: toDfVar(dataset?.name ?? dataset?.filename ?? layer.datasetId),
    dataset,
  };
}

function layerKey(layer, index) {
  const raw = layer?.id || `${layer?.type || "layer"}_${index + 1}`;
  return String(raw).replace(/[^a-zA-Z0-9_]/g, "_").replace(/^[0-9]/, "_$&");
}

function hasWkt(layer) {
  if (layer?.type === "boundary" || layer?.type === "line") return Boolean(layer.wktCol);
  return (layer?.type === "grid" || layer?.type === "points")
    && layer.mode === "wkt" && Boolean(layer.wktCol);
}

function rString(value) {
  return `"${String(value ?? "").replace(/\\/g, "\\\\").replace(/"/g, '\\"')}"`;
}

function rColumn(value) {
  return `\`${String(value ?? "").replace(/`/g, "\\`")}\``;
}

function pyString(value) {
  return JSON.stringify(String(value ?? ""));
}

function scriptNumber(value, fallback) {
  const number = Number(value);
  return Number.isFinite(number) ? String(number) : String(fallback);
}

function externalDatasets(layers, datasets) {
  const ids = [...new Set(layers
    .map(layer => layer?.datasetId)
    .filter(datasetId => datasetId && datasetId !== "active"))];
  return ids.map(datasetId => {
    const dataset = datasets.find(item => item.id === datasetId) ?? null;
    const name = dataset?.name ?? dataset?.filename ?? datasetId;
    return { datasetId, dataset, dfVar: toDfVar(name) };
  });
}

function rLoadLines(layers, datasets) {
  const lines = [];
  externalDatasets(layers, datasets).forEach(({ datasetId, dataset, dfVar }) => {
    const filename = dataset?.filename ?? "";
    lines.push(`# load ${dfVar} from ${rString(filename || dataset?.name || datasetId)}`);
    if (filename) {
      lines.push(buildRLoadLine(filename, dataset?.loadOpts ?? null).replace(/^df\b/, dfVar));
    }
  });
  return lines;
}

function pyLoadLines(layers, datasets) {
  const lines = [];
  externalDatasets(layers, datasets).forEach(({ datasetId, dataset, dfVar }) => {
    const filename = dataset?.filename ?? "";
    lines.push(`# load ${dfVar} from ${pyString(filename || dataset?.name || datasetId)}`);
    if (filename) {
      lines.push(buildPyLoadLine(filename, dataset?.loadOpts ?? null)
        .replace(/^df\b/, dfVar)
        .replace(/\bgeopandas\./g, "gpd."));
    }
  });
  return lines;
}

function rPalette(prep, key, dfVar, column) {
  const palette = `pal_${key}`;
  const col = rColumn(column);
  prep.push(
    `${palette} <- if (is.numeric(${dfVar}[[${rString(column)}]])) {`,
    `  colorNumeric("viridis", domain = ${dfVar}[[${rString(column)}]], na.color = "transparent")`,
    `} else {`,
    `  colorFactor("viridis", domain = ${dfVar}[[${rString(column)}]], na.color = "transparent")`,
    `}`,
  );
  return `~${palette}(${col})`;
}

function rGridComment(layer) {
  return `# grid cells were generated in Litux (cellsize=${scriptNumber(layer.cellsize, 500)} m); export the grid dataset and load it`;
}

export function buildLeafletR(mapEntry, { datasets = [] } = {}) {
  const entry = mapEntry ?? {};
  const layers = visibleLayers(entry);
  const prep = [];
  const comments = [];
  const components = [R_BASEMAPS[entry.basemap] ?? R_BASEMAPS.light];
  const needsSf = layers.some(hasWkt);

  layers.forEach((layer, index) => {
    const { dfVar } = datasetInfo(layer, datasets);
    const key = layerKey(layer, index);

    if (layer.type === "grid" && layer.mode !== "wkt") {
      comments.push(rGridComment(layer));
      return;
    }

    if (hasWkt(layer)) {
      const sfVar = `${dfVar}_${key}_sf`;
      prep.push(`${sfVar} <- sf::st_as_sf(${dfVar}, wkt = ${rString(layer.wktCol)}, crs = 4326, remove = FALSE)`);

      if (layer.type === "line") {
        components.push(`addPolylines(data = ${sfVar}, color = ${rString(layer.lineColor ?? "black")}, weight = ${scriptNumber(layer.lineWeight, 1.5)}, opacity = ${scriptNumber(layer.lineOpacity, 0.85)})`);
        return;
      }

      if (layer.type === "points") {
        const color = layer.colorCol
          ? rPalette(prep, key, sfVar, layer.colorCol)
          : rString(layer.fillColor ?? "steelblue");
        components.push(`addCircleMarkers(data = ${sfVar}, radius = ${scriptNumber(layer.radius, 4)}, color = ${color}, fillColor = ${color}, fillOpacity = ${scriptNumber(layer.opacity, 0.78)})`);
        return;
      }

      const fillColor = layer.colorByCol
        ? rPalette(prep, key, sfVar, layer.colorByCol)
        : rString(layer.fillColor ?? "grey");
      components.push(`addPolygons(data = ${sfVar}, fillColor = ${fillColor}, color = ${rString(layer.borderColor ?? "black")}, weight = ${scriptNumber(layer.borderWidth, 0.5)}, fillOpacity = ${scriptNumber(layer.colorByCol ? layer.colorFillOpacity : layer.fillOpacity, 0.12)})`);
      return;
    }

    if (layer.type === "points" && layer.latCol && layer.lonCol) {
      const color = layer.colorCol
        ? rPalette(prep, key, dfVar, layer.colorCol)
        : rString(layer.fillColor ?? "steelblue");
      components.push(`addCircleMarkers(data = ${dfVar}, lng = ~${rColumn(layer.lonCol)}, lat = ~${rColumn(layer.latCol)}, radius = ${scriptNumber(layer.radius, 4)}, color = ${color}, fillColor = ${color}, fillOpacity = ${scriptNumber(layer.opacity, 0.78)})`);
    }
  });

  if (entry.crsInput?.trim()) {
    comments.unshift(`# Litux displayed this map with CRS ${rString(entry.crsInput)}; verify exported coordinates are EPSG:4326.`);
  }

  const lines = ["library(leaflet)"];
  if (needsSf) lines.push("library(sf)");
  lines.push("library(dplyr)");
  const loads = rLoadLines(layers, datasets);
  if (loads.length) lines.push("", ...loads);
  if (comments.length) lines.push("", ...comments);
  if (prep.length) lines.push("", ...prep);
  lines.push("", `map <- leaflet() %>%`, ...components.map((component, index) => (
    `  ${component}${index < components.length - 1 ? " %>%" : ""}`
  )), "", "map");
  return lines.join("\n");
}

function pyPalette(prep, key, dfVar, column) {
  const palette = `color_${key}`;
  prep.push(`${palette} = _litux_colorizer(${dfVar}[${pyString(column)}])`);
  return palette;
}

function pyGridComment(layer) {
  return `# grid cells were generated in Litux (cellsize=${scriptNumber(layer.cellsize, 500)} m); export the grid dataset and load it`;
}

function pyColorHelper() {
  return [
    "def _litux_colorizer(series):",
    "    values = series.dropna()",
    "    if pd.api.types.is_numeric_dtype(values):",
    "        if values.empty:",
    "            return lambda value: \"#808080\"",
    "        low, high = float(values.min()), float(values.max())",
    "        palette = linear.Viridis_09.scale(low, high if high > low else low + 1)",
    "        return lambda value: palette(value) if pd.notna(value) else \"#00000000\"",
    "    colors = [\"#440154\", \"#3b528b\", \"#21918c\", \"#5ec962\", \"#fde725\"]",
    "    mapping = {value: colors[index % len(colors)] for index, value in enumerate(values.unique())}",
    "    return lambda value: mapping.get(value, \"#808080\")",
  ];
}

export function buildFoliumPy(mapEntry, { datasets = [] } = {}) {
  const entry = mapEntry ?? {};
  const layers = visibleLayers(entry);
  const prep = [];
  const comments = [];
  const body = [];
  const needsGpd = layers.some(hasWkt) || externalDatasets(layers, datasets).some(({ dataset }) => (
    /\.(shp|dbf|zip)$/i.test(dataset?.filename ?? "")
  ));
  const needsPalette = layers.some(layer => layer.colorByCol || layer.colorCol);
  const centerLayer = layers.find(layer => (
    layer.type === "points" && layer.mode !== "wkt" && layer.latCol && layer.lonCol
  ));
  const centerDf = centerLayer ? datasetInfo(centerLayer, datasets).dfVar : null;
  const center = centerLayer
    ? `[${centerDf}[${pyString(centerLayer.latCol)}].mean(), ${centerDf}[${pyString(centerLayer.lonCol)}].mean()]`
    : "[20, 0]";

  layers.forEach((layer, index) => {
    const { dfVar } = datasetInfo(layer, datasets);
    const key = layerKey(layer, index);

    if (layer.type === "grid" && layer.mode !== "wkt") {
      comments.push(pyGridComment(layer));
      return;
    }

    if (hasWkt(layer)) {
      const geoVar = `${dfVar}_${key}_geo`;
      prep.push(`${geoVar} = gpd.GeoDataFrame(${dfVar}.copy(), geometry=gpd.GeoSeries.from_wkt(${dfVar}[${pyString(layer.wktCol)}]), crs="EPSG:4326")`);

      if (layer.type === "line") {
        body.push(
          `folium.GeoJson(${geoVar}.__geo_interface__, style_function=lambda feature: {`,
          `    "color": ${pyString(layer.lineColor ?? "black")},`,
          `    "weight": ${scriptNumber(layer.lineWeight, 1.5)},`,
          `    "opacity": ${scriptNumber(layer.lineOpacity, 0.85)},`,
          `}).add_to(m)`,
        );
        return;
      }

      const colorCol = layer.type === "points" ? layer.colorCol : layer.colorByCol;
      const palette = colorCol ? pyPalette(prep, key, geoVar, colorCol) : null;
      const fixedColor = layer.type === "points"
        ? layer.fillColor ?? "steelblue"
        : layer.fillColor ?? "grey";
      const fillOpacity = layer.type === "points"
        ? layer.opacity
        : layer.colorByCol ? layer.colorFillOpacity : layer.fillOpacity;
      body.push(
        `folium.GeoJson(${geoVar}.__geo_interface__, style_function=lambda feature: {`,
        `    "fillColor": ${palette ? `${palette}(feature["properties"].get(${pyString(colorCol)}))` : pyString(fixedColor)},`,
        `    "color": ${pyString(layer.type === "points" ? fixedColor : layer.borderColor ?? "black")},`,
        `    "weight": ${scriptNumber(layer.type === "points" ? 1 : layer.borderWidth, 0.5)},`,
        `    "fillOpacity": ${scriptNumber(fillOpacity, 0.12)},`,
        `}).add_to(m)`,
      );
      return;
    }

    if (layer.type === "points" && layer.latCol && layer.lonCol) {
      const palette = layer.colorCol ? pyPalette(prep, key, dfVar, layer.colorCol) : null;
      const rowColor = palette ? `${palette}(row[${pyString(layer.colorCol)}])` : pyString(layer.fillColor ?? "steelblue");
      body.push(
        `for _, row in ${dfVar}.iterrows():`,
        `    folium.CircleMarker(`,
        `        [row[${pyString(layer.latCol)}], row[${pyString(layer.lonCol)}]],`,
        `        radius=${scriptNumber(layer.radius, 4)}, color=${rowColor}, fill=True,`,
        `        fill_color=${rowColor}, fill_opacity=${scriptNumber(layer.opacity, 0.78)},`,
        `    ).add_to(m)`,
      );
    }
  });

  if (entry.crsInput?.trim()) {
    comments.unshift(`# Litux displayed this map with CRS ${pyString(entry.crsInput)}; verify exported coordinates are EPSG:4326.`);
  }

  const lines = ["import folium", "import pandas as pd"];
  if (needsGpd) lines.push("import geopandas as gpd");
  if (needsPalette) lines.push("from branca.colormap import linear");
  const loads = pyLoadLines(layers, datasets);
  if (loads.length) lines.push("", ...loads);
  if (needsPalette) lines.push("", ...pyColorHelper());
  if (comments.length) lines.push("", ...comments);
  if (prep.length) lines.push("", ...prep);
  lines.push("", `m = folium.Map(location=${center}, tiles=${pyString(PY_BASEMAPS[entry.basemap] ?? PY_BASEMAPS.light)})`);
  if (body.length) lines.push("", ...body);
  lines.push("", "m");
  return lines.join("\n");
}
