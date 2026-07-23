// ECON STUDIO · src/services/data/parquetCache.js
// ─────────────────────────────────────────────────────────────────────────────
// DuckDB Fase 9 — OPFS-backed Parquet cache for large datasets.
//
// Flow:
//   First load  : CSV → DuckDB table → Parquet bytes → OPFS (fire-and-forget)
//   Second load : OPFS bytes → DuckDB table  (skips CSV re-import entirely)
//
// No circular dependency with duckdb.js — callers pass `db` (AsyncDuckDB
// instance) directly instead of importing getDuckDB from here.
//
// Cache key = stable hash of (filename, fileSize, lastModified).  Same file
// always maps to the same Parquet cache entry regardless of project or session.

const DIR = "econstudio_pcache_v1";

// ── Feature detection ──────────────────────────────────────────────────────────
export function opfsSupported() {
  return typeof navigator?.storage?.getDirectory === "function";
}

// ── Stable key from file identity ─────────────────────────────────────────────
export function cacheKey(file) {
  const raw = `${file.name}__${file.size}__${file.lastModified}`;
  // Sanitise to valid filename characters; cap at 200 chars before extension.
  return raw.replace(/[^a-zA-Z0-9._-]/g, "_").slice(0, 200) + ".parquet";
}

// ── OPFS directory handle ──────────────────────────────────────────────────────
async function getCacheDir() {
  const root = await navigator.storage.getDirectory();
  return root.getDirectoryHandle(DIR, { create: true });
}

// ── Public API ─────────────────────────────────────────────────────────────────

/**
 * Check whether a Parquet cache entry exists for this file identity.
 * Returns false (never throws) when OPFS is unsupported or the entry is absent.
 */
export async function hasCache(file) {
  if (!opfsSupported()) return false;
  try {
    const dir = await getCacheDir();
    await dir.getFileHandle(cacheKey(file));
    return true;
  } catch {
    return false;
  }
}

/**
 * Load the cached Parquet bytes into a new DuckDB table.
 * Returns true on success; false on any failure so the caller falls back to
 * the normal CSV import path.
 *
 * @param {import('@duckdb/duckdb-wasm').AsyncDuckDB} db
 * @param {string} tableName — target table name to CREATE OR REPLACE
 * @param {File}   file      — original File object (used for cache key only)
 */
export async function loadFromOPFS(db, tableName, file) {
  return loadFromOPFSKey(db, tableName, cacheKey(file));
}

/**
 * Restore an OPFS Parquet entry when only its durable cache key is available.
 * This is the project-reopen path: the original browser File no longer exists.
 */
export async function loadFromOPFSKey(db, tableName, key) {
  if (!opfsSupported()) return false;
  if (!key) return false;
  const registeredName = `__opfs_${tableName}_${key}`;
  try {
    const dir = await getCacheDir();
    const fh  = await dir.getFileHandle(key);
    const f   = await fh.getFile();
    const buf = new Uint8Array(await f.arrayBuffer());

    await db.registerFileBuffer(registeredName, buf);

    const conn = await db.connect();
    try {
      await conn.query(
        `CREATE OR REPLACE TABLE "${tableName}" AS SELECT * FROM read_parquet('${registeredName}')`
      );
    } finally {
      await conn.close();
      try { await db.dropFile(registeredName); } catch { /* best effort */ }
    }
    return true;
  } catch (e) {
    console.warn("[parquetCache] loadFromOPFS failed:", e?.message ?? String(e));
    try { await db.dropFile(registeredName); } catch { /* best effort */ }
    return false;
  }
}

/**
 * Export a DuckDB table to Parquet and write to OPFS.
 * Fire-and-forget — returns a Promise; errors are console.warn only.
 * Callers should .catch() so unhandled-rejection warnings don't appear.
 *
 * @param {import('@duckdb/duckdb-wasm').AsyncDuckDB} db
 * @param {string} tableName — source table to COPY FROM
 * @param {File}   file      — original File object (used for cache key only)
 */
export async function saveToOPFS(db, tableName, file) {
  if (!opfsSupported()) return false;
  const key = cacheKey(file);
  // Unique temp filename in DuckDB virtual FS to avoid conflicts during parallel ops
  const tmp = `__es_pexport_${Date.now()}_${Math.random().toString(36).slice(2)}.parquet`;
  try {
    // Write table to DuckDB's in-memory virtual FS as Parquet
    const conn = await db.connect();
    try {
      await conn.query(`COPY "${tableName}" TO '${tmp}' (FORMAT PARQUET)`);
    } finally {
      await conn.close();
    }

    // Extract bytes from DuckDB virtual FS
    const buf = await db.copyFileToBuffer(tmp);

    // Clean up DuckDB virtual FS entry
    try { await db.dropFile(tmp); } catch { /* ignore if API unavailable */ }

    // Write bytes to OPFS
    const dir = await getCacheDir();
    const fh  = await dir.getFileHandle(key, { create: true });
    const wr  = await fh.createWritable();
    await wr.write(buf);
    await wr.close();
    console.info(`[parquetCache] cached "${key}" (${(buf.byteLength / 1e6).toFixed(1)} MB) — full table will survive reload.`);
    return true;
  } catch (e) {
    console.warn("[parquetCache] saveToOPFS failed:", e?.message ?? String(e));
    // Best-effort cleanup of DuckDB virtual FS tmp file
    try { await db.dropFile(tmp); } catch { /* ignore */ }
    return false;
  }
}

/**
 * Remove the OPFS cache entry for a given key string.
 * Use `cacheKey(file)` to get the key, or pass `_duckdb.opfsCacheKey` directly.
 * Safe to call when the entry doesn't exist — errors are silently ignored.
 *
 * @param {string} key — value previously stored in `_duckdb.opfsCacheKey`
 */
export async function deleteCacheEntry(key) {
  if (!key || !opfsSupported()) return;
  try {
    const dir = await getCacheDir();
    await dir.removeEntry(key);
  } catch { /* entry absent or OPFS error — ignore */ }
}

// ── Browser validation ─────────────────────────────────────────────────────────
// window.__validation.fase9 lets Franco verify cache behaviour in DevTools:
//   window.__validation.fase9.cacheHits   → how many loads hit the OPFS cache
//   window.__validation.fase9.cacheMisses → how many loaded from CSV
//   window.__validation.fase9.writeErrors → how many OPFS writes failed

if (typeof window !== "undefined") {
  if (!window.__validation) window.__validation = {};
  window.__validation.fase9 = {
    opfsSupported: opfsSupported(),
    cacheHits:    0,
    cacheMisses:  0,
    writeErrors:  0,
    recordHit()  { this.cacheHits++;    },
    recordMiss() { this.cacheMisses++;  },
    recordErr()  { this.writeErrors++;  },
    // Enumerate what is actually on disk, so a failed restore can be told apart
    // from a missing/renamed cache entry without guessing.
    async listCache() {
      if (!opfsSupported()) return { supported: false, entries: [] };
      try {
        const dir = await getCacheDir();
        const entries = [];
        for await (const [name, handle] of dir.entries()) {
          const f = await handle.getFile();
          entries.push({ name, mb: +(f.size / 1e6).toFixed(2) });
        }
        return { supported: true, entries };
      } catch (e) {
        return { supported: true, error: e?.message ?? String(e), entries: [] };
      }
    },
  };
}
