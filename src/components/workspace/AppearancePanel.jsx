import { useEffect } from "react";
import { useTheme, preloadAllFonts } from "../../ThemeContext.jsx";
import { SANS_STACK, MONO_STACKS, PALETTES } from "../../theme.js";

// Derived from the registries so adding a font or a palette to theme.js surfaces
// here automatically — the previous hardcoded arrays were a second place to
// forget to update.
const SANS_OPTS    = Object.keys(SANS_STACK);
const MONO_OPTS    = Object.keys(MONO_STACKS);
const THEME_OPTS   = Object.keys(PALETTES);
const DENSITY_OPTS = ["compact", "comfortable"];
const PALETTE_OPTS = ["teal-gold", "observable", "tableau"];
const DEFAULTS = {
  sansFont: "IBM Plex Sans",
  monoFont: "IBM Plex Mono",
  density: "comfortable",
  plotPalette: "teal-gold",
};

export default function AppearancePanel({ onClose }) {
  const { C, T, space, radius, elev, theme, setTheme, prefs, setPrefs } = useTheme();

  // Every font chip below previews itself in its own family, but the app only
  // loads the family it is currently using. Without this the four non-baseline
  // chips render in the fallback face — you cannot see what you are picking
  // until you have already picked it.
  useEffect(() => { preloadAllFonts(); }, []);

  const wrap = {
    position: "absolute", top: "100%", right: 0, marginTop: space[2],
    width: 320, background: C.surface, ...elev.popover,
    borderRadius: radius.md, padding: space[5], zIndex: 1000,
    display: "flex", flexDirection: "column", gap: space[5],
    maxHeight: "78vh", overflowY: "auto",
  };
  const sectionLbl = { ...T.label, color: C.textDim, marginBottom: space[2] };
  const row = { display: "flex", gap: space[2], flexWrap: "wrap" };

  const chip = (active) => ({
    ...T.caption, padding: `${space[2]}px ${space[3]}px`,
    border: active ? `1px solid ${C.gold}` : `1px solid ${C.border2}`,
    color: active ? C.gold : C.textDim,
    background: active ? C.goldFaint : "transparent",
    borderRadius: radius.sm, cursor: "pointer",
  });

  // Each font chip previews itself, so the choice is visible before committing.
  const fontChip = (active, stack) => ({ ...chip(active), fontFamily: stack });

  return (
    <div style={wrap} onClick={(e) => e.stopPropagation()}>
      {/* Theme */}
      <div>
        <div style={sectionLbl}>Theme</div>
        <div style={row}>
          {THEME_OPTS.map((t) => (
            <button key={t} style={chip(theme === t)} onClick={() => setTheme(t)}>{t}</button>
          ))}
        </div>
      </div>

      {/* Text */}
      <div>
        <div style={sectionLbl}>Text · Interface font</div>
        <div style={row}>
          {SANS_OPTS.map((f) => (
            <button key={f} style={fontChip(prefs.sansFont === f, SANS_STACK[f])}
              onClick={() => setPrefs({ sansFont: f })}>{f}</button>
          ))}
        </div>

        <div style={{ ...sectionLbl, marginTop: space[4] }}>Text · Data &amp; code font</div>
        <div style={row}>
          {MONO_OPTS.map((f) => (
            <button key={f} style={fontChip(prefs.monoFont === f, MONO_STACKS[f])}
              onClick={() => setPrefs({ monoFont: f })}>{f}</button>
          ))}
        </div>

        <div style={{ ...sectionLbl, marginTop: space[4] }}>Text · Density</div>
        <div style={row}>
          {DENSITY_OPTS.map((d) => (
            <button key={d} style={chip(prefs.density === d)} onClick={() => setPrefs({ density: d })}>{d}</button>
          ))}
        </div>

        {/* Live preview — shows the sans/mono split and tabular figures together,
            since the two fonts are chosen independently and have to sit well
            next to each other. */}
        <div style={{ marginTop: space[3], padding: space[3], background: C.surface2,
                      border: `1px solid ${C.border}`, borderRadius: radius.sm }}>
          <div style={{ ...T.h2, color: C.text }}>Aa Heading</div>
          <div style={{ ...T.body, color: C.textDim }}>Body sample — clarity &amp; sharpness.</div>
          <div style={{ ...T.data, color: C.teal, marginTop: space[2] }}>β  0.42531</div>
          <div style={{ ...T.data, color: C.teal }}>SE 0.01230</div>
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
