// ─── ECON STUDIO · src/math/SpatialRDDEngine.js ───────────────────────────────
// Spatial Regression Discontinuity (Keele & Titiunik 2015).
// Geographic RD where treatment is determined by which side of a boundary a
// unit sits on, and the running variable is distance to that boundary.
//
// Algebra is identical to Sharp RDD — only the running variable is geographic
// distance instead of a univariate score. We therefore re-use runSharpRDD from
// CausalEngine.js after constructing a signed running variable.
//
// ─── Derivation ───────────────────────────────────────────────────────────────
//   Y_i = α + τ·D_i + β₁·d̃_i + β₂·D_i·d̃_i + γ'X_i + u_i,        i ∈ {|d̃_i| ≤ h}
//
//   τ        = LATE at the boundary (coefficient on D)
//   d̃_i      = signed distance to boundary (positive on treated side)
//   D_i      = 1 iff unit i is on the treated side of the boundary
//   K(u)     = triangular (1−|u|)₊ (default) or uniform 1{|u|≤1}
//   w_i      = K(d̃_i / h)
//
//   β̂ = (X'WX)⁻¹ X'WY  with X ∈ ℝ^{n × (4+p)}, W = diag(w)
//   Var(β̂) = (X'X)⁻¹ Ω̂ (X'X)⁻¹   (sandwich; HC1 default via seOpts)
//
//   Bandwidth h: user-supplied, or Imbens-Kalyanaraman optimal (ikBandwidth on
//   the signed running variable, cutoff = 0). Kernel: triangular | uniform.
//
// ─── Sign convention ──────────────────────────────────────────────────────────
//   The caller passes BOTH:
//     - distCol      : unsigned (or signed) distance-to-boundary column
//     - treatmentCol : 0/1 indicator for the treated side of the boundary
//   We construct the canonical signed running variable internally:
//     d̃_i = (2·D_i − 1) · |dist_i|
//   so positive ⇒ treated side, negative ⇒ control side, cutoff = 0.
//   If distCol is already signed, |dist_i| collapses to |dist_i| but treatment
//   is recovered from treatmentCol — the two are kept consistent by design.
//
// No React. No side effects. Depends only on CausalEngine.js + LinearEngine.js.

import { runSharpRDD, ikBandwidth, runMcCrary } from "./CausalEngine.js";

// ─── Input validation helper ──────────────────────────────────────────────────
function assertColumns(rows, cols) {
  if (!Array.isArray(rows) || rows.length === 0)
    throw new Error("runSpatialRDD: rows is empty or not an array.");
  const sample = rows[0];
  for (const c of cols) {
    if (!(c in sample))
      throw new Error(`runSpatialRDD: column "${c}" not found in dataset.`);
  }
}

// ─── PUBLIC API ───────────────────────────────────────────────────────────────
/**
 * Spatial Regression Discontinuity.
 *
 * @param {Object}   args
 * @param {Object[]} args.rows         — dataset rows
 * @param {string}   args.y            — outcome column
 * @param {string}   args.dist         — distance-to-boundary column (unsigned or signed)
 * @param {string}   args.treatment    — 0/1 column flagging the treated side of the boundary
 * @param {string[]} [args.covariates] — optional control columns
 * @param {number}   [args.bandwidth]  — manual bandwidth h; null → IK auto-bandwidth
 * @param {string}   [args.kernel]     — "triangular" (default) | "uniform" | "epanechnikov"
 * @param {Object}   [args.seType]     — SE type: "classical" | "HC0" | "HC1" | "HC2" | "HC3"
 *                                       | "clustered" | "twoway" | "HAC"
 *                                       (alternatively pass full seOpts object)
 * @param {Object}   [args.seOpts]     — full SE options object (overrides seType)
 * @param {boolean}  [args.runMcCraryTest] — also run McCrary density test on signed running var
 * @returns {Object} EstimationResult-compatible engine output (consumed by wrapResult("RDD")).
 */
export function runSpatialRDD({
  rows,
  y,
  dist,
  treatment,
  covariates = [],
  bandwidth = null,
  kernel = "triangular",
  seType = "HC1",
  seOpts = null,
  polyOrder = 1,
  runMcCraryTest = false,
} = {}) {
  // ── 1. Input validation ─────────────────────────────────────────────────────
  if (!y)         throw new Error("runSpatialRDD: outcome column 'y' is required.");
  if (!dist)      throw new Error("runSpatialRDD: distance column 'dist' is required.");
  if (!treatment) throw new Error("runSpatialRDD: treatment-side indicator column 'treatment' is required.");
  assertColumns(rows, [y, dist, treatment, ...covariates]);

  // ── 2. Filter to valid numeric rows ─────────────────────────────────────────
  const valid = rows.filter(r =>
    typeof r[y]         === "number" && isFinite(r[y]) &&
    typeof r[dist]      === "number" && isFinite(r[dist]) &&
    typeof r[treatment] === "number" && isFinite(r[treatment]) &&
    (r[treatment] === 0 || r[treatment] === 1) &&
    covariates.every(c => typeof r[c] === "number" && isFinite(r[c]))
  );
  if (valid.length < 10)
    throw new Error(`runSpatialRDD: only ${valid.length} valid rows after filtering — need ≥ 10.`);

  // ── 3. Check treatment variation ────────────────────────────────────────────
  const nTreated = valid.filter(r => r[treatment] === 1).length;
  const nControl = valid.length - nTreated;
  if (nTreated < 3 || nControl < 3)
    throw new Error(`runSpatialRDD: insufficient variation in treatment — ${nTreated} treated vs ${nControl} control (need ≥ 3 each).`);

  // ── 4. Construct signed running variable ─────────────────────────────────────
  // d̃_i = (2·D_i − 1)·|dist_i|  ⇒  positive on treated side, cutoff = 0.
  const RUN = "__spatialRDD_running__";
  const enriched = valid.map(r => ({
    ...r,
    [RUN]: (2 * r[treatment] - 1) * Math.abs(r[dist]),
  }));

  // ── 5. Bandwidth selection ──────────────────────────────────────────────────
  // Default: IK optimal bandwidth on the signed running variable, cutoff = 0.
  const runVals = enriched.map(r => r[RUN]);
  const yVals   = enriched.map(r => r[y]);
  const h = (bandwidth != null && isFinite(bandwidth) && bandwidth > 0)
    ? Number(bandwidth)
    : ikBandwidth(runVals, yVals, 0);

  if (!isFinite(h) || h <= 0)
    throw new Error("runSpatialRDD: bandwidth selection failed — check that the distance column has spread.");

  // ── 6. Resolve seOpts (CLAUDE.md invariant: seType is always a parameter) ───
  const resolvedSEOpts = seOpts ?? { seType: seType ?? "HC1" };

  // ── 7. Delegate to Sharp RDD on the signed running variable ──────────────────
  // Sharp RDD does:
  //   X = [1, D, (running − c), D·(running − c), ...controls]
  //   β̂ = (X'WX)⁻¹ X'WY,   W = diag(K(·))
  // and threads seOpts through to its internal runWLS — matching what we need.
  const sharp = runSharpRDD(
    enriched,
    y,
    RUN,            // signed running variable
    0,              // cutoff
    h,
    kernel,
    covariates,
    resolvedSEOpts,
    polyOrder,
  );

  if (!sharp || sharp.error) {
    throw new Error(`runSpatialRDD: Sharp RDD core failed${sharp?.error ? " — " + sharp.error : ""}.`);
  }

  // ── 8. Optional McCrary density test on the signed running var ──────────────
  const mcCrary = runMcCraryTest ? runMcCrary(enriched, RUN, 0) : null;

  // ── 9. Return EstimationResult-compatible engine output ──────────────────────
  // Keep the shape that wrapResult("RDD", ...) expects (see EstimationResult.js
  // wrapRDD: needs beta/se/tStats/pVals/R2/n/df/varNames/late/lateSE/lateP +
  // rddData: valid/xc/D/Y/W/leftFit/rightFit/cutoff/h/kernelType).
  // We append spatial-specific metadata for the UI without breaking the contract.
  //
  // runSharpRDD labelled its varNames using the internal signed-running-variable
  // key (RUN), since that's the only column name it knows — swap it back out for
  // the user's actual distance column, and name the treatment coefficient after
  // the real treatment-side column too.
  const relabel = v => v.split(RUN).join(`${dist} (signed)`).replace(/^D \(treatment\)$/, `${treatment} (treatment)`);

  return {
    ...sharp,
    varNames: (sharp.varNames ?? []).map(relabel),
    // Spatial RD specific:
    isSpatialRDD: true,
    distCol:      dist,
    treatmentCol: treatment,
    runningCol:   RUN,
    nTreated,
    nControl,
    mcCrary,
    // ensure aliases survive for downstream plot/table code
    kernelType: kernel,
    bandwidth:  h,
  };
}

export default runSpatialRDD;
