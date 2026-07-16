# Spatial Pipeline Integration — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Spatial Analyze operations join the non-destructive per-dataset pipeline — column-adding ops become replayable `sp_*` steps in the Clean pipeline; dataset-producing ops record derivation recipes via the existing derive-edge mechanism.

**Architecture:** New `sp_*` cases in `runner.js` call the existing pure `SpatialEngine.js` functions (fully self-contained JS — no proj4/CDN, all sync-safe). Secondary datasets resolve via `context.datasets[id]` exactly like `join`. UI: sections pass a serialized `stepSpec` alongside their preview; `OutputPanel` becomes dual-mode ("Add to pipeline" for column steps / name+Save-with-recipe for dataset producers). Spec: `docs/superpowers/specs/2026-07-16-spatial-pipeline-integration-design.md`.

**Tech Stack:** React + Vite JS, no new dependencies. Test harness: `node src/pipeline/__validation__/pipelineReliabilityValidation.mjs` (T5 registry↔runner sync + T1 per-step smoke), `npm run build`, `npm run lint:undef`.

**Verified context facts (do not re-derive):**
- `applyStep(rows, headers, s, context)` in [runner.js:182](../../src/pipeline/runner.js); inside a case, `R` = output rows, `H` = output headers, `rows`/`headers` = input. Context shape `{ datasets: { [id]: { rows, headers } } }`. `join` pattern: `const right = context?.datasets?.[s.rightId]; if (!right) break;`
- `SpatialEngine.js` is pure self-contained JS (hand-rolled UTM 32721; NO proj4) — every function callable synchronously from runner.
- `WranglingModule` builds `context` from `allDatasets` **raw** data ([WranglingModule.jsx:98-100](../../src/WranglingModule.jsx)) — referenced datasets replay against raw versions, same as `join` today.
- `addStep` ([WranglingModule.jsx:268](../../src/WranglingModule.jsx)) snapshots undo, tags `datasetId: pid`, appends; registered into `wranglingAddStepRef` via a no-dep-array effect at line 305-307. DataStudio exposes wrappers (`addInjectColumnStep` etc.) in its `useImperativeHandle` ([DataStudio.jsx:1004](../../src/DataStudio.jsx)).
- `addApiData(fname, rows, headers, recipe=null, options=null)` **already forwards to** `handleSaveSubset`, which records `ADD_GLOBAL_STEP {opType:"derive", params:{recipe}}` when `recipe` is non-null ([DataStudio.jsx:953-999](../../src/DataStudio.jsx)). App's spatial `onAddDataset` currently passes `null` recipe ([App.jsx:3113](../../src/App.jsx)).
- `serializeAllowedSteps(allowedCategories = ["cleaning","features"])` whitelists categories — a new `"spatial"` category is automatically excluded from the NL prompt. No change needed there.
- rScript.js already emits `# [unknown step: <type>]` for untranslated steps (line 661-662) — spec's visible-comment requirement holds for R; Task 9 verifies Python/Stata.
- `geocode` step already exists (registry keys: `addressCol, latCol, lonCol, provider, bbox, endpoint, apiKey`; runner case at line 1679 replays from cache). It is in the harness `WORKER_OR_NET` smoke-exemption set.
- `tabDsId("spatial")` (App per-tab selection) can differ from DataStudio's `activeId` (which decides which WranglingModule is mounted) — Task 4 handles this with a pending-step queue drained after `switchToDataset`.

**File map:**
| File | Change |
|---|---|
| `src/pipeline/registry.js` | +1 category, +11 step entries |
| `src/pipeline/runner.js` | +11 cases, +SpatialEngine imports |
| `src/pipeline/__validation__/pipelineReliabilityValidation.mjs` | +spatial fixtures, +SMOKE entries, per-step input support |
| `src/DataStudio.jsx` | +`addStepTo` imperative handle + pending-step drain effect |
| `src/App.jsx` | SpatialTab wiring: +`onAddStep`, recipe through `onAddDataset`, remove dead `onMergeColumns` |
| `src/components/tabs/SpatialTab.jsx` | `handleResult` carries `stepSpec`; save routing |
| `src/components/tabs/spatial/analyze/OutputPanel.jsx` | dual-mode commit bar |
| 12 section files in `src/components/tabs/spatial/analyze/` | emit `stepSpec` in `onResult` |

**stepSpec contract (used by Tasks 5-8):** every section's `onResult` gains a 4th argument:
```js
onResult(rows, newCols, baseHeaders /* or null */, stepSpec)
// stepSpec = { kind: "step",    step: { type: "sp_*", ...params } }        // column-adder → pipeline
//          | { kind: "dataset", step: { type: "sp_*", ...params } }        // producer → save-as-dataset + recipe
//          | null                                                          // no spec (never expected after this plan)
```

---

### Task 1: Registry entries + harness fixtures for the 7 column-adder step types (RED)

**Files:**
- Modify: `src/pipeline/registry.js`
- Modify: `src/pipeline/__validation__/pipelineReliabilityValidation.mjs`

- [ ] **Step 1: Add the `spatial` category**

In `src/pipeline/registry.js`, extend `CATEGORIES` (line 26):

```js
export const CATEGORIES = [
  { id: "cleaning",  label: "Cleaning"  },
  { id: "features",  label: "Features"  },
  { id: "reshape",   label: "Reshape"   },
  { id: "merge",     label: "Merge"     },
  { id: "spatial",   label: "Spatial"   },
];
```

- [ ] **Step 2: Add 7 registry entries**

Append to `STEP_REGISTRY` (before the closing `];`), a new `// ── SPATIAL ──` section. Params mirror the Analyze sections' `apply()` calls exactly (verified against each section file):

```js
  // ── SPATIAL ─────────────────────────────────────────────────────────────────
  // Column-adding spatial ops (Phase: spatial pipeline integration, 2026-07-16).
  // Steps referencing a second dataset resolve it via context.datasets[id],
  // identically to `join`. Category "spatial" is NOT in serializeAllowedSteps'
  // whitelist, so the NL command bar cannot emit these until validated.

  {
    type: "sp_distance",
    label: "Distance to point",
    category: "spatial",
    description: "Distance from each row's lat/lon to a fixed reference point (haversine km, or EPSG:32721 metric meters with optional distance bins).",
    schema: [
      { key: "latCol",  type: "col",     label: "Latitude column" },
      { key: "lonCol",  type: "col",     label: "Longitude column" },
      { key: "refLat",  type: "number",  label: "Reference latitude" },
      { key: "refLon",  type: "number",  label: "Reference longitude" },
      { key: "outCol",  type: "text",    label: "Output column" },
      { key: "metric",  type: "boolean", label: "EPSG:32721 metric distance (m)" },
      { key: "binCol",  type: "text",    label: "Distance bin column (optional, metric only)" },
    ],
    toLabel: s => `sp_distance → ${s.outCol}${s.metric ? " (m)" : " (km)"}`,
    defaultStep: () => ({ type: "sp_distance", latCol: "", lonCol: "", refLat: 0, refLon: 0, outCol: "dist_km", metric: false, binCol: "" }),
  },

  {
    type: "sp_crs_transform",
    label: "CRS transform",
    category: "spatial",
    description: "Transform point columns or a WKT geometry column between EPSG:4326 and EPSG:32721.",
    schema: [
      { key: "mode",   type: "select", label: "Mode", options: [
        { value: "point", label: "Point columns" },
        { value: "wkt",   label: "WKT geometry" },
      ]},
      { key: "source", type: "text", label: "Source CRS (EPSG:4326 / EPSG:32721)" },
      { key: "target", type: "text", label: "Target CRS" },
      { key: "xCol",   type: "col",  label: "X / longitude column (point mode)" },
      { key: "yCol",   type: "col",  label: "Y / latitude column (point mode)" },
      { key: "outX",   type: "text", label: "Output X column (point mode)" },
      { key: "outY",   type: "text", label: "Output Y column (point mode)" },
      { key: "wktCol", type: "col",  label: "WKT column (wkt mode)" },
      { key: "outWkt", type: "text", label: "Output WKT column (wkt mode)" },
    ],
    toLabel: s => `sp_crs_transform ${s.source} → ${s.target} [${s.mode}]`,
    defaultStep: () => ({ type: "sp_crs_transform", mode: "point", source: "EPSG:4326", target: "EPSG:32721", xCol: "", yCol: "", outX: "x_32721", outY: "y_32721", wktCol: "", outWkt: "geometry_32721" }),
  },

  {
    type: "sp_buffer",
    label: "Buffer indicator",
    category: "spatial",
    description: "Binary 0/1 indicator — 1 if the row's point lies within a radius (km) of a reference point.",
    schema: [
      { key: "latCol",   type: "col",    label: "Latitude column" },
      { key: "lonCol",   type: "col",    label: "Longitude column" },
      { key: "refLat",   type: "number", label: "Reference latitude" },
      { key: "refLon",   type: "number", label: "Reference longitude" },
      { key: "radiusKm", type: "number", label: "Radius (km)" },
      { key: "outCol",   type: "text",   label: "Output column" },
    ],
    toLabel: s => `sp_buffer ${s.radiusKm}km → ${s.outCol}`,
    defaultStep: () => ({ type: "sp_buffer", latCol: "", lonCol: "", refLat: 0, refLon: 0, radiusKm: 50, outCol: "in_buffer" }),
  },

  {
    type: "sp_grid_assign",
    label: "Grid assignment",
    category: "spatial",
    description: "Assign each point a grid cell ID — from an existing grid dataset (point-in-polygon), or quick rectangular/hex bins.",
    schema: [
      { key: "gridType", type: "select", label: "Grid type", options: [
        { value: "existing",    label: "Existing grid dataset" },
        { value: "rectangular", label: "Rectangular bins" },
        { value: "hex",         label: "Hex bins (approx.)" },
      ]},
      { key: "latCol",        type: "col",    label: "Latitude column" },
      { key: "lonCol",        type: "col",    label: "Longitude column" },
      { key: "outCol",        type: "text",   label: "Output column" },
      { key: "gridDatasetId", type: "text",   label: "Grid dataset id (existing mode)" },
      { key: "wktCol",        type: "text",   label: "Grid WKT column (existing mode)" },
      { key: "gridIdCol",     type: "text",   label: "Grid ID column (existing mode)" },
      { key: "extraCols",     type: "cols",   label: "Grid attribute columns to carry (existing mode)" },
      { key: "cellSize",      type: "number", label: "Cell size km (rectangular mode)" },
      { key: "resolution",    type: "number", label: "Resolution 0-5 (hex mode)" },
    ],
    toLabel: s => `sp_grid_assign [${s.gridType}] → ${s.outCol}`,
    defaultStep: () => ({ type: "sp_grid_assign", gridType: "existing", latCol: "", lonCol: "", outCol: "grid_id", gridDatasetId: "", wktCol: "", gridIdCol: "", extraCols: [], cellSize: 50, resolution: 2 }),
  },

  {
    type: "sp_spatial_join",
    label: "Spatial join (point-in-polygon)",
    category: "spatial",
    description: "Join polygon-dataset attributes onto each point by containment test against a WKT polygon column.",
    schema: [
      { key: "latCol",        type: "col",  label: "Latitude column" },
      { key: "lonCol",        type: "col",  label: "Longitude column" },
      { key: "polyDatasetId", type: "text", label: "Polygon dataset id" },
      { key: "wktCol",        type: "text", label: "Polygon WKT column" },
      { key: "joinCols",      type: "cols", label: "Polygon columns to join" },
      { key: "predicate",     type: "select", label: "Predicate", options: [
        { value: "within",     label: "within" },
        { value: "intersects", label: "intersects" },
      ]},
    ],
    toLabel: s => `sp_spatial_join (${s.predicate}) → ${(s.joinCols || []).join(", ")}`,
    defaultStep: () => ({ type: "sp_spatial_join", latCol: "", lonCol: "", polyDatasetId: "", wktCol: "", joinCols: [], predicate: "within" }),
  },

  {
    type: "sp_nearest",
    label: "Nearest neighbour",
    category: "spatial",
    description: "For each row, distance to (and index of) the nearest point in a reference dataset. refDatasetId \"self\" = same dataset.",
    schema: [
      { key: "latCol",       type: "col",     label: "Latitude column" },
      { key: "lonCol",       type: "col",     label: "Longitude column" },
      { key: "refDatasetId", type: "text",    label: "Reference dataset id (or \"self\")" },
      { key: "refLatCol",    type: "text",    label: "Reference latitude column" },
      { key: "refLonCol",    type: "text",    label: "Reference longitude column" },
      { key: "outDist",      type: "text",    label: "Distance output column" },
      { key: "outIdx",       type: "text",    label: "Index output column" },
      { key: "metric",       type: "boolean", label: "EPSG:32721 metric distance (m)" },
      { key: "binCol",       type: "text",    label: "Distance bin column (optional, metric only)" },
    ],
    toLabel: s => `sp_nearest → ${s.outDist}${s.metric ? " (m)" : " (km)"}`,
    defaultStep: () => ({ type: "sp_nearest", latCol: "", lonCol: "", refDatasetId: "self", refLatCol: "", refLonCol: "", outDist: "nn_dist_km", outIdx: "nn_idx", metric: false, binCol: "" }),
  },

  {
    type: "sp_boundary_dist",
    label: "Distance to boundary",
    category: "spatial",
    description: "Minimum distance from each point to the nearest polygon boundary, plus treatment indicator and signed running variable (Spatial RD).",
    schema: [
      { key: "latCol",        type: "col",  label: "Latitude column" },
      { key: "lonCol",        type: "col",  label: "Longitude column" },
      { key: "polyDatasetId", type: "text", label: "Boundary polygon dataset id" },
      { key: "wktCol",        type: "text", label: "Polygon WKT column" },
      { key: "outPrefix",     type: "text", label: "Output column prefix" },
    ],
    toLabel: s => `sp_boundary_dist → ${s.outPrefix || "boundary"}_dist_km/_treat/_running`,
    defaultStep: () => ({ type: "sp_boundary_dist", latCol: "", lonCol: "", polyDatasetId: "", wktCol: "", outPrefix: "boundary" }),
  },
```

- [ ] **Step 3: Add spatial fixtures + per-step input support to the harness**

In `pipelineReliabilityValidation.mjs`, after the `CTX` definition (line 46), add:

```js
// Spatial fixtures — Munich-ish points + two adjacent WKT grid cells (lon lat order).
const SP_POINTS = () => [
  { __ri: 0, name: "p1", lat: 48.14, lon: 11.55 },
  { __ri: 1, name: "p2", lat: 48.15, lon: 11.65 },
  { __ri: 2, name: "p3", lat: 48.30, lon: 11.90 },   // outside both cells
];
const SP_HEADERS = ["name", "lat", "lon"];
const SP_GRID = {
  rows: [
    { grid_id: "g1", zone: "west", wkt: "POLYGON((11.5 48.1, 11.6 48.1, 11.6 48.2, 11.5 48.2, 11.5 48.1))" },
    { grid_id: "g2", zone: "east", wkt: "POLYGON((11.6 48.1, 11.7 48.1, 11.7 48.2, 11.6 48.2, 11.6 48.1))" },
  ],
  headers: ["grid_id", "zone", "wkt"],
};
CTX.datasets.G1 = SP_GRID;

// T1 uses SMOKE_INPUT[type] when present; FIX/HEADERS otherwise.
const SMOKE_INPUT = {};
for (const t of ["sp_distance", "sp_crs_transform", "sp_buffer", "sp_grid_assign", "sp_spatial_join", "sp_nearest", "sp_boundary_dist"]) {
  SMOKE_INPUT[t] = { rows: SP_POINTS(), headers: SP_HEADERS };
}
```

Add the SMOKE configs to the `SMOKE` object:

```js
  sp_distance:      { latCol: "lat", lonCol: "lon", refLat: 48.14, refLon: 11.55, outCol: "dist_km", metric: false, binCol: "" },
  sp_crs_transform: { mode: "point", source: "EPSG:4326", target: "EPSG:32721", xCol: "lon", yCol: "lat", outX: "x_m", outY: "y_m" },
  sp_buffer:        { latCol: "lat", lonCol: "lon", refLat: 48.14, refLon: 11.55, radiusKm: 5, outCol: "in_buffer" },
  sp_grid_assign:   { gridType: "existing", latCol: "lat", lonCol: "lon", outCol: "grid_id", gridDatasetId: "G1", wktCol: "wkt", gridIdCol: "grid_id", extraCols: ["zone"] },
  sp_spatial_join:  { latCol: "lat", lonCol: "lon", polyDatasetId: "G1", wktCol: "wkt", joinCols: ["zone"], predicate: "within" },
  sp_nearest:       { latCol: "lat", lonCol: "lon", refDatasetId: "self", refLatCol: "lat", refLonCol: "lon", outDist: "nn_dist_km", outIdx: "nn_idx", metric: false, binCol: "" },
  sp_boundary_dist: { latCol: "lat", lonCol: "lon", polyDatasetId: "G1", wktCol: "wkt", outPrefix: "boundary" },
```

- [ ] **Step 4: Wire `SMOKE_INPUT` into the T1 loop**

Find the T1 loop where each registry type runs `applyStep` against `FIX()`/`HEADERS` (search for `section("T1`). Where the input rows/headers are chosen, replace with:

```js
const input = SMOKE_INPUT[t] ?? { rows: FIX(), headers: HEADERS };
// ... applyStep(input.rows, input.headers, step, CTX)
```

(Adapt variable names to the loop's actual locals — the change is only "use SMOKE_INPUT when present".)

- [ ] **Step 5: Run the harness — expect T5 FAIL (RED)**

Run: `node src/pipeline/__validation__/pipelineReliabilityValidation.mjs`
Expected: `[FAIL] every registry type ... has a runner case → sp_distance, sp_crs_transform, sp_buffer, sp_grid_assign, sp_spatial_join, sp_nearest, sp_boundary_dist` (and T1 smoke failures for the same types). Anything else failing = you broke an existing fixture; fix before proceeding.

---

### Task 2: Runner cases for the 7 column-adders (GREEN)

**Files:**
- Modify: `src/pipeline/runner.js`

- [ ] **Step 1: Import SpatialEngine functions**

At the top of `runner.js`, next to the existing imports:

```js
import {
  assignDistance, assignDistanceMetric, addDistanceBins,
  transformCoord, transformWKT,
  assignBuffer,
  assignPointsToGrid, assignRectGrid, assignH3Grid,
  spatialJoin,
  nearestNeighbor, nearestNeighborMetric,
  assignBoundaryDistance,
} from "../math/SpatialEngine.js";
```

- [ ] **Step 2: Add the 7 cases**

Insert after the existing `case "geocode"` block (ends line ~1686), a `// ── SPATIAL STEPS ──` section. Each case mirrors its section's `apply()` exactly:

```js
    // ── SPATIAL STEPS ─────────────────────────────────────────────────────────
    // Column-adding spatial ops. All SpatialEngine calls are pure sync JS.
    // Steps referencing another dataset resolve it via context.datasets[id]
    // (raw version — same contract as `join`) and no-op if it was deleted.

    case "sp_distance": {
      let out = s.metric
        ? assignDistanceMetric(rows, s.latCol, s.lonCol, Number(s.refLat), Number(s.refLon), s.outCol, "EPSG:32721")
        : assignDistance(rows, s.latCol, s.lonCol, Number(s.refLat), Number(s.refLon), s.outCol);
      const newCols = [s.outCol];
      if (s.metric && s.binCol) { out = addDistanceBins(out, s.outCol, s.binCol); newCols.push(s.binCol); }
      R = out;
      newCols.forEach(c => { if (!H.includes(c)) H = [...H, c]; });
      break;
    }

    case "sp_crs_transform": {
      if (s.mode === "wkt") {
        const prec = s.target === "EPSG:4326" ? 8 : 3;
        R = rows.map(r => ({
          ...r,
          [s.outWkt]: r[s.wktCol] ? transformWKT(String(r[s.wktCol]), s.source, s.target, prec) : null,
        }));
        if (!H.includes(s.outWkt)) H = [...H, s.outWkt];
      } else {
        R = rows.map(r => {
          const x = Number(r[s.xCol]), y = Number(r[s.yCol]);
          if (!isFinite(x) || !isFinite(y)) return { ...r, [s.outX]: null, [s.outY]: null };
          const [nx, ny] = transformCoord(x, y, s.source, s.target);
          return { ...r, [s.outX]: nx, [s.outY]: ny };
        });
        [s.outX, s.outY].forEach(c => { if (!H.includes(c)) H = [...H, c]; });
      }
      break;
    }

    case "sp_buffer": {
      R = assignBuffer(rows, s.latCol, s.lonCol, Number(s.refLat), Number(s.refLon), Number(s.radiusKm), s.outCol);
      if (!H.includes(s.outCol)) H = [...H, s.outCol];
      break;
    }

    case "sp_grid_assign": {
      const outCol = s.outCol || "grid_id";
      if (s.gridType === "existing") {
        const grid = context?.datasets?.[s.gridDatasetId];
        if (!grid?.rows?.length) break;
        const extraCols = s.extraCols || [];
        R = assignPointsToGrid(rows, s.latCol, s.lonCol, grid.rows, s.wktCol, s.gridIdCol, outCol,
          { attributeCols: extraCols, metricCrs: "EPSG:32721" });
        [outCol, "grid_row_index", ...extraCols].forEach(c => { if (!H.includes(c)) H = [...H, c]; });
      } else {
        R = s.gridType === "rectangular"
          ? assignRectGrid(rows, s.latCol, s.lonCol, Number(s.cellSize), outCol)
          : assignH3Grid(rows, s.latCol, s.lonCol, Number(s.resolution), outCol);
        if (!H.includes(outCol)) H = [...H, outCol];
      }
      break;
    }

    case "sp_spatial_join": {
      const poly = context?.datasets?.[s.polyDatasetId];
      if (!poly?.rows?.length) break;
      const joinCols = s.joinCols || [];
      R = spatialJoin(rows, s.latCol, s.lonCol, poly.rows, s.wktCol, joinCols, s.predicate || "within");
      joinCols.forEach(c => { if (!H.includes(c)) H = [...H, c]; });
      break;
    }

    case "sp_nearest": {
      const ref = s.refDatasetId === "self" ? { rows } : context?.datasets?.[s.refDatasetId];
      if (!ref?.rows?.length) break;
      let out = (s.metric ? nearestNeighborMetric : nearestNeighbor)(
        rows, s.latCol, s.lonCol,
        ref.rows, s.refLatCol, s.refLonCol,
        s.outDist, s.outIdx, "EPSG:32721");
      const newCols = [s.outDist, s.outIdx];
      if (s.metric && s.binCol) { out = addDistanceBins(out, s.outDist, s.binCol); newCols.push(s.binCol); }
      R = out;
      newCols.forEach(c => { if (!H.includes(c)) H = [...H, c]; });
      break;
    }

    case "sp_boundary_dist": {
      const poly = context?.datasets?.[s.polyDatasetId];
      if (!poly?.rows?.length) break;
      const pfx = s.outPrefix || "boundary";
      R = assignBoundaryDistance(rows, s.latCol, s.lonCol, poly.rows, s.wktCol, pfx);
      [`${pfx}_dist_km`, `${pfx}_treat`, `${pfx}_running`].forEach(c => { if (!H.includes(c)) H = [...H, c]; });
      break;
    }
```

- [ ] **Step 3: Run the harness — expect GREEN**

Run: `node src/pipeline/__validation__/pipelineReliabilityValidation.mjs`
Expected: all pass, 0 fail. If a T1 smoke fails, read the engine function's signature in `src/math/SpatialEngine.js` and fix the case (not the fixture) unless the fixture geometry is wrong.

- [ ] **Step 4: Build + commit**

Run: `npm run build` → green.
```bash
git add src/pipeline/registry.js src/pipeline/runner.js src/pipeline/__validation__/pipelineReliabilityValidation.mjs
git commit -m "feat(pipeline): 7 column-adding sp_* spatial step types in runner+registry"
```

---

### Task 3: Registry + runner + smoke for the 4 dataset-producer step types

These steps reshape rows (output = grid/target/buffer rows, not the input points). They get runner cases anyway — that keeps T5 green, makes recipes re-derivable, and matches `group_summarize` precedent (steps may change row count).

**Files:**
- Modify: `src/pipeline/registry.js`
- Modify: `src/pipeline/runner.js`
- Modify: `src/pipeline/__validation__/pipelineReliabilityValidation.mjs`

- [ ] **Step 1: Registry entries**

Append to the `// ── SPATIAL ──` registry section:

```js
  {
    type: "sp_metric_buffer",
    label: "Metric buffers",
    category: "spatial",
    description: "Create EPSG:32721 buffer polygons from point rows, or count points within a radius of grid centroids. Produces a derived dataset.",
    schema: [
      { key: "mode",   type: "select", label: "Mode", options: [
        { value: "point_buffers",  label: "Create buffer polygons" },
        { value: "grid_centroids", label: "Count points near grid centroids" },
      ]},
      { key: "latCol",        type: "col",    label: "Point latitude" },
      { key: "lonCol",        type: "col",    label: "Point longitude" },
      { key: "radius",        type: "number", label: "Radius (m)" },
      { key: "gridDatasetId", type: "text",   label: "Grid dataset id (grid_centroids mode)" },
      { key: "wktCol",        type: "text",   label: "Grid WKT column (grid_centroids mode)" },
      { key: "prefix",        type: "text",   label: "Output prefix (grid_centroids mode)" },
      { key: "outCol",        type: "text",   label: "Count output column (grid_centroids mode)" },
    ],
    toLabel: s => `sp_metric_buffer [${s.mode}] r=${s.radius}m`,
    defaultStep: () => ({ type: "sp_metric_buffer", mode: "point_buffers", latCol: "", lonCol: "", radius: 100, gridDatasetId: "", wktCol: "", prefix: "points", outCol: "" }),
  },

  {
    type: "sp_buffer_exposure",
    label: "Buffer exposure",
    category: "spatial",
    description: "Dissolved-buffer exposure share and/or overlapping-buffer count per grid cell. Produces a derived dataset (grid rows + exposure columns).",
    schema: [
      { key: "mode", type: "select", label: "Mode", options: [
        { value: "both",  label: "Share + count" },
        { value: "share", label: "Exposure share" },
        { value: "count", label: "Overlap count" },
      ]},
      { key: "bufferDatasetId", type: "text", label: "Buffer dataset id (or \"active\")" },
      { key: "gridDatasetId",   type: "text", label: "Grid dataset id (or \"active\")" },
      { key: "bufferWkt",       type: "text", label: "Buffer WKT column" },
      { key: "gridWkt",         type: "text", label: "Grid WKT column" },
      { key: "gridIdCol",       type: "text", label: "Grid ID column" },
      { key: "outPrefix",       type: "text", label: "Output prefix" },
    ],
    toLabel: s => `sp_buffer_exposure [${s.mode}] → ${s.outPrefix || "buffer"}_*`,
    defaultStep: () => ({ type: "sp_buffer_exposure", mode: "both", bufferDatasetId: "active", gridDatasetId: "", bufferWkt: "", gridWkt: "", gridIdCol: "", outPrefix: "buffer" }),
  },

  {
    type: "sp_aggregate_grid",
    label: "Aggregate points to grid",
    category: "spatial",
    description: "count/sum/mean/share of point rows per grid cell, by assigned grid_id or point-in-polygon. Produces a derived dataset (grid rows + aggregate column).",
    schema: [
      { key: "mode", type: "select", label: "Mode", options: [
        { value: "grid_id",  label: "Use assigned grid_id" },
        { value: "geometry", label: "Point-in-polygon" },
      ]},
      { key: "gridDatasetId", type: "text", label: "Grid dataset id" },
      { key: "gridIdCol",     type: "text", label: "Grid ID column (grid_id mode)" },
      { key: "pointGridCol",  type: "text", label: "Point grid ID column (grid_id mode)" },
      { key: "wktCol",        type: "text", label: "Grid WKT column (geometry mode)" },
      { key: "latCol",        type: "text", label: "Point latitude (geometry mode)" },
      { key: "lonCol",        type: "text", label: "Point longitude (geometry mode)" },
      { key: "fn", type: "select", label: "Aggregation", options: [
        { value: "count", label: "count" }, { value: "sum", label: "sum" },
        { value: "mean",  label: "mean"  }, { value: "share", label: "share" },
      ]},
      { key: "valueCol", type: "text", label: "Value column (non-count)" },
      { key: "outCol",   type: "text", label: "Output column" },
    ],
    toLabel: s => `sp_aggregate_grid ${s.fn === "count" ? "count" : `${s.fn}(${s.valueCol})`} → ${s.outCol}`,
    defaultStep: () => ({ type: "sp_aggregate_grid", mode: "grid_id", gridDatasetId: "", gridIdCol: "", pointGridCol: "", wktCol: "", latCol: "", lonCol: "", fn: "count", valueCol: "", outCol: "n_points" }),
  },

  {
    type: "sp_areal_interp",
    label: "Areal interpolation",
    category: "spatial",
    description: "Area-weighted interpolation of numeric columns from source polygons onto target polygons. Produces a derived dataset (target rows + interpolated columns).",
    schema: [
      { key: "srcDatasetId", type: "text",    label: "Source dataset id (or \"active\")" },
      { key: "tgtDatasetId", type: "text",    label: "Target dataset id (or \"active\")" },
      { key: "srcWkt",       type: "text",    label: "Source WKT column" },
      { key: "tgtWkt",       type: "text",    label: "Target WKT column" },
      { key: "tgtIdCol",     type: "text",    label: "Target ID column" },
      { key: "valueCols",    type: "cols",    label: "Value columns" },
      { key: "extensive",    type: "boolean", label: "Extensive (sums) vs intensive (means)" },
      { key: "outPrefix",    type: "text",    label: "Output prefix" },
    ],
    toLabel: s => `sp_areal_interp → ${(s.valueCols || []).map(c => s.outPrefix ? `${s.outPrefix}_${c}` : c).join(", ")}`,
    defaultStep: () => ({ type: "sp_areal_interp", srcDatasetId: "active", tgtDatasetId: "", srcWkt: "", tgtWkt: "", tgtIdCol: "", valueCols: [], extensive: true, outPrefix: "aw" }),
  },
```

- [ ] **Step 2: Runner imports + cases**

Extend the SpatialEngine import in `runner.js` with:
`createMetricPointBuffers, countPointsWithinGridCentroidBuffer, dissolveBuffers, gridExposureShare, countBuffersIntersectingGrid, aggregateToGrid, aggregateGridById, arealInterpolate`.

Append after the `sp_boundary_dist` case:

```js
    // Dataset-producing spatial ops. In a pipeline, input rows are the active
    // (parent) dataset; the OUTPUT rows are the derived shape (grid/target/
    // buffer rows). The "active" sentinel in dataset-id params means "use the
    // current pipeline rows".

    case "sp_metric_buffer": {
      const radius = Number(s.radius);
      if (s.mode === "grid_centroids") {
        const grid = context?.datasets?.[s.gridDatasetId];
        if (!grid?.rows?.length) break;
        const prefix = s.prefix || "points";
        R = countPointsWithinGridCentroidBuffer(grid.rows, s.wktCol, rows, s.latCol, s.lonCol, radius, prefix,
          { metricCrs: "EPSG:32721", outCol: s.outCol });
        H = [...new Set([...grid.headers, s.outCol, `${prefix}_buffer_radius_m`])];
      } else {
        R = createMetricPointBuffers(rows, s.latCol, s.lonCol, radius, { metricCrs: "EPSG:32721", segments: 48 });
        H = [...new Set([...H, "buffer_id", "buffer_radius_m", "center_lon", "center_lat", "center_x", "center_y", "geometry", "metric_geometry"])];
      }
      break;
    }

    case "sp_buffer_exposure": {
      const buf  = s.bufferDatasetId === "active" ? { rows, headers: H } : context?.datasets?.[s.bufferDatasetId];
      const grid = s.gridDatasetId   === "active" ? { rows, headers: H } : context?.datasets?.[s.gridDatasetId];
      if (!buf?.rows?.length || !grid?.rows?.length) break;
      const prefix = s.outPrefix || "buffer";
      const shareCol = `${prefix}_exposure_share`, countCol = `${prefix}_overlap_count`;
      let out = grid.rows;
      const newCols = [];
      if (s.mode === "share" || s.mode === "both") {
        const dissolved = dissolveBuffers(buf.rows, s.bufferWkt, { sourceCrs: "auto", metricCrs: "EPSG:32721", outputCrs: "EPSG:32721" });
        out = gridExposureShare(out, s.gridWkt, s.gridIdCol, dissolved,
          { gridSourceCrs: "auto", dissolvedSourceCrs: "EPSG:32721", metricCrs: "EPSG:32721", outCol: shareCol });
        newCols.push(shareCol, `${shareCol}_area_m2`, "area_total_m2");
      }
      if (s.mode === "count" || s.mode === "both") {
        out = countBuffersIntersectingGrid(out, s.gridWkt, s.gridIdCol, buf.rows, s.bufferWkt,
          { gridSourceCrs: "auto", bufferSourceCrs: "auto", metricCrs: "EPSG:32721", outCol: countCol });
        newCols.push(countCol);
      }
      R = out;
      H = [...new Set([...grid.headers, ...newCols])];
      break;
    }

    case "sp_aggregate_grid": {
      const grid = context?.datasets?.[s.gridDatasetId];
      if (!grid?.rows?.length) break;
      const spec = { col: s.fn === "count" ? "" : s.valueCol, fn: s.fn, outCol: s.outCol };
      R = s.mode === "grid_id"
        ? aggregateGridById(grid.rows, s.gridIdCol, rows, s.pointGridCol, [spec])
        : aggregateToGrid(grid.rows, s.wktCol, rows, s.latCol, s.lonCol, [spec]);
      H = [...new Set([...grid.headers, s.outCol])];
      break;
    }

    case "sp_areal_interp": {
      const src = s.srcDatasetId === "active" ? { rows, headers: H } : context?.datasets?.[s.srcDatasetId];
      const tgt = s.tgtDatasetId === "active" ? { rows, headers: H } : context?.datasets?.[s.tgtDatasetId];
      if (!src?.rows?.length || !tgt?.rows?.length) break;
      R = arealInterpolate(src.rows, s.srcWkt, tgt.rows, s.tgtWkt, s.tgtIdCol, s.valueCols || [],
        { sourceCrs: "auto", targetSourceCrs: "auto", metricCrs: "EPSG:32721", extensive: !!s.extensive, outPrefix: (s.outPrefix || "").trim() });
      const outCols = (s.valueCols || []).map(c => (s.outPrefix || "").trim() ? `${s.outPrefix.trim()}_${c}` : c);
      H = [...new Set([...tgt.headers, ...outCols])];
      break;
    }
```

- [ ] **Step 3: SMOKE configs + inputs**

In the harness, extend the `SMOKE_INPUT` loop's type list with `"sp_metric_buffer", "sp_buffer_exposure", "sp_aggregate_grid", "sp_areal_interp"`, and add to `SMOKE`:

```js
  sp_metric_buffer:   { mode: "point_buffers", latCol: "lat", lonCol: "lon", radius: 100 },
  sp_buffer_exposure: { mode: "count", bufferDatasetId: "G1", gridDatasetId: "G1", bufferWkt: "wkt", gridWkt: "wkt", gridIdCol: "grid_id", outPrefix: "buf" },
  sp_aggregate_grid:  { mode: "geometry", gridDatasetId: "G1", wktCol: "wkt", latCol: "lat", lonCol: "lon", fn: "count", valueCol: "", outCol: "n_points" },
  sp_areal_interp:    { srcDatasetId: "G1", tgtDatasetId: "G1", srcWkt: "wkt", tgtWkt: "wkt", tgtIdCol: "grid_id", valueCols: [], extensive: true, outPrefix: "aw" },
```

Note `sp_areal_interp` smoke with empty `valueCols` only asserts well-formedness; if the engine throws on empty valueCols, add a numeric column to `SP_GRID` (e.g. `pop: 100` / `pop: 200`, header `"pop"`) and use `valueCols: ["pop"]`.

- [ ] **Step 4: Run harness + build, commit**

Run: `node src/pipeline/__validation__/pipelineReliabilityValidation.mjs` → all pass.
Run: `npm run build` → green.
```bash
git add src/pipeline/registry.js src/pipeline/runner.js src/pipeline/__validation__/pipelineReliabilityValidation.mjs
git commit -m "feat(pipeline): 4 dataset-producing sp_* spatial step types"
```

---

### Task 4: DataStudio `addStepTo` + App.jsx wiring

**Files:**
- Modify: `src/DataStudio.jsx`
- Modify: `src/App.jsx:3106-3130`

- [ ] **Step 1: Pending-step queue in DataStudio**

The mounted WranglingModule (and therefore `wranglingAddStepRef`) always targets DataStudio's `activeId`. When the Spatial tab views a different dataset, we must switch first and add the step only after the new WranglingModule has registered its `addStep`. Next to `wranglingAddStepRef` (line 695):

```js
  // Step queued for a dataset that isn't Clean-active yet — set by addStepTo,
  // drained by the effect below once the target WranglingModule has mounted
  // and re-registered wranglingAddStepRef (child effects run before parents).
  const pendingStepRef = useRef(null);

  useEffect(() => {
    const p = pendingStepRef.current;
    if (p && p.datasetId === activeId && wranglingAddStepRef.current) {
      pendingStepRef.current = null;
      wranglingAddStepRef.current(p.step);
    }
  }); // no dep array — mirror of WranglingModule's addStepRef registration
```

- [ ] **Step 2: Expose `addStepTo` in the imperative handle**

In the `useImperativeHandle` block (after `addInjectColumnStep`, line 1119):

```js
    // Called by SpatialTab's "Add to pipeline" — appends a spatial sp_* step to
    // the pipeline of the dataset the Spatial tab is viewing, switching the
    // Clean-active dataset first when needed (step is queued until the target
    // WranglingModule mounts).
    addStepTo: (datasetId, step) => {
      if (!datasetId || datasetId === activeId) {
        wranglingAddStepRef.current?.(step);
        return;
      }
      pendingStepRef.current = { datasetId, step };
      setActiveId(datasetId);
    },
```

Add `activeId` to the `useImperativeHandle` dependency array (currently `[handleLoadFile, handleLoadFiles, addParsedDataset, handleSaveSubset]`).

- [ ] **Step 3: App.jsx SpatialTab wiring**

Replace the SpatialTab mount (App.jsx:3108-3129) props:
- add `onAddStep`,
- thread `recipe` through `onAddDataset`,
- **delete the dead `onMergeColumns` prop entirely** (SpatialTab never destructures it).

```jsx
                  <SpatialTab
                    rows={tabOutput("spatial")?.cleanRows ?? tabRawData("spatial")?.rows ?? []}
                    headers={tabOutput("spatial")?.headers ?? tabRawData("spatial")?.headers ?? []}
                    availableDatasets={availableDatasets}
                    pid={tabDsId("spatial")}
                    onAddStep={(step) => {
                      studioRef.current?.addStepTo?.(tabDsId("spatial"), step);
                    }}
                    onAddDataset={(name, rows, headers, options = null, recipe = null) => {
                      const newId = studioRef.current?.addApiData(name, rows, headers, recipe, options);
                      if (newId) selectDataset("spatial", newId);
                      return newId;
                    }}
                  />
```

(`addApiData` already forwards `recipe` to `handleSaveSubset`, which records the derive edge — no DataStudio change needed for this half.)

- [ ] **Step 4: Build + commit**

Run: `npm run build` and `npm run lint:undef` → green.
```bash
git add src/DataStudio.jsx src/App.jsx
git commit -m "feat(spatial): addStepTo imperative handle + SpatialTab onAddStep/recipe wiring"
```

---

### Task 5: SpatialTab stepSpec plumbing + dual-mode OutputPanel

**Files:**
- Modify: `src/components/tabs/SpatialTab.jsx`
- Modify: `src/components/tabs/spatial/analyze/OutputPanel.jsx`

- [ ] **Step 1: SpatialTab — accept `onAddStep`, carry `stepSpec`**

In `SpatialTab.jsx`:

1. Signature (line 29): `export default function SpatialTab({ rows = [], headers = [], availableDatasets = [], onAddDataset, onAddStep, pid }) {`
2. Add state next to `pendingKey` (line 35): `const [pendingStep, setPendingStep] = useState(null);`
3. `handleResult` (line 72) gains the 4th param and stores it:

```js
  const handleResult = useCallback((resultRows, newCols, baseHeaders = null, stepSpec = null) => {
    setPendingRows(resultRows);
    setPendingCols(newCols);
    setPendingHeaders(baseHeaders);
    setPendingStep(stepSpec);
    setPendingKey(sectionsKey);
  }, [sectionsKey]);
```

4. Replace `handleSave` with two handlers (dataset save now forwards the recipe; new step commit):

```js
  function clearPending() {
    setPendingRows(null);
    setPendingCols([]);
    setPendingHeaders(null);
    setPendingStep(null);
    setPendingKey(null);
  }

  function handleSave(name, resultRows) {
    const allHeaders = [...new Set([...(pendingHeaders ?? headers), ...pendingCols])];
    onAddDataset?.(name, resultRows, allHeaders, null, pendingStep?.step ?? null);
    clearPending();
  }

  function handleAddStep() {
    if (pendingStep?.kind === "step") onAddStep?.(pendingStep.step);
    clearPending();
  }
```

5. Pass the new props to `OutputPanel` (line 264):

```jsx
              <OutputPanel
                pendingRows={visiblePendingRows}
                pendingCols={pendingCols}
                pendingStep={pendingStep}
                onSave={handleSave}
                onAddStep={handleAddStep}
                C={C}
              />
```

- [ ] **Step 2: OutputPanel dual-mode**

Rewrite `OutputPanel.jsx`'s component body (keep file header comment and imports; `SaveBtn` stays for the dataset path):

```jsx
export function OutputPanel({ pendingRows, pendingCols, pendingStep, onSave, onAddStep, C }) {
  const { T } = useTheme();
  const [name, setName] = useState("spatial_result");

  if (!pendingRows) return null;
  const isStep = pendingStep?.kind === "step";
  return (
    <div style={{
      padding: "0.8rem 1rem",
      border: `1px solid ${C.teal}40`,
      borderRadius: 4,
      background: `${C.teal}08`,
      display: "flex", flexDirection: "column", gap: 8,
    }}>
      <span style={{ fontSize: T.caption.fontSize, color: C.teal }}>
        Ready — {pendingRows.length} rows · new col{pendingCols.length > 1 ? "s" : ""}: <strong>{pendingCols.join(", ")}</strong>
      </span>
      {isStep ? (
        <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
          <button
            onClick={onAddStep}
            style={{
              padding: "4px 14px", borderRadius: 3, cursor: "pointer",
              background: `${C.teal}18`, border: `1px solid ${C.teal}`,
              color: C.teal, fontFamily: T.code.fontFamily, fontSize: T.caption.fontSize,
            }}
          >➕ Add to pipeline</button>
          <span style={{ fontSize: T.caption.fontSize, color: C.textMuted }}>
            Appends a replayable step to this dataset's Clean pipeline (undo in History).
          </span>
        </div>
      ) : (
        <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
          <input
            value={name} onChange={e => setName(e.target.value)}
            placeholder="dataset name"
            style={{
              padding: "3px 8px", background: C.surface, border: `1px solid ${C.border2}`,
              borderRadius: 3, color: C.text, fontFamily: T.code.fontFamily, fontSize: T.caption.fontSize, outline: "none", width: 160,
            }}
          />
          <SaveBtn onClick={() => onSave(name, pendingRows)} disabled={!name} C={C} />
          {pendingStep?.kind === "dataset" && (
            <span style={{ fontSize: T.caption.fontSize, color: C.textMuted }}>
              Saves as a new dataset with its derivation recipe recorded.
            </span>
          )}
        </div>
      )}
    </div>
  );
}
```

(Backward compatibility: sections not yet migrated pass no `stepSpec` → `pendingStep` null → dataset path with no recipe, i.e. exactly today's behavior. This keeps Tasks 5-8 independently shippable.)

- [ ] **Step 3: Build + commit**

Run: `npm run build` and `npm run lint:undef` → green.
```bash
git add src/components/tabs/SpatialTab.jsx src/components/tabs/spatial/analyze/OutputPanel.jsx
git commit -m "feat(spatial): stepSpec plumbing + dual-mode OutputPanel (add-to-pipeline vs save-with-recipe)"
```

---

### Task 6: Column-adder sections emit stepSpec (8 sections)

**Files (all in `src/components/tabs/spatial/analyze/`):**
- Modify: `DistanceSection.jsx`, `CRSTransformSection.jsx`, `BufferSection.jsx`, `GridSection.jsx`, `SpatialJoinSection.jsx`, `NearestNeighborSection.jsx`, `BoundaryDistanceSection.jsx`, `GeocodeSection.jsx`

Each change is one line: the final `onResult(...)` call in `apply()` gains `null, { kind: "step", step: {...} }`. Param values are the exact locals already passed to the engine call (numbers already `Number()`-coerced where the engine call coerces).

- [ ] **Step 1: DistanceSection.jsx** — line 37, replace `onResult(out, cols);` with:

```js
      onResult(out, cols, null, { kind: "step", step: {
        type: "sp_distance", latCol, lonCol,
        refLat: Number(refLat), refLon: Number(refLon),
        outCol, metric, binCol: metric ? binCol.trim() : "",
      }});
```

- [ ] **Step 2: CRSTransformSection.jsx** — two call sites:

Line 41 (point mode), replace `onResult(out, [outX, outY]);` with:
```js
        onResult(out, [outX, outY], null, { kind: "step", step: {
          type: "sp_crs_transform", mode: "point", source, target, xCol, yCol, outX, outY, wktCol: "", outWkt: "",
        }});
```
Line 49 (wkt mode), replace `onResult(out, [outWkt]);` with:
```js
        onResult(out, [outWkt], null, { kind: "step", step: {
          type: "sp_crs_transform", mode: "wkt", source, target, xCol: "", yCol: "", outX: "", outY: "", wktCol, outWkt,
        }});
```

- [ ] **Step 3: BufferSection.jsx** — line 30, replace `onResult(out, [outCol]);` with:

```js
      onResult(out, [outCol], null, { kind: "step", step: {
        type: "sp_buffer", latCol, lonCol,
        refLat: Number(refLat), refLon: Number(refLon), radiusKm: Number(radius), outCol,
      }});
```

- [ ] **Step 4: GridSection.jsx** — two call sites:

Line 70 (existing mode), replace `onResult(out, cols);` with:
```js
        onResult(out, cols, null, { kind: "step", step: {
          type: "sp_grid_assign", gridType: "existing", latCol, lonCol, outCol,
          gridDatasetId: gridDsId, wktCol: effectiveWkt, gridIdCol: effectiveGridId, extraCols,
          cellSize: 0, resolution: 0,
        }});
```
Line 80 (rect/hex), replace `onResult(out, [outCol]);` with:
```js
      onResult(out, [outCol], null, { kind: "step", step: {
        type: "sp_grid_assign", gridType, latCol, lonCol, outCol,
        gridDatasetId: "", wktCol: "", gridIdCol: "", extraCols: [],
        cellSize: Number(cellSize), resolution: Number(resolution),
      }});
```

- [ ] **Step 5: SpatialJoinSection.jsx** — line 45, replace `onResult(out, joinCols);` with:

```js
      onResult(out, joinCols, null, { kind: "step", step: {
        type: "sp_spatial_join", latCol, lonCol,
        polyDatasetId: polyDsId, wktCol: effectiveWkt, joinCols, predicate,
      }});
```

- [ ] **Step 6: NearestNeighborSection.jsx** — line 52, replace `onResult(out, cols);` with:

```js
        onResult(out, cols, null, { kind: "step", step: {
          type: "sp_nearest", latCol, lonCol,
          refDatasetId: refDsId, refLatCol: effectiveRefLat, refLonCol: effectiveRefLon,
          outDist, outIdx, metric, binCol: metric ? binCol.trim() : "",
        }});
```

- [ ] **Step 7: BoundaryDistanceSection.jsx** — line 40, replace `onResult(out, newCols);` with:

```js
      onResult(out, newCols, null, { kind: "step", step: {
        type: "sp_boundary_dist", latCol, lonCol,
        polyDatasetId: polyDsId, wktCol: effectiveWkt, outPrefix,
      }});
```

- [ ] **Step 8: GeocodeSection.jsx** — reuses the EXISTING `geocode` step type (registry keys `addressCol, latCol, lonCol, provider, bbox, endpoint, apiKey`; `bbox` is the comma string). Line 85, replace `onResult(out, [latCol, lonCol]);` with:

```js
      onResult(out, [latCol, lonCol], null, { kind: "step", step: {
        type: "geocode", addressCol, latCol, lonCol, provider,
        bbox: Array.isArray(bbox) ? bbox.join(",") : (bbox ?? ""),
        endpoint: endpoint.trim(), apiKey: apiKey.trim(),
      }});
```

Replay note (already the step's existing contract): the runner's `geocode` case reads from the sessionStorage cache the section just populated — addresses beyond `maxRequests` stay null on replay too.

- [ ] **Step 9: Build + commit**

Run: `npm run build` and `npm run lint:undef` → green.
```bash
git add src/components/tabs/spatial/analyze/DistanceSection.jsx src/components/tabs/spatial/analyze/CRSTransformSection.jsx src/components/tabs/spatial/analyze/BufferSection.jsx src/components/tabs/spatial/analyze/GridSection.jsx src/components/tabs/spatial/analyze/SpatialJoinSection.jsx src/components/tabs/spatial/analyze/NearestNeighborSection.jsx src/components/tabs/spatial/analyze/BoundaryDistanceSection.jsx src/components/tabs/spatial/analyze/GeocodeSection.jsx
git commit -m "feat(spatial): column-adder sections emit sp_* stepSpec for add-to-pipeline"
```

---

### Task 7: Dataset-producer sections emit stepSpec (4 sections)

**Files (all in `src/components/tabs/spatial/analyze/`):**
- Modify: `MetricBufferSection.jsx`, `BufferExposureSection.jsx`, `AggregateToGridSection.jsx`, `ArealInterpolateSection.jsx`

Same pattern with `kind: "dataset"` — the spec becomes the `recipe` recorded by `handleSaveSubset`.

- [ ] **Step 1: MetricBufferSection.jsx** — two call sites:

Line 58 (point_buffers), replace `onResult(out, cols, headers);` with:
```js
        onResult(out, cols, headers, { kind: "dataset", step: {
          type: "sp_metric_buffer", mode: "point_buffers", latCol, lonCol, radius,
          gridDatasetId: "", wktCol: "", prefix: "", outCol: "",
        }});
```
Line 75 (grid_centroids), replace `onResult(out, cols, gridHeaders);` with:
```js
      onResult(out, cols, gridHeaders, { kind: "dataset", step: {
        type: "sp_metric_buffer", mode: "grid_centroids", latCol, lonCol, radius,
        gridDatasetId: gridDsId, wktCol: effectiveWkt, prefix, outCol: countCol,
      }});
```

- [ ] **Step 2: BufferExposureSection.jsx** — line 89, replace `onResult(out, cols, gridDs.headers);` with:

```js
      onResult(out, cols, gridDs.headers, { kind: "dataset", step: {
        type: "sp_buffer_exposure", mode,
        bufferDatasetId: bufferId, gridDatasetId: gridId,
        bufferWkt: effectiveBufferWkt, gridWkt: effectiveGridWkt,
        gridIdCol: effectiveGridId, outPrefix: prefix,
      }});
```

Note: `bufferId`/`gridId` may be the literal `"active"` sentinel — the runner case and the derive-edge consumer both treat `"active"` as "the parent dataset".

- [ ] **Step 3: AggregateToGridSection.jsx** — line 49, replace `onResult(out, [outCol], gridHeaders);` with:

```js
      onResult(out, [outCol], gridHeaders, { kind: "dataset", step: {
        type: "sp_aggregate_grid", mode, gridDatasetId: gridDsId,
        gridIdCol: mode === "grid_id" ? effectiveGridId : "",
        pointGridCol: mode === "grid_id" ? pointGridCol : "",
        wktCol: mode === "geometry" ? effectiveWkt : "",
        latCol: mode === "geometry" ? latCol : "",
        lonCol: mode === "geometry" ? lonCol : "",
        fn, valueCol: fn === "count" ? "" : valueCol, outCol,
      }});
```

- [ ] **Step 4: ArealInterpolateSection.jsx** — line 79, replace `onResult(out, outCols, targetDs.headers);` with:

```js
      onResult(out, outCols, targetDs.headers, { kind: "dataset", step: {
        type: "sp_areal_interp",
        srcDatasetId: sourceId, tgtDatasetId: targetId,
        srcWkt: effectiveSourceWkt, tgtWkt: effectiveTargetWkt,
        tgtIdCol: effectiveTargetId, valueCols, extensive,
        outPrefix: (outPrefix || "").trim(),
      }});
```

- [ ] **Step 5: Build + commit**

Run: `npm run build` and `npm run lint:undef` → green.
```bash
git add src/components/tabs/spatial/analyze/MetricBufferSection.jsx src/components/tabs/spatial/analyze/BufferExposureSection.jsx src/components/tabs/spatial/analyze/AggregateToGridSection.jsx src/components/tabs/spatial/analyze/ArealInterpolateSection.jsx
git commit -m "feat(spatial): dataset-producer sections emit derive-recipe stepSpec"
```

---

### Task 8: Untranslated-step comment check (Python/Stata) 

**Files:**
- Verify/possibly modify: `src/services/export/pythonScript.js`, `src/services/export/stataScript.js`

- [ ] **Step 1: Verify the default case in each generator's step transpiler**

`rScript.js` already emits `# [unknown step: ${step.type}]` (line 661-662). Grep the same pattern in the other two:

Run: `grep -n "unknown step" src/services/export/pythonScript.js src/services/export/stataScript.js`

- If both have an equivalent default returning a visible comment (`#` for Python, `*` or `//` for Stata) → no change; record the line numbers in the commit message of Task 9.
- If either silently returns `""`/`null`/skips: change its `default:` to return the language's comment, mirroring rScript:
  - Python: `return `# [unknown step: ${step.type}] not yet translated`;`
  - Stata: `return `* [unknown step: ${step.type}] not yet translated`;`

- [ ] **Step 2: If modified — build + commit**

Run: `npm run build` → green.
```bash
git add src/services/export/pythonScript.js src/services/export/stataScript.js
git commit -m "fix(export): visible comment for untranslated pipeline steps in py/stata scripts"
```

---

### Task 9: Final verification + docs

**Files:**
- Modify: `CLAUDE.md` (Pending section), `ClaudePlan.md` (index row status)

- [ ] **Step 1: Full verification suite**

Run all three; every one must be green:
```bash
node src/pipeline/__validation__/pipelineReliabilityValidation.mjs
npm run build
npm run lint:undef
```

- [ ] **Step 2: Update ClaudePlan.md index**

Change the `2026-07-16 specs/2026-07-16-spatial-pipeline-integration-design.md` row status from `OPEN — spec approved by Franco, implementation plan not yet written` to `CODE-COMPLETE <date> — browser-validation pending Franco (plan: plans/2026-07-16-spatial-pipeline-integration.md)`.

- [ ] **Step 3: Add CLAUDE.md pending entry**

Add to CLAUDE.md `## Pending` (top):

```markdown
**Spatial pipeline integration (2026-07-16)** — code-complete, browser-validation pending Franco. Spatial Analyze ops are pipeline citizens: 11 new `sp_*` step types in runner/registry (category "spatial", excluded from NL catalogue); column-adders commit via preview → "➕ Add to pipeline" (`addStepTo` handles Clean-active vs Spatial-active dataset mismatch with a pending-step queue); dataset-producers save through `handleSaveSubset(recipe)` → derive edge. R/Python/Stata translators for `sp_*` steps are a FOLLOW-UP (scripts emit `[unknown step]` comments meanwhile). **Franco: browser-test — add each column op both ways, undo/redo in History, reload persistence, spatial step on non-Clean-active dataset, derived grid joined in Clean, workspace script shows derive edge.**
```

- [ ] **Step 4: Commit**

```bash
git add CLAUDE.md ClaudePlan.md
git commit -m "docs: spatial pipeline integration status + validation checklist for Franco"
```

---

## Known follow-ups (out of scope, do NOT implement)

- R/Python/Stata translators for `sp_*` steps (spec phase 2).
- History warning when a referenced dataset was deleted (applies to `join` too).
- G-step ordering edges for column-adder steps that reference other datasets — recoverable later by scanning steps for `*DatasetId` params; needed only when translators land.
- Replay memoization for O(n×m) spatial steps.
