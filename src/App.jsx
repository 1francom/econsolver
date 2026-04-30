// ─── ECON STUDIO · App.jsx ────────────────────────────────────────────────────
// Root orchestrator. Manages global state and screen routing.
// All heavy logic lives in the module files — this file should stay thin.
import { useState, useRef, useEffect, useMemo, Fragment } from "react";
import DataStudio from "./DataStudio.jsx";
import ExplorerModule from "./ExplorerModule.jsx";
import ModelingTab from './components/ModelingTab.jsx';
import AIContextSidebar from './components/AIContextSidebar.jsx';
import WorkspaceBar from './components/workspace/WorkspaceBar.jsx';
import WorldBankFetcher from './components/wrangling/WorldBankFetcher.jsx';
import OECDFetcher      from './components/wrangling/OECDFetcher.jsx';
import { SessionStateProvider, useSessionDispatch, registerDataset } from './services/session/sessionState.jsx';
import { listPipelines, deletePipeline, clearAllPipelines, loadRawData } from "./services/persistence/indexedDB.js";
import CalculateTab     from './components/tabs/CalculateTab.jsx';
import SimulateTab      from './components/tabs/SimulateTab.jsx';
import ReportingModule  from './ReportingModule.jsx';

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

// ─── DATA TAB ─────────────────────────────────────────────────────────────────
// ─── DATA VIEWER (R-style View()) ────────────────────────────────────────────
// Scrollable grid with sticky row-number + header, column stats panel.
const PAGE_SIZE = 100;

function colStats(col, rows) {
  const vals = rows.map(r => r[col]).filter(v => v !== null && v !== undefined && v !== "");
  const nulls = rows.length - vals.length;
  const nums  = vals.map(v => typeof v === "number" ? v : parseFloat(v)).filter(v => !isNaN(v));
  if (nums.length > 0) {
    const sum  = nums.reduce((a, b) => a + b, 0);
    const mean = sum / nums.length;
    const min  = Math.min(...nums);
    const max  = Math.max(...nums);
    const sd   = Math.sqrt(nums.reduce((a, b) => a + (b - mean) ** 2, 0) / nums.length);
    return { type: "numeric", n: vals.length, nulls, mean, min, max, sd };
  }
  // Categorical
  const freq = {};
  vals.forEach(v => { const k = String(v); freq[k] = (freq[k] || 0) + 1; });
  const top = Object.entries(freq).sort((a, b) => b[1] - a[1]).slice(0, 5);
  return { type: "string", n: vals.length, nulls, unique: Object.keys(freq).length, top };
}

function DataViewer({ rows, headers, filename }) {
  const [page,      setPage]      = useState(0);
  const [selCol,    setSelCol]    = useState(null);
  const [colFilter, setColFilter] = useState("");

  const visHeaders = colFilter
    ? headers.filter(h => h.toLowerCase().includes(colFilter.toLowerCase()))
    : headers;
  const totalPages = Math.ceil(rows.length / PAGE_SIZE);
  const pageRows   = rows.slice(page * PAGE_SIZE, (page + 1) * PAGE_SIZE);
  const stats      = selCol ? colStats(selCol, rows) : null;
  const fmt = v => {
    if (v === null || v === undefined) return <span style={{color:C.textMuted,fontStyle:"italic"}}>NA</span>;
    if (typeof v === "number") return <span style={{color:"#9ecff5"}}>{Number.isInteger(v) ? v : v.toFixed(4)}</span>;
    return String(v);
  };

  return (
    <div style={{display:"flex",flexDirection:"column",height:"100%",minHeight:0}}>
      {/* Toolbar */}
      <div style={{display:"flex",alignItems:"center",gap:10,padding:"0.5rem 0.9rem",borderBottom:`1px solid ${C.border}`,flexShrink:0,background:C.surface2}}>
        <span style={{fontSize:10,color:C.text,fontFamily:mono}}>{filename}</span>
        <span style={{fontSize:9,color:C.textMuted,fontFamily:mono}}>{rows.length.toLocaleString()} × {headers.length}</span>
        <div style={{flex:1}}/>
        <input
          value={colFilter}
          onChange={e => { setColFilter(e.target.value); setSelCol(null); }}
          placeholder="Filter columns…"
          style={{padding:"3px 8px",background:C.surface,border:`1px solid ${C.border2}`,borderRadius:3,
                  color:C.text,fontFamily:mono,fontSize:10,width:140,outline:"none"}}
        />
        {totalPages > 1 && (
          <div style={{display:"flex",alignItems:"center",gap:6}}>
            <button onClick={() => setPage(p => Math.max(0, p-1))} disabled={page===0}
              style={{padding:"2px 7px",background:"transparent",border:`1px solid ${C.border2}`,borderRadius:3,
                      color: page===0 ? C.textMuted : C.textDim,cursor: page===0 ? "default":"pointer",fontFamily:mono,fontSize:10}}>‹</button>
            <span style={{fontSize:9,color:C.textMuted,fontFamily:mono}}>{page+1}/{totalPages}</span>
            <button onClick={() => setPage(p => Math.min(totalPages-1, p+1))} disabled={page===totalPages-1}
              style={{padding:"2px 7px",background:"transparent",border:`1px solid ${C.border2}`,borderRadius:3,
                      color: page===totalPages-1 ? C.textMuted : C.textDim,cursor: page===totalPages-1 ? "default":"pointer",fontFamily:mono,fontSize:10}}>›</button>
          </div>
        )}
      </div>

      <div style={{display:"flex",flex:1,minHeight:0}}>
        {/* Grid */}
        <div style={{flex:1,overflow:"auto",minHeight:0}}>
          <table style={{borderCollapse:"collapse",fontFamily:mono,fontSize:10,minWidth:"100%"}}>
            <thead style={{position:"sticky",top:0,zIndex:2}}>
              <tr>
                {/* Row number header */}
                <th style={{background:C.surface2,padding:"5px 8px",borderRight:`1px solid ${C.border}`,
                             borderBottom:`1px solid ${C.border2}`,color:C.textMuted,fontWeight:400,
                             textAlign:"right",minWidth:48,position:"sticky",left:0,zIndex:3}}>
                  #
                </th>
                {visHeaders.map(h => {
                  const isNum = rows.slice(0,20).some(r => typeof r[h] === "number");
                  return (
                    <th key={h} onClick={() => setSelCol(selCol===h ? null : h)}
                      style={{
                        background: selCol===h ? `${C.teal}18` : C.surface2,
                        padding:"5px 10px",
                        borderRight:`1px solid ${C.border}`,
                        borderBottom:`1px solid ${C.border2}`,
                        color: selCol===h ? C.teal : C.text,
                        fontWeight:600,cursor:"pointer",whiteSpace:"nowrap",
                        userSelect:"none",
                      }}>
                      <div style={{display:"flex",alignItems:"center",gap:5}}>
                        {h}
                        <span style={{fontSize:8,color: selCol===h ? C.teal : C.textMuted,
                                      border:`1px solid ${selCol===h ? C.teal+"60" : C.border2}`,
                                      borderRadius:2,padding:"1px 4px",fontWeight:400}}>
                          {isNum ? "num" : "str"}
                        </span>
                      </div>
                    </th>
                  );
                })}
              </tr>
            </thead>
            <tbody>
              {pageRows.map((row, i) => {
                const absIdx = page * PAGE_SIZE + i;
                return (
                  <tr key={absIdx} style={{background: i%2===0 ? C.surface : C.bg}}>
                    <td style={{padding:"3px 8px",borderRight:`1px solid ${C.border}`,
                                color:C.textMuted,textAlign:"right",fontVariantNumeric:"tabular-nums",
                                position:"sticky",left:0,background: i%2===0 ? C.surface : C.bg,zIndex:1}}>
                      {absIdx + 1}
                    </td>
                    {visHeaders.map(h => (
                      <td key={h} style={{
                        padding:"3px 10px",
                        borderRight:`1px solid ${C.border}`,
                        color: selCol===h ? C.text : C.textDim,
                        background: selCol===h ? `${C.teal}08` : "transparent",
                        whiteSpace:"nowrap",maxWidth:200,overflow:"hidden",textOverflow:"ellipsis",
                        fontVariantNumeric:"tabular-nums",
                      }}>
                        {fmt(row[h])}
                      </td>
                    ))}
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>

        {/* Column stats panel */}
        {selCol && stats && (
          <div style={{width:200,flexShrink:0,borderLeft:`1px solid ${C.border2}`,
                       background:C.surface,padding:"0.8rem",overflowY:"auto",fontFamily:mono}}>
            <div style={{fontSize:9,color:C.teal,letterSpacing:"0.18em",textTransform:"uppercase",marginBottom:8}}>{selCol}</div>
            <div style={{display:"flex",flexDirection:"column",gap:6}}>
              {stats.type === "numeric" ? (
                <>
                  {[
                    ["Type",  "numeric"],
                    ["n",     stats.n.toLocaleString()],
                    ["NAs",   stats.nulls],
                    ["Mean",  stats.mean.toFixed(4)],
                    ["SD",    stats.sd.toFixed(4)],
                    ["Min",   stats.min],
                    ["Max",   stats.max],
                  ].map(([l,v]) => (
                    <div key={l} style={{display:"flex",justifyContent:"space-between",alignItems:"baseline"}}>
                      <span style={{fontSize:9,color:C.textMuted}}>{l}</span>
                      <span style={{fontSize:10,color:C.text}}>{v}</span>
                    </div>
                  ))}
                </>
              ) : (
                <>
                  {[
                    ["Type",   "string"],
                    ["n",      stats.n.toLocaleString()],
                    ["NAs",    stats.nulls],
                    ["Unique", stats.unique],
                  ].map(([l,v]) => (
                    <div key={l} style={{display:"flex",justifyContent:"space-between",alignItems:"baseline"}}>
                      <span style={{fontSize:9,color:C.textMuted}}>{l}</span>
                      <span style={{fontSize:10,color:C.text}}>{v}</span>
                    </div>
                  ))}
                  <div style={{marginTop:6}}>
                    <div style={{fontSize:9,color:C.textMuted,marginBottom:4}}>Top values</div>
                    {stats.top.map(([val, cnt]) => (
                      <div key={val} style={{display:"flex",justifyContent:"space-between",marginBottom:2}}>
                        <span style={{fontSize:9,color:C.textDim,maxWidth:110,overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}}>{val}</span>
                        <span style={{fontSize:9,color:C.textMuted}}>{cnt}</span>
                      </div>
                    ))}
                  </div>
                </>
              )}
            </div>
            <button onClick={() => setSelCol(null)}
              style={{marginTop:14,fontSize:9,color:C.textMuted,background:"none",border:"none",
                      cursor:"pointer",fontFamily:mono,padding:0}}>✕ close</button>
          </div>
        )}
      </div>
    </div>
  );
}

// ─── COLUMN META TABLE ────────────────────────────────────────────────────────
// Renders a compact column-by-column info table: name, type, non-null %, range/top.
function ColumnMetaTable({ rows, headers, colInfo }) {
  const [expandedCol, setExpandedCol] = useState(null);

  const meta = useMemo(() => headers.map(h => {
    const isNum = colInfo?.[h]?.isNumeric
      ?? rows.slice(0,30).some(r => typeof r[h] === "number");
    const vals  = rows.map(r => r[h]).filter(v => v !== null && v !== undefined && v !== "");
    const nulls = rows.length - vals.length;
    const nullPct = rows.length ? Math.round(nulls / rows.length * 100) : 0;

    if (isNum) {
      const nums = vals.map(v => typeof v === "number" ? v : parseFloat(v)).filter(v => !isNaN(v));
      if (nums.length) {
        const mean = nums.reduce((a,b)=>a+b,0) / nums.length;
        const sd   = Math.sqrt(nums.reduce((a,b)=>a+(b-mean)**2,0)/nums.length);
        return { h, type:"num", nullPct, mean, sd, min:nums.reduce((a,b)=>a<b?a:b, Infinity), max:nums.reduce((a,b)=>a>b?a:b, -Infinity), unique: new Set(nums).size };
      }
    }
    const freq = {};
    vals.forEach(v => { const k=String(v); freq[k]=(freq[k]||0)+1; });
    const top = Object.entries(freq).sort((a,b)=>b[1]-a[1]).slice(0,4);
    return { h, type:"str", nullPct, unique: Object.keys(freq).length, top };
  }), [rows, headers, colInfo]);

  const typeColor = t => t==="num" ? C.blue : t==="date" ? C.teal : C.gold;

  return (
    <table style={{width:"100%",borderCollapse:"collapse",fontFamily:mono,fontSize:10}}>
      <thead>
        <tr style={{background:C.surface2}}>
          {["Column","Type","Non-null","Summary"].map(h=>(
            <th key={h} style={{padding:"5px 10px",textAlign:"left",fontWeight:500,
                                color:C.textMuted,fontSize:9,letterSpacing:"0.1em",
                                textTransform:"uppercase",borderBottom:`1px solid ${C.border2}`}}>
              {h}
            </th>
          ))}
        </tr>
      </thead>
      <tbody>
        {meta.map((m,i) => (
          <Fragment key={m.h}>
            <tr
              onClick={()=>setExpandedCol(expandedCol===m.h ? null : m.h)}
              style={{background: i%2===0 ? C.surface : C.bg, cursor:"pointer",
                      borderBottom:`1px solid ${C.border}`}}>
              <td style={{padding:"5px 10px",color:C.text,fontWeight:500}}>
                {expandedCol===m.h ? "▾ " : "▸ "}{m.h}
              </td>
              <td style={{padding:"5px 10px"}}>
                <span style={{fontSize:9,color:typeColor(m.type),border:`1px solid ${typeColor(m.type)}40`,
                              borderRadius:2,padding:"1px 5px"}}>{m.type}</span>
              </td>
              <td style={{padding:"5px 10px",color: m.nullPct>0 ? C.gold : C.textDim}}>
                {100-m.nullPct}%
                {m.nullPct>0 && <span style={{fontSize:9,color:C.gold,marginLeft:4}}>({m.nullPct}% NA)</span>}
              </td>
              <td style={{padding:"5px 10px",color:C.textMuted,fontSize:9}}>
                {m.type==="num"
                  ? `${m.min} – ${m.max}  ·  μ ${m.mean.toFixed(2)}`
                  : `${m.unique} unique · "${m.top[0]?.[0] ?? ""}"`
                }
              </td>
            </tr>
            {expandedCol===m.h && (
              <tr style={{background:C.surface}}>
                <td colSpan={4} style={{padding:"8px 14px 10px 28px",borderBottom:`1px solid ${C.border2}`}}>
                  {m.type==="num" ? (
                    <div style={{display:"flex",gap:20,flexWrap:"wrap"}}>
                      {[["Mean",m.mean.toFixed(4)],["Std Dev",m.sd.toFixed(4)],
                        ["Min",m.min],["Max",m.max],["Unique",m.unique]].map(([l,v])=>(
                        <div key={l}>
                          <div style={{fontSize:8,color:C.textMuted,letterSpacing:"0.1em",textTransform:"uppercase",marginBottom:2}}>{l}</div>
                          <div style={{fontSize:11,color:C.text}}>{v}</div>
                        </div>
                      ))}
                    </div>
                  ) : (
                    <div>
                      <div style={{fontSize:8,color:C.textMuted,letterSpacing:"0.1em",textTransform:"uppercase",marginBottom:6}}>Top values</div>
                      <div style={{display:"flex",gap:6,flexWrap:"wrap"}}>
                        {m.top.map(([val,cnt])=>(
                          <span key={val} style={{fontSize:9,padding:"2px 8px",border:`1px solid ${C.border2}`,
                                                  borderRadius:2,color:C.textDim}}>
                            {val} <span style={{color:C.textMuted}}>×{cnt}</span>
                          </span>
                        ))}
                      </div>
                    </div>
                  )}
                </td>
              </tr>
            )}
          </Fragment>
        ))}
      </tbody>
    </table>
  );
}

// Dataset overview + load controls (file upload, World Bank, OECD).
function DataTab({ filename, rawData, studioRef, cleanedData, availableDatasets = [], activeDatasetId, onSelectDataset }) {
  const formats  = ["CSV","TSV","XLSX","XLS","DTA","RDS","DBF","SHP"];
  const fileRef  = useRef();
  const [loading,   setLoading]   = useState(false);
  const [err,       setErr]       = useState("");
  const [success,   setSuccess]   = useState("");
  const [wbOpen,    setWbOpen]    = useState(false);
  const [oecdOpen,  setOecdOpen]  = useState(false);
  const [dragOver,  setDragOver]  = useState(false);
  const [view,      setView]      = useState("overview"); // "overview" | "grid"

  // Cleaned data takes priority for display; raw is the fallback
  const viewRows    = cleanedData?.cleanRows ?? rawData?.rows ?? [];
  const viewHeaders = cleanedData?.headers   ?? rawData?.headers ?? [];
  const viewFile    = cleanedData?.filename  ?? filename ?? "dataset";
  const isPipelined = !!cleanedData;

  // Summary stats derived from active data
  const totalNAs = useMemo(() => {
    if (!viewRows.length || !viewHeaders.length) return 0;
    return viewRows.reduce((sum, row) =>
      sum + viewHeaders.filter(h => row[h] === null || row[h] === undefined || row[h] === "").length, 0);
  }, [viewRows, viewHeaders]);
  const numericCols = useMemo(() =>
    viewHeaders.filter(h => viewRows.slice(0,20).some(r => typeof r[h] === "number")),
  [viewRows, viewHeaders]);
  const memEstKB = useMemo(() =>
    Math.round((viewRows?.length ?? 0) * (viewHeaders?.length ?? 0) * 8 / 1024),
  [viewRows, viewHeaders]);

  async function handleFile(file) {
    if (!file) return;
    setLoading(true); setErr(""); setSuccess("");
    try {
      await studioRef.current?.addFile(file);
      setSuccess(`"${file.name}" loaded — visible in Dataset Manager.`);
    } catch (e) {
      setErr("Parse error: " + (e?.message || "unknown"));
    }
    setLoading(false);
  }

  return (
    <div style={{display:"flex",flexDirection:"column",height:"100%",fontFamily:mono,color:C.text}}>
      {/* Sub-tab bar */}
      <div style={{display:"flex",gap:0,borderBottom:`1px solid ${C.border}`,background:C.surface2,flexShrink:0}}>
        {[["overview","Overview"],["grid","Data Viewer"]].map(([id,label]) => (
          <button key={id} onClick={() => setView(id)} style={{
            padding:"0.5rem 1rem", background:"transparent", border:"none",
            borderBottom: view===id ? `2px solid ${C.teal}` : "2px solid transparent",
            color: view===id ? C.teal : C.textDim,
            fontFamily:mono, fontSize:10, cursor:"pointer", letterSpacing:"0.1em",
          }}>{label}</button>
        ))}
        {view==="grid" && isPipelined && (
          <span style={{marginLeft:8,alignSelf:"center",fontSize:9,color:C.teal,
                        border:`1px solid ${C.teal}40`,borderRadius:2,padding:"1px 6px"}}>
            pipeline applied
          </span>
        )}
      </div>

      {/* Overview panel */}
      {view === "overview" && (
        <div style={{display:"flex",flex:1,minHeight:0,overflow:"hidden"}}>

          {/* ── Left column: dataset info + column table ── */}
          <div style={{flex:1,minWidth:0,overflowY:"auto",padding:"1.6rem 2rem"}}>

            {/* Dataset selector — shown when multiple datasets are loaded */}
            {availableDatasets.length > 1 && (
              <div style={{marginBottom:"1.4rem"}}>
                <div style={{fontSize:9,color:C.textMuted,letterSpacing:"0.18em",textTransform:"uppercase",marginBottom:8}}>Session datasets</div>
                <div style={{display:"flex",flexDirection:"column",gap:4}}>
                  {availableDatasets.map(ds => {
                    const isActive = ds.id === activeDatasetId;
                    return (
                      <button key={ds.id} onClick={() => onSelectDataset?.(ds.id)}
                        style={{display:"flex",alignItems:"center",gap:8,padding:"0.45rem 0.75rem",
                                background: isActive ? `${C.teal}12` : C.surface,
                                border:`1px solid ${isActive ? C.teal+"60" : C.border2}`,
                                borderRadius:3,cursor:"pointer",textAlign:"left",fontFamily:mono,
                                transition:"all 0.12s"}}>
                        <span style={{fontSize:9,color: isActive ? C.teal : C.textMuted}}>
                          {isActive ? "●" : "○"}
                        </span>
                        <span style={{fontSize:10,color: isActive ? C.text : C.textDim,flex:1}}>
                          {ds.filename ?? ds.id}
                        </span>
                        {ds.rowCount && (
                          <span style={{fontSize:9,color:C.textMuted}}>
                            {ds.rowCount.toLocaleString()} × {ds.colCount ?? "?"}
                          </span>
                        )}
                      </button>
                    );
                  })}
                </div>
              </div>
            )}

            {/* Active dataset card */}
            {rawData && (
              <div style={{border:`1px solid ${C.border2}`,borderRadius:4,overflow:"hidden",marginBottom:"1.6rem"}}>
                {/* Header */}
                <div style={{background:C.surface2,padding:"0.6rem 0.9rem",display:"flex",alignItems:"center",gap:8,borderBottom:`1px solid ${C.border}`}}>
                  <span style={{fontSize:9,color:C.teal}}>●</span>
                  <span style={{fontSize:12,color:C.text}}>{filename}</span>
                  {isPipelined && (
                    <span style={{fontSize:9,color:C.teal,border:`1px solid ${C.teal}40`,borderRadius:2,padding:"1px 5px"}}>pipeline applied</span>
                  )}
                  <span style={{marginLeft:"auto",fontSize:9,color:C.textMuted,padding:"1px 6px",border:`1px solid ${C.border2}`,borderRadius:2}}>primary</span>
                </div>

                {/* Stats grid */}
                <div style={{display:"grid",gridTemplateColumns:"repeat(5,1fr)",gap:1,background:C.border}}>
                  {[
                    {l:"Rows",     v: viewRows.length.toLocaleString(),        c: C.text},
                    {l:"Columns",  v: viewHeaders.length,                       c: C.text},
                    {l:"Numeric",  v: numericCols.length,                       c: C.blue},
                    {l:"Total NAs",v: totalNAs.toLocaleString(),                c: totalNAs > 0 ? C.gold : C.textMuted},
                    {l:"Est. size", v: memEstKB >= 1024 ? `${(memEstKB/1024).toFixed(1)} MB` : `${memEstKB} KB`, c: C.textMuted},
                  ].map(s=>(
                    <div key={s.l} style={{background:C.surface,padding:"0.5rem 0.75rem"}}>
                      <div style={{fontSize:8,color:C.textMuted,letterSpacing:"0.12em",textTransform:"uppercase",marginBottom:2}}>{s.l}</div>
                      <div style={{fontSize:13,color:s.c}}>{s.v}</div>
                    </div>
                  ))}
                </div>

                {/* Panel info if available */}
                {cleanedData?.panelIndex && (
                  <div style={{padding:"0.45rem 0.9rem",background:C.surface,borderTop:`1px solid ${C.border}`,
                               display:"flex",gap:16,alignItems:"center"}}>
                    <span style={{fontSize:9,color:C.blue,border:`1px solid ${C.blue}40`,borderRadius:2,padding:"1px 5px"}}>Panel</span>
                    <span style={{fontSize:9,color:C.textMuted}}>Entity: <span style={{color:C.textDim}}>{cleanedData.panelIndex.entityCol}</span></span>
                    <span style={{fontSize:9,color:C.textMuted}}>Time: <span style={{color:C.textDim}}>{cleanedData.panelIndex.timeCol}</span></span>
                    {cleanedData.panelIndex.balance && (
                      <span style={{fontSize:9,color:C.textMuted}}>Balance: <span style={{color:C.textDim}}>{cleanedData.panelIndex.balance}</span></span>
                    )}
                  </div>
                )}

                {/* View data button */}
                <div style={{padding:"0.4rem 0.9rem",background:C.surface,borderTop:`1px solid ${C.border}`,display:"flex",gap:8}}>
                  <button onClick={() => setView("grid")}
                    style={{padding:"3px 12px",background:`${C.teal}14`,border:`1px solid ${C.teal}60`,
                            borderRadius:3,color:C.teal,cursor:"pointer",fontFamily:mono,fontSize:9}}>
                    View data ›
                  </button>
                </div>
              </div>
            )}

            {/* Column metadata table */}
            {viewHeaders.length > 0 && (
              <div style={{marginBottom:"1.6rem"}}>
                <div style={{fontSize:9,color:C.textMuted,letterSpacing:"0.18em",textTransform:"uppercase",marginBottom:10}}>
                  Column details <span style={{color:C.textMuted,fontWeight:400,letterSpacing:0,textTransform:"none"}}>— click row to expand</span>
                </div>
                <div style={{border:`1px solid ${C.border2}`,borderRadius:4,overflow:"hidden"}}>
                  <ColumnMetaTable rows={viewRows} headers={viewHeaders} colInfo={cleanedData?.colInfo} />
                </div>
              </div>
            )}
          </div>

          {/* ── Right column: load controls ── */}
          <div style={{width:260,flexShrink:0,borderLeft:`1px solid ${C.border}`,padding:"1.6rem 1.4rem",
                       overflowY:"auto",background:C.surface}}>
            <div style={{fontSize:9,color:C.textMuted,letterSpacing:"0.18em",textTransform:"uppercase",marginBottom:12}}>Load data</div>

            {/* Drop zone */}
            <div
              onDragOver={e=>{e.preventDefault();setDragOver(true);}}
              onDragLeave={()=>setDragOver(false)}
              onDrop={e=>{e.preventDefault();setDragOver(false);handleFile(e.dataTransfer.files[0]);}}
              onClick={()=>fileRef.current?.click()}
              style={{border:`2px dashed ${dragOver ? C.gold : C.border2}`,borderRadius:4,
                      padding:"1rem 0.75rem",textAlign:"center",cursor:"pointer",
                      background: dragOver ? C.goldFaint : "transparent",
                      transition:"all 0.15s",marginBottom:10}}>
              <input ref={fileRef} type="file"
                accept=".csv,.tsv,.txt,.xlsx,.xls,.dta,.rds,.dbf,.shp"
                onChange={e=>handleFile(e.target.files[0])}
                style={{display:"none"}}/>
              {loading
                ? <div style={{fontSize:10,color:C.textDim,fontFamily:mono}}>Parsing…</div>
                : <>
                    <div style={{fontSize:10,color:C.text,marginBottom:2}}>+ Load dataset</div>
                    <div style={{fontSize:9,color:C.textMuted}}>Drop file or click to browse</div>
                  </>
              }
            </div>

            {/* API fetchers */}
            <div style={{display:"flex",flexDirection:"column",gap:5,marginBottom:14}}>
              {[
                {label:"↓ World Bank data", color:C.teal, action:()=>setWbOpen(true)},
                {label:"↓ OECD data",       color:C.blue, action:()=>setOecdOpen(true)},
              ].map(({label,color,action})=>(
                <button key={label} onClick={action} style={{
                  padding:"0.4rem 0.65rem",background:"transparent",
                  border:`1px solid ${C.border2}`,borderRadius:3,
                  color:C.textDim,cursor:"pointer",fontFamily:mono,fontSize:10,
                  textAlign:"left",transition:"all 0.12s",
                }}
                  onMouseEnter={e=>{e.currentTarget.style.borderColor=color;e.currentTarget.style.color=color;}}
                  onMouseLeave={e=>{e.currentTarget.style.borderColor=C.border2;e.currentTarget.style.color=C.textDim;}}
                >{label}</button>
              ))}
            </div>

            {/* Accepted formats */}
            <div style={{fontSize:9,color:C.textMuted,letterSpacing:"0.14em",textTransform:"uppercase",marginBottom:6}}>Formats</div>
            <div style={{display:"flex",flexWrap:"wrap",gap:4,marginBottom:10}}>
              {formats.map(f=>(
                <span key={f} style={{fontSize:9,padding:"2px 6px",border:`1px solid ${C.border2}`,borderRadius:2,color:C.textMuted}}>{f}</span>
              ))}
            </div>
            <div style={{fontSize:9,color:C.textMuted,lineHeight:1.7}}>
              Auto-delimiter detection (CSV / TSV / pipe).<br/>
              Additional datasets can be joined in Clean.
            </div>

            {/* Status */}
            {success && (
              <div style={{marginTop:10,fontSize:9,color:C.green,fontFamily:mono,padding:"0.4rem 0.6rem",
                           border:`1px solid ${C.green}40`,borderRadius:3}}>✓ {success}</div>
            )}
            {err && (
              <div style={{marginTop:10,fontSize:9,color:C.red,fontFamily:mono,padding:"0.4rem 0.6rem",
                           border:`1px solid ${C.red}40`,borderRadius:3}}>{err}</div>
            )}
          </div>
        </div>
      )}

      {/* Data Viewer grid */}
      {view === "grid" && viewRows.length > 0 && (
        <DataViewer rows={viewRows} headers={viewHeaders} filename={viewFile} />
      )}
      {view === "grid" && viewRows.length === 0 && (
        <div style={{padding:"3rem",color:C.textMuted,fontSize:11,textAlign:"center",fontFamily:mono}}>
          No data loaded yet. Use Overview to load a file.
        </div>
      )}

      {/* Modals */}
      {wbOpen && (
        <WorldBankFetcher
          onLoad={(fname, rows, headers) => {
            studioRef.current?.addApiData(fname, rows, headers);
            setWbOpen(false);
            setSuccess(`"${fname}" loaded — visible in Dataset Manager.`);
          }}
          onClose={() => setWbOpen(false)}
        />
      )}
      {oecdOpen && (
        <OECDFetcher
          onLoad={(fname, rows, headers) => {
            studioRef.current?.addApiData(fname, rows, headers);
            setOecdOpen(false);
            setSuccess(`"${fname}" loaded — visible in Dataset Manager.`);
          }}
          onClose={() => setOecdOpen(false)}
        />
      )}
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
  const [outputs,            setOutputs]           = useState({});
  const [activeTab,          setActiveTab]         = useState("clean");
  const [activeDatasetId,    setActiveDatasetId]   = useState(null);
  const [sidebarOpen,        setSidebarOpen]       = useState(false);
  const [activeResult,       setActiveResult]      = useState(null);
  const [coachPrefill,       setCoachPrefill]      = useState(null);
  const [availableDatasets,  setAvailableDatasets] = useState([]);
  const coachSeqRef  = useRef(0);
  const studioRef    = useRef(null);

  // ── Load a saved project from the dashboard ──────────────────────────────
  const handleLoad = async p => {
    setFilename(p.filename || "project");
    setPid(p.id);
    setOutputs({});
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
    setOutputs({});
    setActiveTab("clean");
    setScreen("workspace");
  };

  // ── Pipeline output — fired by DataStudio when user clicks "→ Analyze" ───
  const handleComplete = r => {
    const id = activeDatasetId ?? pid;
    setOutputs(prev => ({ ...prev, [id]: r }));
    setActiveTab("explore");
  };

  // ── Auto output — fired silently when a dataset's pipeline finishes loading ─
  const handleOutputReady = (r, dsId) => {
    setOutputs(prev => ({ ...prev, [dsId]: r }));
  };

  // Active output: prefer the selected dataset's output, fall back to primary
  const activeOutput = outputs[activeDatasetId ?? pid] ?? outputs[pid] ?? null;

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
            {activeOutput && (
              <span style={{fontSize:9,color:C.textMuted,fontFamily:mono}}>
                · {activeOutput.cleanRows.length} obs · {activeOutput.headers.length} vars
              </span>
            )}
          </>
        )}

        {inWorkspace && (
          <>
            {!activeOutput && (
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
        {inFlow&&(
          <button
            onClick={()=>setSidebarOpen(o=>!o)}
            style={{
              marginLeft:"auto", padding:"0.22rem 0.65rem",
              background: sidebarOpen ? `${"#9e7ec8"}18` : "transparent",
              border:`1px solid ${sidebarOpen ? "#9e7ec8" : C.border2}`,
              borderRadius:3, color: sidebarOpen ? "#9e7ec8" : C.textMuted,
              cursor:"pointer", fontFamily:mono, fontSize:9,
              letterSpacing:"0.12em", transition:"all 0.13s",
            }}
          >✦ AI Coach</button>
        )}
      </div>

      {/* ── Main Content ──────────────────────────────────────────────────── */}
      <div style={{flex:1,minHeight:0,overflowY:inWorkspace?"hidden":"auto"}}>

        {screen==="dashboard" && (
          <Dashboard
            onNew={()=>{ setPid(null); setRawData(null); setOutputs({}); setScreen("upload"); }}
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
                hasOutput={!!activeOutput}
                activeDatasetId={activeDatasetId}
                onSelectDataset={id => { setActiveDatasetId(id); studioRef.current?.switchToDataset(id); }}
              />

              {/* ── Tab panels — kept mounted via display:none to preserve state ── */}
              <div style={{flex:1,minHeight:0,position:"relative"}}>

                {/* DATA — dataset overview + file upload + WB/OECD fetchers */}
                <div style={{...tabPanel, display: activeTab==="data" ? "flex" : "none", flexDirection:"column"}}>
                  <DataTab
                    filename={filename} rawData={rawData} studioRef={studioRef}
                    cleanedData={activeOutput}
                    availableDatasets={availableDatasets}
                    activeDatasetId={activeDatasetId ?? pid}
                    onSelectDataset={id => { setActiveDatasetId(id); studioRef.current?.switchToDataset(id); }}
                  />
                </div>

                {/* CLEAN — DataStudio always mounted; never remounts on tab switch */}
                <div style={{...tabPanel, display: activeTab==="clean" ? "flex" : "none", flexDirection:"column"}}>
                  <DataStudio
                    ref={studioRef}
                    key={pid}
                    rawData={rawData}
                    filename={filename}
                    pid={pid}
                    onComplete={handleComplete}
                    onOutputReady={handleOutputReady}
                    onDatasetsChange={setAvailableDatasets}
                    activeDatasetId={activeDatasetId}
                  />
                </div>

                {/* EXPLORE */}
                <div style={{...tabPanel, display: activeTab==="explore" ? "flex" : "none", flexDirection:"column"}}>
                  {activeOutput
                    ? <ExplorerModule
                        cleanedData={activeOutput}
                        onBack={()=>setActiveTab("clean")}
                        onProceed={()=>setActiveTab("model")}
                      />
                    : <NeedsOutput onGoToClean={()=>setActiveTab("clean")}/>
                  }
                </div>

                {/* MODEL */}
                <div style={{...tabPanel, display: activeTab==="model" ? "flex" : "none", flexDirection:"column"}}>
                  {activeOutput
                    ? <ModelingTab
                        cleanedData={activeOutput}
                        availableDatasets={availableDatasets}
                        onBack={()=>setActiveTab("explore")}
                        onResultChange={r=>setActiveResult(r)}
                        onCoachQuestion={q=>{ setSidebarOpen(true); setCoachPrefill({q,seq:++coachSeqRef.current}); }}
                      />
                    : <NeedsOutput onGoToClean={()=>setActiveTab("clean")}/>
                  }
                </div>

                {/* SIMULATE — Phase 9.8 */}
                <div style={{...tabPanel, display: activeTab==="simulate" ? "flex" : "none", flexDirection:"column"}}>
                  <SimulateTab
                    onAddDataset={(name, rows, headers) => studioRef.current?.addApiData(name, rows, headers)}
                  />
                </div>

                {/* REPORT — Phase 9.10 */}
                <div style={{...tabPanel, display: activeTab==="report" ? "flex" : "none"}}>
                  {activeOutput
                    ? <ReportingModule result={activeResult} cleanedData={activeOutput} />
                    : <NeedsOutput onGoToClean={() => setActiveTab("clean")} />
                  }
                </div>

                {/* CALCULATE — Phase 9.7 */}
                <div style={{...tabPanel, display: activeTab==="calculate" ? "flex" : "none", flexDirection:"column"}}>
                  <CalculateTab
                    rows={activeOutput?.cleanRows ?? rawData?.rows ?? []}
                    headers={activeOutput?.headers ?? rawData?.headers ?? []}
                    onAddDataset={(name, rows, headers) => studioRef.current?.addApiData(name, rows, headers)}
                  />
                </div>

              </div>
            </div>
          </SessionStateProvider>
        )}

      </div>

      <AIContextSidebar
        isOpen={sidebarOpen}
        onClose={()=>setSidebarOpen(false)}
        screen={activeTab}
        cleanedData={activeOutput}
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
