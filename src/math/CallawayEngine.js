// ─── ECON STUDIO · src/math/CallawayEngine.js ─────────────────────────────────
// Callaway & Sant'Anna (2021) Staggered DiD estimator.
// Pure JS. No React. No imports from UI layers.
//
// Reference: Callaway & Sant'Anna (2021), Journal of Econometrics.
// Rewrite: uses compute2x2, enumerateCells, controlSet, aggregate building blocks.

import { compute2x2 }                       from "./did/drdid.js";
import { enumerateCells, controlSet, aggregate } from "./did/staggeredDiD.js";

/**
 * runCallawayCS — Callaway-Sant'Anna (2021) staggered DiD.
 *
 * @param {Object[]} rows         Panel data rows.
 * @param {Object}   opts
 *   yCol        — outcome column (numeric)
 *   entityCol   — unit identifier column
 *   timeCol     — time period column (numeric)
 *   treatCol    — first-treatment-period column (numeric; 0 or missing = never-treated)
 *   treatBinCol — (optional) binary 0/1 column; used to derive first-treat period
 *   xCols       — (optional) array of covariate column names (base-period values)
 *   compGroup   — "nevertreated" (default) | "notyettreated"
 *   basePeriod  — "varying" (default) | "universal"
 *   estMethod   — "dr" (default) | "reg" | "ipw"
 *   anticipation — number of anticipation periods (default 0)
 *   relMin      — min relative period to include (default -Infinity)
 *   relMax      — max relative period to include (default +Infinity)
 *   inference   — { method: "analytic"|"bootstrap", nBoot, seed }
 * @param {Object}   seOpts       SE options (reserved for future survey-weight support).
 * @returns {Object}
 */
export function runCallawayCS(
  rows,
  {
    yCol,
    entityCol,
    timeCol,
    treatCol,
    treatBinCol,
    xCols = [],
    compGroup    = "nevertreated",
    basePeriod   = "varying",
    estMethod    = "dr",
    anticipation = 0,
    relMin       = -Infinity,
    relMax       =  Infinity,
    inference    = { method: "bootstrap", nBoot: 999, seed: 42 },
  },
  seOpts = {}
) {
  // ── 0. Basic validation ─────────────────────────────────────────────────────
  if (!rows || !rows.length) return { error: "No data rows provided." };
  if (!yCol)      return { error: "Outcome column (yCol) required." };
  if (!entityCol) return { error: "Entity column (entityCol) required." };
  if (!timeCol)   return { error: "Time column (timeCol) required." };

  // ── Size guard ──────────────────────────────────────────────────────────────
  if (rows.length > 200000) {
    return { error: `Dataset too large for CS estimator (${rows.length} rows). Aggregate to unit-period panel first.` };
  }

  const warnings = [];

  // ── 1. Resolve treatment timing ─────────────────────────────────────────────
  // Build eid → G (first treatment period, or Infinity = never-treated)
  const entityG = new Map();

  if (treatBinCol) {
    // Derive from binary column: min(t) where row[treatBinCol] is truthy
    const minTreatT = new Map();
    for (const r of rows) {
      const eid = r[entityCol];
      if (eid == null) continue;
      if (r[treatBinCol] == 1 || r[treatBinCol] === true) {
        const t = Number(r[timeCol]);
        if (!isFinite(t)) continue;
        const prev = minTreatT.get(eid);
        if (prev === undefined || t < prev) minTreatT.set(eid, t);
      }
    }
    const allEids = new Set(rows.map(r => r[entityCol]).filter(e => e != null));
    for (const eid of allEids) {
      entityG.set(eid, minTreatT.has(eid) ? minTreatT.get(eid) : Infinity);
    }
  } else if (treatCol) {
    // Direct first-treatment column
    const seen = new Set();
    for (const r of rows) {
      const eid = r[entityCol];
      if (eid == null || seen.has(eid)) continue;
      seen.add(eid);
      const ft = r[treatCol];
      const ftNum = (ft == null || ft === "" || !isFinite(Number(ft)) || Number(ft) === 0)
        ? Infinity
        : Number(ft);
      entityG.set(eid, ftNum);
    }
  } else {
    return { error: "Provide treatCol (first-treatment-period column) or treatBinCol (binary 0/1 column)." };
  }

  // ── 2. Build tlist + balance panel ─────────────────────────────────────────
  const tlistFull = [...new Set(rows.map(r => Number(r[timeCol])).filter(t => isFinite(t)))].sort((a, b) => a - b);
  const T = tlistFull.length;

  // Count unique times per entity (for balance check)
  const entityTimes = new Map();
  for (const r of rows) {
    const eid = r[entityCol];
    if (!entityG.has(eid)) continue;
    const t = Number(r[timeCol]);
    if (!isFinite(t)) continue;
    if (!entityTimes.has(eid)) entityTimes.set(eid, new Set());
    entityTimes.get(eid).add(t);
  }

  // Drop entities not present in ALL time periods
  const balancedEids = new Set();
  let droppedUnbalanced = 0;
  for (const [eid, times] of entityTimes) {
    if (times.size === T) {
      balancedEids.add(eid);
    } else {
      droppedUnbalanced++;
      entityG.delete(eid);
    }
  }
  if (droppedUnbalanced > 0) {
    warnings.push(`Dropped ${droppedUnbalanced} unbalanced units (not present in all time periods).`);
  }

  const tlist = tlistFull; // already sorted

  // ── 3. Build unit universe ──────────────────────────────────────────────────
  // units: Map<eid, G>
  // Drop cohort treated in first observed period (not identified)
  const firstT = tlist[0];
  let droppedFirstCohort = 0;
  for (const [eid, g] of entityG) {
    if (g === firstT) {
      entityG.delete(eid);
      droppedFirstCohort++;
    }
  }
  if (droppedFirstCohort > 0) {
    warnings.push(`Cohort g=${firstT} (treated in first observed period) is not identified and was dropped.`);
  }

  const units = entityG; // Map<eid, G>
  const nUnits = units.size;

  if (nUnits === 0) return { error: "No valid units after filtering." };

  // Treated cohorts (finite G, not first period)
  const treatedGValues = [...units.values()].filter(g => isFinite(g));
  if (!treatedGValues.length) return { error: "No treated units found. Ensure treatCol contains finite treatment periods." };

  const nTreated = treatedGValues.length;
  const glist = [...new Set(treatedGValues)].sort((a, b) => a - b);

  // P(G=g) over treated units only
  const groupProb = new Map();
  for (const g of glist) {
    const cnt = treatedGValues.filter(gg => gg === g).length;
    groupProb.set(g, cnt / nTreated);
  }

  // ── 4. Build row index: Map<eid, Map<t, row>> ───────────────────────────────
  const rowIndex = new Map();
  for (const r of rows) {
    const eid = r[entityCol];
    if (!units.has(eid)) continue;
    const t = Number(r[timeCol]);
    if (!isFinite(t)) continue;
    if (!rowIndex.has(eid)) rowIndex.set(eid, new Map());
    rowIndex.get(eid).set(t, r);
  }

  // eid → index in [0, nUnits-1] for influence function arrays
  const eidIndex = new Map();
  let idx = 0;
  for (const eid of units.keys()) eidIndex.set(eid, idx++);

  // ── 5. Enumerate cells ──────────────────────────────────────────────────────
  const cells = enumerateCells({ tlist, glist, anticipation, basePeriod });

  // ── 6. Compute ATT(g,t) for each non-ref cell ──────────────────────────────
  const cells2x2 = [];

  for (const cell of cells) {
    // Ref cells: push zero cell (needed for aggregate's pre-period Wald test)
    if (cell.isRef) {
      cells2x2.push({
        g: cell.g, t: cell.t, b: cell.b, e: cell.e,
        isPre: cell.isPre, isRef: true,
        att: 0,
        inf: new Float64Array(nUnits),
        n_g: 0,
      });
      continue;
    }

    // a. Select control set
    const { eids: controlEids, warning: ctrlWarn } = controlSet({
      units, g: cell.g, t: cell.t, b: cell.b, controlGroup: compGroup,
    });
    if (ctrlWarn) warnings.push(ctrlWarn);
    if (controlEids.length === 0) {
      warnings.push(`No control units for ATT(${cell.g},${cell.t}) — cell skipped.`);
      continue;
    }

    // b. Treated units for this cohort
    const treatedEids = [...units.entries()]
      .filter(([, G]) => G === cell.g)
      .map(([eid]) => eid);

    if (treatedEids.length === 0) continue;

    // c. Build sample: ΔY, D, X — one row per unit in treated+control
    const sampleEids = [];
    const deltaY     = [];
    const D          = [];
    const X          = [];

    const addUnit = (eid, isTreated) => {
      const eMap = rowIndex.get(eid);
      if (!eMap) return false;
      const rowT = eMap.get(cell.t);
      const rowB = eMap.get(cell.b);
      if (!rowT || !rowB) return false;
      const yT = Number(rowT[yCol]);
      const yB = Number(rowB[yCol]);
      if (!isFinite(yT) || !isFinite(yB)) return false;
      sampleEids.push(eid);
      deltaY.push(yT - yB);
      D.push(isTreated ? 1 : 0);
      // X: [1, ...xCols] from base period
      const xRow = [1, ...xCols.map(c => Number(rowB[c] ?? 0))];
      X.push(xRow);
      return true;
    };

    let skipped = 0;
    for (const eid of treatedEids) {
      if (!addUnit(eid, true)) skipped++;
    }
    for (const eid of controlEids) {
      if (!addUnit(eid, false)) skipped++;
    }

    const nSample = sampleEids.length;
    if (nSample === 0) {
      warnings.push(`ATT(${cell.g},${cell.t}): no valid obs after missing-row drop — cell skipped.`);
      continue;
    }

    const totalExpected = treatedEids.length + controlEids.length;
    if (skipped > 0.1 * totalExpected) {
      warnings.push(`ATT(${cell.g},${cell.t}): ${skipped} of ${totalExpected} units dropped due to missing rows.`);
    }

    // Count how many treated units made it into the sample
    const n_g_sample = sampleEids.filter((eid, i) => D[i] === 1).length;
    if (n_g_sample < xCols.length + 5) {
      warnings.push(`ATT(${cell.g},${cell.t}): small treated group (n_g=${n_g_sample}, covariates=${xCols.length}).`);
    }

    // d. Compute 2×2 ATT
    const weights = new Array(nSample).fill(1);
    const { att, inf: rawInf, warning: estWarn } = compute2x2({ deltaY, D, X, estMethod, weights });
    if (estWarn) warnings.push(`ATT(${cell.g},${cell.t}): ${estWarn}`);

    // e. Map influence function from sample length → nUnits length
    const cellInf = new Float64Array(nUnits);
    for (let si = 0; si < nSample; si++) {
      const eid = sampleEids[si];
      const ui = eidIndex.get(eid);
      if (ui !== undefined) cellInf[ui] = rawInf[si];
    }

    cells2x2.push({
      g: cell.g, t: cell.t, b: cell.b, e: cell.e,
      isPre: cell.isPre, isRef: false,
      att,
      inf: cellInf,
      n_g: n_g_sample,
    });
  }

  if (!cells2x2.some(c => !c.isRef)) {
    return { error: "Could not compute any ATT(g,t) — check that treated and control units share baseline and post periods." };
  }

  // ── 7. Filter attgt to relMin..relMax ───────────────────────────────────────
  const attgt = cells2x2.filter(c => !c.isRef && c.e >= relMin && c.e <= relMax);

  // ── 8. Aggregate ────────────────────────────────────────────────────────────
  const { aggregations, inference: infResult, ptestWald } = aggregate({
    cells2x2,
    groupProb,
    n: nUnits,
    inference,
  });

  // ── 9. Return result contract ────────────────────────────────────────────────
  return {
    type: "CallawayCS",
    attgt: attgt.map(c => ({
      g:     c.g,
      t:     c.t,
      e:     c.e,
      att:   c.att,
      se:    Math.sqrt(c.inf.reduce((s, v) => s + v * v, 0)) / nUnits,
      isPre: c.isPre,
      n_g:   c.n_g,
    })),
    aggregations,
    cohorts: glist,
    periods: tlist,
    nUnits,
    n: rows.length,
    controlGroup: compGroup,
    basePeriod,
    estMethod,
    anticipation,
    inference: infResult,
    ptestWald,
    warnings,
  };
}
