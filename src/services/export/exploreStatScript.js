// ─── Explore pin (explore_stat) replication translator ───────────────────────
// Plan: docs/superpowers/plans/2026-06-14-spatial-replication.md (plot follow-up)
//
// The Explore tab's Summary / Distributions / Time Series / Correlation pins
// (the ⊕ Pin button) log a descriptive recipe to the sessionLog:
//   { module:"explore", opType:"explore_stat", params:{ kind, ... } }
// Unlike the PlotBuilder ("◈ Plot Builder" tab → plotHistory), these are NOT
// PlotBuilder configs, so the Track P ggplot translator can't consume them.
// This module turns each pinned kind into R / Python / Stata code.
//
// Public: transpileExploreStat(params, language, dfVar) -> string|null

import { predicateToR, predicateToPython, predicateToStata } from "../../pipeline/predicateExport.js";
import { normalizeOp } from "../../pipeline/predicate.js";

const rStr  = (s) => `"${String(s ?? "").replace(/\\/g, "\\\\").replace(/"/g, '\\"')}"`;
const pyStr = rStr;

// ggplot labs(...) from optional pinned title/x/y labels (empty → omitted).
function rLabs(p) {
  const parts = [];
  if (p.title)  parts.push(`title = ${rStr(p.title)}`);
  if (p.xLabel) parts.push(`x = ${rStr(p.xLabel)}`);
  if (p.yLabel) parts.push(`y = ${rStr(p.yLabel)}`);
  return parts.length ? ` +\n  ggplot2::labs(${parts.join(", ")})` : "";
}

// ─── R ────────────────────────────────────────────────────────────────────────
function rExplore(p, df) {
  const cols = (p.columns ?? p.cols ?? []).map(rStr).join(", ");
  switch (p.kind) {
    case "summary":
      return p.groupBy
        ? `${df} |> dplyr::group_by(${p.groupBy}) |> dplyr::summarise(dplyr::across(c(${cols}), list(mean = ~mean(.x, na.rm = TRUE), sd = ~sd(.x, na.rm = TRUE)), .names = "{.col}_{.fn}"))`
        : `summary(${df}[, c(${cols})])`;
    case "head":
    case "tail":
      return `${p.kind}(${df}, ${Number(p.n) || 10})`;
    case "histogram": {
      const x = p.transform === "log" ? `log(${p.col})` : p.transform === "sqrt" ? `sqrt(${p.col})` : p.col;
      return `ggplot2::ggplot(${df}, ggplot2::aes(x = ${x})) +\n  ggplot2::geom_histogram(bins = ${Number(p.bins) || 30})${rLabs(p)}`;
    }
    case "barchart": {
      const x = p.order === "count" ? `forcats::fct_infreq(${p.col})` : p.col;
      return `ggplot2::ggplot(${df}, ggplot2::aes(x = ${x})) +\n  ggplot2::geom_bar()${rLabs(p)}`;
    }
    case "spaghetti":
      return `ggplot2::ggplot(${df}, ggplot2::aes(x = ${p.timeCol}, y = ${p.col}, group = ${p.entityCol})) +\n  ggplot2::geom_line(alpha = 0.3)`;
    case "timeseries": {
      const grp = p.groupCol ? `, ${p.groupCol}` : "";
      const color = p.groupCol ? `, color = ${p.groupCol}` : "";
      return [
        `${df} |>`,
        `  dplyr::group_by(${p.timeCol}${grp}) |>`,
        `  dplyr::summarise(.value = ${p.agg ?? "mean"}(${p.yCol}, na.rm = TRUE), .groups = "drop") |>`,
        `  ggplot2::ggplot(ggplot2::aes(x = ${p.timeCol}, y = .value${color})) +`,
        `  ggplot2::geom_line()`,
      ].join("\n");
    }
    case "correlation":
      return `cor(${df}[, c(${cols})], use = "pairwise.complete.obs", method = ${rStr(p.method ?? "pearson")})`;
    case "acf_pacf":
      return `acf(${df}$${p.yCol}, lag.max = ${Number(p.maxLag) || 20})\npacf(${df}$${p.yCol}, lag.max = ${Number(p.maxLag) || 20})`;
    case "adf":
      return `tseries::adf.test(${df}$${p.yCol})`;
    case "overdispersion":
      return `# Overdispersion check for ${p.col}: var/mean (Poisson ⇒ ≈ 1)\nc(mean = mean(${df}$${p.col}, na.rm = TRUE), var = var(${df}$${p.col}, na.rm = TRUE), ratio = var(${df}$${p.col}, na.rm = TRUE) / mean(${df}$${p.col}, na.rm = TRUE))`;
    default:
      return null;
  }
}

// ─── Python ─────────────────────────────────────────────────────────────────
function pyExplore(p, df) {
  const cols = (p.columns ?? p.cols ?? []).map(pyStr).join(", ");
  switch (p.kind) {
    case "summary":
      return p.groupBy
        ? `${df}.groupby(${pyStr(p.groupBy)})[[${cols}]].agg(["mean", "std"])`
        : `${df}[[${cols}]].describe()`;
    case "head":
    case "tail":
      return `${df}.${p.kind}(${Number(p.n) || 10})`;
    case "histogram": {
      const x = p.transform === "log" ? `np.log(${df}[${pyStr(p.col)}])` : p.transform === "sqrt" ? `np.sqrt(${df}[${pyStr(p.col)}])` : `${df}[${pyStr(p.col)}]`;
      return `${x}.plot.hist(bins=${Number(p.bins) || 30})`;
    }
    case "barchart":
      return `${df}[${pyStr(p.col)}].value_counts(${p.order === "count" ? "" : "sort=False"}).plot.bar()`;
    case "spaghetti":
      return `${df}.pivot_table(index=${pyStr(p.timeCol)}, columns=${pyStr(p.entityCol)}, values=${pyStr(p.col)}).plot(legend=False, alpha=0.3)`;
    case "timeseries": {
      const by = p.groupCol ? `[${pyStr(p.timeCol)}, ${pyStr(p.groupCol)}]` : `${pyStr(p.timeCol)}`;
      const tail = p.groupCol ? `.unstack().plot()` : `.plot()`;
      return `${df}.groupby(${by})[${pyStr(p.yCol)}].${p.agg ?? "mean"}()${tail}`;
    }
    case "correlation":
      return `${df}[[${cols}]].corr(method=${pyStr(p.method ?? "pearson")})`;
    case "acf_pacf":
      return [
        `from statsmodels.graphics.tsaplots import plot_acf, plot_pacf`,
        `plot_acf(${df}[${pyStr(p.yCol)}].dropna(), lags=${Number(p.maxLag) || 20})`,
        `plot_pacf(${df}[${pyStr(p.yCol)}].dropna(), lags=${Number(p.maxLag) || 20})`,
      ].join("\n");
    case "adf":
      return `from statsmodels.tsa.stattools import adfuller\nadfuller(${df}[${pyStr(p.yCol)}].dropna())`;
    case "overdispersion":
      return `# Overdispersion check for ${p.col}: var/mean (Poisson ⇒ ≈ 1)\n${df}[${pyStr(p.col)}].agg(["mean", "var"])`;
    default:
      return null;
  }
}

// ─── Stata (native equivalents where they exist) ─────────────────────────────
function stataExplore(p) {
  const cols = (p.columns ?? p.cols ?? []).join(" ");
  switch (p.kind) {
    case "summary":      return p.groupBy ? `by ${p.groupBy}, sort: summarize ${cols}` : `summarize ${cols}`;
    case "head":         return `list in 1/${Number(p.n) || 10}`;
    case "tail":         return `list in -${Number(p.n) || 10}/l`;
    case "histogram":    return `histogram ${p.col}, bins(${Number(p.bins) || 30})`;
    case "barchart":     return `graph bar (count), over(${p.col})`;
    case "spaghetti":    return `xtline ${p.col}, overlay i(${p.entityCol}) t(${p.timeCol})`;
    case "timeseries": {
      // `twoway line y t` after a grouped collapse draws ONE polyline through
      // every group in file order, which is not the chart the pin shows (R gets
      // color = group, pandas unstacks). xtline overlays one line per group.
      const agg = p.agg ?? "mean";
      const head = `* time series: ${agg}(${p.yCol}) over ${p.timeCol}${p.groupCol ? ` by ${p.groupCol}` : ""}`;
      if (!p.groupCol) {
        return [head, `collapse (${agg}) ${p.yCol}, by(${p.timeCol})`, `sort ${p.timeCol}`,
                `twoway line ${p.yCol} ${p.timeCol}`].join("\n");
      }
      return [head,
        `collapse (${agg}) ${p.yCol}, by(${p.timeCol} ${p.groupCol})`,
        `capture drop _lx_grp`,
        `egen _lx_grp = group(${p.groupCol}), label`,
        `xtset _lx_grp ${p.timeCol}`,
        `xtline ${p.yCol}, overlay`,
      ].join("\n");
    }
    case "correlation":  return `correlate ${cols}`;
    case "acf_pacf":     return `ac ${p.yCol}\npac ${p.yCol}`;
    case "adf":          return `dfuller ${p.yCol}`;
    case "overdispersion": return `summarize ${p.col}, detail  /* compare mean vs variance for overdispersion */`;
    default:             return null;
  }
}

// The Explore filter bar's conditions ({col, op, val}), as a predicate node.
// Conditions the app itself treats as INERT are dropped so the script filters
// exactly the rows the pin saw: `in` with nothing selected keeps every row, and
// a half-typed numeric comparison does too (see matchCond in ExplorerModule).
export function pinFilterNode(filters) {
  const children = [];
  for (const f of (Array.isArray(filters) ? filters : [])) {
    if (!f?.col || !f?.op) continue;
    const op = normalizeOp(f.op);
    // The filter bar writes `val`; a logged/older pin can carry `value`.
    const raw = f.val ?? f.value;
    if (op === "in" || op === "nin") {
      const values = Array.isArray(raw) ? raw
        : String(raw ?? "").split(",").map(v => v.trim()).filter(Boolean);
      if (!values.length) continue;
      children.push({ type: "condition", col: f.col, op, values });
      continue;
    }
    if (["gt", "lt", "gte", "lte"].includes(op) && !Number.isFinite(parseFloat(raw))) continue;
    children.push({ type: "condition", col: f.col, op, value: raw });
  }
  if (!children.length) return null;
  return children.length === 1 ? children[0] : { type: "and", children };
}

// Compile a row scope (the Explore filter bar's conditions) into the lines that
// reproduce it, for a pin OR a saved plot — both are artifacts that record the
// rows they were drawn on, so they must emit the same filter the same way.
// Returns { pre, post, df }: `df` is the frame the caller's own code must read.
// The work is done on a COPY so the block cannot change what the next one sees;
// in Stata that means keep-if, wrapped in preserve/restore when the caller is
// not already inside one.
export function filterScopeBlock(filters, language = "r", dfVar = "df", { varName = null, wrapStata = false } = {}) {
  const node = pinFilterNode(filters);
  if (!node) return { pre: [], post: [], df: dfVar };
  const cm = language === "stata" ? "*" : "#";
  try {
    if (language === "stata") {
      const keep = `keep if ${predicateToStata(node)}`;
      return wrapStata
        ? { pre: ["preserve", keep], post: ["restore"], df: dfVar }
        : { pre: [keep], post: [], df: dfVar };
    }
    if (language === "python") {
      const v = varName || "_pin_d";
      return { pre: [`${v} = ${dfVar}[${predicateToPython(node, { df: dfVar })}]`], post: [], df: v };
    }
    const v = varName || ".pin_d";
    return { pre: [`${v} <- dplyr::filter(${dfVar}, ${predicateToR(node)})`], post: [], df: v };
  } catch (e) {
    // An operator no compiler can express must not silently widen the sample.
    return {
      pre: [`${cm} NOTE: this filter could not be translated (${e.message}) — re-apply it before running.`],
      post: [], df: dfVar,
    };
  }
}

export function transpileExploreStat(params = {}, language = "r", dfVar = "df") {
  // A filtered pin works on its own copy of the data, so the block cannot change
  // what the next one sees. In Stata that means `keep if` — the caller runs pins
  // inside preserve/restore (services/export/unifiedScript.js).
  const { pre, df } = filterScopeBlock(params.filters, language, dfVar);
  const code = language === "python" ? pyExplore(params, df)
             : language === "stata"  ? stataExplore(params)
             :                         rExplore(params, df);
  if (!code) return null;
  return [...pre, code].join("\n");
}
