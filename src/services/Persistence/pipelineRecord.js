// ─── ECON STUDIO · services/Persistence/pipelineRecord.js ────────────────────
// One reader for a per-dataset pipeline slot.
//
// `savePipeline` stores each dataset's steps as `steps` (see indexedDB.js's
// `inner`), but the field has been read as `.pipeline` in places, which yields
// an EMPTY pipeline instead of throwing. That is how the Report's unified
// script emitted every non-active dataset with no pipeline at all: PS4's CSV
// was loaded and its renames and filters skipped, so the pins, plots and
// derived datasets that followed referenced columns that did not exist. The
// same misread was in the Dataset Manager's workspace-script export.
//
// `pipeline` stays as a fallback: `savePipeline` spreads a caller's `...rest`
// into the slot, so an old record can legitimately carry that name.

/** @returns {object[]} the steps of one dataset's slot — never null. */
export function storedSteps(rec) {
  if (Array.isArray(rec?.steps)) return rec.steps;
  if (Array.isArray(rec?.pipeline)) return rec.pipeline;
  return [];
}
