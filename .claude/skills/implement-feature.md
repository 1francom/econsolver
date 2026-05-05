---
name: Implement Feature
description: Add a new feature to EconSolver following all architectural invariants. Use this skill for any task involving new functionality, wiring new components, extending existing modules, adding Phase 3 multi-model comparison features, adding data sources, or extending AI capabilities.
---

## Implement Feature — EconSolver

### Pre-flight (always run first)
1. `get_minimal_context(task="<feature description>")` — mandatory.
2. Identify which files from ClaudePlan.md this touches (6 new, 9 modified).
3. Check invariants below before writing a line.

### Architectural invariants — hard stops
- `src/math/` and `src/core/` → pure JS only. No React, no UI imports whatsoever.
- All Anthropic API calls → `AIService.js` only via `callClaude({ system, user, maxTokens })`. Never add raw `fetch` to the Anthropic API elsewhere.
- New result shape → must go through `wrapResult(type, engineOutput, spec)` in `EstimationResult.js`.
- New pipeline step → update `registry.js` AND `runner.js` in the same patch.
- Persistence → `services/persistence/indexedDB.js`. Never use localStorage for pipeline/data.
- Prompt caching → metadata (metadataReport ~200 tokens) goes in **user** message. SHARED_CONTEXT stays as cached system block. Never put variable data in system.
- Styling → inline styles via `C` object from the relevant `shared.jsx`. No external UI libraries. IBM Plex Mono (`mono` variable).

### AI service — two paths, never mix them
**Cloud AI** (`services/ai/AIService.js`):
- `callClaude({ system, user, maxTokens })` — all production AI calls.
- Models: `claude-sonnet-4-20250514` for narratives, `claude-haiku-4-5-20251001` for unit inference.
- Prompts live in `services/ai/Prompts/index.js`.

**Local AI** (`services/ai/LocalAI.js`):
- Zero-cost, zero-API, pure JS algorithms.
- Exports: `normalizeStrings`, `detectPII`, `inferMissingStrategy`, `scoreOutliers`, `suggestColumnType`.
- Use for wrangling hints, type inference, outlier flagging — never for narrative generation.
- Import directly from `services/ai/LocalAI.js`, NOT from `services/privacy/`.

### Privacy system — two layers, never mix
- `services/privacy/` (piiDetector + anonymizer + privacyFilter) → egress control before AI calls. `detectPII(headers, sampleRows)` returns `{ sensitivity, reasons }` per column.
- `LocalAI.js detectPII(rows, headers)` → returns `PIIFlag[]`. UI hints only, not egress.

### Data sources — add new fetchers to match existing pattern
Pattern from `services/data/fetchers/worldBank.js`:
- Export: `searchX(query)`, `fetchX(id, opts)`, `POPULAR_X` curated list.
- Returns `{ rows, headers, meta }` — same shape as worldBank and OECD fetchers.
- Add UI button in `DataStudio.jsx` DatasetSidebar (see `onFetchWorldBank` / `onFetchOECD` pattern).
- Add modal component in `components/wrangling/` (see `WorldBankFetcher.jsx` / `OECDFetcher.jsx`).

### ModelingTab.jsx patterns (real code)
- `estimate()` callback: lines ~990–1090. Each model is an `if/else if` branch.
- Every branch ends with `setResult(wrapResult(type, res, spec))`.
- Panel exception: FE/FD stores `{ type: "panel", fe: wrappedFE, fd: wrappedFD }` AND calls `setPanelFE` / `setPanelFD`.
- `baseReplicateConfig` (useMemo ~line 1097) feeds all ExportBar instances — add new model fields here.
- `buildModelAvail()` (~line 907) — add new model key with availability condition.
- `buildModelHint()` (~line 909) — add hint for models that require panel structure.

### Phase 3 specific (ModelBuffer + Comparison)
- `modelBuffer.js` is a module-level singleton. Import as `import * as modelBuffer from "../services/modelBuffer.js"`.
- Re-render trigger: `bufferVersion` counter in `ModelingTab.jsx` — increment on buffer mutation via `setBufferVersion(v => v + 1)`.
- `ModelComparison.jsx` calls existing `buildStargazer(models[])` from ReportingModule — already accepts arrays.
- AI comparison → `compareModels(models[], dataDictionary)` in `AIService.js`.

### DataStudio.jsx patterns
- Secondary datasets persist in sessionStorage scoped by pid: key = `"econ_studio_secondary_ds_" + pid`.
- `<WranglingModule key={activeDs.id}>` — key ensures fresh instance per dataset.
- `handleSaveSubset(name, rows, headers)` — how pipeline outputs become new datasets.
- Supported formats: CSV, TSV, XLSX, XLS, DTA (Stata via dynamic import).

### Implementation steps
1. Read only the files you'll touch + their direct imports.
2. For `ModelingTab.jsx`: locate exact branch/line, patch surgically with str_replace.
3. For new AI functionality: check `_serializeModelContext()` handles the new result type.
4. Write as `str_replace` — state file, what's removed, what's added, exact location.
5. Never rewrite a whole file.

### Token efficiency
- Read ≤ 5 files per task.
- `detail_level="minimal"` on all graph calls.
- Never read `WranglingModule.jsx` unless explicitly wrangling-related.
- Target: ≤ 8 tool calls per feature.
