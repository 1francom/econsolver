// ─── ECON STUDIO · src/components/tabs/statsim/SampleTestPanel.jsx ────────────
// Collapsible pre-model hypothesis-test panel. Lets the user test the mean or
// variance of a numeric column, or test an arbitrary parameter from a point
// estimate + SE. Shared by the Stat (loaded data) and Simulate (simulated data)
// tabs. Math lives in src/math/SampleTests.js — this file is UI only.
//
// Props:
//   columns    [{ name, values:number[] }]  — numeric columns available to test
//   rows       object[] | null               — raw rows; supplying them unlocks
//              LONG-format input (one outcome column split by a group column),
//              i.e. R's `t.test(y ~ treat)`. Without it the panel behaves as
//              before and only offers the two-column form, so existing callers
//              need no change.
//   headers    string[]                      — every column, for the group picker
//   title      string                        — section header label
//   defaultOpen bool

import { useState, useMemo, useEffect } from "react";
import { useTheme } from "../../../ThemeContext.jsx";
import {
  oneSampleMeanTest, varianceTest, parameterTest,
  twoSampleMeanTest, pairedMeanTest, onePropTest, twoPropTest, correlationTest, varianceRatioTest,
  splitByGroup, groupLevels, countsByGroup,
} from "../../../math/SampleTests.js";
import { sortFactorLevels } from "../../modeling/helpers.js";
import { generateStatInferenceScript } from "../../../services/export/statInferenceScript.js";

const LANGS = [["r", "R"], ["python", "Python"], ["stata", "Stata"]];

function fmt(n, d = 6) {
  return (typeof n === "number" && isFinite(n)) ? n.toFixed(d) : "—";
}

const STAT_GLYPH = { t: "t", z: "z", chi2: "χ²", F: "F" };
const H0_LABEL = {
  mean: "H₀: μ =", variance: "H₀: σ² =", parameter: "H₀: θ =",
  "two-mean": "H₀: μₐ − μ_b =", paired: "H₀: μ_d =",
  "one-prop": "H₀: p =", "two-prop": "H₀: p₁ − p₂ =",
  correlation: "H₀: ρ =", "var-ratio": "H₀: σ²ₐ/σ²_b =",
};

export default function SampleTestPanel({ columns = [], rows = null, headers = [], title = "Hypothesis Test", defaultOpen = false }) {
  const { C, T } = useTheme();
  const [open, setOpen]   = useState(defaultOpen);
  const [mode, setMode]   = useState("mean");        // mean | variance | parameter
  const [colName, setCol] = useState("");
  const [h0, setH0]       = useState("0");
  const [alt, setAlt]     = useState("two-sided");
  const [estimate, setEstimate] = useState("");
  const [se, setSe]       = useState("");
  const [df, setDf]       = useState("");
  const [colNameB, setColB] = useState("");   // second variable (two-col modes)
  // Long-format input: one outcome column split by two levels of a group column.
  const [inputMode, setInputMode] = useState("cols");  // "cols" | "group"
  const [groupCol, setGroupCol]   = useState("");
  const [levelA, setLevelA]       = useState("");
  const [levelB, setLevelB]       = useState("");
  const [pooled, setPooled] = useState(false); // two-mean: pooled vs Welch
  const [corrMethod, setCorrMethod] = useState("pearson");
  // proportion-count inputs
  const [succ, setSucc] = useState("");
  const [nObs, setNObs] = useState("");
  const [s1, setS1] = useState(""); const [n1, setN1] = useState("");
  const [s2, setS2] = useState(""); const [n2, setN2] = useState("");
  const [copied, setCopied] = useState("");

  const field = { background: C.surface2, border: `1px solid ${C.border2}`, borderRadius: 3, color: C.text, fontFamily: T.code.fontFamily, fontSize: T.code.fontSize, padding: "0.28rem 0.55rem", outline: "none" };

  const effectiveCol = columns.some(c => c.name === colName) ? colName : (columns[0]?.name ?? "");
  const selCol = columns.find(c => c.name === effectiveCol) ?? null;
  const TWO_COL = mode === "two-mean" || mode === "paired" || mode === "correlation" || mode === "var-ratio";
  const effectiveColB = columns.some(c => c.name === colNameB) ? colNameB : (columns[1]?.name ?? columns[0]?.name ?? "");
  const selColB = columns.find(c => c.name === effectiveColB) ?? null;

  // Long-format input is offered only for tests of INDEPENDENT samples.
  // `paired` and `correlation` pair observations row by row, so two arrays built
  // from different group memberships have no correspondence at all — pairing
  // them by index would produce a plausible number with no meaning.
  const GROUP_OK  = rows != null && (mode === "two-mean" || mode === "var-ratio" || mode === "two-prop");
  const byGroup   = GROUP_OK && inputMode === "group";
  const levels    = useMemo(
    () => (byGroup && groupCol ? sortFactorLevels(groupLevels(rows, groupCol)) : []),
    [byGroup, rows, groupCol]
  );
  // Two levels is the common case (treated/control) — pick them so the panel
  // shows a result immediately instead of an empty form.
  useEffect(() => {
    if (!levels.length) return;
    if (!levels.includes(levelA)) setLevelA(levels[0] ?? "");
    if (!levels.includes(levelB)) setLevelB(levels[1] ?? levels[0] ?? "");
  }, [levels]); // eslint-disable-line react-hooks/exhaustive-deps

  function switchMode(next) {
    setMode(next);
    // Sensible default null for a variance test (σ² must be > 0).
    if (next === "variance" && (h0 === "0" || h0 === "")) setH0("1");
    if (next !== "variance" && h0 === "1") setH0("0");
  }

  const result = useMemo(() => {
    if (mode === "parameter") {
      if (estimate === "" || se === "") return null;
      return parameterTest(estimate, se, h0, alt, df === "" ? null : df);
    }
    if (mode === "one-prop") {
      if (succ === "" || nObs === "") return null;
      return onePropTest(Number(succ), Number(nObs), { p0: Number(h0), alternative: alt });
    }
    // Long-format: build the two samples from one column split by group.
    if (byGroup) {
      if (!selCol || !groupCol || levelA === "" || levelB === "") return null;
      if (String(levelA) === String(levelB)) return { error: "Pick two different group levels." };
      if (mode === "two-prop") {
        const c = countsByGroup(rows, selCol.name, groupCol, levelA, levelB);
        if (c.error) return c;
        return twoPropTest(c.s1, c.n1, c.s2, c.n2, { alternative: alt });
      }
      const { a, b } = splitByGroup(rows, selCol.name, groupCol, levelA, levelB);
      if (mode === "two-mean") return twoSampleMeanTest(a, b, { alternative: alt, pooled, mu0: h0 });
      return varianceRatioTest(a, b, { alternative: alt });
    }
    if (mode === "two-prop") {
      if (s1 === "" || n1 === "" || s2 === "" || n2 === "") return null;
      return twoPropTest(Number(s1), Number(n1), Number(s2), Number(n2), { alternative: alt });
    }
    if (TWO_COL) {
      if (!selCol || !selColB) return null;
      if (mode === "two-mean") return twoSampleMeanTest(selCol.values, selColB.values, { alternative: alt, pooled, mu0: h0 });
      if (mode === "paired")   return pairedMeanTest(selCol.values, selColB.values, { alternative: alt, mu0: h0 });
      if (mode === "correlation") return correlationTest(selCol.values, selColB.values, { method: corrMethod, alternative: alt });
      if (mode === "var-ratio")   return varianceRatioTest(selCol.values, selColB.values, { alternative: alt });
    }
    if (!selCol) return null;
    if (mode === "mean") return oneSampleMeanTest(selCol.values, h0, alt);
    return varianceTest(selCol.values, h0, alt);
  }, [mode, selCol, selColB, h0, alt, estimate, se, df, pooled, corrMethod, succ, nObs, s1, n1, s2, n2, TWO_COL, byGroup, rows, groupCol, levelA, levelB]);

  function copyScript(lang) {
    if (!result || result.error || mode === "parameter") return;
    const op = {
      mean: "oneSampleMeanTest", variance: "varianceTest", "two-mean": "twoSampleMeanTest",
      paired: "pairedMeanTest", "one-prop": "onePropTest", "two-prop": "twoPropTest",
      correlation: "correlationTest", "var-ratio": "varianceRatioTest",
    }[mode];
    const params = {
      values: selCol?.values, a: selCol?.values, b: selColB?.values,
      // In group mode the snippet references the columns instead of inlining
      // every observation, so it needs the names, not the values.
      group: byGroup && selCol && groupCol
        ? { valueCol: selCol.name, groupCol, levelA, levelB }
        : undefined,
      // A real dataset behind the panel (Explore) means the script can name the
      // columns. Simulate passes no rows, so it keeps the literal-vector form —
      // its data exists nowhere else.
      dataset: rows && selCol ? { colA: selCol.name, colB: selColB?.name } : undefined,
      mu0: Number(h0), nullValue: Number(h0), alternative: alt, pooled, method: corrMethod,
      successes: Number(succ), n: Number(nObs), p0: Number(h0),
      s1: Number(s1), n1: Number(n1), s2: Number(s2), n2: Number(n2),
    };
    const snippet = generateStatInferenceScript(lang, op, params, result);
    navigator.clipboard?.writeText(snippet.trimStart()).then(() => {
      setCopied(lang);
      setTimeout(() => setCopied(""), 2000);
    }).catch(() => {});
  }

  const modeBtn = (id, label) => (
    <button key={id} onClick={() => switchMode(id)}
      style={{
        background: mode === id ? `${C.gold}18` : "transparent",
        border: `1px solid ${mode === id ? C.gold : C.border2}`,
        color: mode === id ? C.gold : C.textDim,
        fontFamily: T.code.fontFamily, fontSize: T.caption.fontSize, letterSpacing: "0.08em",
        padding: "0.3rem 0.7rem", borderRadius: 2, cursor: "pointer",
      }}>{label}</button>
  );

  const noData = mode !== "parameter" && columns.length === 0;

  return (
    <div style={{ border: `1px solid ${C.border}`, borderRadius: 4, overflow: "hidden", marginBottom: "1.4rem" }}>
      <div onClick={() => setOpen(o => !o)}
        style={{ background: C.surface2, padding: "0.55rem 0.85rem", borderBottom: open ? `1px solid ${C.border}` : "none", cursor: "pointer", display: "flex", alignItems: "center", gap: 8 }}>
        <span style={{ fontSize: T.caption.fontSize, color: C.textMuted }}>{open ? "▾" : "▸"}</span>
        <span style={{ fontSize: T.caption.fontSize, color: C.textDim, letterSpacing: "0.2em", textTransform: "uppercase", fontFamily: T.code.fontFamily }}>{title}</span>
        {noData && <span style={{ marginLeft: "auto", fontSize: T.caption.fontSize, color: C.textMuted }}>no numeric data</span>}
      </div>

      {open && (
        <div style={{ padding: "0.8rem 0.85rem", background: C.surface, display: "flex", flexDirection: "column", gap: 10 }}>
          <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
            {modeBtn("mean", "Mean (one-sample t)")}
            {modeBtn("variance", "Variance (χ²)")}
            {modeBtn("parameter", "Parameter (estimate + SE)")}
            {modeBtn("two-mean", "Two-sample (t)")}
            {modeBtn("paired", "Paired (t)")}
            {modeBtn("correlation", "Correlation")}
            {modeBtn("var-ratio", "Variance ratio (F)")}
            {modeBtn("one-prop", "One proportion (z)")}
            {modeBtn("two-prop", "Two proportions (z)")}
          </div>

          {/* Input shape, for the independent-sample tests only. Long format is
              R's `t.test(y ~ treat)`: one outcome column split by a group
              column, which is how econometric data is actually shaped. */}
          {GROUP_OK && (
            <div style={{ display: "flex", gap: 6, alignItems: "center", flexWrap: "wrap" }}>
              <span style={{ fontFamily: T.code.fontFamily, fontSize: T.caption.fontSize, color: C.textMuted }}>input</span>
              {[["cols", "two columns"], ["group", "split by group"]].map(([id, label]) => (
                <button key={id} onClick={() => setInputMode(id)}
                  style={{
                    background: inputMode === id ? `${C.teal}18` : "transparent",
                    border: `1px solid ${inputMode === id ? C.teal : C.border2}`,
                    color: inputMode === id ? C.teal : C.textDim,
                    fontFamily: T.code.fontFamily, fontSize: T.caption.fontSize,
                    padding: "0.22rem 0.6rem", borderRadius: 2, cursor: "pointer",
                  }}>{label}</button>
              ))}
            </div>
          )}

          {/* Group column + the two levels being contrasted */}
          {byGroup && (
            <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center" }}>
              <span style={{ fontFamily: T.code.fontFamily, fontSize: T.caption.fontSize, color: C.textMuted }}>split by</span>
              <select value={groupCol} onChange={e => setGroupCol(e.target.value)} style={{ ...field, maxWidth: 200 }}>
                <option value="">— pick a column —</option>
                {headers.filter(h => !h.startsWith("__")).map(h => <option key={h} value={h}>{h}</option>)}
              </select>
              {groupCol && levels.length > 0 && (
                <>
                  <select value={levelA} onChange={e => setLevelA(e.target.value)} style={{ ...field, maxWidth: 150 }}>
                    {levels.map(v => <option key={String(v)} value={String(v)}>{String(v)}</option>)}
                  </select>
                  <span style={{ fontFamily: T.code.fontFamily, fontSize: T.caption.fontSize, color: C.textMuted }}>vs</span>
                  <select value={levelB} onChange={e => setLevelB(e.target.value)} style={{ ...field, maxWidth: 150 }}>
                    {levels.map(v => <option key={String(v)} value={String(v)}>{String(v)}</option>)}
                  </select>
                </>
              )}
              {groupCol && levels.length === 0 && (
                <span style={{ fontFamily: T.code.fontFamily, fontSize: T.caption.fontSize, color: C.textMuted }}>no non-null values in this column</span>
              )}
            </div>
          )}

          {/* Mean / Variance / variable A: pick a column */}
          {(byGroup || (mode !== "parameter" && mode !== "one-prop" && mode !== "two-prop")) && (
            <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center" }}>
              <span style={{ fontFamily: T.code.fontFamily, fontSize: T.caption.fontSize, color: C.textMuted }}>{byGroup ? (mode === "two-prop" ? "binary outcome" : "outcome") : (TWO_COL ? "variable A" : "variable")}</span>
              <select value={effectiveCol} onChange={e => setCol(e.target.value)} style={{ ...field, maxWidth: 240 }} disabled={!columns.length}>
                {!columns.length && <option value="">— no numeric column —</option>}
                {columns.map(c => <option key={c.name} value={c.name}>{c.name}</option>)}
              </select>
            </div>
          )}

          {/* Parameter: estimate / SE / df */}
          {mode === "parameter" && (
            <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center" }}>
              <label style={{ display: "flex", alignItems: "center", gap: 5, fontFamily: T.code.fontFamily, fontSize: T.caption.fontSize, color: C.textMuted }}>
                estimate
                <input type="number" step="any" value={estimate} onChange={e => setEstimate(e.target.value)} style={{ ...field, width: 100 }} />
              </label>
              <label style={{ display: "flex", alignItems: "center", gap: 5, fontFamily: T.code.fontFamily, fontSize: T.caption.fontSize, color: C.textMuted }}>
                SE
                <input type="number" step="any" value={se} onChange={e => setSe(e.target.value)} style={{ ...field, width: 90 }} />
              </label>
              <label style={{ display: "flex", alignItems: "center", gap: 5, fontFamily: T.code.fontFamily, fontSize: T.caption.fontSize, color: C.textMuted }}>
                df (blank = z)
                <input type="number" step="any" value={df} onChange={e => setDf(e.target.value)} style={{ ...field, width: 90 }} />
              </label>
            </div>
          )}

          {/* Second variable for two-column modes */}
          {TWO_COL && !byGroup && (
            <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center" }}>
              <span style={{ fontFamily: T.code.fontFamily, fontSize: T.caption.fontSize, color: C.textMuted }}>variable B</span>
              <select value={effectiveColB} onChange={e => setColB(e.target.value)} style={{ ...field, maxWidth: 240 }} disabled={!columns.length}>
                {!columns.length && <option value="">— no numeric column —</option>}
                {columns.map(c => <option key={c.name} value={c.name}>{c.name}</option>)}
              </select>
              {mode === "two-mean" && (
                <label style={{ display: "flex", alignItems: "center", gap: 5, fontFamily: T.code.fontFamily, fontSize: T.caption.fontSize, color: C.textMuted }}>
                  <input type="checkbox" checked={pooled} onChange={e => setPooled(e.target.checked)} /> pooled (equal var)
                </label>
              )}
              {mode === "correlation" && (
                <select value={corrMethod} onChange={e => setCorrMethod(e.target.value)} style={field}>
                  <option value="pearson">Pearson</option>
                  <option value="spearman">Spearman</option>
                </select>
              )}
            </div>
          )}

          {/* One-proportion counts */}
          {mode === "one-prop" && (
            <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center" }}>
              <label style={{ display: "flex", alignItems: "center", gap: 5, fontFamily: T.code.fontFamily, fontSize: T.caption.fontSize, color: C.textMuted }}>
                successes <input type="number" step="1" value={succ} onChange={e => setSucc(e.target.value)} style={{ ...field, width: 90 }} />
              </label>
              <label style={{ display: "flex", alignItems: "center", gap: 5, fontFamily: T.code.fontFamily, fontSize: T.caption.fontSize, color: C.textMuted }}>
                n <input type="number" step="1" value={nObs} onChange={e => setNObs(e.target.value)} style={{ ...field, width: 90 }} />
              </label>
            </div>
          )}

          {/* Two-proportion counts */}
          {mode === "two-prop" && !byGroup && (
            <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center" }}>
              <label style={{ display: "flex", alignItems: "center", gap: 5, fontFamily: T.code.fontFamily, fontSize: T.caption.fontSize, color: C.textMuted }}>
                s₁ <input type="number" step="1" value={s1} onChange={e => setS1(e.target.value)} style={{ ...field, width: 70 }} />
              </label>
              <label style={{ display: "flex", alignItems: "center", gap: 5, fontFamily: T.code.fontFamily, fontSize: T.caption.fontSize, color: C.textMuted }}>
                n₁ <input type="number" step="1" value={n1} onChange={e => setN1(e.target.value)} style={{ ...field, width: 70 }} />
              </label>
              <label style={{ display: "flex", alignItems: "center", gap: 5, fontFamily: T.code.fontFamily, fontSize: T.caption.fontSize, color: C.textMuted }}>
                s₂ <input type="number" step="1" value={s2} onChange={e => setS2(e.target.value)} style={{ ...field, width: 70 }} />
              </label>
              <label style={{ display: "flex", alignItems: "center", gap: 5, fontFamily: T.code.fontFamily, fontSize: T.caption.fontSize, color: C.textMuted }}>
                n₂ <input type="number" step="1" value={n2} onChange={e => setN2(e.target.value)} style={{ ...field, width: 70 }} />
              </label>
            </div>
          )}

          {/* Null value + alternative — H₀ value is fixed (0 or 1) for correlation/two-prop/var-ratio */}
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center" }}>
            {mode !== "correlation" && mode !== "two-prop" && mode !== "var-ratio" && (
              <label style={{ display: "flex", alignItems: "center", gap: 5, fontFamily: T.code.fontFamily, fontSize: T.caption.fontSize, color: C.textMuted }}>
                {H0_LABEL[mode]}
                <input type="number" step="any" value={h0} onChange={e => setH0(e.target.value)} style={{ ...field, width: 90 }} />
              </label>
            )}
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
              {result.test === "mean" && (
                <div><span style={{ color: C.textMuted }}>x̄ = </span><span style={{ color: C.teal }}>{fmt(result.estimate, 4)}</span>
                  <span style={{ color: C.textMuted }}>  ·  sd = </span>{fmt(result.sd, 4)}
                  <span style={{ color: C.textMuted }}>  ·  SE = </span>{fmt(result.se, 4)}
                  <span style={{ color: C.textMuted }}>  ·  n = </span>{result.n}</div>
              )}
              {result.test === "variance" && (
                <div><span style={{ color: C.textMuted }}>s² = </span><span style={{ color: C.teal }}>{fmt(result.estimate, 4)}</span>
                  <span style={{ color: C.textMuted }}>  ·  sd = </span>{fmt(result.sd, 4)}
                  <span style={{ color: C.textMuted }}>  ·  n = </span>{result.n}</div>
              )}
              {result.test === "parameter" && (
                <div><span style={{ color: C.textMuted }}>θ̂ = </span><span style={{ color: C.teal }}>{fmt(result.estimate, 4)}</span>
                  <span style={{ color: C.textMuted }}>  ·  SE = </span>{fmt(result.se, 4)}</div>
              )}
              {result.test === "two-mean" && (
                <div><span style={{ color: C.textMuted }}>x̄ₐ − x̄_b = </span><span style={{ color: C.teal }}>{fmt(result.estimate, 4)}</span>
                  <span style={{ color: C.textMuted }}>  ·  SE = </span>{fmt(result.se, 4)}
                  <span style={{ color: C.textMuted }}>  ·  nₐ = </span>{result.nA}
                  <span style={{ color: C.textMuted }}>  ·  n_b = </span>{result.nB}
                  <span style={{ color: C.textMuted }}>  ·  </span>{result.pooled ? "pooled" : "Welch"}</div>
              )}
              {result.test === "paired" && (
                <div><span style={{ color: C.textMuted }}>d̄ = </span><span style={{ color: C.teal }}>{fmt(result.estimate, 4)}</span>
                  <span style={{ color: C.textMuted }}>  ·  SE = </span>{fmt(result.se, 4)}
                  <span style={{ color: C.textMuted }}>  ·  n = </span>{result.n}</div>
              )}
              {result.test === "one-prop" && (
                <div><span style={{ color: C.textMuted }}>p̂ = </span><span style={{ color: C.teal }}>{fmt(result.phat, 4)}</span>
                  <span style={{ color: C.textMuted }}>  ·  SE = </span>{fmt(result.se, 4)}
                  <span style={{ color: C.textMuted }}>  ·  n = </span>{result.n}</div>
              )}
              {result.test === "two-prop" && (
                <div><span style={{ color: C.textMuted }}>p̂₁ − p̂₂ = </span><span style={{ color: C.teal }}>{fmt(result.estimate, 4)}</span>
                  <span style={{ color: C.textMuted }}>  ·  p̂₁ = </span>{fmt(result.phat1, 4)}
                  <span style={{ color: C.textMuted }}>  ·  p̂₂ = </span>{fmt(result.phat2, 4)}
                  <span style={{ color: C.textMuted }}>  ·  SE = </span>{fmt(result.se, 4)}</div>
              )}
              {result.test === "correlation" && (
                <div><span style={{ color: C.textMuted }}>{result.method === "spearman" ? "ρ_s" : "r"} = </span><span style={{ color: C.teal }}>{fmt(result.estimate, 4)}</span>
                  <span style={{ color: C.textMuted }}>  ·  n = </span>{result.n}
                  <span style={{ color: C.textMuted }}>  ·  {result.method}</span></div>
              )}
              {result.test === "var-ratio" && (
                <div><span style={{ color: C.textMuted }}>s²ₐ/s²_b = </span><span style={{ color: C.teal }}>{fmt(result.estimate, 4)}</span>
                  <span style={{ color: C.textMuted }}>  ·  nₐ = </span>{result.nA}
                  <span style={{ color: C.textMuted }}>  ·  n_b = </span>{result.nB}</div>
              )}
              <div>
                <span style={{ color: C.textMuted }}>{STAT_GLYPH[result.statLabel] ?? result.statLabel} = </span>
                <span style={{ color: C.gold, fontSize: T.body.fontSize }}>{fmt(result.stat, 4)}</span>
                {result.df != null && <><span style={{ color: C.textMuted }}>  ·  df = </span>{result.df}</>}
                <span style={{ color: C.textMuted }}>  ·  p = </span>
                <span style={{ color: result.pValue < 0.05 ? C.teal : C.text }}>{result.pValue < 1e-4 ? "<0.0001" : fmt(result.pValue, 4)}</span>
              </div>
            </div>
          )}

          {result && !result.error && mode !== "parameter" && (
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
        </div>
      )}
    </div>
  );
}
