// ─── ECON STUDIO · components/data/ColumnFilterMenu.jsx ───────────────────────
// Excel's autofilter, for one column of the Data Viewer.
//
// Two sections, identical for every column type:
//   * a value list with checkboxes — maps to the canonical `in` operator
//   * an operator row — everything the value list cannot express
//
// The list is deliberately offered even on continuous columns, where it shows
// "top 500 of N by frequency" and the user drops to the operators instead. A
// type-aware menu would have to guess where the boundary is, and guessing wrong
// hides the control someone needs.
//
// Values come from getDistinctValues — the SAME SQL the distinct-values panel
// runs, over the FULL table, not the 500-row preview the grid is showing.

import { useState, useEffect, useMemo } from "react";
import { useTheme } from "../../ThemeContext.jsx";
import { getDistinctValues } from "../../services/data/duckdb.js";
import { jsDistinctValues } from "../../services/data/distinctValuesFallback.js";
import { menuLabel, opArity, FILTER_OPS } from "../../pipeline/predicate.js";

/**
 * @param col        column name
 * @param tableName  DuckDB table, or null for the JS fallback
 * @param rows       rows for the JS fallback
 * @param condition  the stack row for this column, or null
 * @param onApply    (condition|null) => void — null clears this column's filter
 * @param onClose    () => void
 * @param stackSize  how many conditions are active across all columns
 * @param onPromote  () => void — turn the whole stack into a pipeline step
 * @param onClearAll () => void — drop every condition, not just this column's
 */
const inputS = (C, T) => ({
  width: 78, padding: "0.2rem 0.35rem", background: C.surface2,
  border: `1px solid ${C.border2}`, borderRadius: 3, color: C.text,
  fontFamily: T.code.fontFamily, fontSize: T.caption.fontSize, outline: "none",
});

export default function ColumnFilterMenu({ col, tableName, rows, condition, onApply, onClose, stackSize = 0, onPromote, onClearAll }) {
  const { C, T } = useTheme();
  const [data, setData]     = useState(null);   // { values:[{value,count}], total }
  const [loading, setLoad]  = useState(true);
  const [error, setError]   = useState("");
  const [search, setSearch] = useState("");
  // Checked values are held as STRINGS, matching how the canonical `in`
  // operator compares — a numeric 1 and the string "1" are one level.
  const [checked, setChecked] = useState(
    () => new Set((condition?.op === "in" ? condition.values : []) ?? [])
  );
  const [op, setOp]   = useState(condition && condition.op !== "in" ? condition.op : "eq");
  const [val, setVal] = useState(condition && condition.op !== "in" ? (condition.value ?? "") : "");
  const [lo, setLo]   = useState(condition?.lo ?? "");
  const [hi, setHi]   = useState(condition?.hi ?? "");

  useEffect(() => {
    let cancelled = false;
    setLoad(true); setError(""); setData(null);
    (async () => {
      try {
        const r = tableName ? await getDistinctValues(tableName, col) : jsDistinctValues(rows, col);
        if (!cancelled) setData(r);
      } catch (e) {
        if (!cancelled) setError(e?.message ?? "Could not read this column's values.");
      } finally {
        if (!cancelled) setLoad(false);
      }
    })();
    return () => { cancelled = true; };
  }, [col, tableName]); // eslint-disable-line react-hooks/exhaustive-deps

  const shown = useMemo(() => {
    const vs = data?.values ?? [];
    if (!search.trim()) return vs;
    const q = search.toLowerCase();
    return vs.filter(v => String(v.value).toLowerCase().includes(q));
  }, [data, search]);

  const toggle = (v) => setChecked(prev => {
    const next = new Set(prev);
    const k = String(v);
    next.has(k) ? next.delete(k) : next.add(k);
    return next;
  });

  const btn = (label, onClick, accent) => (
    <button onClick={onClick} style={{
      padding: "0.25rem 0.6rem", borderRadius: 3, cursor: "pointer",
      border: `1px solid ${accent ? C.teal : C.border2}`,
      background: accent ? `${C.teal}18` : "transparent",
      color: accent ? C.teal : C.textDim,
      fontFamily: T.code.fontFamily, fontSize: T.caption.fontSize,
    }}>{label}</button>
  );

  const applyList = () => onApply(checked.size ? { col, op: "in", values: [...checked] } : null);
  const applyOp = () => {
    const arity = opArity(op);
    if (arity === "none") return onApply({ col, op });
    // `between` needs both ends; a half-filled range must clear rather than
    // silently filter on one side.
    if (arity === "two") {
      return onApply(String(lo) !== "" && String(hi) !== "" ? { col, op, lo, hi } : null);
    }
    return onApply(String(val) !== "" ? { col, op, value: val } : null);
  };

  const rowStyle = { display: "flex", alignItems: "center", gap: 6, padding: "0.22rem 0.6rem", fontSize: T.caption.fontSize, color: C.text, cursor: "pointer" };

  return (
    <div onClick={e => e.stopPropagation()}
      style={{
        position: "absolute", top: "100%", left: 0, zIndex: 50, minWidth: 240,
        background: C.bg, border: `1px solid ${C.border2}`, borderRadius: 4,
        boxShadow: "0 8px 28px #000a", fontFamily: T.code.fontFamily,
        fontWeight: 400, cursor: "default", textAlign: "left",
      }}>
      {/* ── value list ── */}
      <div style={{ padding: "0.45rem 0.6rem", borderBottom: `1px solid ${C.border}` }}>
        <input value={search} onChange={e => setSearch(e.target.value)} placeholder="search values"
          style={{ width: "100%", boxSizing: "border-box", padding: "0.22rem 0.4rem", background: C.surface2,
                   border: `1px solid ${C.border2}`, borderRadius: 3, color: C.text,
                   fontFamily: T.code.fontFamily, fontSize: T.caption.fontSize, outline: "none" }} />
      </div>

      <div style={{ maxHeight: 200, overflowY: "auto", padding: "0.2rem 0" }}>
        {loading && <div style={{ padding: "0.5rem 0.6rem", fontSize: T.caption.fontSize, color: C.textMuted }}>Reading values…</div>}
        {error   && <div style={{ padding: "0.5rem 0.6rem", fontSize: T.caption.fontSize, color: C.red }}>{error}</div>}
        {!loading && !error && shown.map((v, i) => (
          <label key={i} style={rowStyle}>
            <input type="checkbox" checked={checked.has(String(v.value))} onChange={() => toggle(v.value)} />
            <span style={{ flex: 1, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{String(v.value)}</span>
            <span style={{ color: C.textMuted, flexShrink: 0 }}>{v.count}</span>
          </label>
        ))}
        {!loading && !error && !shown.length && (
          <div style={{ padding: "0.5rem 0.6rem", fontSize: T.caption.fontSize, color: C.textMuted }}>No matching values.</div>
        )}
      </div>

      {/* Saying which slice of the column this is matters most exactly where the
          list is useless — a continuous column with thousands of levels. */}
      {data && (
        <div style={{ padding: "0.2rem 0.6rem 0.4rem", fontSize: T.caption.fontSize, color: C.textMuted, borderBottom: `1px solid ${C.border}` }}>
          {data.total > data.values.length
            ? `top ${data.values.length.toLocaleString()} of ${data.total.toLocaleString()} by frequency — use a condition below for the rest`
            : `${data.total.toLocaleString()} distinct`}
        </div>
      )}

      <div style={{ display: "flex", gap: 6, padding: "0.45rem 0.6rem", borderBottom: `1px solid ${C.border}` }}>
        {btn(`Apply ${checked.size || ""}`.trim(), applyList, checked.size > 0)}
        {btn("Clear", () => { setChecked(new Set()); onApply(null); })}
      </div>

      {/* ── operator row ── */}
      <div style={{ display: "flex", gap: 5, alignItems: "center", padding: "0.45rem 0.6rem", flexWrap: "wrap" }}>
        <select value={op} onChange={e => setOp(e.target.value)}
          style={{ padding: "0.2rem 0.3rem", background: C.surface2, border: `1px solid ${C.border2}`, borderRadius: 3,
                   color: C.text, fontFamily: T.code.fontFamily, fontSize: T.caption.fontSize, outline: "none" }}>
          {FILTER_OPS.filter(o => o !== "in").map(o => <option key={o} value={o}>{menuLabel(o)}</option>)}
        </select>
        {opArity(op) === "two" ? (
          <>
            <input value={lo} onChange={e => setLo(e.target.value)} placeholder="from" style={inputS(C, T)} />
            <span style={{ fontSize: T.caption.fontSize, color: C.textMuted }}>–</span>
            <input value={hi} onChange={e => setHi(e.target.value)} placeholder="to" style={inputS(C, T)} />
          </>
        ) : opArity(op) !== "none" && (
          <input value={val} onChange={e => setVal(e.target.value)} placeholder="value" style={inputS(C, T)} />
        )}
        {btn("Apply", applyOp)}
      </div>

      {/* The whole stack, reachable from here. Filtering from a column header
          and then having to open the Edit-cells panel to find "add to pipeline"
          was the workflow Franco flagged — the button belongs where the filter
          was built. */}
      {stackSize > 0 && (
        <div style={{ padding: "0.45rem 0.6rem", borderTop: `1px solid ${C.border}`, display: "flex", gap: 6, alignItems: "center", flexWrap: "wrap" }}>
          <span style={{ fontSize: T.caption.fontSize, color: C.textMuted }}>
            {stackSize} condition{stackSize === 1 ? "" : "s"} active
          </span>
          {onPromote  && btn("→ Add to pipeline", () => { onPromote(); onClose(); }, true)}
          {onClearAll && btn("Clear all", () => { onClearAll(); onClose(); })}
        </div>
      )}

      <div style={{ padding: "0.35rem 0.6rem", borderTop: `1px solid ${C.border}`, textAlign: "right" }}>
        {btn("Close", onClose)}
      </div>
    </div>
  );
}
