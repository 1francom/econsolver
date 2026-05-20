# fase3bRValidation.R — generates fase3b_data.csv and fase3bBenchmarks.json
# Run from project root:  Rscript src/services/data/__validation__/fase3bRValidation.R
#
# Reuse the Fase 3a DGP (1 endogenous regressor, 2 instruments, 1 exogenous control)
# so GMM/LIML output can be cross-checked against AER::ivreg (LIML) and gmm::gmm().
#
# DGP:  y = β0 + β1·x1 + β2·x2 + u
#       x1 = π0 + π1·z1 + π2·z2 + v        (endogenous: corr(u,v) = 0.5)
#       z1, z2, x2 exogenous
#
# n = 10,000.

suppressPackageStartupMessages({
  library(AER)
  library(gmm)
  library(jsonlite)
})

set.seed(20260521)
n <- 10000

z1 <- rnorm(n)
z2 <- rnorm(n)
x2 <- rnorm(n)
e  <- matrix(rnorm(2 * n), n, 2) %*% chol(matrix(c(1, 0.5, 0.5, 1), 2, 2))
v  <- e[, 1]
u  <- e[, 2]
x1 <- 0.5 + 0.8 * z1 + 0.6 * z2 + v
y  <- 1.0 + 2.0 * x1 + (-0.5) * x2 + u

df <- data.frame(y, x1, x2, z1, z2)
out_csv <- file.path("src", "services", "data", "__validation__", "fase3b_data.csv")
write.csv(df, out_csv, row.names = FALSE)

# ── LIML (hand-coded; over-identified case so 2SLS ≠ LIML) ─────────────────
# W = [1, x2]            exogenous controls + intercept
# Z = [1, x2, z1, z2]    full instrument set
# X = [1, x2, x1]        full regressor design (column order matches W then endo)
# V = [y, x1]            endogenous block (outcome + endogenous regressors)
#
# κ = min eigenvalue of A^{-1} B,  A = V' M_Z V,  B = V' M_W V
# β_LIML = (X'X − κ·X'M_Z X)^{-1} (X'Y − κ·X'M_Z Y)
# Var(β) = σ² · (X'X − X'M_Z X)^{-1}     with σ² = SSR / (n − k)
W  <- cbind(1, df$x2)
Z  <- cbind(1, df$x2, df$z1, df$z2)
X  <- cbind(1, df$x2, df$x1)
V  <- cbind(df$y, df$x1)
Y  <- df$y

Pz <- Z %*% solve(t(Z) %*% Z) %*% t(Z)
Pw <- W %*% solve(t(W) %*% W) %*% t(W)
Mz <- diag(n) - Pz
Mw <- diag(n) - Pw

A_liml <- t(V) %*% Mz %*% V
B_liml <- t(V) %*% Mw %*% V
eig    <- eigen(solve(A_liml) %*% B_liml)$values
kappa_liml <- min(Re(eig))                       # LIML κ ≥ 1

XtX    <- t(X) %*% X
XtMzX  <- t(X) %*% Mz %*% X
XtY    <- t(X) %*% Y
XtMzY  <- t(X) %*% Mz %*% Y

lhs    <- XtX - kappa_liml * XtMzX
rhs    <- XtY - kappa_liml * XtMzY
beta_liml <- as.numeric(solve(lhs) %*% rhs)      # order: (Intercept), x2, x1

resid     <- Y - X %*% beta_liml
ssr       <- sum(resid^2)
k_full    <- ncol(X)
sigma2    <- ssr / (n - k_full)
XtPzX     <- XtX - XtMzX                          # = X' P_Z X
Vbeta     <- sigma2 * solve(XtPzX)
se_beta   <- sqrt(diag(Vbeta))

# Reorder to (Intercept), x1, x2 to match GMM and benchmark convention
ord       <- c(1, 3, 2)
co_liml   <- beta_liml[ord]
se_liml   <- se_beta[ord]

# ── GMM (two-step efficient) ────────────────────────────────────────────────
# Moment conditions: g(β, data) = Z * (y − Xβ) where X = [1, x2, x1], Z = [1, x2, z1, z2]
gmm_fit <- gmm(y ~ x1 + x2, ~ z1 + z2 + x2, data = df, type = "twoStep")
co_gmm  <- coef(gmm_fit)
se_gmm  <- sqrt(diag(vcov(gmm_fit)))
spec_result <- specTest(gmm_fit)
j_gmm   <- as.numeric(spec_result$test[1, 1])
j_pval  <- as.numeric(spec_result$test[1, 2])
j_df    <- 4 - 3  # overidentifying restrictions: q - k instruments - regressors

# AER::ivreg coef order: (Intercept), x1, x2
# gmm::gmm coef order:    (Intercept), x1, x2     — verify with names()
bench <- list(
  n = n,
  varNames = c("(Intercept)", "x1", "x2"),
  liml_beta  = unname(co_liml),
  liml_se    = unname(se_liml),
  liml_kappa = kappa_liml,
  gmm_beta   = unname(co_gmm),
  gmm_se     = unname(se_gmm),
  gmm_jStat  = j_gmm,
  gmm_jPval  = j_pval,
  gmm_jDf    = j_df
)
out_json <- file.path("src", "services", "data", "__validation__", "fase3bBenchmarks.json")
write_json(bench, out_json, auto_unbox = TRUE, digits = 10)

cat("Wrote", out_csv, "and", out_json, "\n")
