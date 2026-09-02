# ─── ECON STUDIO · portmanteau + normality R benchmarks ──────────────────────
# Regenerates portmanteauBenchmarks.json from R, so the Ljung-Box / Box-Pierce /
# Jarque-Bera values ljungBoxTest() and normalityTest() are checked against come
# from this project's usual reference rather than from Python.
#
# The file shipped in the repo was produced with statsmodels' acorr_ljungbox and
# scipy's jarque_bera, which implement the same formulas. Running this script
# overwrites it with R's own numbers; portmanteauValidation.mjs then re-checks
# the engine against those. The `series` block is READ from the existing JSON,
# never regenerated, so the fixtures stay identical across both sources.
#
# Requires: jsonlite, tseries (for jarque.bera.test).
#   "/c/Program Files/R/R-4.4.1/bin/Rscript.exe" src/math/__validation__/portmanteauRValidation.R

library(jsonlite)
library(tseries)

path <- "src/math/__validation__/portmanteauBenchmarks.json"
bench <- fromJSON(path, simplifyVector = FALSE)

transform_series <- function(x, kind) {
  if (kind == "abs") return(abs(x))
  if (kind == "square") return(x^2)
  x
}

cases <- list()
correlograms <- list()
for (name in names(bench$series)) {
  x <- as.numeric(unlist(bench$series[[name]]))
  for (tf in c("raw", "abs", "square")) {
    z <- transform_series(x, tf)
    for (spec in list(list(10, "Ljung"), list(10, "Box-Pierce"), list(5, "Ljung"), list(20, "Ljung"))) {
      lags <- spec[[1]]; type <- spec[[2]]
      bt <- Box.test(z, lag = lags, type = if (type == "Ljung") "Ljung-Box" else "Box-Pierce")
      cases[[length(cases) + 1]] <- list(
        series = name, transform = tf, lags = lags, type = type,
        stat = unname(bt$statistic), pValue = unname(bt$p.value), df = lags
      )
    }
    for (nlags in c(10, 20)) {
      # R's acf() uses the 1/n denominator and pacf() is Durbin-Levinson on it —
      # the conventions computeACF/computePACF implement.
      a <- acf(z, lag.max = nlags, plot = FALSE)$acf[, 1, 1]
      pa <- pacf(z, lag.max = nlags, plot = FALSE)$acf[, 1, 1]
      correlograms[[length(correlograms) + 1]] <- list(
        series = name, transform = tf, nlags = nlags,
        acf = as.numeric(a),
        # R's pacf omits lag 0; the JSON carries it as 1, matching statsmodels.
        pacf = c(1, as.numeric(pa))
      )
    }
    jb <- jarque.bera.test(z)
    n  <- length(z); m <- mean(z)
    m2 <- sum((z - m)^2) / n; m3 <- sum((z - m)^3) / n; m4 <- sum((z - m)^4) / n
    cases[[length(cases) + 1]] <- list(
      series = name, transform = tf, test = "jarque-bera",
      stat = unname(jb$statistic), pValue = unname(jb$p.value), df = 2,
      skewness = m3 / m2^1.5, kurtosis = m4 / m2^2 - 3
    )
  }
}

bench$meta$source <- paste("R", getRversion(), "Box.test + tseries::jarque.bera.test + acf/pacf")
bench$meta$generated <- format(Sys.Date())
bench$cases <- cases
bench$correlograms <- correlograms
write_json(bench, path, auto_unbox = TRUE, digits = 17, pretty = TRUE)
cat("wrote", length(cases), "cases and", length(correlograms), "correlograms to", path, "\n")
