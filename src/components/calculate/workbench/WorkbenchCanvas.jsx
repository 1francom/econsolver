import { useRef, useEffect } from "react";
import { useTheme } from "../../../ThemeContext.jsx";
import { axisTicks } from "./canvasAxes.js";


// Linear interpolation between two #rrggbb colors (t in [0,1]) → "rgb(r,g,b)".
// Used to ramp the comparative-statics family across the swept parameter.
function mixHex(a, b, t) {
  const pa = parseInt(a.replace("#", ""), 16), pb = parseInt(b.replace("#", ""), 16);
  const ar = (pa >> 16) & 255, ag = (pa >> 8) & 255, ab = pa & 255;
  const br = (pb >> 16) & 255, bg = (pb >> 8) & 255, bb = pb & 255;
  const r = Math.round(ar + (br - ar) * t), g = Math.round(ag + (bg - ag) * t), bl = Math.round(ab + (bb - ab) * t);
  return `rgb(${r},${g},${bl})`;
}

// Draws plot curves + f′ overlays + integral shading + markers for a session.
// Props: equations[], results { [eqId]: { [op]: contract } }, family, conditions, view, height
export default function WorkbenchCanvas({ equations, results, family, conditions, view, height = 460 }) {
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
  }, [equations, results, family, conditions, view, height, C]);

  function draw() {
    const canvas = canvasRef.current, wrap = wrapRef.current;
    if (!canvas || !wrap) return;
    const dpr = window.devicePixelRatio || 1;
    const W = wrap.clientWidth, H = Number.isFinite(height) ? height : 460;
    canvas.width = W * dpr; canvas.height = H * dpr;
    canvas.style.width = W + "px"; canvas.style.height = H + "px";
    const ctx = canvas.getContext("2d");
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    // Paint the background so PNG export is opaque (toDataURL captures pixels,
    // not the CSS background).
    ctx.fillStyle = C.bg; ctx.fillRect(0, 0, W, H);

    // Axis-title labels claim extra margin so tick labels never collide.
    const xLabel = (view.xLabel || "").trim();
    const yLabel = (view.yLabel || "").trim();
    const pad = { l: 48 + (yLabel ? 16 : 0), r: 14, t: 14, b: 28 + (xLabel ? 16 : 0) };
    const plotW = W - pad.l - pad.r, plotH = H - pad.t - pad.b;

    // Collect all curves to derive Y-range. Include the f′ overlay so the
    // derivative is never clipped out of view alongside the objective.
    const objectives = equations.filter((e) => e.kind !== "constraint");
    const allPts = [];
    for (const eq of objectives) {
      const r = results[eq.id];
      if (r?.plot?.numeric?.points) allPts.push(...r.plot.numeric.points);
      if (r?.deriv?.numeric?.points) allPts.push(...r.deriv.numeric.points);
    }
    // Family curves widen the auto Y-range so swept curves are never clipped.
    if (family?.curves) for (const c of family.curves) allPts.push(...c.points);
    const [x0, x1] = view.xRange;
    if (!Number.isFinite(x0) || !Number.isFinite(x1) || x0 === x1) return; // degenerate x-range → blank
    let y0 = Infinity, y1 = -Infinity;
    for (const p of allPts) { if (p.y < y0) y0 = p.y; if (p.y > y1) y1 = p.y; }
    if (!Number.isFinite(y0) || !Number.isFinite(y1) || y0 === y1) { y0 = -1; y1 = 1; }
    const padY = (y1 - y0) * 0.08; y0 -= padY; y1 += padY;

    // Manual y-range override (ViewControls) takes precedence over auto-scale.
    // Each endpoint is independent: a partial override (e.g. y max only) clamps
    // just that side and leaves the other auto-scaled.
    const yr = view.yRange;
    if (Array.isArray(yr)) {
      if (Number.isFinite(yr[0])) y0 = yr[0];
      if (Number.isFinite(yr[1])) y1 = yr[1];
    }
    if (!(y1 > y0)) { y0 = -1; y1 = 1; }

    const sx = (x) => pad.l + ((x - x0) / (x1 - x0)) * plotW;
    const sy = (y) => pad.t + (1 - (y - y0) / (y1 - y0)) * plotH;

    // Gridlines + ticks at "nice" round values on both axes (Heckbert).
    const xt = axisTicks(x0, x1, 7);
    const yt = axisTicks(y0, y1, 6);
    ctx.font = `10px ${mono}`;

    // Hairline grid behind everything.
    ctx.strokeStyle = C.border; ctx.lineWidth = 1;
    for (const tx of xt.ticks) {
      if (tx < x0 || tx > x1) continue;
      const X = sx(tx);
      ctx.beginPath(); ctx.moveTo(X, pad.t); ctx.lineTo(X, pad.t + plotH); ctx.stroke();
    }
    for (const ty of yt.ticks) {
      if (ty < y0 || ty > y1) continue;
      const Y = sy(ty);
      ctx.beginPath(); ctx.moveTo(pad.l, Y); ctx.lineTo(pad.l + plotW, Y); ctx.stroke();
    }

    // Plot frame.
    ctx.strokeStyle = C.border2; ctx.lineWidth = 1;
    ctx.beginPath(); ctx.moveTo(pad.l, pad.t); ctx.lineTo(pad.l, pad.t + plotH); ctx.lineTo(pad.l + plotW, pad.t + plotH); ctx.stroke();

    // Emphasized zero baseline when it falls inside the y-range.
    if (y0 < 0 && y1 > 0) {
      const yz = sy(0);
      ctx.strokeStyle = C.textMuted || C.border2; ctx.lineWidth = 1;
      ctx.beginPath(); ctx.moveTo(pad.l, yz); ctx.lineTo(pad.l + plotW, yz); ctx.stroke();
    }

    // Tick labels.
    ctx.fillStyle = C.textDim;
    ctx.textAlign = "right"; ctx.textBaseline = "middle";
    for (const ty of yt.ticks) {
      if (ty < y0 || ty > y1) continue;
      ctx.fillText(ty.toFixed(yt.decimals), pad.l - 6, sy(ty));
    }
    ctx.textAlign = "center"; ctx.textBaseline = "top";
    for (const tx of xt.ticks) {
      if (tx < x0 || tx > x1) continue;
      const X = sx(tx);
      ctx.strokeStyle = C.border2; ctx.beginPath(); ctx.moveTo(X, pad.t + plotH); ctx.lineTo(X, pad.t + plotH + 3); ctx.stroke();
      ctx.fillText(tx.toFixed(xt.decimals), X, pad.t + plotH + 6);
    }
    ctx.textAlign = "start"; ctx.textBaseline = "alphabetic";

    // Axis titles.
    if (xLabel || yLabel) {
      ctx.fillStyle = C.text; ctx.font = `11px ${mono}`;
      if (xLabel) {
        ctx.textAlign = "center"; ctx.textBaseline = "bottom";
        ctx.fillText(xLabel, pad.l + plotW / 2, H - 2);
      }
      if (yLabel) {
        ctx.save();
        ctx.translate(12, pad.t + plotH / 2);
        ctx.rotate(-Math.PI / 2);
        ctx.textAlign = "center"; ctx.textBaseline = "top";
        ctx.fillText(yLabel, 0, 0);
        ctx.restore();
      }
      ctx.textAlign = "start"; ctx.textBaseline = "alphabetic";
    }

    // User reference lines (geom_vline / geom_hline). Drawn behind the curves so
    // they read as annotations. "v" → vertical at x=value, "h" → horizontal at y.
    const refLines = Array.isArray(view.refLines) ? view.refLines : [];
    ctx.font = `10px ${mono}`;
    for (const l of refLines) {
      if (!Number.isFinite(l.value)) continue;
      const color = l.kind === "v" ? (C.blue || "#6e9ec8") : (C.gold || "#c8a96e");
      ctx.strokeStyle = color; ctx.lineWidth = 1.2; ctx.setLineDash([5, 4]);
      ctx.beginPath();
      if (l.kind === "v") {
        if (l.value < x0 || l.value > x1) { ctx.setLineDash([]); continue; }
        const X = sx(l.value);
        ctx.moveTo(X, pad.t); ctx.lineTo(X, pad.t + plotH); ctx.stroke();
        if (l.label) { ctx.fillStyle = color; ctx.textAlign = "left"; ctx.textBaseline = "top"; ctx.fillText(l.label, X + 3, pad.t + 2); }
      } else {
        if (l.value < y0 || l.value > y1) { ctx.setLineDash([]); continue; }
        const Y = sy(l.value);
        ctx.moveTo(pad.l, Y); ctx.lineTo(pad.l + plotW, Y); ctx.stroke();
        if (l.label) { ctx.fillStyle = color; ctx.textAlign = "right"; ctx.textBaseline = "bottom"; ctx.fillText(l.label, pad.l + plotW - 3, Y - 2); }
      }
      ctx.setLineDash([]);
    }
    ctx.textAlign = "start"; ctx.textBaseline = "alphabetic";

    // Comparative-statics family: one thin curve per swept value, ramped
    // teal→gold by the parameter, drawn behind the primary curve.
    if (family?.curves?.length) {
      const span = family.pMax - family.pMin;
      ctx.lineWidth = 1.1;
      for (const c of family.curves) {
        const t = span > 0 ? (c.p - family.pMin) / span : 0.5;
        ctx.strokeStyle = mixHex(C.teal || "#6ec8b4", C.gold || "#c8a96e", t);
        ctx.globalAlpha = 0.55;
        ctx.beginPath();
        c.points.forEach((p, k) => { const X = sx(p.x), Y = sy(p.y); k ? ctx.lineTo(X, Y) : ctx.moveTo(X, Y); });
        ctx.stroke();
      }
      ctx.globalAlpha = 1;
    }

    const palette = [C.teal, C.gold, C.blue];

    objectives.forEach((eq, i) => {
      const color = eq.color || palette[i % 3];
      const r = results[eq.id];
      if (!r) return;

      // Integral shading first so curves sit on top. Welfare mode (finite ref):
      // shade between the curve and the y=ref baseline, green above / red below,
      // per segment split at the crossing. Plain mode: gold fill down to y=0.
      if (r.integral?.numeric?.points?.length) {
        const pts = r.integral.numeric.points;
        const ref = r.integral.numeric.ref;
        if (Number.isFinite(ref)) {
          const yb = sy(ref);
          const green = (C.teal || "#6ec8b4") + "30";
          const red = (C.red || "#c86e6e") + "30";
          for (let k = 1; k < pts.length; k++) {
            const p0 = pts[k - 1], p1 = pts[k];
            const d0 = p0.y - ref, d1 = p1.y - ref;
            const fillSeg = (xa, ya, xb, yb2, above) => {
              ctx.fillStyle = above ? green : red;
              ctx.beginPath(); ctx.moveTo(sx(xa), yb); ctx.lineTo(sx(xa), sy(ya));
              ctx.lineTo(sx(xb), sy(yb2)); ctx.lineTo(sx(xb), yb); ctx.closePath(); ctx.fill();
            };
            if ((d0 >= 0 && d1 >= 0) || (d0 <= 0 && d1 <= 0)) {
              fillSeg(p0.x, p0.y, p1.x, p1.y, d0 + d1 >= 0);
            } else {
              const t = d0 / (d0 - d1), xc = p0.x + t * (p1.x - p0.x);
              fillSeg(p0.x, p0.y, xc, ref, d0 >= 0);
              fillSeg(xc, ref, p1.x, p1.y, d1 >= 0);
            }
          }
          // Reference baseline.
          ctx.strokeStyle = C.gold || "#c8a96e"; ctx.lineWidth = 1; ctx.setLineDash([4, 3]);
          ctx.beginPath(); ctx.moveTo(sx(pts[0].x), yb); ctx.lineTo(sx(pts[pts.length - 1].x), yb); ctx.stroke(); ctx.setLineDash([]);
        } else {
          ctx.fillStyle = (C.gold || "#c8a96e") + "22";
          ctx.beginPath(); ctx.moveTo(sx(pts[0].x), sy(0));
          for (const p of pts) ctx.lineTo(sx(p.x), sy(p.y));
          ctx.lineTo(sx(pts[pts.length - 1].x), sy(0)); ctx.closePath(); ctx.fill();
        }
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
      if (opt && opt.mode === "unconstrained" && opt.interior !== false && Number.isFinite(opt.x) && Number.isFinite(opt.value)) {
        ctx.fillStyle = eq.optColor || C.red || "#c86e6e";
        ctx.beginPath(); ctx.arc(sx(opt.x), sy(opt.value), 4.5, 0, Math.PI * 2); ctx.fill();
      }
    });

    // Condition markers (item C). Single-variable level intersections that solve
    // for the plot axis render a blue ✕ at (x*, f(x*)); derivative-only single-var
    // conditions render a labeled vertical tick at x*. Multi-var systems carry no
    // marker (readout only).
    if (Array.isArray(conditions) && conditions.length) {
      const blue = C.blue || "#6e9ec8";
      ctx.font = `10px ${mono}`;
      for (const cond of conditions) {
        if (cond.error || !cond.markKind || !cond.points?.length) continue;
        for (const pt of cond.points) {
          if (!Number.isFinite(pt.x) || pt.x < x0 || pt.x > x1) continue;
          const X = sx(pt.x);
          if (cond.markKind === "point" && Number.isFinite(pt.y) && pt.y >= y0 && pt.y <= y1) {
            const Y = sy(pt.y);
            ctx.fillStyle = blue;
            ctx.beginPath(); ctx.arc(X, Y, 4.5, 0, Math.PI * 2); ctx.fill();
            if (pt.label) { ctx.fillStyle = blue; ctx.textAlign = "left"; ctx.textBaseline = "bottom"; ctx.fillText(pt.label, X + 7, Y - 5); }
          } else {
            ctx.strokeStyle = blue; ctx.lineWidth = 1.2; ctx.setLineDash([4, 3]);
            ctx.beginPath(); ctx.moveTo(X, pad.t); ctx.lineTo(X, pad.t + plotH); ctx.stroke(); ctx.setLineDash([]);
            if (pt.label) { ctx.fillStyle = blue; ctx.textAlign = "left"; ctx.textBaseline = "top"; ctx.fillText(pt.label, X + 3, pad.t + 2); }
          }
        }
      }
      ctx.textAlign = "start"; ctx.textBaseline = "alphabetic";
    }

    // Family legend (top-left): swatch + "param = value" per swept curve.
    if (family?.curves?.length) {
      const span = family.pMax - family.pMin;
      const dec = span > 0 && span < 10 ? 2 : span < 100 ? 1 : 0;
      const seen = new Map(); // p → color (dedupe across equations)
      for (const c of family.curves) {
        if (seen.has(c.p)) continue;
        const t = span > 0 ? (c.p - family.pMin) / span : 0.5;
        seen.set(c.p, mixHex(C.teal || "#6ec8b4", C.gold || "#c8a96e", t));
      }
      const entries = [...seen.entries()].sort((a, b) => a[0] - b[0]);
      ctx.font = `10px ${mono}`; ctx.textAlign = "left"; ctx.textBaseline = "middle";
      let ly = pad.t + 8;
      for (const [p, color] of entries) {
        ctx.strokeStyle = color; ctx.lineWidth = 2;
        ctx.beginPath(); ctx.moveTo(pad.l + 6, ly); ctx.lineTo(pad.l + 22, ly); ctx.stroke();
        ctx.fillStyle = C.textDim || "#888";
        ctx.fillText(`${family.param} = ${p.toFixed(dec)}`, pad.l + 27, ly);
        ly += 14;
      }
      ctx.textAlign = "start"; ctx.textBaseline = "alphabetic";
    }

    // Free-text annotations at (x, y) data coordinates, drawn on top of everything.
    // Clipped to the plot area so a label dragged off-range doesn't bleed into the
    // axis margins.
    const anns = Array.isArray(view.annotations) ? view.annotations : [];
    if (anns.length) {
      ctx.save();
      ctx.beginPath(); ctx.rect(pad.l, pad.t, plotW, plotH); ctx.clip();
      ctx.font = `11px ${mono}`;
      ctx.textAlign = "center"; ctx.textBaseline = "middle";
      for (const a of anns) {
        if (!Number.isFinite(a.x) || !Number.isFinite(a.y) || !a.text) continue;
        if (a.x < x0 || a.x > x1 || a.y < y0 || a.y > y1) continue;
        ctx.fillStyle = a.color || C.text;
        ctx.fillText(a.text, sx(a.x), sy(a.y));
      }
      ctx.restore();
      ctx.textAlign = "start"; ctx.textBaseline = "alphabetic";
    }
  }

  // Static PNG export at full device resolution (canvas is dpr-scaled). The
  // background is painted in draw(), so the export is opaque.
  function exportPng() {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const a = document.createElement("a");
    a.href = canvas.toDataURL("image/png");
    a.download = "plot.png";
    a.click();
  }

  const hasObjective = equations.some((e) => e.kind !== "constraint");
  return (
    <div ref={wrapRef} style={{ width: "100%", fontFamily: T.code.fontFamily, position: "relative" }}>
      {!hasObjective && (
        <div style={{ fontSize: T.code.fontSize, color: C.textDim || "#888", padding: "6px 0" }}>
          Add an objective equation with an axis to plot.
        </div>
      )}
      {hasObjective && (
        <button onClick={exportPng} title="Export plot as PNG"
          style={{ position: "absolute", top: 6, right: 8, zIndex: 1, fontSize: T.caption.fontSize,
            padding: "3px 8px", borderRadius: 4, cursor: "pointer", background: C.surface2,
            color: C.text, border: `1px solid ${C.border2}`, fontFamily: T.code.fontFamily, fontWeight: 600 }}>
          ↓ PNG
        </button>
      )}
      <canvas ref={canvasRef} style={{ display: "block", borderRadius: 6, background: C.bg }} />
    </div>
  );
}
