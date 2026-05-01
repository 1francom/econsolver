// ─── ECON STUDIO · src/ThemeContext.jsx ───────────────────────────────────────
// Provides { C, theme, setTheme } to every component in the tree.
// Preference persisted in localStorage under key "econ_theme".

import { createContext, useContext, useState } from "react";
import { DARK, LIGHT } from "./theme.js";

const LS_KEY = "econ_theme";

const ThemeCtx = createContext({ C: DARK, theme: "dark", setTheme: () => {} });

export function ThemeProvider({ children }) {
  const [theme, setThemeState] = useState(() => {
    try { return localStorage.getItem(LS_KEY) === "light" ? "light" : "dark"; }
    catch { return "dark"; }
  });

  function setTheme(t) {
    setThemeState(t);
    try { localStorage.setItem(LS_KEY, t); } catch {}
  }

  const C = theme === "light" ? LIGHT : DARK;

  return (
    <ThemeCtx.Provider value={{ C, theme, setTheme }}>
      {children}
    </ThemeCtx.Provider>
  );
}

export function useTheme() {
  return useContext(ThemeCtx);
}
