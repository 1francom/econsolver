// ─── ECON STUDIO · src/components/explore/ExplorePlotTab.jsx ──────────────────
// Explore's "Plot Builder" tab. It owns the plot's DATA SOURCE and hands plain
// rows to the generic PlotBuilder — the same split ModelingTab already uses for
// its "result" and "comparison" modes, so PlotBuilder never learns about
// estimators and stays a column-mapping tool.
//
// Modes:
//   "data"  — the dataset's own rows. Default; identical to the previous tab.
//   "bacon" — Goodman-Bacon (2021) 2x2 decomposition, one row per comparison.
//
// Why Bacon belongs here and not only under a fitted model: it is a PRE-
// regression diagnostic. It says what a TWFE coefficient would be averaging —
// in particular how much weight sits on already-treated units used as controls
// — so gating it behind running that TWFE (which is where BaconPanel lives)
// inverts the order in which it is useful.

import { useMemo, useState } from "react";
import PlotBuilder from "../PlotBuilder.jsx";
import { useTheme } from "../modeling/shared.jsx";
import { runBaconDecomposition } from "../../math/did/baconDecomp.js";
import { baconScript } from "../../services/export/baconScript.js";

// One row per 2x2 comparison. `control` is null for never-treated controls;
// it becomes the string "never" so the column stays plottable as a category.
const BACON_HEADERS = ["type", "weight", "estimate", "treated", "control", "nTreatedUnits", "nControlUnits"];

export default function ExplorePlotTab({
  headers = [], rows = [], panel, numericCols = [],
  pid, histPid, filename, scriptPreamble,
  onRequestDataset, initialPendingPlotId, onConsumePendingPlot, style,
}) {
  const { C, T } = useTheme();
  const [mode,       setMode]       = useState("data");
  const [yCol,       setYCol]       = useState("");
  const [unitCol,    setUnitCol]    = useState(panel?.entityCol || "");
  const [timeCol,    setTimeCol]    = useState(panel?.timeCol   || "");
  const [treatCol,   setTreatCol]   = useState("");
  const [initLayers, setInitLayers] = useState([]);
  const [tmplKey,    setTmplKey]    = useState(0);

  const isBacon = mode === "bacon";
  const ready   = !isBacon || !!(yCol && unitCol && timeCol && treatCol);

  // The decomposition is O(cohorts^2) over the full sample, so it only runs once
  // all four columns are chosen — and it THROWS on a panel outside its scope
  // (unbalanced, non-absorbing, non-binary treatment), which is the whole point
  // of those guards. Surface the message instead of rendering an empty plot.
  const bacon = useMemo(() => {
    if (!isBacon || !ready || !rows?.length) return { rows: [], err: null, sum: null };
    try {
      const res = runBaconDecomposition(rows, yCol, unitCol, timeCol, treatCol);
      return {
        rows: res.comparisons.map(c => ({
          type:          c.type,
          weight:        c.weight,
          estimate:      c.estimate,
          treated:       c.treated,
          control:       c.control ?? "never",
          nTreatedUnits: c.nTreatedUnits,
          nControlUnits: c.nControlUnits,
        })),
        err: null,
        sum: res.weightedSum,
      };
    } catch (e) {
      return { rows: [], err: e?.message || String(e), sum: null };
    }
  }, [isBacon, ready, rows, yCol, unitCol, timeCol, treatCol]);

  const plotHeaders = isBacon ? BACON_HEADERS : headers;
  const plotRows    = isBacon ? bacon.rows     : rows;

  // In Bacon mode the plotted frame is `df_bacon`, produced by bacon() — not the
  // dataset. Chain the dataset's own preamble first so the script still loads and
  // cleans the data, then append the decomposition and repoint dfVar at it.
  function preamble(language) {
    const base = typeof scriptPreamble === "function" ? scriptPreamble(language) : null;
    if (!isBacon) return base;
    const head = base?.code ? `${base.code}\n\n` : "";
    const dfIn = base?.dfVar || "df";
    const body = baconScript(language, { yCol, unitCol, timeCol, treatCol }, { withPlot: false, dfVar: dfIn });
    // Only R has a frame to plot over; Python and Stata emit an honest note that
    // no port exists, so pointing their geom at df_bacon would be a lie.
    return { code: head + body, dfVar: language === "r" ? "df_bacon" : dfIn };
  }

  // Seeded layers name columns that only exist in one mode ("weight"/"estimate"
  // vs the dataset's own), and changing mode remounts PlotBuilder — so carrying
  // them across would re-seed a layer pointing at columns that are now absent.
  function switchMode(next) {
    if (next === mode) return;
    setInitLayers([]);
    setMode(next);
    setTmplKey(k => k + 1);
  }

  function applyTemplate() {
    setInitLayers([
      {
        id: "bacon_pt", geom: "point",
        aes: { x: "weight", y: "estimate", color: "type", yMin: "", yMax: "", sizeCol: "", alphaCol: "" },
        value: "", position: "identity", fill: C.teal, visible: true, opacity: 1.0, pinned: false,
        opts: { size: 5, shape: "circle" },
      },
      {
        // The red reference line in bacondecomp's own plot: the weighted sum,
        // i.e. the TWFE coefficient these 2x2s average to.
        id: "bacon_hl", geom: "hline",
        aes: { x: "", y: "", color: "", yMin: "", yMax: "", sizeCol: "", alphaCol: "" },
        value: bacon.sum != null ? String(bacon.sum) : "",
        position: "identity", fill: C.red, visible: true, opacity: 1.0, pinned: false,
        opts: { strokeWidth: 1.5, dash: "solid" },
      },
    ]);
    setTmplKey(k => k + 1);
  }

  const selStyle = {
    fontFamily: T.code.fontFamily, fontSize: T.caption.fontSize,
    background: C.surface2, color: C.text, border: `1px solid ${C.border}`,
    borderRadius: 3, padding: "3px 6px", maxWidth: 150,
  };
  const chip = on => ({
    padding: "3px 10px", fontFamily: T.code.fontFamily, fontSize: T.caption.fontSize,
    background: on ? `${C.teal}22` : "none", border: `1px solid ${on ? C.teal : C.border2}`,
    borderRadius: 3, color: on ? C.teal : C.textDim, cursor: "pointer",
  });
  const lblStyle = {
    display: "flex", alignItems: "center", gap: 4, color: C.textMuted,
    fontFamily: T.code.fontFamily, fontSize: T.caption.fontSize,
  };

  return (
    <div style={{ marginTop: "0.25rem" }}>
      <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap", marginBottom: "0.6rem" }}>
        <span style={{ fontSize: T.caption.fontSize, color: C.textMuted, fontFamily: T.code.fontFamily, letterSpacing: "0.12em", textTransform: "uppercase" }}>Data</span>
        <button onClick={() => switchMode("data")}  style={chip(!isBacon)}>Dataset</button>
        <button onClick={() => switchMode("bacon")} style={chip(isBacon)}>Bacon decomposition</button>
      </div>

      {isBacon && (
        <div style={{ marginBottom: "0.7rem", padding: "0.6rem 0.8rem", background: C.surface, border: `1px solid ${C.border}`, borderLeft: `3px solid ${C.teal}`, borderRadius: 4 }}>
          <div style={{ fontSize: T.caption.fontSize, color: C.textDim, fontFamily: T.body.fontFamily, marginBottom: 8, lineHeight: 1.6 }}>
            {"Splits the TWFE estimate into every 2×2 comparison it averages, with Goodman-Bacon (2021) weights — before you fit it. Needs a balanced panel with a binary, absorbing treatment."}
          </div>
          <div style={{ display: "flex", gap: 10, flexWrap: "wrap", alignItems: "center" }}>
            <label style={lblStyle}>Y
              <select value={yCol} onChange={e => setYCol(e.target.value)} style={selStyle}>
                <option value="">{"—"}</option>
                {numericCols.map(h => <option key={h} value={h}>{h}</option>)}
              </select>
            </label>
            <label style={lblStyle}>Unit
              <select value={unitCol} onChange={e => setUnitCol(e.target.value)} style={selStyle}>
                <option value="">{"—"}</option>
                {headers.map(h => <option key={h} value={h}>{h}</option>)}
              </select>
            </label>
            <label style={lblStyle}>Time
              <select value={timeCol} onChange={e => setTimeCol(e.target.value)} style={selStyle}>
                <option value="">{"—"}</option>
                {headers.map(h => <option key={h} value={h}>{h}</option>)}
              </select>
            </label>
            <label style={lblStyle}>Treatment
              <select value={treatCol} onChange={e => setTreatCol(e.target.value)} style={selStyle}>
                <option value="">{"—"}</option>
                {numericCols.map(h => <option key={h} value={h}>{h}</option>)}
              </select>
            </label>
            <button
              onClick={applyTemplate}
              disabled={!bacon.rows.length}
              style={{ ...chip(false), cursor: bacon.rows.length ? "pointer" : "not-allowed", opacity: bacon.rows.length ? 1 : 0.45 }}
            >{"◈ Weight vs estimate"}</button>
            {bacon.sum != null && (
              <span style={{ fontSize: T.caption.fontSize, color: C.textMuted, fontFamily: T.code.fontFamily }}>
                {"Σ w·β = "}
                <span style={{ color: C.gold }}>{bacon.sum.toFixed(4)}</span>
                {`  ·  ${bacon.rows.length} comparisons`}
              </span>
            )}
          </div>
          {bacon.err && (
            <div style={{ marginTop: 8, fontSize: T.caption.fontSize, color: C.red, fontFamily: T.code.fontFamily }}>
              {bacon.err}
            </div>
          )}
          {!ready && !bacon.err && (
            <div style={{ marginTop: 8, fontSize: T.caption.fontSize, color: C.textMuted, fontFamily: T.code.fontFamily }}>
              Pick all four columns to run the decomposition.
            </div>
          )}
        </div>
      )}

      <PlotBuilder
        key={`${mode}_${tmplKey}`}
        headers={plotHeaders}
        rows={plotRows}
        initialLayers={initLayers}
        pid={isBacon ? (pid && `${pid}_bacon`) : pid}
        projectPid={histPid}
        datasetId={pid}
        datasetName={filename}
        scriptPreamble={preamble}
        onRequestDataset={onRequestDataset}
        initialPendingPlotId={initialPendingPlotId}
        onConsumePendingPlot={onConsumePendingPlot}
        style={style}
      />
    </div>
  );
}
