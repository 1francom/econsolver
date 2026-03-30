// ─── ECON STUDIO · services/privacy/anonymizer.js ────────────────────────────
// Local anonymization utilities. No network calls.
// Three strategies: pseudonymize, suppress, generalize.
//
// Exports:
//   pseudonymize(values)               → string[]   (consistent hash aliases)
//   suppress(rows, col)                → rows with col removed
//   generalizeNumeric(value, buckets)  → string label
//   maskStringValue(value)             → string     (for display in previews)

// ─── PSEUDONYMIZATION ─────────────────────────────────────────────────────────
// Replaces each unique value with a stable alias (ENTITY_001, ENTITY_002, …).
// The mapping is deterministic within a session — same input → same alias.
// No actual hash leaves the app; the alias is what gets sent to the API if needed.

/**
 * Build a pseudonymization map for an array of values.
 * Returns a Map: originalValue → alias string.
 *
 * @param {any[]} values
 * @param {string} prefix   e.g. "ENTITY" → "ENTITY_001"
 * @returns {Map<any, string>}
 */
export function buildPseudoMap(values, prefix = "ENTITY") {
  const unique = [...new Set(values.filter(v => v != null))];
  const map = new Map();
  unique.forEach((v, i) => {
    map.set(v, `${prefix}_${String(i + 1).padStart(3, "0")}`);
  });
  return map;
}

/**
 * Apply a pseudonymization map to a column across all rows.
 * Rows are not mutated — returns new row objects.
 *
 * @param {Record<string,any>[]} rows
 * @param {string} col
 * @param {Map<any,string>} pseudoMap
 * @returns {Record<string,any>[]}
 */
export function applyPseudoMap(rows, col, pseudoMap) {
  return rows.map(r => ({
    ...r,
    [col]: pseudoMap.has(r[col]) ? pseudoMap.get(r[col]) : r[col],
  }));
}

// ─── SUPPRESSION ──────────────────────────────────────────────────────────────
/**
 * Remove a column entirely from all rows.
 * Returns new row objects and a new headers array.
 *
 * @param {Record<string,any>[]} rows
 * @param {string[]} headers
 * @param {string[]} colsToRemove
 */
export function suppressColumns(rows, headers, colsToRemove) {
  const colSet = new Set(colsToRemove);
  const newHeaders = headers.filter(h => !colSet.has(h));
  const newRows = rows.map(r => {
    const nr = { ...r };
    colsToRemove.forEach(c => delete nr[c]);
    return nr;
  });
  return { rows: newRows, headers: newHeaders };
}

// ─── GENERALIZATION ───────────────────────────────────────────────────────────
/**
 * Bin a numeric value into a labeled bucket.
 * Useful for age, income, etc. before sending descriptive stats to API.
 *
 * @param {number} value
 * @param {Array<{lo:number, hi:number, label:string}>} buckets
 * @returns {string}
 *
 * Example buckets for age:
 *   [
 *     { lo: 0,  hi: 17,  label: "0–17" },
 *     { lo: 18, hi: 29,  label: "18–29" },
 *     { lo: 30, hi: 49,  label: "30–49" },
 *     { lo: 50, hi: 64,  label: "50–64" },
 *     { lo: 65, hi: Infinity, label: "65+" },
 *   ]
 */
export function generalizeNumeric(value, buckets) {
  if (value == null || !isFinite(value)) return "N/A";
  const bucket = buckets.find(b => value >= b.lo && value <= b.hi);
  return bucket ? bucket.label : "Other";
}

// ─── DISPLAY MASKING ──────────────────────────────────────────────────────────
// For UI previews: show that a value exists without revealing it.
// Never used in API payloads — only in the privacy preview panel.

/**
 * Mask a string value for display: show first char + stars + last char.
 * "john.doe@lmu.de" → "j**********e"
 *
 * @param {any} value
 * @returns {string}
 */
export function maskStringValue(value) {
  if (value == null) return "—";
  const s = String(value);
  if (s.length <= 2) return "***";
  return s[0] + "*".repeat(Math.min(s.length - 2, 8)) + s[s.length - 1];
}

/**
 * Mask a numeric value by rounding to 1 significant digit.
 * 1_145_000 → "~1,000,000"
 *
 * @param {number} value
 * @returns {string}
 */
export function maskNumericValue(value) {
  if (value == null || !isFinite(value)) return "—";
  const magnitude = Math.pow(10, Math.floor(Math.log10(Math.abs(value))));
  const rounded = Math.round(value / magnitude) * magnitude;
  return `~${rounded.toLocaleString("de-DE")}`;
}
