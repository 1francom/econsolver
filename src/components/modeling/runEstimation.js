// ─── ECON STUDIO · components/modeling/runEstimation.js ──────────────────────
// The pure core of model estimation, extracted out of ModelingTab's
// _runEstimation so it can be called with an EXPLICIT config instead of
// reading React closure state — the only way to estimate N different specs in
// one pass without N renders in between (see Task 12 in the import/export
// plan). ModelingTab's _runEstimation becomes a thin wrapper around this.
//
// cfg matches EXACTLY what _runEstimation used to build inline: every
// dispatchEstimation(...) option, PLUS clusterVar/clusterVar2/timeVar/maxLag/
// spatialWeights* (read by the internal collectSpec call for specExtras, even
// though dispatchEstimation itself doesn't need them).
//
// extraCtx = { filename, datasetId } — replication metadata, not spec fields.
//
// PURE JS — no React import. It must stay node-importable so
// __validation__/runEstimationValidation.mjs can exercise it directly against
// the pre-extraction body it pins as a fixture.

import { dispatchEstimation } from "./runners/estimationDispatch.js";
import { MODEL_SPEC_FIELDS, collectSpec, applySpec } from "./modelSpec.js";
// ModelingTab.jsx imports buildSpatialWeights from the math barrel, not from
// SpatialEngine.js directly — match that here so both paths resolve the same
// implementation.
import { buildSpatialWeights } from "../../math/index.js";

export function runEstimationOnRows(dataRows, cfg, extraCtx = {}) {
  const dispatch = dispatchEstimation(dataRows, cfg);

  // Same enrichment _runEstimation always did: collectSpec is the single
  // owner of what a spec contains, so specExtras is built through it, not by
  // hand-listing fields here (that duplication is exactly what caused the
  // original spec to be incomplete for several estimators — see Task 1).
  //
  // The three keys added on top of `cfg` are the ones whose SPEC name differs
  // from the cfg name: `selectedFeCols` (cfg calls it `feCols`, and the
  // RESOLVED list is passed on purpose — the recipe must record the FE set the
  // model actually ran with, so the collect side never emits the `nullable`
  // null here) and the two panelRef fields, which live on `cfg.panel`.
  const specExtras = {
    ...collectSpec({
      ...cfg,
      selectedFeCols: cfg.feCols,
      entityCol: cfg.panel?.entityCol ?? null,
      timeCol: cfg.panel?.timeCol ?? null,
    }),
    filename: extraCtx.filename ?? null,
  };
  if (dispatch?.result?.spec)      Object.assign(dispatch.result.spec,      specExtras);
  if (dispatch?.result?.fe?.spec)  Object.assign(dispatch.result.fe.spec,   specExtras);
  if (dispatch?.result?.fd?.spec)  Object.assign(dispatch.result.fd.spec,   specExtras);
  const _dsTag = extraCtx.datasetId ?? null;
  if (dispatch?.result)     dispatch.result.datasetId    = _dsTag;
  if (dispatch?.result?.fe) dispatch.result.fe.datasetId = _dsTag;
  if (dispatch?.result?.fd) dispatch.result.fd.datasetId = _dsTag;
  return dispatch;
}

// ── buildEstimationConfigFromSpec ────────────────────────────────────────────
// Resolves an imported/pinned spec into the exact cfg shape
// runEstimationOnRows expects — WITHOUT writing into React state or waiting
// for a render. Reuses applySpec for every MODEL_SPEC_FIELDS-covered field
// (all of Task 1's validation — bad-shape guards, def-reset, factorVars
// shape-checking — applies here for free); derives the three fields that are
// NOT in the table (panel, seOpts, resolveSpatialWeights) the same way the
// live sidebar does, parameterized instead of closed over state.
//
// ctx = { headers, datasetIds, panel, modelIds, defaultFactorVars, availableDatasets }
export function buildEstimationConfigFromSpec(spec, ctx = {}) {
  const collect = {};
  const setters = {};
  for (const f of MODEL_SPEC_FIELDS) {
    if (!f.setter) continue;                               // panelRef fields
    const key = f.stateKey ?? f.key;
    // factorVars MUST be a real Set — helpers.js's applyFactors calls
    // .has() on it directly (`vars.filter(v => factorVars.has(v))`,
    // helpers.js:64) with no array tolerance, so a plain array throws
    // "factorVars.has is not a function" on the first factor expansion.
    // This is the one place this collector cannot be the harness's generic
    // makeSetters helper (which has no need to simulate that, since it only
    // checks collectSpec/applySpec's own round-trip, not a real downstream
    // consumer) — do not "simplify" by sharing that helper; the Set-wrapping
    // requirement is specific to feeding a REAL estimation dispatch.
    setters[f.setter] = key === "factorVars"
      ? (arr) => { collect.factorVars = new Set(arr ?? []); }
      : (v) => { collect[key] = v; };
  }
  const { unapplied } = applySpec(spec, setters, ctx);

  const panel = ctx.panel ?? null;
  const seOpts = {
    seType: collect.seType, clusterVar: collect.clusterVar, clusterVar2: collect.clusterVar2,
    timeVar: collect.timeVar ?? panel?.timeCol ?? null,
    maxLag: collect.maxLag ? parseInt(collect.maxLag) : null,
  };

  // Mirrors ModelingTab.jsx's resolveSpatialWeights (:669-712) exactly,
  // parameterized by `collect` (the resolved spec fields) and
  // ctx.availableDatasets instead of component state. Keep the two in sync:
  // if that one changes, this one has to change with it.
  function resolveSpatialWeights(dataRows) {
    if (collect.spatialWeightsMode === "inline") {
      if (!collect.spatialGeomCol) return { error: "Select a geometry WKT column for W." };
      try {
        return buildSpatialWeights(dataRows, collect.spatialGeomCol, {
          type: collect.spatialWeightsType,
          style: collect.spatialWeightsStyle,
          k: Number(collect.spatialWeightsK) || 4,
          d: Number(collect.spatialWeightsD) || 1000,
        });
      } catch (e) {
        return { error: e.message || "Could not build spatial weights from geometry." };
      }
    }

    const ds = (ctx.availableDatasets ?? []).find(d => d.id === collect.spatialWeightsDatasetId);
    if (!ds?.rows?.length) return { error: "Select a saved spatial weights triples dataset." };
    const iCol = collect.spatialWeightsICol || "i";
    const jCol = collect.spatialWeightsJCol || "j";
    const wCol = collect.spatialWeightsWCol || "w";
    const raw = ds.rows
      .map(r => ({ i: Number(r[iCol]), j: Number(r[jCol]), w: Number(r[wCol] ?? 1) }))
      .filter(t => Number.isFinite(t.i) && Number.isFinite(t.j) && Number.isFinite(t.w));
    if (!raw.length) return { error: "Weights dataset must contain numeric i, j, and w columns." };
    const minIdx = Math.min(...raw.flatMap(t => [t.i, t.j]));
    const maxIdx = Math.max(...raw.flatMap(t => [t.i, t.j]));
    const shift = minIdx === 1 && maxIdx === dataRows.length ? 1 : 0;
    const weights = raw.map(t => ({ i: t.i - shift, j: t.j - shift, w: t.w }));
    const counts = dataRows.map((_, i) => weights.filter(t => t.i === i).length);
    return {
      ids: dataRows.map((_, i) => i),
      weights,
      summary: {
        n: dataRows.length,
        links: weights.length,
        avgNeighbors: counts.reduce((s, v) => s + v, 0) / Math.max(1, dataRows.length),
        islands: counts.filter(v => v === 0).length,
        type: "triples",
        style: "custom",
      },
    };
  }

  return {
    cfg: {
      ...collect,
      // feCols' `nullable` "use the estimator's default" branch is for the
      // live sidebar, where a user hasn't picked FE yet. Every spec THIS APP
      // exports carries an explicit feCols list (Task 3's design note — the
      // collect side never emits null there), so an imported file realistically
      // always has one; [] is the sane floor if it somehow doesn't.
      feCols: collect.selectedFeCols ?? [],
      panel, seOpts, resolveSpatialWeights,
    },
    unapplied,
  };
}
