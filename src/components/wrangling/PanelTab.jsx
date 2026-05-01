// ─── ECON STUDIO · components/wrangling/PanelTab.jsx ───────────────────────
import { useState, useMemo } from "react";
import { validatePanel } from "../../pipeline/validator.js";
import { useTheme, mono, Lbl, Btn } from "./shared.jsx";

function Heatmap({v}){
  const { C } = useTheme();
  const MAX_E=12,MAX_T=10;
  const ents=v.entities.slice(0,MAX_E),ts=v.times.slice(0,MAX_T);
  return(
    <div style={{overflowX:"auto"}}>
      <table style={{borderCollapse:"collapse",fontSize:9,fontFamily:mono}}>
        <thead><tr>
          <td style={{padding:"2px 4px",color:C.textMuted,fontSize:8}}>i\t</td>
          {ts.map(t=><td key={t} style={{padding:"2px 4px",color:C.textMuted,textAlign:"center",minWidth:26}}>{t}</td>)}
        </tr></thead>
        <tbody>{ents.map(e=>(
          <tr key={e}>{[<td key="e" style={{padding:"2px 4px",color:C.textDim,whiteSpace:"nowrap",paddingRight:8}}>{String(e).slice(0,8)}</td>,
            ...ts.map(t=>{const p=v.pres[e]?.[t];return<td key={t} style={{padding:"2px",textAlign:"center"}}><span style={{display:"inline-block",width:16,height:16,borderRadius:2,background:p?C.green:C.red,opacity:p?0.7:0.4}}/></td>;})]}</tr>
        ))}</tbody>
      </table>
      {(v.entities.length>MAX_E||v.times.length>MAX_T)&&<div style={{fontSize:9,color:C.textMuted,marginTop:4}}>Showing {Math.min(MAX_E,v.entities.length)} of {v.entities.length} entities, {Math.min(MAX_T,v.times.length)} of {v.times.length} periods.</div>}
    </div>
  );
}

// ─── PANEL TAB ────────────────────────────────────────────────────────────────
function PanelTab({rows,headers,panel,setPanel}){
  const { C } = useTheme();
  const [ec,setEc]=useState(panel?.entityCol||""),[tc,setTc]=useState(panel?.timeCol||"");
  const v=useMemo(()=>ec&&tc?validatePanel(rows,ec,tc):null,[rows,ec,tc]);
  const bc={strongly_balanced:C.green,unbalanced:C.yellow,gaps:C.orange};
  const bl={strongly_balanced:"Strongly Balanced ✓",unbalanced:"Unbalanced",gaps:"Gaps"};
  return(
    <div>
      <div style={{fontSize:11,color:C.textDim,lineHeight:1.7,marginBottom:"1.2rem",padding:"0.65rem 1rem",background:C.surface,border:`1px solid ${C.border}`,borderLeft:`3px solid ${C.blue}`,borderRadius:4}}>
        Declare Entity (i) and Time (t) to enable FE/FD estimators and panel-aware operators.
      </div>
      <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:"1.2rem",marginBottom:"1.2rem"}}>
        {[["Entity ID (i)",ec,setEc,C.gold],["Time ID (t)",tc,setTc,C.blue]].map(([label,val,setter,color])=>(
          <div key={label}>
            <Lbl color={color}>{label}</Lbl>
            <div style={{display:"flex",flexWrap:"wrap",gap:4}}>
              {headers.map(h=><button key={h} onClick={()=>setter(h)} style={{padding:"0.28rem 0.6rem",border:`1px solid ${val===h?color:C.border2}`,background:val===h?`${color}18`:"transparent",color:val===h?color:C.textDim,borderRadius:3,cursor:"pointer",fontSize:11,fontFamily:mono,transition:"all 0.12s"}}>{val===h?"✓ ":""}{h}</button>)}
            </div>
          </div>
        ))}
      </div>
      {v&&(
        <div style={{border:`1px solid ${C.border}`,borderRadius:4,overflow:"hidden",marginBottom:"1.2rem"}}>
          <div style={{padding:"0.45rem 1rem",background:"#0a0a0a",borderBottom:`1px solid ${C.border}`,fontSize:10,color:C.textMuted,letterSpacing:"0.18em",textTransform:"uppercase",fontFamily:mono}}>Panel Diagnostics</div>
          <div style={{display:"grid",gridTemplateColumns:"repeat(5,1fr)",gap:1,background:C.border}}>
            {[{l:"Entities",v:v.entities.length,c:C.gold},{l:"Periods",v:v.times.length,c:C.blue},{l:"Obs",v:rows.length,c:C.text},{l:"Attrition",v:`${(v.attrition*100).toFixed(0)}%`,c:v.attrition>.1?C.red:C.green},{l:"Dups",v:v.dups.length,c:v.dups.length>0?C.red:C.green}].map(s=>(
              <div key={s.l} style={{background:C.surface,padding:"0.55rem 0.75rem"}}>
                <div style={{fontSize:9,color:C.textMuted,marginBottom:2,fontFamily:mono,letterSpacing:"0.1em",textTransform:"uppercase"}}>{s.l}</div>
                <div style={{fontSize:17,color:s.c,fontFamily:mono}}>{s.v}</div>
              </div>
            ))}
          </div>
          <div style={{padding:"0.65rem 1rem",borderTop:`1px solid ${C.border}`,display:"flex",gap:8,alignItems:"center"}}>
            <span style={{width:8,height:8,borderRadius:"50%",background:bc[v.balance]||C.textMuted,display:"inline-block",flexShrink:0}}/>
            <span style={{fontSize:12,color:bc[v.balance]||C.textMuted,fontFamily:mono}}>{bl[v.balance]||v.balance}</span>
            {v.attrition>0&&<span style={{fontSize:11,color:C.textMuted,fontFamily:mono}}>· t₀: {v.at0} → tN: {v.atN} ({(v.attrition*100).toFixed(0)}% lost)</span>}
          </div>
          {v.dups.length>0&&<div style={{padding:"0.65rem 1rem",borderTop:`1px solid ${C.border}`,background:"#120808",borderLeft:`3px solid ${C.red}`}}>
            <div style={{fontSize:11,color:C.red,fontWeight:700,marginBottom:3,fontFamily:mono}}>⚠ Duplicate (i,t) pairs — FE/FD blocked</div>
            {v.dups.slice(0,3).map((d,i)=><div key={i} style={{fontSize:11,color:C.textDim,fontFamily:mono}}>e={String(d.e)}, t={String(d.t)} → rows {d.rows.join(" & ")}</div>)}
          </div>}
          <div style={{padding:"0.65rem 1rem",borderTop:`1px solid ${C.border}`}}>
            <Lbl color={C.textMuted}>Availability Heatmap — <span style={{color:C.green}}>■ present</span> · <span style={{color:C.red}}>■ missing</span></Lbl>
            <Heatmap v={v}/>
          </div>
        </div>
      )}
      <div style={{display:"flex",gap:8}}>
        <Btn onClick={()=>setPanel({entityCol:ec,timeCol:tc,validation:v})} color={C.gold} v="solid" dis={!ec||!tc} ch={panel?"Update panel index":"Set panel index"}/>
        {panel&&<Btn onClick={()=>setPanel(null)} color={C.red} ch="Clear"/>}
      </div>
      {panel&&<div style={{marginTop:"1rem",padding:"0.5rem 0.75rem",background:C.surface,border:`1px solid ${C.border}`,borderRadius:3,fontSize:11,color:C.textDim,fontFamily:mono}}>
        i=<span style={{color:C.gold}}>{panel.entityCol}</span> · t=<span style={{color:C.blue}}>{panel.timeCol}</span>{panel.validation?.blockFE&&<span style={{color:C.red}}> · ⚠ FE blocked</span>}
      </div>}
    </div>
  );
}


export default PanelTab;
