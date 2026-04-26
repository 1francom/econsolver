// ─── ECON STUDIO · components/wrangling/WorldBankFetcher.jsx ─────────────────
// Modal for fetching World Bank Open Data indicators.
// Supports single or multi-indicator fetch → joined wide panel dataset.
//
// Props:
//   onLoad(filename, rows, headers)  — called on successful fetch
//   onClose()                        — close the modal

import { useState, useEffect, useRef, useMemo } from "react";
import {
  POPULAR_INDICATORS,
  searchIndicators,
  fetchMultipleIndicators,
} from "../../services/data/fetchers/worldBank.js";

const C = {
  bg:"#080808", surface:"#0f0f0f", surface2:"#131313", surface3:"#161616",
  border:"#1c1c1c", border2:"#252525",
  gold:"#c8a96e", goldFaint:"#1a1408",
  text:"#ddd8cc", textDim:"#888", textMuted:"#444",
  green:"#7ab896", red:"#c47070",
  blue:"#6e9ec8", teal:"#6ec8b4", orange:"#c88e6e",
};
const mono = "'IBM Plex Mono','JetBrains Mono',Consolas,monospace";

// ─── QUICK-SELECT REGIONS ─────────────────────────────────────────────────────
const REGIONS = [
  { label: "All countries",   codes: [] },
  { label: "EU27 (approx.)",  codes: ["AUT","BEL","BGR","HRV","CYP","CZE","DNK","EST","FIN","FRA","DEU","GRC","HUN","IRL","ITA","LVA","LTU","LUX","MLT","NLD","POL","PRT","ROU","SVK","SVN","ESP","SWE"] },
  { label: "G7",              codes: ["CAN","FRA","DEU","ITA","JPN","GBR","USA"] },
  { label: "G20",             codes: ["ARG","AUS","BRA","CAN","CHN","FRA","DEU","IND","IDN","ITA","JPN","KOR","MEX","RUS","SAU","ZAF","TUR","GBR","USA"] },
  { label: "Latin America",   codes: ["ARG","BOL","BRA","CHL","COL","CRI","ECU","MEX","PER","PRY","URY"] },
  { label: "Sub-Saharan Africa", codes: ["ETH","GHA","KEN","MDG","MOZ","NGA","RWA","SEN","TZA","UGA","ZMB","ZWE"] },
  { label: "East Asia",       codes: ["CHN","IDN","JPN","KOR","MYS","PHL","THA","VNM"] },
  { label: "South Asia",      codes: ["BGD","IND","LKA","NPL","PAK"] },
  { label: "OECD",            codes: ["AUS","AUT","BEL","CAN","CHL","COL","CZE","DNK","EST","FIN","FRA","DEU","GRC","HUN","ISL","IRL","ISR","ITA","JPN","KOR","LVA","LTU","LUX","MEX","NLD","NZL","NOR","POL","PRT","SVK","SVN","ESP","SWE","CHE","TUR","GBR","USA"] },
];

// ─── ATOMS ────────────────────────────────────────────────────────────────────
function Tag({ label, onRemove, color = C.teal }) {
  return (
    <span style={{ display: "inline-flex", alignItems: "center", gap: 4, padding: "2px 8px", background: `${color}18`, border: `1px solid ${color}40`, borderRadius: 3, fontSize: 10, color, fontFamily: mono }}>
      {label}
      <button onClick={onRemove} style={{ background: "none", border: "none", color, cursor: "pointer", fontSize: 11, lineHeight: 1, padding: 0 }}>×</button>
    </span>
  );
}

function Spinner() {
  return <div style={{ width: 14, height: 14, border: `2px solid ${C.border2}`, borderTopColor: C.gold, borderRadius: "50%", animation: "spin 0.7s linear infinite", flexShrink: 0 }} />;
}

// ─── MAIN MODAL ───────────────────────────────────────────────────────────────
export default function WorldBankFetcher({ onLoad, onClose }) {
  // ── Step state: "indicators" | "options" | "fetching" | "done" | "error"
  const [step,       setStep]       = useState("indicators");

  // ── Indicator search
  const [query,      setQuery]      = useState("");
  const [results,    setResults]    = useState(POPULAR_INDICATORS);
  const [searching,  setSearching]  = useState(false);
  const searchTimer = useRef(null);

  // ── Selected indicators (array of {id, name})
  const [selected,   setSelected]   = useState([]);

  // ── Options
  const [region,     setRegion]     = useState(0);        // index into REGIONS
  const [startYear,  setStartYear]  = useState(2000);
  const [endYear,    setEndYear]    = useState(2023);

  // ── Fetch status
  const [progress,   setProgress]   = useState("");
  const [error,      setError]      = useState("");

  // ── Debounced search
  useEffect(() => {
    if (searchTimer.current) clearTimeout(searchTimer.current);
    if (!query.trim()) { setResults(POPULAR_INDICATORS); return; }
    searchTimer.current = setTimeout(async () => {
      setSearching(true);
      try { setResults(await searchIndicators(query)); }
      catch { setResults([]); }
      finally { setSearching(false); }
    }, 400);
  }, [query]);

  function toggleIndicator(ind) {
    setSelected(prev => {
      const exists = prev.find(s => s.id === ind.id);
      if (exists) return prev.filter(s => s.id !== ind.id);
      if (prev.length >= 8) return prev; // max 8
      return [...prev, { id: ind.id, name: ind.name }];
    });
  }

  async function handleFetch() {
    if (!selected.length) return;
    setStep("fetching");
    setError("");
    try {
      const opts = {
        countries: REGIONS[region].codes,
        startYear,
        endYear,
      };
      setProgress(`Fetching ${selected.length} indicator${selected.length > 1 ? "s" : ""}…`);
      const { rows, headers, meta } = await fetchMultipleIndicators(
        selected.map(s => s.id),
        opts
      );
      setProgress("");

      const label = selected.length === 1
        ? selected[0].name.slice(0, 40)
        : `WB_${selected.length}indicators`;
      const filename = `${label}_${startYear}-${endYear}.csv`;

      onLoad(filename, rows, headers);
      onClose();
    } catch (e) {
      setError(e.message ?? "Fetch failed.");
      setStep("error");
    }
  }

  // ── Keyboard: Escape to close
  useEffect(() => {
    const handler = e => { if (e.key === "Escape") onClose(); };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [onClose]);

  return (
    // Backdrop
    <div
      onClick={onClose}
      style={{ position: "fixed", inset: 0, zIndex: 400, background: "rgba(0,0,0,0.82)", display: "flex", alignItems: "center", justifyContent: "center" }}
    >
      {/* Panel */}
      <div
        onClick={e => e.stopPropagation()}
        style={{ width: "min(780px, 96vw)", maxHeight: "90vh", background: C.surface, border: `1px solid ${C.border2}`, borderRadius: 6, display: "flex", flexDirection: "column", overflow: "hidden", boxShadow: "0 20px 60px rgba(0,0,0,0.7)" }}
      >

        {/* Header */}
        <div style={{ display: "flex", alignItems: "center", gap: 12, padding: "0.75rem 1.1rem", background: C.bg, borderBottom: `1px solid ${C.border}` }}>
          <div style={{ flex: 1 }}>
            <div style={{ fontSize: 9, color: C.textMuted, letterSpacing: "0.22em", textTransform: "uppercase", fontFamily: mono, marginBottom: 2 }}>World Bank Open Data</div>
            <div style={{ fontSize: 15, color: C.text, fontFamily: mono }}>Import Indicators</div>
          </div>
          <button onClick={onClose} style={{ background: "none", border: `1px solid ${C.border2}`, borderRadius: 3, color: C.textMuted, cursor: "pointer", fontFamily: mono, fontSize: 11, padding: "0.25rem 0.6rem" }}>✕ Close</button>
        </div>

        {/* Body */}
        <div style={{ flex: 1, overflowY: "auto", display: "flex", flexDirection: "column", gap: 0 }}>

          {/* ── STEP 1: Select indicators ── */}
          <div style={{ padding: "1rem 1.1rem", borderBottom: `1px solid ${C.border}` }}>
            <div style={{ fontSize: 9, color: C.textMuted, letterSpacing: "0.18em", textTransform: "uppercase", fontFamily: mono, marginBottom: 8 }}>
              1 · Select indicators <span style={{ color: C.textMuted }}>(up to 8)</span>
            </div>

            {/* Search */}
            <div style={{ position: "relative", marginBottom: 10 }}>
              <input
                value={query}
                onChange={e => setQuery(e.target.value)}
                placeholder="Search indicators (e.g. GDP, poverty, education)…"
                style={{ width: "100%", boxSizing: "border-box", padding: "0.42rem 0.75rem", background: C.surface2, border: `1px solid ${C.border2}`, borderRadius: 3, color: C.text, fontFamily: mono, fontSize: 11, outline: "none" }}
              />
              {searching && <span style={{ position: "absolute", right: 10, top: "50%", transform: "translateY(-50%)" }}><Spinner /></span>}
            </div>

            {/* Results list */}
            <div style={{ maxHeight: 220, overflowY: "auto", border: `1px solid ${C.border}`, borderRadius: 3 }}>
              {results.length === 0 && (
                <div style={{ padding: "0.7rem 0.9rem", fontSize: 11, color: C.textMuted, fontFamily: mono }}>No indicators found.</div>
              )}
              {results.map(ind => {
                const active = !!selected.find(s => s.id === ind.id);
                return (
                  <div
                    key={ind.id}
                    onClick={() => toggleIndicator(ind)}
                    style={{ display: "flex", alignItems: "flex-start", gap: 10, padding: "0.45rem 0.75rem", cursor: "pointer", background: active ? `${C.teal}12` : "transparent", borderLeft: active ? `3px solid ${C.teal}` : "3px solid transparent", borderBottom: `1px solid ${C.border}`, transition: "all 0.1s" }}
                    onMouseEnter={e => { if (!active) e.currentTarget.style.background = C.surface2; }}
                    onMouseLeave={e => { if (!active) e.currentTarget.style.background = "transparent"; }}
                  >
                    <div style={{ width: 14, height: 14, flexShrink: 0, marginTop: 2, border: `1px solid ${active ? C.teal : C.border2}`, borderRadius: 2, background: active ? C.teal : "transparent", display: "flex", alignItems: "center", justifyContent: "center" }}>
                      {active && <span style={{ color: C.bg, fontSize: 9, lineHeight: 1 }}>✓</span>}
                    </div>
                    <div style={{ flex: 1 }}>
                      <div style={{ fontSize: 11, color: C.text, fontFamily: mono }}>{ind.name}</div>
                      <div style={{ fontSize: 9, color: C.textMuted, fontFamily: mono, marginTop: 1 }}>{ind.id}</div>
                    </div>
                  </div>
                );
              })}
            </div>

            {/* Selected tags */}
            {selected.length > 0 && (
              <div style={{ display: "flex", flexWrap: "wrap", gap: 6, marginTop: 10 }}>
                {selected.map(s => (
                  <Tag key={s.id} label={`${s.name.slice(0, 35)}${s.name.length > 35 ? "…" : ""}`} color={C.teal}
                    onRemove={() => setSelected(prev => prev.filter(x => x.id !== s.id))} />
                ))}
              </div>
            )}
          </div>

          {/* ── STEP 2: Options ── */}
          <div style={{ padding: "1rem 1.1rem", borderBottom: `1px solid ${C.border}` }}>
            <div style={{ fontSize: 9, color: C.textMuted, letterSpacing: "0.18em", textTransform: "uppercase", fontFamily: mono, marginBottom: 10 }}>
              2 · Options
            </div>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 12 }}>
              {/* Country / region */}
              <div>
                <div style={{ fontSize: 9, color: C.textMuted, fontFamily: mono, marginBottom: 4 }}>Countries</div>
                <select value={region} onChange={e => setRegion(Number(e.target.value))}
                  style={{ width: "100%", padding: "0.38rem 0.6rem", background: C.surface2, border: `1px solid ${C.border2}`, borderRadius: 3, color: C.text, fontFamily: mono, fontSize: 11 }}>
                  {REGIONS.map((r, i) => <option key={i} value={i}>{r.label}</option>)}
                </select>
                <div style={{ fontSize: 9, color: C.textMuted, fontFamily: mono, marginTop: 3 }}>
                  {region === 0 ? "~180 countries" : `${REGIONS[region].codes.length} countries`}
                </div>
              </div>
              {/* Start year */}
              <div>
                <div style={{ fontSize: 9, color: C.textMuted, fontFamily: mono, marginBottom: 4 }}>Start year</div>
                <input type="number" min={1960} max={endYear} value={startYear}
                  onChange={e => setStartYear(Math.max(1960, Math.min(endYear, Number(e.target.value))))}
                  style={{ width: "100%", padding: "0.38rem 0.6rem", background: C.surface2, border: `1px solid ${C.border2}`, borderRadius: 3, color: C.text, fontFamily: mono, fontSize: 11, boxSizing: "border-box" }} />
              </div>
              {/* End year */}
              <div>
                <div style={{ fontSize: 9, color: C.textMuted, fontFamily: mono, marginBottom: 4 }}>End year</div>
                <input type="number" min={startYear} max={2024} value={endYear}
                  onChange={e => setEndYear(Math.min(2024, Math.max(startYear, Number(e.target.value))))}
                  style={{ width: "100%", padding: "0.38rem 0.6rem", background: C.surface2, border: `1px solid ${C.border2}`, borderRadius: 3, color: C.text, fontFamily: mono, fontSize: 11, boxSizing: "border-box" }} />
              </div>
            </div>

            {/* Expected output summary */}
            {selected.length > 0 && (
              <div style={{ marginTop: 10, padding: "0.55rem 0.75rem", background: C.surface3, border: `1px solid ${C.border}`, borderRadius: 3, fontSize: 10, color: C.textDim, fontFamily: mono }}>
                Output: <span style={{ color: C.gold }}>wide panel</span> with columns:
                {" "}country, iso3, year
                {selected.map(s => <span key={s.id} style={{ color: C.teal }}>{", "}{s.id.replace(/\./g, "_")}</span>)}
                {" "}·{" "}{endYear - startYear + 1} years
                {" "}·{" "}{REGIONS[region].codes.length || "~180"} countries
              </div>
            )}
          </div>

          {/* ── Fetch status / error ── */}
          {step === "fetching" && (
            <div style={{ padding: "0.8rem 1.1rem", display: "flex", alignItems: "center", gap: 10, color: C.textDim, fontSize: 11, fontFamily: mono }}>
              <Spinner />
              <span>{progress || "Fetching from World Bank API…"}</span>
            </div>
          )}
          {step === "error" && (
            <div style={{ padding: "0.8rem 1.1rem", display: "flex", alignItems: "flex-start", gap: 8, background: "#0d0808", borderLeft: `3px solid ${C.red}`, fontSize: 11, color: C.red, fontFamily: mono }}>
              <span>⚠ {error}</span>
              <button onClick={() => setStep("indicators")} style={{ marginLeft: "auto", background: "none", border: `1px solid ${C.red}40`, borderRadius: 2, color: C.red, cursor: "pointer", fontFamily: mono, fontSize: 9, padding: "2px 8px" }}>Retry</button>
            </div>
          )}
        </div>

        {/* Footer */}
        <div style={{ padding: "0.65rem 1.1rem", background: C.bg, borderTop: `1px solid ${C.border}`, display: "flex", alignItems: "center", gap: 10 }}>
          <div style={{ flex: 1, fontSize: 9, color: C.textMuted, fontFamily: mono }}>
            Data from <span style={{ color: C.textDim }}>World Bank Open Data</span> · Public domain · No API key required
          </div>
          <button onClick={onClose}
            style={{ padding: "0.38rem 0.9rem", background: "transparent", border: `1px solid ${C.border2}`, borderRadius: 3, color: C.textDim, cursor: "pointer", fontFamily: mono, fontSize: 11 }}>
            Cancel
          </button>
          <button
            onClick={handleFetch}
            disabled={selected.length === 0 || step === "fetching"}
            style={{ padding: "0.38rem 1.1rem", background: selected.length > 0 ? C.teal : C.border2, border: "none", borderRadius: 3, color: C.bg, cursor: selected.length > 0 ? "pointer" : "not-allowed", fontFamily: mono, fontSize: 11, fontWeight: 700, opacity: step === "fetching" ? 0.6 : 1, transition: "all 0.12s" }}>
            ↓ Fetch {selected.length > 0 ? `${selected.length} indicator${selected.length > 1 ? "s" : ""}` : ""}
          </button>
        </div>
      </div>
    </div>
  );
}
