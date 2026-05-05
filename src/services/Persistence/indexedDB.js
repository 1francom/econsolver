// ─── ECON STUDIO · services/persistence/indexedDB.js ─────────────────────────
// Async persistence for pipeline state + raw dataset rows.
// Replaces localStorage (5MB cap, sync) with IndexedDB (≥500MB, async).
//
// DB layout:
//   DB name  : "econ_studio_v1"
//   Version  : 3
//
//   Store "projects"   — named project registry (top-level, user-visible)
//     Key   : pid (string, same as pipeline key)
//     Index : updatedAt
//     Value : { pid, name, filename, rowCount, colCount, createdAt, updatedAt }
//
//   Store "pipelines"  — pipeline metadata, steps, panel config, dictionary
//     Key   : pid (string)
//     Index : ts (for listing recents)
//
//   Store "raw_data"   — original dataset rows + headers, keyed by pid
//     Key   : pid (string)
//     Value : { id, headers, rows, byteSize, ts }
//     Limit : rows stored only if estimated JSON size < RAW_DATA_LIMIT_BYTES
//
// Exports:
//   openDB()
//   saveProject(pid, meta)      / listProjects()      / deleteProject(pid) / clearAllProjects()
//   savePipeline(id, record)    / loadPipeline(id)
//   listPipelines()             / deletePipeline(id)  / clearAllPipelines()
//   saveRawData(id, rawData)    / loadRawData(id)     / deleteRawData(id)

const DB_NAME              = "econ_studio_v1";
const DB_VERSION           = 3;
const STORE_PIPE           = "pipelines";
const STORE_RAW            = "raw_data";
const STORE_PROJ           = "projects";
const RAW_DATA_LIMIT_BYTES = 100 * 1024 * 1024; // 100 MB hard cap

// ── Singleton DB promise ───────────────────────────────────────────────────────
let _dbPromise = null;

export function openDB() {
  if (_dbPromise) return _dbPromise;

  _dbPromise = new Promise((resolve, reject) => {
    if (typeof indexedDB === "undefined") {
      reject(new Error("IndexedDB not available in this environment"));
      return;
    }

    const req = indexedDB.open(DB_NAME, DB_VERSION);

    req.onupgradeneeded = e => {
      const db     = e.target.result;
      const oldVer = e.oldVersion;

      // v1: pipelines store (handles both fresh install and upgrade from v0)
      if (oldVer < 1) {
        const pipe = db.createObjectStore(STORE_PIPE, { keyPath: "id" });
        pipe.createIndex("ts", "ts", { unique: false });
      }

      // v2: raw_data store
      if (oldVer < 2) {
        db.createObjectStore(STORE_RAW, { keyPath: "id" });
      }

      // v3: projects store — named project registry (separate from per-dataset pipelines)
      if (oldVer < 3) {
        const proj = db.createObjectStore(STORE_PROJ, { keyPath: "pid" });
        proj.createIndex("updatedAt", "updatedAt", { unique: false });
      }
    };

    req.onsuccess = e => resolve(e.target.result);
    req.onerror   = e => reject(e.target.error);
    req.onblocked = () => reject(new Error("IndexedDB upgrade blocked — close other tabs and reload"));
  });

  return _dbPromise;
}

// ── Internal transaction helper ────────────────────────────────────────────────
function tx(store, db, mode, fn) {
  return new Promise((resolve, reject) => {
    const t   = db.transaction(store, mode);
    const s   = t.objectStore(store);
    const req = fn(s);
    t.oncomplete = () => resolve(req?.result ?? undefined);
    t.onerror    = e => reject(e.target.error);
    t.onabort    = e => reject(e.target.error ?? new Error("Transaction aborted"));
  });
}

// ─── PIPELINE API ─────────────────────────────────────────────────────────────

export async function savePipeline(id, record) {
  const db = await openDB();
  await tx(STORE_PIPE, db, "readwrite", s => s.put({ ...record, id, ts: Date.now() }));
}

export async function loadPipeline(id) {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const t   = db.transaction(STORE_PIPE, "readonly");
    const req = t.objectStore(STORE_PIPE).get(id);
    req.onsuccess = e => resolve(e.target.result ?? null);
    req.onerror   = e => reject(e.target.error);
  });
}

export async function listPipelines() {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const t   = db.transaction(STORE_PIPE, "readonly");
    const req = t.objectStore(STORE_PIPE).index("ts").getAll();
    req.onsuccess = e => resolve((e.target.result ?? []).reverse());
    req.onerror   = e => reject(e.target.error);
  });
}

export async function deletePipeline(id) {
  const db = await openDB();
  await tx(STORE_PIPE, db, "readwrite", s => s.delete(id));
  await deleteRawData(id); // always clean up raw data together
}

export async function clearAllPipelines() {
  const db = await openDB();
  await tx(STORE_PIPE, db, "readwrite", s => s.clear());
  await tx(STORE_RAW,  db, "readwrite", s => s.clear());
}

// ─── RAW DATA API ─────────────────────────────────────────────────────────────

/**
 * Persist raw dataset rows + headers for a project.
 * Skips silently if the serialised size exceeds RAW_DATA_LIMIT_BYTES (100 MB).
 * Returns { stored: bool, byteSize: number }.
 */
export async function saveRawData(id, rawData) {
  try {
    const serialised = JSON.stringify(rawData);
    const byteSize   = new Blob([serialised]).size;

    if (byteSize > RAW_DATA_LIMIT_BYTES) {
      console.warn(`[IDB] Raw data for ${id} is ${(byteSize / 1e6).toFixed(1)} MB — exceeds 100 MB cap, skipping storage.`);
      return { stored: false, byteSize };
    }

    const db = await openDB();
    await tx(STORE_RAW, db, "readwrite", s =>
      s.put({ id, headers: rawData.headers, rows: rawData.rows, byteSize, ts: Date.now() })
    );
    return { stored: true, byteSize };
  } catch (err) {
    console.error("[IDB] saveRawData failed:", err);
    return { stored: false, byteSize: 0 };
  }
}

/**
 * Load raw dataset for a project.
 * Returns { headers, rows } or null if not stored.
 */
export async function loadRawData(id) {
  try {
    const db = await openDB();
    return new Promise((resolve, reject) => {
      const t   = db.transaction(STORE_RAW, "readonly");
      const req = t.objectStore(STORE_RAW).get(id);
      req.onsuccess = e => {
        const rec = e.target.result;
        resolve(rec ? { headers: rec.headers, rows: rec.rows } : null);
      };
      req.onerror = e => reject(e.target.error);
    });
  } catch {
    return null;
  }
}

export async function deleteRawData(id) {
  try {
    const db = await openDB();
    await tx(STORE_RAW, db, "readwrite", s => s.delete(id));
  } catch { /* non-fatal */ }
}

// ─── PROJECTS API ─────────────────────────────────────────────────────────────
// Projects are the top-level concept: { pid, name, filename, rowCount, colCount, createdAt, updatedAt }.
// Pipelines and raw data are children keyed by the same pid — they never appear
// as project entries on their own.

/**
 * Upsert a project record. Call when creating or updating a project.
 * @param {string} pid
 * @param {{ name, filename, rowCount, colCount }} meta
 */
export async function saveProject(pid, meta) {
  const db  = await openDB();
  const now = Date.now();
  // Merge with existing record so updatedAt always advances, createdAt is preserved.
  const existing = await new Promise((resolve, reject) => {
    const t   = db.transaction(STORE_PROJ, "readonly");
    const req = t.objectStore(STORE_PROJ).get(pid);
    req.onsuccess = e => resolve(e.target.result ?? null);
    req.onerror   = e => reject(e.target.error);
  });
  await tx(STORE_PROJ, db, "readwrite", s =>
    s.put({
      createdAt: now,
      ...existing,
      ...meta,
      pid,
      updatedAt: now,
    })
  );
}

/**
 * List all projects, newest first.
 */
export async function listProjects() {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const t   = db.transaction(STORE_PROJ, "readonly");
    const req = t.objectStore(STORE_PROJ).getAll();
    req.onsuccess = e => resolve(
      (e.target.result ?? []).sort((a, b) => b.updatedAt - a.updatedAt)
    );
    req.onerror = e => reject(e.target.error);
  });
}

/**
 * Delete a project record (also call deletePipeline/deleteRawData separately).
 */
export async function deleteProject(pid) {
  const db = await openDB();
  await tx(STORE_PROJ, db, "readwrite", s => s.delete(pid));
}

/**
 * Clear all project records.
 */
export async function clearAllProjects() {
  const db = await openDB();
  await tx(STORE_PROJ, db, "readwrite", s => s.clear());
}

// ─── MIGRATION HELPER ─────────────────────────────────────────────────────────
const MIGRATED_FLAG = "econ_idb_migrated_v1";

export async function migrateFromLocalStorage() {
  if (typeof localStorage === "undefined") return;
  if (localStorage.getItem(MIGRATED_FLAG)) return;

  try {
    const LS_KEY = "econ_wrangle_v2";
    const raw    = localStorage.getItem(LS_KEY);
    if (!raw) { localStorage.setItem(MIGRATED_FLAG, "1"); return; }

    const records = JSON.parse(raw);
    if (!Array.isArray(records) || records.length === 0) {
      localStorage.setItem(MIGRATED_FLAG, "1");
      return;
    }

    for (const rec of records) {
      if (rec?.id) await savePipeline(rec.id, rec);
    }

    localStorage.setItem(MIGRATED_FLAG, "1");
  } catch {
    localStorage.setItem(MIGRATED_FLAG, "1");
  }
}
