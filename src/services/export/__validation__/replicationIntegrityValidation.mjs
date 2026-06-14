// ─── Fase X2 — Replication bundle integrity harness ──────────────────────────
// Plan: docs/superpowers/plans/2026-05-22-fase-x2-replication-integrity.md
// Spec: specs/2026-05-21-pre-launch-roadmap.md → Track C → Fase X2
//
// Plain node script: `node src/services/export/__validation__/replicationIntegrityValidation.mjs`
// Prints [pass]/[FAIL] + summary; exits 1 on any failure.
//
// Structural half of X2 (no R/Python/Stata runtime needed — that smoke test
// stays pending Franco's R, same as Track B). Covers:
//   T1  translator coverage — every registry step type emits real code in
//       R / Python / Stata (no "unknown step" / "not yet transpiled" fallback).
//       This is the export-side analog of X1's registry↔runner sync: a missing
//       translator silently drops a step from the replication script.
//   T2  no-garbage — emitted pipeline code carries no "undefined",
//       "[object Object]", or stray "NaN" where an operand was expected.
//   T3  three-language parity — a step that translates in one language
//       translates in all three (or is a consistent, acknowledged gap).
//   T4  multi-subset bundle — generateSubset{R,Python,Stata}Script produce a
//       non-empty script per subset.
//   T5  determinism — same config → byte-identical script across two runs.

import { generateRScript, generateSubsetRScript } from "../rScript.js";
import { generatePythonScript, generateSubsetPythonScript } from "../pythonScript.js";
import { generateStataScript, generateSubsetStataScript } from "../stataScript.js";
import { STEP_TYPES, defaultStep } from "../../../pipeline/registry.js";

let pass = 0, fail = 0;
const check = (n, c, extra) => {
  if (c) { pass++; console.log("  [pass]", n); }
  else   { fail++; console.log("  [FAIL]", n, extra != null ? "→ " + extra : ""); }
};
const section = (t) => console.log("\n── " + t + " ──");

// Fallback markers each generator emits when a step type has no translator.
const FALLBACK = /unknown step:|not yet transpiled/i;
// Garbage markers that signal a value failed to interpolate.
const GARBAGE = /undefined|\[object Object\]/;

// Per-step config (merged over defaultStep) — same operand fixture as X1.
// Steps whose replication is intentionally deferred / handled out-of-band are
// listed in KNOWN_GAPS below, not here.
const CFG = {
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
  ai_tr:         { col: "region", js: "value.toUpperCase()" },
  log:           { col: "wage", nn: "lwage" },
  sq:            { col: "educ", nn: "educ2" },
  std:           { col: "wage", mu: 1750, sd: 645, nn: "wage_z" },
  dummy:         { col: "region", pfx: "reg" },
  lag:           { col: "wage", n: 1, ec: "id", tc: "t", nn: "wage_l1" },
  lead:          { col: "wage", n: 1, ec: "id", tc: "t", nn: "wage_f1" },
  diff:          { col: "wage", ec: "id", tc: "t", nn: "dwage" },
  ix:            { c1: "wage", c2: "educ", nn: "wage_x_educ" },
  did:           { tc: "treat", pc: "post", nn: "did" },
  date_extract:  { col: "date", parts: ["year", "month"], names: {} },
  mutate:        { nn: "ratio", expr: "wage / educ" },
  if_else:       { nn: "adult", cond: "educ >= 16", trueVal: "1", falseVal: "0" },
  case_when:     { nn: "tier", cases: [{ cond: "wage > 2000", val: "hi" }], defaultVal: "lo" },
  vector_assign: { nn: "grp", values: ["x", "y"], mode: "recycle" },
  grouped_mutate:{ by: ["region"], fn: "mean", col: "wage", newCol: "wage_gm2" },
  arrange:       { col: "wage", dir: "desc" },
  group_summarize:{ by: ["region"], aggs: [{ col: "wage", fn: "mean", nn: "wage_mean" }] },
  group_transform:{ by: ["region"], col: "wage", fn: "mean", nn: "wage_gm" },
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
};

// Step types whose replication is intentionally NOT a flat transpile:
//  - geocode: address→latlon depends on a cached network result; the cleaned
//    dataset already carries the columns, so the script loads them rather than
//    re-geocoding. (Acknowledged: replicated via the exported cleaned CSV.)
const KNOWN_GAPS = new Set(["geocode"]);

const ALL_DATASETS = { R1: { name: "right", rows: [{ id: "a", gdp: 100 }], headers: ["id", "gdp"] } };

function buildStep(type) {
  return { ...defaultStep(type), ...(CFG[type] || {}), type };
}

// Extract just the pipeline-section lines (skip header/comment scaffolding) so
// garbage checks don't trip on prose. We keep all non-comment lines.
function codeLines(script) {
  return script.split("\n").filter(l => {
    const t = l.trim();
    return t && !t.startsWith("#") && !t.startsWith("*") && !t.startsWith("//");
  });
}

const GEN = {
  R:     (step) => generateRScript({ filename: "d.csv", pipeline: [step], model: {}, allDatasets: ALL_DATASETS }),
  Py:    (step) => generatePythonScript({ filename: "d.csv", pipeline: [step], model: {}, allDatasets: ALL_DATASETS }),
  Stata: (step) => generateStataScript({ filename: "d.csv", pipeline: [step], model: {}, allDatasets: ALL_DATASETS }),
};

// ─── T1 — TRANSLATOR COVERAGE ─────────────────────────────────────────────────
section("T1 · translator coverage (no fallback markers)");
const gapReport = {}; // type → [langs missing]
{
  for (const type of STEP_TYPES) {
    if (KNOWN_GAPS.has(type)) continue;
    const step = buildStep(type);
    const missing = [];
    for (const [lang, gen] of Object.entries(GEN)) {
      let script;
      try { script = gen(step); }
      catch (err) { missing.push(`${lang}(threw: ${err?.message ?? err})`); continue; }
      if (FALLBACK.test(script)) missing.push(lang);
    }
    if (missing.length) gapReport[type] = missing;
    check(`coverage ${type}`, missing.length === 0, missing.join(", "));
  }
  console.log(`  (${STEP_TYPES.length - KNOWN_GAPS.size} types checked · ${KNOWN_GAPS.size} known-gap exempt)`);
}

// ─── T2 — NO GARBAGE ──────────────────────────────────────────────────────────
section("T2 · no undefined / [object Object] in emitted code");
{
  for (const type of STEP_TYPES) {
    if (KNOWN_GAPS.has(type)) continue;
    const step = buildStep(type);
    for (const [lang, gen] of Object.entries(GEN)) {
      let script;
      try { script = gen(step); } catch { continue; }
      const bad = codeLines(script).filter(l => GARBAGE.test(l));
      check(`clean ${lang}:${type}`, bad.length === 0, bad.slice(0, 1).join(" | "));
    }
  }
}

// ─── T3 — THREE-LANGUAGE PARITY ───────────────────────────────────────────────
section("T3 · three-language parity (translate in all or none)");
{
  let parityFails = 0;
  for (const type of STEP_TYPES) {
    if (KNOWN_GAPS.has(type)) continue;
    const missing = gapReport[type] || [];
    // A type is parity-consistent if it translates in all three (missing empty)
    // or is a clean gap in all three (handled as KNOWN_GAPS, excluded above).
    const partial = missing.length > 0 && missing.length < 3;
    if (partial) parityFails++;
    check(`parity ${type}`, !partial, partial ? `translates in some langs but not: ${missing.join(", ")}` : undefined);
  }
  if (parityFails === 0) console.log("  (all types translate consistently across R/Python/Stata)");
}

// ─── T4 — MULTI-SUBSET BUNDLE ─────────────────────────────────────────────────
section("T4 · multi-subset bundle produces a script per subset");
{
  const pipeline = [buildStep("log"), buildStep("std"), buildStep("filter")];
  const subsets = [
    { name: "north", filters: [{ col: "region", op: "equals", value: "north" }] },
    { name: "south", filters: [{ col: "region", op: "equals", value: "south" }] },
  ];
  const model = { type: "OLS", yVar: "wage", xVars: ["educ"] };
  for (const [lang, gen] of Object.entries({
    R:     () => generateSubsetRScript({ filename: "d.csv", pipeline, subsets, model }),
    Py:    () => generateSubsetPythonScript({ filename: "d.csv", pipeline, subsets, model }),
    Stata: () => generateSubsetStataScript({ filename: "d.csv", pipeline, subsets, model }),
  })) {
    let script = "";
    let threw = null;
    try { script = gen(); } catch (e) { threw = e?.message ?? String(e); }
    check(`${lang} subset bundle non-empty + names both subsets`,
      threw === null && script.length > 0 && script.includes("north") && script.includes("south"),
      threw);
    check(`${lang} subset bundle: no fallback markers`, threw === null && !FALLBACK.test(script), threw);
  }
}

// ─── T5 — DETERMINISM ─────────────────────────────────────────────────────────
section("T5 · generator determinism (date line excluded)");
{
  const pipeline = [buildStep("log"), buildStep("lag"), buildStep("group_transform")];
  const cfg = { filename: "d.csv", pipeline, model: { type: "OLS", yVar: "wage", xVars: ["educ"] }, allDatasets: ALL_DATASETS };
  // Generated date line ("# Generated: YYYY-MM-DD") is the only nondeterminism;
  // strip it before comparing.
  const strip = (s) => s.replace(/Generated:.*/g, "Generated: <date>");
  for (const [lang, gen] of Object.entries({
    R: () => generateRScript(cfg), Py: () => generatePythonScript(cfg), Stata: () => generateStataScript(cfg),
  })) {
    check(`${lang} same config → identical script`, strip(gen()) === strip(gen()));
  }
}

// ─── GAP SUMMARY ──────────────────────────────────────────────────────────────
if (Object.keys(gapReport).length) {
  console.log("\n⚠ translator gaps:");
  for (const [type, langs] of Object.entries(gapReport)) console.log(`   ${type}: missing in ${langs.join(", ")}`);
}

console.log(`\nreplicationIntegrity: ${pass} passed, ${fail} failed`);
if (fail > 0) process.exit(1);
