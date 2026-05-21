# Fase V3 — Simulation Tab (DGP) Validation

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans.

**Track:** B — Module hardening
**Status:** Queued.
**Blocks:** nothing.

**Goal:** Validate every data-generating process (DGP) exposed by `src/components/tabs/SimulateTab.jsx` against theoretical moments and against R-generated reference samples. Two checks per DGP:

1. **Marginal-moment check.** Sample moments at N = 1e6 match theoretical moments at 3 dp (mean, var, skew, kurtosis where applicable).
2. **Recovery check.** Estimator run on the simulated data at N = 1e5 returns β̂ such that |β̂ − β_true| < 2·SE.

**Why this matters:** the simulation surface is where users learn estimator behavior. Wrong DGP → wrong intuition. Estimators have R parity; DGPs do not.

**Tech Stack:** Mulberry32 RNG (current EconSolver PRNG), R `simstudy` and hand-coded DGPs as reference, the existing EconSolver estimator engines as recovery probes.

---

## DGPs covered

From `src/components/tabs/SimulateTab.jsx` (`DIST_OPTIONS`):

### Primitive distributions
| Distribution | EconSolver `drawSamples` branch | Theoretical moments |
|---|---|---|
| Normal | `normalSample(rng, mean, sd)` (Box-Muller) | E=mean, V=sd², skew=0, kurt=3 |
| Uniform | inverse CDF | E=(a+b)/2, V=(b-a)²/12 |
| Bernoulli | rng < p | E=p, V=p(1-p) |
| Poisson | Knuth | E=V=λ |
| Exponential | −log(U)/λ | E=1/λ, V=1/λ² |
| t | Z / √(χ²/df) | E=0 (df>1), V=df/(df-2) (df>2) |
| Chi-squared | sum of squared normals | E=df, V=2·df |
| Constant | scalar | E=c, V=0 |
| Sequence | i, i+1, …, i+n-1 | deterministic |

### Composite generators
- **Expression** — symbolic combination of named variables (uses `buildScope`).
- **ForLoop** — sequence with per-iteration expression.
- **WhileLoop** — convergence-based sequence.

### Estimator-recovery DGPs (implicit in SimulateTab Monte Carlo flow)
Users compose variables that produce data suitable for each estimator. The harness defines canonical compositions and verifies recovery.

| Estimator | DGP recipe |
|---|---|
| OLS | `y = β₀ + β₁·x₁ + β₂·x₂ + ε` with x normal, ε normal |
| WLS | OLS with per-row weights w ~ Uniform[0.5, 2] |
| 2SLS / IV | `y = α + β·D + ε`, `D = π·Z + ν`, cov(ε,ν) ≠ 0, cov(Z,ε) = 0 |
| Logit | `y = 1(Xβ + ε > 0)` with ε logistic |
| Probit | `y = 1(Xβ + ε > 0)` with ε normal |
| Poisson | `y ~ Poisson(exp(Xβ))` |
| DiD | binary post × treat with parallel-trend control |
| Event Study | staggered treatment timing with per-k effect |
| Panel FE | y_{it} = α_i + Xβ + ε_{it}, α_i correlated with X |
| RDD | y = α + β·1(r > c) + γ·r + ε, sharp at cutoff c |

---

## File Structure

**Create:**
- `src/services/data/__validation__/faseV3RValidation.R` — produces `faseV3Benchmarks.json` covering primitive distributions and recovery DGPs.
- `src/services/data/__validation__/faseV3Validation.js` — harness at `window.__validation.faseV3`.

**Modify (only if validation finds bugs):**
- `src/components/tabs/SimulateTab.jsx` (the `drawSamples`, `normalSample`, `buildScope`, `fastOLS1` helpers).
- `src/components/tabs/SimulateTab.jsx` `generateSimScript` (R/Python/Stata script export — verify it produces matching results when actually executed).

---

## Task 1 — Marginal-moment R reference

**Files:** `src/services/data/__validation__/faseV3RValidation.R`

- [ ] **Step 1: Generate 1e6 samples per distribution**

```r
set.seed(20260522)
N <- 1e6
bench <- list()

# Normal(0,1)
s <- rnorm(N, 0, 1)
bench$normal_0_1 <- list(N=N, mean=mean(s), var=var(s),
                         skew=mean((s-mean(s))^3)/sd(s)^3,
                         kurt=mean((s-mean(s))^4)/sd(s)^4)

# Uniform(2, 7)
s <- runif(N, 2, 7)
bench$uniform_2_7 <- list(N=N, mean=mean(s), var=var(s))

# Bernoulli(0.3)
s <- rbinom(N, 1, 0.3)
bench$bernoulli_0_3 <- list(N=N, mean=mean(s), var=var(s))

# Poisson(λ=4)
s <- rpois(N, 4)
bench$poisson_4 <- list(N=N, mean=mean(s), var=var(s))

# Exponential(λ=2)
s <- rexp(N, 2)
bench$exp_2 <- list(N=N, mean=mean(s), var=var(s))

# t(df=10)
s <- rt(N, 10)
bench$t_10 <- list(N=N, mean=mean(s), var=var(s))

# χ²(df=5)
s <- rchisq(N, 5)
bench$chisq_5 <- list(N=N, mean=mean(s), var=var(s))
```

These give **sample-moment** truth values. For the EconSolver harness, the assertion is "EconSolver sample moments match R sample moments at 3 dp" — both should converge to the theoretical moment, so this captures both correctness and PRNG behavior.

- [ ] **Step 2: Estimator-recovery seeds**

For each estimator DGP, persist:
- the true β vector,
- a fixed seed (so EconSolver can regenerate the same data),
- the expected β̂ ± 2·SE band from a single 1e5 R replication.

```r
# OLS recovery
N <- 1e5
beta_true <- c(1.0, 0.5, -0.3)
x1 <- rnorm(N); x2 <- rnorm(N)
y <- beta_true[1] + beta_true[2]*x1 + beta_true[3]*x2 + rnorm(N)
fit <- lm(y ~ x1 + x2)
bench$ols_recovery <- list(
  seed = 20260522, N = N, beta_true = beta_true,
  beta_hat = as.numeric(coef(fit)),
  se       = as.numeric(coef(summary(fit))[, "Std. Error"])
)

# Logit recovery
N <- 1e5
beta_true <- c(0.2, 1.0, -0.5)
x1 <- rnorm(N); x2 <- rnorm(N)
p  <- plogis(beta_true[1] + beta_true[2]*x1 + beta_true[3]*x2)
y  <- rbinom(N, 1, p)
fit <- glm(y ~ x1 + x2, family=binomial("logit"))
bench$logit_recovery <- list(
  seed = 20260522, N = N, beta_true = beta_true,
  beta_hat = as.numeric(coef(fit)),
  se       = as.numeric(coef(summary(fit))[, "Std. Error"])
)

# 2SLS recovery
N <- 1e5
beta_true <- c(0, 0.7)
Z <- rnorm(N); eps_nu <- MASS::mvrnorm(N, c(0,0), matrix(c(1,0.6,0.6,1),2,2))
D <- 0.8*Z + eps_nu[,2]
y <- beta_true[1] + beta_true[2]*D + eps_nu[,1]
fit <- AER::ivreg(y ~ D | Z)
bench$twosls_recovery <- list(
  seed = 20260522, N = N, beta_true = beta_true,
  beta_hat = as.numeric(coef(fit)),
  se = as.numeric(coef(summary(fit))[, "Std. Error"])
)

# Panel FE recovery
# DiD recovery
# Event Study recovery
# RDD recovery
# ... one block per estimator
```

- [ ] **Step 3: Persist `faseV3Benchmarks.json`**

```r
writeLines(toJSON(bench, auto_unbox=TRUE, digits=10), "faseV3Benchmarks.json")
```

---

## Task 2 — Browser harness

**Files:** `src/services/data/__validation__/faseV3Validation.js`

- [ ] **Step 1: Re-implement EconSolver-side moment checks**

The harness needs to (a) instantiate the EconSolver PRNG with a known seed, (b) draw N = 1e6 from each distribution, (c) compare sample moments to `faseV3Benchmarks.json`.

```js
import { mulberry32, normalSample, drawSamples } from "./_simInternals.js"; // export from SimulateTab

export async function runFaseV3NumericalValidation() {
  const bench = await fetchJSON("faseV3Benchmarks.json");
  const report = [];
  const N = 1e6;

  // Normal(0, 1)
  {
    const rng = mulberry32(20260522);
    const s = new Array(N);
    for (let i = 0; i < N; i++) s[i] = normalSample(rng, 0, 1);
    const moments = computeMoments(s);
    const truth   = bench.normal_0_1;
    report.push({
      cell: "normal_0_1",
      pass: Math.abs(moments.mean - truth.mean) < 5e-3
         && Math.abs(moments.var  - truth.var)  < 5e-3
         && Math.abs(moments.skew - truth.skew) < 5e-2
         && Math.abs(moments.kurt - truth.kurt) < 5e-2,
      got: moments, truth
    });
  }
  // … same for uniform, bernoulli, poisson, exp, t, chisq …

  return report;
}

function computeMoments(s) {
  const n = s.length;
  const mean = s.reduce((a,b)=>a+b,0) / n;
  const dev2 = s.map(x => (x-mean)**2);
  const variance = dev2.reduce((a,b)=>a+b,0) / (n - 1);
  const sd = Math.sqrt(variance);
  const skew = s.reduce((a,x)=>a+((x-mean)/sd)**3,0) / n;
  const kurt = s.reduce((a,x)=>a+((x-mean)/sd)**4,0) / n;
  return { mean, var: variance, skew, kurt };
}
```

**Important:** the PRNGs differ between EconSolver (mulberry32) and R (Mersenne-Twister). Sample moments converge at the same rate but **the actual draws are not comparable**. The harness compares **sample moments**, not per-draw values.

- [ ] **Step 2: Refactor `SimulateTab.jsx` internals into a sibling module**

Extract `mulberry32`, `normalSample`, `drawSamples`, `buildScope`, `fastOLS1` from `SimulateTab.jsx` into `src/components/tabs/_simInternals.js` so the harness can import them without React. **This is a small surgical refactor**, not a rewrite. Mark as Task 0 (prep) in execution.

- [ ] **Step 3: Estimator recovery checks**

For each recovery cell:

```js
// Logit recovery
{
  const seed = 20260522;
  const N = 1e5;
  const betaTrue = [0.2, 1.0, -0.5];
  const rng = mulberry32(seed);
  const data = generateLogitDGP(rng, N, betaTrue);
  // Pass data to runLogit (NonLinearEngine)
  const fit = runLogit(data, "y", ["x1", "x2"]);
  const truth = bench.logit_recovery;
  const within2SE = betaTrue.every((bt, i) =>
    Math.abs(fit.beta[i] - bt) < 2 * truth.se[i]
  );
  // Also assert agreement with R's β̂ at 2·SE
  const matchR = fit.beta.every((bh, i) =>
    Math.abs(bh - truth.beta_hat[i]) < 2 * truth.se[i]
  );
  report.push({ cell: "logit_recovery", pass: within2SE && matchR,
                got: fit.beta, truthBetaHat: truth.beta_hat, se: truth.se });
}
```

Recovery cells: OLS, WLS, 2SLS, Logit, Probit, Poisson, DiD, Event Study, Panel FE, RDD, Spatial AR (if implemented).

---

## Task 3 — Sim script export check

**Files:** `src/components/tabs/SimulateTab.jsx` `generateSimScript`

- [ ] **Step 1:** For a representative simulation (e.g. 3-variable normal/uniform/bernoulli mix), call `generateSimScript("r", n, seed, variables)` to produce an R script.
- [ ] **Step 2:** Save the script, run in actual R, capture the data.
- [ ] **Step 3:** Compare R-generated data's marginal moments to EconSolver-generated data's marginal moments at 3 dp. They should match because the script uses R's PRNG, not Mulberry32 — but the **distribution shapes** must match.
- [ ] **Step 4:** Repeat for Python and Stata scripts.

This catches script-generation bugs (e.g. wrong distribution parameter ordering, missing seed argument).

---

## Task 4 — Fix discrepancies

For each failing cell:
- [ ] Diagnose; the most likely failures:
  - Box-Muller `normalSample` may have a slight bias near tails — verify against R's `rnorm` skew/kurt.
  - Knuth Poisson may overflow for λ > 50; check large-λ cell.
  - Bernoulli p=0 or p=1 edge cases.
  - Exponential with λ ≤ 0 should throw, not silently produce −Inf.
  - `fastOLS1` (single-regressor fast OLS in SimulateTab) may diverge from `runOLS` at high n — validate via cross-check.
- [ ] Patch (surgical).
- [ ] Re-run harness.
- [ ] Document in CLAUDE.md.

---

## Task 5 — CLAUDE.md update + commits

- [ ] Add "Simulation: DGPs validated vs R / theoretical moments" to "Modules validated".
- [ ] Document fixed bugs in "Key bugs fixed".
- [ ] Commits:
  1. `refactor(simulate): extract PRNG helpers to _simInternals.js`
  2. `test(simulate): Fase V3 — R golden moments`
  3. `test(simulate): Fase V3 — browser harness`
  4. `fix(simulate): <bug N>` per bug
  5. `test(simulate): Fase V3 — R/Python/Stata script export round-trip`
  6. `docs: Fase V3 — simulation validation complete`

---

## Tolerances (summary)

| Check | Tolerance |
|---|---|
| Mean, variance | 5e-3 absolute (at N=1e6) |
| Skew, kurtosis | 5e-2 absolute (at N=1e6) |
| Estimator recovery (β̂ vs β_true) | within 2·SE |
| Estimator recovery (β̂ vs R β̂) | within 2·SE |
| Script export round-trip moments | 3 dp |

## Risks

| Risk | Mitigation |
|---|---|
| PRNG differences between Mulberry32 and R's Mersenne-Twister mean per-draw comparisons impossible | Compare moments, not draws. Document. |
| Recovery cells flaky at N=1e5 (variance > 2·SE band on rare seeds) | Use a fixed seed that produces a stable cell. Repeat at 3 seeds for robustness; require 2-of-3 pass. |
| Sim script export depends on having R/Python/Stata installed | Document; skip script tests in CI, run locally before commit. Provide a fixture-based fallback (pre-generated CSVs). |
| Heavy-tailed distributions (t(df=1), exp(λ→0)) destabilize moment checks | Exclude pathological parameters from V3; test only well-defined moments. |

## Out of scope (post-launch)

- Bootstrap distributions for estimator SE (transitive coverage via estimators).
- Spatial AR DGP validation (no spatial estimator yet in EconSolver — out of scope until spatial econometrics ships post-MVP).
- Heavy-tailed distributions with undefined moments (t(df≤2), Cauchy).
- MCMC samplers (no Bayes module yet).
- ForLoop / WhileLoop convergence proofs (covered by the underlying expression evaluator validation in Fase V2).

## Pre-merge gate — Supabase feedback check (MANDATORY)

Before marking this fase complete, run the `feedback-collector` agent to pull unprocessed rows from the Supabase `feedback` table into `ClaudeFB.md`. Then:

1. **Filter** feedback by scope tags that touch this fase: `simulation`, `simulate`, `DGP`, `Monte Carlo`, `random`, `seed`, `distribution`, `RNG`.
2. For every open row in scope:
   - **Fix-now:** address before concluding.
   - **Fix-later:** file in `BugTriage.md` with a `FaseV3 →` reference.
   - **Wontfix:** document rationale in `ClaudeFB.md` and resolve in Supabase.
3. Concluding this fase without an empty in-scope queue in `ClaudeFB.md` is a blocker.

Moment-based harnesses confirm distributional correctness; user-reported issues catch surprising defaults, missing distribution options, and UX confusion (e.g. seed not seeded, replication count silently capped).

---

## Done criteria

1. Harness returns all-pass on the ≥ 7 marginal + ≥ 10 recovery + 3 script-export cells.
2. Every bug found has a referenced commit.
3. CLAUDE.md updated.
4. Manual smoke test: build a 3-variable Monte Carlo in SimulateTab, run 1000 replications, eyeball that the β̂ histogram is centered on β_true.

---

**Author:** Franco Medero · **Plan drafted:** 2026-05-21
