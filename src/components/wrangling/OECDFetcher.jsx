// ─── ECON STUDIO · components/wrangling/OECDFetcher.jsx ─────────────────────
// Modal for fetching OECD Data indicators (SDMX-JSON API).
//
// Props:
//   onLoad(filename, rows, headers)
//   onClose()

import { useState, useEffect } from "react";
import { POPULAR_OECD, OECD_GROUPS, fetchMultipleOECD } from "../../services/data/fetchers/oecd.js";

const C = {
  bg:"#080808", surface:"#0f0f0f", surface2:"#131313", surface3:"#161616",
  border:"#1c1c1c", border2:"#252525",
  gold:"#c8a96e", blue:"#6e9ec8",
  text:"#ddd8cc", textDim:"#888", textMuted:"#444",
  green:"#7ab896", red:"#c47070", teal:"#6ec8b4",
};
const mono = "'IBM Plex Mono','JetBrains Mono',Consolas,monospace";

// OECD member countries (ISO2 codes)
const OECD_MEMBERS = [
  "AUS","AUT","BEL","CAN","CHL","COL","CRI","CZE","DNK","EST",
  "FIN","FRA","DEU","GRC","HUN","ISL","IRL","ISR","ITA","JPN",
  "KOR","LVA","LTU","LUX","MEX","NLD","NZL","NOR","POL","PRT",
  "SVK","SVN","ESP","SWE","CHE","TUR","GBR","USA",
];

const COUNTRY_SETS = [
  { label: "All OECD members (38)", codes: OECD_MEMBERS },
  { label: "G7",   codes: ["CAN","FRA","DEU","ITA","JPN","GBR","USA"] },
  { label: "EU15", codes: ["AUT","BEL","DNK","FIN","FRA","DEU","GRC","IRL","ITA","LUX","NLD","PRT","ESP","SWE","GBR"] },
  { label: "Nordic", codes: ["DNK","FIN","ISL","NOR","SWE"] },
  { label: "Southern Europe", codes: ["GRC","ITA","PRT","ESP"] },
  { label: "Anglosphere", codes: ["AUS","CAN","IRL","NZL","GBR","USA"] },
];

function Tag({ label, onRemove, color = C.blue }) {
  return (
    <span style={{ display:"inline-flex", alignItems:"center", gap:4, padding:"2px 8px", background:`${color}18`, border:`1px solid ${color}40`, borderRadius:3, fontSize:10, color, fontFamily:mono }}>
      {label}
      <button onClick={onRemove} style={{ background:"none", border:"none", color, cursor:"pointer", fontSize:11, lineHeight:1, padding:0 }}>×</button>
    </span>
  );
}

function Spinner() {
  return <div style={{ width:14, height:14, border:`2px solid ${C.border2}`, borderTopColor:C.gold, borderRadius:"50%", animation:"spin 0.7s linear infinite", flexShrink:0 }} />;
}

export default function OECDFetcher({ onLoad, onClose }) {
  const [selected,   setSelected]   = useState([]);
  const [groupFilter, setGroupFilter] = useState("All");
  const [countrySet, setCountrySet] = useState(0);
  const [startYear,  setStartYear]  = useState(2000);
  const [endYear,    setEndYear]    = useState(2023);
  const [step,       setStep]       = useState("pick");   // "pick" | "fetching" | "error"
  const [error,      setError]      = useState("");

  useEffect(() => {
    const h = e => { if (e.key === "Escape") onClose(); };
    window.addEventListener("keydown", h);
    return () => window.removeEventListener("keydown", h);
  }, [onClose]);

  const visible = groupFilter === "All"
    ? POPULAR_OECD
    : POPULAR_OECD.filter(d => d.group === groupFilter);

  function toggle(ind) {
    setSelected(prev => {
      const exists = prev.find(s => s.id === ind.id);
      if (exists) return prev.filter(s => s.id !== ind.id);
      if (prev.length >= 6) return prev;
      return [...prev, ind];
    });
  }

  async function handleFetch() {
    if (!selected.length) return;
    setStep("fetching");
    setError("");
    try {
      const opts = { countries: COUNTRY_SETS[countrySet].codes, startYear, endYear };
      const { rows, headers } = await fetchMultipleOECD(selected, opts);
      const label = selected.length === 1 ? selected[0].name.slice(0, 40) : `OECD_${selected.length}indicators`;
      onLoad(`${label}_${startYear}-${endYear}.csv`, rows, headers);
      onClose();
    } catch (e) {
      setError(e.message ?? "Fetch failed.");
      setStep("error");
    }
  }

  return (
    <div onClick={onClose} style={{ position:"fixed", inset:0, zIndex:400, background:"rgba(0,0,0,0.82)", display:"flex", alignItems:"center", justifyContent:"center" }}>
      <div onClick={e => e.stopPropagation()} style={{ width:"min(760px,96vw)", maxHeight:"90vh", background:C.surface, border:`1px solid ${C.border2}`, borderRadius:6, display:"flex", flexDirection:"column", overflow:"hidden", boxShadow:"0 20px 60px rgba(0,0,0,0.7)" }}>

        {/* Header */}
        <div style={{ display:"flex", alignItems:"center", gap:12, padding:"0.75rem 1.1rem", background:C.bg, borderBottom:`1px solid ${C.border}` }}>
          <div style={{ flex:1 }}>
            <div style={{ fontSize:9, color:C.textMuted, letterSpacing:"0.22em", textTransform:"uppercase", fontFamily:mono, marginBottom:2 }}>OECD Data · SDMX-JSON</div>
            <div style={{ fontSize:15, color:C.text, fontFamily:mono }}>Import OECD Indicators</div>
          </div>
          <button onClick={onClose} style={{ background:"none", border:`1px solid ${C.border2}`, borderRadius:3, color:C.textMuted, cursor:"pointer", fontFamily:mono, fontSize:11, padding:"0.25rem 0.6rem" }}>✕ Close</button>
        </div>

        <div style={{ flex:1, overflowY:"auto" }}>
          {/* Step 1: Pick indicators */}
          <div style={{ padding:"1rem 1.1rem", borderBottom:`1px solid ${C.border}` }}>
            <div style={{ fontSize:9, color:C.textMuted, letterSpacing:"0.18em", textTransform:"uppercase", fontFamily:mono, marginBottom:8 }}>
              1 · Select indicators <span style={{ color:C.textMuted }}>(up to 6)</span>
            </div>

            {/* Group filter pills */}
            <div style={{ display:"flex", flexWrap:"wrap", gap:4, marginBottom:8 }}>
              {["All", ...OECD_GROUPS].map(g => (
                <button key={g} onClick={() => setGroupFilter(g)}
                  style={{ padding:"2px 10px", borderRadius:20, background: groupFilter===g ? `${C.blue}22` : "transparent", border:`1px solid ${groupFilter===g ? C.blue : C.border2}`, color: groupFilter===g ? C.blue : C.textMuted, cursor:"pointer", fontFamily:mono, fontSize:9, transition:"all 0.1s" }}>
                  {g}
                </button>
              ))}
            </div>

            {/* Indicator list */}
            <div style={{ maxHeight:200, overflowY:"auto", border:`1px solid ${C.border}`, borderRadius:3 }}>
              {visible.map(ind => {
                const active = !!selected.find(s => s.id === ind.id);
                return (
                  <div key={ind.id} onClick={() => toggle(ind)}
                    style={{ display:"flex", alignItems:"flex-start", gap:10, padding:"0.42rem 0.75rem", cursor:"pointer", background: active ? `${C.blue}12` : "transparent", borderLeft: active ? `3px solid ${C.blue}` : "3px solid transparent", borderBottom:`1px solid ${C.border}`, transition:"all 0.1s" }}
                    onMouseEnter={e => { if(!active) e.currentTarget.style.background=C.surface2; }}
                    onMouseLeave={e => { if(!active) e.currentTarget.style.background="transparent"; }}>
                    <div style={{ width:14, height:14, flexShrink:0, marginTop:2, border:`1px solid ${active?C.blue:C.border2}`, borderRadius:2, background: active?C.blue:"transparent", display:"flex", alignItems:"center", justifyContent:"center" }}>
                      {active && <span style={{ color:C.bg, fontSize:9, lineHeight:1 }}>✓</span>}
                    </div>
                    <div style={{ flex:1 }}>
                      <div style={{ fontSize:11, color:C.text, fontFamily:mono }}>{ind.name}</div>
                      <div style={{ fontSize:9, color:C.textMuted, fontFamily:mono, marginTop:1 }}>{ind.dataset} · {ind.id}</div>
                    </div>
                    <span style={{ fontSize:8, color:C.textMuted, fontFamily:mono, flexShrink:0, marginTop:3, padding:"1px 6px", border:`1px solid ${C.border}`, borderRadius:10 }}>{ind.group}</span>
                  </div>
                );
              })}
            </div>

            {selected.length > 0 && (
              <div style={{ display:"flex", flexWrap:"wrap", gap:6, marginTop:8 }}>
                {selected.map(s => (
                  <Tag key={s.id} label={s.name.slice(0,38)+(s.name.length>38?"…":"")} color={C.blue}
                    onRemove={() => setSelected(p => p.filter(x => x.id !== s.id))} />
                ))}
              </div>
            )}
          </div>

          {/* Step 2: Options */}
          <div style={{ padding:"1rem 1.1rem", borderBottom:`1px solid ${C.border}` }}>
            <div style={{ fontSize:9, color:C.textMuted, letterSpacing:"0.18em", textTransform:"uppercase", fontFamily:mono, marginBottom:10 }}>2 · Options</div>
            <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr 1fr", gap:12 }}>
              <div>
                <div style={{ fontSize:9, color:C.textMuted, fontFamily:mono, marginBottom:4 }}>Countries</div>
                <select value={countrySet} onChange={e => setCountrySet(Number(e.target.value))}
                  style={{ width:"100%", padding:"0.38rem 0.6rem", background:C.surface2, border:`1px solid ${C.border2}`, borderRadius:3, color:C.text, fontFamily:mono, fontSize:11 }}>
                  {COUNTRY_SETS.map((s,i) => <option key={i} value={i}>{s.label}</option>)}
                </select>
              </div>
              <div>
                <div style={{ fontSize:9, color:C.textMuted, fontFamily:mono, marginBottom:4 }}>Start year</div>
                <input type="number" min={1970} max={endYear} value={startYear}
                  onChange={e => setStartYear(Math.max(1970, Math.min(endYear, Number(e.target.value))))}
                  style={{ width:"100%", padding:"0.38rem 0.6rem", background:C.surface2, border:`1px solid ${C.border2}`, borderRadius:3, color:C.text, fontFamily:mono, fontSize:11, boxSizing:"border-box" }} />
              </div>
              <div>
                <div style={{ fontSize:9, color:C.textMuted, fontFamily:mono, marginBottom:4 }}>End year</div>
                <input type="number" min={startYear} max={2024} value={endYear}
                  onChange={e => setEndYear(Math.min(2024, Math.max(startYear, Number(e.target.value))))}
                  style={{ width:"100%", padding:"0.38rem 0.6rem", background:C.surface2, border:`1px solid ${C.border2}`, borderRadius:3, color:C.text, fontFamily:mono, fontSize:11, boxSizing:"border-box" }} />
              </div>
            </div>
            {selected.length > 0 && (
              <div style={{ marginTop:10, padding:"0.5rem 0.75rem", background:C.surface3, border:`1px solid ${C.border}`, borderRadius:3, fontSize:10, color:C.textDim, fontFamily:mono }}>
                Output: <span style={{ color:C.gold }}>wide panel</span> · country, iso2, year
                {selected.map(s => <span key={s.id} style={{ color:C.blue }}>{", "}{s.id}</span>)}
                {" · "}{COUNTRY_SETS[countrySet].codes.length} countries · {endYear-startYear+1} years
              </div>
            )}
          </div>

          {/* Status */}
          {step === "fetching" && (
            <div style={{ padding:"0.8rem 1.1rem", display:"flex", alignItems:"center", gap:10, color:C.textDim, fontSize:11, fontFamily:mono }}>
              <Spinner />
              <span>Fetching from OECD API…  (may take 5–15 s for large requests)</span>
            </div>
          )}
          {step === "error" && (
            <div style={{ padding:"0.8rem 1.1rem", display:"flex", gap:8, background:"#0d0808", borderLeft:`3px solid ${C.red}`, fontSize:11, color:C.red, fontFamily:mono }}>
              <span>⚠ {error}</span>
              <button onClick={() => setStep("pick")} style={{ marginLeft:"auto", background:"none", border:`1px solid ${C.red}40`, borderRadius:2, color:C.red, cursor:"pointer", fontFamily:mono, fontSize:9, padding:"2px 8px" }}>Retry</button>
            </div>
          )}
        </div>

        {/* Footer */}
        <div style={{ padding:"0.65rem 1.1rem", background:C.bg, borderTop:`1px solid ${C.border}`, display:"flex", alignItems:"center", gap:10 }}>
          <div style={{ flex:1, fontSize:9, color:C.textMuted, fontFamily:mono }}>
            Data from <span style={{ color:C.textDim }}>OECD Data · SDMX-JSON</span> · Public domain · No API key
          </div>
          <button onClick={onClose} style={{ padding:"0.38rem 0.9rem", background:"transparent", border:`1px solid ${C.border2}`, borderRadius:3, color:C.textDim, cursor:"pointer", fontFamily:mono, fontSize:11 }}>Cancel</button>
          <button onClick={handleFetch} disabled={!selected.length || step==="fetching"}
            style={{ padding:"0.38rem 1.1rem", background: selected.length?C.blue:C.border2, border:"none", borderRadius:3, color:C.bg, cursor: selected.length?"pointer":"not-allowed", fontFamily:mono, fontSize:11, fontWeight:700, opacity: step==="fetching"?0.6:1, transition:"all 0.12s" }}>
            ↓ Fetch {selected.length > 0 ? `${selected.length} indicator${selected.length>1?"s":""}` : ""}
          </button>
        </div>
      </div>
    </div>
  );
}
