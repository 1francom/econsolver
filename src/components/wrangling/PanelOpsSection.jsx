// ─── ECON STUDIO · components/wrangling/PanelOpsSection.jsx ────────────────
// Entity-bounded panel operators (lag / lead / diff) as a self-contained
// collapsible section. Lives in the Panel Structure tab (below the panel
// index). Owns its own name/operator/source state.
import { useState } from "react";
import { useTheme, Lbl, Collapsible, Btn } from "./shared.jsx";

function PanelOpsSection({ headers, info, panel, onAdd }) {
  const { C, T } = useTheme();
  const [nm, setNm]     = useState("");
  const [pop, setPop]   = useState("lag");   // "lag" | "lead" | "diff"
  const [pc, setPc]     = useState("");
  const [lagN, setLagN] = useState(1);

  const numC = headers.filter(h => info[h]?.isNum);
  const isP  = panel?.entityCol && panel?.timeCol;

  const inpS = { width:"100%", boxSizing:"border-box", padding:"0.42rem 0.65rem",
    background:C.surface2, border:`1px solid ${C.border2}`, borderRadius:3,
    color:C.text, fontFamily:T.code.fontFamily, fontSize:T.code.fontSize, outline:"none" };

  const doP = () => {
    const n = nm.trim(); if (!n || !pc || !isP) return;
    const ec = panel.entityCol, tc = panel.timeCol;
    if (pop === "lag")       onAdd({ type:"lag",  col:pc, nn:n, n:lagN, ec, tc, desc:`L${lagN}.${pc} (i=${ec}) → ${n}` });
    else if (pop === "lead") onAdd({ type:"lead", col:pc, nn:n, n:lagN, ec, tc, desc:`F${lagN}.${pc} (i=${ec}) → ${n}` });
    else if (pop === "diff") onAdd({ type:"diff", col:pc, nn:n, ec, tc, desc:`Δ${pc} (i=${ec}) → ${n}` });
    setNm(""); setPc("");
  };

  return (
    <Collapsible title="Panel operations — lag / lead / diff" color={C.orange}>
      {!isP
        ? <div style={{padding:"1rem",background:C.surface,border:`1px solid ${C.border}`,borderLeft:`3px solid ${C.orange}`,borderRadius:4,fontSize: T.code.fontSize,color:C.orange,lineHeight:1.7}}>⚠ Set the panel index above first. Operators respect entity boundaries to prevent cross-unit contamination.</div>
        : <div>
            <div style={{padding:"0.48rem 0.75rem",background:`${C.blue}15`,border:`1px solid ${C.blue}30`,borderRadius:3,marginBottom:"1.2rem",fontSize: T.code.fontSize,color:C.blue,fontFamily: T.code.fontFamily}}>i={panel.entityCol} · t={panel.timeCol} · entity-bounded operators</div>
            <Lbl color={C.orange}>New variable name</Lbl>
            <input value={nm} onChange={e=>setNm(e.target.value)}
              placeholder="e.g. wage_lag1"
              style={{...inpS,marginBottom:"1.2rem"}}/>
            <Lbl color={C.orange}>Operator</Lbl>
            <div style={{display:"flex",gap:4,marginBottom:"1.2rem"}}>
              {[["lag","L. Lag","yᵢ,ₜ₋ₙ"],["lead","F. Lead","yᵢ,ₜ₊ₙ"],["diff","Δ Diff","Δyᵢₜ"]].map(([k,l,f])=>(
                <button key={k} onClick={()=>setPop(k)} style={{flex:1,padding:"0.5rem 0.65rem",border:`1px solid ${pop===k?C.orange:C.border2}`,background:pop===k?`${C.orange}18`:"transparent",color:pop===k?C.orange:C.textDim,borderRadius:3,cursor:"pointer",fontSize: T.caption.fontSize,fontFamily: T.code.fontFamily,transition:"all 0.12s",textAlign:"center"}}>
                  <div style={{fontWeight:700,marginBottom:2}}>{l}</div><div style={{fontSize: T.caption.fontSize,color:C.textMuted}}>{f}</div>
                </button>
              ))}
            </div>
            {(pop==="lag"||pop==="lead")&&<div style={{marginBottom:"1.2rem"}}><Lbl>Periods n</Lbl><div style={{display:"flex",gap:4}}>{[1,2,3,4].map(n=><button key={n} onClick={()=>setLagN(n)} style={{width:34,padding:"0.32rem",border:`1px solid ${lagN===n?C.orange:C.border2}`,background:lagN===n?`${C.orange}18`:"transparent",color:lagN===n?C.orange:C.textDim,borderRadius:3,cursor:"pointer",fontSize: T.code.fontSize,fontFamily: T.code.fontFamily,transition:"all 0.12s"}}>{n}</button>)}</div></div>}
            <Lbl>Source column</Lbl>
            <div style={{display:"flex",flexWrap:"wrap",gap:4,marginBottom:"1rem"}}>{numC.map(h=><button key={h} onClick={()=>setPc(h)} style={{padding:"0.28rem 0.6rem",border:`1px solid ${pc===h?C.orange:C.border2}`,background:pc===h?`${C.orange}18`:"transparent",color:pc===h?C.orange:C.textDim,borderRadius:3,cursor:"pointer",fontSize: T.code.fontSize,fontFamily: T.code.fontFamily,transition:"all 0.12s"}}>{pc===h?"✓ ":""}{h}</button>)}</div>
            {pc&&nm.trim()&&<div style={{padding:"0.48rem 0.75rem",background:C.surface,border:`1px solid ${C.border}`,borderRadius:3,marginBottom:"1rem",fontSize: T.code.fontSize,color:C.textDim,fontFamily: T.code.fontFamily}}>
              {pop==="lag"&&<><span style={{color:C.teal}}>{nm.trim()}</span>[i,t] = <span style={{color:C.gold}}>{pc}</span>[i,t−{lagN}] within i={panel.entityCol}</>}
              {pop==="lead"&&<><span style={{color:C.teal}}>{nm.trim()}</span>[i,t] = <span style={{color:C.gold}}>{pc}</span>[i,t+{lagN}] within i={panel.entityCol}</>}
              {pop==="diff"&&<><span style={{color:C.teal}}>{nm.trim()}</span> = Δ<span style={{color:C.gold}}>{pc}</span> within i={panel.entityCol}</>}
            </div>}
            <Btn onClick={doP} color={C.orange} v="solid" dis={!nm.trim()||!pc} ch="Add panel variable"/>
          </div>
      }
    </Collapsible>
  );
}

export default PanelOpsSection;
