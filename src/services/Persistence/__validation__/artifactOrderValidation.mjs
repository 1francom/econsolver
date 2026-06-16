import assert from "node:assert/strict";
import { makeArtifactId, parseArtifactId, orderArtifacts } from "../artifactOrder.js";

// makeArtifactId / parseArtifactId round-trip, including ids containing ":"
assert.equal(makeArtifactId("plot", "ph_x4"), "plot:ph_x4");
assert.deepEqual(parseArtifactId("plot:ph_x4"), { type: "plot", id: "ph_x4" });
assert.deepEqual(parseArtifactId("model:a:b"), { type: "model", id: "a:b" });

// orderArtifacts: known ids honor order; unknowns append by savedAt
const arts = [
  { artifactId: "plot:p1", savedAt: 30 },
  { artifactId: "map:m1",  savedAt: 10 },
  { artifactId: "model:x", savedAt: 20 },
];
const ordered = orderArtifacts(arts, ["model:x", "plot:p1"]);
assert.deepEqual(ordered.map(a => a.artifactId), ["model:x", "plot:p1", "map:m1"]);

// empty order → pure savedAt ordering
assert.deepEqual(
  orderArtifacts(arts, []).map(a => a.artifactId),
  ["map:m1", "model:x", "plot:p1"]
);

// undefined order (realistic cold-start value) → same as empty
assert.deepEqual(
  orderArtifacts(arts, undefined).map(a => a.artifactId),
  ["map:m1", "model:x", "plot:p1"]
);

console.log("artifactOrder OK");
