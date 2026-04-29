// ─── ECON STUDIO · components/shared/PlotExportBar.jsx ───────────────────────
// Compact export bar: preset selector + SVG/PNG download buttons.
// Reusable — drop below any SVG-containing element.
//
// Props:
//   getEl    : () => SVGElement | HTMLElement | null  — called at download time
//   filename : string  — base filename (no extension)
//   style    : object  — additional container styles

import { useState } from "react";
import { PRESETS, downloadSVG, downloadPNG } from "../../services/export/plotExporter.js";

const C = {
  bg:       "#080808",
  border:   "#1c1c1c",
  border2:  "#252525",
  text:     "#ddd8cc",
  textDim:  "#888",
  textMuted:"#444",
  teal:     "#6ec8b4",
};
const mono = "'IBM Plex Mono','JetBrains Mono',Consolas,monospace";

export default function PlotExportBar({ getEl, filename = "plot", style }) {
  const [preset, setPreset] = useState("default");

  const btnBase = {
    padding: "0.2rem 0.6rem",
    background: "transparent",
    border: `1px solid ${C.border2}`,
    borderRadius: 3,
    color: C.textDim,
    cursor: "pointer",
    fontFamily: mono,
    fontSize: 9,
    transition: "all 0.12s",
    flexShrink: 0,
  };

  const onHover = e => {
    e.currentTarget.style.borderColor = C.teal;
    e.currentTarget.style.color = C.teal;
  };
  const onLeave = e => {
    e.currentTarget.style.borderColor = C.border2;
    e.currentTarget.style.color = C.textDim;
  };

  return (
    <div style={{
      display: "flex",
      alignItems: "center",
      gap: 6,
      padding: "0.3rem 0.65rem",
      borderTop: `1px solid ${C.border}`,
      background: C.bg,
      ...style,
    }}>
      {/* Preset label */}
      <span style={{ fontFamily: mono, fontSize: 9, color: C.textMuted, flexShrink: 0 }}>
        Style
      </span>

      {/* Preset selector */}
      <select
        value={preset}
        onChange={e => setPreset(e.target.value)}
        style={{
          background: C.bg,
          border: `1px solid ${C.border2}`,
          borderRadius: 3,
          fontFamily: mono,
          fontSize: 9,
          padding: "2px 5px",
          color: C.text,
          cursor: "pointer",
          flexShrink: 0,
        }}
      >
        {Object.entries(PRESETS).map(([key, { label }]) => (
          <option key={key} value={key}>{label}</option>
        ))}
      </select>

      <div style={{ flex: 1 }} />

      {/* SVG download */}
      <button
        onClick={() => downloadSVG(getEl(), filename, preset)}
        title="Download SVG"
        style={btnBase}
        onMouseEnter={onHover}
        onMouseLeave={onLeave}
      >
        ↓ SVG
      </button>

      {/* PNG download */}
      <button
        onClick={() => downloadPNG(getEl(), filename, preset)}
        title="Download PNG (2×)"
        style={btnBase}
        onMouseEnter={onHover}
        onMouseLeave={onLeave}
      >
        ↓ PNG
      </button>
    </div>
  );
}
