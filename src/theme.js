// ─── ECON STUDIO · src/theme.js ───────────────────────────────────────────────
// Two complete color palettes. Import DARK / LIGHT; pass via ThemeContext.
// No React. No side effects.

export const DARK = {
  bg:        "#080808",
  surface:   "#0f0f0f",
  surface2:  "#131313",
  surface3:  "#161616",
  border:    "#1c1c1c",
  border2:   "#252525",
  gold:      "#c8a96e",
  goldDim:   "#7a6040",
  goldFaint: "#1a1408",
  text:      "#ddd8cc",
  textDim:   "#888",
  textMuted: "#444",
  green:     "#7ab896",
  red:       "#c47070",
  yellow:    "#c8b46e",
  blue:      "#6e9ec8",
  purple:    "#a87ec8",
  teal:      "#6ec8b4",
  orange:    "#c88e6e",
  violet:    "#9e7ec8",
};

export const LIGHT = {
  bg:        "#f4f3f0",
  surface:   "#ffffff",
  surface2:  "#f0eeeb",
  surface3:  "#eceae6",
  border:    "#d8d5cf",
  border2:   "#c8c4bc",
  gold:      "#a07020",
  goldDim:   "#c8a050",
  goldFaint: "#fdf5e0",
  text:      "#1a1814",
  textDim:   "#555",
  textMuted: "#999",
  green:     "#2e7850",
  red:       "#a03030",
  yellow:    "#807010",
  blue:      "#2060a0",
  purple:    "#6030a0",
  teal:      "#1e7868",
  orange:    "#904020",
  violet:    "#503090",
};

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
