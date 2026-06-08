import { useRef, useEffect } from "react";
import { useTheme } from "../../../ThemeContext.jsx";
import { axisTicks } from "./canvasAxes.js";


// Comparative-statics chart: x-axis is the swept parameter, y-axis is the
// optimum — x* (argmax/argmin) or f(x*) (optimal value) per locus.mode. The line
// breaks at points with interior:false (boundary / unbounded), so a region with
// no interior optimum shows a gap rather than a misleading locus.
// Props: locus { param, mode, from, to, series:[{eqId, points:[{p,xStar,value,interior}]}] }
export default function LocusCanvas({ locus, height = 180 }) {
  const { C, T } = useTheme();
  const canvasRef = useRef(null);
  const wrapRef = useRef(null);

  useEffect(() => {
    const canvas = canvasRef.current, wrap = wrapRef.current;
    if (!canvas || !wrap) return;
    const ro = new ResizeObserver(() => draw());
    ro.observe(wrap);
    draw();
    return () => ro.disconnect();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [locus, height, C]);

  function yOf(pt) { return locus.mode === "value" ? pt.value : pt.xStar; }

  function draw() {
    const canvas = canvasRef.current, wrap = wrapRef.current;
    if (!canvas || !wrap) return;
    const dpr = window.devicePixelRatio || 1;
    const W = wrap.clientWidth, H = height;
    canvas.width = W * dpr; canvas.height = H * dpr;
    canvas.style.width = W + "px"; canvas.style.height = H + "px";
    const ctx = canvas.getContext("2d");
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.fillStyle = C.bg; ctx.fillRect(0, 0, W, H);

    const yTitle = locus.mode === "value" ? "f(x*)" : "x*";
    const pad = { l: 56, r: 12, t: 12, b: 30 };
    const plotW = W - pad.l - pad.r, plotH = H - pad.t - pad.b;

    const x0 = Math.min(locus.from, locus.to), x1 = Math.max(locus.from, locus.to);
    if (!(x1 > x0)) return;

    // Y-range from interior, finite points only.
    let y0 = Infinity, y1 = -Infinity;
    for (const s of locus.series) for (const pt of s.points) {
      const y = yOf(pt);
      if (pt.interior && Number.isFinite(y)) { if (y < y0) y0 = y; if (y > y1) y1 = y; }
    }
    if (!Number.isFinite(y0) || !Number.isFinite(y1) || y0 === y1) { y0 -= 1; y1 += 1; }
    const padY = (y1 - y0) * 0.08; y0 -= padY; y1 += padY;

    const sx = (x) => pad.l + ((x - x0) / (x1 - x0)) * plotW;
    const sy = (y) => pad.t + (1 - (y - y0) / (y1 - y0)) * plotH;

    const xt = axisTicks(x0, x1, 6);
    const yt = axisTicks(y0, y1, 5);
    ctx.font = `10px ${T.code.fontFamily}`;

    // Grid.
    ctx.strokeStyle = C.border; ctx.lineWidth = 1;
    for (const tx of xt.ticks) { if (tx < x0 || tx > x1) continue; const X = sx(tx); ctx.beginPath(); ctx.moveTo(X, pad.t); ctx.lineTo(X, pad.t + plotH); ctx.stroke(); }
    for (const ty of yt.ticks) { if (ty < y0 || ty > y1) continue; const Y = sy(ty); ctx.beginPath(); ctx.moveTo(pad.l, Y); ctx.lineTo(pad.l + plotW, Y); ctx.stroke(); }

    // Frame + zero baseline.
    ctx.strokeStyle = C.border2; ctx.lineWidth = 1;
    ctx.beginPath(); ctx.moveTo(pad.l, pad.t); ctx.lineTo(pad.l, pad.t + plotH); ctx.lineTo(pad.l + plotW, pad.t + plotH); ctx.stroke();
    if (y0 < 0 && y1 > 0) { const yz = sy(0); ctx.strokeStyle = C.textMuted || C.border2; ctx.beginPath(); ctx.moveTo(pad.l, yz); ctx.lineTo(pad.l + plotW, yz); ctx.stroke(); }

    // Tick labels.
    ctx.fillStyle = C.textDim; ctx.textAlign = "right"; ctx.textBaseline = "middle";
    for (const ty of yt.ticks) { if (ty < y0 || ty > y1) continue; ctx.fillText(ty.toFixed(yt.decimals), pad.l - 6, sy(ty)); }
    ctx.textAlign = "center"; ctx.textBaseline = "top";
    for (const tx of xt.ticks) { if (tx < x0 || tx > x1) continue; ctx.fillText(tx.toFixed(xt.decimals), sx(tx), pad.t + plotH + 6); }

    // Axis titles.
    ctx.fillStyle = C.text; ctx.font = `11px ${T.code.fontFamily}`;
    ctx.textAlign = "center"; ctx.textBaseline = "bottom";
    ctx.fillText(locus.param, pad.l + plotW / 2, H - 1);
    ctx.save(); ctx.translate(11, pad.t + plotH / 2); ctx.rotate(-Math.PI / 2);
    ctx.textAlign = "center"; ctx.textBaseline = "top"; ctx.fillText(yTitle, 0, 0); ctx.restore();
    ctx.textAlign = "start"; ctx.textBaseline = "alphabetic";

    // Locus lines — break at non-interior / non-finite points.
    const palette = [C.gold || "#c8a96e", C.teal || "#6ec8b4", C.blue || "#6e9ec8"];
    locus.series.forEach((s, i) => {
      ctx.strokeStyle = palette[i % palette.length]; ctx.lineWidth = 1.8;
      ctx.beginPath(); let pen = false;
      for (const pt of s.points) {
        const y = yOf(pt);
        if (!pt.interior || !Number.isFinite(y)) { pen = false; continue; }
        const X = sx(pt.p), Y = sy(y);
        pen ? ctx.lineTo(X, Y) : ctx.moveTo(X, Y); pen = true;
      }
      ctx.stroke();
    });
  }

  if (!locus?.series?.length) return null;
  return (
    <div ref={wrapRef} style={{ width: "100%", fontFamily: T.code.fontFamily, marginTop: 8 }}>
      <div style={{ fontSize: T.caption.fontSize, color: C.gold, letterSpacing: "0.22em", textTransform: "uppercase", marginBottom: 4 }}>
        Optimum locus · {locus.mode === "value" ? "f(x*)" : "x*"} vs {locus.param}
      </div>
      <canvas ref={canvasRef} style={{ display: "block", borderRadius: 6, background: C.bg }} />
    </div>
  );
}
