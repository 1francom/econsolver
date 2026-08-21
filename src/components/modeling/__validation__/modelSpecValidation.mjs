// ─── modelSpec harness ───────────────────────────────────────────────────────
// Plain node script (no test runner):
//   node src/components/modeling/__validation__/modelSpecValidation.mjs
// Prints [pass]/[FAIL] per check + a summary; exits 1 if anything fails.

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

import { MODEL_SPEC_FIELDS, SE_TYPES, collectSpec, applySpec, specFormula } from "../modelSpec.js";
import { buildModelAvail } from "../helpers.js";

const HERE = dirname(fileURLToPath(import.meta.url));
const MODELING_TAB = resolve(HERE, "../../ModelingTab.jsx");

let pass = 0, fail = 0;
const check = (n, c, extra) => {
  if (c) { pass++; console.log("  [pass]", n); }
  else   { fail++; console.log("  [FAIL]", n, extra != null ? "→ " + extra : ""); }
};
const section = (t) => console.log("\n── " + t + " ──");

// Estimator id vocabulary for the `model` enum check — pure JS, importable
// from node (helpers.js has no React import). true/true = both panel modes
// available, so every estimator id is present.
const MODEL_IDS = Object.keys(buildModelAvail(true, true));

// ── Explicit key-set snapshot (review item 9b) ────────────────────────────────
// Forces a deliberate harness edit whenever a field is added to or removed
// from MODEL_SPEC_FIELDS — a silent deletion (or addition) no longer just
// shows up as "N passed" with a different N.
const EXPECTED_KEYS = [
  "bwManual","bwMode","clusterVar","clusterVar2","cohortCol","csAnticipation",
  "csBasePeriod","csCompGroup","csDefaultView","csEntityCol","csEstMethod",
  "csInfMethod","csNBoot","csRelMax","csRelMin","csSeed","csTimeCol","csTreatCol",
  "csXCols","cutoff","entityCol","factorRefs","factorVars","family","feCols",
  "interactionTerms","kPost","kPre","kernel","maxLag","model","noIntercept",
  "periodCol","poissonEntityCol","poissonExtraFE","poissonOffsetCol","polyOrder",
  "postVar","runningVar","saControlMode","saRefPeriod","saUnitCol","seType",
  "spatialGeomCol","spatialModel","spatialWeightsD","spatialWeightsDatasetId",
  "spatialWeightsICol","spatialWeightsJCol","spatialWeightsK","spatialWeightsMode",
  "spatialWeightsStyle","spatialWeightsType","spatialWeightsWCol","synthTreatTime",
  "timeCol","timeVar","treatTimeCol","treatVar","treatedUnit","wVarsRaw","weightVar",
  "xVarsRaw","yVar","zVars",
];

section("field-table shape (review item 9)");
{
  const actualKeys = MODEL_SPEC_FIELDS.map(f => f.key).sort();
  check("MODEL_SPEC_FIELDS key set matches the pinned snapshot exactly",
    JSON.stringify(actualKeys) === JSON.stringify(EXPECTED_KEYS),
    `${actualKeys.length} keys, diff: ${JSON.stringify(actualKeys.filter(k => !EXPECTED_KEYS.includes(k)))} added / ${JSON.stringify(EXPECTED_KEYS.filter(k => !actualKeys.includes(k)))} removed`);
  check("every field declares an explicit role",
    MODEL_SPEC_FIELDS.every(f => typeof f.role === "string" && f.role.length > 0),
    MODEL_SPEC_FIELDS.filter(f => !f.role).map(f => f.key).join(", "));
}

// ── review item 5: static `def`s must stay synced with ModelingTab.jsx's real
// useState initializers. Same technique as
// src/services/export/__validation__/plotTileFacetValidation.mjs (reads
// PlotBuilder.jsx as text to keep TILE_SCHEMES in sync with plotScript.js) —
// ModelingTab.jsx is a .jsx file the node harness cannot import, so this
// reads it as TEXT and parses each `const [x, setX] = useState(<literal>);`
// initializer. Every value in the ~444-608 spec-state block is a JSON-legal
// literal (`[]`, `""`, `"OLS"`, `false`, `3`, `-1`, `null`, …), so JSON.parse
// on the captured group is exact, not an approximation.
section("static defs are synced with ModelingTab.jsx's real useState initializers (review item 5)");
{
  const src = readFileSync(MODELING_TAB, "utf8");
  const re = /const \[(\w+),\s*set\w+\s*\]\s*=\s*useState\(([^)]*)\);/g;
  const parsed = {};
  let m;
  while ((m = re.exec(src))) {
    const [, name, rawVal] = m;
    try { parsed[name] = JSON.parse(rawVal.trim()); }
    catch { /* non-literal initializer (factorVars' computed Set, activeTab's tabOrder[0], …) — skip */ }
  }
  check("parser actually found ModelingTab.jsx's useState block (sanity — not a silently-empty regex)",
    Object.keys(parsed).length > 20, Object.keys(parsed).length);

  // Fields whose `def` is intentionally a FUNCTION of ctx (a dataset-dependent
  // default with no fixed literal to compare against) are exempt from this
  // literal-vs-literal check — listed explicitly so the exemption is a
  // deliberate decision, not something that silently stops being checked.
  const FUNCTION_DEF_EXEMPT = new Set(["factorVars"]);

  let checkedCount = 0;
  for (const f of MODEL_SPEC_FIELDS) {
    if (f.kind === "panelRef") continue;   // no setter, no useState to compare against
    const stateName = f.stateKey ?? f.key;
    if (FUNCTION_DEF_EXEMPT.has(f.key)) {
      check(`${f.key}: def is a function (exempt from literal sync check)`, typeof f.def === "function");
      continue;
    }
    if (!(stateName in parsed)) {
      check(`${f.key}: found "${stateName}"'s useState default in ModelingTab.jsx`, false, "parser did not find it — literal initializer, or field renamed?");
      continue;
    }
    checkedCount++;
    const real = parsed[stateName];
    // `def` is stored in unwrapped/bare SPEC shape; wrapped fields' real
    // ModelingTab default is always `[]`, whose bare-spec equivalent is `null`
    // (mirrors modelSpec.js's own `unwrap()`).
    const expected = f.wrapped ? (Array.isArray(real) ? (real[0] ?? null) : (real ?? null)) : real;
    check(`${f.key}: table def matches ModelingTab.jsx's real useState default`,
      JSON.stringify(f.def) === JSON.stringify(expected),
      `table def ${JSON.stringify(f.def)} vs ModelingTab.jsx's ${JSON.stringify(real)} (state var "${stateName}")`);
  }
  const expectedCheckedCount = MODEL_SPEC_FIELDS.filter(f => f.kind !== "panelRef" && !FUNCTION_DEF_EXEMPT.has(f.key)).length;
  check("every non-exempt, non-panelRef field was actually compared (not silently 0)",
    checkedCount === expectedCheckedCount, `${checkedCount} of ${expectedCheckedCount}`);
}

// ── SPEC_SETTERS completeness (Task 3) ───────────────────────────────────────
// applySpec writes a field only if `setters[f.setter]` exists — a field whose
// setter is absent from ModelingTab.jsx's SPEC_SETTERS table silently stops
// restoring, with no error anywhere. Same text-parsing technique as the def
// sync check above (and plotTileFacetValidation.mjs): read ModelingTab.jsx as
// TEXT, extract the keys of the `const SPEC_SETTERS = useMemo(() => ({ … }))`
// object literal, and assert every non-null `setter` in MODEL_SPEC_FIELDS is
// among them.
section("SPEC_SETTERS in ModelingTab.jsx covers every field's setter (Task 3)");
{
  const src = readFileSync(MODELING_TAB, "utf8");
  const start = src.indexOf("const SPEC_SETTERS");
  const open  = start >= 0 ? src.indexOf("({", start) : -1;
  const close = open  >= 0 ? src.indexOf("}), [", open) : -1;
  check("found the SPEC_SETTERS object literal in ModelingTab.jsx (sanity — not a silently-empty parse)",
    start >= 0 && open >= 0 && close > open, `start=${start} open=${open} close=${close}`);

  const body = close > open ? src.slice(open + 2, close) : "";
  // Keys are either shorthand (`setModel,`) or `key: <expr>` (setFactorVars
  // is wrapped to re-Set the array). Both start a line-ish token before a
  // `,` or `:`; capture identifiers in key position only.
  const keys = new Set();
  for (const m of body.matchAll(/(?:^|[,{]\s*)\s*(set[A-Za-z0-9_]*)\s*(?=[,:}])/g)) keys.add(m[1]);
  check("parsed a plausible number of SPEC_SETTERS keys", keys.size > 40, keys.size);

  const needed = MODEL_SPEC_FIELDS.filter(f => f.setter).map(f => f.setter);
  const missing = needed.filter(s => !keys.has(s));
  check("every non-null MODEL_SPEC_FIELDS setter is a key of SPEC_SETTERS",
    missing.length === 0, `missing: ${missing.join(", ")}`);

  // The reverse direction: an entry in SPEC_SETTERS naming no declared field
  // is dead weight (or a typo'd rename that left the real one uncovered).
  const extra = [...keys].filter(k => !needed.includes(k));
  check("SPEC_SETTERS has no key that no field declares",
    extra.length === 0, `extra: ${extra.join(", ")}`);
}

// A full sidebar state, one fixture per estimator group. Values are chosen to
// be REAL headers from ALL_COLS below so the "nothing unapplied" round-trip
// check is meaningful, not vacuous.
const STATE = {
  OLS:     { model: "OLS", family: "linear", yVar: ["wage"], xVars: ["educ", "exper"], wVars: [],
             noIntercept: true, seType: "hc1", clusterVar: null, clusterVar2: null,
             factorVars: ["year"], factorRefs: { year: "2010" },
             interactionTerms: [{ var1: "educ", var2: "exper", type: "*" }] },
  Panel:   { model: "FE", family: "linear", yVar: ["wage"], xVars: ["educ"],
             selectedFeCols: ["firm", "year"], entityCol: "firm", timeCol: "year",
             seType: "clustered", clusterVar: "firm" },
  DiD:     { model: "TWFE", family: "linear", yVar: ["y"], xVars: [], treatVar: ["treat"], postVar: ["post"] },
  IV:      { model: "2SLS", family: "linear", yVar: ["wage"], xVars: ["educ"], zVars: ["dist"] },
  RD:      { model: "RDD", family: "linear", yVar: ["y"], runningVar: ["score"], cutoff: "50",
             bwMode: "manual", bwManual: "12.5", kernel: "uniform", polyOrder: 2 },
  SC:      { model: "SyntheticControl", family: "linear", yVar: ["gdp"], xVars: ["inv"],
             treatedUnit: "Basque", synthTreatTime: "1975", treatTimeCol: ["year"], kPre: 5, kPost: 4 },
  Spatial: { model: "SpatialRegression", family: "linear", yVar: ["price"], xVars: ["rooms"],
             spatialModel: "SDM", spatialWeightsMode: "dataset", spatialGeomCol: "geometry",
             spatialWeightsDatasetId: "ds_7", spatialWeightsType: "knn", spatialWeightsStyle: "W",
             spatialWeightsK: 6, spatialWeightsD: 500,
             spatialWeightsICol: "i", spatialWeightsJCol: "j", spatialWeightsWCol: "w" },
  // Covers every field the seven groups above never touch (review item 9c) —
  // weightVar, both Poisson-FE fields, both Sun-Abraham period columns, the
  // whole 14-field Callaway-Sant'Anna block, and the two HAC fields
  // (timeVar/maxLag) added in this pass. Values reuse ALL_COLS headers.
  Extras:  { model: "PoissonFE", family: "poisson", yVar: ["y"], xVars: ["treat"],
             weightVar: ["wage"],
             poissonEntityCol: "firm", poissonOffsetCol: "exper", poissonExtraFE: ["year"],
             cohortCol: ["year"], periodCol: ["firm"], saUnitCol: "firm",
             saControlMode: "never", saRefPeriod: -2,
             csTreatCol: ["year"], csEntityCol: ["firm"], csTimeCol: ["year"],
             csXCols: ["educ"], csCompGroup: "notyettreated", csRelMin: "-3", csRelMax: "3",
             csEstMethod: "ipw", csBasePeriod: "universal", csAnticipation: "1",
             csInfMethod: "analytical", csNBoot: "499", csSeed: "7", csDefaultView: "dynamic",
             timeVar: "year", maxLag: "4" },
};

// Captures every setter applySpec calls, so a round-trip can be asserted
// without React.
function makeSetters(into) {
  const setters = {};
  for (const f of MODEL_SPEC_FIELDS) {
    if (!f.setter) continue;                     // panelRef fields have none
    setters[f.setter] = (v) => { into[f.stateKey ?? f.key] = typeof v === "function" ? v(into[f.stateKey ?? f.key]) : v; };
  }
  return setters;
}

const ALL_COLS = ["wage", "educ", "exper", "year", "firm", "y", "treat", "post", "dist",
                  "score", "gdp", "inv", "price", "rooms", "geometry"];

section("round-trip per estimator group");
for (const [group, state] of Object.entries(STATE)) {
  // (review item 9a) Every fixture key must map to a real field — a field
  // deleted from the table now fails loudly here instead of just producing
  // fewer checks overall.
  for (const k of Object.keys(state)) {
    const f = MODEL_SPEC_FIELDS.find(f => (f.stateKey ?? f.key) === k);
    check(`${group}: state key "${k}" has a table entry`, !!f, `no MODEL_SPEC_FIELDS entry maps to "${k}"`);
  }

  const spec = collectSpec(state);
  check(`${group}: spec is JSON-serialisable`,
    JSON.stringify(spec) === JSON.stringify(JSON.parse(JSON.stringify(spec))));
  const out = {};
  // panelRef fields are COMPARED against the dataset's declared panel, so the
  // round-trip ctx must state the panel this fixture was estimated on —
  // otherwise the Panel group reports a mismatch against a null panel.
  const { unapplied } = applySpec(spec, makeSetters(out), {
    headers: ALL_COLS,
    datasetIds: ["ds_7"],
    modelIds: MODEL_IDS,
    panel: { entityCol: state.entityCol ?? null, timeCol: state.timeCol ?? null },
  });
  check(`${group}: nothing reported unapplied`, unapplied.length === 0,
    unapplied.map(m => m.key).join(", "));
  for (const f of MODEL_SPEC_FIELDS) {
    if (f.kind === "panelRef") continue;              // recorded, never applied
    const k = f.stateKey ?? f.key;
    if (!(k in state)) continue;
    check(`${group}: ${k} round-trips`,
      JSON.stringify(out[k]) === JSON.stringify(state[k]),
      `${JSON.stringify(state[k])} → ${JSON.stringify(out[k])}`);
  }
}

section("functions never serialise");
{
  const spec = collectSpec({ ...STATE.Spatial, resolveSpatialWeights: () => 1 });
  check("no function-valued key survives",
    Object.values(spec).every(v => typeof v !== "function"));
  check("undeclared key is dropped",
    !("resolveSpatialWeights" in spec));
}

section("missing columns are reported by role, rest applied");
{
  const spec = collectSpec(STATE.OLS);
  const out = {};
  const { unapplied } = applySpec(spec, makeSetters(out), { headers: ["wage", "exper"], datasetIds: [] });
  const keys = unapplied.map(m => m.key).sort();
  check("yVar kept (present)", out.yVar[0] === "wage");
  check("xVars dropped educ, kept exper", JSON.stringify(out.xVars) === JSON.stringify(["exper"]));
  check("factorVars reported", keys.includes("factorVars"), keys.join(", "));
  check("unapplied entries carry the offending value",
    unapplied.every(m => "value" in m && "key" in m));
}

section("termList validated as a unit");
{
  const spec = collectSpec(STATE.OLS);
  const out = {};
  applySpec(spec, makeSetters(out), { headers: ["wage", "educ"], datasetIds: [] });  // exper absent
  check("half-term dropped entirely", JSON.stringify(out.interactionTerms) === "[]",
    JSON.stringify(out.interactionTerms));
}

section("panelRef compared, never applied");
{
  const spec = collectSpec(STATE.Panel);
  const out = {};
  const { unapplied } = applySpec(spec, makeSetters(out),
    { headers: ALL_COLS, datasetIds: [], panel: { entityCol: "id", timeCol: "t" } });
  check("entityCol not written to state", !("entityCol" in out));
  check("panel mismatch reported",
    unapplied.some(m => m.key === "entityCol" && m.reason === "panel-mismatch"),
    JSON.stringify(unapplied));
}

section("datasetRef checked against session dataset ids");
{
  const spec = collectSpec(STATE.Spatial);
  const out = {};
  const { unapplied } = applySpec(spec, makeSetters(out), { headers: ALL_COLS, datasetIds: ["other"] });
  check("unresolvable datasetRef reported",
    unapplied.some(m => m.key === "spatialWeightsDatasetId"));
  check("unresolvable datasetRef cleared, not left dangling", !out.spatialWeightsDatasetId);
}

// ── review item 1: feCols must tolerate synthetic "a×b" interaction labels ───
section("feCols allows synthetic interaction labels, still rejects real garbage");
{
  const spec = { model: "TWFE", feCols: ["state", "state×year", "bogus×year", "totallyfake"] };
  const out = {};
  const { unapplied } = applySpec(spec, makeSetters(out), { headers: ["state", "year", "firm"], datasetIds: [] });
  check("real column kept", out.selectedFeCols.includes("state"));
  check("synthetic label with both real parts kept", out.selectedFeCols.includes("state×year"));
  check("synthetic label with one fake part rejected", !out.selectedFeCols.includes("bogus×year"));
  check("plain fake column rejected", !out.selectedFeCols.includes("totallyfake"));
  check("both rejects reported",
    unapplied.some(m => m.key === "feCols" && String(m.value).includes("bogus×year")) &&
    unapplied.some(m => m.key === "feCols" && String(m.value).includes("totallyfake")),
    JSON.stringify(unapplied));
}
{
  // A non-interaction estimator's feCols must still round-trip plain columns
  // with allowSynthetic on (it doesn't force every value to look synthetic).
  const spec = { feCols: ["firm", "year"] };
  const out = {};
  const { unapplied } = applySpec(spec, makeSetters(out), { headers: ALL_COLS, datasetIds: [] });
  check("plain feCols still round-trips with allowSynthetic on",
    JSON.stringify(out.selectedFeCols) === JSON.stringify(["firm", "year"]));
  check("nothing unapplied", unapplied.length === 0, JSON.stringify(unapplied));
}

// ── review item 2: applySpec REPLACES, it does not merge ─────────────────────
section("applySpec is a full replace, not a merge");
{
  const specA = collectSpec({ model: "RDD", seType: "hc3", bwMode: "manual", bwManual: "9", clusterVar: "firm" });
  const out = {};
  applySpec(specA, makeSetters(out), { headers: ALL_COLS, datasetIds: [], modelIds: MODEL_IDS });
  check("spec A applied (sanity)", out.seType === "hc3" && out.bwMode === "manual" && out.bwManual === "9" && out.clusterVar === "firm");

  // Legacy/partial spec — the exact scenario estimationDispatch.js produces
  // for several estimators: only a handful of keys present.
  const specB = { model: "OLS", yVar: "wage", xVarsRaw: ["educ"] };
  applySpec(specB, makeSetters(out), { headers: ALL_COLS, datasetIds: [], modelIds: MODEL_IDS });
  check("seType reset to default, not left at spec A's hc3", out.seType === "classical", out.seType);
  check("bwMode reset to default", out.bwMode === "ik", out.bwMode);
  check("bwManual reset to default", out.bwManual === "", JSON.stringify(out.bwManual));
  check("clusterVar reset to default (null), not left at firm", out.clusterVar === null, out.clusterVar);
  check("model B's own fields still applied", out.model === "OLS" && out.xVars[0] === "educ");
}
{
  // selectedFeCols default is `null` ("use estimator default"), not `[]` — a
  // spec that never mentions feCols must reset it to null, not to [].
  const out = { selectedFeCols: ["stale", "value"] };
  applySpec({ model: "OLS" }, makeSetters(out), { headers: ALL_COLS, datasetIds: [], modelIds: MODEL_IDS });
  check("feCols resets to null (its real default), not []", out.selectedFeCols === null, out.selectedFeCols);
}
{
  // Explicit null must be preserved through a full round-trip, distinct from [].
  const spec = collectSpec({ selectedFeCols: null });
  check("collectSpec serialises explicit null for feCols, not dropping the key",
    "feCols" in spec && spec.feCols === null, JSON.stringify(spec));
  const out = { selectedFeCols: ["stale"] };
  applySpec(spec, makeSetters(out), { headers: ALL_COLS, datasetIds: [] });
  check("applySpec writes that null back, not []", out.selectedFeCols === null, out.selectedFeCols);
}

// ── review item 3: HAC's timeVar / maxLag are first-class spec fields ────────
section("HAC timeVar and maxLag round-trip");
{
  const state = { model: "OLS", seType: "hac", timeVar: "year", maxLag: "8" };
  const spec = collectSpec(state);
  const out = {};
  const { unapplied } = applySpec(spec, makeSetters(out), { headers: ALL_COLS, datasetIds: [], modelIds: MODEL_IDS });
  check("timeVar round-trips", out.timeVar === "year", out.timeVar);
  check("maxLag round-trips", out.maxLag === "8", out.maxLag);
  check("nothing unapplied", unapplied.length === 0, JSON.stringify(unapplied));
}

// ── review item 4: malformed input must never throw ───────────────────────────
section("applySpec never throws on malformed input");
{
  const cases = [
    { xVars: "educ" },                                   // string where an array was expected
    { interactionTerms: [null] },                         // null term
    { interactionTerms: "not-an-array" },
    { factorRefs: ["not", "a", "map"] },                  // array where an object was expected
    { factorRefs: { year: { evil: 1 } } },                // non-primitive level
    { feCols: "state" },                                  // string where an array was expected
    { model: { nested: true } },
    { seType: 42 },
  ];
  for (const spec of cases) {
    let threw = false;
    let out = {};
    try { applySpec(spec, makeSetters(out), { headers: ALL_COLS, datasetIds: [], modelIds: MODEL_IDS }); }
    catch (e) { threw = true; }
    check(`does not throw on ${JSON.stringify(spec)}`, !threw);
  }
}
{
  const out = {};
  const { unapplied } = applySpec({ xVarsRaw: "educ" }, makeSetters(out), { headers: ALL_COLS, datasetIds: [] });
  check("bad-shape xVars falls back to def []", JSON.stringify(out.xVars) === "[]", JSON.stringify(out.xVars));
  check("bad-shape xVars reported", unapplied.some(m => m.key === "xVarsRaw" && m.reason === "bad-shape"),
    JSON.stringify(unapplied));
}
{
  const out = {};
  applySpec({ interactionTerms: [null, { var1: "wage", var2: "educ", type: "*" }] }, makeSetters(out),
    { headers: ALL_COLS, datasetIds: [] });
  check("malformed term dropped, well-formed sibling kept",
    JSON.stringify(out.interactionTerms) === JSON.stringify([{ var1: "wage", var2: "educ", type: "*" }]),
    JSON.stringify(out.interactionTerms));
}

// ── review item 5: applySpec normalises the same way collectSpec does ────────
section("applySpec sanitises on the write path, matching collectSpec");
{
  const out = {};
  applySpec({ interactionTerms: [{ var1: "wage", var2: "educ", type: "^^" }] }, makeSetters(out),
    { headers: ALL_COLS, datasetIds: [] });
  check("garbage interaction type coerced to '*'", out.interactionTerms[0].type === "*", out.interactionTerms[0].type);
}
{
  const out = {};
  applySpec({ factorRefs: { year: 2010 } }, makeSetters(out), { headers: ALL_COLS, datasetIds: [] });
  check("numeric factor level coerced to string", out.factorRefs.year === "2010", JSON.stringify(out.factorRefs));
}
{
  const out = {};
  const { unapplied } = applySpec({ factorRefs: { year: { evil: 1 } } }, makeSetters(out), { headers: ALL_COLS, datasetIds: [] });
  check("non-primitive factor level never reaches state",
    !("evil" in (out.factorRefs?.year ?? {})) && typeof out.factorRefs.year !== "object",
    JSON.stringify(out.factorRefs));
}

// ── review item 6: enum / non-primitive scalar failures clear, not linger ────
section("bad enum and bad scalar values clear to def, not left in place");
{
  const out = {};
  const { unapplied } = applySpec({ seType: "not-a-real-se-type" }, makeSetters(out), { headers: ALL_COLS, datasetIds: [] });
  check("bad seType cleared to def", out.seType === "classical", out.seType);
  check("bad seType reported", unapplied.some(m => m.key === "seType" && m.reason === "unknown-value"));
}
{
  const out = {};
  const { unapplied } = applySpec({ bwMode: { nested: true } }, makeSetters(out), { headers: ALL_COLS, datasetIds: [] });
  check("non-primitive scalar cleared to def", out.bwMode === "ik", JSON.stringify(out.bwMode));
  check("non-primitive scalar reported as bad-shape",
    unapplied.some(m => m.key === "bwMode" && m.reason === "bad-shape"), JSON.stringify(unapplied));
}

// ── review item 7: model/family are validated enums ──────────────────────────
section("model and family are validated against a real vocabulary");
{
  const out = {};
  const { unapplied } = applySpec({ model: "NotAnEstimator" }, makeSetters(out),
    { headers: ALL_COLS, datasetIds: [], modelIds: MODEL_IDS });
  check("unknown model cleared to def OLS", out.model === "OLS", out.model);
  check("unknown model reported", unapplied.some(m => m.key === "model" && m.reason === "unknown-value"));
}
{
  const out = {};
  applySpec({ model: "FE" }, makeSetters(out), { headers: ALL_COLS, datasetIds: [], modelIds: MODEL_IDS });
  check("valid model id from the real vocabulary is accepted", out.model === "FE", out.model);
}
{
  // ctx.modelIds omitted entirely — the caller chose not to supply the
  // vocabulary; `model` must pass through, not clear a good value.
  const out = {};
  const { unapplied } = applySpec({ model: "FE" }, makeSetters(out), { headers: ALL_COLS, datasetIds: [] });
  check("model written through unvalidated when ctx.modelIds is absent", out.model === "FE", out.model);
  check("nothing reported when the check was skipped", !unapplied.some(m => m.key === "model"));
}
{
  const out = {};
  const { unapplied } = applySpec({ family: "gamma" }, makeSetters(out), { headers: ALL_COLS, datasetIds: [] });
  check("unknown family cleared to def linear", out.family === "linear", out.family);
  check("unknown family reported", unapplied.some(m => m.key === "family" && m.reason === "unknown-value"));
}

// ── review item 8: factorRefs level validation is opt-in via ctx.levels ──────
section("factorRefs level validated only when ctx.levels is supplied");
{
  const spec = { factorRefs: { year: "2010" } };
  const out1 = {};
  const r1 = applySpec(spec, makeSetters(out1), { headers: ALL_COLS, datasetIds: [] }); // no ctx.levels
  check("without ctx.levels, an unknown level is NOT flagged (undocumented, not validated)",
    r1.unapplied.every(m => m.key !== "factorRefs"), JSON.stringify(r1.unapplied));
  check("without ctx.levels, the value is still written through", out1.factorRefs.year === "2010");

  const out2 = {};
  const r2 = applySpec(spec, makeSetters(out2),
    { headers: ALL_COLS, datasetIds: [], levels: { year: ["2011", "2012", "2013"] } });
  check("with ctx.levels, an unknown level IS reported",
    r2.unapplied.some(m => m.key === "factorRefs" && m.reason === "no-level"), JSON.stringify(r2.unapplied));
  check("with ctx.levels, the unknown level is dropped from state",
    !("year" in out2.factorRefs), JSON.stringify(out2.factorRefs));

  const out3 = {};
  const r3 = applySpec(spec, makeSetters(out3),
    { headers: ALL_COLS, datasetIds: [], levels: { year: ["2009", "2010", "2011"] } });
  check("with ctx.levels, a known level is kept",
    out3.factorRefs.year === "2010", JSON.stringify(out3.factorRefs));
  check("known level not reported", r3.unapplied.every(m => m.key !== "factorRefs"));
}

// ── re-review item 1: factorVars' def is dataset-dependent, not a fixed [] ───
section("factorVars def is a function of ctx, and collectSpec accepts a Set");
{
  // ModelingTab state really is a Set (`.has`/`.size` used against it
  // directly) — collectSpec must not require every call site to remember
  // `[...factorVars]` itself.
  const spec = collectSpec({ factorVars: new Set(["year", "firm"]) });
  check("collectSpec serialises a Set the same as an array",
    JSON.stringify(spec.factorVars.slice().sort()) === JSON.stringify(["firm", "year"]),
    JSON.stringify(spec.factorVars));
}
{
  // A spec that never mentions factorVars (every legacy pin, every
  // estimationDispatch-shaped partial) must reset to THIS DATASET's real
  // default — every non-numeric column — not to [], which would silently
  // demote every string column to "not a factor" and feed it into the design
  // matrix as Number(...) instead of dummies.
  const out = { factorVars: ["stale"] };
  applySpec({ model: "OLS" }, makeSetters(out),
    { headers: ALL_COLS, datasetIds: [], defaultFactorVars: ["year", "firm"] });
  check("factorVars resets to ctx.defaultFactorVars when the spec omits it",
    JSON.stringify(out.factorVars.slice().sort()) === JSON.stringify(["firm", "year"]),
    JSON.stringify(out.factorVars));
}
{
  // Caller omitted ctx.defaultFactorVars entirely — falls back to [] rather
  // than throwing, but this is the DEGRADED case, not the normal one.
  const out = { factorVars: ["stale"] };
  applySpec({ model: "OLS" }, makeSetters(out), { headers: ALL_COLS, datasetIds: [] });
  check("factorVars falls back to [] only when ctx.defaultFactorVars is omitted",
    JSON.stringify(out.factorVars) === "[]", JSON.stringify(out.factorVars));
}

// ── re-review item 2: def objects are cloned, and the table's own copies ─────
//    are frozen so an in-place mutation fails loudly instead of poisoning
//    every future reset.
section("def objects are cloned per call and the table's own instances are frozen");
{
  const outA = {};
  const outB = {};
  applySpec({}, makeSetters(outA), { headers: ALL_COLS, datasetIds: [] });
  applySpec({}, makeSetters(outB), { headers: ALL_COLS, datasetIds: [] });
  check("two successive resets of xVars are not the same array reference",
    outA.xVars !== outB.xVars);
  check("two successive resets are still value-equal", JSON.stringify(outA.xVars) === JSON.stringify(outB.xVars));

  outA.xVars.push("mutated-in-place");
  const outC = {};
  applySpec({}, makeSetters(outC), { headers: ALL_COLS, datasetIds: [] });
  check("mutating one reset's array does NOT poison a later reset",
    JSON.stringify(outC.xVars) === "[]", JSON.stringify(outC.xVars));

  const outD = {};
  applySpec({}, makeSetters(outD), { headers: ALL_COLS, datasetIds: [] });
  outD.factorRefs.poisoned = "yes";
  const outE = {};
  applySpec({}, makeSetters(outE), { headers: ALL_COLS, datasetIds: [] });
  check("mutating one reset's object (factorRefs) does NOT poison a later reset",
    !("poisoned" in outE.factorRefs), JSON.stringify(outE.factorRefs));
}
{
  const xVarsField = MODEL_SPEC_FIELDS.find(f => f.key === "xVarsRaw");
  let threw = false;
  try { xVarsField.def.push("mutated"); } catch { threw = true; }
  check("mutating the table's own xVars def array throws (frozen, strict mode)", threw);

  const factorRefsField = MODEL_SPEC_FIELDS.find(f => f.key === "factorRefs");
  let threw2 = false;
  try { factorRefsField.def.poisoned = "yes"; } catch { threw2 = true; }
  check("mutating the table's own factorRefs def object throws (frozen, strict mode)", threw2);
}

// ── re-review item 3: applySpec must not throw on a non-object top-level spec ─
section("applySpec never throws when spec ITSELF is malformed (not just a field)");
{
  const badSpecs = ["OLS", 42, true, [1, 2, 3], null];
  for (const bad of badSpecs) {
    let threw = false;
    const out = { model: "stale", xVars: ["stale"] };
    try { applySpec(bad, makeSetters(out), { headers: ALL_COLS, datasetIds: [], modelIds: MODEL_IDS }); }
    catch { threw = true; }
    check(`applySpec(${JSON.stringify(bad)}, …) does not throw`, !threw);
    if (!threw) {
      check(`applySpec(${JSON.stringify(bad)}, …) resets state to defaults, same as {}`,
        out.model === "OLS" && JSON.stringify(out.xVars) === "[]",
        `model=${out.model}, xVars=${JSON.stringify(out.xVars)}`);
    }
  }
}

// ── re-review item 4: enum guard tightened both directions ───────────────────
section("enum guard: empty modelIds skips validation, undefined resets, non-primitive is bad-shape");
{
  // ctx.modelIds: [] is a plausible transient (dataset still loading) — must
  // NOT be read as "vocabulary supplied, and your id is unknown".
  const out = {};
  const { unapplied } = applySpec({ model: "FE" }, makeSetters(out), { headers: ALL_COLS, datasetIds: [], modelIds: [] });
  check("empty modelIds does not clear a valid model value", out.model === "FE", out.model);
  check("empty modelIds does not report model as unapplied", !unapplied.some(m => m.key === "model"));
}
{
  // The key IS present but its value is `undefined` — must be treated exactly
  // like the key being absent (reset to def), never written through as
  // literal `undefined`.
  const out = { model: "stale" };
  const { unapplied } = applySpec({ model: undefined }, makeSetters(out),
    { headers: ALL_COLS, datasetIds: [], modelIds: MODEL_IDS });
  check("explicit undefined resets model to its default, not to undefined",
    out.model === "OLS", out.model);
  check("undefined-valued key is not reported (treated as absent, not invalid)",
    !unapplied.some(m => m.key === "model"));
}
{
  const out = {};
  const { unapplied } = applySpec({ model: { nested: true } }, makeSetters(out),
    { headers: ALL_COLS, datasetIds: [], modelIds: MODEL_IDS });
  check("non-primitive model value reported as bad-shape, not unknown-value",
    unapplied.some(m => m.key === "model" && m.reason === "bad-shape"), JSON.stringify(unapplied));
  check("non-primitive model value cleared to def", out.model === "OLS", out.model);
}
{
  const out = {};
  const { unapplied } = applySpec({ family: undefined }, makeSetters(out), { headers: ALL_COLS, datasetIds: [] });
  check("explicit undefined resets family to its default", out.family === "linear", out.family);
  check("undefined family not reported", !unapplied.some(m => m.key === "family"));
}

// ── Fix 2: the raw sidebar arrays must NOT occupy the `xVars`/`wVars` SPEC ──
//    keys. runners/estimationDispatch.js writes the EXPANDED design matrix
//    there and ModelingTab's specExtras Object.assigns collectSpec's output
//    over the engine's spec — same key means the expansion is clobbered.
section("Fix 2: collectSpec emits xVarsRaw/wVarsRaw, never xVars/wVars");
{
  const spec = collectSpec(STATE.OLS);
  check("collectSpec does not emit an `xVars` key", !("xVars" in spec), JSON.stringify(Object.keys(spec)));
  check("collectSpec does not emit a `wVars` key", !("wVars" in spec));
  check("collectSpec emits xVarsRaw with the RAW sidebar selection",
    JSON.stringify(spec.xVarsRaw) === JSON.stringify(["educ", "exper"]), JSON.stringify(spec.xVarsRaw));
  check("collectSpec emits wVarsRaw", JSON.stringify(spec.wVarsRaw) === "[]", JSON.stringify(spec.wVarsRaw));

  // The concrete regression: an engine spec carrying an expanded design matrix
  // must survive `Object.assign(engineSpec, collectSpec(state))` untouched.
  const engineSpec = { xVars: ["educ", "year_2011", "year_2012"], wVars: ["exper_sq"] };
  Object.assign(engineSpec, spec);
  check("Object.assign(engineSpec, collectSpec(...)) leaves the expanded xVars intact",
    JSON.stringify(engineSpec.xVars) === JSON.stringify(["educ", "year_2011", "year_2012"]),
    JSON.stringify(engineSpec.xVars));
  check("...and the expanded wVars intact",
    JSON.stringify(engineSpec.wVars) === JSON.stringify(["exper_sq"]), JSON.stringify(engineSpec.wVars));
  check("specFormula reads the raw keys, not the expanded ones",
    specFormula(engineSpec) === "wage ~ educ + exper", specFormula(engineSpec));
}
{
  // ModelingTab must no longer stamp xVarsRaw/wVarsRaw by hand — collectSpec
  // produces both, and a second source would drift.
  const src = readFileSync(MODELING_TAB, "utf8");
  check("ModelingTab no longer hand-stamps xVarsRaw/wVarsRaw in specExtras",
    !/xVarsRaw:\s*\[\.\.\.xVars\]/.test(src));
}

// ── Fix 1: a legacy pin's spec has NO `model` key ─────────────────────────────
//    `spec.model` did not exist before modelSpec.js, and no engine writes it.
//    applySpec resets an absent key to its def ("OLS") and reports NOTHING, so
//    an RDD pin restores as OLS in silence unless onRestore seeds the estimator
//    from the result's own `type`.
section("Fix 1: a legacy spec (no `model` key) keeps its estimator when seeded");
{
  const legacySpec = { yVar: "y", xVarsRaw: ["educ"], seType: "hc1",
                       runningVar: "score", cutoff: "50", bwMode: "manual", bwManual: "12.5" };
  const CTX = { headers: ALL_COLS, datasetIds: [], modelIds: MODEL_IDS };

  // Exactly what onRestore builds: { model: r.type, ...r.spec }.
  const seeded = {};
  const { unapplied } = applySpec({ model: "RDD", ...legacySpec }, makeSetters(seeded), CTX);
  check("seeded legacy spec restores the RDD estimator, not OLS", seeded.model === "RDD", seeded.model);
  check("the legacy spec's own stored fields still apply",
    seeded.seType === "hc1" && seeded.cutoff === "50" && seeded.bwManual === "12.5",
    JSON.stringify([seeded.seType, seeded.cutoff, seeded.bwManual]));
  check("seeding reports nothing spurious", unapplied.length === 0, JSON.stringify(unapplied));

  // NEGATIVE CONTROL — drop the seed and the estimator silently becomes OLS.
  const bare = {};
  const r2 = applySpec(legacySpec, makeSetters(bare), CTX);
  check("without the seed the estimator really does fall back to OLS (the bug)",
    bare.model === "OLS", bare.model);
  check("...and applySpec reports nothing about it, which is why it was silent",
    r2.unapplied.every(m => m.key !== "model"), JSON.stringify(r2.unapplied));

  // An unrecognised result type must surface, not become OLS in silence.
  const odd = {};
  const r3 = applySpec({ model: "NotAnEstimator", ...legacySpec }, makeSetters(odd), CTX);
  check("an unrecognised r.type surfaces as unknown-value",
    r3.unapplied.some(m => m.key === "model" && m.reason === "unknown-value"), JSON.stringify(r3.unapplied));
}
{
  // The seed lives in ModelingTab.jsx's onRestore; pin it as text so deleting
  // it turns this check red (same technique as the def-sync check above).
  const src = readFileSync(MODELING_TAB, "utf8").replace(/\s+/g, " ");
  check("onRestore seeds the spec as { model: r.type, ...rawSpec }",
    src.includes("const restoreSpec = { model: r.type, ...rawSpec };"),
    "no `const restoreSpec = { model: r.type, ...rawSpec };` found in ModelingTab.jsx");
  check("onRestore flags a legacy spec (no `model` key) with reason legacy-spec",
    /\("model" in rawSpec\)/.test(src) && src.includes('reason: "legacy-spec"'));
  check("the banner renders the legacy-spec entry with its own copy",
    src.includes('m.reason === "legacy-spec"'));
}

// ── Fix 3 / Fix 4 ────────────────────────────────────────────────────────────
section("Fix 3/4: stale-notice reset and a non-string banner value");
{
  const src = readFileSync(MODELING_TAB, "utf8");
  const eff = src.slice(src.indexOf("setFactorVars(new Set(headers.filter"), src.indexOf("[cleanedData]"));
  check("the dataset-switch reset effect also clears specNotice",
    eff.includes("setSpecNotice(null)"), "setSpecNotice(null) not found in the [cleanedData] reset effect");
  check("the banner formats values through fmtSpecValue, not String()",
    src.includes("fmtSpecValue(m.value)") && !src.includes("{String(m.value)}"));
}
{
  // The values a bad-shape report actually carries are objects and arrays.
  const out = {};
  const { unapplied } = applySpec({ bwMode: { nested: true }, factorRefs: ["a", "b"] },
    makeSetters(out), { headers: ALL_COLS, datasetIds: [] });
  check("bad-shape reports really do carry non-string values (what Fix 4 is for)",
    unapplied.some(m => m.reason === "bad-shape" && typeof m.value === "object"),
    JSON.stringify(unapplied));
  check("String() on such a value is the useless [object Object] the fix removes",
    String(unapplied.find(m => m.reason === "bad-shape" && !Array.isArray(m.value)).value) === "[object Object]");
}

section("specFormula");
{
  check("OLS formula", specFormula(collectSpec(STATE.OLS)) === "wage ~ educ + exper",
    specFormula(collectSpec(STATE.OLS)));
  check("IV formula names instruments",
    specFormula(collectSpec(STATE.IV)).includes("| dist"),
    specFormula(collectSpec(STATE.IV)));
  check("no y yields a placeholder", specFormula({}) === "(no outcome)");
}

// ── artifactIO fallout, review item 2: duck-typed arrays in a hand-edited ────
// model.json (e.g. {"length":1} instead of a real array) must not crash the
// import picker. specFormula guarded with `.length` then called `.join`,
// which throws on any array-like non-array. Must use Array.isArray.
section("specFormula survives duck-typed non-array fields (a hand-edited file)");
{
  let threw = false;
  let out = null;
  try {
    out = specFormula({ yVar: "wage", xVarsRaw: { length: 2, 0: "a", 1: "b" } });
  } catch { threw = true; }
  check("array-like xVarsRaw does not throw", !threw, out);

  threw = false;
  try { specFormula({ yVar: "wage", wVarsRaw: "not-an-array" }); } catch { threw = true; }
  check("string wVarsRaw does not throw", !threw);

  threw = false;
  try { specFormula({ yVar: "wage", zVars: { length: 1 } }); } catch { threw = true; }
  check("array-like zVars does not throw", !threw);

  threw = false;
  try { specFormula({ yVar: "wage", feCols: { length: 1 } }); } catch { threw = true; }
  check("array-like feCols does not throw", !threw);

  threw = false;
  try { specFormula({ yVar: "wage", xVarsRaw: null, wVarsRaw: null, zVars: null, feCols: null }); } catch { threw = true; }
  check("null list fields do not throw", !threw);
}

section("SE_TYPES vocabulary is well-formed (single-owner migration lands in Task 2)");
check("every SE_TYPES entry has id + label",
  SE_TYPES.length > 0 && SE_TYPES.every(s => typeof s.id === "string" && typeof s.label === "string"));

console.log(`\nmodelSpec: ${pass} passed, ${fail} failed`);
if (fail > 0) process.exit(1);
