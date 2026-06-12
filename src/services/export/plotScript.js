// Deterministic PlotBuilder config -> R/ggplot2 translator.

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
