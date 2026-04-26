// ─── ECON STUDIO · services/ai/LocalAI.js ─────────────────────────────────────
// Zero-cost closed algorithms — no API calls, no token cost.
// Pure JS. No React, no external imports.
//
// Exports:
//   normalizeStrings(values, rowsForFreq?)  → { clusters, map }
//   detectPII(rows, headers)               → PIIFlag[]
//   inferMissingStrategy(col, colStats)    → { strategy, rationale }
//   scoreOutliers(values)                  → OutlierScore
//   suggestColumnType(values)              → TypeSuggestion

// ─── 1. STRING NORMALIZATION ──────────────────────────────────────────────────
// Levenshtein-based fuzzy clustering for categorical columns.
// Identical logic to utils.js fuzzyGroups — self-contained here so services/
// never imports from components/.
//
// Returns:
//   clusters: [{ members: string[], canonical: string }]
//   map:      Record<string, string>  (variant → canonical, 1:1)

function _levenshtein(a, b, maxD = 6) {
  if (Math.abs(a.length - b.length) > maxD) return maxD + 1;
  const m = a.length, n = b.length;
  let prev = Array.from({ length: n + 1 }, (_, i) => i);
  for (let i = 1; i <= m; i++) {
    const cur = [i];
    for (let j = 1; j <= n; j++) {
      cur[j] = a[i - 1] === b[j - 1]
        ? prev[j - 1]
        : 1 + Math.min(prev[j], cur[j - 1], prev[j - 1]);
    }
    prev = cur;
  }
  return prev[n];
}

function _normStr(s) {
  return String(s || "").trim().toLowerCase().replace(/\s+/g, " ");
}

// Two strings that differ only in their trailing number are distinct categories.
// "comuna 1" vs "comuna 2" must never be grouped.
function _numericVariants(a, b) {
  const pat = s => { const m = s.match(/^(.*\D)\s*(\d+)\s*$/); return m ? [m[1].trim(), m[2]] : null; };
  const pa = pat(a), pb = pat(b);
  if (!pa || !pb) return false;
  return pa[0] === pb[0] && pa[1] !== pb[1];
}

export function normalizeStrings(values, rowsForFreq = null) {
  const freq = {};
  if (rowsForFreq) {
    rowsForFreq.forEach(v => {
      if (v != null) { const s = String(v); freq[s] = (freq[s] || 0) + 1; }
    });
  }

  const norm = values.map(_normStr);
  const visited = new Array(values.length).fill(false);
  const clusters = [];

  for (let i = 0; i < values.length; i++) {
    if (visited[i]) continue;
    const group = [i];
    visited[i] = true;
    for (let j = i + 1; j < values.length; j++) {
      if (visited[j]) continue;
      if (_numericVariants(norm[i], norm[j])) continue;
      const isSub = norm[i].includes(norm[j]) || norm[j].includes(norm[i]);
      const d = isSub ? 0 : _levenshtein(norm[i], norm[j]);
      if (d === 0 || d <= Math.max(2, Math.floor(norm[i].length * 0.25))) {
        group.push(j);
        visited[j] = true;
      }
    }
    if (group.length > 1) {
      const members = group.map(k => values[k]);
      // Canonical: prefer highest frequency, then title-case, then longest
      let canonical = members[0], bestScore = -1;
      members.forEach(m => {
        const f = freq[m] || 0;
        const isTitleCase = m === m.replace(/\b\w/g, c => c.toUpperCase()).replace(/\B\w/g, c => c.toLowerCase());
        const score = f * 100 + (isTitleCase ? 50 : 0) + m.length;
        if (score > bestScore) { bestScore = score; canonical = m; }
      });
      clusters.push({ members, canonical });
    }
  }

  const map = {};
  clusters.forEach(cl => { cl.members.forEach(m => { map[m] = cl.canonical; }); });

  return { clusters, map };
}

// ─── 2. PII DETECTION ────────────────────────────────────────────────────────
// Regex-based scan over column values.
// Never sends data to any external service — purely local pattern matching.
//
// Returns PIIFlag[]:
//   { col, matchType, sampleHits: string[], hitCount, confidence: 'high'|'medium'|'low' }

const PII_PATTERNS = [
  {
    type:  "email",
    regex: /^[A-Z0-9._%+\-]+@[A-Z0-9.\-]+\.[A-Z]{2,}$/i,
    confidence: "high",
  },
  {
    // E.164 international or local formats (7–15 digits, optional separators)
    type:  "phone",
    regex: /^(\+?\d[\d\s\-().]{6,18}\d)$/,
    confidence: "medium",
  },
  {
    // US SSN: XXX-XX-XXXX or XXXXXXXXX
    type:  "ssn",
    regex: /^(?!000|666|9\d{2})\d{3}[- ]?(?!00)\d{2}[- ]?(?!0{4})\d{4}$/,
    confidence: "high",
  },
  {
    // IBAN: 2 letters + 2 digits + up to 30 alphanumeric chars
    type:  "iban",
    regex: /^[A-Z]{2}\d{2}[A-Z0-9]{11,30}$/i,
    confidence: "high",
  },
  {
    // DNI / national ID patterns: 7–9 digits optionally followed by a letter
    type:  "national_id",
    regex: /^\d{7,9}[A-Z]?$/i,
    confidence: "low",
  },
  {
    // Credit card: 13–19 digit numbers (Luhn not checked — too expensive for large cols)
    type:  "credit_card",
    regex: /^(?:\d[ -]?){13,19}$/,
    confidence: "medium",
  },
];

// Heuristic: a column looks like a name if values are 2–5 whitespace-separated
// tokens, each capitalized, with no digits, and it is NOT a city/country column
// (we exclude those by checking against a short geographic stoplist).
const GEO_STOPWORDS = new Set([
  "north", "south", "east", "west", "central", "new", "old", "upper", "lower",
  "greater", "little", "saint", "san", "santa", "los", "las", "el", "la",
]);
function _looksLikeName(val) {
  const str = String(val || "").trim();
  if (!str || /\d/.test(str)) return false;
  const tokens = str.split(/\s+/);
  if (tokens.length < 2 || tokens.length > 5) return false;
  const allCap = tokens.every(t => /^[A-ZÁÉÍÓÚÑÜ][a-záéíóúñü\-']+$/.test(t));
  if (!allCap) return false;
  const hasGeo = tokens.some(t => GEO_STOPWORDS.has(t.toLowerCase()));
  return !hasGeo;
}

export function detectPII(rows, headers) {
  const flags = [];

  headers.forEach(col => {
    const vals = rows
      .map(r => r[col])
      .filter(v => v !== null && v !== undefined)
      .map(v => String(v).trim())
      .filter(Boolean);

    if (vals.length === 0) return;

    // Run regex patterns
    PII_PATTERNS.forEach(({ type, regex, confidence }) => {
      const hits = vals.filter(v => regex.test(v));
      const pct  = hits.length / vals.length;
      // Require at least 5% of values to match to flag (avoids false positives on
      // columns that happen to have one phone-like value among thousands of numbers)
      if (hits.length >= 1 && (pct >= 0.05 || hits.length >= 3)) {
        flags.push({
          col,
          matchType:   type,
          sampleHits:  hits.slice(0, 3),
          hitCount:    hits.length,
          hitPct:      parseFloat((pct * 100).toFixed(1)),
          confidence:  pct > 0.5 ? "high" : pct > 0.15 ? "medium" : confidence === "high" ? "medium" : "low",
        });
      }
    });

    // Name detection (separate — regex alone is insufficient)
    const nameHits = vals.filter(_looksLikeName);
    const namePct  = nameHits.length / vals.length;
    if (namePct >= 0.4) {
      flags.push({
        col,
        matchType:   "possible_name",
        sampleHits:  nameHits.slice(0, 3),
        hitCount:    nameHits.length,
        hitPct:      parseFloat((namePct * 100).toFixed(1)),
        confidence:  namePct > 0.75 ? "high" : "medium",
      });
    }
  });

  // Sort: high confidence first, then by hitPct desc
  flags.sort((a, b) => {
    const confRank = { high: 2, medium: 1, low: 0 };
    const diff = confRank[b.confidence] - confRank[a.confidence];
    return diff !== 0 ? diff : b.hitPct - a.hitPct;
  });

  return flags;
}

// ─── 3. INFER MISSING STRATEGY ────────────────────────────────────────────────
// Deterministic rule engine. No ML. Input: one column's stats from buildInfo().
//
// Returns: { strategy: string, rationale: string }
// strategy values match pipeline fill_na step modes:
//   'mean' | 'median' | 'mode' | 'ffill' | 'bfill' | 'drop_na' | 'constant'

const TIME_HINTS = /\b(date|year|month|quarter|period|wave|time|round|t\d*|lag|lead)\b/i;

export function inferMissingStrategy(col, colStats) {
  const { naPct = 0, isNum, isCat, mean, std, median, skewness, uCount, total } = colStats;

  // Too many missing → recommend dropping the column / rows
  if (naPct > 0.4) {
    return {
      strategy: "drop_na",
      rationale: `${(naPct * 100).toFixed(0)}% missing — imputation would inject more noise than signal; listwise deletion preferred.`,
    };
  }

  // Time / panel variables → forward-fill preserves temporal ordering
  if (TIME_HINTS.test(col)) {
    return {
      strategy: "ffill",
      rationale: `Column name suggests a time or panel variable — forward-fill preserves the temporal ordering of observations.`,
    };
  }

  if (isNum) {
    // Use skewness if available, otherwise approximate from mean vs. median
    const skew = (skewness != null)
      ? skewness
      : (mean != null && median != null && std > 0)
        ? (mean - median) / std   // Pearson's second skewness coefficient
        : 0;

    if (Math.abs(skew) > 1) {
      return {
        strategy: "median",
        rationale: `Distribution is skewed (skew ≈ ${skew.toFixed(2)}); median is robust to extremes and avoids inflating the mean.`,
      };
    }

    // Binary numeric (0/1) — mode is meaningful
    if (uCount === 2) {
      return {
        strategy: "mode",
        rationale: `Binary column (${uCount} unique values) — mode preserves the dominant class without introducing a fractional imputation.`,
      };
    }

    return {
      strategy: "mean",
      rationale: `Approximately symmetric distribution (skew ≈ ${skew.toFixed(2)}) — mean imputation is unbiased under MCAR.`,
    };
  }

  if (isCat) {
    return {
      strategy: "mode",
      rationale: `Categorical column — mode imputation assigns the most frequent category, minimising distributional distortion.`,
    };
  }

  // Fallback: categorical-like but not flagged isCat (e.g. mixed type)
  return {
    strategy: "mode",
    rationale: `Column type ambiguous — mode imputation is the safest default; verify values after imputation.`,
  };
}

// ─── 4. SCORE OUTLIERS ────────────────────────────────────────────────────────
// Pure array version of the outlier logic in dataQuality.js.
// Accepts a numeric array directly — no rows/col lookup needed.
//
// Returns: OutlierScore {
//   iqrCount, iqrPct, zCount, zPct,
//   extremeLow, extremeHigh,
//   skewness, skewLabel,
//   recommendation: 'ok'|'winsorize'|'log_transform'|'investigate'
// }

function _percentile(sorted, p) {
  const idx = p * (sorted.length - 1);
  const lo  = Math.floor(idx), hi = Math.ceil(idx);
  if (lo === hi) return sorted[lo];
  return sorted[lo] + (sorted[hi] - sorted[lo]) * (idx - lo);
}

export function scoreOutliers(values) {
  const nums = values
    .map(v => (typeof v === "string" ? parseFloat(v) : v))
    .filter(v => typeof v === "number" && isFinite(v));

  if (nums.length < 4) {
    return {
      iqrCount: 0, iqrPct: 0, zCount: 0, zPct: 0,
      extremeLow: [], extremeHigh: [],
      skewness: 0, skewLabel: "insufficient data",
      recommendation: "ok",
    };
  }

  const sorted = [...nums].sort((a, b) => a - b);
  const n      = nums.length;
  const mean   = nums.reduce((s, v) => s + v, 0) / n;
  const variance = nums.reduce((s, v) => s + (v - mean) ** 2, 0) / n;
  const std    = Math.sqrt(variance);

  const q1  = _percentile(sorted, 0.25);
  const q3  = _percentile(sorted, 0.75);
  const iqr = q3 - q1;

  const iqrLo = q1 - 1.5 * iqr;
  const iqrHi = q3 + 1.5 * iqr;

  const iqrOut = nums.filter(v => v < iqrLo || v > iqrHi);
  const zOut   = std > 0 ? nums.filter(v => Math.abs((v - mean) / std) > 3) : [];

  const skewness = std > 0
    ? nums.reduce((s, v) => s + ((v - mean) / std) ** 3, 0) / n
    : 0;
  const skewLabel = Math.abs(skewness) < 0.5 ? "symmetric"
                  : Math.abs(skewness) < 1   ? "moderately skewed"
                  : "highly skewed";

  const iqrPct = iqrOut.length / n;

  // Recommendation logic:
  // – Log transform: highly skewed with all-positive values and many IQR outliers
  // – Winsorize: moderate skew or clear outliers, values can be negative
  // – Investigate: very few outliers but z-score and IQR disagree strongly
  // – ok: clean data
  let recommendation = "ok";
  if (iqrPct > 0.01 || zOut.length > 0) {
    const allPositive = sorted[0] > 0;
    if (Math.abs(skewness) > 2 && allPositive && iqrPct > 0.02) {
      recommendation = "log_transform";
    } else if (iqrPct > 0.05 || (zOut.length > 3 && iqrPct > 0.01)) {
      recommendation = "winsorize";
    } else {
      recommendation = "investigate";
    }
  }

  return {
    iqrCount:    iqrOut.length,
    iqrPct:      parseFloat(iqrPct.toFixed(4)),
    zCount:      zOut.length,
    zPct:        parseFloat((zOut.length / n).toFixed(4)),
    extremeLow:  sorted.slice(0, 3),
    extremeHigh: sorted.slice(-3).reverse(),
    skewness:    parseFloat(skewness.toFixed(4)),
    skewLabel,
    recommendation,
  };
}

// ─── 5. SUGGEST COLUMN TYPE ───────────────────────────────────────────────────
// Heuristic type inference from raw values.
// Complements the type_cast pipeline step — tells the UI what to suggest.
//
// Returns: TypeSuggestion {
//   type:       'numeric'|'date'|'boolean'|'categorical'|'id'
//   confidence: number (0–1)
//   castable:   boolean  (true = safe to auto-cast)
//   sample:     string   (example value)
// }

const BOOL_TRUE  = new Set(["true", "yes", "1", "y", "t", "si", "sí", "ja", "oui"]);
const BOOL_FALSE = new Set(["false", "no", "0", "n", "f", "nein", "non"]);

// ISO date patterns: YYYY-MM-DD, DD/MM/YYYY, MM/DD/YYYY, YYYY
const DATE_RE = /^(\d{4}-\d{2}-\d{2}|\d{2}[\/\-]\d{2}[\/\-]\d{4}|\d{4})$/;

export function suggestColumnType(values) {
  const nonNull = values
    .filter(v => v !== null && v !== undefined)
    .map(v => String(v).trim())
    .filter(Boolean);

  if (nonNull.length === 0) {
    return { type: "categorical", confidence: 0, castable: false, sample: "" };
  }

  const n      = nonNull.length;
  const unique = new Set(nonNull);
  const sample = nonNull[0];

  // ── Numeric ──────────────────────────────────────────────────────────────
  const numericCount = nonNull.filter(v => v !== "" && isFinite(Number(v))).length;
  const numericRate  = numericCount / n;
  if (numericRate >= 0.9) {
    // ID detection: all unique AND count > 20 AND values look like integers
    const allUnique  = unique.size === n;
    const allInteger = nonNull.every(v => Number.isInteger(Number(v)));
    if (allUnique && allInteger && n > 20) {
      return { type: "id", confidence: 0.8, castable: false, sample };
    }
    return {
      type:       "numeric",
      confidence: numericRate,
      castable:   numericRate === 1,
      sample,
    };
  }

  // ── Boolean ───────────────────────────────────────────────────────────────
  const boolCount = nonNull.filter(v => BOOL_TRUE.has(v.toLowerCase()) || BOOL_FALSE.has(v.toLowerCase())).length;
  if (boolCount / n >= 0.9 && unique.size <= 3) {
    return {
      type:       "boolean",
      confidence: boolCount / n,
      castable:   boolCount === n,
      sample,
    };
  }

  // ── Date ──────────────────────────────────────────────────────────────────
  const dateCount = nonNull.filter(v => DATE_RE.test(v) && !isNaN(Date.parse(v))).length;
  if (dateCount / n >= 0.85) {
    return {
      type:       "date",
      confidence: dateCount / n,
      castable:   dateCount / n >= 0.95,
      sample,
    };
  }

  // ── ID (string-based: all unique, long values) ────────────────────────────
  if (unique.size === n && n > 20) {
    return { type: "id", confidence: 0.7, castable: false, sample };
  }

  // ── Categorical ───────────────────────────────────────────────────────────
  return {
    type:       "categorical",
    confidence: 1 - numericRate,  // higher confidence the less numeric-looking
    castable:   false,
    sample,
  };
}
