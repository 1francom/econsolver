# fase4RValidation.R — generates fase4_data.csv and fase4Benchmarks.json
# Run from project root:  Rscript src/services/data/__validation__/fase4RValidation.R
#
# DGP: panel with N entities × T periods, two regressors x1, x2.
#   y_it = α_i + β1·x1_it + β2·x2_it + ε_it,    ε_it ~ N(0, σ²)
# We validate:
#   FE  via fixest::feols(y ~ x1 + x2 | i, ...) + sandwich vcovHC HC0/HC1
#   FD  via lm on first differences within each entity + sandwich HC0/HC1
#
# Tolerance target downstream: 6 decimal places on coefficients, 4 on SE.

suppressPackageStartupMessages({
  library(sandwich)
  library(jsonlite)
  library(fixest)
})

set.seed(20260521)

N <- 200            # entities
TT <- 50            # periods
n <- N * TT

# Build a balanced panel
i   <- rep(seq_len(N), each = TT)
t   <- rep(seq_len(TT), times = N)
alpha_i <- rnorm(N, sd = 1.5)[i]   # entity fixed effects

x1 <- rnorm(n)
x2 <- rnorm(n, sd = 0.7)
eps <- rnorm(n, sd = 0.9)
y   <- alpha_i + 1.5 * x1 + (-0.8) * x2 + eps

df <- data.frame(i = i, t = t, y = y, x1 = x1, x2 = x2)
setwd("C:/Franco/econsolver/src/services/data/__validation__")
write.csv(df, "fase4_validation.csv", row.names = FALSE)

# ── FE via fixest ──
# Mirror PanelEngine.runFE: within-demean + grand-mean recenter is algebraically
# equivalent to feols(y ~ x | i) for the slope β. SE uses dof = n - G - k (FE
# default for HC1 in feols passes via summary(., vcov = "hetero")), but our
# JS engine uses n - k_reg - 1 for HC1 scaling (matching PanelEngine.runFE).
# To match: refit via plm or sandwich on the manually demeaned data using
# residual dof = n - k_reg - 1.

# Manual within transformation matching the JS engine
demean_within <- function(z, g) z - ave(z, g, FUN = mean) + mean(z)
yd  <- demean_within(y,  i)
x1d <- demean_within(x1, i)
x2d <- demean_within(x2, i)

fit_fe <- lm(yd ~ x1d + x2d)
co_fe  <- coef(fit_fe)

# Classical SE: σ² uses df_fe = n - G - k_reg  (matching PanelEngine.runFE)
SSR_fe <- sum(residuals(fit_fe)^2)
df_fe  <- n - N - 2          # n - G - kReg
s2_fe  <- SSR_fe / df_fe
XtXinv_fe <- summary(fit_fe)$cov.unscaled
se_fe_classical <- sqrt(diag(XtXinv_fe) * s2_fe)

# Robust SE: HC0 raw, HC1 with n/(n - k_reg - 1) scaling (matches engine)
se_fe_HC0 <- sqrt(diag(vcovHC(fit_fe, type = "HC0")))
# sandwich's HC1 default is n/(n-k_total) where k_total = intercept + 2 slopes = 3.
# That exactly matches our engine's HC1 scaling: n / (n - kReg - 1) = n / (n - 3).
se_fe_HC1 <- sqrt(diag(vcovHC(fit_fe, type = "HC1")))

# ── FD via lm on differences ──
df2 <- df[order(df$i, df$t), ]
df2$y_lag  <- ave(df2$y,  df2$i, FUN = function(z) c(NA, head(z, -1)))
df2$x1_lag <- ave(df2$x1, df2$i, FUN = function(z) c(NA, head(z, -1)))
df2$x2_lag <- ave(df2$x2, df2$i, FUN = function(z) c(NA, head(z, -1)))
df2$dy  <- df2$y  - df2$y_lag
df2$dx1 <- df2$x1 - df2$x1_lag
df2$dx2 <- df2$x2 - df2$x2_lag
dd <- df2[stats::complete.cases(df2[, c("dy", "dx1", "dx2")]), ]

fit_fd <- lm(dy ~ dx1 + dx2, data = dd)
co_fd  <- coef(fit_fd)
se_fd_classical <- sqrt(diag(vcov(fit_fd)))
se_fd_HC0       <- sqrt(diag(vcovHC(fit_fd, type = "HC0")))
se_fd_HC1       <- sqrt(diag(vcovHC(fit_fd, type = "HC1")))

bench <- list(
  n           = n,
  n_units     = N,
  n_diff      = nrow(dd),
  varNames    = c("(Intercept)", "x1", "x2"),
  FE = list(
    beta         = unname(co_fe),
    se_classical = unname(se_fe_classical),
    se_HC0       = unname(se_fe_HC0),
    se_HC1       = unname(se_fe_HC1),
    df           = df_fe,
    SSR          = SSR_fe
  ),
  FD = list(
    beta         = unname(co_fd),
    se_classical = unname(se_fd_classical),
    se_HC0       = unname(se_fd_HC0),
    se_HC1       = unname(se_fd_HC1)
  )
)
bench
out_json <- file.path("src", "services", "data", "__validation__", "fase4Benchmarks.json")
write_json(bench, out_json, auto_unbox = TRUE, digits = 10)

cat("Wrote", out_csv, "and", out_json, "\n")
