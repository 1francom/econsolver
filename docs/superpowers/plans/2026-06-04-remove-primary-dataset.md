# Remove the "primary / main dataset" concept — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make every dataset in a project equal, first-class, individually deletable (including the first), and durably persisted across browser restarts — eliminating the privileged "primary/main dataset" tied to the project `pid`.

**Architecture:** DataStudio becomes the single source of truth for a project's datasets. It seeds empty, hydrates the full dataset list from a durable IndexedDB `dataset_registry` store (metadata) + the `raw_data` store (rows) on mount, and persists the full registry + the active dataset id on every change. `App.jsx` becomes a thin container: it no longer holds a special `rawData` for the primary; it tracks `pid`, `projectName`, a single global `activeDatasetId`, per-tab dataset selection, and a mirror `availableDatasets` list (which already carries rows+headers) supplied by DataStudio via `onDatasetsChange`.

**Tech Stack:** React 19 + Vite + plain JavaScript. IndexedDB (`services/persistence/indexedDB.js`). No JS/component test runner — per project convention, each task is verified with `npm run lint` + `npm run build` and a described in-browser check (Franco validates in the browser).

**Spec:** `docs/superpowers/specs/2026-06-04-remove-primary-dataset-design.md`

---

## File map

- `src/services/persistence/indexedDB.js` — registry store already exists (v7). Generalize its doc comments from "secondary datasets" to "all datasets"; `activeDatasetId` rides on the existing `projects` record via `saveProject` (no schema change). **No migration.**
- `src/DataStudio.jsx` — major surgery: drop `rawData` prop + `primaryId = pid` seed + `prevRawDataRef`/newFile sync + sessionStorage registry (`ssRead/ssWrite/ssClear/ssKey`) + `_idbBacked` backfill + `[REG]` debug logs. Seed `datasets=[]`; hydrate full registry on mount; persist full registry + `activeDatasetId`; make ANY dataset deletable; add an empty-state; accept `projectPid`, `initialDatasets`, `onActiveDatasetChange`.
- `src/App.jsx` (root `App` + `DataTab`) — remove `rawData`/`handlePrimaryLoad`/`onLoadPrimary`; add `activeDatasetId` + `initialDatasets` state; add `tabRawData(tab)` helper sourced from `availableDatasets`; always-mount DataStudio on the Clean tab; rewire `handleLoad`/`handleNamingConfirm`; replace every `rawData?.rows`/`rawData?.headers` site; `DataTab` reads the active dataset from `availableDatasets`.
- `src/components/workspace/DatasetManager.jsx` — UI only: wider dropdown, visually distinct trigger, all datasets equal (cosmetic per spec §4). Deletion already works for any dataset here.

> Note: `src/services/session/sessionState.jsx` keeps its internal `primaryDatasetId` field — it is just the *first-registered* id used as a harmless active-highlight fallback in `DatasetManager`, not a user-visible privilege. App always passes an explicit `activeDatasetId`, so this fallback rarely fires. Leaving it untouched limits blast radius.

---

## Task 1: Persistence layer — generalize registry semantics to "all datasets"

The `dataset_registry` store and its `saveDatasetRegistry/loadDatasetRegistry/deleteDatasetRegistry` functions already store metadata-only and strip rows — they work identically whether they hold "secondary" or "all" datasets. `activeDatasetId` persists through the existing `saveProject(pid, meta)` merge with no schema change. This task only updates doc comments so the code's intent matches the new architecture.

**Files:**
- Modify: `src/services/persistence/indexedDB.js:528-534` (registry section header comment)
- Modify: `src/services/persistence/indexedDB.js:536-539` (saveDatasetRegistry doc comment)
- Modify: `src/services/persistence/indexedDB.js:558-561` (loadDatasetRegistry doc comment)

- [ ] **Step 1: Update the registry section header comment**

Replace the block at `src/services/persistence/indexedDB.js:528-534`:

```javascript
// ─── DATASET REGISTRY API ─────────────────────────────────────────────────────
// Durable list of a project's SECONDARY datasets, keyed by project pid.
//   Value : { pid, datasets: DatasetMeta[], ts }
//   DatasetMeta : { id, filename, source?, origin?, crs?, headers?, loadOpts? }
// Rows are NOT stored here — they live in the raw_data store keyed by dataset id.
// This replaces the old sessionStorage-only registry that did not survive a
// browser close (only the primary dataset persisted).
```

with:

```javascript
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
```

- [ ] **Step 2: Update the saveDatasetRegistry doc comment**

Replace the comment at `src/services/persistence/indexedDB.js:536-539`:

```javascript
/**
 * Persist the secondary-dataset registry for a project. Overwrites the record.
 * Strips any `rawData` before storing — only metadata is kept here.
 */
```

with:

```javascript
/**
 * Persist the full dataset registry for a project. Overwrites the record.
 * Strips any `rawData`/`rows` before storing — only metadata is kept here.
 */
```

- [ ] **Step 3: Update the loadDatasetRegistry doc comment**

Replace the comment at `src/services/persistence/indexedDB.js:558-561`:

```javascript
/**
 * Load the secondary-dataset registry for a project.
 * Returns the metadata array (possibly empty), never null.
 */
```

with:

```javascript
/**
 * Load the full dataset registry for a project.
 * Returns the metadata array (possibly empty), never null.
 */
```

- [ ] **Step 4: Verify build is clean**

Run: `npm run build`
Expected: build succeeds (comment-only change).

- [ ] **Step 5: Commit**

```bash
git add src/services/persistence/indexedDB.js
git commit -m "docs(idb): generalize dataset_registry from secondary to all datasets"
```

---

## Task 2: DataStudio — remove the primary concept; become the single source of truth

This is the core change. After it, DataStudio: takes a `projectPid` container id (not a primary dataset id), seeds an empty dataset list, hydrates the **whole** registry on mount, persists the **whole** registry + active id on change, lets ANY dataset be deleted, optionally seeds `initialDatasets` (used by the demo project), reports the active dataset back via `onActiveDatasetChange`, and shows an empty-state when no datasets are loaded.

**Files:**
- Modify: `src/DataStudio.jsx:20` (imports — add `deleteRawData`, `saveProject`)
- Modify: `src/DataStudio.jsx:668-697` (delete sessionStorage registry helpers)
- Modify: `src/DataStudio.jsx:706-909` (component signature, state seed, mount/persist effects)
- Modify: `src/DataStudio.jsx:991-1063` (deletion handlers — drop primary guards, free rows)
- Modify: `src/DataStudio.jsx:1110-1139` (imperative-handle deps, projectPid prop, empty-state)

- [ ] **Step 1: Update the IndexedDB import**

Replace `src/DataStudio.jsx:20`:

```javascript
import { saveRawData, loadRawData, saveDatasetRegistry, loadDatasetRegistry, deleteDatasetRegistry } from "./services/Persistence/indexedDB.js";
```

with:

```javascript
import { saveRawData, loadRawData, deleteRawData, saveDatasetRegistry, loadDatasetRegistry, saveProject } from "./services/Persistence/indexedDB.js";
```

(`deleteDatasetRegistry` is no longer called from DataStudio; `deleteRawData` frees rows on dataset removal; `saveProject` persists the active dataset id.)

- [ ] **Step 2: Delete the sessionStorage registry helpers**

Delete the entire block `src/DataStudio.jsx:668-697`:

```javascript
// ─── SESSION STORAGE — secondary datasets persist across navigation ───────────
// Scoped by pid so datasets from project A never appear in project B.
const SS_PREFIX = "econ_studio_secondary_ds_";
function ssKey(pid) { return SS_PREFIX + pid; }
function ssRead(pid) {
  try { return JSON.parse(sessionStorage.getItem(ssKey(pid)) || "[]"); } catch { return []; }
}
function ssWrite(pid, secondaryDatasets) {
  // Per-dataset size guard: a single oversized dataset (e.g. an Aggregate-to-Grid
  // result carrying full WKT geometry per cell) must NOT silently sink the whole
  // secondary array. Datasets whose payload won't fit in sessionStorage are stored
  // durably in IndexedDB and replaced with an `_idbBacked` placeholder; they are
  // rehydrated from IndexedDB on mount (see backfill effect below).
  const SS_PER_DS_LIMIT = 4 * 1024 * 1024; // ~4MB per dataset
  try {
    const slim = secondaryDatasets.map(d => {
      const payload = JSON.stringify(d);
      if (payload.length < SS_PER_DS_LIMIT) return d;
      // Too big for sessionStorage — persist rawData to IndexedDB, keep a placeholder.
      if (d.rawData) saveRawData(d.id, d.rawData);
      const { rawData, ...meta } = d;
      return { ...meta, _idbBacked: true, headers: rawData?.headers ?? [] };
    });
    const s = JSON.stringify(slim);
    if (s.length < 8 * 1024 * 1024) sessionStorage.setItem(ssKey(pid), s);
  } catch { /* quota exceeded — non-fatal */ }
}
function ssClear(pid) {
  try { sessionStorage.removeItem(ssKey(pid)); } catch {}
}
```

Leave the comment block at lines 699-704 (`DATA STUDIO ROOT` / `ensureRowIds`) intact.

- [ ] **Step 3: Replace the component signature and state seed**

Replace `src/DataStudio.jsx:706-738` — from the `forwardRef` line through the `const [activeId, setActiveId] = useState(primaryId);` line:

```javascript
const DataStudio = forwardRef(function DataStudio({ rawData, filename, onComplete, onOutputReady, pid, onDatasetsChange, activeDatasetId }, ref) {
  const { C } = useTheme();
  const primaryId = pid || genId();
  const dispatch = useSessionDispatch();

  // Ref exposed to WranglingModule so DataViewer can dispatch patch steps
  const wranglingAddStepRef = useRef(null);

  // Track which dataset IDs have already been registered in sessionState.
  // Prevents duplicate dispatches while ensuring every new dataset gets registered
  // regardless of which code path added it (handleLoadFile, handleSaveSubset, etc).
  const registeredIds = useRef(new Set());

  // Becomes true once the durable-registry rehydration effect has run. Until
  // then, the persistence effect must not overwrite the registry with an empty
  // list — sessionStorage is empty after a browser close, so an early write
  // would wipe the secondaries before they are restored from IndexedDB.
  const hydratedRef = useRef(false);

  const [datasets, setDatasets] = useState(() => {
    // Secondary datasets scoped to this project's pid — no cross-project leakage.
    // Retrofit row-identity columns on rehydration so projects persisted before
    // the __row_id invariant always observe both __ri and __row_id.
    const secondary = ssRead(primaryId).map(d => ({
      ...d,
      rawData: d.rawData ? ensureRowIds(d.rawData) : d.rawData,
    }));
    return [
      { id: primaryId, filename: filename || "dataset.csv", rawData: ensureRowIds(rawData), crs: rawData?._crs ?? null },
      ...secondary,
    ];
  });
  const [activeId, setActiveId]   = useState(primaryId);
```

with:

```javascript
const DataStudio = forwardRef(function DataStudio({ projectPid, initialDatasets, onComplete, onOutputReady, onDatasetsChange, onActiveDatasetChange, activeDatasetId }, ref) {
  const { C } = useTheme();
  const dispatch = useSessionDispatch();

  // Ref exposed to WranglingModule so DataViewer can dispatch patch steps
  const wranglingAddStepRef = useRef(null);

  // Track which dataset IDs have already been registered in sessionState.
  // Prevents duplicate dispatches while ensuring every new dataset gets registered
  // regardless of which code path added it (handleLoadFile, handleSaveSubset, etc).
  const registeredIds = useRef(new Set());

  // Becomes true once the durable-registry rehydration effect has run. Until
  // then, the persistence effect must not overwrite the registry with an empty
  // list — that early write would wipe persisted datasets before they are
  // restored from IndexedDB on mount.
  const hydratedRef = useRef(false);

  // No privileged "primary" dataset: start empty and hydrate the whole registry
  // (metadata) + each dataset's rows (raw_data) on mount.
  const [datasets, setDatasets] = useState([]);
  const [activeId, setActiveId]   = useState(null);
```

- [ ] **Step 4: Replace the mount/persist effects with the new registry lifecycle**

Replace `src/DataStudio.jsx:744-868` — the whole run of effects from the first "Persist primary raw data on first mount" effect through the end of the durable-registry rehydration effect (the one ending `}, []); // mount only — rehydrate durable secondaries once`):

```javascript
  // ── Persist primary raw data on first mount ────────────────────────────────
  // This ensures "Open project" works without re-uploading.
  useEffect(() => {
    if (rawData && primaryId) {
      saveRawData(primaryId, rawData);
    }
  }, [primaryId]); // only on mount — rawData ref won't change for same project

  // ── Persist primary raw data on first mount ────────────────────────────────
  // This ensures "Open project" works without re-uploading.
  useEffect(() => {
    if (rawData && primaryId) {
      saveRawData(primaryId, rawData);
    }
  }, [primaryId]); // only on mount — rawData ref won't change for same project

  // Keep primary rawData in sync if parent re-loads a new file.
  // If rawData actually changed (new file), clear secondary datasets — they
  // belonged to the previous project and would produce stale join results.
  const prevRawDataRef = useRef(rawData);
  useEffect(() => {
    const newFile = prevRawDataRef.current !== rawData;
    prevRawDataRef.current = rawData;
    if (newFile) {
      // New primary file loaded — drop secondary datasets and clear sessionStorage
      setDatasets([{ id: primaryId, filename: filename || "dataset.csv", rawData: ensureRowIds(rawData), crs: rawData?._crs ?? null }]);
      setActiveId(primaryId);
      ssClear(primaryId);
      hydratedRef.current = true; // post-reset writes are intentional
      deleteDatasetRegistry(primaryId);
    } else {
      // Same file, just sync filename (rawData ref unchanged — keep ensureRowIds-processed version)
      setDatasets(prev => prev.map(ds =>
        ds.id === primaryId ? { ...ds, filename: filename || ds.filename } : ds
      ));
    }
  }, [rawData, filename]);

  // Persist secondary datasets whenever the list changes.
  // sessionStorage = fast same-session navigation; IndexedDB registry = durable
  // metadata that survives a browser close (rows already live in raw_data store).
  useEffect(() => {
    const secondary = datasets.filter(d => d.id !== primaryId);
    ssWrite(primaryId, secondary);
    // Guard: never clobber the durable registry with an empty list before the
    // mount rehydration has run — that would wipe persisted secondaries.
    if (!hydratedRef.current && secondary.length === 0) return;
    console.debug("[REG] save", primaryId, "secondaries:", secondary.map(d => `${d.filename}#${d.id}`));
    saveDatasetRegistry(primaryId, secondary.map(d => ({
      id:       d.id,
      filename: d.filename,
      source:   d.source ?? "loaded",
      origin:   d.origin ?? null,
      crs:      datasetCrs(d),
      headers:  d.rawData?.headers ?? d.headers ?? [],
      loadOpts: d.rawData?._loadOpts ?? d.loadOpts ?? null,
    })));
  }, [datasets, primaryId]);

  // Backfill IndexedDB-backed secondaries on mount. Datasets too large for
  // sessionStorage are rehydrated here from IndexedDB so they survive a reload
  // (e.g. Aggregate-to-Grid / Spatial Join outputs carrying WKT geometry).
  useEffect(() => {
    const pending = datasets.filter(d => d._idbBacked && !d.rows && !d.rawData?.rows);
    if (!pending.length) return;
    let cancelled = false;
    (async () => {
      const loaded = await Promise.all(pending.map(async d => {
        const raw = await loadRawData(d.id);
        return raw ? { id: d.id, raw } : null;
      }));
      if (cancelled) return;
      const byId = new Map(loaded.filter(Boolean).map(x => [x.id, x.raw]));
      if (!byId.size) return;
      setDatasets(prev => prev.map(d =>
        byId.has(d.id)
          ? (() => { const { _idbBacked, ...rest } = d; return { ...rest, rawData: ensureRowIds(byId.get(d.id)) }; })()
          : d
      ));
    })();
    return () => { cancelled = true; };
  }, []); // mount only — rehydrate placeholders once

  // Rehydrate secondary datasets from the durable IndexedDB registry on mount.
  // sessionStorage is wiped when the browser closes, so after a restart only the
  // primary survives there. The registry remembers each secondary's id/filename;
  // its rows are reloaded from the raw_data store. Any registry entry already
  // present (from sessionStorage same-session nav) is skipped.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const registry = await loadDatasetRegistry(primaryId);
        console.debug("[REG] load", primaryId, "registry:", registry.map(m => `${m.filename}#${m.id}`));
        if (cancelled || !registry.length) return;
        const missing = registry.filter(
          m => m.id !== primaryId && !datasets.some(d => d.id === m.id),
        );
        if (!missing.length) return;
        const loaded = await Promise.all(missing.map(async m => {
          const raw = await loadRawData(m.id);
          console.debug("[REG] loadRawData", m.id, "rows:", raw?.rows?.length ?? "NULL");
          return raw && raw.rows?.length ? { meta: m, raw } : null;
        }));
        if (cancelled) return;
        const entries = loaded.filter(Boolean).map(({ meta, raw }) => ({
          id:       meta.id,
          filename: meta.filename,
          rawData:  ensureRowIds(raw),
          crs:      meta.crs ?? raw?._crs ?? null,
          origin:   meta.origin ?? undefined,
          source:   meta.source ?? undefined,
        }));
        if (!entries.length) return;
        setDatasets(prev => {
          const have = new Set(prev.map(d => d.id));
          const add  = entries.filter(e => !have.has(e.id));
          return add.length ? [...prev, ...add] : prev;
        });
      } finally {
        if (!cancelled) hydratedRef.current = true;
      }
    })();
    return () => { cancelled = true; };
  }, []); // mount only — rehydrate durable secondaries once
```

with:

```javascript
  // ── Hydrate the whole dataset list on mount ─────────────────────────────────
  // Load the durable registry (metadata) and each dataset's rows (raw_data).
  // If the registry is empty AND the parent supplied `initialDatasets` (e.g. the
  // demo project), seed those instead and persist them. There is no privileged
  // primary dataset and no migration of legacy pid-keyed projects.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const registry = await loadDatasetRegistry(projectPid);
        if (cancelled) return;

        if (registry.length) {
          const loaded = await Promise.all(registry.map(async m => {
            const raw = await loadRawData(m.id);
            return raw && raw.rows?.length ? { meta: m, raw } : null;
          }));
          if (cancelled) return;
          const entries = loaded.filter(Boolean).map(({ meta, raw }) => ({
            id:       meta.id,
            filename: meta.filename,
            rawData:  ensureRowIds(raw),
            crs:      meta.crs ?? raw?._crs ?? null,
            origin:   meta.origin ?? undefined,
            source:   meta.source ?? undefined,
          }));
          if (entries.length) {
            setDatasets(entries);
            const wanted = entries.some(e => e.id === activeDatasetId) ? activeDatasetId : entries[0].id;
            setActiveId(wanted);
          }
        } else if (Array.isArray(initialDatasets) && initialDatasets.length) {
          // Seed from parent-provided datasets (demo project). Persist rows so a
          // reopen rehydrates from IndexedDB like any other project.
          const entries = initialDatasets.map(d => {
            const id  = genId();
            const raw = ensureRowIds(d.rawData);
            saveRawData(id, raw);
            return { id, filename: d.filename || "dataset.csv", rawData: raw, crs: raw?._crs ?? null };
          });
          setDatasets(entries);
          setActiveId(entries[0].id);
        }
      } finally {
        if (!cancelled) hydratedRef.current = true;
      }
    })();
    return () => { cancelled = true; };
  }, []); // mount only — hydrate once per project (DataStudio is keyed by pid)

  // ── Persist the full registry + active dataset whenever they change ─────────
  // Rows already live in raw_data (written at add time); this stores metadata
  // for every dataset and the last-active id on the project record. Guarded so
  // the pre-hydration empty state never clobbers the durable registry.
  useEffect(() => {
    if (!hydratedRef.current) return;
    saveDatasetRegistry(projectPid, datasets.map(d => ({
      id:       d.id,
      filename: d.filename,
      source:   d.source ?? "loaded",
      origin:   d.origin ?? null,
      crs:      datasetCrs(d),
      headers:  d.rawData?.headers ?? d.headers ?? [],
      loadOpts: d.rawData?._loadOpts ?? d.loadOpts ?? null,
    })));
  }, [datasets, projectPid]);

  useEffect(() => {
    if (!hydratedRef.current || !activeId) return;
    saveProject(projectPid, { activeDatasetId: activeId }).catch(() => {});
    onActiveDatasetChange?.(activeId);
  }, [activeId, projectPid]);
```

- [ ] **Step 5: Drop the primary guard in `handleRemove`**

Replace `src/DataStudio.jsx:991-1000`:

```javascript
  const handleRemove = useCallback((id) => {
    if (id === primaryId) return; // primary dataset is protected
    setDatasets(prev => {
      const ds = prev.find(d => d.id === id);
      const key = ds?.rawData?._duckdb?.opfsCacheKey;
      if (key) deleteCacheEntry(key); // fire-and-forget OPFS cleanup
      return prev.filter(d => d.id !== id);
    });
    setActiveId(prev => prev === id ? primaryId : prev);
  }, [primaryId]);
```

with:

```javascript
  const handleRemove = useCallback((id) => {
    setDatasets(prev => {
      const ds = prev.find(d => d.id === id);
      const key = ds?.rawData?._duckdb?.opfsCacheKey;
      if (key) deleteCacheEntry(key); // fire-and-forget OPFS cleanup
      deleteRawData(id);              // free durable rows for the removed dataset
      const next = prev.filter(d => d.id !== id);
      setActiveId(cur => cur === id ? (next[0]?.id ?? null) : cur);
      return next;
    });
  }, []);
```

- [ ] **Step 6: Drop the primary guards in the imperative handle and free rows on removal**

Replace `src/DataStudio.jsx:1042-1063` — the `removeDataset` and `removeDatasetLocal` entries:

```javascript
    removeDataset:    (id) => {
      if (id === primaryId) return; // never remove primary
      setDatasets(prev => {
        const ds = prev.find(d => d.id === id);
        const key = ds?.rawData?._duckdb?.opfsCacheKey;
        if (key) deleteCacheEntry(key);
        return prev.filter(d => d.id !== id);
      });
      setActiveId(prev => prev === id ? primaryId : prev);
      if (dispatch) dispatch({ type: "REMOVE_DATASET", id }); // sync sessionState
    },
    removeDatasetLocal: (id) => {
      // Called by DatasetManager which already dispatched to sessionState
      if (id === primaryId) return;
      setDatasets(prev => {
        const ds = prev.find(d => d.id === id);
        const key = ds?.rawData?._duckdb?.opfsCacheKey;
        if (key) deleteCacheEntry(key);
        return prev.filter(d => d.id !== id);
      });
      setActiveId(prev => prev === id ? primaryId : prev);
    },
```

with:

```javascript
    removeDataset:    (id) => {
      setDatasets(prev => {
        const ds = prev.find(d => d.id === id);
        const key = ds?.rawData?._duckdb?.opfsCacheKey;
        if (key) deleteCacheEntry(key);
        deleteRawData(id);
        const next = prev.filter(d => d.id !== id);
        setActiveId(cur => cur === id ? (next[0]?.id ?? null) : cur);
        return next;
      });
      if (dispatch) dispatch({ type: "REMOVE_DATASET", id }); // sync sessionState
    },
    removeDatasetLocal: (id) => {
      // Called by DatasetManager which already dispatched to sessionState
      setDatasets(prev => {
        const ds = prev.find(d => d.id === id);
        const key = ds?.rawData?._duckdb?.opfsCacheKey;
        if (key) deleteCacheEntry(key);
        deleteRawData(id);
        const next = prev.filter(d => d.id !== id);
        setActiveId(cur => cur === id ? (next[0]?.id ?? null) : cur);
        return next;
      });
    },
```

- [ ] **Step 7: Remove `primaryId` from the imperative-handle dep array**

Replace `src/DataStudio.jsx:1110`:

```javascript
  }), [handleLoadFile, handleLoadFiles, addParsedDataset, handleSaveSubset, primaryId]);
```

with:

```javascript
  }), [handleLoadFile, handleLoadFiles, addParsedDataset, handleSaveSubset]);
```

- [ ] **Step 8: Update the WranglingModule render to use `projectPid` and add an empty-state**

Replace `src/DataStudio.jsx:1119-1139` — the `{activeDs && ( ... )}` block:

```javascript
      {activeDs && (
        <div style={{ flex: 1, minWidth: 0, overflow: "hidden" }}>
          {/*
            key={activeDs.id} ensures a fresh WranglingModule instance per dataset.
            This gives each dataset independent pipeline state and tab position.
            allDatasets = all OTHER datasets (context for join/append steps).
          */}
          <WranglingModule
            key={activeDs.id}
            rawData={activeDs.rawData}
            filename={activeDs.filename}
            onComplete={onComplete}
            onReady={r => onOutputReady?.(r, activeDs.id)}
            pid={activeDs.id}
            projectPid={primaryId}
            allDatasets={otherDatasets}
            onSaveSubset={handleSaveSubset}
            addStepRef={wranglingAddStepRef}
          />
        </div>
      )}
```

with:

```javascript
      {activeDs ? (
        <div style={{ flex: 1, minWidth: 0, overflow: "hidden" }}>
          {/*
            key={activeDs.id} ensures a fresh WranglingModule instance per dataset.
            This gives each dataset independent pipeline state and tab position.
            allDatasets = all OTHER datasets (context for join/append steps).
          */}
          <WranglingModule
            key={activeDs.id}
            rawData={activeDs.rawData}
            filename={activeDs.filename}
            onComplete={onComplete}
            onReady={r => onOutputReady?.(r, activeDs.id)}
            pid={activeDs.id}
            projectPid={projectPid}
            allDatasets={otherDatasets}
            onSaveSubset={handleSaveSubset}
            addStepRef={wranglingAddStepRef}
          />
        </div>
      ) : (
        <div style={{
          flex: 1, display: "flex", alignItems: "center", justifyContent: "center",
          color: C.textMuted, fontFamily: mono, fontSize: 12, textAlign: "center", padding: "2rem",
        }}>
          No datasets in this project yet.<br/>
          Go to the <span style={{ color: C.teal }}>Data</span> tab to load one.
        </div>
      )}
```

- [ ] **Step 9: Update the file header comment block**

Replace `src/DataStudio.jsx:6-14`:

```javascript
// External interface — drop-in replacement for WranglingModule:
//   rawData    {headers, rows}  – initial (primary) dataset, pre-parsed
//   filename   {string}
//   onComplete {fn}             – (cleanedData) => void — same shape as before
//   pid        {string}         – project ID for the primary dataset
//
// Additional datasets loaded here are available in WranglingModule's Merge tab.
// They are kept in component state (not persisted) — equivalent to R's
// "you must re-run your script to reload data" behavior.
```

with:

```javascript
// External interface:
//   projectPid       {string}   – the project container id (registry key)
//   initialDatasets  {Array}    – optional [{ filename, rawData }] to seed when
//                                 the registry is empty (e.g. the demo project)
//   onComplete       {fn}       – (cleanedData) => void
//   onDatasetsChange {fn}       – (slimDatasetList) => void — mirror for parent
//   onActiveDatasetChange {fn}  – (datasetId) => void — last-worked-on dataset
//   activeDatasetId  {string}   – externally-selected active dataset
//
// There is no privileged "primary" dataset. All datasets are equal, individually
// deletable, and persisted to IndexedDB (registry metadata + raw_data rows), so
// they survive a browser close. Datasets are also exposed to WranglingModule's
// Merge tab for JOIN / APPEND.
```

- [ ] **Step 10: Verify lint + build are clean**

Run: `npm run lint && npm run build`
Expected: no errors. (If lint flags an unused `filename`/`rawData`/`pid` import or var anywhere in DataStudio, it means a reference was missed — fix it before continuing. There should be no remaining references to `primaryId`, `ssRead`, `ssWrite`, `ssClear`, `prevRawDataRef`, `_idbBacked`, or `deleteDatasetRegistry` in this file.)

- [ ] **Step 11: Commit**

```bash
git add src/DataStudio.jsx
git commit -m "refactor(datastudio): remove primary dataset; hydrate full registry from IndexedDB"
```

> DataStudio will not build into a working app until Task 3 updates its call site in App.jsx. That is expected — Step 10 only checks compile/lint. Full browser validation happens after Task 3.

---

## Task 3: App.jsx root — thin container

Remove the privileged `rawData` state and the primary load path. Add a single global `activeDatasetId`, an `initialDatasets` slot (for the demo), and a `tabRawData(tab)` helper that sources the active dataset's rows from `availableDatasets` (which already carries `rows`+`headers`). Always mount DataStudio on the Clean tab so `studioRef` exists before the first dataset is loaded.

**Files:**
- Modify: `src/App.jsx:1889-1905` (root state)
- Modify: `src/App.jsx:1940-2017` (handleLoad / handleNamingConfirm / handlePrimaryLoad / tab helpers)
- Modify: `src/App.jsx:2168-2199` (Data + Clean tab render)
- Modify: `src/App.jsx:2132-2142` (WorkspaceBar onRemoveDataset fallback)
- Modify: `src/App.jsx:2238-2317` (Spatial/Simulate/Calculate/Report rawData fallbacks)

- [ ] **Step 1: Replace the root state block**

Replace `src/App.jsx:1889-1905`:

```javascript
  const [rawData,            setRawData]           = useState(null);
  const [filename,           setFilename]          = useState("");
  const [projectName,        setProjectName]       = useState("");
  const [pid,                setPid]               = useState(null);
  const [outputs,            setOutputs]           = useState({});
  const [activeTab,          setActiveTab]         = useState("clean");
  // Per-tab independent dataset selection — each tab remembers its own active dataset
  const [activeDatasetIds,   setActiveDatasetIds]  = useState({
    data: null, clean: null, explore: null, model: null,
    spatial: null, simulate: null, calculate: null, report: null,
  });
  const [sidebarOpen,        setSidebarOpen]       = useState(false);
  const [activeResult,       setActiveResult]      = useState(null);
  const [coachPrefill,       setCoachPrefill]      = useState(null);
  const [feedbackOpen,       setFeedbackOpen]      = useState(false);

  const [availableDatasets,  setAvailableDatasets] = useState([]);
```

with:

```javascript
  const [filename,           setFilename]          = useState("");
  const [projectName,        setProjectName]       = useState("");
  const [pid,                setPid]               = useState(null);
  const [outputs,            setOutputs]           = useState({});
  const [activeTab,          setActiveTab]         = useState("clean");
  // Per-tab independent dataset selection — each tab remembers its own active dataset
  const [activeDatasetIds,   setActiveDatasetIds]  = useState({
    data: null, clean: null, explore: null, model: null,
    spatial: null, simulate: null, calculate: null, report: null,
  });
  // The project-wide last-worked-on dataset — the fallback for any tab that has
  // no explicit per-tab selection. Replaces the old "primary == pid" fallback.
  const [activeDatasetId,    setActiveDatasetId]   = useState(null);
  // Optional datasets to seed a freshly-opened project whose registry is empty
  // (used by the demo project). Consumed by DataStudio on mount.
  const [initialDatasets,    setInitialDatasets]   = useState(null);
  const [sidebarOpen,        setSidebarOpen]       = useState(false);
  const [activeResult,       setActiveResult]      = useState(null);
  const [coachPrefill,       setCoachPrefill]      = useState(null);
  const [feedbackOpen,       setFeedbackOpen]      = useState(false);

  const [availableDatasets,  setAvailableDatasets] = useState([]);
```

- [ ] **Step 2: Rewrite `handleLoad` (no primary row load; seed demo via initialDatasets)**

Replace `src/App.jsx:1940-1973`:

```javascript
  const handleLoad = async p => {
    setFilename(p.filename || p.name || "project");
    setProjectName(p.name || (p.filename || "").replace(/\.[^.]+$/, "") || "Project");
    setPid(p.id);
    setOutputs({});
    navHistory.current = [];   // fresh history for this project
    setCanGoBack(false);

    if (p.filename === "wages_panel_demo.csv") {
      const { headers, rows } = parseCSV(DEMO_CSV);
      const types = {};
      headers.forEach(h => { types[h] = detectType(rows.slice(0, 50).map(r => r[h])); });
      const coerced = rows.map(r => {
        const o = {}; headers.forEach(h => { o[h] = coerce(r[h], types[h]); }); return o;
      });
      const ensRi = ensureRowIdentity;
      setRawData(ensRi({ headers, rows: coerced }));
      setActiveTab("data");
      setScreen("workspace");
      return;
    }

    const stored = await loadRawData(p.id);
    if (stored && stored.rows?.length) {
      const ensRi = ensureRowIdentity;
      setRawData(ensRi(stored));
      setActiveTab("clean");
    } else {
      // No data yet — open workspace on the Data tab so user can load data
      setRawData(null);
      setActiveTab("data");
    }
    setScreen("workspace");
  };
```

with:

```javascript
  const handleLoad = async p => {
    setFilename(p.filename || p.name || "project");
    setProjectName(p.name || (p.filename || "").replace(/\.[^.]+$/, "") || "Project");
    setPid(p.id);
    setOutputs({});
    setActiveDatasetId(p.activeDatasetId ?? null);
    setInitialDatasets(null);
    navHistory.current = [];   // fresh history for this project
    setCanGoBack(false);

    if (p.filename === "wages_panel_demo.csv") {
      const { headers, rows } = parseCSV(DEMO_CSV);
      const types = {};
      headers.forEach(h => { types[h] = detectType(rows.slice(0, 50).map(r => r[h])); });
      const coerced = rows.map(r => {
        const o = {}; headers.forEach(h => { o[h] = coerce(r[h], types[h]); }); return o;
      });
      // Seed the demo through DataStudio's normal add/persist path.
      setInitialDatasets([{ filename: "wages_panel_demo.csv", rawData: { headers, rows: coerced } }]);
    }

    // DataStudio hydrates datasets from the registry (and seeds initialDatasets
    // when the registry is empty). Open on Clean; if the project is empty the
    // DataStudio empty-state points the user to the Data tab.
    setActiveTab("clean");
    setScreen("workspace");
  };
```

- [ ] **Step 3: Update `handleNamingConfirm` (drop `setRawData`)**

Replace `src/App.jsx:1985-1986`:

```javascript
    setRawData(null);
    setFilename(projectName);
```

with:

```javascript
    setInitialDatasets(null);
    setActiveDatasetId(null);
    setFilename(projectName);
```

- [ ] **Step 4: Delete `handlePrimaryLoad` and update the tab helpers**

Replace `src/App.jsx:1996-2017`:

```javascript
  // ── Called by DataTab when user loads the first (primary) dataset ─────────
  const handlePrimaryLoad = async (data, fname) => {
    const ensRi = ensureRowIdentity;
    setRawData(ensRi(data));
    setFilename(fname);
    // Update project metadata with real row/col counts
    if (pid) {
      try {
        await saveProject(pid, { filename: fname, rowCount: data.rows?.length ?? 0, colCount: data.headers?.length ?? 0, datasetCount: 1 });
      } catch (e) { /* non-fatal */ }
    }
  };

  // ── Per-tab helpers ───────────────────────────────────────────────────────
  const tabDsId  = (tab) => activeDatasetIds[tab] ?? pid;
  const tabOutput = (tab) => outputs[tabDsId(tab)] ?? outputs[pid] ?? null;

  // Setter: update one tab's selection; optionally call switchToDataset
  const selectDataset = (tab, id, switchDs = false) => {
    setActiveDatasetIds(prev => ({ ...prev, [tab]: id }));
    if (switchDs) studioRef.current?.switchToDataset(id);
  };
```

with:

```javascript
  // ── Per-tab helpers ───────────────────────────────────────────────────────
  // Fallback is the project-wide active dataset (no privileged "primary == pid").
  const tabDsId   = (tab) => activeDatasetIds[tab] ?? activeDatasetId;
  const tabOutput = (tab) => outputs[tabDsId(tab)] ?? null;

  // Rows/headers for a tab's active dataset, sourced from the availableDatasets
  // mirror (which already carries rows+headers from DataStudio). Replaces the
  // old single `rawData` primary prop.
  const tabRawData = (tab) => {
    const id = tabDsId(tab);
    const ds = availableDatasets.find(d => d.id === id);
    return ds ? { rows: ds.rows ?? [], headers: ds.headers ?? [] } : null;
  };

  // Setter: update one tab's selection; optionally call switchToDataset
  const selectDataset = (tab, id, switchDs = false) => {
    setActiveDatasetIds(prev => ({ ...prev, [tab]: id }));
    if (switchDs) studioRef.current?.switchToDataset(id);
  };
```

- [ ] **Step 5: Update the WorkspaceBar `onRemoveDataset` tab fallback**

Replace `src/App.jsx:2136-2141`:

```javascript
                  // Reset any tab that was scoped to the deleted dataset → fall back to primary
                  setActiveDatasetIds(prev => {
                    const next = { ...prev };
                    Object.keys(next).forEach(tab => { if (next[tab] === id) next[tab] = pid; });
                    return next;
                  });
```

with:

```javascript
                  // Reset any tab scoped to the deleted dataset → clear its
                  // selection so it falls back to the project-wide active dataset.
                  setActiveDatasetIds(prev => {
                    const next = { ...prev };
                    Object.keys(next).forEach(tab => { if (next[tab] === id) next[tab] = null; });
                    return next;
                  });
```

- [ ] **Step 6: Update the Data tab render (drop `rawData`/`onLoadPrimary`)**

Replace `src/App.jsx:2169-2177`:

```javascript
                  <DataTab
                    filename={filename} rawData={rawData} studioRef={studioRef}
                    cleanedData={tabOutput("data")}
                    availableDatasets={availableDatasets}
                    activeDatasetId={tabDsId("data")}
                    onSelectDataset={id => selectDataset("data", id, true)}
                    onDeleteDataset={id => { studioRef.current?.removeDataset(id); }}
                    onLoadPrimary={handlePrimaryLoad}
                  />
```

with:

```javascript
                  <DataTab
                    filename={filename} studioRef={studioRef}
                    cleanedData={tabOutput("data")}
                    availableDatasets={availableDatasets}
                    activeDatasetId={tabDsId("data")}
                    onSelectDataset={id => selectDataset("data", id, true)}
                    onDeleteDataset={id => { studioRef.current?.removeDataset(id); }}
                  />
```

- [ ] **Step 7: Always-mount DataStudio on the Clean tab**

Replace `src/App.jsx:2181-2199`:

```javascript
                <div style={{...tabPanel, display: activeTab==="clean" ? "flex" : "none", flexDirection:"column"}}>
                  {rawData
                    ? <DataStudio
                        ref={studioRef}
                        key={pid}
                        rawData={rawData}
                        filename={filename}
                        pid={pid}
                        onComplete={handleComplete}
                        onOutputReady={handleOutputReady}
                        onDatasetsChange={dsList => {
                          setAvailableDatasets(dsList);
                          if (pid?.startsWith("proj_")) saveProject(pid, { datasetCount: dsList.length }).catch(()=>{});
                        }}
                        activeDatasetId={tabDsId("clean")}
                      />
                    : <NeedsData onGoToData={() => navigateToTab("data")}/>
                  }
                </div>
```

with:

```javascript
                <div style={{...tabPanel, display: activeTab==="clean" ? "flex" : "none", flexDirection:"column"}}>
                  <DataStudio
                    ref={studioRef}
                    key={pid}
                    projectPid={pid}
                    initialDatasets={initialDatasets}
                    onComplete={handleComplete}
                    onOutputReady={handleOutputReady}
                    onDatasetsChange={dsList => {
                      setAvailableDatasets(dsList);
                      if (pid?.startsWith("proj_")) saveProject(pid, { datasetCount: dsList.length }).catch(()=>{});
                    }}
                    onActiveDatasetChange={id => setActiveDatasetId(id)}
                    activeDatasetId={tabDsId("clean")}
                  />
                </div>
```

- [ ] **Step 8: Replace the Spatial tab rawData fallbacks**

Replace `src/App.jsx:2238-2239`:

```javascript
                    rows={tabOutput("spatial")?.cleanRows ?? rawData?.rows ?? []}
                    headers={tabOutput("spatial")?.headers ?? rawData?.headers ?? []}
```

with:

```javascript
                    rows={tabOutput("spatial")?.cleanRows ?? tabRawData("spatial")?.rows ?? []}
                    headers={tabOutput("spatial")?.headers ?? tabRawData("spatial")?.headers ?? []}
```

- [ ] **Step 9: Replace the Simulate tab rawData fallbacks and drop the primary-load branch**

Replace `src/App.jsx:2262-2280`:

```javascript
                  <SimulateTab
                    rows={tabOutput("simulate")?.cleanRows ?? rawData?.rows ?? []}
                    headers={tabOutput("simulate")?.headers ?? rawData?.headers ?? []}
                    onAddDataset={(name, rows, headers) => {
                      if (!rawData) {
                        handlePrimaryLoad({ headers, rows }, name).then(() => setActiveTab("clean"));
                      } else {
                        const newId = studioRef.current?.addApiData(name, rows, headers);
                        if (newId) selectDataset("simulate", newId); // auto-select only in Simulate
                      }
                    }}
                    onAddColumn={(colName, values) => {
                      const baseRows = tabOutput("simulate")?.cleanRows ?? rawData?.rows ?? [];
                      const merged = baseRows.map((r, i) => ({ ...r, [colName]: values[i] ?? null }));
                      const baseHdrs = tabOutput("simulate")?.headers ?? rawData?.headers ?? [];
                      const newHdrs = baseHdrs.includes(colName) ? baseHdrs : [...baseHdrs, colName];
                      const newId = studioRef.current?.addApiData(colName + "_augmented", merged, newHdrs);
                      if (newId) selectDataset("simulate", newId);
```

with:

```javascript
                  <SimulateTab
                    rows={tabOutput("simulate")?.cleanRows ?? tabRawData("simulate")?.rows ?? []}
                    headers={tabOutput("simulate")?.headers ?? tabRawData("simulate")?.headers ?? []}
                    onAddDataset={(name, rows, headers) => {
                      const newId = studioRef.current?.addApiData(name, rows, headers);
                      if (newId) selectDataset("simulate", newId); // auto-select only in Simulate
                    }}
                    onAddColumn={(colName, values) => {
                      const baseRows = tabOutput("simulate")?.cleanRows ?? tabRawData("simulate")?.rows ?? [];
                      const merged = baseRows.map((r, i) => ({ ...r, [colName]: values[i] ?? null }));
                      const baseHdrs = tabOutput("simulate")?.headers ?? tabRawData("simulate")?.headers ?? [];
                      const newHdrs = baseHdrs.includes(colName) ? baseHdrs : [...baseHdrs, colName];
                      const newId = studioRef.current?.addApiData(colName + "_augmented", merged, newHdrs);
                      if (newId) selectDataset("simulate", newId);
```

- [ ] **Step 10: Replace the Calculate tab rawData fallbacks**

Replace `src/App.jsx:2300-2310`:

```javascript
                    rows={tabOutput("calculate")?.cleanRows ?? rawData?.rows ?? []}
                    headers={tabOutput("calculate")?.headers ?? rawData?.headers ?? []}
                    onAddDataset={(name, rows, headers) => {
                      const newId = studioRef.current?.addApiData(name, rows, headers);
                      if (newId) selectDataset("calculate", newId);
                    }}
                    onAddColumn={(colName, values) => {
                      const baseRows = tabOutput("calculate")?.cleanRows ?? rawData?.rows ?? [];
                      const merged = baseRows.map((r, i) => ({ ...r, [colName]: values[i] ?? null }));
                      const baseHdrs = tabOutput("calculate")?.headers ?? rawData?.headers ?? [];
```

with:

```javascript
                    rows={tabOutput("calculate")?.cleanRows ?? tabRawData("calculate")?.rows ?? []}
                    headers={tabOutput("calculate")?.headers ?? tabRawData("calculate")?.headers ?? []}
                    onAddDataset={(name, rows, headers) => {
                      const newId = studioRef.current?.addApiData(name, rows, headers);
                      if (newId) selectDataset("calculate", newId);
                    }}
                    onAddColumn={(colName, values) => {
                      const baseRows = tabOutput("calculate")?.cleanRows ?? tabRawData("calculate")?.rows ?? [];
                      const merged = baseRows.map((r, i) => ({ ...r, [colName]: values[i] ?? null }));
                      const baseHdrs = tabOutput("calculate")?.headers ?? tabRawData("calculate")?.headers ?? [];
```

- [ ] **Step 11: Verify lint + build**

Run: `npm run lint && npm run build`
Expected: no errors. If lint reports `parseFileForPrimary` or `NeedsData` as unused, leave them for now — `NeedsData` is removed from the Clean tab but `parseFileForPrimary` is still used by `DataTab` (Task 4). `NeedsData` (App.jsx:287) is now unused; delete its definition if lint flags it as an error, otherwise leave it (it is harmless and `no-unused-vars` for module-scope functions is typically a warning).

- [ ] **Step 12: Commit**

```bash
git add src/App.jsx
git commit -m "refactor(app): thin container — drop primary rawData, add global activeDatasetId"
```

---

## Task 4: DataTab — read the active dataset from `availableDatasets`

`DataTab` no longer receives a privileged `rawData` prop or an `onLoadPrimary` callback. It derives the displayed rows/headers from the active dataset in `availableDatasets`, and routes every file/preloaded load through `studioRef.addParsed` (the same path as any other dataset).

**Files:**
- Modify: `src/App.jsx:804` (DataTab signature)
- Modify: `src/App.jsx:818-822` (view source derivation)
- Modify: `src/App.jsx:855-872` (handleFile load path)
- Modify: `src/App.jsx:897-904` (handlePreloaded load path)

- [ ] **Step 1: Update the DataTab signature**

Replace `src/App.jsx:804`:

```javascript
function DataTab({ filename, rawData, studioRef, cleanedData, availableDatasets = [], activeDatasetId, onSelectDataset, onDeleteDataset, onLoadPrimary }) {
```

with:

```javascript
function DataTab({ filename, studioRef, cleanedData, availableDatasets = [], activeDatasetId, onSelectDataset, onDeleteDataset }) {
```

- [ ] **Step 2: Derive the active dataset and the view source from it**

Replace `src/App.jsx:818-822`:

```javascript
  // Cleaned data takes priority for display; raw is the fallback
  const viewRows    = cleanedData?.cleanRows ?? rawData?.rows ?? [];
  const viewHeaders = cleanedData?.headers   ?? rawData?.headers ?? [];
  const viewFile    = cleanedData?.filename  ?? filename ?? "dataset";
  const isPipelined = !!cleanedData;
```

with:

```javascript
  // The active dataset (from the availableDatasets mirror) is the display source.
  const activeDs    = availableDatasets.find(d => d.id === activeDatasetId) ?? null;
  // Cleaned pipeline output takes priority; the active dataset's raw rows are the fallback.
  const viewRows    = cleanedData?.cleanRows ?? activeDs?.rows ?? [];
  const viewHeaders = cleanedData?.headers   ?? activeDs?.headers ?? [];
  const viewFile    = cleanedData?.filename  ?? activeDs?.filename ?? filename ?? "dataset";
  const isPipelined = !!cleanedData;
  const hasData     = !!(activeDs || cleanedData);
```

- [ ] **Step 3: Route file loads through `addParsed` (no primary branch)**

Replace `src/App.jsx:855-872`:

```javascript
      let firstName = ok[0].filename;
      let queue = ok;

      if (!rawData && onLoadPrimary) {
        // First parsed entry becomes the primary dataset.
        await onLoadPrimary(ok[0].parsed, ok[0].filename);
        queue = ok.slice(1);
      }

      // Remaining entries go to the studio as secondary datasets. studioRef
      // may not be mounted yet on the very first load — wait a frame so the
      // ref settles after onLoadPrimary triggers the studio mount.
      if (queue.length) {
        if (!studioRef.current) await new Promise(r => requestAnimationFrame(r));
        for (const r of queue) {
          if (studioRef.current?.addParsed) studioRef.current.addParsed(r.filename, r.parsed);
        }
      }
```

with:

```javascript
      const firstName = ok[0].filename;

      // Every dataset (including the first) loads through the studio's add path.
      // studioRef is always mounted on the Clean tab, but guard for the very
      // first frame after a brand-new project opens.
      if (!studioRef.current) await new Promise(r => requestAnimationFrame(r));
      for (const r of ok) {
        if (studioRef.current?.addParsed) studioRef.current.addParsed(r.filename, r.parsed);
      }
```

- [ ] **Step 4: Route preloaded loads through `addParsed` (no primary branch)**

Replace `src/App.jsx:897-904`:

```javascript
      if (!rawData && onLoadPrimary) {
        await onLoadPrimary(parsed, ds.filename);
        setSuccess(`"${ds.filename}" loaded as primary dataset.`);
      } else {
        if (!studioRef.current) await new Promise(r => requestAnimationFrame(r));
        studioRef.current?.addParsed?.(ds.filename, parsed);
        setSuccess(`"${ds.filename}" loaded — visible in Dataset Manager.`);
      }
      setPreloadedOpen(false);
```

with:

```javascript
      if (!studioRef.current) await new Promise(r => requestAnimationFrame(r));
      studioRef.current?.addParsed?.(ds.filename, parsed);
      setSuccess(`"${ds.filename}" loaded — visible in Dataset Manager.`);
      setPreloadedOpen(false);
```

- [ ] **Step 5: Verify lint + build**

Run: `npm run lint && npm run build`
Expected: no errors. There must be no remaining `rawData`/`onLoadPrimary` references inside `DataTab`. If `hasData` is unused after this step (it is provided for any "no data yet" hint the DataTab overview may already render against `viewRows.length`), lint will warn — if it errors, remove the `hasData` line; otherwise leave it.

- [ ] **Step 6: Commit**

```bash
git add src/App.jsx
git commit -m "refactor(datatab): source active dataset from availableDatasets; unify load path"
```

- [ ] **Step 7: First full browser validation**

Run: `npm run dev`
In the browser:
1. New project → Data tab → load **3** datasets (mix CSV/JSON).
2. Confirm all 3 appear in the Dataset Manager (top bar) and you can switch between them on the Clean tab.
3. Open the demo project from the dashboard → confirm the demo dataset loads and shows in the Data viewer.
4. **Close the browser**, `npm run dev` again, reopen the multi-dataset project → confirm **all 3** datasets survive and the last-active one is selected.

Expected: all datasets persist across the restart. If any dataset is missing, STOP and debug before continuing (do not proceed to UI polish).

---

## Task 5: Dataset Manager — wider, visually distinct, all datasets equal

Cosmetic changes only (spec §4). Deletion of any dataset already works here (the UI never had a primary guard — that lived in DataStudio, removed in Task 2). Make the trigger more visible and the dropdown wider, and drop any wording that implies a privileged dataset.

**Files:**
- Modify: `src/components/workspace/DatasetManager.jsx:236-247` (trigger badge)
- Modify: `src/components/workspace/DatasetManager.jsx:268-281` (dropdown width)

- [ ] **Step 1: Make the trigger badge more visible**

Replace `src/components/workspace/DatasetManager.jsx:236-247`:

```javascript
        <span style={{
          fontSize: 8,
          padding: "1px 5px",
          background: open ? `${C.gold}20` : `${C.teal}18`,
          border: `1px solid ${open ? C.goldDim : C.teal + "50"}`,
          borderRadius: 2,
          color: open ? C.gold : C.teal,
          fontWeight: 600,
          letterSpacing: "0.04em",
        }}>
          D·{count || 0}
        </span>
```

with:

```javascript
        <span style={{
          fontSize: 9,
          padding: "2px 7px",
          background: open ? `${C.gold}28` : `${C.teal}22`,
          border: `1px solid ${open ? C.gold : C.teal + "80"}`,
          borderRadius: 3,
          color: open ? C.gold : C.teal,
          fontWeight: 700,
          letterSpacing: "0.06em",
        }}>
          {count || 0} dataset{count === 1 ? "" : "s"}
        </span>
```

- [ ] **Step 2: Widen the dropdown panel**

Replace `src/components/workspace/DatasetManager.jsx:272-273`:

```javascript
          zIndex: 200,
          width: 280,
```

with:

```javascript
          zIndex: 200,
          width: 360,
```

- [ ] **Step 3: Verify lint + build**

Run: `npm run lint && npm run build`
Expected: no errors.

- [ ] **Step 4: Commit**

```bash
git add src/components/workspace/DatasetManager.jsx
git commit -m "feat(dataset-manager): wider, more visible panel; equal-dataset labeling"
```

---

## Task 6: Final acceptance — full in-browser validation

No automated harness (project convention). Run the spec §6 acceptance matrix end-to-end.

**Files:** none (validation only).

- [ ] **Step 1: Run the dev server**

Run: `npm run dev`

- [ ] **Step 2: Execute the acceptance matrix**

In a fresh project:
1. Load **≥3** datasets.
2. Delete an arbitrary **middle** dataset → the others remain; the active selection moves to a surviving dataset.
3. Delete the **first** dataset → it is removed (no longer protected); a surviving dataset becomes active.
4. Delete **all** datasets → the project is empty; the Clean tab shows the DataStudio empty-state and the Data tab shows the load prompt.
5. Load 2 datasets again, switch active to the 2nd, **close the browser**, `npm run dev`, reopen the project → both datasets survive and the **2nd (last-active)** is selected.
6. Confirm the Dataset Manager shows the correct count and no "primary/D1" privilege wording; deleting from it works for every row.

Expected: every check passes. Note any deviation for follow-up.

- [ ] **Step 3: Update the ClaudePlan spec-index status**

Edit `ClaudePlan.md` — change the row for `specs/2026-06-04-remove-primary-dataset-design.md` status from `OPEN` to `DONE` (or `IN PROGRESS` if any acceptance check is deferred), and append a short note describing what landed.

- [ ] **Step 4: Commit**

```bash
git add ClaudePlan.md
git commit -m "docs(plan): mark remove-primary-dataset spec DONE after browser validation"
```

---

## Self-review notes (author checklist — completed)

- **Spec coverage:** §1 data model → Task 1 (+ registry already in place); §2 App thin container → Task 3; §3 DataStudio source of truth → Task 2; §4 Dataset Manager UI → Task 5; §5 edge cases (empty project, demo seed, unified load path, always-mounted studio, id-keyed output, removed `[REG]` logs) → Tasks 2–4; §6 validation → Tasks 4 & 6. All sections mapped.
- **Type/name consistency:** new DataStudio props `projectPid`, `initialDatasets`, `onActiveDatasetChange` are defined in Task 2 Step 3/9 and consumed in Task 3 Step 7. App helper `tabRawData` defined in Task 3 Step 4 and used in Steps 8–10. `activeDatasetId` state defined in Task 3 Step 1, used in `tabDsId` (Step 4). No dangling references.
- **No placeholders:** every code step shows full old→new blocks with exact line anchors. Validation steps use `npm run lint`/`npm run build` + explicit browser steps (no JS test runner exists — documented convention).
- **Migration:** none, by design (spec). Legacy pid-keyed primary projects will show empty after this change; acceptable per user ("migration is not a problem").
