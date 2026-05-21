# Fase X1 — Pipeline Runner Reliability

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans.

**Track:** C — Cross-cutting hardening
**Status:** Queued.
**Blocks:** Fase X5 (bug bash must see a stable pipeline).

**Goal:** Lock down `src/pipeline/runner.js` so that every one of the 23 step types is correct in isolation, composable in arbitrary order, idempotent across save/reload, and synchronized with `registry.js` and `auditor.js`.

**Why this matters:** the pipeline is the trust spine of the product. A silently wrong step means every downstream estimate is wrong. Estimators are validated; the pipeline as a whole is not.

**Tech Stack:** Vitest (or hand-coded test harness if Vitest absent), the existing pipeline modules, IndexedDB through `services/persistence/indexedDB.js`.

---

## Surface covered

The 23 step types per CLAUDE.md:

**Cleaning (15):** `rename`, `drop`, `filter`, `drop_na`, `fill_na`, `fill_na_grouped`, `type_cast`, `quickclean`, `recode`, `normalize_cats`, `winz`, `trim_outliers`, `flag_outliers`, `extract_regex`, `ai_tr`.
**Features (14):** `log`, `sq`, `std`, `dummy`, `lag`, `lead`, `diff`, `ix`, `did`, `date_parse`, `date_extract`, `mutate`, `factor_interactions`, plus `geocode` (Phase 11.2).
**Reshape (3):** `arrange`, `group_summarize`, `pivot_longer`.
**Merge (2):** `join`, `append`.

Plus auxiliary modules: `validator.js` (panel validation), `auditor.js` (audit trail).

---

## File structure

Create:
```
src/pipeline/__validation__/
├── faseX1Validation.js          ← harness covering all 23 step types
├── faseX1Fixtures.js            ← reusable input tables (panel, time series, mixed types, edge cases)
└── faseX1Benchmarks.json        ← expected outputs per step (golden values)
```

---

## Task 1 — Per-step golden fixtures

For each of the 23 step types:

1. Construct an input table that exercises the step's logic (including at least one NA row, one duplicate, one edge value).
2. Apply the step with a representative config.
3. Hand-verify the output once, then commit as a golden fixture.

Example fixture entry:
```js
{
  stepType: "lag",
  config: { col: "y", k: 1, by: "id", orderBy: "t" },
  input: [
    { id: 1, t: 1, y: 10 }, { id: 1, t: 2, y: 20 },
    { id: 2, t: 1, y: 30 }, { id: 2, t: 2, y: 40 }
  ],
  expected: [
    { id: 1, t: 1, y: 10, y_lag1: null },
    { id: 1, t: 2, y: 20, y_lag1: 10 },
    { id: 2, t: 1, y: 30, y_lag1: null },
    { id: 2, t: 2, y: 40, y_lag1: 30 }
  ]
}
```

**Bug-prone steps requiring extra scrutiny** (per CLAUDE.md "Key bugs fixed"):
- `lag`, `lead`, `diff` — must group by entity before sorting (no cross-unit contamination).
- `winz`, `trim_outliers` — quantile thresholds computed at step-creation time, not runtime.
- `fuzzy_groups` (inside `normalize_cats`) — numeric variants like "comuna 1" / "comuna 2" must not merge.

---

## Task 2 — Composability tests

1. Apply a random sequence of 10 steps from the registry.
2. Serialize the pipeline to JSON.
3. Reset to `rawData`, replay → identical output.
4. Undo back to step 0 → output equals `rawData`.
5. Redo forward → output equals the post-replay state.

Acceptance: hash of every intermediate state matches across two independent replays.

---

## Task 3 — IndexedDB round-trip

1. Save a 10-step pipeline via `savePipeline(pid, steps)`.
2. Close and reopen the harness (simulate via `loadPipeline(pid)`).
3. Re-apply on `rawData`.
4. Assert output table hash matches pre-save.

Covers: pipeline serialization, `migrateFromLocalStorage` does not corrupt, project IDs do not bleed across projects.

---

## Task 4 — Non-destructive guarantee

After every test in Task 1 and Task 2, assert that the input `rawData` object reference is unchanged (deep-equal to a frozen copy captured before the test).

If any step mutates `rawData`, the test fails. This is the most important invariant — break it and replay is non-deterministic.

---

## Task 5 — Registry / runner sync check

```js
import { applyStep } from "../runner.js";
import { STEP_REGISTRY } from "../registry.js";

const runnerTypes = extractStepTypesFromRunner();    // parse source for case branches
const registryTypes = Object.keys(STEP_REGISTRY);

assert(setEqual(runnerTypes, registryTypes), "runner.js and registry.js are out of sync");
```

If new step types are added without updating both files, the test catches it.

---

## Task 6 — Audit trail completeness

For a 10-step pipeline, `auditPipeline(steps)` must:
- Emit one `AuditEntry` per step.
- Each entry has `stepType`, `summary`, `affectedCols`, `rowDelta`.
- Markdown output is valid and renders the steps in execution order.

---

## Acceptance gate

- [ ] 23 step-type golden fixtures pass.
- [ ] 100 random composability sequences pass (different RNG seeds).
- [ ] IndexedDB round-trip passes for pipelines of length 1, 10, and 50.
- [ ] Non-destructive assert passes on every step.
- [ ] Registry/runner sync test passes.
- [ ] Audit trail emits expected markdown.

---

## Pre-merge gate — Supabase feedback check (MANDATORY)

Before marking this fase complete, run the `feedback-collector` agent to pull unprocessed rows from the Supabase `feedback` table into `ClaudeFB.md`. Then:

1. **Filter** feedback by scope tags that touch this fase: `pipeline`, `runner`, `wrangling`, `cleaning`, `feature`, `reshape`, `merge`, `undo/redo`, `IndexedDB`, `audit`.
2. For every open row in scope:
   - **Fix-now:** address in this fase before concluding.
   - **Fix-later:** file a follow-up entry in `BugTriage.md` with a `FaseX1 →` reference.
   - **Wontfix:** document the rationale in `ClaudeFB.md` and mark the Supabase row resolved.
3. Concluding this fase without an empty in-scope queue in `ClaudeFB.md` is a blocker.

The validation harness is necessary but not sufficient — user-reported issues from the Supabase table must be reconciled before commit.

---

## Commits

- `test(pipeline): Fase X1 — per-step golden fixtures for 23 step types`
- `test(pipeline): Fase X1 — composability + IndexedDB round-trip`
- `test(pipeline): Fase X1 — registry/runner sync + audit trail`
- `fix(pipeline): Fase X1 — discrepancies surfaced by harness` (if any)
- `docs: Fase X1 — pipeline reliability validated`
