// ─── ECON STUDIO · src/math/dgpDraw.js ───────────────────────────────────────
// Pure, React-free, side-effect-free random/deterministic column generators for
// the Simulate-tab DGP builder. Single source of truth imported by BOTH the main
// thread (SimulateTab.jsx, dead local buildScope) and the expression worker
// (workers/exprEval.worker.js) — so the preview and the worker-generated dataset
// can never drift apart.
//
// The PRNG is injected as `rng` (a () => number in [0,1)); callers supply their
// own seeded stream (rng.js mulberry32).

// Box-Muller using the injected rng.
export function normalSample(rng, mean, sd) {
  const u1 = rng(), u2 = rng();
  const z = Math.sqrt(-2 * Math.log(u1 + 1e-15)) * Math.cos(2 * Math.PI * u2);
  return mean + sd * z;
}

// Coerce a categorical level token: numeric-looking labels become numbers (so
// sample(c(0,1,2)) behaves as numeric factor codes), everything else stays a
// string.
export function coerceLevel(label) {
  const s = String(label);
  return /^-?\d*\.?\d+(?:e-?\d+)?$/i.test(s.trim()) ? Number(s) : s;
}

// Parse Categorical params into cleaned levels + normalized probabilities.
export function parseLevels(params) {
  const levels = String(params.levels ?? "").split(",").map(s => s.trim()).filter(s => s.length);
  let probs = String(params.probs ?? "").split(",").map(s => parseFloat(s)).filter(x => isFinite(x) && x >= 0);
  if (probs.length !== levels.length) probs = levels.map(() => 1);
  const sum = probs.reduce((a, b) => a + b, 0) || 1;
  return { levels, probs: probs.map(p => p / sum) };
}

// Draw n values for a single distribution variable. `rng` is only consumed by
// the stochastic branches; GroupID/CycleID are deterministic on the row index.
export function drawSamples(rng, n, dist, params) {
  const arr = [];
  const cat = dist === "Categorical" ? parseLevels(params) : null;
  for (let i = 0; i < n; i++) {
    const u = rng();
    switch (dist) {
      case "Normal":      arr.push(normalSample(rng, +(params.mean ?? 0), +(params.sd ?? 1))); break;
      case "Uniform":     arr.push((+(params.min ?? 0)) + u * ((+(params.max ?? 1)) - (+(params.min ?? 0)))); break;
      case "Bernoulli":   arr.push(u < (+(params.p ?? 0.5)) ? 1 : 0); break;
      case "Poisson": {
        const lam = +(params.lambda ?? 1), L = Math.exp(-lam);
        let k = 0, p = 1;
        do { k++; p *= rng(); } while (p > L);
        arr.push(k - 1); break;
      }
      case "Exponential": arr.push(-Math.log(1 - u + 1e-15) / (+(params.lambda ?? 1))); break;
      case "t": {
        const df = +(params.df ?? 5);
        const z1 = normalSample(rng, 0, 1);
        let chi = 0;
        for (let j = 0; j < df; j++) { const z = normalSample(rng, 0, 1); chi += z * z; }
        arr.push(z1 / Math.sqrt(chi / df)); break;
      }
      case "Chi-squared": {
        const df2 = +(params.df ?? 3);
        let chi2 = 0;
        for (let j = 0; j < df2; j++) { const z = normalSample(rng, 0, 1); chi2 += z * z; }
        arr.push(chi2); break;
      }
      case "Categorical": {
        if (!cat.levels.length) { arr.push(null); break; }
        let acc = 0, pick = cat.levels[cat.levels.length - 1];
        for (let k = 0; k < cat.levels.length; k++) { acc += cat.probs[k]; if (u <= acc) { pick = cat.levels[k]; break; } }
        const asCode = params.asCode === true || params.asCode === "true";
        arr.push(asCode ? cat.levels.indexOf(pick) : coerceLevel(pick));
        break;
      }
      case "GroupID": {
        const G = Math.max(1, Math.floor(+(params.groups ?? 1) || 1));
        const blockSize = Math.max(1, Math.ceil(n / G));
        arr.push(Math.floor(i / blockSize) + 1);
        break;
      }
      case "CycleID": {
        const T = Math.max(1, Math.floor(+(params.period ?? 1) || 1));
        arr.push((i % T) + 1);
        break;
      }
      default: arr.push(0);
    }
  }
  return arr;
}
