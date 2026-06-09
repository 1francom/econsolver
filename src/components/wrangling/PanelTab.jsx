// ─── ECON STUDIO · components/wrangling/PanelTab.jsx ───────────────────────
import { useState, useMemo } from "react";
import { validatePanel } from "../../pipeline/validator.js";
import { useTheme, Lbl, Btn } from "./shared.jsx";

function Heatmap({v}){
  const { C, T } = useTheme();
  const MAX_E=12,MAX_T=10;
  const ents=v.entities.slice(0,MAX_E),ts=v.times.slice(0,MAX_T);
  return(
    <div style={{overflowX:"auto"}}>
      <table style={{borderCollapse:"collapse",fontSize: T.caption.fontSize,fontFamily: T.code.fontFamily}}>
        <thead><tr>
          <td style={{padding:"2px 4px",color:C.textMuted,fontSize: T.caption.fontSize}}>i\t</td>
          {ts.map(t=><td key={t} style={{padding:"2px 4px",color:C.textMuted,textAlign:"center",minWidth:26}}>{t}</td>)}
        </tr></thead>
        <tbody>{ents.map(e=>(
          <tr key={e}>{[<td key="e" style={{padding:"2px 4px",color:C.textDim,whiteSpace:"nowrap",paddingRight:8}}>{String(e).slice(0,8)}</td>,
            ...ts.map(t=>{const p=v.pres[e]?.[t];return<td key={t} style={{padding:"2px",textAlign:"center"}}><span style={{display:"inline-block",width:16,height:16,borderRadius:2,background:p?C.green:C.red,opacity:p?0.7:0.4}}/></td>;})]}</tr>
        ))}</tbody>
      </table>
      {(v.entities.length>MAX_E||v.times.length>MAX_T)&&<div style={{fontSize: T.caption.fontSize,color:C.textMuted,marginTop:4}}>Showing {Math.min(MAX_E,v.entities.length)} of {v.entities.length} entities, {Math.min(MAX_T,v.times.length)} of {v.times.length} periods.</div>}
    </div>
  );
}

// ─── PANEL TAB ────────────────────────────────────────────────────────────────
function PanelTab({rows,headers,panel,setPanel,onAdd}){
  const { C, T } = useTheme();
  const [ec,setEc]=useState(panel?.entityCol||""),[tc,setTc]=useState(panel?.timeCol||"");
  const [slotCol,setSlotCol]=useState("");
  const [outcomeCols,setOutcomeCols]=useState([]);
  const [staticCols,setStaticCols]=useState([]);
  const [fillValue,setFillValue]=useState(0);
  const v=useMemo(()=>ec&&tc?validatePanel(rows,ec,tc):null,[rows,ec,tc]);
  const panelPreview=useMemo(()=>{
    if(!ec||!tc)return null;
    const ents=new Set(rows.map(r=>r[ec]).filter(x=>x!==null&&x!==undefined&&x!==""));
    const times=new Set(rows.map(r=>r[tc]).filter(x=>x!==null&&x!==undefined&&x!==""));
    const slots=slotCol?new Set(rows.map(r=>r[slotCol]).filter(x=>x!==null&&x!==undefined&&x!=="")):new Set([null]);
    return {entities:ents.size,times:times.size,slots:slots.size,rows:ents.size*times.size*slots.size};
  },[rows,ec,tc,slotCol]);
  const bc={strongly_balanced:C.green,unbalanced:C.yellow,gaps:C.orange};
  const toggle=(col,setter,vals)=>setter(vals.includes(col)?vals.filter(c=>c!==col):[...vals,col]);
  const colBtn=(col,active,color,onClick)=><button key={col} onClick={onClick} style={{padding:"0.22rem 0.5rem",border:`1px solid ${active?color:C.border2}`,background:active?`${color}18`:"transparent",color:active?color:C.textDim,borderRadius:3,cursor:"pointer",fontSize: T.caption.fontSize,fontFamily: T.code.fontFamily}}>{active?"* ":""}{col}</button>;
  const addBalancedPanel=()=>onAdd?.({type:"balance_panel",entityCol:ec,timeCol:tc,slotCol,outcomeCols,staticCols,fillValue:Number(fillValue)});
  const bl={strongly_balanced:"Strongly Balanced ✓",unbalanced:"Unbalanced",gaps:"Gaps"};
  return(
    <div>
      <div style={{fontSize: T.code.fontSize,color:C.textDim,lineHeight:1.7,marginBottom:"1.2rem",padding:"0.65rem 1rem",background:C.surface,border:`1px solid ${C.border}`,borderLeft:`3px solid ${C.blue}`,borderRadius:4}}>
        Declare Entity (i) and Time (t) to enable FE/FD estimators and panel-aware operators.
      </div>
      <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:"1.2rem",marginBottom:"1.2rem"}}>
        {[["Entity ID (i)",ec,setEc,C.gold],["Time ID (t)",tc,setTc,C.blue]].map(([label,val,setter,color])=>(
          <div key={label}>
            <Lbl color={color}>{label}</Lbl>
            <div style={{display:"flex",flexWrap:"wrap",gap:4}}>
              {headers.map(h=><button key={h} onClick={()=>setter(h)} style={{padding:"0.28rem 0.6rem",border:`1px solid ${val===h?color:C.border2}`,background:val===h?`${color}18`:"transparent",color:val===h?color:C.textDim,borderRadius:3,cursor:"pointer",fontSize: T.code.fontSize,fontFamily: T.code.fontFamily,transition:"all 0.12s"}}>{val===h?"✓ ":""}{h}</button>)}
            </div>
          </div>
        ))}
      </div>
      {v&&(
        <div style={{border:`1px solid ${C.border}`,borderRadius:4,overflow:"hidden",marginBottom:"1.2rem"}}>
          <div style={{padding:"0.45rem 1rem",background:C.surface2,borderBottom:`1px solid ${C.border}`,fontSize: T.caption.fontSize,color:C.textMuted,letterSpacing:"0.18em",textTransform:"uppercase",fontFamily: T.code.fontFamily}}>Panel Diagnostics</div>
          <div style={{display:"grid",gridTemplateColumns:"repeat(5,1fr)",gap:1,background:C.border}}>
            {[{l:"Entities",v:v.entities.length,c:C.gold},{l:"Periods",v:v.times.length,c:C.blue},{l:"Obs",v:rows.length,c:C.text},{l:"Attrition",v:`${(v.attrition*100).toFixed(0)}%`,c:v.attrition>.1?C.red:C.green},{l:"Dups",v:v.dups.length,c:v.dups.length>0?C.red:C.green}].map(s=>(
              <div key={s.l} style={{background:C.surface,padding:"0.55rem 0.75rem"}}>
                <div style={{fontSize: T.caption.fontSize,color:C.textMuted,marginBottom:2,fontFamily: T.code.fontFamily,letterSpacing:"0.1em",textTransform:"uppercase"}}>{s.l}</div>
                <div style={{fontSize: T.h2.fontSize,color:s.c,fontFamily: T.code.fontFamily}}>{s.v}</div>
              </div>
            ))}
          </div>
          <div style={{padding:"0.65rem 1rem",borderTop:`1px solid ${C.border}`,display:"flex",gap:8,alignItems:"center"}}>
            <span style={{width:8,height:8,borderRadius:"50%",background:bc[v.balance]||C.textMuted,display:"inline-block",flexShrink:0}}/>
            <span style={{fontSize: T.code.fontSize,color:bc[v.balance]||C.textMuted,fontFamily: T.code.fontFamily}}>{bl[v.balance]||v.balance}</span>
            {v.attrition>0&&<span style={{fontSize: T.code.fontSize,color:C.textMuted,fontFamily: T.code.fontFamily}}>· t₀: {v.at0} → tN: {v.atN} ({(v.attrition*100).toFixed(0)}% lost)</span>}
          </div>
          {v.dups.length>0&&<div style={{padding:"0.65rem 1rem",borderTop:`1px solid ${C.border}`,background:`${C.yellow}18`,borderLeft:`3px solid ${C.yellow}`}}>
            <div style={{fontSize: T.code.fontSize,color:C.yellow,fontWeight:700,marginBottom:3,fontFamily: T.code.fontFamily}}>⚠ Duplicate (i,t) pairs — FD blocked, FE/TWFE unaffected</div>
            {v.dups.slice(0,3).map((d,i)=><div key={i} style={{fontSize: T.code.fontSize,color:C.textDim,fontFamily: T.code.fontFamily}}>e={String(d.e)}, t={String(d.t)} → rows {d.rows.join(" & ")}</div>)}
          </div>}
          <div style={{padding:"0.65rem 1rem",borderTop:`1px solid ${C.border}`}}>
            <Lbl color={C.textMuted}>Availability Heatmap — <span style={{color:C.green}}>■ present</span> · <span style={{color:C.red}}>■ missing</span></Lbl>
            <Heatmap v={v}/>
          </div>
        </div>
      )}
      <div style={{border:`1px solid ${C.border}`,borderRadius:4,overflow:"hidden",marginBottom:"1.2rem"}}>
        <div style={{padding:"0.45rem 1rem",background:C.surface2,borderBottom:`1px solid ${C.border}`,fontSize: T.caption.fontSize,color:C.textMuted,letterSpacing:"0.18em",textTransform:"uppercase",fontFamily: T.code.fontFamily}}>Balanced Panel Builder</div>
        <div style={{padding:"0.75rem 1rem",display:"flex",flexDirection:"column",gap:10}}>
          <div style={{display:"grid",gridTemplateColumns:"1fr 1fr 1fr",gap:10}}>
            <div>
              <Lbl color={C.violet}>Slot / franja column</Lbl>
              <select value={slotCol} onChange={e=>setSlotCol(e.target.value)} style={{width:"100%",padding:"0.35rem 0.5rem",background:C.surface,border:`1px solid ${C.border2}`,borderRadius:3,color:C.text,fontFamily: T.code.fontFamily,fontSize: T.code.fontSize}}>
                <option value="">none</option>
                {headers.map(h=><option key={h} value={h}>{h}</option>)}
              </select>
            </div>
            <div>
              <Lbl color={C.green}>Fill missing outcomes</Lbl>
              <input type="number" value={fillValue} onChange={e=>setFillValue(e.target.value)} style={{width:"100%",padding:"0.35rem 0.5rem",background:C.surface,border:`1px solid ${C.border2}`,borderRadius:3,color:C.text,fontFamily: T.code.fontFamily,fontSize: T.code.fontSize}}/>
            </div>
            <div style={{fontSize: T.code.fontSize,color:C.textDim,fontFamily: T.code.fontFamily,alignSelf:"end",lineHeight:1.6}}>
              {panelPreview?`${panelPreview.entities} grids x ${panelPreview.times} dates x ${panelPreview.slots} slots = ${panelPreview.rows.toLocaleString()} rows`:"select i and t first"}
            </div>
          </div>
          <div>
            <Lbl color={C.gold}>Outcome columns filled with zero</Lbl>
            <div style={{display:"flex",flexWrap:"wrap",gap:4}}>
              {headers.filter(h=>h!==ec&&h!==tc&&h!==slotCol).map(h=>colBtn(h,outcomeCols.includes(h),C.gold,()=>toggle(h,setOutcomeCols,outcomeCols)))}
            </div>
          </div>
          <div>
            <Lbl color={C.blue}>Static controls copied by entity</Lbl>
            <div style={{display:"flex",flexWrap:"wrap",gap:4}}>
              {headers.filter(h=>h!==ec&&h!==tc&&h!==slotCol&&!outcomeCols.includes(h)).map(h=>colBtn(h,staticCols.includes(h),C.blue,()=>toggle(h,setStaticCols,staticCols)))}
            </div>
          </div>
          <Btn onClick={addBalancedPanel} color={C.green} v="solid" dis={!onAdd||!ec||!tc||outcomeCols.length===0} ch="Add balanced panel step"/>
        </div>
      </div>
      <div style={{display:"flex",gap:8}}>
        <Btn onClick={()=>setPanel({entityCol:ec,timeCol:tc,validation:v})} color={C.gold} v="solid" dis={!ec||!tc} ch={panel?"Update panel index":"Set panel index"}/>
        {panel&&<Btn onClick={()=>setPanel(null)} color={C.red} ch="Clear"/>}
      </div>
      {panel&&<div style={{marginTop:"1rem",padding:"0.5rem 0.75rem",background:C.surface,border:`1px solid ${C.border}`,borderRadius:3,fontSize: T.code.fontSize,color:C.textDim,fontFamily: T.code.fontFamily}}>
        i=<span style={{color:C.gold}}>{panel.entityCol}</span> · t=<span style={{color:C.blue}}>{panel.timeCol}</span>{panel.validation?.blockFD&&<span style={{color:C.yellow}}> · ⚠ FD blocked</span>}
      </div>}
    </div>
  );
}


export default PanelTab;
