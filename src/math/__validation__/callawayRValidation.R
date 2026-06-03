# ─── ECON STUDIO · Callaway-Sant'Anna validation vs R `did` package ──────────
# Generates benchmark fixtures for callawayValidation.js.
#
# Run in R ≥ 4.1:
#   install.packages("did")
#   Rscript callawayRValidation.R
#
# Expected output: 6 dp coefficients, 4 dp SE, matching JS engine within tolerances.

library(did)
set.seed(42)

# ─── 1. mpdta dataset (built-in to `did` package) ─────────────────────────────
# Multi-period DiD: county-level log employment (lemp) over 2003–2007.
# Treated counties in 2004, 2006, 2007 (staggered).
data(mpdta)

cat("=== mpdta dataset ===\n")
cat("dim:", nrow(mpdta), "×", ncol(mpdta), "\n")
cat("columns:", paste(names(mpdta), collapse=", "), "\n")
cat("unique years:", paste(sort(unique(mpdta$year)), collapse=", "), "\n")
cat("unique first.treat:", paste(sort(unique(mpdta$first.treat)), collapse=", "), "\n\n")

# ─── 2. att_gt: group-time ATTs ───────────────────────────────────────────────
out <- att_gt(
  yname        = "lemp",
  gname        = "first.treat",
  idname       = "countyreal",
  tname        = "year",
  data         = mpdta,
  control_group = "nevertreated",
  est_method   = "reg",        # outcome-regression (matches our OR estimator)
  panel        = TRUE,
  allow_unbalanced_panel = FALSE,
  print_details = FALSE,
)

cat("=== att_gt results ===\n")
att_df <- data.frame(
  g   = out$group,
  t   = out$t,
  att = round(out$att, 6),
  se  = round(out$se, 6)
)
print(att_df)
cat("\n")

# ─── 3. aggte: dynamic / event-study aggregation ──────────────────────────────
agg <- aggte(out, type = "dynamic", na.rm = TRUE)

cat("=== aggte(dynamic) — event-study ATTs by relative period ===\n")
evt_df <- data.frame(
  rel_period = agg$egt,
  att        = round(agg$att.egt, 6),
  se         = round(agg$se.egt,  6)
)
print(evt_df)
cat("\n")

# ─── 4. Overall ATT ───────────────────────────────────────────────────────────
agg_simple <- aggte(out, type = "simple", na.rm = TRUE)
cat("=== Overall ATT (simple aggregate) ===\n")
cat("ATT  =", round(agg_simple$overall.att, 6), "\n")
cat("SE   =", round(agg_simple$overall.se,  6), "\n")
cat("p    =", round(2 * pnorm(-abs(agg_simple$overall.att / agg_simple$overall.se)), 4), "\n\n")

# ─── 5. Print JSON-ready fixture for callawayValidation.js ────────────────────
cat("=== JSON fixture (paste into callawayValidation.js) ===\n")
cat("eventStudy: [\n")
for (i in seq_along(agg$egt)) {
  comma <- if (i < length(agg$egt)) "," else ""
  cat(sprintf('  { rel: %d, att: %.6f, se: %.6f }%s\n',
              agg$egt[i], agg$att.egt[i], agg$se.egt[i], comma))
}
cat("],\n")
cat(sprintf('overallATT: %.6f,\n', agg_simple$overall.att))
cat(sprintf('overallSE:  %.6f,\n', agg_simple$overall.se))
