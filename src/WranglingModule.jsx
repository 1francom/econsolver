// ─── ECON STUDIO · WranglingModule.jsx ───────────────────────────────────────
// Data Studio: cleaning, panel declaration, feature engineering.
// Consumes rawData {headers, rows} and emits a cleanedData object.
import { useState, useCallback, useMemo, useEffect, useRef } from "react";
import { inferVariableUnits } from "././services/ai/AIService.js";
import { applyStep, runPipeline, NA_PAT } from "./pipeline/runner.js";
import { validatePanel, buildInfo } from "./pipeline/validator.js";
import { buildDataQualityReport, exportMarkdown } from "./core/validation/dataQuality.js";
import DataQualityReport from "./components/wrangling/DataQualityReport.jsx";
export { validatePanel, buildInfo } from "./pipeline/validator.js";
export { applyStep, runPipeline } from "./pipeline/runner.js";


// ─── THEME ────────────────────────────────────────────────────────────────────
const C = {
  bg:"#080808", surface:"#0f0f0f", surface2:"#131313", surface3:"#161616",
  border:"#1c1c1c", border2:"#252525",
  gold:"#c8a96e", goldDim:"#7a6040", goldFaint:"#1a1408",
  text:"#ddd8cc", textDim:"#888", textMuted:"#444",
  green:"#7ab896", red:"#c47070", yellow:"#c8b46e",
  blue:"#6e9ec8", purple:"#a87ec8", teal:"#6ec8b4", orange:"#c88e6e",
  violet:"#9e7ec8",
}
const mono = "'IBM Plex Mono','JetBrains Mono',Consolas,monospace";
const LS_KEY = "econ_wrangle_v2";

// ─── LOCALSTORAGE ─────────────────────────────────────────────────────────────
function lsGet(){try{return JSON.parse(localStorage.getItem(LS_KEY)||"[]");}catch{return[];}}
function lsSet(d){try{localStorage.setItem(LS_KEY,JSON.stringify(d));}catch{}}
function lsSave(id,upd){
  const all=lsGet();const i=all.findIndex(p=>p.id===id);
  if(i>=0)all[i]={...all[i],...upd,ts:Date.now()};else all.unshift({id,...upd,ts:Date.now()});
  lsSet(all.slice(0,8));
}

// ─── PIPELINE ENGINE ─────────────────────────────────────────────────────────
// applyStep, runPipeline, NA_PAT → imported from ../pipeline/runner.js
// validatePanel, buildInfo       → imported from ../pipeline/validator.js

// ─── FUZZY MATCHING ───────────────────────────────────────────────────────────
function levenshtein(a,b,maxD=6){
  if(Math.abs(a.length-b.length)>maxD) return maxD+1;
  const m=a.length,n=b.length;
  let prev=Array.from({length:n+1},(_,i)=>i);
  for(let i=1;i<=m;i++){
    const cur=[i];
    for(let j=1;j<=n;j++){
      cur[j]=a[i-1]===b[j-1]?prev[j-1]:1+Math.min(prev[j],cur[j-1],prev[j-1]);
    }
    prev=cur;
  }
  return prev[n];
}
function normStr(s){return String(s||"").trim().toLowerCase().replace(/\s+/g," ");}
export function fuzzyGroups(vals, rowsForFreq){
  // rowsForFreq: optional array of all raw string values (with repetitions) for frequency ranking
  const freq={};
  if(rowsForFreq){rowsForFreq.forEach(v=>{if(v!=null){const s=String(v);freq[s]=(freq[s]||0)+1;}});}
  const norm=vals.map(normStr);
  const visited=new Array(vals.length).fill(false);
  const clusters=[];
  for(let i=0;i<vals.length;i++){
    if(visited[i]) continue;
    const group=[i];
    visited[i]=true;
    for(let j=i+1;j<vals.length;j++){
      if(visited[j]) continue;
      // Substring match first: 'arg' ⊂ 'argentina' → always group them
      const isSub=norm[i].includes(norm[j])||norm[j].includes(norm[i]);
      const d=isSub?0:levenshtein(norm[i],norm[j]);
      if(d===0||d<=Math.max(2,Math.floor(norm[i].length*.25))){
        group.push(j);visited[j]=true;
      }
    }
    if(group.length>1){
      const members=group.map(k=>vals[k]);
      // Pick canonical: highest frequency wins; on tie, prefer title-case; fallback to longest
      let canonical=members[0];
      let bestScore=-1;
      members.forEach(m=>{
        const f=freq[m]||0;
        const isTitleCase=m===m.replace(/\b\w/g,c=>c.toUpperCase()).replace(/\B\w/g,c=>c.toLowerCase());
        const score=f*100+(isTitleCase?50:0)+m.length;
        if(score>bestScore){bestScore=score;canonical=m;}
      });
      clusters.push({members,canonical});
    }
  }
  return clusters;
}
function buildInitialMap(clusters){
  const map={};
  clusters.forEach(cl=>{cl.members.forEach(m=>{map[m]=cl.canonical;});});
  return map;
}

// ─── AUDIT ENGINE ─────────────────────────────────────────────────────────────
function audit(headers,rows,info){
  const out=[];
  headers.forEach(h=>{
    const c=info[h]; if(!c) return;
    if(c.uCount<=1&&c.naCount<c.total) out.push({col:h,type:"const",sev:"high",title:`'${h}' is constant`,detail:"Zero variance. Drop before regression.",act:"drop"});
    if(c.naPct>.3) out.push({col:h,type:"na",sev:"high",title:`'${h}' — ${(c.naPct*100).toFixed(0)}% missing`,detail:"High missingness. Filter or investigate.",act:"filter_na"});
    else if(c.naPct>.05) out.push({col:h,type:"na",sev:"medium",title:`'${h}' — ${(c.naPct*100).toFixed(0)}% missing`,detail:"Consider listwise deletion.",act:"filter_na"});
    if(c.outliers>0&&c.isNum) out.push({col:h,type:"outlier",sev:c.outliers>3?"high":"medium",title:`'${h}' — ${c.outliers} outlier${c.outliers>1?"s":""}`,detail:`IQR-based. Range [${c.min?.toFixed(2)}, ${c.max?.toFixed(2)}]. Consider winsorizing.`,act:"winz"});
    if(c.isCat&&!c.isNum){
      const rawVals=c.uVals.map(v=>String(v));
      const allRawForFreq=rows.map(r=>r[h]).filter(v=>v!=null).map(v=>String(v));
      const clusters=fuzzyGroups(rawVals,allRawForFreq);
      if(clusters.length>0){
        const variantCount=clusters.reduce((s,cl)=>s+cl.members.length,0);
        const examples=clusters.slice(0,2).map(cl=>cl.members.join(" / ")).join("  ·  ");
        out.push({col:h,type:"variant",sev:"medium",title:`'${h}' — ${variantCount} variant values detected`,
          detail:`Fuzzy clusters found: ${examples}. Unify before encoding dummies or grouping.`,
          act:"normalize",clusters,rawVals});
      }
    }
  });
  return out;
}
async function aiAuditScan(sug,rows,info){
  const results=[];
  for(const s of sug.filter(s=>s.type==="variant"&&s.act==="ai_std").slice(0,2)){
    const sample=rows.slice(0,8).map(r=>r[s.col]);
    const r=await callAI(`Standardize all text variants to consistent canonical values.`,s.col,sample,"transform");
    if(r) results.push({col:s.col,...r});
  }
  return results;
}

// ─── AI HELPER ────────────────────────────────────────────────────────────────
async function callAI(instruction,col,sample,mode){
  const isQ=mode==="query";
  const prompt=isQ
    ?`You are a data analysis assistant. Column: "${col}". Sample (8 vals): ${sample.map((v,i)=>`${i+1}.${JSON.stringify(v)}`).join(",")}. Question: "${instruction}". Respond ONLY JSON (no markdown): {"answer":"2-3 sentence answer","stat":"key finding","statLabel":"label"}`
    :`You are a data-cleaning assistant for an econometrics tool. Column: "${col}". Sample (5 vals): ${sample.slice(0,5).map((v,i)=>`${i+1}.${JSON.stringify(v)}`).join(",")}. Instruction: "${instruction}". Respond ONLY JSON (no markdown): {"description":"one sentence","preview":[5 transformed values],"js":"arrow-fn body (value,rowIndex)=>newValue. Vanilla JS only."}`;
  try{
    const r=await fetch("https://api.anthropic.com/v1/messages",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({model:"claude-sonnet-4-20250514",max_tokens:1000,messages:[{role:"user",content:prompt}]})});
    const d=await r.json();
    const t=d.content?.find(b=>b.type==="text")?.text||"";
    return JSON.parse(t.replace(/```json|```/g,"").trim());
  }catch{return null;}
}

// ─── ATOMS ────────────────────────────────────────────────────────────────────
function Lbl({children,color=C.textMuted,mb=6}){return<div style={{fontSize:10,color,letterSpacing:"0.2em",textTransform:"uppercase",marginBottom:mb,fontFamily:mono}}>{children}</div>;}
function Tabs({tabs,active,set,accent=C.gold,sm=false}){return(
  <div style={{display:"flex",gap:1,background:C.border,borderRadius:4,overflow:"hidden",marginBottom:"1.2rem"}}>
    {tabs.map(([k,l])=><button key={k} onClick={()=>set(k)} style={{flex:1,padding:sm?"0.45rem 0.5rem":"0.6rem 0.7rem",background:active===k?C.goldFaint:C.surface,border:"none",color:active===k?accent:C.textDim,cursor:"pointer",fontFamily:mono,fontSize:sm?9:11,borderBottom:active===k?`2px solid ${accent}`:"2px solid transparent",transition:"all 0.12s"}}>{l}</button>)}
  </div>
);}
function Btn({onClick,ch,color=C.gold,v="out",dis=false,sm=false}){
  const b={padding:sm?"0.28rem 0.65rem":"0.48rem 0.95rem",borderRadius:3,cursor:dis?"not-allowed":"pointer",fontFamily:mono,fontSize:sm?10:11,transition:"all 0.13s",opacity:dis?0.4:1};
  if(v==="solid")return<button onClick={onClick} disabled={dis} style={{...b,background:color,color:C.bg,border:`1px solid ${color}`,fontWeight:700}}>{ch}</button>;
  if(v==="ghost")return<button onClick={onClick} disabled={dis} style={{...b,background:"transparent",border:"none",color:dis?C.textMuted:color}}>{ch}</button>;
  return<button onClick={onClick} disabled={dis} style={{...b,background:"transparent",border:`1px solid ${C.border2}`,color:dis?C.textMuted:C.textDim}}>{ch}</button>;
}
function Badge({ch,color=C.textMuted}){return<span style={{fontSize:9,padding:"2px 6px",border:`1px solid ${color}`,color,borderRadius:2,letterSpacing:"0.1em",fontFamily:mono,whiteSpace:"nowrap"}}>{ch}</span>;}
function NA({pct}){const c=pct>.3?C.red:pct>.1?C.yellow:C.green;return(
  <span style={{display:"inline-flex",alignItems:"center",gap:3}}>
    <span style={{display:"inline-block",width:24,height:3,background:C.border,borderRadius:2,overflow:"hidden"}}>
      <span style={{display:"block",width:`${Math.min(pct*100,100)}%`,height:"100%",background:c}}/>
    </span>
    {pct>0&&<span style={{fontSize:9,color:c,fontFamily:mono}}>{(pct*100).toFixed(0)}%</span>}
  </span>
);}
function Spin(){return<div style={{width:14,height:14,border:`2px solid ${C.border2}`,borderTopColor:C.gold,borderRadius:"50%",animation:"spin 0.7s linear infinite",flexShrink:0}}/>;}
export function Grid({headers,rows,hi,max=20,types,onType}){
  const vis=rows.slice(0,max);
  if(!headers.length)return null;
  const tc={numeric:C.blue,binary:C.purple,categorical:C.purple,string:C.textMuted,date:C.teal};
  return(
    <div style={{overflowX:"auto",borderRadius:4,border:`1px solid ${C.border}`}}>
      <table style={{borderCollapse:"collapse",fontSize:11,width:"100%",minWidth:300}}>
        <thead>
          <tr style={{background:C.surface2}}>
            {headers.map(h=>(
              <th key={h} style={{padding:"0.45rem 0.75rem",textAlign:"left",fontFamily:mono,fontWeight:400,fontSize:10,color:h===hi?C.teal:C.textDim,whiteSpace:"nowrap",borderBottom:`1px solid ${C.border}`,position:"sticky",top:0,background:C.surface2}}>
                <div style={{display:"flex",flexDirection:"column",gap:2}}>
                  <span style={{color:h===hi?C.teal:C.textDim}}>{h}</span>
                  {onType&&types&&<select value={types[h]||""} onChange={e=>onType(h,e.target.value)} onClick={e=>e.stopPropagation()} style={{fontSize:9,padding:"1px 3px",background:C.surface,border:`1px solid ${C.border2}`,borderRadius:2,color:tc[types[h]]||C.textMuted,fontFamily:mono,cursor:"pointer",outline:"none"}}>
                    {["numeric","categorical","binary","string","date"].map(t=><option key={t} value={t}>{t}</option>)}
                  </select>}
                </div>
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {vis.map((row,i)=>(
            <tr key={i} style={{background:i%2?C.surface2:C.surface}}>
              {headers.map(h=>{const v=row[h];const isNull=v===null||v===undefined;return(
                <td key={h} style={{padding:"0.35rem 0.75rem",fontFamily:mono,fontSize:11,color:isNull?C.textMuted:h===hi?C.teal:C.text,borderBottom:`1px solid ${C.border}`,whiteSpace:"nowrap",maxWidth:180,overflow:"hidden",textOverflow:"ellipsis"}}>
                  {isNull?"·":typeof v==="number"?v.toFixed(3).replace(/\.?0+$/,""):String(v)}
                </td>
              );})}
            </tr>
          ))}
        </tbody>
      </table>
      {rows.length>max&&<div style={{padding:"0.35rem 0.75rem",fontSize:10,color:C.textMuted,fontFamily:mono,background:C.surface2,borderTop:`1px solid ${C.border}`}}>… {rows.length-max} more rows</div>}
    </div>
  );
}
function History({pipeline,onRm,onClear}){
  if(!pipeline.length)return null;
  const typeColor={recode:C.teal,quickclean:C.teal,winz:C.orange,log:C.blue,sq:C.blue,std:C.blue,drop:C.red,filter:C.yellow,ai_tr:C.purple,dummy:C.green,did:C.gold,lag:C.orange,lead:C.orange,diff:C.orange,ix:C.blue,date_parse:C.gold,date_extract:C.violet,join:C.teal,append:C.violet,mutate:C.green,pivot_longer:C.teal,group_summarize:C.orange,fill_na:C.yellow,fill_na_grouped:C.yellow,trim_outliers:C.red,flag_outliers:C.orange};
  const typeIcon={recode:"⬡",quickclean:"⚡",winz:"~",log:"ln",sq:"x²",std:"z",drop:"✕",filter:"⊧",ai_tr:"✦",dummy:"D",did:"×",lag:"L",lead:"F",diff:"Δ",ix:"×",rename:"↩",date_parse:"⟳",date_extract:"📅",join:"⊞",append:"⊕",mutate:"ƒ",pivot_longer:"⟲",group_summarize:"⊞",fill_na:"□",fill_na_grouped:"◈",trim_outliers:"✂",flag_outliers:"⚑"};
  return(
    <div style={{width:230,flexShrink:0,borderLeft:`1px solid ${C.border}`,background:C.surface,overflowY:"auto",padding:"1rem"}}>
      <div style={{display:"flex",alignItems:"center",marginBottom:"0.8rem",gap:6}}>
        <Lbl mb={0}>Pipeline</Lbl>
        <button onClick={onClear} style={{marginLeft:"auto",fontSize:9,background:"transparent",border:"none",color:C.textMuted,cursor:"pointer",fontFamily:mono,padding:"2px 4px"}}>clear all</button>
      </div>
      <div style={{display:"flex",flexDirection:"column",gap:1}}>
        {pipeline.map((s,i)=>{
          const col=typeColor[s.type]||C.textMuted;
          const ico=typeIcon[s.type]||"·";
          return(
            <div key={s.id||i} style={{display:"flex",alignItems:"center",gap:4,padding:"0.35rem 0.5rem",background:C.surface2,borderRadius:3,border:`1px solid ${C.border}`,borderLeft:`2px solid ${col}`}}>
              <span style={{fontSize:8,color:col,fontFamily:mono,flexShrink:0,minWidth:14,textAlign:"center"}}>{ico}</span>
              <span style={{flex:1,fontSize:10,color:C.textDim,fontFamily:mono,overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}}>{s.desc||s.type}</span>
              <button onClick={()=>onRm(i)} style={{background:"transparent",border:"none",color:C.textMuted,cursor:"pointer",fontSize:11,padding:"0 2px",flexShrink:0}}>×</button>
            </div>
          );
        })}
      </div>
    </div>
  );
}
function Heatmap({v}){
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
// ─── NORMALIZE TEXT CATEGORIES PANEL ─────────────────────────────────────────
// Standalone tool in the Cleaning tab.
// Scans all categorical columns for fuzzy-similar values and lets the user
// confirm a canonical name for each cluster, then emits a recode step.
//
// Algorithm: Levenshtein fuzzy-groups (already in fuzzyGroups()) + frequency-
// ranked canonical suggestion. The user can override any canonical inline.
function NormalizePanel({headers, rows, info, onAdd}){
  const [selCol, setSelCol]     = useState("");
  const [clusters, setClusters] = useState([]);
  const [rawVals, setRawVals]   = useState([]);
  const [applied, setApplied]   = useState(false);

  // Only categorical (non-numeric) columns with ≥2 unique values
  const catCols = headers.filter(h => info[h]?.isCat && !info[h]?.isNum && info[h]?.uCount >= 2);

  function scanCol(col) {
    setSelCol(col);
    setApplied(false);
    const colInfo = info[col];
    if (!colInfo) { setClusters([]); return; }
    const rv   = colInfo.uVals.map(v => String(v));
    const freq = rows.map(r => r[col]).filter(v => v != null).map(v => String(v));
    const cls  = fuzzyGroups(rv, freq);
    setRawVals(rv);
    setClusters(cls.map(cl => ({ ...cl }))); // editable copy
  }

  function updateCanonical(idx, val) {
    setClusters(prev => prev.map((cl, i) => i === idx ? { ...cl, canonical: val } : cl));
  }

  function applyNormalization() {
    if (!selCol || !clusters.length) return;
    const finalMap = {};
    clusters.forEach(cl => {
      cl.members.forEach(m => {
        if (m !== cl.canonical) finalMap[m] = cl.canonical;
      });
    });
    if (!Object.keys(finalMap).length) return;
    const summary = clusters
      .map(cl => `[${cl.members.join(", ")}] → ${cl.canonical}`)
      .join(" · ");
    onAdd({ type: "recode", col: selCol, map: finalMap,
            desc: `Normalize '${selCol}': ${summary}` });
    setApplied(true);
  }

  // Row frequencies for the selected column
  const rowCounts = useMemo(() => {
    const counts = {};
    rawVals.forEach(v => { counts[v] = 0; });
    rows.forEach(r => {
      const v = r[selCol];
      if (v != null) counts[String(v)] = (counts[String(v)] || 0) + 1;
    });
    return counts;
  }, [rows, selCol, rawVals]);

  const hasClusters = clusters.length > 0;
  const totalAffected = clusters.reduce((s, cl) => s + cl.members.length - 1, 0);

  return (
    <div style={{
      border: `1px solid ${C.teal}30`,
      borderRadius: 4,
      overflow: "hidden",
      marginBottom: "1.4rem",
    }}>
      {/* Header */}
      <div style={{
        padding: "0.55rem 1rem",
        background: `${C.teal}0a`,
        borderBottom: `1px solid ${C.teal}20`,
        display: "flex", alignItems: "center", gap: 8,
      }}>
        <span style={{
          fontSize: 10, color: C.teal, letterSpacing: "0.18em",
          textTransform: "uppercase", fontFamily: mono, flex: 1,
        }}>
          ⬡ Normalize Text Categories
        </span>
        <span style={{ fontSize: 10, color: C.textMuted, fontFamily: mono }}>
          fuzzy-match · Levenshtein
        </span>
      </div>

      <div style={{ padding: "1rem" }}>
        {/* How it works */}
        <div style={{
          fontSize: 11, color: C.textDim, fontFamily: mono, lineHeight: 1.65,
          marginBottom: "1rem", padding: "0.6rem 0.8rem",
          background: C.surface2, borderRadius: 3,
          border: `1px solid ${C.border}`,
        }}>
          Select a categorical column. Variant spellings (e.g.{" "}
          <span style={{ color: C.teal }}>"Argentina"</span>,{" "}
          <span style={{ color: C.yellow }}>"arg"</span>,{" "}
          <span style={{ color: C.yellow }}>"ARG"</span>) will be grouped by
          similarity. Set the canonical name for each group and apply — a{" "}
          <span style={{ color: C.gold }}>recode</span> step is added to the pipeline.
        </div>

        {/* Column selector */}
        {catCols.length === 0 ? (
          <div style={{ fontSize: 11, color: C.textMuted, fontFamily: mono }}>
            No categorical columns detected in the current dataset.
          </div>
        ) : (
          <>
            <Lbl color={C.teal} mb={6}>Categorical column</Lbl>
            <div style={{ display: "flex", flexWrap: "wrap", gap: 4, marginBottom: "1.2rem" }}>
              {catCols.map(h => (
                <button key={h} onClick={() => scanCol(h)}
                  style={{
                    padding: "0.28rem 0.7rem",
                    border: `1px solid ${selCol === h ? C.teal : C.border2}`,
                    background: selCol === h ? `${C.teal}18` : "transparent",
                    color: selCol === h ? C.teal : C.textDim,
                    borderRadius: 3, cursor: "pointer", fontSize: 11,
                    fontFamily: mono, transition: "all 0.12s",
                  }}>
                  {selCol === h ? "✓ " : ""}{h}
                  <span style={{ fontSize: 9, color: C.textMuted, marginLeft: 4 }}>
                    ({info[h]?.uCount})
                  </span>
                </button>
              ))}
            </div>

            {/* No clusters found */}
            {selCol && !hasClusters && (
              <div style={{
                fontSize: 11, fontFamily: mono, lineHeight: 1.6,
                padding: "0.7rem 0.9rem",
                background: `${C.green}0a`,
                border: `1px solid ${C.green}30`,
                borderLeft: `3px solid ${C.green}`,
                borderRadius: 4,
              }}>
                <span style={{ color: C.green }}>✓</span>{" "}
                No similar variants found in{" "}
                <span style={{ color: C.teal }}>{selCol}</span> — values appear
                consistent. {rawVals.length} unique values detected.
              </div>
            )}

            {/* Cluster table */}
            {hasClusters && (
              <>
                <div style={{
                  display: "flex", alignItems: "center", gap: 8,
                  marginBottom: "0.7rem",
                }}>
                  <Lbl mb={0} color={C.teal}>
                    {clusters.length} group{clusters.length !== 1 ? "s" : ""} detected
                  </Lbl>
                  <span style={{ fontSize: 10, color: C.textMuted, fontFamily: mono }}>
                    · {totalAffected} variant{totalAffected !== 1 ? "s" : ""} will be unified
                  </span>
                </div>

                {/* Column headers */}
                <div style={{
                  display: "grid",
                  gridTemplateColumns: "1fr auto 180px",
                  gap: "0.5rem", marginBottom: 4,
                  padding: "0 0.5rem",
                }}>
                  <div style={{ fontSize: 9, color: C.textMuted, fontFamily: mono,
                                letterSpacing: "0.12em", textTransform: "uppercase" }}>
                    Detected variants
                  </div>
                  <div />
                  <div style={{ fontSize: 9, color: C.gold, fontFamily: mono,
                                letterSpacing: "0.12em", textTransform: "uppercase" }}>
                    Canonical name
                  </div>
                </div>

                <div style={{ display: "flex", flexDirection: "column", gap: 5, marginBottom: "1.1rem" }}>
                  {clusters.map((cl, idx) => (
                    <div key={idx} style={{
                      display: "grid",
                      gridTemplateColumns: "1fr auto 180px",
                      gap: "0.5rem", alignItems: "center",
                      padding: "0.55rem 0.75rem",
                      background: C.surface2,
                      border: `1px solid ${C.border}`,
                      borderRadius: 3,
                    }}>
                      {/* Members with counts */}
                      <div style={{ display: "flex", flexWrap: "wrap", gap: 4 }}>
                        {cl.members.map(m => (
                          <span key={m} style={{
                            fontSize: 10, fontFamily: mono,
                            color: m === cl.canonical ? C.text : C.textDim,
                            padding: "2px 6px",
                            border: `1px solid ${m === cl.canonical ? C.border2 : C.border}`,
                            borderRadius: 2,
                            background: m === cl.canonical ? C.surface3 : "transparent",
                          }}>
                            {m}
                            <span style={{ fontSize: 8, color: C.textMuted, marginLeft: 3 }}>
                              ({rowCounts[m] ?? 0})
                            </span>
                          </span>
                        ))}
                      </div>
                      {/* Arrow */}
                      <div style={{ color: C.gold, fontSize: 14, padding: "0 4px" }}>→</div>
                      {/* Editable canonical */}
                      <input
                        value={cl.canonical}
                        onChange={e => updateCanonical(idx, e.target.value)}
                        style={{
                          padding: "0.32rem 0.55rem",
                          background: `${C.gold}08`,
                          border: `1px solid ${C.gold}40`,
                          borderRadius: 3,
                          color: C.gold,
                          fontFamily: mono,
                          fontSize: 11,
                          outline: "none",
                          width: "100%",
                          boxSizing: "border-box",
                        }}
                      />
                    </div>
                  ))}
                </div>

                {/* Apply / feedback */}
                {applied ? (
                  <div style={{
                    fontSize: 11, color: C.green, fontFamily: mono,
                    padding: "0.5rem 0.75rem",
                    background: `${C.green}0a`,
                    border: `1px solid ${C.green}30`,
                    borderRadius: 3,
                  }}>
                    ✓ Recode step added to pipeline — {totalAffected} variant{totalAffected !== 1 ? "s" : ""} unified.
                  </div>
                ) : (
                  <button
                    onClick={applyNormalization}
                    style={{
                      padding: "0.5rem 1.1rem",
                      background: `${C.teal}18`,
                      border: `1px solid ${C.teal}`,
                      color: C.teal,
                      borderRadius: 3,
                      cursor: "pointer",
                      fontFamily: mono,
                      fontSize: 11,
                      fontWeight: 700,
                      transition: "all 0.12s",
                    }}
                  >
                    ⬡ Apply normalization to pipeline →
                  </button>
                )}
              </>
            )}
          </>
        )}
      </div>
    </div>
  );
}

// ─── STANDARDIZE DIALOG ───────────────────────────────────────────────────────
function StandardizeDialog({col,clusters,rawVals,rows,onConfirm,onCancel}){
  const [clusterState,setClusterState]=useState(()=>clusters.map(cl=>({...cl})));
  const [qcMode,setQcMode]=useState("");
  const currentMap=useMemo(()=>{
    const map={};
    clusterState.forEach(cl=>{cl.members.forEach(m=>{map[m]=cl.canonical;});});
    return map;
  },[clusterState]);
  const rowCounts=useMemo(()=>{
    const counts={};
    rawVals.forEach(v=>{counts[v]=0;});
    rows.forEach(r=>{const v=r[col];if(v!=null)counts[String(v)]=(counts[String(v)]||0)+1;});
    return counts;
  },[rows,col,rawVals]);
  function updateCanonical(idx,val){setClusterState(prev=>prev.map((cl,i)=>i===idx?{...cl,canonical:val}:cl));}
  function applyQuickClean(){
    if(!qcMode) return;
    const map={};
    rawVals.forEach(v=>{
      const t=v.trim();let out=t;
      if(qcMode==="lower")out=t.toLowerCase();
      else if(qcMode==="upper")out=t.toUpperCase();
      else if(qcMode==="title")out=t.replace(/\b\w/g,c=>c.toUpperCase()).replace(/\B\w/g,c=>c.toLowerCase());
      if(out!==v) map[v]=out;
    });
    onConfirm({type:"quickclean",col,mode:qcMode,map,desc:`Quick clean '${col}': trim + ${qcMode}case`});
  }
  function applyMapping(){
    const finalMap={};
    Object.entries(currentMap).forEach(([k,v])=>{if(k!==v)finalMap[k]=v;});
    if(!Object.keys(finalMap).length){onCancel();return;}
    const summary=clusterState.map(cl=>`[${cl.members.join(", ")}] → ${cl.canonical}`).join(" · ");
    onConfirm({type:"recode",col,map:finalMap,desc:`Normalize '${col}': ${summary}`});
  }
  const iS={width:"100%",boxSizing:"border-box",padding:"0.38rem 0.6rem",background:C.surface3,border:`1px solid ${C.border2}`,borderRadius:3,color:C.text,fontFamily:mono,fontSize:11,outline:"none"};
  return(
    <div style={{position:"fixed",inset:0,background:"rgba(0,0,0,0.82)",zIndex:200,display:"flex",alignItems:"center",justifyContent:"center",padding:"1rem"}}
      onClick={e=>{if(e.target===e.currentTarget)onCancel();}}>
      <div style={{width:"100%",maxWidth:640,maxHeight:"90vh",overflowY:"auto",background:C.surface,border:`1px solid ${C.border2}`,borderRadius:6,display:"flex",flexDirection:"column"}}>
        <div style={{padding:"1rem 1.2rem",borderBottom:`1px solid ${C.border}`,display:"flex",alignItems:"center",gap:10,background:C.surface2,flexShrink:0}}>
          <div style={{flex:1}}>
            <div style={{fontSize:9,color:C.teal,letterSpacing:"0.22em",textTransform:"uppercase",fontFamily:mono,marginBottom:3}}>Category Standardization</div>
            <div style={{fontSize:15,color:C.text,fontFamily:mono}}><span style={{color:C.gold}}>{col}</span> — {clusters.length} group{clusters.length!==1?"s":""} detected</div>
          </div>
          <button onClick={onCancel} style={{background:"transparent",border:`1px solid ${C.border2}`,borderRadius:3,color:C.textMuted,cursor:"pointer",fontFamily:mono,fontSize:11,padding:"0.3rem 0.6rem"}}>✕ Close</button>
        </div>
        <div style={{padding:"1.2rem",flex:1}}>
          {/* Quick Clean */}
          <div style={{marginBottom:"1.4rem",padding:"1rem",background:`${C.teal}08`,border:`1px solid ${C.teal}30`,borderRadius:4}}>
            <div style={{display:"flex",alignItems:"center",gap:8,marginBottom:"0.7rem"}}>
              <span style={{fontSize:10,color:C.teal,letterSpacing:"0.18em",textTransform:"uppercase",fontFamily:mono}}>⚡ Quick Clean</span>
              <span style={{fontSize:10,color:C.textMuted,fontFamily:mono}}>— trim + case normalization</span>
            </div>
            <div style={{fontSize:11,color:C.textDim,fontFamily:mono,marginBottom:"0.8rem",lineHeight:1.6}}>
              Solves 90% of issues: strips whitespace and unifies casing. Affects <strong style={{color:C.text}}>all</strong> values in the column.
            </div>
            <div style={{display:"flex",gap:6,flexWrap:"wrap",marginBottom:"0.8rem"}}>
              {[["lower","lowercase  abc"],["upper","UPPERCASE  ABC"],["title","Title Case  Abc"]].map(([m,l])=>(
                <button key={m} onClick={()=>setQcMode(qcMode===m?"":m)}
                  style={{padding:"0.35rem 0.75rem",border:`1px solid ${qcMode===m?C.teal:C.border2}`,background:qcMode===m?`${C.teal}20`:"transparent",color:qcMode===m?C.teal:C.textDim,borderRadius:3,cursor:"pointer",fontSize:10,fontFamily:mono,transition:"all 0.12s"}}>
                  {qcMode===m?"✓ ":""}{l}
                </button>
              ))}
            </div>
            {qcMode&&(
              <div style={{marginBottom:"0.8rem",padding:"0.5rem 0.75rem",background:C.surface2,border:`1px solid ${C.border}`,borderRadius:3}}>
                <div style={{fontSize:9,color:C.textMuted,fontFamily:mono,marginBottom:4,letterSpacing:"0.1em",textTransform:"uppercase"}}>Preview (first 6 values)</div>
                <div style={{display:"flex",flexWrap:"wrap",gap:6}}>
                  {rawVals.slice(0,6).map(v=>{
                    const t=v.trim();let out=t;
                    if(qcMode==="lower")out=t.toLowerCase();
                    else if(qcMode==="upper")out=t.toUpperCase();
                    else if(qcMode==="title")out=t.replace(/\b\w/g,c=>c.toUpperCase()).replace(/\B\w/g,c=>c.toLowerCase());
                    const changed=out!==v;
                    return<span key={v} style={{fontSize:10,fontFamily:mono,color:changed?C.teal:C.textMuted}}>{changed?<><span style={{color:C.textMuted,textDecoration:"line-through"}}>{v}</span><span style={{margin:"0 3px",color:C.border2}}>→</span><span style={{color:C.teal}}>{out}</span></>:v}</span>;
                  })}
                </div>
              </div>
            )}
            <Btn onClick={applyQuickClean} color={C.teal} v="solid" dis={!qcMode} ch="Apply Quick Clean →"/>
          </div>
          {/* Manual Mapping */}
          <div>
            <div style={{display:"flex",alignItems:"center",gap:8,marginBottom:"0.8rem"}}>
              <span style={{fontSize:10,color:C.gold,letterSpacing:"0.18em",textTransform:"uppercase",fontFamily:mono}}>⊞ Manual Group Mapping</span>
              <span style={{fontSize:10,color:C.textMuted,fontFamily:mono}}>— edit the canonical name for each cluster</span>
            </div>
            <div style={{fontSize:11,color:C.textDim,fontFamily:mono,marginBottom:"1rem",lineHeight:1.6}}>
              Each row is a cluster of similar values detected by Levenshtein fuzzy matching. The <span style={{color:C.gold}}>Canonical Name</span> is editable — all cluster members will be replaced by that value.
            </div>
            <div style={{display:"grid",gridTemplateColumns:"1fr 28px 1fr",gap:"0.5rem",marginBottom:6}}>
              <div style={{fontSize:9,color:C.textMuted,fontFamily:mono,letterSpacing:"0.12em",textTransform:"uppercase",padding:"0 0.5rem"}}>Detected variants</div>
              <div/>
              <div style={{fontSize:9,color:C.gold,fontFamily:mono,letterSpacing:"0.12em",textTransform:"uppercase",padding:"0 0.5rem"}}>Canonical name</div>
            </div>
            <div style={{display:"flex",flexDirection:"column",gap:6,marginBottom:"1.2rem"}}>
              {clusterState.map((cl,idx)=>(
                <div key={idx} style={{display:"grid",gridTemplateColumns:"1fr 28px 1fr",gap:"0.5rem",alignItems:"center",padding:"0.6rem 0.75rem",background:C.surface2,border:`1px solid ${C.border}`,borderRadius:3}}>
                  <div style={{display:"flex",flexWrap:"wrap",gap:4}}>
                    {cl.members.map(m=>(
                      <span key={m} style={{display:"inline-flex",alignItems:"center",gap:3,fontSize:10,fontFamily:mono,color:m===cl.canonical?C.text:C.textDim,padding:"2px 6px",border:`1px solid ${m===cl.canonical?C.border2:C.border}`,borderRadius:2,background:m===cl.canonical?C.surface3:"transparent"}}>
                        {m}<span style={{fontSize:8,color:C.textMuted}}>({rowCounts[m]||0})</span>
                      </span>
                    ))}
                  </div>
                  <div style={{textAlign:"center",color:C.gold,fontSize:14}}>→</div>
                  <input value={cl.canonical} onChange={e=>updateCanonical(idx,e.target.value)} style={{...iS,border:`1px solid ${C.gold}40`,background:`${C.gold}08`,color:C.gold}}/>
                </div>
              ))}
            </div>
            <div style={{fontSize:10,color:C.textMuted,fontFamily:mono,marginBottom:"1rem"}}>
              {Object.entries(currentMap).filter(([k,v])=>k!==v).length} values will be replaced
              · {rawVals.length - Object.keys(currentMap).length + Object.values(currentMap).filter((v,i,a)=>a.indexOf(v)===i).length} unique values resulting
            </div>
            <div style={{display:"flex",gap:8}}>
              <Btn onClick={applyMapping} color={C.gold} v="solid" ch="Apply Mapping to Pipeline →"/>
              <Btn onClick={onCancel} ch="Cancel"/>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

// ─── SMART AUDITOR ────────────────────────────────────────────────────────────
function Auditor({sug,aiP,onApply,onNormalize,loading}){
  if(!sug.length&&!loading) return null;
  const sc={high:C.red,medium:C.yellow,low:C.blue},sb={high:"#120808",medium:"#12100a",low:"#080c12"};
  return(
    <div style={{border:`1px solid ${C.border}`,borderRadius:4,overflow:"hidden",marginBottom:"1.2rem"}}>
      <div style={{padding:"0.5rem 1rem",background:"#0a0a0a",borderBottom:`1px solid ${C.border}`,display:"flex",alignItems:"center",gap:10}}>
        <span style={{fontSize:10,color:C.purple,letterSpacing:"0.18em",textTransform:"uppercase",fontFamily:mono,flex:1}}>✦ Smart Auditor</span>
        {loading&&<Spin/>}
        {!loading&&<span style={{fontSize:10,color:C.textMuted,fontFamily:mono}}>{sug.length} issue{sug.length!==1?"s":""}</span>}
      </div>
      <div style={{maxHeight:300,overflowY:"auto"}}>
        {sug.map((s,i)=>{
          const aip=aiP.find(p=>p.col===s.col);
          return(
            <div key={i} style={{padding:"0.65rem 1rem",borderBottom:`1px solid ${C.border}`,background:sb[s.sev]||C.surface,borderLeft:`3px solid ${sc[s.sev]||C.border}`}}>
              <div style={{display:"flex",alignItems:"flex-start",gap:8}}>
                <div style={{flex:1}}>
                  <div style={{fontSize:12,color:sc[s.sev]||C.text,marginBottom:2,fontFamily:mono}}>{s.title}</div>
                  <div style={{fontSize:11,color:C.textDim,lineHeight:1.6}}>{s.detail}</div>
                  {s.type==="variant"&&s.clusters&&(
                    <div style={{marginTop:6,display:"flex",flexWrap:"wrap",gap:4}}>
                      {s.clusters.slice(0,3).map((cl,ci)=>(
                        <span key={ci} style={{fontSize:9,fontFamily:mono,color:C.textMuted,padding:"2px 6px",border:`1px solid ${C.border2}`,borderRadius:2}}>
                          {cl.members.join(" · ")} → <span style={{color:C.gold}}>{cl.canonical}</span>
                        </span>
                      ))}
                      {s.clusters.length>3&&<span style={{fontSize:9,color:C.textMuted,fontFamily:mono}}>+{s.clusters.length-3} more…</span>}
                    </div>
                  )}
                  {aip&&s.type!=="variant"&&<div style={{marginTop:5,padding:"0.4rem 0.65rem",background:C.surface2,border:`1px solid ${C.purple}30`,borderRadius:3}}>
                    <div style={{fontSize:10,color:C.purple,fontFamily:mono,marginBottom:2}}>✦ {aip.description}</div>
                    <div style={{fontSize:10,color:C.textMuted,fontFamily:mono}}>Preview: {aip.preview?.slice(0,3).join(" → ")||"—"}</div>
                  </div>}
                </div>
                <div style={{display:"flex",flexDirection:"column",gap:4,flexShrink:0}}>
                  {s.act==="drop"&&<Btn onClick={()=>onApply(s)} color={C.red} v="solid" sm ch="Drop"/>}
                  {s.act==="filter_na"&&<Btn onClick={()=>onApply(s)} color={C.yellow} v="solid" sm ch="Filter NAs"/>}
                  {s.act==="winz"&&<Btn onClick={()=>onApply(s)} color={C.orange} v="solid" sm ch="Winsorize"/>}
                  {s.act==="normalize"&&<Btn onClick={()=>onNormalize(s)} color={C.teal} v="solid" sm ch="Normalize →"/>}
                  {s.act==="ai_std"&&aip&&<Btn onClick={()=>onApply({...s,aip})} color={C.purple} v="solid" sm ch="Apply"/>}
                  {s.act==="ai_std"&&!aip&&<Btn dis color={C.purple} sm ch="Scanning…"/>}
                </div>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

// ─── COLUMN CARD ──────────────────────────────────────────────────────────────
function ColCard({h,info,selected,onSel,onAct}){
  const c=info[h]||{};const[mo,setMo]=useState(false);
  return(
    <div onClick={()=>{onSel(h);setMo(false);}} style={{border:`1px solid ${selected?C.teal:C.border}`,borderRadius:4,padding:"0.5rem 0.55rem",background:selected?`${C.teal}10`:C.surface,cursor:"pointer",position:"relative",transition:"all 0.12s"}}>
      <div style={{display:"flex",alignItems:"flex-start",gap:4,marginBottom:3}}>
        <span style={{fontFamily:mono,fontSize:11,color:selected?C.teal:C.text,flex:1,overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}}>{h}</span>
        <button onClick={e=>{e.stopPropagation();setMo(m=>!m);}} style={{background:"transparent",border:`1px solid ${C.border2}`,borderRadius:2,color:C.textMuted,cursor:"pointer",fontSize:9,padding:"1px 4px",flexShrink:0}}>⋯</button>
      </div>
      <div style={{display:"flex",alignItems:"center",gap:4}}>
        <Badge ch={c.isNum?"num":"cat"} color={c.isNum?C.blue:C.purple}/>
        <NA pct={c.naPct||0}/>
        {c.outliers>0&&<Badge ch={`${c.outliers}⚠`} color={C.orange}/>}
      </div>
      {mo&&<div onClick={e=>e.stopPropagation()} style={{position:"absolute",top:"100%",right:0,zIndex:99,background:C.surface2,border:`1px solid ${C.border}`,borderRadius:4,boxShadow:"0 6px 24px #000b",minWidth:140,overflow:"hidden"}}>
        {[["rename","Rename"],["filter","Filter"],["drop","Drop"]].map(([a,l])=>(
          <button key={a} onClick={()=>{onAct(h,a);setMo(false);}} style={{width:"100%",padding:"0.45rem 0.8rem",background:"transparent",border:"none",color:a==="drop"?C.red:C.textDim,cursor:"pointer",fontFamily:mono,fontSize:11,textAlign:"left"}}>{l}</button>
        ))}
      </div>}
    </div>
  );
}


// ─── FILTER BUILDER ───────────────────────────────────────────────────────────
// Builds a compound predicate tree (AND/OR groups of conditions).
// Emits a step: { type:"filter", predicate: PredicateNode, desc }
//
// Operator catalogue by column type:
//   numeric:     notna | isna | eq | neq | gt | gte | lt | lte | between | in | nin
//   categorical: notna | isna | eq | neq | in | nin | contains | startswith | endswith | regex
//   any:         notna | isna
//
// UX: top-level is always AND (most common case). User can add OR groups inside.

const OPS_NUM = [
  { v:"notna",  l:"is not null" },
  { v:"isna",   l:"is null" },
  { v:"eq",     l:"= equals" },
  { v:"neq",    l:"≠ not equals" },
  { v:"gt",     l:"> greater than" },
  { v:"gte",    l:"≥ greater or equal" },
  { v:"lt",     l:"< less than" },
  { v:"lte",    l:"≤ less or equal" },
  { v:"between",l:"between [lo, hi]" },
  { v:"in",     l:"in list" },
  { v:"nin",    l:"not in list" },
];
const OPS_CAT = [
  { v:"notna",     l:"is not null" },
  { v:"isna",      l:"is null" },
  { v:"eq",        l:"= equals" },
  { v:"neq",       l:"≠ not equals" },
  { v:"in",        l:"in list" },
  { v:"nin",       l:"not in list" },
  { v:"contains",  l:"contains" },
  { v:"startswith",l:"starts with" },
  { v:"endswith",  l:"ends with" },
  { v:"regex",     l:"regex match" },
];

function opsFor(col, info) {
  if (!col || !info[col]) return OPS_CAT;
  return info[col].isNum ? OPS_NUM : OPS_CAT;
}

// A single condition row
function ConditionRow({ cond, idx, headers, info, onChange, onRemove, canRemove }) {
  const ops = opsFor(cond.col, info);
  const needsValue = !["notna","isna"].includes(cond.op);
  const isBetween  = cond.op === "between";
  const isInList   = cond.op === "in" || cond.op === "nin";
  const colInfo    = info[cond.col] || {};

  // For categorical in/nin: show unique value chips
  const uVals = (isInList && colInfo.uVals)
    ? colInfo.uVals.slice(0, 40).map(v => String(v))
    : [];

  const inS = {
    padding:"0.3rem 0.55rem", background:C.surface3, border:`1px solid ${C.border2}`,
    borderRadius:3, color:C.text, fontFamily:mono, fontSize:11, outline:"none",
  };
  const selS = { ...inS, cursor:"pointer" };

  return (
    <div style={{
      display:"flex", flexWrap:"wrap", gap:6, alignItems:"flex-start",
      padding:"0.55rem 0.65rem",
      background:C.surface2, border:`1px solid ${C.border}`,
      borderRadius:4, position:"relative",
    }}>
      {/* Column selector */}
      <select value={cond.col} onChange={e => onChange(idx, { col: e.target.value, op:"notna", value:"", values:[], lo:"", hi:"" })}
        style={{ ...selS, minWidth:110, flex:"1 1 110px" }}>
        <option value="">— column —</option>
        {headers.map(h => <option key={h} value={h}>{h}</option>)}
      </select>

      {/* Operator selector */}
      {cond.col && (
        <select value={cond.op} onChange={e => onChange(idx, { op: e.target.value, value:"", values:[], lo:"", hi:"" })}
          style={{ ...selS, minWidth:140, flex:"1 1 140px" }}>
          {ops.map(o => <option key={o.v} value={o.v}>{o.l}</option>)}
        </select>
      )}

      {/* Value inputs */}
      {cond.col && needsValue && !isBetween && !isInList && (
        <input
          value={cond.value}
          onChange={e => onChange(idx, { value: e.target.value })}
          placeholder="value"
          style={{ ...inS, minWidth:90, flex:"1 1 90px" }}
        />
      )}

      {/* Between: lo + hi */}
      {cond.col && isBetween && (
        <>
          <input value={cond.lo} onChange={e => onChange(idx, { lo: e.target.value })}
            placeholder="lo" style={{ ...inS, width:70, flex:"0 0 70px" }}/>
          <span style={{ color:C.textMuted, fontSize:11, alignSelf:"center", fontFamily:mono }}>to</span>
          <input value={cond.hi} onChange={e => onChange(idx, { hi: e.target.value })}
            placeholder="hi" style={{ ...inS, width:70, flex:"0 0 70px" }}/>
        </>
      )}

      {/* In / Nin: chip list */}
      {cond.col && isInList && (
        <div style={{ flex:"1 1 200px", minWidth:0 }}>
          {/* If categorical: show chips from unique values */}
          {uVals.length > 0 ? (
            <div style={{ display:"flex", flexWrap:"wrap", gap:3, marginBottom:4 }}>
              {uVals.map(v => {
                const sel = (cond.values || []).includes(v);
                return (
                  <button key={v} onClick={() => {
                    const prev = cond.values || [];
                    const next = sel ? prev.filter(x => x !== v) : [...prev, v];
                    onChange(idx, { values: next, value: next.join(",") });
                  }} style={{
                    padding:"2px 7px",
                    border:`1px solid ${sel ? C.yellow : C.border2}`,
                    background: sel ? `${C.yellow}18` : "transparent",
                    color: sel ? C.yellow : C.textDim,
                    borderRadius:3, cursor:"pointer", fontSize:10, fontFamily:mono,
                    transition:"all 0.1s",
                  }}>{sel?"✓ ":""}{v}</button>
                );
              })}
            </div>
          ) : (
            /* Numeric or many-valued: free text comma-separated */
            <input
              value={cond.value}
              onChange={e => {
                const vals = e.target.value.split(",").map(x => x.trim()).filter(Boolean);
                onChange(idx, { value: e.target.value, values: vals });
              }}
              placeholder="val1, val2, val3  (comma-separated)"
              style={{ ...inS, width:"100%" }}
            />
          )}
          <div style={{ fontSize:9, color:C.textMuted, fontFamily:mono, marginTop:2 }}>
            {(cond.values || []).length} selected
          </div>
        </div>
      )}

      {/* Remove button */}
      {canRemove && (
        <button onClick={() => onRemove(idx)} style={{
          background:"transparent", border:`1px solid ${C.border2}`,
          borderRadius:3, color:C.textMuted, cursor:"pointer",
          fontSize:11, padding:"0.25rem 0.4rem", alignSelf:"center", flexShrink:0,
        }}>✕</button>
      )}
    </div>
  );
}

// Preview: how many rows pass the predicate on a sample
function FilterPreview({ rows, predicate, total }) {
  const passing = useMemo(() => {
    if (!predicate) return null;
    try {
      // Inline eval — same logic as runner but in-browser for preview
      function evalP(node, row) {
        if (node.type === "and") return node.children.every(c => evalP(c, row));
        if (node.type === "or")  return node.children.some(c  => evalP(c, row));
        const v = row[node.col];
        const op = node.op;
        if (op === "notna") return v !== null && v !== undefined;
        if (op === "isna")  return v === null || v === undefined;
        if (v === null || v === undefined) return false;
        const sv = String(v), nv = parseFloat(v), val = node.value, nval = parseFloat(val);
        if (op === "eq")        return sv === String(val);
        if (op === "neq")       return sv !== String(val);
        if (op === "gt")        return isFinite(nv) && nv > nval;
        if (op === "gte")       return isFinite(nv) && nv >= nval;
        if (op === "lt")        return isFinite(nv) && nv < nval;
        if (op === "lte")       return isFinite(nv) && nv <= nval;
        if (op === "between")   return isFinite(nv) && nv >= parseFloat(node.lo) && nv <= parseFloat(node.hi);
        if (op === "in")  { const vals=(Array.isArray(node.values)?node.values:[String(val)]).map(String); return vals.includes(sv); }
        if (op === "nin") { const vals=(Array.isArray(node.values)?node.values:[String(val)]).map(String); return !vals.includes(sv); }
        const svl=sv.toLowerCase(), vall=String(val??"").toLowerCase();
        if (op === "contains")   return svl.includes(vall);
        if (op === "startswith") return svl.startsWith(vall);
        if (op === "endswith")   return svl.endsWith(vall);
        if (op === "regex")      { try { return new RegExp(val,"i").test(sv); } catch { return false; } }
        return true;
      }
      return rows.filter(r => evalP(predicate, r)).length;
    } catch { return null; }
  }, [rows, predicate]);

  if (passing === null) return null;
  const pct = total > 0 ? (passing / total * 100).toFixed(1) : "0.0";
  const kept = passing;
  const removed = total - passing;
  const color = removed > total * 0.5 ? C.red : removed > 0 ? C.yellow : C.green;

  return (
    <div style={{
      padding:"0.55rem 0.85rem", background:C.surface, border:`1px solid ${C.border}`,
      borderRadius:4, marginBottom:"0.8rem",
      display:"flex", alignItems:"center", gap:12, fontFamily:mono, fontSize:11,
    }}>
      <div style={{ flex:1, height:4, background:C.border, borderRadius:2, overflow:"hidden" }}>
        <div style={{ width:`${pct}%`, height:"100%", background:color, borderRadius:2, transition:"width 0.2s" }}/>
      </div>
      <span style={{ color:C.green, whiteSpace:"nowrap" }}>
        ✓ <span style={{ color:C.text }}>{kept.toLocaleString()}</span> kept
      </span>
      <span style={{ color:color, whiteSpace:"nowrap" }}>
        ✕ <span style={{ color:C.text }}>{removed.toLocaleString()}</span> removed
      </span>
      <span style={{ color:C.textMuted, whiteSpace:"nowrap" }}>{pct}%</span>
    </div>
  );
}

// The builder itself
function FilterBuilder({ headers, info, rows, onAdd, onCancel }) {
  const emptyCondition = () => ({ col:"", op:"notna", value:"", values:[], lo:"", hi:"", _id: Date.now()+Math.random() });

  const [groups, setGroups] = useState([
    { _id: 1, logic:"and", conditions: [emptyCondition()] }
  ]);
  const [topLogic, setTopLogic] = useState("and"); // how groups combine

  function updateCond(gIdx, cIdx, patch) {
    setGroups(prev => prev.map((g, gi) => gi !== gIdx ? g : {
      ...g,
      conditions: g.conditions.map((c, ci) => ci !== cIdx ? c : { ...c, ...patch })
    }));
  }
  function removeCond(gIdx, cIdx) {
    setGroups(prev => prev.map((g, gi) => gi !== gIdx ? g : {
      ...g, conditions: g.conditions.filter((_, ci) => ci !== cIdx)
    }).filter(g => g.conditions.length > 0));
  }
  function addCond(gIdx) {
    setGroups(prev => prev.map((g, gi) => gi !== gIdx ? g : {
      ...g, conditions: [...g.conditions, emptyCondition()]
    }));
  }
  function addGroup() {
    setGroups(prev => [...prev, { _id: Date.now(), logic:"or", conditions:[emptyCondition()] }]);
  }
  function removeGroup(gIdx) {
    setGroups(prev => prev.filter((_, i) => i !== gIdx));
  }

  // Build predicate tree from groups
  const predicate = useMemo(() => {
    const validGroups = groups.map(g => {
      const validConds = g.conditions
        .filter(c => c.col && c.op)
        .map(c => ({ type:"condition", col:c.col, op:c.op, value:c.value, values:c.values, lo:c.lo, hi:c.hi }));
      if (!validConds.length) return null;
      if (validConds.length === 1) return validConds[0];
      return { type: g.logic, children: validConds };
    }).filter(Boolean);

    if (!validGroups.length) return null;
    if (validGroups.length === 1) return validGroups[0];
    return { type: topLogic, children: validGroups };
  }, [groups, topLogic]);

  // Build human-readable description
  function condDesc(c) {
    if (c.op === "notna") return `${c.col} is not null`;
    if (c.op === "isna")  return `${c.col} is null`;
    if (c.op === "between") return `${c.col} between [${c.lo}, ${c.hi}]`;
    if (c.op === "in")  return `${c.col} in [${(c.values||[]).join(", ")||c.value}]`;
    if (c.op === "nin") return `${c.col} not in [${(c.values||[]).join(", ")||c.value}]`;
    const opStr = {eq:"=",neq:"≠",gt:">",gte:"≥",lt:"<",lte:"≤",contains:"contains",startswith:"starts with",endswith:"ends with",regex:"regex"}[c.op]||c.op;
    return `${c.col} ${opStr} ${c.value}`;
  }
  function buildDesc(pred) {
    if (!pred) return "no conditions";
    if (pred.type === "condition") return condDesc(pred);
    const sep = pred.type === "and" ? " AND " : " OR ";
    return pred.children.map(c => c.type === "condition" ? condDesc(c) : `(${buildDesc(c)})`).join(sep);
  }

  function apply() {
    if (!predicate) return;
    const desc = `Filter: ${buildDesc(predicate)}`;
    onAdd({ type:"filter", predicate, desc });
    onCancel();
  }

  const canApply = predicate !== null;
  const groupColors = [C.yellow, C.teal, C.blue, C.orange, C.purple, C.green];

  return (
    <div style={{ border:`1px solid ${C.yellow}30`, borderRadius:4, padding:"1rem", background:C.surface }}>
      <div style={{ fontSize:10, color:C.yellow, letterSpacing:"0.18em", textTransform:"uppercase", fontFamily:mono, marginBottom:"0.9rem", display:"flex", alignItems:"center", gap:8 }}>
        ⊧ Filter Builder
        <span style={{ fontSize:9, color:C.textMuted, textTransform:"none", letterSpacing:0 }}>— keep rows where conditions are true</span>
      </div>

      {/* Groups */}
      {groups.map((group, gIdx) => (
        <div key={group._id} style={{
          marginBottom:"0.7rem",
          border:`1px solid ${groupColors[gIdx % groupColors.length]}30`,
          borderLeft:`3px solid ${groupColors[gIdx % groupColors.length]}`,
          borderRadius:4, overflow:"hidden",
        }}>
          {/* Group header */}
          <div style={{
            display:"flex", alignItems:"center", gap:6, padding:"0.35rem 0.65rem",
            background:`${groupColors[gIdx % groupColors.length]}08`,
            borderBottom:`1px solid ${C.border}`,
          }}>
            {groups.length > 1 && gIdx > 0 && (
              <span style={{ fontSize:9, color:C.textMuted, fontFamily:mono, marginRight:4 }}>
                {topLogic.toUpperCase()}
              </span>
            )}
            <span style={{ fontSize:9, color:groupColors[gIdx % groupColors.length], fontFamily:mono, letterSpacing:"0.12em", textTransform:"uppercase" }}>
              Group {gIdx + 1}
            </span>
            {group.conditions.length > 1 && (
              <>
                <span style={{ fontSize:9, color:C.textMuted, fontFamily:mono }}>combine with:</span>
                {["and","or"].map(l => (
                  <button key={l} onClick={() => setGroups(prev => prev.map((g, i) => i === gIdx ? {...g, logic:l} : g))}
                    style={{
                      padding:"1px 7px", border:`1px solid ${group.logic===l ? groupColors[gIdx%groupColors.length] : C.border2}`,
                      background: group.logic===l ? `${groupColors[gIdx%groupColors.length]}18` : "transparent",
                      color: group.logic===l ? groupColors[gIdx%groupColors.length] : C.textDim,
                      borderRadius:2, cursor:"pointer", fontSize:9, fontFamily:mono,
                    }}>{l.toUpperCase()}</button>
                ))}
              </>
            )}
            {groups.length > 1 && (
              <button onClick={() => removeGroup(gIdx)} style={{ marginLeft:"auto", background:"transparent", border:"none", color:C.textMuted, cursor:"pointer", fontSize:11, padding:"0 3px" }}>✕</button>
            )}
          </div>

          {/* Conditions */}
          <div style={{ padding:"0.55rem 0.65rem", display:"flex", flexDirection:"column", gap:5 }}>
            {group.conditions.map((cond, cIdx) => (
              <div key={cond._id}>
                {cIdx > 0 && (
                  <div style={{ fontSize:9, color:C.textMuted, fontFamily:mono, padding:"3px 0 3px 4px" }}>
                    {group.logic.toUpperCase()}
                  </div>
                )}
                <ConditionRow
                  cond={cond} idx={cIdx}
                  headers={headers} info={info}
                  onChange={(i, patch) => updateCond(gIdx, i, patch)}
                  onRemove={(i) => removeCond(gIdx, i)}
                  canRemove={group.conditions.length > 1 || groups.length > 1}
                />
              </div>
            ))}
            <button onClick={() => addCond(gIdx)} style={{
              padding:"0.25rem 0.6rem", background:"transparent",
              border:`1px dashed ${C.border2}`, borderRadius:3,
              color:C.textMuted, cursor:"pointer", fontSize:10, fontFamily:mono,
              alignSelf:"flex-start", transition:"all 0.1s",
            }}
              onMouseEnter={e => { e.currentTarget.style.borderColor = groupColors[gIdx%groupColors.length]; e.currentTarget.style.color = groupColors[gIdx%groupColors.length]; }}
              onMouseLeave={e => { e.currentTarget.style.borderColor = C.border2; e.currentTarget.style.color = C.textMuted; }}
            >+ condition</button>
          </div>
        </div>
      ))}

      {/* Add group + top-level logic */}
      <div style={{ display:"flex", alignItems:"center", gap:8, marginBottom:"0.9rem", flexWrap:"wrap" }}>
        <button onClick={addGroup} style={{
          padding:"0.3rem 0.75rem", background:"transparent",
          border:`1px dashed ${C.border2}`, borderRadius:3,
          color:C.textMuted, cursor:"pointer", fontSize:10, fontFamily:mono,
          transition:"all 0.1s",
        }}
          onMouseEnter={e => { e.currentTarget.style.borderColor = C.teal; e.currentTarget.style.color = C.teal; }}
          onMouseLeave={e => { e.currentTarget.style.borderColor = C.border2; e.currentTarget.style.color = C.textMuted; }}
        >+ OR group</button>
        {groups.length > 1 && (
          <div style={{ display:"flex", alignItems:"center", gap:6, fontSize:10, color:C.textMuted, fontFamily:mono }}>
            combine groups with:
            {["and","or"].map(l => (
              <button key={l} onClick={() => setTopLogic(l)} style={{
                padding:"2px 8px", border:`1px solid ${topLogic===l ? C.gold : C.border2}`,
                background: topLogic===l ? `${C.gold}18` : "transparent",
                color: topLogic===l ? C.gold : C.textDim,
                borderRadius:2, cursor:"pointer", fontSize:9, fontFamily:mono,
              }}>{l.toUpperCase()}</button>
            ))}
          </div>
        )}
      </div>

      {/* Live preview */}
      <FilterPreview rows={rows} predicate={predicate} total={rows.length} />

      {/* Actions */}
      <div style={{ display:"flex", gap:8 }}>
        <Btn onClick={apply} color={C.yellow} v="solid" dis={!canApply} ch="Add filter step →"/>
        <Btn onClick={onCancel} ch="Cancel"/>
      </div>
    </div>
  );
}


// ─── FILL MISSING SECTION ─────────────────────────────────────────────────────
// Collapsible panel in CleanTab for all fill strategies including grouped imputation.
function FillNaSection({ headers, info, rows, onAdd }) {
  const [open,     setOpen]    = useState(false);
  const [col,      setCol]     = useState("");
  const [strat,    setStrat]   = useState("zero");
  const [constVal, setConstVal]= useState("0");
  const [groupCols,setGroupCols]= useState([]); // ← now an array

  const colInfo  = col ? info[col] : null;
  const naCount  = col ? rows.filter(r => r[col] === null || r[col] === undefined).length : 0;
  const numCols  = headers.filter(h => info[h]?.isNum);
  const catCols  = headers.filter(h => !info[h]?.isNum && info[h]?.uCount > 0);
  const needsGroup = strat === "group_mean" || strat === "group_median";

  function toggleGroupCol(h) {
    setGroupCols(prev => prev.includes(h) ? prev.filter(x => x !== h) : [...prev, h]);
  }

  const STRATS = [
    ["zero",         "Fill with 0",          "constant",      "Numeric: replace null → 0"],
    ["constant",     "Fill with value",       "constant",      "Any column: set a custom constant"],
    ["mean",         "Global mean",           "mean",          "Numeric: replace null → column mean"],
    ["median",       "Global median",         "median",        "Numeric: replace null → column median"],
    ["mode",         "Mode",                  "mode",          "Any: replace null → most frequent value"],
    ["group_mean",   "Group mean",            "fill_na_grouped","Numeric: replace null → mean within group(s)"],
    ["group_median", "Group median",          "fill_na_grouped","Numeric: replace null → median within group(s)"],
    ["forward_fill", "Forward fill (LOCF)",   "forward_fill",  "Panel: carry last observed value forward"],
    ["backward_fill","Backward fill (NOCB)",  "backward_fill", "Panel: fill from next observed value"],
  ];

  function apply() {
    if (!col) return;

    if (strat === "zero") {
      onAdd({ type:"fill_na", col, strategy:"constant", value:0,
        desc:`fill_na '${col}' ← 0` });
    } else if (strat === "constant") {
      const v = isNaN(parseFloat(constVal)) ? constVal : parseFloat(constVal);
      onAdd({ type:"fill_na", col, strategy:"constant", value:v,
        desc:`fill_na '${col}' ← ${constVal}` });
    } else if (needsGroup) {
      if (!groupCols.length) return;
      const s = strat === "group_mean" ? "mean" : "median";
      const groupLabel = groupCols.join(", ");
      onAdd({ type:"fill_na_grouped", col, groupCol:groupCols, strategy:s,
        desc:`fill_na_grouped '${col}' ← group_${s}(${groupLabel})` });
    } else {
      onAdd({ type:"fill_na", col, strategy:strat,
        desc:`fill_na '${col}' ← ${strat}` });
    }
    setCol(""); setStrat("zero"); setGroupCols([]);
  }

  const canApply = col && naCount > 0 &&
    (!needsGroup || groupCols.length > 0) &&
    (strat !== "constant" || constVal.trim() !== "");

  return (
    <div style={{ marginBottom:"1.2rem" }}>
      {/* Collapsible header */}
      <button onClick={() => setOpen(o => !o)} style={{
        width:"100%", display:"flex", alignItems:"center", gap:8,
        padding:"0.5rem 0.75rem",
        background: open ? `${C.yellow}08` : C.surface2,
        border:`1px solid ${open ? C.yellow+"40" : C.border}`,
        borderRadius: open ? "4px 4px 0 0" : 4,
        color: open ? C.yellow : C.textDim,
        cursor:"pointer", fontFamily:mono, fontSize:10,
        letterSpacing:"0.15em", textTransform:"uppercase", textAlign:"left",
        transition:"all 0.12s",
      }}>
        <span>{open ? "▾" : "▸"}</span>
        <span>Fill missing values</span>
        {!open && headers.some(h => (info[h]?.naPct||0) > 0) && (
          <span style={{ marginLeft:"auto", fontSize:9, color:C.yellow,
            padding:"1px 6px", border:`1px solid ${C.yellow}40`,
            borderRadius:2, fontFamily:mono }}>
            {headers.filter(h=>(info[h]?.naPct||0)>0).length} cols with NAs
          </span>
        )}
      </button>

      {open && (
        <div style={{ padding:"0.9rem 1rem",
          background:C.surface, border:`1px solid ${C.yellow}30`,
          borderTop:"none", borderRadius:"0 0 4px 4px" }}>

          {/* Column selector — show NA count per column */}
          <Lbl color={C.yellow}>Column</Lbl>
          <div style={{ display:"flex", flexWrap:"wrap", gap:4, marginBottom:"1rem",
            maxHeight:120, overflowY:"auto" }}>
            {headers.map(h => {
              const na = rows.filter(r => r[h] === null || r[h] === undefined).length;
              if (na === 0) return null;
              return (
                <button key={h} onClick={() => setCol(h)} style={{
                  padding:"0.25rem 0.6rem",
                  border:`1px solid ${col===h ? C.yellow : C.border2}`,
                  background: col===h ? `${C.yellow}18` : "transparent",
                  color: col===h ? C.yellow : C.textDim,
                  borderRadius:3, cursor:"pointer", fontSize:10, fontFamily:mono,
                  transition:"all 0.1s",
                }}>
                  {col===h?"✓ ":""}{h}
                  <span style={{ fontSize:8, color:C.red, marginLeft:4 }}>
                    {na} NA{na!==1?"s":""}
                  </span>
                </button>
              );
            })}
            {headers.every(h => rows.filter(r=>r[h]===null||r[h]===undefined).length===0) && (
              <div style={{ fontSize:11, color:C.green, fontFamily:mono, padding:"0.3rem 0" }}>
                ✓ No missing values in current dataset.
              </div>
            )}
          </div>

          {col && (
            <>
              {/* Strategy selector */}
              <Lbl color={C.yellow}>Strategy</Lbl>
              <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr", gap:4, marginBottom:"1rem" }}>
                {STRATS.filter(([k]) => {
                  // Filter strategies by column type
                  const isNum = colInfo?.isNum;
                  if (!isNum && ["mean","median","group_mean","group_median","forward_fill","backward_fill"].includes(k)) return false;
                  return true;
                }).map(([k, label, , hint]) => (
                  <button key={k} onClick={() => setStrat(k)} style={{
                    padding:"0.4rem 0.6rem", textAlign:"left",
                    border:`1px solid ${strat===k ? C.yellow : C.border2}`,
                    background: strat===k ? `${C.yellow}12` : "transparent",
                    color: strat===k ? C.yellow : C.textDim,
                    borderRadius:3, cursor:"pointer", fontSize:10, fontFamily:mono,
                    transition:"all 0.1s",
                  }}>
                    <div>{strat===k?"✓ ":""}{label}</div>
                    <div style={{ fontSize:8, color:C.textMuted, marginTop:2 }}>{hint}</div>
                  </button>
                ))}
              </div>

              {/* Constant value input */}
              {strat === "constant" && (
                <div style={{ marginBottom:"0.8rem" }}>
                  <Lbl color={C.yellow}>Fill value</Lbl>
                  <input value={constVal} onChange={e => setConstVal(e.target.value)}
                    placeholder="e.g. 0, -999, unknown"
                    style={{ width:"100%", boxSizing:"border-box",
                      padding:"0.38rem 0.6rem", background:C.surface2,
                      border:`1px solid ${C.border2}`, borderRadius:3,
                      color:C.text, fontFamily:mono, fontSize:11, outline:"none" }}/>
                </div>
              )}

              {/* Group column for grouped imputation */}
              {needsGroup && (
                <div style={{ marginBottom:"0.8rem" }}>
                  <div style={{ display:"flex", alignItems:"center", gap:8, marginBottom:5 }}>
                    <Lbl mb={0} color={C.yellow}>Group by</Lbl>
                    <span style={{ fontSize:9, color:C.textMuted, fontFamily:mono }}>
                      select one or more columns
                    </span>
                    {groupCols.length > 0 && (
                      <button onClick={() => setGroupCols([])}
                        style={{ marginLeft:"auto", fontSize:9, background:"transparent",
                          border:"none", color:C.textMuted, cursor:"pointer", fontFamily:mono }}>
                        clear
                      </button>
                    )}
                  </div>
                  <div style={{ display:"flex", flexWrap:"wrap", gap:4 }}>
                    {catCols.filter(h => h !== col).map(h => {
                      const sel = groupCols.includes(h);
                      return (
                        <button key={h} onClick={() => toggleGroupCol(h)} style={{
                          padding:"0.25rem 0.6rem",
                          border:`1px solid ${sel ? C.teal : C.border2}`,
                          background: sel ? `${C.teal}18` : "transparent",
                          color: sel ? C.teal : C.textDim,
                          borderRadius:3, cursor:"pointer", fontSize:10, fontFamily:mono,
                          transition:"all 0.1s",
                        }}>
                          {sel ? "✓ " : ""}{h}
                        </button>
                      );
                    })}
                  </div>
                  {groupCols.length > 1 && (
                    <div style={{ marginTop:5, fontSize:9, color:C.textMuted, fontFamily:mono }}>
                      Composite key: {groupCols.join(" × ")}
                    </div>
                  )}
                </div>
              )}

              {/* Preview */}
              <div style={{ padding:"0.45rem 0.75rem", background:C.surface2,
                border:`1px solid ${C.border}`, borderRadius:3,
                marginBottom:"0.8rem", fontSize:11, fontFamily:mono, color:C.textDim }}>
                Fill <span style={{color:C.red}}>{naCount} null{naCount!==1?"s":""}</span> in{" "}
                <span style={{color:C.yellow}}>{col}</span>
                {strat==="zero"&&<> ← <span style={{color:C.text}}>0</span></>}
                {strat==="constant"&&<> ← <span style={{color:C.text}}>{constVal||"?"}</span></>}
                {strat==="mean"&&<> ← <span style={{color:C.blue}}>μ = {colInfo?.mean?.toFixed(4)}</span></>}
                {strat==="median"&&<> ← <span style={{color:C.blue}}>median = {colInfo?.median?.toFixed(4)}</span></>}
                {strat==="mode"&&<> ← <span style={{color:C.blue}}>mode</span></>}
                {needsGroup&&groupCols.length>0&&<> ← <span style={{color:C.teal}}>group_{strat==="group_mean"?"mean":"median"}({groupCols.join(", ")})</span></>}
                {strat==="forward_fill"&&<> ← <span style={{color:C.blue}}>LOCF</span></>}
                {strat==="backward_fill"&&<> ← <span style={{color:C.blue}}>NOCB</span></>}
              </div>

              <Btn onClick={apply} color={C.yellow} v="solid"
                dis={!canApply} ch="Fill missing values →"/>
            </>
          )}
        </div>
      )}
    </div>
  );
}

// ─── CLEANING TAB ─────────────────────────────────────────────────────────────
function CleanTab({rows,headers,info,rawData,onAdd}){
  const [sel,setSel]=useState(null),[act,setAct]=useState(null);
  const [rv,setRv]=useState("");
  const [showFilter,setShowFilter]=useState(false);
  const [aInstr,setAInstr]=useState(""),[aMode,setAMode]=useState("transform");
  const [aSt,setASt]=useState("idle"),[aRes,setARes]=useState(null);
  const [sug,setSug]=useState([]),[aiP,setAiP]=useState([]),[audL,setAudL]=useState(false);
  const [normTarget,setNormTarget]=useState(null);
  const ran=useRef(false);

  useEffect(()=>{
    if(ran.current||!headers.length) return;
    ran.current=true;
    const s=audit(headers,rows,info);setSug(s);
    if(s.some(x=>x.type==="variant"&&x.act==="ai_std")){
      setAudL(true);
      aiAuditScan(s,rows,info).then(r=>{setAiP(r);setAudL(false);});
    }
  },[]);

  function openNormDialog(col){
    const colInfo=info[col];
    if(!colInfo||colInfo.isNum) return;
    const rawVals=colInfo.uVals.map(v=>String(v));
    const allRawForFreq=rows.map(r=>r[col]).filter(v=>v!=null).map(v=>String(v));
    const clusters=fuzzyGroups(rawVals,allRawForFreq);
    setNormTarget({col,clusters,rawVals});
  }
  function handleNormConfirm(step){
    onAdd({...step,id:Date.now()+Math.random()});
    setSug(p=>p.filter(x=>!(x.col===normTarget.col&&x.type==="variant")));
    setNormTarget(null);
  }
  function applyAudit(s){
    if(s.act==="drop")onAdd({type:"drop",col:s.col,desc:`Drop '${s.col}'`});
    else if(s.act==="filter_na")onAdd({type:"filter",predicate:{type:"condition",col:s.col,op:"notna"},desc:`Remove NAs in '${s.col}'`});
    else if(s.act==="winz"){
      const vals=rows.map(r=>r[s.col]).filter(v=>typeof v==="number"&&isFinite(v)).sort((a,b)=>a-b);
      const lo=vals[Math.floor(vals.length*.01)]??vals[0],hi=vals[Math.floor(vals.length*.99)]??vals[vals.length-1];
      onAdd({type:"winz",col:s.col,nn:s.col,lo,hi,desc:`Winsorize '${s.col}' [p1,p99] in-place`});
    }
    else if(s.act==="ai_std"&&s.aip)onAdd({type:"ai_tr",col:s.col,js:s.aip.js,desc:`AI standardize '${s.col}': ${s.aip.description}`});
    setSug(p=>p.filter(x=>x.col!==s.col||x.type!==s.type));
  }
  async function doAI(){
    if(!sel||!aInstr.trim())return;
    setASt("loading");setARes(null);
    const sample=rows.slice(0,8).map(r=>r[sel]);
    const r=await callAI(aInstr,sel,sample,aMode);
    setARes(r);setASt(r?"done":"err");
  }
  function doApplyAI(){
    if(!aRes||!sel)return;
    if(aMode==="transform")onAdd({type:"ai_tr",col:sel,js:aRes.js,desc:`AI: ${aRes.description}`});
    setASt("idle");setARes(null);setAInstr("");
  }
  function doRename(){if(!sel||!rv.trim())return;onAdd({type:"rename",col:sel,newName:rv.trim(),desc:`Rename '${sel}' → '${rv.trim()}'`});setRv("");setAct(null);setSel(null);}
  function doFilter(step){ onAdd(step); setShowFilter(false); setAct(null); }
  function doDrop(){if(!sel)return;onAdd({type:"drop",col:sel,desc:`Drop '${sel}'`});setAct(null);setSel(null);}

  const selIsCat=sel&&info[sel]&&!info[sel].isNum&&info[sel].isCat;
  const inS={width:"100%",boxSizing:"border-box",padding:"0.48rem 0.75rem",background:C.surface2,border:`1px solid ${C.border2}`,borderRadius:3,color:C.text,fontFamily:mono,fontSize:11,outline:"none"};

  return(
    <div>
      {normTarget&&(
        <StandardizeDialog col={normTarget.col} clusters={normTarget.clusters} rawVals={normTarget.rawVals}
          rows={rows} onConfirm={handleNormConfirm} onCancel={()=>setNormTarget(null)}/>
      )}
      {/* ─ Standalone Text Normalizer ─ */}
      <NormalizePanel headers={headers} rows={rows} info={info} onAdd={onAdd}/>
      <Auditor sug={sug} aiP={aiP} onApply={applyAudit} onNormalize={s=>openNormDialog(s.col)} loading={audL}/>
      {/* Standalone filter button */}
      <div style={{display:"flex",alignItems:"center",gap:8,marginBottom:"0.9rem"}}>
        <Lbl mb={0}>Columns <span style={{color:C.textMuted}}>({headers.length})</span></Lbl>
        <button
          onClick={()=>{setSel(null);setAct(null);setShowFilter(f=>!f);}}
          style={{
            marginLeft:"auto",padding:"0.28rem 0.7rem",
            border:`1px solid ${showFilter?C.yellow:C.border2}`,
            background:showFilter?`${C.yellow}12`:"transparent",
            color:showFilter?C.yellow:C.textDim,
            borderRadius:3,cursor:"pointer",fontSize:10,fontFamily:mono,
            transition:"all 0.12s",
          }}>
          ⊧ Filter rows{showFilter?" ▾":" ▸"}
        </button>
      </div>
      {showFilter&&(
        <div style={{marginBottom:"1.2rem"}}>
          <FilterBuilder headers={headers} info={info} rows={rows}
            onAdd={step=>{onAdd(step);setShowFilter(false);}}
            onCancel={()=>setShowFilter(false)}/>
        </div>
      )}
      <div style={{display:"grid",gridTemplateColumns:"repeat(auto-fill,minmax(130px,1fr))",gap:6,marginBottom:"1.2rem"}}>
        {headers.map(h=><ColCard key={h} h={h} info={info} selected={sel===h} onSel={h=>{setSel(h);setAct(null);setARes(null);setASt("idle");}} onAct={(h,a)=>{setSel(h);setAct(a);}}/>)}
      </div>
      {sel&&(
        <div style={{border:`1px solid ${C.teal}30`,borderRadius:4,padding:"1rem",background:C.surface,marginBottom:"1.2rem"}}>
          <div style={{fontSize:10,color:C.teal,letterSpacing:"0.18em",textTransform:"uppercase",fontFamily:mono,marginBottom:"0.8rem"}}>
            Selected: <span style={{color:C.text}}>{sel}</span>
            {info[sel]&&<span style={{color:C.textMuted,marginLeft:6}}>
              {info[sel].isNum?`μ=${info[sel].mean?.toFixed(3)} · σ=${info[sel].std?.toFixed(3)} · [${info[sel].min?.toFixed(2)}, ${info[sel].max?.toFixed(2)}]`:`${info[sel].uCount} unique vals`}
            </span>}
          </div>
          {!act&&(
            <div>
              {/* AI Assistant */}
              <div style={{marginBottom:"1rem",padding:"0.75rem",background:`${C.purple}08`,border:`1px solid ${C.purple}20`,borderRadius:4}}>
                <div style={{fontSize:10,color:C.purple,letterSpacing:"0.18em",textTransform:"uppercase",fontFamily:mono,marginBottom:"0.6rem"}}>✦ AI Assistant</div>
                <div style={{display:"flex",gap:6,marginBottom:6}}>
                  {[["transform","Transform"],["query","Query"]].map(([m,l])=>(
                    <button key={m} onClick={()=>setAMode(m)} style={{padding:"0.25rem 0.6rem",border:`1px solid ${aMode===m?C.purple:C.border2}`,background:aMode===m?`${C.purple}18`:"transparent",color:aMode===m?C.purple:C.textDim,borderRadius:3,cursor:"pointer",fontSize:10,fontFamily:mono}}>{l}</button>
                  ))}
                </div>
                <div style={{display:"flex",gap:6,marginBottom:6}}>
                  <input value={aInstr} onChange={e=>setAInstr(e.target.value)}
                    onKeyDown={e=>{if(e.key==="Enter"&&!e.shiftKey){e.preventDefault();doAI();}}}
                    placeholder={aMode==="transform"?"e.g. Extract year from date string":"e.g. What's the distribution of this column?"}
                    style={{...inS,flex:1}}/>
                  <Btn onClick={doAI} color={C.purple} v="solid" dis={aSt==="loading"||!aInstr.trim()} ch={aSt==="loading"?"…":"Run"}/>
                </div>
                {aSt==="done"&&aRes&&(
                  <div style={{padding:"0.6rem 0.75rem",background:C.surface2,border:`1px solid ${C.purple}30`,borderRadius:3}}>
                    {aMode==="transform"&&<>
                      <div style={{fontSize:11,color:C.purple,fontFamily:mono,marginBottom:4}}>✦ {aRes.description}</div>
                      <div style={{fontSize:10,color:C.textMuted,fontFamily:mono,marginBottom:6}}>Preview: {aRes.preview?.slice(0,3).join(" → ")||"—"}</div>
                      <Btn onClick={doApplyAI} color={C.purple} v="solid" sm ch="Apply transformation"/>
                    </>}
                    {aMode==="query"&&<>
                      <div style={{fontSize:11,color:C.text,fontFamily:mono,lineHeight:1.6,marginBottom:4}}>{aRes.answer}</div>
                      {aRes.stat&&<div style={{fontSize:10,color:C.purple,fontFamily:mono}}>{aRes.statLabel}: {aRes.stat}</div>}
                    </>}
                  </div>
                )}
                {aSt==="err"&&<div style={{fontSize:11,color:C.red,fontFamily:mono}}>AI unavailable. Check connection.</div>}
              </div>
              {/* Normalize button for cat columns — still available inline for quick access */}
              {selIsCat&&<div style={{marginBottom:"0.8rem"}}>
                <Btn onClick={()=>openNormDialog(sel)} color={C.teal} sm ch="⬡ Open full normalizer for this column…"/>
              </div>}
            </div>
          )}
          {act==="rename"&&<div><Lbl>New name</Lbl><div style={{display:"flex",gap:8}}><input value={rv} onChange={e=>setRv(e.target.value)} style={{flex:1,...inS}}/><Btn onClick={doRename} color={C.gold} v="solid" ch="Rename"/><Btn onClick={()=>setAct(null)} ch="Cancel"/></div></div>}
          {act==="filter"&&(
            <FilterBuilder
              headers={headers} info={info} rows={rows}
              onAdd={doFilter}
              onCancel={()=>setAct(null)}
            />
          )}
          {act==="drop"&&<div><div style={{fontSize:12,color:C.red,marginBottom:"0.8rem",fontFamily:mono}}>Drop column '{sel}'?</div><div style={{display:"flex",gap:8}}><Btn onClick={doDrop} color={C.red} v="solid" ch="Confirm Drop"/><Btn onClick={()=>setAct(null)} ch="Cancel"/></div></div>}
        </div>
      )}
      {/* ── Fill Missing Values ── */}
      <FillNaSection headers={headers} rows={rows} info={info} onAdd={onAdd}/>

      <Lbl>Preview — pipeline output</Lbl>
      <Grid headers={headers} rows={rows} hi={sel} max={8}/>
    </div>
  );
}

// ─── PANEL TAB ────────────────────────────────────────────────────────────────
function PanelTab({rows,headers,panel,setPanel}){
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


// ─── RESHAPE TAB ──────────────────────────────────────────────────────────────
// pivot_longer (wide→long) + group_summarize (collapse rows).
// Both are structurally destructive — they change the shape of the dataset,
// not just add columns. Kept separate from Feature Engineering deliberately.
function ReshapeTab({ rows, headers, info, onAdd }) {
  const [sub, setSub] = useState("pivot");

  // ── pivot_longer state ────────────────────────────────────────────────────
  const [pivCols,  setPivCols]  = useState([]);   // columns to pivot
  const [namesTo,  setNamesTo]  = useState("variable");
  const [valuesTo, setValuesTo] = useState("value");
  // idCols = all non-pivot cols (auto)

  // ── group_summarize state ─────────────────────────────────────────────────
  const [byCols,   setByCols]   = useState([]);
  const [aggs,     setAggs]     = useState([]);   // [{col, fn, nn}]
  const [sumResult,setSumResult]= useState(null); // {rows, headers} after collapse
  // Tooltip state for unique-value hover on group-by chips
  const [hoveredCol, setHoveredCol] = useState(null);

  const catC = headers.filter(h => info[h]?.isCat || (!info[h]?.isNum && info[h]?.uCount > 0));
  const numC = headers.filter(h => info[h]?.isNum);

  // ── pivot helpers ─────────────────────────────────────────────────────────
  const idCols      = headers.filter(h => !pivCols.includes(h));
  const pivPreview  = pivCols.length > 0
    ? `${rows.length} rows × ${headers.length} cols  →  ${rows.length * pivCols.length} rows × ${idCols.length + 2} cols`
    : null;

  function togglePivCol(h) {
    setPivCols(p => p.includes(h) ? p.filter(x => x !== h) : [...p, h]);
  }

  function doPivot() {
    if (!pivCols.length || !namesTo.trim() || !valuesTo.trim()) return;
    onAdd({
      type: "pivot_longer",
      cols: pivCols, namesTo: namesTo.trim(), valuesTo: valuesTo.trim(), idCols,
      desc: `Pivot longer: [${pivCols.slice(0,3).join(", ")}${pivCols.length > 3 ? "…" : ""}] → ${namesTo}/${valuesTo}`,
    });
    setPivCols([]); setNamesTo("variable"); setValuesTo("value");
  }

  // ── group_summarize helpers ───────────────────────────────────────────────
  function addAgg() {
    setAggs(a => [...a, { col: numC[0] || "", fn: "mean", nn: "" }]);
  }
  function updAgg(i, patch) {
    setAggs(a => a.map((x, j) => j !== i ? x : { ...x, ...patch,
      nn: patch.col || patch.fn
        ? `${(patch.fn || x.fn)}_${(patch.col || x.col)}`
        : x.nn
    }));
  }
  function rmAgg(i) { setAggs(a => a.filter((_, j) => j !== i)); }

  function doSummarize() {
    if (!byCols.length || !aggs.length) return;
    const validAggs = aggs.filter(a => a.col && a.fn && a.nn.trim());
    if (!validAggs.length) return;
    const step = {
      type: "group_summarize",
      by: byCols,
      aggs: validAggs.map(a => ({ ...a, nn: a.nn.trim() })),
      desc: `group_by [${byCols.join(", ")}] → summarize (${validAggs.map(a => `${a.fn}(${a.col})`).join(", ")})`,
    };
    onAdd(step);
    // Compute result locally so we can show it inline + enable export
    // without waiting for the pipeline to re-run
    const { applyStep } = { applyStep: window.__econApplyStep };
    // Fallback: derive result from current rows directly
    const byKey = r => step.by.map(b => String(r[b] ?? "")).join("||");
    const groups = new Map();
    rows.forEach(r => {
      const k = byKey(r);
      if (!groups.has(k)) groups.set(k, { _first: r, _rows: [] });
      groups.get(k)._rows.push(r);
    });
    const outRows = [];
    const outHeaders = [...step.by, ...step.aggs.map(a => a.nn)];
    for (const { _first, _rows } of groups.values()) {
      const out = {};
      step.by.forEach(b => { out[b] = _first[b]; });
      step.aggs.forEach(({ col, fn, nn }) => {
        const vals = _rows.map(r => r[col]).filter(v => typeof v === "number" && isFinite(v));
        if (fn === "count") { out[nn] = _rows.length; return; }
        if (!vals.length)  { out[nn] = null; return; }
        if (fn === "sum")    { out[nn] = vals.reduce((a,b)=>a+b,0); return; }
        if (fn === "min")    { out[nn] = Math.min(...vals); return; }
        if (fn === "max")    { out[nn] = Math.max(...vals); return; }
        const mean = vals.reduce((a,b)=>a+b,0)/vals.length;
        if (fn === "mean")   { out[nn] = mean; return; }
        if (fn === "sd")     { out[nn] = vals.length>1?Math.sqrt(vals.reduce((s,v)=>s+(v-mean)**2,0)/(vals.length-1)):0; return; }
        if (fn === "median") { const s=[...vals].sort((a,b)=>a-b),m=Math.floor(s.length/2); out[nn]=s.length%2===0?(s[m-1]+s[m])/2:s[m]; return; }
        out[nn] = null;
      });
      outRows.push(out);
    }
    setSumResult({ rows: outRows, headers: outHeaders, by: step.by, aggs: step.aggs });
    setByCols([]); setAggs([]);
  }

  const canSummarize = byCols.length > 0 && aggs.some(a => a.col && a.fn && a.nn.trim());
  const FN_OPTS = [
    ["mean","Mean (μ)"],["median","Median"],["sum","Sum (Σ)"],
    ["count","Count (n)"],["min","Min"],["max","Max"],["sd","Std dev (σ)"],
  ];

  const inS = { padding:"0.38rem 0.6rem", background:C.surface2,
    border:`1px solid ${C.border2}`, borderRadius:3, color:C.text,
    fontFamily:mono, fontSize:11, outline:"none" };

  return (
    <div>
      <Tabs tabs={[["pivot","⟲ Pivot longer"],["summarize","⊞ Group & summarize"]]}
        active={sub} set={setSub} accent={C.teal} sm/>

      {/* ══════════════ PIVOT LONGER ══════════════════════════════════════ */}
      {sub === "pivot" && (
        <div>
          <div style={{padding:"0.65rem 1rem",background:C.surface,
            border:`1px solid ${C.border}`,borderLeft:`3px solid ${C.teal}`,
            borderRadius:4,marginBottom:"1.2rem",fontSize:11,color:C.textDim,lineHeight:1.6}}>
            Converts <span style={{color:C.gold}}>wide format</span> (one column per period/variable)
            to <span style={{color:C.teal}}>long format</span> (one row per observation).
            Equivalent to <code style={{color:C.green}}>tidyr::pivot_longer()</code>.
          </div>

          {/* Column selector */}
          <Lbl color={C.teal}>Columns to pivot <span style={{color:C.textMuted}}>(the value columns)</span></Lbl>
          <div style={{marginBottom:"0.5rem",display:"flex",gap:6,flexWrap:"wrap"}}>
            <button onClick={()=>setPivCols(numC)}
              style={{padding:"0.2rem 0.55rem",border:`1px solid ${C.border2}`,
                background:"transparent",color:C.textDim,borderRadius:2,cursor:"pointer",
                fontSize:9,fontFamily:mono}}>select all numeric</button>
            <button onClick={()=>setPivCols([])}
              style={{padding:"0.2rem 0.55rem",border:`1px solid ${C.border2}`,
                background:"transparent",color:C.textDim,borderRadius:2,cursor:"pointer",
                fontSize:9,fontFamily:mono}}>clear</button>
          </div>
          <div style={{display:"flex",flexWrap:"wrap",gap:4,marginBottom:"1.2rem",
            maxHeight:160,overflowY:"auto",padding:"0.5rem",
            background:C.surface2,border:`1px solid ${C.border}`,borderRadius:4}}>
            {headers.map(h => {
              const sel = pivCols.includes(h);
              return (
                <button key={h} onClick={() => togglePivCol(h)} style={{
                  padding:"0.25rem 0.6rem",
                  border:`1px solid ${sel ? C.teal : C.border2}`,
                  background: sel ? `${C.teal}18` : "transparent",
                  color: sel ? C.teal : info[h]?.isNum ? C.blue : C.textDim,
                  borderRadius:3,cursor:"pointer",fontSize:10,fontFamily:mono,
                  transition:"all 0.1s",
                }}>
                  {sel ? "✓ " : ""}{h}
                </button>
              );
            })}
          </div>

          {/* ID columns preview */}
          {pivCols.length > 0 && (
            <div style={{padding:"0.5rem 0.75rem",background:C.surface,
              border:`1px solid ${C.border}`,borderRadius:3,marginBottom:"1.2rem",
              fontSize:10,color:C.textMuted,fontFamily:mono,lineHeight:1.7}}>
              <span style={{color:C.textDim}}>ID cols kept as-is: </span>
              {idCols.slice(0,6).map(h => (
                <span key={h} style={{color:C.gold,marginRight:6}}>{h}</span>
              ))}
              {idCols.length > 6 && <span>+{idCols.length - 6} more</span>}
            </div>
          )}

          {/* Output column names */}
          <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:"0.8rem",marginBottom:"1.2rem"}}>
            {[
              ["Key column name", namesTo, setNamesTo, C.violet, "e.g. year, variable, period"],
              ["Value column name", valuesTo, setValuesTo, C.teal, "e.g. value, gdp, rate"],
            ].map(([label, val, setter, color, ph]) => (
              <div key={label}>
                <Lbl color={color}>{label}</Lbl>
                <input value={val} onChange={e => setter(e.target.value)}
                  placeholder={ph}
                  style={{...inS, width:"100%", boxSizing:"border-box",
                    border:`1px solid ${C.border2}`}}/>
              </div>
            ))}
          </div>

          {/* Shape preview */}
          {pivPreview && (
            <div style={{padding:"0.55rem 0.85rem",background:`${C.teal}08`,
              border:`1px solid ${C.teal}30`,borderRadius:3,marginBottom:"1rem",
              fontSize:11,fontFamily:mono,color:C.textDim}}>
              <span style={{color:C.gold}}>→</span> {pivPreview}
              <div style={{fontSize:9,color:C.textMuted,marginTop:3}}>
                Key col: <span style={{color:C.violet}}>{namesTo||"?"}</span>
                {" · "}Value col: <span style={{color:C.teal}}>{valuesTo||"?"}</span>
              </div>
            </div>
          )}

          <Btn onClick={doPivot} color={C.teal} v="solid"
            dis={!pivCols.length || !namesTo.trim() || !valuesTo.trim()}
            ch="Pivot longer →"/>
        </div>
      )}

      {/* ══════════════ GROUP & SUMMARIZE ═════════════════════════════════ */}
      {sub === "summarize" && (
        <div>
          <div style={{padding:"0.65rem 1rem",background:C.surface,
            border:`1px solid ${C.border}`,borderLeft:`3px solid ${C.orange}`,
            borderRadius:4,marginBottom:"1.2rem",fontSize:11,color:C.textDim,lineHeight:1.6}}>
            Collapses rows to one per group. Equivalent to{" "}
            <code style={{color:C.green}}>dplyr::group_by() |&gt; summarise()</code>.{" "}
            <span style={{color:C.red}}>Destructive</span> — original rows are replaced.
          </div>

          {/* Group by — with unique-value tooltip on hover */}
          <Lbl color={C.orange}>Group by <span style={{color:C.textMuted}}>(categorical columns)</span></Lbl>
          <div style={{display:"flex",flexWrap:"wrap",gap:4,marginBottom:"0.5rem"}}>
            {headers.map(h => {
              const isCat = !info[h]?.isNum;
              const sel   = byCols.includes(h);
              const uVals = info[h]?.uVals?.map(v => String(v)) || [];
              const isHov = hoveredCol === h;
              return (
                <div key={h} style={{position:"relative"}}>
                  <button
                    onClick={() => isCat && setByCols(p =>
                      p.includes(h) ? p.filter(x => x !== h) : [...p, h]
                    )}
                    onMouseEnter={() => isCat && setHoveredCol(h)}
                    onMouseLeave={() => setHoveredCol(null)}
                    style={{
                      padding:"0.28rem 0.6rem",
                      border:`1px solid ${sel ? C.orange : isCat ? C.border2 : C.border}`,
                      background: sel ? `${C.orange}18` : "transparent",
                      color: sel ? C.orange : isCat ? C.textDim : C.textMuted,
                      borderRadius:3, cursor: isCat ? "pointer" : "default",
                      fontSize:10, fontFamily:mono, opacity: isCat ? 1 : 0.4,
                      transition:"all 0.1s",
                    }}>
                    {sel ? "✓ " : ""}{h}
                    {isCat && <span style={{fontSize:8,color:C.textMuted,marginLeft:3}}>({info[h]?.uCount})</span>}
                    {!isCat && <span style={{fontSize:8,marginLeft:3,color:C.textMuted}}>num</span>}
                  </button>
                  {/* Unique values tooltip */}
                  {isHov && uVals.length > 0 && (
                    <div style={{
                      position:"absolute", top:"calc(100% + 4px)", left:0,
                      background:C.surface2, border:`1px solid ${C.border2}`,
                      borderRadius:4, padding:"0.5rem 0.65rem",
                      zIndex:50, minWidth:120, maxWidth:220,
                      boxShadow:"0 6px 20px #000a",
                      fontSize:10, fontFamily:mono, color:C.textDim,
                      pointerEvents:"none",
                    }}>
                      <div style={{fontSize:9,color:C.orange,letterSpacing:"0.12em",
                        textTransform:"uppercase",marginBottom:4}}>
                        {info[h]?.uCount} unique values
                      </div>
                      <div style={{display:"flex",flexWrap:"wrap",gap:3}}>
                        {uVals.slice(0,12).map(v => (
                          <span key={v} style={{
                            padding:"1px 5px",border:`1px solid ${C.border2}`,
                            borderRadius:2,color:C.text,background:C.surface3,
                            fontSize:10,
                          }}>{v}</span>
                        ))}
                        {uVals.length > 12 && (
                          <span style={{color:C.textMuted,fontSize:9}}>+{uVals.length-12} more</span>
                        )}
                      </div>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
          <div style={{fontSize:9,color:C.textMuted,fontFamily:mono,marginBottom:"1.2rem"}}>
            Hover a column to preview its unique values
          </div>

          {/* Aggregations */}
          <div style={{display:"flex",alignItems:"center",gap:8,marginBottom:"0.6rem"}}>
            <Lbl mb={0} color={C.blue}>Aggregations</Lbl>
            <button onClick={addAgg} style={{
              padding:"0.2rem 0.55rem",border:`1px solid ${C.blue}`,
              background:`${C.blue}10`,color:C.blue,borderRadius:2,
              cursor:"pointer",fontSize:9,fontFamily:mono,
            }}>+ add</button>
          </div>

          {aggs.length === 0 && (
            <div style={{padding:"0.65rem 1rem",background:C.surface,
              border:`1px dashed ${C.border2}`,borderRadius:4,
              fontSize:11,color:C.textMuted,fontFamily:mono,marginBottom:"1.2rem"}}>
              Add at least one aggregation function.
            </div>
          )}

          <div style={{display:"flex",flexDirection:"column",gap:6,marginBottom:"1.2rem"}}>
            {aggs.map((agg, i) => (
              <div key={i} style={{display:"grid",gridTemplateColumns:"1fr 140px 1fr auto",
                gap:6,alignItems:"center",padding:"0.5rem 0.65rem",
                background:C.surface2,border:`1px solid ${C.border}`,borderRadius:4}}>
                <select value={agg.col}
                  onChange={e => updAgg(i, { col: e.target.value })}
                  style={{...inS, width:"100%"}}>
                  <option value="">— column —</option>
                  {numC.map(h => <option key={h} value={h}>{h}</option>)}
                </select>
                <select value={agg.fn}
                  onChange={e => updAgg(i, { fn: e.target.value })}
                  style={{...inS}}>
                  {FN_OPTS.map(([v,l]) => <option key={v} value={v}>{l}</option>)}
                </select>
                <input value={agg.nn}
                  onChange={e => setAggs(a => a.map((x,j) => j!==i ? x : {...x, nn:e.target.value}))}
                  placeholder={`${agg.fn}_${agg.col||"col"}`}
                  style={{...inS, width:"100%", boxSizing:"border-box"}}/>
                <button onClick={() => rmAgg(i)} style={{
                  background:"transparent",border:`1px solid ${C.border2}`,
                  borderRadius:2,color:C.textMuted,cursor:"pointer",
                  fontSize:11,padding:"0.2rem 0.4rem",
                }}>✕</button>
              </div>
            ))}
          </div>

          {/* dplyr preview */}
          {canSummarize && (
            <div style={{padding:"0.55rem 0.85rem",background:`${C.orange}08`,
              border:`1px solid ${C.orange}30`,borderRadius:3,marginBottom:"1rem",
              fontSize:11,fontFamily:mono,color:C.textDim,lineHeight:1.8}}>
              <span style={{color:C.gold}}>→</span>{" "}
              group_by [<span style={{color:C.orange}}>{byCols.join(", ")}</span>]{" "}
              |&gt; summarise(<br/>
              {aggs.filter(a=>a.col&&a.fn&&a.nn.trim()).map((a,i) => (
                <span key={i}>
                  {"  "}<span style={{color:C.teal}}>{a.nn}</span>{" = "}
                  <span style={{color:C.blue}}>{a.fn}</span>({a.col})
                  {i < aggs.length-1 ? "," : ""}<br/>
                </span>
              ))}
              )
            </div>
          )}

          <div style={{display:"flex",gap:8,alignItems:"center",marginBottom:"1.5rem"}}>
            <Btn onClick={doSummarize} color={C.orange} v="solid"
              dis={!canSummarize} ch="Collapse rows →"/>
            {sumResult && (
              <button onClick={() => setSumResult(null)}
                style={{background:"transparent",border:"none",
                  color:C.textMuted,cursor:"pointer",fontSize:10,fontFamily:mono}}>
                clear result
              </button>
            )}
          </div>

          {/* ── Inline result panel ─────────────────────────────────────── */}
          {sumResult && (
            <div style={{border:`1px solid ${C.orange}40`,borderRadius:4,overflow:"hidden"}}>
              {/* Result header */}
              <div style={{padding:"0.55rem 0.9rem",background:`${C.orange}0a`,
                borderBottom:`1px solid ${C.orange}30`,
                display:"flex",alignItems:"center",gap:10}}>
                <span style={{fontSize:10,color:C.orange,letterSpacing:"0.15em",
                  textTransform:"uppercase",fontFamily:mono,flex:1}}>
                  ⊞ Result — {sumResult.rows.length} group{sumResult.rows.length!==1?"s":""}
                  <span style={{color:C.textMuted,marginLeft:8,fontSize:9}}>
                    × {sumResult.headers.length} cols
                  </span>
                </span>
                {/* Export buttons */}
                <button onClick={()=>{
                  // LaTeX tabular
                  const cols = sumResult.headers;
                  const numericCols = new Set(sumResult.aggs.map(a=>a.nn));
                  const fmt = v => {
                    if (v === null || v === undefined) return "";
                    if (typeof v === "number") return v.toFixed(3).replace(/\.?0+$/,"");
                    return String(v);
                  };
                  const colSpec = cols.map(h => numericCols.has(h) ? "r" : "l").join(" ");
                  const header  = cols.join(" & ") + " \\\\";
                  const rule    = "\\hline";
                  const body    = sumResult.rows.map(r =>
                    cols.map(h => fmt(r[h])).join(" & ") + " \\\\"
                  ).join("\n");
                  const latex = [
                    "\\begin{table}[htbp]",
                    "  \\centering",
                    `  \\caption{Summary statistics by ${sumResult.by.join(", ")}}`,
                    "  \\label{tab:summary}",
                    `  \\begin{tabular}{${colSpec}}`,
                    "    \\hline",
                    `    ${header}`,
                    "    \\hline",
                    `    ${body}`,
                    "    \\hline",
                    "  \\end{tabular}",
                    "\\end{table}",
                  ].join("\n");
                  const blob = new Blob([latex],{type:"text/plain"});
                  const a = document.createElement("a");
                  a.href = URL.createObjectURL(blob);
                  a.download = `summary_${sumResult.by.join("_")}.tex`;
                  a.click(); URL.revokeObjectURL(a.href);
                }} style={{
                  padding:"0.22rem 0.6rem",background:"transparent",
                  border:`1px solid ${C.border2}`,borderRadius:2,
                  color:C.textDim,cursor:"pointer",fontSize:9,fontFamily:mono,
                  transition:"all 0.1s",
                }}
                  onMouseEnter={e=>{e.currentTarget.style.borderColor=C.gold;e.currentTarget.style.color=C.gold;}}
                  onMouseLeave={e=>{e.currentTarget.style.borderColor=C.border2;e.currentTarget.style.color=C.textDim;}}
                >↓ LaTeX</button>

                <button onClick={()=>{
                  const esc = v => {
                    if(v===null||v===undefined) return "";
                    const s=String(v);
                    return s.includes(",")||s.includes('"')||s.includes("\n")?`"${s.replace(/"/g,'""')}"`  :s;
                  };
                  const lines = [
                    sumResult.headers.map(esc).join(","),
                    ...sumResult.rows.map(r=>sumResult.headers.map(h=>esc(r[h])).join(",")),
                  ];
                  const blob = new Blob([lines.join("\r\n")],{type:"text/csv"});
                  const a = document.createElement("a");
                  a.href = URL.createObjectURL(blob);
                  a.download = `summary_${sumResult.by.join("_")}.csv`;
                  a.click(); URL.revokeObjectURL(a.href);
                }} style={{
                  padding:"0.22rem 0.6rem",background:"transparent",
                  border:`1px solid ${C.border2}`,borderRadius:2,
                  color:C.textDim,cursor:"pointer",fontSize:9,fontFamily:mono,
                  transition:"all 0.1s",
                }}
                  onMouseEnter={e=>{e.currentTarget.style.borderColor=C.teal;e.currentTarget.style.color=C.teal;}}
                  onMouseLeave={e=>{e.currentTarget.style.borderColor=C.border2;e.currentTarget.style.color=C.textDim;}}
                >↓ CSV</button>
              </div>

              {/* Result table */}
              <div style={{overflowX:"auto",maxHeight:340,overflowY:"auto"}}>
                <table style={{borderCollapse:"collapse",fontSize:11,
                  width:"100%",fontFamily:mono}}>
                  <thead>
                    <tr style={{background:C.surface2,position:"sticky",top:0}}>
                      {sumResult.headers.map(h => {
                        const isBy  = sumResult.by.includes(h);
                        const isAgg = sumResult.aggs.some(a=>a.nn===h);
                        return (
                          <th key={h} style={{
                            padding:"0.4rem 0.75rem",textAlign:"left",
                            fontWeight:400,fontSize:10,
                            color: isBy ? C.orange : C.blue,
                            whiteSpace:"nowrap",
                            borderBottom:`1px solid ${C.border}`,
                          }}>
                            {h}
                            <span style={{fontSize:8,color:C.textMuted,marginLeft:4}}>
                              {isBy ? "group" : sumResult.aggs.find(a=>a.nn===h)?.fn}
                            </span>
                          </th>
                        );
                      })}
                    </tr>
                  </thead>
                  <tbody>
                    {sumResult.rows.map((row, i) => (
                      <tr key={i} style={{background:i%2?C.surface2:C.surface}}>
                        {sumResult.headers.map(h => {
                          const v = row[h];
                          const isNull = v===null||v===undefined;
                          const isNum  = typeof v==="number";
                          return (
                            <td key={h} style={{
                              padding:"0.32rem 0.75rem",
                              color: isNull ? C.textMuted : isNum ? C.blue : C.text,
                              borderBottom:`1px solid ${C.border}`,
                              whiteSpace:"nowrap",
                              textAlign: isNum ? "right" : "left",
                            }}>
                              {isNull ? "·" : isNum ? v.toFixed(3).replace(/\.?0+$/,"") : String(v)}
                            </td>
                          );
                        })}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}
        </div>
      )}
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
  const [winzMode,setWinzMode]=useState("inplace");
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
    if(qt==="winz") return;
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
    if(qt==="winz"){
      const vals=rows.map(r=>r[qc]).filter(v=>typeof v==="number"&&isFinite(v)).sort((a,b)=>a-b);
      const lo=vals[Math.floor(vals.length*.01)]??vals[0],hi=vals[Math.floor(vals.length*.99)]??vals[vals.length-1];
      // name optional — default to winsor_col for new-col mode, col itself for in-place
      const targetCol=winzMode==="inplace"?qc:(nm.trim()||`winsor_${qc}`);
      onAdd({type:"winz",col:qc,nn:targetCol,lo,hi,desc:`Winsorize '${qc}' [p1,p99] → '${targetCol}'${winzMode==="inplace"?" (in-place)":""}`});
      resetQuick();return;
    }
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
  const canAddQuick=qc&&(qt==="winz"||(nm.trim()&&(qt!=="ix"||(qt==="ix"&&xc2))));

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
          {vt==="quick"&&qt==="winz"?(
            <>
              <div style={{display:"flex",gap:4,marginBottom:6}}>
                {[["inplace","In-place (overwrite)"],["newcol","New column"]].map(([m,l])=>(
                  <button key={m} onClick={()=>setWinzMode(m)} style={{padding:"0.25rem 0.7rem",border:`1px solid ${winzMode===m?C.orange:C.border2}`,background:winzMode===m?`${C.orange}18`:"transparent",color:winzMode===m?C.orange:C.textDim,borderRadius:3,cursor:"pointer",fontSize:10,fontFamily:mono,transition:"all 0.12s"}}>{winzMode===m?"✓ ":""}{l}</button>
                ))}
              </div>
              {winzMode==="newcol"&&(
                <input value={nm} onChange={e=>{setNm(e.target.value);prevAutoRef.current="";}}
                  placeholder={`(optional) default: winsor_${qc||"col"}`}
                  style={{...inpS}}/>
              )}
            </>
          ):(
            <>
              <div style={{display:"flex",alignItems:"center",gap:8,marginBottom:4}}>
                <Lbl mb={0}>New variable name</Lbl>
                {nm&&<span style={{fontSize:9,color:C.textMuted,fontFamily:mono}}>← auto-suggested</span>}
              </div>
              <input value={nm} onChange={e=>{setNm(e.target.value);prevAutoRef.current="";}}
                placeholder="e.g. log_wage, wage_lag1, treat_x_post"
                style={{...inpS}}/>
            </>
          )}
        </div>
      )}

      {/* ── Quick Transforms ── */}
      {vt==="quick"&&(
        <div>
          <Lbl color={C.teal}>Transform</Lbl>
          <div style={{display:"flex",flexWrap:"wrap",gap:4,marginBottom:"1.2rem"}}>
            {[["log","ln(x)"],["sq","x²"],["std","z-score"],["ix","x₁×x₂"],["winz","Winsorize p1/p99"]].map(([k,l])=>(
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

          {/* Winsorize options — shown right after column is selected */}
          {qt==="winz"&&qc&&(()=>{
            const wVals=rows.map(r=>r[qc]).filter(v=>typeof v==="number"&&isFinite(v)).sort((a,b)=>a-b);
            const wLo=wVals[Math.floor(wVals.length*.01)]??wVals[0];
            const wHi=wVals[Math.floor(wVals.length*.99)]??wVals[wVals.length-1];
            const nClipped=wVals.filter(v=>v<wLo||v>wHi).length;
            return (
              <div style={{padding:"0.7rem 0.9rem",background:`${C.orange}08`,border:`1px solid ${C.orange}30`,borderLeft:`3px solid ${C.orange}`,borderRadius:4,marginBottom:"1rem"}}>
                <div style={{display:"flex",gap:4,marginBottom:8}}>
                  {[["inplace","Overwrite column"],["newcol","New column"]].map(([m,l])=>(
                    <button key={m} onClick={()=>setWinzMode(m)} style={{padding:"0.25rem 0.7rem",border:`1px solid ${winzMode===m?C.orange:C.border2}`,background:winzMode===m?`${C.orange}18`:"transparent",color:winzMode===m?C.orange:C.textDim,borderRadius:3,cursor:"pointer",fontSize:10,fontFamily:mono,transition:"all 0.12s"}}>{winzMode===m?"✓ ":""}{l}</button>
                  ))}
                </div>
                {winzMode==="newcol"&&(
                  <input value={nm} onChange={e=>{setNm(e.target.value);prevAutoRef.current="";}}
                    placeholder={`winsor_${qc}`}
                    style={{width:"100%",boxSizing:"border-box",padding:"0.38rem 0.6rem",background:C.surface2,border:`1px solid ${C.border2}`,borderRadius:3,color:C.text,fontFamily:mono,fontSize:11,outline:"none",marginBottom:8}}/>
                )}
                <div style={{fontSize:11,color:C.textDim,fontFamily:mono,lineHeight:1.8}}>
                  <div>Clip <span style={{color:C.gold}}>{qc}</span> to [p1={wLo!=null?wLo.toFixed(4):"?"}, p99={wHi!=null?wHi.toFixed(4):"?"}]</div>
                  <div style={{color:C.textMuted}}>
                    {nClipped} value{nClipped!==1?"s":""} will be clamped
                    {" · "}range [{wVals[0]?.toFixed(3)}, {wVals[wVals.length-1]?.toFixed(3)}]
                    {" → "}[{wLo?.toFixed(3)}, {wHi?.toFixed(3)}]
                  </div>
                </div>
              </div>
            );
          })()}

          {/* Formula preview for non-winz transforms */}
          {qc&&qt!=="winz"&&<div style={{padding:"0.48rem 0.75rem",background:C.surface,border:`1px solid ${C.border}`,borderRadius:3,marginBottom:"1rem",fontSize:11,color:C.textDim,fontFamily:mono}}>
            {qt==="log"&&<><span style={{color:C.teal}}>{nm||"?"}</span> = ln(<span style={{color:C.gold}}>{qc}</span>)</>}
            {qt==="sq"&&<><span style={{color:C.teal}}>{nm||"?"}</span> = <span style={{color:C.gold}}>{qc}</span>²</>}
            {qt==="std"&&<><span style={{color:C.teal}}>{nm||"?"}</span> = (<span style={{color:C.gold}}>{qc}</span>−μ)/σ</>}
            {qt==="ix"&&xc2&&<><span style={{color:C.teal}}>{nm||"?"}</span> = <span style={{color:C.gold}}>{qc}</span>×<span style={{color:C.gold}}>{xc2}</span></>}
          </div>}
          <Btn onClick={doQ} color={C.teal} v="solid" dis={!canAddQuick} ch={qt==="winz"?`Winsorize ${winzMode==="inplace"?"in-place":"→ new col"}`:"Add variable"}/>
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

// ─── DATA DICTIONARY TAB ─────────────────────────────────────────────────────
// Allows AI inference of column descriptions + manual editing.
// Props: headers, rows (sample), dict, setDict
function DataDictionaryTab({ headers, rows, dict, setDict }) {
  const [loading, setLoading] = useState(false);
  const [error,   setError]   = useState("");
  const [done,    setDone]    = useState(false);

  const infer = async () => {
    setLoading(true);
    setError("");
    setDone(false);
    try {
      const result = await inferVariableUnits(headers, rows.slice(0, 3));
      setDict(result);
      setDone(true);
    } catch (e) {
      setError(e?.message ?? "Inference failed. Check your API connection.");
    } finally {
      setLoading(false);
    }
  };

  const updateDesc = (col, val) => setDict(d => ({ ...d, [col]: val }));

  const hasDict = dict && Object.keys(dict).length > 0;

  return (
    <div>
      {/* ── Info banner ── */}
      <div style={{
        padding: "0.65rem 1rem", background: C.surface,
        border: `1px solid ${C.border}`, borderLeft: `3px solid ${C.violet}`,
        borderRadius: 4, marginBottom: "1.2rem",
        fontSize: 11, color: C.textDim, lineHeight: 1.7,
        display: "flex", alignItems: "flex-start", gap: 10,
      }}>
        <span style={{ color: C.violet, fontSize: 13, lineHeight: 1 }}>◈</span>
        <div>
          <span style={{ color: C.text }}>Data Dictionary</span>
          {" — "}
          Map each column to a human-readable description. The AI Narrative in
          the Reporting Module uses these to phrase coefficients naturally
          (e.g.{" "}
          <span style={{ color: C.gold, fontFamily: mono }}>"one additional year of education"</span>
          {" "}instead of{" "}
          <span style={{ color: C.red, fontFamily: mono }}>"a 1 unit increase in educ"</span>
          ).
        </div>
      </div>

      {/* ── AI infer button ── */}
      <div style={{ display: "flex", gap: 8, alignItems: "center", marginBottom: "1.2rem", flexWrap: "wrap" }}>
        <Btn
          onClick={infer}
          dis={loading}
          color={C.violet}
          v="solid"
          ch={loading ? "Inferring…" : "✦ Infer Descriptions with AI"}
        />
        {loading && <Spin />}
        {done && !loading && (
          <span style={{ fontSize: 10, color: C.green, fontFamily: mono }}>
            ✓ Inferred {headers.length} descriptions — edit below as needed.
          </span>
        )}
        {hasDict && !loading && !done && (
          <span style={{ fontSize: 10, color: C.textMuted, fontFamily: mono }}>
            Dictionary loaded — edit any cell directly.
          </span>
        )}
      </div>

      {/* ── Error ── */}
      {error && (
        <div style={{
          fontSize: 11, color: C.red, fontFamily: mono, lineHeight: 1.6,
          padding: "0.65rem 1rem", border: `1px solid ${C.red}40`,
          borderLeft: `3px solid ${C.red}`, borderRadius: 4, marginBottom: "1rem",
        }}>
          ⚠ {error}
        </div>
      )}

      {/* ── Editable table ── */}
      {hasDict ? (
        <div style={{ overflowX: "auto", borderRadius: 4, border: `1px solid ${C.border}` }}>
          <table style={{ borderCollapse: "collapse", width: "100%", fontSize: 11, fontFamily: mono }}>
            <thead>
              <tr style={{ background: C.surface2 }}>
                {[["Variable", "34%", C.textDim], ["Description", "66%", C.textDim]].map(([label, w, c]) => (
                  <th key={label} style={{
                    width: w, padding: "0.45rem 0.85rem", textAlign: "left",
                    fontSize: 9, color: c, letterSpacing: "0.18em",
                    textTransform: "uppercase", fontWeight: 400,
                    borderBottom: `1px solid ${C.border}`,
                  }}>
                    {label}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {headers.map((h, i) => {
                const desc = dict[h] ?? "";
                const isDummy  = desc.startsWith("dummy");
                const isLog    = desc.startsWith("log of");
                const accent   = isDummy ? C.purple : isLog ? C.teal : C.gold;
                return (
                  <tr key={h} style={{ background: i % 2 === 0 ? C.surface : C.surface2 }}>
                    {/* Variable name (read-only) */}
                    <td style={{
                      padding: "0.45rem 0.85rem",
                      borderBottom: `1px solid ${C.border}`,
                      color: accent, fontFamily: mono, fontSize: 11,
                      whiteSpace: "nowrap",
                    }}>
                      {h}
                      {isDummy  && <span style={{ marginLeft: 6, fontSize: 9, color: C.purple, opacity: 0.7 }}>dummy</span>}
                      {isLog    && <span style={{ marginLeft: 6, fontSize: 9, color: C.teal, opacity: 0.7 }}>log</span>}
                    </td>
                    {/* Editable description */}
                    <td style={{ padding: "0.3rem 0.65rem", borderBottom: `1px solid ${C.border}` }}>
                      <input
                        value={desc}
                        onChange={e => updateDesc(h, e.target.value)}
                        placeholder="Enter description…"
                        style={{
                          width: "100%", padding: "0.32rem 0.55rem",
                          background: "transparent",
                          border: `1px solid transparent`,
                          borderRadius: 3, color: C.text,
                          fontFamily: mono, fontSize: 11, outline: "none",
                          transition: "border-color 0.13s",
                        }}
                        onFocus={e  => { e.target.style.borderColor = C.border2; e.target.style.background = C.surface3; }}
                        onBlur={e   => { e.target.style.borderColor = "transparent"; e.target.style.background = "transparent"; }}
                      />
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      ) : (
        /* ── Empty state ── */
        <div style={{
          padding: "2.5rem 1.5rem", textAlign: "center",
          border: `1px dashed ${C.border2}`, borderRadius: 4,
        }}>
          <div style={{ fontSize: 24, marginBottom: 10 }}>◈</div>
          <div style={{ fontSize: 12, color: C.textDim, lineHeight: 1.7 }}>
            Click <span style={{ color: C.violet }}>"Infer Descriptions with AI"</span> to
            auto-populate the dictionary from your column names and sample data,
            or add descriptions manually after the table appears.
          </div>
        </div>
      )}

      {/* ── Manual add hint ── */}
      {!hasDict && (
        <div style={{ marginTop: "1rem", display: "flex", gap: 8 }}>
          <Btn
            onClick={() => {
              const empty = {};
              headers.forEach(h => { empty[h] = ""; });
              setDict(empty);
            }}
            color={C.textDim}
            sm
            ch="Create empty dictionary"
          />
        </div>
      )}
    </div>
  );
}

// ─── MERGE TAB ───────────────────────────────────────────────────────────────
// JOIN and APPEND operations against other loaded datasets.
// RHS always uses raw (pre-pipeline) data of the referenced dataset.
function MergeTab({ rows, headers, filename, allDatasets, onAdd }) {
  const [subTab, setSubTab]       = useState("join");
  // JOIN state
  const [rightId, setRightId]     = useState("");
  const [leftKey, setLeftKey]     = useState("");
  const [rightKey, setRightKey]   = useState("");
  const [how, setHow]             = useState("left");
  const [suffix, setSuffix]       = useState("_r");
  // APPEND state
  const [appendId, setAppendId]   = useState("");

  const rightDs   = allDatasets.find(d => d.id === rightId);
  const appendDs  = allDatasets.find(d => d.id === appendId);
  const rightHdrs = rightDs?.rawData?.headers || [];

  const matchPreview = useMemo(() => {
    if (!rightDs || !leftKey || !rightKey) return null;
    const rKeys = new Set(rightDs.rawData.rows.map(r => String(r[rightKey] ?? "")));
    let matched = 0, keyNulls = 0;
    rows.forEach(r => {
      const v = r[leftKey];
      if (v === null || v === undefined) { keyNulls++; return; }
      if (rKeys.has(String(v))) matched++;
    });
    const validRows = rows.length - keyNulls;
    const pct = validRows ? matched / validRows : 0;
    return { matched, total: rows.length, validRows, keyNulls, pct };
  }, [rightDs, leftKey, rightKey, rows]);

  const appendPreview = useMemo(() => {
    if (!appendDs) return null;
    const rSet = new Set(appendDs.rawData.headers);
    const lSet = new Set(headers);
    return {
      shared:    headers.filter(h => rSet.has(h)).length,
      onlyLeft:  headers.filter(h => !rSet.has(h)).length,
      onlyRight: appendDs.rawData.headers.filter(h => !lSet.has(h)).length,
      rightRows: appendDs.rawData.rows.length,
    };
  }, [appendDs, headers]);

  function doJoin() {
    if (!rightId || !leftKey || !rightKey) return;
    onAdd({ type:"join", rightId, leftKey, rightKey, how, suffix,
      desc:`${how.toUpperCase()} JOIN ${rightDs?.filename} on ${leftKey} = ${rightKey}` });
    setRightId(""); setLeftKey(""); setRightKey("");
  }
  function doAppend() {
    if (!appendId) return;
    onAdd({ type:"append", rightId:appendId,
      desc:`APPEND ${appendDs?.filename} (+${appendDs?.rawData?.rows?.length} rows)` });
    setAppendId("");
  }

  const colBtnStyle = (sel, color) => ({
    padding:"0.28rem 0.55rem", border:`1px solid ${sel?color:C.border}`,
    background:sel?`${color}18`:"transparent", color:sel?color:C.textDim,
    borderRadius:2, cursor:"pointer", fontSize:10, fontFamily:mono,
    textAlign:"left", transition:"all 0.1s",
  });
  const joinTypBtn = (k,l) => (
    <button key={k} onClick={()=>setHow(k)}
      style={{padding:"0.32rem 0.75rem",border:`1px solid ${how===k?C.teal:C.border2}`,
        background:how===k?`${C.teal}18`:"transparent",color:how===k?C.teal:C.textDim,
        borderRadius:3,cursor:"pointer",fontSize:11,fontFamily:mono,transition:"all 0.1s"}}>
      {how===k?"✓ ":""}{l}
    </button>
  );

  // ── Empty state — no other datasets loaded ──
  if (!allDatasets.length) {
    return (
      <div style={{padding:"2.5rem 1.5rem",textAlign:"center",border:`1px dashed ${C.border2}`,borderRadius:4}}>
        <div style={{fontSize:22,marginBottom:10}}>⊞</div>
        <div style={{fontSize:12,color:C.textDim,lineHeight:1.8,fontFamily:mono}}>
          No other datasets loaded.<br/>
          Use the <span style={{color:C.teal}}>Dataset Manager</span> sidebar
          to load a second file — then join or append it here.
        </div>
      </div>
    );
  }

  return (
    <div>
      {/* ── Sub-tabs: JOIN / APPEND ── */}
      <Tabs tabs={[["join","⊞ Join"],["append","⊕ Append"]]} active={subTab} set={setSubTab} accent={C.teal} sm/>

      {/* ════════════ JOIN ════════════ */}
      {subTab==="join" && (
        <div>
          {/* Context note */}
          <div style={{padding:"0.55rem 0.9rem",background:C.surface,border:`1px solid ${C.border}`,
            borderLeft:`3px solid ${C.blue}`,borderRadius:4,marginBottom:"1.2rem",
            fontSize:10,color:C.textMuted,fontFamily:mono,lineHeight:1.6}}>
            Equivalent to dplyr's <span style={{color:C.blue}}>left_join()</span> / <span style={{color:C.blue}}>inner_join()</span>.
            The right dataset is joined against its <em>raw</em> (pre-pipeline) state.
            Apply cleaning to it first if needed.
          </div>

          {/* Right dataset picker */}
          <Lbl color={C.teal}>Right dataset</Lbl>
          <div style={{display:"flex",flexWrap:"wrap",gap:6,marginBottom:"1.4rem"}}>
            {allDatasets.map(d=>(
              <button key={d.id}
                onClick={()=>{ setRightId(d.id); setLeftKey(""); setRightKey(""); }}
                style={{padding:"0.4rem 0.9rem",border:`1px solid ${rightId===d.id?C.teal:C.border2}`,
                  background:rightId===d.id?`${C.teal}18`:"transparent",
                  color:rightId===d.id?C.teal:C.textDim,borderRadius:3,cursor:"pointer",
                  fontSize:11,fontFamily:mono,transition:"all 0.1s"}}>
                {rightId===d.id?"✓ ":""}{d.filename}
                <span style={{fontSize:9,color:C.textMuted,marginLeft:6}}>
                  {d.rawData.rows.length.toLocaleString()}×{d.rawData.headers.length}
                </span>
              </button>
            ))}
          </div>

          {rightDs && (<>
            {/* Key column selectors — two-column grid */}
            <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:"1.2rem",marginBottom:"1.2rem"}}>
              <div>
                <Lbl color={C.gold}>Left key — this dataset</Lbl>
                <div style={{display:"flex",flexDirection:"column",gap:3,maxHeight:180,overflowY:"auto",
                  padding:"0.4rem",background:C.surface2,border:`1px solid ${C.border}`,borderRadius:3}}>
                  {headers.map(h=>(
                    <button key={h} onClick={()=>setLeftKey(h)} style={colBtnStyle(leftKey===h,C.gold)}>
                      {leftKey===h?"✓ ":""}{h}
                    </button>
                  ))}
                </div>
              </div>
              <div>
                <Lbl color={C.blue}>Right key — {rightDs.filename}</Lbl>
                <div style={{display:"flex",flexDirection:"column",gap:3,maxHeight:180,overflowY:"auto",
                  padding:"0.4rem",background:C.surface2,border:`1px solid ${C.border}`,borderRadius:3}}>
                  {rightHdrs.map(h=>(
                    <button key={h} onClick={()=>setRightKey(h)} style={colBtnStyle(rightKey===h,C.blue)}>
                      {rightKey===h?"✓ ":""}{h}
                    </button>
                  ))}
                </div>
              </div>
            </div>

            {/* Match preview bar */}
            {matchPreview && (() => {
              const mc = matchPreview.pct > 0.8 ? C.green : matchPreview.pct > 0.4 ? C.yellow : C.red;
              return (
                <div style={{padding:"0.65rem 0.9rem",background:C.surface,
                  border:`1px solid ${mc}30`,borderLeft:`3px solid ${mc}`,
                  borderRadius:4,marginBottom:"1.2rem"}}>
                  <div style={{display:"flex",alignItems:"center",gap:10,marginBottom:4}}>
                    <div style={{flex:1,height:4,background:C.border,borderRadius:2,overflow:"hidden"}}>
                      <div style={{width:`${matchPreview.pct*100}%`,height:"100%",background:mc,borderRadius:2,transition:"width 0.3s"}}/>
                    </div>
                    <span style={{fontSize:11,color:mc,fontFamily:mono,flexShrink:0}}>
                      {(matchPreview.pct*100).toFixed(1)}%
                    </span>
                  </div>
                  <div style={{fontSize:11,color:C.textDim,fontFamily:mono}}>
                    <span style={{color:mc}}>{matchPreview.matched.toLocaleString()}</span>
                    {" of "}{matchPreview.validRows.toLocaleString()} left rows matched
                  </div>
                  {matchPreview.keyNulls > 0 && (
                    <div style={{fontSize:10,color:C.orange,fontFamily:mono,marginTop:4}}>
                      ⚠ {matchPreview.keyNulls} row{matchPreview.keyNulls!==1?"s":""} have null in key column '{leftKey}' — excluded from join, kept with null right-side values in LEFT JOIN.
                    </div>
                  )}
                  {matchPreview.pct < 0.5 && (
                    <div style={{fontSize:10,color:C.yellow,fontFamily:mono,marginTop:4}}>
                      ⚠ Low match rate — verify key columns use compatible formats (e.g. "DEU" vs "Germany").
                    </div>
                  )}
                </div>
              );
            })()}

            {/* Join type + suffix */}
            <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:"1.2rem",marginBottom:"1.2rem"}}>
              <div>
                <Lbl color={C.teal}>Join type</Lbl>
                <div style={{display:"flex",gap:4}}>
                  {[["left","LEFT"],["inner","INNER"]].map(([k,l])=>joinTypBtn(k,l))}
                </div>
                <div style={{fontSize:9,color:C.textMuted,fontFamily:mono,marginTop:5,lineHeight:1.5}}>
                  {how==="left"
                    ? "Keep all left rows. Right columns = null when unmatched."
                    : "Keep only rows that matched on both sides."}
                </div>
              </div>
              <div>
                <Lbl color={C.textDim}>Suffix for column conflicts</Lbl>
                <input value={suffix} onChange={e=>setSuffix(e.target.value)} placeholder="_r"
                  style={{width:"100%",boxSizing:"border-box",padding:"0.38rem 0.6rem",
                    background:C.surface2,border:`1px solid ${C.border2}`,borderRadius:3,
                    color:C.text,fontFamily:mono,fontSize:11,outline:"none"}}/>
                <div style={{fontSize:9,color:C.textMuted,fontFamily:mono,marginTop:4}}>
                  Added to right columns whose name already exists in left.
                </div>
              </div>
            </div>

            {/* Formula preview */}
            {leftKey && rightKey && (
              <div style={{padding:"0.48rem 0.75rem",background:C.surface,border:`1px solid ${C.border}`,
                borderRadius:3,marginBottom:"1rem",fontSize:11,color:C.textDim,fontFamily:mono}}>
                <span style={{color:C.gold}}>this</span> {how.toUpperCase()} JOIN{" "}
                <span style={{color:C.teal}}>{rightDs.filename}</span>
                {" ON "}<span style={{color:C.gold}}>{leftKey}</span>
                {" = "}<span style={{color:C.teal}}>{rightKey}</span>
                {" → "}<span style={{color:C.green}}>
                  +{rightHdrs.filter(h=>h!==rightKey).length} columns
                </span>
              </div>
            )}
            <Btn onClick={doJoin} color={C.teal} v="solid"
              dis={!leftKey||!rightKey}
              ch={`Add ${how.toUpperCase()} JOIN to pipeline →`}/>
          </>)}
        </div>
      )}

      {/* ════════════ APPEND ════════════ */}
      {subTab==="append" && (
        <div>
          <div style={{padding:"0.55rem 0.9rem",background:C.surface,border:`1px solid ${C.border}`,
            borderLeft:`3px solid ${C.violet}`,borderRadius:4,marginBottom:"1.2rem",
            fontSize:10,color:C.textMuted,fontFamily:mono,lineHeight:1.6}}>
            Vertically stacks rows from another dataset — equivalent to dplyr's{" "}
            <span style={{color:C.violet}}>bind_rows()</span> / SQL's UNION ALL.
            Columns are matched by name. Mismatched columns are filled with null.
          </div>

          <Lbl color={C.violet}>Dataset to append</Lbl>
          <div style={{display:"flex",flexWrap:"wrap",gap:6,marginBottom:"1.4rem"}}>
            {allDatasets.map(d=>(
              <button key={d.id} onClick={()=>setAppendId(d.id)}
                style={{padding:"0.4rem 0.9rem",border:`1px solid ${appendId===d.id?C.violet:C.border2}`,
                  background:appendId===d.id?`${C.violet}18`:"transparent",
                  color:appendId===d.id?C.violet:C.textDim,borderRadius:3,cursor:"pointer",
                  fontSize:11,fontFamily:mono,transition:"all 0.1s"}}>
                {appendId===d.id?"✓ ":""}{d.filename}
                <span style={{fontSize:9,color:C.textMuted,marginLeft:6}}>
                  {d.rawData.rows.length.toLocaleString()}×{d.rawData.headers.length}
                </span>
              </button>
            ))}
          </div>

          {appendPreview && (<>
            {/* Schema overlap stats */}
            <div style={{display:"grid",gridTemplateColumns:"repeat(3,1fr)",gap:8,marginBottom:"1.2rem"}}>
              {[
                [appendPreview.shared,   "shared columns", C.green],
                [appendPreview.onlyLeft, "only in left",   C.yellow],
                [appendPreview.onlyRight,"only in right",  C.yellow],
              ].map(([val,label,color])=>(
                <div key={label} style={{padding:"0.65rem",background:C.surface2,
                  border:`1px solid ${C.border}`,borderRadius:3,textAlign:"center"}}>
                  <div style={{fontSize:20,color,fontFamily:mono,marginBottom:3}}>{val}</div>
                  <div style={{fontSize:9,color:C.textMuted,fontFamily:mono}}>{label}</div>
                </div>
              ))}
            </div>
            {appendPreview.onlyLeft > 0 || appendPreview.onlyRight > 0 ? (
              <div style={{padding:"0.5rem 0.75rem",background:`${C.yellow}08`,
                border:`1px solid ${C.yellow}30`,borderLeft:`3px solid ${C.yellow}`,
                borderRadius:4,marginBottom:"1rem",fontSize:10,color:C.textMuted,fontFamily:mono,lineHeight:1.6}}>
                ⚠ Schema mismatch — {appendPreview.onlyLeft} column{appendPreview.onlyLeft!==1?"s":""} found
                only in left, {appendPreview.onlyRight} only in right.
                These will be filled with null for the rows that lack them.
              </div>
            ) : (
              <div style={{padding:"0.5rem 0.75rem",background:`${C.green}08`,
                border:`1px solid ${C.green}30`,borderLeft:`3px solid ${C.green}`,
                borderRadius:4,marginBottom:"1rem",fontSize:10,color:C.green,fontFamily:mono}}>
                ✓ Schemas match exactly — clean append.
              </div>
            )}
            <div style={{padding:"0.48rem 0.75rem",background:C.surface,border:`1px solid ${C.border}`,
              borderRadius:3,marginBottom:"1rem",fontSize:11,color:C.textDim,fontFamily:mono}}>
              Result: <span style={{color:C.violet}}>
                {(rows.length+appendPreview.rightRows).toLocaleString()}
              </span> rows × <span style={{color:C.violet}}>
                {headers.length+appendPreview.onlyRight}
              </span> cols
            </div>
            <Btn onClick={doAppend} color={C.violet} v="solid" ch="Add APPEND to pipeline →"/>
          </>)}
        </div>
      )}

      {/* ════════════ RESULT PREVIEW ════════════ */}
      <div style={{marginTop:"2rem"}}>
        <div style={{display:"flex",alignItems:"center",gap:10,marginBottom:"0.7rem"}}>
          <Lbl mb={0}>Current dataset — pipeline output</Lbl>
          <span style={{fontSize:9,color:C.textMuted,fontFamily:mono}}>
            {rows.length.toLocaleString()} rows × {headers.length} cols
          </span>
          <button
            onClick={()=>{
              // Serialize to CSV and trigger download
              const esc = v => {
                if(v===null||v===undefined) return "";
                const s = String(v);
                return s.includes(",")||s.includes('"')||s.includes("\n")
                  ? `"${s.replace(/"/g,'""')}"` : s;
              };
              const lines = [
                headers.map(esc).join(","),
                ...rows.map(r=>headers.map(h=>esc(r[h])).join(","))
              ];
              const blob = new Blob([lines.join("\r\n")],{type:"text/csv"});
              const a = document.createElement("a");
              a.href = URL.createObjectURL(blob);
              a.download = (filename ? filename.replace(/\.[^.]+$/, "") : "pipeline_output") + "_merged.csv";
              a.click();
              URL.revokeObjectURL(a.href);
            }}
            style={{
              marginLeft:"auto", padding:"0.25rem 0.65rem",
              background:"transparent", border:`1px solid ${C.border2}`,
              borderRadius:3, color:C.textDim, cursor:"pointer",
              fontFamily:mono, fontSize:10, transition:"all 0.12s",
            }}
            onMouseEnter={e=>{e.currentTarget.style.borderColor=C.teal;e.currentTarget.style.color=C.teal;}}
            onMouseLeave={e=>{e.currentTarget.style.borderColor=C.border2;e.currentTarget.style.color=C.textDim;}}
          >
            ↓ Export CSV
          </button>
        </div>
        <Grid headers={headers} rows={rows} max={8}/>
      </div>
    </div>
  );
}


// ─── EXPORT MENU ─────────────────────────────────────────────────────────────
// Dropdown for CSV download, pipeline JSON, and subdataset save.
function ExportMenu({ rows, headers, pipeline, filename }) {
  const [open, setOpen] = useState(false);
  const base = filename ? filename.replace(/\.[^.]+$/, "") : "dataset";

  function downloadCSV() {
    const esc = v => {
      if (v === null || v === undefined) return "";
      const s = String(v);
      return s.includes(",") || s.includes('"') || s.includes("\n")
        ? `"${s.replace(/"/g, '""')}"` : s;
    };
    const lines = [
      headers.map(esc).join(","),
      ...rows.map(r => headers.map(h => esc(r[h])).join(",")),
    ];
    const blob = new Blob([lines.join("\r\n")], { type:"text/csv" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = `${base}_pipeline_output.csv`;
    a.click(); URL.revokeObjectURL(a.href);
    setOpen(false);
  }

  function downloadPipeline() {
    const payload = {
      version: 1,
      filename,
      exportedAt: new Date().toISOString(),
      steps: pipeline,
    };
    const blob = new Blob([JSON.stringify(payload, null, 2)], { type:"application/json" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = `${base}_pipeline.json`;
    a.click(); URL.revokeObjectURL(a.href);
    setOpen(false);
  }

  const menuItems = [
    { icon:"↓", label:"Download CSV",          hint:"Current pipeline output",   action: downloadCSV },
    { icon:"{ }", label:"Download pipeline.json", hint:`${pipeline.length} step${pipeline.length!==1?"s":""}`, action: downloadPipeline },
  ];

  return (
    <div style={{ position:"relative" }}>
      <button
        onClick={() => setOpen(o => !o)}
        style={{
          padding:"0.28rem 0.65rem", borderRadius:3, cursor:"pointer",
          fontFamily:mono, fontSize:10,
          background: open ? `${C.teal}18` : "transparent",
          color: open ? C.teal : C.textDim,
          border:`1px solid ${open ? C.teal : C.border2}`,
          transition:"all 0.12s",
        }}>
        ↓ Export {open ? "▾" : "▸"}
      </button>

      {open && (
        <>
          {/* Backdrop */}
          <div onClick={() => setOpen(false)}
            style={{ position:"fixed", inset:0, zIndex:99 }}/>
          {/* Menu */}
          <div style={{
            position:"absolute", right:0, top:"calc(100% + 4px)",
            background:C.surface2, border:`1px solid ${C.border2}`,
            borderRadius:4, boxShadow:"0 8px 24px #000a",
            zIndex:100, minWidth:220, overflow:"hidden",
          }}>
            {menuItems.map(({ icon, label, hint, action }) => (
              <button key={label} onClick={action} style={{
                width:"100%", display:"flex", flexDirection:"column",
                padding:"0.6rem 0.85rem",
                background:"transparent", border:"none",
                borderBottom:`1px solid ${C.border}`,
                color:C.textDim, cursor:"pointer", fontFamily:mono,
                textAlign:"left", transition:"background 0.1s",
              }}
                onMouseEnter={e => e.currentTarget.style.background = `${C.teal}0a`}
                onMouseLeave={e => e.currentTarget.style.background = "transparent"}
              >
                <span style={{ fontSize:11, color:C.text }}>
                  <span style={{ color:C.teal, marginRight:6 }}>{icon}</span>{label}
                </span>
                <span style={{ fontSize:9, color:C.textMuted, marginTop:2 }}>{hint}</span>
              </button>
            ))}
          </div>
        </>
      )}
    </div>
  );
}

// ─── WRANGLING MODULE ROOT ────────────────────────────────────────────────────
export default function WranglingModule({rawData, filename, onComplete, pid, allDatasets = []}) {
  const [pipeline, setPipeline] = useState(()=>{try{return lsGet().find(p=>p.id===pid)?.pipeline||[];}catch{return[];}});
  const [panel, setPanel] = useState(()=>{try{return lsGet().find(p=>p.id===pid)?.panel||null;}catch{return null;}});
  const [dataDictionary, setDataDictionary] = useState(()=>{try{return lsGet().find(p=>p.id===pid)?.dataDictionary||null;}catch{return null;}});
  const [tab, setTab] = useState("clean");

  const context = useMemo(()=>({
    datasets: Object.fromEntries((allDatasets||[]).map(d=>[d.id, d.rawData]))
  }), [allDatasets]);

  const {rows, headers} = useMemo(()=>{
    const init = rawData.rows.map(r=>{const c={};rawData.headers.forEach(h=>{c[h]=r[h]??null;});return c;});
    return runPipeline(init, rawData.headers, pipeline, context);
  }, [rawData, pipeline, context]);

  const info = useMemo(()=>buildInfo(headers, rows), [headers, rows]);

  const panelReport = useMemo(()=>
    panel ? validatePanel(rows, panel.entityCol, panel.timeCol) : null,
  [rows, panel]);

  const qualityReport = useMemo(()=>
    buildDataQualityReport(headers, rows, info, panelReport),
  [headers, rows, info, panelReport]);

  useEffect(()=>{
    lsSave(pid, {filename, pipeline, panel, dataDictionary, rowCount:rawData.rows.length, colCount:rawData.headers.length, pipelineLength:pipeline.length});
  }, [pipeline, panel, dataDictionary]);

  const addStep = useCallback(s=>setPipeline(p=>[...p, {...s, id:Date.now()+Math.random()}]), []);
  const rmStep = useCallback(i=>setPipeline(p=>p.filter((_,j)=>j!==i)), []);
  const clear = useCallback(()=>setPipeline([]), []);

  const naCount = useMemo(()=>rows.filter(r=>headers.some(h=>{const v=r[h];return v===null||v===undefined;})).length, [rows, headers]);

  const proceed = () => {
    // Do NOT drop rows with NAs here — listwise deletion happens in the modeling
    // engine, restricted to the variables the user actually selects.
    // Dropping at this stage would silently delete valid observations whenever
    // any auxiliary column (e.g. a joined metadata col) has nulls.
    const ci = {};
    headers.forEach(h=>{const s=rows.find(r=>r[h]!==undefined&&r[h]!==null);ci[h]={isNumeric:typeof s?.[h]==="number"};});
    onComplete({
      headers,
      cleanRows: rows,
      colInfo: ci,
      issues: [],
      removed: naCount,
      dataDictionary: dataDictionary || {},
      panelIndex: panel
        ? {entityCol:panel.entityCol, timeCol:panel.timeCol, balance:panel.validation?.balance, blockFE:panel.validation?.blockFE}
        : null,
      changeLog: pipeline.map(s=>({type:s.type, description:s.desc, col:s.col||s.c1||s.nn||"", map:s.map||null})),
    });
  };

  return(
    <div style={{display:"flex",height:"100%",minHeight:0,background:C.bg,color:C.text,fontFamily:mono,overflow:"hidden"}}>
      <div style={{flex:1,minWidth:0,overflowY:"auto",padding:"1.4rem",paddingBottom:"3rem"}}>
        {/* Header */}
        <div style={{marginBottom:"1.2rem",display:"flex",alignItems:"flex-start",gap:12}}>
          <div style={{flex:1}}>
            <div style={{fontSize:9,color:C.teal,letterSpacing:"0.26em",textTransform:"uppercase",marginBottom:3}}>Data Studio · Wrangling</div>
            <div style={{fontSize:19,color:C.text,letterSpacing:"-0.02em",marginBottom:3}}>{filename}</div>
            <div style={{fontSize:11,color:C.textDim}}>
              <span style={{color:C.gold}}>{rawData.rows.length}</span> raw ·{" "}
              <span style={{color:C.text}}>{rows.length}</span> current ·{" "}
              <span style={{color:headers.length>rawData.headers.length?C.green:C.textMuted}}>{headers.length}</span> cols
              {naCount>0&&<span style={{color:C.yellow}}> · {naCount} rows with NAs</span>}
            </div>
          </div>
          <div style={{display:"flex",gap:6,alignItems:"center",flexShrink:0}}>
            {panel&&<span style={{fontSize:9,padding:"2px 6px",border:`1px solid ${C.blue}`,color:C.blue,borderRadius:2,letterSpacing:"0.1em",fontFamily:mono,whiteSpace:"nowrap"}}>i={panel.entityCol}·t={panel.timeCol}</span>}
            {dataDictionary&&Object.values(dataDictionary).some(v=>v)&&<span style={{fontSize:9,padding:"2px 6px",border:`1px solid ${C.violet}`,color:C.violet,borderRadius:2,letterSpacing:"0.1em",fontFamily:mono,whiteSpace:"nowrap"}}>◈ dict</span>}
            {/* Export dropdown */}
            <ExportMenu rows={rows} headers={headers} pipeline={pipeline} filename={filename}/>
            <button onClick={proceed} style={{padding:"0.28rem 0.65rem",borderRadius:3,cursor:"pointer",fontFamily:mono,fontSize:10,background:C.gold,color:C.bg,border:`1px solid ${C.gold}`,fontWeight:700}}>Proceed →</button>
          </div>
        </div>
        {/* Tabs */}
        <Tabs tabs={[
          ["clean","⬡ Cleaning"],
          ["quality",`◈ Quality${qualityReport?.flags?.filter(f=>f.severity!=="ok").length>0?` (${qualityReport.flags.filter(f=>f.severity!=="ok").length})`:"  ✓"}`],
          ["structure","⊞ Panel Structure"],
          ["features","⊕ Features"],
          ["reshape","⟲ Reshape"],
          ["merge","⊞ Merge"],
          ["dictionary","◈ Dictionary"],
        ]} active={tab} set={setTab}/>
        {tab==="clean"&&<CleanTab rows={rows} headers={headers} info={info} rawData={rawData} onAdd={addStep}/>}
        {tab==="quality"&&<DataQualityReport
          report={qualityReport}
          onApplyStep={s=>addStep(s)}
          onExportMd={()=>{
            const md = exportMarkdown(qualityReport);
            const blob = new Blob([md], {type:"text/markdown"});
            const a = document.createElement("a");
            a.href = URL.createObjectURL(blob);
            a.download = (filename?filename.replace(/\.[^.]+$/,""):"dataset")+"_quality_report.md";
            a.click(); URL.revokeObjectURL(a.href);
          }}
        />}
        {tab==="structure"&&<PanelTab rows={rows} headers={headers} panel={panel} setPanel={setPanel}/>}
        {tab==="features"&&<FeatureEngineeringTab rows={rows} headers={headers} panel={panel} info={info} onAdd={addStep}/>}
        {tab==="reshape"&&<ReshapeTab rows={rows} headers={headers} info={info} onAdd={addStep}/>}
        {tab==="merge"&&<MergeTab rows={rows} headers={headers} filename={filename} allDatasets={allDatasets} onAdd={addStep}/>}
        {tab==="dictionary"&&<DataDictionaryTab headers={headers} rows={rows} dict={dataDictionary} setDict={setDataDictionary}/>}
      </div>
      <History pipeline={pipeline} onRm={rmStep} onClear={clear}/>
    </div>
  );
}
