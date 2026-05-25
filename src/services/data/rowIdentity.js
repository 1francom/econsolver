// ─── ECON STUDIO · services/data/rowIdentity.js ──────────────────────────────
// Stable row-identity helper. Every dataset loaded into the app must pass
// through `ensureRowIdentity` so that:
//
//   __ri      — sequential integer assigned at load time (legacy column,
//               used by the in-app `patch` step in runner.js)
//   __row_id  — UUID v4 assigned at load time. Globally unique across
//               datasets and stable through any pipeline step that
//               preserves row identity. This is the column referenced by
//               R / Stata / Python replication scripts when translating
//               cell-edit (`patch`) steps:
//                 R:      df[df$__row_id == "abc123", "income"] <- 30000
//                 Stata:  replace income = 30000 if __row_id == "abc123"
//                 Python: df.loc[df.__row_id == "abc123", "income"] = 30000
//
// Invariant: `__row_id` must never be renamed, dropped, or overwritten by
// any pipeline step. Steps that reshape row identity (pivot_longer,
// group_summarize, append on duplicate keys) are allowed to produce rows
// without `__row_id`, in which case the loader for the derived dataset
// re-runs `ensureRowIdentity` on the result.

function uuidV4() {
  // Prefer the native browser UUID generator; fall back to a Math.random
  // polyfill only in environments where `crypto.randomUUID` is unavailable
  // (very old browsers, some test runners).
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return crypto.randomUUID();
  }
  // RFC 4122 v4 fallback
  return "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, c => {
    const r = (Math.random() * 16) | 0;
    const v = c === "x" ? r : (r & 0x3) | 0x8;
    return v.toString(16);
  });
}

/**
 * Ensures every row in a parsed dataset has both `__ri` (sequential int)
 * and `__row_id` (UUID v4). Idempotent — rows already carrying both
 * columns are returned unchanged.
 *
 * @param {{headers:string[], rows:object[]}} data
 * @returns {{headers:string[], rows:object[]}}
 */
export function ensureRowIdentity(data) {
  if (!data?.rows?.length) return data;
  const first = data.rows[0];
  const hasRi  = first.__ri !== undefined;
  const hasUid = first.__row_id !== undefined;
  if (hasRi && hasUid) return data;
  const rows = data.rows.map((r, i) => {
    const next = { ...r };
    if (next.__ri === undefined)     next.__ri     = i;
    if (next.__row_id === undefined) next.__row_id = uuidV4();
    return next;
  });
  return { ...data, rows };
}

/**
 * Retrofit `__row_id` on rows loaded from IndexedDB before v4 of the
 * schema. Preserves any existing `__ri` so cell-edit patches that
 * reference the old sequential id keep working.
 *
 * @param {{headers:string[], rows:object[]}} data
 * @returns {{headers:string[], rows:object[]}}
 */
export function retrofitRowId(data) {
  return ensureRowIdentity(data);
}

/**
 * Columns that the data pipeline must never drop, rename, or overwrite.
 * Imported by runner.js to enforce the invariant.
 */
export const PROTECTED_ROW_ID_COLS = ["__row_id", "__ri"];
