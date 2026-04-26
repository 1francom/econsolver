// ─── ECON STUDIO · components/wrangling/utils.js ─────────────────────────────
// Pure computation helpers. Zero JSX. Safe to import from any file.
//
// Exports:
//   lsGet, lsSet, lsSave           — localStorage persistence
//   levenshtein, normStr           — string distance
//   fuzzyGroups, buildInitialMap   — categorical normalization
//   audit, aiAuditScan             — smart auditor engine
//   callAI                         — Anthropic API helper

// ─── LOCALSTORAGE ─────────────────────────────────────────────────────────────
const LS_KEY = "econ_wrangle_v2";
export function lsGet(){try{return JSON.parse(localStorage.getItem(LS_KEY)||"[]");}catch{return[];}}
export function lsSet(d){try{localStorage.setItem(LS_KEY,JSON.stringify(d));}catch{}}
export function lsSave(id,upd){
  const all=lsGet();const i=all.findIndex(p=>p.id===id);
  if(i>=0)all[i]={...all[i],...upd,ts:Date.now()};else all.unshift({id,...upd,ts:Date.now()});
  lsSet(all.slice(0,8));
}

// ─── FUZZY MATCHING ───────────────────────────────────────────────────────────
export function levenshtein(a,b,maxD=6){
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

export function normStr(s){return String(s||"").trim().toLowerCase().replace(/\s+/g," ");}

export function fuzzyGroups(vals, rowsForFreq){
  const freq={};
  if(rowsForFreq){rowsForFreq.forEach(v=>{if(v!=null){const s=String(v);freq[s]=(freq[s]||0)+1;}});}
  const norm=vals.map(normStr);

  // Guard: two strings that share a common alphabetic prefix but differ only in their
  // trailing numeric component are DISTINCT categories (e.g. "comuna 1" vs "comuna 2",
  // "region 10" vs "region 11"). Never group them regardless of Levenshtein distance.
  const trailingNum = s => { const m = s.match(/^(.*\D)\s*(\d+)\s*$/); return m ? [m[1].trim(), m[2]] : null; };
  const areNumericVariants = (a, b) => {
    const pa = trailingNum(a), pb = trailingNum(b);
    if (!pa || !pb) return false;
    // Same alphabetic prefix, different numbers → distinct categories
    return pa[0] === pb[0] && pa[1] !== pb[1];
  };

  const visited=new Array(vals.length).fill(false);
  const clusters=[];
  for(let i=0;i<vals.length;i++){
    if(visited[i]) continue;
    const group=[i];
    visited[i]=true;
    for(let j=i+1;j<vals.length;j++){
      if(visited[j]) continue;
      // Skip numeric variants — "comuna 1" and "comuna 2" are NOT the same
      if(areNumericVariants(norm[i], norm[j])) continue;
      const isSub=norm[i].includes(norm[j])||norm[j].includes(norm[i]);
      const d=isSub?0:levenshtein(norm[i],norm[j]);
      if(d===0||d<=Math.max(2,Math.floor(norm[i].length*.25))){
        group.push(j);visited[j]=true;
      }
    }
    if(group.length>1){
      const members=group.map(k=>vals[k]);
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

export function buildInitialMap(clusters){
  const map={};
  clusters.forEach(cl=>{cl.members.forEach(m=>{map[m]=cl.canonical;});});
  return map;
}

// ─── AUDIT ENGINE ─────────────────────────────────────────────────────────────
export function audit(headers,rows,info){
  const out=[];
  headers.forEach(h=>{
    const c=info[h]; if(!c) return;
    if(c.uCount<=1&&c.naCount<c.total)
      out.push({col:h,type:"const",sev:"high",title:`'${h}' is constant`,detail:"Zero variance. Drop before regression.",act:"drop"});
    if(c.naPct>.3)
      out.push({col:h,type:"na",sev:"high",title:`'${h}' — ${(c.naPct*100).toFixed(0)}% missing`,detail:"High missingness. Filter or investigate.",act:"filter_na"});
    else if(c.naPct>.05)
      out.push({col:h,type:"na",sev:"medium",title:`'${h}' — ${(c.naPct*100).toFixed(0)}% missing`,detail:"Consider listwise deletion.",act:"filter_na"});
    if(c.outliers>0&&c.isNum)
      out.push({col:h,type:"outlier",sev:c.outliers>3?"high":"medium",title:`'${h}' — ${c.outliers} outlier${c.outliers>1?"s":""}`,detail:`IQR-based. Range [${c.min?.toFixed(2)}, ${c.max?.toFixed(2)}]. Consider winsorizing.`,act:"winz"});
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

export async function aiAuditScan(sug,rows,info){
  const results=[];
  for(const s of sug.filter(s=>s.type==="variant"&&s.act==="ai_std").slice(0,2)){
    const sample=rows.slice(0,8).map(r=>r[s.col]);
    const r=await callAI(`Standardize all text variants to consistent canonical values.`,s.col,sample,"transform");
    if(r) results.push({col:s.col,...r});
  }
  return results;
}

// ─── AI HELPER ────────────────────────────────────────────────────────────────
// Delegates to callClaude (AIService.js) — benefits from prompt caching on
// SHARED_CONTEXT. Task-specific system prompts imported from prompts/index.js.
import { callClaude } from "../../services/ai/AIService.js";
import {
  WRANGLING_TRANSFORM_PROMPT,
  WRANGLING_QUERY_PROMPT,
} from "../../services/ai/prompts/index.js";

export async function callAI(instruction, col, sample, mode) {
  const isQ = mode === "query";
  const system = isQ ? WRANGLING_QUERY_PROMPT : WRANGLING_TRANSFORM_PROMPT;

  const user = isQ
    ? `Column: "${col}". Sample (8 vals): ${sample.map((v,i)=>`${i+1}.${JSON.stringify(v)}`).join(", ")}. Question: "${instruction}". Return JSON now.`
    : `Column: "${col}". Sample (5 vals): ${sample.slice(0,5).map((v,i)=>`${i+1}.${JSON.stringify(v)}`).join(", ")}. Instruction: "${instruction}". Return JSON now.`;

  try {
    const raw = await callClaude({ system, user, maxTokens: 1000 });
    return JSON.parse(raw.replace(/```json\s*/gi,"").replace(/```\s*/g,"").trim());
  } catch {
    return null;
  }
}
