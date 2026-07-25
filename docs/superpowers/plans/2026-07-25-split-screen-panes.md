# Split-Screen Panes Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let a user show two modules side by side (e.g. Clean + Model) with a Windows-snap-style adjustable divider, without any module losing state.

**Architecture:** `App.jsx` already mounts every tab panel simultaneously (`display:none` toggling) and positions each one `position:absolute; inset:0`. The split is therefore a **pure CSS box change** — each visible panel gets explicit `left`/`width` instead of `inset:0`. No component is ever reparented, so there are no remounts and no state loss. A single pane renders identically to today.

**Tech Stack:** React 18 + Vite, plain JS, inline styles using the `C` theme object from `ThemeContext`. `ResizeObserver` for width-driven sidebar collapse.

---

## ⚠️ Verification convention — read before starting

**This repo has no component test framework.** `package.json` exposes only `dev`, `build`, `lint`, `lint:undef`, `preview`. There is no jest/vitest and no React testing library. Do **not** introduce one for this feature.

Per `CLAUDE.md`:
- After every change, verify with **`npm run build`** (it runs `lint-undef` first, then `vite build`).
- **Never use browser preview/automation tools** to validate. Franco does all browser validation himself.

So every task's verification step is `npm run build` returning `✓ built`. Where a task has behaviour that only a human can confirm in a browser, it is listed under **Franco validates** at the end of the task — do not claim it works.

---

## File structure

| File | Responsibility | New? |
|---|---|---|
| `src/hooks/useContainerWidth.js` | Observe an element's width via `ResizeObserver`. Sole job. | **new** (also new `src/hooks/` dir) |
| `src/components/workspace/SplitDivider.jsx` | Draggable divider: drag, centre snap, double-click reset, min-width close. Owns no layout state. | **new** |
| `src/App.jsx` | Pane state (`panes`, `focused`, `paneRatio`), `paneBox()`, `setActiveTab` shim, persistence. | modify |
| `src/components/workspace/WorkspaceBar.jsx` | ⊞ split toggle + markers showing which tabs are open. | modify |
| `src/components/wrangling/History.jsx` | Collapse to a rail below the width threshold; expand as overlay. | modify |
| `src/WranglingModule.jsx` | Measure own width, pass `collapsed` to `History`. | modify |
| `src/components/ModelingTab.jsx` | Measure own width, collapse the 300px spec panel. | modify |

**Ordering rationale:** Tasks 1–2 (self-collapsing sidebars) ship value on their own with no split involved. Task 3 introduces the pane machinery while rendering identically to today. Tasks 4–5 make the split reachable. Task 6 persists it.

---

### Task 1: Width observer hook + collapsible pipeline History

**Files:**
- Create: `src/hooks/useContainerWidth.js`
- Modify: `src/components/wrangling/History.jsx` (imports; component signature; the `width: 230` container at ~line 83)
- Modify: `src/WranglingModule.jsx` (root `<div>` at ~line 448; the `<History .../>` call at ~line 732)

- [ ] **Step 1: Create the width-observer hook**

Create `src/hooks/useContainerWidth.js`:

```js
// ─── ECON STUDIO · hooks/useContainerWidth.js ──────────────────────────────
// Observes one element's content width with ResizeObserver.
// Returns null until the first measurement lands, so callers can avoid
// flashing a collapsed layout before the real width is known.
import { useEffect, useState } from "react";

export function useContainerWidth(ref) {
  const [width, setWidth] = useState(null);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const ro = new ResizeObserver(entries => {
      const w = entries[0]?.contentRect?.width;
      if (typeof w === "number") setWidth(w);
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, [ref]);

  return width;
}
```

- [ ] **Step 2: Add the `collapsed` prop and rail rendering to History**

In `src/components/wrangling/History.jsx`, the component currently destructures its props and returns a `width: 230` column. Make three edits.

First, ensure `useState` is imported (it already is — the file uses `confirmClearAll`). Add the `collapsed` prop to the signature and a local overlay flag. Find the existing early return and container:

```jsx
  if (!pipeline.length && !canUndo && !canRedo) return null;
```

Insert immediately **after** that line:

```jsx
  // Collapsed rail — shown when the module is too narrow for a 230px sidebar.
  // `expanded` lets the user pull it open as a temporary overlay.
  if (collapsed && !expanded) {
    return (
      <div style={{
        width: 28, flexShrink: 0,
        borderLeft: `1px solid ${C.border}`,
        background: C.surface,
        display: "flex", flexDirection: "column", alignItems: "center",
        paddingTop: 8, gap: 8, overflow: "hidden",
      }}>
        <button
          onClick={() => setExpanded(true)}
          title="Show pipeline"
          style={{
            background: "transparent", border: "none", color: C.teal,
            cursor: "pointer", fontSize: T.code.fontSize, padding: 2,
          }}
        >⟨</button>
        <div style={{
          writingMode: "vertical-rl", transform: "rotate(180deg)",
          fontSize: T.caption.fontSize, color: C.textMuted,
          fontFamily: T.label.fontFamily, letterSpacing: "0.18em",
          textTransform: "uppercase", whiteSpace: "nowrap",
        }}>
          Pipeline · {pipeline.length}
        </div>
      </div>
    );
  }
```

For that block to compile, the component needs the new prop and the overlay state. Replace the signature at line 71:

```jsx
function History({ pipeline, onRm, onClear, onClearPatches, onUndo, onRedo, canUndo, canRedo, branchPointIndex, onSetBranch, pendingDelete, onConfirmDelete, onCancelDelete }) {
```

with:

```jsx
function History({ pipeline, onRm, onClear, onClearPatches, onUndo, onRedo, canUndo, canRedo, branchPointIndex, onSetBranch, pendingDelete, onConfirmDelete, onCancelDelete, collapsed = false }) {
```

and add next to the other `useState` calls (beside `confirmClearAll` / `confirmClearPatches`):

```jsx
  const [expanded, setExpanded] = useState(false);
```

Note the ordering constraint: the existing `if (!pipeline.length && !canUndo && !canRedo) return null;` early return must stay **above** the new rail block, and both must stay **below** the `useState` calls — moving a hook below a conditional return is the exact React-hooks bug that `CLAUDE.md` lists as having caused the 2SLS black screen.

Second, make the main container overlay itself when it was opened from the rail. Replace:

```jsx
    <div style={{
      width: 230, flexShrink: 0,
      borderLeft: `1px solid ${C.border}`,
      background: C.surface,
      display: "flex", flexDirection: "column",
      overflow: "hidden",
    }}>
```

with:

```jsx
    <div style={{
      width: 230, flexShrink: 0,
      borderLeft: `1px solid ${C.border}`,
      background: C.surface,
      display: "flex", flexDirection: "column",
      overflow: "hidden",
      ...(collapsed ? {
        position: "absolute", right: 0, top: 0, bottom: 0,
        zIndex: 20, boxShadow: "-8px 0 24px #0008",
      } : {}),
    }}>
```

Third, give the overlay a way to close. Inside the header row, right after the `<Lbl mb={0} style={{ flex: 1 }}>Pipeline</Lbl>` line, insert:

```jsx
        {collapsed && (
          <button
            onClick={() => setExpanded(false)}
            title="Hide pipeline"
            style={{
              background: "transparent", border: "none", color: C.textMuted,
              cursor: "pointer", fontSize: T.code.fontSize, padding: "0 2px",
            }}
          >⟩</button>
        )}
```

- [ ] **Step 3: Measure the module width and pass `collapsed`**

In `src/WranglingModule.jsx`, add the import next to the other local imports:

```jsx
import { useContainerWidth } from "./hooks/useContainerWidth.js";
```

Inside the component, next to the other refs, add:

```jsx
  // Below this width the 230px History sidebar is folded to a rail. Lives here
  // (not in App) so it also helps small laptops with no split involved.
  const rootRef     = useRef(null);
  const rootWidth   = useContainerWidth(rootRef);
  const narrowRoot  = rootWidth !== null && rootWidth < 700;
```

Attach the ref and make the root a positioning context for the overlay. Replace:

```jsx
    <div style={{ display:"flex", height:"100%", minHeight:0,
      background:C.bg, color:C.text, fontFamily:T.body.fontFamily, overflow:"hidden" }}>
```

with:

```jsx
    <div ref={rootRef} style={{ display:"flex", height:"100%", minHeight:0, position:"relative",
      background:C.bg, color:C.text, fontFamily:T.body.fontFamily, overflow:"hidden" }}>
```

Then pass the flag to History — find `<History` and add the prop:

```jsx
      <History
        collapsed={narrowRoot}
        pipeline={pipeline}
```

- [ ] **Step 4: Verify the build**

Run: `npm run build`
Expected: `ok — no undefined-identifier (no-undef) violations` then `✓ built in …`

- [ ] **Step 5: Commit**

```bash
git add src/hooks/useContainerWidth.js src/components/wrangling/History.jsx src/WranglingModule.jsx
git commit -m "Collapse pipeline History sidebar on narrow widths"
```

**Franco validates:** shrink the browser window under ~700px in Clean — History should fold to a vertical rail, and ⟨ should open it as an overlay that ⟩ closes.

---

### Task 2: Collapsible estimator spec panel in Model

**Files:**
- Modify: `src/components/ModelingTab.jsx` (imports; the body `<div>` at ~line 2016; the `width: 300` spec panel at ~line 2019; `HintBox overlayLeft` at ~line 2021)

- [ ] **Step 1: Import the hook and measure the body width**

In `src/components/ModelingTab.jsx` add the import alongside the other local imports:

```jsx
import { useContainerWidth } from "../hooks/useContainerWidth.js";
```

Inside the component, next to the other refs, add:

```jsx
  // Same rule as Clean's History: fold the 300px spec panel when the module is
  // too narrow to afford it (small laptop, or one half of a split).
  const bodyRef      = useRef(null);
  const bodyWidth    = useContainerWidth(bodyRef);
  const specNarrow   = bodyWidth !== null && bodyWidth < 700;
  const [specOpen, setSpecOpen] = useState(false);
  const specCollapsed = specNarrow && !specOpen;
```

- [ ] **Step 2: Attach the ref and render the rail**

Replace the body container:

```jsx
      <div style={{ flex: 1, display: "flex", minHeight: 0 }}>
```

with:

```jsx
      <div ref={bodyRef} style={{ flex: 1, display: "flex", minHeight: 0, position: "relative" }}>

        {/* Collapsed rail — restores the spec panel as an overlay */}
        {specCollapsed && (
          <div style={{
            width: 28, flexShrink: 0, borderRight: `1px solid ${C.border}`,
            display: "flex", flexDirection: "column", alignItems: "center",
            paddingTop: 8, gap: 8, overflow: "hidden",
          }}>
            <button
              onClick={() => setSpecOpen(true)}
              title="Show model spec"
              style={{
                background: "transparent", border: "none", color: C.teal,
                cursor: "pointer", fontSize: T.code.fontSize, padding: 2,
              }}
            >⟩</button>
            <div style={{
              writingMode: "vertical-rl",
              fontSize: T.caption.fontSize, color: C.textMuted,
              fontFamily: T.label.fontFamily, letterSpacing: "0.18em",
              textTransform: "uppercase", whiteSpace: "nowrap",
            }}>
              Spec
            </div>
          </div>
        )}
```

- [ ] **Step 3: Make the spec panel hide or overlay**

Replace the spec panel container:

```jsx
        <div style={{ width: 300, flexShrink: 0, borderRight: `1px solid ${C.border}`, overflowY: "auto", padding: "1.2rem", paddingBottom: "3rem" }}>
```

with:

```jsx
        <div style={{
          width: 300, flexShrink: 0, borderRight: `1px solid ${C.border}`,
          overflowY: "auto", padding: "1.2rem", paddingBottom: "3rem",
          display: specCollapsed ? "none" : "block",
          ...(specNarrow && specOpen ? {
            position: "absolute", left: 0, top: 0, bottom: 0,
            zIndex: 20, background: C.bg, boxShadow: "8px 0 24px #0008",
          } : {}),
        }}>

          {specNarrow && specOpen && (
            <button
              onClick={() => setSpecOpen(false)}
              title="Hide model spec"
              style={{
                background: "transparent", border: "none", color: C.textMuted,
                cursor: "pointer", fontSize: T.code.fontSize,
                float: "right", padding: "0 2px",
              }}
            >⟨</button>
          )}
```

- [ ] **Step 4: Keep the help overlay aligned with the real sidebar width**

`HintBox` is positioned with a hardcoded `overlayLeft={300}` that assumes the spec panel's width. Replace:

```jsx
          <HintBox color={C.teal} title="How to model" overlayLeft={300} sections={[
```

with:

```jsx
          <HintBox color={C.teal} title="How to model" overlayLeft={specCollapsed ? 28 : 300} sections={[
```

- [ ] **Step 5: Verify the build**

Run: `npm run build`
Expected: `✓ built in …`

- [ ] **Step 6: Commit**

```bash
git add src/components/ModelingTab.jsx
git commit -m "Collapse estimator spec panel on narrow widths"
```

**Franco validates:** narrow the window in Model — the 300px spec panel folds to a rail; ⟩ opens it over the results, ⟨ closes it.

---

### Task 3: Pane state and `paneBox` (renders identically to today)

This task introduces the whole pane model but leaves the app in single-pane mode, so the rendered result must be indistinguishable from before. Nothing yet can create a second pane.

**Files:**
- Modify: `src/App.jsx` (state at ~line 2677; the 8 panel `<div>`s at ~lines 3034–3170)

- [ ] **Step 1: Replace `activeTab` state with the pane model**

In `src/App.jsx`, replace:

```jsx
  const [activeTab,          setActiveTab]         = useState("clean");
```

with:

```jsx
  // ── Pane model ────────────────────────────────────────────────────────────
  // `panes` is positional: [leftTabId, rightTabId | null]. null in slot 1 means
  // no split. `activeTab` stays the focused pane's tab so every existing
  // consumer (nav history, tour, WorkspaceBar) keeps working unchanged.
  const [panes,     setPanes]     = useState(["clean", null]);
  const [focused,   setFocused]   = useState(0);
  const [paneRatio, setPaneRatio] = useState(0.5);

  const isSplit   = panes[1] !== null;
  const activeTab = panes[focused] ?? panes[0];

  // Drop-in replacement for the old setter: assigns a module to the FOCUSED
  // pane. A module is a single DOM element, so it can never appear twice —
  // asking for one that's already in the other pane swaps the two instead.
  const setActiveTab = useCallback((tab) => {
    setPanes(p => {
      const other = 1 - focused;
      const next  = [...p];
      if (p[other] === tab) next[other] = p[focused];
      next[focused] = tab;
      return next;
    });
  }, [focused]);
```

`useCallback` is already imported in `App.jsx`. If it is not, add it to the `react` import.

- [ ] **Step 2: Add the `paneBox` helper**

Immediately after the `setActiveTab` definition, add:

```jsx
  // Half the divider's width — panes leave this much room on the shared edge.
  const DIVIDER_HALF = 3;

  // The CSS box for a tab's panel. Unassigned panels stay mounted but hidden,
  // exactly as before. This is the whole split: no element ever moves in the
  // React tree, so nothing remounts and no module loses state.
  const paneBox = (tab) => {
    const idx = panes.indexOf(tab);
    if (idx === -1)  return { ...tabPanel, display: "none" };
    if (!isSplit)    return { ...tabPanel, display: "flex" };

    const R = paneRatio * 100;
    const box = idx === 0
      ? { left: 0,                                  width: `calc(${R}% - ${DIVIDER_HALF}px)` }
      : { left: `calc(${R}% + ${DIVIDER_HALF}px)`,  width: `calc(${100 - R}% - ${DIVIDER_HALF}px)` };

    return {
      position: "absolute", top: 0, bottom: 0, overflow: "hidden",
      display: "flex", ...box,
      boxShadow: idx === focused ? `inset 0 0 0 1px ${C.teal}66` : "none",
    };
  };

  // Clicking anywhere inside a pane focuses it, so the next tab click lands there.
  const paneFocusProps = (tab) => {
    const idx = panes.indexOf(tab);
    return idx === -1 ? {} : { onMouseDownCapture: () => setFocused(idx) };
  };
```

- [ ] **Step 3: Switch all eight panels to `paneBox`**

Each panel currently reads `{...tabPanel, display: activeTab==="<id>" ? "flex" : "none", …}`. Replace the style expression and add the focus handler. Do this for all eight tabs: `data`, `clean`, `explore`, `model`, `spatial`, `simulate`, `report`, `calculate`.

Seven of them carry `flexDirection:"column"`; `report` does not — preserve each one exactly as it is. Examples:

```jsx
                <div {...paneFocusProps("data")} style={{...paneBox("data"), flexDirection:"column"}}>
```

```jsx
                <div {...paneFocusProps("clean")} style={{...paneBox("clean"), flexDirection:"column"}}>
```

```jsx
                <div {...paneFocusProps("report")} style={{...paneBox("report")}}>
```

- [ ] **Step 4: Verify the build**

Run: `npm run build`
Expected: `✓ built in …`

- [ ] **Step 5: Commit**

```bash
git add src/App.jsx
git commit -m "Introduce pane model and paneBox in App"
```

**Franco validates:** the app must look and behave **exactly as before** at this commit — tab switching, the tour, back-navigation. Any visible difference here is a bug.

---

### Task 4: SplitDivider component and pane handlers

**Files:**
- Create: `src/components/workspace/SplitDivider.jsx`
- Modify: `src/App.jsx` (handlers next to `paneBox`; render inside the panel container at ~line 3031)

- [ ] **Step 1: Create the divider**

Create `src/components/workspace/SplitDivider.jsx`:

```jsx
// ─── ECON STUDIO · workspace/SplitDivider.jsx ──────────────────────────────
// Draggable divider between two panes. Windows-snap behaviour: free drag, a
// magnetic zone at the centre, double-click resets to 50/50, and dragging a
// pane below the minimum width closes it instead of shrinking it to nothing.
import { useEffect, useRef } from "react";
import { useTheme } from "../../ThemeContext.jsx";

const SNAP_ZONE = 0.02;   // fraction of width around 0.5 that snaps to centre
const MIN_PANE  = 360;    // px — below this a pane closes rather than shrink

export default function SplitDivider({ ratio, onRatio, onClosePane, containerRef }) {
  const { C } = useTheme();
  const dragging = useRef(false);

  useEffect(() => {
    function onMove(e) {
      if (!dragging.current) return;
      const el = containerRef.current;
      if (!el) return;
      const r = el.getBoundingClientRect();
      if (r.width <= 0) return;

      let next = (e.clientX - r.left) / r.width;
      if (Math.abs(next - 0.5) < SNAP_ZONE) next = 0.5;

      const minRatio = MIN_PANE / r.width;
      if (next < minRatio)     { dragging.current = false; onClosePane(0); return; }
      if (next > 1 - minRatio) { dragging.current = false; onClosePane(1); return; }
      onRatio(next);
    }
    function onUp() {
      if (!dragging.current) return;
      dragging.current = false;
      document.body.style.cursor = "";
      document.body.style.userSelect = "";
    }
    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", onUp);
    return () => {
      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("mouseup", onUp);
    };
  }, [onRatio, onClosePane, containerRef]);

  return (
    <div
      onMouseDown={() => {
        dragging.current = true;
        document.body.style.cursor = "col-resize";
        document.body.style.userSelect = "none";
      }}
      onDoubleClick={() => onRatio(0.5)}
      title="Drag to resize · double-click to reset to 50/50"
      style={{
        position: "absolute", top: 0, bottom: 0, zIndex: 10,
        left: `calc(${ratio * 100}% - 3px)`, width: 6,
        background: C.border, cursor: "col-resize",
      }}
      onMouseEnter={e => { e.currentTarget.style.background = C.teal; }}
      onMouseLeave={e => { e.currentTarget.style.background = C.border; }}
    />
  );
}
```

- [ ] **Step 2: Add the open/close handlers in App**

In `src/App.jsx`, add the import with the other workspace imports:

```jsx
import SplitDivider from "./components/workspace/SplitDivider.jsx";
```

Then, right after `paneFocusProps`, add:

```jsx
  // Close one pane; the survivor goes full width.
  const closePane = useCallback((idx) => {
    setPanes(p => [p[1 - idx] ?? p[idx], null]);
    setFocused(0);
    setPaneRatio(0.5);
  }, []);

  // ⊞ toggle. Opening seeds the new pane with a tab that is never locked
  // (Data and Clean have requiresOutput:false) and focuses it, so the user's
  // next tab click lands in the pane they just created.
  const toggleSplit = useCallback(() => {
    if (isSplit) {
      const keep = panes[focused] ?? panes[0];
      setPanes([keep, null]);
      setFocused(0);
      setPaneRatio(0.5);
    } else {
      setPanes([panes[0], panes[0] === "clean" ? "data" : "clean"]);
      setFocused(1);
      setPaneRatio(0.5);
    }
  }, [isSplit, panes, focused]);
```

- [ ] **Step 3: Render the divider inside the panel container**

The panel container is the `position:relative` div holding all eight panels. Give it a ref and render the divider when split. Replace:

```jsx
              <div style={{flex:1,minHeight:0,position:"relative"}}>
```

with:

```jsx
              <div ref={paneWrapRef} style={{flex:1,minHeight:0,position:"relative"}}>

                {isSplit && (
                  <SplitDivider
                    ratio={paneRatio}
                    onRatio={setPaneRatio}
                    onClosePane={closePane}
                    containerRef={paneWrapRef}
                  />
                )}
```

Declare the ref next to the other refs in the component:

```jsx
  const paneWrapRef = useRef(null);
```

- [ ] **Step 4: Verify the build**

Run: `npm run build`
Expected: `✓ built in …`

- [ ] **Step 5: Commit**

```bash
git add src/components/workspace/SplitDivider.jsx src/App.jsx
git commit -m "Add SplitDivider and pane open/close handlers"
```

**Franco validates:** nothing visible changes yet — the split still cannot be triggered from the UI. The app must behave exactly as before.

---

### Task 5: WorkspaceBar split toggle and open-tab markers

**Files:**
- Modify: `src/components/workspace/WorkspaceBar.jsx` (props; tab button at ~line 60; new button before the Feedback button at ~line 102)
- Modify: `src/App.jsx` (the `<WorkspaceBar …>` call at ~line 2989)

- [ ] **Step 1: Accept the new props**

In `src/components/workspace/WorkspaceBar.jsx`, replace the signature:

```jsx
export default function WorkspaceBar({ activeTab, onTabChange, hasOutput, reportUnlocked, activeDatasetId, pid, onSelectDataset, onRemoveDataset, onStartTour, onOpenFeedback }) {
```

with:

```jsx
export default function WorkspaceBar({ activeTab, onTabChange, hasOutput, reportUnlocked, activeDatasetId, pid, onSelectDataset, onRemoveDataset, onStartTour, onOpenFeedback, openTabs = [], isSplit = false, onToggleSplit }) {
```

- [ ] **Step 2: Mark tabs that are open in the other pane**

Inside the `TABS.map`, replace:

```jsx
          const isActive = tab.id === activeTab;
          const isLocked = tab.requiresOutput && !hasOutput && !(tab.id === "report" && reportUnlocked);
```

with:

```jsx
          const isActive = tab.id === activeTab;
          const isLocked = tab.requiresOutput && !hasOutput && !(tab.id === "report" && reportUnlocked);
          // Open in the other pane — marked so the user can see what's where.
          const isOther  = openTabs.includes(tab.id) && !isActive;
```

Then, inside the same button, replace the label span:

```jsx
              <span>{tab.label}</span>
```

with:

```jsx
              <span>{tab.label}</span>
              {isOther && (
                <span title="Open in the other pane"
                  style={{ fontSize: T.caption.fontSize, color: C.teal, marginLeft: 1 }}>●</span>
              )}
```

- [ ] **Step 3: Add the ⊞ split toggle**

Insert this block immediately **before** the `{/* ── Feedback button ── */}` comment:

```jsx
      {/* ── Split-screen toggle ── */}
      <button
        onClick={() => onToggleSplit?.()}
        title={isSplit ? "Close split view" : "Split the workspace in two"}
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          width: 32,
          flexShrink: 0,
          background: isSplit ? `${C.teal}18` : "transparent",
          border: "none",
          borderLeft: `1px solid ${C.border}`,
          color: isSplit ? C.teal : C.textMuted,
          cursor: "pointer",
          fontSize: T.body.fontSize,
          fontFamily: T.code.fontFamily,
          transition: "color 0.12s",
        }}
        onMouseEnter={e => { e.currentTarget.style.color = C.teal; }}
        onMouseLeave={e => { e.currentTarget.style.color = isSplit ? C.teal : C.textMuted; }}
      >
        ⊞
      </button>
```

Note: the theme has `goldFaint` / `violetFaint` / `redFaint` / `orangeFaint` but **no `tealFaint`** (checked in `src/theme.js` on 2026-07-25), which is why the tint above is written as `` `${C.teal}18` `` rather than a named token. Do not "fix" it to `C.tealFaint` — that is undefined and `lint:undef` will not catch it because it is a property access, so it would silently render a transparent background.

- [ ] **Step 4: Pass the props from App**

In `src/App.jsx`, at the `<WorkspaceBar` call, add three props alongside the existing ones:

```jsx
              <WorkspaceBar
                onTabChange={navigateToTab}
                openTabs={panes.filter(Boolean)}
                isSplit={isSplit}
                onToggleSplit={toggleSplit}
```

Keep every existing prop exactly as it is.

- [ ] **Step 5: Guard `navigateToTab` against the no-op early return**

`navigateToTab` currently returns early when the requested tab equals `activeTab`. With panes that is still correct, but the swap case must not be blocked. Replace:

```jsx
  function navigateToTab(newTab) {
    if (newTab === activeTab) return;
    pushHistory(screen, activeTab);
    setActiveTab(newTab);
  }
```

with:

```jsx
  function navigateToTab(newTab) {
    if (newTab === activeTab) return;
    // In split view the other pane may already hold this tab; setActiveTab
    // swaps them, which is a real change even though activeTab differs.
    pushHistory(screen, activeTab);
    setActiveTab(newTab);
  }
```

- [ ] **Step 6: Verify the build**

Run: `npm run build`
Expected: `✓ built in …`

- [ ] **Step 7: Commit**

```bash
git add src/components/workspace/WorkspaceBar.jsx src/App.jsx
git commit -m "Add split toggle and open-tab markers to WorkspaceBar"
```

**Franco validates:** ⊞ opens a second pane and highlights it; clicking a tab loads it into the focused pane; clicking a tab already in the other pane swaps them; dragging the divider resizes; double-click resets to 50/50; dragging past ~360px closes that pane. Confirm Clean's History and Model's spec panel fold automatically once a pane gets narrow.

---

### Task 6: Persist the layout per project

**Files:**
- Modify: `src/App.jsx` (near the existing `NAV_KEY` effects at ~line 2706)

- [ ] **Step 1: Restore the layout on mount**

The existing `NAV_KEY` record is deliberately left untouched — the pane layout gets its own key, following the `litux:wrangle_tab:${pid}` convention already used in `WranglingModule`. Add after the `NAV_KEY` declaration:

```jsx
  const PANES_KEY = pid ? `litux:panes:${pid}` : null;
```

Add a restore effect:

```jsx
  // Restore the pane layout for this project. Guarded so a corrupt or stale
  // record can never leave the workspace with no visible pane.
  useEffect(() => {
    if (!PANES_KEY) return;
    try {
      const raw = sessionStorage.getItem(PANES_KEY);
      if (!raw) return;
      const saved = JSON.parse(raw);
      if (!Array.isArray(saved?.panes) || !saved.panes[0]) return;
      setPanes([saved.panes[0], saved.panes[1] ?? null]);
      setFocused(saved.focused === 1 && saved.panes[1] ? 1 : 0);
      const r = Number(saved.ratio);
      setPaneRatio(Number.isFinite(r) && r > 0.1 && r < 0.9 ? r : 0.5);
    } catch { sessionStorage.removeItem(PANES_KEY); }
  }, [PANES_KEY]);
```

- [ ] **Step 2: Persist on change**

Add immediately after:

```jsx
  useEffect(() => {
    if (!PANES_KEY) return;
    try {
      sessionStorage.setItem(PANES_KEY, JSON.stringify({ panes, focused, ratio: paneRatio }));
    } catch { /* sessionStorage full or unavailable — layout is not critical */ }
  }, [PANES_KEY, panes, focused, paneRatio]);
```

- [ ] **Step 3: Verify the build**

Run: `npm run build`
Expected: `✓ built in …`

- [ ] **Step 4: Commit**

```bash
git add src/App.jsx
git commit -m "Persist pane layout per project"
```

**Franco validates:** open a split, drag the divider off-centre, reload — the same two panes and proportion come back. Switching projects must not carry the layout across.

---

### Task 7: Documentation

**Files:**
- Modify: `CLAUDE.md` (file-structure block)
- Modify: `ClaudePlan.md` (the 2026-07-25 index row)

- [ ] **Step 1: Add the new files to the structure block**

In `CLAUDE.md`, inside the `src/` tree, add under `components/workspace/`:

```
│   │   └── SplitDivider.jsx      ← draggable 2-pane divider (snap at 50%, min 360px → closes pane)
```

and add a new top-level entry after `components/`:

```
├── hooks/
│   └── useContainerWidth.js      ← ResizeObserver width probe; drives sidebar auto-collapse
```

- [ ] **Step 2: Update the plan index row**

In `ClaudePlan.md`, in the `2026-07-25` row, change the Spec / Plan cell to reference both documents:

```
| `specs/2026-07-25-split-screen-panes-design.md` + `plans/2026-07-25-split-screen-panes.md` |
```

and set the status to `IMPLEMENTATION COMPLETE — browser validation pending Franco`.

- [ ] **Step 3: Verify the build**

Run: `npm run build`
Expected: `✓ built in …`

- [ ] **Step 4: Commit**

```bash
git add CLAUDE.md ClaudePlan.md
git commit -m "Document split-screen panes"
```

---

## Known limitations carried from the spec

- **Modals are viewport-centred, not pane-confined.** The Standardize dialog (`CleanTab`) and `AuditTrail` cover both panes in split mode. Confining them needs reparenting, which is exactly the cost this design avoids.
- **Same module twice is impossible by construction** — the swap is the intended answer, not a workaround.
- **Vertical (stacked) split is out of scope.**
- **N panes** is not implemented. `paneBox` would generalise from a ratio array, but with these sidebars three panes are only usable on a very wide monitor. Not committed.

## Watch items during review

- Charts that own a `ResizeObserver` (PlotBuilder, spatial Leaflet maps, `didPlots`) must re-measure when the divider moves; check for stale canvas widths after a drag.
- `position:fixed` click-outside scrims in `WranglingModule` dropdowns span the viewport by design; confirm they still dismiss correctly in split mode.
