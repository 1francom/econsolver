// ─── artifactIO harness ──────────────────────────────────────────────────────
//   node src/services/export/__validation__/artifactIOValidation.mjs

import { buildModelFile, parseModelFile, buildPlotsFile, parsePlotsFile } from "../artifactIO.js";

let pass = 0, fail = 0;
const check = (n, c, extra) => {
  if (c) { pass++; console.log("  [pass]", n); }
  else   { fail++; console.log("  [FAIL]", n, extra != null ? "→ " + extra : ""); }
};
const section = (t) => console.log("\n── " + t + " ──");

const VOCAB = { modelIds: ["OLS", "FE", "2SLS"], seTypeIds: ["classical", "hc1"],
                families: ["linear", "poisson"] };
const PLOT_VOCAB = { geoms: ["point", "line", "bar"], schemes: ["", "teal-gold", "observable10"] };

const PINS = [
  { id: "m1", label: "Baseline", type: "OLS", spec: { model: "OLS", family: "linear", yVar: "wage", xVars: ["educ"], seType: "hc1" } },
  { id: "m2", label: "With FE",  type: "FE",  spec: { model: "FE",  family: "linear", yVar: "wage", xVars: ["educ"], feCols: ["firm"] } },
];

const PLOTS = [
  { id: "ph_1", name: "Plot 1", savedAt: 1, datasetId: "ds_a", datasetName: "wages",
    layers: [{ id: "L1", geom: "point", aes: { x: "educ", y: "wage" }, visible: true }],
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

console.log(`\nartifactIO: ${pass} passed, ${fail} failed`);
if (fail > 0) process.exit(1);
