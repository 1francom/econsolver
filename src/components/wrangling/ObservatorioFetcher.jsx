// ─── ECON STUDIO · components/wrangling/ObservatorioFetcher.jsx ──────────────
// Modal for fetching the Observatorio Lucía Pérez femicide/travesticide registry.
// Props: onLoad(filename, rows, headers), onClose()

import { useState, useEffect } from "react";
import { useTheme } from "../../ThemeContext.jsx";
import { fetchObservatorioRegistry } from "../../services/data/fetchers/observatorio.js";

const mono = "'IBM Plex Mono','JetBrains Mono',Consolas,monospace";

export default function ObservatorioFetcher({ onLoad, onClose }) {
  const { C } = useTheme();
  const [step, setStep]   = useState("ready");   // "ready" | "fetching" | "error"
  const [error, setError] = useState("");
  const [meta, setMeta]   = useState(null);

  useEffect(() => {
    const h = e => { if (e.key === "Escape") onClose(); };
    window.addEventListener("keydown", h);
    return () => window.removeEventListener("keydown", h);
  }, [onClose]);

  async function handleFetch() {
    setStep("fetching");
    setError("");
    try {
      const { rows, headers, meta } = await fetchObservatorioRegistry();
      setMeta(meta);
      onLoad("observatorio_femicidios.csv", rows, headers);
      onClose();
    } catch (e) {
      setError(e.message ?? "Fetch failed.");
      setStep("error");
    }
  }

  return (
    <div onClick={onClose} style={{ position:"fixed", inset:0, zIndex:400, background:"rgba(0,0,0,0.82)", display:"flex", alignItems:"center", justifyContent:"center" }}>
      <div onClick={e => e.stopPropagation()} style={{ width:"min(560px,96vw)", background:C.surface, border:`1px solid ${C.border2}`, borderRadius:6, display:"flex", flexDirection:"column", overflow:"hidden", boxShadow:"0 20px 60px rgba(0,0,0,0.7)" }}>
        <div style={{ display:"flex", alignItems:"center", gap:12, padding:"0.75rem 1.1rem", background:C.bg, borderBottom:`1px solid ${C.border}` }}>
          <div style={{ flex:1 }}>
            <div style={{ fontSize:9, color:C.textMuted, letterSpacing:"0.22em", textTransform:"uppercase", fontFamily:mono, marginBottom:2 }}>Registro · Femicidios / Travesticidios</div>
            <div style={{ fontSize:15, color:C.text, fontFamily:mono }}>Observatorio Lucía Pérez</div>
          </div>
          <button onClick={onClose} style={{ background:"none", border:`1px solid ${C.border2}`, borderRadius:3, color:C.textMuted, cursor:"pointer", fontFamily:mono, fontSize:11, padding:"0.25rem 0.6rem" }}>✕ Close</button>
        </div>

        <div style={{ padding:"1rem 1.1rem", fontSize:11, color:C.textDim, fontFamily:mono, lineHeight:1.6 }}>
          Imports incident-level records (fecha · provincia · comuna · barrio · vínculo).
          Identifying fields are stripped before the data enters Litux.
          <div style={{ marginTop:8, color:C.textMuted, fontSize:10 }}>
            Build a panel: <span style={{ color:C.gold }}>date_extract → group_summarize → balance_panel</span> → Poisson FE.
          </div>
        </div>

        {step === "fetching" && (
          <div style={{ padding:"0.4rem 1.1rem 0.9rem", color:C.textDim, fontSize:11, fontFamily:mono }}>Fetching registry…</div>
        )}
        {step === "error" && (
          <div style={{ margin:"0 1.1rem 0.9rem", padding:"0.6rem 0.75rem", background:`${C.red}15`, borderLeft:`3px solid ${C.red}`, fontSize:11, color:C.red, fontFamily:mono }}>⚠ {error}</div>
        )}
        {meta && (
          <div style={{ margin:"0 1.1rem 0.9rem", fontSize:10, color:C.textMuted, fontFamily:mono }}>
            {meta.nObs} incidents · {meta.coverage?.minDate}–{meta.coverage?.maxDate} · {meta.nUnparsedDates} unparsed dates · {meta.nDuplicatesDropped} dup dropped
          </div>
        )}

        <div style={{ padding:"0.65rem 1.1rem", background:C.bg, borderTop:`1px solid ${C.border}`, display:"flex", alignItems:"center", gap:10 }}>
          <div style={{ flex:1, fontSize:9, color:C.textMuted, fontFamily:mono }}>Source: observatorioluciaperez.org · public registry</div>
          <button onClick={onClose} style={{ padding:"0.38rem 0.9rem", background:"transparent", border:`1px solid ${C.border2}`, borderRadius:3, color:C.textDim, cursor:"pointer", fontFamily:mono, fontSize:11 }}>Cancel</button>
          <button onClick={handleFetch} disabled={step==="fetching"}
            style={{ padding:"0.38rem 1.1rem", background:C.gold, border:"none", borderRadius:3, color:C.bg, cursor: step==="fetching"?"not-allowed":"pointer", fontFamily:mono, fontSize:11, fontWeight:700, opacity: step==="fetching"?0.6:1 }}>
            ↓ Fetch registry
          </button>
        </div>
      </div>
    </div>
  );
}
