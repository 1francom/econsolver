# fase3aRValidation.R — generates fase3a_data.csv and fase3aBenchmarks.json
# Run from project root:  Rscript src/services/data/__validation__/fase3aRValidation.R
#
# DGP:  y = β0 + β1·x1 + β2·x2 + u
#       x1 = π0 + π1·z1 + π2·z2 + v        (endogenous: corr(u,v)=0.5)
#       z1, z2, x2 exogenous
#
# n = 10,000.

suppressPackageStartupMessages({
  library(AER)
  library(sandwich)
  library(jsonlite)
})

set.seed(20260520)
n <- 10000

z1 <- rnorm(n)
z2 <- rnorm(n)
x2 <- rnorm(n)
# Correlated errors (corr = 0.5)
e  <- matrix(rnorm(2 * n), n, 2) %*% chol(matrix(c(1, 0.5, 0.5, 1), 2, 2))
v  <- e[, 1]
u  <- e[, 2]

x1 <- 0.5 + 0.8 * z1 + 0.6 * z2 + v
y  <- 1.0 + 2.0 * x1 + (-0.5) * x2 + u

df <- data.frame(y, x1, x2, z1, z2)
out_csv <- file.path("src", "services", "data", "__validation__", "fase3a_data.csv")
write.csv(df, out_csv, row.names = FALSE)

# Fit AER::ivreg
fit <- ivreg(y ~ x1 + x2 | z1 + z2 + x2, data = df)
co  <- coef(fit)
se_classical <- sqrt(diag(vcov(fit)))
se_HC0       <- sqrt(diag(vcovHC(fit, type = "HC0")))
se_HC1       <- sqrt(diag(vcovHC(fit, type = "HC1")))

# First-stage F (single endogenous regressor)
fs   <- lm(x1 ~ x2 + z1 + z2, data = df)
fs_r <- lm(x1 ~ x2, data = df)
SSR_u <- sum(resid(fs)^2)
SSR_r <- sum(resid(fs_r)^2)
F_first <- ((SSR_r - SSR_u) / 2) / (SSR_u / fs$df.residual)

bench <- list(
  n = n,
  varNames = c("(Intercept)", "x1", "x2"),
  beta = unname(co),
  se_classical = unname(se_classical),
  se_HC0 = unname(se_HC0),
  se_HC1 = unname(se_HC1),
  firstStageF_x1 = F_first
)
bench
out_json <- file.path("src", "services", "data", "__validation__", "fase3aBenchmarks.json")
write_json(bench, out_json, auto_unbox = TRUE, digits = 10)

cat("Wrote", out_csv, "and", out_json, "\n")
