# ─── EconSolver · Panel FE Validation vs fixest::feols() ──────────────────────
#
# Dataset: makePanelData() from engineValidation.js — translated verbatim.
# JS formula:
#   x    = time^2 * (0.5 + unit*0.1) + cos(unit)
#   z    = sin(time*1.1 + unit*0.7) * 2
#   y    = alpha[unit] + 1.5*x + 0.8*z + noise[unit][time]
#   alphas = [1, -1, 2, 0, -2]
#
# Embedded values produced by running the JS data factory at full float64 precision.
# These are the exact numbers EconSolver passes to runFE().
#
# EconSolver runFE() implementation notes:
#   - Within-transformation adds grand means back (for intercept preservation in OLS)
#   - Returns beta.slice(1) / se.slice(1)  — intercept excluded from output
#   - df_fe = n - n_units - k = 20 - 5 - 2 = 13
#   - SE type: classical (default seOpts = {})
#   - sigma^2 = SSR / df_fe
#
# R comparison: feols(y ~ x + z | unit, se = "iid") from fixest.
# "iid" SE in fixest uses df = n - n_units - k (matches EconSolver df_fe).
#
# Tolerance targets (from CLAUDE.md):
#   Coefficients: 6 decimal places  (TOL = 1e-6)
#   Standard errors: 4 decimal places (TOL = 1e-4)
# ────────────────────────────────────────────────────────────────────────────────

library(fixest)

# ── Exact data from makePanelData() (JS float64, 15 significant digits) ─────────
y    <- c(4.454609668207322, 5.661252385544580, 9.152569466309522, 14.419149967077837,
          0.474335175745617, 2.268747035907522, 6.008902533076725, 14.934416258117274,
          1.226612625615205, 4.027145756300204, 10.371588075009752, 19.950203236039837,
         -0.510891285989776, 2.409255729243561, 11.016074561869228, 22.240403150863227,
         -1.807412327618704, 3.831396410038620, 12.315074640016613, 24.236799425138472)

x    <- c(1.140302305868140, 2.940302305868140, 5.940302305868139, 10.140302305868140,
          0.283853163452858, 2.383853163452857, 5.883853163452858, 10.783853163452857,
         -0.189992496600445, 2.210007503399555, 6.210007503399555, 11.810007503399556,
          0.246356379136388, 2.946356379136388, 7.446356379136388, 13.746356379136389,
          1.283662185463226, 4.283662185463227, 9.283662185463227, 16.283662185463225)

z    <- c(1.947695261756390, 0.478498658427964, -1.513604990615856, -1.851629364655464,
          1.196944288207913, -0.885040886589705, -1.999846515128202, -0.929204358827513,
         -0.116748286855159, -1.832331873498910, -1.545528975111974,  0.430239976175631,
         -1.375532318367948, -1.917848549326277, -0.364325008544192,  1.587335727698306,
         -1.987382007266929, -1.101371085195275,  0.988226702277218,  1.997882683679544)

unit <- c(1, 1, 1, 1, 2, 2, 2, 2, 3, 3, 3, 3, 4, 4, 4, 4, 5, 5, 5, 5)
time <- c(1, 2, 3, 4, 1, 2, 3, 4, 1, 2, 3, 4, 1, 2, 3, 4, 1, 2, 3, 4)

df <- data.frame(y = y, x = x, z = z, unit = factor(unit), time = time)

# ── Fit FE model (one-way unit FE, iid SE) ────────────────────────────────────
fit <- feols(y ~ x + z | unit, data = df, se = "iid")

cat("=== fixest::feols(y ~ x + z | unit, se='iid') ===\n\n")

coefs <- coef(fit)
ses   <- se(fit)

cat(sprintf("coef[x]:  %.6f\n", coefs["x"]))
cat(sprintf("coef[z]:  %.6f\n", coefs["z"]))
cat(sprintf("se[x]:    %.4f\n",  ses["x"]))
cat(sprintf("se[z]:    %.4f\n",  ses["z"]))

cat("\n")

# t-statistics and p-values for reference
tvals <- coefs / ses
# df = n - n_units - k = 20 - 5 - 2 = 13
df_fe <- nobs(fit) - fit$nparams - length(unique(unit))
cat(sprintf("df_fe (n - units - k):  %d\n", df_fe))
cat(sprintf("t[x]:  %.6f\n", tvals["x"]))
cat(sprintf("t[z]:  %.6f\n", tvals["z"]))

# sigma^2
ssr <- sum(residuals(fit)^2)
s2  <- ssr / df_fe
cat(sprintf("\nSSR:    %.8f\n", ssr))
cat(sprintf("sigma2: %.8f\n", s2))

# R-squared within
cat(sprintf("R2 within: %.6f\n", r2(fit, type = "ar2")["ar2"]))

cat("\n=== COPY THESE LINES INTO validateFE() ===\n")
cat(sprintf('  c("FE vs R: beta[x]",  r.beta[0],  %.6f,  TOL_COEF);\n', coefs["x"]))
cat(sprintf('  c("FE vs R: beta[z]",  r.beta[1],  %.6f,  TOL_COEF);\n', coefs["z"]))
cat(sprintf('  c("FE vs R: SE[x]",    r.se[0],    %.4f,   TOL_SE);\n',   ses["x"]))
cat(sprintf('  c("FE vs R: SE[z]",    r.se[1],    %.4f,   TOL_SE);\n',   ses["z"]))
