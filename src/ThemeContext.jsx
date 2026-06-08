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
  link.crossOrigin = "anonymous";
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
