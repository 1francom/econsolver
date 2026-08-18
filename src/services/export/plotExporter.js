// ─── ECON STUDIO · services/export/plotExporter.js ───────────────────────────
// Shared SVG plot export utilities with style presets.
// All plots are pure SVG — we clone the element, apply the preset,
// and serialize to SVG (download) or rasterise to PNG (via offscreen canvas).
// Pure JS, no React, no external deps.

import { DARK } from "../../theme.js";

// ─── PRESETS ─────────────────────────────────────────────────────────────────
export const PRESETS = {
  default:      { label: "Default",      bg: null },          // no transform
  journal:      { label: "Journal",      bg: "#ffffff" },     // white bg, dark text
  presentation: { label: "Presentation", bg: "#1a1a2e" },     // dark bg, bold lines
  minimal:      { label: "Minimal",      bg: "#ffffff" },     // white, no grid
};

// ─── COLOR TRANSFORM MAPS ────────────────────────────────────────────────────
// Applied via string-replace on serialized SVG.
//
// These MUST be derived from the palette, not written as literals. They were
// literals, pinned to a superseded revision of DARK — the moment the palette was
// refined, every entry stopped matching and the Journal preset silently exported
// a dark-background figure instead of a white one. A string-replace map keyed on
// hex values is only ever as correct as its last sync with theme.js.
//
// LEGACY_DARK covers plots serialized before the palette refresh (a saved
// artifact re-exported later), so both generations transform correctly.

const LEGACY_DARK = {
  bg: "#080808", surface: "#0f0f0f", surface2: "#131313", surface3: "#161616",
  border: "#1c1c1c", border2: "#252525",
  text: "#ddd8cc", textDim: "#888888", textMuted: "#444444",
};

// Journal / Minimal: dark ground → white, light text → dark. Accent colours
// (teal / gold / blue …) are deliberately left untouched so series stay identifiable.
function lightenMap() {
  const pairs = [
    ["bg",        "#ffffff"],
    ["surface",   "#ffffff"],
    ["surface2",  "#f5f5f5"],
    ["surface3",  "#f0f0f0"],
    ["border",    "#cccccc"],
    ["border2",   "#dddddd"],
    ["text",      "#111111"],
    ["textDim",   "#555555"],
    ["textMuted", "#888888"],
  ];
  const out = [];
  for (const [token, to] of pairs) {
    for (const src of [DARK[token], LEGACY_DARK[token]]) {
      if (src) out.push([src, to]);
    }
  }
  return out;
}

// Presentation: keep the dark ground, lift text for projector legibility.
function presentationMap() {
  const pairs = [
    ["text",      "#f0ece4"],
    ["textDim",   "#aaaaaa"],
    ["textMuted", "#777777"],
  ];
  const out = [];
  for (const [token, to] of pairs) {
    for (const src of [DARK[token], LEGACY_DARK[token]]) {
      if (src) out.push([src, to]);
    }
  }
  return out;
}

const JOURNAL_MAP      = lightenMap();
const MINIMAL_MAP      = JOURNAL_MAP;
const PRESENTATION_MAP = presentationMap();

// ─── STRIP GROUND RECT ───────────────────────────────────────────────────────
/**
 * Remove the opaque background rect from a serialized SVG so the export is
 * transparent (journal-friendly).
 *
 * Three call sites (ModelPlots, ResidualPlots, resultDisplay) each carried their
 * own copy of this as two regexes matching `fill="#080808"` / `fill="#0f0f0f"` —
 * literal values from a superseded revision of DARK. Once the palette was
 * refined, none of them matched and every exported SVG silently kept its dark
 * ground. Centralised here and keyed off the palette so there is one place to
 * keep in sync, and it covers both the current and the legacy values.
 */
export function stripGroundRect(svgString) {
  const grounds = [
    DARK.bg, DARK.surface,
    LEGACY_DARK.bg, LEGACY_DARK.surface,
  ].filter(Boolean);
  let s = svgString;
  for (const hex of new Set(grounds)) {
    // Escape the leading # for use in a character-class-free pattern.
    const h = hex.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    s = s.replace(new RegExp(`<rect[^>]*fill="${h}"[^>]*/>`, "gi"), "");
    s = s.replace(new RegExp(`<rect[^>]*fill="${h}"[^>]*></rect>`, "gi"), "");
  }
  return s;
}

// ─── FONT EMBEDDING ──────────────────────────────────────────────────────────
// A serialized SVG loaded through `new Image()` from a blob URL is an ISOLATED
// document: it cannot see the page's <link> to Google Fonts. The family NAME
// survives serialization, so the SVG asks for "IBM Plex Mono", finds nothing, and
// falls back to the platform's generic monospace. Result: every exported PNG/SVG
// used a different typeface from the plot on screen — the axis labels, tick values
// and legend of a "publication-ready" figure were not the ones the user approved.
//
// Fix: resolve the @font-face rules to actual font bytes and inline them as
// data: URIs inside the SVG, so the isolated document is self-contained.
//
// Requires `fonts.googleapis.com` + `fonts.gstatic.com` in the CSP `connect-src`
// (fetch, NOT style-src/font-src — those govern <link> and url() loads, which is
// a different directive; see the CSP notes in CLAUDE.md).

const FONT_CSS_URLS = {
  "IBM Plex Mono":  "https://fonts.googleapis.com/css2?family=IBM+Plex+Mono:wght@400;500&display=swap",
  "IBM Plex Sans":  "https://fonts.googleapis.com/css2?family=IBM+Plex+Sans:wght@400;500;600&display=swap",
  "Inter":          "https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600&display=swap",
  "Geist":          "https://fonts.googleapis.com/css2?family=Geist:wght@400;500;600&display=swap",
  "Plus Jakarta Sans": "https://fonts.googleapis.com/css2?family=Plus+Jakarta+Sans:wght@400;500;600&display=swap",
  "JetBrains Mono": "https://fonts.googleapis.com/css2?family=JetBrains+Mono:wght@400;500&display=swap",
};

// family → Promise<string> of @font-face CSS with data: URIs. Cached because an
// export bar can fire repeatedly and the bytes never change within a session.
const fontCssCache = new Map();

async function toDataURI(url) {
  const res = await fetch(url);
  if (!res.ok) throw new Error("font fetch " + res.status);
  const buf = new Uint8Array(await res.arrayBuffer());
  let bin = "";
  for (let i = 0; i < buf.length; i++) bin += String.fromCharCode(buf[i]);
  return "data:font/woff2;base64," + btoa(bin);
}

/**
 * Fetch a family's @font-face rules and rewrite each src url() to a data: URI.
 * Only the latin subset is embedded — plot text is numbers and column names, and
 * embedding every unicode-range subset would inflate a downloaded .svg several-fold.
 * Resolves to "" on any failure: a wrong-typeface export is a much better outcome
 * than no export at all, so this never rejects into the caller.
 */
function embeddedFontCSS(family) {
  if (fontCssCache.has(family)) return fontCssCache.get(family);
  const url = FONT_CSS_URLS[family];
  if (!url) return Promise.resolve("");

  const p = (async () => {
    try {
      const cssRes = await fetch(url);
      if (!cssRes.ok) return "";
      const css = await cssRes.text();
      // Google returns one @font-face per weight × unicode-range subset.
      const blocks = css.match(/@font-face\s*\{[^}]*\}/g) ?? [];
      const latin = blocks.filter((b) => {
        const m = b.match(/unicode-range:\s*([^;]+);/);
        // No unicode-range at all → single-subset file, keep it.
        return !m || /U\+0{0,3}0-0{0,2}FF/i.test(m[1]) || /U\+0000/i.test(m[1]);
      });
      const out = [];
      for (const block of latin) {
        const m = block.match(/src:\s*url\((https:\/\/[^)]+\.woff2)\)/);
        if (!m) continue;
        try {
          const dataUri = await toDataURI(m[1]);
          out.push(block.replace(m[1], dataUri));
        } catch { /* skip this subset, keep the others */ }
      }
      return out.join("\n");
    } catch {
      return "";
    }
  })();

  fontCssCache.set(family, p);
  return p;
}

/** Families referenced by name anywhere in a serialized SVG string. */
function familiesUsedIn(svgString) {
  return Object.keys(FONT_CSS_URLS).filter((f) => svgString.includes(f));
}

/**
 * Inject a <style> carrying self-contained @font-face rules for every family the
 * SVG references. Returns the SVG string unchanged if nothing could be embedded.
 */
export async function inlineFonts(svgString) {
  const families = familiesUsedIn(svgString);
  if (!families.length) return svgString;
  const cssParts = await Promise.all(families.map(embeddedFontCSS));
  const css = cssParts.filter(Boolean).join("\n");
  if (!css) return svgString;
  const style = `<style type="text/css"><![CDATA[\n${css}\n]]></style>`;
  // Insert immediately after the opening <svg …> tag.
  return svgString.replace(/(<svg\b[^>]*>)/, `$1${style}`);
}

// ─── EXPORT BACKGROUND ───────────────────────────────────────────────────────
/**
 * Resolve the canvas fill for a rasterised export.
 *
 * A preset that declares a background wins. Otherwise ("default" preset, bg:null)
 * the figure must keep the ground it was rendered against — this used to fall back
 * to a hardcoded "#080808", so exporting from light mode produced dark-on-dark
 * text on a near-black canvas. Reading the live element's computed background
 * follows the active theme without the exporter needing to know about it.
 */
export function resolveExportBg(preset, el) {
  const declared = PRESETS[preset]?.bg;
  if (declared) return declared;
  let node = el;
  while (node && node.nodeType === 1) {
    const bg = getComputedStyle(node).backgroundColor;
    if (bg && bg !== "transparent" && !/rgba\(\s*0,\s*0,\s*0,\s*0\s*\)/.test(bg)) return bg;
    node = node.parentElement;
  }
  return DARK.bg;
}

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

// ─── LEGEND EXTRACTION / INJECTION ────────────────────────────────────────────
// Observable Plot's color legend (color: {legend:true}) renders its swatches as
// small standalone <svg> icons, each wrapped in a <span> alongside the category's
// label text. getSVGElement() above deliberately excludes them from the chosen
// chart <svg>, so a plain clone-and-serialize drops the legend entirely. These
// helpers pull the swatch color + label pairs from the container and redraw them
// as native SVG elements inside the exported clone, so exported PNG/SVG matches
// what's on screen instead of silently losing which series is which.

/**
 * Read {color, label} pairs from a container's legend swatch <svg> elements
 * (every <svg> in the container other than the chosen chart svg).
 * @param {HTMLElement} container
 * @param {SVGElement} mainSvg
 * @returns {{color:string, label:string}[]}
 */
export function getLegendItems(container, mainSvg) {
  if (!container || container.tagName?.toLowerCase() === "svg") return [];
  const swatchSvgs = Array.from(container.querySelectorAll("svg")).filter(s => s !== mainSvg);
  const items = [];
  const seen = new Set();
  for (const svg of swatchSvgs) {
    const shape = svg.querySelector("rect, circle, path, line, polygon");
    if (!shape) continue;
    const fill = shape.getAttribute("fill");
    const color = fill && fill !== "none" ? fill : shape.getAttribute("stroke");
    const label = (svg.parentElement?.textContent || "").trim();
    if (color && label && !seen.has(label)) { seen.add(label); items.push({ color, label }); }
  }
  return items;
}

/**
 * Widen an SVG clone and draw a color-swatch legend in the new right-hand
 * margin. Mutates `svgEl` in place (width, viewBox, appended <g>).
 * @param {SVGElement} svgEl   — the clone to mutate (not the live DOM node)
 * @param {{color:string,label:string}[]} items
 * @param {number} width       — current width (px) before widening
 * @param {number} height      — current height (px)
 * @returns {number} the new total width (px)
 */
export function appendLegend(svgEl, items, width, height) {
  if (!items.length) return width;
  const svgNS = "http://www.w3.org/2000/svg";
  const maxLabelLen = Math.max(...items.map(i => i.label.length));
  const legendW = Math.min(220, Math.max(90, maxLabelLen * 6 + 30));
  const g = svgEl.ownerDocument.createElementNS(svgNS, "g");
  g.setAttribute("transform", `translate(${width + 10}, 16)`);
  items.forEach((item, i) => {
    const y = i * 18;
    const rect = svgEl.ownerDocument.createElementNS(svgNS, "rect");
    rect.setAttribute("x", "0"); rect.setAttribute("y", String(y));
    rect.setAttribute("width", "10"); rect.setAttribute("height", "10");
    rect.setAttribute("rx", "2");
    rect.setAttribute("fill", item.color);
    g.appendChild(rect);
    const text = svgEl.ownerDocument.createElementNS(svgNS, "text");
    text.setAttribute("x", "16"); text.setAttribute("y", String(y + 9));
    text.setAttribute("font-family", "IBM Plex Mono, monospace");
    text.setAttribute("font-size", "10");
    text.setAttribute("fill", "#ddd8cc"); // theme-mapped by applyPreset's JOURNAL_MAP/PRESENTATION_MAP
    text.textContent = item.label;
    g.appendChild(text);
  });
  svgEl.appendChild(g);

  const newWidth = width + legendW;
  svgEl.setAttribute("width", String(newWidth));
  const vb = svgEl.getAttribute("viewBox");
  if (vb) {
    const parts = vb.trim().split(/\s+/).map(Number);
    const [minX = 0, minY = 0, , h = height] = parts;
    svgEl.setAttribute("viewBox", `${minX} ${minY} ${newWidth} ${h}`);
  } else {
    svgEl.setAttribute("viewBox", `0 0 ${newWidth} ${height}`);
  }
  return newWidth;
}

// ─── DOWNLOAD SVG ─────────────────────────────────────────────────────────────
/**
 * Download the SVG as a .svg file.
 * @param {SVGElement|HTMLElement} el  — SVG element or container div
 * @param {string} filename            — base filename without extension
 * @param {string} preset              — key from PRESETS
 */
export async function downloadSVG(el, filename = "plot", preset = "default") {
  const svg = getSVGElement(el);
  if (!svg) return;
  const legendItems = getLegendItems(el, svg);
  const clone = svg.cloneNode(true);
  clone.setAttribute("xmlns", "http://www.w3.org/2000/svg");
  if (legendItems.length) {
    const { width: rawW, height: rawH } = svg.getBoundingClientRect();
    appendLegend(clone, legendItems, rawW || 600, rawH || 360);
  }
  let src = new XMLSerializer().serializeToString(clone);
  src = applyPreset(src, preset);
  src = await inlineFonts(src);
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
export async function downloadPNG(el, filename = "plot", preset = "default", scale = 2) {
  const svg = getSVGElement(el);
  if (!svg) return;
  const legendItems = getLegendItems(el, svg);

  const { width: rawW, height: rawH } = svg.getBoundingClientRect();
  const chartWidth = rawW  || 600;
  const height     = rawH || 360;

  const clone = svg.cloneNode(true);
  clone.setAttribute("xmlns", "http://www.w3.org/2000/svg");
  // Ensure explicit pixel dimensions for canvas rendering
  clone.setAttribute("width",  String(chartWidth));
  clone.setAttribute("height", String(height));

  const width = legendItems.length ? appendLegend(clone, legendItems, chartWidth, height) : chartWidth;

  let src = new XMLSerializer().serializeToString(clone);
  src = applyPreset(src, preset);
  src = await inlineFonts(src);

  const bgColor = resolveExportBg(preset, el);
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

  async function prep(svg) {
    const { width: rawW, height: rawH } = svg.getBoundingClientRect();
    const w = rawW || 600;
    const h = rawH || 360;
    const clone = svg.cloneNode(true);
    clone.setAttribute("xmlns", "http://www.w3.org/2000/svg");
    clone.setAttribute("width",  String(w));
    clone.setAttribute("height", String(h));
    let src = new XMLSerializer().serializeToString(clone);
    src = applyPreset(src, preset);
    src = await inlineFonts(src);
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

  const [{ src: srcA, w: wA, h: hA }, { src: srcB, w: wB, h: hB }] =
    await Promise.all([prep(svgA), prep(svgB)]);
  const [imgA, imgB] = await Promise.all([loadImg(srcA), loadImg(srcB)]);

  const totalW = wA + gap + wB;
  const totalH = Math.max(hA, hB);
  const canvas  = document.createElement("canvas");
  canvas.width  = totalW * scale;
  canvas.height = totalH * scale;
  const ctx = canvas.getContext("2d");
  ctx.scale(scale, scale);
  const bgColor = resolveExportBg(preset, elA);
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

  const prep = async (svg) => {
    const { width: rawW, height: rawH } = svg.getBoundingClientRect();
    const w = rawW || 480, h = rawH || 200;
    const clone = svg.cloneNode(true);
    clone.setAttribute("xmlns", "http://www.w3.org/2000/svg");
    clone.setAttribute("width", String(w));
    clone.setAttribute("height", String(h));
    const src = await inlineFonts(applyPreset(new XMLSerializer().serializeToString(clone), preset));
    return { src, w, h };
  };
  const loadImg = (src) => new Promise((resolve, reject) => {
    const url = URL.createObjectURL(new Blob([src], { type: "image/svg+xml" }));
    const img = new Image();
    img.onload  = () => { URL.revokeObjectURL(url); resolve(img); };
    img.onerror = () => { URL.revokeObjectURL(url); reject(new Error("SVG load failed")); };
    img.src = url;
  });

  const items = await Promise.all(svgs.map(prep));
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
