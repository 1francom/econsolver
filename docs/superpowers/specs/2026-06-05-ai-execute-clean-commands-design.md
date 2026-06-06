# AI-Executed Clean Commands — NL → validated pipeline steps (design)

**Date:** 2026-06-05
**Status:** OPEN
**Author:** Claude. **Executor:** Claude (parallel track; collision-free with Codex Batch 1).
**Source conversation:** roadmap addition — "if AI is able to execute commands in Litux, it turns into a really useful tool." Trigger bug: asking the Clean-module AI to extract lat/lon from a geometry column yields a malformed in-place string `POINT("lon" -58.491021, "lat" -34.5509234)` instead of two clean numeric columns.

## Purpose

Upgrade the Clean-module AI from a single-column JS-string transform into an assistant that **emits a list of validated, declarative pipeline steps** from the existing `STEP_REGISTRY` vocabulary, previews them, and (on user confirm) appends them to the non-destructive pipeline. The AI thereby *executes commands* in the app — multi-column, multi-step, undoable — instead of fabricating fragile single-value expressions.

Scope of commands: **Cleaning + Features** step types only (covers the geometry case and the bulk of "do X to my data" requests; deliberately excludes joins/merge/reshape for now to limit blast radius).

Apply model: **Preview, then confirm.**

## Root cause of the geometry bug (verified 2026-06-05)

`WRANGLING_TRANSFORM_PROMPT` (`Prompts/index.js:367`) instructs the model to return a single `js` arrow-function **body** that the `ai_tr` step (`runner.js:268`) wraps via the runtime Function constructor and invokes per row as `(val, idx)` — returning **one value for one column**. There is no structural way to output two columns. Asked for lat *and* lon, the model crams both into one return → the malformed WKT string. The prompt's own NOTE anticipates the fix: *"If a future schema moves to fully declarative step specs, both this prompt and the `ai_tr` step MUST change together."* This spec is that move (additive — `ai_tr` stays for backward compatibility).

## Architectural invariants

- **Non-destructive pipeline** — emitted steps are appended via the existing add-step path and replay on `rawData`. Preview is a pure dry-run through `runner.js`; nothing mutates until the user confirms.
- **Single API egress** — the new call lives in `AIService.js`. No new fetch.
- **Prompt caching** — `NL_TO_PIPELINE_PROMPT` embeds `SHARED_CONTEXT` (cached). The per-request column context (headers/samples) goes in the user payload.
- **Registry is the vocabulary** — the AI may only emit step `type`s that exist in `STEP_REGISTRY` and fall in the `cleaning`/`features` categories. A validator enforces this; the model never invents steps.
- **Collision-free with Codex** — emit only existing step types (no `runner.js`/`registry.js` edits); mount the UI in `WranglingModule.jsx` (orchestrator), not `CleanTab.jsx` (Codex-owned). New files only, except the shared AI files (`AIService.js`, `Prompts/index.js`) which Codex does not touch.

---

## Part 1 — `NL_TO_PIPELINE_PROMPT` (Prompts/index.js)

A new prompt that returns a JSON **array of declarative steps**. Each step is `{ type, ...params }` matching the `STEP_REGISTRY` schema for that type, plus a `desc` string for the history label.

Output contract:

```json
{
  "interpretation": "one sentence restating what the user asked",
  "steps": [
    { "type": "extract_regex", "col": "geometry", "nn": "lon",
      "regex": "\\(\\s*(-?\\d+\\.?\\d+)", "locale": "dot",
      "desc": "extract longitude from WKT POINT" },
    { "type": "extract_regex", "col": "geometry", "nn": "lat",
      "regex": "\\s(-?\\d+\\.?\\d+)\\s*\\)", "locale": "dot",
      "desc": "extract latitude from WKT POINT" }
  ],
  "notes": "optional caveats, e.g. assumed WKT lon-lat order"
}
```

Prompt rules:
- The model receives an **allowed-step catalogue** (auto-derived from `STEP_REGISTRY`, cleaning + features only) listing each `type`, its `label`, `description`, and its schema `key`s/types. It MUST choose only from this catalogue and provide every required schema key.
- Provide the current column list with inferred dtype + up to 5 sample values per column so the model can reference real column names and write correct regexes.
- Output ONLY JSON (no fences). `steps` may be empty if the request is not expressible with allowed steps; put the reason in `notes`.
- New output columns must use `nn`; never overwrite the source column unless the user explicitly says "replace".
- Canonical few-shot examples to embed: (a) the geometry → lon/lat case above; (b) "make income numeric and log it" → `type_cast` then `log`; (c) "drop rows where age is missing" → `drop_na`; (d) "bucket age into <30 / 30-60 / 60+" → `mutate` with `case_when`.

A helper `serializeAllowedSteps()` (in the new module below) generates the catalogue text from `STEP_REGISTRY` so the prompt never drifts.

## Part 2 — `nlToPipeline()` (AIService.js)

```js
export async function nlToPipeline({ command, columns, allowedStepsText, signal } = {}) {
  // columns: [{ name, dtype, samples: [...] }]
  // Returns: { interpretation, steps: Step[], notes } | { error }
}
```
- Builds the user payload: the command + serialized column context + the allowed-steps catalogue.
- Calls `callClaude({ system: NL_TO_PIPELINE_PROMPT, user, maxTokens })` (Sonnet; this is structured generation, not narrative).
- Strips fences, `JSON.parse`s, returns `{ interpretation, steps, notes }`. On parse failure returns `{ error }` (UI shows a friendly retry).
- **Does not** validate beyond shape here — validation is a separate pure module so it is independently testable.

## Part 3 — step validator (`src/pipeline/stepValidator.js`, NEW)

Pure JS, imports `STEP_REGISTRY`. Exports:

```js
// returns { valid: Step[], rejected: [{ step, reason }] }
export function validateAISteps(steps, headers, { allowedCategories = ["cleaning", "features"] } = {})
```
Checks per step:
1. `type` exists in `STEP_REGISTRY`.
2. The registry entry's `category` is in `allowedCategories`.
3. Every required schema `key` is present and of the right coarse type (`col`/`cols` → string/array of strings; `number` → finite; `select` → one of the option values; `text` → string).
4. Column references (`col`, any `cols`) exist in the **running** header set — validate sequentially, threading the header set forward (a step that creates `nn` makes it available to later steps).
5. `regex` (if present) compiles (wrap `RegExp` construction in try/catch).

Rejected steps are dropped with a reason; valid steps proceed to preview. (Validation is advisory-strict: if ANY step is rejected, surface them but still let the user apply the valid ones.)

## Part 4 — preview dry-run

Reuse `runner.js` (pure, non-destructive): apply the validated candidate steps on top of the *current* rows to produce a preview, without touching the real pipeline.
- Compute a small before/after: which columns are new, and a 5-row sample showing the new columns populated.
- For large data (DuckDB path), preview on the in-memory sample rows already held for display (the project's "preview ≠ full computation" rule) — do not force a full-table run for preview.

## Part 5 — `NLCommandBar.jsx` (NEW component) mounted by WranglingModule

A command bar spanning the wrangling module (so it works regardless of active sub-tab):
- Text input ("Tell the AI what to do to your data…") + run button. Optional mic/paste later (out of scope).
- On submit → `nlToPipeline()` → `validateAISteps()` → dry-run preview.
- **Preview panel:** the `interpretation`, the ordered list of steps (each rendered via its registry `toLabel`/`desc`), any `rejected` steps with reasons, any `notes`, and the 5-row sample of new/changed columns.
- **Apply / Discard.** Apply appends the validated steps to the real pipeline via the existing add-step callback (the same `onAdd` path the manual tabs use) — so undo/redo, audit trail, and export all work automatically. Discard clears the preview.
- Empty/again states and an error banner on `{ error }`.

Mount: `WranglingModule.jsx` renders `<NLCommandBar rawData={...} headers={...} onAddSteps={...}/>` above the tab router. WranglingModule already owns pipeline state and the add-step path; it is **not** in Codex's Batch-1 file set. `onAddSteps` appends an array of steps (loop the existing single-step add, or add a batch add — confirm the existing API and match it).

## Part 6 — relationship to other specs

- Reuses the **capability map** (`appCapabilityMap.js`) concept from `2026-06-05-session-aware-coach-design.md`: `serializeAllowedSteps()` can live alongside `serializeCapabilityMap()` (both derive from `STEP_REGISTRY`). If that module exists when this is built, add `serializeAllowedSteps()` there; otherwise create it here and the coach spec imports it. Single source of truth either way.
- The **coach** (other spec) advises *where* to act; this bar *performs* the action. Same `STEP_REGISTRY` vocabulary underpins both. A future increment could let the coach hand a command to this bar, but that is out of scope here.

---

## Testing / validation (no JS unit runner — gates per project convention)

- Node harness `src/pipeline/__validation__/stepValidator.test.mjs`:
  - valid geometry steps pass; a step with a bogus `type` is rejected; a `merge`-category step is rejected (out of allowed categories); a step referencing a non-existent column is rejected; a sequential step referencing an earlier `nn` passes; a malformed `regex` is rejected.
- `npm run build` clean.
- Browser validation (Franco): the canonical geometry command on a WKT column → preview shows two numeric columns `lon`/`lat` (e.g. -58.491021 / -34.5509234), Apply adds two `extract_regex` steps to History, undo removes them; a nonsense command → graceful empty/notes; "make income numeric and log it" → `type_cast` + `log`.

## File checklist

- [ ] `src/services/AI/Prompts/index.js` — NEW `NL_TO_PIPELINE_PROMPT` (+ schema doc comment + few-shots).
- [ ] `src/services/AI/AIService.js` — NEW `nlToPipeline()`.
- [ ] `src/pipeline/stepValidator.js` — NEW `validateAISteps()`.
- [ ] `src/pipeline/__validation__/stepValidator.test.mjs` — NEW node harness.
- [ ] `src/services/AI/appCapabilityMap.js` — add `serializeAllowedSteps()` (or create the module if the coach spec hasn't yet).
- [ ] `src/components/wrangling/NLCommandBar.jsx` — NEW command bar + preview/apply UI.
- [ ] `src/WranglingModule.jsx` — mount `NLCommandBar`; provide `onAddSteps` batch-append.
- [ ] `CLAUDE.md` — note the new files + the NL-command feature.

## Out of scope

- Joins / merge / reshape via NL (kept manual for now — narrower blast radius).
- AI auto-applying without confirmation.
- New runner step types (the geometry case uses existing `extract_regex`; if a future request needs a capability the registry lacks, that is a separate registry/runner change — and would collide with Codex, so it waits for Batch 1 to merge).
- Voice/clipboard input.
- Replacing `ai_tr` (kept for backward compatibility; the single-column transform UI is unchanged).
