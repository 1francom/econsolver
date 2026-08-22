# Model & Explore Import/Export Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give Model and Explore the JSON export/import round-trip Clean already has, and close the cross-session portability hole in the Clean round-trip itself.

**Architecture:** One canonical `MODEL_SPEC_FIELDS` table owns what a model spec is; three call sites consume it (estimation stamp, pin restore, import). File parsing/validation lives in pure `.js` modules that take their allowed-id sets as **parameters**, so node harnesses can test them without importing `.jsx`. Dataset-reference checking is *derived* from `STEP_REGISTRY` rather than hand-listed in the importer.

**Tech Stack:** React 19 + Vite, plain JS, inline styles via the `C`/`T` theme objects. No test runner — validation harnesses are plain node `.mjs` scripts run with `node <path>`, printing `[pass]`/`[FAIL]` and exiting 1 on failure (pattern: `src/pipeline/__validation__/pipelineReliabilityValidation.mjs`).

**Spec:** `docs/superpowers/specs/2026-08-20-model-explore-import-export-design.md`

---

## Conventions for every task

- **Never use browser preview/automation tools.** After each task run `npm run build` (which runs `lint:undef` first). Franco does all browser validation.
- Inline styles only, using `C`/`T` from `useTheme()`. No new UI libraries.
- Surgical edits. Do not rewrite files.
- Commit after each task.

## File structure

| File | Responsibility |
|---|---|
| `src/components/modeling/modelSpec.js` **(new)** | `SE_TYPES`, `MODEL_SPEC_FIELDS`, `collectSpec`, `applySpec`, `specFormula`. Pure JS, no React import — must be node-importable. |
| `src/components/modeling/__validation__/modelSpecValidation.mjs` **(new)** | Harness for the above. |
| `src/services/export/artifactIO.js` **(new)** | `buildModelFile`/`parseModelFile`/`buildPlotsFile`/`parsePlotsFile`. Pure JS; allowed-id sets are parameters. |
| `src/services/export/__validation__/artifactIOValidation.mjs` **(new)** | Harness for the above. |
| `src/pipeline/portability.js` **(new)** | `datasetRefFields()`, `checkPipelinePortability()`. Derives ref fields from `STEP_REGISTRY`. |
| `src/components/modeling/ModelIOButtons.jsx` **(new)** | Export/Import buttons + the pick-a-spec modal for Model. |
| `src/components/modeling/InferenceOptions.jsx` | Import `SE_TYPES` from `modelSpec.js` instead of declaring it. |
| `src/components/ModelingTab.jsx` | `specExtras` via `collectSpec`; `onRestore` via `applySpec`; mount `ModelIOButtons`; HintBox copy. |
| `src/components/PlotBuilder.jsx` | Export `GEOMS`/`PALETTE_PRESETS`; add Export/Import plot buttons. |
| `src/pipeline/registry.js` | Declare dataset-reference schema fields as `type: "dataset"`. |
| `src/pipeline/__validation__/pipelineReliabilityValidation.mjs` | New T7 section: registry dataset-ref guard. |
| `src/components/wrangling/ImportPipelineButton.jsx` | Portability report (unresolvable refs, row-identity steps). |
| `src/components/wrangling/ExportMenu.jsx` | Stamp `datasetId` into the payload. |
| `src/WranglingModule.jsx` | Pass `datasetId`/`allDatasets` to the two above. |
| `src/ExplorerModule.jsx` | HintBox copy. |

---

## Task 1: `modelSpec.js` — the canonical spec table

> **SUPERSEDED IN PART — read this before using the code blocks below.** Task 1 shipped, was
> quality-reviewed, and the review found real defects that were fixed in a follow-up commit.
> The code blocks in this task are the *first* draft; the file on disk is the truth. The
> amendments, all of which the reviewer reproduced with runnable repros:
> - `feCols` gained `allowSynthetic` — `selectedFeCols` can hold `"state×year"`, a label built
>   at `ModelConfiguration.jsx:90` that is not a real column until estimation, and `columns`
>   filtering was silently downgrading a validated nested-FE spec to plain one-way FE.
> - Every field gained a `def`, and `applySpec` now writes it for fields absent from the spec.
>   Without it `applySpec` was a **merge onto the current sidebar, not a set** — restoring a
>   partial spec kept the previous model's `seType` and bandwidth.
> - `collectSpec` now serialises an explicit `null` for `columns`, because `selectedFeCols:
>   null` ("use the estimator's default FE") and `[]` ("none") are different states.
> - Added the two missing HAC fields, `timeVar` and `maxLag` — `seOpts` is a 5-tuple and the
>   table declared 3.
> - `applySpec` no longer throws on malformed input (it is the untrusted-file path), normalises
>   on write as `collectSpec` does on read, clears to `def` and reports on `enum`/`scalar`
>   failure, and validates `model`/`family` as enums.
> - `factorRefs` levels are validated when `ctx.levels` is supplied; the doc comment states
>   plainly that they are not validated otherwise.
> - Returned `missing` renamed to **`unapplied`** — it carries `panel-mismatch` and
>   `unknown-value` too. Tasks 3 and 5 below already use the new name.
> - Harness now drives the round-trip from the fixture keys and asserts a full key-set
>   snapshot, so deleting a field fails the harness instead of just producing fewer checks.
>
> **A second review round, after Task 3 wired it in, forced two more:**
> - **X and W travel under `xVarsRaw`/`wVarsRaw`, not `xVars`/`wVars`.** `estimationDispatch.js`
>   sets `spec.xVars` to the **expanded** design matrix (factor dummies, interaction products);
>   the sidebar list is the raw one. That is exactly why the old `specExtras` wrote separate
>   `xVarsRaw`/`wVarsRaw` keys. Spreading `collectSpec` over `result.spec` clobbered the
>   expanded arrays, and SunAbraham's export read `spec.xVars` to get its cohort/period/unit
>   filtered controls — so it started emitting the period column as a control. Fixed with the
>   table's existing `stateKey` mechanism: `{ key: "xVarsRaw", stateKey: "xVars", … }`. Every
>   exporter keeps its current contract untouched, and `specFormula` reads the raw keys.
> - **Legacy pins recover their estimator from `r.type`** — see Task 3's `onRestore`. `cutoff`
>   deliberately keeps the sidebar's *string*, not the engine's parsed number: it restores into
>   a text input, and the emitters interpolate it.

**Files:**
- Create: `src/components/modeling/modelSpec.js`
- Create: `src/components/modeling/__validation__/modelSpecValidation.mjs`

- [ ] **Step 1: Write the failing harness**

Create `src/components/modeling/__validation__/modelSpecValidation.mjs`:

```js
// ─── modelSpec harness ───────────────────────────────────────────────────────
// Plain node script (no test runner):
//   node src/components/modeling/__validation__/modelSpecValidation.mjs
// Prints [pass]/[FAIL] per check + a summary; exits 1 if anything fails.

import { MODEL_SPEC_FIELDS, SE_TYPES, collectSpec, applySpec, specFormula } from "../modelSpec.js";

let pass = 0, fail = 0;
const check = (n, c, extra) => {
  if (c) { pass++; console.log("  [pass]", n); }
  else   { fail++; console.log("  [FAIL]", n, extra != null ? "→ " + extra : ""); }
};
const section = (t) => console.log("\n── " + t + " ──");

// A full sidebar state, one fixture per estimator group.
const STATE = {
  OLS:     { model: "OLS", family: "linear", yVar: ["wage"], xVars: ["educ", "exper"], wVars: [],
             noIntercept: true, seType: "hc1", clusterVar: null, clusterVar2: null,
             factorVars: ["year"], factorRefs: { year: "2010" },
             interactionTerms: [{ var1: "educ", var2: "exper", type: "*" }] },
  Panel:   { model: "FE", family: "linear", yVar: ["wage"], xVars: ["educ"],
             selectedFeCols: ["firm", "year"], entityCol: "firm", timeCol: "year",
             seType: "clustered", clusterVar: "firm" },
  DiD:     { model: "TWFE", family: "linear", yVar: ["y"], xVars: [], treatVar: ["treat"], postVar: ["post"] },
  IV:      { model: "2SLS", family: "linear", yVar: ["wage"], xVars: ["educ"], zVars: ["dist"] },
  RD:      { model: "RDD", family: "linear", yVar: ["y"], runningVar: ["score"], cutoff: "50",
             bwMode: "manual", bwManual: "12.5", kernel: "uniform", polyOrder: 2 },
  SC:      { model: "SyntheticControl", family: "linear", yVar: ["gdp"], xVars: ["inv"],
             treatedUnit: "Basque", synthTreatTime: "1975", treatTimeCol: ["year"], kPre: 5, kPost: 4 },
  Spatial: { model: "SpatialRegression", family: "linear", yVar: ["price"], xVars: ["rooms"],
             spatialModel: "SDM", spatialWeightsMode: "dataset", spatialGeomCol: "geometry",
             spatialWeightsDatasetId: "ds_7", spatialWeightsType: "knn", spatialWeightsStyle: "W",
             spatialWeightsK: 6, spatialWeightsD: 500,
             spatialWeightsICol: "i", spatialWeightsJCol: "j", spatialWeightsWCol: "w" },
};

// Captures every setter applySpec calls, so a round-trip can be asserted
// without React.
function makeSetters(into) {
  const setters = {};
  for (const f of MODEL_SPEC_FIELDS) {
    if (!f.setter) continue;                     // panelRef fields have none
    setters[f.setter] = (v) => { into[f.stateKey ?? f.key] = typeof v === "function" ? v(into[f.stateKey ?? f.key]) : v; };
  }
  return setters;
}

const ALL_COLS = ["wage", "educ", "exper", "year", "firm", "y", "treat", "post", "dist",
                  "score", "gdp", "inv", "price", "rooms", "geometry"];

section("round-trip per estimator group");
for (const [group, state] of Object.entries(STATE)) {
  const spec = collectSpec(state);
  check(`${group}: spec is JSON-serialisable`,
    JSON.stringify(spec) === JSON.stringify(JSON.parse(JSON.stringify(spec))));
  const out = {};
  // panelRef fields are COMPARED against the dataset's declared panel, so the
  // round-trip ctx must state the panel this fixture was estimated on —
  // otherwise the Panel group reports a mismatch against a null panel.
  const { missing } = applySpec(spec, makeSetters(out), {
    headers: ALL_COLS,
    datasetIds: ["ds_7"],
    panel: { entityCol: state.entityCol ?? null, timeCol: state.timeCol ?? null },
  });
  check(`${group}: nothing reported missing`, missing.length === 0,
    missing.map(m => m.key).join(", "));
  for (const f of MODEL_SPEC_FIELDS) {
    if (f.kind === "panelRef") continue;              // recorded, never applied
    const k = f.stateKey ?? f.key;
    if (!(k in state)) continue;
    check(`${group}: ${k} round-trips`,
      JSON.stringify(out[k]) === JSON.stringify(state[k]),
      `${JSON.stringify(state[k])} → ${JSON.stringify(out[k])}`);
  }
}

section("functions never serialise");
{
  const spec = collectSpec({ ...STATE.Spatial, resolveSpatialWeights: () => 1 });
  check("no function-valued key survives",
    Object.values(spec).every(v => typeof v !== "function"));
  check("undeclared key is dropped",
    !("resolveSpatialWeights" in spec));
}

section("missing columns are reported by role, rest applied");
{
  const spec = collectSpec(STATE.OLS);
  const out = {};
  const { missing } = applySpec(spec, makeSetters(out), { headers: ["wage", "exper"], datasetIds: [] });
  const keys = missing.map(m => m.key).sort();
  check("yVar kept (present)", out.yVar[0] === "wage");
  check("xVars dropped educ, kept exper", JSON.stringify(out.xVars) === JSON.stringify(["exper"]));
  check("factorVars reported", keys.includes("factorVars"), keys.join(", "));
  check("missing entries carry the offending value",
    missing.every(m => "value" in m && "key" in m));
}

section("termList validated as a unit");
{
  const spec = collectSpec(STATE.OLS);
  const out = {};
  applySpec(spec, makeSetters(out), { headers: ["wage", "educ"], datasetIds: [] });  // exper absent
  check("half-term dropped entirely", JSON.stringify(out.interactionTerms) === "[]",
    JSON.stringify(out.interactionTerms));
}

section("panelRef compared, never applied");
{
  const spec = collectSpec(STATE.Panel);
  const out = {};
  const { missing } = applySpec(spec, makeSetters(out),
    { headers: ALL_COLS, datasetIds: [], panel: { entityCol: "id", timeCol: "t" } });
  check("entityCol not written to state", !("entityCol" in out));
  check("panel mismatch reported",
    missing.some(m => m.key === "entityCol" && m.reason === "panel-mismatch"),
    JSON.stringify(missing));
}

section("datasetRef checked against session dataset ids");
{
  const spec = collectSpec(STATE.Spatial);
  const out = {};
  const { missing } = applySpec(spec, makeSetters(out), { headers: ALL_COLS, datasetIds: ["other"] });
  check("unresolvable datasetRef reported",
    missing.some(m => m.key === "spatialWeightsDatasetId"));
  check("unresolvable datasetRef cleared, not left dangling", !out.spatialWeightsDatasetId);
}

section("specFormula");
{
  check("OLS formula", specFormula(collectSpec(STATE.OLS)) === "wage ~ educ + exper",
    specFormula(collectSpec(STATE.OLS)));
  check("IV formula names instruments",
    specFormula(collectSpec(STATE.IV)).includes("| dist"),
    specFormula(collectSpec(STATE.IV)));
  check("no y yields a placeholder", specFormula({}) === "(no outcome)");
}

section("SE_TYPES is the single owner");
check("every SE_TYPES entry has id + label",
  SE_TYPES.length > 0 && SE_TYPES.every(s => typeof s.id === "string" && typeof s.label === "string"));

console.log(`\nmodelSpec: ${pass} passed, ${fail} failed`);
if (fail > 0) process.exit(1);
```

- [ ] **Step 2: Run it to verify it fails**

```bash
node src/components/modeling/__validation__/modelSpecValidation.mjs
```

Expected: `ERR_MODULE_NOT_FOUND` — `../modelSpec.js` does not exist.

- [ ] **Step 3: Write `modelSpec.js`**

Create `src/components/modeling/modelSpec.js`:

```js
// ─── ECON STUDIO · components/modeling/modelSpec.js ──────────────────────────
// The canonical declaration of what a model spec IS. Three consumers:
//   1. ModelingTab's specExtras  — stamps the complete spec onto every result
//   2. ModelingTab's onRestore   — refills the sidebar from a pinned model
//   3. artifactIO / ModelIOButtons — model.json import
//
// Before this file existed, each consumer knew a different subset of the spec:
// `estimationDispatch.js` builds a per-estimator `spec` that is incomplete for
// several estimators, and onRestore refilled ~12 fields. One table, one truth.
//
// PURE JS — no React import. It must stay node-importable so
// __validation__/modelSpecValidation.mjs can exercise it directly.

// SE type vocabulary. Lives here (not in InferenceOptions.jsx) because it is
// part of the spec vocabulary and the node harness cannot import a .jsx file.
export const SE_TYPES = [
  { id: "classical", label: "Classical",     hint: "Homoskedastic OLS standard errors (default)" },
  { id: "hc1",       label: "HC1 (Robust)",  hint: "MacKinnon-White HC1 heteroskedasticity-robust SE — most common robust option" },
  { id: "hc2",       label: "HC2",           hint: "HC2 leverage-corrected robust SE — unbiased under homoskedasticity; default in R's iv_robust" },
  { id: "hc3",       label: "HC3",           hint: "HC3 leverage-corrected robust SE — preferred in small samples" },
  { id: "clustered", label: "Clustered",     hint: "Cluster-robust SE: accounts for within-group correlation" },
  { id: "cr2",       label: "CR2",           hint: "Bias-reduced cluster-robust SE (Bell-McCaffrey) — the clubSandwich / estimatr default; preferred with few clusters" },
  { id: "cr3",       label: "CR3",           hint: "Cluster jackknife approximation — more conservative than CR2" },
  { id: "twoway",    label: "Two-Way",       hint: "Two-way cluster-robust SE (Cameron-Gelbach-Miller)" },
  { id: "hac",       label: "HAC",           hint: "Newey-West heteroskedasticity-and-autocorrelation-consistent SE" },
];

export const SE_TYPE_IDS = SE_TYPES.map(s => s.id);

// Outcome families. `FAMILY_SUPPORT` in EstimatorSidebar.jsx says which
// ESTIMATOR supports which family; this is the vocabulary of family ids itself,
// which is what an imported file has to be checked against.
export const FAMILIES = ["linear", "poisson", "logit", "probit"];

// ── kinds ────────────────────────────────────────────────────────────────────
//   column     a single column name
//   columns    an array of column names
//   columnMap  { column: level } — factor reference categories
//   termList   [{ var1, var2, type }] — validated as a UNIT (see applySpec)
//   enum       one of `values`
//   datasetRef a session-local dataset id
//   panelRef   recorded and compared, NEVER applied (panel comes from the
//              dataset's panelIndex, not from sidebar state — no setter exists)
//   scalar     string | number | boolean | null
//
// `wrapped: true` means the sidebar state holds an ARRAY even for a single
// column (the VarPanel multi-select convention: yVar is ["wage"], read as [0]).
// `stateKey` is the ModelingTab state name when it differs from the spec key.
export const MODEL_SPEC_FIELDS = [
  { key: "model",             kind: "scalar",     setter: "setModel" },
  { key: "family",            kind: "scalar",     setter: "setFamily" },

  { key: "yVar",              kind: "column",     setter: "setYVar",       wrapped: true, role: "Outcome (Y)" },
  { key: "xVars",             kind: "columns",    setter: "setXVars",      role: "Regressors (X)" },
  { key: "wVars",             kind: "columns",    setter: "setWVars",      role: "Controls (W)" },
  { key: "zVars",             kind: "columns",    setter: "setZVars",      role: "Instruments (Z)" },
  { key: "weightVar",         kind: "column",     setter: "setWeightVar",  wrapped: true, role: "Weights" },

  { key: "factorVars",        kind: "columns",    setter: "setFactorVars", role: "Factor variables" },
  { key: "factorRefs",        kind: "columnMap",  setter: "setFactorRefs", role: "Factor reference category" },
  { key: "interactionTerms",  kind: "termList",   setter: "setInteractionTerms", role: "Interaction term" },
  { key: "noIntercept",       kind: "scalar",     setter: "setNoIntercept" },

  { key: "feCols",            kind: "columns",    setter: "setSelectedFeCols", stateKey: "selectedFeCols", role: "Fixed effects" },
  { key: "entityCol",         kind: "panelRef",   setter: null, role: "Panel entity" },
  { key: "timeCol",           kind: "panelRef",   setter: null, role: "Panel time" },

  { key: "treatVar",          kind: "column",     setter: "setTreatVar",   wrapped: true, role: "Treatment" },
  { key: "postVar",           kind: "column",     setter: "setPostVar",    wrapped: true, role: "Post period" },

  { key: "runningVar",        kind: "column",     setter: "setRunningVar", wrapped: true, role: "Running variable" },
  { key: "cutoff",            kind: "scalar",     setter: "setCutoff" },
  { key: "bwMode",            kind: "scalar",     setter: "setBwMode" },
  { key: "bwManual",          kind: "scalar",     setter: "setBwManual" },
  { key: "kernel",            kind: "scalar",     setter: "setKernel" },
  { key: "polyOrder",         kind: "scalar",     setter: "setPolyOrder" },

  { key: "treatedUnit",       kind: "scalar",     setter: "setTreatedUnit" },
  { key: "synthTreatTime",    kind: "scalar",     setter: "setSynthTreatTime" },
  { key: "treatTimeCol",      kind: "column",     setter: "setTreatTimeCol", wrapped: true, role: "Treatment time" },
  { key: "kPre",              kind: "scalar",     setter: "setKPre" },
  { key: "kPost",             kind: "scalar",     setter: "setKPost" },

  { key: "poissonEntityCol",  kind: "column",     setter: "setPoissonEntityCol", role: "Poisson entity" },
  { key: "poissonOffsetCol",  kind: "column",     setter: "setPoissonOffsetCol", role: "Poisson offset" },
  { key: "poissonExtraFE",    kind: "columns",    setter: "setPoissonExtraFE",   role: "Poisson extra FE" },

  { key: "cohortCol",         kind: "column",     setter: "setCohortCol", wrapped: true, role: "Cohort" },
  { key: "periodCol",         kind: "column",     setter: "setPeriodCol", wrapped: true, role: "Period" },
  { key: "saUnitCol",         kind: "column",     setter: "setSaUnitCol", role: "Sun-Abraham unit" },
  { key: "saControlMode",     kind: "scalar",     setter: "setSaControlMode" },
  { key: "saRefPeriod",       kind: "scalar",     setter: "setSaRefPeriod" },

  { key: "csTreatCol",        kind: "column",     setter: "setCsTreatCol",  wrapped: true, role: "CS first-treatment period" },
  { key: "csEntityCol",       kind: "column",     setter: "setCsEntityCol", wrapped: true, role: "CS entity" },
  { key: "csTimeCol",         kind: "column",     setter: "setCsTimeCol",   wrapped: true, role: "CS time" },
  { key: "csXCols",           kind: "columns",    setter: "setCsXCols",     role: "CS covariates" },
  { key: "csCompGroup",       kind: "scalar",     setter: "setCsCompGroup" },
  { key: "csRelMin",          kind: "scalar",     setter: "setCsRelMin" },
  { key: "csRelMax",          kind: "scalar",     setter: "setCsRelMax" },
  { key: "csEstMethod",       kind: "scalar",     setter: "setCsEstMethod" },
  { key: "csBasePeriod",      kind: "scalar",     setter: "setCsBasePeriod" },
  { key: "csAnticipation",    kind: "scalar",     setter: "setCsAnticipation" },
  { key: "csInfMethod",       kind: "scalar",     setter: "setCsInfMethod" },
  { key: "csNBoot",           kind: "scalar",     setter: "setCsNBoot" },
  { key: "csSeed",            kind: "scalar",     setter: "setCsSeed" },
  { key: "csDefaultView",     kind: "scalar",     setter: "setCsDefaultView" },

  { key: "spatialModel",           kind: "scalar",     setter: "setSpatialModel" },
  { key: "spatialWeightsMode",     kind: "scalar",     setter: "setSpatialWeightsMode" },
  { key: "spatialGeomCol",         kind: "column",     setter: "setSpatialGeomCol", role: "Geometry column" },
  { key: "spatialWeightsDatasetId", kind: "datasetRef", setter: "setSpatialWeightsDatasetId", role: "Spatial weights dataset" },
  { key: "spatialWeightsType",     kind: "scalar",     setter: "setSpatialWeightsType" },
  { key: "spatialWeightsStyle",    kind: "scalar",     setter: "setSpatialWeightsStyle" },
  { key: "spatialWeightsK",        kind: "scalar",     setter: "setSpatialWeightsK" },
  { key: "spatialWeightsD",        kind: "scalar",     setter: "setSpatialWeightsD" },
  // NOT kind:"column". These name columns in the WEIGHTS dataset — the one
  // spatialWeightsDatasetId points at — not in the dataset being modelled:
  // resolveSpatialWeights reads them as ds.rows.map(r => r[iCol])
  // (ModelingTab.jsx:625-631). Header-checking them against the active dataset
  // would make every imported spatial spec falsely report "i — not in this
  // dataset" and then clear a perfectly valid value.
  { key: "spatialWeightsICol",     kind: "scalar",     setter: "setSpatialWeightsICol" },
  { key: "spatialWeightsJCol",     kind: "scalar",     setter: "setSpatialWeightsJCol" },
  { key: "spatialWeightsWCol",     kind: "scalar",     setter: "setSpatialWeightsWCol" },

  { key: "seType",            kind: "enum", values: SE_TYPE_IDS, setter: "setSeType" },
  { key: "clusterVar",        kind: "column",     setter: "setClusterVar",  role: "Cluster variable" },
  { key: "clusterVar2",       kind: "column",     setter: "setClusterVar2", role: "Second cluster variable" },
];

const BY_KEY = new Map(MODEL_SPEC_FIELDS.map(f => [f.key, f]));

// Unwraps the VarPanel array convention to a bare value for serialisation.
function unwrap(v, f) {
  if (f.wrapped) return Array.isArray(v) ? (v[0] ?? null) : (v ?? null);
  return v;
}

function isPrimitive(v) {
  return v === null || ["string", "number", "boolean"].includes(typeof v);
}

// ── collectSpec ──────────────────────────────────────────────────────────────
// Builds a plain, JSON-safe spec from sidebar state. Anything not declared in
// MODEL_SPEC_FIELDS is DROPPED — the table doubles as the serialisation
// allowlist, which is what keeps function-valued state (resolveSpatialWeights)
// out of a file that gets written to disk and shared.
export function collectSpec(state = {}) {
  const spec = {};
  for (const f of MODEL_SPEC_FIELDS) {
    const raw = state[f.stateKey ?? f.key];
    if (raw === undefined) continue;
    const v = unwrap(raw, f);
    if (typeof v === "function") continue;
    switch (f.kind) {
      case "columns":
        if (Array.isArray(v)) spec[f.key] = v.filter(c => typeof c === "string");
        break;
      case "columnMap":
        if (v && typeof v === "object") {
          const m = {};
          for (const [k, lvl] of Object.entries(v)) if (isPrimitive(lvl)) m[k] = String(lvl);
          spec[f.key] = m;
        }
        break;
      case "termList":
        if (Array.isArray(v)) {
          spec[f.key] = v
            .filter(t => t && typeof t.var1 === "string" && typeof t.var2 === "string")
            .map(t => ({ var1: t.var1, var2: t.var2, type: t.type === ":" ? ":" : "*" }));
        }
        break;
      default:
        if (isPrimitive(v)) spec[f.key] = v;
    }
  }
  return spec;
}

// ── applySpec ────────────────────────────────────────────────────────────────
// Writes a spec into the sidebar via `setters` (keyed by the field's `setter`
// name). Applies partially: a field whose column is absent from `headers` is
// left empty and reported in `missing` instead of being silently written.
//
// ctx = { headers: string[], datasetIds: string[], panel: {entityCol,timeCol}|null }
export function applySpec(spec = {}, setters = {}, ctx = {}) {
  const headers    = new Set(ctx.headers ?? []);
  const datasetIds = new Set(ctx.datasetIds ?? []);
  const panel      = ctx.panel ?? null;
  const missing    = [];
  const report = (f, value, reason) =>
    missing.push({ key: f.key, role: f.role ?? f.key, value, reason });

  const write = (f, v) => {
    const set = f.setter ? setters[f.setter] : null;
    if (set) set(f.wrapped ? (v == null || v === "" ? [] : [v]) : v);
  };

  for (const f of MODEL_SPEC_FIELDS) {
    if (!(f.key in spec)) continue;
    const v = spec[f.key];

    switch (f.kind) {
      case "panelRef": {
        // Never applied — there is no setter. Compared so a spec estimated on a
        // differently-declared panel does not silently answer another question.
        const cur = panel?.[f.key] ?? null;
        if (v && cur !== v) report(f, v, "panel-mismatch");
        break;
      }
      case "column": {
        // Preserve the incoming falsy value verbatim — ModelingTab's column
        // state is inconsistent about its empty (clusterVar defaults to null,
        // spatialGeomCol to ""), and normalising here would make a round-trip
        // fail on a field the user never touched.
        if (v == null || v === "") { write(f, f.wrapped ? null : v); break; }
        if (headers.has(v)) write(f, v);
        else { report(f, v, "no-column"); write(f, f.wrapped ? null : ""); }
        break;
      }
      case "columns": {
        const kept = (v ?? []).filter(c => headers.has(c));
        const lost = (v ?? []).filter(c => !headers.has(c));
        if (lost.length) report(f, lost.join(", "), "no-column");
        write(f, kept);
        break;
      }
      case "columnMap": {
        const kept = {};
        const lost = [];
        for (const [col, lvl] of Object.entries(v ?? {})) {
          if (headers.has(col)) kept[col] = lvl; else lost.push(col);
        }
        if (lost.length) report(f, lost.join(", "), "no-column");
        write(f, kept);
        break;
      }
      case "termList": {
        // A term is validated as a UNIT: a half-term would render as an
        // editable but meaningless row and expandInteractions would build a
        // product against a missing operand.
        const kept = (v ?? []).filter(t => headers.has(t.var1) && headers.has(t.var2));
        const lost = (v ?? []).filter(t => !headers.has(t.var1) || !headers.has(t.var2));
        if (lost.length) report(f, lost.map(t => `${t.var1}${t.type}${t.var2}`).join(", "), "no-column");
        write(f, kept);
        break;
      }
      case "datasetRef": {
        if (!v) { write(f, ""); break; }
        if (datasetIds.has(v)) write(f, v);
        else { report(f, v, "no-dataset"); write(f, ""); }
        break;
      }
      case "enum": {
        if ((f.values ?? []).includes(v)) write(f, v);
        else report(f, v, "unknown-value");
        break;
      }
      default:
        if (isPrimitive(v)) write(f, v);
    }
  }
  return { applied: true, missing };
}

// ── specFormula ──────────────────────────────────────────────────────────────
// Human-readable one-liner for the import picker modal.
export function specFormula(spec = {}) {
  const y = spec.yVar;
  if (!y) return "(no outcome)";
  const rhs = [...(spec.xVars ?? []), ...(spec.wVars ?? [])];
  const base = `${y} ~ ${rhs.length ? rhs.join(" + ") : "1"}`;
  const parts = [base];
  if ((spec.zVars ?? []).length)  parts.push(`| ${spec.zVars.join(" + ")}`);
  if ((spec.feCols ?? []).length) parts.push(`| ${spec.feCols.join(" + ")}`);
  return parts.join(" ");
}

export { BY_KEY as MODEL_SPEC_BY_KEY };
```

- [ ] **Step 4: Run the harness to verify it passes**

```bash
node src/components/modeling/__validation__/modelSpecValidation.mjs
```

Expected: every check `[pass]`, final line `modelSpec: N passed, 0 failed`, exit 0.

- [ ] **Step 5: Negative-control the harness**

Temporarily change `case "termList"` in `applySpec` to keep half-terms (`const kept = v ?? [];`). Re-run. Expected: the "half-term dropped entirely" check FAILs and the script exits 1. Revert the change and re-run to confirm green again.

- [ ] **Step 6: Commit**

```bash
git add src/components/modeling/modelSpec.js src/components/modeling/__validation__/modelSpecValidation.mjs
git commit -m "feat(modeling): canonical MODEL_SPEC_FIELDS table with collectSpec/applySpec"
```

---

## Task 2: Make `InferenceOptions` consume the shared `SE_TYPES`

**Files:**
- Modify: `src/components/modeling/InferenceOptions.jsx:25-34`

- [ ] **Step 1: Delete the local declaration and import instead**

Delete the whole `const SE_TYPES = [ … ];` block at `InferenceOptions.jsx:25-34` and add to the import block at the top of the file:

```js
import { SE_TYPES } from "./modelSpec.js";
```

Leave `HAC_COMPATIBLE` where it is — it is a rendering concern, not spec vocabulary.

- [ ] **Step 2: Verify no other file declared its own copy**

```bash
grep -rn "SE_TYPES" src/ --include=*.js --include=*.jsx
```

Expected: exactly two hits — the declaration in `modelSpec.js` and the import in `InferenceOptions.jsx` — plus the usages inside `InferenceOptions.jsx`.

- [ ] **Step 3: Build**

```bash
npm run build
```

Expected: exits 0.

- [ ] **Step 4: Commit**

```bash
git add src/components/modeling/InferenceOptions.jsx
git commit -m "refactor(modeling): SE_TYPES has one owner (modelSpec.js)"
```

---

## Task 3: Wire `collectSpec`/`applySpec` into ModelingTab

**Files:**
- Modify: `src/components/ModelingTab.jsx:897` (specExtras), `:3845` (onRestore)

- [ ] **Step 1: Add the import**

At the top of `src/components/ModelingTab.jsx`, alongside the other `./modeling/` imports:

```js
import { collectSpec, applySpec } from "./modeling/modelSpec.js";
```

`MODELS` is also needed for `SPEC_CTX` below — extend the existing import at
`ModelingTab.jsx:78`, which currently pulls only `FAMILY_SUPPORT`:

```js
import EstimatorSidebar, { FAMILY_SUPPORT, MODELS } from "../components/modeling/EstimatorSidebar.jsx";
```

**Name collision:** `ModelingTab.jsx:813` already has a local `const modelSpec = useMemo(...)`
feeding `generateCoachingSignals`. Import the *functions*, as above — do not import the
module namespace as `modelSpec`, and do not rename the existing local.

- [ ] **Step 2: Replace the `specExtras` line**

At `ModelingTab.jsx:897`, replace:

```js
    const specExtras = { factorVars: [...factorVars], factorRefs: { ...factorRefs }, interactionTerms, xVarsRaw: [...xVars], wVarsRaw: [...wVars], filename: cleanedData?.filename ?? null, seType, clusterVar, clusterVar2, noIntercept };
```

with:

```js
    // collectSpec is the single owner of what a spec contains (modelSpec.js).
    // xVarsRaw/wVarsRaw/filename are NOT spec fields — they are replication
    // metadata the exporters read, so they stay stamped alongside it.
    const specExtras = {
      ...collectSpec({
        model, family, yVar, xVars, wVars, zVars, weightVar,
        // factorVars is a Set in ModelingTab state (`useState(() => new Set(...))`,
        // read via .has/.size at :1040/:1100). collectSpec's `columns` branch tests
        // Array.isArray, so passing the Set raw drops factors from every spec
        // silently. Spread on the way in; the setter re-wraps on the way out.
        factorVars: [...factorVars],
        factorRefs, interactionTerms, noIntercept,
        selectedFeCols: effectiveFeCols,
        entityCol: panel?.entityCol ?? null, timeCol: panel?.timeCol ?? null,
        treatVar, postVar, runningVar, cutoff, bwMode, bwManual, kernel, polyOrder,
        treatedUnit, synthTreatTime, treatTimeCol, kPre, kPost,
        poissonEntityCol, poissonOffsetCol, poissonExtraFE,
        cohortCol, periodCol, saUnitCol, saControlMode, saRefPeriod,
        csTreatCol, csEntityCol, csTimeCol, csXCols, csCompGroup, csRelMin, csRelMax,
        csEstMethod, csBasePeriod, csAnticipation, csInfMethod, csNBoot, csSeed, csDefaultView,
        spatialModel, spatialWeightsMode, spatialGeomCol, spatialWeightsDatasetId,
        spatialWeightsType, spatialWeightsStyle, spatialWeightsK, spatialWeightsD,
        spatialWeightsICol, spatialWeightsJCol, spatialWeightsWCol,
        // timeVar/maxLag are the other two thirds of seOpts (ModelingTab.jsx:601-608).
        // They MUST be collected: they now carry a `def`, so a spec that omits them
        // makes applySpec reset them to null on every restore — actively clearing
        // the user's HAC settings rather than merely failing to carry them.
        seType, clusterVar, clusterVar2, timeVar, maxLag,
      }),
      filename: cleanedData?.filename ?? null,
    };
```

- [ ] **Step 3: Extend the `_runEstimation` dep array**

At `ModelingTab.jsx:906`, the dep array is missing the spatial-weights detail fields that `collectSpec` now reads (they were previously only closed over by `resolveSpatialWeights`). Add them to the array, immediately after `spatialWeightsDatasetId`:

```js
spatialWeightsType, spatialWeightsStyle, spatialWeightsK, spatialWeightsD, spatialWeightsICol, spatialWeightsJCol, spatialWeightsWCol,
```

This matters for the same reason the SC/EventStudy/LSDV stale-closure bug in CLAUDE.md mattered: a field read inside the callback but absent from the deps is read at its initial value forever.

- [ ] **Step 4: Replace the `onRestore` body**

At `ModelingTab.jsx:3845`, replace the whole `onRestore={(id) => { … }}` prop (from `const r = modelBuffer.get(id);` through the closing of the arrow function, including the entire block of `setYVar`/`setXVars`/… calls and its comment) with:

```js
          onRestore={(id) => {
            const r = modelBuffer.get(id);
            if (!r) return;
            setResult(r);
            setActiveBufferId(id);
            // Refill the sidebar from the pinned model's spec so the user can
            // hit Estimate for a full, untrimmed re-computation (pinned models
            // are trimmed — no raw arrays, so plots needing row-level data
            // cannot render from the pinned copy alone). applySpec is the same
            // path the model.json import uses; there is no second restorer.
            // `model: r.type` first, so spec.model wins when present but a pin
            // saved BEFORE this table existed still recovers its estimator.
            // Those specs have no `model` key — the old specExtras never wrote
            // one — and applySpec resets an absent key to its def, silently, so
            // without this an RDD pin restores as OLS while the result panel
            // still says "RDD Results".
            const { unapplied } = applySpec(
              { model: r.type, ...(r.spec ?? {}) }, SPEC_SETTERS, SPEC_CTX);
            setSpecNotice(unapplied.length ? unapplied : null);
          }}
```

- [ ] **Step 5: Define `SPEC_SETTERS` and `specNotice`**

Immediately after the `clusterVar2` state declaration (`ModelingTab.jsx:600`), add:

```js
  // Fields reported as unapplied by the last applySpec call (pin restore or
  // model.json import). Rendered as a banner above the estimator sidebar.
  const [specNotice, setSpecNotice] = useState(null);

  // Setter table consumed by applySpec — keys are the `setter` names declared
  // in MODEL_SPEC_FIELDS. useMemo so it is stable across renders.
  const SPEC_SETTERS = useMemo(() => ({
    setModel, setFamily, setYVar, setXVars, setWVars, setZVars, setWeightVar,
    // applySpec hands `columns` fields an ARRAY, but factorVars state is a Set —
    // writing the array straight through would break .has/.size at :1040/:1100.
    setFactorVars: (arr) => setFactorVars(new Set(arr ?? [])),
    setFactorRefs, setInteractionTerms, setNoIntercept,
    setSelectedFeCols, setTimeVar, setMaxLag,
    setTreatVar, setPostVar,
    setRunningVar, setCutoff, setBwMode, setBwManual, setKernel, setPolyOrder,
    setTreatedUnit, setSynthTreatTime, setTreatTimeCol, setKPre, setKPost,
    setPoissonEntityCol, setPoissonOffsetCol, setPoissonExtraFE,
    setCohortCol, setPeriodCol, setSaUnitCol, setSaControlMode, setSaRefPeriod,
    setCsTreatCol, setCsEntityCol, setCsTimeCol, setCsXCols, setCsCompGroup,
    setCsRelMin, setCsRelMax, setCsEstMethod, setCsBasePeriod, setCsAnticipation,
    setCsInfMethod, setCsNBoot, setCsSeed, setCsDefaultView,
    setSpatialModel, setSpatialWeightsMode, setSpatialGeomCol, setSpatialWeightsDatasetId,
    setSpatialWeightsType, setSpatialWeightsStyle, setSpatialWeightsK, setSpatialWeightsD,
    setSpatialWeightsICol, setSpatialWeightsJCol, setSpatialWeightsWCol,
    setSeType, setClusterVar, setClusterVar2,
  }), []);

  // Context applySpec validates against. ONE definition, shared by the pin-restore
  // path and the model.json import — they must agree or the two paths accept
  // different specs.
  //   modelIds           — without it, an unknown estimator id writes straight
  //                        through to setModel unvalidated.
  //   defaultFactorVars  — factorVars' real default is dataset-dependent (all
  //                        non-numeric columns, ModelingTab.jsx:444), so no static
  //                        `def` can express it. Omitting this makes a spec that
  //                        carries no factorVars reset every string column to
  //                        "not a factor", which puts it in the design matrix as
  //                        Number(...) instead of dummies.
  const SPEC_CTX = useMemo(() => ({
    headers,
    datasetIds: (availableDatasets || []).map(d => d.id),
    panel,
    modelIds: MODELS.map(m => m.id),
    defaultFactorVars: headers.filter(h => !numericCols.includes(h)),
  }), [headers, availableDatasets, panel, numericCols]);
```

- [ ] **Step 6: Render the notice banner**

Immediately before the `<ModelBufferBar` element (`ModelingTab.jsx:~3839`), add:

```jsx
        {/* ── Unapplied spec fields (pin restore / model.json import) ── */}
        {specNotice && (
          <div style={{
            margin: "0 0 0.6rem", padding: "0.55rem 0.75rem",
            background: C.surface2, border: `1px solid ${C.gold}`, borderLeft: `3px solid ${C.gold}`,
            borderRadius: 3, fontFamily: T.code.fontFamily, fontSize: T.caption.fontSize,
            color: C.textDim, lineHeight: 1.6,
          }}>
            <div style={{ color: C.gold, marginBottom: 4 }}>
              {specNotice.length} field{specNotice.length !== 1 ? "s" : ""} could not be applied
            </div>
            {specNotice.map((m, i) => (
              <div key={i}>
                {m.role}: <span style={{ color: C.text }}>{String(m.value)}</span>
                {" — "}
                {m.reason === "no-column"      ? "not in this dataset"
                 : m.reason === "no-dataset"    ? "no such dataset in this session"
                 : m.reason === "no-level"      ? "not a level of this column"
                 : m.reason === "bad-shape"     ? "malformed in the file — reset to default"
                 : m.reason === "panel-mismatch" ? "this dataset declares a different panel index"
                 : "unrecognised value"}
              </div>
            ))}
            <button onClick={() => setSpecNotice(null)}
              style={{ marginTop: 6, padding: "0.18rem 0.55rem", background: "transparent",
                border: `1px solid ${C.border2}`, color: C.textDim, borderRadius: 2,
                cursor: "pointer", fontSize: T.caption.fontSize, fontFamily: T.code.fontFamily }}>
              Dismiss
            </button>
          </div>
        )}
```

- [ ] **Step 7: Build**

```bash
npm run build
```

Expected: exits 0. If `lint:undef` reports an undefined identifier, a setter listed in `SPEC_SETTERS` does not exist under that name — fix the name, do not delete the entry.

- [ ] **Step 8: Commit**

```bash
git add src/components/ModelingTab.jsx
git commit -m "fix(modeling): pin restore refills the whole spec, not 12 fields"
```

---

## Task 4: `artifactIO.js` — file build/parse for model.json and plots.json

**Files:**
- Create: `src/services/export/artifactIO.js`
- Create: `src/services/export/__validation__/artifactIOValidation.mjs`

- [ ] **Step 1: Write the failing harness**

Create `src/services/export/__validation__/artifactIOValidation.mjs`:

```js
// ─── artifactIO harness ──────────────────────────────────────────────────────
//   node src/services/export/__validation__/artifactIOValidation.mjs

import { buildModelFile, parseModelFile, buildPlotsFile, parsePlotsFile } from "../artifactIO.js";

let pass = 0, fail = 0;
const check = (n, c, extra) => {
  if (c) { pass++; console.log("  [pass]", n); }
  else   { fail++; console.log("  [FAIL]", n, extra != null ? "→ " + extra : ""); }
};
const section = (t) => console.log("\n── " + t + " ──");

const VOCAB = { modelIds: ["OLS", "FE", "2SLS"], seTypeIds: ["classical", "hc1"],
                families: ["linear", "poisson"] };
const PLOT_VOCAB = { geoms: ["point", "line", "bar"], schemes: ["", "teal-gold", "observable10"] };

const PINS = [
  { id: "m1", label: "Baseline", type: "OLS", spec: { model: "OLS", family: "linear", yVar: "wage", xVars: ["educ"], seType: "hc1" } },
  { id: "m2", label: "With FE",  type: "FE",  spec: { model: "FE",  family: "linear", yVar: "wage", xVars: ["educ"], feCols: ["firm"] } },
];

const PLOTS = [
  { id: "ph_1", name: "Plot 1", savedAt: 1, datasetId: "ds_a", datasetName: "wages",
    layers: [{ id: "L1", geom: "point", aes: { x: "educ", y: "wage" }, visible: true }],
    title: "T", xLabel: "", yLabel: "", scheme: "teal-gold", xScale: "linear", yScale: "linear",
    facetCol: "", facetCols: 3 },
];

section("model file round-trip");
{
  const file = buildModelFile(PINS);
  check("kind stamped", file.kind === "litux/model-specs", file.kind);
  check("version stamped", file.version === 1);
  check("carries both pins", file.models.length === 2);
  check("carries no result fields", file.models.every(m => !("beta" in m) && !("se" in m) && !("n" in m)));
  const res = parseModelFile(JSON.stringify(file), VOCAB);
  check("parses back clean", res.ok === true, JSON.stringify(res.error));
  check("specs survive", res.models[0].spec.yVar === "wage");
}

section("model file rejects");
{
  check("non-JSON", parseModelFile("{oops", VOCAB).error?.includes("valid JSON"));
  check("wrong kind", parseModelFile(JSON.stringify({ version: 1, kind: "litux/plots", plots: [] }), VOCAB)
    .error?.includes("plots"));
  check("unknown estimator aborts",
    parseModelFile(JSON.stringify({ version: 1, kind: "litux/model-specs",
      models: [{ type: "WARP", spec: {} }] }), VOCAB).error?.includes("WARP"));
  check("unknown seType aborts",
    parseModelFile(JSON.stringify({ version: 1, kind: "litux/model-specs",
      models: [{ type: "OLS", spec: { seType: "bootstrap" } }] }), VOCAB).error?.includes("bootstrap"));
  check("unknown family aborts",
    parseModelFile(JSON.stringify({ version: 1, kind: "litux/model-specs",
      models: [{ type: "OLS", family: "tobit", spec: {} }] }), VOCAB).error?.includes("tobit"));
  check("empty list rejected",
    parseModelFile(JSON.stringify({ version: 1, kind: "litux/model-specs", models: [] }), VOCAB)
      .error?.includes("empty"));
}

section("plots file round-trip");
{
  const file = buildPlotsFile(PLOTS);
  check("kind stamped", file.kind === "litux/plots", file.kind);
  check("session-local identity stripped",
    file.plots.every(p => !("id" in p) && !("savedAt" in p) && !("datasetId" in p) && !("datasetName" in p)),
    JSON.stringify(Object.keys(file.plots[0])));
  check("name kept", file.plots[0].name === "Plot 1");
  const res = parsePlotsFile(JSON.stringify(file), PLOT_VOCAB);
  check("parses back clean", res.ok === true, JSON.stringify(res.error));
  check("layers survive", res.plots[0].layers[0].geom === "point");
}

section("plots file rejects");
{
  check("unknown geom aborts",
    parsePlotsFile(JSON.stringify({ version: 1, kind: "litux/plots",
      plots: [{ name: "x", layers: [{ geom: "hexbin" }] }] }), PLOT_VOCAB).error?.includes("hexbin"));
  check("unknown scheme aborts",
    parsePlotsFile(JSON.stringify({ version: 1, kind: "litux/plots",
      plots: [{ name: "x", layers: [{ geom: "point" }], scheme: "neon" }] }), PLOT_VOCAB)
      .error?.includes("neon"));
  check("plot with no layers rejected",
    parsePlotsFile(JSON.stringify({ version: 1, kind: "litux/plots",
      plots: [{ name: "x", layers: [] }] }), PLOT_VOCAB).error?.includes("layer"));
  check("model file fed to plot parser is named",
    parsePlotsFile(JSON.stringify(buildModelFile(PINS)), PLOT_VOCAB).error?.includes("model"));
}

console.log(`\nartifactIO: ${pass} passed, ${fail} failed`);
if (fail > 0) process.exit(1);
```

- [ ] **Step 2: Run it to verify it fails**

```bash
node src/services/export/__validation__/artifactIOValidation.mjs
```

Expected: `ERR_MODULE_NOT_FOUND` — `../artifactIO.js` does not exist.

- [ ] **Step 3: Write `artifactIO.js`**

Create `src/services/export/artifactIO.js`:

```js
// ─── ECON STUDIO · services/export/artifactIO.js ─────────────────────────────
// Build + parse the two module-level artifact files, mirroring Clean's
// pipeline.json round-trip:
//   model.json  — pinned model SPECS (the recipe; never coefficients)
//   plots.json  — saved PlotBuilder history entries
//
// PURE JS, no React import: the allowed-id vocabularies (estimator ids, SE type
// ids, geoms, palette schemes) are PARAMETERS, not imports, because they live in
// .jsx files that a node harness cannot load. Callers inside React pass the real
// ones; __validation__/artifactIOValidation.mjs passes its own.

const MODEL_KIND = "litux/model-specs";
const PLOTS_KIND = "litux/plots";

// Session-local identity that must never travel: a foreign id points at a
// dataset/entry that does not exist in the importing session.
const PLOT_STRIP = ["id", "savedAt", "datasetId", "datasetName"];

function err(msg) { return { ok: false, error: msg }; }

function readJSON(text) {
  try { return { ok: true, value: JSON.parse(text) }; }
  catch { return err("Not valid JSON."); }
}

// Names the file you actually supplied, so feeding plots.json to the model
// importer says so instead of failing on a missing field.
function kindMismatch(got, want) {
  const human = got === MODEL_KIND ? "a model file" : got === PLOTS_KIND ? "a plots file" : "an unrecognised file";
  return err(`This is ${human}${got ? ` (kind: ${got})` : ""} — expected ${want}.`);
}

// ── model.json ───────────────────────────────────────────────────────────────

export function buildModelFile(pins = []) {
  return {
    version: 1,
    kind: MODEL_KIND,
    exportedAt: new Date().toISOString(),
    models: pins.map(p => ({
      label:  p.label ?? p.modelLabel ?? null,
      type:   p.type ?? p.spec?.model ?? null,
      family: p.spec?.family ?? "linear",
      spec:   p.spec ?? {},
    })),
  };
}

// vocab = { modelIds: string[], seTypeIds: string[] }
export function parseModelFile(text, vocab = {}) {
  const read = readJSON(text);
  if (!read.ok) return read;
  const p = read.value;
  if (p?.kind !== MODEL_KIND) return kindMismatch(p?.kind, "a model file");
  if (!Array.isArray(p.models)) return err("Expected a `models` array.");
  if (!p.models.length)         return err("This file is empty — no models to import.");

  const modelIds  = new Set(vocab.modelIds ?? []);
  const seTypeIds = new Set(vocab.seTypeIds ?? []);
  const families  = new Set(vocab.families ?? []);
  const badTypes = [], badSE = [], badFam = [];
  for (const m of p.models) {
    if (!m || typeof m !== "object") return err("A model entry is not an object.");
    if (!modelIds.has(m.type)) badTypes.push(String(m.type));
    const se = m.spec?.seType;
    if (se != null && !seTypeIds.has(se)) badSE.push(String(se));
    const fam = m.family ?? m.spec?.family;
    if (fam != null && !families.has(fam)) badFam.push(String(fam));
  }
  if (badTypes.length)
    return err(`Unknown estimator${badTypes.length > 1 ? "s" : ""}: ${[...new Set(badTypes)].join(", ")}. This file was built with a newer or older version.`);
  if (badFam.length)
    return err(`Unknown outcome family${badFam.length > 1 ? "ies" : ""}: ${[...new Set(badFam)].join(", ")}.`);
  if (badSE.length)
    return err(`Unknown SE type${badSE.length > 1 ? "s" : ""}: ${[...new Set(badSE)].join(", ")}.`);

  return { ok: true, models: p.models, exportedAt: p.exportedAt ?? null };
}

// ── plots.json ───────────────────────────────────────────────────────────────

export function buildPlotsFile(entries = []) {
  return {
    version: 1,
    kind: PLOTS_KIND,
    exportedAt: new Date().toISOString(),
    plots: entries.map(e => {
      const out = { ...e };
      for (const k of PLOT_STRIP) delete out[k];
      return out;
    }),
  };
}

// vocab = { geoms: string[], schemes: string[] }
export function parsePlotsFile(text, vocab = {}) {
  const read = readJSON(text);
  if (!read.ok) return read;
  const p = read.value;
  if (p?.kind !== PLOTS_KIND) return kindMismatch(p?.kind, "a plots file");
  if (!Array.isArray(p.plots)) return err("Expected a `plots` array.");
  if (!p.plots.length)         return err("This file is empty — no plots to import.");

  const geoms   = new Set(vocab.geoms ?? []);
  const schemes = new Set(vocab.schemes ?? []);
  const badGeoms = [], badSchemes = [];
  for (const e of p.plots) {
    if (!e || typeof e !== "object")  return err("A plot entry is not an object.");
    if (!Array.isArray(e.layers) || !e.layers.length)
      return err(`Plot "${e.name ?? "(unnamed)"}" has no layers.`);
    for (const l of e.layers) if (!geoms.has(l?.geom)) badGeoms.push(String(l?.geom));
    if (e.scheme != null && !schemes.has(e.scheme)) badSchemes.push(String(e.scheme));
  }
  if (badGeoms.length)
    return err(`Unknown geom${badGeoms.length > 1 ? "s" : ""}: ${[...new Set(badGeoms)].join(", ")}. This file was built with a newer or older version.`);
  if (badSchemes.length)
    return err(`Unknown palette${badSchemes.length > 1 ? "s" : ""}: ${[...new Set(badSchemes)].join(", ")}.`);

  return { ok: true, plots: p.plots, exportedAt: p.exportedAt ?? null };
}

// Shared download helper — same shape as ExportMenu's downloadPipeline.
export function downloadJSON(payload, filename) {
  const blob = new Blob([JSON.stringify(payload, null, 2)], { type: "application/json" });
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = filename;
  a.click();
  URL.revokeObjectURL(a.href);
}
```

- [ ] **Step 4: Run the harness to verify it passes**

```bash
node src/services/export/__validation__/artifactIOValidation.mjs
```

Expected: every check `[pass]`, `artifactIO: N passed, 0 failed`, exit 0.

- [ ] **Step 5: Negative-control**

Temporarily remove `"datasetId"` from `PLOT_STRIP`. Re-run. Expected: "session-local identity stripped" FAILs, exit 1. Restore it and confirm green.

- [ ] **Step 6: Commit**

```bash
git add src/services/export/artifactIO.js src/services/export/__validation__/artifactIOValidation.mjs
git commit -m "feat(export): artifactIO — build/parse model.json and plots.json"
```

---

## Task 4b: `artifactIO` hardening — OUTSTANDING, do before Task 5

Task 4 shipped (`411708df`) and its harness is green at 21 checks, but an adversarial review
ran 80 probes against it and found real holes. One of them — `specFormula` throwing on a
duck-typed array — is already fixed (`b707eea4`). **The rest are outstanding.** They are
listed here rather than in a chat log because the review that found them is not durable.

The module's best property, confirmed empirically, is that its vocabularies are
**deny-by-default**: an empty or missing `modelIds`/`geoms` rejects the file rather than
waving it through. Preserve that while fixing the rest — and pin it with a test, because
without one, someone "fixing" the annoyance with `if (!ids.size) skip` gets a green harness
while recreating this repo's `condToSQL` → `default: return "TRUE"` bug.

### Critical
- **`parseModelFile` never validates `m.spec`.** `m.spec?.seType` optional-chains past a
  string, array or null, so `{"type":"OLS","spec":null}` returns `ok:true`. Reject a
  non-plain-object spec, naming the model: `Model "Baseline": spec is not an object.`

### Important
- **`vocab: null` throws** instead of returning `{ok:false}` — `vocab = {}` is a default
  parameter, so it only fires on `undefined`. A caller passing a not-yet-loaded ref turns a
  file import into a render crash. Use `vocab ?? {}` inside both bodies.
- **`version` is stamped and never read.** `version: 2`, `"banana"`, and absent all parse
  `ok:true`, so a future v2 that renames a spec key is silently misparsed. Reject a version
  newer than this build writes; treat a missing version as 1.
- **`__proto__` survives the build → file → parse round trip.** No pollution is reachable
  today (spread is safe, `Object.prototype` verified untouched), but `Object.assign({}, entry)`
  DOES pollute, and that is the documented downstream shape. Strip `__proto__`/`constructor`/
  `prototype` in both parsers and in `buildPlotsFile`'s strip list.
- **`buildPlotsFile` strips session-local identity only at the top level.** `PLOT_STRIP` hits a
  shallow `{...e}`, so `layers[].datasetId`, `layers[].datasetName` and nested `meta.datasetId`
  travel intact — against the module's own comment. `datasetName` is often a real filename, so
  this is a privacy leak in a file users email each other. Strip recursively.
- **Error messages are uncapped**: 50 000 unknown ids produced a 538 960-character error
  string. Cap at ~5 distinct values + "and N more", truncate each to ~40 chars, and sanitise —
  `kind: "<img src=x onerror=alert(1)>"` is currently echoed verbatim.

### Message quality
- A valid id in the wrong shape reports as an unknown id (`{"type":["OLS"]}` →
  `Unknown estimator: OLS.`), because `String(v)` erases the difference. The user sees OLS in
  the sidebar and has nowhere to go. `applySpec` already separates `bad-shape` from
  `unknown-value` — follow it. Same for `layers:[null]` → `Unknown geom: undefined.`
- Name which entry failed (index + label), and report all failing categories rather than
  returning on the first.

### Harness gaps (21 checks is too thin)
Deny-by-default vocabularies (highest value); non-string input; `version`; wrong-typed `spec`;
the parse → `specFormula` handoff; prototype keys; nested stripping; deep round-trip equality;
`parsePlotsFile` with non-JSON; null/non-object plot entries and layers; build-side robustness
(`buildModelFile(null)` throws today — guard it or document that the build side trusts its
caller, then assert whichever); plots round-trip beyond `geom`.

---

## Task 5: Model export/import UI

**Files:**
- Create: `src/components/modeling/ModelIOButtons.jsx`
- Modify: `src/components/ModelingTab.jsx` (mount it above `ModelBufferBar`)

- [ ] **Step 1: Write `ModelIOButtons.jsx`**

Create `src/components/modeling/ModelIOButtons.jsx`:

```jsx
// ─── ECON STUDIO · components/modeling/ModelIOButtons.jsx ────────────────────
// Export/Import for pinned model SPECS — the Model-side sibling of Clean's
// ExportMenu + ImportPipelineButton.
//
// Importing carries the RECIPE, never the result: it fills the sidebar and the
// user presses Estimate against their own data. Nothing is pinned, nothing is
// estimated automatically, and no foreign coefficients enter the model buffer.
//
// Props:
//   models        — pinned EstimationResult[] (for export)
//   filenameBase  — download name stem
//   onApply(spec) — called with the chosen spec; the parent runs applySpec

import { useRef, useState } from "react";
import { useTheme } from "./shared.jsx";
import { MODELS } from "./EstimatorSidebar.jsx";
import { SE_TYPE_IDS, FAMILIES, specFormula } from "./modelSpec.js";
import { buildModelFile, parseModelFile, downloadJSON } from "../../services/export/artifactIO.js";

const VOCAB = { modelIds: MODELS.map(m => m.id), seTypeIds: SE_TYPE_IDS, families: FAMILIES };

export default function ModelIOButtons({ models = [], filenameBase = "models", onApply }) {
  const { C, T } = useTheme();
  const fileRef = useRef(null);
  const [error, setError]   = useState("");
  const [picker, setPicker] = useState(null);   // { models, source }

  const btn = (active) => ({
    padding: "0.28rem 0.65rem", borderRadius: 3, cursor: "pointer",
    fontFamily: T.code.fontFamily, fontSize: T.caption.fontSize,
    background: "transparent", color: active ? C.textDim : C.border,
    border: `1px solid ${active ? C.border2 : C.border}`, transition: "all 0.12s",
  });

  function doExport() {
    if (!models.length) return;
    downloadJSON(buildModelFile(models), `${filenameBase}_models.json`);
  }

  function onFile(e) {
    const f = e.target.files?.[0];
    e.target.value = "";
    if (!f) return;
    const reader = new FileReader();
    reader.onload = () => {
      const res = parseModelFile(reader.result, VOCAB);
      if (!res.ok) { setError(res.error); return; }
      setError("");
      setPicker({ models: res.models, source: f.name });
    };
    reader.readAsText(f);
  }

  return (
    <div style={{ display: "flex", gap: 6, alignItems: "center", marginBottom: "0.5rem" }}>
      <button onClick={doExport} disabled={!models.length} style={btn(models.length > 0)}
        title={models.length ? "Download the specs of every pinned model" : "Pin a model first"}
        onMouseEnter={e => { if (models.length) { e.currentTarget.style.borderColor = C.teal; e.currentTarget.style.color = C.teal; } }}
        onMouseLeave={e => { if (models.length) { e.currentTarget.style.borderColor = C.border2; e.currentTarget.style.color = C.textDim; } }}>
        ↓ Export models
      </button>

      <button onClick={() => { setError(""); fileRef.current?.click(); }} style={btn(true)}
        title="Load a previously-exported model.json into the estimator sidebar"
        onMouseEnter={e => { e.currentTarget.style.borderColor = C.teal; e.currentTarget.style.color = C.teal; }}
        onMouseLeave={e => { e.currentTarget.style.borderColor = C.border2; e.currentTarget.style.color = C.textDim; }}>
        ↑ Import models
      </button>
      <input ref={fileRef} type="file" accept=".json,application/json" onChange={onFile} style={{ display: "none" }} />

      {error && (
        <div style={{
          padding: "0.35rem 0.6rem", background: C.surface2,
          border: `1px solid ${C.red}`, borderLeft: `3px solid ${C.red}`, borderRadius: 3,
          color: C.red, fontFamily: T.code.fontFamily, fontSize: T.caption.fontSize,
          maxWidth: 420, lineHeight: 1.5,
        }}>
          ⚠ {error}
          <button onClick={() => setError("")}
            style={{ marginLeft: 8, padding: "0.1rem 0.45rem", background: "transparent",
              border: `1px solid ${C.border2}`, color: C.textDim, borderRadius: 2,
              cursor: "pointer", fontSize: T.caption.fontSize, fontFamily: T.code.fontFamily }}>
            Dismiss
          </button>
        </div>
      )}

      {/* Pick-one modal: a spec has to occupy THE sidebar, which is singular. */}
      {picker && (
        <>
          <div style={{ position: "fixed", inset: 0, background: "#000a", zIndex: 200 }}
            onClick={() => setPicker(null)} />
          <div style={{
            position: "fixed", top: "50%", left: "50%", transform: "translate(-50%, -50%)",
            background: C.surface, border: `1px solid ${C.border2}`, borderRadius: 6,
            padding: "1.2rem 1.4rem", minWidth: 420, maxWidth: 620, maxHeight: "70vh",
            overflowY: "auto", zIndex: 201, boxShadow: "0 12px 40px #000c",
          }}>
            <div style={{ fontSize: T.caption.fontSize, color: C.gold, letterSpacing: "0.18em",
              textTransform: "uppercase", marginBottom: 4, fontFamily: T.code.fontFamily }}>
              Load a model spec
            </div>
            <div style={{ fontSize: T.caption.fontSize, color: C.textMuted,
              fontFamily: T.code.fontFamily, marginBottom: 12 }}>
              From {picker.source}. This fills the sidebar — press Estimate to run it on the
              current dataset. Nothing is pinned and no coefficients are imported.
            </div>
            {picker.models.map((m, i) => (
              <button key={i}
                onClick={() => { onApply?.(m.spec ?? {}); setPicker(null); }}
                style={{
                  width: "100%", textAlign: "left", display: "block",
                  padding: "0.6rem 0.75rem", marginBottom: 6,
                  background: "transparent", border: `1px solid ${C.border2}`, borderRadius: 3,
                  color: C.text, cursor: "pointer", fontFamily: T.code.fontFamily,
                }}
                onMouseEnter={e => { e.currentTarget.style.borderColor = C.teal; }}
                onMouseLeave={e => { e.currentTarget.style.borderColor = C.border2; }}>
                <div style={{ fontSize: T.code.fontSize }}>
                  <span style={{ color: C.gold }}>{m.type}</span>
                  {m.label ? <span style={{ color: C.textDim }}> · {m.label}</span> : null}
                </div>
                <div style={{ fontSize: T.caption.fontSize, color: C.textMuted, marginTop: 2 }}>
                  {specFormula(m.spec ?? {})}
                </div>
              </button>
            ))}
            <div style={{ display: "flex", justifyContent: "flex-end", marginTop: 8 }}>
              <button onClick={() => setPicker(null)}
                style={{ padding: "0.4rem 0.85rem", background: "transparent",
                  border: `1px solid ${C.border2}`, color: C.textDim, borderRadius: 3,
                  cursor: "pointer", fontSize: T.code.fontSize, fontFamily: T.code.fontFamily }}>
                Cancel
              </button>
            </div>
          </div>
        </>
      )}
    </div>
  );
}
```

- [ ] **Step 2: Mount it in ModelingTab**

Add the import next to the other `./modeling/` imports in `src/components/ModelingTab.jsx`:

```js
import ModelIOButtons from "./modeling/ModelIOButtons.jsx";
```

Then insert immediately **before** the `{specNotice && (` block added in Task 3 Step 6:

```jsx
        {/* ── Model spec export / import ── */}
        <ModelIOButtons
          models={pinnedModels}
          filenameBase={(cleanedData?.filename ?? "dataset").replace(/\.[^.]+$/, "").replace(/[^\w.-]/g, "_").slice(0, 100)}
          onApply={(spec) => {
            const { unapplied } = applySpec(spec, SPEC_SETTERS, SPEC_CTX);
            setSpecNotice(unapplied.length ? unapplied : null);
          }}
        />
```

- [ ] **Step 3: Build**

```bash
npm run build
```

Expected: exits 0.

- [ ] **Step 4: Commit**

```bash
git add src/components/modeling/ModelIOButtons.jsx src/components/ModelingTab.jsx
git commit -m "feat(modeling): export/import model specs as model.json"
```

---

## Task 6: Plot export/import UI

**Files:**
- Modify: `src/components/PlotBuilder.jsx:82` (export GEOMS), `:114` (export PALETTE_PRESETS), history bar `~:1943`

- [ ] **Step 1: Export the two vocabularies**

At `PlotBuilder.jsx:82` change `const GEOMS = [` to `export const GEOMS = [`.
At `PlotBuilder.jsx:114` change `const PALETTE_PRESETS = [` to `export const PALETTE_PRESETS = [`.

- [ ] **Step 2: Add the import**

Alongside PlotBuilder's other service imports:

```js
import { buildPlotsFile, parsePlotsFile, downloadJSON } from "../services/export/artifactIO.js";
```

- [ ] **Step 3: Add the handlers**

Immediately after the `savePlot` `useCallback` (`PlotBuilder.jsx:~1693`), add:

```js
  // ── plots.json export / import ─────────────────────────────────────────────
  const plotFileRef = useRef(null);
  const [plotIOError, setPlotIOError] = useState("");

  const exportPlots = useCallback(() => {
    if (!plotHistory.length) return;
    const base = (datasetName || "dataset").replace(/[^\w.-]/g, "_").slice(0, 100);
    downloadJSON(buildPlotsFile(plotHistory), `${base}_plots.json`);
  }, [plotHistory, datasetName]);

  const importPlots = useCallback((text) => {
    const res = parsePlotsFile(text, {
      geoms:   GEOMS.map(g => g.id),
      schemes: PALETTE_PRESETS.map(p => p.id),
    });
    if (!res.ok) { setPlotIOError(res.error); return; }
    setPlotIOError("");
    // Append, never replace: unlike the pipeline import there is no History
    // panel to undo with. Fresh ids + the CURRENT datasetId — a foreign id
    // would point at a dataset that does not exist in this session.
    const incoming = res.plots.map((e, i) => ({
      ...e,
      id:          "ph_" + Math.random().toString(36).slice(2, 8),
      name:        e.name || `Imported ${i + 1}`,
      datasetId:   datasetId ?? null,
      datasetName: datasetName ?? null,
      savedAt:     Date.now(),
    }));
    const next = [...plotHistory, ...incoming];
    setPlotHistory(next);
    if (histPid) savePlotHistory(histPid, next).catch(() => {});
    loadPlotEntry(incoming[0]);
    setHistIdx(plotHistory.length);
    setHistOpen(true);
  }, [plotHistory, histPid, datasetId, datasetName, loadPlotEntry]);
```

- [ ] **Step 4: Add the buttons to the history bar**

In `PlotBuilder.jsx`, immediately after the `New` button (`~:1950`), insert:

```jsx
            <button onClick={exportPlots} disabled={plotHistory.length === 0}
              title={plotHistory.length ? "Download every saved plot as plots.json" : "Save a plot first"}
              style={{
                padding: "3px 8px", borderRadius: 3, fontFamily: T.code.fontFamily, fontSize: T.caption.fontSize,
                cursor: plotHistory.length > 0 ? "pointer" : "not-allowed",
                background: "none", color: plotHistory.length > 0 ? C.textMuted : C.border,
                border: `1px solid ${C.border}`,
              }}>↓ Export</button>
            <button onClick={() => { setPlotIOError(""); plotFileRef.current?.click(); }}
              title="Append plots from a previously-exported plots.json"
              style={{
                padding: "3px 8px", borderRadius: 3, fontFamily: T.code.fontFamily, fontSize: T.caption.fontSize,
                cursor: "pointer", background: "none", color: C.textMuted, border: `1px solid ${C.border}`,
              }}>↑ Import</button>
            <input ref={plotFileRef} type="file" accept=".json,application/json"
              onChange={e => {
                const f = e.target.files?.[0];
                e.target.value = "";
                if (!f) return;
                const reader = new FileReader();
                reader.onload = () => importPlots(reader.result);
                reader.readAsText(f);
              }}
              style={{ display: "none" }} />
```

- [ ] **Step 5: Render the error toast**

Immediately after the closing `</div>` of the history-nav flex container that holds those buttons, add:

```jsx
          {plotIOError && (
            <div style={{
              padding: "0.35rem 0.6rem", background: C.surface2,
              border: `1px solid ${C.red}`, borderLeft: `3px solid ${C.red}`, borderRadius: 3,
              color: C.red, fontFamily: T.code.fontFamily, fontSize: T.caption.fontSize,
              maxWidth: 420, lineHeight: 1.5,
            }}>
              ⚠ {plotIOError}
              <button onClick={() => setPlotIOError("")}
                style={{ marginLeft: 8, padding: "0.1rem 0.45rem", background: "transparent",
                  border: `1px solid ${C.border2}`, color: C.textDim, borderRadius: 2,
                  cursor: "pointer", fontSize: T.caption.fontSize, fontFamily: T.code.fontFamily }}>
                Dismiss
              </button>
            </div>
          )}
```

- [ ] **Step 6: Verify `useRef` is imported**

```bash
grep -n "^import { " src/components/PlotBuilder.jsx | head -3
```

If `useRef` is absent from the React import, add it.

- [ ] **Step 7: Build**

```bash
npm run build
```

Expected: exits 0.

- [ ] **Step 8: Commit**

```bash
git add src/components/PlotBuilder.jsx
git commit -m "feat(explore): export/import saved plots as plots.json"
```

---

## Task 7: Declare dataset-reference fields in the registry

**Files:**
- Modify: `src/pipeline/registry.js` (schema entries for 6 merge steps + 8 spatial steps)
- Modify: `src/pipeline/__validation__/pipelineReliabilityValidation.mjs` (new T7 section)

- [ ] **Step 1: Write the failing guard**

Append to `src/pipeline/__validation__/pipelineReliabilityValidation.mjs`, immediately **before** the `── SUMMARY ──` block:

```js
// ─── T7 — DATASET-REFERENCE FIELDS ARE DECLARED ───────────────────────────────
// A step field holding another dataset's id is not portable across sessions:
// the id comes from genId() in DataStudio. ImportPipelineButton derives its
// portability check from these declarations, so a field left as type:"text"
// silently reintroduces an unchecked reference. Keyed on the field NAME shape,
// not on a hand-kept list — the same reasoning as the rogue-operator guard.
section("T7 · dataset-reference fields declared type:\"dataset\"");
{
  const REF_KEY = /^(right|.*Dataset)Id$/;
  const offenders = [];
  let declared = 0;
  for (const entry of STEP_REGISTRY) {
    for (const f of entry.schema ?? []) {
      if (!REF_KEY.test(f.key)) continue;
      if (f.type === "dataset") declared++;
      else offenders.push(`${entry.type}.${f.key} (type:"${f.type}")`);
    }
  }
  check("every *DatasetId / rightId schema field is type:\"dataset\"",
    offenders.length === 0, offenders.join(", "));
  check("the guard actually found fields to check", declared >= 12, `declared=${declared}`);
}
```

- [ ] **Step 2: Run it to verify it fails**

```bash
node src/pipeline/__validation__/pipelineReliabilityValidation.mjs
```

Expected: FAIL listing `join.rightId (type:"text")`, `append.rightId (type:"text")`, and the spatial entries; exit 1.

- [ ] **Step 3: Declare the fields**

In `src/pipeline/registry.js`, change `type: "text"` to `type: "dataset"` on every schema field whose key is `rightId`, `gridDatasetId`, `polyDatasetId`, `refDatasetId`, `bufferDatasetId`, `srcDatasetId`, or `tgtDatasetId`. Find them with:

```bash
grep -n "key: \"\(rightId\|gridDatasetId\|polyDatasetId\|refDatasetId\|bufferDatasetId\|srcDatasetId\|tgtDatasetId\)\"" src/pipeline/registry.js
```

The steps involved are: `join`, `append`, `bind_cols`, `union`, `intersect`, `setdiff`, `sp_grid_assign`, `sp_spatial_join`, `sp_nearest`, `sp_boundary_dist`, `sp_metric_buffer`, `sp_buffer_exposure`, `sp_aggregate_grid`, `sp_areal_interp`.

Leave `defaultStep()` untouched — only the `schema` array's `type` changes.

- [ ] **Step 4: Run the guard to verify it passes**

```bash
node src/pipeline/__validation__/pipelineReliabilityValidation.mjs
```

Expected: all checks pass including the two T7 ones; exit 0.

- [ ] **Step 5: Confirm the UI still renders those fields**

`type: "dataset"` is a new value for any registry-driven form renderer. Check whether anything switches on `schema[].type`:

```bash
grep -rn "\.type === \"text\"\|schema.*\.type" src/components --include=*.jsx | head
```

If a renderer has a `switch`/ternary on the field type with no default, add `case "dataset":` rendering the same control as `"text"`. If no renderer consumes `schema[].type`, no change is needed — note which in the commit message.

- [ ] **Step 6: Build and commit**

```bash
npm run build
git add src/pipeline/registry.js src/pipeline/__validation__/pipelineReliabilityValidation.mjs
git commit -m "feat(pipeline): declare dataset-reference schema fields + registry guard"
```

---

## Task 8: `portability.js` — the pipeline.json portability check

**Files:**
- Create: `src/pipeline/portability.js`
- Modify: `src/pipeline/__validation__/pipelineReliabilityValidation.mjs` (extend T7)

- [ ] **Step 1: Write the failing checks**

Append to the T7 block in `pipelineReliabilityValidation.mjs` (inside the same `section`, after the two existing checks). Add this import at the top of the file, next to the `registry.js` import:

```js
import { checkPipelinePortability } from "../portability.js";
```

Then the checks:

```js
{
  const steps = [
    { type: "join",  rightId: "ds_gone", leftKey: "id", rightKey: "id", how: "left" },
    { type: "log",   col: "wage", nn: "log_wage" },
    { type: "sp_nearest", refDatasetId: "self", latCol: "lat", lonCol: "lon" },
    { type: "patch", ri: 3, col: "wage", value: 1 },
    { type: "patch", ri: 4, col: "wage", value: 2 },
  ];
  const r = checkPipelinePortability(steps, {
    datasetIds: ["ds_here"], targetDatasetId: "ds_here", payloadDatasetId: "ds_other",
  });
  check("unresolvable ref reported with step index + field",
    r.unresolved.length === 1 && r.unresolved[0].index === 0 &&
    r.unresolved[0].field === "rightId" && r.unresolved[0].value === "ds_gone",
    JSON.stringify(r.unresolved));
  check("\"self\" sentinel not flagged", !r.unresolved.some(u => u.value === "self"));
  check("row-identity steps counted when dataset differs", r.rowIdentityDropped === 2,
    String(r.rowIdentityDropped));
  check("kept steps exclude the dropped patches",
    r.steps.length === 3 && !r.steps.some(s => s.type === "patch"),
    r.steps.map(s => s.type).join(", "));

  const same = checkPipelinePortability(steps, {
    datasetIds: ["ds_here"], targetDatasetId: "ds_here", payloadDatasetId: "ds_here",
  });
  check("row-identity steps KEPT when re-importing into the same dataset",
    same.rowIdentityDropped === 0 && same.steps.filter(s => s.type === "patch").length === 2);

  const noStamp = checkPipelinePortability(steps, {
    datasetIds: ["ds_here"], targetDatasetId: "ds_here", payloadDatasetId: null,
  });
  check("no datasetId stamp is treated as a different dataset (conservative)",
    noStamp.rowIdentityDropped === 2);
}
```

- [ ] **Step 2: Run to verify it fails**

```bash
node src/pipeline/__validation__/pipelineReliabilityValidation.mjs
```

Expected: `ERR_MODULE_NOT_FOUND` for `../portability.js`.

- [ ] **Step 3: Write `portability.js`**

Create `src/pipeline/portability.js`:

```js
// ─── ECON STUDIO · pipeline/portability.js ───────────────────────────────────
// What it means for a pipeline.json to be portable into another session.
//
// Two step properties do not survive a transfer, and until this file existed
// ImportPipelineButton checked neither — it validated `type` against
// STEP_TYPES, reported success, and left the steps to fail or no-op at replay:
//
//   1. Dataset references. `rightId` (the 6 merge steps) and the six
//      *DatasetId fields (8 sp_* steps) hold ids from genId() in DataStudio.
//   2. Row identity. `patch` matches on __ri, assigned per dataset by
//      ensureRowIds — replaying foreign patches edits whichever row happens to
//      carry that id. `inject_column` carries a dense array lifted from a model
//      result and is the same class.
//
// The reference-field list is DERIVED from STEP_REGISTRY (type:"dataset"), not
// hand-kept here: a hand-kept list is exactly the drift the condition-language
// dialects were, and pipelineReliabilityValidation's T7 guard keeps the
// declarations honest.

import { STEP_REGISTRY } from "./registry.js";

// Sentinels meaning "the current frame" — portable by construction.
const SENTINELS = new Set(["self", "active"]);

// Steps whose meaning is tied to THIS dataset's row identity.
const ROW_IDENTITY_TYPES = new Set(["patch", "inject_column"]);

// { stepType: ["rightId", ...] } derived from the registry schemas.
export function datasetRefFields() {
  const out = {};
  for (const entry of STEP_REGISTRY) {
    const keys = (entry.schema ?? []).filter(f => f.type === "dataset").map(f => f.key);
    if (keys.length) out[entry.type] = keys;
  }
  return out;
}

// ctx = { datasetIds: string[], targetDatasetId: string, payloadDatasetId: string|null }
// Returns { steps, unresolved, rowIdentityDropped }.
//   steps               — what should actually be imported
//   unresolved          — [{ index, type, field, value }] to report, NOT to abort on
//   rowIdentityDropped  — count of patch/inject_column steps removed
export function checkPipelinePortability(steps = [], ctx = {}) {
  const known   = new Set(ctx.datasetIds ?? []);
  const refs    = datasetRefFields();
  // Conservative: an unstamped payload (exported before this landed) is treated
  // as coming from a different dataset, because silently applying foreign
  // row-level edits is the failure mode this exists to prevent.
  const sameDataset = !!ctx.payloadDatasetId && ctx.payloadDatasetId === ctx.targetDatasetId;

  const unresolved = [];
  const kept = [];
  let rowIdentityDropped = 0;

  steps.forEach((s, index) => {
    if (ROW_IDENTITY_TYPES.has(s.type) && !sameDataset) { rowIdentityDropped++; return; }
    for (const field of refs[s.type] ?? []) {
      const v = s[field];
      if (!v || SENTINELS.has(v) || known.has(v)) continue;
      unresolved.push({ index, type: s.type, field, value: v });
    }
    kept.push(s);
  });

  return { steps: kept, unresolved, rowIdentityDropped };
}
```

- [ ] **Step 4: Run to verify it passes**

```bash
node src/pipeline/__validation__/pipelineReliabilityValidation.mjs
```

Expected: all checks pass, exit 0.

- [ ] **Step 5: Negative-control**

Temporarily add `"self"` removal (delete `SENTINELS.has(v) ||` from the guard). Re-run. Expected: the `"self" sentinel not flagged` check FAILs. Restore and confirm green.

- [ ] **Step 6: Commit**

```bash
git add src/pipeline/portability.js src/pipeline/__validation__/pipelineReliabilityValidation.mjs
git commit -m "feat(pipeline): portability check for dataset refs and row-identity steps"
```

---

## Task 9: Wire portability into the Clean round-trip

**Files:**
- Modify: `src/components/wrangling/ExportMenu.jsx:63-77` (stamp `datasetId`)
- Modify: `src/components/wrangling/ImportPipelineButton.jsx`
- Modify: `src/WranglingModule.jsx:667-669` (pass the new props)

- [ ] **Step 1: Stamp `datasetId` on export**

In `src/components/wrangling/ExportMenu.jsx`, add `datasetId = null` to the destructured props:

```js
function ExportMenu({ rows, headers, pipeline, filename, datasetName, allDatasets = {}, datasetId = null }) {
```

and in `downloadPipeline`, extend the payload:

```js
    const payload = {
      version: 1,
      filename,
      // Which dataset these steps were built on. Read by ImportPipelineButton to
      // decide whether row-identity steps (patch/inject_column, which match on
      // this dataset's __ri) can be replayed or must be dropped.
      datasetId,
      exportedAt: new Date().toISOString(),
      steps: pipeline,
    };
```

- [ ] **Step 2: Pass it from WranglingModule**

In `src/WranglingModule.jsx` at the `<ExportMenu … />` element (`~:667`), add `datasetId={pid}` — `pid` is the dataset id here (`DataStudio.jsx:1084` passes `pid={activeDs.id}`).

At the `<ImportPipelineButton … />` element on the next line, add the two new props:

```jsx
            <ImportPipelineButton currentLength={pipeline.length} onImport={replacePipeline}
              currentDatasetId={pid}
              datasetIds={(allDatasets || []).map(d => d.id)} />
```

- [ ] **Step 3: Run the portability check in the importer**

In `src/components/wrangling/ImportPipelineButton.jsx`:

Add the import:

```js
import { checkPipelinePortability } from "../../pipeline/portability.js";
```

Change the signature:

```js
function ImportPipelineButton({ currentLength = 0, onImport, currentDatasetId = null, datasetIds = [] }) {
```

Then, in `onFile`, **after** the `exprGuard` loop and **before** the `if (currentLength === 0)` branch, replace those final lines with:

```js
      // Portability: dataset references and row-identity steps do not survive a
      // transfer between sessions. Neither aborts the import — a pipeline is
      // usually mostly portable — but neither is applied silently either.
      const port = checkPipelinePortability(steps, {
        datasetIds,
        targetDatasetId:  currentDatasetId,
        payloadDatasetId: Array.isArray(parsed) ? null : (parsed?.datasetId ?? null),
      });

      if (currentLength === 0) {
        onImport(port.steps);
        setNotice(buildNotice(port));
      } else {
        setPending({ steps: port.steps, source: f.name, port });
      }
```

Add the notice state next to the existing `error`/`pending` state:

```js
  const [notice, setNotice] = useState(null);   // portability report after an applied import
```

Add the notice builder above the component:

```js
// Human-readable portability report, or null when everything transferred.
function buildNotice(port) {
  const lines = [];
  for (const u of port.unresolved)
    lines.push(`step ${u.index + 1} · ${u.type} → ${u.field}: no such dataset in this session`);
  if (port.rowIdentityDropped)
    lines.push(`${port.rowIdentityDropped} row-level edit${port.rowIdentityDropped !== 1 ? "s" : ""} dropped — they belong to another dataset`);
  return lines.length ? lines : null;
}
```

Update `confirmReplace` to surface the report too:

```js
  function confirmReplace() {
    if (pending) {
      onImport(pending.steps);
      setNotice(buildNotice(pending.port));
    }
    setPending(null);
  }
```

- [ ] **Step 4: Render the notice**

Immediately after the existing error toast block in `ImportPipelineButton.jsx`, add:

```jsx
      {notice && (
        <div style={{
          position: "absolute", right: 0, top: "calc(100% + 4px)",
          padding: "0.5rem 0.75rem", background: C.surface2,
          border: `1px solid ${C.gold}`, borderLeft: `3px solid ${C.gold}`,
          borderRadius: 3, color: C.textDim, fontFamily: T.code.fontFamily,
          fontSize: T.caption.fontSize, maxWidth: 340, lineHeight: 1.5, zIndex: 100,
        }}>
          <div style={{ color: C.gold, marginBottom: 4 }}>Imported with notes</div>
          {notice.map((l, i) => <div key={i}>{l}</div>)}
          <div style={{ marginTop: 6 }}>
            <button onClick={() => setNotice(null)}
              style={{ padding: "0.18rem 0.55rem", background: "transparent",
                border: `1px solid ${C.border2}`, color: C.textDim, borderRadius: 2,
                cursor: "pointer", fontSize: T.caption.fontSize, fontFamily: T.code.fontFamily }}>
              Dismiss
            </button>
          </div>
        </div>
      )}
```

- [ ] **Step 5: Build**

```bash
npm run build
```

Expected: exits 0.

- [ ] **Step 6: Re-run every harness**

```bash
node src/pipeline/__validation__/pipelineReliabilityValidation.mjs && node src/components/modeling/__validation__/modelSpecValidation.mjs && node src/services/export/__validation__/artifactIOValidation.mjs
```

Expected: three `0 failed` summaries.

- [ ] **Step 7: Commit**

```bash
git add src/components/wrangling/ExportMenu.jsx src/components/wrangling/ImportPipelineButton.jsx src/WranglingModule.jsx
git commit -m "fix(clean): report unresolvable dataset refs and drop foreign row edits on import"
```

---

## Task 10: HintBox copy

Per CLAUDE.md: *"When adding or renaming anything a user picks from the UI … update that module's HintBox copy in the same change."* Three modules gained a control. **Never write a count into help copy** — name the things.

**Files:**
- Modify: `src/components/ModelingTab.jsx` (Model HintBox), `src/ExplorerModule.jsx` (Explore HintBox), `src/WranglingModule.jsx` (Clean HintBox)

- [ ] **Step 1: Locate the three HintBox bodies**

```bash
grep -n "HintBox" src/components/ModelingTab.jsx src/ExplorerModule.jsx src/WranglingModule.jsx
```

- [ ] **Step 2: Model HintBox — add a sentence**

Add to the Modeling HintBox text:

> "Export models writes the spec of every pinned model to a JSON file; Import models loads one back into the sidebar so you can re-estimate it on your own data. Specs travel, coefficients do not — press Estimate after importing."

- [ ] **Step 3: Explore HintBox — add a sentence**

Add to the Explore HintBox text:

> "Export saves every plot in the history to a JSON file; Import appends plots from one. Save the plot you are building first — Export only writes what is in the history."

- [ ] **Step 4: Clean HintBox — add a sentence**

Add to the Clean HintBox text:

> "Import pipeline applies a previously-exported pipeline.json. Steps that reference another dataset, and cell edits made in the Data Viewer, are reported rather than replayed when they cannot be resolved against the dataset you are importing into."

- [ ] **Step 5: Build and commit**

```bash
npm run build
git add src/components/ModelingTab.jsx src/ExplorerModule.jsx src/WranglingModule.jsx
git commit -m "docs(help): HintBox copy for model/plot export-import"
```

---

## Task 11: Close out the spec index

**Files:**
- Modify: `ClaudePlan.md` (the `2026-08-20` row)

- [ ] **Step 1: Update the status**

Change the row's status cell from `OPEN — spec approved by Franco, implementation plan not yet written` to:

```
IMPLEMENTATION COMPLETE 2026-08-20 — build + lint:undef green, 3 harnesses green, browser validation pending Franco
```

Append to the Notes cell anything that turned out differently from the spec — in particular any field discovered to have no setter, or any registry field the T7 guard flagged that the spec did not anticipate.

- [ ] **Step 2: Add the plan reference**

In the same row's "Spec / Plan" cell, append ` + `plans/2026-08-20-model-explore-import-export.md``.

- [ ] **Step 3: Final verification**

```bash
npm run build && node src/pipeline/__validation__/pipelineReliabilityValidation.mjs && node src/components/modeling/__validation__/modelSpecValidation.mjs && node src/services/export/__validation__/artifactIOValidation.mjs
```

Expected: build exits 0; three harnesses each report `0 failed`.

- [ ] **Step 4: Commit**

```bash
git add ClaudePlan.md
git commit -m "docs(plan): mark model/explore import-export implementation complete"
```

---

## Franco's browser checklist

Nothing below is verifiable without a browser; the agent must not attempt it.

- [ ] Pin 2+ models (include one FE and one RDD) → **Export models** → reopen the file → **Import models** → picker lists both with correct formulas → pick one → sidebar fills, including SE type → Estimate reproduces the pinned numbers.
- [ ] Import a model.json against a dataset missing one of its X columns → gold banner names the role and the column; the other fields still applied.
- [ ] Import a panel model spec into a dataset declared on different panel indices → banner reports the panel mismatch.
- [ ] Restore a pinned model from the buffer bar → SE type and estimator-specific fields come back (this was broken before).
- [ ] Save 2 plots → **↓ Export** → **New** → **↑ Import** → both appended to history, first one loaded on canvas, history counter reads 4/4.
- [ ] Feed plots.json to the model importer and vice versa → error names the file type.
- [ ] Export a pipeline containing a `join` and some Data Viewer cell edits → import it into a *different* dataset → gold "Imported with notes" lists the unresolvable `rightId` and the dropped row edits.
- [ ] Re-import that same pipeline into the dataset it came from → row edits are kept, no drop message.
- [ ] Export a pipeline containing spatial steps added via "➕ Add to pipeline" → confirm the `sp_*` steps are present in the JSON and re-import cleanly.
