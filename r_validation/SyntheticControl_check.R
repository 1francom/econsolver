# ─── EconSolver · r_validation/SyntheticControl_check.R ─────────────────────
# Validates SyntheticControlEngine.js (Frank-Wolfe) against R's Synth package
# (ipop quadratic programming solver).
#
# Dataset: 6 units (1 treated + 5 donors), 12 periods (8 pre + 4 post).
# Predictor: outcome Y itself averaged over pre-period (predictors = "Y").
# Unit 1 = treated; Units 2–6 = donors.
#
# Key design choice: Donor 2 tracks Treated very closely pre-period →
# near-corner solution W[2] ≈ 1. Both solvers should agree on this
# degenerate-near case, making weight tolerance realistic at 1e-2.
#
# Required packages:
#   install.packages("Synth")
# ─────────────────────────────────────────────────────────────────────────────

library(Synth)

# ── 1. Fixed panel data ───────────────────────────────────────────────────────
# 6 units × 12 periods = 72 rows
# Treatment: Unit 1, begins at period 9 (pre = 1..8, post = 9..12)

units  <- 1:6
times  <- 1:12
treat_unit <- 1
treat_time <- 9   # first post-treatment period

# Outcome values: hand-crafted so Donor 2 closely mimics Treated pre-treatment.
# Layout: rows = times 1..12, cols = units 1..6
Y_matrix <- matrix(c(
  # t=1
  10.0, 10.2,  8.5,  7.0, 12.0,  9.5,
  # t=2
  11.0, 11.1,  9.2,  7.8, 12.5, 10.0,
  # t=3
  12.5, 12.6, 10.0,  8.5, 13.0, 10.8,
  # t=4
  11.8, 11.9,  9.5,  8.0, 13.5, 10.3,
  # t=5
  13.0, 13.2, 10.8,  9.2, 14.0, 11.5,
  # t=6
  14.2, 14.3, 11.5, 10.0, 14.5, 12.0,
  # t=7
  13.5, 13.6, 10.5,  9.5, 15.0, 11.8,
  # t=8
  15.0, 15.1, 12.0, 10.8, 15.5, 12.5,
  # t=9  (post-treatment starts — treated deviates)
  16.0, 14.8, 12.5, 11.0, 16.0, 13.0,
  # t=10
  17.5, 15.2, 13.0, 11.5, 16.5, 13.5,
  # t=11
  19.0, 15.5, 13.5, 12.0, 17.0, 14.0,
  # t=12
  20.5, 15.9, 14.0, 12.5, 17.5, 14.5
), nrow = 12, ncol = 6, byrow = TRUE)

colnames(Y_matrix) <- paste0("unit", units)
rownames(Y_matrix) <- paste0("t",    times)

# ── 2. Build long-format data frame ──────────────────────────────────────────
df <- data.frame(
  unit = rep(units, each = length(times)),
  time = rep(times, times = length(units)),
  Y    = as.vector(t(Y_matrix))   # t() because matrix is time×unit
)

# Verify dimensions
stopifnot(nrow(df) == 72)

# ── 3. dataprep() ─────────────────────────────────────────────────────────────
# Predictor: mean of Y over pre-period (periods 1..8) — matches EconSolver
# which appends predMean(unit, "Y") rows to the matching matrix.

dp <- dataprep(
  foo                = df,
  predictors         = "Y",
  predictors.op      = "mean",      # predictor = pre-period mean of Y
  dependent          = "Y",
  unit.variable      = "unit",
  time.variable      = "time",
  treatment.identifier  = treat_unit,
  controls.identifier   = 2:6,
  time.predictors.prior = 1:8,      # pre-treatment periods for predictor mean
  time.optimize.ssr     = 1:8,      # periods used to minimise SSR (= MSPE)
  time.plot             = 1:12
)

# ── 4. synth() ────────────────────────────────────────────────────────────────
set.seed(42)   # ipop has some numerical noise; seed for reproducibility
capture.output({
  fit <- synth(dp)
}, file = nullfile())

# ── 5. Extract results ────────────────────────────────────────────────────────
solution_w <- fit$solution.w          # named vector of donor weights
loss_w     <- fit$loss.w              # objective value at solution (MSPE)

# Donor order from Synth: units 2,3,4,5,6
donor_labels <- paste0("unit", 2:6)

# Pre-period MSPE from the objective: loss.w = (1/T_pre) * SSR
# EconSolver returns rmspe_pre = sqrt(MSPE), so:
mspe_pre  <- as.numeric(loss_w)
rmspe_pre <- sqrt(mspe_pre)

# Cross-check: manually compute synthetic Y pre-period and RMSPE
pre_Y1     <- Y_matrix[1:8, 1]                  # treated pre
pre_Y0     <- Y_matrix[1:8, 2:6]               # donor pre (8 × 5)
synth_pre  <- pre_Y0 %*% solution_w             # (8 × 1)
resid_pre  <- pre_Y1 - synth_pre
rmspe_manual <- sqrt(mean(resid_pre^2))

# Post-period gaps
post_Y1    <- Y_matrix[9:12, 1]
post_Y0    <- Y_matrix[9:12, 2:6]
synth_post <- post_Y0 %*% solution_w
gap_post   <- post_Y1 - synth_post

# ── 6. Print reference values ─────────────────────────────────────────────────
cat("\n=== COPY THESE VALUES ===\n\n")

cat("--- Donor weights (Synth / ipop) ---\n")
for (i in seq_along(donor_labels)) {
  cat(sprintf("W[%s] = %.6f\n", donor_labels[i], solution_w[i]))
}

cat(sprintf("\nPre-period MSPE  (loss.w)      = %.6f\n", mspe_pre))
cat(sprintf("Pre-period RMSPE (sqrt(MSPE))  = %.6f\n", rmspe_pre))
cat(sprintf("Pre-period RMSPE (manual check)= %.6f\n", rmspe_manual))

cat("\n--- Post-period synthetic values ---\n")
for (i in 1:4) {
  cat(sprintf("t=%d  actual=%.4f  synthetic=%.4f  gap=%.4f\n",
              8 + i, post_Y1[i], synth_post[i], gap_post[i]))
}

cat("\n=== END COPY BLOCK ===\n\n")

# ── 7. 4dp summary (tolerance check format) ──────────────────────────────────
cat("--- 4dp summary (EconSolver comparison targets) ---\n")
for (i in seq_along(donor_labels)) {
  cat(sprintf("W[%s]    %.4f\n", donor_labels[i], solution_w[i]))
}
cat(sprintf("rmspe_pre  %.4f\n", rmspe_pre))

# ── 8. Diagnostic: verify weights sum to 1 ───────────────────────────────────
cat(sprintf("\nWeight sum check: %.10f  (should be 1.0)\n", sum(solution_w)))
cat(sprintf("All weights >= 0: %s\n", all(solution_w >= -1e-10)))
