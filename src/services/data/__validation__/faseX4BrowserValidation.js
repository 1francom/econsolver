// Fase X4 browser-only measurement helpers. No result is marked validated here.
// Franco runs these against the real 900k-row project in Chrome/Edge.

import { getDuckDB } from "../duckdb.js";

export const FASE_X4_TARGETS = Object.freeze({
  wrangling_to_explore: { p50: 1000, p95: 2000 },
  explore_to_model: { p50: 1000, p95: 2000 },
  model_to_plot_builder: { p50: 1500, p95: 3000 },
  apply_log: { p50: 500, p95: 1000 },
  estimate_ols: { p50: 1500, p95: 3000 },
  estimate_fe: { p50: 2500, p95: 5000 },
  estimate_2sls: { p50: 2000, p95: 4000 },
  export_r_bundle: { p50: 1500, p95: 3000 },
});

const samples = new Map();
const starts = new Map();

function percentile(values, p) {
  if (!values.length) return null;
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.min(sorted.length - 1, Math.ceil(p * sorted.length) - 1)];
}

function record(label, ms) {
  if (!(label in FASE_X4_TARGETS)) throw new Error(`Unknown X4 scenario: ${label}`);
  if (!Number.isFinite(ms) || ms < 0) throw new Error("Timing must be a non-negative number");
  if (!samples.has(label)) samples.set(label, []);
  samples.get(label).push(ms);
  return ms;
}

async function environment() {
  const { conn } = await getDuckDB();
  const result = await conn.query("SELECT current_setting('threads') AS threads");
  const row = result.toArray()[0];
  return {
    crossOriginIsolated: globalThis.crossOriginIsolated === true,
    sharedArrayBuffer: typeof globalThis.SharedArrayBuffer !== "undefined",
    opfs: typeof navigator?.storage?.getDirectory === "function",
    threads: Number(row?.threads ?? 0),
    preciseMemoryInfo: Number.isFinite(performance?.memory?.usedJSHeapSize),
  };
}

async function benchmark(label, fn, { iterations = 20, warmup = 1 } = {}) {
  if (typeof fn !== "function") throw new Error("benchmark requires an async callback");
  for (let i = 0; i < warmup; i++) await fn();
  for (let i = 0; i < iterations; i++) {
    const t0 = performance.now();
    await fn();
    record(label, performance.now() - t0);
  }
  return summary()[label];
}

function start(label) {
  if (!(label in FASE_X4_TARGETS)) throw new Error(`Unknown X4 scenario: ${label}`);
  starts.set(label, performance.now());
}

function stop(label) {
  const t0 = starts.get(label);
  if (t0 == null) throw new Error(`No active timer for ${label}`);
  starts.delete(label);
  return record(label, performance.now() - t0);
}

function summary() {
  return Object.fromEntries(Object.entries(FASE_X4_TARGETS).map(([label, target]) => {
    const values = samples.get(label) ?? [];
    const p50 = percentile(values, 0.50);
    const p95 = percentile(values, 0.95);
    return [label, {
      status: values.length >= 20 ? ((p50 <= target.p50 && p95 <= target.p95) ? "pass" : "fail") : "pending",
      runs: values.length,
      p50,
      p95,
      target,
    }];
  }));
}

async function heapLoop(estimateFn = window.__validation?.faseX4?.estimate, count = 100) {
  if (!Number.isFinite(performance?.memory?.usedJSHeapSize)) {
    throw new Error("Launch Chromium with --enable-precise-memory-info");
  }
  if (typeof estimateFn !== "function") throw new Error("heapLoop requires the real estimate callback");
  const baseline = performance.memory.usedJSHeapSize;
  for (let i = 0; i < count; i++) await estimateFn(i);
  await new Promise(resolve => setTimeout(resolve, 1000));
  const final = performance.memory.usedJSHeapSize;
  const growthBytes = final - baseline;
  return {
    baseline,
    final,
    growthBytes,
    growthMiB: growthBytes / 1024 / 1024,
    pass: growthBytes < 100 * 1024 * 1024,
  };
}

function opfsStatus() {
  const fase9 = window.__validation?.fase9;
  return fase9 ? {
    supported: fase9.opfsSupported,
    cacheHits: fase9.cacheHits,
    cacheMisses: fase9.cacheMisses,
    writeErrors: fase9.writeErrors,
  } : { supported: false, cacheHits: 0, cacheMisses: 0, writeErrors: 0 };
}

function perfLog() {
  return window.__perfLog?.getEntries?.() ?? [];
}

function reset() {
  samples.clear();
  starts.clear();
  window.__perfLog?.clear?.();
}

if (typeof window !== "undefined") {
  if (!window.__validation) window.__validation = {};
  window.__validation.faseX4 = {
    targets: FASE_X4_TARGETS,
    environment,
    benchmark,
    start,
    stop,
    record,
    summary,
    heapLoop,
    opfsStatus,
    perfLog,
    reset,
    estimate: null,
  };
}
