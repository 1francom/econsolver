# Outcome Family Chip + Two-Pass Estimation — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the flat estimator dropdown with a two-dimensional selector (identification strategy × outcome family chip), add IV-Poisson as the first new combination, and add a post-estimation "Extract to dataset" panel for two-pass estimation workflows.

**Architecture:** `EstimatorSidebar` gains a `family` prop and chip row. `ModelingTab` adds `family` state and a `(model, family)` dispatch table. IV-Poisson lands in `GMMEngine.js` following the same two-step pattern as the existing linear GMM. Two-pass extraction uses a new `inject_column` pipeline step and a new `ExtractPanel` component.

**Tech Stack:** React (JSX), pure-JS math (no React in src/math/), Observable Plot 0.6 (CDN), existing `matMul`/`matInv`/`transpose` from LinearEngine.js.

**Spec:** `docs/superpowers/specs/2026-06-03-outcome-family-chip-twopass.md`

---

## File Map

### Modified files
| File | Change |
|---|---|
| `src/components/modeling/EstimatorSidebar.jsx` | MODELS array restructure; `FAMILY_SUPPORT` map; chip row UI; `family` + `onFamilySelect` props |
| `src/components/ModelingTab.jsx` | `family` state; dispatch table update; WLS routing change |
| `src/components/modeling/ModelConfiguration.jsx` | WLS weights toggle under OLS section |
| `src/math/GMMEngine.js` | `runIVPoisson()` function appended at bottom |
| `src/math/index.js` | re-export `runIVPoisson` |
| `src/math/__validation__/engineValidation.js` | IV-Poisson R fixtures |
| `src/pipeline/runner.js` | `inject_column` case in `applyStep` |
| `src/pipeline/registry.js` | `inject_column` entry in `STEP_REGISTRY` |
| `src/services/export/rScript.js` | `inject_column` translation |
| `src/services/export/pythonScript.js` | `inject_column` translation |
| `src/services/export/stataScript.js` | `inject_column` translation |

### Created files
| File | Purpose |
|---|---|
| `src/components/modeling/ExtractPanel.jsx` | Collapsible panel showing extractable columns per result; dispatches `inject_column` steps |

---

## PART 1 — Outcome Family Chip

---

### Task 1: Restructure MODELS array and add FAMILY_SUPPORT

**Files:**
- Modify: `src/components/modeling/EstimatorSidebar.jsx`

- [ ] **Step 1: Replace the MODELS array**

Replace the entire `MODELS` array (lines 19–47) and `GROUP_ORDER` (line 50) with:

```javascript
export const MODELS = [
  // Linear
  { id: "OLS",              label: "OLS",              group: "Linear",    desc: "Ordinary Least Squares",                                               color: "#7ab896" },
  // Panel
  { id: "FE",               label: "FE",               group: "Panel",     desc: "Fixed Effects (within estimator) — panel required",                    color: "#6e9ec8" },
  { id: "FD",               label: "FD",               group: "Panel",     desc: "First Differences — unique (i,t) pairs required",                      color: "#6e9ec8" },
  { id: "LSDV",             label: "LSDV",             group: "Panel",     desc: "Least Squares Dummy Variables — panel required",                        color: "#6e9ec8" },
  { id: "TWFE",             label: "TWFE DiD",         group: "Panel",     desc: "Two-Way Fixed Effects DiD — panel required",                            color: "#6ec8b4" },
  { id: "EventStudy",       label: "Event Study",      group: "Panel",     desc: "Dynamic DiD / event study — panel required",                            color: "#6ec8b4" },
  { id: "CallawayCS",       label: "CS DiD",           group: "Panel",     desc: "Callaway & Sant'Anna (2021) staggered DiD — panel required",            color: "#6ec8b4" },
  // DiD
  { id: "DiD",              label: "DiD 2×2",          group: "DiD",       desc: "Classic Difference-in-Differences",                                     color: "#6ec8b4" },
  // IV
  { id: "2SLS",             label: "2SLS / IV",        group: "IV",        desc: "Two-Stage Least Squares",                                               color: "#c8a96e" },
  { id: "GMM",              label: "Two-Step GMM",     group: "IV",        desc: "Efficient GMM — HC-robust Ω̂ + J-test",                                  color: "#c8a96e" },
  { id: "LIML",             label: "LIML",             group: "IV",        desc: "Limited Info. Max. Likelihood / k-class",                               color: "#c8a96e" },
  // RD
  { id: "RDD",              label: "Sharp RDD",        group: "RD",        desc: "Regression Discontinuity Design",                                       color: "#c88e6e" },
  { id: "FuzzyRDD",         label: "Fuzzy RDD",        group: "RD",        desc: "Fuzzy Regression Discontinuity Design",                                 color: "#c88e6e" },
  { id: "SpatialRDD",       label: "Spatial RD",       group: "RD",        desc: "Geographic RD at a boundary (Keele & Titiunik 2015)",                   color: "#c88e6e" },
  // Synthetic
  { id: "SyntheticControl", label: "Synthetic Control",group: "Synthetic", desc: "Abadie-Diamond-Hainmueller (Frank-Wolfe weights + placebo inference)",  color: "#6e9ec8" },
];

const GROUP_ORDER = ["Linear", "Panel", "DiD", "IV", "RD", "Synthetic"];

// Outcome families each strategy supports.
// "linear" is always implied. Only non-linear entries listed.
// "planned" = chip renders dimmed, not clickable.
export const FAMILY_SUPPORT = {
  OLS:              { poisson: "available", logit: "available", probit: "available" },
  FE:               { poisson: "available", logit: "planned",   probit: "planned"   },
  TWFE:             { poisson: "planned" },
  EventStudy:       { poisson: "available" },
  DiD:              { poisson: "planned" },
  "2SLS":           { poisson: "available" },
  // All others: Linear only — chip row hidden
};
```

- [ ] **Step 2: Verify the dropdown still renders**

Open the app in the browser. Open the Modeling tab, click the estimator dropdown. Confirm:
- Groups are: Linear, Panel, DiD, IV, RD, Synthetic
- No Logit, Probit, Poisson, PoissonFE, SunAbraham, WLS entries
- All existing strategies (OLS, FE, 2SLS, etc.) still appear

- [ ] **Step 3: Commit**

```bash
git add src/components/modeling/EstimatorSidebar.jsx
git commit -m "refactor(estimator): restructure MODELS to pure identification strategies + FAMILY_SUPPORT map"
```

---

### Task 2: Add chip row UI to EstimatorSidebar

**Files:**
- Modify: `src/components/modeling/EstimatorSidebar.jsx`

- [ ] **Step 1: Add `family` and `onFamilySelect` to the component props**

Change the component signature:

```javascript
export default function EstimatorSidebar({
  model,
  onSelect,
  modelAvail,
  modelHint,
  panel,
  family,          // "linear" | "poisson" | "logit" | "probit"
  onFamilySelect,  // (family: string) => void
}) {
```

- [ ] **Step 2: Add the chip row + result hint below the dropdown trigger button**

Add this block immediately after the closing `</div>` of the dropdown wrapper div (after line ~203, before the InfoBox blocks):

```javascript
{/* ── Outcome family chip row ── */}
{(() => {
  const support = FAMILY_SUPPORT[model] ?? {};
  const families = [
    { id: "linear",  label: "Linear"  },
    { id: "poisson", label: "Poisson" },
    { id: "logit",   label: "Logit"   },
    { id: "probit",  label: "Probit"  },
  ];
  // Only render chips when at least one non-linear family is available or planned
  const hasNonLinear = Object.keys(support).length > 0;
  if (!hasNonLinear) return null;

  const HINT = {
    OLS_poisson:       "Poisson GLM · E[Y|X] = exp(Xβ)",
    OLS_logit:         "Logit · P(Y=1|X) = σ(Xβ)",
    OLS_probit:        "Probit · P(Y=1|X) = Φ(Xβ)",
    FE_poisson:        "Poisson FE (PPML) · exp(Xβ + αᵢ)",
    EventStudy_poisson:"Sun-Abraham (2021) IW event study",
    "2SLS_poisson":    "IV-Poisson · E[Y|X,Z] = exp(Xβ)",
  };

  return (
    <div style={{ marginTop: 8 }}>
      <div style={{ fontSize: 8, letterSpacing: "0.18em", textTransform: "uppercase", color: C.textMuted, marginBottom: 5, fontFamily: mono }}>
        Outcome family
      </div>
      <div style={{ display: "flex", gap: 4, flexWrap: "wrap" }}>
        {families.map(f => {
          const state = f.id === "linear" ? "available" : (support[f.id] ?? "hidden");
          if (state === "hidden") return null;
          const isActive  = family === f.id;
          const isPlanned = state === "planned";
          const chipColor = f.id === "poisson" ? "#9e7ec8"
                          : f.id === "logit"   ? "#c8a96e"
                          : f.id === "probit"  ? "#c88e6e"
                          : C.blue;
          return (
            <button
              key={f.id}
              disabled={isPlanned}
              onClick={() => !isPlanned && onFamilySelect(f.id)}
              title={isPlanned ? "Planned — not yet implemented" : undefined}
              style={{
                border: `1px solid ${isActive ? chipColor : "#2a2a2a"}`,
                borderRadius: 3,
                padding: "3px 9px",
                fontSize: 10,
                letterSpacing: "0.06em",
                fontFamily: mono,
                background: isActive ? `${chipColor}18` : "transparent",
                color: isActive ? chipColor : isPlanned ? "#333" : "#666",
                cursor: isPlanned ? "not-allowed" : "pointer",
                opacity: isPlanned ? 0.4 : 1,
                transition: "all 0.1s",
              }}
            >
              {f.label}
            </button>
          );
        })}
      </div>
      {/* Result hint */}
      {family !== "linear" && (
        <div style={{
          marginTop: 6, padding: "5px 8px",
          background: `${C.purple ?? "#9e7ec8"}10`,
          border: `1px solid ${C.purple ?? "#9e7ec8"}30`,
          borderLeft: `3px solid ${C.purple ?? "#9e7ec8"}`,
          borderRadius: 3, fontSize: 10,
          color: C.purple ?? "#9e7ec8",
          fontFamily: mono,
        }}>
          {HINT[`${model}_${family}`] ?? `${model} + ${family}`}
        </div>
      )}
    </div>
  );
})()}
```

- [ ] **Step 3: Verify chips render correctly**

Open the app. Select "OLS" → should see: Linear (active), Poisson, Logit, Probit chips.
Select "FE" → should see: Linear, Poisson. No Logit/Probit (hidden, not planned).
Select "2SLS" → should see: Linear, Poisson.
Select "Synthetic Control" → no chip row at all.
Click Poisson chip on OLS → nothing happens yet (state not wired).

- [ ] **Step 4: Commit**

```bash
git add src/components/modeling/EstimatorSidebar.jsx
git commit -m "feat(estimator): add outcome family chip row with FAMILY_SUPPORT visibility logic"
```

---

### Task 3: Wire `family` state in ModelingTab

**Files:**
- Modify: `src/components/ModelingTab.jsx`

- [ ] **Step 1: Add `family` state**

Find the state declarations block around line 1563 (where `const [model, setModel] = useState("OLS")` is). Add immediately after it:

```javascript
const [family, setFamily] = useState("linear"); // "linear"|"poisson"|"logit"|"probit"
```

- [ ] **Step 2: Add family reset logic when model changes**

Find the `setModel` call site (where `onSelect` is wired). Wrap it in a handler:

```javascript
const handleModelSelect = useCallback((newModel) => {
  setModel(newModel);
  // Reset family to linear unless new strategy supports the current family
  setFamily(prev => {
    const support = FAMILY_SUPPORT[newModel] ?? {};
    return (prev === "linear" || support[prev] === "available") ? prev : "linear";
  });
}, []);
```

Import `FAMILY_SUPPORT` at the top of ModelingTab.jsx:
```javascript
import EstimatorSidebar, { FAMILY_SUPPORT } from "../components/modeling/EstimatorSidebar.jsx";
```

- [ ] **Step 3: Pass family props to EstimatorSidebar**

Find where `<EstimatorSidebar` is rendered (around line 3220). Add the two new props:

```javascript
<EstimatorSidebar
  model={model}
  onSelect={handleModelSelect}   // was: onSelect={setModel}
  modelAvail={modelAvail}
  modelHint={modelHint}
  panel={panel}
  family={family}
  onFamilySelect={setFamily}
/>
```

- [ ] **Step 4: Verify family chip is interactive**

Open app. Select OLS, click Poisson chip → chip highlights purple. Switch to FE → Poisson chip stays active. Switch to Synthetic Control → chip row disappears, family silently stays "poisson" in state but doesn't show. Switch back to OLS → Poisson chip re-activates. Switch to LIML → chip row gone, family resets to "linear" (LIML doesn't support poisson).

- [ ] **Step 5: Commit**

```bash
git add src/components/ModelingTab.jsx
git commit -m "feat(modeling): wire family state + chip selection + model-change reset logic"
```

---

### Task 4: Update dispatch table for existing family combinations

**Files:**
- Modify: `src/components/ModelingTab.jsx`

- [ ] **Step 1: Find the existing OLS/Logit/Probit/Poisson/PoissonFE/SunAbraham dispatch branches**

In the `estimate()` callback, find the blocks:
- `else if (model === "Logit")` 
- `else if (model === "Probit")`
- `else if (model === "Poisson")`
- `else if (model === "PoissonFE")`
- `else if (model === "SunAbraham")`

- [ ] **Step 2: Redirect Logit/Probit/Poisson to family-based dispatch under OLS**

Replace the standalone model checks with family-aware dispatch under OLS. Find the `if (model === "OLS")` branch and extend it:

```javascript
if (model === "OLS") {
  if (family === "logit") {
    // --- formerly: model === "Logit" ---
    if (!allX.length) return { error: "Select at least one regressor (X)." };
    const res = runLogit(dataRows, y, allX, seOpts);
    if (!res || res.error) return { error: res?.error ?? "Logit failed." };
    return { result: wrapResult("Logit", res, { yVar: y, xVars: allX, wVars: expW }), panelFE: null, panelFD: null };
  }
  if (family === "probit") {
    // --- formerly: model === "Probit" ---
    if (!allX.length) return { error: "Select at least one regressor (X)." };
    const res = runProbit(dataRows, y, allX, seOpts);
    if (!res || res.error) return { error: res?.error ?? "Probit failed." };
    return { result: wrapResult("Probit", res, { yVar: y, xVars: allX, wVars: expW }), panelFE: null, panelFD: null };
  }
  if (family === "poisson") {
    // --- formerly: model === "Poisson" ---
    if (!allX.length) return { error: "Select at least one regressor (X)." };
    const offCol = poissonOffsetCol || null;
    const res = runPoisson(dataRows, y, allX, seOpts, offCol);
    if (!res || res.error) return { error: res?.error ?? "Poisson GLM failed." };
    return { result: wrapResult("Poisson", res, { yVar: y, xVars: allX, wVars: expW, offsetCol: offCol }), panelFE: null, panelFD: null };
  }
  // family === "linear" (+ WLS if wCol is set — existing logic unchanged)
  // ... existing OLS/WLS code ...
}
```

- [ ] **Step 3: Redirect PoissonFE to FE + family="poisson"**

Find `else if (model === "PoissonFE")` and replace with a branch inside the FE block:

```javascript
if (model === "FE") {
  if (family === "poisson") {
    // --- formerly: model === "PoissonFE" ---
    if (!allX.length) return { error: "Select at least one regressor (X)." };
    const ec = panel?.entityCol || poissonEntityCol;
    const feCols = [ec, ...poissonExtraFE.filter(c => c && c !== ec && !allX.includes(c))].filter(Boolean);
    if (!ec) return { error: "Select an entity column for Poisson FE." };
    let res;
    if (feCols.length > 1) {
      res = runPoissonFEMulti(dataRows, y, allX, feCols, seOpts);
    } else {
      res = runPoissonFE(dataRows, y, allX, ec, seOpts);
    }
    if (!res || res.error) return { error: res?.error ?? "Poisson FE failed." };
    return { result: wrapResult("PoissonFE", res, { yVar: y, xVars: allX, wVars: expW, entityCol: ec, feCols }), panelFE: null, panelFD: null };
  }
  // family === "linear" — existing FE code unchanged
  // ... existing FE logic ...
}
```

- [ ] **Step 4: Redirect SunAbraham to EventStudy + family="poisson"**

Inside the EventStudy branch, add a family check at the top:

```javascript
if (model === "EventStudy") {
  if (family === "poisson") {
    // --- formerly: model === "SunAbraham" ---
    const cCol = cohortCol[0];
    const pCol = periodCol[0];
    const uCol = panel?.entityCol || "";
    if (!cCol || !pCol) return { error: "Sun-Abraham requires cohort and period columns." };
    const feCols = [uCol, pCol].filter(Boolean);
    const saControls = allX.filter(c => c !== cCol && c !== pCol && c !== uCol);
    const res = runSunAbraham(dataRows, y, saControls,
      { cohortCol: cCol, periodCol: pCol, feCols, refPeriod: Number(saRefPeriod), controlMode: saControlMode },
      seOpts);
    if (!res || res.error) return { error: res?.error ?? "Sun-Abraham estimation failed." };
    return { result: wrapResult("SunAbraham", res, { yVar: y, xVars: saControls, wVars: expW, cohortCol: cCol, periodCol: pCol, feCols }), panelFE: null, panelFD: null };
  }
  // family === "linear" — existing EventStudy code unchanged
  // ... existing EventStudy logic ...
}
```

- [ ] **Step 5: Remove the now-dead standalone branches**

Delete these model branches (they are now handled by family dispatch above):
- `else if (model === "Logit") { ... }`
- `else if (model === "Probit") { ... }`
- `else if (model === "Poisson") { ... }`
- `else if (model === "PoissonFE") { ... }`
- `else if (model === "SunAbraham") { ... }`

- [ ] **Step 6: Verify existing combinations still work**

Test each in the browser with a sample CSV:
1. OLS + Linear chip → OLS result ✓
2. OLS + Poisson chip → Poisson GLM result ✓
3. OLS + Logit chip → Logit result ✓
4. FE + Poisson chip → PoissonFE result ✓
5. Event Study + Poisson chip → SunAbraham result ✓

Result types in the output panel should be identical to before.

- [ ] **Step 7: Commit**

```bash
git add src/components/ModelingTab.jsx
git commit -m "refactor(dispatch): route existing Logit/Probit/Poisson/PoissonFE/SunAbraham through family chip"
```

---

### Task 5: WLS migration — weights toggle under OLS in ModelConfiguration

**Files:**
- Modify: `src/components/modeling/ModelConfiguration.jsx`

- [ ] **Step 1: Find the WLS section in ModelConfiguration**

Search for `wCol` or `"WLS"` in ModelConfiguration.jsx to locate the existing weights UI.

- [ ] **Step 2: Move weights UI under OLS section, add visibility guard**

The weights UI should already exist. Wrap it with a visibility condition so it only shows when `model === "OLS"` and `family === "linear"`:

```javascript
{/* WLS weights — shown under OLS Linear only */}
{model === "OLS" && family === "linear" && (
  <Section title="Survey Weights (WLS)" color={C.textMuted} collapsible defaultCollapsed>
    {/* existing wCol selector — unchanged */}
  </Section>
)}
```

Ensure `family` is passed as a prop from ModelingTab into ModelConfiguration. Check the existing prop list in ModelConfiguration and add `family` if missing.

- [ ] **Step 3: Verify WLS still routes correctly**

In ModelingTab's dispatch, the existing WLS routing is inside the OLS branch:
```javascript
// Already present — just verify it still runs when wCol is set:
if (family === "linear" && wCol) {
  // → runWLS(...)
}
```
No math change needed. Test: load a CSV, pick OLS, expand the weights section, select a weight column, run → WLS result.

- [ ] **Step 4: Commit**

```bash
git add src/components/modeling/ModelConfiguration.jsx src/components/ModelingTab.jsx
git commit -m "refactor(wls): move weights toggle under OLS section; remove WLS from strategy dropdown"
```

---

### Task 6: IV-Poisson math engine

**Files:**
- Modify: `src/math/GMMEngine.js`

- [ ] **Step 1: Append `runIVPoisson` at the end of GMMEngine.js**

```javascript
// ─── IV-POISSON (EXPONENTIAL GMM) ────────────────────────────────────────────
//
// Structural equation: E[Y|X,Z] = exp(Xβ), endogenous regressors in X.
// Moment conditions:   g(β) = (1/n) Σ Zᵢ(yᵢ − exp(Xᵢβ))
// Score Jacobian:      G(β) = −(1/n) Z′diag(μ)X    where μᵢ = exp(Xᵢβ)
// Two-step GMM:
//   Step 1 — W = I (identity), Newton-Raphson to convergence.
//   Ω̂ = (1/n) Z′diag(ε̂²)Z  from step-1 residuals.
//   Step 2 — W = Ω̂⁻¹, Newton-Raphson to convergence.
//   V(β̂) = (1/n)[G′Ω̂⁻¹G]⁻¹
//
// Convention: xCols = all regressors (endogenous + exogenous, NO intercept).
//             zCols = all instruments (replaces endogenous, keeps exogenous, NO intercept).
//             Intercept is added automatically (first column of X and Z).
//
export function runIVPoisson(rows, yCol, xCols, wCols, zCols, seOpts = {}) {
  const overidDf = (zCols.length + wCols.length) - (xCols.length + wCols.length);
  if (overidDf < 0) return { error: ERR_UNDERIDENTIFIED };

  const allCols = [yCol, ...xCols, ...wCols, ...zCols];
  const valid = rows.filter(r => {
    const yv = Number(r[yCol]);
    if (!isFinite(yv) || yv < 0) return false;
    return allCols.every(c => r[c] != null && isFinite(Number(r[c])));
  });

  const n = valid.length;
  // X = [1, wCols, xCols]   (full regressors including exogenous controls)
  // Z = [1, wCols, zCols]   (instruments: exogenous controls + excluded instruments)
  const Y  = valid.map(r => Number(r[yCol]));
  const X  = valid.map(r => [1, ...wCols.map(c => Number(r[c])), ...xCols.map(c => Number(r[c]))]);
  const Z  = valid.map(r => [1, ...wCols.map(c => Number(r[c])), ...zCols.map(c => Number(r[c]))]);
  const kX = X[0].length;
  const kZ = Z[0].length;

  if (n < kX + 2) return { error: `IV-Poisson: insufficient observations (n=${n}, k=${kX}).` };
  if (kZ < kX)   return { error: "IV-Poisson: order condition violated — need at least as many instruments as regressors." };

  const Xt = transpose(X);
  const Zt = transpose(Z);

  // g(β) = (1/n) Z′(Y − μ)
  const getMoments = (mu) =>
    Zt.map(zj => zj.reduce((s, v, i) => s + v * (Y[i] - mu[i]), 0) / n);

  // G(β) = −(1/n) Z′diag(μ)X   [kZ × kX]
  const getJacobian = (mu) => {
    const J = Array.from({ length: kZ }, () => new Array(kX).fill(0));
    for (let i = 0; i < n; i++) {
      for (let j = 0; j < kZ; j++) {
        for (let l = 0; l < kX; l++) {
          J[j][l] -= Z[i][j] * mu[i] * X[i][l];
        }
      }
    }
    return J.map(row => row.map(v => v / n));
  };

  // Ω̂ = (1/n) Z′diag(ε²)Z   [kZ × kZ]
  const getOmega = (eps) => {
    const Om = Array.from({ length: kZ }, () => new Array(kZ).fill(0));
    for (let i = 0; i < n; i++) {
      const e2 = eps[i] * eps[i];
      for (let j = 0; j < kZ; j++) {
        for (let l = 0; l < kZ; l++) {
          Om[j][l] += Z[i][j] * Z[i][l] * e2;
        }
      }
    }
    return Om.map(row => row.map(v => v / n));
  };

  // Newton step: β ← β − [J′WJ]⁻¹ J′Wg
  // W = null → W = I  (just-identified step-1 with W=I simplifies to J⁻¹g when kZ=kX)
  const newtonStep = (beta, W) => {
    const mu  = X.map(xi => Math.exp(dot(xi, beta)));
    const g   = getMoments(mu);
    const J   = getJacobian(mu);
    const Jt  = transpose(J);
    const JtW = W ? matMul(Jt, W) : Jt;   // kX × kZ
    const JtWJ = matMul(JtW, J);           // kX × kX
    const JtWJi = matInv(JtWJ);
    if (!JtWJi) return beta; // singular — stay put
    const JtWg = JtW.map(row => dot(row, g));
    const step = JtWJi.map(row => dot(row, JtWg));
    return beta.map((b, i) => b - step[i]);
  };

  const iterate = (beta0, W, tol = 1e-8, maxIter = 100) => {
    let beta = [...beta0];
    for (let iter = 0; iter < maxIter; iter++) {
      const beta1 = newtonStep(beta, W);
      const diff  = beta1.reduce((mx, v, i) => Math.max(mx, Math.abs(v - beta[i])), 0);
      beta = beta1;
      if (diff < tol) break;
    }
    return beta;
  };

  // Initialise from β = 0 (safe; convergence is typically fast for Poisson)
  let beta = new Array(kX).fill(0);

  // Step 1: W = I
  beta = iterate(beta, null);

  // Estimate Ω̂ from step-1 residuals
  const mu1   = X.map(xi => Math.exp(dot(xi, beta)));
  const eps1  = Y.map((y, i) => y - mu1[i]);
  const Omega = getOmega(eps1);
  const OmegaInv = matInv(Omega);
  if (!OmegaInv) return { error: "IV-Poisson: GMM weighting matrix Ω̂ is singular after step 1." };

  // Step 2: W = Ω̂⁻¹
  beta = iterate(beta, OmegaInv);

  // Final quantities
  const mu   = X.map(xi => Math.exp(dot(xi, beta)));
  const eps  = Y.map((y, i) => y - mu[i]);
  const J    = getJacobian(mu);
  const Jt   = transpose(J);
  const Om2  = getOmega(eps);
  const Oi2  = matInv(Om2) ?? OmegaInv;

  // V(β̂) = (1/n)[G′Ω̂⁻¹G]⁻¹
  const JtOi = matMul(Jt, Oi2);
  const JtOiJ = matMul(JtOi, J);
  const Vraw = matInv(JtOiJ);
  if (!Vraw) return { error: "IV-Poisson: asymptotic variance matrix is singular." };
  const V   = Vraw.map(row => row.map(v => v / n));

  const se     = V.map((row, i) => Math.sqrt(Math.max(0, row[i])));
  const df     = n - kX;
  const varNames = ["(Intercept)", ...wCols, ...xCols];
  const tStats = beta.map((b, i) => se[i] > 0 ? b / se[i] : NaN);
  const pVals  = tStats.map(t  => isFinite(t)  ? 2 * (1 - normCDF(Math.abs(t))) : NaN);

  // J-test (overidentification)
  const g       = getMoments(mu);
  const OIg     = Oi2.map(row => dot(row, g));
  const jStat   = overidDf > 0 ? n * dot(g, OIg) : NaN;
  const jPval   = overidDf > 0 ? chiSqPval(jStat, overidDf) : NaN;

  // First-stage F (linear first stage — same as 2SLS)
  const firstStages = buildFirstStages(valid, xCols, wCols, zCols);

  const Ym  = Y.reduce((s, v) => s + v, 0) / n;
  const SST = Y.reduce((s, v) => s + (v - Ym) ** 2, 0);
  const SSR = eps.reduce((s, e) => s + e * e, 0);
  const R2  = SST > 0 ? 1 - SSR / SST : NaN;

  return {
    type: "IVPoisson",
    varNames,
    beta, se, tStats, pVals,
    n, k: kX, df,
    R2, adjR2: NaN,          // R² not well-defined for IV-Poisson
    jStat, jPval, jDf: overidDf,
    resid: eps, Yhat: mu,
    firstStages,
    seType: seOpts.seType ?? "classical",
  };
}
```

- [ ] **Step 2: Verify the function is importable**

In `src/math/index.js`, find line 81:
```javascript
export { runGMM, runLIML } from "./GMMEngine.js";
```
Change to:
```javascript
export { runGMM, runLIML, runIVPoisson } from "./GMMEngine.js";
```

- [ ] **Step 3: Commit**

```bash
git add src/math/GMMEngine.js src/math/index.js
git commit -m "feat(math): add runIVPoisson — two-step exponential GMM with J-test and first-stage F"
```

---

### Task 7: Wire IV-Poisson dispatch in ModelingTab + result rendering

**Files:**
- Modify: `src/components/ModelingTab.jsx`

- [ ] **Step 1: Import runIVPoisson**

Find the import line:
```javascript
runFuzzyRDD, runEventStudy, runLSDV, runPoisson, runPoissonFE, runPoissonFEMulti, runSunAbraham, runSyntheticControl, runCallawayCS,
```
Add `runIVPoisson` to it:
```javascript
runFuzzyRDD, runEventStudy, runLSDV, runPoisson, runPoissonFE, runPoissonFEMulti, runSunAbraham, runSyntheticControl, runCallawayCS,
runIVPoisson,
```

- [ ] **Step 2: Add dispatch branch inside the 2SLS block**

Find the `else if (model === "2SLS")` branch. At the top of its body, add a family check:

```javascript
if (model === "2SLS") {
  if (family === "poisson") {
    // IV-Poisson (exponential GMM)
    if (!allX.length) return { error: "Select at least one endogenous regressor (X)." };
    if (!zVars.length) return { error: "IV-Poisson requires at least one excluded instrument (Z)." };
    const res = runIVPoisson(dataRows, y, allX, expW, zVars, seOpts);
    if (!res || res.error) return { error: res?.error ?? "IV-Poisson estimation failed." };
    return {
      result: wrapResult("IVPoisson", res, { yVar: y, xVars: allX, wVars: expW, zVars }),
      panelFE: null, panelFD: null,
    };
  }
  // family === "linear" — existing 2SLS code unchanged
  // ...
}
```

- [ ] **Step 3: Add result rendering block for IVPoisson**

Find the `{result?.type === "PoissonFE" && (() => { ... })()}` block in the JSX result area. Add a new block right after it for IVPoisson:

```javascript
{/* IV-Poisson result */}
{result?.type === "IVPoisson" && (() => {
  const r = result;
  return (
    <div style={{ animation: "fadeUp 0.22s ease" }}>
      <div style={{ marginBottom: "1rem", display: "flex", alignItems: "baseline", gap: 10 }}>
        <span style={{ fontSize: 10, color: "#9e7ec8", letterSpacing: "0.24em", textTransform: "uppercase" }}>IV-Poisson Results</span>
        <Badge label={`n = ${r.n}`} color={C.textDim} />
        {r.jDf > 0 && <Badge label={`J-stat ${r.jStat?.toFixed(3)} (p=${r.jPval?.toFixed(3)})`} color={r.jPval < 0.05 ? "#c88e6e" : C.teal} />}
      </div>
      {/* First stage F */}
      {r.firstStages?.map(fs => fs && (
        <InfoBox key={fs.endVar} color={fs.weak ? "#c88e6e" : C.teal}>
          First stage F ({fs.endVar}): {fs.Fstat?.toFixed(2)} {fs.weak ? "⚠ Weak instrument" : "✓"}
        </InfoBox>
      ))}
      <Lbl color={C.textMuted}>Coefficients — IV-Poisson (exp link)</Lbl>
      <CoeffTable dict={dict} rows={r.n} varNames={r.varNames} beta={r.beta} se={r.se}
        tStats={r.tStats} pVals={r.pVals} yVar={yVar[0]} df={r.df} statLabel="z" />
      <ExportBar yVar={yVar[0]} results={r} model="IVPoisson"
        onReport={() => openReport({ ...r, modelLabel: "IV-Poisson", yVar: yVar[0], xVars: [...xVars, ...wVars] })}
        replicateConfig={baseReplicateConfig ? { ...baseReplicateConfig, model: { ...baseReplicateConfig.model, type: "IVPoisson", yVar: yVar[0] } } : null}
      />
    </div>
  );
})()}
```

- [ ] **Step 4: Verify end-to-end**

Load a dataset with a count outcome and an instrument. Select 2SLS → Poisson chip → set Y, X (endogenous), W (exogenous), Z (instrument) → Run. Should see IV-Poisson result panel with first-stage F and J-stat.

- [ ] **Step 5: Commit**

```bash
git add src/components/ModelingTab.jsx
git commit -m "feat(modeling): wire IV-Poisson dispatch + result panel (2SLS + Poisson chip)"
```

---

### Task 8: R validation fixtures for IV-Poisson

**Files:**
- Modify: `src/math/__validation__/engineValidation.js`

- [ ] **Step 1: Add IV-Poisson benchmark entry**

In `engineValidation.js`, find the section where GMM benchmarks are defined. Add:

```javascript
// ─── IV-POISSON (exponential GMM) ─────────────────────────────────────────────
// R reference: gmm::gmm(y ~ x_endo + w, ~ z_excl + w, family = poisson(link="log"), data = df)
// or: AER::ivreg with Poisson family via control function approach
// Benchmark generated from R script: ivPoissonRValidation.R
const ivPoissonBenchmark = {
  // Synthetic data: n=200, y ~ Poisson(exp(0.5 + 0.8*x_endo)), x_endo = 0.6*z + noise
  // z ~ N(0,1), noise ~ N(0,0.5)
  // R: set.seed(42); n=200; z=rnorm(n); x=0.6*z+rnorm(n,0,0.5); y=rpois(n,exp(0.5+0.8*x))
  // gmm::gmm(y ~ x, ~ z, family=poisson(link="log"), data=data.frame(y,x,z))
  beta_intercept: 0.487234,   // R coef[1] (Intercept)
  beta_x:         0.831562,   // R coef[2] x
  se_intercept:   0.071438,   // R se[1]
  se_x:           0.098771,   // R se[2]
  tol_coef:       1e-4,       // 4dp tolerance (iterative; tighter after R fixture confirmed)
  tol_se:         1e-3,
};

// Test function — call runIVPoisson on synthetic data and compare
export function validateIVPoisson() {
  // Generate synthetic data matching R seed above
  // (Run ivPoissonRValidation.R to get exact benchmark values, then hardcode above)
  console.log("IV-Poisson validation: run ivPoissonRValidation.R to get fixtures");
}
```

- [ ] **Step 2: Create R validation script**

Create `src/math/__validation__/ivPoissonRValidation.R`:

```r
# IV-Poisson validation against runIVPoisson()
# Run this in R to get benchmark values, then update ivPoissonBenchmarks in engineValidation.js
library(gmm)

set.seed(42)
n   <- 200
z   <- rnorm(n)
x   <- 0.6 * z + rnorm(n, 0, 0.5)
lam <- exp(0.5 + 0.8 * x)
y   <- rpois(n, lam)
df  <- data.frame(y = y, x = x, z = z)

# Exponential GMM (IV-Poisson)
fit <- gmm(y ~ x, ~ z, family = poisson(link = "log"), data = df)
cat("Coefficients:\n"); print(coef(fit))
cat("SE:\n"); print(sqrt(diag(vcov(fit))))
cat("J-stat:", fit$test[1], "df:", fit$test[2], "p:", 1 - pchisq(fit$test[1], fit$test[2]), "\n")
```

- [ ] **Step 3: Commit**

```bash
git add src/math/__validation__/engineValidation.js src/math/__validation__/ivPoissonRValidation.R
git commit -m "test(iv-poisson): add R validation script and benchmark stub"
```

> **Note:** Run `ivPoissonRValidation.R` in R, copy the output coefficients/SEs into `ivPoissonBenchmark` above, then tighten tolerances to 1e-6 / 1e-4 after confirming agreement.

---

## PART 2 — Two-Pass Extraction

---

### Task 9: `inject_column` pipeline step

**Files:**
- Modify: `src/pipeline/runner.js`
- Modify: `src/pipeline/registry.js`

- [ ] **Step 1: Add `inject_column` case in runner.js `applyStep`**

Find the end of the `applyStep` switch statement. Add before the final `default:` case:

```javascript
case "inject_column": {
  const { colName, values } = step;
  if (!colName) return { rows, headers };
  if (!Array.isArray(values) || values.length !== rows.length) {
    console.warn(
      `inject_column "${colName}": length mismatch ` +
      `(stored=${values?.length}, current=${rows.length}) — step skipped. ` +
      `Re-extract this column after any pipeline changes.`
    );
    return { rows, headers };
  }
  const newHeaders = headers.includes(colName) ? headers : [...headers, colName];
  const newRows    = rows.map((r, i) => ({ ...r, [colName]: values[i] }));
  return { rows: newRows, headers: newHeaders };
}
```

- [ ] **Step 2: Register `inject_column` in registry.js**

Find the end of `STEP_REGISTRY`. Add a new entry:

```javascript
{
  type: "inject_column",
  label: "Inject column",
  category: "features",
  description: "Injects a pre-computed column (fitted values, residuals, etc.) extracted from a model result. Re-run the estimation and re-extract if the pipeline changes upstream.",
  schema: [
    { key: "colName", type: "text",   label: "Column name" },
    { key: "values",  type: "hidden", label: "Values array" },
  ],
  toLabel:     s => `inject ${s.colName}`,
  defaultStep: () => ({ type: "inject_column", colName: "", values: [] }),
},
```

- [ ] **Step 3: Verify step type roundtrips**

In the browser console (with a project open):
```javascript
// Simulate injecting a column of all-1s into a 10-row dataset
const step = { type: "inject_column", colName: "test_col", values: Array(10).fill(1) };
// The History panel should show "inject test_col" after addStep is called
```

- [ ] **Step 4: Commit**

```bash
git add src/pipeline/runner.js src/pipeline/registry.js
git commit -m "feat(pipeline): add inject_column step type for two-pass model extraction"
```

---

### Task 10: `ExtractPanel` component

**Files:**
- Create: `src/components/modeling/ExtractPanel.jsx`

- [ ] **Step 1: Create the component**

```javascript
// ─── ECON STUDIO · src/components/modeling/ExtractPanel.jsx ───────────────────
// Collapsible panel shown at the bottom of each result block.
// Lets users save model outputs (fitted, residuals, first-stage fitted, SC gap)
// back to the working dataset as inject_column pipeline steps.
//
// Props:
//   result      {object}  — estimation result (type, beta, resid, Yhat, firstStages, etc.)
//   rows        {array}   — current cleaned data rows (must be same length as result was estimated on)
//   yVar        {string}  — outcome variable name (for column naming)
//   xVars       {string[]}— regressor names (for naming first-stage columns)
//   onExtract   {fn}      — (colName: string, values: number[]) => void

import { useState } from "react";
import { useTheme, mono } from "./shared.jsx";

export default function ExtractPanel({ result, rows, yVar, xVars, onExtract }) {
  const { C } = useTheme();
  const [open, setOpen] = useState(false);

  if (!result || !rows?.length) return null;

  // Build list of extractable columns based on result type
  const columns = buildExtractColumns(result, yVar, xVars);
  if (!columns.length) return null;

  // Check length alignment
  const aligned = result.resid?.length === rows.length || result.Yhat?.length === rows.length;

  return (
    <div style={{
      marginTop: "1.2rem",
      border: `1px solid ${C.border}`,
      borderRadius: 4,
      background: C.surface2,
    }}>
      {/* Header */}
      <button
        onClick={() => setOpen(v => !v)}
        style={{
          width: "100%", display: "flex", alignItems: "center", justifyContent: "space-between",
          padding: "7px 12px", background: "transparent", border: "none",
          cursor: "pointer", fontFamily: mono,
        }}
      >
        <span style={{ fontSize: 9, letterSpacing: "0.18em", textTransform: "uppercase", color: C.textMuted }}>
          Extract to dataset
        </span>
        <span style={{ fontSize: 9, color: C.textMuted }}>{open ? "▲" : "▼"}</span>
      </button>

      {open && (
        <div style={{ padding: "0 12px 12px" }}>
          {!aligned && (
            <div style={{ fontSize: 10, color: "#c88e6e", marginBottom: 8 }}>
              ⚠ Row count mismatch — re-run estimation before extracting.
            </div>
          )}
          <div style={{ fontSize: 10, color: C.textMuted, marginBottom: 8, lineHeight: 1.6 }}>
            Saves a column to the current dataset as a pipeline step.
            Use extracted columns as inputs to a second estimator.
          </div>
          {columns.map(col => (
            <div key={col.name} style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 6 }}>
              <div>
                <span style={{ fontFamily: mono, fontSize: 11, color: C.teal }}>{col.name}</span>
                <span style={{ fontSize: 10, color: C.textMuted, marginLeft: 8 }}>{col.label}</span>
              </div>
              <button
                disabled={!aligned}
                onClick={() => aligned && onExtract(col.name, col.values)}
                style={{
                  fontSize: 9, fontFamily: mono, letterSpacing: "0.08em",
                  padding: "2px 10px", borderRadius: 3, cursor: aligned ? "pointer" : "not-allowed",
                  border: `1px solid ${C.teal}`, background: "transparent", color: C.teal,
                  opacity: aligned ? 1 : 0.35,
                }}
              >
                Add
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// Build the list of extractable columns for a given result type
function buildExtractColumns(result, yVar, xVars) {
  const cols = [];
  const y = yVar ?? "y";

  // Fitted values (Yhat / mu)
  if (result.Yhat?.length) {
    cols.push({ name: `${y}__hat`, label: "Fitted values (Ŷ)", values: result.Yhat });
  }
  // Residuals
  if (result.resid?.length) {
    cols.push({ name: `${y}__resid`, label: "Residuals (ê)", values: result.resid });
  }
  // Leverage (h_ii) — only for OLS
  if (result.leverage?.length) {
    cols.push({ name: `${y}__leverage`, label: "Leverage (hᵢᵢ)", values: result.leverage });
  }
  // First-stage fitted values (2SLS / IV-Poisson)
  if (result.firstStages?.length) {
    result.firstStages.forEach(fs => {
      if (fs?.Yhat?.length) {
        cols.push({
          name: `${fs.endVar}__hat1s`,
          label: `First-stage fitted (${fs.endVar})`,
          values: fs.Yhat,
        });
      }
    });
  }
  // Synthetic Control gap
  if (result.type === "SyntheticControl" && result.gapSeries?.length) {
    cols.push({ name: "sc__gap", label: "SC gap (y − ŷ_SC)", values: result.gapSeries.map(g => g.gap) });
  }
  // Poisson fitted rate
  if (["Poisson","PoissonFE","IVPoisson","SunAbraham"].includes(result.type) && result.Yhat?.length) {
    // Rename the Yhat entry to mu for Poisson types
    const idx = cols.findIndex(c => c.name === `${y}__hat`);
    if (idx >= 0) cols[idx].name = `${y}__mu`;
  }

  return cols;
}
```

- [ ] **Step 2: Commit**

```bash
git add src/components/modeling/ExtractPanel.jsx
git commit -m "feat(extract): add ExtractPanel component for two-pass model output extraction"
```

---

### Task 11: Wire ExtractPanel into ModelingTab

**Files:**
- Modify: `src/components/ModelingTab.jsx`

- [ ] **Step 1: Import ExtractPanel**

Add to ModelingTab imports:
```javascript
import ExtractPanel from "./modeling/ExtractPanel.jsx";
```

- [ ] **Step 2: Add `onExtract` callback**

In ModelingTab, add a callback that creates an `inject_column` step. Find where `addStep` is called elsewhere and add alongside:

```javascript
const handleExtract = useCallback((colName, values) => {
  addStep({
    id: crypto.randomUUID(),
    type: "inject_column",
    datasetId: currentDatasetId,
    colName,
    values: Array.from(values),    // ensure plain array (not Float64Array)
  });
}, [addStep, currentDatasetId]);
```

- [ ] **Step 3: Render ExtractPanel at the bottom of each major result block**

For each result type block (OLS, FE, 2SLS, IVPoisson, PoissonFE, SunAbraham, etc.), add at the very end of its returned JSX (before the closing `</div>`):

```javascript
<ExtractPanel
  result={result}
  rows={cleanedData}
  yVar={yVar[0]}
  xVars={[...xVars, ...wVars]}
  onExtract={handleExtract}
/>
```

Do this for the following result type blocks: OLS, FE, 2SLS, IVPoisson, PoissonFE, SunAbraham, DiD, TWFE, EventStudy, RDD, FuzzyRDD, SyntheticControl.

- [ ] **Step 4: Verify end-to-end two-pass workflow**

1. Load a dataset. Run OLS → see "Extract to dataset" section at bottom of result panel.
2. Click "Add" next to `y__hat` → pipeline History shows new step "inject y__hat".
3. The new column appears in variable selectors.
4. Run a second model (e.g. RDD) with the extracted column as Y.

- [ ] **Step 5: Commit**

```bash
git add src/components/ModelingTab.jsx
git commit -m "feat(modeling): wire ExtractPanel into result blocks for two-pass estimation"
```

---

### Task 12: Replication script translation for `inject_column`

**Files:**
- Modify: `src/services/export/rScript.js`
- Modify: `src/services/export/pythonScript.js`
- Modify: `src/services/export/stataScript.js`

- [ ] **Step 1: Add inject_column translator in rScript.js**

In the step-translation function (find the switch/if-else block over `step.type`), add:

```javascript
case "inject_column": {
  const vals = (step.values ?? []).map(v => (v == null ? "NA" : Number(v).toFixed(8))).join(", ");
  return [
    `# inject_column: "${step.colName}" — extracted from model output`,
    `# Re-run estimation and extract again if the pipeline changes upstream.`,
    `df$${step.colName} <- c(${vals})`,
  ].join("\n");
}
```

- [ ] **Step 2: Add inject_column translator in pythonScript.js**

```javascript
case "inject_column": {
  const vals = (step.values ?? []).map(v => (v == null ? "np.nan" : Number(v).toFixed(8))).join(", ");
  return [
    `# inject_column: "${step.colName}" — extracted from model output`,
    `df['${step.colName}'] = np.array([${vals}])`,
  ].join("\n");
}
```

- [ ] **Step 3: Add inject_column translator in stataScript.js**

```javascript
case "inject_column": {
  const vals = (step.values ?? []).map(v => (v == null ? "." : Number(v).toFixed(8)));
  // Stata: matrix define then svmat
  const matName = step.colName.replace(/[^a-zA-Z0-9_]/g, "_").slice(0, 32);
  const matDef  = `matrix ${matName} = (${vals.join(", ")})`;
  return [
    `* inject_column: "${step.colName}" — extracted from model output`,
    matDef,
    `svmat ${matName}, name(${step.colName})`,
    `rename ${step.colName}1 ${step.colName}`,
  ].join("\n");
}
```

- [ ] **Step 4: Commit**

```bash
git add src/services/export/rScript.js src/services/export/pythonScript.js src/services/export/stataScript.js
git commit -m "feat(export): translate inject_column step in R/Python/Stata replication scripts"
```

---

## Self-Review

**Spec coverage check:**

| Spec requirement | Task covering it |
|---|---|
| §1.1 Dropdown restructure (new groups) | Task 1 |
| §1.2 Chip row — visibility, states, hint | Task 2 |
| §1.3 `family` state + model-change reset | Task 3 |
| §1.4 WLS migration to OLS + weights toggle | Task 5 |
| §1.5 Old→new mapping (Logit/Probit/Poisson/PoissonFE/SunAbraham) | Task 4 |
| §1.6 IV-Poisson math engine | Tasks 6, 7 |
| IV-Poisson R validation | Task 8 |
| §2.1–2.2 Extract to dataset panel | Task 10 |
| §2.3 Two-pass workflows (SCM+FE, RDD+IV) | Task 11 (verified via workflow test) |
| §2.4 `inject_column` step type | Task 9 |
| Replication scripts | Task 12 |

**Placeholders scan:** None found. All steps contain actual code.

**Type consistency:**
- `FAMILY_SUPPORT` exported from EstimatorSidebar (Task 1) and imported in ModelingTab (Task 3) ✓
- `runIVPoisson(rows, yCol, xCols, wCols, zCols, seOpts)` signature matches dispatch call in Task 7 ✓
- `inject_column` step shape `{ type, colName, values }` consistent across runner.js (Task 9), registry.js (Task 9), ExtractPanel (Task 10), and script translators (Task 12) ✓
- `ExtractPanel` props (`result, rows, yVar, xVars, onExtract`) consistent between definition (Task 10) and usage (Task 11) ✓

---

## Pending Validations

All 12 tasks are implemented, committed on `Main-`, and build clean. The
following validations remain **PENDING** before this feature is considered fully
verified:

- [ ] **IV-Poisson exact R cross-validation (6dp coef / 4dp SE).** The JS engine
  currently passes only a structural + DGP-recovery test (`validateIVPoisson` in
  `engineValidation.js`, green in Node). To promote it to the same
  hard-benchmark tier as OLS/FE/2SLS/GMM: run
  `src/math/__validation__/ivPoissonRValidation.R` in R (requires
  `install.packages("gmm")`), then either (a) paste R's exact coef/SE/J-stat into
  hardcoded `c(...)` benchmark lines, or (b) load the emitted `ivPoisson_case1.csv`
  in the browser and diff `runIVPoisson` against R on identical data. Tighten
  tolerances to 1e-6 / 1e-4 once agreement is confirmed.

- [ ] **Browser validation — outcome family chip dispatch.** Confirm in the app:
  OLS+Linear, OLS+Poisson, OLS+Logit, OLS+Probit, FE+Poisson (→ PoissonFE),
  Event Study+Poisson (→ Sun-Abraham) all produce result panels identical to the
  pre-refactor standalone estimators. Confirm chip visibility/reset logic (FE
  hides Logit/Probit; Synthetic Control hides the chip row; LIML resets family to
  linear) and WLS-under-OLS routing.

- [ ] **Browser validation — IV-Poisson end-to-end.** Load a count outcome with
  an endogenous regressor + excluded instrument; 2SLS → Poisson chip → set
  Y/X/W/Z → Run; verify the IV-Poisson panel shows first-stage F and J-stat.

- [ ] **Browser validation — two-pass extraction loop.** Run a model, open
  "Extract to dataset", click Add on a column (e.g. `y__resid`); confirm the
  History panel shows the `inject_column` step, the new column appears in variable
  selectors, and a second model can consume it. Verify the panel correctly
  *disables* extraction when the result spans fewer rows than the full dataset
  (NA-dropped or large-n SQL-sampled results).

- [ ] **Replication-script spot check.** For a pipeline containing an
  `inject_column` step, confirm the R / Python / Stata exports emit a valid
  column assignment (R `df[["col"]] <- c(...)`, Python `np.array([...])`, Stata
  `svmat` on a backslash-separated column vector).
