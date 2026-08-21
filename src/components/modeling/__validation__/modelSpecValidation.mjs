// ─── modelSpec harness ───────────────────────────────────────────────────────
// Plain node script (no test runner):
//   node src/components/modeling/__validation__/modelSpecValidation.mjs
// Prints [pass]/[FAIL] per check + a summary; exits 1 if anything fails.

import { MODEL_SPEC_FIELDS, SE_TYPES, collectSpec, applySpec, specFormula } from "../modelSpec.js";
import { buildModelAvail } from "../helpers.js";

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
  "timeCol","timeVar","treatTimeCol","treatVar","treatedUnit","wVars","weightVar",
  "xVars","yVar","zVars",
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
  const specB = { model: "OLS", yVar: "wage", xVars: ["educ"] };
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
  const { unapplied } = applySpec({ xVars: "educ" }, makeSetters(out), { headers: ALL_COLS, datasetIds: [] });
  check("bad-shape xVars falls back to def []", JSON.stringify(out.xVars) === "[]", JSON.stringify(out.xVars));
  check("bad-shape xVars reported", unapplied.some(m => m.key === "xVars" && m.reason === "bad-shape"),
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

section("specFormula");
{
  check("OLS formula", specFormula(collectSpec(STATE.OLS)) === "wage ~ educ + exper",
    specFormula(collectSpec(STATE.OLS)));
  check("IV formula names instruments",
    specFormula(collectSpec(STATE.IV)).includes("| dist"),
    specFormula(collectSpec(STATE.IV)));
  check("no y yields a placeholder", specFormula({}) === "(no outcome)");
}

section("SE_TYPES vocabulary is well-formed (single-owner migration lands in Task 2)");
check("every SE_TYPES entry has id + label",
  SE_TYPES.length > 0 && SE_TYPES.every(s => typeof s.id === "string" && typeof s.label === "string"));

console.log(`\nmodelSpec: ${pass} passed, ${fail} failed`);
if (fail > 0) process.exit(1);
