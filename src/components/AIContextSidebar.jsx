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
import { researchCoach, coachDispatch } from "../services/AI/AIService.js";
import { loadCoachChats, saveCoachChats } from "../services/Persistence/indexedDB.js";
import { getPlotHistory } from "../services/Persistence/plotHistory.js";
import { buildMetadataReport } from "../core/validation/metadataExtractor.js";
import { useSessionState } from "../services/session/sessionState.jsx";
import { buildSessionSnapshot } from "../services/AI/sessionSnapshot.js";
import { useAuth } from "../services/auth/AuthContext.jsx";
import { useTheme } from "../ThemeContext.jsx";


// Module-aware starters — Litux how-to + methodology, tailored to the active tab.
const SCREEN_STARTERS = {
  data: [
    "How do I load a dataset in Litux?",
    "Can I fetch directly from World Bank or OECD?",
    "What file formats does Litux support (.csv, .dta, .rds, .xlsx, .parquet, .shp)?",
    "How do I switch between multiple datasets in this session?",
  ],
  clean: [
    "How do I declare a panel structure (entity × time) here?",
    "Where do I winsorize or trim outliers in a column?",
    "How do I drop rows with NAs only in specific columns?",
    "How do I merge or append two datasets in the Merge tab?",
  ],
  explore: [
    "How do I open the Plot Builder and add a color-by-group aesthetic?",
    "Where do I export a chart as PNG or LaTeX?",
    "Which variables in this dataset look like they have outliers?",
    "How do I create a histogram or density plot here?",
  ],
  model: [
    "Which estimator should I use for my research design?",
    "How do I add fixed effects and cluster the SEs in Litux?",
    "Where do I add instruments for 2SLS, and how do I read the first-stage F?",
    "How do I export the replication R / Stata / Python script?",
  ],
  spatial: [
    "How do I load a shapefile in the Spatial tab?",
    "How do I join points to polygons in Litux?",
    "How do I assign units to a grid or buffer here?",
    "How do I compute nearest-neighbor distances?",
  ],
  simulate: [
    "How do I set up a DGP to test an estimator?",
    "What does the Simulate tab compute, and how do I read the output?",
    "How do I export simulation results to a script?",
  ],
  calculate: [
    "How do I run a probability or quantile calculation?",
    "What distributions does the calculator support?",
    "How do I invert a CDF (e.g., qchisq) in Litux?",
  ],
  report: [
    "How do I generate a Stargazer-style LaTeX table?",
    "Where do I get the replication bundle (R + Stata + Python + data)?",
    "How do I add the AI-written narrative to my paper?",
    "How do I export a forest plot for my models?",
  ],
  output: [
    "How do I generate a Stargazer-style LaTeX table?",
    "Where do I get the replication bundle (R + Stata + Python + data)?",
    "How do I add the AI-written narrative to my paper?",
  ],
  default: [
    "What can Litux do — give me a 30-second tour?",
    "Which estimator should I use for my research question?",
    "How do I move from cleaned data to a final LaTeX table?",
    "Where do I find the replication script for my model?",
  ],
};

// Per-estimator starters — used when screen === "model" and a model result exists.
const ESTIMATOR_STARTERS = {
  "2SLS": [
    "Is my instrument strong enough — where does Litux show the first-stage F?",
    "How do I add LIML as a robustness check in Litux?",
    "How do I verify the exclusion restriction holds for this design?",
    "How do I cluster SEs by entity in 2SLS here?",
  ],
  DiD: [
    "How do I test the parallel trends assumption in Litux?",
    "Where do I switch from 2x2 DiD to Event Study?",
    "How do I interpret the ATT for my policy question?",
    "Should I be worried about anticipation effects in this design?",
  ],
  TWFE: [
    "Am I affected by the negative weighting problem in TWFE?",
    "How do I add unit + time fixed effects in Litux?",
    "How do I test for pre-trends with Event Study here?",
    "Should I use Callaway-Sant'Anna or Sun-Abraham instead?",
  ],
  RDD: [
    "How do I change the bandwidth in the RDD config?",
    "Where do I find the McCrary density test in Litux?",
    "How do I test for manipulation at the cutoff?",
    "How sensitive are my results to the bandwidth choice?",
  ],
  FE: [
    "How do I cluster SEs at the entity level in Litux?",
    "Where do I declare the panel structure for FE?",
    "What variation in the data identifies these coefficients?",
    "Should I use a Hausman test to choose between FE and RE?",
  ],
  Logit: [
    "How do I view marginal effects (MEM) in Litux?",
    "How do I interpret the McFadden R² for this model?",
    "How do I export odds ratios for a paper?",
    "When should I prefer logit over probit here?",
  ],
  Probit: [
    "How do I view marginal effects (MEM) in Litux?",
    "How do I interpret the McFadden R² for this model?",
    "When should I prefer probit over logit here?",
    "Are the marginal effects economically meaningful?",
  ],
};

function pickEstimatorStarters(modelResult) {
  if (!modelResult) return null;
  const t = modelResult.type ?? modelResult.second?.modelLabel ?? modelResult.modelLabel ?? "";
  if (t === "2SLS" || t === "IV") return ESTIMATOR_STARTERS["2SLS"];
  if (t === "DiD" || t === "2x2DiD") return ESTIMATOR_STARTERS.DiD;
  if (t === "TWFE") return ESTIMATOR_STARTERS.TWFE;
  if (t === "RDD") return ESTIMATOR_STARTERS.RDD;
  if (t === "FE" || t === "FD") return ESTIMATOR_STARTERS.FE;
  if (t === "Logit" || modelResult.second?.modelLabel === "Logistic Regression") return ESTIMATOR_STARTERS.Logit;
  if (t === "Probit" || modelResult.second?.modelLabel === "Probit") return ESTIMATOR_STARTERS.Probit;
  return null;
}

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
  const { C, T } = useTheme();
  const isUser = role === "user";
  return (
    <div style={{ display: "flex", justifyContent: isUser ? "flex-end" : "flex-start", marginBottom: 8 }}>
      {!isUser && (
        <div style={{
          width: 16, height: 16, borderRadius: "50%", marginRight: 6, marginTop: 3, flexShrink: 0,
          background: `${C.violet}30`, border: `1px solid ${C.violet}60`,
          display: "flex", alignItems: "center", justifyContent: "center",
          fontSize: T.caption.fontSize, color: C.violet,
        }}>AI</div>
      )}
      <div style={{
        maxWidth: "82%", padding: "0.5rem 0.75rem",
        background: isUser ? `${C.violet}18` : C.surface2,
        border: `1px solid ${isUser ? C.violet + "40" : C.border}`,
        borderRadius: isUser ? "8px 8px 2px 8px" : "8px 8px 8px 2px",
        fontSize: T.code.fontSize, color: C.text, fontFamily: T.code.fontFamily, lineHeight: 1.7,
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

// Action button rendered under an assistant message that carries a cleaning
// dispatch — one click navigates to Clean and pre-loads the AI command bar.
function DispatchButton({ action, onClick }) {
  const { C, T } = useTheme();
  return (
    <div style={{ display: "flex", justifyContent: "flex-start", marginBottom: 8, marginLeft: 22 }}>
      <button
        onClick={onClick}
        style={{
          display: "inline-flex", alignItems: "center", gap: 6,
          padding: "0.4rem 0.7rem", cursor: "pointer",
          background: `${C.teal}18`, border: `1px solid ${C.teal}`, borderRadius: 6,
          color: C.teal, fontFamily: T.code.fontFamily, fontSize: T.caption.fontSize, letterSpacing: "0.04em",
        }}
        onMouseEnter={e => { e.currentTarget.style.background = `${C.teal}28`; }}
        onMouseLeave={e => { e.currentTarget.style.background = `${C.teal}18`; }}
        title={`AI Assistant: ${action.instruction}`}
      >
        → {action.label}
      </button>
    </div>
  );
}

function ThinkingBubble() {
  const { C, T } = useTheme();
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 8 }}>
      <div style={{
        width: 16, height: 16, borderRadius: "50%",
        background: `${C.violet}30`, border: `1px solid ${C.violet}60`,
        display: "flex", alignItems: "center", justifyContent: "center",
        fontSize: T.caption.fontSize, color: C.violet, flexShrink: 0,
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
        <span style={{ fontSize: T.caption.fontSize, color: C.textMuted, fontFamily: T.code.fontFamily }}>Thinking…</span>
      </div>
    </div>
  );
}

const PROXY_ENABLED = import.meta.env.VITE_AI_PROXY_ENABLED === "true";

function makeConversation() {
  const now = Date.now();
  return {
    id:        `c_${now}_${Math.random().toString(36).slice(2, 7)}`,
    title:     "New chat",
    createdAt: now,
    updatedAt: now,
    messages:  [],
  };
}

function deriveTitle(text) {
  const trimmed = (text || "").trim();
  if (!trimmed) return "New chat";
  const words = trimmed.split(/\s+/).slice(0, 6).join(" ");
  return words.length < trimmed.length ? words + "…" : words;
}

// Drop the transient multipart `content` field before persisting — it is
// rebuilt from text + images at send time, keeping stored records small.
function stripForStorage(conversations) {
  return conversations.map(c => ({
    ...c,
    messages: c.messages.map(m => {
      const copy = { ...m };
      delete copy.content;
      return copy;
    }),
  }));
}

export default function AIContextSidebar({ isOpen, onClose, screen, cleanedData, modelResult, prefillMessage = null, pid = null, pinnedModels = [], subsets = null, inferenceOpts = null, onDispatchToAssistant = null }) {
  const { C, T } = useTheme();
  const { tier, session, credits, refreshCredits } = useAuth();
  // In proxy mode, any authenticated user can use AI — gated by credits, not tier.
  // In dev mode (proxy off), allow all (direct key usage).
  const hasAccess = !PROXY_ENABLED || !!session;
  const outOfCredits = PROXY_ENABLED && !!session && credits !== null && credits === 0;
  const sessionState = useSessionState();
  // Full session snapshot for the coach (pipeline, pinned models, subsets, inference).
  // sessionLog is intentionally omitted: the second AIContextSidebar mount lives
  // outside SessionLogProvider, and useSessionLog() throws without a provider.
  const snapshot = useMemo(() => buildSessionSnapshot({
    cleanedData,
    result: modelResult,
    pinnedModels,
    subsets,
    inferenceOpts,
    sessionLog: [],
  }), [cleanedData, modelResult, pinnedModels, subsets, inferenceOpts]);
  const [conversations, setConversations] = useState([]);
  const [activeId,      setActiveId]      = useState(null);
  const active  = conversations.find(c => c.id === activeId) ?? null;
  const history = useMemo(() => active?.messages ?? [], [active]);
  const [input,         setInput]         = useState("");
  const [loading,       setLoading]       = useState(false);
  const [pendingImages, setPendingImages] = useState([]); // [{ dataUrl, base64, mediaType }]
  const bottomRef  = useRef(null);
  const inputRef   = useRef(null);
  const abortRef   = useRef(null);
  const loadedPidRef = useRef(null);   // pid that the in-state conversations belong to
  const [savedPlots, setSavedPlots] = useState([]);
  useEffect(() => {
    if (!pid) return;
    getPlotHistory(pid).then(setSavedPlots).catch(() => {});
  }, [pid, isOpen]); // reload each time the sidebar opens so fresh plots are visible

  function updateActive(mutateMessages) {
    setConversations(prev => prev.map(c => {
      if (c.id !== activeId) return c;
      const messages = mutateMessages(c.messages);
      let title = c.title;
      if ((!c.title || c.title === "New chat") && messages.length) {
        const firstUser = messages.find(m => m.role === "user");
        if (firstUser) title = deriveTitle(firstUser.text);
      }
      return { ...c, messages, title, updatedAt: Date.now() };
    }));
  }

  const [showChats, setShowChats] = useState(false);
  const [renameId,  setRenameId]  = useState(null);
  const [renameVal, setRenameVal] = useState("");

  function newChat() {
    const c = makeConversation();
    setConversations(prev => [c, ...prev]);
    setActiveId(c.id);
    setShowChats(false);
  }
  function selectChat(id) {
    setActiveId(id);
    setShowChats(false);
  }
  function deleteChat(id) {
    setConversations(prev => {
      const next = prev.filter(c => c.id !== id);
      if (next.length === 0) {
        const seed = makeConversation();
        setActiveId(seed.id);
        return [seed];
      }
      if (id === activeId) setActiveId(next[0].id);
      return next;
    });
  }
  function commitRename(id) {
    const title = renameVal.trim();
    if (title) setConversations(prev => prev.map(c => c.id === id ? { ...c, title } : c));
    setRenameId(null);
    setRenameVal("");
  }

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

  useEffect(() => {
    if (!isOpen) return;
    let cancelled = false;
    // Invalidate persistence until the conversations for THIS pid are loaded —
    // prevents the previous project's chats from being saved under the new pid.
    loadedPidRef.current = null;
    (async () => {
      if (!pid) {
        // No project loaded — ephemeral single conversation, not persisted.
        setConversations(prev => {
          if (prev.length) return prev;
          const seed = makeConversation();
          setActiveId(seed.id);
          return [seed];
        });
        return;
      }
      const rec   = await loadCoachChats(pid);
      if (cancelled) return;
      const convs = rec?.conversations?.length ? rec.conversations : [makeConversation()];
      setConversations(convs);
      setActiveId(convs[0].id);
      loadedPidRef.current = pid;
    })();
    return () => { cancelled = true; };
  }, [pid, isOpen]);

  useEffect(() => {
    if (!pid || loadedPidRef.current !== pid || !conversations.length) return;
    const t = setTimeout(() => {
      saveCoachChats(pid, stripForStorage(conversations)).catch(() => {});
    }, 500);
    return () => clearTimeout(t);
  }, [pid, conversations]);

  const starters = (screen === "model" && modelResult && pickEstimatorStarters(modelResult))
    || SCREEN_STARTERS[screen]
    || SCREEN_STARTERS.default;
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
    const priorHistory = history; // snapshot BEFORE append — used for API context
    updateActive(msgs => [...msgs, userEntry]);
    setInput("");
    setPendingImages([]);
    setLoading(true);

    const controller = new AbortController();
    abortRef.current = controller;

    try {
      await researchCoach({
        question: q || "(image)",
        images: imgs,
        modelResult,
        dataDictionary: cleanedData?.dataDictionary ?? null,
        metadataReport,
        snapshot,
        cleanedData,
        allDatasets: Object.values(sessionState?.datasets ?? {}),
        savedPlots,
        signal: controller.signal,
        onText: (piece) => {
          updateActive(msgs => {
            const copy = msgs.slice();
            const last = copy[copy.length - 1];
            if (last && last.role === "assistant") {
              copy[copy.length - 1] = { ...last, text: last.text + piece };
            } else {
              copy.push({ role: "assistant", text: piece });
            }
            return copy;
          });
        },
        history: priorHistory.map((h, idx) => ({
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

      // ── Coach → cleaning dispatch ─────────────────────────────────────────
      // After the reply streams in, run a cheap structured check: does this
      // question map to a single-column cleaning action the Clean-tab command
      // bar can execute? If so, attach the action to the assistant message so a
      // "→ apply" button renders below it. Only when a handler is wired and we
      // have a dataset; any failure is silent (reply is unaffected).
      if (onDispatchToAssistant && cleanedData?.headers?.length) {
        const action = await coachDispatch({
          question: q,
          headers: cleanedData.headers,
          sampleRows: (cleanedData.cleanRows ?? []).slice(0, 8),
          pipeline: (cleanedData.pipeline ?? cleanedData.changeLog ?? []).map(s => ({ type: s.type, col: s.col ?? s.c1 ?? s.nn ?? null })),
          dataDictionary: cleanedData.dataDictionary ?? null,
        }).catch(() => null);
        if (action) {
          updateActive(msgs => {
            const copy = msgs.slice();
            const last = copy[copy.length - 1];
            if (last && last.role === "assistant") copy[copy.length - 1] = { ...last, dispatch: action };
            return copy;
          });
        }
      }
    } finally {
      setLoading(false);
      abortRef.current = null;
    }
  }

  async function safeSubmit(question) {
    try {
      await submit(question);
    } catch (err) {
      setLoading(false);
      const msg = err.message === "PREMIUM_REQUIRED"
        ? "Your account doesn't have access to AI features. Sign in to use the AI Coach."
        : err.message === "INSUFFICIENT_CREDITS"
        ? "You've used all your credits for this month. Credits reset automatically every 30 days."
        : `Error: ${err.message}`;
      updateActive(msgs => [...msgs, { role: "assistant", text: msg }]);
    } finally {
      if (PROXY_ENABLED && session) refreshCredits();
    }
  }

  const screenLabel = {
    studio:   "Wrangling",
    modeling: "Modeling Lab",
    explorer: "Evidence Explorer",
    output:   "Pipeline Output",
  }[screen] ?? screen ?? "Global";

  if (!isOpen) return null;

  // ── Auth gate (no session in proxy mode) ───────────────────────────────────
  if (!hasAccess) return (
    <>
      <div onClick={onClose}
        style={{ position: "fixed", inset: 0, zIndex: 199, background: "rgba(0,0,0,0.35)" }} />
      <div style={{
        position: "fixed", top: 38, right: 0, bottom: 0, zIndex: 200,
        width: "min(420px, 92vw)", background: C.bg, borderLeft: `1px solid ${C.border}`,
        display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center",
        gap: 16, padding: "2rem", boxShadow: "-8px 0 32px rgba(0,0,0,0.6)",
      }}>
        <div style={{ fontSize: T.display.fontSize }}>✦</div>
        <div style={{ fontSize: T.body.fontSize, fontFamily: T.code.fontFamily, color: C.gold, letterSpacing: "0.1em", textTransform: "uppercase" }}>
          Premium Feature
        </div>
        <div style={{ fontSize: T.code.fontSize, fontFamily: T.code.fontFamily, color: C.textMuted, textAlign: "center", lineHeight: 1.7, maxWidth: 280 }}>
          Sign in to use the AI Research Coach.
        </div>
        <button onClick={onClose}
          style={{ marginTop: 8, padding: "0.45rem 1rem", background: "transparent", border: `1px solid ${C.border2}`, borderRadius: 3, color: C.textMuted, fontFamily: T.code.fontFamily, fontSize: T.caption.fontSize, cursor: "pointer" }}>
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
            <div style={{ fontSize: T.caption.fontSize, color: C.violet, letterSpacing: "0.22em", textTransform: "uppercase", fontFamily: T.code.fontFamily, marginBottom: 2 }}>
              AI Research Coach
            </div>
            <div style={{ fontSize: T.caption.fontSize, color: C.textMuted, fontFamily: T.code.fontFamily }}>
              {screenLabel}
              {modelResult && <span style={{ color: C.teal }}> · {(modelResult.second ?? modelResult).modelLabel ?? "Model"}</span>}
              {Object.keys(sessionState?.datasets ?? {}).length > 1 && (
                <span style={{ color: C.gold }}> · {Object.keys(sessionState.datasets).length} datasets</span>
              )}
            </div>
          </div>
          {PROXY_ENABLED && credits !== null && (
            <div title="Credits remaining this month" style={{
              fontSize: T.caption.fontSize, fontFamily: T.code.fontFamily,
              color: credits === 0 ? C.red : credits < 6 ? C.gold : C.teal,
              border: `1px solid ${credits === 0 ? C.red : credits < 6 ? C.gold : C.border2}`,
              borderRadius: 3, padding: "0.2rem 0.45rem", marginLeft: "auto", marginRight: 8,
              letterSpacing: "0.05em",
            }}>
              ✦ {credits}
            </div>
          )}
          <button onClick={() => setShowChats(s => !s)}
            style={{ background: "transparent", border: `1px solid ${C.border2}`, borderRadius: 3, color: C.textMuted, cursor: "pointer", fontFamily: T.code.fontFamily, fontSize: T.caption.fontSize, padding: "0.25rem 0.5rem", marginLeft: PROXY_ENABLED && credits !== null ? 0 : "auto", marginRight: 8 }}>
            ☰ Chats ({conversations.length})
          </button>
          <button onClick={onClose}
            style={{ background: "transparent", border: `1px solid ${C.border2}`, borderRadius: 3, color: C.textMuted, cursor: "pointer", fontFamily: T.code.fontFamily, fontSize: T.caption.fontSize, padding: "0.25rem 0.55rem" }}>
            ✕
          </button>
        </div>

        {showChats && (
          <div style={{ borderBottom: `1px solid ${C.border}`, background: C.surface, maxHeight: 240, overflowY: "auto", flexShrink: 0 }}>
            <button onClick={newChat}
              style={{ width: "100%", textAlign: "left", padding: "0.5rem 1rem", background: "transparent", border: "none", borderBottom: `1px solid ${C.border}`, color: C.violet, cursor: "pointer", fontFamily: T.code.fontFamily, fontSize: T.caption.fontSize }}>
              + New chat
            </button>
            {conversations.map(c => (
              <div key={c.id}
                style={{ display: "flex", alignItems: "center", gap: 6, padding: "0.4rem 0.75rem 0.4rem 1rem", background: c.id === activeId ? C.surface2 : "transparent", borderBottom: `1px solid ${C.border}` }}>
                {renameId === c.id ? (
                  <input autoFocus value={renameVal}
                    onChange={e => setRenameVal(e.target.value)}
                    onKeyDown={e => { if (e.key === "Enter") commitRename(c.id); if (e.key === "Escape") { setRenameId(null); setRenameVal(""); } }}
                    onBlur={() => commitRename(c.id)}
                    style={{ flex: 1, background: C.bg, border: `1px solid ${C.violet}`, borderRadius: 3, color: C.text, fontFamily: T.code.fontFamily, fontSize: T.caption.fontSize, padding: "0.2rem 0.35rem", outline: "none" }} />
                ) : (
                  <button onClick={() => selectChat(c.id)}
                    style={{ flex: 1, textAlign: "left", background: "transparent", border: "none", color: c.id === activeId ? C.teal : C.textDim, cursor: "pointer", fontFamily: T.code.fontFamily, fontSize: T.caption.fontSize, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                    {c.title}
                  </button>
                )}
                <button onClick={() => { setRenameId(c.id); setRenameVal(c.title); }}
                  title="Rename"
                  style={{ background: "transparent", border: "none", color: C.textMuted, cursor: "pointer", fontFamily: T.code.fontFamily, fontSize: T.caption.fontSize, padding: "0 2px" }}>✎</button>
                <button onClick={() => deleteChat(c.id)}
                  title="Delete"
                  style={{ background: "transparent", border: "none", color: C.textMuted, cursor: "pointer", fontFamily: T.code.fontFamily, fontSize: T.caption.fontSize, padding: "0 2px" }}
                  onMouseEnter={e => { e.currentTarget.style.color = C.red; }}
                  onMouseLeave={e => { e.currentTarget.style.color = C.textMuted; }}>✕</button>
              </div>
            ))}
          </div>
        )}

        {/* Message area */}
        <div style={{ flex: 1, overflowY: "auto", padding: "0.85rem 1rem 0.5rem" }}>
          {history.length === 0 && !loading && (
            <>
              <div style={{ fontSize: T.caption.fontSize, color: C.textMuted, fontFamily: T.code.fontFamily, marginBottom: "0.75rem", lineHeight: 1.6 }}>
                {snapshot?.pipeline?.length || snapshot?.activeResult
                  ? <>I have full context of your session — {screenLabel} state{Object.keys(sessionState?.datasets ?? {}).length > 1 ? `, ${Object.keys(sessionState.datasets).length} loaded datasets` : ""}, pipeline, and model. Ask anything.</>
                  : <>I can see your current {screenLabel} state. Ask anything.</>}
              </div>
              <div style={{ display: "flex", flexDirection: "column", gap: 6, marginBottom: "0.75rem" }}>
                {starters.map((q, i) => (
                  <button key={i} onClick={() => safeSubmit(q)} disabled={loading}
                    style={{
                      padding: "0.35rem 0.65rem", textAlign: "left",
                      background: "transparent", border: `1px solid ${C.border2}`,
                      borderRadius: 3, cursor: "pointer", fontFamily: T.code.fontFamily,
                      fontSize: T.caption.fontSize, color: C.textDim, transition: "all 0.12s",
                    }}
                    onMouseEnter={e => { e.currentTarget.style.borderColor = C.violet; e.currentTarget.style.color = C.violet; }}
                    onMouseLeave={e => { e.currentTarget.style.borderColor = C.border2; e.currentTarget.style.color = C.textDim; }}
                  >{q}</button>
                ))}
              </div>
            </>
          )}

          {history.map((h, i) => (
            <div key={i}>
              <Bubble role={h.role} text={h.text} images={h.images} />
              {h.dispatch && onDispatchToAssistant && (
                <DispatchButton
                  action={h.dispatch}
                  onClick={() => onDispatchToAssistant({ col: h.dispatch.col, instruction: h.dispatch.instruction })}
                />
              )}
            </div>
          ))}
          {loading && history[history.length - 1]?.role !== "assistant" && <ThinkingBubble />}
          <div ref={bottomRef} />
        </div>

        {/* Input */}
        <div style={{
          borderTop: `1px solid ${C.border}`, padding: "0.65rem 1rem",
          display: "flex", flexDirection: "column", gap: 6, flexShrink: 0,
        }}>
          {outOfCredits && (
            <div style={{ fontSize: T.caption.fontSize, fontFamily: T.code.fontFamily, color: C.gold, background: `${C.gold}18`, border: `1px solid ${C.gold}44`, borderRadius: 3, padding: "0.4rem 0.65rem", lineHeight: 1.5 }}>
              You've used all your credits this month. They reset every 30 days.
            </div>
          )}

          {/* Pending image thumbnails */}
          {pendingImages.length > 0 && (
            <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
              {pendingImages.map((img, i) => (
                <div key={i} style={{ position: "relative" }}>
                  <img src={img.dataUrl} alt="" style={{ height: 56, borderRadius: 3, border: `1px solid ${C.border2}`, objectFit: "contain", maxWidth: 100 }} />
                  <button onClick={() => setPendingImages(prev => prev.filter((_, j) => j !== i))}
                    style={{ position: "absolute", top: -4, right: -4, width: 14, height: 14, borderRadius: "50%", background: C.surface, border: `1px solid ${C.border2}`, cursor: "pointer", fontSize: T.caption.fontSize, color: C.textMuted, display: "flex", alignItems: "center", justifyContent: "center", lineHeight: 1 }}>
                    ✕
                  </button>
                </div>
              ))}
            </div>
          )}

          <div style={{ display: "flex", gap: 8, alignItems: "flex-end" }}>
          {history.length > 0 && (
            <button onClick={() => { updateActive(() => []); setInput(""); setPendingImages([]); }}
              style={{ padding: "0.45rem 0.55rem", background: "transparent", border: `1px solid ${C.border}`, borderRadius: 3, color: C.textMuted, cursor: "pointer", fontFamily: T.code.fontFamily, fontSize: T.caption.fontSize, flexShrink: 0, transition: "all 0.12s" }}
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
            disabled={loading || outOfCredits}
            placeholder="Ask anything… paste an image with Ctrl+V"
            rows={1}
            style={{
              flex: 1, resize: "none", overflow: "hidden",
              background: C.surface2, border: `1px solid ${C.border2}`,
              borderRadius: 3, padding: "0.45rem 0.65rem",
              fontFamily: T.code.fontFamily, fontSize: T.code.fontSize, color: C.text,
              outline: "none", lineHeight: 1.5,
            }}
            onInput={e => { e.target.style.height = "auto"; e.target.style.height = Math.min(e.target.scrollHeight, 100) + "px"; }}
            onFocus={e => { e.target.style.borderColor = C.violet; }}
            onBlur={e => { e.target.style.borderColor = C.border2; }}
          />
          <button
            onClick={loading ? () => abortRef.current?.abort() : () => safeSubmit()}
            disabled={outOfCredits || (!loading && !input.trim() && pendingImages.length === 0)}
            style={{
              padding: "0.45rem 0.85rem", borderRadius: 3, flexShrink: 0,
              background: loading ? C.red : ((input.trim() || pendingImages.length > 0) ? C.violet : "transparent"),
              border: `1px solid ${loading ? C.red : ((input.trim() || pendingImages.length > 0) ? C.violet : C.border2)}`,
              color: loading ? C.bg : ((input.trim() || pendingImages.length > 0) ? C.bg : C.textMuted),
              fontFamily: T.code.fontFamily, fontSize: T.caption.fontSize, fontWeight: 700,
              cursor: loading || input.trim() ? "pointer" : "not-allowed",
              transition: "all 0.13s",
            }}
          >{loading ? "Stop" : "Ask"}</button>
          </div>
        </div>
      </div>
    </>
  );
}
