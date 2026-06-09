// ─── ECON STUDIO · src/components/modeling/CoefficientTestPanel.jsx ───────────
// Post-estimation hypothesis test on a pinned model's coefficients (or treatment
// effect). Lets the user pick a pinned model + term, set a null value and
// alternative, and see the t/z statistic and p-value live. Mirrors the
// "Predict from Model" panel pattern. Optionally copies a reproducible R /
// Python / Stata test snippet.
//
// Props:
//   models  [{...}]  — pinned models (same shape used by Predict from Model)

import { useState, useMemo } from "react";
import { useTheme } from "./shared.jsx";
import {
  getModelTestTerms,
  coefficientHypothesisTest,
  waldTest,
  generateModelHypothesisScript,
} from "../../math/ModelHypothesis.js";

const LANGS = [["r", "R"], ["python", "Python"], ["stata", "Stata"]];

function fmt(n, d = 6) {
  return (typeof n === "number" && isFinite(n)) ? n.toFixed(d) : "—";
}

export default function CoefficientTestPanel({ models = [], liveResult = null }) {
  const { C, T } = useTheme();
  const [open, setOpen]       = useState(false);
  const [tab, setTab]         = useState("single"); // "single" | "joint"
  const [modelId, setModelId] = useState("");
  const [termId, setTermId]   = useState("");
  const [h0, setH0]           = useState("0");
  const [alt, setAlt]         = useState("two-sided");
  const [copied, setCopied]   = useState("");
  // Joint test state
  const [jointChecked, setJointChecked] = useState({}); // { [termId]: bool }
  const [jointH0s, setJointH0s]         = useState({}); // { [termId]: string }

  const field = { background: C.surface2, border: `1px solid ${C.border2}`, borderRadius: 3, color: C.text, fontFamily: T.code.fontFamily, fontSize: T.code.fontSize, padding: "0.28rem 0.55rem", outline: "none" };

  const model = models.find(m => m.id === modelId) ?? models[models.length - 1] ?? null;
  const terms = useMemo(() => getModelTestTerms(model), [model]);
  const effectiveTermId = terms.some(t => t.id === termId) ? termId : (terms[0]?.id ?? "");
  const term = terms.find(t => t.id === effectiveTermId) ?? null;

  const result = useMemo(
    () => term ? coefficientHypothesisTest(term, Number(h0), alt) : null,
    [term, h0, alt]
  );

  // Joint test — derived from liveResult (which has vcov).
  // Only coef:N terms map directly into vcov rows; effect:late/att are excluded.
  const liveTerms = useMemo(
    () => getModelTestTerms(liveResult).filter(t => t.id.startsWith("coef:")),
    [liveResult]
  );
  const hasVcov = Array.isArray(liveResult?.vcov) && liveResult.vcov.length > 0;
  const selectedJointTerms = liveTerms.filter(t => jointChecked[t.id]);
  const jointResult = useMemo(() => {
    if (!hasVcov || selectedJointTerms.length < 1) return null;
    const { beta, vcov } = liveResult;
    // Parse the original beta index from "coef:N"
    const indices = selectedJointTerms.map(t => parseInt(t.id.slice(5), 10));
    const h0sArr = selectedJointTerms.map(t => Number(jointH0s[t.id] ?? 0));
    return waldTest(beta, vcov, indices, h0sArr);
  }, [hasVcov, liveResult, selectedJointTerms, jointH0s]);

  function copyScript(lang) {
    if (!term || !model || result?.error) return;
    const spec = model.spec ?? model.fe?.spec ?? model.fd?.spec ?? {};
    const snippet = generateModelHypothesisScript(lang, result, {
      modelLabel: model.label ?? model.type ?? "model",
      modelType:  model.type ?? spec.type ?? "OLS",
      spec,
      term,
      termLabel: term.label,
    });
    navigator.clipboard?.writeText(snippet.trimStart()).then(() => {
      setCopied(lang);
      setTimeout(() => setCopied(""), 2000);
    }).catch(() => {});
  }

  const tabBtn = (id, label) => (
    <button onClick={() => setTab(id)}
      style={{ padding: "2px 12px", fontFamily: T.code.fontFamily, fontSize: T.caption.fontSize, letterSpacing: "0.1em", textTransform: "uppercase", border: `1px solid ${tab === id ? C.teal : C.border2}`, borderRadius: 2, background: tab === id ? `${C.teal}18` : "transparent", color: tab === id ? C.teal : C.textMuted, cursor: "pointer" }}>
      {label}
    </button>
  );

  return (
    <div style={{ border: `1px solid ${C.border}`, borderRadius: 4, overflow: "hidden", marginBottom: "1.4rem" }}>
      <div onClick={() => setOpen(o => !o)}
        style={{ background: C.surface2, padding: "0.55rem 0.85rem", borderBottom: open ? `1px solid ${C.border}` : "none", cursor: "pointer", display: "flex", alignItems: "center", gap: 8 }}>
        <span style={{ fontSize: T.caption.fontSize, color: C.textMuted }}>{open ? "▾" : "▸"}</span>
        <span style={{ fontSize: T.caption.fontSize, color: C.textDim, letterSpacing: "0.2em", textTransform: "uppercase", fontFamily: T.code.fontFamily }}>Coefficient Test</span>
        <span style={{ marginLeft: "auto", fontSize: T.caption.fontSize, color: C.textMuted }}>{models.length} pinned</span>
      </div>

      {open && (
        <div style={{ padding: "0.85rem", background: C.surface, display: "flex", flexDirection: "column", gap: 10 }}>
          {/* Tab switcher */}
          <div style={{ display: "flex", gap: 6 }}>
            {tabBtn("single", "Single")}
            {tabBtn("joint", "Joint")}
          </div>

          {/* ── Single-coefficient tab ── */}
          {tab === "single" && <>
            <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
              <span style={{ fontSize: T.caption.fontSize, color: C.textMuted, fontFamily: T.code.fontFamily, letterSpacing: "0.14em", textTransform: "uppercase" }}>Model</span>
              <select value={model?.id ?? ""} onChange={e => { setModelId(e.target.value); setTermId(""); }} style={field}>
                {models.map(m => <option key={m.id} value={m.id}>{m.label ?? m.estimator ?? m.type ?? m.id}</option>)}
              </select>
              <span style={{ fontSize: T.caption.fontSize, color: C.textMuted, fontFamily: T.code.fontFamily, letterSpacing: "0.14em", textTransform: "uppercase" }}>Term</span>
              <select value={effectiveTermId} onChange={e => setTermId(e.target.value)} style={{ ...field, minWidth: 160, maxWidth: 260 }} disabled={!terms.length}>
                {!terms.length && <option value="">— no testable terms —</option>}
                {terms.map(t => <option key={t.id} value={t.id}>{t.label}</option>)}
              </select>
            </div>

            <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
              <label style={{ display: "flex", alignItems: "center", gap: 5, fontFamily: T.code.fontFamily, fontSize: T.caption.fontSize, color: C.textMuted }}>
                H₀: β =
                <input type="number" step="any" value={h0} onChange={e => setH0(e.target.value)} style={{ ...field, width: 90 }} />
              </label>
              <select value={alt} onChange={e => setAlt(e.target.value)} style={field}>
                <option value="two-sided">two-sided</option>
                <option value="greater">greater</option>
                <option value="less">less</option>
              </select>
            </div>

            {result?.error && (
              <div style={{ fontFamily: T.code.fontFamily, fontSize: T.caption.fontSize, color: C.red }}>{result.error}</div>
            )}

            {result && !result.error && (
              <div style={{ background: `${C.gold}0a`, border: `1px solid ${C.gold}30`, borderRadius: 3, padding: "0.65rem 0.9rem", fontFamily: T.code.fontFamily, fontSize: T.code.fontSize, color: C.text, lineHeight: 1.9 }}>
                <div><span style={{ color: C.textMuted }}>β̂ = </span><span style={{ color: C.teal }}>{fmt(result.estimate, 4)}</span>
                  <span style={{ color: C.textMuted }}>  ·  SE = </span>{fmt(result.se, 4)}
                  <span style={{ color: C.textMuted }}>  ·  H₀ = </span>{fmt(result.nullValue, 4)}</div>
                <div>
                  <span style={{ color: C.textMuted }}>{result.statLabel} = </span>
                  <span style={{ color: C.gold, fontSize: T.body.fontSize }}>{fmt(result.stat, 4)}</span>
                  {result.df != null && <><span style={{ color: C.textMuted }}>  ·  df = </span>{result.df}</>}
                  <span style={{ color: C.textMuted }}>  ·  p = </span>
                  <span style={{ color: result.pValue < 0.05 ? C.teal : C.text }}>{result.pValue < 1e-4 ? "<0.0001" : fmt(result.pValue, 4)}</span>
                </div>
              </div>
            )}

            {result && !result.error && (
              <div style={{ display: "flex", gap: 6, alignItems: "center" }}>
                <span style={{ fontSize: T.caption.fontSize, color: C.textMuted, fontFamily: T.code.fontFamily }}>copy test code</span>
                {LANGS.map(([id, label]) => (
                  <button key={id} onClick={() => copyScript(id)}
                    style={{ padding: "2px 10px", fontFamily: T.code.fontFamily, fontSize: T.caption.fontSize, letterSpacing: "0.08em", border: `1px solid ${copied === id ? C.teal : C.border2}`, borderRadius: 2, background: copied === id ? `${C.teal}1a` : "transparent", color: copied === id ? C.teal : C.textMuted, cursor: "pointer" }}>
                    {copied === id ? "✓" : label}
                  </button>
                ))}
              </div>
            )}
          </>}

          {/* ── Joint Wald test tab ── */}
          {tab === "joint" && <>
            {!liveResult && (
              <div style={{ fontFamily: T.code.fontFamily, fontSize: T.caption.fontSize, color: C.textMuted }}>Run a model first — joint test requires the active result.</div>
            )}
            {liveResult && !hasVcov && (
              <div style={{ fontFamily: T.code.fontFamily, fontSize: T.caption.fontSize, color: C.textMuted }}>Variance-covariance matrix not available for this estimator.</div>
            )}
            {liveResult && hasVcov && liveTerms.length === 0 && (
              <div style={{ fontFamily: T.code.fontFamily, fontSize: T.caption.fontSize, color: C.textMuted }}>No testable terms in the active result.</div>
            )}
            {liveResult && hasVcov && liveTerms.length > 0 && (
              <>
                <div style={{ fontSize: T.caption.fontSize, color: C.textMuted, fontFamily: T.code.fontFamily }}>Select coefficients to test jointly (H₀: all selected = 0, or set custom nulls).</div>
                <div style={{ display: "flex", flexDirection: "column", gap: 5 }}>
                  {liveTerms.map(t => (
                    <div key={t.id} style={{ display: "flex", alignItems: "center", gap: 8 }}>
                      <input type="checkbox" id={`jt_${t.id}`} checked={!!jointChecked[t.id]}
                        onChange={e => setJointChecked(prev => ({ ...prev, [t.id]: e.target.checked }))}
                        style={{ accentColor: C.teal, cursor: "pointer" }} />
                      <label htmlFor={`jt_${t.id}`} style={{ fontFamily: T.code.fontFamily, fontSize: T.code.fontSize, color: C.text, cursor: "pointer", flex: 1 }}>{t.label}</label>
                      {jointChecked[t.id] && (
                        <label style={{ display: "flex", alignItems: "center", gap: 4, fontFamily: T.code.fontFamily, fontSize: T.caption.fontSize, color: C.textMuted }}>
                          H₀ =
                          <input type="number" step="any" value={jointH0s[t.id] ?? "0"}
                            onChange={e => setJointH0s(prev => ({ ...prev, [t.id]: e.target.value }))}
                            style={{ ...field, width: 72, padding: "0.18rem 0.45rem" }} />
                        </label>
                      )}
                    </div>
                  ))}
                </div>

                {selectedJointTerms.length < 1 && (
                  <div style={{ fontFamily: T.code.fontFamily, fontSize: T.caption.fontSize, color: C.textMuted }}>Check at least one coefficient above.</div>
                )}

                {jointResult?.error && (
                  <div style={{ fontFamily: T.code.fontFamily, fontSize: T.caption.fontSize, color: C.red }}>{jointResult.error}</div>
                )}

                {jointResult && !jointResult.error && (
                  <div style={{ background: `${C.gold}0a`, border: `1px solid ${C.gold}30`, borderRadius: 3, padding: "0.65rem 0.9rem", fontFamily: T.code.fontFamily, fontSize: T.code.fontSize, color: C.text, lineHeight: 1.9 }}>
                    <div>
                      <span style={{ color: C.textMuted }}>χ²({jointResult.df}) = </span>
                      <span style={{ color: C.gold, fontSize: T.body.fontSize }}>{fmt(jointResult.chiSq, 4)}</span>
                      <span style={{ color: C.textMuted }}>  ·  p = </span>
                      <span style={{ color: jointResult.chiSqPval < 0.05 ? C.teal : C.text }}>
                        {jointResult.chiSqPval < 1e-4 ? "<0.0001" : fmt(jointResult.chiSqPval, 4)}
                      </span>
                    </div>
                    <div style={{ fontSize: T.caption.fontSize, color: C.textMuted }}>
                      {jointResult.chiSqPval < 0.05
                        ? "Reject H₀ — coefficients are jointly significant."
                        : "Fail to reject H₀ — no joint significance detected."}
                    </div>
                  </div>
                )}
              </>
            )}
          </>}
        </div>
      )}
    </div>
  );
}
