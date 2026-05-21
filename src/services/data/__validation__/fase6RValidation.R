# fase6RValidation.R - generates fase6_data.csv and fase6Benchmarks.json
# Run from project root:
#   Rscript src/services/data/__validation__/fase6RValidation.R
#
# Fase 6 covers DuckDB IRLS SQL loops for Logit, Probit, and Poisson FE.
# This script stays in base R so it runs on the local validation runtime even
# when optional sandwich/jsonlite packages are not installed.

set.seed(20260521)

out_dir <- "src/services/data/__validation__"
n <- 12000
id_count <- 12

x1 <- rnorm(n)
x2 <- rnorm(n)
id <- rep(seq_len(id_count), length.out = n)
alpha <- seq(-0.55, 0.55, length.out = id_count)

p_logit <- plogis(0.45 + 0.9 * x1 - 0.4 * x2)
y_logit <- rbinom(n, 1, p_logit)

p_probit <- pnorm(0.25 + 0.7 * x1 - 0.35 * x2)
y_probit <- rbinom(n, 1, p_probit)

mu_fe <- exp(0.15 + 0.45 * x1 - 0.3 * x2 + alpha[id])
y_pois_fe <- rpois(n, mu_fe)

df <- data.frame(y_logit, y_probit, y_pois_fe, x1, x2, id)
write.csv(df, file.path(out_dir, "fase6_data.csv"), row.names = FALSE)

hc1_se <- function(fit) {
  X <- model.matrix(fit)
  raw_resid <- fit$y - fit$fitted.values
  bread <- vcov(fit)
  meat <- crossprod(X, X * as.numeric(raw_resid * raw_resid))
  scale <- nrow(X) / max(1, nrow(X) - ncol(X))
  sqrt(pmax(0, diag(bread %*% (meat * scale) %*% bread)))
}

fit_logit <- glm(y_logit ~ x1 + x2, data = df, family = binomial("logit"))
fit_probit <- glm(y_probit ~ x1 + x2, data = df, family = binomial("probit"))
fit_fe <- glm(y_pois_fe ~ x1 + x2 + factor(id), data = df, family = poisson())

fmt_num <- function(x) {
  ifelse(is.na(x), "null", formatC(as.numeric(x), digits = 12, format = "fg", flag = "#"))
}

json_array <- function(x) {
  paste0("[", paste(fmt_num(x), collapse = ","), "]")
}

json_fit <- function(fit) {
  paste0(
    "{",
    "\"beta\":", json_array(coef(fit)), ",",
    "\"se_classical\":", json_array(sqrt(diag(vcov(fit)))), ",",
    "\"se_HC1\":", json_array(hc1_se(fit)), ",",
    "\"logLik\":", fmt_num(as.numeric(logLik(fit))),
    "}"
  )
}

bench_json <- paste0(
  "{",
  "\"Logit\":", json_fit(fit_logit), ",",
  "\"Probit\":", json_fit(fit_probit), ",",
  "\"PoissonFE\":", json_fit(fit_fe),
  "}"
)
writeLines(bench_json, file.path(out_dir, "fase6Benchmarks.json"), useBytes = TRUE)
cat("Wrote", file.path(out_dir, "fase6_data.csv"), "and", file.path(out_dir, "fase6Benchmarks.json"), "\n")
