// ─── ExplorePinBar ────────────────────────────────────────────────────────────
// Two-row sticky bar at the bottom of Explore showing pinned analyses.
// Top row: pinned plots (histogram, barchart, spaghetti, timeseries, corr, etc.)
// Bottom row: pinned summary tables
// Compare button (2+ same-kind selected) → side-by-side panel above the bar.

import { useState, useRef } from "react";
import { useTheme } from "../../ThemeContext.jsx";
import { downloadGridPNG } from "../../services/export/plotExporter.js";

const KIND_ICON = {
  summary:       "⊞",
  head:          "⊟",
  tail:          "⊟",
  histogram:     "⬡",
  barchart:      "⬡",
  spaghetti:     "⬡",
  timeseries:    "⬡",
  correlation:   "⬡",
  overdispersion:"∿",
};
const KIND_LABEL = {
  summary:       "Table",
  head:          "head",
  tail:          "tail",
  histogram:     "Hist",
  barchart:      "Bar",
  spaghetti:     "Spaghetti",
  timeseries:    "TimeSeries",
  correlation:   "Corr",
  overdispersion:"Dispersion",
};

const PLOT_KINDS  = ["histogram","barchart","spaghetti","timeseries","correlation","overdispersion"];
const TABLE_KINDS = ["summary","head","tail"];

// ── Comparison panel for summary stats ────────────────────────────────────────
function TableCompare({ items, info }) {
  const { C, T } = useTheme();
  // Union of all columns across selected pins
  const allCols = [...new Set(items.flatMap(it => it.params.columns ?? []))];

  const cellStyle = {
    padding: "3px 10px",
    fontFamily: T.code.fontFamily,
    fontSize: T.caption.fontSize,
    color: C.text,
    borderBottom: `1px solid ${C.border}`,
  };
  const headStyle = {
    ...cellStyle,
    color: C.textMuted,
    letterSpacing: "0.1em",
    textTransform: "uppercase",
    fontWeight: 600,
  };

  return (
    <div style={{ overflowX: "auto" }}>
      <table style={{ borderCollapse: "collapse", width: "100%", minWidth: 400 }}>
        <thead>
          <tr>
            <th style={{ ...headStyle, textAlign: "left", color: C.teal }}>Variable</th>
            {items.map(it => (
              <th key={it.id} style={{ ...headStyle, textAlign: "right" }} title={it.label}>
                {it.label.length > 28 ? it.label.slice(0, 26) + "…" : it.label}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {allCols.map(col => {
            const stat = info[col];
            return (
              <tr key={col}>
                <td style={{ ...cellStyle, color: C.gold }}>{col}</td>
                {items.map(it => {
                  const included = (it.params.columns ?? []).includes(col);
                  if (!included || !stat) return (
                    <td key={it.id} style={{ ...cellStyle, color: C.textMuted, textAlign: "right" }}>—</td>
                  );
                  return (
                    <td key={it.id} style={{ ...cellStyle, textAlign: "right" }}>
                      <span style={{ color: C.text }}>{stat.mean != null ? stat.mean.toFixed(3) : "—"}</span>
                      <span style={{ color: C.textMuted }}>{stat.sd != null ? ` (${stat.sd.toFixed(3)})` : ""}</span>
                    </td>
                  );
                })}
              </tr>
            );
          })}
        </tbody>
      </table>
      <div style={{ fontSize: T.caption.fontSize, color: C.textMuted, fontFamily: T.code.fontFamily, padding: "4px 10px" }}>
        Values: mean (sd) · stats reflect current filter
      </div>
    </div>
  );
}

// ── Plot compare: render the actual charts side by side (params as fallback) ──
function PlotCompare({ items, renderPlot }) {
  const { C, T } = useTheme();
  return (
    <div style={{ display: "flex", gap: 12, flexWrap: "wrap" }}>
      {items.map(it => {
        const chart = renderPlot ? renderPlot(it) : null;
        return (
          <div key={it.id} style={{
            flex: "1 1 320px",
            background: C.surface,
            border: `1px solid ${C.border}`,
            borderLeft: `3px solid ${C.teal}`,
            borderRadius: 4,
            padding: "8px 12px",
          }}>
            <div style={{ fontFamily: T.code.fontFamily, fontSize: T.caption.fontSize, color: C.text, marginBottom: 6 }}>
              {KIND_ICON[it.kind] ?? "⬡"} {it.label}
            </div>
            {chart
              ? <div>{chart}</div>
              : Object.entries(it.params)
                  .filter(([k]) => k !== "kind")
                  .map(([k, v]) => (
                    <div key={k} style={{ fontFamily: T.code.fontFamily, fontSize: "10px", color: C.textMuted }}>
                      <span style={{ color: C.textDim }}>{k}:</span>{" "}
                      {Array.isArray(v) ? v.join(", ") : String(v ?? "—")}
                    </div>
                  ))}
          </div>
        );
      })}
    </div>
  );
}

// ── Pin card ──────────────────────────────────────────────────────────────────
function PinCard({ item, selected, onToggle, onRemove }) {
  const { C, T } = useTheme();
  const icon = KIND_ICON[item.kind] ?? "⬡";
  const shortLabel = item.label.length > 36 ? item.label.slice(0, 34) + "…" : item.label;

  return (
    <div
      onClick={() => onToggle(item.id)}
      title={item.label}
      style={{
        display: "flex",
        alignItems: "center",
        gap: 5,
        padding: "2px 8px 2px 6px",
        borderRadius: 3,
        border: `1px solid ${selected ? C.teal : C.border}`,
        background: selected ? `${C.teal}18` : C.surface,
        cursor: "pointer",
        flexShrink: 0,
        transition: "border-color 0.12s, background 0.12s",
      }}
    >
      <span style={{ fontSize: T.caption.fontSize, color: selected ? C.teal : C.textMuted }}>{icon}</span>
      <span style={{ fontFamily: T.code.fontFamily, fontSize: T.caption.fontSize, color: selected ? C.teal : C.textDim }}>
        {shortLabel}
      </span>
      <span
        onClick={e => { e.stopPropagation(); onRemove(item.id); }}
        style={{
          marginLeft: 2,
          color: C.textMuted,
          cursor: "pointer",
          fontSize: T.caption.fontSize,
          lineHeight: 1,
          padding: "0 2px",
        }}
        title="Remove"
      >×</span>
    </div>
  );
}

// ── Row (one kind-group bar) ──────────────────────────────────────────────────
function PinRow({ label, items, selected, onToggle, onRemove, canCompare, onCompare }) {
  const { C, T } = useTheme();
  if (!items.length) return null;

  return (
    <div style={{ display: "flex", alignItems: "center", gap: 6, flexWrap: "wrap", padding: "3px 0" }}>
      <span style={{
        fontFamily: T.code.fontFamily,
        fontSize: T.caption.fontSize,
        color: C.textMuted,
        letterSpacing: "0.15em",
        textTransform: "uppercase",
        flexShrink: 0,
        minWidth: 50,
      }}>
        {label}
      </span>
      <div style={{ display: "flex", gap: 5, flexWrap: "wrap", flex: 1 }}>
        {items.map(it => (
          <PinCard
            key={it.id}
            item={it}
            selected={selected.includes(it.id)}
            onToggle={onToggle}
            onRemove={onRemove}
          />
        ))}
      </div>
      {canCompare && (
        <button
          onClick={onCompare}
          style={{
            padding: "2px 10px",
            borderRadius: 3,
            border: `1px solid ${C.teal}`,
            background: "transparent",
            color: C.teal,
            fontFamily: T.code.fontFamily,
            fontSize: T.caption.fontSize,
            cursor: "pointer",
            flexShrink: 0,
          }}
        >
          ⊞ Compare
        </button>
      )}
    </div>
  );
}

// Which pinned kinds belong to which Explore subtab — the bar shows only the
// pins for the subtab you are on (Distributions ⇒ histograms, Summary ⇒ tables,
// Time Series ⇒ time series), mirroring the per-tab PlotBuilder history.
const SUBTAB_KINDS = {
  summary:    ["summary", "overdispersion", "head", "tail"],
  visuals:    ["histogram", "barchart", "spaghetti"],
  timeseries: ["timeseries", "acf_pacf", "adf"],
  corr:       ["correlation"],
};

// ── Main component ────────────────────────────────────────────────────────────
export default function ExplorePinBar({ items, info, subtab, renderPlot, onRemove }) {
  const { C, T } = useTheme();
  const [selected, setSelected]         = useState([]);
  const [compareKind, setCompareKind]   = useState(null); // "plots" | "tables" | null
  const compareRef = useRef(null);

  // The Plot Builder subtab has its own history bar — don't double up.
  if (subtab === "plot") return null;
  // Show only the pins relevant to the active subtab.
  const scopeKinds = SUBTAB_KINDS[subtab] ?? null;
  const scoped = scopeKinds ? items.filter(it => scopeKinds.includes(it.kind)) : items;

  const plots  = scoped.filter(it => PLOT_KINDS.includes(it.kind));
  const tables = scoped.filter(it => TABLE_KINDS.includes(it.kind));

  if (!scoped.length) return null;

  const toggleSelect = (id) => {
    setSelected(prev => prev.includes(id) ? prev.filter(i => i !== id) : [...prev, id]);
  };

  const removeItem = (id) => {
    setSelected(prev => prev.filter(i => i !== id));
    if (compareKind) setCompareKind(null);
    onRemove(id);
  };

  const selectedPlots  = plots.filter(it  => selected.includes(it.id));
  const selectedTables = tables.filter(it => selected.includes(it.id));

  const doCompare = (kind) => {
    setCompareKind(prev => prev === kind ? null : kind);
  };

  const compareItems = compareKind === "plots"  ? selectedPlots
                     : compareKind === "tables" ? selectedTables
                     : [];

  return (
    <div style={{
      borderTop: `1px solid ${C.border}`,
      background: C.surface,
      padding: "6px 14px",
      flexShrink: 0,
    }}>
      {/* Compare panel */}
      {compareKind && compareItems.length >= 2 && (
        <div style={{
          marginBottom: 8,
          padding: "8px 10px",
          background: C.bg,
          border: `1px solid ${C.border}`,
          borderRadius: 4,
        }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 6 }}>
            <span style={{ fontFamily: T.code.fontFamily, fontSize: T.caption.fontSize, color: C.teal, letterSpacing: "0.15em", textTransform: "uppercase" }}>
              {compareKind === "tables" ? "Table compare" : "Plot compare"}
            </span>
            <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
              {/* PNG export — plots only (tables don't rasterise cleanly). Grid
                  layout adapts to the count (3 → 2 over 1, 4 → 2×2, …). */}
              {compareKind === "plots" && (
                <button
                  onClick={() => downloadGridPNG(
                    Array.from(compareRef.current?.querySelectorAll("svg") ?? []),
                    `explore_compare_${subtab ?? "plots"}`,
                  )}
                  style={{ background: "transparent", border: `1px solid ${C.border2}`, borderRadius: 3, color: C.textDim, cursor: "pointer", fontFamily: T.code.fontFamily, fontSize: T.caption.fontSize, padding: "2px 8px" }}
                  onMouseEnter={e => { e.currentTarget.style.borderColor = C.teal; e.currentTarget.style.color = C.teal; }}
                  onMouseLeave={e => { e.currentTarget.style.borderColor = C.border2; e.currentTarget.style.color = C.textDim; }}
                >↓ PNG</button>
              )}
              <button onClick={() => setCompareKind(null)} style={{ background: "transparent", border: "none", color: C.textMuted, cursor: "pointer", fontFamily: T.code.fontFamily, fontSize: T.caption.fontSize }}>✕ close</button>
            </div>
          </div>
          {compareKind === "tables"
            ? <TableCompare items={compareItems} info={info} />
            : <div ref={compareRef}><PlotCompare items={compareItems} renderPlot={renderPlot} /></div>
          }
        </div>
      )}

      {/* Plots row */}
      <PinRow
        label="Plots"
        items={plots}
        selected={selected}
        onToggle={toggleSelect}
        onRemove={removeItem}
        canCompare={selectedPlots.length >= 2}
        onCompare={() => doCompare("plots")}
      />

      {/* Tables row */}
      <PinRow
        label="Tables"
        items={tables}
        selected={selected}
        onToggle={toggleSelect}
        onRemove={removeItem}
        canCompare={selectedTables.length >= 2}
        onCompare={() => doCompare("tables")}
      />
    </div>
  );
}
