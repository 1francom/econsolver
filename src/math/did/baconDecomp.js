/**
 * Goodman-Bacon (2021) decomposition of the two-way fixed-effects DiD estimator.
 * "Difference-in-differences with variation in treatment timing", J. Econometrics 225(2).
 *
 * The TWFE coefficient on a binary, absorbing treatment is a WEIGHTED AVERAGE of
 * every 2x2 DiD you can form from the timing groups:
 *
 *   beta_TWFE = sum_k s_kU * beta_kU                        (timing group vs never-treated)
 *             + sum_{k<l} [ s_kl^k * beta_kl^k              (earlier group treated, later group still untreated)
 *                         + s_kl^l * beta_kl^l ]            (later group treated, ALREADY-TREATED earlier group as control)
 *
 * The third term is the pathological one: an already-treated group is used as a
 * control, so under heterogeneous or dynamic effects its 2x2 is contaminated by
 * the control group's own evolving treatment effect, and can even enter with the
 * wrong sign. Reporting the weight mass sitting on that term is the whole point
 * of the decomposition.
 *
 * SCOPE (matches bacondecomp::bacon's base case):
 *   - balanced panel
 *   - binary treatment
 *   - absorbing (staircase) treatment: once treated, always treated
 *   - no covariates
 * Anything else throws with a specific reason rather than returning a number that
 * does not decompose the estimator the user actually ran.
 *
 * VALIDATION: the decomposition is an identity, not an approximation. Weights must
 * sum to 1 and sum(s_i * beta_i) must reproduce the TWFE coefficient to machine
 * precision. checkBaconIdentity() below exposes exactly that.
 */

// ── helpers ───────────────────────────────────────────────────────────────────
const mean = a => a.reduce((s, v) => s + v, 0) / a.length;

/** Mean of y over (group units) x (time window). null when the cell is empty. */
function cellMean(panel, unitIds, times) {
  let s = 0, n = 0;
  for (const u of unitIds) {
    const row = panel.get(u);
    for (const t of times) {
      const v = row.get(t);
      if (v != null && isFinite(v)) { s += v; n++; }
    }
  }
  return n ? s / n : null;
}

/** 2x2 DiD from four cell means. null if any cell is empty. */
function did2x2(panel, treatUnits, ctrlUnits, preTimes, postTimes) {
  const tPost = cellMean(panel, treatUnits, postTimes);
  const tPre  = cellMean(panel, treatUnits, preTimes);
  const cPost = cellMean(panel, ctrlUnits,  postTimes);
  const cPre  = cellMean(panel, ctrlUnits,  preTimes);
  if (tPost == null || tPre == null || cPost == null || cPre == null) return null;
  return (tPost - tPre) - (cPost - cPre);
}

export const BACON_TYPES = {
  LATER_VS_ALWAYS: "Later vs Earlier Treated",
  EARLIER_VS_LATER: "Earlier vs Later Treated",
  VS_NEVER: "Treated vs Untreated",
};

/**
 * @param {object[]} rows
 * @param {string} yCol      outcome
 * @param {string} unitCol   panel unit id
 * @param {string} timeCol   panel time id (numeric)
 * @param {string} treatCol  binary 0/1 treatment indicator
 * @returns {{
 *   comparisons: {type:string, treated:number|string, control:number|string,
 *                 weight:number, estimate:number, nTreatedUnits:number, nControlUnits:number}[],
 *   summary:     {type:string, weight:number, avgEstimate:number}[],
 *   weightedSum: number, varD: number, varDDirect: number,
 *   nUnits:number, nTimes:number, groups:{time:number|null, nUnits:number, share:number, dbar:number}[],
 *   warnings:string[]
 * }}
 */
export function runBaconDecomposition(rows, yCol, unitCol, timeCol, treatCol) {
  if (!Array.isArray(rows) || !rows.length) throw new Error("Bacon: no rows.");

  const warnings = [];

  // ── 1. Reshape to unit -> (time -> {y, d}) ─────────────────────────────────
  const valid = rows.filter(r =>
    r[unitCol] != null &&
    typeof r[timeCol] === "number" && isFinite(r[timeCol]) &&
    typeof r[yCol] === "number" && isFinite(r[yCol]) &&
    r[treatCol] != null && isFinite(Number(r[treatCol]))
  );
  if (valid.length < 4) throw new Error("Bacon: not enough complete observations.");

  const times = [...new Set(valid.map(r => r[timeCol]))].sort((a, b) => a - b);
  const units = [...new Set(valid.map(r => r[unitCol]))];
  const T = times.length, N = units.length;
  if (T < 2) throw new Error("Bacon: need at least 2 time periods.");
  if (N < 2) throw new Error("Bacon: need at least 2 units.");

  const yPanel = new Map(), dPanel = new Map();
  for (const u of units) { yPanel.set(u, new Map()); dPanel.set(u, new Map()); }
  for (const r of valid) {
    const d = Number(r[treatCol]);
    if (d !== 0 && d !== 1) {
      throw new Error(`Bacon: treatment "${treatCol}" must be binary 0/1 — found ${d}. ` +
        "The decomposition is only defined for a binary treatment.");
    }
    yPanel.get(r[unitCol]).set(r[timeCol], r[yCol]);
    dPanel.get(r[unitCol]).set(r[timeCol], d);
  }

  // ── 2. Balance + absorbing checks ──────────────────────────────────────────
  // Both are load-bearing: the decomposition identity only holds for a balanced
  // panel with a staircase treatment. Silently proceeding would hand back
  // weights that do not sum to 1 and a "decomposition" of nothing.
  for (const u of units) {
    if (yPanel.get(u).size !== T) {
      throw new Error(`Bacon: unbalanced panel — unit "${u}" has ${yPanel.get(u).size} of ${T} periods. ` +
        "The decomposition requires a balanced panel.");
    }
  }

  /** first period where D=1, or null for never-treated */
  const startOf = new Map();
  for (const u of units) {
    const d = dPanel.get(u);
    let start = null;
    for (const t of times) {
      const v = d.get(t);
      if (v === 1 && start === null) start = t;
      if (start !== null && v === 0) {
        throw new Error(`Bacon: treatment is not absorbing — unit "${u}" switches back to 0 at t=${t}. ` +
          "Goodman-Bacon requires a staircase (once treated, always treated) pattern.");
      }
    }
    startOf.set(u, start);
  }

  // ── 3. Timing groups ───────────────────────────────────────────────────────
  const byStart = new Map();               // start time (or null) -> unit ids
  for (const u of units) {
    const k = startOf.get(u);
    if (!byStart.has(k)) byStart.set(k, []);
    byStart.get(k).push(u);
  }
  const neverUnits = byStart.get(null) ?? [];
  const timingKeys = [...byStart.keys()].filter(k => k !== null).sort((a, b) => a - b);

  if (!timingKeys.length) throw new Error("Bacon: no treated units.");
  if (timingKeys.length === 1 && !neverUnits.length) {
    throw new Error("Bacon: a single timing group and no never-treated units leaves nothing to decompose.");
  }

  // n_k = share of units; Dbar_k = share of periods group k spends treated.
  const share = k => byStart.get(k).length / N;
  const dbarOf = k => k === null ? 0 : times.filter(t => t >= k).length / T;

  const groups = [
    ...timingKeys.map(k => ({ time: k, nUnits: byStart.get(k).length, share: share(k), dbar: dbarOf(k) })),
    ...(neverUnits.length ? [{ time: null, nUnits: neverUnits.length, share: neverUnits.length / N, dbar: 0 }] : []),
  ];

  const alwaysTreated = timingKeys.filter(k => dbarOf(k) === 1);
  if (alwaysTreated.length) {
    warnings.push(
      `${alwaysTreated.length} timing group(s) are treated in every period. They carry zero weight ` +
      "as a treated group (no pre-period) but still serve as controls for later groups."
    );
  }

  // ── 4. Every 2x2 with its unnormalised weight ──────────────────────────────
  // Weight formulas: Goodman-Bacon (2021) Theorem 1. Numerators are collected
  // first and divided by their total, which is V^D — that is what makes the
  // weights sum to exactly 1. varDDirect below recomputes V^D independently
  // from the two-way-demeaned treatment as a cross-check.
  const raw = [];
  const push = (type, treated, control, num, est, nT, nC) => {
    if (!(num > 0) || est == null || !isFinite(est)) return;   // zero-weight/degenerate cells drop out
    raw.push({ type, treated, control, num, estimate: est, nTreatedUnits: nT, nControlUnits: nC });
  };

  // (a) timing group k vs never-treated
  if (neverUnits.length) {
    const nU = neverUnits.length / N;
    for (const k of timingKeys) {
      const nk = share(k), dk = dbarOf(k);
      const nHat = nk / (nk + nU);
      const num  = (nk + nU) ** 2 * nHat * (1 - nHat) * dk * (1 - dk);
      const est  = did2x2(yPanel, byStart.get(k), neverUnits,
                          times.filter(t => t < k), times.filter(t => t >= k));
      push(BACON_TYPES.VS_NEVER, k, null, num, est, byStart.get(k).length, neverUnits.length);
    }
  }

  // (b) pairs of timing groups, k treated strictly before l
  for (let a = 0; a < timingKeys.length; a++) {
    for (let b = a + 1; b < timingKeys.length; b++) {
      const k = timingKeys[a], l = timingKeys[b];
      const nk = share(k), nl = share(l);
      const dk = dbarOf(k), dl = dbarOf(l);
      const nHat = nk / (nk + nl);
      const kU = byStart.get(k), lU = byStart.get(l);

      const pre = times.filter(t => t < k);          // both untreated
      const mid = times.filter(t => t >= k && t < l); // k treated, l not yet
      const post = times.filter(t => t >= l);        // both treated

      // b1: k is the treated group, l is a not-yet-treated control (clean).
      if (dl < 1) {
        const num = ((nk + nl) * (1 - dl)) ** 2 * nHat * (1 - nHat)
                  * ((dk - dl) / (1 - dl)) * ((1 - dk) / (1 - dl));
        push(BACON_TYPES.EARLIER_VS_LATER, k, l, num, did2x2(yPanel, kU, lU, pre, mid),
             kU.length, lU.length);
      }

      // b2: l is the treated group, k is an ALREADY-TREATED control (contaminated).
      if (dk > 0) {
        const num = ((nk + nl) * dk) ** 2 * nHat * (1 - nHat)
                  * (dl / dk) * ((dk - dl) / dk);
        push(BACON_TYPES.LATER_VS_ALWAYS, l, k, num, did2x2(yPanel, lU, kU, mid, post),
             lU.length, kU.length);
      }
    }
  }

  if (!raw.length) throw new Error("Bacon: no admissible 2x2 comparisons could be formed.");

  // ── 5. Normalise ───────────────────────────────────────────────────────────
  const varD = raw.reduce((s, c) => s + c.num, 0);
  const comparisons = raw
    .map(c => ({ type: c.type, treated: c.treated, control: c.control,
                 weight: c.num / varD, estimate: c.estimate,
                 nTreatedUnits: c.nTreatedUnits, nControlUnits: c.nControlUnits }))
    .sort((x, y) => y.weight - x.weight);

  const weightedSum = comparisons.reduce((s, c) => s + c.weight * c.estimate, 0);

  // Independent V^D: variance of the two-way-demeaned treatment. Should match
  // varD above; a gap means the panel violated an assumption the checks missed.
  const varDDirect = (() => {
    const unitMean = new Map(), timeMean = new Map();
    for (const u of units) unitMean.set(u, mean(times.map(t => dPanel.get(u).get(t))));
    for (const t of times) timeMean.set(t, mean(units.map(u => dPanel.get(u).get(t))));
    const grand = mean(units.flatMap(u => times.map(t => dPanel.get(u).get(t))));
    let ss = 0;
    for (const u of units) for (const t of times) {
      const dt = dPanel.get(u).get(t) - unitMean.get(u) - timeMean.get(t) + grand;
      ss += dt * dt;
    }
    return ss / (N * T);
  })();

  if (varD > 0 && Math.abs(varD - varDDirect) / varD > 1e-6) {
    warnings.push(
      `Weight normaliser disagrees with the two-way-demeaned treatment variance ` +
      `(${varD.toPrecision(6)} vs ${varDDirect.toPrecision(6)}). The decomposition identity may not hold exactly.`
    );
  }

  // ── 6. Per-type summary ────────────────────────────────────────────────────
  const summary = Object.values(BACON_TYPES).map(type => {
    const cs = comparisons.filter(c => c.type === type);
    const w  = cs.reduce((s, c) => s + c.weight, 0);
    return { type, weight: w, avgEstimate: w > 0 ? cs.reduce((s, c) => s + c.weight * c.estimate, 0) / w : NaN };
  }).filter(s => s.weight > 0);

  return { comparisons, summary, weightedSum, varD, varDDirect,
           nUnits: N, nTimes: T, groups, warnings };
}

/**
 * The decomposition is an identity. Given a Bacon result and the TWFE
 * coefficient the user actually estimated, both of these must hold:
 *   sum(weights) === 1
 *   sum(weight * estimate) === beta_TWFE
 * Returns the two absolute deviations so callers can surface a mismatch instead
 * of quietly presenting weights that do not decompose the reported model.
 */
export function checkBaconIdentity(result, betaTWFE) {
  const sumW = result.comparisons.reduce((s, c) => s + c.weight, 0);
  return {
    weightSum: sumW,
    weightSumError: Math.abs(sumW - 1),
    betaError: betaTWFE == null || !isFinite(betaTWFE)
      ? null : Math.abs(result.weightedSum - betaTWFE),
  };
}
