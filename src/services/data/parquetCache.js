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

const DIR_PREFIX = "econstudio_pcache_v1";

// ── Feature detection ──────────────────────────────────────────────────────────
export function opfsSupported() {
  return typeof navigator?.storage?.getDirectory === "function";
}

// SECURITY (SECURITY_AUDIT_2026-08-02.md A-2): OPFS is scoped per-ORIGIN, not
// per-account like IndexedDB (see setCurrentUser in Persistence/indexedDB.js).
// On a shared machine — a university computer lab, exactly this product's
// department-licensing GTM — a second user loading a file with the same
// (name, size, lastModified) got a cache hit on the FIRST user's cached
// Parquet, because the directory and cache key never involved identity.
// setCacheUser() must be called alongside setCurrentUser() (AuthContext.jsx)
// so every OPFS read/write is scoped to the signed-in uid.
let _uid = "anon";
export function setCacheUser(uid) {
  _uid = uid || "anon";
}
function dirName() {
  return `${DIR_PREFIX}_${_uid}`;
}

/** Remove the entire OPFS cache directory for a given uid (call on logout). */
export async function purgeCacheForUser(uid) {
  if (!opfsSupported() || !uid) return;
  try {
    const root = await navigator.storage.getDirectory();
    await root.removeEntry(`${DIR_PREFIX}_${uid}`, { recursive: true });
  } catch { /* directory absent or already gone — fine */ }
}

// ── Stable key from file identity ─────────────────────────────────────────────
export function cacheKey(file) {
  const raw = `${file.name}__${file.size}__${file.lastModified}`;
  // Sanitise to valid filename characters; cap at 200 chars before extension.
  return raw.replace(/[^a-zA-Z0-9._-]/g, "_").slice(0, 200) + ".parquet";
}

// ── Durable storage ────────────────────────────────────────────────────────────
// OPFS defaults to "best-effort": the browser may evict it at will, and a
// deployed origin gets far less protection than localhost. `*.vercel.app` is on
// the Public Suffix List, so every deployment is a brand-new low-engagement site
// to the browser, and Edge/Chrome tracking protections clear such storage
// aggressively — the symptom is a Parquet that writes fine and is simply gone on
// the next load (loadFromOPFS then reports NotFoundError).
//
// Asking for persistent storage is what makes "full table will survive reload"
// an actual promise instead of a hope. Requested once, lazily, before the first
// write; failure is non-fatal (the cache just stays evictable).
let _persistRequest = null;
export function ensurePersistentStorage() {
  if (_persistRequest) return _persistRequest;
  _persistRequest = (async () => {
    if (typeof navigator?.storage?.persist !== "function") return false;
    try {
      if (await navigator.storage.persisted?.()) return true;
      const granted = await navigator.storage.persist();
      if (!granted) {
        console.warn(
          "[parquetCache] the browser did not grant persistent storage — the cached " +
          "Parquet may be evicted, in which case the full table cannot be restored " +
          "after a reload and the dataset falls back to its 500-row preview."
        );
      }
      return granted;
    } catch (e) {
      console.warn("[parquetCache] persistent-storage request failed:", e?.message ?? String(e));
      return false;
    }
  })();
  return _persistRequest;
}

// ── OPFS directory handle ──────────────────────────────────────────────────────
async function getCacheDir() {
  const root = await navigator.storage.getDirectory();
  return root.getDirectoryHandle(dirName(), { create: true });
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
  // Ask for durable storage before the first write, so the entry we are about to
  // create is not sitting in evictable best-effort storage.
  await ensurePersistentStorage();
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
    // Whether the browser granted durable storage. Without it OPFS is
    // evictable, which looks exactly like a broken restore: the Parquet writes
    // fine and is simply gone on the next load.
    async storagePersisted() {
      if (typeof navigator?.storage?.persisted !== "function") return { supported: false };
      try { return { supported: true, persisted: await navigator.storage.persisted() }; }
      catch (e) { return { supported: true, error: e?.message ?? String(e) }; }
    },
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
