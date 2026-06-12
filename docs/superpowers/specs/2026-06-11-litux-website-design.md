# Litux Website — Design Spec

**Date:** 2026-06-11
**Status:** OPEN (design approved by Franco in brainstorming session; implementation not started)
**Scope:** The central marketing + documentation website for Litux — the equivalent of r-project.org / python.org / stata.com for this product. NOT the app itself.

---

## 1. Purpose & context

Litux (the product currently developed in this repo, a.k.a. Econ Studio / EconSolver) needs a public home:

- Distribution hub: open-in-browser, download desktop builds (future), try-without-account.
- First-contact marketing for the three target audiences: thesis students, PhD students / researchers, policy analysts (LMU Munich + affiliated think tanks; institutional licensing GTM).
- Learning surface: getting-started guide + thematic video library + extensive written documentation.

This was already foreseen in the distribution roadmap ("landing page: open in browser vs download the app" — see memory `project_distribution_multimodule_vision`). This spec makes it concrete.

**Explicit non-goals (this spec):**
- No change to the app itself.
- No desktop build (Tauri stays parked; see §8 Downloads for how the site handles that).
- No i18n at launch (see §9).
- No auth/registration redesign — the site links to the existing app flows.

---

## 2. Identity

### 2.1 Visual direction — "modern tech, in motion" (direction C)

- Dark, refined background `#0a0c10` (deeper/bluer than the app's `#080808`), generous spacing.
- Accent colors inherited from the app: teal `#6ec8b4`, gold `#c8a96e` (+ blue `#6e9ec8` sparingly). These are the brand thread between site and app.
- Typography: modern sans for headlines/UI copy; **IBM Plex Mono only for data, numbers and code** (mirroring the app's usage).
- Motion is a core design element: hero pixel-materialization, scroll-driven module tour, subtle 3D grid backdrop. Style reference: Linear / Vercel-class landing pages, but with Litux's own palette.
- Rejected alternatives (recorded for posterity): (A) full continuity with the app's dark-mono look — reads "hacker tool" to institutional buyers; (B) light editorial/academic (Posit/tidyverse style) — incompatible with the motion/3D requirement and clashes with the dark app on open.

### 2.2 Logo

- **Decision (provisional): hexagon badge containing the L-axis mark** — an L drawn as a Y/X coordinate axis with a small regression flourish, inside a hexagon outline (R-package-sticker aesthetic, instantly familiar to the academic audience). Teal hexagon, white axis, gold accent point.
- Marked "por ahora" by Franco — revisit before launch.
- Explored and parked: Greek wordmark (λίτυξ — kept as possible future easter egg, NOT in footer), histogram-letters wordmark, scatter-plot wordmark (axes = L, "itux" in dots; rejected after dense-dot iteration).
- Replaces the current Vercel default favicon. Deliverables when implemented: SVG mark, favicon set, app icon (future desktop), social/OG image.

### 2.3 Language

- **English only at launch.** Future intention: translate the site AND the entire program to multiple languages — so all site copy lives in content files separated from layout/components from day one (translation later = add files, not rewrite components).

---

## 3. Site map

```
/            Home (landing)
/start       Getting started (short happy-path video + written walkthrough)
/videos      Video library (thematic, filterable by module)
/docs        Written documentation (extensive, per module)
/download    Downloads (coming-soon state at launch)
```

Fixed nav on every page: hexagon logo + Litux · Getting started · Videos · Docs · Download · **[Open in browser]** (primary CTA button, always visible).

---

## 4. Home page — 6 sections

### 4.1 Nav (fixed)
As above. Compact, dark, blends with hero.

### 4.2 Hero (animated)

- **Headline:** "Welcome to Litux" — "Litux" in teal.
- **Entrance animation ("Glitzern" effect), ~3 s total — approved via live mockup:**
  - The phrase materializes as a mosaic of small pixels appearing **from the outer edges inward** (reveal time per pixel ∝ distance from center, plus per-pixel random jitter).
  - While a pixel "loads" it flickers (glitter) before settling; "Litux" pixels are teal, the rest near-white.
  - Sparse pixel "dust" appears and dies around the text during loading (transmission-noise feel).
  - **At ~3 s: 600 ms crossfade from the pixel mosaic to the real, anti-aliased text — final text must be perfectly smooth, no visible pixels.** In production: canvas particle layer crossfades into the actual HTML heading element (accessibility + SEO; the text exists in the DOM throughout, visually revealed at the end).
  - Tagline fades in after the mosaic completes; CTAs fade in ~0.4 s later (one focal point at a time).
- **Tagline, two levels (approved):**
  1. Punchy: *"Econometrics, without the syntax."*
  2. Descriptive: *"A statistical software for economic analysis — no matter your coding skills."*
- **CTAs (hierarchy):** primary `Open in browser` (teal solid) · secondary `Download` (outline) · tertiary text link `try without signing up →` (maps to the current no-account default app flow; registration only adds E2EE sync).
- Backdrop: slow-moving 3D-perspective grid (teal-tinted, low opacity) + a few floating accent dots.

### 4.3 Module tour → demo video (one narrative block)

- Scroll-driven tour: Data → Clean → Explore → Model → Spatial → Report, each step entering with its screenshot/micro-animation as the user scrolls (Linear-style).
- The tour's final "stop" is the **~90 s demo video**: "or watch it all at once" — the scroll animation hands off to the video player. The video shows raw CSV → publication-ready regression table without writing code.
- The trust bar that an earlier draft had ("validated against R…", logos) was **cut**; its strongest claims are absorbed into sections 4.4/4.5 and the docs.

### 4.4 Data transparency (honest reframe — NOT absolutist "privacy-first")

Rationale: the absolute claim "your data never leaves your browser" is false once the AI coach is used (filtered context does go to Anthropic). The honest, precise claim is stronger and audit-proof for a GDPR-minded audience:

- All computation runs in your browser (DuckDB-WASM + validated engines). Raw data is never uploaded to any server.
- AI features are **optional**. When enabled, only filtered context leaves the browser — PII-filtered (`detectPII` → `filterSampleRows`, unconditional), never your dataset.
- **AI off = zero egress.**
- Visual: a diagram of the browser boundary — what stays inside (everything), what crosses only when AI is on (filtered context), what never crosses (raw data).

### 4.5 "One analysis, three scripts" (multi-program replication)

The unique claim, framed offensively: an analysis built in R is not reproducible in Stata or Python — **an analysis built in Litux exports equivalent R, Stata AND Python replication scripts.** Show the same pipeline emitting three script panes. (Replaces the earlier defensive "coming from R/Stata?" comparison section.)

### 4.6 Final CTA + footer

- Repeat the three CTAs.
- Footer is minimal: institutional licensing, contact, links to Getting started / Docs / Download. **No GitHub link, no Greek easter egg.**

---

## 5. Getting started (/start)

- **One short intro video** covering the happy path end-to-end (Franco's cut): load a CSV → one simple cleaning change → a couple of basic plots in Explore → straight to Model → run OLS (or similar) and see the model plot → finish with copying the LaTeX table, or pinning the model and opening Report.
- Below the video: the same walkthrough as written steps with screenshots, for non-video users.
- Ends with pointers: → Videos (thematic deep dives), → Docs (full written guides).
- Depth deliberately lives elsewhere; this page stays short. (The earlier "per-step clips" and "per-persona routes" formats were considered; per-persona routes remain a possible future evolution reusing the same content.)

## 6. Videos (/videos)

- **Thematic library, one video per topic family — NOT one per feature** (the Claude Code feature-video model, but coarser):
  - e.g. the RDD video covers sharp + fuzzy + McCrary in one; the OLS video covers model families, all SE types, and replication code in one pass.
  - Launch set ≈ 6–8: Getting started, OLS (complete), Panel/DiD, RDD, Spatial, Simulate/Calculate, Report/replication. Exact list decided at production time.
- Grid of cards filterable by module chip (All · Data · Clean · Explore · Model · Simulate · Spatial · Report). Each card: thumbnail/play, duration, title, module tag.
- Library grows incrementally without structural changes.

## 7. Docs (/docs)

- The extensive written guide: **sidebar navigation, one page per module**, sections per major capability (per estimator in Model, per operation group in Clean, etc.).
- Each section: what it is / when to use it / assumptions (econometrician's language), step-by-step with screenshots, configuration options, how it is validated against R, what replication script it generates. Cross-links to the related thematic video.
- **Single-source content rule:** written guides are authored once (markdown) and rendered in BOTH places — the site's /docs and inside the program (in-app help). They must never diverge. NOTE: a dedicated in-app-docs spec was not found in the spec index at design time (closest existing artifacts: `HelpSystem.jsx` HintBox/tour, UI-roadmap workstream D); when that work is specced, it must consume this same content source. The future whole-program translation intent (§2.3) applies to this content too.

## 8. Download (/download)

- **Ships at launch in "coming soon" state** (decision A): Windows / Mac buttons visible but disabled-styled, with an email capture — "get notified when the desktop app ships."
- Rationale: site launches now without waiting for Tauri (parked until feature-complete); the email list measures real desktop demand and informs when to unpark Tauri; no nav/hero redesign later.
- The page also offers the two always-available options: Open in browser / try without signing up.

---

## 9. Technical recommendations (decide in plan phase, not binding)

- **Separate repo/project from the app.** The site is content + a few animated islands; coupling it to the app build is unnecessary risk.
- Recommended: **Astro + React islands** (hero canvas animation, scroll tour, video grid as islands; everything else static). Solves docs SEO that a SPA cannot; React islands keep the team's existing React knowledge usable; markdown content collections fit the single-source docs rule and the i18n-later requirement.
- Alternative considered: plain Vite + React SPA (max stack consistency, worse SEO for /docs).
- Hosting: Vercel (consistent with current deployment).
- Copy/content in content files (markdown/JSON), never hardcoded in components (i18n readiness, §2.3).
- Hero animation production notes: canvas particle layer (≈2,000 sampled text pixels, reveal ∝ distance-from-center + jitter, flicker while loading, dust particles) crossfading to the real DOM heading — exactly the technique validated in the conversation mockup.

## 10. Open items / future

- Logo: hexagon L-axis is provisional — final pass before launch (deliverables in §2.2).
- Video production: scripts + recording for the intro video and the launch set of thematic videos (separate effort; UI should be stable first — pre-launch X5 polish pass relates).
- Per-persona getting-started routes (thesis student / coming-from-R / policy analyst) as a future evolution of /start.
- i18n rollout (site first, then program) — future.
- λίτυξ easter egg — parked, currently nowhere.
