// ─── ECON STUDIO · components/wrangling/SubsetManager.jsx ────────────────────
// Named subset manager — H1+H2 of the multi-subset workflow.
//
// A "subset" is a named filter applied ON TOP of the shared pipeline output.
// No new datasets are created — subsets are just filter conditions + a label.
//
// Exports:
//   applySubsetFilter(rows, filters) → row[]   ← pure function, no React
//   SubsetManager (default)                    ← UI component

import { useState } from "react";
import { useTheme, mono } from "../modeling/shared.jsx";

// ─── PURE FILTER FUNCTION ────────────────────────────────────────────────────
// Apply an array of filter conditions to rows.
// Each filter: { col, op, val }
// Supported ops: == != >= <= > <
// Numeric ops coerce values with Number(); string == / != compare as strings.
export function applySubsetFilter(rows, filters) {
  if (!filters?.length) return rows;
  return rows.filter(row =>
    filters.every(f => {
      const v = row[f.col];
      if (v === null || v === undefined) return false;
      const n = Number(v), fv = Number(f.val);
      switch (f.op) {
        case "==": return String(v) === String(f.val);
        case "!=": return String(v) !== String(f.val);
        case ">=": return !isNaN(n) && !isNaN(fv) && n >= fv;
        case "<=": return !isNaN(n) && !isNaN(fv) && n <= fv;
        case ">":  return !isNaN(n) && !isNaN(fv) && n >  fv;
        case "<":  return !isNaN(n) && !isNaN(fv) && n <  fv;
        default: return true;
      }
    })
  );
}

// ─── HELPERS ─────────────────────────────────────────────────────────────────
const OPS = ["==", "!=", ">=", "<=", ">", "<"];

function genId() {
  return "sub_" + Math.random().toString(36).slice(2, 8);
}

function filterLabel(filters) {
  if (!filters.length) return "no filters";
  return filters
    .map(f => `${f.col} ${f.op} ${f.val}`)
    .join(" & ");
}

// ─── SUB-COMPONENTS ──────────────────────────────────────────────────────────
function FilterRow({ filter, headers, onChange, onRemove }) {
  const { C } = useTheme();
  return (
    <div style={{ display: "flex", gap: 4, alignItems: "center", marginBottom: 4 }}>
      {/* Column */}
      <select
        value={filter.col}
        onChange={e => onChange({ ...filter, col: e.target.value })}
        style={{
          flex: 2, background: C.bg, color: C.text, border: `1px solid ${C.border}`,
          borderRadius: 3, fontFamily: mono, fontSize: 10, padding: "3px 5px",
        }}
      >
        <option value="">— col —</option>
        {headers.map(h => <option key={h} value={h}>{h}</option>)}
      </select>

      {/* Operator */}
      <select
        value={filter.op}
        onChange={e => onChange({ ...filter, op: e.target.value })}
        style={{
          flex: 1, background: C.bg, color: C.teal, border: `1px solid ${C.border}`,
          borderRadius: 3, fontFamily: mono, fontSize: 10, padding: "3px 5px",
        }}
      >
        {OPS.map(op => <option key={op} value={op}>{op}</option>)}
      </select>

      {/* Value */}
      <input
        value={filter.val}
        onChange={e => onChange({ ...filter, val: e.target.value })}
        placeholder="value"
        style={{
          flex: 2, background: C.bg, color: C.text, border: `1px solid ${C.border}`,
          borderRadius: 3, fontFamily: mono, fontSize: 10, padding: "3px 6px",
          outline: "none",
        }}
      />

      {/* Remove condition */}
      <button
        onClick={onRemove}
        style={{
          background: "none", border: "none", color: C.textMuted,
          cursor: "pointer", fontSize: 13, padding: "0 3px", lineHeight: 1,
        }}
        title="Remove condition"
      >×</button>
    </div>
  );
}

function SubsetCard({ subset, headers, rows, onChange, onRemove }) {
  const { C } = useTheme();
  const filtered = applySubsetFilter(rows, subset.filters);
  const nLabel   = rows.length ? `n=${filtered.length} / ${rows.length}` : "";

  return (
    <div style={{
      border: `1px solid ${C.border}`,
      borderLeft: `3px solid ${C.teal}`,
      borderRadius: 4, padding: "0.65rem 0.75rem",
      marginBottom: 8, background: C.surface,
    }}>
      {/* Header row */}
      <div style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: 8 }}>
        <input
          value={subset.name}
          onChange={e => onChange({ ...subset, name: e.target.value })}
          style={{
            flex: 1, background: "transparent", border: "none",
            borderBottom: `1px solid ${C.border2}`,
            color: C.text, fontFamily: mono, fontSize: 11, padding: "2px 0",
            outline: "none",
          }}
          placeholder="Subset name"
        />
        <span style={{ fontSize: 9, color: C.textMuted, fontFamily: mono, flexShrink: 0 }}>
          {nLabel}
        </span>
        <button
          onClick={onRemove}
          style={{
            background: "none", border: "none", color: C.textMuted,
            cursor: "pointer", fontSize: 13, padding: "0 2px", lineHeight: 1,
          }}
          title="Delete subset"
        >×</button>
      </div>

      {/* Filter conditions */}
      {subset.filters.map((f, i) => (
        <FilterRow
          key={i}
          filter={f}
          headers={headers}
          onChange={updated => {
            const filters = subset.filters.map((fi, j) => j === i ? updated : fi);
            onChange({ ...subset, filters });
          }}
          onRemove={() => {
            const filters = subset.filters.filter((_, j) => j !== i);
            onChange({ ...subset, filters });
          }}
        />
      ))}

      {/* Add condition */}
      <button
        onClick={() => onChange({
          ...subset,
          filters: [...subset.filters, { col: headers[0] ?? "", op: ">=", val: "" }],
        })}
        style={{
          background: "none", border: `1px dashed ${C.border2}`,
          color: C.textMuted, fontFamily: mono, fontSize: 9,
          padding: "2px 8px", borderRadius: 3, cursor: "pointer",
          letterSpacing: "0.1em", marginTop: 2,
        }}
      >
        + condition
      </button>
    </div>
  );
}

// ─── MAIN COMPONENT ──────────────────────────────────────────────────────────
// Props:
//   headers      string[]           — column names for filter dropdowns
//   rows         object[]           — current clean rows (for n preview)
//   subsets      Subset[]           — controlled state from parent
//   onChange     (Subset[]) => void — update callback
//   onRunAll     () => void         — "Run all subsets" callback
//   running      bool               — disable buttons during estimation
export default function SubsetManager({ headers, rows, subsets, onChange, onRunAll, running }) {
  const { C } = useTheme();
  const [open, setOpen] = useState(false);

  const addSubset = () => {
    onChange([
      ...subsets,
      { id: genId(), name: `Subset ${subsets.length + 1}`, filters: [] },
    ]);
    setOpen(true);
  };

  const updateSubset = (id, updated) =>
    onChange(subsets.map(s => s.id === id ? updated : s));

  const removeSubset = id =>
    onChange(subsets.filter(s => s.id !== id));

  const canRunAll = subsets.length > 0;
  const totalToRun = subsets.length + 1; // subsets + full sample

  return (
    <div style={{ marginTop: "0.75rem" }}>
      {/* Collapsible header */}
      <button
        onClick={() => setOpen(v => !v)}
        style={{
          width: "100%", display: "flex", alignItems: "center",
          justifyContent: "space-between", padding: "0.5rem 0.75rem",
          background: open ? `${C.gold}0d` : C.surface,
          border: `1px solid ${open ? C.gold + "50" : C.border}`,
          borderRadius: open ? "4px 4px 0 0" : 4,
          cursor: "pointer", fontFamily: mono, transition: "all 0.13s",
        }}
      >
        <span style={{ fontSize: 9, color: C.gold, letterSpacing: "0.22em", textTransform: "uppercase" }}>
          ◈ Subsets {subsets.length > 0 ? `(${subsets.length})` : ""}
        </span>
        <span style={{ fontSize: 9, color: C.textMuted }}>{open ? "▲" : "▼"}</span>
      </button>

      {open && (
        <div style={{
          border: `1px solid ${C.gold}50`, borderTop: "none",
          borderRadius: "0 0 4px 4px", padding: "0.85rem 0.75rem",
          background: C.surface,
        }}>
          {/* Full sample — always present */}
          <div style={{
            fontSize: 9, color: C.textMuted, fontFamily: mono,
            padding: "4px 8px", marginBottom: 8,
            border: `1px solid ${C.border}`, borderRadius: 3,
          }}>
            ✓ Full sample — always included (n={rows.length})
          </div>

          {/* Defined subsets */}
          {subsets.map(s => (
            <SubsetCard
              key={s.id}
              subset={s}
              headers={headers}
              rows={rows}
              onChange={updated => updateSubset(s.id, updated)}
              onRemove={() => removeSubset(s.id)}
            />
          ))}

          {/* Actions */}
          <div style={{ display: "flex", gap: 6, marginTop: 6 }}>
            <button
              onClick={addSubset}
              style={{
                flex: 1, background: "none",
                border: `1px dashed ${C.border2}`,
                color: C.textMuted, fontFamily: mono, fontSize: 9,
                padding: "5px 0", borderRadius: 3, cursor: "pointer",
                letterSpacing: "0.12em",
              }}
            >
              + Add subset
            </button>

            {canRunAll && (
              <button
                onClick={onRunAll}
                disabled={running}
                style={{
                  flex: 2, background: running ? "transparent" : `${C.gold}15`,
                  border: `1px solid ${running ? C.border : C.gold + "60"}`,
                  color: running ? C.textMuted : C.gold,
                  fontFamily: mono, fontSize: 9, padding: "5px 0",
                  borderRadius: 3,
                  cursor: running ? "not-allowed" : "pointer",
                  letterSpacing: "0.12em",
                }}
              >
                {running ? "◌ running…" : `▶ Run all (${totalToRun})`}
              </button>
            )}
          </div>

          {canRunAll && (
            <div style={{
              fontSize: 9, color: C.textMuted, fontFamily: mono,
              marginTop: 8, lineHeight: 1.6,
            }}>
              Runs current model spec on each subset + full sample.
              Results are auto-pinned to the buffer.
            </div>
          )}
        </div>
      )}
    </div>
  );
}
