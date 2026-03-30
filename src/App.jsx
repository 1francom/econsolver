// ─── ECON STUDIO · App.jsx ────────────────────────────────────────────────────
// Root orchestrator. Manages global state and screen routing.
// All heavy logic lives in the module files — this file should stay thin.
import { useState, useRef } from "react";
import DataStudio from "./DataStudio.jsx";
import ExplorerModule from "./ExplorerModule.jsx";
import ModelingTab from './ModelingTab';

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

// ─── PIPELINE OUTPUT REVIEW ───────────────────────────────────────────────────
function OutputReview({result, onBack, onExplore}) {
  return(
    <div style={{background:C.bg,color:C.text,fontFamily:mono,minHeight:"100vh",padding:"2rem",maxWidth:860,margin:"0 auto"}}>
      <div style={{fontSize:9,color:C.teal,letterSpacing:"0.26em",textTransform:"uppercase",marginBottom:"0.8rem"}}>Pipeline Output — engine-ready object</div>
      <div style={{display:"grid",gridTemplateColumns:"repeat(auto-fill,minmax(150px,1fr))",gap:1,background:C.border,borderRadius:4,overflow:"hidden",marginBottom:"1.5rem"}}>
        {[
          {l:"Clean rows",v:result.cleanRows.length,c:C.green},
          {l:"Columns",v:result.headers.length,c:C.blue},
          {l:"Steps",v:result.changeLog.length,c:C.gold},
          {l:"Panel",v:result.panelIndex?`${result.panelIndex.entityCol}×${result.panelIndex.timeCol}`:"none",c:result.panelIndex?C.teal:C.textMuted},
          {l:"Balance",v:result.panelIndex?.balance||"—",c:C.text},
          {l:"FE",v:result.panelIndex?.blockFE?"BLOCKED":"OK",c:result.panelIndex?.blockFE?C.red:C.green},
        ].map(s=>(
          <div key={s.l} style={{background:C.surface,padding:"0.6rem 0.85rem"}}>
            <div style={{fontSize:9,color:C.textMuted,marginBottom:2,letterSpacing:"0.1em",textTransform:"uppercase"}}>{s.l}</div>
            <div style={{fontSize:15,color:s.c}}>{s.v}</div>
          </div>
        ))}
      </div>
      <div style={{fontSize:10,color:C.textMuted,letterSpacing:"0.2em",textTransform:"uppercase",marginBottom:6,fontFamily:mono}}>Change Log</div>
      {!result.changeLog.length&&<div style={{fontSize:11,color:C.textMuted,marginBottom:"1.5rem"}}>No transformations applied.</div>}
      <div style={{marginBottom:"1.5rem"}}>
        {result.changeLog.map((e,i)=>(
          <div key={i} style={{fontSize:11,color:C.textDim,padding:"0.28rem 0",borderBottom:`1px solid ${C.border}`}}>
            <span style={{color:C.gold}}>{i+1}.</span> [{e.type}] {e.description}
          </div>
        ))}
      </div>
      <div style={{fontSize:10,color:C.textMuted,letterSpacing:"0.2em",textTransform:"uppercase",marginBottom:6,fontFamily:mono}}>First 5 rows</div>
      <Grid headers={result.headers} rows={result.cleanRows} max={5}/>
      <div style={{marginTop:"1.5rem",display:"flex",gap:8}}>
        <Btn onClick={onBack} ch="← Back to Data Studio"/>
        <Btn onClick={onExplore} color={C.violet} v="solid" ch="⬡ Evidence Explorer →"/>
      </div>
    </div>
  );
}

// ─── PROJECT DASHBOARD ────────────────────────────────────────────────────────
function Dashboard({onNew, onLoad}) {
  const projects = lsGet();
  const fmt = ts=>ts?new Date(ts).toLocaleDateString("en-GB",{day:"2-digit",month:"short",hour:"2-digit",minute:"2-digit"}):"—";
  return(
    <div style={{maxWidth:780,margin:"0 auto",padding:"2.5rem 2rem"}}>
      <div style={{marginBottom:"2rem"}}>
        <div style={{fontSize:9,color:C.teal,letterSpacing:"0.28em",textTransform:"uppercase",marginBottom:5,fontFamily:mono}}>LMU Munich · Econometrics</div>
        <div style={{fontSize:26,color:C.text,letterSpacing:"-0.02em",marginBottom:4}}>Econ Studio</div>
        <div style={{fontSize:12,color:C.textDim,fontFamily:mono}}>Non-destructive data preparation · OLS · 2SLS · Panel FE/FD · RDD · DiD</div>
      </div>
      <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:"1rem",marginBottom:"1.5rem"}}>
        <div onClick={onNew} style={{border:`1px solid ${C.border2}`,borderRadius:6,padding:"1.4rem",background:C.goldFaint,cursor:"pointer",textAlign:"center",transition:"background 0.15s"}}
          onMouseOver={e=>e.currentTarget.style.background="#201808"} onMouseOut={e=>e.currentTarget.style.background=C.goldFaint}>
          <div style={{fontSize:22,marginBottom:8}}>⊕</div>
          <div style={{fontSize:14,color:C.gold,marginBottom:4}}>New Project</div>
          <div style={{fontSize:11,color:C.goldDim,fontFamily:mono}}>Upload CSV / XLSX / Stata .dta or load demo</div>
        </div>
        <div style={{border:`1px solid ${C.border}`,borderRadius:6,padding:"1.4rem",background:C.surface}}>
          <div style={{fontSize:10,color:C.textMuted,letterSpacing:"0.12em",textTransform:"uppercase",marginBottom:"0.8rem",fontFamily:mono}}>Engine Compatibility</div>
          {["OLS","2SLS","FE / FD Panel","RDD","DiD 2×2 / TWFE"].map(m=><div key={m} style={{fontSize:11,color:C.green,fontFamily:mono,marginBottom:3}}>✓ {m}</div>)}
        </div>
      </div>
      <div style={{marginBottom:"1.5rem",padding:"0.65rem 1rem",background:C.surface,border:`1px solid ${C.border}`,borderRadius:4,fontSize:10,color:C.textMuted,fontFamily:mono,display:"flex",gap:8,alignItems:"center",flexWrap:"wrap"}}>
        {["Dashboard","Upload","Wrangling","Evidence Explorer","Modeling"].map((s,i,arr)=>(
          <span key={s} style={{display:"flex",alignItems:"center",gap:8}}>
            <span style={{color:i===0?C.gold:C.textMuted}}>{s}</span>
            {i<arr.length-1&&<span style={{color:C.border2}}>→</span>}
          </span>
        ))}
      </div>
      {projects.length>0&&(
        <>
          <div style={{fontSize:10,color:C.textMuted,letterSpacing:"0.18em",textTransform:"uppercase",marginBottom:"0.8rem",fontFamily:mono}}>Recent Projects</div>
          <div style={{display:"flex",flexDirection:"column",gap:1,background:C.border,borderRadius:4,overflow:"hidden"}}>
            {projects.map((p)=>(
              <div key={p.id} onClick={()=>onLoad(p)} style={{padding:"0.65rem 1rem",background:C.surface,cursor:"pointer",display:"flex",alignItems:"center",gap:10,transition:"background 0.12s"}}
                onMouseOver={e=>e.currentTarget.style.background=C.surface2} onMouseOut={e=>e.currentTarget.style.background=C.surface}>
                <div style={{flex:1}}>
                  <div style={{fontSize:12,color:C.text,fontFamily:mono}}>{p.filename||"Unnamed"}</div>
                  <div style={{fontSize:10,color:C.textMuted,fontFamily:mono,marginTop:2}}>{p.rowCount||"?"} rows · {p.colCount||"?"} cols · {p.pipelineLength||0} steps · {fmt(p.ts)}</div>
                </div>
                {p.panel&&<Badge ch="Panel" color={C.blue}/>}
                <span style={{color:C.textMuted,fontSize:12}}>→</span>
              </div>
            ))}
          </div>
          <div style={{marginTop:"0.8rem",display:"flex",justifyContent:"flex-end"}}>
            <Btn onClick={()=>{lsSet([]);window.location.reload();}} color={C.red} v="ghost" sm ch="Clear saved projects"/>
          </div>
        </>
      )}
    </div>
  );
}

// ─── ROOT ─────────────────────────────────────────────────────────────────────
export default function App() {
  const [screen, setScreen] = useState("dashboard");
  const [rawData, setRawData] = useState(null);
  const [filename, setFilename] = useState("");
  const [pid, setPid] = useState(null);
  const [output, setOutput] = useState(null);

  // Load a saved project from the dashboard
  const handleLoad = p => {
    setFilename(p.filename||"project");
    setPid(p.id);
    if(p.filename==="wages_panel_demo.csv"){
      const{headers,rows}=parseCSV(DEMO_CSV);
      const types={};
      headers.forEach(h=>{types[h]=detectType(rows.slice(0,50).map(r=>r[h]));});
      const coerced=rows.map(r=>{const o={};headers.forEach(h=>{o[h]=coerce(r[h],types[h]);});return o;});
      setRawData({headers,rows:coerced});
      setScreen("studio");
    } else {
      setScreen("upload");
    }
  };

  // Called by Uploader once file is confirmed
  const handleReady = (data, types, fname) => {
    setRawData(data);
    setFilename(fname||"dataset.csv");
    const newPid = pid||`proj_${Date.now()}`;
    setPid(newPid);
    setScreen("studio");
  };

  const inFlow = ["studio","output","explorer","modeling"].includes(screen);

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
        <button onClick={()=>setScreen("dashboard")} style={{background:"transparent",border:"none",color:C.gold,cursor:"pointer",fontFamily:mono,fontSize:11,letterSpacing:"0.12em"}}>
          ⬡ ECON STUDIO
        </button>
        <span style={{color:C.border2}}>|</span>
        {inFlow&&(
          <div style={{display:"flex",gap:6,alignItems:"center",fontSize:10,fontFamily:mono,color:C.textMuted}}>
            {[
              ["studio","Wrangling",C.teal],
              ["output","Output",C.gold],
              ["explorer","Evidence Explorer",C.violet],
              ["modeling","Modeling",C.gold],
            ].map(([s,label,accent],i,arr)=>(
              <span key={s} style={{display:"flex",alignItems:"center",gap:6}}>
                <span
                  onClick={()=>{
                    if(s==="studio") setScreen("studio");
                    else if(output) setScreen(s);
                  }}
                  style={{cursor:(s==="studio"||output)?"pointer":"default",color:screen===s?accent:C.textMuted}}>
                  {label}
                </span>
                {i<arr.length-1&&<span style={{color:C.border2}}>→</span>}
              </span>
            ))}
          </div>
        )}
        {["studio","explorer","modeling"].includes(screen)&&filename&&(
          <span style={{fontSize:11,color:C.textDim,fontFamily:mono,marginLeft:4}}>{filename}</span>
        )}
        {screen==="studio"&&<span style={{fontSize:10,color:C.textMuted,fontFamily:mono,marginLeft:"auto"}}>autosaved ✓</span>}
        {screen==="modeling"&&output&&(
          <span style={{fontSize:9,color:C.teal,fontFamily:mono,marginLeft:"auto",letterSpacing:"0.12em"}}>
            ◈ MODELING LAB · {output.cleanRows.length} obs
          </span>
        )}
      </div>

      {/* ── Main Content ──────────────────────────────────────────────────── */}
      <div style={{flex:1,minHeight:0,overflowY:["studio","explorer","modeling"].includes(screen)?"hidden":"auto"}}>
        {screen==="dashboard"&&(
          <Dashboard onNew={()=>setScreen("upload")} onLoad={handleLoad}/>
        )}
        {screen==="upload"&&(
          <Uploader onReady={handleReady}/>
        )}
        {screen==="studio"&&rawData&&(
        <DataStudio
         rawData={rawData}
         filename={filename}
         pid={pid}
          onComplete={r=>{setOutput(r);setScreen("output");}}
          />
          )}
        {screen==="output"&&output&&(
          <OutputReview
            result={output}
            onBack={()=>setScreen("studio")}
            onExplore={()=>setScreen("explorer")}
          />
        )}
        {screen==="explorer"&&output&&(
          <ExplorerModule
            cleanedData={output}
            onBack={()=>setScreen("studio")}
            onProceed={()=>setScreen("modeling")}
          />
        )}
        {screen==="modeling"&&output&&(
          // ModelingTab uses minHeight:100vh internally which escapes a flex
          // parent and hides the Estimate button below the viewport.
          // This wrapper gives it an explicit height so both its internal
          // panels (left spec + right results) scroll independently.
          <div style={{
            height:"calc(100vh - 38px)",
            display:"flex",
            flexDirection:"column",
            overflow:"hidden",
          }}>
            <ModelingTab
              cleanedData={output}
              onBack={()=>setScreen("explorer")}
            />
          </div>
        )}
      </div>
    </div>
  );
}
