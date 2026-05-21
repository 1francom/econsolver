# Fase X3 — AI Service Hardening

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans.

**Track:** C — Cross-cutting hardening
**Status:** Queued.
**Blocks:** Fase X5 (bug bash).

**Goal:** Lock down `src/services/AI/AIService.js` and its prompts so that (a) prompt caching is provably active on every call, (b) the privacy filter strips PII before any network egress, (c) AI-inferred variable units and coefficient narratives meet a measurable accuracy bar, and (d) model routing (Sonnet vs Haiku) is deterministic.

**Why this matters:** AI output is the most visible feature for end users, and it's where misalignment between prompt and reality is most damaging — wrong unit inference cascades into wrong axis labels, wrong narrative invents significance that isn't there. Also: privacy-first is a hard constraint, and a single un-filtered call leaks dataset contents to Anthropic.

**Tech Stack:** the existing `callClaude` function, mocked Anthropic client for deterministic tests, a hand-labeled 100-variable dataset for unit inference, a coefficient sign/magnitude test bench.

---

## Surface covered

- `src/services/AI/AIService.js` — `callClaude`, `inferVariableUnits`, `interpretRegression`.
- `src/services/AI/LocalAI.js` — local fallback when AI is disabled.
- `src/services/AI/Prompts/index.js` — `SHARED_CONTEXT`, `INFER_UNITS_PROMPT`, `INTERPRET_REGRESSION_PROMPT`, `WRANGLING_TRANSFORM_PROMPT`, `WRANGLING_QUERY_PROMPT`, `CLEANING_SUGGESTIONS_PROMPT`.
- `src/services/Privacy/*` — `anonymizer.js`, `piiDetector.js`, `privacyFilter.js`.

---

## File structure

Create:
```
src/services/AI/__validation__/
├── faseX3Validation.js              ← harness for prompt caching, routing, filter audits, inference accuracy
├── faseX3UnitInferenceFixtures.json ← 100 hand-labeled variables with ground-truth units
├── faseX3CoefNarrativeFixtures.json ← coef vectors with expected sign / magnitude bounds
└── faseX3PrivacyFixtures.json       ← datasets with seeded PII (names, emails, addresses)
```

---

## Task 1 — Prompt caching audit

For every `callClaude` invocation, the request must include:

- A `cache_control: { type: "ephemeral" }` block on `SHARED_CONTEXT`.
- HTTP header `anthropic-beta: prompt-caching-2024-07-31`.
- Combined `SHARED_CONTEXT` + task prompt ≥ 1024 tokens (Anthropic's caching minimum).

Harness:

```js
const calls = await captureCallsViaMockedFetch(() => {
  AIService.inferVariableUnits({ cols: [...] });
  AIService.interpretRegression({ result: {...} });
});

for (const c of calls) {
  assert(c.headers["anthropic-beta"] === "prompt-caching-2024-07-31");
  assert(c.body.system[0].cache_control?.type === "ephemeral");
  assert(c.body.system[0].text.startsWith("EconSolver shared context"));
  assert(tokenCount(c.body) >= 1024);
}
```

---

## Task 2 — Model routing determinism

- Narrative calls (`interpretRegression`, `CLEANING_SUGGESTIONS_PROMPT`, `WRANGLING_TRANSFORM_PROMPT`) → `claude-sonnet-4-20250514`.
- Unit-inference call (`inferVariableUnits`) → `claude-haiku-4-5-20251001`.

Mock the fetch layer; for each public AIService method, assert the model field on the outbound request matches the spec.

---

## Task 3 — Privacy filter audit

Build a fixture dataset that contains seeded PII:
- Person names in a `name` column.
- Emails in a `contact` column.
- Street addresses in `address`.
- Phone numbers in `phone`.

Run every AI call path on this dataset. For each call:

1. Capture the outbound request body.
2. Assert that no raw PII string appears in the body.
3. The privacy log must show which fields were stripped and what replacement was used (hashed ID, redacted, or excluded).

Coverage: `inferVariableUnits` (column-name path), `interpretRegression` (no row data path), `WRANGLING_QUERY_PROMPT` (sample-row path — most sensitive).

---

## Task 4 — Unit inference accuracy

Use `faseX3UnitInferenceFixtures.json` — 100 hand-labeled variables spanning:
- Currencies (EUR, USD, % of GDP).
- Counts (population, units sold).
- Time (years, months, days since epoch).
- Rates (per capita, percent, basis points).
- Proportions ([0,1]).
- IDs / categoricals (none).

Run `inferVariableUnits` against the full fixture. Compute exact-match accuracy.

**Acceptance:** ≥ 95% exact match. Any disagreement gets an entry in `faseX3UnitInferenceFixtures.json` under `discrepancies` for prompt refinement.

---

## Task 5 — Coefficient narrative guardrails

Use `faseX3CoefNarrativeFixtures.json` — regressions with known signs, magnitudes, and significance. For each entry:

1. Run `interpretRegression` with the fixed result vector.
2. Parse the narrative for assertions about sign, magnitude, significance.
3. Assert: narrative sign matches β̂ sign; narrative significance claim consistent with p-value (no "significant" if p > 0.05; no "not significant" if p < 0.05); no invented metrics absent from the result object.

Coverage: positive β, negative β, near-zero β, marginally significant, highly significant, insignificant, log-transformed Y, ratio Y. ~30 fixture cases.

---

## Task 6 — Local fallback parity

`LocalAI.js` must answer every call shape that `AIService.js` answers, returning a structurally identical object (same keys, same types). Test by toggling the local-AI flag and asserting the consumer code paths don't crash.

---

## Acceptance gate

- [ ] Prompt-caching headers present and SHARED_CONTEXT cached on every call.
- [ ] Model routing deterministic for narrative vs unit-inference paths.
- [ ] Privacy filter strips seeded PII; audit log is populated.
- [ ] Unit inference accuracy ≥ 95% on the 100-variable fixture.
- [ ] Coefficient narratives never invert sign, never invent significance.
- [ ] LocalAI fallback returns the same shape.

---

## Pre-merge gate — Supabase feedback check (MANDATORY)

Before marking this fase complete, run the `feedback-collector` agent to pull unprocessed rows from the Supabase `feedback` table into `ClaudeFB.md`. Then:

1. **Filter** feedback by scope tags that touch this fase: `AI`, `narrative`, `interpretation`, `units`, `inference`, `privacy`, `PII`, `coach`, `prompt`.
2. For every open row in scope:
   - **Fix-now:** address before concluding.
   - **Fix-later:** file in `BugTriage.md` with a `FaseX3 →` reference.
   - **Wontfix:** document rationale and resolve in Supabase.
3. Concluding without an empty in-scope queue is a blocker.

AI behavior is uniquely user-judged — automated guardrails catch sign inversion but not awkward phrasing or domain mistakes. Supabase feedback is the only signal for those.

---

## Commits

- `test(ai): Fase X3 — prompt caching + model routing audit`
- `test(ai): Fase X3 — privacy filter PII stripping`
- `test(ai): Fase X3 — unit inference accuracy fixtures`
- `test(ai): Fase X3 — coefficient narrative guardrails`
- `fix(ai): Fase X3 — discrepancies surfaced by harness` (if any)
- `docs: Fase X3 — AI service hardened`
