// ─── ECON STUDIO · tools/validation/checkPipelines.mjs ───────────────────────
// Does the pipeline Litux exports actually reproduce, from the RAW file, the
// table Litux itself produced? For every dataset in a project: emit Clean's
// pipeline script in R, Stata and Python, run each one, read the table it
// wrote, and compare it cell by cell against the app's own replay.
//
//   node tools/validation/checkPipelines.mjs PS5
//   node tools/validation/checkPipelines.mjs --all
//   node tools/validation/checkPipelines.mjs --selftest   (no project export needed)
//
// Exit code is non-zero if any language failed to reproduce a table.

import { mkdirSync, existsSync, readdirSync } from "node:fs";
import path from "node:path";
import { loadProjectUnit, compareTables, VAL, resolveDataFile, parseDataFile } from "./lib/loadProject.mjs";
import { runPipelineScript, runWorkspaceScript, LANGS } from "./lib/runScripts.mjs";
import { runPipeline } from "../../src/pipeline/runner.js";
import { ensureRowIdentity } from "../../src/services/data/rowIdentity.js";

const WORK = path.join(VAL, "results", "scripts");

// A pipeline the exporters must all reproduce, used by --selftest so the
// machinery can be exercised before any project export exists. Deliberately
// mixes a compound filter, derived columns, a rename, a drop and a sort.
const SELFTEST_STEPS = [
  { type: "filter", predicate: { type: "and", children: [
      { col: "bac1", op: "gt",  value: 0 },
      { col: "year", op: "gte", value: 2000 },
  ] } },
  { type: "log",     col: "bac1", nn: "log_bac1" },
  { type: "sq",      col: "aged", nn: "aged_sq" },
  { type: "std",     col: "bac1", mu: 0.1352, sd: 0.0451, nn: "z_bac1" },
  { type: "winz",    col: "aged", lo: 20, hi: 70, nn: "aged_w" },
  { type: "dummy",   col: "year", pfx: "yr" },
  { type: "rename",  col: "recidivism", newName: "recid" },
  { type: "drop",    col: "Alcohol2" },
  { type: "arrange", col: "bac1", dir: "asc" },
];

async function selftestUnit() {
  const file = resolveDataFile("hansen_data.csv");
  if (!file) throw new Error("hansen_data.csv not found under validation/");
  const raw = ensureRowIdentity(await parseDataFile(file));
  const clean = runPipeline(raw.rows, raw.headers, SELFTEST_STEPS, {});
  const ds = {
    id: "selftest", name: "hansen", filename: "hansen_data.csv", file,
    loadOpts: null, rawData: raw, steps: SELFTEST_STEPS, clean,
  };
  return { unit: "selftest", datasets: new Map([["selftest", ds]]), warnings: [] };
}

function unitsOnDisk() {
  const dir = VAL;
  return readdirSync(dir).filter(u => existsSync(path.join(dir, u, "project.litux.json")));
}

async function checkUnit(unit) {
  const proj = unit === "selftest" ? await selftestUnit() : await loadProjectUnit(unit);
  const dir  = path.join(WORK, unit);
  // Not removed: Windows keeps a handle on the Stata log for a moment after the
  // process exits, and a failed cleanup must not fail the check. Files are
  // overwritten per run anyway.
  mkdirSync(dir, { recursive: true });

  const allDatasets = Object.fromEntries([...proj.datasets.values()].map(d =>
    [d.id, { name: d.name, filename: d.file }]));

  let fails = 0;
  console.log(`\n══ ${unit}`);
  for (const w of proj.warnings) console.log(`   ! ${w}`);

  for (const ds of proj.datasets.values()) {
    console.log(`\n   ${ds.name}  (${ds.steps.length} steps · Litux: ${ds.clean.rows.length} rows × ${ds.clean.headers.length} cols)`);
    if (!ds.file) { console.log("     (derived inside Litux — checked in the workspace phase below)"); continue; }
    if (!ds.steps.length) { console.log("     (no pipeline — nothing to reproduce)"); continue; }
    for (const language of LANGS) {
      const res = runPipelineScript({ language, dataset: ds, allDatasets, dir });
      if (!res.ok) { fails++; console.log(`     FAIL ${language.padEnd(6)} ${res.err.split("\n").slice(-2).join(" ").slice(0, 200)}`); continue; }
      const cmp = compareTables(ds.clean, res.table, { tol: 1e-6 });
      if (cmp.ok) console.log(`     ok   ${language.padEnd(6)} ${res.table.rows.length} rows × ${res.table.headers.length} cols${cmp.orderNote ? `  [${cmp.orderNote}]` : ""}`);
      else { fails++; console.log(`     DIFF ${language.padEnd(6)} ${cmp.diffs.slice(0, 4).join(" | ")}`); }
    }
  }

  // Workspace phase: the whole-project script, which is the only export that
  // rebuilds datasets derived inside Litux (and does so from their lineage).
  if (unit !== "selftest" && [...proj.datasets.values()].some(d => !d.file)) {
    console.log(`\n   workspace script (all datasets)`);
    for (const language of LANGS) {
      const res = runWorkspaceScript({ language, datasets: proj.datasets, globalPipeline: proj.globalPipeline, dir: path.join(dir, "workspace") });
      if (!res.ok) { fails++; console.log(`     FAIL ${language.padEnd(6)} ${String(res.err).split("\n").filter(Boolean).slice(-2).join(" ").slice(0, 240)}`); }
      for (const ds of proj.datasets.values()) {
        const t = res.tables.get(ds.id);
        if (!t) { if (res.ok) { fails++; console.log(`     FAIL ${language.padEnd(6)} ${ds.name}: no table written`); } continue; }
        const cmp = compareTables(ds.clean, t, { tol: 1e-6 });
        if (cmp.ok) console.log(`     ok   ${language.padEnd(6)} ${ds.name}  ${t.rows.length} rows × ${t.headers.length} cols`);
        else { fails++; console.log(`     DIFF ${language.padEnd(6)} ${ds.name}: ${cmp.diffs.slice(0, 3).join(" | ")}`); }
      }
    }
  }
  return fails;
}

const arg = process.argv[2];
const units = arg === "--selftest" ? ["selftest"]
  : (!arg || arg === "--all") ? unitsOnDisk()
  : [arg];
if (!units.length) {
  console.log("No project exports found. Export each project from the Dataset Manager into validation/<unit>/project.litux.json,");
  console.log("or run: node tools/validation/checkPipelines.mjs --selftest");
}
let fails = 0;
for (const u of units) {
  try { fails += await checkUnit(u); }
  catch (e) { fails++; console.log(`\n══ ${u}\n   FAILED: ${e.message}`); }
}
console.log(`\n${fails ? `${fails} failure(s)` : "all pipelines reproduced"}`);
if (fails) process.exitCode = 1;
