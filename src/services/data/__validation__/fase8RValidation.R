# Fase 8: robust-SE backfill fixtures for WLS, 2SLS, and LIML.
# Run from project root:
#   Rscript src/services/data/__validation__/fase8RValidation.R

set.seed(20260521)
n <- 12000
time <- seq_len(n)
firm <- rep(seq_len(120), length.out = n)
year <- rep(seq_len(24), each = ceiling(n / 24))[seq_len(n)]

# WLS block.
wx1 <- rnorm(n)
wx2 <- runif(n, 0.2, 2.0)
sigma <- 0.45 + 0.7 * wx2
w <- 1 / sigma^2
y_wls <- 1.1 + 1.9 * wx1 - 0.4 * wx2 + rnorm(n) * sigma

# IV / LIML block.
z1 <- rnorm(n)
z2 <- rnorm(n)
x2 <- rnorm(n)
uv <- matrix(rnorm(2 * n), n, 2) %*% chol(matrix(c(1, 0.45, 0.45, 1), 2, 2))
x1 <- 0.35 + 0.9 * z1 + 0.55 * z2 + uv[, 1]
y_iv <- 0.8 + 2.2 * x1 - 0.6 * x2 + uv[, 2]

df <- data.frame(
  time, firm, year,
  y_wls, wx1, wx2, w,
  y_iv, x1, x2, z1, z2
)
out_csv <- file.path("src", "services", "data", "__validation__", "fase8_data.csv")
write.csv(df, out_csv, row.names = FALSE)

diag_leverage <- function(design, bread) {
  rowSums((design %*% bread) * design)
}

hc_meat <- function(scores, h = NULL, variant = "HC0") {
  if (variant == "HC2") scores <- scores / sqrt(pmax(1e-12, 1 - h))
  if (variant == "HC3") scores <- scores / pmax(1e-12, 1 - h)
  crossprod(scores)
}

cluster_meat <- function(scores, g) {
  sums <- rowsum(scores, g, reorder = FALSE)
  crossprod(sums)
}

cluster_scale <- function(g, obs, k) {
  G <- length(unique(g))
  (G / (G - 1)) * ((obs - 1) / (obs - k))
}

twoway_meat <- function(scores, g1, g2, k) {
  cluster_scale(g1, nrow(scores), k) * cluster_meat(scores, g1) +
    cluster_scale(g2, nrow(scores), k) * cluster_meat(scores, g2) -
    cluster_scale(interaction(g1, g2, drop = TRUE), nrow(scores), k) *
      cluster_meat(scores, interaction(g1, g2, drop = TRUE))
}

hac_meat <- function(scores, lag) {
  B <- crossprod(scores)
  for (ell in seq_len(lag)) {
    weight <- 1 - ell / (lag + 1)
    G <- t(scores[(ell + 1):nrow(scores), , drop = FALSE]) %*%
      scores[seq_len(nrow(scores) - ell), , drop = FALSE]
    B <- B + weight * (G + t(G))
  }
  B
}

sandwich_se <- function(bread, meat) {
  sqrt(diag(bread %*% meat %*% bread))
}

hc1 <- function(meat, obs, k) meat * obs / (obs - k)
L_auto <- floor(4 * (n / 100)^(2 / 9))

# WLS matrix reference. Scores follow the JS WLS robust convention:
# score_i = w_i * e_i * x_i.
Xwls <- cbind(1, wx1, wx2)
XtWX <- crossprod(Xwls, w * Xwls)
bread_wls <- solve(XtWX)
beta_wls <- as.numeric(bread_wls %*% crossprod(Xwls, w * y_wls))
resid_wls <- as.numeric(y_wls - Xwls %*% beta_wls)
score_wls <- Xwls * as.numeric(w * resid_wls)
h_wls <- diag_leverage(sqrt(w) * Xwls, bread_wls)

# 2SLS fitted-design reference. Scores use fitted X and structural residuals.
Xiv <- cbind(1, x1, x2)
Ziv <- cbind(1, x2, z1, z2)
ZtZi <- solve(crossprod(Ziv))
Xhat <- Ziv %*% ZtZi %*% crossprod(Ziv, Xiv)
bread_iv <- solve(crossprod(Xhat, Xiv))
beta_iv <- as.numeric(bread_iv %*% crossprod(Xhat, y_iv))
resid_iv <- as.numeric(y_iv - Xiv %*% beta_iv)
score_iv <- Xhat * resid_iv
h_iv <- diag_leverage(Xhat, bread_iv)

# LIML matrix reference. X order matches buildLIMLSuffStats: intercept, x2, x1.
Xliml <- cbind(1, x2, x1)
Wliml <- cbind(1, x2)
Vliml <- cbind(y_iv, x1)
Pz <- Ziv %*% ZtZi %*% t(Ziv)
Pw <- Wliml %*% solve(crossprod(Wliml)) %*% t(Wliml)
Mz <- diag(n) - Pz
Mw <- diag(n) - Pw
kappa <- min(Re(eigen(solve(t(Vliml) %*% Mz %*% Vliml) %*%
  (t(Vliml) %*% Mw %*% Vliml))$values))
XtXliml <- crossprod(Xliml)
XtMzX <- t(Xliml) %*% Mz %*% Xliml
XtYliml <- crossprod(Xliml, y_iv)
XtMzY <- t(Xliml) %*% Mz %*% y_iv
beta_liml <- as.numeric(solve(XtXliml - kappa * XtMzX) %*%
  (XtYliml - kappa * XtMzY))
resid_liml <- as.numeric(y_iv - Xliml %*% beta_liml)
bread_liml <- solve(XtXliml - XtMzX)
score_liml <- Xliml * resid_liml

bench <- list(
  WLS = list(
    beta = beta_wls,
    se_HC2 = sandwich_se(bread_wls, hc_meat(score_wls, h_wls, "HC2")),
    se_HC3 = sandwich_se(bread_wls, hc_meat(score_wls, h_wls, "HC3")),
    se_clustered = sandwich_se(
      bread_wls,
      cluster_scale(firm, n, ncol(Xwls)) * cluster_meat(score_wls, firm)
    ),
    se_twoway = sandwich_se(bread_wls, twoway_meat(score_wls, firm, year, ncol(Xwls))),
    se_HAC = sandwich_se(bread_wls, hac_meat(score_wls, L_auto))
  ),
  IV = list(
    beta = beta_iv,
    se_HC2 = sandwich_se(bread_iv, hc_meat(score_iv, h_iv, "HC2")),
    se_HC3 = sandwich_se(bread_iv, hc_meat(score_iv, h_iv, "HC3")),
    se_clustered = sandwich_se(
      bread_iv,
      cluster_scale(firm, n, ncol(Xiv)) * cluster_meat(score_iv, firm)
    ),
    se_twoway = sandwich_se(bread_iv, twoway_meat(score_iv, firm, year, ncol(Xiv))),
    se_HAC = sandwich_se(bread_iv, hac_meat(score_iv, L_auto))
  ),
  LIML = list(
    beta = beta_liml,
    kappa = kappa,
    se_HC0 = sandwich_se(bread_liml, hc_meat(score_liml)),
    se_HC1 = sandwich_se(bread_liml, hc1(hc_meat(score_liml), n, ncol(Xliml))),
    se_clustered = sandwich_se(
      bread_liml,
      cluster_scale(firm, n, ncol(Xliml)) * cluster_meat(score_liml, firm)
    ),
    se_HAC = sandwich_se(bread_liml, hac_meat(score_liml, L_auto))
  ),
  L_HAC = L_auto
)

num_json <- function(values) {
  paste0("[", paste(formatC(as.numeric(values), digits = 10, format = "fg", flag = "#"), collapse = ","), "]")
}

out_json <- file.path("src", "services", "data", "__validation__", "fase8Benchmarks.json")
writeLines(c(
  "{",
  '  "WLS": {',
  paste0('    "beta": ', num_json(bench$WLS$beta), ","),
  paste0('    "se_HC2": ', num_json(bench$WLS$se_HC2), ","),
  paste0('    "se_HC3": ', num_json(bench$WLS$se_HC3), ","),
  paste0('    "se_clustered": ', num_json(bench$WLS$se_clustered), ","),
  paste0('    "se_twoway": ', num_json(bench$WLS$se_twoway), ","),
  paste0('    "se_HAC": ', num_json(bench$WLS$se_HAC)),
  "  },",
  '  "IV": {',
  paste0('    "beta": ', num_json(bench$IV$beta), ","),
  paste0('    "se_HC2": ', num_json(bench$IV$se_HC2), ","),
  paste0('    "se_HC3": ', num_json(bench$IV$se_HC3), ","),
  paste0('    "se_clustered": ', num_json(bench$IV$se_clustered), ","),
  paste0('    "se_twoway": ', num_json(bench$IV$se_twoway), ","),
  paste0('    "se_HAC": ', num_json(bench$IV$se_HAC)),
  "  },",
  '  "LIML": {',
  paste0('    "beta": ', num_json(bench$LIML$beta), ","),
  paste0('    "kappa": ', formatC(bench$LIML$kappa, digits = 10, format = "fg", flag = "#"), ","),
  paste0('    "se_HC0": ', num_json(bench$LIML$se_HC0), ","),
  paste0('    "se_HC1": ', num_json(bench$LIML$se_HC1), ","),
  paste0('    "se_clustered": ', num_json(bench$LIML$se_clustered), ","),
  paste0('    "se_HAC": ', num_json(bench$LIML$se_HAC)),
  "  },",
  paste0('  "L_HAC": ', bench$L_HAC),
  "}"
), out_json)
cat("Wrote", out_csv, "and", out_json, "\n")
