# Equation Workbench — Design Spec

**Date:** 2026-05-30
**Module:** CalculateTab redesign
**Status:** Approved (design) — pending implementation plan

## 1. Purpose

Replace the current equation-solving section of CalculateTab with a unified
**Equation Workbench** where economists solve, plot, differentiate, integrate,
and optimize one or many equations *at the same time* — including multi-variable
economic functions (Cobb-Douglas, Solow, Ramsey, utility functions) and
constrained social-planner problems.

The defining capability: **symbolic (closed-form) solving**. Results are produced
as algebraic expressions in the parameters — *no values need to be plugged in* —
so the economics is legible (e.g. `∂Y/∂K = αY/K`, `x* = αm/p_x`, `MRS = p_x/p_y`).
Numeric evaluation is secondary, used only to place markers on the graph.

## 2. Scope decisions (locked)

| Topic | Decision |
|-------|----------|
| Tab composition | CalculateTab = **Workbench** (hero) + **Probability** + **Distributions** as collapsible panels below |
| Moved out | Monte Carlo, Sampling, Permutation → **Stat Simulation** tab (renamed from Simulate) |
| LaTeX Math Pad | **Removed.** Templates migrate into the card library; per-card "copy LaTeX" survives; serious typesetting belongs to the Report module |
| Sessions | **Persist** per-project to IndexedDB, scoped per `pid` |
| Shared parameters | One slider pool per session feeds all equations (not per-equation) |
| Optimize scope | **Unconstrained (A)** + **Constrained Lagrangian (C)**. Both in pass one |
| Solving | **Symbolic-first** (closed form), numeric fallback |
| CAS | **nerdamer** (CDN). SymPy/Pyodide is a documented near-term escalation |
| Shadow-price / term interpretation | **AI premium feature** via `AIService`; raw symbolic + numeric output is always free |
| Deferred to fast-follow | contour/indifference-curve rendering, optimize-mode-B (all critical points), inequality-constraint KKT |

## 3. Session model

The Workbench owns an array of sessions. One is active; tabs across the top
switch / add / rename / close. Each session is pure JSON:

```js
{
  id, name,                       // "Profit max"
  equations: [
    { id, label, expr, kind,      // kind: "objective" | "constraint"
      axis,                       // symbol used as x-axis (objectives only)
      ops: { plot, deriv, integral, solveZero, optimize },
      sense,                      // "max" | "min" (optimize)
      relation }                  // constraint: { lhs, op:"=", rhs }
  ],
  params:  [ { name, value, min, max, step } ],   // shared slider pool (optional)
  choiceVars: ["K"],              // free variables optimized over
  view:   { xRange:[a,b], positiveQuad },
  results: { /* cached last solve, symbolic + numeric */ }
}
```

### Scope-bridge mechanism

A function's symbols partition into three roles:

- **Axis** — one symbol, swept across `xRange` for plotting.
- **Parameters** — every other free symbol, bound to the shared slider pool
  (auto-detected and added with sensible defaults on card creation).
- **Choice variables** — symbols being solved for in an optimization (not fixed).

Symbolic solving does not require the parameters to have values. Sliders are
optional: they refine on-graph markers and enable live comparative statics.

### Persistence

`workbenchStore.js` exposes `loadWorkbench(pid)` / `saveWorkbench(pid, sessions)`
over the existing `services/persistence/indexedDB.js` (new store key
`workbench:<pid>`). Debounced autosave on change; reload on project open — same
pattern as the pipeline.

## 4. Operations

Each card has five independent toggles; all active ops re-run live when any
slider moves. Every op yields **both** a symbolic closed form (primary, KaTeX +
AI input) and a numeric evaluation at current slider values (markers only).

- **▦ plot** — sweep axis across `xRange`, draw curve. Multiple cards overlay
  (teal / gold / blue by order).
- **f′ derivative** — symbolic derivative (closed form); dashed overlay; value at
  cursor/optimum. For production functions this is the marginal product.
- **∫ integral** — definite integral over a draggable sub-interval `[a,b]` of the
  visible range (default = full range). Gold area shading; numeric value.
  Economically: surplus, total damage ∫MD.
- **=0 solve** — symbolic root(s) where tractable, else Brent auto-bracket. Red
  circle markers on the visible range; roots listed in Results.
- **◇ optimize** — mode auto-selected by whether constraint cards exist:

### Unconstrained optimize (A)

No constraint card present. Symbolic FOC: solve `f′(x)=0` in closed form when
possible, classify with `f″`; numeric scan + Newton-polish as fallback. Mark the
dominant extremum on the visible range (red ●); report `x*`, `f(x*)`, `f′=0`.
`sense` toggle picks max vs min. Live-redraws as sliders move.

### Constrained optimize (C)

One or more constraint cards present. Build the Lagrangian
`L = objective − Σ λᵢ·(gᵢ − cᵢ)`, take `∂L/∂(choice vars)` and `∂L/∂λᵢ`, and
solve the FOC **system** symbolically (closed form in parameters); numeric
`solveSystem` (Newton-Raphson) as fallback. Report optimal choice variables,
**each λᵢ as a symbolic shadow price**, and the objective value.

The λ on a damage / budget / resource constraint is the marginal external cost /
shadow value — surfaced as a first-class result (social-planner payoff).

Pass one handles **equality** constraints. Inequality/KKT slackness is deferred.

### Constraint cards

A `kind:"constraint"` card holds a relation like `p*x + q*y = m` or `E <= cap`.
It contributes to the Lagrangian but is not plotted as an ordinary curve.

### Visualization of the constrained case (honest about dimensionality)

- **2 choice variables** — contour plot of the objective (indifference /
  iso-welfare curves) + constraint line + tangency point. *Fast-follow:* contour
  rendering is the one genuinely new primitive; pass one ships
  constrained-optimization **quantitative-first** (choice vars + λ's + objective
  value), the diagram lands right after.
- **>2 choice variables** — quantitative only.
- **1 choice variable + constraint** — plot objective along the axis with the
  feasible region shaded and the constrained optimum marked.

## 5. Symbolic engine

**Library:** nerdamer, loaded via CDN (matching the KaTeX / Observable Plot /
DuckDB-WASM / SheetJS pattern). Used for symbolic differentiation, equation /
system solving, simplification, and LaTeX output.

**Relationship to the numeric engine:**

- Symbolic result is primary (display + AI interpretation).
- Numeric `calcEngine` evaluates the symbolic closed form at slider values to
  place markers, and is the **fallback** when the CAS cannot close a form
  (exotic integrals, intractable systems). Plotting/shading are inherently
  numeric.

**Escalation (near-term, documented):** SymPy via Pyodide (WASM) if nerdamer's
solver proves too weak for real planner problems — handles arbitrary symbolic
solving, positivity assumptions, richer LaTeX, at the cost of multi-second first
load.

**`src/math/calcEngine.js` additions (pure JS, no React):**

- `optimizeUnconstrained(fn, [a,b], sense)` → scan + Newton-polish at `f′=0`,
  classify by `f″`. Returns `{x, value, fp, fpp, kind}`.
- `optimizeConstrained(objExpr, constraintExprs, choiceVars, scope)` → numeric
  Lagrangian FOC fallback via existing `gradient` + `solveSystem`. Returns
  `{choices, multipliers, objectiveValue}`.
- `extractSymbols(expr)` → free-symbol detection to auto-populate params /
  choice vars.

Symbolic counterparts (differentiate, solve, lagrangian, simplify, toLatex) wrap
nerdamer in a thin adapter module so the CAS dependency is isolated and the
SymPy escalation can swap in behind the same interface.

## 6. AI "Interpret" (premium)

Operates on the **symbolic** output — term-by-term economic interpretation of
derivatives, FOCs, optima, and λ's (not just numbers):

> `∂Y/∂K = α·A·K^(α−1)·L^(1−α) = α·Y/K` → "MPK = output elasticity × average
> product of capital." `λ_emissions = 45` → "shadow price of carbon: the marginal
> welfare cost of tightening the cap by one unit."

- New `INTERPRET_OPTIMIZATION_PROMPT` in `services/AI/Prompts/index.js`.
- Thin `interpretOptimization({ snapshot })` in `AIService.js` — routes through
  `callClaude` (single egress choke point, cached `SHARED_CONTEXT` block,
  prompt-caching header). No new fetch path.
- Snapshot includes objective, constraints, symbolic derivatives/FOCs/optima,
  λ's, parameter values, and any variable-dictionary units.
- Gated as premium. Without AI the user still gets the full symbolic + numeric
  output for free; a non-AI interpretation would require the user to hand-specify
  units and economic meaning for every symbol, defeating the convenience.

## 7. Component layout

New folder `src/components/calculate/workbench/` (small focused files):

| File | Responsibility |
|------|----------------|
| `Workbench.jsx` | Session array state + persistence + layout orchestration |
| `SessionTabs.jsx` | Top tab bar (switch / add / rename / close) |
| `EquationsPanel.jsx` | Card list + add equation / add constraint + template library |
| `EquationCard.jsx` | One card: expr input, axis selector, op toggles, sense, copy-LaTeX |
| `ParametersPanel.jsx` | Shared slider pool (auto-populated from detected symbols) |
| `WorkbenchCanvas.jsx` | Plotter: curves, f′ overlay, integral shading, root/optimum markers |
| `ResultsPanel.jsx` | Live symbolic + numeric readout, copy buttons, AI "Interpret" |
| `templates.js` | Migrated equation library (Cobb-Douglas, Solow, Euler, NKPC…) as card seeds |
| `workbenchStore.js` | `loadWorkbench(pid)` / `saveWorkbench(pid, sessions)` over indexedDB.js |
| `casAdapter.js` | nerdamer wrapper (differentiate / solve / lagrangian / simplify / toLatex); isolates CAS dependency for SymPy escalation |

**Edits to existing files:**

- `CalculateTab.jsx` — remove MathPad, FunctionGrapher, Monte Carlo / Sampling /
  Permutation; render `<Workbench/>` + collapsible Probability + Distributions.
- `SimulateTab.jsx` — receive Monte Carlo / Sampling / Permutation.
- `WorkspaceBar.jsx` — rename tab Simulate → "Stat Simulation".
- `services/AI/Prompts/index.js` — add `INTERPRET_OPTIMIZATION_PROMPT`.
- `services/AI/AIService.js` — add `interpretOptimization`.
- `services/persistence/indexedDB.js` — workbench store helpers (or via `workbenchStore.js`).

## 8. Design language

Inline styles only, `C` palette (`C.bg` #080808, `C.teal` #6ec8b4, `C.gold`
#c8a96e, `C.blue` #6e9ec8, `C.red` #c86e6e), IBM Plex Mono (`mono`). No external
UI component libraries. nerdamer/KaTeX are math/render libraries, not UI.

## 9. Out of scope (this spec)

- Contour / indifference-curve rendering (fast-follow).
- Optimize-mode-B (enumerate all critical points).
- Inequality-constraint KKT slackness.
- SymPy/Pyodide CAS (documented escalation, behind `casAdapter.js`).
- Applying interactive graphs/sliders to Stat Simulation (separate later effort).
