// ─── ECON STUDIO · spatial/plot/legend.js ─ (moved verbatim from SpatialTab.jsx)
import { mono } from "../shared/constants.js";

// Fixed margins so y-axis labels like "34.52°S" always fit
export const GEO_MARGIN = { top: 20, right: 20, bottom: 34, left: 72 };

export function appendSvgLegend(svg, legend, C, plotW, plotH, gutterW = 160) {
  if (!svg || !legend) return;
  const ns = "http://www.w3.org/2000/svg";
  const svgW = plotW + gutterW;
  svg.setAttribute("width", svgW);
  svg.setAttribute("height", plotH);
  svg.setAttribute("viewBox", `0 0 ${svgW} ${plotH}`);
  const items = legend.type === "numeric-discrete"
    ? legend.values.map(v => ({ label: String(v), color: legend.cmap[String(v)] }))
    : legend.type === "categorical"
      ? legend.cats.map(v => ({ label: String(v), color: legend.cmap[v] }))
      : null;
  const g = document.createElementNS(ns, "g");
  g.setAttribute("font-family", mono);
  g.setAttribute("font-size", "9");
  const x = plotW + 12;
  const y = 18;
  const width = 136;
  const rowH = 14;
  const height = legend.type === "gradient" ? 48 : 24 + (items?.length ?? 0) * rowH;

  const bg = document.createElementNS(ns, "rect");
  bg.setAttribute("x", x);
  bg.setAttribute("y", y);
  bg.setAttribute("width", width);
  bg.setAttribute("height", height);
  bg.setAttribute("rx", "4");
  bg.setAttribute("fill", C?.surface ?? "#fff");
  bg.setAttribute("stroke", C?.border2 ?? "#ddd");
  bg.setAttribute("opacity", "0.92");
  g.appendChild(bg);

  const title = document.createElementNS(ns, "text");
  title.setAttribute("x", x + 14);
  title.setAttribute("y", y + 14);
  title.setAttribute("fill", "#444");
  title.setAttribute("font-size", "8");
  title.textContent = String(legend.col ?? "").toUpperCase();
  g.appendChild(title);

  if (legend.type === "gradient") {
    const gradId = `grad_${Math.random().toString(36).slice(2)}`;
    const defs = document.createElementNS(ns, "defs");
    const grad = document.createElementNS(ns, "linearGradient");
    grad.setAttribute("id", gradId);
    grad.setAttribute("x1", "0%");
    grad.setAttribute("x2", "100%");
    const pal = legend.pal;
    const stops = pal?.stops
      ? pal.stops.map(([r, g, b], i, arr) => [`${Math.round(i / (arr.length - 1) * 100)}%`, `rgb(${r},${g},${b})`])
      : pal?.low && pal?.high
        ? [["0%", `rgb(${pal.low.join(",")})`], ["100%", `rgb(${pal.high.join(",")})`]]
        : [["0%", "#149470"], ["100%", "#d27d12"]];
    stops.forEach(([offset, color]) => {
      const stop = document.createElementNS(ns, "stop");
      stop.setAttribute("offset", offset);
      stop.setAttribute("stop-color", color);
      grad.appendChild(stop);
    });
    defs.appendChild(grad);
    svg.insertBefore(defs, svg.firstChild);
    const bar = document.createElementNS(ns, "rect");
    bar.setAttribute("x", x + 8);
    bar.setAttribute("y", y + 23);
    bar.setAttribute("width", width - 16);
    bar.setAttribute("height", 8);
    bar.setAttribute("fill", `url(#${gradId})`);
    g.appendChild(bar);
    [[legend.min, x + 8, "start"], [legend.max, x + width - 8, "end"]].forEach(([v, tx, anchor]) => {
      const t = document.createElementNS(ns, "text");
      t.setAttribute("x", tx);
      t.setAttribute("y", y + 43);
      t.setAttribute("text-anchor", anchor);
      t.setAttribute("fill", C?.textDim ?? "#777");
      t.textContent = Number(v).toFixed(2);
      g.appendChild(t);
    });
  } else if (items) {
    items.forEach((item, i) => {
      const yy = y + 27 + i * rowH;
      const sw = document.createElementNS(ns, "rect");
      sw.setAttribute("x", x + 8);
      sw.setAttribute("y", yy - 8);
      sw.setAttribute("width", 9);
      sw.setAttribute("height", 9);
      sw.setAttribute("rx", "2");
      sw.setAttribute("fill", item.color);
      const label = document.createElementNS(ns, "text");
      label.setAttribute("x", x + 23);
      label.setAttribute("y", yy);
      label.setAttribute("fill", C?.text ?? "#333");
      label.textContent = item.label;
      g.appendChild(sw);
      g.appendChild(label);
    });
  }
  svg.appendChild(g);
}
