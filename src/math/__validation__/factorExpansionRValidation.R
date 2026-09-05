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

# --- Through-the-origin factor coding (2026-09-05 fix) --------------------
# With no intercept, model.matrix codes the FIRST factor in formula order with
# EVERY level and only then falls back to contrasts. Litux used to drop a
# reference from both, which pins the omitted baseline cell to zero and is a
# strictly different model. Expected names below: year gets 9/10/11, grader
# only B/C.
m3 <- lm(y ~ 0 + x1 + factor(year) + factor(grader), data = df)
s3 <- summary(m3)
coefs3 <- coef(s3)
noIntercept <- list(
  coefficients = setNames(as.list(coefs3[, "Estimate"]), rownames(coefs3)),
  se = setNames(as.list(coefs3[, "Std. Error"]), rownames(coefs3)),
  names = rownames(coefs3),
  dfResidual = df.residual(m3),
  nParams = length(coef(m3))
)

library(jsonlite)
out$customRef <- customRef
out$noIntercept <- noIntercept
writeLines(toJSON(out, auto_unbox = TRUE, pretty = TRUE, digits = 10),
           "src/math/__validation__/factorExpansionBenchmarks.json")
cat("Wrote factorExpansionBenchmarks.json\n")
cat("n =", out$n, " nDroppedNA =", out$nDroppedNA, "\n")
print(coefs)
cat("\n-- custom reference (year ref=10) --\n")
print(coefs2)
cat("\n-- through the origin (0 + ...) --\n")
print(coefs3)
cat("params:", length(coef(m3)), " df.residual:", df.residual(m3), "\n")
