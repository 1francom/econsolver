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

### 5.1 CAS adapter contract (the resumability boundary)

All symbolic work goes through **one interface**, `casAdapter`. No Workbench,
engine, or UI code ever imports nerdamer or SymPy directly — they import only the
adapter. This is what lets a second agent (Sonnet, Codex) swap the backend
without touching the rest of the app. Both backends MUST implement this exact
surface:

```js
// src/math/cas/casAdapter.js — backend-agnostic facade
export const cas = {
  // lifecycle
  ready():                  Promise<void>,        // resolves when backend loaded
  backend():                "nerdamer" | "sympy", // which engine is active

  // parsing / introspection
  parse(src: string):       CasExpr,              // "A*K^alpha*L^(1-alpha)" -> CasExpr
  freeSymbols(e: CasExpr):  string[],             // ["A","K","alpha","L"]
  toLatex(e: CasExpr):      string,

  // calculus / algebra (all return symbolic results)
  diff(e, varName):                 CasExpr,                 // ∂e/∂var
  simplify(e):                      CasExpr,
  solve(e, varName):                CasSolution,             // roots of e = 0
  solveSystem(eqs: CasExpr[], vars: string[]): CasSolution,  // ∇=0 etc.

  // optimization helpers (built on diff + solveSystem)
  lagrangianFOC(obj, constraints: CasExpr[], choiceVars: string[]):
      { L: CasExpr, equations: CasExpr[], multipliers: string[] },

  // symbolic→numeric bridge
  substitute(e, scope: Record<string,number>): CasExpr,
  compile(e, freeVars: string[]):  (scope) => number,  // fast numeric evaluator
};

// CasSolution: { closed: boolean, solutions: { [v: string]: CasExpr }[] }
//   closed === false  ⇒ symbolic solve failed; caller falls back to calcEngine numeric.
// CasExpr is opaque (backend-owned); only the adapter inspects its internals.
```

**Hard rule for both backends:** when a symbolic solve cannot close, return
`{ closed: false, solutions: [] }` rather than throwing. The caller (engine layer)
then routes to the numeric fallback in `calcEngine.js`. Never let CAS failure
crash an operation.

### 5.2 Backend A — nerdamer (default, pass one)

- **Load:** CDN `<script>` (jsDelivr), lazily, same pattern as KaTeX / Observable
  Plot. Pin a version. nerdamer core + `Algebra`, `Calculus`, and `Solve`
  add-ons are all required (diff, solveEquations, toTeX live in those).
- **Mapping:** `parse`→`nerdamer(src)`; `diff`→`nerdamer.diff`; `solve`→
  `nerdamer.solve` / `.solveFor`; `solveSystem`→`nerdamer.solveEquations`;
  `simplify`→`nerdamer(...).expand()/.evaluate()`; `toLatex`→`.toTeX()`;
  `compile`→`nerdamer(e).buildFunction(freeVars)`; `substitute`→
  `nerdamer(e, scope)`.
- **freeSymbols:** `nerdamer(e).variables()`.
- **Known weak spots → return `closed:false`:** non-polynomial systems, transcendental
  roots without closed form, hard symbolic integrals. These fall to numeric.

### 5.3 Backend B — SymPy via Pyodide (escalation, near-term)

Slots in behind the *same* `casAdapter` surface; selected by a build/runtime flag
(`CAS_BACKEND = "sympy"`) or auto-promoted when nerdamer returns `closed:false`
on a problem the user explicitly retries with "solve exactly."

- **Load:** Pyodide (WASM) from CDN, then `pyodide.loadPackage("sympy")`. First
  load is multi-second — show a one-time "loading exact solver…" indicator;
  cache the interpreter for the session. Reuse the existing WASM-tolerant infra
  posture (DuckDB already ships WASM here).
- **Mapping:** `diff`→`sympy.diff`; `solve`→`sympy.solve(eq, var)`; `solveSystem`→
  `sympy.solve(eqs, vars)` / `linsolve`/`nonlinsolve`; `simplify`→`sympy.simplify`;
  `toLatex`→`sympy.latex`; `compile`→`sympy.lambdify(freeVars, e, "math")` (or
  evaluate `subs().evalf()`); `freeSymbols`→`e.free_symbols`; `lagrangianFOC` can
  use `sympy` directly or the shared default implementation below.
- **Why escalate:** arbitrary symbolic systems, positivity/realness assumptions
  (`symbols('K', positive=True)`), and cleaner LaTeX — the things real planner
  problems need when nerdamer stalls.

### 5.4 Shared (backend-independent) logic

`lagrangianFOC` has a default implementation in terms of `diff` + the symbolic
primitives, so it works for *any* backend that implements the core surface:
`L = obj − Σ λᵢ(gᵢ − cᵢ)`; `equations = [∂L/∂choiceVars…, ∂L/∂λᵢ…]`; hand to
`solveSystem(equations, [...choiceVars, ...multipliers])`. A backend may override
it if it has a more direct path. Multiplier names are generated as
`lambda_1, lambda_2, …` and rendered as λ₁, λ₂ in the UI.

### 5.5 `src/math/calcEngine.js` additions (numeric fallback, pure JS, no React)

- `optimizeUnconstrained(fn, [a,b], sense)` → scan + Newton-polish at `f′=0`,
  classify by `f″`. Returns `{x, value, fp, fpp, kind}`.
- `optimizeConstrained(objExpr, constraintExprs, choiceVars, scope)` → numeric
  Lagrangian FOC via existing `gradient` + `solveSystem`. Returns
  `{choices, multipliers, objectiveValue}`.
- `extractSymbols(expr)` → free-symbol detection to auto-populate params /
  choice vars (may delegate to `cas.freeSymbols`).

### 5.6 Operation result contract (what each op stores in `session.results`)

Every operation returns this dual shape so symbolic display, numeric markers, and
AI interpretation all read from one place:

```js
{
  op: "deriv" | "integral" | "solveZero" | "optimize",
  symbolic: { expr: CasExpr|null, latex: string|null, closed: boolean },
  numeric:  { /* op-specific: value, points[], roots[], x*, multipliers{} */ },
  source:   "symbolic" | "numeric-fallback",   // provenance for the UI badge
  error:    string | null
}
```

The UI shows the symbolic LaTeX as the headline; numeric values populate markers
and the live readout; a small badge marks `numeric-fallback` so the user knows
when no closed form was available.

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

**Symbolic engine folder** `src/math/cas/` (pure JS, no React):

| File | Responsibility |
|------|----------------|
| `casAdapter.js` | Backend-agnostic facade (§5.1); selects active backend; shared `lagrangianFOC` |
| `nerdamerBackend.js` | Backend A — maps the §5.1 surface onto nerdamer (CDN loader + mappings, §5.2) |
| `sympyBackend.js` | Backend B — maps the §5.1 surface onto SymPy/Pyodide (escalation, §5.3) |

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

## 9. Agent handoff & build order

Implementable in independent slices so Sonnet/Codex can continue at any boundary.
Each slice is verifiable on its own; later slices depend only on the interfaces
(not internals) of earlier ones.

1. **CAS adapter + nerdamer backend** (`src/math/cas/`). Implement §5.1 surface
   with `nerdamerBackend.js`. Done when: `cas.diff`, `cas.solve`,
   `cas.solveSystem`, `cas.toLatex`, `cas.compile` work on Cobb-Douglas and a
   2-var budget problem, and unclosable solves return `{closed:false}`.
   *No UI yet — testable in isolation.*
2. **calcEngine numeric fallback** (§5.5). `optimizeUnconstrained`,
   `optimizeConstrained`, `extractSymbols`. Validate vs known closed forms.
3. **Session model + store** (`workbenchStore.js`, session JSON §3). Load/save
   per `pid` over IndexedDB; round-trip a session.
4. **Workbench shell + sessions** (`Workbench.jsx`, `SessionTabs.jsx`). Tabs,
   add/rename/close, persistence wired. Empty canvas placeholder.
5. **Equation cards + parameter pool** (`EquationsPanel.jsx`, `EquationCard.jsx`,
   `ParametersPanel.jsx`, `templates.js`). Symbol auto-detection → params;
   axis selector; op toggles; template library.
6. **Operations + result contract** (§5.6) wired card → `cas`/`calcEngine` →
   `session.results`. plot/deriv/integral/solveZero/optimize(A)/optimize(C-eq).
7. **Canvas** (`WorkbenchCanvas.jsx`). Curves, f′ overlay, integral shading,
   root/optimum markers; live re-render on slider change.
8. **Results panel** (`ResultsPanel.jsx`). Symbolic LaTeX headline + numeric
   readout + `numeric-fallback` badge + copy buttons.
9. **AI Interpret** (§6). `INTERPRET_OPTIMIZATION_PROMPT` + `interpretOptimization`.
10. **Reorg** — move Monte Carlo/Sampling/Permutation to Stat Simulation; rename
    tab; fold Probability/Distributions into collapsibles under the Workbench.

**Escalation slice (when needed):** `sympyBackend.js` implementing the same §5.1
surface; flip `CAS_BACKEND` or auto-promote on `closed:false`. No other file
changes — that is the whole point of the adapter boundary.

**Resumability contract for any agent:** touch the CAS only through `cas.*`;
preserve the §5.6 result shape; keep `src/math/` and `src/core/` React-free;
inline styles + `C` palette + IBM Plex Mono; surgical edits over rewrites.

## 10. Out of scope (this spec)

- Contour / indifference-curve rendering (fast-follow).
- Optimize-mode-B (enumerate all critical points).
- Inequality-constraint KKT slackness.
- Applying interactive graphs/sliders to Stat Simulation (separate later effort).

Note: SymPy/Pyodide is **in scope** as backend B (§5.3) — fully specified behind
the adapter, built as the escalation slice (§9). It is not deferred work; it is a
defined alternative implementation any agent can complete against the §5.1
contract.
