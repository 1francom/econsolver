// ─── ECON STUDIO · pipeline/datasetContext.js ───────────────────────────────
// Builds the `context.datasets` map that join/append/union/spatial steps read
// when they reference ANOTHER dataset.
//
// The bug this exists to fix (Supabase feedback 2026-07-31, "when joining, the
// pipeline of the right dataset doesn't seem to be applied, changes don't
// merge"): WranglingModule built the map straight from each dataset's
// `rawData`, so a join pulled the right dataset's ORIGINAL rows and silently
// ignored every cleaning step applied to it. Nothing errored — you just merged
// the wrong data.
//
// So the map has to carry each dataset's POST-pipeline state. Two consequences
// that drive the design:
//
//   1. A referenced dataset's own pipeline may itself reference a third
//      dataset, so resolution is recursive. Two datasets can reference each
//      other, so it is cycle-guarded and depth-capped; a cycle degrades to raw
//      rows WITH a recorded warning rather than hanging or silently lying.
//
//   2. `_duckdb.tableName` on a dataset points at its RAW table. Passing it
//      through for a dataset that has steps would put the SQL join back on the
//      unprocessed data — the exact bug, one layer down. So `_duckdb` is
//      forwarded ONLY for datasets with an empty pipeline (where raw and
//      processed are the same thing, and the SQL fast path is safe). A dataset
//      with steps is materialised, which makes the SQL join translation return
//      null and hand the step to the JS runner — slower, but correct.

import { runPipeline } from "./runner.js";

// Every field a step can use to point at another dataset.
const REF_FIELDS = ["rightId", "gridDatasetId", "polyDatasetId", "refDatasetId"];

/** Dataset ids referenced by a pipeline. "self"/"active" are sentinels, not ids. */
export function referencedDatasetIds(steps) {
  const ids = new Set();
  for (const s of steps ?? []) {
    for (const f of REF_FIELDS) {
      const v = s?.[f];
      if (v && v !== "self" && v !== "active") ids.add(v);
    }
  }
  return [...ids];
}

/**
 * @param {object[]} datasets    - [{ id, rawData: { rows, headers, _duckdb? } }]
 * @param {(id:string)=>object[]} pipelineFor - steps for a dataset id
 * @param {(ds:object)=>Promise<{rows,headers}>} loadRows - full rows for a dataset.
 *        Injected rather than imported so this module stays runnable (and
 *        testable) outside the browser, where DuckDB does not exist.
 * @param {{maxDepth?:number, only?:string[]}} opts - `only` limits which datasets
 *        are materialised at the top level. Nested references still resolve on
 *        demand, so this is purely about not replaying pipelines (and not
 *        pulling whole DuckDB tables) for datasets nothing actually joins to.
 * @returns {Promise<{ datasets: object, warnings: string[] }>}
 */
export async function buildDatasetContext(datasets, pipelineFor, loadRows, opts = {}) {
  const maxDepth = opts.maxDepth ?? 4;
  const byId = new Map((datasets ?? []).filter(d => d?.id).map(d => [d.id, d]));
  const cache = new Map();
  const resolving = new Set();
  const warnings = [];

  async function resolve(id, depth) {
    const ds = byId.get(id);
    if (!ds) return null;
    if (cache.has(id)) return cache.get(id);

    const steps = pipelineFor(id) ?? [];
    // No steps: raw IS processed. Forward rawData untouched so a DuckDB-backed
    // dataset keeps its table pointer and the SQL join stays on the fast path.
    if (!steps.length) {
      cache.set(id, ds.rawData);
      return ds.rawData;
    }

    if (resolving.has(id)) {
      warnings.push(`Circular dataset reference involving "${ds.filename ?? id}" — used its raw rows to break the cycle.`);
      return ds.rawData;
    }
    if (depth >= maxDepth) {
      warnings.push(`Dataset "${ds.filename ?? id}" is nested more than ${maxDepth} joins deep — used its raw rows.`);
      return ds.rawData;
    }

    resolving.add(id);
    try {
      const inner = {};
      for (const refId of referencedDatasetIds(steps)) {
        const r = await resolve(refId, depth + 1);
        if (r) inner[refId] = r;
      }
      const { rows, headers } = await loadRows(ds);
      const out = runPipeline(rows, headers, steps, { datasets: inner });
      // Deliberately no _duckdb — see the header note.
      const snapshot = { rows: out.rows, headers: out.headers };
      cache.set(id, snapshot);
      return snapshot;
    } catch (e) {
      warnings.push(`Could not replay the pipeline for "${ds.filename ?? id}" (${e?.message ?? e}) — used its raw rows.`);
      return ds.rawData;
    } finally {
      resolving.delete(id);
    }
  }

  const targets = Array.isArray(opts.only) ? opts.only.filter(id => byId.has(id)) : [...byId.keys()];
  const out = {};
  for (const id of targets) {
    const r = await resolve(id, 0);
    if (r) out[id] = r;
  }
  return { datasets: out, warnings };
}
