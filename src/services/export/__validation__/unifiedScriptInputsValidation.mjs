// ─── ECON STUDIO · unifiedScriptInputsValidation.mjs ─────────────────────────
// The three defects found in Franco's first in-app PS4 do-file (2026-09-18).
// All three lived inside React components, where nothing could check them, so
// each was extracted to a pure module first:
//   storedSteps              — the per-dataset slot stores `steps`, not `pipeline`
//   assignModelsToEstimates  — one estimation block consumes one model
//   collapseDataLines        — pasted data becomes a counted placeholder, not nothing
//   node src/services/export/__validation__/unifiedScriptInputsValidation.mjs
import assert from "node:assert/strict";
import { storedSteps } from "../../Persistence/pipelineRecord.js";
import { assignModelsToEstimates } from "../timelinePlan.js";
import { collapseDataLines } from "../../AI/scriptNotesInput.js";

let pass = 0;
const check = (name, fn) => { try { fn(); pass++; console.log(`  ok   ${name}`); }
  catch (e) { console.error(`  FAIL ${name}\n       ${e.message}`); process.exitCode = 1; } };

check("T1 a dataset's steps are read from the field savePipeline writes", () => {
  // savePipeline's slot: { steps, panel, dataDictionary, branchPointIndex }
  const slot = { steps: [{ type: "rename", col: "Both genders", newName: "education" }], panel: null };
  assert.deepEqual(storedSteps(slot), slot.steps);
  // Reading `.pipeline` returned [] for every non-active dataset: PS4's CSV was
  // loaded with its renames and filters dropped.
  assert.equal(storedSteps(slot).length, 1);
});

check("T2 a legacy slot carrying `pipeline` still resolves, junk gives []", () => {
  assert.deepEqual(storedSteps({ pipeline: [{ type: "drop", col: "x" }] }).length, 1);
  for (const junk of [null, undefined, {}, { steps: "nope" }, { steps: null }]) {
    assert.deepEqual(storedSteps(junk), []);
  }
});

// Four FE models on the same outcome, as in PS4 (m_cont, m_cfe, m_twfe, m_ct).
const fe = (label, filename = "no_world") =>
  ({ label, type: "FE", spec: { filename, yVar: "GDP" } });
const evt = (type = "FE", yVar = "GDP", filename = "no_world") => ({ params: { type, yVar, filename } });

check("T3 each estimation block consumes one model — four FE models, four blocks", () => {
  const candidates = [fe("m_cont"), fe("m_cfe"), fe("m_twfe"), fe("m_ct")];
  const { matched, leftover } = assignModelsToEstimates([evt(), evt(), evt(), evt()], candidates);
  assert.deepEqual(matched.map(m => m?.label), ["m_cont", "m_cfe", "m_twfe", "m_ct"]);
  assert.deepEqual(leftover, []);
});

check("T4 more blocks than models: the extras are unmatched, not a repeat", () => {
  const candidates = [fe("m_cont")];
  const { matched, leftover } = assignModelsToEstimates([evt(), evt(), evt()], candidates);
  assert.deepEqual(matched.map(m => m?.label ?? null), ["m_cont", null, null]);
  assert.deepEqual(leftover, []);
});

check("T5 a model the timeline never matched comes back in leftover", () => {
  const candidates = [fe("m_cont"), { label: "m_iv", type: "2SLS", spec: { filename: "no_world", yVar: "GDP" } }];
  const { matched, leftover } = assignModelsToEstimates([evt()], candidates);
  assert.deepEqual(matched.map(m => m?.label), ["m_cont"]);
  assert.deepEqual(leftover.map(m => m.label), ["m_iv"]);
});

check("T6 an exact (type, y, filename) match wins over a loose one", () => {
  const other = fe("m_other", "other.csv");
  const exact = fe("m_exact", "no_world");
  const { matched } = assignModelsToEstimates([evt("FE", "GDP", "no_world")], [other, exact]);
  assert.equal(matched[0].label, "m_exact");
});

check("T7 pasted data collapses to one counted comment, never to nothing", () => {
  const stata = [
    "input double education__resid",
    "-6.643941530941708",
    "-6.5924431309417075",
    "0.5",
    "end",
    "reg GDP__resid education__resid",
  ].join("\n");
  const out = collapseDataLines(stata, "*");
  // The model must see that the block HAS data — it previously read an empty
  // input/end pair and told the user to paste the residuals in by hand.
  assert.match(out, /^\* … 3 data value\(s\) pasted here/m);
  assert.doesNotMatch(out, /-6\.6439/, "values must not leave the browser");
  assert.match(out, /^input double education__resid$/m);
  assert.match(out, /^end$/m);
  assert.match(out, /^reg GDP__resid education__resid$/m);
});

check("T8 code lines that merely contain numbers are kept verbatim", () => {
  const r = [
    "df <- df[df$Year <= 2020, ]",
    "1.5",
    "2.5",
    "fit <- lm(GDP ~ education, data = df)",
    "version 17",
  ].join("\n");
  const out = collapseDataLines(r, "#");
  assert.match(out, /^df <- df\[df\$Year <= 2020, \]$/m);
  assert.match(out, /^fit <- lm\(GDP ~ education, data = df\)$/m);
  assert.match(out, /^version 17$/m);
  assert.equal((out.match(/data value\(s\) pasted here/g) ?? []).length, 1);
});

console.log(`\nunifiedScriptInputs: ${pass} checks passed${process.exitCode ? " (with failures)" : ""}`);
