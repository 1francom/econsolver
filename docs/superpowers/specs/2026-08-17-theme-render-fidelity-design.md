# Theme & render-fidelity upgrade — design

**Date:** 2026-08-17
**Status:** DONE (browser validation pending Franco)
**Scope agreed with Franco:** "Núcleo — render + tokens + bugs". Warm palette axis
retained, with the architecture opened up for a future cool (Slate/Zinc) axis.

---

## 1. Premise correction

The brief this started from assumed the app had no theme system and asked for one
to be built (locate `ThemeContext`, introduce tokens, add font switching, add
density). **All of that already existed** and was mature:

- `src/theme.js` + `src/ThemeContext.jsx` with `C` / `T` / `space` / `radius` / `elev`
- 104 components consuming `useTheme()`; zero importing a static palette
- Sans switching (Plex Sans / Inter / Geist), compact/comfortable density with a
  9px floor, a split dark/light elevation ladder, `AppearancePanel` with a live preview
- A 500-line `DESIGN.md` documenting the whole system
- CSP already allowing `fonts.googleapis.com` + `fonts.gstatic.com` for `<link>` loads

So the "vibecoded" impression was **not** an architecture gap. It came from a set of
specific rendering defects and token-sync failures, which is what this change fixes.

Also verified, so it is not re-investigated: Geist, Inter, Plus Jakarta Sans and
JetBrains Mono all resolve on Google Fonts (HTTP 200). Geist was never broken.

## 2. What actually caused it

| # | Defect | Why it read as unpolished |
|---|--------|---------------------------|
| 1 | `index.css` was 2 lines — no font smoothing at all | Chrome/Safari default to subpixel AA, which thickens and colour-fringes light text on a near-black ground. Highest-impact single fix in the change. |
| 2 | Fonts injected by JS after React mount; no `preconnect` | Every cold load painted in `system-ui`, then reflowed. The flash reads as unfinished. |
| 3 | `ELEV_DARK`/`ELEV_LIGHT` hardcoded border hexes duplicating the palette | Refining a palette silently desynced every border. `#2e2e2e` (modal/tooltip) was not even a token. |
| 4 | `EstimatorSidebar` hardcoded 19 DARK hexes as estimator group colours | They stayed dark-palette in light mode: `#7ab896` on `#ffffff` ≈ 2.4:1, failing WCAG. |
| 5 | `ModelingTab` + `didPlots` used `#e05c5c`, a red in neither palette (11 sites) | Off-palette, and pinned to dark values in light mode. |
| 6 | No `shape-rendering` anywhere | 1px axis rules and gridlines landed on half-pixels and smeared into 2px grey bands — plots read soft next to crisp UI chrome. |
| 7 | `patchDarkTheme()` wrote dark greys as literals | On light it painted `#9a9a9a` legend text onto white and near-black axis rules. Correct for exactly one of the two themes. |
| 8 | Exported SVG/PNG could not see the page's font stylesheet | A serialized SVG in a blob URL is an isolated document: the family *name* survives, the font *file* does not. Every exported figure used a fallback typeface — for a tool selling publication-ready output. |
| 9 | Mono was hardcoded, not switchable | In a tool whose entire output is numeric, the mono choice matters more than the sans one. |
| 10 | `PrivacyConfigPanel` carried its OWN local `C` (a VS Code Dark+ palette) shadowing the themed one | A visually foreign, permanently-dark surface. Latent — the panel is mounted nowhere. |

### Palette defects (real, not taste)
- `C.bg #080808` was too black: halation against light text on OLED, and only 7
  units of headroom for the whole surface ladder.
- `C.textMuted #444` on surface ≈ 2.1:1 — used for hints and labels, not decoration.
  Light-mode `#999` on white ≈ 2.8:1, same problem.
- **Light mode had inverted depth**: `bg #f4f3f0` > `surface2 #f0eeeb`, so a panel
  nested inside a card appeared to sink *below* the app background.

## 3. Deliberate divergence from the brief

The brief asked for a Slate/Zinc rebase. Rejected for now, at Franco's direction:
`DESIGN.md` commits to a **warm** axis (gold + teal on warm near-black), and cool
greys make gold read muddy. Instead:

- The warm axis is kept and its real defects fixed.
- The palette became a **registry** (`PALETTES`), and elevation is now **derived**
  from the active palette via `buildElevation(C, theme)`. Adding a Slate/Zinc axis
  later is one entry in `PALETTES` — it inherits a correct elevation ladder,
  scrollbar chrome, focus ring and `AppearancePanel` row for free.

## 4. Retro-compatibility rule

104 components read `C.*` / `T.*` **by key**. Therefore:

- Changing a palette **value** is safe. Changing or removing a **key** is not.
- Everything here is additive: `C.border3`, `RADIUS.xl`, `prefs.monoFont`,
  `MONO_STACKS`, `PALETTES`, `buildElevation`, `getPalette`, `isDarkTheme`.
- `MONO_STACK`, `ELEV_DARK`, `ELEV_LIGHT`, `SANS_STACK`, `TYPE_ROLES`,
  `PLOT_PALETTES`, `buildTokens` all keep their names and shapes. `ELEV_*` are now
  derived rather than literal, with identical structure.
- **Removed on purpose:** the `DARK as C` and static `mono` exports from both
  `shared.jsx` files and `spatial/shared/constants.js`. Nothing imported them
  (verified), and they were snapshots — any consumer would have silently ignored
  the active theme and the user's font choice.

## 5. The lesson this change re-proves

**A hex literal that duplicates a palette value is a latent bug with a delay
fuse.** Refining the palette immediately broke three separate places that had
copied its values:

1. `JOURNAL_MAP` / `PRESENTATION_MAP` in `plotExporter.js` — string-replace maps
   keyed on old hexes. Journal export would have silently produced a
   dark-background figure instead of a white one.
2. `ModelPlots` / `ResidualPlots` / `resultDisplay` — three private copies of two
   regexes stripping the background rect by `fill="#080808"`. All three stopped
   matching, so every exported SVG would have kept its dark ground. Now
   centralised as `stripGroundRect()`, palette-derived, covering current + legacy.
3. The elevation ladder itself (defect 3 above).

Same shape as the condition-language dialect problem already recorded in
CLAUDE.md: **the fix is single ownership plus derivation, not a careful re-sync.**
Each of these was found by changing the palette and asking what else knew those
values — not by reading the files.

## 6. Non-goals / boundaries held

- **No file under `src/math/` or `src/core/` was touched.** Project invariant:
  those are pure JS with no React.
- **PlotBuilder work was strictly presentational.** `centredBinThresholds`, the
  bar zero-domain clamp, facet stat re-runs and every scale/threshold path
  documented as bug-fixed in CLAUDE.md were left alone. Changes were limited to
  `shape-rendering` (via CSS), font tokens, palette colours, and adding `C`/`T` to
  a dependency array.
- Radius normalisation (621 `borderRadius: <literal>` sites) was explicitly
  deferred — Franco chose the núcleo scope over the mechanical sweep.

## 7. Follow-ups not done

1. **621 `borderRadius` literals** bypass `radius` tokens; adjacent elements sit at
   2/3/4/6px. The biggest remaining contributor to "assembled rather than designed".
2. **`GeoPlotCanvas` renders in `fontFamily: "serif"`** (lines 340, 397) — neither
   the sans nor the mono of a system whose split is documented as absolute. Left
   alone because it looks deliberate for a map surface; worth a decision.
3. `DEFAULT_FILLS` and a local `pal` in `PlotBuilder` duplicate
   `PLOT_PALETTES["teal-gold"]` in three places.
4. `resolveExportBg` reads a computed background off the live element. Not
   exercised for the `presentation` preset in a light theme.
5. Slate/Zinc axis, whenever wanted: one `PALETTES` entry.
