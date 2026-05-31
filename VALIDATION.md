# Validation queue — browser checks pending

Franco validates each item live (Vercel or `npm run dev`) before the feature is
considered done. Tick the box once verified.

---

## 2026-05-30 — Equation Workbench (Calculate tab)

Open **Calculate → Equation Workbench**. Add an objective equation, give it a
label, type an expression, and pick an axis variable (e.g. `f`, `x^2 - 2*x`, axis `x`).

### 1. Layout
- [ ] Graph sits in the **bottom half**, full-width and larger than before.
- [ ] Inputs (equations + parameters) are **top-left**, outputs (results) **top-right**.

### 2. Syntax hint
- [ ] The "How to calculate" HintBox is **above** the Workbench, not below it.
- [ ] First hint section explains writing expressions: `*` multiply, `**` or `^`
      exponent, `/` divide, functions `sqrt/exp/log/sin`, named params → sliders.

### 3. Integral bounds
- [ ] Enable the **∫ integral** op on a card → bound inputs `a → b` appear,
      pre-filled from the current x-range.
- [ ] Change `a` and `b` → the integral result and the gold shading under the
      curve update to the new interval.
- [ ] Clearing both bounds falls back to the view x-range.

### 4. View controls
- [ ] **x min / x max** number inputs rescale the plot horizontally (rejected if
      `x min ≥ x max`).
- [ ] **y min / y max** inputs override auto-scale; clearing both returns to auto
      (placeholder shows "auto").
- [ ] **height** slider resizes the graph (240–820px).

### 5. Export to R / Python / Stata (option B — Workbench equations)
Build a session with: an objective `f` (axis `x`), a named param, and enable
deriv / integral / solveZero / optimize on it. Click **↓R**, **↓py**, **↓Stata**
in the Workbench header.
- [ ] **↓R** downloads `workbench.R` — equation as `f <- function(x) ...`,
      `D(quote(...), "x")`, `integrate(f, a, b)$value`, `uniroot(...)`, `optimize(...)`.
- [ ] **↓py** downloads `workbench.py` — `import sympy`, `sp.diff/integrate/solve`,
      with `**` exponents.
- [ ] **↓Stata** downloads `workbench.do` — `twoway function`, Mata numeric
      derivative / trapezoid integral / grid-search optimize / sign-change root scan.
- [ ] Constraints (if any) appear as commented notes at the bottom of each script.
- [ ] The **legacy Variable Workspace** export buttons (separate panel) still work
      as before — they were left untouched.

---

## Already queued (from CLAUDE.md Pending)

### Report module — AI script generation context (item 5b)
- [ ] Load a `;`-delimited CSV / Excel-with-sheet / `.dta`, then verify the
      R / Python / Stata **unified scripts** emit the correct load call
      (`read_delim(..., delim=";")`, Excel sheet name, `read_stata` for `.dta`).

### Polynomial RDD (item 5a)
- [ ] rdrobust comparison for `p > 1` (`rdrobust(y, x, c=0, p=2/3)`) — needs R fixtures.
- [ ] Fuzzy RDD polynomial validation.
- [ ] DuckDB SQL path for poly RDD (currently JS fallback for all `p > 1`).
- [ ] SE-type coverage for poly (HC / clustered benchmarks).
