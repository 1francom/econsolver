// ─── ECON STUDIO · src/core/validation/coachingTriggers.js ─────────────────────
// Rule-based coaching signal generator.
// Pure JS — no React, no side effects.
//
// Usage:
//   const signals = generateCoachingSignals(metadataReport, activeResult, modelSpec);
//
// CoachingSignal {
//   id        string
//   severity  "warn" | "info" | "suggest"
//   category  "data" | "spec" | "model" | "robustness"
//   title     string
//   detail    string
//   suggestion string
//   question  string   — auto-submittable to AI coach
// }

// ─── RULE HELPERS ─────────────────────────────────────────────────────────────

let _uid = 0;
function sig(severity, category, title, detail, suggestion, question) {
  return { id: `cs-${++_uid}`, severity, category, title, detail, suggestion, question };
}

// ─── RULES ────────────────────────────────────────────────────────────────────

function rulesData(meta) {
  const signals = [];
  const { columns = [], highCorrelations = [], panelQuality } = meta;

  // High multicollinearity warning
  highCorrelations.forEach(({ a, b, r }) => {
    if (Math.abs(r) >= 0.95) {
      signals.push(sig(
        "warn", "data",
        "Near-perfect collinearity",
        `${a} and ${b} are correlated at r=${r.toFixed(2)}.`,
        `Consider dropping one or constructing a composite variable.`,
        `My dataset has near-perfect collinearity between ${a} and ${b} (r=${r.toFixed(2)}). What are my options?`
      ));
    } else if (Math.abs(r) >= 0.85) {
      signals.push(sig(
        "info", "data",
        "High collinearity detected",
        `${a} and ${b} are correlated at r=${r.toFixed(2)}, which may inflate standard errors.`,
        `Check VIF after estimation and consider regularisation if SEs are large.`,
        `${a} and ${b} are highly correlated (r=${r.toFixed(2)}). How does this affect my estimates?`
      ));
    }
  });

  // Panel balance
  if (panelQuality && !panelQuality.balance) {
    const { tDistribution: t } = panelQuality;
    signals.push(sig(
      "info", "data",
      "Unbalanced panel",
      `Entity observation counts range from ${t.min} to ${t.max} (mean ${t.mean.toFixed(1)}).`,
      `Unbalanced panels are fine for FE/FD but check whether attrition is systematic.`,
      `My panel is unbalanced (T ranges from ${t.min} to ${t.max}). Does this affect my FE estimates?`
    ));
  }

  return signals;
}

function rulesSpec(meta, result, modelSpec) {
  const signals = [];
  if (!modelSpec) return signals;

  const { type, yVar, xVars = [], wVars = [] } = modelSpec;
  const { columns = [], temporal, panelQuality } = meta;
  const allX = [...xVars, ...wVars];

  // Log-transform suggestion for skewed X variables
  allX.forEach(xCol => {
    const colMeta = columns.find(c => c.col === xCol);
    if (!colMeta) return;
    if (colMeta.logFeasible && colMeta.skewness != null && colMeta.skewness > 2) {
      signals.push(sig(
        "suggest", "spec",
        `Log-transform ${xCol}?`,
        `${xCol} is right-skewed (skewness=${colMeta.skewness.toFixed(2)}) and all values are positive.`,
        `Add a log(${xCol}) feature in the Feature tab and re-run.`,
        `Should I log-transform ${xCol}? It has a skewness of ${colMeta.skewness.toFixed(2)}.`
      ));
    }
  });

  // Log-Y suggestion
  const yMeta = columns.find(c => c.col === yVar);
  if (yMeta?.logFeasible && yMeta?.skewness != null && yMeta.skewness > 2
      && type && !["Logit","Probit"].includes(type)) {
    signals.push(sig(
      "suggest", "spec",
      `Log-transform Y (${yVar})?`,
      `${yVar} is right-skewed (skewness=${yMeta.skewness.toFixed(2)}) and strictly positive — a log-level model gives elasticity interpretation.`,
      `Log-transform ${yVar} in the Feature tab and re-run.`,
      `My outcome ${yVar} is heavily right-skewed. What does a log transformation buy me?`
    ));
  }

  // Daily panel + FE → suggest TWFE for day-of-week effects
  if (temporal?.periodicity === "daily" && panelQuality && type === "FE") {
    signals.push(sig(
      "suggest", "spec",
      "Daily data: consider TWFE for time fixed effects",
      `Your data has daily frequency. FE removes entity-fixed effects but not shared day-of-week or seasonal effects.`,
      `Switch to TWFE DiD to absorb both entity and time fixed effects.`,
      `My panel has daily data. Why might TWFE be better than standard FE here?`
    ));
  }

  // Low within-variance warning for FE
  if (panelQuality?.withinShare != null && panelQuality.withinShare < 0.15
      && type === "FE") {
    signals.push(sig(
      "warn", "spec",
      "Low within-entity variance",
      `Only ${(panelQuality.withinShare * 100).toFixed(0)}% of variance is within-entity. FE relies on within-unit variation — your estimates may be imprecise.`,
      `Consider whether a random-effects model or between-effects approach is more appropriate.`,
      `My within-entity variance share is very low (${(panelQuality.withinShare * 100).toFixed(0)}%). Does FE still make sense?`
    ));
  }

  // Missing instruments warning for 2SLS
  if (type === "2SLS" && (!modelSpec.zVars || !modelSpec.zVars.length)) {
    signals.push(sig(
      "warn", "spec",
      "No instruments selected",
      `2SLS requires at least one excluded instrument (Z variable).`,
      `Add instrument(s) in the Z (Instruments) selector.`,
      `What makes a good instrument for my 2SLS model?`
    ));
  }

  return signals;
}

function rulesModel(meta, result) {
  const signals = [];
  if (!result) return signals;

  const { type, resid = [], n = 0 } = result;

  // Residual kurtosis → suggest robust SEs
  if (resid.length >= 30) {
    const m  = resid.reduce((a, b) => a + b, 0) / resid.length;
    const s2 = resid.reduce((a, v) => a + (v - m) ** 2, 0) / resid.length;
    if (s2 > 0) {
      const kurt = resid.reduce((a, v) => a + ((v - m) / Math.sqrt(s2)) ** 4, 0) / resid.length - 3;
      if (kurt > 5) {
        signals.push(sig(
          "warn", "robustness",
          "Heavy-tailed residuals",
          `Residual excess kurtosis = ${kurt.toFixed(1)} — substantially leptokurtic.`,
          `Use heteroskedasticity-robust or cluster-robust SEs. Run the BP/White tests in Diagnostics.`,
          `My residuals have excess kurtosis of ${kurt.toFixed(1)}. What does this imply for my SEs?`
        ));
      }
    }
  }

  // Small sample warning (n < 30)
  if (n > 0 && n < 30) {
    signals.push(sig(
      "warn", "model",
      "Small sample",
      `Only ${n} observations were used in estimation.`,
      `Interpret p-values and standard errors with caution. Bootstrap SEs may be more reliable.`,
      `My regression uses only ${n} observations. What are the key limitations?`
    ));
  }

  // Binary model convergence failure
  if (["Logit","Probit"].includes(type) && result.converged === false) {
    signals.push(sig(
      "warn", "model",
      "MLE did not converge",
      `The ${type} model failed to converge after ${result.iterations ?? "?"} iterations.`,
      `Check for perfect separation, drop near-collinear predictors, or reduce the number of variables.`,
      `My ${type} model didn't converge. What are the likely causes?`
    ));
  }

  // 2SLS weak instrument warning
  if (type === "2SLS" && result.firstStages?.length) {
    result.firstStages.forEach(fs => {
      if (fs.Fstat != null && fs.Fstat < 10) {
        signals.push(sig(
          "warn", "robustness",
          `Weak instrument (F=${fs.Fstat.toFixed(1)})`,
          `First-stage F-statistic for ${fs.endogVar ?? "endogenous variable"} is below 10.`,
          `Consider Stock-Yogo critical values. Weak instruments bias 2SLS toward OLS. Try LIML or additional instruments.`,
          `My first-stage F-statistic is ${fs.Fstat.toFixed(1)}. How serious is the weak instrument problem?`
        ));
      }
    });
  }

  return signals;
}

// ─── PUBLIC API ───────────────────────────────────────────────────────────────

/**
 * generateCoachingSignals — produce rule-based coaching signals.
 *
 * @param {MetadataReport} meta        — output of buildMetadataReport()
 * @param {EstimationResult|null} result — current active result (or null before estimation)
 * @param {Object|null} modelSpec      — { type, yVar, xVars, wVars, zVars, ... }
 * @returns {CoachingSignal[]}
 */
export function generateCoachingSignals(meta, result = null, modelSpec = null) {
  if (!meta) return [];

  // Reset uid per call for stable IDs within a render cycle
  _uid = 0;

  return [
    ...rulesData(meta),
    ...rulesSpec(meta, result, modelSpec),
    ...rulesModel(meta, result),
  ];
}
