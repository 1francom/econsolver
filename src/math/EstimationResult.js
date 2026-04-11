// ─── ECON STUDIO · src/math/EstimationResult.js ────────────────────────────────
// Canonical result wrapper.
// ALL estimator outputs pass through wrapResult() before touching the UI.
// This decouples every engine's idiosyncratic shape from ModelingTab, ReportingModule,
// AIService, and the export scripts — adding future estimators (GMM, DML, …) requires
// only a new wrapXxx() sub-function here, zero changes elsewhere.
//
// No React. No side effects. No external imports.
//
// EstimationResult shape:
//   id           string        — crypto.randomUUID()
//   type         string        — "OLS"|"WLS"|"FE"|"FD"|"2SLS"|"DiD"|"TWFE"|"RDD"|"Logit"|"Probit"
//   family       string        — "linear"|"panel"|"iv"|"did"|"rdd"|"binary"
//   timestamp    number        — Date.now()
//   label        string        — human-readable model name
//   color        string        — CSS color from ESTIMATOR_META
//
//   -- Core coefficient block (EVERY estimator populates these) --
//   varNames     string[]
//   beta         number[]
//   se           number[]
//   testStats    number[]      — t-stats for linear/panel, z-stats for binary
//   testStatLabel string       — "t" | "z"
//   pVals        number[]
//
//   -- Fit statistics (null when not applicable) --
//   R2           number|null
//   adjR2        number|null
//   R2Within     number|null   — FE only
//   R2Between    number|null   — FE only
//   mcFaddenR2   number|null   — Logit/Probit only
//   logLik       number|null   — Logit/Probit only
//   AIC          number|null   — Logit/Probit only
//   BIC          number|null   — Logit/Probit only
//   n            number
//   df           number
//   units        number|null   — FE/FD/TWFE: entity count
//   Fstat        number|null
//   Fpval        number|null
//
//   -- Treatment effects (null when not applicable) --
//   att          number|null   — DiD / TWFE ATT
//   attSE        number|null
//   attT         number|null
//   attP         number|null
//   late         number|null   — RDD LATE at cutoff
//   lateSE       number|null
//   lateP        number|null
//
//   -- Residuals & fitted (always arrays; empty [] if unavailable) --
//   resid        number[]
//   Yhat         number[]
//
//   -- Sub-results (null when not applicable) --
//   firstStages  Object[]|null — 2SLS first-stage engine outputs
//   marginalEffects Object[]|null — Logit/Probit MEM
//   oddsRatios   Object[]|null — Logit only
//   alphas       Object|null   — FE entity intercepts
//   eventMeans   Object[]|null — TWFE per-period means
//   means        Object|null   — DiD 2×2 group means
//   rddData      Object|null   — { valid, xc, D, Y, W, leftFit, rightFit, cutoff, h, kernelType }
//
//   -- Spec metadata (user's configuration) --
//   spec  {
//     yVar, xVars, wVars, zVars,
//     entityCol, timeCol,
//     treatVar, postVar,
//     runningVar, cutoff, bandwidth, kernel,
//     weightCol
//   }
//
//   -- Binary model flags --
//   converged    boolean
//   iterations   number|null

// ─── ESTIMATOR METADATA (id, label, color) ───────────────────────────────────
// Duplicated from EstimatorSidebar.jsx to avoid a circular dependency.
// Keep in sync with MODELS array in EstimatorSidebar.jsx.
const ESTIMATOR_META = {
  OLS:    { label: "OLS",              color: "#7ab896" },
  WLS:    { label: "WLS",              color: "#7ab896" },
  FE:     { label: "Fixed Effects",    color: "#6e9ec8" },
  FD:     { label: "First Differences",color: "#6e9ec8" },
  "2SLS": { label: "2SLS / IV",        color: "#c8a96e" },
  DiD:    { label: "DiD 2×2",          color: "#6ec8b4" },
  TWFE:   { label: "TWFE DiD",         color: "#6ec8b4" },
  RDD:    { label: "Sharp RDD",        color: "#c88e6e" },
  Logit:  { label: "Logit",            color: "#9e7ec8" },
  Probit: { label: "Probit",           color: "#9e7ec8" },
  GMM:    { label: "Two-Step GMM",     color: "#c8a96e" },
  LIML:   { label: "LIML",            color: "#c8a96e" },
  FuzzyRDD:        { label: "Fuzzy RDD",          color: "#c88e6e" },
  EventStudy:      { label: "Event Study",         color: "#6ec8b4" },
  LSDV:            { label: "Panel LSDV",          color: "#6e9ec8" },
  PoissonFE:       { label: "Poisson FE",          color: "#9e7ec8" },
  SyntheticControl:{ label: "Synthetic Control",   color: "#c8b46e" },
};

const FAMILY_MAP = {
  OLS: "linear", WLS: "linear",
  FE: "panel",   FD: "panel",
  "2SLS": "iv",
  DiD: "did",    TWFE: "did",
  RDD: "rdd",
  Logit: "binary", Probit: "binary",
  GMM: "iv",    LIML: "iv",
  FuzzyRDD: "rdd",
  EventStudy: "panel",
  LSDV: "panel",
  PoissonFE: "count",
  SyntheticControl: "sc",
};

// ─── HELPERS ─────────────────────────────────────────────────────────────────
function clean(arr) {
  return (arr ?? []).map(v => (v == null ? NaN : v));
}

function base(type, spec) {
  const meta = ESTIMATOR_META[type] ?? { label: type, color: "#888" };
  return {
    id:        crypto.randomUUID(),
    type,
    family:    FAMILY_MAP[type] ?? "linear",
    timestamp: Date.now(),
    label:     meta.label,
    color:     meta.color,
    spec:      spec ?? {},
    // defaults — overridden per type
    varNames: [], beta: [], se: [], testStats: [], testStatLabel: "t", pVals: [],
    R2: null, adjR2: null, R2Within: null, R2Between: null,
    mcFaddenR2: null, logLik: null, AIC: null, BIC: null,
    n: 0, df: 0, units: null, Fstat: null, Fpval: null,
    att: null, attSE: null, attT: null, attP: null,
    late: null, lateSE: null, lateP: null,
    resid: [], Yhat: [],
    firstStages: null, marginalEffects: null, oddsRatios: null,
    alphas: null, eventMeans: null, means: null, rddData: null,
    converged: true, iterations: null,
  };
}

// ─── OLS / WLS ───────────────────────────────────────────────────────────────
function wrapLinear(type, eng, spec) {
  return {
    ...base(type, spec),
    varNames:  eng.varNames  ?? [],
    beta:      clean(eng.beta),
    se:        clean(eng.se),
    testStats: clean(eng.tStats),
    pVals:     clean(eng.pVals),
    R2:        eng.R2    ?? null,
    adjR2:     eng.adjR2 ?? null,
    n:         eng.n     ?? 0,
    df:        eng.df    ?? 0,
    Fstat:     eng.Fstat ?? null,
    Fpval:     eng.Fpval ?? null,
    resid:     eng.resid ?? [],
    Yhat:      eng.Yhat  ?? [],
  };
}

// ─── FIXED EFFECTS ───────────────────────────────────────────────────────────
function wrapFE(eng, spec) {
  return {
    ...base("FE", spec),
    varNames:  eng.varNames ?? [],
    beta:      clean(eng.beta),
    se:        clean(eng.se),
    testStats: clean(eng.tStats),
    pVals:     clean(eng.pVals),
    R2Within:  eng.R2_within  ?? null,
    R2Between: eng.R2_between ?? null,
    n:         eng.n     ?? 0,
    df:        eng.df    ?? 0,
    units:     eng.units ?? null,
    Fstat:     eng.Fstat ?? null,
    Fpval:     eng.Fpval ?? null,
    resid:     eng.resid ?? [],
    Yhat:      eng.Yhat  ?? [],
    alphas:    eng.alphas ?? null,
  };
}

// ─── FIRST DIFFERENCES ───────────────────────────────────────────────────────
function wrapFD(eng, spec) {
  return {
    ...base("FD", spec),
    varNames:  eng.varNames ?? [],
    beta:      clean(eng.beta),
    se:        clean(eng.se),
    testStats: clean(eng.tStats),
    pVals:     clean(eng.pVals),
    R2:        eng.R2    ?? null,
    adjR2:     eng.adjR2 ?? null,
    n:         eng.n     ?? 0,
    df:        eng.df    ?? 0,
    units:     eng.units ?? null,
    Fstat:     eng.Fstat ?? null,
    Fpval:     eng.Fpval ?? null,
    resid:     eng.resid ?? [],
    Yhat:      eng.Yhat  ?? [],
  };
}

// ─── 2SLS / IV ───────────────────────────────────────────────────────────────
// eng shape: { firstStages[], second: { beta, se, tStats, pVals, R2, adjR2, n, df, varNames, resid, Yhat } }
function wrap2SLS(eng, spec) {
  const s = eng.second;
  return {
    ...base("2SLS", spec),
    varNames:    s.varNames ?? [],
    beta:        clean(s.beta),
    se:          clean(s.se),
    testStats:   clean(s.tStats),
    pVals:       clean(s.pVals),
    R2:          s.R2    ?? null,
    adjR2:       s.adjR2 ?? null,
    n:           s.n     ?? 0,
    df:          s.df    ?? 0,
    resid:       s.resid ?? [],
    Yhat:        s.Yhat  ?? [],
    firstStages: eng.firstStages ?? null,
  };
}

// ─── DiD 2×2 ─────────────────────────────────────────────────────────────────
// eng shape: { beta, se, tStats, pVals, R2, adjR2, n, df, varNames, resid, Yhat, att, attSE, attT, attP, means }
function wrapDiD(eng, spec) {
  return {
    ...base("DiD", spec),
    varNames:  eng.varNames ?? [],
    beta:      clean(eng.beta),
    se:        clean(eng.se),
    testStats: clean(eng.tStats),
    pVals:     clean(eng.pVals),
    R2:        eng.R2    ?? null,
    adjR2:     eng.adjR2 ?? null,
    n:         eng.n     ?? 0,
    df:        eng.df    ?? null,
    Fstat:     eng.Fstat ?? null,
    Fpval:     eng.Fpval ?? null,
    resid:     eng.resid ?? [],
    Yhat:      eng.Yhat  ?? [],
    att:       eng.att   ?? null,
    attSE:     eng.attSE ?? null,
    attT:      eng.attT  ?? null,
    attP:      eng.attP  ?? null,
    means:     eng.means ?? null,
  };
}

// ─── TWFE DiD ────────────────────────────────────────────────────────────────
// eng shape: { beta, se, tStats, pVals, R2, adjR2, n, df, units, varNames, resid, Yhat,
//              att, attSE, attT, attP, eventMeans, timesArr }
function wrapTWFE(eng, spec) {
  return {
    ...base("TWFE", spec),
    varNames:    eng.varNames ?? [],
    beta:        clean(eng.beta),
    se:          clean(eng.se),
    testStats:   clean(eng.tStats),
    pVals:       clean(eng.pVals),
    R2:          eng.R2    ?? null,
    adjR2:       eng.adjR2 ?? null,
    n:           eng.n     ?? 0,
    df:          eng.df    ?? null,
    units:       eng.units ?? null,
    resid:       eng.resid ?? [],
    Yhat:        eng.Yhat  ?? [],
    att:         eng.att   ?? null,
    attSE:       eng.attSE ?? null,
    attT:        eng.attT  ?? null,
    attP:        eng.attP  ?? null,
    eventMeans:  eng.eventMeans ?? null,
  };
}

// ─── SHARP RDD ───────────────────────────────────────────────────────────────
// eng shape: { beta, se, tStats, pVals, R2, n, df, varNames, resid, yhat,
//              late, lateSE, lateP, cutoff, h, kernelType,
//              valid, xc, D, Y, W, leftFit, rightFit }
// Note: CausalEngine.runWLS returns resid + yhat (lowercase), not Yhat.
function wrapRDD(eng, spec, h) {
  return {
    ...base("RDD", spec),
    varNames:  eng.varNames ?? [],
    beta:      clean(eng.beta),
    se:        clean(eng.se),
    testStats: clean(eng.tStats),
    pVals:     clean(eng.pVals),
    R2:        eng.R2   ?? null,
    n:         eng.n    ?? 0,
    df:        eng.df   ?? 0,
    late:      eng.late   ?? null,
    lateSE:    eng.lateSE ?? null,
    lateP:     eng.lateP  ?? null,
    resid:     eng.resid ?? [],
    Yhat:      eng.yhat  ?? [],   // CausalEngine internal WLS uses lowercase yhat
    rddData: {
      valid:      eng.valid      ?? [],
      xc:         eng.xc         ?? [],
      D:          eng.D          ?? [],
      Y:          eng.Y          ?? [],
      W:          eng.W          ?? [],
      leftFit:    eng.leftFit    ?? [],
      rightFit:   eng.rightFit   ?? [],
      cutoff:     eng.cutoff     ?? null,
      h:          h              ?? eng.h ?? null,
      kernelType: eng.kernelType ?? null,
    },
  };
}

// ─── LOGIT / PROBIT ──────────────────────────────────────────────────────────
// eng shape: { family, beta, se, zStats, pVals, varNames, n, k, df, logLik, logLikNull,
//              mcFaddenR2, AIC, BIC, fitted, residuals, marginalEffects, oddsRatios,
//              converged, iterations }
function wrapBinary(type, eng, spec) {
  return {
    ...base(type, spec),
    varNames:       eng.varNames ?? [],
    beta:           clean(eng.beta),
    se:             clean(eng.se),
    testStats:      clean(eng.zStats),
    testStatLabel:  "z",
    pVals:          clean(eng.pVals),
    n:              eng.n    ?? 0,
    k:              eng.k    ?? null,
    df:             eng.df   ?? 0,
    logLik:         eng.logLik      ?? null,
    mcFaddenR2:     eng.mcFaddenR2  ?? null,
    AIC:            eng.AIC         ?? null,
    BIC:            eng.BIC         ?? null,
    resid:          eng.residuals   ?? [],  // Pearson residuals
    Yhat:           eng.fitted      ?? [],  // P̂(Y=1)
    marginalEffects: eng.marginalEffects ?? null,
    oddsRatios:     eng.oddsRatios  ?? null,
    converged:      eng.converged   ?? false,
    iterations:     eng.iterations  ?? null,
  };
}

// ─── GMM ─────────────────────────────────────────────────────────────────────
// eng shape: { varNames, beta, se, tStats, pVals, R2, adjR2, n, df,
//              jStat, jPval, jDf, resid, Yhat, firstStages }
function wrapGMM(eng, spec) {
  return {
    ...base("GMM", spec),
    varNames:    eng.varNames    ?? [],
    beta:        clean(eng.beta),
    se:          clean(eng.se),
    testStats:   clean(eng.tStats),
    pVals:       clean(eng.pVals),
    R2:          eng.R2          ?? null,
    adjR2:       eng.adjR2       ?? null,
    n:           eng.n           ?? 0,
    df:          eng.df          ?? 0,
    resid:       eng.resid       ?? [],
    Yhat:        eng.Yhat        ?? [],
    firstStages: eng.firstStages ?? null,
    jStat:       eng.jStat       ?? null,
    jPval:       eng.jPval       ?? null,
    jDf:         eng.jDf         ?? null,
  };
}

// ─── LIML ────────────────────────────────────────────────────────────────────
// eng shape: { varNames, beta, se, tStats, pVals, R2, adjR2, n, df,
//              kappa, resid, Yhat, firstStages }
function wrapLIML(eng, spec) {
  return {
    ...base("LIML", spec),
    varNames:    eng.varNames    ?? [],
    beta:        clean(eng.beta),
    se:          clean(eng.se),
    testStats:   clean(eng.tStats),
    pVals:       clean(eng.pVals),
    R2:          eng.R2          ?? null,
    adjR2:       eng.adjR2       ?? null,
    n:           eng.n           ?? 0,
    df:          eng.df          ?? 0,
    resid:       eng.resid       ?? [],
    Yhat:        eng.Yhat        ?? [],
    firstStages: eng.firstStages ?? null,
    kappa:       eng.kappa       ?? null,
  };
}

// ─── FUZZY RDD ────────────────────────────────────────────────────────────────
// eng shape: { late, lateSE, lateT, lateP, firstStageFstat, firstStageJumpD,
//              firstStageR2, weak, waldRatio, reducedForm,
//              beta, se, tStats, pVals, R2, varNames, n, df, bandwidth, kernel, cutoff,
//              leftFit, rightFit, Yhat, valid, xc, D, Y, W, Dhat }
function wrapFuzzyRDD(eng, spec) {
  return {
    ...base("FuzzyRDD", spec),
    varNames:  eng.varNames ?? [],
    beta:      clean(eng.beta),
    se:        clean(eng.se),
    testStats: clean(eng.tStats),
    pVals:     clean(eng.pVals),
    R2:        eng.R2  ?? null,
    n:         eng.n   ?? 0,
    df:        eng.df  ?? 0,
    late:      eng.late   ?? null,
    lateSE:    eng.lateSE ?? null,
    lateP:     eng.lateP  ?? null,
    resid:     [],
    Yhat:      eng.Yhat   ?? [],
    // Fuzzy-specific
    firstStageFstat:  eng.firstStageFstat  ?? null,
    firstStageJumpD:  eng.firstStageJumpD  ?? null,
    firstStageR2:     eng.firstStageR2     ?? null,
    weak:             eng.weak             ?? false,
    waldRatio:        eng.waldRatio        ?? null,
    // Plot data (same shape as RDD)
    rddData: {
      valid:      eng.valid      ?? [],
      xc:         eng.xc         ?? [],
      D:          eng.D          ?? [],
      Y:          eng.Y          ?? [],
      W:          eng.W          ?? [],
      leftFit:    eng.leftFit    ?? [],
      rightFit:   eng.rightFit   ?? [],
      cutoff:     eng.cutoff     ?? null,
      h:          eng.bandwidth  ?? null,
      kernelType: eng.kernel     ?? null,
    },
    Dhat: eng.Dhat ?? [],
  };
}

// ─── EVENT STUDY ─────────────────────────────────────────────────────────────
// eng shape: { eventCoeffs, preTestStat, preTestPval, beta, se, tStats, pVals,
//              varNames, R2, adjR2, n, df, units, SSR, windowPre, windowPost }
function wrapEventStudy(eng, spec) {
  return {
    ...base("EventStudy", spec),
    varNames:  eng.varNames ?? [],
    beta:      clean(eng.beta),
    se:        clean(eng.se),
    testStats: clean(eng.tStats),
    pVals:     clean(eng.pVals),
    R2:        eng.R2    ?? null,
    adjR2:     eng.adjR2 ?? null,
    n:         eng.n     ?? 0,
    df:        eng.df    ?? 0,
    units:     eng.units ?? null,
    resid:     [],
    Yhat:      [],
    // Event-study specific
    eventCoeffs:  eng.eventCoeffs  ?? [],
    preTestStat:  eng.preTestStat  ?? null,
    preTestPval:  eng.preTestPval  ?? null,
    windowPre:    eng.windowPre    ?? null,
    windowPost:   eng.windowPost   ?? null,
  };
}

// ─── PANEL LSDV ──────────────────────────────────────────────────────────────
// eng shape: { varNames, beta, se, tStats, pVals, R2, adjR2, n, df, Fstat, Fpval,
//              resid, Yhat, alphas, units, times, timeFE, refUnit }
function wrapLSDV(eng, spec) {
  return {
    ...base("LSDV", spec),
    varNames:  eng.varNames ?? [],
    beta:      clean(eng.beta),
    se:        clean(eng.se),
    testStats: clean(eng.tStats),
    pVals:     clean(eng.pVals),
    R2:        eng.R2    ?? null,
    adjR2:     eng.adjR2 ?? null,
    n:         eng.n     ?? 0,
    df:        eng.df    ?? 0,
    units:     eng.units?.length ?? null,
    Fstat:     eng.Fstat ?? null,
    Fpval:     eng.Fpval ?? null,
    resid:     eng.resid ?? [],
    Yhat:      eng.Yhat  ?? [],
    alphas:    eng.alphas ?? null,
    // LSDV-specific
    timeFE:    eng.timeFE ?? false,
    refUnit:   eng.refUnit ?? null,
  };
}

// ─── POISSON FE ──────────────────────────────────────────────────────────────
// eng shape: { beta, se, zStats, pVals, varNames, n, k, df, logLik, nullLogLik,
//              McFaddenR2, AIC, BIC, alphas, fitted, resid, converged, iterations }
function wrapPoissonFE(eng, spec) {
  return {
    ...base("PoissonFE", spec),
    varNames:       eng.varNames       ?? [],
    beta:           clean(eng.beta),
    se:             clean(eng.se),
    testStats:      clean(eng.zStats),
    testStatLabel:  "z",
    pVals:          clean(eng.pVals),
    n:              eng.n              ?? 0,
    df:             eng.df             ?? 0,
    logLik:         eng.logLik         ?? null,
    mcFaddenR2:     eng.McFaddenR2     ?? null,
    AIC:            eng.AIC            ?? null,
    BIC:            eng.BIC            ?? null,
    resid:          eng.resid          ?? [],
    Yhat:           eng.fitted         ?? [],
    alphas:         eng.alphas         ?? null,
    converged:      eng.converged      ?? false,
    iterations:     eng.iterations     ?? null,
    // IRR: exp(beta)
    IRR:            (eng.beta ?? []).map(b => Math.exp(b)),
  };
}

// ─── SYNTHETIC CONTROL ───────────────────────────────────────────────────────
// eng shape: { weights, preFit, postGap, rmspe_pre, rmspe_post,
//              placebos, pValue, donors, treatedUnit, treatTime }
function wrapSyntheticControl(eng, spec) {
  return {
    ...base("SyntheticControl", spec),
    // No coefficient block for SC — set all to empty
    varNames:  [],
    beta:      [],
    se:        [],
    testStats: [],
    pVals:     [],
    n:         (eng.preFit?.length ?? 0) + (eng.postGap?.length ?? 0),
    df:        0,
    resid:     [],
    Yhat:      [],
    // SC-specific
    scWeights:    eng.weights   ?? {},
    scPreFit:     eng.preFit    ?? [],
    scPostGap:    eng.postGap   ?? [],
    scRmspePre:   eng.rmspe_pre  ?? null,
    scRmspePost:  eng.rmspe_post ?? null,
    scPlacebos:   eng.placebos  ?? [],
    scPValue:     eng.pValue    ?? null,
    scDonors:     eng.donors    ?? [],
    scTreatedUnit: eng.treatedUnit ?? null,
    scTreatTime:  eng.treatTime ?? null,
  };
}

// ─── PUBLIC API ───────────────────────────────────────────────────────────────

/**
 * wrapResult — normalise any engine output into a canonical EstimationResult.
 *
 * @param {string} type       — "OLS"|"WLS"|"FE"|"FD"|"2SLS"|"DiD"|"TWFE"|"RDD"|"Logit"|"Probit"
 * @param {Object} engineOutput — raw output from the math engine
 * @param {Object} spec         — user's model spec { yVar, xVars, wVars, ... }
 * @param {Object} [extras]     — type-specific extras (e.g. { h } for RDD)
 * @returns {EstimationResult}
 */
export function wrapResult(type, engineOutput, spec, extras = {}) {
  switch (type) {
    case "OLS":    return wrapLinear("OLS",  engineOutput, spec);
    case "WLS":    return wrapLinear("WLS",  engineOutput, spec);
    case "FE":     return wrapFE(engineOutput, spec);
    case "FD":     return wrapFD(engineOutput, spec);
    case "2SLS":   return wrap2SLS(engineOutput, spec);
    case "DiD":    return wrapDiD(engineOutput, spec);
    case "TWFE":   return wrapTWFE(engineOutput, spec);
    case "RDD":    return wrapRDD(engineOutput, spec, extras.h);
    case "Logit":  return wrapBinary("Logit",  engineOutput, spec);
    case "Probit": return wrapBinary("Probit", engineOutput, spec);
    case "GMM":    return wrapGMM(engineOutput, spec);
    case "LIML":   return wrapLIML(engineOutput, spec);
    case "FuzzyRDD":        return wrapFuzzyRDD(engineOutput, spec);
    case "EventStudy":      return wrapEventStudy(engineOutput, spec);
    case "LSDV":            return wrapLSDV(engineOutput, spec);
    case "PoissonFE":       return wrapPoissonFE(engineOutput, spec);
    case "SyntheticControl":return wrapSyntheticControl(engineOutput, spec);
    default:
      console.warn("[EstimationResult] Unknown type:", type);
      return { ...base(type, spec) };
  }
}

/**
 * getCoeffBlock — extract the minimal coefficient block for Stargazer / AI prompts.
 * Returns { varNames, beta, se, testStats, testStatLabel, pVals, n, df }
 */
export function getCoeffBlock(result) {
  return {
    varNames:      result.varNames,
    beta:          result.beta,
    se:            result.se,
    testStats:     result.testStats,
    testStatLabel: result.testStatLabel,
    pVals:         result.pVals,
    n:             result.n,
    df:            result.df,
  };
}
