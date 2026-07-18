// ─── ECON STUDIO · src/components/modeling/BaconPanel.jsx ─────────────────────
// Goodman-Bacon (2021) decomposition of a TWFE DiD estimate. Collapsible panel
// mounted under the DiD/TWFE result, following the CoefficientTestPanel shell.
//
// Why a panel and not an estimator: the decomposition does not estimate anything
// new — it explains the number the user already got, by splitting it into the
// 2x2 DiDs it is a weighted average of. It therefore takes the same inputs as
// the TWFE spec that produced the result.
//
// The weight-vs-estimate scatter lives here rather than in ModelPlots.jsx: it is
// specific to this diagnostic and used nowhere else, and ModelPlots.jsx is
// already ~2400 lines (CLAUDE.md: small focused files over monoliths).
//
// Props:
//   rows      object[] — the estimation sample
//   yCol      string   — outcome
//   unitCol   string   — panel unit
//   timeCol   string   — panel time
//   treatCol  string   — binary absorbing treatment
//   betaTWFE  number   — the coefficient this decomposition must reproduce

import { useState, useMemo } from "react";
import { useTheme } from "./shared.jsx";
import { runBaconDecomposition, checkBaconIdentity, BACON_TYPES } from "../../math/did/baconDecomp.js";

const fmt = (n, d = 4) => (typeof n === "number" && isFinite(n)) ? n.toFixed(d) : "—";

// Replication snippets. The panel reports a number the user cannot otherwise
// reproduce, so it carries its own — same pattern as CoefficientTestPanel.
function baconScript(lang, { yCol, unitCol, timeCol, treatCol }) {
  if (lang === "r") {
    return [
      `# Goodman-Bacon decomposition — install.packages("bacondecomp")`,
      `library(bacondecomp)`,
      `df_bacon <- bacon(${yCol} ~ ${treatCol},`,
      `                  data = df, id_var = "${unitCol}", time_var = "${timeCol}")`,
      ``,
      `# Weighted sum reproduces the TWFE coefficient`,
      `sum(df_bacon$estimate * df_bacon$weight)`,
      ``,
      `# Weight vs estimate, by comparison type`,
      `library(ggplot2)`,
      `ggplot(df_bacon) +`,
      `  geom_point(aes(x = weight, y = estimate, colour = type, shape = type), size = 2) +`,
      `  geom_hline(yintercept = sum(df_bacon$estimate * df_bacon$weight), colour = "red") +`,
      `  labs(x = "Weight", y = "2x2 DD Estimate") + theme_minimal()`,
    ].join("\n");
  }
  if (lang === "stata") {
    return [
      `* Goodman-Bacon decomposition — ssc install bacondecomp`,
      `xtset ${unitCol} ${timeCol}`,
      `bacondecomp ${yCol} ${treatCol}, ddetail`,
    ].join("\n");
  }
  return [
    `# No maintained Python port of bacondecomp exists as of this writing.`,
    `# Run the decomposition in R (bacondecomp::bacon) or Stata (bacondecomp),`,
    `# or compute the 2x2s and Goodman-Bacon (2021) weights directly:`,
    `#   weights depend only on group sizes and treated-period shares,`,
    `#   so they can be built from ${unitCol}/${timeCol}/${treatCol} alone.`,
  ].join("\n");
}

export default function BaconPanel({ rows, yCol, unitCol, timeCol, treatCol, betaTWFE }) {
  const { C, T } = useTheme();
  const [open, setOpen] = useState(false);
  const [copied, setCopied] = useState("");

  // Colour per comparison type. "Later vs Earlier" is the contaminated one, so
  // it gets the warning colour wherever it appears.
  const TYPE_COLOR = {
    [BACON_TYPES.VS_NEVER]:         C.teal,
    [BACON_TYPES.EARLIER_VS_LATER]: C.blue,
    [BACON_TYPES.LATER_VS_ALWAYS]:  C.gold,
  };

  // Only computed once the panel is opened — the decomposition is O(groups²)
  // over the full sample and there is no reason to pay for it while collapsed.
  const { res, err, identity } = useMemo(() => {
    if (!open || !rows?.length || !yCol || !unitCol || !timeCol || !treatCol) {
      return { res: null, err: null, identity: null };
    }
    try {
      const r = runBaconDecomposition(rows, yCol, unitCol, timeCol, treatCol);
      return { res: r, err: null, identity: checkBaconIdentity(r, betaTWFE) };
    } catch (e) {
      return { res: null, err: e?.message || String(e), identity: null };
    }
  }, [open, rows, yCol, unitCol, timeCol, treatCol, betaTWFE]);

  const th = { textAlign: "left", padding: "0.3rem 0.5rem", color: C.textMuted, fontWeight: 400, borderBottom: `1px solid ${C.border}`, whiteSpace: "nowrap" };
  const td = { padding: "0.3rem 0.5rem", borderBottom: `1px solid ${C.border}20`, whiteSpace: "nowrap" };

  // ── weight vs estimate scatter (PS6's bacon_plot) ──────────────────────────
  const chart = useMemo(() => {
    if (!res?.comparisons?.length) return null;
    const W = 480, H = 300, PAD = { l: 58, r: 16, t: 16, b: 44 };
    const iW = W - PAD.l - PAD.r, iH = H - PAD.t - PAD.b;
    const ws = res.comparisons.map(c => c.weight);
    const es = res.comparisons.map(c => c.estimate);
    const ref = (typeof betaTWFE === "number" && isFinite(betaTWFE)) ? betaTWFE : res.weightedSum;
    const xHi = Math.max(...ws) * 1.15 || 1;
    let yLo = Math.min(...es, ref), yHi = Math.max(...es, ref);
    const pad = (yHi - yLo) * 0.12 || 1;
    yLo -= pad; yHi += pad;
    const sx = v => PAD.l + (v / xHi) * iW;
    const sy = v => PAD.t + iH - ((v - yLo) / (yHi - yLo)) * iH;
    const xt = [0, xHi / 4, xHi / 2, (3 * xHi) / 4, xHi];
    const yt = Array.from({ length: 5 }, (_, i) => yLo + ((yHi - yLo) * i) / 4);
    return { W, H, PAD, iW, iH, sx, sy, xt, yt, ref, yLo, yHi };
  }, [res, betaTWFE]);

  return (
    <div style={{ border: `1px solid ${C.border}`, borderRadius: 4, overflow: "hidden", marginBottom: "1.4rem" }}>
      <div onClick={() => setOpen(o => !o)}
        style={{ background: C.surface2, padding: "0.55rem 0.85rem", borderBottom: open ? `1px solid ${C.border}` : "none", cursor: "pointer", display: "flex", alignItems: "center", gap: 8 }}>
        <span style={{ fontSize: T.caption.fontSize, color: C.textMuted }}>{open ? "▾" : "▸"}</span>
        <span style={{ fontSize: T.caption.fontSize, color: C.textDim, letterSpacing: "0.2em", textTransform: "uppercase", fontFamily: T.code.fontFamily }}>Goodman-Bacon Decomposition</span>
        <span style={{ marginLeft: "auto", fontSize: T.caption.fontSize, color: C.textMuted }}>
          {res ? `${res.comparisons.length} × 2×2` : "Goodman-Bacon (2021)"}
        </span>
      </div>

      {open && (
        <div style={{ padding: "0.85rem", background: C.surface, display: "flex", flexDirection: "column", gap: 12, fontFamily: T.code.fontFamily, fontSize: T.code.fontSize, color: C.text }}>

          {err && (
            <div style={{ padding: "0.6rem 0.8rem", background: `${C.gold}10`, border: `1px solid ${C.gold}40`, borderLeft: `3px solid ${C.gold}`, borderRadius: 3, color: C.textDim }}>
              {err}
            </div>
          )}

          {res && (
            <>
              <div style={{ color: C.textMuted, lineHeight: 1.5 }}>
                The TWFE coefficient is a weighted average of every 2×2 DiD formed from the
                timing groups. <span style={{ color: C.gold }}>{BACON_TYPES.LATER_VS_ALWAYS}</span> uses
                already-treated units as controls — under heterogeneous or dynamic effects those
                comparisons are contaminated and can enter with the wrong sign.
              </div>

              {/* identity check — the decomposition must reproduce the estimate */}
              {identity && (
                <div style={{ display: "flex", flexWrap: "wrap", gap: 16, padding: "0.5rem 0.7rem", background: C.surface2, borderRadius: 3 }}>
                  <span><span style={{ color: C.textMuted }}>TWFE β </span>{fmt(betaTWFE, 6)}</span>
                  <span><span style={{ color: C.textMuted }}>Σ w·β </span>{fmt(res.weightedSum, 6)}</span>
                  <span><span style={{ color: C.textMuted }}>Σ w </span>{fmt(identity.weightSum, 6)}</span>
                  <span style={{ marginLeft: "auto", color: (identity.betaError == null || identity.betaError < 1e-6) ? C.teal : C.gold }}>
                    {identity.betaError == null ? "identity not checked"
                      : identity.betaError < 1e-6 ? "✓ identity holds"
                      : `⚠ identity off by ${identity.betaError.toExponential(2)}`}
                  </span>
                </div>
              )}

              {res.warnings.map((w, i) => (
                <div key={i} style={{ color: C.gold, fontSize: T.caption.fontSize }}>⚠ {w}</div>
              ))}

              {/* per-type summary */}
              <table style={{ borderCollapse: "collapse", width: "100%" }}>
                <thead><tr>
                  <th style={th}>Comparison type</th>
                  <th style={{ ...th, textAlign: "right" }}>Weight</th>
                  <th style={{ ...th, textAlign: "right" }}>Avg β</th>
                </tr></thead>
                <tbody>
                  {res.summary.map(s => (
                    <tr key={s.type}>
                      <td style={{ ...td, color: TYPE_COLOR[s.type] ?? C.text }}>● {s.type}</td>
                      <td style={{ ...td, textAlign: "right" }}>{fmt(s.weight)}</td>
                      <td style={{ ...td, textAlign: "right" }}>{fmt(s.avgEstimate)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>

              {/* weight vs estimate scatter */}
              {chart && (
                <svg viewBox={`0 0 ${chart.W} ${chart.H}`} style={{ width: "100%", maxWidth: 640, height: "auto", alignSelf: "center" }}>
                  <rect width={chart.W} height={chart.H} fill={C.bg} />
                  {chart.yt.map((t, i) => (
                    <g key={`y${i}`}>
                      <line x1={chart.PAD.l} x2={chart.PAD.l + chart.iW} y1={chart.sy(t)} y2={chart.sy(t)} stroke={C.border} strokeWidth={1} strokeDasharray="3 3" opacity={0.4} />
                      <text x={chart.PAD.l - 6} y={chart.sy(t) + 3} textAnchor="end" fill={C.textMuted} fontSize={T.caption.fontSize} fontFamily={T.data.fontFamily}>{t.toFixed(2)}</text>
                    </g>
                  ))}
                  {chart.xt.map((t, i) => (
                    <g key={`x${i}`}>
                      <text x={chart.sx(t)} y={chart.PAD.t + chart.iH + 15} textAnchor="middle" fill={C.textMuted} fontSize={T.caption.fontSize} fontFamily={T.data.fontFamily}>{t.toFixed(2)}</text>
                    </g>
                  ))}
                  {/* overall estimate reference line */}
                  {chart.ref >= chart.yLo && chart.ref <= chart.yHi && (
                    <line x1={chart.PAD.l} x2={chart.PAD.l + chart.iW} y1={chart.sy(chart.ref)} y2={chart.sy(chart.ref)}
                      stroke={C.textMuted} strokeWidth={1.6} strokeDasharray="7 4" />
                  )}
                  {res.comparisons.map((c, i) => (
                    <circle key={i} cx={chart.sx(c.weight)} cy={chart.sy(c.estimate)} r={5}
                      fill={TYPE_COLOR[c.type] ?? C.text} stroke={C.bg} strokeWidth={1.2} opacity={0.9}>
                      <title>{`${c.type}\ntreated ${c.treated} vs control ${c.control ?? "never"}\nweight ${fmt(c.weight)}  β ${fmt(c.estimate)}`}</title>
                    </circle>
                  ))}
                  <line x1={chart.PAD.l} x2={chart.PAD.l + chart.iW} y1={chart.PAD.t + chart.iH} y2={chart.PAD.t + chart.iH} stroke={C.border2} />
                  <line x1={chart.PAD.l} x2={chart.PAD.l} y1={chart.PAD.t} y2={chart.PAD.t + chart.iH} stroke={C.border2} />
                  <text x={chart.PAD.l + chart.iW / 2} y={chart.H - 4} textAnchor="middle" fill={C.textDim} fontSize={T.caption.fontSize} fontFamily={T.data.fontFamily}>Weight</text>
                  <text transform={`translate(12,${chart.PAD.t + chart.iH / 2}) rotate(-90)`} textAnchor="middle" fill={C.textDim} fontSize={T.caption.fontSize} fontFamily={T.data.fontFamily}>2×2 DD estimate</text>
                </svg>
              )}

              {/* every 2x2 */}
              <table style={{ borderCollapse: "collapse", width: "100%" }}>
                <thead><tr>
                  <th style={th}>Type</th>
                  <th style={th}>Treated</th>
                  <th style={th}>Control</th>
                  <th style={{ ...th, textAlign: "right" }}>Weight</th>
                  <th style={{ ...th, textAlign: "right" }}>β 2×2</th>
                </tr></thead>
                <tbody>
                  {res.comparisons.map((c, i) => (
                    <tr key={i}>
                      <td style={{ ...td, color: TYPE_COLOR[c.type] ?? C.text }}>● {c.type}</td>
                      <td style={td}>{String(c.treated)}</td>
                      <td style={td}>{c.control == null ? "never-treated" : String(c.control)}</td>
                      <td style={{ ...td, textAlign: "right" }}>{fmt(c.weight)}</td>
                      <td style={{ ...td, textAlign: "right" }}>{fmt(c.estimate)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>

              <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
                <span style={{ color: C.textMuted, fontSize: T.caption.fontSize }}>
                  {res.nUnits} units × {res.nTimes} periods · {res.groups.length} timing group(s)
                  {res.groups.some(g => g.time === null) ? " incl. never-treated" : " (no never-treated group)"}
                </span>
                <span style={{ marginLeft: "auto", display: "flex", gap: 6 }}>
                  {[["r", "R"], ["python", "Python"], ["stata", "Stata"]].map(([id, label]) => (
                    <button key={id}
                      onClick={() => {
                        navigator.clipboard?.writeText(baconScript(id, { yCol, unitCol, timeCol, treatCol }));
                        setCopied(id); setTimeout(() => setCopied(""), 1500);
                      }}
                      style={{ padding: "0.2rem 0.6rem", fontFamily: T.code.fontFamily, fontSize: T.caption.fontSize,
                               cursor: "pointer", background: C.surface2, border: `1px solid ${C.border2}`,
                               color: copied === id ? C.teal : C.textMuted, borderRadius: 3 }}>
                      {copied === id ? "copied" : `copy ${label}`}
                    </button>
                  ))}
                </span>
              </div>
            </>
          )}
        </div>
      )}
    </div>
  );
}
