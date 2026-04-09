// ─── ECON STUDIO · components/validation/AuditTrail.jsx ──────────────────────
// Full-screen overlay that displays the pipeline audit trail.
// Consumes the output of auditPipeline() from pipeline/auditor.js.
//
// Props:
//   trail        AuditTrail   — output of auditPipeline()
//   filename     string       — for the download filename
//   onClose()
//
// The parent (WranglingModule) is responsible for calling auditPipeline()
// and passing the result — this component is purely presentational.

import { useState, useMemo } from "react";
import { auditTrailToMarkdown } from "../../pipeline/auditor.js";

const C = {
  bg:"#080808", surface:"#0f0f0f", surface2:"#131313", surface3:"#161616",
  border:"#1c1c1c", border2:"#252525",
  gold:"#c8a96e", goldFaint:"#1a1408",
  text:"#ddd8cc", textDim:"#888", textMuted:"#444",
  green:"#7ab896", red:"#c47070", yellow:"#c8b46e",
  blue:"#6e9ec8", teal:"#6ec8b4", orange:"#c88e6e", purple:"#a87ec8",
  violet:"#9e7ec8",
};
const mono = "'IBM Plex Mono','JetBrains Mono',Consolas,monospace";

const CAT_COLOR = {
  cleaning: C.teal,
  features: C.green,
  reshape:  C.purple,
  merge:    C.blue,
  unknown:  C.textMuted,
};

const STATUS_COLOR  = { ok: C.green, noop: C.textMuted, error: C.red };
const STATUS_ICON   = { ok: "✓", noop: "—", error: "✗" };
const CAT_LABEL     = { cleaning: "Clean", features: "Feature", reshape: "Reshape", merge: "Merge", unknown: "?" };

function StatPill({ label, value, color = C.textDim }) {
  return (
    <div style={{
      display: "flex", flexDirection: "column", alignItems: "center",
      padding: "0.55rem 1.1rem",
      background: C.surface2, border: `1px solid ${C.border}`, borderRadius: 4,
      minWidth: 80,
    }}>
      <div style={{ fontSize: 18, color, fontFamily: mono, fontWeight: 600 }}>{value}</div>
      <div style={{ fontSize: 9, color: C.textMuted, letterSpacing: "0.18em", textTransform: "uppercase", marginTop: 3 }}>{label}</div>
    </div>
  );
}

function DeltaBadge({ value, positiveGood = false }) {
  if (value == null || value === 0) return null;
  const good  = positiveGood ? value > 0 : value < 0;
  const color = good ? C.green : (value === 0 ? C.textMuted : C.yellow);
  return (
    <span style={{ fontSize: 9, color, fontFamily: mono, marginLeft: 4 }}>
      ({value > 0 ? "+" : ""}{value})
    </span>
  );
}

// ─── FILTER BAR ───────────────────────────────────────────────────────────────
function FilterBar({ categories, filter, setFilter, statusFilter, setStatusFilter }) {
  const allCats = ["all", ...categories];
  const statuses = ["all", "ok", "noop", "error"];
  return (
    <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
      <div style={{ display: "flex", gap: 4 }}>
        {allCats.map(c => {
          const active = filter === c;
          const clr = c === "all" ? C.textDim : (CAT_COLOR[c] ?? C.textMuted);
          return (
            <button key={c} onClick={() => setFilter(c)}
              style={{
                padding: "3px 9px", borderRadius: 3, fontFamily: mono, fontSize: 9,
                border: `1px solid ${active ? clr : C.border2}`,
                background: active ? `${clr}18` : "transparent",
                color: active ? clr : C.textDim,
                cursor: "pointer", letterSpacing: "0.1em", transition: "all 0.1s",
              }}>
              {c === "all" ? "All" : CAT_LABEL[c] ?? c}
            </button>
          );
        })}
      </div>
      <div style={{ width: 1, height: 14, background: C.border }} />
      <div style={{ display: "flex", gap: 4 }}>
        {statuses.map(s => {
          const active = statusFilter === s;
          const clr = s === "all" ? C.textDim : (STATUS_COLOR[s] ?? C.textMuted);
          return (
            <button key={s} onClick={() => setStatusFilter(s)}
              style={{
                padding: "3px 9px", borderRadius: 3, fontFamily: mono, fontSize: 9,
                border: `1px solid ${active ? clr : C.border2}`,
                background: active ? `${clr}18` : "transparent",
                color: active ? clr : C.textDim,
                cursor: "pointer", transition: "all 0.1s",
              }}>
              {s === "all" ? "All status" : s}
            </button>
          );
        })}
      </div>
    </div>
  );
}

// ─── ENTRY CARD ───────────────────────────────────────────────────────────────
function EntryCard({ entry }) {
  const [expanded, setExpanded] = useState(false);
  const catClr  = CAT_COLOR[entry.category] ?? C.textMuted;
  const statClr = STATUS_COLOR[entry.status] ?? C.textMuted;

  const hasDelta = entry.rowsDelta !== 0
    || entry.colsAdded.length > 0
    || entry.colsRemoved.length > 0
    || (entry.nullsDelta != null && entry.nullsDelta !== 0);

  return (
    <div
      style={{
        border: `1px solid ${entry.status === "error" ? `${C.red}40` : C.border}`,
        borderLeft: `3px solid ${entry.status === "error" ? C.red : catClr}`,
        borderRadius: 4, marginBottom: 6, overflow: "hidden",
        background: entry.status === "error" ? "#0d0808" : C.surface,
      }}
    >
      {/* Header row */}
      <div
        onClick={() => setExpanded(e => !e)}
        style={{
          display: "flex", alignItems: "center", gap: 10,
          padding: "0.5rem 0.8rem", cursor: "pointer",
        }}
      >
        {/* Step number */}
        <span style={{ fontSize: 9, color: C.textMuted, fontFamily: mono, flexShrink: 0, minWidth: 22 }}>
          {entry.index + 1}
        </span>

        {/* Status icon */}
        <span style={{ fontSize: 11, color: statClr, flexShrink: 0, minWidth: 14 }}>
          {STATUS_ICON[entry.status] ?? "?"}
        </span>

        {/* Category badge */}
        <span style={{
          fontSize: 8, color: catClr, border: `1px solid ${catClr}40`,
          borderRadius: 2, padding: "1px 5px", fontFamily: mono,
          letterSpacing: "0.1em", flexShrink: 0,
        }}>
          {CAT_LABEL[entry.category] ?? entry.category}
        </span>

        {/* Label */}
        <span style={{ fontSize: 11, color: entry.status === "error" ? C.red : C.text, flex: 1, minWidth: 0 }}>
          {entry.label}
        </span>

        {/* Row delta */}
        {entry.rowsDelta !== 0 && (
          <span style={{ fontSize: 9, color: entry.rowsDelta < 0 ? C.yellow : C.teal, fontFamily: mono, flexShrink: 0 }}>
            {entry.rowsDelta > 0 ? "+" : ""}{entry.rowsDelta} rows
          </span>
        )}

        {/* Col added/removed */}
        {entry.colsAdded.length > 0 && (
          <span style={{ fontSize: 9, color: C.teal, fontFamily: mono, flexShrink: 0 }}>
            +{entry.colsAdded.length} col{entry.colsAdded.length > 1 ? "s" : ""}
          </span>
        )}
        {entry.colsRemoved.length > 0 && (
          <span style={{ fontSize: 9, color: C.yellow, fontFamily: mono, flexShrink: 0 }}>
            −{entry.colsRemoved.length} col{entry.colsRemoved.length > 1 ? "s" : ""}
          </span>
        )}

        {/* Duration */}
        <span style={{ fontSize: 9, color: C.textMuted, fontFamily: mono, flexShrink: 0, minWidth: 40, textAlign: "right" }}>
          {entry.durationMs}ms
        </span>

        {/* Expand toggle */}
        <span style={{ fontSize: 9, color: C.textMuted, flexShrink: 0 }}>
          {expanded ? "▲" : "▼"}
        </span>
      </div>

      {/* Decision text */}
      <div style={{ padding: "0 0.8rem 0.5rem 0.8rem", paddingLeft: "calc(0.8rem + 22px + 10px + 14px + 10px + 44px + 10px)" }}>
        <div style={{ fontSize: 10, color: entry.status === "error" ? C.red : C.textDim, fontFamily: mono, lineHeight: 1.65 }}>
          {entry.decision}
        </div>
      </div>

      {/* Expanded details */}
      {expanded && (
        <div style={{
          borderTop: `1px solid ${C.border}`, background: C.surface2,
          padding: "0.65rem 0.8rem",
          display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(180px, 1fr))", gap: 8,
        }}>
          <Detail label="Type"       value={entry.type} />
          <Detail label="Status"     value={entry.status} color={statClr} />
          <Detail label="Rows before/after" value={`${entry.rowsBefore.toLocaleString()} → ${entry.rowsAfter.toLocaleString()}`} />
          <Detail label="Cols before/after" value={`${entry.colsBefore} → ${entry.colsAfter}`} />
          {entry.colsAdded.length > 0 && <Detail label="Cols added"   value={entry.colsAdded.join(", ")} color={C.teal} />}
          {entry.colsRemoved.length > 0 && <Detail label="Cols removed" value={entry.colsRemoved.join(", ")} color={C.yellow} />}
          {entry.affectedCol && entry.nullsDelta != null && (
            <Detail
              label={`Nulls in "${entry.affectedCol}"`}
              value={`${entry.nullsBefore ?? "?"} → ${entry.nullsAfter ?? "?"}`}
              color={entry.nullsDelta < 0 ? C.green : entry.nullsDelta > 0 ? C.red : C.textDim}
            />
          )}
          <Detail label="Duration" value={`${entry.durationMs}ms`} />
          {entry.error && <Detail label="Error" value={entry.error} color={C.red} />}
        </div>
      )}
    </div>
  );
}

function Detail({ label, value, color = C.textDim }) {
  return (
    <div>
      <div style={{ fontSize: 8, color: C.textMuted, letterSpacing: "0.15em", textTransform: "uppercase", marginBottom: 2, fontFamily: mono }}>{label}</div>
      <div style={{ fontSize: 10, color, fontFamily: mono, wordBreak: "break-all" }}>{value}</div>
    </div>
  );
}

// ─── MAIN COMPONENT ───────────────────────────────────────────────────────────
export default function AuditTrail({ trail, filename = "analysis", onClose }) {
  const [filter,       setFilter]       = useState("all");
  const [statusFilter, setStatusFilter] = useState("all");
  const [markdownCopied, setMarkdownCopied] = useState(false);

  const { meta, entries } = trail;

  const categories = useMemo(() => [...new Set(entries.map(e => e.category))], [entries]);

  const filtered = useMemo(() => entries.filter(e => {
    if (filter !== "all"       && e.category !== filter) return false;
    if (statusFilter !== "all" && e.status   !== statusFilter) return false;
    return true;
  }), [entries, filter, statusFilter]);

  const markdown = useMemo(() => auditTrailToMarkdown(trail), [trail]);

  const downloadMarkdown = () => {
    const stem = filename.replace(/\.[^.]+$/, "");
    const blob = new Blob([markdown], { type: "text/markdown" });
    const a    = document.createElement("a");
    a.href     = URL.createObjectURL(blob);
    a.download = `${stem}_audit_trail.md`;
    a.click(); URL.revokeObjectURL(a.href);
  };

  const copyMarkdown = () => {
    navigator.clipboard.writeText(markdown).then(() => {
      setMarkdownCopied(true);
      setTimeout(() => setMarkdownCopied(false), 2000);
    });
  };

  return (
    <div style={{
      position: "fixed", inset: 0, zIndex: 300,
      background: "rgba(0,0,0,0.78)",
      display: "flex", alignItems: "stretch", justifyContent: "flex-end",
    }}>
      <div style={{
        width: "min(740px, 98vw)", height: "100%",
        background: C.bg, borderLeft: `1px solid ${C.border2}`,
        display: "flex", flexDirection: "column", overflow: "hidden",
        animation: "slideIn 0.22s ease",
      }}>

        {/* ── Header ── */}
        <div style={{
          display: "flex", alignItems: "center", gap: 12,
          padding: "0.85rem 1.2rem", background: C.surface,
          borderBottom: `1px solid ${C.border}`, flexShrink: 0,
        }}>
          <div style={{ fontSize: 10, color: C.teal, letterSpacing: "0.22em", textTransform: "uppercase" }}>
            Pipeline Audit Trail
          </div>
          <div style={{ fontSize: 10, color: C.textMuted }}>{filename}</div>
          <div style={{ flex: 1 }} />

          {/* Export buttons */}
          <button onClick={copyMarkdown}
            style={{ padding: "3px 10px", borderRadius: 3, fontFamily: mono, fontSize: 10,
                     border: `1px solid ${markdownCopied ? C.teal : C.border2}`,
                     background: markdownCopied ? `${C.teal}18` : "transparent",
                     color: markdownCopied ? C.teal : C.textDim, cursor: "pointer" }}>
            {markdownCopied ? "Copied ✓" : "Copy .md"}
          </button>
          <button onClick={downloadMarkdown}
            style={{ padding: "3px 10px", borderRadius: 3, fontFamily: mono, fontSize: 10,
                     border: `1px solid ${C.border2}`, background: "transparent",
                     color: C.textDim, cursor: "pointer" }}>
            ↓ audit_trail.md
          </button>
          <button onClick={onClose}
            style={{ background: "none", border: "none", cursor: "pointer",
                     color: C.textMuted, fontSize: 16, padding: "0 4px" }}>
            ×
          </button>
        </div>

        {/* ── Summary pills ── */}
        <div style={{
          display: "flex", gap: 8, padding: "0.85rem 1.2rem",
          background: C.surface2, borderBottom: `1px solid ${C.border}`,
          flexShrink: 0, overflowX: "auto",
        }}>
          <StatPill label="Raw rows"   value={meta.rawRows.toLocaleString()}   color={C.textDim} />
          <StatPill label="Final rows" value={meta.finalRows.toLocaleString()} color={meta.rowsRemoved > 0 ? C.yellow : C.green} />
          <StatPill label="Raw cols"   value={meta.rawCols}   color={C.textDim} />
          <StatPill label="Final cols" value={meta.finalCols} color={meta.colsAdded > 0 ? C.teal : C.textDim} />
          <div style={{ width: 1, background: C.border, flexShrink: 0, margin: "4px 4px" }} />
          <StatPill label="Applied" value={meta.stepsApplied} color={C.green} />
          <StatPill label="No-op"   value={meta.stepsNoop}   color={C.textMuted} />
          <StatPill label="Errors"  value={meta.stepsFailed} color={meta.stepsFailed > 0 ? C.red : C.textMuted} />
          {meta.rowsRemoved > 0 && <StatPill label="Rows removed" value={meta.rowsRemoved.toLocaleString()} color={C.yellow} />}
          {meta.rowsAdded   > 0 && <StatPill label="Rows added"   value={meta.rowsAdded.toLocaleString()}   color={C.teal} />}
        </div>

        {/* ── Filter bar ── */}
        <div style={{ padding: "0.6rem 1.2rem", borderBottom: `1px solid ${C.border}`, flexShrink: 0 }}>
          <FilterBar
            categories={categories}
            filter={filter} setFilter={setFilter}
            statusFilter={statusFilter} setStatusFilter={setStatusFilter}
          />
        </div>

        {/* ── Entry list ── */}
        <div style={{ flex: 1, overflowY: "auto", padding: "0.85rem 1.2rem" }}>
          {filtered.length === 0 && (
            <div style={{ fontSize: 11, color: C.textMuted, fontFamily: mono, textAlign: "center", marginTop: "3rem" }}>
              No steps match the current filter.
            </div>
          )}
          {filtered.map(entry => (
            <EntryCard key={entry.index} entry={entry} />
          ))}

          {/* Empty pipeline state */}
          {entries.length === 0 && (
            <div style={{ fontSize: 11, color: C.textMuted, fontFamily: mono, textAlign: "center", marginTop: "3rem" }}>
              No pipeline steps — apply at least one step in Wrangling to generate an audit trail.
            </div>
          )}
        </div>
      </div>

      <style>{`@keyframes slideIn { from { opacity:0; transform:translateX(32px); } to { opacity:1; transform:translateX(0); } }`}</style>
    </div>
  );
}
