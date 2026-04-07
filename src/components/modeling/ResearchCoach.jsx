// ─── ECON STUDIO · components/modeling/ResearchCoach.jsx ─────────────────────
// Conversational AI advisor that reads the active model result and answers
// methodology questions, suggests robustness checks, and flags identification threats.
//
// Props:
//   result          — active model result object (from ModelingTab state)
//   dataDictionary  — Record<string, string> | null
//
// Self-contained state: conversation history lives here, resets when result changes.

import { useState, useEffect, useRef } from "react";
import { researchCoach } from "../../services/ai/AIService.js";
import { C, mono } from "./shared.jsx";

// ─── STARTER QUESTIONS ────────────────────────────────────────────────────────
// Keyed by model type — shown as clickable chips to lower the barrier to entry.
const STARTERS = {
  default: [
    "Are there signs of omitted variable bias in this model?",
    "Which coefficients should I be most cautious about?",
    "What robustness checks would strengthen this result?",
    "How should I interpret the R² in context?",
  ],
  "2SLS": [
    "Is my instrument strong enough? What does the first-stage F imply?",
    "How do I verify the exclusion restriction holds?",
    "Should I report LIML as a robustness check?",
    "What does a weak instrument do to my estimates?",
  ],
  DiD: [
    "How do I test the parallel trends assumption here?",
    "What does the ATT estimate mean for my policy question?",
    "Should I be worried about anticipation effects?",
    "How sensitive is this to the choice of comparison group?",
  ],
  TWFE: [
    "Am I affected by the negative weighting problem in TWFE?",
    "Should I use Callaway-Sant'Anna or Sun-Abraham instead?",
    "How do I test for pre-trends with this setup?",
    "What does treatment effect heterogeneity imply here?",
  ],
  RDD: [
    "How sensitive are results to the bandwidth choice?",
    "Should I test for bunching / manipulation at the cutoff?",
    "What does local validity mean for external validity here?",
    "Is the continuity assumption plausible for this running variable?",
  ],
  FE: [
    "What unobserved heterogeneity does the FE estimator control for?",
    "Should I use a Hausman test to choose between FE and RE?",
    "Are my standard errors clustered at the right level?",
    "What variation in the data identifies these coefficients?",
  ],
  Logit: [
    "Should I report odds ratios or marginal effects?",
    "How do I interpret the McFadden R²?",
    "When should I prefer logit over probit here?",
    "Are the marginal effects economically meaningful?",
  ],
  Probit: [
    "Should I report odds ratios or marginal effects?",
    "How do I interpret the McFadden R²?",
    "When should I prefer probit over logit here?",
    "Are the marginal effects economically meaningful?",
  ],
};

function getStarters(result) {
  if (!result) return STARTERS.default;
  const t = result.type ?? result.second?.modelLabel ?? result.modelLabel ?? "";
  if (t === "2SLS" || t === "IV") return STARTERS["2SLS"];
  if (t === "DiD" || t === "2x2DiD") return STARTERS.DiD;
  if (t === "TWFE") return STARTERS.TWFE;
  if (t === "RDD") return STARTERS.RDD;
  if (t === "FE" || t === "FD") return STARTERS.FE;
  if (t === "Logit" || result.second?.modelLabel === "Logistic Regression") return STARTERS.Logit;
  if (t === "Probit" || result.second?.modelLabel === "Probit") return STARTERS.Probit;
  return STARTERS.default;
}

// ─── ATOMS ────────────────────────────────────────────────────────────────────
function Spin() {
  return (
    <div style={{
      width: 12, height: 12,
      border: `2px solid ${C.border2}`, borderTopColor: C.violet,
      borderRadius: "50%", animation: "rc-spin 0.7s linear infinite", flexShrink: 0,
    }} />
  );
}

function UserBubble({ text }) {
  return (
    <div style={{ display: "flex", justifyContent: "flex-end", marginBottom: 10 }}>
      <div style={{
        maxWidth: "78%", padding: "0.55rem 0.85rem",
        background: `${C.violet}18`, border: `1px solid ${C.violet}40`,
        borderRadius: "8px 8px 2px 8px",
        fontSize: 11, color: C.text, fontFamily: mono, lineHeight: 1.65,
      }}>
        {text}
      </div>
    </div>
  );
}

function AssistantBubble({ text }) {
  return (
    <div style={{ display: "flex", justifyContent: "flex-start", marginBottom: 10 }}>
      <div style={{ marginRight: 8, marginTop: 4, flexShrink: 0 }}>
        <div style={{
          width: 18, height: 18, borderRadius: "50%",
          background: `${C.violet}30`, border: `1px solid ${C.violet}60`,
          display: "flex", alignItems: "center", justifyContent: "center",
          fontSize: 9, color: C.violet,
        }}>AI</div>
      </div>
      <div style={{
        maxWidth: "82%", padding: "0.55rem 0.85rem",
        background: C.surface2, border: `1px solid ${C.border}`,
        borderRadius: "8px 8px 8px 2px",
        fontSize: 11, color: C.text, fontFamily: mono, lineHeight: 1.75,
        whiteSpace: "pre-wrap",
      }}>
        {text}
      </div>
    </div>
  );
}

function ThinkingBubble() {
  return (
    <div style={{ display: "flex", justifyContent: "flex-start", marginBottom: 10, alignItems: "center" }}>
      <div style={{
        width: 18, height: 18, borderRadius: "50%", marginRight: 8, flexShrink: 0,
        background: `${C.violet}30`, border: `1px solid ${C.violet}60`,
        display: "flex", alignItems: "center", justifyContent: "center",
        fontSize: 9, color: C.violet,
      }}>AI</div>
      <div style={{
        padding: "0.55rem 0.85rem",
        background: C.surface2, border: `1px solid ${C.border}`,
        borderRadius: "8px 8px 8px 2px",
        display: "flex", alignItems: "center", gap: 8,
      }}>
        <Spin />
        <span style={{ fontSize: 10, color: C.textMuted, fontFamily: mono }}>Thinking…</span>
      </div>
    </div>
  );
}

// ─── MAIN COMPONENT ───────────────────────────────────────────────────────────
export default function ResearchCoach({ result, dataDictionary }) {
  const [open,     setOpen]     = useState(false);
  const [history,  setHistory]  = useState([]);   // { role:'user'|'assistant', text }[]
  const [input,    setInput]    = useState("");
  const [loading,  setLoading]  = useState(false);
  const bottomRef  = useRef(null);
  const inputRef   = useRef(null);

  // Reset conversation when the model result changes
  useEffect(() => {
    setHistory([]);
    setInput("");
  }, [result]);

  // Auto-scroll to bottom on new messages
  useEffect(() => {
    if (open) bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [history, loading, open]);

  const starters = getStarters(result);
  const hasResult = !!result;

  async function submit(question) {
    const q = (question ?? input).trim();
    if (!q || loading || !hasResult) return;

    const userTurn = { role: "user", text: q };
    const nextHistory = [...history, userTurn];
    setHistory(nextHistory);
    setInput("");
    setLoading(true);

    // history passed to API excludes the turn we just appended (it goes as `question`)
    const reply = await researchCoach({
      question: q,
      modelResult: result,
      dataDictionary,
      history: history,   // previous turns only — researchCoach appends the new question
    });

    setHistory(prev => [...prev, { role: "assistant", text: reply }]);
    setLoading(false);
  }

  function handleKey(e) {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      submit();
    }
  }

  return (
    <div style={{ marginTop: "1.5rem" }}>
      <style>{`
        @keyframes rc-spin { to { transform: rotate(360deg); } }
        @keyframes rc-fade { from { opacity:0; transform:translateY(4px); } to { opacity:1; transform:translateY(0); } }
      `}</style>

      {/* ── Header / toggle ─────────────────────────────────────────────────── */}
      <button
        onClick={() => { setOpen(o => !o); if (!open) setTimeout(() => inputRef.current?.focus(), 80); }}
        style={{
          width: "100%", display: "flex", alignItems: "center", justifyContent: "space-between",
          padding: "0.6rem 1rem",
          background: open ? `${C.violet}10` : "transparent",
          border: `1px solid ${open ? C.violet + "50" : C.border}`,
          borderRadius: open ? "4px 4px 0 0" : 4,
          cursor: "pointer", transition: "all 0.15s",
        }}
        onMouseEnter={e => { if (!open) e.currentTarget.style.borderColor = C.violet + "50"; }}
        onMouseLeave={e => { if (!open) e.currentTarget.style.borderColor = C.border; }}
      >
        <span style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <span style={{ fontSize: 9, color: C.violet, letterSpacing: "0.22em", textTransform: "uppercase", fontFamily: mono }}>
            AI Research Coach
          </span>
          {!hasResult && (
            <span style={{ fontSize: 9, color: C.textMuted, fontFamily: mono }}>
              — run a model first
            </span>
          )}
          {history.length > 0 && (
            <span style={{ fontSize: 9, padding: "1px 6px", borderRadius: 8,
                           background: `${C.violet}25`, color: C.violet, fontFamily: mono }}>
              {history.filter(h => h.role === "user").length}
            </span>
          )}
        </span>
        <span style={{ fontSize: 11, color: C.textMuted, fontFamily: mono }}>
          {open ? "▲" : "▼"}
        </span>
      </button>

      {/* ── Expanded panel ──────────────────────────────────────────────────── */}
      {open && (
        <div style={{
          border: `1px solid ${C.violet}50`, borderTop: "none",
          borderRadius: "0 0 4px 4px",
          background: C.surface,
          animation: "rc-fade 0.15s ease",
        }}>
          {/* Message history */}
          <div style={{
            minHeight: 120, maxHeight: 360,
            overflowY: "auto", padding: "1rem 1rem 0.5rem",
          }}>
            {history.length === 0 && !loading && (
              <div style={{ fontSize: 10, color: C.textMuted, fontFamily: mono, marginBottom: "0.75rem" }}>
                {hasResult
                  ? "Ask anything about your model, identification strategy, or next steps."
                  : "Estimate a model to enable the research coach."}
              </div>
            )}

            {history.map((turn, i) =>
              turn.role === "user"
                ? <UserBubble key={i} text={turn.text} />
                : <AssistantBubble key={i} text={turn.text} />
            )}

            {loading && <ThinkingBubble />}
            <div ref={bottomRef} />
          </div>

          {/* Starter questions — shown only before first message */}
          {history.length === 0 && hasResult && (
            <div style={{ padding: "0 1rem 0.75rem", display: "flex", flexWrap: "wrap", gap: 6 }}>
              {starters.map((q, i) => (
                <button key={i} onClick={() => submit(q)} disabled={loading}
                  style={{
                    padding: "0.28rem 0.7rem",
                    background: "transparent", border: `1px solid ${C.border2}`,
                    borderRadius: 3, cursor: loading ? "not-allowed" : "pointer",
                    fontFamily: mono, fontSize: 10, color: C.textDim,
                    transition: "all 0.12s", textAlign: "left",
                    opacity: loading ? 0.4 : 1,
                  }}
                  onMouseEnter={e => { e.currentTarget.style.borderColor = C.violet; e.currentTarget.style.color = C.violet; }}
                  onMouseLeave={e => { e.currentTarget.style.borderColor = C.border2; e.currentTarget.style.color = C.textDim; }}
                >
                  {q}
                </button>
              ))}
            </div>
          )}

          {/* Input bar */}
          <div style={{
            display: "flex", alignItems: "flex-end", gap: 8,
            padding: "0.65rem 1rem",
            borderTop: `1px solid ${C.border}`,
          }}>
            <textarea
              ref={inputRef}
              value={input}
              onChange={e => setInput(e.target.value)}
              onKeyDown={handleKey}
              disabled={!hasResult || loading}
              placeholder={hasResult ? "Ask a question… (Enter to send, Shift+Enter for newline)" : "Run a model first"}
              rows={1}
              style={{
                flex: 1, resize: "none", overflow: "hidden",
                background: C.surface2, border: `1px solid ${C.border2}`,
                borderRadius: 3, padding: "0.5rem 0.7rem",
                fontFamily: mono, fontSize: 11, color: C.text,
                outline: "none", lineHeight: 1.5,
                opacity: hasResult ? 1 : 0.4,
              }}
              onInput={e => {
                e.target.style.height = "auto";
                e.target.style.height = Math.min(e.target.scrollHeight, 120) + "px";
              }}
              onFocus={e => { e.target.style.borderColor = C.violet; }}
              onBlur={e => { e.target.style.borderColor = C.border2; }}
            />
            <button
              onClick={() => submit()}
              disabled={!hasResult || loading || !input.trim()}
              style={{
                padding: "0.5rem 1rem", borderRadius: 3,
                background: hasResult && input.trim() && !loading ? C.violet : "transparent",
                border: `1px solid ${hasResult && input.trim() && !loading ? C.violet : C.border2}`,
                color: hasResult && input.trim() && !loading ? C.bg : C.textMuted,
                fontFamily: mono, fontSize: 10, fontWeight: 700,
                cursor: hasResult && input.trim() && !loading ? "pointer" : "not-allowed",
                transition: "all 0.13s", flexShrink: 0,
              }}
            >
              {loading ? "…" : "Ask"}
            </button>
            {history.length > 0 && (
              <button
                onClick={() => { setHistory([]); setInput(""); }}
                style={{
                  padding: "0.5rem 0.65rem", borderRadius: 3,
                  background: "transparent", border: `1px solid ${C.border}`,
                  color: C.textMuted, fontFamily: mono, fontSize: 10,
                  cursor: "pointer", transition: "all 0.12s", flexShrink: 0,
                }}
                onMouseEnter={e => { e.currentTarget.style.color = C.red; e.currentTarget.style.borderColor = C.red; }}
                onMouseLeave={e => { e.currentTarget.style.color = C.textMuted; e.currentTarget.style.borderColor = C.border; }}
                title="Clear conversation"
              >✕</button>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
