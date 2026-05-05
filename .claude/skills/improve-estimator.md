---
name: Improve Estimator
description: Modify or fix an existing econometric estimator in EconSolver — wrong SE formula, missing diagnostic, bad bandwidth, incorrect goodness-of-fit stat, numerical instability, missing marginal effects, etc. Use this skill when tweaking an estimator that already exists, NOT when adding a brand new one (use add-estimator for that).
---

## Improve Estimator — EconSolver

### Which file owns what

| Estimator | Math file | Wrapper |
|-----------|-----------|---------|
| OLS, WLS | `src/math/LinearEngine.js` | `wrapOLS`, `wrapWLS` in `EstimationResult.js` |
| FE, FD, TWFE, DiD2x2 | `src/math/PanelEngine.js` | `wrapFE`, `wrapFD`, `wrapDiD` |
| 2SLS/IV, Sharp RDD, McCrary | `src/math/CausalEngine.js` | `wrapIV`, `wrapRDD` |
| Logit, Probit | `src/math/NonLinearEngine.js` | `wrapLogit`, `wrapProbit` |

The wrapper (`EstimationResult.js`) maps engine output to the canonical shape consumed by the UI.
The engine (`*Engine.js`) does the math. Fix numerical issues in the engine. Fix display issues in the wrapper.

---

### Type of improvement → where to look

**A. SE formula is wrong / heteroskedasticity-robust SE missing**
- File: the engine file for that estimator.
- OLS HC1 robust SE pattern (LinearEngine.js):
  ```js
  // HC1: e²/(n-k) adjustment
  const hc1 = Math.sqrt(e * e * n / (n - k));
  const v = XtXinv.map((row, i) => row.map((val, j) => val * sum_xi_xj_ei2[i][j]));
  const se = Math.sqrt(diag(v) * (n / (n - k)));
  ```
- Cluster-robust SE (PanelEngine.js FE pattern): `meat = Σ_g (X_g'e_g)(X_g'e_g)'`
- **Known bug: never weight SSR in σ²** for WLS. σ² = SSR_unweighted / df. See CLAUDE.md Key bugs fixed.

**B. Wrong R² / goodness-of-fit stat**
- File: engine file.
- OLS: `R2 = 1 - SSR/SST`, `adjR2 = 1 - (1-R2)*(n-1)/(n-k-1)`
- WLS: `R2 = 1 - SSR_weighted / SST_weighted` — compute on weighted deviations.
- FE within-R²: `R2 = 1 - SSR / SST_demeaned` (NOT total SST).
- Logit/Probit: McFadden R² = `1 - logLik(full) / logLik(null)`
- Check wrapper too: `wrapXxx()` in `EstimationResult.js` may override with a wrong formula.

**C. Missing diagnostic test**
- Tests live in `src/core/diagnostics/`:
  - `heteroskedasticity.js` → Breusch-Pagan, White
  - `autocorrelation.js` → Durbin-Watson, Breusch-Godfrey
  - `normality.js` → Jarque-Bera, Shapiro-Wilk
  - `multicollinearity.js` → VIF, condition number
- Pattern: call from the engine after computing residuals:
  ```js
  import { breuschPagan } from "../core/diagnostics/heteroskedasticity.js";
  const bpTest = breuschPagan(resid, X);
  // Return in engine output:
  return { ..., diagnostics: { bp: bpTest } };
  ```
- Wire into wrapper: add to `diagnostics` field of canonical shape.
- Wire into UI: `ModelingTab.jsx` results section or `ResidualPlots.jsx`.

**D. Bandwidth selection wrong / IK bandwidth for RDD**
- File: `src/math/CausalEngine.js` → `ikBandwidth()` function.
- The IK (Imbens-Kalyanaraman) bandwidth is validated against `rdrobust` in R.
- If tweaking: re-run R validation after the change: `! Rscript r_validation/rdd_check.R`
- Never change the kernel type default without updating `ModelConfiguration.jsx` UI.

**E. Convergence / numerical instability (Logit/Probit IRLS)**
- File: `src/math/NonLinearEngine.js`
- IRLS max iterations: default 100. Convergence criterion: `||β_new - β_old|| < 1e-8`.
- If diverging: add step-halving (backtracking line search) inside the Newton step.
- Log-sum-exp trick for numerical stability: `logSigma(x) = -log(1 + exp(-x))` for x > 0.

**F. Missing marginal effect (Logit/Probit)**
- Average Marginal Effect (AME): `1/n Σ_i f(x_i'β) * β_j` where `f` = PDF of the link.
- Marginal Effect at Mean (MEM): `f(x̄'β) * β_j`.
- Both should be in engine output and mapped in `wrapLogit()` / `wrapProbit()`.

**G. Wrong test statistic label (t vs z vs chi²)**
- Wrapper: `wrapXxx()` sets `testStatLabel`.
- OLS/WLS: `"t"` (df = n - k)
- FE within: `"t"` (df = n - k - n_entities + 1)
- Logit/Probit MLE: `"z"` (asymptotic)
- IV/2SLS first stage F: `"F"`
- Wald test: `"χ²"`
- Affects `ReportingModule.jsx` `buildStargazer()` header row.

---

### Validation after change

Always re-validate against R after touching a math engine.
```
# Run the relevant R check:
! Rscript r_validation/ols_check.R
! Rscript r_validation/rdd_check.R
# etc.
```
Tolerance: coefficients 6 dp, SE 4 dp.
Update `CLAUDE.md` estimator table validation status if it changes.

---

### Workflow

1. Identify: engine file + wrapper + what's wrong (formula / stat / label / missing field).
2. Read ONLY the specific function in the engine — not the whole file.
3. Cross-check: read the corresponding `wrapXxx()` in `EstimationResult.js` — one function only.
4. Apply `str_replace` fix. State: file, lines, what's removed, what's added.
5. If a diagnostic was added: check it's wired into the UI display (ModelingTab results section or ResidualPlots).
6. Ask user to re-run in browser with a known dataset and compare vs R output.

---

### Token efficiency
- Read the engine function, not the whole engine file.
- Read the wrapper function, not all of EstimationResult.js.
- Never read ModelingTab.jsx for a math fix — only if you need to wire a new diagnostic into the UI.
- Target: math fix in ≤ 4 tool calls.
