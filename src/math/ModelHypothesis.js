import { pnorm, pt } from "./calcEngine.js";

function finiteNumber(v) {
  return typeof v === "number" && isFinite(v);
}

function cdf(stat, statLabel, df) {
  if ((statLabel ?? "t").toLowerCase() === "z") return pnorm(stat);
  return pt(stat, df);
}

function cleanId(s, fallback) {
  return String(s ?? fallback).replace(/[^a-zA-Z0-9_]+/g, "_");
}

function unique(xs) {
  return [...new Set(xs.filter(Boolean).map(String))];
}

function jsString(s) {
  return JSON.stringify(String(s ?? ""));
}

function numberLiteral(v, fallback = "NaN") {
  const n = Number(v);
  return finiteNumber(n) ? String(n) : fallback;
}

function qStata(s) {
  return String(s ?? "").replace(/"/g, "'");
}

function modelType(meta) {
  return String(meta.modelType ?? meta.type ?? "");
}

function isRddType(type) {
  return ["RDD", "FuzzyRDD", "SpatialRDD"].includes(type);
}

function looksLikeRddEffect(term, meta) {
  const label = String(term?.label ?? meta.termLabel ?? "");
  return isRddType(modelType(meta)) && /late|treatment|above|jump/i.test(label);
}

function isTreatmentEffect(term, meta) {
  return term?.source === "treatment_effect" || looksLikeRddEffect(term, meta);
}

function rTermCandidates(term, meta) {
  const type = modelType(meta);
  const spec = meta.spec ?? {};
  const label = term?.label ?? meta.termLabel ?? "";
  const xs = [];
  if (term?.source === "treatment_effect" || looksLikeRddEffect(term, meta)) {
    if (type === "DiD" && spec.postVar && spec.treatVar) {
      xs.push(`${spec.postVar}:${spec.treatVar}`, `${spec.treatVar}:${spec.postVar}`);
    } else if (type === "TWFE" && spec.treatVar) {
      xs.push(spec.treatVar);
    } else if (type === "FuzzyRDD" && spec.treatVar) {
      xs.push(spec.treatVar);
    }
  }
  xs.push(label);
  return unique(xs);
}

function pythonTermCandidates(term, meta) {
  const type = modelType(meta);
  const spec = meta.spec ?? {};
  const label = term?.label ?? meta.termLabel ?? "";
  const xs = [];
  if (label === "(Intercept)") xs.push("Intercept", "const", "(Intercept)");
  if (term?.source === "treatment_effect" || looksLikeRddEffect(term, meta)) {
    if (type === "DiD") xs.push("did");
    if (type === "TWFE" && spec.treatVar) xs.push(spec.treatVar);
    if (type === "RDD") xs.push("above");
    if (type === "SpatialRDD") xs.push("_above");
    if (type === "FuzzyRDD") xs.push("_D_hat", spec.treatVar);
  }
  xs.push(label);
  return unique(xs);
}

function stataTermCandidates(term, meta) {
  const type = modelType(meta);
  const spec = meta.spec ?? {};
  const label = term?.label ?? meta.termLabel ?? "";
  const xs = [];
  if (label === "(Intercept)" || label === "Intercept") xs.push("_cons");
  if (term?.source === "treatment_effect" || looksLikeRddEffect(term, meta)) {
    if (type === "DiD") xs.push("did");
    if (type === "TWFE" && spec.treatVar) xs.push(spec.treatVar);
    if (type === "RDD" || type === "SpatialRDD") xs.push("_above");
    if (type === "FuzzyRDD") xs.push(spec.treatVar ?? "D");
  }
  xs.push(label);
  return unique(xs).filter(s => s === "_cons" || /^[A-Za-z_][A-Za-z0-9_]*$/.test(s));
}

export function getModelTestTerms(model) {
  if (!model) return [];
  const terms = [];
  const names = model.varNames ?? [];
  const beta = model.beta ?? [];
  const se = model.se ?? [];
  for (let i = 0; i < Math.max(names.length, beta.length, se.length); i++) {
    if (!finiteNumber(beta[i]) || !finiteNumber(se[i]) || se[i] <= 0) continue;
    terms.push({
      id: `coef:${i}`,
      label: names[i] ?? `coef_${i + 1}`,
      estimate: beta[i],
      se: se[i],
      df: model.df,
      statLabel: model.testStatLabel ?? "t",
      source: "coefficient",
    });
  }
  if (finiteNumber(model.late) && finiteNumber(model.lateSE) && model.lateSE > 0) {
    terms.push({
      id: "effect:late",
      label: model.type === "SpatialRDD" ? "Spatial RD LATE" : "RDD LATE",
      estimate: model.late,
      se: model.lateSE,
      df: model.df,
      statLabel: "t",
      source: "treatment_effect",
    });
  }
  if (finiteNumber(model.att) && finiteNumber(model.attSE) && model.attSE > 0) {
    terms.push({
      id: "effect:att",
      label: "ATT",
      estimate: model.att,
      se: model.attSE,
      df: model.df,
      statLabel: "t",
      source: "treatment_effect",
    });
  }
  return terms;
}

export function coefficientHypothesisTest(term, nullValue = 0, alternative = "two-sided") {
  if (!term) return { error: "Pick a coefficient or effect." };
  const estimate = Number(term.estimate);
  const se = Number(term.se);
  const h0 = Number(nullValue);
  const df = Number(term.df);
  const statLabel = (term.statLabel ?? "t").toLowerCase() === "z" ? "z" : "t";
  if (!finiteNumber(estimate) || !finiteNumber(se) || se <= 0) return { error: "Estimate and SE must be finite, with SE > 0." };
  if (!finiteNumber(h0)) return { error: "Null value must be finite." };
  if (statLabel === "t" && (!finiteNumber(df) || df <= 0)) return { error: "t tests require positive residual degrees of freedom." };

  const stat = (estimate - h0) / se;
  const F = cdf(stat, statLabel, df);
  let pValue;
  if (alternative === "less") pValue = F;
  else if (alternative === "greater") pValue = 1 - F;
  else pValue = 2 * Math.min(F, 1 - F);

  return {
    label: term.label,
    estimate,
    se,
    nullValue: h0,
    stat,
    statLabel,
    df: statLabel === "t" ? df : null,
    alternative,
    pValue: Math.max(0, Math.min(1, pValue)),
  };
}

export function generateModelHypothesisScript(language, test, meta = {}) {
  const modelLabel = meta.modelLabel ?? "model";
  const term = meta.term ?? {};
  const termLabel = meta.termLabel ?? term.label ?? test?.label ?? "coefficient";
  const statName = test?.statLabel === "z" ? "z" : "t";
  const alt = test?.alternative ?? "two-sided";
  const df = Number(test?.df);
  const hasDf = test?.statLabel !== "z" && isFinite(df) && df > 0;
  const id = cleanId(`${modelLabel}_${termLabel}`, "model_test").slice(0, 12) || "model_test";
  const fallbackEstimate = numberLiteral(test?.estimate, "NA_real_");
  const fallbackSe = numberLiteral(test?.se, "NA_real_");
  const nullValue = numberLiteral(test?.nullValue, "0");
  const rddExtractor = isTreatmentEffect(term, meta) && isRddType(modelType(meta));

  if (language === "r") {
    const statVar = `litux_${statName}`;
    const pExpr = hasDf
      ? alt === "less"
        ? `stats::pt(${statVar}, df = litux_df)`
        : alt === "greater"
          ? `1 - stats::pt(${statVar}, df = litux_df)`
          : `2 * stats::pt(-abs(${statVar}), df = litux_df)`
      : alt === "less"
        ? `stats::pnorm(${statVar})`
        : alt === "greater"
          ? `1 - stats::pnorm(${statVar})`
          : `2 * stats::pnorm(-abs(${statVar}))`;
    const lines = [
      "",
      `# Custom null-value test for ${modelLabel}: ${termLabel}`,
      `litux_term <- ${jsString(termLabel)}`,
      `litux_terms <- c(${rTermCandidates(term, meta).map(jsString).join(", ") || jsString(termLabel)})`,
      `litux_estimate <- ${fallbackEstimate}`,
      `litux_se <- ${fallbackSe}`,
      `litux_null <- ${nullValue}`,
    ];

    if (rddExtractor) {
      lines.push(
        `if (exists("fit", inherits = TRUE) && !is.null(fit$coef) && !is.null(fit$se)) {`,
        `  litux_estimate <- as.numeric(fit$coef)[1]`,
        `  litux_se_vec <- as.numeric(fit$se)`,
        `  litux_se <- litux_se_vec[ifelse(length(litux_se_vec) >= 3, 3, 1)]`,
        `}`
      );
    } else {
      lines.push(
        `litux_fit <- NULL`,
        `for (litux_nm in c("fit", "fit_fe", "fit_fd")) {`,
        `  if (exists(litux_nm, inherits = TRUE)) { litux_fit <- get(litux_nm, inherits = TRUE); break }`,
        `}`,
        `if (!is.null(litux_fit)) {`,
        `  litux_coef <- tryCatch(stats::coef(litux_fit), error = function(e) NULL)`,
        `  litux_vcov <- tryCatch(stats::vcov(litux_fit), error = function(e) NULL)`,
        `  if (!is.null(litux_coef)) {`,
        `    for (litux_candidate in litux_terms) {`,
        `      if (litux_candidate %in% names(litux_coef)) {`,
        `        litux_term <- litux_candidate`,
        `        litux_estimate <- unname(litux_coef[[litux_candidate]])`,
        `        if (!is.null(litux_vcov) && litux_candidate %in% rownames(litux_vcov)) {`,
        `          litux_se <- sqrt(diag(litux_vcov))[litux_candidate]`,
        `        }`,
        `        break`,
        `      }`,
        `    }`,
        `  }`,
        `}`
      );
    }

    if (hasDf) {
      lines.push(
        `litux_df <- ${numberLiteral(df, "NA_real_")}`,
        `if (exists("litux_fit") && !is.null(litux_fit)) {`,
        `  litux_df_fit <- tryCatch(stats::df.residual(litux_fit), error = function(e) NA_real_)`,
        `  if (is.finite(litux_df_fit) && litux_df_fit > 0) litux_df <- litux_df_fit`,
        `}`
      );
    }

    lines.push(
      `${statVar} <- (litux_estimate - litux_null) / litux_se`,
      `litux_p <- ${pExpr}`,
      `data.frame(term = litux_term, estimate = litux_estimate, se = litux_se, null_value = litux_null, statistic = ${statVar}, p_value = litux_p)`
    );
    return lines.join("\n");
  }

  if (language === "python") {
    const pyTerms = JSON.stringify(pythonTermCandidates(term, meta));
    const pLines = hasDf
      ? alt === "less"
        ? ["litux_p = litux_stats.t.cdf(litux_stat, litux_df)"]
        : alt === "greater"
          ? ["litux_p = 1 - litux_stats.t.cdf(litux_stat, litux_df)"]
          : ["litux_p = 2 * litux_stats.t.cdf(-abs(litux_stat), litux_df)"]
      : alt === "less"
        ? ["litux_p = litux_stats.norm.cdf(litux_stat)"]
        : alt === "greater"
          ? ["litux_p = 1 - litux_stats.norm.cdf(litux_stat)"]
          : ["litux_p = 2 * litux_stats.norm.cdf(-abs(litux_stat))"];
    const lines = [
      "",
      `# Custom null-value test for ${modelLabel}: ${termLabel}`,
      `litux_terms = ${pyTerms}`,
      `litux_term = ${jsString(termLabel)}`,
      `litux_estimate = ${numberLiteral(test?.estimate, "float('nan')")}`,
      `litux_se = ${numberLiteral(test?.se, "float('nan')")}`,
      `litux_null = ${nullValue}`,
      `litux_df = ${hasDf ? numberLiteral(df, "None") : "None"}`,
    ];

    if (rddExtractor) {
      lines.push(
        `try:`,
        `    if "rdd" in globals():`,
        `        litux_coef = np.asarray(getattr(rdd, "coef"), dtype=float).ravel()`,
        `        litux_se_vec = np.asarray(getattr(rdd, "se"), dtype=float).ravel()`,
        `        litux_estimate = float(litux_coef[0])`,
        `        litux_se = float(litux_se_vec[2 if len(litux_se_vec) >= 3 else 0])`,
        `    elif "model" in globals() and hasattr(model, "params"):`,
        `        for litux_candidate in litux_terms:`,
        `            if litux_candidate in model.params.index:`,
        `                litux_term = litux_candidate`,
        `                litux_estimate = float(model.params[litux_candidate])`,
        `                litux_se = float(model.bse[litux_candidate])`,
        `                litux_df = getattr(model, "df_resid", litux_df)`,
        `                break`,
        `except Exception:`,
        `    pass`
      );
    } else {
      lines.push(
        `if "model" in globals() and hasattr(model, "params"):`,
        `    for litux_candidate in litux_terms:`,
        `        try:`,
        `            if litux_candidate in model.params.index:`,
        `                litux_term = litux_candidate`,
        `                litux_estimate = float(model.params[litux_candidate])`,
        `                litux_se = float(model.bse[litux_candidate])`,
        `                litux_df = getattr(model, "df_resid", litux_df)`,
        `                break`,
        `        except Exception:`,
        `            pass`
      );
    }

    lines.push(
      `litux_stat = (litux_estimate - litux_null) / litux_se`,
      `from scipy import stats as litux_stats`,
      ...pLines,
      `print({"term": litux_term, "estimate": litux_estimate, "se": litux_se, "null_value": litux_null, "${statName}": litux_stat, "p_value": litux_p})`
    );
    return lines.join("\n");
  }

  if (language === "stata") {
    const statVar = `litux_${statName}_${id}`;
    const terms = stataTermCandidates(term, meta);
    const pExpr = hasDf
      ? alt === "less"
        ? `1 - ttail(litux_df_${id}, ${statVar})`
        : alt === "greater"
          ? `ttail(litux_df_${id}, ${statVar})`
          : `2 * ttail(litux_df_${id}, abs(${statVar}))`
      : alt === "less"
        ? `normal(${statVar})`
        : alt === "greater"
          ? `1 - normal(${statVar})`
          : `2 * normal(-abs(${statVar}))`;
    const lines = [
      "",
      `* Custom null-value test for ${modelLabel}: ${qStata(termLabel)}`,
      `scalar litux_estimate_${id} = ${numberLiteral(test?.estimate, ".")}`,
      `scalar litux_se_${id} = ${numberLiteral(test?.se, ".")}`,
      `scalar litux_null_${id} = ${nullValue}`,
      `local litux_found_${id} = 0`,
    ];

    if (terms.length) {
      lines.push(
        `foreach litux_term_${id} in ${terms.join(" ")} {`,
        `    capture scalar litux_estimate_${id} = _b[\`litux_term_${id}']`,
        `    if !_rc {`,
        `        scalar litux_se_${id} = _se[\`litux_term_${id}']`,
        `        local litux_found_${id} = 1`,
        `        continue, break`,
        `    }`,
        `}`
      );
    }

    if (hasDf) {
      lines.push(
        `capture scalar litux_df_${id} = e(df_r)`,
        `if _rc scalar litux_df_${id} = ${numberLiteral(df, ".")}`,
        `if missing(litux_df_${id}) scalar litux_df_${id} = ${numberLiteral(df, ".")}`
      );
    }

    lines.push(
      `scalar ${statVar} = (litux_estimate_${id} - litux_null_${id}) / litux_se_${id}`,
      `scalar litux_p_${id} = ${pExpr}`,
      `display "term: ${qStata(termLabel)}"`,
      `display "${statName} = " ${statVar} "  p = " litux_p_${id}`
    );
    return lines.join("\n");
  }

  return "";
}
