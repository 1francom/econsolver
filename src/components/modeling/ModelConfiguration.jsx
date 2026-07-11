// ─── ECON STUDIO · src/components/modeling/ModelConfiguration.jsx ─────────────
// Model-specific configuration panels rendered below the common variable selectors.
// Each estimator shows only its own relevant controls.
//
// Covered:
//   2SLS  → Z · Instruments (excluded)
//   DiD   → Treated Column, Post Column, W Controls
//   TWFE  → Treatment Column (time-varying), W Controls
//   RDD   → Running Variable, Cutoff, Bandwidth (IK / manual), Kernel
//   OLS / FE / FD → no extra config (renders nothing)
//
// Props:
//   model        {string}
//   numericCols  {string[]}
//   yVar         {string[]}
//   xVars        {string[]}
//   wVars        {string[]}  setWVars {fn}
//   zVars        {string[]}  setZVars {fn}   – 2SLS instruments
//   treatVar     {string[]}  setTreatVar {fn}
//   postVar      {string[]}  setPostVar  {fn}
//   runningVar   {string[]}  setRunningVar {fn}
//   cutoff       {string}    setCutoff {fn}
//   bwMode       {"ik"|"manual"} setBwMode {fn}
//   bwManual     {string}    setBwManual {fn}
//   kernel       {string}    setKernel {fn}

import { useMemo, useState } from "react";
import { VarPanel, Section, Chip, useTheme } from "./shared.jsx";

const inputStyle = (C, T) => ({
  width: "100%",
  background: C.surface2,
  border: `1px solid ${C.border2}`,
  color: C.text,
  padding: "0.4rem 0.6rem",
  fontFamily: T.code.fontFamily,
  fontSize: T.code.fontSize,
  borderRadius: 3,
  outline: "none",
});

// ─── 2SLS: Excluded Instruments ──────────────────────────────────────────────
function InstrumentSelector({ numericCols, yVar, xVars, wVars, zVars, setZVars }) {
  const { C, T } = useTheme();
  const avail = numericCols.filter(
    h => !yVar.includes(h) && !xVars.includes(h) && !wVars.includes(h)
  );
  return (
    <VarPanel
      title="Z · Instruments (excluded)"
      color={C.gold}
      vars={avail}
      selected={zVars}
      onToggle={setZVars}
      info="Must affect X but not Y directly (exclusion restriction)."
    />
  );
}

// ─── N-way FE picker ──────────────────────────────────────────────────────────
// Multi-select FE dimension picker. Defaults to `defaultFeCols` (normally
// panel.feCols from the PanelTab declaration; the plain "FE" estimator passes
// [entityCol] only, since that estimator historically demeans by entity alone —
// see estimationDispatch.js) but lets the user narrow/reorder for THIS
// estimation only — does not mutate the stored panel declaration.
function FEColumnPicker({ panel, selectedFeCols, setSelectedFeCols, defaultFeCols }) {
  const { C } = useTheme();
  if (!panel?.feCols?.length) return null;
  const dflt = defaultFeCols ?? panel.feCols;
  const effective = selectedFeCols ?? dflt;
  const toggle = col => setSelectedFeCols(
    effective.includes(col) ? effective.filter(c => c !== col) : [...effective, col]
  );
  return (
    <Section title="Fixed Effects" color={C.teal}>
      <div style={{ display: "flex", flexWrap: "wrap", gap: 4 }}>
        {panel.feCols.map(col => (
          <Chip key={col} label={col} selected={effective.includes(col)} onClick={() => toggle(col)} color={C.teal} />
        ))}
      </div>
    </Section>
  );
}
export { FEColumnPicker };

// ─── DiD 2×2: Treated + Post + Controls ──────────────────────────────────────
function DiDConfig({ numericCols, yVar, treatVar, setTreatVar, postVar, setPostVar, wVars, setWVars }) {
  const { C, T } = useTheme();
  return (
    <>
      <VarPanel
        title="Treated Column (0/1)"
        color={C.teal}
        vars={numericCols.filter(h => !yVar.includes(h))}
        selected={treatVar}
        onToggle={setTreatVar}
        multi={false}
      />
      <VarPanel
        title="Post Column (0/1)"
        color={C.teal}
        vars={numericCols.filter(h => !yVar.includes(h) && !treatVar.includes(h))}
        selected={postVar}
        onToggle={setPostVar}
        multi={false}
      />
      <VarPanel
        title="W · Additional Controls"
        color={C.blue}
        vars={numericCols.filter(
          h => !yVar.includes(h) && !treatVar.includes(h) && !postVar.includes(h)
        )}
        selected={wVars}
        onToggle={setWVars}
      />
    </>
  );
}

// ─── TWFE: Treatment indicator + Controls ─────────────────────────────────────
function TWFEConfig({ numericCols, yVar, treatVar, setTreatVar, postVar, wVars, setWVars }) {
  const { C, T } = useTheme();
  return (
    <>
      <VarPanel
        title="Treatment Column (time-varying 0/1)"
        color={C.teal}
        vars={numericCols.filter(h => !yVar.includes(h))}
        selected={treatVar}
        onToggle={setTreatVar}
        multi={false}
      />
      <VarPanel
        title="W · Additional Controls"
        color={C.blue}
        vars={numericCols.filter(
          h => !yVar.includes(h) && !treatVar.includes(h) && !postVar.includes(h)
        )}
        selected={wVars}
        onToggle={setWVars}
      />
    </>
  );
}

// ─── Shared polynomial order selector ────────────────────────────────────────
function PolyOrderSection({ polyOrder, setPolyOrder }) {
  const { C, T } = useTheme();
  return (
    <Section title="Polynomial Order" color={C.orange}>
      <div style={{ display: "flex", gap: 4 }}>
        {[1, 2, 3].map(p => (
          <Chip
            key={p}
            label={p === 1 ? "p=1 (linear)" : p === 2 ? "p=2 (quadratic)" : "p=3 (cubic)"}
            selected={polyOrder === p}
            color={C.orange}
            onClick={() => setPolyOrder(p)}
          />
        ))}
      </div>
    </Section>
  );
}

// ─── RDD: Running Variable + Cutoff + Bandwidth + Kernel ─────────────────────
function RDDConfig({
  numericCols, yVar,
  runningVar, setRunningVar,
  cutoff, setCutoff,
  bwMode, setBwMode,
  bwManual, setBwManual,
  kernel, setKernel,
  polyOrder, setPolyOrder,
}) {
  const { C, T } = useTheme();
  return (
    <>
      {/* Running variable */}
      <VarPanel
        title="Running Variable"
        color={C.orange}
        vars={numericCols.filter(h => !yVar.includes(h))}
        selected={runningVar}
        onToggle={setRunningVar}
        multi={false}
      />

      {/* Cutoff */}
      <Section title="Cutoff Value" color={C.orange}>
        <input
          type="number"
          value={cutoff}
          onChange={e => setCutoff(e.target.value)}
          placeholder="e.g. 0"
          style={inputStyle(C, T)}
        />
      </Section>

      {/* Bandwidth */}
      <Section title="Bandwidth" color={C.orange}>
        <div style={{ display: "flex", gap: 4, marginBottom: 6 }}>
          {[
            { id: "ik",     label: "IK (auto)" },
            { id: "manual", label: "Manual" },
          ].map(({ id, label }) => (
            <Chip
              key={id}
              label={label}
              selected={bwMode === id}
              color={C.orange}
              onClick={() => setBwMode(id)}
            />
          ))}
        </div>
        {bwMode === "manual" && (
          <input
            type="number"
            value={bwManual}
            onChange={e => setBwManual(e.target.value)}
            placeholder="bandwidth h"
            style={inputStyle(C, T)}
          />
        )}
      </Section>

      {/* Kernel */}
      <Section title="Kernel" color={C.orange}>
        <div style={{ display: "flex", gap: 4, flexWrap: "wrap" }}>
          {["triangular", "epanechnikov", "uniform"].map(k => (
            <Chip
              key={k}
              label={k}
              selected={kernel === k}
              color={C.orange}
              onClick={() => setKernel(k)}
            />
          ))}
        </div>
      </Section>

      {/* Polynomial order */}
      <PolyOrderSection polyOrder={polyOrder} setPolyOrder={setPolyOrder} />
    </>
  );
}


// ─── OLS: Collapsible survey-weights toggle ───────────────────────────────────
function CollapsibleWeights(props) {
  const { C, T } = useTheme();
  const [open, setOpen] = useState(false);
  return (
    <div style={{ marginBottom: "1.4rem" }}>
      <button
        onClick={() => setOpen(v => !v)}
        style={{
          width: "100%", display: "flex", alignItems: "center", justifyContent: "space-between",
          padding: "0.4rem 0.65rem", background: "transparent",
          border: `1px solid ${C.border}`, borderRadius: 3, cursor: "pointer",
          fontFamily: T.code.fontFamily, fontSize: T.caption.fontSize, letterSpacing: "0.14em",
          textTransform: "uppercase", color: C.textMuted,
        }}
      >
        <span>Survey weights (WLS) — optional</span>
        <span>{open ? "▲" : "▼"}</span>
      </button>
      {open && <div style={{ marginTop: 8 }}><WeightsConfig {...props} /></div>}
    </div>
  );
}

// ─── OLS: Survey Weights ──────────────────────────────────────────────────────
function WeightsConfig({ numericCols, yVar, xVars, weightVar, setWeightVar }) {
  const { C, T } = useTheme();
  const avail = numericCols.filter(
    h => !yVar.includes(h) && !xVars.includes(h)
  );
  return (
    <VarPanel
      title="W̃ · Observation Weight"
      color={C.violet}
      vars={avail}
      selected={weightVar}
      onToggle={setWeightVar}
      multi={false}
      info="One column of positive weights (e.g. population size, inverse variance). Each row is multiplied by its weight — this does NOT limit the number of X regressors. Select X regressors above."
    />
  );
}


// ─── EventStudy: TreatTime column + window ────────────────────────────────────
function EventStudyConfig({ numericCols, yVar, treatTimeCol, setTreatTimeCol, kPre, setKPre, kPost, setKPost, wVars, setWVars }) {
  const { C, T } = useTheme();
  return (
    <>
      <VarPanel
        title="Treatment Time Column (numeric period)"
        color={C.teal}
        vars={numericCols.filter(h => !yVar.includes(h))}
        selected={treatTimeCol}
        onToggle={setTreatTimeCol}
        multi={false}
        info="Column with the first period unit was treated. Never-treated units should have null/NaN."
      />
      <Section title="Pre-Period Window (kPre)" color={C.teal}>
        <input type="number" min={1} max={20} value={kPre} onChange={e => setKPre(e.target.value)} style={inputStyle(C, T)} placeholder="3" />
      </Section>
      <Section title="Post-Period Window (kPost)" color={C.teal}>
        <input type="number" min={1} max={20} value={kPost} onChange={e => setKPost(e.target.value)} style={inputStyle(C, T)} placeholder="3" />
      </Section>
      <VarPanel
        title="W · Additional Controls"
        color={C.blue}
        vars={numericCols.filter(h => !yVar.includes(h) && !treatTimeCol.includes(h))}
        selected={wVars}
        onToggle={setWVars}
      />
    </>
  );
}

// ─── SunAbraham: cohort + period + control convention ─────────────────────────
// Sun & Abraham (2021) IW event study over Poisson PPML. Absorbs unit + period
// FE; cohort assignment is built upstream (Spatial/Clean) and consumed here.
function SunAbrahamConfig({
  numericCols, headers, yVar, panel,
  cohortCol, setCohortCol, periodCol, setPeriodCol,
  saUnitCol, setSaUnitCol, saControlMode, setSaControlMode,
  saRefPeriod, setSaRefPeriod, wVars, setWVars,
}) {
  const { C, T } = useTheme();
  const cols = headers ?? [];
  const unitFromPanel = panel?.entityCol || null;
  const colBtn = (active, accent) => ({
    padding: "0.28rem 0.6rem",
    border: `1px solid ${active ? accent : C.border2}`,
    background: active ? `${accent}18` : "transparent",
    color: active ? accent : C.textDim,
    borderRadius: 3, cursor: "pointer", fontSize: T.code.fontSize, fontFamily: T.code.fontFamily,
  });
  return (
    <>
      <VarPanel
        title="Cohort Column (first-treated period; never-treated = blank/NaN)"
        color={C.teal}
        vars={cols.filter(h => !yVar.includes(h))}
        selected={cohortCol}
        onToggle={setCohortCol}
        multi={false}
        info="Period each unit was first treated. Never-treated controls should be blank/NaN. Built upstream in Spatial/Clean."
      />
      <VarPanel
        title="Period Column (calendar time)"
        color={C.teal}
        vars={numericCols.filter(h => !yVar.includes(h) && !cohortCol.includes(h))}
        selected={periodCol}
        onToggle={setPeriodCol}
        multi={false}
        info="Numeric calendar period. Also absorbed as a period fixed effect."
      />
      {unitFromPanel ? (
        <Section title="Unit (entity) Fixed Effect">
          <div style={{ fontSize: T.code.fontSize, fontFamily: T.code.fontFamily, color: C.textDim, padding: "0.4rem 0.6rem", background: C.surface2, border: `1px solid ${C.border}`, borderRadius: 3 }}>
            i = <span style={{ color: C.gold }}>{unitFromPanel}</span>
            <span style={{ color: C.textMuted }}> (from panel structure)</span>
          </div>
        </Section>
      ) : (
        <Section title="Unit (entity) Fixed Effect">
          <div style={{ display: "flex", flexWrap: "wrap", gap: 4 }}>
            {cols.map(h => (
              <button key={h} onClick={() => setSaUnitCol(h)} style={colBtn(saUnitCol === h, C.gold)}>
                {saUnitCol === h ? "✓ " : ""}{h}
              </button>
            ))}
          </div>
        </Section>
      )}
      <Section title="Control Convention" color={C.teal}>
        <div style={{ fontSize: T.caption.fontSize, fontFamily: T.code.fontFamily, color: C.textMuted, marginBottom: 6 }}>
          Which units identify the baseline. "Auto": never-treated + cohorts outside the observed period range. "Never-treated only": just blank/NaN cohorts.
        </div>
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
          <Chip label="Auto (never + not-yet)" selected={saControlMode === "auto"} color={C.teal} onClick={() => setSaControlMode("auto")} />
          <Chip label="Never-treated only" selected={saControlMode === "never"} color={C.teal} onClick={() => setSaControlMode("never")} />
        </div>
      </Section>
      <Section title="Reference Relative Period" color={C.teal}>
        <input type="number" value={saRefPeriod} onChange={e => setSaRefPeriod(e.target.value)} style={inputStyle(C, T)} placeholder="-1" />
      </Section>
      <VarPanel
        title="W · Additional Controls (optional)"
        color={C.blue}
        vars={numericCols.filter(h => !yVar.includes(h) && !cohortCol.includes(h) && !periodCol.includes(h))}
        selected={wVars}
        onToggle={setWVars}
      />
    </>
  );
}

// ─── LSDV: Time FE toggle ─────────────────────────────────────────────────────
function LSDVConfig({ lsdvTimeFE, setLsdvTimeFE }) {
  const { C, T } = useTheme();
  return (
    <Section title="Time Fixed Effects" color={C.blue}>
      <div style={{ display: "flex", gap: 8 }}>
        <Chip label="Entity FE only" selected={!lsdvTimeFE} color={C.blue} onClick={() => setLsdvTimeFE(false)} />
        <Chip label="Entity + Time FE" selected={lsdvTimeFE} color={C.blue} onClick={() => setLsdvTimeFE(true)} />
      </div>
    </Section>
  );
}

// ─── SyntheticControl: treated unit + treat time + predictors ─────────────────
function SyntheticControlConfig({ numericCols, yVar, treatedUnit, setTreatedUnit, synthTreatTime, setSynthTreatTime, xVars, setXVars, rows, panel }) {
  const { C, T } = useTheme();
  const unitCol = panel?.entityCol;
  const uniqueUnits = useMemo(
    () => unitCol ? [...new Set(rows.map(r => r[unitCol]).filter(v => v != null))].sort() : [],
    [rows, unitCol],
  );

  return (
    <>
      <Section title="Treated Unit" color={C.gold}>
        <select value={treatedUnit} onChange={e => setTreatedUnit(e.target.value)}
          style={{ ...inputStyle(C, T), cursor: "pointer" }}>
          <option value="">— select treated unit —</option>
          {uniqueUnits.map(u => <option key={u} value={u}>{u}</option>)}
        </select>
      </Section>
      <Section title="Treatment Time Period (numeric)" color={C.gold}>
        <input type="number" value={synthTreatTime} onChange={e => setSynthTreatTime(e.target.value)} placeholder="e.g. 1990" style={inputStyle(C, T)} />
      </Section>
      <VarPanel
        title="Predictor Variables (pre-period)"
        color={C.blue}
        vars={numericCols.filter(h => !yVar.includes(h))}
        selected={xVars}
        onToggle={setXVars}
        info="Pre-treatment predictors used to find synthetic weights. Optional — if empty, only the outcome (Y) is used."
      />
    </>
  );
}

// ─── CallawayCS: first-treat col + comparison group + event window ────────────
function CallawayCSConfig({
  numericCols, headers, yVar, panel,
  csTreatCol, setCsTreatCol,
  csEntityCol, setCsEntityCol,
  csTimeCol, setCsTimeCol,
  csCompGroup, setCsCompGroup,
  csRelMin, setCsRelMin,
  csRelMax, setCsRelMax,
  csXCols, setCsXCols,
  csEstMethod, setCsEstMethod,
  csBasePeriod, setCsBasePeriod,
  csAnticipation, setCsAnticipation,
  csInfMethod, setCsInfMethod,
  csNBoot, setCsNBoot,
  csSeed, setCsSeed,
}) {
  const { C, T } = useTheme();
  const cols = headers ?? numericCols;
  const unitFromPanel = panel?.entityCol || null;
  const timeFromPanel = panel?.timeCol   || null;
  return (
    <>
      <VarPanel
        title="First-Treatment-Period Column"
        color={C.teal}
        vars={cols.filter(h => !yVar.includes(h))}
        selected={csTreatCol}
        onToggle={setCsTreatCol}
        multi={false}
        info="Numeric column with the first period each unit was treated. Never-treated units should be 0, blank, or Inf. Same as `gname` in R did package."
      />
      {unitFromPanel ? (
        <Section title="Entity (unit) Column">
          <div style={{ fontSize: T.code.fontSize, fontFamily: T.code.fontFamily, color: C.textDim, padding: "0.4rem 0.6rem", background: C.surface2, border: `1px solid ${C.border}`, borderRadius: 3 }}>
            i = <span style={{ color: C.gold }}>{unitFromPanel}</span>
            <span style={{ color: C.textMuted }}> (from panel structure)</span>
          </div>
        </Section>
      ) : (
        <VarPanel
          title="Entity (unit) Column"
          color={C.gold}
          vars={cols.filter(h => !yVar.includes(h))}
          selected={csEntityCol}
          onToggle={setCsEntityCol}
          multi={false}
          info="Unit identifier (e.g. county, firm). Same as `idname` in R did package."
        />
      )}
      {timeFromPanel ? (
        <Section title="Time Column">
          <div style={{ fontSize: T.code.fontSize, fontFamily: T.code.fontFamily, color: C.textDim, padding: "0.4rem 0.6rem", background: C.surface2, border: `1px solid ${C.border}`, borderRadius: 3 }}>
            t = <span style={{ color: C.gold }}>{timeFromPanel}</span>
            <span style={{ color: C.textMuted }}> (from panel structure)</span>
          </div>
        </Section>
      ) : (
        <VarPanel
          title="Time Column"
          color={C.gold}
          vars={numericCols.filter(h => !yVar.includes(h))}
          selected={csTimeCol}
          onToggle={setCsTimeCol}
          multi={false}
          info="Numeric calendar time period. Same as `tname` in R did package."
        />
      )}
      <Section title="Comparison Group" color={C.teal}>
        <div style={{ fontSize: T.caption.fontSize, fontFamily: T.code.fontFamily, color: C.textMuted, marginBottom: 6 }}>
          Which units serve as the counterfactual comparison for each cohort-period.
        </div>
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
          <Chip label="Never-treated" selected={csCompGroup === "nevertreated"} color={C.teal} onClick={() => setCsCompGroup("nevertreated")} />
          <Chip label="Not-yet-treated" selected={csCompGroup === "notyettreated"} color={C.teal} onClick={() => setCsCompGroup("notyettreated")} />
        </div>
      </Section>
      <Section title="Event Window (relative periods)" color={C.teal}>
        <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
          <div style={{ flex: 1 }}>
            <div style={{ fontSize: T.caption.fontSize, color: C.textMuted, fontFamily: T.code.fontFamily, marginBottom: 3 }}>Min (pre)</div>
            <input
              type="number"
              value={csRelMin}
              onChange={e => setCsRelMin(e.target.value)}
              placeholder="-5"
              style={inputStyle(C, T)}
            />
          </div>
          <div style={{ flex: 1 }}>
            <div style={{ fontSize: T.caption.fontSize, color: C.textMuted, fontFamily: T.code.fontFamily, marginBottom: 3 }}>Max (post)</div>
            <input
              type="number"
              value={csRelMax}
              onChange={e => setCsRelMax(e.target.value)}
              placeholder="5"
              style={inputStyle(C, T)}
            />
          </div>
        </div>
        <div style={{ fontSize: T.caption.fontSize, color: C.textMuted, fontFamily: T.code.fontFamily, marginTop: 4 }}>
          Leave blank to include all observed periods.
        </div>
      </Section>

      {/* Covariates (optional) */}
      <VarPanel
        title="Covariates X (optional)"
        color={C.blue}
        vars={numericCols.filter(c => !yVar.includes(c) && !(csTreatCol ?? []).includes(c))}
        selected={csXCols ?? []}
        onToggle={v => setCsXCols && setCsXCols(v)}
        multi={true}
        info="Pre-treatment covariates for doubly-robust / regression / IPW adjustment. Same as `xformla` in R did package."
      />

      {/* Estimator method */}
      <Section title="Estimator Method" color={C.teal}>
        <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
          {["dr", "reg", "ipw"].map(m => (
            <Chip key={m} label={m} selected={(csEstMethod ?? "dr") === m} color={C.teal} onClick={() => setCsEstMethod && setCsEstMethod(m)} />
          ))}
        </div>
        <div style={{ fontSize: T.caption.fontSize, color: C.textMuted, fontFamily: T.code.fontFamily, marginTop: 4 }}>
          dr = doubly-robust (recommended), reg = outcome regression, ipw = inverse probability weighting.
        </div>
      </Section>

      {/* Base period */}
      <Section title="Base Period" color={C.teal}>
        <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
          {["varying", "universal"].map(b => (
            <Chip key={b} label={b} selected={(csBasePeriod ?? "varying") === b} color={C.teal} onClick={() => setCsBasePeriod && setCsBasePeriod(b)} />
          ))}
        </div>
        <div style={{ fontSize: T.caption.fontSize, color: C.textMuted, fontFamily: T.code.fontFamily, marginTop: 4 }}>
          varying = period before treatment for each cohort (recommended). universal = single common pre-period.
        </div>
      </Section>

      {/* Anticipation */}
      <Section title="Anticipation (δ)" color={C.teal}>
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <input
            type="number"
            min={0}
            step={1}
            value={csAnticipation ?? "0"}
            onChange={e => setCsAnticipation && setCsAnticipation(e.target.value)}
            style={inputStyle(C, T)}
          />
          <span style={{ fontSize: T.caption.fontSize, color: C.textMuted, fontFamily: T.code.fontFamily }}>
            periods of anticipation (default 0)
          </span>
        </div>
      </Section>

      {/* Inference */}
      <Section title="Inference" color={C.teal}>
        <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
          {["bootstrap", "analytic"].map(inf => (
            <Chip key={inf} label={inf} selected={(csInfMethod ?? "bootstrap") === inf} color={C.teal} onClick={() => setCsInfMethod && setCsInfMethod(inf)} />
          ))}
        </div>
        {(csInfMethod ?? "bootstrap") === "bootstrap" && (
          <div style={{ display: "flex", gap: 12, marginTop: 8, alignItems: "center", flexWrap: "wrap" }}>
            <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
              <span style={{ fontSize: T.caption.fontSize, color: C.textMuted, fontFamily: T.code.fontFamily }}>nBoot</span>
              <input
                type="number"
                min={99}
                step={100}
                value={csNBoot ?? "999"}
                onChange={e => setCsNBoot && setCsNBoot(e.target.value)}
                style={{ ...inputStyle(C, T), width: 70 }}
              />
            </div>
            <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
              <span style={{ fontSize: T.caption.fontSize, color: C.textMuted, fontFamily: T.code.fontFamily }}>seed</span>
              <input
                type="number"
                min={0}
                value={csSeed ?? "42"}
                onChange={e => setCsSeed && setCsSeed(e.target.value)}
                style={{ ...inputStyle(C, T), width: 70 }}
              />
            </div>
          </div>
        )}
      </Section>
    </>
  );
}

// ─── SpatialRDD: distance-to-boundary + treated-side indicator + bw + kernel ─
// Keele & Titiunik 2015 geographic RD. The engine builds the signed running
// variable internally from |dist| and the side indicator (no user-facing cutoff).
function SpatialRDDConfig({
  numericCols, yVar,
  runningVar, setRunningVar,   // → distance-to-boundary column (unsigned ok)
  treatVar,   setTreatVar,     // → 0/1 indicator for the treated side
  bwMode,     setBwMode,
  bwManual,   setBwManual,
  kernel,     setKernel,
  polyOrder,  setPolyOrder,
}) {
  const { C, T } = useTheme();
  return (
    <>
      <VarPanel
        title="Distance-to-Boundary Column"
        color={C.orange}
        vars={numericCols.filter(h => !yVar.includes(h) && !treatVar.includes(h))}
        selected={runningVar}
        onToggle={setRunningVar}
        multi={false}
        info="Distance from each observation to the treatment boundary (km, m, or projected units). Unsigned or signed — sign is recovered from the treated-side indicator."
      />
      <VarPanel
        title="Treated Side Indicator (0/1)"
        color={C.teal}
        vars={numericCols.filter(h => !yVar.includes(h) && !runningVar.includes(h))}
        selected={treatVar}
        onToggle={setTreatVar}
        multi={false}
        info="1 if the observation is on the treated side of the boundary, 0 otherwise. Combined with distance to build the signed running variable, with cutoff = 0 by construction."
      />

      {/* Bandwidth */}
      <Section title="Bandwidth" color={C.orange}>
        <div style={{ display: "flex", gap: 4, marginBottom: 6 }}>
          {[
            { id: "ik",     label: "IK (auto)" },
            { id: "manual", label: "Manual" },
          ].map(({ id, label }) => (
            <Chip key={id} label={label} selected={bwMode === id} color={C.orange} onClick={() => setBwMode(id)} />
          ))}
        </div>
        {bwMode === "manual" && (
          <input
            type="number"
            value={bwManual}
            onChange={e => setBwManual(e.target.value)}
            placeholder="bandwidth h (distance units)"
            style={inputStyle(C, T)}
          />
        )}
      </Section>

      {/* Kernel */}
      <Section title="Kernel" color={C.orange}>
        <div style={{ display: "flex", gap: 4, flexWrap: "wrap" }}>
          {["triangular", "epanechnikov", "uniform"].map(k => (
            <Chip key={k} label={k} selected={kernel === k} color={C.orange} onClick={() => setKernel(k)} />
          ))}
        </div>
      </Section>

      {/* Polynomial order */}
      <PolyOrderSection polyOrder={polyOrder} setPolyOrder={setPolyOrder} />
    </>
  );
}

// ─── FuzzyRDD: uses RDDConfig + treatVar for D column ────────────────────────
function SpatialRegressionConfig({
  headers,
  spatialModel, setSpatialModel,
  spatialWeightsMode, setSpatialWeightsMode,
  spatialGeomCol, setSpatialGeomCol,
  spatialWeightsType, setSpatialWeightsType,
  spatialWeightsStyle, setSpatialWeightsStyle,
  spatialWeightsK, setSpatialWeightsK,
  spatialWeightsD, setSpatialWeightsD,
  availableDatasets,
  spatialWeightsDatasetId, setSpatialWeightsDatasetId,
  spatialWeightsICol, setSpatialWeightsICol,
  spatialWeightsJCol, setSpatialWeightsJCol,
  spatialWeightsWCol, setSpatialWeightsWCol,
}) {
  const { C, T } = useTheme();
  const selectedDs = (availableDatasets ?? []).find(d => d.id === spatialWeightsDatasetId);
  const selectedHeaders = selectedDs?.headers ?? [];
  const btn = (active, color = C.teal) => ({
    padding: "0.28rem 0.6rem",
    border: `1px solid ${active ? color : C.border2}`,
    background: active ? `${color}18` : "transparent",
    color: active ? color : C.textDim,
    borderRadius: 3,
    cursor: "pointer",
    fontSize: T.code.fontSize,
    fontFamily: T.code.fontFamily,
  });
  const selStyle = { ...inputStyle(C, T), cursor: "pointer" };

  return (
    <>
      <Section title="Spatial Model" color={C.teal}>
        <div style={{ display: "flex", gap: 4, flexWrap: "wrap" }}>
          {[
            ["SLX", "SLX"],
            ["SAR", "SAR / lag"],
            ["SEM", "SEM / error"],
            ["SDM", "SDM / Durbin"],
          ].map(([id, label]) => (
            <button key={id} onClick={() => setSpatialModel(id)} style={btn(spatialModel === id, C.teal)}>
              {spatialModel === id ? "✓ " : ""}{label}
            </button>
          ))}
        </div>
        <div style={{ fontSize: T.caption.fontSize, color: C.textMuted, marginTop: 6, fontFamily: T.code.fontFamily }}>
          SAR/SEM/SDM use concentrated ML over the spatial parameter; SLX is OLS on X and WX.
        </div>
      </Section>

      <Section title="Spatial Weights W" color={C.gold}>
        <div style={{ display: "flex", gap: 4, flexWrap: "wrap", marginBottom: 8 }}>
          <button onClick={() => setSpatialWeightsMode("inline")} style={btn(spatialWeightsMode === "inline", C.gold)}>
            Build inline
          </button>
          <button onClick={() => setSpatialWeightsMode("dataset")} style={btn(spatialWeightsMode === "dataset", C.gold)}>
            Use triples dataset
          </button>
        </div>

        {spatialWeightsMode === "inline" ? (
          <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
            <select value={spatialGeomCol} onChange={e => setSpatialGeomCol(e.target.value)} style={selStyle}>
              <option value="">- geometry WKT column -</option>
              {(headers ?? []).map(h => <option key={h} value={h}>{h}</option>)}
            </select>
            <div style={{ display: "flex", gap: 4, flexWrap: "wrap" }}>
              {["queen", "rook", "knn", "dband"].map(t => (
                <button key={t} onClick={() => setSpatialWeightsType(t)} style={btn(spatialWeightsType === t, C.teal)}>{t}</button>
              ))}
              {["W", "B"].map(s => (
                <button key={s} onClick={() => setSpatialWeightsStyle(s)} style={btn(spatialWeightsStyle === s, C.blue)}>{s}</button>
              ))}
            </div>
            {(spatialWeightsType === "knn" || spatialWeightsType === "dband") && (
              <div style={{ display: "flex", gap: 8 }}>
                {spatialWeightsType === "knn" && (
                  <input type="number" min={1} value={spatialWeightsK} onChange={e => setSpatialWeightsK(e.target.value)} placeholder="k" style={inputStyle(C, T)} />
                )}
                {spatialWeightsType === "dband" && (
                  <input type="number" min={0} value={spatialWeightsD} onChange={e => setSpatialWeightsD(e.target.value)} placeholder="distance band" style={inputStyle(C, T)} />
                )}
              </div>
            )}
          </div>
        ) : (
          <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
            <select value={spatialWeightsDatasetId} onChange={e => setSpatialWeightsDatasetId(e.target.value)} style={selStyle}>
              <option value="">- select weights dataset -</option>
              {(availableDatasets ?? []).map(d => <option key={d.id} value={d.id}>{d.filename ?? d.name ?? d.id}</option>)}
            </select>
            {selectedDs && (
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 6 }}>
                <select value={spatialWeightsICol} onChange={e => setSpatialWeightsICol(e.target.value)} style={selStyle}>
                  <option value="">i</option>
                  {selectedHeaders.map(h => <option key={h} value={h}>{h}</option>)}
                </select>
                <select value={spatialWeightsJCol} onChange={e => setSpatialWeightsJCol(e.target.value)} style={selStyle}>
                  <option value="">j</option>
                  {selectedHeaders.map(h => <option key={h} value={h}>{h}</option>)}
                </select>
                <select value={spatialWeightsWCol} onChange={e => setSpatialWeightsWCol(e.target.value)} style={selStyle}>
                  <option value="">w</option>
                  {selectedHeaders.map(h => <option key={h} value={h}>{h}</option>)}
                </select>
              </div>
            )}
          </div>
        )}
      </Section>
    </>
  );
}

function FuzzyRDDConfig({ numericCols, yVar, treatVar, setTreatVar, runningVar, setRunningVar, cutoff, setCutoff, bwMode, setBwMode, bwManual, setBwManual, kernel, setKernel, polyOrder, setPolyOrder }) {
  const { C, T } = useTheme();
  return (
    <>
      <VarPanel
        title="Treatment Receipt Column D (0/1 take-up)"
        color={C.teal}
        vars={numericCols.filter(h => !yVar.includes(h))}
        selected={treatVar}
        onToggle={setTreatVar}
        multi={false}
        info="Actual treatment receipt (endogenous D). The cutoff indicator Z = 1(X ≥ c) is the instrument."
      />
      <RDDConfig
        numericCols={numericCols.filter(h => !treatVar.includes(h))}
        yVar={yVar}
        runningVar={runningVar} setRunningVar={setRunningVar}
        cutoff={cutoff}         setCutoff={setCutoff}
        bwMode={bwMode}         setBwMode={setBwMode}
        bwManual={bwManual}     setBwManual={setBwManual}
        kernel={kernel}         setKernel={setKernel}
        polyOrder={polyOrder}   setPolyOrder={setPolyOrder}
      />
    </>
  );
}

// ─── MAIN EXPORT ─────────────────────────────────────────────────────────────
export default function ModelConfiguration({
  model,
  family = "linear",
  numericCols,
  yVar,
  xVars,      setXVars,
  wVars,      setWVars,
  zVars,      setZVars,
  treatVar,   setTreatVar,
  postVar,    setPostVar,
  runningVar, setRunningVar,
  cutoff,     setCutoff,
  bwMode,     setBwMode,
  bwManual,   setBwManual,
  kernel,     setKernel,
  polyOrder,  setPolyOrder,
  weightVar,  setWeightVar,
  // New estimator props
  treatTimeCol,   setTreatTimeCol,
  kPre,           setKPre,
  kPost,          setKPost,
  lsdvTimeFE,     setLsdvTimeFE,
  selectedFeCols, setSelectedFeCols,
  treatedUnit,    setTreatedUnit,
  synthTreatTime, setSynthTreatTime,
  poissonEntityCol, setPoissonEntityCol,
  poissonOffsetCol, setPoissonOffsetCol,
  poissonExtraFE,   setPoissonExtraFE,
  cohortCol,      setCohortCol,
  periodCol,      setPeriodCol,
  saUnitCol,      setSaUnitCol,
  saControlMode,  setSaControlMode,
  saRefPeriod,    setSaRefPeriod,
  // CallawayCS
  csTreatCol,     setCsTreatCol,
  csEntityCol,    setCsEntityCol,
  csTimeCol,      setCsTimeCol,
  csCompGroup,    setCsCompGroup,
  csRelMin,       setCsRelMin,
  csRelMax,       setCsRelMax,
  csXCols,        setCsXCols,
  csEstMethod,    setCsEstMethod,
  csBasePeriod,   setCsBasePeriod,
  csAnticipation, setCsAnticipation,
  csInfMethod,    setCsInfMethod,
  csNBoot,        setCsNBoot,
  csSeed,         setCsSeed,
  spatialModel, setSpatialModel,
  spatialWeightsMode, setSpatialWeightsMode,
  spatialGeomCol, setSpatialGeomCol,
  spatialWeightsType, setSpatialWeightsType,
  spatialWeightsStyle, setSpatialWeightsStyle,
  spatialWeightsK, setSpatialWeightsK,
  spatialWeightsD, setSpatialWeightsD,
  spatialWeightsDatasetId, setSpatialWeightsDatasetId,
  spatialWeightsICol, setSpatialWeightsICol,
  spatialWeightsJCol, setSpatialWeightsJCol,
  spatialWeightsWCol, setSpatialWeightsWCol,
  availableDatasets,
  rows,
  headers,
  panel,
}) {
  const { C, T } = useTheme();
  if (model === "2SLS" || model === "GMM" || model === "LIML") {
    return (
      <InstrumentSelector
        numericCols={numericCols}
        yVar={yVar}
        xVars={xVars}
        wVars={wVars}
        zVars={zVars}
        setZVars={setZVars}
      />
    );
  }

  if (model === "DiD") {
    return (
      <DiDConfig
        numericCols={numericCols}
        yVar={yVar}
        treatVar={treatVar}
        setTreatVar={setTreatVar}
        postVar={postVar}
        setPostVar={setPostVar}
        wVars={wVars}
        setWVars={setWVars}
      />
    );
  }

  if (model === "TWFE") {
    return (
      <>
        <TWFEConfig
          numericCols={numericCols}
          yVar={yVar}
          treatVar={treatVar}
          setTreatVar={setTreatVar}
          postVar={postVar}
          wVars={wVars}
          setWVars={setWVars}
        />
        <FEColumnPicker panel={panel} selectedFeCols={selectedFeCols} setSelectedFeCols={setSelectedFeCols} />
      </>
    );
  }

  if (model === "RDD") {
    return (
      <RDDConfig
        numericCols={numericCols}
        yVar={yVar}
        runningVar={runningVar}
        setRunningVar={setRunningVar}
        cutoff={cutoff}
        setCutoff={setCutoff}
        bwMode={bwMode}
        setBwMode={setBwMode}
        bwManual={bwManual}
        setBwManual={setBwManual}
        kernel={kernel}
        setKernel={setKernel}
        polyOrder={polyOrder}
        setPolyOrder={setPolyOrder}
      />
    );
  }

  if (model === "FuzzyRDD") {
    return <FuzzyRDDConfig numericCols={numericCols} yVar={yVar} treatVar={treatVar} setTreatVar={setTreatVar} runningVar={runningVar} setRunningVar={setRunningVar} cutoff={cutoff} setCutoff={setCutoff} bwMode={bwMode} setBwMode={setBwMode} bwManual={bwManual} setBwManual={setBwManual} kernel={kernel} setKernel={setKernel} polyOrder={polyOrder} setPolyOrder={setPolyOrder} />;
  }

  if (model === "SpatialRDD") {
    return <SpatialRDDConfig numericCols={numericCols} yVar={yVar} runningVar={runningVar} setRunningVar={setRunningVar} treatVar={treatVar} setTreatVar={setTreatVar} bwMode={bwMode} setBwMode={setBwMode} bwManual={bwManual} setBwManual={setBwManual} kernel={kernel} setKernel={setKernel} polyOrder={polyOrder} setPolyOrder={setPolyOrder} />;
  }

  if (model === "SpatialRegression") {
    return <SpatialRegressionConfig headers={headers} spatialModel={spatialModel} setSpatialModel={setSpatialModel} spatialWeightsMode={spatialWeightsMode} setSpatialWeightsMode={setSpatialWeightsMode} spatialGeomCol={spatialGeomCol} setSpatialGeomCol={setSpatialGeomCol} spatialWeightsType={spatialWeightsType} setSpatialWeightsType={setSpatialWeightsType} spatialWeightsStyle={spatialWeightsStyle} setSpatialWeightsStyle={setSpatialWeightsStyle} spatialWeightsK={spatialWeightsK} setSpatialWeightsK={setSpatialWeightsK} spatialWeightsD={spatialWeightsD} setSpatialWeightsD={setSpatialWeightsD} availableDatasets={availableDatasets} spatialWeightsDatasetId={spatialWeightsDatasetId} setSpatialWeightsDatasetId={setSpatialWeightsDatasetId} spatialWeightsICol={spatialWeightsICol} setSpatialWeightsICol={setSpatialWeightsICol} spatialWeightsJCol={spatialWeightsJCol} setSpatialWeightsJCol={setSpatialWeightsJCol} spatialWeightsWCol={spatialWeightsWCol} setSpatialWeightsWCol={setSpatialWeightsWCol} />;
  }

  if (model === "EventStudy") {
    if (family === "poisson") {
      return <SunAbrahamConfig numericCols={numericCols} headers={headers} yVar={yVar} panel={panel} cohortCol={cohortCol} setCohortCol={setCohortCol} periodCol={periodCol} setPeriodCol={setPeriodCol} saUnitCol={saUnitCol} setSaUnitCol={setSaUnitCol} saControlMode={saControlMode} setSaControlMode={setSaControlMode} saRefPeriod={saRefPeriod} setSaRefPeriod={setSaRefPeriod} wVars={wVars} setWVars={setWVars} />;
    }
    return (
      <>
        <EventStudyConfig numericCols={numericCols} yVar={yVar} treatTimeCol={treatTimeCol} setTreatTimeCol={setTreatTimeCol} kPre={kPre} setKPre={setKPre} kPost={kPost} setKPost={setKPost} wVars={wVars} setWVars={setWVars} />
        <FEColumnPicker panel={panel} selectedFeCols={selectedFeCols} setSelectedFeCols={setSelectedFeCols} />
      </>
    );
  }

  if (model === "CallawayCS") {
    return <CallawayCSConfig numericCols={numericCols} headers={headers} yVar={yVar} panel={panel}
      csTreatCol={csTreatCol} setCsTreatCol={setCsTreatCol}
      csEntityCol={csEntityCol} setCsEntityCol={setCsEntityCol}
      csTimeCol={csTimeCol} setCsTimeCol={setCsTimeCol}
      csCompGroup={csCompGroup} setCsCompGroup={setCsCompGroup}
      csRelMin={csRelMin} setCsRelMin={setCsRelMin}
      csRelMax={csRelMax} setCsRelMax={setCsRelMax}
      csXCols={csXCols} setCsXCols={setCsXCols}
      csEstMethod={csEstMethod} setCsEstMethod={setCsEstMethod}
      csBasePeriod={csBasePeriod} setCsBasePeriod={setCsBasePeriod}
      csAnticipation={csAnticipation} setCsAnticipation={setCsAnticipation}
      csInfMethod={csInfMethod} setCsInfMethod={setCsInfMethod}
      csNBoot={csNBoot} setCsNBoot={setCsNBoot}
      csSeed={csSeed} setCsSeed={setCsSeed}
    />;
  }

  if (model === "LSDV") {
    return (
      <>
        <LSDVConfig lsdvTimeFE={lsdvTimeFE} setLsdvTimeFE={setLsdvTimeFE} />
        <FEColumnPicker panel={panel} selectedFeCols={selectedFeCols} setSelectedFeCols={setSelectedFeCols} />
      </>
    );
  }

  if (model === "SyntheticControl") {
    return <SyntheticControlConfig numericCols={numericCols} yVar={yVar} treatedUnit={treatedUnit} setTreatedUnit={setTreatedUnit} synthTreatTime={synthTreatTime} setSynthTreatTime={setSynthTreatTime} xVars={xVars} setXVars={setXVars} rows={rows} panel={panel} />;
  }

  if (model === "OLS" && family === "poisson") {
    // Optional: offset column (exposure / population at risk).
    // ln(offset) is added to the linear predictor with coefficient = 1,
    // converting the count model to a per-capita rate model (Osgood 2000, Eq. 3).
    return (
      <Section title="Exposure (optional)">
        <div style={{ fontSize: T.caption.fontSize, color: C.textMuted, marginBottom: 6, fontFamily: T.code.fontFamily }}>
          Select a column holding population size or observation length to model rates rather than counts.
          Its log will be added as an offset with coefficient fixed at 1.
        </div>
        <div style={{ display: "flex", flexWrap: "wrap", gap: 4 }}>
          <button
            onClick={() => setPoissonOffsetCol("")}
            style={{ padding: "0.28rem 0.6rem", border: `1px solid ${!poissonOffsetCol ? C.teal : C.border2}`, background: !poissonOffsetCol ? `${C.teal}18` : "transparent", color: !poissonOffsetCol ? C.teal : C.textDim, borderRadius: 3, cursor: "pointer", fontSize: T.code.fontSize, fontFamily: T.code.fontFamily }}>
            {!poissonOffsetCol ? "✓ " : ""}None (count model)
          </button>
          {(headers ?? []).map(h => (
            <button key={h} onClick={() => setPoissonOffsetCol(h)}
              style={{ padding: "0.28rem 0.6rem", border: `1px solid ${poissonOffsetCol === h ? C.gold : C.border2}`, background: poissonOffsetCol === h ? `${C.gold}18` : "transparent", color: poissonOffsetCol === h ? C.gold : C.textDim, borderRadius: 3, cursor: "pointer", fontSize: T.code.fontSize, fontFamily: T.code.fontFamily }}>
              {poissonOffsetCol === h ? "✓ " : ""}{h}
            </button>
          ))}
        </div>
      </Section>
    );
  }

  if ((model === "FE" && family === "poisson") || model === "NegBinFE") {
    const entityCol = panel?.entityCol || poissonEntityCol;
    const extraFE = poissonExtraFE ?? [];
    const toggleExtra = (h) =>
      setPoissonExtraFE(extraFE.includes(h) ? extraFE.filter(c => c !== h) : [...extraFE, h]);
    const offsetPanel = (
      <Section title="Exposure (optional)">
        <div style={{ fontSize: T.caption.fontSize, color: C.textMuted, marginBottom: 6, fontFamily: T.code.fontFamily }}>
          Select a column holding exposure, population size, or observation length for an offset.
        </div>
        <div style={{ display: "flex", flexWrap: "wrap", gap: 4 }}>
          <button
            onClick={() => setPoissonOffsetCol("")}
            style={{ padding: "0.28rem 0.6rem", border: `1px solid ${!poissonOffsetCol ? C.teal : C.border2}`, background: !poissonOffsetCol ? `${C.teal}18` : "transparent", color: !poissonOffsetCol ? C.teal : C.textDim, borderRadius: 3, cursor: "pointer", fontSize: T.code.fontSize, fontFamily: T.code.fontFamily }}>
            {!poissonOffsetCol ? "✓ " : ""}None
          </button>
          {(headers ?? []).map(h => (
            <button key={h} onClick={() => setPoissonOffsetCol(h)}
              style={{ padding: "0.28rem 0.6rem", border: `1px solid ${poissonOffsetCol === h ? C.gold : C.border2}`, background: poissonOffsetCol === h ? `${C.gold}18` : "transparent", color: poissonOffsetCol === h ? C.gold : C.textDim, borderRadius: 3, cursor: "pointer", fontSize: T.code.fontSize, fontFamily: T.code.fontFamily }}>
              {poissonOffsetCol === h ? "✓ " : ""}{h}
            </button>
          ))}
        </div>
      </Section>
    );
    // Additional fixed-effect dimensions ⇒ N-way Poisson FE (runPoissonFEMulti).
    // Candidates exclude the entity column already used as the first FE dim.
    const extraFEPanel = (
      <Section title="Additional Fixed Effects (optional)">
        <div style={{ fontSize: T.caption.fontSize, fontFamily: T.code.fontFamily, color: C.textMuted, marginBottom: 6 }}>
          Add more FE dimensions (e.g. time) for two-way / N-way Poisson FE.
        </div>
        <div style={{ display: "flex", flexWrap: "wrap", gap: 4 }}>
          {(headers ?? []).filter(h => h !== entityCol).map(h => (
            <button key={h} onClick={() => toggleExtra(h)}
              style={{ padding: "0.28rem 0.6rem", border: `1px solid ${extraFE.includes(h) ? C.teal : C.border2}`, background: extraFE.includes(h) ? `${C.teal}18` : "transparent", color: extraFE.includes(h) ? C.teal : C.textDim, borderRadius: 3, cursor: "pointer", fontSize: T.code.fontSize, fontFamily: T.code.fontFamily }}>
              {extraFE.includes(h) ? "✓ " : ""}{h}
            </button>
          ))}
        </div>
      </Section>
    );
    // If panel entity is already declared in Wrangling, show it read-only.
    // Otherwise let the user pick the entity column inline.
    if (panel?.entityCol) {
      return (
        <>
          <Section title="Entity Column">
            <div style={{ fontSize: T.code.fontSize, fontFamily: T.code.fontFamily, color: C.textDim, padding: "0.4rem 0.6rem", background: C.surface2, border: `1px solid ${C.border}`, borderRadius: 3 }}>
              i = <span style={{ color: C.gold }}>{panel.entityCol}</span>
              <span style={{ color: C.textMuted }}> (from panel structure)</span>
            </div>
          </Section>
          {offsetPanel}
          {extraFEPanel}
        </>
      );
    }
    return (
      <>
        <Section title="Entity Column (i)">
          <div style={{ display: "flex", flexWrap: "wrap", gap: 4 }}>
            {(headers ?? []).map(h => (
              <button key={h} onClick={() => setPoissonEntityCol(h)}
                style={{ padding: "0.28rem 0.6rem", border: `1px solid ${poissonEntityCol === h ? C.gold : C.border2}`, background: poissonEntityCol === h ? `${C.gold}18` : "transparent", color: poissonEntityCol === h ? C.gold : C.textDim, borderRadius: 3, cursor: "pointer", fontSize: T.code.fontSize, fontFamily: T.code.fontFamily }}>
                {poissonEntityCol === h ? "✓ " : ""}{h}
              </button>
            ))}
          </div>
        </Section>
        {poissonEntityCol ? offsetPanel : null}
        {poissonEntityCol ? extraFEPanel : null}
      </>
    );
  }

  if (model === "OLS" && family === "linear") {
    return (
      <CollapsibleWeights
        numericCols={numericCols}
        yVar={yVar}
        xVars={xVars}
        weightVar={weightVar}
        setWeightVar={setWeightVar}
      />
    );
  }

  if (model === "FE" && family !== "poisson") {
    // Plain FE historically demeans by ENTITY ONLY (validated vs R
    // fixest::feols(y ~ x | unit)) — default the picker to entity-only so an
    // untouched picker reproduces that exact behavior; the user opts in to
    // additional dims (e.g. time ⇒ two-way) by checking more chips.
    return (
      <FEColumnPicker
        panel={panel}
        selectedFeCols={selectedFeCols}
        setSelectedFeCols={setSelectedFeCols}
        defaultFeCols={panel?.entityCol ? [panel.entityCol] : []}
      />
    );
  }

  if (model === "FD") {
    return <FEColumnPicker panel={panel} selectedFeCols={selectedFeCols} setSelectedFeCols={setSelectedFeCols} />;
  }

  // OLS: no model-specific configuration beyond variable selection
  return null;
}
