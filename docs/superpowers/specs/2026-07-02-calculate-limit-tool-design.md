# Calculate tab — Limit tool

**Date:** 2026-07-02
**Owner:** Franco Medero
**Executor:** Claude Fable 5
**Status:** OPEN — awaiting Franco's spec review before implementation plan
**Source:** ClaudeFB.md, 2026-06-19 batch, Features — "Add limits" (single line, no detail; scope clarified via brainstorming with Franco 2026-07-02)

> **Read this first (executing agent):** you did not see the design conversation.
> Every decision below is locked — do not re-litigate scope. This is a small,
> additive feature: one new numeric-engine export + one new tool panel, both
> mirroring an existing sibling exactly. When in doubt, copy the Derivative
> tool's structure line-for-line and adapt the math. After implementation run
> `npm run build` and `npm run lint:undef` (both must be green). You never mark
> this "done-done" — mark it "code-complete, browser-validation pending Franco"
> (Calculate tab has no Node test harness; verification is via `preview_*` tools
> in the browser, per the CLAUDE.md preview workflow).

---

## 1. Problem

The Calculate tab (`src/components/tabs/CalculateTab.jsx`) has five tools —
Solver (`=`), Derivative (`∂`), Symbolic Derivative (`f′`), Algebra (`Σ`),
Integral (`∫`) — covering equation-solving, differentiation, and integration.
There is no way to compute `lim(x→a) f(x)`. A user flagged this gap via the
in-app feedback widget with the single line "Add limits."

## 2. Decisions (LOCKED)

| # | Decision | Rationale |
|---|----------|-----------|
| D1 | **Numeric, not symbolic.** Evaluate `f(x)` at a sequence of points approaching `a`; do not add a CAS dependency. | Matches 4 of the 5 existing tools (Solver/Derivative/Algebra/Integral are all numeric — only the separate "Symbolic Derivative" tool does pattern-matching on unknown functions, which is a different code path this feature does not touch). No new dependency; `CalculateTab.jsx` does not currently import the Workbench's nerdamer/SymPy CAS layer at all, and pulling it in for one feature is out of scope. |
| D2 | **Two variants: finite-point limit and limit at ±infinity.** No separate one-sided-only mode in the UI. | Confirmed with Franco. The engine still computes the left-approach and right-approach sequences separately internally (required to detect a two-sided limit correctly) and surfaces both values in the result when they disagree — so "the limit doesn't exist, left→A, right→B" is visible — but there is no user-facing toggle to request *only* the left or *only* the right limit. |
| D3 | **New tool button, not folded into Derivative.** Sixth entry in the tool strip: `["limit","lim Limit"]`, alongside the existing five. | Limits are a distinct operation from differentiation; the existing tool-strip pattern (`activeTool` state + one panel per tool) already scales to N tools with zero shared-state risk. |
| D4 | **Approach-point input accepts a number or `inf`/`-inf`/`infinity`/`-infinity` (case-insensitive).** One text field, not a separate "at infinity" checkbox. | Keeps the UI identical in shape to the Derivative tool's "evaluate at" field (`dPoint`), just with a slightly more permissive parser. Simpler than adding a second control. |
| D5 | **Result shape mirrors `derivative`/`nthDerivative`'s existing convention** — a plain object, no exceptions thrown for "limit does not exist" (that is a valid, expected result, not an error). Actual JS exceptions (bad expression syntax, unknown variable) still throw and are caught by the UI same as the Derivative tool's handler does. | Consistency with the codebase's existing numeric-tool result convention; "does not exist" is domain output, not a code error. |

## 3. Engine design — `src/math/calcEngine.js`

Add one new export, placed after `nthDerivative` (near the other numerical-derivative code, since the sequence-convergence technique is closely related). Signature:

```
limit(fn, a, opts = {}) → {
  a, exists: boolean,
  val: number|null,      // the limit value when exists === true
  leftVal: number|null,  // last converged/attempted value approaching from below
  rightVal: number|null, // last converged/attempted value approaching from above
  note: string,          // human-readable: "converges", "diverges to +Infinity",
                          // "left/right disagree", "oscillates / does not converge"
}
```

`fn` is a plain `number → number` JS function (the caller — the UI layer — is
responsible for building it from the user's expression string; the engine
itself never sees or evaluates a string). `a` may be a finite number,
`Infinity`, or `-Infinity`.

Algorithm:

- **Finite `a`:** step sizes `h_k = h0 / 10^k` for `k = 0..7` (`h0` defaults to
  `0.1`, matching the existing `derivative` default step's order of magnitude
  but coarser since we need multiple points, not one). Evaluate
  `fn(a - h_k)` (left sequence) and `fn(a + h_k)` (right sequence) for each `k`,
  skipping any `h_k` where the function throws or returns `NaN`/`Infinity` (do
  not abort the whole computation — a single bad sample point, e.g. hitting a
  removable discontinuity exactly, should not kill convergence detection).
- **Infinite `a`:** step values `x_k = sign(a) * 10^(k+1)` for `k = 0..7`
  (i.e. `10, 100, ..., 1e8` in the signed direction of `a`). Only one
  sequence exists (no left/right distinction at infinity) — set **both**
  `leftVal` and `rightVal` to that sequence's converged value, so the result
  shape is identical regardless of whether `a` is finite or infinite and the
  UI layer (§4) needs no branching on which case it's rendering.
- **Convergence check:** compare the last 3 terms of a sequence; if the
  relative difference between consecutive terms is below `1e-4` for the final
  two steps, the sequence has converged — report its last value. If the terms
  are still changing by more than that but trending toward a fixed magnitude
  order (i.e., `|f(x_k)|` growing without bound), report divergence to
  `+Infinity`/`-Infinity`. Otherwise (oscillating or no clear trend), report
  "does not converge."
- **Combine:** if both left and right sequences converge to the same value
  (within `1e-4` relative tolerance of each other), `exists: true, val: <that
  value>`. If they converge to different values, `exists: false` with both
  `leftVal`/`rightVal` populated and `note: "left/right disagree"`. If either
  side fails to converge, `exists: false` with `note` describing which side
  and how (diverges vs. oscillates).

This is intentionally a heuristic, not a rigorous numerical-analysis
guarantee — same spirit as the existing central-difference `derivative` (which
also silently produces a number for functions that aren't differentiable
everywhere). Do not over-engineer; match the precision bar already set by the
Derivative tool.

## 4. UI design — `src/components/tabs/CalculateTab.jsx`

**State** (add alongside the existing `dExpr`/`dVar`/`dPoint`/`dResult` block,
~line 1195):

```js
const [lExpr,   setLExpr]   = useState("sin(x)/x");
const [lVar,    setLVar]    = useState("x");
const [lPoint,  setLPoint]  = useState("0");
const [lResult, setLResult] = useState(null);
```

**Tool-strip entry** (the array at ~line 1556): append
`["limit","lim Limit"]` after `["integral","∫ Integrate"]`.

**Point parser** — new small helper near the limit handler (do not touch
`dPoint`'s existing `parseFloat` + `isFinite` check, which must keep
rejecting non-finite input for the Derivative tool):

```js
function parseLimitPoint(raw) {
  const s = raw.trim().toLowerCase();
  if (s === "inf" || s === "infinity" || s === "+inf" || s === "+infinity") return Infinity;
  if (s === "-inf" || s === "-infinity") return -Infinity;
  const n = parseFloat(raw);
  return isFinite(n) ? n : null; // null = invalid, same signal dPoint's isFinite check uses
}
```

**Handler** (`runLimit`) — build it by copying `runDerivative`
(`CalculateTab.jsx:1383-1395`) structurally: same expression-to-function
compilation approach the Derivative tool already uses to turn `dExpr`/`dVar` +
`scope` into a callable `(x) => number` (reuse that exact technique for
`lExpr`/`lVar` — do not invent a different evaluation strategy), wrapped in
the same try/catch that sets `{ error: ... }` into `lResult` on a thrown
exception. Where `runDerivative` calls `derivative(wrappedFn, x0)`, `runLimit`
instead: (1) parses `lPoint` via `parseLimitPoint`, short-circuiting into
`setLResult({ error: "Point must be a number, or inf / -inf." })` if parsing
returns `null`; (2) calls the new `limit(wrappedFn, a)` engine function; (3)
spreads its return object into `lResult` alongside `varName`.

**Panel JSX** — new block, placed after the Integral panel
(`activeTool === "integral"`), following the Derivative "Single" panel's
layout exactly (same row structure: `f( [var] ) = [expr input] [EquationPicker]`
row, then a second row with the point input + Compute button, then the "Other
variables in scope" line, then a conditional `ErrBox`/`ResultBox`). Result
rendering:

- Headline: `lim(<var> → <point>) f(<var>) = <value>` in teal when
  `exists: true`, formatted via the existing `fmt(val, 8)` helper; `"does not
  exist"` in gold when `exists: false`.
- When `exists: false` and both `leftVal`/`rightVal` are populated, a
  secondary line: `left → <fmt 6dp> · right → <fmt 6dp>`.
- A muted caption line with `note` + `"numerical (sequence convergence)"`,
  mirroring the Derivative panel's `"Numerical (central difference, h = 1e-6)"`
  caption.

Use the file's existing `fmt`/`ResultBox`/`ErrBox`/`fieldStyle`/`Btn`/
`EquationPicker`/`focusField` helpers as-is (all already defined in this
file, read them before writing the JSX — do not redefine or reimplement any
of them).

## 5. Non-goals

- No symbolic limits (L'Hôpital, series expansion, exact fractions like `1/2`
  instead of `0.5`).
- No one-sided-only UI mode (§2 D2).
- No changes to the Workbench (`calculate/workbench/`) or its CAS backends —
  unrelated code path.
- No new pipeline step, no export-script (R/Python/Stata) changes — Calculate
  tab tools are not part of the replication-fidelity unified script (per
  `specs/2026-06-12-replication-fidelity-design.md` §1: Calculate is
  excluded).

## 6. Acceptance

- `npm run build` and `npm run lint:undef` green.
- Manual browser check (via `preview_*` tools): open Calculate → Limit tool.
  - `sin(x)/x` as `x → 0` → exists, ≈ `1.0` (classic removable-discontinuity
    case — the numeric method must not blow up evaluating exactly at 0, since
    it never does; confirms the shrinking-`h` approach is wired correctly).
  - `1/x` as `x → 0` → does not exist, left → large negative, right → large
    positive (confirms left/right disagreement is surfaced, and that a
    diverging one-sided sequence doesn't crash the UI).
  - `1/x` as `x → inf` → exists, ≈ `0`.
  - `x**2` as `x → inf` → does not exist / diverges (note should say so, not
    silently show a huge finite number as if converged).
  - Garbage expression (e.g. unmatched paren) → `ErrBox` shows a message, no
    uncaught exception in the console.
- No regression to the other five tools (Solver/Derivative/Symbolic/Algebra/
  Integral) — this is a pure addition, verify their panels still render and
  their existing state variables are untouched.

## 7. Out of scope for this spec (explicitly deferred, not silently dropped)

Nothing — this is intentionally small. If Franco wants symbolic limits or a
one-sided UI mode later, that is a follow-up spec, not an extension of this
one.
