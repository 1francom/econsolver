// ─── runEstimation harness ───────────────────────────────────────────────────
// Plain node script (no test runner):
//   node src/components/modeling/__validation__/runEstimationValidation.mjs
// Prints [pass]/[FAIL] per check + a summary; exits 1 if anything fails.
//
// Two jobs:
//  12.1  Prove `runEstimationOnRows` is a BEHAVIOR-PRESERVING extraction of
//        ModelingTab's `_runEstimation` body. A node harness cannot import a
//        .jsx file, so the OLD body is re-derived here as a literal fixture
//        (`oldRunEstimation`, transcribed verbatim from ModelingTab.jsx:934-994
//        as it stood before the extraction) and the two are compared with
//        JSON.stringify on a deterministic key order.
//  12.2  Prove `buildEstimationConfigFromSpec` turns a spec back into a cfg the
//        SAME core can estimate — most importantly that `cfg.factorVars` is a
//        real `Set`, because helpers.js's `applyFactors` calls `.has()` on it
//        directly (helpers.js:64) and would throw on a plain array.

import { dispatchEstimation } from "../runners/estimationDispatch.js";
import { collectSpec } from "../modelSpec.js";
import { runEstimationOnRows, buildEstimationConfigFromSpec } from "../runEstimation.js";

let pass = 0, fail = 0;
const check = (n, c, extra) => {
  if (c) { pass++; console.log("  [pass]", n); }
  else   { fail++; console.log("  [FAIL]", n, extra != null ? "→ " + extra : ""); }
};
const section = (t) => console.log("\n── " + t + " ──");

// Stable, order-insensitive stringify so a key-insertion-order difference
// between the two code paths is not mistaken for a behavioural difference.
// Functions are dropped (resolveSpatialWeights lives on nothing we serialise,
// but engine results can carry lazy thunks) and NaN/Infinity are tagged so
// JSON.stringify does not silently flatten them all to `null`.
//
// Two fields are IDENTITY, not behaviour, and are minted fresh on every
// `wrapResult` call: the EstimationResult's uuid `id` and its `timestamp`.
// Comparing them would make ANY two runs differ — including a run compared
// against itself — so they are canonicalised here. Nothing else is masked:
// every coefficient, SE, df, spec field and stamp is compared verbatim.
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const IDENTITY_KEYS = new Set(["timestamp"]);
function stable(v, seen = new WeakSet()) {
  if (typeof v === "function") return "[fn]";
  if (typeof v === "string" && UUID_RE.test(v)) return "[uuid]";
  if (typeof v === "number") {
    if (Number.isNaN(v)) return "[NaN]";
    if (!Number.isFinite(v)) return v > 0 ? "[+Inf]" : "[-Inf]";
    return v;
  }
  if (v instanceof Set) return { __set: [...v].map(x => stable(x, seen)) };
  if (v === null || typeof v !== "object") return v;
  if (seen.has(v)) return "[circular]";
  seen.add(v);
  if (Array.isArray(v)) return v.map(x => stable(x, seen));
  const out = {};
  for (const k of Object.keys(v).sort()) {
    out[k] = IDENTITY_KEYS.has(k) ? "[identity]" : stable(v[k], seen);
  }
  return out;
}
const ser = (v) => JSON.stringify(stable(v));

// ── The OLD _runEstimation body, transcribed literally ───────────────────────
// `s` stands in for ModelingTab's closure state. Everything below (the
// dispatchEstimation option object, the collectSpec argument list, the
// specExtras assignment order, the datasetId stamping) is a verbatim copy of
// what ModelingTab.jsx:934-994 contained before Task 12 replaced it with a
// one-line call to runEstimationOnRows. Do not "tidy" it — its whole value is
// being an independent restatement of the pre-extraction behaviour.
function oldRunEstimation(dataRows, s) {
  const dispatch = dispatchEstimation(dataRows, {
    yVar: s.yVar, xVars: s.xVars, wVars: s.wVars, factorVars: s.factorVars, factorRefs: s.factorRefs,
    interactionTerms: s.interactionTerms,
    model: s.model, family: s.family, weightVar: s.weightVar, seOpts: s.seOpts, seType: s.seType,
    panel: s.panel, noIntercept: s.noIntercept,
    zVars: s.zVars, postVar: s.postVar, treatVar: s.treatVar,
    runningVar: s.runningVar, cutoff: s.cutoff, bwMode: s.bwMode, bwManual: s.bwManual,
    kernel: s.kernel, polyOrder: s.polyOrder,
    treatedUnit: s.treatedUnit, synthTreatTime: s.synthTreatTime, treatTimeCol: s.treatTimeCol,
    kPre: s.kPre, kPost: s.kPost,
    feCols: s.effectiveFeCols,
    poissonEntityCol: s.poissonEntityCol, poissonOffsetCol: s.poissonOffsetCol, poissonExtraFE: s.poissonExtraFE,
    cohortCol: s.cohortCol, periodCol: s.periodCol, saUnitCol: s.saUnitCol,
    saControlMode: s.saControlMode, saRefPeriod: s.saRefPeriod,
    csTreatCol: s.csTreatCol, csEntityCol: s.csEntityCol, csTimeCol: s.csTimeCol,
    csCompGroup: s.csCompGroup, csRelMin: s.csRelMin, csRelMax: s.csRelMax,
    csXCols: s.csXCols, csEstMethod: s.csEstMethod, csBasePeriod: s.csBasePeriod,
    csAnticipation: s.csAnticipation, csInfMethod: s.csInfMethod, csNBoot: s.csNBoot,
    csSeed: s.csSeed, csDefaultView: s.csDefaultView,
    spatialModel: s.spatialModel, spatialWeightsMode: s.spatialWeightsMode,
    spatialGeomCol: s.spatialGeomCol, spatialWeightsDatasetId: s.spatialWeightsDatasetId,
    resolveSpatialWeights: s.resolveSpatialWeights,
  });
  const specExtras = {
    ...collectSpec({
      model: s.model, family: s.family, yVar: s.yVar, xVars: s.xVars, wVars: s.wVars,
      zVars: s.zVars, weightVar: s.weightVar,
      factorVars: s.factorVars, factorRefs: s.factorRefs,
      interactionTerms: s.interactionTerms, noIntercept: s.noIntercept,
      selectedFeCols: s.effectiveFeCols,
      entityCol: s.panel?.entityCol ?? null, timeCol: s.panel?.timeCol ?? null,
      treatVar: s.treatVar, postVar: s.postVar, runningVar: s.runningVar, cutoff: s.cutoff,
      bwMode: s.bwMode, bwManual: s.bwManual, kernel: s.kernel, polyOrder: s.polyOrder,
      treatedUnit: s.treatedUnit, synthTreatTime: s.synthTreatTime, treatTimeCol: s.treatTimeCol,
      kPre: s.kPre, kPost: s.kPost,
      poissonEntityCol: s.poissonEntityCol, poissonOffsetCol: s.poissonOffsetCol,
      poissonExtraFE: s.poissonExtraFE,
      cohortCol: s.cohortCol, periodCol: s.periodCol, saUnitCol: s.saUnitCol,
      saControlMode: s.saControlMode, saRefPeriod: s.saRefPeriod,
      csTreatCol: s.csTreatCol, csEntityCol: s.csEntityCol, csTimeCol: s.csTimeCol,
      csXCols: s.csXCols, csCompGroup: s.csCompGroup, csRelMin: s.csRelMin, csRelMax: s.csRelMax,
      csEstMethod: s.csEstMethod, csBasePeriod: s.csBasePeriod, csAnticipation: s.csAnticipation,
      csInfMethod: s.csInfMethod, csNBoot: s.csNBoot, csSeed: s.csSeed, csDefaultView: s.csDefaultView,
      spatialModel: s.spatialModel, spatialWeightsMode: s.spatialWeightsMode,
      spatialGeomCol: s.spatialGeomCol, spatialWeightsDatasetId: s.spatialWeightsDatasetId,
      spatialWeightsType: s.spatialWeightsType, spatialWeightsStyle: s.spatialWeightsStyle,
      spatialWeightsK: s.spatialWeightsK, spatialWeightsD: s.spatialWeightsD,
      spatialWeightsICol: s.spatialWeightsICol, spatialWeightsJCol: s.spatialWeightsJCol,
      spatialWeightsWCol: s.spatialWeightsWCol,
      seType: s.seType, clusterVar: s.clusterVar, clusterVar2: s.clusterVar2,
      timeVar: s.timeVar, maxLag: s.maxLag,
    }),
    filename: s.cleanedData?.filename ?? null,
  };
  if (dispatch?.result?.spec)      Object.assign(dispatch.result.spec,      specExtras);
  if (dispatch?.result?.fe?.spec)  Object.assign(dispatch.result.fe.spec,   specExtras);
  if (dispatch?.result?.fd?.spec)  Object.assign(dispatch.result.fd.spec,   specExtras);
  const _dsTag = s.datasetId ?? null;
  if (dispatch?.result)     dispatch.result.datasetId    = _dsTag;
  if (dispatch?.result?.fe) dispatch.result.fe.datasetId = _dsTag;
  if (dispatch?.result?.fd) dispatch.result.fd.datasetId = _dsTag;
  return dispatch;
}

// The NEW wrapper's cfg-building, mirroring what ModelingTab's `_runEstimation`
// now passes. Keeping it in one place here means the comparison is exactly
// "same state bag in, same result out".
function cfgFromState(s) {
  return {
    yVar: s.yVar, xVars: s.xVars, wVars: s.wVars, factorVars: s.factorVars, factorRefs: s.factorRefs,
    interactionTerms: s.interactionTerms,
    model: s.model, family: s.family, weightVar: s.weightVar, seOpts: s.seOpts, seType: s.seType,
    panel: s.panel, noIntercept: s.noIntercept,
    zVars: s.zVars, postVar: s.postVar, treatVar: s.treatVar,
    runningVar: s.runningVar, cutoff: s.cutoff, bwMode: s.bwMode, bwManual: s.bwManual,
    kernel: s.kernel, polyOrder: s.polyOrder,
    treatedUnit: s.treatedUnit, synthTreatTime: s.synthTreatTime, treatTimeCol: s.treatTimeCol,
    kPre: s.kPre, kPost: s.kPost, feCols: s.effectiveFeCols,
    poissonEntityCol: s.poissonEntityCol, poissonOffsetCol: s.poissonOffsetCol, poissonExtraFE: s.poissonExtraFE,
    cohortCol: s.cohortCol, periodCol: s.periodCol, saUnitCol: s.saUnitCol,
    saControlMode: s.saControlMode, saRefPeriod: s.saRefPeriod,
    csTreatCol: s.csTreatCol, csEntityCol: s.csEntityCol, csTimeCol: s.csTimeCol,
    csCompGroup: s.csCompGroup, csRelMin: s.csRelMin, csRelMax: s.csRelMax,
    csXCols: s.csXCols, csEstMethod: s.csEstMethod, csBasePeriod: s.csBasePeriod,
    csAnticipation: s.csAnticipation, csInfMethod: s.csInfMethod, csNBoot: s.csNBoot,
    csSeed: s.csSeed, csDefaultView: s.csDefaultView,
    spatialModel: s.spatialModel, spatialWeightsMode: s.spatialWeightsMode,
    spatialGeomCol: s.spatialGeomCol, spatialWeightsDatasetId: s.spatialWeightsDatasetId,
    resolveSpatialWeights: s.resolveSpatialWeights,
    clusterVar: s.clusterVar, clusterVar2: s.clusterVar2, timeVar: s.timeVar, maxLag: s.maxLag,
    spatialWeightsType: s.spatialWeightsType, spatialWeightsStyle: s.spatialWeightsStyle,
    spatialWeightsK: s.spatialWeightsK, spatialWeightsD: s.spatialWeightsD,
    spatialWeightsICol: s.spatialWeightsICol, spatialWeightsJCol: s.spatialWeightsJCol,
    spatialWeightsWCol: s.spatialWeightsWCol,
  };
}

// ── Fixtures ─────────────────────────────────────────────────────────────────
// Deterministic (no RNG) so a re-run is byte-comparable.
function olsRows(n = 60) {
  const out = [];
  for (let i = 0; i < n; i++) {
    const educ = 8 + (i % 9);
    const exper = 1 + ((i * 7) % 20);
    const wage = 2.5 + 0.42 * educ + 0.11 * exper + ((i % 5) - 2) * 0.3;
    out.push({ wage, educ, exper, region: ["north", "south", "east"][i % 3], id: 1 + (i % 10), year: 2000 + Math.floor(i / 10) });
  }
  return out;
}

// A complete ModelingTab-shaped state bag at its defaults; per-fixture
// overrides only touch what that fixture is about.
function baseState(over = {}) {
  return {
    yVar: [], xVars: [], wVars: [], zVars: [], weightVar: [],
    factorVars: new Set(), factorRefs: {}, interactionTerms: [],
    model: "OLS", family: "linear", noIntercept: false,
    seOpts: { seType: "classical", clusterVar: null, clusterVar2: null, timeVar: null, maxLag: null },
    seType: "classical", clusterVar: null, clusterVar2: null, timeVar: null, maxLag: null,
    panel: null, effectiveFeCols: [],
    postVar: [], treatVar: [], runningVar: [], cutoff: "", bwMode: "ik", bwManual: "",
    kernel: "triangular", polyOrder: 1,
    treatedUnit: "", synthTreatTime: "", treatTimeCol: [], kPre: 3, kPost: 3,
    poissonEntityCol: "", poissonOffsetCol: "", poissonExtraFE: [],
    cohortCol: [], periodCol: [], saUnitCol: "", saControlMode: "auto", saRefPeriod: -1,
    csTreatCol: [], csEntityCol: [], csTimeCol: [], csXCols: [], csCompGroup: "nevertreated",
    csRelMin: "", csRelMax: "", csEstMethod: "dr", csBasePeriod: "varying",
    csAnticipation: "0", csInfMethod: "bootstrap", csNBoot: "999", csSeed: "42", csDefaultView: "group",
    spatialModel: "SAR", spatialWeightsMode: "inline", spatialGeomCol: "", spatialWeightsDatasetId: "",
    spatialWeightsType: "queen", spatialWeightsStyle: "W", spatialWeightsK: 4, spatialWeightsD: 1000,
    spatialWeightsICol: "i", spatialWeightsJCol: "j", spatialWeightsWCol: "w",
    resolveSpatialWeights: () => ({ error: "not used in this fixture" }),
    cleanedData: { filename: "wages.csv" }, datasetId: "ds_1",
    ...over,
  };
}

const OLS_STATE = baseState({ yVar: ["wage"], xVars: ["educ"], wVars: ["exper"] });
const FE_STATE = baseState({
  model: "FE", yVar: ["wage"], xVars: ["educ"], wVars: ["exper"],
  panel: { entityCol: "id", timeCol: "year" }, effectiveFeCols: ["id"],
});
const FACTOR_STATE = baseState({
  yVar: ["wage"], xVars: ["educ", "region"], wVars: [],
  factorVars: new Set(["region"]), factorRefs: { region: "north" },
});

// ─────────────────────────────────────────────────────────────────────────────
section("12.1 — runEstimationOnRows is a behavior-preserving extraction");
{
  const rows = olsRows();
  for (const [name, st] of [["OLS", OLS_STATE], ["FE (panel {type,fe,fd} wrapper)", FE_STATE], ["OLS + factor expansion", FACTOR_STATE]]) {
    const oldOut = oldRunEstimation(rows.map(r => ({ ...r })), st);
    const newOut = runEstimationOnRows(rows.map(r => ({ ...r })), cfgFromState(st),
      { filename: st.cleanedData?.filename ?? null, datasetId: st.datasetId });
    check(`${name}: old and new produce identical output`,
      ser(oldOut) === ser(newOut),
      `old=${ser(oldOut).slice(0, 400)}\n        new=${ser(newOut).slice(0, 400)}`);
    check(`${name}: actually estimated something (guards against comparing two errors)`,
      !!oldOut?.result && !oldOut?.error, ser(oldOut?.error));
  }

  // NEGATIVE CONTROL — the comparison above masks the uuid/timestamp identity
  // fields, so prove it is still sensitive to a REAL difference. Drop one
  // control from the new path only: the two must now disagree. Without this,
  // an over-eager mask would make every equality check pass vacuously.
  {
    const perturbed = { ...cfgFromState(OLS_STATE), wVars: [] };
    check("negative control: dropping a control makes old ≠ new",
      ser(oldRunEstimation(olsRows(), OLS_STATE)) !==
      ser(runEstimationOnRows(olsRows(), perturbed, { filename: "wages.csv", datasetId: "ds_1" })));
    const dsShift = runEstimationOnRows(olsRows(), cfgFromState(OLS_STATE), { filename: "wages.csv", datasetId: "ds_OTHER" });
    check("negative control: a different datasetId stamp makes old ≠ new",
      ser(oldRunEstimation(olsRows(), OLS_STATE)) !== ser(dsShift));
  }

  // The FE wrapper shape is the one that historically leaked a display object
  // into a data store (CLAUDE.md's pinned-panel-model bug) — assert it here so
  // a future "simplification" of the extraction cannot flatten it.
  const feOut = runEstimationOnRows(olsRows(), cfgFromState(FE_STATE),
    { filename: "wages.csv", datasetId: "ds_1" });
  check("FE result keeps the {type, fe, fd} wrapper shape",
    feOut?.result?.type === "FE" && !!feOut?.result?.fe, ser(feOut?.result && Object.keys(feOut.result)));
  check("FE inner result got the specExtras stamp (xVarsRaw)",
    JSON.stringify(feOut?.result?.fe?.spec?.xVarsRaw) === JSON.stringify(["educ"]),
    ser(feOut?.result?.fe?.spec?.xVarsRaw));
  check("FE inner result got the datasetId stamp",
    feOut?.result?.fe?.datasetId === "ds_1", ser(feOut?.result?.fe?.datasetId));

  // Error passthrough: a spec with no Y must fail the same way through both.
  const bad = baseState({ yVar: [] });
  check("no-Y error is identical through both paths",
    ser(oldRunEstimation(olsRows(), bad)) ===
    ser(runEstimationOnRows(olsRows(), cfgFromState(bad), { filename: null, datasetId: null })),
    ser(runEstimationOnRows(olsRows(), cfgFromState(bad), {})));

  // extraCtx is replication metadata, NOT a spec field — confirm it lands.
  const withCtx = runEstimationOnRows(olsRows(), cfgFromState(OLS_STATE),
    { filename: "other.csv", datasetId: "ds_9" });
  check("extraCtx.filename is stamped onto the result spec",
    withCtx?.result?.spec?.filename === "other.csv", ser(withCtx?.result?.spec?.filename));
  check("extraCtx.datasetId is stamped onto the result",
    withCtx?.result?.datasetId === "ds_9", ser(withCtx?.result?.datasetId));
  const noCtx = runEstimationOnRows(olsRows(), cfgFromState(OLS_STATE));
  check("omitted extraCtx defaults filename/datasetId to null",
    noCtx?.result?.spec?.filename === null && noCtx?.result?.datasetId === null,
    ser([noCtx?.result?.spec?.filename, noCtx?.result?.datasetId]));
}

// ─────────────────────────────────────────────────────────────────────────────
section("12.2 — buildEstimationConfigFromSpec round-trips a spec into a runnable cfg");

const HEADERS = ["wage", "educ", "exper", "region", "id", "year"];
const CTX = {
  headers: HEADERS,
  datasetIds: ["ds_1", "ds_w"],
  panel: null,
  modelIds: ["OLS", "FE", "FD", "IV", "RDD", "DiD", "TWFE"],
  defaultFactorVars: ["region"],
  availableDatasets: [],
};

{
  // Round-trip: collectSpec(state) → buildEstimationConfigFromSpec → estimate.
  const spec = collectSpec({
    ...OLS_STATE, selectedFeCols: OLS_STATE.effectiveFeCols,
    entityCol: null, timeCol: null,
  });
  const { cfg, unapplied } = buildEstimationConfigFromSpec(spec, CTX);
  check("clean OLS spec reports no unapplied fields", unapplied.length === 0, ser(unapplied));
  check("cfg.yVar is re-wrapped to the VarPanel array convention",
    Array.isArray(cfg.yVar) && cfg.yVar[0] === "wage", ser(cfg.yVar));
  check("cfg.xVars comes back from the spec's xVarsRaw key",
    JSON.stringify(cfg.xVars) === JSON.stringify(["educ"]), ser(cfg.xVars));
  check("cfg carries a derived seOpts object",
    cfg.seOpts && cfg.seOpts.seType === "classical", ser(cfg.seOpts));
  check("cfg.resolveSpatialWeights is a function", typeof cfg.resolveSpatialWeights === "function");
  check("cfg.feCols is an array (never null — the nullable branch is sidebar-only)",
    Array.isArray(cfg.feCols), ser(cfg.feCols));

  const out = runEstimationOnRows(olsRows(), cfg, { filename: "wages.csv", datasetId: "ds_1" });
  check("round-tripped cfg estimates cleanly", !!out?.result && !out?.error, ser(out?.error));
  // The point of the whole task: bulk import and the live Estimate button must
  // produce the SAME numbers for the same spec on the same rows.
  const live = runEstimationOnRows(olsRows(), cfgFromState(OLS_STATE), { filename: "wages.csv", datasetId: "ds_1" });
  check("round-tripped cfg gives byte-identical output to the live-state cfg",
    ser(out) === ser(live), `${ser(out).slice(0, 300)}\n        vs ${ser(live).slice(0, 300)}`);
}

{
  // THE critical property of this task. helpers.js's applyFactors does
  // `vars.filter(v => factorVars.has(v))` (helpers.js:64) with NO array
  // tolerance, so a plain array here throws "factorVars.has is not a function".
  const spec = collectSpec({
    ...FACTOR_STATE, selectedFeCols: [], entityCol: null, timeCol: null,
  });
  const { cfg } = buildEstimationConfigFromSpec(spec, CTX);
  check("cfg.factorVars instanceof Set", cfg.factorVars instanceof Set,
    `got ${Object.prototype.toString.call(cfg.factorVars)}`);
  check("cfg.factorVars carries the spec's members",
    cfg.factorVars.has("region"), ser([...(cfg.factorVars ?? [])]));
  check("cfg.factorVars.has() is callable (the exact call applyFactors makes)",
    (() => { try { return cfg.factorVars.has("educ") === false; } catch { return false; } })());

  const out = runEstimationOnRows(olsRows(), cfg, { filename: "wages.csv", datasetId: "ds_1" });
  check("factor spec estimates cleanly through the rebuilt cfg", !!out?.result && !out?.error, ser(out?.error));
  check("factor expansion actually happened (region dummies in the design matrix)",
    (out?.result?.spec?.xVars ?? []).some(v => v.startsWith("region_")), ser(out?.result?.spec?.xVars));

  // An ABSENT factorVars key must fall back to ctx.defaultFactorVars — still
  // as a Set, not as the raw array applySpec hands the setter.
  const { cfg: cfg2 } = buildEstimationConfigFromSpec({ yVar: "wage", xVarsRaw: ["educ"] }, CTX);
  check("default-branch factorVars is also a Set", cfg2.factorVars instanceof Set,
    Object.prototype.toString.call(cfg2.factorVars));
  check("default-branch factorVars uses ctx.defaultFactorVars",
    cfg2.factorVars.has("region"), ser([...(cfg2.factorVars ?? [])]));
}

{
  // A spec naming a column this dataset does not have: reported in `unapplied`,
  // never silently dropped, and what is left still estimates.
  const { cfg, unapplied } = buildEstimationConfigFromSpec(
    { model: "OLS", family: "linear", yVar: "wage", xVarsRaw: ["educ", "tenure_ghost"] }, CTX);
  check("missing column is reported in unapplied",
    unapplied.some(u => u.reason === "no-column" && String(u.value).includes("tenure_ghost")), ser(unapplied));
  check("the surviving regressor is kept",
    JSON.stringify(cfg.xVars) === JSON.stringify(["educ"]), ser(cfg.xVars));
  const out = runEstimationOnRows(olsRows(), cfg, {});
  check("partially-resolved spec still estimates on what is left",
    !!out?.result && !out?.error, ser(out?.error));

  // A spec whose OUTCOME is missing cannot estimate — it must surface as an
  // error, not as a silently-empty result.
  const { cfg: cfg3, unapplied: un3 } = buildEstimationConfigFromSpec(
    { model: "OLS", yVar: "ghost_y", xVarsRaw: ["educ"] }, CTX);
  check("missing outcome is reported", un3.some(u => u.key === "yVar"), ser(un3));
  const out3 = runEstimationOnRows(olsRows(), cfg3, {});
  check("missing outcome yields an error, not a bogus result", !!out3?.error && !out3?.result, ser(out3));
}

{
  // Malformed / hostile input: this is the untrusted-file path, it must never
  // throw. applySpec already guarantees this; confirm the wrapper does too.
  for (const bad of [null, undefined, 42, "OLS", [1, 2, 3], { yVar: { a: 1 }, xVarsRaw: "educ" }]) {
    let ok = true;
    try { buildEstimationConfigFromSpec(bad, CTX); } catch { ok = false; }
    check(`malformed spec ${JSON.stringify(bad) ?? "undefined"} does not throw`, ok);
  }
  let ok = true;
  try { buildEstimationConfigFromSpec({ yVar: "wage" }, {}); } catch { ok = false; }
  check("empty ctx does not throw", ok);
}

{
  // resolveSpatialWeights: derived from the spec, not from React state.
  const { cfg } = buildEstimationConfigFromSpec(
    { model: "OLS", yVar: "wage", spatialWeightsMode: "inline", spatialGeomCol: "" }, CTX);
  const r = cfg.resolveSpatialWeights([{}, {}]);
  check("inline mode with no geometry column returns the same guard error",
    r?.error === "Select a geometry WKT column for W.", ser(r));

  const CTX_W = {
    ...CTX,
    availableDatasets: [{ id: "ds_w", rows: [{ i: 0, j: 1, w: 1 }, { i: 1, j: 0, w: 1 }] }],
  };
  const { cfg: cfgW } = buildEstimationConfigFromSpec(
    { model: "OLS", yVar: "wage", spatialWeightsMode: "dataset", spatialWeightsDatasetId: "ds_w" }, CTX_W);
  const rw = cfgW.resolveSpatialWeights([{}, {}]);
  check("triples mode resolves ids + weights from the referenced dataset",
    Array.isArray(rw?.ids) && rw.ids.length === 2 && rw.weights?.length === 2, ser(rw));
  check("triples mode returns the full summary object (not the truncated draft)",
    rw?.summary && rw.summary.n === 2 && rw.summary.links === 2 &&
    rw.summary.type === "triples" && rw.summary.style === "custom" &&
    typeof rw.summary.avgNeighbors === "number" && typeof rw.summary.islands === "number",
    ser(rw?.summary));

  const { cfg: cfgNo } = buildEstimationConfigFromSpec(
    { model: "OLS", yVar: "wage", spatialWeightsMode: "dataset", spatialWeightsDatasetId: "" }, CTX);
  check("triples mode with no dataset returns the same guard error",
    cfgNo.resolveSpatialWeights([{}])?.error === "Select a saved spatial weights triples dataset.",
    ser(cfgNo.resolveSpatialWeights([{}])));
}

{
  // The N-spec loop the importer runs: each spec must be independent — no
  // state carried between iterations (the whole reason this is a pure
  // function of an explicit cfg rather than of React state).
  const specs = [
    collectSpec({ ...OLS_STATE, selectedFeCols: [], entityCol: null, timeCol: null }),
    collectSpec({ ...FACTOR_STATE, selectedFeCols: [], entityCol: null, timeCol: null }),
    { model: "OLS", yVar: "wage", xVarsRaw: ["ghost"] },
  ];
  const rows = olsRows();
  const outs = specs.map(s => {
    const { cfg } = buildEstimationConfigFromSpec(s, CTX);
    return runEstimationOnRows(rows, cfg, { filename: "wages.csv", datasetId: "ds_1" });
  });
  check("loop: spec 1 and 3 succeed/fail independently of spec 2",
    !!outs[0]?.result && !!outs[1]?.result && !!outs[2]?.error, ser(outs.map(o => o?.error ?? "ok")));
  check("loop: spec 1 in the loop matches spec 1 estimated alone (no cross-iteration bleed)",
    ser(outs[0]) === ser(runEstimationOnRows(rows, buildEstimationConfigFromSpec(specs[0], CTX).cfg,
      { filename: "wages.csv", datasetId: "ds_1" })));
  check("loop: spec 2's factor dummies did NOT leak into spec 1's design matrix",
    !(outs[0]?.result?.spec?.xVars ?? []).some(v => v.startsWith("region_")),
    ser(outs[0]?.result?.spec?.xVars));
}

console.log(`\nrunEstimation: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
