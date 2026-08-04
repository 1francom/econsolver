# Floating Panels Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Turn `DistinctValuesPanel`'s floating/non-modal pattern into a reusable shell, and ship an app-scoped Artifact Viewer that shows saved plots, maps and models in the project's existing artifact order while you work in any tab.

**Architecture:** A pure slot-math module (`panelStackMath.js`) computes bottom offsets; a React context at App level owns the registry and hands offsets back; `<FloatingPanel>` is a dumb frame. **Scope is the mount point, not a prop** — module-scoped panels mount inside their module (inheriting its `display:none`), app-scoped panels mount in a single App-level `PanelHost`. Panels declare which tab owns them so the provider — which already knows `panes` — decides visibility without prop threading.

**Tech Stack:** React 18 (no UI libraries), inline styles via the `C`/`T` theme objects, `node:assert/strict` harnesses run under plain node.

**Spec:** `docs/superpowers/specs/2026-08-03-floating-panels-design.md`

---

## File Structure

| File | Responsibility |
|---|---|
| `src/components/panels/panelStackMath.js` *(create)* | Pure offset math. No React, so a node harness can exercise it. |
| `src/components/panels/__validation__/panelStackValidation.mjs` *(create)* | The one new-logic harness. |
| `src/components/panels/PanelStack.jsx` *(create)* | `PanelStackProvider` + `usePanelSlot`. Registry only. |
| `src/components/panels/FloatingPanel.jsx` *(create)* | Presentational frame: title bar, minimize, close, positioning. |
| `src/components/panels/PanelHost.jsx` *(create)* | App-level mount point for app-scoped panels. |
| `src/components/panels/ArtifactViewerPanel.jsx` *(create)* | The new consumer: ordered artifact list + ◀ ▶ + `PlotCanvas` render. |
| `src/components/PlotBuilder.jsx` *(modify)* | Export the already-existing `PlotCanvas`. One-line change. |
| `src/components/wrangling/DistinctValuesPanel.jsx` *(modify)* | Drop its own frame; render inside `FloatingPanel`. |
| `src/App.jsx` *(modify)* | Wrap in `PanelStackProvider`, mount `PanelHost`, add the toggle button. |
| `src/ExplorerModule.jsx`, `src/components/ModelingTab.jsx` *(modify)* | HintBox copy. |
| `src/services/AI/appCapabilityMap.js` *(modify)* | One row so the coach knows the panel exists. |

**Scoped v1 decision, made here rather than deferred:** the viewer *renders* plots (via `PlotCanvas`, which already accepts exactly the fields a saved entry carries). Maps and models appear in the same ordered list but show a summary card with an "open in its tab" action instead of a live render — `MapCanvas` drives a Leaflet instance whose lifecycle in a resizing panel is its own hazard, and model results already have a dedicated comparison surface. This is a deliberate v1 boundary, not an oversight.

---

### Task 1: Slot math

**Files:**
- Create: `src/components/panels/panelStackMath.js`
- Test: `src/components/panels/__validation__/panelStackValidation.mjs`

- [ ] **Step 1: Write the failing test**

Create `src/components/panels/__validation__/panelStackValidation.mjs`:

```js
import assert from "node:assert/strict";
import { computeSlots, PANEL_MARGIN, PANEL_GAP } from "../panelStackMath.js";

// Nothing registered.
assert.equal(computeSlots([], ["clean"]).size, 0);

// A single app-scoped panel (tab === null) sits at the margin, whatever is on screen.
assert.equal(computeSlots([{ id: "a", height: 100, tab: null }], []).get("a"), PANEL_MARGIN);

// Two visible panels stack upward in registration order.
const two = computeSlots([
  { id: "a", height: 100, tab: null },
  { id: "b", height: 200, tab: null },
], []);
assert.equal(two.get("a"), PANEL_MARGIN);
assert.equal(two.get("b"), PANEL_MARGIN + 100 + PANEL_GAP);

// THE REGRESSION THIS FILE EXISTS FOR: a module panel whose tab is off screen is
// still mounted and still registered (App hides tab panels with display:none
// rather than unmounting them), so it must consume NO vertical space. If it did,
// the artifact viewer would float above an invisible gap.
const hidden = computeSlots([
  { id: "distinct",  height: 360, tab: "clean" },
  { id: "artifacts", height: 400, tab: null },
], ["model"]);
assert.equal(hidden.get("distinct"),  null);
assert.equal(hidden.get("artifacts"), PANEL_MARGIN);

// Same registration, clean now on screen → the module panel takes the bottom slot.
const shown = computeSlots([
  { id: "distinct",  height: 360, tab: "clean" },
  { id: "artifacts", height: 400, tab: null },
], ["clean"]);
assert.equal(shown.get("distinct"),  PANEL_MARGIN);
assert.equal(shown.get("artifacts"), PANEL_MARGIN + 360 + PANEL_GAP);

// Split view: App can show two panes at once, so membership — not equality — decides.
assert.equal(
  computeSlots([{ id: "distinct", height: 360, tab: "clean" }], ["model", "clean"]).get("distinct"),
  PANEL_MARGIN
);

// Defensive: null/undefined panel list must not throw.
assert.equal(computeSlots(undefined, []).size, 0);

console.log("panelStackMath OK");
```

- [ ] **Step 2: Run the test to verify it fails**

```bash
node src/components/panels/__validation__/panelStackValidation.mjs
```

Expected: `ERR_MODULE_NOT_FOUND` — `panelStackMath.js` does not exist yet.

- [ ] **Step 3: Write the implementation**

Create `src/components/panels/panelStackMath.js`:

```js
// ─── ECON STUDIO · components/panels/panelStackMath.js ────────────────────────
// Pure slot math for the floating-panel stack. Deliberately free of React so a
// node harness can exercise it — the component layer only registers panels and
// reads offsets back.

export const PANEL_MARGIN = 16; // gap from the viewport's bottom/right edge
export const PANEL_GAP    = 8;  // gap between two stacked panels

/**
 * @param {{id: string, height: number, tab: string|null}[]} panels
 *        Registration order. `tab` is the workspace tab that owns the panel, or
 *        null for an app-scoped panel that is always on screen.
 * @param {string[]} panes  Tabs currently rendered (App shows up to two).
 * @returns {Map<string, number|null>} id → bottom offset in px, null when hidden.
 */
export function computeSlots(panels, panes = []) {
  const slots = new Map();
  let bottom = PANEL_MARGIN;
  for (const p of panels ?? []) {
    const visible = p.tab == null || panes.includes(p.tab);
    if (!visible) { slots.set(p.id, null); continue; }
    slots.set(p.id, bottom);
    bottom += p.height + PANEL_GAP;
  }
  return slots;
}
```

- [ ] **Step 4: Run the test to verify it passes**

```bash
node src/components/panels/__validation__/panelStackValidation.mjs
```

Expected: `panelStackMath OK`

- [ ] **Step 5: Commit**

```bash
git add src/components/panels/panelStackMath.js src/components/panels/__validation__/panelStackValidation.mjs
git commit -m "feat(panels): pure slot math for the floating-panel stack"
```

---

### Task 2: Stack context

**Files:**
- Create: `src/components/panels/PanelStack.jsx`

- [ ] **Step 1: Write the provider and hook**

Create `src/components/panels/PanelStack.jsx`:

```jsx
// ─── ECON STUDIO · components/panels/PanelStack.jsx ───────────────────────────
// Registry for floating panels. Panels live in different React trees (one inside
// WranglingModule, one at App level), so they cannot coordinate through layout —
// this context is the only place that knows about all of them at once.

import { createContext, useContext, useState, useCallback, useMemo, useEffect } from "react";
import { computeSlots, PANEL_MARGIN } from "./panelStackMath.js";

const PanelStackContext = createContext(null);

/**
 * @param panes  App's current pane array (e.g. ["clean", null] or ["model","clean"]).
 *               The provider decides panel visibility from this, so no component
 *               has to thread an `active` boolean down through the tree.
 */
export function PanelStackProvider({ panes = [], children }) {
  const [panels, setPanels] = useState([]); // registration order

  const register = useCallback((id, height, tab) => {
    setPanels(prev => {
      const i = prev.findIndex(p => p.id === id);
      if (i === -1) return [...prev, { id, height, tab }];
      // Bail out when nothing changed — this runs on every panel render and an
      // unconditional setState would loop.
      if (prev[i].height === height && prev[i].tab === tab) return prev;
      const next = prev.slice();
      next[i] = { id, height, tab };
      return next;
    });
  }, []);

  const unregister = useCallback((id) => {
    setPanels(prev => prev.filter(p => p.id !== id));
  }, []);

  const slots = useMemo(() => computeSlots(panels, panes), [panels, panes]);
  const value = useMemo(() => ({ register, unregister, slots }), [register, unregister, slots]);

  return <PanelStackContext.Provider value={value}>{children}</PanelStackContext.Provider>;
}

/**
 * Register a panel and read back its bottom offset in px.
 * Returns PANEL_MARGIN when the panel is hidden or the provider is absent — in
 * both cases the value is unobservable, so the fallback is arbitrary but safe.
 */
export function usePanelSlot(id, height, tab = null) {
  const ctx = useContext(PanelStackContext);
  const { register, unregister } = ctx ?? {};
  useEffect(() => {
    if (!register) return;
    register(id, height, tab);
    return () => unregister(id);
  }, [register, unregister, id, height, tab]);
  return ctx?.slots.get(id) ?? PANEL_MARGIN;
}
```

- [ ] **Step 2: Verify the build compiles**

```bash
npm run build
```

Expected: build succeeds. Nothing imports this file yet, so no behaviour changes.

- [ ] **Step 3: Commit**

```bash
git add src/components/panels/PanelStack.jsx
git commit -m "feat(panels): PanelStackProvider and usePanelSlot"
```

---

### Task 3: The shell

**Files:**
- Create: `src/components/panels/FloatingPanel.jsx`

- [ ] **Step 1: Write the component**

Create `src/components/panels/FloatingPanel.jsx`. The frame is lifted verbatim from
`DistinctValuesPanel.jsx` (which Task 4 then empties out) so the visual result is
unchanged:

```jsx
// ─── ECON STUDIO · components/panels/FloatingPanel.jsx ────────────────────────
// Floating, non-modal, minimizable frame. Unlike AuditTrail.jsx's full-screen
// dimmed overlay this does NOT block the rest of the UI — it stays visible as a
// reference while the user keeps working elsewhere.
//
// Presentational only: it does not know what it displays or where it is mounted.
// Scope is decided by the MOUNT POINT — a panel rendered inside a module inherits
// that module's display:none and hides when the user leaves; a panel rendered in
// PanelHost is app-level and always on screen.

import { useTheme } from "../../ThemeContext.jsx";
import { usePanelSlot, PanelStackProvider } from "./PanelStack.jsx"; // eslint-disable-line no-unused-vars
import { PANEL_MARGIN } from "./panelStackMath.js";

const TITLE_BAR_HEIGHT = 30;

/**
 * @param id        stable id used by the stack registry
 * @param tab       workspace tab that owns this panel, or null for app-scoped
 * @param title     left-hand label in the title bar
 * @param meta      optional right-hand muted label (counts, position, …)
 * @param width     px, default 320
 * @param bodyHeight  px of scrollable body when expanded, default 320
 */
export default function FloatingPanel({
  id, tab = null, title, meta = null,
  width = 320, bodyHeight = 320,
  minimized, onToggleMinimize, onClose, children,
}) {
  const { C, T } = useTheme();
  const height = minimized ? TITLE_BAR_HEIGHT : TITLE_BAR_HEIGHT + bodyHeight;
  // Never null: usePanelSlot already collapses the hidden case to PANEL_MARGIN.
  const bottom = usePanelSlot(id, height, tab);

  return (
    <div style={{
      position: "fixed", bottom, right: PANEL_MARGIN, zIndex: 900,
      width, maxWidth: `calc(100vw - ${PANEL_MARGIN * 2}px)`,
      background: C.bg, border: `1px solid ${C.border2}`, borderRadius: 5,
      boxShadow: "0 8px 28px #000a", overflow: "hidden",
      fontFamily: T.code.fontFamily,
    }}>
      <div style={{
        display: "flex", alignItems: "center", gap: 8,
        padding: "0.5rem 0.7rem", background: C.surface,
        borderBottom: minimized ? "none" : `1px solid ${C.border}`,
        cursor: "default",
      }}>
        <span style={{
          fontSize: T.caption.fontSize, color: C.teal, letterSpacing: "0.1em",
          textTransform: "uppercase", flex: 1,
          overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap",
        }}>{title}</span>
        {meta && (
          <span style={{ fontSize: T.caption.fontSize, color: C.textMuted }}>{meta}</span>
        )}
        <button onClick={onToggleMinimize} title={minimized ? "Expand" : "Minimize"}
          style={{ background: "none", border: "none", color: C.textDim, cursor: "pointer", fontSize: 13, padding: "0 4px" }}>
          {minimized ? "▢" : "—"}
        </button>
        <button onClick={onClose} title="Close"
          style={{ background: "none", border: "none", color: C.textDim, cursor: "pointer", fontSize: 13, padding: "0 4px" }}>
          ✕
        </button>
      </div>
      {!minimized && (
        <div style={{ maxHeight: bodyHeight, overflowY: "auto" }}>{children}</div>
      )}
    </div>
  );
}
```

- [ ] **Step 2: Remove the unused import**

Delete the `PanelStackProvider` import line added above — it was included only to
show the module relationship and ESLint will flag it:

```jsx
import { usePanelSlot } from "./PanelStack.jsx";
```

- [ ] **Step 3: Verify the build and the undefined-symbol gate**

```bash
npm run build && npm run lint:undef
```

Expected: both succeed.

- [ ] **Step 4: Commit**

```bash
git add src/components/panels/FloatingPanel.jsx
git commit -m "feat(panels): FloatingPanel presentational shell"
```

---

### Task 4: Migrate DistinctValuesPanel

**Files:**
- Modify: `src/components/wrangling/DistinctValuesPanel.jsx:51-109`

- [ ] **Step 1: Replace the frame with `FloatingPanel`**

In `src/components/wrangling/DistinctValuesPanel.jsx`, replace everything from
`const titleBarStyle = {` (line 51) through the final `);` of the component with:

```jsx
  return (
    <FloatingPanel
      id="distinct-values"
      tab="clean"
      title={col}
      meta={!loading && !error && data
        ? (data.total > data.values.length ? `top ${data.values.length} of ${data.total}` : `${data.total} distinct`)
        : null}
      minimized={minimized}
      onToggleMinimize={onToggleMinimize}
      onClose={onClose}
    >
      <div style={{ padding: "0.4rem 0" }}>
        {loading && (
          <div style={{ padding: "0.7rem", fontSize: T.caption.fontSize, color: C.textMuted }}>Computing…</div>
        )}
        {error && (
          <div style={{ padding: "0.7rem", fontSize: T.caption.fontSize, color: C.red }}>{error}</div>
        )}
        {!loading && !error && data && data.values.length === 0 && (
          <div style={{ padding: "0.7rem", fontSize: T.caption.fontSize, color: C.textMuted }}>No non-null values.</div>
        )}
        {!loading && !error && data && data.values.map((v, i) => (
          <div key={i} style={{
            display: "flex", justifyContent: "space-between", gap: 10,
            padding: "0.3rem 0.7rem", fontSize: T.caption.fontSize,
            color: C.text, borderBottom: i < data.values.length - 1 ? `1px solid ${C.border}` : "none",
          }}>
            <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{String(v.value)}</span>
            <span style={{ color: C.textMuted, flexShrink: 0 }}>{v.count}</span>
          </div>
        ))}
      </div>
    </FloatingPanel>
  );
}
```

- [ ] **Step 2: Add the import**

At the top of the same file, after the `useTheme` import:

```jsx
import FloatingPanel from "../panels/FloatingPanel.jsx";
```

- [ ] **Step 3: Verify**

```bash
npm run build && npm run lint:undef
```

Expected: both succeed. `tab="clean"` is what makes the panel release its stack
slot when the user is not in Clean — the panel itself is unchanged in behaviour
because `WranglingModule`'s `display:none` still hides it.

- [ ] **Step 4: Commit**

```bash
git add src/components/wrangling/DistinctValuesPanel.jsx
git commit -m "refactor(panels): DistinctValuesPanel renders inside FloatingPanel"
```

---

### Task 5: Export `PlotCanvas`

**Files:**
- Modify: `src/components/PlotBuilder.jsx:593`

`PlotCanvas` already accepts exactly the fields a saved plot entry carries
(`layers, rows, xLabel, yLabel, title, scheme, xScale, yScale, xDomain, yDomain,
xFmt, yFmt, xCatOrder, yCatOrder, facetCol, facetCols`) — compare
`currentPlotEntry()` at `PlotBuilder.jsx:1643-1649`. It is private only by
accident, so this is a one-word change and no new rendering path is needed.

- [ ] **Step 1: Make it exported**

Change line 593 from:

```jsx
function PlotCanvas({ layers, rows, xLabel, yLabel, title, width, height, scheme, canvasRef, showSE = true,
```

to:

```jsx
export function PlotCanvas({ layers, rows, xLabel, yLabel, title, width, height, scheme, canvasRef, showSE = true,
```

- [ ] **Step 2: Verify**

```bash
npm run build && npm run lint:undef
```

Expected: both succeed. `PlotBuilder`'s own default export is untouched.

- [ ] **Step 3: Commit**

```bash
git add src/components/PlotBuilder.jsx
git commit -m "refactor(plot): export PlotCanvas for reuse outside the builder"
```

---

### Task 6: Artifact Viewer

**Files:**
- Create: `src/components/panels/ArtifactViewerPanel.jsx`

- [ ] **Step 1: Write the component**

Create `src/components/panels/ArtifactViewerPanel.jsx`:

```jsx
// ─── ECON STUDIO · components/panels/ArtifactViewerPanel.jsx ──────────────────
// App-scoped floating viewer over the project's saved artifacts, navigated with
// ◀ ▶ in the SAME order artifactOrder.js persists — which is also the order the
// replication bundle emits, so what the user sees and what they export cannot
// drift apart.
//
// v1 renders PLOTS live (PlotCanvas takes exactly the fields a saved entry
// carries). Maps and models appear in the same ordered list as summary cards
// with an "open" action: MapCanvas drives a Leaflet instance whose lifecycle in
// a resizing panel is its own hazard, and model results already have a dedicated
// comparison surface.

import { useState, useEffect, useMemo } from "react";
import { useTheme } from "../../ThemeContext.jsx";
import FloatingPanel from "./FloatingPanel.jsx";
import { PlotCanvas } from "../PlotBuilder.jsx";
import { getPlotHistory, getMapHistory } from "../../services/Persistence/plotHistory.js";
import { getArtifactOrder, makeArtifactId, orderArtifacts } from "../../services/Persistence/artifactOrder.js";

const PANEL_WIDTH = 460;
const BODY_HEIGHT = 360;

/**
 * @param pid       project id — artifact history and order are project-scoped
 * @param datasets  [{ id, rows, headers, filename }] from App's availableDatasets;
 *                  a saved plot stores only `datasetId`, so its rows are resolved here
 * @param onOpen    (artifact) => void — navigate to the artifact's home tab
 * @param onClose   () => void
 */
export default function ArtifactViewerPanel({ pid, datasets = [], onOpen, onClose }) {
  const { C, T } = useTheme();
  const [artifacts, setArtifacts] = useState([]);
  const [idx,       setIdx]       = useState(0);
  const [minimized, setMinimized] = useState(false);

  useEffect(() => {
    if (!pid) return;
    let cancelled = false;
    (async () => {
      const [plots, maps, order] = await Promise.all([
        getPlotHistory(pid).catch(() => []),
        getMapHistory(pid).catch(() => []),
        getArtifactOrder(pid).catch(() => []),
      ]);
      const items = [
        ...plots.map(e => ({ kind: "plot", artifactId: makeArtifactId("plot", e.id), savedAt: e.savedAt ?? 0, entry: e })),
        ...maps.map(e  => ({ kind: "map",  artifactId: makeArtifactId("map",  e.id), savedAt: e.savedAt ?? 0, entry: e })),
      ];
      if (!cancelled) setArtifacts(orderArtifacts(items, order));
    })();
    return () => { cancelled = true; };
  }, [pid]);

  // Clamp when the collection shrinks (an artifact deleted in another tab).
  useEffect(() => {
    setIdx(i => (artifacts.length === 0 ? 0 : Math.min(i, artifacts.length - 1)));
  }, [artifacts.length]);

  const current = artifacts[idx] ?? null;
  const ds = useMemo(
    () => datasets.find(d => d.id === (current?.entry?.datasetId ?? current?.entry?._srcId)) ?? null,
    [datasets, current]
  );

  const navBtn = (label, disabled, onClick) => (
    <button onClick={onClick} disabled={disabled} title={label === "◀" ? "Previous" : "Next"}
      style={{
        background: "none", border: `1px solid ${disabled ? C.border : C.border2}`, borderRadius: 3,
        color: disabled ? C.border2 : C.textDim, cursor: disabled ? "default" : "pointer",
        fontSize: T.caption.fontSize, padding: "1px 7px",
      }}>{label}</button>
  );

  return (
    <FloatingPanel
      id="artifact-viewer"
      tab={null}
      title="Artifacts"
      meta={artifacts.length ? `${idx + 1} / ${artifacts.length}` : null}
      width={PANEL_WIDTH}
      bodyHeight={BODY_HEIGHT}
      minimized={minimized}
      onToggleMinimize={() => setMinimized(m => !m)}
      onClose={onClose}
    >
      <div style={{ padding: "0.5rem 0.7rem" }}>
        {artifacts.length === 0 && (
          <div style={{ fontSize: T.caption.fontSize, color: C.textMuted }}>
            No saved plots or maps in this project yet.
          </div>
        )}

        {current && (
          <>
            <div style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: 8 }}>
              {navBtn("◀", idx === 0, () => setIdx(i => Math.max(0, i - 1)))}
              {navBtn("▶", idx >= artifacts.length - 1, () => setIdx(i => Math.min(artifacts.length - 1, i + 1)))}
              <span style={{
                flex: 1, fontSize: T.caption.fontSize, color: C.text,
                overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap",
              }}>
                {current.entry.name ?? current.kind}
              </span>
              <button onClick={() => onOpen?.(current)}
                style={{
                  background: "transparent", border: `1px solid ${C.border2}`, borderRadius: 3,
                  color: C.textDim, cursor: "pointer", fontSize: T.caption.fontSize, padding: "1px 8px",
                }}>open</button>
            </div>

            {current.kind === "plot" && ds && (
              <PlotCanvas
                layers={current.entry.layers ?? []}
                rows={ds.rows ?? []}
                title={current.entry.title || ""}
                xLabel={current.entry.xLabel || ""}
                yLabel={current.entry.yLabel || ""}
                scheme={current.entry.scheme || ""}
                xScale={current.entry.xScale || "linear"}
                yScale={current.entry.yScale || "linear"}
                xDomain={current.entry.xDomain || [null, null]}
                yDomain={current.entry.yDomain || [null, null]}
                xFmt={current.entry.xFmt || ""}
                yFmt={current.entry.yFmt || ""}
                xCatOrder={current.entry.xCatOrder || ""}
                yCatOrder={current.entry.yCatOrder || ""}
                facetCol={current.entry.facetCol || ""}
                facetCols={current.entry.facetCols || 3}
                width={PANEL_WIDTH - 24}
                height={BODY_HEIGHT - 70}
              />
            )}

            {current.kind === "plot" && !ds && (
              <div style={{ fontSize: T.caption.fontSize, color: C.textMuted }}>
                Source dataset “{current.entry.datasetName ?? current.entry.datasetId ?? "unknown"}” is not
                loaded in this session — load it from the Data tab to see this plot.
              </div>
            )}

            {current.kind === "map" && (
              <div style={{
                border: `1px solid ${C.border}`, borderRadius: 4, padding: "0.7rem",
                fontSize: T.caption.fontSize, color: C.textMuted,
              }}>
                Map · {(current.entry.layers ?? []).length} layer(s).
                Use <span style={{ color: C.textDim }}>open</span> to view it on the Spatial tab.
              </div>
            )}
          </>
        )}
      </div>
    </FloatingPanel>
  );
}
```

- [ ] **Step 2: Verify**

```bash
npm run build && npm run lint:undef
```

Expected: both succeed.

- [ ] **Step 3: Commit**

```bash
git add src/components/panels/ArtifactViewerPanel.jsx
git commit -m "feat(panels): artifact viewer over the project's saved plots and maps"
```

---

### Task 7: Mount at App level

**Files:**
- Create: `src/components/panels/PanelHost.jsx`
- Modify: `src/App.jsx` (provider wrap at the workspace root; host next to `TourOverlay` around line 3213)

- [ ] **Step 1: Write the host**

Create `src/components/panels/PanelHost.jsx`:

```jsx
// ─── ECON STUDIO · components/panels/PanelHost.jsx ────────────────────────────
// Mount point for APP-SCOPED floating panels. Lives as a sibling of the tab
// panels, never inside one — App keeps tab panels mounted with display:none, and
// display:none on an ancestor hides position:fixed descendants too, so a panel
// mounted inside a module disappears whenever that module is not on screen.

import ArtifactViewerPanel from "./ArtifactViewerPanel.jsx";

export default function PanelHost({ pid, datasets, artifactViewerOpen, onCloseArtifactViewer, onOpenArtifact }) {
  if (!artifactViewerOpen) return null;
  return (
    <ArtifactViewerPanel
      pid={pid}
      datasets={datasets}
      onOpen={onOpenArtifact}
      onClose={onCloseArtifactViewer}
    />
  );
}
```

- [ ] **Step 2: Add the imports to `App.jsx`**

Next to the existing `HelpSystem` import (`App.jsx:35`):

```jsx
import { PanelStackProvider } from "./components/panels/PanelStack.jsx";
import PanelHost from "./components/panels/PanelHost.jsx";
```

- [ ] **Step 3: Add the open/closed state**

Beside the existing `panes` state (`App.jsx:2757`):

```jsx
  const [artifactViewerOpen, setArtifactViewerOpen] = useState(false);
```

- [ ] **Step 4: Wrap the workspace in the provider and mount the host**

Immediately after the `TourOverlay` block that ends at `App.jsx:3213`, insert:

```jsx
              <PanelStackProvider panes={panes}>
                <PanelHost
                  pid={pid}
                  datasets={availableDatasets}
                  artifactViewerOpen={artifactViewerOpen}
                  onCloseArtifactViewer={() => setArtifactViewerOpen(false)}
                  onOpenArtifact={(a) => {
                    setActiveTab(a.kind === "map" ? "spatial" : "explore");
                    setArtifactViewerOpen(false);
                  }}
                />
              </PanelStackProvider>
```

**Important:** `DistinctValuesPanel` must also be inside this provider or it will
silently fall back to `PANEL_MARGIN` and overlap the viewer. Move the opening
`<PanelStackProvider panes={panes}>` up so it wraps BOTH the `PanelHost` above and
the tab-panels `<div ref={paneWrapRef}>` that begins at `App.jsx:3216`, closing it
after that div. Verify by opening the distinct-values panel with the artifact
viewer already open — they must stack, not overlap.

- [ ] **Step 5: Add the toggle button**

In `WorkspaceBar.jsx`, beside the existing `?` tour button, add a button that
calls a new `onToggleArtifacts` prop, and pass
`onToggleArtifacts={() => setArtifactViewerOpen(o => !o)}` from `App.jsx`'s
`<WorkspaceBar>` call site:

```jsx
        <button onClick={onToggleArtifacts} title="Artifacts"
          style={{
            background: "transparent", border: `1px solid ${C.border2}`, borderRadius: 3,
            color: C.textDim, cursor: "pointer", fontFamily: T.code.fontFamily,
            fontSize: T.caption.fontSize, padding: "2px 8px",
          }}>◫</button>
```

- [ ] **Step 6: Verify**

```bash
npm run build && npm run lint:undef
```

Expected: both succeed.

- [ ] **Step 7: Commit**

```bash
git add src/components/panels/PanelHost.jsx src/App.jsx src/components/workspace/WorkspaceBar.jsx
git commit -m "feat(panels): mount the artifact viewer at App level"
```

---

### Task 8: Persist panel state per project

**Files:**
- Create: `src/components/panels/panelPrefs.js`
- Modify: `src/components/panels/ArtifactViewerPanel.jsx`
- Modify: `src/App.jsx`

Spec §5 requires the open/minimized state and the current index to survive in
`sessionStorage`, **keyed by `pid`**. The keying is not cosmetic: this codebase has
already been bitten by project state bleeding between projects, and the standing
invariant is that every sessionStorage key is scoped per `pid`.

- [ ] **Step 1: Write the helper**

Create `src/components/panels/panelPrefs.js`:

```js
// ─── ECON STUDIO · components/panels/panelPrefs.js ────────────────────────────
// Per-project floating-panel UI state. Every key is scoped by pid — unscoped
// sessionStorage is how project state bled between projects before.

const key = (pid, name) => `panel_${name}_${pid ?? "none"}`;

export function readPanelPref(pid, name, fallback) {
  if (!pid) return fallback;
  try {
    const raw = sessionStorage.getItem(key(pid, name));
    return raw == null ? fallback : JSON.parse(raw);
  } catch {
    return fallback;
  }
}

export function writePanelPref(pid, name, value) {
  if (!pid) return;
  try {
    sessionStorage.setItem(key(pid, name), JSON.stringify(value));
  } catch {
    // Private-mode quota failures must never break the panel.
  }
}
```

- [ ] **Step 2: Use it in the viewer**

In `src/components/panels/ArtifactViewerPanel.jsx`, add the import:

```jsx
import { readPanelPref, writePanelPref } from "./panelPrefs.js";
```

Replace the `idx` and `minimized` state declarations:

```jsx
  const [idx,       setIdx]       = useState(() => readPanelPref(pid, "artifactIdx", 0));
  const [minimized, setMinimized] = useState(() => readPanelPref(pid, "artifactMin", false));
```

And persist both, after the existing clamp effect:

```jsx
  useEffect(() => { writePanelPref(pid, "artifactIdx", idx); }, [pid, idx]);
  useEffect(() => { writePanelPref(pid, "artifactMin", minimized); }, [pid, minimized]);
```

Note the lazy `useState` initialisers: `pid` can arrive after first render, so
also re-read when it changes:

```jsx
  useEffect(() => {
    if (!pid) return;
    setIdx(readPanelPref(pid, "artifactIdx", 0));
    setMinimized(readPanelPref(pid, "artifactMin", false));
  }, [pid]);
```

- [ ] **Step 3: Persist the open/closed flag in `App.jsx`**

Replace the state added in Task 7 Step 3 with:

```jsx
  const [artifactViewerOpen, setArtifactViewerOpen] = useState(false);
  useEffect(() => { setArtifactViewerOpen(readPanelPref(pid, "artifactOpen", false)); }, [pid]);
  useEffect(() => { writePanelPref(pid, "artifactOpen", artifactViewerOpen); }, [pid, artifactViewerOpen]);
```

and add to `App.jsx`'s imports:

```jsx
import { readPanelPref, writePanelPref } from "./components/panels/panelPrefs.js";
```

- [ ] **Step 4: Verify**

```bash
npm run build && npm run lint:undef
```

Expected: both succeed.

- [ ] **Step 5: Commit**

```bash
git add src/components/panels/panelPrefs.js src/components/panels/ArtifactViewerPanel.jsx src/App.jsx
git commit -m "feat(panels): persist artifact-viewer state per project"
```

---

### Task 9: Help copy and capability map

**Files:**
- Modify: `src/ExplorerModule.jsx:2589` (Explore HintBox)
- Modify: `src/components/ModelingTab.jsx:2117` (Model HintBox)
- Modify: `src/services/AI/appCapabilityMap.js`

Required by the CLAUDE.md convention: anything the user opens from the UI updates
that module's HintBox in the same change. Per project rule, **no counts** go into
the prose — name the things.

- [ ] **Step 1: Add an Explore HintBox section**

In `src/ExplorerModule.jsx`, add to the `sections` array of the `HintBox` at line 2589:

```jsx
          { heading: "Artifacts", items: [
            "◫ in the top bar opens a floating panel listing every saved plot and map in this project",
            "It stays on screen across tabs — keep a chart visible while you build a model",
            "Order matches the replication bundle, so what you see is what gets exported",
          ]},
```

- [ ] **Step 2: Add the same section to the Model HintBox**

In `src/components/ModelingTab.jsx`, add to the `sections` array of the `HintBox` at line 2117:

```jsx
          { heading: "Artifacts", items: [
            "◫ in the top bar opens the floating artifact panel without leaving this tab",
            "Useful for checking a saved plot against the model you are specifying",
          ]},
```

- [ ] **Step 3: Add the capability-map row**

In `src/services/AI/appCapabilityMap.js`, add to `APP_CAPABILITY_MAP` following the
shape of the surrounding rows:

```js
  { area: "Artifacts panel", where: "◫ button in the top workspace bar (available on every tab)",
    what: "Floating panel listing the project's saved plots and maps in their global order; renders plots inline and can jump to an artifact's home tab." },
```

- [ ] **Step 4: Verify**

```bash
npm run build && npm run lint:undef
```

Expected: both succeed. If the object keys above do not match the file's existing
rows, mirror the neighbouring entries exactly — the shape is defined there, not here.

- [ ] **Step 5: Commit**

```bash
git add src/ExplorerModule.jsx src/components/ModelingTab.jsx src/services/AI/appCapabilityMap.js
git commit -m "docs(panels): help copy and capability map for the artifact viewer"
```

---

## Done criteria

- `node src/components/panels/__validation__/panelStackValidation.mjs` prints `panelStackMath OK`
- `npm run build` and `npm run lint:undef` both green
- Franco's browser pass (project rule — no browser validation from the agent):
  1. Open the artifact viewer from any tab; it stays visible when switching tabs.
  2. Save a plot in Explore, reopen the viewer — it appears, renders, and ◀ ▶ walks the project order.
  3. Open the distinct-values panel in Clean with the viewer already open — the two **stack** and do not overlap.
  4. Switch to Model — the distinct panel disappears and the viewer **drops to the bottom margin** with no gap left behind. This is the regression Task 1's harness guards.
  5. Reload — the viewer's open/closed state and index are session state; confirm no cross-project bleed by switching projects.
