// ─── Fase X1 — Pipeline runner reliability harness ───────────────────────────
// Plan: docs/superpowers/plans/2026-05-22-fase-x1-pipeline-reliability.md
// Spec: specs/2026-05-21-pre-launch-roadmap.md → Track C → Fase X1
//
// Plain node script (no test runner): `node src/pipeline/__validation__/pipelineReliabilityValidation.mjs`
// Prints [pass]/[FAIL] per check + a summary; exits 1 if anything fails.
//
// Covers the runner's core invariants that are NOT already value-checked by
// gridSteps.test.mjs:
//   T5  registry ↔ runner sync (every registry type has a runner case)
//   T1  per-step smoke over ALL registry types + golden checks for the
//       CLAUDE.md "key bugs" (lag/lead/diff cross-unit, winz creation-time
//       bounds, normalize_cats numeric variants)
//   T4  non-destructive guarantee (deep-frozen rawData survives a replay)
//   T2/3 composability + serialization round-trip determinism
//   T6  audit trail completeness (one entry per step, ordered)

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { applyStep, runPipeline } from "../runner.js";
import { auditPipeline } from "../auditor.js";
import { STEP_REGISTRY, STEP_TYPES, defaultStep } from "../registry.js";

const __dirname = dirname(fileURLToPath(import.meta.url));

let pass = 0, fail = 0;
const check = (n, c, extra) => {
  if (c) { pass++; console.log("  [pass]", n); }
  else   { fail++; console.log("  [FAIL]", n, extra != null ? "→ " + extra : ""); }
};
const section = (t) => console.log("\n── " + t + " ──");

// ─── FIXTURES ─────────────────────────────────────────────────────────────────
// 2 entities × 2 periods. Rich column set so every step has valid operands.
const FIX = () => [
  { __ri: 0, id: "a", t: 1, region: "north", wage: 1000, educ: 12, inc: 50,   treat: 1, post: 0, d1: 1, d2: 0, date: "2020-03-15", price: "$1,200.50", cat: "arg" },
  { __ri: 1, id: "a", t: 2, region: "south", wage: 1500, educ: 14, inc: null, treat: 1, post: 1, d1: 0, d2: 1, date: "2021-07-20", price: "$2,300.00", cat: "ARG" },
  { __ri: 2, id: "b", t: 1, region: "north", wage: 2000, educ: 16, inc: 70,   treat: 0, post: 0, d1: 1, d2: 0, date: "2020-11-01", price: "$3,100.25", cat: "Argentina" },
  { __ri: 3, id: "b", t: 2, region: "north", wage: 2500, educ: 18, inc: 90,   treat: 0, post: 1, d1: 0, d2: 1, date: "2021-02-28", price: "$4,000.75", cat: "bra" },
];
const HEADERS = ["id", "t", "region", "wage", "educ", "inc", "treat", "post", "d1", "d2", "date", "price", "cat"];

// Right-hand dataset for merge steps.
const RIGHT = { rows: [{ id: "a", gdp: 100 }, { id: "b", gdp: 200 }], headers: ["id", "gdp"] };
const CTX = { datasets: { R1: RIGHT } };

// Spatial fixtures — Munich-ish points + two adjacent WKT grid cells (lon lat order).
const SP_POINTS = () => [
  { __ri: 0, name: "p1", lat: 48.14, lon: 11.55 },
  { __ri: 1, name: "p2", lat: 48.15, lon: 11.65 },
  { __ri: 2, name: "p3", lat: 48.30, lon: 11.90 },   // outside both cells
];
const SP_HEADERS = ["name", "lat", "lon"];
const SP_GRID = {
  rows: [
    { grid_id: "g1", zone: "west", wkt: "POLYGON((11.5 48.1, 11.6 48.1, 11.6 48.2, 11.5 48.2, 11.5 48.1))" },
    { grid_id: "g2", zone: "east", wkt: "POLYGON((11.6 48.1, 11.7 48.1, 11.7 48.2, 11.6 48.2, 11.6 48.1))" },
  ],
  headers: ["grid_id", "zone", "wkt"],
};
CTX.datasets.G1 = SP_GRID;

// T1 uses SMOKE_INPUT[type] when present; FIX/HEADERS otherwise.
const SMOKE_INPUT = {};
for (const t of ["sp_distance", "sp_crs_transform", "sp_buffer", "sp_grid_assign", "sp_spatial_join", "sp_nearest", "sp_boundary_dist",
  "sp_metric_buffer", "sp_buffer_exposure", "sp_aggregate_grid", "sp_areal_interp"]) {
  SMOKE_INPUT[t] = { rows: SP_POINTS(), headers: SP_HEADERS };
}

// Per-step minimal valid config (merged over defaultStep). Steps that require
// the async expression worker or network are smoke-EXEMPT (still covered by T5).
const WORKER_OR_NET = new Set(["ai_tr", "mutate", "if_else", "case_when", "geocode", "grouped_mutate"]);

const SMOKE = {
  rename:        { col: "region", newName: "reg" },
  drop:          { col: "region" },
  filter:        { col: "wage", op: "gt", value: "1200" },
  add_column:    { nn: "flag", fill: "1", dtype: "number" },
  add_row:       { count: 1, values: { region: "west" }, _seq: 9 },
  set_where:     { col: "wage", where: { col: "region", op: "equals", value: "north" }, action: "set", value: "0", dtype: "number" },
  replace:       { col: "region", match: { mode: "exact", find: "north" }, replaceWith: "N" },
  str_splice:    { col: "region", mode: "insert", position: 1, text: "X" },
  drop_na:       { cols: ["inc"], how: "any" },
  fill_na:       { col: "inc", strategy: "mean" },
  fill_na_grouped:{ col: "inc", groupCol: "id", strategy: "mean" },
  type_cast:     { col: "wage", to: "string" },
  quickclean:    { col: "region", mode: "upper" },
  recode:        { col: "region", map: { north: "N", south: "S" } },
  normalize_cats:{ col: "cat", map: { arg: "Argentina", ARG: "Argentina" } },
  distinct:      { subset: ["region"], keep: "first" },
  winz:          { col: "wage", lo: 1100, hi: 2400, nn: "wage_w" },
  log:           { col: "wage", nn: "lwage" },
  sq:            { col: "educ", nn: "educ2" },
  std:           { col: "wage", mu: 1750, sd: 645, nn: "wage_z" },
  dummy:         { col: "region", pfx: "reg" },
  lag:           { col: "wage", n: 1, ec: "id", tc: "t", nn: "wage_l1" },
  lead:          { col: "wage", n: 1, ec: "id", tc: "t", nn: "wage_f1" },
  diff:          { col: "wage", ec: "id", tc: "t", nn: "dwage" },
  ix:            { c1: "wage", c2: "educ", nn: "wage_x_educ" },
  did:           { tc: "treat", pc: "post", nn: "did" },
  date_parse:    { col: "date", fmt: "auto" },
  date_extract:  { col: "date", parts: ["year", "month"], names: {} },
  vector_assign: { nn: "grp", values: "x,y", mode: "recycle" },
  arrange:       { col: "wage", dir: "desc" },
  group_summarize:{ by: ["region"], aggs: [{ col: "wage", fn: "mean", nn: "wage_mean" }] },
  group_transform:{ by: ["region"], col: "wage", fn: "mean", nn: "wage_gm" },
  connected_components: { colA: "id", colB: "region", nn: "component", keepLargest: "all" },
  patch:         { internal: true, ri: 0, col: "region", value: "edited" },
  join:          { rightId: "R1", leftKey: "id", rightKey: "id", how: "left", suffix: "_r" },
  append:        { rightId: "R1" },
  bind_cols:     { rightId: "R1", suffix: "_r" },
  union:         { rightId: "R1" },
  intersect:     { rightId: "R1" },
  setdiff:       { rightId: "R1" },
  trim_outliers: { col: "wage", lo: 1100, hi: 2400 },
  flag_outliers: { col: "wage", nn: "wage_out", method: "iqr" },
  extract_regex: { col: "price", nn: "price_num", locale: "dot" },
  clean_strings: { col: "region", stripPunct: true, normSep: false, case: "lower" },
  pivot_longer:  { cols: ["wage", "educ"], namesTo: "var", valuesTo: "val", idCols: ["id", "t"] },
  pivot_wider:   { idCols: ["id"], namesFrom: "t", valuesFrom: ["wage"], valuesFill: 0, namesPrefix: "w" },
  factor_interactions: { contCol: "wage", dummyCols: ["d1", "d2"], prefix: "wxd_" },
  inject_column: { colName: "pred", values: [1, 2, 3, 4] },
  balance_panel: { entityCol: "id", timeCol: "t", outcomeCols: ["wage"], staticCols: ["region"], fillValue: 0 },
  sp_distance:      { latCol: "lat", lonCol: "lon", refLat: 48.14, refLon: 11.55, outCol: "dist_km", metric: false, binCol: "" },
  sp_crs_transform: { mode: "point", source: "EPSG:4326", target: "EPSG:32721", xCol: "lon", yCol: "lat", outX: "x_m", outY: "y_m" },
  sp_buffer:        { latCol: "lat", lonCol: "lon", refLat: 48.14, refLon: 11.55, radiusKm: 5, outCol: "in_buffer" },
  sp_grid_assign:   { gridType: "existing", latCol: "lat", lonCol: "lon", outCol: "grid_id", gridDatasetId: "G1", wktCol: "wkt", gridIdCol: "grid_id", extraCols: ["zone"] },
  sp_spatial_join:  { latCol: "lat", lonCol: "lon", polyDatasetId: "G1", wktCol: "wkt", joinCols: ["zone"], predicate: "within" },
  sp_nearest:       { latCol: "lat", lonCol: "lon", refDatasetId: "self", refLatCol: "lat", refLonCol: "lon", outDist: "nn_dist_km", outIdx: "nn_idx", metric: false, binCol: "" },
  sp_boundary_dist: { latCol: "lat", lonCol: "lon", polyDatasetId: "G1", wktCol: "wkt", outPrefix: "boundary" },
  sp_metric_buffer:   { mode: "point_buffers", latCol: "lat", lonCol: "lon", radius: 100 },
  sp_buffer_exposure: { mode: "count", bufferDatasetId: "G1", gridDatasetId: "G1", bufferWkt: "wkt", gridWkt: "wkt", gridIdCol: "grid_id", outPrefix: "buf" },
  sp_aggregate_grid:  { mode: "geometry", gridDatasetId: "G1", wktCol: "wkt", latCol: "lat", lonCol: "lon", fn: "count", valueCol: "", outCol: "n_points" },
  sp_areal_interp:    { srcDatasetId: "G1", tgtDatasetId: "G1", srcWkt: "wkt", tgtWkt: "wkt", tgtIdCol: "grid_id", valueCols: [], extensive: true, outPrefix: "aw" },
};

function wellFormed(out) {
  return out && Array.isArray(out.headers) && out.headers.every(h => typeof h === "string")
      && Array.isArray(out.rows) && out.rows.every(r => r && typeof r === "object");
}

// ─── T5 — REGISTRY ↔ RUNNER SYNC ──────────────────────────────────────────────
section("T5 · registry ↔ runner sync");
{
  const src = readFileSync(join(__dirname, "..", "runner.js"), "utf8");
  const runnerCases = new Set();
  for (const m of src.matchAll(/case\s+"([a-z0-9_]+)"\s*:/gi)) runnerCases.add(m[1]);

  const missingInRunner = STEP_TYPES.filter(t => !runnerCases.has(t));
  check(`every registry type (${STEP_TYPES.length}) has a runner case`,
    missingInRunner.length === 0, missingInRunner.join(", "));

  // Reverse direction (importability): every runner case that is a real
  // pipeline step must ALSO be a registered type. A step the runner executes —
  // and that the exporter writes into pipeline.json — must round-trip through
  // ImportPipelineButton, which rejects any step whose type ∉ STEP_TYPES.
  // (date_parse regressed exactly here: in the runner but absent from the
  // registry → exported pipelines were un-importable.) The exemption set holds
  // filter-predicate operator literals, which share the `case "x":` shape but
  // are nested-switch values, not top-level step types.
  const RUNNER_NON_STEP_CASES = new Set([
    "between", "contains", "empty", "ends", "equals",
    "gt", "lt", "not_equals", "notempty", "starts",
  ]);
  const registrySet = new Set(STEP_TYPES);
  const missingInRegistry = [...runnerCases].filter(
    t => !registrySet.has(t) && !RUNNER_NON_STEP_CASES.has(t));
  check("every runner step case is a registry type (importable)",
    missingInRegistry.length === 0, missingInRegistry.join(", "));

  // Registry must not contain dupes.
  const dupes = STEP_TYPES.filter((t, i) => STEP_TYPES.indexOf(t) !== i);
  check("no duplicate types in registry", dupes.length === 0, dupes.join(", "));

  // Every registry entry has the required hooks.
  const badEntries = STEP_REGISTRY.filter(e =>
    typeof e.type !== "string" || typeof e.toLabel !== "function" || typeof e.defaultStep !== "function");
  check("every registry entry has type/toLabel/defaultStep", badEntries.length === 0,
    badEntries.map(e => e.type).join(", "));

  // defaultStep().type must equal the registry type.
  const mismatch = STEP_REGISTRY.filter(e => { try { return defaultStep(e.type).type !== e.type; } catch { return true; } });
  check("defaultStep().type matches registry type", mismatch.length === 0,
    mismatch.map(e => e.type).join(", "));
}

// ─── T1 — PER-STEP SMOKE (all types) ──────────────────────────────────────────
section("T1 · per-step smoke (all registry types)");
{
  let smoked = 0, exempt = 0;
  for (const type of STEP_TYPES) {
    if (WORKER_OR_NET.has(type)) { exempt++; continue; }
    const cfg = SMOKE[type];
    if (!cfg) { check(`smoke ${type}`, false, "no SMOKE config — add one"); continue; }
    const step = { ...defaultStep(type), ...cfg, type };
    try {
      const input = SMOKE_INPUT[type] ?? { rows: FIX(), headers: HEADERS };
      const out = applyStep(input.rows, input.headers, step, CTX);
      check(`smoke ${type}`, wellFormed(out), "malformed output");
      smoked++;
    } catch (err) {
      check(`smoke ${type}`, false, err?.message ?? String(err));
    }
  }
  console.log(`  (smoked ${smoked} · worker/net-exempt ${exempt} · total ${STEP_TYPES.length})`);
}

// ─── T1 — GOLDEN CHECKS for the CLAUDE.md "key bugs" ──────────────────────────
section("T1 · golden checks (key-bug regressions)");
{
  // lag groups by entity before sorting → no cross-unit contamination.
  let o = runPipeline(FIX(), HEADERS, [{ ...defaultStep("lag"), ...SMOKE.lag }], CTX);
  const lagByRi = Object.fromEntries(o.rows.map(r => [r.__ri, r.wage_l1]));
  check("lag: first period per entity is null (no cross-unit bleed)",
    lagByRi[0] === null && lagByRi[2] === null, JSON.stringify(lagByRi));
  check("lag: second period = own prior value",
    lagByRi[1] === 1000 && lagByRi[3] === 2000, JSON.stringify(lagByRi));

  // diff: same entity-grouping guarantee.
  o = runPipeline(FIX(), HEADERS, [{ ...defaultStep("diff"), ...SMOKE.diff }], CTX);
  const dByRi = Object.fromEntries(o.rows.map(r => [r.__ri, r.dwage]));
  check("diff: first period per entity is null",
    dByRi[0] === null && dByRi[2] === null, JSON.stringify(dByRi));
  check("diff: Δ = own period-over-period change",
    dByRi[1] === 500 && dByRi[3] === 500, JSON.stringify(dByRi));

  // winz: bounds fixed at step-creation time (lo/hi in the step), not recomputed.
  o = runPipeline(FIX(), HEADERS, [{ ...defaultStep("winz"), ...SMOKE.winz }], CTX);
  const w = o.rows.map(r => r.wage_w).sort((a, b) => a - b);
  check("winz: clips to the step's lo/hi (1100..2400)",
    Math.min(...w) === 1100 && Math.max(...w) === 2400, JSON.stringify(w));

  // group_summarize: a malformed agg with a missing nn must not create an
  // "undefined"-keyed column (defensive fallback mirroring group_transform).
  o = runPipeline(FIX(), HEADERS, [{ type: "group_summarize", by: ["region"], aggs: [{ col: "wage", fn: "mean" }] }], CTX);
  check("group_summarize: missing nn falls back to a named column (no 'undefined')",
    o.headers.every(h => typeof h === "string" && h !== "undefined") && o.headers.includes("mean_wage"),
    JSON.stringify(o.headers));

  // normalize_cats: numeric variants must never be merged — but here we test
  // that an EXPLICIT map merges only what it's told (arg/ARG → Argentina, bra stays).
  o = runPipeline(FIX(), HEADERS, [{ ...defaultStep("normalize_cats"), ...SMOKE.normalize_cats }], CTX);
  const cats = o.rows.map(r => r.cat);
  check("normalize_cats: maps only mapped variants, leaves others",
    cats[0] === "Argentina" && cats[1] === "Argentina" && cats[2] === "Argentina" && cats[3] === "bra",
    JSON.stringify(cats));
}

// ─── T4 — NON-DESTRUCTIVE GUARANTEE ───────────────────────────────────────────
section("T4 · non-destructive (deep-frozen rawData survives replay)");
{
  const raw = FIX();
  raw.forEach(Object.freeze);
  Object.freeze(raw);
  const headersFrozen = Object.freeze([...HEADERS]);
  const snapshot = JSON.stringify(raw);

  const pipeline = [
    { ...defaultStep("log"), ...SMOKE.log },
    { ...defaultStep("std"), ...SMOKE.std },
    { ...defaultStep("lag"), ...SMOKE.lag },
    { ...defaultStep("filter"), ...SMOKE.filter },
    { ...defaultStep("arrange"), ...SMOKE.arrange },
  ];

  let threw = null;
  try { runPipeline(raw, headersFrozen, pipeline, CTX); }
  catch (e) { threw = e?.message ?? String(e); }

  check("replay over frozen rawData does not throw", threw === null, threw);
  check("rawData unchanged after replay (deep-equal to snapshot)",
    JSON.stringify(raw) === snapshot);
}

// ─── T2/T3 — COMPOSABILITY + SERIALIZATION ROUND-TRIP ─────────────────────────
section("T2/T3 · composability + serialization determinism");
{
  const pipeline = [
    { ...defaultStep("log"), ...SMOKE.log },
    { ...defaultStep("sq"), ...SMOKE.sq },
    { ...defaultStep("ix"), ...SMOKE.ix },
    { ...defaultStep("lag"), ...SMOKE.lag },
    { ...defaultStep("group_transform"), ...SMOKE.group_transform },
    { ...defaultStep("arrange"), ...SMOKE.arrange },
  ];
  const hash = (o) => JSON.stringify({ h: o.headers, r: o.rows });

  const a = runPipeline(FIX(), HEADERS, pipeline, CTX);
  const b = runPipeline(FIX(), HEADERS, pipeline, CTX);
  check("same input + same pipeline → identical output (determinism)", hash(a) === hash(b));

  // Serialize → parse → re-run (IDB-replay equivalent).
  const roundTripped = JSON.parse(JSON.stringify(pipeline));
  const c = runPipeline(FIX(), HEADERS, roundTripped, CTX);
  check("serialized pipeline replays to identical output", hash(a) === hash(c));

  // Order sensitivity: a reorder that matters must change the output (guards
  // against the runner silently ignoring step order). filter-before vs
  // filter-after a row-dropping step.
  const p1 = [{ ...defaultStep("filter"), col: "wage", op: "gt", value: "1200" },
              { ...defaultStep("group_summarize"), ...SMOKE.group_summarize }];
  const p2 = [{ ...defaultStep("group_summarize"), ...SMOKE.group_summarize },
              { ...defaultStep("filter"), col: "wage_mean", op: "gt", value: "1200" }];
  const r1 = runPipeline(FIX(), HEADERS, p1, CTX);
  const r2 = runPipeline(FIX(), HEADERS, p2, CTX);
  check("step order affects output (runner respects ordering)", hash(r1) !== hash(r2));
}

// ─── T6 — AUDIT TRAIL COMPLETENESS ────────────────────────────────────────────
section("T6 · audit trail completeness");
{
  const pipeline = [
    { ...defaultStep("log"), ...SMOKE.log },
    { ...defaultStep("filter"), ...SMOKE.filter },
    { ...defaultStep("dummy"), ...SMOKE.dummy },
    { ...defaultStep("arrange"), ...SMOKE.arrange },
  ];
  const trail = auditPipeline(FIX(), HEADERS, pipeline, CTX);
  const entries = trail.entries ?? trail;
  check("one audit entry per step", Array.isArray(entries) && entries.length === pipeline.length,
    `got ${entries?.length}`);
  check("entries carry type + index in execution order",
    entries.every((e, i) => e.index === i && e.type === pipeline[i].type));
  check("entries report row deltas",
    entries.every(e => typeof e.rowsBefore === "number" && typeof e.rowsAfter === "number"));
  check("no audit entry errored on valid steps",
    entries.every(e => e.status !== "error"), entries.filter(e => e.status === "error").map(e => e.type).join(", "));
}

// ─── SUMMARY ──────────────────────────────────────────────────────────────────
console.log(`\npipelineReliability: ${pass} passed, ${fail} failed`);
if (fail > 0) process.exit(1);
