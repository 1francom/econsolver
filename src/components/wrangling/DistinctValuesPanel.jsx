// src/components/wrangling/DistinctValuesPanel.jsx
// Every distinct value of a column, with counts — content only. The floating,
// non-modal, minimizable frame now lives in panels/FloatingPanel.jsx, which this
// renders into; the non-blocking behaviour (stay visible as a reference while
// the user keeps working, e.g. checking country names while building a
// country_code mapping) is a property of that shell.
//
// Mounted INSIDE WranglingModule on purpose: that is what makes it module-scoped,
// so it hides when the user leaves Clean and returns with its state intact.
// `tab="clean"` below only tells the stack registry to release its slot while
// hidden — it is not what decides the scope.
import { useState, useEffect } from "react";
import { useTheme } from "./shared.jsx";
import FloatingPanel from "../panels/FloatingPanel.jsx";
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

  return (
    <FloatingPanel
      id="distinct-values"
      tab="clean"
      title={col}
      meta={!loading && !error && data
        ? (data.total > data.values.length ? `top ${data.values.length} of ${data.total}` : `${data.total} distinct`)
        : null}
      minimized={minimized}
      onToggleMinimize={onToggleMinimize}
      onClose={onClose}
    >
      <div style={{ padding: "0.4rem 0" }}>
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
    </FloatingPanel>
  );
}
