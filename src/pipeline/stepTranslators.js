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
function pyList(arr) { return `[${(arr ?? []).map(pyStr).join(", ")}]`; }

function pyValue(v, dtype = null) {
  if (v === null || v === undefined) return "None";
  if (dtype === "number" || typeof v === "number") {
    const n = Number(v);
    return isFinite(n) ? String(n) : "None";
  }
  return pyStr(v);
}

function pyWhere(where) {
  if (!where?.col || !where?.op) return "pd.Series(True, index=df.index)";
  const c = pyStr(where.col);
  const v = where.value;
  switch (where.op) {
    case "equals":     return `(df[${c}].astype("string") == ${pyStr(v ?? "")})`;
    case "not_equals": return `(df[${c}].astype("string") != ${pyStr(v ?? "")})`;
    case "contains":   return `df[${c}].astype("string").str.contains(${pyStr(v ?? "")}, regex=False, na=False)`;
    case "starts":     return `df[${c}].astype("string").str.startswith(${pyStr(v ?? "")}, na=False)`;
    case "ends":       return `df[${c}].astype("string").str.endswith(${pyStr(v ?? "")}, na=False)`;
    case "gt":         return `(pd.to_numeric(df[${c}], errors="coerce") > ${Number(v)})`;
    case "lt":         return `(pd.to_numeric(df[${c}], errors="coerce") < ${Number(v)})`;
    case "between": {
      const lo = Number(Array.isArray(v) ? v[0] : v);
      const hi = Number(Array.isArray(v) ? v[1] : v);
      return `pd.to_numeric(df[${c}], errors="coerce").between(${lo}, ${hi})`;
    }
    case "empty":    return `(df[${c}].isna() | (df[${c}].astype("string") == ""))`;
    case "notempty": return `(df[${c}].notna() & (df[${c}].astype("string") != ""))`;
    default: return "pd.Series(True, index=df.index)";
  }
}

// ─── R SCALAR / CONDITION HELPERS ────────────────────────────────────────────

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
    case "equals":     return `${c} == ${rValue(v)}`;
    case "not_equals": return `${c} != ${rValue(v)}`;
    case "contains":   return `stringr::str_detect(as.character(${c}), stringr::fixed(${rStr(v ?? "")}))`;
    case "starts":     return `stringr::str_starts(as.character(${c}), ${rStr(v ?? "")})`;
    case "ends":       return `stringr::str_ends(as.character(${c}), ${rStr(v ?? "")})`;
    case "gt":         return `${c} > ${Number(v)}`;
    case "lt":         return `${c} < ${Number(v)}`;
    case "between": {
      const lo = Number(Array.isArray(v) ? v[0] : v);
      const hi = Number(Array.isArray(v) ? v[1] : v);
      return `${c} >= ${lo} & ${c} <= ${hi}`;
    }
    case "empty":    return `is.na(${c}) | as.character(${c}) == ""`;
    case "notempty": return `!is.na(${c}) & as.character(${c}) != ""`;
    default: return "TRUE";
  }
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

// ─── STATA SCALAR / CONDITION HELPERS ────────────────────────────────────────

function stStr(s) { return `"${String(s ?? "").replace(/"/g, `""`)}"`;  }

function stValue(v, dtype = null) {
  if (v === null || v === undefined) return ".";
  if (dtype === "number" || typeof v === "number") {
    const n = Number(v);
    return isFinite(n) ? String(n) : ".";
  }
  return stStr(v);
}

function stWhere(where) {
  if (!where?.col || !where?.op) return "1";
  const c = stVar(where.col);
  const v = where.value;
  switch (where.op) {
    case "equals":     return `${c} == ${stValue(v)}`;
    case "not_equals": return `${c} != ${stValue(v)}`;
    case "contains":   return `strpos(${c}, ${stStr(v ?? "")}) > 0`;
    case "starts":     return `substr(${c}, 1, length(${stStr(v ?? "")})) == ${stStr(v ?? "")}`;
    case "ends":       return `substr(${c}, -length(${stStr(v ?? "")}), .) == ${stStr(v ?? "")}`;
    case "gt":         return `${c} > ${Number(v)}`;
    case "lt":         return `${c} < ${Number(v)}`;
    case "between": {
      const lo = Number(Array.isArray(v) ? v[0] : v);
      const hi = Number(Array.isArray(v) ? v[1] : v);
      return `${c} >= ${lo} & ${c} <= ${hi}`;
    }
    case "empty":    return `missing(${c}) | ${c} == ""`;
    case "notempty": return `!missing(${c}) & ${c} != ""`;
    default: return "1";
  }
}


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


    case "add_column":
      return `${df} <- ${df} |> mutate(${rName(step.nn)} = ${rValue(step.fill, step.dtype)})`;

    case "add_row": {
      const count = Math.max(1, Number(step.count) || 1);
      const assigns = Object.entries(step.values || {})
        .map(([k, v]) => `__new_rows[[${rStr(k)}]] <- ${rValue(v)}`);
      return [
        `# add_row: append ${count} synthetic row(s); unspecified columns remain NA`,
        `__new_rows <- ${df}[rep(NA_integer_, ${count}), , drop = FALSE]`,
        ...assigns,
        `${df} <- dplyr::bind_rows(${df}, __new_rows)`,
        `rm(__new_rows)`,
      ].join("\n");
    }

    case "set_where": {
      const setVal = step.action === "clear" ? "NA" : rValue(step.value, step.dtype);
      return `${df} <- ${df} |> mutate(${rName(step.col)} = ifelse(${rWhere(step.where)}, ${setVal}, ${rName(step.col)}))`;
    }

    case "replace": {
      const mode = step.match?.mode || "exact";
      const find = step.match?.find ?? "";
      const out  = rName(step.nn || step.col);
      const src  = rName(step.col);
      if (mode === "exact")
        return `${df} <- ${df} |> mutate(${out} = dplyr::if_else(${src} == ${rValue(find)}, ${rValue(step.replaceWith)}, ${src}))`;
      const pattern = mode === "contains" ? `stringr::fixed(${rStr(find)})` : rStr(find);
      return `${df} <- ${df} |> mutate(${out} = stringr::str_replace_all(as.character(${src}), ${pattern}, ${rValue(step.replaceWith)}))`;
    }

    case "str_splice": {
      const rSrc  = rName(step.col);
      const rOut  = rName(step.nn || step.col);
      const pos   = Number(step.position) || 1;
      const cnt   = Math.max(0, Number(step.count) || 0);
      const text  = rStr(step.text ?? "");
      const pExpr = `ifelse(${pos} < 0, pmax(1, nchar(x) + ${pos} + 1), ${pos})`;
      const body  = step.mode === "delete"
        ? `stringr::str_c(stringr::str_sub(x, 1, p - 1), stringr::str_sub(x, p + ${cnt}))`
        : step.mode === "overwrite"
          ? `stringr::str_c(stringr::str_sub(x, 1, p - 1), ${text}, stringr::str_sub(x, p + ${cnt}))`
          : `stringr::str_c(stringr::str_sub(x, 1, p - 1), ${text}, stringr::str_sub(x, p))`;
      return [
        `${df} <- ${df} |> mutate(${rOut} = {`,
        `  x <- as.character(${rSrc})`,
        `  p <- pmin(pmax(${pExpr}, 1), nchar(x) + 1)`,
        `  ${body}`,
        `})`,
      ].join("\n");
    }

    case "distinct": {
      const rSubset = (step.subset ?? []).map(rName).join(", ");
      return `${df} <- ${df} |> distinct(${rSubset || "."}${rSubset ? ", " : ""}.keep_all = TRUE)`;
    }

    case "group_transform": {
      const rBy  = (step.by ?? []).map(rName).join(", ");
      const rOut = rName(step.nn ?? `${step.fn}_${step.col}`);
      const rRhs = step.fn === "count" ? "n()" : rFn(step.fn, step.col);
      return `${df} <- ${df} |> group_by(${rBy}) |> mutate(${rOut} = ${rRhs}) |> ungroup()`;
    }

    case "bind_cols": {
      const bcRightName = safeDatasetName(step.rightId, allDatasets);
      return [
        `# Bind columns from dataset: "${bcRightName}"`,
        `right_df <- ${rRightLoad(step.rightId, allDatasets)}`,
        `${df} <- dplyr::bind_cols(${df}, right_df)`,
      ].join("\n");
    }

    case "union":
    case "intersect":
    case "setdiff": {
      const soRightName = safeDatasetName(step.rightId, allDatasets);
      return [
        `# ${step.type}: "${soRightName}"`,
        `right_df <- ${rRightLoad(step.rightId, allDatasets)}`,
        `${df} <- ${step.type}(${df}, right_df)`,
      ].join("\n");
    }

    case "vector_assign": {
      const vaVals = rVec(step.values ?? []);
      const vaOut  = rName(step.nn ?? "assigned");
      const vaSeed = Number.isFinite(Number(step.seed)) ? Number(step.seed) : 42;
      if (step.mode === "recycle")
        return `${df}$${vaOut} <- rep_len(${vaVals}, nrow(${df}))`;
      if (step.mode === "conditional") {
        const vaLines = (step.rules || []).map(r => `    ${r.expr} ~ ${rStr(r.value)}`).join(",\n");
        return `${df}$${vaOut} <- with(${df}, dplyr::case_when(\n${vaLines}${vaLines ? ",\n" : ""}    TRUE ~ ${rStr(step.elseValue ?? "")}\n))`;
      }
      const vaProb = step.weights ? `, prob = c(${step.weights.join(", ")})` : "";
      return `# NOTE: EconSolver uses a seeded mulberry32 RNG; values differ, distribution matches\nset.seed(${vaSeed}); ${df}$${vaOut} <- sample(${vaVals}, nrow(${df}), replace = TRUE${vaProb})`;
    }

    case "patch":
      return `# manual cell edit (${step.col ?? "column"} @ row ${step.ri ?? step.rowId ?? "?"}) — not replayable on the raw file; load the exported *_cleaned.csv instead`;

    case "inject_column": {
      const icVals = (step.values ?? []).map(v => (v == null ? "NA" : Number(v).toFixed(8))).join(", ");
      return [
        `# inject_column: "${step.colName}" — extracted from model output`,
        `${df}[["${rName(step.colName)}"]] <- c(${icVals})`,
      ].join("\n");
    }

    case "clean_strings": {
      const csFn = { lower: "tolower", upper: "toupper", title: "stringr::str_to_title" }[step.case];
      const csIn = csFn
        ? `${csFn}(stringr::str_squish(as.character(${col})))`
        : `stringr::str_squish(as.character(${col}))`;
      return `${df} <- ${df} |> mutate(${col} = ${csIn})`;
    }

    case "if_else": {
      const ieCond = jsExprToR(step.cond);
      const ieOut  = rName(step.nn);
      if (!ieCond) return `# if_else: ${step.nn} = if (${step.cond}) ... — translate condition to R manually`;
      return `${df} <- ${df} |> mutate(${ieOut} = dplyr::if_else(${ieCond}, ${rValue(step.trueVal)}, ${rValue(step.falseVal)}))`;
    }

    case "case_when": {
      const cwOut  = rName(step.nn);
      const cwBrs  = (step.cases ?? [])
        .map(c => { const cc = jsExprToR(c.cond); return cc ? `    ${cc} ~ ${rValue(c.val)}` : null; })
        .filter(Boolean).join(",\n");
      return cwBrs
        ? `${df} <- ${df} |> mutate(${cwOut} = dplyr::case_when(\n${cwBrs},\n    TRUE ~ ${rValue(step.defaultVal)}\n  ))`
        : `# case_when: no valid conditions — translate manually`;
    }

    case "grouped_mutate": {
      const gmBy  = (step.by ?? []).map(rName).join(", ");
      const gmOut = rName(step.newCol || "grouped");
      const gmFn  = step.fn ?? "mean";
      if (!gmBy || !step.newCol) return `# grouped_mutate: incomplete config`;
      if (gmFn === "expr" && step.expr) {
        const gmExpr = jsExprToR(step.expr);
        return gmExpr
          ? `${df} <- ${df} |> group_by(${gmBy}) |> mutate(${gmOut} = ${gmExpr}) |> ungroup()`
          : `# grouped_mutate (expr): translate "${step.expr}" to R manually`;
      }
      const gmRhs = step.col ? rFn(gmFn, step.col) : "n()";
      return [
        `# grouped_mutate: ${gmFn} over groups${step.condition?.length ? " (row conditions applied in-app — review)" : ""}`,
        `${df} <- ${df} |> group_by(${gmBy}) |> mutate(${gmOut} = ${gmRhs}) |> ungroup()`,
      ].join("\n");
    }

    case "pivot_wider": {
      const pwIds  = (step.idCols ?? []).map(rName).join(", ");
      const pwFrom = rStr(step.namesFrom);
      const pwVals = (Array.isArray(step.valuesFrom) ? step.valuesFrom : [step.valuesFrom].filter(Boolean)).map(rStr).join(", ");
      const pwOpts = [];
      if (step.namesPrefix) pwOpts.push(`  names_prefix = ${rStr(step.namesPrefix)}`);
      if (step.valuesFill != null && step.valuesFill !== "") pwOpts.push(`  values_fill = ${Number(step.valuesFill)}`);
      return [
        `${df} <- ${df} |> tidyr::pivot_wider(`,
        `  id_cols     = c(${pwIds}),`,
        `  names_from  = ${pwFrom},`,
        `  values_from = c(${pwVals})${pwOpts.length ? "," : ""}`,
        ...pwOpts.map((o, i) => o + (i < pwOpts.length - 1 ? "," : "")),
        `)`,
      ].join("\n");
    }

    case "balance_panel": {
      const bpEnt  = rName(step.entityCol);
      const bpTim  = rName(step.timeCol);
      const bpSlot = step.slotCol ? `, ${rName(step.slotCol)}` : "";
      const bpOuts = (step.outcomeCols ?? []).map(rName);
      const bpFill = Number(step.fillValue) || 0;
      let bpLine   = `${df} <- ${df} |> tidyr::complete(${bpEnt}, ${bpTim}${bpSlot})`;
      if (bpOuts.length)
        bpLine += ` |>\n  tidyr::replace_na(list(${bpOuts.map(o => `${o} = ${bpFill}`).join(", ")}))`;
      return [
        `# Balance panel: complete ${step.entityCol} × ${step.timeCol}${step.slotCol ? ` × ${step.slotCol}` : ""} grid`,
        bpLine,
      ].join("\n");
    }

    case "geocode": {
      const gcAddr = rName(step.addressCol ?? "address");
      const gcLat  = rName(step.latCol ?? "lat");
      const gcLon  = rName(step.lonCol ?? "lon");
      return [
        `# Geocode: ${gcAddr} -> ${gcLat} / ${gcLon}`,
        `# Requires tidygeocoder: install.packages("tidygeocoder")`,
        `library(tidygeocoder)`,
        `${df} <- ${df} |>`,
        `  geocode(address = ${gcAddr}, method = "osm",`,
        `          lat = ${gcLat}, long = ${gcLon},`,
        `          full_results = FALSE, quiet = TRUE)`,
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


    case "add_column": {
      const stAcOut = stVar(step.nn);
      if (step.dtype === "number") return `gen double ${stAcOut} = ${stValue(step.fill, "number")}`;
      return `gen strL ${stAcOut} = ${stValue(step.fill)}`;
    }

    case "add_row": {
      const stArCount   = Math.max(1, Number(step.count) || 1);
      const stArAssigns = Object.entries(step.values || {})
        .map(([k, v_]) => `replace ${stVar(k)} = ${stValue(v_)} in \`i'`);
      return [
        `* add_row: append ${stArCount} synthetic row(s); unspecified columns remain missing`,
        `local __oldN = _N`,
        `set obs \`= _N + ${stArCount}'`,
        `forvalues i = \`= \`__oldN' + 1'/\`=_N' {`,
        ...stArAssigns.map(x => `  ${x}`),
        `}`,
      ].join("\n");
    }

    case "set_where": {
      const stSwTarget = stVar(step.col);
      if (step.action === "clear") {
        return [
          `capture confirm string variable ${stSwTarget}`,
          `if !_rc replace ${stSwTarget} = "" if ${stWhere(step.where)}`,
          `else replace ${stSwTarget} = . if ${stWhere(step.where)}`,
        ].join("\n");
      }
      return `replace ${stSwTarget} = ${stValue(step.value, step.dtype)} if ${stWhere(step.where)}`;
    }

    case "replace": {
      const stRSrc  = stVar(step.col);
      const stROut  = stVar(step.nn || step.col);
      const stRMode = step.match?.mode || "exact";
      const stRFind = step.match?.find ?? "";
      const stRRepl = step.replaceWith ?? "";
      const stRInit = step.nn ? `capture confirm string variable ${stRSrc}\nif !_rc gen strL ${stROut} = ${stRSrc}\nelse gen double ${stROut} = ${stRSrc}\n` : "";
      if (stRMode === "exact")    return `${stRInit}replace ${stROut} = ${stValue(stRRepl)} if ${stROut} == ${stValue(stRFind)}`;
      if (stRMode === "contains") return `${stRInit}replace ${stROut} = subinstr(${stROut}, ${stStr(stRFind)}, ${stStr(stRRepl)}, .)`;
      return `${stRInit}replace ${stROut} = regexr(${stROut}, ${stStr(stRFind)}, ${stStr(stRRepl)})`;
    }

    case "str_splice": {
      const stSsSrc  = stVar(step.col);
      const stSsOut  = stVar(step.nn || step.col);
      const stSsPos  = Number(step.position) || 1;
      const stSsCnt  = Math.max(0, Number(step.count) || 0);
      const stSsText = stStr(step.text ?? "");
      const stSsInit = step.nn
        ? `gen strL ${stSsOut} = string(${stSsSrc})\n`
        : `capture confirm string variable ${stSsOut}\nif _rc tostring ${stSsOut}, replace force\n`;
      const stSsP    = `cond(${stSsPos} < 0, max(1, length(${stSsOut}) + ${stSsPos} + 1), ${stSsPos})`;
      if (step.mode === "delete")    return `${stSsInit}replace ${stSsOut} = substr(${stSsOut}, 1, ${stSsP} - 1) + substr(${stSsOut}, ${stSsP} + ${stSsCnt}, .)`;
      if (step.mode === "overwrite") return `${stSsInit}replace ${stSsOut} = substr(${stSsOut}, 1, ${stSsP} - 1) + ${stSsText} + substr(${stSsOut}, ${stSsP} + ${stSsCnt}, .)`;
      return `${stSsInit}replace ${stSsOut} = substr(${stSsOut}, 1, ${stSsP} - 1) + ${stSsText} + substr(${stSsOut}, ${stSsP}, .)`;
    }

    case "distinct": {
      const stDiSub = (step.subset ?? []).map(stVar).join(" ");
      return `duplicates drop ${stDiSub}, force`;
    }

    case "group_transform": {
      const stGtBy   = (step.by ?? []).map(stVar).join(" ");
      const stGtOut  = stVar(step.nn ?? `${step.fn ?? "mean"}_${step.col}`);
      const stGtFn   = step.fn ?? "mean";
      const stGtEgen = stGtFn === "count" ? "count" : stGtFn === "sd" ? "sd" : stGtFn === "rank" ? "rank" : stGtFn === "median" ? "median" : stGtFn;
      return `bysort ${stGtBy}: egen ${stGtOut} = ${stGtEgen}(${stVar(step.col ?? (step.by ?? [])[0] ?? "")})`;
    }

    case "pivot_wider": {
      const stPwVals = Array.isArray(step.valuesFrom) ? step.valuesFrom : [step.valuesFrom].filter(Boolean);
      return [
        `* pivot_wider: long -> wide`,
        `reshape wide ${stPwVals.map(stVar).join(" ")}, i(${(step.idCols ?? []).map(stVar).join(" ")}) j(${stVar(step.namesFrom)})`,
      ].join("\n");
    }

    case "bind_cols": {
      return [
        `* bind_cols: align by row order`,
        `gen long __row_order = _n`,
        `preserve`,
        `  ${stataRightLoad(step.rightId, allDatasets)}`,
        `  gen long __row_order = _n`,
        `  save "__bind_cols_tmp.dta", replace`,
        `restore`,
        `merge 1:1 __row_order using "__bind_cols_tmp.dta", keep(match) nogen suffixes("" "${step.suffix ?? "_r"}")`,
        `drop __row_order`,
        `erase "__bind_cols_tmp.dta"`,
      ].join("\n");
    }

    case "union": {
      return [
        `* union: append right dataset, then drop full-row duplicates`,
        `preserve`,
        `  ${stataRightLoad(step.rightId, allDatasets)}`,
        `  save "__union_tmp.dta", replace`,
        `restore`,
        `append using "__union_tmp.dta"`,
        `duplicates drop, force`,
        `erase "__union_tmp.dta"`,
      ].join("\n");
    }

    case "intersect":
    case "setdiff": {
      const stSoKeep = step.type === "intersect" ? "keep(match)" : "keep(master)";
      return [
        `* ${step.type}: merge on shared columns`,
        `preserve`,
        `  ${stataRightLoad(step.rightId, allDatasets)}`,
        `  save "__setop_tmp.dta", replace`,
        `restore`,
        `merge m:1 /* shared keys */ using "__setop_tmp.dta", ${stSoKeep} nogen`,
        `erase "__setop_tmp.dta"`,
      ].join("\n");
    }

    case "vector_assign": {
      const stVaOut    = stVar(step.nn ?? "assigned");
      const stVaValues = step.values ?? [];
      const stVaSeed   = Number.isFinite(Number(step.seed)) ? Number(step.seed) : 42;
      if (step.mode === "recycle") {
        return [
          `gen strL ${stVaOut} = ""`,
          `local vals "${stVaValues.join(" ")}"`,
          `forvalues i = 1/\`=_N' {`,
          `  local k = mod(\`i' - 1, ${stVaValues.length || 1}) + 1`,
          `  replace ${stVaOut} = word("\`vals'", \`k') in \`i'`,
          `}`,
        ].join("\n");
      }
      if (step.mode === "conditional") {
        return [
          `gen strL ${stVaOut} = "${step.elseValue ?? ""}"`,
          ...(step.rules || []).map(r => `replace ${stVaOut} = "${r.value}" if ${r.expr}`),
        ].join("\n");
      }
      return [
        `* NOTE: EconSolver uses a seeded mulberry32 RNG; exported values differ but the distribution matches`,
        `set seed ${stVaSeed}`,
        `gen double __u = runiform()`,
        `gen strL ${stVaOut} = ""`,
        `* assign ${stVaValues.join("/")} by equal or weighted bins`,
        `drop __u`,
      ].join("\n");
    }

    case "clean_strings": {
      const stCsCol = stVar(step.col);
      let stCsIn    = `itrim(strtrim(${stCsCol}))`;
      if (step.case === "lower")      stCsIn = `lower(${stCsIn})`;
      else if (step.case === "upper") stCsIn = `upper(${stCsIn})`;
      else if (step.case === "title") stCsIn = `proper(${stCsIn})`;
      return `replace ${stCsCol} = ${stCsIn}`;
    }

    case "if_else": {
      const stIeOut  = stVar(step.nn);
      const stIeCond = jsExprToStata(step.cond);
      if (!stIeCond) return `* if_else: ${step.nn} = cond(${step.cond}, ...) — translate condition to Stata manually`;
      return `gen ${stIeOut} = cond(${stIeCond}, ${stValue(step.trueVal)}, ${stValue(step.falseVal)})`;
    }

    case "case_when": {
      const stCwOut = stVar(step.nn);
      const stCwBrs = (step.cases ?? [])
        .map(c => { const cc = jsExprToStata(c.cond); return cc ? `replace ${stCwOut} = ${stValue(c.val)} if ${cc}` : null; })
        .filter(Boolean);
      if (!stCwBrs.length) return `* case_when: no valid conditions — translate manually`;
      return [`gen ${stCwOut} = ${stValue(step.defaultVal)}`, ...stCwBrs].join("\n");
    }

    case "grouped_mutate": {
      const stGmBy   = (step.by ?? []).map(stVar).join(" ");
      const stGmOut  = stVar(step.newCol || "grouped");
      const stGmFn   = step.fn ?? "mean";
      if (!stGmBy || !step.newCol) return `* grouped_mutate: incomplete config`;
      const stGmEgen = stGmFn === "sd" ? "sd" : stGmFn === "count" ? "count" : stGmFn === "expr" ? "mean" : stGmFn;
      return [
        `* grouped_mutate: ${stGmFn} over groups${step.condition?.length ? " (row conditions applied in-app — review)" : ""}`,
        `bysort ${stGmBy}: egen ${stGmOut} = ${stGmEgen}(${stVar(step.col || (step.by ?? [])[0] || "")})`,
      ].join("\n");
    }

    case "balance_panel": {
      const stBpEnt  = stVar(step.entityCol);
      const stBpTim  = stVar(step.timeCol);
      const stBpFill = Number(step.fillValue) || 0;
      const stBpLines = [
        `* Balance panel: fill ${step.entityCol} x ${step.timeCol} grid`,
        `xtset ${stBpEnt} ${stBpTim}`,
        `tsfill, full`,
      ];
      for (const oc of (step.outcomeCols ?? []))
        stBpLines.push(`replace ${stVar(oc)} = ${stBpFill} if missing(${stVar(oc)})`);
      return stBpLines.join("\n");
    }

    case "patch":
      return `* manual cell edit (${step.col ?? "column"} @ row ${step.ri ?? step.rowId ?? "?"}) — not replayable on the raw file; load the exported *_cleaned.csv instead`;

    case "inject_column": {
      const stIcVals    = (step.values ?? []).map(v => (v == null ? "." : Number(v).toFixed(8)));
      const stIcMatName = String(step.colName ?? "").replace(/[^a-zA-Z0-9_]/g, "_").slice(0, 32);
      return [
        `* inject_column: "${step.colName}" — extracted from model output`,
        `matrix ${stIcMatName} = (${stIcVals.join(" \\ ")})`,
        `svmat ${stIcMatName}, name(${step.colName})`,
        `rename ${step.colName}1 ${step.colName}`,
      ].join("\n");
    }

    case "geocode": {
      const stGcAddr = step.addressCol ?? "address";
      const stGcLat  = step.latCol ?? "lat";
      const stGcLon  = step.lonCol ?? "lon";
      return [
        `* Geocode: ${stGcAddr} -> ${stGcLat} / ${stGcLon}`,
        `* Stata has no native geocoding — export addresses, geocode externally, merge back.`,
        `preserve`,
        `keep ${stGcAddr}`,
        `duplicates drop`,
        `export delimited using "addresses_to_geocode.csv", replace`,
        `restore`,
        `* After external geocoding:`,
        `* merge m:1 ${stGcAddr} using "geocoded_coords.dta", keep(master match) nogenerate`,
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


    case "add_column":
      return `${df}[${pyStr(step.nn)}] = ${pyValue(step.fill, step.dtype)}`;

    case "add_row": {
      const pyArCount  = Math.max(1, Number(step.count) || 1);
      const pyArValues = JSON.stringify(step.values || {});
      return [
        `# add_row: append ${pyArCount} synthetic row(s); unspecified columns become NaN`,
        `_new_rows = pd.DataFrame([${pyArValues}] * ${pyArCount})`,
        `${df} = pd.concat([${df}, _new_rows], ignore_index=True)`,
      ].join("\n");
    }

    case "set_where":
      return `${df}.loc[${pyWhere(step.where)}, ${pyStr(step.col)}] = ${step.action === "clear" ? "None" : pyValue(step.value, step.dtype)}`;

    case "replace": {
      const pyRSrc  = pyStr(step.col);
      const pyROut  = pyStr(step.nn || step.col);
      const pyRMode = step.match?.mode || "exact";
      const pyRFind = step.match?.find ?? "";
      const pyRRepl = step.replaceWith ?? "";
      if (pyRMode === "exact") {
        return [
          ...(step.nn ? [`${df}[${pyROut}] = ${df}[${pyRSrc}]`] : []),
          `${df}[${pyROut}] = ${df}[${pyROut}].replace(${pyStr(pyRFind)}, ${pyStr(pyRRepl)})`,
        ].join("\n");
      }
      return [
        ...(step.nn ? [`${df}[${pyROut}] = ${df}[${pyRSrc}]`] : []),
        `${df}[${pyROut}] = ${df}[${pyROut}].astype("string").str.replace(${pyStr(pyRFind)}, ${pyStr(pyRRepl)}, regex=${pyRMode === "regex" ? "True" : "False"})`,
      ].join("\n");
    }

    case "str_splice": {
      const pySsSrc = pyStr(step.col);
      const pySsOut = pyStr(step.nn || step.col);
      return [
        `def _litux_splice(v, position, mode, text="", count=0):`,
        `    if pd.isna(v): return v`,
        `    s = str(v)`,
        `    pos = len(s) if position is None else int(position)`,
        `    pos = max(0, min((len(s) + pos + 1) - 1 if pos < 0 else pos - 1, len(s)))`,
        `    n = max(0, int(count or 0))`,
        `    if mode == "insert": return s[:pos] + text + s[pos:]`,
        `    if mode == "delete": return s[:pos] + s[pos+n:]`,
        `    if mode == "overwrite": return s[:pos] + text + s[pos+n:]`,
        `    return s`,
        `${df}[${pySsOut}] = ${df}[${pySsSrc}].apply(lambda v: _litux_splice(v, ${Number(step.position) || 1}, ${pyStr(step.mode || "insert")}, ${pyStr(step.text ?? "")}, ${Number(step.count) || 0}))`,
      ].join("\n");
    }

    case "distinct": {
      const pyDiSub = step.subset ?? [];
      const pyDiArg = pyDiSub.length ? `subset=${pyList(pyDiSub)}, ` : "";
      return `${df} = ${df}.drop_duplicates(${pyDiArg}keep="first").reset_index(drop=True)`;
    }

    case "group_transform": {
      const pyGtBy  = step.by ?? [];
      const pyGtCol = step.col ?? (pyGtBy[0] ?? "");
      const pyGtOut = pyStr(step.nn ?? `${step.fn ?? "mean"}_${pyGtCol}`);
      const pyGtFn  = step.fn ?? "mean";
      const pyGtGrp = `${df}.groupby(${pyList(pyGtBy)})[${pyStr(pyGtCol)}]`;
      if (pyGtFn === "count")  return `${df}[${pyGtOut}] = ${pyGtGrp}.transform("size")`;
      if (pyGtFn === "sd")     return `${df}[${pyGtOut}] = ${pyGtGrp}.transform("std")`;
      if (pyGtFn === "rank")   return `${df}[${pyGtOut}] = ${pyGtGrp}.transform(lambda s: s.rank(method="min"))`;
      return `${df}[${pyGtOut}] = ${pyGtGrp}.transform("${pyGtFn}")`;
    }

    case "bind_cols": {
      const pyBcName = safeDatasetName(step.rightId, allDatasets);
      return [
        `# bind_cols: align rows by current order from right dataset "${pyBcName}"`,
        `right_df = ${pyRightLoad(step.rightId, allDatasets)}`,
        `${df} = pd.concat([${df}.reset_index(drop=True), right_df.reset_index(drop=True)], axis=1)`,
      ].join("\n");
    }

    case "union":
    case "intersect":
    case "setdiff": {
      const pySoName = safeDatasetName(step.rightId, allDatasets);
      const pySoLoad = [
        `# ${step.type}: compare with right dataset "${pySoName}"`,
        `right_df = ${pyRightLoad(step.rightId, allDatasets)}`,
      ];
      if (step.type === "union")
        return [...pySoLoad, `${df} = pd.concat([${df}, right_df], ignore_index=True).drop_duplicates().reset_index(drop=True)`].join("\n");
      if (step.type === "intersect")
        return [...pySoLoad, `${df} = ${df}.merge(right_df, how="inner").drop_duplicates().reset_index(drop=True)`].join("\n");
      return [...pySoLoad, `${df} = ${df}.merge(right_df, how="left", indicator=True).query('_merge == "left_only"').drop(columns="_merge").reset_index(drop=True)`].join("\n");
    }

    case "vector_assign": {
      const pyVaVals = pyList(step.values ?? []);
      const pyVaOut  = step.nn ?? "assigned";
      const pyVaSeed = Number.isFinite(Number(step.seed)) ? Number(step.seed) : 42;
      if (step.mode === "recycle") return `${df}["${pyVaOut}"] = np.resize(${pyVaVals}, len(${df}))`;
      if (step.mode === "conditional") {
        const pyVaConds   = (step.rules || []).map(r => `${df}.eval(${pyStr(r.expr)})`).join(", ");
        const pyVaChoices = (step.rules || []).map(r => pyStr(r.value)).join(", ");
        return `${df}["${pyVaOut}"] = np.select([${pyVaConds}], [${pyVaChoices}], default=${pyStr(step.elseValue ?? "")})`;
      }
      const pyVaWts = Array.isArray(step.weights) ? step.weights.join(", ") : "";
      const pyVaP   = pyVaWts ? `, p=np.array([${pyVaWts}]) / np.sum([${pyVaWts}])` : "";
      return `# NOTE: EconSolver uses a seeded mulberry32 RNG; exported values differ but the distribution matches\n${df}["${pyVaOut}"] = np.random.default_rng(${pyVaSeed}).choice(${pyVaVals}, size=len(${df})${pyVaP})`;
    }

    case "clean_strings": {
      const pyCsCol = pyStr(step.col);
      let pyCsExpr  = `${df}[${pyCsCol}].astype("string").str.strip().str.replace(r"\\s+", " ", regex=True)`;
      if (step.case === "lower")      pyCsExpr += ".str.lower()";
      else if (step.case === "upper") pyCsExpr += ".str.upper()";
      else if (step.case === "title") pyCsExpr += ".str.title()";
      return `${df}[${pyCsCol}] = ${pyCsExpr}`;
    }

    case "if_else": {
      const pyIeOut  = pyStr(step.nn);
      const pyIeCond = jsExprToPython(step.cond, df);
      if (!pyIeCond) return `# if_else: ${step.nn} = where(${step.cond}) — translate condition to Python manually`;
      return `${df}[${pyIeOut}] = np.where(${pyIeCond}, ${pyValue(step.trueVal, "string")}, ${pyValue(step.falseVal, "string")})`;
    }

    case "case_when": {
      const pyCwOut     = pyStr(step.nn);
      const pyCwConds   = [], pyCwChoices = [];
      for (const c of (step.cases ?? [])) {
        const cc = jsExprToPython(c.cond, df);
        if (!cc) continue;
        pyCwConds.push(cc); pyCwChoices.push(pyValue(c.val, "string"));
      }
      if (!pyCwConds.length) return `# case_when: no valid conditions — translate manually`;
      return `${df}[${pyCwOut}] = np.select([${pyCwConds.join(", ")}], [${pyCwChoices.join(", ")}], default=${pyValue(step.defaultVal, "string")})`;
    }

    case "grouped_mutate": {
      const pyGmBy  = step.by ?? [];
      const pyGmOut = pyStr(step.newCol || "grouped");
      const pyGmFn  = step.fn ?? "mean";
      if (!pyGmBy.length || !step.newCol) return `# grouped_mutate: incomplete config`;
      if (pyGmFn === "expr" && step.expr) {
        const pyGmExpr = jsExprToPython(step.expr, df);
        return pyGmExpr
          ? `${df}[${pyGmOut}] = ${df}.groupby(${pyList(pyGmBy)}).apply(lambda g: ${pyGmExpr}).reset_index(level=${pyList(pyGmBy)}, drop=True)`
          : `# grouped_mutate (expr): translate "${step.expr}" to Python manually`;
      }
      const pyGmAgg = pyGmFn === "sd" ? "std" : pyGmFn === "count" ? "size" : pyGmFn;
      const pyGmGrp = step.col
        ? `${df}.groupby(${pyList(pyGmBy)})[${pyStr(step.col)}]`
        : `${df}.groupby(${pyList(pyGmBy)})[${pyStr(pyGmBy[0])}]`;
      return [
        `# grouped_mutate: ${pyGmFn} over groups${step.condition?.length ? " (row conditions applied in-app — review)" : ""}`,
        `${df}[${pyGmOut}] = ${pyGmGrp}.transform("${pyGmAgg}")`,
      ].join("\n");
    }

    case "pivot_wider": {
      const pyPwIds  = pyList(step.idCols ?? []);
      const pyPwVals = Array.isArray(step.valuesFrom) ? step.valuesFrom : [step.valuesFrom].filter(Boolean);
      const pyPwVal  = pyPwVals.length === 1 ? pyStr(pyPwVals[0]) : pyList(pyPwVals);
      const pyPwFill = (step.valuesFill != null && step.valuesFill !== "") ? `, fill_value=${Number(step.valuesFill)}` : "";
      return `${df} = ${df}.pivot_table(index=${pyPwIds}, columns=${pyStr(step.namesFrom)}, values=${pyPwVal}${pyPwFill}, aggfunc="first").reset_index()`;
    }

    case "balance_panel": {
      const pyBpEnt  = pyStr(step.entityCol);
      const pyBpTim  = pyStr(step.timeCol);
      const pyBpDims = step.slotCol ? `[${pyBpEnt}, ${pyBpTim}, ${pyStr(step.slotCol)}]` : `[${pyBpEnt}, ${pyBpTim}]`;
      const pyBpOuts = step.outcomeCols ?? [];
      const pyBpLines = [
        `# Balance panel: complete ${step.entityCol} x ${step.timeCol}${step.slotCol ? ` x ${step.slotCol}` : ""} grid`,
        `_dims = ${pyBpDims}`,
        `_full = pd.MultiIndex.from_product([${df}[c].unique() for c in _dims], names=_dims)`,
        `${df} = ${df}.set_index(_dims).reindex(_full).reset_index()`,
      ];
      if (pyBpOuts.length)
        pyBpLines.push(`${df}[${pyList(pyBpOuts)}] = ${df}[${pyList(pyBpOuts)}].fillna(${Number(step.fillValue) || 0})`);
      return pyBpLines.join("\n");
    }

    case "patch":
      return `# manual cell edit (${step.col ?? "column"} @ row ${step.ri ?? step.rowId ?? "?"}) — not replayable on the raw file; load the exported *_cleaned.csv instead`;

    case "inject_column": {
      const pyIcVals = (step.values ?? []).map(v => (v == null ? "np.nan" : Number(v).toFixed(8))).join(", ");
      return [
        `# inject_column: "${step.colName}" — extracted from model output`,
        `${df}["${step.colName}"] = np.array([${pyIcVals}])`,
      ].join("\n");
    }

    case "geocode": {
      const pyGcAddr = step.addressCol ?? "address";
      const pyGcLat  = step.latCol ?? "lat";
      const pyGcLon  = step.lonCol ?? "lon";
      return [
        `# Geocode: ${pyGcAddr} -> ${pyGcLat} / ${pyGcLon}`,
        `# pip install geopy`,
        `from geopy.geocoders import Nominatim`,
        `from geopy.extra.rate_limiter import RateLimiter`,
        `_geolocator = Nominatim(user_agent="econsolver_replication")`,
        `_geocode    = RateLimiter(_geolocator.geocode, min_delay_seconds=1)`,
        `def _get_coords(address):`,
        `    loc = _geocode(str(address))`,
        `    return (loc.latitude, loc.longitude) if loc else (None, None)`,
        `${df}[["${pyGcLat}", "${pyGcLon}"]] = ${df}["${pyGcAddr}"].apply(`,
        `    lambda a: pd.Series(_get_coords(a))`,
        `)`,
      ].join("\n");
    }

    default:
      return `# [unknown step: ${step.type}]`;
  }
}
