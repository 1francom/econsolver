// src/components/wrangling/DistinctValuesPanel.jsx
// Floating, non-modal, minimizable panel showing every distinct value of a
// column (with counts). Unlike this app's existing modals (AuditTrail.jsx's
// full-screen dimmed overlay), this one does NOT block the rest of the UI —
// the point is to stay visible as a reference while the user keeps working
// elsewhere on the page (e.g. checking country names while building a
// country_code mapping).
import { useState, useEffect } from "react";
import { useTheme } from "./shared.jsx";
import { getDistinctValues } from "../../services/data/duckdb.js";
import { jsDistinctValues } from "../../services/data/distinctValuesFallback.js";

// Props:
//   col            string   — column to show (component re-queries when this changes)
//   tableName      string|null — DuckDB table name; null routes to the JS fallback
//   rows           object[] — full JS row array (used only in the JS-fallback path)
//   minimized      boolean
//   onToggleMinimize  () => void
//   onClose        () => void
export default function DistinctValuesPanel({ col, tableName, rows, minimized, onToggleMinimize, onClose }) {
  const { C, T } = useTheme();
  const [data, setData] = useState(null);     // { values: [{value,count}], total } | null
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError("");
    setData(null);
    (async () => {
      try {
        const result = tableName
          ? await getDistinctValues(tableName, col)
          : jsDistinctValues(rows, col);
        if (!cancelled) setData(result);
      } catch (e) {
        if (!cancelled) setError(e?.message ?? "Failed to compute distinct values.");
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
    // Deliberately NOT depending on `rows`/`tableName` reference churn — only
    // re-query when the user picks a different COLUMN. A v1 read-only
    // inspector; if the underlying data changes while the panel is open it
    // will not auto-refresh (reopen the panel to see fresh values).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [col]);

  const titleBarStyle = {
    display: "flex", alignItems: "center", gap: 8,
    padding: "0.5rem 0.7rem", background: C.surface,
    borderBottom: minimized ? "none" : `1px solid ${C.border}`,
    cursor: "default",
  };

  return (
    <div style={{
      position: "fixed", bottom: 16, right: 16, zIndex: 900,
      width: 320, maxWidth: "calc(100vw - 32px)",
      background: C.bg, border: `1px solid ${C.border2}`, borderRadius: 5,
      boxShadow: "0 8px 28px #000a", overflow: "hidden",
      fontFamily: T.code.fontFamily,
    }}>
      <div style={titleBarStyle}>
        <span style={{ fontSize: T.caption.fontSize, color: C.teal, letterSpacing: "0.1em", textTransform: "uppercase", flex: 1, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
          {col}
        </span>
        {!loading && !error && data && (
          <span style={{ fontSize: T.caption.fontSize, color: C.textMuted }}>
            {data.total > data.values.length ? `top ${data.values.length} of ${data.total}` : `${data.total} distinct`}
          </span>
        )}
        <button onClick={onToggleMinimize} title={minimized ? "Expand" : "Minimize"}
          style={{ background: "none", border: "none", color: C.textDim, cursor: "pointer", fontSize: 13, padding: "0 4px" }}>
          {minimized ? "▢" : "—"}
        </button>
        <button onClick={onClose} title="Close"
          style={{ background: "none", border: "none", color: C.textDim, cursor: "pointer", fontSize: 13, padding: "0 4px" }}>
          ✕
        </button>
      </div>

      {!minimized && (
        <div style={{ maxHeight: 320, overflowY: "auto", padding: "0.4rem 0" }}>
          {loading && (
            <div style={{ padding: "0.7rem", fontSize: T.caption.fontSize, color: C.textMuted }}>Computing…</div>
          )}
          {error && (
            <div style={{ padding: "0.7rem", fontSize: T.caption.fontSize, color: C.red }}>{error}</div>
          )}
          {!loading && !error && data && data.values.length === 0 && (
            <div style={{ padding: "0.7rem", fontSize: T.caption.fontSize, color: C.textMuted }}>No non-null values.</div>
          )}
          {!loading && !error && data && data.values.map((v, i) => (
            <div key={i} style={{
              display: "flex", justifyContent: "space-between", gap: 10,
              padding: "0.3rem 0.7rem", fontSize: T.caption.fontSize,
              color: C.text, borderBottom: i < data.values.length - 1 ? `1px solid ${C.border}` : "none",
            }}>
              <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{String(v.value)}</span>
              <span style={{ color: C.textMuted, flexShrink: 0 }}>{v.count}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
