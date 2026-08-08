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
