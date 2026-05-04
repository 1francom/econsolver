// ─── LITUX · services/export/rScript.js ────────────────────────────────
// Transpiler: Litux pipeline + model config → R script
//
// Target packages:
//   Data:      haven, readr, dplyr, tidyr, stringr, lubridate
//   Models:    fixest  (OLS, FE, FD, 2SLS, TWFE, DiD)
//              rdrobust (RDD)
//   Output:    modelsummary, stargazer (optional)
//
// Exports:
//   generateRScript(config) → string
//
// config shape:
//   {
//     filename        string              — original data filename
//     pipeline        Step[]              — serialised pipeline steps
//     model: {
//       type          string              — "OLS"|"FE"|"FD"|"2SLS"|"DiD"|"TWFE"|"RDD"
//       yVar          string
//       xVars         string[]            — regressors / endogenous vars
//       wVars         string[]            — controls
//       zVars         string[]            — instruments (2SLS only)
//       postVar       string              — DiD post indicator
//       treatVar      string              — DiD/TWFE treatment indicator
//       runningVar    string              — RDD running variable
//       cutoff        number              — RDD cutoff
//       bandwidth     number              — RDD bandwidth
//       kernel        string              — RDD kernel type
//       entityCol     string              — panel entity column
//       timeCol       string              — panel time column
//     }
//     auditTrail      AuditTrail | null   — from auditor.js (optional)
//     dataDictionary  Record<string,string> | null
//   }

import { auditTrailToMarkdown } from "../../pipeline/auditor.js";
import { stepLabel } from "../../pipeline/registry.js";

// ─── HELPERS ──────────────────────────────────────────────────────────────────

// Safe R variable name: replace spaces and special chars with underscores
function rName(s) {
  return String(s ?? "").replace(/[^a-zA-Z0-9_.]/g, "_").replace(/^([0-9])/, "_$1");
}

// Quote a string for R
function rStr(s) {
  return `"${String(s ?? "").replace(/\\/g, "\\\\").replace(/"/g, '\\"')}"`;
}

// Format a numeric vector for R: c(1, 2, 3)
function rVec(arr) {
  if (!arr?.length) return "character(0)";
  return `c(${arr.map(v => typeof v === "number" ? v : rStr(v)).join(", ")})`;
}

// Wrap a single value or vector in c() as needed
function rCols(arr) {
  if (!arr?.length) return "character(0)";
  if (arr.length === 1) return rStr(arr[0]);
  return rVec(arr);
}

// ─── PIPELINE TRANSPILER ──────────────────────────────────────────────────────
// Each step type maps to one or more dplyr/tidyr/stringr/lubridate calls.
function transpileStep(step, dfVar = "df") {
  const col  = step.col  ? rName(step.col)  : null;
  const nn   = step.nn   ? rName(step.nn)   : null;
  const quot = step.col  ? rStr(step.col)   : null;

  switch (step.type) {

    case "rename":
      return `${dfVar} <- ${dfVar} |> rename(${rName(step.newName)} = ${rName(step.col)})`;

    case "drop":
      return `${dfVar} <- ${dfVar} |> select(-${rName(step.col)})`;

    case "filter": {
      const opMap = {
        notna: `!is.na(${col})`,
        eq:    `${col} == ${rStr(step.value)}`,
        neq:   `${col} != ${rStr(step.value)}`,
        gt:    `${col} > ${step.value}`,
        lt:    `${col} < ${step.value}`,
        gte:   `${col} >= ${step.value}`,
        lte:   `${col} <= ${step.value}`,
      };
      return `${dfVar} <- ${dfVar} |> filter(${opMap[step.op] ?? "TRUE"})`;
    }

    case "drop_na": {
      const cols = step.cols?.length
        ? step.cols.map(c => rName(c)).join(", ")
        : "everything()";
      return step.how === "all"
        ? `${dfVar} <- ${dfVar} |> filter(!if_all(c(${cols}), is.na))`
        : `${dfVar} <- ${dfVar} |> drop_na(${cols})`;
    }

    case "fill_na": {
      const stratMap = {
        mean:          `mean(${col}, na.rm = TRUE)`,
        median:        `median(${col}, na.rm = TRUE)`,
        mode:          `names(sort(table(${col}), decreasing = TRUE))[1]`,
        constant:      rStr(step.value ?? ""),
        forward_fill:  null,  // handled below
        backward_fill: null,
      };
      if (step.strategy === "forward_fill")
        return `${dfVar} <- ${dfVar} |> fill(${col}, .direction = "down")`;
      if (step.strategy === "backward_fill")
        return `${dfVar} <- ${dfVar} |> fill(${col}, .direction = "up")`;
      return `${dfVar} <- ${dfVar} |> mutate(${col} = ifelse(is.na(${col}), ${stratMap[step.strategy] ?? `mean(${col}, na.rm = TRUE)`}, ${col}))`;
    }

    case "type_cast": {
      const castMap = { number: "as.numeric", string: "as.character", boolean: "as.integer" };
      return `${dfVar} <- ${dfVar} |> mutate(${col} = ${castMap[step.to] ?? "as.numeric"}(${col}))`;
    }

    case "quickclean": {
      const fnMap = { lower: "tolower", upper: "toupper",
                      title: "stringr::str_to_title" };
      return `${dfVar} <- ${dfVar} |> mutate(${col} = ${fnMap[step.mode] ?? "tolower"}(${col}))`;
    }

    case "recode": {
      const map = step.map ?? {};
      const cases = Object.entries(map)
        .map(([k, v]) => `  ${rStr(k)} ~ ${typeof v === "number" ? v : rStr(v)}`)
        .join(",\n");
      return `${dfVar} <- ${dfVar} |> mutate(${col} = dplyr::case_match(${col},\n${cases},\n  .default = ${col}\n))`;
    }

    case "normalize_cats": {
      const map = step.map ?? {};
      const cases = Object.entries(map)
        .map(([k, v]) => `  ${rStr(k)} ~ ${rStr(v)}`)
        .join(",\n");
      return `${dfVar} <- ${dfVar} |> mutate(${col} = dplyr::case_match(${col},\n${cases},\n  .default = ${col}\n))`;
    }

    case "winz": {
      const lo = Number(step.lo).toFixed(6), hi = Number(step.hi).toFixed(6);
      const out = nn && nn !== col ? nn : col;
      return `${dfVar} <- ${dfVar} |> mutate(${out} = pmin(pmax(${col}, ${lo}), ${hi}))`;
    }

    case "log":
      return `${dfVar} <- ${dfVar} |> mutate(${nn} = log(${col}))`;

    case "sq":
      return `${dfVar} <- ${dfVar} |> mutate(${nn} = ${col}^2)`;

    case "std": {
      const mu = Number(step.mu).toFixed(6), sd = Number(step.sd).toFixed(6);
      return `${dfVar} <- ${dfVar} |> mutate(${nn} = (${col} - ${mu}) / ${sd})`;
    }

    case "dummy":
      return [
        `# One-hot encode ${step.col} with prefix "${step.pfx}"`,
        `${dfVar} <- ${dfVar} |> fastDummies::dummy_cols(select_columns = ${rStr(step.col)}, remove_first_dummy = FALSE, remove_selected_columns = FALSE)`,
        `# Rename generated columns to prefix "${step.pfx}_*" if needed`,
      ].join("\n");

    case "lag": {
      const ec = step.ec ? rName(step.ec) : null;
      const tc = step.tc ? rName(step.tc) : null;
      const n  = step.n ?? 1;
      if (ec && tc) {
        return [
          `${dfVar} <- ${dfVar} |>`,
          `  arrange(${ec}, ${tc}) |>`,
          `  group_by(${ec}) |>`,
          `  mutate(${nn} = dplyr::lag(${col}, n = ${n})) |>`,
          `  ungroup()`,
        ].join("\n");
      }
      return `${dfVar} <- ${dfVar} |> mutate(${nn} = dplyr::lag(${col}, n = ${n}))`;
    }

    case "lead": {
      const ec = step.ec ? rName(step.ec) : null;
      const tc = step.tc ? rName(step.tc) : null;
      const n  = step.n ?? 1;
      if (ec && tc) {
        return [
          `${dfVar} <- ${dfVar} |>`,
          `  arrange(${ec}, ${tc}) |>`,
          `  group_by(${ec}) |>`,
          `  mutate(${nn} = dplyr::lead(${col}, n = ${n})) |>`,
          `  ungroup()`,
        ].join("\n");
      }
      return `${dfVar} <- ${dfVar} |> mutate(${nn} = dplyr::lead(${col}, n = ${n}))`;
    }

    case "diff": {
      const ec = step.ec ? rName(step.ec) : null;
      const tc = step.tc ? rName(step.tc) : null;
      if (ec && tc) {
        return [
          `${dfVar} <- ${dfVar} |>`,
          `  arrange(${ec}, ${tc}) |>`,
          `  group_by(${ec}) |>`,
          `  mutate(${nn} = ${col} - dplyr::lag(${col}, n = 1)) |>`,
          `  ungroup()`,
        ].join("\n");
      }
      return `${dfVar} <- ${dfVar} |> mutate(${nn} = ${col} - dplyr::lag(${col}, n = 1))`;
    }

    case "ix":
      return `${dfVar} <- ${dfVar} |> mutate(${nn} = ${rName(step.c1)} * ${rName(step.c2)})`;

    case "did":
      return `${dfVar} <- ${dfVar} |> mutate(${nn} = ${rName(step.tc)} * ${rName(step.pc)})`;

    case "date_extract": {
      const parts = step.parts ?? [];
      const lines = parts.map(p => {
        const out = rName(step.names?.[p] ?? `${step.col}_${p}`);
        if (p === "year")      return `  ${out} = lubridate::year(${col})`;
        if (p === "month")     return `  ${out} = lubridate::month(${col})`;
        if (p === "dow")       return `  ${out} = lubridate::wday(${col}) - 1`;  // 0=Sun like JS
        if (p === "isweekend") return `  ${out} = as.integer(lubridate::wday(${col}) %in% c(1, 7))`;
        return null;
      }).filter(Boolean);
      return lines.length
        ? `${dfVar} <- ${dfVar} |> mutate(\n${lines.join(",\n")}\n)`
        : `# date_extract: no parts specified`;
    }

    case "mutate":
      // Best-effort: translate common helpers to R equivalents
      return [
        `# mutate: ${step.nn} = ${step.expr}`,
        `# NOTE: expression uses JS syntax — translate to R manually if needed`,
        `# ${dfVar} <- ${dfVar} |> mutate(${nn} = <R expression>)`,
      ].join("\n");

    case "ai_tr":
      return [
        `# ai_tr on "${step.col}" — AI-generated transformation`,
        `# JS: ${step.js}`,
        `# Translate to R manually`,
      ].join("\n");

    case "arrange": {
      const dir = step.dir === "desc" ? `desc(${rName(step.col)})` : rName(step.col);
      return `${dfVar} <- ${dfVar} |> arrange(${dir})`;
    }

    case "group_summarize": {
      const by   = (step.by ?? []).map(rName).join(", ");
      const aggs = (step.aggs ?? []).map(a => {
        const fnMap = { mean: "mean", sum: "sum", count: "n",
                        min: "min", max: "max", sd: "sd", median: "median" };
        const fn = fnMap[a.fn] ?? a.fn;
        return a.fn === "count"
          ? `    ${rName(a.nn)} = n()`
          : `    ${rName(a.nn)} = ${fn}(${rName(a.col)}, na.rm = TRUE)`;
      }).join(",\n");
      return [
        `${dfVar} <- ${dfVar} |>`,
        `  group_by(${by}) |>`,
        `  summarise(\n${aggs},\n    .groups = "drop"\n  )`,
      ].join("\n");
    }

    case "join": {
      const how = step.how === "inner" ? "inner_join" : "left_join";
      return [
        `# Load right dataset before joining`,
        `right_df <- readr::read_csv(<path_to_${rName(step.rightId)}>)`,
        `${dfVar} <- ${how}(${dfVar}, right_df, by = c(${rStr(step.leftKey)} = ${rStr(step.rightKey)}), suffix = c("", ${rStr(step.suffix ?? "_r")}))`,
      ].join("\n");
    }

    case "append":
      return [
        `right_df <- readr::read_csv(<path_to_${rName(step.rightId)}>)`,
        `${dfVar} <- dplyr::bind_rows(${dfVar}, right_df)`,
      ].join("\n");

    default:
      return `# [unknown step: ${step.type}] ${stepLabel(step)}`;
  }
}

// ─── MODEL TRANSPILER ─────────────────────────────────────────────────────────
function transpileModel(model) {
  const {
    type, yVar, xVars = [], wVars = [],
    zVars = [], postVar, treatVar,
    runningVar, cutoff, bandwidth, kernel = "triangular",
    entityCol, timeCol,
  } = model;

  const y       = rName(yVar);
  const allX    = [...xVars, ...wVars].map(rName);
  const xStr    = allX.join(" + ") || "1";

  switch (type) {

    case "OLS":
      return [
        `# ── OLS ──────────────────────────────────────────────────────────────`,
        `fit <- fixest::feols(${y} ~ ${xStr}, data = df, vcov = "HC1")`,
        ``,
        `# Diagnostics`,
        `fixest::etable(fit)`,
        `lmtest::bptest(lm(${y} ~ ${xStr}, data = df))  # Breusch-Pagan`,
        `car::vif(lm(${y} ~ ${xStr}, data = df))         # VIF`,
      ].join("\n");

    case "FE":
      return [
        `# ── Fixed Effects (within estimator) ────────────────────────────────`,
        `fit_fe <- fixest::feols(${y} ~ ${xStr} | ${rName(entityCol)}, data = df, vcov = ~${rName(entityCol)})`,
        `fit_fd <- plm::plm(${y} ~ ${xStr}, data = df,`,
        `  index = c(${rStr(entityCol)}, ${rStr(timeCol)}),`,
        `  model = "fd")`,
        ``,
        `fixest::etable(fit_fe)`,
        ``,
        `# Hausman test (FE vs RE)`,
        `fit_re <- plm::plm(${y} ~ ${xStr}, data = df,`,
        `  index = c(${rStr(entityCol)}, ${rStr(timeCol)}),`,
        `  model = "random")`,
        `plm::phtest(fit_fe |> plm::as.plm(), fit_re)`,
      ].join("\n");

    case "FD":
      return [
        `# ── First Differences ────────────────────────────────────────────────`,
        `fit_fd <- plm::plm(${y} ~ ${xStr}, data = df,`,
        `  index = c(${rStr(entityCol)}, ${rStr(timeCol)}),`,
        `  model = "fd")`,
        ``,
        `summary(fit_fd)`,
      ].join("\n");

    case "2SLS": {
      const endog  = xVars.map(rName).join(" + ") || "endog_var";
      const ctrls  = wVars.map(rName).join(" + ");
      const instrs = zVars.map(rName).join(" + ") || "instrument";
      const rhs    = ctrls ? `${endog} + ${ctrls}` : endog;
      const iv_rhs = ctrls ? `${instrs} + ${ctrls}` : instrs;
      return [
        `# ── 2SLS / IV ────────────────────────────────────────────────────────`,
        `fit <- fixest::feols(${y} ~ ${ctrls ? ctrls + " | " : "| "}${endog} ~ ${iv_rhs}, data = df, vcov = "HC1")`,
        ``,
        `# First-stage diagnostics`,
        `fixest::fitstat(fit, ~ ivwald)   # Wald F for instrument strength`,
        `fixest::etable(fit)`,
      ].join("\n");
    }

    case "DiD": {
      const post  = rName(postVar);
      const treat = rName(treatVar);
      const ctrls = wVars.map(rName).join(" + ");
      const rhs   = ctrls ? `${post} * ${treat} + ${ctrls}` : `${post} * ${treat}`;
      return [
        `# ── 2×2 Difference-in-Differences ───────────────────────────────────`,
        `# DiD interaction term: post × treat`,
        `fit <- fixest::feols(${y} ~ ${rhs}, data = df, vcov = "HC1")`,
        ``,
        `fixest::etable(fit)`,
        ``,
        `# ATT is the coefficient on the interaction term`,
        `cat("ATT:", coef(fit)[paste0("${post}:${treat}")], "\\n")`,
      ].join("\n");
    }

    case "TWFE": {
      const treat = rName(treatVar);
      const ec    = rName(entityCol);
      const tc    = rName(timeCol);
      const ctrls = wVars.length ? " + " + wVars.map(rName).join(" + ") : "";
      return [
        `# ── Two-Way Fixed Effects DiD ────────────────────────────────────────`,
        `fit <- fixest::feols(${y} ~ ${treat}${ctrls} | ${ec} + ${tc},`,
        `  data = df, vcov = ~${ec})`,
        ``,
        `fixest::etable(fit)`,
        ``,
        `# Staggered DiD: consider using did::att_gt() for heterogeneous treatment timing`,
      ].join("\n");
    }

    case "RDD": {
      const rv    = rName(runningVar);
      const c0    = Number(cutoff).toFixed(6);
      const h     = bandwidth ? Number(bandwidth).toFixed(6) : null;
      const kernR = kernel === "triangular" ? "triangular"
                  : kernel === "epanechnikov" ? "epanechnikov"
                  : "uniform";
      return [
        `# ── Sharp RDD ────────────────────────────────────────────────────────`,
        `# Centre running variable at cutoff`,
        `df <- df |> mutate(${rv}_c = ${rv} - ${c0})`,
        ``,
        h
          ? `fit <- rdrobust::rdrobust(y = df$${y}, x = df$${rv}, c = ${c0}, h = ${h}, kernel = ${rStr(kernR)})`
          : `fit <- rdrobust::rdrobust(y = df$${y}, x = df$${rv}, c = ${c0}, kernel = ${rStr(kernR)})`,
        ``,
        `summary(fit)`,
        `rdrobust::rdplot(y = df$${y}, x = df$${rv}, c = ${c0})`,
      ].join("\n");
    }

    case "Logit":
    case "Probit": {
      const link   = type === "Logit" ? "logit" : "probit";
      const ctrls  = wVars.map(rName).join(" + ");
      const regs   = xVars.map(rName).join(" + ");
      const rhs    = [regs, ctrls].filter(Boolean).join(" + ") || "1";
      return [
        `# ── ${type} (MLE via glm) ───────────────────────────────────────────`,
        `fit <- glm(${y} ~ ${rhs},`,
        `  data   = df,`,
        `  family = binomial(link = "${link}"))`,
        ``,
        `summary(fit)`,
        ``,
        `# Marginal effects at the mean (MEM)`,
        `marginaleffects::avg_slopes(fit)`,
        ``,
        `# Odds ratios with 95% CI${type === "Probit" ? " (not meaningful for Probit — skip)" : ""}`,
        ...(type === "Logit" ? [
          `exp(cbind(OR = coef(fit), confint(fit)))`,
        ] : [
          `# exp(cbind(OR = coef(fit), confint(fit)))  # skipped for Probit`,
        ]),
        ``,
        `# ROC curve and AUC`,
        `pROC::roc(df$${y}, fitted(fit), plot = TRUE, print.auc = TRUE)`,
        ``,
        `# Likelihood-ratio test vs null model`,
        `lmtest::lrtest(fit)`,
        ``,
        `# McFadden pseudo-R²`,
        `cat("McFadden R2:", 1 - (fit$deviance / fit$null.deviance), "\\n")`,
        `cat("AIC:", AIC(fit), "\\n")`,
        `cat("BIC:", BIC(fit), "\\n")`,
      ].join("\n");
    }

    default:
      return `# Unknown model type: ${type}`;
  }
}

// ─── MAIN EXPORT ─────────────────────────────────────────────────────────────
export function generateRScript(config) {
  const {
    filename     = "dataset.csv",
    pipeline     = [],
    model        = {},
    auditTrail   = null,
    dataDictionary = null,
  } = config;

  const baseName = filename.replace(/\.[^.]+$/, "");
  const ts       = new Date().toISOString().slice(0, 10);
  const pkgs     = buildPackageList(model.type, pipeline);

  const lines = [];

  // ── Header ──────────────────────────────────────────────────────────────────
  lines.push(
    `# ════════════════════════════════════════════════════════════════════════`,
    `# Replication script — generated by Litux`,
    `# Dataset:  ${filename}`,
    `# Model:    ${model.type ?? "unknown"}`,
    `# Generated: ${ts}`,
    `# `,
    `# This script replicates the full analysis pipeline and estimation.`,
    `# Review all steps before submission — AI-generated transformations`,
    `# and 'mutate' expressions require manual verification.`,
    `# ════════════════════════════════════════════════════════════════════════`,
    ``
  );

  // ── Package installation guard ───────────────────────────────────────────────
  lines.push(
    `# ── 0. Packages ──────────────────────────────────────────────────────────`,
    `# Install if missing:`,
    `# install.packages(c(${pkgs.map(rStr).join(", ")}))`,
    ``
  );
  pkgs.forEach(p => lines.push(`library(${p})`));
  lines.push(``);

  // ── Data loading ─────────────────────────────────────────────────────────────
  const ext = filename.split(".").pop()?.toLowerCase();
  lines.push(`# ── 1. Load data ─────────────────────────────────────────────────────────`);
  if (ext === "csv") {
    lines.push(`df <- readr::read_csv(${rStr(filename)})`);
  } else if (["xlsx", "xls"].includes(ext)) {
    lines.push(`df <- readxl::read_excel(${rStr(filename)})`);
  } else if (ext === "dta") {
    lines.push(`df <- haven::read_dta(${rStr(filename)})`);
  } else {
    lines.push(`df <- readr::read_csv(${rStr(filename)})  # adjust for your format`);
  }
  lines.push(``);

  // ── Data dictionary comment ───────────────────────────────────────────────────
  if (dataDictionary && Object.keys(dataDictionary).length) {
    lines.push(`# ── 2. Variable definitions ──────────────────────────────────────────────`);
    Object.entries(dataDictionary).forEach(([k, v]) => {
      lines.push(`# ${rName(k).padEnd(20)} ${v}`);
    });
    lines.push(``);
  }

  // ── Pipeline ──────────────────────────────────────────────────────────────────
  if (pipeline.length) {
    lines.push(`# ── 3. Data preparation pipeline ────────────────────────────────────────`);
    lines.push(`# ${pipeline.length} step${pipeline.length !== 1 ? "s" : ""} applied in Litux`);
    lines.push(``);

    pipeline.forEach((step, i) => {
      const label   = stepLabel(step);
      const comment = auditTrail?.entries?.[i]?.decision;
      lines.push(`# Step ${i + 1}: ${label}`);
      if (comment) lines.push(`# ${comment}`);
      lines.push(transpileStep(step));
      lines.push(``);
    });
  }

  // ── Estimation ────────────────────────────────────────────────────────────────
  lines.push(`# ── 4. Estimation ───────────────────────────────────────────────────────`);
  lines.push(transpileModel(model));
  lines.push(``);

  // ── Output table ─────────────────────────────────────────────────────────────
  lines.push(`# ── 5. Output table ─────────────────────────────────────────────────────`);

  if (model.type === "RDD") {
    // rdrobust objects are not supported by modelsummary/broom — use summary() directly
    lines.push(
      `# rdrobust does not support modelsummary — use summary() output instead`,
      `summary(fit)`,
      ``,
      `# Extract point estimate and SE manually if needed:`,
      `cat("LATE:", fit$coef[1], "\n")`,
      `cat("SE:  ", fit$se[3],   "\n")  # robust SE (col 3 = HC3)`,
      `cat("p:   ", fit$pv[3],   "\n")`,
      ``
    );
  } else if (model.type === "Logit" || model.type === "Probit") {
    lines.push(
      `# modelsummary works with glm objects — exponentiate coefficients for Logit`,
      `modelsummary::modelsummary(`,
      `  list(${rStr(model.type)} = fit),`,
      `  exponentiate = ${model.type === "Logit" ? "TRUE" : "FALSE"},  # TRUE = show odds ratios for Logit`,
      `  stars        = c("*" = 0.1, "**" = 0.05, "***" = 0.01),`,
      `  gof_map      = c("nobs", "logLik", "AIC", "BIC"),`,
      `  output       = ${rStr(baseName + "_results.docx")}`,
      `)`,
      ``
    );
  } else {
    lines.push(
      `modelsummary::modelsummary(`,
      `  list(${rStr(model.type ?? "Model")} = fit),`,
      `  stars      = c("*" = 0.1, "**" = 0.05, "***" = 0.01),`,
      `  gof_omit   = "AIC|BIC|Log|F$",`,
      `  output     = ${rStr(baseName + "_results.docx")}`,
      `)`,
      ``
    );
  }

  // ── Session info ─────────────────────────────────────────────────────────────
  lines.push(
    `# ── 6. Session info (reproducibility) ───────────────────────────────────`,
    `sessionInfo()`,
    ``
  );

  return lines.join("\n");
}

// ─── MULTI-MODEL EXPORT ────────────────────────────────────────────────────────
// Generates an R script that estimates all models and outputs a joint modelsummary table.
//
// configs: Array of { model: ModelConfig, label: string }
// dataDictionary: Record<string,string> | null
export function generateMultiModelRScript(configs = [], dataDictionary = null) {
  if (!configs.length) return "# No models provided.";

  const ts = new Date().toISOString().slice(0, 10);
  const allTypes = [...new Set(configs.map(c => c.model?.type).filter(Boolean))];
  const pkgsSet = new Set(["dplyr", "tidyr", "readr", "fixest", "modelsummary", "lmtest", "car"]);
  allTypes.forEach(t => {
    if (t === "FE" || t === "FD") pkgsSet.add("plm");
    if (t === "RDD") pkgsSet.add("rdrobust");
    if (t === "Logit" || t === "Probit") { pkgsSet.add("marginaleffects"); pkgsSet.add("pROC"); pkgsSet.add("lmtest"); }
  });
  const pkgs = pkgsSet;

  const lines = [];
  lines.push(
    `# ════════════════════════════════════════════════════════════════════════`,
    `# Multi-model replication script — generated by Litux`,
    `# Models: ${configs.map((c, i) => `(${i+1}) ${c.label ?? c.model?.type}`).join(", ")}`,
    `# Generated: ${ts}`,
    `# ════════════════════════════════════════════════════════════════════════`,
    ``
  );

  lines.push(`# ── 0. Packages ──────────────────────────────────────────────────────────`);
  lines.push(`# install.packages(c(${[...pkgs].map(rStr).join(", ")}))`);
  [...pkgs].sort().forEach(p => lines.push(`library(${p})`));
  lines.push(``);

  lines.push(`# ── 1. Load data ─────────────────────────────────────────────────────────`);
  lines.push(`df <- readr::read_csv("dataset.csv")`);
  lines.push(``);

  if (dataDictionary && Object.keys(dataDictionary).length) {
    lines.push(`# ── 2. Variable definitions ──────────────────────────────────────────────`);
    Object.entries(dataDictionary).forEach(([k, v]) => lines.push(`# ${rName(k).padEnd(20)} ${v}`));
    lines.push(``);
  }

  lines.push(`# ── 3. Estimation (one fit object per model) ─────────────────────────────`);
  const fitNames = [];
  configs.forEach((c, i) => {
    const fitName = `fit_${i + 1}`;
    fitNames.push(fitName);
    lines.push(`# Model ${i+1}: ${c.label ?? c.model?.type}`);
    const modelCode = transpileModel(c.model ?? {});
    // Replace generic "fit" variable with indexed name
    lines.push(modelCode.replace(/\bfit\b/g, fitName).replace(/\bfit_fe\b/g, fitName).replace(/\bfit_fd\b/g, fitName));
    lines.push(``);
  });

  lines.push(`# ── 4. Joint output table ────────────────────────────────────────────────`);
  const listItems = configs.map((c, i) => `${rStr(c.label ?? `Model ${i+1}`)} = ${fitNames[i]}`).join(", ");
  lines.push(
    `modelsummary::modelsummary(`,
    `  list(${listItems}),`,
    `  stars      = c("*" = 0.1, "**" = 0.05, "***" = 0.01),`,
    `  gof_omit   = "AIC|BIC|Log|F$",`,
    `  output     = "comparison_results.docx"`,
    `)`,
    ``
  );

  lines.push(`sessionInfo()`);
  return lines.join("\n");
}

// ─── SUBSET REPLICATION SCRIPT (H6/H10) ───────────────────────────────────────
// Generates an R script that runs the same model on each named subset via lapply.
//
// config shape:
//   {
//     filename        string
//     pipeline        Step[]          — shared pipeline steps (before branch point)
//     perSubsetSteps  Step[]          — per-subset steps (after branch point), may be []
//     subsets         {name,filters}[]— named subset definitions
//     model           ModelConfig
//     dataDictionary  Record|null
//   }
export function generateSubsetRScript({ filename = "dataset.csv", pipeline = [], perSubsetSteps = [], subsets = [], model = {}, dataDictionary = null } = {}) {
  const ts      = new Date().toISOString().slice(0, 10);
  const stem    = filename.replace(/\.[^.]+$/, "");
  const pkgs    = buildPackageList(model.type, [...pipeline, ...perSubsetSteps]);
  const lines   = [];

  // Filter expressions: { col, op, val } → R expression
  function filterExpr(f) {
    const col   = rName(f.col);
    const isNum = f.val !== "" && !isNaN(Number(f.val));
    const val   = isNum ? f.val : rStr(f.val);
    return `${col} ${f.op} ${val}`;
  }

  // Trim model code: remove output/display calls so it's function-safe
  function modelBody(code) {
    return code.split("\n")
      .filter(l => !l.match(/^(fixest::etable|summary\(fit|rdrobust::rdplot|marginaleffects::|pROC::|lmtest::|cat\(|exp\(cbind)/))
      .join("\n");
  }

  lines.push(
    `# ════════════════════════════════════════════════════════════════════════`,
    `# Multi-subset replication script — generated by Litux`,
    `# Dataset:  ${filename}`,
    `# Model:    ${model.type ?? "unknown"}`,
    `# Subsets:  Full sample + ${subsets.length} named subset${subsets.length !== 1 ? "s" : ""}`,
    `# Generated: ${ts}`,
    `# ════════════════════════════════════════════════════════════════════════`,
    ``
  );

  lines.push(`# ── 0. Packages ──────────────────────────────────────────────────────────`);
  lines.push(`# install.packages(c(${pkgs.map(rStr).join(", ")}))`);
  pkgs.forEach(p => lines.push(`library(${p})`));
  lines.push(``);

  lines.push(`# ── 1. Load data ─────────────────────────────────────────────────────────`);
  const ext = filename.split(".").pop()?.toLowerCase();
  if (ext === "csv")  lines.push(`df <- readr::read_csv(${rStr(filename)})`);
  else if (["xlsx","xls"].includes(ext)) lines.push(`df <- readxl::read_excel(${rStr(filename)})`);
  else if (ext === "dta") lines.push(`df <- haven::read_dta(${rStr(filename)})`);
  else lines.push(`df <- readr::read_csv(${rStr(filename)})`);
  lines.push(``);

  if (dataDictionary && Object.keys(dataDictionary).length) {
    lines.push(`# ── 2. Variable definitions ──────────────────────────────────────────────`);
    Object.entries(dataDictionary).forEach(([k, v]) => lines.push(`# ${rName(k).padEnd(20)} ${v}`));
    lines.push(``);
  }

  if (pipeline.length) {
    lines.push(`# ── 3. Shared pipeline (${pipeline.length} step${pipeline.length !== 1 ? "s" : ""}) ────────────────────────────────`);
    pipeline.forEach((step, i) => {
      lines.push(`# Step ${i + 1}: ${step.type}`);
      lines.push(transpileStep(step));
      lines.push(``);
    });
  }

  // Named list of subset filter functions
  lines.push(`# ── 4. Define subsets ────────────────────────────────────────────────────`);
  const subsetEntries = [
    `  ${rStr("Full sample")} = function(d) d`,
    ...subsets.map(s => {
      if (!s.filters?.length) return `  ${rStr(s.name)} = function(d) d  # no filter`;
      const cond = s.filters.map(filterExpr).join(" & ");
      return `  ${rStr(s.name)} = function(d) dplyr::filter(d, ${cond})`;
    }),
  ];
  lines.push(`subsets <- list(`);
  subsetEntries.forEach((e, i) => lines.push(e + (i < subsetEntries.length - 1 ? "," : "")));
  lines.push(`)`);
  lines.push(``);

  // Per-subset prep function
  if (perSubsetSteps.length) {
    lines.push(`# ── 5. Per-subset pipeline (${perSubsetSteps.length} step${perSubsetSteps.length !== 1 ? "s" : ""}) ──────────────────────────────`);
    lines.push(`prep <- function(d) {`);
    perSubsetSteps.forEach(step => {
      const code = transpileStep(step, "d");
      lines.push(`  ${code.replace(/\n/g, "\n  ")}`);
    });
    lines.push(`  d`);
    lines.push(`}`);
    lines.push(``);
  }

  // run_model function
  lines.push(`# ── 6. Model function ────────────────────────────────────────────────────`);
  lines.push(`run_model <- function(d) {`);
  if (perSubsetSteps.length) lines.push(`  d <- prep(d)`);
  const rawModel = transpileModel(model);
  const bodyLines = modelBody(rawModel).split("\n")
    .map(l => `  ${l}`)
    .join("\n");
  lines.push(bodyLines);
  lines.push(`  fit`);
  lines.push(`}`);
  lines.push(``);

  lines.push(`# ── 7. Run on all subsets ────────────────────────────────────────────────`);
  lines.push(`results <- lapply(subsets, function(fn) run_model(fn(df)))`);
  lines.push(``);

  lines.push(`# ── 8. Comparison table ──────────────────────────────────────────────────`);
  lines.push(
    `modelsummary::modelsummary(`,
    `  results,`,
    `  stars    = c("*" = 0.1, "**" = 0.05, "***" = 0.01),`,
    `  gof_omit = "AIC|BIC|Log|F$",`,
    `  output   = ${rStr(stem + "_subsets.docx")}`,
    `)`,
    ``
  );

  lines.push(`sessionInfo()`);
  return lines.join("\n");
}

// ─── PACKAGE LIST ─────────────────────────────────────────────────────────────
function buildPackageList(modelType, pipeline) {
  const pkgs = new Set(["dplyr", "tidyr", "readr", "fixest", "modelsummary"]);

  // Model-specific
  if (modelType === "FE" || modelType === "FD") pkgs.add("plm");
  if (modelType === "RDD") { pkgs.add("rdrobust"); pkgs.delete("fixest"); pkgs.delete("modelsummary"); }
  if (modelType === "Logit" || modelType === "Probit") {
    pkgs.add("marginaleffects");
    pkgs.add("pROC");
    pkgs.add("lmtest");
    pkgs.delete("fixest");  // base R glm() — no fixest needed
  }

  // Pipeline-specific
  pipeline.forEach(s => {
    if (s.type === "dummy")        pkgs.add("fastDummies");
    if (s.type === "quickclean")   pkgs.add("stringr");
    if (s.type === "date_extract") pkgs.add("lubridate");
    if (["join", "append"].includes(s.type)) pkgs.add("readr");
    if (s.filename?.match(/\.xlsx?$/i)) pkgs.add("readxl");
    if (s.filename?.match(/\.dta$/i))   pkgs.add("haven");
  });

  // Diagnostics
  pkgs.add("lmtest");
  pkgs.add("car");

  return [...pkgs].sort();
}
