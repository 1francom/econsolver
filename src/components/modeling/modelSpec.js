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
// NOTE: InferenceOptions.jsx still declares its own copy of this list — Task 2
// migrates it to import from here. Until then this is the FUTURE single owner,
// not yet the actual one.
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
//   column     a single column name (in the ACTIVE dataset)
//   columns    an array of column names (in the ACTIVE dataset)
//   columnMap  { column: level } — factor reference categories
//   termList   [{ var1, var2, type }] — validated as a UNIT (see applySpec)
//   enum       one of `values`, or of `ctx[f.ctxValues]` when `ctxValues` is set
//   datasetRef a session-local dataset id
//   panelRef   recorded and compared, NEVER applied (panel comes from the
//              dataset's panelIndex, not from sidebar state — no setter exists)
//   scalar     string | number | boolean | null
//
// `wrapped: true` means the sidebar state holds an ARRAY even for a single
// column (the VarPanel multi-select convention: yVar is ["wage"], read as [0]).
// `stateKey` is the ModelingTab state name when it differs from the spec key.
// `def` is that field's ModelingTab `useState` default, expressed in SPEC
// (unwrapped/bare) shape — `write()` re-wraps it for `wrapped` fields. Every
// field not present in an incoming spec is reset to `def`, and every field
// that fails validation falls back to `def` too, so applySpec always leaves a
// COMPLETE, self-consistent state rather than merging onto whatever was there
// before (see applySpec's header comment).
// `allowSynthetic` (feCols only): accept a `"a×b"` combined-FE label as valid
// when every `×`-separated part is a real header — ModelConfiguration.jsx
// builds these labels at estimation time, they are never literal columns.
// NOT VALIDATED: whether "a×b" is actually a declared interaction on THIS
// panel (that needs ctx.panel.interactionCols threaded through, which no
// caller currently supplies) or that it has exactly two parts. A bogus
// "wage×educ" with no such interaction round-trips silently; the failure
// surfaces at estimation time instead. Considered and deliberately deferred.
// `nullable` (feCols only): `null` is a MEANINGFUL spec value ("use the
// estimator's own FE default", see ModelingTab.jsx `effectiveFeCols`) and is
// preserved as `null`, not folded into `[]` ("no FE").
// `def` may be a FUNCTION of ctx instead of a literal, for a field whose real
// ModelingTab default is dataset-dependent (factorVars: "every non-numeric
// column", not a fixed value — see the field itself). Array/object literal
// defs are frozen so an in-place mutation on the table's own instance throws
// instead of silently corrupting every future reset; `applySpec` always
// clones (and resolves function defs) before handing one to a setter — see
// `resolveDef`.
export const MODEL_SPEC_FIELDS = [
  { key: "model",             kind: "enum", ctxValues: "modelIds", def: "OLS",    setter: "setModel",  role: "Estimator" },
  { key: "family",            kind: "enum", values: FAMILIES,      def: "linear", setter: "setFamily", role: "Outcome family" },

  { key: "yVar",              kind: "column",     setter: "setYVar",       wrapped: true, def: null, role: "Outcome (Y)" },
  { key: "xVars",             kind: "columns",    setter: "setXVars",      def: Object.freeze([]),   role: "Regressors (X)" },
  { key: "wVars",             kind: "columns",    setter: "setWVars",      def: Object.freeze([]),   role: "Controls (W)" },
  { key: "zVars",             kind: "columns",    setter: "setZVars",      def: Object.freeze([]),   role: "Instruments (Z)" },
  { key: "weightVar",         kind: "column",     setter: "setWeightVar",  wrapped: true, def: null, role: "Weights" },

  // Real ModelingTab default is `headers.filter(h => !numericCols.includes(h))`
  // — every non-numeric column of THIS dataset, not a fixed value. No literal
  // can express that, so `def` is a function of ctx; Task 3 passes
  // `defaultFactorVars` in ctx. Falls back to `[]` only if the caller omits it.
  { key: "factorVars",        kind: "columns",    setter: "setFactorVars",
    def: (ctx) => ctx.defaultFactorVars ?? [], role: "Factor variables" },
  { key: "factorRefs",        kind: "columnMap",  setter: "setFactorRefs", def: Object.freeze({}),   role: "Factor reference category" },
  { key: "interactionTerms",  kind: "termList",   setter: "setInteractionTerms", def: Object.freeze([]), role: "Interaction term" },
  { key: "noIntercept",       kind: "scalar",     setter: "setNoIntercept", def: false, role: "Regression through the origin" },

  { key: "feCols",            kind: "columns",    setter: "setSelectedFeCols", stateKey: "selectedFeCols",
    def: null, nullable: true, allowSynthetic: true, role: "Fixed effects" },
  { key: "entityCol",         kind: "panelRef",   setter: null, role: "Panel entity" },
  { key: "timeCol",           kind: "panelRef",   setter: null, role: "Panel time" },

  { key: "treatVar",          kind: "column",     setter: "setTreatVar",   wrapped: true, def: null, role: "Treatment" },
  { key: "postVar",           kind: "column",     setter: "setPostVar",    wrapped: true, def: null, role: "Post period" },

  { key: "runningVar",        kind: "column",     setter: "setRunningVar", wrapped: true, def: null, role: "Running variable" },
  { key: "cutoff",            kind: "scalar",     setter: "setCutoff",     def: "",  role: "Cutoff" },
  { key: "bwMode",            kind: "scalar",     setter: "setBwMode",     def: "ik", role: "Bandwidth mode" },
  { key: "bwManual",          kind: "scalar",     setter: "setBwManual",   def: "",  role: "Manual bandwidth" },
  { key: "kernel",            kind: "scalar",     setter: "setKernel",     def: "triangular", role: "Kernel" },
  { key: "polyOrder",         kind: "scalar",     setter: "setPolyOrder",  def: 1,   role: "Polynomial order" },

  { key: "treatedUnit",       kind: "scalar",     setter: "setTreatedUnit",    def: "", role: "Treated unit" },
  { key: "synthTreatTime",    kind: "scalar",     setter: "setSynthTreatTime", def: "", role: "Treatment time" },
  { key: "treatTimeCol",      kind: "column",     setter: "setTreatTimeCol", wrapped: true, def: null, role: "Treatment time column" },
  { key: "kPre",              kind: "scalar",     setter: "setKPre",  def: 3, role: "Pre-treatment periods" },
  { key: "kPost",             kind: "scalar",     setter: "setKPost", def: 3, role: "Post-treatment periods" },

  { key: "poissonEntityCol",  kind: "column",     setter: "setPoissonEntityCol", def: "", role: "Poisson entity" },
  { key: "poissonOffsetCol",  kind: "column",     setter: "setPoissonOffsetCol", def: "", role: "Poisson offset" },
  { key: "poissonExtraFE",    kind: "columns",    setter: "setPoissonExtraFE",   def: Object.freeze([]), role: "Poisson extra FE" },

  { key: "cohortCol",         kind: "column",     setter: "setCohortCol", wrapped: true, def: null, role: "Cohort" },
  { key: "periodCol",         kind: "column",     setter: "setPeriodCol", wrapped: true, def: null, role: "Period" },
  { key: "saUnitCol",         kind: "column",     setter: "setSaUnitCol", def: "",       role: "Sun-Abraham unit" },
  { key: "saControlMode",     kind: "scalar",     setter: "setSaControlMode", def: "auto", role: "Sun-Abraham control mode" },
  { key: "saRefPeriod",       kind: "scalar",     setter: "setSaRefPeriod",   def: -1,     role: "Sun-Abraham reference period" },

  { key: "csTreatCol",        kind: "column",     setter: "setCsTreatCol",  wrapped: true, def: null, role: "CS first-treatment period" },
  { key: "csEntityCol",       kind: "column",     setter: "setCsEntityCol", wrapped: true, def: null, role: "CS entity" },
  { key: "csTimeCol",         kind: "column",     setter: "setCsTimeCol",   wrapped: true, def: null, role: "CS time" },
  { key: "csXCols",           kind: "columns",    setter: "setCsXCols",     def: Object.freeze([]), role: "CS covariates" },
  { key: "csCompGroup",       kind: "scalar",     setter: "setCsCompGroup",   def: "nevertreated", role: "CS comparison group" },
  { key: "csRelMin",          kind: "scalar",     setter: "setCsRelMin",      def: "",  role: "CS min relative period" },
  { key: "csRelMax",          kind: "scalar",     setter: "setCsRelMax",      def: "",  role: "CS max relative period" },
  { key: "csEstMethod",       kind: "scalar",     setter: "setCsEstMethod",   def: "dr", role: "CS estimation method" },
  { key: "csBasePeriod",      kind: "scalar",     setter: "setCsBasePeriod",  def: "varying", role: "CS base period" },
  { key: "csAnticipation",    kind: "scalar",     setter: "setCsAnticipation", def: "0", role: "CS anticipation periods" },
  { key: "csInfMethod",       kind: "scalar",     setter: "setCsInfMethod",   def: "bootstrap", role: "CS inference method" },
  { key: "csNBoot",           kind: "scalar",     setter: "setCsNBoot",       def: "999", role: "CS bootstrap draws" },
  { key: "csSeed",            kind: "scalar",     setter: "setCsSeed",        def: "42",  role: "CS random seed" },
  { key: "csDefaultView",     kind: "scalar",     setter: "setCsDefaultView", def: "group", role: "CS default view" },

  { key: "spatialModel",           kind: "scalar",     setter: "setSpatialModel",       def: "SAR",    role: "Spatial model" },
  { key: "spatialWeightsMode",     kind: "scalar",     setter: "setSpatialWeightsMode", def: "inline", role: "Spatial weights mode" },
  { key: "spatialGeomCol",         kind: "column",     setter: "setSpatialGeomCol", def: "", role: "Geometry column" },
  { key: "spatialWeightsDatasetId", kind: "datasetRef", setter: "setSpatialWeightsDatasetId", def: "", role: "Spatial weights dataset" },
  { key: "spatialWeightsType",     kind: "scalar",     setter: "setSpatialWeightsType",  def: "queen", role: "Spatial weights type" },
  { key: "spatialWeightsStyle",    kind: "scalar",     setter: "setSpatialWeightsStyle", def: "W",     role: "Spatial weights style" },
  { key: "spatialWeightsK",        kind: "scalar",     setter: "setSpatialWeightsK",     def: 4,       role: "Spatial k (neighbors)" },
  { key: "spatialWeightsD",        kind: "scalar",     setter: "setSpatialWeightsD",     def: 1000,    role: "Spatial distance threshold" },
  // NOT kind:"column". These name columns in the WEIGHTS dataset — the one
  // spatialWeightsDatasetId points at — not in the dataset being modelled:
  // resolveSpatialWeights reads them as ds.rows.map(r => r[iCol])
  // (ModelingTab.jsx:625-631). Header-checking them against the active dataset
  // would make every imported spatial spec falsely report "i — not in this
  // dataset" and then clear a perfectly valid value.
  { key: "spatialWeightsICol",     kind: "scalar",     setter: "setSpatialWeightsICol", def: "i", role: "Weights i column" },
  { key: "spatialWeightsJCol",     kind: "scalar",     setter: "setSpatialWeightsJCol", def: "j", role: "Weights j column" },
  { key: "spatialWeightsWCol",     kind: "scalar",     setter: "setSpatialWeightsWCol", def: "w", role: "Weights w column" },

  { key: "seType",            kind: "enum", values: SE_TYPE_IDS, def: "classical", setter: "setSeType", role: "SE type" },
  { key: "clusterVar",        kind: "column",     setter: "setClusterVar",  def: null, role: "Cluster variable" },
  { key: "clusterVar2",       kind: "column",     setter: "setClusterVar2", def: null, role: "Second cluster variable" },
  { key: "timeVar",           kind: "column",     setter: "setTimeVar",     def: null, role: "HAC time variable" },
  { key: "maxLag",            kind: "scalar",     setter: "setMaxLag",      def: null, role: "HAC max lag" },
];

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
        // factorVars really is a Set in ModelingTab state (`.has`/`.size` are
        // used against it directly) — accept it here rather than relying on
        // every future call site to remember `[...factorVars]` itself, which
        // is exactly the class of bug that dropped this field silently once
        // already.
        if (Array.isArray(v)) spec[f.key] = v.filter(c => typeof c === "string");
        else if (v instanceof Set) spec[f.key] = [...v].filter(c => typeof c === "string");
        // `null` is a meaningful value only for `nullable` fields (feCols: "use
        // the estimator's own default"). Serialise it explicitly rather than
        // dropping the key, or that distinction is lost the moment a spec is
        // written to disk (see field-table comment on `nullable`).
        else if (v === null && f.nullable) spec[f.key] = null;
        break;
      case "columnMap":
        if (v && typeof v === "object" && !Array.isArray(v)) {
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

// Resolves a field's default for a given call: runs a function-valued `def`
// against ctx (factorVars: dataset-dependent), then CLONES arrays/objects so
// the table's own (frozen) instance is never handed to a setter. Without the
// clone, `a.xVars === <the table's def>` would be true and one in-place
// `.push` anywhere downstream would permanently poison every later reset —
// verified by mutation testing, see the harness's "def identity" section.
function resolveDef(f, ctx) {
  const raw = typeof f.def === "function" ? f.def(ctx) : f.def;
  if (Array.isArray(raw)) return [...raw];
  if (raw && typeof raw === "object") return { ...raw };
  return raw;
}

// ── applySpec ────────────────────────────────────────────────────────────────
// Writes a spec into the sidebar via `setters` (keyed by the field's `setter`
// name). This is a REPLACE, not a merge: every declared field is written on
// every call — present-and-valid fields from `spec`, invalid ones and absent
// ones both fall back to that field's `def` — so restoring spec A and then
// spec B never leaves any of A's values behind (e.g. a stale HC3 `seType` or
// RDD bandwidth surviving underneath a freshly-restored OLS spec).
//
// Never throws on malformed input — this is the untrusted-file-import path.
// A field whose value has the wrong SHAPE (a string where an array was
// expected, a null term in `interactionTerms`, …) is treated exactly like an
// unresolvable column: it falls back to `def` and is reported, not thrown.
//
// ctx = {
//   headers:    string[]            — active dataset's columns
//   datasetIds: string[]            — session-local dataset ids
//   panel:      {entityCol,timeCol}|null
//   modelIds:   string[]|undefined  — valid `model` ids; when absent, `model`
//               is written through UNVALIDATED rather than cleared, because
//               the caller chose not to supply the estimator vocabulary
//   levels:     {[col]: string[]}|undefined — known levels per factor column;
//               when absent, factorRefs' LEVEL (not column) is not checked —
//               this function does NOT claim to validate levels without it
// }
export function applySpec(spec = {}, setters = {}, ctx = {}) {
  // Untrusted-file-import path: a hand-edited or malformed model.json can put
  // ANYTHING at the top level. `{}` default only catches undefined; a
  // primitive or array spec (`"OLS"`, `42`, `true`, `[1,2,3]`) would make
  // `f.key in spec` throw. Treat anything that isn't a plain object as empty
  // — every field then resets to its default, same as a spec with no keys.
  if (!spec || typeof spec !== "object" || Array.isArray(spec)) spec = {};
  const headers    = new Set(ctx.headers ?? []);
  const datasetIds = new Set(ctx.datasetIds ?? []);
  const panel       = ctx.panel ?? null;
  const unapplied   = [];
  const report = (f, value, reason) =>
    unapplied.push({ key: f.key, role: f.role ?? f.key, value, reason });

  const write = (f, v) => {
    const set = f.setter ? setters[f.setter] : null;
    if (set) set(f.wrapped ? (v == null || v === "" ? [] : [v]) : v);
  };

  const isValidFeCol = (f, c) => {
    if (typeof c !== "string") return false;
    if (headers.has(c)) return true;
    if (f.allowSynthetic && c.includes("×")) {
      const parts = c.split("×");
      return parts.length > 0 && parts.every(p => headers.has(p));
    }
    return false;
  };

  for (const f of MODEL_SPEC_FIELDS) {
    if (!(f.key in spec)) {
      // Absent from the incoming spec: reset to this field's default rather
      // than leaving whatever the PREVIOUS applySpec call (or user click)
      // left in place. panelRef has no setter — nothing to reset.
      if (f.kind !== "panelRef") write(f, resolveDef(f, ctx));
      continue;
    }
    const v = spec[f.key];

    // A key present with an explicit `undefined` value (a hand-built JS spec
    // object, not JSON — JSON has no `undefined`) carries no information;
    // treat it exactly like the key being absent rather than writing
    // `undefined` straight into a setter.
    if (v === undefined) {
      if (f.kind !== "panelRef") write(f, resolveDef(f, ctx));
      continue;
    }

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
        if (typeof v !== "string") { report(f, v, "bad-shape"); write(f, resolveDef(f, ctx)); break; }
        if (headers.has(v)) write(f, v);
        else { report(f, v, "no-column"); write(f, resolveDef(f, ctx)); }
        break;
      }
      case "columns": {
        if (v === null) {
          if (f.nullable) { write(f, null); break; }
          report(f, v, "bad-shape"); write(f, resolveDef(f, ctx)); break;
        }
        if (!Array.isArray(v)) { report(f, v, "bad-shape"); write(f, resolveDef(f, ctx)); break; }
        const kept = v.filter(c => isValidFeCol(f, c));
        const lost = v.filter(c => !isValidFeCol(f, c));
        if (lost.length) report(f, lost.join(", "), "no-column");
        write(f, kept);
        break;
      }
      case "columnMap": {
        if (!v || typeof v !== "object" || Array.isArray(v)) {
          report(f, v, "bad-shape"); write(f, resolveDef(f, ctx)); break;
        }
        const kept = {};
        const lostCols = [];
        const lostLevels = [];
        for (const [col, lvl] of Object.entries(v)) {
          if (!isPrimitive(lvl)) { lostCols.push(col); continue; }  // matches collectSpec's own normalisation guard
          if (!headers.has(col)) { lostCols.push(col); continue; }
          const known = ctx.levels?.[col];
          if (known && !known.includes(String(lvl))) { lostLevels.push(`${col}=${lvl}`); continue; }
          kept[col] = String(lvl);  // normalise to string, matching collectSpec
        }
        if (lostCols.length) report(f, lostCols.join(", "), "no-column");
        if (lostLevels.length) report(f, lostLevels.join(", "), "no-level");
        write(f, kept);
        break;
      }
      case "termList": {
        if (!Array.isArray(v)) { report(f, v, "bad-shape"); write(f, resolveDef(f, ctx)); break; }
        // A term is validated as a UNIT: a half-term would render as an
        // editable but meaningless row and expandInteractions would build a
        // product against a missing operand.
        const kept = [];
        const lost = [];
        for (const t of v) {
          const shapeOk = t && typeof t === "object" &&
            typeof t.var1 === "string" && typeof t.var2 === "string";
          if (!shapeOk) { lost.push(JSON.stringify(t)); continue; }
          if (!headers.has(t.var1) || !headers.has(t.var2)) {
            lost.push(`${t.var1}${t.type}${t.var2}`); continue;
          }
          kept.push({ var1: t.var1, var2: t.var2, type: t.type === ":" ? ":" : "*" });  // same normalisation as collectSpec
        }
        if (lost.length) report(f, lost.join(", "), "no-column");
        write(f, kept);
        break;
      }
      case "datasetRef": {
        if (!v) { write(f, resolveDef(f, ctx)); break; }
        if (datasetIds.has(v)) write(f, v);
        else { report(f, v, "no-dataset"); write(f, resolveDef(f, ctx)); }
        break;
      }
      case "enum": {
        // A non-primitive enum value (`{model: {a:1}}`) is malformed input,
        // not "an id we don't recognise" — report it as such rather than
        // burying it under the generic "unknown-value" reason.
        if (v !== null && typeof v === "object") {
          report(f, v, "bad-shape"); write(f, resolveDef(f, ctx)); break;
        }
        // `model` supplies its vocabulary via ctx.modelIds instead of a
        // static `values` list (the estimator id set lives in helpers.js /
        // EstimatorSidebar.jsx, not here). When the caller doesn't pass a
        // REAL, non-empty vocabulary, write the value through unvalidated
        // rather than clearing a perfectly good spec — an empty array is a
        // plausible transient (dataset still loading), not "supplied and your
        // id is unknown".
        if (f.ctxValues) {
          const values = ctx[f.ctxValues];
          if (!Array.isArray(values) || values.length === 0) { write(f, v); break; }
          if (values.includes(v)) write(f, v);
          else { report(f, v, "unknown-value"); write(f, resolveDef(f, ctx)); }
          break;
        }
        if ((f.values ?? []).includes(v)) write(f, v);
        else { report(f, v, "unknown-value"); write(f, resolveDef(f, ctx)); }
        break;
      }
      default: {
        if (isPrimitive(v)) write(f, v);
        else { report(f, v, "bad-shape"); write(f, resolveDef(f, ctx)); }
        break;
      }
    }
  }
  return { unapplied };
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
