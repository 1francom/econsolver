# Design Language Refresh (Workstream A) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Extend EconSolver's existing color-only theme system into a full design-token system (typography + spacing + radius + elevation), add an IBM Plex Sans/Mono pairing, a user Appearance config panel, incremental drift cleanup, and a root `DESIGN.md`.

**Architecture:** Extend `src/theme.js` (pure JS token data + a `buildTokens()` builder) and `src/ThemeContext.jsx` (merge defaults→theme→prefs→density, persist `econ_prefs`). A new `src/components/workspace/AppearancePanel.jsx`, opened by a gear in `WorkspaceBar`, writes prefs. Components migrate from hardcoded literals to `useTheme()` tokens incrementally. No CSS framework — inline styles + token objects only (CLAUDE.md invariant).

**Tech Stack:** React + Vite + JavaScript, inline styles, localStorage, Google Fonts CDN. Pure token math validated with a Node harness (project's existing pattern); UI validated in-browser (no JS component test runner).

**Spec:** `docs/superpowers/specs/2026-06-07-design-language-refresh-design.md`

---

## File Structure

| File | Responsibility | Action |
|------|----------------|--------|
| `src/theme.js` | Pure token data: `DARK`/`LIGHT` colors (existing), `TYPE_ROLES`, `SANS_STACK`, `MONO_STACK`, `SPACE`, `RADIUS`, `DENSITY`, `ELEV_DARK`/`ELEV_LIGHT`, `PLOT_PALETTES`, and `buildTokens()` | Modify |
| `src/__validation__/themeTokens.test.mjs` | Node harness asserting `buildTokens()` density math, font swap, mono-locking, clamp | Create |
| `src/ThemeContext.jsx` | Merge theme+prefs→tokens, expose `{C,T,space,radius,elev,theme,setTheme,prefs,setPrefs}`, persist `econ_prefs`, inject font `<link>`s | Modify |
| `src/components/workspace/AppearancePanel.jsx` | Appearance UI (Theme / Text / Visualization / Reset) | Create |
| `src/components/workspace/WorkspaceBar.jsx` | Gear button toggles the panel | Modify |
| `src/components/PlotBuilder.jsx` | Default palette initializes from `prefs.plotPalette` | Modify |
| high-traffic chrome files | Replace hardcoded hex / font literals with tokens | Modify |
| spatial + sidebar + parked files | Same, lower priority | Modify |
| `DESIGN.md` (project root) | Plain-text design doc for the AI, 9-section format | Create |

---

## Task 1: Extend `theme.js` with non-color tokens + `buildTokens()`

**Files:**
- Modify: `src/theme.js` (append after existing `LIGHT` export, ~line 49)

- [ ] **Step 1: Append token data and the builder to `theme.js`**

Add to the end of `src/theme.js` (do NOT touch existing `DARK`/`LIGHT`):

```js
// ─── Typography ──────────────────────────────────────────────────────────────
export const SANS_STACK = {
  "IBM Plex Sans": "'IBM Plex Sans', system-ui, -apple-system, sans-serif",
  "Inter":         "'Inter', system-ui, -apple-system, sans-serif",
  "Geist":         "'Geist', system-ui, -apple-system, sans-serif",
};
export const MONO_STACK = "'IBM Plex Mono', ui-monospace, 'SFMono-Regular', monospace";

// role → base spec. fam: "sans" | "mono". size in px (pre-density).
export const TYPE_ROLES = {
  display: { fam: "sans", size: 28, weight: 600, ls: "0",      lh: 1.2  },
  h1:      { fam: "sans", size: 20, weight: 600, ls: "0",      lh: 1.25 },
  h2:      { fam: "sans", size: 15, weight: 600, ls: "0",      lh: 1.3  },
  h3:      { fam: "sans", size: 13, weight: 500, ls: "0",      lh: 1.3  },
  body:    { fam: "sans", size: 13, weight: 400, ls: "0",      lh: 1.5  },
  label:   { fam: "sans", size: 10, weight: 500, ls: "0.2em",  lh: 1.3, transform: "uppercase" },
  data:    { fam: "mono", size: 13, weight: 400, ls: "0",      lh: 1.4, tnum: true },
  code:    { fam: "mono", size: 12, weight: 400, ls: "0",      lh: 1.5  },
  caption: { fam: "sans", size: 10, weight: 400, ls: "0.04em", lh: 1.4  },
};

// ─── Spacing / radius / density ──────────────────────────────────────────────
export const SPACE  = [0, 2, 4, 8, 12, 16, 24, 32, 48];
export const RADIUS = { none: 0, sm: 2, md: 4, lg: 6 };
export const DENSITY = { compact: 0.88, comfortable: 1 };
export const MIN_FONT = 9; // px floor so compact density never makes text unreadable

// ─── Elevation (theme-split) ─────────────────────────────────────────────────
export const ELEV_DARK = {
  flat:    { border: "1px solid #1c1c1c", boxShadow: "none" },
  raised:  { border: "1px solid #252525", boxShadow: "inset 0 1px 0 rgba(255,255,255,0.03)" },
  popover: { border: "1px solid #252525", boxShadow: "0 8px 24px rgba(0,0,0,0.6)" },
  modal:   { border: "1px solid #2e2e2e", boxShadow: "0 16px 48px rgba(0,0,0,0.7)" },
  tooltip: { border: "1px solid #2e2e2e", boxShadow: "0 4px 12px rgba(0,0,0,0.5)" },
};
export const ELEV_LIGHT = {
  flat:    { border: "1px solid #d8d5cf", boxShadow: "none" },
  raised:  { border: "1px solid #d8d5cf", boxShadow: "0 1px 2px rgba(0,0,0,0.04)" },
  popover: { border: "1px solid #c8c4bc", boxShadow: "0 8px 24px rgba(0,0,0,0.12)" },
  modal:   { border: "1px solid #c8c4bc", boxShadow: "0 16px 48px rgba(0,0,0,0.18)" },
  tooltip: { border: "1px solid #c8c4bc", boxShadow: "0 4px 12px rgba(0,0,0,0.12)" },
};

// ─── Plot palettes (viz config) ──────────────────────────────────────────────
// "" sentinel = let PlotBuilder use Manual / its own scheme. Branded first.
export const PLOT_PALETTES = {
  "teal-gold":  ["#6ec8b4", "#c8a96e", "#6e9ec8", "#a87ec8", "#c88e6e", "#7ab896"],
  "observable": null, // maps to PlotBuilder's existing "observable10" scheme
  "tableau":    null, // maps to PlotBuilder's existing "tableau10" scheme
};

// ─── Token builder ───────────────────────────────────────────────────────────
// Pure. Given user prefs + theme name, returns { T, space, radius, elev }.
export function buildTokens({ theme = "dark", sansFont = "IBM Plex Sans", density = "comfortable" } = {}) {
  const mult = DENSITY[density] ?? 1;
  const sans = SANS_STACK[sansFont] ?? SANS_STACK["IBM Plex Sans"];
  const T = {};
  for (const role in TYPE_ROLES) {
    const r = TYPE_ROLES[role];
    T[role] = {
      fontFamily: r.fam === "mono" ? MONO_STACK : sans,
      fontSize: Math.max(MIN_FONT, Math.round(r.size * mult)) + "px",
      fontWeight: r.weight,
      letterSpacing: r.ls,
      lineHeight: r.lh,
      ...(r.transform ? { textTransform: r.transform } : {}),
      ...(r.tnum ? { fontVariantNumeric: "tabular-nums" } : {}),
    };
  }
  const space = SPACE.map((s) => Math.round(s * mult));
  const elev = theme === "light" ? ELEV_LIGHT : ELEV_DARK;
  return { T, space, radius: RADIUS, elev };
}
```

- [ ] **Step 2: Verify the file parses (build the project)**

Run: `cd "C:/Franco/econsolver" && npm run build`
Expected: build completes with no errors referencing `theme.js`.

- [ ] **Step 3: Commit**

```bash
git add src/theme.js
git commit -m "feat(theme): add type/space/radius/elev tokens + buildTokens()"
```

---

## Task 2: Node validation harness for `buildTokens()`

**Files:**
- Create: `src/__validation__/themeTokens.test.mjs`

- [ ] **Step 1: Write the harness**

Create `src/__validation__/themeTokens.test.mjs`:

```js
// Node harness: run with `node src/__validation__/themeTokens.test.mjs`
import { buildTokens, MIN_FONT, MONO_STACK, SANS_STACK } from "../theme.js";
import assert from "node:assert";

let pass = 0;
function check(name, fn) { fn(); pass++; console.log("  ok -", name); }

// 1. comfortable density = base sizes
check("comfortable display = 28px", () => {
  const { T } = buildTokens({ density: "comfortable" });
  assert.equal(T.display.fontSize, "28px");
});

// 2. compact density scales by 0.88 and rounds
check("compact display = round(28*0.88)=25px", () => {
  const { T } = buildTokens({ density: "compact" });
  assert.equal(T.display.fontSize, "25px");
});

// 3. min-font clamp: label(10)*0.88=8.8→round 9, floor MIN_FONT
check("compact never below MIN_FONT", () => {
  const { T } = buildTokens({ density: "compact" });
  assert.ok(parseInt(T.label.fontSize) >= MIN_FONT);
  assert.ok(parseInt(T.caption.fontSize) >= MIN_FONT);
});

// 4. data + code roles stay mono regardless of sansFont
check("data/code roles locked to mono", () => {
  const { T } = buildTokens({ sansFont: "Inter" });
  assert.equal(T.data.fontFamily, MONO_STACK);
  assert.equal(T.code.fontFamily, MONO_STACK);
});

// 5. sansFont swaps sans roles
check("sansFont swaps sans roles", () => {
  const { T } = buildTokens({ sansFont: "Geist" });
  assert.ok(T.body.fontFamily.includes("Geist"));
  assert.ok(T.h1.fontFamily.includes("Geist"));
});

// 6. unknown sansFont falls back to Plex Sans
check("unknown sansFont falls back", () => {
  const { T } = buildTokens({ sansFont: "Nope" });
  assert.equal(T.body.fontFamily, SANS_STACK["IBM Plex Sans"]);
});

// 7. data role carries tabular-nums
check("data role has tabular-nums", () => {
  const { T } = buildTokens({});
  assert.equal(T.data.fontVariantNumeric, "tabular-nums");
});

// 8. space scales with density
check("space scales with density", () => {
  const a = buildTokens({ density: "comfortable" }).space;
  const b = buildTokens({ density: "compact" }).space;
  assert.equal(a[3], 8);
  assert.equal(b[3], Math.round(8 * 0.88));
});

// 9. elev is theme-split
check("elev differs by theme", () => {
  const d = buildTokens({ theme: "dark" }).elev;
  const l = buildTokens({ theme: "light" }).elev;
  assert.notEqual(d.popover.border, l.popover.border);
});

console.log(`\n${pass}/9 token checks passed`);
```

- [ ] **Step 2: Run the harness, expect all pass**

Run: `cd "C:/Franco/econsolver" && node src/__validation__/themeTokens.test.mjs`
Expected: `9/9 token checks passed`.

- [ ] **Step 3: Commit**

```bash
git add src/__validation__/themeTokens.test.mjs
git commit -m "test(theme): node harness for buildTokens (9/9)"
```

---

## Task 3: Extend `ThemeContext.jsx` — prefs, tokens, font injection

**Files:**
- Modify: `src/ThemeContext.jsx` (full rewrite of the provider; keep the public hook name `useTheme`)

- [ ] **Step 1: Rewrite `ThemeContext.jsx`**

Replace the entire file contents with:

```jsx
// ─── ECON STUDIO · src/ThemeContext.jsx ───────────────────────────────────────
// Provides { C, T, space, radius, elev, theme, setTheme, prefs, setPrefs }.
// theme persisted under "econ_theme"; appearance prefs under "econ_prefs".

import { createContext, useContext, useState, useEffect } from "react";
import { DARK, LIGHT, buildTokens } from "./theme.js";

const THEME_KEY = "econ_theme";
const PREFS_KEY = "econ_prefs";
const DEFAULT_PREFS = { sansFont: "IBM Plex Sans", density: "comfortable", plotPalette: "teal-gold" };

const initialTokens = buildTokens({ theme: "dark", ...DEFAULT_PREFS });
const ThemeCtx = createContext({
  C: DARK, theme: "dark", setTheme: () => {},
  prefs: DEFAULT_PREFS, setPrefs: () => {},
  ...initialTokens,
});

function loadPrefs() {
  try {
    const raw = localStorage.getItem(PREFS_KEY);
    return raw ? { ...DEFAULT_PREFS, ...JSON.parse(raw) } : DEFAULT_PREFS;
  } catch { return DEFAULT_PREFS; }
}

// Inject font links once. Plex Sans + Plex Mono are always loaded (baseline);
// Inter / Geist load on demand when chosen.
const FONT_HREFS = {
  baseline: "https://fonts.googleapis.com/css2?family=IBM+Plex+Mono:wght@400;500&family=IBM+Plex+Sans:wght@400;500;600&display=swap",
  Inter:    "https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600&display=swap",
  Geist:    "https://fonts.googleapis.com/css2?family=Geist:wght@400;500;600&display=swap",
};
function ensureFont(key) {
  const id = "econ-font-" + key;
  if (document.getElementById(id)) return;
  const link = document.createElement("link");
  link.id = id; link.rel = "stylesheet"; link.href = FONT_HREFS[key];
  document.head.appendChild(link);
}

export function ThemeProvider({ children }) {
  const [theme, setThemeState] = useState(() => {
    try { return localStorage.getItem(THEME_KEY) === "light" ? "light" : "dark"; }
    catch { return "dark"; }
  });
  const [prefs, setPrefsState] = useState(loadPrefs);

  function setTheme(t) {
    setThemeState(t);
    try { localStorage.setItem(THEME_KEY, t); } catch {}
  }
  function setPrefs(patch) {
    setPrefsState((p) => {
      const next = { ...p, ...patch };
      try { localStorage.setItem(PREFS_KEY, JSON.stringify(next)); } catch {}
      return next;
    });
  }

  const C = theme === "light" ? LIGHT : DARK;
  const { T, space, radius, elev } = buildTokens({
    theme, sansFont: prefs.sansFont, density: prefs.density,
  });

  // Always load baseline; conditionally load the chosen non-baseline font.
  useEffect(() => { ensureFont("baseline"); }, []);
  useEffect(() => {
    if (prefs.sansFont === "Inter" || prefs.sansFont === "Geist") ensureFont(prefs.sansFont);
  }, [prefs.sansFont]);

  // Sync body background + base font so the area outside React root matches.
  useEffect(() => { document.body.style.background = C.bg; }, [C.bg]);
  useEffect(() => { document.body.style.fontFamily = T.body.fontFamily; }, [T.body.fontFamily]);

  return (
    <ThemeCtx.Provider value={{ C, T, space, radius, elev, theme, setTheme, prefs, setPrefs }}>
      {children}
    </ThemeCtx.Provider>
  );
}

export function useTheme() { return useContext(ThemeCtx); }
```

- [ ] **Step 2: Build to verify no import/JSX errors**

Run: `cd "C:/Franco/econsolver" && npm run build`
Expected: build succeeds. Existing `useTheme()` consumers still get `{ C, theme, setTheme }` (now plus extras).

- [ ] **Step 3: Browser smoke check**

Run dev server, open app. Expected: app loads unchanged visually (no consumer reads `T`/`space` yet); day/night toggle still works; no console errors. Plex Sans/Mono `<link>` present in `<head>`.

- [ ] **Step 4: Commit**

```bash
git add src/ThemeContext.jsx
git commit -m "feat(theme): ThemeContext serves tokens + persisted appearance prefs"
```

---

## Task 4: `AppearancePanel.jsx`

**Files:**
- Create: `src/components/workspace/AppearancePanel.jsx`

- [ ] **Step 1: Create the panel**

Create `src/components/workspace/AppearancePanel.jsx`:

```jsx
import { useTheme } from "../../ThemeContext.jsx";

const SANS_OPTS = ["IBM Plex Sans", "Inter", "Geist"];
const DENSITY_OPTS = ["compact", "comfortable"];
const PALETTE_OPTS = ["teal-gold", "observable", "tableau"];
const DEFAULTS = { sansFont: "IBM Plex Sans", density: "comfortable", plotPalette: "teal-gold" };

export default function AppearancePanel({ onClose }) {
  const { C, T, space, radius, elev, theme, setTheme, prefs, setPrefs } = useTheme();

  const wrap = {
    position: "absolute", top: "100%", right: 0, marginTop: space[2],
    width: 300, background: C.surface, ...elev.popover,
    borderRadius: radius.md, padding: space[5], zIndex: 1000,
    display: "flex", flexDirection: "column", gap: space[5],
  };
  const sectionLbl = { ...T.label, color: C.textDim, marginBottom: space[2] };
  const row = { display: "flex", gap: space[2], flexWrap: "wrap" };

  const chip = (active) => ({
    ...T.caption, padding: `${space[2]}px ${space[3]}px`,
    border: active ? `1px solid ${C.gold}` : `1px solid ${C.border2}`,
    color: active ? C.gold : C.textDim, background: "transparent",
    borderRadius: radius.sm, cursor: "pointer",
  });

  return (
    <div style={wrap} onClick={(e) => e.stopPropagation()}>
      {/* Theme */}
      <div>
        <div style={sectionLbl}>Theme</div>
        <div style={row}>
          {["dark", "light"].map((t) => (
            <button key={t} style={chip(theme === t)} onClick={() => setTheme(t)}>{t}</button>
          ))}
        </div>
      </div>

      {/* Text */}
      <div>
        <div style={sectionLbl}>Text · Font</div>
        <div style={row}>
          {SANS_OPTS.map((f) => (
            <button key={f} style={chip(prefs.sansFont === f)} onClick={() => setPrefs({ sansFont: f })}>{f}</button>
          ))}
        </div>
        <div style={{ ...sectionLbl, marginTop: space[3] }}>Text · Density</div>
        <div style={row}>
          {DENSITY_OPTS.map((d) => (
            <button key={d} style={chip(prefs.density === d)} onClick={() => setPrefs({ density: d })}>{d}</button>
          ))}
        </div>
        {/* live preview */}
        <div style={{ marginTop: space[3], padding: space[3], background: C.surface2, borderRadius: radius.sm }}>
          <div style={{ ...T.h2, color: C.text }}>Aa Heading</div>
          <div style={{ ...T.body, color: C.textDim }}>Body sample — clarity & sharpness.</div>
          <div style={{ ...T.data, color: C.teal }}>β = 0.42531  (SE 0.0123)</div>
        </div>
      </div>

      {/* Visualization */}
      <div>
        <div style={sectionLbl}>Visualization · Plot palette</div>
        <div style={row}>
          {PALETTE_OPTS.map((p) => (
            <button key={p} style={chip(prefs.plotPalette === p)} onClick={() => setPrefs({ plotPalette: p })}>{p}</button>
          ))}
        </div>
      </div>

      {/* Reset + close */}
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
        <button style={{ ...T.caption, background: "none", border: "none", color: C.textMuted, cursor: "pointer" }}
          onClick={() => { setPrefs(DEFAULTS); setTheme("dark"); }}>Reset to defaults</button>
        <button style={chip(false)} onClick={onClose}>Close</button>
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Build**

Run: `cd "C:/Franco/econsolver" && npm run build`
Expected: succeeds.

- [ ] **Step 3: Commit**

```bash
git add src/components/workspace/AppearancePanel.jsx
git commit -m "feat(appearance): AppearancePanel (theme/font/density/palette + reset)"
```

---

## Task 5: Wire the gear into `WorkspaceBar`

**Files:**
- Modify: `src/components/workspace/WorkspaceBar.jsx`

- [ ] **Step 1: Read the current bar to find the day/night toggle + container**

Run: open `src/components/workspace/WorkspaceBar.jsx`. Locate where the existing theme toggle / right-side controls render and the component's `useState`/`useTheme` usage.

- [ ] **Step 2: Add panel state + import**

At the top of the component file, add the import:

```jsx
import AppearancePanel from "./AppearancePanel.jsx";
```

Inside the component body, add state:

```jsx
const [showAppearance, setShowAppearance] = useState(false);
```

- [ ] **Step 3: Render the gear button + panel**

Next to the existing day/night control, render (use the existing `C` from `useTheme()` already in scope; if not present, add `const { C } = useTheme();`):

```jsx
<div style={{ position: "relative" }}>
  <button
    aria-label="Appearance settings"
    title="Appearance"
    onClick={() => setShowAppearance((s) => !s)}
    style={{ background: "none", border: "none", color: C.textDim, cursor: "pointer", fontSize: 16, lineHeight: 1 }}
  >⚙</button>
  {showAppearance && <AppearancePanel onClose={() => setShowAppearance(false)} />}
</div>
```

- [ ] **Step 4: Build + browser validation**

Run: `cd "C:/Franco/econsolver" && npm run build` (expect success), then in browser:
- Gear opens the panel; clicking Close or Reset works.
- Switching font to Inter/Geist visibly changes chrome text but NOT numbers/tables (mono stays).
- Switching density compact/comfortable changes sizing.
- Reload page → prefs persist (`econ_prefs` in localStorage / Application tab).

- [ ] **Step 5: Commit**

```bash
git add src/components/workspace/WorkspaceBar.jsx
git commit -m "feat(appearance): gear button + panel in WorkspaceBar"
```

---

## Task 6: Default plot palette from prefs (PlotBuilder)

**Files:**
- Modify: `src/components/PlotBuilder.jsx` (`PALETTE_PRESETS` ~line 93; palette state initializer)

- [ ] **Step 1: Add a branded teal-gold preset**

In `src/components/PlotBuilder.jsx`, extend `PALETTE_PRESETS` (line 93) to include the branded option at the top after Manual:

```js
const PALETTE_PRESETS = [
  { id: "",             label: "Manual"      },
  { id: "teal-gold",    label: "Teal-Gold"   },
  { id: "tableau10",    label: "Tableau"     },
  { id: "observable10", label: "Observable"  },
  { id: "dark2",        label: "Dark2"       },
  { id: "set1",         label: "Set1"        },
  { id: "set2",         label: "Set2"        },
  { id: "paired",       label: "Paired"      },
  { id: "accent",       label: "Accent"      },
];
```

- [ ] **Step 2: Initialize the palette state from prefs**

Find the `useState` that holds the selected palette id (search for the variable bound to the `<select>` at line ~1389). Add `useTheme` import if absent:

```jsx
import { useTheme } from "../ThemeContext.jsx";
```

Map the pref to a preset id and use it as the initial value. Add near the top of the component:

```jsx
const { prefs } = useTheme();
const PREF_TO_PRESET = { "teal-gold": "teal-gold", observable: "observable10", tableau: "tableau10" };
```

Change the palette state initializer from its current default (e.g. `useState("")`) to:

```jsx
useState(PREF_TO_PRESET[prefs.plotPalette] || "");
```

- [ ] **Step 3: Resolve the branded id to colors where presets are applied**

Find where a preset id is turned into a color array (search for `tableau10`/`schemeTableau10` or where `PALETTE_PRESETS` ids feed Observable Plot). Add a branch so `"teal-gold"` resolves to the branded array. Import it:

```jsx
import { PLOT_PALETTES } from "../theme.js";
```

At the resolution site, before the Observable scheme lookup:

```js
if (paletteId === "teal-gold") return PLOT_PALETTES["teal-gold"];
```

(Use the exact local variable name found in step 3 for `paletteId`.)

- [ ] **Step 4: Build + browser validation**

Run: `cd "C:/Franco/econsolver" && npm run build` (expect success). In browser:
- New plot defaults to the palette chosen in AppearancePanel.
- "Teal-Gold" appears in the palette dropdown and renders the branded colors.

- [ ] **Step 5: Commit**

```bash
git add src/components/PlotBuilder.jsx
git commit -m "feat(viz): plot palette defaults from appearance prefs + branded teal-gold"
```

---

## Task 7: Drift cleanup — batch 1 (high-traffic chrome)

**Files (modify, one commit per file):**
- `src/WranglingModule.jsx` (header block ~line 432-460)
- `src/App.jsx`
- `src/components/workspace/WorkspaceBar.jsx`
- `src/components/modeling/resultDisplay.jsx`
- `src/components/modeling/ModelComparison.jsx`

- [ ] **Step 1: Find hardcoded literals per file**

For each file, search for hardcoded hex (`#080808`, `#0f0f0f`, `#1c1c1c`, `#6ec8b4`, `#c8a96e`, `#c8b46e`, `#ddd8cc`, `#888`, `#444`) and raw font/size literals (`fontFamily:` mono string, `fontSize:9`, `letterSpacing:"0.26em"`, etc.).

- [ ] **Step 2: Replace with tokens**

In each file ensure `const { C, T, space } = useTheme();` is in scope, then:
- hex → nearest `C.*` (e.g. `#080808`→`C.bg`, `#6ec8b4`→`C.teal`, `#c8a96e`→`C.gold`, `#c8b46e`→`C.yellow`, `#ddd8cc`→`C.text`, `#888`→`C.textDim`, `#444`→`C.textMuted`).
- the small uppercase tracked label (e.g. WranglingModule line 435: `fontSize:9, color:"#6ec8b4", letterSpacing:"0.26em", textTransform:"uppercase"`) → spread `...T.label` and override color with `C.teal`.
- numeric paddings/margins that match the scale → `space[n]` (leave non-matching values as-is).

Do NOT change values inside `theme.js`. Keep edits surgical (CLAUDE.md: surgical patches).

- [ ] **Step 3: Build + browser validation per file**

Run: `cd "C:/Franco/econsolver" && npm run build`. In browser, toggle **dark AND light** themes and confirm the migrated surface now themes correctly (previously light theme leaked dark hardcoded colors). Confirm numbers still render mono.

- [ ] **Step 4: Commit (per file)**

```bash
git add <file>
git commit -m "refactor(theme): migrate <file> to design tokens"
```

---

## Task 8: Drift cleanup — batch 2 (lower priority)

**Files (modify, one commit per file):**
- `src/components/tabs/spatial/map/SpatialPlotTab.jsx`
- `src/components/tabs/spatial/map/layers.js`
- `src/components/tabs/spatial/plot/GeoPlotCanvas.jsx`
- `src/components/tabs/spatial/plot/geo.js`
- `src/components/modeling/EstimatorSidebar.jsx`
- `src/math/EstimationResult.js` (only if it carries display hex; leave pure-math values)
- `src/components/tabs/spatial/analyze/_parked/SpatialMapSection.jsx`

- [ ] **Step 1: Per file, replace hardcoded hex with `C.*` tokens**

Same procedure as Task 7 Step 2. For non-React `.js` files (`layers.js`, `geo.js`) that can't call `useTheme()`, leave palette constants as-is IF they are data-viz palettes (not chrome) — only migrate if they style UI chrome. Note any file intentionally skipped.

- [ ] **Step 2: Build + browser validation per file**

Run: `cd "C:/Franco/econsolver" && npm run build`. Browser-check the spatial map/plot + sidebar in both themes.

- [ ] **Step 3: Commit (per file)**

```bash
git add <file>
git commit -m "refactor(theme): migrate <file> to design tokens"
```

---

## Task 9: Author root `DESIGN.md`

**Files:**
- Create: `DESIGN.md` (project root)

- [ ] **Step 1: Write `DESIGN.md` in the 9-section awesome-design-md format**

Create `DESIGN.md` with these nine sections, filled from the token system above (no placeholders):
1. **Visual Theme & Atmosphere** — privacy-first econometrics research tool; dark-first, "researcher-serious", sharp, low-chrome, data-forward.
2. **Color Palette & Roles** — list `C` tokens for DARK + LIGHT (bg/surface/surface2/3, border/border2, gold/goldDim/goldFaint, text/textDim/textMuted, teal/green/red/yellow/blue/purple/orange/violet) with usage roles.
3. **Typography Rules** — sans (IBM Plex Sans) for chrome/prose; **mono (IBM Plex Mono) strictly for data/numbers/code**; the role scale table from the spec (display/h1/h2/h3/body/label/data/code/caption); tabular-nums on data.
4. **Component Stylings** — buttons/chips/badges/inputs/cards built from tokens; sharp radii (`RADIUS`); 1px borders + `elev` ladder.
5. **Layout Principles** — `SPACE` 4px scale; density multiplier; inline styles only, no CSS framework.
6. **Depth & Elevation** — the `elev` ladder (flat/raised/popover/modal/tooltip); dark leans on lighter top-borders + faint shadow, light uses soft shadows.
7. **Design Do's and Don'ts** — DO use tokens via `useTheme()`; DON'T hardcode hex or font literals; DON'T use mono for prose or sans for numbers; DON'T add a UI framework.
8. **Responsive Behavior** — existing ResizeObserver patterns; panels reflow; min-font clamp.
9. **Agent Prompt Guide** — instruction block telling an AI agent to read tokens from `src/theme.js`, consume them via `useTheme()`, never hardcode, respect the sans/mono split.

- [ ] **Step 2: Commit**

```bash
git add DESIGN.md
git commit -m "docs: author root DESIGN.md (design system for AI consistency)"
```

---

## Task 10: Final validation pass + spec/index status

**Files:**
- Modify: `ClaudePlan.md` (Spec & Plan Index row for this spec)

- [ ] **Step 1: Full matrix browser check**

In browser, walk the migrated surfaces across the matrix:
- themes: dark, light
- densities: compact, comfortable
- fonts: IBM Plex Sans, Inter, Geist

Confirm: chrome uses the chosen sans; numbers/tables stay mono+tabular; no hardcoded-color leakage on migrated surfaces; elevation visible on popover/modal; prefs persist across reload; Reset restores baseline.

- [ ] **Step 2: Re-run token harness**

Run: `cd "C:/Franco/econsolver" && node src/__validation__/themeTokens.test.mjs`
Expected: `9/9 token checks passed`.

- [ ] **Step 3: Update the Spec & Plan Index status**

In `ClaudePlan.md`, change this spec's row status from `OPEN` to `DONE (browser-validation pending Franco)` (or `DONE` once Franco signs off), noting which drift files were migrated vs deferred.

- [ ] **Step 4: Commit**

```bash
git add ClaudePlan.md
git commit -m "docs: mark design-language-refresh spec status + migration notes"
```

---

## Self-Review Notes (author check)

- **Spec coverage:** token model → T1; harness → T2; ThemeContext+prefs+persistence+fonts → T3; config panel (theme/text/viz/reset, gear entry) → T4/T5; plot palette → T6; drift cleanup incremental high-then-low → T7/T8; DESIGN.md → T9; validation matrix → T10. All spec sections mapped.
- **Deferred per spec (no task, intentional):** accent-color customization; B/C/D; full migration of every deep-corner file (T8 explicitly allows skips).
- **Type consistency:** `buildTokens()` signature `{theme,sansFont,density}` and returned `{T,space,radius,elev}` used identically in T2/T3/T4. `prefs` shape `{sansFont,density,plotPalette}` consistent across T3/T4/T5/T6. `PLOT_PALETTES["teal-gold"]` defined T1, consumed T6.
- **Open recon dependency:** T5/T6 require reading the exact local variable names in `WorkspaceBar.jsx` and `PlotBuilder.jsx` (palette state var) at execution time — steps instruct the executor to locate them; no fabricated names committed.
