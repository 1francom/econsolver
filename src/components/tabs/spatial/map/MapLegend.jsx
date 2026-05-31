// ─── ECON STUDIO · spatial/map/MapLegend.jsx ─ (moved verbatim from SpatialTab.jsx)
import { mono } from "../shared/constants.js";

export function MapLegend({ legend, C }) {
  if (!legend) return null;
  return (
    <div style={{
      position: "absolute", bottom: 24, right: 8, zIndex: 999,
      background: C.surface, border: `1px solid ${C.border2}`,
      borderRadius: 4, padding: "6px 10px", fontFamily: mono, fontSize: 9, minWidth: 100,
      backdropFilter: "blur(4px)",
    }}>
      <div style={{ color: C.textMuted, letterSpacing: "0.12em", textTransform: "uppercase", marginBottom: 5 }}>
        {legend.col}
      </div>
      {legend.type === "gradient" && (
        <div>
          <div style={{ height: 8, borderRadius: 2, background: "linear-gradient(to right,#6ec8b4,#c8a96e)", marginBottom: 4 }} />
          <div style={{ display: "flex", justifyContent: "space-between", color: C.textDim }}>
            <span>{Number(legend.min).toFixed(2)}</span>
            <span>{Number(legend.max).toFixed(2)}</span>
          </div>
        </div>
      )}
      {legend.type === "categorical" && legend.cats.map(cat => (
        <div key={cat} style={{ display: "flex", alignItems: "center", gap: 5, marginBottom: 2 }}>
          <div style={{ width: 8, height: 8, borderRadius: "50%", background: legend.cmap[cat], flexShrink: 0 }} />
          <span style={{ color: C.text, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", maxWidth: 120 }}>{String(cat)}</span>
        </div>
      ))}
      {legend.type === "numeric-discrete" && (
        <div style={{ display: "grid", gridTemplateColumns: "repeat(5, max-content)", gap: "3px 8px", color: C.text }}>
          {legend.values.map(v => (
            <div key={v} style={{ display: "flex", alignItems: "center", gap: 4 }}>
              <div style={{ width: 9, height: 9, borderRadius: 2, background: legend.cmap[String(v)], flexShrink: 0 }} />
              <span>{v}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
