// ─── ECON STUDIO · components/wrangling/ObservatorioFetcher.jsx ──────────────
// Modal for importing the Observatorio Lucía Pérez femicide/travesticide registry.
// The site is behind Imunify360 bot-protection, so there is no live fetch: the
// user pulls the raw admin-ajax.php JSON from their own authenticated browser
// session (console snippet below) and pastes / uploads it here.
// Props: onLoad(filename, rows, headers), onClose()

import { useState, useEffect } from "react";
import { useTheme } from "../../ThemeContext.jsx";
import { parseRegistryText } from "../../services/data/fetchers/observatorio.js";

const mono = "'IBM Plex Mono','JetBrains Mono',Consolas,monospace";

// Run this in the browser console on observatorioluciaperez.org (logged-in tab).
// It fetches the full registry through the user's own session and copies the
// raw JSON to the clipboard for pasting here.
const CONSOLE_SNIPPET =
  `fetch("/wp-admin/admin-ajax.php",{method:"POST",headers:{"Content-Type":"application/x-www-form-urlencoded; charset=UTF-8","X-Requested-With":"XMLHttpRequest"},body:"action=padron_femicidios_ajax_data&draw=1&start=0&length=6000"}).then(r=>r.text()).then(t=>{copy(t);console.log("Copied",t.length,"chars")})`;

export default function ObservatorioFetcher({ onLoad, onClose }) {
  const { C } = useTheme();
  const [text, setText]   = useState("");
  const [error, setError] = useState("");
  const [meta, setMeta]   = useState(null);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    const h = e => { if (e.key === "Escape") onClose(); };
    window.addEventListener("keydown", h);
    return () => window.removeEventListener("keydown", h);
  }, [onClose]);

  function handleFile(e) {
    const f = e.target.files?.[0];
    if (!f) return;
    const reader = new FileReader();
    reader.onload = () => setText(String(reader.result ?? ""));
    reader.readAsText(f);
  }

  function copySnippet() {
    navigator.clipboard?.writeText(CONSOLE_SNIPPET).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    });
  }

  function handleImport() {
    setError("");
    try {
      const { rows, headers, meta } = parseRegistryText(text);
      setMeta(meta);
      onLoad("observatorio_femicidios.csv", rows, headers);
      onClose();
    } catch (e) {
      setError(e.message ?? "Import failed.");
    }
  }

  return (
    <div onClick={onClose} style={{ position:"fixed", inset:0, zIndex:400, background:"rgba(0,0,0,0.82)", display:"flex", alignItems:"center", justifyContent:"center" }}>
      <div onClick={e => e.stopPropagation()} style={{ width:"min(620px,96vw)", background:C.surface, border:`1px solid ${C.border2}`, borderRadius:6, display:"flex", flexDirection:"column", overflow:"hidden", boxShadow:"0 20px 60px rgba(0,0,0,0.7)" }}>
        <div style={{ display:"flex", alignItems:"center", gap:12, padding:"0.75rem 1.1rem", background:C.bg, borderBottom:`1px solid ${C.border}` }}>
          <div style={{ flex:1 }}>
            <div style={{ fontSize:9, color:C.textMuted, letterSpacing:"0.22em", textTransform:"uppercase", fontFamily:mono, marginBottom:2 }}>Registro · Femicidios / Travesticidios</div>
            <div style={{ fontSize:15, color:C.text, fontFamily:mono }}>Observatorio Lucía Pérez</div>
          </div>
          <button onClick={onClose} style={{ background:"none", border:`1px solid ${C.border2}`, borderRadius:3, color:C.textMuted, cursor:"pointer", fontFamily:mono, fontSize:11, padding:"0.25rem 0.6rem" }}>✕ Close</button>
        </div>

        <div style={{ padding:"1rem 1.1rem", fontSize:11, color:C.textDim, fontFamily:mono, lineHeight:1.6 }}>
          Imports incident-level records (fecha · provincia · partido · localidad · vínculo · edad · hijxs).
          Names and fiscal fields are stripped before the data enters Litux.
          <div style={{ marginTop:8, color:C.textMuted, fontSize:10 }}>
            Build a panel: <span style={{ color:C.gold }}>date_extract → group_summarize → balance_panel</span> → Poisson FE.
          </div>
        </div>

        <div style={{ padding:"0 1.1rem 0.6rem" }}>
          <div style={{ display:"flex", alignItems:"center", gap:8, marginBottom:5 }}>
            <div style={{ flex:1, fontSize:9, color:C.textMuted, letterSpacing:"0.18em", textTransform:"uppercase", fontFamily:mono }}>1 · Pull JSON from your logged-in tab</div>
            <button onClick={copySnippet} style={{ background:"transparent", border:`1px solid ${C.border2}`, borderRadius:3, color: copied?C.teal:C.textDim, cursor:"pointer", fontFamily:mono, fontSize:10, padding:"0.2rem 0.55rem" }}>{copied ? "✓ Copied" : "⧉ Copy console snippet"}</button>
          </div>
          <div style={{ fontSize:9.5, color:C.textMuted, fontFamily:mono, lineHeight:1.55, marginBottom:10 }}>
            Open observatorioluciaperez.org (logged in), press F12 → Console, paste the snippet, run it.
            The full registry is copied to your clipboard. Paste it below, or load the saved <span style={{ color:C.gold }}>.json</span> file.
          </div>

          <div style={{ display:"flex", alignItems:"center", gap:8, marginBottom:5 }}>
            <div style={{ flex:1, fontSize:9, color:C.textMuted, letterSpacing:"0.18em", textTransform:"uppercase", fontFamily:mono }}>2 · Paste or upload</div>
            <label style={{ background:"transparent", border:`1px solid ${C.border2}`, borderRadius:3, color:C.textDim, cursor:"pointer", fontFamily:mono, fontSize:10, padding:"0.2rem 0.55rem" }}>
              ↑ Load .json
              <input type="file" accept=".json,application/json" onChange={handleFile} style={{ display:"none" }} />
            </label>
          </div>
          <textarea
            value={text}
            onChange={e => { setText(e.target.value); setError(""); }}
            placeholder='{ "draw":1, "recordsTotal":5321, "data":[ ["id|nombre","edad","D/M/YYYY", ...], ... ] }'
            spellCheck={false}
            style={{ width:"100%", boxSizing:"border-box", height:140, resize:"vertical", background:C.bg, border:`1px solid ${C.border2}`, borderRadius:4, color:C.text, fontFamily:mono, fontSize:11, padding:"0.55rem 0.65rem", lineHeight:1.5 }}
          />
        </div>

        {error && (
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
          <button onClick={handleImport} disabled={!text.trim()}
            style={{ padding:"0.38rem 1.1rem", background:C.gold, border:"none", borderRadius:3, color:C.bg, cursor: text.trim()?"pointer":"not-allowed", fontFamily:mono, fontSize:11, fontWeight:700, opacity: text.trim()?1:0.5 }}>
            ↓ Import registry
          </button>
        </div>
      </div>
    </div>
  );
}
