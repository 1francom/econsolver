# ── Fase 4b: R validation — TWFE + panel robust SE ────────────────────────────
# Generates: fase4b_data.csv + fase4bBenchmarks.json
#
# Reference libraries:
#   fixest  (feols, cluster SE)
#   plm     (vcovSCC Driscoll-Kraay)
#   sandwich / lmtest (HC2/HC3 baseline)
#   clubSandwich (CR2/CR3 within-design HC2/HC3)
#
# Run from src/services/data/__validation__/ :
#   Rscript fase4bRValidation.R

library(fixest)
library(plm)
library(sandwich)
library(lmtest)
library(clubSandwich)
library(jsonlite)

set.seed(20260521)
G  <- 200     # entities
TT <- 30      # time periods (avoid name clash with T=TRUE)
n  <- G * TT

panel <- expand.grid(id = 1:G, t = 1:TT)
panel <- panel[order(panel$id, panel$t), ]
panel$x1     <- rnorm(n)
panel$x2     <- rnorm(n)
panel$alpha_i <- rnorm(G)[panel$id]
panel$alpha_t <- rnorm(TT)[panel$t]
panel$y      <- 0.5 * panel$x1 - 0.3 * panel$x2 +
                panel$alpha_i + panel$alpha_t +
                rnorm(n, sd = 0.5 + abs(panel$x1) * 0.2)   # heteroskedastic

write.csv(panel, "fase4b_data.csv", row.names = FALSE)
cat("Wrote fase4b_data.csv (", nrow(panel), "rows)\n")

# ── Helper -------------------------------------------------------------------
cell <- function(fit, vcov_mat) {
  coef_vec <- coef(fit)
  # strip intercept if present
  coef_vec <- coef_vec[!grepl("Intercept", names(coef_vec), ignore.case = TRUE)]
  se_vec   <- sqrt(diag(vcov_mat))
  se_vec   <- se_vec[names(se_vec) %in% names(coef_vec)]
  list(
    coef = unname(coef_vec),
    se   = unname(se_vec),
    n    = nobs(fit),
    df   = df.residual(fit)
  )
}

benchmarks <- list()

# ── FE × cluster-by-entity --------------------------------------------------
fe_cl <- feols(y ~ x1 + x2 | id, data = panel, cluster = "id")
benchmarks[["fe_cluster"]] <- list(
  coef = unname(coef(fe_cl)),
  se   = unname(se(fe_cl)),
  n    = nobs(fe_cl),
  df   = degrees_freedom(fe_cl, type = "resid")
)
cat("FE cluster: coef =", round(coef(fe_cl), 6), "\n")

# ── FE × HC2 (CR2 via clubSandwich — within-design leverage) ----------------
fe_lm  <- lm(y ~ x1 + x2 + factor(id), data = panel)
cr2_mat <- vcovCR(fe_lm, cluster = panel$id, type = "CR2")
# Extract x1/x2 rows/cols only
cr2_sub <- cr2_mat[c("x1","x2"), c("x1","x2")]
benchmarks[["fe_hc2"]] <- list(
  coef = unname(coef(fe_lm)[c("x1","x2")]),
  se   = unname(sqrt(diag(cr2_sub))),
  n    = nobs(fe_lm),
  note = "CR2 from clubSandwich on LSDV; tolerance 1e-3 on SE"
)
cat("FE HC2 (CR2):", round(sqrt(diag(cr2_sub)), 6), "\n")

# ── FE × HC3 (CR3 via clubSandwich) -----------------------------------------
cr3_mat <- vcovCR(fe_lm, cluster = panel$id, type = "CR3")
cr3_sub <- cr3_mat[c("x1","x2"), c("x1","x2")]
benchmarks[["fe_hc3"]] <- list(
  coef = unname(coef(fe_lm)[c("x1","x2")]),
  se   = unname(sqrt(diag(cr3_sub))),
  n    = nobs(fe_lm),
  note = "CR3 from clubSandwich; tolerance 1e-3 on SE"
)
cat("FE HC3 (CR3):", round(sqrt(diag(cr3_sub)), 6), "\n")

# ── FE × Driscoll-Kraay HAC -------------------------------------------------
pdata  <- pdata.frame(panel, index = c("id", "t"))
fe_plm <- plm(y ~ x1 + x2, data = pdata, model = "within")
dk_mat <- vcovSCC(fe_plm)
benchmarks[["fe_hac"]] <- list(
  coef = unname(coef(fe_plm)),
  se   = unname(sqrt(diag(dk_mat))),
  n    = nobs(fe_plm),
  note = "Driscoll-Kraay via plm::vcovSCC; tolerance 1e-3 on SE"
)
cat("FE DK-HAC:", round(sqrt(diag(dk_mat)), 6), "\n")

# ── FD × cluster-by-entity --------------------------------------------------
# First-difference manually, then cluster on id
panel_s   <- panel[order(panel$id, panel$t), ]
panel_s$dy  <- ave(panel_s$y,  panel_s$id, FUN = function(v) c(NA, diff(v)))
panel_s$dx1 <- ave(panel_s$x1, panel_s$id, FUN = function(v) c(NA, diff(v)))
panel_s$dx2 <- ave(panel_s$x2, panel_s$id, FUN = function(v) c(NA, diff(v)))
fd_data <- na.omit(panel_s[, c("id","t","dy","dx1","dx2")])

fd_lm  <- lm(dy ~ dx1 + dx2, data = fd_data)
cl_mat <- vcovCL(fd_lm, cluster = ~ id, data = fd_data)
benchmarks[["fd_cluster"]] <- list(
  coef = unname(coef(fd_lm)[c("dx1","dx2")]),
  se   = unname(sqrt(diag(cl_mat))[c("dx1","dx2")]),
  n    = nobs(fd_lm),
  note = "FD cluster via lm + vcovCL"
)
cat("FD cluster:", round(coef(fd_lm)[c("dx1","dx2")], 6), "\n")

# ── FD × HC2 ----------------------------------------------------------------
hc2_mat <- vcovHC(fd_lm, type = "HC2")
benchmarks[["fd_hc2"]] <- list(
  coef = unname(coef(fd_lm)[c("dx1","dx2")]),
  se   = unname(sqrt(diag(hc2_mat))[c("dx1","dx2")]),
  n    = nobs(fd_lm)
)
cat("FD HC2:", round(sqrt(diag(hc2_mat))[c("dx1","dx2")], 6), "\n")

# ── FD × HC3 ----------------------------------------------------------------
hc3_mat <- vcovHC(fd_lm, type = "HC3")
benchmarks[["fd_hc3"]] <- list(
  coef = unname(coef(fd_lm)[c("dx1","dx2")]),
  se   = unname(sqrt(diag(hc3_mat))[c("dx1","dx2")]),
  n    = nobs(fd_lm)
)
cat("FD HC3:", round(sqrt(diag(hc3_mat))[c("dx1","dx2")], 6), "\n")

# ── FD × Driscoll-Kraay HAC -------------------------------------------------
fd_pdata <- pdata.frame(fd_data, index = c("id","t"))
fd_plm   <- plm(dy ~ dx1 + dx2, data = fd_pdata, model = "pooling")
dk_fd    <- vcovSCC(fd_plm)
benchmarks[["fd_hac"]] <- list(
  coef = unname(coef(fd_plm)),
  se   = unname(sqrt(diag(dk_fd))),
  n    = nobs(fd_plm),
  note = "FD DK-HAC via plm::vcovSCC; tolerance 1e-3 on SE"
)
cat("FD DK-HAC:", round(sqrt(diag(dk_fd)), 6), "\n")

# ── TWFE × cluster-by-entity ------------------------------------------------
twfe_cl <- feols(y ~ x1 + x2 | id + t, data = panel, cluster = "id")
benchmarks[["twfe_cluster"]] <- list(
  coef = unname(coef(twfe_cl)),
  se   = unname(se(twfe_cl)),
  n    = nobs(twfe_cl),
  df   = degrees_freedom(twfe_cl, type = "resid")
)
cat("TWFE cluster:", round(coef(twfe_cl), 6), "\n")

# ── TWFE × HC2 (CR2 via clubSandwich on LSDV) --------------------------------
twfe_lm  <- lm(y ~ x1 + x2 + factor(id) + factor(t), data = panel)
cr2_twfe <- vcovCR(twfe_lm, cluster = panel$id, type = "CR2")
benchmarks[["twfe_hc2"]] <- list(
  coef = unname(coef(twfe_lm)[c("x1","x2")]),
  se   = unname(sqrt(diag(cr2_twfe))[c("x1","x2")]),
  n    = nobs(twfe_lm),
  note = "CR2 from clubSandwich on TWFE LSDV; tolerance 1e-3 on SE"
)
cat("TWFE HC2 (CR2):", round(sqrt(diag(cr2_twfe))[c("x1","x2")], 6), "\n")

# ── TWFE × HC3 (CR3 via clubSandwich) ----------------------------------------
cr3_twfe <- vcovCR(twfe_lm, cluster = panel$id, type = "CR3")
benchmarks[["twfe_hc3"]] <- list(
  coef = unname(coef(twfe_lm)[c("x1","x2")]),
  se   = unname(sqrt(diag(cr3_twfe))[c("x1","x2")]),
  n    = nobs(twfe_lm),
  note = "CR3 from clubSandwich; tolerance 1e-3 on SE"
)
cat("TWFE HC3 (CR3):", round(sqrt(diag(cr3_twfe))[c("x1","x2")], 6), "\n")

# ── TWFE × Driscoll-Kraay HAC -----------------------------------------------
twfe_pdata <- pdata.frame(panel, index = c("id","t"))
twfe_plm   <- plm(y ~ x1 + x2, data = twfe_pdata, model = "within", effect = "twoways")
dk_twfe    <- vcovSCC(twfe_plm)
benchmarks[["twfe_hac"]] <- list(
  coef = unname(coef(twfe_plm)),
  se   = unname(sqrt(diag(dk_twfe))),
  n    = nobs(twfe_plm),
  note = "TWFE DK-HAC via plm::vcovSCC; tolerance 1e-3 on SE"
)
cat("TWFE DK-HAC:", round(sqrt(diag(dk_twfe)), 6), "\n")

# ── Write benchmarks --------------------------------------------------------
write_json(benchmarks, "fase4bBenchmarks.json", auto_unbox = TRUE, pretty = TRUE)
cat("\nWrote fase4bBenchmarks.json with", length(benchmarks), "cells.\n")
cat("Run window.__validation.fase4b() in the browser to compare.\n")
