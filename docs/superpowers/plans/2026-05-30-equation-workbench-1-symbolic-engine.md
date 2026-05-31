# Equation Workbench — Plan 1: Symbolic Engine Foundation

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the React-free symbolic + numeric math foundation for the Equation Workbench — a backend-agnostic CAS adapter (nerdamer backend), plus numeric optimization fallbacks in `calcEngine.js` — all validated in the browser against analytic ground truth.

**Architecture:** A single `cas` facade (`src/math/cas/casAdapter.js`) exposes symbolic operations; `nerdamerBackend.js` maps that surface onto nerdamer (loaded via CDN). When a symbolic solve cannot close, callers fall back to numeric routines in `calcEngine.js`. A browser validation harness exposes `window.__validation.workbench` with pass/fail cells, matching the existing `engineValidation.js` pattern.

**Tech Stack:** Pure JS (no React in `src/math/`), nerdamer 1.1.13 (`all.min.js` bundle via jsDelivr CDN), existing `calcEngine.js` numeric primitives (`gradient`, `solveSystem`, `derivative`), browser `window.__validation` harness.

**Spec:** `docs/superpowers/specs/2026-05-30-equation-workbench-design.md` (§5 engine, §5.1 adapter contract, §5.2 nerdamer, §5.4 shared Lagrangian, §5.5 numeric, §5.6 result contract, §10 security).

---

## File structure

Create:
```
src/math/cas/
├── casAdapter.js        ← backend-agnostic facade (§5.1); selects backend; shared lagrangianFOC; result helper
├── nerdamerBackend.js   ← Backend A: CDN loader + nerdamer mappings (§5.2)
src/math/__validation__/
└── workbenchEngineValidation.js  ← window.__validation.workbench cells (analytic ground truth)
```

Modify:
```
src/math/calcEngine.js   ← add extractSymbols, optimizeUnconstrained, optimizeConstrained (§5.5)
```

Ground-truth fixtures used throughout (textbook closed forms; cross-checkable in R):

| Case | Setup | Expected |
|------|-------|----------|
| Cobb-Douglas MPK | `Y=A*K^alpha*L^(1-alpha)`, A=1, alpha=0.3, K=4, L=9 | `dY/dK = alpha*A*K^(alpha-1)*L^(1-alpha)`; numeric MPK = **0.529231** |
| Profit max (unconstrained) | `pi = 4*sqrt(K) - K - 2` (p=2,A=1,alpha=0.5,L=4,r=1,w=0.5) | K\* = **4**, pi\* = **2**, f″<0 (max) |
| Utility max (constrained) | max `x^0.4*y^0.6` s.t. `2x+5y=100` | x\*=**20**, y\*=**12**, lambda_budget=**0.147210** |
| extractSymbols | `A*K^alpha*L^(1-alpha)` | `["A","K","L","alpha"]` (sorted) |

**Security note (§10):** the validation harness must NOT use any app-side dynamic code compiler to evaluate expressions. All numeric evaluation goes through nerdamer (`cas.evalAt` / `cas.compile`), which parses strings into its own AST and never executes raw user input as code.

---

## Task 1: nerdamer CDN loader + casAdapter skeleton

**Files:**
- Create: `src/math/cas/nerdamerBackend.js`
- Create: `src/math/cas/casAdapter.js`

- [ ] **Step 1: Write the nerdamer loader + parse/freeSymbols/toLatex/evalAt**

Create `src/math/cas/nerdamerBackend.js`:

```js
// Backend A — maps the casAdapter surface (§5.1) onto nerdamer.
// nerdamer loads from CDN as a global; we never bundle it.
const NERDAMER_URL = "https://cdn.jsdelivr.net/npm/nerdamer@1.1.13/all.min.js";

let loadPromise = null;

function loadNerdamer() {
  if (typeof window !== "undefined" && window.nerdamer) return Promise.resolve(window.nerdamer);
  if (loadPromise) return loadPromise;
  loadPromise = new Promise((resolve, reject) => {
    const s = document.createElement("script");
    s.src = NERDAMER_URL;
    s.async = true;
    s.onload = () => (window.nerdamer ? resolve(window.nerdamer) : reject(new Error("nerdamer global missing after load")));
    s.onerror = () => reject(new Error("failed to load nerdamer from CDN"));
    document.head.appendChild(s);
  });
  return loadPromise;
}

let N = null; // cached nerdamer global once ready

export const nerdamerBackend = {
  name: "nerdamer",
  async ready() { N = await loadNerdamer(); },

  // A CasExpr for this backend is just the nerdamer expression's string form.
  parse(src) { return N(src).toString(); },

  freeSymbols(expr) {
    // nerdamer(expr).variables() -> array of variable names
    return N(expr).variables().slice().sort();
  },

  toLatex(expr) { return N(expr).toTeX(); },

  // Numeric evaluation by substitution — through nerdamer's parser, never raw eval (§10).
  evalAt(expr, scope) {
    const subs = {};
    for (const [k, v] of Object.entries(scope)) subs[k] = String(v);
    return Number(N(expr, subs).evaluate().text());
  },
};
```

- [ ] **Step 2: Write the casAdapter facade that delegates to the active backend**

Create `src/math/cas/casAdapter.js`:

```js
// Backend-agnostic facade (§5.1). App code imports ONLY `cas`, never a backend.
import { nerdamerBackend } from "./nerdamerBackend.js";

let active = nerdamerBackend;          // default backend (Plan 1)
let readyPromise = null;

export const cas = {
  backend() { return active.name; },
  ready() {
    if (!readyPromise) readyPromise = active.ready();
    return readyPromise;
  },
  parse(src) { return active.parse(src); },
  freeSymbols(e) { return active.freeSymbols(e); },
  toLatex(e) { return active.toLatex(e); },
  evalAt(e, scope) { return active.evalAt(e, scope); },
  // diff / solve / solveSystem / lagrangianFOC / substitute / compile added in later tasks
};

// For the SymPy escalation (backend B), expose a setter behind the same surface.
export function _setCasBackend(backend) { active = backend; readyPromise = null; }
```

- [ ] **Step 3: Commit**

```bash
git add src/math/cas/nerdamerBackend.js src/math/cas/casAdapter.js
git commit -m "feat(cas): nerdamer CDN loader + backend-agnostic casAdapter skeleton"
```

---

## Task 2: cas.diff (symbolic derivative) + validation harness

**Files:**
- Modify: `src/math/cas/nerdamerBackend.js`
- Modify: `src/math/cas/casAdapter.js`
- Create: `src/math/__validation__/workbenchEngineValidation.js`

- [ ] **Step 1: Add `diff` and `simplify` to the nerdamer backend**

In `src/math/cas/nerdamerBackend.js`, add to the `nerdamerBackend` object (before the closing `}`):

```js
  diff(expr, varName) { return N.diff(expr, varName).toString(); },
  simplify(expr) { return N(expr).expand().toString(); },
```

- [ ] **Step 2: Expose `diff`/`simplify` on the facade**

In `src/math/cas/casAdapter.js`, add inside the `cas` object after `evalAt`:

```js
  diff(e, v) { return active.diff(e, v); },
  simplify(e) { return active.simplify(e); },
```

- [ ] **Step 3: Write the validation harness with the Cobb-Douglas derivative cell**

Create `src/math/__validation__/workbenchEngineValidation.js`:

```js
// Browser validation harness for the Workbench symbolic+numeric engine.
// Exposes window.__validation.workbench() -> Promise<{ cells, allPass }>.
// Ground truth is analytic (textbook closed forms), cross-checkable in R.
// SECURITY (§10): numeric evaluation goes through cas.evalAt / cas.compile only.
import { cas } from "../cas/casAdapter.js";

const approx = (a, b, tol = 1e-5) => Math.abs(a - b) <= tol;

export async function runWorkbenchValidation() {
  await cas.ready();
  const cells = [];

  // Cell 1: Cobb-Douglas MPK. d/dK [A*K^alpha*L^(1-alpha)] at A=1,alpha=0.3,K=4,L=9.
  {
    const d = cas.diff("A*K^alpha*L^(1-alpha)", "K");
    const val = cas.evalAt(d, { A: 1, alpha: 0.3, K: 4, L: 9 });
    cells.push({ name: "cobb-douglas-MPK", expected: 0.529231, got: val, pass: approx(val, 0.529231) });
  }

  const allPass = cells.every((c) => c.pass);
  return { cells, allPass };
}

if (typeof window !== "undefined") {
  window.__validation = window.__validation || {};
  window.__validation.workbench = runWorkbenchValidation;
}
```

- [ ] **Step 4: Register the harness so it loads in the app**

Find where the existing harness attaches to `window.__validation` and import the new one alongside it:

Run: `grep -rn "__validation" src/ --include=*.js --include=*.jsx -l`
Then add this import to the same entry module that imports `engineValidation.js` (e.g. near the top of `src/DataStudio.jsx` or wherever `engineValidation` is imported):

```js
import "./math/__validation__/workbenchEngineValidation.js";
```

- [ ] **Step 5: Run validation in the browser**

Run: `npm run dev`
Open the app URL, open DevTools console, run:
```js
await window.__validation.workbench()
```
Expected: `{ cells: [{ name: "cobb-douglas-MPK", pass: true, got: ~0.529231 }], allPass: true }`

- [ ] **Step 6: Commit**

```bash
git add src/math/cas/nerdamerBackend.js src/math/cas/casAdapter.js src/math/__validation__/workbenchEngineValidation.js
git commit -m "feat(cas): symbolic diff + Cobb-Douglas MPK validation cell"
```

---

## Task 3: extractSymbols (calcEngine) + validation

**Files:**
- Modify: `src/math/calcEngine.js`
- Modify: `src/math/__validation__/workbenchEngineValidation.js`

- [ ] **Step 1: Add `extractSymbols` to calcEngine**

At the end of `src/math/calcEngine.js`, add:

```js
// Free-symbol detection for auto-populating params / choice vars (§5.5).
// Regex tokenizer; reserved math identifiers are excluded.
const RESERVED = new Set([
  "abs","sqrt","exp","log","ln","sin","cos","tan","asin","acos","atan",
  "pow","min","max","pi","e","floor","ceil","round","sign","E","PI",
]);
export function extractSymbols(expr) {
  const ids = expr.match(/[A-Za-z_][A-Za-z0-9_]*/g) || [];
  const set = new Set();
  for (const id of ids) if (!RESERVED.has(id)) set.add(id);
  return Array.from(set).sort();
}
```

- [ ] **Step 2: Add the extractSymbols validation cell**

In `src/math/__validation__/workbenchEngineValidation.js`, add the import at top:

```js
import { extractSymbols } from "../calcEngine.js";
```

Then inside `runWorkbenchValidation`, before `const allPass`, add:

```js
  // Cell 2: extractSymbols on a Cobb-Douglas production function.
  {
    const syms = extractSymbols("A*K^alpha*L^(1-alpha)");
    const exp = ["A", "K", "L", "alpha"];
    const pass = syms.length === exp.length && exp.every((s, i) => s === syms[i]);
    cells.push({ name: "extract-symbols", expected: exp, got: syms, pass });
  }
```

- [ ] **Step 3: Run validation in the browser**

Run: `npm run dev` (if not already running), then in console:
```js
await window.__validation.workbench()
```
Expected: `allPass: true`; cell `extract-symbols` has `pass: true`, `got: ["A","K","L","alpha"]`.

- [ ] **Step 4: Commit**

```bash
git add src/math/calcEngine.js src/math/__validation__/workbenchEngineValidation.js
git commit -m "feat(calc): extractSymbols free-symbol detection + validation"
```

---

## Task 4: optimizeUnconstrained (numeric, mode A) + validation

**Files:**
- Modify: `src/math/calcEngine.js`
- Modify: `src/math/__validation__/workbenchEngineValidation.js`

- [ ] **Step 1: Add `optimizeUnconstrained` to calcEngine**

At the end of `src/math/calcEngine.js`, add (uses the existing `derivative` central-difference helper already exported from this file):

```js
// Unconstrained extremum on [a,b] (§5.5, optimize mode A).
// Scan for the dominant max/min, Newton-polish f'(x)=0, classify via f''.
export function optimizeUnconstrained(fn, a, b, sense = "max") {
  const STEPS = 400;
  const step = (b - a) / STEPS;
  let bestX = a, bestY = fn(a);
  for (let i = 1; i <= STEPS; i++) {
    const x = a + i * step;
    const y = fn(x);
    const better = sense === "max" ? y > bestY : y < bestY;
    if (Number.isFinite(y) && better) { bestY = y; bestX = x; }
  }
  // Newton-polish on f' = 0 around bestX.
  const fp = (x) => derivative(fn, x);
  let x = bestX;
  for (let it = 0; it < 50; it++) {
    const g = fp(x);
    const gp = derivative(fp, x);
    if (!Number.isFinite(g) || !Number.isFinite(gp) || Math.abs(gp) < 1e-12) break;
    const nx = x - g / gp;
    if (!Number.isFinite(nx) || nx < a || nx > b) break;
    if (Math.abs(nx - x) < 1e-10) { x = nx; break; }
    x = nx;
  }
  const fpp = derivative(fp, x);
  const kind = fpp < 0 ? "max" : fpp > 0 ? "min" : "saddle";
  return { x, value: fn(x), fp: fp(x), fpp, kind };
}
```

- [ ] **Step 2: Add the profit-max validation cell**

In `src/math/__validation__/workbenchEngineValidation.js`, extend the import:

```js
import { extractSymbols, optimizeUnconstrained } from "../calcEngine.js";
```

Add before `const allPass`:

```js
  // Cell 3: Profit max pi(K)=4*sqrt(K)-K-2 on [0.01, 20]. Expect K*=4, pi*=2, max.
  {
    const pi = (K) => 4 * Math.sqrt(K) - K - 2;
    const r = optimizeUnconstrained(pi, 0.01, 20, "max");
    const pass = approx(r.x, 4, 1e-3) && approx(r.value, 2, 1e-3) && r.kind === "max";
    cells.push({ name: "profit-max", expected: { x: 4, value: 2, kind: "max" }, got: r, pass });
  }
```

- [ ] **Step 3: Run validation in the browser**

Run console:
```js
await window.__validation.workbench()
```
Expected: `profit-max` cell `pass: true`, `got.x ≈ 4`, `got.value ≈ 2`, `got.kind === "max"`.

- [ ] **Step 4: Commit**

```bash
git add src/math/calcEngine.js src/math/__validation__/workbenchEngineValidation.js
git commit -m "feat(calc): optimizeUnconstrained (mode A) + profit-max validation"
```

---

## Task 5: cas.solve / cas.solveSystem + lagrangianFOC builder

**Files:**
- Modify: `src/math/cas/nerdamerBackend.js`
- Modify: `src/math/cas/casAdapter.js`
- Modify: `src/math/__validation__/workbenchEngineValidation.js`

- [ ] **Step 1: Add `solve` and `solveSystem` to the nerdamer backend**

In `src/math/cas/nerdamerBackend.js`, add to the backend object:

```js
  // Roots of expr = 0 for varName. Returns CasSolution {closed, solutions}.
  solve(expr, varName) {
    try {
      const sols = N.solve(expr, varName); // nerdamer vector, e.g. [2,-2]
      const arr = sols.toString().replace(/^\[|\]$/g, "").split(",").map((s) => s.trim()).filter(Boolean);
      return { closed: arr.length > 0, solutions: arr.map((s) => ({ [varName]: s })) };
    } catch {
      return { closed: false, solutions: [] };
    }
  },

  // Symbolic system solve. eqs are expressions implicitly = 0; vars is the list to solve for.
  solveSystem(eqs, vars) {
    try {
      const equations = eqs.map((e) => `${e}=0`);
      const res = N.solveEquations(equations, vars); // may throw or return [] on hard nonlinear
      if (!res || !res.length) return { closed: false, solutions: [] };
      const sol = {};
      for (const pair of res) sol[pair[0]] = pair[1].toString(); // [var, value] pairs
      const closed = vars.every((v) => v in sol);
      return { closed, solutions: closed ? [sol] : [] };
    } catch {
      return { closed: false, solutions: [] };
    }
  },
```

- [ ] **Step 2: Expose `solve`/`solveSystem` + shared `lagrangianFOC` on the facade**

In `src/math/cas/casAdapter.js`, add inside the `cas` object after `simplify`:

```js
  solve(e, v) { return active.solve(e, v); },
  solveSystem(eqs, vars) { return active.solveSystem(eqs, vars); },

  // Shared (backend-independent) Lagrangian FOC builder (§5.4).
  // L = obj - sum lambda_i (g_i); each g_i provided as "(lhs)-(rhs)" (=0 at feasibility).
  lagrangianFOC(obj, constraints, choiceVars) {
    const multipliers = constraints.map((_, i) => `lambda_${i + 1}`);
    let L = `(${obj})`;
    constraints.forEach((g, i) => { L += ` - ${multipliers[i]}*(${g})`; });
    const equations = [];
    for (const v of choiceVars) equations.push(active.diff(L, v));
    for (const m of multipliers) equations.push(active.diff(L, m));
    return { L, equations, multipliers };
  },
```

- [ ] **Step 3: Add a lagrangianFOC structural validation cell**

In `src/math/__validation__/workbenchEngineValidation.js`, add before `const allPass`:

```js
  // Cell 4: lagrangianFOC structure for utility max s.t. budget.
  // obj = x^0.4*y^0.6 ; constraint g = 2*x+5*y-100 ; choiceVars [x,y].
  {
    const foc = cas.lagrangianFOC("x^0.4*y^0.6", ["2*x+5*y-100"], ["x", "y"]);
    const pass = foc.equations.length === 3 && foc.multipliers.length === 1 && foc.multipliers[0] === "lambda_1";
    cells.push({ name: "lagrangian-structure", expected: { eqs: 3, mult: "lambda_1" }, got: { eqs: foc.equations.length, mult: foc.multipliers[0] }, pass });
  }
```

- [ ] **Step 4: Run validation in the browser**

Run console:
```js
await window.__validation.workbench()
```
Expected: `lagrangian-structure` cell `pass: true` (3 equations, multiplier `lambda_1`).

- [ ] **Step 5: Commit**

```bash
git add src/math/cas/nerdamerBackend.js src/math/cas/casAdapter.js src/math/__validation__/workbenchEngineValidation.js
git commit -m "feat(cas): solve/solveSystem + shared lagrangianFOC builder"
```

---

## Task 6: optimizeConstrained (numeric Lagrangian fallback) + validation

**Files:**
- Modify: `src/math/calcEngine.js`
- Modify: `src/math/__validation__/workbenchEngineValidation.js`

- [ ] **Step 1: Confirm the existing `solveSystem` signature**

Run: `grep -n "export function solveSystem" src/math/calcEngine.js`
Read the function to confirm it takes `(residualFn, x0)` where `residualFn(vec) -> number[]` and returns the solved vector. The next step's `optimizeConstrained` calls it that way. If the signature differs, adapt the CALL in `optimizeConstrained` to match — do NOT modify `solveSystem` itself (other engines depend on it).

- [ ] **Step 2: Add `optimizeConstrained` to calcEngine**

At the end of `src/math/calcEngine.js`, add (uses existing `gradient`/`solveSystem`/`derivative` exports):

```js
// Numeric constrained optimization via Lagrangian FOC (§5.5, optimize mode C fallback).
// obj: (scope)=>number ; constraints: [{ g:(scope)=>number }] where g=0 is feasibility.
// choiceVars: names of decision variables. base: fixed param values (scope).
export function optimizeConstrained(obj, constraints, choiceVars, base = {}) {
  const mults = constraints.map((_, i) => `lambda_${i + 1}`);
  const unknowns = [...choiceVars, ...mults];

  // L(scope) = obj - sum lambda_i * g_i
  const L = (scope) => {
    let v = obj(scope);
    constraints.forEach((c, i) => { v -= scope[mults[i]] * c.g(scope); });
    return v;
  };

  // Residual: partial of L wrt every unknown must be 0 at the optimum.
  const residual = (vec) => {
    const scope = { ...base };
    unknowns.forEach((u, i) => { scope[u] = vec[i]; });
    return unknowns.map((u) => {
      const f = (val) => L({ ...scope, [u]: val });
      return derivative(f, scope[u]);
    });
  };

  // Initial guess: choiceVars=10 (positive interior), multipliers=1.
  const x0 = unknowns.map((u) => (mults.includes(u) ? 1 : 10));
  const sol = solveSystem(residual, x0); // Newton-Raphson on the residual system

  const scope = { ...base };
  unknowns.forEach((u, i) => { scope[u] = sol[i]; });
  const choices = {}; choiceVars.forEach((c) => { choices[c] = scope[c]; });
  const multipliers = {}; mults.forEach((m) => { multipliers[m] = scope[m]; });
  return { choices, multipliers, objectiveValue: obj(scope) };
}
```

- [ ] **Step 3: Add the constrained utility-max validation cell**

In `src/math/__validation__/workbenchEngineValidation.js`, extend the import:

```js
import { extractSymbols, optimizeUnconstrained, optimizeConstrained } from "../calcEngine.js";
```

Add before `const allPass`:

```js
  // Cell 5: max x^0.4*y^0.6 s.t. 2x+5y=100. Expect x*=20, y*=12, lambda_1≈0.147210.
  {
    const obj = (s) => Math.pow(s.x, 0.4) * Math.pow(s.y, 0.6);
    const cons = [{ g: (s) => 2 * s.x + 5 * s.y - 100 }];
    const r = optimizeConstrained(obj, cons, ["x", "y"], {});
    const pass = approx(r.choices.x, 20, 1e-2) && approx(r.choices.y, 12, 1e-2) && approx(r.multipliers.lambda_1, 0.147210, 1e-3);
    cells.push({ name: "utility-max-constrained", expected: { x: 20, y: 12, lambda_1: 0.147210 }, got: r, pass });
  }
```

- [ ] **Step 4: Run validation in the browser**

Run console:
```js
await window.__validation.workbench()
```
Expected: `utility-max-constrained` cell `pass: true`, `got.choices ≈ {x:20, y:12}`, `got.multipliers.lambda_1 ≈ 0.1472`.

> If Newton fails to converge from the `x0` guess, raise the choiceVar guess to the budget-feasible midpoint (e.g. `m/(2*price)`); document the working guess in a code comment. Do not loosen the choice-variable tolerance below 1e-2.

- [ ] **Step 5: Commit**

```bash
git add src/math/calcEngine.js src/math/__validation__/workbenchEngineValidation.js
git commit -m "feat(calc): optimizeConstrained Lagrangian fallback + shadow-price validation"
```

---

## Task 7: cas.compile + cas.substitute (symbolic to numeric, restricted scope) + validation

**Files:**
- Modify: `src/math/cas/nerdamerBackend.js`
- Modify: `src/math/cas/casAdapter.js`
- Modify: `src/math/__validation__/workbenchEngineValidation.js`

- [ ] **Step 1: Add `substitute` and `compile` to the nerdamer backend (restricted scope, §10)**

In `src/math/cas/nerdamerBackend.js`, add to the backend object:

```js
  substitute(expr, scope) {
    let e = N(expr);
    for (const [k, v] of Object.entries(scope)) e = e.sub(k, String(v));
    return e.toString();
  },

  // Compile to a numeric function over freeVars. SECURITY (§10): nerdamer's
  // buildFunction produces a pure numeric fn from its own AST — it sees only the
  // declared freeVars, never window/globals/fetch. No app-side dynamic compile.
  compile(expr, freeVars) {
    const fn = N(expr).buildFunction(freeVars);
    return (scope) => fn(...freeVars.map((v) => scope[v]));
  },
```

- [ ] **Step 2: Expose `substitute`/`compile` on the facade**

In `src/math/cas/casAdapter.js`, add inside the `cas` object after `lagrangianFOC`:

```js
  substitute(e, scope) { return active.substitute(e, scope); },
  compile(e, freeVars) { return active.compile(e, freeVars); },
```

- [ ] **Step 3: Add the compile validation cell (closes the symbolic to numeric loop)**

In `src/math/__validation__/workbenchEngineValidation.js`, add before `const allPass`:

```js
  // Cell 6: compile the symbolic MPK and evaluate — must match Cell 1's 0.529231.
  {
    const d = cas.diff("A*K^alpha*L^(1-alpha)", "K");
    const f = cas.compile(d, ["A", "alpha", "K", "L"]);
    const val = f({ A: 1, alpha: 0.3, K: 4, L: 9 });
    cells.push({ name: "compile-MPK", expected: 0.529231, got: val, pass: approx(val, 0.529231) });
  }
```

- [ ] **Step 4: Run validation in the browser**

Run console:
```js
await window.__validation.workbench()
```
Expected: `compile-MPK` cell `pass: true`, `got ≈ 0.529231` — proving `cas.compile` agrees with `cas.evalAt` (Cell 1).

- [ ] **Step 5: Commit**

```bash
git add src/math/cas/nerdamerBackend.js src/math/cas/casAdapter.js src/math/__validation__/workbenchEngineValidation.js
git commit -m "feat(cas): substitute + restricted-scope compile + symbolic-to-numeric validation"
```

---

## Task 8: Operation result contract helper (§5.6) + validation

**Files:**
- Modify: `src/math/cas/casAdapter.js`
- Modify: `src/math/__validation__/workbenchEngineValidation.js`

- [ ] **Step 1: Add `buildOpResult` to casAdapter**

In `src/math/cas/casAdapter.js`, add at the bottom of the file (after the `cas` export):

```js
// Dual symbolic+numeric result shape every operation stores in session.results (§5.6).
export function buildOpResult(op, { symbolicExpr = null, numeric = {}, closed = true, error = null }) {
  return {
    op,
    symbolic: {
      expr: symbolicExpr,
      latex: symbolicExpr != null ? safeLatex(symbolicExpr) : null,
      closed,
    },
    numeric,
    source: closed ? "symbolic" : "numeric-fallback",
    error,
  };
}

function safeLatex(expr) {
  try { return cas.toLatex(expr); } catch { return null; }
}
```

- [ ] **Step 2: Add the result-contract shape validation cell**

In `src/math/__validation__/workbenchEngineValidation.js`, change the cas import to also pull `buildOpResult`:

```js
import { cas, buildOpResult } from "../cas/casAdapter.js";
```

Add before `const allPass`:

```js
  // Cell 7: result contract shape (§5.6).
  {
    const d = cas.diff("A*K^alpha*L^(1-alpha)", "K");
    const r = buildOpResult("deriv", { symbolicExpr: d, numeric: { value: 0.529231 }, closed: true });
    const pass =
      r.op === "deriv" &&
      r.source === "symbolic" &&
      r.symbolic.closed === true &&
      typeof r.symbolic.latex === "string" &&
      r.numeric.value === 0.529231 &&
      r.error === null;
    cells.push({ name: "result-contract", expected: "dual shape, source=symbolic", got: r, pass });
  }
```

- [ ] **Step 3: Run validation in the browser**

Run console:
```js
await window.__validation.workbench()
```
Expected: `result-contract` cell `pass: true`; `got.symbolic.latex` is a LaTeX string; `got.source === "symbolic"`.

- [ ] **Step 4: Commit**

```bash
git add src/math/cas/casAdapter.js src/math/__validation__/workbenchEngineValidation.js
git commit -m "feat(cas): buildOpResult dual symbolic+numeric contract + validation"
```

---

## Task 9: Full-suite green + lint

**Files:** none (verification only)

- [ ] **Step 1: Run the full validation suite**

Run: `npm run dev`, then in console:
```js
await window.__validation.workbench()
```
Expected: `allPass: true` with all 7 cells passing:
`cobb-douglas-MPK, extract-symbols, profit-max, lagrangian-structure, utility-max-constrained, compile-MPK, result-contract`.

- [ ] **Step 2: Lint the new files**

Run: `npm run lint`
Expected: no errors in `src/math/cas/*.js` or `src/math/__validation__/workbenchEngineValidation.js`.

- [ ] **Step 3: Final commit if lint produced fixes**

```bash
git add -A src/math/
git commit -m "chore(cas): lint clean — symbolic engine foundation complete"
```

---

## Self-review against spec

- **§5.1 adapter surface** — `parse, freeSymbols, toLatex, evalAt, diff, simplify, solve, solveSystem, lagrangianFOC, substitute, compile, ready, backend` all implemented (Tasks 1,2,5,7) ✓
- **§5.2 nerdamer backend** — CDN loader, version-pinned `all.min.js`, all mappings (Tasks 1,2,5,7) ✓
- **§5.4 shared lagrangianFOC** — backend-independent builder in facade (Task 5) ✓
- **§5.5 numeric fallback** — `extractSymbols, optimizeUnconstrained, optimizeConstrained` (Tasks 3,4,6) ✓
- **§5.6 result contract** — `buildOpResult` dual shape + `source` badge (Task 8) ✓
- **§10 security** — no app-side dynamic code compiler anywhere; all numeric eval via nerdamer (`evalAt`/`compile`), confined to declared freeVars; `_setCasBackend` keeps the SymPy escalation behind the same surface (Tasks 1,7) ✓
- **closed:false fallback rule (§5.1)** — `solve`/`solveSystem` return `{closed:false, solutions:[]}` on failure instead of throwing (Task 5) ✓
- **Method-name consistency** — `cas.evalAt`, `cas.compile`, `cas.diff`, `cas.solveSystem`, `cas.lagrangianFOC`, `buildOpResult`, `optimizeUnconstrained`, `optimizeConstrained`, `extractSymbols` are used identically wherever referenced ✓
- **Not in this plan (by design):** UI (sessions/cards/canvas), AI Interpret, Stat Simulation reorg, SymPy backend B — Plans 2–3 and the escalation slice. The `_setCasBackend` hook and `closed` flag are the seams they plug into.

## Handoff to Plan 2

Plan 2 (Workbench UI) consumes this engine **only** through `cas.*`, `buildOpResult`, and the three `calcEngine` functions. It must not import `nerdamerBackend` directly. Session JSON (§3) and persistence (`workbenchStore.js`) are Plan 2's first tasks; the canvas reads numeric points via `cas.compile`.
