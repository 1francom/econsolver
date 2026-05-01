// ─── ECON STUDIO · src/components/modeling/CodeEditor.jsx ────────────────────
// Collapsible inline replication script viewer/editor.
// Shows R, Python, or Stata replication code for the active model result.
// The textarea is editable; Copy replicates to clipboard; Reset regenerates.
//
// Props:
//   result  {object}  — active model result (same shape as other modeling components)

import { useState, useEffect, useCallback } from "react";
import { useTheme, mono }                   from "./shared.jsx";
import { generateRScript }                  from "../../services/export/rScript.js";
import { generatePythonScript }             from "../../services/export/pythonScript.js";
import { generateStataScript }              from "../../services/export/stataScript.js";

// ─── TAB DEFINITIONS ─────────────────────────────────────────────────────────
const TABS = [
  { id: "r",      label: "R" },
  { id: "python", label: "Python" },
  { id: "stata",  label: "Stata" },
];

// ─── SCRIPT GENERATOR ────────────────────────────────────────────────────────
// Builds a config object from the result and calls the appropriate generator.
function buildScript(tab, result) {
  if (!result) return "# No model estimated yet.";

  // Resolve spec — result may have it directly or nested (e.g. FE returns {type, fe, fd})
  const spec = result.spec ?? result.fe?.spec ?? result.fd?.spec ?? {};

  const config = {
    filename:      spec.filename      ?? "dataset.csv",
    pipeline:      spec.pipeline      ?? [],
    dataDictionary: spec.dataDictionary ?? null,
    auditTrail:    spec.auditTrail    ?? null,
    model: {
      type:       result.type ?? spec.type ?? "OLS",
      yVar:       spec.yVar       ?? "",
      xVars:      spec.xVars      ?? [],
      wVars:      spec.wVars      ?? [],
      zVars:      spec.zVars      ?? [],
      entityCol:  spec.entityCol  ?? null,
      timeCol:    spec.timeCol    ?? null,
      postVar:    spec.postVar    ?? null,
      treatVar:   spec.treatVar   ?? null,
      runningVar: spec.runningVar ?? null,
      cutoff:     spec.cutoff     ?? null,
      bandwidth:  spec.bandwidth  ?? null,
      kernel:     spec.kernel     ?? "triangular",
    },
  };

  try {
    if (tab === "r")      return generateRScript(config);
    if (tab === "python") return generatePythonScript(config);
    if (tab === "stata")  return generateStataScript(config);
  } catch (e) {
    return `# Error generating script:\n# ${e.message}`;
  }
  return "# Unknown tab.";
}

// ─── MAIN EXPORT ─────────────────────────────────────────────────────────────
export default function CodeEditor({ result }) {
  const { C } = useTheme();
  const [open,    setOpen]    = useState(false);
  const [tab,     setTab]     = useState("r");
  const [code,    setCode]    = useState("");
  const [copied,  setCopied]  = useState(false);

  // Regenerate script whenever result or tab changes
  const regenerate = useCallback(() => {
    setCode(buildScript(tab, result));
  }, [tab, result]);

  useEffect(() => {
    regenerate();
    setCopied(false);
  }, [regenerate]);

  // Copy to clipboard
  const handleCopy = () => {
    navigator.clipboard.writeText(code).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    }).catch(() => {
      // Fallback for browsers without clipboard API
      try {
        const ta = document.createElement("textarea");
        ta.value = code;
        document.body.appendChild(ta);
        ta.select();
        document.execCommand("copy");
        document.body.removeChild(ta);
        setCopied(true);
        setTimeout(() => setCopied(false), 2000);
      } catch (_) {}
    });
  };

  // ── Container ──────────────────────────────────────────────────────────────
  return (
    <div style={{
      marginBottom: "1rem",
      border: `1px solid ${open ? C.border2 : C.border}`,
      borderRadius: 4,
      overflow: "hidden",
      transition: "border-color 0.15s",
    }}>

      {/* ── Header / toggle ── */}
      <button
        onClick={() => setOpen(o => !o)}
        style={{
          width: "100%",
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          padding: "0.45rem 0.75rem",
          background: open ? C.surface2 : C.surface,
          border: "none",
          cursor: "pointer",
          fontFamily: mono,
          transition: "background 0.12s",
        }}
      >
        <span style={{
          fontSize: 9,
          color: C.textMuted,
          letterSpacing: "0.22em",
          textTransform: "uppercase",
        }}>
          Replication Code
        </span>
        <span style={{ display: "flex", alignItems: "center", gap: 6 }}>
          {!open && (
            <span style={{
              fontSize: 9,
              padding: "1px 6px",
              border: `1px solid ${C.blue}`,
              color: C.blue,
              borderRadius: 2,
              letterSpacing: "0.08em",
              fontFamily: mono,
            }}>
              {tab.toUpperCase()}
            </span>
          )}
          <span style={{ fontSize: 10, color: C.textMuted }}>
            {open ? "▲" : "▼"}
          </span>
        </span>
      </button>

      {/* ── Expanded content ── */}
      {open && (
        <div style={{
          background: C.surface,
          borderTop: `1px solid ${C.border}`,
          padding: "0.75rem",
        }}>

          {/* Tab switcher + action buttons row */}
          <div style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            marginBottom: 8,
          }}>

            {/* Language tabs */}
            <div style={{ display: "flex", gap: 4 }}>
              {TABS.map(({ id, label }) => (
                <button
                  key={id}
                  onClick={() => setTab(id)}
                  style={{
                    padding: "2px 10px",
                    fontFamily: mono,
                    fontSize: 10,
                    letterSpacing: "0.1em",
                    border: `1px solid ${tab === id ? C.blue : C.border2}`,
                    borderRadius: 2,
                    background: tab === id ? `${C.blue}1a` : "transparent",
                    color: tab === id ? C.blue : C.textMuted,
                    cursor: "pointer",
                    transition: "all 0.12s",
                  }}
                >
                  {label}
                </button>
              ))}
            </div>

            {/* Copy / Reset */}
            <div style={{ display: "flex", gap: 6 }}>
              <button
                onClick={handleCopy}
                style={{
                  padding: "2px 10px",
                  fontFamily: mono,
                  fontSize: 10,
                  letterSpacing: "0.08em",
                  border: `1px solid ${copied ? C.teal : C.border2}`,
                  borderRadius: 2,
                  background: copied ? `${C.teal}1a` : "transparent",
                  color: copied ? C.teal : C.textMuted,
                  cursor: "pointer",
                  transition: "all 0.12s",
                }}
              >
                {copied ? "✓ Copied" : "Copy"}
              </button>
              <button
                onClick={regenerate}
                style={{
                  padding: "2px 10px",
                  fontFamily: mono,
                  fontSize: 10,
                  letterSpacing: "0.08em",
                  border: `1px solid ${C.border2}`,
                  borderRadius: 2,
                  background: "transparent",
                  color: C.textMuted,
                  cursor: "pointer",
                  transition: "all 0.12s",
                }}
              >
                Reset
              </button>
            </div>
          </div>

          {/* Code textarea */}
          <textarea
            value={code}
            onChange={e => setCode(e.target.value)}
            spellCheck={false}
            style={{
              width: "100%",
              minHeight: 280,
              background: C.surface2,
              border: `1px solid ${C.border}`,
              borderRadius: 3,
              color: C.text,
              fontFamily: mono,
              fontSize: 10.5,
              lineHeight: 1.55,
              padding: "0.6rem 0.75rem",
              resize: "vertical",
              outline: "none",
              boxSizing: "border-box",
              whiteSpace: "pre",
              overflowX: "auto",
              tabSize: 2,
            }}
          />

          {/* Hint */}
          <div style={{
            marginTop: 5,
            fontSize: 9,
            color: C.textMuted,
            fontFamily: mono,
            lineHeight: 1.5,
          }}>
            Script is editable — tweak then copy. Hit Reset to regenerate from current model.
          </div>
        </div>
      )}
    </div>
  );
}
