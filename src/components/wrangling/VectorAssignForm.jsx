import { useState, useMemo } from "react";
import { useTheme, Lbl, Btn } from "./shared.jsx";
import { DRAW_DISTS, DRAW_DIST_DEFAULTS, DRAW_DIST_FIELDS } from "../../math/dgpScript.js";

// Inline editor for one distribution's parameters. Fields are data-driven from
// DRAW_DIST_FIELDS so a distribution added to the shared module shows up here
// without touching this component.
function DistPicker({ dist, params, onDist, onParams, color }) {
  const { C, T } = useTheme();
  const inp = {
    width: "100%", boxSizing: "border-box", padding: "0.28rem 0.45rem",
    background: C.surface2, border: `1px solid ${C.border2}`, borderRadius: 3,
    color: C.text, fontFamily: T.code.fontFamily, fontSize: T.caption.fontSize, outline: "none",
  };
  return (
    <div>
      <select
        value={dist}
        onChange={e => { onDist(e.target.value); onParams({ ...DRAW_DIST_DEFAULTS[e.target.value] }); }}
        style={{ ...inp, marginBottom: 6 }}
      >
        {DRAW_DISTS.map(d => <option key={d} value={d}>{d}</option>)}
      </select>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill,minmax(110px,1fr))", gap: 6 }}>
        {(DRAW_DIST_FIELDS[dist] ?? []).map(([key, label, ph, type]) => (
          <div key={key}>
            <div style={{ fontSize: T.caption.fontSize, color: C.textMuted, fontFamily: T.code.fontFamily, marginBottom: 2 }}>{label}</div>
            <input
              type={type === "number" ? "number" : "text"}
              value={params?.[key] ?? ""}
              placeholder={ph}
              onChange={e => onParams({ ...params, [key]: e.target.value })}
              style={inp}
            />
          </div>
        ))}
      </div>
      {dist === "Categorical" && (
        <label style={{ display: "flex", alignItems: "center", gap: 5, marginTop: 5, cursor: "pointer",
          fontSize: T.caption.fontSize, color: C.textDim, fontFamily: T.code.fontFamily }}>
          <input type="checkbox" checked={params?.asCode === true}
            onChange={e => onParams({ ...params, asCode: e.target.checked })}
            style={{ accentColor: color }} />
          Emit integer codes 0..k−1 instead of the labels
        </label>
      )}
    </div>
  );
}

function VectorAssignForm({ rows, headers, onAdd }) {
  const { C, T } = useTheme();
  const [vNn, setVNn]       = useState("");
  const [vValuesRaw, setVValuesRaw] = useState("");
  const [vMode, setVMode]   = useState("random");
  const [vSeed, setVSeed]   = useState(42);
  const [vWeights, setVWeights] = useState({});
  const [vRules, setVRules] = useState([{ expr:"", value:"" }]);
  const [vElse, setVElse]   = useState("");
  const [vDist, setVDist]   = useState("Normal");
  const [vDistParams, setVDistParams] = useState({ ...DRAW_DIST_DEFAULTS.Normal });
  const [vElseDist, setVElseDist] = useState(null);        // null = literal else
  const [vElseDistParams, setVElseDistParams] = useState({});

  const vValues = useMemo(
    () => vValuesRaw.split(/[\n,]+/).map(s => s.trim()).filter(Boolean),
    [vValuesRaw]
  );

  // Distribution mode draws its own column, so it needs no value pool.
  const isDist  = vMode === "distribution";
  // Distribution draws its own column; conditional carries its values on the
  // rules. Only random / quota / recycle actually consume the value pool.
  const needsPool = !isDist && vMode !== "conditional";
  const canAdd    = Boolean(vNn) && (!needsPool || vValues.length > 0);

  function doVector() {
    if (!canAdd) return;
    const step = { type:"vector_assign", nn:vNn, values:vValues, mode:vMode, seed:Number(vSeed) };
    if (vMode === "random" || vMode === "quota") {
      const ws = vValues.map(v => { const n = parseFloat(vWeights[v]); return isFinite(n) && n > 0 ? n : null; });
      step.weights = ws.some(w => w !== null) ? ws.map(w => w ?? 0) : null;
    }
    if (isDist) {
      step.dist = vDist;
      step.distParams = vDistParams;
      step.values = [];
    }
    if (vMode === "conditional") {
      // A rule keeps `value` for the literal case and gains dist/distParams when
      // it draws instead — the runner picks whichever is present.
      step.rules = vRules.filter(r => r.expr.trim()).map(r => (
        r.dist ? { expr: r.expr, dist: r.dist, distParams: r.distParams ?? {} }
               : { expr: r.expr, value: r.value }
      ));
      if (vElseDist) { step.elseDist = vElseDist; step.elseDistParams = vElseDistParams; }
      else           { step.elseValue = vElse; }
    }
    const label = isDist ? `${vDist}` : vMode;
    onAdd({ ...step, desc:`vector_assign ${vNn} [${label}]` });
    setVNn(""); setVValuesRaw("");
  }

  return (
    <div>
      <div style={{padding:"0.55rem 0.9rem",background:C.surface,border:`1px solid ${C.border}`,
        borderLeft:`3px solid ${C.blue}`,borderRadius:4,marginBottom:"1.2rem",
        fontSize: T.caption.fontSize,color:C.textMuted,fontFamily: T.code.fontFamily,lineHeight:1.6}}>
        Assign a small value vector across all <span style={{color:C.blue}}>{rows.length.toLocaleString()}</span> rows.
        Choose a mode below. Every random mode is seeded - the same seed reproduces the same column on replay.
      </div>

      <Lbl color={C.blue}>Output column name</Lbl>
      <input value={vNn} onChange={e=>setVNn(e.target.value)} placeholder="e.g. colour"
        style={{width:"100%",boxSizing:"border-box",marginBottom:"1rem",padding:"0.4rem 0.6rem",
          background:C.surface2,border:`1px solid ${C.border2}`,borderRadius:3,color:C.text,fontFamily: T.code.fontFamily,fontSize: T.code.fontSize,outline:"none"}}/>

      {needsPool && <>
      <Lbl color={C.blue}>Values (comma or newline separated)</Lbl>
      <textarea value={vValuesRaw} onChange={e=>setVValuesRaw(e.target.value)} rows={3}
        placeholder={"red, blue, green\nor one per line"}
        style={{width:"100%",boxSizing:"border-box",marginBottom:"1rem",padding:"0.4rem 0.6rem",
          background:C.surface2,border:`1px solid ${C.border2}`,borderRadius:3,color:C.text,fontFamily: T.code.fontFamily,fontSize: T.code.fontSize,outline:"none",resize:"vertical"}}/>
      </>}

      <Lbl color={C.blue}>Mode</Lbl>
      <div style={{display:"flex",gap:4,flexWrap:"wrap",marginBottom:"1.2rem"}}>
        {[["random","Random (weighted)"],["distribution","Distribution (draw)"],
          ["conditional","Conditional (rules)"],
          ["recycle","Recycle (by position)"],["quota","Quota (exact proportions)"]].map(([k,l])=>(
          <button key={k} onClick={()=>setVMode(k)}
            style={{padding:"0.35rem 0.7rem",border:`1px solid ${vMode===k?C.blue:C.border2}`,
              background:vMode===k?`${C.blue}18`:"transparent",color:vMode===k?C.blue:C.textDim,
              borderRadius:3,cursor:"pointer",fontSize: T.code.fontSize,fontFamily: T.code.fontFamily}}>
            {vMode===k?"✓ ":""}{l}
          </button>
        ))}
      </div>

      {isDist && (
        <div style={{marginBottom:"1.2rem",padding:"0.7rem 0.9rem",background:C.surface,
          border:`1px solid ${C.blue}30`,borderLeft:`3px solid ${C.blue}`,borderRadius:4}}>
          <Lbl color={C.blue}>Distribution</Lbl>
          <DistPicker dist={vDist} params={vDistParams}
            onDist={setVDist} onParams={setVDistParams} color={C.blue}/>
          <div style={{marginTop:6,fontSize: T.caption.fontSize,color:C.textMuted,fontFamily: T.code.fontFamily,lineHeight:1.6}}>
            Draws one value per row - the same generators the Simulate tab uses.
            Exported scripts call R/NumPy/Stata's own RNG, so the drawn numbers differ
            from Litux's while the distribution matches.
          </div>
        </div>
      )}

      {(vMode==="random"||vMode==="quota") && vValues.length>0 && (
        <div style={{marginBottom:"1.2rem"}}>
          <Lbl color={C.textDim}>Weights (optional - blank = {vMode==="quota"?"equal split":"uniform"})</Lbl>
          <div style={{display:"grid",gridTemplateColumns:"repeat(auto-fill,minmax(120px,1fr))",gap:6}}>
            {vValues.map(v=>(
              <div key={v} style={{display:"flex",alignItems:"center",gap:4}}>
                <span style={{fontSize: T.caption.fontSize,color:C.textDim,fontFamily: T.code.fontFamily,minWidth:40,overflow:"hidden",textOverflow:"ellipsis"}}>{v}</span>
                <input value={vWeights[v]??""} onChange={e=>setVWeights(w=>({...w,[v]:e.target.value}))}
                  placeholder="1" style={{width:50,padding:"0.2rem 0.3rem",background:C.surface2,
                    border:`1px solid ${C.border2}`,borderRadius:3,color:C.text,fontFamily: T.code.fontFamily,fontSize: T.caption.fontSize,outline:"none"}}/>
              </div>
            ))}
          </div>
        </div>
      )}

      {vMode==="conditional" && (
        <div style={{marginBottom:"1.2rem"}}>
          <Lbl color={C.textDim}>Rules (first match wins). Column names usable in the expression.</Lbl>
          {vRules.map((rule,i)=>(
            <div key={i} style={{marginBottom:8,padding:rule.dist?"0.5rem 0.6rem":0,
              background:rule.dist?C.surface:"transparent",
              border:rule.dist?`1px solid ${C.border}`:"none",borderRadius:4}}>
              <div style={{display:"flex",gap:6}}>
                <input value={rule.expr} onChange={e=>setVRules(rs=>rs.map((r,k)=>k===i?{...r,expr:e.target.value}:r))}
                  placeholder="e.g. income > 5000" style={{flex:2,padding:"0.3rem 0.5rem",background:C.surface2,
                    border:`1px solid ${C.border2}`,borderRadius:3,color:C.text,fontFamily: T.code.fontFamily,fontSize: T.code.fontSize,outline:"none"}}/>
                <span style={{color:C.textMuted,alignSelf:"center"}}>-&gt;</span>
                {rule.dist
                  ? <span style={{flex:1,alignSelf:"center",fontSize: T.caption.fontSize,color:C.blue,fontFamily: T.code.fontFamily}}>{rule.dist} draw</span>
                  : <input value={rule.value ?? ""} onChange={e=>setVRules(rs=>rs.map((r,k)=>k===i?{...r,value:e.target.value}:r))}
                      placeholder="value" style={{flex:1,padding:"0.3rem 0.5rem",background:C.surface2,
                        border:`1px solid ${C.border2}`,borderRadius:3,color:C.text,fontFamily: T.code.fontFamily,fontSize: T.code.fontSize,outline:"none"}}/>}
                <button
                  onClick={()=>setVRules(rs=>rs.map((r,k)=>k!==i?r:(
                    r.dist ? { expr:r.expr, value:"" }
                           : { expr:r.expr, dist:"Normal", distParams:{ ...DRAW_DIST_DEFAULTS.Normal } })))}
                  title={rule.dist?"Use a fixed value instead":"Draw from a distribution instead"}
                  style={{padding:"0 0.5rem",border:`1px solid ${rule.dist?C.blue:C.border2}`,background:"transparent",
                    color:rule.dist?C.blue:C.textMuted,borderRadius:3,cursor:"pointer",fontSize: T.caption.fontSize,fontFamily: T.code.fontFamily}}>~</button>
                <button onClick={()=>setVRules(rs=>rs.length>1?rs.filter((_,k)=>k!==i):rs)}
                  style={{padding:"0 0.5rem",border:`1px solid ${C.border2}`,background:"transparent",color:C.textMuted,borderRadius:3,cursor:"pointer"}}>×</button>
              </div>
              {rule.dist && (
                <div style={{marginTop:6}}>
                  <DistPicker dist={rule.dist} params={rule.distParams}
                    onDist={d=>setVRules(rs=>rs.map((r,k)=>k===i?{...r,dist:d}:r))}
                    onParams={pp=>setVRules(rs=>rs.map((r,k)=>k===i?{...r,distParams:pp}:r))}
                    color={C.blue}/>
                </div>
              )}
            </div>
          ))}
          <button onClick={()=>setVRules(rs=>[...rs,{expr:"",value:""}])}
            style={{padding:"0.25rem 0.6rem",border:`1px dashed ${C.blue}`,background:"transparent",color:C.blue,borderRadius:3,cursor:"pointer",fontSize: T.caption.fontSize,fontFamily: T.code.fontFamily,marginBottom:8}}>
            + Add rule
          </button>
          <div style={{display:"flex",alignItems:"center",gap:6}}>
            <span style={{fontSize: T.caption.fontSize,color:C.textDim,fontFamily: T.code.fontFamily}}>Else -&gt;</span>
            {vElseDist
              ? <span style={{flex:1,fontSize: T.caption.fontSize,color:C.blue,fontFamily: T.code.fontFamily}}>{vElseDist} draw</span>
              : <input value={vElse} onChange={e=>setVElse(e.target.value)} placeholder="fallback value"
                  style={{flex:1,padding:"0.3rem 0.5rem",background:C.surface2,border:`1px solid ${C.border2}`,borderRadius:3,color:C.text,fontFamily: T.code.fontFamily,fontSize: T.code.fontSize,outline:"none"}}/>}
            <button
              onClick={()=>{ if (vElseDist) { setVElseDist(null); } else { setVElseDist("Normal"); setVElseDistParams({ ...DRAW_DIST_DEFAULTS.Normal }); } }}
              title={vElseDist?"Use a fixed value instead":"Draw from a distribution instead"}
              style={{padding:"0 0.5rem",border:`1px solid ${vElseDist?C.blue:C.border2}`,background:"transparent",
                color:vElseDist?C.blue:C.textMuted,borderRadius:3,cursor:"pointer",fontSize: T.caption.fontSize,fontFamily: T.code.fontFamily}}>~</button>
          </div>
          {vElseDist && (
            <div style={{marginTop:6}}>
              <DistPicker dist={vElseDist} params={vElseDistParams}
                onDist={setVElseDist} onParams={setVElseDistParams} color={C.blue}/>
            </div>
          )}
        </div>
      )}

      {(vMode==="random"||vMode==="quota"||isDist||vMode==="conditional") && (
        <div style={{marginBottom:"1.2rem"}}>
          <Lbl color={C.textDim}>Seed</Lbl>
          <input type="number" value={vSeed} onChange={e=>setVSeed(e.target.value)}
            style={{width:90,padding:"0.3rem 0.5rem",background:C.surface2,border:`1px solid ${C.border2}`,borderRadius:3,color:C.text,fontFamily: T.code.fontFamily,fontSize: T.code.fontSize,outline:"none"}}/>
          <span style={{fontSize: T.caption.fontSize,color:C.textMuted,fontFamily: T.code.fontFamily,marginLeft:8}}>Change to reshuffle; same seed reproduces the column.</span>
        </div>
      )}

      <Btn onClick={doVector} color={C.blue} v="solid" dis={!canAdd}
        ch={`Add vector column -> pipeline`}/>
    </div>
  );
}

export default VectorAssignForm;
