// ─── ECON STUDIO · src/math/rng.js ────────────────────────────────────────────
// Single source of truth for seeded pseudo-randomness across the Stat &
// Simulation module. Replaces three duplicated mulberry32 copies (SimulateTab,
// StatWorkspace) and the unseeded Math.random in Resampling.js. Pure JS.

// Seeded PRNG. Returns a function () => float in [0,1).
export function mulberry32(seed) {
  let s = seed >>> 0;
  return () => {
    s += 0x6D2B79F5;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// Resolve a seed (null/blank/non-finite → auto-seed) and return both the RNG
// and the resolved integer seed so callers can display "seed used: N" even for
// auto-seeded runs, making them reproducible after the fact.
export function makeRNG(seed) {
  const blank = seed === null || seed === undefined || seed === "";
  const n = Number(seed);
  const resolved = (blank || !isFinite(n))
    ? ((Date.now() ^ Math.floor(Math.random() * 0x100000000)) >>> 0)
    : (n >>> 0);
  return { rand: mulberry32(resolved), seed: resolved };
}

// Integer in [0, nExclusive).
export function randInt(rand, nExclusive) {
  return Math.floor(rand() * nExclusive);
}

// Fisher-Yates. Returns a NEW shuffled array (does not mutate input).
export function shuffle(rand, arr) {
  const a = arr.slice();
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1));
    const t = a[i]; a[i] = a[j]; a[j] = t;
  }
  return a;
}

// m draws with replacement from arr. Returns a NEW array of length m.
export function sampleWithReplacement(rand, arr, m) {
  const out = new Array(m);
  const n = arr.length;
  for (let i = 0; i < m; i++) out[i] = arr[Math.floor(rand() * n)];
  return out;
}
