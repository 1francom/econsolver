// src/services/data/distinctValuesFallback.js
// Pure JS distinct-value counter — used when no DuckDB table backs the
// current dataset (small files stay entirely in JS `rows`, which for a
// non-DuckDB dataset already IS the full data, never a preview).
export function jsDistinctValues(rows, col, limit = 500) {
  const counts = new Map();
  for (const r of rows) {
    const v = r[col];
    if (v === null || v === undefined) continue;
    counts.set(v, (counts.get(v) ?? 0) + 1);
  }
  const sorted = [...counts.entries()].sort((a, b) => b[1] - a[1]);
  return {
    values: sorted.slice(0, limit).map(([value, count]) => ({ value, count })),
    total: counts.size,
  };
}
