// ─── ECON STUDIO · components/AIContextSidebar.jsx ───────────────────────────
// Universal contextual AI sidebar — globally accessible across all modules.
// Reads current screen + state to auto-contextualize queries without manual setup.
//
// Props:
//   isOpen         boolean
//   onClose        () => void
//   screen         "studio"|"modeling"|"explorer"|"output"|...
//   cleanedData    object|null  — pipeline output (headers, rows, pipeline, dict)
//   modelResult    object|null  — active model result from ModelingTab

import { useState, useEffect, useRef, useMemo } from "react";
import { researchCoach } from "../services/AI/AIService.js";
import { buildMetadataReport } from "../core/validation/metadataExtractor.js";

const C = {
  bg:"#080808", surface:"#0f0f0f", surface2:"#131313",
  border:"#1c1c1c", border2:"#252525",
  gold:"#c8a96e", text:"#ddd8cc", textDim:"#888", textMuted:"#444",
  teal:"#6ec8b4", violet:"#9e7ec8", red:"#c47070",
};
const mono = "'IBM Plex Mono','JetBrains Mono',Consolas,monospace";

const SCREEN_STARTERS = {
  studio: [
    "What cleaning steps should I prioritize before modeling?",
    "Are there any variables I should engineer before running FE?",
    "How should I handle missing values in panel data?",
    "What does winsorizing do to my coefficient estimates?",
  ],
  modeling: [
    "Which estimator is most appropriate for my research design?",
    "What identification assumptions am I relying on?",
    "How do I interpret a fixed-effects regression with a binary outcome?",
    "What robustness checks are standard for this type of model?",
  ],
  explorer: [
    "What patterns in this data should I investigate before modeling?",
    "Are there potential outliers I should address?",
    "What does the distribution of my outcome variable imply for my model choice?",
  ],
  default: [
    "What estimator should I use for my research question?",
    "How do I test for parallel trends in DiD?",
    "What is the difference between FE and FD estimators?",
    "How do I interpret a log-level regression?",
  ],
};

function buildContext(screen, cleanedData, modelResult) {
  const lines = [`CURRENT MODULE: ${screen ?? "unknown"}`];

  if (cleanedData) {
    const { headers = [], cleanRows = [], changeLog = [], dataDictionary } = cleanedData;
    lines.push(`DATASET: ${cleanRows.length} obs × ${headers.length} cols`);
    lines.push(`Variables: ${headers.slice(0, 15).join(", ")}${headers.length > 15 ? ` … (+${headers.length - 15} more)` : ""}`);
    if (changeLog?.length) {
      lines.push(`Pipeline: ${changeLog.length} step(s) applied`);
      changeLog.slice(-3).forEach(s => lines.push(`  · [${s.type}] ${s.description}`));
    }
    if (dataDictionary && Object.keys(dataDictionary).length) {
      const entries = Object.entries(dataDictionary).slice(0, 8);
      lines.push(`Dictionary (sample): ${entries.map(([k,v]) => `${k}="${v}"`).join(", ")}`);
    }
    const pi = cleanedData.panelIndex;
    if (pi?.entityCol) lines.push(`Panel: entity=${pi.entityCol}, time=${pi.timeCol}, balance=${pi.balance ?? "?"}`);
  }

  if (modelResult) {
    const core = modelResult.second ?? modelResult;
    const { modelLabel, yVar, varNames = [], beta = [], pVals = [], R2, n } = core;
    lines.push(`ACTIVE MODEL: ${modelLabel ?? "?"} | dep.var: ${yVar ?? "?"} | N=${n ?? "?"} | R²=${R2?.toFixed(4) ?? "?"}`);
    const sigCoeffs = varNames
      .filter(v => v !== "(Intercept)")
      .map((v, i) => ({ v, b: beta[varNames.indexOf(v)], p: pVals[varNames.indexOf(v)] }))
      .filter(d => d.p != null && d.p < 0.05)
      .slice(0, 5);
    if (sigCoeffs.length) {
      lines.push(`Significant (p<0.05): ${sigCoeffs.map(d => `${d.v}(β=${d.b?.toFixed(3)})`).join(", ")}`);
    }
  }

  return lines.join("\n");
}

function Bubble({ role, text }) {
  const isUser = role === "user";
  return (
    <div style={{ display: "flex", justifyContent: isUser ? "flex-end" : "flex-start", marginBottom: 8 }}>
      {!isUser && (
        <div style={{
          width: 16, height: 16, borderRadius: "50%", marginRight: 6, marginTop: 3, flexShrink: 0,
          background: `${C.violet}30`, border: `1px solid ${C.violet}60`,
          display: "flex", alignItems: "center", justifyContent: "center",
          fontSize: 8, color: C.violet,
        }}>AI</div>
      )}
      <div style={{
        maxWidth: "82%", padding: "0.5rem 0.75rem",
        background: isUser ? `${C.violet}18` : C.surface2,
        border: `1px solid ${isUser ? C.violet + "40" : C.border}`,
        borderRadius: isUser ? "8px 8px 2px 8px" : "8px 8px 8px 2px",
        fontSize: 11, color: C.text, fontFamily: mono, lineHeight: 1.7,
        whiteSpace: "pre-wrap",
      }}>
        {text}
      </div>
    </div>
  );
}

function ThinkingBubble() {
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 8 }}>
      <div style={{
        width: 16, height: 16, borderRadius: "50%",
        background: `${C.violet}30`, border: `1px solid ${C.violet}60`,
        display: "flex", alignItems: "center", justifyContent: "center",
        fontSize: 8, color: C.violet, flexShrink: 0,
      }}>AI</div>
      <div style={{
        padding: "0.5rem 0.75rem", background: C.surface2,
        border: `1px solid ${C.border}`, borderRadius: "8px 8px 8px 2px",
        display: "flex", alignItems: "center", gap: 8,
      }}>
        <div style={{
          width: 11, height: 11, border: `2px solid ${C.border2}`,
          borderTopColor: C.violet, borderRadius: "50%",
          animation: "sidebar-spin 0.7s linear infinite",
        }} />
        <span style={{ fontSize: 10, color: C.textMuted, fontFamily: mono }}>Thinking…</span>
      </div>
    </div>
  );
}

export default function AIContextSidebar({ isOpen, onClose, screen, cleanedData, modelResult }) {
  const [history,  setHistory]  = useState([]);
  const [input,    setInput]    = useState("");
  const [loading,  setLoading]  = useState(false);
  const bottomRef  = useRef(null);
  const inputRef   = useRef(null);

  // Clear conversation when screen changes
  useEffect(() => { setHistory([]); setInput(""); }, [screen]);

  useEffect(() => {
    if (isOpen) {
      bottomRef.current?.scrollIntoView({ behavior: "smooth" });
      setTimeout(() => inputRef.current?.focus(), 120);
    }
  }, [history, loading, isOpen]);

  const starters = SCREEN_STARTERS[screen] ?? SCREEN_STARTERS.default;
  const contextStr = buildContext(screen, cleanedData, modelResult);
  const metadataReport = useMemo(
    () => buildMetadataReport(
      cleanedData?.headers ?? [],
      cleanedData?.cleanRows ?? [],
      cleanedData?.panelIndex ?? null
    ),
    [cleanedData]
  );

  async function submit(question) {
    const q = (question ?? input).trim();
    if (!q || loading) return;
    const nextHistory = [...history, { role: "user", text: q }];
    setHistory(nextHistory);
    setInput("");
    setLoading(true);

    const reply = await researchCoach({
      question: q,
      modelResult,
      dataDictionary: cleanedData?.dataDictionary ?? null,
      metadataReport,
      history: history.map(h => ({
        role: h.role,
        text: h.role === "user" && history.indexOf(h) === 0
          ? `CONTEXT:\n${contextStr}\n\n────────────────────────────\n${h.text}`
          : h.text,
      })),
    });

    setHistory(prev => [...prev, { role: "assistant", text: reply }]);
    setLoading(false);
  }

  const screenLabel = {
    studio:   "Wrangling",
    modeling: "Modeling Lab",
    explorer: "Evidence Explorer",
    output:   "Pipeline Output",
  }[screen] ?? screen ?? "Global";

  if (!isOpen) return null;

  return (
    <>
      <style>{`@keyframes sidebar-spin { to { transform: rotate(360deg); } }`}</style>

      {/* Backdrop */}
      <div onClick={onClose}
        style={{ position: "fixed", inset: 0, zIndex: 199, background: "rgba(0,0,0,0.35)" }} />

      {/* Sidebar panel */}
      <div style={{
        position: "fixed", top: 38, right: 0, bottom: 0, zIndex: 200,
        width: "min(420px, 92vw)",
        background: C.bg, borderLeft: `1px solid ${C.border}`,
        display: "flex", flexDirection: "column",
        animation: "rc-fade 0.18s ease",
        boxShadow: "-8px 0 32px rgba(0,0,0,0.6)",
      }}>

        {/* Header */}
        <div style={{
          padding: "0.75rem 1rem", borderBottom: `1px solid ${C.border}`,
          display: "flex", alignItems: "center", justifyContent: "space-between",
          background: C.surface, flexShrink: 0,
        }}>
          <div>
            <div style={{ fontSize: 9, color: C.violet, letterSpacing: "0.22em", textTransform: "uppercase", fontFamily: mono, marginBottom: 2 }}>
              AI Research Coach
            </div>
            <div style={{ fontSize: 10, color: C.textMuted, fontFamily: mono }}>
              Context: {screenLabel}
              {modelResult && <span style={{ color: C.teal }}> · {(modelResult.second ?? modelResult).modelLabel ?? "Model"}</span>}
            </div>
          </div>
          <button onClick={onClose}
            style={{ background: "transparent", border: `1px solid ${C.border2}`, borderRadius: 3, color: C.textMuted, cursor: "pointer", fontFamily: mono, fontSize: 10, padding: "0.25rem 0.55rem" }}>
            ✕
          </button>
        </div>

        {/* Message area */}
        <div style={{ flex: 1, overflowY: "auto", padding: "0.85rem 1rem 0.5rem" }}>
          {history.length === 0 && !loading && (
            <>
              <div style={{ fontSize: 10, color: C.textMuted, fontFamily: mono, marginBottom: "0.75rem", lineHeight: 1.6 }}>
                I have full context of your current {screenLabel} state. Ask anything.
              </div>
              <div style={{ display: "flex", flexDirection: "column", gap: 6, marginBottom: "0.75rem" }}>
                {starters.map((q, i) => (
                  <button key={i} onClick={() => submit(q)} disabled={loading}
                    style={{
                      padding: "0.35rem 0.65rem", textAlign: "left",
                      background: "transparent", border: `1px solid ${C.border2}`,
                      borderRadius: 3, cursor: "pointer", fontFamily: mono,
                      fontSize: 10, color: C.textDim, transition: "all 0.12s",
                    }}
                    onMouseEnter={e => { e.currentTarget.style.borderColor = C.violet; e.currentTarget.style.color = C.violet; }}
                    onMouseLeave={e => { e.currentTarget.style.borderColor = C.border2; e.currentTarget.style.color = C.textDim; }}
                  >{q}</button>
                ))}
              </div>
            </>
          )}

          {history.map((h, i) => <Bubble key={i} role={h.role} text={h.text} />)}
          {loading && <ThinkingBubble />}
          <div ref={bottomRef} />
        </div>

        {/* Input */}
        <div style={{
          borderTop: `1px solid ${C.border}`, padding: "0.65rem 1rem",
          display: "flex", gap: 8, alignItems: "flex-end", flexShrink: 0,
        }}>
          {history.length > 0 && (
            <button onClick={() => { setHistory([]); setInput(""); }}
              style={{ padding: "0.45rem 0.55rem", background: "transparent", border: `1px solid ${C.border}`, borderRadius: 3, color: C.textMuted, cursor: "pointer", fontFamily: mono, fontSize: 9, flexShrink: 0, transition: "all 0.12s" }}
              onMouseEnter={e => { e.currentTarget.style.color = C.red; e.currentTarget.style.borderColor = C.red; }}
              onMouseLeave={e => { e.currentTarget.style.color = C.textMuted; e.currentTarget.style.borderColor = C.border; }}
            >✕</button>
          )}
          <textarea
            ref={inputRef}
            value={input}
            onChange={e => setInput(e.target.value)}
            onKeyDown={e => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); submit(); } }}
            disabled={loading}
            placeholder="Ask anything… (Enter to send)"
            rows={1}
            style={{
              flex: 1, resize: "none", overflow: "hidden",
              background: C.surface2, border: `1px solid ${C.border2}`,
              borderRadius: 3, padding: "0.45rem 0.65rem",
              fontFamily: mono, fontSize: 11, color: C.text,
              outline: "none", lineHeight: 1.5,
            }}
            onInput={e => { e.target.style.height = "auto"; e.target.style.height = Math.min(e.target.scrollHeight, 100) + "px"; }}
            onFocus={e => { e.target.style.borderColor = C.violet; }}
            onBlur={e => { e.target.style.borderColor = C.border2; }}
          />
          <button onClick={submit} disabled={loading || !input.trim()}
            style={{
              padding: "0.45rem 0.85rem", borderRadius: 3, flexShrink: 0,
              background: input.trim() && !loading ? C.violet : "transparent",
              border: `1px solid ${input.trim() && !loading ? C.violet : C.border2}`,
              color: input.trim() && !loading ? C.bg : C.textMuted,
              fontFamily: mono, fontSize: 10, fontWeight: 700,
              cursor: input.trim() && !loading ? "pointer" : "not-allowed",
              transition: "all 0.13s",
            }}
          >{loading ? "…" : "Ask"}</button>
        </div>
      </div>
    </>
  );
}
