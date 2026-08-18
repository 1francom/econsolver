// ─── ECON STUDIO · src/theme.js ───────────────────────────────────────────────
// Palette registry + typography + elevation. Import via ThemeContext, not directly.
// No React. No side effects.
//
// ADDING A PALETTE (e.g. a cool Slate/Zinc axis later):
//   1. Define the object with the SAME keys as DARK (every key is load-bearing —
//      104 components read them by name).
//   2. Add it to PALETTES. That is the whole change.
//   Elevation, plot palettes and AppearancePanel all derive from the registry, so
//   nothing else needs to be touched. Do NOT hardcode a hex in ELEV_* or a
//   component — that is what desynced borders from the palette before.

// ─── Palettes ────────────────────────────────────────────────────────────────
// Warm axis: gold + teal accents on a warm near-black / warm off-white ground.
// The greys carry a slight warm cast so they sit under the gold accent without
// going muddy. A cool (Slate/Zinc) axis is deliberately NOT mixed in here — cool
// greys fight the gold. It would be a separate PALETTES entry.

export const DARK = {
  // Surface ladder — bg is the canvas; each step reads as one level nearer.
  // Deliberately NOT pure black: #080808 caused halation against light text on
  // OLED/high-contrast displays and left only 7 units of headroom for the whole
  // ladder, so nested panels were visually indistinguishable.
  bg:        "#0a0a09",
  surface:   "#111110",
  surface2:  "#161615",
  surface3:  "#1c1c1a",
  border:    "#232320",
  border2:   "#2e2e2a",
  border3:   "#3a3a35",   // strongest hairline — modal / tooltip outlines
  gold:      "#c8a96e",
  goldDim:   "#7a6040",
  goldFaint: "#1a1408",
  text:      "#ddd8cc",
  textDim:   "#9a948a",   // warm-shifted; the old neutral #888 read cooler than primary text
  textMuted: "#706b62",   // was #444 — ~2.2:1 on surface, failed every contrast floor
  green:     "#7ab896",
  red:       "#c47070",
  redFaint:  "#1c0d0d",
  yellow:    "#c8b46e",
  blue:      "#6e9ec8",
  purple:    "#a87ec8",
  teal:      "#6ec8b4",
  orange:    "#c88e6e",
  orangeFaint: "#1a1108",
  violet:    "#9e7ec8",
  violetFaint: "#140f1a",
};

export const LIGHT = {
  // On light the canvas must be the DARKEST tone so panels read as floating above
  // it. The old ladder had bg #f4f3f0 > surface2 #f0eeeb, so a panel nested inside
  // a card appeared to sink BELOW the app background — depth inverted.
  bg:        "#eeece7",
  surface:   "#ffffff",
  surface2:  "#f7f6f3",
  surface3:  "#f1efeb",
  border:    "#dcd8d0",
  border2:   "#c9c4ba",
  border3:   "#b3ada1",
  gold:      "#a07020",
  goldDim:   "#c8a050",
  goldFaint: "#fdf5e0",
  text:      "#1a1814",
  textDim:   "#555555",
  textMuted: "#7a746a",   // was #999 — ~2.8:1 on white, failed AA
  green:     "#2e7850",
  red:       "#a03030",
  redFaint:  "#fceaea",
  yellow:    "#807010",
  blue:      "#2060a0",
  purple:    "#6030a0",
  teal:      "#1e7868",
  orange:    "#904020",
  orangeFaint: "#fcefe6",
  violet:    "#503090",
  violetFaint: "#f0eafa",
};

// The registry. Keys are the `theme` values persisted under "econ_theme".
export const PALETTES = { dark: DARK, light: LIGHT };

/** Resolve a theme name to its palette, falling back to DARK. */
export function getPalette(theme) { return PALETTES[theme] ?? DARK; }

/** True when the given theme is a dark-ground palette (drives elevation strategy). */
export function isDarkTheme(theme) { return theme !== "light"; }

// ─── Typography ──────────────────────────────────────────────────────────────
// Sans is user-switchable. Mono is user-switchable too — in a tool whose entire
// output is numeric, the mono choice matters more than the sans one.
export const SANS_STACK = {
  "IBM Plex Sans":     "'IBM Plex Sans', system-ui, -apple-system, sans-serif",
  "Inter":             "'Inter', system-ui, -apple-system, sans-serif",
  "Geist":             "'Geist', system-ui, -apple-system, sans-serif",
  "Plus Jakarta Sans": "'Plus Jakarta Sans', system-ui, -apple-system, sans-serif",
};

export const MONO_STACKS = {
  "IBM Plex Mono":  "'IBM Plex Mono', ui-monospace, 'SFMono-Regular', monospace",
  "JetBrains Mono": "'JetBrains Mono', ui-monospace, 'SFMono-Regular', monospace",
};

// Retrocompat: the default mono stack as a bare string. Prefer T.code.fontFamily /
// T.data.fontFamily in components — this constant CANNOT follow the user's choice.
export const MONO_STACK = MONO_STACKS["IBM Plex Mono"];

// role → base spec. fam: "sans" | "monospace". size in px (pre-density).
export const TYPE_ROLES = {
  display: { fam: "sans", size: 28, weight: 600, ls: "-0.01em", lh: 1.2  },
  h1:      { fam: "sans", size: 20, weight: 600, ls: "-0.01em", lh: 1.25 },
  h2:      { fam: "sans", size: 15, weight: 600, ls: "0",       lh: 1.3  },
  h3:      { fam: "sans", size: 13, weight: 500, ls: "0",       lh: 1.3  },
  body:    { fam: "sans", size: 13, weight: 400, ls: "0",       lh: 1.5  },
  // 0.2em on 10px caps was extremely open — it read as decorative rather than
  // structural, and at compact density the words came apart.
  label:   { fam: "sans", size: 10, weight: 500, ls: "0.12em",  lh: 1.3, transform: "uppercase" },
  data:    { fam: "monospace", size: 13, weight: 400, ls: "0",  lh: 1.4, tnum: true },
  code:    { fam: "monospace", size: 12, weight: 400, ls: "0",  lh: 1.5  },
  caption: { fam: "sans", size: 10, weight: 400, ls: "0.03em",  lh: 1.4  },
};

// ─── Spacing / radius / density ──────────────────────────────────────────────
export const SPACE  = [0, 2, 4, 8, 12, 16, 24, 32, 48];
export const RADIUS = { none: 0, sm: 2, md: 4, lg: 6, xl: 10 };
export const DENSITY = { compact: 0.88, comfortable: 1 };
export const MIN_FONT = 9; // px floor so compact density never makes text unreadable

// ─── Elevation ───────────────────────────────────────────────────────────────
/**
 * Build the elevation ladder FROM the active palette.
 *
 * Previously ELEV_DARK/ELEV_LIGHT hardcoded border hexes that duplicated palette
 * values, so refining a palette silently desynced every border — and the modal /
 * tooltip levels referenced #2e2e2e, a colour with no token at all. Deriving from
 * C.border* means a new palette gets a correct ladder for free.
 *
 * @param {object} C      active palette
 * @param {string} theme  theme name (only its dark/light nature is used)
 */
export function buildElevation(C, theme) {
  if (isDarkTheme(theme)) {
    // On a near-black ground a dark drop shadow is nearly invisible, so depth is
    // carried by a lighter border plus a hairline top highlight (surface catching
    // light from above). Real shadows start at popover level.
    return {
      flat:    { border: `1px solid ${C.border}`,  boxShadow: "none" },
      raised:  { border: `1px solid ${C.border2}`, boxShadow: "inset 0 1px 0 rgba(255,255,255,0.045)" },
      popover: { border: `1px solid ${C.border2}`, boxShadow: "0 8px 24px rgba(0,0,0,0.62), 0 2px 6px rgba(0,0,0,0.4)" },
      modal:   { border: `1px solid ${C.border3}`, boxShadow: "0 18px 52px rgba(0,0,0,0.72), 0 4px 14px rgba(0,0,0,0.5)" },
      tooltip: { border: `1px solid ${C.border3}`, boxShadow: "0 4px 14px rgba(0,0,0,0.52)" },
    };
  }
  // On light, conventional drop shadows behave as expected. Two-layer shadows
  // (tight contact + broad diffuse) read as depth; a single broad one reads as blur.
  return {
    flat:    { border: `1px solid ${C.border}`,  boxShadow: "none" },
    raised:  { border: `1px solid ${C.border}`,  boxShadow: "0 1px 2px rgba(28,25,20,0.05), 0 1px 1px rgba(28,25,20,0.03)" },
    popover: { border: `1px solid ${C.border2}`, boxShadow: "0 8px 24px rgba(28,25,20,0.12), 0 2px 6px rgba(28,25,20,0.07)" },
    modal:   { border: `1px solid ${C.border2}`, boxShadow: "0 18px 52px rgba(28,25,20,0.18), 0 4px 14px rgba(28,25,20,0.1)" },
    tooltip: { border: `1px solid ${C.border2}`, boxShadow: "0 4px 14px rgba(28,25,20,0.13)" },
  };
}

// Retrocompat: pre-built ladders for the two shipped palettes. Derived, not literal.
export const ELEV_DARK  = buildElevation(DARK,  "dark");
export const ELEV_LIGHT = buildElevation(LIGHT, "light");

// ─── Plot palettes (viz config) ──────────────────────────────────────────────
// null sentinel = defer to PlotBuilder's own named scheme. Branded first.
export const PLOT_PALETTES = {
  "teal-gold":  ["#6ec8b4", "#c8a96e", "#6e9ec8", "#a87ec8", "#c88e6e", "#7ab896"],
  "observable": null, // maps to PlotBuilder's existing "observable10" scheme
  "tableau":    null, // maps to PlotBuilder's existing "tableau10" scheme
};

// ─── Token builder ───────────────────────────────────────────────────────────
// Pure. Given user prefs + theme name, returns { T, space, radius, elev }.
export function buildTokens({
  theme = "dark",
  sansFont = "IBM Plex Sans",
  monoFont = "IBM Plex Mono",
  density = "comfortable",
} = {}) {
  const mult = DENSITY[density] ?? 1;
  const sans = SANS_STACK[sansFont] ?? SANS_STACK["IBM Plex Sans"];
  const mono = MONO_STACKS[monoFont] ?? MONO_STACKS["IBM Plex Mono"];
  const T = {};
  for (const role in TYPE_ROLES) {
    const r = TYPE_ROLES[role];
    T[role] = {
      fontFamily: r.fam === "monospace" ? mono : sans,
      fontSize: Math.max(MIN_FONT, Math.round(r.size * mult)) + "px",
      fontWeight: r.weight,
      letterSpacing: r.ls,
      lineHeight: r.lh,
      ...(r.transform ? { textTransform: r.transform } : {}),
      // Tabular figures keep coefficient columns aligned on the decimal point;
      // the slashed zero disambiguates 0/O in output that gets read off-screen.
      // Both degrade to a no-op on fonts lacking the feature.
      ...(r.tnum ? { fontVariantNumeric: "tabular-nums slashed-zero" } : {}),
    };
  }
  const space = SPACE.map((s) => Math.round(s * mult));
  const C = getPalette(theme);
  return { T, space, radius: RADIUS, elev: buildElevation(C, theme) };
}
