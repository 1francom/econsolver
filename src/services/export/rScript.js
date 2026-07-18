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
import { toR, jsExprToR, rRightLoad } from "../../pipeline/stepTranslators.js";
import { buildRLoadLine } from "./loadLine.js";

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

function rFn(fn, col) {
  const c = rName(col);
  const map = {
    mean:   `mean(${c}, na.rm = TRUE)`,
    sum:    `sum(${c}, na.rm = TRUE)`,
    sd:     `sd(${c}, na.rm = TRUE)`,
    min:    `min(${c}, na.rm = TRUE)`,
    max:    `max(${c}, na.rm = TRUE)`,
    median: `median(${c}, na.rm = TRUE)`,
    rank:   `dplyr::min_rank(${c})`,
  };
  return map[fn] ?? `mean(${c}, na.rm = TRUE)`;
}

function rValue(v, dtype = null) {
  if (v === null || v === undefined) return "NA";
  if (dtype === "number" || typeof v === "number") {
    const n = Number(v);
    return isFinite(n) ? String(n) : "NA";
  }
  return rStr(v);
}

function rWhere(where) {
  if (!where?.col || !where?.op) return "TRUE";
  const c = rName(where.col);
  const v = where.value;
  switch (where.op) {
    case "equals": return `${c} == ${rValue(v)}`;
    case "not_equals": return `${c} != ${rValue(v)}`;
    case "contains": return `stringr::str_detect(as.character(${c}), stringr::fixed(${rStr(v ?? "")}))`;
    case "starts": return `stringr::str_starts(as.character(${c}), ${rStr(v ?? "")})`;
    case "ends": return `stringr::str_ends(as.character(${c}), ${rStr(v ?? "")})`;
    case "gt": return `${c} > ${Number(v)}`;
    case "lt": return `${c} < ${Number(v)}`;
    case "between": {
      const lo = Number(Array.isArray(v) ? v[0] : v);
      const hi = Number(Array.isArray(v) ? v[1] : v);
      return `${c} >= ${lo} & ${c} <= ${hi}`;
    }
    case "empty": return `is.na(${c}) | as.character(${c}) == ""`;
    case "notempty": return `!is.na(${c}) & as.character(${c}) != ""`;
    default: return "TRUE";
  }
}

// ─── PIPELINE TRANSPILER ──────────────────────────────────────────────────────
// Each step type maps to one or more dplyr/tidyr/stringr/lubridate calls.
function transpileStep(step, dfVar = "df", allDatasets = {}) {
  const col  = step.col  ? rName(step.col)  : null;
  const nn   = step.nn   ? rName(step.nn)   : null;
  const quot = step.col  ? rStr(step.col)   : null;

  if (typeof step.type === "string" && step.type.startsWith("sp_")) return toR(step, dfVar, allDatasets);

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

    case "add_column":
      return `${dfVar} <- ${dfVar} |> mutate(${rName(step.nn)} = ${rValue(step.fill, step.dtype)})`;

    case "add_row": {
      const count = Math.max(1, Number(step.count) || 1);
      const assigns = Object.entries(step.values || {})
        .map(([k, v]) => `__new_rows[[${rStr(k)}]] <- ${rValue(v)}`);
      return [
        `# add_row: append ${count} synthetic row(s); unspecified columns remain NA`,
        `__new_rows <- ${dfVar}[rep(NA_integer_, ${count}), , drop = FALSE]`,
        ...assigns,
        `${dfVar} <- dplyr::bind_rows(${dfVar}, __new_rows)`,
        `rm(__new_rows)`,
      ].join("\n");
    }

    case "set_where": {
      const setVal = step.action === "clear" ? "NA" : rValue(step.value, step.dtype);
      return `${dfVar} <- ${dfVar} |> mutate(${rName(step.col)} = ifelse(${rWhere(step.where)}, ${setVal}, ${rName(step.col)}))`;
    }

    case "replace": {
      const mode = step.match?.mode || "exact";
      const find = step.match?.find ?? "";
      const out = rName(step.nn || step.col);
      const src = rName(step.col);
      if (mode === "exact") {
        return `${dfVar} <- ${dfVar} |> mutate(${out} = dplyr::if_else(${src} == ${rValue(find)}, ${rValue(step.replaceWith)}, ${src}))`;
      }
      const pattern = mode === "contains" ? `stringr::fixed(${rStr(find)})` : rStr(find);
      return `${dfVar} <- ${dfVar} |> mutate(${out} = stringr::str_replace_all(as.character(${src}), ${pattern}, ${rValue(step.replaceWith)}))`;
    }

    case "str_splice": {
      const src = rName(step.col);
      const out = rName(step.nn || step.col);
      const pos = Number(step.position) || 1;
      const n = Math.max(0, Number(step.count) || 0);
      const text = rStr(step.text ?? "");
      const pExpr = `ifelse(${pos} < 0, pmax(1, nchar(x) + ${pos} + 1), ${pos})`;
      const body = step.mode === "delete"
        ? `stringr::str_c(stringr::str_sub(x, 1, p - 1), stringr::str_sub(x, p + ${n}))`
        : step.mode === "overwrite"
          ? `stringr::str_c(stringr::str_sub(x, 1, p - 1), ${text}, stringr::str_sub(x, p + ${n}))`
          : `stringr::str_c(stringr::str_sub(x, 1, p - 1), ${text}, stringr::str_sub(x, p))`;
      return [
        `${dfVar} <- ${dfVar} |> mutate(${out} = {`,
        `  x <- as.character(${src})`,
        `  p <- pmin(pmax(${pExpr}, 1), nchar(x) + 1)`,
        `  ${body}`,
        `})`,
      ].join("\n");
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

    case "distinct": {
      const cols = step.subset?.length ? `, ${step.subset.map(rName).join(", ")}` : "";
      return `${dfVar} <- ${dfVar} |> distinct(${cols.replace(/^, /, "")}${cols ? ", " : ""}.keep_all = TRUE)`;
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

    case "date_parse": {
      // Normalise a raw date column into a real Date; new column when nn differs.
      const outCol = (step.nn && step.nn !== step.col) ? rName(step.nn) : col;
      return `${dfVar} <- ${dfVar} |> mutate(${outCol} = lubridate::parse_date_time(${col}, orders = c("ymd", "dmy", "mdy")))`;
    }

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

    case "mutate": {
      const rExpr = jsExprToR(step.expr);
      if (rExpr) return `${dfVar} <- ${dfVar} |> dplyr::mutate(${nn} = ${rExpr})`;
      return [
        `# mutate: ${step.nn} = ${step.expr}`,
        `# NOTE: expression uses JS syntax — translate to R manually`,
        `# ${dfVar} <- ${dfVar} |> dplyr::mutate(${nn} = <R expression>)`,
      ].join("\n");
    }

    case "ai_tr": {
      const col    = step.col ?? "col";
      const jsCode = step.js  ?? "";
      const arrowMatch = jsCode.match(/^\s*\(?\s*(\w+)\s*\)?\s*=>\s*([\s\S]+)$/);
      if (arrowMatch) {
        const [, param, body] = arrowMatch;
        const substituted = body.trim().replace(new RegExp(`\\b${param}\\b`, "g"), rName(col));
        const rExpr = jsExprToR(substituted);
        if (rExpr) return `${dfVar} <- ${dfVar} |> dplyr::mutate(${rName(col)} = ${rExpr})`;
      }
      return [
        `# ai_tr on "${col}" — AI-generated transformation`,
        `# JS: ${jsCode}`,
        `# ${dfVar} <- ${dfVar} |> dplyr::mutate(${rName(col)} = <R expression>)`,
      ].join("\n");
    }

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

    case "group_transform": {
      const by = (step.by ?? []).map(rName).join(", ");
      const out = rName(step.nn ?? `${step.fn}_${step.col}`);
      const rhs = step.fn === "count" ? "n()" : rFn(step.fn, step.col);
      return `${dfVar} <- ${dfVar} |> group_by(${by}) |> mutate(${out} = ${rhs}) |> ungroup()`;
    }

    case "pivot_longer": {
      const mode      = step.mode || "simple";
      const namesTo   = rName(step.namesTo   ?? "name");
      const valuesTo  = rName(step.valuesTo  ?? "value");

      if (mode === "multi") {
        // .value semantics: groups = [{prefix, colName}], keyName = time variable
        const groups  = step.groups ?? [];
        const keyName = rName(step.keyName ?? "key");
        const prefixParts = groups.map(g => rStr(g.prefix)).join(", ");
        const colNames    = groups.map(g => rStr(g.colName)).join(", ");
        return [
          `# pivot_longer (multi-variable / .value semantics)`,
          `${dfVar} <- ${dfVar} |> tidyr::pivot_longer(`,
          `  cols = tidyr::matches(paste0("^(", paste(c(${prefixParts}), collapse="|"), ")")),`,
          `  names_to = c(${colNames}, "${keyName}"),`,
          `  names_sep = ${rStr(step.keySep ?? "_")},`,
          `  values_to = ".value"`,
          `)`,
        ].join("\n");
      }

      // Simple mode
      const pivotCols = (step.cols ?? []).map(rName).join(", ");
      const opts = [];
      if (step.namesPrefix) opts.push(`  names_prefix = ${rStr(step.namesPrefix)}`);
      if (step.namesSep)    opts.push(`  names_sep    = ${rStr(step.namesSep)}`);
      return [
        `${dfVar} <- ${dfVar} |> tidyr::pivot_longer(`,
        `  cols      = c(${pivotCols}),`,
        `  names_to  = ${rStr(step.namesTo  ?? "name")},`,
        `  values_to = ${rStr(step.valuesTo ?? "value")}${opts.length ? "," : ""}`,
        ...opts,
        `)`,
      ].join("\n");
    }

    case "join": {
      const how       = {
        left:"left_join", inner:"inner_join", right:"right_join",
        full:"full_join", semi:"semi_join", anti:"anti_join",
      }[step.how || "left"] ?? "left_join";
      const rightName = allDatasets[step.rightId]?.name ?? step.rightId;
      return [
        `# Load right dataset: "${rightName}"`,
        `right_df <- ${rRightLoad(step.rightId, allDatasets)}`,
        `${dfVar} <- ${how}(${dfVar}, right_df, by = c(${rStr(step.leftKey)} = ${rStr(step.rightKey)}), suffix = c("", ${rStr(step.suffix ?? "_r")}))`,
      ].join("\n");
    }

    case "append": {
      const rightName = allDatasets[step.rightId]?.name ?? step.rightId;
      return [
        `# Append dataset: "${rightName}"`,
        `right_df <- ${rRightLoad(step.rightId, allDatasets)}`,
        `${dfVar} <- dplyr::bind_rows(${dfVar}, right_df)`,
      ].join("\n");
    }

    case "bind_cols": {
      const rightName = allDatasets[step.rightId]?.name ?? step.rightId;
      return [
        `# Bind columns from dataset: "${rightName}"`,
        `right_df <- ${rRightLoad(step.rightId, allDatasets)}`,
        `${dfVar} <- bind_cols(${dfVar}, right_df)`,
      ].join("\n");
    }

    case "union":
    case "intersect":
    case "setdiff": {
      const rightName = allDatasets[step.rightId]?.name ?? step.rightId;
      return [
        `# ${step.type}: "${rightName}"`,
        `right_df <- ${rRightLoad(step.rightId, allDatasets)}`,
        `${dfVar} <- ${step.type}(${dfVar}, right_df)`,
      ].join("\n");
    }

    case "vector_assign": {
      const vals = rVec(step.values ?? []);
      const out = rName(step.nn ?? "assigned");
      const seed = Number.isFinite(Number(step.seed)) ? Number(step.seed) : 42;
      if (step.mode === "recycle") return `${dfVar}$${out} <- rep_len(${vals}, nrow(${dfVar}))`;
      if (step.mode === "conditional") {
        const lines = (step.rules || []).map(r => `    ${r.expr} ~ ${rStr(r.value)}`).join(",\n");
        return `${dfVar}$${out} <- with(${dfVar}, dplyr::case_when(\n${lines}${lines ? ",\n" : ""}    TRUE ~ ${rStr(step.elseValue ?? "")}\n))`;
      }
      const prob = step.weights ? `, prob = c(${step.weights.join(", ")})` : "";
      if (step.mode === "quota") {
        return `# NOTE: EconSolver uses a seeded mulberry32 RNG; values differ, distribution matches\nset.seed(${seed}); ${dfVar}$${out} <- sample(rep_len(${vals}, nrow(${dfVar})))`;
      }
      return `# NOTE: EconSolver uses a seeded mulberry32 RNG; values differ, distribution matches\nset.seed(${seed}); ${dfVar}$${out} <- sample(${vals}, nrow(${dfVar}), replace = TRUE${prob})`;
    }

    case "patch": {
      const col = step.col ?? "column";
      const row = step.ri ?? step.rowId ?? "?";
      return `# manual cell edit (${col} @ row ${row}) — not replayable on the raw file; load the exported *_cleaned.csv instead (see Data Loading note)`;
    }

    case "geocode": {
      const addrCol = rName(step.addressCol ?? "address");
      const latCol  = rName(step.latCol  ?? "lat");
      const lonCol  = rName(step.lonCol  ?? "lon");
      return [
        `# Geocode: ${addrCol} → ${latCol} / ${lonCol}`,
        `# Requires tidygeocoder: install.packages("tidygeocoder")`,
        `# Provider: OpenStreetMap Nominatim (1 req/s — ToS)`,
        `library(tidygeocoder)`,
        `${dfVar} <- ${dfVar} |>`,
        `  geocode(address = ${addrCol}, method = "osm",`,
        `          lat = ${latCol}, long = ${lonCol},`,
        `          full_results = FALSE, quiet = TRUE)`,
      ].join("\n");
    }

    case "inject_column": {
      const vals = (step.values ?? []).map(v => (v == null ? "NA" : Number(v).toFixed(8))).join(", ");
      return [
        `# inject_column: "${step.colName}" — extracted from model output`,
        `# Re-run estimation and extract again if the pipeline changes upstream.`,
        `${dfVar}[["${rName(step.colName)}"]] <- c(${vals})`,
      ].join("\n");
    }

    case "fill_na_grouped": {
      const fn = step.strategy === "median" ? "median" : "mean";
      return [
        `${dfVar} <- ${dfVar} |>`,
        `  group_by(${rName(step.groupCol)}) |>`,
        `  mutate(${col} = ifelse(is.na(${col}), ${fn}(${col}, na.rm = TRUE), ${col})) |>`,
        `  ungroup()`,
      ].join("\n");
    }

    case "trim_outliers":
      return `${dfVar} <- ${dfVar} |> filter(${col} >= ${Number(step.lo)} & ${col} <= ${Number(step.hi)})`;

    case "flag_outliers": {
      const out = rName(step.nn || `${step.col}_outlier`);
      if (step.method === "zscore") {
        const thr = Number(step.threshold) || 3;
        return `${dfVar} <- ${dfVar} |> mutate(${out} = as.integer(abs((${col} - mean(${col}, na.rm = TRUE)) / sd(${col}, na.rm = TRUE)) > ${thr}))`;
      }
      return [
        `${dfVar} <- ${dfVar} |> mutate(${out} = as.integer(`,
        `  ${col} < quantile(${col}, 0.25, na.rm = TRUE) - 1.5 * IQR(${col}, na.rm = TRUE) |`,
        `  ${col} > quantile(${col}, 0.75, na.rm = TRUE) + 1.5 * IQR(${col}, na.rm = TRUE)`,
        `))`,
      ].join("\n");
    }

    case "extract_regex": {
      const out = rName(step.nn || `${step.col}_num`);
      if (step.regex) {
        return `${dfVar} <- ${dfVar} |> mutate(${out} = as.numeric(stringr::str_match(as.character(${col}), ${rStr(step.regex)})[, 2]))`;
      }
      const loc = step.locale === "comma"
        ? `readr::locale(decimal_mark = ",", grouping_mark = ".")`
        : step.locale === "dot"
          ? `readr::locale(decimal_mark = ".", grouping_mark = ",")`
          : `readr::locale()`;
      return `${dfVar} <- ${dfVar} |> mutate(${out} = readr::parse_number(as.character(${col}), locale = ${loc}))`;
    }

    case "factor_interactions": {
      const cont = rName(step.contCol);
      const pfx  = step.prefix || `${step.contCol}_x_`;
      const lines = (step.dummyCols ?? [])
        .map(d => `  ${rName(pfx + d)} = ${cont} * ${rName(d)}`)
        .join(",\n");
      return lines
        ? `${dfVar} <- ${dfVar} |> mutate(\n${lines}\n)`
        : `# factor_interactions: no dummy columns specified`;
    }

    case "clean_strings": {
      const caseFn = { lower: "tolower", upper: "toupper", title: "stringr::str_to_title" }[step.case];
      const inner = caseFn
        ? `${caseFn}(stringr::str_squish(as.character(${col})))`
        : `stringr::str_squish(as.character(${col}))`;
      return `${dfVar} <- ${dfVar} |> mutate(${col} = ${inner})`;
    }

    case "if_else": {
      const cond = jsExprToR(step.cond);
      const out  = rName(step.nn);
      if (!cond) return `# if_else: ${step.nn} = if (${step.cond}) ... — translate condition to R manually`;
      return `${dfVar} <- ${dfVar} |> mutate(${out} = dplyr::if_else(${cond}, ${rValue(step.trueVal)}, ${rValue(step.falseVal)}))`;
    }

    case "case_when": {
      const out = rName(step.nn);
      const branches = (step.cases ?? [])
        .map(c => { const cc = jsExprToR(c.cond); return cc ? `    ${cc} ~ ${rValue(c.val)}` : null; })
        .filter(Boolean)
        .join(",\n");
      return branches
        ? `${dfVar} <- ${dfVar} |> mutate(${out} = dplyr::case_when(\n${branches},\n    TRUE ~ ${rValue(step.defaultVal)}\n  ))`
        : `# case_when: no valid conditions — translate manually`;
    }

    case "grouped_mutate": {
      const by = (step.by ?? []).map(rName).join(", ");
      const out = rName(step.newCol || "grouped");
      const fn = step.fn ?? "mean";
      if (!by || !step.newCol) return `# grouped_mutate: incomplete config`;
      if (fn === "expr" && step.expr) {
        const rExpr = jsExprToR(step.expr);
        return rExpr
          ? `${dfVar} <- ${dfVar} |> group_by(${by}) |> mutate(${out} = ${rExpr}) |> ungroup()`
          : `# grouped_mutate (expr): translate "${step.expr}" to R manually`;
      }
      const rhs = step.col ? rFn(fn, step.col) : "n()";
      return [
        `# grouped_mutate: ${fn} over groups${step.condition?.length ? " (row conditions applied in-app — review)" : ""}`,
        `${dfVar} <- ${dfVar} |> group_by(${by}) |> mutate(${out} = ${rhs}) |> ungroup()`,
      ].join("\n");
    }

    case "pivot_wider": {
      const idCols    = (step.idCols ?? []).map(rName).join(", ");
      const namesFrom = rStr(step.namesFrom);
      const valsFrom  = (Array.isArray(step.valuesFrom) ? step.valuesFrom : [step.valuesFrom].filter(Boolean))
        .map(rStr).join(", ");
      const opts = [];
      if (step.namesPrefix) opts.push(`  names_prefix = ${rStr(step.namesPrefix)}`);
      if (step.valuesFill !== undefined && step.valuesFill !== null && step.valuesFill !== "")
        opts.push(`  values_fill = ${Number(step.valuesFill)}`);
      return [
        `${dfVar} <- ${dfVar} |> tidyr::pivot_wider(`,
        `  id_cols     = c(${idCols}),`,
        `  names_from  = ${namesFrom},`,
        `  values_from = c(${valsFrom})${opts.length ? "," : ""}`,
        ...opts.map((o, i) => o + (i < opts.length - 1 ? "," : "")),
        `)`,
      ].join("\n");
    }

    case "balance_panel": {
      const ent  = rName(step.entityCol);
      const tim  = rName(step.timeCol);
      const slot = step.slotCol ? `, ${rName(step.slotCol)}` : "";
      const outcomes = (step.outcomeCols ?? []).map(rName);
      const fill = Number(step.fillValue) || 0;
      let line = `${dfVar} <- ${dfVar} |> tidyr::complete(${ent}, ${tim}${slot})`;
      if (outcomes.length) {
        line += ` |>\n  tidyr::replace_na(list(${outcomes.map(o => `${o} = ${fill}`).join(", ")}))`;
      }
      return [
        `# Balance panel: complete ${step.entityCol} × ${step.timeCol}${step.slotCol ? ` × ${step.slotCol}` : ""} grid (static cols may need manual carry-forward)`,
        line,
      ].join("\n");
    }

    default:
      return `# [unknown step: ${step.type}] ${stepLabel(step)}`;
  }
}

// ─── R FORMULA BUILDER ────────────────────────────────────────────────────────
// Builds the RHS of an R formula from raw variable lists + interaction terms.
// Uses xVarsRaw/wVarsRaw (pre-expansion) when available; else falls back to
// the post-expansion dummy columns (xVars/wVars). Factor vars are wrapped in
// factor(). Interactions use R's * (main effects + product) or : (product only).
function buildRFormulaStr(xVarsRaw, wVarsRaw, xVars, wVars, fvSet, interactionTerms) {
  const fmt = v => fvSet.has(v) ? `factor(${rName(v)})` : rName(v);
  const rawX = xVarsRaw ?? xVars;
  const rawW = wVarsRaw ?? wVars;

  const parts = [...rawX, ...rawW].map(fmt);
  for (const { var1, var2, type } of (interactionTerms ?? [])) {
    if (!var1 || !var2) continue;
    const f1 = fmt(var1);
    const f2 = fmt(var2);
    if (type === "*") {
      // Remove individual main effects (they'll be re-emitted via A*B)
      const i1 = parts.indexOf(f1); if (i1 >= 0) parts.splice(i1, 1);
      const i2 = parts.indexOf(f2); if (i2 >= 0) parts.splice(i2, 1);
      parts.push(`${f1} * ${f2}`);
    } else {
      parts.push(`${f1} : ${f2}`);
    }
  }
  return parts.join(" + ") || "1";
}

// fixest `vcov=` argument for a given SE type. Mirrors the SE the user selected
// in Litux's Inference Options so the exported script reports the SAME standard
// errors as the platform (was previously hardcoded to "HC1"). Returns an object
// { arg, note, hcExact } where:
//   arg     — the fixest `vcov=` value
//   note    — comment line explaining an approximation, or null
//   hcExact — "HC2" | "HC3" when fixest cannot produce the requested SE natively.
//             Call sites MUST pass this to rHC23Lines() so the script also emits
//             an lm()-based refit that reports the exact SE. fixest's "hetero" is
//             HC1 and nothing else; silently emitting it for an HC2/HC3 request
//             made the exported script disagree with the platform's own numbers.
function rVcov(seType, { clusterVar, clusterVar2 } = {}) {
  switch ((seType || "classical").toLowerCase()) {
    case "classical": return { arg: `"iid"`,    note: null, hcExact: null };
    case "hc1":       return { arg: `"hetero"`, note: null, hcExact: null };
    case "hc2":       return {
      arg: `"hetero"`, hcExact: "HC2",
      note: `# NOTE: fixest's vcov="hetero" is HC1 — it has no native HC2. The feols\n# fit below is for point estimates; the exact HC2 SE come from the refit below.`,
    };
    case "hc3":       return {
      arg: `"hetero"`, hcExact: "HC3",
      note: `# NOTE: fixest's vcov="hetero" is HC1 — it has no native HC3. The feols\n# fit below is for point estimates; the exact HC3 SE come from the refit below.`,
    };
    case "clustered": return clusterVar
      ? { arg: `~${rName(clusterVar)}`, note: null, hcExact: null }
      : { arg: `"hetero"`, hcExact: null,
          note: `# WARNING: clustered SE requested but no cluster variable was set —\n# falling back to heteroskedasticity-robust (HC1) SE.` };
    case "twoway":    return (clusterVar && clusterVar2)
      ? { arg: `~${rName(clusterVar)} + ${rName(clusterVar2)}`, note: null, hcExact: null }
      : { arg: clusterVar ? `~${rName(clusterVar)}` : `"hetero"`, hcExact: null,
          note: `# WARNING: two-way clustered SE requested but ${clusterVar ? "the second" : "no"} cluster\n# variable was set — falling back to ${clusterVar ? "one-way clustering" : "HC1"}.` };
    case "hac":       return {
      arg: `"NW"`, hcExact: null,
      note: `# NOTE: fixest's vcov="NW" (Newey-West) requires the data to be declared\n# as a panel/time series (see the panel= argument). For pure cross-sections use\n# sandwich::NeweyWest(fit) instead.`,
    };
    default:          return { arg: `"iid"`, note: null, hcExact: null };
  }
}

// Panel / absorbed-FE models. fixest treats iid / hetero / ~cluster / NW the
// same way it does for a cross-section, so `vc.arg` carries over unchanged and
// these estimators can simply honour the user's seType — they used to hardcode
// `vcov = ~entityCol`, which silently disagreed with the platform whenever the
// user had not picked clustered SE (computeRobustSE returns classical SE by
// default, it does not cluster by entity).
//
// HC2/HC3 are the one case that cannot be made exact: there is no native fixest
// support, and an LSDV lm() refit computes leverage on a design that INCLUDES
// the FE dummies, whereas Litux computes h_ii on the within-transformed design
// (duckdbWithinHC23). The two agree to ~1e-3 — see the "panel-hc23-leverage"
// entry in __validation__/seTolerances.js. Emit the refit, but label it as
// approximate rather than claiming it reproduces the platform exactly.
function rPanelHC23Lines(hcExact, formula, feCols = []) {
  if (!hcExact) return [];
  const dummies = feCols.filter(Boolean).map(c => `factor(${rName(c)})`).join(" + ");
  return [
    ``,
    `# Approximate ${hcExact} SE — fixest has no ${hcExact} for absorbed models.`,
    `# This LSDV refit carries the fixed effects as dummies, so its leverage (and`,
    `# hence the SE) differs from Litux's within-design leverage by ~1e-3.`,
    `fit_lm <- lm(${formula}${dummies ? ` + ${dummies}` : ""}, data = df)`,
    `lmtest::coeftest(fit_lm, vcov. = sandwich::vcovHC(fit_lm, type = "${hcExact}"))`,
  ];
}

// plm-based models (FD, and the FE Hausman companion) report classical SE from
// summary() alone. plm has its own vcov family, so map the user's seType onto it
// instead of leaving every FD export at classical regardless of the selection.
// The platform runs FD as an OLS on the differenced design, which is exactly the
// design plm::vcovHC operates on, so these line up.
function rPlmVcovLines(seType, fitName, { clusterVar } = {}) {
  const s = (seType || "classical").toLowerCase();
  const wrap = expr => [
    ``,
    `# ${s.toUpperCase()} standard errors (these are the SE Litux reports)`,
    `lmtest::coeftest(${fitName}, vcov. = ${expr})`,
  ];
  switch (s) {
    case "classical": return [];   // summary() is already classical
    case "hc1": case "hc2": case "hc3":
      // method="white1" is plain heteroskedasticity-robust; "arellano" (plm's
      // default) is cluster-by-group and would silently be the wrong thing here.
      return wrap(`plm::vcovHC(${fitName}, method = "white1", type = "${s.toUpperCase()}")`);
    case "clustered":
      return wrap(`plm::vcovHC(${fitName}, method = "arellano", type = "HC1", cluster = "group")`);
    case "twoway":
      return [
        ``,
        `# NOTE: Litux used two-way clustered SE. plm has no native two-way vcov;`,
        `# this clusters on the panel's group dimension only${clusterVar ? ` (${rName(clusterVar)})` : ""}.`,
        `lmtest::coeftest(${fitName}, vcov. = plm::vcovHC(${fitName}, method = "arellano", type = "HC1", cluster = "group"))`,
      ];
    case "hac":
      // Driscoll-Kraay — the same reference plm::vcovSCC that Fase 4b validated
      // the platform's panel HAC against.
      return wrap(`plm::vcovSCC(${fitName}, type = "HC1")`);
    default: return [];
  }
}

// glm()-based models (Poisson, Logit, Probit). sandwich works directly on glm
// objects, so every SE type the platform offers has an exact counterpart here.
// This used to be a hardcoded HC1 regardless of the user's selection.
function rGlmVcovLines(seType, fitName, { clusterVar, clusterVar2 } = {}) {
  const s = (seType || "classical").toLowerCase();
  const wrap = expr => [`lmtest::coeftest(${fitName}, vcov. = ${expr})`];
  switch (s) {
    case "classical": return [`summary(${fitName})`];
    case "hc1": case "hc2": case "hc3":
      return wrap(`sandwich::vcovHC(${fitName}, type = "${s.toUpperCase()}")`);
    case "clustered":
      return clusterVar
        ? wrap(`sandwich::vcovCL(${fitName}, cluster = df$${rName(clusterVar)})`)
        : wrap(`sandwich::vcovHC(${fitName}, type = "HC1")`);
    case "twoway":
      return (clusterVar && clusterVar2)
        ? wrap(`sandwich::vcovCL(${fitName}, cluster = ~ ${rName(clusterVar)} + ${rName(clusterVar2)})`)
        : wrap(`sandwich::vcovHC(${fitName}, type = "HC1")`);
    case "hac":
      return wrap(`sandwich::NeweyWest(${fitName})`);
    default: return [`summary(${fitName})`];
  }
}

// Exact HC2 / HC3 standard errors. fixest cannot produce them, so when the user
// picked HC2/HC3 we keep the feols fit for point estimates and diagnostics and
// re-run inference on an equivalent lm(), which sandwich::vcovHC does support
// exactly (it needs hatvalues(), which lm provides and fixest does not).
// Returns [] when hcExact is null, so call sites can spread it unconditionally.
function rHC23Lines(hcExact, formula, weightsCol = null) {
  if (!hcExact) return [];
  const w = weightsCol ? `, weights = ${weightsCol}` : "";
  return [
    ``,
    `# Exact ${hcExact} standard errors (these are the SE Litux reports)`,
    `fit_lm <- lm(${formula}, data = df${w})`,
    `lmtest::coeftest(fit_lm, vcov. = sandwich::vcovHC(fit_lm, type = "${hcExact}"))`,
  ];
}

// Estimators whose panel HAC is Driscoll-Kraay rather than plain Newey-West.
const PANEL_TYPES_R = new Set(["FE", "FD", "TWFE", "LSDV", "EventStudy", "PoissonFE"]);

// ─── MODEL TRANSPILER ─────────────────────────────────────────────────────────
function transpileModel(model) {
  const {
    type, yVar, xVars = [], wVars = [],
    zVars = [], postVar, treatVar,
    runningVar, cutoff, bandwidth, kernel = "triangular", polyOrder = 1,
    entityCol, timeCol, factorVars = [], feCols = null, offsetCol = null,
    treatedUnit, treatTime,
    distCol, treatmentCol,
    weightCol = null,
    cohortCol, periodCol, controlMode, refPeriod,
    interactionTerms = [], xVarsRaw = null, wVarsRaw = null,
    seType = "classical", clusterVar = null, clusterVar2 = null,
  } = model;

  // SE the user actually selected — emitted instead of a hardcoded "HC1".
  const vc = rVcov(seType, { clusterVar, clusterVar2 });
  // Panel HAC in Litux is Driscoll-Kraay (duckdbWithinHAC / plm::vcovSCC — see
  // Fase 4b in CLAUDE.md), not the plain Newey-West that rVcov emits for a
  // cross-section. fixest spells that `DK ~ time`, so override it here rather
  // than emitting "NW", which is a different estimator (and errors on a feols
  // model with no panel.id declared).
  if ((seType || "").toLowerCase() === "hac" && PANEL_TYPES_R.has(type) && timeCol) {
    vc.arg  = `DK ~ ${rName(timeCol)}`;
    vc.note = `# NOTE: Litux's panel HAC is Driscoll-Kraay — fixest spells this DK ~ time.`;
  }
  // Number of regressors (for the VIF guard — vif() errors on < 2 terms).
  const nReg = (xVars?.length ?? 0) + (wVars?.length ?? 0) + (interactionTerms?.length ?? 0);

  const fvSet = new Set(factorVars);
  const fmtR  = v => fvSet.has(v) ? `factor(${rName(v)})` : rName(v);

  const y    = rName(yVar);
  const xStr = buildRFormulaStr(xVarsRaw, wVarsRaw, xVars, wVars, fvSet, interactionTerms);

  switch (type) {

    case "OLS":
      return [
        `# ── OLS ──────────────────────────────────────────────────────────────`,
        ...(vc.note ? [vc.note] : []),
        `fit <- fixest::feols(${y} ~ ${xStr}, data = df, vcov = ${vc.arg})`,
        ...rHC23Lines(vc.hcExact, `${y} ~ ${xStr}`),
        ``,
        `# Diagnostics`,
        `fixest::etable(fit)`,
        `lmtest::bptest(lm(${y} ~ ${xStr}, data = df))  # Breusch-Pagan`,
        // vif() errors on a single-regressor model ("fewer than 2 terms").
        ...(nReg >= 2 ? [`car::vif(lm(${y} ~ ${xStr}, data = df))         # VIF`] : []),
      ].join("\n");

    case "WLS": {
      const w = weightCol ? rName(weightCol) : null;
      if (!w) {
        return [
          `# ── WLS ──────────────────────────────────────────────────────────────`,
          `# WARNING: no weight column supplied; falling back to OLS`,
          ...(vc.note ? [vc.note] : []),
          `fit <- fixest::feols(${y} ~ ${xStr}, data = df, vcov = ${vc.arg})`,
          ...rHC23Lines(vc.hcExact, `${y} ~ ${xStr}`),
          `fixest::etable(fit)`,
        ].join("\n");
      }
      return [
        `# ── WLS (weighted least squares) ─────────────────────────────────────`,
        `# Weights: ${w}`,
        ...(vc.note ? [vc.note] : []),
        `fit <- fixest::feols(${y} ~ ${xStr}, data = df, weights = ~${w}, vcov = ${vc.arg})`,
        ...rHC23Lines(vc.hcExact, `${y} ~ ${xStr}`, `df$${w}`),
        ``,
        `# Diagnostics`,
        `fixest::etable(fit)`,
      ].join("\n");
    }

    case "FE": {
      // N-way FE: spec.feCols (Task 3-5) generalizes absorption beyond entity-only.
      // Fallback preserves the pre-existing entity-only default byte-for-byte.
      const feColsFE = feCols?.length ? feCols : [entityCol].filter(Boolean);
      const feClauseFE = feColsFE.map(rName).join(" + ");
      return [
        `# ── Fixed Effects (within estimator) ────────────────────────────────`,
        ...(vc.note ? [vc.note] : []),
        `fit_fe <- fixest::feols(${y} ~ ${xStr} | ${feClauseFE}, data = df, vcov = ${vc.arg})`,
        ...rPanelHC23Lines(vc.hcExact, `${y} ~ ${xStr}`, feColsFE),
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
    }

    case "FD":
      return [
        `# ── First Differences ────────────────────────────────────────────────`,
        `fit_fd <- plm::plm(${y} ~ ${xStr}, data = df,`,
        `  index = c(${rStr(entityCol)}, ${rStr(timeCol)}),`,
        `  model = "fd")`,
        ``,
        `summary(fit_fd)`,
        ...rPlmVcovLines(seType, "fit_fd", { clusterVar }),
      ].join("\n");

    case "2SLS": {
      const endog  = xVars.map(fmtR).join(" + ") || "endog_var";
      const ctrls  = wVars.map(fmtR).join(" + ");
      const instrs = zVars.map(rName).join(" + ") || "instrument";
      // fixest syntax: y ~ exog_controls | endog ~ EXCLUDED instruments.
      // The exogenous controls are included as their own instruments
      // automatically — do NOT repeat them in the instrument list.
      const iv_rhs = instrs;
      return [
        `# ── 2SLS / IV ────────────────────────────────────────────────────────`,
        ...(vc.note ? [vc.note] : []),
        `fit <- fixest::feols(${y} ~ ${ctrls || "1"} | ${endog} ~ ${iv_rhs}, data = df, vcov = ${vc.arg})`,
        // fixest has no HC2/HC3; AER::ivreg does support sandwich::vcovHC exactly.
        ...(vc.hcExact ? [
          ``,
          `# Exact ${vc.hcExact} standard errors (these are the SE Litux reports)`,
          `fit_iv <- AER::ivreg(${y} ~ ${[endog, ctrls].filter(Boolean).join(" + ")} |`,
          `  ${[iv_rhs, ctrls].filter(Boolean).join(" + ")}, data = df)`,
          `lmtest::coeftest(fit_iv, vcov. = sandwich::vcovHC(fit_iv, type = "${vc.hcExact}"))`,
        ] : []),
        ``,
        `# First-stage diagnostics`,
        `fixest::fitstat(fit, ~ ivwald)   # Wald F for instrument strength`,
        `fixest::etable(fit)`,
      ].join("\n");
    }

    case "DiD": {
      const post  = rName(postVar);
      const treat = rName(treatVar);
      const ctrls = wVars.map(fmtR).join(" + ");
      const rhs   = ctrls ? `${post} * ${treat} + ${ctrls}` : `${post} * ${treat}`;
      return [
        `# ── 2×2 Difference-in-Differences ───────────────────────────────────`,
        `# DiD interaction term: post × treat`,
        ...(vc.note ? [vc.note] : []),
        `fit <- fixest::feols(${y} ~ ${rhs}, data = df, vcov = ${vc.arg})`,
        ...rHC23Lines(vc.hcExact, `${y} ~ ${rhs}`),
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
      const ctrls = wVars.length ? " + " + wVars.map(fmtR).join(" + ") : "";
      // N-way FE: spec.feCols (Task 3-5) generalizes absorption beyond entity+time.
      // Fallback preserves the pre-existing entity+time default byte-for-byte.
      const feColsTWFE = feCols?.length ? feCols : [entityCol, timeCol].filter(Boolean);
      const feClauseTWFE = feColsTWFE.map(rName).join(" + ");
      return [
        `# ── Two-Way Fixed Effects DiD ────────────────────────────────────────`,
        ...(vc.note ? [vc.note] : []),
        `fit <- fixest::feols(${y} ~ ${treat}${ctrls} | ${feClauseTWFE},`,
        `  data = df, vcov = ${vc.arg})`,
        ...rPanelHC23Lines(vc.hcExact, `${y} ~ ${treat}${ctrls}`, feColsTWFE),
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
      const pOrd = Math.max(1, Math.round(polyOrder ?? 1));
      return [
        `# ── Sharp RDD ────────────────────────────────────────────────────────`,
        `# Centre running variable at cutoff`,
        `df <- df |> mutate(${rv}_c = ${rv} - ${c0})`,
        ``,
        h
          ? `fit <- rdrobust::rdrobust(y = df$${y}, x = df$${rv}, c = ${c0}, h = ${h}, kernel = ${rStr(kernR)}, p = ${pOrd})`
          : `fit <- rdrobust::rdrobust(y = df$${y}, x = df$${rv}, c = ${c0}, kernel = ${rStr(kernR)}, p = ${pOrd})`,
        ``,
        `summary(fit)`,
        `rdrobust::rdplot(y = df$${y}, x = df$${rv}, c = ${c0}, p = ${pOrd})`,
      ].join("\n");
    }

    case "Logit":
    case "Probit": {
      const link   = type === "Logit" ? "logit" : "probit";
      const ctrls  = wVars.map(fmtR).join(" + ");
      const regs   = xVars.map(fmtR).join(" + ");
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

    case "LSDV": {
      const ec = rName(entityCol);
      // N-way FE: spec.feCols (Task 3-5) generalizes absorption beyond entity(+time).
      // Fallback preserves the pre-existing entity(+time) default byte-for-byte.
      const feColsLSDV = feCols?.length ? feCols : [entityCol, timeCol].filter(Boolean);
      const feClauseLSDV = feColsLSDV.map(rName).join(" + ");
      return [
        `# ── Panel LSDV (Least Squares Dummy Variables) ───────────────────────`,
        `# LSDV is numerically equivalent to within (FE) estimation`,
        ...(vc.note ? [vc.note] : []),
        `fit <- fixest::feols(${y} ~ ${xStr} | ${feClauseLSDV}, data = df, vcov = ${vc.arg})`,
        ...rPanelHC23Lines(vc.hcExact, `${y} ~ ${xStr}`, feColsLSDV),
        ``,
        `fixest::etable(fit)`,
        ``,
        `# Unit fixed effects (intercepts)`,
        `fixest::fixef(fit)`,
      ].join("\n");
    }

    case "FuzzyRDD": {
      const rv    = rName(runningVar);
      const c0    = Number(cutoff).toFixed(6);
      const h     = bandwidth ? Number(bandwidth).toFixed(6) : null;
      const kernR = kernel === "epanechnikov" ? "epanechnikov"
                  : kernel === "uniform"      ? "uniform"
                  : "triangular";
      const dVar  = rName(treatVar ?? "D");
      const covOpt = wVars.length
        ? `, covs = df[, c(${wVars.map(v => `"${rName(v)}"`).join(", ")})]` : "";
      return [
        `# ── Fuzzy RDD (IV-LATE via rdrobust) ─────────────────────────────────`,
        `fit <- rdrobust::rdrobust(y = df$${y}, x = df$${rv}, fuzzy = df$${dVar},`,
        h
          ? `  c = ${c0}, h = ${h}, kernel = ${rStr(kernR)}, p = ${Math.max(1, Math.round(polyOrder ?? 1))}${covOpt})`
          : `  c = ${c0}, kernel = ${rStr(kernR)}, p = ${Math.max(1, Math.round(polyOrder ?? 1))}${covOpt})`,
        ``,
        `summary(fit)  # LATE = tau_SRD for compliers`,
        `rdrobust::rdplot(y = df$${y}, x = df$${rv}, c = ${c0})`,
        ``,
        `# First-stage: does being above the cutoff predict treatment take-up?`,
        `df$_Z <- as.integer(df$${rv} >= ${c0})`,
        h ? `df_bw <- df[abs(df$${rv} - ${c0}) <= ${h}, ]` : `df_bw <- df  # set bandwidth filter`,
        `fs <- lm(${dVar} ~ _Z, data = df_bw)`,
        `cat("First-stage F:", summary(fs)$fstatistic[1], "\\n")`,
      ].join("\n");
    }

    case "SpatialRDD": {
      // Keele & Titiunik 2015 geographic RD via rdrobust on a signed running variable.
      // The user supplies an unsigned distance-to-boundary column and a 0/1 treated-side
      // indicator; we build d̃ = (2D − 1) * |dist| and treat the cutoff as 0.
      const distR  = rName(distCol ?? runningVar);
      const trtR   = rName(treatmentCol ?? treatVar);
      const h      = bandwidth ? Number(bandwidth).toFixed(6) : null;
      const kernR  = kernel === "epanechnikov" ? "epanechnikov"
                   : kernel === "uniform"      ? "uniform"
                   : "triangular";
      const covOpt = wVars.length
        ? `, covs = df[, c(${wVars.map(v => `"${rName(v)}"`).join(", ")})]` : "";
      const pOrdS = Math.max(1, Math.round(polyOrder ?? 1));
      return [
        `# ── Spatial RD (Keele & Titiunik 2015) ──────────────────────────────`,
        `# Build signed running variable: positive on treated side, cutoff = 0.`,
        `df <- df |> dplyr::mutate(.signed_dist = (2 * ${trtR} - 1) * abs(${distR}))`,
        ``,
        h
          ? `fit <- rdrobust::rdrobust(y = df$${y}, x = df$.signed_dist, c = 0, h = ${h}, kernel = ${rStr(kernR)}, p = ${pOrdS}${covOpt})`
          : `fit <- rdrobust::rdrobust(y = df$${y}, x = df$.signed_dist, c = 0, kernel = ${rStr(kernR)}, p = ${pOrdS}${covOpt})`,
        ``,
        `summary(fit)  # LATE at the boundary`,
        `rdrobust::rdplot(y = df$${y}, x = df$.signed_dist, c = 0, p = ${pOrdS})`,
      ].join("\n");
    }

    case "EventStudy": {
      const ec    = rName(entityCol);
      const tc    = rName(timeCol);
      const ctrls = wVars.map(fmtR).join(" + ");
      const ctrlStr = ctrls ? ` + ${ctrls}` : "";
      // N-way FE: spec.feCols (Task 3-5) generalizes absorption beyond entity+time.
      // Fallback preserves the pre-existing entity+time default byte-for-byte.
      const feColsES = feCols?.length ? feCols : [entityCol, timeCol].filter(Boolean);
      const feClauseES = feColsES.map(rName).join(" + ");
      return [
        `# ── Event Study (relative-time dummies via fixest) ───────────────────`,
        `# Replace 'treat_time' below with the column holding each unit's treatment year`,
        `library(fixest)`,
        ``,
        `df <- df |> dplyr::mutate(rel_time = ${tc} - treat_time)`,
        ``,
        `# Estimate — ref = -1 (last pre-period)`,
        ...(vc.note ? [vc.note] : []),
        `fit <- fixest::feols(${y} ~ i(rel_time, ref = -1)${ctrlStr} | ${feClauseES},`,
        `  data = df, vcov = ${vc.arg})`,
        ``,
        `fixest::iplot(fit, main = "Event Study")   # coefficient plot with CI`,
        `fixest::etable(fit)`,
        ``,
        `# Pre-trend Wald test (joint significance of all pre-period coefficients)`,
        `fixest::wald(fit, keep = "rel_time::-[2-9]$|rel_time::-[0-9]{2,}")`,
      ].join("\n");
    }

    case "SyntheticControl": {
      const ec   = rName(entityCol ?? "unit");
      const tc   = rName(timeCol   ?? "time");
      const y2   = rName(yVar);
      const tu   = treatedUnit ?? "TreatedUnit";
      const tt   = treatTime   != null ? Number(treatTime) : "TREAT_TIME";
      const preds = xVars.length
        ? `c(${xVars.map(v => `"${rName(v)}"`).join(", ")})`
        : `"${y2}"   # no explicit predictors — using outcome mean`;
      return [
        `# ── Synthetic Control (Synth package) ───────────────────────────────`,
        `# Install: install.packages("Synth")`,
        `library(Synth)`,
        ``,
        `# Synth requires a numeric unit ID — create one while preserving names`,
        `df$unit_id <- as.numeric(factor(df$${ec}))`,
        `treated_id <- df$unit_id[df$${ec} == "${tu}"][1]`,
        `donor_ids  <- setdiff(unique(df$unit_id), treated_id)`,
        `time_range <- sort(unique(df$${tc}))`,
        `pre_range  <- time_range[time_range < ${tt}]`,
        ``,
        `dataprep.out <- dataprep(`,
        `  foo                   = as.data.frame(df),`,
        `  predictors            = ${preds},`,
        `  predictors.op         = "mean",`,
        `  time.predictors.prior = pre_range,`,
        `  dependent             = "${y2}",`,
        `  unit.variable         = "unit_id",`,
        `  unit.names.variable   = "${ec}",`,
        `  time.variable         = "${tc}",`,
        `  treatment.identifier  = treated_id,`,
        `  controls.identifier   = donor_ids,`,
        `  time.optimize.ssr     = pre_range,`,
        `  time.plot             = time_range`,
        `)`,
        ``,
        `synth.out    <- synth(dataprep.out)`,
        `synth.tables <- synth.tab(dataprep.res = dataprep.out, synth.res = synth.out)`,
        ``,
        `# Donor weights`,
        `print(synth.tables$tab.w)`,
        ``,
        `# Path plot: treated vs synthetic`,
        `path.plot(`,
        `  synth.res    = synth.out,`,
        `  dataprep.res = dataprep.out,`,
        `  tr.intake    = ${tt},`,
        `  Ylab         = "${y2}",`,
        `  Xlab         = "${tc}",`,
        `  Legend       = c("${tu}", "Synthetic ${tu}")`,
        `)`,
        ``,
        `# Gap plot: treated minus synthetic`,
        `gaps.plot(`,
        `  synth.res    = synth.out,`,
        `  dataprep.res = dataprep.out,`,
        `  tr.intake    = ${tt},`,
        `  Ylab         = "Gap in ${y2}",`,
        `  Xlab         = "${tc}"`,
        `)`,
      ].join("\n");
    }

    case "GMM": {
      const endog  = wVars.map(rName).join(", ");
      const exog   = xVars.map(fmtR).join(" + ") || "1";
      const instrs = [...xVars, ...zVars].map(rName).join(", ");
      return [
        `# ── Two-Step Efficient GMM ───────────────────────────────────────────`,
        `# Install: install.packages("gmm")`,
        `library(gmm)`,
        ``,
        `# Structural: ${y} ~ exogenous + endogenous`,
        `# Instruments: exogenous + excluded`,
        `fit <- gmm::gmm(${y} ~ ${exog}${wVars.length ? ` + ${wVars.map(fmtR).join(" + ")}` : ""},`,
        `  ~ ${instrs || "1"},`,
        // gmm::gmm's vcov vocabulary is "iid" / "MDS" / "HAC" — not sandwich's.
        // "MDS" is the martingale-difference (heteroskedasticity-robust) weight
        // matrix, which is the closest counterpart to the HC family here.
        `  data = df, vcov = ${(() => {
          const s = (seType || "classical").toLowerCase();
          if (s === "classical") return `"iid"`;
          if (s === "hac") return `"HAC"`;
          return `"MDS"`;
        })()})`,
        ``,
        `summary(fit)`,
        `coef(fit)`,
      ].join("\n");
    }

    case "LIML": {
      const endog  = wVars.map(rName).join(" + ");
      const exog   = xVars.map(fmtR).join(" + ") || "1";
      const instrs = [...xVars, ...zVars].map(rName).join(" + ");
      return [
        `# ── Limited Information Maximum Likelihood (LIML) ────────────────────`,
        `# Install: install.packages("ivreg")`,
        `library(ivreg)`,
        ``,
        `fit <- ivreg::ivreg(${y} ~ ${exog}${wVars.length ? ` + ${endog}` : ""} | ${instrs || "1"},`,
        `  data = df, method = "liml")`,
        ``,
        `summary(fit, diagnostics = TRUE)`,
        `# κ (kappa): 1 = just-identified (= 2SLS); > 1 = over-identified`,
        `cat("kappa:", fit$kappa, "\\n")`,
      ].join("\n");
    }

    case "Poisson": {
      const ctrls = wVars.map(fmtR).join(" + ");
      const regs  = xVars.map(fmtR).join(" + ");
      const rhs   = [regs, ctrls].filter(Boolean).join(" + ") || "1";
      return [
        `# ── Poisson regression (count GLM, log link) ─────────────────────────`,
        `library(sandwich)`,
        `library(lmtest)`,
        ``,
        `fit <- glm(${y} ~ ${rhs},`,
        `  data   = df,`,
        `  family = poisson(link = "log"))`,
        ``,
        `# Coefficients with the SE type selected in Litux`,
        ...rGlmVcovLines(seType, "fit", { clusterVar, clusterVar2 }),
        ``,
        `# Incidence Rate Ratios (exp(beta)) with 95% CI`,
        `exp(cbind(IRR = coef(fit), confint(fit)))`,
        ``,
        `# Overdispersion check: Pearson chi-sq / df (>> 1 suggests use NB or QMLE)`,
        `cat("Pearson chi-sq / df:", sum(residuals(fit, type = "pearson")^2) / fit$df.residual, "\\n")`,
        `cat("AIC:", AIC(fit), "\\n")`,
        `cat("BIC:", BIC(fit), "\\n")`,
      ].join("\n");
    }

    case "PoissonFE": {
      const fes = (feCols && feCols.length ? feCols : [entityCol ?? "entity"]).map(rName);
      const feStr = fes.join(" + ");
      const cov = xVars.map(fmtR).join(" + ") || "1";
      return [
        `# ── Poisson FE (PPML with ${fes.length}-way fixed effects) ───────────────────`,
        `library(fixest)`,
        ``,
        ...(vc.note ? [vc.note] : []),
        `fit <- fixest::fepois(${y} ~ ${cov} | ${feStr}, data = df, vcov = ${vc.arg})`,
        ``,
        `fixest::etable(fit)`,
        `cat("Incidence Rate Ratios:\\n")`,
        `print(exp(coef(fit)))`,
        ``,
        `# Overdispersion check: Pearson chi-sq / df`,
        `pearson_resid <- residuals(fit, type = "pearson")`,
        `cat("Pearson chi-sq / df:", sum(pearson_resid^2) / fit$nobs, "\\n")`,
      ].join("\n");
    }

    case "NegBinFE": {
      const fes = (feCols && feCols.length ? feCols : [entityCol ?? "entity"]).map(rName);
      const feTerms = fes.map(f => `factor(${f})`);
      const cov = xVars.map(fmtR).filter(Boolean);
      const rhs = [...cov, ...feTerms].join(" + ") || "1";
      const offsetArg = offsetCol ? `,\n  offset = log(${rName(offsetCol)})` : "";
      return [
        `# Negative Binomial FE (NB2 with fixed-effect dummies)`,
        `library(MASS)`,
        ``,
        `fit <- MASS::glm.nb(${y} ~ ${rhs},`,
        `  data = df${offsetArg})`,
        ``,
        `summary(fit)`,
        `cat("Dispersion alpha:", 1 / fit$theta, "\\n")`,
        `cat("Incidence Rate Ratios:\\n")`,
        `print(exp(coef(fit)))`,
      ].join("\n");
    }

    case "SunAbraham": {
      const fes  = (feCols && feCols.length ? feCols : [entityCol ?? "unit", periodCol ?? "period"]).map(rName);
      const feStr = fes.join(" + ");
      const coh  = rName(cohortCol ?? "cohort");
      const per  = rName(periodCol ?? "period");
      const ctrls = xVars.map(fmtR).concat(wVars.map(fmtR)).filter(Boolean);
      const rhs  = [`sunab(${coh}, ${per})`, ...ctrls].join(" + ");
      const cl   = fes[0];
      const refNote = (refPeriod != null && Number(refPeriod) !== -1)
        ? ` # NOTE: EconSolver used reference relative period ${refPeriod}; sunab() default is -1.`
        : "";
      return [
        `# ── Sun & Abraham (2021) event study over Poisson PPML ───────────────`,
        `# Interaction-weighted estimator. Never-treated / not-yet-treated cohorts`,
        `# form the control (EconSolver control convention: "${controlMode ?? "auto"}").`,
        `# Never-treated units must carry a large sentinel cohort (e.g. 10000) or NA.`,
        `library(fixest)`,
        ``,
        `fit <- fixest::fepois(${y} ~ ${rhs} | ${feStr},`,
        `  data    = df,`,
        `  cluster = ~${cl})${refNote}`,
        ``,
        `# Aggregated per-relative-period ATTs (IW weights) + joint tests`,
        `summary(fit)`,
        `fixest::etable(fit)`,
        ``,
        `# Event-study plot of the aggregated ATTs`,
        `fixest::iplot(fit, main = "Sun & Abraham event study", xlab = "Relative period")`,
      ].join("\n");
    }

    case "McCrary": {
      const rv = rName(runningVar ?? "running");
      const c0 = cutoff ?? 0;
      return [
        `# ── McCrary / Cattaneo-Jansson-Ma Density Test ───────────────────────`,
        `# Tests for manipulation of the running variable at the cutoff.`,
        `# Install: install.packages("rddensity")`,
        `library(rddensity)`,
        ``,
        `fit <- rddensity::rddensity(X = df$${rv}, c = ${c0})`,
        `summary(fit)`,
        ``,
        `# Density plot`,
        `rddensity::rdplotdensity(fit, df$${rv},`,
        `  xlabel = "${rv}", title = "McCrary Density Test (cutoff = ${c0})")`,
      ].join("\n");
    }

    case "CallawayCS": {
      // Callaway-Sant'Anna (2021) staggered DiD
      // Extract spec fields (from model.spec in the wrapped result)
      const { yVar: csY, treatCol, entityCol: csE, timeCol: csT, xVars: csXVars = [],
              compGroup = "nevertreated", csEstMethod = "dr", csAnticipation = 0 } = model;

      // Build xformla: if xVars empty or ["~1"], use ~1; else ~ X1 + X2 + ...
      const xformlaRhs = (csXVars && csXVars.length && !csXVars.includes("~1"))
        ? csXVars.map(rName).join(" + ")
        : "1";
      const xformla = `~${xformlaRhs}`;

      return [
        `# ── Callaway-Sant'Anna (2021) Staggered DiD ──────────────────────────`,
        `# Install: install.packages("did")`,
        `library(did)`,
        ``,
        `out <- att_gt(`,
        `  yname        = ${rStr(csY)},`,
        `  gname        = ${rStr(treatCol)},`,
        `  idname       = ${rStr(csE)},`,
        `  tname        = ${rStr(csT)},`,
        `  xformla      = ${xformla},`,
        `  data         = df,`,
        `  control_group = ${rStr(compGroup)},`,
        `  base_period  = "varying",`,
        `  anticipation = ${csAnticipation},`,
        `  est_method   = ${rStr(csEstMethod)}`,
        `)`,
        ``,
        `summary(out)`,
        ``,
        `# Aggregated ATTs by cohort (group)`,
        `aggte(out, type = "group")`,
        ``,
        `# Aggregated ATTs by event (relative period)`,
        `aggte(out, type = "dynamic")`,
        ``,
        `# Calendar time aggregation`,
        `aggte(out, type = "calendar")`,
        ``,
        `# Simple overall ATT`,
        `aggte(out, type = "simple")`,
      ].join("\n");
    }

    default:
      return `# Unknown model type: ${type}`;
  }
}

// ─── MAIN EXPORT ─────────────────────────────────────────────────────────────
export function generateRScript(config) {
  const {
    filename       = "dataset.csv",
    pipeline       = [],
    model          = {},
    auditTrail     = null,
    dataDictionary = null,
    dataLoadOpts   = null,
    allDatasets    = {},
  } = config;

  const baseName = filename.replace(/\.[^.]+$/, "");
  const ts       = new Date().toISOString().slice(0, 10);
  const pkgs     = buildPackageList(model.type, pipeline, model.seType);

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
  lines.push(`# ── 1. Load data ─────────────────────────────────────────────────────────`);
  lines.push(buildRLoadLine(filename, dataLoadOpts));
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
      lines.push(transpileStep(step, "df", allDatasets));
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

// ─── MULTI-MODEL HELPERS ───────────────────────────────────────────────────────

/**
 * Returns "map" when all configs share the same estimator spec AND all carry
 * subsetFilters metadata (i.e. they came from runAllSubsets). Otherwise "separate".
 */
function detectMapPattern(configs) {
  if (configs.length < 2) return "separate";
  const allHaveMeta = configs.every(c => Array.isArray(c.subsetFilters));
  if (!allHaveMeta) return "separate";
  const first = configs[0].model;
  const xKey  = arr => JSON.stringify([...(arr ?? [])].sort());
  const sameSpec = configs.every(c =>
    c.model.type  === first.type &&
    c.model.yVar  === first.yVar &&
    xKey(c.model.xVars) === xKey(first.xVars)
  );
  return sameSpec ? "map" : "separate";
}

/** Translate a subset's filter array to an R dplyr::filter() expression, or null for full sample. */
function subsetFiltersToR(filters) {
  if (!filters?.length) return null;
  return filters.map(f => {
    const val = isNaN(Number(f.val)) ? `"${f.val}"` : f.val;
    return `${rName(f.col)} ${f.op} ${val}`;
  }).join(" & ");
}

// ─── MULTI-MODEL EXPORT ────────────────────────────────────────────────────────
// Generates an R script that estimates all models and outputs a joint modelsummary table.
//
// configs:        Array of { model: ModelConfig, label: string, subsetName?, subsetFilters? }
// dataDictionary: Record<string,string> | null
// opts:           { filename?: string, pipeline?: Step[] }
export function generateMultiModelRScript(configs = [], dataDictionary = null, opts = {}) {
  if (!configs.length) return "# No models provided.";

  const filename     = opts.filename ?? "dataset.csv";
  const pipeline     = opts.pipeline ?? [];
  const dataLoadOpts = opts.dataLoadOpts ?? null;
  const allDatasets  = opts.allDatasets ?? {};
  const ts = new Date().toISOString().slice(0, 10);
  const allTypes = [...new Set(configs.map(c => c.model?.type).filter(Boolean))];
  const pkgsSet = new Set(["dplyr", "tidyr", "readr", "fixest", "modelsummary", "lmtest", "car"]);
  allTypes.forEach(t => {
    if (t === "FE" || t === "FD") pkgsSet.add("plm");
    if (t === "RDD" || t === "FuzzyRDD" || t === "SpatialRDD") pkgsSet.add("rdrobust");
    if (t === "Logit" || t === "Probit") { pkgsSet.add("marginaleffects"); pkgsSet.add("pROC"); pkgsSet.add("lmtest"); }
  });
  if (pipeline.some(s => s.type === "dummy")) pkgsSet.add("fastDummies");
  if (pipeline.some(s => ["set_where", "replace", "str_splice"].includes(s.type))) pkgsSet.add("stringr");
  if (pipeline.some(s => ["date_parse","date_extract"].includes(s.type))) pkgsSet.add("lubridate");
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
  lines.push(buildRLoadLine(filename, dataLoadOpts));
  lines.push(``);

  if (pipeline.length) {
    lines.push(`# ── 2. Data pipeline ─────────────────────────────────────────────────────`);
    pipeline.forEach(step => {
      lines.push(transpileStep(step, "df", allDatasets));
    });
    lines.push(``);
  }

  if (dataDictionary && Object.keys(dataDictionary).length) {
    lines.push(`# ── Variable definitions ─────────────────────────────────────────────────`);
    Object.entries(dataDictionary).forEach(([k, v]) => lines.push(`# ${rName(k).padEnd(20)} ${v}`));
    lines.push(``);
  }

  const pattern = detectMapPattern(configs);

  if (pattern === "map") {
    // ── Same spec, different subsets → lapply pattern ────────────────────────
    lines.push(`# ── 3. Subsets + lapply ──────────────────────────────────────────────────`);
    const subsetEntries = configs.map(c => {
      const expr = subsetFiltersToR(c.subsetFilters);
      const rhs  = expr ? `df |> dplyr::filter(${expr})` : `df`;
      return `  ${rStr(c.subsetName ?? c.label)} = ${rhs}`;
    });
    lines.push(`subsets <- list(`);
    subsetEntries.forEach((e, i) => lines.push(e + (i < subsetEntries.length - 1 ? "," : "")));
    lines.push(`)`);
    lines.push(``);

    // Extract the fit call from the first config (strip assignment, swap df → s)
    const singleCode = transpileModel(configs[0].model ?? {});
    const fitCall    = singleCode
      .replace(/\b(fit|fit_fe|fit_fd)\s*<-\s*/, "")
      .replace(/\bdf\b/g, "s");
    lines.push(`results <- lapply(subsets, function(s) ${fitCall})`);
    lines.push(``);

    lines.push(`# ── 4. Joint output table ─────────────────────────────────────────────`);
    lines.push(
      `modelsummary::modelsummary(`,
      `  results,`,
      `  stars      = c("*" = 0.1, "**" = 0.05, "***" = 0.01),`,
      `  gof_omit   = "AIC|BIC|Log|F$",`,
      `  output     = "comparison_results.docx"`,
      `)`,
      ``
    );
  } else {
    // ── Different specs → one fit object per model ───────────────────────────
    lines.push(`# ── 3. Estimation (one fit object per model) ─────────────────────────────`);
    const fitNames = [];
    configs.forEach((c, i) => {
      const fitName = `fit_${i + 1}`;
      fitNames.push(fitName);
      lines.push(`# Model ${i+1}: ${c.label ?? c.model?.type}`);
      const modelCode = transpileModel(c.model ?? {});
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
  }

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
export function generateSubsetRScript({ filename = "dataset.csv", pipeline = [], perSubsetSteps = [], subsets = [], model = {}, dataDictionary = null, dataLoadOpts = null, allDatasets = {} } = {}) {
  const ts      = new Date().toISOString().slice(0, 10);
  const stem    = filename.replace(/\.[^.]+$/, "");
  const pkgs    = buildPackageList(model.type, [...pipeline, ...perSubsetSteps], model.seType);
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
  lines.push(buildRLoadLine(filename, dataLoadOpts));
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
      lines.push(transpileStep(step, "df", allDatasets));
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
function buildPackageList(modelType, pipeline, seType = "classical") {
  const pkgs = new Set(["dplyr", "tidyr", "readr", "fixest", "modelsummary"]);

  // HC2/HC3 are emitted as an lm()/ivreg() refit + sandwich::vcovHC, so those
  // packages must be in the install/library block or the script fails on line 1.
  const seLower = (seType || "classical").toLowerCase();
  if (seLower === "hc2" || seLower === "hc3") {
    pkgs.add("sandwich");
    pkgs.add("lmtest");
    if (modelType === "2SLS") pkgs.add("AER");
  }

  // Model-specific
  if (modelType === "FE" || modelType === "FD") pkgs.add("plm");
  if (modelType === "RDD" || modelType === "FuzzyRDD" || modelType === "SpatialRDD") { pkgs.add("rdrobust"); pkgs.delete("fixest"); pkgs.delete("modelsummary"); }
  if (modelType === "Logit" || modelType === "Probit") {
    pkgs.add("marginaleffects");
    pkgs.add("pROC");
    pkgs.add("lmtest");
    pkgs.delete("fixest");  // base R glm() — no fixest needed
  }
  if (modelType === "Poisson") {
    pkgs.add("sandwich");
    pkgs.add("lmtest");
    pkgs.delete("fixest");  // base R glm() — no fixest needed
  }
  if (modelType === "NegBinFE") {
    pkgs.add("MASS");
    pkgs.delete("fixest");
  }

  // Pipeline-specific
  pipeline.forEach(s => {
    if (s.type === "dummy")        pkgs.add("fastDummies");
    if (s.type === "quickclean")   pkgs.add("stringr");
    if (["set_where", "replace", "str_splice"].includes(s.type)) pkgs.add("stringr");
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
