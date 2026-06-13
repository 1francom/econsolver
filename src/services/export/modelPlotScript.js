// ─── ECON STUDIO · services/export/modelPlotScript.js ───────────────────────
// Track P4 of specs/2026-06-12-replication-fidelity-design.md.
//
// Model plots in the Modeling tab are built on a PlotBuilder whose rows are
// AUGMENTED with model-derived columns (`__resid__`, `__yhat__` — see
// ModelingTab `resultRows`). Those columns do not exist in the raw data; they
// only come into being once the model is estimated. A replication script must
// therefore PREPEND a preamble that re-creates them from the fitted model
// object before the geom code runs.
//
// This module produces ONLY that preamble. The geom body is produced by
// plotScript.js (buildGgplot / buildMatplotlibPlot / buildStataPlot, Track
// P1/P5) over a data frame named `plot_df`. PlotBuilder wires the two together
// via its optional `scriptPreamble` prop (Track P5 seam).
//
// Convention: the preamble references the estimated model object `fit` — the
// same name the deterministic model scripts (rScript.js / pythonScript.js /
// stataScript.js) and the unified script's Estimation section assign. When a
// plot is copied standalone, the leading comment tells the user `fit` must
// already exist (run the model/estimation section first).

// ── Column aliases ───────────────────────────────────────────────────────────
// The PlotBuilder layers reference these literal augmented column names; the
// preamble must materialize exactly these on `plot_df`.
const RESID = "__resid__";
const YHAT  = "__yhat__";

// ─── R ───────────────────────────────────────────────────────────────────────
function rPreamble(result, mode) {
  const type = result?.type ?? "model";
  if (mode === "comparison") {
    return [
      `# ── Model-comparison plot data ─────────────────────────────────────────`,
      `# This plot compares coefficients across the pinned models. Tidy each`,
      `# fitted model and stack them; replace fit1/fit2/... with your model objects.`,
      `library(broom)`,
      `plot_df <- dplyr::bind_rows(`,
      `  lapply(list(fit1 = fit1, fit2 = fit2), function(m)`,
      `    broom::tidy(m, conf.int = TRUE)),`,
      `  .id = "model"`,
      `)`,
    ].join("\n");
  }
  return [
    `# ── Model-derived plot data (${type}) ─────────────────────────────────────`,
    `# Assumes 'fit' is the estimated model from the Estimation section.`,
    `# broom::augment returns the analysis data frame plus .fitted/.resid,`,
    `# guaranteeing row alignment (NA handling matches the fit).`,
    `library(broom)`,
    `plot_df <- tryCatch(`,
    `  broom::augment(fit),`,
    `  error = function(e) {`,
    `    d <- model.frame(fit)`,
    `    d[["${RESID}"]] <- residuals(fit)`,
    `    d[["${YHAT}"]]  <- fitted(fit)`,
    `    d`,
    `  }`,
    `)`,
    `if (!"${RESID}" %in% names(plot_df)) plot_df[["${RESID}"]] <- plot_df$.resid`,
    `if (!"${YHAT}"  %in% names(plot_df)) plot_df[["${YHAT}"]]  <- plot_df$.fitted`,
  ].join("\n");
}

// ─── Python ──────────────────────────────────────────────────────────────────
function pyPreamble(result, mode) {
  const type = result?.type ?? "model";
  if (mode === "comparison") {
    return [
      `# ── Model-comparison plot data ─────────────────────────────────────────`,
      `# Stack the coefficient tables of the pinned models; replace fit1/fit2/...`,
      `import pandas as pd`,
      `def _tidy(m, name):`,
      `    out = pd.DataFrame({"term": m.params.index, "estimate": m.params.values,`,
      `                        "std_error": m.bse.values, "p_value": m.pvalues.values})`,
      `    out["model"] = name`,
      `    return out`,
      `plot_df = pd.concat([_tidy(fit1, "fit1"), _tidy(fit2, "fit2")], ignore_index=True)`,
    ].join("\n");
  }
  return [
    `# ── Model-derived plot data (${type}) ─────────────────────────────────────`,
    `# Assumes 'fit' is the estimated statsmodels results from the Estimation section.`,
    `import pandas as pd`,
    `plot_df = fit.model.data.frame.copy() if hasattr(fit.model.data, "frame") else pd.DataFrame()`,
    `plot_df["${RESID}"] = fit.resid`,
    `plot_df["${YHAT}"]  = fit.fittedvalues`,
  ].join("\n");
}

// ─── Stata ─────────────────────────────────────────────────────────────────-─
function stataPreamble(result, mode) {
  const type = result?.type ?? "model";
  if (mode === "comparison") {
    return [
      `* ── Model-comparison plot data ─────────────────────────────────────────`,
      `* Use 'coefplot' (ssc install coefplot) on the stored estimates, or build`,
      `* a coefficient dataset with 'estout'/'parmest' from your stored models.`,
      `* coefplot model1 model2`,
    ].join("\n");
  }
  return [
    `* ── Model-derived plot data (${type}) ─────────────────────────────────────`,
    `* Run immediately AFTER the estimation command (the model must be active).`,
    `predict ${YHAT}, xb`,
    `predict ${RESID}, residuals`,
  ].join("\n");
}

// ─── Public API ──────────────────────────────────────────────────────────────
/**
 * Build the model-derived data preamble for a plot.
 * @param {object} result   - the active EstimationResult (uses .type for the comment)
 * @param {"r"|"python"|"stata"} language
 * @param {{ mode?: "result"|"comparison" }} opts
 * @returns {string} preamble code (ends WITHOUT a trailing newline)
 */
export function buildModelPlotPreamble(result, language, { mode = "result" } = {}) {
  const lang = String(language ?? "r").toLowerCase();
  if (lang === "python") return pyPreamble(result, mode);
  if (lang === "stata")  return stataPreamble(result, mode);
  return rPreamble(result, mode);
}
