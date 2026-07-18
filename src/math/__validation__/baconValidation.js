// ─── Goodman-Bacon decomposition — validation vs R bacondecomp ────────────────
// Compares src/math/did/baconDecomp.js against bacondecomp::bacon() row by row:
// every 2x2 must match on type, treated/control pair, weight and estimate.
//
// Benchmarks come from baconRValidation.R (meta.source records the R package and
// version). Non-zero diffs are EXPECTED and healthy — they come from R printing
// at 12 decimals. A run reporting diff === 0 on every cell would mean the JSON
// was regenerated from this engine rather than from R; see CLAUDE.md on circular
// benchmarks.
//
// Node:    node src/math/__validation__/baconValidation.js
// Browser: window.__validation.bacon()

import { runBaconDecomposition } from "../did/baconDecomp.js";

const BENCH_URL = new URL("./baconBenchmarks.json", import.meta.url);
const TOL_WEIGHT = 1e-8;
const TOL_EST    = 1e-6;
const EXPECTED_SOURCE = "bacondecomp";

const parseCSV = (text) => {
  const lines = text.trim().split(/\r?\n/);
  const head  = lines[0].split(",").map(h => h.replace(/"/g, "").trim());
  return lines.slice(1).map(l => {
    const v = l.split(",");
    const o = {};
    head.forEach((k, i) => { o[k] = Number(v[i]); });
    return o;
  });
};

async function load(url) {
  if (typeof window === "undefined") {
    const { readFile } = await import("node:fs/promises");
    return readFile(url, "utf8");
  }
  return (await fetch(url)).text();
}

export async function runBaconValidation() {
  const bench = JSON.parse(await load(BENCH_URL));

  // Guard against circular benchmarks: refuse to report a pass if the JSON was
  // not actually produced by R.
  if (!bench.meta?.source?.includes(EXPECTED_SOURCE)) {
    console.warn(`bacon: benchmarks are not stamped as ${EXPECTED_SOURCE}-generated ` +
      `(meta.source = ${JSON.stringify(bench.meta?.source)}). Treat as ENGINE_SELF_CHECK, not R-validated.`);
  }

  const results = [];
  const cell = (name, got, exp, tol) => {
    const diff = Math.abs(got - exp);
    return { cell: name, got, expected: exp, diff, tol, ok: diff < tol };
  };

  for (const [scenario, b] of Object.entries(bench)) {
    if (scenario === "meta") continue;

    const csvUrl = new URL(`./baconFixture_${scenario}.csv`, import.meta.url);
    const rows   = parseCSV(await load(csvUrl));
    const mine   = runBaconDecomposition(rows, "outcome", "person_id", "time_id", "treated");

    // The decomposition must reproduce the TWFE coefficient R reported.
    results.push(cell(`${scenario}/weightedSum`, mine.weightedSum, b.twfe, TOL_EST));
    results.push(cell(`${scenario}/nComparisons`, mine.comparisons.length, b.comparisons.length, 0.5));

    for (const r of b.comparisons) {
      const key = `${r.type} ${r.treated}v${r.control ?? "never"}`;
      const m = mine.comparisons.find(c =>
        c.type === r.type &&
        String(c.treated) === String(r.treated) &&
        String(c.control ?? "null") === String(r.control ?? "null"));
      if (!m) {
        results.push({ cell: `${scenario}/${key}`, got: null, expected: r.estimate, diff: NaN, tol: TOL_EST, ok: false });
        continue;
      }
      results.push(cell(`${scenario}/${key}/w`, m.weight,   r.weight,   TOL_WEIGHT));
      results.push(cell(`${scenario}/${key}/b`, m.estimate, r.estimate, TOL_EST));
    }
  }

  const passed = results.filter(r => r.ok).length;
  const allZero = results.every(r => r.diff === 0);
  console.log(`bacon: ${passed}/${results.length} checks pass (source: ${bench.meta?.source ?? "UNKNOWN"})`);
  if (allZero) console.warn("bacon: every diff is exactly 0 — benchmarks look engine-generated, not R-generated.");
  const failed = results.filter(r => !r.ok);
  if (failed.length) console.table(failed);
  return results;
}

if (typeof window !== "undefined") {
  window.__validation = window.__validation ?? {};
  window.__validation.bacon = runBaconValidation;
}

// Node entrypoint. Build the comparison URL with pathToFileURL rather than
// string-concatenating "file://" — on Windows import.meta.url is file:///C:/...
// (three slashes) and a hand-built file://C:/... never matches, so the harness
// would exit 0 having run nothing.
if (typeof window === "undefined" && process.argv[1]) {
  const { pathToFileURL } = await import("node:url");
  if (import.meta.url === pathToFileURL(process.argv[1]).href) {
    const r = await runBaconValidation();
    process.exitCode = r.every(x => x.ok) ? 0 : 1;
  }
}
