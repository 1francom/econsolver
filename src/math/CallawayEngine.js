// ─── ECON STUDIO · src/math/CallawayEngine.js ─────────────────────────────────
// Callaway & Sant'Anna (2021) Staggered DiD estimator.
// Pure JS. No React. No imports from UI layers.
//
// Outcome-regression (OR) estimator:
//   ATT(g,t) = E[Y_t − Y_{g−1} | G=g] − E[Y_t − Y_{g−1} | C]
//
// where C = never-treated (G=∞) or not-yet-treated (G>t) as fallback.
//
// Aggregated event-study:
//   θ_l = Σ_g w_{g,l} · ATT(g, g+l)
// with influence-function SE (sandwich) and delta-method aggregation.
//
// Reference: Callaway & Sant'Anna (2021), Journal of Econometrics.
// Validated against R `did` package (att_gt + aggte(type="dynamic")).

// ─── HELPERS ─────────────────────────────────────────────────────────────────

/** Two-tailed normal p-value */
function normPVal(z) {
  // Abramowitz & Stegun approximation
  const t = 1 / (1 + 0.2316419 * Math.abs(z));
  const poly = t * (0.319381530 + t * (-0.356563782 + t * (1.781477937 + t * (-1.821255978 + t * 1.330274429))));
  const phi = (1 / Math.sqrt(2 * Math.PI)) * Math.exp(-0.5 * z * z);
  const p1 = phi * poly;
  return 2 * Math.min(p1, 1 - p1);
}

/** Mean of numeric array (ignores NaN/null) */
function mean(arr) {
  const valid = arr.filter(v => v != null && Number.isFinite(v));
  if (!valid.length) return NaN;
  return valid.reduce((s, v) => s + v, 0) / valid.length;
}

// ─── MAIN ENGINE ─────────────────────────────────────────────────────────────

/**
 * runCallawayCS — Callaway-Sant'Anna (2021) staggered DiD.
 *
 * @param {Object[]} rows        Panel data rows.
 * @param {Object}   cols        { yCol, entityCol, timeCol, treatCol }
 *   yCol       — outcome column (numeric)
 *   entityCol  — unit identifier column
 *   timeCol    — time period column (numeric)
 *   treatCol   — first-treatment-period column (numeric; 0 or Infinity/null = never-treated)
 *                If omitted, will be derived from a binary treatment column named treatBinCol.
 *   treatBinCol — (optional) column with binary 0/1 treatment; used to derive first-treat period.
 *   compGroup  — "nevertreated" (default) | "notyettreated"
 *   relMin     — min relative period to include in event-study (default: -Infinity)
 *   relMax     — max relative period to include in event-study (default: +Infinity)
 * @param {Object}   seOpts      SE options (passed through; IF-based SE always used).
 * @returns {Object}             Engine output consumed by wrapResult("CallawayCS", ...)
 */
export function runCallawayCS(
  rows,
  { yCol, entityCol, timeCol, treatCol, treatBinCol,
    compGroup = "nevertreated", relMin = -Infinity, relMax = Infinity },
  seOpts = {}
) {
  if (!rows || !rows.length)
    return { error: "No data rows provided." };
  if (!yCol)      return { error: "Outcome column (yCol) required." };
  if (!entityCol) return { error: "Entity column (entityCol) required." };
  if (!timeCol)   return { error: "Time column (timeCol) required." };

  // ── 1. Resolve first-treatment-period per entity ──────────────────────────
  // treatCol should contain the first period each entity was treated.
  // 0, null, undefined, NaN, or Infinity = never-treated.

  const neverSentinel = Infinity;

  // Build entity → firstTreat map
  const entityFirstTreat = new Map();

  if (treatCol) {
    // Direct first-treatment column (e.g. `first.treat` in mpdta)
    const seenEntities = new Set();
    for (const r of rows) {
      const eid = r[entityCol];
      if (eid == null) continue;
      if (seenEntities.has(eid)) continue;
      seenEntities.add(eid);
      const ft = r[treatCol];
      const ftNum = (ft == null || ft === "" || !isFinite(Number(ft)) || Number(ft) === 0)
        ? neverSentinel
        : Number(ft);
      entityFirstTreat.set(eid, ftNum);
    }
  } else if (treatBinCol) {
    // Derive first-treat from binary column: minimum t where treat=1
    const entityTreatPeriods = new Map();
    for (const r of rows) {
      const eid = r[entityCol];
      if (eid == null) continue;
      const d = Number(r[treatBinCol]);
      const t = Number(r[timeCol]);
      if (d === 1 && isFinite(t)) {
        const prev = entityTreatPeriods.get(eid);
        if (prev == null || t < prev) entityTreatPeriods.set(eid, t);
      }
    }
    // Entities with no treated periods → never-treated
    const allEntities = new Set(rows.map(r => r[entityCol]).filter(e => e != null));
    for (const eid of allEntities) {
      entityFirstTreat.set(eid, entityTreatPeriods.get(eid) ?? neverSentinel);
    }
  } else {
    return { error: "Provide treatCol (first-treatment-period column) or treatBinCol (binary 0/1 column)." };
  }

  // ── 2. Filter valid rows ──────────────────────────────────────────────────
  const valid = rows.filter(r => {
    const y = r[yCol];
    const t = r[timeCol];
    const eid = r[entityCol];
    return (
      y != null && Number.isFinite(Number(y)) &&
      t != null && Number.isFinite(Number(t)) &&
      eid != null && entityFirstTreat.has(eid)
    );
  });

  if (valid.length < 4)
    return { error: "Too few valid observations (need at least 4)." };

  const n = valid.length;

  // Augment rows with firstTreat and numeric fields
  const data = valid.map(r => ({
    eid:   r[entityCol],
    t:     Number(r[timeCol]),
    y:     Number(r[yCol]),
    g:     entityFirstTreat.get(r[entityCol]),  // first treated period (Infinity = never)
  }));

  // ── 3. Sorted unique arrays ───────────────────────────────────────────────
  const allTimes = [...new Set(data.map(r => r.t))].sort((a, b) => a - b);

  // Cohorts: unique non-Infinity first-treat periods
  const cohorts = [...new Set(data.map(r => r.g).filter(g => isFinite(g)))].sort((a, b) => a - b);

  if (!cohorts.length)
    return { error: "No treated units found. Ensure treatCol contains finite treatment periods." };

  const nGroups = cohorts.length;
  const nPeriods = allTimes.length;

  // ── 4. Index data by entity for fast lookup ───────────────────────────────
  // entityData[eid] = Map<t, y>
  const entityData = new Map();
  for (const r of data) {
    if (!entityData.has(r.eid)) entityData.set(r.eid, new Map());
    entityData.get(r.eid).set(r.t, r.y);
  }

  // Unique entities per cohort and never-treated
  const cohortEntities   = new Map();  // g → [eid]
  const neverTreatedEids = [];
  const allEntitySet = new Map();  // eid → g
  for (const r of data) {
    allEntitySet.set(r.eid, r.g);
  }
  for (const [eid, g] of allEntitySet) {
    if (!isFinite(g)) {
      neverTreatedEids.push(eid);
    } else {
      if (!cohortEntities.has(g)) cohortEntities.set(g, []);
      if (!cohortEntities.get(g).includes(eid)) cohortEntities.get(g).push(eid);
    }
  }

  const hasNeverTreated = neverTreatedEids.length > 0;

  // ── 5. Compute ATT(g,t) for each (cohort g, time t ≥ g) ──────────────────
  // Also compute for t = g−1 (used as a reference check) and pre-periods.

  const attGT = [];  // { g, t, att, se, psi: [n], n_g, n_c }

  // We compute influence functions for every (g,t) pair, including pre-periods,
  // so the event-study aggregation can form pre-trend estimates.

  const allRelPeriods = new Set();

  for (const g of cohorts) {
    const gEids = cohortEntities.get(g) ?? [];
    if (!gEids.length) continue;

    const gMinus1 = allTimes[allTimes.indexOf(
      allTimes.reduce((prev, curr) => Math.abs(curr - (g - 1)) < Math.abs(prev - (g - 1)) ? curr : prev)
    )];
    // Actual baseline: last pre-treatment period (t < g)
    const prePeriods = allTimes.filter(t => t < g);
    if (!prePeriods.length) continue;  // cohort has no pre-period
    const baselineT = prePeriods[prePeriods.length - 1];  // g−1 (or nearest)

    for (const t of allTimes) {
      const rel = t - g;
      if (rel < relMin || rel > relMax) continue;
      allRelPeriods.add(rel);

      // Control group for this (g,t)
      let controlEids;
      if (compGroup === "nevertreated") {
        if (hasNeverTreated) {
          controlEids = neverTreatedEids;
        } else {
          // Fallback to not-yet-treated when no pure never-treated exist
          controlEids = [...allEntitySet.entries()]
            .filter(([eid, gg]) => isFinite(gg) && gg > t)
            .map(([eid]) => eid);
        }
      } else {
        // not-yet-treated: G > t (not yet treated at time t)
        controlEids = [...allEntitySet.entries()]
          .filter(([eid, gg]) => !isFinite(gg) || gg > t)
          .map(([eid]) => eid)
          .filter(eid => !gEids.includes(eid));  // exclude current cohort
      }

      if (!controlEids.length) continue;

      // ΔY_{it} = Y_{it} − Y_{i,baselineT} for treated group
      const treatedChanges = gEids
        .map(eid => {
          const yT       = entityData.get(eid)?.get(t);
          const yBase    = entityData.get(eid)?.get(baselineT);
          if (yT == null || yBase == null) return null;
          return Number(yT) - Number(yBase);
        })
        .filter(v => v != null && isFinite(v));

      if (!treatedChanges.length) continue;

      // ΔY_{it} for control group
      const controlChanges = controlEids
        .map(eid => {
          const yT    = entityData.get(eid)?.get(t);
          const yBase = entityData.get(eid)?.get(baselineT);
          if (yT == null || yBase == null) return null;
          return Number(yT) - Number(yBase);
        })
        .filter(v => v != null && isFinite(v));

      if (!controlChanges.length) continue;

      const n_g  = treatedChanges.length;
      const n_c  = controlChanges.length;

      const meanTreated = mean(treatedChanges);
      const meanControl = mean(controlChanges);
      const att = meanTreated - meanControl;

      // ── 5a. Influence function ────────────────────────────────────────────
      // Full sample influence function for ATT(g,t):
      //   ψ_{g,t,i} for each i in the full sample
      //
      // For treated-group obs i (G_i = g):
      //   ψ_i = (1/n_g/p_g) * ((ΔY_i − att) − (meanControl − meanControl))
      //   simplified: ψ_i = (1/p_g) * (ΔY_i − meanTreated)   (centred version)
      //
      // Callaway-Sant'Anna IF (equation (3.1) in paper):
      //   ψ_{g,t,i} =  (1(G_i=g)/P(G=g)) * (ΔY_i - att)
      //              - (1(C_i)  /P(C))    * (ΔY_i - meanControl)
      //
      // Since both terms sum to 0 across their respective groups,
      // the IF centred on 0 gives variance (1/n²)Σψ².

      const nEntities = allEntitySet.size;
      const p_g = n_g / nEntities;
      const p_c = n_c / nEntities;

      // Build entity → ΔY map for this (g,t) pair for treated and control
      const treatedChangeMap = new Map();
      gEids.forEach(eid => {
        const yT    = entityData.get(eid)?.get(t);
        const yBase = entityData.get(eid)?.get(baselineT);
        if (yT != null && yBase != null && isFinite(Number(yT)) && isFinite(Number(yBase)))
          treatedChangeMap.set(eid, Number(yT) - Number(yBase));
      });

      const controlChangeMap = new Map();
      controlEids.forEach(eid => {
        const yT    = entityData.get(eid)?.get(t);
        const yBase = entityData.get(eid)?.get(baselineT);
        if (yT != null && yBase != null && isFinite(Number(yT)) && isFinite(Number(yBase)))
          controlChangeMap.set(eid, Number(yT) - Number(yBase));
      });

      // Influence values per entity in the full entity universe
      const allEids = [...allEntitySet.keys()];
      const psi = allEids.map(eid => {
        const g_i = allEntitySet.get(eid);
        let val = 0;
        if (g_i === g && treatedChangeMap.has(eid)) {
          // Treated group contribution
          val += (treatedChangeMap.get(eid) - att) / (p_g * allEids.length);
        }
        if (controlChangeMap.has(eid)) {
          // Control group contribution (subtracted)
          val -= (controlChangeMap.get(eid) - meanControl) / (p_c * allEids.length);
        }
        return val;
      });

      // Variance of ATT(g,t) = sum(ψ²) (already scaled by 1/n² via allEids.length)
      const sumPsi2 = psi.reduce((s, v) => s + v * v, 0);
      const varAtt  = sumPsi2;   // Var = Σ ψ_i²  (ψ already scaled)
      const seAtt   = Math.sqrt(Math.max(varAtt, 0));

      attGT.push({ g, t, att, se: seAtt, psi, n_g, n_c });
    }
  }

  if (!attGT.length)
    return { error: "Could not compute any ATT(g,t) — check that treated and control units share baseline and post periods." };

  // ── 6. Event-study aggregation θ_l = Σ_g w_{g,l} · ATT(g, g+l) ──────────
  const relPeriodsSorted = [...allRelPeriods].sort((a, b) => a - b);

  // Filter to only relative periods with at least one valid ATT(g,t)
  const validRelPeriods = relPeriodsSorted.filter(l =>
    attGT.some(e => e.t - e.g === l)
  );

  const eventStudyCoeffs = [];

  for (const l of validRelPeriods) {
    // All ATT(g,t) with t − g = l
    const relevant = attGT.filter(e => e.t - e.g === l);
    if (!relevant.length) continue;

    const totalTreated = relevant.reduce((s, e) => s + e.n_g, 0);
    if (totalTreated === 0) continue;

    const weights = relevant.map(e => e.n_g / totalTreated);
    const theta_l = relevant.reduce((s, e, i) => s + weights[i] * e.att, 0);

    // Delta-method SE for θ_l = Σ_g w_{g,l} · ATT(g, g+l)
    // The IF for θ_l is ψ_{θ_l,i} = Σ_g w_{g,l} · ψ_{g,t,i}  (with t=g+l)
    // Var(θ_l) = Σ_i (ψ_{θ_l,i})²

    // Sum the IF vectors weighted by cohort shares
    const allEids = [...allEntitySet.keys()];
    const nE = allEids.length;
    const psiAgg = new Array(nE).fill(0);
    relevant.forEach((e, j) => {
      e.psi.forEach((psi_i, i) => {
        psiAgg[i] += weights[j] * psi_i;
      });
    });

    const varAgg = psiAgg.reduce((s, v) => s + v * v, 0);
    const seAgg  = Math.sqrt(Math.max(varAgg, 0));
    const z      = seAgg > 0 ? theta_l / seAgg : 0;
    const p      = normPVal(z);

    eventStudyCoeffs.push({
      k:    l,
      beta: theta_l,
      se:   seAgg,
      z,
      p,
      isRef: l === -1,  // normalisation period (not dropped here, but flagged)
    });
  }

  // ── 7. Overall ATT = weighted average over all post-treatment (g,t) pairs ─
  const postPairs = attGT.filter(e => e.t >= e.g);
  const totalPostTreated = postPairs.reduce((s, e) => s + e.n_g, 0);

  let att = NaN, attSE = NaN, attP = NaN;

  if (postPairs.length && totalPostTreated > 0) {
    const wPost = postPairs.map(e => e.n_g / totalPostTreated);
    att = postPairs.reduce((s, e, i) => s + wPost[i] * e.att, 0);

    // Aggregate IF for overall ATT
    const allEids = [...allEntitySet.keys()];
    const psiOverall = new Array(allEids.length).fill(0);
    postPairs.forEach((e, j) => {
      e.psi.forEach((psi_i, i) => {
        psiOverall[i] += wPost[j] * psi_i;
      });
    });
    const varOverall = psiOverall.reduce((s, v) => s + v * v, 0);
    attSE = Math.sqrt(Math.max(varOverall, 0));
    const zOverall = attSE > 0 ? att / attSE : 0;
    attP = normPVal(zOverall);
  }

  // ── 8. Format output in EstimationResult shape ────────────────────────────
  const varNames  = eventStudyCoeffs.map(e => `rel_${e.k >= 0 ? e.k : e.k}`);
  const beta      = eventStudyCoeffs.map(e => e.beta);
  const se        = eventStudyCoeffs.map(e => e.se);
  const zStats    = eventStudyCoeffs.map(e => e.z);
  const pVals     = eventStudyCoeffs.map(e => e.p);

  // Count of entities with valid outcome data
  const nUnits  = [...allEntitySet.keys()].length;

  return {
    // Coefficient block (event-study ATTs by relative period)
    varNames,
    beta,
    se,
    zStats,
    pVals,
    // Overall ATT
    att,
    attSE,
    attP,
    // Sample info
    n,
    nGroups,
    nPeriods,
    nUnits,
    df: n - nGroups,
    // Engine-specific
    eventCoeffs: eventStudyCoeffs,  // { k, beta, se, z, p, isRef }
    attGT,                           // raw ATT(g,t) table (for diagnostics)
    cohorts,
    compGroup,
    // Metadata for wrapResult
    type:      "CallawayCS",
    converged: true,
    warnings:  [],
    resid:     [],
    Yhat:      [],
    R2:        null,
    adjR2:     null,
    Fstat:     null,
    Fpval:     null,
  };
}
