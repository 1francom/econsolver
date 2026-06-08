# DESIGN.md — EconSolver Design System

> **Purpose:** This document is the single source of truth for EconSolver's (Econ Studio / Litux) visual design system. AI coding agents should read this file before generating any UI code to ensure every new surface is visually consistent with the existing application.

---

## 1. Visual Theme & Atmosphere

EconSolver is a **privacy-first, browser-based econometrics research platform** — a GUI alternative to R and Stata for PhD/thesis students and policy analysts at research institutions. The aesthetic follows the work it supports: serious, precise, and data-forward.

**Design character:**
- **Dark-first.** The default theme is a near-black canvas (#080808) that keeps the researcher's focus on data, not chrome.
- **Researcher-serious.** No decorative gradients, no playful rounded corners, no heavy iconography. Panels feel like a well-designed terminal or a high-end IDE, not a consumer SaaS dashboard.
- **Sharp geometry.** Radii are deliberately kept at 0–6 px. Everything is rectilinear. The sharpness signals precision.
- **Low-chrome.** The UI surfaces themselves are quiet. Color is used for role and hierarchy, not decoration. The gold accent is reserved strictly for active/selected states and heading emphasis.
- **Data-forward.** Coefficients, tables, model output, and code are the primary content. The interface exists to deliver them cleanly.
- **Light mode supported.** A LIGHT palette exists for users who prefer it. The character remains identical — sharp, minimal, serious — just on a warm off-white base (#f4f3f0) rather than near-black.

The typography anchors the feel: IBM Plex Sans for all prose/chrome, IBM Plex Mono for all numbers, coefficients, and code. The split is absolute and structural, not aesthetic.

---

## 2. Color Palette & Roles

Tokens live in `src/theme.js` under `DARK` and `LIGHT` objects. Access them via `const { C } = useTheme()`. Never reference hex literals in component code.

### DARK Palette

| Token | Hex | Role |
|-------|-----|------|
| `C.bg` | `#080808` | App background — the outermost canvas |
| `C.surface` | `#0f0f0f` | Primary panels, cards, sidebars |
| `C.surface2` | `#131313` | Nested panels, inner card backgrounds |
| `C.surface3` | `#161616` | Deeply nested elements, hover backgrounds |
| `C.border` | `#1c1c1c` | Default hairline dividers between surfaces |
| `C.border2` | `#252525` | Stronger dividers, active panel outlines |
| `C.gold` | `#c8a96e` | Primary accent — active/selected state, heading emphasis, primary CTA |
| `C.goldDim` | `#7a6040` | Muted gold — secondary accents, disabled-but-present states |
| `C.goldFaint` | `#1a1408` | Gold tint fill — selected row/chip backgrounds |
| `C.text` | `#ddd8cc` | Primary text — prose, labels, body copy |
| `C.textDim` | `#888` | Secondary text — subtitles, meta, placeholders |
| `C.textMuted` | `#444` | Tertiary text — disabled labels, faint hints |
| `C.green` | `#7ab896` | Positive values, statistical significance, success states |
| `C.red` | `#c47070` | Negative values, errors, warning states |
| `C.yellow` | `#c8b46e` | Warnings, caution indicators |
| `C.blue` | `#6e9ec8` | Categorical series 1, info badges, links |
| `C.purple` | `#a87ec8` | Categorical series 2, model B highlight |
| `C.teal` | `#6ec8b4` | Secondary accent — module eyebrow labels, "running"/progress, info |
| `C.orange` | `#c88e6e` | Categorical series 3, warm highlight |
| `C.violet` | `#9e7ec8` | Categorical series 4 |

### LIGHT Palette

| Token | Hex | Role |
|-------|-----|------|
| `C.bg` | `#f4f3f0` | App background — warm off-white canvas |
| `C.surface` | `#ffffff` | Primary panels, cards |
| `C.surface2` | `#f0eeeb` | Nested panels |
| `C.surface3` | `#eceae6` | Deeply nested elements, hover backgrounds |
| `C.border` | `#d8d5cf` | Default hairline dividers |
| `C.border2` | `#c8c4bc` | Stronger dividers, active outlines |
| `C.gold` | `#a07020` | Primary accent — active/selected, heading emphasis |
| `C.goldDim` | `#c8a050` | Muted gold accent |
| `C.goldFaint` | `#fdf5e0` | Gold tint fill for selected rows/chips |
| `C.text` | `#1a1814` | Primary text |
| `C.textDim` | `#555` | Secondary text |
| `C.textMuted` | `#999` | Tertiary / disabled text |
| `C.green` | `#2e7850` | Positive / significant |
| `C.red` | `#a03030` | Negative / error |
| `C.yellow` | `#807010` | Warning |
| `C.blue` | `#2060a0` | Categorical series 1 / info |
| `C.purple` | `#6030a0` | Categorical series 2 |
| `C.teal` | `#1e7868` | Secondary accent / module eyebrow |
| `C.orange` | `#904020` | Categorical series 3 |
| `C.violet` | `#503090` | Categorical series 4 |

### Color Accent Usage Rules

- **Gold first, teal second.** Gold (`C.gold`) is the primary interactive accent — use it for active tabs, selected chips, primary buttons, and emphasis headings. Teal (`C.teal`) is the secondary accent for informational states, running indicators, and module eyebrow labels.
- **Green/red are semantic only.** Never use green for "success" that isn't statistically or numerically meaningful, and never use red just for visual interest.
- **Blue/purple/orange/violet/yellow** are reserved for categorical data series, badges, and model comparison highlights. Do not repurpose them for navigation chrome.

---

## 3. Typography Rules

Tokens live in `src/theme.js` under the `T` object. Access via `const { T } = useTheme()`. Never hardcode font family names, sizes, or weights in component code.

### The Non-Negotiable Split

| Content type | Family | Token |
|---|---|---|
| Prose, labels, UI chrome, descriptions, tooltips | IBM Plex Sans | `T.body`, `T.label`, `T.h1`–`T.h3`, `T.caption`, `T.display` |
| Coefficients, p-values, statistics, numeric tables, data cells | IBM Plex Mono | `T.data` |
| Replication code, expressions, column names in code | IBM Plex Mono | `T.code` |

**RULE: Never use mono for prose. Never use sans for numeric data or code.** This is structural, not stylistic — it enforces a clear semantic boundary between the interface and the research output.

### Type Role Table

| Token | Family | Size | Weight | Letter-Spacing | Line-Height | Use |
|-------|--------|------|--------|----------------|-------------|-----|
| `T.display` | sans | 28px | 600 | 0 | 1.2 | Empty states, onboarding, hero labels |
| `T.h1` | sans | 20px | 600 | 0 | 1.25 | Page / module title (one per view) |
| `T.h2` | sans | 15px | 600 | 0 | 1.3 | Section headers within a module |
| `T.h3` | sans | 13px | 500 | 0 | 1.3 | Subsection headers, collapsible panel titles |
| `T.body` | sans | 13px | 400 | 0 | 1.5 | Prose, descriptions, tooltip text |
| `T.label` | sans | 10px | 500 | 0.2em | 1.3 | ALL-CAPS tracked caps labels, eyebrows, field labels |
| `T.data` | **mono** | 13px | 400 | 0 | 1.4 | Coefficients, SE, t-stats, p-values, table cells, numeric output |
| `T.code` | **mono** | 12px | 400 | 0 | 1.5 | Replication code, pipeline expressions, column-name references |
| `T.caption` | sans | 10px | 400 | 0.04em | 1.4 | Hints, metadata lines, footnotes |

### Sans Font Switching

The sans family is user-switchable between **IBM Plex Sans** (default), **Inter**, and **Geist** via user preferences (`prefs.fontFamily`). The mono family is always IBM Plex Mono and is not switchable.

### Tabular Numbers

`T.data` applies `font-variant-numeric: tabular-nums` so that columns of coefficients align on decimal points regardless of digit widths.

---

## 4. Component Stylings

All components are styled with **inline styles only**, using tokens from `useTheme()`. There are no CSS classes, no CSS modules, no Tailwind, no styled-components. Every style property is an explicit JS object key.

### Buttons

Three variants: **primary** (gold fill), **ghost** (transparent, gold border on hover), **danger** (red border/text).

```jsx
// Primary button
const { C, T, space, radius } = useTheme();
<button style={{
  background: C.gold,
  color: C.bg,
  border: 'none',
  borderRadius: radius.sm,       // 2px
  padding: `${space[2]}px ${space[4]}px`,  // 4px 12px
  fontFamily: T.body.fontFamily,
  fontSize: T.body.fontSize,
  fontWeight: 500,
  cursor: 'pointer',
  letterSpacing: 0,
}}>Run Estimation</button>

// Ghost button
<button style={{
  background: 'transparent',
  color: C.textDim,
  border: `1px solid ${C.border2}`,
  borderRadius: radius.sm,
  padding: `${space[2]}px ${space[4]}px`,
  fontFamily: T.body.fontFamily,
  fontSize: T.body.fontSize,
  cursor: 'pointer',
}}>Cancel</button>
```

### Chips (tab-style selectors, variable chips)

Used for estimator selection, SE type selector, variable tags.

```jsx
// Active chip
<span style={{
  background: C.goldFaint,
  color: C.gold,
  border: `1px solid ${C.goldDim}`,
  borderRadius: radius.sm,
  padding: `${space[1]}px ${space[3]}px`,  // 2px 8px
  fontFamily: T.label.fontFamily,
  fontSize: T.label.fontSize,
  fontWeight: T.label.fontWeight,
  letterSpacing: T.label.letterSpacing,
  textTransform: 'uppercase',
  cursor: 'pointer',
}}>OLS</span>

// Inactive chip
<span style={{
  background: 'transparent',
  color: C.textDim,
  border: `1px solid ${C.border}`,
  borderRadius: radius.sm,
  padding: `${space[1]}px ${space[3]}px`,
  fontFamily: T.label.fontFamily,
  fontSize: T.label.fontSize,
  fontWeight: T.label.fontWeight,
  letterSpacing: T.label.letterSpacing,
  textTransform: 'uppercase',
  cursor: 'pointer',
}}>FE</span>
```

### Badges

Small inline labels for step types, column types, model metadata.

```jsx
<span style={{
  background: C.surface2,
  color: C.teal,
  border: `1px solid ${C.border}`,
  borderRadius: radius.sm,
  padding: `1px ${space[2]}px`,   // 1px 4px
  fontFamily: T.label.fontFamily,
  fontSize: '9px',
  fontWeight: 500,
  letterSpacing: '0.15em',
  textTransform: 'uppercase',
}}>numeric</span>
```

For significance stars, use `C.green` (significant) or `C.textMuted` (not).

### Inputs

Text inputs, selects, and number inputs share the same base style.

```jsx
<input style={{
  background: C.surface2,
  color: C.text,
  border: `1px solid ${C.border2}`,
  borderRadius: radius.sm,
  padding: `${space[2]}px ${space[3]}px`,
  fontFamily: T.body.fontFamily,
  fontSize: T.body.fontSize,
  outline: 'none',
  width: '100%',
  // focus state: border color → C.gold (add via onFocus/onBlur handlers)
}}/>
```

Inputs for numeric-only values (e.g., bandwidth, lambda) should use `T.data` (mono) to match the data they receive.

### Cards / Panels

```jsx
<div style={{
  background: C.surface,
  border: `1px solid ${C.border}`,
  borderRadius: radius.md,   // 4px
  padding: `${space[4]}px ${space[5]}px`,  // 12px 16px
}}>
  {/* panel content */}
</div>
```

Nested inner cards (e.g., a result block within a panel) use `C.surface2` and `C.border`:

```jsx
<div style={{
  background: C.surface2,
  border: `1px solid ${C.border}`,
  borderRadius: radius.sm,
  padding: `${space[3]}px`,
}}>
```

### Section Headers / Eyebrow Labels

Module eyebrow labels (above section headers) use `T.label` with teal:

```jsx
<div style={{
  color: C.teal,
  fontFamily: T.label.fontFamily,
  fontSize: T.label.fontSize,
  fontWeight: T.label.fontWeight,
  letterSpacing: T.label.letterSpacing,
  textTransform: 'uppercase',
  marginBottom: space[2],
}}>Spatial Analysis</div>
```

---

## 5. Layout Principles

### 4px Base Grid

All spacing uses the `space` array: `[0, 2, 4, 8, 12, 16, 24, 32, 48]` (indexed 0–8). Every margin, padding, and gap value must come from this array.

| Index | Value | Common use |
|-------|-------|------------|
| `space[1]` | 2px | Tight inline padding (chip vertical) |
| `space[2]` | 4px | Icon gaps, tight row padding |
| `space[3]` | 8px | Default inline padding, chip horizontal |
| `space[4]` | 12px | Section internal padding (tight) |
| `space[5]` | 16px | Default card/panel padding |
| `space[6]` | 24px | Between major sections |
| `space[7]` | 32px | Module-level separation |
| `space[8]` | 48px | Top-level vertical rhythm |

### Density Multiplier

A global density preference (`prefs.density`) scales both spacing and type:
- **Comfortable** (default): multiplier `1×`
- **Compact**: multiplier `0.88×` — applied to all `space[n]` values and font sizes

A minimum font floor (`MIN_FONT = 9px`) prevents any rendered text from dropping below legibility at compact density. When computing a scaled font size, clamp: `Math.max(MIN_FONT, baseSize * densityScale)`.

### Inline Styles Only

There are no CSS classes, no CSS modules, no global stylesheets (beyond a minimal reset), no Tailwind, no CSS-in-JS libraries. Every style is a plain JS object on the element. This is non-negotiable — it ensures that tokens are the single point of truth and that theming (dark/light switching, density scaling) propagates through React state without any CSS variable layer.

### Module Layout Pattern

Each workspace module (Data, Clean, Model, Simulate, etc.) follows this structure:
1. A **tab nav bar** at top — flat, 1px bottom border, tab chips in `T.label`
2. A **main content area** — `flex: 1`, overflow scroll, padded with `space[5]`
3. An optional **sidebar** (right or left) — fixed width, `C.surface`, `1px border`
4. An optional **bottom bar** — flat, 1px top border, for output/action controls

Avoid deeply nested scroll containers. Only one element per module should own the primary scroll axis.

---

## 6. Depth & Elevation

### Elevation Ladder

| Level | Token | Border | Box Shadow | Use |
|-------|-------|--------|------------|-----|
| Flat | `elev.flat` | `1px solid C.border` | `none` | Default — panels, cards, table rows |
| Raised | `elev.raised` | `1px solid C.border2` | faint top-lighter glow | Dropdowns, active panels, focused inputs |
| Popover | `elev.popover` | `1px solid C.border2` | soft 8px shadow | Autocomplete menus, color pickers, small overlays |
| Modal | `elev.modal` | `1px solid C.border2` | medium 24px shadow + dim backdrop | Confirmation dialogs, settings overlays |
| Tooltip | `elev.tooltip` | `1px solid C.border` | 4px shadow | Hover tooltips, info popovers |

### Dark Theme Strategy

On `#080808`, box shadows are nearly invisible — a pure black surface absorbs any dark shadow. On dark, elevation is communicated through **lighter top-borders** (the raised surface appears to catch light from above) and **subtle background lightening** up the surface stack (`C.bg` → `C.surface` → `C.surface2` → `C.surface3`). Reserve actual box-shadow glow for popover/modal level and above.

### Light Theme Strategy

On light, conventional soft box shadows work as expected. Use `rgba(0,0,0,0.08)` for raised, `rgba(0,0,0,0.14)` for popover, `rgba(0,0,0,0.20)` for modal. Border width stays 1px throughout.

### Today's Baseline

Most current surfaces are `elev.flat` (1px border, no shadow). When adding popovers, dropdowns, or modals, step up the ladder. Do not skip levels.

---

## 7. Design Do's and Don'ts

### DO

- **Do** always consume color, type, and spacing tokens via `const { C, T, space, radius, elev } = useTheme()`.
- **Do** use `C.gold` for the active/selected state of any interactive element (tabs, chips, toggles, checkboxes).
- **Do** use `C.teal` for module eyebrow labels, progress indicators, and secondary informational highlights.
- **Do** keep radii sharp — prefer `radius.sm` (2px) for chips/badges/inputs, `radius.md` (4px) for cards/panels.
- **Do** use `T.data` (IBM Plex Mono) for every coefficient, standard error, t-statistic, p-value, and numeric table cell.
- **Do** use `T.code` (IBM Plex Mono) for all replication code, pipeline expressions, and column name references.
- **Do** use `T.label` with `textTransform: 'uppercase'` for section eyebrows and field labels.
- **Do** use the 4px `space` array for every margin, padding, and gap — never use arbitrary pixel values.
- **Do** add new elevation using the `elev` ladder; do not invent custom box-shadow values.
- **Do** check both DARK and LIGHT palettes when adding a new color reference — always use the token, never the hex.
- **Do** apply the density multiplier to new spacing and font-size values so compact/comfortable density respects new components.

### DON'T

- **Don't** hardcode any hex color literals (e.g., `#6ec8b4`, `#c8a96e`). Use `C.teal`, `C.gold`, etc.
- **Don't** hardcode font family names (`"IBM Plex Mono"`, `"Inter"`). Use `T.data.fontFamily`, `T.body.fontFamily`, etc.
- **Don't** hardcode font sizes or weights as bare numbers without a token reference.
- **Don't** use IBM Plex Mono (or any monospace font) for prose, descriptions, tooltips, or any non-numeric, non-code content.
- **Don't** use IBM Plex Sans (or any proportional font) for coefficients, statistics, data table cells, or code.
- **Don't** install or import any external UI component library (MUI, Chakra, Radix, Ant, Shadcn, etc.).
- **Don't** add CSS classes, Tailwind utilities, CSS modules, or styled-components. Inline styles only.
- **Don't** use border-radius values above 6px — no pill shapes, no fully rounded buttons.
- **Don't** use gradients for UI chrome or decorative purposes.
- **Don't** use color for decoration — every color use must have a semantic role (active state, error, significance, data series, etc.).
- **Don't** place `useState` or other hooks inside conditionals or IIFEs — this will crash React.
- **Don't** import React or any UI code inside `src/math/` or `src/core/` — those are pure JS computation modules.

---

## 8. Responsive Behavior

EconSolver targets desktop research environments (1280px+ wide). Mobile layouts are not a current goal, but the following responsive behaviors are in place:

### Plot Responsiveness

All `PlotBuilder` charts and spatial plots use a `ResizeObserver` on their container div to re-render when the container width changes. Never hardcode chart `width` or `height` — always derive from the observed container dimensions.

### Panel Reflow

When the viewport narrows, sidebar panels collapse to icons or are hidden behind toggles. The main content area takes `flex: 1` and fills the remaining space. Avoid fixed-width main content columns.

### Virtualized Tables

The data explorer and wrangling views render a **virtualized table** — only 200–500 rows are in the DOM at any time regardless of dataset size. The dataset itself (up to 900k+ rows) lives in DuckDB-Wasm. Never materialize the full dataset as a JS array for display purposes.

### Font Floor at Compact Density

When `prefs.density === 'compact'`, all font sizes scale by `0.88×`. A hard floor of `MIN_FONT = 9px` is enforced: `Math.max(9, scaledSize)`. Apply this clamp in any new component that reads `T.*` sizes and scales them by density.

### Minimum Viewport Assumption

The application assumes at least 1024px viewport width. At narrower widths, the layout may compress but is not designed to reflow to a stacked mobile layout. No media queries are needed — density scaling and ResizeObserver handle the in-app responsive behavior.

---

## 9. Agent Prompt Guide

> **For AI coding agents generating EconSolver UI code — read this section first.**

You are generating React + JavaScript UI code for EconSolver, a dark-first econometrics research platform. Follow these rules precisely:

**1. Read the token source before writing any style.**
The design token file is `src/theme.js`. It exports `DARK` and `LIGHT` color objects, a `T` typography scale, a `space` array, `radius` constants, and an `elev` elevation ladder. The theme context is in `src/ThemeContext.jsx` and exported as `useTheme()`.

**2. Always destructure tokens at the top of your component.**
```js
const { C, T, space, radius, elev } = useTheme();
```
Never reference a hex value, font name, pixel size, or border-radius directly in JSX style props.

**3. Sans for chrome, mono for data — no exceptions.**
- Any text that is not a number, coefficient, statistic, or code snippet → `T.body`, `T.label`, `T.h1`–`T.h3`, `T.caption`, or `T.display` (all IBM Plex Sans).
- Any number, coefficient, p-value, t-stat, SE, regression table cell, or code snippet → `T.data` or `T.code` (both IBM Plex Mono).
- Mixing these families in the wrong context is a design error.

**4. Keep radii sharp.**
Use `radius.sm` (2px) for inputs, chips, and badges. Use `radius.md` (4px) for cards and panels. Never exceed `radius.lg` (6px). Never use pill shapes (`borderRadius: 9999`).

**5. Use the space array for all spacing.**
`space = [0, 2, 4, 8, 12, 16, 24, 32, 48]`. Index into it: `space[3]` = 8px, `space[5]` = 16px. Never write `padding: '10px'` or `margin: '15px'`.

**6. Gold is the primary accent, teal is secondary.**
Active/selected states use `C.gold` and `C.goldFaint` background. Module eyebrow labels and informational indicators use `C.teal`. Green/red are reserved for statistical significance and errors.

**7. Inline styles only — no classes, no frameworks.**
Every style property goes in a JS object literal on the element: `style={{ color: C.text, fontSize: T.body.fontSize }}`. No Tailwind, no CSS modules, no MUI, no Radix, no styled-components.

**8. No imports from React or UI code inside `src/math/` or `src/core/`.**
Those directories contain pure JS computation modules. They must remain framework-free.

**9. Respect the dark-first, data-forward aesthetic.**
The interface should feel like a precision instrument, not a consumer app. Avoid decorative elements — every visual decision should earn its place by communicating structure, hierarchy, or semantic meaning. When in doubt, add less.

**10. Check both dark and light palette tokens.**
The `C` object returned by `useTheme()` already reflects the active theme — you do not need to branch on dark/light in your component code. Just use `C.*` tokens and theming is automatic.

---

*This document covers the design system as of June 2026. Update it when tokens change in `src/theme.js`.*
