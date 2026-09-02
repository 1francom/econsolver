// ─── ECON STUDIO · pipeline/__validation__/datasetContextValidation.mjs ─────
// Guards the join/append dataset context (feedback 2026-07-31: "when joining,
// the pipeline of the right dataset doesn't seem to be applied, changes don't
// merge").
//
// The property under test is the one that was broken: a join must see the right
// dataset AFTER its own cleaning steps, not before. The old code passed
// `d.rawData` straight through, so every assertion below that reads a renamed /
// filtered / derived column would have failed — silently, in the app, with a
// perfectly normal-looking merged table.
//
// Run:  node src/pipeline/__validation__/datasetContextValidation.mjs

import { buildDatasetContext, referencedDatasetIds } from "../datasetContext.js";
import { runPipeline } from "../runner.js";

let pass = 0;
const failures = [];
function check(name, ok, detail = "") {
  if (ok) { pass++; return; }
  failures.push(`${name}${detail ? ` — ${detail}` : ""}`);
}

const ds = (id, headers, rows, extra = {}) => ({ id, filename: `${id}.csv`, rawData: { headers, rows, ...extra } });
const loadRows = async (d) => ({ rows: d.rawData.rows, headers: d.rawData.headers });
const noSteps = () => [];

// Right dataset: two rows, one of which its own pipeline drops, plus a rename.
const RIGHT = ds("R", ["code", "gdp"], [
  { code: "AR", gdp: 100 },
  { code: "BR", gdp: 200 },
  { code: "ZZ", gdp: 999 },
]);
const RIGHT_STEPS = [
  { type: "filter", col: "code", op: "neq", value: "ZZ" },
  { type: "rename", col: "gdp", newName: "gdp_clean" },
];
const LEFT_ROWS = [{ code: "AR", pop: 45 }, { code: "BR", pop: 210 }, { code: "ZZ", pop: 1 }];
const LEFT_HEADERS = ["code", "pop"];

// ── T1: the right dataset's own pipeline is applied before the join ────────
{
  const { datasets, warnings } = await buildDatasetContext(
    [RIGHT], id => (id === "R" ? RIGHT_STEPS : []), loadRows, { only: ["R"] });
  const r = datasets.R;
  check("T1 right dataset is replayed, not raw",
    r.headers.includes("gdp_clean") && !r.headers.includes("gdp"), JSON.stringify(r.headers));
  check("T1b right dataset's filter applied", r.rows.length === 2, `${r.rows.length} rows`);
  check("T1c no warnings on the happy path", warnings.length === 0, JSON.stringify(warnings));

  const out = runPipeline(LEFT_ROWS, LEFT_HEADERS,
    [{ type: "join", how: "left", rightId: "R", leftKey: "code", rightKey: "code" }],
    { datasets });
  check("T2 join merges the RENAMED column", out.headers.includes("gdp_clean"), JSON.stringify(out.headers));
  check("T2b joined value comes from the cleaned frame",
    out.rows.find(x => x.code === "AR")?.gdp_clean === 100,
    JSON.stringify(out.rows[0]));
  check("T2c a row the right pipeline dropped gets no match",
    out.rows.find(x => x.code === "ZZ")?.gdp_clean == null,
    JSON.stringify(out.rows.find(x => x.code === "ZZ")));
}

// ── T3: this is exactly what the OLD behaviour got wrong ──────────────────
// Feeding rawData (what WranglingModule used to do) must produce the broken
// result — if it did not, the test above would prove nothing.
{
  const out = runPipeline(LEFT_ROWS, LEFT_HEADERS,
    [{ type: "join", how: "left", rightId: "R", leftKey: "code", rightKey: "code" }],
    { datasets: { R: RIGHT.rawData } });
  check("T3 raw context reproduces the reported bug (no cleaned column, ZZ matches)",
    !out.headers.includes("gdp_clean") && out.rows.find(x => x.code === "ZZ")?.gdp === 999,
    JSON.stringify(out.headers));
}

// ── T4: a dataset with NO steps keeps _duckdb AND gets its full rows ──────
// Dropping the table pointer would push every join off the SQL fast path. But
// forwarding rawData untouched was its own bug: a DuckDB-backed dataset's
// `rawData.rows` is only the 500-row PREVIEW, so any JS-path join silently
// matched against 500 rows. T4b used to assert object IDENTITY here — which is
// exactly what forwarded the preview. It now asserts the real contract: pointer
// preserved, rows loaded in full.
{
  const duck = ds("D", ["k"], [{ k: 1 }], { _duckdb: { tableName: "t_d", rowCount: 3 } });
  // Stand-in for extractAllRows: the table really holds 3 rows, the preview 1.
  const fullLoad = async (d) => d.rawData._duckdb
    ? { rows: [{ k: 1 }, { k: 2 }, { k: 3 }], headers: d.rawData.headers }
    : { rows: d.rawData.rows, headers: d.rawData.headers };
  const { datasets } = await buildDatasetContext([duck], noSteps, fullLoad, { only: ["D"] });
  check("T4 no-step dataset keeps its _duckdb pointer", datasets.D?._duckdb?.tableName === "t_d");
  check("T4b and carries the FULL table, not the preview",
    datasets.D?.rows?.length === 3, `got ${datasets.D?.rows?.length}`);
  // A plain (non-DuckDB) dataset still passes straight through — no needless copy.
  const plain = ds("P", ["k"], [{ k: 1 }]);
  const { datasets: pd } = await buildDatasetContext([plain], noSteps, loadRows, { only: ["P"] });
  check("T4c non-DuckDB no-step dataset is passed through untouched", pd.P === plain.rawData);
}

// ── T5: a dataset WITH steps must NOT expose _duckdb ──────────────────────
// Its table is the RAW one; letting the SQL join use it would reintroduce the
// bug one layer down, which is subtler than the original.
{
  const duck = ds("D", ["code", "gdp"], RIGHT.rawData.rows, { _duckdb: { tableName: "t_raw", rowCount: 3 } });
  const { datasets } = await buildDatasetContext([duck], () => RIGHT_STEPS, loadRows, { only: ["D"] });
  check("T5 processed dataset drops _duckdb so SQL falls back to JS",
    datasets.D._duckdb === undefined, JSON.stringify(Object.keys(datasets.D)));
  check("T5b and still carries the processed rows", datasets.D.rows.length === 2);
}

// ── T6: nested references resolve (B joins C, A joins B) ─────────────────
{
  const C = ds("C", ["k", "cval"], [{ k: "x", cval: 7 }]);
  const B = ds("B", ["k", "bval"], [{ k: "x", bval: 1 }]);
  const bSteps = [{ type: "join", how: "left", rightId: "C", leftKey: "k", rightKey: "k" }];
  const { datasets, warnings } = await buildDatasetContext(
    [B, C], id => (id === "B" ? bSteps : []), loadRows, { only: ["B"] });
  check("T6 nested join resolved inside the referenced dataset",
    datasets.B.rows[0]?.cval === 7, JSON.stringify(datasets.B.rows[0]));
  check("T6b no spurious warning", warnings.length === 0, JSON.stringify(warnings));
}

// ── T7: a reference CYCLE degrades to raw rows and says so ───────────────
{
  const A = ds("A", ["k", "a"], [{ k: "x", a: 1 }]);
  const B = ds("B", ["k", "b"], [{ k: "x", b: 2 }]);
  const steps = { A: [{ type: "join", how: "left", rightId: "B", leftKey: "k", rightKey: "k" }],
                  B: [{ type: "join", how: "left", rightId: "A", leftKey: "k", rightKey: "k" }] };
  const { datasets, warnings } = await buildDatasetContext([A, B], id => steps[id], loadRows, { only: ["A"] });
  check("T7 cycle terminates instead of hanging", !!datasets.A);
  check("T7b cycle is reported, not silent", warnings.some(w => /circular/i.test(w)), JSON.stringify(warnings));
}

// ── T8: a broken right pipeline warns instead of throwing ────────────────
{
  const bad = ds("X", ["k"], [{ k: 1 }]);
  const { datasets, warnings } = await buildDatasetContext(
    [bad], () => [{ type: "join", how: "left", rightId: "missing", leftKey: "k", rightKey: "k" }],
    async () => { throw new Error("table gone"); }, { only: ["X"] });
  check("T8 load failure falls back to raw", datasets.X === bad.rawData);
  check("T8b and is reported", warnings.some(w => /table gone/.test(w)), JSON.stringify(warnings));
}

// ── T9: `only` limits the work actually done ─────────────────────────────
{
  const A = ds("A", ["k"], [{ k: 1 }]);
  const B = ds("B", ["k"], [{ k: 2 }]);
  let loads = 0;
  const counting = async (d) => { loads++; return { rows: d.rawData.rows, headers: d.rawData.headers }; };
  const { datasets } = await buildDatasetContext([A, B], () => [{ type: "drop", col: "nope" }], counting, { only: ["A"] });
  check("T9 only the requested dataset is materialised", loads === 1 && !!datasets.A && !datasets.B, `loads=${loads}`);
}

// ── T10: referencedDatasetIds covers every reference field ───────────────
{
  const ids = referencedDatasetIds([
    { type: "join", rightId: "R1" },
    { type: "sp_grid_assign", gridDatasetId: "G1" },
    { type: "sp_spatial_join", polyDatasetId: "P1" },
    { type: "sp_boundary_dist", refDatasetId: "B1" },
    { type: "sp_boundary_dist", refDatasetId: "self" },
    { type: "sp_grid_assign", gridDatasetId: "active" },
    { type: "join", rightId: "R1" },
  ]).sort();
  check("T10 all four reference fields, sentinels excluded, deduped",
    JSON.stringify(ids) === '["B1","G1","P1","R1"]', JSON.stringify(ids));
  check("T10b empty pipeline yields nothing", referencedDatasetIds([]).length === 0);
  check("T10c undefined pipeline is safe", referencedDatasetIds(undefined).length === 0);
}

console.log(`datasetContext — ${pass} passed, ${failures.length} failed`);
failures.forEach(f => console.log(`  ✗ ${f}`));
process.exit(failures.length ? 1 : 0);
