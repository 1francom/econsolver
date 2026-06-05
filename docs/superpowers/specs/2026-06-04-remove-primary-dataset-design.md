# Remove the "primary / main dataset" concept

**Date:** 2026-06-04
**Status:** Design approved — ready for implementation plan
**Author:** Franco + Claude

## Problem

After closing the browser and re-running `npm run dev`, only the first-loaded
dataset of a project survives; every other dataset disappears.

Root cause is two-fold and architectural, not a single bug:

1. **The secondary-dataset registry lived in `sessionStorage`** (key
   `econ_studio_secondary_ds_<pid>`), which is wiped when the browser closes.
   Only the *primary* dataset's rows were in IndexedDB (durable). So on reopen,
   the primary rehydrated and the rest were gone.

2. **The "primary dataset" is coupled to the project itself.** The primary's
   row data is keyed in IndexedDB by the project `pid` (not by its own dataset
   id). `App.jsx` holds a single `rawData` for the primary. Tab→dataset routing
   falls back to `pid` everywhere (`tabDsId(tab) ?? pid`). This privileged
   "dataset == project" identity is what keeps persistence fragile and is the
   reason the first dataset cannot be deleted.

The user's framing: *"in R there is no main dataset to start, neither should we
have."* All datasets should be equal, first-class, individually deletable
(including the first one), and durably persisted. A project may even be opened
with **no** datasets and have several loaded to start work.

## Goal

Eliminate the "primary / main dataset" concept entirely. After this change:

- A project is a **container** with an id (`pid`), a name, and a set of
  datasets — none privileged.
- Every dataset has its **own** id; none uses `pid` as its id.
- Every dataset's rows are stored in IndexedDB keyed by that dataset's own id.
- The full dataset registry for a project is stored in **IndexedDB** (durable),
  not sessionStorage.
- **Any** dataset can be deleted, including the first one. Deleting the last
  one leaves an empty project (valid state).
- On reopen, all datasets rehydrate and the last-worked-on dataset is selected.

**No migration.** Only Franco uses the tool today and existing project data is
disposable; we will not write a migration path for the old pid-keyed primary.

## Approach (Approach A — approved)

**DataStudio becomes the single source of truth for datasets; `App.jsx` becomes
a thin container.** DataStudio already owns dataset add/remove/patch logic and
the IndexedDB raw-data calls — it should own the *whole* registry too, instead
of App holding a special `rawData` for the primary.

Alternatives considered and rejected:

- **Patch the registry around the existing primary** (the first-attempt fix):
  move the secondary registry from sessionStorage into IndexedDB but keep the
  primary special. Rejected — it preserves the fragile coupling and still can't
  delete the first dataset. (This was tried and did not work.)
- **App.jsx owns everything, DataStudio is dumb:** rejected — DataStudio
  already has the imperative add/remove/patch surface and the IDB plumbing;
  inverting that is a larger, riskier change.

## Design

### Section 1 — Data model & persistence

A new IndexedDB object store holds **all** datasets per project:

```
dataset_registry  (keyPath: "pid")
  { pid, datasets: [ { id, filename, source, crs, headers, loadOpts, rowCount, colCount } ] }
```

- Each entry stores **metadata only** — never `rawData`/`rows` (those stay in
  the `raw_data` store, keyed by each dataset's own `id`).
- No dataset uses `pid` as its id; the first dataset gets a fresh `genId()` like
  any other.
- The `projects` store gains an `activeDatasetId` field (the last-worked-on
  dataset, restored on reopen).
- **No migration** from the old pid-keyed primary layout.

`indexedDB.js` gains:
- `saveDatasetRegistry(pid, datasets)` — strips `rawData`/`rows`, writes meta.
- `loadDatasetRegistry(pid)` — returns an array (never null; `[]` if absent).
- `deleteDatasetRegistry(pid)` — used by clearAllLocalData and project delete.

`clearAllLocalData()` clears the new store too.

(The first-attempt v7 additions in `indexedDB.js` are folded into this — the
registry now holds *all* datasets, not just secondaries.)

### Section 2 — App.jsx as a thin container

- **Delete** the `rawData` primary state and all primary-specific load paths
  (`handlePrimaryLoad`, `onLoadPrimary`, the "first file → primary, rest →
  addParsed" split).
- App tracks: `pid`, `projectName`, `activeDatasetId`, `outputs`,
  `availableDatasets` (mirror of DataStudio's registry, via `onDatasetsChange`).
- `tabDsId(tab)` fallback becomes `?? activeDatasetId` (not `?? pid`).
- `handleLoad(p)` sets `pid` + `activeDatasetId` from the project record; it does
  **not** load any rows itself (DataStudio rehydrates on mount).
- DataStudio is rendered (mounted) whenever a project is open — including when
  it has zero datasets — so `studioRef` exists before the first dataset is
  loaded. When no datasets exist, the Data tab shows a load prompt.

### Section 3 — DataStudio as source of truth

- **Drop** the `rawData` prop and the `primaryId = pid || genId()` seed.
- Add a container-only `projectPid` prop (used for registry keying), replacing
  the special primary identity.
- **Delete** `prevRawDataRef` and the newFile primary-sync effect.
- Seed `datasets` state empty; on mount, load the full registry via
  `loadDatasetRegistry(pid)`, then `loadRawData(id)` for each, then
  `setDatasets`. Set `hydratedRef.current = true` when done.
- On any datasets change (after hydration), persist the **full** registry via
  `saveDatasetRegistry(pid, datasets)` plus the current `activeDatasetId`.
- **Remove the primary-protected guards** in `handleRemove` / `removeDataset` /
  `removeDatasetLocal` — ANY dataset is deletable. Deleting the active one
  selects another (or none). Deleting the last → `datasets = []`.
- Remove the temporary `[REG]` debug logs from the first-attempt fix.

### Section 4 — Dataset Manager UI

- Wider and visually distinct (per "make it a bit more visible — other colours
  or a bit wider").
- All datasets rendered equally: no `D1`/primary label, no privileged styling.
- A delete control on **every** dataset row, including the first.
- The active (last-worked-on) dataset is highlighted.

### Section 5 — Edge cases & Data tab

- **Data tab role is unchanged:** it loads datasets and hosts the data viewer
  + summary statistics. (The Excel-like viewer upgrade is future / out of
  scope.) Internally it reads the active dataset's rows from
  `availableDatasets` filtered by `activeDatasetId`, instead of receiving a
  privileged `rawData` prop.
- **First file load uses the same path as any other** —
  `studioRef.addParsed` / `addFile`. There is no `onLoadPrimary` special case.
- **DataStudio is always mounted** (hidden when not on a data-bearing tab) on
  the Clean tab so `studioRef` exists before the first dataset.
- **Output routing** is keyed by dataset id (no `?? pid` fallback to a
  privileged dataset).
- **Demo project** (`wages_panel_demo`) load seeds exactly one dataset entry
  through the normal add path.
- **Empty project** is a valid state: a project can be open with zero datasets;
  the Data tab shows a load prompt.

### Section 6 — Validation

No automated harness (project convention: no JS test runner; Franco validates
in-browser). Manual acceptance:

1. Load N (≥3) datasets into a fresh project.
2. Delete an arbitrary middle dataset — others remain, active reselects.
3. Delete the first dataset — it is removed (no longer protected).
4. Delete all datasets — project is empty, Data tab shows load prompt.
5. Close the browser, `npm run dev`, reopen the project — all remaining
   datasets survive and the last-active dataset is selected.

## Out of scope

- Excel-like data viewer upgrade (future).
- Migration of pre-existing pid-keyed primary projects (none worth keeping).
- Cloud / Supabase pipeline sync (post-MVP, tracked separately).
