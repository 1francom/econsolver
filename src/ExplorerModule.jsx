// ─── ECON STUDIO · ExplorerModule.jsx ────────────────────────────────────────
// Evidence Explorer: EDA, distributions, correlation heatmap, AI insights.
// Consumes cleanedData emitted by WranglingModule.
import { useState, useMemo, useRef, useEffect, Fragment } from "react";
import { extractAllRows } from "./services/data/duckdb.js";
import { useTheme } from "./ThemeContext.jsx";

const arrMin = (a, fb = 0) => a.length ? a.reduce((m, v) => v < m ? v : m, a[0]) : fb;
const arrMax = (a, fb = 1) => a.length ? a.reduce((m, v) => v > m ? v : m, a[0]) : fb;
import { buildInfo } from "./WranglingModule.jsx";
import { computeACF, computePACF, adfTest } from "./math/timeSeries.js";
import { pnorm } from "./math/calcEngine.js";
import PlotBuilder from "./components/PlotBuilder.jsx";
import { HintBox } from "./components/HelpSystem.jsx";
import PlotExportBar from "./components/shared/PlotExportBar.jsx";
import { generateCleanScript } from "./pipeline/exporter.js";
import { callClaude } from "./services/AI/AIService.js";
import { useSessionLogOptional } from "./services/session/sessionLog.jsx";

// ─── THEME ────────────────────────────────────────────────────────────────────
// ─── ATOMS ────────────────────────────────────────────────────────────────────
function Lbl({children,color,mb=6}){const{C,T}=useTheme();color=color??C.textMuted;return<div style={{fontSize: T.caption.fontSize,color,letterSpacing:"0.2em",textTransform:"uppercase",marginBottom:mb,fontFamily:T.label.fontFamily}}>{children}</div>;}
function Btn({onClick,ch,color,v="out",dis=false,sm=false}){
  const{C,T}=useTheme();color=color??C.gold;
  const b={padding:sm?"0.28rem 0.65rem":"0.48rem 0.95rem",borderRadius:3,cursor:dis?"not-allowed":"pointer",fontFamily: T.code.fontFamily,fontSize: sm ? T.caption.fontSize : T.code.fontSize,transition:"all 0.13s",opacity:dis?0.4:1};
  if(v==="solid")return<button onClick={onClick} disabled={dis} style={{...b,background:color,color:C.bg,border:`1px solid ${color}`,fontWeight:700}}>{ch}</button>;
  return<button onClick={onClick} disabled={dis} style={{...b,background:"transparent",border:`1px solid ${C.border2}`,color:dis?C.textMuted:C.textDim}}>{ch}</button>;
}
function Spin(){const{C,T}=useTheme();return<div style={{width:14,height:14,border:`2px solid ${C.border2}`,borderTopColor:C.gold,borderRadius:"50%",animation:"spin 0.7s linear infinite",flexShrink:0}}/>;}

// ─── PIN FOR REPLICATION (Fase 1.3, D5) ──────────────────────────────────────
// Explore is exploratory by default — nothing is logged automatically. This
// button lets the user pin the CURRENT view (plot config or descriptive stat,
// with its exact arguments) as an `explore_stat` event on the execution
// timeline, making it part of the replication script.
function PinBtn({ onClick, title = "Pin this view to the replication timeline" }) {
  const { C, T } = useTheme();
  const [done, setDone] = useState(false);
  return (
    <button
      onClick={() => { onClick?.(); setDone(true); setTimeout(() => setDone(false), 1800); }}
      title={title}
      style={{ padding: "0.2rem 0.55rem", borderRadius: 3, cursor: "pointer", flexShrink: 0,
               fontFamily: T.code.fontFamily, fontSize: T.caption.fontSize, transition: "all 0.12s",
               border: `1px solid ${done ? C.teal : C.border2}`,
               background: done ? `${C.teal}15` : "transparent",
               color: done ? C.teal : C.textDim }}>
      {done ? "Pinned ✓" : "⊕ Pin"}
    </button>
  );
}

// ─── MINI MATH ────────────────────────────────────────────────────────────────
function olsSimple(xs,ys){
  const n=xs.length;if(n<2)return{b0:0,b1:0,r2:0};
  const mx=xs.reduce((a,b)=>a+b,0)/n,my=ys.reduce((a,b)=>a+b,0)/n;
  let ssxy=0,ssxx=0,ssyy=0;
  for(let i=0;i<n;i++){ssxy+=(xs[i]-mx)*(ys[i]-my);ssxx+=(xs[i]-mx)**2;ssyy+=(ys[i]-my)**2;}
  const b1=ssxx?ssxy/ssxx:0,b0=my-b1*mx;
  const r2=ssyy?(1-xs.map((x,i)=>(ys[i]-(b0+b1*x))**2).reduce((a,b)=>a+b,0)/ssyy):0;
  return{b0,b1,r2};
}
function pearson(xs,ys){
  const n=xs.length;if(n<2)return 0;
  const mx=xs.reduce((a,b)=>a+b,0)/n,my=ys.reduce((a,b)=>a+b,0)/n;
  let sxy=0,sx=0,sy=0;
  for(let i=0;i<n;i++){sxy+=(xs[i]-mx)*(ys[i]-my);sx+=(xs[i]-mx)**2;sy+=(ys[i]-my)**2;}
  return(sx&&sy)?sxy/Math.sqrt(sx*sy):0;
}

// ─── SVG CHARTS ───────────────────────────────────────────────────────────────
function SvgHistogram({data,color,label="",nBins=20,fillMode="filled"}){
  const{C,T}=useTheme();color=color??C.gold;
  const W=480,H=160,PAD={l:44,r:16,t:8,b:36};
  const iW=W-PAD.l-PAD.r,iH=H-PAD.t-PAD.b;
  if(!data.length)return null;
  const min=arrMin(data),max=arrMax(data);
  const range=max-min||1;
  const bw=range/nBins;
  const counts=Array(nBins).fill(0);
  data.forEach(v=>{const b=Math.min(nBins-1,Math.floor((v-min)/bw));counts[b]++;});
  const maxC=Math.max(...counts,1);
  const barW=iW/nBins;
  const yTicks=[0,0.25,0.5,0.75,1].map(f=>Math.round(f*maxC));
  return(
    <svg viewBox={`0 0 ${W} ${H}`} style={{width:"100%",maxWidth:600,display:"block",fontFamily: T.code.fontFamily}}>
      <rect width={W} height={H} fill="transparent"/>
      {/* y grid + ticks */}
      {yTicks.map((t,i)=>{
        const y=PAD.t+iH-(t/maxC)*iH;
        return<g key={i}>
          <line x1={PAD.l} x2={PAD.l+iW} y1={y} y2={y} stroke={C.border} strokeWidth={1} strokeDasharray="3 3" opacity={0.4}/>
          <text x={PAD.l-4} y={y+3} textAnchor="end" fill={C.textMuted} fontSize={T.caption.fontSize} fontFamily={T.data.fontFamily}>{t}</text>
        </g>;
      })}
      {/* bars */}
      {counts.map((c,i)=>{
        const x=PAD.l+i*barW,h=(c/maxC)*iH,y=PAD.t+iH-h;
        return fillMode==="outline"
          ?<rect key={i} x={x+1} y={y} width={barW-2} height={h} fill="none" stroke={color} strokeWidth={1.5} rx={1}/>
          :<rect key={i} x={x+1} y={y} width={barW-2} height={h} fill={color} opacity={0.75} rx={1}/>;
      })}
      {/* x axis */}
      <line x1={PAD.l} y1={PAD.t+iH} x2={PAD.l+iW} y2={PAD.t+iH} stroke={C.border2} strokeWidth={1}/>
      {/* x labels at 0, 25, 50, 75, 100% */}
      {[0,0.25,0.5,0.75,1].map((f,i)=>{
        const v=min+f*range;
        return<text key={i} x={PAD.l+f*iW} y={PAD.t+iH+12} textAnchor="middle" fill={C.textMuted} fontSize={T.caption.fontSize} fontFamily={T.data.fontFamily}>
          {Math.abs(v)>=1000?v.toExponential(1):v.toFixed(2)}
        </text>;
      })}
      {label&&<text x={PAD.l+iW/2} y={H-2} fill={C.textDim} fontSize={T.caption.fontSize} fontFamily={T.data.fontFamily} textAnchor="middle">{label}</text>}
    </svg>
  );
}

// ─── CATEGORICAL BAR CHART ────────────────────────────────────────────────────
function SvgBarChart({items,color,fillMode="filled"}){
  // items: [{label, count}] already sorted
  const{C,T}=useTheme();
  if(!items?.length)return null;
  const W=480,barH=22,PAD={l:120,r:48,t:8,b:16};
  const H=PAD.t+items.length*barH+PAD.b;
  const maxV=Math.max(...items.map(d=>d.count),1);
  const iW=W-PAD.l-PAD.r;
  return(
    <svg viewBox={`0 0 ${W} ${H}`} style={{width:"100%",maxWidth:600,display:"block",fontFamily: T.code.fontFamily}}>
      <rect width={W} height={H} fill="transparent"/>
      {items.map((d,i)=>{
        const y=PAD.t+i*barH;
        const bw=Math.max(2,(d.count/maxV)*iW);
        return<g key={i}>
          <text x={PAD.l-6} y={y+barH/2+4} textAnchor="end" fill={C.textDim} fontSize={T.caption.fontSize} fontFamily={T.data.fontFamily}>{String(d.label).slice(0,18)}</text>
          {fillMode==="outline"
            ?<rect x={PAD.l} y={y+3} width={bw} height={barH-6} fill="none" stroke={color} strokeWidth={1.5} rx={2}/>
            :<rect x={PAD.l} y={y+3} width={bw} height={barH-6} fill={color} opacity={0.75} rx={2}/>}
          <text x={PAD.l+bw+4} y={y+barH/2+4} fill={C.textMuted} fontSize={T.caption.fontSize} fontFamily={T.data.fontFamily}>{d.count}</text>
        </g>;
      })}
      <line x1={PAD.l} y1={PAD.t} x2={PAD.l} y2={PAD.t+items.length*barH} stroke={C.border2} strokeWidth={1}/>
    </svg>
  );
}


function SvgSpaghetti({rows,entityCol,timeCol,col,sampleN=15}){
  const{C,T}=useTheme();
  const W=380,H=200,PAD=36;
  const entities=[...new Set(rows.map(r=>r[entityCol]))];
  const seed=entities.length;
  const sampled=entities.slice().sort(()=>Math.sin(seed)*0.5).slice(0,sampleN);
  const times=[...new Set(rows.map(r=>r[timeCol]))].sort((a,b)=>a-b);
  if(times.length<2||sampled.length<2)return<div style={{fontSize: T.code.fontSize,color:C.textMuted,fontFamily: T.code.fontFamily}}>Need ≥2 periods and ≥2 units.</div>;
  const allVals=rows.filter(r=>sampled.includes(r[entityCol])&&typeof r[col]==="number").map(r=>r[col]);
  if(!allVals.length)return null;
  const minV=arrMin(allVals),maxV=arrMax(allVals);
  const rV=maxV-minV||1;
  const toX=t=>PAD+(times.indexOf(t)/(times.length-1))*(W-PAD*2);
  const toY=v=>(H-PAD)-(v-minV)/rV*(H-PAD*2);
  const palette=[C.teal,C.gold,C.blue,C.purple,C.orange,C.green,C.red,C.violet,C.yellow,"#8ecac8","#c8b46e","#9eb896"];
  return(
    <svg viewBox={`0 0 ${W} ${H}`} style={{width:"100%",maxWidth:W,display:"block",fontFamily: T.code.fontFamily}}>
      <line x1={PAD} y1={PAD} x2={PAD} y2={H-PAD} stroke={C.border2} strokeWidth={1}/>
      <line x1={PAD} y1={H-PAD} x2={W-PAD} y2={H-PAD} stroke={C.border2} strokeWidth={1}/>
      {times.map(t=><line key={t} x1={toX(t)} y1={PAD} x2={toX(t)} y2={H-PAD} stroke={C.border} strokeWidth={1} strokeDasharray="2,4"/>)}
      {sampled.map((e,ei)=>{
        const pts=times.map(t=>{const r=rows.find(r=>r[entityCol]===e&&r[timeCol]===t);return r&&typeof r[col]==="number"?{x:toX(t),y:toY(r[col])}:null;}).filter(Boolean);
        if(pts.length<2)return null;
        const d=pts.map((p,i)=>`${i===0?"M":"L"}${p.x},${p.y}`).join(" ");
        return<path key={e} d={d} fill="none" stroke={palette[ei%palette.length]} strokeWidth={1.4} opacity={0.75}/>;
      })}
      {times.map(t=><text key={t} x={toX(t)} y={H-PAD+12} fill={C.textMuted} fontSize={T.caption.fontSize} fontFamily={T.data.fontFamily} textAnchor="middle">{t}</text>)}
      <text x={PAD-4} y={PAD} fill={C.textMuted} fontSize={T.caption.fontSize} fontFamily={T.data.fontFamily} textAnchor="end">{maxV.toFixed(1)}</text>
      <text x={PAD-4} y={H-PAD} fill={C.textMuted} fontSize={T.caption.fontSize} fontFamily={T.data.fontFamily} textAnchor="end">{minV.toFixed(1)}</text>
    </svg>
  );
}

function CorrHeatmap({headers,rows,info}){
  const{C,T}=useTheme();
  const numH=headers.filter(h=>info[h]?.isNum&&info[h]?.mean!=null);
  if(numH.length<2)return<div style={{fontSize: T.code.fontSize,color:C.textMuted,fontFamily: T.code.fontFamily}}>Need ≥2 numeric columns.</div>;
  const mat=numH.map(h1=>numH.map(h2=>{
    const pairs=rows.filter(r=>typeof r[h1]==="number"&&typeof r[h2]==="number");
    return pearson(pairs.map(r=>r[h1]),pairs.map(r=>r[h2]));
  }));
  const cellSz=Math.min(44,Math.floor(380/numH.length));
  const lblH=60;
  const W=lblH+numH.length*cellSz,H_total=lblH+numH.length*cellSz;
  const corToColor=v=>{
    const abs=Math.abs(v);
    if(v>0)return`rgba(110,200,180,${abs*0.9})`;
    return`rgba(196,112,112,${abs*0.9})`;
  };
  return(
    <div style={{overflowX:"auto"}}>
      <svg viewBox={`0 0 ${W+8} ${H_total+8}`} style={{width:"100%",maxWidth:W+8,display:"block",fontFamily: T.code.fontFamily}}>
        {numH.map((h,i)=>(
          <text key={h} x={lblH+i*cellSz+cellSz/2} y={lblH-4} fill={C.textDim} fontSize={Math.max(6,Math.min(9,cellSz/4))} fontFamily={T.data.fontFamily} textAnchor="middle" transform={`rotate(-35,${lblH+i*cellSz+cellSz/2},${lblH-4})`}>{h.slice(0,8)}</text>
        ))}
        {numH.map((h,i)=>(
          <text key={h} x={lblH-4} y={lblH+i*cellSz+cellSz/2+3} fill={C.textDim} fontSize={Math.max(6,Math.min(9,cellSz/4))} fontFamily={T.data.fontFamily} textAnchor="end">{h.slice(0,8)}</text>
        ))}
        {mat.map((row,ri)=>row.map((v,ci)=>(
          <g key={`${ri}-${ci}`}>
            <rect x={lblH+ci*cellSz} y={lblH+ri*cellSz} width={cellSz-1} height={cellSz-1} fill={corToColor(v)} rx={2}/>
            {cellSz>28&&<text x={lblH+ci*cellSz+cellSz/2} y={lblH+ri*cellSz+cellSz/2+4} fill={C.text} fontSize={Math.max(6,Math.min(9,cellSz/5))} fontFamily={T.data.fontFamily} textAnchor="middle" opacity={0.9}>{v.toFixed(2)}</text>}
          </g>
        )))}
      </svg>
      <div style={{display:"flex",gap:12,marginTop:8,alignItems:"center"}}>
        <span style={{fontSize: T.caption.fontSize,color:C.textMuted,fontFamily: T.code.fontFamily}}>← negative (red)</span>
        <div style={{flex:1,height:6,borderRadius:3,background:`linear-gradient(to right,${C.red},${C.surface3},${C.teal})`}}/>
        <span style={{fontSize: T.caption.fontSize,color:C.textMuted,fontFamily: T.code.fontFamily}}>positive (teal) →</span>
      </div>
    </div>
  );
}

// ─── SUMMARY TABLE (Table 1) ──────────────────────────────────────────────────
function SummaryTable({rows,headers,info,panel,onPin}){
  const{C,T}=useTheme();
  const numH=headers.filter(h=>info[h]?.isNum&&info[h]?.mean!=null);
  const catH=headers.filter(h=>info[h]?.isCat&&!info[h]?.isNum);
  const [groupBy,  setGroupBy]  = useState("");
  const [view,     setView]     = useState("stats"); // "stats"|"head"|"tail"
  const [viewN,    setViewN]    = useState(6);
  const [extraQs,  setExtraQs]  = useState([]);      // custom percentiles e.g. [5,95]
  const [qInput,   setQInput]   = useState("");
  const groups=groupBy?[...new Set(rows.map(r=>r[groupBy]).filter(v=>v!=null))].sort():["All"];

  function qtile(sorted,p){
    if(!sorted.length)return null;
    const i=p*(sorted.length-1),lo=Math.floor(i),hi=Math.ceil(i);
    return lo===hi?sorted[lo]:sorted[lo]+(sorted[hi]-sorted[lo])*(i-lo);
  }
  function statsFor(subset,col){
    const vals=subset.map(r=>r[col]).filter(v=>typeof v==="number"&&isFinite(v)).sort((a,b)=>a-b);
    if(!vals.length)return{mean:null,std:null,min:null,max:null,median:null,q1:null,q3:null,n:0};
    const mean=vals.reduce((a,b)=>a+b,0)/vals.length;
    const std=Math.sqrt(vals.reduce((s,v)=>s+(v-mean)**2,0)/vals.length);
    const extra={};
    extraQs.forEach(p=>{extra[`p${p}`]=qtile(vals,p/100);});
    return{mean,std,min:vals[0],max:vals[vals.length-1],median:qtile(vals,0.5),q1:qtile(vals,0.25),q3:qtile(vals,0.75),n:vals.length,...extra};
  }
  function addQ(){
    const p=parseInt(qInput,10);
    if(!isNaN(p)&&p>0&&p<100&&!extraQs.includes(p))setExtraQs(q=>[...q,p].sort((a,b)=>a-b));
    setQInput("");
  }

  const fmt=v=>v!=null?v.toFixed(3):"—";
  const [copiedExport,setCopiedExport]=useState("");

  function buildRows(){
    return numH.map(h=>{
      const subset=groupBy?null:rows;
      return{h,groups:groups.map(g=>{
        const sub=groupBy?rows.filter(r=>r[groupBy]===g):rows;
        return{g,s:statsFor(sub,h)};
      })};
    });
  }

  function copyCSV(){
    const tblRows=buildRows();
    const hdr=["Variable",...groups.flatMap(g=>allCols.map(([k,l])=>groupBy?`${g}_${l}`:l))];
    const lines=[hdr.join(","),...tblRows.map(({h,groups:grs})=>[
      h,...grs.flatMap(({s})=>allCols.map(([k])=>s[k]!=null?s[k].toFixed(3):""))
    ].join(","))];
    navigator.clipboard?.writeText(lines.join("\n")).then(()=>{setCopiedExport("csv");setTimeout(()=>setCopiedExport(""),2000);});
  }

  function copyLatex(){
    const tblRows=buildRows();
    const nDataCols=groups.length*allCols.length;
    const lines=[
      `\\begin{tabular}{l${"r".repeat(nDataCols)}}`,
      `\\toprule`,
    ];
    if(groupBy){
      lines.push(`Variable & ${groups.map(g=>`\\multicolumn{${allCols.length}}{c}{${g}}`).join(" & ")} \\\\`);
      lines.push(`\\cmidrule(lr){2-${nDataCols+1}}`);
    }
    lines.push(`Variable & ${groups.flatMap(()=>allCols.map(([,l])=>l)).join(" & ")} \\\\`);
    lines.push(`\\midrule`);
    tblRows.forEach(({h,groups:grs})=>{
      lines.push(`${h} & ${grs.flatMap(({s})=>allCols.map(([k])=>s[k]!=null?s[k].toFixed(3):"—")).join(" & ")} \\\\`);
    });
    lines.push(`\\bottomrule`);
    lines.push(`\\end{tabular}`);
    navigator.clipboard?.writeText(lines.join("\n")).then(()=>{setCopiedExport("latex");setTimeout(()=>setCopiedExport(""),2000);});
  }

  // Column order matches R summary(): Min | Q1 | Median | Mean | Q3 | Max | SD
  const baseCols=[["min","Min"],["q1","Q1"],["median","Median"],["mean","Mean"],["q3","Q3"],["max","Max"],["std","SD"]];
  const extraCols=extraQs.map(p=>[`p${p}`,`P${p}`]);
  const allCols=[...baseCols,...extraCols];
  const nCols=allCols.length;

  const thS={padding:"0.35rem 0.6rem",fontFamily: T.code.fontFamily,fontSize: T.caption.fontSize,color:C.textMuted,fontWeight:400,letterSpacing:"0.1em",textTransform:"uppercase",borderBottom:`1px solid ${C.border}`,background:C.surface2,textAlign:"right",whiteSpace:"nowrap"};
  const tdS={padding:"0.32rem 0.6rem",fontFamily: T.code.fontFamily,fontSize: T.caption.fontSize,color:C.text,borderBottom:`1px solid ${C.border}`,textAlign:"right",whiteSpace:"nowrap"};
  const chipBtn=(active,color,onClick,label)=>(
    <button onClick={onClick} style={{padding:"0.22rem 0.6rem",border:`1px solid ${active?color:C.border2}`,background:active?`${color}18`:"transparent",color:active?color:C.textDim,borderRadius:3,cursor:"pointer",fontSize: T.caption.fontSize,fontFamily: T.code.fontFamily}}>{label}</button>
  );

  const previewRows=view==="head"?rows.slice(0,viewN):view==="tail"?rows.slice(-viewN):[];
  const prevH=headers.slice(0,8);

  return(
    <div>
      {/* ── Toolbar ── */}
      <div style={{marginBottom:"1.2rem",display:"flex",gap:16,alignItems:"center",flexWrap:"wrap"}}>
        {/* Group by */}
        <div style={{display:"flex",gap:8,alignItems:"center"}}>
          <Lbl mb={0}>Group by</Lbl>
          <div style={{display:"flex",gap:4,flexWrap:"wrap"}}>
            {chipBtn(!groupBy,C.gold,()=>setGroupBy(""),"None")}
            {catH.map(h=>chipBtn(groupBy===h,C.gold,()=>setGroupBy(h),h))}
          </div>
        </div>
        <div style={{width:1,height:20,background:C.border,flexShrink:0}}/>
        {/* View */}
        <div style={{display:"flex",gap:8,alignItems:"center"}}>
          <Lbl mb={0}>View</Lbl>
          <div style={{display:"flex",gap:4,alignItems:"center"}}>
            {[["stats","Stats"],["head","head(n)"],["tail","tail(n)"]].map(([k,l])=>chipBtn(view===k,C.teal,()=>setView(k),l))}
            {view!=="stats"&&<input type="number" min={1} max={500} value={viewN} onChange={e=>setViewN(Math.max(1,parseInt(e.target.value)||6))}
              style={{width:44,padding:"0.2rem 0.4rem",background:C.surface2,border:`1px solid ${C.border2}`,borderRadius:3,color:C.text,fontFamily: T.code.fontFamily,fontSize: T.caption.fontSize,outline:"none"}}/>}
          </div>
        </div>
        {/* Custom quantiles — only in stats view */}
        {view==="stats"&&<><div style={{width:1,height:20,background:C.border,flexShrink:0}}/>
        <div style={{display:"flex",gap:8,alignItems:"center"}}>
          <Lbl mb={0}>Quantiles</Lbl>
          <div style={{display:"flex",gap:4,alignItems:"center",flexWrap:"wrap"}}>
            {extraQs.map(p=>(
              <span key={p} style={{display:"flex",alignItems:"center",gap:2,padding:"0.18rem 0.5rem",border:`1px solid ${C.teal}60`,borderRadius:3,fontSize: T.caption.fontSize,fontFamily: T.code.fontFamily,color:C.teal}}>
                P{p}<button onClick={()=>setExtraQs(q=>q.filter(x=>x!==p))} style={{background:"none",border:"none",cursor:"pointer",color:C.textMuted,fontSize: T.code.fontSize,lineHeight:1,padding:"0 0 0 3px"}}>×</button>
              </span>
            ))}
            <input type="number" min={1} max={99} value={qInput} onChange={e=>setQInput(e.target.value)}
              onKeyDown={e=>e.key==="Enter"&&addQ()} placeholder="%"
              style={{width:40,padding:"0.2rem 0.4rem",background:C.surface2,border:`1px solid ${C.border2}`,borderRadius:3,color:C.text,fontFamily: T.code.fontFamily,fontSize: T.caption.fontSize,outline:"none"}}/>
            <button onClick={addQ} style={{padding:"0.2rem 0.5rem",border:`1px solid ${C.border2}`,borderRadius:3,background:"transparent",color:C.textDim,fontFamily: T.code.fontFamily,fontSize: T.caption.fontSize,cursor:"pointer"}}>+P</button>
          </div>
        </div></>}
        {onPin&&<><div style={{flex:1}}/>
        <PinBtn onClick={()=>{
          if(view==="stats") onPin(
            {kind:"summary",columns:numH,groupBy:groupBy||null,percentiles:extraQs.length?extraQs:null},
            `Summary stats (${numH.length} vars${groupBy?`, by ${groupBy}`:""}${extraQs.length?`, P${extraQs.join("/P")}`:""})`);
          else onPin({kind:view,n:viewN},`${view}(${viewN})`);
        }}/></>}
      </div>

      {/* ── Stats table ── */}
      {view==="stats"&&(
        <div style={{overflowX:"auto",borderRadius:4,border:`1px solid ${C.border}`}}>
          <table style={{borderCollapse:"collapse",width:"100%",fontSize: T.code.fontSize}}>
            <thead>
              <tr>
                <th style={{...thS,textAlign:"left",minWidth:80}}>Variable</th>
                {groups.map(g=><th key={g} colSpan={nCols} style={{...thS,textAlign:"center",color:C.gold}}>
                  {groupBy?String(g):"Full sample"}{groupBy&&<span style={{color:C.textMuted}}> ({rows.filter(r=>r[groupBy]===g).length})</span>}
                </th>)}
              </tr>
              <tr>
                <th style={{...thS,textAlign:"left"}}/>
                {groups.map(g=><Fragment key={g}>{allCols.map(([k,l])=><th key={k} style={thS}>{l}</th>)}</Fragment>)}
              </tr>
            </thead>
            <tbody>
              {numH.map((h,ri)=>(
                <tr key={h} style={{background:ri%2?C.surface2:C.surface}}>
                  <td style={{...tdS,textAlign:"left",color:C.teal}}>{h}</td>
                  {groups.map(g=>{
                    const subset=groupBy?rows.filter(r=>r[groupBy]===g):rows;
                    const s=statsFor(subset,h);
                    return <Fragment key={g}>{allCols.map(([k])=><td key={k} style={tdS}>{fmt(s[k])}</td>)}</Fragment>;
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* ── head / tail preview ── */}
      {view!=="stats"&&(
        <div style={{overflowX:"auto",borderRadius:4,border:`1px solid ${C.border}`}}>
          <table style={{borderCollapse:"collapse",width:"100%",fontSize: T.code.fontSize}}>
            <thead>
              <tr>
                <th style={{...thS,textAlign:"right",minWidth:32}}>#</th>
                {prevH.map(h=><th key={h} style={thS}>{h}</th>)}
                {headers.length>8&&<th style={{...thS,color:C.textMuted}}>+{headers.length-8}</th>}
              </tr>
            </thead>
            <tbody>
              {previewRows.map((row,ri)=>{
                const absIdx=view==="head"?ri:rows.length-viewN+ri;
                return(
                  <tr key={ri} style={{background:ri%2?C.surface2:C.surface}}>
                    <td style={{...tdS,textAlign:"right",color:C.textMuted}}>{absIdx+1}</td>
                    {prevH.map(h=>{const v=row[h];return<td key={h} style={{...tdS,color:typeof v==="number"?C.blue:C.text}}>{v==null?"—":typeof v==="number"?v.toFixed(3):String(v)}</td>;})}
                    {headers.length>8&&<td style={tdS}/>}
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      <div style={{marginTop:8,display:"flex",alignItems:"center",gap:12,flexWrap:"wrap"}}>
        <span style={{fontSize: T.caption.fontSize,color:C.textMuted,fontFamily: T.code.fontFamily}}>
          {view==="stats"?`N=${rows.length} total observations · ${numH.length} numeric variables`:`Showing ${view}(${viewN}) of ${rows.length} rows`}
        </span>
        {view==="stats"&&numH.length>0&&<>
          {[["csv","CSV"],["latex","LaTeX"]].map(([id,label])=>(
            <button key={id} onClick={id==="csv"?copyCSV:copyLatex}
              style={{padding:"2px 10px",fontFamily: T.code.fontFamily,fontSize: T.caption.fontSize,letterSpacing:"0.08em",border:`1px solid ${copiedExport===id?C.teal:C.border2}`,borderRadius:2,background:copiedExport===id?`${C.teal}1a`:"transparent",color:copiedExport===id?C.teal:C.textMuted,cursor:"pointer"}}>
              {copiedExport===id?"✓":label}
            </button>
          ))}
        </>}
      </div>
    </div>
  );
}

// ─── DISPERSION PANEL (B1 — overdispersion / count diagnostics) ───────────────
function DispersionPanel({rows,headers,info,onPin}){
  const{C,T}=useTheme();
  const[open,setOpen]=useState(false);
  const[col,setCol]=useState("");
  const numCols=useMemo(()=>headers.filter(h=>info[h]?.isNum&&info[h]?.mean!=null),[headers,info]);
  const effCol=numCols.includes(col)?col:(numCols[0]??"");

  const res=useMemo(()=>{
    if(!effCol)return null;
    const vals=rows.map(r=>r[effCol]).filter(v=>typeof v==="number"&&isFinite(v)&&v>=0);
    const n=vals.length;
    if(n<10)return{error:"Need ≥10 non-negative values."};
    const mu=vals.reduce((s,v)=>s+v,0)/n;
    if(mu<=0)return{error:"Mean must be positive."};
    const varVal=vals.reduce((s,v)=>s+(v-mu)**2,0)/(n-1);
    const ratio=varVal/mu;
    // Cameron-Trivedi (1990) auxiliary regression: z_i = ((y_i-μ)²-y_i)/μ, t-stat of intercept
    const zi=vals.map(v=>((v-mu)**2-v)/mu);
    const zMean=zi.reduce((s,v)=>s+v,0)/n;
    const zVar=zi.reduce((s,v)=>s+(v-zMean)**2,0)/(n-1);
    const ctStat=zMean/Math.sqrt(zVar/n);
    const pVal=Math.max(0,1-pnorm(ctStat)); // one-sided H₁: overdispersed
    return{n,mu,varVal,ratio,ctStat,pVal};
  },[effCol,rows]);

  const fld={background:C.surface2,border:`1px solid ${C.border2}`,borderRadius:3,color:C.text,fontFamily:T.code.fontFamily,fontSize:T.code.fontSize,padding:"0.28rem 0.55rem",outline:"none"};
  const f=v=>typeof v==="number"&&isFinite(v)?v.toFixed(4):"—";

  return(
    <div style={{border:`1px solid ${C.border}`,borderRadius:4,overflow:"hidden",marginTop:"1.4rem"}}>
      <div onClick={()=>setOpen(o=>!o)} style={{background:C.surface2,padding:"0.55rem 0.85rem",borderBottom:open?`1px solid ${C.border}`:"none",cursor:"pointer",display:"flex",alignItems:"center",gap:8}}>
        <span style={{fontSize:T.caption.fontSize,color:C.textMuted}}>{open?"▾":"▸"}</span>
        <span style={{fontSize:T.caption.fontSize,color:C.textDim,letterSpacing:"0.2em",textTransform:"uppercase",fontFamily:T.code.fontFamily}}>Count Diagnostics</span>
        <span style={{marginLeft:"auto",fontSize:T.caption.fontSize,color:C.textMuted}}>var/mean · Cameron-Trivedi</span>
        {onPin&&open&&effCol&&<span onClick={e=>e.stopPropagation()}>
          <PinBtn onClick={()=>onPin({kind:"overdispersion",col:effCol,test:"cameron-trivedi"},`Overdispersion check: ${effCol} (var/mean + CT)`)}/>
        </span>}
      </div>
      {open&&(
        <div style={{padding:"0.85rem",background:C.surface,display:"flex",flexDirection:"column",gap:10}}>
          <div style={{display:"flex",gap:8,alignItems:"center",flexWrap:"wrap"}}>
            <span style={{fontSize:T.caption.fontSize,color:C.textMuted,fontFamily:T.code.fontFamily,letterSpacing:"0.14em",textTransform:"uppercase"}}>Column</span>
            <select value={effCol} onChange={e=>setCol(e.target.value)} style={fld}>
              {numCols.map(h=><option key={h} value={h}>{h}</option>)}
            </select>
          </div>
          {res?.error&&<div style={{fontFamily:T.code.fontFamily,fontSize:T.caption.fontSize,color:C.red}}>{res.error}</div>}
          {res&&!res.error&&(
            <div style={{background:`${C.gold}0a`,border:`1px solid ${C.gold}30`,borderRadius:3,padding:"0.65rem 0.9rem",fontFamily:T.code.fontFamily,fontSize:T.code.fontSize,color:C.text,lineHeight:1.9}}>
              <div><span style={{color:C.textMuted}}>n = </span>{res.n}<span style={{color:C.textMuted}}>  ·  mean = </span>{f(res.mu)}<span style={{color:C.textMuted}}>  ·  var = </span>{f(res.varVal)}</div>
              <div>
                <span style={{color:C.textMuted}}>var/mean = </span>
                <span style={{color:res.ratio>1?C.red:C.teal,fontSize:T.body.fontSize}}>{f(res.ratio)}</span>
                <span style={{color:C.textMuted}}>  {res.ratio>2?"(strong overdispersion)":res.ratio>1.2?"(moderate overdispersion)":res.ratio<=1?"(equidispersed/underdispersed)":"(mild overdispersion)"}  </span>
              </div>
              <div>
                <span style={{color:C.textMuted}}>CT z = </span>
                <span style={{color:C.gold}}>{f(res.ctStat)}</span>
                <span style={{color:C.textMuted}}>  ·  p (one-sided) = </span>
                <span style={{color:res.pVal<0.05?C.teal:C.text}}>{res.pVal<1e-4?"<0.0001":f(res.pVal)}</span>
                {res.pVal<0.05
                  ?<span style={{color:C.red}}>  → overdispersion detected; consider Negative Binomial or QMLE</span>
                  :<span style={{color:C.teal}}>  → fail to reject equidispersion; Poisson is consistent</span>}
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// ─── DISTRIBUTION TAB ─────────────────────────────────────────────────────────
function DistributionTab({rows,headers,info,panel,onPin}){
  const{C,T}=useTheme();
  const palette = [
    { label:"teal",  val:C.teal },
    { label:"gold",  val:C.gold },
    { label:"blue",  val:C.blue },
    { label:"violet",val:C.violet },
    { label:"red",   val:C.red },
    { label:"green", val:C.green },
    { label:"slate", val:C.textDim },
    { label:"white", val:C.text },
  ];
  const numH=headers.filter(h=>info[h]?.isNum&&info[h]?.mean!=null);
  const catH=headers.filter(h=>info[h]?.isCat&&!info[h]?.isNum);
  const [histCol,setHistCol]=useState(numH[0]||"");
  const [catCol,setCatCol]=useState(catH[0]||"");
  const [spagCol,setSpagCol]=useState(numH[0]||"");
  const [sub,setSub]=useState("hist");
  const [barColor,setBarColor]=useState(C.teal);
  const [fillMode,setFillMode]=useState("filled");   // "filled" | "outline"
  const [transform,setTransform]=useState("none");   // "none" | "log" | "log10" | "sqrt"
  const [nBins,setNBins]=useState(20);
  const [catOrder,setCatOrder]=useState("count");    // "count" | "alpha" | "rev"
  const hasPanel=panel?.entityCol&&panel?.timeCol;
  const histRef=useRef(null);
  const subTabs=[
    ["hist","Histogram"],
    ...(catH.length?[["cat","Categorical"]]:[] ),
    ...(hasPanel?[["spaghetti","Spaghetti"]]:[] ),
  ];

  // transform helper
  function applyTransform(v){
    if(transform==="log")  return v>0?Math.log(v):null;
    if(transform==="log10")return v>0?Math.log10(v):null;
    if(transform==="sqrt") return v>=0?Math.sqrt(v):null;
    return v;
  }
  const transformLabel=transform==="none"?"":` (${transform})`;

  // shared style helpers
  const chip=(active,color)=>({
    padding:"0.22rem 0.6rem",border:`1px solid ${active?color:C.border2}`,
    background:active?`${color}18`:"transparent",color:active?color:C.textDim,
    borderRadius:3,cursor:"pointer",fontSize: T.caption.fontSize,fontFamily: T.code.fontFamily,
  });

  return(
    <div>
      {/* sub-tab bar */}
      <div style={{display:"flex",gap:1,background:C.border,borderRadius:4,overflow:"hidden",marginBottom:"1.2rem",alignItems:"center"}}>
        {subTabs.map(([k,l])=><button key={k} onClick={()=>setSub(k)} style={{flex:1,padding:"0.42rem 0.5rem",background:sub===k?`${C.teal}18`:C.surface,border:"none",color:sub===k?C.teal:C.textDim,cursor:"pointer",fontFamily: T.code.fontFamily,fontSize: T.caption.fontSize,borderBottom:sub===k?`2px solid ${C.teal}`:"2px solid transparent",transition:"all 0.12s"}}>{l}</button>)}
        {onPin&&<div style={{padding:"0 6px",background:C.surface}}>
          <PinBtn onClick={()=>{
            if(sub==="hist") onPin({kind:"histogram",col:histCol,bins:nBins,transform:transform==="none"?null:transform},`Histogram: ${histCol} (${nBins} bins${transform!=="none"?", "+transform:""})`);
            else if(sub==="cat") onPin({kind:"barchart",col:catCol,order:catOrder},`Bar chart: ${catCol} (order: ${catOrder})`);
            else onPin({kind:"spaghetti",col:spagCol,entityCol:panel?.entityCol,timeCol:panel?.timeCol},`Spaghetti: ${spagCol} by ${panel?.entityCol} over ${panel?.timeCol}`);
          }}/>
        </div>}
      </div>

      {/* ── HISTOGRAM ── */}
      {sub==="hist"&&(
        <div>
          {/* variable chips */}
          <Lbl>Variable</Lbl>
          <div style={{display:"flex",flexWrap:"wrap",gap:4,marginBottom:"1rem"}}>
            {numH.map(h=><button key={h} onClick={()=>setHistCol(h)} style={chip(histCol===h,C.teal)}>{histCol===h?"✓ ":""}{h}</button>)}
          </div>

          {/* controls row */}
          <div style={{display:"flex",flexWrap:"wrap",gap:"1rem",alignItems:"flex-end",marginBottom:"1rem"}}>
            {/* color palette */}
            <div>
              <div style={{fontSize: T.caption.fontSize,color:C.textMuted,fontFamily: T.code.fontFamily,letterSpacing:"0.15em",textTransform:"uppercase",marginBottom:4}}>Color</div>
              <div style={{display:"flex",gap:3}}>
                {palette.map(p=>(
                  <button key={p.val} onClick={()=>setBarColor(p.val)}
                    style={{width:18,height:18,borderRadius:3,background:p.val,border:`2px solid ${barColor===p.val?C.text:"transparent"}`,cursor:"pointer",padding:0,opacity:barColor===p.val?1:0.6}}/>
                ))}
              </div>
            </div>
            {/* fill vs outline */}
            <div>
              <div style={{fontSize: T.caption.fontSize,color:C.textMuted,fontFamily: T.code.fontFamily,letterSpacing:"0.15em",textTransform:"uppercase",marginBottom:4}}>Fill</div>
              <div style={{display:"flex",gap:2}}>
                {[["filled","Filled"],["outline","Outline"]].map(([k,l])=>(
                  <button key={k} onClick={()=>setFillMode(k)} style={chip(fillMode===k,C.teal)}>{l}</button>
                ))}
              </div>
            </div>
            {/* transform */}
            <div>
              <div style={{fontSize: T.caption.fontSize,color:C.textMuted,fontFamily: T.code.fontFamily,letterSpacing:"0.15em",textTransform:"uppercase",marginBottom:4}}>scale_data</div>
              <div style={{display:"flex",gap:2}}>
                {[["none","None"],["log","ln"],["log10","log₁₀"],["sqrt","√"]].map(([k,l])=>(
                  <button key={k} onClick={()=>setTransform(k)} style={chip(transform===k,C.gold)}>{l}</button>
                ))}
              </div>
            </div>
            {/* bins */}
            <div>
              <div style={{fontSize: T.caption.fontSize,color:C.textMuted,fontFamily: T.code.fontFamily,letterSpacing:"0.15em",textTransform:"uppercase",marginBottom:4}}>scale_break (bins)</div>
              <div style={{display:"flex",alignItems:"center",gap:4}}>
                <input type="range" min={5} max={60} step={1} value={nBins}
                  onChange={e=>setNBins(Number(e.target.value))}
                  style={{width:80,accentColor:C.gold}}/>
                <span style={{fontSize: T.caption.fontSize,color:C.gold,fontFamily: T.code.fontFamily,minWidth:20}}>{nBins}</span>
              </div>
            </div>
          </div>

          {histCol&&(()=>{
            const rawVals=rows.map(r=>r[histCol]).filter(v=>typeof v==="number"&&isFinite(v));
            const vals=rawVals.map(v=>applyTransform(v)).filter(v=>v!=null&&isFinite(v));
            const n=vals.length;
            const mean=n?vals.reduce((s,v)=>s+v,0)/n:null;
            const std=n?Math.sqrt(vals.reduce((s,v)=>s+(v-mean)**2,0)/n):null;
            const sorted=[...vals].sort((a,b)=>a-b);
            const median=n?sorted[Math.floor(n/2)]:null;
            const min=n?sorted[0]:null;
            const max=n?sorted[n-1]:null;
            const q1=sorted[Math.floor(n*0.25)],q3=sorted[Math.floor(n*0.75)],iqr=q3-q1;
            const outlierCount=vals.filter(v=>v<q1-1.5*iqr||v>q3+1.5*iqr).length;
            const histLabel=`${histCol}${transformLabel}`;
            function downloadHistLatex(){
              const bw2=(max-min||1)/nBins;
              // Replicate SvgHistogram binning so LaTeX export matches on-screen plot.
              const counts=Array(nBins).fill(0);
              vals.forEach(v=>{const b=Math.min(nBins-1,Math.max(0,Math.floor((v-min)/bw2)));counts[b]++;});
              const coords=counts.map((c,i)=>`(${(min+i*bw2).toFixed(4)},${c})`).join(" ");
              const tex=`% pgfplots histogram — generated by Econ Studio\n\\begin{figure}[htbp]\n\\centering\n\\begin{tikzpicture}\n\\begin{axis}[\n  title={Histogram of ${histLabel}},\n  xlabel={${histLabel}},\n  ylabel={Count},\n  ybar interval,\n  xtick style={draw=none},\n  ymajorgrids=true,\n  grid style=dashed,\n]\n\\addplot[fill=teal!60,draw=teal!80] coordinates {\n  ${coords}\n};\n\\end{axis}\n\\end{tikzpicture}\n\\caption{Histogram of ${histLabel} (n=${n})}\n\\end{figure}`;
              const a=document.createElement("a");
              a.href=URL.createObjectURL(new Blob([tex],{type:"text/plain"}));
              a.download=`histogram_${histCol}.tex`;
              a.click();URL.revokeObjectURL(a.href);
            }
            return(
              <div>
                <div style={{display:"grid",gridTemplateColumns:"repeat(5,1fr)",gap:1,background:C.border,borderRadius:4,overflow:"hidden",marginBottom:"1rem"}}>
                  {[["mean",mean],["std",std],["median",median],["min",min],["max",max]].map(([l,v])=>(
                    <div key={l} style={{background:C.surface,padding:"0.5rem 0.6rem"}}>
                      <div style={{fontSize: T.caption.fontSize,color:C.textMuted,fontFamily: T.code.fontFamily,letterSpacing:"0.1em",textTransform:"uppercase",marginBottom:2}}>{l}</div>
                      <div style={{fontSize: T.h2.fontSize,color:C.gold,fontFamily: T.code.fontFamily}}>{v!=null?v.toFixed(3):"—"}</div>
                    </div>
                  ))}
                </div>
                <div ref={histRef} style={{border:`1px solid ${C.border}`,borderRadius:4,overflow:"hidden"}}>
                  <div style={{padding:"0.5rem"}}>
                    <SvgHistogram data={vals} color={barColor} label={histLabel} nBins={nBins} fillMode={fillMode}/>
                  </div>
                  <div style={{display:"flex",alignItems:"center",gap:6,padding:"0.3rem 0.65rem",borderTop:`1px solid ${C.border}`,background:C.bg}}>
                    <PlotExportBar getEl={()=>histRef.current?.querySelector("svg")} filename={`histogram_${histCol}`} style={{flex:1,padding:0,background:"transparent",border:"none"}}/>
                    <button onClick={downloadHistLatex} title="Download pgfplots LaTeX" style={{padding:"0.2rem 0.6rem",background:"transparent",border:`1px solid ${C.border2}`,borderRadius:3,color:C.textDim,cursor:"pointer",fontFamily: T.code.fontFamily,fontSize: T.caption.fontSize,flexShrink:0,transition:"all 0.12s"}}
                      onMouseEnter={e=>{e.currentTarget.style.borderColor=C.gold;e.currentTarget.style.color=C.gold;}}
                      onMouseLeave={e=>{e.currentTarget.style.borderColor=C.border2;e.currentTarget.style.color=C.textDim;}}>
                      ↓ LaTeX
                    </button>
                  </div>
                </div>
                {outlierCount>0&&<div style={{marginTop:8,fontSize: T.code.fontSize,color:C.orange,fontFamily: T.code.fontFamily}}>⚠ {outlierCount} IQR-outlier{outlierCount>1?"s":""} detected. Consider winsorizing.</div>}
                {vals.length<rawVals.length&&<div style={{marginTop:6,fontSize: T.caption.fontSize,color:C.textMuted,fontFamily: T.code.fontFamily}}>ℹ {rawVals.length-vals.length} row(s) dropped (non-positive values not valid for {transform} transform).</div>}
              </div>
            );
          })()}
        </div>
      )}

      {/* ── CATEGORICAL ── */}
      {sub==="cat"&&(
        <div>
          <Lbl>Variable</Lbl>
          <div style={{display:"flex",flexWrap:"wrap",gap:4,marginBottom:"1rem"}}>
            {catH.map(h=><button key={h} onClick={()=>setCatCol(h)} style={chip(catCol===h,C.teal)}>{catCol===h?"✓ ":""}{h}</button>)}
          </div>

          {/* controls */}
          <div style={{display:"flex",flexWrap:"wrap",gap:"1rem",alignItems:"flex-end",marginBottom:"1rem"}}>
            <div>
              <div style={{fontSize: T.caption.fontSize,color:C.textMuted,fontFamily: T.code.fontFamily,letterSpacing:"0.15em",textTransform:"uppercase",marginBottom:4}}>Color</div>
              <div style={{display:"flex",gap:3}}>
                {palette.map(p=>(
                  <button key={p.val} onClick={()=>setBarColor(p.val)}
                    style={{width:18,height:18,borderRadius:3,background:p.val,border:`2px solid ${barColor===p.val?C.text:"transparent"}`,cursor:"pointer",padding:0,opacity:barColor===p.val?1:0.6}}/>
                ))}
              </div>
            </div>
            <div>
              <div style={{fontSize: T.caption.fontSize,color:C.textMuted,fontFamily: T.code.fontFamily,letterSpacing:"0.15em",textTransform:"uppercase",marginBottom:4}}>Fill</div>
              <div style={{display:"flex",gap:2}}>
                {[["filled","Filled"],["outline","Outline"]].map(([k,l])=>(
                  <button key={k} onClick={()=>setFillMode(k)} style={chip(fillMode===k,C.teal)}>{l}</button>
                ))}
              </div>
            </div>
            <div>
              <div style={{fontSize: T.caption.fontSize,color:C.textMuted,fontFamily: T.code.fontFamily,letterSpacing:"0.15em",textTransform:"uppercase",marginBottom:4}}>levels = c()</div>
              <div style={{display:"flex",gap:2}}>
                {[["count","By count"],["alpha","A → Z"],["rev","Z → A"]].map(([k,l])=>(
                  <button key={k} onClick={()=>setCatOrder(k)} style={chip(catOrder===k,C.violet)}>{l}</button>
                ))}
              </div>
            </div>
          </div>

          {catCol&&(()=>{
            const freq={};
            rows.forEach(r=>{
              const v=r[catCol];
              if(v==null)return;
              freq[v]=(freq[v]||0)+1;
            });
            let items=Object.entries(freq).map(([label,count])=>({label,count}));
            if(catOrder==="count")      items=items.sort((a,b)=>b.count-a.count);
            else if(catOrder==="alpha") items=items.sort((a,b)=>String(a.label).localeCompare(String(b.label)));
            else if(catOrder==="rev")   items=items.sort((a,b)=>String(b.label).localeCompare(String(a.label)));
            return(
              <div>
                <div style={{fontSize: T.caption.fontSize,color:C.textMuted,fontFamily: T.code.fontFamily,marginBottom:8}}>
                  {items.length} categories · n = {rows.filter(r=>r[catCol]!=null).length}
                </div>
                <SvgBarChart items={items} color={barColor} fillMode={fillMode}/>
              </div>
            );
          })()}
        </div>
      )}

      {/* ── SPAGHETTI ── */}
      {sub==="spaghetti"&&hasPanel&&(
        <div>
          <Lbl>Variable to track</Lbl>
          <div style={{display:"flex",flexWrap:"wrap",gap:4,marginBottom:"1.2rem"}}>
            {numH.map(h=><button key={h} onClick={()=>setSpagCol(h)} style={chip(spagCol===h,C.orange)}>{spagCol===h?"✓ ":""}{h}</button>)}
          </div>
          {spagCol&&<div>
            <div style={{fontSize: T.caption.fontSize,color:C.textMuted,fontFamily: T.code.fontFamily,marginBottom:8}}>i={panel.entityCol} · t={panel.timeCol} · showing ≤15 random units</div>
            <SvgSpaghetti rows={rows} entityCol={panel.entityCol} timeCol={panel.timeCol} col={spagCol} sampleN={15}/>
          </div>}
        </div>
      )}
    </div>
  );
}

// ─── TIME SERIES TAB ──────────────────────────────────────────────────────────
// Aggregate Y by a time column (or any numeric column used as time axis),
// optionally grouped by a categorical variable → one line per group.
// No dependency on group_summarize pipeline step — computes in-component.
// ─── ACF / PACF BAR CHART ─────────────────────────────────────────────────────
function SvgACF({ acf, pacf, n }) {
  const{C,T}=useTheme();
  const maxLag = acf.length - 1;
  const W = 620, H = 260;
  const PAD = { l: 48, r: 16, t: 20, b: 36 };
  const iW = W - PAD.l - PAD.r;
  const iH = (H - PAD.t - PAD.b) / 2 - 8; // half height per chart
  const conf = 1.96 / Math.sqrt(n);
  const axisColor = C.border2;
  const tickColor = C.textDim;
  const mutedColor = C.textMuted;
  const bandColor = C.red;

  function renderBars(vals, offsetY, color, label) {
    const barW = Math.max(2, iW / (maxLag + 1) - 2);
    const yMid = offsetY + iH / 2;
    const scaleY = v => yMid - (v / 1.0) * (iH / 2);
    return (
      <g>
        {/* label */}
        <text x={PAD.l + 2} y={offsetY + 10} fill={color} fontSize={T.caption.fontSize} fontFamily={T.data.fontFamily} letterSpacing="0.1em">{label}</text>
        {/* zero line */}
        <line x1={PAD.l} x2={PAD.l + iW} y1={yMid} y2={yMid} stroke={axisColor} strokeWidth={1} />
        {/* confidence bands */}
        <line x1={PAD.l} x2={PAD.l + iW} y1={scaleY(conf)}  y2={scaleY(conf)}  stroke={bandColor} strokeWidth={1} strokeDasharray="4 3" opacity={0.7} />
        <line x1={PAD.l} x2={PAD.l + iW} y1={scaleY(-conf)} y2={scaleY(-conf)} stroke={bandColor} strokeWidth={1} strokeDasharray="4 3" opacity={0.7} />
        {/* bars (skip lag 0) */}
        {vals.slice(1).map((v, i) => {
          const lag = i + 1;
          const x   = PAD.l + (lag / (maxLag + 1)) * iW;
          const y0  = yMid;
          const y1  = scaleY(Math.max(-1, Math.min(1, v)));
          const ht  = Math.abs(y1 - y0);
          const sig = Math.abs(v) > conf;
          return (
            <g key={lag}>
              <rect x={x - barW / 2} y={Math.min(y0, y1)} width={barW} height={Math.max(1, ht)}
                fill={sig ? color : `${color}55`} />
              {lag % 5 === 0 && (
                <text x={x} y={offsetY + iH + 14} textAnchor="middle" fill={tickColor} fontSize={T.caption.fontSize} fontFamily={T.data.fontFamily}>{lag}</text>
              )}
            </g>
          );
        })}
        {/* y-axis ticks */}
        {[-1, -0.5, 0, 0.5, 1].map(v => (
          <g key={v}>
            <line x1={PAD.l - 3} x2={PAD.l} y1={scaleY(v)} y2={scaleY(v)} stroke={axisColor} strokeWidth={1} />
            <text x={PAD.l - 5} y={scaleY(v) + 3} textAnchor="end" fill={tickColor} fontSize={T.caption.fontSize} fontFamily={T.data.fontFamily}>{v}</text>
          </g>
        ))}
      </g>
    );
  }

  const acfOffsetY  = PAD.t;
  const pacfOffsetY = PAD.t + iH + 24;

  return (
    <svg viewBox={`0 0 ${W} ${H}`} style={{ width: "100%", maxWidth: 700, height: "auto", display: "block", fontFamily: T.data.fontFamily }}>
      <rect width={W} height={H} fill={C.bg} />
      {renderBars(acf,  acfOffsetY,  C.teal, "ACF")}
      {renderBars(pacf, pacfOffsetY, C.gold, "PACF")}
      {/* conf band legend */}
      <line x1={PAD.l + iW - 80} x2={PAD.l + iW - 60} y1={H - 10} y2={H - 10} stroke={bandColor} strokeWidth={1} strokeDasharray="4 3" opacity={0.7} />
      <text x={PAD.l + iW - 56} y={H - 7} fill={tickColor} fontSize={T.caption.fontSize} fontFamily={T.data.fontFamily}>95% CI (±1.96/√n)</text>
      {/* lag axis label */}
      <text x={PAD.l + iW / 2} y={H - 1} textAnchor="middle" fill={mutedColor} fontSize={T.caption.fontSize} fontFamily={T.data.fontFamily}>Lag</text>
    </svg>
  );
}

// ─── ADF RESULTS PANEL ────────────────────────────────────────────────────────
function AdfPanel({ results }) {
  const{C,T}=useTheme();
  if (!results?.length) return null;
    return (
    <div style={{ padding: "0.8rem 0.9rem", display: "flex", flexDirection: "column", gap: 8 }}>
      <div style={{ fontSize: T.caption.fontSize, color: C.textMuted, letterSpacing: "0.2em", textTransform: "uppercase", fontFamily: T.code.fontFamily, marginBottom: 4 }}>
        Augmented Dickey-Fuller · H₀: unit root (non-stationary) · constant, no trend
      </div>
      {/* header row */}
      <div style={{ display: "grid", gridTemplateColumns: "3rem 6rem 5rem 6rem 1fr", gap: 8, fontSize: T.caption.fontSize, color: C.textMuted, fontFamily: T.code.fontFamily, paddingBottom: 4, borderBottom: `1px solid ${C.border}` }}>
        <span>Lags</span><span>τ statistic</span><span>p-value</span><span>CV (5%)</span><span>Verdict</span>
      </div>
      {results.map(r => {
        const color = r.stationary ? C.teal : C.red;
        const label = r.stationary ? "✓ Stationary" : "✗ Unit root";
        return (
          <div key={r.lag} style={{ display: "grid", gridTemplateColumns: "3rem 6rem 5rem 6rem 1fr", gap: 8, alignItems: "center", padding: "0.4rem 0.5rem", background: r.stationary ? `${C.green}20` : `${C.red}20`, border: `1px solid ${color}20`, borderLeft: `3px solid ${color}`, borderRadius: 3 }}>
            <span style={{ fontSize: T.code.fontSize, color: C.textDim, fontFamily: T.code.fontFamily }}>{r.lag}</span>
            <span style={{ fontSize: T.code.fontSize, color: C.text, fontFamily: T.code.fontFamily }}>{isFinite(r.stat) ? r.stat.toFixed(4) : "—"}</span>
            <span style={{ fontSize: T.code.fontSize, color: isFinite(r.pVal) && r.pVal < 0.05 ? C.teal : C.textDim, fontFamily: T.code.fontFamily }}>
              {isFinite(r.pVal) ? (r.pVal <= 0.01 ? "<0.01" : r.pVal.toFixed(3)) : "—"}
            </span>
            <span style={{ fontSize: T.code.fontSize, color: C.textDim, fontFamily: T.code.fontFamily }}>{isFinite(r.cv5pct) ? r.cv5pct.toFixed(3) : "—"}</span>
            <span style={{ fontSize: T.caption.fontSize, color, fontFamily: T.code.fontFamily, letterSpacing: "0.08em" }}>{label}</span>
          </div>
        );
      })}
      <div style={{ fontSize: T.caption.fontSize, color: C.textMuted, fontFamily: T.code.fontFamily, marginTop: 4 }}>
        Reject H₀ when τ &lt; CV(5%). MacKinnon (1994) response-surface critical values.
      </div>
    </div>
  );
}

// ─── TIME SERIES TAB ──────────────────────────────────────────────────────────
function TimeSeriesTab({ rows, headers, info, panel, onPin }) {
  const{C,T}=useTheme();
  const numH = headers.filter(h => info[h]?.isNum);
  const catH = headers.filter(h => info[h]?.isCat || (!info[h]?.isNum && headers.includes(h)));

  // Candidate time columns: panel timeCol first, then integer/year-like numerics
  const timeCandidates = [
    ...(panel?.timeCol ? [panel.timeCol] : []),
    ...numH.filter(h => h !== panel?.timeCol),
  ];

  const [tCol,   setTCol]   = useState(timeCandidates[0] ?? "");
  const [yCol,   setYCol]   = useState(numH.find(h => h !== tCol) ?? "");
  const [grpCol, setGrpCol] = useState(""); // "" = no grouping
  const [agg,    setAgg]    = useState("mean"); // mean | sum | count | median
  const [tsView, setTsView] = useState("line"); // "line" | "acf" | "adf"

  // ── Flat sorted series for ACF/ADF (no grouping, mean agg) ──────────────────
  const flatY = useMemo(() => {
    if (!tCol || !yCol || !rows.length) return [];
    const valid = rows.filter(r =>
      typeof r[tCol] === "number" && isFinite(r[tCol]) &&
      typeof r[yCol] === "number" && isFinite(r[yCol])
    );
    if (!valid.length) return [];
    const byT = {};
    valid.forEach(r => {
      const t = r[tCol];
      if (!byT[t]) byT[t] = [];
      byT[t].push(r[yCol]);
    });
    return Object.entries(byT)
      .sort((a, b) => parseFloat(a[0]) - parseFloat(b[0]))
      .map(([, vals]) => vals.reduce((s, v) => s + v, 0) / vals.length);
  }, [rows, tCol, yCol]);

  const maxLag   = Math.min(20, Math.floor((flatY.length - 1) / 2));
  const acfVals  = useMemo(() => flatY.length > 4 ? computeACF(flatY, maxLag)  : [], [flatY, maxLag]);
  const pacfVals = useMemo(() => acfVals.length > 1 ? computePACF(acfVals, maxLag) : [], [acfVals, maxLag]);
  const adfRes   = useMemo(() => flatY.length > 8 ? adfTest(flatY, 2)          : [], [flatY]);

  // ── Aggregate ───────────────────────────────────────────────────────────────
  const series = useMemo(() => {
    if (!tCol || !yCol || !rows.length) return [];
    const valid = rows.filter(r =>
      typeof r[tCol] === "number" && isFinite(r[tCol]) &&
      (agg === "count" || (typeof r[yCol] === "number" && isFinite(r[yCol])))
    );
    if (!valid.length) return [];

    const groups = grpCol
      ? [...new Set(valid.map(r => String(r[grpCol] ?? "")))]
      : ["_all_"];

    return groups.map(grp => {
      const subset = grpCol ? valid.filter(r => String(r[grpCol] ?? "") === grp) : valid;

      // group by time value
      const byT = {};
      subset.forEach(r => {
        const t = r[tCol];
        if (!byT[t]) byT[t] = [];
        if (agg !== "count") byT[t].push(r[yCol]);
        else byT[t].push(1);
      });

      const pts = Object.entries(byT)
        .map(([t, vals]) => {
          const tv = parseFloat(t);
          let y;
          if (agg === "mean")   y = vals.reduce((s, v) => s + v, 0) / vals.length;
          if (agg === "sum")    y = vals.reduce((s, v) => s + v, 0);
          if (agg === "count")  y = vals.length;
          if (agg === "median") { const s = [...vals].sort((a,b)=>a-b); y = s[Math.floor(s.length/2)]; }
          return { t: tv, y };
        })
        .sort((a, b) => a.t - b.t);

      return { grp, pts };
    }).filter(s => s.pts.length > 0);
  }, [rows, tCol, yCol, grpCol, agg]);

  // ── SVG ─────────────────────────────────────────────────────────────────────
  const W = 620, H = 300;
  const PAD = { l: 62, r: 24, t: 24, b: 44 };
  const iW = W - PAD.l - PAD.r;
  const iH = H - PAD.t - PAD.b;

  const COLORS = [C.teal, C.orange, C.violet, C.green, C.red, C.blue, C.gold, C.purple];

  const chart = useMemo(() => {
    if (!series.length) return null;
    const allT = series.flatMap(s => s.pts.map(p => p.t));
    const allY = series.flatMap(s => s.pts.map(p => p.y));
    const tMin = arrMin(allT), tMax = arrMax(allT);
    const yMin = arrMin(allY), yMax = arrMax(allY);
    const yPad = (yMax - yMin) * 0.1 || 1;
    const yLo = yMin - yPad, yHi = yMax + yPad;
    const sx = t => PAD.l + ((t - tMin) / (tMax - tMin || 1)) * iW;
    const sy = v => PAD.t + iH - ((v - yLo) / (yHi - yLo)) * iH;

    // ticks
    function niceTicks(lo, hi, n = 5) {
      const range = hi - lo; if (!range) return [lo];
      const step = Math.pow(10, Math.floor(Math.log10(range / n)));
      const nice = [1,2,2.5,5,10].find(s => range/(s*step) <= n) * step;
      const start = Math.ceil(lo / nice) * nice;
      const out = [];
      for (let v = start; v <= hi + nice*0.01; v += nice) out.push(parseFloat(v.toFixed(10)));
      return out.length >= 2 ? out : [lo, hi];
    }
    const xTicks = niceTicks(tMin, tMax, 6);
    const yTicks = niceTicks(yLo, yHi, 5);

    return { sx, sy, xTicks, yTicks, yLo, yHi, tMin, tMax };
  }, [series]);

  const svgId = "ts-plot";

  const handleExport = () => {
    const el = document.getElementById(svgId);
    if (!el) return;
    let src = new XMLSerializer().serializeToString(el);
    if (!src.includes('xmlns="http://www.w3.org/2000/svg"'))
      src = src.replace('<svg ', '<svg xmlns="http://www.w3.org/2000/svg" ');
    src = src.replace(/<rect[^>]*fill="#080808"[^>]*\/>/g, '');
    src = '<?xml version="1.0" encoding="UTF-8"?>\n' + src;
    const a = document.createElement("a");
    a.href = URL.createObjectURL(new Blob([src], { type: "image/svg+xml;charset=utf-8" }));
    a.download = `trend_${yCol}_by_${tCol}.svg`; a.click(); URL.revokeObjectURL(a.href);
  };

  return (
    <div>
      {/* Sub-tab toggle */}
      <div style={{ display: "flex", gap: 1, background: C.border, borderRadius: 3, overflow: "hidden", marginBottom: "1rem", width: "fit-content", alignItems: "center" }}>
        {[["line","⬡ Line chart"],["acf","⬡ ACF / PACF"],["adf","⬡ ADF test"]].map(([k, l]) => (
          <button key={k} onClick={() => setTsView(k)} style={{ padding: "0.3rem 0.9rem", background: tsView === k ? C.surface3 : C.surface, border: "none", borderBottom: tsView === k ? `2px solid ${C.teal}` : "2px solid transparent", color: tsView === k ? C.teal : C.textMuted, cursor: "pointer", fontFamily: T.code.fontFamily, fontSize: T.caption.fontSize, transition: "all 0.12s" }}>{l}</button>
        ))}
        {onPin&&<div style={{padding:"0 6px",background:C.surface}}>
          <PinBtn onClick={()=>{
            if(tsView==="line") onPin({kind:"timeseries",yCol,timeCol:tCol,groupCol:grpCol||null,agg},`Time series: ${agg}(${yCol}) over ${tCol}${grpCol?` by ${grpCol}`:""}`);
            else if(tsView==="acf") onPin({kind:"acf_pacf",yCol,timeCol:tCol,maxLag},`ACF/PACF: ${yCol} (lags 1–${maxLag})`);
            else onPin({kind:"adf",yCol,timeCol:tCol,lagOrder:2},`ADF test: ${yCol}`);
          }}/>
        </div>}
      </div>

      {/* Controls */}
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr 1fr", gap: 12, marginBottom: "1.4rem" }}>
        {/* Time column */}
        <div>
          <Lbl>Time axis</Lbl>
          <select value={tCol} onChange={e => setTCol(e.target.value)}
            style={{ width: "100%", padding: "0.38rem 0.6rem", background: C.surface2, border: `1px solid ${C.border2}`, borderRadius: 3, color: C.text, fontFamily: T.code.fontFamily, fontSize: T.code.fontSize }}>
            {timeCandidates.map(h => <option key={h} value={h}>{h}</option>)}
          </select>
        </div>
        {/* Y variable */}
        <div>
          <Lbl>Variable (Y)</Lbl>
          <select value={yCol} onChange={e => setYCol(e.target.value)}
            style={{ width: "100%", padding: "0.38rem 0.6rem", background: C.surface2, border: `1px solid ${C.border2}`, borderRadius: 3, color: C.text, fontFamily: T.code.fontFamily, fontSize: T.code.fontSize }}>
            {numH.map(h => <option key={h} value={h}>{h}</option>)}
          </select>
        </div>
        {/* Aggregation */}
        <div>
          <Lbl>Aggregation</Lbl>
          <select value={agg} onChange={e => setAgg(e.target.value)}
            style={{ width: "100%", padding: "0.38rem 0.6rem", background: C.surface2, border: `1px solid ${C.border2}`, borderRadius: 3, color: C.text, fontFamily: T.code.fontFamily, fontSize: T.code.fontSize }}>
            {[["mean","Mean"],["sum","Sum"],["median","Median"],["count","Count"]].map(([v,l]) =>
              <option key={v} value={v}>{l}</option>)}
          </select>
        </div>
        {/* Group by */}
        <div>
          <Lbl>Group by (optional)</Lbl>
          <select value={grpCol} onChange={e => setGrpCol(e.target.value)}
            style={{ width: "100%", padding: "0.38rem 0.6rem", background: C.surface2, border: `1px solid ${C.border2}`, borderRadius: 3, color: C.text, fontFamily: T.code.fontFamily, fontSize: T.code.fontSize }}>
            <option value="">— none —</option>
            {headers.map(h => <option key={h} value={h}>{h}</option>)}
          </select>
        </div>
      </div>

      {/* ACF / PACF panel */}
      {tsView === "acf" && (
        <div style={{ border: `1px solid ${C.border}`, borderRadius: 4, overflow: "hidden" }}>
          <div style={{ padding: "0.4rem 0.9rem", background: C.surface2, borderBottom: `1px solid ${C.border}`, fontSize: T.caption.fontSize, color: C.textMuted, letterSpacing: "0.18em", textTransform: "uppercase", fontFamily: T.code.fontFamily }}>
            ACF &amp; PACF · {yCol} · n = {flatY.length} time points · max lag = {maxLag}
          </div>
          {acfVals.length > 1 ? (
            <div style={{ background: C.bg, padding: "0.5rem", display: "flex", justifyContent: "center" }}>
              <SvgACF acf={acfVals} pacf={pacfVals} n={flatY.length} />
            </div>
          ) : (
            <div style={{ padding: "2rem", textAlign: "center", color: C.textMuted, fontSize: T.code.fontSize, fontFamily: T.code.fontFamily }}>
              Need at least 5 time points for ACF.
            </div>
          )}
        </div>
      )}

      {/* ADF panel */}
      {tsView === "adf" && (
        <div style={{ border: `1px solid ${C.border}`, borderRadius: 4, overflow: "hidden" }}>
          <div style={{ padding: "0.4rem 0.9rem", background: C.surface2, borderBottom: `1px solid ${C.border}`, fontSize: T.caption.fontSize, color: C.textMuted, letterSpacing: "0.18em", textTransform: "uppercase", fontFamily: T.code.fontFamily }}>
            Augmented Dickey-Fuller · {yCol} · n = {flatY.length} time points
          </div>
          {adfRes.length > 0 ? (
            <AdfPanel results={adfRes} />
          ) : (
            <div style={{ padding: "2rem", textAlign: "center", color: C.textMuted, fontSize: T.code.fontSize, fontFamily: T.code.fontFamily }}>
              Need at least 9 time points for ADF test.
            </div>
          )}
        </div>
      )}

      {/* Line Chart */}
      {tsView === "line" && series.length > 0 && chart ? (
        <div style={{ border: `1px solid ${C.border}`, borderRadius: 4, overflow: "hidden" }}>
          {/* header */}
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "0.4rem 0.9rem", background: C.surface2, borderBottom: `1px solid ${C.border}` }}>
            <span style={{ fontSize: T.caption.fontSize, color: C.textMuted, letterSpacing: "0.18em", textTransform: "uppercase", fontFamily: T.code.fontFamily }}>
              {agg.charAt(0).toUpperCase()+agg.slice(1)} of {yCol} by {tCol}
              {grpCol ? ` · grouped by ${grpCol}` : ""}
            </span>
            <button onClick={handleExport}
              style={{ padding: "0.2rem 0.6rem", background: "transparent", border: `1px solid ${C.border2}`, borderRadius: 3, color: C.textMuted, cursor: "pointer", fontFamily: T.code.fontFamily, fontSize: T.caption.fontSize, transition: "all 0.12s" }}
              onMouseEnter={e => { e.currentTarget.style.borderColor = C.teal; e.currentTarget.style.color = C.teal; }}
              onMouseLeave={e => { e.currentTarget.style.borderColor = C.border2; e.currentTarget.style.color = C.textMuted; }}
            >↓ SVG</button>
          </div>
          <div style={{ background: C.bg, padding: "0.5rem", display: "flex", justifyContent: "center" }}>
            <svg id={svgId} viewBox={`0 0 ${W} ${H}`}
              style={{ width: "100%", maxWidth: 700, height: "auto", maxHeight: "45vh", display: "block", fontFamily: T.code.fontFamily }}>
              <rect width={W} height={H} fill={C.bg} />

              {/* grid */}
              {chart.xTicks.map((t, i) => (
                <line key={`gx${i}`} x1={chart.sx(t)} x2={chart.sx(t)} y1={PAD.t} y2={PAD.t+iH}
                  stroke={C.border} strokeWidth={1} strokeDasharray="3 3" opacity={0.4} />
              ))}
              {chart.yTicks.map((t, i) => (
                <line key={`gy${i}`} x1={PAD.l} x2={PAD.l+iW} y1={chart.sy(t)} y2={chart.sy(t)}
                  stroke={C.border} strokeWidth={1} strokeDasharray="3 3" opacity={0.4} />
              ))}

              {/* zero line */}
              {chart.yLo < 0 && chart.yHi > 0 && (
                <line x1={PAD.l} x2={PAD.l+iW} y1={chart.sy(0)} y2={chart.sy(0)}
                  stroke={C.border2} strokeWidth={1} strokeDasharray="4 3" />
              )}

              {/* series lines */}
              {series.map((s, si) => {
                const col = COLORS[si % COLORS.length];
                const d = s.pts.map((p, i) =>
                  `${i === 0 ? "M" : "L"}${chart.sx(p.t).toFixed(1)},${chart.sy(p.y).toFixed(1)}`
                ).join(" ");
                return (
                  <g key={s.grp}>
                    <path d={d} fill="none" stroke={col} strokeWidth={2} opacity={0.9} />
                    {s.pts.map((p, i) => (
                      <circle key={i} cx={chart.sx(p.t)} cy={chart.sy(p.y)} r={3}
                        fill={col} opacity={0.85} />
                    ))}
                  </g>
                );
              })}

              {/* axes */}
              {chart.xTicks.map((t, i) => (
                <g key={i}>
                  <line x1={chart.sx(t)} x2={chart.sx(t)} y1={PAD.t+iH} y2={PAD.t+iH+4} stroke={C.border2} strokeWidth={1} />
                  <text x={chart.sx(t)} y={PAD.t+iH+14} textAnchor="middle" fill={C.textMuted} fontSize={T.caption.fontSize} fontFamily={T.data.fontFamily}>
                    {Number.isInteger(t) ? t : t.toFixed(1)}
                  </text>
                </g>
              ))}
              {chart.yTicks.map((t, i) => (
                <g key={i}>
                  <line x1={PAD.l-4} x2={PAD.l} y1={chart.sy(t)} y2={chart.sy(t)} stroke={C.border2} strokeWidth={1} />
                  <text x={PAD.l-8} y={chart.sy(t)+3} textAnchor="end" fill={C.textMuted} fontSize={T.caption.fontSize} fontFamily={T.data.fontFamily}>
                    {Math.abs(t) >= 1000 ? t.toExponential(1) : t.toFixed(2)}
                  </text>
                </g>
              ))}
              <line x1={PAD.l} x2={PAD.l+iW} y1={PAD.t+iH} y2={PAD.t+iH} stroke={C.border2} strokeWidth={1} />
              <line x1={PAD.l} x2={PAD.l} y1={PAD.t} y2={PAD.t+iH} stroke={C.border2} strokeWidth={1} />

              {/* axis labels */}
              <text x={PAD.l+iW/2} y={H-4} textAnchor="middle" fill={C.textDim} fontSize={T.caption.fontSize} fontFamily={T.data.fontFamily}>
                {tCol}
              </text>
              <text transform={`translate(12,${PAD.t+iH/2}) rotate(-90)`} textAnchor="middle" fill={C.textDim} fontSize={T.caption.fontSize} fontFamily={T.data.fontFamily}>
                {agg}({yCol})
              </text>

              {/* legend — only when grouped */}
              {grpCol && series.length <= 8 && (
                <g transform={`translate(${PAD.l + 10}, ${PAD.t + 6})`}>
                  {series.map((s, si) => (
                    <g key={s.grp} transform={`translate(0, ${si * 14})`}>
                      <line x1={0} x2={14} y1={5} y2={5} stroke={COLORS[si % COLORS.length]} strokeWidth={2} />
                      <text x={18} y={9} fill={C.textDim} fontSize={T.caption.fontSize} fontFamily={T.data.fontFamily}>
                        {String(s.grp).length > 16 ? String(s.grp).slice(0,15)+"…" : String(s.grp)}
                      </text>
                    </g>
                  ))}
                </g>
              )}
            </svg>
          </div>

          {/* footer stats */}
          <div style={{ padding: "0.35rem 0.9rem", background: C.surface2, borderTop: `1px solid ${C.border}`, fontSize: T.caption.fontSize, color: C.textMuted, fontFamily: T.code.fontFamily, display: "flex", gap: 16 }}>
            <span>{series.length} serie{series.length !== 1 ? "s" : ""}</span>
            <span>{series[0]?.pts.length} time points</span>
            <span>n = {rows.length} observations</span>
          </div>
        </div>
      ) : (
        <div style={{ padding: "2rem", textAlign: "center", color: C.textMuted, fontSize: T.code.fontSize, fontFamily: T.code.fontFamily }}>
          {!tCol || !yCol ? "Select a time column and a variable." : "No valid data for selected columns."}
        </div>
      )}
    </div>
  );
}
function AIInsights({rows,headers,info,panel}){
  const{C,T}=useTheme();
  const [text,setText]=useState(""),[loading,setLoading]=useState(false),[done,setDone]=useState(false);
  const ran = { current: false };

  function runInsights(){
    if(ran.current||done) return;
    ran.current=true;
    setLoading(true);
    const numH=headers.filter(h=>info[h]?.isNum&&info[h]?.mean!=null);
    const summary=numH.slice(0,6).map(h=>{
      const i=info[h];
      return `${h}: mean=${i.mean?.toFixed(3)}, std=${i.std?.toFixed(3)}, min=${i.min?.toFixed(3)}, max=${i.max?.toFixed(3)}, median=${i.median?.toFixed(3)}, NAs=${(i.naPct*100).toFixed(1)}%`;
    }).join("; ");
    const panelNote=panel?`Dataset is a ${panel.balance||"panel"} panel with i=${panel.entityCol} and t=${panel.timeCol}.`:"Dataset is cross-sectional.";
    const prompt=`You are a senior econometrician. Write a concise 3-4 sentence descriptive paragraph (Table 1 prose style, academic tone) about this dataset. Include: total observations, key variables and their distributions (mention skewness or outliers if relevant), any notable patterns. ${panelNote}\n\nStats: ${summary}\n\nObs: ${rows.length}, Cols: ${headers.length}.\n\nRespond ONLY with the prose paragraph, no markdown, no headers.`;
    callClaude({ user: prompt, maxTokens: 400 })
      .then(t=>{setText(t||"");setDone(true);}).catch(()=>setText("AI analysis unavailable.")).finally(()=>setLoading(false));
  }

  return(
    <div style={{padding:"1rem",background:C.surface,border:`1px solid ${C.border}`,borderLeft:`3px solid ${C.purple}`,borderRadius:4,marginBottom:"1.4rem"}}>
      <div style={{display:"flex",alignItems:"center",gap:8,marginBottom:8}}>
        <span style={{fontSize: T.caption.fontSize,color:C.purple,letterSpacing:"0.18em",textTransform:"uppercase",fontFamily: T.code.fontFamily}}>✦ AI Insights</span>
        {loading&&<Spin/>}
        {done&&<button onClick={()=>{setDone(false);setText("");ran.current=false;setTimeout(runInsights,50);}} style={{marginLeft:"auto",fontSize: T.caption.fontSize,background:"transparent",border:`1px solid ${C.border2}`,borderRadius:2,color:C.textMuted,cursor:"pointer",fontFamily: T.code.fontFamily,padding:"2px 6px"}}>↻ refresh</button>}
      </div>
      {loading&&!text&&<div style={{fontSize: T.code.fontSize,color:C.textMuted,fontFamily: T.code.fontFamily}}>Analyzing dataset…</div>}
      {text&&<div style={{fontSize: T.code.fontSize,color:C.text,lineHeight:1.75,fontFamily: T.code.fontFamily}}>{text}</div>}
      {!loading&&!text&&!done&&<Btn onClick={runInsights} color={C.purple} sm ch="✦ Generate AI insights"/>}
    </div>
  );
}

// ─── EXPLORE SCRIPT GENERATORS ────────────────────────────────────────────────

function generateExploreScript(language, { headers, info, filename }) {
  const numCols = headers.filter(h => info[h]?.isNum);
  const base    = filename ? filename.replace(/\.[^.]+$/, "") : "dataset";
  const df      = "df_" + base.replace(/[^a-zA-Z0-9_]/g, "_").replace(/^[0-9]/, "_");

  if (language === "r") {
    const lines = [
      `# ${"─".repeat(70)}`,
      `# Litux — Explore Script (R)`,
      `# Dataset: ${base}`,
      `# Generated: ${new Date().toISOString().slice(0,10)}`,
      `# ${"─".repeat(70)}`,
      ``,
      `library(dplyr)`,
      `library(ggplot2)`,
      ``,
      `${df} <- readr::read_csv("${filename || `${base}.csv`}")`,
      ``,
      `# ── Overview ──`,
      `dplyr::glimpse(${df})`,
      ``,
      `# ── Summary statistics ──`,
      `summary(${df})`,
      ``,
    ];
    if (numCols.length > 1) {
      lines.push(`# ── Correlation matrix (numeric columns) ──`);
      lines.push(`cor(${df}[, c(${numCols.map(c => `"${c}"`).join(", ")})], use = "complete.obs")`);
      lines.push(``);
    }
    return lines.join("\n");
  }

  if (language === "stata") {
    const lines = [
      `* ${"─".repeat(70)}`,
      `* Litux — Explore Script (Stata)`,
      `* Dataset: ${base}`,
      `* Generated: ${new Date().toISOString().slice(0,10)}`,
      `* ${"─".repeat(70)}`,
      ``,
      `version 17`,
      `set more off`,
      ``,
      `import delimited "${filename || `${base}.csv`}", clear`,
      ``,
      `* ── Overview ──`,
      `describe`,
      ``,
      `* ── Summary statistics ──`,
      `summarize`,
      ``,
    ];
    if (numCols.length > 1) {
      lines.push(`* ── Correlation matrix ──`);
      lines.push(`correlate ${numCols.join(" ")}`);
      lines.push(``);
    }
    return lines.join("\n");
  }

  if (language === "python") {
    const lines = [
      `# ${"─".repeat(70)}`,
      `# Litux — Explore Script (Python)`,
      `# Dataset: ${base}`,
      `# Generated: ${new Date().toISOString().slice(0,10)}`,
      `# ${"─".repeat(70)}`,
      ``,
      `import pandas as pd`,
      `import numpy as np`,
      ``,
      `${df} = pd.read_csv("${filename || `${base}.csv`}")`,
      ``,
      `# ── Overview ──`,
      `print(${df}.info())`,
      ``,
      `# ── Summary statistics ──`,
      `print(${df}.describe(include="all"))`,
      ``,
    ];
    if (numCols.length > 1) {
      lines.push(`# ── Correlation matrix ──`);
      lines.push(`print(${df}[[${numCols.map(c => `"${c}"`).join(", ")}]].corr())`);
      lines.push(``);
    }
    return lines.join("\n");
  }
  return "";
}

// ─── GROUP & SUMMARIZE EXPLORER ───────────────────────────────────────────────
// Non-destructive descriptive stats panel with as.factor() override and LaTeX export.
function GroupSummarizeExplorer({ rows, headers, info, onSaveDataset }) {
  const { C, T } = useTheme();
  const [byCols,    setByCols]    = useState([]);
  const [factorOverrides, setFactorOverrides] = useState(new Set()); // numeric cols forced as categorical
  const [aggs,      setAggs]      = useState([]);
  const [sumResult, setSumResult] = useState(null);
  const [latexOpen, setLatexOpen] = useState(false);
  const [copied,    setCopied]    = useState(false);
  const [hoveredCol, setHoveredCol] = useState(null);
  const [saveName,  setSaveName]  = useState("");
  const [saved,     setSaved]     = useState(false);

  const numC = headers.filter(h => info[h]?.isNum);
  const FN_OPTS = [
    ["mean","Mean (μ)"],["median","Median"],["sum","Sum (Σ)"],
    ["count","Count (n)"],["min","Min"],["max","Max"],["sd","Std dev (σ)"],
  ];
  const inS = { padding:"0.38rem 0.6rem", background:C.surface2,
    border:`1px solid ${C.border2}`, borderRadius:3, color:C.text,
    fontFamily: T.code.fontFamily, fontSize: T.code.fontSize, outline:"none" };

  function toggleFactor(h) {
    setFactorOverrides(prev => {
      const next = new Set(prev);
      if (next.has(h)) { next.delete(h); setByCols(p => p.filter(x => x !== h)); }
      else next.add(h);
      return next;
    });
  }

  function isGroupable(h) {
    return !info[h]?.isNum || factorOverrides.has(h);
  }

  function toggleByCol(h) {
    if (!isGroupable(h)) return;
    setByCols(p => p.includes(h) ? p.filter(x => x !== h) : [...p, h]);
  }

  function addAgg(col = "", fn = "mean") {
    const nn = col ? `${fn}_${col}` : "";
    setAggs(a => [...a, { col, fn, nn }]);
  }
  function updAgg(i, patch) {
    setAggs(a => a.map((x, j) => {
      if (j !== i) return x;
      const updated = { ...x, ...patch };
      const oldAuto = `${x.fn}_${x.col}`;
      if ((!x.nn || x.nn === oldAuto) && (patch.col !== undefined || patch.fn !== undefined)) {
        updated.nn = `${updated.fn}_${updated.col}`;
      }
      return updated;
    }));
  }
  function rmAgg(i) { setAggs(a => a.filter((_, j) => j !== i)); }

  function doSummarize() {
    if (!byCols.length || !aggs.length) return;
    const validAggs = aggs.filter(a => a.col && a.fn && a.nn.trim());
    if (!validAggs.length) return;
    const byKey = r => byCols.map(b => String(r[b] ?? "")).join("||");
    const groups = new Map();
    rows.forEach(r => {
      const k = byKey(r);
      if (!groups.has(k)) groups.set(k, { _first: r, _rows: [] });
      groups.get(k)._rows.push(r);
    });
    const outRows = [];
    const outHeaders = [...byCols, ...validAggs.map(a => a.nn)];
    for (const { _first, _rows } of groups.values()) {
      const out = {};
      byCols.forEach(b => { out[b] = _first[b]; });
      validAggs.forEach(({ col, fn, nn }) => {
        const vals = _rows.map(r => r[col]).filter(v => typeof v === "number" && isFinite(v));
        if (fn === "count") { out[nn] = _rows.length; return; }
        if (!vals.length)   { out[nn] = null; return; }
        if (fn === "sum")   { out[nn] = vals.reduce((a,b)=>a+b,0); return; }
        if (fn === "min")   { out[nn] = Math.min(...vals); return; }
        if (fn === "max")   { out[nn] = Math.max(...vals); return; }
        const mean = vals.reduce((a,b)=>a+b,0)/vals.length;
        if (fn === "mean")  { out[nn] = mean; return; }
        if (fn === "sd")    { out[nn] = vals.length>1 ? Math.sqrt(vals.reduce((s,v)=>s+(v-mean)**2,0)/(vals.length-1)) : 0; return; }
        if (fn === "median") { const s=[...vals].sort((a,b)=>a-b),m=Math.floor(s.length/2); out[nn]=s.length%2===0?(s[m-1]+s[m])/2:s[m]; return; }
        out[nn] = null;
      });
      outRows.push(out);
    }
    outRows.sort((a, b) => {
      for (const col of byCols) {
        const av = String(a[col]??""), bv = String(b[col]??"");
        if (av < bv) return -1; if (av > bv) return 1;
      }
      return 0;
    });
    setSumResult({ rows: outRows, headers: outHeaders, by: byCols, aggs: validAggs });
    setLatexOpen(false); setCopied(false);
  }

  function buildLatex(res) {
    const numCols = new Set(res.aggs.map(a => a.nn));
    const fmt = v => v === null || v === undefined ? "" : typeof v === "number" ? v.toFixed(3) : String(v);
    const colSpec = res.headers.map(h => numCols.has(h) ? "r" : "l").join(" ");
    const header  = res.headers.map(h => h.replace(/_/g,"\\_")).join(" & ") + " \\\\";
    const body    = res.rows.map(r => res.headers.map(h => fmt(r[h])).join(" & ") + " \\\\").join("\n    ");
    return [
      "\\begin{table}[htbp]","  \\centering",
      `  \\caption{Summary statistics by ${res.by.join(", ")}}`,
      "  \\label{tab:summary}",
      `  \\begin{tabular}{${colSpec}}`,
      "    \\hline",`    ${header}`,"    \\hline",`    ${body}`,"    \\hline",
      "  \\end{tabular}","\\end{table}",
    ].join("\n");
  }

  const canSummarize = byCols.length > 0 && aggs.some(a => a.col && a.fn && a.nn.trim());

  return (
    <div>
      <div style={{padding:"0.65rem 1rem",background:C.surface,border:`1px solid ${C.border}`,
        borderLeft:`3px solid ${C.gold}`,borderRadius:4,marginBottom:"1.2rem",
        fontSize: T.code.fontSize,color:C.textDim,lineHeight:1.6}}>
        Group by any column (including numeric — use{" "}
        <span style={{color:C.gold,fontFamily: T.code.fontFamily}}>as.factor()</span> to treat a number as a category)
        and compute summary statistics. Results are read-only — use the LaTeX button to export.
      </div>

      {/* ── Group by ── */}
      <div style={{fontSize: T.caption.fontSize,color:C.textMuted,letterSpacing:"0.2em",textTransform:"uppercase",
        marginBottom:6,fontFamily: T.code.fontFamily}}>Group by</div>
      <div style={{display:"flex",flexWrap:"wrap",gap:4,marginBottom:"0.5rem"}}>
        {headers.map(h => {
          const isNum  = info[h]?.isNum;
          const isFact = factorOverrides.has(h);
          const groupable = !isNum || isFact;
          const sel = byCols.includes(h);
          const uVals = info[h]?.uVals?.map(v => String(v)) || [];
          return (
            <div key={h} style={{position:"relative",display:"flex",gap:1,alignItems:"center"}}>
              <button
                onClick={() => toggleByCol(h)}
                onMouseEnter={() => groupable && setHoveredCol(h)}
                onMouseLeave={() => setHoveredCol(null)}
                style={{
                  padding:"0.28rem 0.6rem",
                  border:`1px solid ${sel ? C.gold : groupable ? C.border2 : C.border}`,
                  background: sel ? `${C.gold}18` : "transparent",
                  color: sel ? C.gold : groupable ? C.textDim : C.textMuted,
                  borderRadius:3, cursor: groupable ? "pointer" : "default",
                  fontSize: T.caption.fontSize, fontFamily: T.code.fontFamily, opacity: groupable ? 1 : 0.5,
                  transition:"all 0.1s",
                }}>
                {sel ? "✓ " : ""}{h}
                {isNum && !isFact && <span style={{fontSize: T.caption.fontSize,marginLeft:3,color:C.textMuted}}>num</span>}
                {isFact && <span style={{fontSize: T.caption.fontSize,marginLeft:3,color:C.gold}}>factor</span>}
                {!isNum && <span style={{fontSize: T.caption.fontSize,color:C.textMuted,marginLeft:3}}>({info[h]?.uCount})</span>}
              </button>
              {/* as.factor() toggle — shown for numeric columns */}
              {isNum && (
                <button
                  onClick={() => toggleFactor(h)}
                  title={isFact ? "Remove as.factor() — revert to numeric" : "as.factor() — treat as categorical for grouping"}
                  style={{
                    padding:"0.18rem 0.38rem",
                    border:`1px solid ${isFact ? C.gold : C.border2}`,
                    background: isFact ? `${C.gold}18` : "transparent",
                    color: isFact ? C.gold : C.textMuted,
                    borderRadius:2, cursor:"pointer",
                    fontSize: T.caption.fontSize, fontFamily: T.code.fontFamily, transition:"all 0.1s",
                    whiteSpace:"nowrap",
                  }}>
                  {isFact ? "✓ f" : "f"}
                </button>
              )}
              {hoveredCol===h && uVals.length>0 && (
                <div style={{position:"absolute",top:"calc(100% + 4px)",left:0,
                  background:C.surface2,border:`1px solid ${C.border2}`,
                  borderRadius:4,padding:"0.5rem 0.65rem",zIndex:50,
                  minWidth:120,maxWidth:220,boxShadow:"0 6px 20px #000a",
                  fontSize: T.caption.fontSize,fontFamily: T.code.fontFamily,color:C.textDim,pointerEvents:"none"}}>
                  <div style={{fontSize: T.caption.fontSize,color:C.gold,letterSpacing:"0.12em",
                    textTransform:"uppercase",marginBottom:4}}>
                    {info[h]?.uCount} unique values
                  </div>
                  <div style={{display:"flex",flexWrap:"wrap",gap:3}}>
                    {uVals.slice(0,12).map(v=>(
                      <span key={v} style={{padding:"1px 5px",border:`1px solid ${C.border2}`,
                        borderRadius:2,color:C.text,background:C.surface3,fontSize: T.caption.fontSize}}>{v}</span>
                    ))}
                    {uVals.length>12 && <span style={{color:C.textMuted,fontSize: T.caption.fontSize}}>+{uVals.length-12} more</span>}
                  </div>
                </div>
              )}
            </div>
          );
        })}
      </div>
      <div style={{fontSize: T.caption.fontSize,color:C.textMuted,fontFamily: T.code.fontFamily,marginBottom:"1.2rem"}}>
        Hover a column to preview its unique values · click <span style={{color:C.gold}}>f</span> next to a numeric column to use as.factor()
      </div>

      {/* ── Aggregations ── */}
      <div style={{display:"flex",alignItems:"center",gap:8,marginBottom:"0.6rem"}}>
        <div style={{fontSize: T.caption.fontSize,color:C.textMuted,letterSpacing:"0.2em",textTransform:"uppercase",fontFamily: T.code.fontFamily}}>Aggregations</div>
        <button onClick={()=>addAgg()} style={{
          padding:"0.2rem 0.55rem",border:`1px solid ${C.blue}`,
          background:`${C.blue}10`,color:C.blue,borderRadius:2,
          cursor:"pointer",fontSize: T.caption.fontSize,fontFamily: T.code.fontFamily}}>+ add row</button>
      </div>
      {numC.length > 0 && (
        <div style={{display:"flex",flexWrap:"wrap",gap:3,marginBottom:"0.8rem"}}>
          <span style={{fontSize: T.caption.fontSize,color:C.textMuted,fontFamily: T.code.fontFamily,alignSelf:"center",marginRight:2}}>quick add:</span>
          {numC.map(h => (
            <button key={h} onClick={()=>addAgg(h,"mean")}
              style={{padding:"0.18rem 0.5rem",border:`1px solid ${C.border2}`,
                background:"transparent",color:C.textDim,borderRadius:2,
                cursor:"pointer",fontSize: T.caption.fontSize,fontFamily: T.code.fontFamily,transition:"all 0.1s"}}
              onMouseEnter={e=>{e.currentTarget.style.borderColor=C.blue;e.currentTarget.style.color=C.blue;}}
              onMouseLeave={e=>{e.currentTarget.style.borderColor=C.border2;e.currentTarget.style.color=C.textDim;}}
              title={`Add mean(${h})`}>+ {h}</button>
          ))}
        </div>
      )}
      {aggs.length === 0 && (
        <div style={{padding:"0.65rem 1rem",background:C.surface,border:`1px dashed ${C.border2}`,
          borderRadius:4,fontSize: T.code.fontSize,color:C.textMuted,fontFamily: T.code.fontFamily,marginBottom:"1.2rem"}}>
          Add aggregations above.
        </div>
      )}
      <div style={{display:"flex",flexDirection:"column",gap:6,marginBottom:"1.2rem"}}>
        {aggs.map((agg, i) => (
          <div key={i} style={{display:"grid",gridTemplateColumns:"1fr 140px 1fr auto",
            gap:6,alignItems:"center",padding:"0.5rem 0.65rem",
            background:C.surface2,border:`1px solid ${C.border}`,borderRadius:4}}>
            <select value={agg.col} onChange={e=>updAgg(i,{col:e.target.value})} style={{...inS,width:"100%"}}>
              <option value="">— column —</option>
              {numC.map(h=><option key={h} value={h}>{h}</option>)}
            </select>
            <select value={agg.fn} onChange={e=>updAgg(i,{fn:e.target.value})} style={inS}>
              {FN_OPTS.map(([v,l])=><option key={v} value={v}>{l}</option>)}
            </select>
            <input value={agg.nn}
              onChange={e=>setAggs(a=>a.map((x,j)=>j!==i?x:{...x,nn:e.target.value}))}
              placeholder={`${agg.fn}_${agg.col||"col"}`}
              style={{...inS,width:"100%",boxSizing:"border-box"}}/>
            <button onClick={()=>rmAgg(i)} style={{
              background:"transparent",border:`1px solid ${C.border2}`,
              borderRadius:2,color:C.textMuted,cursor:"pointer",
              fontSize: T.code.fontSize,padding:"0.2rem 0.4rem"}}>✕</button>
          </div>
        ))}
      </div>

      <button onClick={doSummarize} disabled={!canSummarize} style={{
        padding:"0.42rem 0.9rem",borderRadius:3,cursor:canSummarize?"pointer":"not-allowed",
        fontFamily: T.code.fontFamily,fontSize: T.code.fontSize,fontWeight:700,
        background:canSummarize?C.gold:"transparent",
        color:canSummarize?C.bg:C.textMuted,
        border:`1px solid ${canSummarize?C.gold:C.border2}`,
        opacity:canSummarize?1:0.5,marginBottom:"1.5rem",
      }}>Compute →</button>

      {/* ── Result ── */}
      {sumResult && (
        <div style={{border:`1px solid ${C.border}`,borderRadius:4,overflow:"hidden"}}>
          <div style={{padding:"0.55rem 0.9rem",background:C.surface2,
            display:"flex",alignItems:"center",gap:8,flexWrap:"wrap"}}>
            <span style={{fontSize: T.caption.fontSize,color:C.gold,fontFamily: T.code.fontFamily,flex:1}}>
              {sumResult.rows.length} groups · grouped by [{sumResult.by.join(", ")}]
            </span>
            {/* LaTeX toggle */}
            <button onClick={()=>{setLatexOpen(o=>!o);setCopied(false);}} style={{
              padding:"0.22rem 0.6rem",background:latexOpen?`${C.gold}18`:"transparent",
              border:`1px solid ${latexOpen?C.gold:C.border2}`,borderRadius:2,
              color:latexOpen?C.gold:C.textDim,cursor:"pointer",fontSize: T.caption.fontSize,fontFamily: T.code.fontFamily}}>
              LaTeX {latexOpen?"▾":"▸"}
            </button>
            {/* CSV download */}
            <button onClick={()=>{
              const esc=v=>{if(v===null||v===undefined)return"";const s=String(v);return s.includes(",")||s.includes('"')?`"${s.replace(/"/g,'""')}"`  :s;};
              const lines=[sumResult.headers.map(esc).join(","),...sumResult.rows.map(r=>sumResult.headers.map(h=>esc(r[h])).join(","))];
              const blob=new Blob([lines.join("\r\n")],{type:"text/csv"});
              const a=document.createElement("a");a.href=URL.createObjectURL(blob);
              a.download=`summary_${sumResult.by.join("_")}.csv`;a.click();URL.revokeObjectURL(a.href);
            }} style={{
              padding:"0.22rem 0.6rem",background:"transparent",
              border:`1px solid ${C.border2}`,borderRadius:2,
              color:C.textDim,cursor:"pointer",fontSize: T.caption.fontSize,fontFamily: T.code.fontFamily}}
              onMouseEnter={e=>{e.currentTarget.style.borderColor=C.teal;e.currentTarget.style.color=C.teal;}}
              onMouseLeave={e=>{e.currentTarget.style.borderColor=C.border2;e.currentTarget.style.color=C.textDim;}}>
              ↓ CSV
            </button>
            {/* Save as Dataset */}
            {onSaveDataset && (
              <div style={{display:"flex",alignItems:"center",gap:4,borderLeft:`1px solid ${C.border2}`,paddingLeft:8}}>
                <input
                  value={saveName}
                  onChange={e=>{setSaveName(e.target.value);setSaved(false);}}
                  placeholder={`summary_${sumResult.by.join("_")}`}
                  style={{padding:"0.2rem 0.45rem",background:C.surface,border:`1px solid ${C.border2}`,
                    borderRadius:2,color:C.text,fontSize: T.caption.fontSize,fontFamily: T.code.fontFamily,width:140,outline:"none"}}
                />
                <button onClick={()=>{
                  const name=(saveName.trim()||`summary_${sumResult.by.join("_")}`);
                  onSaveDataset(name, sumResult.rows, sumResult.headers, {
                    type: "group_summarize",
                    by: [...sumResult.by],
                    aggs: sumResult.aggs.map(agg => ({ ...agg })),
                  });
                  setSaved(true);setTimeout(()=>setSaved(false),2000);
                }} style={{
                  padding:"0.22rem 0.6rem",background:saved?`${C.teal}18`:`${C.teal}12`,
                  border:`1px solid ${saved?C.teal:C.border2}`,borderRadius:2,
                  color:saved?C.teal:C.textDim,cursor:"pointer",fontSize: T.caption.fontSize,fontFamily: T.code.fontFamily,whiteSpace:"nowrap"}}>
                  {saved?"✓ Saved":"⊕ Save as Dataset"}
                </button>
              </div>
            )}
          </div>
          {/* LaTeX panel */}
          {latexOpen && (()=>{
            const tex = buildLatex(sumResult);
            return (
              <div style={{padding:"0.75rem 0.9rem",background:C.surface2,borderBottom:`1px solid ${C.border}`}}>
                <div style={{display:"flex",alignItems:"center",gap:8,marginBottom:6}}>
                  <span style={{fontSize: T.caption.fontSize,color:C.gold,letterSpacing:"0.15em",
                    textTransform:"uppercase",fontFamily: T.code.fontFamily,flex:1}}>LaTeX — tabular</span>
                  <button onClick={()=>{navigator.clipboard.writeText(tex).then(()=>{setCopied(true);setTimeout(()=>setCopied(false),1800);});}} style={{
                    padding:"0.22rem 0.75rem",
                    background:copied?`${C.teal}18`:`${C.gold}10`,
                    border:`1px solid ${copied?C.teal:C.gold}`,
                    borderRadius:3,color:copied?C.teal:C.gold,
                    cursor:"pointer",fontSize: T.caption.fontSize,fontFamily: T.code.fontFamily,fontWeight:600}}>
                    {copied ? "✓ Copied" : "⎘ Copy"}
                  </button>
                </div>
                <pre style={{margin:0,fontSize: T.caption.fontSize,color:C.textDim,fontFamily: T.code.fontFamily,
                  overflowX:"auto",lineHeight:1.6,whiteSpace:"pre"}}>{tex}</pre>
              </div>
            );
          })()}
          {/* Data table */}
          <div style={{overflowX:"auto",maxHeight:400,overflowY:"auto"}}>
            <table style={{borderCollapse:"collapse",fontSize: T.code.fontSize,width:"100%",fontFamily: T.code.fontFamily}}>
              <thead>
                <tr style={{background:C.surface2,position:"sticky",top:0}}>
                  {sumResult.headers.map(h => {
                    const isBy = sumResult.by.includes(h);
                    const aggDef = sumResult.aggs.find(a=>a.nn===h);
                    return (
                      <th key={h} style={{padding:"0.4rem 0.75rem",
                        textAlign:isBy?"left":"right",fontWeight:400,fontSize: T.caption.fontSize,
                        color:isBy?C.gold:C.blue,whiteSpace:"nowrap",
                        borderBottom:`1px solid ${C.border}`}}>
                        {h}<span style={{fontSize: T.caption.fontSize,color:C.textMuted,marginLeft:4}}>{isBy?"group":aggDef?.fn}</span>
                      </th>
                    );
                  })}
                </tr>
              </thead>
              <tbody>
                {sumResult.rows.map((row,i)=>(
                  <tr key={i} style={{background:i%2?C.surface2:C.surface}}>
                    {sumResult.headers.map(h=>{
                      const v=row[h];
                      const isNull=v===null||v===undefined;
                      const isNum=typeof v==="number";
                      const isBy=sumResult.by.includes(h);
                      return (
                        <td key={h} style={{padding:"0.32rem 0.75rem",
                          color:isNull?C.textMuted:isNum?C.blue:C.text,
                          borderBottom:`1px solid ${C.border}`,whiteSpace:"nowrap",
                          textAlign:isBy?"left":"right"}}>
                          {isNull?"·":isNum?v.toFixed(3):String(v)}
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
  );
}

// ─── QUICK FILTER ─────────────────────────────────────────────────────────────
// Ephemeral in-explorer filter — never touches the pipeline or rawData.
// Conditions are ANDed; numeric ops (>,<,>=,<=) skip non-numeric values.
const FILTER_OPS = [">", "<", ">=", "<=", "=", "≠", "contains"];

function matchCond(row, {col, op, val}) {
  const v = row[col];
  if (op === "contains") return String(v ?? "").toLowerCase().includes(String(val).toLowerCase());
  if (op === "=")  return String(v) === String(val);
  if (op === "≠")  return String(v) !== String(val);
  const n = parseFloat(val);
  if (!isFinite(n) || typeof v !== "number") return true; // skip invalid numeric cond
  if (op === ">")  return v > n;
  if (op === "<")  return v < n;
  if (op === ">=") return v >= n;
  if (op === "<=") return v <= n;
  return true;
}

function QuickFilter({headers, totalRows, filteredCount, conds, setConds}) {
  const {C, T} = useTheme();
  const [open, setOpen] = useState(false);
  const active = conds.length > 0;
  const isFiltered = filteredCount !== totalRows;
  const selStyle = {fontFamily: T.code.fontFamily,fontSize: T.caption.fontSize,background:C.surface2,border:`1px solid ${C.border}`,color:C.text,borderRadius:3,padding:"0.2rem 0.3rem"};
  const upd = (i, patch) => setConds(cs => cs.map((c,j) => j===i ? {...c,...patch} : c));

  return (
    <div style={{marginBottom:"0.8rem"}}>
      <div style={{display:"flex",alignItems:"center",gap:8}}>
        <button onClick={()=>setOpen(s=>!s)} style={{padding:"0.22rem 0.7rem",borderRadius:3,cursor:"pointer",fontFamily: T.code.fontFamily,fontSize: T.caption.fontSize,background:active?`${C.teal}18`:"transparent",border:`1px solid ${active?C.teal:C.border2}`,color:active?C.teal:C.textDim,transition:"all 0.12s"}}>
          ⊘ Filter{active?` (${conds.length})`:""}
        </button>
        {isFiltered&&<span style={{fontSize: T.caption.fontSize,color:C.teal,fontFamily: T.code.fontFamily}}>{filteredCount.toLocaleString()} / {totalRows.toLocaleString()} rows</span>}
        {active&&<button onClick={()=>{setConds([]);}} style={{fontSize: T.caption.fontSize,color:C.textMuted,background:"none",border:"none",cursor:"pointer",fontFamily: T.code.fontFamily,padding:0}}>× clear</button>}
      </div>
      {open&&(
        <div style={{marginTop:6,padding:"0.7rem",background:C.surface,border:`1px solid ${C.border}`,borderRadius:4}}>
          {conds.map((cond,i)=>(
            <div key={i} style={{display:"flex",gap:4,alignItems:"center",marginBottom:4}}>
              <select value={cond.col} onChange={e=>upd(i,{col:e.target.value})} style={selStyle}>
                {headers.map(h=><option key={h} value={h}>{h}</option>)}
              </select>
              <select value={cond.op} onChange={e=>upd(i,{op:e.target.value})} style={{...selStyle,width:76}}>
                {FILTER_OPS.map(op=><option key={op} value={op}>{op}</option>)}
              </select>
              <input value={cond.val} onChange={e=>upd(i,{val:e.target.value})}
                style={{...selStyle,width:100}} placeholder="value" />
              <button onClick={()=>setConds(cs=>cs.filter((_,j)=>j!==i))}
                style={{background:"none",border:"none",color:C.textDim,cursor:"pointer",fontSize: T.h2.fontSize,lineHeight:1,padding:"0 2px"}}>×</button>
            </div>
          ))}
          <button onClick={()=>setConds(cs=>[...cs,{col:headers[0]??"",op:">",val:""}])}
            style={{fontSize: T.caption.fontSize,color:C.teal,background:"none",border:`1px solid ${C.teal}40`,borderRadius:3,cursor:"pointer",fontFamily: T.code.fontFamily,padding:"0.2rem 0.5rem",marginTop:2}}>
            + condition
          </button>
        </div>
      )}
    </div>
  );
}

// ─── EVIDENCE EXPLORER ROOT ───────────────────────────────────────────────────
export default function ExplorerModule({cleanedData, onBack, onProceed, onSaveDataset, pid}) {
  const{C,T}=useTheme();
  const {headers, cleanRows:previewRows, panelIndex:panel, filename, pipeline = []} = cleanedData;
  // DuckDB-backed datasets ship only a 500-row preview in cleanRows; pull the FULL
  // table for computation (summary stats, distributions, correlation, plots). The
  // raw data grid can stay on the preview — this only affects analysis.
  const duckTable = cleanedData._duckdb?.tableName ?? null;
  const [fullRows, setFullRows] = useState(null);
  useEffect(() => {
    let cancelled = false;
    setFullRows(null);
    if (!duckTable) return;
    extractAllRows(duckTable).then(all => { if (!cancelled) setFullRows(all); }).catch(() => {});
    return () => { cancelled = true; };
  }, [duckTable]);
  const rows = (duckTable && fullRows) ? fullRows : previewRows;
  const info = useMemo(()=>buildInfo(headers,rows), [headers,rows]);
  const [tab,setTab] = useState("summary");
  const [filterConds, setFilterConds] = useState([]);
  const filteredRows = useMemo(()=>{
    if(!filterConds.length) return rows;
    return rows.filter(row=>filterConds.every(cond=>matchCond(row,cond)));
  },[rows,filterConds]);
  const corrRef = useRef(null);

  // ── Pin-for-replication emitter (Fase 1.3, D5) ──────────────────────────────
  // Every pin records the active QuickFilter so the replicated stat/plot runs
  // on exactly the rows the user was looking at (D8 argument fidelity).
  const { appendLog } = useSessionLogOptional();
  const pinExplore = (params, label) => appendLog({
    module: "explore", opType: "explore_stat",
    params: { ...params, dataset: filename ?? null, filters: filterConds.length ? filterConds : null },
    label,
  });

  function downloadExploreScript(language) {
    const ext    = { r: "R", stata: "do", python: "py" }[language];
    const base   = (filename || "dataset").replace(/\.[^.]+$/, "");
    const dsName = base.replace(/[^a-zA-Z0-9_]/g, "_").replace(/^[0-9]/, "_");
    let script   = "";
    if (pipeline.length > 0) {
      try {
        script = generateCleanScript({ language, datasetName: dsName, filename, pipeline }) + "\n\n";
      } catch (_) { /* skip pipeline section if it fails */ }
    }
    script += generateExploreScript(language, { headers, info, filename });
    const blob = new Blob([script], { type: "text/plain" });
    const a    = document.createElement("a");
    a.href     = URL.createObjectURL(blob);
    a.download = `${base}_explore.${ext}`;
    a.click(); URL.revokeObjectURL(a.href);
  }

  function downloadCSV() {
    const base = (filename || "dataset").replace(/\.[^.]+$/, "");
    const esc  = v => {
      if (v === null || v === undefined) return "";
      const s = String(v);
      return s.includes(",") || s.includes('"') || s.includes("\n")
        ? `"${s.replace(/"/g, '""')}"` : s;
    };
    const lines = [headers.join(","), ...filteredRows.map(r => headers.map(h => esc(r[h])).join(","))];
    const blob  = new Blob([lines.join("\r\n")], { type: "text/csv" });
    const a     = document.createElement("a");
    a.href      = URL.createObjectURL(blob);
    a.download  = `${base}_export.csv`;
    a.click(); URL.revokeObjectURL(a.href);
  }

  return(
    <div style={{display:"flex",height:"100%",minHeight:0,background:C.bg,color:C.text,fontFamily:T.body.fontFamily,overflow:"hidden"}}>
      <div style={{flex:1,minWidth:0,overflowY:"auto",padding:"1.4rem",paddingBottom:"3rem"}}>
        {/* Header */}
        <div style={{marginBottom:"1.2rem",display:"flex",alignItems:"flex-start",gap:12}}>
          <div style={{flex:1}}>
            <div style={{fontSize: T.caption.fontSize,color:C.violet,letterSpacing:"0.26em",textTransform:"uppercase",marginBottom:3}}>Evidence Explorer</div>
            <div style={{fontSize: T.h2.fontSize,color:C.text,letterSpacing:"-0.02em",marginBottom:3}}>Exploratory Analysis</div>
            <div style={{fontSize: T.code.fontSize,color:C.textDim,fontFamily: T.code.fontFamily}}>
              <span style={{color:C.gold}}>{filteredRows.length !== rows.length ? `${filteredRows.length.toLocaleString()} of ${rows.length.toLocaleString()}` : rows.length}</span> obs ·{" "}
              <span style={{color:C.teal}}>{headers.filter(h=>info[h]?.isNum).length}</span> numeric ·{" "}
              <span style={{color:C.purple}}>{headers.filter(h=>info[h]?.isCat).length}</span> categorical
              {panel&&<span style={{color:C.blue}}> · panel i={panel.entityCol} t={panel.timeCol}</span>}
            </div>
          </div>
          <div style={{display:"flex",gap:6,alignItems:"center",flexShrink:0}}>
            <button onClick={downloadCSV} style={{
              padding:"0.28rem 0.55rem", borderRadius:3, cursor:"pointer",
              fontFamily: T.code.fontFamily, fontSize: T.caption.fontSize, background:"transparent",
              border:`1px solid ${C.border2}`, color:C.textDim, transition:"all 0.12s",
            }}
              title={`Download current view as CSV (${filteredRows.length} rows)`}
              onMouseEnter={e=>{e.currentTarget.style.borderColor=C.gold;e.currentTarget.style.color=C.gold;}}
              onMouseLeave={e=>{e.currentTarget.style.borderColor=C.border2;e.currentTarget.style.color=C.textDim;}}
            >↓CSV</button>
            {["R","Stata","py"].map((lbl, i) => {
              const lang = ["r","stata","python"][i];
              return (
                <button key={lang} onClick={() => downloadExploreScript(lang)} style={{
                  padding:"0.28rem 0.55rem", borderRadius:3, cursor:"pointer",
                  fontFamily: T.code.fontFamily, fontSize: T.caption.fontSize, background:"transparent",
                  border:`1px solid ${C.border2}`, color:C.textDim,
                  transition:"all 0.12s",
                }}
                  title={`Export pipeline + explore script (${lbl})${pipeline.length ? ` · ${pipeline.length} pipeline steps included` : ""}`}
                  onMouseEnter={e=>{e.currentTarget.style.borderColor=C.teal;e.currentTarget.style.color=C.teal;}}
                  onMouseLeave={e=>{e.currentTarget.style.borderColor=C.border2;e.currentTarget.style.color=C.textDim;}}
                >↓{lbl}</button>
              );
            })}
            <button onClick={onBack} style={{padding:"0.28rem 0.65rem",borderRadius:3,cursor:"pointer",fontFamily: T.code.fontFamily,fontSize: T.caption.fontSize,background:"transparent",border:`1px solid ${C.border2}`,color:C.textDim}}>← Wrangling</button>
            <button onClick={onProceed} style={{padding:"0.28rem 0.65rem",borderRadius:3,cursor:"pointer",fontFamily: T.code.fontFamily,fontSize: T.caption.fontSize,background:C.gold,color:C.bg,border:`1px solid ${C.gold}`,fontWeight:700}}>→ Modeling</button>
          </div>
        </div>
        {/* AI Insights */}
        <AIInsights rows={filteredRows} headers={headers} info={info} panel={panel}/>
        <HintBox title="How to explore" sections={[
          { heading: "Filter", items: [
            "⊘ Filter bar slices data temporarily — affects all tabs, never touches the pipeline",
            "Use it to eyeball subgroups without committing to a pipeline step",
          ]},
          { heading: "Summary Table", items: [
            "5-number summary (mean, SD, median, min, max) for all numeric variables",
            "Group By: split statistics by any categorical column",
          ]},
          { heading: "Distributions", items: [
            "Histogram with live stats (mean, SD, median, min, max) — updates instantly with filter",
            "Spaghetti plot: individual panel unit trajectories over time (panel datasets only)",
            "Outlier warning shown if IQR outliers are detected",
          ]},
          { heading: "Time Series", items: [
            "Line chart: aggregate Y over time, optionally split by group",
            "ACF / PACF correlograms for autocorrelation diagnosis",
          ]},
          { heading: "Correlation", items: [
            "Pearson correlation heatmap across all numeric variables",
            "Red = negative · Teal = positive",
          ]},
          { heading: "Plot Builder", items: [
            "Layer-based chart editor: 11 geom types (point, line, bar, histogram, density, smooth, boxplot, errorbar, ribbon, hline, vline)",
            "Aesthetic mappings: x, y, color; position stacking and jitter",
            "Palette presets; export as SVG or PNG",
          ]},
        ]} />
        {/* Quick Filter */}
        <QuickFilter headers={headers} totalRows={rows.length} filteredCount={filteredRows.length} conds={filterConds} setConds={setFilterConds}/>
        {/* Tabs */}
        <div style={{display:"flex",gap:1,background:C.border,borderRadius:4,overflow:"hidden",marginBottom:"1.2rem"}}>
          {[["summary","⊞ Summary"],["visuals","⬡ Distributions"],["corr","⬡ Correlation"],["timeseries","⬡ Time Series"],["plot","◈ Plot Builder"]].map(([k,l])=>(
            <button key={k} onClick={()=>setTab(k)} style={{flex:1,padding:"0.6rem 0.7rem",background:tab===k?C.goldFaint:C.surface,border:"none",color:tab===k?C.gold:C.textDim,cursor:"pointer",fontFamily: T.code.fontFamily,fontSize: T.code.fontSize,borderBottom:tab===k?`2px solid ${C.gold}`:"2px solid transparent",transition:"all 0.12s"}}>{l}</button>
          ))}
        </div>
        {tab==="summary"&&(
          <>
            <SummaryTable rows={filteredRows} headers={headers} info={info} panel={panel} onPin={pinExplore}/>
            <DispersionPanel rows={filteredRows} headers={headers} info={info} onPin={pinExplore}/>
            <div style={{marginTop:"2rem",borderTop:`1px solid ${C.border}`,paddingTop:"1.5rem"}}>
              <div style={{fontSize: T.caption.fontSize,color:C.textMuted,letterSpacing:"0.2em",textTransform:"uppercase",marginBottom:"0.8rem",fontFamily: T.code.fontFamily}}>Group Summarize</div>
              <GroupSummarizeExplorer rows={filteredRows} headers={headers} info={info} onSaveDataset={onSaveDataset}/>
            </div>
          </>
        )}
        {tab==="visuals"&&<DistributionTab rows={filteredRows} headers={headers} info={info} panel={panel} onPin={pinExplore}/>}
        {tab==="corr"&&(
          <div>
            <div style={{fontSize: T.code.fontSize,color:C.textDim,lineHeight:1.7,marginBottom:"1.2rem",padding:"0.65rem 1rem",background:C.surface,border:`1px solid ${C.border}`,borderLeft:`3px solid ${C.teal}`,borderRadius:4,display:"flex",alignItems:"center",gap:10}}>
              <span style={{flex:1}}>Pearson correlation between all numeric variables. Red = negative, Teal = positive.</span>
              <PinBtn onClick={()=>{
                const cols=headers.filter(h=>info[h]?.isNum&&info[h]?.mean!=null);
                pinExplore({kind:"correlation",method:"pearson",cols},`Correlation matrix (pearson) over ${cols.length} numeric vars`);
              }}/>
            </div>
            <div ref={corrRef} style={{border:`1px solid ${C.border}`,borderRadius:4,overflow:"hidden"}}>
              <div style={{padding:"0.5rem"}}>
                <CorrHeatmap headers={headers} rows={filteredRows} info={info}/>
              </div>
              <PlotExportBar getEl={() => corrRef.current} filename="correlation_heatmap" />
            </div>
          </div>
        )}
        {tab==="timeseries"&&<TimeSeriesTab rows={filteredRows} headers={headers} info={info} panel={panel} onPin={pinExplore}/>}
        {tab==="plot"&&<PlotBuilder headers={headers} rows={filteredRows} pid={pid} style={{marginTop:"0.25rem", height:"70vh", minHeight:520}}/>}
      </div>
    </div>
  );
}
