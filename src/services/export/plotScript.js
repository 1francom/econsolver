// Deterministic PlotBuilder config -> R/ggplot2 translator.

import { toDfVar } from "../../pipeline/exporter.js";
import { buildRLoadLine } from "./loadLine.js";

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
    parts.push(`color = ${rColumn(aes.color)}`);
    if (options.fill) parts.push(`fill = ${rColumn(aes.color)}`);
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
        opacity,
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

function paletteComponents(plotEntry, layers) {
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

  const usesFill = mappedLayers.some(layer => ["bar", "histogram", "density", "boxplot", "ribbon"].includes(layer.geom));
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
  const palette = paletteComponents(entry, layers);
  const components = [...geoms];

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
