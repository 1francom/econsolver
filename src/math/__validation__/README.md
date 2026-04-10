# Engine Validation

Numerical regression tests for all estimation engines, cross-checked against R.

## How to run

### Browser (recommended)

1. Start dev server: `npm run dev`
2. Open the app in Chrome/Firefox
3. Open DevTools console (F12)
4. Paste and run:

```js
const { runAllValidations } = await import("/src/math/__validation__/engineValidation.js");
runAllValidations();
```

Or, if the module auto-loaded (it attaches to `window.__econValidate`):

```js
window.__econValidate()
```

### Node.js

```bash
node --input-type=module --experimental-vm-modules src/math/__validation__/engineValidation.js
```

## What is validated

| Suite | Engine | Reference |
|-------|--------|-----------|
| OLS internal consistency | LinearEngine | DGP recovery + residuals |
| OLS exact DGP recovery | LinearEngine | Zero-noise dataset → β exact |
| OLS vs R reference | LinearEngine | base R `lm()` |
| WLS exact DGP recovery | LinearEngine | Zero-noise + weights |
| FE (fixest-style) | PanelEngine | `fixest::feols(y ~ x | unit)` |
| FD (plm-style) | PanelEngine | `plm::plm(model="fd")` |
| 2SLS (AER-style) | CausalEngine | `AER::ivreg()` |
| Sharp RDD | CausalEngine | `rdrobust::rdrobust()` |
| Logit | NonLinearEngine | base R `glm(family=binomial("logit"))` |
| Probit | NonLinearEngine | base R `glm(family=binomial("probit"))` |

## Tolerances

| Quantity | Tolerance |
|----------|-----------|
| Coefficients | 1e-5 (5 dp) |
| Standard errors | 1e-3 (3 dp) |
| p-values | 1e-3 |
| R² | 1e-4 |

CLAUDE.md target: coefficients to 6 dp, SE to 4 dp — tighten these once hard R output is embedded.

## Adding exact R benchmarks

To embed precise R output:

1. Run the dataset factory (e.g. `makeOLSData`) in R using the same seed/formula
2. Copy `coef()`, `sqrt(diag(vcov()))`, `summary()$r.squared` output
3. Add a `validateXxxvsR()` suite with exact expected values and tight tolerances
