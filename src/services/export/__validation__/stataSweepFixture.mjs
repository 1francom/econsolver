// ─── ECON STUDIO · stataSweepFixture.mjs ─────────────────────────────────────
// Deterministic 40-unit × 10-period panel shared by the estimator export
// harnesses. Seeded LCG, so every run — and R/Stata reading fx.csv — sees the
// same numbers. Columns cover every estimator in the sweep:
//   id / ids (numeric / string panel id), t, g (first treatment, 0 = never,
//   the Callaway-Sant'Anna convention), gev (same with blank = never, the
//   Event Study convention), x x2 (exogenous), z1 z2 (instruments), d
//   (endogenous), w (weights), treat post (2×2 DiD), D (staggered absorbing
//   treatment), run take (RDD running variable / fuzzy take-up), y, yb
//   (binary), yc (count), cl (cluster nesting id).

export function buildSweepRows() {
  let s = 12345;
  const rnd = () => (s = (s * 1103515245 + 12345) % 2147483648) / 2147483648;
  const nrm = () => Math.sqrt(-2 * Math.log(rnd() + 1e-12)) * Math.cos(2 * Math.PI * rnd());
  const rows = [];
  for (let i = 1; i <= 40; i++) {
    const a = nrm();
    const g = i <= 12 ? 5 : i <= 24 ? 8 : 0;
    for (let t = 1; t <= 10; t++) {
      const x = nrm() + 0.3 * a, x2 = nrm(), z1 = nrm(), z2 = nrm();
      const u = nrm();
      const d = 0.8 * z1 + 0.5 * z2 + 0.5 * u + nrm();
      const treat = i <= 20 ? 1 : 0, post = t >= 6 ? 1 : 0;
      const D = g > 0 && t >= g ? 1 : 0;
      const run = rnd() * 2 - 1;
      const above = run >= 0 ? 1 : 0;
      const take = rnd() < (above ? 0.8 : 0.2) ? 1 : 0;
      const w = 0.5 + rnd() * 2;
      const y = 1 + 2 * x - x2 + 1.5 * d + a + 0.1 * t + 2 * treat * post + 3 * D
              + 1.2 * above + 0.8 * run + 2 * take + u;
      const yb = (0.5 * x - 0.4 * x2 + nrm()) > 0 ? 1 : 0;
      const yc = Math.floor(Math.exp(0.3 + 0.4 * x - 0.2 * x2 + 0.3 * a) * (0.5 + rnd()));
      rows.push({ id: i, ids: `u${String(i).padStart(2, "0")}`, t, g, gev: g > 0 ? g : null,
        x, x2, z1, z2, d, w, treat, post, D, run, take, y, yb, yc, cl: (i % 8) + 1 });
    }
  }
  return rows;
}

export function rowsToCsv(rows) {
  const cols = Object.keys(rows[0]);
  return [cols.join(","), ...rows.map(r => cols.map(c => r[c] ?? "").join(","))].join("\n");
}
