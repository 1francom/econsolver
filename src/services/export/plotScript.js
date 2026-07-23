// Deterministic PlotBuilder config -> R/ggplot2 translator.

import { toDfVar } from "../../pipeline/exporter.js";
import { buildPyLoadLine, buildRLoadLine } from "./loadLine.js";

const BREWER_SCHEMES = {
  dark2: "Dark2",
  set1: "Set1",
  set2: "Set2",
  paired: "Paired",
  accent: "Accent",
};

const POINT_SHAPES = {
  circle: 16,
  square: 15,
  triangle: 17,
  diamond: 18,
  star: 8,
  times: 4,
};

const LINE_TYPES = {
  none: "solid",
  "5,3": "53",
  "2,2": "22",
};

const R_RESERVED = new Set([
  "if", "else", "repeat", "while", "function", "for", "in", "next", "break",
  "TRUE", "FALSE", "NULL", "Inf", "NaN", "NA", "NA_integer_", "NA_real_",
  "NA_complex_", "NA_character_",
]);

function rString(value) {
  return `"${String(value ?? "")
    .replace(/\\/g, "\\\\")
    .replace(/"/g, '\\"')
    .replace(/\r/g, "\\r")
    .replace(/\n/g, "\\n")}"`;
}

function rColumn(value) {
  const name = String(value ?? "");
  const syntactic = /^[A-Za-z.][A-Za-z0-9._]*$/.test(name) && !/^\.[0-9]/.test(name);
  if (syntactic && !R_RESERVED.has(name)) return name;
  return `\`${name.replace(/`/g, "\\`")}\``;
}

function rNumber(value, fallback = "NA_real_") {
  if (value === "" || value == null) return fallback;
  const number = Number(value);
  return Number.isFinite(number) ? String(number) : fallback;
}

function rBool(value) {
  return value ? "TRUE" : "FALSE";
}

function alphaArg(layer) {
  if (layer?.aes?.alphaCol) return null;
  return `alpha = ${rNumber(layer?.opacity ?? 1, "1")}`;
}

function aesCall(layer, options = {}) {
  const aes = layer?.aes ?? {};
  const parts = [];
  if (options.x !== false && aes.x) parts.push(`x = ${rColumn(aes.x)}`);
  if (options.y !== false && aes.y) parts.push(`y = ${rColumn(aes.y)}`);
  if (options.bounds) {
    if (aes.yMin) parts.push(`ymin = ${rColumn(aes.yMin)}`);
    if (aes.yMax) parts.push(`ymax = ${rColumn(aes.yMax)}`);
  }
  if (aes.color) {
    // geom_tile maps the value column to `fill` ONLY — emitting `color` too
    // would outline every tile by its own value and bury the fill underneath.
    if (options.fillOnly) {
      parts.push(`fill = ${rColumn(aes.color)}`);
    } else {
      parts.push(`color = ${rColumn(aes.color)}`);
      if (options.fill) parts.push(`fill = ${rColumn(aes.color)}`);
    }
  }
  if (aes.sizeCol) parts.push(`size = ${rColumn(aes.sizeCol)}`);
  if (aes.alphaCol) {
    const opacity = Number(layer?.opacity ?? 1);
    const alpha = opacity === 1
      ? rColumn(aes.alphaCol)
      : `${rColumn(aes.alphaCol)} * ${rNumber(opacity, "1")}`;
    parts.push(`alpha = ${alpha}`);
  }
  return parts.length ? `aes(${parts.join(", ")})` : null;
}

function fixedColorArgs(layer, { fill = false, color = false } = {}) {
  if (layer?.aes?.color || !layer?.fill) return [];
  const args = [];
  if (color) args.push(`color = ${rString(layer.fill)}`);
  if (fill) args.push(`fill = ${rString(layer.fill)}`);
  return args;
}

function positionArg(position) {
  if (position === "stack") return "position = position_stack()";
  if (position === "dodge") return "position = position_dodge()";
  if (position === "identity") return "position = position_identity()";
  return null;
}

function geomCall(name, args) {
  return `${name}(${args.filter(Boolean).join(", ")})`;
}

function buildLayer(layer, dfVar) {
  const aes = layer?.aes ?? {};
  const opts = layer?.opts ?? {};
  const opacity = alphaArg(layer);

  switch (layer?.geom) {
    case "point": {
      const geom = layer.position === "jitter" ? "geom_jitter" : "geom_point";
      return geomCall(geom, [
        aesCall(layer),
        ...fixedColorArgs(layer, { color: true }),
        aes.sizeCol ? null : `size = ${rNumber(opts.size ?? 3, "3")}`,
        `shape = ${POINT_SHAPES[opts.shape] ?? POINT_SHAPES.circle}`,
        layer.position === "dodge" ? positionArg("dodge") : null,
        opacity,
      ]);
    }

    case "line":
      return geomCall("geom_line", [
        aesCall(layer),
        ...fixedColorArgs(layer, { color: true }),
        `linewidth = ${rNumber(opts.strokeWidth ?? 1.8, "1.8")}`,
        `linetype = ${rString(LINE_TYPES[opts.dash ?? "none"] ?? opts.dash ?? "solid")}`,
        opacity,
      ]);

    case "bar": {
      const strokeWidth = opts.strokeWidth ?? 0;
      const mappedFill = !!aes.color;
      return geomCall(aes.y ? "geom_col" : "geom_bar", [
        aesCall(layer, { fill: mappedFill }),
        ...fixedColorArgs(layer, { fill: true, color: Number(strokeWidth) > 0 }),
        `linewidth = ${rNumber(strokeWidth, "0")}`,
        positionArg(layer.position),
        opacity,
      ]);
    }

    case "histogram":
      return geomCall("geom_histogram", [
        aesCall(layer, { y: false, fill: !!aes.color }),
        ...fixedColorArgs(layer, { fill: true }),
        `bins = ${rNumber(opts.bins ?? 20, "20")}`,
        opacity,
      ]);

    case "density":
      return geomCall("geom_density", [
        aesCall(layer, { y: false, fill: !!aes.color }),
        ...fixedColorArgs(layer, { fill: true, color: true }),
        `adjust = ${rNumber(opts.adjust ?? 1, "1")}`,
        opacity,
      ]);

    case "smooth": {
      const method = opts.method ?? "lm";
      if (method === "mean") {
        const y = aes.y ? `${dfVar}[[${rString(aes.y)}]]` : "numeric(0)";
        return geomCall("geom_hline", [
          `yintercept = mean(${y}, na.rm = TRUE)`,
          ...fixedColorArgs(layer, { color: true }),
          `linetype = "dashed"`,
          `linewidth = 2`,
          opacity,
        ]);
      }
      return geomCall("geom_smooth", [
        aesCall(layer),
        ...fixedColorArgs(layer, { color: true, fill: true }),
        `method = ${rString(method)}`,
        `se = ${rBool(method === "lm" ? (opts.showSE ?? true) : false)}`,
        method === "lm" ? `level = ${rNumber(opts.ci ?? 0.95, "0.95")}` : null,
        method === "loess" ? `span = ${rNumber(opts.span ?? 0.75, "0.75")}` : null,
        `linewidth = 2`,
        // The layer opacity drives the SE ribbon `fill`; force it low so the
        // ribbon stays translucent and the fitted line remains visible (the
        // line itself is always opaque in geom_smooth).
        `alpha = 0.2`,
      ]);
    }

    case "boxplot": {
      const showOutliers = opts.outlierShow ?? true;
      return geomCall("geom_boxplot", [
        aesCall(layer, { fill: !!aes.color }),
        ...fixedColorArgs(layer, { fill: true, color: true }),
        `coef = ${rNumber(opts.iqrCoef ?? 1.5, "1.5")}`,
        `outlier.shape = ${showOutliers ? "16" : "NA"}`,
        `outlier.size = ${rNumber(opts.outlierSize ?? 3, "3")}`,
        `outlier.colour = ${rString(opts.outlierColor || layer.fill || "black")}`,
        opacity,
      ]);
    }

    case "errorbar":
      return geomCall("geom_errorbar", [
        aesCall(layer, { bounds: true }),
        ...fixedColorArgs(layer, { color: true }),
        `linewidth = ${rNumber(opts.strokeWidth ?? 1.5, "1.5")}`,
        positionArg(layer.position),
        opacity,
      ]);

    case "ribbon":
      return geomCall("geom_ribbon", [
        aesCall(layer, { bounds: true, fill: !!aes.color }),
        ...fixedColorArgs(layer, { fill: true }),
        opacity,
      ]);

    case "tile":
      return geomCall("geom_tile", [
        aesCall(layer, { fillOnly: true }),
        ...fixedColorArgs(layer, { fill: true }),
        opacity,
      ]);

    case "hline":
      return geomCall("geom_hline", [
        `yintercept = ${rNumber(layer.value)}`,
        ...fixedColorArgs(layer, { color: true }),
        `linetype = "dashed"`,
        `linewidth = 1.5`,
        opacity,
      ]);

    case "vline":
      return geomCall("geom_vline", [
        `xintercept = ${rNumber(layer.value)}`,
        ...fixedColorArgs(layer, { color: true }),
        `linetype = "dashed"`,
        `linewidth = 1.5`,
        opacity,
      ]);

    default:
      return null;
  }
}

// PlotBuilder TILE_SCHEMES ids → ggplot2 continuous fill scales.
// Keep in sync with TILE_SCHEMES in components/PlotBuilder.jsx: a scheme with no
// entry here would render in the app and then silently lose its palette in R.
const TILE_FILL_SCALES = {
  viridis: "scale_fill_viridis_c()",
  magma:   `scale_fill_viridis_c(option = "magma")`,
  blues:   `scale_fill_distiller(palette = "Blues", direction = 1)`,
  greens:  `scale_fill_distiller(palette = "Greens", direction = 1)`,
  // d3's RdBu (and matplotlib's) runs red at the low end → blue at the high end;
  // midpoint = 0 mirrors the `pivot: 0` the app applies to diverging ramps.
  rdbu:    `scale_fill_gradient2(low = "#b2182b", mid = "#f7f7f7", high = "#2166ac", midpoint = 0)`,
};

function tileFillScale(layer) {
  return TILE_FILL_SCALES[layer?.opts?.scheme ?? "viridis"] ?? null;
}

function tileValueLayer(layer) {
  const aes = layer?.aes ?? {};
  if (!aes.x || !aes.y || !aes.color) return null;
  const decimals = Math.max(0, Math.min(6, Math.round(Number(layer?.opts?.decimals ?? 2) || 0)));
  return geomCall("geom_text", [
    `aes(x = ${rColumn(aes.x)}, y = ${rColumn(aes.y)}, label = round(${rColumn(aes.color)}, ${decimals}))`,
    "size = 3",
    `colour = "white"`,
  ]);
}

function facetWrapCall(entry) {
  if (!entry?.facetCol) return null;
  const ncol = Math.max(1, Math.min(12, Math.round(Number(entry.facetCols) || 3)));
  return `facet_wrap(~ ${rColumn(entry.facetCol)}, ncol = ${ncol})`;
}

function parseCategories(value) {
  return String(value ?? "").split(",").map(item => item.trim()).filter(Boolean);
}

function labelFormatter(format) {
  if (format === ",") return "scales::label_comma()";
  if (format === ".1%") return "scales::label_percent(accuracy = 0.1)";
  if (format === "$.2f") return "scales::label_dollar(accuracy = 0.01)";
  if (format === ".2f") return "scales::label_number(accuracy = 0.01)";
  if (format === ".3f") return "scales::label_number(accuracy = 0.001)";
  return null;
}

function axisScale(axis, scale, categoryOrder, format) {
  const categories = parseCategories(categoryOrder);
  const labels = labelFormatter(format);
  const args = [];
  if (categories.length) args.push(`limits = c(${categories.map(rString).join(", ")})`);
  if (labels) args.push(`labels = ${labels}`);

  if (categories.length) return `scale_${axis}_discrete(${args.join(", ")})`;
  const suffix = scale === "log" ? "log10" : scale === "sqrt" ? "sqrt" : "continuous";
  return args.length || scale !== "linear" ? `scale_${axis}_${suffix}(${args.join(", ")})` : null;
}

function domainVector(domain) {
  if (!Array.isArray(domain) || (domain[0] == null && domain[1] == null)) return null;
  return `c(${rNumber(domain[0])}, ${rNumber(domain[1])})`;
}

function paletteComponents(plotEntry, layers, { suppressFill = false } = {}) {
  const scheme = plotEntry?.scheme;
  const mappedLayers = layers.filter(layer => layer?.aes?.color);
  if (!scheme || !mappedLayers.length) return { comments: [], components: [] };

  const palette = BREWER_SCHEMES[String(scheme).toLowerCase()];
  if (!palette) {
    return {
      comments: [`# palette: ${scheme} (custom PlotBuilder palette; apply matching manual values if required)`],
      components: [],
    };
  }

  const usesFill = !suppressFill
    && mappedLayers.some(layer => ["bar", "histogram", "density", "boxplot", "ribbon"].includes(layer.geom));
  return {
    comments: [],
    components: [
      `scale_color_brewer(palette = ${rString(palette)})`,
      usesFill ? `scale_fill_brewer(palette = ${rString(palette)})` : null,
    ].filter(Boolean),
  };
}

export function buildGgplot(plotEntry, { dfVar = "df" } = {}) {
  const entry = plotEntry ?? {};
  const layers = (Array.isArray(entry.layers) ? entry.layers : [])
    .filter(layer => layer?.visible !== false && layer?.geom !== "map");
  const geoms = layers.map(layer => buildLayer(layer, dfVar)).filter(Boolean);
  // A tile layer owns the fill scale — ggplot allows only one per plot, so the
  // categorical brewer fill is suppressed here just as the app's colour channel
  // hands over to the tile's sequential scheme.
  const tileLayer = layers.find(layer => layer.geom === "tile" && layer.aes?.color) ?? null;
  const palette = paletteComponents(entry, layers, { suppressFill: !!tileLayer });
  const components = [...geoms];

  // Value labels sit above the tiles, so they follow every geom in the chain.
  if (tileLayer?.opts?.showValues) {
    const textLayer = tileValueLayer(tileLayer);
    if (textLayer) components.push(textLayer);
  }
  const facet = facetWrapCall(entry);
  if (facet) components.push(facet);

  const tileScale = tileLayer ? tileFillScale(tileLayer) : null;
  if (tileScale) components.push(tileScale);

  const xScale = axisScale("x", entry.xScale ?? "linear", entry.xCatOrder, entry.xFmt);
  const yScale = axisScale("y", entry.yScale ?? "linear", entry.yCatOrder, entry.yFmt);
  if (xScale) components.push(xScale);
  if (yScale) components.push(yScale);

  const coordArgs = [];
  const xDomain = domainVector(entry.xDomain);
  const yDomain = domainVector(entry.yDomain);
  if (xDomain) coordArgs.push(`xlim = ${xDomain}`);
  if (yDomain) coordArgs.push(`ylim = ${yDomain}`);
  if (coordArgs.length) components.push(`coord_cartesian(${coordArgs.join(", ")})`);

  const labels = [];
  if (entry.title) labels.push(`title = ${rString(entry.title)}`);
  if (entry.xLabel) labels.push(`x = ${rString(entry.xLabel)}`);
  if (entry.yLabel) labels.push(`y = ${rString(entry.yLabel)}`);
  if (labels.length) components.push(`labs(${labels.join(", ")})`);
  components.push(...palette.components);

  const chain = [`ggplot(${dfVar})`, ...components].join(" +\n  ");
  return [
    "library(ggplot2)",
    "",
    ...palette.comments,
    palette.comments.length ? "" : null,
    `plot <- ${chain}`,
    "",
    "plot",
  ].filter(line => line != null).join("\n");
}

const BASEMAP_TYPES = {
  light: "cartolight",
  dark: "cartodark",
  osm: "osm",
};

function geoDataset(layer, datasets) {
  if (!layer?.datasetId || layer.datasetId === "active") {
    return { dfVar: "df", dataset: null };
  }
  const dataset = datasets.find(item => item.id === layer.datasetId) ?? null;
  return {
    dfVar: toDfVar(dataset?.name ?? dataset?.filename ?? layer.datasetId),
    dataset,
  };
}

function wktConversion(sfVar, dfVar, wktCol) {
  return `${sfVar} <- sf::st_as_sf(${dfVar}, wkt = ${rString(wktCol)}, crs = 4326)`;
}

function geoFillColumn(layer) {
  return layer?.fillByCol || layer?.colorByCol || "";
}

function geoFillArgs(layer) {
  const fillCol = geoFillColumn(layer);
  return {
    fillCol,
    aes: fillCol ? `aes(fill = ${rColumn(fillCol)})` : null,
    fixed: fillCol || !layer?.fill || layer.fill === "none" ? null : `fill = ${rString(layer.fill)}`,
    alpha: rNumber(fillCol ? (layer?.colorFillOpacity ?? 0.65) : (layer?.fillOpacity ?? 0), "0"),
  };
}

function geoSfLayer(layer, sfVar) {
  const fill = geoFillArgs(layer);
  const stroke = layer?.stroke && layer.stroke !== "none" ? layer.stroke : "transparent";
  const linewidth = rNumber(Number(layer?.strokeWidth ?? 0.8) / 2, "0.4");
  const args = [`data = ${sfVar}`];

  if (layer.type === "boundary" || layer.type === "line") {
    args.push("fill = NA", `color = ${rString(stroke)}`, `linewidth = ${linewidth}`);
  } else if (layer.type === "point") {
    const colorCol = layer.colorCol || "";
    if (colorCol) args.push(`aes(color = ${rColumn(colorCol)})`);
    else args.push(`color = ${rString(layer.fill || stroke)}`);
    args.push(`size = ${rNumber(layer.radius ?? 4, "4")}`);
    args.push(`alpha = ${rNumber(layer.fillOpacity ?? 0.78, "0.78")}`);
  } else {
    if (fill.aes) args.push(fill.aes);
    if (fill.fixed) args.push(fill.fixed);
    args.push(`color = ${rString(stroke)}`, `linewidth = ${linewidth}`, `alpha = ${fill.alpha}`);
  }

  return `geom_sf(${args.join(", ")})`;
}

function gridPreparation(layer, index, dfVar) {
  const sfVar = `sf_${index}`;
  const cellsize = rNumber(layer.cellsize ?? 500, "500");
  const metricVar = `metric_${index}`;
  const gridVar = `grid_${index}`;

  if (layer.mode === "boundary" && (layer.boundaryCol || layer.wktCol)) {
    const sourceVar = `boundary_${index}`;
    const wktCol = layer.boundaryCol || layer.wktCol;
    const lines = [
      wktConversion(sourceVar, dfVar, wktCol),
      `${metricVar} <- sf::st_transform(${sourceVar}, 32721)`,
      `${gridVar} <- sf::st_make_grid(${metricVar}, cellsize = ${cellsize}, what = "polygons")`,
      layer.clipBorder !== false
        ? `${sfVar} <- sf::st_intersection(sf::st_as_sf(${gridVar}), sf::st_union(${metricVar})) |> sf::st_transform(4326)`
        : `${sfVar} <- sf::st_as_sf(${gridVar}) |> sf::st_transform(4326)`,
    ];
    return { sfVar, lines };
  }

  if (layer.mode === "latlon" && layer.latCol && layer.lonCol) {
    const pointsVar = `points_${index}`;
    const lines = [
      `${pointsVar} <- sf::st_as_sf(${dfVar}, coords = c(${rString(layer.lonCol)}, ${rString(layer.latCol)}), crs = 4326, remove = FALSE)`,
      `${metricVar} <- sf::st_transform(${pointsVar}, 32721)`,
      `${gridVar} <- sf::st_make_grid(sf::st_as_sfc(sf::st_bbox(${metricVar})), cellsize = ${cellsize}, what = "polygons")`,
      `${sfVar} <- sf::st_as_sf(${gridVar}) |> sf::st_transform(4326)`,
    ];
    return { sfVar, lines };
  }

  return null;
}

function geoLayerScript(layer, index, datasets) {
  const { dfVar } = geoDataset(layer, datasets);
  const sfVar = `sf_${index}`;
  const prep = [];
  const components = [];
  const comments = [];
  let mappedFill = false;
  let mappedColor = false;

  const wktMode = ["polygon", "boundary", "line"].includes(layer.type)
    || (layer.type === "point" && layer.mode === "wkt")
    || (layer.type === "grid" && layer.mode === "wkt");

  if (wktMode && layer.wktCol) {
    prep.push(wktConversion(sfVar, dfVar, layer.wktCol));
    components.push(geoSfLayer(layer, sfVar));
  } else if (layer.type === "point" && layer.latCol && layer.lonCol) {
    const args = [
      `data = ${dfVar}`,
      `aes(x = ${rColumn(layer.lonCol)}, y = ${rColumn(layer.latCol)}${layer.colorCol ? `, color = ${rColumn(layer.colorCol)}` : ""})`,
      layer.colorCol ? null : `color = ${rString(layer.fill || "black")}`,
      `size = ${rNumber(layer.radius ?? 4, "4")}`,
      `alpha = ${rNumber(layer.fillOpacity ?? 0.78, "0.78")}`,
    ];
    components.push(geomCall("geom_point", args));
  } else if (layer.type === "heatmap" && layer.latCol && layer.lonCol) {
    comments.push(`# KDE approximation — Litux uses bandwidth=${layer.bandwidth ?? 250}, gridN=${layer.gridN ?? 45}; ggplot's kde2d differs slightly`);
    components.push(geomCall("stat_density_2d", [
      `data = ${dfVar}`,
      `aes(x = ${rColumn(layer.lonCol)}, y = ${rColumn(layer.latCol)}, fill = after_stat(level))`,
      `geom = "polygon"`,
      `alpha = ${rNumber(layer.fillOpacity ?? 0.72, "0.72")}`,
    ]));
    mappedFill = true;
  } else if (layer.type === "grid") {
    const grid = gridPreparation(layer, index, dfVar);
    if (grid) {
      prep.push(...grid.lines);
      components.push(geoSfLayer(layer, grid.sfVar));
    }
  }

  if (["polygon", "grid"].includes(layer.type) && geoFillColumn(layer)) mappedFill = true;
  if (layer.type === "point" && layer.colorCol) mappedColor = true;

  if (layer.labelCol && components.length && (layer.type === "polygon" || layer.type === "grid")) {
    const labelSfVar = prep.length ? (layer.type === "grid" && layer.mode !== "wkt" ? `sf_${index}` : sfVar) : sfVar;
    components.push(geomCall("geom_sf_text", [
      `data = ${labelSfVar}`,
      `aes(label = ${rColumn(layer.labelCol)})`,
      `size = ${rNumber(Number(layer.labelSize ?? 10) / 3, "3.333333")}`,
    ]));
  }

  return { prep, components, comments, mappedFill, mappedColor };
}

function geoLoadLines(layers, datasets) {
  const ids = [...new Set(layers
    .map(layer => layer?.datasetId)
    .filter(datasetId => datasetId && datasetId !== "active"))];
  const lines = [];

  ids.forEach(datasetId => {
    const dataset = datasets.find(item => item.id === datasetId) ?? null;
    const name = dataset?.name ?? dataset?.filename ?? datasetId;
    const dfVar = toDfVar(name);
    const filename = dataset?.filename;
    lines.push(`# Load ${dfVar}${filename ? ` from ${rString(filename)}` : ` for dataset ${rString(name)}`}`);
    if (filename) {
      lines.push(buildRLoadLine(filename, dataset?.loadOpts ?? null).replace(/^df\b/, dfVar));
    }
  });

  return lines;
}

export function buildGeoGgplot(geoEntry, { datasets = [], basemap = "none" } = {}) {
  const entry = geoEntry ?? {};
  const layers = (Array.isArray(entry.layers) ? entry.layers : []).filter(layer => layer?.visible !== false);
  const prep = [];
  const comments = [];
  const components = [];
  let mappedFill = false;
  let mappedColor = false;

  if (basemap !== "none") {
    comments.push("# basemap tiles require internet; ggspatial fetches them at render time");
    components.push(`ggspatial::annotation_map_tile(type = ${rString(BASEMAP_TYPES[basemap] ?? basemap)}, zoomin = 0)`);
  }

  layers.forEach((layer, index) => {
    const built = geoLayerScript(layer, index + 1, datasets);
    prep.push(...built.prep);
    comments.push(...built.comments);
    components.push(...built.components);
    mappedFill ||= built.mappedFill;
    mappedColor ||= built.mappedColor;
  });

  if (mappedFill) components.push("scale_fill_viridis_c()");
  if (mappedColor) components.push("scale_color_viridis_c()");
  components.push("coord_sf()");

  const labels = [];
  if (entry.title) labels.push(`title = ${rString(entry.title)}`);
  if (entry.subtitle) labels.push(`subtitle = ${rString(entry.subtitle)}`);
  if (entry.caption) labels.push(`caption = ${rString(entry.caption)}`);
  if (labels.length) components.push(`labs(${labels.join(", ")})`);
  components.push("theme_minimal()");

  const loadLines = geoLoadLines(layers, datasets);
  const chain = ["ggplot()", ...components].join(" +\n  ");
  return [
    "library(ggplot2)",
    "library(sf)",
    basemap !== "none" ? "library(ggspatial)" : null,
    "",
    ...loadLines,
    loadLines.length ? "" : null,
    ...prep,
    prep.length ? "" : null,
    ...comments,
    comments.length ? "" : null,
    `plot <- ${chain}`,
    "",
    "plot",
  ].filter(line => line != null).join("\n");
}

function pyString(value) {
  return JSON.stringify(String(value ?? ""));
}

function pyColumn(dfVar, column) {
  return `${dfVar}[${pyString(column)}]`;
}

function pyNumber(value, fallback) {
  if (value === "" || value == null) return String(fallback);
  const number = Number(value);
  return Number.isFinite(number) ? String(number) : String(fallback);
}

function pyColor(layer, fallback = null) {
  if (layer?.aes?.color) return null;
  return layer?.fill ? pyString(layer.fill) : fallback;
}

// PlotBuilder TILE_SCHEMES ids → matplotlib colormaps. Both matplotlib's RdBu
// and d3's run red (low) → blue (high), so no `_r` suffix is needed.
const TILE_CMAPS = {
  viridis: "viridis",
  magma:   "magma",
  blues:   "Blues",
  greens:  "Greens",
  rdbu:    "RdBu",
};
const DIVERGING_CMAPS = new Set(["rdbu"]);

function matplotlibLayer(layer, index, dfVar) {
  const aes = layer?.aes ?? {};
  const opts = layer?.opts ?? {};
  const alpha = pyNumber(layer?.opacity ?? 1, 1);
  const lines = [];
  let usesSeaborn = false;

  switch (layer?.geom) {
    case "point": {
      if (!aes.x || !aes.y) break;
      const args = [pyColumn(dfVar, aes.x), pyColumn(dfVar, aes.y)];
      if (aes.color) args.push(`c=${pyColumn(dfVar, aes.color)}`);
      else if (pyColor(layer)) args.push(`color=${pyColor(layer)}`);
      if (aes.sizeCol) args.push(`s=${pyColumn(dfVar, aes.sizeCol)}`);
      else args.push(`s=${pyNumber(opts.size ?? 3, 3)} ** 2`);
      args.push(`alpha=${alpha}`);
      if (layer.position === "jitter") {
        lines.push(`# jitter requested in Litux; add deterministic noise if overlapping points need separation`);
      }
      lines.push(`ax.scatter(${args.join(", ")})`);
      break;
    }

    case "line": {
      if (!aes.x || !aes.y) break;
      if (aes.color) {
        lines.push(
          `for group, group_df in ${dfVar}.groupby(${pyString(aes.color)}, dropna=False):`,
          `    ax.plot(group_df[${pyString(aes.x)}], group_df[${pyString(aes.y)}], label=str(group), linewidth=${pyNumber(opts.strokeWidth ?? 1.8, 1.8)}, alpha=${alpha})`,
        );
      } else {
        const color = pyColor(layer);
        lines.push(`ax.plot(${pyColumn(dfVar, aes.x)}, ${pyColumn(dfVar, aes.y)}, linewidth=${pyNumber(opts.strokeWidth ?? 1.8, 1.8)}, alpha=${alpha}${color ? `, color=${color}` : ""})`);
      }
      break;
    }

    case "bar": {
      if (!aes.x) break;
      const color = pyColor(layer);
      if (aes.y) {
        lines.push(`ax.bar(${pyColumn(dfVar, aes.x)}, ${pyColumn(dfVar, aes.y)}, alpha=${alpha}${color ? `, color=${color}` : ""})`);
      } else {
        const counts = `_counts_${index}`;
        lines.push(
          `${counts} = ${pyColumn(dfVar, aes.x)}.value_counts(sort=False)`,
          `ax.bar(${counts}.index, ${counts}.values, alpha=${alpha}${color ? `, color=${color}` : ""})`,
        );
      }
      break;
    }

    case "histogram": {
      if (!aes.x) break;
      const color = pyColor(layer);
      lines.push(`ax.hist(${pyColumn(dfVar, aes.x)}.dropna(), bins=${pyNumber(opts.bins ?? 20, 20)}, alpha=${alpha}${color ? `, color=${color}` : ""})`);
      break;
    }

    case "density": {
      if (!aes.x) break;
      usesSeaborn = true;
      const args = [`data=${dfVar}`, `x=${pyString(aes.x)}`, `ax=ax`, `fill=True`, `alpha=${alpha}`, `bw_adjust=${pyNumber(opts.adjust ?? 1, 1)}`];
      if (aes.color) args.push(`hue=${pyString(aes.color)}`);
      else if (pyColor(layer)) args.push(`color=${pyColor(layer)}`);
      lines.push(`sns.kdeplot(${args.join(", ")})`);
      break;
    }

    case "smooth": {
      if (!aes.x || !aes.y) break;
      const method = opts.method ?? "lm";
      const color = pyColor(layer);
      if (method === "mean") {
        lines.push(`ax.axhline(y=${pyColumn(dfVar, aes.y)}.mean(), linestyle="--", linewidth=2, alpha=${alpha}${color ? `, color=${color}` : ""})`);
      } else {
        usesSeaborn = true;
        const args = [`data=${dfVar}`, `x=${pyString(aes.x)}`, `y=${pyString(aes.y)}`, `ax=ax`, `scatter=False`, `ci=${method === "lm" && (opts.showSE ?? true) ? Math.round(Number(opts.ci ?? 0.95) * 100) : "None"}`, `lowess=${method === "loess" ? "True" : "False"}`];
        if (color) args.push(`color=${color}`);
        lines.push(`sns.regplot(${args.join(", ")})`);
      }
      break;
    }

    case "boxplot": {
      if (!aes.y && !aes.x) break;
      usesSeaborn = true;
      const args = [`data=${dfVar}`, `ax=ax`];
      if (aes.x) args.push(`x=${pyString(aes.x)}`);
      if (aes.y) args.push(`y=${pyString(aes.y)}`);
      if (aes.color) args.push(`hue=${pyString(aes.color)}`);
      else if (pyColor(layer)) args.push(`color=${pyColor(layer)}`);
      lines.push(`sns.boxplot(${args.join(", ")})`);
      break;
    }

    case "errorbar": {
      if (!aes.x || !aes.y || !aes.yMin || !aes.yMax) break;
      const color = pyColor(layer);
      lines.push(`ax.errorbar(${pyColumn(dfVar, aes.x)}, ${pyColumn(dfVar, aes.y)}, yerr=[${pyColumn(dfVar, aes.y)} - ${pyColumn(dfVar, aes.yMin)}, ${pyColumn(dfVar, aes.yMax)} - ${pyColumn(dfVar, aes.y)}], fmt="none", linewidth=${pyNumber(opts.strokeWidth ?? 1.5, 1.5)}, alpha=${alpha}${color ? `, color=${color}` : ""})`);
      break;
    }

    case "ribbon": {
      if (!aes.x || !aes.yMin || !aes.yMax) break;
      const color = pyColor(layer);
      lines.push(`ax.fill_between(${pyColumn(dfVar, aes.x)}, ${pyColumn(dfVar, aes.yMin)}, ${pyColumn(dfVar, aes.yMax)}, alpha=${alpha}${color ? `, color=${color}` : ""})`);
      break;
    }

    case "tile": {
      if (!aes.x || !aes.y || !aes.color) break;
      usesSeaborn = true;
      const pivot = `_tile_${index}`;
      const decimals = Math.max(0, Math.min(6, Math.round(Number(opts.decimals ?? 2) || 0)));
      const args = [pivot, "ax=ax", `cmap=${pyString(TILE_CMAPS[opts.scheme ?? "viridis"] ?? "viridis")}`];
      if (DIVERGING_CMAPS.has(opts.scheme)) args.push("center=0");
      if (opts.showValues) args.push("annot=True", `fmt=${pyString(`.${decimals}f`)}`);
      lines.push(
        // seaborn draws index[0] in the TOP row; ggplot puts the smallest y at the
        // bottom. Sorting descending restores the ggplot orientation.
        `${pivot} = ${dfVar}.pivot_table(index=${pyString(aes.y)}, columns=${pyString(aes.x)}, values=${pyString(aes.color)}, aggfunc="mean").sort_index(ascending=False)`,
        `sns.heatmap(${args.join(", ")})`,
      );
      break;
    }

    case "hline":
      lines.push(`ax.axhline(y=${pyNumber(layer.value, 0)}, linestyle="--", linewidth=1.5, alpha=${alpha}${pyColor(layer) ? `, color=${pyColor(layer)}` : ""})`);
      break;

    case "vline":
      lines.push(`ax.axvline(x=${pyNumber(layer.value, 0)}, linestyle="--", linewidth=1.5, alpha=${alpha}${pyColor(layer) ? `, color=${pyColor(layer)}` : ""})`);
      break;

    default:
      break;
  }

  return { lines, usesSeaborn };
}

function pyDomain(domain) {
  if (!Array.isArray(domain) || (domain[0] == null && domain[1] == null)) return null;
  const low = domain[0] == null ? "None" : pyNumber(domain[0], "None");
  const high = domain[1] == null ? "None" : pyNumber(domain[1], "None");
  return `${low}, ${high}`;
}

export function buildMatplotlibPlot(plotEntry, { dfVar = "df" } = {}) {
  const entry = plotEntry ?? {};
  const layers = (Array.isArray(entry.layers) ? entry.layers : [])
    .filter(layer => layer?.visible !== false && layer?.geom !== "map");

  // matplotlib has no facet_wrap: a faceted plot is a subplot grid whose panels
  // are each drawn from a filtered frame. The layer emitters are reused verbatim
  // against `_d` (the per-panel frame) so every geom facets without a second
  // implementation — including the stats, which recompute per panel as ggplot's
  // facet_wrap does.
  const ncol = Math.max(1, Math.min(12, Math.round(Number(entry.facetCols) || 3)));
  const faceted = !!entry.facetCol;
  const panelVar = faceted ? "_d" : dfVar;

  const built = layers.map((layer, index) => matplotlibLayer(layer, index + 1, panelVar));
  const usesSeaborn = built.some(layer => layer.usesSeaborn);
  const lines = ["import matplotlib.pyplot as plt"];
  if (usesSeaborn) lines.push("import seaborn as sns");
  lines.push("");

  const axisLines = [];
  if (entry.xScale === "log") axisLines.push(`ax.set_xscale("log")`);
  if (entry.yScale === "log") axisLines.push(`ax.set_yscale("log")`);
  const xDomain = pyDomain(entry.xDomain);
  const yDomain = pyDomain(entry.yDomain);
  if (xDomain) axisLines.push(`ax.set_xlim(${xDomain})`);
  if (yDomain) axisLines.push(`ax.set_ylim(${yDomain})`);

  if (faceted) {
    lines.push(
      `_levels = sorted(${dfVar}[${pyString(entry.facetCol)}].dropna().unique())`,
      `_ncol = ${ncol}`,
      `_nrow = -(-len(_levels) // _ncol)`,
      `fig, _axes = plt.subplots(_nrow, _ncol, figsize=(4 * _ncol, 3 * _nrow), sharex=True, sharey=True, squeeze=False)`,
      "",
      `for _i, _level in enumerate(_levels):`,
      `    ax = _axes.flat[_i]`,
      `    _d = ${dfVar}[${dfVar}[${pyString(entry.facetCol)}] == _level]`,
    );
    built.forEach(layer => {
      layer.lines.forEach(line => lines.push(`    ${line}`));
    });
    axisLines.forEach(line => lines.push(`    ${line}`));
    lines.push(
      `    ax.set_title(str(_level))`,
      "",
      `# blank out the unused cells of the last row`,
      `for _j in range(len(_levels), _nrow * _ncol):`,
      `    _axes.flat[_j].axis("off")`,
      "",
    );
    // Faceted panels share one set of axis labels, like facet_wrap's strips.
    if (entry.title) lines.push(`fig.suptitle(${pyString(entry.title)})`);
    if (entry.xLabel) lines.push(`fig.supxlabel(${pyString(entry.xLabel)})`);
    if (entry.yLabel) lines.push(`fig.supylabel(${pyString(entry.yLabel)})`);
  } else {
    lines.push("fig, ax = plt.subplots()", "");
    built.forEach(layer => {
      if (layer.lines.length) lines.push(...layer.lines, "");
    });
    lines.push(...axisLines);
    if (entry.title) lines.push(`ax.set_title(${pyString(entry.title)})`);
    if (entry.xLabel) lines.push(`ax.set_xlabel(${pyString(entry.xLabel)})`);
    if (entry.yLabel) lines.push(`ax.set_ylabel(${pyString(entry.yLabel)})`);
    if (layers.some(layer => layer?.aes?.color)) lines.push("ax.legend()");
  }

  lines.push("fig.tight_layout()", "plt.show()");
  return lines.join("\n");
}

function stataString(value) {
  return `"${String(value ?? "").replace(/"/g, '\\"')}"`;
}

function stataNumber(value, fallback = 0) {
  const number = Number(value);
  return Number.isFinite(number) ? String(number) : String(fallback);
}

function stataLayer(layer) {
  const aes = layer?.aes ?? {};
  const opts = layer?.opts ?? {};

  switch (layer?.geom) {
    case "point":
      return aes.x && aes.y ? { twoway: `scatter ${aes.y} ${aes.x}` } : null;
    case "line":
      return aes.x && aes.y ? { twoway: `line ${aes.y} ${aes.x}` } : null;
    case "bar":
      return aes.x && aes.y
        ? { twoway: `bar ${aes.y} ${aes.x}` }
        : aes.x ? { standalone: `graph bar (count), over(${aes.x})` } : null;
    case "histogram":
      return aes.x ? { standalone: `histogram ${aes.x}, bin(${stataNumber(opts.bins ?? 20, 20)})` } : null;
    case "density":
      return aes.x ? { standalone: `kdensity ${aes.x}` } : null;
    case "smooth": {
      if (!aes.x || !aes.y) return null;
      const method = opts.method ?? "lm";
      if (method === "mean") return { option: `yline(\`=r(mean)')`, comment: `* run summarize ${aes.y} before the graph to supply r(mean)` };
      return { twoway: `${method === "loess" ? "lowess" : "lfit"} ${aes.y} ${aes.x}` };
    }
    case "boxplot": {
      if (!aes.y && !aes.x) return null;
      const value = aes.y || aes.x;
      return { standalone: aes.x && aes.y ? `graph box ${value}, over(${aes.x})` : `graph box ${value}` };
    }
    case "errorbar":
      return aes.x && aes.yMin && aes.yMax
        ? { twoway: `rcap ${aes.yMax} ${aes.yMin} ${aes.x}`, comment: "* errorbar has no direct twoway equivalent - approximated with rcap" }
        : null;
    case "ribbon":
      return aes.x && aes.yMin && aes.yMax
        ? { twoway: `rarea ${aes.yMax} ${aes.yMin} ${aes.x}`, comment: "* ribbon has no direct twoway equivalent - approximated with rarea" }
        : null;
    case "tile":
      // Base Stata has no heatmap/tile graph. Emit the closest community command
      // with its install line rather than silently dropping the layer or
      // approximating it with something that plots different numbers.
      return aes.x && aes.y && aes.color
        ? { comment: `* geom_tile has no base-Stata equivalent - requires the community command heatplot:\n*   ssc install heatplot\n*   heatplot ${aes.color} i.${aes.y} i.${aes.x}` }
        : { comment: "* geom_tile layer skipped - needs x, y and a fill column" };
    case "hline":
      return { option: `yline(${stataNumber(layer.value)})` };
    case "vline":
      return { option: `xline(${stataNumber(layer.value)})` };
    default:
      return null;
  }
}

function stataDomain(axis, domain) {
  if (!Array.isArray(domain) || domain[0] == null || domain[1] == null) return null;
  return `${axis}scale(range(${stataNumber(domain[0])} ${stataNumber(domain[1])}))`;
}

export function buildStataPlot(plotEntry, { dataVar = "" } = {}) {
  const entry = plotEntry ?? {};
  const layers = (Array.isArray(entry.layers) ? entry.layers : [])
    .filter(layer => layer?.visible !== false && layer?.geom !== "map");
  const built = layers.map(stataLayer).filter(Boolean);
  const comments = built.map(layer => layer.comment).filter(Boolean);
  const twoway = built.map(layer => layer.twoway).filter(Boolean);
  const standalone = built.map(layer => layer.standalone).filter(Boolean);
  const options = built.map(layer => layer.option).filter(Boolean);

  if (entry.xScale === "log") options.push("xscale(log)");
  if (entry.yScale === "log") options.push("yscale(log)");
  const xDomain = stataDomain("x", entry.xDomain);
  const yDomain = stataDomain("y", entry.yDomain);
  if (xDomain) options.push(xDomain);
  if (yDomain) options.push(yDomain);
  if (entry.title) options.push(`title(${stataString(entry.title)})`);
  if (entry.xLabel) options.push(`xtitle(${stataString(entry.xLabel)})`);
  if (entry.yLabel) options.push(`ytitle(${stataString(entry.yLabel)})`);
  // by() is Stata's facet_wrap; cols() matches ncol.
  if (entry.facetCol) {
    const ncol = Math.max(1, Math.min(12, Math.round(Number(entry.facetCols) || 3)));
    options.push(`by(${entry.facetCol}, cols(${ncol}))`);
  }

  const lines = [
    `* assumes the relevant dataset is loaded${dataVar ? ` (${dataVar})` : ""}`,
    ...comments,
  ];
  if (twoway.length) {
    lines.push(`twoway ${twoway.map(command => `(${command})`).join(" ")}${options.length ? `, ${options.join(" ")}` : ""}`);
  }
  standalone.forEach((command, index) => {
    if (index === 0 && !twoway.length && options.length) {
      lines.push(`${command}${command.includes(",") ? " " : ", "}${options.join(" ")}`);
    } else {
      lines.push(command);
    }
  });
  if (!twoway.length && !standalone.length) lines.push("* no supported visible plot layers");
  return lines.join("\n");
}

function geoPyDataset(layer, datasets) {
  if (!layer?.datasetId || layer.datasetId === "active") {
    return { dfVar: "df", dataset: null };
  }
  const dataset = datasets.find(item => item.id === layer.datasetId) ?? null;
  return {
    dfVar: toDfVar(dataset?.name ?? dataset?.filename ?? layer.datasetId),
    dataset,
  };
}

function geoPyLoadLines(layers, datasets) {
  const ids = [...new Set(layers
    .map(layer => layer?.datasetId)
    .filter(datasetId => datasetId && datasetId !== "active"))];
  const lines = [];
  ids.forEach(datasetId => {
    const dataset = datasets.find(item => item.id === datasetId) ?? null;
    const name = dataset?.name ?? dataset?.filename ?? datasetId;
    const dfVar = toDfVar(name);
    const filename = dataset?.filename;
    lines.push(`# Load ${dfVar}${filename ? ` from ${pyString(filename)}` : ` for dataset ${pyString(name)}`}`);
    if (filename) {
      lines.push(buildPyLoadLine(filename, dataset?.loadOpts ?? null)
        .replace(/^df\b/, dfVar)
        .replace(/\bgeopandas\./g, "gpd."));
    }
  });
  return lines;
}

export function buildGeoMatplotlib(geoEntry, { datasets = [] } = {}) {
  const entry = geoEntry ?? {};
  const layers = (Array.isArray(entry.layers) ? entry.layers : []).filter(layer => layer?.visible !== false);
  const prep = [];
  const plots = [];
  const comments = [];

  layers.forEach((layer, index) => {
    const { dfVar } = geoPyDataset(layer, datasets);
    const geoVar = `geo_${index + 1}`;
    const wktMode = ["polygon", "boundary", "line"].includes(layer.type)
      || (layer.type === "point" && layer.mode === "wkt")
      || (layer.type === "grid" && layer.mode === "wkt");

    if (wktMode && layer.wktCol) {
      prep.push(`${geoVar} = gpd.GeoDataFrame(${dfVar}.copy(), geometry=gpd.GeoSeries.from_wkt(${pyColumn(dfVar, layer.wktCol)}), crs="EPSG:4326")`);
      const args = ["ax=ax"];
      if (["boundary", "line"].includes(layer.type)) {
        args.push(`facecolor="none"`, `edgecolor=${pyString(layer.stroke || "black")}`, `linewidth=${pyNumber(Number(layer.strokeWidth ?? 0.8) / 2, 0.4)}`);
      } else if (layer.type === "point") {
        if (layer.colorCol) args.push(`column=${pyString(layer.colorCol)}`, `legend=True`);
        else args.push(`color=${pyString(layer.fill || "black")}`);
        args.push(`markersize=${pyNumber(layer.radius ?? 4, 4)} ** 2`, `alpha=${pyNumber(layer.fillOpacity ?? 0.78, 0.78)}`);
      } else {
        const fillCol = geoFillColumn(layer);
        if (fillCol) args.push(`column=${pyString(fillCol)}`, `legend=True`);
        else if (layer.fill && layer.fill !== "none") args.push(`color=${pyString(layer.fill)}`);
        args.push(`edgecolor=${pyString(layer.stroke || "transparent")}`, `linewidth=${pyNumber(Number(layer.strokeWidth ?? 0.8) / 2, 0.4)}`, `alpha=${pyNumber(fillCol ? layer.colorFillOpacity ?? 0.65 : layer.fillOpacity ?? 0, 0)}`);
      }
      plots.push(`${geoVar}.plot(${args.join(", ")})`);
      if (layer.labelCol && ["polygon", "grid"].includes(layer.type)) {
        plots.push(
          `for _, row in ${geoVar}.iterrows():`,
          `    point = row.geometry.representative_point()`,
          `    ax.text(point.x, point.y, str(row[${pyString(layer.labelCol)}]), ha="center", va="center")`,
        );
      }
      return;
    }

    if (layer.type === "point" && layer.latCol && layer.lonCol) {
      const args = [pyColumn(dfVar, layer.lonCol), pyColumn(dfVar, layer.latCol)];
      if (layer.colorCol) args.push(`c=${pyColumn(dfVar, layer.colorCol)}`);
      else args.push(`color=${pyString(layer.fill || "black")}`);
      args.push(`s=${pyNumber(layer.radius ?? 4, 4)} ** 2`, `alpha=${pyNumber(layer.fillOpacity ?? 0.78, 0.78)}`);
      plots.push(`ax.scatter(${args.join(", ")})`);
      return;
    }

    if (layer.type === "heatmap" && layer.latCol && layer.lonCol) {
      comments.push(`# heatmap approximation: matplotlib hexbin differs from Litux KDE (bandwidth=${layer.bandwidth ?? 250}, gridN=${layer.gridN ?? 45})`);
      plots.push(`ax.hexbin(${pyColumn(dfVar, layer.lonCol)}, ${pyColumn(dfVar, layer.latCol)}, gridsize=${pyNumber(layer.gridN ?? 45, 45)}, cmap="viridis", alpha=${pyNumber(layer.fillOpacity ?? 0.72, 0.72)})`);
      return;
    }

    if (layer.type === "grid") {
      comments.push(`# generated grid layer ${index + 1}: export its WKT dataset from Litux before plotting in geopandas`);
    }
  });

  const loadLines = geoPyLoadLines(layers, datasets);
  const lines = ["import matplotlib.pyplot as plt", "import geopandas as gpd"];
  if (loadLines.length) lines.push("import pandas as pd");
  lines.push("", ...loadLines);
  if (loadLines.length) lines.push("");
  lines.push(...prep);
  if (prep.length) lines.push("");
  lines.push(...comments);
  if (comments.length) lines.push("");
  lines.push("fig, ax = plt.subplots()", "", ...plots);
  if (plots.length) lines.push("");
  if (entry.title) lines.push(`ax.set_title(${pyString(entry.title)})`);
  lines.push(`ax.set_aspect("equal", adjustable="datalim")`, "fig.tight_layout()", "plt.show()");
  return lines.join("\n");
}

export function buildGeoStata() {
  return "* Stata has no native sf/geo-plot; use the R or Python script for spatial maps.";
}
