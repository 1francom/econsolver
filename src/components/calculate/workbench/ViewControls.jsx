import { useTheme } from "../../../ThemeContext.jsx";

const mono = "'IBM Plex Mono', monospace";

// Plot view controls: manual x limits, manual y limits (override auto-scale),
// and graph height. Props: view { xRange:[x0,x1], yRange:[y0,y1]|null, height }, onChange(patch)
export default function ViewControls({ view, onChange }) {
  const { C } = useTheme();
  const [x0, x1] = view.xRange;
  const yr = Array.isArray(view.yRange) ? view.yRange : [null, null];
  const height = view.height ?? 460;

  const setX = (i, raw) => {
    const v = Number(raw);
    if (raw === "" || !Number.isFinite(v)) return;
    const xRange = [...view.xRange];
    xRange[i] = v;
    if (xRange[0] < xRange[1]) onChange({ xRange });
  };

  // y is a nullable override: empty input clears that endpoint; both empty → auto.
  const setY = (i, raw) => {
    const cur = Array.isArray(view.yRange) ? [...view.yRange] : [null, null];
    const v = Number(raw);
    cur[i] = raw === "" || Number.isNaN(v) ? null : v;
    onChange({ yRange: cur[0] == null && cur[1] == null ? null : cur });
  };

  return (
    <div style={{ display: "flex", alignItems: "center", gap: 16, flexWrap: "wrap",
      marginBottom: 8, fontFamily: mono }}>
      <span style={{ fontSize: 9, color: C.teal, letterSpacing: "0.22em", textTransform: "uppercase" }}>View</span>

      <label style={lbl(C)}>
        x min<input type="number" value={x0} onChange={(e) => setX(0, e.target.value)} style={num(C)} />
      </label>
      <label style={lbl(C)}>
        x max<input type="number" value={x1} onChange={(e) => setX(1, e.target.value)} style={num(C)} />
      </label>

      <label style={lbl(C)}>
        y min<input type="number" value={yr[0] ?? ""} placeholder="auto"
          onChange={(e) => setY(0, e.target.value)} style={num(C)} />
      </label>
      <label style={lbl(C)}>
        y max<input type="number" value={yr[1] ?? ""} placeholder="auto"
          onChange={(e) => setY(1, e.target.value)} style={num(C)} />
      </label>

      <label style={lbl(C)}>
        height
        <input type="range" min={240} max={820} step={20} value={height}
          onChange={(e) => onChange({ height: Number(e.target.value) })} style={{ width: 90, accentColor: C.teal }} />
        <span style={{ fontSize: 10, color: C.textDim || "#888", minWidth: 36 }}>{height}px</span>
      </label>
    </div>
  );
}

function lbl(C) {
  return { display: "flex", alignItems: "center", gap: 6, fontSize: 10,
    color: C.textDim || "#888" };
}
function num(C) {
  return { width: 64, background: C.bg, color: C.text, border: `1px solid ${C.line || "#222"}`,
    fontFamily: mono, fontSize: 11, padding: "2px 4px" };
}
