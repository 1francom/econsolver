// ─── ECON STUDIO · components/panels/ArtifactViewerPanel.jsx ──────────────────
// App-scoped floating viewer over the project's saved artifacts, navigated with
// ◀ ▶ in the SAME order artifactOrder.js persists — which is also the order the
// replication bundle emits, so what the user sees and what they export cannot
// drift apart.
//
// This is RStudio's Plots pane, not a window manager: one panel holding many
// artifacts with history, rather than N floating windows the user has to
// arrange.
//
// v1 renders PLOTS live — PlotCanvas takes exactly the fields a saved entry
// carries. Maps appear in the same ordered list as a summary card with an "open"
// action: MapCanvas drives a Leaflet instance whose lifecycle inside a resizing
// panel is its own hazard, and that is a deliberate v1 boundary.

import { useState, useEffect, useMemo } from "react";
import { useTheme } from "../../ThemeContext.jsx";
import FloatingPanel from "./FloatingPanel.jsx";
import { PlotCanvas } from "../PlotBuilder.jsx";
import { getPlotHistory, getMapHistory } from "../../services/Persistence/plotHistory.js";
import { getArtifactOrder, makeArtifactId, orderArtifacts } from "../../services/Persistence/artifactOrder.js";
import { readPanelPref, writePanelPref } from "./panelPrefs.js";

const PANEL_WIDTH = 460;
const BODY_HEIGHT = 360;

/**
 * @param pid       project id — artifact history and order are project-scoped
 * @param datasets  [{ id, rows, headers, filename }] from App's availableDatasets;
 *                  a saved plot stores only `datasetId`, so its rows resolve here
 * @param onOpen    (artifact) => void — navigate to the artifact's home tab
 * @param onClose   () => void
 */
export default function ArtifactViewerPanel({ pid, datasets = [], outputs = {}, onOpen, onClose }) {
  const { C, T } = useTheme();
  const [artifacts, setArtifacts] = useState([]);
  const [idx,       setIdx]       = useState(() => readPanelPref(pid, "artifactIdx", 0));
  const [minimized, setMinimized] = useState(() => readPanelPref(pid, "artifactMin", false));

  // `pid` can arrive after the first render, so the lazy initialisers above are
  // not enough on their own — re-read once it lands.
  useEffect(() => {
    if (!pid) return;
    setIdx(readPanelPref(pid, "artifactIdx", 0));
    setMinimized(readPanelPref(pid, "artifactMin", false));
  }, [pid]);
  useEffect(() => { writePanelPref(pid, "artifactIdx", idx); }, [pid, idx]);
  useEffect(() => { writePanelPref(pid, "artifactMin", minimized); }, [pid, minimized]);

  useEffect(() => {
    if (!pid) return;
    let cancelled = false;
    (async () => {
      const [plots, maps, order] = await Promise.all([
        getPlotHistory(pid).catch(() => []),
        getMapHistory(pid).catch(() => []),
        getArtifactOrder(pid).catch(() => []),
      ]);
      const items = [
        ...(plots ?? []).map(e => ({ kind: "plot", artifactId: makeArtifactId("plot", e.id), savedAt: e.savedAt ?? 0, entry: e })),
        ...(maps  ?? []).map(e => ({ kind: "map",  artifactId: makeArtifactId("map",  e.id), savedAt: e.savedAt ?? 0, entry: e })),
      ];
      if (!cancelled) setArtifacts(orderArtifacts(items, order));
    })();
    return () => { cancelled = true; };
  }, [pid]);

  // Clamp when the collection shrinks — an artifact deleted in another tab.
  // Returning early on an empty list is load-bearing: this effect also runs on
  // mount, when artifacts have not loaded yet, and clamping to 0 there would
  // discard the index just restored from sessionStorage.
  useEffect(() => {
    if (artifacts.length === 0) return;
    setIdx(i => Math.min(i, artifacts.length - 1));
  }, [artifacts.length]);

  const current = artifacts[idx] ?? null;
  const dsId = current?.entry?.datasetId ?? current?.entry?._srcId ?? null;

  // POST-pipeline rows, not raw. availableDatasets carries `rawData.rows`, so a
  // plot built on a renamed column (`GDP` after `rename(GDP = "GDP per capita")`)
  // finds nothing there and renders as bare axes. PlotBuilder itself is handed
  // cleaned rows, which is why it draws the same plot correctly.
  const rows = useMemo(() => {
    const cleaned = outputs?.[dsId]?.cleanRows;
    if (cleaned?.length) return cleaned;
    return datasets.find(d => d.id === dsId)?.rows ?? null;
  }, [outputs, datasets, dsId]);

  // Columns the saved layers actually need. A plot whose columns are absent from
  // the rows we have would draw an empty frame — a plausible-looking wrong
  // answer — so it is reported instead.
  const missingCols = useMemo(() => {
    if (!rows?.length || current?.kind !== "plot") return [];
    const present = new Set(Object.keys(rows[0] ?? {}));
    const needed = new Set();
    for (const ly of current.entry.layers ?? []) {
      for (const v of Object.values(ly.aes ?? {})) {
        if (typeof v === "string" && v) needed.add(v);
      }
    }
    if (current.entry.facetCol) needed.add(current.entry.facetCol);
    return [...needed].filter(c => !present.has(c));
  }, [rows, current]);

  const navBtn = (label, disabled, onClick) => (
    <button onClick={onClick} disabled={disabled} title={label === "◀" ? "Previous" : "Next"}
      style={{
        background: "none", border: `1px solid ${disabled ? C.border : C.border2}`, borderRadius: 3,
        color: disabled ? C.border2 : C.textDim, cursor: disabled ? "default" : "pointer",
        fontSize: T.caption.fontSize, padding: "1px 7px",
      }}>{label}</button>
  );

  return (
    <FloatingPanel
      id="artifact-viewer"
      tab={null}
      title="Artifacts"
      meta={artifacts.length ? `${idx + 1} / ${artifacts.length}` : null}
      width={PANEL_WIDTH}
      bodyHeight={BODY_HEIGHT}
      minimized={minimized}
      onToggleMinimize={() => setMinimized(m => !m)}
      onClose={onClose}
    >
      <div style={{ padding: "0.5rem 0.7rem" }}>
        {artifacts.length === 0 && (
          <div style={{ fontSize: T.caption.fontSize, color: C.textMuted }}>
            No saved plots or maps in this project yet.
          </div>
        )}

        {current && (
          <>
            <div style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: 8 }}>
              {navBtn("◀", idx === 0, () => setIdx(i => Math.max(0, i - 1)))}
              {navBtn("▶", idx >= artifacts.length - 1, () => setIdx(i => Math.min(artifacts.length - 1, i + 1)))}
              <span style={{
                flex: 1, fontSize: T.caption.fontSize, color: C.text,
                overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap",
              }}>
                {current.entry.name ?? current.kind}
              </span>
              {/* Minimize rather than close: you are about to look at this
                  artifact full size, so the panel should get out of the way —
                  but closing would also discard your position in the list, and
                  the panel's whole point is to persist. */}
              <button onClick={() => { setMinimized(true); onOpen?.(current); }}
                style={{
                  background: "transparent", border: `1px solid ${C.border2}`, borderRadius: 3,
                  color: C.textDim, cursor: "pointer", fontSize: T.caption.fontSize, padding: "1px 8px",
                }}>open</button>
            </div>

            {current.kind === "plot" && !!rows?.length && missingCols.length === 0 && (
              <PlotCanvas
                layers={current.entry.layers ?? []}
                rows={rows}
                title={current.entry.title || ""}
                xLabel={current.entry.xLabel || ""}
                yLabel={current.entry.yLabel || ""}
                scheme={current.entry.scheme || ""}
                xScale={current.entry.xScale || "linear"}
                yScale={current.entry.yScale || "linear"}
                xDomain={current.entry.xDomain || [null, null]}
                yDomain={current.entry.yDomain || [null, null]}
                xFmt={current.entry.xFmt || ""}
                yFmt={current.entry.yFmt || ""}
                xCatOrder={current.entry.xCatOrder || ""}
                yCatOrder={current.entry.yCatOrder || ""}
                facetCol={current.entry.facetCol || ""}
                facetCols={current.entry.facetCols || 3}
                width={PANEL_WIDTH - 24}
                height={BODY_HEIGHT - 70}
              />
            )}

            {current.kind === "plot" && !rows?.length && (
              <div style={{ fontSize: T.caption.fontSize, color: C.textMuted }}>
                Source dataset “{current.entry.datasetName ?? current.entry.datasetId ?? "unknown"}” is not
                loaded in this session — load it from the Data tab to see this plot.
              </div>
            )}

            {current.kind === "plot" && !!rows?.length && missingCols.length > 0 && (
              <div style={{ fontSize: T.caption.fontSize, color: C.yellow, lineHeight: 1.5 }}>
                ⚠ This plot needs {missingCols.map(c => `“${c}”`).join(", ")}, which
                {missingCols.length === 1 ? " is" : " are"} not in the current output of
                “{current.entry.datasetName ?? dsId ?? "its dataset"}”. A cleaning step may have
                renamed or dropped {missingCols.length === 1 ? "it" : "them"} since the plot was saved.
              </div>
            )}

            {current.kind === "map" && (
              <div style={{
                border: `1px solid ${C.border}`, borderRadius: 4, padding: "0.7rem",
                fontSize: T.caption.fontSize, color: C.textMuted,
              }}>
                Map · {(current.entry.layers ?? []).length} layer(s).
                Use <span style={{ color: C.textDim }}>open</span> to view it on the Spatial tab.
              </div>
            )}
          </>
        )}
      </div>
    </FloatingPanel>
  );
}
