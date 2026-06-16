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
    case "timeseries":   return `* time series: ${p.agg ?? "mean"}(${p.yCol}) over ${p.timeCol}\ncollapse (${p.agg ?? "mean"}) ${p.yCol}, by(${p.timeCol}${p.groupCol ? ` ${p.groupCol}` : ""})\ntwoway line ${p.yCol} ${p.timeCol}`;
    case "correlation":  return `correlate ${cols}`;
    case "acf_pacf":     return `ac ${p.yCol}\npac ${p.yCol}`;
    case "adf":          return `dfuller ${p.yCol}`;
    case "overdispersion": return `summarize ${p.col}, detail  /* compare mean vs variance for overdispersion */`;
    default:             return null;
  }
}

export function transpileExploreStat(params = {}, language = "r", dfVar = "df") {
  const code = language === "python" ? pyExplore(params, dfVar)
             : language === "stata"  ? stataExplore(params)
             :                         rExplore(params, dfVar);
  if (!code) return null;
  // The pin records the active QuickFilter — note it so the user re-applies it.
  if (Array.isArray(params.filters) && params.filters.length) {
    const note = language === "stata" ? "* " : language === "python" ? "# " : "# ";
    return `${note}NOTE: this pin was taken under an active Explore filter — re-apply it before running.\n${code}`;
  }
  return code;
}
