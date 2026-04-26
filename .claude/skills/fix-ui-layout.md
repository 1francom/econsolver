---
name: Fix UI Layout
description: Fix layout, overflow, scroll, and visibility issues in EconSolver's modeling or wrangling UI. Use this skill when variables are cut off, buttons aren't visible, sliders overflow, panels are too narrow, the estimator sidebar clips content, or the variable selector doesn't show all columns. Also use for any inline-style layout adjustment.
---

## Fix UI Layout — EconSolver

### Where layout is controlled

EconSolver uses **100% inline styles** via the `C` color object. No CSS files, no Tailwind.
Relevant `C` tokens for layout:
```js
C.bg        // #080808 — base background
C.panel     // panel background (slightly lighter)
C.border    // primary border
C.border2   // secondary/dimmer border
C.teal      // accent — selected state
C.textDim   // de-emphasized text
```
`mono` = IBM Plex Mono — always set `fontFamily: mono` on all text.

---

### Common symptom → root cause → file map

**1. Variable selector shows only some columns / list cuts off**
- File: `src/components/modeling/VariableSelector.jsx`
- Cause: fixed `height` or `maxHeight` without `overflowY: "auto"`.
- Fix pattern:
  ```js
  // Find the column list container — usually a div wrapping the column chips
  style={{ maxHeight: 220, overflowY: "auto", ... }}
  // Change to:
  style={{ maxHeight: "calc(100vh - 420px)", overflowY: "auto", ... }}
  ```
- Also check: `VarPanel` in `src/components/modeling/shared.jsx` — it defines the scrollable region for the variable selector. Look for `overflow: "hidden"` → change to `"auto"`.

**2. Estimator sidebar clips model list / bottom buttons not visible**
- File: `src/components/modeling/EstimatorSidebar.jsx`
- Cause: sidebar has fixed `height` or `overflow: "hidden"` at the wrapper level.
- Fix pattern:
  ```js
  // Outer sidebar wrapper:
  style={{ height: "100%", display: "flex", flexDirection: "column", overflowY: "auto" }}
  ```
- If "Estimate" button is clipped: it's usually inside a `<Section>` at the bottom. Ensure the parent flex column has `flex: 1` on the scrollable area and `flexShrink: 0` on the button row.

**3. ModelConfiguration options not visible (instruments, bandwidth, etc.)**
- File: `src/components/modeling/ModelConfiguration.jsx`
- Cause: conditional config section renders below fold with no scroll.
- Fix: wrap config content in a scrollable container, or ensure it's inside the EstimatorSidebar's scrollable region (not outside it).

**4. Wrangling tabs overflow / CleanTab or FeatureTab cuts off**
- File: the relevant `*Tab.jsx` in `src/components/wrangling/`
- Cause: fixed height on tab content without overflow.
- Pattern: each tab root div should have:
  ```js
  style={{ height: "100%", overflowY: "auto", padding: "12px 16px" }}
  ```

**5. Panel/heatmap in PanelTab doesn't scroll horizontally**
- File: `src/components/wrangling/PanelTab.jsx`
- Fix:
  ```js
  style={{ overflowX: "auto", overflowY: "auto", maxHeight: 320 }}
  ```

**6. Filter builder rows overflow / conditions pile up invisibly**
- File: `src/components/wrangling/CleanTab.jsx` — `FilterBuilder` component.
- Fix: add `maxHeight: 280, overflowY: "auto"` to the condition list wrapper.

**7. Modeling result panel too narrow / coefficients table clips**
- File: `src/ModelingTab.jsx` — result section, usually ~line 1100+.
- Look for the outer results wrapper: add `overflowX: "auto"` to the table container.

**8. History sidebar overlaps content on small screens**
- File: `src/components/wrangling/History.jsx` and `src/WranglingModule.jsx` layout.
- The sidebar is absolutely positioned. Check `WranglingModule.jsx` for the outer flex wrapper and verify `flex: 1` and `minWidth: 0` on the main content area.

---

### Diagnostic steps

1. User describes what's clipped/missing. Ask: **modeling side or wrangling side?**
2. Read ONLY the specific file from the map above — not the full orchestrator.
3. Search for the containing `div` of the clipped element:
   - Look for `overflow: "hidden"` → change to `"auto"`.
   - Look for fixed `height:` values → change to `maxHeight:` + scroll.
   - Look for missing `minWidth: 0` on flex children (causes shrink-to-zero).
4. Apply `str_replace` patch — one targeted change.
5. Tell user what to validate: "scroll the [variable list / sidebar / config panel] to confirm all items are visible."

---

### Common layout patterns used in EconSolver

**Scrollable sidebar column (EstimatorSidebar pattern):**
```jsx
<div style={{ display:"flex", flexDirection:"column", height:"100%", overflow:"hidden" }}>
  {/* scrollable section */}
  <div style={{ flex:1, overflowY:"auto", padding:"8px 0" }}>
    {/* models list */}
  </div>
  {/* pinned footer — always visible */}
  <div style={{ flexShrink:0, borderTop:`1px solid ${C.border}`, padding:"8px 12px" }}>
    <button>Estimate</button>
  </div>
</div>
```

**Scrollable chip list (VariableSelector pattern):**
```jsx
<div style={{ maxHeight:200, overflowY:"auto", display:"flex", flexWrap:"wrap", gap:4 }}>
  {cols.map(c => <Chip key={c} ... />)}
</div>
```

**Flex child that doesn't shrink to zero:**
```jsx
// Parent: display flex, row direction
// Child must have:
style={{ minWidth:0, flex:1 }}
```

---

### Token efficiency
- Modeling layout issue → read only `EstimatorSidebar.jsx` OR `VariableSelector.jsx` OR `ModelConfiguration.jsx` — one file max.
- Wrangling layout issue → read only the specific `*Tab.jsx`.
- Never read `WranglingModule.jsx` or `ModelingTab.jsx` in full for layout bugs.
- Target: identify and fix in ≤ 3 tool calls.
