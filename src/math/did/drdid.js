// ─── ECON STUDIO · src/math/did/drdid.js ──────────────────────────────────────
// Doubly-robust 2×2 DiD building block — Sant'Anna & Zhao (2020).
// Pure math. No React. No side effects.
//
// Ports three estimators from the DRDID R package (v1.0.4):
//   "reg"  — outcome-regression DiD        (reg_did_panel)
//   "ipw"  — inverse-probability-weighted  (std_ipw_did_panel)
//   "dr"   — doubly-robust (default)       (drdid_panel)
//
// Influence function convention (matches DRDID R package):
//   se = sqrt(mean(inf²)) / n
//   i.e. inf is NOT divided by n; the /n lives in the SE formula.

import { matInv, matMul, transpose } from "../LinearEngine.js";
import { runLogit } from "../NonLinearEngine.js";

// ─── INTERNAL HELPERS ────────────────────────────────────────────────────────

/** Dot product of two plain arrays. */
function dot(a, b) {
  let s = 0;
  for (let i = 0; i < a.length; i++) s += a[i] * b[i];
  return s;
}

/** mean of an array */
function mean(arr) {
  let s = 0;
  for (let i = 0; i < arr.length; i++) s += arr[i];
  return s / arr.length;
}

/**
 * Weighted OLS on a subset of observations.
 * Xc  : number[][] rows (already the subset, each row has intercept)
 * Yc  : number[]   outcomes (same length as Xc)
 * Wc  : number[]   weights (same length as Xc)
 * Returns { beta: number[] } or null if rank-deficient.
 */
function wlsBeta(Xc, Yc, Wc) {
  const n = Xc.length;
  const k = Xc[0].length;
  if (n < k) return null;

  // X'WX  (k×k)
  const XtWX = Array.from({ length: k }, () => new Array(k).fill(0));
  // X'WY  (k×1)
  const XtWY = new Array(k).fill(0);

  for (let i = 0; i < n; i++) {
    const w = Wc[i];
    const x = Xc[i];
    const y = Yc[i];
    for (let r = 0; r < k; r++) {
      XtWY[r] += w * x[r] * y;
      for (let c = 0; c < k; c++) {
        XtWX[r][c] += w * x[r] * x[c];
      }
    }
  }

  const inv = matInv(XtWX);
  if (!inv) return null;

  // beta = inv @ XtWY
  const beta = new Array(k).fill(0);
  for (let r = 0; r < k; r++) {
    for (let c = 0; c < k; c++) {
      beta[r] += inv[r][c] * XtWY[c];
    }
  }
  return { beta, XtWXinv: inv };
}

// ─── MAIN EXPORT ─────────────────────────────────────────────────────────────

/**
 * compute2x2 — 2×2 doubly-robust DiD (Sant'Anna & Zhao 2020)
 *
 * @param {object} opts
 * @param {number[]}   opts.deltaY    — Y_t − Y_b for each unit (length n)
 * @param {number[]}   opts.D         — treatment indicator 0/1 (length n)
 * @param {number[][]} opts.X         — covariate rows WITH intercept (n × k)
 * @param {"dr"|"reg"|"ipw"} [opts.estMethod="dr"]
 * @param {number[]}   [opts.weights] — sampling weights (default all 1)
 *
 * @returns {{ att: number, inf: Float64Array, warning?: string }}
 *   att    — ATT point estimate
 *   inf    — centered influence-function vector (length n);
 *            se = sqrt(mean(inf²)) / n
 *   warning — optional diagnostic string
 */
export function compute2x2({ deltaY, D, X, estMethod = "dr", weights }) {
  const n = deltaY.length;
  const k = X[0].length;

  // Validate that X has leading-1 intercept (DRDID convention)
  if (!X.length || X[0][0] !== 1) {
    return { att: NaN, inf: new Float64Array(n), warning: "compute2x2: X rows must start with intercept column (value 1)." };
  }

  // Default weights
  const W = weights ? weights.slice() : new Array(n).fill(1);

  // Guard: empty treated or control
  const sumW1 = D.reduce((s, d, i) => s + W[i] * d, 0);
  const sumW0 = D.reduce((s, d, i) => s + W[i] * (1 - d), 0);
  if (sumW1 === 0 || sumW0 === 0) {
    return { att: NaN, inf: new Float64Array(n) };
  }

  const warnings = [];

  // ── Step 1: Propensity score ─────────────────────────────────────────────
  let ps = new Array(n).fill(mean(D)); // fallback = sample proportion treated

  if (estMethod !== "reg") {
    // Build rows object for runLogit
    // We use a thin wrapper: build row objects with keys "_y", "_x0", "_x1", ...
    const xColNames = X[0].map((_, j) => `_x${j}`);
    const logitRows = [];
    for (let i = 0; i < n; i++) {
      const row = { _y: D[i] };
      for (let j = 0; j < k; j++) row[xColNames[j]] = X[i][j];
      row._w = W[i];
      logitRows.push(row);
    }

    // runLogit expects (rows, yCol, xCols) — note: it auto-adds intercept,
    // but our X already has the intercept column (index 0, all 1s).
    // We must pass xCols = _x1, _x2, ... (skip the intercept column _x0).
    const covColNames = xColNames.slice(1); // drop the all-1 column

    let logitRes;
    try {
      logitRes = runLogit(logitRows, "_y", covColNames);
    } catch (e) {
      warnings.push(`Logit failed (${e.message}); using constant PS = mean(D).`);
      logitRes = null;
    }

    if (logitRes && logitRes.fitted && !logitRes.error) {
      for (let i = 0; i < n; i++) {
        ps[i] = Math.max(1e-6, Math.min(1 - 1e-6, logitRes.fitted[i]));
      }
    } else {
      if (logitRes && logitRes.error) {
        warnings.push(`Logit: ${logitRes.error}. Using constant PS = mean(D).`);
      }
      // ps stays at mean(D) fallback
    }
  }

  // ── Step 2: Outcome regression on CONTROL units ──────────────────────────
  const out = new Array(n).fill(0); // OR predictions for all units
  let orBeta = null;
  let XtWXinvCtrl = null; // (X_c'W_c X_c)^{-1} for IF correction

  if (estMethod !== "ipw") {
    // Collect control units
    const Xc = [], Yc = [], Wc = [];
    for (let i = 0; i < n; i++) {
      if (D[i] === 0) {
        Xc.push(X[i]);
        Yc.push(deltaY[i]);
        Wc.push(W[i]);
      }
    }

    if (Xc.length < k) {
      // Under-determined — return NaN
      warnings.push(`Fewer control units (${Xc.length}) than covariates (${k}). OR skipped.`);
      return {
        att: NaN,
        inf: new Float64Array(n),
        warning: warnings.join(" "),
      };
    }

    const wlsRes = wlsBeta(Xc, Yc, Wc);
    if (!wlsRes) {
      warnings.push("OR WLS is rank-deficient. Returning NaN.");
      return {
        att: NaN,
        inf: new Float64Array(n),
        warning: warnings.join(" "),
      };
    }
    orBeta = wlsRes.beta;
    XtWXinvCtrl = wlsRes.XtWXinv;

    // Predict for ALL units
    for (let i = 0; i < n; i++) {
      out[i] = dot(X[i], orBeta);
    }
  }

  // ── Step 3: Weights ──────────────────────────────────────────────────────
  const w1 = new Array(n);
  const w0 = new Array(n);
  for (let i = 0; i < n; i++) {
    w1[i] = W[i] * D[i];
    if (estMethod === "reg") {
      w0[i] = W[i] * (1 - D[i]);
    } else {
      // IPW and DR: propensity-score reweighted control
      w0[i] = W[i] * ps[i] * (1 - D[i]) / (1 - ps[i]);
    }
  }

  // ── Step 4: Residual ─────────────────────────────────────────────────────
  const eta = new Array(n);
  for (let i = 0; i < n; i++) {
    eta[i] = deltaY[i] - out[i];
  }

  // ── Step 5: ATT ──────────────────────────────────────────────────────────
  let sw1 = 0, sw0 = 0;
  let sw1eta = 0, sw0eta = 0;
  for (let i = 0; i < n; i++) {
    sw1 += w1[i];
    sw0 += w0[i];
    sw1eta += w1[i] * eta[i];
    sw0eta += w0[i] * eta[i];
  }

  if (sw1 === 0 || sw0 === 0) {
    return { att: NaN, inf: new Float64Array(n) };
  }

  const mu1 = sw1eta / sw1;
  const mu0 = sw0eta / sw0;
  const att = mu1 - mu0;

  // ── Step 6: Influence function ───────────────────────────────────────────
  //
  // All three methods share the same structure:
  //   inf[i] = inf_t[i] - inf_c[i] - correction_terms[i]
  //
  // where correction_terms differ by method.

  const meanW1 = sw1 / n; // = mean(w1)
  const meanW0 = sw0 / n; // = mean(w0)

  const inf = new Float64Array(n);

  // Treated and control base components (common to all methods)
  const inf_t = new Array(n);
  const inf_c = new Array(n);
  for (let i = 0; i < n; i++) {
    inf_t[i] = (w1[i] / meanW1) * (eta[i] - mu1);
    inf_c[i] = (w0[i] / meanW0) * (eta[i] - mu0);
  }

  // ── OR correction term (used by "reg" and "dr") ──────────────────────────
  // correction_beta[i] = mu1_X · Gamma^{-1} · score_c[i]
  // where:
  //   mu1_X   = (1/sw1) * sum_i(w1[i] * X[i])   (treated mean of X, k-dim)
  //   Gamma   = XtWXinvCtrl                       (inverse of (X_c'W_c X_c))
  //   score_c[i] = W[i]*(1-D[i])*(deltaY[i]-out[i]) * X[i]   (k-dim score)
  //
  // So correction_beta[i] = (mu1_X @ Gamma^{-1}) · score_c[i]
  // Let v = mu1_X @ Gamma^{-1}  (1×k vector)
  // Then correction_beta[i] = v · score_c[i]

  const corrOR = new Array(n).fill(0);
  if (estMethod !== "ipw" && XtWXinvCtrl) {
    // Treated mean of X (k-dim)
    const mu1X = new Array(k).fill(0);
    for (let i = 0; i < n; i++) {
      if (D[i] === 1) {
        for (let j = 0; j < k; j++) mu1X[j] += w1[i] * X[i][j];
      }
    }
    for (let j = 0; j < k; j++) mu1X[j] /= sw1;

    // v = mu1X @ XtWXinvCtrl   (1×k vector)
    const v = new Array(k).fill(0);
    for (let r = 0; r < k; r++) {
      for (let c = 0; c < k; c++) {
        v[r] += mu1X[c] * XtWXinvCtrl[c][r];
      }
    }

    // correction_beta[i] = v · (W[i]*(1-D[i])*(deltaY[i]-out[i])*X[i])
    for (let i = 0; i < n; i++) {
      const score_scalar = W[i] * (1 - D[i]) * (deltaY[i] - out[i]);
      let ci = 0;
      for (let j = 0; j < k; j++) ci += v[j] * X[i][j];
      corrOR[i] = ci * score_scalar;
    }
  }

  // ── PS correction term (used by "ipw" and "dr") ──────────────────────────
  // From DRDID::std_ipw_did_panel / drdid_panel:
  //
  // The PS score contribution for logit is:
  //   score_ps[i] = W[i] * (D[i] - ps[i]) * X[i]    (k-dim)
  //
  // The logit information matrix (bread):
  //   bread_ps = (1/n) * sum_i( W[i]*ps[i]*(1-ps[i]) * X[i]X[i]' )  (k×k)
  //
  // The "mu0_w" vector:
  //   mu0_w = (1/sw0) * sum_i( w0[i]*(eta[i]-mu0) * X[i] )   (k-dim)
  //
  // psi_ps[i] = mu0_w @ bread_ps^{-1} @ score_ps[i]
  //           = (mu0_w @ bread_ps^{-1}) · score_ps[i]
  // Let u = mu0_w @ bread_ps^{-1}  (1×k)
  // psi_ps[i] = u · score_ps[i]

  const corrPS = new Array(n).fill(0);
  if (estMethod !== "reg") {
    // bread_ps (k×k)  — average logit information (scaled by 1/n)
    const breadPS = Array.from({ length: k }, () => new Array(k).fill(0));
    for (let i = 0; i < n; i++) {
      const wi_ps = W[i] * ps[i] * (1 - ps[i]);
      for (let r = 0; r < k; r++) {
        for (let c = 0; c < k; c++) {
          breadPS[r][c] += wi_ps * X[i][r] * X[i][c];
        }
      }
    }
    for (let r = 0; r < k; r++)
      for (let c = 0; c < k; c++)
        breadPS[r][c] /= n;

    const breadInv = matInv(breadPS);

    if (breadInv) {
      // mu0_w (k-dim)
      const mu0w = new Array(k).fill(0);
      for (let i = 0; i < n; i++) {
        const coeff = w0[i] * (eta[i] - mu0) / sw0;
        for (let j = 0; j < k; j++) mu0w[j] += coeff * X[i][j];
      }

      // u = mu0w @ breadInv  (1×k)
      const u = new Array(k).fill(0);
      for (let r = 0; r < k; r++) {
        for (let c = 0; c < k; c++) {
          u[r] += mu0w[c] * breadInv[c][r];
        }
      }

      // psi_ps[i] = u · (W[i]*(D[i]-ps[i])*X[i])
      for (let i = 0; i < n; i++) {
        const score_scalar = W[i] * (D[i] - ps[i]);
        let ci = 0;
        for (let j = 0; j < k; j++) ci += u[j] * X[i][j];
        corrPS[i] = ci * score_scalar;
      }
    } else {
      warnings.push("PS bread matrix is singular; PS correction term set to 0.");
    }
  }

  // ── Assemble IF ───────────────────────────────────────────────────────────
  for (let i = 0; i < n; i++) {
    inf[i] = inf_t[i] - inf_c[i] - corrOR[i] - corrPS[i];
  }

  // Center: subtract mean(inf) for numerical safety
  let infMean = 0;
  for (let i = 0; i < n; i++) infMean += inf[i];
  infMean /= n;
  for (let i = 0; i < n; i++) inf[i] -= infMean;

  const result = { att, inf };
  if (warnings.length > 0) result.warning = warnings.join(" ");
  return result;
}
