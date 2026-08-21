# Generates factorExpansionBenchmarks.json from factorExpansionFixture.csv.
# Run: "/c/Program Files/R/R-4.4.1/bin/Rscript.exe" src/math/__validation__/factorExpansionRValidation.R
#
# Validates the applyFactors() fix in components/modeling/helpers.js:
#   - numeric factor levels (year: 9/10/11) must sort numerically, not lexicographically
#   - NA in a factor (grader) must trigger listwise deletion, matching lm()'s default na.action

df <- read.csv("src/math/__validation__/factorExpansionFixture.csv", stringsAsFactors = FALSE)
df$grader[df$grader == ""] <- NA

m <- lm(y ~ x1 + factor(year) + factor(grader), data = df)
s <- summary(m)

coefs <- coef(s)
out <- list(
  meta = list(source = "R 4.4.1 lm()", fixture = "factorExpansionFixture.csv"),
  n = nrow(model.frame(m)),
  nDroppedNA = nrow(df) - nrow(model.frame(m)),
  coefficients = setNames(as.list(coefs[, "Estimate"]), rownames(coefs)),
  se = setNames(as.list(coefs[, "Std. Error"]), rownames(coefs)),
  rSquared = s$r.squared,
  adjRSquared = s$adj.r.squared,
  fStat = unname(s$fstatistic["value"]),
  df1 = unname(s$fstatistic["numdf"]),
  df2 = unname(s$fstatistic["dendf"])
)

# ── Custom reference category (2026-08-16 feature) ──────────────────────────
# Same fixture, but year's reference is set to 10 instead of the default
# (numerically-first) 9 — exercises relevel(), which is what rScript.js now
# emits for a user-chosen reference. Coefficients on x1 and factor(grader)
# must be UNCHANGED from the default-reference model (reference choice is a
# reparameterization, not a different model); only the year dummies + the
# intercept shift.
m2 <- lm(y ~ x1 + relevel(factor(year), ref = "10") + factor(grader), data = df)
s2 <- summary(m2)
coefs2 <- coef(s2)
customRef <- list(
  coefficients = setNames(as.list(coefs2[, "Estimate"]), rownames(coefs2)),
  se = setNames(as.list(coefs2[, "Std. Error"]), rownames(coefs2))
)

library(jsonlite)
out$customRef <- customRef
writeLines(toJSON(out, auto_unbox = TRUE, pretty = TRUE, digits = 10),
           "src/math/__validation__/factorExpansionBenchmarks.json")
cat("Wrote factorExpansionBenchmarks.json\n")
cat("n =", out$n, " nDroppedNA =", out$nDroppedNA, "\n")
print(coefs)
cat("\n-- custom reference (year ref=10) --\n")
print(coefs2)
