# AI-Executed Clean Commands — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.
>
> Source spec: `docs/superpowers/specs/2026-06-05-ai-execute-clean-commands-design.md`. Executor: Claude (this session). **Collision-free with Codex Batch 1** — emit only existing step types, mount UI in `WranglingModule.jsx` (not `CleanTab.jsx`).

**Goal:** Replace the Clean-module AI's single-column JS transform with an assistant that emits a list of validated, declarative pipeline steps (multi-column/multi-step), previews them via a non-destructive dry-run, and appends them to the pipeline on user confirm. Fixes the geometry → lat/lon bug.

**Architecture:** A new `NL_TO_PIPELINE_PROMPT` makes Claude return a JSON array of `{type, ...params}` steps drawn from `STEP_REGISTRY` (cleaning + features only). `nlToPipeline()` in `AIService.js` calls Claude and parses. A pure `validateAISteps()` checks each step against the registry and the running header set. `NLCommandBar.jsx` runs the candidate steps through `runPipeline()` (pure, non-destructive) to preview, then appends valid steps via the existing `addStep` path on confirm. Mounted by `WranglingModule.jsx`.

**Tech Stack:** React + Vite + plain JS. Inline styles via `C`. No JS unit-test runner — gates are: Node harness for pure logic, `npm run build` clean, Franco browser-validation.

**Invariants:**
- Non-destructive: preview is a dry-run; nothing commits until Apply.
- Single API egress: the new call lives in `AIService.js`.
- Prompt caching: `NL_TO_PIPELINE_PROMPT` embeds `SHARED_CONTEXT`; per-request column context goes in the user payload.
- Registry is the only vocabulary: the validator rejects any step not in `STEP_REGISTRY` / allowed categories.
- Branch `Main-`. **Codex is active on this branch** — add only files in each task's list; never `git add -A`.

---

## Task 1: `serializeAllowedSteps()` in a new capability module

**Files:**
- Create: `src/services/AI/appCapabilityMap.js`

> Note: the session-aware-coach spec will later add `serializeCapabilityMap()` to this same file. Create it now with only `serializeAllowedSteps()`; the coach work appends to it.

- [ ] **Step 1: Write the module**

Create `src/services/AI/appCapabilityMap.js`:

```js
// ─── ECON STUDIO · services/AI/appCapabilityMap.js ───────────────────────────
// Derives the AI's knowledge of the pipeline vocabulary from STEP_REGISTRY so
// it never drifts. Used by the NL command bar (allowed-step catalogue) and,
// later, by the research coach (capability map).
import { STEP_REGISTRY } from "../../pipeline/registry.js";

// Coarse type hint for each schema field, so the model knows what to emit.
function fieldHint(field) {
  if (field.type === "select" && Array.isArray(field.options)) {
    return `${field.key}:one-of[${field.options.map(o => o.value).join("|")}]`;
  }
  return `${field.key}:${field.type}`;
}

// Produce a compact catalogue of the steps the AI is allowed to emit.
// allowedCategories filters which registry categories are exposed.
export function serializeAllowedSteps(allowedCategories = ["cleaning", "features"]) {
  const lines = ["ALLOWED PIPELINE STEPS (emit only these `type`s; provide every listed key):"];
  for (const s of STEP_REGISTRY) {
    if (s.internal) continue;
    if (!allowedCategories.includes(s.category)) continue;
    const keys = (s.schema || []).map(fieldHint).join(", ");
    lines.push(`- ${s.type} (${s.label}): ${s.description}`);
    if (keys) lines.push(`    keys: ${keys}`);
  }
  return lines.join("\n");
}
```

- [ ] **Step 2: Build to verify the import resolves**

Run: `npm run build`
Expected: success.

- [ ] **Step 3: Commit**

```bash
git add src/services/AI/appCapabilityMap.js
git commit -m "feat(ai): serializeAllowedSteps — registry-derived NL step catalogue

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Task 2: `validateAISteps()` + Node harness

**Files:**
- Create: `src/pipeline/stepValidator.js`
- Create: `src/pipeline/__validation__/stepValidator.test.mjs`

- [ ] **Step 1: Write the validator**

Create `src/pipeline/stepValidator.js`:

```js
// ─── ECON STUDIO · pipeline/stepValidator.js ─────────────────────────────────
// Validates AI-emitted pipeline steps against STEP_REGISTRY before they are
// previewed/applied. Pure JS, no React. Threads the header set forward so a
// step that creates a new column makes it available to later steps.
import { STEP_REGISTRY } from "./registry.js";

const REG_BY_TYPE = Object.fromEntries(STEP_REGISTRY.map(s => [s.type, s]));

function coarseOk(field, value) {
  switch (field.type) {
    case "col":    return typeof value === "string" && value.length > 0;
    case "cols":   return Array.isArray(value) && value.every(v => typeof v === "string");
    case "number": return typeof value === "number" && isFinite(value);
    case "text":   return typeof value === "string";
    case "select":
      return !field.options || field.options.some(o => o.value === value);
    default:       return true; // map/aggs/parts/boolean — accept, runner guards
  }
}

// Keys that are optional even if present in the schema (have sensible runner defaults).
const OPTIONAL_KEYS = new Set(["suffix", "regex", "locale", "namesPrefix", "valuesFill", "keep"]);

export function validateAISteps(steps, headers, { allowedCategories = ["cleaning", "features"] } = {}) {
  const valid = [];
  const rejected = [];
  let H = Array.isArray(headers) ? headers.slice() : [];

  for (const step of Array.isArray(steps) ? steps : []) {
    const reg = REG_BY_TYPE[step?.type];
    if (!reg) { rejected.push({ step, reason: `unknown step type "${step?.type}"` }); continue; }
    if (!allowedCategories.includes(reg.category)) {
      rejected.push({ step, reason: `type "${step.type}" is category "${reg.category}", not allowed` });
      continue;
    }

    // schema key presence + coarse type
    let bad = null;
    for (const field of reg.schema || []) {
      const v = step[field.key];
      if (v === undefined || v === null || v === "") {
        if (OPTIONAL_KEYS.has(field.key)) continue;
        bad = `missing required key "${field.key}"`; break;
      }
      if (!coarseOk(field, v)) { bad = `key "${field.key}" has wrong type`; break; }
    }
    if (bad) { rejected.push({ step, reason: bad }); continue; }

    // column references must exist in the running header set
    const refs = [];
    for (const field of reg.schema || []) {
      if (field.type === "col" && step[field.key]) refs.push(step[field.key]);
      if (field.type === "cols" && Array.isArray(step[field.key])) refs.push(...step[field.key]);
    }
    const missingCol = refs.find(c => !H.includes(c));
    if (missingCol) { rejected.push({ step, reason: `references unknown column "${missingCol}"` }); continue; }

    // regex must compile
    if (step.regex) {
      try { new RegExp(step.regex); }
      catch { rejected.push({ step, reason: `invalid regex` }); continue; }
    }

    // thread new output column forward
    if (typeof step.nn === "string" && step.nn && !H.includes(step.nn)) H = [...H, step.nn];
    valid.push(step);
  }

  return { valid, rejected };
}
```

- [ ] **Step 2: Write the Node harness**

Create `src/pipeline/__validation__/stepValidator.test.mjs`:

```js
import { validateAISteps } from "../stepValidator.js";

let pass = 0, fail = 0;
const check = (name, cond) => cond ? (pass++, console.log("  [pass]", name)) : (fail++, console.log("  [FAIL]", name));

const headers = ["geometry", "income", "age"];

// canonical geometry case — two extract_regex steps
const geo = validateAISteps([
  { type: "extract_regex", col: "geometry", nn: "lon", regex: "\\(\\s*(-?\\d+\\.?\\d+)", locale: "dot" },
  { type: "extract_regex", col: "geometry", nn: "lat", regex: "\\s(-?\\d+\\.?\\d+)\\s*\\)", locale: "dot" },
], headers);
check("geometry: both steps valid", geo.valid.length === 2 && geo.rejected.length === 0);

// unknown type rejected
const unk = validateAISteps([{ type: "frobnicate", col: "income" }], headers);
check("unknown type rejected", unk.valid.length === 0 && /unknown step type/.test(unk.rejected[0].reason));

// out-of-category (merge) rejected
const mrg = validateAISteps([{ type: "join", rightId: "x", leftKey: "income", rightKey: "y", how: "left" }], headers);
check("merge-category step rejected", mrg.valid.length === 0 && /not allowed/.test(mrg.rejected[0].reason));

// unknown column rejected
const badcol = validateAISteps([{ type: "log", col: "nope", nn: "lnope" }], headers);
check("unknown column rejected", badcol.valid.length === 0 && /unknown column/.test(badcol.rejected[0].reason));

// sequential: step 2 references a column created by step 1
const seq = validateAISteps([
  { type: "extract_regex", col: "geometry", nn: "lon", regex: "(-?\\d+)" },
  { type: "log", col: "lon", nn: "ln_lon" },
], headers);
check("sequential nn reference passes", seq.valid.length === 2);

// malformed regex rejected
const rx = validateAISteps([{ type: "extract_regex", col: "geometry", nn: "x", regex: "(" }], headers);
check("malformed regex rejected", rx.valid.length === 0 && /invalid regex/.test(rx.rejected[0].reason));

console.log(`\nstepValidator: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
```

- [ ] **Step 3: Run the harness**

Run: `node src/pipeline/__validation__/stepValidator.test.mjs`
Expected: `stepValidator: 6 passed, 0 failed` (exit 0).

> If the `log` step in the registry uses a key other than `col`/`nn`, adjust the harness fixtures to match the real schema (read `registry.js` `type: "log"` first). The validator logic is schema-driven and does not hardcode step shapes.

- [ ] **Step 4: Commit**

```bash
git add src/pipeline/stepValidator.js src/pipeline/__validation__/stepValidator.test.mjs
git commit -m "feat(pipeline): validateAISteps — registry-checked AI step validation

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Task 3: `NL_TO_PIPELINE_PROMPT`

**Files:**
- Modify: `src/services/AI/Prompts/index.js`

- [ ] **Step 1: Add the prompt**

Add after `CLEANING_SUGGESTIONS_PROMPT` (keep the `${SHARED_CONTEXT}` prefix so it rides the cached block):

```js
// ─── PROMPT: NL → PIPELINE STEPS ─────────────────────────────────────────────
// v1.0 — used by nlToPipeline() in AIService.js.
// Translates a natural-language command into declarative pipeline steps drawn
// from STEP_REGISTRY (cleaning + features). The allowed-step catalogue is
// injected into the user payload by nlToPipeline (from serializeAllowedSteps()).
/**
 * @expectedOutput JSON object:
 *   {
 *     "interpretation": string,   // one sentence restating the request
 *     "steps": Step[],            // each { type, ...schemaKeys, desc }
 *     "notes": string             // optional caveats; "" if none
 *   }
 * Bump SHARED_CONTEXT.promptVersion when this schema changes.
 */
export const NL_TO_PIPELINE_PROMPT = `\
${SHARED_CONTEXT}
────────────────────────────────────────────────────────────────────
TASK: NATURAL LANGUAGE → PIPELINE STEPS
────────────────────────────────────────────────────────────────────
You convert a researcher's instruction into a sequence of declarative data-
cleaning pipeline steps for an econometrics tool. You will be given the current
columns (name, dtype, sample values) and the catalogue of ALLOWED steps.

Return ONLY valid JSON — no markdown fences, no preamble:
{
  "interpretation": "one sentence restating what the user asked",
  "steps": [ { "type": "<allowed type>", ...schemaKeys, "desc": "short label" } ],
  "notes": "optional caveats; empty string if none"
}

RULES:
- Use ONLY step types from the ALLOWED STEPS catalogue. Provide every key it lists.
- Reference only column names that exist in the provided column list.
- Put each new column in its own output column via the step's name key (e.g. "nn").
  NEVER overwrite the source column unless the user explicitly says "replace".
- Multi-column results require multiple steps (e.g. extracting lat AND lon = two steps).
- For extracting numbers from strings, prefer "extract_regex" with a capture group;
  it coerces the captured group to a float. Set "locale":"dot" for 1,234.56-style numbers.
- If the request cannot be expressed with allowed steps, return "steps": [] and explain in "notes".
- "desc" is a short human label for the History panel (<= 6 words).

EXAMPLES:
Instruction: "split the geometry column into latitude and longitude"
Columns: geometry (string) e.g. "POINT (-58.491021 -34.5509234)"
Output:
{"interpretation":"Extract longitude and latitude from the WKT geometry column.",
 "steps":[
   {"type":"extract_regex","col":"geometry","nn":"lon","regex":"\\\\(\\\\s*(-?\\\\d+\\\\.?\\\\d+)","locale":"dot","desc":"extract longitude"},
   {"type":"extract_regex","col":"geometry","nn":"lat","regex":"\\\\s(-?\\\\d+\\\\.?\\\\d+)\\\\s*\\\\)","locale":"dot","desc":"extract latitude"}
 ],
 "notes":"Assumes WKT POINT order is (lon lat)."}

Instruction: "make income numeric then take its log"
Columns: income (string) e.g. "US$ 1,200"
Output:
{"interpretation":"Coerce income to numeric, then add its natural log.",
 "steps":[
   {"type":"extract_regex","col":"income","nn":"income_num","locale":"dot","desc":"income to numeric"},
   {"type":"log","col":"income_num","nn":"ln_income","desc":"log income"}
 ],
 "notes":""}
`;
```

> Verify the exact key names for `log` (and any step you reference in examples) against `registry.js` before finalizing — match the real `defaultStep` keys. If `log` uses `nn` for output, the example above is correct; if not, fix the example.

- [ ] **Step 2: Build to verify**

Run: `npm run build`
Expected: success.

- [ ] **Step 3: Commit**

```bash
git add src/services/AI/Prompts/index.js
git commit -m "feat(ai): NL_TO_PIPELINE_PROMPT for declarative step generation

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Task 4: `nlToPipeline()` in AIService.js

**Files:**
- Modify: `src/services/AI/AIService.js`

- [ ] **Step 1: Add the import**

In the Prompts import block, add `NL_TO_PIPELINE_PROMPT`. Add at top with other AI imports:

```js
import { serializeAllowedSteps } from "./appCapabilityMap.js";
```

- [ ] **Step 2: Add the function**

Add near `suggestCleaning` (mirror its parse pattern exactly):

```js
// ─── NL → PIPELINE STEPS ─────────────────────────────────────────────────────
// command: string   columns: [{ name, dtype, samples: [...] }]
// Returns { interpretation, steps, notes } | { error }
export async function nlToPipeline({ command, columns = [], allowedCategories = ["cleaning", "features"], signal } = {}) {
  if (!command?.trim()) return { error: "empty command" };

  const taskPrompt = NL_TO_PIPELINE_PROMPT.replace(SHARED_CONTEXT, "").trim();
  const colBlock = columns.map(c => {
    const samples = (c.samples ?? []).slice(0, 5).map(v => JSON.stringify(v)).join(", ");
    return `  ${c.name} (${c.dtype ?? "?"}): ${samples}`;
  }).join("\n");
  const userPrompt =
    `${serializeAllowedSteps(allowedCategories)}\n\n` +
    `CURRENT COLUMNS:\n${colBlock}\n\n` +
    `INSTRUCTION: ${command.trim()}\n\nReturn the JSON now.`;

  let raw;
  try {
    raw = await callClaude({ system: taskPrompt, user: userPrompt, maxTokens: 1500, signal });
  } catch (err) {
    console.warn("[AIService] nlToPipeline failed:", err.message);
    return { error: err.message };
  }

  const cleaned = raw.replace(/```json\s*/gi, "").replace(/```\s*/g, "").trim();
  try {
    const parsed = JSON.parse(cleaned);
    return {
      interpretation: typeof parsed.interpretation === "string" ? parsed.interpretation : "",
      steps: Array.isArray(parsed.steps) ? parsed.steps : [],
      notes: typeof parsed.notes === "string" ? parsed.notes : "",
    };
  } catch (err) {
    console.warn("[AIService] nlToPipeline — JSON parse failed:", err.message);
    return { error: "Could not parse the AI response. Try rephrasing." };
  }
}
```

- [ ] **Step 3: Build to verify**

Run: `npm run build`
Expected: success.

- [ ] **Step 4: Commit**

```bash
git add src/services/AI/AIService.js
git commit -m "feat(ai): nlToPipeline — NL command to parsed pipeline steps

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Task 5: `NLCommandBar.jsx`

**Files:**
- Create: `src/components/wrangling/NLCommandBar.jsx`

- [ ] **Step 1: Write the component**

Uses `nlToPipeline` → `validateAISteps` → dry-run via `runPipeline` → preview → Apply/Discard. Match the wrangling `shared.jsx` styling (`useTheme`, `mono`, `Btn`, `Lbl`).

```jsx
// ─── ECON STUDIO · components/wrangling/NLCommandBar.jsx ──────────────────────
import { useState, useMemo } from "react";
import { useTheme, mono, Btn, Lbl } from "./shared.jsx";
import { nlToPipeline } from "../../services/AI/AIService.js";
import { validateAISteps } from "../../pipeline/stepValidator.js";
import { runPipeline } from "../../pipeline/runner.js";

export default function NLCommandBar({ rows = [], headers = [], onAddSteps }) {
  const { C } = useTheme();
  const [command, setCommand] = useState("");
  const [busy, setBusy]       = useState(false);
  const [result, setResult]   = useState(null); // { interpretation, valid, rejected, notes, preview, newCols, error }

  // Build column context (name + coarse dtype + 5 samples) from current data.
  const columns = useMemo(() => headers.map(h => {
    const samples = [];
    for (const r of rows) { if (r[h] != null) { samples.push(r[h]); if (samples.length >= 5) break; } }
    const dtype = samples.every(v => typeof v === "number") ? "number" : "string";
    return { name: h, dtype, samples };
  }), [rows, headers]);

  async function run() {
    if (!command.trim()) return;
    setBusy(true); setResult(null);
    const resp = await nlToPipeline({ command, columns });
    if (resp.error) { setResult({ error: resp.error }); setBusy(false); return; }
    const { valid, rejected } = validateAISteps(resp.steps, headers);

    // dry-run preview: apply valid steps on top of current rows (no datasets needed for cleaning/features)
    let preview = [], newCols = [];
    try {
      const out = runPipeline(rows, headers, valid, { datasets: {} });
      newCols = out.headers.filter(h => !headers.includes(h));
      preview = out.rows.slice(0, 5);
    } catch (e) { /* preview best-effort */ }

    setResult({ interpretation: resp.interpretation, notes: resp.notes, valid, rejected, preview, newCols });
    setBusy(false);
  }

  function apply() {
    if (result?.valid?.length) onAddSteps?.(result.valid);
    setResult(null); setCommand("");
  }

  const box = { background: C.surface2, border: `1px solid ${C.border2}`, borderRadius: 4,
    color: C.text, fontFamily: mono, fontSize: 12, padding: "0.5rem 0.7rem", outline: "none" };

  return (
    <div style={{ marginBottom: "1rem", padding: "0.8rem", background: C.surface,
      border: `1px solid ${C.border}`, borderLeft: `3px solid ${C.blue}`, borderRadius: 4 }}>
      <Lbl color={C.blue}>AI command — describe what to do to your data</Lbl>
      <div style={{ display: "flex", gap: 8 }}>
        <input value={command} onChange={e => setCommand(e.target.value)}
          onKeyDown={e => { if (e.key === "Enter") run(); }}
          placeholder='e.g. "split geometry into lat and lon"'
          style={{ ...box, flex: 1 }} disabled={busy} />
        <Btn onClick={run} color={C.blue} v="solid" dis={busy || !command.trim()}
          ch={busy ? "Thinking…" : "Ask AI →"} />
      </div>

      {result?.error && (
        <div style={{ marginTop: 8, color: C.red, fontFamily: mono, fontSize: 11 }}>⚠ {result.error}</div>
      )}

      {result && !result.error && (
        <div style={{ marginTop: 10, padding: "0.6rem 0.8rem", background: C.surface2,
          border: `1px solid ${C.border}`, borderRadius: 4 }}>
          <div style={{ fontSize: 11, color: C.textDim, fontFamily: mono, marginBottom: 6 }}>
            {result.interpretation}
          </div>
          {result.valid.map((s, i) => (
            <div key={i} style={{ fontSize: 11, color: C.green, fontFamily: mono }}>
              ✓ {i + 1}. {s.type} — {s.desc ?? ""}
            </div>
          ))}
          {result.rejected.map((r, i) => (
            <div key={i} style={{ fontSize: 11, color: C.yellow, fontFamily: mono }}>
              ✗ {r.step?.type ?? "?"} — {r.reason}
            </div>
          ))}
          {result.notes && (
            <div style={{ fontSize: 10, color: C.textMuted, fontFamily: mono, marginTop: 4 }}>{result.notes}</div>
          )}
          {result.newCols.length > 0 && (
            <div style={{ marginTop: 8, fontSize: 10, color: C.textDim, fontFamily: mono }}>
              New columns: <span style={{ color: C.blue }}>{result.newCols.join(", ")}</span>
              <div style={{ marginTop: 4 }}>
                {result.preview.map((r, i) => (
                  <div key={i}>{result.newCols.map(c => `${c}=${r[c]}`).join("  ")}</div>
                ))}
              </div>
            </div>
          )}
          <div style={{ display: "flex", gap: 8, marginTop: 10 }}>
            <Btn onClick={apply} color={C.green} v="solid" dis={!result.valid.length}
              ch={`Apply ${result.valid.length} step${result.valid.length !== 1 ? "s" : ""} →`} />
            <Btn onClick={() => setResult(null)} color={C.textDim} v="ghost" ch="Discard" />
          </div>
        </div>
      )}
    </div>
  );
}
```

> Confirm `Btn`'s prop names (`v`, `ch`, `dis`, `color`) against `shared.jsx` — they match MergeTab usage, but verify `v="ghost"` is a supported variant; if not, use the available secondary variant.

- [ ] **Step 2: Build to verify**

Run: `npm run build`
Expected: success.

- [ ] **Step 3: Commit**

```bash
git add src/components/wrangling/NLCommandBar.jsx
git commit -m "feat(wrangling): NLCommandBar — preview/apply AI-generated steps

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Task 6: Mount NLCommandBar in WranglingModule

**Files:**
- Modify: `src/WranglingModule.jsx`

> ⚠ Codex may have uncommitted edits elsewhere in the wrangling tree. This task touches ONLY `WranglingModule.jsx`, which is not in Codex's Batch-1 file set. Pull/rebase coordination is the user's call before this lands.

- [ ] **Step 1: Import the component**

Add near the other component imports:

```js
import NLCommandBar from "./components/wrangling/NLCommandBar.jsx";
```

- [ ] **Step 2: Render it above the tab router**

Find where the tabs render (around line 660, the `<CleanTab .../>` block). Immediately before the tab-router container, add:

```jsx
<NLCommandBar rows={rows} headers={headers} onAddSteps={steps => steps.forEach(addStep)} />
```

`rows`, `headers`, and `addStep` are all already in scope in `WranglingModule` (`rows`/`headers` from `processed` at line 166; `addStep` is the `useCallback` at line 257). `addStep` uses a functional `setPipeline` updater, so calling it in a `forEach` appends all steps in order correctly.

- [ ] **Step 3: Build + browser-validate**

Run: `npm run build` → success.
Browser: load a dataset with a WKT `geometry` column → type "split geometry into lat and lon" → preview shows two numeric columns (e.g. lon=-58.491021, lat=-34.5509234) → Apply adds two `extract_regex` steps to History → Undo removes them. Then try "make income numeric and log it" and a nonsense command (expect graceful notes / empty).

- [ ] **Step 4: Commit**

```bash
git add src/WranglingModule.jsx
git commit -m "feat(wrangling): mount NLCommandBar above the tab router

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Task 7: Docs

**Files:**
- Modify: `CLAUDE.md`, `ClaudePlan.md`

- [ ] **Step 1: Note the new files in CLAUDE.md**

Add to the file-structure block: `src/services/AI/appCapabilityMap.js`, `src/pipeline/stepValidator.js`, `src/components/wrangling/NLCommandBar.jsx`, and note `nlToPipeline` in the AIService line and `NL_TO_PIPELINE_PROMPT` in the Prompts line.

- [ ] **Step 2: Mark the spec DONE in ClaudePlan.md**

Change the `2026-06-05 ai-execute-clean-commands` row status from `OPEN` to `DONE`.

- [ ] **Step 3: Commit**

```bash
git add CLAUDE.md ClaudePlan.md
git commit -m "docs: register NL command bar feature + mark spec done

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Self-review notes

- **Collision audit:** new files (appCapabilityMap, stepValidator + harness, NLCommandBar) + edits to `Prompts/index.js`, `AIService.js`, `WranglingModule.jsx`, `CLAUDE.md`/`ClaudePlan.md`. None of the JS source files overlap Codex's Batch-1 set (runner, registry, MergeTab/CleanTab/ReshapeTab/FeatureTab, export scripts). Only `CLAUDE.md`/`ClaudePlan.md` are shared docs — expect a trivial merge.
- **Determinism / real tests:** Task 2's Node harness is the automated gate; everything else is build + browser.
- **No `runner.js` edit:** the geometry fix rides existing `extract_regex`. The validator and preview both import from `runner.js`/`registry.js` read-only.
- **Caching preserved:** `NL_TO_PIPELINE_PROMPT` keeps the `${SHARED_CONTEXT}` prefix; `nlToPipeline` strips it before sending (callClaude re-attaches it as the cached block), matching `suggestCleaning`.
- **Verify-before-final:** Tasks 2/3/5 each carry a "confirm real schema/props" note because exact registry keys (`log`) and `Btn` variants must match the live code — read those before finalizing the fixtures/examples.
```
