# Session-aware & App-aware Research Coach — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax.
>
> Source spec: `docs/superpowers/specs/2026-06-05-session-aware-coach-design.md`. Executor: Claude. **Collision-free with Codex Batch 1** (none of these files are in Codex's set except the shared `CLAUDE.md`/`ClaudePlan.md`).

**Goal:** Bring the interactive Research Coach to parity with the Report-AI — feed it the full session snapshot (pipeline, pinned models, subsets, inference options, session log) and a static app-capability map so it can give actionable "go to Module → Tab" guidance.

**Architecture:** `researchCoach` gains a `snapshot` arg (serialized once on the first turn) and a cached capability-map system block. `AIContextSidebar` builds the snapshot from props it mostly already has; `ModelingTab` surfaces `pinnedModels`/`subsets`/`inferenceOpts` to `App`, which threads them to both sidebar mounts. The capability map is hybrid: a curated tab shell + auto-derived step catalogue from `STEP_REGISTRY`, living in the existing `appCapabilityMap.js`.

**Tech Stack:** React + Vite + plain JS. No JS unit runner — gates: Node harness for the pure serializer, `npm run build`, Franco browser-validation.

**Invariants:**
- Single API egress (`AIService.js`); prompt caching preserved (capability map rides a `cache_control: ephemeral` block).
- Token discipline: dynamic snapshot injected **first turn only**; static capability map cached.
- No change to `sessionSnapshot.js` (already supports all fields).
- Branch `Main-`. Codex is active — add only each task's files; never `git add -A`. `CLAUDE.md`/`ClaudePlan.md` are shared — surgical edits to distinct lines.

---

## Task 1: Add `APP_CAPABILITY_MAP` + `serializeCapabilityMap()` to appCapabilityMap.js

**Files:**
- Modify: `src/services/AI/appCapabilityMap.js` (already exists, exports `serializeAllowedSteps`)
- Create: `src/services/AI/__validation__/capabilityMap.test.mjs`

- [ ] **Step 1: Append the curated shell + serializer**

Add to `src/services/AI/appCapabilityMap.js` (keep the existing `serializeAllowedSteps`; add below it). It reuses the already-imported `STEP_REGISTRY` and adds `CATEGORIES`:

```js
import { STEP_REGISTRY, CATEGORIES } from "../../pipeline/registry.js";
```
(Update the existing import line to also pull `CATEGORIES`.)

Then append:

```js
// Curated shell — the ONE place to edit when a tab/sub-tab is added.
// Keep each entry to a single short purpose line.
export const APP_CAPABILITY_MAP = {
  Data:      { purpose: "Load & inspect datasets", subtabs: {
                 "Data Viewer": "browse/edit the table, per-cell edits",
                 "Sources": "fetch from World Bank / OECD, upload CSV/Excel/Stata/RDS/Parquet/shapefile" } },
  Clean:     { purpose: "Wrangle & clean the data (builds the pipeline)", subtabs: {
                 "Cleaning": "filter, drop NA, fill NA, recode, winsorize, trim/flag outliers, distinct",
                 "Panel Structure": "declare entity/time panel structure",
                 "Transform": "log/sq/z-score, lag/lead/diff, dummies, dates, mutate, generate column from vector",
                 "Reshape & Merge": "pivot longer/wider, group & summarize, group transform, joins, append, combine, vector",
                 "Dictionary": "AI-infer or edit variable descriptions",
                 "AI command": "describe a change in plain language; preview & apply pipeline steps" } },
  Explore:   { purpose: "Descriptive stats & plots", subtabs: {
                 "Explorer": "summary stats, distributions",
                 "Plot Builder": "layered charts (point/line/bar/histogram/density)" } },
  Model:     { purpose: "Estimate econometric models", subtabs: {
                 "Estimator": "pick a model (OLS, FE, IV/2SLS, RDD, DiD, Logit/Probit, GMM, SC)",
                 "Variables": "choose Y, X, instruments, weights",
                 "Inference Options": "SE type — classical / HC1-3 / clustered / two-way / HAC",
                 "Diagnostics": "heteroskedasticity, autocorrelation, normality tests",
                 "Compare": "pin models side by side; run across subsets",
                 "Code": "view/edit R / Python / Stata replication code" } },
  Simulate:  { purpose: "DGP builder, Monte Carlo, pre-model sample tests", subtabs: {} },
  Calculate: { purpose: "Calculator workspace", subtabs: {} },
  Report:    { purpose: "Publication output — LaTeX tables, forest plots, AI narrative & unified script", subtabs: {} },
};

// Full app map: curated shell + auto-derived pipeline operations (never drifts).
export function serializeCapabilityMap() {
  const lines = ["ECON STUDIO — WHERE TO DO THINGS (guide the user to the right place):"];
  for (const [tab, info] of Object.entries(APP_CAPABILITY_MAP)) {
    lines.push(`\n[${tab}] ${info.purpose}`);
    for (const [sub, desc] of Object.entries(info.subtabs || {})) {
      lines.push(`  - ${sub}: ${desc}`);
    }
  }
  lines.push("\nWRANGLING OPERATIONS (pipeline steps, auto-listed from the registry):");
  for (const cat of CATEGORIES) {
    const steps = STEP_REGISTRY.filter(s => s.category === cat.id && !s.internal);
    if (!steps.length) continue;
    lines.push(`  ${cat.label}: ${steps.map(s => s.label).join("; ")}`);
  }
  return lines.join("\n");
}
```

- [ ] **Step 2: Write the Node harness**

Create `src/services/AI/__validation__/capabilityMap.test.mjs`:

```js
import { serializeCapabilityMap, serializeAllowedSteps } from "../appCapabilityMap.js";

let pass = 0, fail = 0;
const check = (n, c) => c ? (pass++, console.log("  [pass]", n)) : (fail++, console.log("  [FAIL]", n));

const map = serializeCapabilityMap();
check("map is non-empty", typeof map === "string" && map.length > 100);
for (const tab of ["Data", "Clean", "Explore", "Model", "Simulate", "Calculate", "Report"]) {
  check(`map names tab ${tab}`, map.includes(`[${tab}]`));
}
check("map lists Merge category ops", /Merge:/.test(map));
check("map lists Cleaning category ops", /Cleaning:/.test(map));
check("allowed steps still works", serializeAllowedSteps().includes("ALLOWED PIPELINE STEPS"));

console.log(`\ncapabilityMap: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
```

- [ ] **Step 3: Run the harness**

Run: `node src/services/AI/__validation__/capabilityMap.test.mjs`
Expected: `capabilityMap: 11 passed, 0 failed`.

> If `CATEGORIES` uses `label` values other than "Cleaning"/"Merge", adjust the two regex checks to match the real labels (read `registry.js` `CATEGORIES`). The labels confirmed at authoring time: Cleaning, Features, Reshape, Merge.

- [ ] **Step 4: Commit**

```bash
git add src/services/AI/appCapabilityMap.js src/services/AI/__validation__/capabilityMap.test.mjs
git commit -m "feat(ai): serializeCapabilityMap — app structure for the coach

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Task 2: `streamClaude` optional cached block

**Files:**
- Modify: `src/services/AI/AIService.js` (`streamClaude`, ~line 183)

- [ ] **Step 1: Add the `extraCached` param**

Change the signature and systemArray build:

```js
export async function streamClaude({ system, messages, maxTokens = MAX_TOK, model = MODEL, signal, onText, extraCached = null }) {
  const systemArray = [
    { type: "text", text: SHARED_CONTEXT, cache_control: { type: "ephemeral" } },
  ];
  if (extraCached) systemArray.push({ type: "text", text: extraCached, cache_control: { type: "ephemeral" } });
  if (system) systemArray.push({ type: "text", text: system });
```

(Everything else in `streamClaude` is unchanged. The extra block is a stable prefix → cache stays warm across coach turns. Other callers pass no `extraCached` → behavior unchanged.)

- [ ] **Step 2: Build to verify**

Run: `npm run build`
Expected: success.

- [ ] **Step 3: Commit**

```bash
git add src/services/AI/AIService.js
git commit -m "feat(ai): streamClaude accepts an optional cached system block

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Task 3: `researchCoach` — snapshot + capability map

**Files:**
- Modify: `src/services/AI/AIService.js` (`researchCoach`, ~line 832; imports near top)

- [ ] **Step 1: Add imports**

In the `appCapabilityMap.js` import (added during the AI-execute work), also pull `serializeCapabilityMap`:

```js
import { serializeAllowedSteps, serializeCapabilityMap } from "./appCapabilityMap.js";
```

- [ ] **Step 2: Memoize the capability map once (module scope)**

Add near the top-level constants (after `MAX_TOK`):

```js
// Static app capability map — built once, sent as a cached block to the coach.
let _capabilityMapCache = null;
function getCapabilityMap() {
  if (_capabilityMapCache == null) _capabilityMapCache = serializeCapabilityMap();
  return _capabilityMapCache;
}
```

- [ ] **Step 3: Add the specialist snapshot helper**

Add above `researchCoach`:

```js
function _specialistSnapshotLine(snapshot) {
  if (!snapshot) return "";
  const steps  = snapshot.pipeline?.length ? `${snapshot.pipeline.length} pipeline steps` : "no pipeline";
  const se     = snapshot.inferenceOpts?.seType ? `, SE=${snapshot.inferenceOpts.seType}` : "";
  const pinned = snapshot.pinnedModels?.length ? `, ${snapshot.pinnedModels.length} pinned models` : "";
  return `\nSESSION: ${steps}${se}${pinned}.`;
}
```

- [ ] **Step 4: Thread snapshot through `researchCoach`**

Change the signature to accept `snapshot`:

```js
export async function researchCoach({ question, images = [], modelResult, dataDictionary = null, history = [], metadataReport = null, snapshot = null, signal = undefined, onText = undefined }) {
```

Build a snapshot block and append it to `contextPrefix`. Find:
```js
  const contextPrefix = `MODEL CONTEXT:\n${modelContext}${metaCtx}\n\n────────────────────────────\n`;
```
Replace with:
```js
  const snapshotBlk = snapshot ? "\nSESSION CONTEXT:\n" + serializeSnapshot(snapshot) + "\n" : "";
  const contextPrefix = `MODEL CONTEXT:\n${modelContext}${metaCtx}${snapshotBlk}\n\n────────────────────────────\n`;
```

Add the snapshot line to the Opus specialist `user` payload. Find:
```js
      user:   `RESEARCH CONTEXT:\n${modelContext}\n\nRESEARCHER QUESTION: ${question.trim()}`,
```
Replace with:
```js
      user:   `RESEARCH CONTEXT:\n${modelContext}${_specialistSnapshotLine(snapshot)}\n\nRESEARCHER QUESTION: ${question.trim()}`,
```

Pass the capability map as the cached block in the Sonnet `streamClaude` call. Find:
```js
    return await streamClaude({ system: taskPrompt, messages: apiMessages, maxTokens: 800, signal, onText });
```
Replace with:
```js
    return await streamClaude({ system: taskPrompt, messages: apiMessages, maxTokens: 800, signal, onText, extraCached: getCapabilityMap() });
```

- [ ] **Step 5: Build to verify**

Run: `npm run build`
Expected: success.

- [ ] **Step 6: Commit**

```bash
git add src/services/AI/AIService.js
git commit -m "feat(ai): researchCoach is session-aware (snapshot) + app-aware (capability map)

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Task 4: `RESEARCH_COACH_PROMPT` navigation rule

**Files:**
- Modify: `src/services/AI/Prompts/index.js` (`RESEARCH_COACH_PROMPT`)

- [ ] **Step 1: Add the rule**

Locate `RESEARCH_COACH_PROMPT` and add a rule near its other guidance (keep `${SHARED_CONTEXT}` intact):

```
- You know the app's structure (see the WHERE TO DO THINGS map in the system context) and the user's full session (pipeline, pinned models, subsets, SE choices). When the user asks how to perform an action, or when your advice implies a change, name the exact location: Module → Tab → Section. Prefer concrete navigation over generic instructions. Reference the user's actual pipeline steps, pinned models, and SE settings when relevant. Never invent a tab or operation that is not in the map.
```

- [ ] **Step 2: Build to verify**

Run: `npm run build`
Expected: success.

- [ ] **Step 3: Commit**

```bash
git add src/services/AI/Prompts/index.js
git commit -m "feat(ai): coach prompt — actionable navigation + session references

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Task 5: `AIContextSidebar` builds + passes the snapshot

**Files:**
- Modify: `src/components/AIContextSidebar.jsx`

- [ ] **Step 1: Add imports**

Near the existing session import:

```js
import { useSessionLog } from "../services/session/sessionLog.jsx";
import { buildSessionSnapshot } from "../services/AI/sessionSnapshot.js";
```

> Confirm the hook export name in `sessionLog.jsx` (`useSessionLog`). If it differs, match it. AIContextSidebar is rendered inside `SessionLogProvider` (App.jsx), so the hook is in scope.

- [ ] **Step 2: Accept new props**

Change the signature (line 285) to add three props with safe defaults:

```js
export default function AIContextSidebar({ isOpen, onClose, screen, cleanedData, modelResult, prefillMessage = null, pid = null, pinnedModels = [], subsets = null, inferenceOpts = null }) {
```

- [ ] **Step 3: Build the snapshot**

After `const sessionState = useSessionState();` (line 289) add:

```js
  const sessionLog = useSessionLog();
  const snapshot = useMemo(() => buildSessionSnapshot({
    cleanedData,
    result: modelResult,
    pinnedModels,
    subsets,
    inferenceOpts,
    sessionLog: sessionLog?.entries ?? sessionLog ?? [],
  }), [cleanedData, modelResult, pinnedModels, subsets, inferenceOpts, sessionLog]);
```

> Confirm what `useSessionLog()` returns (an array, or `{ entries }`). The `?? sessionLog ?? []` chain handles both; tighten it to the real shape after reading `sessionLog.jsx`.

- [ ] **Step 4: Pass snapshot to researchCoach**

In the `researchCoach({ ... })` call (line ~453), add `snapshot,` alongside the other args:

```js
        modelResult,
        dataDictionary: cleanedData?.dataDictionary ?? null,
        metadataReport,
        snapshot,
        signal: controller.signal,
```

- [ ] **Step 5: Fix the overstated "full context" copy**

Find the line (~626) claiming full session context. Make it conditional on a real snapshot:

```jsx
{snapshot?.pipeline?.length || snapshot?.activeResult
  ? <>I have full context of your session — {screenLabel} state, pipeline, and model. Ask anything.</>
  : <>I can see your current {screenLabel} state. Ask anything.</>}
```

> Match the exact surrounding JSX; the goal is to stop claiming "full context" when none exists.

- [ ] **Step 6: Build + browser-validate**

Run: `npm run build` → success.
Browser (partial — full validation after App wiring in Task 7): open the coach on the Model screen, confirm no crash and a normal reply.

- [ ] **Step 7: Commit**

```bash
git add src/components/AIContextSidebar.jsx
git commit -m "feat(coach): build session snapshot + pass to researchCoach

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Task 6: `ModelingTab` surfaces session state

**Files:**
- Modify: `src/components/ModelingTab.jsx`

- [ ] **Step 1: Add the prop**

Add `onSessionStateChange` to the props (line 204):

```js
export default function ModelingTab({ cleanedData, availableDatasets = [], onBack, onResultChange, onSessionStateChange, onCoachQuestion, onExtract, pid }) {
```

- [ ] **Step 2: Add the surfacing effect**

Near the existing `useEffect(() => { onResultChange?.(result); }, [result]);` (line 467), add:

```js
  useEffect(() => {
    onSessionStateChange?.({
      pinnedModels,
      subsets,
      inferenceOpts: { seType, clusterVar, clusterVar2 },
    });
  }, [pinnedModels, subsets, seType, clusterVar, clusterVar2]);
```

(`pinnedModels` is the useMemo at line 389, `subsets` the state at 383, `seType`/`clusterVar`/`clusterVar2` at 315–317 — all in scope.)

- [ ] **Step 3: Build to verify**

Run: `npm run build`
Expected: success.

- [ ] **Step 4: Commit**

```bash
git add src/components/ModelingTab.jsx
git commit -m "feat(modeling): surface pinned/subsets/inference to parent via onSessionStateChange

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Task 7: `App.jsx` wiring

**Files:**
- Modify: `src/App.jsx`

- [ ] **Step 1: Add the holding state**

Near `const [activeResult, setActiveResult] = useState(null);` (line 1891):

```js
  const [modelingSession, setModelingSession] = useState({ pinnedModels: [], subsets: null, inferenceOpts: null });
```

- [ ] **Step 2: Wire ModelingTab**

In the `<ModelingTab ... />` render (line ~2200), add after `onResultChange={r=>setActiveResult(r)}`:

```jsx
                        onSessionStateChange={setModelingSession}
```

- [ ] **Step 3: Thread to both sidebar mounts**

Both `<AIContextSidebar ... />` mounts (lines ~2297 and ~2312) get three new props. Add to each, after `modelResult={activeResult}`:

```jsx
            pinnedModels={modelingSession.pinnedModels}
            subsets={modelingSession.subsets}
            inferenceOpts={modelingSession.inferenceOpts}
```

> Match the indentation of each mount block. Add to BOTH — they are duplicated for layout.

- [ ] **Step 4: Build + browser-validate**

Run: `npm run build` → success.
Browser (full validation):
1. Build a pipeline (a few clean steps) + estimate a model + pin a second model + set SE to clustered.
2. Open the coach, ask "how do I drop duplicate rows?" → expect a Clean → Cleaning/Distinct pointer.
3. Ask "is my SE choice appropriate?" → coach should reference clustered SE.
4. Ask about model choice → coach should reference both pinned models.
5. Network check: first coach turn payload includes the SESSION CONTEXT block; later turns in the same conversation do not re-send it.

- [ ] **Step 5: Commit**

```bash
git add src/App.jsx
git commit -m "feat(app): thread modeling session state into both coach sidebars

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Task 8: Docs

**Files:**
- Modify: `CLAUDE.md`, `ClaudePlan.md`

- [ ] **Step 1: CLAUDE.md**

- In the `appCapabilityMap.js` structure line, append `+ serializeCapabilityMap (app structure for coach)`.
- Add a one-line working convention near the style/working conventions section: *"When adding a workspace tab/sub-tab, add its row to `APP_CAPABILITY_MAP` in `appCapabilityMap.js` so the AI coach's navigation guidance stays accurate."*

- [ ] **Step 2: ClaudePlan.md**

Change the `2026-06-05 session-aware-coach` row status from `OPEN` to `DONE (browser-validation pending)`.

- [ ] **Step 3: Commit**

```bash
git add CLAUDE.md ClaudePlan.md
git commit -m "docs: register session-aware coach + APP_CAPABILITY_MAP maintenance rule

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Self-review notes

- **Spec coverage:** Part 1.1 (snapshot in researchCoach) → Task 3; 1.2 (sidebar builds snapshot) → Task 5; 1.3 (lift modeling state) → Tasks 6–7; Part 2.1 (capability module) → Task 1; 2.2 (cached injection) → Tasks 2–3; 2.3 (caching correctness) → Task 2's stable-prefix block; prompt rule → Task 4; docs → Task 8.
- **Type consistency:** `snapshot` shape is whatever `buildSessionSnapshot` returns (unchanged); `inferenceOpts` passed as `{ seType, clusterVar, clusterVar2 }` matches `serializeSnapshot`'s reads (`seType`, `clusterVar`, `clusterVar2`).
- **Read-first flags:** Task 1 (CATEGORIES labels), Task 5 (`useSessionLog` export + return shape) — verify against live code before finalizing, as noted inline.
- **No JS unit runner:** Task 1's Node harness is the only automated gate; the rest are build + browser.
- **Token discipline:** snapshot is in `contextPrefix`, which `researchCoach` only sends when `apiMessages.length === 0` (first turn); the capability map is a cached block.
```
