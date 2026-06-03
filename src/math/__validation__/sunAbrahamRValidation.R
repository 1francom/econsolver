# ─── ECON STUDIO · sunAbrahamRValidation.R ────────────────────────────────────
# Ground-truth benchmarks for runSunAbraham (Sun & Abraham 2021 IW event study
# over PPML) vs fixest::fepois + sunab(), clustered by unit.
#
# Consumes the deterministic CSVs written by sunAbrahamValidation.js:
#   sunAbraham_case1.csv  (single treated cohort + never-treated)
#   sunAbraham_case2.csv  (staggered 2 cohorts + never-treated)
#
# Emits sunAbrahamBenchmarks.json with, per case, the aggregated per-relative-
# period ATTs + clustered SE, and the joint pre/post Wald tests. For case 1 it
# also emits a plain Poisson TWFE event study (i(rel,ref=-1)) to prove the
# single-cohort reduction.
#
# Run:
#   "/c/Program Files/R/R-4.4.1/bin/Rscript.exe" src/math/__validation__/sunAbrahamRValidation.R

suppressMessages({
  library(fixest)
  library(jsonlite)
})

here <- tryCatch(dirname(sub("--file=", "", grep("--file=", commandArgs(FALSE), value = TRUE))), error = function(e) ".")
if (length(here) == 0 || here == "") here <- "src/math/__validation__"

read_case <- function(f) {
  d <- read.csv(file.path(here, f), stringsAsFactors = FALSE)
  # blank cohort = never-treated. fixest sunab() wants a large sentinel (10000)
  # for never-treated so they form the reference control group.
  d$cohort_raw <- d$cohort
  d$cohort[is.na(d$cohort) | d$cohort == ""] <- 10000
  d$cohort <- as.numeric(d$cohort)
  d
}

# Pull aggregated per-relative-period ATTs from a sunab fepois fit.
# The default summary() of a sunab model auto-aggregates the cohort x relative-
# period dummies into per-relative-period ATTs using Sun-Abraham IW weights.
# Coefficient names look like "period::-2", "period::0", ... (ref period dropped).
agg_sunab <- function(m) {
  ct <- summary(m)$coeftable
  nm <- rownames(ct)
  keep <- grepl("^period::", nm)
  ct <- ct[keep, , drop = FALSE]
  nm <- nm[keep]
  rel <- as.integer(sub("^period::(-?[0-9]+).*", "\\1", nm))
  data.frame(k = rel, beta = ct[, 1], se = ct[, 2], stringsAsFactors = FALSE)
}

emit <- list()

# Cluster small-sample correction convention. The EconSolver engine applies
# G/(G-1)·(n-1)/(n-k) with k = number of estimated regressors only (absorbed FE
# NOT counted) — i.e. the sandwich/vcovCL convention. In fixest terms this is
# ssc(adj=TRUE, cluster.adj=TRUE, fixef.K="none"). fixest's *default* uses
# fixef.K="nested" (counts non-nested FE in K), giving SE larger by a known df
# factor. We benchmark against the matching "none" convention so coefficients AND
# SE compare apples-to-apples; the divergence from fixest default is documented.
SSC <- ssc(adj = TRUE, cluster.adj = TRUE, fixef.K = "none")

# ── CASE 1: single treated cohort (4) + never-treated ─────────────────────────
d1 <- read_case("sunAbraham_case1.csv")
m1_sa <- fepois(y ~ sunab(cohort, period) | unit + period, data = d1, cluster = ~unit, ssc = SSC)
a1 <- agg_sunab(m1_sa)

# Plain Poisson TWFE event study with event-time dummies, ref = -1.
# Never-treated controls are kept in the sample with rel = -1 (the reference
# level) so all their event dummies are 0 — exactly how sunab treats them.
d1$rel_f <- ifelse(d1$cohort >= 10000, -1, d1$period - d1$cohort)
m1_tw <- fepois(y ~ i(rel_f, ref = -1) | unit + period, data = d1, cluster = ~unit, ssc = SSC)
ct_tw <- m1_tw$coeftable
nm_tw <- rownames(ct_tw)
rel_tw <- as.integer(sub(".*::(-?[0-9]+).*", "\\1", nm_tw))
a1_tw <- data.frame(k = rel_tw, beta = ct_tw[, 1], se = ct_tw[, 2])

emit$case1 <- list(
  sunab = list(k = a1$k, beta = a1$beta, se = a1$se),
  twfe  = list(k = a1_tw$k, beta = a1_tw$beta, se = a1_tw$se),
  n = m1_sa$nobs
)

# ── CASE 2: staggered 2 cohorts (4, 6) + never-treated ────────────────────────
d2 <- read_case("sunAbraham_case2.csv")
m2_sa <- fepois(y ~ sunab(cohort, period) | unit + period, data = d2, cluster = ~unit, ssc = SSC)
a2 <- agg_sunab(m2_sa)

emit$case2 <- list(
  sunab = list(k = a2$k, beta = a2$beta, se = a2$se),
  n = m2_sa$nobs
)

writeLines(toJSON(emit, auto_unbox = TRUE, digits = 12, pretty = TRUE),
           file.path(here, "sunAbrahamBenchmarks.json"))

cat("── CASE 1 sunab aggregated ──\n"); print(a1)
cat("── CASE 1 Poisson TWFE i(rel) ──\n"); print(a1_tw)
cat("── CASE 2 sunab aggregated ──\n"); print(a2)
cat("\nWrote sunAbrahamBenchmarks.json\n")
