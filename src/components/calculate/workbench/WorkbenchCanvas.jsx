import { useRef, useEffect } from "react";
import { useTheme } from "../../../ThemeContext.jsx";

const mono = "'IBM Plex Mono', monospace";

// Draws plot curves + f′ overlays + integral shading + markers for a session.
// Props: equations[], results { [eqId]: { [op]: contract } }, view
export default function WorkbenchCanvas({ equations, results, view }) {
  const { C } = useTheme();
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
  }, [equations, results, view, C]);

  function draw() {
    const canvas = canvasRef.current, wrap = wrapRef.current;
    if (!canvas || !wrap) return;
    const dpr = window.devicePixelRatio || 1;
    const W = wrap.clientWidth, H = 320;
    canvas.width = W * dpr; canvas.height = H * dpr;
    canvas.style.width = W + "px"; canvas.style.height = H + "px";
    const ctx = canvas.getContext("2d");
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, W, H);

    const pad = { l: 44, r: 14, t: 14, b: 28 };
    const plotW = W - pad.l - pad.r, plotH = H - pad.t - pad.b;

    // Collect all curves to derive Y-range.
    const objectives = equations.filter((e) => e.kind !== "constraint");
    const allPts = [];
    for (const eq of objectives) {
      const r = results[eq.id];
      if (r?.plot?.numeric?.points) allPts.push(...r.plot.numeric.points);
    }
    const [x0, x1] = view.xRange;
    if (!Number.isFinite(x0) || !Number.isFinite(x1) || x0 === x1) return; // degenerate x-range → blank
    let y0 = Infinity, y1 = -Infinity;
    for (const p of allPts) { if (p.y < y0) y0 = p.y; if (p.y > y1) y1 = p.y; }
    if (!Number.isFinite(y0) || !Number.isFinite(y1) || y0 === y1) { y0 = -1; y1 = 1; }
    const padY = (y1 - y0) * 0.08; y0 -= padY; y1 += padY;

    const sx = (x) => pad.l + ((x - x0) / (x1 - x0)) * plotW;
    const sy = (y) => pad.t + (1 - (y - y0) / (y1 - y0)) * plotH;

    // Axes.
    ctx.strokeStyle = C.line || "#222"; ctx.lineWidth = 1;
    ctx.beginPath(); ctx.moveTo(pad.l, pad.t); ctx.lineTo(pad.l, pad.t + plotH); ctx.lineTo(pad.l + plotW, pad.t + plotH); ctx.stroke();
    if (y0 < 0 && y1 > 0) { const yz = sy(0); ctx.strokeStyle = (C.line || "#222"); ctx.beginPath(); ctx.moveTo(pad.l, yz); ctx.lineTo(pad.l + plotW, yz); ctx.stroke(); }
    ctx.fillStyle = C.textDim || "#888"; ctx.font = `10px ${mono}`;
    ctx.fillText(y1.toFixed(2), 4, pad.t + 8);
    ctx.fillText(y0.toFixed(2), 4, pad.t + plotH);
    ctx.fillText(String(x0), pad.l, H - 8);
    ctx.fillText(String(x1), pad.l + plotW - 18, H - 8);

    const palette = [C.teal, C.gold, C.blue];

    objectives.forEach((eq, i) => {
      const color = palette[i % 3];
      const r = results[eq.id];
      if (!r) return;

      // Integral shading (under curve, gold-tinted) first so curves sit on top.
      if (r.integral?.numeric?.points?.length) {
        ctx.fillStyle = (C.gold || "#c8a96e") + "22";
        const pts = r.integral.numeric.points;
        ctx.beginPath(); ctx.moveTo(sx(pts[0].x), sy(0));
        for (const p of pts) ctx.lineTo(sx(p.x), sy(p.y));
        ctx.lineTo(sx(pts[pts.length - 1].x), sy(0)); ctx.closePath(); ctx.fill();
      }

      // Plot curve.
      if (r.plot?.numeric?.points?.length) {
        ctx.strokeStyle = color; ctx.lineWidth = 1.6; ctx.beginPath();
        r.plot.numeric.points.forEach((p, k) => { const X = sx(p.x), Y = sy(p.y); k ? ctx.lineTo(X, Y) : ctx.moveTo(X, Y); });
        ctx.stroke();
      }

      // f′ dashed overlay.
      if (r.deriv?.numeric?.points?.length) {
        ctx.strokeStyle = color; ctx.lineWidth = 1; ctx.setLineDash([4, 3]); ctx.globalAlpha = 0.7; ctx.beginPath();
        r.deriv.numeric.points.forEach((p, k) => { const X = sx(p.x), Y = sy(p.y); k ? ctx.lineTo(X, Y) : ctx.moveTo(X, Y); });
        ctx.stroke(); ctx.setLineDash([]); ctx.globalAlpha = 1;
      }

      // Root markers (red circles).
      if (r.solveZero?.numeric?.roots?.length) {
        ctx.strokeStyle = C.red || "#c86e6e"; ctx.lineWidth = 1.4;
        for (const root of r.solveZero.numeric.roots) {
          ctx.beginPath(); ctx.arc(sx(root), sy(0), 4, 0, Math.PI * 2); ctx.stroke();
        }
      }

      // Optimum marker (filled red dot) for unconstrained optimize.
      const opt = r.optimize?.numeric;
      if (opt && opt.mode === "unconstrained" && Number.isFinite(opt.x) && Number.isFinite(opt.value)) {
        ctx.fillStyle = C.red || "#c86e6e";
        ctx.beginPath(); ctx.arc(sx(opt.x), sy(opt.value), 4.5, 0, Math.PI * 2); ctx.fill();
      }
    });
  }

  const hasObjective = equations.some((e) => e.kind !== "constraint");
  return (
    <div ref={wrapRef} style={{ width: "100%", fontFamily: mono }}>
      {!hasObjective && (
        <div style={{ fontSize: 11, color: C.textDim || "#888", padding: "6px 0" }}>
          Add an objective equation with an axis to plot.
        </div>
      )}
      <canvas ref={canvasRef} style={{ display: "block", borderRadius: 6, background: C.bg }} />
    </div>
  );
}
