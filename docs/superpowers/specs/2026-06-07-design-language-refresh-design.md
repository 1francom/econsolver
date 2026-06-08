# Design Language Refresh (Workstream A)

**Date:** 2026-06-07
**Status:** OPEN
**Workstream:** A of a four-part UI upgrade (A design language · B cross-module activity+stop · C opt-in AI-coach mascot · D guided-tour spotlight). This spec covers **A only**. B/C/D are deferred to their own spec→plan→build cycles.

## Problem

EconSolver's UI is coherent and "researcher-serious" (dark `#080808`, teal/gold accents, IBM Plex Mono) but lacks a *system*, which keeps it from feeling "next level":

1. **No type/space/elevation tokens.** `theme.js` defines `DARK`/`LIGHT` **color** palettes only. Font sizes (`9px`…), `mono`, letter-spacing, radii, and spacing are hardcoded inline literals scattered across components. Hierarchy is flat — everything is mono at small sizes.
2. **Token drift.** ~10+ files hardcode `#080808`/`#6ec8b4`/`#c8a96e` instead of consuming `useTheme().C`, so the **light theme is visually broken** in those spots and the look drifts.
3. **No user-facing appearance control** beyond the existing day/night toggle.
4. **No DESIGN.md.** The AI agent has no plain-text design document to read, so AI-generated UI has no consistency anchor.

## Goal

Extend the **existing, working** theme architecture (`theme.js` + `ThemeContext.jsx`) into a full design-token system; introduce a sans/mono typographic pairing; expose a user appearance config panel; clean up the worst drift; and author a custom `DESIGN.md` so the AI keeps new UI consistent.

## Non-goals (explicitly deferred)

- Accent-color customization (multiplies token combinations — later).
- Workstreams B, C, D.
- Migrating *every* deep-corner hardcoded file in one pass (incremental).
- Any CSS framework or CSS-variable migration (keeps CLAUDE.md inline-styles invariant).

## Decisions taken (during brainstorming)

- **Identity preserved, not replaced** (Option 1). Dark/teal/gold + mono stays the brand; we add the missing system. Brand DESIGN.md files in the GitHub repo are a *format/quality reference only* — we author EconSolver's own, we do not copy one in.
- **Typography = sans + mono pairing** (Option B). Sans for chrome/prose; **mono reserved strictly for data/numbers/code**. Default pairing **IBM Plex Sans + IBM Plex Mono** (same superfamily).
- **Architecture = extend `ThemeContext`** (Approach 1), not a separate prefs store and not CSS variables.
- **Drift cleanup = incremental**, high-traffic surfaces first.
- **Config v1 scope = Text (font + density) + Visualization (plot palette) + keep day/night.** No accent customization.
- **Settings entry point = gear icon in `WorkspaceBar`** (next to existing day/night toggle).
- **Sans options = IBM Plex Sans + Inter + Geist.**

## Architecture

### 1. Token model — extend `src/theme.js`

`theme.js` grows from colors-only to four token groups. `DARK`/`LIGHT` color objects (now `C`) are **unchanged**. New, theme-agnostic token objects are added (or theme-split only where a token must differ between dark/light — e.g. `elev` shadow opacity):

- **`C` — Colors.** Existing `DARK`/`LIGHT`. Untouched.
- **`T` — Typography.** Font families + a role scale. Each role = `{ fontFamily, fontSize, fontWeight, letterSpacing, lineHeight }`:

  | Role | Family | Size | Notes |
  |------|--------|------|-------|
  | `display` | sans | 28px | empty states, onboarding |
  | `h1` | sans | 20px | page/module title |
  | `h2` | sans | 15px | section headers |
  | `h3` | sans | 13px | subsections |
  | `body` | sans | 13px | prose, descriptions, tooltips |
  | `label` | sans | 10px / 0.2em uppercase | the existing tracked caps labels |
  | `data` | **mono** | 13px, `fontVariantNumeric: "tabular-nums"` | coefficients, tables, numbers |
  | `code` | **mono** | 12px | replication code, expressions |
  | `caption` | sans | 10px | hints, secondary meta |

- **`space`** — 4px-base scale, array-indexed: `[0,2,4,8,12,16,24,32,48]`.
- **`radius`** — kept sharp: `{ none:0, sm:2, md:4, lg:6 }` (default stays `2`).
- **`elev`** — depth ladder (today: all flat 1px borders): `flat` (border only), `raised` (cards), `popover`, `modal`, `tooltip`. Each = a `{ border, boxShadow }` combo tuned per theme — on `#080808`, shadows are near-invisible so dark elevation leans on a lighter top-border + faint glow; light theme uses conventional soft shadows.

### 2. Context — extend `src/ThemeContext.jsx` (no rename)

`useTheme()` keeps `{ C, theme, setTheme }` and gains `{ T, space, radius, elev, prefs, setPrefs }`.

Internally the provider merges, in order: **defaults → theme → user prefs → density multiplier**, producing final token objects. Density (`compact`↔`comfortable`) is a global multiplier applied to `T` sizes and `space`. `sansFont` pref swaps the `fontFamily` of every sans role. Consumers just read `T.h2`, `space[3]`, `elev.popover` — they never need to know prefs exist.

### 3. Preferences persistence

One new localStorage key `econ_prefs` (alongside existing `econ_theme`):
```json
{ "sansFont": "IBM Plex Sans", "density": "comfortable", "plotPalette": "teal-gold" }
```
Read once on load, written on every `setPrefs`. Device prefs, not project data → localStorage (not IndexedDB), matching the existing theme key pattern.

### 4. Config panel — `src/components/workspace/AppearancePanel.jsx`

Opened from a **gear icon in `WorkspaceBar`** (next to the day/night toggle). Sections:
1. **Theme** — day/night toggle (re-homed here; toolbar toggle may remain too).
2. **Text** — `sansFont` dropdown (IBM Plex Sans / Inter / Geist) + `density` segmented control (Compact / Comfortable), with a live preview line rendering display/body/data roles.
3. **Visualization** — `plotPalette` picker (named palettes: `teal-gold` default + 2 alts) with swatch preview. PlotBuilder / ModelPlots read their default palette from `prefs.plotPalette`.
4. **Reset to defaults** button.

Fonts load via CDN `<link>` (Google Fonts), injected **only** when a non-default `sansFont` is chosen; IBM Plex Sans + IBM Plex Mono are the always-loaded baseline.

### 5. Drift cleanup (incremental, prioritized)

Migrate hardcoded `#080808`/`#6ec8b4`/`#c8a96e` + inline font/size literals to `useTheme()` tokens. Surgical Edits, browser-validated per file. Unmigrated files keep working (they just don't theme). Priority order:

1. **High-traffic chrome first:** `WranglingModule.jsx` header, `App.jsx`, `WorkspaceBar.jsx`, `resultDisplay.jsx`, `ModelComparison.jsx`.
2. **Then:** spatial map/plot files, `EstimatorSidebar.jsx`, parked components.

### 6. The DESIGN.md deliverable

Author a custom **`DESIGN.md` at project root** in the awesome-design-md 9-section format — Visual Theme & Atmosphere, Color Palette & Roles, Typography Rules, Component Stylings, Layout Principles, Depth & Elevation, Do's/Don'ts, Responsive Behavior, Agent Prompt Guide — encoding EconSolver's refined system (the tokens above, sans/mono split, sharp radii, elevation ladder). This is what the AI reads to keep new UI consistent. We do **not** copy a brand file in.

## Components / units (each independently understandable)

| Unit | Responsibility | Depends on |
|------|----------------|-----------|
| `theme.js` (extended) | Pure token data: `C`, `T`, `space`, `radius`, `elev` + density math | nothing (no React) |
| `ThemeContext.jsx` (extended) | Merge defaults→theme→prefs→density; expose hook; persist `econ_prefs` | `theme.js`, localStorage |
| `workspace/AppearancePanel.jsx` (new) | UI to read/write `prefs` + `theme` | `useTheme()` |
| `WorkspaceBar.jsx` (edit) | Gear affordance opens the panel | `AppearancePanel` |
| migrated components | Consume tokens instead of literals | `useTheme()` |
| `DESIGN.md` (new) | Plain-text design doc for the AI | — (documentation) |

## Testing / validation

- Manual browser pass in **both** dark + light, at **both** densities, with **each** sans font — checking migrated surfaces render correctly and `data` roles stay mono+tabular.
- Confirm CLAUDE.md invariants intact: inline styles only, `C`/token objects, no UI framework, zero React in math files (untouched).
- Confirm `econ_prefs` persists across reload and "Reset to defaults" restores baseline.
- No automated visual tests (matches validate-in-browser cadence).

## Risks

- **Font swap reflow:** changing `sansFont` re-flows the UI; live preview mitigates surprise. Baseline Plex fonts always loaded to avoid FOUT on first paint.
- **Partial drift state:** during incremental migration, unmigrated files won't theme. Acceptable — nothing breaks; prioritization keeps the most-seen surfaces correct first.
- **Density multiplier edge cases:** very small `label`/`caption` roles at compact density could become unreadable — clamp minimum sizes.
