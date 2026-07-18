// ─── CR2 / CR3 cluster-robust SE — validation vs R clubSandwich ───────────────
// Compares src/core/inference/robustSE.js against clubSandwich::vcovCR().
//
// Benchmarks come from clusterRobustRValidation.R (meta.source records package
// and version). Non-zero diffs are expected — R prints at 12 decimals. A run
// with diff === 0 everywhere would mean the JSON was regenerated from this
// engine instead of from R; see CLAUDE.md on circular benchmarks.
//
// CONVENTION: Litux's "clustered" is Stata's default, G/(G-1)·(n-1)/(n-k), which
// clubSandwich calls CR1S — NOT its plain "CR1" (G/(G-1) only). Comparing against
// the wrong one would show a spurious mismatch.
//
// Node:    node src/math/__validation__/clusterRobustValidation.js
// Browser: window.__validation.clusterRobust()

import { runOLS } from "../LinearEngine.js";

const BENCH_URL = new URL("./clusterRobustBenchmarks.json", import.meta.url);
const TOL = 1e-9;
const EXPECTED_SOURCE = "clubSandwich";

// Litux seType → clubSandwich type
const PAIRS = [["clustered", "CR1S"], ["CR2", "CR2"], ["CR3", "CR3"]];

const parseCSV = (text) => {
  const lines = text.trim().split(/\r?\n/);
  const head = lines[0].split(",").map(h => h.replace(/"/g, "").trim());
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

export async function runClusterRobustValidation() {
  const bench = JSON.parse(await load(BENCH_URL));
  if (!bench.meta?.source?.includes(EXPECTED_SOURCE)) {
    console.warn(`clusterRobust: benchmarks not stamped as ${EXPECTED_SOURCE}-generated ` +
      `(meta.source = ${JSON.stringify(bench.meta?.source)}). Treat as ENGINE_SELF_CHECK.`);
  }

  const results = [];
  const cell = (name, got, exp) => {
    const diff = Math.abs(got - exp);
    return { cell: name, got, expected: exp, diff, tol: TOL, ok: diff < TOL };
  };

  for (const [label, b] of Object.entries(bench)) {
    if (label === "meta") continue;
    const rows = parseCSV(await load(new URL(`./clusterRobustFixture_${label}.csv`, import.meta.url)));
    const xs = Array.from({ length: b.k }, (_, i) => `x${i + 1}`);

    for (const [mine, theirs] of PAIRS) {
      const res = runOLS(rows, "y", xs, { seType: mine, clusterVar: "g" });
      if (!res) { results.push({ cell: `${label}/${mine}`, ok: false, diff: NaN, tol: TOL }); continue; }
      // Point estimates must agree too — a mismatch there would invalidate the SE comparison.
      b.coef.forEach((c, i) => results.push(cell(`${label}/coef${i}`, res.beta[i], c)));
      b[theirs].forEach((s, i) => results.push(cell(`${label}/${mine}/se${i}`, res.se[i], s)));
    }
  }

  const passed = results.filter(r => r.ok).length;
  console.log(`clusterRobust: ${passed}/${results.length} checks pass (source: ${bench.meta?.source ?? "UNKNOWN"})`);
  if (results.every(r => r.diff === 0)) {
    console.warn("clusterRobust: every diff is exactly 0 — benchmarks look engine-generated, not R-generated.");
  }
  const failed = results.filter(r => !r.ok);
  if (failed.length) console.table(failed);
  return results;
}

if (typeof window !== "undefined") {
  window.__validation = window.__validation ?? {};
  window.__validation.clusterRobust = runClusterRobustValidation;
}

// Node entrypoint — pathToFileURL, not string-concatenated "file://" (Windows
// import.meta.url is file:///C:/..., so the hand-built form never matches).
if (typeof window === "undefined" && process.argv[1]) {
  const { pathToFileURL } = await import("node:url");
  if (import.meta.url === pathToFileURL(process.argv[1]).href) {
    const r = await runClusterRobustValidation();
    process.exitCode = r.every(x => x.ok) ? 0 : 1;
  }
}
