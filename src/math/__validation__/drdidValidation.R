# ─── ECON STUDIO · src/math/__validation__/drdidValidation.R ──────────────────
# Generates R fixtures for the JS drdidValidation.js harness.
#
# Run:  Rscript src/math/__validation__/drdidValidation.R
# Requires: install.packages("DRDID")
#
# Paste the printed R_FIXTURES lines into drdidValidation.js.

library(DRDID)

deltaY <- c(1.9, 2.1, 1.7, 2.3, 2.0, 1.8,  0.4, 0.6, 0.5, 0.3, 0.7, 0.5)
D      <- c(rep(1L, 6), rep(0L, 6))
covX   <- c(0.2, 0.5, -0.1, 0.8, 0.3, 0.0,  1.1, 0.9, 1.4, 1.0, 1.2, 0.7)

# DRDID panel functions expect y1 (post) and y0 (pre).
# Here deltaY = y1 - y0, so we pass y1 = deltaY, y0 = 0.
y1 <- deltaY
y0 <- rep(0, length(deltaY))
covariates <- cbind(1, covX)   # n×2 matrix with intercept

n <- length(deltaY)

cat("// Paste these lines into R_FIXTURES in drdidValidation.js:\n")
for (m in c("reg", "ipw", "dr")) {
  fn <- switch(m,
    reg = reg_did_panel,
    ipw = std_ipw_did_panel,
    dr  = drdid_panel
  )
  res <- fn(y1 = y1, y0 = y0, D = D, covariates = covariates, inffunc = TRUE)
  se  <- sqrt(mean(res$att.inf.func^2)) / n
  cat(sprintf('  R_FIXTURES["%s"] = { att: %.6f, se: %.6f };\n', m, res$ATT, se))
}

cat("\n// Full output for inspection:\n")
for (m in c("reg", "ipw", "dr")) {
  fn <- switch(m,
    reg = reg_did_panel,
    ipw = std_ipw_did_panel,
    dr  = drdid_panel
  )
  res <- fn(y1 = y1, y0 = y0, D = D, covariates = covariates, inffunc = TRUE)
  se  <- sqrt(mean(res$att.inf.func^2)) / n
  cat(sprintf("\n[%s] ATT = %.6f  SE = %.6f\n", m, res$ATT, se))
  cat("  inf.func (first 6):", paste(round(res$att.inf.func[1:6], 6), collapse = ", "), "\n")
}
