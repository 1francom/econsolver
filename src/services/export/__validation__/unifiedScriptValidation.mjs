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

check("T7 a derived dataset with no lineage record is flagged, one with lineage is not", () => {
  // `origin` set + no G-step building it = saved before lineage was recorded:
  // nothing can rebuild it from raw data, and the script must say so above the
  // load line instead of quietly reading a file that does not exist.
  const orphan = { ...datasets, nw: { id: "nw", name: "no_world", filename: "no_world", origin: "raw", pipeline: [] } };
  for (const lang of ["r", "stata", "python"]) {
    const s = buildUnifiedScript({ lang, datasets: orphan, globalPipeline, items: [] });
    assert.match(s, /NOTE: no_world was derived inside Litux before its lineage was recorded/, lang);
    // `subset_2014` IS built by a G-step, so it must not be flagged.
    assert.doesNotMatch(s, /NOTE: subset_2014 was derived/, lang);
  }
});

check("T8 Stata setup is not repeated once the workspace section is inlined", () => {
  const s = build("stata");
  for (const line of ["clear all", "version 17", "set more off"]) {
    assert.equal((s.match(new RegExp(`^${line}$`, "gm")) ?? []).length, 1, line);
  }
});

check("T9 a pin taken under an Explore filter applies it, on its own copy", () => {
  const filtered = [{ kind: "explore", label: "mean y, treated", dataset: "raw",
    params: { kind: "timeseries", yCol: "y", timeCol: "year", groupCol: "g", agg: "mean",
      filters: [{ col: "y", op: "gt", val: "0" }, { col: "g", op: "in", val: "a, b" },
                { col: "z", op: "gt", val: "" }] } }];
  const mk = (lang) => buildUnifiedScript({ lang, datasets, globalPipeline, items: filtered });
  // Stata filters in place — the caller wraps pins in preserve/restore.
  assert.match(mk("stata"), /preserve\n(?:.*\n)*?keep if \(\(!missing\(y\) & y > 0\) & \(g == "a" \| g == "b"\)\)\n(?:.*\n)*?restore/);
  // R/Python must not overwrite the shared frame.
  assert.match(mk("r"), /\.pin_d <- dplyr::filter\(df_panel, /);
  assert.match(mk("python"), /_pin_d = df_panel\[/);
  // A half-typed numeric condition is inert in the app, so it must not appear.
  for (const lang of ["r", "stata", "python"]) assert.doesNotMatch(mk(lang), /\bz\b/, lang);
});

check("T10 a grouped Stata time series draws one line per group", () => {
  const s = buildUnifiedScript({ lang: "stata", datasets, globalPipeline,
    items: [{ kind: "explore", label: "ts", dataset: "raw",
      params: { kind: "timeseries", yCol: "y", timeCol: "year", groupCol: "g", agg: "mean" } }] });
  // `twoway line y year` after a grouped collapse is ONE polyline through every group.
  assert.match(s, /egen _lx_grp = group\(g\), label\nxtset _lx_grp year\nxtline y, overlay/);
  assert.doesNotMatch(s, /twoway line y year/);
});

check("T6 datasets resolve by id, name or filename", () => {
  assert.equal(resolveDataset(datasets, "sub")?.id, "sub");
  assert.equal(resolveDataset(datasets, "panel.csv")?.id, "raw");
  assert.equal(resolveDataset(datasets, "nope"), null);
});

console.log(`\nunifiedScript: ${pass} checks passed${process.exitCode ? " (with failures)" : ""}`);
