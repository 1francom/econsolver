// ─── FEEDBACK MODAL ───────────────────────────────────────────────────────────
// Floating modal triggered from the WorkspaceBar ⚑ button.
// Fields: module (pre-filled from active tab), type chip, description textarea.
import { useState, useEffect } from "react";
import { submitFeedback } from "../../services/feedback/feedbackService.js";
import { useTheme } from "../../ThemeContext.jsx";


const MODULES = [
  "Data", "Clean", "Explore", "Model",
  "Spatial", "Simulate", "Calculate", "Report", "General",
];

const TYPES = [
  { id: "bug",         label: "Bug"           },
  { id: "feature",     label: "Feature"       },
  { id: "ux",          label: "UX / Design"   },
  { id: "performance", label: "Performance"   },
  { id: "other",       label: "Other"         },
];

// Map WorkspaceBar tab ids → display names
const TAB_TO_MODULE = {
  data: "Data", clean: "Clean", explore: "Explore", model: "Model",
  spatial: "Spatial", simulate: "Simulate", calculate: "Calculate", report: "Report",
};

export default function FeedbackModal({ activeTab, onClose }) {
  const { C, T } = useTheme();

  const [module,      setModule]      = useState(TAB_TO_MODULE[activeTab] ?? "General");
  const [type,        setType]        = useState("bug");
  const [description, setDescription] = useState("");
  const [loading,     setLoading]     = useState(false);
  const [done,        setDone]        = useState(false);
  const [error,       setError]       = useState(null);

  // Close on Escape
  useEffect(() => {
    function onKey(e) { if (e.key === "Escape") onClose(); }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  async function handleSubmit(e) {
    e.preventDefault();
    if (!description.trim()) return;
    setError(null);
    setLoading(true);
    try {
      await submitFeedback({ module, type, description });
      setDone(true);
      setTimeout(onClose, 1800);
    } catch (err) {
      setError(err.message ?? "Submission failed.");
    } finally {
      setLoading(false);
    }
  }

  const labelStyle = {
    fontSize: T.caption.fontSize,
    color: C.textMuted,
    letterSpacing: "0.22em",
    textTransform: "uppercase",
    fontFamily: T.code.fontFamily,
    marginBottom: 6,
    display: "block",
  };

  return (
    <>
      {/* ── Backdrop ── */}
      <div
        onClick={onClose}
        style={{
          position: "fixed", inset: 0,
          background: "rgba(0,0,0,0.55)",
          zIndex: 1100,
        }}
      />

      {/* ── Panel ── */}
      <div style={{
        position: "fixed",
        top: "50%",
        left: "50%",
        transform: "translate(-50%,-50%)",
        zIndex: 1101,
        width: 380,
        background: C.surface,
        border: `1px solid ${C.border}`,
        borderRadius: 6,
        padding: "1.6rem",
        fontFamily: T.code.fontFamily,
      }}>

        {/* ── Header ── */}
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: "1.4rem" }}>
          <div style={{ fontSize: T.code.fontSize, color: C.teal, letterSpacing: "0.14em", fontWeight: 700 }}>
            ⚑ Send feedback
          </div>
          <button
            onClick={onClose}
            style={{ background: "none", border: "none", color: C.textMuted, cursor: "pointer", fontSize: T.body.fontSize, lineHeight: 1, padding: 0 }}
            onMouseEnter={e => { e.currentTarget.style.color = C.text; }}
            onMouseLeave={e => { e.currentTarget.style.color = C.textMuted; }}
          >
            ×
          </button>
        </div>

        {done ? (
          <div style={{ textAlign: "center", padding: "1.5rem 0", fontSize: T.code.fontSize, color: C.teal, letterSpacing: "0.1em" }}>
            ✓ Feedback received — thank you!
          </div>
        ) : (
          <form onSubmit={handleSubmit} style={{ display: "flex", flexDirection: "column", gap: "1.1rem" }}>

            {/* ── Module ── */}
            <div>
              <label style={labelStyle}>Module</label>
              <select
                value={module}
                onChange={e => setModule(e.target.value)}
                style={{
                  width: "100%",
                  padding: "0.5rem 0.7rem",
                  background: C.surface2,
                  border: `1px solid ${C.border2}`,
                  borderRadius: 3,
                  color: C.text,
                  fontFamily: T.code.fontFamily,
                  fontSize: T.code.fontSize,
                  outline: "none",
                  cursor: "pointer",
                }}
              >
                {MODULES.map(m => (
                  <option key={m} value={m}>{m}</option>
                ))}
              </select>
            </div>

            {/* ── Type chips ── */}
            <div>
              <label style={labelStyle}>Type</label>
              <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
                {TYPES.map(t => {
                  const active = type === t.id;
                  return (
                    <button
                      key={t.id}
                      type="button"
                      onClick={() => setType(t.id)}
                      style={{
                        padding: "0.3rem 0.7rem",
                        borderRadius: 3,
                        border: `1px solid ${active ? C.teal : C.border2}`,
                        background: active ? `${C.teal}20` : "transparent",
                        color: active ? C.teal : C.textMuted,
                        fontFamily: T.code.fontFamily,
                        fontSize: T.caption.fontSize,
                        letterSpacing: "0.06em",
                        cursor: "pointer",
                        transition: "all 0.12s",
                      }}
                    >
                      {t.label}
                    </button>
                  );
                })}
              </div>
            </div>

            {/* ── Description ── */}
            <div>
              <label style={labelStyle}>Description</label>
              <textarea
                value={description}
                onChange={e => setDescription(e.target.value)}
                required
                rows={4}
                placeholder="Describe the bug or feature in detail…"
                style={{
                  width: "100%",
                  padding: "0.6rem 0.8rem",
                  background: C.surface2,
                  border: `1px solid ${C.border2}`,
                  borderRadius: 3,
                  color: C.text,
                  fontFamily: T.code.fontFamily,
                  fontSize: T.code.fontSize,
                  outline: "none",
                  resize: "vertical",
                  boxSizing: "border-box",
                  lineHeight: 1.6,
                  transition: "border-color 0.15s",
                }}
                onFocus={e => { e.target.style.borderColor = C.teal; }}
                onBlur={e => { e.target.style.borderColor = C.border2; }}
              />
            </div>

            {error && (
              <div style={{
                fontSize: T.caption.fontSize, color: "#e07070",
                background: "#e0707015", border: "1px solid #e0707040",
                borderRadius: 3, padding: "0.5rem 0.75rem",
              }}>
                {error}
              </div>
            )}

            <button
              type="submit"
              disabled={loading || !description.trim()}
              style={{
                padding: "0.6rem",
                background: (loading || !description.trim()) ? C.surface2 : C.teal,
                color: (loading || !description.trim()) ? C.textMuted : C.bg,
                border: "none", borderRadius: 3,
                fontFamily: T.code.fontFamily, fontSize: T.code.fontSize, fontWeight: 700,
                letterSpacing: "0.1em",
                cursor: (loading || !description.trim()) ? "not-allowed" : "pointer",
                transition: "all 0.15s",
              }}
            >
              {loading ? "Sending…" : "Send feedback"}
            </button>

          </form>
        )}
      </div>
    </>
  );
}
