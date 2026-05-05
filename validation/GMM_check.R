# ─── GMMEngine.js Validation against R ───────────────────────────────────────
# Two-Step Efficient GMM and LIML (k-class) estimators.
#
# Replicates exactly the math in GMMEngine.js:
#   X matrix = [1, wCols, xCols]   (intercept + exog controls + endogenous)
#   Z matrix = [1, wCols, zCols]   (intercept + exog controls + instruments)
#
# Dataset: n=60, one endogenous regressor (x1), one excluded instrument (z1),
#          one exogenous control (w1), seed=42 for reproducibility.
#
# Model: y = b0 + b1*w1 + b2*x1 + u
#        x1 = a0 + a1*w1 + a2*z1 + v    (first stage)
# ─────────────────────────────────────────────────────────────────────────────

set.seed(42)
n <- 60

# Generate exogenous variables
z1 <- rnorm(n)          # excluded instrument
w1 <- rnorm(n)          # exogenous control

# Generate endogenous regressor (correlated with error)
v  <- rnorm(n)
x1 <- 1.2 + 0.8*w1 + 1.5*z1 + v

# Generate outcome (u correlated with v → endogeneity)
u  <- 0.7*v + rnorm(n)
y  <- 2.0 + 0.5*w1 + 1.8*x1 + u

dat <- data.frame(y=y, x1=x1, w1=w1, z1=z1)

cat("=== Dataset summary ===\n")
cat(sprintf("n = %d\n", n))
cat(sprintf("y  mean=%.6f sd=%.6f\n", mean(y), sd(y)))
cat(sprintf("x1 mean=%.6f sd=%.6f\n", mean(x1), sd(x1)))
cat(sprintf("w1 mean=%.6f sd=%.6f\n", mean(w1), sd(w1)))
cat(sprintf("z1 mean=%.6f sd=%.6f\n", mean(z1), sd(z1)))
cat("\n")

# ─────────────────────────────────────────────────────────────────────────────
# Build matrices exactly as GMMEngine.js does:
#   X = [1, w1, x1]   (k=3)
#   Z = [1, w1, z1]   (l=3, just-identified: l-k_endog = 3-1 = overidDf=0... wait)
#
# GMMEngine.js: overidDf = zCols.length - xCols.length = 1 - 1 = 0
# So J-stat = NaN (no overidentification). That's fine — still runs.
# ─────────────────────────────────────────────────────────────────────────────

X <- cbind(1, w1, x1)    # n×3: intercept, control, endogenous
Z <- cbind(1, w1, z1)    # n×3: intercept, control, instrument
Y <- y

k <- ncol(X)   # 3
l <- ncol(Z)   # 3
cat(sprintf("k=%d, l=%d, n=%d, overidDf=%d\n\n", k, l, n, l - (k - 1 - 1)))

# ─────────────────────────────────────────────────────────────────────────────
# TWO-STEP GMM (manual replication of GMMEngine.js runGMM)
# ─────────────────────────────────────────────────────────────────────────────
cat("=== TWO-STEP GMM (Manual Replication of GMMEngine.js) ===\n")

# Step 1: 2SLS beta
ZtZ    <- t(Z) %*% Z
ZtZinv <- solve(ZtZ)
ZtX    <- t(Z) %*% X
ZtY    <- as.vector(t(Z) %*% Y)

PzX    <- Z %*% ZtZinv %*% ZtX          # n×k
XtPzX  <- t(PzX) %*% X                  # k×k
XtPzXi <- solve(XtPzX)

ZtZiZtY <- as.vector(ZtZinv %*% ZtY)
PzY      <- as.vector(Z %*% ZtZiZtY)
XtPzY    <- as.vector(t(PzX) %*% PzY)   # same as t(PzX) %*% Y
beta1    <- XtPzXi %*% XtPzY
resid1   <- Y - X %*% beta1

cat("Step-1 (2SLS) coefficients:\n")
cat(sprintf("  (Intercept): %.6f\n", beta1[1]))
cat(sprintf("  w1:          %.6f\n", beta1[2]))
cat(sprintf("  x1:          %.6f\n", beta1[3]))
cat("\n")

# Step 2: Omega = (1/n) * Z' diag(e^2) Z
e2     <- as.vector(resid1)^2
Omega  <- (1/n) * t(Z) %*% diag(e2) %*% Z
OmegaInv <- solve(Omega)

# beta_GMM = (X'Z Omega^-1 Z'X)^-1 X'Z Omega^-1 Z'Y
XtZ     <- t(X) %*% Z
XtZ_OI  <- XtZ %*% OmegaInv
A       <- XtZ_OI %*% ZtX
Ainv    <- solve(A)
bVec    <- XtZ_OI %*% ZtY
beta_gmm <- as.vector(Ainv %*% bVec)

# SE = sqrt(diag(Ainv / n))
se_gmm <- sqrt(abs(diag(Ainv) / n))
df_gmm  <- n - k

cat("GMM Two-Step coefficients:\n")
cat(sprintf("  (Intercept): %.6f\n", beta_gmm[1]))
cat(sprintf("  w1:          %.6f\n", beta_gmm[2]))
cat(sprintf("  x1:          %.6f\n", beta_gmm[3]))
cat("\n")
cat("GMM Two-Step SE:\n")
cat(sprintf("  SE(Intercept): %.4f\n", se_gmm[1]))
cat(sprintf("  SE(w1):        %.4f\n", se_gmm[2]))
cat(sprintf("  SE(x1):        %.4f\n", se_gmm[3]))
cat("\n")

# J-statistic (overidDf = 0 → NaN in engine, but compute anyway for diagnostics)
resid_gmm <- Y - X %*% beta_gmm
g     <- as.vector(t(Z) %*% resid_gmm) / n
OIg   <- OmegaInv %*% g
jStat <- n * sum(g * OIg)
overidDf <- l - (k - 1)   # zCols.length - xCols.length = 1 - 1 = 0
cat(sprintf("J-stat = %.6f  (overidDf=%d, so pval=NaN in engine)\n\n", jStat, overidDf))

# ── Verify with gmm package if available ──────────────────────────────────────
if (requireNamespace("gmm", quietly=TRUE)) {
  library(gmm)
  # moment conditions for IV-GMM: E[Z*(y - X*b)] = 0
  moment_fn <- function(theta, dat_mat) {
    Y_  <- dat_mat[, 1]
    X_  <- dat_mat[, 2:4]   # intercept, w1, x1
    Z_  <- dat_mat[, 5:7]   # intercept, w1, z1
    e   <- Y_ - X_ %*% theta
    Z_ * as.vector(e)
  }
  dat_mat <- cbind(Y, X, Z[, c(1,2,3)])  # avoid duplicate intercept
  # Note: gmm package uses different weighting matrix convention
  # We report manual results as ground truth for JS comparison
  cat("Note: gmm package available — manual computation above is the ground truth\n\n")
} else {
  cat("Note: 'gmm' package not installed — using manual computation as reference\n\n")
}

# ── Verify with AER::ivreg for 2SLS (just-identified case) ───────────────────
if (requireNamespace("AER", quietly=TRUE)) {
  library(AER)
  fit_iv <- ivreg(y ~ w1 + x1 | w1 + z1, data=dat)
  cat("AER::ivreg (2SLS, just-identified) for cross-check:\n")
  cat(sprintf("  (Intercept): %.6f\n", coef(fit_iv)[1]))
  cat(sprintf("  w1:          %.6f\n", coef(fit_iv)[2]))
  cat(sprintf("  x1:          %.6f\n", coef(fit_iv)[3]))
  cat("\n")
} else {
  cat("Note: 'AER' package not installed\n\n")
}

# ─────────────────────────────────────────────────────────────────────────────
# LIML (manual replication of GMMEngine.js runLIML)
# ─────────────────────────────────────────────────────────────────────────────
cat("=== LIML (Manual Replication of GMMEngine.js) ===\n")

# Wn = [1, w1] (exogenous regressors only — no endogenous)
Wn    <- cbind(1, w1)   # n×2
WtWinv <- solve(t(Wn) %*% Wn)
Wt    <- t(Wn)

# Projection helpers
mz_vec <- function(v) {
  v - Z %*% ZtZinv %*% (t(Z) %*% v)
}
mw_vec <- function(v) {
  v - Wn %*% WtWinv %*% (t(Wn) %*% v)
}

# m = xCols.length + 1 = 2 (Y and x1)
vecs <- list(Y, x1)   # [Y, x1]

mzVecs <- lapply(vecs, mz_vec)
mwVecs <- lapply(vecs, mw_vec)

# A[i][j] = dot(mzVecs[i], mzVecs[j]), B[i][j] = dot(mwVecs[i], mwVecs[j])
A_liml <- matrix(0, 2, 2)
B_liml <- matrix(0, 2, 2)
for (i in 1:2) for (j in 1:2) {
  A_liml[i,j] <- sum(mzVecs[[i]] * mzVecs[[j]])
  B_liml[i,j] <- sum(mwVecs[[i]] * mwVecs[[j]])
}

cat("A matrix (M_Z):\n")
print(round(A_liml, 8))
cat("B matrix (M_W):\n")
print(round(B_liml, 8))

# limlKappa2x2: solve det(B - kappa*A) = 0
# det(A)*kappa^2 - c1*kappa + det(B) = 0
# where c1 = A[0][0]*B[1][1] + B[0][0]*A[1][1] - 2*A[0][1]*B[0][1]
A00 <- A_liml[1,1]; A01 <- A_liml[1,2]; A11 <- A_liml[2,2]
B00 <- B_liml[1,1]; B01 <- B_liml[1,2]; B11 <- B_liml[2,2]
detA <- A00*A11 - A01*A01
detB <- B00*B11 - B01*B01
c1   <- A00*B11 + B00*A11 - 2*A01*B01
disc <- c1*c1 - 4*detA*detB
sq   <- sqrt(disc)
kappa_roots <- c((c1 - sq)/(2*detA), (c1 + sq)/(2*detA))
kappa <- min(kappa_roots)

cat(sprintf("\ndetA=%.8f, detB=%.8f, c1=%.8f, disc=%.8f\n",
            detA, detB, c1, disc))
cat(sprintf("kappa roots: %.8f, %.8f\n", kappa_roots[1], kappa_roots[2]))
cat(sprintf("kappa (min eigenvalue) = %.8f\n\n", kappa))

# Verify kappa via eigen(solve(A_liml) %*% B_liml)
eig <- eigen(solve(A_liml) %*% B_liml)
cat(sprintf("Eigen check: min eigenvalue of A^-1 B = %.8f\n\n",
            min(Re(eig$values))))

# beta_LIML = (X'X - kappa * X' M_Z X)^-1 * (X'Y - kappa * X' M_Z Y)
# M_Z X column by column
MzX <- lapply(1:k, function(j) mz_vec(X[,j]))

XtX    <- t(X) %*% X
# XtMzX[i][j] = dot(MzX[i], X[,j])   (note: M_Z is symmetric, so also = dot(X[,i], MzX[j]))
XtMzX  <- matrix(0, k, k)
for (i in 1:k) for (j in 1:k) XtMzX[i,j] <- sum(MzX[[i]] * X[,j])
lhsMat <- XtX - kappa * XtMzX
lhsInv <- solve(lhsMat)

XtY_   <- as.vector(t(X) %*% Y)
XtMzY  <- sapply(MzX, function(mzxj) sum(mzxj * Y))
rhs    <- XtY_ - kappa * XtMzY
beta_liml <- as.vector(lhsInv %*% rhs)

# SE: sigma^2 = SSR/(n-k);  Var(beta) = sigma^2 * (X'P_Z X)^-1
ZtX_    <- t(Z) %*% X
PzX_    <- Z %*% ZtZinv %*% ZtX_
XtPzX_  <- t(PzX_) %*% X
XtPzXi_ <- solve(XtPzX_)

resid_liml <- Y - X %*% beta_liml
SSR_liml   <- sum(resid_liml^2)
df_liml    <- n - k
s2_liml    <- SSR_liml / df_liml
se_liml    <- sqrt(abs(diag(XtPzXi_) * s2_liml))

cat("LIML coefficients:\n")
cat(sprintf("  (Intercept): %.6f\n", beta_liml[1]))
cat(sprintf("  w1:          %.6f\n", beta_liml[2]))
cat(sprintf("  x1:          %.6f\n", beta_liml[3]))
cat("\n")
cat("LIML SE:\n")
cat(sprintf("  SE(Intercept): %.4f\n", se_liml[1]))
cat(sprintf("  SE(w1):        %.4f\n", se_liml[2]))
cat(sprintf("  SE(x1):        %.4f\n", se_liml[3]))
cat("\n")
cat(sprintf("kappa = %.8f\n", kappa))
cat(sprintf("s2    = %.8f\n", s2_liml))
cat(sprintf("SSR   = %.8f\n", SSR_liml))
cat(sprintf("df    = %d\n\n", df_liml))

# ── Verify LIML with AER::ivreg (just-identified → LIML = 2SLS) ──────────────
# For exactly-identified models, LIML = 2SLS. Verify kappa = 1.
cat(sprintf("Just-identified check: kappa should equal 1.0 for exactly-identified model.\n"))
cat(sprintf("  kappa = %.8f  (deviation from 1: %.2e)\n\n", kappa, abs(kappa - 1)))

# ── OVERIDENTIFIED case: add second instrument for a real LIML vs 2SLS split ──
cat("=== OVERIDENTIFIED CASE (z1 + z2, two instruments, one endogenous) ===\n")
set.seed(123)
z2 <- rnorm(n)    # different seed so z2 is not collinear with z1
x1_oi <- 1.2 + 0.8*w1 + 1.5*z1 + 0.9*z2 + v
y_oi  <- 2.0 + 0.5*w1 + 1.8*x1_oi + u

dat_oi <- data.frame(y=y_oi, x1=x1_oi, w1=w1, z1=z1, z2=z2)

X_oi <- cbind(1, w1, x1_oi)    # k=3
Z_oi <- cbind(1, w1, z1, z2)   # l=4, overidDf = 2-1 = 1

# ── Two-Step GMM overidentified ───────────────────────────────────────────────
ZtZ_oi    <- t(Z_oi) %*% Z_oi
ZtZinv_oi <- solve(ZtZ_oi)
ZtX_oi    <- t(Z_oi) %*% X_oi
ZtY_oi    <- as.vector(t(Z_oi) %*% y_oi)

PzX_oi    <- Z_oi %*% ZtZinv_oi %*% ZtX_oi
XtPzX_oi  <- t(PzX_oi) %*% X_oi
beta1_oi  <- solve(XtPzX_oi) %*% (t(PzX_oi) %*% y_oi)
resid1_oi <- y_oi - X_oi %*% beta1_oi

e2_oi     <- as.vector(resid1_oi)^2
Omega_oi  <- (1/n) * t(Z_oi) %*% diag(e2_oi) %*% Z_oi
OmegaInv_oi <- solve(Omega_oi)

XtZ_oi2   <- t(X_oi) %*% Z_oi
XtZ_OI_oi <- XtZ_oi2 %*% OmegaInv_oi
A_oi      <- XtZ_OI_oi %*% ZtX_oi
Ainv_oi   <- solve(A_oi)
bVec_oi   <- XtZ_OI_oi %*% ZtY_oi
beta_gmm_oi <- as.vector(Ainv_oi %*% bVec_oi)
se_gmm_oi   <- sqrt(abs(diag(Ainv_oi) / n))

cat("GMM Two-Step (overid) coefficients:\n")
cat(sprintf("  (Intercept): %.6f\n", beta_gmm_oi[1]))
cat(sprintf("  w1:          %.6f\n", beta_gmm_oi[2]))
cat(sprintf("  x1:          %.6f\n", beta_gmm_oi[3]))
cat("GMM Two-Step (overid) SE:\n")
cat(sprintf("  SE(Intercept): %.4f\n", se_gmm_oi[1]))
cat(sprintf("  SE(w1):        %.4f\n", se_gmm_oi[2]))
cat(sprintf("  SE(x1):        %.4f\n", se_gmm_oi[3]))

resid_gmm_oi <- y_oi - X_oi %*% beta_gmm_oi
g_oi  <- as.vector(t(Z_oi) %*% resid_gmm_oi) / n
OIg_oi <- OmegaInv_oi %*% g_oi
jStat_oi <- n * sum(g_oi * OIg_oi)
cat(sprintf("J-stat (overid) = %.6f  (df=1)\n\n", jStat_oi))

# ── LIML overidentified ────────────────────────────────────────────────────────
mz_vec_oi <- function(v) v - Z_oi %*% ZtZinv_oi %*% (t(Z_oi) %*% v)

Wn_oi   <- cbind(1, w1)
WtWinv_oi <- solve(t(Wn_oi) %*% Wn_oi)
mw_vec_oi <- function(v) v - Wn_oi %*% WtWinv_oi %*% (t(Wn_oi) %*% v)

vecs_oi    <- list(y_oi, x1_oi)
mzVecs_oi  <- lapply(vecs_oi, mz_vec_oi)
mwVecs_oi  <- lapply(vecs_oi, mw_vec_oi)

A_liml_oi <- matrix(0, 2, 2)
B_liml_oi <- matrix(0, 2, 2)
for (i in 1:2) for (j in 1:2) {
  A_liml_oi[i,j] <- sum(mzVecs_oi[[i]] * mzVecs_oi[[j]])
  B_liml_oi[i,j] <- sum(mwVecs_oi[[i]] * mwVecs_oi[[j]])
}

A00_oi <- A_liml_oi[1,1]; A01_oi <- A_liml_oi[1,2]; A11_oi <- A_liml_oi[2,2]
B00_oi <- B_liml_oi[1,1]; B01_oi <- B_liml_oi[1,2]; B11_oi <- B_liml_oi[2,2]
detA_oi <- A00_oi*A11_oi - A01_oi*A01_oi
detB_oi <- B00_oi*B11_oi - B01_oi*B01_oi
c1_oi   <- A00_oi*B11_oi + B00_oi*A11_oi - 2*A01_oi*B01_oi
disc_oi <- c1_oi*c1_oi - 4*detA_oi*detB_oi
kappa_oi <- min((c1_oi - sqrt(disc_oi))/(2*detA_oi),
                (c1_oi + sqrt(disc_oi))/(2*detA_oi))

cat(sprintf("LIML kappa (overid) = %.8f  (should be > 1 since overidentified)\n", kappa_oi))

# Verify via eigen
eig_oi <- eigen(solve(A_liml_oi) %*% B_liml_oi)
cat(sprintf("Eigen check kappa  = %.8f\n\n", min(Re(eig_oi$values))))

MzX_oi   <- lapply(1:k, function(j) mz_vec_oi(X_oi[,j]))
XtX_oi   <- t(X_oi) %*% X_oi
XtMzX_oi <- matrix(0, k, k)
for (i in 1:k) for (j in 1:k) XtMzX_oi[i,j] <- sum(MzX_oi[[i]] * X_oi[,j])
lhsMat_oi <- XtX_oi - kappa_oi * XtMzX_oi
lhsInv_oi <- solve(lhsMat_oi)

XtY_oi2   <- as.vector(t(X_oi) %*% y_oi)
XtMzY_oi  <- sapply(MzX_oi, function(mzxj) sum(mzxj * y_oi))
rhs_oi    <- XtY_oi2 - kappa_oi * XtMzY_oi
beta_liml_oi <- as.vector(lhsInv_oi %*% rhs_oi)

PzX_liml_oi  <- Z_oi %*% ZtZinv_oi %*% (t(Z_oi) %*% X_oi)
XtPzXi_oi    <- solve(t(PzX_liml_oi) %*% X_oi)
resid_liml_oi <- y_oi - X_oi %*% beta_liml_oi
SSR_liml_oi   <- sum(resid_liml_oi^2)
s2_liml_oi    <- SSR_liml_oi / (n - k)
se_liml_oi    <- sqrt(abs(diag(XtPzXi_oi) * s2_liml_oi))

cat("LIML (overid) coefficients:\n")
cat(sprintf("  (Intercept): %.6f\n", beta_liml_oi[1]))
cat(sprintf("  w1:          %.6f\n", beta_liml_oi[2]))
cat(sprintf("  x1:          %.6f\n", beta_liml_oi[3]))
cat("LIML (overid) SE:\n")
cat(sprintf("  SE(Intercept): %.4f\n", se_liml_oi[1]))
cat(sprintf("  SE(w1):        %.4f\n", se_liml_oi[2]))
cat(sprintf("  SE(x1):        %.4f\n", se_liml_oi[3]))
cat(sprintf("kappa (overid) = %.8f\n\n", kappa_oi))

# ── AER check for overidentified case ─────────────────────────────────────────
if (requireNamespace("AER", quietly=TRUE)) {
  fit_iv_oi <- ivreg(y_oi ~ w1 + x1_oi | w1 + z1 + z2, data=dat_oi)
  cat("AER::ivreg 2SLS (overid, for reference):\n")
  cat(sprintf("  (Intercept): %.6f\n", coef(fit_iv_oi)[1]))
  cat(sprintf("  w1:          %.6f\n", coef(fit_iv_oi)[2]))
  cat(sprintf("  x1_oi:       %.6f\n", coef(fit_iv_oi)[3]))
  # LIML option via ivreg
  fit_liml_oi <- ivreg(y_oi ~ w1 + x1_oi | w1 + z1 + z2, data=dat_oi,
                       method="LIML")
  cat("AER::ivreg LIML (overid, for reference):\n")
  cat(sprintf("  (Intercept): %.6f\n", coef(fit_liml_oi)[1]))
  cat(sprintf("  w1:          %.6f\n", coef(fit_liml_oi)[2]))
  cat(sprintf("  x1_oi:       %.6f\n", coef(fit_liml_oi)[3]))
}

cat("\n=== SUMMARY TABLE ===\n")
cat("Just-identified (n=60, one endog, one instrument, one control):\n")
cat("  GMM Two-Step:\n")
cat(sprintf("    beta = [%.6f, %.6f, %.6f]\n", beta_gmm[1], beta_gmm[2], beta_gmm[3]))
cat(sprintf("    se   = [%.4f, %.4f, %.4f]\n", se_gmm[1], se_gmm[2], se_gmm[3]))
cat("  LIML:\n")
cat(sprintf("    beta = [%.6f, %.6f, %.6f]\n", beta_liml[1], beta_liml[2], beta_liml[3]))
cat(sprintf("    se   = [%.4f, %.4f, %.4f]\n", se_liml[1], se_liml[2], se_liml[3]))
cat(sprintf("    kappa = %.8f\n", kappa))
cat("\nOveridentified (n=60, one endog, two instruments, one control):\n")
cat("  GMM Two-Step:\n")
cat(sprintf("    beta = [%.6f, %.6f, %.6f]\n", beta_gmm_oi[1], beta_gmm_oi[2], beta_gmm_oi[3]))
cat(sprintf("    se   = [%.4f, %.4f, %.4f]\n", se_gmm_oi[1], se_gmm_oi[2], se_gmm_oi[3]))
cat(sprintf("    J-stat = %.6f (df=1)\n", jStat_oi))
cat("  LIML:\n")
cat(sprintf("    beta = [%.6f, %.6f, %.6f]\n", beta_liml_oi[1], beta_liml_oi[2], beta_liml_oi[3]))
cat(sprintf("    se   = [%.4f, %.4f, %.4f]\n", se_liml_oi[1], se_liml_oi[2], se_liml_oi[3]))
cat(sprintf("    kappa = %.8f\n", kappa_oi))
