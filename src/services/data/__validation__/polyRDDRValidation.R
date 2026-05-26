# polyRDDRValidation.R — validates JS polynomial RDD engine (polyOrder=2,3) against base-R WLS
#
# Run from project root:
#   Rscript src/services/data/__validation__/polyRDDRValidation.R
#
# Reference model:
#   Local polynomial WLS — design matrix [1, D, (r-c)^1..p, D*(r-c)^1..p]
#   Triangular kernel: w = max(0, 1 - |r-c|/h)
#   Classical SE: s² = unweighted SSR / (n - k)  [matches JS runWLS behaviour for RDD]
#
# Generates:
#   polyRDD_data.csv     — 5000-row dataset (r, y)
#   polyRDDBenchmarks.json — reference beta/SE/late/lateSE for p=2 and p=3

set.seed(20260525)
out_dir <- file.path("src", "services", "data", "__validation__")

n  <- 5000
r  <- runif(n, -1, 1)
ab <- as.integer(r >= 0)
# True DGP has a mild quadratic curve so p=2 is meaningfully different from p=1
y  <- 0.9 + 1.2 * r - 0.8 * r^2 + 0.75 * ab + 0.4 * r * ab + rnorm(n, sd = 0.5)
df <- data.frame(r = r, y = y)
write.csv(df, file.path(out_dir, "polyRDD_data.csv"), row.names = FALSE)

# ── Generic polynomial RDD WLS (any order p) ────────────────────────────────
rdd_poly_wls <- function(y, run, cutoff, h, p = 1) {
  u  <- run - cutoff
  w  <- pmax(0, 1 - abs(u) / h)
  keep <- is.finite(y) & is.finite(run) & w > 0
  yy <- y[keep]; uu <- u[keep]
  dd <- as.integer(run[keep] >= cutoff); ww <- w[keep]

  # Design matrix: [1, D, u^1,...,u^p, D*u^1,...,D*u^p]
  poly_cols     <- do.call(cbind, lapply(seq_len(p), function(k) uu^k))
  interact_cols <- do.call(cbind, lapply(seq_len(p), function(k) dd * uu^k))
  X <- cbind(1, dd, poly_cols, interact_cols)

  bread <- solve(crossprod(X, X * ww))
  beta  <- as.numeric(bread %*% crossprod(X, yy * ww))
  resid <- yy - X %*% beta          # unweighted residuals (matches JS runWLS)
  n_eff <- length(yy)
  k     <- ncol(X)
  s2    <- sum(resid^2) / (n_eff - k)   # unweighted SSR
  V     <- bread * s2

  list(
    beta   = beta,
    se     = sqrt(pmax(0, diag(V))),
    late   = beta[2],
    lateSE = sqrt(pmax(0, V[2, 2])),
    n      = n_eff,
    k      = k
  )
}

manual_h <- 0.5
p2 <- rdd_poly_wls(df$y, df$r, 0, manual_h, p = 2)
p3 <- rdd_poly_wls(df$y, df$r, 0, manual_h, p = 3)

cat("p=2: LATE =", p2$late, "  SE =", p2$lateSE, "  n =", p2$n, "\n")
cat("p=3: LATE =", p3$late, "  SE =", p3$lateSE, "  n =", p3$n, "\n")

# ── JSON helpers ─────────────────────────────────────────────────────────────
num_json <- function(v) {
  paste0("[", paste(format(v, digits = 12, scientific = FALSE, trim = TRUE), collapse = ", "), "]")
}
one_json <- function(v) format(v, digits = 12, scientific = FALSE, trim = TRUE)

json_lines <- c(
  "{",
  paste0('  "manual_h": ', one_json(manual_h), ","),
  '  "p2": {',
  paste0('    "beta": ',   num_json(p2$beta),   ","),
  paste0('    "se": ',     num_json(p2$se),     ","),
  paste0('    "late": ',   one_json(p2$late),   ","),
  paste0('    "lateSE": ', one_json(p2$lateSE), ","),
  paste0('    "n": ',      p2$n,                ","),
  paste0('    "k": ',      p2$k),
  "  },",
  '  "p3": {',
  paste0('    "beta": ',   num_json(p3$beta),   ","),
  paste0('    "se": ',     num_json(p3$se),     ","),
  paste0('    "late": ',   one_json(p3$late),   ","),
  paste0('    "lateSE": ', one_json(p3$lateSE), ","),
  paste0('    "n": ',      p3$n,                ","),
  paste0('    "k": ',      p3$k),
  "  }",
  "}"
)
writeLines(json_lines, file.path(out_dir, "polyRDDBenchmarks.json"))
cat("Wrote", file.path(out_dir, "polyRDD_data.csv"),
    "and", file.path(out_dir, "polyRDDBenchmarks.json"), "\n")
