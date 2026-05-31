// Shared canvas axis helpers for the Equation Workbench plots.
// "Nice numbers" for axis ticks (Heckbert): picks a round step so gridlines land
// on human values (1,2,3… or 0.1,0.2,0.3…) instead of arbitrary fractions.
export function niceNum(range, round) {
  if (!(range > 0)) return 1;
  const exp = Math.floor(Math.log10(range));
  const f = range / Math.pow(10, exp);
  let nf;
  if (round) nf = f < 1.5 ? 1 : f < 3 ? 2 : f < 7 ? 5 : 10;
  else       nf = f <= 1 ? 1 : f <= 2 ? 2 : f <= 5 ? 5 : 10;
  return nf * Math.pow(10, exp);
}

export function axisTicks(lo, hi, maxTicks = 6) {
  if (!(hi > lo)) return { ticks: [lo], step: 1, decimals: 0 };
  const step = niceNum(niceNum(hi - lo, false) / Math.max(1, maxTicks - 1), true);
  const start = Math.ceil(lo / step) * step;
  const ticks = [];
  for (let v = start; v <= hi + step * 1e-6; v += step) {
    ticks.push(Math.abs(v) < step * 1e-6 ? 0 : v); // snap -0 → 0
  }
  const decimals = step < 1 ? Math.min(6, Math.max(0, -Math.floor(Math.log10(step)))) : 0;
  return { ticks, step, decimals };
}
