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
          <div style={{ ...T.body, color: C.textDim }}>Body sample — clarity &amp; sharpness.</div>
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
