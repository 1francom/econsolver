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

// Aggregate ATT(g,t) cells into higher-level estimates.
// Not yet implemented — Task 3.
export function aggregate() {
  throw new Error("aggregate not yet implemented — Task 3");
}
