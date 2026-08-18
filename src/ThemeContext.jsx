// ─── ECON STUDIO · src/ThemeContext.jsx ───────────────────────────────────────
// Provides { C, T, space, radius, elev, theme, setTheme, prefs, setPrefs }.
// theme persisted under "econ_theme"; appearance prefs under "econ_prefs".
//
// The context VALUE SHAPE is load-bearing — 104 components destructure it. Add
// keys freely; never rename or remove one.

import { createContext, useContext, useState, useEffect, useMemo, useCallback } from "react";
import { DARK, getPalette, buildTokens } from "./theme.js";

const THEME_KEY = "econ_theme";
const PREFS_KEY = "econ_prefs";
const DEFAULT_PREFS = {
  sansFont: "IBM Plex Sans",
  monoFont: "IBM Plex Mono",
  density: "comfortable",
  plotPalette: "teal-gold",
};

const initialTokens = buildTokens({ theme: "dark", ...DEFAULT_PREFS });
const ThemeCtx = createContext({
  C: DARK, theme: "dark", setTheme: () => {},
  prefs: DEFAULT_PREFS, setPrefs: () => {},
  ...initialTokens,
});

function loadPrefs() {
  try {
    const raw = localStorage.getItem(PREFS_KEY);
    // Spread over defaults so a pref added after a user's prefs were persisted
    // (e.g. monoFont) resolves rather than coming back undefined.
    return raw ? { ...DEFAULT_PREFS, ...JSON.parse(raw) } : DEFAULT_PREFS;
  } catch { return DEFAULT_PREFS; }
}

// ─── Font loading ────────────────────────────────────────────────────────────
// The baseline pair (Plex Sans + Plex Mono) is preloaded statically in
// index.html so the first paint already has it — injecting it here meant every
// cold load painted in system-ui and then reflowed. Non-default families load
// on demand, only when actually selected.
const FONT_HREFS = {
  "Inter":             "https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600&display=swap",
  "Geist":             "https://fonts.googleapis.com/css2?family=Geist:wght@400;500;600&display=swap",
  "Plus Jakarta Sans": "https://fonts.googleapis.com/css2?family=Plus+Jakarta+Sans:wght@400;500;600&display=swap",
  "JetBrains Mono":    "https://fonts.googleapis.com/css2?family=JetBrains+Mono:wght@400;500&display=swap",
};

function ensureFont(family) {
  const href = FONT_HREFS[family];
  if (!href) return; // baseline families are already in index.html
  const id = "econ-font-" + family.replace(/\s+/g, "-");
  if (document.getElementById(id)) return;
  const link = document.createElement("link");
  link.id = id;
  link.rel = "stylesheet";
  link.href = href;
  link.crossOrigin = "anonymous";
  document.head.appendChild(link);
}

/**
 * Load every offered family, not just the selected one.
 *
 * On-demand loading is right for the app at large, but it breaks the one surface
 * that has to render several families at once: the font pickers in
 * AppearancePanel preview each option in its own face, and an unselected family
 * has no @font-face registered at all — so all four non-baseline chips rendered
 * in the fallback and looked broken. You could not see what you were choosing
 * until after you chose it.
 *
 * Call this when a surface needs the whole set. Deliberately NOT called at boot:
 * it is four extra stylesheet + woff2 fetches, worth paying only at the moment
 * the user opens the appearance controls.
 */
export function preloadAllFonts() {
  for (const family of Object.keys(FONT_HREFS)) ensureFont(family);
}

export function ThemeProvider({ children }) {
  const [theme, setThemeState] = useState(() => {
    try { return localStorage.getItem(THEME_KEY) === "light" ? "light" : "dark"; }
    catch { return "dark"; }
  });
  const [prefs, setPrefsState] = useState(loadPrefs);

  const setTheme = useCallback((t) => {
    setThemeState(t);
    try { localStorage.setItem(THEME_KEY, t); } catch {}
  }, []);

  const setPrefs = useCallback((patch) => {
    setPrefsState((p) => {
      const next = { ...p, ...patch };
      try { localStorage.setItem(PREFS_KEY, JSON.stringify(next)); } catch {}
      return next;
    });
  }, []);

  // Memoised deliberately, and it is not just a micro-optimisation.
  //
  // buildTokens() allocates a fresh T/space/radius/elev on every call, so without
  // this every ThemeProvider render produced new object identities for all of
  // them — which (a) re-rendered all ~100 useTheme consumers on any provider
  // render, and (b) made C/T unusable in a dependency array, since an effect
  // depending on them would re-run forever. PlotBuilder's render effect needs
  // exactly that dependency to redraw when the theme changes, so stable
  // identities are a correctness requirement, not a perf tweak.
  const C = useMemo(() => getPalette(theme), [theme]);
  const { T, space, radius, elev } = useMemo(
    () => buildTokens({
      theme, sansFont: prefs.sansFont, monoFont: prefs.monoFont, density: prefs.density,
    }),
    [theme, prefs.sansFont, prefs.monoFont, prefs.density],
  );

  // Load whichever non-baseline families are currently selected.
  useEffect(() => { ensureFont(prefs.sansFont); }, [prefs.sansFont]);
  useEffect(() => { ensureFont(prefs.monoFont); }, [prefs.monoFont]);

  // Bridge palette tokens to CSS custom properties. index.css needs these for
  // rules that cannot be expressed inline: scrollbar chrome, :focus-visible.
  // data-theme drives `color-scheme`, which controls how native form controls
  // (date pickers, selects) render their own chrome.
  useEffect(() => {
    const root = document.documentElement;
    root.setAttribute("data-theme", theme);
    root.style.setProperty("--c-bg", C.bg);
    root.style.setProperty("--c-surface", C.surface);
    root.style.setProperty("--c-border", C.border);
    root.style.setProperty("--c-border2", C.border2);
    root.style.setProperty("--c-border3", C.border3);
    root.style.setProperty("--c-text", C.text);
    root.style.setProperty("--c-gold", C.gold);
  }, [theme, C]);

  // Sync body background + base font so the area outside the React root matches
  // (overscroll gutters, the strip below a short page).
  useEffect(() => { document.body.style.background = C.bg; }, [C.bg]);
  useEffect(() => { document.body.style.color = C.text; }, [C.text]);
  useEffect(() => { document.body.style.fontFamily = T.body.fontFamily; }, [T.body.fontFamily]);

  const value = useMemo(
    () => ({ C, T, space, radius, elev, theme, setTheme, prefs, setPrefs }),
    [C, T, space, radius, elev, theme, setTheme, prefs, setPrefs],
  );

  return <ThemeCtx.Provider value={value}>{children}</ThemeCtx.Provider>;
}

export function useTheme() { return useContext(ThemeCtx); }
