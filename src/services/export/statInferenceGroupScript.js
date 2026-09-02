// ─── ECON STUDIO · services/export/statInferenceGroupScript.js ────────────────
// Replication snippets for the LONG-FORMAT (group-split) sample tests.
//
// The wide-format emitters in statInferenceScript.js dump every observation as
// a literal vector — `a <- c(1.2, 3.4, …)`. That is tolerable for a handful of
// numbers typed into Simulate, and useless for a real dataset: the script is
// unreadable, unrunnable at size, and stops matching the data the moment the
// pipeline changes.
//
// Group mode knows the column names, so it can REFERENCE the data instead:
// `t.test(y ~ treat, data = df)` — which is what a researcher would have
// written by hand, and what actually reproduces the analysis.
//
// Returns null for anything it does not handle, so the caller falls back to the
// existing wide-format emitters unchanged.

import { SERIES_TRANSFORMS } from "../../math/SampleTests.js";

// One vocabulary for the x / |x| / x² transform, shared with the engine and the
// panel. A transform added there without a spelling here would silently export
// a test run on the untransformed series — the script would run and disagree
// with the app.
const tExpr = (id, lang, x) => {
  const t = SERIES_TRANSFORMS.find(e => e.id === id) ?? SERIES_TRANSFORMS[0];
  return t[lang](x);
};

const num = (v, fallback = "0") => {
  const n = Number(v);
  return isFinite(n) ? String(n) : fallback;
};

// Levels arrive as strings from a <select>. Quote them unless the source column
// is numeric, or `inlist(g, "1")` would fail to match a numeric 1 in Stata.
const isNumericLevel = (v) => v !== "" && v !== null && v !== undefined && isFinite(Number(v));

const rLevel  = (v) => (isNumericLevel(v) ? String(Number(v)) : JSON.stringify(String(v)));
const pyStr   = (v) => JSON.stringify(String(v));
const stLevel = (v) => (isNumericLevel(v) ? String(Number(v)) : `"${String(v).replace(/"/g, '""')}"`);
// Backtick a column name R could not parse bare.
const rName   = (c) => (/^[A-Za-z.][A-Za-z0-9._]*$/.test(String(c)) ? String(c) : "`" + String(c) + "`");

const PY_ALT = { "two-sided": "two-sided", less: "smaller", greater: "larger" };
// R spells it "two.sided" with a DOT. Passing the app's "two-sided" through
// verbatim makes t.test/var.test error out, so the script would not run at all.
const rAlt = (a) => (a === "less" || a === "greater" ? a : "two.sided");

/**
 * Column-referencing snippets for the tests that take whole columns.
 *
 * Applies whenever the panel is backed by a real DATASET. Simulate keeps the
 * literal-vector emitters on purpose — its samples exist nowhere but in the
 * browser, so inlining them is the only way the script can run at all. Over a
 * loaded dataset that same dump is fatal: at 1000 rows R refuses the input
 * outright ("maximum number of characters accepted by R in a single line of
 * input is 4094").
 *
 * @param dataset { colA, colB } — column names behind the two samples
 */
export function columnRefSnippet(language, op, dataset, params = {}) {
  if (!dataset?.colA) return null;
  const { colA: a, colB: b } = dataset;
  const alt = params.alternative ?? "two-sided";
  const mu0 = num(params.mu0 ?? params.nullValue);
  const method = params.method ?? "pearson";
  const L = (...lines) => lines.join("\n");
  const needsB = op === "pairedMeanTest" || op === "correlationTest" ||
                 op === "twoSampleMeanTest" || op === "varianceRatioTest";
  if (needsB && !b) return null;

  if (language === "r") {
    const A = `df$${rName(a)}`, B = b ? `df$${rName(b)}` : null;
    const ALT = JSON.stringify(rAlt(alt));
    if (op === "oneSampleMeanTest") return L("# One-sample mean test", `print(t.test(${A}, mu = ${mu0}, alternative = ${ALT}))`);
    if (op === "pairedMeanTest")    return L("# Paired mean test", `print(t.test(${A}, ${B}, paired = TRUE, mu = ${mu0}, alternative = ${ALT}))`);
    if (op === "correlationTest")   return L("# Correlation test", `print(cor.test(${A}, ${B}, method = ${JSON.stringify(method)}, alternative = ${ALT}))`);
    if (op === "twoSampleMeanTest") return L("# Two-sample mean test", `print(t.test(${A}, ${B}, mu = ${mu0}, alternative = ${ALT}, var.equal = ${params.pooled ? "TRUE" : "FALSE"}))`);
    if (op === "varianceRatioTest") return L("# Variance-ratio test", `print(var.test(${A}, ${B}, alternative = ${ALT}))`);
    if (op === "ljungBoxTest") return L(
      `# ${params.type === "Box-Pierce" ? "Box-Pierce" : "Ljung-Box"} test for serial correlation`,
      `x <- ${A}[!is.na(${A})]`,
      ...(params.transform && params.transform !== "raw" ? [`x <- ${tExpr(params.transform, "rExpr", "x")}`] : []),
      `print(Box.test(x, lag = ${num(params.lags, "10")}, type = ${JSON.stringify(params.type === "Box-Pierce" ? "Box-Pierce" : "Ljung-Box")}, fitdf = ${num(params.fitdf, "0")}))`,
    );
    if (op === "normalityTest") return L(
      "# Jarque-Bera test for normality (requires: install.packages(\"tseries\"))",
      `x <- ${A}[!is.na(${A})]`,
      ...(params.transform && params.transform !== "raw" ? [`x <- ${tExpr(params.transform, "rExpr", "x")}`] : []),
      "print(tseries::jarque.bera.test(x))",
    );
    if (op === "varianceTest") return L(
      "# One-sample variance test",
      `x <- ${A}[!is.na(${A})]`,
      `sigma2_0 <- ${mu0}`,
      "statistic <- (length(x) - 1) * var(x) / sigma2_0",
      "cdf <- pchisq(statistic, df = length(x) - 1)",
      `p_value <- ${alt === "less" ? "cdf" : alt === "greater" ? "1 - cdf" : "2 * min(cdf, 1 - cdf)"}`,
      "print(data.frame(variance = var(x), chi_square = statistic, df = length(x) - 1, p_value = p_value))",
    );
    return null;
  }

  if (language === "python") {
    const A = `df[${pyStr(a)}].dropna().astype(float)`;
    const B = b ? `df[${pyStr(b)}].dropna().astype(float)` : null;
    if (op === "oneSampleMeanTest") return L("# One-sample mean test", `a = ${A}`, `print(stats.ttest_1samp(a, popmean=${mu0}, alternative=${JSON.stringify(alt)}))`);
    if (op === "pairedMeanTest")    return L("# Paired mean test", `a = ${A}`, `b = ${B}`, `print(stats.ttest_rel(a - ${mu0}, b, alternative=${JSON.stringify(alt)}))`);
    if (op === "correlationTest")   return L("# Correlation test", `a = ${A}`, `b = ${B}`, `print(stats.${method === "spearman" ? "spearmanr" : "pearsonr"}(a, b, alternative=${JSON.stringify(alt)}))`);
    if (op === "twoSampleMeanTest") return L("# Two-sample mean test", `a = ${A}`, `b = ${B}`, `print(stats.ttest_ind(a - ${mu0}, b, equal_var=${params.pooled ? "True" : "False"}, alternative=${JSON.stringify(alt)}))`);
    if (op === "varianceRatioTest") return L(
      "# Variance-ratio test", `a = ${A}`, `b = ${B}`,
      "f_stat = np.var(a, ddof=1) / np.var(b, ddof=1)",
      "cdf = stats.f.cdf(f_stat, len(a) - 1, len(b) - 1)",
      `p_value = ${alt === "less" ? "cdf" : alt === "greater" ? "1 - cdf" : "2 * min(cdf, 1 - cdf)"}`,
      'print({"F": f_stat, "df1": len(a) - 1, "df2": len(b) - 1, "p_value": p_value})',
    );
    if (op === "ljungBoxTest") return L(
      `# ${params.type === "Box-Pierce" ? "Box-Pierce" : "Ljung-Box"} test for serial correlation`,
      "from statsmodels.stats.diagnostic import acorr_ljungbox",
      `x = ${A}`,
      ...(params.transform && params.transform !== "raw" ? [`x = ${tExpr(params.transform, "pyExpr", "x")}`] : []),
      `print(acorr_ljungbox(x, lags=[${num(params.lags, "10")}], model_df=${num(params.fitdf, "0")}, boxpierce=${params.type === "Box-Pierce" ? "True" : "False"}, return_df=True))`,
    );
    if (op === "normalityTest") return L(
      "# Jarque-Bera test for normality",
      `x = ${A}`,
      ...(params.transform && params.transform !== "raw" ? [`x = ${tExpr(params.transform, "pyExpr", "x")}`] : []),
      "print(stats.jarque_bera(x))",
    );
    if (op === "varianceTest") return L(
      "# One-sample variance test", `x = ${A}`,
      `sigma2_0 = ${mu0}`,
      "statistic = (len(x) - 1) * np.var(x, ddof=1) / sigma2_0",
      "cdf = stats.chi2.cdf(statistic, len(x) - 1)",
      `p_value = ${alt === "less" ? "cdf" : alt === "greater" ? "1 - cdf" : "2 * min(cdf, 1 - cdf)"}`,
      'print({"variance": float(np.var(x, ddof=1)), "chi_square": statistic, "df": len(x) - 1, "p_value": p_value})',
    );
    return null;
  }

  if (language === "stata") {
    const note = `* Requested alternative: ${alt}; Stata displays one- and two-sided p-values.`;
    if (op === "oneSampleMeanTest") return L("* One-sample mean test", `ttest ${a} == ${mu0}`, note);
    // In Stata `ttest v1 == v2` is the PAIRED form; unpaired needs the option.
    if (op === "pairedMeanTest")    return L("* Paired mean test", `ttest ${a} == ${b}`, note);
    if (op === "twoSampleMeanTest") return L("* Two-sample mean test", `ttest ${a} == ${b}, unpaired${params.pooled ? "" : " unequal"}`, note);
    if (op === "varianceRatioTest") return L("* Variance-ratio test", `sdtest ${a} == ${b}`, note);
    if (op === "correlationTest")   return L("* Correlation test", method === "spearman" ? `spearman ${a} ${b}, stats(rho p)` : `pwcorr ${a} ${b}, sig`, "* These commands report the standard two-sided significance.");
    // wntestq needs a time index, so the series is put on one inside a
    // preserve/restore block rather than tsset-ing the user's data behind
    // their back.
    if (op === "ljungBoxTest") return L(
      "* Ljung-Box test for serial correlation",
      "preserve",
      `quietly keep if !missing(${a})`,
      `generate double _lbx = ${tExpr(params.transform ?? "raw", "stataExpr", a)}`,
      "generate long _lbt = _n",
      "tsset _lbt",
      `wntestq _lbx, lags(${num(params.lags, "10")})`,
      ...(params.type === "Box-Pierce" ? ["* NOTE: wntestq is the Ljung-Box portmanteau Q. Base Stata has no Box-Pierce variant, so this is NOT the statistic the app displayed."] : []),
      ...(Number(params.fitdf) > 0 ? [`* NOTE: wntestq has no fitdf option; the app used df = lags - ${num(params.fitdf, "0")}, this reports df = lags.`] : []),
      "restore",
    );
    if (op === "normalityTest") return L(
      "* Jarque-Bera test for normality",
      "* Base Stata has no Jarque-Bera command — sktest is D'Agostino-Belanger-D'Agostino,",
      "* a different test — so JB is computed from the sample moments directly.",
      "preserve",
      `quietly keep if !missing(${a})`,
      `generate double _jbx = ${tExpr(params.transform ?? "raw", "stataExpr", a)}`,
      "quietly summarize _jbx, detail",
      "scalar JB = r(N)/6 * (r(skewness)^2 + (r(kurtosis) - 3)^2/4)",
      "scalar JB_p = chi2tail(2, JB)",
      'display "JB = " JB "  df = 2  p = " JB_p',
      "restore",
    );
    if (op === "varianceTest") return L(
      "* One-sample variance test", `scalar sigma2_0 = ${mu0}`, `quietly summarize ${a}`,
      "scalar chi2_stat = (r(N) - 1) * r(Var) / sigma2_0",
      "scalar cdf = chi2(r(N) - 1, chi2_stat)",
      `scalar p_value = ${alt === "less" ? "cdf" : alt === "greater" ? "1 - cdf" : "2 * min(cdf, 1 - cdf)"}`,
      "display chi2_stat, p_value",
    );
    return null;
  }
  return null;
}

/**
 * @param language  "r" | "python" | "stata"
 * @param op        canonical op name from statInferenceScript's normaliseOp
 * @param group     { valueCol, groupCol, levelA, levelB }
 * @param params    { alternative, pooled, mu0 }
 * @returns string snippet, or null when not applicable
 */
export function groupInferenceSnippet(language, op, group, params = {}) {
  if (!group?.groupCol || !group?.valueCol) return null;
  const { valueCol: y, groupCol: g, levelA: A, levelB: B } = group;
  const alt = params.alternative ?? "two-sided";
  const L = (...lines) => lines.join("\n");

  if (language === "r") {
    // factor(..., levels = c(A, B)) does two jobs at once: it fixes the contrast
    // direction, and turns every OTHER level into NA, which the formula methods
    // drop. Without it a third level would make t.test error out.
    const fac = `factor(${rName(g)}, levels = c(${rLevel(A)}, ${rLevel(B)}))`;
    if (op === "twoSampleMeanTest") {
      return L(
        "# Two-sample mean test, long format",
        `print(t.test(${rName(y)} ~ ${fac}, data = df,`,
        `             alternative = ${JSON.stringify(rAlt(alt))}, var.equal = ${params.pooled ? "TRUE" : "FALSE"}, mu = ${num(params.mu0)}))`,
      );
    }
    if (op === "varianceRatioTest") {
      return L(
        "# Variance-ratio test, long format",
        `print(var.test(${rName(y)} ~ ${fac}, data = df, alternative = ${JSON.stringify(rAlt(alt))}))`,
      );
    }
    if (op === "twoPropTest") {
      return L(
        "# Two-proportion test on a binary outcome, long format",
        `d  <- subset(df, as.character(${rName(g)}) %in% as.character(c(${rLevel(A)}, ${rLevel(B)})))`,
        `gA <- as.character(d[["${g}"]]) == as.character(${rLevel(A)})`,
        `gB <- as.character(d[["${g}"]]) == as.character(${rLevel(B)})`,
        `ok <- !is.na(d[["${y}"]])`,
        `print(prop.test(c(sum(d[["${y}"]][gA & ok] == 1), sum(d[["${y}"]][gB & ok] == 1)),`,
        `                c(sum(gA & ok), sum(gB & ok)), correct = FALSE))`,
      );
    }
    return null;
  }

  if (language === "python") {
    // Compare the group column as text so a numeric 1 and the string "1" match,
    // exactly as splitByGroup does in the app.
    const pick = (lvl) => `df.loc[df[${pyStr(g)}].astype("string") == ${pyStr(lvl)}, ${pyStr(y)}]`;
    const head = [`a = ${pick(A)}.dropna().astype(float)`, `b = ${pick(B)}.dropna().astype(float)`];
    if (op === "twoSampleMeanTest") {
      return L(
        "# Two-sample mean test, long format", ...head,
        `print(stats.ttest_ind(a - ${num(params.mu0)}, b, equal_var=${params.pooled ? "True" : "False"}, alternative=${JSON.stringify(alt)}))`,
      );
    }
    if (op === "varianceRatioTest") {
      const p = alt === "less" ? "cdf" : alt === "greater" ? "1 - cdf" : "2 * min(cdf, 1 - cdf)";
      return L(
        "# Variance-ratio test, long format", ...head,
        "f_stat = np.var(a, ddof=1) / np.var(b, ddof=1)",
        "cdf = stats.f.cdf(f_stat, len(a) - 1, len(b) - 1)",
        `p_value = ${p}`,
        'print({"F": f_stat, "df1": len(a) - 1, "df2": len(b) - 1, "p_value": p_value})',
      );
    }
    if (op === "twoPropTest") {
      return L(
        "# Two-proportion test on a binary outcome, long format",
        "from statsmodels.stats.proportion import proportions_ztest", ...head,
        `print(proportions_ztest([a.sum(), b.sum()], [len(a), len(b)], alternative=${JSON.stringify(PY_ALT[alt] ?? "two-sided")}))`,
      );
    }
    return null;
  }

  if (language === "stata") {
    // ttest/sdtest/prtest with by() IS Stata's native idiom for this — the wide
    // form had to invent two variables and load them as literal data.
    const keep = `if inlist(${g}, ${stLevel(A)}, ${stLevel(B)})`;
    if (op === "twoSampleMeanTest") {
      return L(
        "* Two-sample mean test, long format",
        `ttest ${y} ${keep}, by(${g})${params.pooled ? "" : " unequal"}`,
        alt === "two-sided" ? "* Stata prints both one-sided and the two-sided p-value."
                            : `* Requested alternative: ${alt} — read the matching one-sided p-value.`,
      );
    }
    if (op === "varianceRatioTest") {
      return L("* Variance-ratio test, long format", `sdtest ${y} ${keep}, by(${g})`);
    }
    if (op === "twoPropTest") {
      return L("* Two-proportion test on a binary outcome, long format", `prtest ${y} ${keep}, by(${g})`);
    }
    return null;
  }

  return null;
}
