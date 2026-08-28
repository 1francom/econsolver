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
  left:  freezeParent({ id: "d1", name: "comunas", filename: "comunas.csv" }, [{ id: 1, type: "drop", col: "col" }]),
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
assert.equal(emitMode(gStepV2.left, [{ id: 1, type: "drop", col: "col" }]), "identical");

// A v1 record (no `v`, no left/right) must stay recognisable, not crash.
const gStepV1 = { id: "G_1", opType: "left_join", leftDatasetId: "d1",
                  rightDatasetId: "d2", outputDatasetId: "d1", params: {} };
assert.equal(emitMode(gStepV1.left, []), "legacy");

console.log("lineageValidation: G-step v2 contract OK");

// -- topoSort ----------------------------------------------------------------
// deps[left].add(right), then `inDegree[dep]++` counted DEPENDENTS, not in-degree.
// The queue started with nodes nobody depends on -- i.e. the LEFT dataset -- so a
// join's left operand was emitted before the right one it consumes.
const { topoSort } = await import("../exporter.js");

assert.deepEqual(
  topoSort([{ id: "A" }, { id: "B" }], [{ leftDatasetId: "A", rightDatasetId: "B" }]),
  ["B", "A"],
  "the right operand must come first"
);

// Chain: C consumes B, B consumes A.
assert.deepEqual(
  topoSort([{ id: "A" }, { id: "B" }, { id: "C" }],
           [{ leftDatasetId: "C", rightDatasetId: "B" }, { leftDatasetId: "B", rightDatasetId: "A" }]),
  ["A", "B", "C"]
);

// A derive: the child (outputDatasetId) waits for its parent.
assert.deepEqual(
  topoSort([{ id: "child" }, { id: "parent" }],
           [{ opType: "derive", outputDatasetId: "child", leftDatasetId: "child", rightDatasetId: "parent" }]),
  ["parent", "child"]
);

// A cycle (two datasets joined into each other, which the in-place model allows)
// must not hang or drop nodes -- every id appears exactly once.
const cyc = topoSort([{ id: "A" }, { id: "B" }],
                     [{ leftDatasetId: "A", rightDatasetId: "B" },
                      { leftDatasetId: "B", rightDatasetId: "A" }]);
assert.equal(cyc.length, 2);
assert.deepEqual([...cyc].sort(), ["A", "B"]);

console.log("lineageValidation: topoSort OK");

// -- isInAppDataset ----------------------------------------------------------
// It guessed from the filename: no extension => "produced by the Spatial section".
// "joined_data" has no extension, so the script claimed it was regenerated by a
// Spatial section that did not exist -- and then offered a read_csv on the next
// line, contradicting itself.
const { isInAppDataset } = await import("../exporter.js");

assert.equal(isInAppDataset({ id: "d1", name: "comunas", filename: "comunas.csv" }, []), false);

// A dataset PRODUCED by a G-step is in-app -- regardless of what it is called.
const producedBy = [{ opType: "derive", outputDatasetId: "d9", rightDatasetId: "d1" }];
assert.equal(isInAppDataset({ id: "d9", name: "joined_data", filename: null }, producedBy), true,
  "a dataset produced by a G-step is rebuilt in-script");

// A bare-named dataset that NOTHING produces must fall back to a file load --
// silently skipping it leaves the script referencing an undefined variable.
assert.equal(isInAppDataset({ id: "d5", name: "joined_data", filename: null }, []), false,
  "no G-step produces it, so it must be loaded from a file, not assumed regenerated");

console.log("lineageValidation: isInAppDataset OK");

// -- three-case emission -----------------------------------------------------
const { generateWorkspaceScript } = await import("../exporter.js");

const mkDs = (id, name, pipeline) => ({ id, name, filename: `${name}.csv`, pipeline, loadOpts: null });
const dropCol  = { id: 1, type: "drop", col: "col" };
const filtStep = { id: 2, type: "filter",
                   predicate: { type: "condition", col: "nombre", op: "neq", value: "Comuna_1" } };

const gJoin = {
  id: "G_1", v: 2, opType: "left_join",
  leftDatasetId: "c", rightDatasetId: "p", outputDatasetId: "j",
  params: { how: "left", leftKey: "id", rightKey: "id", suffix: "_r" },
  left:  freezeParent({ id: "c", name: "comunas", filename: "comunas.csv" }, [dropCol]),
  right: freezeParent({ id: "p", name: "crimen",  filename: "crimen.csv"  }, []),
};
const wsR = (comunasPipe, gp = [gJoin]) => {
  const out = generateWorkspaceScript({
    language: "r",
    datasets: { c: mkDs("c", "comunas", comunasPipe), p: mkDs("p", "crimen", []),
                j: mkDs("j", "joined_data", []) },
    globalPipeline: gp,
  });
  assert.ok(out && typeof out === "object" && "perDataset" in out && "crossDataset" in out,
    "generateWorkspaceScript must return { perDataset, crossDataset } so the Report AI can be bypassed");
  return `${out.perDataset}\n${out.crossDataset}`;
};

// (a) identical -- the parent has not moved since the join
const identical = wsR([dropCol]);
assert.match(identical, /df_joined_data <- dplyr::left_join\(df_comunas, df_crimen/,
  "identical: emit the one-liner against the live parent dfs");
assert.doesNotMatch(identical, /_at_join/, "no expansion needed when the parent has not moved");
assert.doesNotMatch(identical, /read_csv\("joined_data\.csv"\)/,
  "a dataset PRODUCED by a G-step is never loaded from a file");
assert.match(identical, /suffix = c\("", "_r"\)/, "the workspace join must emit the suffix too");
assert.doesNotMatch(identical, /distinct/, "no first-match compensation any more");

// (b) prefix -- the parent APPENDED a step after the join
const prefix = wsR([dropCol, filtStep]);
assert.doesNotMatch(prefix, /_at_join/, "an appended step needs no expansion, just ordering");
const iJoin = prefix.indexOf("left_join");
const iFilt = prefix.indexOf("Comuna_1");
assert.ok(iJoin > -1 && iFilt > -1 && iJoin < iFilt,
  "the join must be emitted BEFORE the step the parent added afterwards");

// (c) diverged -- a frozen step was deleted from the parent
const diverged = wsR([filtStep]);
assert.match(diverged, /\.comunas_at_join/, "a deleted frozen step forces expansion from raw");
assert.match(diverged, /select\(-col\)/, "the expansion replays the FROZEN step the parent dropped");
assert.match(diverged, /changed after/, "the expansion must say why it is there");
const expStart = diverged.indexOf(".comunas_at_join");
const expBlock = diverged.slice(expStart, diverged.indexOf("df_joined_data <-", expStart));
assert.doesNotMatch(expBlock, /Comuna_1/, "the expansion must NOT include steps added after the join");

// (d) an ORPHANED gStepId must still be emitted, never dropped.
// undo/redo restore `pipeline` but not `globalPipeline`, so undoing a join
// deletion leaves a local step pointing at a G-step that no longer exists. The
// per-dataset loop skips local steps with a gStepId, so without a fallback that
// join would appear NOWHERE in the script.
const orphan = generateWorkspaceScript({
  language: "r",
  datasets: {
    c: { id: "c", name: "comunas", filename: "comunas.csv", loadOpts: null,
         pipeline: [dropCol, { id: 3, type: "join", gStepId: "G_GONE", rightId: "p",
                               leftKey: "id", rightKey: "id", how: "left", suffix: "_r" }] },
    p: mkDs("p", "crimen", []),
  },
  globalPipeline: [],
});
assert.match(`${orphan.perDataset}\n${orphan.crossDataset}`, /left_join/,
  "a local join whose G-step is gone must fall back to inline emission, not vanish");

// (e) derive -- Clean's "Save as dataset", with staged forma-1 joins on top
const gDerive = {
  id: "G_2", v: 2, opType: "derive",
  leftDatasetId: "j", rightDatasetId: "c", outputDatasetId: "j",
  params: { joins: [{ how: "left", leftKey: "id", rightKey: "id", suffix: "_r",
                      right: freezeParent({ id: "p", name: "crimen", filename: "crimen.csv" }, []) }] },
  left: null,
  right: freezeParent({ id: "c", name: "comunas", filename: "comunas.csv" }, [dropCol]),
};
const derived = wsR([dropCol], [gDerive]);
assert.match(derived, /df_joined_data <- df_comunas/, "derive starts from its frozen parent");
assert.match(derived, /left_join\(df_joined_data, df_crimen/, "staged forma-1 joins run on top of it");

// (f) all three languages return the split shape and actually emit the join.
// Only R was covered above; a language left returning a plain string would break
// both call sites (Report AI bypass + DatasetManager export) at runtime.
for (const [lang, joinRe] of [["stata", /merge 1:m/], ["python", /pd\.merge\(/]]) {
  const out = generateWorkspaceScript({
    language: lang,
    datasets: { c: mkDs("c", "comunas", [dropCol]), p: mkDs("p", "crimen", []),
                j: mkDs("j", "joined_data", []) },
    globalPipeline: [gJoin],
  });
  assert.ok(out && typeof out === "object" && "perDataset" in out && "crossDataset" in out,
    `${lang}: must return { perDataset, crossDataset }`);
  assert.match(out.crossDataset, joinRe, `${lang}: the join must be emitted`);
  assert.doesNotMatch(out.perDataset, /joined_data\.csv|joined_data\.dta/,
    `${lang}: a produced dataset is never loaded from a file`);
  assert.doesNotMatch(`${out.perDataset}\n${out.crossDataset}`, /distinct|drop_duplicates|_n == 1/,
    `${lang}: no first-match compensation any more`);
}

console.log("lineageValidation: emission OK");
