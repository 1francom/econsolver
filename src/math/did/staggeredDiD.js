// ─── ECON STUDIO · src/math/did/staggeredDiD.js ──────────────────────────────
// Staggered DiD cell enumeration, control-set selection, and aggregation.
// Pure math. No React. No side effects.
//
// Task 2 of Callaway-Sant'Anna rewrite:
//   - enumerateCells: all (g,t,b) cells with varying/universal base periods
//   - controlSet: never-treated vs not-yet-treated control groups
//
// Task 3 of Callaway-Sant'Anna rewrite:
//   - aggregate: 4 aggregation schemes (simple, dynamic, group, calendar)
//               + analytic/Mammen-bootstrap inference + Wald pre-test

import { matInv } from "../LinearEngine.js";

// Enumerate all estimable (g,t,b) cells for staggered DiD.
export function enumerateCells({ tlist: _tlist, glist, anticipation = 0, basePeriod = "varying" }) {
  const tlist = [..._tlist].sort((a, b) => a - b);
  const cells = [];

  for (const g of glist) {
    const gStar = g - anticipation;

    // Find the universal base period for this cohort
    // (largest time point before cohort treatment)
    const bUniversal = tlist.filter(t => t < gStar).at(-1);
    if (bUniversal === undefined) {
      // No estimable base period for this cohort; skip it
      continue;
    }

    if (basePeriod === "universal") {
      // Emit the reference cell (g, b_universal, b_universal)
      cells.push({
        g,
        t: bUniversal,
        b: bUniversal,
        e: bUniversal - g,
        isPre: true,
        isRef: true,
      });
    }

    // Emit all other (g,t) pairs
    for (const t of tlist) {
      // Skip the base period in universal mode (already emitted above as reference)
      if (basePeriod === "universal" && t === bUniversal) {
        continue;
      }

      const isPost = t >= gStar;
      let b;

      if (basePeriod === "universal") {
        // Use fixed universal base for all t
        b = bUniversal;
      } else {
        // "varying": choose largest time < t
        if (isPost) {
          // For post-treatment, b is always the universal base
          b = bUniversal;
        } else {
          // For pre-treatment, b is largest s < t
          b = tlist.filter(s => s < t).at(-1);
        }
      }

      // Skip if no valid base period or if t === b (degenerate comparison)
      if (b === undefined || t === b) {
        continue;
      }

      const e = t - g;
      cells.push({
        g,
        t,
        b,
        e,
        isPre: !isPost,
        isRef: false,
      });
    }
  }

  return cells;
}

// Select the control set (unit IDs) for a specific (g,t,b) cell.
export function controlSet({ units, g, t, b, controlGroup }) {
  const laterPeriod = Math.max(t, b);

  function notYetTreatedEids() {
    return [...units.entries()]
      .filter(([, G]) => G > laterPeriod && G !== g)
      .map(([eid]) => eid);
  }

  if (controlGroup === "nevertreated") {
    const eids = [...units.entries()]
      .filter(([, G]) => G === Infinity)
      .map(([eid]) => eid);
    if (eids.length === 0) {
      return {
        eids: notYetTreatedEids(),
        warning: "No never-treated units found; falling back to not-yet-treated control group.",
      };
    }
    return { eids };
  }

  return { eids: notYetTreatedEids() };
}

// ─── AGGREGATE HELPERS ───────────────────────────────────────────────────────

// Seeded LCG for reproducible Mammen draws
function makeLCG(seed) {
  let s = seed >>> 0;
  return () => { s = (1664525 * s + 1013904223) >>> 0; return s / 0xFFFFFFFF; };
}

function mammenWeight(rand) {
  const p1 = (Math.sqrt(5) + 1) / (2 * Math.sqrt(5));
  return rand() < p1 ? -(Math.sqrt(5) - 1) / 2 : (Math.sqrt(5) + 1) / 2;
}

function percentile(arr, p) {
  const s = [...arr].sort((a, b) => a - b);
  const idx = (p / 100) * (s.length - 1);
  const lo = Math.floor(idx), hi = Math.ceil(idx);
  return s[lo] + (s[hi] - s[lo]) * (idx - lo);
}

function iqrScale(arr) {
  return (percentile(arr, 75) - percentile(arr, 25)) / 1.3489795;
}

function analyticSE(inf, n) {
  let s2 = 0;
  for (let i = 0; i < n; i++) s2 += inf[i] * inf[i];
  return Math.sqrt(s2) / n;
}

function normalCDF(z) {
  const t = 1 / (1 + 0.2316419 * Math.abs(z));
  const poly = t * (0.319381530 + t * (-0.356563782 + t * (1.781477937 + t * (-1.821255978 + t * 1.330274429))));
  const phi = Math.exp(-0.5 * z * z) / Math.sqrt(2 * Math.PI);
  const p = phi * poly;
  return z >= 0 ? 1 - p : p;
}

function chiSqP(x, k) {
  if (!isFinite(x) || x <= 0) return 1;
  const z = (Math.pow(x / k, 1 / 3) - (1 - 2 / (9 * k))) / Math.sqrt(2 / (9 * k));
  return 1 - normalCDF(z);
}

// ─── AGGREGATE ───────────────────────────────────────────────────────────────

/**
 * Aggregate ATT(g,t) cells into higher-level estimates.
 *
 * @param {object} params
 * @param {Array}  params.cells2x2   - array of { g, t, e, isPre, isRef, att, inf: Float64Array(n) }
 * @param {Map}    params.groupProb  - Map<g, P(G=g)> over treated units
 * @param {number} params.n          - total panel units
 * @param {object} params.inference  - { method, nBoot, seed }
 *
 * @returns {{ aggregations, inference, ptestWald }}
 */
export function aggregate({ cells2x2, groupProb, n, inference }) {
  const { method = "bootstrap", nBoot = 999, seed = 42 } = inference ?? {};

  const post = cells2x2.filter(c => !c.isPre && !c.isRef);
  const pre  = cells2x2.filter(c => c.isPre && !c.isRef);

  // ── Simple ───────────────────────────────────────────────────────────────────
  const simpleWRaw = post.map(c => groupProb.get(c.g) ?? 0);
  const simpleWSum = simpleWRaw.reduce((s, w) => s + w, 0);
  const simpleAtt = simpleWSum > 0
    ? post.reduce((s, c, k) => s + simpleWRaw[k] * c.att, 0) / simpleWSum : NaN;
  const simpleInf = new Float64Array(n);
  if (simpleWSum > 0) post.forEach((c, k) => {
    const w = simpleWRaw[k] / simpleWSum;
    for (let i = 0; i < n; i++) simpleInf[i] += w * c.inf[i];
  });

  // ── Dynamic ──────────────────────────────────────────────────────────────────
  const allE = [...new Set(cells2x2.filter(c => !c.isRef).map(c => c.e))].sort((a, b) => a - b);
  const byE = allE.map(e => {
    const cs = cells2x2.filter(c => c.e === e && !c.isRef);
    const wSum = cs.reduce((s, c) => s + (groupProb.get(c.g) ?? 0), 0);
    const att = wSum > 0 ? cs.reduce((s, c) => s + (groupProb.get(c.g) ?? 0) * c.att, 0) / wSum : NaN;
    const inf = new Float64Array(n);
    if (wSum > 0) cs.forEach(c => {
      const w = (groupProb.get(c.g) ?? 0) / wSum;
      for (let i = 0; i < n; i++) inf[i] += w * c.inf[i];
    });
    return { e, att, inf };
  });
  const postByE = byE.filter(x => x.e >= 0);
  const dynOverall = postByE.length ? postByE.reduce((s, x) => s + x.att, 0) / postByE.length : NaN;
  const dynInfOverall = new Float64Array(n);
  if (postByE.length) postByE.forEach(x => { for (let i = 0; i < n; i++) dynInfOverall[i] += x.inf[i] / postByE.length; });

  // ── Group ────────────────────────────────────────────────────────────────────
  const gList = [...new Set(post.map(c => c.g))].sort((a, b) => a - b);
  const byG = gList.map(g => {
    const cs = post.filter(c => c.g === g);
    const att = cs.length ? cs.reduce((s, c) => s + c.att, 0) / cs.length : NaN;
    const inf = new Float64Array(n);
    cs.forEach(c => { for (let i = 0; i < n; i++) inf[i] += c.inf[i] / cs.length; });
    return { g, att, inf };
  });
  const grpWSum = byG.reduce((s, x) => s + (groupProb.get(x.g) ?? 0), 0);
  const grpOverall = grpWSum > 0
    ? byG.reduce((s, x) => s + (groupProb.get(x.g) ?? 0) * x.att, 0) / grpWSum : NaN;
  const grpInfOverall = new Float64Array(n);
  if (grpWSum > 0) byG.forEach(x => {
    const w = (groupProb.get(x.g) ?? 0) / grpWSum;
    for (let i = 0; i < n; i++) grpInfOverall[i] += w * x.inf[i];
  });

  // ── Calendar ─────────────────────────────────────────────────────────────────
  const tList = [...new Set(post.map(c => c.t))].sort((a, b) => a - b);
  const byT = tList.map(t => {
    const cs = post.filter(c => c.t === t);
    const att = cs.length ? cs.reduce((s, c) => s + c.att, 0) / cs.length : NaN;
    const inf = new Float64Array(n);
    cs.forEach(c => { for (let i = 0; i < n; i++) inf[i] += c.inf[i] / cs.length; });
    return { t, att, inf };
  });
  const calOverall = byT.length ? byT.reduce((s, x) => s + x.att, 0) / byT.length : NaN;
  const calInfOverall = new Float64Array(n);
  if (byT.length) byT.forEach(x => { for (let i = 0; i < n; i++) calInfOverall[i] += x.inf[i] / byT.length; });

  // ── Collect all parameter IFs for simultaneous inference ─────────────────────
  const paramInfs = [
    dynInfOverall,
    ...byE.map(x => x.inf),
    grpInfOverall,
    ...byG.map(x => x.inf),
    simpleInf,
    calInfOverall,
    ...byT.map(x => x.inf),
  ];

  // ── SE computation ────────────────────────────────────────────────────────────
  let critVal = 1.959964;
  let seArr = paramInfs.map(inf => analyticSE(inf, n));

  if (method === "bootstrap" && nBoot > 0) {
    const rand = makeLCG(seed);
    const bootStats = Array.from({ length: nBoot }, () => {
      const V = Array.from({ length: n }, () => mammenWeight(rand));
      return paramInfs.map(inf => {
        let s = 0;
        for (let i = 0; i < n; i++) s += V[i] * inf[i];
        return s / n;
      });
    });
    seArr = paramInfs.map((_, k) => {
      const draws = bootStats.map(bs => bs[k]);
      return iqrScale(draws);
    });
    const maxTStats = bootStats.map(bs =>
      Math.max(...bs.map((b, k) => seArr[k] > 0 ? Math.abs(b) / seArr[k] : 0))
    );
    critVal = percentile(maxTStats, 95);
  }

  // ── Assign SE + CI ───────────────────────────────────────────────────────────
  let ki = 0;
  const nxt = () => seArr[ki++] ?? 0;
  const ci = (att, se) => ({ att, se, ciLo: att - critVal * se, ciHi: att + critVal * se });

  const dynamic = {
    ...ci(dynOverall, nxt()),
    byE: byE.map(x => ({ e: x.e, ...ci(x.att, nxt()) })),
  };
  const group = {
    ...ci(grpOverall, nxt()),
    byG: byG.map(x => ({ g: x.g, ...ci(x.att, nxt()) })),
  };
  const simple = { overall: simpleAtt, ...ci(simpleAtt, nxt()) };
  const calendar = {
    ...ci(calOverall, nxt()),
    byT: byT.map(x => ({ t: x.t, ...ci(x.att, nxt()) })),
  };

  // Add `overall` alias on dynamic and group for consistent API
  dynamic.overall = dynamic.att;
  group.overall   = group.att;
  calendar.overall = calendar.att;

  // ── Parallel-trends Wald test ─────────────────────────────────────────────────
  let ptestWald = null;
  if (pre.length > 0) {
    const theta = pre.map(c => c.att);
    const m = pre.length;
    const Sigma = Array.from({ length: m }, (_, j) =>
      Array.from({ length: m }, (_, k) => {
        let s = 0;
        for (let i = 0; i < n; i++) s += pre[j].inf[i] * pre[k].inf[i];
        return s / n;
      })
    );
    try {
      const SigmaInv = matInv(Sigma);
      let stat = 0;
      for (let j = 0; j < m; j++) for (let k = 0; k < m; k++) stat += theta[j] * SigmaInv[j][k] * theta[k];
      stat *= n;
      ptestWald = { stat, df: m, p: chiSqP(stat, m) };
    } catch {
      // Sigma is singular — typically because pre-period ATTs have (near-)zero
      // sampling variance (e.g. no residual variation across units). The test
      // is not computable, not "0/0"; surface that distinction to the caller.
      ptestWald = { stat: NaN, df: m, p: NaN, unavailable: true };
    }
  }

  return {
    aggregations: { simple, dynamic, group, calendar },
    inference: { method, nBoot, seed, critVal },
    ptestWald,
  };
}
