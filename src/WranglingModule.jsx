// ─── ECON STUDIO · WranglingModule.jsx ───────────────────────────────────────
// Data Studio: cleaning, panel declaration, feature engineering.
// Consumes rawData {headers, rows} and emits a cleanedData object.
import { useState, useCallback, useMemo, useEffect, useRef } from "react";
import { inferVariableUnits } from "./AIService.js";

// ─── THEME ────────────────────────────────────────────────────────────────────
const C = {
  bg:"#080808", surface:"#0f0f0f", surface2:"#131313", surface3:"#161616",
  border:"#1c1c1c", border2:"#252525",
  gold:"#c8a96e", goldDim:"#7a6040", goldFaint:"#1a1408",
  text:"#ddd8cc", textDim:"#888", textMuted:"#444",
  green:"#7ab896", red:"#c47070", yellow:"#c8b46e",
  blue:"#6e9ec8", purple:"#a87ec8", teal:"#6ec8b4", orange:"#c88e6e",
  violet:"#9e7ec8",
};
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

// ─── PATTERN CONSTANTS ────────────────────────────────────────────────────────
const NA_PAT = /^(na|n\/a|nan|null|none|missing|#n\/a|\.|\s*)$/i;

// ─── PIPELINE ENGINE ─────────────────────────────────────────────────────────
export function applyStep(rows, headers, s) {
  let R = rows, H = [...headers];
  switch (s.type) {
    case "rename": R=rows.map(r=>{const c={...r};c[s.newName]=c[s.col];delete c[s.col];return c;});H=headers.map(h=>h===s.col?s.newName:h);break;
    case "drop": R=rows.map(r=>{const c={...r};delete c[s.col];return c;});H=headers.filter(h=>h!==s.col);break;
    case "filter": {
      R=rows.filter(r=>{const v=r[s.col];
        if(s.op==="notna")return v!==null&&v!==undefined;
        const n=parseFloat(s.value);
        if(s.op==="eq")return String(v)===String(s.value);
        if(s.op==="neq")return String(v)!==String(s.value);
        if(s.op==="gt")return typeof v==="number"&&v>n;
        if(s.op==="lt")return typeof v==="number"&&v<n;
        if(s.op==="gte")return typeof v==="number"&&v>=n;
        if(s.op==="lte")return typeof v==="number"&&v<=n;
        return true;});break;}
    case "ai_tr": {
      try{const fn=new Function("value","rowIndex",`return (${s.js});`);R=rows.map((r,i)=>({...r,[s.col]:fn(r[s.col],i)}));}catch{}break;}
    case "log": R=rows.map(r=>{const v=r[s.col];return{...r,[s.nn]:(typeof v==="number"&&v>0)?Math.log(v):null};});if(!H.includes(s.nn))H=[...H,s.nn];break;
    case "sq": R=rows.map(r=>{const v=r[s.col];return{...r,[s.nn]:typeof v==="number"?v*v:null};});if(!H.includes(s.nn))H=[...H,s.nn];break;
    case "std": {R=rows.map(r=>{const v=r[s.col];return{...r,[s.nn]:(typeof v==="number"&&s.sd>0)?(v-s.mu)/s.sd:null};});if(!H.includes(s.nn))H=[...H,s.nn];break;}
    case "winz": R=rows.map(r=>{const v=r[s.col];if(typeof v!=="number")return r;return{...r,[s.nn||s.col]:Math.max(s.lo,Math.min(s.hi,v))};});if(s.nn&&s.nn!==s.col&&!H.includes(s.nn))H=[...H,s.nn];break;
    case "ix": R=rows.map(r=>{const a=r[s.c1],b=r[s.c2];return{...r,[s.nn]:(typeof a==="number"&&typeof b==="number")?a*b:null};});if(!H.includes(s.nn))H=[...H,s.nn];break;
    case "did": R=rows.map(r=>{const t=r[s.tc],p=r[s.pc];return{...r,[s.nn]:(typeof t==="number"&&typeof p==="number")?t*p:null};});if(!H.includes(s.nn))H=[...H,s.nn];break;
    case "dummy": {const cats=[...new Set(rows.map(r=>r[s.col]).filter(v=>v!=null))];
      R=rows.map(r=>{const a={...r};cats.forEach(c=>{a[`${s.pfx}_${c}`]=r[s.col]===c?1:0;});return a;});
      cats.forEach(c=>{const d=`${s.pfx}_${c}`;if(!H.includes(d))H=[...H,d];});break;}
    case "lag": case "lead": {
      const isL=s.type==="lag",n=s.n||1;
      if(s.ec&&s.tc){
        const em={};rows.forEach((r,idx)=>{const e=r[s.ec];if(!em[e])em[e]=[];em[e].push({idx,t:r[s.tc]});});
        const rv=new Array(rows.length).fill(null);
        Object.values(em).forEach(g=>{g.sort((a,b)=>a.t-b.t);g.forEach((item,pos)=>{const sp=isL?pos-n:pos+n;if(sp>=0&&sp<g.length)rv[item.idx]=rows[g[sp].idx][s.col];});});
        R=rows.map((r,i)=>({...r,[s.nn]:rv[i]}));
      } else R=rows.map((r,i)=>{const si=isL?i-n:i+n;return{...r,[s.nn]:(si>=0&&si<rows.length)?rows[si][s.col]:null};});
      if(!H.includes(s.nn))H=[...H,s.nn];break;}
    case "diff": {
      if(s.ec&&s.tc){
        const em={};rows.forEach((r,idx)=>{const e=r[s.ec];if(!em[e])em[e]=[];em[e].push({idx,t:r[s.tc]});});
        const rv=new Array(rows.length).fill(null);
        Object.values(em).forEach(g=>{g.sort((a,b)=>a.t-b.t);for(let p=1;p<g.length;p++){const c=rows[g[p].idx][s.col],pv=rows[g[p-1].idx][s.col];if(typeof c==="number"&&typeof pv==="number")rv[g[p].idx]=c-pv;}});
        R=rows.map((r,i)=>({...r,[s.nn]:rv[i]}));
      } else R=rows.map((r,i)=>{if(i===0)return{...r,[s.nn]:null};const c=r[s.col],p=rows[i-1][s.col];return{...r,[s.nn]:(typeof c==="number"&&typeof p==="number")?c-p:null};});
      if(!H.includes(s.nn))H=[...H,s.nn];break;}
    case "recode": {
      const map=s.map||{};
      R=rows.map(r=>{const v=r[s.col];const k=v!=null?String(v):null;return{...r,[s.col]:k!=null&&map[k]!==undefined?map[k]:v};});
      break;}
    case "quickclean": {
      const mode=s.mode||"lower";
      R=rows.map(r=>{const v=r[s.col];if(typeof v!=="string")return r;const t=v.trim();
        let out=t;
        if(mode==="lower")out=t.toLowerCase();
        else if(mode==="upper")out=t.toUpperCase();
        else if(mode==="title")out=t.replace(/\b\w/g,c=>c.toUpperCase()).replace(/\B\w/g,c=>c.toLowerCase());
        return{...r,[s.col]:out};});
      break;}
    case "date_extract": {
      // s.col: source date column (string like "2021-03-15")
      // s.parts: array of "month"|"dow"|"isweekend"
      // s.names: {month:"...", dow:"...", isweekend:"..."}
      const parseDate=v=>{
        if(v==null) return null;
        const d=new Date(String(v).trim());
        return isNaN(d.getTime())?null:d;
      };
      s.parts.forEach(part=>{
        const nn=s.names[part];
        if(!nn) return;
        R=R.map(r=>{
          const d=parseDate(r[s.col]);
          if(!d) return{...r,[nn]:null};
          if(part==="month") return{...r,[nn]:d.getMonth()+1};       // 1–12
          if(part==="dow")   return{...r,[nn]:d.getDay()};            // 0=Sun…6=Sat
          if(part==="isweekend"){const dow=d.getDay();return{...r,[nn]:(dow===0||dow===6)?1:0};}
          return r;
        });
        if(!H.includes(nn)) H=[...H,nn];
      });
      break;}
    default:break;
  }
  return{rows:R,headers:H};
}
export function runPipeline(rows, headers, pipeline) {
  let s = {rows, headers};
  for (const step of pipeline) s = applyStep(s.rows, s.headers, step);
  return s;
}

// ─── PANEL VALIDATION ─────────────────────────────────────────────────────────
export function validatePanel(rows, ec, tc) {
  if (!ec || !tc) return null;
  const entities=[...new Set(rows.map(r=>r[ec]))].sort((a,b)=>String(a).localeCompare(String(b)));
  const times=[...new Set(rows.map(r=>r[tc]))].sort((a,b)=>a-b);
  const seen={},dups=[];
  rows.forEach((r,i)=>{const k=`${r[ec]}||${r[tc]}`;if(seen[k]!==undefined)dups.push({e:r[ec],t:r[tc],rows:[seen[k]+2,i+2]});else seen[k]=i;});
  const pres={};
  entities.forEach(e=>{pres[e]={};times.forEach(t=>{pres[e][t]=false;});});
  rows.forEach(r=>{if(pres[r[ec]])pres[r[ec]][r[tc]]=true;});
  const allHave=entities.every(e=>times.every(t=>pres[e][t]));
  const t0=times[0],tN=times[times.length-1];
  const at0=entities.filter(e=>pres[e][t0]).length,atN=entities.filter(e=>pres[e][tN]).length;
  const attrition=at0>0?(at0-atN)/at0:0;
  const gaps=[];
  entities.slice(0,8).forEach(e=>{const m=times.filter(t=>!pres[e][t]);if(m.length>0)gaps.push({e,m});});
  return{entities,times,balance:allHave?"strongly_balanced":"unbalanced",dups:dups.slice(0,5),gaps,blockFE:dups.length>0,pres,attrition,at0,atN};
}

// ─── COLUMN STATS ─────────────────────────────────────────────────────────────
export function buildInfo(headers, rows) {
  const info={};
  headers.forEach(h=>{
    const vals=rows.map(r=>r[h]);
    let nc=0,na=0,tx=0; const u=new Set();
    vals.forEach(v=>{if(v===null||v===undefined){na++;return;}u.add(v);if(typeof v==="number")nc++;else tx++;});
    const num=vals.filter(v=>typeof v==="number"&&isFinite(v)).sort((a,b)=>a-b);
    const mean=num.length?num.reduce((a,b)=>a+b,0)/num.length:null;
    const std=num.length&&mean!=null?Math.sqrt(num.reduce((s,v)=>s+(v-mean)**2,0)/num.length):null;
    const q1=num[Math.floor(num.length*.25)]??null,q3=num[Math.floor(num.length*.75)]??null;
    const iqr=(q1!=null&&q3!=null)?q3-q1:null;
    const outliers=iqr!=null?num.filter(v=>v<q1-1.5*iqr||v>q3+1.5*iqr).length:0;
    const sorted=[...num];
    const median=sorted.length?sorted.length%2===0?(sorted[sorted.length/2-1]+sorted[sorted.length/2])/2:sorted[Math.floor(sorted.length/2)]:null;
    info[h]={isNum:nc>0&&tx===0,isCat:tx>0&&u.size<=30,naCount:na,naPct:vals.length?na/vals.length:0,
      total:vals.length,uCount:u.size,uVals:[...u].slice(0,20),
      mean,std,q1,q3,iqr,min:num[0]??null,max:num[num.length-1]??null,outliers,median};
  });
  return info;
}

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
  const typeColor={recode:C.teal,quickclean:C.teal,winz:C.orange,log:C.blue,sq:C.blue,std:C.blue,drop:C.red,filter:C.yellow,ai_tr:C.purple,dummy:C.green,did:C.gold,lag:C.orange,lead:C.orange,diff:C.orange,ix:C.blue,date_extract:C.violet};
  const typeIcon={recode:"⬡",quickclean:"⚡",winz:"~",log:"ln",sq:"x²",std:"z",drop:"✕",filter:"⊧",ai_tr:"✦",dummy:"D",did:"×",lag:"L",lead:"F",diff:"Δ",ix:"×",rename:"↩",date_extract:"📅"};
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

// ─── CLEANING TAB ─────────────────────────────────────────────────────────────
function CleanTab({rows,headers,info,rawData,onAdd}){
  const [sel,setSel]=useState(null),[act,setAct]=useState(null);
  const [rv,setRv]=useState(""),[fop,setFop]=useState("notna"),[fv,setFv]=useState("");
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
    else if(s.act==="filter_na")onAdd({type:"filter",col:s.col,op:"notna",desc:`Remove NAs in '${s.col}'`});
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
  function doFilter(){if(!sel)return;onAdd({type:"filter",col:sel,op:fop,value:fv,desc:`Filter '${sel}' ${fop}${fop!=="notna"?" "+fv:""}`});setAct(null);}
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
      <Lbl>Columns <span style={{color:C.textMuted}}>({headers.length})</span></Lbl>
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
          {act==="filter"&&<div><Lbl>Filter condition</Lbl><div style={{display:"flex",gap:8,flexWrap:"wrap"}}>
            <select value={fop} onChange={e=>setFop(e.target.value)} style={{padding:"0.45rem 0.65rem",background:C.surface2,border:`1px solid ${C.border2}`,borderRadius:3,color:C.text,fontFamily:mono,fontSize:11,outline:"none"}}>
              <option value="notna">Remove NAs</option><option value="eq">== eq</option><option value="neq">≠ neq</option><option value="gt">&gt; gt</option><option value="gte">≥ gte</option><option value="lt">&lt; lt</option><option value="lte">≤ lte</option>
            </select>
            {fop!=="notna"&&<input value={fv} onChange={e=>setFv(e.target.value)} placeholder="value" style={{width:90,padding:"0.45rem 0.65rem",background:C.surface2,border:`1px solid ${C.border2}`,borderRadius:3,color:C.text,fontFamily:mono,fontSize:11,outline:"none"}}/>}
            <Btn onClick={doFilter} color={C.yellow} v="solid" ch="Apply"/><Btn onClick={()=>setAct(null)} ch="Cancel"/>
          </div></div>}
          {act==="drop"&&<div><div style={{fontSize:12,color:C.red,marginBottom:"0.8rem",fontFamily:mono}}>Drop column '{sel}'?</div><div style={{display:"flex",gap:8}}><Btn onClick={doDrop} color={C.red} v="solid" ch="Confirm Drop"/><Btn onClick={()=>setAct(null)} ch="Cancel"/></div></div>}
        </div>
      )}
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

// ─── FEATURE ENGINEERING TAB ──────────────────────────────────────────────────
function FeatureEngineeringTab({rows,headers,panel,info,onAdd}){
  const [vt,setVt]=useState("quick"),[nm,setNm]=useState("");
  const [qt,setQt]=useState("log"),[qc,setQc]=useState(""),[xc2,setXc2]=useState("");
  const [pop,setPop]=useState("lag"),[pc,setPc]=useState(""),[lagN,setLagN]=useState(1);
  const [dc,setDc]=useState(""),[dp,setDp]=useState("");
  const [dtc,setDtc]=useState(""),[dpc,setDpc]=useState("");
  const [winzMode,setWinzMode]=useState("inplace");
  // Date extraction state
  const [dateSrc,setDateSrc]=useState("");
  const [dateParts,setDateParts]=useState({month:true,dow:true,isweekend:false});
  const [dateNames,setDateNames]=useState({month:"",dow:"",isweekend:""});

  const numC=headers.filter(h=>info[h]?.isNum);
  // Date columns: string/date-typed columns with non-null values that parse as dates
  const dateC=headers.filter(h=>{
    if(info[h]?.isNum) return false;
    const samples=rows.slice(0,10).map(r=>r[h]).filter(v=>v!=null&&typeof v==="string");
    if(!samples.length) return false;
    return samples.filter(v=>!isNaN(new Date(v).getTime())).length/samples.length>0.5;
  });
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
      month:n.month||`${dateSrc}_month`,
      dow:n.dow||`${dateSrc}_dow`,
      isweekend:n.isweekend||`${dateSrc}_isweekend`,
    }));
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
    const names={};
    parts.forEach(p=>{names[p]=dateNames[p]?.trim()||`${dateSrc}_${p}`;});
    const created=parts.map(p=>names[p]).join(", ");
    onAdd({type:"date_extract",col:dateSrc,parts,names,desc:`Date extract '${dateSrc}' → [${created}]`});
    setDateSrc("");setDateParts({month:true,dow:true,isweekend:false});
    setDateNames({month:"",dow:"",isweekend:""});
  };
  const canExtract=dateSrc&&Object.values(dateParts).some(Boolean);

  const inpS={width:"100%",boxSizing:"border-box",padding:"0.42rem 0.65rem",background:C.surface2,border:`1px solid ${C.border2}`,borderRadius:3,color:C.text,fontFamily:mono,fontSize:11,outline:"none"};

  return(
    <div>
      <Tabs tabs={[["quick","⚡ Transforms"],["date","📅 Date"],["panel",`⊞ Panel${!isP?" (no idx)":""}`],["dummy","⊕ Dummies"],["did","DiD"]]} active={vt} set={setVt} accent={C.teal} sm/>

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
          <Lbl color={C.teal}>{qt==="ix"?"X₁":"Source column"}</Lbl>
          <div style={{display:"flex",flexWrap:"wrap",gap:4,marginBottom:"1rem"}}>
            {numC.map(h=><button key={h} onClick={()=>setQc(h)} style={{padding:"0.28rem 0.6rem",border:`1px solid ${qc===h?C.teal:C.border2}`,background:qc===h?`${C.teal}18`:"transparent",color:qc===h?C.teal:C.textDim,borderRadius:3,cursor:"pointer",fontSize:11,fontFamily:mono,transition:"all 0.12s"}}>{qc===h?"✓ ":""}{h}</button>)}
          </div>
          {qt==="ix"&&<><Lbl color={C.teal}>X₂</Lbl><div style={{display:"flex",flexWrap:"wrap",gap:4,marginBottom:"1rem"}}>{numC.filter(h=>h!==qc).map(h=><button key={h} onClick={()=>setXc2(h)} style={{padding:"0.28rem 0.6rem",border:`1px solid ${xc2===h?C.teal:C.border2}`,background:xc2===h?`${C.teal}18`:"transparent",color:xc2===h?C.teal:C.textDim,borderRadius:3,cursor:"pointer",fontSize:11,fontFamily:mono,transition:"all 0.12s"}}>{xc2===h?"✓ ":""}{h}</button>)}</div></>}
          {qc&&qt!=="winz"&&<div style={{padding:"0.48rem 0.75rem",background:C.surface,border:`1px solid ${C.border}`,borderRadius:3,marginBottom:"1rem",fontSize:11,color:C.textDim,fontFamily:mono}}>
            {qt==="log"&&<><span style={{color:C.teal}}>{nm||"?"}</span> = ln(<span style={{color:C.gold}}>{qc}</span>)</>}
            {qt==="sq"&&<><span style={{color:C.teal}}>{nm||"?"}</span> = <span style={{color:C.gold}}>{qc}</span>²</>}
            {qt==="std"&&<><span style={{color:C.teal}}>{nm||"?"}</span> = (<span style={{color:C.gold}}>{qc}</span>−μ)/σ</>}
            {qt==="ix"&&xc2&&<><span style={{color:C.teal}}>{nm||"?"}</span> = <span style={{color:C.gold}}>{qc}</span>×<span style={{color:C.gold}}>{xc2}</span></>}
          </div>}
          {qc&&qt==="winz"&&<div style={{padding:"0.48rem 0.75rem",background:C.surface,border:`1px solid ${C.border}`,borderRadius:3,marginBottom:"1rem",fontSize:11,color:C.textDim,fontFamily:mono}}>
            Clamp <span style={{color:C.gold}}>{qc}</span> at [p1, p99] → <span style={{color:C.orange}}>{winzMode==="inplace"?qc:(nm.trim()||`winsor_${qc}`)}</span>
            {info[qc]?.min!=null&&<span style={{color:C.textMuted}}> · current range [{info[qc].min.toFixed(2)}, {info[qc].max.toFixed(2)}]</span>}
          </div>}
          <Btn onClick={doQ} color={C.teal} v="solid" dis={!canAddQuick} ch={qt==="winz"?`Winsorize ${winzMode==="inplace"?"in-place":"→ new col"}`:"Add variable"}/>
        </div>
      )}

      {/* ── Date Extraction ── */}
      {vt==="date"&&(
        <div>
          <div style={{padding:"0.65rem 1rem",background:C.surface,border:`1px solid ${C.border}`,borderLeft:`3px solid ${C.violet}`,borderRadius:4,marginBottom:"1.2rem",fontSize:11,color:C.textDim,lineHeight:1.6}}>
            Extract calendar features from date columns (format: YYYY-MM-DD or MM/DD/YYYY). Each selected part becomes a new numeric column.
          </div>
          <Lbl color={C.violet}>Date source column</Lbl>
          {dateC.length===0?(
            <div style={{fontSize:11,color:C.orange,fontFamily:mono,marginBottom:"1.2rem",padding:"0.65rem 1rem",background:C.surface,border:`1px solid ${C.border}`,borderLeft:`3px solid ${C.orange}`,borderRadius:4}}>
              No date columns detected. Date columns must contain strings parseable as dates (e.g. "2021-06-15").
            </div>
          ):(
            <div style={{display:"flex",flexWrap:"wrap",gap:4,marginBottom:"1.4rem"}}>
              {dateC.map(h=><button key={h} onClick={()=>setDateSrc(h)} style={{padding:"0.28rem 0.6rem",border:`1px solid ${dateSrc===h?C.violet:C.border2}`,background:dateSrc===h?`${C.violet}18`:"transparent",color:dateSrc===h?C.violet:C.textDim,borderRadius:3,cursor:"pointer",fontSize:11,fontFamily:mono,transition:"all 0.12s"}}>{dateSrc===h?"✓ ":""}{h}</button>)}
            </div>
          )}
          <Lbl color={C.violet}>Parts to extract</Lbl>
          <div style={{display:"flex",flexDirection:"column",gap:8,marginBottom:"1.2rem"}}>
            {[
              ["month","Month","Integer 1–12","month"],
              ["dow","Day of Week","Integer 0 (Sun) – 6 (Sat)","dow"],
              ["isweekend","Is Weekend","Binary 0/1","isweekend"],
            ].map(([key,label,hint,nameKey])=>(
              <div key={key} style={{display:"grid",gridTemplateColumns:"auto 1fr 1fr",gap:8,alignItems:"center",padding:"0.5rem 0.75rem",background:dateParts[key]?`${C.violet}08`:C.surface,border:`1px solid ${dateParts[key]?C.violet+"40":C.border}`,borderRadius:4}}>
                <button onClick={()=>setDateParts(p=>({...p,[key]:!p[key]}))}
                  style={{width:18,height:18,borderRadius:3,border:`1px solid ${dateParts[key]?C.violet:C.border2}`,background:dateParts[key]?C.violet:"transparent",cursor:"pointer",display:"flex",alignItems:"center",justifyContent:"center",color:C.bg,fontSize:10,flexShrink:0}}>
                  {dateParts[key]?"✓":""}
                </button>
                <div>
                  <div style={{fontSize:11,color:dateParts[key]?C.text:C.textDim,fontFamily:mono}}>{label}</div>
                  <div style={{fontSize:9,color:C.textMuted,fontFamily:mono}}>{hint}</div>
                </div>
                {dateParts[key]&&dateSrc&&(
                  <input value={dateNames[nameKey]} onChange={e=>setDateNames(n=>({...n,[nameKey]:e.target.value}))}
                    placeholder={`${dateSrc}_${nameKey}`}
                    style={{padding:"0.3rem 0.5rem",background:C.surface2,border:`1px solid ${C.border2}`,borderRadius:3,color:C.text,fontFamily:mono,fontSize:10,outline:"none"}}/>
                )}
              </div>
            ))}
          </div>
          {dateSrc&&canExtract&&(
            <div style={{padding:"0.48rem 0.75rem",background:C.surface,border:`1px solid ${C.border}`,borderRadius:3,marginBottom:"1rem",fontSize:11,color:C.textDim,fontFamily:mono}}>
              Creates:{" "}
              {Object.entries(dateParts).filter(([,on])=>on).map(([k])=>(
                <span key={k} style={{color:C.violet,marginRight:8}}>{dateNames[k]?.trim()||`${dateSrc}_${k}`}</span>
              ))}
              from <span style={{color:C.gold}}>{dateSrc}</span>
            </div>
          )}
          <Btn onClick={doDateExtract} color={C.violet} v="solid" dis={!canExtract} ch="Extract date features →"/>
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
      {vt==="dummy"&&(
        <div>
          <Lbl>Categorical → dummy set</Lbl>
          <div style={{display:"flex",flexWrap:"wrap",gap:4,marginBottom:"1.2rem"}}>{headers.filter(h=>info[h]?.isCat||info[h]?.uCount<=10).map(h=><button key={h} onClick={()=>{setDc(h);setDp(h);}} style={{padding:"0.28rem 0.6rem",border:`1px solid ${dc===h?C.green:C.border2}`,background:dc===h?`${C.green}18`:"transparent",color:dc===h?C.green:C.textDim,borderRadius:3,cursor:"pointer",fontSize:11,fontFamily:mono,transition:"all 0.12s"}}>{dc===h?"✓ ":""}{h}</button>)}</div>
          {dc&&<><Lbl>Prefix</Lbl><div style={{display:"flex",gap:8,marginBottom:"0.8rem"}}><input value={dp} onChange={e=>setDp(e.target.value)} placeholder={dc} style={{flex:1,padding:"0.45rem 0.65rem",background:C.surface2,border:`1px solid ${C.border2}`,borderRadius:3,color:C.text,fontFamily:mono,fontSize:11,outline:"none"}}/></div>
          <div style={{fontSize:11,color:C.textMuted,fontFamily:mono,marginBottom:"1rem"}}>Creates: {(info[dc]?.uVals||[]).slice(0,4).map(v=>`${dp||dc}_${v}`).join(", ")}{info[dc]?.uCount>4?"…":""}</div>
          <Btn onClick={doDummy} color={C.green} v="solid" ch="Create dummies"/></>}
        </div>
      )}

      {/* ── DiD ── */}
      {vt==="did"&&(
        <div>
          <div style={{padding:"0.65rem 1rem",background:C.surface,border:`1px solid ${C.border}`,borderLeft:`3px solid ${C.gold}`,borderRadius:4,marginBottom:"1.2rem",fontSize:11,color:C.textDim,lineHeight:1.6}}>
            Generates <span style={{color:C.gold}}>Treatment × Post</span> interaction term for DiD identification. Both columns must be binary (0/1).
          </div>
          <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:"1rem",marginBottom:"1.2rem"}}>
            {[["Treatment (D)",dtc,setDtc,C.gold],["Post indicator (P)",dpc,setDpc,C.blue]].map(([label,val,setter,color])=>(
              <div key={label}><Lbl color={color}>{label}</Lbl>
                <div style={{display:"flex",flexWrap:"wrap",gap:4}}>{headers.map(h=><button key={h} onClick={()=>setter(h)} style={{padding:"0.28rem 0.6rem",border:`1px solid ${val===h?color:C.border2}`,background:val===h?`${color}18`:"transparent",color:val===h?color:C.textDim,borderRadius:3,cursor:"pointer",fontSize:11,fontFamily:mono,transition:"all 0.12s"}}>{val===h?"✓ ":""}{h}</button>)}</div>
              </div>
            ))}
          </div>
          {dtc&&dpc&&<div style={{padding:"0.48rem 0.75rem",background:C.surface,border:`1px solid ${C.border}`,borderRadius:3,marginBottom:"1rem",fontSize:11,color:C.textDim,fontFamily:mono}}>
            New: <span style={{color:C.gold}}>{nm.trim()||`${dtc}_x_${dpc}`}</span> = <span style={{color:C.gold}}>{dtc}</span> × <span style={{color:C.blue}}>{dpc}</span> — ATT identifier
          </div>}
          <Btn onClick={doDiD} color={C.gold} v="solid" dis={!dtc||!dpc} ch="Create DiD interaction"/>
        </div>
      )}
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

// ─── WRANGLING MODULE ROOT ────────────────────────────────────────────────────
export default function WranglingModule({rawData, filename, onComplete, pid}) {
  const [pipeline, setPipeline] = useState(()=>{try{return lsGet().find(p=>p.id===pid)?.pipeline||[];}catch{return[];}});
  const [panel, setPanel] = useState(()=>{try{return lsGet().find(p=>p.id===pid)?.panel||null;}catch{return null;}});
  const [dataDictionary, setDataDictionary] = useState(()=>{try{return lsGet().find(p=>p.id===pid)?.dataDictionary||null;}catch{return null;}});
  const [tab, setTab] = useState("clean");

  const {rows, headers} = useMemo(()=>{
    const init = rawData.rows.map(r=>{const c={};rawData.headers.forEach(h=>{c[h]=r[h]??null;});return c;});
    return runPipeline(init, rawData.headers, pipeline);
  }, [rawData, pipeline]);

  const info = useMemo(()=>buildInfo(headers, rows), [headers, rows]);

  useEffect(()=>{
    lsSave(pid, {filename, pipeline, panel, dataDictionary, rowCount:rawData.rows.length, colCount:rawData.headers.length, pipelineLength:pipeline.length});
  }, [pipeline, panel, dataDictionary]);

  const addStep = useCallback(s=>setPipeline(p=>[...p, {...s, id:Date.now()+Math.random()}]), []);
  const rmStep = useCallback(i=>setPipeline(p=>p.filter((_,j)=>j!==i)), []);
  const clear = useCallback(()=>setPipeline([]), []);

  const naCount = useMemo(()=>rows.filter(r=>headers.some(h=>{const v=r[h];return v===null||v===undefined;})).length, [rows, headers]);

  const proceed = () => {
    const final = rows.filter(r=>headers.every(h=>{const v=r[h];return v!==null&&v!==undefined;}));
    const ci = {};
    headers.forEach(h=>{const s=final.find(r=>r[h]!==undefined);ci[h]={isNumeric:typeof s?.[h]==="number"};});
    onComplete({
      headers,
      cleanRows: final,
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
            <button onClick={proceed} style={{padding:"0.28rem 0.65rem",borderRadius:3,cursor:"pointer",fontFamily:mono,fontSize:10,background:C.gold,color:C.bg,border:`1px solid ${C.gold}`,fontWeight:700}}>Proceed →</button>
          </div>
        </div>
        {/* Tabs */}
        <Tabs tabs={[["clean","⬡ Cleaning"],["structure","⊞ Panel Structure"],["features","⊕ Feature Engineering"],["dictionary","◈ Data Dictionary"]]} active={tab} set={setTab}/>
        {tab==="clean"&&<CleanTab rows={rows} headers={headers} info={info} rawData={rawData} onAdd={addStep}/>}
        {tab==="structure"&&<PanelTab rows={rows} headers={headers} panel={panel} setPanel={setPanel}/>}
        {tab==="features"&&<FeatureEngineeringTab rows={rows} headers={headers} panel={panel} info={info} onAdd={addStep}/>}
        {tab==="dictionary"&&<DataDictionaryTab headers={headers} rows={rows} dict={dataDictionary} setDict={setDataDictionary}/>}
      </div>
      <History pipeline={pipeline} onRm={rmStep} onClear={clear}/>
    </div>
  );
}
