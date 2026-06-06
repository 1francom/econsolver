# Session-aware & App-aware Research Coach (design)

**Date:** 2026-06-05
**Status:** OPEN
**Author:** Claude. **Executor:** Claude (this is the parallel track to Codex's Batch 1; chosen because it is collision-free with Codex's file set).
**Source conversation:** roadmap item 3 ("the AI coach context"), expanded to include app-structure knowledge so the coach can give actionable navigation guidance.

## Purpose

The interactive Research Coach currently sees **one model**. The Report-AI already sees the **whole session** via `sessionSnapshot.js`, but `researchCoach` was never wired to it. This spec brings the coach to parity (session awareness) **and** adds a capability map (app awareness) so the coach can tell users *where in the app to act*, not just *what is wrong*.

Two capabilities:
1. **Session awareness** — the coach receives the wrangling pipeline, data dictionary, panel index, active model, pinned/compared models, named subsets, inference (SE) options, data-load context, and the cross-module session log.
2. **App awareness** — the coach knows the workspace structure (modules → tabs → sub-tabs → sections) and what each does, so it can answer "how do I…" with a concrete path (e.g. "Clean → Distinct to drop those duplicate rows", "Model → Inference Options → clustered SE").

## Current state (verified 2026-06-05)

- `src/services/AI/sessionSnapshot.js` already builds a rich snapshot (`buildSessionSnapshot`) and serializes it (`serializeSnapshot`). It supports `dataLoadOpts`, `pipeline`, `dataDictionary`, `panelIndex`, `activeResult`, `inferenceOpts`, `pinnedModels`, `subsets`, `sessionLog`.
- `interpretRegression` and `generateUnifiedScript` accept `{ snapshot }`. **`researchCoach` does not.**
- `researchCoach` (`AIService.js:832`) builds context only from `modelResult` + `dataDictionary` + `metadataReport` via `_serializeModelContext`. It runs a two-stage flow: an Opus specialist sub-answer (`callClaude`, `MODEL_ADVISOR`) then a Sonnet orchestration (`streamClaude`). Snapshot/context is added to the **first user turn only** (`apiMessages.length === 0` branch).
- The coach UI is `AIContextSidebar.jsx` (calls `researchCoach` at line ~453). It already receives `cleanedData` (`headers`, `cleanRows`, `pipeline`, `dataDictionary`, `panelIndex`) and `modelResult`, and has `useSessionState`/session log access. Line ~626 already *claims* "I have full context of your session — pipeline, and model" — currently overstated.
- `AIContextSidebar` is mounted twice in `App.jsx` (lines ~2297 and ~2312). App passes `cleanedData={tabOutput(activeTab)}` and `modelResult={activeResult}`. App has `activeResult` (via `ModelingTab onResultChange`) but **not** `pinnedModels`/`subsets`/`inferenceOpts` — those live inside `ModelingTab`.
- `STEP_REGISTRY` (`registry.js`) already has `category`, `label`, `description` for every pipeline step — a machine-readable source for the wrangling part of the capability map. `CATEGORIES` lists the wrangling groups.

## Architectural invariants

- **Single API egress** — all calls stay inside `AIService.js`. No new fetch.
- **Prompt caching** — the capability map is **static** and goes into the coach's cached system block, not the per-turn user payload. `callClaude` already strips and re-attaches `SHARED_CONTEXT` as the cached block with `cache_control: ephemeral` + the `prompt-caching-2024-07-31` header. The capability map must ride the cached path so it costs ~0 per call after the first.
- **Token discipline** — the (dynamic) session snapshot is injected **once on the first turn**; multi-turn history carries it forward. The (static) capability map lives in the cached system prompt.
- **No React in `src/services/AI/`** logic modules (they're plain JS; `AIContextSidebar.jsx` is the React boundary).

---

## Part 1 — Session awareness

### 1.1 `researchCoach` accepts a snapshot

`AIService.js` — extend the signature:

```js
export async function researchCoach({
  question, images = [], modelResult, dataDictionary = null,
  history = [], metadataReport = null, snapshot = null,   // NEW
  signal = undefined, onText = undefined,
}) { ... }
```

Assembly changes:
- Build `snapshotBlk = snapshot ? "\nSESSION CONTEXT:\n" + serializeSnapshot(snapshot) + "\n" : ""` (mirror `interpretRegression:534`).
- Append `snapshotBlk` to the `contextPrefix` (which is only sent on the first turn). The detailed `_serializeModelContext(modelResult, dataDictionary)` stays — it carries model-specific richness (RDD/SC/2SLS first-stage F) that `serializeSnapshot`'s trimmed result lacks. Order: model context first (most specific), then session context.
- Feed a **trimmed** snapshot to the Opus specialist call so it can reason about identification given the pipeline, without blowing its 250-token budget. Add a one-line pipeline + inference summary to the specialist's `user` payload (not the full serialization). Helper:

```js
function _specialistSnapshotLine(snapshot) {
  if (!snapshot) return "";
  const steps = snapshot.pipeline?.length ? `${snapshot.pipeline.length} pipeline steps` : "no pipeline";
  const se = snapshot.inferenceOpts?.seType ? `, SE=${snapshot.inferenceOpts.seType}` : "";
  const pinned = snapshot.pinnedModels?.length ? `, ${snapshot.pinnedModels.length} pinned models` : "";
  return `\nSESSION: ${steps}${se}${pinned}.`;
}
```

### 1.2 `AIContextSidebar` builds and passes the snapshot

`AIContextSidebar.jsx`:
- Import `buildSessionSnapshot` from `../services/AI/sessionSnapshot.js` and the session log hook.
- Build a memoized snapshot:

```js
const snapshot = useMemo(() => buildSessionSnapshot({
  cleanedData,
  result: modelResult,
  pinnedModels,                 // NEW prop
  subsets,                      // NEW prop
  inferenceOpts,                // NEW prop
  sessionLog: sessionLog ?? [],
}), [cleanedData, modelResult, pinnedModels, subsets, inferenceOpts, sessionLog]);
```

- Pass `snapshot` into the `researchCoach({ ... })` call.
- Accept new props: `pinnedModels = []`, `subsets = null`, `inferenceOpts = null`.
- Fix the overstated line (~626): keep the "full context" copy ONLY when a snapshot with a pipeline/models actually exists; otherwise soften to "I can see your current {screen} state."

### 1.3 Lift modeling session state to App

`ModelingTab.jsx` — add a callback prop `onSessionStateChange` (alongside `onResultChange`) fired whenever `pinnedModels`, `subsets`, or `inferenceOpts` change:

```js
useEffect(() => {
  onSessionStateChange?.({ pinnedModels, subsets, inferenceOpts });
}, [pinnedModels, subsets, inferenceOpts]); // (use the actual state variable names in ModelingTab)
```

> Implementation note: confirm the exact local names in ModelingTab (the inference options object, the pinned-models buffer, and the subset map). Wire whatever those are into the payload. Do not rename existing state.

`App.jsx`:
- Add state: `const [modelingSession, setModelingSession] = useState({ pinnedModels: [], subsets: null, inferenceOpts: null });`
- Pass `onSessionStateChange={setModelingSession}` to `<ModelingTab>`.
- Pass `pinnedModels={modelingSession.pinnedModels}`, `subsets={modelingSession.subsets}`, `inferenceOpts={modelingSession.inferenceOpts}` to **both** `<AIContextSidebar>` mounts (lines ~2297 and ~2312).

---

## Part 2 — App awareness (capability map)

### 2.1 New module `src/services/AI/appCapabilityMap.js`

Hybrid: a small curated declarative shell + auto-derived operation lists. Pure JS, no React.

```js
// Curated shell — the ONE place to edit when a tab/sub-tab is added.
// Keep entries to a single short purpose line. Do NOT enumerate every step
// here (that is auto-derived from STEP_REGISTRY in serializeCapabilityMap).
export const APP_CAPABILITY_MAP = {
  Data:      { purpose: "Load & inspect datasets", subtabs: {
                 "Data Viewer": "browse/edit the table, per-cell edits",
                 "Sources": "fetch from World Bank / OECD, upload CSV/Excel/Stata/RDS/Parquet/shapefile" } },
  Clean:     { purpose: "Wrangle & clean the data (builds the pipeline)", subtabs: {
                 "Clean": "filter, drop NA, fill NA, recode, winsorize, trim/flag outliers, distinct",
                 "Panel": "declare entity/time panel structure",
                 "Feature": "log/sq/z-score, lag/lead/diff, dummies, dates, mutate, generate column from vector",
                 "Reshape": "pivot longer/wider, group & summarize, group transform",
                 "Merge": "join (left/inner/right/full/semi/anti), append, combine (bind/union/intersect/setdiff), vector",
                 "Dictionary": "AI-infer or edit variable descriptions" } },
  Explore:   { purpose: "Descriptive stats & plots", subtabs: {
                 "Explorer": "summary stats, distributions",
                 "Plot Builder": "layered charts (point/line/bar/histogram/density…)" } },
  Model:     { purpose: "Estimate econometric models", subtabs: {
                 "Estimator": "pick a model (OLS, FE, IV/2SLS, RDD, DiD, Logit/Probit, GMM, SC…)",
                 "Variables": "choose Y, X, instruments, weights",
                 "Inference Options": "SE type — classical / HC1-3 / clustered / two-way / HAC",
                 "Diagnostics": "heteroskedasticity, autocorrelation, normality tests",
                 "Compare": "pin models side by side; run across subsets",
                 "Code": "view/edit R / Python / Stata replication code" } },
  Simulate:  { purpose: "DGP builder, Monte Carlo, pre-model sample tests", subtabs: {} },
  Calculate: { purpose: "Calculator workspace", subtabs: {} },
  Report:    { purpose: "Publication output — LaTeX tables, forest plots, AI narrative & unified script", subtabs: {} },
};

// Auto-derive the wrangling-operation catalogue from the registry so it never
// drifts (Codex keeps STEP_REGISTRY in sync by invariant).
import { STEP_REGISTRY, CATEGORIES } from "../../pipeline/registry.js";

export function serializeCapabilityMap() {
  const lines = ["ECON STUDIO — WHERE TO DO THINGS (use this to guide the user to the right place):"];
  for (const [tab, info] of Object.entries(APP_CAPABILITY_MAP)) {
    lines.push(`\n[${tab}] ${info.purpose}`);
    for (const [sub, desc] of Object.entries(info.subtabs || {})) {
      lines.push(`  - ${sub}: ${desc}`);
    }
  }
  // Auto-derived pipeline operations grouped by category
  lines.push("\nWRANGLING OPERATIONS (pipeline steps, auto-listed from the registry):");
  for (const cat of CATEGORIES) {
    const steps = STEP_REGISTRY.filter(s => s.category === cat.id && !s.internal);
    if (!steps.length) continue;
    lines.push(`  ${cat.label}: ${steps.map(s => s.label).join("; ")}`);
  }
  return lines.join("\n");
}
```

> The estimator list is short and stable; it is described in the curated `Model` shell above. If an enumerable estimator registry is convenient at implementation time, append it the same way as steps — otherwise the curated line suffices (YAGNI).

### 2.2 Inject the map into the coach's cached system prompt

`Prompts/index.js` — `RESEARCH_COACH_PROMPT`:
- The map is static, so it belongs in the **cached** block. The coach's `streamClaude` call passes `system: taskPrompt`. To keep caching, the capability map text should be concatenated into the **cached** portion the same way `SHARED_CONTEXT` is. Implementation: build the coach system prompt as `RESEARCH_COACH_PROMPT` (which already embeds `SHARED_CONTEXT`) and append `serializeCapabilityMap()` once, in `AIService.js`, into the cached system string. Confirm the streaming path applies `cache_control` to this system block (mirror how `callClaude` caches `SHARED_CONTEXT`); if `streamClaude` does not yet cache the system block, add the same `cache_control: {type:"ephemeral"}` marker + the `prompt-caching` beta header it already uses.
- Add prompt guidance (new rule): *"You know the app's structure (see the WHERE TO DO THINGS map). When the user asks how to perform an action, or when your advice implies a change, name the exact location: Module → Tab → Section. Prefer concrete navigation over generic instructions. Never invent a tab or operation that is not in the map."*

### 2.3 Caching correctness

Because the capability map is appended to the static system block and includes auto-derived registry labels, it changes only when the registry changes (a deploy). Within a session it is constant → cache stays warm. Do **not** put it in the per-turn user payload.

---

## Testing / validation (no JS unit runner — gates per project convention)

- `node`-level smoke for the pure module: a tiny harness `src/services/AI/__validation__/capabilityMap.test.mjs` asserting `serializeCapabilityMap()` is non-empty, contains each top-level tab name, and lists at least the `Merge`/`Clean` categories from `STEP_REGISTRY`. (Pure, runnable in Node.)
- `npm run build` clean.
- Browser validation (Franco): open the coach, ask (a) "how do I drop duplicate rows?" → expect a Clean → Distinct pointer; (b) a question after pinning two models → expect the coach to reference both; (c) confirm multi-turn does not re-send the snapshot (inspect network: first turn large, later turns small).

## File checklist

- [ ] `src/services/AI/AIService.js` — `researchCoach({ snapshot })`; first-turn snapshot block; specialist snapshot line; append capability map to cached system block.
- [ ] `src/services/AI/appCapabilityMap.js` — NEW. `APP_CAPABILITY_MAP` + `serializeCapabilityMap()`.
- [ ] `src/services/AI/__validation__/capabilityMap.test.mjs` — NEW node smoke harness.
- [ ] `src/services/AI/Prompts/index.js` — `RESEARCH_COACH_PROMPT` navigation-guidance rule.
- [ ] `src/components/AIContextSidebar.jsx` — build snapshot, pass to `researchCoach`, accept new props, fix overstated copy.
- [ ] `src/components/ModelingTab.jsx` — `onSessionStateChange` callback surfacing `pinnedModels`/`subsets`/`inferenceOpts`.
- [ ] `src/App.jsx` — hold modeling session state; thread new props to both `AIContextSidebar` mounts.
- [ ] `CLAUDE.md` — add the one-line rule: "Add a tab/sub-tab → add its row to `APP_CAPABILITY_MAP`." Note the new files.

## Out of scope

- Coach taking *actions* on the user's behalf (auto-navigating, auto-adding steps) — advice only.
- Per-estimator auto-metadata infrastructure — the curated `Model` shell is sufficient for now.
- Any change to `sessionSnapshot.js` (already supports all required fields).
