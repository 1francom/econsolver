# RDD HC SE validation — EconSolver vs R sandwich::vcovHC
# Tests that HC1 and HC3 SE differ from classical SE for RDD local linear regression.
# n=500, seed=42, cutoff=0, triangular kernel, IK-style bandwidth.

set.seed(42)
n <- 500
x <- runif(n, -1, 1)
D <- as.integer(x >= 0)
y <- 2 * D + x + rnorm(n, 0, 0.5)

# Bandwidth: use h = 0.5 (covers ~half the support — sensible for this DGP)
h <- 0.5
cutoff <- 0

# Filter to bandwidth window
in_bw <- abs(x - cutoff) <= h
x_w <- x[in_bw]
y_w <- y[in_bw]
D_w <- D[in_bw]
n_w <- sum(in_bw)

cat(sprintf("Obs within bandwidth: %d\n", n_w))

# Kernel weights (triangular)
u    <- abs(x_w - cutoff) / h
kern <- 1 - u

# Design matrix: [1, D, (x-c), D*(x-c)]
xc   <- x_w - cutoff
X    <- cbind(1, D_w, xc, D_w * xc)
colnames(X) <- c("(Intercept)", "D", "xc", "D.xc")

# WLS fit
fit <- lm(y_w ~ D_w + xc + I(D_w * xc), weights = kern)

cat("\n=== WLS coefficients ===\n")
cat(sprintf("(Intercept): %.6f\n", coef(fit)[1]))
cat(sprintf("D (LATE):    %.6f\n", coef(fit)[2]))
cat(sprintf("xc:          %.6f\n", coef(fit)[3]))
cat(sprintf("D*xc:        %.6f\n", coef(fit)[4]))

# Classical SE (unweighted SSR / df — matching EconSolver convention)
resid_uw <- residuals(fit)           # unweighted residuals from WLS
n_k      <- length(resid_uw) - 4    # df = n_w - 4
s2_uw    <- sum(resid_uw^2) / n_k
XtWXinv  <- solve(t(X) %*% diag(kern) %*% X)
classical_var <- diag(XtWXinv) * s2_uw
classical_se  <- sqrt(classical_var)

cat("\n=== Classical SE (unweighted SSR) ===\n")
cat(sprintf("(Intercept): %.6f\n", classical_se[1]))
cat(sprintf("D (LATE):    %.6f\n", classical_se[2]))
cat(sprintf("xc:          %.6f\n", classical_se[3]))
cat(sprintf("D*xc:        %.6f\n", classical_se[4]))

# HC1 sandwich using sandwich package
if (!requireNamespace("sandwich", quietly = TRUE)) install.packages("sandwich", repos="https://cloud.r-project.org")
library(sandwich)

# HC0 meat: B = X' diag(e^2) X  (unweighted residuals from WLS)
B_HC0 <- t(X) %*% diag(resid_uw^2) %*% X
V_HC0 <- XtWXinv %*% B_HC0 %*% XtWXinv
HC0_se <- sqrt(diag(V_HC0))

# HC1: HC0 * n/(n-k)
scale_HC1 <- n_w / (n_w - 4)
HC1_se <- sqrt(diag(V_HC0) * scale_HC1)

# HC3: B = X' diag((e/(1-h_ii))^2) X
h_ii <- diag(X %*% XtWXinv %*% t(X))   # leverage from UNWEIGHTED X'X matrix
# NOTE: for HC on WLS, leverages use (X'WX)^{-1} not (X'X)^{-1}
# We match EconSolver which uses XtWXinv (the actual (X'WX)^{-1})
h_ii_wls <- sapply(1:n_w, function(i) {
  xi <- X[i,]
  as.numeric(t(xi) %*% XtWXinv %*% xi)
})
h_ii_wls <- pmin(1 - 1e-10, pmax(0, h_ii_wls))

e_HC3 <- resid_uw / (1 - h_ii_wls)^2 * resid_uw   # e_i^2 / (1-h_ii)^2 scaling
# Actually: w_i = e_i^2 / (1-h_ii)^2
w_HC3 <- resid_uw^2 / (1 - h_ii_wls)^2
B_HC3 <- t(X) %*% diag(w_HC3) %*% X
V_HC3 <- XtWXinv %*% B_HC3 %*% XtWXinv
HC3_se <- sqrt(diag(V_HC3))

cat("\n=== HC1 SE (sandwich, unweighted resid) ===\n")
cat(sprintf("(Intercept): %.6f\n", HC1_se[1]))
cat(sprintf("D (LATE):    %.4f\n",  HC1_se[2]))
cat(sprintf("xc:          %.4f\n",  HC1_se[3]))
cat(sprintf("D*xc:        %.4f\n",  HC1_se[4]))

cat("\n=== HC3 SE (sandwich, unweighted resid) ===\n")
cat(sprintf("(Intercept): %.6f\n", HC3_se[1]))
cat(sprintf("D (LATE):    %.4f\n",  HC3_se[2]))
cat(sprintf("xc:          %.4f\n",  HC3_se[3]))
cat(sprintf("D*xc:        %.4f\n",  HC3_se[4]))

cat("\n=== Delta: HC1 vs Classical (should be non-zero) ===\n")
delta <- abs(HC1_se - classical_se)
cat(sprintf("D (LATE): delta = %.6f\n", delta[2]))
cat(sprintf("HC1/Classical ratio for D: %.4f\n", HC1_se[2]/classical_se[2]))

cat("\n=== Delta: HC3 vs Classical (should be non-zero) ===\n")
delta3 <- abs(HC3_se - classical_se)
cat(sprintf("D (LATE): delta = %.6f\n", delta3[2]))
cat(sprintf("HC3/Classical ratio for D: %.4f\n", HC3_se[2]/classical_se[2]))
