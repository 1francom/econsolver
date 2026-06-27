// ─── ECON STUDIO · src/math/did/staggeredDiD.js ──────────────────────────────
// Staggered DiD cell enumeration and control-set selection.
// Pure math. No React. No side effects.
//
// Task 2 of Callaway-Sant'Anna rewrite:
//   - enumerateCells: all (g,t,b) cells with varying/universal base periods
//   - controlSet: never-treated vs not-yet-treated control groups
//
// Task 3 will add:
//   - aggregate: 4 aggregation schemes (simple, dynamic, group, calendar)

/**
 * Enumerate all estimable (g,t,b) cells for staggered DiD.
 *
 * For each cohort g, we build:
 *   1. Pre-period cells: compare (g,t,b) where t < g and b < t
 *   2. Post-period cells: compare (g,t,b) where t >= g (with anticipation) and b < g
 *
 * Base period selection (b) depends on basePeriod:
 *   - "varying": each (g,t) pair chooses b = max{s ∈ tlist | s < t}
 *   - "universal": fixed b per cohort = max{s ∈ tlist | s < g*}, shared across all t
 *
 * @param {{ tlist: number[], glist: number[], anticipation: number, basePeriod: "varying"|"universal" }} opts
 * @returns {Array<{g, t, b, e, isPre, isRef}>}
 *   - g: cohort (treatment time)
 *   - t: observation time
 *   - b: base period (comparison time)
 *   - e: relative time = t - g
 *   - isPre: boolean, true if t < gStar (pre-treatment period)
 *   - isRef: boolean, true if this is the universal reference cell
 */
export function enumerateCells({ tlist, glist, anticipation = 0, basePeriod = "varying" }) {
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

/**
 * Select the control set (unit IDs) for a specific (g,t,b) cell.
 *
 * The control group excludes:
 *   1. The focal cohort g itself (units treated at time g)
 *   2. Units treated after the current period (depending on controlGroup type)
 *
 * Control group types:
 *   - "nevertreated": only units with G = Infinity (never treated)
 *                     If none exist, falls back to "not-yet-treated" with warning
 *   - "notyettreated": units with G > max(t, b) OR G = Infinity,
 *                      excluding the focal cohort g
 *
 * @param {{ units: Map<string,number>, g: number, t: number, b: number, controlGroup: string }} opts
 * @returns {{ eids: string[], warning?: string }}
 */
export function controlSet({ units, g, t, b, controlGroup }) {
  const laterPeriod = Math.max(t, b);
  let eids = [];
  let warning;

  if (controlGroup === "nevertreated") {
    // Collect only never-treated units (G = Infinity)
    eids = [...units.entries()]
      .filter(([, G]) => G === Infinity)
      .map(([eid]) => eid);

    // Fallback if no never-treated units available
    if (eids.length === 0) {
      warning = "No never-treated units found; falling back to not-yet-treated control group.";
      eids = [...units.entries()]
        .filter(([, G]) => G > laterPeriod && G !== g)
        .map(([eid]) => eid);
    }
  } else {
    // "notyettreated" or default: units treated after the latest period, excluding focal cohort
    eids = [...units.entries()]
      .filter(([, G]) => G > laterPeriod && G !== g)
      .map(([eid]) => eid);
  }

  return { eids, warning };
}

/**
 * Aggregate ATT(g,t) cells into higher-level estimates.
 * Not yet implemented — Task 3.
 */
export function aggregate() {
  throw new Error("aggregate not yet implemented — Task 3");
}
