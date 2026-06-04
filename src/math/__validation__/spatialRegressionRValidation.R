# Generate spatialRegressionBenchmarks.json from R spatialreg.
# Requires: install.packages(c("spdep", "spatialreg", "jsonlite"))

library(spdep)
library(spatialreg)
library(jsonlite)

y <- c(1.2, 1.8, 2.7, 3.4, 4.8, 5.6, 6.1, 7.4)
x <- c(0.2, 1.1, 1.7, 3.2, 4.4, 4.9, 6.5, 7.2)
z <- c(1, 0, 1, 1, 0, 1, 0, 0)
df <- data.frame(y = y, x = x, z = z)

n <- length(y)
nb <- vector("list", n)
for (i in seq_len(n)) {
  neigh <- integer()
  if (i > 1) neigh <- c(neigh, i - 1)
  if (i < n) neigh <- c(neigh, i + 1)
  nb[[i]] <- neigh
}
class(nb) <- "nb"
attr(nb, "region.id") <- as.character(seq_len(n))
attr(nb, "type") <- "rook-line-fixture"
attr(nb, "sym") <- TRUE
lw <- nb2listw(nb, style = "W", zero.policy = TRUE)

slx <- lmSLX(y ~ x + z, data = df, listw = lw, zero.policy = TRUE)
sar <- lagsarlm(y ~ x + z, data = df, listw = lw, method = "eigen", zero.policy = TRUE)
sem <- errorsarlm(y ~ x + z, data = df, listw = lw, method = "eigen", zero.policy = TRUE)
sdm <- lagsarlm(y ~ x + z, data = df, listw = lw, type = "mixed", method = "eigen", zero.policy = TRUE)

se_vec <- function(obj) sqrt(diag(vcov(obj)))
coef_vec <- function(obj) as.numeric(coef(obj))

weights <- list()
for (i in seq_len(n)) {
  neigh <- nb[[i]]
  if (!length(neigh)) next
  w <- rep(1 / length(neigh), length(neigh))
  for (k in seq_along(neigh)) weights[[length(weights) + 1]] <- list(i = i - 1, j = neigh[k] - 1, w = w[k])
}

out <- list(
  fixture = list(y = y, x = x, z = z, weights = weights),
  models = list(
    SLX = list(beta = coef_vec(slx), se = se_vec(slx), R2 = summary(slx)$r.squared),
    SAR = list(beta = c(sar$rho, coef_vec(sar)), se = c(sar$rho.se, se_vec(sar)), rho = sar$rho,
               logLik = as.numeric(logLik(sar)), AIC = AIC(sar), BIC = BIC(sar)),
    SEM = list(beta = c(sem$lambda, coef_vec(sem)), se = c(sem$lambda.se, se_vec(sem)), lambda = sem$lambda,
               logLik = as.numeric(logLik(sem)), AIC = AIC(sem), BIC = BIC(sem)),
    SDM = list(beta = c(sdm$rho, coef_vec(sdm)), se = c(sdm$rho.se, se_vec(sdm)), rho = sdm$rho,
               logLik = as.numeric(logLik(sdm)), AIC = AIC(sdm), BIC = BIC(sdm))
  )
)

write_json(out, "spatialRegressionBenchmarks.json", auto_unbox = TRUE, digits = 16, pretty = TRUE)
