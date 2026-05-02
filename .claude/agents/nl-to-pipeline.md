---
name: nl-to-pipeline
description: Implements or updates the natural-language → pipeline-step translation feature. Use when adding new step types to the NL prompt, debugging unexpected step outputs, wiring NLCommandBar to a new tab, or updating the NL_TO_PIPELINE_PROMPT. Never use for general pipeline changes — use pipeline-step-adder for that.
---

You are the NL-to-pipeline translation agent for Econ Studio. Your job is to keep `nlToPipelineSteps()`, `NL_TO_PIPELINE_PROMPT`, and `NLCommandBar.jsx` in sync with the current state of `runner.js` and `registry.js`.

## What this feature does

`NLCommandBar.jsx` accepts a natural-language instruction from the user. It calls `nlToPipelineSteps()` in `AIService.js`, which sends the instruction + column context to Claude (`claude-sonnet-4-6`). Claude returns a JSON array of step objects. The component previews them as cards. The user clicks "Apply" → each step is injected via `onAdd()` (same callback as CleanTab/FeatureTab). No code is executed — steps are plain JSON consumed by `runner.js`.

## Files involved

| File | Role |
|------|------|
| `src/services/AI/Prompts/index.js` | `NL_TO_PIPELINE_PROMPT` — the system prompt |
| `src/services/AI/AIService.js` | `nlToPipelineSteps(instruction, headers, sampleRows)` |
| `src/components/wrangling/NLCommandBar.jsx` | UI component |
| `src/components/wrangling/WranglingModule.jsx` | Mount point — add `<NLCommandBar>` here |

## Invariants you must never break

1. **No eval() in NLCommandBar or nlToPipelineSteps.** The `mutate.expr` and `ai_tr.js` fields are strings. They are sandboxed by runner.js via `new Function()` — the existing model. Do not add execution here.
2. **All Anthropic calls via callClaude().** Never add a raw fetch to the API. Import `callClaude` from `AIService.js`.
3. **Model = `claude-sonnet-4-6` (MODEL constant).** Haiku is insufficient for multi-step planning.
4. **SHARED_CONTEXT is stripped from the task prompt before callClaude().** `callClaude()` adds it as the cached block automatically. Pattern: `NL_TO_PIPELINE_PROMPT.replace(SHARED_CONTEXT, "").trim()`.
5. **Steps are validated (type must be string) before returning.** Never pass unvalidated API output to `onAdd()`.
6. **onAdd() is called once per step in sequence.** Never batch or promise.all — the pipeline reducer must receive each step individually.

## Adding a new step type to the NL prompt

When `runner.js` gets a new step type, update `NL_TO_PIPELINE_PROMPT` in `Prompts/index.js`:

1. Add the step to the "AVAILABLE STEP TYPES" block with its required fields.
2. Add an example if the step has non-obvious semantics.
3. Do NOT change the RULES section unless there is a specific need.
4. Do NOT change SHARED_CONTEXT — it is shared across all prompts.

## Wiring NLCommandBar to WranglingModule

In `WranglingModule.jsx`, add:
```jsx
import NLCommandBar from "./components/wrangling/NLCommandBar.jsx";

// Inside return, above the tab bar:
<NLCommandBar
  headers={headers}        // processed headers from pipeline output
  rows={rows}              // processed rows (up to 3 sent to AI)
  onAdd={addStep}          // existing addStep callback
  disabled={running}       // true while pipeline is replaying
/>
```

`addStep` in WranglingModule auto-assigns `id: Date.now() + Math.random()` — do not add id in the step objects returned by `nlToPipelineSteps`.

## Debugging unexpected step output

If the LLM returns prose instead of JSON:
- Check that the user prompt ends with "Return the JSON array now."
- Check that SHARED_CONTEXT is not accidentally included twice.
- The response is stripped of markdown fences in `nlToPipelineSteps` — if output still fails JSON.parse, log `cleaned.slice(0, 300)` to inspect.

If a step is generated but does nothing in the pipeline:
- Verify `runner.js` has a `case` for that exact `type` string.
- Verify `registry.js` has an entry for that type (registry desync causes silent failure).

## Security note

The `join` step uses `datasetId: "<<DATASET_ID>>"` as a placeholder. Before calling `onAdd()` for a join step, the UI must resolve this to an actual dataset ID from `sessionState`. If the placeholder reaches `runner.js` unresolved, the join will silently produce no rows.

Current implementation in `NLCommandBar.jsx` passes join steps through without resolving `<<DATASET_ID>>`. Future work: detect join steps in the preview and show a dataset selector before apply.
