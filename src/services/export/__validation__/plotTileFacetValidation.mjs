// ─── geom_tile + facet_wrap replication harness ──────────────────────────────
// `node src/services/export/__validation__/plotTileFacetValidation.mjs`
//
// Covers the two PlotBuilder features that have no prior export coverage:
//   1. the `tile` geom (ggplot geom_tile / seaborn heatmap / no base Stata)
//   2. plot-level facet_wrap (ggplot facet_wrap / matplotlib subplot grid /
//      Stata by())
//
// The tile fill ramp lives in THREE places — TILE_SCHEMES in PlotBuilder.jsx,
// TILE_FILL_SCALES and TILE_CMAPS in plotScript.js. A scheme added to only one
// of them renders in the app and then quietly loses its palette on export, so
// the first block reads the component as text and asserts all three agree.

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

import { buildGgplot, buildMatplotlibPlot, buildStataPlot } from "../plotScript.js";

const HERE = dirname(fileURLToPath(import.meta.url));
const PLOT_BUILDER = resolve(HERE, "../../../components/PlotBuilder.jsx");
const PLOT_SCRIPT  = resolve(HERE, "../plotScript.js");

let pass = 0, fail = 0;
const check = (n, c, extra) => {
  if (c) { pass++; console.log("  [pass]", n); }
  else   { fail++; console.log("  [FAIL]", n, extra != null ? "→ " + extra : ""); }
};
const GARBAGE = /undefined|\[object Object\]|NaN/;

// Pull the id list out of a source file's object/array literal block.
function idsIn(source, blockRe, idRe) {
  const block = source.match(blockRe);
  if (!block) return null;
  return [...block[1].matchAll(idRe)].map(m => m[1]).sort();
}

const tile = (over = {}) => ({
  id: "ly_tile", geom: "tile", visible: true, opacity: 1, fill: "#6ec8b4",
  aes: { x: "fe_quintile", y: "year", color: "resid" },
  opts: { scheme: "viridis", showValues: false, decimals: 2 },
  ...over,
});
const point = () => ({
  id: "ly_pt", geom: "point", visible: true, opacity: 1, fill: "#6ec8b4",
  aes: { x: "x", y: "y", color: "" }, opts: { size: 3, shape: "circle" }, position: "identity",
});

console.log("── tile scheme tables agree across component and exporter ──");
{
  const jsx = readFileSync(PLOT_BUILDER, "utf8");
  const js  = readFileSync(PLOT_SCRIPT, "utf8");

  const uiIds = idsIn(jsx, /const TILE_SCHEMES = \[([\s\S]*?)\n\];/, /\{\s*id:\s*"([a-z]+)"/g);
  const rIds  = idsIn(js,  /const TILE_FILL_SCALES = \{([\s\S]*?)\n\};/, /^\s{2}([a-z]+):/gm);
  const pyIds = idsIn(js,  /const TILE_CMAPS = \{([\s\S]*?)\n\};/,       /^\s{2}([a-z]+):/gm);

  check("TILE_SCHEMES parsed from PlotBuilder.jsx", Array.isArray(uiIds) && uiIds.length > 0, JSON.stringify(uiIds));
  check("TILE_FILL_SCALES parsed from plotScript.js", Array.isArray(rIds) && rIds.length > 0, JSON.stringify(rIds));
  check("TILE_CMAPS parsed from plotScript.js", Array.isArray(pyIds) && pyIds.length > 0, JSON.stringify(pyIds));
  check("UI schemes == R scale table", JSON.stringify(uiIds) === JSON.stringify(rIds), `${JSON.stringify(uiIds)} vs ${JSON.stringify(rIds)}`);
  check("UI schemes == Python cmap table", JSON.stringify(uiIds) === JSON.stringify(pyIds), `${JSON.stringify(uiIds)} vs ${JSON.stringify(pyIds)}`);

  // Every scheme must actually reach the generated R, not just exist in a table.
  for (const id of uiIds ?? []) {
    const r = buildGgplot({ layers: [tile({ opts: { scheme: id, showValues: false, decimals: 2 } })] });
    check(`R emits a fill scale for "${id}"`, /scale_fill_(viridis_c|distiller|gradient2)\(/.test(r), r.split("\n").find(l => l.includes("scale_fill")) ?? "none");
  }
}

console.log("\n── tile → R ──");
{
  const r = buildGgplot({ layers: [tile()] });
  check("emits geom_tile", /geom_tile\(/.test(r));
  check("maps the value column to fill", /fill = resid/.test(r));
  // The bug this guards: aesCall's default branch also emits `color = <col>`,
  // which would outline each tile by its own value.
  check("does NOT map it to color as well", !/color = resid/.test(r), r.split("\n").find(l => l.includes("geom_tile")));
  check("no garbage", !GARBAGE.test(r), r.split("\n").find(l => GARBAGE.test(l)));
}
{
  const r = buildGgplot({ layers: [tile({ opts: { scheme: "rdbu", showValues: true, decimals: 3 } })] });
  check("diverging scheme pivots at 0", /midpoint = 0/.test(r));
  check("showValues emits geom_text", /geom_text\(/.test(r));
  check("decimals reach round()", /round\(resid, 3\)/.test(r));
}
{
  // One fill scale per ggplot: the tile ramp must displace the brewer fill.
  const r = buildGgplot({
    layers: [tile(), { ...point(), geom: "bar", aes: { x: "g", y: "v", color: "g" } }],
    scheme: "dark2",
  });
  check("tile scale suppresses scale_fill_brewer", !/scale_fill_brewer/.test(r), r.split("\n").filter(l => l.includes("scale_")).join(" | "));
  check("categorical scale_color_brewer survives", /scale_color_brewer/.test(r));
}

console.log("\n── tile → Python ──");
{
  const py = buildMatplotlibPlot({ layers: [tile({ opts: { scheme: "rdbu", showValues: true, decimals: 1 } })] });
  check("pivots before heatmap", /pivot_table\(index="year", columns="fe_quintile", values="resid"/.test(py));
  check("restores ggplot y orientation", /sort_index\(ascending=False\)/.test(py));
  check("diverging cmap centres at 0", /center=0/.test(py) && /cmap="RdBu"/.test(py));
  check("annotates with the chosen precision", /annot=True/.test(py) && /fmt="\.1f"/.test(py));
  check("imports seaborn", /^import seaborn as sns$/m.test(py));
  check("no garbage", !GARBAGE.test(py), py.split("\n").find(l => GARBAGE.test(l)));
}

console.log("\n── tile → Stata (honest no-support note) ──");
{
  const st = buildStataPlot({ layers: [tile()] });
  check("names the missing capability", /no base-Stata equivalent/.test(st));
  check("gives the install line", /ssc install heatplot/.test(st));
  check("does not fabricate a twoway command", !/^twoway/m.test(st), st.split("\n").find(l => l.startsWith("twoway")));
  check("no garbage", !GARBAGE.test(st), st.split("\n").find(l => GARBAGE.test(l)));
}

console.log("\n── facet_wrap → R ──");
{
  const r = buildGgplot({ layers: [point()], facetCol: "scenario", facetCols: 3 });
  check("emits facet_wrap", /facet_wrap\(~ scenario, ncol = 3\)/.test(r));
}
{
  const r = buildGgplot({ layers: [point()], facetCol: "my col", facetCols: 99 });
  check("non-syntactic name is backticked", /facet_wrap\(~ `my col`/.test(r));
  check("ncol clamped to 12", /ncol = 12\)/.test(r));
}
{
  const r = buildGgplot({ layers: [point()] });
  check("no facet_wrap when unset", !/facet_wrap/.test(r));
}

console.log("\n── facet_wrap → Python subplot grid ──");
{
  const py = buildMatplotlibPlot({ layers: [point()], facetCol: "scenario", facetCols: 2, title: "T", xLabel: "X", yLabel: "Y" });
  check("derives the level list", /_levels = sorted\(df\["scenario"\]\.dropna\(\)\.unique\(\)\)/.test(py));
  check("builds a grid, not a single ax", /plt\.subplots\(_nrow, _ncol/.test(py) && /squeeze=False/.test(py));
  check("filters a per-panel frame", /_d = df\[df\["scenario"\] == _level\]/.test(py));
  // The whole point of the restructure: layer calls must read the panel frame,
  // never the full one, or every panel would draw identical whole-sample data.
  check("layer draws from the panel frame", /ax\.scatter\(_d\["x"\], _d\["y"\]/.test(py), py.split("\n").find(l => l.includes("scatter")));
  check("layer lines are indented into the loop", /\n {4}ax\.scatter\(/.test(py));
  check("unused grid cells are hidden", /_axes\.flat\[_j\]\.axis\("off"\)/.test(py));
  check("shared labels use fig.sup*", /fig\.suptitle\("T"\)/.test(py) && /fig\.supxlabel\("X"\)/.test(py) && /fig\.supylabel\("Y"\)/.test(py));
  check("no per-ax title left over", !/^ax\.set_title/m.test(py));
  check("no garbage", !GARBAGE.test(py), py.split("\n").find(l => GARBAGE.test(l)));
}
{
  // Non-faceted output must be untouched by the restructure.
  const py = buildMatplotlibPlot({ layers: [point()], title: "T" });
  check("unfaceted still uses a single ax", /^fig, ax = plt\.subplots\(\)$/m.test(py));
  check("unfaceted draws from df", /ax\.scatter\(df\["x"\], df\["y"\]/.test(py));
  check("unfaceted keeps ax.set_title", /ax\.set_title\("T"\)/.test(py));
}
{
  // Per-panel stats: a loess smooth must be fit inside the loop on _d, matching
  // facet_wrap's semantics (and the app's per-panel recompute).
  const py = buildMatplotlibPlot({
    layers: [{ id: "s", geom: "smooth", visible: true, opacity: 1, fill: "#6ec8b4",
               aes: { x: "x", y: "y", color: "" }, opts: { method: "loess", span: 0.75 } }],
    facetCol: "g", facetCols: 2,
  });
  check("smooth fits per panel", /\n {4}sns\.regplot\(data=_d/.test(py), py.split("\n").find(l => l.includes("regplot")));
}

console.log("\n── facet_wrap → Stata by() ──");
{
  const st = buildStataPlot({ layers: [point()], facetCol: "scenario", facetCols: 2 });
  check("emits by() with cols()", /by\(scenario, cols\(2\)\)/.test(st));
  check("attached to the twoway command", /^twoway .*by\(scenario/m.test(st));
}
{
  const st = buildStataPlot({ layers: [point()] });
  check("no by() when unset", !/by\(/.test(st));
}

console.log(`\nplotTileFacet: ${pass} passed, ${fail} failed`);
if (fail > 0) process.exit(1);
