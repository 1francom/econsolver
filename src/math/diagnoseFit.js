// Preflight diagnostics for OLS/WLS fit failures.
// Returns a human-readable explanation for why X'X (or X'WX) was singular or
// the engine returned null. Pure JS — no React, no engine deps.

const _isFiniteNum = v => typeof v === "number" && isFinite(v);

function _validRows(rows, yCol, xCols, weightCol) {
  return rows.filter(r => {
    if (!_isFiniteNum(r[yCol])) return false;
    for (const c of xCols) if (!_isFiniteNum(r[c])) return false;
    if (weightCol) {
      const w = r[weightCol];
      if (!_isFiniteNum(w) || w <= 0) return false;
    }
    return true;
  });
}

function _isConstant(vals) {
  if (vals.length < 2) return true;
  const v0 = vals[0];
  for (let i = 1; i < vals.length; i++) if (vals[i] !== v0) return false;
  return true;
}

// Pearson correlation between two arrays. Returns null if either is constant.
function _corr(a, b) {
  const n = a.length;
  let sa = 0, sb = 0;
  for (let i = 0; i < n; i++) { sa += a[i]; sb += b[i]; }
  const ma = sa / n, mb = sb / n;
  let num = 0, da = 0, db = 0;
  for (let i = 0; i < n; i++) {
    const xa = a[i] - ma, xb = b[i] - mb;
    num += xa * xb; da += xa * xa; db += xb * xb;
  }
  if (da === 0 || db === 0) return null;
  return num / Math.sqrt(da * db);
}

/**
 * Diagnose why a linear fit failed. Returns a specific user-facing message.
 *
 * @param {object[]} rows       Raw rows passed to the engine
 * @param {string}   yCol       Outcome column name
 * @param {string[]} xCols      Regressor column names (without intercept)
 * @param {string}   [weightCol] Optional weight column for WLS
 * @returns {string}            Diagnostic message (never null)
 */
export function diagnoseFit(rows, yCol, xCols, weightCol) {
  const valid = _validRows(rows, yCol, xCols, weightCol);
  const n = valid.length;
  const k = xCols.length + 1; // + intercept

  if (n === 0) {
    return `No rows remain after dropping missing/non-numeric values in '${yCol}'${xCols.length ? `, '${xCols.join("', '")}'` : ""}${weightCol ? `, or non-positive weights in '${weightCol}'` : ""}. Check filters and column types.`;
  }
  if (n < k + 2) {
    return `Only ${n} valid observation${n === 1 ? "" : "s"} after dropping missing values — need at least ${k + 2} to estimate ${k} parameter${k === 1 ? "" : "s"}. Loosen filters or reduce regressors.`;
  }

  const yVals = valid.map(r => r[yCol]);
  if (_isConstant(yVals)) {
    return `Outcome '${yCol}' is constant (= ${yVals[0]}) in the estimation sample. A regression needs variation in Y.`;
  }

  // Per-X constant check
  const xVals = xCols.map(c => valid.map(r => r[c]));
  for (let i = 0; i < xCols.length; i++) {
    if (_isConstant(xVals[i])) {
      return `Regressor '${xCols[i]}' is constant (= ${xVals[i][0]}) in the estimation sample — it is collinear with the intercept. Remove it or check filters.`;
    }
  }

  // Pairwise perfect collinearity
  for (let i = 0; i < xCols.length; i++) {
    for (let j = i + 1; j < xCols.length; j++) {
      const r = _corr(xVals[i], xVals[j]);
      if (r !== null && Math.abs(r) > 0.99999) {
        return `Regressors '${xCols[i]}' and '${xCols[j]}' are perfectly collinear (corr = ${r.toFixed(4)}). Drop one of them.`;
      }
    }
  }

  // Dummy-trap heuristic: a group of regressors that sum to 1 row-wise.
  // E.g. including all category dummies without dropping a base level.
  if (xCols.length >= 2) {
    const looksBinary = xVals.map(col => col.every(v => v === 0 || v === 1));
    const binaryIdx = looksBinary.map((b, i) => b ? i : -1).filter(i => i >= 0);
    if (binaryIdx.length >= 2) {
      let trap = true;
      for (let r = 0; r < n; r++) {
        let s = 0;
        for (const i of binaryIdx) s += xVals[i][r];
        if (s !== 1) { trap = false; break; }
      }
      if (trap) {
        const names = binaryIdx.map(i => `'${xCols[i]}'`).join(", ");
        return `Dummy-variable trap: ${names} sum to 1 in every row, so together they reproduce the intercept. Drop one as the base category.`;
      }
    }
  }

  return `X'X is not invertible — likely near-perfect collinearity among the regressors. Try removing one of the highly correlated X variables or check for duplicated columns.`;
}
