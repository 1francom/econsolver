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

import { VarPanel, Section, Chip, C, mono } from "./shared.jsx";

// ─── 2SLS: Excluded Instruments ──────────────────────────────────────────────
function InstrumentSelector({ numericCols, yVar, xVars, wVars, zVars, setZVars }) {
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
  const inputStyle = {
    width: "100%",
    background: C.surface2,
    border: `1px solid ${C.border2}`,
    color: C.text,
    padding: "0.4rem 0.6rem",
    fontFamily: mono,
    fontSize: 12,
    borderRadius: 3,
    outline: "none",
  };

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
          style={inputStyle}
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
            style={inputStyle}
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
  const avail = numericCols.filter(
    h => !yVar.includes(h) && !xVars.includes(h)
  );
  return (
    <VarPanel
      title="W̃ · Survey Weight (optional)"
      color="#9e7ec8"
      vars={avail}
      selected={weightVar}
      onToggle={setWeightVar}
      multi={false}
      info="Sampling weight column. Activates WLS. Leave empty for OLS."
    />
  );
}


// ─── MAIN EXPORT ─────────────────────────────────────────────────────────────
export default function ModelConfiguration({
  model,
  numericCols,
  yVar,
  xVars,
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

  // OLS / FE / FD: no model-specific configuration beyond variable selection
  return null;
}
