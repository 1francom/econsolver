# fase2RValidation.R — golden values for Fase 2 numerical validation.
# Generates clustered (firm), two-way clustered (firm × year), and Newey-West
# HAC standard errors for a known OLS spec, plus White and Breusch-Godfrey
# test statistics.

set.seed(42)
G <- 200
T <- 50
n <- G * T

firm  <- rep(1:G, each = T)
year  <- rep(1:T, times = G)
x1    <- rnorm(n)
x2    <- rnorm(n)
fe_f  <- rnorm(G)[firm]
# AR(1) within firm; heteroskedastic on x1
rho   <- 0.4
e <- numeric(n)
for (g in 1:G) {
  idx <- which(firm == g)
  innov <- rnorm(T) * (1 + abs(x1[idx]))
  e[idx[1]] <- innov[1]
  for (t in 2:T) e[idx[t]] <- rho * e[idx[t - 1]] + innov[t]
}
y <- 1 + 2 * x1 - 0.5 * x2 + fe_f + e

df <- data.frame(y = y, x1 = x1, x2 = x2, firm = firm, year = year, check.names = FALSE)
df[["__ri"]] <- seq_len(n)
write.csv(df, "fase2_data.csv", row.names = FALSE)

library(sandwich)
library(lmtest)
fit <- lm(y ~ x1 + x2, data = df)

# Clustered
v_cluster1 <- vcovCL(fit, cluster = ~ firm, type = "HC1")
# Two-way Cameron-Gelbach-Miller
v_twoway   <- vcovCL(fit, cluster = ~ firm + year, type = "HC1", multi0 = FALSE)
# Newey-West HAC (lag auto = floor(4*(n/100)^(2/9)))
L_auto     <- floor(4 * (nrow(df) / 100)^(2 / 9))
v_hac      <- NeweyWest(fit, lag = L_auto, prewhite = FALSE, adjust = TRUE)

# White test (no-cross is default in lmtest::bptest; for true White use studentize=FALSE
# and the squared-term aux regression by hand)
e_hat <- residuals(fit)
X <- model.matrix(fit)[, -1]  # drop intercept
aux_cols <- cbind(X, X^2, X[, 1] * X[, 2])
aux_df <- data.frame(e2 = e_hat^2, aux_cols)
fit_white <- lm(e2 ~ ., data = aux_df)
n_w   <- length(e_hat)
r2_w  <- summary(fit_white)$r.squared
white_stat <- n_w * r2_w
white_df   <- ncol(aux_cols)

# Breusch-Godfrey lag 1
bg <- bgtest(fit, order = 1)
bg_stat <- unname(bg$statistic)
bg_df   <- 1

result <- list(
  beta           = as.numeric(coef(fit)),
  varNames       = names(coef(fit)),
  se_clustered   = as.numeric(sqrt(diag(v_cluster1))),
  se_twoway      = as.numeric(sqrt(diag(v_twoway))),
  se_hac         = as.numeric(sqrt(diag(v_hac))),
  L_hac          = L_auto,
  white_stat     = white_stat,
  white_df       = white_df,
  bg_stat        = bg_stat,
  bg_df          = bg_df
)
jsonlite::write_json(result, "fase2Benchmarks.json", auto_unbox = TRUE, digits = 8)
cat("Wrote fase2_data.csv and fase2Benchmarks.json\n")
summary(result)
