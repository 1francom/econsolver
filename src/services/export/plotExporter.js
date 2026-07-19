// ─── ECON STUDIO · services/export/plotExporter.js ───────────────────────────
// Shared SVG plot export utilities with style presets.
// All plots are pure SVG — we clone the element, apply the preset,
// and serialize to SVG (download) or rasterise to PNG (via offscreen canvas).
// Pure JS, no React, no external deps.

// ─── PRESETS ─────────────────────────────────────────────────────────────────
export const PRESETS = {
  default:      { label: "Default",      bg: null },          // no transform
  journal:      { label: "Journal",      bg: "#ffffff" },     // white bg, dark text
  presentation: { label: "Presentation", bg: "#1a1a2e" },     // dark bg, bold lines
  minimal:      { label: "Minimal",      bg: "#ffffff" },     // white, no grid
};

// ─── COLOR TRANSFORM MAPS ────────────────────────────────────────────────────
// Applied via string-replace on serialized SVG.
// Journal: replace dark EconSolver bg with white/light, text with dark.
const JOURNAL_MAP = [
  ["#080808", "#ffffff"],
  ["#0f0f0f", "#ffffff"],
  ["#131313", "#f5f5f5"],
  ["#161616", "#f0f0f0"],
  ["#1c1c1c", "#cccccc"],
  ["#252525", "#dddddd"],
  ["#ddd8cc", "#111111"],
  ["#888888", "#555555"],
  ["#444444", "#888888"],
  // keep accent colors as-is (teal #6ec8b4, gold #c8a96e, blue #6e9ec8)
];

// Minimal: same color map as journal but also strip grid/axis lines.
const MINIMAL_MAP = JOURNAL_MAP;

// Presentation: keep dark bg, boost accent visibility (subtle brightening).
const PRESENTATION_MAP = [
  // Keep dark bg as-is. Slightly brighten text for readability on projector.
  ["#ddd8cc", "#f0ece4"],
  ["#888888", "#aaaaaa"],
  ["#444444", "#777777"],
];

// ─── APPLY PRESET ─────────────────────────────────────────────────────────────
/**
 * Apply a style preset to a cloned SVG string via color replacement.
 * Returns the transformed SVG string.
 * @param {string} svgString
 * @param {string} preset  — key from PRESETS
 * @returns {string}
 */
export function applyPreset(svgString, preset) {
  let s = svgString;

  if (preset === "journal") {
    for (const [from, to] of JOURNAL_MAP) {
      // replace both quoted and unquoted occurrences (fill="..." stroke="...")
      s = s.split(from).join(to);
    }
  } else if (preset === "presentation") {
    for (const [from, to] of PRESENTATION_MAP) {
      s = s.split(from).join(to);
    }
  } else if (preset === "minimal") {
    for (const [from, to] of MINIMAL_MAP) {
      s = s.split(from).join(to);
    }
    // Strip grid lines: <line> elements with stroke-dasharray (grid lines)
    // and <line> elements whose stroke matches light gray colors post-transform
    s = s.replace(/<line[^>]*stroke-dasharray[^>]*\/>/g, "");
    s = s.replace(/<line[^>]*stroke-dasharray[^>]*><\/line>/g, "");
    // Also strip gridX/gridY path elements from Observable Plot
    s = s.replace(/<path[^>]*stroke-dasharray[^>]*\/>/g, "");
  }

  return s;
}

// ─── GET SVG ELEMENT ──────────────────────────────────────────────────────────
/**
 * Get the SVG element from a container div or SVG element directly.
 * @param {SVGElement|HTMLElement} containerOrSVG
 * @returns {SVGElement|null}
 */
export function getSVGElement(containerOrSVG) {
  if (!containerOrSVG) return null;
  if (containerOrSVG.tagName?.toLowerCase() === "svg") return containerOrSVG;
  const svgs = Array.from(containerOrSVG.querySelectorAll("svg"));
  if (svgs.length <= 1) return svgs[0] ?? null;
  // Observable Plot's color legend (color: {legend:true}) renders one tiny <svg>
  // per swatch ahead of the actual chart <svg> in DOM order — a plain
  // querySelector("svg") grabbed a single-color swatch icon instead of the chart.
  // Pick the largest by rendered area instead, since the chart is always far bigger.
  const area = (svg) => {
    const r = svg.getBoundingClientRect();
    return r.width * r.height;
  };
  return svgs.reduce((best, svg) => (area(svg) > area(best) ? svg : best));
}

// ─── DOWNLOAD SVG ─────────────────────────────────────────────────────────────
/**
 * Download the SVG as a .svg file.
 * @param {SVGElement|HTMLElement} el  — SVG element or container div
 * @param {string} filename            — base filename without extension
 * @param {string} preset              — key from PRESETS
 */
export function downloadSVG(el, filename = "plot", preset = "default") {
  const svg = getSVGElement(el);
  if (!svg) return;
  const clone = svg.cloneNode(true);
  clone.setAttribute("xmlns", "http://www.w3.org/2000/svg");
  let src = new XMLSerializer().serializeToString(clone);
  src = applyPreset(src, preset);
  src = '<?xml version="1.0" encoding="UTF-8"?>\n' + src;
  const blob = new Blob([src], { type: "image/svg+xml;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename + ".svg";
  a.click();
  URL.revokeObjectURL(url);
}

// ─── DOWNLOAD PNG ─────────────────────────────────────────────────────────────
/**
 * Download as PNG via offscreen canvas.
 * @param {SVGElement|HTMLElement} el
 * @param {string} filename            — base filename without extension
 * @param {string} preset              — key from PRESETS
 * @param {number} scale               — pixel multiplier (default 2 for retina)
 */
export function downloadPNG(el, filename = "plot", preset = "default", scale = 2) {
  const svg = getSVGElement(el);
  if (!svg) return;

  const { width: rawW, height: rawH } = svg.getBoundingClientRect();
  const width  = rawW  || 600;
  const height = rawH || 360;

  const clone = svg.cloneNode(true);
  clone.setAttribute("xmlns", "http://www.w3.org/2000/svg");
  // Ensure explicit pixel dimensions for canvas rendering
  clone.setAttribute("width",  String(width));
  clone.setAttribute("height", String(height));

  let src = new XMLSerializer().serializeToString(clone);
  src = applyPreset(src, preset);

  const bgColor = PRESETS[preset]?.bg ?? "#080808";
  const blob = new Blob([src], { type: "image/svg+xml" });
  const url  = URL.createObjectURL(blob);
  const img  = new Image();

  img.onload = () => {
    const canvas = document.createElement("canvas");
    canvas.width  = width  * scale;
    canvas.height = height * scale;
    const ctx = canvas.getContext("2d");
    ctx.scale(scale, scale);
    ctx.fillStyle = bgColor;
    ctx.fillRect(0, 0, width, height);
    ctx.drawImage(img, 0, 0, width, height);
    URL.revokeObjectURL(url);
    const a = document.createElement("a");
    a.href = canvas.toDataURL("image/png");
    a.download = filename + ".png";
    a.click();
  };

  img.onerror = () => URL.revokeObjectURL(url);
  img.src = url;
}

// ─── DOWNLOAD COMBINED PNG (two plots side-by-side) ───────────────────────────
/**
 * Render two SVG elements side-by-side on a single canvas and download as PNG.
 * @param {SVGElement|HTMLElement} elA
 * @param {SVGElement|HTMLElement} elB
 * @param {string} filename
 * @param {string} preset
 * @param {number} gap     — pixel gap between plots (unscaled)
 * @param {number} scale   — pixel multiplier (default 2 for retina)
 */
export async function downloadCombinedPNG(elA, elB, filename = "plot_combined", preset = "default", gap = 16, scale = 2) {
  const svgA = getSVGElement(elA);
  const svgB = getSVGElement(elB);
  if (!svgA || !svgB) return;

  function prep(svg) {
    const { width: rawW, height: rawH } = svg.getBoundingClientRect();
    const w = rawW || 600;
    const h = rawH || 360;
    const clone = svg.cloneNode(true);
    clone.setAttribute("xmlns", "http://www.w3.org/2000/svg");
    clone.setAttribute("width",  String(w));
    clone.setAttribute("height", String(h));
    let src = new XMLSerializer().serializeToString(clone);
    src = applyPreset(src, preset);
    return { src, w, h };
  }

  function loadImg(src) {
    return new Promise((resolve, reject) => {
      const blob = new Blob([src], { type: "image/svg+xml" });
      const url  = URL.createObjectURL(blob);
      const img  = new Image();
      img.onload  = () => { URL.revokeObjectURL(url); resolve(img); };
      img.onerror = () => { URL.revokeObjectURL(url); reject(new Error("SVG load failed")); };
      img.src = url;
    });
  }

  const { src: srcA, w: wA, h: hA } = prep(svgA);
  const { src: srcB, w: wB, h: hB } = prep(svgB);
  const [imgA, imgB] = await Promise.all([loadImg(srcA), loadImg(srcB)]);

  const totalW = wA + gap + wB;
  const totalH = Math.max(hA, hB);
  const canvas  = document.createElement("canvas");
  canvas.width  = totalW * scale;
  canvas.height = totalH * scale;
  const ctx = canvas.getContext("2d");
  ctx.scale(scale, scale);
  const bgColor = PRESETS[preset]?.bg ?? "#080808";
  ctx.fillStyle = bgColor;
  ctx.fillRect(0, 0, totalW, totalH);
  ctx.drawImage(imgA, 0,       0, wA, hA);
  ctx.drawImage(imgB, wA + gap, 0, wB, hB);

  const a = document.createElement("a");
  a.href     = canvas.toDataURL("image/png");
  a.download = filename + ".png";
  a.click();
}

// ─── DOWNLOAD GRID PNG (N plots in a 2-col grid) ──────────────────────────────
/**
 * Composite N SVG elements into a single PNG on a 2-column grid. Rows fill left
 * to right; a final odd plot is centered (3 → 2 over 1, 4 → 2×2, 5 → 2/2/1, …).
 * @param {(SVGElement|HTMLElement)[]} els
 * @param {string} filename
 * @param {{ cols?:number, gap?:number, scale?:number, preset?:string }} opts
 */
export async function downloadGridPNG(els, filename = "compare", { cols = 2, gap = 18, scale = 2, preset = "journal" } = {}) {
  const svgs = (els || []).map(getSVGElement).filter(Boolean);
  if (!svgs.length) return;

  const prep = (svg) => {
    const { width: rawW, height: rawH } = svg.getBoundingClientRect();
    const w = rawW || 480, h = rawH || 200;
    const clone = svg.cloneNode(true);
    clone.setAttribute("xmlns", "http://www.w3.org/2000/svg");
    clone.setAttribute("width", String(w));
    clone.setAttribute("height", String(h));
    return { src: applyPreset(new XMLSerializer().serializeToString(clone), preset), w, h };
  };
  const loadImg = (src) => new Promise((resolve, reject) => {
    const url = URL.createObjectURL(new Blob([src], { type: "image/svg+xml" }));
    const img = new Image();
    img.onload  = () => { URL.revokeObjectURL(url); resolve(img); };
    img.onerror = () => { URL.revokeObjectURL(url); reject(new Error("SVG load failed")); };
    img.src = url;
  });

  const items = svgs.map(prep);
  const imgs  = await Promise.all(items.map(it => loadImg(it.src)));
  const cellW = Math.max(...items.map(i => i.w));
  const cellH = Math.max(...items.map(i => i.h));
  const rows  = Math.ceil(items.length / cols);
  const totalW = cols * cellW + (cols + 1) * gap;
  const totalH = rows * cellH + (rows + 1) * gap;

  const canvas = document.createElement("canvas");
  canvas.width  = totalW * scale;
  canvas.height = totalH * scale;
  const ctx = canvas.getContext("2d");
  ctx.scale(scale, scale);
  ctx.fillStyle = PRESETS[preset]?.bg ?? "#ffffff";
  ctx.fillRect(0, 0, totalW, totalH);

  items.forEach((it, idx) => {
    const r = Math.floor(idx / cols), c = idx % cols;
    const inRow = (r === rows - 1) ? (items.length - r * cols) : cols;
    const rowPad = (cols - inRow) * (cellW + gap) / 2;   // center a short last row
    const x = gap + rowPad + c * (cellW + gap) + (cellW - it.w) / 2;
    const y = gap + r * (cellH + gap) + (cellH - it.h) / 2;
    ctx.drawImage(imgs[idx], x, y, it.w, it.h);
  });

  const a = document.createElement("a");
  a.href     = canvas.toDataURL("image/png");
  a.download = filename + ".png";
  a.click();
}
