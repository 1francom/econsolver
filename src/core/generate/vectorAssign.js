// ECON STUDIO - core/generate/vectorAssign.js
// Pure, React-free assignment of a value vector across rows.
// Deterministic: all randomness flows through a seeded mulberry32 RNG so the
// non-destructive pipeline reproduces identical output on every replay.

// Seeded PRNG - returns a function producing floats in [0, 1).
export function mulberry32(seed) {
  let a = (seed >>> 0) || 1;
  return function () {
    a |= 0; a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// Normalize weights to a probability vector summing to 1.
// null/empty or any non-positive sum -> uniform.
function normalizeWeights(weights, n) {
  if (!Array.isArray(weights) || weights.length !== n) {
    return Array(n).fill(1 / n);
  }
  const clean = weights.map(w => (typeof w === "number" && w > 0 ? w : 0));
  const sum = clean.reduce((a, b) => a + b, 0);
  if (sum <= 0) return Array(n).fill(1 / n);
  return clean.map(w => w / sum);
}

// Weighted pick from `values` given cumulative probs and a uniform draw u.
function weightedPick(values, cum, u) {
  for (let i = 0; i < cum.length; i++) { if (u <= cum[i]) return values[i]; }
  return values[values.length - 1];
}

// Largest-remainder integer quota so counts sum exactly to total.
export function computeQuota(total, probs) {
  const raw = probs.map(p => p * total);
  const floors = raw.map(Math.floor);
  const assigned = floors.reduce((a, b) => a + b, 0);
  const remainder = total - assigned;
  const fracOrder = raw
    .map((v, i) => ({ i, frac: v - Math.floor(v) }))
    .sort((a, b) => b.frac - a.frac);
  const counts = floors.slice();
  for (let k = 0; k < remainder; k++) counts[fracOrder[k % fracOrder.length].i]++;
  return counts;
}

// Seeded Fisher-Yates shuffle (in place), returns the array.
function shuffle(arr, rng) {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}

// Main entry. Returns an array of assigned values, one per row.
//
// opts = {
//   values: string[]            // value pool (required, non-empty)
//   mode: "random"|"conditional"|"recycle"|"quota"
//   weights?: number[]|null     // random/quota
//   seed?: number               // random/quota (default 42)
//   evalRule?: (row, idx) => value | undefined   // conditional: caller supplies
//                                                // evaluator; undefined = no match
//   elseValue?: any             // conditional fallback
// }
export function assignVector(rows, opts) {
  const { values, mode } = opts;
  const n = rows.length;
  if (!Array.isArray(values) || values.length === 0) return Array(n).fill(null);
  const seed = Number.isFinite(opts.seed) ? opts.seed : 42;

  if (mode === "recycle") {
    return rows.map((_, i) => values[i % values.length]);
  }

  if (mode === "conditional") {
    const evalRule = opts.evalRule || (() => undefined);
    const elseValue = opts.elseValue ?? null;
    return rows.map((r, i) => {
      const v = evalRule(r, i);
      return v === undefined ? elseValue : v;
    });
  }

  const probs = normalizeWeights(opts.weights, values.length);

  if (mode === "quota") {
    const counts = computeQuota(n, probs);
    const pool = [];
    counts.forEach((c, i) => { for (let k = 0; k < c; k++) pool.push(values[i]); });
    shuffle(pool, mulberry32(seed));
    return pool;
  }

  // default: random weighted draw per row
  const rng = mulberry32(seed);
  const cum = [];
  probs.reduce((acc, p, i) => (cum[i] = acc + p), 0);
  return rows.map(() => weightedPick(values, cum, rng()));
}
