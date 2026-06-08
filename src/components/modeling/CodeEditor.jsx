// ─── ECON STUDIO · src/components/modeling/CodeEditor.jsx ────────────────────
// Collapsible inline replication script viewer/editor.
// Shows R, Python, or Stata replication code for the active model result.
// The textarea is editable; Copy replicates to clipboard; Reset regenerates.
//
// Props:
//   result  {object}  — active model result (same shape as other modeling components)

import { useState, useCallback, useMemo } from "react";
import { useTheme }                         from "./shared.jsx";
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
function buildScript(tab, result, allDatasets = {}) {
  if (!result) return "# No model estimated yet.";

  // Resolve spec — result may have it directly or nested (e.g. FE returns {type, fe, fd})
  const spec = result.spec ?? result.fe?.spec ?? result.fd?.spec ?? {};

  const config = {
    filename:      spec.filename      ?? "dataset.csv",
    pipeline:      spec.pipeline      ?? [],
    dataDictionary: spec.dataDictionary ?? null,
    auditTrail:    spec.auditTrail    ?? null,
    allDatasets,
    model: {
      type:       result.type ?? spec.type ?? "OLS",
      yVar:       spec.yVar       ?? "",
      xVars:      spec.xVars      ?? [],
      wVars:      spec.wVars      ?? [],
      zVars:      spec.zVars      ?? [],
      entityCol:  spec.entityCol  ?? null,
      timeCol:    spec.timeCol    ?? null,
      feCols:     spec.feCols     ?? null,
      cohortCol:  spec.cohortCol  ?? null,
      periodCol:  spec.periodCol  ?? null,
      controlMode: spec.controlMode ?? null,
      refPeriod:  spec.refPeriod  ?? null,
      postVar:    spec.postVar    ?? null,
      treatVar:   spec.treatVar   ?? null,
      runningVar: spec.runningVar ?? null,
      cutoff:     spec.cutoff     ?? null,
      bandwidth:  spec.bandwidth  ?? null,
      kernel:     spec.kernel     ?? "triangular",
    },
  };

  try {
    let script = "";
    if (tab === "r") script = generateRScript(config);
    else if (tab === "python") script = generatePythonScript(config);
    else if (tab === "stata") script = generateStataScript(config);
    else return "# Unknown tab.";

    return script;
  } catch (e) {
    return `# Error generating script:\n# ${e.message}`;
  }
}

// ─── MAIN EXPORT ─────────────────────────────────────────────────────────────
export default function CodeEditor({ result, allDatasets = {} }) {
  const { C, T } = useTheme();
  const [open,    setOpen]    = useState(false);
  const [tab,     setTab]     = useState("r");
  const [copied,  setCopied]  = useState(false);
  const [draft,   setDraft]   = useState({ key: "", value: "" });

  const generatedCode = useMemo(
    () => buildScript(tab, result, allDatasets),
    [tab, result, allDatasets]
  );
  const code = draft.key === generatedCode ? draft.value : generatedCode;
  const resetCode = useCallback(() => {
    setDraft({ key: "", value: "" });
    setCopied(false);
  }, []);

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
      } catch {
        setCopied(false);
      }
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
          fontFamily: T.code.fontFamily,
          transition: "background 0.12s",
        }}
      >
        <span style={{
          fontSize: T.caption.fontSize,
          color: C.textMuted,
          letterSpacing: "0.22em",
          textTransform: "uppercase",
        }}>
          Replication Code
        </span>
        <span style={{ display: "flex", alignItems: "center", gap: 6 }}>
          {!open && (
            <span style={{
              fontSize: T.caption.fontSize,
              padding: "1px 6px",
              border: `1px solid ${C.blue}`,
              color: C.blue,
              borderRadius: 2,
              letterSpacing: "0.08em",
              fontFamily: T.code.fontFamily,
            }}>
              {tab.toUpperCase()}
            </span>
          )}
          <span style={{ fontSize: T.caption.fontSize, color: C.textMuted }}>
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
                    fontFamily: T.code.fontFamily,
                    fontSize: T.caption.fontSize,
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
                  fontFamily: T.code.fontFamily,
                  fontSize: T.caption.fontSize,
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
                onClick={resetCode}
                style={{
                  padding: "2px 10px",
                  fontFamily: T.code.fontFamily,
                  fontSize: T.caption.fontSize,
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
            onChange={e => setDraft({ key: generatedCode, value: e.target.value })}
            spellCheck={false}
            style={{
              width: "100%",
              minHeight: 280,
              background: C.surface2,
              border: `1px solid ${C.border}`,
              borderRadius: 3,
              color: C.text,
              fontFamily: T.code.fontFamily,
              fontSize: T.caption.fontSize,
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
            fontSize: T.caption.fontSize,
            color: C.textMuted,
            fontFamily: T.code.fontFamily,
            lineHeight: 1.5,
          }}>
            Script is editable — tweak then copy. Hit Reset to regenerate from current model.
          </div>
        </div>
      )}
    </div>
  );
}
