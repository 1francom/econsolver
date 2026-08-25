// ─── ECON STUDIO · pipeline/portability.js ───────────────────────────────────
// What it means for a pipeline.json to be portable into another session.
//
// Two step properties do not survive a transfer, and until this file existed
// ImportPipelineButton checked neither — it validated `type` against
// STEP_TYPES, reported success, and left the steps to fail or no-op at replay:
//
//   1. Dataset references. `rightId` (the 6 merge steps) and the six
//      *DatasetId fields (8 sp_* steps) hold ids from genId() in DataStudio.
//   2. Row identity. `patch` matches on __ri, assigned per dataset by
//      ensureRowIds — replaying foreign patches edits whichever row happens to
//      carry that id. `inject_column` carries a dense array lifted from a model
//      result and is the same class.
//
// The reference-field list is DERIVED from STEP_REGISTRY (type:"dataset"), not
// hand-kept here: a hand-kept list is exactly the drift the condition-language
// dialects were, and pipelineReliabilityValidation's T7 guard keeps the
// declarations honest.

import { STEP_REGISTRY } from "./registry.js";

// Sentinels meaning "the current frame" — portable by construction.
const SENTINELS = new Set(["self", "active"]);

// Steps whose meaning is tied to THIS dataset's row identity.
const ROW_IDENTITY_TYPES = new Set(["patch", "inject_column"]);

// { stepType: ["rightId", ...] } derived from the registry schemas.
export function datasetRefFields() {
  const out = {};
  for (const entry of STEP_REGISTRY) {
    const keys = (entry.schema ?? []).filter(f => f.type === "dataset").map(f => f.key);
    if (keys.length) out[entry.type] = keys;
  }
  return out;
}

// ctx = { datasetIds: string[], targetDatasetId: string, payloadDatasetId: string|null }
// Returns { steps, unresolved, rowIdentityDropped }.
//   steps               — what should actually be imported
//   unresolved          — [{ index, type, field, value }] to report, NOT to abort on
//   rowIdentityDropped  — count of patch/inject_column steps removed
export function checkPipelinePortability(steps = [], ctx = {}) {
  const known   = new Set(ctx.datasetIds ?? []);
  const refs    = datasetRefFields();
  // Conservative: an unstamped payload (exported before this landed) is treated
  // as coming from a different dataset, because silently applying foreign
  // row-level edits is the failure mode this exists to prevent.
  const sameDataset = !!ctx.payloadDatasetId && ctx.payloadDatasetId === ctx.targetDatasetId;

  const unresolved = [];
  const kept = [];
  let rowIdentityDropped = 0;

  steps.forEach((s, index) => {
    if (ROW_IDENTITY_TYPES.has(s.type) && !sameDataset) { rowIdentityDropped++; return; }
    for (const field of refs[s.type] ?? []) {
      const v = s[field];
      if (!v || SENTINELS.has(v) || known.has(v)) continue;
      unresolved.push({ index, type: s.type, field, value: v });
    }
    kept.push(s);
  });

  return { steps: kept, unresolved, rowIdentityDropped };
}
