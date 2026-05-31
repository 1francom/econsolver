// ─── ECON STUDIO · spatial/map/ColorRow.jsx ─ (moved verbatim from SpatialTab.jsx)
import { mono } from "../shared/constants.js";

export function ColorRow({ label, color, opacity, opacityLabel = "opacity", opacityMin = 0, opacityMax = 1, opacityStep = 0.05, onColor, onOpacity, C }) {
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 3 }}>
      <span style={{ fontSize: 9, color: C.textMuted, fontFamily: mono, letterSpacing: "0.12em", textTransform: "uppercase" }}>{label}</span>
      <div style={{ display: "flex", alignItems: "center", gap: 7 }}>
        <input type="color" value={color} onChange={e => onColor(e.target.value)}
          style={{ width: 26, height: 20, border: "none", background: "none", cursor: "pointer", padding: 0, flexShrink: 0 }} />
        <span style={{ fontSize: 8, color: C.textMuted, fontFamily: mono, flexShrink: 0 }}>{opacityLabel}</span>
        <input type="range" min={opacityMin} max={opacityMax} step={opacityStep} value={opacity}
          onChange={e => onOpacity(+e.target.value)}
          style={{ flex: 1, accentColor: C.teal, cursor: "pointer" }} />
        <span style={{ fontSize: 9, color: C.textDim, fontFamily: mono, width: 30, textAlign: "right", flexShrink: 0 }}>
          {opacityMax === 1 ? `${Math.round(opacity * 100)}%` : opacity.toFixed(1)}
        </span>
      </div>
    </div>
  );
}
