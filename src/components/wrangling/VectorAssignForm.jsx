import { useState, useMemo } from "react";
import { useTheme, mono, Lbl, Btn } from "./shared.jsx";

function VectorAssignForm({ rows, headers, onAdd }) {
  const { C } = useTheme();
  const [vNn, setVNn]       = useState("");
  const [vValuesRaw, setVValuesRaw] = useState("");
  const [vMode, setVMode]   = useState("random");
  const [vSeed, setVSeed]   = useState(42);
  const [vWeights, setVWeights] = useState({});
  const [vRules, setVRules] = useState([{ expr:"", value:"" }]);
  const [vElse, setVElse]   = useState("");

  const vValues = useMemo(
    () => vValuesRaw.split(/[\n,]+/).map(s => s.trim()).filter(Boolean),
    [vValuesRaw]
  );

  function doVector() {
    if (!vNn || !vValues.length) return;
    const step = { type:"vector_assign", nn:vNn, values:vValues, mode:vMode, seed:Number(vSeed) };
    if (vMode === "random" || vMode === "quota") {
      const ws = vValues.map(v => { const n = parseFloat(vWeights[v]); return isFinite(n) && n > 0 ? n : null; });
      step.weights = ws.some(w => w !== null) ? ws.map(w => w ?? 0) : null;
    }
    if (vMode === "conditional") {
      step.rules = vRules.filter(r => r.expr.trim());
      step.elseValue = vElse;
    }
    onAdd({ ...step, desc:`vector_assign ${vNn} [${vMode}]` });
    setVNn(""); setVValuesRaw("");
  }

  return (
    <div>
      <div style={{padding:"0.55rem 0.9rem",background:C.surface,border:`1px solid ${C.border}`,
        borderLeft:`3px solid ${C.blue}`,borderRadius:4,marginBottom:"1.2rem",
        fontSize:10,color:C.textMuted,fontFamily:mono,lineHeight:1.6}}>
        Assign a small value vector across all <span style={{color:C.blue}}>{rows.length.toLocaleString()}</span> rows.
        Choose a mode below. Random & quota are seeded - same seed reproduces the same column on replay.
      </div>

      <Lbl color={C.blue}>Output column name</Lbl>
      <input value={vNn} onChange={e=>setVNn(e.target.value)} placeholder="e.g. colour"
        style={{width:"100%",boxSizing:"border-box",marginBottom:"1rem",padding:"0.4rem 0.6rem",
          background:C.surface2,border:`1px solid ${C.border2}`,borderRadius:3,color:C.text,fontFamily:mono,fontSize:12,outline:"none"}}/>

      <Lbl color={C.blue}>Values (comma or newline separated)</Lbl>
      <textarea value={vValuesRaw} onChange={e=>setVValuesRaw(e.target.value)} rows={3}
        placeholder={"red, blue, green\nor one per line"}
        style={{width:"100%",boxSizing:"border-box",marginBottom:"1rem",padding:"0.4rem 0.6rem",
          background:C.surface2,border:`1px solid ${C.border2}`,borderRadius:3,color:C.text,fontFamily:mono,fontSize:12,outline:"none",resize:"vertical"}}/>

      <Lbl color={C.blue}>Mode</Lbl>
      <div style={{display:"flex",gap:4,flexWrap:"wrap",marginBottom:"1.2rem"}}>
        {[["random","Random (weighted)"],["conditional","Conditional (rules)"],
          ["recycle","Recycle (by position)"],["quota","Quota (exact proportions)"]].map(([k,l])=>(
          <button key={k} onClick={()=>setVMode(k)}
            style={{padding:"0.35rem 0.7rem",border:`1px solid ${vMode===k?C.blue:C.border2}`,
              background:vMode===k?`${C.blue}18`:"transparent",color:vMode===k?C.blue:C.textDim,
              borderRadius:3,cursor:"pointer",fontSize:11,fontFamily:mono}}>
            {vMode===k?"✓ ":""}{l}
          </button>
        ))}
      </div>

      {(vMode==="random"||vMode==="quota") && vValues.length>0 && (
        <div style={{marginBottom:"1.2rem"}}>
          <Lbl color={C.textDim}>Weights (optional - blank = {vMode==="quota"?"equal split":"uniform"})</Lbl>
          <div style={{display:"grid",gridTemplateColumns:"repeat(auto-fill,minmax(120px,1fr))",gap:6}}>
            {vValues.map(v=>(
              <div key={v} style={{display:"flex",alignItems:"center",gap:4}}>
                <span style={{fontSize:10,color:C.textDim,fontFamily:mono,minWidth:40,overflow:"hidden",textOverflow:"ellipsis"}}>{v}</span>
                <input value={vWeights[v]??""} onChange={e=>setVWeights(w=>({...w,[v]:e.target.value}))}
                  placeholder="1" style={{width:50,padding:"0.2rem 0.3rem",background:C.surface2,
                    border:`1px solid ${C.border2}`,borderRadius:3,color:C.text,fontFamily:mono,fontSize:10,outline:"none"}}/>
              </div>
            ))}
          </div>
        </div>
      )}

      {vMode==="conditional" && (
        <div style={{marginBottom:"1.2rem"}}>
          <Lbl color={C.textDim}>Rules (first match wins). Column names usable in the expression.</Lbl>
          {vRules.map((rule,i)=>(
            <div key={i} style={{display:"flex",gap:6,marginBottom:6}}>
              <input value={rule.expr} onChange={e=>setVRules(rs=>rs.map((r,k)=>k===i?{...r,expr:e.target.value}:r))}
                placeholder="e.g. income > 5000" style={{flex:2,padding:"0.3rem 0.5rem",background:C.surface2,
                  border:`1px solid ${C.border2}`,borderRadius:3,color:C.text,fontFamily:mono,fontSize:11,outline:"none"}}/>
              <span style={{color:C.textMuted,alignSelf:"center"}}>-&gt;</span>
              <input value={rule.value} onChange={e=>setVRules(rs=>rs.map((r,k)=>k===i?{...r,value:e.target.value}:r))}
                placeholder="value" style={{flex:1,padding:"0.3rem 0.5rem",background:C.surface2,
                  border:`1px solid ${C.border2}`,borderRadius:3,color:C.text,fontFamily:mono,fontSize:11,outline:"none"}}/>
              <button onClick={()=>setVRules(rs=>rs.length>1?rs.filter((_,k)=>k!==i):rs)}
                style={{padding:"0 0.5rem",border:`1px solid ${C.border2}`,background:"transparent",color:C.textMuted,borderRadius:3,cursor:"pointer"}}>×</button>
            </div>
          ))}
          <button onClick={()=>setVRules(rs=>[...rs,{expr:"",value:""}])}
            style={{padding:"0.25rem 0.6rem",border:`1px dashed ${C.blue}`,background:"transparent",color:C.blue,borderRadius:3,cursor:"pointer",fontSize:10,fontFamily:mono,marginBottom:8}}>
            + Add rule
          </button>
          <div style={{display:"flex",alignItems:"center",gap:6}}>
            <span style={{fontSize:10,color:C.textDim,fontFamily:mono}}>Else -&gt;</span>
            <input value={vElse} onChange={e=>setVElse(e.target.value)} placeholder="fallback value"
              style={{flex:1,padding:"0.3rem 0.5rem",background:C.surface2,border:`1px solid ${C.border2}`,borderRadius:3,color:C.text,fontFamily:mono,fontSize:11,outline:"none"}}/>
          </div>
        </div>
      )}

      {(vMode==="random"||vMode==="quota") && (
        <div style={{marginBottom:"1.2rem"}}>
          <Lbl color={C.textDim}>Seed</Lbl>
          <input type="number" value={vSeed} onChange={e=>setVSeed(e.target.value)}
            style={{width:90,padding:"0.3rem 0.5rem",background:C.surface2,border:`1px solid ${C.border2}`,borderRadius:3,color:C.text,fontFamily:mono,fontSize:11,outline:"none"}}/>
          <span style={{fontSize:9,color:C.textMuted,fontFamily:mono,marginLeft:8}}>Change to reshuffle; same seed reproduces the column.</span>
        </div>
      )}

      <Btn onClick={doVector} color={C.blue} v="solid" dis={!vNn || !vValues.length}
        ch={`Add vector column -> pipeline`}/>
    </div>
  );
}

export default VectorAssignForm;
