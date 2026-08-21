// ─── modelSpec harness ───────────────────────────────────────────────────────
// Plain node script (no test runner):
//   node src/components/modeling/__validation__/modelSpecValidation.mjs
// Prints [pass]/[FAIL] per check + a summary; exits 1 if anything fails.

import { MODEL_SPEC_FIELDS, SE_TYPES, collectSpec, applySpec, specFormula } from "../modelSpec.js";

let pass = 0, fail = 0;
const check = (n, c, extra) => {
  if (c) { pass++; console.log("  [pass]", n); }
  else   { fail++; console.log("  [FAIL]", n, extra != null ? "→ " + extra : ""); }
};
const section = (t) => console.log("\n── " + t + " ──");

// A full sidebar state, one fixture per estimator group.
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
  const spec = collectSpec(state);
  check(`${group}: spec is JSON-serialisable`,
    JSON.stringify(spec) === JSON.stringify(JSON.parse(JSON.stringify(spec))));
  const out = {};
  // panelRef fields are COMPARED against the dataset's declared panel, so the
  // round-trip ctx must state the panel this fixture was estimated on —
  // otherwise the Panel group reports a mismatch against a null panel.
  const { missing } = applySpec(spec, makeSetters(out), {
    headers: ALL_COLS,
    datasetIds: ["ds_7"],
    panel: { entityCol: state.entityCol ?? null, timeCol: state.timeCol ?? null },
  });
  check(`${group}: nothing reported missing`, missing.length === 0,
    missing.map(m => m.key).join(", "));
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
  const { missing } = applySpec(spec, makeSetters(out), { headers: ["wage", "exper"], datasetIds: [] });
  const keys = missing.map(m => m.key).sort();
  check("yVar kept (present)", out.yVar[0] === "wage");
  check("xVars dropped educ, kept exper", JSON.stringify(out.xVars) === JSON.stringify(["exper"]));
  check("factorVars reported", keys.includes("factorVars"), keys.join(", "));
  check("missing entries carry the offending value",
    missing.every(m => "value" in m && "key" in m));
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
  const { missing } = applySpec(spec, makeSetters(out),
    { headers: ALL_COLS, datasetIds: [], panel: { entityCol: "id", timeCol: "t" } });
  check("entityCol not written to state", !("entityCol" in out));
  check("panel mismatch reported",
    missing.some(m => m.key === "entityCol" && m.reason === "panel-mismatch"),
    JSON.stringify(missing));
}

section("datasetRef checked against session dataset ids");
{
  const spec = collectSpec(STATE.Spatial);
  const out = {};
  const { missing } = applySpec(spec, makeSetters(out), { headers: ALL_COLS, datasetIds: ["other"] });
  check("unresolvable datasetRef reported",
    missing.some(m => m.key === "spatialWeightsDatasetId"));
  check("unresolvable datasetRef cleared, not left dangling", !out.spatialWeightsDatasetId);
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

section("SE_TYPES is the single owner");
check("every SE_TYPES entry has id + label",
  SE_TYPES.length > 0 && SE_TYPES.every(s => typeof s.id === "string" && typeof s.label === "string"));

console.log(`\nmodelSpec: ${pass} passed, ${fail} failed`);
if (fail > 0) process.exit(1);
