// ─── ECON STUDIO · unifiedScriptValidation.mjs ───────────────────────────────
// Pins the STRUCTURE of the Report's unified script (services/export/
// unifiedScript.js). The end-to-end proof — the script runs in R, Stata and
// Python and reproduces every model — is tools/validation/checkUnified.mjs on
// real data; this is the node-only guard against the old shape coming back:
// a Stata do-file made of self-contained pieces (`clear all` + reload per
// model, a derived dataset imported as if it were a file, a pin collapsing the
// data before anything was loaded — LMU PS4 died at line 8).
//   node src/services/export/__validation__/unifiedScriptValidation.mjs
import assert from "node:assert/strict";
import { buildUnifiedScript, resolveDataset } from "../unifiedScript.js";

let pass = 0;
const check = (name, fn) => { try { fn(); pass++; console.log(`  ok   ${name}`); }
  catch (e) { console.error(`  FAIL ${name}\n       ${e.message}`); process.exitCode = 1; } };

const datasets = {
  raw: { id: "raw", name: "panel.csv", filename: "panel.csv", loadOpts: null,
         pipeline: [{ type: "filter", predicate: { type: "condition", col: "g", op: "neq", value: "1" } }] },
  sub: { id: "sub", name: "subset_2014", filename: "subset_2014", loadOpts: null, pipeline: [] },
};
const globalPipeline = [{
  id: "G1", v: 2, opType: "derive", leftDatasetId: "sub", rightDatasetId: "raw", outputDatasetId: "sub", params: {}, left: null,
  right: { datasetId: "raw", name: "panel.csv", filename: "panel.csv", loadOpts: null,
    snapshot: [{ type: "filter", predicate: { type: "condition", col: "g", op: "neq", value: "1" } },
               { type: "filter", predicate: { type: "condition", col: "year", op: "eq", value: "2014" } }] },
}];
const items = [
  { kind: "model", label: "m on subset", dataset: "sub", model: { type: "OLS", yVar: "y", xVars: ["x"] } },
  { kind: "explore", label: "mean y by year", dataset: "raw", params: { kind: "timeseries", yCol: "y", timeCol: "year", agg: "mean" } },
  { kind: "model", label: "m on raw", dataset: "panel.csv", model: { type: "OLS", yVar: "y", xVars: ["x"] } },
];
const build = (lang) => buildUnifiedScript({ lang, datasets, globalPipeline, items });
const after = (s, marker) => s.slice(s.search(new RegExp(`^[*#] ${marker}$`, "m")));

check("T1 Stata: one `clear all`, every model uses its own dataset", () => {
  const s = build("stata");
  assert.equal((s.match(/^clear all$/gm) ?? []).length, 1, "clear all only in the header");
  const analysis = after(s, "2. Analysis");
  // the model block stores itself (m_ols) and the unified script adds mN
  assert.match(analysis, /use "subset_2014\.dta", clear\n(?:.*\n)*?reg y x\n(?:.*\n)*?estimates store m1\n/);
  assert.match(analysis, /use "panel_csv\.dta", clear\n(?:.*\n)*?reg y x\n(?:.*\n)*?estimates store m2\n/);
  assert.match(s, /estimates table m1 m2/);
});

check("T2 Stata: descriptive blocks cannot change what the next block sees", () => {
  const analysis = after(build("stata"), "2. Analysis");
  assert.match(analysis, /preserve\nuse "panel_csv\.dta", clear\n(?:.*\n)*?restore/);
});

check("T3 a derived dataset is rebuilt from lineage, never imported as a file", () => {
  for (const lang of ["r", "stata", "python"]) {
    const s = build(lang);
    assert.doesNotMatch(s, /import delimited "subset_2014"|read_csv\("subset_2014|read_csv\("subset_2014\.csv/, lang);
    assert.match(s, /Derived dataset: subset_2014/, lang);
  }
});

check("T4 R/Python models work on a local copy of their dataset", () => {
  assert.match(build("r"), /df <- df_subset_2014\n(?:.*\n)*?fit <- /);
  assert.match(build("python"), /df = df_subset_2014\.copy\(\)/);
  assert.match(build("r"), /^\.lx_models <- list\(\)$/m);
});

check("T5 an item whose dataset is not in the project says so", () => {
  const s = buildUnifiedScript({ lang: "r", datasets, globalPipeline,
    items: [{ kind: "model", label: "orphan", dataset: "gone.csv", model: { type: "OLS", yVar: "y", xVars: ["x"] } }] });
  assert.match(s, /NOTE: the dataset of this block \(gone\.csv\) is not in this project/);
});

check("T6 datasets resolve by id, name or filename", () => {
  assert.equal(resolveDataset(datasets, "sub")?.id, "sub");
  assert.equal(resolveDataset(datasets, "panel.csv")?.id, "raw");
  assert.equal(resolveDataset(datasets, "nope"), null);
});

console.log(`\nunifiedScript: ${pass} checks passed${process.exitCode ? " (with failures)" : ""}`);
