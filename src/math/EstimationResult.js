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
//
//   -- Hybrid-schema additions (always populated by finalize()) --
//   vcov         number[][]|null  — k×k variance-covariance matrix (OLS-family: s² · (X'X)⁻¹)
//   ci95         { lo:number[], hi:number[] } | null  — 95% CI per coefficient (t-based for "t" labels, z-based for "z")
//   warnings     string[]         — engine-emitted warnings (collinearity dropped, weak IV, non-convergence, …)
//   formula      string|null      — human-readable spec, e.g. "wage ~ educ + exper | entity"

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
  SpatialRDD:      { label: "Spatial RD",         color: "#c88e6e" },
  EventStudy:      { label: "Event Study",         color: "#6ec8b4" },
  SunAbraham:      { label: "Sun & Abraham (2021)", color: "#6ec8b4" },
  LSDV:            { label: "Panel LSDV",          color: "#6e9ec8" },
  Poisson:         { label: "Poisson GLM",          color: "#9e7ec8" },
  PoissonFE:       { label: "Poisson FE",          color: "#9e7ec8" },
  NegBinFE:        { label: "Negative Binomial FE", color: "#9e7ec8" },
  SyntheticControl:{ label: "Synthetic Control",   color: "#c8b46e" },
  CallawayCS:      { label: "Callaway-Sant'Anna DiD", color: "#6ec8b4" },
  SpatialRegression:{ label: "Spatial Regression", color: "#6ec8b4" },
  IVPoisson:        { label: "IV-Poisson",          color: "#c8a96e" },
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
  SpatialRDD: "rdd",
  EventStudy: "panel",
  SunAbraham: "did",
  LSDV: "panel",
  Poisson: "count",
  PoissonFE: "count",
  NegBinFE: "count",
  SyntheticControl: "sc",
  CallawayCS: "did",
  SpatialRegression: "spatial",
  IVPoisson: "iv",
};

// ─── HELPERS ─────────────────────────────────────────────────────────────────
function clean(arr) {
  return (arr ?? []).map(v => (v == null ? NaN : v));
}

// Two-tailed t critical value at α=0.05. Linear-interpolated lookup table; falls
// back to 1.96 for df>200 or unknown. Used only for ci95 fallback when the engine
// does not emit one directly.
function tCrit95(df) {
  if (df == null || df <= 0 || df > 200) return 1.96;
  const T = [
    [1,12.706],[2,4.303],[3,3.182],[4,2.776],[5,2.571],
    [6,2.447],[7,2.365],[8,2.306],[9,2.262],[10,2.228],
    [12,2.179],[15,2.131],[20,2.086],[25,2.060],[30,2.042],
    [40,2.021],[60,2.000],[80,1.990],[120,1.980],[200,1.972],
  ];
  for (let i=0; i<T.length; i++) {
    if (df <= T[i][0]) {
      if (i === 0) return T[0][1];
      const [d1,c1] = T[i-1], [d2,c2] = T[i];
      return c1 + (c2-c1) * (df-d1) / (d2-d1);
    }
  }
  return 1.96;
}

function buildCI95(beta, se, df, label) {
  if (!beta?.length || !se?.length) return null;
  const crit = label === "z" ? 1.96 : tCrit95(df);
  const lo = beta.map((b,i) => Number.isFinite(b) && Number.isFinite(se[i]) ? b - crit*se[i] : NaN);
  const hi = beta.map((b,i) => Number.isFinite(b) && Number.isFinite(se[i]) ? b + crit*se[i] : NaN);
  return { lo, hi };
}

// vcov for OLS-family: σ̂² · (X'X)⁻¹. Engines store XtXinv + s2; others can pass
// eng.vcov directly and finalize() will use it instead.
function vcovFromOLS(XtXinv, s2) {
  if (!XtXinv?.length || s2 == null || !Number.isFinite(s2)) return null;
  return XtXinv.map(row => row.map(v => v * s2));
}

// Human-readable formula string per estimator. Falls back to `yVar ~ xList` when
// the type is unknown. Always returns null if yVar is missing.
function buildFormula(type, spec) {
  if (!spec || !spec.yVar) return null;
  const { yVar, xVars=[], zVars=[], entityCol, timeCol, feCols,
          treatVar, postVar, runningVar, cutoff, weightCol,
          treatedUnit, treatTime, kPre, kPost } = spec;
  const x = xVars.length ? xVars.join(" + ") : "1";
  const z = zVars.length ? zVars.join(" + ") : "?";
  switch (type) {
    case "OLS":   return `${yVar} ~ ${x}`;
    case "WLS":   return `${yVar} ~ ${x}  [weights: ${weightCol ?? "?"}]`;
    case "FE":    return `${yVar} ~ ${x} | ${entityCol ?? "?"}`;
    case "FD":    return `${yVar} ~ Δ(${x}) | ${entityCol ?? "?"}`;
    case "2SLS":
    case "GMM":
    case "LIML":  return `${yVar} ~ ${x} | ${z}`;
    case "DiD":   return `${yVar} ~ ${treatVar ?? "treat"} × ${postVar ?? "post"}`;
    case "TWFE":  return `${yVar} ~ ${treatVar ?? "treat"} × ${postVar ?? "post"} | ${entityCol ?? "?"} + ${timeCol ?? "?"}`;
    case "RDD":       return `${yVar} ~ rdd(${runningVar ?? "?"}, c=${cutoff ?? "?"})`;
    case "FuzzyRDD":  return `${yVar} ~ fuzzy_rdd(${runningVar ?? "?"}, Z, c=${cutoff ?? "?"})`;
    case "SpatialRDD": return `${yVar} ~ spatial_rdd(dist=${spec.distCol ?? runningVar ?? "?"}, treat=${spec.treatmentCol ?? treatVar ?? "?"})`;
    case "Logit":     return `Logit(${yVar}) ~ ${x}`;
    case "Probit":    return `Probit(${yVar}) ~ ${x}`;
    case "Poisson":   return `Poisson(${yVar}) ~ ${x}`;
    case "PoissonFE": return `Poisson(${yVar}) ~ ${x} | ${(feCols && feCols.length ? feCols : [entityCol ?? "?"]).join(" + ")}`;
    case "NegBinFE":  return `NegBin(${yVar}) ~ ${x} | ${(feCols && feCols.length ? feCols : [entityCol ?? "?"]).join(" + ")}`;
    case "EventStudy": return `${yVar} ~ event(${kPre ?? "-K"}…${kPost ?? "+K"}) | ${entityCol ?? "?"} + ${timeCol ?? "?"}`;
    case "SunAbraham": return `Poisson(${yVar}) ~ sunab(${spec.cohortCol ?? "cohort"}, ${spec.periodCol ?? "period"})${xVars.length ? " + " + x : ""}${feCols && feCols.length ? " | " + feCols.join(" + ") : ""}`;
    case "LSDV":      return `${yVar} ~ ${x} + α_i${spec.lsdvTimeFE ? " + γ_t" : ""}`;
    case "SyntheticControl": return `${yVar} ~ SC(${treatedUnit ?? "?"}, t₀=${treatTime ?? "?"})`;
    case "CallawayCS": return `${yVar} ~ CS_DiD(g=${spec.treatCol ?? "?"}) | ${spec.entityCol ?? "?"} + ${spec.timeCol ?? "?"}`;
    case "SpatialRegression": return `${spec.spatialModel ?? "SAR"}(${yVar}) ~ ${x}`;
    case "IVPoisson": return `Poisson(${yVar}) ~ ${x} | ${z}`;
    default:          return `${yVar} ~ ${x}`;
  }
}

// finalize — populate the hybrid-schema fields after the per-type wrapXxx() has
// run. Reads engine-emitted overrides first (warnings / vcov / ci95), then derives
// safe fallbacks. Never overwrites a value the engine explicitly set.
function finalize(result, eng) {
  if (eng?.warnings?.length) result.warnings = eng.warnings;
  if (eng?.vcov)             result.vcov     = eng.vcov;
  if (eng?.ci95)             result.ci95     = eng.ci95;

  // Derived CI95 fallback when engine did not emit one.
  if (!result.ci95 && result.beta?.length && result.se?.length) {
    result.ci95 = buildCI95(result.beta, result.se, result.df, result.testStatLabel);
  }
  // Derived vcov fallback for OLS-family (uses stored XtXinv + s2).
  if (!result.vcov && result.XtXinv && result.s2 != null) {
    result.vcov = vcovFromOLS(result.XtXinv, result.s2);
  }
  return result;
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
    XtXinv: null, s2: null,   // for model prediction in CalculateTab
    // Hybrid-schema additions — populated by finalize()
    vcov: null, ci95: null, warnings: [], formula: buildFormula(type, spec),
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
    resid:     eng.resid  ?? [],
    Yhat:      eng.Yhat   ?? [],
    XtXinv:    eng.XtXinv ?? null,
    s2:        eng.s2     ?? null,
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
    mcCrary: eng.mcCrary ?? null,
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

// ─── IV-POISSON ──────────────────────────────────────────────────────────────
// eng shape: { varNames, beta, se, tStats, pVals, R2, n, df,
//              jStat, jPval, resid, Yhat, firstStages }
function wrapIVPoisson(eng, spec) {
  return {
    ...base("IVPoisson", spec),
    varNames:    eng.varNames    ?? [],
    beta:        clean(eng.beta),
    se:          clean(eng.se),
    testStats:   clean(eng.tStats),
    testStatLabel: "z",
    pVals:       clean(eng.pVals),
    R2:          eng.R2          ?? null,
    n:           eng.n           ?? 0,
    df:          eng.df          ?? 0,
    resid:       eng.resid       ?? [],
    Yhat:        eng.Yhat        ?? [],
    firstStages: eng.firstStages ?? null,
    jStat:       eng.jStat       ?? null,
    jPval:       eng.jPval       ?? null,
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
    // Plot data (same shape as Sharp RDD)
    rddData: {
      valid:      eng.valid      ?? [],
      xc:         eng.xc         ?? [],
      above:      eng.above      ?? [],  // Z indicator — used by RDDPlot to colour by side
      D:          eng.D          ?? [],
      Y:          eng.Y          ?? [],
      W:          eng.W          ?? [],
      leftFit:    eng.leftFit    ?? [],
      rightFit:   eng.rightFit   ?? [],
      cutoff:     eng.cutoff     ?? null,
      h:          eng.bandwidth  ?? null,
      kernelType: eng.kernel     ?? null,
      late:       eng.late       ?? null,
      lateP:      eng.lateP      ?? null,
    },
    Dhat: eng.Dhat ?? [],
    mcCrary: eng.mcCrary ?? null,
    // First-stage engine output (raw, not normalised through wrapResult)
    firstStage:         eng.firstStage         ?? null,
    firstStageVarNames: eng.firstStageVarNames ?? ["(Intercept)", "Z (instrument)", "running − c", "Z × (running − c)"],
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

// ─── SUN & ABRAHAM (2021) ────────────────────────────────────────────────────
// eng shape (runSunAbraham): { beta, se, varNames, vcov, zStats, pVals,
//   eventCoeffs:[{k,beta,se,z,p,irr,isRef?}], preTestStat/Df/Pval,
//   postTestStat/Df/Pval, logLik, McFaddenR2, AIC, BIC, n, k, df, nCohorts,
//   treatedCohorts, controlCohorts, droppedAlwaysTreated, nFE, feDims,
//   refPeriod, converged, iterations }
// testStatLabel "z" — coefficients are PPML/Poisson, inference is normal.
function wrapSunAbraham(eng, spec) {
  return {
    ...base("SunAbraham", spec),
    varNames:       eng.varNames       ?? [],
    beta:           clean(eng.beta),
    se:             clean(eng.se),
    testStats:      clean(eng.zStats),
    testStatLabel:  "z",
    pVals:          clean(eng.pVals),
    n:              eng.n              ?? 0,
    k:              eng.k              ?? (eng.beta ? eng.beta.length : null),
    df:             eng.df             ?? 0,
    logLik:         eng.logLik         ?? null,
    mcFaddenR2:     eng.McFaddenR2     ?? null,
    AIC:            eng.AIC            ?? null,
    BIC:            eng.BIC            ?? null,
    converged:      eng.converged      ?? false,
    iterations:     eng.iterations     ?? null,
    vcov:           eng.vcov           ?? null,
    // Sun-Abraham aggregated ATT path (same shape EventStudyPlot consumes,
    // plus IRR semi-elasticity exp(ATT_l)−1 from the Poisson link).
    eventCoeffs:    eng.eventCoeffs    ?? [],
    // Joint pre/post-trend Wald tests (χ²)
    preTestStat:    eng.preTestStat    ?? null,
    preTestDf:      eng.preTestDf      ?? null,
    preTestPval:    eng.preTestPval    ?? null,
    postTestStat:   eng.postTestStat   ?? null,
    postTestDf:     eng.postTestDf     ?? null,
    postTestPval:   eng.postTestPval   ?? null,
    // Cohort/control diagnostics
    nCohorts:            eng.nCohorts            ?? null,
    treatedCohorts:      eng.treatedCohorts      ?? null,
    controlCohorts:      eng.controlCohorts      ?? null,
    droppedAlwaysTreated:eng.droppedAlwaysTreated?? [],
    refPeriod:           eng.refPeriod           ?? [-1],
    nFE:                 eng.nFE                 ?? 0,
    feDims:              eng.feDims              ?? null,
    // IRR semi-elasticities per relative period from eventCoeffs
    IRR: (eng.eventCoeffs ?? []).map(e => e.irr),
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

// ─── POISSON GLM ─────────────────────────────────────────────────────────────
// eng shape: { family, beta, se, zStats, pVals, varNames, n, k, df,
//              logLik, nullLogLik, McFaddenR2, AIC, BIC, fitted, resid,
//              converged, iterations, hasOffset }
function wrapPoisson(eng, spec) {
  return {
    ...base("Poisson", spec),
    varNames:      eng.varNames      ?? [],
    beta:          clean(eng.beta),
    se:            clean(eng.se),
    testStats:     clean(eng.zStats),
    testStatLabel: "z",
    pVals:         clean(eng.pVals),
    n:             eng.n             ?? 0,
    df:            eng.df            ?? 0,
    logLik:        eng.logLik        ?? null,
    mcFaddenR2:    eng.McFaddenR2    ?? null,
    AIC:           eng.AIC           ?? null,
    BIC:           eng.BIC           ?? null,
    resid:         eng.resid         ?? [],
    Yhat:          eng.fitted        ?? [],
    converged:     eng.converged     ?? false,
    iterations:    eng.iterations    ?? null,
    hasOffset:     eng.hasOffset     ?? false,
    // IRR: exp(β) — proportional rate ratios
    IRR: (eng.beta ?? []).map(b => Math.exp(b)),
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
    k:              eng.k              ?? (eng.beta ? eng.beta.length : null),
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
    // Multi-way FE metadata (runPoissonFEMulti); absent ⇒ one-way runPoissonFE
    nFE:               eng.nFE               ?? 1,
    feDims:            eng.feDims            ?? null,
    feLevels:          eng.nLevels           ?? null,
    droppedZeroLevels: eng.droppedZeroLevels ?? 0,
    droppedSingletons: eng.droppedSingletons ?? 0,
    // IRR: exp(beta)
    IRR:            (eng.beta ?? []).map(b => Math.exp(b)),
  };
}

// ─── SYNTHETIC CONTROL ───────────────────────────────────────────────────────
// eng shape: { weights, preFit, postGap, rmspe_pre, rmspe_post,
//              placebos, pValue, donors, treatedUnit, treatTime }
// eng shape mirrors runPoissonFEMulti plus NB2 dispersion diagnostics:
// { alpha, alphaCI, overdispersionTest }
export function wrapNegBinFE(eng, spec) {
  return {
    ...base("NegBinFE", spec),
    modelType:       "NegBinFE",
    varNames:        eng.varNames       ?? [],
    beta:            clean(eng.beta),
    se:              clean(eng.se),
    testStats:       clean(eng.zStats),
    testStatLabel:   "z",
    pVals:           clean(eng.pVals),
    n:               eng.n              ?? 0,
    k:               eng.k              ?? (eng.beta ? eng.beta.length : null),
    df:              eng.df             ?? 0,
    logLik:          eng.logLik         ?? null,
    mcFaddenR2:      eng.McFaddenR2     ?? null,
    AIC:             eng.AIC            ?? null,
    BIC:             eng.BIC            ?? null,
    resid:           eng.resid          ?? [],
    Yhat:            eng.fitted         ?? [],
    alphas:          eng.alphas         ?? null,
    converged:       eng.converged      ?? false,
    iterations:      eng.iterations     ?? null,
    nFE:             eng.nFE            ?? 1,
    feDims:          eng.feDims         ?? null,
    feLevels:        eng.nLevels        ?? null,
    droppedZeroLevels: eng.droppedZeroLevels ?? 0,
    droppedSingletons: eng.droppedSingletons ?? 0,
    alpha:           eng.alpha          ?? null,
    alphaCI:         eng.alphaCI        ?? null,
    overdispersionTest: eng.overdispersionTest ?? null,
    extra: {
      alpha: eng.alpha ?? null,
      alphaCI: eng.alphaCI ?? null,
      overdispersionTest: eng.overdispersionTest ?? null,
    },
    IRR:              (eng.beta ?? []).map(b => Math.exp(b)),
  };
}

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
    scAtt:        eng.att        ?? null,
  };
}

// ─── CALLAWAY & SANT'ANNA (2021) ─────────────────────────────────────────────
// eng shape: { varNames, beta, se, zStats, pVals, att, attSE, attP,
//              n, nGroups, nPeriods, nUnits, df,
//              eventCoeffs:[{k,beta,se,z,p,isRef}], attGT, cohorts, compGroup }
function wrapCallawayCS(eng, spec) {
  if (eng.error) return { ...base("CallawayCS", spec), error: eng.error };
  const view = spec?.csDefaultView === "dynamic" ? "dynamic" : "group";
  const agg  = eng.aggregations ?? {};
  const es   = agg.dynamic?.byE ?? [];

  function twoSidedZ(z) {
    if (!isFinite(z)) return NaN;
    const t = 1 / (1 + 0.2316419 * Math.abs(z));
    const p = ((1 / Math.sqrt(2 * Math.PI)) * Math.exp(-0.5 * z * z)) *
              t * (0.319381530 + t * (-0.356563782 + t * (1.781477937 + t * (-1.821255978 + t * 1.330274429))));
    return 2 * Math.min(p, 1 - p);
  }

  const attBanner = agg[view]?.overall ?? null;
  const seBanner  = agg[view]?.se      ?? null;

  return {
    ...base("CallawayCS", spec),
    // Coefficient table = dynamic event-study series (for CoeffTable + export)
    varNames:      es.map(d => `e=${d.e}`),
    beta:          es.map(d => d.att  ?? null),
    se:            es.map(d => d.se   ?? null),
    testStats:     es.map(d => d.se ? d.att / d.se : null),
    testStatLabel: "z",
    pVals:         es.map(d => d.se ? twoSidedZ(d.att / d.se) : null),
    n:      eng.n      ?? 0,
    df:     eng.n      ?? 0,
    units:  eng.nUnits ?? null,
    // Banner ATT (from csDefaultView aggregation)
    att:    attBanner,
    attSE:  seBanner,
    attT:   seBanner ? attBanner / seBanner : null,
    attP:   seBanner ? twoSidedZ(attBanner / seBanner) : null,
    resid: [], Yhat: [],
    // Full CS contract for tabbed results panel + export
    aggregations:   eng.aggregations  ?? null,
    attgt:          eng.attgt         ?? [],
    csCohorts:      eng.cohorts       ?? [],
    csNGroups:      (eng.cohorts      ?? []).length || null,
    csCompGroup:    eng.controlGroup  ?? "nevertreated",
    csBasePeriod:   eng.basePeriod    ?? "varying",
    csEstMethod:    eng.estMethod     ?? "dr",
    csAnticipation: eng.anticipation  ?? 0,
    csInference:    eng.inference     ?? null,
    csDefaultView:  view,
    ptestWald:      eng.ptestWald     ?? null,
    warnings:       eng.warnings      ?? [],
    converged: true, iterations: null,
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
function wrapSpatialRegression(eng, spec) {
  return {
    ...base("SpatialRegression", { ...spec, spatialModel: eng.model ?? spec?.spatialModel }),
    label:          eng.model ? `Spatial ${eng.model}` : ESTIMATOR_META.SpatialRegression.label,
    varNames:       eng.varNames       ?? [],
    beta:           clean(eng.beta),
    se:             clean(eng.se),
    testStats:      clean(eng.zStats ?? eng.tStats),
    testStatLabel:  eng.zStats ? "z" : "t",
    pVals:          clean(eng.pVals),
    R2:             eng.R2             ?? null,
    adjR2:          eng.adjR2          ?? null,
    n:              eng.n              ?? 0,
    df:             eng.df             ?? 0,
    resid:          eng.resid          ?? [],
    Yhat:           eng.Yhat           ?? [],
    logLik:         eng.logLik         ?? null,
    AIC:            eng.AIC            ?? null,
    BIC:            eng.BIC            ?? null,
    spatialModel:   eng.model          ?? null,
    spatialParam:   eng.spatialParam   ?? null,
    rho:            eng.rho            ?? null,
    lambda:         eng.lambda         ?? null,
    weightsSummary: eng.weightsSummary ?? null,
    XtXinv:         eng.XtXinv         ?? null,
    s2:             eng.s2             ?? null,
  };
}

export function wrapResult(type, engineOutput, spec, extras = {}) {
  let r;
  switch (type) {
    case "OLS":    r = wrapLinear("OLS",  engineOutput, spec); break;
    case "WLS":    r = wrapLinear("WLS",  engineOutput, spec); break;
    case "FE":     r = wrapFE(engineOutput, spec); break;
    case "FD":     r = wrapFD(engineOutput, spec); break;
    case "2SLS":   r = wrap2SLS(engineOutput, spec); break;
    case "DiD":    r = wrapDiD(engineOutput, spec); break;
    case "TWFE":   r = wrapTWFE(engineOutput, spec); break;
    case "RDD":    r = wrapRDD(engineOutput, spec, extras.h); break;
    case "SpatialRDD": {
      // Spatial RDD returns the Sharp-RDD shape plus { isSpatialRDD, nTreated,
      // nControl, distCol, treatmentCol, mcCrary }. Re-use wrapRDD then overlay
      // the metadata so the result still satisfies the RDD contract.
      const wrapped = wrapRDD(engineOutput, spec, extras.h ?? engineOutput.h);
      r = {
        ...wrapped,
        type:         "SpatialRDD",
        family:       FAMILY_MAP.SpatialRDD,
        label:        ESTIMATOR_META.SpatialRDD.label,
        color:        ESTIMATOR_META.SpatialRDD.color,
        isSpatialRDD: true,
        nTreated:     engineOutput.nTreated ?? null,
        nControl:     engineOutput.nControl ?? null,
        distCol:      engineOutput.distCol ?? null,
        treatmentCol: engineOutput.treatmentCol ?? null,
        mcCrary:      engineOutput.mcCrary ?? null,
      };
      break;
    }
    case "Logit":  r = wrapBinary("Logit",  engineOutput, spec); break;
    case "Probit": r = wrapBinary("Probit", engineOutput, spec); break;
    case "GMM":      r = wrapGMM(engineOutput, spec); break;
    case "LIML":     r = wrapLIML(engineOutput, spec); break;
    case "IVPoisson": r = wrapIVPoisson(engineOutput, spec); break;
    case "FuzzyRDD":         r = wrapFuzzyRDD(engineOutput, spec); break;
    case "EventStudy":       r = wrapEventStudy(engineOutput, spec); break;
    case "SunAbraham":       r = wrapSunAbraham(engineOutput, spec); break;
    case "LSDV":             r = wrapLSDV(engineOutput, spec); break;
    case "Poisson":          r = wrapPoisson(engineOutput, spec); break;
    case "PoissonFE":        r = wrapPoissonFE(engineOutput, spec); break;
    case "NegBinFE":         r = wrapNegBinFE(engineOutput, spec); break;
    case "SyntheticControl": r = wrapSyntheticControl(engineOutput, spec); break;
    case "CallawayCS":       r = wrapCallawayCS(engineOutput, spec); break;
    case "SpatialRegression": r = wrapSpatialRegression(engineOutput, spec); break;
    default:
      console.warn("[EstimationResult] Unknown type:", type);
      r = { ...base(type, spec) };
  }
  // 2SLS / GMM / LIML / FuzzyRDD second-stage engine output sits at eng.second;
  // pass it to finalize so engine-emitted warnings/vcov/ci95 still get picked up.
  const engForFinalize = engineOutput?.second ?? engineOutput;
  return finalize(r, engForFinalize);
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
