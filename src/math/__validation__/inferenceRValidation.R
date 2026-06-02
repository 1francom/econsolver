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
