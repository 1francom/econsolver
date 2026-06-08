// ─── ECON STUDIO · spatial/map/ColorRow.jsx ─ (moved verbatim from SpatialTab.jsx)
import { useTheme } from "../../../../ThemeContext.jsx";

export function ColorRow({ label, color, opacity, opacityLabel = "opacity", opacityMin = 0, opacityMax = 1, opacityStep = 0.05, onColor, onOpacity, C }) {
  const { T } = useTheme();
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 3 }}>
      <span style={{ fontSize: T.caption.fontSize, color: C.textMuted, fontFamily: T.code.fontFamily, letterSpacing: "0.12em", textTransform: "uppercase" }}>{label}</span>
      <div style={{ display: "flex", alignItems: "center", gap: 7 }}>
        <input type="color" value={color} onChange={e => onColor(e.target.value)}
          style={{ width: 26, height: 20, border: "none", background: "none", cursor: "pointer", padding: 0, flexShrink: 0 }} />
        <span style={{ fontSize: T.caption.fontSize, color: C.textMuted, fontFamily: T.code.fontFamily, flexShrink: 0 }}>{opacityLabel}</span>
        <input type="range" min={opacityMin} max={opacityMax} step={opacityStep} value={opacity}
          onChange={e => onOpacity(+e.target.value)}
          style={{ flex: 1, accentColor: C.teal, cursor: "pointer" }} />
        <span style={{ fontSize: T.caption.fontSize, color: C.textDim, fontFamily: T.code.fontFamily, width: 30, textAlign: "right", flexShrink: 0 }}>
          {opacityMax === 1 ? `${Math.round(opacity * 100)}%` : opacity.toFixed(1)}
        </span>
      </div>
    </div>
  );
}
