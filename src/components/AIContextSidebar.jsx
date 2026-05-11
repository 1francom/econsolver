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
import { useSessionState } from "../services/session/sessionState.jsx";
import { useAuth } from "../services/auth/AuthContext.jsx";
import { useTheme } from "../ThemeContext.jsx";

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

function buildContext(screen, cleanedData, modelResult, sessionDatasets) {
  const lines = [`CURRENT MODULE: ${screen ?? "unknown"}`];

  if (cleanedData) {
    const { headers = [], cleanRows = [], changeLog = [], dataDictionary } = cleanedData;
    lines.push(`ACTIVE DATASET: ${cleanRows.length} obs × ${headers.length} cols`);
    if (changeLog?.length) {
      const label = screen === "model" ? "WRANGLING HISTORY" : "Pipeline";
      lines.push(`${label}: ${changeLog.length} step(s) applied`);
      changeLog.forEach(s => lines.push(`  · [${s.type}] ${s.description}`));
    }
    if (dataDictionary && Object.keys(dataDictionary).length) {
      const entries = Object.entries(dataDictionary).slice(0, 8);
      lines.push(`Dictionary: ${entries.map(([k,v]) => `${k}="${v}"`).join(", ")}`);
    }
    const pi = cleanedData.panelIndex;
    if (pi?.entityCol) lines.push(`Panel: entity=${pi.entityCol}, time=${pi.timeCol}`);
  }

  // All session datasets (metadata from registry — headers + row count, no raw rows)
  if (sessionDatasets) {
    const all = Object.values(sessionDatasets).filter(d => d.headers?.length);
    if (all.length > 1) {
      lines.push(`ALL DATASETS IN SESSION (${all.length}):`);
      all.slice(0, 8).forEach(d => {
        const hCount = d.headers?.length ?? 0;
        const hdrs = (d.headers ?? []).slice(0, 12).join(", ");
        const more = hCount > 12 ? ` … (+${hCount - 12} more)` : "";
        lines.push(`  "${d.name}": ${d.rowCount ?? "?"} rows × ${d.colCount ?? hCount} cols | vars: ${hdrs}${more}`);
      });
    }
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

function Bubble({ role, text, images }) {
  const { C } = useTheme();
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
      }}>
        {images?.length > 0 && (
          <div style={{ display: "flex", gap: 4, flexWrap: "wrap", marginBottom: text ? 6 : 0 }}>
            {images.map((img, i) => (
              <img key={i} src={img.dataUrl} alt=""
                style={{ maxWidth: 180, maxHeight: 120, borderRadius: 3, border: `1px solid ${C.border2}`, objectFit: "contain" }} />
            ))}
          </div>
        )}
        {text && <span style={{ whiteSpace: "pre-wrap" }}>{text}</span>}
      </div>
    </div>
  );
}

function ThinkingBubble() {
  const { C } = useTheme();
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

const PREMIUM_TIERS = new Set(["premium", "pro"]);

export default function AIContextSidebar({ isOpen, onClose, screen, cleanedData, modelResult, prefillMessage = null }) {
  const { C } = useTheme();
  const { tier, session } = useAuth();
  const isPremium = !import.meta.env.VITE_AI_PROXY_ENABLED || import.meta.env.VITE_AI_PROXY_ENABLED !== "true" || PREMIUM_TIERS.has(tier);
  const sessionState = useSessionState();
  const [history,       setHistory]       = useState([]);
  const [input,         setInput]         = useState("");
  const [loading,       setLoading]       = useState(false);
  const [pendingImages, setPendingImages] = useState([]); // [{ dataUrl, base64, mediaType }]
  const bottomRef  = useRef(null);
  const inputRef   = useRef(null);

  function handlePaste(e) {
    const items = Array.from(e.clipboardData?.items ?? []);
    const imgItem = items.find(it => it.type.startsWith("image/"));
    if (!imgItem) return;
    e.preventDefault();
    const blob = imgItem.getAsFile();
    const reader = new FileReader();
    reader.onload = ev => {
      const dataUrl = ev.target.result;
      const [header, base64] = dataUrl.split(",");
      const mediaType = header.match(/data:([^;]+)/)?.[1] ?? "image/png";
      setPendingImages(prev => [...prev.slice(-2), { dataUrl, base64, mediaType }]); // max 3
    };
    reader.readAsDataURL(blob);
  }

  useEffect(() => {
    if (!prefillMessage?.q) return;
    setInput(prefillMessage.q);
    const t = setTimeout(() => inputRef.current?.focus(), 120);
    return () => clearTimeout(t);
  }, [prefillMessage]);

  useEffect(() => {
    if (isOpen) {
      bottomRef.current?.scrollIntoView({ behavior: "smooth" });
      setTimeout(() => inputRef.current?.focus(), 120);
    }
  }, [history, loading, isOpen]);

  const starters = SCREEN_STARTERS[screen] ?? SCREEN_STARTERS.default;
  const contextStr = useMemo(
    () => buildContext(screen, cleanedData, modelResult, sessionState?.datasets),
    [screen, cleanedData, modelResult, sessionState?.datasets]
  );
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
    if ((!q && pendingImages.length === 0) || loading) return;

    // Build API content — multipart when images are present
    const imgs = pendingImages;
    const apiContent = imgs.length > 0
      ? [
          ...imgs.map(img => ({ type: "image", source: { type: "base64", media_type: img.mediaType, data: img.base64 } })),
          { type: "text", text: q || "(see image)" },
        ]
      : q;

    const userEntry = { role: "user", text: q || "(image)", images: imgs.length > 0 ? imgs : undefined, content: apiContent };
    setHistory(prev => [...prev, userEntry]);
    setInput("");
    setPendingImages([]);
    setLoading(true);

    const reply = await researchCoach({
      question: q || "(image)",
      images: imgs,
      modelResult,
      dataDictionary: cleanedData?.dataDictionary ?? null,
      metadataReport,
      history: history.map((h, idx) => ({
        role: h.role,
        content: h.role === "user" && idx === 0
          ? (() => {
              const prefix = `CONTEXT:\n${contextStr}\n\n────────────────────────────\n`;
              if (h.images?.length) {
                return [
                  ...h.images.map(img => ({ type: "image", source: { type: "base64", media_type: img.mediaType, data: img.base64 } })),
                  { type: "text", text: prefix + h.text },
                ];
              }
              return prefix + h.text;
            })()
          : (h.content ?? h.text),
      })),
    });

    setHistory(prev => [...prev, { role: "assistant", text: reply }]);
    setLoading(false);
  }

  async function safeSubmit(question) {
    try {
      await submit(question);
    } catch (err) {
      setLoading(false);
      const msg = err.message === "PREMIUM_REQUIRED"
        ? "Your account doesn't have premium access. Upgrade to use the AI Coach."
        : `Error: ${err.message}`;
      setHistory(prev => [...prev, { role: "assistant", text: msg }]);
    }
  }

  const screenLabel = {
    studio:   "Wrangling",
    modeling: "Modeling Lab",
    explorer: "Evidence Explorer",
    output:   "Pipeline Output",
  }[screen] ?? screen ?? "Global";

  if (!isOpen) return null;

  // ── Premium gate ────────────────────────────────────────────────────────────
  if (!isPremium) return (
    <>
      <div onClick={onClose}
        style={{ position: "fixed", inset: 0, zIndex: 199, background: "rgba(0,0,0,0.35)" }} />
      <div style={{
        position: "fixed", top: 38, right: 0, bottom: 0, zIndex: 200,
        width: "min(420px, 92vw)", background: C.bg, borderLeft: `1px solid ${C.border}`,
        display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center",
        gap: 16, padding: "2rem", boxShadow: "-8px 0 32px rgba(0,0,0,0.6)",
      }}>
        <div style={{ fontSize: 28 }}>✦</div>
        <div style={{ fontSize: 13, fontFamily: mono, color: C.gold, letterSpacing: "0.1em", textTransform: "uppercase" }}>
          Premium Feature
        </div>
        <div style={{ fontSize: 11, fontFamily: mono, color: C.textMuted, textAlign: "center", lineHeight: 1.7, maxWidth: 280 }}>
          The AI Research Coach is available on the Premium plan.{!session && " Sign in to access your account."}
        </div>
        <button onClick={onClose}
          style={{ marginTop: 8, padding: "0.45rem 1rem", background: "transparent", border: `1px solid ${C.border2}`, borderRadius: 3, color: C.textMuted, fontFamily: mono, fontSize: 10, cursor: "pointer" }}>
          Close
        </button>
      </div>
    </>
  );

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
              {screenLabel}
              {modelResult && <span style={{ color: C.teal }}> · {(modelResult.second ?? modelResult).modelLabel ?? "Model"}</span>}
              {Object.keys(sessionState?.datasets ?? {}).length > 1 && (
                <span style={{ color: C.gold }}> · {Object.keys(sessionState.datasets).length} datasets</span>
              )}
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
                I have full context of your session — {screenLabel} state{Object.keys(sessionState?.datasets ?? {}).length > 1 ? `, ${Object.keys(sessionState.datasets).length} loaded datasets` : ""}, pipeline, and model. Ask anything.
              </div>
              <div style={{ display: "flex", flexDirection: "column", gap: 6, marginBottom: "0.75rem" }}>
                {starters.map((q, i) => (
                  <button key={i} onClick={() => safeSubmit(q)} disabled={loading}
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

          {history.map((h, i) => <Bubble key={i} role={h.role} text={h.text} images={h.images} />)}
          {loading && <ThinkingBubble />}
          <div ref={bottomRef} />
        </div>

        {/* Input */}
        <div style={{
          borderTop: `1px solid ${C.border}`, padding: "0.65rem 1rem",
          display: "flex", flexDirection: "column", gap: 6, flexShrink: 0,
        }}>

          {/* Pending image thumbnails */}
          {pendingImages.length > 0 && (
            <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
              {pendingImages.map((img, i) => (
                <div key={i} style={{ position: "relative" }}>
                  <img src={img.dataUrl} alt="" style={{ height: 56, borderRadius: 3, border: `1px solid ${C.border2}`, objectFit: "contain", maxWidth: 100 }} />
                  <button onClick={() => setPendingImages(prev => prev.filter((_, j) => j !== i))}
                    style={{ position: "absolute", top: -4, right: -4, width: 14, height: 14, borderRadius: "50%", background: C.surface, border: `1px solid ${C.border2}`, cursor: "pointer", fontSize: 8, color: C.textMuted, display: "flex", alignItems: "center", justifyContent: "center", lineHeight: 1 }}>
                    ✕
                  </button>
                </div>
              ))}
            </div>
          )}

          <div style={{ display: "flex", gap: 8, alignItems: "flex-end" }}>
          {history.length > 0 && (
            <button onClick={() => { setHistory([]); setInput(""); setPendingImages([]); }}
              style={{ padding: "0.45rem 0.55rem", background: "transparent", border: `1px solid ${C.border}`, borderRadius: 3, color: C.textMuted, cursor: "pointer", fontFamily: mono, fontSize: 9, flexShrink: 0, transition: "all 0.12s" }}
              onMouseEnter={e => { e.currentTarget.style.color = C.red; e.currentTarget.style.borderColor = C.red; }}
              onMouseLeave={e => { e.currentTarget.style.color = C.textMuted; e.currentTarget.style.borderColor = C.border; }}
            >✕</button>
          )}
          <textarea
            ref={inputRef}
            value={input}
            onChange={e => setInput(e.target.value)}
            onKeyDown={e => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); safeSubmit(); } }}
            onPaste={handlePaste}
            disabled={loading}
            placeholder="Ask anything… paste an image with Ctrl+V"
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
          <button onClick={safeSubmit} disabled={loading || (!input.trim() && pendingImages.length === 0)}
            style={{
              padding: "0.45rem 0.85rem", borderRadius: 3, flexShrink: 0,
              background: (input.trim() || pendingImages.length > 0) && !loading ? C.violet : "transparent",
              border: `1px solid ${(input.trim() || pendingImages.length > 0) && !loading ? C.violet : C.border2}`,
              color: (input.trim() || pendingImages.length > 0) && !loading ? C.bg : C.textMuted,
              fontFamily: mono, fontSize: 10, fontWeight: 700,
              cursor: input.trim() && !loading ? "pointer" : "not-allowed",
              transition: "all 0.13s",
            }}
          >{loading ? "…" : "Ask"}</button>
          </div>
        </div>
      </div>
    </>
  );
}
