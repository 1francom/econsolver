// ─── ECON STUDIO · src/services/data/suffStatsCache.js ─────────────────────────
// LRU cache for sufficient statistics (X'X, X'Y, Y'Y, β, Ainv, …) keyed by
// (tableName, yCol, sorted xCols). Held in a useRef inside ModelingTab — not
// persisted to IndexedDB. Invalidated on any pipeline / dataset change.
//
// `seType` is NOT part of the key: suff stats don't depend on SE choice;
// only the meat pass does. Flipping classical→HC1 reuses cached β/Ainv.

/**
 * @param {number} maxEntries  LRU eviction threshold (default 50)
 * @returns cache instance with get/set/invalidate/size
 */
export function createSuffStatsCache(maxEntries = 50) {
  const map = new Map();
  return {
    get(key) {
      if (!map.has(key)) return null;
      const v = map.get(key);
      // LRU: re-insert to mark most-recently used
      map.delete(key);
      map.set(key, v);
      return v;
    },
    set(key, value) {
      if (map.has(key)) map.delete(key);
      map.set(key, value);
      while (map.size > maxEntries) {
        const oldestKey = map.keys().next().value;
        map.delete(oldestKey);
      }
    },
    invalidate() {
      map.clear();
    },
    size() {
      return map.size;
    },
  };
}

/**
 * Deterministic key from (tableName, yCol, xCols [, zCols]).
 * Order of xCols / zCols irrelevant. When zCols is provided (2SLS suff-stats),
 * the instrument tuple is appended after a `|Z|` sentinel so OLS keys remain
 * disjoint from IV keys with the same X.
 */
export function makeCacheKey(tableName, yCol, xCols, zCols = null) {
  const xs = [...xCols].sort().join(",");
  if (!zCols) return `${tableName}|${yCol}|${xs}`;
  const zs = [...zCols].sort().join(",");
  return `${tableName}|${yCol}|${xs}|Z|${zs}`;
}

/**
 * Defensive check: dim of XtX must match k+1 (k = xCols.length). When zCols is
 * provided, also verify ZtZ dim matches q+1.
 */
export function validateSuffStatsEntry(entry, xCols, zCols = null) {
  if (!entry || !entry.XtX) return false;
  if (entry.XtX.length !== xCols.length + 1) return false;
  if (zCols) {
    if (!entry.ZtZ) return false;
    if (entry.ZtZ.length !== zCols.length + 1) return false;
  }
  return true;
}
