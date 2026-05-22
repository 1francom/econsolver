# Litux Estimators

Litux estimator engines implement econometric, statistical, and numerical methods used by the application.

This folder is the contract between mathematical theory, numerical implementation, validation tests, and the React UI.

> **Last updated:** 2026-05-18 — aligned with the actual contents of `src/math/` and the validation status recorded in the project `CLAUDE.md`.

## Core rule

React components may call estimators, but estimator mathematics must live in pure engine modules under `src/math/`. No React, no JSX, no DOM access in any engine file.

## Current engine inventory

All paths are under `src/math/`.

| File | Role | Validation status (vs R) |
|---|---|---|
| `LinearEngine.js` | OLS, WLS, matrix algebra, diagnostics, export helpers | ✓ OLS validated to 6dp coef / 4dp SE |
| `PanelEngine.js` | FE (within), FD, TWFE, 2×2 DiD, Event Study, LSDV | ✓ FE validated vs `fixest::feols`; TWFE/DiD covered |
| `CausalEngine.js` | 2SLS/IV, Sharp RDD, Fuzzy RDD, McCrary density, IK bandwidth | ✓ 2SLS vs `AER::ivreg`; Sharp RDD vs `rdrobust`; Fuzzy RDD SE still pending external check |
| `NonLinearEngine.js` | Logit, Probit (IRLS/Newton-Raphson MLE), McFadden R², MEM, PoissonFE | ✓ Logit/Probit vs base `glm()`; PoissonFE pending validation vs `fixest::fepois` |
| `GMMEngine.js` | Two-step efficient linear IV-GMM, LIML, Hansen J, first-stage F | ✓ validated vs R `gmm` (6dp coef, 4dp SE); just-id + overid cases |
| `SyntheticControlEngine.js` | Frank-Wolfe synthetic control, placebo inference | ✓ validated vs R `Synth` (weights 2dp, gaps 2dp) |
| `SpatialEngine.js` | Haversine/Euclidean distance, buffer assign, grid assign (rect + H3), spatial join, nearest-neighbor | Spatial primitives — no estimator semantics |
| `timeSeries.js` | Time series utilities (lags, differences, autocorrelation helpers) | Utilities only |
| `calcEngine.js` | Numerical utilities: root solvers (Brent, auto-bracket), Newton-Raphson systems, central-diff derivatives, composite Simpson integration, normal/t/binomial/poisson/chi-squared distributions | Distribution functions need golden-test grid vs R |
| `EstimationResult.js` | Canonical result wrapper (`wrapOLS`, `wrapFE`, `wrapIV`, `wrapRDD`, `wrapLogit`, `wrapProbit`, `wrapGMM`, `wrapSC`, etc.) consumed by the UI | — |
| `symbolicDiff.js` | Symbolic differentiation helper for nonlinear engines | — |
| `index.js` | Barrel export for all engines | — |
| `__validation__/engineValidation.js` | Hard benchmark cases checked against R reference output | Source of truth for "validated" claims above |

## Required estimator lifecycle

Every new estimator (and every change to existing math) must move through these stages in order:

1. Mathematical specification → `<estimator>/math.md`
2. Numerical algorithm → `<estimator>/algorithm.md`
3. Output schema → conforms to the canonical shape (see below)
4. Reference implementation comparison → R / Stata / Python output stored under `__validation__/`
5. Edge-case tests → `<estimator>/tests.md` + `__validation__/engineValidation.js`
6. UI interpretation layer → only after stages 1–5 pass

## Global validation standard

Every estimator must be validated against at least one mature implementation:

- R / CRAN — `fixest`, `plm`, `rdrobust`, `AER`, `gmm`, `Synth`, base `glm`, `lm`
- Python — `statsmodels`, `linearmodels`, `pyfixest`, `rdrobust`, `pysyncon`
- Stata — `regress`, `reghdfe`, `xtreg`, `ivreg2`, `rdrobust`, `csdid`, `synth`, `ppmlhdfe`

Default tolerances:

| Quantity | Tolerance |
|---|---:|
| Coefficients | `1e-6` |
| Standard errors | `1e-5` |
| Variance-covariance matrix | `1e-5` |
| p-values | `1e-4` |
| Fitted values | `1e-6` |
| Log-likelihood | `1e-6` |

The project `CLAUDE.md` states a slightly looser working rule (6dp coef, 4dp SE) for routine validation runs; tighten to the table above for golden benchmarks committed to `__validation__/engineValidation.js`.

## Canonical result schema

The shape every engine must conform to via `EstimationResult.js` wrappers. This is the contract between math and UI — any field marked required must be populated (use `?? null` / `?? []` for nullable cases).

```ts
export type ModelResult = {
  // Identity
  estimator: string;             // "OLS" | "WLS" | "FE" | "FD" | "TWFE" | "DiD" | "2SLS" | "SharpRDD" | "FuzzyRDD" | "Logit" | "Probit" | "PoissonFE" | "GMM" | "LIML" | "SyntheticControl" | ...
  formula?: string | null;

  // Coefficients and inference
  varNames: string[];
  beta: number[];
  se: number[];
  vcov?: number[][] | null;
  testStats: number[];           // t, z, F, or χ² depending on estimator
  testStatLabel: "t" | "z" | "F" | "χ²";
  pVals: number[];
  ci95?: Array<[number, number]> | null;

  // Goodness of fit
  R2?: number | null;
  adjR2?: number | null;
  Fstat?: number | null;
  Fpval?: number | null;
  logLik?: number | null;

  // Sample
  n: number;
  k?: number | null;
  df?: number | null;

  // Diagnostics + residuals
  resid?: number[] | null;
  Yhat?: number[] | null;
  diagnostics?: Record<string, unknown>;
  warnings?: string[];

  // Convergence (iterative estimators)
  convergence?: {
    converged: boolean | null;
    iterations: number | null;
    tolerance: number | null;
  };

  // Validation traceability
  validation?: {
    referencePackage: string | null;   // e.g. "fixest", "rdrobust"
    referenceFunction: string | null;  // e.g. "feols", "rdrobust"
    status: "passed" | "failed" | "untested";
  };
};
```

`testStatLabel` is what drives `ReportingModule.jsx → buildStargazer()` header rows. Picking the wrong label is the most common visible bug after adding an estimator — get it right at the wrapper, not the UI.

## Folder layout

```
.claude/skills/Estimators/
├── CLAUDE.md                       ← non-negotiable rules for working on engines
├── README.md                       ← this file (the contract)
├── Estimator-guide.json            ← formal spec: folder structure, schemas, per-estimator algorithms
├── litux-estimators-audit.json     ← per-engine audit notes (risks, missing pieces)
├── common/                         ← cross-estimator utilities + shared math
├── gmm/                            ← gmm_R.pdf, momentfit.pdf, plm_R.pdf
├── poisson/                        ← fixest.pdf, plm_R.pdf, Osgood 2000, feglm notes
├── rdd/                            ← rdrobust + Calonico-Cattaneo-Titiunik papers, rdplot illustration
├── synthetic-control/              ← synth.R + grab/plot/main methods, synthetic_control.pdf
├── staggered-did/                  ← (empty — populate before implementing CS / Sun-Abraham)
└── twfe/                           ← (empty — populate before implementing HDFE / multi-way FE)
```

Empty subfolders are deliberate gates: the `add-estimator` and `improve-estimator` skills will refuse to proceed when the relevant subfolder is empty.

## Backlog (current state, 2026-05-18)

Done:
- [x] `normalizeModelResult()` adapters for current engines (`EstimationResult.js` covers all currently-shipped estimators)
- [x] RDD validation against `rdrobust` in R (hard benchmarks in `__validation__/engineValidation.js`)
- [x] Synthetic Control (Frank-Wolfe) with placebo inference — validated vs R `Synth`
- [x] GMM / LIML validated vs R `gmm` (just-id + overid)
- [x] Logit / Probit validated vs base R `glm`

Open:
1. **Golden tests for `calcEngine.js` distributions** — grid vs R for normal, t, chi², F, binomial, poisson. Currently only sanity-checked.
2. **Poisson family split** — separate `poisson_mle`, `poisson_ppml`, `poisson_fe` (currently only `PoissonFE`). Validate vs `fixest::fepois` and `ppmlhdfe`.
3. **TWFE / HDFE diagnostics layer** — TWFE estimation works; need explicit absorbed-FE reporting, singleton detection, and the "already-treated-as-control" warning required by `Estimator-guide.json`.
4. **Callaway-Santanna and Sun-Abraham staggered DiD** — only after TWFE diagnostics ship. Populate `staggered-did/` with math.md + algorithm.md first.
5. **Convex optimization utility** — required prerequisite for any extension beyond classic Synthetic Control (augmented SC, penalized SC).
6. **Fuzzy RDD SE** — needs explicit validation vs `rdrobust` Fuzzy mode in R + Stata.
7. **HAC weighting in GMM** — currently no HAC weighting matrix exposed.

## How to consume this folder

- Use the **`add-estimator` skill** when wiring a brand-new estimator end-to-end.
- Use the **`improve-estimator` skill** for any math change to an existing engine.

Both skills require reading `CLAUDE.md`, this `README.md`, and `Estimator-guide.json` before touching code, then the specific subfolder for the estimator in scope.
