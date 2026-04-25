// ─── ECON STUDIO · components/wrangling/FeatureTab.jsx ─────────────────────
import { useState, useCallback, useEffect, useRef, useMemo } from "react";
import { C, mono, Lbl, Tabs, Btn } from "./shared.jsx";

// ─── MUTATE SUB-TAB ───────────────────────────────────────────────────────────
// dplyr-style free-form expression evaluator.
// Exposes all column names as variables + a whitelist of helper functions.
// Generates a pipeline step {type:"mutate", nn, expr, desc}.
function MutateSubTab({rows, headers, info, onAdd}){
  const [name,   setName]   = useState("");
  const [expr,   setExpr]   = useState("");
  const [refOpen,setRefOpen]= useState(false);
  const nameRef = useRef("");

  // ── Live preview ────────────────────────────────────────────────────────────
  const preview = useMemo(()=>{
    const n=name.trim(), e=expr.trim();
    if(!e) return null;
    const helpers={
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
      coalesce:(...args)=>args.find(v=>v!==null&&v!==undefined)??null,
      pmin:(a,b)=>(typeof a==="number"&&typeof b==="number")?Math.min(a,b):null,
      pmax:(a,b)=>(typeof a==="number"&&typeof b==="number")?Math.max(a,b):null,
      clamp:(x,lo,hi)=>typeof x==="number"?Math.max(lo,Math.min(hi,x)):null,
      rescale:(x,oMin,oMax,nMin=0,nMax=1)=>(typeof x==="number"&&oMax!==oMin)?(nMin+(x-oMin)*(nMax-nMin)/(oMax-oMin)):null,
      case_when:(...pairs)=>{for(let i=0;i<pairs.length-1;i+=2){if(pairs[i])return pairs[i+1];}return pairs.length%2===1?pairs[pairs.length-1]:null;},
    };
    const safeH=headers.filter(h=>/^[a-zA-Z_$][a-zA-Z0-9_$]*$/.test(h));
    const pNames=[...Object.keys(helpers),"row",...safeH];
    let fn, parseErr=null;
    try{ fn=new Function(...pNames,`"use strict";return (${e});`); }
    catch(err){ return{error:`Syntax: ${err.message}`,vals:[]}; }
    const vals=[], errs=[];
    rows.slice(0,6).forEach(r=>{
      try{
        const pVals=[...Object.values(helpers),r,...safeH.map(h=>r[h]??null)];
        let v=fn(...pVals);
        if(v===undefined||(typeof v==="number"&&!isFinite(v)))v=null;
        vals.push(v);
      }catch(err){ errs.push(err.message); vals.push(null); }
    });
    const runtimeErr=errs.length===rows.slice(0,6).length?errs[0]:null;
    return{vals, error:runtimeErr, hasResult:vals.some(v=>v!==null)};
  },[expr,rows,headers]);

  function doAdd(){
    const n=name.trim(), e=expr.trim();
    if(!n||!e||preview?.error) return;
    onAdd({type:"mutate",nn:n,expr:e,desc:`${n} = ${e}`});
    setName(""); setExpr(""); nameRef.current="";
  }

  const canAdd=name.trim()&&expr.trim()&&preview?.hasResult&&!preview?.error;
  const inpS={width:"100%",boxSizing:"border-box",padding:"0.45rem 0.7rem",background:C.surface2,
    border:`1px solid ${C.border2}`,borderRadius:3,color:C.text,fontFamily:mono,fontSize:11,outline:"none"};

  // Helper reference data
  const HELPERS=[
    ["ifelse(cond, true_val, false_val)", "Conditional — like R's ifelse()"],
    ["between(x, lo, hi)",               "Returns 1 if lo ≤ x ≤ hi, else 0"],
    ["log(x)  log2(x)  log10(x)",        "Natural / base-2 / base-10 log"],
    ["sqrt(x)  exp(x)  abs(x)",          "Square root, exponential, absolute value"],
    ["round(x, digits)  floor(x)  ceil(x)", "Rounding functions"],
    ["sign(x)",                           "−1, 0, or 1"],
    ["isna(x)  notna(x)",                "Returns 1/0 for null check"],
    ["coalesce(a, b, ...)",              "First non-null value — like SQL COALESCE"],
    ["pmin(a, b)  pmax(a, b)",           "Element-wise min/max of two values"],
    ["clamp(x, lo, hi)",                 "Clip x to [lo, hi] range"],
    ["rescale(x, oMin, oMax)",           "Rescale to [0, 1] — or pass nMin, nMax"],
    ["case_when(c1, v1, c2, v2, ..., default)", "Multi-condition recode"],
  ];
  const EXAMPLES=[
    ["gdp_per_cap","gdp / population"],
    ["log_wage","log(wage)"],
    ["treat_post","treated * post"],
    ["income_real","income / cpi * 100"],
    ["age_sq","age ** 2"],
    ["hi_edu","ifelse(educ >= 16, 1, 0)"],
    ["wage_clamp","clamp(wage, 0, 500)"],
    ["size_cat","case_when(area < 10, 'small', area < 50, 'medium', 'large')"],
  ];

  return(
    <div>
      {/* ── Context note ── */}
      <div style={{padding:"0.55rem 0.9rem",background:C.surface,border:`1px solid ${C.border}`,
        borderLeft:`3px solid ${C.green}`,borderRadius:4,marginBottom:"1.4rem",
        fontSize:10,color:C.textMuted,fontFamily:mono,lineHeight:1.6}}>
        Equivalent to dplyr's <span style={{color:C.green}}>mutate()</span>.
        Column names are available as variables. All math operators (+, −, *, /, **) supported.
        New column is appended; existing columns are overwritten if name matches.
      </div>

      {/* ── Name + Expression inputs ── */}
      <div style={{display:"grid",gridTemplateColumns:"200px 1fr",gap:8,marginBottom:8,alignItems:"end"}}>
        <div>
          <Lbl color={C.green}>New column name</Lbl>
          <input value={name} onChange={e=>setName(e.target.value)}
            placeholder="e.g. gdp_per_cap"
            style={inpS}/>
        </div>
        <div>
          <Lbl color={C.green}>Expression</Lbl>
          <input value={expr} onChange={e=>setExpr(e.target.value)}
            onKeyDown={e=>{if(e.key==="Enter"&&canAdd)doAdd();}}
            placeholder="e.g. gdp / population"
            style={inpS}/>
        </div>
      </div>

      {/* ── Formula display + Add button ── */}
      <div style={{display:"flex",alignItems:"center",gap:8,marginBottom:"1.2rem"}}>
        {name.trim()&&expr.trim()?(
          <div style={{flex:1,padding:"0.42rem 0.75rem",background:C.surface,border:`1px solid ${C.border}`,
            borderRadius:3,fontSize:11,color:C.textDim,fontFamily:mono}}>
            <span style={{color:C.green}}>{name.trim()||"?"}</span>
            <span style={{color:C.border2,margin:"0 6px"}}>=</span>
            <span style={{color:C.text}}>{expr.trim()||"…"}</span>
          </div>
        ):<div style={{flex:1}}/>}
        <Btn onClick={doAdd} color={C.green} v="solid" dis={!canAdd} ch="Add to pipeline →"/>
      </div>

      {/* ── Live preview ── */}
      {preview&&(
        <div style={{marginBottom:"1.4rem",padding:"0.75rem",
          background:preview.error?`${C.red}08`:`${C.green}08`,
          border:`1px solid ${preview.error?C.red+"30":C.green+"30"}`,
          borderRadius:4}}>
          <div style={{fontSize:9,color:preview.error?C.red:C.green,
            letterSpacing:"0.18em",textTransform:"uppercase",fontFamily:mono,marginBottom:6}}>
            {preview.error?"✕ Error":"✓ Preview — first 6 values"}
          </div>
          {preview.error?(
            <div style={{fontSize:11,color:C.red,fontFamily:mono}}>{preview.error}</div>
          ):(
            <div style={{display:"flex",flexWrap:"wrap",gap:6}}>
              {preview.vals.map((v,i)=>(
                <span key={i} style={{fontSize:11,fontFamily:mono,padding:"2px 8px",
                  borderRadius:2,border:`1px solid ${v===null?C.border:C.green+"40"}`,
                  color:v===null?C.textMuted:C.green,
                  background:v===null?"transparent":`${C.green}0a`}}>
                  {v===null?"·":typeof v==="number"?
                    (Number.isInteger(v)?v:v.toFixed(4).replace(/\.?0+$/,"")):
                    String(v)}
                </span>
              ))}
            </div>
          )}
        </div>
      )}

      {/* ── Quick examples ── */}
      <div style={{marginBottom:"1.2rem"}}>
        <Lbl color={C.textMuted}>Quick examples — click to load</Lbl>
        <div style={{display:"flex",flexWrap:"wrap",gap:5}}>
          {EXAMPLES.map(([n,e])=>(
            <button key={n} onClick={()=>{setName(n);setExpr(e);}}
              style={{padding:"0.25rem 0.6rem",border:`1px solid ${C.border2}`,
                background:"transparent",color:C.textMuted,borderRadius:3,
                cursor:"pointer",fontSize:10,fontFamily:mono,transition:"all 0.1s",
                textAlign:"left"}}
              onMouseEnter={e2=>{e2.currentTarget.style.borderColor=C.green;e2.currentTarget.style.color=C.green;}}
              onMouseLeave={e2=>{e2.currentTarget.style.borderColor=C.border2;e2.currentTarget.style.color=C.textMuted;}}>
              {n}
            </button>
          ))}
        </div>
      </div>

      {/* ── Column reference ── */}
      <div style={{marginBottom:"1.2rem"}}>
        <Lbl color={C.textMuted}>Available columns</Lbl>
        <div style={{display:"flex",flexWrap:"wrap",gap:4}}>
          {headers.map(h=>(
            <button key={h}
              onClick={()=>setExpr(p=>p+(p&&!p.endsWith(" ")?" ":"")+h)}
              title={info[h]?.isNum
                ? `μ=${info[h].mean?.toFixed(2)} · [${info[h].min?.toFixed(2)}, ${info[h].max?.toFixed(2)}]`
                : `${info[h]?.uCount} unique vals`}
              style={{padding:"0.22rem 0.55rem",border:`1px solid ${C.border}`,
                background:"transparent",color:info[h]?.isNum?C.blue:C.purple,
                borderRadius:2,cursor:"pointer",fontSize:10,fontFamily:mono,
                transition:"all 0.1s"}}
              onMouseEnter={e=>{e.currentTarget.style.background=`${info[h]?.isNum?C.blue:C.purple}18`;}}
              onMouseLeave={e=>{e.currentTarget.style.background="transparent";}}>
              {h}
            </button>
          ))}
        </div>
        <div style={{fontSize:9,color:C.textMuted,fontFamily:mono,marginTop:4}}>
          Click to insert into expression · <span style={{color:C.blue}}>blue</span> = numeric · <span style={{color:C.purple}}>purple</span> = categorical
        </div>
      </div>

      {/* ── Helper function reference (collapsible) ── */}
      <div style={{border:`1px solid ${C.border}`,borderRadius:4,overflow:"hidden"}}>
        <button onClick={()=>setRefOpen(o=>!o)}
          style={{width:"100%",padding:"0.55rem 0.85rem",background:C.surface2,border:"none",
            display:"flex",alignItems:"center",gap:8,cursor:"pointer",
            color:C.textMuted,fontFamily:mono,fontSize:10,textAlign:"left"}}>
          <span style={{fontSize:9,letterSpacing:"0.18em",textTransform:"uppercase"}}>
            {refOpen?"▾":"▸"} Helper functions reference
          </span>
        </button>
        {refOpen&&(
          <div style={{padding:"0.75rem",background:C.surface}}>
            {HELPERS.map(([sig,desc])=>(
              <div key={sig} style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:8,
                padding:"0.35rem 0",borderBottom:`1px solid ${C.border}`}}>
                <code style={{fontSize:10,color:C.green,fontFamily:mono}}>{sig}</code>
                <span style={{fontSize:10,color:C.textMuted,fontFamily:mono}}>{desc}</span>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}



// ─── FEATURE ENGINEERING TAB ──────────────────────────────────────────────────
function FeatureEngineeringTab({rows,headers,panel,info,onAdd}){
  const [vt,setVt]=useState("quick"),[nm,setNm]=useState("");
  const [qt,setQt]=useState("log"),[qc,setQc]=useState(""),[xc2,setXc2]=useState("");
  const [pop,setPop]=useState("lag"),[pc,setPc]=useState(""),[lagN,setLagN]=useState(1);
  const [dc,setDc]=useState(""),[dp,setDp]=useState("");
  const [dtc,setDtc]=useState(""),[dpc,setDpc]=useState("");
  const [dummyRef,setDummyRef]=useState("");
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

  // Date columns: ISO/parseable strings + numeric YYYYMMDD
  const dateC=headers.filter(h=>{
    const samples=rows.slice(0,20).map(r=>r[h]).filter(v=>v!=null);
    if(!samples.length) return false;
    if(info[h]?.isNum) return samples.filter(v=>isYYYYMMDD(v)).length/samples.length>0.7;
    const strSamples=samples.filter(v=>typeof v==="string");
    if(!strSamples.length) return false;
    return strSamples.filter(v=>!isNaN(new Date(v).getTime())).length/strSamples.length>0.5;
  });
  // Subset: numeric YYYYMMDD columns that need a parse step first
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
    if(numericDateC.includes(dateSrc)) setDateParseMode("YYYYMMDD");
  },[dateSrc]);

  function resetQuick(){setNm("");setQc("");setXc2("");prevAutoRef.current="";}

  const doQ=()=>{
    if(!qc) return;

    const n=nm.trim();if(!n)return;
    if(qt==="log") onAdd({type:"log",col:qc,nn:n,desc:`ln(${qc}) → ${n}`});
    else if(qt==="sq") onAdd({type:"sq",col:qc,nn:n,desc:`${qc}² → ${n}`});
    else if(qt==="std"){
      const vals=rows.map(r=>r[qc]).filter(v=>typeof v==="number"&&isFinite(v));
      const mu=vals.reduce((a,b)=>a+b,0)/vals.length;
      const sd=Math.sqrt(vals.reduce((s,v)=>s+(v-mu)**2,0)/vals.length);
      onAdd({type:"std",col:qc,nn:n,mu,sd,desc:`z(${qc}) → ${n}`});
    } else if(qt==="ix"&&xc2) onAdd({type:"ix",c1:qc,c2:xc2,nn:n,desc:`${qc}×${xc2} → ${n}`});
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
  const doDummy=()=>{const pfx=(dp.trim()||dc).replace(/\s+/g,"_");if(!dc)return;onAdd({type:"dummy",col:dc,pfx,desc:`Dummies from '${dc}' → ${pfx}_*`});setDp("");setDc("");};
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

  const inpS={width:"100%",boxSizing:"border-box",padding:"0.42rem 0.65rem",background:C.surface2,border:`1px solid ${C.border2}`,borderRadius:3,color:C.text,fontFamily:mono,fontSize:11,outline:"none"};

  return(
    <div>
      <Tabs tabs={[["quick","⚡ Transforms"],["mutate","ƒ Mutate"],["date","📅 Date"],["panel",`⊞ Panel${!isP?" (no idx)":""}`],["dummy","⊕ Dummies"]]} active={vt} set={setVt} accent={C.teal} sm/>

      {/* ── Variable name input (shared by quick/panel/did) ── */}
      {(vt==="quick"||vt==="panel"||vt==="did")&&(
        <div style={{marginBottom:"1.2rem"}}>
          {/* For winz: show mode toggle + optional name only when newcol */}
          (<>
              <div style={{display:"flex",alignItems:"center",gap:8,marginBottom:4}}>
                <Lbl mb={0}>New variable name</Lbl>
                {nm&&<span style={{fontSize:9,color:C.textMuted,fontFamily:mono}}>← auto-suggested</span>}
              </div>
              <input value={nm} onChange={e=>{setNm(e.target.value);prevAutoRef.current="";}}
                placeholder="e.g. log_wage, wage_lag1, treat_x_post"
                style={{...inpS}}/>
            </>
          )
        </div>
      )}

      {/* ── Quick Transforms ── */}
      {vt==="quick"&&(
        <div>
          <Lbl color={C.teal}>Transform</Lbl>
          <div style={{display:"flex",flexWrap:"wrap",gap:4,marginBottom:"1.2rem"}}>
            {[["log","ln(x)"],["sq","x²"],["std","z-score"],["ix","x₁×x₂"]].map(([k,l])=>(
              <button key={k} onClick={()=>setQt(k)} style={{padding:"0.32rem 0.75rem",border:`1px solid ${qt===k?C.teal:C.border2}`,background:qt===k?`${C.teal}18`:"transparent",color:qt===k?C.teal:C.textDim,borderRadius:3,cursor:"pointer",fontSize:11,fontFamily:mono,transition:"all 0.12s"}}>
                {qt===k?"✓ ":""}{l}
              </button>
            ))}
          </div>

          {/* Source column — always first */}
          <Lbl color={C.teal}>{qt==="ix"?"X₁":"Source column"}</Lbl>
          <div style={{display:"flex",flexWrap:"wrap",gap:4,marginBottom:"1rem"}}>
            {numC.map(h=><button key={h} onClick={()=>setQc(h)} style={{padding:"0.28rem 0.6rem",border:`1px solid ${qc===h?C.teal:C.border2}`,background:qc===h?`${C.teal}18`:"transparent",color:qc===h?C.teal:C.textDim,borderRadius:3,cursor:"pointer",fontSize:11,fontFamily:mono,transition:"all 0.12s"}}>{qc===h?"✓ ":""}{h}</button>)}
          </div>
          {qt==="ix"&&<><Lbl color={C.teal}>X₂</Lbl><div style={{display:"flex",flexWrap:"wrap",gap:4,marginBottom:"1rem"}}>{numC.filter(h=>h!==qc).map(h=><button key={h} onClick={()=>setXc2(h)} style={{padding:"0.28rem 0.6rem",border:`1px solid ${xc2===h?C.teal:C.border2}`,background:xc2===h?`${C.teal}18`:"transparent",color:xc2===h?C.teal:C.textDim,borderRadius:3,cursor:"pointer",fontSize:11,fontFamily:mono,transition:"all 0.12s"}}>{xc2===h?"✓ ":""}{h}</button>)}</div></>}



          {/* Formula preview for non-winz transforms */}
          {qc&&qt!=="winz"&&<div style={{padding:"0.48rem 0.75rem",background:C.surface,border:`1px solid ${C.border}`,borderRadius:3,marginBottom:"1rem",fontSize:11,color:C.textDim,fontFamily:mono}}>
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
          <div style={{padding:"0.65rem 1rem",background:C.surface,border:`1px solid ${C.border}`,borderLeft:`3px solid ${C.violet}`,borderRadius:4,marginBottom:"1.2rem",fontSize:11,color:C.textDim,lineHeight:1.6}}>
            Extracts calendar features as new numeric columns. Numeric <span style={{color:C.gold}}>YYYYMMDD</span> columns (e.g. <span style={{color:C.gold}}>20200101</span>) are auto-detected and parsed to ISO first.
          </div>

          {/* Source column */}
          <Lbl color={C.violet}>Date source column</Lbl>
          {dateC.length===0?(
            <div style={{fontSize:11,color:C.orange,fontFamily:mono,marginBottom:"1.2rem",padding:"0.65rem 1rem",background:C.surface,border:`1px solid ${C.border}`,borderLeft:`3px solid ${C.orange}`,borderRadius:4}}>
              No date columns detected. Supports ISO strings ("2021-06-15") and numeric YYYYMMDD integers (20210615).
            </div>
          ):(
            <div style={{display:"flex",flexWrap:"wrap",gap:4,marginBottom:"1.1rem"}}>
              {dateC.map(h=>(
                <button key={h} onClick={()=>setDateSrc(h)}
                  style={{display:"flex",alignItems:"center",gap:5,padding:"0.28rem 0.6rem",
                    border:`1px solid ${dateSrc===h?C.violet:C.border2}`,
                    background:dateSrc===h?`${C.violet}18`:"transparent",
                    color:dateSrc===h?C.violet:C.textDim,
                    borderRadius:3,cursor:"pointer",fontSize:11,fontFamily:mono,transition:"all 0.12s"}}>
                  {dateSrc===h?"✓ ":""}{h}
                  {numericDateC.includes(h)&&<span style={{fontSize:8,padding:"1px 4px",background:`${C.gold}20`,border:`1px solid ${C.gold}40`,color:C.gold,borderRadius:2}}>NUM</span>}
                </button>
              ))}
            </div>
          )}

          {/* Parse format — only for numeric YYYYMMDD columns */}
          {dateSrc&&numericDateC.includes(dateSrc)&&(
            <div style={{padding:"0.7rem 0.9rem",background:`${C.gold}08`,border:`1px solid ${C.gold}30`,borderLeft:`3px solid ${C.gold}`,borderRadius:4,marginBottom:"1.1rem"}}>
              <div style={{fontSize:10,color:C.gold,letterSpacing:"0.15em",textTransform:"uppercase",marginBottom:6,fontFamily:mono}}>Numeric format</div>
              <div style={{display:"flex",gap:6,flexWrap:"wrap",marginBottom:6}}>
                {[["YYYYMMDD","YYYYMMDD","20200115"],["DDMMYYYY","DDMMYYYY","15012020"],["MMDDYYYY","MMDDYYYY","01152020"]].map(([k,l,ex])=>(
                  <button key={k} onClick={()=>setDateParseMode(k)}
                    style={{padding:"0.25rem 0.65rem",border:`1px solid ${dateParseMode===k?C.gold:C.border2}`,
                      background:dateParseMode===k?`${C.gold}18`:"transparent",
                      color:dateParseMode===k?C.gold:C.textDim,
                      borderRadius:3,cursor:"pointer",fontSize:10,fontFamily:mono,transition:"all 0.12s"}}>
                    {dateParseMode===k?"✓ ":""}{l}<span style={{fontSize:8,color:C.textMuted,marginLeft:4}}>{ex}</span>
                  </button>
                ))}
              </div>
              <div style={{fontSize:9,color:C.textMuted,fontFamily:mono}}>
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
                    color:C.bg,fontSize:9,flexShrink:0}}>
                  {dateParts[key]?"✓":""}
                </button>
                <div>
                  <div style={{fontSize:11,color:dateParts[key]?C.text:C.textDim,fontFamily:mono}}>{label}</div>
                  {dateParts[key]&&dateSrc?(
                    <input value={dateNames[key]} onChange={e=>setDateNames(n=>({...n,[key]:e.target.value}))}
                      placeholder={`${dateSrc}_${key}`}
                      style={{marginTop:3,padding:"0.22rem 0.4rem",background:C.surface2,
                        border:`1px solid ${C.border2}`,borderRadius:2,
                        color:C.text,fontFamily:mono,fontSize:9,outline:"none",
                        width:"100%",boxSizing:"border-box"}}/>
                  ):(
                    <div style={{fontSize:9,color:C.textMuted,fontFamily:mono}}>{hint}</div>
                  )}
                </div>
              </div>
            ))}
          </div>

          {/* Preview */}
          {dateSrc&&canExtract&&(
            <div style={{padding:"0.55rem 0.85rem",background:C.surface,border:`1px solid ${C.border}`,borderRadius:3,marginBottom:"0.9rem",fontSize:11,color:C.textDim,fontFamily:mono,lineHeight:1.8}}>
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
          ?<div style={{padding:"1rem",background:C.surface,border:`1px solid ${C.border}`,borderLeft:`3px solid ${C.orange}`,borderRadius:4,fontSize:12,color:C.orange,lineHeight:1.7}}>⚠ Set panel index first (Panel Structure tab). Operators respect entity boundaries to prevent cross-unit contamination.</div>
          :<div>
            <div style={{padding:"0.48rem 0.75rem",background:"#080c10",border:`1px solid ${C.blue}30`,borderRadius:3,marginBottom:"1.2rem",fontSize:11,color:C.blue,fontFamily:mono}}>i={panel.entityCol} · t={panel.timeCol} · entity-bounded operators</div>
            <Lbl color={C.orange}>Operator</Lbl>
            <div style={{display:"flex",gap:4,marginBottom:"1.2rem"}}>
              {[["lag","L. Lag","yᵢ,ₜ₋ₙ"],["lead","F. Lead","yᵢ,ₜ₊ₙ"],["diff","Δ Diff","Δyᵢₜ"]].map(([k,l,f])=>(
                <button key={k} onClick={()=>setPop(k)} style={{flex:1,padding:"0.5rem 0.65rem",border:`1px solid ${pop===k?C.orange:C.border2}`,background:pop===k?`${C.orange}18`:"transparent",color:pop===k?C.orange:C.textDim,borderRadius:3,cursor:"pointer",fontSize:10,fontFamily:mono,transition:"all 0.12s",textAlign:"center"}}>
                  <div style={{fontWeight:700,marginBottom:2}}>{l}</div><div style={{fontSize:9,color:C.textMuted}}>{f}</div>
                </button>
              ))}
            </div>
            {(pop==="lag"||pop==="lead")&&<div style={{marginBottom:"1.2rem"}}><Lbl>Periods n</Lbl><div style={{display:"flex",gap:4}}>{[1,2,3,4].map(n=><button key={n} onClick={()=>setLagN(n)} style={{width:34,padding:"0.32rem",border:`1px solid ${lagN===n?C.orange:C.border2}`,background:lagN===n?`${C.orange}18`:"transparent",color:lagN===n?C.orange:C.textDim,borderRadius:3,cursor:"pointer",fontSize:12,fontFamily:mono,transition:"all 0.12s"}}>{n}</button>)}</div></div>}
            <Lbl>Source column</Lbl>
            <div style={{display:"flex",flexWrap:"wrap",gap:4,marginBottom:"1rem"}}>{numC.map(h=><button key={h} onClick={()=>setPc(h)} style={{padding:"0.28rem 0.6rem",border:`1px solid ${pc===h?C.orange:C.border2}`,background:pc===h?`${C.orange}18`:"transparent",color:pc===h?C.orange:C.textDim,borderRadius:3,cursor:"pointer",fontSize:11,fontFamily:mono,transition:"all 0.12s"}}>{pc===h?"✓ ":""}{h}</button>)}</div>
            {pc&&nm.trim()&&<div style={{padding:"0.48rem 0.75rem",background:C.surface,border:`1px solid ${C.border}`,borderRadius:3,marginBottom:"1rem",fontSize:11,color:C.textDim,fontFamily:mono}}>
              {pop==="lag"&&<><span style={{color:C.teal}}>{nm.trim()}</span>[i,t] = <span style={{color:C.gold}}>{pc}</span>[i,t−{lagN}] within i={panel.entityCol}</>}
              {pop==="lead"&&<><span style={{color:C.teal}}>{nm.trim()}</span>[i,t] = <span style={{color:C.gold}}>{pc}</span>[i,t+{lagN}] within i={panel.entityCol}</>}
              {pop==="diff"&&<><span style={{color:C.teal}}>{nm.trim()}</span> = Δ<span style={{color:C.gold}}>{pc}</span> within i={panel.entityCol}</>}
            </div>}
            <Btn onClick={doP} color={C.orange} v="solid" dis={!nm.trim()||!pc} ch="Add panel variable"/>
          </div>
      )}

      {/* ── Dummies ── */}
      {vt==="dummy"&&(()=>{
        const dummyCols=headers.filter(h=>info[h]?.isCat||(!info[h]?.isNum&&info[h]?.uCount>0&&info[h]?.uCount<=30));
        const uVals=dc?(info[dc]?.uVals||[]).map(v=>String(v)):[];
        // per-category counts for preview
        const catCounts={};
        if(dc) rows.forEach(r=>{const v=r[dc];if(v!=null){const s=String(v);catCounts[s]=(catCounts[s]||0)+1;}});
        return(
        <div>
          <div style={{padding:"0.55rem 0.9rem",background:C.surface,border:`1px solid ${C.border}`,borderLeft:`3px solid ${C.green}`,borderRadius:4,marginBottom:"1.2rem",fontSize:11,color:C.textDim,lineHeight:1.6}}>
            One-hot encode a categorical column. Choose a <span style={{color:C.red}}>reference category</span> to omit (prevents perfect multicollinearity in OLS).
          </div>

          <Lbl color={C.green}>Source column</Lbl>
          <div style={{display:"flex",flexWrap:"wrap",gap:4,marginBottom:"1.2rem"}}>
            {dummyCols.map(h=>(
              <button key={h} onClick={()=>{setDc(h);setDp(h);setDummyRef("");}}
                style={{padding:"0.28rem 0.6rem",border:`1px solid ${dc===h?C.green:C.border2}`,background:dc===h?`${C.green}18`:"transparent",color:dc===h?C.green:C.textDim,borderRadius:3,cursor:"pointer",fontSize:11,fontFamily:mono,transition:"all 0.12s"}}>
                {dc===h?"✓ ":""}{h}
                <span style={{fontSize:9,color:C.textMuted,marginLeft:4}}>({info[h]?.uCount})</span>
              </button>
            ))}
          </div>

          {dc&&(
            <>
              <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:"0.8rem",marginBottom:"1rem"}}>
                <div>
                  <Lbl color={C.green}>Column prefix</Lbl>
                  <input value={dp} onChange={e=>setDp(e.target.value)} placeholder={dc}
                    style={{width:"100%",boxSizing:"border-box",padding:"0.38rem 0.6rem",background:C.surface2,border:`1px solid ${C.border2}`,borderRadius:3,color:C.text,fontFamily:mono,fontSize:11,outline:"none"}}/>
                </div>
                <div>
                  <Lbl color={C.red}>Reference category <span style={{color:C.textMuted}}>(omit)</span></Lbl>
                  <select value={dummyRef} onChange={e=>setDummyRef(e.target.value)}
                    style={{width:"100%",padding:"0.38rem 0.6rem",background:C.surface2,border:`1px solid ${C.border2}`,borderRadius:3,color:C.text,fontFamily:mono,fontSize:11,outline:"none",cursor:"pointer"}}>
                    <option value="">— none (keep all) —</option>
                    {uVals.map(v=><option key={v} value={v}>{v} ({catCounts[v]||0})</option>)}
                  </select>
                </div>
              </div>

              {/* Category preview with counts */}
              <Lbl color={C.textMuted}>Categories that will be created</Lbl>
              <div style={{display:"flex",flexWrap:"wrap",gap:4,marginBottom:"1rem"}}>
                {uVals.map(v=>{
                  const isRef=v===dummyRef;
                  const colName=`${dp||dc}_${v}`;
                  return(
                    <div key={v} style={{padding:"0.28rem 0.6rem",border:`1px solid ${isRef?C.red+"40":C.border2}`,background:isRef?`${C.red}08`:"transparent",borderRadius:3,fontSize:10,fontFamily:mono}}>
                      <span style={{color:isRef?C.red:C.green}}>{isRef?"✕ ":""}{colName}</span>
                      <span style={{color:C.textMuted,marginLeft:4}}>n={catCounts[v]||0}</span>
                      {isRef&&<span style={{color:C.red,fontSize:9,marginLeft:3}}>(ref)</span>}
                    </div>
                  );
                })}
              </div>

              <div style={{display:"flex",gap:8,alignItems:"center",marginBottom:"0.8rem"}}>
                <Btn onClick={()=>{
                  const pfx=(dp.trim()||dc).replace(/\s+/g,"_");
                  const cats=uVals.filter(v=>v!==dummyRef);
                  onAdd({type:"dummy",col:dc,pfx,refCat:dummyRef||null,
                    desc:`Dummies '${dc}' → ${pfx}_* (${cats.length} cols${dummyRef?`, ref=${dummyRef}`:""})`});
                  setDp("");setDc("");setDummyRef("");
                }} color={C.green} v="solid" ch={`Create ${uVals.filter(v=>v!==dummyRef).length} dummies`}/>
              </div>
            </>
          )}
        </div>
        );
      })()}

      {/* ── Mutate ── */}
      {vt==="mutate"&&<MutateSubTab rows={rows} headers={headers} info={info} onAdd={onAdd}/>}

    </div>
  );
}


export default FeatureEngineeringTab;
