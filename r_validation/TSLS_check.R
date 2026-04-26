# ─── EconSolver · 2SLS/IV validation against AER::ivreg ──────────────────────
#
# This script replicates the EXACT dataset from make2SLSData() in
# src/math/__validation__/engineValidation.js and runs AER::ivreg on it.
#
# JS data generation (verbatim translation):
#   d[i] = 0.5 + 1.2 * zVals[i] + 0.3 * xVals[i] + vVals[i] * 0.4
#   y[i] = 1   + 2   * d[i]     + 0.5 * xVals[i] + eVals[i] * 0.8
#
# EconSolver call:
#   run2SLS(rows, "y", endog=["d"], exog=["x"], instr=["z"])
# which maps to AER:
#   ivreg(y ~ d + x | x + z, data=df)
#
# SE type: classical (default in both AER and EconSolver when seOpts={})
#
# Required package: AER (install.packages("AER") if absent)

library(AER)

# ─── Fixed arrays from make2SLSData() in engineValidation.js ─────────────────
zVals <- c(
  0.3532, -0.7115,  1.2025, -0.2005,  0.6917,
 -1.1234,  0.4501, -0.3087,  0.8723, -0.5432,
  0.1209,  0.9812, -0.6345,  0.2341, -1.0234,
  0.7812, -0.4231,  1.1234, -0.8901,  0.3456,
 -0.2341,  0.6789, -0.9012,  0.1234, -0.5678,
  0.8901, -0.3456,  0.4567, -0.7890,  1.0123
)

xVals <- c(
  0.1234, -0.5678,  0.9012, -0.3456,  0.7890,
 -1.1234,  0.5678, -0.2345,  0.6789, -0.4321,
  0.8765, -0.6543,  0.2345, -0.9876,  0.4321,
 -0.7654,  0.3210, -0.1234,  0.5432, -0.8765,
  0.6543, -0.4321,  0.2109, -0.7890,  0.9876,
 -0.1234,  0.5678, -0.3456,  0.8901, -0.6789
)

vVals <- c(
  0.1231, -0.3456,  0.5678, -0.1234,  0.2345,
 -0.4567,  0.1890, -0.3210,  0.4321, -0.2109,
  0.3456, -0.5678,  0.1234, -0.2345,  0.4567,
 -0.1890,  0.3210, -0.4321,  0.2109, -0.3456,
  0.5678, -0.1234,  0.2345, -0.4567,  0.1890,
 -0.3210,  0.4321, -0.2109,  0.3456, -0.5678
)

eVals <- c(
  0.6234, -0.4512,  0.8901, -0.2345,  0.5678,
 -0.9012,  0.3456, -0.6789,  0.1234, -0.4567,
  0.7890, -0.2345,  0.5678, -0.8901,  0.3456,
 -0.6789,  0.1234, -0.4567,  0.7890, -0.2345,
  0.5678, -0.8901,  0.3456, -0.6789,  0.1234,
 -0.4567,  0.7890, -0.2345,  0.5678, -0.8901
)

# ─── Construct d and y exactly as JS does ────────────────────────────────────
n <- 30
d <- 0.5 + 1.2 * zVals + 0.3 * xVals + vVals * 0.4
y <- 1   + 2   * d     + 0.5 * xVals + eVals * 0.8

df <- data.frame(y = y, d = d, x = xVals, z = zVals)

# ─── First stage sanity check ────────────────────────────────────────────────
fs <- lm(d ~ x + z, data = df)
cat("=== FIRST STAGE (lm: d ~ x + z) ===\n")
cat(sprintf("  coef[(Intercept)]: %.6f\n", coef(fs)[["(Intercept)"]]))
cat(sprintf("  coef[x]:           %.6f\n", coef(fs)[["x"]]))
cat(sprintf("  coef[z]:           %.6f\n", coef(fs)[["z"]]))

# First-stage F-stat for z (instrument relevance)
fs_restricted <- lm(d ~ x, data = df)
ssr_r <- sum(residuals(fs_restricted)^2)
ssr_u <- sum(residuals(fs)^2)
q     <- 1   # one excluded instrument (z)
df_u  <- fs$df.residual
fstat_fs <- ((ssr_r - ssr_u) / q) / (ssr_u / df_u)
cat(sprintf("  First-stage F (z):  %.4f  (should be > 10)\n\n", fstat_fs))

# ─── 2SLS via AER::ivreg ─────────────────────────────────────────────────────
# Formula: y ~ d + x | x + z
#   LHS of |: regressors  (d = endogenous, x = included exogenous)
#   RHS of |: instruments (x = included exogenous, z = excluded instrument)
fit <- ivreg(y ~ d + x | x + z, data = df)

# Classical (non-robust) standard errors — matches EconSolver default seOpts={}
sm <- summary(fit, vcov = vcov)

cat("=== 2SLS (AER::ivreg) — classical SE ===\n")
cat(sprintf("  n:   %d\n", nobs(fit)))
cat(sprintf("  df:  %d  (n - k = 30 - 3)\n", fit$df.residual))

coefs <- coef(fit)
ses   <- sqrt(diag(vcov(fit)))

cat(sprintf("\n  coef[(Intercept)]: %.6f\n", coefs[["(Intercept)"]]))
cat(sprintf("  coef[d]:           %.6f\n", coefs[["d"]]))
cat(sprintf("  coef[x]:           %.6f\n", coefs[["x"]]))

cat(sprintf("\n  SE[(Intercept)]:   %.4f\n", ses[["(Intercept)"]]))
cat(sprintf("  SE[d]:             %.4f\n", ses[["d"]]))
cat(sprintf("  SE[x]:             %.4f\n", ses[["x"]]))

# t-stats and p-values
tstats <- coefs / ses
pvals  <- 2 * pt(-abs(tstats), df = fit$df.residual)
cat(sprintf("\n  t[(Intercept)]:    %.4f\n", tstats[["(Intercept)"]]))
cat(sprintf("  t[d]:              %.4f\n", tstats[["d"]]))
cat(sprintf("  t[x]:              %.4f\n", tstats[["x"]]))

cat(sprintf("\n  p[(Intercept)]:    %.6f\n", pvals[["(Intercept)"]]))
cat(sprintf("  p[d]:              %.6f\n", pvals[["d"]]))
cat(sprintf("  p[x]:              %.6f\n", pvals[["x"]]))

# R-squared (IV R² can be negative — report anyway)
ssr_iv   <- sum(residuals(fit, type = "response")^2)
sst      <- sum((y - mean(y))^2)
r2_iv    <- 1 - ssr_iv / sst
adj_r2   <- 1 - (1 - r2_iv) * (n - 1) / fit$df.residual
cat(sprintf("\n  R2 (IV):           %.6f\n", r2_iv))
cat(sprintf("  Adj R2:            %.6f\n", adj_r2))

cat("\n=== COPY THESE VALUES INTO engineValidation.js validate2SLS() ===\n")
cat(sprintf("  expectedCoef_int:  %.6f\n", coefs[["(Intercept)"]]))
cat(sprintf("  expectedCoef_d:    %.6f\n", coefs[["d"]]))
cat(sprintf("  expectedCoef_x:    %.6f\n", coefs[["x"]]))
cat(sprintf("  expectedSE_int:    %.4f\n",  ses[["(Intercept)"]]))
cat(sprintf("  expectedSE_d:      %.4f\n",  ses[["d"]]))
cat(sprintf("  expectedSE_x:      %.4f\n",  ses[["x"]]))
cat(sprintf("  firstStage_F:      %.4f\n",  fstat_fs))
cat(sprintf("  n:                 %d\n",    nobs(fit)))
cat(sprintf("  df:                %d\n",    fit$df.residual))
