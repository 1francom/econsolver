// ─── ECON STUDIO · components/PrivacyConfigPanel.jsx ─────────────────────────
// Privacy configuration UI. Shown before any API call that involves column
// names or sample data.
//
// Props:
//   headers       string[]
//   sampleRows    Record<string,any>[]    (3–5 rows, for value preview)
//   piiConfig     Record<string, PiiEntry>     (controlled by parent)
//   onChange      (col: string, patch: Partial<PiiEntry>) => void
//   onConfirm     () => void              (user approves egress)
//   onCancel      () => void
//
// PiiEntry: { sensitivity: string, suppress: boolean, alias?: string }
//
// This component is display-only — all logic lives in services/privacy/.

import { useMemo } from "react";
import { PII_SENSITIVITY }  from "../services/privacy/piiDetector.js";
import { buildEgressReport } from "../services/privacy/privacyFilter.js";
import { maskStringValue }   from "../services/privacy/anonymizer.js";

// ─── THEME (mirrors WranglingModule shared constants) ─────────────────────────
const mono = "'IBM Plex Mono', 'Fira Mono', monospace";
const C = {
  bg:       "#0b0b0f",
  surface:  "#111118",
  surface2: "#16161f",
  border:   "#1e1e2e",
  border2:  "#252535",
  text:     "#e8e8f0",
  textDim:  "#9090a8",
  textMuted:"#5a5a72",
  teal:     "#4ec9b0",
  gold:     "#dbb26a",
  red:      "#e06c75",
  orange:   "#ce9178",
  yellow:   "#e5c07b",
  green:    "#98c379",
  blue:     "#61afef",
  violet:   "#c678dd",
  purple:   "#9a7fd4",
};

// ─── SENSITIVITY PALETTE ──────────────────────────────────────────────────────
const SENS_COLOR = {
  [PII_SENSITIVITY.HIGH]:   C.red,
  [PII_SENSITIVITY.MEDIUM]: C.yellow,
  [PII_SENSITIVITY.LOW]:    C.blue,
  [PII_SENSITIVITY.NONE]:   C.textMuted,
};
const SENS_LABEL = {
  [PII_SENSITIVITY.HIGH]:   "HIGH",
  [PII_SENSITIVITY.MEDIUM]: "MEDIUM",
  [PII_SENSITIVITY.LOW]:    "LOW",
  [PII_SENSITIVITY.NONE]:   "NONE",
};

// ─── MICRO COMPONENTS ─────────────────────────────────────────────────────────
function Btn({ onClick, disabled, color, solid, children, sm }) {
  const base = {
    padding:     sm ? "0.22rem 0.55rem" : "0.32rem 0.75rem",
    borderRadius: 3,
    cursor:      disabled ? "not-allowed" : "pointer",
    fontFamily:  mono,
    fontSize:    sm ? 10 : 11,
    border:      `1px solid ${color ?? C.border2}`,
    background:  solid ? (color ?? C.teal) : "transparent",
    color:       solid ? C.bg : (color ?? C.textDim),
    opacity:     disabled ? 0.45 : 1,
    transition:  "opacity 0.1s",
  };
  return <button onClick={disabled ? undefined : onClick} style={base}>{children}</button>;
}

function Badge({ sensitivity }) {
  const color = SENS_COLOR[sensitivity] ?? C.textMuted;
  return (
    <span style={{
      fontSize: 8, letterSpacing: "0.15em", textTransform: "uppercase",
      padding: "2px 6px", border: `1px solid ${color}`, borderRadius: 2,
      color, fontFamily: mono,
    }}>
      {SENS_LABEL[sensitivity] ?? "UNKNOWN"}
    </span>
  );
}

function SectionHead({ children }) {
  return (
    <div style={{
      fontSize: 9, color: C.teal, letterSpacing: "0.24em",
      textTransform: "uppercase", fontFamily: mono,
      padding: "0.5rem 1rem", background: C.surface,
      borderBottom: `1px solid ${C.border}`,
    }}>
      {children}
    </div>
  );
}

// ─── COLUMN ROW ───────────────────────────────────────────────────────────────
function ColumnRow({ col, entry, sampleValues, onChange }) {
  const { sensitivity, suppress, alias = "", reasons = [] } = entry;
  const color = SENS_COLOR[sensitivity] ?? C.textMuted;
  const isHigh = sensitivity === PII_SENSITIVITY.HIGH;

  return (
    <div style={{
      display: "grid",
      gridTemplateColumns: "180px 90px 110px 1fr 130px",
      alignItems: "center",
      gap: 12,
      padding: "0.5rem 1rem",
      borderBottom: `1px solid ${C.border}`,
      borderLeft: `3px solid ${suppress || isHigh ? C.red : color}`,
      background: suppress ? "#140808" : C.bg,
    }}>
      {/* Column name */}
      <div style={{ fontFamily: mono, fontSize: 11, color: C.text, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
        {col}
        {reasons.length > 0 && (
          <div style={{ fontSize: 9, color: C.textMuted, marginTop: 2 }}>
            {reasons.slice(0, 2).join(" · ")}
          </div>
        )}
      </div>

      {/* Badge */}
      <div><Badge sensitivity={sensitivity} /></div>

      {/* Suppress toggle */}
      <div>
        <label style={{ display: "flex", alignItems: "center", gap: 6, cursor: "pointer" }}>
          <input
            type="checkbox"
            checked={suppress}
            onChange={e => onChange(col, { suppress: e.target.checked })}
            style={{ accentColor: C.red }}
          />
          <span style={{ fontFamily: mono, fontSize: 10, color: suppress ? C.red : C.textDim }}>
            Suppress
          </span>
        </label>
      </div>

      {/* Alias input */}
      <div>
        {!suppress && (
          <input
            value={alias}
            placeholder={`var_${col.toLowerCase().replace(/[^a-z0-9]/g, "_")}`}
            onChange={e => onChange(col, { alias: e.target.value })}
            style={{
              width: "100%", boxSizing: "border-box",
              padding: "0.25rem 0.45rem",
              background: C.surface2, border: `1px solid ${C.border2}`,
              borderRadius: 3, color: C.text, fontFamily: mono, fontSize: 10,
              outline: "none",
            }}
          />
        )}
      </div>

      {/* Sample values */}
      <div style={{ display: "flex", gap: 4, flexWrap: "wrap" }}>
        {sampleValues.slice(0, 3).map((v, i) => {
          const display = suppress
            ? "█████"
            : (sensitivity === PII_SENSITIVITY.HIGH
               ? maskStringValue(v)
               : String(v ?? "—"));
          return (
            <span key={i} style={{
              fontSize: 9, fontFamily: mono, color: C.textMuted,
              padding: "1px 5px", border: `1px solid ${C.border}`,
              borderRadius: 2, whiteSpace: "nowrap",
            }}>
              {display}
            </span>
          );
        })}
      </div>
    </div>
  );
}

// ─── EGRESS SUMMARY BAR ───────────────────────────────────────────────────────
function EgressBar({ report }) {
  return (
    <div style={{
      padding: "0.55rem 1rem",
      background: C.surface2,
      borderBottom: `1px solid ${C.border}`,
      display: "flex", gap: 16, alignItems: "center",
    }}>
      <span style={{ fontSize: 9, color: C.textMuted, fontFamily: mono, letterSpacing: "0.1em", textTransform: "uppercase" }}>
        Egress preview
      </span>
      {report.safe.length > 0 && (
        <span style={{ fontSize: 10, fontFamily: mono, color: C.green }}>
          ✓ {report.safe.length} safe
        </span>
      )}
      {report.aliased.length > 0 && (
        <span style={{ fontSize: 10, fontFamily: mono, color: C.yellow }}>
          ◈ {report.aliased.length} aliased
        </span>
      )}
      {report.suppressed.length > 0 && (
        <span style={{ fontSize: 10, fontFamily: mono, color: C.red }}>
          ✕ {report.suppressed.length} suppressed
        </span>
      )}
    </div>
  );
}

// ─── ROOT COMPONENT ───────────────────────────────────────────────────────────
export default function PrivacyConfigPanel({
  headers = [],
  sampleRows = [],
  piiConfig = {},
  onChange,
  onConfirm,
  onCancel,
}) {
  const report = useMemo(
    () => buildEgressReport(headers, piiConfig),
    [headers, piiConfig]
  );

  // Build sample value arrays per column (for display)
  const sampleValues = useMemo(() => {
    const out = {};
    headers.forEach(col => {
      out[col] = sampleRows.map(r => r[col]).filter(v => v != null).slice(0, 3);
    });
    return out;
  }, [headers, sampleRows]);

  // Split into PII and non-PII groups for display
  const piiCols  = headers.filter(h => piiConfig[h]?.sensitivity !== PII_SENSITIVITY.NONE);
  const safeCols = headers.filter(h => piiConfig[h]?.sensitivity === PII_SENSITIVITY.NONE);

  return (
    <div style={{
      background: C.bg, color: C.text, fontFamily: mono,
      border: `1px solid ${C.border}`, borderRadius: 4,
      overflow: "hidden", display: "flex", flexDirection: "column",
      maxHeight: "80vh",
    }}>
      {/* Header */}
      <div style={{
        padding: "0.75rem 1rem",
        borderBottom: `1px solid ${C.border}`,
        background: C.surface,
        display: "flex", alignItems: "center", gap: 12,
      }}>
        <div style={{ flex: 1 }}>
          <div style={{ fontSize: 9, color: C.red, letterSpacing: "0.24em", textTransform: "uppercase", marginBottom: 2 }}>
            Datenschutz · Privacy Review
          </div>
          <div style={{ fontSize: 13, color: C.text }}>
            Review what will be sent to external API
          </div>
          <div style={{ fontSize: 10, color: C.textDim, marginTop: 2 }}>
            Columns marked HIGH are suppressed by default. Adjust aliases or suppress additional columns before confirming.
          </div>
        </div>
      </div>

      {/* Egress summary */}
      <EgressBar report={report} />

      {/* Column table header */}
      <div style={{
        display: "grid",
        gridTemplateColumns: "180px 90px 110px 1fr 130px",
        gap: 12, padding: "0.35rem 1rem",
        background: C.surface2,
        borderBottom: `1px solid ${C.border}`,
      }}>
        {["Column", "Risk", "Action", "Alias (sent to API)", "Sample values"].map(h => (
          <span key={h} style={{ fontSize: 9, color: C.textMuted, letterSpacing: "0.1em", textTransform: "uppercase" }}>{h}</span>
        ))}
      </div>

      {/* Scrollable column list */}
      <div style={{ overflowY: "auto", flex: 1 }}>
        {piiCols.length > 0 && (
          <>
            <SectionHead>⚠ Detected PII or quasi-identifiers</SectionHead>
            {piiCols.map(col => (
              <ColumnRow
                key={col}
                col={col}
                entry={piiConfig[col] ?? { sensitivity: PII_SENSITIVITY.NONE, suppress: false }}
                sampleValues={sampleValues[col] ?? []}
                onChange={onChange}
              />
            ))}
          </>
        )}

        {safeCols.length > 0 && (
          <>
            <SectionHead>✓ Safe columns — no PII detected</SectionHead>
            {safeCols.map(col => (
              <ColumnRow
                key={col}
                col={col}
                entry={piiConfig[col] ?? { sensitivity: PII_SENSITIVITY.NONE, suppress: false }}
                sampleValues={sampleValues[col] ?? []}
                onChange={onChange}
              />
            ))}
          </>
        )}
      </div>

      {/* Footer actions */}
      <div style={{
        padding: "0.65rem 1rem",
        borderTop: `1px solid ${C.border}`,
        background: C.surface,
        display: "flex", gap: 8, justifyContent: "flex-end", alignItems: "center",
      }}>
        <span style={{ flex: 1, fontSize: 10, color: C.textMuted }}>
          {report.summary}
        </span>
        <Btn onClick={onCancel} color={C.textDim}>Cancel</Btn>
        <Btn onClick={onConfirm} color={C.gold} solid>
          Confirm & Send →
        </Btn>
      </div>
    </div>
  );
}
