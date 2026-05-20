# fase1RValidation.R — golden values for Fase 1 numerical validation.
# Generates β, classical SE, and HC0-3 SEs from sandwich::vcovHC, plus a
# heteroskedastic + factor dataset for the browser side to import into DuckDB.

set.seed(42)
n <- 50000
x1 <- rnorm(n)
x2 <- rnorm(n)
country <- sample(c("DE", "FR", "IT", "ES"), n, replace = TRUE)
e <- rnorm(n) * (1 + abs(x1))  # heteroskedastic
y <- 1 + 2*x1 - 0.5*x2 + (country == "FR") * 0.7 + (country == "IT") * -0.3 + e

df <- data.frame(y = y, x1 = x1, x2 = x2, country = country)
write.csv(df, "fase1_data.csv", row.names = FALSE)

library(sandwich)
library(lmtest)
fit <- lm(y ~ x1 + x2 + country, data = df)

result <- list(
  beta         = as.numeric(coef(fit)),
  varNames     = names(coef(fit)),
  se_classical = as.numeric(sqrt(diag(vcov(fit)))),
  se_HC0       = as.numeric(sqrt(diag(vcovHC(fit, type = "HC0")))),
  se_HC1       = as.numeric(sqrt(diag(vcovHC(fit, type = "HC1")))),
  se_HC2       = as.numeric(sqrt(diag(vcovHC(fit, type = "HC2")))),
  se_HC3       = as.numeric(sqrt(diag(vcovHC(fit, type = "HC3")))),
  bp           = unname(bptest(fit)$statistic),
  dw           = unname(dwtest(fit)$statistic),
  jb           = {
    r  <- residuals(fit)
    nn <- length(r)
    m2 <- mean(r^2); m3 <- mean(r^3); m4 <- mean(r^4)
    sk <- m3 / m2^1.5
    kt <- m4 / m2^2
    unname(nn / 6 * (sk^2 + (kt - 3)^2 / 4))
  }
)

jsonlite::write_json(result, "fase1Benchmarks.json", auto_unbox = TRUE, digits = 8)
cat("Wrote fase1_data.csv and fase1Benchmarks.json\n")
