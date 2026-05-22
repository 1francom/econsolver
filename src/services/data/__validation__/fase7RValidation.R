# fase7RValidation.R - generates fase7_data.csv and fase7Benchmarks.json
# Run from project root:
#   Rscript src/services/data/__validation__/fase7RValidation.R
#
# Base-R reference for the current Fase 7 SQL design:
#   sharp RDD = local WLS y ~ D + (r-c) + D:(r-c)
#   fuzzy RDD = Wald ratio of sharp jumps in outcome and take-up
# with triangular kernel weights and the same IK-style bandwidth rule used by
# CausalEngine/duckdbRDDBandwidth.

set.seed(20260521)

out_dir <- file.path("src", "services", "data", "__validation__")
n <- 20000
r <- runif(n, -1, 1)
above <- as.integer(r >= 0)
d <- rbinom(n, 1, pmin(pmax(0.18 + 0.62 * above + 0.04 * r, 0.02), 0.98))
y_sharp <- 1.1 + 0.65 * r + 0.85 * above + 0.3 * r * above +
  rnorm(n, sd = 0.6 + 0.15 * abs(r))
y_fuzzy <- 0.8 + 0.4 * r + 1.25 * d + 0.2 * r * above +
  rnorm(n, sd = 0.55 + 0.1 * abs(r))

df <- data.frame(r, above, d, y_sharp, y_fuzzy)
write.csv(df, file.path(out_dir, "fase7_data.csv"), row.names = FALSE)

quad_stats <- function(y, run, cutoff, side, pilot) {
  keep <- is.finite(y) & is.finite(run) & abs(run - cutoff) < pilot
  keep <- keep & if (side == "left") run < cutoff else run >= cutoff
  u <- run[keep] - cutoff
  yy <- y[keep]
  if (length(yy) < 3) return(list(s2 = 1, curv = 0.001, n = length(yy)))
  X <- cbind(1, u, u^2)
  beta <- solve(crossprod(X), crossprod(X, yy))
  resid <- yy - X %*% beta
  list(
    s2 = as.numeric(crossprod(resid)) / max(1, length(yy) - 3),
    curv = abs(as.numeric(beta[3])) %||% 0.001,
    n = length(yy)
  )
}

`%||%` <- function(a, b) if (is.na(a) || a == 0) b else a

ik_bandwidth <- function(y, run, cutoff) {
  ok <- is.finite(y) & is.finite(run)
  y <- y[ok]
  run <- run[ok]
  range <- max(run) - min(run)
  pilot <- range / 4
  left <- quad_stats(y, run, cutoff, "left", pilot)
  right <- quad_stats(y, run, cutoff, "right", pilot)
  s2 <- (left$s2 + right$s2) / 2
  curv <- (left$curv + right$curv) / 2
  raw <- 3.4375 * (s2 / (curv^2 * length(run)))^0.2
  min(max(raw, range * 0.05), range * 0.8)
}

rdd_wls <- function(y, run, cutoff, h, robust = FALSE) {
  u <- run - cutoff
  weight <- pmax(0, 1 - abs(u) / h)
  keep <- is.finite(y) & is.finite(run) & weight > 0
  yy <- y[keep]
  uu <- u[keep]
  dd <- as.integer(run[keep] >= cutoff)
  ww <- weight[keep]
  X <- cbind(1, dd, uu, dd * uu)
  bread <- solve(crossprod(X, X * ww))
  beta <- bread %*% crossprod(X, yy * ww)
  resid <- yy - X %*% beta
  n_eff <- length(yy)
  df_resid <- n_eff - ncol(X)
  if (robust) {
    meat <- crossprod(X, X * as.numeric((ww^2) * resid^2))
    V <- (n_eff / max(1, df_resid)) * bread %*% meat %*% bread
  } else {
    s2 <- as.numeric(crossprod(resid)) / max(1, df_resid)
    V <- bread * s2
  }
  list(
    beta = as.numeric(beta),
    se = sqrt(pmax(0, diag(V))),
    late = as.numeric(beta[2]),
    lateSE = sqrt(pmax(0, diag(V)))[2],
    n = n_eff,
    df = df_resid
  )
}

fuzzy_wald <- function(y, treat, run, cutoff, h, robust = FALSE) {
  reduced <- rdd_wls(y, run, cutoff, h, robust)
  first <- rdd_wls(treat, run, cutoff, h, robust)
  late <- reduced$late / first$late
  late_var <- (reduced$lateSE^2) / (first$late^2) +
    ((reduced$late^2) * (first$lateSE^2)) / (first$late^4)
  list(
    late = late,
    lateSE = sqrt(max(0, late_var)),
    firstStageJumpD = first$late,
    reducedFormJump = reduced$late
  )
}

normal_pvalue <- function(z) {
  abs_z <- abs(z)
  t <- 1 / (1 + 0.2316419 * abs_z)
  poly <- t * (0.319381530 +
    t * (-0.356563782 +
    t * (1.781477937 +
    t * (-1.821255978 +
    t * 1.330274429))))
  min(1, max(0, 2 * exp(-0.5 * abs_z^2) / sqrt(2 * pi) * poly))
}

local_density <- function(bins, eval_pt, h_fit) {
  active <- bins
  active$w <- pmax(0, 1 - abs(active$x - eval_pt) / h_fit)
  active <- active[active$w > 0, ]
  if (nrow(active) < 2) return(NULL)
  xc <- active$x - eval_pt
  sw <- sum(active$w)
  swx <- sum(active$w * xc)
  swy <- sum(active$w * active$density)
  swxx <- sum(active$w * xc^2)
  swxy <- sum(active$w * xc * active$density)
  det <- sw * swxx - swx^2
  if (abs(det) < 1e-15) return(NULL)
  a <- (swxx * swy - swx * swxy) / det
  b <- (sw * swxy - swx * swy) / det
  resid <- active$density - (a + b * xc)
  sigma_w2 <- sum(active$w * resid^2) / max(1, nrow(active) - 2)
  list(fhat = a, var_fhat = sigma_w2 * swxx / det)
}

mc_crary <- function(run, cutoff, h = NULL, bins = NULL) {
  vals <- run[is.finite(run)]
  n <- length(vals)
  x_min <- min(vals)
  x_max <- max(vals)
  range <- x_max - x_min
  q1 <- as.numeric(quantile(vals, 0.25, names = FALSE))
  q3 <- as.numeric(quantile(vals, 0.75, names = FALSE))
  iqr <- q3 - q1
  auto_bins <- if (iqr > 0) {
    ceiling(range / (2 * iqr * n^(-1 / 3)))
  } else {
    ceiling(sqrt(n))
  }
  n_bins <- if (is.null(bins)) min(max(auto_bins, 10), 100) else bins
  bw <- range / n_bins
  cutoff_bin <- floor((cutoff - x_min) / bw)
  grid_start <- cutoff - cutoff_bin * bw
  idx <- floor((vals - grid_start) / bw)
  max_idx <- n_bins + 1
  bin_data <- do.call(rbind, lapply(0:max_idx, function(i) {
    x <- grid_start + (i + 0.5) * bw
    if (x < x_min - bw || x > x_max + bw) return(NULL)
    data.frame(
      x = x,
      density = sum(idx == i) / (n * bw),
      side = if (x < cutoff) "left" else "right"
    )
  }))
  left_bins <- bin_data[bin_data$side == "left" & bin_data$x >= x_min, ]
  right_bins <- bin_data[bin_data$side == "right" & bin_data$x <= x_max, ]
  x_sd <- sqrt(mean((vals - mean(vals))^2))
  h_auto <- 1.06 * min(x_sd, iqr / 1.34) * n^(-0.2)
  h_fit <- if (is.null(h)) max(h_auto, range * 0.15) else h
  left <- local_density(left_bins, cutoff, h_fit)
  right <- local_density(right_bins, cutoff, h_fit)
  fhat_left <- max(left$fhat, 1e-10)
  fhat_right <- max(right$fhat, 1e-10)
  theta <- log(fhat_right / fhat_left)
  theta_se <- sqrt(max(0, right$var_fhat / fhat_right^2 + left$var_fhat / fhat_left^2))
  z_stat <- theta / theta_se
  list(
    theta = theta,
    thetaSE = theta_se,
    zStat = z_stat,
    pVal = normal_pvalue(z_stat),
    h = h_fit,
    bw = bw,
    nBins = n_bins
  )
}

manual_h <- 0.55
sharp_classical <- rdd_wls(df$y_sharp, df$r, 0, manual_h, FALSE)
sharp_hc1 <- rdd_wls(df$y_sharp, df$r, 0, manual_h, TRUE)
fuzzy_classical <- fuzzy_wald(df$y_fuzzy, df$d, df$r, 0, manual_h, FALSE)
fuzzy_hc1 <- fuzzy_wald(df$y_fuzzy, df$d, df$r, 0, manual_h, TRUE)
h_ik <- ik_bandwidth(df$y_sharp, df$r, 0)
mc <- mc_crary(df$r, 0)

num_json <- function(values) {
  paste0("[", paste(format(values, digits = 12, scientific = FALSE, trim = TRUE), collapse = ", "), "]")
}

one_json <- function(value) {
  format(value, digits = 12, scientific = FALSE, trim = TRUE)
}

json_lines <- c(
  "{",
  paste0('  "manual_h": ', one_json(manual_h), ","),
  paste0('  "ik_h": ', one_json(h_ik), ","),
  '  "SharpRDD": {',
  paste0('    "beta": ', num_json(sharp_classical$beta), ","),
  paste0('    "se_classical": ', num_json(sharp_classical$se), ","),
  paste0('    "se_HC1": ', num_json(sharp_hc1$se), ","),
  paste0('    "late": ', one_json(sharp_classical$late), ","),
  paste0('    "lateSE_classical": ', one_json(sharp_classical$lateSE), ","),
  paste0('    "lateSE_HC1": ', one_json(sharp_hc1$lateSE)),
  "  },",
  '  "FuzzyRDD": {',
  paste0('    "late": ', one_json(fuzzy_classical$late), ","),
  paste0('    "lateSE_classical": ', one_json(fuzzy_classical$lateSE), ","),
  paste0('    "lateSE_HC1": ', one_json(fuzzy_hc1$lateSE), ","),
  paste0('    "firstStageJumpD": ', one_json(fuzzy_classical$firstStageJumpD), ","),
  paste0('    "reducedFormJump": ', one_json(fuzzy_classical$reducedFormJump)),
  "  },",
  '  "McCrary": {',
  paste0('    "theta": ', one_json(mc$theta), ","),
  paste0('    "thetaSE": ', one_json(mc$thetaSE), ","),
  paste0('    "zStat": ', one_json(mc$zStat), ","),
  paste0('    "pVal": ', one_json(mc$pVal), ","),
  paste0('    "h": ', one_json(mc$h), ","),
  paste0('    "bw": ', one_json(mc$bw), ","),
  paste0('    "nBins": ', one_json(mc$nBins)),
  "  }",
  "}"
)
writeLines(json_lines, file.path(out_dir, "fase7Benchmarks.json"))
cat("Wrote", file.path(out_dir, "fase7_data.csv"), "and", file.path(out_dir, "fase7Benchmarks.json"), "\n")
