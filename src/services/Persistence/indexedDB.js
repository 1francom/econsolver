// ─── ECON STUDIO · services/persistence/indexedDB.js ─────────────────────────
// Async persistence for pipeline state + raw dataset rows.
// Replaces localStorage (5MB cap, sync) with IndexedDB (≥500MB, async).
//
// DB layout:
//   DB name  : "econ_studio_v1"
//   Version  : 5
//
//   Store "projects"   — named project registry (top-level, user-visible)
//     Key   : pid (string, same as pipeline key)
//     Index : updatedAt
//     Value : { pid, name, filename, rowCount, colCount, createdAt, updatedAt }
//
//   Store "pipelines"  — per-project record holding a map of per-dataset pipelines
//     Key   : pid (string, project id)
//     Index : ts (for listing recents)
//     Value : {
//       id: pid,
//       datasetPipelines: { [datasetId]: { steps, panel, dataDictionary,
//                                          branchPointIndex, ...extra } },
//       ts,
//       ...extra top-level meta (filename, rowCount, colCount, pipelineLength)
//     }
//     v3 -> v4 migration reshapes legacy { pipeline, panel, ... } records into
//     datasetPipelines[pid] = { steps: pipeline, panel, ... } so single-dataset
//     projects keep working unchanged.
//
//   Store "raw_data"   — original dataset rows + headers, keyed by pid
//     Key   : pid (string)
//     Value : { id, headers, rows, byteSize, ts }
//     Limit : rows stored only if estimated JSON size < RAW_DATA_LIMIT_BYTES
//
//   Store "workbench"  — Equation Workbench sessions, keyed by project pid
//     Key   : pid (string)
//     Value : { pid, sessions, ts }
//
// Exports:
//   openDB()
//   saveProject(pid, meta)               / listProjects()      / deleteProject(pid) / clearAllProjects()
//   savePipeline(pid, datasetId, record) / loadPipeline(pid, datasetId)
//   listPipelines()                      / deletePipeline(id)  / clearAllPipelines()
//   saveRawData(id, rawData)             / loadRawData(id)     / deleteRawData(id)
//   saveWorkbenchRecord(pid, sessions)   / loadWorkbenchRecord(pid)  / deleteWorkbenchRecord(pid)

import { retrofitRowId } from "../data/rowIdentity.js";

const DB_VERSION           = 6;
const STORE_PIPE           = "pipelines";
const STORE_RAW            = "raw_data";
const STORE_PROJ           = "projects";
const STORE_WORKBENCH      = "workbench";
const STORE_COACH          = "coach_chats";
const RAW_DATA_LIMIT_BYTES = 100 * 1024 * 1024; // 100 MB hard cap

// ── Per-user DB isolation ──────────────────────────────────────────────────────
// Each authenticated user gets their own IndexedDB so projects never bleed
// across accounts that share a device or browser profile.
let _userId    = null;
let _dbPromise = null;

/**
 * Call this whenever the auth state changes (login / logout).
 * It resets the DB singleton so the next openDB() picks up the correct DB name.
 */
export function setCurrentUser(uid) {
  if (uid === _userId) return;
  _userId    = uid ?? null;
  _dbPromise = null; // force re-open against the new DB name on next call
}

function getDbName() {
  return _userId ? `econ_studio_${_userId}` : "econ_studio_v1";
}

export function openDB() {
  if (_dbPromise) return _dbPromise;

  _dbPromise = new Promise((resolve, reject) => {
    if (typeof indexedDB === "undefined") {
      reject(new Error("IndexedDB not available in this environment"));
      return;
    }

    const req = indexedDB.open(getDbName(), DB_VERSION);

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

      // v4: reshape pipelines store — each pid record now holds a per-dataset
      // map { [datasetId]: { steps, panel, dataDictionary, branchPointIndex } }
      // instead of those fields at the top level. Legacy single-dataset records
      // are migrated by treating the project pid as the primary dataset id.
      if (oldVer < 4 && oldVer >= 1) {
        // Use the upgrade transaction (provided on the request) to walk
        // existing records — opening a new transaction here is illegal.
        const tx2  = e.target.transaction;
        const pipe = tx2.objectStore(STORE_PIPE);
        const cur  = pipe.openCursor();
        cur.onsuccess = ev => {
          const cursor = ev.target.result;
          if (!cursor) return;
          const rec = cursor.value;
          if (rec && !rec.datasetPipelines) {
            const {
              id, pipeline, panel, dataDictionary, branchPointIndex,
              ts, ...rest
            } = rec;
            const inner = {
              steps:            Array.isArray(pipeline) ? pipeline : [],
              panel:            panel             ?? null,
              dataDictionary:   dataDictionary    ?? null,
              branchPointIndex: branchPointIndex  ?? null,
            };
            const reshaped = {
              ...rest,
              id,
              datasetPipelines: { [id]: inner },
              ts: ts ?? Date.now(),
            };
            cursor.update(reshaped);
          }
          cursor.continue();
        };
      }

      // v5: workbench store — Equation Workbench sessions, keyed by project pid.
      if (oldVer < 5) {
        db.createObjectStore(STORE_WORKBENCH, { keyPath: "pid" });
      }

      // v6: coach_chats store — AI Coach conversations, keyed by project pid.
      if (oldVer < 6) {
        db.createObjectStore(STORE_COACH, { keyPath: "pid" });
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
// Each project pid owns a single store record whose `datasetPipelines` map
// holds one entry per dataset id. For single-dataset projects, datasetId
// equals the project pid (legacy compatibility — see v4 migration above).

/**
 * Persist the pipeline for a single (projectPid, datasetId) slot.
 *
 * `record` should carry the per-dataset payload — typically
 * `{ pipeline, panel, dataDictionary, branchPointIndex, ... }`.
 * `pipeline` is normalised to `steps` so the stored shape matches the v4
 * schema regardless of what callers pass in.
 *
 * Any extra fields on `record` that are NOT per-dataset (filename, rowCount,
 * colCount, pipelineLength) are mirrored at the top of the project record so
 * the project list previews keep working.
 */
export async function savePipeline(projectPid, datasetId, record = {}) {
  if (!projectPid) throw new Error("savePipeline: projectPid required");
  if (!datasetId)  throw new Error("savePipeline: datasetId required");

  const db = await openDB();

  // Read-modify-write the per-project record so concurrent datasets merge.
  const existing = await new Promise((resolve, reject) => {
    const t   = db.transaction(STORE_PIPE, "readonly");
    const req = t.objectStore(STORE_PIPE).get(projectPid);
    req.onsuccess = e => resolve(e.target.result ?? null);
    req.onerror   = e => reject(e.target.error);
  });

  const {
    pipeline, steps, panel, dataDictionary, branchPointIndex,
    filename, rowCount, colCount, pipelineLength,
    ...rest
  } = record;

  const innerSteps = Array.isArray(steps)
    ? steps
    : Array.isArray(pipeline) ? pipeline : [];

  const inner = {
    ...rest,
    steps:            innerSteps,
    panel:            panel             ?? null,
    dataDictionary:   dataDictionary    ?? null,
    branchPointIndex: branchPointIndex  ?? null,
  };

  const next = {
    ...(existing || {}),
    id:               projectPid,
    datasetPipelines: {
      ...(existing?.datasetPipelines || {}),
      [datasetId]: inner,
    },
    ts: Date.now(),
  };

  // Mirror top-level project meta (used by project-list previews) when caller
  // provides it. Only the primary dataset typically supplies these.
  if (filename       != null) next.filename       = filename;
  if (rowCount       != null) next.rowCount       = rowCount;
  if (colCount       != null) next.colCount       = colCount;
  if (pipelineLength != null) next.pipelineLength = pipelineLength;

  await tx(STORE_PIPE, db, "readwrite", s => s.put(next));
}

/**
 * Load the per-dataset slot for (projectPid, datasetId).
 * Returns `{ steps, panel, dataDictionary, branchPointIndex, ... }` or null.
 *
 * When called with only `projectPid` (legacy single-dataset assumption), the
 * primary slot — `datasetPipelines[projectPid]` — is returned. This preserves
 * call sites that still want the single-dataset view.
 */
export async function loadPipeline(projectPid, datasetId = projectPid) {
  const db = await openDB();
  const rec = await new Promise((resolve, reject) => {
    const t   = db.transaction(STORE_PIPE, "readonly");
    const req = t.objectStore(STORE_PIPE).get(projectPid);
    req.onsuccess = e => resolve(e.target.result ?? null);
    req.onerror   = e => reject(e.target.error);
  });
  if (!rec) return null;
  const map = rec.datasetPipelines || {};
  return map[datasetId] ?? null;
}

/**
 * Load the whole per-project pipeline record, exposing the full
 * `datasetPipelines` map plus any top-level meta. Useful for project-list
 * previews that need to inspect multiple datasets at once.
 */
export async function loadProjectPipelines(projectPid) {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const t   = db.transaction(STORE_PIPE, "readonly");
    const req = t.objectStore(STORE_PIPE).get(projectPid);
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
        if (!rec) { resolve(null); return; }
        // Legacy projects stored before the __row_id invariant may lack the
        // column. Retrofit on read so callers always observe both __ri and
        // __row_id without an explicit migration phase.
        const retrofitted = retrofitRowId({ headers: rec.headers, rows: rec.rows });
        resolve(retrofitted);
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
  await deleteCoachChats(pid);
}

/**
 * Clear all project records.
 */
export async function clearAllProjects() {
  const db = await openDB();
  await tx(STORE_PROJ, db, "readwrite", s => s.clear());
}

// ─── WORKBENCH API ────────────────────────────────────────────────────────────
// Equation Workbench sessions, one record per project pid.
//   Value : { pid, sessions: Session[], ts }

/**
 * Persist the full session array for a project. Overwrites the record.
 * Returns { stored: bool }.
 */
export async function saveWorkbenchRecord(pid, sessions) {
  if (!pid) throw new Error("saveWorkbenchRecord: pid required");
  const db = await openDB();
  await tx(STORE_WORKBENCH, db, "readwrite", s =>
    s.put({ pid, sessions: Array.isArray(sessions) ? sessions : [], ts: Date.now() })
  );
  return { stored: true };
}

/**
 * Load the workbench record for a project. Returns { pid, sessions, ts } or null.
 */
export async function loadWorkbenchRecord(pid) {
  if (!pid) return null;
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const t   = db.transaction(STORE_WORKBENCH, "readonly");
    const req = t.objectStore(STORE_WORKBENCH).get(pid);
    req.onsuccess = e => resolve(e.target.result ?? null);
    req.onerror   = e => reject(e.target.error);
  });
}

/**
 * Delete the workbench record for a project.
 */
export async function deleteWorkbenchRecord(pid) {
  try {
    const db = await openDB();
    await tx(STORE_WORKBENCH, db, "readwrite", s => s.delete(pid));
  } catch { /* non-fatal */ }
}

// ─── COACH CHATS API ──────────────────────────────────────────────────────────
// AI Coach conversations, one record per project pid.
//   Value : { pid, conversations: Conversation[], ts }
//   Conversation : { id, title, createdAt, updatedAt, messages: Message[] }
//   Message      : { role: "user"|"assistant", text, images? }

/**
 * Persist all conversations for a project. Overwrites the record.
 * Returns { stored: bool }.
 */
export async function saveCoachChats(pid, conversations) {
  if (!pid) return { stored: false };
  try {
    const db = await openDB();
    await tx(STORE_COACH, db, "readwrite", s =>
      s.put({ pid, conversations: Array.isArray(conversations) ? conversations : [], ts: Date.now() })
    );
    return { stored: true };
  } catch (err) {
    console.warn("[IDB] saveCoachChats failed:", err.message);
    return { stored: false };
  }
}

/**
 * Load the coach-chats record for a project. Returns { pid, conversations, ts } or null.
 */
export async function loadCoachChats(pid) {
  if (!pid) return null;
  try {
    const db = await openDB();
    return await new Promise((resolve, reject) => {
      const t   = db.transaction(STORE_COACH, "readonly");
      const req = t.objectStore(STORE_COACH).get(pid);
      req.onsuccess = e => resolve(e.target.result ?? null);
      req.onerror   = e => reject(e.target.error);
    });
  } catch {
    return null;
  }
}

/**
 * Delete the coach-chats record for a project.
 */
export async function deleteCoachChats(pid) {
  try {
    const db = await openDB();
    await tx(STORE_COACH, db, "readwrite", s => s.delete(pid));
  } catch { /* non-fatal */ }
}

export async function clearAllLocalData() {
  await clearAllPipelines(); // clears STORE_PIPE + STORE_RAW
  await clearAllProjects();  // clears STORE_PROJ
  try {
    const db = await openDB();
    await tx(STORE_WORKBENCH, db, "readwrite", s => s.clear());
    await tx(STORE_COACH,     db, "readwrite", s => s.clear());
  } catch { /* non-fatal */ }
  try { localStorage.clear(); } catch { /* non-fatal */ }
  try { sessionStorage.clear(); } catch { /* non-fatal */ }
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
      // Legacy localStorage records are single-dataset — treat the project pid
      // as the primary dataset id (matches the v3 -> v4 store migration).
      if (rec?.id) await savePipeline(rec.id, rec.id, rec);
    }

    localStorage.setItem(MIGRATED_FLAG, "1");
  } catch {
    localStorage.setItem(MIGRATED_FLAG, "1");
  }
}
