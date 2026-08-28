// A derived dataset must be reconstructible from what IT carries -- never from
// the live state of a parent that may since have been edited or deleted.
//
// R has value semantics: `df2 <- df1 %>% filter(...)` copies. Editing df1
// afterwards does not change df2. Litux promises "this replicates in R", so its
// lineage must behave the same way.
import assert from "node:assert/strict";
import { freezeParent, emitMode, isPrefix } from "../lineage.js";

const ds = { id: "d1", name: "comunas_metadata", filename: "comunas_metadata.csv",
             loadOpts: { delimiter: ";" } };
const pipeAt = [{ id: 1, type: "drop", cols: ["col"] }];

// -- freezeParent captures everything needed to rebuild from the raw file ----
const frozen = freezeParent(ds, pipeAt);
assert.equal(frozen.datasetId, "d1");
assert.equal(frozen.name, "comunas_metadata");
assert.equal(frozen.filename, "comunas_metadata.csv");
assert.deepEqual(frozen.loadOpts, { delimiter: ";" });
assert.deepEqual(frozen.snapshot, pipeAt);

// It must be a COPY -- mutating the parent's array afterwards cannot reach it.
pipeAt.push({ id: 2, type: "filter" });
assert.equal(frozen.snapshot.length, 1, "snapshot must not alias the live pipeline array");

// -- isPrefix ----------------------------------------------------------------
assert.equal(isPrefix([{ id: 1 }], [{ id: 1 }, { id: 2 }]), true);
assert.equal(isPrefix([{ id: 1 }], [{ id: 1 }]), true);
assert.equal(isPrefix([{ id: 1 }], [{ id: 9 }, { id: 1 }]), false, "same ids, wrong order is not a prefix");
assert.equal(isPrefix([{ id: 1 }, { id: 2 }], [{ id: 1 }]), false);

// -- emitMode -- the three-case emission rule -------------------------------
assert.equal(emitMode(frozen, [{ id: 1 }]), "identical");
assert.equal(emitMode(frozen, [{ id: 1 }, { id: 2 }]), "prefix",
  "parent only APPENDED steps -- the join can still be emitted at its point in the chain");
assert.equal(emitMode(frozen, [{ id: 2 }]), "diverged",
  "the frozen step was deleted from the parent -- must expand from raw");
assert.equal(emitMode(frozen, []), "diverged");
assert.equal(emitMode(null, [{ id: 1 }]), "legacy", "a v1 G-step with no frozen record");

console.log("lineageValidation: helpers OK");

// -- G-step v2 shape contract -----------------------------------------------
// WranglingModule.addStep and exporter.generateWorkspaceScript must agree on
// this shape. Neither can be imported here (React / heavy deps), so the contract
// is pinned directly: changing one side without the other breaks this file.
const gStepV2 = {
  id: "G_123", v: 2, localStepId: 123,
  opType: "left_join",
  leftDatasetId: "d1", rightDatasetId: "d2",
  outputDatasetId: "d1",                      // forma 2 -- result stays in the left
  params: { how: "left", leftKey: "id", rightKey: "id", suffix: "_r" },
  left:  freezeParent({ id: "d1", name: "comunas", filename: "comunas.csv" }, [{ id: 1, type: "drop" }]),
  right: freezeParent({ id: "d2", name: "crimen",  filename: "crimen.csv"  }, []),
};

for (const k of ["id", "v", "opType", "leftDatasetId", "rightDatasetId", "outputDatasetId", "params", "left", "right"]) {
  assert.ok(k in gStepV2, `G-step v2 must carry '${k}'`);
}
assert.equal(gStepV2.v, 2);
assert.equal(gStepV2.outputDatasetId, gStepV2.leftDatasetId, "forma 2 writes back to the left dataset");
for (const side of ["left", "right"]) {
  for (const k of ["datasetId", "name", "filename", "loadOpts", "snapshot"]) {
    assert.ok(k in gStepV2[side], `G-step v2 '${side}' must carry '${k}' (self-sufficient after parent deletion)`);
  }
}
assert.equal(emitMode(gStepV2.left, [{ id: 1, type: "drop" }]), "identical");

// A v1 record (no `v`, no left/right) must stay recognisable, not crash.
const gStepV1 = { id: "G_1", opType: "left_join", leftDatasetId: "d1",
                  rightDatasetId: "d2", outputDatasetId: "d1", params: {} };
assert.equal(emitMode(gStepV1.left, []), "legacy");

console.log("lineageValidation: G-step v2 contract OK");
