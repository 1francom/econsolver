import { kde2d } from "../SpatialEngine.js";
import { buildColorScale } from "../../components/tabs/spatial/shared/color.js";

const BENCH_URL = new URL("./descriptiveVizBenchmarks.json", import.meta.url);
const TOL_KDE = 5e-11;
const TOL_COORD = 1e-6;

const POINTS = [
  { lat: -34.6, lon: -58.4 },
  { lat: -34.601, lon: -58.401 },
  { lat: -34.602, lon: -58.399 },
];

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

export async function runDescriptiveVizValidation() {
  const bench = await loadBench();
  const results = [];

  const kde = kde2d(POINTS, "lat", "lon", { bandwidth: bench.kde2d.bandwidth, gridN: 3, pad: 0 });
  kde.rows.forEach((row, i) => {
    results.push(cell(`kde_density_${i}`, row.density, bench.kde2d.densities[i], TOL_KDE));
    results.push(cell(`kde_lon_${i}`, Number(row.lon.toFixed(6)), bench.kde2d.coords[i][0], TOL_COORD));
    results.push(cell(`kde_lat_${i}`, Number(row.lat.toFixed(6)), bench.kde2d.coords[i][1], TOL_COORD));
  });

  const numeric = buildColorScale([{ v: 1 }, { v: 2 }, { v: 3 }], "v").legend;
  results.push({ cell: "color_numeric_type", ok: numeric.type === bench.colorScale.numeric.type, got: numeric.type, want: bench.colorScale.numeric.type, diff: 0, tol: 0 });
  results.push({ cell: "color_numeric_values", ok: JSON.stringify(numeric.values) === JSON.stringify(bench.colorScale.numeric.values), got: numeric.values, want: bench.colorScale.numeric.values, diff: 0, tol: 0 });

  const categorical = buildColorScale([{ g: "north" }, { g: "south" }, { g: "north" }], "g").legend;
  results.push({ cell: "color_categorical_type", ok: categorical.type === bench.colorScale.categorical.type, got: categorical.type, want: bench.colorScale.categorical.type, diff: 0, tol: 0 });
  results.push({ cell: "color_categorical_cats", ok: JSON.stringify(categorical.cats) === JSON.stringify(bench.colorScale.categorical.cats), got: categorical.cats, want: bench.colorScale.categorical.cats, diff: 0, tol: 0 });

  const passed = results.filter(r => r.ok).length;
  console.log(`descriptiveViz: ${passed}/${results.length} checks pass`);
  console.table(results.map(r => ({ cell: r.cell, ok: r.ok, diff: r.diff, tol: r.tol })));
  return results;
}

if (typeof window !== "undefined") {
  window.__validation = window.__validation ?? {};
  window.__validation.descriptiveViz = runDescriptiveVizValidation;
}
