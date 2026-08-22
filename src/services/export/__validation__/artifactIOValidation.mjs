// ─── artifactIO harness ──────────────────────────────────────────────────────
//   node src/services/export/__validation__/artifactIOValidation.mjs

import { buildModelFile, parseModelFile, buildPlotsFile, parsePlotsFile } from "../artifactIO.js";
import { specFormula } from "../../../components/modeling/modelSpec.js";

let pass = 0, fail = 0;
const check = (n, c, extra) => {
  if (c) { pass++; console.log("  [pass]", n); }
  else   { fail++; console.log("  [FAIL]", n, extra != null ? "→ " + extra : ""); }
};
const section = (t) => console.log("\n── " + t + " ──");

// Never let a thrown exception abort the whole harness silently — a throw IS
// a finding (parseModelFile/parsePlotsFile must never throw on untrusted
// input), so surface it as a failed check instead of a crash with no report.
const noThrow = (fn) => { try { fn(); return true; } catch (e) { return "threw: " + e.message; } };

const MODEL_KIND = "litux/model-specs";
const PLOTS_KIND = "litux/plots";

const VOCAB = { modelIds: ["OLS", "FE", "2SLS"], seTypeIds: ["classical", "hc1"],
                families: ["linear", "poisson"] };
const PLOT_VOCAB = { geoms: ["point", "line", "bar"], schemes: ["", "teal-gold", "observable10"] };

const PINS = [
  { id: "m1", label: "Baseline", type: "OLS", spec: { model: "OLS", family: "linear", yVar: "wage", xVars: ["educ"], seType: "hc1" } },
  { id: "m2", label: "With FE",  type: "FE",  spec: { model: "FE",  family: "linear", yVar: "wage", xVars: ["educ"], feCols: ["firm"] } },
];

const PLOTS = [
  { id: "ph_1", name: "Plot 1", savedAt: 1, datasetId: "ds_a", datasetName: "wages",
    layers: [{ id: "L1", geom: "point", aes: { x: "educ", y: "wage" }, visible: true,
      opts: { showValues: true, decimals: 2 }, position: "identity", fill: "#6ec8b4", opacity: 0.9 }],
    title: "T", xLabel: "", yLabel: "", scheme: "teal-gold", xScale: "linear", yScale: "linear",
    facetCol: "", facetCols: 3 },
];

section("model file round-trip");
{
  const file = buildModelFile(PINS);
  check("kind stamped", file.kind === "litux/model-specs", file.kind);
  check("version stamped", file.version === 1);
  check("carries both pins", file.models.length === 2);
  check("carries no result fields", file.models.every(m => !("beta" in m) && !("se" in m) && !("n" in m)));
  const res = parseModelFile(JSON.stringify(file), VOCAB);
  check("parses back clean", res.ok === true, JSON.stringify(res.error));
  check("specs survive", res.models[0].spec.yVar === "wage");
}

section("model file rejects");
{
  check("non-JSON", parseModelFile("{oops", VOCAB).error?.includes("valid JSON"));
  check("wrong kind", parseModelFile(JSON.stringify({ version: 1, kind: "litux/plots", plots: [] }), VOCAB)
    .error?.includes("plots"));
  check("unknown estimator aborts",
    parseModelFile(JSON.stringify({ version: 1, kind: "litux/model-specs",
      models: [{ type: "WARP", spec: {} }] }), VOCAB).error?.includes("WARP"));
  check("unknown seType aborts",
    parseModelFile(JSON.stringify({ version: 1, kind: "litux/model-specs",
      models: [{ type: "OLS", spec: { seType: "bootstrap" } }] }), VOCAB).error?.includes("bootstrap"));
  check("unknown family aborts",
    parseModelFile(JSON.stringify({ version: 1, kind: "litux/model-specs",
      models: [{ type: "OLS", family: "tobit", spec: {} }] }), VOCAB).error?.includes("tobit"));
  check("empty list rejected",
    parseModelFile(JSON.stringify({ version: 1, kind: "litux/model-specs", models: [] }), VOCAB)
      .error?.includes("empty"));
}

section("plots file round-trip");
{
  const file = buildPlotsFile(PLOTS);
  check("kind stamped", file.kind === "litux/plots", file.kind);
  check("session-local identity stripped",
    file.plots.every(p => !("id" in p) && !("savedAt" in p) && !("datasetId" in p) && !("datasetName" in p)),
    JSON.stringify(Object.keys(file.plots[0])));
  check("name kept", file.plots[0].name === "Plot 1");
  const res = parsePlotsFile(JSON.stringify(file), PLOT_VOCAB);
  check("parses back clean", res.ok === true, JSON.stringify(res.error));
  check("layers survive", res.plots[0].layers[0].geom === "point");
}

section("plots file rejects");
{
  check("unknown geom aborts",
    parsePlotsFile(JSON.stringify({ version: 1, kind: "litux/plots",
      plots: [{ name: "x", layers: [{ geom: "hexbin" }] }] }), PLOT_VOCAB).error?.includes("hexbin"));
  check("unknown scheme aborts",
    parsePlotsFile(JSON.stringify({ version: 1, kind: "litux/plots",
      plots: [{ name: "x", layers: [{ geom: "point" }], scheme: "neon" }] }), PLOT_VOCAB)
      .error?.includes("neon"));
  check("plot with no layers rejected",
    parsePlotsFile(JSON.stringify({ version: 1, kind: "litux/plots",
      plots: [{ name: "x", layers: [] }] }), PLOT_VOCAB).error?.includes("layer"));
  check("model file fed to plot parser is named",
    parsePlotsFile(JSON.stringify(buildModelFile(PINS)), PLOT_VOCAB).error?.includes("model"));
}

// ── deny-by-default (highest value) ─────────────────────────────────────────
// The module's best property: an empty or missing vocabulary REJECTS every
// entry rather than admitting it. This is a pin, not a fix — it must stay
// true forever, because "simplify the vocab check" is exactly how this
// repo's `condToSQL` → `default: return "TRUE"` bug got shipped. Negative-
// controlled manually (see report): temporarily changing `!ids.size` to skip
// the check makes every one of these go red.
section("deny-by-default vocabularies (pinned — do not weaken)");
{
  const goodModelFile = JSON.stringify(buildModelFile(PINS));
  check("empty vocab object rejects a well-formed model file",
    parseModelFile(goodModelFile, {}).ok === false);
  check("vocab with explicit empty modelIds array rejects",
    parseModelFile(goodModelFile, { modelIds: [], seTypeIds: [], families: [] }).ok === false);
  check("vocab: null does not throw and rejects (models)",
    noThrow(() => { const r = parseModelFile(goodModelFile, null); if (r.ok !== false) throw new Error("expected ok:false, got ok:true"); }) === true);

  const goodPlotsFile = JSON.stringify(buildPlotsFile(PLOTS));
  check("empty vocab object rejects a well-formed plots file",
    parsePlotsFile(goodPlotsFile, {}).ok === false);
  check("vocab with explicit empty geoms array rejects",
    parsePlotsFile(goodPlotsFile, { geoms: [], schemes: [] }).ok === false);
  check("vocab: null does not throw and rejects (plots)",
    noThrow(() => { const r = parsePlotsFile(goodPlotsFile, null); if (r.ok !== false) throw new Error("expected ok:false, got ok:true"); }) === true);
}

// ── Critical: spec must be a plain object ───────────────────────────────────
section("spec shape (Critical)");
{
  const withSpec = (spec) => JSON.stringify({ version: 1, kind: MODEL_KIND,
    models: [{ label: "Baseline", type: "OLS", spec }] });

  const rNull = parseModelFile(withSpec(null), VOCAB);
  check("spec:null is rejected", rNull.ok === false);
  check("spec:null names the model", rNull.error?.includes("Baseline"), rNull.error);
  check("spec:null says spec is not an object", rNull.error?.includes("spec"), rNull.error);

  check("spec:array is rejected", parseModelFile(withSpec([1, 2, 3]), VOCAB).ok === false);
  check("spec:string is rejected", parseModelFile(withSpec("OLS"), VOCAB).ok === false);
  check("spec:number is rejected", parseModelFile(withSpec(42), VOCAB).ok === false);

  const rMissing = parseModelFile(JSON.stringify({ version: 1, kind: MODEL_KIND,
    models: [{ label: "Baseline", type: "OLS" }] }), VOCAB);
  check("spec omitted entirely still parses (defaults to {})", rMissing.ok === true, rMissing.error);
}

// ── Important: vocab ?? {} ───────────────────────────────────────────────────
section("vocab: null (Important)");
{
  const goodModelFile = JSON.stringify(buildModelFile(PINS));
  check("parseModelFile(text, null) does not throw",
    noThrow(() => parseModelFile(goodModelFile, null)) === true);
  const goodPlotsFile = JSON.stringify(buildPlotsFile(PLOTS));
  check("parsePlotsFile(text, null) does not throw",
    noThrow(() => parsePlotsFile(goodPlotsFile, null)) === true);
}

// ── Important: version ───────────────────────────────────────────────────────
section("version (Important)");
{
  const mFile = (version) => JSON.stringify({ ...(version === undefined ? {} : { version }),
    kind: MODEL_KIND, models: [{ type: "OLS", spec: {} }] });
  check("version absent treated as 1 (ok)", parseModelFile(mFile(undefined), VOCAB).ok === true);
  check("version 1 explicit ok", parseModelFile(mFile(1), VOCAB).ok === true);
  const rNewer = parseModelFile(mFile(2), VOCAB);
  check("version 2 (newer) rejected", rNewer.ok === false);
  check("version 2 message mentions version", rNewer.error?.includes("version"), rNewer.error);
  check("version 'banana' rejected", parseModelFile(mFile("banana"), VOCAB).ok === false);
  check("version 0 rejected", parseModelFile(mFile(0), VOCAB).ok === false);

  const pFile = (version) => JSON.stringify({ ...(version === undefined ? {} : { version }),
    kind: PLOTS_KIND, plots: [{ name: "x", layers: [{ geom: "point" }] }] });
  check("plots: version absent treated as 1 (ok)", parsePlotsFile(pFile(undefined), PLOT_VOCAB).ok === true);
  check("plots: version 2 (newer) rejected", parsePlotsFile(pFile(2), PLOT_VOCAB).ok === false);
  check("plots: version 'banana' rejected", parsePlotsFile(pFile("banana"), PLOT_VOCAB).ok === false);
}

// ── Important: __proto__ / constructor / prototype stripped ─────────────────
section("prototype-pollution keys stripped (Important)");
{
  // Built by hand (not via object literal) so the JSON text itself carries a
  // literal "__proto__" key — `{__proto__: x}` in JS source sets the
  // PROTOTYPE, not an own key, so that shortcut can't produce this fixture.
  const evilModelJSON = '{"version":1,"kind":"litux/model-specs","models":[{"type":"OLS","spec":{"yVar":"wage","__proto__":{"polluted":true},"constructor":{"x":1},"prototype":{"y":2}}}]}';
  const rEvil = parseModelFile(evilModelJSON, VOCAB);
  check("evil spec still parses (well-shaped otherwise)", rEvil.ok === true, rEvil.error);
  check("__proto__ stripped from spec",
    rEvil.ok && !Object.prototype.hasOwnProperty.call(rEvil.models[0].spec, "__proto__"));
  check("constructor stripped from spec",
    rEvil.ok && !Object.prototype.hasOwnProperty.call(rEvil.models[0].spec, "constructor"));
  check("prototype stripped from spec",
    rEvil.ok && !Object.prototype.hasOwnProperty.call(rEvil.models[0].spec, "prototype"));
  check("spec content otherwise intact", rEvil.ok && rEvil.models[0].spec.yVar === "wage");
  check("no actual Object.prototype pollution occurred", Object.prototype.polluted === undefined);

  const evilPlotsJSON = '{"version":1,"kind":"litux/plots","plots":[{"name":"x","layers":[{"geom":"point","opts":{"__proto__":{"polluted2":true}}}]}]}';
  const rEvilP = parsePlotsFile(evilPlotsJSON, PLOT_VOCAB);
  check("evil plot still parses (well-shaped otherwise)", rEvilP.ok === true, rEvilP.error);
  check("__proto__ stripped from nested layer.opts",
    rEvilP.ok && !Object.prototype.hasOwnProperty.call(rEvilP.plots[0].layers[0].opts, "__proto__"));
  check("no actual Object.prototype pollution occurred (plots)", Object.prototype.polluted2 === undefined);
}

// ── Important: buildPlotsFile strips recursively ─────────────────────────────
section("buildPlotsFile recursive stripping (Important)");
{
  const dirty = {
    id: "ph_x", savedAt: 1, datasetId: "ds_top", datasetName: "top secret filename.csv",
    name: "P",
    layers: [{ id: "L1", geom: "point", datasetId: "ds_layer", datasetName: "layer.csv",
      meta: { datasetId: "ds_meta", datasetName: "meta.csv" } }],
  };
  const built = buildPlotsFile([dirty]);
  const json = JSON.stringify(built);
  check("top-level datasetId/datasetName gone", !("datasetId" in built.plots[0]) && !("datasetName" in built.plots[0]));
  check("nested layer datasetId/datasetName gone from serialized output",
    !json.includes("ds_layer") && !json.includes("layer.csv"));
  check("deeply nested meta.datasetId/datasetName gone from serialized output",
    !json.includes("ds_meta") && !json.includes("meta.csv"));
  check("top-level identity (ds_top / filename) not present anywhere in output",
    !json.includes("ds_top") && !json.includes("top secret filename.csv"));
  check("layer's own local id survives (not session identity)", built.plots[0].layers[0].id === "L1");
  check("geom survives", built.plots[0].layers[0].geom === "point");
}

// ── Important: error messages capped + sanitised ─────────────────────────────
section("error messages capped + sanitised (Important)");
{
  const manyBadModels = Array.from({ length: 500 }, (_, i) => ({ type: `WARP${i}`, spec: {} }));
  const bigFile = JSON.stringify({ version: 1, kind: MODEL_KIND, models: manyBadModels });
  const rBig = parseModelFile(bigFile, VOCAB);
  check("500 unknown ids: rejected", rBig.ok === false);
  check("500 unknown ids: message capped well under raw size", rBig.error.length < 1000, rBig.error.length);
  check("500 unknown ids: message says how many more", rBig.error.includes("more"), rBig.error);

  const evilKindFile = JSON.stringify({ version: 1, kind: MODEL_KIND,
    models: [{ type: '<img src=x onerror=alert(1)>', spec: {} }] });
  const rXSS = parseModelFile(evilKindFile, VOCAB);
  check("hostile id is not echoed as a raw tag", !rXSS.error.includes("<img"), rXSS.error);

  const longId = "X".repeat(500);
  const rLong = parseModelFile(JSON.stringify({ version: 1, kind: MODEL_KIND,
    models: [{ type: longId, spec: {} }] }), VOCAB);
  check("a single very long id is truncated", rLong.error.length < 200, rLong.error.length);
}

// ── Message quality: bad-shape vs unknown-value ──────────────────────────────
section("message quality (bad-shape vs unknown-value)");
{
  const rShapeType = parseModelFile(JSON.stringify({ version: 1, kind: MODEL_KIND,
    models: [{ type: ["OLS"], spec: {} }] }), VOCAB);
  check("array-shaped type is rejected", rShapeType.ok === false);
  check("array-shaped type is NOT reported as 'Unknown estimator: OLS'",
    !rShapeType.error.includes("Unknown estimator: OLS"), rShapeType.error);
  check("array-shaped type names the shape problem", rShapeType.error.includes("string"), rShapeType.error);

  const rNullLayer = parsePlotsFile(JSON.stringify({ version: 1, kind: PLOTS_KIND,
    plots: [{ name: "x", layers: [null] }] }), PLOT_VOCAB);
  check("null layer is rejected", rNullLayer.ok === false);
  check("null layer is NOT reported as 'Unknown geom: undefined'",
    !rNullLayer.error.includes("Unknown geom: undefined"), rNullLayer.error);

  // Entry naming: the failing model is identified by label, not just by value.
  const rNamed = parseModelFile(JSON.stringify({ version: 1, kind: MODEL_KIND,
    models: [
      { label: "Good", type: "OLS", spec: {} },
      { label: "BadOne", type: "OLS", spec: null },
    ] }), VOCAB);
  check("entry naming: failing model's label appears in the error", rNamed.error?.includes("BadOne"), rNamed.error);

  // All failing categories reported, not just the first hit.
  const rMulti = parseModelFile(JSON.stringify({ version: 1, kind: MODEL_KIND,
    models: [{ type: "WARP", spec: { seType: "bootstrap" } }] }), VOCAB);
  check("multi-category: unknown estimator AND unknown seType both reported",
    rMulti.error?.includes("WARP") && rMulti.error?.includes("bootstrap"), rMulti.error);
}

// ── Harness gaps ──────────────────────────────────────────────────────────────
section("harness gaps: non-string / non-object input");
{
  check("parseModelFile(42, VOCAB) does not throw", noThrow(() => parseModelFile(42, VOCAB)) === true);
  check("parseModelFile(42, VOCAB) rejects", parseModelFile(42, VOCAB).ok === false);
  check("parseModelFile(null, VOCAB) does not throw", noThrow(() => parseModelFile(null, VOCAB)) === true);
  check("parseModelFile(undefined, VOCAB) does not throw", noThrow(() => parseModelFile(undefined, VOCAB)) === true);
  check("parseModelFile({}, VOCAB) [object passed instead of text] does not throw",
    noThrow(() => parseModelFile({}, VOCAB)) === true);

  check("parsePlotsFile with non-JSON text is rejected cleanly",
    parsePlotsFile("{not json", PLOT_VOCAB).error?.includes("valid JSON"));
  check("parsePlotsFile(42, VOCAB) does not throw", noThrow(() => parsePlotsFile(42, PLOT_VOCAB)) === true);

  check("models: [null] rejected, not thrown",
    (() => { const r = parseModelFile(JSON.stringify({ version: 1, kind: MODEL_KIND, models: [null] }), VOCAB);
      return r.ok === false; })());
  check("models: [42] rejected, not thrown",
    (() => { const r = parseModelFile(JSON.stringify({ version: 1, kind: MODEL_KIND, models: [42] }), VOCAB);
      return r.ok === false; })());
  check("plots: [null] rejected, not thrown",
    (() => { const r = parsePlotsFile(JSON.stringify({ version: 1, kind: PLOTS_KIND, plots: [null] }), PLOT_VOCAB);
      return r.ok === false; })());
  check("plots: [42] rejected, not thrown",
    (() => { const r = parsePlotsFile(JSON.stringify({ version: 1, kind: PLOTS_KIND, plots: [42] }), PLOT_VOCAB);
      return r.ok === false; })());
}

section("harness gaps: parse → specFormula handoff");
{
  // Ties back to b707eea4 (specFormula surviving a malformed spec): a spec
  // that PASSES parseModelFile's shape check (a real object) but carries a
  // duck-typed array-like field must still not throw when specFormula reads it.
  const duckTyped = { version: 1, kind: MODEL_KIND, models: [{ type: "OLS",
    spec: { yVar: "wage", xVarsRaw: { length: 2, 0: "a", 1: "b" } } }] };
  const rDuck = parseModelFile(JSON.stringify(duckTyped), VOCAB);
  check("duck-typed xVarsRaw still parses (shape check only cares spec IS an object)", rDuck.ok === true, rDuck.error);
  check("specFormula does not throw on the parsed spec",
    noThrow(() => specFormula(rDuck.models[0].spec)) === true);
  check("specFormula returns a string", typeof specFormula(rDuck.models[0].spec) === "string");

  // And the normal, well-shaped case still produces the expected formula.
  const rGood = parseModelFile(JSON.stringify(buildModelFile(PINS)), VOCAB);
  check("specFormula on a clean round-tripped spec", specFormula(rGood.models[0].spec).includes("wage"));
}

section("harness gaps: deep round-trip equality");
{
  const built = buildPlotsFile(PLOTS);
  const res = parsePlotsFile(JSON.stringify(built), PLOT_VOCAB);
  check("round-trip: title survives", res.plots[0].title === "T");
  check("round-trip: scheme survives", res.plots[0].scheme === "teal-gold");
  check("round-trip: facetCols survives", res.plots[0].facetCols === 3);
  check("round-trip: layer aes survives", res.plots[0].layers[0].aes.x === "educ" && res.plots[0].layers[0].aes.y === "wage");
  check("round-trip: layer opts survives", res.plots[0].layers[0].opts.showValues === true && res.plots[0].layers[0].opts.decimals === 2);
  check("round-trip: layer position/fill/opacity survive",
    res.plots[0].layers[0].position === "identity" && res.plots[0].layers[0].fill === "#6ec8b4" && res.plots[0].layers[0].opacity === 0.9);
  check("round-trip: stripped fields stay gone", !("datasetId" in res.plots[0]) && !("id" in res.plots[0]) && !("savedAt" in res.plots[0]));
}

section("harness gaps: build-side robustness");
{
  check("buildModelFile(null) does not throw and yields an empty models list",
    noThrow(() => { const f = buildModelFile(null); if (!Array.isArray(f.models) || f.models.length !== 0) throw new Error("expected empty models[]"); }) === true);
  check("buildPlotsFile(null) does not throw and yields an empty plots list",
    noThrow(() => { const f = buildPlotsFile(null); if (!Array.isArray(f.plots) || f.plots.length !== 0) throw new Error("expected empty plots[]"); }) === true);
  check("buildModelFile(undefined) still works (default param path)",
    noThrow(() => buildModelFile(undefined)) === true);
}

console.log(`\nartifactIO: ${pass} passed, ${fail} failed`);
if (fail > 0) process.exit(1);
