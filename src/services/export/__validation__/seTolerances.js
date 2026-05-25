// ─── LITUX · services/export/__validation__/seTolerances.js ──────────────────
// Tolerance registry for known numerical divergences between EconSolver's math
// engines and the R / Stata / Python replication scripts it emits.
//
// Used by the golden-file harness (Phase A.2) to decide whether a numeric diff
// is a real failure or an expected deviation from a known implementation gap.
//
// Standard tolerances (match engineValidation.js):
//   Coefficients : 1e-5  (5 decimal places — conservative vs R 6dp target)
//   Standard errors: 1e-3  (3 decimal places)
//   p-values, F-stat: 1e-3
//   R²           : 1e-4
//
// Known-divergent cells are tolerated at 1e-2 on SE (or coef where noted).

// ─── Default tolerances ────────────────────────────────────────────────────────

export const DEFAULT = {
  coef:  1e-5,
  se:    1e-3,
  pval:  1e-3,
  r2:    1e-4,
};

// ─── Known-divergence table ────────────────────────────────────────────────────
//
// Each entry describes ONE known source of numeric disagreement between
// EconSolver's output and what the emitted replication script produces.
//
// Shape:
//   {
//     id:        string   — unique slug
//     estimators: string[] — estimator type(s) affected ("*" = all)
//     languages:  string[] — "R" | "Stata" | "Python" | "*"
//     seTypes:    string[] — "classical" | "HC1" | "HC2" | "HC3" |
//                            "clustered" | "twoway" | "HAC" | "*"
//     tolerance:  { coef?, se?, pval? }   — relaxed limits for this cell
//     severity:   "warn" | "skip"
//                   warn  = run the check, log the diff, don't fail the suite
//                   skip  = don't attempt numeric comparison for this cell
//     note:       string   — human-readable explanation + ticket/reference
//   }

export const KNOWN_DIVERGENCES = [
  // ── 1. RDD / Fuzzy RDD — Stata rdrobust bias-correction df ──────────────────
  {
    id:         "rdd-stata-df",
    estimators: ["RDD", "FuzzyRDD"],
    languages:  ["Stata"],
    seTypes:    ["*"],
    tolerance:  { coef: 1e-2, se: 1e-2 },
    severity:   "warn",
    note: `Stata's rdrobust uses a different bias-correction effective degrees of
freedom than R's rdrobust (MSE-optimal vs CK2014 robust). LATE point estimates
typically match to 1e-2; SE diverges more. Tolerated at 1e-2 on both coef and SE.
Reference: Calonico, Cattaneo & Titiunik (2014) — rdrobust documentation §3.`,
  },

  // ── 2. RDD Python — manual WLS fallback vs rdrobust ─────────────────────────
  {
    id:         "rdd-python-wls-fallback",
    estimators: ["RDD", "FuzzyRDD"],
    languages:  ["Python"],
    seTypes:    ["*"],
    tolerance:  { coef: 1e-3, se: 1e-2 },
    severity:   "warn",
    note: `When rdrobust Python package is unavailable, the emitted script falls back
to manual local-linear WLS (smf.wls) with HC3 SE. HC3 and rdrobust's robust SE
use different small-sample adjustments. Coef matches well (1e-3); SE may diverge
up to 1e-2 depending on sample size and bandwidth.`,
  },

  // ── 3. Panel FE / TWFE — HC2/HC3 leverage-based SE ─────────────────────────
  {
    id:         "panel-hc23-leverage",
    estimators: ["FE", "FD", "TWFE"],
    languages:  ["*"],
    seTypes:    ["HC2", "HC3"],
    tolerance:  { se: 1e-3 },
    severity:   "warn",
    note: `HC2/HC3 leverage-based meat differs slightly across implementations:
- EconSolver (duckdbWithinHC23): h_ii computed from X̃'Ainv X̃ inline in SQL
- R clubSandwich::vcovCR: uses projected leverage on within-transformed design
- R plm::vcovHC: uses within-residuals leverage approximation
All three are mathematically equivalent in large samples. Tolerance 1e-3 on SE
matches fase4bBenchmarks.json acceptance criterion.`,
  },

  // ── 4. Panel — Driscoll-Kraay HAC ───────────────────────────────────────────
  {
    id:         "panel-dk-hac",
    estimators: ["FE", "FD", "TWFE"],
    languages:  ["*"],
    seTypes:    ["HAC"],
    tolerance:  { se: 1e-3 },
    severity:   "warn",
    note: `Driscoll-Kraay HAC differs between EconSolver and R plm::vcovSCC in the
small-sample df adjustment applied to the Newey-West Bartlett sum.
EconSolver: auto-bandwidth L = floor(4·(T/100)^(2/9)), Bartlett kernel in JS.
plm::vcovSCC: uses the same auto-bandwidth formula but applies n/(n-k) scaling.
Typical SE disagreement: < 1e-3. Tolerance matches fase4bBenchmarks.json.`,
  },

  // ── 5. Synthetic Control — Frank-Wolfe vs nested optimization ───────────────
  {
    id:         "synth-fw-vs-nested",
    estimators: ["SyntheticControl"],
    languages:  ["*"],
    seTypes:    ["*"],
    tolerance:  { coef: 1e-2, se: 1e-2 },
    severity:   "warn",
    note: `EconSolver uses Frank-Wolfe projected gradient for donor weights.
R Synth::synth uses a nested two-level optimization:
  outer: Nelder-Mead/BFGS minimizing pre-period outcome MSPE over predictor
         importance weights V
  inner: ipop quadratic program finding donor weights W given V
The two algorithms converge to the same solution only when V is diagonal and
predictors are orthogonal. In practice, weight differences are ~1e-2.
Stata synth / Python pysynth use the same nested algorithm as R Synth.
Tolerated at 1e-2 on all coefficient cells (donor weights + gap series).
See ClaudePlan.md §5.5 for the pending ipop-in-JS fix.`,
  },

  // ── 6. Two-way clustered SE (CGM) — small-sample correction ─────────────────
  {
    id:         "twoway-cgm-correction",
    estimators: ["*"],
    languages:  ["*"],
    seTypes:    ["twoway"],
    tolerance:  { se: 1e-3 },
    severity:   "warn",
    note: `Cameron-Gelbach-Miller two-way clustering: EconSolver applies
G1/(G1-1)·(n-1)/(n-k) and G2/(G2-1)·(n-1)/(n-k) corrections independently
then subtracts V_12 (intersection cluster meat, unscaled). R sandwich::vcovCL
with type="HC1" uses a slightly different correction order. Tolerance 1e-3.`,
  },

  // ── 7. WLS — unweighted vs weighted R² ──────────────────────────────────────
  {
    id:         "wls-r2-definition",
    estimators: ["WLS", "RDD", "FuzzyRDD", "SpatialRDD"],
    languages:  ["*"],
    seTypes:    ["*"],
    tolerance:  { r2: 1e-2 },
    severity:   "warn",
    note: `EconSolver reports unweighted R² for WLS (SSR from unweighted residuals)
matching R lm() with weights. Some Python/Stata equivalents report weighted R².
R² comparisons for WLS-family estimators tolerated at 1e-2.`,
  },
];

// ─── Lookup helpers ────────────────────────────────────────────────────────────

/**
 * Return all KNOWN_DIVERGENCES entries that apply to a given
 * (estimatorType, language, seType) triple.
 *
 * @param {string} estimatorType  e.g. "RDD", "FE", "SyntheticControl"
 * @param {string} language       "R" | "Stata" | "Python"
 * @param {string} [seType]       e.g. "classical" | "HC2" | "HAC" — optional
 * @returns {Array} matching divergence entries
 */
export function getKnownDivergences(estimatorType, language, seType = "classical") {
  return KNOWN_DIVERGENCES.filter(d => {
    const estMatch  = d.estimators.includes("*") || d.estimators.includes(estimatorType);
    const langMatch = d.languages.includes("*")  || d.languages.includes(language);
    const seMatch   = d.seTypes.includes("*")    || d.seTypes.includes(seType);
    return estMatch && langMatch && seMatch;
  });
}

/**
 * Return the effective tolerance for a given (estimatorType, language, seType)
 * combination. If multiple divergence entries match, the most permissive
 * (largest) tolerance wins for each field.
 *
 * @returns {{ coef: number, se: number, pval: number, r2: number }}
 */
export function getTolerance(estimatorType, language, seType = "classical") {
  const matches = getKnownDivergences(estimatorType, language, seType);
  return {
    coef: Math.max(DEFAULT.coef, ...matches.map(d => d.tolerance?.coef ?? 0)),
    se:   Math.max(DEFAULT.se,   ...matches.map(d => d.tolerance?.se   ?? 0)),
    pval: Math.max(DEFAULT.pval, ...matches.map(d => d.tolerance?.pval ?? 0)),
    r2:   Math.max(DEFAULT.r2,   ...matches.map(d => d.tolerance?.r2   ?? 0)),
  };
}

/**
 * Returns true if ANY known divergence entry for this triple has severity
 * "skip" — meaning numeric comparison should be omitted entirely.
 */
export function shouldSkip(estimatorType, language, seType = "classical") {
  return getKnownDivergences(estimatorType, language, seType)
    .some(d => d.severity === "skip");
}

/**
 * Convenience: check whether a numeric difference is within tolerance.
 *
 * @param {"coef"|"se"|"pval"|"r2"} field
 * @param {number} got    — EconSolver value
 * @param {number} want   — reference (R/Stata/Python) value
 * @param {string} estimatorType
 * @param {string} language
 * @param {string} [seType]
 * @returns {{ pass: boolean, diff: number, tol: number, divergenceIds: string[] }}
 */
export function checkValue(field, got, want, estimatorType, language, seType = "classical") {
  const tols   = getTolerance(estimatorType, language, seType);
  const tol    = tols[field] ?? DEFAULT[field];
  const diff   = Math.abs(got - want);
  const pass   = diff <= tol;
  const divIds = getKnownDivergences(estimatorType, language, seType).map(d => d.id);
  return { pass, diff, tol, divergenceIds: divIds };
}

// ─── Dev helper: print tolerance table ────────────────────────────────────────

export function printToleranceTable() {
  const estimators = [
    "OLS","WLS","FE","FD","TWFE","DiD","2SLS",
    "RDD","FuzzyRDD","SpatialRDD","McCrary",
    "Logit","Probit","GMM","LIML","LSDV",
    "PoissonFE","EventStudy","SyntheticControl",
  ];
  const languages = ["R", "Stata", "Python"];
  const seTypes   = ["classical", "HC1", "HC2", "HC3", "clustered", "twoway", "HAC"];

  console.group("%cseTolerances — effective SE tolerances", "color:#6ec8b4;font-weight:bold");
  for (const est of estimators) {
    for (const lang of languages) {
      const nonDefault = seTypes.filter(se => {
        const t = getTolerance(est, lang, se);
        return t.coef !== DEFAULT.coef || t.se !== DEFAULT.se;
      });
      if (nonDefault.length) {
        nonDefault.forEach(se => {
          const t = getTolerance(est, lang, se);
          const ids = getKnownDivergences(est, lang, se).map(d => d.id).join(", ");
          console.log(`${est} / ${lang} / ${se}  →  coef=${t.coef}  se=${t.se}  [${ids}]`);
        });
      }
    }
  }
  console.groupEnd();
}

// Auto-attach to window when loaded in browser
if (typeof window !== "undefined") {
  window.__seTolerances = { getTolerance, getKnownDivergences, shouldSkip, checkValue, printToleranceTable, KNOWN_DIVERGENCES, DEFAULT };
  console.log("[seTolerances] Ready — window.__seTolerances.printToleranceTable() to see all overrides.");
}
