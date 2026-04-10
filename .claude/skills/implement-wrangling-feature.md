---
name: Implement Wrangling Feature
description: Add new features to the data wrangling/cleaning pipeline in EconSolver. Use this skill when adding a new cleaning operation, a new feature engineering transform, a new reshape or merge option, extending the AI Actions dropdown, adding a new export format, or wiring anything in CleanTab, FeatureTab, ReshapeTab, MergeTab, DictionaryTab, or ExportMenu. Also use when a wrangling change must propagate to ModelingTab via the onComplete() shape.
---

## Implement Wrangling Feature — EconSolver

### Architecture: where things live

```
WranglingModule.jsx          ← ROOT ORCHESTRATOR — ~110 lines, owns all pipeline state
                               DO NOT add logic here. Add in the tab files.
components/wrangling/
├── CleanTab.jsx             ← normalize, filter, fill_na, type_cast, recode, quickclean
├── FeatureTab.jsx           ← log, sq, std, dummy, lag, lead, diff, mutate, interactions
├── ReshapeTab.jsx           ← arrange, group_summarize, pivot_longer
├── MergeTab.jsx             ← join (LEFT/INNER), append
├── DictionaryTab.jsx        ← AI inference + manual edit of column descriptions
├── ExportMenu.jsx           ← CSV + pipeline.json downloads (grows here for new formats)
├── DataQualityReport.jsx    ← quality flags + apply-step shortcuts
├── History.jsx              ← undo/redo sidebar (reads pipeline[])
└── shared.jsx               ← C, mono, Lbl, Tabs, Btn, Badge, NA, Spin, Grid
pipeline/
├── runner.js                ← applyStep() + runPipeline() — 23 step types
└── registry.js              ← STEP_REGISTRY — must stay in sync with runner.js
```

### The single most important rule
**Adding a new step type requires editing BOTH `runner.js` AND `registry.js` in the same patch.**
- `registry.js`: add to STEP_REGISTRY `{ type, label, desc }`.
- `runner.js`: add case to `applyStep()` switch.
Failure to sync these causes silent pipeline failure (step appears in History but does nothing).

### How a tab adds a step — the real pattern

Every tab receives `onAdd` prop from WranglingModule. Call it with a step object:
```js
// From CleanTab.jsx:
onAdd({ type: "recode", col: selCol, map: finalMap,
        desc: `Normalize '${selCol}': ${summary}` });

// From FeatureTab.jsx:
onAdd({ type: "mutate", nn: name, expr: expr, desc: `${name} = ${expr}` });

// From CleanTab filter:
onAdd({ type: "filter", conditions: [...], logic: "AND",
        desc: `Filter: ${condStr}` });
```
`addStep()` in WranglingModule auto-adds `id: Date.now() + Math.random()` — don't add it yourself.

### Tab-specific props (from WranglingModule render)
```
CleanTab:     { rows, headers, info, rawData, onAdd }
FeatureTab:   { rows, headers, panel, info, onAdd }
ReshapeTab:   { rows, headers, info, onAdd, onRmLastStep, onSaveSubset, filename }
MergeTab:     { rows, headers, filename, allDatasets, onAdd }
DictionaryTab:{ headers, rows, dict, setDict }
DataQualityReport: { report, onApplyStep, onExportMd }
```
`info` = `buildInfo(headers, rows)` from `pipeline/validator.js` — per-column stats (isNum, isCat, naPct, uCount, uVals, mean, std, etc.)

### Adding a new tab
1. Create `components/wrangling/NewTab.jsx` with props appropriate to its function.
2. Add import in `WranglingModule.jsx`.
3. Add to `Tabs` array (~line 383): `["newtab", "⊕ New Tab"]`.
4. Add render block: `{tab === "newtab" && <NewTab rows={rows} headers={headers} info={info} onAdd={addStep}/>}`.
5. Style with `C, mono` from `./shared.jsx`.

### Adding an item to AI Actions dropdown
Location: `WranglingModule.jsx` ~line 264 — the `aiActionsOpen` dropdown.
Pattern: each item calls `setAiActionsOpen(false)` then `setTab("targetTab")`.
For new AI actions that don't just navigate: add a handler in WranglingModule and pass it as prop to the relevant tab.

### Adding an export format (ExportMenu.jsx)
Add to the `menuItems` array:
```js
{ icon: "↓", label: "Download Stata .do", hint: "Replication script",
  action: downloadStata }
```
Add the `downloadStata` function above — use the `downloadCSV` / `downloadPipeline` functions as pattern.

### How wrangling output flows to ModelingTab

`proceed()` in WranglingModule (~line 187) calls `onComplete()` with this shape:
```js
onComplete({
  headers,
  cleanRows: rows,
  colInfo: { [col]: { isNumeric: boolean } },
  issues: [],
  removed: naCount,
  dataDictionary: dataDictionary || {},
  panelIndex: panel
    ? { entityCol, timeCol, balance, blockFE }
    : null,
  changeLog: pipeline.map(s => ({
    type: s.type, description: s.desc,
    col: s.col || s.c1 || s.nn || "",
    map: s.map || null,
  })),
})
```

**If you add new pipeline state that ModelingTab needs to consume:**
1. Add the field to `onComplete()` payload in `proceed()`.
2. ModelingTab reads it from `cleanedData` prop. Update `baseReplicateConfig` useMemo if it's relevant for replication scripts.
3. If it's needed for AI context: add to `buildMetadataContext()` in `services/ai/Prompts/index.js`.

**If you add a new column type or metadata:**
- `buildInfo()` in `pipeline/validator.js` is what populates `info`. Add new per-column stats there.
- `metadataExtractor.js` (`buildMetadataReport`) runs on the final `cleanedData.cleanRows` — add new computed fields there if ModelingTab's coaching signals need them.

### DictionaryTab — AI inference pattern
`inferVariableUnits(headers, rows.slice(0, 3))` from `callAI` in `utils.js` via `AIService.js`.
Returns `Record<string, string>` — column → description string.
Descriptions prefixed `"dummy"` and `"log of"` get special accent colors in the table.
The dict is stored in WranglingModule state and persisted to IndexedDB with the pipeline.

### Undo/redo
Any step added via `addStep(s)` is automatically undoable (WranglingModule takes a snapshot before every mutation). No action needed in the tab.
`onRmLastStep` prop (ReshapeTab only) — directly removes the last pipeline step without undo confirmation.

### Token efficiency
- New cleaning operation → read only `CleanTab.jsx` + `runner.js`.
- New transform → read only `FeatureTab.jsx` + `runner.js`.
- New export format → read only `ExportMenu.jsx`.
- Never read `WranglingModule.jsx` fully — check only the relevant section (proceed(), tab render, or AI actions dropdown).
- `registry.js` is short — always read it fully when touching runner.js.
- Target: ≤ 5 tool calls for a new step type end-to-end.
