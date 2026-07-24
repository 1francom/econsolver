// ─── ECON STUDIO · components/wrangling/SortRowsSection.jsx ────────────────
// Row sort (dplyr::arrange) as a self-contained collapsible section. Lives in
// the Clean tab (below Filter rows); owns its own multi-key sort state.
import { useState } from "react";
import { useTheme, Lbl, Collapsible, Btn } from "./shared.jsx";

function SortRowsSection({ headers, onAdd }) {
  const { C, T } = useTheme();
  const [arrCols, setArrCols] = useState([]); // [{col, dir}] sort keys

  return (
    <Collapsible title="Sort rows" color={C.blue}>
      <div>
        <div style={{padding:"0.65rem 1rem",background:C.surface,
          border:`1px solid ${C.border}`,borderLeft:`3px solid ${C.blue}`,
          borderRadius:4,marginBottom:"1.2rem",fontSize: T.code.fontSize,color:C.textDim,lineHeight:1.6}}>
          Sort rows by one or more columns. Equivalent to{" "}
          <code style={{color:C.green}}>dplyr::arrange()</code>.{" "}
          Multiple keys are applied in priority order — first key wins.
        </div>

        <div style={{display:"flex",alignItems:"center",gap:8,marginBottom:"0.7rem"}}>
          <Lbl mb={0} color={C.blue}>Sort keys</Lbl>
        </div>

        {arrCols.length === 0 && (
          <div style={{padding:"0.65rem 1rem",background:C.surface,
            border:`1px dashed ${C.border2}`,borderRadius:4,
            fontSize: T.code.fontSize,color:C.textMuted,fontFamily: T.code.fontFamily,marginBottom:"0.8rem"}}>
            Add at least one sort key below.
          </div>
        )}

        <div style={{display:"flex",flexDirection:"column",gap:5,marginBottom:"0.9rem"}}>
          {arrCols.map((ak, i) => (
            <div key={i} style={{display:"grid",
              gridTemplateColumns:"20px 1fr auto auto",
              gap:6,alignItems:"center",padding:"0.45rem 0.65rem",
              background:C.surface2,border:`1px solid ${C.border}`,borderRadius:4}}>
              <div style={{display:"flex",flexDirection:"column",gap:1}}>
                <button onClick={()=>setArrCols(p=>{const n=[...p];if(i>0){[n[i],n[i-1]]=[n[i-1],n[i]];}return n;})}
                  disabled={i===0}
                  style={{background:"transparent",border:"none",
                    color:i===0?C.textMuted:C.textDim,cursor:i===0?"default":"pointer",
                    fontSize: T.caption.fontSize,padding:"1px 2px",lineHeight:1}}>▲</button>
                <button onClick={()=>setArrCols(p=>{const n=[...p];if(i<p.length-1){[n[i],n[i+1]]=[n[i+1],n[i]];}return n;})}
                  disabled={i===arrCols.length-1}
                  style={{background:"transparent",border:"none",
                    color:i===arrCols.length-1?C.textMuted:C.textDim,
                    cursor:i===arrCols.length-1?"default":"pointer",
                    fontSize: T.caption.fontSize,padding:"1px 2px",lineHeight:1}}>▼</button>
              </div>
              <select value={ak.col}
                onChange={e=>setArrCols(p=>p.map((x,j)=>j!==i?x:{...x,col:e.target.value}))}
                style={{padding:"0.38rem 0.6rem",background:C.surface2,
                  border:`1px solid ${C.border2}`,borderRadius:3,color:C.text,
                  fontFamily: T.code.fontFamily,fontSize: T.code.fontSize,outline:"none",width:"100%"}}>
                <option value="">— column —</option>
                {headers.map(h=><option key={h} value={h}>{h}</option>)}
              </select>
              <div style={{display:"flex",gap:3}}>
                {[["asc","↑ asc"],["desc","↓ desc"]].map(([d,l])=>(
                  <button key={d}
                    onClick={()=>setArrCols(p=>p.map((x,j)=>j!==i?x:{...x,dir:d}))}
                    style={{padding:"0.22rem 0.5rem",fontSize: T.caption.fontSize,fontFamily: T.code.fontFamily,
                      border:`1px solid ${ak.dir===d?C.blue:C.border2}`,
                      background:ak.dir===d?`${C.blue}18`:"transparent",
                      color:ak.dir===d?C.blue:C.textDim,
                      borderRadius:2,cursor:"pointer",transition:"all 0.1s"}}>{l}</button>
                ))}
              </div>
              <button onClick={()=>setArrCols(p=>p.filter((_,j)=>j!==i))}
                style={{background:"transparent",border:`1px solid ${C.border2}`,
                  borderRadius:2,color:C.textMuted,cursor:"pointer",
                  fontSize: T.code.fontSize,padding:"0.2rem 0.4rem"}}>✕</button>
            </div>
          ))}
        </div>

        {/* Quick-add chips */}
        <div style={{display:"flex",flexWrap:"wrap",gap:3,marginBottom:"1rem"}}>
          <span style={{fontSize: T.caption.fontSize,color:C.textMuted,fontFamily: T.code.fontFamily,
            alignSelf:"center",marginRight:2}}>add:</span>
          {headers.filter(h=>!arrCols.some(ak=>ak.col===h)).map(h=>(
            <button key={h} onClick={()=>setArrCols(p=>[...p,{col:h,dir:"asc"}])}
              style={{padding:"0.18rem 0.5rem",border:`1px solid ${C.border2}`,
                background:"transparent",color:C.textDim,borderRadius:2,
                cursor:"pointer",fontSize: T.caption.fontSize,fontFamily: T.code.fontFamily,transition:"all 0.1s"}}
              onMouseEnter={e=>{e.currentTarget.style.borderColor=C.blue;e.currentTarget.style.color=C.blue;}}
              onMouseLeave={e=>{e.currentTarget.style.borderColor=C.border2;e.currentTarget.style.color=C.textDim;}}>
              + {h}
            </button>
          ))}
        </div>

        {/* dplyr preview */}
        {arrCols.some(ak=>ak.col) && (
          <div style={{padding:"0.55rem 0.85rem",background:`${C.blue}08`,
            border:`1px solid ${C.blue}30`,borderRadius:3,marginBottom:"1rem",
            fontSize: T.code.fontSize,fontFamily: T.code.fontFamily,color:C.textDim}}>
            <span style={{color:C.gold}}>→</span>{" "}
            arrange(<span style={{color:C.blue}}>
              {arrCols.filter(ak=>ak.col).map((ak,i,arr)=>(
                <span key={i}>
                  {ak.dir==="desc"?<span>desc(<span style={{color:C.text}}>{ak.col}</span>)</span>:<span style={{color:C.text}}>{ak.col}</span>}
                  {i<arr.length-1?", ":""}
                </span>
              ))}
            </span>)
          </div>
        )}

        <Btn
          onClick={()=>{
            const valid = arrCols.filter(ak=>ak.col);
            if(!valid.length) return;
            // Emit in reverse so first key has highest priority after chaining
            [...valid].reverse().forEach(ak=>{
              onAdd({type:"arrange",col:ak.col,dir:ak.dir,
                desc:`sort ${ak.col} ${ak.dir==="desc"?"↓":"↑"}`});
            });
            setArrCols([]);
          }}
          color={C.blue} v="solid"
          dis={!arrCols.some(ak=>ak.col)}
          ch={`Sort rows →${arrCols.filter(ak=>ak.col).length>1?` (${arrCols.filter(ak=>ak.col).length} keys)`:""}`}
        />
      </div>
    </Collapsible>
  );
}

export default SortRowsSection;
