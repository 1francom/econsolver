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
  return containerOrSVG.querySelector("svg") ?? null;
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
