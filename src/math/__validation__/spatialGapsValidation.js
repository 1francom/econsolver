import {
  arealInterpolate,
  buildSpatialWeights,
  countBuffersIntersectingGrid,
  gearyC,
  gridExposureShare,
  localMoran,
  moranI,
  polygonArea,
  polygonCentroid,
  polygonOverlapWeights,
} from "../SpatialEngine.js";

const BENCH_URL = new URL("./spatialGapsBenchmarks.json", import.meta.url);
const TOL_AREA = 1e-6;
const TOL_STAT = 1e-4;

const A = "POLYGON((500000 6000000,500010 6000000,500010 6000010,500000 6000010,500000 6000000))";
const B = "POLYGON((500010 6000000,500020 6000000,500020 6000010,500010 6000010,500010 6000000))";
const TARGET = "POLYGON((500005 6000000,500015 6000000,500015 6000010,500005 6000010,500005 6000000))";
const DONUT = "POLYGON((500000 6000000,500010 6000000,500010 6000010,500000 6000010,500000 6000000),(500002 6000002,500008 6000002,500008 6000008,500002 6000008,500002 6000002))";
const BUF1 = "POLYGON((500000 6000000,500006 6000000,500006 6000010,500000 6000010,500000 6000000))";
const BUF2 = "POLYGON((500004 6000000,500010 6000000,500010 6000010,500004 6000010,500004 6000000))";

async function loadBench() {
  if (typeof window === "undefined") {
    const { readFile } = await import("node:fs/promises");
    return JSON.parse(await readFile(BENCH_URL, "utf8"));
  }
  return fetch(BENCH_URL).then(r => r.json());
}

function cell(name, got, want, tol) {
  const diff = Math.abs(got - want);
  return { cell: name, ok: diff <= tol, got, want, diff, tol };
}

export async function runSpatialGapsValidation() {
  const bench = await loadBench();
  const results = [];

  results.push(cell("area_square", polygonArea(A), bench.area.square, TOL_AREA));
  results.push(cell("area_donut_hole", polygonArea(DONUT), bench.area.donut, TOL_AREA));

  const overlap = polygonOverlapWeights([{ geom: A }], "geom", [{ id: "t1", geom: TARGET }], "geom", "id")[0];
  results.push(cell("overlap_area", overlap.area_intersect, bench.overlap.area_intersect, TOL_AREA));
  results.push(cell("overlap_weight", overlap.weight, bench.overlap.weight, TOL_AREA));

  const source = [{ geom: A, pop: 100 }, { geom: B, pop: 50 }];
  const target = [{ id: "t1", geom: TARGET }];
  const awExt = arealInterpolate(source, "geom", target, "geom", "id", ["pop"], { outPrefix: "aw", extensive: true })[0];
  const awInt = arealInterpolate(source, "geom", target, "geom", "id", ["pop"], { outPrefix: "aw", extensive: false })[0];
  results.push(cell("areal_extensive", awExt.aw_pop, bench.areal.extensive, TOL_STAT));
  results.push(cell("areal_intensive", awInt.aw_pop, bench.areal.intensive, TOL_STAT));

  const grid = [{ id: "g1", geom: A }];
  const dissolved = `MULTIPOLYGON(((${BUF1.match(/\(\((.*)\)\)/)[1]})),((${BUF2.match(/\(\((.*)\)\)/)[1]})))`;
  const exposure = gridExposureShare(grid, "geom", "id", dissolved)[0];
  const counts = countBuffersIntersectingGrid(grid, "geom", "id", [{ geom: BUF1 }, { geom: BUF2 }], "geom", { outCol: "n" })[0];
  results.push(cell("exposure_share", exposure.exposure_share, bench.exposure.share, TOL_STAT));
  results.push(cell("exposure_area", exposure.exposure_share_area_m2, bench.exposure.area, TOL_AREA));
  results.push(cell("buffer_count", counts.n, bench.exposure.count, 0));

  const cent = polygonCentroid([{ geom: A }], "geom")[0];
  results.push(cell("centroid_x", cent.centroid_x, bench.centroid.x, TOL_AREA));
  results.push(cell("centroid_y", cent.centroid_y, bench.centroid.y, TOL_AREA));

  const W = buildSpatialWeights([{ geom: A }, { geom: B }], "geom", { type: "rook", style: "W" });
  results.push(cell("weights_links", W.summary.links, bench.weights.links, 0));
  results.push(cell("weights_avg_neighbors", W.summary.avgNeighbors, bench.weights.avgNeighbors, TOL_STAT));
  results.push(cell("weights_islands", W.summary.islands, bench.weights.islands, 0));
  results.push(cell("moranI", moranI([1, 3], W).I, bench.weights.moranI, TOL_STAT));
  results.push(cell("gearyC", gearyC([1, 3], W).C, bench.weights.gearyC, TOL_STAT));
  localMoran([1, 3], W).forEach((r, i) => results.push(cell(`localMoran_${i}`, r.Ii, bench.weights.localMoran[i], TOL_STAT)));

  const passed = results.filter(r => r.ok).length;
  console.log(`spatialGaps: ${passed}/${results.length} checks pass`);
  console.table(results.map(r => ({ cell: r.cell, ok: r.ok, diff: r.diff, tol: r.tol })));
  return results;
}

if (typeof window !== "undefined") {
  window.__validation = window.__validation ?? {};
  window.__validation.spatialGaps = runSpatialGapsValidation;
}
