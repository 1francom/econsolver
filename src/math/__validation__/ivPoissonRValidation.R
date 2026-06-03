# ─── IV-POISSON validation against runIVPoisson() ─────────────────────────────
#
# Exponential-family GMM (Mullahy 1997 / Windmeijer-Santos-Silva):
#   E[Y | X, Z] = exp(Xβ),  with endogenous X instrumented by Z.
#   Moment conditions:  g(β) = (1/n) Σ Zᵢ (yᵢ − exp(Xᵢβ))
#
# This script is the SOURCE OF TRUTH for the IV-Poisson numerical benchmark.
# Run it in R, then:
#   1. Copy the printed coefficients / SEs / J-stat into the hard `c(...)` lines
#      of validateIVPoisson() in engineValidation.js (replacing the loose
#      DGP-recovery checks once exact agreement is confirmed).
#   2. The script also writes `ivPoisson_case1.csv` — load that exact dataset in
#      the browser and run runIVPoisson on it to get a 6dp/4dp comparison on
#      IDENTICAL data (the same harness pattern as sunAbraham_case1.csv).
#
# Requires: install.packages("gmm")

library(gmm)

set.seed(42)
n   <- 200
z   <- rnorm(n)                       # excluded instrument
x   <- 0.6 * z + rnorm(n, 0, 0.5)     # endogenous regressor (relevant: corr with z)
lam <- exp(0.5 + 0.8 * x)             # true DGP: intercept 0.5, slope 0.8
y   <- rpois(n, lam)                  # count outcome

df <- data.frame(y = y, x = x, z = z)

# Persist the exact dataset so the JS side can validate on identical data.
write.csv(df, file = "ivPoisson_case1.csv", row.names = FALSE)

# ── Exponential GMM moment function: g(β) = Z (y − exp(Xβ)) ───────────────────
# Parameters: b[1] = intercept, b[2] = slope on x.
# Instruments W = [1, z]; regressors X = [1, x].
g_iv_poisson <- function(b, data) {
  X  <- cbind(1, data$x)
  Z  <- cbind(1, data$z)
  mu <- exp(X %*% b)
  Z * as.vector(data$y - mu)          # n × 2 moment matrix
}

fit <- gmm(g_iv_poisson, x = df, t0 = c(0, 0), type = "twoStep")

cat("── IV-Poisson (two-step exponential GMM) ──\n")
cat("Coefficients (intercept, x):\n"); print(coef(fit))
cat("Standard errors:\n");            print(sqrt(diag(vcov(fit))))

# J-test of overidentifying restrictions (just-identified here → J ≈ 0, df 0).
st <- specTest(fit)
cat("Hansen J:\n"); print(st)

# First-stage F (linear OLS of endogenous x on instrument z), for reference.
fs <- lm(x ~ z, data = df)
cat("First-stage F (x ~ z):\n")
print(summary(fs)$fstatistic)
