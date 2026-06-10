// Pure row-wise expression helpers shared by the Clean worker and DGP builder.
export const HELPERS = {
  ifelse:    (cond, a, b) => cond ? a : b,
  log:       x => (typeof x === "number" && x > 0) ? Math.log(x) : null,
  log10:     x => (typeof x === "number" && x > 0) ? Math.log10(x) : null,
  log2:      x => (typeof x === "number" && x > 0) ? Math.log2(x) : null,
  sqrt:      x => (typeof x === "number" && x >= 0) ? Math.sqrt(x) : null,
  abs:       x => typeof x === "number" ? Math.abs(x) : null,
  sign:      x => typeof x === "number" ? Math.sign(x) : null,
  round:     (x, d = 0) => typeof x === "number" ? +x.toFixed(d) : null,
  floor:     x => typeof x === "number" ? Math.floor(x) : null,
  ceiling:   x => typeof x === "number" ? Math.ceil(x) : null,
  exp:       x => typeof x === "number" ? Math.exp(x) : null,
  coalesce:  (...args) => args.find(v => v !== null && v !== undefined) ?? null,
  pmin:      (a, b) => (typeof a === "number" && typeof b === "number") ? Math.min(a, b) : null,
  pmax:      (a, b) => (typeof a === "number" && typeof b === "number") ? Math.max(a, b) : null,
  clamp:     (x, lo, hi) => typeof x === "number" ? Math.max(lo, Math.min(hi, x)) : null,
  rescale:   (x, oMin, oMax, nMin = 0, nMax = 1) =>
    (typeof x === "number" && oMax !== oMin)
      ? (nMin + (x - oMin) * (nMax - nMin) / (oMax - oMin))
      : null,
  case_when: (...pairs) => {
    for (let i = 0; i < pairs.length - 1; i += 2) { if (pairs[i]) return pairs[i + 1]; }
    return pairs.length % 2 === 1 ? pairs[pairs.length - 1] : null;
  },
  cut: (x, breaks, labels) => {
    if (typeof x !== "number" || !Array.isArray(breaks)) return null;
    let i = 0; while (i < breaks.length && x >= breaks[i]) i++;
    return Array.isArray(labels) ? (labels[i] ?? null) : i;
  },
  pick: (u, probs, labels) => {
    if (typeof u !== "number" || !Array.isArray(probs)) return null;
    let acc = 0; for (let i = 0; i < probs.length; i++) { acc += probs[i]; if (u < acc) return (labels?.[i] ?? i); }
    return labels?.[probs.length - 1] ?? probs.length - 1;
  },
};
