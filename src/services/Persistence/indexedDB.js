// ─── ECON STUDIO · services/persistence/indexedDB.js ─────────────────────────
// Async persistence for pipeline state + raw dataset rows.
// Replaces localStorage (5MB cap, sync) with IndexedDB (≥500MB, async).
//
// DB layout:
//   DB name  : "econ_studio_v1"
//   Version  : 8
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
//   Store "dataset_registry" — durable list of ALL a project's datasets (meta
//                              only), keyed by project pid. No privileged primary.
//     Key   : pid (string)
//     Value : { pid, datasets: DatasetMeta[], ts }
//
// Exports:
//   openDB()
//   saveProject(pid, meta)               / listProjects()      / deleteProject(pid) / clearAllProjects()
//   markDirty(pid)                       / setSyncMeta(pid)    / getSyncMeta(pid)
//   savePipeline(pid, datasetId, record) / loadPipeline(pid, datasetId)
//   listPipelines()                      / deletePipeline(id)  / clearAllPipelines()
//   saveRawData(id, rawData)             / loadRawData(id)     / deleteRawData(id)
//   saveWorkbenchRecord(pid, sessions)   / loadWorkbenchRecord(pid)  / deleteWorkbenchRecord(pid)
//   saveDatasetRegistry(pid, datasets)   / loadDatasetRegistry(pid)  / deleteDatasetRegistry(pid)

import { retrofitRowId } from "../data/rowIdentity.js";

const DB_VERSION           = 9;
const STORE_PIPE           = "pipelines";
const STORE_RAW            = "raw_data";
const STORE_PROJ           = "projects";
const STORE_WORKBENCH      = "workbench";
const STORE_COACH          = "coach_chats";
const STORE_DS_REGISTRY    = "dataset_registry";
const STORE_MODEL_BUFFER   = "model_buffer";
const STORE_SPATIAL_MAPS   = "spatial_maps";
const RAW_DATA_LIMIT_BYTES = 100 * 1024 * 1024; // 100 MB hard cap

// Every object store the app expects to exist. Used to self-heal a DB that
// reached a given version without all stores created (e.g. an interrupted or
// buggy prior upgrade) — see openDB() below.
const REQUIRED_STORES = [
  STORE_PIPE, STORE_RAW, STORE_PROJ, STORE_WORKBENCH, STORE_COACH, STORE_DS_REGISTRY,
  STORE_MODEL_BUFFER, STORE_SPATIAL_MAPS,
];

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
  // Open with NO version on the first attempt so we adopt whatever version the
  // DB already exists at (or create it fresh). Hardcoding a version risks a
  // VersionError ("requested version is less than existing") whenever a prior
  // session's self-heal pushed the DB past our constant. Missing stores are
  // then repaired by reopening at version+1 (see openAt's onsuccess).
  _dbPromise = openAt(undefined);
  return _dbPromise;
}

// Open the DB. With `version` undefined, opens at the existing version (or v1 if
// new) — never downgrades. If, after opening, any REQUIRED_STORES are missing (a
// DB that reached its version via an interrupted/buggy prior upgrade, or a newly
// added store), close it and reopen at version+1 so onupgradeneeded re-runs and
// creates them. All store creations below are idempotent (`contains` guards), so
// re-running is safe.
function openAt(version) {
  return new Promise((resolve, reject) => {
    if (typeof indexedDB === "undefined") {
      reject(new Error("IndexedDB not available in this environment"));
      return;
    }

    const req = version === undefined
      ? indexedDB.open(getDbName())
      : indexedDB.open(getDbName(), version);

    req.onupgradeneeded = e => {
      const db     = e.target.result;
      const oldVer = e.oldVersion;

      // pipelines store (handles both fresh install and upgrade from v0)
      if (!db.objectStoreNames.contains(STORE_PIPE)) {
        const pipe = db.createObjectStore(STORE_PIPE, { keyPath: "id" });
        pipe.createIndex("ts", "ts", { unique: false });
      }

      // raw_data store
      if (!db.objectStoreNames.contains(STORE_RAW)) {
        db.createObjectStore(STORE_RAW, { keyPath: "id" });
      }

      // projects store — named project registry (separate from per-dataset pipelines)
      if (!db.objectStoreNames.contains(STORE_PROJ)) {
        const proj = db.createObjectStore(STORE_PROJ, { keyPath: "pid" });
        proj.createIndex("updatedAt", "updatedAt", { unique: false });
      }

      // v4 migration: reshape pipelines store — each pid record now holds a
      // per-dataset map { [datasetId]: { steps, panel, dataDictionary,
      // branchPointIndex } } instead of those fields at the top level. Legacy
      // single-dataset records are migrated by treating the project pid as the
      // primary dataset id. This is a data migration (not a store creation), so
      // it stays version-gated to run exactly once.
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

      // workbench store — Equation Workbench sessions, keyed by project pid.
      if (!db.objectStoreNames.contains(STORE_WORKBENCH)) {
        db.createObjectStore(STORE_WORKBENCH, { keyPath: "pid" });
      }

      // coach_chats store — AI Coach conversations, keyed by project pid.
      if (!db.objectStoreNames.contains(STORE_COACH)) {
        db.createObjectStore(STORE_COACH, { keyPath: "pid" });
      }

      // dataset_registry store — durable list of ALL of a project's datasets
      // (metadata only), keyed by project pid. Replaces the old sessionStorage
      // registry that did not survive a browser close.
      if (!db.objectStoreNames.contains(STORE_DS_REGISTRY)) {
        db.createObjectStore(STORE_DS_REGISTRY, { keyPath: "pid" });
      }

      // v9: model_buffer store — pinned-model comparison buffer, keyed by pid.
      if (!db.objectStoreNames.contains(STORE_MODEL_BUFFER)) {
        db.createObjectStore(STORE_MODEL_BUFFER, { keyPath: "pid" });
      }
      // v9: spatial_maps store — serialized spatial map/layer configs, keyed by pid.
      if (!db.objectStoreNames.contains(STORE_SPATIAL_MAPS)) {
        db.createObjectStore(STORE_SPATIAL_MAPS, { keyPath: "pid" });
      }
    };

    req.onsuccess = e => {
      const db      = e.target.result;
      const missing = REQUIRED_STORES.filter(s => !db.objectStoreNames.contains(s));
      if (missing.length) {
        // DB reached this version without all stores. Force a fresh upgrade at
        // the next version so onupgradeneeded re-runs and creates them.
        console.warn("[IDB] missing stores", missing, "— reopening at v" + (db.version + 1));
        const next = db.version + 1;
        db.close();
        resolve(openAt(next));
        return;
      }
      resolve(db);
    };
    req.onerror   = e => reject(e.target.error);
    req.onblocked = () => reject(new Error("IndexedDB upgrade blocked — close other tabs and reload"));
  });
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

function normalizeSyncMeta(project = {}) {
  return {
    published: Boolean(project.published),
    lastSyncedVersion: Number.isFinite(project.lastSyncedVersion) ? project.lastSyncedVersion : 0,
    dirty: Boolean(project.dirty),
  };
}

async function getProjectRecord(pid) {
  if (!pid) return null;
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const t   = db.transaction(STORE_PROJ, "readonly");
    const req = t.objectStore(STORE_PROJ).get(pid);
    req.onsuccess = e => resolve(e.target.result ?? null);
    req.onerror   = e => reject(e.target.error);
  });
}

async function markDirtyIfPublished(pid) {
  const meta = await getSyncMeta(pid);
  if (meta.published) await markDirty(pid);
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
  await markDirtyIfPublished(projectPid);
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
    await markDirtyIfPublished(id);
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
  const next = {
      createdAt: now,
      ...existing,
      ...meta,
      pid,
      updatedAt: now,
    };
  const syncMeta = normalizeSyncMeta(next);
  await tx(STORE_PROJ, db, "readwrite", s => s.put({ ...next, ...syncMeta }));
  if (syncMeta.published && meta?.dirty !== false) await markDirty(pid);
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
      (e.target.result ?? [])
        .map(project => ({ ...project, ...normalizeSyncMeta(project) }))
        .sort((a, b) => b.updatedAt - a.updatedAt)
    );
    req.onerror = e => reject(e.target.error);
  });
}

export async function getSyncMeta(pid) {
  const project = await getProjectRecord(pid);
  return normalizeSyncMeta(project ?? {});
}

export async function setSyncMeta(pid, patch = {}) {
  if (!pid) throw new Error("setSyncMeta: pid required");
  const db = await openDB();
  const existing = await getProjectRecord(pid);
  const now = Date.now();
  const next = {
    createdAt: existing?.createdAt ?? now,
    updatedAt: existing?.updatedAt ?? now,
    ...(existing ?? {}),
    pid,
    ...normalizeSyncMeta({ ...(existing ?? {}), ...patch }),
  };
  if ("updatedAt" in patch) next.updatedAt = patch.updatedAt;
  await tx(STORE_PROJ, db, "readwrite", s => s.put(next));
  return normalizeSyncMeta(next);
}

export async function markDirty(pid) {
  if (!pid) return normalizeSyncMeta({});
  const db = await openDB();
  const existing = await getProjectRecord(pid);
  if (!existing) return normalizeSyncMeta({});
  const next = {
    ...existing,
    ...normalizeSyncMeta(existing),
    dirty: true,
    updatedAt: Date.now(),
  };
  await tx(STORE_PROJ, db, "readwrite", s => s.put(next));
  return normalizeSyncMeta(next);
}

/**
 * Delete a project record (also call deletePipeline/deleteRawData separately).
 */
export async function deleteProject(pid) {
  const db = await openDB();
  await tx(STORE_PROJ, db, "readwrite", s => s.delete(pid));
  await deleteCoachChats(pid);
  await deleteModelBuffer(pid);
  await deleteSpatialMaps(pid);
  await deleteSessionMeta(pid);
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
  await markDirtyIfPublished(pid);
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
    await markDirtyIfPublished(pid);
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

// ─── MODEL BUFFER (pinned-model comparison set, per project) ──────────────────
export async function saveModelBuffer(pid, models) {
  if (!pid) return { stored: false };
  try {
    const db = await openDB();
    await tx(STORE_MODEL_BUFFER, db, "readwrite", s =>
      s.put({ pid, models: Array.isArray(models) ? models : [], ts: Date.now() }));
    await markDirtyIfPublished(pid);
    return { stored: true };
  } catch (err) { console.warn("[IDB] saveModelBuffer failed:", err.message); return { stored: false }; }
}
export async function loadModelBuffer(pid) {
  if (!pid) return null;
  try {
    const db = await openDB();
    return await new Promise((resolve, reject) => {
      const t = db.transaction(STORE_MODEL_BUFFER, "readonly");
      const req = t.objectStore(STORE_MODEL_BUFFER).get(pid);
      req.onsuccess = e => resolve(e.target.result ?? null);
      req.onerror = e => reject(e.target.error);
    });
  } catch { return null; }
}
export async function deleteModelBuffer(pid) {
  try { const db = await openDB(); await tx(STORE_MODEL_BUFFER, db, "readwrite", s => s.delete(pid)); } catch { /* non-fatal */ }
}

// ─── SPATIAL MAPS (serialized map/layer configs, per project) ─────────────────
export async function saveSpatialMaps(pid, maps) {
  if (!pid) return { stored: false };
  try {
    const db = await openDB();
    await tx(STORE_SPATIAL_MAPS, db, "readwrite", s =>
      s.put({ pid, maps: maps ?? null, ts: Date.now() }));
    await markDirtyIfPublished(pid);
    return { stored: true };
  } catch (err) { console.warn("[IDB] saveSpatialMaps failed:", err.message); return { stored: false }; }
}
export async function loadSpatialMaps(pid) {
  if (!pid) return null;
  try {
    const db = await openDB();
    return await new Promise((resolve, reject) => {
      const t = db.transaction(STORE_SPATIAL_MAPS, "readonly");
      const req = t.objectStore(STORE_SPATIAL_MAPS).get(pid);
      req.onsuccess = e => resolve(e.target.result ?? null);
      req.onerror = e => reject(e.target.error);
    });
  } catch { return null; }
}
export async function deleteSpatialMaps(pid) {
  try { const db = await openDB(); await tx(STORE_SPATIAL_MAPS, db, "readwrite", s => s.delete(pid)); } catch { /* non-fatal */ }
}

// ─── SESSION META API (phase 9.3) ─────────────────────────────────────────────
// Cross-dataset globalPipeline + Calculate-tab calcWorkspace, one record per
// project pid. Stored in the pipelines store under a string key (mirrors
// plotHistory) so no schema bump. The dataset registry itself lives in
// dataset_registry; this holds only the session-level coordination state.
//   Value : { id: `sessionMeta_${pid}`, meta: { globalPipeline, calcWorkspace }, ts }
export async function saveSessionMeta(pid, meta) {
  if (!pid) return { stored: false };
  try {
    const db = await openDB();
    await tx(STORE_PIPE, db, "readwrite", s =>
      s.put({ id: `sessionMeta_${pid}`, meta: meta ?? null, ts: Date.now() }));
    return { stored: true };
  } catch (err) { console.warn("[IDB] saveSessionMeta failed:", err.message); return { stored: false }; }
}
export async function loadSessionMeta(pid) {
  if (!pid) return null;
  try {
    const db = await openDB();
    return await new Promise((resolve, reject) => {
      const t   = db.transaction(STORE_PIPE, "readonly");
      const req = t.objectStore(STORE_PIPE).get(`sessionMeta_${pid}`);
      req.onsuccess = e => resolve(e.target.result?.meta ?? null);
      req.onerror   = e => reject(e.target.error);
    });
  } catch { return null; }
}
export async function deleteSessionMeta(pid) {
  try { const db = await openDB(); await tx(STORE_PIPE, db, "readwrite", s => s.delete(`sessionMeta_${pid}`)); } catch { /* non-fatal */ }
}

// ─── DATASET REGISTRY API ─────────────────────────────────────────────────────
// Durable list of ALL of a project's datasets, keyed by project pid. There is
// no privileged "primary" dataset — every dataset is recorded here equally.
//   Value : { pid, datasets: DatasetMeta[], ts }
//   DatasetMeta : { id, filename, source?, origin?, crs?, headers?, loadOpts? }
// Rows are NOT stored here — they live in the raw_data store keyed by dataset id.
// The project's last-active dataset rides on the projects record as
// `activeDatasetId` (written via saveProject), restored on reopen.
// This replaces the old sessionStorage-only registry that did not survive a
// browser close (only the pid-keyed primary dataset persisted).

/**
 * Persist the full dataset registry for a project. Overwrites the record.
 * Strips any `rawData`/`rows` before storing — only metadata is kept here.
 */
export async function saveDatasetRegistry(pid, datasets) {
  if (!pid) return { stored: false };
  try {
    const slim = (Array.isArray(datasets) ? datasets : []).map(d => {
      // Strip row payloads — only metadata is persisted in the registry.
      const { rawData: _rawData, rows: _rows, ...meta } = d;
      return meta;
    });
    const db = await openDB();
    await tx(STORE_DS_REGISTRY, db, "readwrite", s =>
      s.put({ pid, datasets: slim, ts: Date.now() })
    );
    await markDirtyIfPublished(pid);
    return { stored: true };
  } catch (err) {
    console.warn("[IDB] saveDatasetRegistry failed:", err.message);
    return { stored: false };
  }
}

/**
 * Load the full dataset registry for a project.
 * Returns the metadata array (possibly empty), never null.
 */
export async function loadDatasetRegistry(pid) {
  if (!pid) return [];
  try {
    const db = await openDB();
    return await new Promise((resolve, reject) => {
      const t   = db.transaction(STORE_DS_REGISTRY, "readonly");
      const req = t.objectStore(STORE_DS_REGISTRY).get(pid);
      req.onsuccess = e => resolve(e.target.result?.datasets ?? []);
      req.onerror   = e => reject(e.target.error);
    });
  } catch {
    return [];
  }
}

/**
 * Delete the dataset-registry record for a project.
 */
export async function deleteDatasetRegistry(pid) {
  try {
    const db = await openDB();
    await tx(STORE_DS_REGISTRY, db, "readwrite", s => s.delete(pid));
  } catch { /* non-fatal */ }
}

export async function clearAllLocalData() {
  await clearAllPipelines(); // clears STORE_PIPE + STORE_RAW
  await clearAllProjects();  // clears STORE_PROJ
  try {
    const db = await openDB();
    await tx(STORE_WORKBENCH,    db, "readwrite", s => s.clear());
    await tx(STORE_COACH,        db, "readwrite", s => s.clear());
    await tx(STORE_DS_REGISTRY,  db, "readwrite", s => s.clear());
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
