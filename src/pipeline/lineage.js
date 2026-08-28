// ─── ECON STUDIO · pipeline/lineage.js ───────────────────────────────────────
// Frozen provenance for derived datasets.
//
// R has value semantics: `df2 <- df1 %>% filter(...)` copies. Editing df1
// afterwards does not change df2. Litux promises "this replicates in R", so its
// lineage must behave the same way: when a dataset is derived (a join written to
// a new dataset, or "Save as dataset"), each parent's state is FROZEN into the
// G-step. Nothing about the parent can reach the child afterwards.
//
// The frozen record is deliberately self-sufficient — it carries filename and
// loadOpts, not just a datasetId — so the child stays reconstructible even after
// the parent is deleted from the session. That decouples correctness from the
// dependency graph: the topological order becomes a readability optimisation,
// not a requirement.
//
// Pure JS, no React imports.

/**
 * Snapshot a parent dataset at the moment a child is derived from it.
 *
 * @param {object} ds         - { id, name, filename, loadOpts }
 * @param {object[]} pipeline - the parent's pipeline AS OF NOW
 * @returns {{datasetId:string|null, name:string|null, filename:string|null, loadOpts:object|null, snapshot:object[]}}
 */
export function freezeParent(ds, pipeline) {
  return {
    datasetId: ds?.id ?? null,
    name:      ds?.name ?? ds?.filename ?? null,
    filename:  ds?.filename ?? null,
    loadOpts:  ds?.loadOpts ?? null,
    // A new array of shallow step copies. The live pipeline array is replaced by
    // setPipeline on every edit, but a caller could hand us the same reference —
    // copying here is what makes the snapshot actually frozen.
    snapshot:  (Array.isArray(pipeline) ? pipeline : []).map(s => ({ ...s })),
  };
}

/**
 * Is `a` a leading prefix of `b`? Compared by step id sequence — step ids are
 * unique and stable (Date.now() + Math.random() at creation), and Litux only
 * ever appends or removes steps, never edits one in place.
 */
export function isPrefix(a, b) {
  if (!Array.isArray(a) || !Array.isArray(b)) return false;
  if (a.length > b.length) return false;
  for (let i = 0; i < a.length; i++) {
    if (a[i]?.id !== b[i]?.id) return false;
  }
  return true;
}

/**
 * How should the exporter emit a child built from this frozen parent?
 *
 *   "legacy"    - no frozen record (a v1 G-step). Caller falls back to the old
 *                 by-reference emission.
 *   "identical" - the parent has not moved. Emit the one-liner against df_parent.
 *   "prefix"    - the parent only APPENDED steps. Emit the child at its point in
 *                 the parent's chain, before those later steps.
 *   "diverged"  - a frozen step was removed or reordered. Rebuild the parent's
 *                 state from its raw file under a private name.
 *
 * @param {object|null} frozen  - a freezeParent() record
 * @param {object[]}    current - the parent's pipeline right now
 * @returns {"legacy"|"identical"|"prefix"|"diverged"}
 */
export function emitMode(frozen, current) {
  if (!frozen || !Array.isArray(frozen.snapshot)) return "legacy";
  const cur = Array.isArray(current) ? current : [];
  if (frozen.snapshot.length === cur.length && isPrefix(frozen.snapshot, cur)) return "identical";
  if (isPrefix(frozen.snapshot, cur)) return "prefix";
  return "diverged";
}
