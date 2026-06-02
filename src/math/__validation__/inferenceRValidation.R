# Reference values for src/math/__validation__/inferenceValidation.js
# Run in R; paste the printed numbers into suiteRCrossCheck's EXPECTED object.
# Convention: coefficients/statistics to 6 dp, p-values to 4 dp.
a <- c(1, 2, 3, 4, 5); b <- c(2, 3, 4, 5, 6)
print(t.test(a, b, var.equal = TRUE))            # pooled two-sample t  -> p ~ 0.3466
print(t.test(a, b))                              # Welch                -> p ~ 0.3466
print(t.test(c(1, 2, 4), c(2, 2, 2), paired = TRUE))  # paired           -> p ~ 0.7418
print(prop.test(60, 100, p = 0.5, correct = FALSE))   # one proportion   -> p ~ 0.0455
print(prop.test(c(50, 50), c(100, 100), correct = FALSE))  # two prop     -> p ~ 1
print(cor.test(c(1, 2, 3), c(1, 3, 2), method = "pearson"))   # r = 0.5    -> p ~ 0.6667
print(cor.test(c(1, 2, 3, 4), c(1, 4, 9, 16), method = "spearman"))  # rho = 1
print(var.test(c(1, 3, 5, 7, 9), c(2, 3, 4, 5, 6)))   # F = 4, df (4,4)  -> p ~ 0.2080

# Bootstrap (method check only — seed-dependent; R's RNG != mulberry32 so the
# bootstrap CIs are compared with a loose 1e-2 band, same rationale as the
# DuckDB HAC/HC2/HC3 cells in CLAUDE.md):
library(boot)
set.seed(1); v <- c(2, 4, 4, 4, 5, 5, 7, 9)
bs <- boot(v, function(d, i) mean(d[i]), R = 2000)
print(boot.ci(bs, type = c("perc", "basic", "bca")))

# ── Quantile Treatment Effects (unconditional) — suiteQTE ─────────────────────
# Fixture: location+scale shift. D = 0/1.
y  <- c(1, 2, 3, 4, 5, 2, 4, 6, 8, 10)
D  <- c(0, 0, 0, 0, 0, 1, 1, 1, 1, 1)
y0 <- y[D == 0]; y1 <- y[D == 1]
taus <- c(0.1, 0.25, 0.5, 0.75, 0.9)
# Method 1 — difference in sample quantiles (type = 7, R default):
q0 <- quantile(y0, taus, type = 7)   # -> 1.4, 2, 3, 4, 4.6
q1 <- quantile(y1, taus, type = 7)   # -> 2.8, 4, 6, 8, 9.2
print(rbind(q0, q1, qte = q1 - q0))  # qte -> 1.4, 2, 3, 4, 4.6
# ATE benchmark == lm(Y~D) slope:
print(coef(lm(y ~ D))["D"])          # -> 3
# Method 2 — quantile regression of Y on D; coef on D == Method-1 QTE.
# At data-point taus {.25,.5,.75} this matches the type-7 difference exactly.
library(quantreg)
for (t in taus) print(c(tau = t, qte_rq = coef(rq(y ~ D, tau = t))["D"]))
