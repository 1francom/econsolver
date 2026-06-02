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

// ─── Shared polynomial order selector ────────────────────────────────────────
function PolyOrderSection({ polyOrder, setPolyOrder }) {
  const { C } = useTheme();
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

      {/* Polynomial order */}
      <PolyOrderSection polyOrder={polyOrder} setPolyOrder={setPolyOrder} />
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
          style={{ ...inputStyle(C), cursor: "pointer" }}>
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
  const { C } = useTheme();
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
            style={inputStyle(C)}
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
function FuzzyRDDConfig({ numericCols, yVar, treatVar, setTreatVar, runningVar, setRunningVar, cutoff, setCutoff, bwMode, setBwMode, bwManual, setBwManual, kernel, setKernel, polyOrder, setPolyOrder }) {
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
        polyOrder={polyOrder}   setPolyOrder={setPolyOrder}
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
  polyOrder,  setPolyOrder,
  weightVar,  setWeightVar,
  // New estimator props
  treatTimeCol,   setTreatTimeCol,
  kPre,           setKPre,
  kPost,          setKPost,
  lsdvTimeFE,     setLsdvTimeFE,
  treatedUnit,    setTreatedUnit,
  synthTreatTime, setSynthTreatTime,
  poissonEntityCol, setPoissonEntityCol,
  poissonOffsetCol, setPoissonOffsetCol,
  poissonExtraFE,   setPoissonExtraFE,
  rows,
  headers,
  panel,
}) {
  const { C } = useTheme();
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

  if (model === "Poisson") {
    // Optional: offset column (exposure / population at risk).
    // ln(offset) is added to the linear predictor with coefficient = 1,
    // converting the count model to a per-capita rate model (Osgood 2000, Eq. 3).
    return (
      <Section title="Exposure (optional)">
        <div style={{ fontSize: 10, color: C.textMuted, marginBottom: 6, fontFamily: mono }}>
          Select a column holding population size or observation length to model rates rather than counts.
          Its log will be added as an offset with coefficient fixed at 1.
        </div>
        <div style={{ display: "flex", flexWrap: "wrap", gap: 4 }}>
          <button
            onClick={() => setPoissonOffsetCol("")}
            style={{ padding: "0.28rem 0.6rem", border: `1px solid ${!poissonOffsetCol ? C.teal : C.border2}`, background: !poissonOffsetCol ? `${C.teal}18` : "transparent", color: !poissonOffsetCol ? C.teal : C.textDim, borderRadius: 3, cursor: "pointer", fontSize: 11, fontFamily: mono }}>
            {!poissonOffsetCol ? "✓ " : ""}None (count model)
          </button>
          {(headers ?? []).map(h => (
            <button key={h} onClick={() => setPoissonOffsetCol(h)}
              style={{ padding: "0.28rem 0.6rem", border: `1px solid ${poissonOffsetCol === h ? C.gold : C.border2}`, background: poissonOffsetCol === h ? `${C.gold}18` : "transparent", color: poissonOffsetCol === h ? C.gold : C.textDim, borderRadius: 3, cursor: "pointer", fontSize: 11, fontFamily: mono }}>
              {poissonOffsetCol === h ? "✓ " : ""}{h}
            </button>
          ))}
        </div>
      </Section>
    );
  }

  if (model === "PoissonFE") {
    const entityCol = panel?.entityCol || poissonEntityCol;
    const extraFE = poissonExtraFE ?? [];
    const toggleExtra = (h) =>
      setPoissonExtraFE(extraFE.includes(h) ? extraFE.filter(c => c !== h) : [...extraFE, h]);
    // Additional fixed-effect dimensions ⇒ N-way Poisson FE (runPoissonFEMulti).
    // Candidates exclude the entity column already used as the first FE dim.
    const extraFEPanel = (
      <Section title="Additional Fixed Effects (optional)">
        <div style={{ fontSize: 10, fontFamily: mono, color: C.textMuted, marginBottom: 6 }}>
          Add more FE dimensions (e.g. time) for two-way / N-way Poisson FE.
        </div>
        <div style={{ display: "flex", flexWrap: "wrap", gap: 4 }}>
          {(headers ?? []).filter(h => h !== entityCol).map(h => (
            <button key={h} onClick={() => toggleExtra(h)}
              style={{ padding: "0.28rem 0.6rem", border: `1px solid ${extraFE.includes(h) ? C.teal : C.border2}`, background: extraFE.includes(h) ? `${C.teal}18` : "transparent", color: extraFE.includes(h) ? C.teal : C.textDim, borderRadius: 3, cursor: "pointer", fontSize: 11, fontFamily: mono }}>
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
            <div style={{ fontSize: 11, fontFamily: mono, color: C.textDim, padding: "0.4rem 0.6rem", background: C.surface2, border: `1px solid ${C.border}`, borderRadius: 3 }}>
              i = <span style={{ color: C.gold }}>{panel.entityCol}</span>
              <span style={{ color: C.textMuted }}> (from panel structure)</span>
            </div>
          </Section>
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
                style={{ padding: "0.28rem 0.6rem", border: `1px solid ${poissonEntityCol === h ? C.gold : C.border2}`, background: poissonEntityCol === h ? `${C.gold}18` : "transparent", color: poissonEntityCol === h ? C.gold : C.textDim, borderRadius: 3, cursor: "pointer", fontSize: 11, fontFamily: mono }}>
                {poissonEntityCol === h ? "✓ " : ""}{h}
              </button>
            ))}
          </div>
        </Section>
        {poissonEntityCol ? extraFEPanel : null}
      </>
    );
  }

  // OLS / FE / FD: no model-specific configuration beyond variable selection
  return null;
}
