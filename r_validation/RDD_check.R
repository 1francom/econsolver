# ─── RDD_check.R ─────────────────────────────────────────────────────────────
# Validates EconSolver runSharpRDD against R reference values.
#
# Strategy:
#   1. Replicate JS DGP and data exactly (deterministic, no set.seed needed).
#   2. Replicate the JS ikBandwidth formula in R to get the same fixed h.
#   3. Call rdrobust with h = <fixed h>, kernel="triangular", se.type="hc0"
#      as the gold-standard comparison.
#   4. Also run a manual local-linear WLS (unweighted SSR) matching EconSolver's
#      internal runWLS, so we can directly compare LATE and SE.
#
# Usage:
#   Rscript r_validation/RDD_check.R
#
# Required packages:
#   install.packages("rdrobust")

library(rdrobust)

# ─── 1. Replicate JS DGP ─────────────────────────────────────────────────────
# JS source (engineValidation.js, validateRDD):
#   n = 200
#   x_i  = (i/n - 0.5) * 2       for i = 0, ..., 199   → uniform on (-1, 1)
#   noise_i = ((i*1013 + 7) %% 1000 - 500) / 2500       deterministic
#   treated_i = as.integer(x_i >= 0)
#   y_i  = 0.5 + 0.3*x_i + 1.0*treated_i + noise_i

n <- 200L
i_seq <- 0L:(n - 1L)

x     <- (i_seq / n - 0.5) * 2
noise <- ((i_seq * 1013L + 7L) %% 1000L - 500L) / 2500
treated <- as.integer(x >= 0)
y     <- 0.5 + 0.3 * x + 1.0 * treated + noise

cutoff <- 0

cat("=== DATA CHECK ===\n")
cat(sprintf("n = %d\n", n))
cat(sprintf("x range: [%.6f, %.6f]\n", min(x), max(x)))
cat(sprintf("y range: [%.6f, %.6f]\n", min(y), max(y)))
cat(sprintf("n treated (x>=0): %d\n", sum(treated)))
cat(sprintf("noise range: [%.6f, %.6f]\n", min(noise), max(noise)))
cat(sprintf("First 5 x: %.6f %.6f %.6f %.6f %.6f\n", x[1], x[2], x[3], x[4], x[5]))
cat(sprintf("First 5 y: %.6f %.6f %.6f %.6f %.6f\n", y[1], y[2], y[3], y[4], y[5]))

# ─── 2. Replicate JS ikBandwidth formula in R ─────────────────────────────────
# JS code (CausalEngine.js, ikBandwidth):
#
#   left  = points with x < cutoff
#   right = points with x >= cutoff
#   pilot = (max(x) - min(x)) / 4
#
#   localVariance(pts, c):
#     near = pts with |x - c| < pilot
#     fit quadratic: y ~ 1 + (x-c) + (x-c)^2  (OLS, unweighted)
#     s2   = SSR / max(1, nrow - 3)
#     curv = |beta[2]|  (quadratic coefficient)  or 0.001 if zero
#
#   s2   = (vL$s2 + vR$s2) / 2
#   curv = (vL$curv + vR$curv) / 2
#   h    = 3.4375 * (s2 / (curv^2 * n))^0.2
#   h    = clamp(h, range*0.05, range*0.8)

ik_bandwidth_js <- function(run_vals, y_vals, cutoff) {
  n_local <- length(run_vals)
  left_idx  <- which(run_vals <  cutoff)
  right_idx <- which(run_vals >= cutoff)

  if (length(left_idx) < 5 || length(right_idx) < 5) {
    return((max(run_vals) - min(run_vals)) / 4)
  }

  range_val <- max(run_vals) - min(run_vals)
  pilot     <- range_val / 4

  local_variance <- function(pts_x, pts_y, c) {
    near_idx <- which(abs(pts_x - c) < pilot)
    if (length(near_idx) < 3) return(list(s2 = 1, curv = 0.001))

    xc_near <- pts_x[near_idx] - c
    y_near  <- pts_y[near_idx]

    # Quadratic OLS: y ~ 1 + xc + xc^2
    X_mat <- cbind(1, xc_near, xc_near^2)
    # Normal equations: beta = (X'X)^{-1} X'y
    XtX <- t(X_mat) %*% X_mat
    Xty <- t(X_mat) %*% y_near
    beta_q <- tryCatch(solve(XtX, Xty), error = function(e) NULL)
    if (is.null(beta_q)) return(list(s2 = 1, curv = 0.001))

    resid <- y_near - X_mat %*% beta_q
    s2    <- sum(resid^2) / max(1, length(near_idx) - 3)
    curv  <- abs(beta_q[3])
    if (curv == 0) curv <- 0.001
    list(s2 = s2, curv = curv)
  }

  left_pts_x  <- run_vals[left_idx]
  left_pts_y  <- y_vals[left_idx]
  right_pts_x <- run_vals[right_idx]
  right_pts_y <- y_vals[right_idx]

  vL <- local_variance(left_pts_x,  left_pts_y,  cutoff)
  vR <- local_variance(right_pts_x, right_pts_y, cutoff)

  s2_avg   <- (vL$s2   + vR$s2)   / 2
  curv_avg <- (vL$curv + vR$curv) / 2

  h_raw <- 3.4375 * (s2_avg / (curv_avg^2 * n_local))^0.2
  h_clamped <- min(max(h_raw, range_val * 0.05), range_val * 0.8)
  h_clamped
}

h_ik <- ik_bandwidth_js(x, y, cutoff)
cat(sprintf("\n=== BANDWIDTH ===\n"))
cat(sprintf("JS ikBandwidth (replicated in R): h = %.10f\n", h_ik))

# ─── 3. Manual local-linear WLS matching EconSolver's runWLS ─────────────────
# EconSolver design matrix: X = [1, D, xc, D*xc]  where xc = x - cutoff, D = 1(x>=0)
# Kernel: triangular, w_i = (1 - |x_i - c| / h)  for |x_i - c| <= h
# runWLS uses UNWEIGHTED SSR for sigma^2: SSR_uw / (n_window - k)
# SE[j] = sqrt(XtXinv[j,j] * s2)  where XtXinv uses WEIGHTED X'X
# beta   = (X'WX)^{-1} X'Wy  (WLS normal equations)

rdd_manual <- function(x_all, y_all, cutoff, h, kernel = "triangular") {
  # Window filter
  in_win <- which(abs(x_all - cutoff) <= h)
  x_w    <- x_all[in_win]
  y_w    <- y_all[in_win]
  n_w    <- length(x_w)

  if (n_w < 6) stop("Too few observations in window")

  # Kernel weights (triangular)
  u <- abs(x_w - cutoff) / h
  if (kernel == "triangular") {
    kern_w <- ifelse(u <= 1, 1 - u, 0)
  } else {
    kern_w <- rep(1, n_w)
  }

  xc_w <- x_w - cutoff
  D_w  <- as.numeric(x_w >= cutoff)

  # Design matrix: [1, D, xc, D*xc]
  X_mat <- cbind(1, D_w, xc_w, D_w * xc_w)
  k_mat <- ncol(X_mat)

  # WLS: beta = (X'WX)^{-1} X'Wy
  W_diag <- diag(kern_w)
  XtWX   <- t(X_mat) %*% W_diag %*% X_mat
  XtWy   <- t(X_mat) %*% W_diag %*% y_w
  beta   <- as.vector(solve(XtWX, XtWy))

  # Fitted values and residuals (unweighted)
  yhat   <- X_mat %*% beta
  resid  <- y_w - yhat

  df_w   <- n_w - k_mat

  # UNWEIGHTED SSR (EconSolver uses SSR_uw for sigma^2)
  SSR_uw <- sum(resid^2)
  s2     <- SSR_uw / max(1, df_w)

  # SE: uses WEIGHTED (X'WX)^{-1} times s2 (unweighted)
  XtWX_inv <- solve(XtWX)
  se_vec   <- sqrt(abs(diag(XtWX_inv) * s2))

  list(
    beta   = beta,
    se     = se_vec,
    n_win  = n_w,
    df     = df_w,
    h      = h,
    LATE   = beta[2],
    lateSE = se_vec[2]
  )
}

cat("\n=== MANUAL WLS (matches EconSolver runWLS) ===\n")
manual_res <- rdd_manual(x, y, cutoff, h_ik, kernel = "triangular")
cat(sprintf("n in window: %d\n", manual_res$n_win))
cat(sprintf("df: %d\n", manual_res$df))
cat(sprintf("beta[Intercept]:    %.6f   SE: %.4f\n", manual_res$beta[1], manual_res$se[1]))
cat(sprintf("beta[D (LATE)]:     %.6f   SE: %.4f\n", manual_res$beta[2], manual_res$se[2]))
cat(sprintf("beta[xc]:           %.6f   SE: %.4f\n", manual_res$beta[3], manual_res$se[3]))
cat(sprintf("beta[D*xc]:         %.6f   SE: %.4f\n", manual_res$beta[4], manual_res$se[4]))
cat(sprintf("\nLATE  = %.6f\n", manual_res$LATE))
cat(sprintf("lateSE= %.4f\n",  manual_res$lateSE))

# ─── 4. rdrobust with fixed h (gold-standard R reference) ────────────────────
# rdrobust with h = h_ik (same bandwidth as JS), triangular kernel, HC0 SE.
# rho=1 forces same bandwidth on both sides; no bias correction (rho=1 uses
# conventional SE, not robust bias-corrected).
# We use bwselect="mserd" but override with h argument so rdrobust uses our h.

cat("\n=== rdrobust (h = JS ikBandwidth, triangular, se.type=hc0) ===\n")

# rdrobust: pass h as vector c(h,h) to use same bandwidth on both sides
rdd_r <- rdrobust(y, x, c = cutoff,
                  h     = h_ik,
                  kernel = "triangular",
                  vce   = "hc0")

cat(sprintf("rdrobust h used: %.10f\n", rdd_r$bws[1,1]))
cat(sprintf("rdrobust N (left): %d, N (right): %d\n",
            rdd_r$N_h[1], rdd_r$N_h[2]))
cat(sprintf("LATE (coef[1]):    %.6f\n", rdd_r$coef[1]))
cat(sprintf("SE (se[1]):        %.4f\n",  rdd_r$se[1]))
cat(sprintf("95%% CI: [%.6f, %.6f]\n",
            rdd_r$ci[1,1], rdd_r$ci[1,2]))

# Also print robust bias-corrected for reference
cat(sprintf("LATE (robust bc):  %.6f\n", rdd_r$coef[3]))
cat(sprintf("SE   (robust bc):  %.4f\n",  rdd_r$se[3]))

# ─── 5. Summary for embedding ─────────────────────────────────────────────────
cat("\n=== COPY THESE VALUES ===\n")
cat(sprintf("Fixed bandwidth (h):          %.10f\n", h_ik))
cat("--- Manual WLS (EconSolver-equivalent) ---\n")
cat(sprintf("LATE  (manual):  %.6f\n", manual_res$LATE))
cat(sprintf("lateSE (manual): %.4f\n",  manual_res$lateSE))
cat(sprintf("n_window:        %d\n",    manual_res$n_win))
cat(sprintf("df:              %d\n",    manual_res$df))
cat("--- rdrobust conventional (same h, hc0) ---\n")
cat(sprintf("LATE  (rdrobust): %.6f\n", rdd_r$coef[1]))
cat(sprintf("SE    (rdrobust): %.4f\n",  rdd_r$se[1]))
cat("\n")
