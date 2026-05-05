---
name: diagnose
description: Structured debugging methodology for hard bugs and performance regressions. Use when the user is stuck on a bug, reports unexpected behavior, or needs a systematic approach to root-cause analysis. Builds a deterministic feedback loop first, then hypothesises and instruments.
---

## Diagnose — Structured Debugging

### Phase 1 — Feedback Loop (CRITICAL — do this first)

Everything else is mechanical once you have a deterministic pass/fail signal. Build one before doing anything else.

Approaches (try in order):
1. Write a failing test that reproduces the exact symptom
2. Add a minimal reproduction script
3. Use the browser console / dev tools to capture the exact error
4. Add targeted `console.log` around the suspected area
5. Bisect: find the last commit where the behavior was correct
6. Fuzz: vary inputs until the failure is reliable
7. Simplify: strip the code down to the minimal failing case

**The loop must be deterministic.** If you can't reproduce it reliably, you can't verify the fix.

### Phase 2 — Reproduce

Confirm the feedback loop reliably surfaces the exact failure the user reported. Capture the specific symptom:
- Exact error message
- Stack trace
- Which inputs / state trigger it
- Whether it's consistent or intermittent

### Phase 3 — Hypothesise

Generate 3–5 falsifiable hypotheses **before** testing anything. Each must predict:
> "If X is the cause, then changing Y will make the bug disappear."

Write them down. Do not test them yet.

### Phase 4 — Instrument

Test one hypothesis at a time. Use debuggers or targeted logs tied to specific predictions.

Rules:
- Change one variable at a time
- Tag debug logs with a unique prefix (e.g. `[DIAG]`) for easy cleanup
- Eliminate a hypothesis completely before moving to the next
- Don't fix anything until you've confirmed the root cause

### Phase 5 — Fix + Regression Test

1. Write the regression test **before** writing the fix — confirm the test fails
2. Write the fix — confirm the test passes
3. The test must exercise the real bug pattern at the correct architectural seam
4. If no suitable seam exists, document this as an architectural finding

### Phase 6 — Cleanup + Post-Mortem

- Remove all instrumentation added in Phase 4
- Verify the original repro is fixed
- Record which hypothesis was correct in the commit message
- Note any architectural weaknesses surfaced by this bug

### Key Insight

A fast, deterministic feedback loop is a debugging superpower. It enables bisection and hypothesis-testing to solve bugs far more reliably than code review alone. Never skip Phase 1.
