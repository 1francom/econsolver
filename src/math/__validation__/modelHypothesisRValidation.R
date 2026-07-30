# ─── ECON STUDIO · modelHypothesisRValidation.R ─────────────────────────────
# Generates modelHypothesisBenchmarks.json for the joint (linear) hypothesis
# test in src/math/ModelHypothesis.js.
#
# Reference: car::linearHypothesis(), both `test = "Chisq"` and `test = "F"` —
# the two variants the panel now exposes. The coefficient vector and the full
# vcov are exported alongside so the JS harness feeds waldTest() EXACTLY the
# inputs R tested, making any difference attributable to the test itself and
# not to a different fit.
#
# Run:
#   "/c/Program Files/R/R-4.4.1/bin/Rscript.exe" src/math/__validation__/modelHypothesisRValidation.R

suppressPackageStartupMessages({
  library(car)
  library(jsonlite)
})

set.seed(20260730)

mk_case <- function(name, fit, hyp, terms, h0s) {
  chi <- car::linearHypothesis(fit, hyp, test = "Chisq")
  f   <- car::linearHypothesis(fit, hyp, test = "F")
  V   <- vcov(fit)
  list(
    name     = name,
    varNames = names(coef(fit)),
    beta     = unname(coef(fit)),
    vcov     = lapply(seq_len(nrow(V)), function(i) unname(V[i, ])),
    resDf    = unname(df.residual(fit)),
    terms    = terms,
    h0s      = h0s,
    q        = unname(chi$Df[2]),
    chiSq    = unname(chi$Chisq[2]),
    chiSqP   = unname(chi$`Pr(>Chisq)`[2]),
    F        = unname(f$F[2]),
    fP       = unname(f$`Pr(>F)`[2])
  )
}

cases <- list()

# ── C1: plain OLS, two zero restrictions ───────────────────────────────────
n  <- 400
x1 <- rnorm(n); x2 <- rnorm(n); x3 <- rnorm(n)
y  <- 1 + 0.5 * x1 + 0.0 * x2 + 0.2 * x3 + rnorm(n)
d1 <- data.frame(y, x1, x2, x3)
fit1 <- lm(y ~ x1 + x2 + x3, data = d1)
cases[[1]] <- mk_case("ols_two_zero", fit1, c("x2 = 0", "x3 = 0"), c("x2", "x3"), c(0, 0))

# ── C2: NON-ZERO nulls — catches an h0s vector that is ignored ─────────────
cases[[2]] <- mk_case("ols_nonzero_nulls", fit1, c("x1 = 0.5", "x3 = 0.1"), c("x1", "x3"), c(0.5, 0.1))

# ── C3: single restriction — F must equal the squared t ───────────────────
cases[[3]] <- mk_case("ols_single", fit1, c("x1 = 0"), c("x1"), c(0))

# ── C4: intercept included, three restrictions ────────────────────────────
cases[[4]] <- mk_case("ols_with_intercept", fit1,
                      c("(Intercept) = 1", "x1 = 0.5", "x2 = 0"),
                      c("(Intercept)", "x1", "x2"), c(1, 0.5, 0))

# ── C5: large n / large residual df — where chi2 and F diverge least, and
#        where a bad incomplete-beta implementation collapses ──────────────
n2 <- 60000
z1 <- rnorm(n2); z2 <- rnorm(n2)
y2 <- 0.02 * z1 + 0.001 * z2 + rnorm(n2)
d2 <- data.frame(y = y2, z1, z2)
fit2 <- lm(y ~ z1 + z2, data = d2)
cases[[5]] <- mk_case("ols_large_n", fit2, c("z1 = 0", "z2 = 0"), c("z1", "z2"), c(0, 0))

# ── C6: a hypothesis that is NOT rejected — p near 1 is exactly where the
#        old incomplete beta failed, so a case with a tiny statistic matters ─
cases[[6]] <- mk_case("ols_not_rejected", fit2, c("z2 = 0"), c("z2"), c(0))

out <- list(
  meta = list(
    source    = "car::linearHypothesis",
    rVersion  = paste(R.version$major, R.version$minor, sep = "."),
    carVersion = as.character(packageVersion("car")),
    generated = format(Sys.time(), "%Y-%m-%d")
  ),
  cases = cases
)

write_json(out, "src/math/__validation__/modelHypothesisBenchmarks.json",
           auto_unbox = TRUE, digits = 15, pretty = TRUE)
cat("wrote", length(cases), "cases\n")
