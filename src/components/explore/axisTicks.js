// ─── ECON STUDIO · components/explore/axisTicks.js ──────────────────────────
// "Nice" axis ticks for Explore's hand-drawn SVG charts.
//
// Its own file because both the single-series and the multi-series time-series
// charts draw from it: a private copy in each is how two views of the same data
// end up with different axis conventions.

export function niceTicks(lo, hi, n = 5) {
  const range = hi - lo;
  if (!range || !isFinite(range)) return [lo];
  const step = Math.pow(10, Math.floor(Math.log10(range / n)));
  const nice = [1, 2, 2.5, 5, 10].find(s => range / (s * step) <= n) * step;
  const start = Math.ceil(lo / nice) * nice;
  const out = [];
  for (let v = start; v <= hi + nice * 0.01; v += nice) out.push(parseFloat(v.toFixed(10)));
  return out.length >= 2 ? out : [lo, hi];
}
