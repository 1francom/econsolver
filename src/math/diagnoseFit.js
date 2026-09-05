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

// Per-column attribution of listwise deletion. R prints "N observations deleted
// due to missingness"; without naming the culprit, a user facing "only 94 valid
// observations" out of 189 has no way to tell WHICH column cost them the rows.
// Missing and non-numeric are counted separately because the remedy differs: a
// text column needs a type cast, a genuinely empty one needs a filter.
function _colLoss(rows, cols) {
  const out = [];
  for (const c of cols) {
    let missing = 0, nonNumeric = 0;
    for (const r of rows) {
      const v = r[c];
      if (v === null || v === undefined || v === "") missing++;
      else if (typeof v === "number") { if (!isFinite(v)) missing++; }
      else nonNumeric++;
    }
    if (missing + nonNumeric > 0) out.push({ col: c, missing, nonNumeric, lost: missing + nonNumeric });
  }
  return out.sort((a, b) => b.lost - a.lost);
}

// One sentence naming the worst offenders, capped so a factor expanded into
// dozens of dummies cannot flood the message.
function _lossSentence(rows, cols, weightCol) {
  const losses = _colLoss(rows, cols);
  // A weight of 0 is a finite number, so _colLoss cannot see it — but runWLS
  // drops those rows too. Counted separately or the WLS case loses its hint.
  const badW = weightCol
    ? rows.filter(r => { const w = r[weightCol]; return typeof w === "number" && isFinite(w) && w <= 0; }).length
    : 0;
  if (!losses.length && !badW) return "";
  const shown = losses.slice(0, 3).map(L => (
    L.nonNumeric > L.missing
      ? `'${L.col}' is text rather than numeric in ${L.nonNumeric} row${L.nonNumeric === 1 ? "" : "s"}`
      : `'${L.col}' is missing in ${L.missing} row${L.missing === 1 ? "" : "s"}`
  ));
  const more = losses.length - shown.length;
  const anyText = losses.some(L => L.nonNumeric > L.missing);
  const fix = anyText
    ? " Cast that column to numeric in Clean → Formatting."
    : losses.length
      ? " Drop those rows with an 'is not null' filter in Clean, or remove that regressor."
      // Only the weight column is at fault: the values are not null, they are
      // non-positive, so neither an is-not-null filter nor dropping a regressor applies.
      : " WLS drops rows whose weight is not strictly positive — check the weight column, or run OLS.";
  if (badW) shown.push(`'${weightCol}' is zero or negative in ${badW} row${badW === 1 ? "" : "s"}`);
  return ` ${shown.join("; ")}${more > 0 ? `; and ${more} more column${more === 1 ? "" : "s"}` : ""}.${shown.length ? fix : ""}`;
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

  const allCols = weightCol ? [yCol, ...xCols, weightCol] : [yCol, ...xCols];
  const why = _lossSentence(rows, allCols, weightCol);

  if (n === 0) {
    return `No usable rows remain.${why || ` Check filters and column types for '${yCol}'.`}`;
  }
  if (n < k + 2) {
    return `Only ${n} of ${rows.length} row${rows.length === 1 ? "" : "s"} are usable — need at least ${k + 2} to estimate ${k} parameter${k === 1 ? "" : "s"}.${why} Otherwise loosen filters or reduce regressors.`;
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
