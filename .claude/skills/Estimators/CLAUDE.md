# CLAUDE.md — Litux Estimator Rules

You are working on Litux estimator engines.

## Non-negotiable rules

1. Do not implement or modify estimator mathematics without reading the estimator spec.
2. Do not put estimator mathematics in React components.
3. Do not silently change defaults.
4. Do not drop observations without returning diagnostics explaining why.
5. Do not change golden tests merely to make implementation pass.
6. Prefer auditable code over clever code.
7. Every estimator must return or be adapted to `ModelResult`.

## Current engine boundaries

- `calcEngine.js`: numerical utilities, probability functions, root solvers, derivatives.
- `NonLinearEngine.js`: logit, probit, Poisson/PPML.
- `GMMEngine.js`: linear IV-GMM and LIML.
- `CausalEngine.js`: IV, RDD, Fuzzy RDD, McCrary.

## Required workflow

For every estimator:

1. Write/confirm `math.md`.
2. Write/confirm `algorithm.md`.
3. Write/confirm `tests.md`.
4. Implement numerical core.
5. Compare against R/Stata/Python.
6. Add `normalizeModelResult()` adapter.
7. Only then connect to UI.

## First task Claude Code should do

Create adapters that normalize current outputs from:

- `runLogit`
- `runProbit`
- `runPoissonFE`
- `runGMM`
- `runLIML`
- `run2SLS`
- `runSharpRDD`
- `runFuzzyRDD`
- `runMcCrary`

into the global `ModelResult` shape.

## Second task Claude Code should do

Create golden tests using small deterministic datasets and reference output generated from R/Stata/Python.

Do not implement new estimators until these tests exist.
