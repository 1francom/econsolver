// ─── ECON STUDIO · App.jsx ────────────────────────────────────────────────────
// Root orchestrator. Manages global state and screen routing.
// All heavy logic lives in the module files — this file should stay thin.
import { useState, useRef, useEffect } from "react";
import DataStudio from "./DataStudio.jsx";
import ExplorerModule from "./ExplorerModule.jsx";
import ModelingTab from './components/ModelingTab.jsx';
import AIContextSidebar from './components/AIContextSidebar.jsx';
import WorkspaceBar from './components/workspace/WorkspaceBar.jsx';
import { SessionStateProvider, useSessionDispatch, registerDataset } from './services/session/sessionState.jsx';
import { listPipelines, deletePipeline, clearAllPipelines, loadRawData } from "./services/persistence/indexedDB.js";

// ─── THEME ────────────────────────────────────────────────────────────────────
const C = {
  bg:"#080808", surface:"#0f0f0f", surface2:"#131313",
  border:"#1c1c1c", border2:"#252525",
  gold:"#c8a96e", goldDim:"#7a6040", goldFaint:"#1a1408",
  text:"#ddd8cc", textDim:"#888", textMuted:"#444",
  green:"#7ab896", red:"#c47070", yellow:"#c8b46e",
  blue:"#6e9ec8", purple:"#a87ec8", teal:"#6ec8b4", orange:"#c88e6e",
  violet:"#9e7ec8",
};
const mono = "'IBM Plex Mono','JetBrains Mono',Consolas,monospace";
const LS_KEY = "econ_wrangle_v2";

// ─── DEMO CSV ─────────────────────────────────────────────────────────────────
const DEMO_CSV = `wage,educ,exper,union,country,id,year
14.2,12,5,0,Argentina,1,2000
18.5,16,8,1,arg,2,2000
,14,3,0,Argentina,3,2000
22.1,18,12,1,ARGENTINA,4,2000
11.3,10,2,0,Argentina,5,2000
999,14,7,0,Germany,6,2000
25.0,20,15,1,Germany,7,2000
13.5,12,4,0,Germany,8,2000
19.2,16,9,1,Germany,9,2000
,13,6,0,Germany,10,2000
14.8,12,6,0,Argentina,1,2004
19.8,16,9,1,arg,2,2004
15.1,14,4,0,Argentina,3,2004
23.5,18,13,1,ARGENTINA,4,2004
12.0,10,3,0,Argentina,5,2004
17.4,14,8,0,Germany,6,2004
26.3,20,16,1,Germany,7,2004
14.1,12,5,0,Germany,8,2004
20.5,16,10,1,Germany,9,2004
16.2,13,7,0,Germany,10,2004
15.1,12,7,0,Argentina,1,2008
21.3,16,10,1,arg,2,2008
16.4,14,5,0,Argentina,3,2008
25.0,18,14,1,ARGENTINA,4,2008
12.8,10,4,0,Argentina,5,2008
18.1,14,9,0,Germany,6,2008
27.9,20,17,1,Germany,7,2008
14.9,12,6,0,Germany,8,2008
22.1,16,11,1,Germany,9,2008
17.6,13,8,0,Germany,10,2008`;

// ─── PARSING UTILS ────────────────────────────────────────────────────────────
const NA_PAT = /^(na|n\/a|nan|null|none|missing|#n\/a|\.|\s*)$/i;
const NUM_PAT = /^-?\d*\.?\d+([eE][+-]?\d+)?$/;
const DATE_PAT = /^\d{4}[-/]\d{1,2}[-/]\d{1,2}$|^\d{1,2}[-/]\d{1,2}[-/]\d{4}$/;

function parseCSV(text) {
  const lines = text.trim().split(/\r?\n/);
  const sep = lines[0].includes(";") && !lines[0].includes(",") ? ";" : ",";
  const headers = lines[0].split(sep).map(h=>h.trim().replace(/^"|"$/g,""));
  const rows = lines.slice(1).map((line,li)=>{
    const vals = line.split(sep).map(v=>v.trim().replace(/^"|"$/g,""));
    const obj = {}; headers.forEach((h,i)=>{obj[h]=vals[i]??"";}); obj.__ri=li+2; return obj;
  });
  return {headers, rows};
}
function detectType(vals) {
  let n=0,na=0,tx=0,dt=0; const u=new Set();
  vals.forEach(v=>{
    const s=String(v??'').trim();
    if(!v&&v!==0||NA_PAT.test(s)){na++;return;}
    u.add(s);
    if(DATE_PAT.test(s)){dt++;return;}
    if(NUM_PAT.test(s)){n++;return;}
    tx++;
  });
  const tot=(vals.length-na)||1;
  if(dt/tot>.5) return "date";
  if(n/tot>.6) return "numeric";
  if(u.size<=2&&n>0) return "binary";
  return tx>0?(u.size<=30?"categorical":"string"):"numeric";
}
function coerce(raw, type) {
  if(raw===null||raw===undefined) return null;
  const s=String(raw).trim();
  if(NA_PAT.test(s)) return null;
  if(type==="numeric"||type==="binary"){const n=parseFloat(s);return isNaN(n)?null:n;}
  return s||null;
}

// ─── LOCALSTORAGE ─────────────────────────────────────────────────────────────
function lsGet(){try{return JSON.parse(localStorage.getItem(LS_KEY)||"[]");}catch{return[];}}
function lsSet(d){try{localStorage.setItem(LS_KEY,JSON.stringify(d));}catch{}}

// ─── SHARED ATOMS ─────────────────────────────────────────────────────────────
function Btn({onClick,ch,color=C.gold,v="out",dis=false,sm=false}){
  const b={padding:sm?"0.28rem 0.65rem":"0.48rem 0.95rem",borderRadius:3,cursor:dis?"not-allowed":"pointer",fontFamily:mono,fontSize:sm?10:11,transition:"all 0.13s",opacity:dis?0.4:1};
  if(v==="solid")return<button onClick={onClick} disabled={dis} style={{...b,background:color,color:C.bg,border:`1px solid ${color}`,fontWeight:700}}>{ch}</button>;
  if(v==="ghost")return<button onClick={onClick} disabled={dis} style={{...b,background:"transparent",border:"none",color:dis?C.textMuted:color}}>{ch}</button>;
  return<button onClick={onClick} disabled={dis} style={{...b,background:"transparent",border:`1px solid ${C.border2}`,color:dis?C.textMuted:C.textDim}}>{ch}</button>;
}
function Badge({ch,color=C.textMuted}){return<span style={{fontSize:9,padding:"2px 6px",border:`1px solid ${color}`,color,borderRadius:2,letterSpacing:"0.1em",fontFamily:mono,whiteSpace:"nowrap"}}>{ch}</span>;}
function Spin(){return<div style={{width:14,height:14,border:`2px solid ${C.border2}`,borderTopColor:C.gold,borderRadius:"50%",animation:"spin 0.7s linear infinite",flexShrink:0}}/>;}

// ─── DATA GRID (shared preview) ───────────────────────────────────────────────
function Grid({headers,rows,hi,max=20,types,onType}){
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
                  <span>{h}</span>
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

// ─── UPLOADER ────────────────────────────────────────────────────────────────
function Uploader({onReady}){
  const [drag,setDrag]=useState(false),[loading,setLoading]=useState(false),[err,setErr]=useState(""),[pf,setPf]=useState(null);
  const ref=useRef();
  async function handleFile(file){
    if(!file)return;
    setLoading(true);setErr("");
    try{
      const name=file.name.toLowerCase();
      let text="";
      if(name.endsWith(".xlsx")||name.endsWith(".xls")){
        const ab=await file.arrayBuffer();
        const{utils,read}=await import("https://cdn.sheetjs.com/xlsx-0.20.3/package/xlsx.mjs");
        const wb=read(ab,{type:"array"});
        text=utils.sheet_to_csv(wb.Sheets[wb.SheetNames[0]]);
      } else {
        text=await file.text();
      }
      process(text,file.name);
    }catch(e){setErr("Parse error: "+e.message);}
    setLoading(false);
  }
  function process(text,fname){
    try{
      const{headers,rows}=parseCSV(text);
      if(!headers.length)throw new Error("No headers found");
      const types={};
      headers.forEach(h=>{types[h]=detectType(rows.slice(0,100).map(r=>r[h]));});
      const coerced=rows.map(r=>{const o={__ri:r.__ri};headers.forEach(h=>{o[h]=coerce(r[h],types[h]);});return o;});
      setPf({headers,rows:coerced,dt:types,fname});
    }catch(e){setErr("Error: "+e.message);}
  }
  const [ov,setOv]=useState({});
  // Reset overrides when new file loaded
  if(pf&&Object.keys(ov).length===0&&Object.keys(pf.dt).length>0)setOv({...pf.dt});
  function confirm(){
    const recoerced=pf.rows.map(r=>{const o={__ri:r.__ri};pf.headers.forEach(h=>{const raw=r[h]===null?null:String(r[h]??'');o[h]=coerce(raw,ov[h]||pf.dt[h]);});return o;});
    onReady({headers:pf.headers,rows:recoerced},ov,pf.fname);
  }
  if(pf)return(
    <div style={{maxWidth:900,margin:"0 auto",padding:"2rem",fontFamily:mono}}>
      <div style={{fontSize:9,color:C.teal,letterSpacing:"0.26em",textTransform:"uppercase",marginBottom:5}}>Preview — {pf.fname}</div>
      <div style={{fontSize:11,color:C.textDim,marginBottom:"1.2rem"}}>{pf.rows.length} rows · {pf.headers.length} cols · Click type badges to override</div>
      <Grid headers={pf.headers} rows={pf.rows} max={10} types={{...pf.dt,...ov}} onType={(h,t)=>setOv(p=>({...p,[h]:t}))}/>
      <div style={{marginTop:"1.5rem",display:"flex",gap:10}}>
        <Btn onClick={confirm} color={C.gold} v="solid" ch="Confirm & Enter Data Studio →"/>
        <Btn onClick={()=>setPf(null)} ch="Cancel"/>
      </div>
    </div>
  );
  return(
    <div style={{maxWidth:560,margin:"0 auto",padding:"3rem 2rem",display:"flex",flexDirection:"column",alignItems:"center",gap:"1.5rem"}}>
      <div style={{textAlign:"center"}}>
        <div style={{fontSize:9,color:C.teal,letterSpacing:"0.26em",textTransform:"uppercase",marginBottom:5,fontFamily:mono}}>Data Ingestion</div>
        <div style={{fontSize:22,color:C.text,letterSpacing:"-0.02em"}}>Load your dataset</div>
      </div>
      <div onDragOver={e=>{e.preventDefault();setDrag(true);}} onDragLeave={()=>setDrag(false)}
        onDrop={e=>{e.preventDefault();setDrag(false);handleFile(e.dataTransfer.files[0]);}}
        onClick={()=>ref.current?.click()}
        style={{width:"100%",border:`2px dashed ${drag?C.gold:C.border2}`,borderRadius:6,padding:"2.5rem 1.5rem",textAlign:"center",cursor:"pointer",background:drag?C.goldFaint:C.surface,transition:"all 0.15s"}}>
        <input ref={ref} type="file" accept=".csv,.tsv,.txt,.xlsx,.xls,.dta" onChange={e=>handleFile(e.target.files[0])} style={{display:"none"}}/>
        <div style={{fontSize:26,marginBottom:8}}>⬆</div>
        <div style={{fontSize:13,color:C.text,marginBottom:4}}>Drop file or click to browse</div>
        <div style={{fontSize:11,color:C.textMuted,fontFamily:mono}}>CSV · TSV · XLSX · Stata .dta</div>
      </div>
      {loading&&<div style={{display:"flex",alignItems:"center",gap:10,color:C.textDim,fontSize:12}}><Spin/> Parsing…</div>}
      {err&&<div style={{color:C.red,fontSize:11,fontFamily:mono,padding:"0.65rem 1rem",border:`1px solid ${C.red}40`,borderRadius:4,width:"100%"}}>{err}</div>}
      <div style={{display:"flex",gap:8,alignItems:"center"}}>
        <div style={{height:1,width:50,background:C.border}}/><span style={{fontSize:10,color:C.textMuted,fontFamily:mono}}>or</span><div style={{height:1,width:50,background:C.border}}/>
      </div>
      <Btn onClick={()=>process(DEMO_CSV,"wages_panel_demo.csv")} color={C.teal} v="solid" ch="Load wages panel demo"/>
    </div>
  );
}

// ─── WORKSPACE HELPERS ────────────────────────────────────────────────────────
// Shown in Explore / Model / Report tabs when no pipeline output exists yet.
function NeedsOutput({ onGoToClean }) {
  return (
    <div style={{display:"flex",flexDirection:"column",alignItems:"center",justifyContent:"center",height:"100%",gap:12,fontFamily:mono}}>
      <div style={{fontSize:28,color:C.border2}}>⌾</div>
      <div style={{fontSize:12,color:C.textDim}}>Apply your pipeline first.</div>
      <div style={{fontSize:10,color:C.textMuted,marginBottom:4}}>Go to Clean → run your steps → click "→ Analyze"</div>
      <Btn onClick={onGoToClean} v="solid" color={C.teal} ch="← Go to Clean"/>
    </div>
  );
}

// Data tab — shows loaded datasets, accepted file formats, and load entry points.
// Full DataTab.jsx (with World Bank / OECD / drag-drop) comes in phase 9.5.
function DataTab({ filename, rawData }) {
  const formats = ["CSV","TSV","XLSX","XLS","DTA","RDS","DBF","SHP"];
  return (
    <div style={{padding:"2rem 2.4rem",fontFamily:mono,maxWidth:720,color:C.text}}>
      <div style={{fontSize:9,color:C.teal,letterSpacing:"0.26em",textTransform:"uppercase",marginBottom:4}}>Data</div>
      <div style={{fontSize:18,color:C.text,marginBottom:"1.6rem",letterSpacing:"-0.01em"}}>Dataset Overview</div>

      {/* Active dataset card */}
      {rawData && (
        <div style={{border:`1px solid ${C.border2}`,borderRadius:4,overflow:"hidden",marginBottom:"1.8rem"}}>
          <div style={{background:C.surface2,padding:"0.6rem 0.9rem",display:"flex",alignItems:"center",gap:8,borderBottom:`1px solid ${C.border}`}}>
            <span style={{fontSize:9,color:C.teal}}>●</span>
            <span style={{fontSize:12,color:C.text}}>{filename}</span>
            <span style={{marginLeft:"auto",fontSize:9,color:C.textMuted,padding:"1px 6px",border:`1px solid ${C.border2}`,borderRadius:2}}>primary</span>
          </div>
          <div style={{display:"grid",gridTemplateColumns:"repeat(3,1fr)",gap:1,background:C.border}}>
            {[
              {l:"Rows",    v: rawData.rows.length.toLocaleString(), c: C.text},
              {l:"Columns", v: rawData.headers.length,               c: C.text},
              {l:"Source",  v: "loaded",                             c: C.textMuted},
            ].map(s=>(
              <div key={s.l} style={{background:C.surface,padding:"0.55rem 0.85rem"}}>
                <div style={{fontSize:8,color:C.textMuted,letterSpacing:"0.12em",textTransform:"uppercase",marginBottom:2}}>{s.l}</div>
                <div style={{fontSize:13,color:s.c}}>{s.v}</div>
              </div>
            ))}
          </div>
          {rawData.headers.length > 0 && (
            <div style={{padding:"0.5rem 0.9rem",background:C.surface,borderTop:`1px solid ${C.border}`}}>
              <div style={{fontSize:9,color:C.textMuted,marginBottom:4,letterSpacing:"0.1em",textTransform:"uppercase"}}>Columns</div>
              <div style={{display:"flex",flexWrap:"wrap",gap:4}}>
                {rawData.headers.map(h=>(
                  <span key={h} style={{fontSize:9,padding:"2px 7px",border:`1px solid ${C.border2}`,borderRadius:2,color:C.textDim}}>{h}</span>
                ))}
              </div>
            </div>
          )}
        </div>
      )}

      {/* Accepted file formats */}
      <div style={{marginBottom:"1.4rem"}}>
        <div style={{fontSize:9,color:C.textMuted,letterSpacing:"0.2em",textTransform:"uppercase",marginBottom:8}}>Accepted formats</div>
        <div style={{display:"flex",flexWrap:"wrap",gap:6}}>
          {formats.map(f=>(
            <span key={f} style={{fontSize:10,padding:"3px 9px",border:`1px solid ${C.border2}`,borderRadius:2,color:C.textDim,fontFamily:mono}}>{f}</span>
          ))}
        </div>
        <div style={{fontSize:10,color:C.textMuted,marginTop:8,lineHeight:1.7}}>
          Drag & drop or click to upload · Auto-delimiter detection (CSV / TSV / pipe)<br/>
          Additional datasets loaded here are available for JOIN / APPEND in the Clean tab.
        </div>
      </div>

      {/* Load buttons — full implementation in phase 9.5 */}
      <div style={{fontSize:9,color:C.textMuted,letterSpacing:"0.16em",textTransform:"uppercase",marginBottom:8}}>Load data</div>
      <div style={{display:"flex",flexDirection:"column",gap:6,maxWidth:280}}>
        {[
          {label:"+ Load dataset",   color:C.gold,  note:"file upload, coming in phase 9.5"},
          {label:"↓ World Bank data",color:C.teal,  note:"API fetcher"},
          {label:"↓ OECD data",      color:C.blue,  note:"API fetcher"},
        ].map(({label,color,note})=>(
          <div key={label} style={{display:"flex",alignItems:"center",gap:10}}>
            <button disabled style={{
              flex:1,padding:"0.42rem 0.75rem",background:"transparent",
              border:`1px solid ${C.border2}`,borderRadius:3,
              color:C.textMuted,cursor:"not-allowed",fontFamily:mono,fontSize:10,
              textAlign:"left",opacity:0.5,
            }}>{label}</button>
            <span style={{fontSize:9,color:C.border2}}>{note}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

// Placeholder for tabs not yet implemented (Simulate, Calculate, Report).
function ComingSoon({ tab }) {
  const labels = { simulate:"Simulate", calculate:"Calculate", report:"Report" };
  const descs  = {
    simulate:  "Build data generating processes, run Monte Carlo simulations, power analysis.",
    calculate: "Define scalars, vectors, and expressions. Create datasets from scratch.",
    report:    "Publication-ready output: LaTeX tables, AI narratives, and unified script export.",
  };
  return (
    <div style={{display:"flex",flexDirection:"column",alignItems:"center",justifyContent:"center",height:"100%",gap:10,fontFamily:mono}}>
      <div style={{fontSize:9,color:C.teal,letterSpacing:"0.26em",textTransform:"uppercase"}}>{labels[tab] || tab}</div>
      <div style={{fontSize:11,color:C.textDim,maxWidth:360,textAlign:"center",lineHeight:1.7}}>{descs[tab] || "Coming soon."}</div>
      <div style={{fontSize:9,color:C.textMuted,marginTop:4}}>Phase 9 — in development</div>
    </div>
  );
}

// Thin wrapper that registers the primary dataset in sessionState when workspace mounts.
function WorkspaceRegistrar({ filename, rawData }) {
  const dispatch = useSessionDispatch();
  useEffect(() => {
    if (!rawData) return;
    registerDataset(dispatch, {
      id:       "primary",
      name:     filename,
      source:   "loaded",
      rowCount: rawData.rows.length,
      colCount: rawData.headers.length,
      headers:  rawData.headers,
    });
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  return null;
}

// ─── PROJECT DASHBOARD ────────────────────────────────────────────────────────
// Reads from IndexedDB (async). Layout: project list left, actions right.
// Mirrors R/Gretl workspace model — projects are first-class, datasets are children.

function Dashboard({onNew, onLoad}) {
  const [projects, setProjects]   = useState([]);
  const [expanded, setExpanded]   = useState({});
  const [loading,  setLoading]    = useState(true);
  const [selected, setSelected]   = useState(null);

  const fmt = ts => ts
    ? new Date(ts).toLocaleDateString("en-GB", {day:"2-digit",month:"short",year:"numeric",hour:"2-digit",minute:"2-digit"})
    : "—";

  useEffect(() => {
    listPipelines()
      .then(list => { setProjects(list); setLoading(false); })
      .catch(() => setLoading(false));
  }, []);

  async function handleDelete(pid, e) {
    e.stopPropagation();
    await deletePipeline(pid);
    setProjects(p => p.filter(x => x.id !== pid));
    if (selected === pid) setSelected(null);
  }

  async function handleClearAll() {
    await clearAllPipelines();
    setProjects([]);
    setSelected(null);
  }

  const selProject = projects.find(p => p.id === selected);

  // ── Layout: two-panel like RStudio/Gretl ──────────────────────────────────
  return (
    <div style={{
      display: "flex", height: "100%", minHeight: 0,
      background: C.bg, fontFamily: mono, overflow: "hidden",
    }}>

      {/* ── LEFT: Project list ── */}
      <div style={{
        width: 340, flexShrink: 0,
        borderRight: `1px solid ${C.border}`,
        display: "flex", flexDirection: "column",
        background: C.surface, overflow: "hidden",
      }}>
        {/* Header */}
        <div style={{
          padding: "1rem 1rem 0.7rem",
          borderBottom: `1px solid ${C.border}`,
          flexShrink: 0,
        }}>
          <div style={{fontSize:9,color:C.teal,letterSpacing:"0.26em",textTransform:"uppercase",marginBottom:3}}>
            Econ Studio
          </div>
          <div style={{fontSize:15,color:C.text,letterSpacing:"-0.01em",marginBottom:1}}>
            Projects
          </div>
          <div style={{fontSize:10,color:C.textMuted}}>
            {loading ? "Loading…" : `${projects.length} saved`}
          </div>
        </div>

        {/* Project list */}
        <div style={{flex:1, overflowY:"auto"}}>
          {!loading && projects.length === 0 && (
            <div style={{
              padding: "2rem 1rem", textAlign:"center",
              fontSize:11, color:C.textMuted, lineHeight:1.8,
            }}>
              No saved projects.<br/>
              <span style={{color:C.gold}}>Create one →</span>
            </div>
          )}

          {projects.map(p => {
            const isSel = p.id === selected;
            const isExp = expanded[p.id];
            // Infer subdatasets from pipeline steps of type join/append
            const mergeSteps = (p.pipeline||[]).filter(s => ["join","append"].includes(s.type));

            return (
              <div key={p.id}>
                {/* ── Project row ── */}
                <div
                  onClick={() => {
                    setSelected(p.id);
                    if (mergeSteps.length) setExpanded(x => ({...x, [p.id]: !x[p.id]}));
                  }}
                  style={{
                    display: "flex", alignItems: "flex-start", gap: 8,
                    padding: "0.7rem 1rem",
                    background: isSel ? `${C.teal}0d` : "transparent",
                    borderLeft: `2px solid ${isSel ? C.teal : "transparent"}`,
                    borderBottom: `1px solid ${C.border}`,
                    cursor: "pointer", transition: "background 0.1s",
                  }}
                  onMouseEnter={e => { if (!isSel) e.currentTarget.style.background = C.surface2; }}
                  onMouseLeave={e => { if (!isSel) e.currentTarget.style.background = "transparent"; }}
                >
                  {/* Expand toggle */}
                  <span style={{
                    fontSize:9, color: C.textMuted, marginTop:3, flexShrink:0, width:10,
                    opacity: mergeSteps.length ? 1 : 0,
                  }}>
                    {isExp ? "▾" : "▸"}
                  </span>

                  {/* Info */}
                  <div style={{flex:1, minWidth:0}}>
                    <div style={{
                      fontSize:12, color: isSel ? C.text : C.textDim,
                      fontWeight: isSel ? 600 : 400,
                      overflow:"hidden", textOverflow:"ellipsis", whiteSpace:"nowrap",
                    }}>
                      {p.filename || "Unnamed"}
                    </div>
                    <div style={{fontSize:9, color:C.textMuted, marginTop:2, display:"flex", gap:8, flexWrap:"wrap"}}>
                      <span>{(p.rowCount||"?").toLocaleString()} rows</span>
                      <span>{p.colCount||"?"} cols</span>
                      {p.pipelineLength > 0 && <span style={{color:C.gold}}>{p.pipelineLength} steps</span>}
                      {p.panel && <span style={{color:C.blue}}>Panel</span>}
                    </div>
                    <div style={{fontSize:9, color:C.border2, marginTop:2}}>{fmt(p.ts)}</div>
                  </div>

                  {/* Delete */}
                  <button
                    onClick={e => handleDelete(p.id, e)}
                    title="Delete project"
                    style={{
                      background:"transparent", border:"none",
                      color:C.textMuted, cursor:"pointer",
                      fontSize:13, padding:"0 2px", flexShrink:0, marginTop:1,
                      transition:"color 0.1s",
                    }}
                    onMouseEnter={e => e.currentTarget.style.color = C.red}
                    onMouseLeave={e => e.currentTarget.style.color = C.textMuted}
                  >
                    ×
                  </button>
                </div>

                {/* ── Subdatasets (merge steps) ── */}
                {isExp && mergeSteps.map((s, i) => (
                  <div key={i} style={{
                    display:"flex", alignItems:"center", gap:6,
                    padding:"0.4rem 1rem 0.4rem 2.2rem",
                    background:`${C.teal}05`,
                    borderBottom:`1px solid ${C.border}`,
                    fontSize:10, color:C.textMuted,
                  }}>
                    <span style={{color:s.type==="join"?C.teal:C.violet, fontSize:9}}>
                      {s.type==="join"?"⊞":"⊕"}
                    </span>
                    <span style={{overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}}>
                      {s.filename || s.desc || s.type}
                    </span>
                    <span style={{
                      marginLeft:"auto", fontSize:8, padding:"1px 5px",
                      border:`1px solid ${C.border2}`, borderRadius:2, color:C.border2,
                      flexShrink:0,
                    }}>
                      {s.type}
                    </span>
                  </div>
                ))}
              </div>
            );
          })}
        </div>

        {/* Footer: clear all */}
        {projects.length > 0 && (
          <div style={{
            padding:"0.6rem 1rem",
            borderTop:`1px solid ${C.border}`,
            flexShrink:0,
          }}>
            <button
              onClick={handleClearAll}
              style={{
                background:"transparent", border:"none",
                color:C.textMuted, cursor:"pointer",
                fontFamily:mono, fontSize:9,
                transition:"color 0.1s",
              }}
              onMouseEnter={e=>e.currentTarget.style.color=C.red}
              onMouseLeave={e=>e.currentTarget.style.color=C.textMuted}
            >
              Clear all projects
            </button>
          </div>
        )}
      </div>

      {/* ── RIGHT: Actions + project detail ── */}
      <div style={{
        flex:1, minWidth:0, overflowY:"auto",
        padding:"1.4rem 1.8rem",
        display:"flex", flexDirection:"column", gap:"1.2rem",
      }}>

        {/* Brand */}
        <div>
          <div style={{fontSize:9,color:C.teal,letterSpacing:"0.26em",textTransform:"uppercase",marginBottom:3}}>
            LMU Munich · Econometrics
          </div>
          <div style={{fontSize:22,color:C.text,letterSpacing:"-0.02em",marginBottom:4}}>
            Econ Studio
          </div>
          <div style={{fontSize:11,color:C.textMuted}}>
            Non-destructive pipeline · OLS · 2SLS · Panel FE/FD · RDD · DiD
          </div>
        </div>

        {/* ── New project card ── */}
        <div
          onClick={onNew}
          style={{
            border:`1px solid ${C.border2}`,
            borderRadius:5, padding:"1.2rem 1.4rem",
            background:C.goldFaint, cursor:"pointer",
            display:"flex", alignItems:"center", gap:14,
            transition:"background 0.15s, border-color 0.15s",
          }}
          onMouseEnter={e=>{e.currentTarget.style.background="#201808";e.currentTarget.style.borderColor=C.goldDim;}}
          onMouseLeave={e=>{e.currentTarget.style.background=C.goldFaint;e.currentTarget.style.borderColor=C.border2;}}
        >
          <span style={{fontSize:22, color:C.gold, flexShrink:0}}>⊕</span>
          <div>
            <div style={{fontSize:13,color:C.gold,marginBottom:3}}>New Project</div>
            <div style={{fontSize:10,color:C.goldDim}}>
              Upload CSV · XLSX · Stata .dta · or load demo dataset
            </div>
          </div>
        </div>

        {/* ── Selected project detail ── */}
        {selProject ? (
          <div style={{
            border:`1px solid ${C.border}`,
            borderRadius:5, overflow:"hidden",
          }}>
            {/* Project header */}
            <div style={{
              padding:"0.85rem 1rem",
              background:C.surface2,
              borderBottom:`1px solid ${C.border}`,
              display:"flex", alignItems:"center", gap:10,
            }}>
              <div style={{flex:1}}>
                <div style={{fontSize:13,color:C.text,marginBottom:2}}>
                  {selProject.filename || "Unnamed"}
                </div>
                <div style={{fontSize:10,color:C.textMuted}}>
                  Last modified {fmt(selProject.ts)}
                </div>
              </div>
              {selProject.panel && (
                <Badge ch={`Panel · i=${selProject.panel.entityCol} · t=${selProject.panel.timeCol}`} color={C.blue}/>
              )}
            </div>

            {/* Stats grid */}
            <div style={{
              display:"grid", gridTemplateColumns:"repeat(4,1fr)",
              gap:1, background:C.border,
            }}>
              {[
                {l:"Rows",     v:(selProject.rowCount||"—").toLocaleString(), c:C.text},
                {l:"Columns",  v:selProject.colCount||"—",                    c:C.text},
                {l:"Pipeline", v:`${selProject.pipelineLength||0} steps`,     c:selProject.pipelineLength?C.gold:C.textMuted},
                {l:"Datasets", v:1 + (selProject.pipeline||[]).filter(s=>["join","append"].includes(s.type)).length, c:C.teal},
              ].map(s=>(
                <div key={s.l} style={{background:C.surface,padding:"0.6rem 0.8rem"}}>
                  <div style={{fontSize:8,color:C.textMuted,letterSpacing:"0.12em",textTransform:"uppercase",marginBottom:3}}>{s.l}</div>
                  <div style={{fontSize:14,color:s.c,fontFamily:mono}}>{s.v}</div>
                </div>
              ))}
            </div>

            {/* Pipeline steps preview */}
            {selProject.pipeline?.length > 0 && (
              <div style={{padding:"0.7rem 1rem", borderTop:`1px solid ${C.border}`, background:C.surface}}>
                <div style={{fontSize:9,color:C.textMuted,letterSpacing:"0.14em",textTransform:"uppercase",marginBottom:6}}>
                  Pipeline steps
                </div>
                <div style={{display:"flex",flexDirection:"column",gap:2}}>
                  {selProject.pipeline.slice(0,5).map((s,i)=>(
                    <div key={i} style={{fontSize:10,color:C.textDim,display:"flex",gap:6}}>
                      <span style={{color:C.border2,flexShrink:0}}>{i+1}.</span>
                      <span style={{overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}}>
                        [{s.type}] {s.desc||""}
                      </span>
                    </div>
                  ))}
                  {selProject.pipeline.length > 5 && (
                    <div style={{fontSize:10,color:C.textMuted}}>
                      … {selProject.pipeline.length - 5} more steps
                    </div>
                  )}
                </div>
              </div>
            )}

            {/* Open button */}
            <div style={{
              padding:"0.8rem 1rem",
              borderTop:`1px solid ${C.border}`,
              background:C.surface2,
              display:"flex", justifyContent:"flex-end",
            }}>
              <button
                onClick={() => onLoad(selProject)}
                style={{
                  padding:"0.42rem 1.1rem",
                  background:C.teal, color:C.bg,
                  border:`1px solid ${C.teal}`, borderRadius:3,
                  cursor:"pointer", fontFamily:mono, fontSize:11, fontWeight:700,
                }}
              >
                Open project →
              </button>
            </div>
          </div>
        ) : (
          <div style={{
            fontSize:11, color:C.textMuted,
            padding:"1rem 0", lineHeight:1.8,
          }}>
            {projects.length > 0
              ? "← Select a project to open or continue working."
              : "Create a new project to get started."}
          </div>
        )}

        {/* Workflow hint */}
        <div style={{
          marginTop:"auto",
          padding:"0.65rem 0.85rem",
          background:C.surface,
          border:`1px solid ${C.border}`,
          borderRadius:4,
          fontSize:10, color:C.textMuted,
          display:"flex", gap:8, alignItems:"center", flexWrap:"wrap",
        }}>
          {["Upload","Wrangling","Evidence Explorer","Modeling"].map((s,i,arr)=>(
            <span key={s} style={{display:"flex",alignItems:"center",gap:8}}>
              <span>{s}</span>
              {i<arr.length-1&&<span style={{color:C.border}}>→</span>}
            </span>
          ))}
        </div>
      </div>
    </div>
  );
}

// ─── ROOT ─────────────────────────────────────────────────────────────────────
export default function App() {
  const [screen,             setScreen]            = useState("dashboard");
  const [rawData,            setRawData]           = useState(null);
  const [filename,           setFilename]          = useState("");
  const [pid,                setPid]               = useState(null);
  const [output,             setOutput]            = useState(null);
  const [activeTab,          setActiveTab]         = useState("clean");
  const [activeDatasetId,    setActiveDatasetId]   = useState(null);
  const [sidebarOpen,        setSidebarOpen]       = useState(false);
  const [activeResult,       setActiveResult]      = useState(null);
  const [coachPrefill,       setCoachPrefill]      = useState(null);
  const [availableDatasets,  setAvailableDatasets] = useState([]);
  const coachSeqRef = useRef(0);

  // ── Load a saved project from the dashboard ──────────────────────────────
  const handleLoad = async p => {
    setFilename(p.filename || "project");
    setPid(p.id);
    setOutput(null);
    setActiveTab("clean");

    if (p.filename === "wages_panel_demo.csv") {
      const { headers, rows } = parseCSV(DEMO_CSV);
      const types = {};
      headers.forEach(h => { types[h] = detectType(rows.slice(0, 50).map(r => r[h])); });
      const coerced = rows.map(r => {
        const o = {}; headers.forEach(h => { o[h] = coerce(r[h], types[h]); }); return o;
      });
      setRawData({ headers, rows: coerced });
      setScreen("workspace");
      return;
    }

    const stored = await loadRawData(p.id);
    if (stored && stored.rows?.length) {
      setRawData(stored);
      setScreen("workspace");
    } else {
      setScreen("upload");
    }
  };

  // ── Called by Uploader once file is confirmed ─────────────────────────────
  // Always generate a fresh pid — never reuse a previous project's pid.
  const handleReady = (data, types, fname) => {
    setRawData(data);
    setFilename(fname || "dataset.csv");
    setPid(`proj_${Date.now()}_${Math.random().toString(36).slice(2)}`);
    setOutput(null);
    setActiveTab("clean");
    setScreen("workspace");
  };

  // ── Pipeline output — fired by DataStudio when user clicks "→ Analyze" ───
  const handleComplete = r => {
    setOutput(r);
    setActiveTab("explore");
  };

  const inWorkspace = screen === "workspace";

  return(
    <div style={{height:"100vh",background:C.bg,overflow:"hidden",display:"flex",flexDirection:"column"}}>
      <style>{`
        @keyframes spin{to{transform:rotate(360deg)}}
        @keyframes fadeUp{from{opacity:0;transform:translateY(6px)}to{opacity:1;transform:translateY(0)}}
        *{box-sizing:border-box;}
        ::-webkit-scrollbar{width:5px;height:5px;}
        ::-webkit-scrollbar-track{background:${C.bg};}
        ::-webkit-scrollbar-thumb{background:${C.border2};border-radius:3px;}
      `}</style>

      {/* ── Navbar ────────────────────────────────────────────────────────── */}
      <div style={{height:38,borderBottom:`1px solid ${C.border}`,display:"flex",alignItems:"center",padding:"0 1.2rem",gap:12,flexShrink:0,background:C.surface}}>
        <button
          onClick={()=>setScreen("dashboard")}
          style={{background:"transparent",border:"none",color:C.gold,cursor:"pointer",fontFamily:mono,fontSize:11,letterSpacing:"0.12em"}}
        >
          ⬡ ECON STUDIO
        </button>

        {inWorkspace && filename && (
          <>
            <span style={{color:C.border2}}>|</span>
            <span style={{fontSize:11,color:C.textDim,fontFamily:mono}}>{filename}</span>
            {output && (
              <span style={{fontSize:9,color:C.textMuted,fontFamily:mono}}>
                · {output.cleanRows.length} obs · {output.headers.length} vars
              </span>
            )}
          </>
        )}

        {inWorkspace && (
          <>
            {!output && (
              <span style={{fontSize:9,color:C.textMuted,fontFamily:mono,marginLeft:4}}>
                autosaved ✓
              </span>
            )}
            <button
              onClick={()=>setSidebarOpen(o=>!o)}
              style={{
                marginLeft:"auto", padding:"0.22rem 0.65rem",
                background: sidebarOpen ? "#9e7ec818" : "transparent",
                border:`1px solid ${sidebarOpen ? "#9e7ec8" : C.border2}`,
                borderRadius:3, color: sidebarOpen ? "#9e7ec8" : C.textMuted,
                cursor:"pointer", fontFamily:mono, fontSize:9,
                letterSpacing:"0.12em", transition:"all 0.13s",
              }}
            >✦ AI Coach</button>
          </>
        )}
      </div>

      {/* ── Main Content ──────────────────────────────────────────────────── */}
      <div style={{flex:1,minHeight:0,overflowY:inWorkspace?"hidden":"auto"}}>

        {screen==="dashboard" && (
          <Dashboard
            onNew={()=>{ setPid(null); setRawData(null); setOutput(null); setScreen("upload"); }}
            onLoad={handleLoad}
          />
        )}

        {screen==="upload" && (
          <Uploader onReady={handleReady}/>
        )}

        {screen==="workspace" && rawData && (
          <SessionStateProvider key={pid}>
            <WorkspaceRegistrar filename={filename} rawData={rawData}/>

            <div style={{display:"flex",flexDirection:"column",height:"100%"}}>
              <WorkspaceBar
                activeTab={activeTab}
                onTabChange={setActiveTab}
                hasOutput={!!output}
                activeDatasetId={activeDatasetId}
                onSelectDataset={setActiveDatasetId}
              />

              {/* ── Tab panels — kept mounted via display:none to preserve state ── */}
              <div style={{flex:1,minHeight:0,position:"relative"}}>

                {/* DATA — overview + format notes; full load UI in phase 9.5 */}
                <div style={{...tabPanel, display: activeTab==="data" ? "block" : "none", overflowY:"auto"}}>
                  <DataTab filename={filename} rawData={rawData}/>
                </div>

                {/* CLEAN — DataStudio always mounted; never remounts on tab switch */}
                <div style={{...tabPanel, display: activeTab==="clean" ? "flex" : "none", flexDirection:"column"}}>
                  <DataStudio
                    key={pid}
                    rawData={rawData}
                    filename={filename}
                    pid={pid}
                    onComplete={handleComplete}
                    onDatasetsChange={setAvailableDatasets}
                  />
                </div>

                {/* EXPLORE */}
                <div style={{...tabPanel, display: activeTab==="explore" ? "flex" : "none", flexDirection:"column"}}>
                  {output
                    ? <ExplorerModule
                        cleanedData={output}
                        onBack={()=>setActiveTab("clean")}
                        onProceed={()=>setActiveTab("model")}
                      />
                    : <NeedsOutput onGoToClean={()=>setActiveTab("clean")}/>
                  }
                </div>

                {/* MODEL */}
                <div style={{...tabPanel, display: activeTab==="model" ? "flex" : "none", flexDirection:"column"}}>
                  {output
                    ? <ModelingTab
                        cleanedData={output}
                        availableDatasets={availableDatasets}
                        onBack={()=>setActiveTab("explore")}
                        onResultChange={r=>setActiveResult(r)}
                        onCoachQuestion={q=>{ setSidebarOpen(true); setCoachPrefill({q,seq:++coachSeqRef.current}); }}
                      />
                    : <NeedsOutput onGoToClean={()=>setActiveTab("clean")}/>
                  }
                </div>

                {/* SIMULATE, CALCULATE, REPORT — stubs (phases 9.7, 9.6, future) */}
                {["simulate","calculate","report"].map(t=>(
                  <div key={t} style={{...tabPanel, display: activeTab===t ? "flex" : "none"}}>
                    <ComingSoon tab={t}/>
                  </div>
                ))}

              </div>
            </div>
          </SessionStateProvider>
        )}

      </div>

      <AIContextSidebar
        isOpen={sidebarOpen}
        onClose={()=>setSidebarOpen(false)}
        screen={activeTab}
        cleanedData={output}
        modelResult={activeResult}
        prefillMessage={coachPrefill}
      />
    </div>
  );
}

// Shared panel style — fills the parent, used by every tab panel.
const tabPanel = {
  position: "absolute",
  inset: 0,
  overflow: "hidden",
};
