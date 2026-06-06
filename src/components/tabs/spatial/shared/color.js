// ─── ECON STUDIO · spatial/shared/color.js ───────────────────────────────────
// Named palette registry + value→color scale builder.

import { arrMin, arrMax } from "./constants.js";

// ── Palette registry ──────────────────────────────────────────────────────────
// Each entry: low/high [r,g,b] for 2-stop gradients, OR stops [[r,g,b],...] for
// multi-stop. cats[] is the discrete palette used for categorical / integer data.
export const PALETTE_DEFS = {
  "teal-gold": {
    label: "Teal→Gold",
    low: [20, 145, 110], high: [210, 125, 18],
    cats: ["#149470","#d27d12","#3a74c8","#c43030","#8830c8","#48a84e","#c05828","#b0b015"],
  },
  "blues": {
    label: "Blues",
    low: [205, 228, 252], high: [8, 38, 130],
    cats: ["#082682","#2f5ec0","#6898e0","#c43030","#6ec8b0","#c89040","#9060c0","#3a9050"],
  },
  "reds": {
    label: "Reds",
    low: [255, 222, 210], high: [135, 8, 8],
    cats: ["#870808","#dc2828","#f08870","#2870c8","#28c888","#b0b020","#6838c8","#409050"],
  },
  "greens": {
    label: "Greens",
    low: [205, 248, 215], high: [8, 102, 28],
    cats: ["#08661c","#40a848","#88c898","#c05830","#3862c8","#b88818","#7030b0","#407880"],
  },
  "purple": {
    label: "Purple",
    low: [238, 222, 255], high: [64, 5, 150],
    cats: ["#400596","#7030c0","#a870d8","#c03050","#30a060","#c08018","#2858a0","#808825"],
  },
  "viridis": {
    label: "Viridis",
    stops: [[68,1,84],[59,82,139],[33,145,140],[94,201,98],[253,231,37]],
    cats: ["#440154","#3b528b","#21918c","#5ec962","#fde725","#c43030","#c8882a","#9860c8"],
  },
  "rdbu": {
    label: "Rd→Bu",
    stops: [[178,24,43],[239,138,98],[247,209,172],[191,217,235],[100,162,203],[33,102,172]],
    cats: ["#b2182b","#2166ac","#ef8a62","#74add1","#f7b48e","#4aac26","#d01c8b","#f1b6da"],
  },
};

export const DEFAULT_PALETTE = "teal-gold";

// Legacy export kept for any existing references outside this module
export const CAT_PALETTE = PALETTE_DEFS[DEFAULT_PALETTE].cats;

// CSS gradient string for a palette — used in swatches and the legend bar
export function paletteToCss(pal) {
  if (!pal) return "linear-gradient(to right,#149470,#d27d12)";
  if (pal.stops) {
    return `linear-gradient(to right,${pal.stops.map(([r,g,b]) => `rgb(${r},${g},${b})`).join(",")})`;
  }
  const [r0,g0,b0] = pal.low, [r1,g1,b1] = pal.high;
  return `linear-gradient(to right,rgb(${r0},${g0},${b0}),rgb(${r1},${g1},${b1}))`;
}

function interpolateStops(stops, t) {
  const n = stops.length - 1;
  const scaled = Math.max(0, Math.min(n, t * n));
  const i = Math.min(Math.floor(scaled), n - 1);
  const f = scaled - i;
  const [r0,g0,b0] = stops[i], [r1,g1,b1] = stops[i + 1];
  return `rgb(${Math.round(r0+f*(r1-r0))},${Math.round(g0+f*(g1-g0))},${Math.round(b0+f*(b1-b0))})`;
}

function colorAt(t, pal) {
  if (pal.stops) return interpolateStops(pal.stops, t);
  const [r0,g0,b0] = pal.low, [r1,g1,b1] = pal.high;
  return `rgb(${Math.round(r0+t*(r1-r0))},${Math.round(g0+t*(g1-g0))},${Math.round(b0+t*(b1-b0))})`;
}

export function buildColorScale(rows, col, palette = DEFAULT_PALETTE) {
  if (!col) return { getColor: () => null, legend: null };
  const pal = PALETTE_DEFS[palette] ?? PALETTE_DEFS[DEFAULT_PALETTE];
  const vals = rows.map(r => r[col]).filter(v => v !== null && v !== undefined && v !== "");
  if (!vals.length) return { getColor: () => null, legend: null };
  const isNum = vals.every(v => !isNaN(parseFloat(v)));

  if (isNum) {
    const nums = vals.map(Number);
    const mn = arrMin(nums), mx = arrMax(nums), rng = mx - mn || 1;
    const at = v => colorAt((Number(v) - mn) / rng, pal);
    const uniq = [...new Set(nums)].sort((a, b) => a - b);
    const isDiscreteCount = uniq.length <= 24 && uniq.every(v => Number.isInteger(v)) && mn >= 0;
    if (isDiscreteCount) {
      const cmap = Object.fromEntries(uniq.map(v => [String(v), at(v)]));
      const getColor = row => {
        const v = row[col];
        if (v === null || v === undefined || v === "") return null;
        return cmap[String(Number(v))] ?? at(v);
      };
      return { getColor, legend: { type: "numeric-discrete", values: uniq, cmap, col, pal } };
    }
    const getColor = row => {
      const v = row[col];
      if (v === null || v === undefined || v === "") return null;
      return at(v);
    };
    return { getColor, legend: { type: "gradient", min: mn, max: mx, col, pal } };
  }

  // Categorical
  const cats = [...new Set(vals)];
  const colors = pal.cats ?? CAT_PALETTE;
  const cmap = Object.fromEntries(cats.map((c, i) => [c, colors[i % colors.length]]));
  return { getColor: row => cmap[row[col]] ?? "#888", legend: { type: "categorical", cats: cats.slice(0, 8), cmap, col } };
}
