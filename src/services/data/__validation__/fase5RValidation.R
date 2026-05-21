# Fase 5: R validation fixtures for DiD / TWFE DiD / Event Study.
# Generates fase5_data.csv + fase5Benchmarks.json in this directory.

set.seed(20260521)
G  <- 160
TT <- 20
n  <- G * TT

df <- expand.grid(id = 1:G, year = 1:TT)
df <- df[order(df$id, df$year), ]
df$treated_ever <- as.integer(df$id <= G / 2)
df$t_treat <- ifelse(df$treated_ever == 1, 10, NA)
df$post <- as.integer(df$year >= 10)
df$treat_post <- as.integer(df$treated_ever == 1 & df$post == 1)
df$x1 <- rnorm(n)

alpha_i  <- rnorm(G)[df$id]
lambda_t <- rnorm(TT)[df$year]
df$y <- alpha_i + lambda_t + 0.45 * df$treat_post + 0.2 * df$x1 +
        rnorm(n, sd = 0.55 + abs(df$x1) * 0.12)

event_window <- function(dat, k_pre = 3, k_post = 3) {
  rel <- ifelse(is.na(dat$t_treat), NA, dat$year - dat$t_treat)
  dat$es_m3 <- as.integer(!is.na(rel) & rel == -3)
  dat$es_m2 <- as.integer(!is.na(rel) & rel == -2)
  dat$es_p0 <- as.integer(!is.na(rel) & rel == 0)
  dat$es_p1 <- as.integer(!is.na(rel) & rel == 1)
  dat$es_p2 <- as.integer(!is.na(rel) & rel == 2)
  dat$es_p3 <- as.integer(!is.na(rel) & rel == 3)
  dat$es_pre_bin <- as.integer(!is.na(rel) & rel < -k_pre)
  dat$es_post_bin <- as.integer(!is.na(rel) & rel > k_post)
  dat
}

df <- event_window(df)
write.csv(df, "fase5_data.csv", row.names = FALSE)

hc1_ols <- function(X, resid) {
  n <- nrow(X)
  k <- ncol(X)
  bread <- solve(crossprod(X))
  meat <- crossprod(X, X * as.numeric(resid)^2)
  sqrt(diag((n / max(1, n - k)) * bread %*% meat %*% bread))
}

ols_bench <- function(dat, y_col, x_cols, df_resid_override = NULL) {
  X <- cbind("(Intercept)" = 1, as.matrix(dat[, x_cols, drop = FALSE]))
  y <- dat[[y_col]]
  beta <- solve(crossprod(X), crossprod(X, y))
  resid <- y - X %*% beta
  n <- nrow(X)
  k_reg <- length(x_cols)
  df_resid <- if (is.null(df_resid_override)) n - ncol(X) else df_resid_override
  s2 <- as.numeric(crossprod(resid)) / df_resid
  se_classical <- sqrt(diag(solve(crossprod(X)) * s2))
  list(
    beta = as.numeric(beta),
    se_classical = as.numeric(se_classical),
    se_HC1 = as.numeric(hc1_ols(X, resid)),
    df = df_resid,
    n = n,
    k_reg = k_reg
  )
}

double_demean <- function(dat, cols, id_col, time_col) {
  out <- dat
  for (col in cols) {
    grand <- mean(dat[[col]])
    unit_mean <- ave(dat[[col]], dat[[id_col]], FUN = mean)
    time_mean <- ave(dat[[col]], dat[[time_col]], FUN = mean)
    out[[col]] <- dat[[col]] - unit_mean - time_mean + grand
  }
  out
}

df_22 <- df[df$year %in% c(9, 10), ]
df_22$did_inter <- df_22$post * df_22$treated_ever
did_bench <- ols_bench(df_22, "y", c("post", "treated_ever", "did_inter", "x1"))

twfe_dm <- double_demean(df, c("y", "treat_post", "x1"), "id", "year")
twfe_df <- nrow(df) - length(unique(df$id)) - length(unique(df$year)) + 1 - 2
twfe_bench <- ols_bench(twfe_dm, "y", c("treat_post", "x1"), twfe_df)

event_terms <- c("es_m3", "es_m2", "es_p0", "es_p1", "es_p2", "es_p3",
                 "es_pre_bin", "es_post_bin", "x1")
event_dm <- double_demean(df, c("y", event_terms), "id", "year")
event_df <- nrow(df) - length(unique(df$id)) - length(unique(df$year)) + 1 - length(event_terms)
event_bench <- ols_bench(event_dm, "y", event_terms, event_df)

bench <- list(
  DiD2x2 = list(
    beta = did_bench$beta,
    se_classical = did_bench$se_classical,
    se_HC1 = did_bench$se_HC1
  ),
  TWFEDiD = list(
    beta = twfe_bench$beta[-1],
    se_classical = twfe_bench$se_classical[-1],
    se_HC1 = twfe_bench$se_HC1[-1]
  ),
  EventStudy = list(
    beta = event_bench$beta[-1],
    se_classical = event_bench$se_classical[-1],
    se_HC1 = event_bench$se_HC1[-1],
    event_terms = event_terms
  )
)

num_json <- function(values) {
  paste0("[", paste(format(values, digits = 12, scientific = FALSE, trim = TRUE), collapse = ", "), "]")
}

str_json <- function(values) {
  paste0("[", paste(paste0('"', values, '"'), collapse = ", "), "]")
}

json_lines <- c(
  "{",
  '  "DiD2x2": {',
  paste0('    "beta": ', num_json(bench$DiD2x2$beta), ","),
  paste0('    "se_classical": ', num_json(bench$DiD2x2$se_classical), ","),
  paste0('    "se_HC1": ', num_json(bench$DiD2x2$se_HC1)),
  "  },",
  '  "TWFEDiD": {',
  paste0('    "beta": ', num_json(bench$TWFEDiD$beta), ","),
  paste0('    "se_classical": ', num_json(bench$TWFEDiD$se_classical), ","),
  paste0('    "se_HC1": ', num_json(bench$TWFEDiD$se_HC1)),
  "  },",
  '  "EventStudy": {',
  paste0('    "beta": ', num_json(bench$EventStudy$beta), ","),
  paste0('    "se_classical": ', num_json(bench$EventStudy$se_classical), ","),
  paste0('    "se_HC1": ', num_json(bench$EventStudy$se_HC1), ","),
  paste0('    "event_terms": ', str_json(bench$EventStudy$event_terms)),
  "  }",
  "}"
)
writeLines(json_lines, "fase5Benchmarks.json")
cat("Wrote fase5_data.csv and fase5Benchmarks.json\n")
