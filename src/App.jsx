// ─── ECON STUDIO · App.jsx ────────────────────────────────────────────────────
// Root orchestrator. Manages global state and screen routing.
// All heavy logic lives in the module files — this file should stay thin.
import { useState, useRef, useEffect, useMemo, Fragment } from "react";
import * as XLSX from "xlsx";
import DataStudio, { parseFileForPrimary } from "./DataStudio.jsx";
import ExplorerModule from "./ExplorerModule.jsx";
import ModelingTab from './components/ModelingTab.jsx';
import AIContextSidebar from './components/AIContextSidebar.jsx';
import WorkspaceBar from './components/workspace/WorkspaceBar.jsx';
import FeedbackModal from './components/feedback/FeedbackModal.jsx';
import WorldBankFetcher from './components/wrangling/WorldBankFetcher.jsx';
import OECDFetcher      from './components/wrangling/OECDFetcher.jsx';
import ObservatorioFetcher from './components/wrangling/ObservatorioFetcher.jsx';
import { SessionStateProvider, useSessionDispatch, registerDataset } from './services/session/sessionState.jsx';
import { SessionLogProvider } from './services/session/sessionLog.jsx';
import {
  listPipelines, deletePipeline, clearAllPipelines, loadPipeline,
  saveProject, listProjects, deleteProject, clearAllProjects,
} from "./services/Persistence/indexedDB.js";
import { useAuth } from "./services/auth/AuthContext.jsx";
import { listCloudProjects, lockSession, pullProject, hasSyncSession, renameCloudProject } from "./services/sync/syncEngine.js";
import { listSharedWithMe, pullShare } from "./services/sync/shareEngine.js";
import { useTheme } from "./ThemeContext.jsx";
import { getTablePage } from "./services/data/duckdb.js";
import { ensureRowIdentity } from "./services/data/rowIdentity.js";
import CalculateTab     from './components/tabs/CalculateTab.jsx';
import SimulateTab      from './components/tabs/SimulateTab.jsx';
import SpatialTab       from './components/tabs/SpatialTab.jsx';
import ReportingModule  from './ReportingModule.jsx';
import { TourOverlay, TOUR_STEPS } from "./components/HelpSystem.jsx";

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

const PRELOADED_DATASETS = [
  {
    id: "comunas_metadata",
    label: "Comunas metadata",
    filename: "comunas_metadata.csv",
    url: "/preloaded/comunas_metadata.csv",
    hint: "Geographic metadata for the crime panel dataset",
  },
  {
    id: "crimen_panel_data",
    label: "Crime panel data",
    filename: "crimen_panel_data.csv",
    url: "/preloaded/crimen_panel_data.csv",
    hint: "Commune-level crime and security budget panel",
  },
  {
    id: "dataset_2sls",
    label: "2SLS",
    filename: "dataset_2SLS.csv",
    url: "/preloaded/dataset_2SLS.csv",
    hint: "Instrumental variables and two-stage least squares",
  },
  {
    id: "dataset_did",
    label: "Difference-in-Differences",
    filename: "dataset_DiD.csv",
    url: "/preloaded/dataset_DiD.csv",
    hint: "Treatment and post-period data for DiD",
  },
  {
    id: "dataset_fuzzy_rdd",
    label: "Fuzzy RDD",
    filename: "dataset_fuzzy_rdd.csv",
    url: "/preloaded/dataset_fuzzy_rdd.csv",
    hint: "Fuzzy regression discontinuity design",
  },
  {
    id: "dataset_ols",
    label: "OLS",
    filename: "dataset_OLS.csv",
    url: "/preloaded/dataset_OLS.csv",
    hint: "Multiple linear regression sample",
  },
  {
    id: "dataset_panel",
    label: "Panel data",
    filename: "dataset_Panel.csv",
    url: "/preloaded/dataset_Panel.csv",
    hint: "Entity-time panel with outcome and covariates",
  },
  {
    id: "dataset_rdd",
    label: "Sharp RDD",
    filename: "dataset_RDD.csv",
    url: "/preloaded/dataset_RDD.csv",
    hint: "Sharp regression discontinuity design",
  },
  {
    id: "dataset_twfe",
    label: "TWFE",
    filename: "dataset_TWFE.csv",
    url: "/preloaded/dataset_TWFE.csv",
    hint: "Staggered treatment panel for two-way fixed effects",
  },
  {
    id: "data_gmm",
    label: "GMM",
    filename: "data_GMM.csv",
    url: "/preloaded/data_GMM.csv",
    hint: "Moment-condition instruments for GMM estimation",
  },
  {
    id: "fulton_data",
    label: "Fulton fish market",
    filename: "PS2_Ex1_Fulton_data.csv",
    url: "/preloaded/PS2_Ex1_Fulton_data.csv",
    hint: "Daily Fulton fish market price and quantity data",
  },
  {
    id: "synth_control_simulated_panel",
    label: "Synthetic control",
    filename: "synth_control_simulated_panel.csv",
    url: "/preloaded/synth_control_simulated_panel.csv",
    hint: "Simulated regional panel for synthetic control",
  },
];

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
function Btn({onClick,ch,color,v="out",dis=false,sm=false}){
  const { C, T } = useTheme();
  color = color ?? C.gold;
  const b={padding:sm?"0.28rem 0.65rem":"0.48rem 0.95rem",borderRadius:3,cursor:dis?"not-allowed":"pointer",fontFamily: T.code.fontFamily,fontSize:sm?10:11,transition:"all 0.13s",opacity:dis?0.4:1};
  if(v==="solid")return<button onClick={onClick} disabled={dis} style={{...b,background:color,color:C.bg,border:`1px solid ${color}`,fontWeight:700}}>{ch}</button>;
  if(v==="ghost")return<button onClick={onClick} disabled={dis} style={{...b,background:"transparent",border:"none",color:dis?C.textMuted:color}}>{ch}</button>;
  return<button onClick={onClick} disabled={dis} style={{...b,background:"transparent",border:`1px solid ${C.border2}`,color:dis?C.textMuted:C.textDim}}>{ch}</button>;
}
function Badge({ch,color}){const { C, T } = useTheme(); color = color ?? C.textMuted; return<span style={{fontSize: T.caption.fontSize,padding:"2px 6px",border:`1px solid ${color}`,color,borderRadius:2,letterSpacing:"0.1em",fontFamily: T.code.fontFamily,whiteSpace:"nowrap"}}>{ch}</span>;}
function Spin(){const { C, T } = useTheme(); return<div style={{width:14,height:14,border:`2px solid ${C.border2}`,borderTopColor:C.gold,borderRadius:"50%",animation:"spin 0.7s linear infinite",flexShrink:0}}/>;}

// ─── DATA GRID (shared preview) ───────────────────────────────────────────────
function Grid({headers,rows,hi,max=20,types,onType}){
  const { C, T } = useTheme();
  const vis=rows.slice(0,max);
  if(!headers.length)return null;
  const tc={numeric:C.blue,binary:C.purple,categorical:C.purple,string:C.textMuted,date:C.teal};
  return(
    <div style={{overflowX:"auto",borderRadius:4,border:`1px solid ${C.border}`}}>
      <table style={{borderCollapse:"collapse",fontSize: T.code.fontSize,width:"100%",minWidth:300}}>
        <thead>
          <tr style={{background:C.surface2}}>
            {headers.map(h=>(
              <th key={h} style={{padding:"0.45rem 0.75rem",textAlign:"left",fontFamily: T.code.fontFamily,fontWeight:400,fontSize: T.caption.fontSize,color:h===hi?C.teal:C.textDim,whiteSpace:"nowrap",borderBottom:`1px solid ${C.border}`,position:"sticky",top:0,background:C.surface2}}>
                <div style={{display:"flex",flexDirection:"column",gap:2}}>
                  <span>{h}</span>
                  {onType&&types&&<select value={types[h]||""} onChange={e=>onType(h,e.target.value)} onClick={e=>e.stopPropagation()} style={{fontSize: T.caption.fontSize,padding:"1px 3px",background:C.surface,border:`1px solid ${C.border2}`,borderRadius:2,color:tc[types[h]]||C.textMuted,fontFamily: T.code.fontFamily,cursor:"pointer",outline:"none"}}>
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
                <td key={h} style={{padding:"0.35rem 0.75rem",fontFamily: T.code.fontFamily,fontSize: T.code.fontSize,color:isNull?C.textMuted:h===hi?C.teal:C.text,borderBottom:`1px solid ${C.border}`,whiteSpace:"nowrap",maxWidth:180,overflow:"hidden",textOverflow:"ellipsis"}}>
                  {isNull?"·":typeof v==="number"?v.toFixed(3).replace(/\.?0+$/,""):String(v)}
                </td>
              );})}
            </tr>
          ))}
        </tbody>
      </table>
      {rows.length>max&&<div style={{padding:"0.35rem 0.75rem",fontSize: T.caption.fontSize,color:C.textMuted,fontFamily: T.code.fontFamily,background:C.surface2,borderTop:`1px solid ${C.border}`}}>… {rows.length-max} more rows</div>}
    </div>
  );
}

// ─── UPLOADER ────────────────────────────────────────────────────────────────
function Uploader({onReady}){
  const { C, T } = useTheme();
  const [drag,setDrag]=useState(false),[loading,setLoading]=useState(false),[err,setErr]=useState(""),[pf,setPf]=useState(null);
  const ref=useRef();
  function processParsed({headers,rows},fname){
    try{
      if(!headers.length)throw new Error("No headers found");
      const types={};
      headers.forEach(h=>{types[h]=detectType(rows.slice(0,100).map(r=>r[h]));});
      const withRi=rows.map((r,i)=>({__ri:i,...r}));
      setPf({headers,rows:withRi,dt:types,fname});
    }catch(e){setErr("Error: "+e.message);}
  }
  async function handleFile(file){
    if(!file)return;
    setLoading(true);setErr("");
    try{
      const name=file.name.toLowerCase();
      if(name.endsWith(".rds")){
        const{parseRDS}=await import("./services/data/parsers/rds.js");
        const ab=await file.arrayBuffer();
        const parsed=await parseRDS(ab);
        processParsed(parsed,file.name);
        setLoading(false);return;
      }
      if(name.endsWith(".zip")){
        const{unzipSync}=await import("fflate");
        const ab=await file.arrayBuffer();
        const files=unzipSync(new Uint8Array(ab));
        const keys=Object.keys(files);
        const shpKey=keys.find(k=>k.toLowerCase().endsWith(".shp"));
        const dbfKey=keys.find(k=>k.toLowerCase().endsWith(".dbf"));
        if(!dbfKey)throw new Error("ZIP contains no .dbf file.");
        const{parseShapefile}=await import("./services/data/parsers/shapefile.js");
        const dbfArr=files[dbfKey];
        const dbfBuf=dbfArr.buffer.slice(dbfArr.byteOffset,dbfArr.byteOffset+dbfArr.byteLength);
        let shpBuf=null;
        if(shpKey){const a=files[shpKey];shpBuf=a.buffer.slice(a.byteOffset,a.byteOffset+a.byteLength);}
        processParsed(parseShapefile(dbfBuf,shpBuf),file.name);
        setLoading(false);return;
      }
      let text="";
      if(name.endsWith(".xlsx")||name.endsWith(".xls")){
        const ab=await file.arrayBuffer();
        const wb=XLSX.read(ab,{type:"array"});
        text=XLSX.utils.sheet_to_csv(wb.Sheets[wb.SheetNames[0]]);
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
    <div style={{maxWidth:900,margin:"0 auto",padding:"2rem",fontFamily: T.code.fontFamily}}>
      <div style={{fontSize: T.caption.fontSize,color:C.teal,letterSpacing:"0.26em",textTransform:"uppercase",marginBottom:5}}>Preview — {pf.fname}</div>
      <div style={{fontSize: T.code.fontSize,color:C.textDim,marginBottom:"1.2rem"}}>{pf.rows.length} rows · {pf.headers.length} cols · Click type badges to override</div>
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
        <div style={{fontSize: T.caption.fontSize,color:C.teal,letterSpacing:"0.26em",textTransform:"uppercase",marginBottom:5,fontFamily: T.code.fontFamily}}>Data Ingestion</div>
        <div style={{fontSize: T.h2.fontSize,color:C.text,letterSpacing:"-0.02em"}}>Load your dataset</div>
      </div>
      <div onDragOver={e=>{e.preventDefault();setDrag(true);}} onDragLeave={()=>setDrag(false)}
        onDrop={e=>{e.preventDefault();setDrag(false);handleFile(e.dataTransfer.files[0]);}}
        onClick={()=>ref.current?.click()}
        style={{width:"100%",border:`2px dashed ${drag?C.gold:C.border2}`,borderRadius:6,padding:"2.5rem 1.5rem",textAlign:"center",cursor:"pointer",background:drag?C.goldFaint:C.surface,transition:"all 0.15s"}}>
        <input ref={ref} type="file" accept=".csv,.tsv,.txt,.json,.xlsx,.xls,.dta,.rds,.parquet,.zip" onChange={e=>handleFile(e.target.files[0])} style={{display:"none"}}/>
        <div style={{fontSize: T.display.fontSize,marginBottom:8}}>⬆</div>
        <div style={{fontSize: T.body.fontSize,color:C.text,marginBottom:4}}>Drop file or click to browse</div>
        <div style={{fontSize: T.code.fontSize,color:C.textMuted,fontFamily: T.code.fontFamily}}>CSV · TSV · XLSX · Stata .dta · R .rds · Shapefile .zip</div>
      </div>
      {loading&&<div style={{display:"flex",alignItems:"center",gap:10,color:C.textDim,fontSize: T.code.fontSize}}><Spin/> Parsing…</div>}
      {err&&<div style={{color:C.red,fontSize: T.code.fontSize,fontFamily: T.code.fontFamily,padding:"0.65rem 1rem",border:`1px solid ${C.red}40`,borderRadius:4,width:"100%"}}>{err}</div>}
      <div style={{display:"flex",gap:8,alignItems:"center"}}>
        <div style={{height:1,width:50,background:C.border}}/><span style={{fontSize: T.caption.fontSize,color:C.textMuted,fontFamily: T.code.fontFamily}}>or</span><div style={{height:1,width:50,background:C.border}}/>
      </div>
      <Btn onClick={()=>process(DEMO_CSV,"wages_panel_demo.csv")} color={C.teal} v="solid" ch="Load wages panel demo"/>
    </div>
  );
}

// ─── WORKSPACE HELPERS ────────────────────────────────────────────────────────
// Shown when no dataset is loaded yet — directs user to Data tab.
function NeedsData({ onGoToData }) {
  const { C, T } = useTheme();
  return (
    <div style={{display:"flex",flexDirection:"column",alignItems:"center",justifyContent:"center",
                 height:"100%",gap:12,fontFamily: T.code.fontFamily}}>
      <div style={{fontSize: T.display.fontSize,color:C.border2}}>⊕</div>
      <div style={{fontSize: T.code.fontSize,color:C.textDim}}>No dataset loaded yet.</div>
      <div style={{fontSize: T.caption.fontSize,color:C.textMuted,marginBottom:4}}>
        Load a file, fetch from World Bank, or simulate data from the Data tab.
      </div>
      <Btn onClick={onGoToData} v="solid" color={C.teal} ch="→ Go to Data"/>
    </div>
  );
}

// Shown in Explore / Model / Report tabs when no pipeline output exists yet.
function NeedsOutput({ onGoToClean }) {
  const { C, T } = useTheme();
  return (
    <div style={{display:"flex",flexDirection:"column",alignItems:"center",justifyContent:"center",height:"100%",gap:12,fontFamily: T.code.fontFamily}}>
      <div style={{fontSize: T.display.fontSize,color:C.border2}}>⌾</div>
      <div style={{fontSize: T.code.fontSize,color:C.textDim}}>Apply your pipeline first.</div>
      <div style={{fontSize: T.caption.fontSize,color:C.textMuted,marginBottom:4}}>Go to Clean → run your steps → click "→ Analyze"</div>
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
    const min  = nums.reduce((m, v) => v < m ? v : m, nums[0]);
    const max  = nums.reduce((m, v) => v > m ? v : m, nums[0]);
    const sd   = Math.sqrt(nums.reduce((a, b) => a + (b - mean) ** 2, 0) / nums.length);
    return { type: "numeric", n: vals.length, nulls, mean, min, max, sd };
  }
  // Categorical
  const freq = {};
  vals.forEach(v => { const k = String(v); freq[k] = (freq[k] || 0) + 1; });
  const top = Object.entries(freq).sort((a, b) => b[1] - a[1]).slice(0, 5);
  return { type: "string", n: vals.length, nulls, unique: Object.keys(freq).length, top };
}

function DataViewer({ rows, headers, filename, onPatch, onFillColumn, onAddColumn, onAddRow, onSetWhere, onReplace, onStrSplice, duckdbMeta }) {
  const { C, T } = useTheme();
  const [page,         setPage]        = useState(0);
  const [selCol,       setSelCol]      = useState(null);
  const [colFilter,    setColFilter]   = useState("");
  const [editMode,     setEditMode]    = useState(false);
  const [editingCell,  setEditingCell] = useState(null); // { ri, col }
  const [editValue,    setEditValue]   = useState("");
  const [fillCol,      setFillCol]     = useState("");
  const [fillOp,       setFillOp]      = useState("set");
  const [fillText,     setFillText]    = useState("");
  const [filterCol,    setFilterCol]   = useState("");
  const [filterOp,     setFilterOp]    = useState("contains");
  const [filterVal,    setFilterVal]   = useState("");
  const [targetCol,    setTargetCol]   = useState("");
  const [setValue,     setSetValue]    = useState("");
  const [editPanel,    setEditPanel]   = useState("filter");
  const [newColName,   setNewColName]  = useState("");
  const [newColFill,   setNewColFill]  = useState("");
  const [newColType,   setNewColType]  = useState("string");
  const [rowCount,     setRowCount]    = useState(1);
  const [replaceCol,   setReplaceCol]  = useState("");
  const [replaceFind,  setReplaceFind] = useState("");
  const [replaceWith,  setReplaceWith] = useState("");
  const [replaceMode,  setReplaceMode] = useState("exact");
  const [replaceNewCol,setReplaceNewCol] = useState("");
  const [spliceCol,    setSpliceCol]   = useState("");
  const [spliceMode,   setSpliceMode]  = useState("insert");
  const [splicePos,    setSplicePos]   = useState(1);
  const [spliceText,   setSpliceText]  = useState("");
  const [spliceCount,  setSpliceCount] = useState(0);
  const [spliceNewCol, setSpliceNewCol] = useState("");
  const [dbPageRows,   setDbPageRows]  = useState([]);  // DuckDB-fetched page
  const [roundDec,     setRoundDec]    = useState("");   // "" = no rounding; "4" = 4 decimal places

  // When the table changes (new dataset or pipeline step), reset to page 0
  useEffect(() => { setPage(0); setDbPageRows([]); }, [duckdbMeta?.tableName]);

  // Initialize fillCol to first non-internal column when headers change
  useEffect(() => {
    const first = headers.find(h => !h.startsWith("__")) ?? headers[0] ?? "";
    setFillCol(first);
    setFilterCol(first);
    setTargetCol(first);
    setReplaceCol(first);
    setSpliceCol(first);
  }, [headers]);

  // Async page fetch from DuckDB
  useEffect(() => {
    if (!duckdbMeta?.tableName) return;
    let cancelled = false;
    getTablePage(duckdbMeta.tableName, page * PAGE_SIZE, PAGE_SIZE)
      .then(r => { if (!cancelled) setDbPageRows(r); })
      .catch(() => {});
    return () => { cancelled = true; };
  }, [duckdbMeta?.tableName, page]);

  // Pre-compute which columns are numeric (from preview rows — stable enough).
  const numCols = useMemo(() => {
    const s = new Set();
    const sample = rows.slice(0, 20);
    headers.forEach(h => { if (sample.some(r => typeof r[h] === "number")) s.add(h); });
    return s;
  }, [rows, headers]);

  const visHeaders = colFilter
    ? headers.filter(h => h.toLowerCase().includes(colFilter.toLowerCase()))
    : headers;
  const editableHeaders = headers.filter(h => !h.startsWith("__"));
  const filterPredicate = useMemo(() => {
    if (!filterCol || !filterOp) return null;
    const sval = String(filterVal ?? "");
    const num = Number(filterVal);
    return (r) => {
      const raw = r[filterCol];
      const s = raw == null ? "" : String(raw);
      switch (filterOp) {
        case "equals": return s === sval;
        case "contains": return s.includes(sval);
        case "starts": return s.startsWith(sval);
        case "ends": return s.endsWith(sval);
        case "gt": return Number(raw) > num;
        case "lt": return Number(raw) < num;
        case "empty": return raw == null || s === "";
        case "notempty": return raw != null && s !== "";
        default: return true;
      }
    };
  }, [filterCol, filterOp, filterVal]);
  const filteredRows = useMemo(
    () => filterPredicate ? rows.filter(filterPredicate) : rows,
    [rows, filterPredicate]
  );
  useEffect(() => { setPage(0); }, [filterCol, filterOp, filterVal]);

  const isDuck     = !!duckdbMeta?.tableName;
  const totalCount = isDuck && !filterPredicate ? (duckdbMeta.rowCount ?? 0) : filteredRows.length;
  const totalPages = Math.ceil(totalCount / PAGE_SIZE) || 1;
  const pageRows   = isDuck && !filterPredicate
    ? dbPageRows
    : filteredRows.slice(page * PAGE_SIZE, (page + 1) * PAGE_SIZE);
  const whereClause = { col: filterCol, op: filterOp, value: filterVal };
  const hasFilterValue = ["empty","notempty"].includes(filterOp) || filterVal !== "";
  const canBulkEdit = !!filterCol && hasFilterValue && !!targetCol && !!onSetWhere;
  const controlStyle = {
    padding:"2px 6px", background:C.surface, border:`1px solid ${C.border2}`,
    borderRadius:3, color:C.text, fontFamily: T.code.fontFamily, fontSize: T.caption.fontSize, outline:"none",
  };
  const chipStyle = active => ({
    padding:"2px 7px", borderRadius:3, fontFamily: T.code.fontFamily, fontSize: T.caption.fontSize, cursor:"pointer",
    background: active ? `${C.teal}33` : "transparent",
    border:`1px solid ${active ? C.teal : C.border2}`,
    color: active ? C.teal : C.textMuted, transition:"all 0.1s",
  });
  // Stats computed from preview rows (approximate for large DuckDB datasets)
  const stats      = selCol ? colStats(selCol, rows) : null;
  const roundDecN = roundDec !== "" ? parseInt(roundDec, 10) : null;
  const fmt = v => {
    if (v === null || v === undefined) return <span style={{color:C.textMuted,fontStyle:"italic"}}>NA</span>;
    if (typeof v === "number") {
      const display = (roundDecN !== null && Number.isFinite(roundDecN) && roundDecN >= 0)
        ? v.toFixed(roundDecN)
        : String(v);
      return <span style={{color:"#9ecff5"}}>{display}</span>;
    }
    return String(v);
  };

  function handleCommit(ri, col, val) {
    setEditingCell(null);
    if (!onPatch) return;
    const trimmed = val.trim();
    let finalVal;
    if (trimmed === "") {
      finalVal = null;
    } else if (numCols.has(col)) {
      const n = Number(trimmed);
      finalVal = isNaN(n) ? trimmed : n;
    } else {
      finalVal = trimmed;
    }
    // No-op if unchanged
    const oldVal = rows.find(r => r.__ri === ri)?.[col] ?? null;
    if (finalVal === oldVal) return;
    onPatch(ri, col, finalVal);
  }

  function startEdit(ri, col, currentVal) {
    if (!onPatch) return;
    setEditValue(currentVal != null ? String(currentVal) : "");
    setEditingCell({ ri, col });
  }

  return (
    <div style={{display:"flex",flexDirection:"column",height:"100%",minHeight:0}}>
      {/* Toolbar */}
      <div style={{display:"flex",alignItems:"center",gap:10,padding:"0.5rem 0.9rem",borderBottom:`1px solid ${C.border}`,flexShrink:0,background:C.surface2}}>
        <span style={{fontSize: T.caption.fontSize,color:C.text,fontFamily: T.code.fontFamily}}>{filename}</span>
        <span style={{fontSize: T.caption.fontSize,color:C.textMuted,fontFamily: T.code.fontFamily}}>{totalCount.toLocaleString()} × {headers.length}</span>
        {onPatch && (
          <button
            onClick={() => { setEditMode(m => { if (m) { setEditingCell(null); setFillText(""); } return !m; }); }}
            title={editMode ? "Exit cell editing mode" : "Enable cell editing (double-click to edit cells)"}
            style={{
              padding:"2px 8px", borderRadius:3, fontFamily: T.code.fontFamily, fontSize: T.caption.fontSize,
              cursor:"pointer",
              background: editMode ? `${C.teal}22` : "transparent",
              border: `1px solid ${editMode ? C.teal : C.border2}`,
              color: editMode ? C.teal : C.textMuted,
              transition:"all 0.12s",
            }}>
            {editMode ? "✎ editing" : "✎ edit cells"}
          </button>
        )}
        <div style={{flex:1}}/>
        <input
          value={colFilter}
          onChange={e => { setColFilter(e.target.value); setSelCol(null); }}
          placeholder="Filter columns…"
          style={{padding:"3px 8px",background:C.surface,border:`1px solid ${C.border2}`,borderRadius:3,
                  color:C.text,fontFamily: T.code.fontFamily,fontSize: T.caption.fontSize,width:140,outline:"none"}}
        />
        {/* Decimal rounding control */}
        <div style={{display:"flex",alignItems:"center",gap:4}}>
          <span style={{fontSize: T.caption.fontSize,color:C.textMuted,fontFamily: T.code.fontFamily,whiteSpace:"nowrap"}}>dec:</span>
          <input
            type="number"
            min="0"
            max="20"
            value={roundDec}
            onChange={e => setRoundDec(e.target.value)}
            placeholder="auto"
            title="Round numeric cells to N decimal places (leave blank for full precision)"
            style={{
              width:52, padding:"3px 5px", background:C.surface, border:`1px solid ${C.border2}`,
              borderRadius:3, color: roundDec !== "" ? C.teal : C.textMuted,
              fontFamily: T.code.fontFamily, fontSize: T.caption.fontSize, outline:"none",
            }}
          />
          {roundDec !== "" && (
            <button
              onClick={() => setRoundDec("")}
              title="Clear rounding — show full precision"
              style={{padding:"1px 5px",background:"transparent",border:`1px solid ${C.border2}`,
                      borderRadius:3,color:C.textMuted,fontFamily: T.code.fontFamily,fontSize: T.caption.fontSize,cursor:"pointer"}}>
              ×
            </button>
          )}
        </div>
        {totalPages > 1 && (
          <div style={{display:"flex",alignItems:"center",gap:4}}>
            <span style={{fontSize: T.caption.fontSize,color:C.textMuted,fontFamily: T.code.fontFamily}}>rows {page*PAGE_SIZE+1}–{Math.min((page+1)*PAGE_SIZE, totalCount)}</span>
            <button onClick={() => setPage(p => Math.max(0, p-1))} disabled={page===0}
              title="Previous 100 rows"
              style={{padding:"2px 6px",background:"transparent",border:`1px solid ${C.border2}`,borderRadius:3,
                      color: page===0 ? C.textMuted : C.textDim,cursor: page===0 ? "default":"pointer",fontFamily: T.code.fontFamily,fontSize: T.caption.fontSize}}>↑</button>
            <button onClick={() => setPage(p => Math.min(totalPages-1, p+1))} disabled={page===totalPages-1}
              title="Next 100 rows"
              style={{padding:"2px 6px",background:"transparent",border:`1px solid ${C.border2}`,borderRadius:3,
                      color: page===totalPages-1 ? C.textMuted : C.textDim,cursor: page===totalPages-1 ? "default":"pointer",fontFamily: T.code.fontFamily,fontSize: T.caption.fontSize}}>↓</button>
          </div>
        )}
      </div>

      {/* Fill Column panel — shown only in edit mode */}
      {editMode && onFillColumn && (
        <div style={{display:"flex",alignItems:"center",gap:8,padding:"0.4rem 0.9rem",
                     borderBottom:`1px solid ${C.border}`,flexShrink:0,background:`${C.teal}0d`,flexWrap:"wrap"}}>
          <span style={{fontSize: T.caption.fontSize,color:C.teal,fontFamily: T.code.fontFamily,whiteSpace:"nowrap"}}>Fill column:</span>
          <select
            value={fillCol || headers[0] || ""}
            onChange={e => setFillCol(e.target.value)}
            style={{padding:"2px 6px",background:C.surface,border:`1px solid ${C.border2}`,borderRadius:3,
                    color:C.text,fontFamily: T.code.fontFamily,fontSize: T.caption.fontSize,maxWidth:160}}>
            {headers.filter(h => !h.startsWith("__")).map(h => (
              <option key={h} value={h}>{h}</option>
            ))}
          </select>
          {/* Op chips */}
          {[["set","Set"],["append","Append"],["prepend","Prepend"]].map(([op, label]) => (
            <button key={op} onClick={() => setFillOp(op)}
              style={{padding:"2px 7px",borderRadius:3,fontFamily: T.code.fontFamily,fontSize: T.caption.fontSize,cursor:"pointer",
                      background: fillOp === op ? `${C.teal}33` : "transparent",
                      border:`1px solid ${fillOp === op ? C.teal : C.border2}`,
                      color: fillOp === op ? C.teal : C.textMuted,transition:"all 0.1s"}}>
              {label}
            </button>
          ))}
          <input
            value={fillText}
            onChange={e => setFillText(e.target.value)}
            placeholder="value to fill…"
            style={{flex:1,minWidth:160,padding:"3px 8px",background:C.surface,
                    border:`1px solid ${C.border2}`,borderRadius:3,color:C.text,
                    fontFamily: T.code.fontFamily,fontSize: T.caption.fontSize,outline:"none"}}
          />
          <button
            disabled={!fillText && fillOp === "set"}
            onClick={() => {
              const col = fillCol || headers.find(h => !h.startsWith("__")) || "";
              if (!col) return;
              onFillColumn(col, fillOp, fillText);
            }}
            style={{padding:"3px 10px",borderRadius:3,fontFamily: T.code.fontFamily,fontSize: T.caption.fontSize,cursor:"pointer",
                    background:`${C.teal}22`,border:`1px solid ${C.teal}`,color:C.teal,
                    opacity:(!fillText && fillOp==="set") ? 0.4 : 1}}>
            Apply to all
          </button>
        </div>
      )}

      {editMode && (
        <div style={{display:"flex",flexDirection:"column",gap:6,padding:"0.45rem 0.9rem",
                     borderBottom:`1px solid ${C.border}`,flexShrink:0,background:C.surface,}}>
          <div style={{display:"flex",alignItems:"center",gap:6,flexWrap:"wrap"}}>
            {[["filter","Filter / set"],["add","Add"],["replace","Replace"],["splice","Position"]].map(([id, label]) => (
              <button key={id} onClick={() => setEditPanel(id)} style={chipStyle(editPanel === id)}>
                {label}
              </button>
            ))}
            <span style={{fontSize: T.caption.fontSize,color:C.textMuted,fontFamily: T.code.fontFamily,marginLeft:"auto"}}>
              showing {pageRows.length ? (page * PAGE_SIZE + 1).toLocaleString() : 0}-{Math.min((page + 1) * PAGE_SIZE, totalCount).toLocaleString()} of {totalCount.toLocaleString()}
            </span>
          </div>

          {editPanel === "filter" && (
            <div style={{display:"flex",alignItems:"center",gap:7,flexWrap:"wrap"}}>
              <span style={{fontSize: T.caption.fontSize,color:C.teal,fontFamily: T.code.fontFamily}}>Rows</span>
              <select value={filterCol} onChange={e => setFilterCol(e.target.value)} style={{...controlStyle,maxWidth:150}}>
                {editableHeaders.map(h => <option key={h} value={h}>{h}</option>)}
              </select>
              <select value={filterOp} onChange={e => setFilterOp(e.target.value)} style={controlStyle}>
                {[
                  ["equals","equals"],["contains","contains"],["starts","starts"],["ends","ends"],
                  ["gt",">"],["lt","<"],["empty","empty"],["notempty","not empty"],
                ].map(([op, label]) => <option key={op} value={op}>{label}</option>)}
              </select>
              {!["empty","notempty"].includes(filterOp) && (
                <input value={filterVal} onChange={e => setFilterVal(e.target.value)}
                  placeholder="value" style={{...controlStyle,width:130}}/>
              )}
              <span style={{fontSize: T.caption.fontSize,color:C.textMuted,fontFamily: T.code.fontFamily}}>
                {filteredRows.length.toLocaleString()} of {rows.length.toLocaleString()}
              </span>
              {onSetWhere && (
                <>
                  <span style={{fontSize: T.caption.fontSize,color:C.border2,fontFamily: T.code.fontFamily}}>|</span>
                  <span style={{fontSize: T.caption.fontSize,color:C.teal,fontFamily: T.code.fontFamily}}>Set</span>
                  <select value={targetCol} onChange={e => setTargetCol(e.target.value)} style={{...controlStyle,maxWidth:150}}>
                    {editableHeaders.map(h => <option key={h} value={h}>{h}</option>)}
                  </select>
                  <input value={setValue} onChange={e => setSetValue(e.target.value)}
                    placeholder="value" style={{...controlStyle,width:130}}/>
                  <button disabled={!canBulkEdit} onClick={() => onSetWhere(targetCol, whereClause, "set", setValue)}
                    style={{...chipStyle(true),opacity:canBulkEdit ? 1 : 0.4,cursor:canBulkEdit ? "pointer" : "not-allowed"}}>
                    Set
                  </button>
                  <button disabled={!canBulkEdit} onClick={() => onSetWhere(targetCol, whereClause, "clear", null)}
                    style={{...chipStyle(false),opacity:canBulkEdit ? 1 : 0.4,cursor:canBulkEdit ? "pointer" : "not-allowed"}}>
                    Clear
                  </button>
                  <span style={{fontSize: T.caption.fontSize,color:C.textMuted,fontFamily: T.code.fontFamily}}>
                    affects {filteredRows.length.toLocaleString()}
                  </span>
                </>
              )}
            </div>
          )}

          {editPanel === "add" && (
            <div style={{display:"flex",alignItems:"center",gap:7,flexWrap:"wrap"}}>
              {onAddColumn && (
                <>
                  <span style={{fontSize: T.caption.fontSize,color:C.teal,fontFamily: T.code.fontFamily}}>+ Column</span>
                  <input value={newColName} onChange={e => setNewColName(e.target.value)}
                    placeholder="name" style={{...controlStyle,width:130}}/>
                  <select value={newColType} onChange={e => setNewColType(e.target.value)} style={controlStyle}>
                    <option value="string">string</option>
                    <option value="number">number</option>
                  </select>
                  <input value={newColFill} onChange={e => setNewColFill(e.target.value)}
                    placeholder="fill" style={{...controlStyle,width:120}}/>
                  <button disabled={!newColName.trim()} onClick={() => onAddColumn(newColName.trim(), newColFill, newColType)}
                    style={{...chipStyle(true),opacity:newColName.trim() ? 1 : 0.4,cursor:newColName.trim() ? "pointer" : "not-allowed"}}>
                    Add
                  </button>
                </>
              )}
              {onAddRow && (
                <>
                  <span style={{fontSize: T.caption.fontSize,color:C.border2,fontFamily: T.code.fontFamily}}>|</span>
                  <span style={{fontSize: T.caption.fontSize,color:C.teal,fontFamily: T.code.fontFamily}}>+ Row</span>
                  <input type="number" min="1" value={rowCount} onChange={e => setRowCount(e.target.value)}
                    style={{...controlStyle,width:58}}/>
                  <button onClick={() => onAddRow({}, Math.max(1, Number(rowCount) || 1))} style={chipStyle(true)}>
                    Add
                  </button>
                </>
              )}
            </div>
          )}

          {editPanel === "replace" && onReplace && (
            <div style={{display:"flex",alignItems:"center",gap:7,flexWrap:"wrap"}}>
              <select value={replaceCol} onChange={e => setReplaceCol(e.target.value)} style={{...controlStyle,maxWidth:150}}>
                {editableHeaders.map(h => <option key={h} value={h}>{h}</option>)}
              </select>
              {["exact","contains","regex"].map(mode => (
                <button key={mode} onClick={() => setReplaceMode(mode)} style={chipStyle(replaceMode === mode)}>
                  {mode}
                </button>
              ))}
              <input value={replaceFind} onChange={e => setReplaceFind(e.target.value)}
                placeholder="find" style={{...controlStyle,width:130}}/>
              <input value={replaceWith} onChange={e => setReplaceWith(e.target.value)}
                placeholder="replace" style={{...controlStyle,width:130}}/>
              <input value={replaceNewCol} onChange={e => setReplaceNewCol(e.target.value)}
                placeholder="new column" style={{...controlStyle,width:130}}/>
              <button disabled={!replaceCol || !replaceFind} onClick={() => onReplace(replaceCol, { mode: replaceMode, find: replaceFind }, replaceWith, replaceNewCol)}
                style={{...chipStyle(true),opacity:(replaceCol && replaceFind) ? 1 : 0.4,cursor:(replaceCol && replaceFind) ? "pointer" : "not-allowed"}}>
                Apply
              </button>
            </div>
          )}

          {editPanel === "splice" && onStrSplice && (
            <div style={{display:"flex",alignItems:"center",gap:7,flexWrap:"wrap"}}>
              <select value={spliceCol} onChange={e => setSpliceCol(e.target.value)} style={{...controlStyle,maxWidth:150}}>
                {editableHeaders.map(h => <option key={h} value={h}>{h}</option>)}
              </select>
              {["insert","delete","overwrite"].map(mode => (
                <button key={mode} onClick={() => setSpliceMode(mode)} style={chipStyle(spliceMode === mode)}>
                  {mode}
                </button>
              ))}
              <input type="number" value={splicePos} onChange={e => setSplicePos(e.target.value)}
                style={{...controlStyle,width:68}}/>
              <input value={spliceText} onChange={e => setSpliceText(e.target.value)}
                placeholder="text" disabled={spliceMode === "delete"} style={{...controlStyle,width:120,opacity:spliceMode === "delete" ? 0.55 : 1}}/>
              <input type="number" min="0" value={spliceCount} onChange={e => setSpliceCount(e.target.value)}
                style={{...controlStyle,width:68}}/>
              <input value={spliceNewCol} onChange={e => setSpliceNewCol(e.target.value)}
                placeholder="new column" style={{...controlStyle,width:130}}/>
              <span style={{fontSize: T.caption.fontSize,color:C.textMuted,fontFamily: T.code.fontFamily}}>1-based; -1=end</span>
              <button disabled={!spliceCol} onClick={() => onStrSplice(spliceCol, Number(splicePos), spliceMode, spliceText, Number(spliceCount) || 0, spliceNewCol)}
                style={{...chipStyle(true),opacity:spliceCol ? 1 : 0.4,cursor:spliceCol ? "pointer" : "not-allowed"}}>
                Apply
              </button>
            </div>
          )}
        </div>
      )}

      <div style={{display:"flex",flex:1,minHeight:0}}>
        {/* Grid */}
        <div style={{flex:1,overflow:"auto",minHeight:0}}>
          <table style={{borderCollapse:"collapse",fontFamily: T.code.fontFamily,fontSize: T.caption.fontSize,minWidth:"100%"}}>
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
                        <span style={{fontSize: T.caption.fontSize,color: selCol===h ? C.teal : C.textMuted,
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
                    {visHeaders.map(h => {
                      const isEditing = editingCell != null
                        && row.__ri != null
                        && editingCell.ri === row.__ri
                        && editingCell.col === h;
                      return (
                        <td key={h}
                          onDoubleClick={() => {
                            if (editMode && !isEditing) startEdit(row.__ri, h, row[h]);
                          }}
                          style={{
                            padding: isEditing ? "1px 4px" : "3px 10px",
                            borderRight:`1px solid ${C.border}`,
                            color: selCol===h ? C.text : C.textDim,
                            background: isEditing ? `${C.teal}15` : selCol===h ? `${C.teal}08` : "transparent",
                            whiteSpace:"nowrap", maxWidth:200, overflow:"hidden", textOverflow:"ellipsis",
                            fontVariantNumeric:"tabular-nums",
                            cursor: editMode ? "text" : undefined,
                            userSelect: editMode ? "none" : undefined,
                          }}>
                          {isEditing ? (
                            <input
                              autoFocus
                              type={numCols.has(h) ? "number" : "text"}
                              value={editValue}
                              onChange={e => setEditValue(e.target.value)}
                              onKeyDown={e => {
                                if (e.key === "Escape") {
                                  e.preventDefault();
                                  setEditingCell(null);
                                  return;
                                }
                                if (e.key === "Enter") {
                                  e.preventDefault();
                                  handleCommit(row.__ri, h, editValue);
                                  return;
                                }
                                if (e.key === "Tab") {
                                  e.preventDefault();
                                  handleCommit(row.__ri, h, editValue);
                                  const ni = visHeaders.indexOf(h) + (e.shiftKey ? -1 : 1);
                                  if (ni >= 0 && ni < visHeaders.length) {
                                    const nc = visHeaders[ni];
                                    startEdit(row.__ri, nc, row[nc]);
                                  }
                                  return;
                                }
                                if (e.key === "ArrowDown" && i < pageRows.length - 1) {
                                  e.preventDefault();
                                  handleCommit(row.__ri, h, editValue);
                                  const nr = pageRows[i + 1];
                                  startEdit(nr.__ri, h, nr[h]);
                                  return;
                                }
                                if (e.key === "ArrowUp" && i > 0) {
                                  e.preventDefault();
                                  handleCommit(row.__ri, h, editValue);
                                  const pr = pageRows[i - 1];
                                  startEdit(pr.__ri, h, pr[h]);
                                  return;
                                }
                              }}
                              onBlur={e => handleCommit(row.__ri, h, e.target.value)}
                              style={{
                                width: "100%", minWidth: 60,
                                background: "transparent",
                                border: "none", outline: "none",
                                color: C.teal,
                                fontFamily: T.code.fontFamily, fontSize: T.caption.fontSize,
                                padding: "2px 6px",
                              }}
                            />
                          ) : fmt(row[h])}
                        </td>
                      );
                    })}
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>

        {/* Column stats panel */}
        {selCol && stats && (
          <div style={{width:200,flexShrink:0,borderLeft:`1px solid ${C.border2}`,
                       background:C.surface,padding:"0.8rem",overflowY:"auto",fontFamily: T.code.fontFamily}}>
            <div style={{fontSize: T.caption.fontSize,color:C.teal,letterSpacing:"0.18em",textTransform:"uppercase",marginBottom:8}}>{selCol}</div>
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
                      <span style={{fontSize: T.caption.fontSize,color:C.textMuted}}>{l}</span>
                      <span style={{fontSize: T.caption.fontSize,color:C.text}}>{v}</span>
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
                      <span style={{fontSize: T.caption.fontSize,color:C.textMuted}}>{l}</span>
                      <span style={{fontSize: T.caption.fontSize,color:C.text}}>{v}</span>
                    </div>
                  ))}
                  <div style={{marginTop:6}}>
                    <div style={{fontSize: T.caption.fontSize,color:C.textMuted,marginBottom:4}}>Top values</div>
                    {stats.top.map(([val, cnt]) => (
                      <div key={val} style={{display:"flex",justifyContent:"space-between",marginBottom:2}}>
                        <span style={{fontSize: T.caption.fontSize,color:C.textDim,maxWidth:110,overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}}>{val}</span>
                        <span style={{fontSize: T.caption.fontSize,color:C.textMuted}}>{cnt}</span>
                      </div>
                    ))}
                  </div>
                </>
              )}
            </div>
            <button onClick={() => setSelCol(null)}
              style={{marginTop:14,fontSize: T.caption.fontSize,color:C.textMuted,background:"none",border:"none",
                      cursor:"pointer",fontFamily: T.code.fontFamily,padding:0}}>✕ close</button>
          </div>
        )}
      </div>
    </div>
  );
}

// ─── COLUMN META TABLE ────────────────────────────────────────────────────────
// Renders a compact column-by-column info table: name, type, non-null %, range/top.
function ColumnMetaTable({ rows, headers, colInfo }) {
  const { C, T } = useTheme();
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
    <table style={{width:"100%",borderCollapse:"collapse",fontFamily: T.code.fontFamily,fontSize: T.caption.fontSize}}>
      <thead>
        <tr style={{background:C.surface2}}>
          {["Column","Type","Non-null","Summary"].map(h=>(
            <th key={h} style={{padding:"5px 10px",textAlign:"left",fontWeight:500,
                                color:C.textMuted,fontSize: T.caption.fontSize,letterSpacing:"0.1em",
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
                <span style={{fontSize: T.caption.fontSize,color:typeColor(m.type),border:`1px solid ${typeColor(m.type)}40`,
                              borderRadius:2,padding:"1px 5px"}}>{m.type}</span>
              </td>
              <td style={{padding:"5px 10px",color: m.nullPct>0 ? C.gold : C.textDim}}>
                {100-m.nullPct}%
                {m.nullPct>0 && <span style={{fontSize: T.caption.fontSize,color:C.gold,marginLeft:4}}>({m.nullPct}% NA)</span>}
              </td>
              <td style={{padding:"5px 10px",color:C.textMuted,fontSize: T.caption.fontSize}}>
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
                          <div style={{fontSize: T.caption.fontSize,color:C.textMuted,letterSpacing:"0.1em",textTransform:"uppercase",marginBottom:2}}>{l}</div>
                          <div style={{fontSize: T.code.fontSize,color:C.text}}>{v}</div>
                        </div>
                      ))}
                    </div>
                  ) : (
                    <div>
                      <div style={{fontSize: T.caption.fontSize,color:C.textMuted,letterSpacing:"0.1em",textTransform:"uppercase",marginBottom:6}}>Top values</div>
                      <div style={{display:"flex",gap:6,flexWrap:"wrap"}}>
                        {m.top.map(([val,cnt])=>(
                          <span key={val} style={{fontSize: T.caption.fontSize,padding:"2px 8px",border:`1px solid ${C.border2}`,
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
function DataTab({ filename, studioRef, cleanedData, availableDatasets = [], activeDatasetId, onSelectDataset, onDeleteDataset, onRenameDataset }) {
  const { C, T } = useTheme();
  const formats  = ["CSV","TSV","XLSX","XLS","JSON","DTA","RDS","DBF","SHP","ZIP"];
  const fileRef  = useRef();
  const [loading,   setLoading]   = useState(false);
  const [err,       setErr]       = useState("");
  const [success,   setSuccess]   = useState("");
  const [wbOpen,    setWbOpen]    = useState(false);
  const [oecdOpen,  setOecdOpen]  = useState(false);
  const [obsOpen,   setObsOpen]   = useState(false);
  const [preloadedOpen, setPreloadedOpen] = useState(false);
  const [dragOver,  setDragOver]  = useState(false);
  const [view,      setView]      = useState("overview"); // "overview" | "grid"
  const [renamingId, setRenamingId] = useState(null);     // dataset being renamed inline
  const [renameVal,  setRenameVal]  = useState("");

  // The active dataset (from the availableDatasets mirror) is the display source.
  const activeDs    = availableDatasets.find(d => d.id === activeDatasetId) ?? null;
  // Cleaned pipeline output takes priority; the active dataset's raw rows are the fallback.
  const viewRows    = cleanedData?.cleanRows ?? activeDs?.rows ?? [];
  const viewHeaders = cleanedData?.headers   ?? activeDs?.headers ?? [];
  const viewFile    = cleanedData?.filename  ?? activeDs?.filename ?? filename ?? "dataset";
  const isPipelined = !!cleanedData;
  const hasData     = !!(activeDs || cleanedData);

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

  async function handleFile(fileOrList) {
    // Accept either a single File (legacy) or a FileList / array.
    const list = fileOrList && fileOrList.length !== undefined && !(fileOrList instanceof File)
      ? Array.from(fileOrList)
      : [fileOrList].filter(Boolean);
    if (!list.length) return;
    setLoading(true); setErr(""); setSuccess("");
    try {
      // parseFiles groups shapefile siblings (.shp+.dbf+.prj) into one dataset
      // so the user can drop the whole shapefile at once instead of zipping it.
      const { parseFiles } = await import("./DataStudio.jsx");
      const results = await parseFiles(list);
      const ok     = results.filter(r => r.parsed);
      const errors = results.filter(r => r.error);
      if (!ok.length) {
        throw new Error(errors.map(e => `${e.filename}: ${e.error}`).join("; ") || "No files could be parsed.");
      }

      const firstName = ok[0].filename;

      // Every parsed entry goes through the same add path — no privileged
      // primary. studioRef may not be mounted on the very first load, so wait
      // a frame for the ref to settle (DataStudio is always mounted now).
      if (!studioRef.current) await new Promise(r => requestAnimationFrame(r));
      for (const r of ok) {
        if (studioRef.current?.addParsed) studioRef.current.addParsed(r.filename, r.parsed);
      }

      const errSuffix = errors.length ? ` (${errors.length} failed)` : "";
      setSuccess(ok.length === 1
        ? `"${firstName}" loaded.${errSuffix}`
        : `Loaded ${ok.length} datasets.${errSuffix}`);
      if (errors.length) {
        setErr(errors.map(e => `${e.filename}: ${e.error}`).join("; "));
      }
    } catch (e) {
      setErr("Parse error: " + (e?.message || "unknown"));
    }
    setLoading(false);
  }

  async function handlePreloaded(ds) {
    setLoading(true); setErr(""); setSuccess("");
    try {
      const res = await fetch(ds.url);
      if (!res.ok) throw new Error(`Could not load ${ds.filename} (${res.status})`);
      const blob = await res.blob();
      const file = new File([blob], ds.filename, { type: "text/csv" });
      const parsed = await parseFileForPrimary(file);
      if (!parsed?.headers?.length || !parsed?.rows?.length) throw new Error("Dataset is empty or could not be parsed.");

      if (!studioRef.current) await new Promise(r => requestAnimationFrame(r));
      studioRef.current?.addParsed?.(ds.filename, parsed);
      setSuccess(`"${ds.filename}" loaded — visible in Dataset Manager.`);
      setPreloadedOpen(false);
    } catch (e) {
      setErr("Preloaded dataset error: " + (e?.message || "unknown"));
    }
    setLoading(false);
  }

  return (
    <div style={{display:"flex",flexDirection:"column",height:"100%",fontFamily: T.code.fontFamily,color:C.text}}>
      {/* Sub-tab bar */}
      <div style={{display:"flex",gap:0,borderBottom:`1px solid ${C.border}`,background:C.surface2,flexShrink:0}}>
        {[["overview","Overview"],["grid","Data Viewer"]].map(([id,label]) => (
          <button key={id} onClick={() => setView(id)} style={{
            padding:"0.5rem 1rem", background:"transparent", border:"none",
            borderBottom: view===id ? `2px solid ${C.teal}` : "2px solid transparent",
            color: view===id ? C.teal : C.textDim,
            fontFamily: T.code.fontFamily, fontSize: T.caption.fontSize, cursor:"pointer", letterSpacing:"0.1em",
          }}>{label}</button>
        ))}
        {view==="grid" && isPipelined && (
          <span style={{marginLeft:8,alignSelf:"center",fontSize: T.caption.fontSize,color:C.teal,
                        border:`1px solid ${C.teal}40`,borderRadius:2,padding:"1px 6px"}}>
            pipeline applied
          </span>
        )}
      </div>

      {/* Overview panel */}
      {view === "overview" && !hasData && (
        /* ── No data state: show a centered load prompt ── */
        <div style={{flex:1,display:"flex",alignItems:"center",justifyContent:"center",padding:"2rem"}}>
          <div style={{maxWidth:460,width:"100%",display:"flex",flexDirection:"column",gap:20}}>
            <div>
              <div style={{fontSize: T.caption.fontSize,color:C.teal,letterSpacing:"0.22em",textTransform:"uppercase",marginBottom:8}}>
                Data · Load dataset
              </div>
              <div style={{fontSize: T.h2.fontSize,color:C.text,marginBottom:6}}>Load your first dataset</div>
              <div style={{fontSize: T.caption.fontSize,color:C.textMuted,lineHeight:1.7}}>
                Drop a file below, fetch from World Bank / OECD, or use the Simulate tab to generate synthetic data.
              </div>
            </div>

            {/* Big drop zone */}
            <div
              onDragOver={e=>{e.preventDefault();setDragOver(true);}}
              onDragLeave={()=>setDragOver(false)}
              onDrop={e=>{e.preventDefault();setDragOver(false);handleFile(e.dataTransfer.files);}}
              onClick={()=>fileRef.current?.click()}
              style={{
                border:`2px dashed ${dragOver ? C.gold : C.teal}40`,
                borderRadius:6, padding:"2.5rem 1.5rem", textAlign:"center",
                cursor:"pointer", background: dragOver ? C.goldFaint : `${C.teal}06`,
                transition:"all 0.15s",
              }}>
              <input ref={fileRef} type="file" multiple
                accept=".csv,.tsv,.txt,.json,.xlsx,.xls,.dta,.rds,.dbf,.shp,.prj,.shx,.cpg,.parquet,.zip"
                onChange={e=>handleFile(e.target.files)} style={{display:"none"}}/>
              {loading
                ? <div style={{fontSize: T.code.fontSize,color:C.textDim}}>Parsing…</div>
                : <>
                    <div style={{fontSize: T.display.fontSize,color:C.teal,marginBottom:8,opacity:0.6}}>↑</div>
                    <div style={{fontSize: T.code.fontSize,color:C.textDim,marginBottom:4}}>Drop file(s) or click to browse</div>
                    <div style={{fontSize: T.caption.fontSize,color:C.textMuted}}>CSV · TSV · XLSX · JSON · Stata · R .rds · Shapefile (.shp+.dbf+.prj or .zip)</div>
                  </>
              }
            </div>
            {err && <div style={{fontSize: T.caption.fontSize,color:C.red,fontFamily: T.code.fontFamily}}>{err}</div>}
            {success && <div style={{fontSize: T.caption.fontSize,color:C.teal,fontFamily: T.code.fontFamily}}>{success}</div>}

            {/* Or: World Bank / OECD */}
            <div style={{display:"flex",gap:8}}>
              <button onClick={()=>setWbOpen(true)}
                style={{flex:1,padding:"0.5rem",borderRadius:3,cursor:"pointer",background:"transparent",
                        border:`1px solid ${C.border2}`,color:C.textDim,fontFamily: T.code.fontFamily,fontSize: T.caption.fontSize}}>
                World Bank ↗
              </button>
              <button onClick={()=>setOecdOpen(true)}
                style={{flex:1,padding:"0.5rem",borderRadius:3,cursor:"pointer",background:"transparent",
                        border:`1px solid ${C.border2}`,color:C.textDim,fontFamily: T.code.fontFamily,fontSize: T.caption.fontSize}}>
                OECD ↗
              </button>
            </div>
            <div style={{display:"flex",flexDirection:"column",gap:5}}>
              <button onClick={()=>setPreloadedOpen(o=>!o)}
                style={{padding:"0.5rem",borderRadius:3,cursor:"pointer",background:"transparent",
                        border:`1px solid ${C.border2}`,color:C.textDim,fontFamily: T.code.fontFamily,fontSize: T.caption.fontSize,
                        textAlign:"left"}}>
                {preloadedOpen ? "v" : ">"} Preloaded datasets
              </button>
              {preloadedOpen && (
                <div style={{display:"flex",flexDirection:"column",gap:4}}>
                  {PRELOADED_DATASETS.map(ds => (
                    <button key={ds.id} onClick={()=>handlePreloaded(ds)} disabled={loading}
                      style={{padding:"0.45rem 0.6rem",borderRadius:3,cursor:loading?"not-allowed":"pointer",
                              background:C.surface,border:`1px solid ${C.border2}`,color:C.textDim,
                              fontFamily: T.code.fontFamily,fontSize: T.caption.fontSize,textAlign:"left"}}>
                      <div style={{color:C.text}}>{ds.label}</div>
                      <div style={{fontSize: T.caption.fontSize,color:C.textMuted,marginTop:2}}>{ds.hint}</div>
                    </button>
                  ))}
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      {view === "overview" && hasData && (
        <div style={{display:"flex",flex:1,minHeight:0,overflow:"hidden"}}>

          {/* ── Left column: dataset info + column table ── */}
          <div style={{flex:1,minWidth:0,overflowY:"auto",padding:"1.6rem 2rem"}}>

            {/* Dataset selector — shown when multiple datasets are loaded */}
            {availableDatasets.length > 1 && (
              <div style={{marginBottom:"1.4rem"}}>
                <div style={{fontSize: T.caption.fontSize,color:C.textMuted,letterSpacing:"0.18em",textTransform:"uppercase",marginBottom:8}}>Session datasets</div>
                <div style={{display:"flex",flexDirection:"column",gap:4}}>
                  {availableDatasets.map((ds) => {
                    const isActive  = ds.id === activeDatasetId;
                    const dsLabel   = ds.name ?? ds.filename ?? ds.id;
                    const isRenamed = ds.name && ds.name !== ds.filename;
                    const renaming  = renamingId === ds.id;
                    const commitRename = () => {
                      const v = renameVal.trim();
                      if (v && v !== dsLabel) onRenameDataset?.(ds.id, v);
                      setRenamingId(null);
                    };
                    return (
                      <div key={ds.id} style={{display:"flex",alignItems:"center",gap:4}}>
                        <button onClick={() => onSelectDataset?.(ds.id)}
                          style={{display:"flex",alignItems:"center",gap:8,padding:"0.45rem 0.75rem",
                                  flex:1,minWidth:0,
                                  background: isActive ? `${C.teal}12` : C.surface,
                                  border:`1px solid ${isActive ? C.teal+"60" : C.border2}`,
                                  borderRadius:3,cursor:"pointer",textAlign:"left",fontFamily: T.code.fontFamily,
                                  transition:"all 0.12s"}}>
                          <span style={{fontSize: T.caption.fontSize,color: isActive ? C.teal : C.textMuted}}>
                            {isActive ? "●" : "○"}
                          </span>
                          {renaming ? (
                            <input
                              autoFocus
                              value={renameVal}
                              onChange={e => setRenameVal(e.target.value)}
                              onClick={e => e.stopPropagation()}
                              onKeyDown={e => {
                                if (e.key === "Enter")  commitRename();
                                if (e.key === "Escape") setRenamingId(null);
                              }}
                              onBlur={commitRename}
                              style={{flex:1,minWidth:0,background:C.bg,border:`1px solid ${C.teal}60`,
                                      borderRadius:2,padding:"1px 6px",color:C.text,
                                      fontFamily: T.code.fontFamily,fontSize: T.caption.fontSize,outline:"none"}}
                            />
                          ) : (
                            <span style={{fontSize: T.caption.fontSize,color: isActive ? C.text : C.textDim,flex:1,
                                          overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}}
                                  title={isRenamed ? `file: ${ds.filename}` : undefined}>
                              {dsLabel}
                              {isRenamed && (
                                <span style={{color:C.textMuted}}> · {ds.filename}</span>
                              )}
                            </span>
                          )}
                          {ds.rowCount && !renaming && (
                            <span style={{fontSize: T.caption.fontSize,color:C.textMuted,flexShrink:0}}>
                              {ds.rowCount.toLocaleString()} × {ds.colCount ?? "?"}
                            </span>
                          )}
                        </button>
                        <button
                          onClick={() => { setRenamingId(ds.id); setRenameVal(dsLabel); }}
                          title="Rename dataset (sets the data-frame name in replication scripts)"
                          style={{flexShrink:0,width:20,height:20,display:"flex",alignItems:"center",
                                  justifyContent:"center",background:"transparent",border:"none",
                                  cursor:"pointer",color:C.textMuted,fontSize: T.caption.fontSize,lineHeight:1,
                                  borderRadius:2,transition:"color 0.1s"}}
                          onMouseEnter={e => e.currentTarget.style.color = C.teal}
                          onMouseLeave={e => e.currentTarget.style.color = C.textMuted}
                        >✎</button>
                        <button
                          onClick={() => onDeleteDataset?.(ds.id)}
                          title="Remove dataset"
                          style={{flexShrink:0,width:20,height:20,display:"flex",alignItems:"center",
                                  justifyContent:"center",background:"transparent",border:"none",
                                  cursor:"pointer",color:C.textMuted,fontSize: T.body.fontSize,lineHeight:1,
                                  borderRadius:2,transition:"color 0.1s"}}
                          onMouseEnter={e => e.currentTarget.style.color = C.text}
                          onMouseLeave={e => e.currentTarget.style.color = C.textMuted}
                        >×</button>
                      </div>
                    );
                  })}
                </div>
              </div>
            )}

            {/* Active dataset card */}
            {hasData && (
              <div style={{border:`1px solid ${C.border2}`,borderRadius:4,overflow:"hidden",marginBottom:"1.6rem"}}>
                {/* Header */}
                <div style={{background:C.surface2,padding:"0.6rem 0.9rem",display:"flex",alignItems:"center",gap:8,borderBottom:`1px solid ${C.border}`}}>
                  <span style={{fontSize: T.caption.fontSize,color:C.teal}}>●</span>
                  <span style={{fontSize: T.code.fontSize,color:C.text}}>{viewFile}</span>
                  {isPipelined && (
                    <span style={{fontSize: T.caption.fontSize,color:C.teal,border:`1px solid ${C.teal}40`,borderRadius:2,padding:"1px 5px"}}>pipeline applied</span>
                  )}
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
                      <div style={{fontSize: T.caption.fontSize,color:C.textMuted,letterSpacing:"0.12em",textTransform:"uppercase",marginBottom:2}}>{s.l}</div>
                      <div style={{fontSize: T.body.fontSize,color:s.c}}>{s.v}</div>
                    </div>
                  ))}
                </div>

                {/* Panel info if available */}
                {cleanedData?.panelIndex && (
                  <div style={{padding:"0.45rem 0.9rem",background:C.surface,borderTop:`1px solid ${C.border}`,
                               display:"flex",gap:16,alignItems:"center"}}>
                    <span style={{fontSize: T.caption.fontSize,color:C.blue,border:`1px solid ${C.blue}40`,borderRadius:2,padding:"1px 5px"}}>Panel</span>
                    <span style={{fontSize: T.caption.fontSize,color:C.textMuted}}>Entity: <span style={{color:C.textDim}}>{cleanedData.panelIndex.entityCol}</span></span>
                    <span style={{fontSize: T.caption.fontSize,color:C.textMuted}}>Time: <span style={{color:C.textDim}}>{cleanedData.panelIndex.timeCol}</span></span>
                    {cleanedData.panelIndex.balance && (
                      <span style={{fontSize: T.caption.fontSize,color:C.textMuted}}>Balance: <span style={{color:C.textDim}}>{cleanedData.panelIndex.balance}</span></span>
                    )}
                  </div>
                )}

                {/* View data button */}
                <div style={{padding:"0.4rem 0.9rem",background:C.surface,borderTop:`1px solid ${C.border}`,display:"flex",gap:8}}>
                  <button onClick={() => setView("grid")}
                    style={{padding:"3px 12px",background:`${C.teal}14`,border:`1px solid ${C.teal}60`,
                            borderRadius:3,color:C.teal,cursor:"pointer",fontFamily: T.code.fontFamily,fontSize: T.caption.fontSize}}>
                    View data ›
                  </button>
                </div>
              </div>
            )}

            {/* Column metadata table */}
            {viewHeaders.length > 0 && (
              <div style={{marginBottom:"1.6rem"}}>
                <div style={{fontSize: T.caption.fontSize,color:C.textMuted,letterSpacing:"0.18em",textTransform:"uppercase",marginBottom:10}}>
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
            <div style={{fontSize: T.caption.fontSize,color:C.textMuted,letterSpacing:"0.18em",textTransform:"uppercase",marginBottom:12}}>Load data</div>

            {/* Drop zone */}
            <div
              onDragOver={e=>{e.preventDefault();setDragOver(true);}}
              onDragLeave={()=>setDragOver(false)}
              onDrop={e=>{e.preventDefault();setDragOver(false);handleFile(e.dataTransfer.files);}}
              onClick={()=>fileRef.current?.click()}
              style={{border:`2px dashed ${dragOver ? C.gold : C.border2}`,borderRadius:4,
                      padding:"1rem 0.75rem",textAlign:"center",cursor:"pointer",
                      background: dragOver ? C.goldFaint : "transparent",
                      transition:"all 0.15s",marginBottom:10}}>
              <input ref={fileRef} type="file" multiple
                accept=".csv,.tsv,.txt,.json,.xlsx,.xls,.dta,.rds,.dbf,.shp,.prj,.shx,.cpg,.parquet,.zip"
                onChange={e=>handleFile(e.target.files)}
                style={{display:"none"}}/>
              {loading
                ? <div style={{fontSize: T.caption.fontSize,color:C.textDim,fontFamily: T.code.fontFamily}}>Parsing…</div>
                : <>
                    <div style={{fontSize: T.caption.fontSize,color:C.text,marginBottom:2}}>+ Load dataset(s)</div>
                    <div style={{fontSize: T.caption.fontSize,color:C.textMuted}}>Drop file(s) or click — supports .shp+.dbf+.prj</div>
                  </>
              }
            </div>

            {/* API fetchers */}
            <div style={{display:"flex",flexDirection:"column",gap:5,marginBottom:14}}>
              {[
                {label:"↓ World Bank data", color:C.teal, action:()=>setWbOpen(true)},
                {label:"↓ OECD data",       color:C.blue, action:()=>setOecdOpen(true)},
                {label:"↓ Observatorio (femicidios)", color:C.gold, action:()=>setObsOpen(true)},
              ].map(({label,color,action})=>(
                <button key={label} onClick={action} style={{
                  padding:"0.4rem 0.65rem",background:"transparent",
                  border:`1px solid ${C.border2}`,borderRadius:3,
                  color:C.textDim,cursor:"pointer",fontFamily: T.code.fontFamily,fontSize: T.caption.fontSize,
                  textAlign:"left",transition:"all 0.12s",
                }}
                  onMouseEnter={e=>{e.currentTarget.style.borderColor=color;e.currentTarget.style.color=color;}}
                  onMouseLeave={e=>{e.currentTarget.style.borderColor=C.border2;e.currentTarget.style.color=C.textDim;}}
                >{label}</button>
              ))}
              <button onClick={()=>setPreloadedOpen(o=>!o)} style={{
                padding:"0.4rem 0.65rem",background:"transparent",
                border:`1px solid ${C.border2}`,borderRadius:3,
                color:C.textDim,cursor:"pointer",fontFamily: T.code.fontFamily,fontSize: T.caption.fontSize,
                textAlign:"left",transition:"all 0.12s",
              }}>
                {preloadedOpen ? "v" : ">"} Preloaded datasets
              </button>
              {preloadedOpen && (
                <div style={{display:"flex",flexDirection:"column",gap:4,paddingLeft:6}}>
                  {PRELOADED_DATASETS.map(ds => (
                    <button key={ds.id} onClick={()=>handlePreloaded(ds)} disabled={loading}
                      style={{padding:"0.38rem 0.55rem",background:C.surface2,
                              border:`1px solid ${C.border2}`,borderRadius:3,
                              color:C.textDim,cursor:loading?"not-allowed":"pointer",
                              fontFamily: T.code.fontFamily,fontSize: T.caption.fontSize,textAlign:"left"}}>
                      <div style={{color:C.text}}>{ds.label}</div>
                      <div style={{fontSize: T.caption.fontSize,color:C.textMuted,marginTop:2,lineHeight:1.4}}>{ds.hint}</div>
                    </button>
                  ))}
                </div>
              )}
            </div>

            {/* Accepted formats */}
            <div style={{fontSize: T.caption.fontSize,color:C.textMuted,letterSpacing:"0.14em",textTransform:"uppercase",marginBottom:6}}>Formats</div>
            <div style={{display:"flex",flexWrap:"wrap",gap:4,marginBottom:10}}>
              {formats.map(f=>(
                <span key={f} style={{fontSize: T.caption.fontSize,padding:"2px 6px",border:`1px solid ${C.border2}`,borderRadius:2,color:C.textMuted}}>{f}</span>
              ))}
            </div>
            <div style={{fontSize: T.caption.fontSize,color:C.textMuted,lineHeight:1.7}}>
              Auto-delimiter detection (CSV / TSV / pipe).<br/>
              Additional datasets can be joined in Clean.
            </div>

            {/* Status */}
            {success && (
              <div style={{marginTop:10,fontSize: T.caption.fontSize,color:C.green,fontFamily: T.code.fontFamily,padding:"0.4rem 0.6rem",
                           border:`1px solid ${C.green}40`,borderRadius:3}}>✓ {success}</div>
            )}
            {err && (
              <div style={{marginTop:10,fontSize: T.caption.fontSize,color:C.red,fontFamily: T.code.fontFamily,padding:"0.4rem 0.6rem",
                           border:`1px solid ${C.red}40`,borderRadius:3}}>{err}</div>
            )}
          </div>
        </div>
      )}

      {/* Data Viewer grid */}
      {view === "grid" && viewRows.length > 0 && (
        <DataViewer
          rows={viewRows}
          headers={viewHeaders}
          filename={viewFile}
          onPatch={(ri, col, value) => studioRef.current?.addPatchStep?.(ri, col, value)}
          onFillColumn={(col, op, text) => studioRef.current?.addFillColumnStep?.(col, op, text)}
          onAddColumn={(nn, fill, dtype) => studioRef.current?.addColumnStep?.(nn, fill, dtype)}
          onAddRow={(values, count) => studioRef.current?.addRowStep?.(values, count)}
          onSetWhere={(col, where, action, value) => studioRef.current?.addSetWhereStep?.(col, where, action, value)}
          onReplace={(col, match, replaceWith, nn) => studioRef.current?.addReplaceStep?.(col, match, replaceWith, nn)}
          onStrSplice={(col, position, mode, text, count, nn) => studioRef.current?.addStrSpliceStep?.(col, position, mode, text, count, nn)}
          duckdbMeta={cleanedData?._duckdb ?? activeDs?._duckdb ?? null}
        />
      )}
      {view === "grid" && viewRows.length === 0 && (
        <div style={{padding:"3rem",color:C.textMuted,fontSize: T.code.fontSize,textAlign:"center",fontFamily: T.code.fontFamily}}>
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
      {obsOpen && (
        <ObservatorioFetcher
          onLoad={(fname, rows, headers) => {
            studioRef.current?.addApiData(fname, rows, headers);
            setObsOpen(false);
            setSuccess(`"${fname}" loaded — visible in Dataset Manager.`);
          }}
          onClose={() => setObsOpen(false)}
        />
      )}
    </div>
  );
}

// Placeholder for tabs not yet implemented (Simulate, Calculate, Report).
function ComingSoon({ tab }) {
  const { C, T } = useTheme();
  const labels = { simulate:"Simulate", calculate:"Calculate", report:"Report" };
  const descs  = {
    simulate:  "Build data generating processes, run Monte Carlo simulations, power analysis.",
    calculate: "Define scalars, vectors, and expressions. Create datasets from scratch.",
    report:    "Publication-ready output: LaTeX tables, AI narratives, and unified script export.",
  };
  return (
    <div style={{display:"flex",flexDirection:"column",alignItems:"center",justifyContent:"center",height:"100%",gap:10,fontFamily: T.code.fontFamily}}>
      <div style={{fontSize: T.caption.fontSize,color:C.teal,letterSpacing:"0.26em",textTransform:"uppercase"}}>{labels[tab] || tab}</div>
      <div style={{fontSize: T.code.fontSize,color:C.textDim,maxWidth:360,textAlign:"center",lineHeight:1.7}}>{descs[tab] || "Coming soon."}</div>
      <div style={{fontSize: T.caption.fontSize,color:C.textMuted,marginTop:4}}>Phase 9 — in development</div>
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
      crs:      rawData._crs ?? null,
    });
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  return null;
}

// ─── PROJECT DASHBOARD ────────────────────────────────────────────────────────
// Reads from IndexedDB (async). Layout: project list left, actions right.
// Mirrors R/Gretl workspace model — projects are first-class, datasets are children.

function Dashboard({onNew, onLoad}) {
  const { C, T, theme, setTheme } = useTheme();
  const { user } = useAuth();
  const [projects,    setProjects]    = useState([]);
  const [loading,     setLoading]     = useState(true);
  const [selected,    setSelected]    = useState(null);
  const [selPipeline, setSelPipeline] = useState(null); // pipeline record for pipeline steps preview
  const [renaming,    setRenaming]    = useState(null);  // pid being renamed
  const [renameVal,   setRenameVal]   = useState("");
  const [editingDesc, setEditingDesc] = useState(null);  // pid with open desc editor
  const [descVal,     setDescVal]     = useState("");

  // ── Cloud sync state ────────────────────────────────────────────────────────
  const [cloudProjects, setCloudProjects] = useState([]);
  const [cloudLoading,  setCloudLoading]  = useState(false);
  const [unlocked,      setUnlocked]      = useState(false);
  const [unlockPass,    setUnlockPass]    = useState("");
  const [cloudRenaming, setCloudRenaming] = useState(null);  // pid being renamed in cloud list
  const [cloudRenameVal,setCloudRenameVal]= useState("");
  const [unlockFile,    setUnlockFile]    = useState(""); // recovery key string
  const [unlockErr,     setUnlockErr]     = useState("");
  const [unlockBusy,    setUnlockBusy]    = useState(false);
  const [pulling,       setPulling]       = useState(new Set()); // pids currently being pulled
  const [pullErr,       setPullErr]       = useState("");
  const [sharedWithMe,  setSharedWithMe]  = useState([]);
  const [pullingShare,  setPullingShare]  = useState(new Set());
  const [shareErr,      setShareErr]      = useState("");
  // incoming share token from URL (?share=TOKEN)
  const [incomingToken, setIncomingToken] = useState(() => new URLSearchParams(window.location.search).get("share") ?? "");

  const fmt = ts => ts
    ? new Date(ts).toLocaleDateString("en-GB", {day:"2-digit",month:"short",year:"numeric",hour:"2-digit",minute:"2-digit"})
    : "—";

  useEffect(() => {
    listProjects().then(async list => {
      if (list.length === 0) {
        // Migration v3: first open after schema upgrade — promote all pipeline entries
        // that look like top-level projects (have a filename field).
        // This handles: proj_* IDs (new format), any other format that was used before.
        try {
          const pipes = await listPipelines();
          for (const p of pipes) {
            if (!p.id || !p.filename) continue; // skip bare/secondary entries
            // v4: primary dataset's steps live under datasetPipelines[p.id].steps.
            // Fall back to legacy p.pipeline so a partially-migrated DB still works.
            const primarySteps =
              p.datasetPipelines?.[p.id]?.steps
              || p.pipeline
              || [];
            await saveProject(p.id, {
              name:         (p.filename || "").replace(/\.[^.]+$/, "") || "Untitled",
              filename:     p.filename || "dataset.csv",
              rowCount:     p.rowCount ?? 0,
              colCount:     p.colCount ?? 0,
              datasetCount: 1 + primarySteps.filter(s => s.type === "join" || s.type === "append").length,
            });
          }
        } catch (e) {
          console.warn("[Projects] migration failed:", e);
        }
        const migrated = await listProjects();
        setProjects(migrated);
      } else {
        setProjects(list);
      }
      setLoading(false);
    }).catch(() => setLoading(false));
  }, []);

  // Cloud: fetch list + shared-with-me + check unlock state when user signs in/out.
  useEffect(() => {
    setUnlocked(hasSyncSession());
    if (!user) { setCloudProjects([]); setSharedWithMe([]); return; }
    setCloudLoading(true);
    Promise.all([
      listCloudProjects().catch(() => []),
      listSharedWithMe().catch(() => []),
    ]).then(([cloud, shared]) => {
      setCloudProjects(cloud ?? []);
      setSharedWithMe(shared ?? []);
    }).finally(() => setCloudLoading(false));
  }, [user?.id]);

  async function handlePullShare(token) {
    setShareErr("");
    setPullingShare(prev => new Set([...prev, token]));
    try {
      await pullShare(token);
      const updated = await listProjects();
      setProjects(updated);
      if (incomingToken === token) {
        setIncomingToken("");
        window.history.replaceState({}, "", window.location.pathname);
      }
    } catch (e) {
      setShareErr(e?.message ?? "Import failed.");
    } finally {
      setPullingShare(prev => { const n = new Set(prev); n.delete(token); return n; });
    }
  }

  async function handleUnlock() {
    setUnlockErr("");
    setUnlockBusy(true);
    try {
      const ok = await lockSession(unlockFile ? { recoveryKey: unlockFile } : { passphrase: unlockPass });
      if (ok) {
        setUnlocked(true);
        setUnlockPass("");
        setUnlockFile("");
      }
    } catch (e) {
      setUnlockErr(e?.message ?? "Unlock failed.");
    } finally {
      setUnlockBusy(false);
    }
  }

  async function handlePull(cpid) {
    setPullErr("");
    setPulling(prev => new Set([...prev, cpid]));
    try {
      await pullProject(cpid);
      const updated = await listProjects();
      setProjects(updated);
    } catch (e) {
      setPullErr(e?.message ?? "Pull failed.");
    } finally {
      setPulling(prev => { const n = new Set(prev); n.delete(cpid); return n; });
    }
  }

  async function handleReadRecoveryFile(e) {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file) return;
    try {
      const text = await file.text();
      const parsed = JSON.parse(text);
      setUnlockFile(parsed?.key ?? text.trim());
    } catch {
      setUnlockFile("");
      setUnlockErr("Could not read recovery key file.");
    }
  }

  // When selected project changes, load its pipeline for detail display.
  useEffect(() => {
    if (!selected) { setSelPipeline(null); return; }
    // Project list preview shows the primary dataset's pipeline slot. For
    // legacy projects the primary dataset id is the project pid itself, so
    // loadPipeline(pid) === loadPipeline(pid, pid) by default.
    loadPipeline(selected).then(p => setSelPipeline(p ?? null)).catch(() => setSelPipeline(null));
  }, [selected]);

  async function handleDelete(pid, e) {
    e.stopPropagation();
    await deleteProject(pid);
    await deletePipeline(pid);
    setProjects(p => p.filter(x => x.pid !== pid));
    if (selected === pid) { setSelected(null); setSelPipeline(null); }
  }

  async function handleClearAll() {
    await clearAllProjects();
    await clearAllPipelines();
    setProjects([]);
    setSelected(null);
    setSelPipeline(null);
  }

  async function handleRename(pid) {
    const trimmed = renameVal.trim();
    if (!trimmed) { setRenaming(null); return; }
    await saveProject(pid, { name: trimmed });
    setProjects(prev => prev.map(p => p.pid === pid ? { ...p, name: trimmed } : p));
    // Keep cloud copy name in sync if this project is published
    if (cloudProjects.some(cp => cp.pid === pid)) {
      renameCloudProject(pid, trimmed).catch(() => {});
      setCloudProjects(prev => prev.map(cp => cp.pid === pid ? { ...cp, name: trimmed } : cp));
    }
    setRenaming(null);
  }

  async function handleCloudRename(pid) {
    const trimmed = cloudRenameVal.trim();
    setCloudRenaming(null);
    if (!trimmed) return;
    try {
      await renameCloudProject(pid, trimmed);
      setCloudProjects(prev => prev.map(cp => cp.pid === pid ? { ...cp, name: trimmed } : cp));
      setProjects(prev => prev.map(p => p.pid === pid ? { ...p, name: trimmed } : p));
    } catch (e) {
      console.error("Cloud rename failed:", e);
    }
  }

  async function handleDescriptionSave(pid) {
    const trimmed = descVal.trim();
    await saveProject(pid, { description: trimmed });
    setProjects(prev => prev.map(p => p.pid === pid ? { ...p, description: trimmed } : p));
    setEditingDesc(null);
  }

  const selProject = projects.find(p => p.pid === selected);

  // ── Layout: two-panel like RStudio/Gretl ──────────────────────────────────
  return (
    <div style={{
      display: "flex", height: "100%", minHeight: 0,
      background: C.bg, fontFamily: T.code.fontFamily, overflow: "hidden",
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
          <div style={{display:"flex",alignItems:"flex-start",justifyContent:"space-between"}}>
            <div>
              <div style={{fontSize: T.caption.fontSize,color:C.teal,letterSpacing:"0.26em",textTransform:"uppercase",marginBottom:3}}>
                Litux
              </div>
              <div style={{fontSize: T.h2.fontSize,color:C.text,letterSpacing:"-0.01em",marginBottom:1}}>
                Projects
              </div>
              <div style={{fontSize: T.caption.fontSize,color:C.textMuted}}>
                {loading ? "Loading…" : `${projects.length} saved`}
              </div>
            </div>
            <button
              onClick={() => setTheme(theme === "dark" ? "light" : "dark")}
              title={theme === "dark" ? "Switch to light theme" : "Switch to dark theme"}
              style={{
                background:"transparent", border:"none", cursor:"pointer",
                fontSize: T.body.fontSize, color:C.textMuted, padding:"2px 4px",
                transition:"color 0.15s",
              }}
              onMouseEnter={e => { e.currentTarget.style.color = C.gold; }}
              onMouseLeave={e => { e.currentTarget.style.color = C.textMuted; }}
            >
              {theme === "dark" ? "☀" : "☾"}
            </button>
          </div>
        </div>

        {/* Project list */}
        <div style={{flex:1, overflowY:"auto"}}>
          {!loading && projects.length === 0 && (
            <div style={{
              padding: "2rem 1rem", textAlign:"center",
              fontSize: T.code.fontSize, color:C.textMuted, lineHeight:1.8,
            }}>
              No saved projects.<br/>
              <span style={{color:C.gold}}>Create one →</span>
            </div>
          )}

          {projects.map(p => {
            const isSel = p.pid === selected;
            const isRen = renaming === p.pid;

            return (
              <div
                key={p.pid}
                onClick={() => setSelected(p.pid)}
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
                {/* Info */}
                <div style={{flex:1, minWidth:0}}>
                  {isRen ? (
                    <input
                      autoFocus
                      value={renameVal}
                      onChange={e => setRenameVal(e.target.value)}
                      onKeyDown={e => {
                        if (e.key === "Enter") { e.preventDefault(); handleRename(p.pid); }
                        if (e.key === "Escape") setRenaming(null);
                      }}
                      onBlur={() => handleRename(p.pid)}
                      onClick={e => e.stopPropagation()}
                      style={{
                        fontSize: T.code.fontSize, fontFamily: T.code.fontFamily, background:C.surface,
                        border:`1px solid ${C.teal}`, borderRadius:2,
                        color:C.text, padding:"1px 4px", width:"100%",
                        outline:"none",
                      }}
                    />
                  ) : (
                    <div style={{display:"flex",alignItems:"center",gap:4,minWidth:0}}>
                      <div
                        onDoubleClick={e => {
                          e.stopPropagation();
                          setRenaming(p.pid);
                          setRenameVal(p.name || p.filename || "");
                        }}
                        title="Double-click to rename"
                        style={{
                          fontSize: T.code.fontSize, color: isSel ? C.text : C.textDim,
                          fontWeight: isSel ? 600 : 400,
                          overflow:"hidden", textOverflow:"ellipsis", whiteSpace:"nowrap",
                          flex:1, minWidth:0,
                        }}
                      >
                        {p.name || p.filename || "Unnamed"}
                      </div>
                      <span
                        onClick={e => {
                          e.stopPropagation();
                          setRenaming(p.pid);
                          setRenameVal(p.name || p.filename || "");
                        }}
                        title="Rename"
                        style={{
                          fontSize: T.caption.fontSize, color:C.border2, cursor:"pointer", flexShrink:0,
                          lineHeight:1, userSelect:"none",
                        }}
                      >✎</span>
                    </div>
                  )}
                  <div style={{fontSize: T.caption.fontSize, color:C.textMuted, marginTop:2, display:"flex", gap:8, flexWrap:"wrap"}}>
                    <span style={{color:C.teal}}>{p.datasetCount ?? 1} dataset{(p.datasetCount ?? 1) !== 1 ? "s" : ""}</span>
                    {(p.pipelineLength ?? 0) > 0 && (
                      <span style={{color:C.gold}}>{p.pipelineLength} steps</span>
                    )}
                  </div>
                  {p.description && (
                    <div style={{fontSize: T.caption.fontSize, color:C.textMuted, marginTop:2, overflow:"hidden", textOverflow:"ellipsis", whiteSpace:"nowrap", maxWidth:220}}>
                      {p.description}
                    </div>
                  )}
                  <div style={{fontSize: T.caption.fontSize, color:C.border2, marginTop:2}}>{fmt(p.updatedAt ?? p.ts)}</div>
                </div>

                {/* Delete */}
                <button
                  onClick={e => handleDelete(p.pid, e)}
                  title="Delete project"
                  style={{
                    background:"transparent", border:"none",
                    color:C.textMuted, cursor:"pointer",
                    fontSize: T.body.fontSize, padding:"0 2px", flexShrink:0, marginTop:1,
                    transition:"color 0.1s",
                  }}
                  onMouseEnter={e => e.currentTarget.style.color = C.red}
                  onMouseLeave={e => e.currentTarget.style.color = C.textMuted}
                >
                  ×
                </button>
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
                fontFamily: T.code.fontFamily, fontSize: T.caption.fontSize,
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
          <div style={{fontSize: T.caption.fontSize,color:C.teal,letterSpacing:"0.26em",textTransform:"uppercase",marginBottom:3}}>
            LMU Munich · Econometrics
          </div>
          <div style={{fontSize: T.h2.fontSize,color:C.text,letterSpacing:"-0.02em",marginBottom:4}}>
            Litux
          </div>
          <div style={{fontSize: T.code.fontSize,color:C.textMuted}}>
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
          onMouseEnter={e=>{e.currentTarget.style.background=C.surface3;e.currentTarget.style.borderColor=C.goldDim;}}
          onMouseLeave={e=>{e.currentTarget.style.background=C.goldFaint;e.currentTarget.style.borderColor=C.border2;}}
        >
          <span style={{fontSize: T.display.fontSize, color:C.gold, flexShrink:0}}>⊕</span>
          <div>
            <div style={{fontSize: T.body.fontSize,color:C.gold,marginBottom:3}}>New Project</div>
            <div style={{fontSize: T.caption.fontSize,color:C.goldDim}}>
              Upload CSV · XLSX · Stata .dta · or load demo dataset
            </div>
          </div>
        </div>

        {/* ── Selected project detail ── */}
        {selProject ? (
          <div style={{
            border:`1px solid ${C.border}`,
            borderRadius:5, overflow:"hidden",
            display:"flex", flexDirection:"column", maxHeight:"60vh",
          }}>
            {/* Project header */}
            <div style={{
              padding:"0.85rem 1rem",
              background:C.surface2,
              borderBottom:`1px solid ${C.border}`,
              display:"flex", alignItems:"center", gap:10,
            }}>
              <div style={{flex:1}}>
                <div style={{fontSize: T.body.fontSize,color:C.text,marginBottom:2}}>
                  {selProject.name || selProject.filename || "Unnamed"}
                </div>
                <div style={{fontSize: T.caption.fontSize,color:C.textMuted}}>
                  Last modified {fmt(selProject.updatedAt ?? selProject.ts)}
                </div>
              </div>
              {selPipeline?.panel && (
                <Badge ch={`Panel · i=${selPipeline.panel.entityCol} · t=${selPipeline.panel.timeCol}`} color={C.blue}/>
              )}
            </div>

            {/* Scrollable body — stats + description + pipeline steps */}
            <div style={{overflowY:"auto", flex:1}}>

            {/* Stats grid */}
            <div style={{
              display:"grid", gridTemplateColumns:"repeat(2,1fr)",
              gap:1, background:C.border,
            }}>
              {[
                {l:"Datasets", v: selProject.datasetCount ?? (1 + ((selPipeline?.steps || selPipeline?.pipeline) || []).filter(s=>["join","append"].includes(s.type)).length), c:C.teal},
                {l:"Pipeline", v:`${(selPipeline?.steps || selPipeline?.pipeline || []).length} steps`, c:((selPipeline?.steps || selPipeline?.pipeline || []).length)?C.gold:C.textMuted},
              ].map(s=>(
                <div key={s.l} style={{background:C.surface,padding:"0.6rem 0.8rem"}}>
                  <div style={{fontSize: T.caption.fontSize,color:C.textMuted,letterSpacing:"0.12em",textTransform:"uppercase",marginBottom:3}}>{s.l}</div>
                  <div style={{fontSize: T.body.fontSize,color:s.c,fontFamily: T.code.fontFamily}}>{s.v}</div>
                </div>
              ))}
            </div>

            {/* Description */}
            <div style={{padding:"0.7rem 1rem", borderTop:`1px solid ${C.border}`, background:C.surface}}>
              <div style={{fontSize: T.caption.fontSize,color:C.textMuted,letterSpacing:"0.14em",textTransform:"uppercase",marginBottom:5}}>
                Description
              </div>
              {editingDesc === selProject.pid ? (
                <div style={{display:"flex",flexDirection:"column",gap:6}}>
                  <textarea
                    autoFocus
                    value={descVal}
                    onChange={e => setDescVal(e.target.value)}
                    onKeyDown={e => { if (e.key === "Escape") setEditingDesc(null); }}
                    rows={3}
                    placeholder="Brief project description…"
                    style={{
                      width:"100%", fontFamily: T.code.fontFamily, fontSize: T.caption.fontSize,
                      background:C.surface2, border:`1px solid ${C.teal}`,
                      borderRadius:3, color:C.text, padding:"0.4rem 0.5rem",
                      resize:"vertical", outline:"none", boxSizing:"border-box",
                    }}
                  />
                  <div style={{display:"flex",gap:6}}>
                    <button
                      onClick={() => handleDescriptionSave(selProject.pid)}
                      style={{padding:"0.22rem 0.6rem",background:C.teal,border:"none",borderRadius:3,
                              color:C.bg,cursor:"pointer",fontFamily: T.code.fontFamily,fontSize: T.caption.fontSize,fontWeight:700}}
                    >Save</button>
                    <button
                      onClick={() => setEditingDesc(null)}
                      style={{padding:"0.22rem 0.6rem",background:"transparent",border:`1px solid ${C.border2}`,
                              borderRadius:3,color:C.textMuted,cursor:"pointer",fontFamily: T.code.fontFamily,fontSize: T.caption.fontSize}}
                    >Cancel</button>
                  </div>
                </div>
              ) : (
                <div
                  onClick={() => { setEditingDesc(selProject.pid); setDescVal(selProject.description || ""); }}
                  title="Click to edit description"
                  style={{
                    fontSize: T.caption.fontSize, color: selProject.description ? C.textDim : C.border2,
                    cursor:"pointer", lineHeight:1.6, minHeight:18,
                    fontStyle: selProject.description ? "normal" : "italic",
                  }}
                >
                  {selProject.description || "Add a description…"}
                </div>
              )}
            </div>

            {/* Pipeline steps preview */}
            {(() => {
              const _previewSteps = selPipeline?.steps || selPipeline?.pipeline || [];
              return _previewSteps.length > 0 && (
              <div style={{padding:"0.7rem 1rem", borderTop:`1px solid ${C.border}`, background:C.surface}}>
                <div style={{fontSize: T.caption.fontSize,color:C.textMuted,letterSpacing:"0.14em",textTransform:"uppercase",marginBottom:6}}>
                  Pipeline steps
                </div>
                <div style={{display:"flex",flexDirection:"column",gap:2}}>
                  {_previewSteps.slice(0,5).map((s,i)=>(
                    <div key={i} style={{fontSize: T.caption.fontSize,color:C.textDim,display:"flex",gap:6}}>
                      <span style={{color:C.border2,flexShrink:0}}>{i+1}.</span>
                      <span style={{overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}}>
                        [{s.type}] {s.desc||""}
                      </span>
                    </div>
                  ))}
                  {_previewSteps.length > 5 && (
                    <div style={{fontSize: T.caption.fontSize,color:C.textMuted}}>
                      … {_previewSteps.length - 5} more steps
                    </div>
                  )}
                </div>
              </div>
              );
            })()}

            </div>{/* end scrollable body */}

            {/* Open button */}
            <div style={{
              padding:"0.8rem 1rem",
              borderTop:`1px solid ${C.border}`,
              background:C.surface2,
              display:"flex", justifyContent:"flex-end",
            }}>
              <button
                onClick={() => onLoad({ ...selProject, id: selProject.pid })}
                style={{
                  padding:"0.42rem 1.1rem",
                  background:C.teal, color:C.bg,
                  border:`1px solid ${C.teal}`, borderRadius:3,
                  cursor:"pointer", fontFamily: T.code.fontFamily, fontSize: T.code.fontSize, fontWeight:700,
                }}
              >
                Open project →
              </button>
            </div>
          </div>
        ) : (
          <div style={{
            fontSize: T.code.fontSize, color:C.textMuted,
            padding:"1rem 0", lineHeight:1.8,
          }}>
            {projects.length > 0
              ? "← Select a project to open or continue working."
              : "Create a new project to get started."}
          </div>
        )}

        {/* ── Cloud projects card ── */}
        <div style={{
          border:`1px solid ${C.border}`,
          borderRadius:5, overflow:"hidden",
        }}>
          {/* Header */}
          <div style={{
            padding:"0.7rem 1rem",
            background:C.surface2,
            borderBottom:`1px solid ${C.border}`,
            display:"flex", alignItems:"center", gap:8,
          }}>
            <span style={{fontSize: T.body.fontSize, color:C.teal}}>☁</span>
            <span style={{fontSize: T.code.fontSize, color:C.text}}>Cloud projects</span>
            {cloudLoading && <span style={{fontSize: T.caption.fontSize,color:C.textMuted,marginLeft:"auto"}}>loading…</span>}
            {user && !cloudLoading && (
              <span style={{fontSize: T.caption.fontSize,color:C.textMuted,marginLeft:"auto"}}>
                {user.email}
              </span>
            )}
          </div>

          <div style={{padding:"0.85rem 1rem", display:"flex", flexDirection:"column", gap:10}}>

            {/* Not signed in */}
            {!user && (
              <div style={{fontSize: T.caption.fontSize,color:C.textMuted,lineHeight:1.7}}>
                Sign in to access your cloud-synced projects on this device.
              </div>
            )}

            {/* Signed in but locked */}
            {user && !unlocked && (
              <div style={{display:"flex",flexDirection:"column",gap:8}}>
                <div style={{fontSize: T.caption.fontSize,color:C.textMuted}}>
                  Enter your sync passphrase to access cloud projects.
                </div>
                <input
                  type="password"
                  value={unlockPass}
                  onChange={e => { setUnlockPass(e.target.value); setUnlockErr(""); }}
                  onKeyDown={e => { if (e.key === "Enter") handleUnlock(); }}
                  placeholder="Sync passphrase…"
                  disabled={unlockBusy}
                  style={{
                    padding:"0.42rem 0.6rem", fontFamily: T.code.fontFamily, fontSize: T.code.fontSize,
                    background:C.surface, border:`1px solid ${C.border2}`,
                    borderRadius:3, color:C.text, outline:"none", width:"100%",
                    boxSizing:"border-box",
                  }}
                  onFocus={e => e.target.style.borderColor = C.teal}
                  onBlur={e => e.target.style.borderColor = C.border2}
                />
                <div style={{display:"flex",gap:8,alignItems:"center",flexWrap:"wrap"}}>
                  <button
                    onClick={handleUnlock}
                    disabled={unlockBusy || (!unlockPass && !unlockFile)}
                    style={{
                      padding:"0.32rem 0.8rem", background:C.teal, border:"none",
                      borderRadius:3, color:C.bg, cursor:"pointer",
                      fontFamily: T.code.fontFamily, fontSize: T.caption.fontSize, fontWeight:700,
                      opacity: (unlockBusy || (!unlockPass && !unlockFile)) ? 0.5 : 1,
                    }}
                  >
                    {unlockBusy ? "Unlocking…" : "Unlock"}
                  </button>
                  <label style={{
                    fontSize: T.caption.fontSize, color:C.textMuted, cursor:"pointer",
                    textDecoration:"underline", textDecorationStyle:"dotted",
                  }}>
                    Use recovery key
                    <input type="file" accept=".json" onChange={handleReadRecoveryFile} style={{display:"none"}} />
                  </label>
                  {unlockFile && (
                    <span style={{fontSize: T.caption.fontSize,color:C.teal}}>✓ recovery key loaded</span>
                  )}
                </div>
                {unlockErr && (
                  <div style={{fontSize: T.caption.fontSize,color:C.red}}>{unlockErr}</div>
                )}
              </div>
            )}

            {/* Signed in + unlocked */}
            {user && unlocked && (
              <div style={{display:"flex",flexDirection:"column",gap:6}}>
                {pullErr && (
                  <div style={{fontSize: T.caption.fontSize,color:C.red,marginBottom:2}}>{pullErr}</div>
                )}
                {cloudProjects.length === 0 && !cloudLoading && (
                  <div style={{fontSize: T.caption.fontSize,color:C.textMuted}}>
                    No cloud projects yet. Publish a project from inside the workspace.
                  </div>
                )}
                {cloudProjects.map(cp => {
                  const isLocal = projects.some(lp => lp.pid === cp.pid);
                  const isPulling = pulling.has(cp.pid);
                  const isCloudRen = cloudRenaming === cp.pid;
                  const hasName = cp.name && cp.name !== cp.pid;
                  return (
                    <div key={cp.pid} style={{
                      display:"flex", alignItems:"center", gap:8,
                      padding:"0.45rem 0.6rem",
                      background:C.surface,
                      border:`1px solid ${C.border}`,
                      borderRadius:3,
                    }}>
                      <div style={{flex:1,minWidth:0}}>
                        {isCloudRen ? (
                          <input
                            autoFocus
                            value={cloudRenameVal}
                            onChange={e => setCloudRenameVal(e.target.value)}
                            onKeyDown={e => {
                              if (e.key === "Enter") { e.preventDefault(); handleCloudRename(cp.pid); }
                              if (e.key === "Escape") setCloudRenaming(null);
                            }}
                            onBlur={() => handleCloudRename(cp.pid)}
                            style={{
                              fontSize: T.code.fontSize, fontFamily: T.code.fontFamily, background:C.surface2,
                              border:`1px solid ${C.teal}`, borderRadius:2,
                              color:C.text, padding:"1px 5px", width:"100%",
                              outline:"none", boxSizing:"border-box",
                            }}
                          />
                        ) : (
                          <div style={{display:"flex",alignItems:"center",gap:4,minWidth:0}}>
                            {hasName ? (
                              <>
                                <div style={{fontSize: T.code.fontSize,color:C.text,overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap",flex:1,minWidth:0}}>
                                  {cp.name}
                                </div>
                                <span
                                  onClick={() => { setCloudRenaming(cp.pid); setCloudRenameVal(cp.name || ""); }}
                                  title="Rename"
                                  style={{fontSize: T.caption.fontSize,color:C.border2,cursor:"pointer",flexShrink:0,lineHeight:1,userSelect:"none"}}
                                >✎</span>
                              </>
                            ) : (
                              <div
                                onClick={() => { setCloudRenaming(cp.pid); setCloudRenameVal(""); }}
                                title="Give this project a name"
                                style={{fontSize: T.code.fontSize,color:C.teal,cursor:"pointer",fontStyle:"italic",overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap",flex:1,minWidth:0,userSelect:"none"}}
                              >+ Name this project</div>
                            )}
                          </div>
                        )}
                        <div style={{fontSize: T.caption.fontSize,color:C.textMuted,marginTop:1,overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}}>
                          v{cp.version} · {cp.updated_at ? new Date(cp.updated_at).toLocaleDateString("en-GB",{day:"2-digit",month:"short",year:"numeric"}) : ""}{!hasName ? ` · ${cp.pid}` : ""}
                        </div>
                      </div>
                      <div style={{display:"flex",alignItems:"center",gap:6,flexShrink:0}}>
                        {isLocal && <span style={{fontSize: T.caption.fontSize,color:C.teal}}>✓ local</span>}
                        <button
                          onClick={() => handlePull(cp.pid)}
                          disabled={isPulling}
                          title={isLocal ? "Re-pull from cloud (overwrite local)" : "Download to this device"}
                          style={{
                            padding:"0.26rem 0.65rem", background:`${C.teal}18`,
                            border:`1px solid ${C.teal}`, borderRadius:3,
                            color:C.teal, cursor:"pointer",
                            fontFamily: T.code.fontFamily, fontSize: T.caption.fontSize,
                            opacity: isPulling ? 0.5 : 1,
                          }}
                        >
                          {isPulling ? "Pulling…" : isLocal ? "↻ Restore" : "Pull →"}
                        </button>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        </div>

        {/* ── Incoming share banner (URL ?share=TOKEN) ── */}
        {incomingToken && user && (
          <div style={{
            border:`1px solid ${C.blue}`,
            borderRadius:5, padding:"0.85rem 1rem",
            background:`${C.blue}0d`,
            display:"flex", flexDirection:"column", gap:8,
          }}>
            <div style={{fontSize: T.code.fontSize,color:C.blue}}>↓ Incoming shared project</div>
            <div style={{fontSize: T.caption.fontSize,color:C.textMuted}}>Someone shared a project with you via link. Import it to your dashboard?</div>
            {shareErr && <div style={{fontSize: T.caption.fontSize,color:C.red}}>{shareErr}</div>}
            <div style={{display:"flex",gap:8}}>
              <button
                onClick={() => handlePullShare(incomingToken)}
                disabled={pullingShare.has(incomingToken)}
                style={{padding:"0.35rem 0.9rem",background:C.blue,border:"none",borderRadius:3,color:"#fff",cursor:"pointer",fontFamily: T.code.fontFamily,fontSize: T.caption.fontSize,fontWeight:700}}
              >
                {pullingShare.has(incomingToken) ? "Importing…" : "Import project"}
              </button>
              <button
                onClick={() => { setIncomingToken(""); window.history.replaceState({}, "", window.location.pathname); }}
                style={{padding:"0.35rem 0.7rem",background:"transparent",border:`1px solid ${C.border2}`,borderRadius:3,color:C.textMuted,cursor:"pointer",fontFamily: T.code.fontFamily,fontSize: T.caption.fontSize}}
              >Dismiss</button>
            </div>
          </div>
        )}

        {/* ── Shared with me card ── */}
        {user && sharedWithMe.length > 0 && (
          <div style={{border:`1px solid ${C.border}`,borderRadius:5,overflow:"hidden"}}>
            <div style={{padding:"0.7rem 1rem",background:C.surface2,borderBottom:`1px solid ${C.border}`,display:"flex",alignItems:"center",gap:8}}>
              <span style={{fontSize: T.body.fontSize,color:C.blue}}>⇄</span>
              <span style={{fontSize: T.code.fontSize,color:C.text}}>Shared with me</span>
            </div>
            <div style={{padding:"0.7rem 1rem",display:"flex",flexDirection:"column",gap:6}}>
              {shareErr && <div style={{fontSize: T.caption.fontSize,color:C.red,marginBottom:2}}>{shareErr}</div>}
              {sharedWithMe.map(s => {
                const isLocal = projects.some(p => p.pid === s.pid);
                const isBusy  = pullingShare.has(s.token);
                return (
                  <div key={s.id} style={{display:"flex",alignItems:"center",gap:8,padding:"0.42rem 0.6rem",background:C.surface,border:`1px solid ${C.border}`,borderRadius:3}}>
                    <div style={{flex:1,minWidth:0}}>
                      <div style={{fontSize: T.code.fontSize,color:C.text,overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}}>
                        {s.name || s.pid}
                      </div>
                      <div style={{fontSize: T.caption.fontSize,color:C.textMuted,marginTop:1}}>
                        {s.can_edit ? "can edit" : "view only"} · shared {s.created_at ? new Date(s.created_at).toLocaleDateString("en-GB",{day:"2-digit",month:"short",year:"numeric"}) : ""}
                      </div>
                    </div>
                    <div style={{display:"flex",alignItems:"center",gap:6,flexShrink:0}}>
                      {isLocal && <span style={{fontSize: T.caption.fontSize,color:C.teal}}>✓ local</span>}
                      <button
                        onClick={() => handlePullShare(s.token)}
                        disabled={isBusy}
                        title={isLocal ? "Re-import from share" : "Import to this device"}
                        style={{padding:"0.26rem 0.65rem",background:`${C.blue}18`,border:`1px solid ${C.blue}`,borderRadius:3,color:C.blue,cursor:"pointer",fontFamily: T.code.fontFamily,fontSize: T.caption.fontSize,opacity:isBusy?0.5:1}}
                      >
                        {isBusy ? "Importing…" : isLocal ? "↻ Restore" : "Import →"}
                      </button>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        )}

        {/* Workflow hint */}
        <div style={{
          marginTop:"auto",
          padding:"0.65rem 0.85rem",
          background:C.surface,
          border:`1px solid ${C.border}`,
          borderRadius:4,
          fontSize: T.caption.fontSize, color:C.textMuted,
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

// ─── PROJECT NAMING SCREEN ────────────────────────────────────────────────────
// Shown when the user clicks "New Project" on the dashboard.
// Just a name input — no file required. Data is loaded from inside the workspace.
function ProjectNamingScreen({ onConfirm, onBack }) {
  const { C, T } = useTheme();
  const [name, setName] = useState("");
  const inputRef = useRef(null);
  useEffect(() => { inputRef.current?.focus(); }, []);

  function confirm() {
    const trimmed = name.trim() || "Untitled project";
    onConfirm(trimmed);
  }

  return (
    <div style={{
      height:"100%", display:"flex", alignItems:"center", justifyContent:"center",
      background:C.bg, fontFamily: T.code.fontFamily,
    }}>
      <div style={{
        width:440, display:"flex", flexDirection:"column", gap:24,
        padding:"2.4rem 2.6rem",
        background:C.surface, border:`1px solid ${C.border}`, borderRadius:6,
      }}>
        <div>
          <div style={{fontSize: T.caption.fontSize,color:C.teal,letterSpacing:"0.26em",textTransform:"uppercase",marginBottom:8}}>
            Litux · New project
          </div>
          <div style={{fontSize: T.h2.fontSize,color:C.text,marginBottom:6}}>Name your project</div>
          <div style={{fontSize: T.caption.fontSize,color:C.textMuted,lineHeight:1.6}}>
            You can load datasets, simulate data, or fetch from World Bank inside the workspace.
          </div>
        </div>

        <div>
          <label style={{fontSize: T.caption.fontSize,color:C.textMuted,display:"block",marginBottom:6,
                         letterSpacing:"0.1em",textTransform:"uppercase"}}>
            Project name
          </label>
          <input
            ref={inputRef}
            value={name}
            onChange={e => setName(e.target.value)}
            onKeyDown={e => { if (e.key === "Enter") confirm(); if (e.key === "Escape") onBack(); }}
            placeholder="e.g. Wage inequality study"
            style={{
              width:"100%", padding:"0.6rem 0.8rem",
              background:C.bg, border:`1px solid ${C.border}`,
              borderRadius:3, color:C.text, fontFamily: T.code.fontFamily, fontSize: T.body.fontSize,
              outline:"none", transition:"border-color 0.12s",
            }}
            onFocus={e => e.target.style.borderColor = C.teal}
            onBlur={e => e.target.style.borderColor = C.border}
          />
        </div>

        <div style={{display:"flex", gap:10, justifyContent:"flex-end"}}>
          <button
            onClick={onBack}
            style={{
              padding:"0.45rem 1rem", borderRadius:3, cursor:"pointer",
              background:"transparent", border:`1px solid ${C.border2}`,
              color:C.textMuted, fontFamily: T.code.fontFamily, fontSize: T.code.fontSize,
            }}
          >
            ← Back
          </button>
          <button
            onClick={confirm}
            style={{
              padding:"0.45rem 1.3rem", borderRadius:3, cursor:"pointer",
              background:C.teal, border:`1px solid ${C.teal}`,
              color:C.bg, fontFamily: T.code.fontFamily, fontSize: T.code.fontSize, fontWeight:700,
            }}
          >
            Create →
          </button>
        </div>
      </div>
    </div>
  );
}

// ─── ROOT ─────────────────────────────────────────────────────────────────────
export default function App() {
  const { C, T } = useTheme();
  const [screen,             setScreen]            = useState("dashboard");
  const [tourStep,           setTourStep]          = useState(-1);
  const [filename,           setFilename]          = useState("");
  const [projectName,        setProjectName]       = useState("");
  const [pid,                setPid]               = useState(null);
  const [outputs,            setOutputs]           = useState({});
  const [activeTab,          setActiveTab]         = useState("clean");
  // Per-tab independent dataset selection — each tab remembers its own active dataset
  const [activeDatasetIds,   setActiveDatasetIds]  = useState({
    data: null, clean: null, explore: null, model: null,
    spatial: null, simulate: null, calculate: null, report: null,
  });
  // The project-wide last-worked-on dataset — the fallback for any tab that has
  // no explicit per-tab selection. Replaces the old "primary == pid" fallback.
  const [activeDatasetId,    setActiveDatasetId]   = useState(null);
  // Optional datasets to seed a freshly-opened project whose registry is empty
  // (used by the demo project). Consumed by DataStudio on mount.
  const [initialDatasets,    setInitialDatasets]   = useState(null);
  const [sidebarOpen,        setSidebarOpen]       = useState(false);
  const [activeResult,       setActiveResult]      = useState(null);
  const [modelingSession,    setModelingSession]   = useState({ pinnedModels: [], subsets: null, inferenceOpts: null });
  const [coachPrefill,       setCoachPrefill]      = useState(null);
  // Coach → Clean dispatch: pre-loads the Clean-tab AI command bar with a column
  // + instruction and navigates there. Consumed once by NLCommandBar.
  const [assistantPrefill,   setAssistantPrefill]  = useState(null);
  const [feedbackOpen,       setFeedbackOpen]      = useState(false);

  const [availableDatasets,  setAvailableDatasets] = useState([]);
  const coachSeqRef  = useRef(0);
  const studioRef    = useRef(null);

  // ── Session restore: persist navigation state to sessionStorage ──────────────
  const NAV_KEY = "litux:nav";

  // On mount: if the user was in the workspace, reload that project + tab.
  useEffect(() => {
    const saved = sessionStorage.getItem(NAV_KEY);
    if (!saved) return;
    try {
      const { pid: savedPid, activeTab: savedTab, projectName: savedName, filename: savedFilename, activeDatasetId: savedDsId } = JSON.parse(saved);
      if (!savedPid) return;
      listProjects().then(projects => {
        const p = projects.find(x => x.pid === savedPid);
        if (!p) { sessionStorage.removeItem(NAV_KEY); return; }
        setFilename(savedFilename || p.filename || p.name || "project");
        setProjectName(savedName || p.name || "Project");
        setPid(savedPid);
        setOutputs({});
        setActiveDatasetId(savedDsId ?? null);
        setInitialDatasets(null);
        navHistory.current = [];
        setCanGoBack(false);
        setActiveTab(savedTab || "clean");
        setScreen("workspace");
      }).catch(() => {});
    } catch { sessionStorage.removeItem(NAV_KEY); }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Persist current workspace position whenever it changes.
  useEffect(() => {
    if (screen === "workspace" && pid) {
      sessionStorage.setItem(NAV_KEY, JSON.stringify({ pid, activeTab, projectName, filename, activeDatasetId }));
    } else if (screen === "dashboard") {
      sessionStorage.removeItem(NAV_KEY);
    }
  }, [screen, pid, activeTab, projectName, filename, activeDatasetId]);

  // ── Navigation history — tracks {screen, tab} entries for ← back button ──
  const navHistory = useRef([]);                  // stack of past states
  const [canGoBack, setCanGoBack]   = useState(false);

  // Push current location before navigating somewhere new
  function pushHistory(fromScreen, fromTab) {
    navHistory.current.push({ screen: fromScreen, tab: fromTab });
    setCanGoBack(true);
  }

  function goBack() {
    const prev = navHistory.current.pop();
    if (!prev) return;
    setCanGoBack(navHistory.current.length > 0);
    setScreen(prev.screen);
    if (prev.tab) setActiveTab(prev.tab);
  }

  // Wrapped navigation helpers — always push before moving
  function navigateToScreen(newScreen) {
    pushHistory(screen, activeTab);
    setScreen(newScreen);
  }

  function navigateToTab(newTab) {
    if (newTab === activeTab) return;
    pushHistory(screen, activeTab);
    setActiveTab(newTab);
  }

  // Coach dispatched a cleaning action → go to Clean, hand the {col, instruction}
  // to the AI command bar, and close the sidebar so the user sees the preview.
  function handleDispatchToAssistant({ col, instruction }) {
    if (!instruction) return;
    navigateToTab("clean");
    setAssistantPrefill({ col, instruction, ts: Date.now() });
    setSidebarOpen(false);
  }

  // ── Load a saved project from the dashboard ──────────────────────────────
  const handleLoad = async p => {
    setFilename(p.filename || p.name || "project");
    setProjectName(p.name || (p.filename || "").replace(/\.[^.]+$/, "") || "Project");
    setPid(p.id);
    setOutputs({});
    setActiveDatasetId(p.activeDatasetId ?? null);
    setInitialDatasets(null);
    navHistory.current = [];   // fresh history for this project
    setCanGoBack(false);

    if (p.filename === "wages_panel_demo.csv") {
      const { headers, rows } = parseCSV(DEMO_CSV);
      const types = {};
      headers.forEach(h => { types[h] = detectType(rows.slice(0, 50).map(r => r[h])); });
      const coerced = rows.map(r => {
        const o = {}; headers.forEach(h => { o[h] = coerce(r[h], types[h]); }); return o;
      });
      // Seed the demo through DataStudio's normal add/persist path.
      setInitialDatasets([{ filename: "wages_panel_demo.csv", rawData: { headers, rows: coerced } }]);
    }

    // DataStudio hydrates datasets from the registry (and seeds initialDatasets
    // when the registry is empty). Open on Clean; if the project is empty the
    // DataStudio empty-state points the user to the Data tab.
    setActiveTab("clean");
    setScreen("workspace");
  };

  // ── Called by ProjectNamingScreen when user confirms the project name ────
  // Creates an empty project and enters the workspace. Data is loaded from
  // the Data tab inside the workspace.
  const handleNamingConfirm = async (projectName) => {
    const newPid = `proj_${Date.now()}_${Math.random().toString(36).slice(2)}`;
    try {
      await saveProject(newPid, { name: projectName, filename: "", datasetCount: 0 });
    } catch (e) {
      console.warn("[Projects] saveProject failed:", e);
    }
    setInitialDatasets(null);
    setActiveDatasetId(null);
    setFilename(projectName);
    setProjectName(projectName);
    setPid(newPid);
    setOutputs({});
    setActiveTab("data");
    navHistory.current = [];   // fresh history for brand-new project
    setCanGoBack(false);
    setScreen("workspace");
  };

  // ── Per-tab helpers ───────────────────────────────────────────────────────
  // Fallback is the project-wide active dataset (no privileged "primary == pid").
  const tabDsId   = (tab) => activeDatasetIds[tab] ?? activeDatasetId;
  const tabOutput = (tab) => outputs[tabDsId(tab)] ?? null;

  // Rows/headers for a tab's active dataset, sourced from the availableDatasets
  // mirror (which already carries rows+headers from DataStudio). Replaces the
  // old single `rawData` primary prop.
  const tabRawData = (tab) => {
    const id = tabDsId(tab);
    const ds = availableDatasets.find(d => d.id === id);
    return ds ? { rows: ds.rows ?? [], headers: ds.headers ?? [], _duckdb: ds._duckdb ?? null } : null;
  };

  // Setter: update one tab's selection; optionally call switchToDataset
  const selectDataset = (tab, id, switchDs = false) => {
    setActiveDatasetIds(prev => ({ ...prev, [tab]: id }));
    if (switchDs) studioRef.current?.switchToDataset(id);
  };

  // Stable cleanedData for ModelingTab: prefer pipeline output, fall back to raw
  // dataset so users can go straight to Model without visiting Clean first.
  const modelCleanedData = useMemo(() => {
    const out = tabOutput("model");
    if (out) return out;
    const rd = tabRawData("model");
    if (!rd?.rows?.length) return null;
    return { headers: rd.headers, cleanRows: rd.rows, colInfo: {}, dataDictionary: {}, pipeline: [], panelIndex: null, issues: [], removed: 0, _duckdb: rd._duckdb ?? null };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [outputs, activeDatasetIds, activeDatasetId, availableDatasets]);

  // ── Pipeline output — fired by DataStudio when user clicks "→ Analyze" ───
  const handleComplete = r => {
    const id = tabDsId("clean");
    setOutputs(prev => ({ ...prev, [id]: r }));
    setActiveTab("explore");
  };

  // ── Auto output — fired silently when a dataset's pipeline finishes loading ─
  const handleOutputReady = (r, dsId) => {
    setOutputs(prev => ({ ...prev, [dsId]: r }));
  };

  const inWorkspace = screen === "workspace";
  const inNaming    = screen === "naming";

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
      <div style={{height:38,borderBottom:`1px solid ${C.border}`,display:"flex",alignItems:"center",padding:"0 1.2rem",gap:8,flexShrink:0,background:C.surface}}>

        {/* ← Back button — visible whenever there is history to go back to */}
        {canGoBack && (
          <button
            onClick={goBack}
            title="Go back"
            style={{background:"transparent",border:"none",color:C.textMuted,cursor:"pointer",
                    fontFamily: T.code.fontFamily,fontSize: T.body.fontSize,lineHeight:1,padding:"0 4px",
                    display:"flex",alignItems:"center",transition:"color 0.12s"}}
            onMouseEnter={e=>{ e.currentTarget.style.color=C.teal; }}
            onMouseLeave={e=>{ e.currentTarget.style.color=C.textMuted; }}
          >←</button>
        )}

        <button
          onClick={()=>navigateToScreen("dashboard")}
          title="Go to dashboard"
          style={{background:"transparent",border:"none",color:C.gold,cursor:"pointer",fontFamily: T.code.fontFamily,fontSize: T.code.fontSize,letterSpacing:"0.12em"}}
        >
          ⬡ LITUX
        </button>

        {inWorkspace && (projectName || filename) && (
          <>
            <span style={{color:C.border2}}>|</span>
            <span style={{fontSize: T.code.fontSize,color:C.textDim,fontFamily: T.code.fontFamily}}>{projectName || filename}</span>
            {availableDatasets.length > 0 && (
              <span style={{fontSize: T.caption.fontSize,color:C.textMuted,fontFamily: T.code.fontFamily}}>
                · {availableDatasets.length} dataset{availableDatasets.length !== 1 ? "s" : ""}
              </span>
            )}
          </>
        )}

        {inWorkspace && (
          <>
            {!tabOutput(activeTab) && (
              <span style={{fontSize: T.caption.fontSize,color:C.textMuted,fontFamily: T.code.fontFamily,marginLeft:4}}>
                autosaved ✓
              </span>
            )}
            <button
              onClick={()=>setSidebarOpen(o=>!o)}
              style={{
                marginLeft:"auto", padding:"0.22rem 0.65rem",
                background: sidebarOpen ? `${C.violet}18` : "transparent",
                border:`1px solid ${sidebarOpen ? C.violet : C.border2}`,
                borderRadius:3, color: sidebarOpen ? C.violet : C.textMuted,
                cursor:"pointer", fontFamily: T.code.fontFamily, fontSize: T.caption.fontSize,
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
            onNew={()=>navigateToScreen("naming")}
            onLoad={handleLoad}
          />
        )}

        {screen==="naming" && (
          <ProjectNamingScreen
            onConfirm={handleNamingConfirm}
            onBack={goBack}
          />
        )}

        {screen==="workspace" && (
          <SessionStateProvider key={pid} pid={pid}>
          <SessionLogProvider pid={pid}>

            <div style={{display:"flex",flexDirection:"column",height:"100%"}}>
              <WorkspaceBar
                activeTab={activeTab}
                onTabChange={navigateToTab}
                hasOutput={!!tabOutput(activeTab)}
                activeDatasetId={tabDsId(activeTab)}
                pid={pid}
                onSelectDataset={id => selectDataset(activeTab, id, activeTab === "clean")}
                onRemoveDataset={id => {
                  studioRef.current?.removeDatasetLocal(id);
                  // Purge stale pipeline output so modules see fresh data
                  setOutputs(prev => { const { [id]: _, ...rest } = prev; return rest; });
                  // Reset any tab scoped to the deleted dataset → clear its
                  // selection so it falls back to the project-wide active dataset.
                  setActiveDatasetIds(prev => {
                    const next = { ...prev };
                    Object.keys(next).forEach(tab => { if (next[tab] === id) next[tab] = null; });
                    return next;
                  });
                }}
                onStartTour={() => setTourStep(0)}
                onOpenFeedback={() => setFeedbackOpen(true)}
              />

              {feedbackOpen && (
                <FeedbackModal
                  activeTab={activeTab}
                  onClose={() => setFeedbackOpen(false)}
                />
              )}

              {tourStep >= 0 && tourStep < TOUR_STEPS.length && (
                <TourOverlay
                  step={tourStep}
                  onNext={() => setTourStep(s => s + 1)}
                  onPrev={() => setTourStep(s => s - 1)}
                  onClose={() => setTourStep(-1)}
                  onTabChange={setActiveTab}
                />
              )}

              {/* ── Tab panels — kept mounted via display:none to preserve state ── */}
              <div style={{flex:1,minHeight:0,position:"relative"}}>

                {/* DATA — dataset overview + file upload + WB/OECD fetchers */}
                <div style={{...tabPanel, display: activeTab==="data" ? "flex" : "none", flexDirection:"column"}}>
                  <DataTab
                    filename={filename} studioRef={studioRef}
                    cleanedData={tabOutput("data")}
                    availableDatasets={availableDatasets}
                    activeDatasetId={tabDsId("data")}
                    onSelectDataset={id => selectDataset("data", id, true)}
                    onDeleteDataset={id => { studioRef.current?.removeDataset(id); }}
                    onRenameDataset={(id, name) => { studioRef.current?.renameDataset?.(id, name); }}
                  />
                </div>

                {/* CLEAN — only mounted when there is data */}
                <div style={{...tabPanel, display: activeTab==="clean" ? "flex" : "none", flexDirection:"column"}}>
                  <DataStudio
                    ref={studioRef}
                    key={pid}
                    projectPid={pid}
                    initialDatasets={initialDatasets}
                    onComplete={handleComplete}
                    onOutputReady={handleOutputReady}
                    onDatasetsChange={dsList => {
                      setAvailableDatasets(dsList);
                      if (pid?.startsWith("proj_")) saveProject(pid, { datasetCount: dsList.length }).catch(()=>{});
                    }}
                    onActiveDatasetChange={id => setActiveDatasetId(id)}
                    activeDatasetId={tabDsId("clean")}
                    assistantPrefill={assistantPrefill}
                    onConsumePrefill={() => setAssistantPrefill(null)}
                  />
                </div>

                {/* EXPLORE */}
                <div style={{...tabPanel, display: activeTab==="explore" ? "flex" : "none", flexDirection:"column"}}>
                  {tabOutput("explore")
                    ? <ExplorerModule
                        key={tabDsId("explore")}
                        pid={tabDsId("explore")}
                        cleanedData={tabOutput("explore")}
                        onBack={()=>navigateToTab("clean")}
                        onProceed={()=>navigateToTab("model")}
                        onSaveDataset={(name, rows, headers, recipe = null) => {
                          const newId = studioRef.current?.addApiData(name, rows, headers, recipe);
                          if (newId) selectDataset("explore", newId);
                        }}
                      />
                    : <NeedsOutput onGoToClean={()=>navigateToTab("clean")}/>
                  }
                </div>

                {/* MODEL */}
                <div style={{...tabPanel, display: activeTab==="model" ? "flex" : "none", flexDirection:"column"}}>
                  {modelCleanedData
                    ? <ModelingTab
                        cleanedData={modelCleanedData}
                        availableDatasets={availableDatasets}
                        onBack={()=>navigateToTab("explore")}
                        onResultChange={r=>setActiveResult(r)}
                        onSessionStateChange={setModelingSession}
                        onCoachQuestion={q=>{ setSidebarOpen(true); setCoachPrefill({q,seq:++coachSeqRef.current}); }}
                        onExtract={(colName, values) => studioRef.current?.addInjectColumnStep?.(colName, values)}
                        pid={pid}
                      />
                    : <NeedsOutput onGoToClean={()=>navigateToTab("clean")}/>
                  }
                </div>

                {/* SPATIAL — Phase 11 */}
                <div style={{...tabPanel, display: activeTab==="spatial" ? "flex" : "none", flexDirection:"column"}}>
                  <SpatialTab
                    rows={tabOutput("spatial")?.cleanRows ?? tabRawData("spatial")?.rows ?? []}
                    headers={tabOutput("spatial")?.headers ?? tabRawData("spatial")?.headers ?? []}
                    availableDatasets={availableDatasets}
                    pid={tabDsId("spatial")}
                    onAddDataset={(name, rows, headers) => {
                      const newId = studioRef.current?.addApiData(name, rows, headers);
                      if (newId) selectDataset("spatial", newId);
                    }}
                    onMergeColumns={(resultRows, newCols) => {
                      const activeId = tabDsId("spatial");
                      const activeDs = availableDatasets.find(d => d.id === activeId);
                      const name     = activeDs?.filename ?? activeDs?.name ?? "spatial_data";
                      const allHeaders = [...new Set([...(activeDs?.headers ?? []), ...newCols])];
                      const newId = studioRef.current?.addApiData(name, resultRows, allHeaders);
                      if (newId) {
                        studioRef.current?.removeDataset(activeId);
                        selectDataset("spatial", newId);
                      }
                    }}
                  />
                </div>

                {/* SIMULATE — Phase 9.8 */}
                <div style={{...tabPanel, display: activeTab==="simulate" ? "flex" : "none", flexDirection:"column"}}>
                  <SimulateTab
                    rows={tabOutput("simulate")?.cleanRows ?? tabRawData("simulate")?.rows ?? []}
                    headers={tabOutput("simulate")?.headers ?? tabRawData("simulate")?.headers ?? []}
                    onAddDataset={(name, rows, headers) => {
                      const newId = studioRef.current?.addApiData(name, rows, headers);
                      if (newId) selectDataset("simulate", newId); // auto-select only in Simulate
                    }}
                    onAddColumn={(colName, values) => {
                      const baseRows = tabOutput("simulate")?.cleanRows ?? tabRawData("simulate")?.rows ?? [];
                      const merged = baseRows.map((r, i) => ({ ...r, [colName]: values[i] ?? null }));
                      const baseHdrs = tabOutput("simulate")?.headers ?? tabRawData("simulate")?.headers ?? [];
                      const newHdrs = baseHdrs.includes(colName) ? baseHdrs : [...baseHdrs, colName];
                      const newId = studioRef.current?.addApiData(colName + "_augmented", merged, newHdrs);
                      if (newId) selectDataset("simulate", newId);
                    }}
                    onCreateDataset={(name, rows, headers) => {
                      const newId = studioRef.current?.addApiData(name, rows, headers);
                      if (newId) selectDataset("simulate", newId);
                    }}
                  />
                </div>

                {/* REPORT — Phase 9.10 */}
                <div style={{...tabPanel, display: activeTab==="report" ? "flex" : "none"}}>
                  {tabOutput("report")
                    ? <ReportingModule result={activeResult} cleanedData={tabOutput("report")} availableDatasets={availableDatasets} pid={pid} />
                    : <NeedsOutput onGoToClean={() => navigateToTab("clean")} />
                  }
                </div>

                {/* CALCULATE — Phase 9.7 */}
                <div style={{...tabPanel, display: activeTab==="calculate" ? "flex" : "none", flexDirection:"column"}}>
                  <CalculateTab
                    pid={pid}
                    rows={tabOutput("calculate")?.cleanRows ?? tabRawData("calculate")?.rows ?? []}
                    headers={tabOutput("calculate")?.headers ?? tabRawData("calculate")?.headers ?? []}
                    onAddDataset={(name, rows, headers) => {
                      const newId = studioRef.current?.addApiData(name, rows, headers);
                      if (newId) selectDataset("calculate", newId);
                    }}
                    onAddColumn={(colName, values) => {
                      const baseRows = tabOutput("calculate")?.cleanRows ?? tabRawData("calculate")?.rows ?? [];
                      const merged = baseRows.map((r, i) => ({ ...r, [colName]: values[i] ?? null }));
                      const baseHdrs = tabOutput("calculate")?.headers ?? tabRawData("calculate")?.headers ?? [];
                      const newHdrs = baseHdrs.includes(colName) ? baseHdrs : [...baseHdrs, colName];
                      const newId = studioRef.current?.addApiData(colName + "_augmented", merged, newHdrs);
                      if (newId) selectDataset("calculate", newId);
                    }}
                    onCreateDataset={(name, rows, headers) => {
                      const newId = studioRef.current?.addApiData(name, rows, headers);
                      if (newId) selectDataset("calculate", newId);
                    }}
                  />
                </div>

              </div>
            </div>
          <AIContextSidebar
            isOpen={sidebarOpen}
            onClose={()=>setSidebarOpen(false)}
            screen={activeTab}
            cleanedData={tabOutput(activeTab)}
            modelResult={activeResult}
            pinnedModels={modelingSession.pinnedModels}
            subsets={modelingSession.subsets}
            inferenceOpts={modelingSession.inferenceOpts}
            prefillMessage={coachPrefill}
            pid={pid}
            onDispatchToAssistant={handleDispatchToAssistant}
          />
          </SessionLogProvider>
          </SessionStateProvider>
        )}

      </div>

      <AIContextSidebar
        isOpen={sidebarOpen}
        onClose={()=>setSidebarOpen(false)}
        screen={activeTab}
        cleanedData={tabOutput(activeTab)}
        modelResult={activeResult}
        pinnedModels={modelingSession.pinnedModels}
        subsets={modelingSession.subsets}
        inferenceOpts={modelingSession.inferenceOpts}
        prefillMessage={coachPrefill}
        pid={pid}
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
