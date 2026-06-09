// ─── ECON STUDIO · components/wrangling/FeatureTab.jsx ─────────────────────
import { useState, useCallback, useEffect, useRef, useMemo } from "react";
import { useTheme, Lbl, Tabs, Btn } from "./shared.jsx";
import { computeColStats } from "../../services/data/duckdb.js";
const arrMin = a => a.reduce((m, v) => v < m ? v : m, a[0]);
const arrMax = a => a.reduce((m, v) => v > m ? v : m, a[0]);
import FormatTab from "./FormatTab.jsx";
import VectorAssignForm from "./VectorAssignForm.jsx";
import { isSafeExpr } from "../../pipeline/exprGuard.js";

// ─── MUTATE SUB-TAB ───────────────────────────────────────────────────────────
// dplyr-style free-form expression evaluator.
// Group by: when set, column variables become arrays and group helpers
// (any/all/sum/mean/min/max/count/first/last) are injected.
// Security: new Function() is an intentional expression sandbox here —
// same pattern used throughout runner.js, FormatTab, CalculateTab.
function MutateSubTab({rows, headers, info, onAdd}){
  const { C, T } = useTheme();
  const [steps,     setSteps]  = useState([{name:"",expr:""}]);
  const [activeIdx, setActive] = useState(0);
  const [refOpen,   setRefOpen]= useState(false);
  const [gmBy,      setGmBy]   = useState([]);
  const [gmFilter,  setGmFilter]= useState([]);
  const isGrouped = gmBy.length > 0;

  // Helpers to edit the steps list
  const setStepField = (i, field, val) => setSteps(ss => ss.map((s,j) => j===i ? {...s,[field]:val} : s));
  const addStep      = ()  => { setSteps(ss => [...ss, {name:"",expr:""}]); setActive(steps.length); };
  const removeStep   = (i) => { setSteps(ss => ss.filter((_,j) => j!==i)); setActive(a => Math.min(a, Math.max(0, steps.length-2))); };

  // Active step shorthand
  const activeName = steps[activeIdx]?.name ?? "";
  const activeExpr = steps[activeIdx]?.expr ?? "";
  const safeH = useMemo(()=>headers.filter(h=>/^[a-zA-Z_$][a-zA-Z0-9_$]*$/.test(h)),[headers]);

  // Per-row helpers (scalar context)
  const ROW_H={
    ifelse:(c,t,f)=>c?t:f,
    between:(x,lo,hi)=>(typeof x==="number"&&x>=lo&&x<=hi)?1:0,
    log:(x)=>(typeof x==="number"&&x>0)?Math.log(x):null,
    log2:(x)=>(typeof x==="number"&&x>0)?Math.log2(x):null,
    log10:(x)=>(typeof x==="number"&&x>0)?Math.log10(x):null,
    sqrt:(x)=>(typeof x==="number"&&x>=0)?Math.sqrt(x):null,
    exp:(x)=>typeof x==="number"?Math.exp(x):null,
    abs:(x)=>typeof x==="number"?Math.abs(x):null,
    round:(x,d=0)=>typeof x==="number"?Math.round(x*10**d)/10**d:null,
    floor:(x)=>typeof x==="number"?Math.floor(x):null,
    ceil:(x)=>typeof x==="number"?Math.ceil(x):null,
    sign:(x)=>typeof x==="number"?Math.sign(x):null,
    isna:(x)=>(x===null||x===undefined)?1:0,
    notna:(x)=>(x!==null&&x!==undefined)?1:0,
    coalesce:(...a)=>a.find(v=>v!==null&&v!==undefined)??null,
    pmin:(a,b)=>(typeof a==="number"&&typeof b==="number")?Math.min(a,b):null,
    pmax:(a,b)=>(typeof a==="number"&&typeof b==="number")?Math.max(a,b):null,
    min:(a,b)=>(typeof a==="number"&&typeof b==="number")?Math.min(a,b):null,
    max:(a,b)=>(typeof a==="number"&&typeof b==="number")?Math.max(a,b):null,
    pow:(x,n)=>(typeof x==="number"&&typeof n==="number")?Math.pow(x,n):null,
    clamp:(x,lo,hi)=>typeof x==="number"?Math.max(lo,Math.min(hi,x)):null,
    rescale:(x,o0,o1,n0=0,n1=1)=>(typeof x==="number"&&o1!==o0)?(n0+(x-o0)*(n1-n0)/(o1-o0)):null,
    case_when:(...p)=>{for(let i=0;i<p.length-1;i+=2){if(p[i])return p[i+1];}return p.length%2===1?p[p.length-1]:null;},
    as_integer:(x)=>{if(x===null||x===undefined)return null;const n=Number(x);return isFinite(n)?Math.trunc(n):null;},
    as_factor: (x)=>(x===null||x===undefined)?null:String(x),
  };

  // Group-aware helpers (array context) — injected when Group by is set
  function makeGH(filtRows){
    const ns=col=>filtRows.map(r=>r[col]).filter(v=>v!==null&&v!==undefined&&isFinite(+v)).map(Number);
    const arr2n=a=>Array.isArray(a)?a.filter(v=>isFinite(+v)).map(Number):ns(a);
    const truthy=v=>v!==null&&v!==undefined&&v!==0&&v!==false&&v!=="";
    return{
      any:  a=>Array.isArray(a)?(a.some(truthy)?1:0):typeof a==="string"?(filtRows.some(r=>truthy(r[a]))?1:0):(a?1:0),
      all:  a=>Array.isArray(a)?((a.length>0&&a.every(truthy))?1:0):typeof a==="string"?((filtRows.length>0&&filtRows.every(r=>truthy(r[a])))?1:0):(a?1:0),
      sum:  a=>{const n=arr2n(a);return n.reduce((s,v)=>s+v,0);},
      mean: a=>{const n=arr2n(a);return n.length?n.reduce((s,v)=>s+v,0)/n.length:null;},
      min:  a=>{const n=arr2n(a);return n.length?arrMin(n):null;},
      max:  a=>{const n=arr2n(a);return n.length?arrMax(n):null;},
      count:()=>filtRows.length,
      first:a=>Array.isArray(a)?(a[0]??null):(filtRows[0]?.[a]??null),
      last: a=>{if(Array.isArray(a))return a[a.length-1]??null;return filtRows[filtRows.length-1]?.[a]??null;},
    };
  }

  function matchFilt(r,{col:c,op,val}){
    const rv=r[c],nv=Number(val);
    if(op==="notna")return rv!==null&&rv!==undefined;
    if(op==="isna") return rv===null||rv===undefined;
    if(op==="=="||op==="=")return String(rv)===String(val)||rv===nv;
    if(op==="!="||op==="<>")return String(rv)!==String(val)&&rv!==nv;
    if(op===">") return Number(rv)> nv;
    if(op===">=")return Number(rv)>=nv;
    if(op==="<") return Number(rv)< nv;
    if(op==="<=")return Number(rv)<=nv;
    return true;
  }

  // Live preview — tracks active step
  const preview=useMemo(()=>{
    const e=activeExpr.trim();if(!e)return null;
    if(!isSafeExpr(e))return{error:"Disallowed identifier (e.g. fetch, localStorage, constructor)",vals:[],grouped:false};
    if(!isGrouped){
      const pN=[...Object.keys(ROW_H),"row",...safeH];
      let fn;try{fn=new Function(...pN,`"use strict";return(${e});`);}catch(err){return{error:`Syntax: ${err.message}`,vals:[],grouped:false};}
      const vals=[],errs=[];
      rows.slice(0,6).forEach(r=>{
        try{let v=fn(...Object.values(ROW_H),r,...safeH.map(h=>r[h]??null));if(v===undefined||(typeof v==="number"&&!isFinite(v)))v=null;vals.push(v);}
        catch(err){errs.push(err.message);vals.push(null);}
      });
      const rawErr=errs.length===rows.slice(0,6).length?errs[0]:null;
      const GRP_FNS=['any','all','sum','mean','min','max','count','first','last'];
      const matchedFn=rawErr&&GRP_FNS.find(f=>rawErr.includes(`${f} is not defined`));
      const err=matchedFn?`${matchedFn}() is a group function — enable "Group by" above`:rawErr;
      return{vals,error:err,hasResult:vals.some(v=>v!==null),grouped:false};
    }
    // Group mode — evaluate once per group
    const makeKey=r=>gmBy.map(b=>String(r[b]??"")).join("\x00");
    const gMap=new Map();
    rows.forEach(r=>{const k=makeKey(r);if(!gMap.has(k))gMap.set(k,[]);gMap.get(k).push(r);});
    const gKeys=[...gMap.keys()].slice(0,4);
    const vals=[],labels=[];
    for(const k of gKeys){
      const grp=gMap.get(k);
      const filt=gmFilter.length?grp.filter(r=>gmFilter.every(c=>matchFilt(r,c))):grp;
      const gh=makeGH(filt);
      const colArrs={};safeH.forEach(h=>{colArrs[h]=filt.map(r=>r[h]);});
      const pN=[...Object.keys(gh),...safeH];
      const pV=[...Object.values(gh),...safeH.map(h=>colArrs[h])];
      let v=null;
      try{const fn2=new Function(...pN,`"use strict";return(${e});`);v=fn2(...pV);if(v===undefined||(typeof v==="number"&&!isFinite(v)))v=null;}catch(_){}
      vals.push(v);labels.push(gmBy.map(b=>String(grp[0][b]??"")).join(" · "));
    }
    return{vals,labels,hasResult:vals.some(v=>v!==null),grouped:true,error:null};
  // eslint-disable-next-line react-hooks/exhaustive-deps
  },[activeExpr,rows,safeH,isGrouped,gmBy,gmFilter]);

  function doAddAll(){
    const valid = steps.filter(s => s.name.trim() && s.expr.trim());
    if(!valid.length) return;
    const byStr = gmBy.join(", ");
    const filtStr = gmFilter.length ? ` | ${gmFilter.map(c=>`${c.col}${c.op}${c.val}`).join(" & ")}` : "";
    valid.forEach(({name:n, expr:e}) => {
      if(!isGrouped){
        onAdd({type:"mutate", nn:n, expr:e, desc:`${n} = ${e}`});
      } else {
        onAdd({type:"grouped_mutate", by:gmBy, fn:"expr", expr:e, filter:gmFilter, newCol:n,
          desc:`group_by(${byStr})${filtStr} → ${n} = ${e}`});
      }
    });
    setSteps([{name:"",expr:""}]); setActive(0);
  }

  const canAdd = steps.some(s => s.name.trim() && s.expr.trim()) && !preview?.error;
  const inpS={width:"100%",boxSizing:"border-box",padding:"0.45rem 0.7rem",background:C.surface2,
    border:`1px solid ${C.border2}`,borderRadius:3,color:C.text,fontFamily: T.code.fontFamily,fontSize: T.code.fontSize,outline:"none"};

  const OPS=[["==","=="],["!=","!="],[">=",">="],["<=","<="],[">"," >"],["<"," <"]];
  function addFilt(){setGmFilter(fs=>[...fs,{col:headers[0]||"",op:"==",val:""}]);}
  function rmFilt(i){setGmFilter(fs=>fs.filter((_,j)=>j!==i));}
  function setFilt(i,k,v){setGmFilter(fs=>fs.map((f,j)=>j===i?{...f,[k]:v}:f));}

  // items: [display, description, insertOnClick]
  //   insertOnClick omitted → insert fn name + "("
  //   insertOnClick = null  → reference only, not clickable
  const H_SECTIONS=[
    {label:"Operators",color:C.gold,items:[
      ["== and !=","Equality / inequality  ·  col == 0  ·  col != 'yes'",null],
      ["&& and ||","Logical AND / OR  ·  a > 0 && b < 10  ·  not & or |",null],
      ["> < >= <=","Numeric comparisons  ·  year >= 2015  ·  age < 65",null],
      ["** * / + -","Arithmetic  ·  gdp ** 2  ·  income / cpi * 100",null],
      ["!","Logical NOT  ·  !isna(x)  ·  !(a == b)",null],
    ]},
    {label:"Conditional",color:C.gold,items:[
      ["ifelse(cond, a, b)","cond uses == && etc.  ·  a and b can be columns  ·  ifelse(muni == 47, 1, treat)"],
      ["between(x, lo, hi)","1 if lo ≤ x ≤ hi, else 0  ·  between(age, 18, 65)"],
      ["case_when(c1,v1, c2,v2, …, fallback)","First matching condition wins  ·  last arg is default value"],
    ]},
    {label:"Math",color:C.blue,items:[
      ["log(x)  log2(x)  log10(x)","Natural / base-2 / base-10 log  ·  null if x ≤ 0"],
      ["sqrt(x)  exp(x)  abs(x)  sign(x)","√x · eˣ · |x| · sign (−1/0/1)"],
      ["round(x, d)  floor(x)  ceil(x)","d = decimal places  ·  round(price, 2)"],
      ["clamp(x, lo, hi)","Cap x to range [lo, hi]  ·  clamp(wage, 0, 500)"],
      ["pmin(a, b)  pmax(a, b)","Row-wise min / max of two values"],
      ["rescale(x, oMin, oMax, nMin=0, nMax=1)","Linear remap  ·  rescale(score, 0, 100)"],
    ]},
    {label:"Null handling",color:C.teal,items:[
      ["isna(x)  notna(x)","1 if null · 1 if not null"],
      ["coalesce(a, b, …)","First non-null arg  ·  coalesce(val, 0)"],
    ]},
    {label:"Type casting",color:C.gold,items:[
      ["as_integer(x)","Truncate to integer · null if not numeric  ·  as_integer(2.9) → 2  ·  as_integer('7') → 7"],
      ["as_factor(x)","Convert to categorical string · use for coded numerics  ·  as_factor(region_code)"],
    ]},
    {label:"Group functions — active when Group by is set",color:C.purple,items:[
      ["any(col)","1 if any row in group has a non-zero value  ·  use Filter for row conditions"],
      ["all(col)","1 if all rows in group have a non-zero value"],
      ["sum(col)  mean(col)","Sum / mean of col across the group"],
      ["min(col)  max(col)","Min / max of col within the group"],
      ["count()","Number of rows in group (respects Filter)"],
      ["first(col)  last(col)","First / last value of col in the group"],
    ]},
  ];
  const EXAMPLES=[["gdp_per_cap","gdp / population"],["log_wage","log(wage)"],["treat_post","treated * post"],
    ["income_real","income / cpi * 100"],["age_sq","age ** 2"],["hi_edu","ifelse(educ >= 16, 1, 0)"],
    ["wage_clamp","clamp(wage, 0, 500)"],["size_cat","case_when(area < 10, 'small', area < 50, 'medium', 'large')"],
    ["year_int","as_integer(year)"],["region_cat","as_factor(region_code)"]];
  const G_EXAMPLES=[["treat","any(trarrprop)"],["muni_gdp","sum(gdp)"],["avg_income","mean(income)"],["n_obs","count()"]];

  return(
    <div>
      {/* Context note */}
      <div style={{padding:"0.5rem 0.9rem",background:C.surface,border:`1px solid ${C.border}`,
        borderLeft:`3px solid ${isGrouped?C.purple:C.green}`,borderRadius:4,marginBottom:"1rem",
        fontSize: T.caption.fontSize,color:C.textMuted,fontFamily: T.code.fontFamily,lineHeight:1.6}}>
        {isGrouped
          ?<>Grouped mutate — <span style={{color:C.purple}}>group_by() %&gt;% mutate()</span>. Columns become <b>arrays</b> within each group. Use <span style={{color:C.purple}}>any/all/sum/mean/min/max/count/first/last</span>. All rows kept.</>
          :<>dplyr <span style={{color:C.green}}>mutate()</span> — columns are per-row scalars. Math operators (+, −, *, /, **) and helpers: <span style={{color:C.blue}}>log sqrt exp abs pow round min max floor ceil clamp ifelse case_when</span>. Ctrl+Enter to apply.</>}
      </div>

      {/* Group by + filter */}
      <div style={{marginBottom:"1rem",padding:"0.65rem 0.85rem",
        background:isGrouped?`${C.purple}06`:C.surface2,
        border:`1px solid ${isGrouped?C.purple+"40":C.border}`,borderRadius:4}}>
        <div style={{display:"flex",alignItems:"center",gap:8,marginBottom:6}}>
          <span style={{fontSize: T.caption.fontSize,color:isGrouped?C.purple:C.textMuted,letterSpacing:"0.18em",textTransform:"uppercase",fontFamily: T.code.fontFamily,fontWeight:isGrouped?700:400}}>
            Group by
          </span>
          {isGrouped&&<button onClick={()=>{setGmBy([]);setGmFilter([]);}}
            style={{fontSize: T.caption.fontSize,color:C.textMuted,background:"none",border:"none",cursor:"pointer",fontFamily: T.code.fontFamily}}>✕ clear</button>}
        </div>
        <div style={{display:"flex",flexWrap:"wrap",gap:4}}>
          {headers.map(h=>(
            <button key={h} onClick={()=>setGmBy(bs=>bs.includes(h)?bs.filter(b=>b!==h):[...bs,h])}
              style={{padding:"0.2rem 0.5rem",border:`1px solid ${gmBy.includes(h)?C.purple:C.border}`,
                background:gmBy.includes(h)?`${C.purple}18`:"transparent",
                color:gmBy.includes(h)?C.purple:C.textMuted,
                borderRadius:3,cursor:"pointer",fontSize: T.caption.fontSize,fontFamily: T.code.fontFamily,transition:"all 0.1s"}}>
              {gmBy.includes(h)?"✓ ":""}{h}
            </button>
          ))}
        </div>
        {isGrouped&&(
          <div style={{marginTop:"0.65rem",borderTop:`1px solid ${C.purple}20`,paddingTop:"0.65rem"}}>
            <div style={{display:"flex",alignItems:"center",gap:8,marginBottom:gmFilter.length?6:0}}>
              <span style={{fontSize: T.caption.fontSize,color:C.textMuted,letterSpacing:"0.15em",textTransform:"uppercase",fontFamily: T.code.fontFamily}}>Filter within group</span>
              <button onClick={addFilt} style={{fontSize: T.caption.fontSize,color:C.purple,background:"none",border:`1px solid ${C.purple}40`,borderRadius:3,cursor:"pointer",fontFamily: T.code.fontFamily,padding:"0.1rem 0.35rem"}}>+ condition</button>
              {!gmFilter.length&&<span style={{fontSize: T.caption.fontSize,color:C.textMuted,fontFamily: T.code.fontFamily}}>— none (aggregates use all group rows)</span>}
            </div>
            {gmFilter.map((f,i)=>(
              <div key={i} style={{display:"flex",gap:4,alignItems:"center",marginBottom:4}}>
                <select value={f.col} onChange={e=>setFilt(i,"col",e.target.value)}
                  style={{flex:2,padding:"0.22rem 0.4rem",background:C.surface,border:`1px solid ${C.border2}`,borderRadius:3,color:C.text,fontFamily: T.code.fontFamily,fontSize: T.caption.fontSize}}>
                  {headers.map(h=><option key={h} value={h}>{h}</option>)}
                </select>
                <select value={f.op} onChange={e=>setFilt(i,"op",e.target.value)}
                  style={{flex:"0 0 48px",padding:"0.22rem 0.3rem",background:C.surface,border:`1px solid ${C.border2}`,borderRadius:3,color:C.text,fontFamily: T.code.fontFamily,fontSize: T.caption.fontSize}}>
                  {OPS.map(([v,l])=><option key={v} value={v}>{l}</option>)}
                </select>
                <input value={f.val} onChange={e=>setFilt(i,"val",e.target.value)} placeholder="value"
                  style={{flex:2,padding:"0.22rem 0.4rem",background:C.surface,border:`1px solid ${C.border2}`,borderRadius:3,color:C.text,fontFamily: T.code.fontFamily,fontSize: T.caption.fontSize,outline:"none"}}/>
                <button onClick={()=>rmFilt(i)} style={{color:C.textMuted,background:"none",border:"none",cursor:"pointer",fontSize: T.code.fontSize}}>✕</button>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Multi-step list */}
      <div style={{marginBottom:8}}>
        {steps.length===1&&(
          <div style={{display:"grid",gridTemplateColumns:"9px 200px 1fr",gap:6,marginBottom:4,paddingLeft:2,alignItems:"center"}}>
            <span/>
            <Lbl color={C.green}>New column name</Lbl>
            <Lbl color={C.green}>Expression</Lbl>
          </div>
        )}
        {steps.length>1&&(
          <div style={{display:"grid",gridTemplateColumns:"9px 200px 1fr 22px",gap:6,marginBottom:4,paddingLeft:2,alignItems:"center"}}>
            <span/>
            <Lbl color={C.green}>New column name</Lbl>
            <Lbl color={C.green}>Expression</Lbl>
            <span/>
          </div>
        )}
        {steps.map((s,i)=>(
          <div key={i} onClick={()=>setActive(i)}
            style={{display:"grid",gridTemplateColumns:steps.length>1?"9px 200px 1fr 22px":"9px 200px 1fr",
              gap:6,marginBottom:5,alignItems:"center",
              background:i===activeIdx?`${C.green}06`:"transparent",
              borderRadius:3,padding:"0 0 0 0"}}>
            <span style={{fontSize: T.caption.fontSize,color:C.textMuted,fontFamily: T.code.fontFamily,textAlign:"right",paddingRight:2}}>{i+1}</span>
            <input value={s.name} placeholder="e.g. treat"
              onChange={e=>{setStepField(i,"name",e.target.value);setActive(i);}}
              onFocus={()=>setActive(i)}
              style={{...inpS,borderColor:i===activeIdx?`${C.green}70`:inpS.borderColor}}/>
            <textarea value={s.expr} rows={2}
              placeholder={isGrouped?"e.g. any(trarrprop)":"e.g. log(wage) * 2 + educ\ne.g. income > 0 ? income : 0"}
              onChange={e=>{setStepField(i,"expr",e.target.value);setActive(i);}}
              onFocus={()=>setActive(i)}
              onKeyDown={e=>{if(e.key==="Enter"&&e.ctrlKey&&canAdd)doAddAll();}}
              style={{...inpS,resize:"vertical",lineHeight:1.5,borderColor:i===activeIdx?`${C.green}70`:inpS.borderColor}}/>
            {steps.length>1&&(
              <button onClick={e=>{e.stopPropagation();removeStep(i);}}
                style={{background:"none",border:"none",cursor:"pointer",color:C.textMuted,fontSize: T.body.fontSize,lineHeight:1,padding:0}}>✕</button>
            )}
          </div>
        ))}
      </div>

      {/* Script preview + actions */}
      <div style={{display:"flex",alignItems:"center",gap:8,marginBottom:"1rem",flexWrap:"wrap"}}>
        <div style={{flex:1,padding:"0.4rem 0.75rem",background:C.surface,border:`1px solid ${C.border}`,borderRadius:3,fontSize: T.code.fontSize,color:C.textDim,fontFamily: T.code.fontFamily,lineHeight:1.9,minHeight:28}}>
          {steps.filter(s=>s.name.trim()&&s.expr.trim()).length===0
            ? <span style={{color:C.textMuted,fontStyle:"italic"}}>formula preview</span>
            : steps.filter(s=>s.name.trim()&&s.expr.trim()).map((s,i)=>(
                <div key={i}>
                  {isGrouped&&i===0&&<span style={{color:C.purple,marginRight:6,fontSize: T.caption.fontSize}}>group_by({gmBy.join(",")})</span>}
                  <span style={{color:C.green}}>{s.name.trim()}</span>
                  <span style={{color:C.border2,margin:"0 6px"}}>=</span>
                  <span style={{color:C.text}}>{s.expr.trim()}</span>
                </div>
              ))
          }
        </div>
        <button onClick={addStep}
          style={{padding:"0.38rem 0.75rem",background:"none",border:`1px solid ${C.border2}`,borderRadius:3,
            color:C.textMuted,fontFamily: T.code.fontFamily,fontSize: T.caption.fontSize,cursor:"pointer",whiteSpace:"nowrap"}}
          onMouseEnter={e=>{e.currentTarget.style.borderColor=C.green;e.currentTarget.style.color=C.green;}}
          onMouseLeave={e=>{e.currentTarget.style.borderColor=C.border2;e.currentTarget.style.color=C.textMuted;}}>
          + Add step
        </button>
        <Btn onClick={doAddAll} color={C.green} v="solid" dis={!canAdd}
          ch={steps.filter(s=>s.name.trim()&&s.expr.trim()).length>1
            ? `Add ${steps.filter(s=>s.name.trim()&&s.expr.trim()).length} steps to pipeline →`
            : "Add to pipeline →"}/>
      </div>

      {/* Live preview */}
      {preview&&(
        <div style={{marginBottom:"1.2rem",padding:"0.7rem",
          background:preview.error?`${C.red}08`:isGrouped?`${C.purple}08`:`${C.green}08`,
          border:`1px solid ${preview.error?C.red+"30":isGrouped?C.purple+"30":C.green+"30"}`,borderRadius:4}}>
          <div style={{fontSize: T.caption.fontSize,color:preview.error?C.red:isGrouped?C.purple:C.green,
            letterSpacing:"0.18em",textTransform:"uppercase",fontFamily: T.code.fontFamily,marginBottom:6}}>
            {preview.error?"✕ Error":isGrouped?"✓ Preview — first 4 groups":"✓ Preview — first 6 rows"}
          </div>
          {preview.error?<div style={{fontSize: T.code.fontSize,color:C.red,fontFamily: T.code.fontFamily}}>{preview.error}</div>
          :isGrouped?(
            <div style={{display:"flex",flexDirection:"column",gap:4}}>
              {preview.vals.map((v,i)=>(
                <div key={i} style={{display:"flex",gap:10,alignItems:"center"}}>
                  <span style={{fontSize: T.caption.fontSize,color:C.textMuted,fontFamily: T.code.fontFamily,minWidth:100,flexShrink:0}}>{preview.labels[i]}</span>
                  <span style={{fontSize: T.code.fontSize,fontFamily: T.code.fontFamily,padding:"2px 8px",borderRadius:2,
                    border:`1px solid ${v===null?C.border:C.purple+"40"}`,
                    color:v===null?C.textMuted:C.purple,background:v===null?"transparent":`${C.purple}0a`}}>
                    {v===null?"·":typeof v==="boolean"?String(v):typeof v==="number"?(Number.isInteger(v)?v:v.toFixed(4).replace(/\.?0+$/,"")):String(v)}
                  </span>
                </div>
              ))}
            </div>
          ):(
            <div style={{display:"flex",flexWrap:"wrap",gap:6}}>
              {preview.vals.map((v,i)=>(
                <span key={i} style={{fontSize: T.code.fontSize,fontFamily: T.code.fontFamily,padding:"2px 8px",borderRadius:2,
                  border:`1px solid ${v===null?C.border:C.green+"40"}`,
                  color:v===null?C.textMuted:C.green,background:v===null?"transparent":`${C.green}0a`}}>
                  {v===null?"·":typeof v==="number"?(Number.isInteger(v)?v:v.toFixed(4).replace(/\.?0+$/,"")):String(v)}
                </span>
              ))}
            </div>
          )}
        </div>
      )}

      {/* Quick examples */}
      <div style={{marginBottom:"1.1rem"}}>
        <Lbl color={C.textMuted}>{isGrouped?"Group examples":"Quick examples"} — click to load</Lbl>
        <div style={{display:"flex",flexWrap:"wrap",gap:5}}>
          {(isGrouped?G_EXAMPLES:EXAMPLES).map(([n,e])=>(
            <button key={n} onClick={()=>{setStepField(activeIdx,"name",n);setStepField(activeIdx,"expr",e);}}
              style={{padding:"0.22rem 0.55rem",border:`1px solid ${C.border2}`,background:"transparent",
                color:C.textMuted,borderRadius:3,cursor:"pointer",fontSize: T.caption.fontSize,fontFamily: T.code.fontFamily,transition:"all 0.1s"}}
              onMouseEnter={e2=>{e2.currentTarget.style.borderColor=C.green;e2.currentTarget.style.color=C.green;}}
              onMouseLeave={e2=>{e2.currentTarget.style.borderColor=C.border2;e2.currentTarget.style.color=C.textMuted;}}>
              {n}
            </button>
          ))}
        </div>
      </div>

      {/* Column reference */}
      <div style={{marginBottom:"1.1rem"}}>
        <Lbl color={C.textMuted}>Available columns</Lbl>
        <div style={{display:"flex",flexWrap:"wrap",gap:4}}>
          {headers.map(h=>(
            <button key={h} onClick={()=>{const p=steps[activeIdx]?.expr??"";setStepField(activeIdx,"expr",p+(p&&!p.endsWith(" ")?" ":"")+h);}}
              title={info[h]?.isNum?`μ=${info[h].mean?.toFixed(2)} · [${info[h].min?.toFixed(2)}, ${info[h].max?.toFixed(2)}]`:`${info[h]?.uCount} unique vals`}
              style={{padding:"0.2rem 0.5rem",border:`1px solid ${C.border}`,background:"transparent",
                color:info[h]?.isNum?C.blue:C.purple,borderRadius:2,cursor:"pointer",fontSize: T.caption.fontSize,fontFamily: T.code.fontFamily,transition:"all 0.1s"}}
              onMouseEnter={e=>{e.currentTarget.style.background=`${info[h]?.isNum?C.blue:C.purple}18`;}}
              onMouseLeave={e=>{e.currentTarget.style.background="transparent";}}>
              {h}
            </button>
          ))}
        </div>
        <div style={{fontSize: T.caption.fontSize,color:C.textMuted,fontFamily: T.code.fontFamily,marginTop:3}}>
          Click to insert · <span style={{color:C.blue}}>blue</span> = numeric · <span style={{color:C.purple}}>purple</span> = categorical
          {isGrouped&&<span style={{color:C.purple,marginLeft:8}}>· arrays in group mode</span>}
        </div>
      </div>

      {/* Helper reference — categorized, collapsible, group section only shown when active */}
      <div style={{border:`1px solid ${C.border}`,borderRadius:4,overflow:"hidden"}}>
        <button onClick={()=>setRefOpen(o=>!o)}
          style={{width:"100%",padding:"0.5rem 0.85rem",background:C.surface2,border:"none",
            display:"flex",alignItems:"center",cursor:"pointer",color:C.textMuted,fontFamily: T.code.fontFamily,fontSize: T.caption.fontSize}}>
          <span style={{fontSize: T.caption.fontSize,letterSpacing:"0.18em",textTransform:"uppercase"}}>{refOpen?"▾":"▸"} Helper functions reference</span>
        </button>
        {refOpen&&(
          <div style={{background:C.surface}}>
            {H_SECTIONS.filter(s=>!s.label.startsWith("Group")||isGrouped).map(sec=>(
              <div key={sec.label} style={{borderBottom:`1px solid ${C.border}`}}>
                <div style={{padding:"0.35rem 0.85rem",background:`${sec.color}0a`,
                  fontSize: T.caption.fontSize,color:sec.color,letterSpacing:"0.16em",textTransform:"uppercase",fontFamily: T.code.fontFamily,fontWeight:700}}>
                  {sec.label}
                </div>
                {sec.items.map(([sig,desc,ins])=>{
                  const clickable=ins!==null;
                  return(
                  <div key={sig} style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:8,
                    padding:"0.28rem 0.85rem",borderTop:`1px solid ${C.border}20`}}>
                    <code style={{fontSize: T.caption.fontSize,color:sec.color,fontFamily: T.code.fontFamily,cursor:clickable?"pointer":"default",opacity:clickable?1:0.75}}
                      onClick={clickable?()=>{const p=steps[activeIdx]?.expr??"";const token=ins!==undefined?ins:sig.split("(")[0].trim()+"(";setStepField(activeIdx,"expr",p+(p&&!p.endsWith(" ")?" ":"")+token);}:undefined}
                      title={clickable?"Click to insert":undefined}>
                      {sig}
                    </code>
                    <span style={{fontSize: T.caption.fontSize,color:C.textMuted,fontFamily: T.code.fontFamily}}>{desc}</span>
                  </div>
                );})}
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}



// ─── CONDITIONAL SUB-TAB ─────────────────────────────────────────────────────
// Provides if_else and case_when step builders.
function ConditionalSubTab({ headers, onAdd }) {
  const { C, T } = useTheme();
  const [mode, setMode] = useState("if_else"); // "if_else" | "case_when"

  // if_else state
  const [ifeNN,       setIfeNN]       = useState("");
  const [ifeCond,     setIfeCond]     = useState("");
  const [ifeTrueVal,  setIfeTrueVal]  = useState("");
  const [ifeFalseVal, setIfeFalseVal] = useState("");

  // case_when state
  const [cwNN,      setCwNN]      = useState("");
  const [cwCases,   setCwCases]   = useState([{ cond: "", val: "" }]);
  const [cwDefault, setCwDefault] = useState("");

  const inpS = {
    width: "100%", boxSizing: "border-box", padding: "0.42rem 0.65rem",
    background: C.surface2, border: `1px solid ${C.border2}`,
    borderRadius: 3, color: C.text, fontFamily: T.code.fontFamily, fontSize: T.code.fontSize, outline: "none",
  };
  const taS = { ...inpS, resize: "vertical", lineHeight: 1.5, rows: 2 };

  function addIfeStep() {
    if (!ifeNN.trim() || !ifeCond.trim()) return;
    onAdd({
      type: "if_else", nn: ifeNN.trim(), cond: ifeCond.trim(),
      trueVal: ifeTrueVal, falseVal: ifeFalseVal,
      desc: `if_else(${ifeCond.trim()}) → ${ifeNN.trim()}`,
    });
    setIfeNN(""); setIfeCond(""); setIfeTrueVal(""); setIfeFalseVal("");
  }

  function addCwStep() {
    if (!cwNN.trim() || !cwCases.some(c => c.cond.trim())) return;
    onAdd({
      type: "case_when", nn: cwNN.trim(),
      cases: cwCases.filter(c => c.cond.trim()),
      defaultVal: cwDefault || null,
      desc: `case_when(${cwCases.filter(c=>c.cond.trim()).length} cases) → ${cwNN.trim()}`,
    });
    setCwNN(""); setCwCases([{ cond: "", val: "" }]); setCwDefault("");
  }

  const modeBtnS = (active) => ({
    padding: "0.3rem 0.85rem", border: `1px solid ${active ? C.gold : C.border2}`,
    background: active ? `${C.gold}18` : "transparent",
    color: active ? C.gold : C.textMuted,
    borderRadius: 3, cursor: "pointer", fontSize: T.caption.fontSize, fontFamily: T.code.fontFamily,
  });

  return (
    <div>
      {/* Mode toggle */}
      <div style={{ display: "flex", gap: 6, marginBottom: "1rem" }}>
        <button style={modeBtnS(mode === "if_else")}    onClick={() => setMode("if_else")}>if_else</button>
        <button style={modeBtnS(mode === "case_when")}  onClick={() => setMode("case_when")}>case_when</button>
      </div>

      {mode === "if_else" && (
        <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
          <div style={{ padding: "0.5rem 0.9rem", background: C.surface, border: `1px solid ${C.border}`,
            borderLeft: `3px solid ${C.gold}`, borderRadius: 4, fontSize: T.caption.fontSize, color: C.textMuted, fontFamily: T.code.fontFamily, lineHeight: 1.6 }}>
            <span style={{ color: C.gold }}>if_else(cond, trueVal, falseVal)</span> — creates a new column.
            Condition is a JS expression (column names available). True/false values can be literals or column names.
          </div>
          <div>
            <div style={{ fontSize: T.caption.fontSize, color: C.gold, letterSpacing: "0.14em", textTransform: "uppercase", fontFamily: T.code.fontFamily, marginBottom: 4 }}>Output column name</div>
            <input value={ifeNN} onChange={e => setIfeNN(e.target.value)} placeholder="e.g. adult" style={inpS} />
          </div>
          <div>
            <div style={{ fontSize: T.caption.fontSize, color: C.gold, letterSpacing: "0.14em", textTransform: "uppercase", fontFamily: T.code.fontFamily, marginBottom: 4 }}>Condition</div>
            <textarea value={ifeCond} rows={2} onChange={e => setIfeCond(e.target.value)}
              placeholder={"e.g. age >= 18\ne.g. gdp > 1000 && year >= 2000"} style={taS} />
          </div>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8 }}>
            <div>
              <div style={{ fontSize: T.caption.fontSize, color: C.textMuted, letterSpacing: "0.14em", textTransform: "uppercase", fontFamily: T.code.fontFamily, marginBottom: 4 }}>Value when true</div>
              <input value={ifeTrueVal} onChange={e => setIfeTrueVal(e.target.value)}
                placeholder="literal or column name" style={inpS} />
            </div>
            <div>
              <div style={{ fontSize: T.caption.fontSize, color: C.textMuted, letterSpacing: "0.14em", textTransform: "uppercase", fontFamily: T.code.fontFamily, marginBottom: 4 }}>Value when false</div>
              <input value={ifeFalseVal} onChange={e => setIfeFalseVal(e.target.value)}
                placeholder="literal or column name" style={inpS} />
            </div>
          </div>
          <Btn onClick={addIfeStep} color={C.gold} v="solid" dis={!ifeNN.trim() || !ifeCond.trim()} ch="Add to pipeline →" />
        </div>
      )}

      {mode === "case_when" && (
        <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
          <div style={{ padding: "0.5rem 0.9rem", background: C.surface, border: `1px solid ${C.border}`,
            borderLeft: `3px solid ${C.gold}`, borderRadius: 4, fontSize: T.caption.fontSize, color: C.textMuted, fontFamily: T.code.fontFamily, lineHeight: 1.6 }}>
            <span style={{ color: C.gold }}>case_when(c1 → v1, c2 → v2, …, default)</span> — first matching condition wins.
            Conditions are JS expressions; values are literals.
          </div>
          <div>
            <div style={{ fontSize: T.caption.fontSize, color: C.gold, letterSpacing: "0.14em", textTransform: "uppercase", fontFamily: T.code.fontFamily, marginBottom: 4 }}>Output column name</div>
            <input value={cwNN} onChange={e => setCwNN(e.target.value)} placeholder="e.g. size_cat" style={inpS} />
          </div>
          <div style={{ fontSize: T.caption.fontSize, color: C.textMuted, letterSpacing: "0.14em", textTransform: "uppercase", fontFamily: T.code.fontFamily, marginBottom: 4 }}>Cases — first match wins</div>
          {cwCases.map((c, i) => (
            <div key={i} style={{ display: "grid", gridTemplateColumns: "1fr 1fr 22px", gap: 6, alignItems: "center" }}>
              <textarea value={c.cond} rows={2} onChange={e => setCwCases(cs => cs.map((x,j) => j===i ? {...x, cond: e.target.value} : x))}
                placeholder={`condition ${i+1}  e.g. area < 10`} style={taS} />
              <input value={c.val} onChange={e => setCwCases(cs => cs.map((x,j) => j===i ? {...x, val: e.target.value} : x))}
                placeholder={`value  e.g. "small"`} style={inpS} />
              {cwCases.length > 1
                ? <button onClick={() => setCwCases(cs => cs.filter((_,j) => j !== i))}
                    style={{ background: "none", border: "none", cursor: "pointer", color: C.textMuted, fontSize: T.body.fontSize }}>✕</button>
                : <span />
              }
            </div>
          ))}
          <button onClick={() => setCwCases(cs => [...cs, { cond: "", val: "" }])} style={{
            padding: "0.28rem 0.7rem", background: "transparent", border: `1px dashed ${C.border2}`,
            borderRadius: 3, color: C.textMuted, cursor: "pointer", fontSize: T.caption.fontSize, fontFamily: T.code.fontFamily, alignSelf: "flex-start",
          }}
            onMouseEnter={e => { e.currentTarget.style.borderColor = C.gold; e.currentTarget.style.color = C.gold; }}
            onMouseLeave={e => { e.currentTarget.style.borderColor = C.border2; e.currentTarget.style.color = C.textMuted; }}
          >+ case</button>
          <div>
            <div style={{ fontSize: T.caption.fontSize, color: C.textMuted, letterSpacing: "0.14em", textTransform: "uppercase", fontFamily: T.code.fontFamily, marginBottom: 4 }}>Default value (no match)</div>
            <input value={cwDefault} onChange={e => setCwDefault(e.target.value)}
              placeholder='e.g. "other" or 0' style={inpS} />
          </div>
          <Btn onClick={addCwStep} color={C.gold} v="solid"
            dis={!cwNN.trim() || !cwCases.some(c => c.cond.trim())} ch="Add to pipeline →" />
        </div>
      )}
    </div>
  );
}

// ─── FEATURE ENGINEERING TAB ──────────────────────────────────────────────────
function FeatureEngineeringTab({rows,headers,panel,info,onAdd,duckdbTableName}){
  const { C, T } = useTheme();
  const [vt,setVt]=useState("quick"),[nm,setNm]=useState("");
  const [qt,setQt]=useState("log"),[qc,setQc]=useState(""),[xc2,setXc2]=useState("");
  const [pop,setPop]=useState("lag"),[pc,setPc]=useState(""),[lagN,setLagN]=useState(1);
  const [dtc,setDtc]=useState(""),[dpc,setDpc]=useState("");
  // Date extraction state
  const [dateSrc,setDateSrc]=useState("");
  const [dateParts,setDateParts]=useState({year:false,month:true,day:false,week:false,quarter:false,dow:false,isweekend:false});
  const [dateNames,setDateNames]=useState({year:"",month:"",day:"",week:"",quarter:"",dow:"",isweekend:""});
  const [dateParseMode,setDateParseMode]=useState("YYYYMMDD");

  const numC=headers.filter(h=>info[h]?.isNum);

  // Detect 8-digit YYYYMMDD integers (e.g. 20200101)
  const isYYYYMMDD = v => {
    const s = String(v).trim();
    if (!/^\d{8}$/.test(s)) return false;
    const y=+s.slice(0,4), m=+s.slice(4,6), d=+s.slice(6,8);
    return y>=1000 && y<=9999 && m>=1 && m<=12 && d>=1 && d<=31;
  };
  // Detect 6-digit compact dates: YYMMDD / DDMMYY / MMDDYY (e.g. 911202)
  const is6DigitDate = v => {
    const s = String(v).trim();
    if (!/^\d{6}$/.test(s)) return false;
    const [a,b,c] = [+s.slice(0,2), +s.slice(2,4), +s.slice(4,6)];
    const ok = (m,d) => m>=1&&m<=12&&d>=1&&d<=31;
    return ok(b,c) || ok(a,b) || ok(a,c);
  };

  // Date columns: ISO/parseable strings + numeric YYYYMMDD + 6-digit compact
  const dateC=headers.filter(h=>{
    const samples=rows.slice(0,20).map(r=>r[h]).filter(v=>v!=null);
    if(!samples.length) return false;
    if(info[h]?.isNum) return samples.filter(v=>isYYYYMMDD(v)||is6DigitDate(v)).length/samples.length>0.7;
    const strSamples=samples.filter(v=>typeof v==="string");
    if(!strSamples.length) return false;
    return strSamples.filter(v=>!isNaN(new Date(v).getTime())).length/strSamples.length>0.5;
  });
  // Subset: numeric date columns that need a parse step first
  const numericDateC=dateC.filter(h=>info[h]?.isNum);
  const isP=panel?.entityCol&&panel?.timeCol;

  const suggestName=useCallback((transform,col,col2)=>{
    if(!col) return "";
    const prefixes={log:"log",sq:"sq",std:"z",ix:"ix"};
    if(transform==="ix"&&col2) return `${col}_x_${col2}`;
    return `${prefixes[transform]||transform}_${col}`;
  },[]);
  const prevAutoRef=useRef("");
  useEffect(()=>{
    const auto=suggestName(qt,qc,xc2);
    if(nm===""||nm===prevAutoRef.current){setNm(auto);prevAutoRef.current=auto;}
  },[qt,qc,xc2]);
  // Update default date part names when src changes
  useEffect(()=>{
    if(!dateSrc) return;
    setDateNames(n=>({
      year:      n.year      ||`${dateSrc}_year`,
      month:     n.month     ||`${dateSrc}_month`,
      day:       n.day       ||`${dateSrc}_day`,
      week:      n.week      ||`${dateSrc}_week`,
      quarter:   n.quarter   ||`${dateSrc}_quarter`,
      dow:       n.dow       ||`${dateSrc}_dow`,
      isweekend: n.isweekend ||`${dateSrc}_isweekend`,
    }));
    if(numericDateC.includes(dateSrc)){
      // Auto-select format hint based on first sample value
      const sample = rows.slice(0,20).map(r=>r[dateSrc]).find(v=>v!=null);
      const s = sample != null ? String(sample).trim() : "";
      setDateParseMode(/^\d{6}$/.test(s) ? "YYMMDD" : "YYYYMMDD");
    }
  },[dateSrc]);

  function resetQuick(){setNm("");setQc("");setXc2("");prevAutoRef.current="";}

  const doQ=async()=>{
    if(!qc) return;

    const n=nm.trim();if(!n)return;
    if(qt==="log") onAdd({type:"log",col:qc,nn:n,desc:`ln(${qc}) → ${n}`});
    else if(qt==="sq") onAdd({type:"sq",col:qc,nn:n,desc:`${qc}² → ${n}`});
    else if(qt==="std"){
      let mu, sd;
      if (duckdbTableName) {
        const stats = await computeColStats(duckdbTableName, qc).catch(() => null);
        if (stats) { mu = stats.mean; sd = stats.sd; }
      }
      if (mu == null) {
        const vals=rows.map(r=>r[qc]).filter(v=>typeof v==="number"&&isFinite(v));
        mu=vals.reduce((a,b)=>a+b,0)/vals.length;
        sd=Math.sqrt(vals.reduce((s,v)=>s+(v-mu)**2,0)/vals.length);
      }
      onAdd({type:"std",col:qc,nn:n,mu,sd,desc:`z(${qc}) → ${n}`});
    } else if(qt==="ix"&&xc2) onAdd({type:"ix",c1:qc,c2:xc2,nn:n,desc:`${qc}×${xc2} → ${n}`});
    else if(qt==="exp") onAdd({type:"mutate",nn:n,expr:`Math.exp(row["${qc}"])`,desc:`exp(${qc}) → ${n}`});
    resetQuick();
  };
  // canAddQuick: winz only needs qc; others need qc + non-empty name; ix also needs xc2
  const canAddQuick=qc&&(nm.trim()&&(qt!=="ix"||(qt==="ix"&&xc2)));

  const doP=()=>{
    const n=nm.trim();if(!n||!pc||!isP) return;
    const ec=panel.entityCol,tc=panel.timeCol;
    if(pop==="lag") onAdd({type:"lag",col:pc,nn:n,n:lagN,ec,tc,desc:`L${lagN}.${pc} (i=${ec}) → ${n}`});
    else if(pop==="lead") onAdd({type:"lead",col:pc,nn:n,n:lagN,ec,tc,desc:`F${lagN}.${pc} (i=${ec}) → ${n}`});
    else if(pop==="diff") onAdd({type:"diff",col:pc,nn:n,ec,tc,desc:`Δ${pc} (i=${ec}) → ${n}`});
    setNm("");setPc("");
  };
const doDiD=()=>{const n=nm.trim()||`${dtc}_x_${dpc}`;if(!dtc||!dpc)return;onAdd({type:"did",tc:dtc,pc:dpc,nn:n,desc:`DiD: ${dtc}×${dpc} → ${n}`});setNm("");setDtc("");setDpc("");};

  const doDateExtract=()=>{
    if(!dateSrc) return;
    const parts=Object.entries(dateParts).filter(([,on])=>on).map(([k])=>k);
    if(!parts.length) return;
    const needsParse=numericDateC.includes(dateSrc);
    const srcCol=needsParse?`${dateSrc}_iso`:dateSrc;
    const names={};
    parts.forEach(p=>{names[p]=dateNames[p]?.trim()||`${srcCol}_${p}`;});
    const created=parts.map(p=>names[p]).join(", ");
    if(needsParse){
      onAdd({type:"date_parse",col:dateSrc,nn:srcCol,fmt:dateParseMode,
        desc:`Parse '${dateSrc}' (${dateParseMode}) → '${srcCol}'`});
    }
    onAdd({type:"date_extract",col:srcCol,parts,names,desc:`Date extract '${srcCol}' → [${created}]`});
    setDateSrc("");setDateParts({year:false,month:true,day:false,week:false,quarter:false,dow:false,isweekend:false});
    setDateNames({year:"",month:"",day:"",week:"",quarter:"",dow:"",isweekend:""});
  };
  const canExtract=dateSrc&&Object.values(dateParts).some(Boolean);

  const inpS={width:"100%",boxSizing:"border-box",padding:"0.42rem 0.65rem",background:C.surface2,border:`1px solid ${C.border2}`,borderRadius:3,color:C.text,fontFamily: T.code.fontFamily,fontSize: T.code.fontSize,outline:"none"};

  return(
    <div>
      <Tabs tabs={[["quick","⚡ Shortcuts"],["generate","⊕ Generate"],["mutate","ƒ Mutate"],["conditional","⊕ Conditional"],["date","📅 Date"],...(isP?[["panel","⊞ Panel"]]:[]),["formatting","⬡ Formatting"]]} active={vt} set={setVt} accent={C.teal} sm/>

      {/* ── Variable name input (shared by quick/panel/did) ── */}
      {(vt==="quick"||vt==="panel"||vt==="did")&&(
        <div style={{marginBottom:"1.2rem"}}>
          {/* For winz: show mode toggle + optional name only when newcol */}
          (<>
              <div style={{display:"flex",alignItems:"center",gap:8,marginBottom:4}}>
                <Lbl mb={0}>New variable name</Lbl>
                {nm&&<span style={{fontSize: T.caption.fontSize,color:C.textMuted,fontFamily: T.code.fontFamily}}>← auto-suggested</span>}
              </div>
              <input value={nm} onChange={e=>{setNm(e.target.value);prevAutoRef.current="";}}
                placeholder="e.g. log_wage, wage_lag1, treat_x_post"
                style={{...inpS}}/>
            </>
          )
        </div>
      )}

      {vt==="generate"&&(
        <VectorAssignForm rows={rows} headers={headers} onAdd={onAdd}/>
      )}

      {/* ── Quick Transforms ── */}
      {vt==="quick"&&(
        <div>
          <Lbl color={C.teal}>Transform</Lbl>
          <div style={{display:"flex",flexWrap:"wrap",gap:4,marginBottom:"1.2rem"}}>
            {[["log","ln(x)"],["sq","x²"],["std","z-score"],["ix","x₁×x₂"],["exp","exp(x)"]].map(([k,l])=>(
              <button key={k} onClick={()=>setQt(k)} style={{padding:"0.32rem 0.75rem",border:`1px solid ${qt===k?C.teal:C.border2}`,background:qt===k?`${C.teal}18`:"transparent",color:qt===k?C.teal:C.textDim,borderRadius:3,cursor:"pointer",fontSize: T.code.fontSize,fontFamily: T.code.fontFamily,transition:"all 0.12s"}}>
                {qt===k?"✓ ":""}{l}
              </button>
            ))}
          </div>

          {/* Source column — always first */}
          <Lbl color={C.teal}>{qt==="ix"?"X₁":"Source column"}</Lbl>
          <div style={{display:"flex",flexWrap:"wrap",gap:4,marginBottom:"1rem"}}>
            {numC.map(h=><button key={h} onClick={()=>setQc(h)} style={{padding:"0.28rem 0.6rem",border:`1px solid ${qc===h?C.teal:C.border2}`,background:qc===h?`${C.teal}18`:"transparent",color:qc===h?C.teal:C.textDim,borderRadius:3,cursor:"pointer",fontSize: T.code.fontSize,fontFamily: T.code.fontFamily,transition:"all 0.12s"}}>{qc===h?"✓ ":""}{h}</button>)}
          </div>
          {qt==="ix"&&<><Lbl color={C.teal}>X₂</Lbl><div style={{display:"flex",flexWrap:"wrap",gap:4,marginBottom:"1rem"}}>{numC.filter(h=>h!==qc).map(h=><button key={h} onClick={()=>setXc2(h)} style={{padding:"0.28rem 0.6rem",border:`1px solid ${xc2===h?C.teal:C.border2}`,background:xc2===h?`${C.teal}18`:"transparent",color:xc2===h?C.teal:C.textDim,borderRadius:3,cursor:"pointer",fontSize: T.code.fontSize,fontFamily: T.code.fontFamily,transition:"all 0.12s"}}>{xc2===h?"✓ ":""}{h}</button>)}</div></>}



          {/* Formula preview for non-winz transforms */}
          {qc&&qt!=="winz"&&<div style={{padding:"0.48rem 0.75rem",background:C.surface,border:`1px solid ${C.border}`,borderRadius:3,marginBottom:"1rem",fontSize: T.code.fontSize,color:C.textDim,fontFamily: T.code.fontFamily}}>
            {qt==="log"&&<><span style={{color:C.teal}}>{nm||"?"}</span> = ln(<span style={{color:C.gold}}>{qc}</span>)</>}
            {qt==="sq"&&<><span style={{color:C.teal}}>{nm||"?"}</span> = <span style={{color:C.gold}}>{qc}</span>²</>}
            {qt==="std"&&<><span style={{color:C.teal}}>{nm||"?"}</span> = (<span style={{color:C.gold}}>{qc}</span>−μ)/σ</>}
            {qt==="ix"&&xc2&&<><span style={{color:C.teal}}>{nm||"?"}</span> = <span style={{color:C.gold}}>{qc}</span>×<span style={{color:C.gold}}>{xc2}</span></>}
          </div>}
          <Btn onClick={doQ} color={C.teal} v="solid" dis={!canAddQuick} ch="Add variable"/>
        </div>
      )}

      {/* ── Date Parse + Extraction ── */}
      {vt==="date"&&(
        <div>
          {/* Info */}
          <div style={{padding:"0.65rem 1rem",background:C.surface,border:`1px solid ${C.border}`,borderLeft:`3px solid ${C.violet}`,borderRadius:4,marginBottom:"1.2rem",fontSize: T.code.fontSize,color:C.textDim,lineHeight:1.6}}>
            Extracts calendar features as new numeric columns. Numeric <span style={{color:C.gold}}>YYYYMMDD</span> (e.g. <span style={{color:C.gold}}>20200101</span>) and 6-digit <span style={{color:C.gold}}>YYMMDD</span> (e.g. <span style={{color:C.gold}}>911202</span>) columns are auto-detected and parsed to ISO first.
          </div>

          {/* Source column */}
          <Lbl color={C.violet}>Date source column</Lbl>
          {dateC.length===0?(
            <div style={{fontSize: T.code.fontSize,color:C.orange,fontFamily: T.code.fontFamily,marginBottom:"1.2rem",padding:"0.65rem 1rem",background:C.surface,border:`1px solid ${C.border}`,borderLeft:`3px solid ${C.orange}`,borderRadius:4}}>
              No date columns detected. Supports ISO strings ("2021-06-15"), numeric YYYYMMDD (20210615), and 6-digit YYMMDD (911202).
            </div>
          ):(
            <div style={{display:"flex",flexWrap:"wrap",gap:4,marginBottom:"1.1rem"}}>
              {dateC.map(h=>(
                <button key={h} onClick={()=>setDateSrc(h)}
                  style={{display:"flex",alignItems:"center",gap:5,padding:"0.28rem 0.6rem",
                    border:`1px solid ${dateSrc===h?C.violet:C.border2}`,
                    background:dateSrc===h?`${C.violet}18`:"transparent",
                    color:dateSrc===h?C.violet:C.textDim,
                    borderRadius:3,cursor:"pointer",fontSize: T.code.fontSize,fontFamily: T.code.fontFamily,transition:"all 0.12s"}}>
                  {dateSrc===h?"✓ ":""}{h}
                  {numericDateC.includes(h)&&<span style={{fontSize: T.caption.fontSize,padding:"1px 4px",background:`${C.gold}20`,border:`1px solid ${C.gold}40`,color:C.gold,borderRadius:2}}>NUM</span>}
                </button>
              ))}
            </div>
          )}

          {/* Parse format — only for numeric YYYYMMDD columns */}
          {dateSrc&&numericDateC.includes(dateSrc)&&(
            <div style={{padding:"0.7rem 0.9rem",background:`${C.gold}08`,border:`1px solid ${C.gold}30`,borderLeft:`3px solid ${C.gold}`,borderRadius:4,marginBottom:"1.1rem"}}>
              <div style={{fontSize: T.caption.fontSize,color:C.gold,letterSpacing:"0.15em",textTransform:"uppercase",marginBottom:6,fontFamily: T.code.fontFamily}}>Numeric format</div>
              <div style={{display:"flex",gap:6,flexWrap:"wrap",marginBottom:6}}>
                {[
                  ["YYYYMMDD","YYYYMMDD","20200115"],
                  ["DDMMYYYY","DDMMYYYY","15012020"],
                  ["MMDDYYYY","MMDDYYYY","01152020"],
                  ["YYMMDD","YYMMDD","911202"],
                  ["DDMMYY","DDMMYY","021291"],
                  ["MMDDYY","MMDDYY","120291"],
                ].map(([k,l,ex])=>(
                  <button key={k} onClick={()=>setDateParseMode(k)}
                    style={{padding:"0.25rem 0.65rem",border:`1px solid ${dateParseMode===k?C.gold:C.border2}`,
                      background:dateParseMode===k?`${C.gold}18`:"transparent",
                      color:dateParseMode===k?C.gold:C.textDim,
                      borderRadius:3,cursor:"pointer",fontSize: T.caption.fontSize,fontFamily: T.code.fontFamily,transition:"all 0.12s"}}>
                    {dateParseMode===k?"✓ ":""}{l}<span style={{fontSize: T.caption.fontSize,color:C.textMuted,marginLeft:4}}>{ex}</span>
                  </button>
                ))}
              </div>
              <div style={{fontSize: T.caption.fontSize,color:C.textMuted,fontFamily: T.code.fontFamily}}>
                Adds a <span style={{color:C.teal}}>date_parse</span> step automatically → new column <span style={{color:C.teal}}>{dateSrc}_iso</span>
              </div>
            </div>
          )}

          {/* Parts to extract */}
          <Lbl color={C.violet}>Calendar features</Lbl>
          <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:5,marginBottom:"1.1rem"}}>
            {[
              ["year",    "Year",         "e.g. 2020"],
              ["month",   "Month",        "1–12"],
              ["day",     "Day of month", "1–31"],
              ["week",    "ISO Week",     "1–53"],
              ["quarter", "Quarter",      "1–4"],
              ["dow",     "Day of week",  "0=Sun … 6=Sat"],
              ["isweekend","Is Weekend",  "0 / 1"],
            ].map(([key,label,hint])=>(
              <div key={key} style={{display:"grid",gridTemplateColumns:"18px 1fr",gap:6,alignItems:"start",
                padding:"0.45rem 0.65rem",
                background:dateParts[key]?`${C.violet}08`:C.surface,
                border:`1px solid ${dateParts[key]?C.violet+"40":C.border}`,borderRadius:4}}>
                <button onClick={()=>setDateParts(p=>({...p,[key]:!p[key]}))}
                  style={{width:16,height:16,marginTop:1,borderRadius:2,
                    border:`1px solid ${dateParts[key]?C.violet:C.border2}`,
                    background:dateParts[key]?C.violet:"transparent",
                    cursor:"pointer",display:"flex",alignItems:"center",justifyContent:"center",
                    color:C.bg,fontSize: T.caption.fontSize,flexShrink:0}}>
                  {dateParts[key]?"✓":""}
                </button>
                <div>
                  <div style={{fontSize: T.code.fontSize,color:dateParts[key]?C.text:C.textDim,fontFamily: T.code.fontFamily}}>{label}</div>
                  {dateParts[key]&&dateSrc?(
                    <input value={dateNames[key]} onChange={e=>setDateNames(n=>({...n,[key]:e.target.value}))}
                      placeholder={`${dateSrc}_${key}`}
                      style={{marginTop:3,padding:"0.22rem 0.4rem",background:C.surface2,
                        border:`1px solid ${C.border2}`,borderRadius:2,
                        color:C.text,fontFamily: T.code.fontFamily,fontSize: T.caption.fontSize,outline:"none",
                        width:"100%",boxSizing:"border-box"}}/>
                  ):(
                    <div style={{fontSize: T.caption.fontSize,color:C.textMuted,fontFamily: T.code.fontFamily}}>{hint}</div>
                  )}
                </div>
              </div>
            ))}
          </div>

          {/* Preview */}
          {dateSrc&&canExtract&&(
            <div style={{padding:"0.55rem 0.85rem",background:C.surface,border:`1px solid ${C.border}`,borderRadius:3,marginBottom:"0.9rem",fontSize: T.code.fontSize,color:C.textDim,fontFamily: T.code.fontFamily,lineHeight:1.8}}>
              {numericDateC.includes(dateSrc)&&(
                <div><span style={{color:C.gold}}>→</span> Parse: <span style={{color:C.gold}}>{dateSrc}</span> <span style={{color:C.textMuted}}>({dateParseMode})</span> → <span style={{color:C.teal}}>{dateSrc}_iso</span></div>
              )}
              <div>
                <span style={{color:C.gold}}>→</span> Extract:{" "}
                {Object.entries(dateParts).filter(([,on])=>on).map(([k])=>(
                  <span key={k} style={{color:C.violet,marginRight:8}}>
                    {dateNames[k]?.trim()||(dateSrc+(numericDateC.includes(dateSrc)?"_iso":"")+`_${k}`)}
                  </span>
                ))}
              </div>
            </div>
          )}
          <Btn onClick={doDateExtract} color={C.violet} v="solid" dis={!canExtract} ch="Add date steps →"/>
        </div>
      )}

      {/* ── Panel Operators ── */}
      {vt==="panel"&&(
        !isP
          ?<div style={{padding:"1rem",background:C.surface,border:`1px solid ${C.border}`,borderLeft:`3px solid ${C.orange}`,borderRadius:4,fontSize: T.code.fontSize,color:C.orange,lineHeight:1.7}}>⚠ Set panel index first (Panel Structure tab). Operators respect entity boundaries to prevent cross-unit contamination.</div>
          :<div>
            <div style={{padding:"0.48rem 0.75rem",background:`${C.blue}15`,border:`1px solid ${C.blue}30`,borderRadius:3,marginBottom:"1.2rem",fontSize: T.code.fontSize,color:C.blue,fontFamily: T.code.fontFamily}}>i={panel.entityCol} · t={panel.timeCol} · entity-bounded operators</div>
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
      )}


      {/* ── Mutate ── */}
      {vt==="mutate"&&<MutateSubTab rows={rows} headers={headers} info={info} onAdd={onAdd}/>}

      {/* ── Conditional ── */}
      {vt==="conditional"&&<ConditionalSubTab headers={headers} onAdd={onAdd}/>}

      {/* ── Formatting (Numbers + Strings combined) ── */}
      {vt==="formatting"&&(
        <div>
          <div style={{marginBottom:"1.2rem",padding:"0.65rem 0.9rem",background:C.surface,border:`1px solid ${C.border}`,borderLeft:`3px solid ${C.teal}`,borderRadius:4}}>
            <div style={{fontSize: T.caption.fontSize,color:C.teal,letterSpacing:"0.18em",textTransform:"uppercase",fontFamily: T.code.fontFamily,marginBottom:4}}>Numbers</div>
            <FormatTab rows={rows} headers={headers} info={info} onAdd={onAdd} mode="numbers"/>
          </div>
          <div style={{padding:"0.65rem 0.9rem",background:C.surface,border:`1px solid ${C.border}`,borderLeft:`3px solid ${C.gold}`,borderRadius:4}}>
            <div style={{fontSize: T.caption.fontSize,color:C.gold,letterSpacing:"0.18em",textTransform:"uppercase",fontFamily: T.code.fontFamily,marginBottom:4}}>Strings</div>
            <FormatTab rows={rows} headers={headers} info={info} onAdd={onAdd} mode="strings"/>
          </div>
        </div>
      )}

    </div>
  );
}


export default FeatureEngineeringTab;
