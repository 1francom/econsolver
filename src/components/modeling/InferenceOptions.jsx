// ─── ECON STUDIO · src/components/modeling/InferenceOptions.jsx ──────────────
// Collapsible panel for robust / clustered / HAC standard error options.
// Rendered in the left spec sidebar of ModelingTab, immediately below
// ModelConfiguration and above the Estimate button.
//
// Props:
//   modelType    {string}   — current estimator (OLS, FE, FD, 2SLS, DiD, TWFE, RDD, …)
//   headers      {string[]} — all column names (for cluster dropdown)
//   seType       {string}   — one of: classical | hc1 | hc3 | clustered | twoway | hac
//   setSeType    {fn}
//   clusterVar   {string|null}
//   setClusterVar {fn}
//   clusterVar2  {string|null}
//   setClusterVar2 {fn}
//   maxLag       {string|null}  — stored as string for <input>, null = auto
//   setMaxLag    {fn}

import { useState } from "react";
import { useTheme, mono, Chip } from "./shared.jsx";

// ─── SE type definitions ──────────────────────────────────────────────────────
const SE_TYPES = [
  { id: "classical", label: "Classical",     hint: "Homoskedastic OLS standard errors (default)" },
  { id: "hc1",       label: "HC1 (Robust)",  hint: "MacKinnon-White HC1 heteroskedasticity-robust SE — most common robust option" },
  { id: "hc3",       label: "HC3",           hint: "HC3 leverage-corrected robust SE — preferred in small samples" },
  { id: "clustered", label: "Clustered",     hint: "Cluster-robust SE: accounts for within-group correlation" },
  { id: "twoway",    label: "Two-Way",       hint: "Two-way cluster-robust SE (Cameron-Gelbach-Miller)" },
  { id: "hac",       label: "HAC",           hint: "Newey-West heteroskedasticity-and-autocorrelation-consistent SE" },
];

// Models where HAC makes sense (time series / panel)
const HAC_COMPATIBLE = new Set(["FE", "FD", "TWFE", "DiD", "OLS"]);

// ─── Small styled select ──────────────────────────────────────────────────────
function ColSelect({ value, onChange, options, placeholder }) {
  const { C } = useTheme();
  return (
    <select
      value={value ?? ""}
      onChange={e => onChange(e.target.value || null)}
      style={{
        width: "100%",
        background: C.surface2,
        border: `1px solid ${C.border2}`,
        color: value ? C.text : C.textMuted,
        padding: "0.38rem 0.6rem",
        fontFamily: mono,
        fontSize: 11,
        borderRadius: 3,
        outline: "none",
        cursor: "pointer",
        marginTop: 5,
      }}
    >
      <option value="">{placeholder}</option>
      {options.map(h => (
        <option key={h} value={h}>{h}</option>
      ))}
    </select>
  );
}

// ─── MAIN EXPORT ─────────────────────────────────────────────────────────────
export default function InferenceOptions({
  modelType,
  headers,
  seType,
  setSeType,
  clusterVar,
  setClusterVar,
  clusterVar2,
  setClusterVar2,
  maxLag,
  setMaxLag,
}) {
  const { C } = useTheme();
  const [open, setOpen] = useState(false);

  const hacDisabled = !HAC_COMPATIBLE.has(modelType);

  // Badge label for the collapsed state
  const badgeLabel = seType === "classical"
    ? null
    : SE_TYPES.find(s => s.id === seType)?.label ?? seType;

  const showCluster  = seType === "clustered" || seType === "twoway";
  const showCluster2 = seType === "twoway";
  const showHac      = seType === "hac";

  // ── Container ─────────────────────────────────────────────────────────────
  return (
    <div style={{
      marginBottom: "1rem",
      border: `1px solid ${open ? C.border2 : C.border}`,
      borderRadius: 4,
      overflow: "hidden",
      transition: "border-color 0.15s",
    }}>
      {/* ── Header / toggle ── */}
      <button
        onClick={() => setOpen(o => !o)}
        style={{
          width: "100%",
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          padding: "0.45rem 0.75rem",
          background: open ? C.surface2 : C.surface,
          border: "none",
          cursor: "pointer",
          fontFamily: mono,
          transition: "background 0.12s",
        }}
      >
        <span style={{ fontSize: 9, color: C.textMuted, letterSpacing: "0.22em", textTransform: "uppercase" }}>
          Standard Errors
        </span>
        <span style={{ display: "flex", alignItems: "center", gap: 6 }}>
          {!open && badgeLabel && (
            <span style={{
              fontSize: 9, padding: "1px 6px",
              border: `1px solid ${C.gold}`,
              color: C.gold, borderRadius: 2,
              letterSpacing: "0.08em", fontFamily: mono,
            }}>
              {badgeLabel}
            </span>
          )}
          <span style={{ fontSize: 10, color: C.textMuted }}>
            {open ? "▲" : "▼"}
          </span>
        </span>
      </button>

      {/* ── Expanded content ── */}
      {open && (
        <div style={{ padding: "0.75rem", background: C.surface, borderTop: `1px solid ${C.border}` }}>

          {/* SE type chips */}
          <div style={{ fontSize: 9, color: C.textMuted, letterSpacing: "0.2em", textTransform: "uppercase", marginBottom: 6 }}>
            SE Type
          </div>
          <div style={{ display: "flex", flexWrap: "wrap", gap: 4, marginBottom: 10 }}>
            {SE_TYPES.map(({ id, label, hint }) => {
              const disabled = id === "hac" && hacDisabled;
              return (
                <Chip
                  key={id}
                  label={label}
                  selected={seType === id}
                  color={C.gold}
                  onClick={() => !disabled && setSeType(id)}
                  disabled={disabled}
                  title={disabled ? "HAC requires a time-series or panel estimator" : hint}
                />
              );
            })}
          </div>

          {/* Cluster variable */}
          {showCluster && (
            <div style={{ marginBottom: 8 }}>
              <div style={{ fontSize: 9, color: C.textMuted, letterSpacing: "0.2em", textTransform: "uppercase" }}>
                Cluster Variable
              </div>
              <ColSelect
                value={clusterVar}
                onChange={setClusterVar}
                options={headers}
                placeholder="— select column —"
              />
            </div>
          )}

          {/* Second cluster (two-way) */}
          {showCluster2 && (
            <div style={{ marginBottom: 8 }}>
              <div style={{ fontSize: 9, color: C.textMuted, letterSpacing: "0.2em", textTransform: "uppercase" }}>
                Second Cluster Variable
              </div>
              <ColSelect
                value={clusterVar2}
                onChange={setClusterVar2}
                options={headers.filter(h => h !== clusterVar)}
                placeholder="— select column —"
              />
            </div>
          )}

          {/* Max lag for HAC */}
          {showHac && (
            <div style={{ marginBottom: 4 }}>
              <div style={{ fontSize: 9, color: C.textMuted, letterSpacing: "0.2em", textTransform: "uppercase", marginBottom: 5 }}>
                Max Lag
              </div>
              <input
                type="number"
                min={1}
                step={1}
                value={maxLag ?? ""}
                onChange={e => setMaxLag(e.target.value || null)}
                placeholder="auto"
                style={{
                  width: "100%",
                  background: C.surface2,
                  border: `1px solid ${C.border2}`,
                  color: C.text,
                  padding: "0.38rem 0.6rem",
                  fontFamily: mono,
                  fontSize: 11,
                  borderRadius: 3,
                  outline: "none",
                  boxSizing: "border-box",
                }}
              />
              <div style={{ fontSize: 9, color: C.textMuted, marginTop: 4, fontFamily: mono }}>
                Auto = 4(n/100)^(2/9) — leave blank for automatic selection
              </div>
            </div>
          )}

          {/* Active SE description */}
          <div style={{ marginTop: 8, fontSize: 9, color: C.textMuted, fontFamily: mono, lineHeight: 1.6 }}>
            {SE_TYPES.find(s => s.id === seType)?.hint}
          </div>
        </div>
      )}
    </div>
  );
}
