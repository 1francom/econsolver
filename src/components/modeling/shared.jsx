// ─── ECON STUDIO · src/components/modeling/shared.jsx ───────────────────────
// Theme hook + micro-UI atoms shared across all Modeling sub-components.

import { useState, useEffect } from "react";
import { useTheme } from "../../ThemeContext.jsx";
import { getDistinctValues } from "../../services/data/duckdb.js";
import { jsDistinctValues } from "../../services/data/distinctValuesFallback.js";

// Re-export so consumers can import from one place.
export { useTheme };

// NOTE: this module used to also export `DARK as C` and a static `mono` string.
// Both are gone deliberately. They were snapshots of the dark palette / default
// mono stack, so any component using them silently ignored the active theme and
// the user's font choice — a light-mode component reading that `C` would have
// rendered dark-palette colours on a white ground. Use `useTheme()` and read
// `C.*` / `T.code.fontFamily` / `T.data.fontFamily` instead.

// ─── ATOMS ────────────────────────────────────────────────────────────────────

export function Lbl({ children, color }) {
  const { C, T } = useTheme();
  return (
    <div style={{
      fontSize: T.caption.fontSize, color: color ?? C.textMuted,
      letterSpacing: "0.22em", textTransform: "uppercase",
      marginBottom: 8, fontFamily: T.label.fontFamily,
    }}>
      {children}
    </div>
  );
}

export function Badge({ label, color }) {
  const { T } = useTheme();
  return (
    <span style={{
      fontSize: T.caption.fontSize, padding: "2px 7px",
      border: `1px solid ${color}`, color,
      borderRadius: 2, letterSpacing: "0.1em", fontFamily: T.label.fontFamily,
    }}>
      {label}
    </span>
  );
}

// `refLabel`, when set, replaces the bare "f" badge with e.g. "f: 2020" — the
// chosen reference category is legible without opening the popover, same
// spirit as the chip's own `selected` state needing no tooltip. `onFactor`'s
// CLICK BEHAVIOR (toggle vs. open a reference popover) is the caller's
// decision — Chip only renders what it's given; see VarPanel/FEColumnPicker
// for where that branch actually lives.
export function Chip({ label, selected, color, onClick, disabled, title, factored, onFactor, refLabel }) {
  const { C, T } = useTheme();
  const showF = onFactor !== undefined;
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      title={title}
      style={{
        padding: showF ? "0.35rem 0.5rem 0.35rem 0.8rem" : "0.35rem 0.8rem",
        border: `1px solid ${selected ? color : C.border2}`,
        background: selected ? `${color}1a` : "transparent",
        color: selected ? color : disabled ? C.textMuted : C.textDim,
        borderRadius: 3, cursor: disabled ? "not-allowed" : "pointer",
        fontSize: T.code.fontSize, fontFamily: T.body.fontFamily, transition: "all 0.12s",
        opacity: disabled ? 0.45 : 1,
        display: "inline-flex", alignItems: "center", gap: 0, position: "relative",
      }}
    >
      <span>{selected ? "✓ " : ""}{label}</span>
      {showF && (
        <span
          onClick={e => { e.stopPropagation(); onFactor(); }}
          title={factored ? (refLabel ? `Reference: ${refLabel} — click to change` : "Choose reference category") : "Treat as factor (categorical)"}
          style={{
            marginLeft: 5,
            paddingLeft: 5,
            borderLeft: `1px solid ${selected ? `${color}50` : C.border2}`,
            color: factored ? C.gold : C.textMuted,
            fontSize: T.caption.fontSize,
            fontWeight: factored ? "bold" : "normal",
            cursor: "pointer",
            lineHeight: 1,
            whiteSpace: "nowrap",
          }}
        >
          {refLabel ? `f: ${refLabel}` : "f"}
        </span>
      )}
    </button>
  );
}

// ─── FACTOR REFERENCE POPOVER ──────────────────────────────────────────────────
// Opens off a Chip's "f" badge for an already-factored variable. Lists that
// column's distinct levels (full table via DuckDB when available, JS fallback
// otherwise — same "display limit ≠ computation limit" pattern the autofilter
// and country_code preview already use) so the user can pick which one is
// omitted as the reference category. Purely presentational + its own fetch;
// callers (VarPanel, FEColumnPicker) own the open/closed state and where the
// choice is written back to (factorRefs).
//
// `onRemoveFactor`, when passed, renders a "Remove factor encoding" action —
// VarPanel's X/W chips can be un-factored, FEColumnPicker's LSDV chips can't
// (an FE dimension is always dummy-expanded; the picker's own selection is
// what turns it on/off), so FEColumnPicker simply omits this prop.
export function FactorReferencePopover({ col, rows, duckdbTableName, currentRef, onSelect, onRemoveFactor, onClose, color }) {
  const { C, T } = useTheme();
  const [data, setData]   = useState(null); // { values:[{value,count}], total }
  const [error, setError] = useState("");

  useEffect(() => {
    let cancelled = false;
    setData(null); setError("");
    (async () => {
      try {
        const d = duckdbTableName
          ? await getDistinctValues(duckdbTableName, col)
          : jsDistinctValues(rows ?? [], col);
        if (!cancelled) setData(d);
      } catch (e) {
        if (!cancelled) setError(e?.message ?? "Could not read this column's values.");
      }
    })();
    return () => { cancelled = true; };
  }, [col, duckdbTableName]); // eslint-disable-line react-hooks/exhaustive-deps

  const rowStyle = (active) => ({
    display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8,
    width: "100%", textAlign: "left", padding: "0.28rem 0.6rem", borderRadius: 3,
    border: `1px solid ${active ? color : "transparent"}`,
    background: active ? `${color}18` : "transparent",
    color: active ? color : C.textDim,
    cursor: "pointer", fontFamily: T.code.fontFamily, fontSize: T.caption.fontSize,
  });

  return (
    <div onClick={e => e.stopPropagation()}
      style={{
        position: "absolute", top: "100%", left: 0, marginTop: 3, zIndex: 60, minWidth: 200, maxWidth: 260,
        background: C.bg, border: `1px solid ${C.border2}`, borderRadius: 4,
        boxShadow: "0 8px 28px #000a", fontFamily: T.code.fontFamily, textAlign: "left",
      }}>
      <div style={{ padding: "0.4rem 0.6rem", borderBottom: `1px solid ${C.border}`, fontSize: T.caption.fontSize, color: C.textMuted, letterSpacing: "0.1em", textTransform: "uppercase" }}>
        Reference category
      </div>
      <div style={{ maxHeight: 220, overflowY: "auto", padding: "0.3rem" }}>
        <button onClick={() => onSelect(null)} style={rowStyle(!currentRef)}>
          <span>Auto (first level)</span>
        </button>
        {!data && !error && (
          <div style={{ padding: "0.4rem 0.6rem", fontSize: T.caption.fontSize, color: C.textMuted }}>Reading values…</div>
        )}
        {error && <div style={{ padding: "0.4rem 0.6rem", fontSize: T.caption.fontSize, color: C.red }}>{error}</div>}
        {data?.values.map(({ value, count }) => (
          <button key={String(value)} onClick={() => onSelect(String(value))} style={rowStyle(currentRef === String(value))}>
            <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{String(value)}</span>
            <span style={{ color: C.textMuted, flexShrink: 0 }}>{count}</span>
          </button>
        ))}
      </div>
      <div style={{ display: "flex", borderTop: `1px solid ${C.border}` }}>
        {onRemoveFactor && (
          <button onClick={onRemoveFactor} style={{ flex: 1, padding: "0.35rem 0", background: "none", border: "none", borderRight: `1px solid ${C.border}`, color: C.textMuted, cursor: "pointer", fontFamily: T.code.fontFamily, fontSize: T.caption.fontSize }}>
            Remove factor
          </button>
        )}
        <button onClick={onClose} style={{ flex: 1, padding: "0.35rem 0", background: "none", border: "none", color: C.textMuted, cursor: "pointer", fontFamily: T.code.fontFamily, fontSize: T.caption.fontSize }}>
          Close
        </button>
      </div>
    </div>
  );
}

export function ModelBtn({ model, selected, disabled, onClick, color, hint }) {
  const { C, T } = useTheme();
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      title={disabled ? hint : ""}
      style={{
        padding: "0.7rem 1rem",
        border: `1px solid ${selected ? color : C.border}`,
        background: selected ? `${color}12` : C.surface,
        color: selected ? color : disabled ? C.textMuted : C.textDim,
        borderRadius: 4, cursor: disabled ? "not-allowed" : "pointer",
        fontSize: T.code.fontSize, fontFamily: T.body.fontFamily, opacity: disabled ? 0.4 : 1,
        transition: "all 0.13s", textAlign: "left",
        display: "flex", alignItems: "center", gap: 8,
      }}
    >
      {disabled && <span style={{ fontSize: T.caption.fontSize }}>🔒</span>}
      {selected && <span style={{ color }}>●</span>}
      {model}
    </button>
  );
}

// `collapsible` turns the label into a disclosure header. `defaultOpen` is only
// read on mount (it seeds useState), which is deliberate: callers pass a value
// derived from their data, and re-syncing it on every render would collapse the
// section under the user mid-interaction. Do not "fix" it into a useEffect.
export function Section({ title, children, color, collapsible = false, defaultOpen = true }) {
  const { C, T } = useTheme();
  const [open, setOpen] = useState(defaultOpen);

  if (!collapsible) {
    return (
      <div style={{ marginBottom: "1.4rem" }}>
        <Lbl color={color ?? C.textMuted}>{title}</Lbl>
        {children}
      </div>
    );
  }

  return (
    // Collapsed sections tighten their bottom margin — the point of collapsing
    // here is reclaiming sidebar height, so the gap shrinks with the content.
    <div style={{ marginBottom: open ? "1.4rem" : "0.5rem" }}>
      <button
        onClick={() => setOpen(o => !o)}
        title={open ? "Collapse" : "Expand"}
        style={{
          display: "flex", alignItems: "baseline", gap: 6, width: "100%",
          background: "transparent", border: "none", padding: 0,
          cursor: "pointer", textAlign: "left",
        }}
      >
        <span style={{
          fontSize: T.caption.fontSize, color: color ?? C.textMuted,
          lineHeight: 1, flexShrink: 0,
        }}>
          {open ? "▾" : "▸"}
        </span>
        <Lbl color={color ?? C.textMuted}>{title}</Lbl>
      </button>
      {open && children}
    </div>
  );
}

export function InfoBox({ children, color, bg }) {
  const { C, T } = useTheme();
  const col = color ?? C.blue;
  return (
    <div style={{
      padding: "0.65rem 0.9rem",
      background: bg || `${col}08`,
      border: `1px solid ${col}30`,
      borderLeft: `3px solid ${col}`,
      borderRadius: 4, fontSize: T.code.fontSize,
      color: C.textDim, lineHeight: 1.7,
      fontFamily: T.body.fontFamily, marginBottom: "1rem",
    }}>
      {children}
    </div>
  );
}

// ─── VAR PANEL ────────────────────────────────────────────────────────────────
// factorRefs/onSetFactorRef/rows/duckdbTableName are all optional — a caller
// that doesn't pass onSetFactorRef gets the pre-2026-08-16 behavior exactly
// (onFactor always just toggles), since the popover only ever opens through
// the branch guarded by onSetFactorRef below.
export function VarPanel({ title, color, vars, selected, onToggle, multi = true, info, factorVars, onToggleFactor, factorRefs, onSetFactorRef, rows, duckdbTableName }) {
  const { C, T } = useTheme();
  const [openRefFor, setOpenRefFor] = useState(null);
  return (
    <Section
      title={`${title} — ${selected.length > 0 ? selected.join(", ") : "none"}`}
      color={color}
      collapsible
      // Already-configured panels start folded; an empty one stays open so the
      // first selection still invites a click. Mount-time only (see Section).
      defaultOpen={selected.length === 0}
    >
      {info && (
        <div style={{ fontSize: T.caption.fontSize, color: C.textMuted, fontFamily: T.body.fontFamily, marginBottom: 6 }}>
          {info}
        </div>
      )}
      <div style={{ display: "flex", flexWrap: "wrap", gap: 5 }}>
        {vars.map(v => {
          const isFactored = factorVars ? factorVars.has(v) : false;
          return (
            <div key={v} style={{ position: "relative" }}>
              <Chip
                label={v}
                selected={selected.includes(v)}
                color={color}
                onClick={() => {
                  if (!multi) {
                    onToggle(selected.includes(v) ? [] : [v]);
                  } else {
                    onToggle(
                      selected.includes(v)
                        ? selected.filter(x => x !== v)
                        : [...selected, v]
                    );
                  }
                }}
                factored={factorVars ? isFactored : undefined}
                refLabel={isFactored ? factorRefs?.[v] : undefined}
                onFactor={onToggleFactor ? () => {
                  // Already a factor + we have somewhere to write a reference
                  // → open the picker instead of un-factoring. Not-yet-factored
                  // (or no onSetFactorRef passed at all) → the original toggle.
                  if (isFactored && onSetFactorRef) setOpenRefFor(v);
                  else onToggleFactor(v);
                } : undefined}
              />
              {openRefFor === v && (
                <FactorReferencePopover
                  col={v}
                  rows={rows}
                  duckdbTableName={duckdbTableName}
                  currentRef={factorRefs?.[v] ?? null}
                  color={color}
                  onSelect={ref => { onSetFactorRef(v, ref); setOpenRefFor(null); }}
                  onRemoveFactor={() => { onToggleFactor(v); setOpenRefFor(null); }}
                  onClose={() => setOpenRefFor(null)}
                />
              )}
            </div>
          );
        })}
      </div>
    </Section>
  );
}
