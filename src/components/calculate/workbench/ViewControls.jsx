import { useTheme } from "../../../ThemeContext.jsx";


// Plot view controls: manual x limits, manual y limits (override auto-scale),
// and graph height. Props: view { xRange:[x0,x1], yRange:[y0,y1]|null, height }, onChange(patch)
export default function ViewControls({ view, onChange }) {
  const { C, T } = useTheme();
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

  // Reference lines (geom_vline / geom_hline). "v" = vertical at x=value,
  // "h" = horizontal at y=value. Defaults to the midpoint of the relevant axis.
  const refLines = Array.isArray(view.refLines) ? view.refLines : [];
  const addRef = (kind) => {
    const value = kind === "v"
      ? round2((x0 + x1) / 2)
      : round2(((yr[0] ?? 0) + (yr[1] ?? (yr[0] ?? 0) + 1)) / 2);
    onChange({ refLines: [...refLines, { kind, value, label: "" }] });
  };
  const patchRef = (i, patch) =>
    onChange({ refLines: refLines.map((l, k) => (k === i ? { ...l, ...patch } : l)) });
  const removeRef = (i) => onChange({ refLines: refLines.filter((_, k) => k !== i) });

  // Free-text annotations placed at (x, y) data coordinates. New ones drop at the
  // plot center so they land somewhere visible.
  const annotations = Array.isArray(view.annotations) ? view.annotations : [];
  const addAnn = () => onChange({
    annotations: [...annotations, {
      id: `ann_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 6)}`,
      x: round2((x0 + x1) / 2), y: round2(((yr[0] ?? 0) + (yr[1] ?? (yr[0] ?? 0) + 1)) / 2), text: "label",
    }],
  });
  const patchAnn = (i, patch) =>
    onChange({ annotations: annotations.map((a, k) => (k === i ? { ...a, ...patch } : a)) });
  const removeAnn = (i) => onChange({ annotations: annotations.filter((_, k) => k !== i) });

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 6, marginBottom: 8, fontFamily: T.code.fontFamily }}>
      <div style={{ display: "flex", alignItems: "center", gap: 16, flexWrap: "wrap" }}>
        <span style={{ fontSize: T.caption.fontSize, color: C.teal, letterSpacing: "0.22em", textTransform: "uppercase" }}>View</span>

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
          <span style={{ fontSize: T.caption.fontSize, color: C.textDim || "#888", minWidth: 36 }}>{height}px</span>
        </label>
      </div>

      <div style={{ display: "flex", alignItems: "center", gap: 16, flexWrap: "wrap" }}>
        <label style={lbl(C)}>
          x label<input type="text" value={view.xLabel ?? ""} placeholder="x axis"
            onChange={(e) => onChange({ xLabel: e.target.value.slice(0, 48) })} style={{ ...num(C), width: 120 }} />
        </label>
        <label style={lbl(C)}>
          y label<input type="text" value={view.yLabel ?? ""} placeholder="y axis"
            onChange={(e) => onChange({ yLabel: e.target.value.slice(0, 48) })} style={{ ...num(C), width: 120 }} />
        </label>

        <span style={{ fontSize: T.caption.fontSize, color: C.textDim || "#888" }}>lines</span>
        <button onClick={() => addRef("v")} style={refBtn(C, C.blue)}>+ vertical</button>
        <button onClick={() => addRef("h")} style={refBtn(C, C.gold)}>+ horizontal</button>

        {refLines.map((l, i) => (
          <span key={i} style={{ display: "flex", alignItems: "center", gap: 4, fontSize: T.caption.fontSize,
            color: C.textDim || "#888", border: `1px solid ${C.border2}`, borderRadius: 4, padding: "1px 4px" }}>
            <span style={{ color: l.kind === "v" ? C.blue : C.gold }}>{l.kind === "v" ? "x=" : "y="}</span>
            <input type="number" value={l.value}
              onChange={(e) => { const v = Number(e.target.value); if (e.target.value !== "" && Number.isFinite(v)) patchRef(i, { value: v }); }}
              style={{ ...num(C), width: 56 }} />
            <input type="text" value={l.label ?? ""} placeholder="label"
              onChange={(e) => patchRef(i, { label: e.target.value.slice(0, 24) })} style={{ ...num(C), width: 64 }} />
            <span onClick={() => removeRef(i)} style={{ color: C.red || "#c86e6e", cursor: "pointer", fontSize: T.code.fontSize }}>×</span>
          </span>
        ))}

        <span style={{ fontSize: T.caption.fontSize, color: C.textDim || "#888" }}>text</span>
        <button onClick={addAnn} style={refBtn(C, C.teal)}>+ text</button>

        {annotations.map((a, i) => (
          <span key={a.id ?? i} style={{ display: "flex", alignItems: "center", gap: 4, fontSize: T.caption.fontSize,
            color: C.textDim || "#888", border: `1px solid ${C.border2}`, borderRadius: 4, padding: "1px 4px" }}>
            <input type="text" value={a.text ?? ""} placeholder="text"
              onChange={(e) => patchAnn(i, { text: e.target.value.slice(0, 64) })} style={{ ...num(C), width: 90 }} />
            <input type="color" value={a.color || C.text} title="Text color"
              onChange={(e) => patchAnn(i, { color: e.target.value })}
              style={{ width: 20, height: 18, padding: 0, border: `1px solid ${C.border2}`, background: "transparent", cursor: "pointer" }} />
            <span style={{ color: C.teal }}>@</span>
            <input type="number" value={a.x} title="x"
              onChange={(e) => { const v = Number(e.target.value); if (e.target.value !== "" && Number.isFinite(v)) patchAnn(i, { x: v }); }}
              style={{ ...num(C), width: 50 }} />
            <input type="number" value={a.y} title="y"
              onChange={(e) => { const v = Number(e.target.value); if (e.target.value !== "" && Number.isFinite(v)) patchAnn(i, { y: v }); }}
              style={{ ...num(C), width: 50 }} />
            <span onClick={() => removeAnn(i)} style={{ color: C.red || "#c86e6e", cursor: "pointer", fontSize: T.code.fontSize }}>×</span>
          </span>
        ))}
      </div>
    </div>
  );
}

function round2(v) { return Math.round(v * 100) / 100; }
function refBtn(C, color) {
  return { fontSize: T.caption.fontSize, padding: "2px 7px", borderRadius: 4, cursor: "pointer",
    background: "transparent", color, border: `1px solid ${color}`, fontFamily: T.code.fontFamily };
}

function lbl(C) {
  return { display: "flex", alignItems: "center", gap: 6, fontSize: T.caption.fontSize,
    color: C.textDim || "#888" };
}
function num(C) {
  return { width: 64, background: C.bg, color: C.text, border: `1px solid ${C.border2}`,
    fontFamily: T.code.fontFamily, fontSize: T.code.fontSize, padding: "2px 4px" };
}
