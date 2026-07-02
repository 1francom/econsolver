// ─── ECON STUDIO · services/Persistence/trimResult.js ────────────────────────
// Comparison-sufficient projection of an EstimationResult: keeps coefficients,
// fit stats, first-stage summaries, and the model spec; strips heavy n-length
// arrays (fitted values, residuals, vcov) that bloat IndexedDB / AI payloads
// and are not needed to redisplay or export a pinned model.
//
// Shared by services/modelBuffer.js (persisted pinned models) and
// services/AI/sessionSnapshot.js (AI session context) — single source of truth.

// IV-family (2SLS/GMM/LIML) first stages: keep the coefficient-level fields the
// result panels render, drop the n-length arrays (resid, Yhat).
function trimFirstStage(fs) {
  if (!fs || typeof fs !== "object") return null;
  const { endVar, Fstat, Fpval, weak, R2, adjR2, n, df, varNames, beta, se, tStats, pVals } = fs;
  return { endVar, Fstat, Fpval, weak, R2, adjR2, n, df, varNames, beta, se, tStats, pVals };
}

export function trimResult(r) {
  if (!r || typeof r !== "object") return null;
  const {
    id, type, label, modelLabel, datasetId, spec, yVar, xVars, zVars, wVars, varNames,
    beta, se, pVals, tStats, testStats, R2, adjR2, n, df, Fstat, Fpval,
    att, attSE, attP, late, lateSE, lateP, seType, kernel, bandwidth, cutoff,
    runningVar, treatVar, postVar, entityCol, timeCol,
    firstStages, jStat, jDf, jPval, kappa,
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
    ...(Array.isArray(firstStages)
      ? { firstStages: firstStages.map(trimFirstStage).filter(Boolean) }
      : {}),
    jStat, jDf, jPval, kappa,
  };
}
