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

import { useMemo } from "react";
import { VarPanel, Section, Chip, useTheme, mono } from "./shared.jsx";

const inputStyle = C => ({
  width: "100%",
  background: C.surface2,
  border: `1px solid ${C.border2}`,
  color: C.text,
  padding: "0.4rem 0.6rem",
  fontFamily: mono,
  fontSize: 12,
  borderRadius: 3,
  outline: "none",
});

// ─── 2SLS: Excluded Instruments ──────────────────────────────────────────────
function InstrumentSelector({ numericCols, yVar, xVars, wVars, zVars, setZVars }) {
  const { C } = useTheme();
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

// ─── DiD 2×2: Treated + Post + Controls ──────────────────────────────────────
function DiDConfig({ numericCols, yVar, treatVar, setTreatVar, postVar, setPostVar, wVars, setWVars }) {
  const { C } = useTheme();
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
  const { C } = useTheme();
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

// ─── RDD: Running Variable + Cutoff + Bandwidth + Kernel ─────────────────────
function RDDConfig({
  numericCols, yVar,
  runningVar, setRunningVar,
  cutoff, setCutoff,
  bwMode, setBwMode,
  bwManual, setBwManual,
  kernel, setKernel,
}) {
  const { C } = useTheme();
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
          style={inputStyle(C)}
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
            style={inputStyle(C)}
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
    </>
  );
}


// ─── OLS: Survey Weights ──────────────────────────────────────────────────────
function WeightsConfig({ numericCols, yVar, xVars, weightVar, setWeightVar }) {
  const { C } = useTheme();
  const avail = numericCols.filter(
    h => !yVar.includes(h) && !xVars.includes(h)
  );
  return (
    <VarPanel
      title="W̃ · Observation Weight"
      color="#9e7ec8"
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
  const { C } = useTheme();
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
        <input type="number" min={1} max={20} value={kPre} onChange={e => setKPre(e.target.value)} style={inputStyle(C)} placeholder="3" />
      </Section>
      <Section title="Post-Period Window (kPost)" color={C.teal}>
        <input type="number" min={1} max={20} value={kPost} onChange={e => setKPost(e.target.value)} style={inputStyle(C)} placeholder="3" />
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

// ─── LSDV: Time FE toggle ─────────────────────────────────────────────────────
function LSDVConfig({ lsdvTimeFE, setLsdvTimeFE }) {
  const { C } = useTheme();
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
  const { C } = useTheme();
  const unitCol = panel?.entityCol;
  const uniqueUnits = useMemo(
    () => unitCol ? [...new Set(rows.map(r => r[unitCol]).filter(v => v != null))].sort() : [],
    [rows, unitCol],
  );

  return (
    <>
      <Section title="Treated Unit" color={C.gold}>
        <select value={treatedUnit} onChange={e => setTreatedUnit(e.target.value)}
          style={{ ...INPUT_STYLE, cursor: "pointer" }}>
          <option value="">— select treated unit —</option>
          {uniqueUnits.map(u => <option key={u} value={u}>{u}</option>)}
        </select>
      </Section>
      <Section title="Treatment Time Period (numeric)" color={C.gold}>
        <input type="number" value={synthTreatTime} onChange={e => setSynthTreatTime(e.target.value)} placeholder="e.g. 1990" style={inputStyle(C)} />
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

// ─── FuzzyRDD: uses RDDConfig + treatVar for D column ────────────────────────
function FuzzyRDDConfig({ numericCols, yVar, treatVar, setTreatVar, runningVar, setRunningVar, cutoff, setCutoff, bwMode, setBwMode, bwManual, setBwManual, kernel, setKernel }) {
  const { C } = useTheme();
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
      />
    </>
  );
}

// ─── MAIN EXPORT ─────────────────────────────────────────────────────────────
export default function ModelConfiguration({
  model,
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
  weightVar,  setWeightVar,
  // New estimator props
  treatTimeCol,   setTreatTimeCol,
  kPre,           setKPre,
  kPost,          setKPost,
  lsdvTimeFE,     setLsdvTimeFE,
  treatedUnit,    setTreatedUnit,
  synthTreatTime, setSynthTreatTime,
  rows,
  panel,
}) {
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
      <TWFEConfig
        numericCols={numericCols}
        yVar={yVar}
        treatVar={treatVar}
        setTreatVar={setTreatVar}
        postVar={postVar}
        wVars={wVars}
        setWVars={setWVars}
      />
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
      />
    );
  }

  if (model === "FuzzyRDD") {
    return <FuzzyRDDConfig numericCols={numericCols} yVar={yVar} treatVar={treatVar} setTreatVar={setTreatVar} runningVar={runningVar} setRunningVar={setRunningVar} cutoff={cutoff} setCutoff={setCutoff} bwMode={bwMode} setBwMode={setBwMode} bwManual={bwManual} setBwManual={setBwManual} kernel={kernel} setKernel={setKernel} />;
  }

  if (model === "EventStudy") {
    return <EventStudyConfig numericCols={numericCols} yVar={yVar} treatTimeCol={treatTimeCol} setTreatTimeCol={setTreatTimeCol} kPre={kPre} setKPre={setKPre} kPost={kPost} setKPost={setKPost} wVars={wVars} setWVars={setWVars} />;
  }

  if (model === "LSDV") {
    return <LSDVConfig lsdvTimeFE={lsdvTimeFE} setLsdvTimeFE={setLsdvTimeFE} />;
  }

  if (model === "SyntheticControl") {
    return <SyntheticControlConfig numericCols={numericCols} yVar={yVar} treatedUnit={treatedUnit} setTreatedUnit={setTreatedUnit} synthTreatTime={synthTreatTime} setSynthTreatTime={setSynthTreatTime} xVars={xVars} setXVars={setXVars} rows={rows} panel={panel} />;
  }

  if (model === "WLS") {
    return (
      <WeightsConfig
        numericCols={numericCols}
        yVar={yVar}
        xVars={xVars}
        weightVar={weightVar}
        setWeightVar={setWeightVar}
      />
    );
  }

  // OLS / FE / FD: no model-specific configuration beyond variable selection
  return null;
}
