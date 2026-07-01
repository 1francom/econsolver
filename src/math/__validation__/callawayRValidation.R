# Franco runs: Rscript src/math/__validation__/callawayRValidation.R
# Requires: install.packages(c("did", "dplyr", "jsonlite"))
library(did); library(dplyr); library(jsonlite)

# DGP matching the JS suiteSyntheticDGP: 4-year panel, cohorts 2004 and 2006
# Using a deterministic DGP (no random noise) so JS/R match exactly
n_per_cohort <- 5
years <- 2003:2006

make_panel <- function() {
  rows <- list()
  # Cohort 2004: ATT = 0.5
  for (u in 1:n_per_cohort) {
    for (t in years) {
      rows[[length(rows)+1]] <- list(
        id = paste0("A", u), t = t, g = 2004,
        y  = 10 + u * 0.1 + ifelse(t >= 2004, 0.5, 0)
      )
    }
  }
  # Cohort 2006: ATT = 0.3
  for (u in 1:n_per_cohort) {
    for (t in years) {
      rows[[length(rows)+1]] <- list(
        id = paste0("B", u), t = t, g = 2006,
        y  = 10 + u * 0.1 + ifelse(t >= 2006, 0.3, 0)
      )
    }
  }
  # Never-treated (g=0)
  for (u in 1:n_per_cohort) {
    for (t in years) {
      rows[[length(rows)+1]] <- list(
        id = paste0("C", u), t = t, g = 0,
        y  = 10 + u * 0.1
      )
    }
  }
  bind_rows(rows)
}

df <- make_panel()
df$id <- as.numeric(factor(df$id))

run_cs <- function(ctrl, base, meth) {
  out <- att_gt(
    yname        = "y",
    gname        = "g",
    idname       = "id",
    tname        = "t",
    xformla      = ~1,
    data         = df,
    control_group = ctrl,
    base_period  = base,
    est_method   = meth,
    bstrap       = FALSE,
    cband        = FALSE
  )
  agg_dyn <- aggte(out, type = "dynamic", na.rm = TRUE)
  agg_grp <- aggte(out, type = "group",   na.rm = TRUE)
  agg_cal <- aggte(out, type = "calendar", na.rm = TRUE)
  agg_sim <- aggte(out, type = "simple",  na.rm = TRUE)
  list(
    attgt    = data.frame(g = out$group, t = out$t, att = out$att, se = out$se),
    dynamic  = list(
      overall = list(att = agg_dyn$overall.att, se = agg_dyn$overall.se),
      byE     = data.frame(e = agg_dyn$egt, att = agg_dyn$att.egt, se = agg_dyn$se.egt)
    ),
    group    = list(
      overall = list(att = agg_grp$overall.att, se = agg_grp$overall.se),
      byG     = data.frame(g = agg_grp$egt, att = agg_grp$att.egt, se = agg_grp$se.egt)
    ),
    calendar = list(
      overall = list(att = agg_cal$overall.att, se = agg_cal$overall.se),
      byT     = data.frame(t = agg_cal$egt, att = agg_cal$att.egt, se = agg_cal$se.egt)
    ),
    simple   = list(att = agg_sim$overall.att, se = agg_sim$overall.se)
  )
}

fixtures <- list()
for (ctrl in c("nevertreated", "notyettreated")) {
  for (base in c("varying", "universal")) {
    for (meth in c("dr", "reg")) {
      key <- paste(ctrl, base, meth, sep = "_")
      cat("Running", key, "...\n")
      fixtures[[key]] <- run_cs(ctrl, base, meth)
    }
  }
}

write_json(fixtures, "src/math/__validation__/callawayBenchmarks.json",
           digits = 8, pretty = TRUE)
cat("Done. did version:", as.character(packageVersion("did")), "\n")
cat("Fixtures written to callawayBenchmarks.json\n")
