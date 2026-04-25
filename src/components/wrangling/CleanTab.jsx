// ─── ECON STUDIO · components/wrangling/CleanTab.jsx ───────────────────────
// NormalizePanel, StandardizeDialog, Auditor, ColCard,
// FilterBuilder (ConditionRow, FilterPreview), FillNaSection, CleanTab.
import { useState, useEffect, useRef, useMemo } from "react";
import { C, mono, Lbl, Tabs, Btn, Badge, NA, Spin, Grid } from "./shared.jsx";
import { fuzzyGroups, buildInitialMap, audit, aiAuditScan, callAI } from "./utils.js";

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
function ColCard({h, info, sug, selected, onSel, onAct}){
  const c = info[h] || {};
  const [mo, setMo] = useState(false);

  // Collect issues for this column from audit results
  const issues = sug ? sug.filter(s => s.col === h) : [];
  const hasNA      = issues.some(s => s.type === "na");
  const hasOutlier = issues.some(s => s.type === "outlier");
  const hasVariant = issues.some(s => s.type === "variant");
  const isConst    = issues.some(s => s.type === "const");
  const hasIssue   = hasNA || hasOutlier || hasVariant || isConst;

  // Border color: red if high-sev issue, yellow if medium, teal if selected
  const highSev = issues.some(s => s.sev === "high");
  const borderCol = selected ? C.teal : hasIssue ? (highSev ? C.red : C.yellow) : C.border;

  return(
    <div onClick={()=>{onSel(h);setMo(false);}}
      style={{border:`1px solid ${borderCol}`,borderRadius:4,padding:"0.5rem 0.55rem",
        background:selected?`${C.teal}10`:hasIssue?`${highSev?C.red:C.yellow}06`:C.surface,
        cursor:"pointer",position:"relative",transition:"all 0.12s"}}>
      <div style={{display:"flex",alignItems:"flex-start",gap:4,marginBottom:3}}>
        <span style={{fontFamily:mono,fontSize:11,
          color:selected?C.teal:C.text,
          flex:1,overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}}>{h}</span>
        <button onClick={e=>{e.stopPropagation();setMo(m=>!m);}}
          style={{background:"transparent",border:`1px solid ${C.border2}`,
            borderRadius:2,color:C.textMuted,cursor:"pointer",fontSize:9,padding:"1px 4px",flexShrink:0}}>⋯</button>
      </div>
      <div style={{display:"flex",alignItems:"center",gap:4,flexWrap:"wrap"}}>
        <Badge ch={c.isNum?"num":"cat"} color={c.isNum?C.blue:C.purple}/>
        <NA pct={c.naPct||0}/>
        {isConst    && <Badge ch="const" color={C.red}/>}
        {hasNA      && <Badge ch={`${(c.naPct*100).toFixed(0)}% NA`} color={highSev?C.red:C.yellow}/>}
        {hasOutlier && <Badge ch={`${c.outliers}⚠`} color={C.orange}/>}
        {hasVariant && <Badge ch="variants" color={C.teal}/>}
      </div>
      {mo&&<div onClick={e=>e.stopPropagation()}
        style={{position:"absolute",top:"100%",right:0,zIndex:99,background:C.surface2,
          border:`1px solid ${C.border}`,borderRadius:4,boxShadow:"0 6px 24px #000b",
          minWidth:140,overflow:"hidden"}}>
        {[["rename","Rename"],["filter","Filter"],["drop","Drop"]].map(([a,l])=>(
          <button key={a} onClick={()=>{onAct(h,a);setMo(false);}}
            style={{width:"100%",padding:"0.45rem 0.8rem",background:"transparent",border:"none",
              color:a==="drop"?C.red:C.textDim,cursor:"pointer",fontFamily:mono,fontSize:11,textAlign:"left"}}>{l}</button>
        ))}
      </div>}
    </div>
  );
}

// ─── COLUMN ISSUE PANEL ───────────────────────────────────────────────────────
// Shown below the grid when a column with issues is selected.
// Read-only: describes the issue and suggests where to act. No action buttons.
function ColIssuePanel({ col, issues }) {
  if (!issues || !issues.length) return null;

  const TYPE_META = {
    na:      { icon:"⚠", color: null,    label: "Missing values" },
    outlier: { icon:"⚠", color: C.orange, label: "Outliers detected" },
    variant: { icon:"⬡", color: C.teal,   label: "Similar variants" },
    const:   { icon:"✕", color: C.red,    label: "Constant column" },
  };
  const SEV_COLOR = { high: C.red, medium: C.yellow };

  return (
    <div style={{marginBottom:"1rem",border:`1px solid ${C.border2}`,borderRadius:4,overflow:"hidden"}}>
      <div style={{padding:"0.4rem 0.75rem",background:C.surface2,borderBottom:`1px solid ${C.border}`,
        fontSize:9,color:C.textMuted,letterSpacing:"0.15em",textTransform:"uppercase",fontFamily:mono}}>
        ⚑ Issues — <span style={{color:C.text}}>{col}</span>
      </div>
      {issues.map((s, i) => {
        const meta = TYPE_META[s.type] || { icon:"·", color: C.textMuted, label: s.type };
        const sevColor = SEV_COLOR[s.sev] || C.textMuted;
        const color = meta.color || sevColor;

        // Recommendation text per issue type
        const recs = {
          na:      "Consider: Fill NA  (Cleaning tab → Fill missing values)",
          outlier: "Consider: Winsorize  (Cleaning tab → Winsorize)",
          variant: "Review variants below — use Normalize text categories if needed",
          const:   "Consider: Drop column  (use ⋯ menu above)",
        };

        return (
          <div key={i} style={{padding:"0.6rem 0.85rem",
            borderBottom: i < issues.length-1 ? `1px solid ${C.border}` : "none",
            borderLeft:`3px solid ${color}`,background:`${color}06`}}>
            <div style={{fontSize:11,color,fontFamily:mono,marginBottom:3,fontWeight:600}}>
              {meta.icon} {s.title}
            </div>
            <div style={{fontSize:11,color:C.textDim,lineHeight:1.6,marginBottom:4}}>{s.detail}</div>
            <div style={{fontSize:10,color:C.textMuted,fontFamily:mono,fontStyle:"italic"}}>
              → {recs[s.type] || ""}
            </div>
            {/* Variant clusters preview */}
            {s.type === "variant" && s.clusters && (
              <div style={{marginTop:6,display:"flex",flexWrap:"wrap",gap:4}}>
                {s.clusters.slice(0,5).map((cl,ci)=>(
                  <span key={ci} style={{fontSize:9,fontFamily:mono,color:C.textMuted,
                    padding:"2px 6px",border:`1px solid ${C.border2}`,borderRadius:2}}>
                    {cl.members.join(" · ")} → <span style={{color:C.gold}}>{cl.canonical}</span>
                  </span>
                ))}
                {s.clusters.length>5&&<span style={{fontSize:9,color:C.textMuted,fontFamily:mono}}>+{s.clusters.length-5} more</span>}
              </div>
            )}
          </div>
        );
      })}
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



// ─── WINSORIZE SECTION ────────────────────────────────────────────────────────
// Collapsible panel in CleanTab. Clamps extreme values to [p1, p99] bounds.
// Moved from Features — conceptually data cleaning, not feature engineering.
function WinsorizeSection({ headers, info, rows, onAdd }) {
  const [open,    setOpen]    = useState(false);
  const [col,     setCol]     = useState("");
  const [mode,    setMode]    = useState("inplace"); // "inplace" | "newcol"
  const [newName, setNewName] = useState("");

  const numCols = headers.filter(h => info[h]?.isNum);
  const colInfo = col ? info[col] : null;

  const wVals = col
    ? rows.map(r => r[col]).filter(v => typeof v === "number" && isFinite(v)).sort((a,b)=>a-b)
    : [];
  const wLo = wVals[Math.floor(wVals.length * 0.01)] ?? wVals[0];
  const wHi = wVals[Math.floor(wVals.length * 0.99)] ?? wVals[wVals.length - 1];
  const nClipped = wVals.filter(v => v < wLo || v > wHi).length;
  const targetCol = mode === "inplace" ? col : (newName.trim() || `winsor_${col}`);

  function apply() {
    if (!col) return;
    onAdd({ type:"winz", col, nn:targetCol, lo:wLo, hi:wHi,
      desc:`Winsorize '${col}' [p1,p99] → '${targetCol}'${mode==="inplace"?" (in-place)":""}` });
    setCol(""); setNewName("");
  }

  return (
    <div style={{ marginBottom:"1.2rem" }}>
      <button onClick={() => setOpen(o => !o)} style={{
        width:"100%", display:"flex", alignItems:"center", gap:8,
        padding:"0.5rem 0.75rem",
        background: open ? `${C.orange}08` : C.surface2,
        border:`1px solid ${open ? C.orange+"40" : C.border}`,
        borderRadius: open ? "4px 4px 0 0" : 4,
        color: open ? C.orange : C.textDim,
        cursor:"pointer", fontFamily:mono, fontSize:10,
        letterSpacing:"0.15em", textTransform:"uppercase", textAlign:"left",
        transition:"all 0.12s",
      }}>
        <span>{open ? "▾" : "▸"}</span>
        <span>Winsorize outliers</span>
        {!open && numCols.length > 0 && (
          <span style={{ marginLeft:"auto", fontSize:9, color:C.textMuted, fontFamily:mono }}>
            clip extreme values to [p1, p99]
          </span>
        )}
      </button>

      {open && (
        <div style={{ padding:"0.9rem 1rem",
          background:C.surface, border:`1px solid ${C.orange}30`,
          borderTop:"none", borderRadius:"0 0 4px 4px" }}>

          <Lbl color={C.orange}>Numeric column</Lbl>
          <div style={{ display:"flex", flexWrap:"wrap", gap:4, marginBottom:"1rem",
            maxHeight:100, overflowY:"auto" }}>
            {numCols.map(h => (
              <button key={h} onClick={() => { setCol(h); setNewName(""); }} style={{
                padding:"0.25rem 0.6rem",
                border:`1px solid ${col===h ? C.orange : C.border2}`,
                background: col===h ? `${C.orange}18` : "transparent",
                color: col===h ? C.orange : C.textDim,
                borderRadius:3, cursor:"pointer", fontSize:10, fontFamily:mono,
                transition:"all 0.1s",
              }}>
                {col===h?"✓ ":""}{h}
                {info[h]?.outliers > 0 && (
                  <span style={{fontSize:8,color:C.orange,marginLeft:3}}>⚠{info[h].outliers}</span>
                )}
              </button>
            ))}
          </div>

          {col && (
            <>
              <div style={{ display:"flex", gap:4, marginBottom:8 }}>
                {[["inplace","Overwrite column"],["newcol","New column"]].map(([m,l])=>(
                  <button key={m} onClick={() => setMode(m)} style={{
                    padding:"0.25rem 0.7rem",
                    border:`1px solid ${mode===m ? C.orange : C.border2}`,
                    background: mode===m ? `${C.orange}18` : "transparent",
                    color: mode===m ? C.orange : C.textDim,
                    borderRadius:3, cursor:"pointer", fontSize:10, fontFamily:mono,
                  }}>{mode===m?"✓ ":""}{l}</button>
                ))}
              </div>
              {mode === "newcol" && (
                <input value={newName} onChange={e => setNewName(e.target.value)}
                  placeholder={`winsor_${col}`}
                  style={{ width:"100%", boxSizing:"border-box",
                    padding:"0.38rem 0.6rem", background:C.surface2,
                    border:`1px solid ${C.border2}`, borderRadius:3,
                    color:C.text, fontFamily:mono, fontSize:11, outline:"none",
                    marginBottom:8 }}/>
              )}
              <div style={{ padding:"0.5rem 0.75rem", background:C.surface2,
                border:`1px solid ${C.border}`, borderRadius:3,
                marginBottom:"0.8rem", fontSize:11, fontFamily:mono, color:C.textDim,
                lineHeight:1.8 }}>
                <div>Clip <span style={{color:C.gold}}>{col}</span> to [p1={wLo?.toFixed(3)}, p99={wHi?.toFixed(3)}]</div>
                <div style={{color:C.textMuted}}>
                  {nClipped} value{nClipped!==1?"s":""} will be clamped
                  {" · "}range [{wVals[0]?.toFixed(2)}, {wVals[wVals.length-1]?.toFixed(2)}]
                </div>
                <div style={{color:C.textMuted}}>→ output: <span style={{color:C.orange}}>{targetCol}</span></div>
              </div>
              <Btn onClick={apply} color={C.orange} v="solid"
                dis={!col} ch={mode==="inplace"?"Winsorize in-place →":"Winsorize → new col →"}/>
            </>
          )}
        </div>
      )}
    </div>
  );
}

// ─── FILL MISSING SECTION ─────────────────────────────────────────────────────
// Collapsible panel in CleanTab for all fill strategies including grouped imputation.
function FillNaSection({ headers, info, rows, onAdd }) {
  const [open,    setOpen]    = useState(false);
  const [col,     setCol]     = useState("");
  const [strat,   setStrat]   = useState("zero");
  const [constVal,setConstVal]= useState("0");
  const [groupCol,setGroupCol]= useState("");

  const colInfo  = col ? info[col] : null;
  const naCount  = col ? rows.filter(r => r[col] === null || r[col] === undefined).length : 0;
  const numCols  = headers.filter(h => info[h]?.isNum);
  const catCols  = headers.filter(h => !info[h]?.isNum && info[h]?.uCount > 0);
  const needsGroup = strat === "group_mean" || strat === "group_median";

  const STRATS = [
    ["zero",         "Fill with 0",          "constant",      "Numeric: replace null → 0"],
    ["constant",     "Fill with value",       "constant",      "Any column: set a custom constant"],
    ["mean",         "Global mean",           "mean",          "Numeric: replace null → column mean"],
    ["median",       "Global median",         "median",        "Numeric: replace null → column median"],
    ["mode",         "Mode",                  "mode",          "Any: replace null → most frequent value"],
    ["group_mean",   "Group mean",            "fill_na_grouped","Numeric: replace null → mean within group"],
    ["group_median", "Group median",          "fill_na_grouped","Numeric: replace null → median within group"],
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
    } else if (strat === "group_mean" || strat === "group_median") {
      if (!groupCol) return;
      const s = strat === "group_mean" ? "mean" : "median";
      onAdd({ type:"fill_na_grouped", col, groupCol, strategy:s,
        desc:`fill_na_grouped '${col}' ← group_${s}(${groupCol})` });
    } else {
      onAdd({ type:"fill_na", col, strategy:strat,
        desc:`fill_na '${col}' ← ${strat}` });
    }
    setCol(""); setStrat("zero"); setGroupCol("");
  }

  const canApply = col && naCount > 0 &&
    (!needsGroup || groupCol) &&
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
                  <Lbl color={C.yellow}>Group by column</Lbl>
                  <div style={{ display:"flex", flexWrap:"wrap", gap:4 }}>
                    {catCols.filter(h => h !== col).map(h => (
                      <button key={h} onClick={() => setGroupCol(h)} style={{
                        padding:"0.25rem 0.6rem",
                        border:`1px solid ${groupCol===h ? C.teal : C.border2}`,
                        background: groupCol===h ? `${C.teal}18` : "transparent",
                        color: groupCol===h ? C.teal : C.textDim,
                        borderRadius:3, cursor:"pointer", fontSize:10, fontFamily:mono,
                      }}>
                        {groupCol===h?"✓ ":""}{h}
                      </button>
                    ))}
                  </div>
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
                {needsGroup&&groupCol&&<> ← <span style={{color:C.teal}}>group_{strat==="group_mean"?"mean":"median"}({groupCol})</span></>}
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
      <div style={{display:"grid",gridTemplateColumns:"repeat(auto-fill,minmax(130px,1fr))",gap:6,marginBottom:"0.75rem"}}>
        {headers.map(h=><ColCard key={h} h={h} info={info} sug={sug} selected={sel===h}
          onSel={h=>{setSel(h);setAct(null);setARes(null);setASt("idle");}}
          onAct={(h,a)=>{setSel(h);setAct(a);}}/>)}
      </div>
      {/* Issue panel — shown when a column with issues is selected, before the action panel */}
      {sel && !act && sug.some(s=>s.col===sel) && (
        <ColIssuePanel col={sel} issues={sug.filter(s=>s.col===sel)}/>
      )}
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
      <WinsorizeSection headers={headers} rows={rows} info={info} onAdd={onAdd}/>
      <FillNaSection headers={headers} rows={rows} info={info} onAdd={onAdd}/>

      <Lbl>Preview — pipeline output</Lbl>
      <Grid headers={headers} rows={rows} hi={sel} max={8}/>
    </div>
  );
}


export default CleanTab;
