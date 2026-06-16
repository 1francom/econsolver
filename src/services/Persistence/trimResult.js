// ─── ECON STUDIO · services/Persistence/trimResult.js ────────────────────────
// Comparison-sufficient projection of an EstimationResult: keeps coefficients,
// fit stats, and the model spec; strips heavy arrays (fitted values, residuals,
// vcov, first-stage arrays) that bloat IndexedDB / AI payloads and are not
// needed to redisplay or export a pinned model.
//
// Shared by services/modelBuffer.js (persisted pinned models) and
// services/AI/sessionSnapshot.js (AI session context) — single source of truth.

export function trimResult(r) {
  if (!r || typeof r !== "object") return null;
  const {
    id, type, label, modelLabel, datasetId, spec, yVar, xVars, zVars, wVars, varNames,
    beta, se, pVals, tStats, testStats, R2, adjR2, n, df, Fstat, Fpval,
    att, attSE, attP, late, lateSE, lateP, seType, kernel, bandwidth, cutoff,
    runningVar, treatVar, postVar, entityCol, timeCol,
  } = r;
  return {
    id,
    datasetId: datasetId ?? null,
    type,
    label: label ?? modelLabel,
    spec: spec ?? { yVar, xVars, zVars, wVars, entityCol, timeCol, postVar, treatVar, runningVar, cutoff, bandwidth, kernel },
    varNames, beta, se, pVals,
    tStats: tStats ?? testStats,
    R2, adjR2, n, df, Fstat, Fpval,
    att, attSE, attP, late, lateSE, lateP, seType,
  };
}
