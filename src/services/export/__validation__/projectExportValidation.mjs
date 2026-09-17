// ─── ECON STUDIO · projectExportValidation.mjs ───────────────────────────────
// The pure half of the project export: the reader must refuse anything that is
// not one of our files rather than half-applying it (same deny-by-default rule
// as artifactIO's parsers), and the filename must stay filesystem-safe.
//   node src/services/export/__validation__/projectExportValidation.mjs
import assert from "node:assert/strict";
import { parseProjectExport, projectExportFilename, PROJECT_EXPORT_KIND, PROJECT_EXPORT_VERSION } from "../projectExport.js";

let pass = 0;
const check = (name, fn) => { try { fn(); pass++; console.log(`  ok   ${name}`); }
  catch (e) { console.error(`  FAIL ${name}\n       ${e.message}`); process.exitCode = 1; } };

const good = { kind: PROJECT_EXPORT_KIND, version: PROJECT_EXPORT_VERSION, datasets: [],
  project: { pid: "proj_1", name: "Waldinger Validation Tutorial 5" } };

check("T1 a valid export round-trips", () => {
  const p = parseProjectExport(JSON.stringify(good));
  assert.equal(p.kind, PROJECT_EXPORT_KIND);
});

check("T2 anything that is not a project export is refused", () => {
  assert.throws(() => parseProjectExport("{"), /valid JSON/);
  // artifactIO's own files are JSON with a different kind — must not be accepted
  assert.throws(() => parseProjectExport(JSON.stringify({ kind: "litux/model-specs", models: [] })), /Not a Litux project export/);
  assert.throws(() => parseProjectExport(JSON.stringify({ datasets: [] })), /kind: missing/);
});

check("T3 a newer file version is refused, an older one is not", () => {
  assert.throws(() => parseProjectExport(JSON.stringify({ ...good, version: PROJECT_EXPORT_VERSION + 1 })), /newer version/);
  assert.doesNotThrow(() => parseProjectExport(JSON.stringify({ ...good, version: 0 })));
});

check("T4 a file without a dataset list is refused", () => {
  assert.throws(() => parseProjectExport(JSON.stringify({ ...good, datasets: undefined })), /no dataset list/);
});

check("T5 the filename is filesystem-safe and falls back to the pid", () => {
  assert.equal(projectExportFilename(good), "Waldinger_Validation_Tutorial_5.litux.json");
  assert.equal(projectExportFilename({ project: { pid: "proj_1" } }), "proj_1.litux.json");
  assert.equal(projectExportFilename({ project: { name: String.raw`a/b: c\d` } }), "a_b_c_d.litux.json");
  assert.doesNotMatch(projectExportFilename({}), /[^\w.-]/);
});

console.log(`\nprojectExport: ${pass} checks passed${process.exitCode ? " (with failures)" : ""}`);
