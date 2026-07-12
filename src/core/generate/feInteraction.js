// ─── ECON STUDIO · src/core/generate/feInteraction.js ─────────────────────────
// Materializes a composite fixed-effect group from 2+ source columns, e.g.
// state × year → one combined FE dimension with a distinct level per
// (state, year) pair. Used only inside estimator calls — never written to
// rawData or injected as a pipeline step (spatial-filter-style local scope).

/**
 * @param {object[]} rows
 * @param {string[]} sourceCols - 2+ column names to cross
 * @param {string} [outCol] - name for the materialized column; defaults to
 *   sourceCols joined with "×"
 * @returns {{ rows: object[], outCol: string }} new rows array (shallow-copied
 *   objects) with `outCol` added; original rows/columns untouched
 */
export function materializeFEInteraction(rows, sourceCols, outCol) {
  if (sourceCols.length < 2) throw new Error("materializeFEInteraction requires at least 2 source columns.");
  const name = outCol || sourceCols.join("×");
  const withInteraction = rows.map(r => ({
    ...r,
    [name]: sourceCols.map(c => String(r[c] ?? " NA")).join("\x01"),
  }));
  return { rows: withInteraction, outCol: name };
}
