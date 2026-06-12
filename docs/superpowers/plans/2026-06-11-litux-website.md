# Litux Website Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the Litux central website (landing + getting started + video library + docs + downloads) per `docs/superpowers/specs/2026-06-11-litux-website-design.md`.

**Architecture:** Separate static site in a NEW repo at `C:\Franco\litux-site` (NOT inside econsolver). Astro 5 static output + Vercel adapter for one serverless endpoint (waitlist). Three React islands carry all interactivity (Glitzern hero, module tour, video filter, waitlist form); everything else is static `.astro`. All copy in `src/config.ts` / content files, never hardcoded in components (i18n-readiness). Dark theme via CSS custom properties in `tokens.css` — no Tailwind, no UI libraries (consistent with Franco's app conventions).

**Tech Stack:** Astro 5, @astrojs/react (React 19 islands), @astrojs/vercel, @astrojs/sitemap, Vitest (pure-logic tests), Supabase REST (waitlist storage, service-role from env, no supabase-js dependency).

**Working directory:** ALL commands below run in `C:\Franco\litux-site` unless stated otherwise. Shell is PowerShell.

**Verification gates per task:** `npm test` (Vitest) where logic exists, `npm run build` always, commit at the end of every task.

---

## File structure (target)

```
litux-site/
├── package.json, astro.config.mjs, tsconfig.json
├── public/
│   └── favicon.svg                  ← hexagon L-axis mark
├── src/
│   ├── config.ts                    ← APP_URL, taglines, contact, all global copy
│   ├── styles/tokens.css            ← design tokens (colors, fonts)
│   ├── components/
│   │   ├── LogoMark.astro           ← hexagon L-axis SVG
│   │   ├── Nav.astro                ← fixed nav
│   │   ├── Footer.astro             ← minimal footer
│   │   ├── GridBackdrop.astro       ← animated 3D-perspective grid
│   │   ├── TransparencySection.astro ← browser-boundary diagram
│   │   ├── ScriptsSection.astro     ← "one analysis, three scripts"
│   │   └── FinalCTA.astro
│   ├── islands/
│   │   ├── glitzern.ts              ← pure timing/hash functions (tested)
│   │   ├── glitzern.test.ts
│   │   ├── GlitzernHero.tsx         ← canvas pixel hero
│   │   ├── ModuleTour.tsx           ← scroll-driven tour
│   │   ├── VideoGrid.tsx            ← filterable video cards
│   │   └── WaitlistForm.tsx
│   ├── data/
│   │   ├── videos.ts                ← video entries + filter fn (tested)
│   │   └── videos.test.ts
│   ├── content/docs/*.md            ← single-source written guides (7 modules)
│   ├── content.config.ts
│   ├── layouts/
│   │   ├── BaseLayout.astro
│   │   └── DocsLayout.astro         ← sidebar layout
│   └── pages/
│       ├── index.astro              ← Home (6 sections)
│       ├── start.astro
│       ├── videos.astro
│       ├── download.astro
│       ├── docs/index.astro
│       ├── docs/[...slug].astro
│       └── api/notify.ts            ← waitlist endpoint (prerender=false)
```

---

### Task 1: Repo scaffold, config, tokens

**Files:**
- Create: `C:\Franco\litux-site\package.json`, `astro.config.mjs`, `tsconfig.json`, `.gitignore`, `src/styles/tokens.css`, `src/config.ts`, `src/env.d.ts`

- [ ] **Step 1: Create repo and install**

```powershell
New-Item -ItemType Directory -Force C:\Franco\litux-site; Set-Location C:\Franco\litux-site; git init -b main
```

`package.json`:

```json
{
  "name": "litux-site",
  "private": true,
  "type": "module",
  "scripts": {
    "dev": "astro dev",
    "build": "astro build",
    "preview": "astro preview",
    "test": "vitest run"
  },
  "dependencies": {
    "astro": "^5.8.0",
    "@astrojs/react": "^4.2.0",
    "@astrojs/sitemap": "^3.3.0",
    "@astrojs/vercel": "^8.1.0",
    "react": "^19.1.0",
    "react-dom": "^19.1.0"
  },
  "devDependencies": {
    "@types/react": "^19.1.0",
    "@types/react-dom": "^19.1.0",
    "typescript": "^5.8.0",
    "vitest": "^3.1.0"
  }
}
```

`.gitignore`:

```
node_modules/
dist/
.astro/
.vercel/
.env
```

Run: `npm install` — expect clean install (lockfile created).

- [ ] **Step 2: Astro + TS config**

`astro.config.mjs`:

```js
import { defineConfig } from 'astro/config';
import react from '@astrojs/react';
import sitemap from '@astrojs/sitemap';
import vercel from '@astrojs/vercel';

export default defineConfig({
  site: 'https://litux.vercel.app',
  integrations: [react(), sitemap()],
  adapter: vercel(),
});
```

(`site` is the initial Vercel URL; swap when a domain is bought.)

`tsconfig.json`:

```json
{
  "extends": "astro/tsconfigs/strict",
  "compilerOptions": {
    "jsx": "react-jsx",
    "jsxImportSource": "react"
  },
  "include": [".astro/types.d.ts", "src/**/*"],
  "exclude": ["dist"]
}
```

`src/env.d.ts`:

```ts
/// <reference types="astro/client" />
interface ImportMetaEnv {
  readonly SUPABASE_URL?: string;
  readonly SUPABASE_SERVICE_ROLE_KEY?: string;
}
```

- [ ] **Step 3: Design tokens + global copy**

`src/styles/tokens.css`:

```css
:root {
  --bg: #0a0c10;
  --bg-raise: #11161c;
  --border: #2a2f38;
  --text: #f2f1ed;
  --text-dim: #8b919c;
  --text-faint: #6b7280;
  --teal: #6ec8b4;
  --teal-dark: #04342c;
  --gold: #c8a96e;
  --blue: #6e9ec8;
  --grid-line: #1d3a34;
  --sans: 'Inter', ui-sans-serif, system-ui, sans-serif;
  --mono: 'IBM Plex Mono', ui-monospace, monospace;
}
* { box-sizing: border-box; }
html { background: var(--bg); color: var(--text); font-family: var(--sans); scroll-behavior: smooth; }
body { margin: 0; line-height: 1.6; }
a { color: inherit; text-decoration: none; }
code, pre { font-family: var(--mono); }
```

`src/config.ts` (ALL global copy lives here — i18n rule from spec §2.3):

```ts
export const SITE_NAME = 'Litux';
export const APP_URL = 'https://econsolver.vercel.app'; // CONFIRM with Franco before launch
export const CONTACT_EMAIL = 'mederofranco21@gmail.com'; // swap for institutional address later
export const HEADLINE_PLAIN = 'Welcome to ';
export const HEADLINE_BRAND = 'Litux';
export const TAGLINE_PUNCHY = 'Econometrics, without the syntax.';
export const TAGLINE_DESC = 'A statistical software for economic analysis — no matter your coding skills.';
export const CTA_BROWSER = 'Open in browser';
export const CTA_DOWNLOAD = 'Download';
export const CTA_TRY = 'try without signing up →';
export const META_DESC = 'Litux is a privacy-conscious statistical software for economic analysis that runs in your browser. Point-and-click econometrics with R, Stata and Python replication scripts.';
```

- [ ] **Step 4: Verify install boots**

Run: `npx astro --version` — expect `astro  v5.x`.

- [ ] **Step 5: Commit**

```powershell
git add -A; git commit -m "chore: scaffold Astro site, tokens, global copy"
```

---

### Task 2: Logo mark + favicon

**Files:**
- Create: `src/components/LogoMark.astro`, `public/favicon.svg`

- [ ] **Step 1: Logo component** (hexagon L-axis per spec §2.2)

`src/components/LogoMark.astro`:

```astro
---
interface Props { size?: number }
const { size = 28 } = Astro.props;
---
<svg width={size} height={size} viewBox="0 0 120 120" aria-hidden="true">
  <path d="M 60 8 L 105 33 L 105 87 L 60 112 L 15 87 L 15 33 Z"
        fill="none" stroke="var(--teal, #6ec8b4)" stroke-width="7" />
  <path d="M 44 34 L 44 82 L 84 82" fill="none" stroke="var(--text, #f2f1ed)"
        stroke-width="9" stroke-linecap="round" />
  <circle cx="74" cy="48" r="7" fill="var(--gold, #c8a96e)" />
</svg>
```

- [ ] **Step 2: Favicon** — `public/favicon.svg`: same SVG, standalone (hardcoded colors, no CSS vars — favicons don't read page CSS):

```svg
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 120 120">
  <path d="M 60 8 L 105 33 L 105 87 L 60 112 L 15 87 L 15 33 Z" fill="#0a0c10" stroke="#6ec8b4" stroke-width="7"/>
  <path d="M 44 34 L 44 82 L 84 82" fill="none" stroke="#f2f1ed" stroke-width="9" stroke-linecap="round"/>
  <circle cx="74" cy="48" r="7" fill="#c8a96e"/>
</svg>
```

- [ ] **Step 3: Commit**

```powershell
git add -A; git commit -m "feat: hexagon L-axis logo mark + favicon"
```

---

### Task 3: BaseLayout, Nav, Footer

**Files:**
- Create: `src/layouts/BaseLayout.astro`, `src/components/Nav.astro`, `src/components/Footer.astro`

- [ ] **Step 1: BaseLayout**

`src/layouts/BaseLayout.astro`:

```astro
---
import '../styles/tokens.css';
import Nav from '../components/Nav.astro';
import Footer from '../components/Footer.astro';
import { SITE_NAME, META_DESC } from '../config';
interface Props { title?: string; description?: string }
const { title, description = META_DESC } = Astro.props;
const fullTitle = title ? `${title} — ${SITE_NAME}` : `${SITE_NAME} — Econometrics, without the syntax`;
---
<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <link rel="icon" type="image/svg+xml" href="/favicon.svg" />
    <link rel="preconnect" href="https://fonts.googleapis.com" />
    <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin />
    <link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600&family=IBM+Plex+Mono:wght@400;500&display=swap" rel="stylesheet" />
    <title>{fullTitle}</title>
    <meta name="description" content={description} />
    <meta property="og:title" content={fullTitle} />
    <meta property="og:description" content={description} />
    <meta property="og:type" content="website" />
  </head>
  <body>
    <Nav />
    <main><slot /></main>
    <Footer />
  </body>
</html>
```

- [ ] **Step 2: Nav** — `src/components/Nav.astro`:

```astro
---
import LogoMark from './LogoMark.astro';
import { SITE_NAME, APP_URL, CTA_BROWSER } from '../config';
const links = [
  { href: '/start', label: 'Getting started' },
  { href: '/videos', label: 'Videos' },
  { href: '/docs', label: 'Docs' },
  { href: '/download', label: 'Download' },
];
---
<header class="nav">
  <a class="brand" href="/"><LogoMark size={26} /><span>{SITE_NAME}</span></a>
  <nav>
    {links.map((l) => <a class="link" href={l.href}>{l.label}</a>)}
    <a class="cta" href={APP_URL}>{CTA_BROWSER}</a>
  </nav>
</header>
<style>
  .nav { position: fixed; top: 0; left: 0; right: 0; z-index: 50; display: flex; justify-content: space-between; align-items: center; padding: 12px 28px; background: color-mix(in srgb, var(--bg) 82%, transparent); backdrop-filter: blur(10px); border-bottom: 1px solid var(--border); }
  .brand { display: flex; align-items: center; gap: 9px; font-weight: 600; font-size: 17px; }
  nav { display: flex; align-items: center; gap: 22px; }
  .link { color: var(--text-dim); font-size: 14px; }
  .link:hover { color: var(--text); }
  .cta { background: var(--teal); color: var(--teal-dark); font-size: 14px; font-weight: 500; padding: 8px 16px; border-radius: 8px; }
</style>
```

- [ ] **Step 3: Footer** — `src/components/Footer.astro` (spec §4.6: minimal — NO GitHub, NO Greek):

```astro
---
import { SITE_NAME, CONTACT_EMAIL } from '../config';
const year = new Date().getFullYear();
---
<footer class="ft">
  <span>© {year} {SITE_NAME}</span>
  <nav>
    <a href="/start">Getting started</a>
    <a href="/docs">Docs</a>
    <a href="/download">Download</a>
    <a href={`mailto:${CONTACT_EMAIL}`}>Institutional licensing &amp; contact</a>
  </nav>
</footer>
<style>
  .ft { display: flex; justify-content: space-between; align-items: center; flex-wrap: wrap; gap: 12px; padding: 28px; border-top: 1px solid var(--border); color: var(--text-faint); font-size: 13px; }
  .ft nav { display: flex; gap: 18px; }
  .ft a:hover { color: var(--text); }
</style>
```

- [ ] **Step 4: Smoke page + build** — create a temporary `src/pages/index.astro`:

```astro
---
import BaseLayout from '../layouts/BaseLayout.astro';
---
<BaseLayout><div style="padding:120px 28px">hero goes here</div></BaseLayout>
```

Run: `npm run build` — expect `Complete!` with 1 page built.

- [ ] **Step 5: Commit**

```powershell
git add -A; git commit -m "feat: base layout, fixed nav, minimal footer"
```

---

### Task 4: Glitzern timing module (TDD)

**Files:**
- Create: `src/islands/glitzern.ts`, Test: `src/islands/glitzern.test.ts`

- [ ] **Step 1: Write the failing test** — `src/islands/glitzern.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { hash, revealTime, BLEND_START_MS, BLEND_END_MS } from './glitzern';

describe('hash', () => {
  it('is deterministic', () => {
    expect(hash(42)).toBe(hash(42));
  });
  it('stays in [0,1)', () => {
    for (let n = 1; n <= 1000; n++) {
      const v = hash(n);
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThan(1);
    }
  });
});

describe('revealTime', () => {
  const cx = 380, cy = 75, dmax = Math.hypot(cx, cy);
  it('edge pixels reveal before center pixels on average (outside-in sweep)', () => {
    let edge = 0, center = 0;
    for (let i = 1; i <= 200; i++) {
      edge += revealTime(0, 0, cx, cy, dmax, i);
      center += revealTime(cx, cy, cx, cy, dmax, i);
    }
    expect(edge / 200).toBeLessThan(center / 200);
  });
  it('always completes before the crossfade starts', () => {
    for (let i = 1; i <= 500; i++) {
      expect(revealTime(cx, cy, cx, cy, dmax, i)).toBeLessThanOrEqual(BLEND_START_MS);
    }
  });
  it('blend window is 600ms ending at 3.6s (spec §4.2)', () => {
    expect(BLEND_START_MS).toBe(3000);
    expect(BLEND_END_MS).toBe(3600);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test`
Expected: FAIL — `Cannot find module './glitzern'` (or equivalent resolve error).

- [ ] **Step 3: Implement** — `src/islands/glitzern.ts`:

```ts
// Pure timing math for the Glitzern hero (spec §4.2).
// Deterministic hash → the animation is identical on every load.
export const BLEND_START_MS = 3000;
export const BLEND_END_MS = 3600;

export function hash(n: number): number {
  const s = Math.sin(n * 12.9898) * 43758.5453;
  return s - Math.floor(s);
}

// Reveal time per pixel: proportional to (1 - distance-from-center),
// so the outermost pixels light up first and the sweep converges inward.
// Max value = 2000 + 800 = 2800ms < BLEND_START_MS.
export function revealTime(x: number, y: number, cx: number, cy: number, dmax: number, i: number): number {
  const d = Math.hypot(x - cx, y - cy) / dmax;
  return (1 - d) * 2000 + hash(i) * 800;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test`
Expected: PASS (5 tests).

- [ ] **Step 5: Commit**

```powershell
git add -A; git commit -m "feat: glitzern reveal-timing math with tests"
```

---

### Task 5: GlitzernHero island

**Files:**
- Create: `src/islands/GlitzernHero.tsx`

- [ ] **Step 1: Implement the island.** Canvas particle layer crossfades into the real DOM `<h1>` (always present for SEO/a11y). Respects `prefers-reduced-motion` (skips straight to text).

`src/islands/GlitzernHero.tsx`:

```tsx
import { useEffect, useRef, useState } from 'react';
import { hash, revealTime, BLEND_START_MS, BLEND_END_MS } from './glitzern';

const W = 760;
const H = 150;
const FONT = '600 56px Inter, ui-sans-serif, sans-serif';

interface Props { plain: string; brand: string }

function paintText(plainColor: string, brandColor: string, plain: string, brand: string): HTMLCanvasElement {
  const c = document.createElement('canvas');
  c.width = W; c.height = H;
  const g = c.getContext('2d')!;
  g.font = FONT;
  g.textBaseline = 'middle';
  const w1 = g.measureText(plain).width;
  const w2 = g.measureText(brand).width;
  const x0 = (W - w1 - w2) / 2;
  g.fillStyle = plainColor; g.fillText(plain, x0, H / 2 + 4);
  g.fillStyle = brandColor; g.fillText(brand, x0 + w1, H / 2 + 4);
  return c;
}

export default function GlitzernHero({ plain, brand }: Props) {
  const ref = useRef<HTMLCanvasElement>(null);
  const [done, setDone] = useState(false);

  useEffect(() => {
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) { setDone(true); return; }
    let raf = 0;
    let cancelled = false;
    // Wait for the webfont so canvas text metrics match the final DOM heading.
    document.fonts.load(FONT).then(() => {
      if (cancelled) return;
      const cv = ref.current;
      if (!cv) { setDone(true); return; }
      const ctx = cv.getContext('2d')!;
      const mask = paintText('#fff', '#0f0', plain, brand);   // #0f0 marks brand pixels in sampling
      const final = paintText('#f2f1ed', '#6ec8b4', plain, brand); // crisp crossfade target
      const img = mask.getContext('2d')!.getImageData(0, 0, W, H).data;
      const cx = W / 2, cy = H / 2, dmax = Math.hypot(cx, cy);
      type P = { x: number; y: number; teal: boolean; t0: number; fl: number };
      const parts: P[] = [];
      let i = 0;
      for (let y = 0; y < H; y += 3) {
        for (let x = 0; x < W; x += 3) {
          const k = (y * W + x) * 4;
          if (img[k + 3] > 120) {
            i++;
            parts.push({
              x, y,
              teal: img[k + 1] > 200 && img[k] < 100,
              t0: revealTime(x, y, cx, cy, dmax, i),
              fl: hash(i + 5e4),
            });
          }
        }
      }
      const dust = Array.from({ length: 110 }, (_, j) => ({
        x: hash(j + 900) * W, y: hash(j + 1800) * H, t0: hash(j + 2700) * 2300, teal: hash(j + 3600) > 0.5,
      }));
      let start = 0;
      const frame = (ts: number) => {
        if (!start) start = ts;
        const t = ts - start;
        ctx.clearRect(0, 0, W, H);
        const blend = t < BLEND_START_MS ? 0 : Math.min(1, (t - BLEND_START_MS) / (BLEND_END_MS - BLEND_START_MS));
        if (blend < 1) {
          for (const s of dust) {
            const age = t - s.t0;
            if (age > 0 && age < 320) {
              ctx.globalAlpha = 0.5 * (1 - age / 320) * (1 - blend);
              ctx.fillStyle = s.teal ? '#6ec8b4' : '#e8e6e0';
              ctx.fillRect(s.x, s.y, 2.4, 2.4);
            }
          }
          for (const p of parts) {
            const age = t - p.t0;
            if (age < 0) continue;
            let a = 1;
            if (age < 260) {
              a = (p.fl > 0.5 ? 0.35 : 0.85) * (age / 260) + 0.35 * Math.abs(Math.sin(age / 30 + p.fl * 9));
              if (a > 1) a = 1;
            }
            ctx.globalAlpha = a * (1 - blend);
            ctx.fillStyle = p.teal ? '#6ec8b4' : '#f2f1ed';
            const sz = age < 260 ? 2.9 : 2.5;
            ctx.fillRect(p.x - sz / 2, p.y - sz / 2, sz, sz);
          }
        }
        if (blend > 0) { ctx.globalAlpha = blend; ctx.drawImage(final, 0, 0); }
        ctx.globalAlpha = 1;
        if (t < BLEND_END_MS + 100) raf = requestAnimationFrame(frame);
        else setDone(true);
      };
      raf = requestAnimationFrame(frame);
    });
    return () => { cancelled = true; cancelAnimationFrame(raf); };
  }, [plain, brand]);

  return (
    <div style={{ position: 'relative', height: H, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
      <h1
        style={{
          position: 'absolute', inset: 0, display: 'flex', alignItems: 'center', justifyContent: 'center',
          margin: 0, font: FONT, color: 'var(--text)', whiteSpace: 'pre',
          opacity: done ? 1 : 0,
        }}
      >
        {plain}
        <span style={{ color: 'var(--teal)' }}>{brand}</span>
      </h1>
      <canvas
        ref={ref} width={W} height={H} aria-hidden="true"
        style={{ maxWidth: '100%', height: 'auto', position: 'relative', opacity: done ? 0 : 1 }}
      />
    </div>
  );
}
```

- [ ] **Step 2: Build check**

Run: `npm run build`
Expected: `Complete!` (island compiles; not yet mounted anywhere — that's Task 6).

- [ ] **Step 3: Commit**

```powershell
git add -A; git commit -m "feat: GlitzernHero canvas island with smooth-text crossfade"
```

---

### Task 6: Home hero section (assemble §4.2)

**Files:**
- Create: `src/components/GridBackdrop.astro`
- Modify: `src/pages/index.astro` (replace smoke content)

- [ ] **Step 1: GridBackdrop** — `src/components/GridBackdrop.astro`:

```astro
<div class="grid3d" aria-hidden="true"></div>
<style>
  .grid3d {
    position: absolute; inset: -20% -10%; opacity: 0.16; pointer-events: none;
    background-image:
      repeating-linear-gradient(0deg, var(--grid-line) 0 1px, transparent 1px 38px),
      repeating-linear-gradient(90deg, var(--grid-line) 0 1px, transparent 1px 38px);
    transform: perspective(600px) rotateX(56deg) translateY(8%) scale(1.6);
    animation: gridslide 28s linear infinite;
  }
  @keyframes gridslide { from { background-position: 0 0, 0 0; } to { background-position: 0 380px, 0 0; } }
  @media (prefers-reduced-motion: reduce) { .grid3d { animation: none; } }
</style>
```

- [ ] **Step 2: Hero in index.astro** — replace `src/pages/index.astro` entirely:

```astro
---
import BaseLayout from '../layouts/BaseLayout.astro';
import GridBackdrop from '../components/GridBackdrop.astro';
import GlitzernHero from '../islands/GlitzernHero';
import {
  APP_URL, HEADLINE_PLAIN, HEADLINE_BRAND,
  TAGLINE_PUNCHY, TAGLINE_DESC, CTA_BROWSER, CTA_DOWNLOAD, CTA_TRY,
} from '../config';
---
<BaseLayout>
  <section class="hero">
    <GridBackdrop />
    <div class="hero-inner">
      <GlitzernHero client:load plain={HEADLINE_PLAIN} brand={HEADLINE_BRAND} />
      <p class="punchy reveal r1">{TAGLINE_PUNCHY}</p>
      <p class="desc reveal r1">{TAGLINE_DESC}</p>
      <div class="ctas reveal r2">
        <a class="primary" href={APP_URL}>{CTA_BROWSER}</a>
        <a class="secondary" href="/download">{CTA_DOWNLOAD}</a>
        <a class="tertiary" href={APP_URL}>{CTA_TRY}</a>
      </div>
    </div>
  </section>
</BaseLayout>
<style>
  .hero { position: relative; overflow: hidden; padding: 150px 28px 110px; text-align: center; }
  .hero-inner { position: relative; max-width: 820px; margin: 0 auto; }
  .punchy { font-size: 22px; font-weight: 500; color: var(--text); margin: 18px 0 6px; }
  .desc { font-size: 15px; color: var(--text-dim); margin: 0; }
  .ctas { display: flex; gap: 12px; justify-content: center; align-items: center; margin-top: 30px; flex-wrap: wrap; }
  .primary { background: var(--teal); color: var(--teal-dark); font-weight: 500; font-size: 14px; padding: 11px 24px; border-radius: 8px; }
  .secondary { border: 1px solid var(--border); color: var(--text); font-size: 14px; padding: 10px 24px; border-radius: 8px; }
  .tertiary { color: var(--text-faint); font-size: 14px; }
  .reveal { opacity: 0; animation: fadeup 0.9s ease forwards; }
  .r1 { animation-delay: 2.9s; }
  .r2 { animation-delay: 3.4s; }
  @keyframes fadeup { from { opacity: 0; transform: translateY(12px); } to { opacity: 1; transform: none; } }
  @media (prefers-reduced-motion: reduce) { .reveal { animation: none; opacity: 1; } }
</style>
```

- [ ] **Step 3: Visual check**

Run: `npm run dev`, open `http://localhost:4321`.
Expected: pixel mosaic assembles outside-in over 3 s, crossfades to smooth text, taglines then CTAs fade in.

- [ ] **Step 4: Build + commit**

Run: `npm run build` — expect `Complete!`.

```powershell
git add -A; git commit -m "feat: home hero — glitzern headline, two-level tagline, CTA hierarchy, 3D grid"
```

---

### Task 7: Module tour → demo video (§4.3)

**Files:**
- Create: `src/islands/ModuleTour.tsx`
- Modify: `src/pages/index.astro` (append section)

- [ ] **Step 1: ModuleTour island.** Scroll-driven reveal via IntersectionObserver. Screenshots are styled placeholders for now (real app screenshots replace the `shot` div content when Franco captures them — swap point marked in code). The tour ends in the demo-video block ("or watch it all at once"), video itself pending production → "coming soon" state.

`src/islands/ModuleTour.tsx`:

```tsx
import { useEffect, useRef } from 'react';

const MODULES = [
  { id: 'data', title: 'Data', blurb: 'Drop a CSV, Excel, Stata or Parquet file — or pull straight from World Bank and OECD APIs.' },
  { id: 'clean', title: 'Clean', blurb: 'A non-destructive pipeline: every step replays on your raw data and exports as code.' },
  { id: 'explore', title: 'Explore', blurb: 'Summaries and a layer-based plot builder — point, line, histogram, density and more.' },
  { id: 'model', title: 'Model', blurb: 'OLS to IV, DiD, RDD, panel FE, synthetic control — validated against R to six decimals.' },
  { id: 'spatial', title: 'Spatial', blurb: 'Buffers, spatial joins, grids and live maps without a GIS license.' },
  { id: 'report', title: 'Report', blurb: 'Publication-ready LaTeX tables and replication scripts in R, Stata and Python.' },
];

export default function ModuleTour() {
  const root = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const els = root.current?.querySelectorAll('.step');
    if (!els) return;
    const io = new IntersectionObserver(
      (entries) => entries.forEach((e) => e.target.classList.toggle('on', e.isIntersecting)),
      { threshold: 0.35 },
    );
    els.forEach((el) => io.observe(el));
    return () => io.disconnect();
  }, []);

  return (
    <div ref={root}>
      {MODULES.map((m, i) => (
        <div className={`step ${i % 2 ? 'flip' : ''}`} key={m.id}>
          <div className="txt">
            <span className="kicker">{String(i + 1).padStart(2, '0')}</span>
            <h3>{m.title}</h3>
            <p>{m.blurb}</p>
          </div>
          {/* SWAP POINT: replace this div with <img src={`/screenshots/${m.id}.png`} … /> when real captures exist */}
          <div className="shot" aria-hidden="true"><span>{m.title}</span></div>
        </div>
      ))}
      <div className="step finale">
        <div className="txt">
          <h3>Or watch it all at once</h3>
          <p>Raw CSV to publication-ready table in 90 seconds.</p>
        </div>
        <div className="shot video"><span>▶ demo video — coming soon</span></div>
      </div>
      <style>{`
        .step { display: flex; gap: 36px; align-items: center; max-width: 920px; margin: 0 auto; padding: 44px 28px;
                opacity: 0; transform: translateY(28px); transition: opacity 0.7s ease, transform 0.7s ease; }
        .step.on { opacity: 1; transform: none; }
        .step.flip { flex-direction: row-reverse; }
        .txt { flex: 1; }
        .kicker { font-family: var(--mono); font-size: 12px; color: var(--gold); }
        .txt h3 { font-size: 24px; font-weight: 600; margin: 6px 0 8px; color: var(--text); }
        .txt p { font-size: 14.5px; color: var(--text-dim); margin: 0; max-width: 380px; }
        .shot { flex: 1.1; min-height: 230px; border: 1px solid var(--border); border-radius: 12px;
                background: var(--bg-raise); display: flex; align-items: center; justify-content: center;
                color: var(--text-faint); font-family: var(--mono); font-size: 13px; }
        .shot.video { border-color: var(--teal); color: var(--teal); }
        @media (max-width: 760px) { .step, .step.flip { flex-direction: column; } .shot { width: 100%; } }
        @media (prefers-reduced-motion: reduce) { .step { opacity: 1; transform: none; transition: none; } }
      `}</style>
    </div>
  );
}
```

- [ ] **Step 2: Mount in index.astro** — append after the hero `</section>`, inside `<BaseLayout>`:

```astro
  <section class="tour">
    <h2>The whole research workflow, one interface</h2>
    <ModuleTour client:visible />
  </section>
```

Add the import at the top of the frontmatter: `import ModuleTour from '../islands/ModuleTour';`
Append to the page `<style>`:

```css
  .tour { padding: 60px 0 30px; }
  .tour h2 { text-align: center; font-size: 28px; font-weight: 600; margin: 0 0 10px; }
```

- [ ] **Step 3: Build + visual check + commit**

Run: `npm run build` — expect `Complete!`. In `npm run dev`, scrolling reveals each module step.

```powershell
git add -A; git commit -m "feat: scroll-driven module tour ending in demo-video slot"
```

---

### Task 8: Transparency + three-scripts + final CTA (§4.4–4.6)

**Files:**
- Create: `src/components/TransparencySection.astro`, `src/components/ScriptsSection.astro`, `src/components/FinalCTA.astro`
- Modify: `src/pages/index.astro`

- [ ] **Step 1: TransparencySection** — honest framing per spec §4.4 (NO "data never leaves your browser" absolutism):

```astro
---
const inside = [
  'All computation — estimation, cleaning, plots',
  'Your raw dataset, stored locally (IndexedDB)',
  'Replication script generation',
];
---
<section class="tr">
  <h2>Where your data lives</h2>
  <div class="cols">
    <div class="box stay">
      <h3>Stays in your browser — always</h3>
      <ul>{inside.map((t) => <li>{t}</li>)}</ul>
    </div>
    <div class="box ai">
      <h3>Leaves only if you turn AI on</h3>
      <p>Optional AI features send <strong>filtered context</strong> to the model provider: column names and PII-filtered samples — never your dataset.</p>
      <p class="zero">AI off = zero egress.</p>
    </div>
  </div>
</section>
<style>
  .tr { padding: 70px 28px; max-width: 920px; margin: 0 auto; }
  .tr h2 { text-align: center; font-size: 28px; font-weight: 600; margin: 0 0 28px; }
  .cols { display: grid; grid-template-columns: repeat(auto-fit, minmax(280px, 1fr)); gap: 16px; }
  .box { border: 1px solid var(--border); border-radius: 12px; padding: 22px 24px; background: var(--bg-raise); }
  .box.stay { border-color: var(--teal); }
  .box h3 { font-size: 16px; font-weight: 600; margin: 0 0 12px; }
  .box.stay h3 { color: var(--teal); }
  .box.ai h3 { color: var(--gold); }
  .box ul { margin: 0; padding-left: 18px; color: var(--text-dim); font-size: 14px; }
  .box li { margin: 6px 0; }
  .box p { color: var(--text-dim); font-size: 14px; margin: 0 0 10px; }
  .zero { font-family: var(--mono); color: var(--teal); }
</style>
```

- [ ] **Step 2: ScriptsSection** — "one analysis, three scripts" (§4.5), same toy pipeline in all three:

```astro
---
const panes = [
  { lang: 'R', code: `df <- read_csv("wages.csv") |>\n  filter(age >= 25)\nm <- feols(log(wage) ~ educ + exper,\n           data = df, vcov = "HC1")\netable(m)` },
  { lang: 'Stata', code: `import delimited "wages.csv", clear\ndrop if age < 25\ngen lwage = log(wage)\nreg lwage educ exper, vce(robust)\nesttab` },
  { lang: 'Python', code: `df = pd.read_csv("wages.csv")\ndf = df.query("age >= 25")\nm = pf.feols("np.log(wage) ~ educ + exper",\n             data=df, vcov="HC1")\nm.summary()` },
];
---
<section class="sc">
  <h2>One analysis, three scripts</h2>
  <p class="lead">An analysis built in R is not reproducible in Stata. An analysis built in Litux exports equivalent replication scripts for <strong>R, Stata and Python</strong> — automatically.</p>
  <div class="panes">
    {panes.map((p) => (
      <div class="pane">
        <span class="lang">{p.lang}</span>
        <pre><code>{p.code}</code></pre>
      </div>
    ))}
  </div>
</section>
<style>
  .sc { padding: 70px 28px; max-width: 1040px; margin: 0 auto; text-align: center; }
  .sc h2 { font-size: 28px; font-weight: 600; margin: 0 0 10px; }
  .lead { color: var(--text-dim); font-size: 15px; max-width: 560px; margin: 0 auto 30px; }
  .panes { display: grid; grid-template-columns: repeat(auto-fit, minmax(260px, 1fr)); gap: 14px; text-align: left; }
  .pane { border: 1px solid var(--border); border-radius: 12px; background: var(--bg-raise); overflow: hidden; }
  .lang { display: block; font-family: var(--mono); font-size: 12px; color: var(--gold); padding: 10px 16px 0; }
  pre { margin: 8px 0 0; padding: 8px 16px 16px; font-size: 12px; line-height: 1.7; color: var(--teal); overflow-x: auto; }
</style>
```

- [ ] **Step 3: FinalCTA** — `src/components/FinalCTA.astro`:

```astro
---
import { APP_URL, CTA_BROWSER, CTA_DOWNLOAD, CTA_TRY, TAGLINE_PUNCHY } from '../config';
---
<section class="fin">
  <h2>{TAGLINE_PUNCHY}</h2>
  <div class="ctas">
    <a class="primary" href={APP_URL}>{CTA_BROWSER}</a>
    <a class="secondary" href="/download">{CTA_DOWNLOAD}</a>
    <a class="tertiary" href={APP_URL}>{CTA_TRY}</a>
  </div>
</section>
<style>
  .fin { padding: 80px 28px 90px; text-align: center; }
  .fin h2 { font-size: 26px; font-weight: 600; margin: 0 0 24px; }
  .ctas { display: flex; gap: 12px; justify-content: center; align-items: center; flex-wrap: wrap; }
  .primary { background: var(--teal); color: var(--teal-dark); font-weight: 500; font-size: 14px; padding: 11px 24px; border-radius: 8px; }
  .secondary { border: 1px solid var(--border); color: var(--text); font-size: 14px; padding: 10px 24px; border-radius: 8px; }
  .tertiary { color: var(--text-faint); font-size: 14px; }
</style>
```

- [ ] **Step 4: Mount all three in index.astro** after the tour section:

```astro
  <TransparencySection />
  <ScriptsSection />
  <FinalCTA />
```

with frontmatter imports:

```astro
import TransparencySection from '../components/TransparencySection.astro';
import ScriptsSection from '../components/ScriptsSection.astro';
import FinalCTA from '../components/FinalCTA.astro';
```

- [ ] **Step 5: Build + commit** — `npm run build` expect `Complete!`; Home now has all 6 sections (nav, hero, tour+video, transparency, scripts, final CTA + footer).

```powershell
git add -A; git commit -m "feat: transparency, one-analysis-three-scripts, final CTA — home complete"
```

---

### Task 9: Getting started page (/start, §5)

**Files:**
- Create: `src/pages/start.astro`

- [ ] **Step 1: Page with video slot + written happy path** (Franco's exact cut: CSV → simple clean → basic plots → Model/OLS → LaTeX table or pin to Report):

```astro
---
import BaseLayout from '../layouts/BaseLayout.astro';
import { APP_URL, CTA_BROWSER } from '../config';
const steps = [
  { t: 'Load your data', d: 'Drag a CSV into the Data tab. Litux detects the delimiter and shows a preview instantly.' },
  { t: 'One quick clean', d: 'In Clean, drop missing values or filter rows — every step is recorded in a replayable pipeline.' },
  { t: 'Look at it', d: 'In Explore, build a histogram and a scatter plot in two clicks.' },
  { t: 'Run your first model', d: 'In Model, pick OLS, choose Y and X, hit Estimate. Read the coefficient table and the model plot.' },
  { t: 'Take the result with you', d: 'Copy the LaTeX table directly — or pin the model and open Report for the full write-up.' },
];
---
<BaseLayout title="Getting started" description="Your first analysis in Litux: load a CSV, clean it, explore it, run OLS and export a publication-ready table — no code.">
  <div class="page">
    <h1>Your first analysis</h1>
    <p class="lead">One short video, start to finish — then the same path written out below.</p>
    <div class="video"><span>▶ intro video — coming soon</span></div>
    <ol class="steps">
      {steps.map((s, i) => (
        <li>
          <span class="n">{i + 1}</span>
          <div><h3>{s.t}</h3><p>{s.d}</p></div>
        </li>
      ))}
    </ol>
    <div class="next">
      <a class="primary" href={APP_URL}>{CTA_BROWSER}</a>
      <a class="link" href="/videos">Thematic videos →</a>
      <a class="link" href="/docs">Full documentation →</a>
    </div>
  </div>
</BaseLayout>
<style>
  .page { max-width: 760px; margin: 0 auto; padding: 130px 28px 90px; }
  h1 { font-size: 34px; font-weight: 600; margin: 0 0 8px; }
  .lead { color: var(--text-dim); margin: 0 0 26px; }
  .video { min-height: 320px; border: 1px solid var(--teal); border-radius: 12px; background: var(--bg-raise);
           display: flex; align-items: center; justify-content: center; color: var(--teal); font-family: var(--mono); font-size: 14px; }
  .steps { list-style: none; padding: 0; margin: 40px 0 0; }
  .steps li { display: flex; gap: 16px; padding: 18px 0; border-bottom: 1px solid var(--border); }
  .n { min-width: 28px; height: 28px; border-radius: 50%; background: var(--bg-raise); border: 1px solid var(--teal);
       color: var(--teal); font-size: 13px; display: flex; align-items: center; justify-content: center; }
  .steps h3 { font-size: 16px; font-weight: 600; margin: 2px 0 4px; }
  .steps p { font-size: 14px; color: var(--text-dim); margin: 0; }
  .next { display: flex; gap: 18px; align-items: center; margin-top: 36px; flex-wrap: wrap; }
  .primary { background: var(--teal); color: var(--teal-dark); font-weight: 500; font-size: 14px; padding: 10px 22px; border-radius: 8px; }
  .link { color: var(--text-dim); font-size: 14px; }
</style>
```

- [ ] **Step 2: Build + commit**

Run: `npm run build` — expect `Complete!`.

```powershell
git add -A; git commit -m "feat: getting-started page — happy-path video slot + written walkthrough"
```

---

### Task 10: Video library (/videos, §6) — TDD on filter logic

**Files:**
- Create: `src/data/videos.ts`, `src/islands/VideoGrid.tsx`, `src/pages/videos.astro`
- Test: `src/data/videos.test.ts`

- [ ] **Step 1: Write the failing test** — `src/data/videos.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { VIDEOS, filterVideos, MODULES } from './videos';

describe('video library data', () => {
  it('ships the launch set of thematic videos (spec §6: ~6-8)', () => {
    expect(VIDEOS.length).toBeGreaterThanOrEqual(6);
    expect(VIDEOS.length).toBeLessThanOrEqual(8);
  });
  it('every video belongs to a known module', () => {
    for (const v of VIDEOS) expect(MODULES).toContain(v.module);
  });
});

describe('filterVideos', () => {
  it('returns everything for "all"', () => {
    expect(filterVideos(VIDEOS, 'all')).toHaveLength(VIDEOS.length);
  });
  it('returns only matching module', () => {
    const model = filterVideos(VIDEOS, 'model');
    expect(model.length).toBeGreaterThan(0);
    for (const v of model) expect(v.module).toBe('model');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test`
Expected: FAIL — cannot resolve `./videos`.

- [ ] **Step 3: Implement** — `src/data/videos.ts`. Thematic videos per Franco's rule: one video per topic FAMILY (RDD video covers sharp+fuzzy+McCrary; OLS covers families+SEs+replication), all `status: 'soon'` until produced:

```ts
export const MODULES = ['data', 'clean', 'explore', 'model', 'simulate', 'spatial', 'report'] as const;
export type Module = (typeof MODULES)[number];

export interface Video {
  slug: string;
  title: string;
  module: Module;
  minutes: number;
  blurb: string;
  status: 'soon' | 'live';
  youtubeId?: string; // set when produced; card becomes playable
}

export const VIDEOS: Video[] = [
  { slug: 'getting-started', title: 'Getting started with Litux', module: 'data', minutes: 5, blurb: 'CSV to publication-ready table, end to end.', status: 'soon' },
  { slug: 'cleaning-pipeline', title: 'The cleaning pipeline', module: 'clean', minutes: 8, blurb: 'Non-destructive steps, merges, reshape, and the AI command bar.', status: 'soon' },
  { slug: 'ols-complete', title: 'OLS, completely', module: 'model', minutes: 12, blurb: 'Model families, every standard-error type, diagnostics, replication code.', status: 'soon' },
  { slug: 'panel-did', title: 'Panel & DiD', module: 'model', minutes: 12, blurb: 'Fixed effects, TWFE, event studies, staggered adoption.', status: 'soon' },
  { slug: 'rdd-complete', title: 'Regression discontinuity', module: 'model', minutes: 10, blurb: 'Sharp, fuzzy, McCrary density test and bandwidth choice — in one pass.', status: 'soon' },
  { slug: 'spatial', title: 'Spatial analysis', module: 'spatial', minutes: 10, blurb: 'Buffers, spatial joins, grids, live maps.', status: 'soon' },
  { slug: 'report-replication', title: 'Reports & replication', module: 'report', minutes: 8, blurb: 'LaTeX tables, AI narratives, R/Stata/Python bundles.', status: 'soon' },
];

export function filterVideos(videos: Video[], module: Module | 'all'): Video[] {
  return module === 'all' ? videos : videos.filter((v) => v.module === module);
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test`
Expected: PASS (all suites including glitzern).

- [ ] **Step 5: VideoGrid island** — `src/islands/VideoGrid.tsx`:

```tsx
import { useState } from 'react';
import { VIDEOS, MODULES, filterVideos, type Module } from '../data/videos';

const LABELS: Record<Module, string> = {
  data: 'Data', clean: 'Clean', explore: 'Explore', model: 'Model',
  simulate: 'Simulate', spatial: 'Spatial', report: 'Report',
};

export default function VideoGrid() {
  const [mod, setMod] = useState<Module | 'all'>('all');
  const shown = filterVideos(VIDEOS, mod);
  return (
    <div>
      <div className="chips">
        <button className={mod === 'all' ? 'on' : ''} onClick={() => setMod('all')}>All</button>
        {MODULES.map((m) => (
          <button key={m} className={mod === m ? 'on' : ''} onClick={() => setMod(m)}>{LABELS[m]}</button>
        ))}
      </div>
      <div className="grid">
        {shown.map((v) => (
          <article key={v.slug} className="card">
            <div className="thumb">
              {v.status === 'live' && v.youtubeId
                ? <a href={`https://www.youtube.com/watch?v=${v.youtubeId}`}>▶ {v.minutes} min</a>
                : <span>▶ coming soon</span>}
            </div>
            <h3>{v.title}</h3>
            <p>{v.blurb}</p>
            <span className="tag">{LABELS[v.module]}</span>
          </article>
        ))}
      </div>
      <style>{`
        .chips { display: flex; gap: 8px; flex-wrap: wrap; margin-bottom: 24px; }
        .chips button { border: 1px solid var(--border); background: none; color: var(--text-dim);
                        font-size: 13px; padding: 6px 16px; border-radius: 99px; cursor: pointer; font-family: var(--sans); }
        .chips button.on { border-color: var(--teal); color: var(--teal); }
        .grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(250px, 1fr)); gap: 14px; }
        .card { border: 1px solid var(--border); border-radius: 12px; background: var(--bg-raise); padding: 14px; }
        .thumb { height: 120px; border-radius: 8px; background: var(--bg); display: flex; align-items: center;
                 justify-content: center; font-family: var(--mono); font-size: 12px; color: var(--text-faint); margin-bottom: 12px; }
        .thumb a { color: var(--teal); }
        .card h3 { font-size: 15px; font-weight: 600; margin: 0 0 4px; color: var(--text); }
        .card p { font-size: 13px; color: var(--text-dim); margin: 0 0 10px; }
        .tag { font-family: var(--mono); font-size: 11px; color: var(--gold); }
      `}</style>
    </div>
  );
}
```

- [ ] **Step 6: Page** — `src/pages/videos.astro`:

```astro
---
import BaseLayout from '../layouts/BaseLayout.astro';
import VideoGrid from '../islands/VideoGrid';
---
<BaseLayout title="Videos" description="Thematic video guides for Litux: OLS, panel & DiD, RDD, spatial analysis, reports and replication.">
  <div class="page">
    <h1>Videos</h1>
    <p class="lead">One video per topic — each covers its whole family: the RDD video does sharp, fuzzy and McCrary in a single pass.</p>
    <VideoGrid client:load />
  </div>
</BaseLayout>
<style>
  .page { max-width: 980px; margin: 0 auto; padding: 130px 28px 90px; }
  h1 { font-size: 34px; font-weight: 600; margin: 0 0 8px; }
  .lead { color: var(--text-dim); margin: 0 0 28px; max-width: 600px; }
</style>
```

- [ ] **Step 7: Build + commit**

Run: `npm run build` — expect `Complete!`.

```powershell
git add -A; git commit -m "feat: thematic video library with module filter (tested)"
```

---

### Task 11: Docs (/docs, §7) — collection, layout, seed content

**Files:**
- Create: `src/content.config.ts`, `src/layouts/DocsLayout.astro`, `src/pages/docs/index.astro`, `src/pages/docs/[...slug].astro`, `src/content/docs/{data,clean,explore,model,simulate,spatial,report}.md`

- [ ] **Step 1: Content collection** — `src/content.config.ts`:

```ts
import { defineCollection, z } from 'astro:content';
import { glob } from 'astro/loaders';

const docs = defineCollection({
  loader: glob({ pattern: '**/*.md', base: './src/content/docs' }),
  schema: z.object({
    title: z.string(),
    module: z.string(),
    order: z.number(),
    description: z.string(),
  }),
});

export const collections = { docs };
```

- [ ] **Step 2: DocsLayout** — `src/layouts/DocsLayout.astro` (sidebar built from the collection):

```astro
---
import BaseLayout from './BaseLayout.astro';
import { getCollection } from 'astro:content';
interface Props { title: string; description: string; active: string }
const { title, description, active } = Astro.props;
const docs = (await getCollection('docs')).sort((a, b) => a.data.order - b.data.order);
---
<BaseLayout title={title} description={description}>
  <div class="wrap">
    <aside>
      <p class="side-h">Modules</p>
      {docs.map((d) => (
        <a class={`side-link ${d.id === active ? 'on' : ''}`} href={`/docs/${d.id}`}>{d.data.title}</a>
      ))}
    </aside>
    <article class="doc">
      <h1>{title}</h1>
      <slot />
    </article>
  </div>
</BaseLayout>
<style is:global>
  .wrap { display: flex; gap: 40px; max-width: 1020px; margin: 0 auto; padding: 120px 28px 90px; }
  aside { width: 180px; flex-shrink: 0; position: sticky; top: 110px; align-self: flex-start; }
  .side-h { font-family: var(--mono); font-size: 11px; color: var(--text-faint); text-transform: uppercase; letter-spacing: 1px; }
  .side-link { display: block; padding: 6px 0; font-size: 14px; color: var(--text-dim); }
  .side-link.on { color: var(--teal); }
  .doc { flex: 1; min-width: 0; }
  .doc h1 { font-size: 30px; font-weight: 600; margin: 0 0 18px; }
  .doc h2 { font-size: 21px; font-weight: 600; margin: 34px 0 10px; }
  .doc h3 { font-size: 16px; font-weight: 600; margin: 24px 0 8px; }
  .doc p, .doc li { font-size: 14.5px; color: var(--text-dim); }
  .doc strong { color: var(--text); }
  .doc pre { background: var(--bg-raise); border: 1px solid var(--border); border-radius: 8px; padding: 14px 16px; font-size: 12.5px; overflow-x: auto; }
  .doc code { color: var(--teal); }
  @media (max-width: 760px) { .wrap { flex-direction: column; } aside { position: static; width: auto; } }
</style>
```

- [ ] **Step 3: Routing** — `src/pages/docs/[...slug].astro`:

```astro
---
import { getCollection, render } from 'astro:content';
import DocsLayout from '../../layouts/DocsLayout.astro';
export async function getStaticPaths() {
  const docs = await getCollection('docs');
  return docs.map((d) => ({ params: { slug: d.id }, props: { doc: d } }));
}
const { doc } = Astro.props;
const { Content } = await render(doc);
---
<DocsLayout title={doc.data.title} description={doc.data.description} active={doc.id}>
  <Content />
</DocsLayout>
```

`src/pages/docs/index.astro` (docs landing — module cards):

```astro
---
import BaseLayout from '../../layouts/BaseLayout.astro';
import { getCollection } from 'astro:content';
const docs = (await getCollection('docs')).sort((a, b) => a.data.order - b.data.order);
---
<BaseLayout title="Documentation" description="The complete written guide to Litux, module by module.">
  <div class="page">
    <h1>Documentation</h1>
    <p class="lead">The complete written guide — precise and extensive, module by module. The same content ships inside the app.</p>
    <div class="grid">
      {docs.map((d) => (
        <a class="card" href={`/docs/${d.id}`}>
          <h3>{d.data.title}</h3>
          <p>{d.data.description}</p>
        </a>
      ))}
    </div>
  </div>
</BaseLayout>
<style>
  .page { max-width: 980px; margin: 0 auto; padding: 130px 28px 90px; }
  h1 { font-size: 34px; font-weight: 600; margin: 0 0 8px; }
  .lead { color: var(--text-dim); margin: 0 0 28px; max-width: 600px; }
  .grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(260px, 1fr)); gap: 14px; }
  .card { border: 1px solid var(--border); border-radius: 12px; background: var(--bg-raise); padding: 18px 20px; }
  .card:hover { border-color: var(--teal); }
  .card h3 { font-size: 16px; font-weight: 600; margin: 0 0 6px; color: var(--text); }
  .card p { font-size: 13px; color: var(--text-dim); margin: 0; }
</style>
```

- [ ] **Step 4: Seed content.** These markdown files are the SINGLE SOURCE for written guides (spec §7) — the app's in-app help will consume the same files later. Seven files. Six are outline seeds (real structure, content to be written as the docs effort proceeds); `model.md` additionally carries one fully-worked section (OLS) to set the writing pattern.

`src/content/docs/data.md`:

```markdown
---
title: "Data"
module: "data"
order: 1
description: "Loading files, fetching from APIs, managing datasets."
---

Litux reads your data where it is — no import wizards, no server uploads.

## Supported formats
CSV/TSV (auto-delimiter), Excel (.xlsx/.xls, per sheet), Stata (.dta), R (.rds), Parquet, shapefiles (.shp/.dbf). Large files (>10 MB) route through DuckDB automatically — millions of rows stay fast.

## Fetching from APIs
World Bank and OECD indicators can be pulled directly into a project.

## Managing datasets
Every loaded file becomes a session dataset; switch, merge, or delete them from the dataset manager.
```

`src/content/docs/clean.md`:

```markdown
---
title: "Clean"
module: "clean"
order: 2
description: "The non-destructive pipeline: cleaning, transforms, reshape, merge."
---

Every operation in Clean is a **pipeline step**: recorded, reorderable, replayable on your raw data, and exportable as code. Your original file is never modified.

## Cleaning
Missing values, filters, recodes, outlier handling (winsorize, trim, flag), type casting, regex extraction.

## Feature engineering
Logs, squares, z-scores, dummies, lags/leads, differences, interactions, date parsing.

## Reshape & merge
Pivot longer/wider, group summaries, joins (left/inner/right/full/semi/anti), append, set operations.

## The AI command bar
Describe a transformation in plain language; Litux proposes validated pipeline steps you preview before applying.
```

`src/content/docs/explore.md`:

```markdown
---
title: "Explore"
module: "explore"
order: 3
description: "Summaries, distributions, and the layer-based plot builder."
---

## Summaries
Column statistics, missing-data patterns, and data-quality reports at a glance.

## Plot builder
A layered grammar-of-graphics builder: points, lines, bars, histograms, densities, boxplots, ribbons and more, with aesthetic mappings and export to SVG/PNG.
```

`src/content/docs/model.md` (carries the worked example that sets the docs pattern):

```markdown
---
title: "Model"
module: "model"
order: 4
description: "Every estimator: OLS to IV, DiD, RDD, panel, synthetic control — validated against R."
---

Every estimator in Litux is validated against R to six decimal places on coefficients and four on standard errors. This page documents each one: when to use it, its assumptions, how to configure it, and what replication code it generates.

## OLS

**What it is.** Ordinary least squares — the workhorse linear model. Use it when you want the conditional mean of a continuous outcome and you are willing to assume exogeneity of the regressors.

**Assumptions.** Linearity, exogeneity (E[ε|X] = 0), no perfect collinearity. Homoskedasticity is *not* required — pick a robust standard-error type instead.

**Step by step.**
1. In Model, choose **OLS** from the estimator menu.
2. Pick your outcome (Y) and regressors (X). Categorical variables expand to dummies automatically (first level dropped).
3. Open **Inference** to choose standard errors: classical, HC0–HC3, clustered (one- or two-way), or Newey-West HAC.
4. Hit **Estimate**. The coefficient table reports estimates, SEs, t-statistics and p-values; diagnostics (Breusch-Pagan, Jarque-Bera, VIF) are one tab away.

**Validation.** Coefficients match R's `lm()` to 6 decimals; robust SEs match `sandwich::vcovHC` / `vcovCL` to 4.

**Replication.** The exported R script uses `fixest::feols` with your exact SE choice; Stata uses `reg ..., vce()`; Python uses `pyfixest`.

## Instrumental variables (2SLS, GMM, LIML)
When regressors are endogenous. Covers instrument choice, first-stage diagnostics, weak-instrument F, Hansen J.

## Panel (FE, FD, TWFE, LSDV)
Within-transformations, first differences, two-way fixed effects, panel-robust inference.

## Difference-in-differences & event studies
2x2 DiD, TWFE DiD, event studies, staggered adoption (Callaway-Sant'Anna, Sun-Abraham).

## Regression discontinuity
Sharp and fuzzy designs, IK bandwidth, McCrary density test, polynomial orders.

## Limited dependent outcomes
Logit, probit, Poisson FE, negative binomial — marginal effects included.

## Synthetic control
Frank-Wolfe weight solver with placebo inference.

## Hypothesis tests
Post-estimation single and joint (Wald) tests on coefficients.
```

`src/content/docs/simulate.md`:

```markdown
---
title: "Simulate"
module: "simulate"
order: 5
description: "DGP builder, Monte Carlo, resampling, distribution tools."
---

## DGP builder
Construct data-generating processes — including panel structures and categorical draws — and run Monte Carlo experiments on them.

## Resampling & inference
Bootstrap (percentile, basic, BCa), jackknife, permutation tests, parametric sample tests — all seeded and reproducible.
```

`src/content/docs/spatial.md`:

```markdown
---
title: "Spatial"
module: "spatial"
order: 6
description: "Buffers, joins, grids, distance, geocoding, live maps."
---

## Spatial operations
Distance (haversine/euclidean), buffer assignment, rectangular and H3 grids, spatial joins, nearest neighbor, boundary distance, CRS transforms, geocoding.

## Maps & plots
A live Leaflet map builder and an SVG geo-plot canvas for publication figures.

## Spatial econometrics
Spatial weights, Moran's I / Geary's C, and spatial regression (SLX, SAR, SEM, SDM).
```

`src/content/docs/report.md`:

```markdown
---
title: "Report"
module: "report"
order: 7
description: "LaTeX tables, AI narratives, replication bundles."
---

## Publication output
Stargazer-style LaTeX tables, forest plots, model-comparison tables.

## Replication bundles
One click exports a ZIP with equivalent R, Stata and Python scripts plus your data — the full pipeline and every pinned model, reproducible in all three languages.

## AI narratives
Optional AI-written results sections, grounded in your actual estimates (and nothing else).
```

- [ ] **Step 5: Build + commit**

Run: `npm run build` — expect `Complete!` with `/docs` + 7 doc pages in the route list.

```powershell
git add -A; git commit -m "feat: docs collection, sidebar layout, 7 single-source module guides (OLS worked example)"
```

---

### Task 12: Downloads + waitlist (/download, §8)

**Files:**
- Create: `src/islands/WaitlistForm.tsx`, `src/pages/download.astro`, `src/pages/api/notify.ts`

- [ ] **Step 1: API endpoint** — `src/pages/api/notify.ts`. Stores emails in a Supabase table via REST with the service-role key (server-side only, never shipped to the client). Degrades to 503 if env is missing (the form then shows a mailto fallback):

```ts
import type { APIRoute } from 'astro';

export const prerender = false;

const EMAIL_RE = /^[^\s@]{1,64}@[^\s@]{1,255}\.[^\s@]{2,}$/;

export const POST: APIRoute = async ({ request }) => {
  const url = import.meta.env.SUPABASE_URL;
  const key = import.meta.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) return json({ error: 'unavailable' }, 503);

  let email = '';
  try {
    email = String((await request.json()).email ?? '').trim().toLowerCase();
  } catch {
    return json({ error: 'bad request' }, 400);
  }
  if (!EMAIL_RE.test(email)) return json({ error: 'invalid email' }, 400);

  const r = await fetch(`${url}/rest/v1/desktop_waitlist`, {
    method: 'POST',
    headers: {
      apikey: key,
      Authorization: `Bearer ${key}`,
      'Content-Type': 'application/json',
      Prefer: 'resolution=ignore-duplicates',
    },
    body: JSON.stringify({ email }),
  });
  if (!r.ok && r.status !== 409) return json({ error: 'store failed' }, 502);
  return json({ ok: true }, 200);
};

function json(body: object, status: number) {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
}
```

- [ ] **Step 2: Supabase table.** Run this SQL in the existing Supabase project (dashboard SQL editor or Supabase MCP `apply_migration`) — **Franco applies this; it touches the shared project**:

```sql
create table if not exists public.desktop_waitlist (
  id uuid primary key default gen_random_uuid(),
  email text not null unique,
  created_at timestamptz not null default now()
);
alter table public.desktop_waitlist enable row level security;
-- No policies on purpose: only the service role (used by the site's API route) can read/write.
```

- [ ] **Step 3: WaitlistForm island** — `src/islands/WaitlistForm.tsx`:

```tsx
import { useState } from 'react';
import { CONTACT_EMAIL as CONTACT } from '../config';

export default function WaitlistForm() {
  const [email, setEmail] = useState('');
  const [state, setState] = useState<'idle' | 'busy' | 'ok' | 'err' | 'down'>('idle');

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setState('busy');
    try {
      const r = await fetch('/api/notify', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email }),
      });
      if (r.ok) setState('ok');
      else if (r.status === 503) setState('down');
      else setState('err');
    } catch {
      setState('err');
    }
  }

  if (state === 'ok') return <p style={{ color: 'var(--teal)', fontSize: 14 }}>You're on the list — we'll email you when the desktop app ships.</p>;
  if (state === 'down') return <p style={{ color: 'var(--text-dim)', fontSize: 14 }}>Sign-ups are momentarily offline — email <a style={{ color: 'var(--teal)' }} href={`mailto:${CONTACT}?subject=Desktop%20app%20waitlist`}>{CONTACT}</a> instead.</p>;

  return (
    <form onSubmit={submit} style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
      <input
        type="email" required value={email} onChange={(e) => setEmail(e.target.value)}
        placeholder="you@university.edu" aria-label="Email address"
        style={{ flex: 1, minWidth: 220, background: 'var(--bg)', border: '1px solid var(--border)', borderRadius: 8, padding: '10px 14px', color: 'var(--text)', fontSize: 14, fontFamily: 'var(--sans)' }}
      />
      <button
        type="submit" disabled={state === 'busy'}
        style={{ background: 'var(--teal)', color: 'var(--teal-dark)', border: 'none', borderRadius: 8, padding: '10px 20px', fontSize: 14, fontWeight: 500, cursor: 'pointer', fontFamily: 'var(--sans)' }}
      >
        {state === 'busy' ? '…' : 'Notify me'}
      </button>
      {state === 'err' && <p style={{ width: '100%', color: 'var(--gold)', fontSize: 13, margin: 0 }}>Something went wrong — try again.</p>}
    </form>
  );
}
```

- [ ] **Step 4: Page** — `src/pages/download.astro`:

```astro
---
import BaseLayout from '../layouts/BaseLayout.astro';
import WaitlistForm from '../islands/WaitlistForm';
import { APP_URL, CTA_BROWSER, CTA_TRY } from '../config';
---
<BaseLayout title="Download" description="Litux desktop for Windows and macOS is coming. Use it in your browser today — no install, no account required.">
  <div class="page">
    <h1>Download Litux</h1>
    <p class="lead">The desktop app for Windows and macOS is in the works. Leave your email and we'll tell you the moment it ships.</p>
    <div class="plats">
      <div class="plat"><span class="os">Windows</span><span class="soon">coming soon</span></div>
      <div class="plat"><span class="os">macOS</span><span class="soon">coming soon</span></div>
    </div>
    <div class="wl"><WaitlistForm client:load /></div>
    <div class="now">
      <h2>Use Litux today</h2>
      <p>Everything already runs in your browser — same engines, same privacy model, no install.</p>
      <div class="ctas">
        <a class="primary" href={APP_URL}>{CTA_BROWSER}</a>
        <a class="tertiary" href={APP_URL}>{CTA_TRY}</a>
      </div>
    </div>
  </div>
</BaseLayout>
<style>
  .page { max-width: 680px; margin: 0 auto; padding: 130px 28px 90px; }
  h1 { font-size: 34px; font-weight: 600; margin: 0 0 8px; }
  .lead { color: var(--text-dim); margin: 0 0 26px; }
  .plats { display: grid; grid-template-columns: 1fr 1fr; gap: 12px; margin-bottom: 18px; }
  .plat { border: 1px dashed var(--border); border-radius: 12px; padding: 22px; display: flex; flex-direction: column; gap: 4px; }
  .os { font-size: 17px; font-weight: 600; }
  .soon { font-family: var(--mono); font-size: 12px; color: var(--gold); }
  .wl { margin-bottom: 50px; }
  .now { border-top: 1px solid var(--border); padding-top: 34px; }
  .now h2 { font-size: 22px; font-weight: 600; margin: 0 0 6px; }
  .now p { color: var(--text-dim); font-size: 14.5px; margin: 0 0 18px; }
  .ctas { display: flex; gap: 14px; align-items: center; }
  .primary { background: var(--teal); color: var(--teal-dark); font-weight: 500; font-size: 14px; padding: 10px 22px; border-radius: 8px; }
  .tertiary { color: var(--text-faint); font-size: 14px; }
</style>
```

- [ ] **Step 5: Build + commit**

Run: `npm run build` — expect `Complete!` and the build log to list `/api/notify` as a server (on-demand) route.

```powershell
git add -A; git commit -m "feat: download page with coming-soon platforms + desktop waitlist (Supabase REST)"
```

---

### Task 13: Final pass — accessibility, reduced motion, build audit

**Files:**
- Modify: spot fixes only, as found

- [ ] **Step 1: Reduced-motion audit.** Verify every animation has a reduced-motion path: GlitzernHero (skips to text — Task 5), GridBackdrop (`animation: none` — Task 6), hero `.reveal` (Task 6), ModuleTour steps (Task 7). Open DevTools → Rendering → emulate `prefers-reduced-motion` and reload `/` — the page must be fully readable with zero motion.

- [ ] **Step 2: Keyboard/contrast pass.** Tab through nav, CTAs, video chips, waitlist form — all reachable and visibly focused (browser default focus ring is acceptable for v1). Text on teal buttons uses `--teal-dark` (#04342c on #6ec8b4 ≈ 7.4:1 — passes AA).

- [ ] **Step 3: Full gate**

Run: `npm test` — expect PASS (glitzern + videos suites).
Run: `npm run build` — expect `Complete!`, routes: `/`, `/start`, `/videos`, `/download`, `/docs`, `/docs/{data,clean,explore,model,simulate,spatial,report}`, `/api/notify` (server), sitemap generated.

- [ ] **Step 4: Commit**

```powershell
git add -A; git commit -m "chore: a11y + reduced-motion audit fixes"
```

---

### Task 14: Deploy to Vercel + bookkeeping

- [ ] **Step 1: Create GitHub repo + push** (needs Franco's gh auth):

```powershell
gh repo create 1francom/litux-site --private --source . --push
```

- [ ] **Step 2: Vercel project.** Via Vercel dashboard or MCP: import `1francom/litux-site`, framework preset Astro (auto-detected via the adapter). Set env vars on the project:
- `SUPABASE_URL` — the existing Supabase project URL
- `SUPABASE_SERVICE_ROLE_KEY` — service-role key (server-side only)

Deploy. Expected: site live at `https://litux-<hash>.vercel.app` (rename project to `litux` for `https://litux.vercel.app`).

- [ ] **Step 3: Post-deploy smoke test.** On the live URL: hero animation plays and ends smooth; all 5 nav routes load; video filter chips work; waitlist form accepts an email (check `desktop_waitlist` row in Supabase) or shows the mailto fallback if env wasn't set.

- [ ] **Step 4: Bookkeeping in the econsolver repo** (working dir `C:\Franco\econsolver`): update the Spec & Plan Index rows for `specs/2026-06-11-litux-website-design.md` and `plans/2026-06-11-litux-website.md` → status `DONE (browser-validation pending Franco)`, note the live URL and the two pending content efforts (videos, full docs writing). Commit:

```powershell
git add ClaudePlan.md; git commit -m "docs(plan): litux website shipped - index status update"; git push origin Main-
```

---

## Out of scope (tracked in spec §10 — do NOT build here)

- Video production (intro + 7 thematic videos) — placeholder slots ship "coming soon".
- Full docs writing beyond the seeds — the OLS section sets the pattern.
- Real app screenshots for the module tour — styled placeholders ship; swap point marked in `ModuleTour.tsx`.
- Final logo pass, custom domain, OG image, i18n.
- In-app consumption of the docs markdown (single-source rule) — future app-side work.
