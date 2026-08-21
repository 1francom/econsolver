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
