# ─── EconSolver · Logit/Probit validation vs R glm() ────────────────────────
#
# Replicates makeLogitData() from engineValidation.js exactly:
#   n = 200
#   x1 = (i/n - 0.5) * 4          for i in 0..199  (uniform on [-2, 2])
#   x2 = sin(i * 0.314) * 1.5     for i in 0..199
#   lp = -1 + 2*x1 - 0.5*x2
#   p  = 1 / (1 + exp(-lp))
#   thresh = ((i * 7 + 13) %% 97) / 97
#   y  = as.integer(p > thresh)
#
# No random numbers — purely deterministic. No set.seed() needed.
#
# Reference:
#   glm(y ~ x1 + x2, family = binomial("logit"))
#   glm(y ~ x1 + x2, family = binomial("probit"))

n <- 200L
i_seq <- 0:(n - 1L)

x1     <- (i_seq / n - 0.5) * 4
x2     <- sin(i_seq * 0.314) * 1.5
lp     <- -1 + 2 * x1 - 0.5 * x2
p      <- 1 / (1 + exp(-lp))
thresh <- ((i_seq * 7L + 13L) %% 97L) / 97
y      <- as.integer(p > thresh)

cat(sprintf("n = %d\n", n))
cat(sprintf("sum(y) = %d  (ones)\n", sum(y)))
cat(sprintf("mean(y) = %.6f\n", mean(y)))

# ── Logit ────────────────────────────────────────────────────────────────────
fit_logit <- glm(y ~ x1 + x2, family = binomial("logit"))
cat("\n=== LOGIT ===\n")
cat(sprintf("coef[(Intercept)]: %.6f\n", coef(fit_logit)[1]))
cat(sprintf("coef[x1]:          %.6f\n", coef(fit_logit)[2]))
cat(sprintf("coef[x2]:          %.6f\n", coef(fit_logit)[3]))
se_logit <- sqrt(diag(vcov(fit_logit)))
cat(sprintf("se[(Intercept)]:   %.4f\n", se_logit[1]))
cat(sprintf("se[x1]:            %.4f\n", se_logit[2]))
cat(sprintf("se[x2]:            %.4f\n", se_logit[3]))
cat(sprintf("logLik:            %.6f\n", as.numeric(logLik(fit_logit))))
cat(sprintf("AIC:               %.6f\n", AIC(fit_logit)))
cat(sprintf("BIC:               %.6f\n", BIC(fit_logit)))
# McFadden R2 = 1 - logLik(full)/logLik(null)
ll_full  <- as.numeric(logLik(fit_logit))
ll_null  <- as.numeric(logLik(glm(y ~ 1, family = binomial("logit"))))
cat(sprintf("logLik(null):      %.6f\n", ll_null))
cat(sprintf("McFadden R2:       %.6f\n", 1 - ll_full / ll_null))

# ── Probit ───────────────────────────────────────────────────────────────────
fit_probit <- glm(y ~ x1 + x2, family = binomial("probit"))
cat("\n=== PROBIT ===\n")
cat(sprintf("coef[(Intercept)]: %.6f\n", coef(fit_probit)[1]))
cat(sprintf("coef[x1]:          %.6f\n", coef(fit_probit)[2]))
cat(sprintf("coef[x2]:          %.6f\n", coef(fit_probit)[3]))
se_probit <- sqrt(diag(vcov(fit_probit)))
cat(sprintf("se[(Intercept)]:   %.4f\n", se_probit[1]))
cat(sprintf("se[x1]:            %.4f\n", se_probit[2]))
cat(sprintf("se[x2]:            %.4f\n", se_probit[3]))
cat(sprintf("logLik:            %.6f\n", as.numeric(logLik(fit_probit))))
cat(sprintf("AIC:               %.6f\n", AIC(fit_probit)))
cat(sprintf("BIC:               %.6f\n", BIC(fit_probit)))
ll_full_p <- as.numeric(logLik(fit_probit))
ll_null_p <- as.numeric(logLik(glm(y ~ 1, family = binomial("probit"))))
cat(sprintf("logLik(null):      %.6f\n", ll_null_p))
cat(sprintf("McFadden R2:       %.6f\n", 1 - ll_full_p / ll_null_p))

cat("\n=== FULL SUMMARY (Logit) ===\n")
print(summary(fit_logit))
cat("\n=== FULL SUMMARY (Probit) ===\n")
print(summary(fit_probit))
