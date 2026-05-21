# Fase V2 — Calculate Tab Validation

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans.

**Track:** B — Module hardening
**Status:** Queued; runs in parallel with Fase 5+ on any free slot.
**Blocks:** nothing.

**Goal:** Validate every numerical routine and expression evaluator in `src/math/calcEngine.js` (used by `src/components/tabs/CalculateTab.jsx`) against R / SciPy direct computation. Cover the expression parser, calculus operations (derivative, integral, root-finding), system solver, predict, and the probability distribution functions.

**Why this matters:** Calculate is the closest thing to a general-purpose computing surface — users put arbitrary expressions in. The estimator track has 6 dp R parity; Calculate has none. Pre-launch this gap closes for the symbolic/numerical primitives users compose.

**Tech Stack:** R `stats` / `pracma` (root, integrate, derivative), SciPy as cross-check, EconSolver harness in the browser console.

---

## File Structure

**Create:**
- `src/services/data/__validation__/faseV2RValidation.R` — produces `faseV2Benchmarks.json` with one entry per validation cell.
- `src/services/data/__validation__/faseV2Validation.js` — harness at `window.__validation.faseV2`.

**Modify (only if validation finds bugs):**
- `src/math/calcEngine.js`
- `src/math/symbolicDiff.js`
- `src/components/tabs/CalculateTab.jsx` (only if a UI-layer bug affects evaluation, e.g. scope leakage)

---

## API surface to validate

From `src/math/calcEngine.js`:

### Numerical primitives
| Function | Signature | R / reference |
|---|---|---|
| `solveRoot` | `(fn, a, b, tol, maxIter) → x where fn(x)=0` | `uniroot(fn, c(a,b))$root` |
| `solveRootAuto` | `(fn, tol) → x` (auto-brackets) | `pracma::brentDekker` with auto-bracketing |
| `integrate` | `(fn, a, b, n) → ∫fn dx` (Simpson n-subintervals) | `stats::integrate(fn, a, b)$value` |
| `solveSystem` | `(fns[], x0[], tol, maxIter) → x[]` (Newton-Raphson) | `pracma::fsolve(fns, x0)` |
| `derivative` | `(fn, x, h) → f'(x)` (central difference) | `pracma::numderiv(fn, x)` |
| `nthDerivative` | `(fn, x, n, h) → f^(n)(x)` | `pracma::numderiv` n-times applied |
| `gradient` | `(fn, xVec, h) → ∇fn` | `pracma::grad(fn, xVec)` |
| `predict` | `(beta, xVec, XtXinv, s2, df) → {pred, se, ci}` | `predict.lm(... interval="confidence")` |

### Expression evaluator
| Function | Signature | Reference |
|---|---|---|
| `evalExpression` | `(expr, scope) → {value, error}` | R `expr_value <- with(scope, <parsed_expr>)` (using R's standard expression-parser path) |
| `buildScope` | `(variables) → {name: value}` map | manual map construction |

### Probability distributions
| Function | Match against |
|---|---|
| `dnorm, pnorm, qnorm` | R `dnorm, pnorm, qnorm` (mean, sd) |
| `dt, pt, qt` | R `dt, pt, qt` (df) |
| `dbinom, pbinom` | R `dbinom, pbinom` (n, p) |
| `dpois, ppois` | R `dpois, ppois` (lambda) |
| `dchisq, pchisq, qchisq` | R `dchisq, pchisq, qchisq` (df) |

### Symbolic differentiation (`src/math/symbolicDiff.js`)
- Validate symbolic D for: polynomial, exponential, logarithm, trig, product rule, quotient rule, chain rule, mixed expressions, and the "unknown function" cases (`p(q)`, `c(q)`) that CalculateTab exposes (per the in-file comment at line 1345).

---

## Task 1 — R validation script

**Files:** `src/services/data/__validation__/faseV2RValidation.R`

- [ ] **Step 1: Numerical primitives**

```r
library(pracma); library(jsonlite)
set.seed(20260522)

bench <- list()

# solveRoot: 6 test functions with known roots
roots <- list(
  list(expr = "x^2 - 2",      bracket = c(0, 2),  truth = sqrt(2)),
  list(expr = "exp(x) - 5",   bracket = c(0, 3),  truth = log(5)),
  list(expr = "x^3 - x - 1",  bracket = c(1, 2),  truth = 1.3247179572),
  list(expr = "sin(x)",       bracket = c(2, 4),  truth = pi),
  list(expr = "log(x) - 1",   bracket = c(1, 5),  truth = exp(1)),
  list(expr = "x*x*x - 27",   bracket = c(0, 5),  truth = 3)
)
bench$solveRoot <- roots

# integrate: 8 functions with closed-form integrals
ints <- list(
  list(expr = "x",        a = 0, b = 1,    truth = 0.5),
  list(expr = "x^2",      a = 0, b = 1,    truth = 1/3),
  list(expr = "exp(x)",   a = 0, b = 1,    truth = exp(1) - 1),
  list(expr = "1/x",      a = 1, b = exp(1), truth = 1),
  list(expr = "sin(x)",   a = 0, b = pi,   truth = 2),
  list(expr = "cos(x)",   a = 0, b = pi/2, truth = 1),
  list(expr = "x*exp(x)", a = 0, b = 1,    truth = 1),
  list(expr = "1/(1+x^2)",a = 0, b = 1,    truth = pi/4)
)
bench$integrate <- ints

# derivative: f'(x) at fixed x
derivs <- list(
  list(expr = "x^2",    x = 3,   truth = 6),
  list(expr = "exp(x)", x = 1,   truth = exp(1)),
  list(expr = "log(x)", x = 2,   truth = 0.5),
  list(expr = "sin(x)", x = pi/4, truth = cos(pi/4)),
  list(expr = "x^3 - 2*x", x = 1, truth = 1)
)
bench$derivative <- derivs

# nthDerivative: 2nd derivative at x
n_derivs <- list(
  list(expr = "x^3", x = 2, n = 2, truth = 12),
  list(expr = "exp(x)", x = 0, n = 3, truth = 1),
  list(expr = "sin(x)", x = 0, n = 2, truth = 0)
)
bench$nthDerivative <- n_derivs

# gradient: ∇f at fixed point
grads <- list(
  list(expr = "x^2 + y^2", x = c(1, 2), truth = c(2, 4)),
  list(expr = "x*y", x = c(3, 4), truth = c(4, 3)),
  list(expr = "exp(x) + log(y)", x = c(0, 1), truth = c(1, 1))
)
bench$gradient <- grads

# solveSystem: 2-equation systems
sys <- list(
  list(fns = c("x + y - 3", "x - y - 1"), x0 = c(0, 0), truth = c(2, 1)),
  list(fns = c("x^2 + y - 5", "x - y - 1"), x0 = c(1, 1), truth = c(2, 1))
)
bench$solveSystem <- sys
```

- [ ] **Step 2: Distribution functions**

```r
dists <- list(
  list(fn = "dnorm", args = list(x=1.96, mean=0, sd=1), truth = dnorm(1.96)),
  list(fn = "pnorm", args = list(x=1.96, mean=0, sd=1), truth = pnorm(1.96)),
  list(fn = "qnorm", args = list(p=0.975, mean=0, sd=1), truth = qnorm(0.975)),
  list(fn = "dt", args = list(x=2, df=10), truth = dt(2, 10)),
  list(fn = "pt", args = list(x=2, df=10), truth = pt(2, 10)),
  list(fn = "qt", args = list(p=0.975, df=10), truth = qt(0.975, 10)),
  list(fn = "dbinom", args = list(k=3, n=10, p=0.4), truth = dbinom(3,10,0.4)),
  list(fn = "pbinom", args = list(k=3, n=10, p=0.4), truth = pbinom(3,10,0.4)),
  list(fn = "dpois", args = list(k=2, lambda=3), truth = dpois(2,3)),
  list(fn = "ppois", args = list(k=2, lambda=3), truth = ppois(2,3)),
  list(fn = "dchisq", args = list(x=5, df=3), truth = dchisq(5,3)),
  list(fn = "pchisq", args = list(x=5, df=3), truth = pchisq(5,3)),
  list(fn = "qchisq", args = list(p=0.95, df=3), truth = qchisq(0.95,3))
)
bench$distributions <- dists
```

- [ ] **Step 3: Expression parser cells**

Test expressions covering precedence, parens, function call, unary minus, comparison, conditional, NA/NaN/Inf:

```r
exprs <- list(
  list(expr = "2 + 3 * 4", scope = list(), truth = 14),
  list(expr = "(2 + 3) * 4", scope = list(), truth = 20),
  list(expr = "-2 ^ 2", scope = list(), truth = -4),   # R semantics
  list(expr = "log(exp(5))", scope = list(), truth = 5),
  list(expr = "x + y * 2", scope = list(x=1, y=3), truth = 7),
  list(expr = "sqrt(x^2 + y^2)", scope = list(x=3, y=4), truth = 5),
  list(expr = "1/0", scope = list(), truth = Inf),
  list(expr = "0/0", scope = list(), truth = NaN),
  list(expr = "log(-1)", scope = list(), truth = NaN),
  list(expr = "exp(710)", scope = list(), truth = Inf),
  list(expr = "if (x > 0) 1 else -1", scope = list(x=5), truth = 1)
)
bench$expressions <- exprs

writeLines(toJSON(bench, auto_unbox=TRUE, digits=12), "faseV2Benchmarks.json")
```

- [ ] **Step 4: Symbolic differentiation cells**

For each, write the expected symbolic derivative as a string normalized to a canonical form, plus a numerical check:

```r
sym <- list(
  list(expr = "x^2",   var = "x", deriv_eval_at = 3,  truth_eval = 6),
  list(expr = "exp(x)", var = "x", deriv_eval_at = 0, truth_eval = 1),
  list(expr = "log(x)", var = "x", deriv_eval_at = 2, truth_eval = 0.5),
  list(expr = "x*sin(x)", var = "x", deriv_eval_at = pi, truth_eval = pi*cos(pi) + sin(pi)),
  list(expr = "x^3 + 2*x", var = "x", deriv_eval_at = 1, truth_eval = 5)
)
bench$symbolicDiff <- sym
```

Validate symbolic differentiation by **numerical equivalence**: parse the EconSolver-emitted derivative expression, compute its value at the test point with `Calc.evalExpression`, and compare to truth. This sidesteps canonical-form questions.

---

## Task 2 — Browser harness

**Files:** `src/services/data/__validation__/faseV2Validation.js`

- [ ] **Step 1: Run every cell**

```js
import * as Calc from "../../../math/calcEngine.js";
import * as Sym from "../../../math/symbolicDiff.js";

export async function runFaseV2NumericalValidation() {
  const bench = await fetchJSON("faseV2Benchmarks.json");
  const report = [];

  // solveRoot
  for (const c of bench.solveRoot) {
    const fn = (x) => Calc.evalExpression(c.expr, { x }).value;
    const got = Calc.solveRoot(fn, c.bracket[0], c.bracket[1]);
    report.push({ cell: `solveRoot_${c.expr}`,
                  pass: Math.abs(got - c.truth) < 1e-8,
                  got, truth: c.truth });
  }

  // integrate
  for (const c of bench.integrate) {
    const fn = (x) => Calc.evalExpression(c.expr, { x }).value;
    const got = Calc.integrate(fn, c.a, c.b, 1000);
    report.push({ cell: `integrate_${c.expr}`,
                  pass: Math.abs(got - c.truth) < 1e-6,
                  got, truth: c.truth });
  }

  // derivative
  for (const c of bench.derivative) {
    const fn = (x) => Calc.evalExpression(c.expr, { x }).value;
    const got = Calc.derivative(fn, c.x);
    report.push({ cell: `derivative_${c.expr}_at_${c.x}`,
                  pass: Math.abs(got - c.truth) < 1e-5,
                  got, truth: c.truth });
  }

  // nthDerivative
  // gradient
  // solveSystem
  // distributions
  // expressions
  // symbolicDiff (numerical equivalence — parse emitted derivative string, run via Calc.evalExpression)
  // ...

  return report;
}
```

- [ ] **Step 2: NA / NaN / Inf semantics**

Specific test cells:
- `Calc.evalExpression("NA + 1", {})` → returns NaN, NOT throws.
- `Calc.evalExpression("Inf - Inf", {})` → NaN.
- `Calc.evalExpression("log(0)", {})` → −Inf.
- `Calc.evalExpression("0 * Inf", {})` → NaN.
- Comparison with NaN: `Calc.evalExpression("NaN > 0", {})` → false (NOT NaN, NOT throws).

Match R's behavior **except** where JS Number semantics diverge fundamentally — document those divergences in the harness output, do not paper over them.

- [ ] **Step 3: Scope semantics**

Validate that:
- Variables in scope shadow built-ins (`Calc.evalExpression("log + 1", {log: 2})` returns 3; built-in `log` is shadowed).
- Undefined variables produce an error, not silent NaN.
- Recursive expressions resolve correctly (`x` defined in terms of `y`, `y` in terms of `z` constant).
- Mutating scope after `Calc.evalExpression` does not affect the cached return.

---

## Task 3 — Fix discrepancies

For each failing cell:
- [ ] Diagnose; default assumption: R is correct.
- [ ] Patch the EconSolver function (surgical).
- [ ] Re-run harness.
- [ ] Document in CLAUDE.md.

**Likely failure points:**
- Simpson's rule with n=1000 may diverge from `stats::integrate` (adaptive Romberg) for non-smooth integrands. Either raise n or document the divergence.
- Newton-Raphson `solveSystem` may converge to a different root than `pracma::fsolve` for non-convex systems. Document multi-root behavior.
- `qnorm`/`qt` quantile functions may differ by 1e-7 from R near tails. Check tail tolerance separately.
- Operator precedence in `Calc.evalExpression`: ensure `^` is right-associative and unary `-` binds tighter than `^` (matches R `-2^2 == -4`).

---

## Task 4 — CLAUDE.md update + commits

- [ ] Add "Calculate: validated vs R" to "Modules validated".
- [ ] Document fixed bugs in "Key bugs fixed".
- [ ] Commits:
  1. `test(calculate): Fase V2 — R golden values`
  2. `test(calculate): Fase V2 — browser harness`
  3. `fix(calculate): <bug N>` per bug
  4. `docs: Fase V2 — calculate validation complete`

---

## Tolerances (summary)

| Operation | Tolerance |
|---|---|
| `solveRoot`, `solveRootAuto` | 1e-8 absolute on `x` |
| `integrate` | 1e-6 absolute |
| `derivative` | 1e-5 absolute |
| `gradient` | 1e-5 absolute per component |
| `solveSystem` | 1e-6 absolute per coordinate |
| `predict` | 1e-8 on point, 1e-6 on SE, 1e-4 on CI bounds |
| Probability distributions | 1e-10 PDF, 1e-10 CDF, 1e-8 quantile |
| `Calc.evalExpression` (regular) | 1e-10 |
| NA / NaN / Inf | exact match (with documented divergences from R) |

## Risks

| Risk | Mitigation |
|---|---|
| Simpson's rule wrong for integrands with sharp peaks | Document; user-facing note "use larger n for non-smooth integrands". Validate against pracma::quadgk for the sharp cases. |
| The expression parser may not implement R's full operator grammar | Plan does not promise R-grammar parity. Document any unsupported constructs (e.g., R formulas `y ~ x` not supported). |
| Symbolic differentiation canonical form drift | Validate numerically only. Do not compare strings. |
| Scope leak across calls | Test scenarios in Task 2 Step 3 catch this. |

## Out of scope (post-launch)

- LaTeX export round-trip validation (already tested manually).
- Complex arithmetic (R supports it; EconSolver does not).
- Arbitrary-precision arithmetic (mpfr-style).
- Symbolic integration (only differentiation today).
- Function grapher visual validation (covered by Fase V4 — Plots).
- Probability calculator UI (`ProbCalc`) — covered transitively by distribution function validation.

## Pre-merge gate — Supabase feedback check (MANDATORY)

Before marking this fase complete, run the `feedback-collector` agent to pull unprocessed rows from the Supabase `feedback` table into `ClaudeFB.md`. Then:

1. **Filter** feedback by scope tags that touch this fase: `calculate`, `expression`, `formula`, `integrate`, `derivative`, `root`, `distribution`, `probability`, `NaN`, `NA`.
2. For every open row in scope:
   - **Fix-now:** address before concluding.
   - **Fix-later:** file in `BugTriage.md` with a `FaseV2 →` reference.
   - **Wontfix:** document rationale in `ClaudeFB.md` and resolve in Supabase.
3. Concluding this fase without an empty in-scope queue in `ClaudeFB.md` is a blocker.

The harness covers numerical parity; user-reported issues catch parser-edge-cases (operator precedence surprises, unicode minus, locale decimal separators) the harness fixtures cannot anticipate.

---

## Done criteria

1. Harness returns all-pass on the ≥ 80 cells (6 root + 8 integrate + 5 derivative + 3 nthDerivative + 3 gradient + 2 system + 13 distribution + 11 expression + 5 symbolic + NA/NaN edge cases).
2. Every bug found has a referenced commit.
3. CLAUDE.md updated.
4. Manual smoke test: open CalculateTab, enter 10 typical expressions; values match R hand-computed.

---

**Author:** Franco Medero · **Plan drafted:** 2026-05-21
