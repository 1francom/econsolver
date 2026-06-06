# Expression-Evaluation Sandbox Hardening (design)

**Date:** 2026-06-05
**Status:** OPEN
**Author / Executor:** Claude.
**Source:** Security re-review folded into `THREAT_MODEL.md` §3.2 (2026-06-05). Closes the HIGH "dynamic expression evaluation → credential/data exfiltration" finding before roadmap item #4 (cross-device persistence) makes synced pipelines an auto-running untrusted-input channel.

## Threat recap

Pipeline step expressions (`mutate.expr`, `if_else.cond`, `case_when.cases[].cond`, `vector_assign.rules[].expr`, `ai_tr` JS bodies, and DGP `Expression`/`Constant`/`ForLoop`/`WhileLoop` params) are compiled with the dynamic function constructor. Two reachable paths today:
- **Main thread** (`runner.js` `applyStep`): full access to `localStorage` (Supabase session token; dev-mode Anthropic key), `indexedDB`, `fetch`, DOM.
- **Worker** (`exprEval.worker.js`): no creds/DOM, **but `fetch` is available** → can exfiltrate the dataset passed in; **no denylist**.

Untrusted delivery: a shared/imported `pipeline.json` (`ImportPipelineButton` validates only step `type`) or an AI-emitted `mutate` (`validateAISteps` permits `mutate` without inspecting `expr`). `runPipelineAsync` routes `mutate/ai_tr/if_else/case_when/filter+expr` to the worker but **(a)** does **not** route `vector_assign`-conditional (main thread), and **(b)** on worker error **falls back to main-thread `applyStep`** (`runner.js:1786`).

## Design — worker-scrub + denylist (defense in depth)

The robust boundary is **scrubbing the worker global scope** (defeats the `''.constructor.constructor('…')()` escape, since the reconstructed function runs in the scrubbed worker global). The denylist is a fast, clear early-reject for UX and a second layer.

### Part 1 — Shared expr guard (`src/pipeline/exprGuard.js`, NEW, pure)
- Export `isSafeExpr(expr) → boolean` and `assertSafeExpr(expr) → void (throws Error with a clear message)`.
- Denylist (word-boundary regex over the raw string, matches even inside string literals): `window, self, globalThis, document, localStorage, sessionStorage, indexedDB, fetch, XMLHttpRequest, WebSocket, EventSource, importScripts, Worker, navigator, location, process, require, module, import, eval, constructor, prototype, __proto__, postMessage` plus the dynamic function-constructor identifier itself.
- Also reject backtick template literals — they enable string-built identifier evasion.
- `null`/non-string/empty → safe (no-op). Used by the worker, the main-thread guard, import, AI validation, and previews.
- Node harness asserts: benign exprs pass (`log(wage)*educ`, `ifelse(age>18,1,0)`); a `fetch(...)` call, `localStorage`, `constructor`, `globalThis`, and a backtick template are all rejected; split-string evasion like `'fet'+'ch'` is *not* claimed safe (documented limitation — the worker scrub is the real boundary).

### Part 2 — Harden the worker (`src/workers/exprEval.worker.js`)
- At module load (before any message handling), **null the exfiltration/escape globals**:
  ```js
  for (const k of ["fetch","XMLHttpRequest","WebSocket","EventSource","importScripts","Worker","navigator","Notification"]) {
    try { self[k] = undefined; } catch {}
  }
  ```
  After this, even successfully-constructed functions running in the worker global cannot reach a network primitive. The worker already lacks `localStorage`/`indexedDB`/DOM.
- Call `assertSafeExpr(expr)` (import the pure guard) before every dynamic-function compile in `evalCol` and `evalScope`. On failure: for `evalCol` return the unchanged value / `null`; for `evalScope` return `{ error }`.
- Add a handler for **`vector_assign`-conditional** rule predicates so they evaluate in the worker (mirror the `case_when` pattern: compile each rule's `expr`, first match wins, else `elseValue`).

### Part 3 — Route everything to the worker; remove the unsafe fallback (`runner.js`)
- Extend `isWorkerStep` in `runPipelineAsync` to include `vector_assign` **when `mode === "conditional"`**.
- Add a worker branch that calls the new `vector_assign` evaluator and writes `nn`.
- **Replace the catch-block fallback** (`s = applyStep(...)` at ~1786): on worker failure, set the step's output column to `null` for all rows (do **not** re-evaluate on the main thread). Log the failure.

### Part 4 — Guard the residual main-thread compile sites
The sync `runPipeline`/`applyStep` is still used (NLCommandBar dry-run preview; pipelines a caller runs synchronously). At each dynamic-function compile in `runner.js` (`mutate`, `if_else`, `case_when`, `vector_assign`-conditional), call `assertSafeExpr` first; on failure, no-op the step (output `null` / pass through) — so even the sync path cannot run a denylisted expr.

### Part 5 — Import & AI content-check
- `ImportPipelineButton.jsx`: after the `type` check, run `assertSafeExpr` on every code-bearing field (`expr`, `cond`, `cases[].cond`, `rules[].expr`) of imported steps; reject the whole import with a clear error naming the offending step if any fail.
- `stepValidator.js#validateAISteps`: for `mutate/if_else/case_when/vector_assign`(conditional) steps, reject (into `rejected[]` with reason `"unsafe expression"`) when `assertSafeExpr` fails. (Defense in depth; the worker scrub is the boundary.)

### Part 6 — Show the payload before Apply
- `NLCommandBar.jsx` preview: for each valid step that carries an expression, render the raw `expr`/`cond` (monospace, truncated) so the user sees exactly what will run before clicking Apply.
- `ImportPipelineButton` confirm dialog: list any code-bearing steps with their expressions.

### Part 7 — Preview sites (denylist only, no async refactor)
- `FeatureTab.jsx`, `SimulateTab.jsx`, `FormatTab.jsx` live previews compile a dynamic function on the user's *own* currently-typed expr (self-scoped). Apply `assertSafeExpr` before those compiles (cheap, consistent); on failure show the existing error affordance. Do **not** refactor these to worker/async.

## Testing / validation

- Node harness `src/pipeline/__validation__/exprGuard.test.mjs`: benign-pass / malicious-reject cases (Part 1).
- `npm run build` clean.
- Browser (Franco): (1) import a `pipeline.json` containing a `mutate` whose `expr` calls `fetch('https://example.com')` → rejected at import with a clear message; (2) a benign `mutate` (`log(x)`) still works; (3) NLCommandBar shows the `expr` in preview; (4) a normal DGP simulation and a normal mutate/case_when still produce correct output (regression).

## File checklist

- [ ] `src/pipeline/exprGuard.js` — NEW `isSafeExpr`/`assertSafeExpr` + denylist.
- [ ] `src/pipeline/__validation__/exprGuard.test.mjs` — NEW Node harness.
- [ ] `src/workers/exprEval.worker.js` — scrub globals; `assertSafeExpr` before every compile; `vector_assign`-conditional handler.
- [ ] `src/pipeline/runner.js` — `isWorkerStep` += vector_assign-conditional; worker branch; remove main-thread fallback; `assertSafeExpr` at residual main-thread compile sites.
- [ ] `src/services/exprEvalService.js` — extend the bridge for `vector_assign` if needed.
- [ ] `src/pipeline/stepValidator.js` — `assertSafeExpr` on AI expr steps.
- [ ] `src/components/wrangling/ImportPipelineButton.jsx` — content-check + show expressions in confirm.
- [ ] `src/components/wrangling/NLCommandBar.jsx` — show `expr` in preview.
- [ ] `src/components/wrangling/FeatureTab.jsx`, `src/components/tabs/SimulateTab.jsx`, `FormatTab.jsx` — denylist guard at preview compile.
- [ ] `THREAT_MODEL.md` — check off the §3.2 mitigations that this lands.

## Out of scope
- CSP header (`connect-src`) — tracked separately in §3.5; complementary but not required for this fix.
- Refactoring previews to async-worker eval.
- A full AST allowlist parser (the worker scrub makes the denylist's bypassability non-critical).
