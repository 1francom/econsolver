// ─── ECON STUDIO · services/data/sortRows.js ────────────────────────────────
// View-level row ordering for the Data Viewer.
//
// This is the JS half of a two-branch sort: when the dataset is DuckDB-backed
// and unfiltered, the grid is paginated in SQL and the ORDER BY is pushed into
// `getTablePage` instead. The two branches MUST agree, or the same table would
// sort differently depending on whether DuckDB happens to be active — so the
// null handling here is written to match the `NULLS LAST` in that query.
//
// Null rule: blanks sort last in BOTH directions, matching dplyr::arrange
// (where NA stays last even under desc()) and DuckDB's NULLS LAST. A naive
// comparator floats nulls to the top on a descending sort, which reads as
// "my data disappeared".

const isBlank = v => v === null || v === undefined || v === "";

/**
 * Comparator for a single column.
 * @param {string} col
 * @param {"asc"|"desc"} dir
 */
export function rowComparator(col, dir = "asc") {
  const sign = dir === "desc" ? -1 : 1;
  return (a, b) => {
    const x = a?.[col], y = b?.[col];
    const bx = isBlank(x), by = isBlank(y);
    if (bx || by) return bx && by ? 0 : (bx ? 1 : -1);
    if (typeof x === "number" && typeof y === "number") return sign * (x - y);
    // `numeric: true` keeps "item10" after "item9" for the mixed alphanumeric
    // labels econ datasets are full of (comuna 1 … comuna 10, wave2 … wave10).
    return sign * String(x).localeCompare(String(y), undefined, { numeric: true });
  };
}

/**
 * Non-mutating sort. Returns the input untouched when there is nothing to do,
 * so the caller's memo can keep referential identity.
 * @param {object[]} rows
 * @param {{col:string, dir:"asc"|"desc"}|null} sort
 */
export function sortRows(rows, sort) {
  if (!sort?.col || !Array.isArray(rows) || rows.length < 2) return rows;
  return [...rows].sort(rowComparator(sort.col, sort.dir));
}
