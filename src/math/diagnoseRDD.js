// Preflight diagnostics for Sharp RDD fit failures (runSharpRDD returning null).
// Returns a human-readable explanation instead of the generic "not enough
// observations" message, which was misleading for the (very common) one-sided
// subset case. Pure JS — no React, no engine deps. Mirrors diagnoseFit.js.

/**
 * Diagnose why runSharpRDD(rows, yCol, runCol, cutoff, h, ...) returned null.
 *
 * @param {object[]} rows    Raw rows passed to the engine (pre-bandwidth-filter)
 * @param {string}   yCol    Outcome column name
 * @param {string}   runCol  Running variable column name
 * @param {number}   cutoff  RDD cutoff
 * @param {number}   h       Bandwidth actually used
 * @returns {string}         Diagnostic message (never null)
 */
export function diagnoseRDD(rows, yCol, runCol, cutoff, h) {
  const valid = rows.filter(r =>
    typeof r[yCol] === "number" && typeof r[runCol] === "number" &&
    isFinite(r[yCol]) && isFinite(r[runCol]) &&
    Math.abs(r[runCol] - cutoff) <= h
  );
  const n = valid.length;

  if (n < 6) {
    return `Only ${n} observation${n === 1 ? "" : "s"} fall within the bandwidth (±${h.toFixed(4)} around cutoff ${cutoff}) — need at least 6. Widen the bandwidth, or check that this sample actually has data near the cutoff.`;
  }

  const nTreated = valid.reduce((s, r) => s + (r[runCol] >= cutoff ? 1 : 0), 0);
  if (nTreated === 0 || nTreated === n) {
    const side = nTreated === 0 ? "below" : "at or above";
    return `All ${n} observations within the bandwidth fall ${side} the cutoff (${cutoff}) — a discontinuity can't be estimated without observations on both sides. Check whether a filter is excluding one side of the cutoff.`;
  }

  return `RDD estimation failed — likely near-perfect collinearity in the local polynomial design (check for constant or duplicated control variables).`;
}
