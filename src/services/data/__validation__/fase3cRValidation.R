# fase3cRValidation.R — generates fase3c_data.csv and fase3cBenchmarks.json
# Run from project root:  Rscript src/services/data/__validation__/fase3cRValidation.R
#
# DGP:  y = β0 + β1·x1 + β2·x2 + σ(x2)·ε         (heteroskedastic in x2)
#       w = 1 / σ(x2)²                            (precision weights)
#
# n = 10,000. Test β recovery + classical/HC0/HC1 SE.

suppressPackageStartupMessages({
  library(sandwich)
  library(jsonlite)
})

set.seed(20260521)
n <- 10000

x1 <- rnorm(n)
x2 <- runif(n, 0.2, 2.0)         # bounded away from 0 to avoid extreme weights
sigma_i <- 0.5 + 0.8 * x2         # heteroskedasticity
eps <- rnorm(n) * sigma_i
y   <- 1.0 + 2.0 * x1 + (-0.5) * x2 + eps
w   <- 1 / sigma_i^2

df <- data.frame(y, x1, x2, w)
out_csv <- file.path("src", "services", "data", "__validation__", "fase3c_data.csv")
write.csv(df, out_csv, row.names = FALSE)

# Fit weighted lm
fit <- lm(y ~ x1 + x2, data = df, weights = w)
co  <- coef(fit)
se_classical <- sqrt(diag(vcov(fit)))
se_HC0       <- sqrt(diag(vcovHC(fit, type = "HC0")))
se_HC1       <- sqrt(diag(vcovHC(fit, type = "HC1")))

bench <- list(
  n = n,
  varNames = c("(Intercept)", "x1", "x2"),
  beta = unname(co),
  se_classical = unname(se_classical),
  se_HC0 = unname(se_HC0),
  se_HC1 = unname(se_HC1)
)
out_json <- file.path("src", "services", "data", "__validation__", "fase3cBenchmarks.json")
write_json(bench, out_json, auto_unbox = TRUE, digits = 10)

cat("Wrote", out_csv, "and", out_json, "\n")
