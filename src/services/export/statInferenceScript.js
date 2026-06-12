// Standalone R / Python / Stata snippets for data-level Stat & Simulation tests.

function finiteNumber(v) {
  return typeof v === "number" && isFinite(v);
}

function numberLiteral(v, fallback = "0") {
  const n = Number(v);
  return isFinite(n) ? String(n) : fallback;
}

function clean(values) {
  return (values ?? []).map(Number).filter(finiteNumber);
}

function cleanPairs(a, b) {
  const x = (a ?? []).map(Number), y = (b ?? []).map(Number);
  const left = [], right = [];
  for (let i = 0; i < Math.min(x.length, y.length); i++) {
    if (finiteNumber(x[i]) && finiteNumber(y[i])) { left.push(x[i]); right.push(y[i]); }
  }
  return [left, right];
}

function rVec(values) {
  return `c(${values.map(v => numberLiteral(v, "NA_real_")).join(", ")})`;
}

function pyVec(values) {
  return `[${values.map(v => numberLiteral(v, "float('nan')")).join(", ")}]`;
}

function stataData(columns) {
  const entries = Object.entries(columns);
  const n = Math.max(1, ...entries.map(([, values]) => values.length));
  const lines = ["clear", `set obs ${n}`];
  for (const [name, values] of entries) {
    lines.push(`generate double ${name} = .`);
    values.forEach((value, i) => lines.push(`replace ${name} = ${numberLiteral(value, ".")} in ${i + 1}`));
  }
  return lines;
}

function normalizeOp(op, result) {
  const aliases = {
    mean: "oneSampleMeanTest",
    "two-mean": "twoSampleMeanTest",
    paired: "pairedMeanTest",
    "one-prop": "onePropTest",
    "two-prop": "twoPropTest",
    correlation: "correlationTest",
    variance: "varianceTest",
    "var-ratio": "varianceRatioTest",
    bootstrap: "bootstrapStatistic",
    permutation: "permutationTest",
  };
  return aliases[op] ?? aliases[result?.test] ?? op;
}

function rAlternative(alt) {
  return ["less", "greater"].includes(alt) ? alt : "two.sided";
}

function pyProportionAlternative(alt) {
  return alt === "greater" ? "larger" : alt === "less" ? "smaller" : "two-sided";
}

function rStatisticExpr(name, data = "d") {
  return {
    mean: `mean(${data})`, median: `median(${data})`, sd: `sd(${data})`,
    variance: `var(${data})`, trimmedMean10: `mean(${data}, trim = 0.1)`, iqr: `IQR(${data})`,
  }[name] ?? `mean(${data})`;
}

function pyStatisticExpr(name, data = "d") {
  return {
    mean: `np.mean(${data})`, median: `np.median(${data})`, sd: `np.std(${data}, ddof=1)`,
    variance: `np.var(${data}, ddof=1)`, trimmedMean10: `stats.trim_mean(${data}, 0.1)`,
    iqr: `stats.iqr(${data})`,
  }[name] ?? `np.mean(${data})`;
}

function stataStatisticLines(name, variable = "x") {
  if (name === "trimmedMean10") return [
    `quietly summarize ${variable}, detail`,
    `local lo = r(p10)`,
    `local hi = r(p90)`,
    `quietly summarize ${variable} if ${variable} >= \`lo' & ${variable} <= \`hi'`,
    `return scalar stat = r(mean)`,
  ];
  if (name === "median") return [`quietly summarize ${variable}, detail`, `return scalar stat = r(p50)`];
  if (name === "sd") return [`quietly summarize ${variable}`, `return scalar stat = r(sd)`];
  if (name === "variance") return [`quietly summarize ${variable}`, `return scalar stat = r(Var)`];
  if (name === "iqr") return [`quietly summarize ${variable}, detail`, `return scalar stat = r(p75) - r(p25)`];
  return [`quietly summarize ${variable}`, `return scalar stat = r(mean)`];
}

function rBootstrap(params, result) {
  const x = clean(params.values ?? params.x);
  const statName = params.statName ?? params.statistic ?? result?.stat ?? "mean";
  const B = Math.max(50, Number(params.B ?? result?.B ?? 2000));
  const ciType = params.ciType ?? result?.ciType ?? "percentile";
  const seed = numberLiteral(params.seed ?? result?.seed, "1");
  const bootType = ciType === "bca" ? "bca" : ciType === "basic" ? "basic" : "perc";
  return [
    "# Standalone bootstrap statistic",
    `x <- ${rVec(x)}`,
    `set.seed(${seed})`,
    `statistic <- function(d, i) ${rStatisticExpr(statName, "d[i]")}`,
    `fit <- boot::boot(data = x, statistic = statistic, R = ${B})`,
    `print(fit)`,
    `print(boot::boot.ci(fit, type = ${JSON.stringify(bootType)}))`,
  ].join("\n");
}

function pyBootstrap(params, result) {
  const x = clean(params.values ?? params.x);
  const statName = params.statName ?? params.statistic ?? result?.stat ?? "mean";
  const B = Math.max(50, Number(params.B ?? result?.B ?? 2000));
  const alpha = Number(params.alpha ?? result?.alpha ?? 0.05);
  const ciType = params.ciType ?? result?.ciType ?? "percentile";
  const seed = numberLiteral(params.seed ?? result?.seed, "1");
  return [
    "# Standalone bootstrap statistic",
    "import numpy as np",
    "from scipy import stats",
    `x = np.asarray(${pyVec(x)}, dtype=float)`,
    `np.random.seed(${seed})`,
    `B = ${B}`,
    `alpha = ${numberLiteral(alpha, "0.05")}`,
    `statistic = lambda d: float(${pyStatisticExpr(statName)})`,
    `theta_hat = statistic(x)`,
    `replicates = np.asarray([statistic(x[np.random.randint(0, len(x), len(x))]) for _ in range(B)])`,
    `if ${JSON.stringify(ciType)} == "basic":`,
    `    q_lo, q_hi = np.quantile(replicates, [alpha / 2, 1 - alpha / 2])`,
    `    ci = (2 * theta_hat - q_hi, 2 * theta_hat - q_lo)`,
    `elif ${JSON.stringify(ciType)} == "bca":`,
    `    z0 = stats.norm.ppf(np.mean(replicates < theta_hat))`,
    `    jack = np.asarray([statistic(np.delete(x, i)) for i in range(len(x))])`,
    `    centered = np.mean(jack) - jack`,
    `    acceleration = np.sum(centered ** 3) / (6 * np.sum(centered ** 2) ** 1.5)`,
    `    if not np.isfinite(z0) or not np.isfinite(acceleration):`,
    `        ci = tuple(np.quantile(replicates, [alpha / 2, 1 - alpha / 2]))`,
    `    else:`,
    `        z = stats.norm.ppf([alpha / 2, 1 - alpha / 2])`,
    `        probs = stats.norm.cdf(z0 + (z0 + z) / (1 - acceleration * (z0 + z)))`,
    `        ci = tuple(np.quantile(replicates, probs))`,
    `else:`,
    `    ci = tuple(np.quantile(replicates, [alpha / 2, 1 - alpha / 2]))`,
    `print({"estimate": theta_hat, "bootstrap_se": np.std(replicates, ddof=1), "ci": ci, "seed": ${seed}})`,
  ].join("\n");
}

function stataBootstrap(params, result) {
  const x = clean(params.values ?? params.x);
  const statName = params.statName ?? params.statistic ?? result?.stat ?? "mean";
  const B = Math.max(50, Number(params.B ?? result?.B ?? 2000));
  const ciType = params.ciType ?? result?.ciType ?? "percentile";
  const seed = numberLiteral(params.seed ?? result?.seed, "1");
  return [
    "* Standalone bootstrap statistic",
    ...stataData({ x }),
    `set seed ${seed}`,
    "capture program drop litux_boot_stat",
    "program define litux_boot_stat, rclass",
    ...stataStatisticLines(statName).map(line => `    ${line}`),
    "end",
    `bootstrap stat=r(stat), reps(${B}) seed(${seed}): litux_boot_stat`,
    `* Requested CI type: ${ciType}. Stata reports its available bootstrap intervals below.`,
    "estat bootstrap, all",
  ].join("\n");
}

function rJackknife(params, result) {
  const x = clean(params.values ?? params.x);
  const statName = params.statName ?? params.statistic ?? result?.stat ?? "mean";
  return [
    "# Standalone jackknife statistic",
    `x <- ${rVec(x)}`,
    `statistic <- function(d) ${rStatisticExpr(statName)}`,
    `theta_hat <- statistic(x)`,
    `leave_one_out <- vapply(seq_along(x), function(i) statistic(x[-i]), numeric(1))`,
    `jack_mean <- mean(leave_one_out)`,
    `jack_bias <- (length(x) - 1) * (jack_mean - theta_hat)`,
    `jack_se <- sqrt((length(x) - 1) / length(x) * sum((leave_one_out - jack_mean)^2))`,
    `data.frame(estimate = theta_hat, jackknife_estimate = jack_mean, bias = jack_bias, se = jack_se)`,
  ].join("\n");
}

function pyJackknife(params, result) {
  const x = clean(params.values ?? params.x);
  const statName = params.statName ?? params.statistic ?? result?.stat ?? "mean";
  return [
    "# Standalone jackknife statistic",
    "import numpy as np",
    "from scipy import stats",
    `x = np.asarray(${pyVec(x)}, dtype=float)`,
    `statistic = lambda d: float(${pyStatisticExpr(statName)})`,
    `theta_hat = statistic(x)`,
    `leave_one_out = np.asarray([statistic(np.delete(x, i)) for i in range(len(x))])`,
    `jack_mean = np.mean(leave_one_out)`,
    `jack_bias = (len(x) - 1) * (jack_mean - theta_hat)`,
    `jack_se = np.sqrt((len(x) - 1) / len(x) * np.sum((leave_one_out - jack_mean) ** 2))`,
    `print({"estimate": theta_hat, "jackknife_estimate": jack_mean, "bias": jack_bias, "se": jack_se})`,
  ].join("\n");
}

function stataJackknife(params, result) {
  const x = clean(params.values ?? params.x);
  const statName = params.statName ?? params.statistic ?? result?.stat ?? "mean";
  return [
    "* Standalone jackknife statistic",
    ...stataData({ x }),
    "capture program drop litux_jack_stat",
    "program define litux_jack_stat, rclass",
    ...stataStatisticLines(statName).map(line => `    ${line}`),
    "end",
    "jackknife stat=r(stat): litux_jack_stat",
  ].join("\n");
}

function rContrast(name) {
  return {
    diffMeans: "mean(a) - mean(b)",
    studDiffMeans: "(mean(a) - mean(b)) / sqrt(var(a) / length(a) + var(b) / length(b))",
    diffMedians: "median(a) - median(b)",
    diffSd: "sd(a) - sd(b)",
    meanRatio: "mean(a) / mean(b)",
  }[name] ?? "mean(a) - mean(b)";
}

function pyContrast(name) {
  return {
    diffMeans: "np.mean(a) - np.mean(b)",
    studDiffMeans: "(np.mean(a) - np.mean(b)) / np.sqrt(np.var(a, ddof=1) / len(a) + np.var(b, ddof=1) / len(b))",
    diffMedians: "np.median(a) - np.median(b)",
    diffSd: "np.std(a, ddof=1) - np.std(b, ddof=1)",
    meanRatio: "np.mean(a) / np.mean(b)",
  }[name] ?? "np.mean(a) - np.mean(b)";
}

function rPermutation(params, result) {
  const a = clean(params.a), b = clean(params.b);
  const contrast = params.statName ?? params.contrast ?? result?.contrast ?? "diffMeans";
  const exact = params.exact ?? result?.exact ?? false;
  const B = Math.max(1, Number(params.B ?? result?.nPerm ?? 2000));
  const alt = params.alternative ?? result?.alternative ?? "two-sided";
  const seed = numberLiteral(params.seed ?? result?.seed, "1");
  const extreme = alt === "greater" ? "replicates >= observed" : alt === "less" ? "replicates <= observed" : "abs(replicates) >= abs(observed)";
  return [
    "# Standalone two-sample permutation test",
    `a <- ${rVec(a)}`,
    `b <- ${rVec(b)}`,
    `contrast <- function(a, b) ${rContrast(contrast)}`,
    `observed <- contrast(a, b)`,
    `pooled <- c(a, b)`,
    ...(exact ? [
      `assignments <- combn(seq_along(pooled), length(a))`,
      `replicates <- apply(assignments, 2, function(idx) contrast(pooled[idx], pooled[-idx]))`,
      `p_value <- mean(${extreme})`,
    ] : [
      `set.seed(${seed})`,
      `replicates <- replicate(${B}, { shuffled <- sample(pooled); contrast(shuffled[seq_along(a)], shuffled[-seq_along(a)]) })`,
      `p_value <- (1 + sum(${extreme})) / (${B} + 1)`,
    ]),
    `data.frame(observed = observed, p_value = p_value, exact = ${exact ? "TRUE" : "FALSE"}, permutations = length(replicates))`,
  ].join("\n");
}

function pyPermutation(params, result) {
  const a = clean(params.a), b = clean(params.b);
  const contrast = params.statName ?? params.contrast ?? result?.contrast ?? "diffMeans";
  const exact = params.exact ?? result?.exact ?? false;
  const B = Math.max(1, Number(params.B ?? result?.nPerm ?? 2000));
  const alt = params.alternative ?? result?.alternative ?? "two-sided";
  const seed = numberLiteral(params.seed ?? result?.seed, "1");
  const extreme = alt === "greater" ? "replicates >= observed" : alt === "less" ? "replicates <= observed" : "np.abs(replicates) >= abs(observed)";
  return [
    "# Standalone two-sample permutation test",
    "import itertools",
    "import numpy as np",
    `a = np.asarray(${pyVec(a)}, dtype=float)`,
    `b = np.asarray(${pyVec(b)}, dtype=float)`,
    `contrast = lambda a, b: float(${pyContrast(contrast)})`,
    `observed = contrast(a, b)`,
    `pooled = np.concatenate([a, b])`,
    ...(exact ? [
      `replicates = []`,
      `for idx in itertools.combinations(range(len(pooled)), len(a)):` ,
      `    mask = np.zeros(len(pooled), dtype=bool)`,
      `    mask[list(idx)] = True`,
      `    replicates.append(contrast(pooled[mask], pooled[~mask]))`,
      `replicates = np.asarray(replicates)`,
      `p_value = np.mean(${extreme})`,
    ] : [
      `np.random.seed(${seed})`,
      `replicates = np.asarray([contrast(*(lambda z: (z[:len(a)], z[len(a):]))(np.random.permutation(pooled))) for _ in range(${B})])`,
      `p_value = (1 + np.sum(${extreme})) / (${B} + 1)`,
    ]),
    `print({"observed": observed, "p_value": float(p_value), "exact": ${exact ? "True" : "False"}, "permutations": len(replicates)})`,
  ].join("\n");
}

function stataPermutation(params, result) {
  const a = clean(params.a), b = clean(params.b);
  const contrast = params.statName ?? params.contrast ?? result?.contrast ?? "diffMeans";
  const exact = params.exact ?? result?.exact ?? false;
  const reps = Math.max(1, Number(params.B ?? result?.nPerm ?? 2000));
  const seed = numberLiteral(params.seed ?? result?.seed, "1");
  const values = a.concat(b), group = a.map(() => 0).concat(b.map(() => 1));
  const statistic = {
    diffMeans: ["quietly summarize value if group == 0", "scalar a = r(mean)", "quietly summarize value if group == 1", "return scalar stat = a - r(mean)"],
    diffMedians: ["quietly summarize value if group == 0, detail", "scalar a = r(p50)", "quietly summarize value if group == 1, detail", "return scalar stat = a - r(p50)"],
    diffSd: ["quietly summarize value if group == 0", "scalar a = r(sd)", "quietly summarize value if group == 1", "return scalar stat = a - r(sd)"],
    meanRatio: ["quietly summarize value if group == 0", "scalar a = r(mean)", "quietly summarize value if group == 1", "return scalar stat = a / r(mean)"],
    studDiffMeans: [
      "quietly summarize value if group == 0", "scalar ma = r(mean)", "scalar va = r(Var)", "scalar na = r(N)",
      "quietly summarize value if group == 1", "return scalar stat = (ma - r(mean)) / sqrt(va / na + r(Var) / r(N))",
    ],
  }[contrast] ?? [];
  return [
    "* Standalone two-sample permutation test",
    ...stataData({ value: values, group }),
    `set seed ${seed}`,
    "capture program drop litux_perm_stat",
    "program define litux_perm_stat, rclass",
    ...statistic.map(line => `    ${line}`),
    "end",
    ...(exact ? ["* NOTE: review - official Stata permute samples relabelings; this uses the exact permutation count as reps."] : []),
    `permute group stat=r(stat), reps(${reps}) seed(${seed}): litux_perm_stat`,
  ].join("\n");
}

function generateR(op, params, result) {
  const alt = rAlternative(params.alternative ?? result?.alternative);
  const mu0 = numberLiteral(params.mu0 ?? params.nullValue ?? result?.nullValue, "0");
  if (op === "bootstrapStatistic") return rBootstrap(params, result);
  if (op === "jackknife") return rJackknife(params, result);
  if (op === "permutationTest") return rPermutation(params, result);
  if (op === "onePropTest") return [
    "# Standalone one-proportion z-test",
    `result <- prop.test(${numberLiteral(params.successes)}, ${numberLiteral(params.n)}, p = ${numberLiteral(params.p0 ?? result?.nullValue, "0.5")}, alternative = ${JSON.stringify(alt)}, correct = FALSE)`,
    "print(result)",
  ].join("\n");
  if (op === "twoPropTest") return [
    "# Standalone two-proportion z-test",
    `result <- prop.test(c(${numberLiteral(params.s1)}, ${numberLiteral(params.s2)}), c(${numberLiteral(params.n1)}, ${numberLiteral(params.n2)}), alternative = ${JSON.stringify(alt)}, correct = FALSE)`,
    "print(result)",
  ].join("\n");
  const pairwise = op === "pairedMeanTest" || op === "correlationTest";
  const [a, b] = pairwise ? cleanPairs(params.a, params.b) : [clean(params.a ?? params.values), clean(params.b)];
  if (op === "oneSampleMeanTest") return [`# Standalone one-sample mean test`, `x <- ${rVec(a)}`, `print(t.test(x, mu = ${mu0}, alternative = ${JSON.stringify(alt)}))`].join("\n");
  if (op === "twoSampleMeanTest") return [`# Standalone two-sample mean test`, `a <- ${rVec(a)}`, `b <- ${rVec(b)}`, `print(t.test(a, b, mu = ${mu0}, alternative = ${JSON.stringify(alt)}, var.equal = ${params.pooled ? "TRUE" : "FALSE"}))`].join("\n");
  if (op === "pairedMeanTest") return [`# Standalone paired mean test`, `a <- ${rVec(a)}`, `b <- ${rVec(b)}`, `print(t.test(a, b, paired = TRUE, mu = ${mu0}, alternative = ${JSON.stringify(alt)}))`].join("\n");
  if (op === "correlationTest") return [`# Standalone correlation test`, `a <- ${rVec(a)}`, `b <- ${rVec(b)}`, `print(cor.test(a, b, method = ${JSON.stringify(params.method ?? result?.method ?? "pearson")}, alternative = ${JSON.stringify(alt)}))`].join("\n");
  if (op === "varianceRatioTest") return [`# Standalone variance-ratio test`, `a <- ${rVec(a)}`, `b <- ${rVec(b)}`, `print(var.test(a, b, alternative = ${JSON.stringify(alt)}))`].join("\n");
  if (op === "varianceTest") return [
    "# Standalone one-sample variance test",
    `x <- ${rVec(a)}`,
    `sigma2_0 <- ${mu0}`,
    `statistic <- (length(x) - 1) * var(x) / sigma2_0`,
    `cdf <- pchisq(statistic, df = length(x) - 1)`,
    `p_value <- ${alt === "less" ? "cdf" : alt === "greater" ? "1 - cdf" : "2 * min(cdf, 1 - cdf)"}`,
    `data.frame(variance = var(x), chi_square = statistic, df = length(x) - 1, p_value = p_value)`,
  ].join("\n");
  return "";
}

function generatePython(op, params, result) {
  const alt = params.alternative ?? result?.alternative ?? "two-sided";
  const mu0 = numberLiteral(params.mu0 ?? params.nullValue ?? result?.nullValue, "0");
  if (op === "bootstrapStatistic") return pyBootstrap(params, result);
  if (op === "jackknife") return pyJackknife(params, result);
  if (op === "permutationTest") return pyPermutation(params, result);
  if (op === "onePropTest") return [
    "# Standalone one-proportion z-test",
    "from statsmodels.stats.proportion import proportions_ztest",
    `stat, p_value = proportions_ztest(${numberLiteral(params.successes)}, ${numberLiteral(params.n)}, value=${numberLiteral(params.p0 ?? result?.nullValue, "0.5")}, alternative=${JSON.stringify(pyProportionAlternative(alt))})`,
    `print({"z": stat, "p_value": p_value})`,
  ].join("\n");
  if (op === "twoPropTest") return [
    "# Standalone two-proportion z-test",
    "import numpy as np",
    "from statsmodels.stats.proportion import proportions_ztest",
    `stat, p_value = proportions_ztest(np.asarray([${numberLiteral(params.s1)}, ${numberLiteral(params.s2)}]), np.asarray([${numberLiteral(params.n1)}, ${numberLiteral(params.n2)}]), alternative=${JSON.stringify(pyProportionAlternative(alt))})`,
    `print({"z": stat, "p_value": p_value})`,
  ].join("\n");
  const pairwise = op === "pairedMeanTest" || op === "correlationTest";
  const [a, b] = pairwise ? cleanPairs(params.a, params.b) : [clean(params.a ?? params.values), clean(params.b)];
  const head = ["import numpy as np", "from scipy import stats", `a = np.asarray(${pyVec(a)}, dtype=float)`];
  if (op === "oneSampleMeanTest") return ["# Standalone one-sample mean test", ...head, `print(stats.ttest_1samp(a, popmean=${mu0}, alternative=${JSON.stringify(alt)}))`].join("\n");
  if (op === "twoSampleMeanTest") return ["# Standalone two-sample mean test", ...head, `b = np.asarray(${pyVec(b)}, dtype=float)`, `print(stats.ttest_ind(a - ${mu0}, b, equal_var=${params.pooled ? "True" : "False"}, alternative=${JSON.stringify(alt)}))`].join("\n");
  if (op === "pairedMeanTest") return ["# Standalone paired mean test", ...head, `b = np.asarray(${pyVec(b)}, dtype=float)`, `print(stats.ttest_rel(a - ${mu0}, b, alternative=${JSON.stringify(alt)}))`].join("\n");
  if (op === "correlationTest") {
    const fn = (params.method ?? result?.method) === "spearman" ? "spearmanr" : "pearsonr";
    return [`# Standalone correlation test`, ...head, `b = np.asarray(${pyVec(b)}, dtype=float)`, `print(stats.${fn}(a, b, alternative=${JSON.stringify(alt)}))`].join("\n");
  }
  if (op === "varianceRatioTest") return [
    "# Standalone variance-ratio test", ...head, `b = np.asarray(${pyVec(b)}, dtype=float)`,
    `f_stat = np.var(a, ddof=1) / np.var(b, ddof=1)`, `cdf = stats.f.cdf(f_stat, len(a) - 1, len(b) - 1)`,
    `p_value = ${alt === "less" ? "cdf" : alt === "greater" ? "1 - cdf" : "2 * min(cdf, 1 - cdf)"}`,
    `print({"F": f_stat, "df1": len(a) - 1, "df2": len(b) - 1, "p_value": p_value})`,
  ].join("\n");
  if (op === "varianceTest") return [
    "# Standalone one-sample variance test", ...head, `sigma2_0 = ${mu0}`,
    `statistic = (len(a) - 1) * np.var(a, ddof=1) / sigma2_0`, `cdf = stats.chi2.cdf(statistic, len(a) - 1)`,
    `p_value = ${alt === "less" ? "cdf" : alt === "greater" ? "1 - cdf" : "2 * min(cdf, 1 - cdf)"}`,
    `print({"variance": np.var(a, ddof=1), "chi_square": statistic, "df": len(a) - 1, "p_value": p_value})`,
  ].join("\n");
  return "";
}

function generateStata(op, params, result) {
  const alt = params.alternative ?? result?.alternative ?? "two-sided";
  const mu0 = numberLiteral(params.mu0 ?? params.nullValue ?? result?.nullValue, "0");
  if (op === "bootstrapStatistic") return stataBootstrap(params, result);
  if (op === "jackknife") return stataJackknife(params, result);
  if (op === "permutationTest") return stataPermutation(params, result);
  if (op === "onePropTest") return [`* Standalone one-proportion z-test`, `prtesti ${numberLiteral(params.n)} ${numberLiteral(Number(params.successes) / Number(params.n))} ${numberLiteral(params.p0 ?? result?.nullValue, "0.5")}`].join("\n");
  if (op === "twoPropTest") return [`* Standalone two-proportion z-test`, `prtesti ${numberLiteral(params.n1)} ${numberLiteral(Number(params.s1) / Number(params.n1))} ${numberLiteral(params.n2)} ${numberLiteral(Number(params.s2) / Number(params.n2))}`].join("\n");
  const pairwise = op === "pairedMeanTest" || op === "correlationTest";
  const [a, b] = pairwise ? cleanPairs(params.a, params.b) : [clean(params.a ?? params.values), clean(params.b)];
  if (op === "oneSampleMeanTest") return [`* Standalone one-sample mean test`, ...stataData({ x: a }), `ttest x == ${mu0}`, `* Requested alternative: ${alt}; Stata displays one- and two-sided p-values.`].join("\n");
  if (op === "twoSampleMeanTest") return [`* Standalone two-sample mean test`, ...stataData({ a, b }), `generate double a_null = a - ${mu0}`, `ttest a_null == b, unpaired${params.pooled ? "" : " unequal"}`, `* Tests mean(a) - mean(b) = ${mu0}. Requested alternative: ${alt}; Stata displays one- and two-sided p-values.`].join("\n");
  if (op === "pairedMeanTest") return [`* Standalone paired mean test`, ...stataData({ a, b }), `generate double difference = a - b`, `ttest difference == ${mu0}`, `* Requested alternative: ${alt}; Stata displays one- and two-sided p-values.`].join("\n");
  if (op === "correlationTest") {
    const command = (params.method ?? result?.method) === "spearman" ? "spearman a b, stats(rho p)" : "pwcorr a b, sig";
    return [`* Standalone correlation test`, ...stataData({ a, b }), command, `* Requested alternative: ${alt}; these commands report the standard two-sided significance.`].join("\n");
  }
  if (op === "varianceRatioTest") return [`* Standalone variance-ratio test`, ...stataData({ a, b }), `sdtest a == b`, `* Requested alternative: ${alt}; Stata displays one- and two-sided p-values.`].join("\n");
  if (op === "varianceTest") return [
    "* Standalone one-sample variance test", ...stataData({ x: a }), `scalar sigma2_0 = ${mu0}`, `quietly summarize x`,
    `scalar chi2_stat = (r(N) - 1) * r(Var) / sigma2_0`, `scalar cdf = chi2(r(N) - 1, chi2_stat)`,
    `scalar p_value = ${alt === "less" ? "cdf" : alt === "greater" ? "1 - cdf" : "2 * min(cdf, 1 - cdf)"}`,
    `display "chi2 = " chi2_stat "  p = " p_value`,
  ].join("\n");
  return "";
}

export function generateStatInferenceScript(language, op, params = {}, result = {}) {
  const operation = normalizeOp(op, result);
  if (language === "r") return generateR(operation, params, result);
  if (language === "python") return generatePython(operation, params, result);
  if (language === "stata") return generateStata(operation, params, result);
  return "";
}
