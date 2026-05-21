# AI Coach → AI Assistant Dispatch
**Date:** 2026-05-17  
**Status:** Approved  
**Motivation:** 1800 educational establishments dataset (Bachelorarbeit); ~130 addresses with embedded neighborhood names (e.g. "av. pedro goyena 821 - Caballito") causing geocoding failures. Claude must clean these before geocoding — without the user having to manually select the column, write regex, or navigate between tabs.

---

## Problem Statement

The AI Coach (global, cross-module) can diagnose issues and guide users verbally, but cannot execute anything. The AI Assistant in CleanTab can execute transforms, but requires the user to (a) already be in Clean, (b) manually select the target column, and (c) write or know the instruction.

The gap: a user in Spatial asking "why do I have NA coordinates?" should get a complete path — diagnosis, proposed fix, and a one-click way to apply it — without ever leaving the conversation.

---

## Solution

Connect the AI Coach to the AI Assistant via a **dispatch** mechanism. The Coach can pre-load the AI Assistant with a column + instruction and navigate the user to Clean tab. The AI Assistant gains two new modes: **prefill** (receives dispatch payload) and **free-form** (infers column from natural language without pre-selection). In all new modes, **the user confirms the inferred column before any transform is applied**.

---

## User Stories

1. As a PhD student in Spatial tab, I ask "why do I have NA coordinates?" → Coach diagnoses the address format issue, shows a dispatch button "→ Limpiar columna dirección" → I click it → Clean tab opens, AI Assistant auto-runs a preview, I confirm the column and the transform → `ai_tr` step is added to the pipeline.

2. As a researcher in Clean tab, I type "borrá los barrios de la columna dirección" in the AI Assistant without selecting the column first → Claude infers the column, shows me "¿Limpio la columna 'dirección'?" → I confirm → preview appears → I apply.

3. As a user, Claude always asks me to confirm the inferred column before running any transform — I am never surprised by a change to the wrong column.

---

## Confirmation Flow (mandatory — never skip)

This applies to both **dispatch mode** and **free-form mode**:

```
Step 1 — Column confirmation
  Claude infers column (e.g. "dirección")
  UI shows: "¿Es esta la columna que querés limpiar?"
    [✓ dirección]  [✗ Cancelar]
  User must click ✓ to proceed. No implicit confirmation.

Step 2 — Transform preview
  Claude generates the JS transform + runs it on 5 sample rows
  UI shows before/after table:
    "av. pedro goyena 821 - Caballito"  →  "av. pedro goyena 821"
    "av. corrientes 1234, San Nicolás"  →  "av. corrientes 1234"
    ...
  Buttons: [Aplicar] [Cancelar]

Step 3 — Apply
  User clicks Aplicar → step injected into pipeline → shown in Pipeline sidebar
  App stays on Clean tab so user can see the step in history
```

Dispatch mode (from Coach): same two-step confirmation — column is pre-proposed by Coach, user still must click ✓ before preview runs.

---

## Architecture

### Context Bridge (DataStudio)

DataStudio builds `coachContext` and passes it to the AI Coach panel. Also owns the dispatch handler.

```js
// Built in DataStudio, passed as prop to AI Coach panel
const coachContext = {
  activeTab,          // "clean" | "spatial" | "model" | "explore" | ...
  headers,            // string[] — all column names
  sampleRows,         // object[8] — 8 rows, all columns
  pipeline: pipeline.map(s => ({
    type: s.type,
    col:  s.col ?? s.c1 ?? s.nn ?? null,
    desc: s.desc,
  })),                // step types + cols only — NO js strings (privacy + token cost)
  dataDictionary,     // Record<string, string> | {}
  spatialState: spatialStateRef.current,   // { latCol, lngCol, naCounts } | null
  modelState:   modelStateRef.current,     // { type, yVar, xVars, nObs }  | null
}

// Token budget: ~600–750 tokens (pipeline without JS, spatial/model as 3–5 field summaries)
```

```js
// Dispatch handler in DataStudio
function onDispatchToAssistant({ col, instruction }) {
  setActiveTab("clean");                       // navigate to Clean tab
  setAssistantPrefill({ col, instruction });   // passed down to WranglingModule → CleanTab
}
```

`spatialState` and `modelState` are collected via callback refs from SpatialTab and ModelingTab (same pattern used by other cross-module state today). They are `null` until the respective module sets them.

---

### AI Coach Panel (existing component — enhanced)

**New behavior:** coach response is parsed as JSON with two possible shapes.

```ts
// Shape A — guidance only (existing behavior preserved)
{ type: "text", reply: string }

// Shape B — guidance + dispatch action
{
  type: "dispatch",
  reply: string,          // shown as chat message
  action: {
    col: string,          // column Claude identified as target
    instruction: string,  // pre-filled instruction for AI Assistant
    label: string,        // button label shown in chat: "→ Limpiar columna dirección"
  }
}
```

**Rendering a dispatch message in chat:**
```
AI: Las coordenadas fallan porque las direcciones contienen barrios
    adjuntos (ej: 'av. pedro goyena 821 - Caballito'). El geocoder
    no reconoce ese sufijo como parte de la dirección.

    [→ Limpiar columna dirección]   ← styled action button
```

Coach only returns `dispatch` when:
- It can confidently identify a single target column from the dataset headers + samples
- The action is a cleaning/transform operation (not modeling advice, not navigation)
- The instruction is specific enough to generate a preview

For all other cases (methodology Q&A, spatial configuration advice, model selection) it returns `text` — existing behavior unchanged.

---

### AI Assistant in CleanTab (enhanced)

**Three modes — same component, different activation:**

| Mode | Activation | Column source | Auto-runs preview? |
|------|-----------|--------------|-------------------|
| **Existing** | User selects column manually | UI selection | No — user clicks Run |
| **Prefill** | Dispatch from Coach arrives | `prefill.col` (Coach inferred) | Yes — after user confirms column |
| **Free-form** | No column selected, user types full instruction | Claude infers from NL | Yes — after user confirms column |

**Prefill mode activation:**
- `WranglingModule` receives `assistantPrefill` prop from DataStudio
- Passes it to `CleanTab`
- `CleanTab` detects it via `useEffect([assistantPrefill])`:
  - Pre-selects the column in the column picker (shows as selected but not locked)
  - Pre-fills the instruction textarea
  - Immediately calls `runNLPipeline()` to generate the transform + show column confirmation

**Free-form mode activation:**
- User clears column selection (or never had one) and types a multi-word instruction that references a column by name or concept
- Detected heuristically: instruction contains a column name OR no column is selected AND instruction is > 4 words
- Calls `runNLPipeline()` instead of `runSingleTransform()`

**Two execution paths in AI Assistant:**

```
runSingleTransform(col, instruction)   ← existing path, unchanged
  → callClaude(WRANGLING_TRANSFORM_PROMPT, { col, sample, instruction })
  → returns { js, preview, description }
  → shows preview → user applies

runNLPipeline(instruction, headers, sampleRows, pipeline)   ← new path
  → callClaude(NL_TO_PIPELINE_PROMPT, { instruction, headers, sampleRows, pipeline })
  → returns { explanation, inferredCol, steps[] }
  → Step 1: show column confirmation UI for inferredCol
  → User confirms → Step 2: show before/after preview table
  → User confirms → apply all steps via onAdd()
```

---

### New Prompts (services/AI/Prompts/index.js)

#### `COACH_DISPATCH_PROMPT`

Replaces (or wraps) the existing coach prompt. Receives the full `coachContext` as a structured block in the user message plus conversation history.

Key rules for Claude:
- Return `{ "type": "text", "reply": "..." }` for methodology Q&A, general guidance, spatial config, model selection.
- Return `{ "type": "dispatch", "reply": "...", "action": { col, instruction, label } }` only when:
  - A specific column in the dataset is the root cause of a diagnosable problem
  - The fix is a cleaning/transform operation executable by the AI Assistant
  - The instruction is concrete enough to generate a deterministic preview
- `col` must be an exact match to one of the `headers` in coachContext — never fabricate a column name.
- `instruction` must be in Spanish (matches the app's UX language for this flow).
- `label` must be ≤ 5 words, imperative, e.g. "Limpiar columna dirección".
- Never return dispatch for: modeling advice, navigation instructions, diagnostic-only answers.

#### `NL_TO_PIPELINE_PROMPT`

Used by `runNLPipeline()` in the AI Assistant. Receives:
```
instruction     — user's natural language string
headers         — column names[]
sampleRows      — 8 rows (all columns)
pipeline        — current steps (type + col + desc, no JS)
dataDictionary  — column descriptions
```

Returns:
```json
{
  "explanation": "one sentence: what Claude detected and what it will do",
  "inferredCol": "exact column name from headers",
  "steps": [
    {
      "type": "ai_tr",
      "col": "dirección",
      "js": "v => v == null ? null : String(v).replace(/\\s*[-,]\\s*[\\w\\sáéíóúÁÉÍÓÚñÑ]+$/, '').trim()",
      "desc": "Eliminar sufijo de barrio de la columna dirección",
      "preview": ["av. pedro goyena 821", "av. corrientes 1234", "av. rivadavia 3400", "calle falsa 123", "av. santa fe 890"]
    }
  ]
}
```

Key rules for Claude:
- `inferredCol` must be an exact match to one of the provided `headers`. Never invent column names.
- `js` must be a function body (no arrow wrapper) — same contract as existing `ai_tr` step. Guard against null on every transform.
- `preview` must have exactly 5 elements, in the same row order as `sampleRows`, applying the same logic as `js`.
- `steps` is an array to support future multi-step generation. In v1, return exactly 1 step.
- Vanilla JS only — no imports, no fetch, no eval inside the js body.
- Do not suggest steps that duplicate existing pipeline steps (check the `pipeline` input).
- Spanish for `desc` and `explanation`. English for `js` (code is code).

---

## Implementation Steps (ordered, each unblocks the next)

### Step 1 — Add `COACH_DISPATCH_PROMPT` and `NL_TO_PIPELINE_PROMPT` to Prompts/index.js
- Write both prompts as exported string constants following the existing pattern (SHARED_CONTEXT prepended, versioned comment, JSON-only return rules).
- No UI changes. No wiring yet.
- Test manually: copy paste into Claude.ai with sample context, verify JSON shapes.

### Step 2 — Add `coachDispatch()` function to AIService.js
- New exported function `coachDispatch({ question, coachContext, history })`.
- Calls `callClaude({ system: COACH_DISPATCH_PROMPT, user: buildCoachUserMsg(question, coachContext, history), maxTokens: 600 })`.
- Parses JSON response, returns `{ type, reply, action? }`.
- Handles parse errors gracefully — falls back to `{ type: "text", reply: raw }`.

### Step 3 — Add `runNLPipeline()` function to AIService.js
- New exported function `runNLPipeline({ instruction, headers, sampleRows, pipeline, dataDictionary })`.
- Calls `callClaude({ system: NL_TO_PIPELINE_PROMPT, user: buildNLPipelineUserMsg(...), maxTokens: 800 })`.
- Parses JSON, validates: `inferredCol` is in `headers`, `steps` is non-empty array, each step has `type`, `col`, `js`, `desc`, `preview`.
- Returns validated result or `null` on failure.

### Step 4 — Build `coachContext` in DataStudio and wire dispatch handler
- In `DataStudio.jsx`: add `assistantPrefill` state (`useState(null)`).
- Add `onDispatchToAssistant({ col, instruction })` handler: sets `activeTab = "clean"`, sets `assistantPrefill = { col, instruction }`.
- Build `coachContext` object from existing state: `activeTab`, `headers`, `sampleRows` (first 8 of processed rows), `pipeline` (mapped to `{type, col, desc}`), `dataDictionary`.
- Wire `spatialState` and `modelState` via two `useRef` + callback pattern: each child tab calls `onSpatialStateChange(state)` / `onModelStateChange(state)` props (add these props to SpatialTab and ModelingTab); DataStudio stores them in refs (not state, to avoid re-renders). Read ref values when building `coachContext` at the moment the Coach makes a call.
- Pass `coachContext` and `onDispatchToAssistant` as props to the AI Coach component.
- Pass `assistantPrefill` and a `clearPrefill` callback down to `WranglingModule`.

### Step 5 — Enhance AI Coach panel to handle dispatch responses
- Replace current plain-text coach API call with `coachDispatch()`.
- Parse response type: if `"text"`, render as before (existing AssistantBubble).
- If `"dispatch"`, render a new `DispatchBubble` component:
  - Shows `reply` text as normal message body.
  - Below the text, renders a styled action button: `[→ {action.label}]` in `C.teal` accent.
  - Button onClick: calls `onDispatchToAssistant({ col: action.col, instruction: action.instruction })` and collapses (does not destroy) the coach panel so the conversation is still accessible.
- `DispatchBubble` is self-contained, no new files needed — add alongside `AssistantBubble` in the coach component file.

### Step 6 — Add prefill and free-form modes to CleanTab AI Assistant
- `CleanTab` receives new props: `assistantPrefill: { col, instruction } | null`, `onClearPrefill: () => void`.
- Add `useEffect([assistantPrefill])`: when prefill arrives and is non-null:
  - Set selected column to `assistantPrefill.col` (using existing column selector state).
  - Set instruction textarea to `assistantPrefill.instruction`.
  - Immediately call `triggerNLPipeline()` (see below).
  - Call `onClearPrefill()` so it doesn't re-trigger on re-renders.
- Add `triggerNLPipeline(instruction, col?)` function:
  1. Calls `runNLPipeline({ instruction, headers, sampleRows: rows.slice(0,8), pipeline, dataDictionary })`.
  2. On result: show column confirmation UI (Step A below).
  3. On null: show error "No pude identificar la columna o la transformación."
- **Column confirmation UI (Step A):**
  - Renders a small confirmation card above the preview:
    ```
    ¿Limpio la columna '{inferredCol}'?
    [✓ Confirmar]  [✗ Cancelar]
    ```
  - Confirm → proceed to preview. Cancel → reset to idle, clear prefill.
  - Column picker updates to show `inferredCol` as selected (visual feedback).
- **Preview UI (Step B — existing pattern, no change needed):**
  - Shows 5-row before/after table using `result.steps[0].preview`.
  - [Aplicar] [Cancelar] buttons — same as today's single-transform preview.
- **Free-form detection:** if no column is selected AND instruction textarea has > 4 words AND user clicks Run → call `triggerNLPipeline(instruction, null)` instead of `runSingleTransform`.
- Apply: iterates `result.steps`, calls `onAdd(step)` for each. In v1 this is always 1 step.

### Step 7 — Wire prefill prop through WranglingModule to CleanTab
- `WranglingModule` receives `assistantPrefill` and `onClearPrefill` from DataStudio.
- Also passes `dataDictionary` (already in WranglingModule state) to `CleanTab` — CleanTab currently does not receive it but `runNLPipeline` needs it.
- Passes `assistantPrefill`, `onClearPrefill`, and `dataDictionary` as props to `CleanTab` in the tab render block.
- No logic in WranglingModule — pure pass-through.

### Step 8 — Browser validation (all 5 must pass before done)
- [ ] Coach in Spatial: ask "why NA coordinates?" with a dataset that has address strings → Coach returns dispatch response → action button appears → click navigates to Clean, AI Assistant pre-fills, column confirmation appears.
- [ ] Column confirmation: user can cancel at Step A and at Step B independently. After cancel, AI Assistant returns to idle with no pipeline change.
- [ ] Confirm + apply: after both confirmations, `ai_tr` step appears in pipeline sidebar. Running the pipeline produces cleaned addresses (neighborhood stripped).
- [ ] Free-form in Clean: type "borrá los barrios de la columna dirección" with no column selected → column confirmation appears with correct column → confirm → preview → apply.
- [ ] Fallback: coaching question that is NOT dispatch-eligible (e.g. "should I use FE or RE?") → Coach returns plain text, no action button.

---

## Out of Scope (v1)

- Dispatch targets other than CleanTab AI Assistant (Spatial, Model, etc.)
- Multi-step generation where steps touch different columns (infrastructure ready, not exposed in UI)
- Undo from within the Coach chat (user uses existing pipeline undo in Clean tab)
- AI Assistant in tabs other than Clean

## Future Extensions

- `assistantPrefill` pattern reused for Spatial tab (pre-fill geocoding column config), Model tab (pre-fill estimator + variables)
- `steps[]` with multiple entries (e.g. strip neighborhood + normalize encoding in one go)
- Coach dispatch for non-cleaning actions (e.g. "run this as a robustness check" → pre-fills estimator config in Model tab)
