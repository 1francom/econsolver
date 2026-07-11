# Report — AI Unified Script persistence, manual editing, and incremental AI update

**Date:** 2026-07-08
**Owner:** Franco Medero
**Status:** APPROVED — awaiting implementation plan
**Source:** Brainstorming session 2026-07-08. Originally framed by Franco as "save
replication scripts to Google Drive / a local directory" — narrowed during
discussion to a privacy-first, Litux-local design (see §2 D1).

---

## 1. Problem

The "AI Unified Script Export" panel in Report (`AIUnifiedScript` component,
`src/ReportingModule.jsx:756`) generates one combined R/Python/Stata
replication script from the session's pipeline + pinned models + saved
plots/maps. Today this is **entirely ephemeral and read-only**:

- `script` is plain `useState("")` (`ReportingModule.jsx:761`) — lost on
  unmount, tab switch away from Report, or page reload.
- The result `<textarea readOnly>` (`ReportingModule.jsx:1461`) cannot be
  hand-edited at all.
- Every "Generate" click rebuilds the script from scratch via
  `generateUnifiedScript()` (an expensive Opus call — replication scripts hit
  the 15-credit `maxTokens>=5000` tier per CLAUDE.md's AI service routing
  table). There is no way to say "keep what I have, just add the model I just
  pinned."

This is distinct from `src/components/modeling/CodeEditor.jsx`, the
per-model deterministic (non-AI) script viewer mounted in ModelingTab, which
is already editable-but-ephemeral — that component is **not** in scope here.

## 2. Decisions (LOCKED)

| # | Decision | Rationale |
|---|----------|-----------|
| D1 | **No cloud sync (Google Drive or otherwise), no local-directory auto-write.** Scripts persist only inside Litux's own IndexedDB, same as pinned models / spatial maps. Export out of Litux remains the existing manual "↓ Download" button. | The original ask conflicts with the privacy-first architecture: the only external cloud path today (`services/sync/`) is E2EE against Supabase, where the server never sees plaintext. A Google Drive integration would be a new, un-encrypted third-party egress path, plus OAuth/token/quota machinery — out of proportion to the actual need, which turned out to be "let me keep working on the script without losing it," not "back it up externally." |
| D2 | **Persisted per `(project pid, language)`.** R, Python, and Stata each keep their own independently-persisted script + manifest. Switching the language tab loads that language's saved state; there is no cross-language merge. | Matches the existing per-language tab structure in `AIUnifiedScript` (`lang` state) and avoids inventing a merge semantic nobody asked for. |
| D3 | **Manual edits and AI updates share one text buffer, diffed by artifact ID, not by regenerating from scratch.** Once a script exists, adding a newly-pinned model/plot/map must not re-touch or revert hand-edited sections (e.g. a manually recolored plot). | Confirmed with Franco via a concrete example (edit a plot's colors by hand, then pin a new plot — the new plot must be added, the edited one left alone). This is the core mechanic of the whole feature; see §4. |
| D4 | **Un-pinned/deleted artifacts are never silently removed from the script; they get a one-time orphan comment.** (Option C of three offered.) | Franco's choice. The script is the user's document once they've started editing it — Litux should inform, not delete. "One-time" (not repeated every Update) avoids comment spam if the user clicks Update repeatedly without addressing the orphan. |
| D5 | **Manual edits persist via an explicit "Save" action, not autosave.** Save button is visually distinct (solid background, not the app's usual outline-button style) because it is the one action that discards nothing and is safe to click often — contrast with the destructive actions below, which get the opposite treatment (confirm-gated). | Franco's choice; matches the app's existing pattern of explicit, deliberate actions over autosave (pipeline steps are all explicit), and avoids IndexedDB write spam on every keystroke. |
| D6 | **One combined "Update" action**, not separate "sync new artifacts" / "ask AI to edit" flows. A single optional instruction textbox rides along with every Update call; the artifact diff (§4) always runs regardless of whether the textbox is filled. | Franco's choice — simpler mental model ("one button that brings the script up to date, optionally with extra instructions") and one AI call instead of two. |
| D7 | **"Reset" (discard persisted script + manifest, regenerate from scratch) remains available**, gated by `ConfirmPopover` (`src/components/shared/ConfirmPopover.jsx`) since it destroys accumulated manual edits and Update history. | Consistent with the app's existing destructive-action confirmation pattern (2026-07-01 ClaudeFB batch — `ConfirmPopover` already wired to 6 other destructive actions). |

## 3. Persistence layer — `src/services/Persistence/indexedDB.js`

New object store, following the existing `model_buffer`/`spatial_maps`
pattern exactly (v9 stores, `keyPath: "pid"`) — bump to **v10**:

```js
const STORE_REPORT_SCRIPTS = "report_scripts";
// v10: report_scripts store — persisted AI Unified Script per project+language.
if (!db.objectStoreNames.contains(STORE_REPORT_SCRIPTS)) {
  db.createObjectStore(STORE_REPORT_SCRIPTS, { keyPath: "pid" });
}
```

Record shape (one record per `pid`, containing all three languages — mirrors
how `model_buffer` stores one array per pid rather than one record per
item):

```js
{
  pid,
  scripts: {
    r:     { script: "", manifest: [], lastGeneratedAt: null, lastUpdatedAt: null },
    python: { ... },
    stata:  { ... },
  },
  ts,
}
```

Each `manifest` entry: `{ kind: "model"|"plot"|"map", id, label, orphaned: boolean }`.

New exported functions, mirroring `saveModelBuffer`/`loadModelBuffer`/`deleteModelBuffer` (`indexedDB.js:655-679`) 1:1 in structure and error handling (try/catch → `console.warn` + safe fallback, `markDirtyIfPublished(pid)` on write):

- `saveReportScript(pid, lang, { script, manifest })` — reads the existing record (if any), replaces only the `scripts[lang]` entry, writes back. Stamps `lastGeneratedAt` or `lastUpdatedAt` depending on a `kind: "generate"|"update"|"manual"` argument (manual save touches neither timestamp field beyond storage `ts`, generate stamps `lastGeneratedAt`, update stamps `lastUpdatedAt`).
- `loadReportScript(pid, lang)` — returns `scripts[lang]` or `null`.
- `deleteReportScripts(pid)` — deletes the whole per-project record. Called from `deleteProject()` (`indexedDB.js:542-549`), added alongside the existing `deleteModelBuffer`/`deleteSpatialMaps` calls.

## 4. Artifact ID marking + diff

**Marking.** Every section the script-builder emits for a trackable artifact
gets an ID comment on its own line immediately above the code block:

```
# ── Model: DiD (comuna FE) [artifact:model:m_a1b2c3] ──
# Plot: ventas_2024 [artifact:plot:p_9f8e]
# Map: heatmap_barrios [artifact:map:mp_1122]
```

- Plots/maps already have a stable id via `makeArtifactId(type, id)`
  (`services/Persistence/artifactOrder.js:11`) — reuse it verbatim, this is
  the existing convention `AIUnifiedScript`'s deterministic
  `orderedVisualCode` block (`ReportingModule.jsx:1184-1200`) already
  produces internally; it just isn't currently rendered into a parseable
  comment.
- Pinned models don't yet have an equivalent stable, script-visible id — add
  one at the point the AI model section is composed, using the pinned
  model's existing `EstimationResult.id` (already present per
  `EstimationResult.js` — every wrapped result carries `id`), formatted as
  `artifact:model:<id>`.

**Diff**, a new pure function (`src/services/export/scriptArtifactDiff.js`):

```js
diffArtifacts(manifest, currentArtifacts) → { newItems, orphanedItems }
```

- `currentArtifacts` is assembled the same way `AIUnifiedScript` already
  enumerates the session's live state for generation: `pinnedModels` (+
  active model if `replicateMode === "all"`), `savedPlots`, `savedMaps`
  (the exact aggregation already at `ReportingModule.jsx:1179-1186`, reused
  as-is — this spec does not change how "what's in the session" is computed,
  only what's done with it).
- `newItems` = current artifacts whose id is not in `manifest` (or is in
  `manifest` but was previously `orphaned: true` and has reappeared — treat
  as new again, clear the orphan flag).
- `orphanedItems` = manifest entries whose id is not in `currentArtifacts`
  and are not already flagged `orphaned: true` (so a second Update run
  doesn't re-report the same orphan).

## 5. AI service — `src/services/AI/AIService.js`

New export `updateUnifiedScript(currentScript, { newSections, orphanedItems, userInstruction, language, snapshot })`, sibling to `generateUnifiedScript` (`AIService.js:1217`), same Opus routing tier (this is a replication-script call, same cost class as Generate — worth surfacing in the UI per §6 so Update isn't clicked as casually as a free action).

Prompt (`UPDATE_UNIFIED_SCRIPT_PROMPT`, new constant in `services/AI/Prompts/index.js`, sibling to `UNIFIED_SCRIPT_PROMPT`): given the **full current script text verbatim** (including any manual edits), a list of new artifact code blocks to incorporate (already-translated deterministic plot/map code + AI-composed model sections, built the same way Generate already builds them — no new translation logic, just routed differently), a list of orphaned artifact labels/ids to annotate in place with a `# ⚠ orphaned` comment, and the optional freeform instruction — return the **complete revised script**. Explicit prompt rules:
- Do not rewrite, reformat, or re-derive any section not called out as new or orphaned.
- Insert new sections in a sensible position (same section grouping the rest of the script already uses — Setup/Data/Clean/Estimation/etc. — matching whatever structure is already visibly present in the input script).
- Preserve the artifact-ID comment convention (§4) on every new section so future Updates can track it too.

## 6. UI — `src/ReportingModule.jsx` (`AIUnifiedScript` component)

- Load persisted state on mount / language switch via `loadReportScript(pid, lang)`; populate `script` + a new `manifest` state instead of starting blank, when a record exists.
- Textarea (`ReportingModule.jsx:1461`) loses `readOnly`; bind to a local `draftScript` state seeded from `script` on load/generate/update, so typing doesn't fight async writes.
- **Generate** (existing button) — unchanged trigger, but on success also persists `{script, manifest: <all current artifacts, orphaned:false>}` via `saveReportScript(..., kind: "generate")`.
- **Update** (new button, next to Generate) — disabled/hidden until a persisted script exists for the active `pid+lang`. On click: runs `diffArtifacts`, builds the new-artifact code blocks, calls `updateUnifiedScript(draftScript, {...})` (operates on **whatever is currently in the textarea**, saved or not — so an in-progress hand edit is included in what Claude sees without forcing a Save first), on success updates `draftScript`/`script` and persists `{script, manifest: <merged manifest with new items added + orphans flagged>}` via `saveReportScript(..., kind: "update")`. Small caption under the button shows credit-cost context, matching the Generate panel's existing framing.
- **Instruction textbox** — new small input next to the Update button (placeholder e.g. `"optional: also do X..."`), cleared after a successful Update.
- **Save** (new button) — visible once the textarea has been edited (`draftScript !== script`). Solid teal background (`background: C.teal, color: "#080808"` or equivalent per the `C` palette — the one filled button in a panel otherwise built from outline buttons, per D5). Persists `draftScript` verbatim via `saveReportScript(..., kind: "manual")`, manifest unchanged.
- **Reset** (new button, only shown once a persisted script exists) — wrapped in the app's `ConfirmPopover` pattern (mirrors the 2026-07-01 destructive-action rollout): confirm message along the lines of "Discard the saved script and all edits? This can't be undone." On confirm: `deleteReportScripts`-equivalent for just this `(pid, lang)` (call `saveReportScript(pid, lang, {script:"", manifest:[]})` to clear rather than deleting the whole per-project record, since other languages' saved scripts must survive), clear local state, and the panel returns to its pre-first-generation state.

## 7. Non-goals

- No Google Drive, no local-directory File System Access API integration (§2 D1).
- No autosave (§2 D5).
- No automatic/background polling for new artifacts while Report is open — the diff only runs when the user clicks Update.
- No version history / multiple saved revisions — one persisted script per `(pid, lang)`, overwritten in place. (Reset is the only "undo," and it's total, not selective.)
- `CodeEditor.jsx` (ModelingTab's per-model deterministic script viewer) is untouched — out of scope.
- No changes to how the deterministic Explore/Spatial/Plots/Maps sections are translated (`buildGgplot`, `buildLeafletR`, etc.) — this spec only changes when/how those blocks get assembled into the persisted whole, not how each block is generated.

## 8. Acceptance

- `npm run build` and `npm run lint:undef` green.
- Manual browser check (via `preview_*`): Generate a script, close and reopen the project (or just navigate away from Report and back) — script is still there.
- Hand-edit the textarea, click Save, reload the project — edit persisted.
- Hand-edit a plot's color code inside the script, pin a new plot, click Update with no instruction text — new plot's section appears with its artifact-ID comment; the hand-edited plot section is byte-for-byte untouched.
- Unpin a model that's referenced in the saved script, click Update — model's section remains, gets a one-line orphan comment; clicking Update again does not duplicate that comment.
- Switch language tabs (R → Python) — each shows its own independently-saved script, not a shared one.
- Reset shows a `ConfirmPopover`, cancel leaves the script untouched, confirm clears it back to the pre-Generate empty state.
