# polyRDDRValidation.R — validates JS polynomial RDD engine (polyOrder=1,2,3)
# against base-R WLS, and cross-checks IK bandwidth for all orders.
#
# Run from project root:
#   Rscript src/services/data/__validation__/polyRDDRValidation.R
#
# Reference model:
#   Local polynomial WLS — design matrix [1, D, (r-c)^1..p, D*(r-c)^1..p]
#   Triangular kernel: w = max(0, 1 - |r-c|/h)
#   Classical SE: s² = unweighted SSR / (n - k)  [matches JS runWLS behaviour]
#
# IK bandwidth:
#   Replicates the updated JS ikBandwidth(runningVals, yVals, cutoff, polyOrder):
#   - Pilot window = (max - min) / 4 (each side separately)
#   - Fit degree-(p+2) polynomial to points within pilot window
#   - deriv = |beta[p+2]|  (Taylor coeff at index p+1, 0-indexed)
#   - h = 3.4375 * (s2 / (deriv^2 * n))^{1/(2p+3)}
#   - clip to [range*0.05, range*0.80]
#
# Generates:
#   polyRDD_data.csv       — 4000-row dataset (r, y) with cubic DGP
#   polyRDDBenchmarks.json — p1/p2/p3 × {manual h, IK h} benchmarks

set.seed(20260529)
out_dir <- file.path("src", "services", "data", "__validation__")

# ── DGP: cubic on both sides so p=3 is meaningfully different from p=1/2 ──────
n  <- 4000
r  <- runif(n, -1, 1)
D  <- as.integer(r >= 0)
# True curve: mild quadratic + cubic; true LATE at c=0 is 0.75
y  <- 0.9 + 1.4 * r - 0.9 * r^2 + 0.5 * r^3 +
      0.75 * D + 0.5 * r * D - 0.3 * r^2 * D + 0.2 * r^3 * D +
      rnorm(n, sd = 0.4)
df <- data.frame(r = r, y = y)
write.csv(df, file.path(out_dir, "polyRDD_data.csv"), row.names = FALSE)

# ── Generic polynomial RDD WLS ────────────────────────────────────────────────
rdd_poly_wls <- function(y, run, cutoff, h, p = 1) {
  u    <- run - cutoff
  w    <- pmax(0, 1 - abs(u) / h)
  keep <- is.finite(y) & is.finite(run) & w > 0
  yy   <- y[keep]; uu <- u[keep]
  dd   <- as.integer(run[keep] >= cutoff); ww <- w[keep]

  poly_cols     <- do.call(cbind, lapply(seq_len(p), function(k) uu^k))
  interact_cols <- do.call(cbind, lapply(seq_len(p), function(k) dd * uu^k))
  X <- cbind(1, dd, poly_cols, interact_cols)

  bread <- solve(crossprod(X, X * ww))
  beta  <- as.numeric(bread %*% crossprod(X, yy * ww))
  resid <- yy - X %*% beta
  n_eff <- length(yy); k <- ncol(X)
  s2    <- sum(resid^2) / (n_eff - k)
  V     <- bread * s2

  list(beta = beta, se = sqrt(pmax(0, diag(V))),
       late = beta[2], lateSE = sqrt(pmax(0, V[2, 2])),
       n = n_eff, k = k)
}

# ── IK bandwidth — exact R replica of updated JS ikBandwidth(…, polyOrder=p) ──
ik_bandwidth <- function(run, y, cutoff, p = 1) {
  n     <- length(run)
  range <- max(run) - min(run)
  pilot <- range / 4

  left  <- data.frame(x = run[run <  cutoff], y = y[run <  cutoff])
  right <- data.frame(x = run[run >= cutoff], y = y[run >= cutoff])

  if (nrow(left) < 5 || nrow(right) < 5) return(range / 4)

  pilot_deg <- p + 1          # minimum degree to estimate (p+1)-th deriv (p+2 causes Vandermonde ill-conditioning for p≥3)
  min_pts   <- pilot_deg + 2
  deriv_idx <- p + 2          # R is 1-indexed: position p+2 = Taylor coeff β[p+1]

  local_estimate <- function(pts, c0) {
    near <- pts[abs(pts$x - c0) < pilot, ]
    if (nrow(near) < min_pts) return(list(s2 = 1, deriv = 0.001))
    u  <- near$x - c0
    # Design matrix: [1, u, u^2, ..., u^{pilot_deg}]
    X  <- outer(u, 0:pilot_deg, `^`)
    ok <- tryCatch({ b <- solve(t(X) %*% X) %*% t(X) %*% near$y; TRUE },
                   error = function(e) FALSE)
    if (!ok) return(list(s2 = 1, deriv = 0.001))
    b     <- as.numeric(solve(t(X) %*% X) %*% t(X) %*% near$y)
    resid <- near$y - X %*% b
    s2    <- sum(resid^2) / max(1, nrow(near) - (pilot_deg + 1))
    list(s2 = s2, deriv = max(abs(b[deriv_idx]), 0.001))
  }

  vL <- local_estimate(left,  cutoff)
  vR <- local_estimate(right, cutoff)
  s2    <- (vL$s2    + vR$s2)    / 2
  deriv <- (vL$deriv + vR$deriv) / 2
  rate  <- 1 / (2 * p + 3)
  h     <- 3.4375 * (s2 / (deriv^2 * n))^rate
  min(max(h, range * 0.05), range * 0.80)
}

# ── Compute bandwidths ─────────────────────────────────────────────────────────
manual_h <- 0.50
h_ik <- sapply(1:3, function(p) ik_bandwidth(df$r, df$y, 0, p))
names(h_ik) <- c("p1", "p2", "p3")

cat("IK bandwidths:\n")
cat(sprintf("  p=1: %.6f\n", h_ik["p1"]))
cat(sprintf("  p=2: %.6f\n", h_ik["p2"]))
cat(sprintf("  p=3: %.6f\n", h_ik["p3"]))

# ── Estimate: manual h ────────────────────────────────────────────────────────
p1m <- rdd_poly_wls(df$y, df$r, 0, manual_h, p = 1)
p2m <- rdd_poly_wls(df$y, df$r, 0, manual_h, p = 2)
p3m <- rdd_poly_wls(df$y, df$r, 0, manual_h, p = 3)

cat("\nManual h =", manual_h, "\n")
cat(sprintf("  p=1: LATE=%.6f  SE=%.6f  n=%d\n", p1m$late, p1m$lateSE, p1m$n))
cat(sprintf("  p=2: LATE=%.6f  SE=%.6f  n=%d\n", p2m$late, p2m$lateSE, p2m$n))
cat(sprintf("  p=3: LATE=%.6f  SE=%.6f  n=%d\n", p3m$late, p3m$lateSE, p3m$n))

# ── Estimate: IK h ────────────────────────────────────────────────────────────
p1i <- rdd_poly_wls(df$y, df$r, 0, h_ik["p1"], p = 1)
p2i <- rdd_poly_wls(df$y, df$r, 0, h_ik["p2"], p = 2)
p3i <- rdd_poly_wls(df$y, df$r, 0, h_ik["p3"], p = 3)

cat("\nIK h:\n")
cat(sprintf("  p=1: LATE=%.6f  SE=%.6f  n=%d  h=%.6f\n", p1i$late, p1i$lateSE, p1i$n, h_ik["p1"]))
cat(sprintf("  p=2: LATE=%.6f  SE=%.6f  n=%d  h=%.6f\n", p2i$late, p2i$lateSE, p2i$n, h_ik["p2"]))
cat(sprintf("  p=3: LATE=%.6f  SE=%.6f  n=%d  h=%.6f\n", p3i$late, p3i$lateSE, p3i$n, h_ik["p3"]))

# ── JSON helpers ─────────────────────────────────────────────────────────────
nvec <- function(v) paste0("[", paste(format(v, digits=12, scientific=FALSE, trim=TRUE), collapse=", "), "]")
nsc  <- function(v) format(v, digits=12, scientific=FALSE, trim=TRUE)

write_case <- function(res, h_val, indent = "    ") {
  c(
    paste0(indent, '"h": ',       nsc(h_val),          ","),
    paste0(indent, '"beta": ',    nvec(res$beta),       ","),
    paste0(indent, '"se": ',      nvec(res$se),         ","),
    paste0(indent, '"late": ',    nsc(res$late),        ","),
    paste0(indent, '"lateSE": ',  nsc(res$lateSE),      ","),
    paste0(indent, '"n": ',       res$n,                ","),
    paste0(indent, '"k": ',       res$k)
  )
}

json <- c(
  "{",
  paste0('  "manual_h": ', nsc(manual_h), ","),
  paste0('  "ik_h": { "p1": ', nsc(h_ik["p1"]), ', "p2": ', nsc(h_ik["p2"]), ', "p3": ', nsc(h_ik["p3"]), ' },'),
  '  "p1": {',
  '    "manual": {', write_case(p1m, manual_h), '    },',
  '    "ik": {',     write_case(p1i, h_ik["p1"]), '    }',
  '  },',
  '  "p2": {',
  '    "manual": {', write_case(p2m, manual_h), '    },',
  '    "ik": {',     write_case(p2i, h_ik["p2"]), '    }',
  '  },',
  '  "p3": {',
  '    "manual": {', write_case(p3m, manual_h), '    },',
  '    "ik": {',     write_case(p3i, h_ik["p3"]), '    }',
  '  }',
  "}"
)
writeLines(json, file.path(out_dir, "polyRDDBenchmarks.json"))
cat("\nWrote polyRDD_data.csv and polyRDDBenchmarks.json\n")
