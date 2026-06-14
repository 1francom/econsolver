// Fase X4 - Node validation for headers and suffStatsCache memory ceiling.
// Run: node src/services/data/__validation__/faseX4PerformanceValidation.mjs

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { createSuffStatsCache } from "../suffStatsCache.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = join(__dirname, "..", "..", "..", "..");
let pass = 0;
let fail = 0;

function check(name, condition, detail = "") {
  if (condition) {
    pass++;
    console.log("  [pass]", name);
  } else {
    fail++;
    console.log("  [FAIL]", name, detail ? `-> ${detail}` : "");
  }
}

function section(name) {
  console.log(`\n-- ${name} --`);
}

function matrix(dim, seed) {
  return Array.from({ length: dim }, (_, r) =>
    Array.from({ length: dim }, (_, c) => seed + r * dim + c + 0.125)
  );
}

function cacheEntry(k, seed) {
  const dim = k + 1; // intercept + k regressors
  return {
    n: 900_000,
    XtX: matrix(dim, seed),
    XtY: Array.from({ length: dim }, (_, i) => seed + i + 0.25),
    YtY: seed + 12345.5,
    sumY: seed + 6789.5,
    varNames: ["const", ...Array.from({ length: k }, (_, i) => `x${i + 1}`)],
    beta: Array.from({ length: dim }, (_, i) => seed / 1000 + i / 100),
    Ainv: matrix(dim, seed / 10),
    dummySQL: {},
  };
}

section("COOP/COEP headers");
{
  const vercel = JSON.parse(readFileSync(join(root, "vercel.json"), "utf8"));
  const catchAll = vercel.headers?.find(rule => rule.source === "/(.*)");
  const headers = Object.fromEntries(
    (catchAll?.headers ?? []).map(({ key, value }) => [key.toLowerCase(), value])
  );
  check("catch-all header rule exists", Boolean(catchAll));
  check("COOP is same-origin", headers["cross-origin-opener-policy"] === "same-origin",
    headers["cross-origin-opener-policy"]);
  check("COEP is require-corp", headers["cross-origin-embedder-policy"] === "require-corp",
    headers["cross-origin-embedder-policy"]);
  check("worker-src permits blob workers",
    /worker-src[^;]*\bblob:/.test(headers["content-security-policy"] ?? ""));
}

section("suffStatsCache LRU and serialized ceiling");
{
  const cache = createSuffStatsCache(50);
  for (let i = 0; i < 50; i++) cache.set(`model-${i}`, cacheEntry(20, i * 1000));
  check("cache reaches exactly 50 entries", cache.size() === 50, String(cache.size()));

  cache.get("model-0"); // mark as most recently used
  cache.set("model-50", cacheEntry(20, 50_000));
  const keys = cache.entries().map(([key]) => key);
  check("capacity remains 50 after overflow", cache.size() === 50, String(cache.size()));
  check("least-recently-used entry is evicted", !keys.includes("model-1"), keys.slice(0, 3).join(", "));
  check("recently-read entry survives eviction", keys.includes("model-0"));
  check("new entry is retained", keys.includes("model-50"));

  const serializedBytes = Buffer.byteLength(JSON.stringify(cache.entries()), "utf8");
  const limitBytes = 10 * 1024 * 1024;
  check("50 entries at k=20 serialize below 10 MiB", serializedBytes < limitBytes,
    `${(serializedBytes / 1024 / 1024).toFixed(3)} MiB`);
  console.log(`  serialized proxy: ${(serializedBytes / 1024).toFixed(1)} KiB`);
}

console.log(`\nfaseX4Performance: ${pass} passed, ${fail} failed`);
if (fail > 0) process.exit(1);
