// ─── ECON STUDIO · pipeline/stepTranslators.js ───────────────────────────────
// Per-step translation to R, Stata, and Python.
// Each exported function takes (step, dfName, allDatasets) and returns a string.
//
// allDatasets — optional map { id: { name, filename } } used to resolve join/
// append dataset names. When filename is present, a real load call is emitted
// (read_csv / read_dta / read_excel etc.); otherwise a placeholder is used.
//
// Design: pure functions, no React, no imports from UI.

// ─── SHARED HELPERS ──────────────────────────────────────────────────────────

function safeDatasetName(id, allDatasets) {
  return allDatasets?.[id]?.name ?? id;
}

// Returns the right-hand load line for join/append steps.
// Uses the actual filename when known; falls back to a placeholder.
export function rRightLoad(id, allDatasets) {
  const ds   = allDatasets?.[id];
  const name = (ds?.name ?? id).replace(/\s+/g, "_");
  const file = ds?.filename;
  if (!file) return `readr::read_csv("<path_to_${name}.csv>")`;
  const fl = file.toLowerCase();
  if (fl.endsWith(".dta"))               return `haven::read_dta("${file}")`;
  if (fl.endsWith(".xlsx") || fl.endsWith(".xls")) return `readxl::read_excel("${file}")`;
  return `readr::read_csv("${file}")`;
}

export function pyRightLoad(id, allDatasets) {
  const ds   = allDatasets?.[id];
  const name = (ds?.name ?? id).replace(/\s+/g, "_");
  const file = ds?.filename;
  if (!file) return `pd.read_csv("<path_to_${name}.csv>")`;
  const fl = file.toLowerCase();
  if (fl.endsWith(".dta"))               return `pd.read_stata("${file}")`;
  if (fl.endsWith(".xlsx") || fl.endsWith(".xls")) return `pd.read_excel("${file}")`;
  return `pd.read_csv("${file}")`;
}

export function stataRightLoad(id, allDatasets) {
  const ds   = allDatasets?.[id];
  const name = (ds?.name ?? id).replace(/\s+/g, "_");
  const file = ds?.filename;
  if (!file) return `import delimited "<path_to_${name}.csv>", clear`;
  const fl = file.toLowerCase();
  if (fl.endsWith(".dta")) return `use "${file}", clear`;
  return `import delimited "${file}", clear`;
}

// Split a comma-separated argument list, respecting nested parentheses/brackets.
function splitTopLevel(str, sep = ",") {
  const parts = [];
  let depth = 0, cur = "";
  for (const ch of str) {
    if (ch === "(" || ch === "[") depth++;
    else if (ch === ")" || ch === "]") depth--;
    else if (ch === sep && depth === 0) { parts.push(cur); cur = ""; continue; }
    cur += ch;
  }
  if (cur.trim()) parts.push(cur);
  return parts;
}

// ─── R HELPERS ───────────────────────────────────────────────────────────────

/** Wrap an identifier in backticks if it contains spaces / special chars */
function rName(c) {
  return /^[A-Za-z_][A-Za-z0-9_.]*$/.test(c) ? c : `\`${c}\``;
}
function rStr(s) { return `"${String(s).replace(/"/g, '\\"')}"`;  }
function rVec(arr) { return `c(${arr.map(rStr).join(", ")})`; }
function rNames(arr) { return arr.map(rName).join(", "); }

/**
 * Best-effort JS expression → R expression.
 * Handles: case_when, strict equality, JS logical ops, single-quoted strings,
 * Math.* prefixes. Passes everything else through (exp/log/sqrt/abs are same in R).
 * Returns null when expression contains untranslatable JS (arrow fn, template literal).
 */
export function jsExprToR(expr) {
  if (!expr) return null;
  const s = String(expr);
  // Untranslatable JS patterns → fall back to comment
  if (/=>|`/.test(s)) return null;

  let r = s;

  // case_when(c1, v1, c2, v2, ..., default) → dplyr::case_when(c1 ~ v1, ..., .default = last)
  r = r.replace(/\bcase_when\((.+)\)/s, (_, inner) => {
    const args = splitTopLevel(inner).map(a => a.trim());
    const pairs = [];
    for (let i = 0; i + 1 < args.length; i += 2) pairs.push(`${args[i]} ~ ${args[i + 1]}`);
    const hasDefault = args.length % 2 === 1;
    const def = hasDefault ? args[args.length - 1] : "NA";
    return `dplyr::case_when(${pairs.join(", ")}, .default = ${def})`;
  });

  // JS operators → R equivalents
  r = r.replace(/===/g, "==").replace(/!==/g, "!=")
       .replace(/&&/g, "&").replace(/\|\|/g, "|");

  // Single-quoted strings → double-quoted
  r = r.replace(/'([^']*)'/g, '"$1"');

  // Math.* → bare R functions
  r = r.replace(/\bMath\.(log|exp|sqrt|abs|round|floor|ceil|max|min|pow)\b/g, "$1");

  return r;
}

// Python keywords / module names that must NOT be wrapped in df["..."]
const PY_SKIP = new Set([
  "np", "pd", "True", "False", "None", "and", "or", "not", "in", "is", "nan",
]);

/**
 * Translate a single JS sub-expression to Python, wrapping bare identifiers
 * (not followed by '(') as df["identifier"] column references.
 */
function translatePyExpr(expr, dfName) {
  let r = String(expr).trim();

  // JS operator → Python
  r = r.replace(/===/g, "==").replace(/!==/g, "!=");
  r = r.replace(/&&/g, " and ").replace(/\|\|/g, " or ");

  // Single-quoted strings → double-quoted (before identifier scan)
  r = r.replace(/'([^']*)'/g, '"$1"');

  // Math.* → np.*
  r = r.replace(/\bMath\.(log|exp|sqrt|abs|round|floor|ceil|max|min)\b/g, "np.$1");

  // Common math functions → numpy (only when followed by '(')
  const mathFns = ["exp", "log", "log10", "log2", "sqrt", "abs", "round", "floor", "ceil"];
  for (const fn of mathFns) {
    r = r.replace(new RegExp(`\\b${fn}\\b(?=\\s*\\()`, "g"), `np.${fn}`);
  }

  // Wrap bare identifiers in df["..."]:
  // - must start with letter/underscore
  // - must NOT be followed by '(' (function call) or '"' (already inside df["..."])
  // - must NOT be in PY_SKIP or look like a numpy-prefixed token
  r = r.replace(/\b([A-Za-z_][A-Za-z0-9_]*)\b(?!\s*[("])/g, (match) => {
    if (PY_SKIP.has(match)) return match;
    return `${dfName}["${match}"]`;
  });

  return r;
}

/**
 * Translate a scalar JS value (string literal or expression) to a Python literal.
 */
function translatePyVal(v) {
  const t = v.trim();
  // Single-quoted string literal → double-quoted Python string
  if (/^'[^']*'$/.test(t)) return `"${t.slice(1, -1)}"`;
  // Already a number → pass through
  if (/^-?\d+(\.\d+)?$/.test(t)) return t;
  // Otherwise translate as expression
  return t.replace(/'([^']*)'/g, '"$1"');
}

/**
 * Best-effort JS expression → Python (pandas mutate context).
 * Translates case_when → np.select and wraps bare identifiers as df["col"].
 * Falls back to null only for truly untranslatable JS (arrow fn, template literal).
 */
export function jsExprToPython(expr, dfName = "df") {
  if (!expr) return null;
  const s = String(expr);
  if (/=>|`/.test(s)) return null;

  // case_when(c1, v1, c2, v2, ..., default)
  if (/\bcase_when\s*\(/.test(s)) {
    const inner = s.replace(/^\s*case_when\s*\(/, "").replace(/\)\s*$/, "");
    const args = splitTopLevel(inner).map(a => a.trim());
    const conds = [], vals = [];
    for (let i = 0; i + 1 < args.length; i += 2) {
      conds.push(translatePyExpr(args[i], dfName));
      vals.push(translatePyVal(args[i + 1]));
    }
    const def = args.length % 2 === 1 ? translatePyVal(args[args.length - 1]) : "np.nan";
    return `np.select(\n    [${conds.join(", ")}],\n    [${vals.join(", ")}],\n    default=${def}\n)`;
  }

  // General expression: translate and wrap identifiers
  return translatePyExpr(s, dfName);
}

/**
 * Best-effort JS expression → Stata.
 * Translates case_when → nested cond(), JS operators → Stata, Math.* → Stata fns.
 * Column names in Stata are bare identifiers (no df["..."] wrapping needed).
 * Falls back to null only for truly untranslatable JS (arrow fn, template literal).
 */
export function jsExprToStata(expr) {
  if (!expr) return null;
  const s = String(expr);
  if (/=>|`/.test(s)) return null;

  // case_when(c1, v1, c2, v2, ..., default) → nested cond(c1, v1, cond(c2, v2, ...))
  if (/\bcase_when\s*\(/.test(s)) {
    const inner = s.replace(/^\s*case_when\s*\(/, "").replace(/\)\s*$/, "");
    const args = splitTopLevel(inner).map(a => a.trim().replace(/'([^']*)'/g, '"$1"'));
    const hasDefault = args.length % 2 === 1;
    const def = hasDefault ? args[args.length - 1] : `""`;
    let result = def;
    for (let i = args.length - (hasDefault ? 3 : 2); i >= 0; i -= 2) {
      result = `cond(${args[i]}, ${args[i + 1]}, ${result})`;
    }
    return result;
  }

  // General expression: translate common JS patterns to Stata equivalents.
  // Stata column references are bare identifiers — no wrapping needed.
  let r = s;

  // JS strict equality / logical ops → Stata
  r = r.replace(/===/g, "==").replace(/!==/g, "!=");
  r = r.replace(/&&/g, " & ").replace(/\|\|/g, " | ");

  // Single-quoted strings → double-quoted
  r = r.replace(/'([^']*)'/g, '"$1"');

  // Math.* → Stata functions
  r = r.replace(/\bMath\.log\b/g, "ln").replace(/\bMath\.exp\b/g, "exp")
       .replace(/\bMath\.sqrt\b/g, "sqrt").replace(/\bMath\.abs\b/g, "abs")
       .replace(/\bMath\.round\b/g, "round").replace(/\bMath\.floor\b/g, "floor")
       .replace(/\bMath\.ceil\b/g, "ceil");

  // JS log() → Stata ln() (natural log; Stata accepts log() but ln() is canonical)
  r = r.replace(/\blog\b(?=\s*\()/g, "ln");

  return r;
}

// ─── STATA HELPERS ────────────────────────────────────────────────────────────

/** Stata variable names: strip backticks, quote with spaces (we can't actually
 *  have spaces in Stata varnames, so we just pass through and let the user fix) */
function stVar(c) { return c.replace(/`/g, ""); }

// ─── PYTHON HELPERS ───────────────────────────────────────────────────────────

function pyCol(c) { return `"${String(c).replace(/"/g, '\\"')}"`; }
function pyStr(s) { return `"${String(s).replace(/"/g, '\\"')}"`; }

// ─────────────────────────────────────────────────────────────────────────────
// toR
// ─────────────────────────────────────────────────────────────────────────────

export function toR(step, df = "df", allDatasets = {}) {
  const col = step.col ? rName(step.col) : null;
  const nn  = step.nn  ? rName(step.nn)  : null;

  switch (step.type) {

    case "rename":
      return `${df} <- ${df} |> rename(${rName(step.newName)} = ${rName(step.col)})`;

    case "drop":
      return `${df} <- ${df} |> select(-${col})`;

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
      return `${df} <- ${df} |> filter(${opMap[step.op] ?? "TRUE"})`;
    }

    case "drop_na": {
      const cols = step.cols?.length
        ? step.cols.map(rName).join(", ")
        : "everything()";
      return step.how === "all"
        ? `${df} <- ${df} |> filter(!if_all(c(${cols}), is.na))`
        : `${df} <- ${df} |> drop_na(${cols})`;
    }

    case "fill_na": {
      const stratMap = {
        mean:         `mean(${col}, na.rm = TRUE)`,
        median:       `median(${col}, na.rm = TRUE)`,
        mode:         `names(sort(table(${col}), decreasing = TRUE))[1]`,
        constant:     rStr(step.value ?? ""),
        forward_fill: null,
        backward_fill: null,
      };
      if (step.strategy === "forward_fill")
        return `${df} <- ${df} |> fill(${col}, .direction = "down")`;
      if (step.strategy === "backward_fill")
        return `${df} <- ${df} |> fill(${col}, .direction = "up")`;
      return `${df} <- ${df} |> mutate(${col} = ifelse(is.na(${col}), ${stratMap[step.strategy] ?? `mean(${col}, na.rm = TRUE)`}, ${col}))`;
    }

    case "fill_na_grouped": {
      const gc   = rName(step.groupCol);
      const fn   = step.strategy === "median" ? "median" : "mean";
      return [
        `${df} <- ${df} |>`,
        `  group_by(${gc}) |>`,
        `  mutate(${col} = ifelse(is.na(${col}), ${fn}(${col}, na.rm = TRUE), ${col})) |>`,
        `  ungroup()`,
      ].join("\n");
    }

    case "type_cast": {
      const castMap = { number: "as.numeric", string: "as.character", boolean: "as.integer" };
      return `${df} <- ${df} |> mutate(${col} = ${castMap[step.to] ?? "as.numeric"}(${col}))`;
    }

    case "quickclean": {
      const fnMap = { lower: "tolower", upper: "toupper", title: "stringr::str_to_title" };
      return `${df} <- ${df} |> mutate(${col} = ${fnMap[step.mode] ?? "tolower"}(${col}))`;
    }

    case "recode": {
      const map   = step.map ?? {};
      const cases = Object.entries(map)
        .map(([k, v]) => `  ${rStr(k)} ~ ${typeof v === "number" ? v : rStr(v)}`)
        .join(",\n");
      return `${df} <- ${df} |> mutate(${col} = dplyr::case_match(${col},\n${cases},\n  .default = ${col}\n))`;
    }

    case "normalize_cats": {
      const map   = step.map ?? {};
      const cases = Object.entries(map)
        .map(([k, v]) => `  ${rStr(k)} ~ ${rStr(v)}`)
        .join(",\n");
      return `${df} <- ${df} |> mutate(${col} = dplyr::case_match(${col},\n${cases},\n  .default = ${col}\n))`;
    }

    case "winz": {
      const lo  = Number(step.lo).toFixed(6);
      const hi  = Number(step.hi).toFixed(6);
      const out = nn && nn !== col ? nn : col;
      return `${df} <- ${df} |> mutate(${out} = pmin(pmax(${col}, ${lo}), ${hi}))`;
    }

    case "trim_outliers": {
      const lo = Number(step.lo).toFixed(6);
      const hi = Number(step.hi).toFixed(6);
      return `${df} <- ${df} |> filter(${col} >= ${lo} & ${col} <= ${hi})`;
    }

    case "flag_outliers": {
      if (step.method === "zscore") {
        const thr = step.threshold ?? 3;
        return [
          `${df} <- ${df} |> mutate(`,
          `  .z_tmp = (${col} - mean(${col}, na.rm = TRUE)) / sd(${col}, na.rm = TRUE),`,
          `  ${nn} = as.integer(abs(.z_tmp) > ${thr})`,
          `) |> select(-.z_tmp)`,
        ].join("\n");
      }
      // IQR default
      return [
        `${df} <- ${df} |> mutate(`,
        `  .q1 = quantile(${col}, 0.25, na.rm = TRUE),`,
        `  .q3 = quantile(${col}, 0.75, na.rm = TRUE),`,
        `  .iqr = .q3 - .q1,`,
        `  ${nn} = as.integer(${col} < .q1 - 1.5 * .iqr | ${col} > .q3 + 1.5 * .iqr)`,
        `) |> select(-.q1, -.q3, -.iqr)`,
      ].join("\n");
    }

    case "extract_regex": {
      let pattern;
      if (step.regex) {
        pattern = rStr(step.regex);
      } else if (step.locale === "comma") {
        pattern = rStr("[0-9]+(?:\\.[0-9]{3})*(?:,[0-9]+)?");
      } else {
        pattern = rStr("[0-9]+(?:,[0-9]{3})*(?:\\.[0-9]+)?");
      }
      return [
        `${df} <- ${df} |> mutate(`,
        `  ${nn} = as.numeric(stringr::str_extract(${col}, ${pattern}))`,
        `)`,
      ].join("\n");
    }

    case "ai_tr":
      return [
        `# ai_tr on "${step.col}" — AI-generated transformation`,
        `# JS: ${step.js}`,
        `# Translate to R manually`,
      ].join("\n");

    case "log":
      return `${df} <- ${df} |> mutate(${nn} = log(${col}))`;

    case "sq":
      return `${df} <- ${df} |> mutate(${nn} = ${col}^2)`;

    case "std": {
      const mu = Number(step.mu).toFixed(6);
      const sd = Number(step.sd).toFixed(6);
      return `${df} <- ${df} |> mutate(${nn} = (${col} - ${mu}) / ${sd})`;
    }

    case "dummy":
      return [
        `# One-hot encode ${step.col} (prefix: "${step.pfx}")`,
        `${df} <- fastDummies::dummy_cols(${df}, select_columns = ${rStr(step.col)}, remove_first_dummy = FALSE, remove_selected_columns = FALSE)`,
      ].join("\n");

    case "lag": {
      const ec = step.ec ? rName(step.ec) : null;
      const tc = step.tc ? rName(step.tc) : null;
      const n  = step.n ?? 1;
      if (ec && tc) {
        return [
          `${df} <- ${df} |>`,
          `  arrange(${ec}, ${tc}) |>`,
          `  group_by(${ec}) |>`,
          `  mutate(${nn} = dplyr::lag(${col}, n = ${n})) |>`,
          `  ungroup()`,
        ].join("\n");
      }
      return `${df} <- ${df} |> mutate(${nn} = dplyr::lag(${col}, n = ${n}))`;
    }

    case "lead": {
      const ec = step.ec ? rName(step.ec) : null;
      const tc = step.tc ? rName(step.tc) : null;
      const n  = step.n ?? 1;
      if (ec && tc) {
        return [
          `${df} <- ${df} |>`,
          `  arrange(${ec}, ${tc}) |>`,
          `  group_by(${ec}) |>`,
          `  mutate(${nn} = dplyr::lead(${col}, n = ${n})) |>`,
          `  ungroup()`,
        ].join("\n");
      }
      return `${df} <- ${df} |> mutate(${nn} = dplyr::lead(${col}, n = ${n}))`;
    }

    case "diff": {
      const ec = step.ec ? rName(step.ec) : null;
      const tc = step.tc ? rName(step.tc) : null;
      if (ec && tc) {
        return [
          `${df} <- ${df} |>`,
          `  arrange(${ec}, ${tc}) |>`,
          `  group_by(${ec}) |>`,
          `  mutate(${nn} = ${col} - dplyr::lag(${col}, n = 1)) |>`,
          `  ungroup()`,
        ].join("\n");
      }
      return `${df} <- ${df} |> mutate(${nn} = ${col} - dplyr::lag(${col}, n = 1))`;
    }

    case "ix":
      return `${df} <- ${df} |> mutate(${nn} = ${rName(step.c1)} * ${rName(step.c2)})`;

    case "did":
      return `${df} <- ${df} |> mutate(${nn} = ${rName(step.tc)} * ${rName(step.pc)})`;

    case "date_parse": {
      // When step.nn is set and different from step.col, create a new column (e.g. Date_iso)
      const outCol = (step.nn && step.nn !== step.col) ? rName(step.nn) : col;
      return `${df} <- ${df} |> mutate(${outCol} = lubridate::parse_date_time(${col}, orders = c("ymd", "dmy", "mdy")))`;
    }

    case "date_extract": {
      const parts = step.parts ?? [];
      const lines = parts.map(p => {
        const out = rName(step.names?.[p] ?? `${step.col}_${p}`);
        if (p === "year")      return `  ${out} = lubridate::year(${col})`;
        if (p === "month")     return `  ${out} = lubridate::month(${col})`;
        if (p === "dow")       return `  ${out} = lubridate::wday(${col}) - 1`;
        if (p === "isweekend") return `  ${out} = as.integer(lubridate::wday(${col}) %in% c(1, 7))`;
        return null;
      }).filter(Boolean);
      return lines.length
        ? `${df} <- ${df} |> mutate(\n${lines.join(",\n")}\n)`
        : `# date_extract: no parts specified`;
    }

    case "mutate": {
      const rExpr = jsExprToR(step.expr);
      if (rExpr) {
        return `${df} <- ${df} |> mutate(${nn} = ${rExpr})`;
      }
      return [
        `# mutate: ${step.nn} = ${step.expr}`,
        `# NOTE: expression uses JS syntax — translate to R manually`,
        `# ${df} <- ${df} |> mutate(${nn} = <R expression>)`,
      ].join("\n");
    }

    case "arrange": {
      const dir = step.dir === "desc" ? `desc(${rName(step.col)})` : rName(step.col);
      return `${df} <- ${df} |> arrange(${dir})`;
    }

    case "group_summarize": {
      const by   = (step.by ?? []).map(rName).join(", ");
      const fnMap = { mean:"mean", sum:"sum", count:"n", min:"min", max:"max", sd:"sd", median:"median" };
      const aggs = (step.aggs ?? []).map(a => {
        const fn = fnMap[a.fn] ?? a.fn;
        return a.fn === "count"
          ? `    ${rName(a.nn)} = n()`
          : `    ${rName(a.nn)} = ${fn}(${rName(a.col)}, na.rm = TRUE)`;
      }).join(",\n");
      return [
        `${df} <- ${df} |>`,
        `  group_by(${by}) |>`,
        `  summarise(\n${aggs},\n    .groups = "drop"\n  )`,
      ].join("\n");
    }

    case "pivot_longer": {
      const cols    = step.cols?.length ? rVec(step.cols) : "everything()";
      const namesTo = rStr(step.namesTo ?? "name");
      const valTo   = rStr(step.valuesTo ?? "value");
      const idCols  = step.idCols?.length ? `\n  id_cols = ${rVec(step.idCols)},` : "";
      return `${df} <- tidyr::pivot_longer(${df},${idCols}\n  cols = ${cols},\n  names_to = ${namesTo},\n  values_to = ${valTo}\n)`;
    }

    case "factor_interactions": {
      const cont = rName(step.contCol);
      const dummies = (step.dummyCols ?? []).map(d => {
        const pfx = step.prefix || `${step.contCol}_x_`;
        const out = rName(`${pfx}${d}`);
        return `  ${out} = ${cont} * ${rName(d)}`;
      }).join(",\n");
      return dummies
        ? `${df} <- ${df} |> mutate(\n${dummies}\n)`
        : `# factor_interactions: no dummy columns specified`;
    }

    case "join": {
      const how       = step.how === "inner" ? "inner_join" : "left_join";
      const rightName = safeDatasetName(step.rightId, allDatasets);
      return [
        `# Load right dataset: "${rightName}"`,
        `right_df <- ${rRightLoad(step.rightId, allDatasets)}`,
        // Litux's join is a first-match LOOKUP — dedup right by key so dplyr
        // reproduces the same row count (no many-to-many expansion).
        `right_df <- dplyr::distinct(right_df, ${rStr(step.rightKey)}, .keep_all = TRUE)  # Litux keeps the first match per key`,
        `${df} <- ${how}(${df}, right_df, by = c(${rStr(step.leftKey)} = ${rStr(step.rightKey)}), suffix = c("", ${rStr(step.suffix ?? "_r")}))`,
      ].join("\n");
    }

    case "append": {
      const rightName = safeDatasetName(step.rightId, allDatasets);
      return [
        `# Append dataset: "${rightName}"`,
        `right_df <- ${rRightLoad(step.rightId, allDatasets)}`,
        `${df} <- dplyr::bind_rows(${df}, right_df)`,
      ].join("\n");
    }

    default:
      return `# [unknown step: ${step.type}]`;
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// toStata
// ─────────────────────────────────────────────────────────────────────────────

export function toStata(step, df = "df", allDatasets = {}) {
  const v = step.col ? stVar(step.col) : null;
  const o = step.nn  ? stVar(step.nn)  : null;

  switch (step.type) {

    case "rename":
      return `rename ${stVar(step.col)} ${stVar(step.newName)}`;

    case "drop":
      return `drop ${v}`;

    case "filter": {
      const val   = step.value ?? "";
      const isNum = !isNaN(Number(val)) && val !== "";
      const opMap = {
        notna: `!missing(${v})`,
        eq:    isNum ? `${v} == ${val}`    : `${v} == "${val}"`,
        neq:   isNum ? `${v} != ${val}`    : `${v} != "${val}"`,
        gt:    `${v} > ${val}`,
        lt:    `${v} < ${val}`,
        gte:   `${v} >= ${val}`,
        lte:   `${v} <= ${val}`,
      };
      return `keep if ${opMap[step.op] ?? "1"}`;
    }

    case "drop_na": {
      if (!step.cols?.length) return `drop if missing(*)`;
      const cond = step.cols.map(c => `missing(${stVar(c)})`).join(
        step.how === "all" ? " & " : " | "
      );
      return `drop if ${cond}`;
    }

    case "fill_na": {
      if (step.strategy === "mean")
        return [
          `quietly summarize ${v}`,
          `replace ${v} = r(mean) if missing(${v})`,
        ].join("\n");
      if (step.strategy === "median")
        return [
          `quietly summarize ${v}, detail`,
          `replace ${v} = r(p50) if missing(${v})`,
        ].join("\n");
      if (step.strategy === "constant")
        return `replace ${v} = ${typeof step.value === "number" ? step.value : `"${step.value}"`} if missing(${v})`;
      if (step.strategy === "forward_fill")
        return `carryforward ${v}, replace`;
      if (step.strategy === "backward_fill")
        return `carryforward ${v}, replace backfill`;
      if (step.strategy === "mode")
        return [
          `# mode imputation — use user-written modematch or manual tabulate`,
          `# replace ${v} = <mode_value> if missing(${v})`,
        ].join("\n");
      return `replace ${v} = 0 if missing(${v})  // fill_na — adjust value`;
    }

    case "fill_na_grouped": {
      const gc  = stVar(step.groupCol);
      const fn  = step.strategy === "median" ? "median" : "mean";
      return [
        `bysort ${gc}: egen _tmp_fill = ${fn}(${v})`,
        `replace ${v} = _tmp_fill if missing(${v})`,
        `drop _tmp_fill`,
      ].join("\n");
    }

    case "type_cast": {
      if (step.to === "number") return `destring ${v}, replace`;
      if (step.to === "string") return `tostring ${v}, replace`;
      if (step.to === "boolean") return `replace ${v} = (${v} != 0)`;
      return `destring ${v}, replace`;
    }

    case "quickclean": {
      if (step.mode === "lower") return `replace ${v} = lower(${v})`;
      if (step.mode === "upper") return `replace ${v} = upper(${v})`;
      if (step.mode === "title") return `replace ${v} = proper(${v})`;
      return `replace ${v} = lower(${v})`;
    }

    case "recode": {
      const map = step.map ?? {};
      return Object.entries(map)
        .map(([k, val]) => {
          const isNum = !isNaN(Number(k)) && k !== "";
          const from  = isNum ? k : `"${k}"`;
          const to    = typeof val === "number" ? val : `"${val}"`;
          return `replace ${v} = ${to} if ${v} == ${from}`;
        }).join("\n");
    }

    case "normalize_cats": {
      const map = step.map ?? {};
      return Object.entries(map)
        .map(([k, val]) => `replace ${v} = "${val}" if ${v} == "${k}"`)
        .join("\n");
    }

    case "winz": {
      const lo  = Number(step.lo).toFixed(6);
      const hi  = Number(step.hi).toFixed(6);
      const out = o && o !== v ? o : v;
      return [
        `generate ${out} = ${v}`,
        `replace ${out} = ${lo} if ${out} < ${lo}`,
        `replace ${out} = ${hi} if ${out} > ${hi} & !missing(${out})`,
      ].join("\n");
    }

    case "trim_outliers": {
      const lo = Number(step.lo).toFixed(6);
      const hi = Number(step.hi).toFixed(6);
      return `drop if ${v} < ${lo} | ${v} > ${hi}`;
    }

    case "flag_outliers": {
      if (step.method === "zscore") {
        const thr = step.threshold ?? 3;
        return [
          `quietly summarize ${v}`,
          `generate _z_tmp = (${v} - r(mean)) / r(sd)`,
          `generate ${o} = abs(_z_tmp) > ${thr}`,
          `drop _z_tmp`,
        ].join("\n");
      }
      return [
        `quietly summarize ${v}, detail`,
        `local iqr = r(p75) - r(p25)`,
        `generate ${o} = (${v} < r(p25) - 1.5 * \`iqr') | (${v} > r(p75) + 1.5 * \`iqr')`,
      ].join("\n");
    }

    case "extract_regex": {
      const rx = step.regex || "[0-9]+[.,]?[0-9]*";
      return [
        `generate _str_tmp = regexs(1) if regexm(${v}, "${rx}")`,
        `destring _str_tmp, generate(${o}) force`,
        `drop _str_tmp`,
      ].join("\n");
    }

    case "ai_tr":
      return [
        `* ai_tr on "${step.col}" — AI-generated transformation`,
        `* JS: ${step.js}`,
        `* Translate to Stata manually`,
      ].join("\n");

    case "log":
      return `generate ${o} = log(${v})`;

    case "sq":
      return `generate ${o} = ${v}^2`;

    case "std": {
      const mu = Number(step.mu).toFixed(6);
      const sd = Number(step.sd).toFixed(6);
      return `generate ${o} = (${v} - ${mu}) / ${sd}`;
    }

    case "dummy":
      return [
        `* One-hot encode ${step.col} (prefix: ${step.pfx})`,
        `tabulate ${v}, generate(${stVar(step.pfx ?? step.col)})`,
      ].join("\n");

    case "lag": {
      const ec = step.ec ? stVar(step.ec) : null;
      const tc = step.tc ? stVar(step.tc) : null;
      const n  = step.n ?? 1;
      const lagExpr = n === 1 ? `L.${v}` : `L${n}.${v}`;
      if (ec && tc) {
        return [
          `xtset ${ec} ${tc}`,
          `generate ${o} = ${lagExpr}`,
        ].join("\n");
      }
      return [
        `sort ${tc || "_n"}`,
        `generate ${o} = ${lagExpr}`,
      ].join("\n");
    }

    case "lead": {
      const ec = step.ec ? stVar(step.ec) : null;
      const tc = step.tc ? stVar(step.tc) : null;
      const n  = step.n ?? 1;
      const leadExpr = n === 1 ? `F.${v}` : `F${n}.${v}`;
      if (ec && tc) {
        return [
          `xtset ${ec} ${tc}`,
          `generate ${o} = ${leadExpr}`,
        ].join("\n");
      }
      return [
        `sort ${tc || "_n"}`,
        `generate ${o} = ${leadExpr}`,
      ].join("\n");
    }

    case "diff": {
      const ec = step.ec ? stVar(step.ec) : null;
      const tc = step.tc ? stVar(step.tc) : null;
      if (ec && tc) {
        return [
          `xtset ${ec} ${tc}`,
          `generate ${o} = D.${v}`,
        ].join("\n");
      }
      return `generate ${o} = ${v} - L.${v}`;
    }

    case "ix":
      return `generate ${o} = ${stVar(step.c1)} * ${stVar(step.c2)}`;

    case "did":
      return `generate ${o} = ${stVar(step.tc)} * ${stVar(step.pc)}`;

    case "date_parse": {
      // When step.nn differs from step.col, produce a new column (e.g. Date_iso)
      const outV = (step.nn && step.nn !== step.col) ? stVar(step.nn) : v;
      return [
        `* date_parse: convert string ${v} to Stata date → ${outV}`,
        `gen _tmp_dp = date(${v}, "YMD")`,
        `gen ${outV} = _tmp_dp`,
        `drop _tmp_dp`,
        `format ${outV} %td`,
      ].join("\n");
    }

    case "date_extract": {
      const parts = step.parts ?? [];
      return parts.map(p => {
        const outName = step.names?.[p] ?? `${step.col}_${p}`;
        if (p === "year")      return `generate ${stVar(outName)} = year(${v})`;
        if (p === "month")     return `generate ${stVar(outName)} = month(${v})`;
        if (p === "dow")       return `generate ${stVar(outName)} = dow(${v})`;
        if (p === "isweekend") return `generate ${stVar(outName)} = inlist(dow(${v}), 0, 6)`;
        return null;
      }).filter(Boolean).join("\n") || `* date_extract: no parts specified`;
    }

    case "mutate": {
      const stExpr = jsExprToStata(step.expr);
      if (stExpr) return `generate ${o} = ${stExpr}`;
      return [
        `* mutate: ${step.nn} = ${step.expr}`,
        `* NOTE: expression uses JS syntax — translate to Stata manually`,
        `* generate ${o} = <Stata expression>`,
      ].join("\n");
    }

    case "arrange":
      return step.dir === "desc" ? `gsort -${v}` : `sort ${v}`;

    case "group_summarize": {
      const by   = (step.by ?? []).map(stVar).join(" ");
      const fnMap = { mean:"mean", sum:"sum", count:"count", min:"min", max:"max", sd:"sd", median:"median" };
      const aggs = (step.aggs ?? []).map(a => {
        const fn = fnMap[a.fn] ?? a.fn;
        return a.fn === "count"
          ? `(count) ${stVar(a.nn)} = ${stVar(a.col)}`
          : `(${fn}) ${stVar(a.nn)} = ${stVar(a.col)}`;
      }).join(" ");
      return `collapse ${aggs}, by(${by})`;
    }

    case "pivot_longer": {
      const cols    = (step.cols ?? []).map(stVar).join(" ");
      const namesTo = stVar(step.namesTo ?? "name");
      const valTo   = stVar(step.valuesTo ?? "value");
      return [
        `* pivot_longer — reshape wide to long`,
        `reshape long ${cols}, i(${(step.idCols ?? []).map(stVar).join(" ") || "_n"}) j(${namesTo}) string`,
        `rename _value ${valTo}`,
      ].join("\n");
    }

    case "factor_interactions": {
      const cont = stVar(step.contCol);
      const pfx  = step.prefix || `${step.contCol}_x_`;
      return (step.dummyCols ?? []).map(d =>
        `generate ${stVar(pfx + d)} = ${cont} * ${stVar(d)}`
      ).join("\n") || `* factor_interactions: no dummy columns specified`;
    }

    case "join": {
      const rightName = safeDatasetName(step.rightId, allDatasets);
      const how = step.how === "inner" ? "keepusing(_merge)" : "";
      return [
        `* Join dataset: "${rightName}"`,
        `* Save current data first`,
        `preserve`,
        `${stataRightLoad(step.rightId, allDatasets)}`,
        `rename ${stVar(step.rightKey)} ${stVar(step.leftKey)}`,
        `* Litux's join is a first-match LOOKUP — keep one row per key so m:1 merge matches`,
        `bysort ${stVar(step.leftKey)}: keep if _n == 1`,
        `save _right_tmp.dta, replace`,
        `restore`,
        `merge m:1 ${stVar(step.leftKey)} using _right_tmp.dta, ${how}`,
        `drop if _merge == 2`,
        `drop _merge`,
      ].join("\n");
    }

    case "append": {
      const rightName = safeDatasetName(step.rightId, allDatasets);
      return [
        `* Append dataset: "${rightName}"`,
        `preserve`,
        `${stataRightLoad(step.rightId, allDatasets)}`,
        `save _append_tmp.dta, replace`,
        `restore`,
        `append using "_append_tmp.dta"`,
        `erase "_append_tmp.dta"`,
      ].join("\n");
    }

    default:
      return `* [unknown step: ${step.type}]`;
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// toPython
// ─────────────────────────────────────────────────────────────────────────────

export function toPython(step, df = "df", allDatasets = {}) {
  const c = step.col ? pyCol(step.col) : null;
  const o = step.nn  ? pyCol(step.nn)  : null;

  switch (step.type) {

    case "rename":
      return `${df} = ${df}.rename(columns={${pyCol(step.col)}: ${pyCol(step.newName)}})`;

    case "drop":
      return `${df} = ${df}.drop(columns=[${c}])`;

    case "filter": {
      const val   = step.value ?? "";
      const isNum = !isNaN(Number(val)) && val !== "";
      const colRef = `${df}[${c}]`;
      const opMap = {
        notna: `${colRef}.notna()`,
        eq:    isNum ? `${colRef} == ${val}`         : `${colRef} == ${pyStr(val)}`,
        neq:   isNum ? `${colRef} != ${val}`         : `${colRef} != ${pyStr(val)}`,
        gt:    `${colRef} > ${val}`,
        lt:    `${colRef} < ${val}`,
        gte:   `${colRef} >= ${val}`,
        lte:   `${colRef} <= ${val}`,
      };
      return `${df} = ${df}[${opMap[step.op] ?? "True"}]`;
    }

    case "drop_na": {
      if (!step.cols?.length) {
        return step.how === "all"
          ? `${df} = ${df}.dropna(how="all")`
          : `${df} = ${df}.dropna()`;
      }
      const cols = `[${step.cols.map(pyCol).join(", ")}]`;
      return `${df} = ${df}.dropna(subset=${cols}, how=${pyStr(step.how ?? "any")})`;
    }

    case "fill_na": {
      const colRef = `${df}[${c}]`;
      if (step.strategy === "mean")    return `${colRef} = ${colRef}.fillna(${colRef}.mean())`;
      if (step.strategy === "median")  return `${colRef} = ${colRef}.fillna(${colRef}.median())`;
      if (step.strategy === "mode")    return `${colRef} = ${colRef}.fillna(${colRef}.mode()[0])`;
      if (step.strategy === "constant") return `${colRef} = ${colRef}.fillna(${isNaN(Number(step.value)) ? pyStr(step.value) : step.value})`;
      if (step.strategy === "forward_fill")  return `${colRef} = ${colRef}.ffill()`;
      if (step.strategy === "backward_fill") return `${colRef} = ${colRef}.bfill()`;
      return `${colRef} = ${colRef}.fillna(${colRef}.mean())`;
    }

    case "fill_na_grouped": {
      const gc     = pyCol(step.groupCol);
      const fn     = step.strategy === "median" ? "median" : "mean";
      const colRef = `${df}[${c}]`;
      return `${colRef} = ${df}.groupby(${gc})[${c}].transform(lambda x: x.fillna(x.${fn}()))`;
    }

    case "type_cast": {
      const colRef = `${df}[${c}]`;
      if (step.to === "number")  return `${df}[${c}] = pd.to_numeric(${colRef}, errors="coerce")`;
      if (step.to === "string")  return `${df}[${c}] = ${colRef}.astype(str)`;
      if (step.to === "boolean") return `${df}[${c}] = ${colRef}.astype(int)`;
      return `${df}[${c}] = pd.to_numeric(${colRef}, errors="coerce")`;
    }

    case "quickclean": {
      const colRef = `${df}[${c}]`;
      if (step.mode === "upper") return `${df}[${c}] = ${colRef}.str.upper()`;
      if (step.mode === "title") return `${df}[${c}] = ${colRef}.str.title()`;
      return `${df}[${c}] = ${colRef}.str.lower()`;
    }

    case "recode": {
      const map    = step.map ?? {};
      const mapStr = "{" + Object.entries(map)
        .map(([k, v]) => `${pyStr(k)}: ${typeof v === "number" ? v : pyStr(v)}`)
        .join(", ") + "}";
      return `${df}[${c}] = ${df}[${c}].map(${mapStr}).fillna(${df}[${c}])`;
    }

    case "normalize_cats": {
      const map    = step.map ?? {};
      const mapStr = "{" + Object.entries(map)
        .map(([k, v]) => `${pyStr(k)}: ${pyStr(v)}`)
        .join(", ") + "}";
      return `${df}[${c}] = ${df}[${c}].map(${mapStr}).fillna(${df}[${c}])`;
    }

    case "winz": {
      const lo  = Number(step.lo).toFixed(6);
      const hi  = Number(step.hi).toFixed(6);
      const out = step.nn ? `${df}[${o}]` : `${df}[${c}]`;
      return `${out} = ${df}[${c}].clip(${lo}, ${hi})`;
    }

    case "trim_outliers": {
      const lo = Number(step.lo).toFixed(6);
      const hi = Number(step.hi).toFixed(6);
      return `${df} = ${df}[(${df}[${c}] >= ${lo}) & (${df}[${c}] <= ${hi})]`;
    }

    case "flag_outliers": {
      if (step.method === "zscore") {
        const thr = step.threshold ?? 3;
        return [
          `_z = (${df}[${c}] - ${df}[${c}].mean()) / ${df}[${c}].std()`,
          `${df}[${o}] = (_z.abs() > ${thr}).astype(int)`,
        ].join("\n");
      }
      return [
        `_q1 = ${df}[${c}].quantile(0.25)`,
        `_q3 = ${df}[${c}].quantile(0.75)`,
        `_iqr = _q3 - _q1`,
        `${df}[${o}] = ((${df}[${c}] < _q1 - 1.5 * _iqr) | (${df}[${c}] > _q3 + 1.5 * _iqr)).astype(int)`,
      ].join("\n");
    }

    case "extract_regex": {
      const escapedRx = step.regex ? pyStr(step.regex) : `r"(\\d[\\d,\\.]*)"`;
      return `${df}[${o}] = pd.to_numeric(${df}[${c}].str.extract(${escapedRx})[0], errors="coerce")`;
    }

    case "ai_tr":
      return [
        `# ai_tr on ${c} — AI-generated transformation`,
        `# JS: ${step.js}`,
        `# Translate to Python manually`,
      ].join("\n");

    case "log":
      return `${df}[${o}] = np.log(${df}[${c}])`;

    case "sq":
      return `${df}[${o}] = ${df}[${c}] ** 2`;

    case "std": {
      const mu = Number(step.mu).toFixed(6);
      const sd = Number(step.sd).toFixed(6);
      return `${df}[${o}] = (${df}[${c}] - ${mu}) / ${sd}`;
    }

    case "dummy": {
      const pfx = step.pfx ? pyStr(step.pfx) : pyStr(step.col);
      return `${df} = pd.get_dummies(${df}, columns=[${c}], prefix=${pfx}, dtype=int)`;
    }

    case "lag": {
      const n  = step.n ?? 1;
      if (step.ec && step.tc) {
        return [
          `${df} = ${df}.sort_values([${pyCol(step.ec)}, ${pyCol(step.tc)}])`,
          `${df}[${o}] = ${df}.groupby(${pyCol(step.ec)})[${c}].shift(${n})`,
        ].join("\n");
      }
      return `${df}[${o}] = ${df}[${c}].shift(${n})`;
    }

    case "lead": {
      const n  = step.n ?? 1;
      if (step.ec && step.tc) {
        return [
          `${df} = ${df}.sort_values([${pyCol(step.ec)}, ${pyCol(step.tc)}])`,
          `${df}[${o}] = ${df}.groupby(${pyCol(step.ec)})[${c}].shift(-${n})`,
        ].join("\n");
      }
      return `${df}[${o}] = ${df}[${c}].shift(-${n})`;
    }

    case "diff": {
      if (step.ec && step.tc) {
        return [
          `${df} = ${df}.sort_values([${pyCol(step.ec)}, ${pyCol(step.tc)}])`,
          `${df}[${o}] = ${df}.groupby(${pyCol(step.ec)})[${c}].diff()`,
        ].join("\n");
      }
      return `${df}[${o}] = ${df}[${c}].diff()`;
    }

    case "ix":
      return `${df}[${o}] = ${df}[${pyCol(step.c1)}] * ${df}[${pyCol(step.c2)}]`;

    case "did":
      return `${df}[${o}] = ${df}[${pyCol(step.tc)}] * ${df}[${pyCol(step.pc)}]`;

    case "date_parse": {
      // When step.nn differs from step.col, create a new column (e.g. Date_iso)
      const outC = (step.nn && step.nn !== step.col) ? pyCol(step.nn) : c;
      return `${df}[${outC}] = pd.to_datetime(${df}[${c}], infer_datetime_format=True, errors="coerce")`;
    }

    case "date_extract": {
      const parts = step.parts ?? [];
      return parts.map(p => {
        const outName = pyCol(step.names?.[p] ?? `${step.col}_${p}`);
        if (p === "year")      return `${df}[${outName}] = ${df}[${c}].dt.year`;
        if (p === "month")     return `${df}[${outName}] = ${df}[${c}].dt.month`;
        if (p === "dow")       return `${df}[${outName}] = ${df}[${c}].dt.dayofweek`;
        if (p === "isweekend") return `${df}[${outName}] = ${df}[${c}].dt.dayofweek.isin([5, 6]).astype(int)`;
        return null;
      }).filter(Boolean).join("\n") || `# date_extract: no parts specified`;
    }

    case "mutate": {
      const pyExpr = jsExprToPython(step.expr, df);
      if (pyExpr) return `${df}[${o}] = ${pyExpr}`;
      return [
        `# mutate: ${step.nn} = ${step.expr}`,
        `# NOTE: expression uses JS syntax — translate to Python manually`,
        `# ${df}[${o}] = <pandas expression>`,
      ].join("\n");
    }

    case "arrange": {
      const asc = step.dir !== "desc";
      return `${df} = ${df}.sort_values(${c}, ascending=${asc ? "True" : "False"}).reset_index(drop=True)`;
    }

    case "group_summarize": {
      const by   = `[${(step.by ?? []).map(pyCol).join(", ")}]`;
      const fnMap = { mean:"mean", sum:"sum", count:"size", min:"min", max:"max", sd:"std", median:"median" };
      const aggs  = (step.aggs ?? []).map(a => {
        const fn = fnMap[a.fn] ?? a.fn;
        return `    ${pyStr(a.nn)}: pd.NamedAgg(column=${pyStr(a.col)}, aggfunc=${pyStr(fn)})`;
      }).join(",\n");
      return [
        `${df} = (${df}`,
        `  .groupby(${by})`,
        `  .agg(**{\n${aggs}\n  })`,
        `  .reset_index()`,
        `)`,
      ].join("\n");
    }

    case "pivot_longer": {
      const cols   = `[${(step.cols ?? []).map(pyCol).join(", ")}]`;
      const idCols = step.idCols?.length
        ? `[${step.idCols.map(pyCol).join(", ")}]`
        : "None";
      return [
        `${df} = ${df}.melt(`,
        `  id_vars=${idCols},`,
        `  value_vars=${cols},`,
        `  var_name=${pyStr(step.namesTo ?? "name")},`,
        `  value_name=${pyStr(step.valuesTo ?? "value")}`,
        `)`,
      ].join("\n");
    }

    case "factor_interactions": {
      const cont = pyCol(step.contCol);
      const pfx  = step.prefix || `${step.contCol}_x_`;
      return (step.dummyCols ?? []).map(d =>
        `${df}[${pyStr(pfx + d)}] = ${df}[${cont}] * ${df}[${pyCol(d)}]`
      ).join("\n") || `# factor_interactions: no dummy columns specified`;
    }

    case "join": {
      const rightName = safeDatasetName(step.rightId, allDatasets);
      const how = step.how === "inner" ? "inner" : "left";
      return [
        `# Join dataset: "${rightName}"`,
        `right_df = ${pyRightLoad(step.rightId, allDatasets)}`,
        // Litux's join is a first-match LOOKUP — dedup right by key so pandas
        // reproduces the same row count (no many-to-many expansion).
        `right_df = right_df.drop_duplicates(subset=[${pyCol(step.rightKey)}], keep="first")  # Litux keeps the first match per key`,
        `${df} = pd.merge(${df}, right_df, left_on=${pyCol(step.leftKey)}, right_on=${pyCol(step.rightKey)}, how=${pyStr(how)}, suffixes=("", ${pyStr(step.suffix ?? "_r")}))`,
      ].join("\n");
    }

    case "append": {
      const rightName = safeDatasetName(step.rightId, allDatasets);
      return [
        `# Append dataset: "${rightName}"`,
        `right_df = ${pyRightLoad(step.rightId, allDatasets)}`,
        `${df} = pd.concat([${df}, right_df], ignore_index=True)`,
      ].join("\n");
    }

    default:
      return `# [unknown step: ${step.type}]`;
  }
}
