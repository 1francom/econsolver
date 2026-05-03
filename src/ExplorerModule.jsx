// ─── ECON STUDIO · ExplorerModule.jsx ────────────────────────────────────────
// Evidence Explorer: EDA, distributions, correlation heatmap, AI insights.
// Consumes cleanedData emitted by WranglingModule.
import { useState, useMemo, useRef } from "react";
import { useTheme } from "./ThemeContext.jsx";
import { buildInfo } from "./WranglingModule.jsx";
import { computeACF, computePACF, adfTest } from "./math/timeSeries.js";
import PlotBuilder from "./components/PlotBuilder.jsx";
import { HintBox } from "./components/HelpSystem.jsx";
import PlotExportBar from "./components/shared/PlotExportBar.jsx";

// ─── THEME ────────────────────────────────────────────────────────────────────
const mono = "'IBM Plex Mono','JetBrains Mono',Consolas,monospace";

// ─── ATOMS ────────────────────────────────────────────────────────────────────
function Lbl({children,color,mb=6}){const{C}=useTheme();color=color??C.textMuted;return<div style={{fontSize:10,color,letterSpacing:"0.2em",textTransform:"uppercase",marginBottom:mb,fontFamily:mono}}>{children}</div>;}
function Btn({onClick,ch,color,v="out",dis=false,sm=false}){
  const{C}=useTheme();color=color??C.gold;
  const b={padding:sm?"0.28rem 0.65rem":"0.48rem 0.95rem",borderRadius:3,cursor:dis?"not-allowed":"pointer",fontFamily:mono,fontSize:sm?10:11,transition:"all 0.13s",opacity:dis?0.4:1};
  if(v==="solid")return<button onClick={onClick} disabled={dis} style={{...b,background:color,color:C.bg,border:`1px solid ${color}`,fontWeight:700}}>{ch}</button>;
  return<button onClick={onClick} disabled={dis} style={{...b,background:"transparent",border:`1px solid ${C.border2}`,color:dis?C.textMuted:C.textDim}}>{ch}</button>;
}
function Spin(){const{C}=useTheme();return<div style={{width:14,height:14,border:`2px solid ${C.border2}`,borderTopColor:C.gold,borderRadius:"50%",animation:"spin 0.7s linear infinite",flexShrink:0}}/>;}

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
function SvgHistogram({data,color,label=""}){
  const{C}=useTheme();color=color??C.gold;
  const W=320,H=120,PAD=24;
  if(!data.length)return null;
  const min=Math.min(...data),max=Math.max(...data);
  const range=max-min||1;
  const bins=20,bw=range/bins;
  const counts=Array(bins).fill(0);
  data.forEach(v=>{const b=Math.min(bins-1,Math.floor((v-min)/bw));counts[b]++;});
  const maxC=Math.max(...counts,1);
  const barW=(W-PAD*2)/bins;
  return(
    <svg viewBox={`0 0 ${W} ${H+PAD}`} style={{width:"100%",maxWidth:W,display:"block",fontFamily:mono}}>
      {counts.map((c,i)=>{
        const x=PAD+i*barW,h=(c/maxC)*(H-8),y=H-h;
        return<rect key={i} x={x+1} y={y} width={barW-2} height={h} fill={color} opacity={0.7} rx={1}/>;
      })}
      <line x1={PAD} y1={H} x2={W-PAD} y2={H} stroke={C.border2} strokeWidth={1}/>
      <text x={PAD} y={H+14} fill={C.textMuted} fontSize={8} fontFamily={mono}>{min.toFixed(2)}</text>
      <text x={W-PAD} y={H+14} fill={C.textMuted} fontSize={8} fontFamily={mono} textAnchor="end">{max.toFixed(2)}</text>
      {label&&<text x={W/2} y={H+14} fill={C.textDim} fontSize={8} fontFamily={mono} textAnchor="middle">{label}</text>}
    </svg>
  );
}


function SvgSpaghetti({rows,entityCol,timeCol,col,sampleN=15}){
  const{C}=useTheme();
  const W=380,H=200,PAD=36;
  const entities=[...new Set(rows.map(r=>r[entityCol]))];
  const seed=entities.length;
  const sampled=entities.slice().sort(()=>Math.sin(seed)*0.5).slice(0,sampleN);
  const times=[...new Set(rows.map(r=>r[timeCol]))].sort((a,b)=>a-b);
  if(times.length<2||sampled.length<2)return<div style={{fontSize:11,color:C.textMuted,fontFamily:mono}}>Need ≥2 periods and ≥2 units.</div>;
  const allVals=rows.filter(r=>sampled.includes(r[entityCol])&&typeof r[col]==="number").map(r=>r[col]);
  if(!allVals.length)return null;
  const minV=Math.min(...allVals),maxV=Math.max(...allVals);
  const rV=maxV-minV||1;
  const toX=t=>PAD+(times.indexOf(t)/(times.length-1))*(W-PAD*2);
  const toY=v=>(H-PAD)-(v-minV)/rV*(H-PAD*2);
  const palette=[C.teal,C.gold,C.blue,C.purple,C.orange,C.green,C.red,C.violet,C.yellow,"#8ecac8","#c8b46e","#9eb896"];
  return(
    <svg viewBox={`0 0 ${W} ${H}`} style={{width:"100%",maxWidth:W,display:"block",fontFamily:mono}}>
      <line x1={PAD} y1={PAD} x2={PAD} y2={H-PAD} stroke={C.border2} strokeWidth={1}/>
      <line x1={PAD} y1={H-PAD} x2={W-PAD} y2={H-PAD} stroke={C.border2} strokeWidth={1}/>
      {times.map(t=><line key={t} x1={toX(t)} y1={PAD} x2={toX(t)} y2={H-PAD} stroke={C.border} strokeWidth={1} strokeDasharray="2,4"/>)}
      {sampled.map((e,ei)=>{
        const pts=times.map(t=>{const r=rows.find(r=>r[entityCol]===e&&r[timeCol]===t);return r&&typeof r[col]==="number"?{x:toX(t),y:toY(r[col])}:null;}).filter(Boolean);
        if(pts.length<2)return null;
        const d=pts.map((p,i)=>`${i===0?"M":"L"}${p.x},${p.y}`).join(" ");
        return<path key={e} d={d} fill="none" stroke={palette[ei%palette.length]} strokeWidth={1.4} opacity={0.75}/>;
      })}
      {times.map(t=><text key={t} x={toX(t)} y={H-PAD+12} fill={C.textMuted} fontSize={8} fontFamily={mono} textAnchor="middle">{t}</text>)}
      <text x={PAD-4} y={PAD} fill={C.textMuted} fontSize={8} fontFamily={mono} textAnchor="end">{maxV.toFixed(1)}</text>
      <text x={PAD-4} y={H-PAD} fill={C.textMuted} fontSize={8} fontFamily={mono} textAnchor="end">{minV.toFixed(1)}</text>
    </svg>
  );
}

function CorrHeatmap({headers,rows,info}){
  const{C}=useTheme();
  const numH=headers.filter(h=>info[h]?.isNum&&info[h]?.mean!=null);
  if(numH.length<2)return<div style={{fontSize:11,color:C.textMuted,fontFamily:mono}}>Need ≥2 numeric columns.</div>;
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
      <svg viewBox={`0 0 ${W+8} ${H_total+8}`} style={{width:"100%",maxWidth:W+8,display:"block",fontFamily:mono}}>
        {numH.map((h,i)=>(
          <text key={h} x={lblH+i*cellSz+cellSz/2} y={lblH-4} fill={C.textDim} fontSize={Math.max(6,Math.min(9,cellSz/4))} fontFamily={mono} textAnchor="middle" transform={`rotate(-35,${lblH+i*cellSz+cellSz/2},${lblH-4})`}>{h.slice(0,8)}</text>
        ))}
        {numH.map((h,i)=>(
          <text key={h} x={lblH-4} y={lblH+i*cellSz+cellSz/2+3} fill={C.textDim} fontSize={Math.max(6,Math.min(9,cellSz/4))} fontFamily={mono} textAnchor="end">{h.slice(0,8)}</text>
        ))}
        {mat.map((row,ri)=>row.map((v,ci)=>(
          <g key={`${ri}-${ci}`}>
            <rect x={lblH+ci*cellSz} y={lblH+ri*cellSz} width={cellSz-1} height={cellSz-1} fill={corToColor(v)} rx={2}/>
            {cellSz>28&&<text x={lblH+ci*cellSz+cellSz/2} y={lblH+ri*cellSz+cellSz/2+4} fill={C.text} fontSize={Math.max(6,Math.min(9,cellSz/5))} fontFamily={mono} textAnchor="middle" opacity={0.9}>{v.toFixed(2)}</text>}
          </g>
        )))}
      </svg>
      <div style={{display:"flex",gap:12,marginTop:8,alignItems:"center"}}>
        <span style={{fontSize:9,color:C.textMuted,fontFamily:mono}}>← negative (red)</span>
        <div style={{flex:1,height:6,borderRadius:3,background:`linear-gradient(to right,${C.red},${C.surface3},${C.teal})`}}/>
        <span style={{fontSize:9,color:C.textMuted,fontFamily:mono}}>positive (teal) →</span>
      </div>
    </div>
  );
}

// ─── SUMMARY TABLE (Table 1) ──────────────────────────────────────────────────
function SummaryTable({rows,headers,info,panel}){
  const{C}=useTheme();
  const numH=headers.filter(h=>info[h]?.isNum&&info[h]?.mean!=null);
  const catH=headers.filter(h=>info[h]?.isCat&&!info[h]?.isNum);
  const [groupBy,setGroupBy]=useState("");
  const groups=groupBy?[...new Set(rows.map(r=>r[groupBy]).filter(v=>v!=null))].sort():["All"];

  function statsFor(subset,col){
    const vals=subset.map(r=>r[col]).filter(v=>typeof v==="number"&&isFinite(v)).sort((a,b)=>a-b);
    if(!vals.length)return{mean:null,std:null,min:null,max:null,median:null,n:0};
    const mean=vals.reduce((a,b)=>a+b,0)/vals.length;
    const std=Math.sqrt(vals.reduce((s,v)=>s+(v-mean)**2,0)/vals.length);
    const median=vals.length%2===0?(vals[vals.length/2-1]+vals[vals.length/2])/2:vals[Math.floor(vals.length/2)];
    return{mean,std,min:vals[0],max:vals[vals.length-1],median,n:vals.length};
  }
  const fmt=v=>v!=null?v.toFixed(3):"—";
  const thS={padding:"0.35rem 0.6rem",fontFamily:mono,fontSize:9,color:C.textMuted,fontWeight:400,letterSpacing:"0.1em",textTransform:"uppercase",borderBottom:`1px solid ${C.border}`,background:C.surface2,textAlign:"right",whiteSpace:"nowrap"};
  const tdS={padding:"0.32rem 0.6rem",fontFamily:mono,fontSize:10,color:C.text,borderBottom:`1px solid ${C.border}`,textAlign:"right",whiteSpace:"nowrap"};
  return(
    <div>
      <div style={{marginBottom:"1.2rem",display:"flex",gap:12,alignItems:"center",flexWrap:"wrap"}}>
        <Lbl mb={0}>Group by</Lbl>
        <div style={{display:"flex",gap:4,flexWrap:"wrap"}}>
          <button onClick={()=>setGroupBy("")} style={{padding:"0.22rem 0.6rem",border:`1px solid ${!groupBy?C.gold:C.border2}`,background:!groupBy?C.goldFaint:"transparent",color:!groupBy?C.gold:C.textDim,borderRadius:3,cursor:"pointer",fontSize:10,fontFamily:mono}}>None</button>
          {catH.map(h=><button key={h} onClick={()=>setGroupBy(h)} style={{padding:"0.22rem 0.6rem",border:`1px solid ${groupBy===h?C.gold:C.border2}`,background:groupBy===h?C.goldFaint:"transparent",color:groupBy===h?C.gold:C.textDim,borderRadius:3,cursor:"pointer",fontSize:10,fontFamily:mono}}>{h}</button>)}
        </div>
      </div>
      <div style={{overflowX:"auto",borderRadius:4,border:`1px solid ${C.border}`}}>
        <table style={{borderCollapse:"collapse",width:"100%",fontSize:11}}>
          <thead>
            <tr>
              <th style={{...thS,textAlign:"left",minWidth:80}}>Variable</th>
              {groups.map(g=><th key={g} colSpan={5} style={{...thS,textAlign:"center",color:C.gold,minWidth:groupBy?320:260}}>{groupBy?String(g):"Full sample"} {groupBy&&<span style={{color:C.textMuted}}>({rows.filter(r=>r[groupBy]===g).length})</span>}</th>)}
            </tr>
            <tr>
              <th style={{...thS,textAlign:"left"}}/>
              {groups.map(g=>["Mean","SD","Median","Min","Max"].map(l=><th key={g+l} style={thS}>{l}</th>))}
            </tr>
          </thead>
          <tbody>
            {numH.map((h,ri)=>(
              <tr key={h} style={{background:ri%2?C.surface2:C.surface}}>
                <td style={{...tdS,textAlign:"left",color:C.teal}}>{h}</td>
                {groups.map(g=>{
                  const subset=groupBy?rows.filter(r=>r[groupBy]===g):rows;
                  const s=statsFor(subset,h);
                  return["mean","std","median","min","max"].map(k=><td key={g+k} style={tdS}>{fmt(s[k])}</td>);
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div style={{marginTop:8,fontSize:10,color:C.textMuted,fontFamily:mono}}>N={rows.length} total observations · {numH.length} numeric variables</div>
    </div>
  );
}

// ─── DISTRIBUTION TAB ─────────────────────────────────────────────────────────
function DistributionTab({rows,headers,info,panel}){
  const{C}=useTheme();
  const numH=headers.filter(h=>info[h]?.isNum&&info[h]?.mean!=null);
  const [histCol,setHistCol]=useState(numH[0]||"");
  const [spagCol,setSpagCol]=useState(numH[0]||"");
  const [sub,setSub]=useState("hist");
  const hasPanel=panel?.entityCol&&panel?.timeCol;
  const subTabs=[["hist","Histogram"],...(hasPanel?[["spaghetti","Spaghetti"]]:[])]

  return(
    <div>
      {subTabs.length > 1 && (
        <div style={{display:"flex",gap:1,background:C.border,borderRadius:4,overflow:"hidden",marginBottom:"1.2rem"}}>
          {subTabs.map(([k,l])=><button key={k} onClick={()=>setSub(k)} style={{flex:1,padding:"0.42rem 0.5rem",background:sub===k?`${C.teal}18`:C.surface,border:"none",color:sub===k?C.teal:C.textDim,cursor:"pointer",fontFamily:mono,fontSize:10,borderBottom:sub===k?`2px solid ${C.teal}`:"2px solid transparent",transition:"all 0.12s"}}>{l}</button>)}
        </div>
      )}
      {sub==="hist"&&(
        <div>
          <Lbl>Variable</Lbl>
          <div style={{display:"flex",flexWrap:"wrap",gap:4,marginBottom:"1.2rem"}}>
            {numH.map(h=><button key={h} onClick={()=>setHistCol(h)} style={{padding:"0.25rem 0.6rem",border:`1px solid ${histCol===h?C.teal:C.border2}`,background:histCol===h?`${C.teal}18`:"transparent",color:histCol===h?C.teal:C.textDim,borderRadius:3,cursor:"pointer",fontSize:11,fontFamily:mono}}>{histCol===h?"✓ ":""}{h}</button>)}
          </div>
          {histCol&&(()=>{
            const vals=rows.map(r=>r[histCol]).filter(v=>typeof v==="number"&&isFinite(v));
            const i=info[histCol];
            return(
              <div>
                <div style={{display:"grid",gridTemplateColumns:"repeat(5,1fr)",gap:1,background:C.border,borderRadius:4,overflow:"hidden",marginBottom:"1rem"}}>
                  {[["mean",i?.mean],["std",i?.std],["median",i?.median],["min",i?.min],["max",i?.max]].map(([l,v])=>(
                    <div key={l} style={{background:C.surface,padding:"0.5rem 0.6rem"}}>
                      <div style={{fontSize:8,color:C.textMuted,fontFamily:mono,letterSpacing:"0.1em",textTransform:"uppercase",marginBottom:2}}>{l}</div>
                      <div style={{fontSize:14,color:C.gold,fontFamily:mono}}>{v!=null?v.toFixed(3):"—"}</div>
                    </div>
                  ))}
                </div>
                <SvgHistogram data={vals} color={C.teal} label={histCol}/>
                {i?.outliers>0&&<div style={{marginTop:8,fontSize:11,color:C.orange,fontFamily:mono}}>⚠ {i.outliers} IQR-outlier{i.outliers>1?"s":""} detected. Consider winsorizing.</div>}
              </div>
            );
          })()}
        </div>
      )}
      {sub==="spaghetti"&&hasPanel&&(
        <div>
          <Lbl>Variable to track</Lbl>
          <div style={{display:"flex",flexWrap:"wrap",gap:4,marginBottom:"1.2rem"}}>
            {numH.map(h=><button key={h} onClick={()=>setSpagCol(h)} style={{padding:"0.25rem 0.6rem",border:`1px solid ${spagCol===h?C.orange:C.border2}`,background:spagCol===h?`${C.orange}18`:"transparent",color:spagCol===h?C.orange:C.textDim,borderRadius:3,cursor:"pointer",fontSize:11,fontFamily:mono}}>{spagCol===h?"✓ ":""}{h}</button>)}
          </div>
          {spagCol&&<div>
            <div style={{fontSize:10,color:C.textMuted,fontFamily:mono,marginBottom:8}}>i={panel.entityCol} · t={panel.timeCol} · showing ≤15 random units</div>
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
  const{C}=useTheme();
  const maxLag = acf.length - 1;
  const W = 620, H = 260;
  const PAD = { l: 48, r: 16, t: 20, b: 36 };
  const iW = W - PAD.l - PAD.r;
  const iH = (H - PAD.t - PAD.b) / 2 - 8; // half height per chart
  const conf = 1.96 / Math.sqrt(n);

  function renderBars(vals, offsetY, color, label) {
    const barW = Math.max(2, iW / (maxLag + 1) - 2);
    const yMid = offsetY + iH / 2;
    const scaleY = v => yMid - (v / 1.0) * (iH / 2);
    return (
      <g>
        {/* label */}
        <text x={PAD.l + 2} y={offsetY + 10} fill={color} fontSize={8} fontFamily="'IBM Plex Mono',monospace" letterSpacing="0.1em">{label}</text>
        {/* zero line */}
        <line x1={PAD.l} x2={PAD.l + iW} y1={yMid} y2={yMid} stroke="#252525" strokeWidth={1} />
        {/* confidence bands */}
        <line x1={PAD.l} x2={PAD.l + iW} y1={scaleY(conf)}  y2={scaleY(conf)}  stroke="#c47070" strokeWidth={1} strokeDasharray="4 3" opacity={0.7} />
        <line x1={PAD.l} x2={PAD.l + iW} y1={scaleY(-conf)} y2={scaleY(-conf)} stroke="#c47070" strokeWidth={1} strokeDasharray="4 3" opacity={0.7} />
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
                <text x={x} y={offsetY + iH + 14} textAnchor="middle" fill="#444" fontSize={7} fontFamily="'IBM Plex Mono',monospace">{lag}</text>
              )}
            </g>
          );
        })}
        {/* y-axis ticks */}
        {[-1, -0.5, 0, 0.5, 1].map(v => (
          <g key={v}>
            <line x1={PAD.l - 3} x2={PAD.l} y1={scaleY(v)} y2={scaleY(v)} stroke="#252525" strokeWidth={1} />
            <text x={PAD.l - 5} y={scaleY(v) + 3} textAnchor="end" fill="#444" fontSize={7} fontFamily="'IBM Plex Mono',monospace">{v}</text>
          </g>
        ))}
      </g>
    );
  }

  const acfOffsetY  = PAD.t;
  const pacfOffsetY = PAD.t + iH + 24;

  return (
    <svg viewBox={`0 0 ${W} ${H}`} style={{ width: "100%", maxWidth: 700, height: "auto", display: "block", fontFamily: "'IBM Plex Mono',monospace" }}>
      <rect width={W} height={H} fill="#080808" />
      {renderBars(acf,  acfOffsetY,  "#6ec8b4", "ACF")}
      {renderBars(pacf, pacfOffsetY, "#c8a96e", "PACF")}
      {/* conf band legend */}
      <line x1={PAD.l + iW - 80} x2={PAD.l + iW - 60} y1={H - 10} y2={H - 10} stroke="#c47070" strokeWidth={1} strokeDasharray="4 3" opacity={0.7} />
      <text x={PAD.l + iW - 56} y={H - 7} fill="#888" fontSize={7} fontFamily="'IBM Plex Mono',monospace">95% CI (±1.96/√n)</text>
      {/* lag axis label */}
      <text x={PAD.l + iW / 2} y={H - 1} textAnchor="middle" fill="#444" fontSize={7} fontFamily="'IBM Plex Mono',monospace">Lag</text>
    </svg>
  );
}

// ─── ADF RESULTS PANEL ────────────────────────────────────────────────────────
function AdfPanel({ results }) {
  const{C}=useTheme();
  if (!results?.length) return null;
  const mono = "'IBM Plex Mono','JetBrains Mono',Consolas,monospace";
  return (
    <div style={{ padding: "0.8rem 0.9rem", display: "flex", flexDirection: "column", gap: 8 }}>
      <div style={{ fontSize: 9, color: "#444", letterSpacing: "0.2em", textTransform: "uppercase", fontFamily: mono, marginBottom: 4 }}>
        Augmented Dickey-Fuller · H₀: unit root (non-stationary) · constant, no trend
      </div>
      {/* header row */}
      <div style={{ display: "grid", gridTemplateColumns: "3rem 6rem 5rem 6rem 1fr", gap: 8, fontSize: 9, color: "#444", fontFamily: mono, paddingBottom: 4, borderBottom: "1px solid #1c1c1c" }}>
        <span>Lags</span><span>τ statistic</span><span>p-value</span><span>CV (5%)</span><span>Verdict</span>
      </div>
      {results.map(r => {
        const color = r.stationary ? "#6ec8b4" : "#c47070";
        const label = r.stationary ? "✓ Stationary" : "✗ Unit root";
        return (
          <div key={r.lag} style={{ display: "grid", gridTemplateColumns: "3rem 6rem 5rem 6rem 1fr", gap: 8, alignItems: "center", padding: "0.4rem 0.5rem", background: r.stationary ? "#081008" : "#100808", border: `1px solid ${color}20`, borderLeft: `3px solid ${color}`, borderRadius: 3 }}>
            <span style={{ fontSize: 12, color: "#888", fontFamily: mono }}>{r.lag}</span>
            <span style={{ fontSize: 12, color: "#ddd8cc", fontFamily: mono }}>{isFinite(r.stat) ? r.stat.toFixed(4) : "—"}</span>
            <span style={{ fontSize: 12, color: isFinite(r.pVal) && r.pVal < 0.05 ? "#6ec8b4" : "#888", fontFamily: mono }}>
              {isFinite(r.pVal) ? (r.pVal <= 0.01 ? "<0.01" : r.pVal.toFixed(3)) : "—"}
            </span>
            <span style={{ fontSize: 12, color: "#888", fontFamily: mono }}>{isFinite(r.cv5pct) ? r.cv5pct.toFixed(3) : "—"}</span>
            <span style={{ fontSize: 10, color, fontFamily: mono, letterSpacing: "0.08em" }}>{label}</span>
          </div>
        );
      })}
      <div style={{ fontSize: 9, color: "#444", fontFamily: mono, marginTop: 4 }}>
        Reject H₀ when τ &lt; CV(5%). MacKinnon (1994) response-surface critical values.
      </div>
    </div>
  );
}

// ─── TIME SERIES TAB ──────────────────────────────────────────────────────────
function TimeSeriesTab({ rows, headers, info, panel }) {
  const{C}=useTheme();
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
    const tMin = Math.min(...allT), tMax = Math.max(...allT);
    const yMin = Math.min(...allY), yMax = Math.max(...allY);
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
      <div style={{ display: "flex", gap: 1, background: C.border, borderRadius: 3, overflow: "hidden", marginBottom: "1rem", width: "fit-content" }}>
        {[["line","⬡ Line chart"],["acf","⬡ ACF / PACF"],["adf","⬡ ADF test"]].map(([k, l]) => (
          <button key={k} onClick={() => setTsView(k)} style={{ padding: "0.3rem 0.9rem", background: tsView === k ? C.surface3 : C.surface, border: "none", borderBottom: tsView === k ? `2px solid ${C.teal}` : "2px solid transparent", color: tsView === k ? C.teal : C.textMuted, cursor: "pointer", fontFamily: mono, fontSize: 10, transition: "all 0.12s" }}>{l}</button>
        ))}
      </div>

      {/* Controls */}
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr 1fr", gap: 12, marginBottom: "1.4rem" }}>
        {/* Time column */}
        <div>
          <Lbl>Time axis</Lbl>
          <select value={tCol} onChange={e => setTCol(e.target.value)}
            style={{ width: "100%", padding: "0.38rem 0.6rem", background: C.surface2, border: `1px solid ${C.border2}`, borderRadius: 3, color: C.text, fontFamily: mono, fontSize: 11 }}>
            {timeCandidates.map(h => <option key={h} value={h}>{h}</option>)}
          </select>
        </div>
        {/* Y variable */}
        <div>
          <Lbl>Variable (Y)</Lbl>
          <select value={yCol} onChange={e => setYCol(e.target.value)}
            style={{ width: "100%", padding: "0.38rem 0.6rem", background: C.surface2, border: `1px solid ${C.border2}`, borderRadius: 3, color: C.text, fontFamily: mono, fontSize: 11 }}>
            {numH.map(h => <option key={h} value={h}>{h}</option>)}
          </select>
        </div>
        {/* Aggregation */}
        <div>
          <Lbl>Aggregation</Lbl>
          <select value={agg} onChange={e => setAgg(e.target.value)}
            style={{ width: "100%", padding: "0.38rem 0.6rem", background: C.surface2, border: `1px solid ${C.border2}`, borderRadius: 3, color: C.text, fontFamily: mono, fontSize: 11 }}>
            {[["mean","Mean"],["sum","Sum"],["median","Median"],["count","Count"]].map(([v,l]) =>
              <option key={v} value={v}>{l}</option>)}
          </select>
        </div>
        {/* Group by */}
        <div>
          <Lbl>Group by (optional)</Lbl>
          <select value={grpCol} onChange={e => setGrpCol(e.target.value)}
            style={{ width: "100%", padding: "0.38rem 0.6rem", background: C.surface2, border: `1px solid ${C.border2}`, borderRadius: 3, color: C.text, fontFamily: mono, fontSize: 11 }}>
            <option value="">— none —</option>
            {headers.map(h => <option key={h} value={h}>{h}</option>)}
          </select>
        </div>
      </div>

      {/* ACF / PACF panel */}
      {tsView === "acf" && (
        <div style={{ border: `1px solid ${C.border}`, borderRadius: 4, overflow: "hidden" }}>
          <div style={{ padding: "0.4rem 0.9rem", background: "#0a0a0a", borderBottom: `1px solid ${C.border}`, fontSize: 9, color: C.textMuted, letterSpacing: "0.18em", textTransform: "uppercase", fontFamily: mono }}>
            ACF &amp; PACF · {yCol} · n = {flatY.length} time points · max lag = {maxLag}
          </div>
          {acfVals.length > 1 ? (
            <div style={{ background: C.bg, padding: "0.5rem", display: "flex", justifyContent: "center" }}>
              <SvgACF acf={acfVals} pacf={pacfVals} n={flatY.length} />
            </div>
          ) : (
            <div style={{ padding: "2rem", textAlign: "center", color: C.textMuted, fontSize: 11, fontFamily: mono }}>
              Need at least 5 time points for ACF.
            </div>
          )}
        </div>
      )}

      {/* ADF panel */}
      {tsView === "adf" && (
        <div style={{ border: `1px solid ${C.border}`, borderRadius: 4, overflow: "hidden" }}>
          <div style={{ padding: "0.4rem 0.9rem", background: "#0a0a0a", borderBottom: `1px solid ${C.border}`, fontSize: 9, color: C.textMuted, letterSpacing: "0.18em", textTransform: "uppercase", fontFamily: mono }}>
            Augmented Dickey-Fuller · {yCol} · n = {flatY.length} time points
          </div>
          {adfRes.length > 0 ? (
            <AdfPanel results={adfRes} />
          ) : (
            <div style={{ padding: "2rem", textAlign: "center", color: C.textMuted, fontSize: 11, fontFamily: mono }}>
              Need at least 9 time points for ADF test.
            </div>
          )}
        </div>
      )}

      {/* Line Chart */}
      {tsView === "line" && series.length > 0 && chart ? (
        <div style={{ border: `1px solid ${C.border}`, borderRadius: 4, overflow: "hidden" }}>
          {/* header */}
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "0.4rem 0.9rem", background: "#0a0a0a", borderBottom: `1px solid ${C.border}` }}>
            <span style={{ fontSize: 9, color: C.textMuted, letterSpacing: "0.18em", textTransform: "uppercase", fontFamily: mono }}>
              {agg.charAt(0).toUpperCase()+agg.slice(1)} of {yCol} by {tCol}
              {grpCol ? ` · grouped by ${grpCol}` : ""}
            </span>
            <button onClick={handleExport}
              style={{ padding: "0.2rem 0.6rem", background: "transparent", border: `1px solid ${C.border2}`, borderRadius: 3, color: C.textMuted, cursor: "pointer", fontFamily: mono, fontSize: 9, transition: "all 0.12s" }}
              onMouseEnter={e => { e.currentTarget.style.borderColor = C.teal; e.currentTarget.style.color = C.teal; }}
              onMouseLeave={e => { e.currentTarget.style.borderColor = C.border2; e.currentTarget.style.color = C.textMuted; }}
            >↓ SVG</button>
          </div>
          <div style={{ background: C.bg, padding: "0.5rem", display: "flex", justifyContent: "center" }}>
            <svg id={svgId} viewBox={`0 0 ${W} ${H}`}
              style={{ width: "100%", maxWidth: 700, height: "auto", maxHeight: "45vh", display: "block", fontFamily: mono }}>
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
                  <text x={chart.sx(t)} y={PAD.t+iH+14} textAnchor="middle" fill={C.textMuted} fontSize={8} fontFamily={mono}>
                    {Number.isInteger(t) ? t : t.toFixed(1)}
                  </text>
                </g>
              ))}
              {chart.yTicks.map((t, i) => (
                <g key={i}>
                  <line x1={PAD.l-4} x2={PAD.l} y1={chart.sy(t)} y2={chart.sy(t)} stroke={C.border2} strokeWidth={1} />
                  <text x={PAD.l-8} y={chart.sy(t)+3} textAnchor="end" fill={C.textMuted} fontSize={8} fontFamily={mono}>
                    {Math.abs(t) >= 1000 ? t.toExponential(1) : t.toFixed(2)}
                  </text>
                </g>
              ))}
              <line x1={PAD.l} x2={PAD.l+iW} y1={PAD.t+iH} y2={PAD.t+iH} stroke={C.border2} strokeWidth={1} />
              <line x1={PAD.l} x2={PAD.l} y1={PAD.t} y2={PAD.t+iH} stroke={C.border2} strokeWidth={1} />

              {/* axis labels */}
              <text x={PAD.l+iW/2} y={H-4} textAnchor="middle" fill={C.textDim} fontSize={9} fontFamily={mono}>
                {tCol}
              </text>
              <text transform={`translate(12,${PAD.t+iH/2}) rotate(-90)`} textAnchor="middle" fill={C.textDim} fontSize={9} fontFamily={mono}>
                {agg}({yCol})
              </text>

              {/* legend — only when grouped */}
              {grpCol && series.length <= 8 && (
                <g transform={`translate(${PAD.l + 10}, ${PAD.t + 6})`}>
                  {series.map((s, si) => (
                    <g key={s.grp} transform={`translate(0, ${si * 14})`}>
                      <line x1={0} x2={14} y1={5} y2={5} stroke={COLORS[si % COLORS.length]} strokeWidth={2} />
                      <text x={18} y={9} fill={C.textDim} fontSize={8} fontFamily={mono}>
                        {String(s.grp).length > 16 ? String(s.grp).slice(0,15)+"…" : String(s.grp)}
                      </text>
                    </g>
                  ))}
                </g>
              )}
            </svg>
          </div>

          {/* footer stats */}
          <div style={{ padding: "0.35rem 0.9rem", background: "#0a0a0a", borderTop: `1px solid ${C.border}`, fontSize: 9, color: C.textMuted, fontFamily: mono, display: "flex", gap: 16 }}>
            <span>{series.length} serie{series.length !== 1 ? "s" : ""}</span>
            <span>{series[0]?.pts.length} time points</span>
            <span>n = {rows.length} observations</span>
          </div>
        </div>
      ) : (
        <div style={{ padding: "2rem", textAlign: "center", color: C.textMuted, fontSize: 11, fontFamily: mono }}>
          {!tCol || !yCol ? "Select a time column and a variable." : "No valid data for selected columns."}
        </div>
      )}
    </div>
  );
}
function AIInsights({rows,headers,info,panel}){
  const{C}=useTheme();
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
    fetch("https://api.anthropic.com/v1/messages",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({model:"claude-sonnet-4-20250514",max_tokens:400,messages:[{role:"user",content:prompt}]})})
      .then(r=>r.json()).then(d=>{const t=d.content?.find(b=>b.type==="text")?.text||"";setText(t);setDone(true);}).catch(()=>setText("AI analysis unavailable.")).finally(()=>setLoading(false));
  }

  // Run once on mount
  useState(()=>{runInsights();},[]);

  return(
    <div style={{padding:"1rem",background:C.surface,border:`1px solid ${C.border}`,borderLeft:`3px solid ${C.purple}`,borderRadius:4,marginBottom:"1.4rem"}}>
      <div style={{display:"flex",alignItems:"center",gap:8,marginBottom:8}}>
        <span style={{fontSize:10,color:C.purple,letterSpacing:"0.18em",textTransform:"uppercase",fontFamily:mono}}>✦ AI Insights</span>
        {loading&&<Spin/>}
        {done&&<button onClick={()=>{setDone(false);setText("");ran.current=false;setTimeout(runInsights,50);}} style={{marginLeft:"auto",fontSize:9,background:"transparent",border:`1px solid ${C.border2}`,borderRadius:2,color:C.textMuted,cursor:"pointer",fontFamily:mono,padding:"2px 6px"}}>↻ refresh</button>}
      </div>
      {loading&&!text&&<div style={{fontSize:11,color:C.textMuted,fontFamily:mono}}>Analyzing dataset…</div>}
      {text&&<div style={{fontSize:12,color:C.text,lineHeight:1.75,fontFamily:mono}}>{text}</div>}
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
      `# Econ Studio — Explore Script (R)`,
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
      `* Econ Studio — Explore Script (Stata)`,
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
      `# Econ Studio — Explore Script (Python)`,
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
function GroupSummarizeExplorer({ rows, headers, info }) {
  const { C } = useTheme();
  const [byCols,    setByCols]    = useState([]);
  const [factorOverrides, setFactorOverrides] = useState(new Set()); // numeric cols forced as categorical
  const [aggs,      setAggs]      = useState([]);
  const [sumResult, setSumResult] = useState(null);
  const [latexOpen, setLatexOpen] = useState(false);
  const [copied,    setCopied]    = useState(false);
  const [hoveredCol, setHoveredCol] = useState(null);

  const numC = headers.filter(h => info[h]?.isNum);
  const FN_OPTS = [
    ["mean","Mean (μ)"],["median","Median"],["sum","Sum (Σ)"],
    ["count","Count (n)"],["min","Min"],["max","Max"],["sd","Std dev (σ)"],
  ];
  const inS = { padding:"0.38rem 0.6rem", background:C.surface2,
    border:`1px solid ${C.border2}`, borderRadius:3, color:C.text,
    fontFamily:mono, fontSize:11, outline:"none" };

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
        fontSize:11,color:C.textDim,lineHeight:1.6}}>
        Group by any column (including numeric — use{" "}
        <span style={{color:C.gold,fontFamily:mono}}>as.factor()</span> to treat a number as a category)
        and compute summary statistics. Results are read-only — use the LaTeX button to export.
      </div>

      {/* ── Group by ── */}
      <div style={{fontSize:10,color:C.textMuted,letterSpacing:"0.2em",textTransform:"uppercase",
        marginBottom:6,fontFamily:mono}}>Group by</div>
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
                  fontSize:10, fontFamily:mono, opacity: groupable ? 1 : 0.5,
                  transition:"all 0.1s",
                }}>
                {sel ? "✓ " : ""}{h}
                {isNum && !isFact && <span style={{fontSize:8,marginLeft:3,color:C.textMuted}}>num</span>}
                {isFact && <span style={{fontSize:8,marginLeft:3,color:C.gold}}>factor</span>}
                {!isNum && <span style={{fontSize:8,color:C.textMuted,marginLeft:3}}>({info[h]?.uCount})</span>}
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
                    fontSize:8, fontFamily:mono, transition:"all 0.1s",
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
                  fontSize:10,fontFamily:mono,color:C.textDim,pointerEvents:"none"}}>
                  <div style={{fontSize:9,color:C.gold,letterSpacing:"0.12em",
                    textTransform:"uppercase",marginBottom:4}}>
                    {info[h]?.uCount} unique values
                  </div>
                  <div style={{display:"flex",flexWrap:"wrap",gap:3}}>
                    {uVals.slice(0,12).map(v=>(
                      <span key={v} style={{padding:"1px 5px",border:`1px solid ${C.border2}`,
                        borderRadius:2,color:C.text,background:C.surface3,fontSize:10}}>{v}</span>
                    ))}
                    {uVals.length>12 && <span style={{color:C.textMuted,fontSize:9}}>+{uVals.length-12} more</span>}
                  </div>
                </div>
              )}
            </div>
          );
        })}
      </div>
      <div style={{fontSize:9,color:C.textMuted,fontFamily:mono,marginBottom:"1.2rem"}}>
        Hover a column to preview its unique values · click <span style={{color:C.gold}}>f</span> next to a numeric column to use as.factor()
      </div>

      {/* ── Aggregations ── */}
      <div style={{display:"flex",alignItems:"center",gap:8,marginBottom:"0.6rem"}}>
        <div style={{fontSize:10,color:C.textMuted,letterSpacing:"0.2em",textTransform:"uppercase",fontFamily:mono}}>Aggregations</div>
        <button onClick={()=>addAgg()} style={{
          padding:"0.2rem 0.55rem",border:`1px solid ${C.blue}`,
          background:`${C.blue}10`,color:C.blue,borderRadius:2,
          cursor:"pointer",fontSize:9,fontFamily:mono}}>+ add row</button>
      </div>
      {numC.length > 0 && (
        <div style={{display:"flex",flexWrap:"wrap",gap:3,marginBottom:"0.8rem"}}>
          <span style={{fontSize:9,color:C.textMuted,fontFamily:mono,alignSelf:"center",marginRight:2}}>quick add:</span>
          {numC.map(h => (
            <button key={h} onClick={()=>addAgg(h,"mean")}
              style={{padding:"0.18rem 0.5rem",border:`1px solid ${C.border2}`,
                background:"transparent",color:C.textDim,borderRadius:2,
                cursor:"pointer",fontSize:9,fontFamily:mono,transition:"all 0.1s"}}
              onMouseEnter={e=>{e.currentTarget.style.borderColor=C.blue;e.currentTarget.style.color=C.blue;}}
              onMouseLeave={e=>{e.currentTarget.style.borderColor=C.border2;e.currentTarget.style.color=C.textDim;}}
              title={`Add mean(${h})`}>+ {h}</button>
          ))}
        </div>
      )}
      {aggs.length === 0 && (
        <div style={{padding:"0.65rem 1rem",background:C.surface,border:`1px dashed ${C.border2}`,
          borderRadius:4,fontSize:11,color:C.textMuted,fontFamily:mono,marginBottom:"1.2rem"}}>
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
              fontSize:11,padding:"0.2rem 0.4rem"}}>✕</button>
          </div>
        ))}
      </div>

      <button onClick={doSummarize} disabled={!canSummarize} style={{
        padding:"0.42rem 0.9rem",borderRadius:3,cursor:canSummarize?"pointer":"not-allowed",
        fontFamily:mono,fontSize:11,fontWeight:700,
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
            <span style={{fontSize:10,color:C.gold,fontFamily:mono,flex:1}}>
              {sumResult.rows.length} groups · grouped by [{sumResult.by.join(", ")}]
            </span>
            {/* LaTeX toggle */}
            <button onClick={()=>{setLatexOpen(o=>!o);setCopied(false);}} style={{
              padding:"0.22rem 0.6rem",background:latexOpen?`${C.gold}18`:"transparent",
              border:`1px solid ${latexOpen?C.gold:C.border2}`,borderRadius:2,
              color:latexOpen?C.gold:C.textDim,cursor:"pointer",fontSize:9,fontFamily:mono}}>
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
              color:C.textDim,cursor:"pointer",fontSize:9,fontFamily:mono}}
              onMouseEnter={e=>{e.currentTarget.style.borderColor=C.teal;e.currentTarget.style.color=C.teal;}}
              onMouseLeave={e=>{e.currentTarget.style.borderColor=C.border2;e.currentTarget.style.color=C.textDim;}}>
              ↓ CSV
            </button>
          </div>
          {/* LaTeX panel */}
          {latexOpen && (()=>{
            const tex = buildLatex(sumResult);
            return (
              <div style={{padding:"0.75rem 0.9rem",background:"#0a0c0a",borderBottom:`1px solid ${C.border}`}}>
                <div style={{display:"flex",alignItems:"center",gap:8,marginBottom:6}}>
                  <span style={{fontSize:9,color:C.gold,letterSpacing:"0.15em",
                    textTransform:"uppercase",fontFamily:mono,flex:1}}>LaTeX — tabular</span>
                  <button onClick={()=>{navigator.clipboard.writeText(tex).then(()=>{setCopied(true);setTimeout(()=>setCopied(false),1800);});}} style={{
                    padding:"0.22rem 0.75rem",
                    background:copied?`${C.teal}18`:`${C.gold}10`,
                    border:`1px solid ${copied?C.teal:C.gold}`,
                    borderRadius:3,color:copied?C.teal:C.gold,
                    cursor:"pointer",fontSize:10,fontFamily:mono,fontWeight:600}}>
                    {copied ? "✓ Copied" : "⎘ Copy"}
                  </button>
                </div>
                <pre style={{margin:0,fontSize:10,color:C.textDim,fontFamily:mono,
                  overflowX:"auto",lineHeight:1.6,whiteSpace:"pre"}}>{tex}</pre>
              </div>
            );
          })()}
          {/* Data table */}
          <div style={{overflowX:"auto",maxHeight:400,overflowY:"auto"}}>
            <table style={{borderCollapse:"collapse",fontSize:11,width:"100%",fontFamily:mono}}>
              <thead>
                <tr style={{background:C.surface2,position:"sticky",top:0}}>
                  {sumResult.headers.map(h => {
                    const isBy = sumResult.by.includes(h);
                    const aggDef = sumResult.aggs.find(a=>a.nn===h);
                    return (
                      <th key={h} style={{padding:"0.4rem 0.75rem",
                        textAlign:isBy?"left":"right",fontWeight:400,fontSize:10,
                        color:isBy?C.gold:C.blue,whiteSpace:"nowrap",
                        borderBottom:`1px solid ${C.border}`}}>
                        {h}<span style={{fontSize:8,color:C.textMuted,marginLeft:4}}>{isBy?"group":aggDef?.fn}</span>
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
  const {C} = useTheme();
  const [open, setOpen] = useState(false);
  const active = conds.length > 0;
  const isFiltered = filteredCount !== totalRows;
  const selStyle = {fontFamily:mono,fontSize:10,background:C.surface2,border:`1px solid ${C.border}`,color:C.text,borderRadius:3,padding:"0.2rem 0.3rem"};
  const upd = (i, patch) => setConds(cs => cs.map((c,j) => j===i ? {...c,...patch} : c));

  return (
    <div style={{marginBottom:"0.8rem"}}>
      <div style={{display:"flex",alignItems:"center",gap:8}}>
        <button onClick={()=>setOpen(s=>!s)} style={{padding:"0.22rem 0.7rem",borderRadius:3,cursor:"pointer",fontFamily:mono,fontSize:10,background:active?`${C.teal}18`:"transparent",border:`1px solid ${active?C.teal:C.border2}`,color:active?C.teal:C.textDim,transition:"all 0.12s"}}>
          ⊘ Filter{active?` (${conds.length})`:""}
        </button>
        {isFiltered&&<span style={{fontSize:10,color:C.teal,fontFamily:mono}}>{filteredCount.toLocaleString()} / {totalRows.toLocaleString()} rows</span>}
        {active&&<button onClick={()=>{setConds([]);}} style={{fontSize:10,color:C.textMuted,background:"none",border:"none",cursor:"pointer",fontFamily:mono,padding:0}}>× clear</button>}
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
                style={{background:"none",border:"none",color:C.textDim,cursor:"pointer",fontSize:14,lineHeight:1,padding:"0 2px"}}>×</button>
            </div>
          ))}
          <button onClick={()=>setConds(cs=>[...cs,{col:headers[0]??"",op:">",val:""}])}
            style={{fontSize:10,color:C.teal,background:"none",border:`1px solid ${C.teal}40`,borderRadius:3,cursor:"pointer",fontFamily:mono,padding:"0.2rem 0.5rem",marginTop:2}}>
            + condition
          </button>
        </div>
      )}
    </div>
  );
}

// ─── EVIDENCE EXPLORER ROOT ───────────────────────────────────────────────────
export default function ExplorerModule({cleanedData, onBack, onProceed}) {
  const{C}=useTheme();
  const {headers, cleanRows:rows, panelIndex:panel, filename} = cleanedData;
  const info = useMemo(()=>buildInfo(headers,rows), [headers,rows]);
  const [tab,setTab] = useState("summary");
  const [filterConds, setFilterConds] = useState([]);
  const filteredRows = useMemo(()=>{
    if(!filterConds.length) return rows;
    return rows.filter(row=>filterConds.every(cond=>matchCond(row,cond)));
  },[rows,filterConds]);
  const corrRef = useRef(null);

  function downloadExploreScript(language) {
    const ext    = { r: "R", stata: "do", python: "py" }[language];
    const base   = (filename || "dataset").replace(/\.[^.]+$/, "");
    const script = generateExploreScript(language, { headers, info, filename });
    const blob   = new Blob([script], { type: "text/plain" });
    const a      = document.createElement("a");
    a.href       = URL.createObjectURL(blob);
    a.download   = `${base}_explore.${ext}`;
    a.click(); URL.revokeObjectURL(a.href);
  }

  return(
    <div style={{display:"flex",height:"100%",minHeight:0,background:C.bg,color:C.text,fontFamily:mono,overflow:"hidden"}}>
      <div style={{flex:1,minWidth:0,overflowY:"auto",padding:"1.4rem",paddingBottom:"3rem"}}>
        {/* Header */}
        <div style={{marginBottom:"1.2rem",display:"flex",alignItems:"flex-start",gap:12}}>
          <div style={{flex:1}}>
            <div style={{fontSize:9,color:C.violet,letterSpacing:"0.26em",textTransform:"uppercase",marginBottom:3}}>Evidence Explorer</div>
            <div style={{fontSize:18,color:C.text,letterSpacing:"-0.02em",marginBottom:3}}>Exploratory Analysis</div>
            <div style={{fontSize:11,color:C.textDim,fontFamily:mono}}>
              <span style={{color:C.gold}}>{filteredRows.length !== rows.length ? `${filteredRows.length.toLocaleString()} of ${rows.length.toLocaleString()}` : rows.length}</span> obs ·{" "}
              <span style={{color:C.teal}}>{headers.filter(h=>info[h]?.isNum).length}</span> numeric ·{" "}
              <span style={{color:C.purple}}>{headers.filter(h=>info[h]?.isCat).length}</span> categorical
              {panel&&<span style={{color:C.blue}}> · panel i={panel.entityCol} t={panel.timeCol}</span>}
            </div>
          </div>
          <div style={{display:"flex",gap:6,alignItems:"center",flexShrink:0}}>
            {["R","Stata","py"].map((lbl, i) => {
              const lang = ["r","stata","python"][i];
              return (
                <button key={lang} onClick={() => downloadExploreScript(lang)} style={{
                  padding:"0.28rem 0.55rem", borderRadius:3, cursor:"pointer",
                  fontFamily:mono, fontSize:10, background:"transparent",
                  border:`1px solid ${C.border2}`, color:C.textDim,
                  transition:"all 0.12s",
                }}
                  title={`Export Explore script (${lbl})`}
                  onMouseEnter={e=>{e.currentTarget.style.borderColor=C.teal;e.currentTarget.style.color=C.teal;}}
                  onMouseLeave={e=>{e.currentTarget.style.borderColor=C.border2;e.currentTarget.style.color=C.textDim;}}
                >↓{lbl}</button>
              );
            })}
            <button onClick={onBack} style={{padding:"0.28rem 0.65rem",borderRadius:3,cursor:"pointer",fontFamily:mono,fontSize:10,background:"transparent",border:`1px solid ${C.border2}`,color:C.textDim}}>← Wrangling</button>
            <button onClick={onProceed} style={{padding:"0.28rem 0.65rem",borderRadius:3,cursor:"pointer",fontFamily:mono,fontSize:10,background:C.gold,color:C.bg,border:`1px solid ${C.gold}`,fontWeight:700}}>→ Modeling</button>
          </div>
        </div>
        {/* AI Insights */}
        <AIInsights rows={filteredRows} headers={headers} info={info} panel={panel}/>
        <HintBox tips={[
          "⊘ Filter slices data temporarily — applies to all tabs but never touches the pipeline",
          "Group By in Summary Table shows statistics split by any categorical variable",
          "Distributions tab: histogram + 5-number summary for any numeric variable",
          "Correlation tab: Pearson heatmap across all numeric variables",
          "Plot Builder: compose layered visualizations (point, line, bar, histogram, smooth…)",
        ]} />
        {/* Quick Filter */}
        <QuickFilter headers={headers} totalRows={rows.length} filteredCount={filteredRows.length} conds={filterConds} setConds={setFilterConds}/>
        {/* Tabs */}
        <div style={{display:"flex",gap:1,background:C.border,borderRadius:4,overflow:"hidden",marginBottom:"1.2rem"}}>
          {[["summary","⊞ Summary Table"],["visuals","⬡ Distributions"],["corr","⬡ Correlation"],["timeseries","⬡ Time Series"],["plot","◈ Plot Builder"],["summarize","⊞ Summarize"]].map(([k,l])=>(
            <button key={k} onClick={()=>setTab(k)} style={{flex:1,padding:"0.6rem 0.7rem",background:tab===k?C.goldFaint:C.surface,border:"none",color:tab===k?C.gold:C.textDim,cursor:"pointer",fontFamily:mono,fontSize:11,borderBottom:tab===k?`2px solid ${C.gold}`:"2px solid transparent",transition:"all 0.12s"}}>{l}</button>
          ))}
        </div>
        {tab==="summary"&&<SummaryTable rows={filteredRows} headers={headers} info={info} panel={panel}/>}
        {tab==="visuals"&&<DistributionTab rows={filteredRows} headers={headers} info={info} panel={panel}/>}
        {tab==="summarize"&&<GroupSummarizeExplorer rows={filteredRows} headers={headers} info={info}/>}
        {tab==="corr"&&(
          <div>
            <div style={{fontSize:11,color:C.textDim,lineHeight:1.7,marginBottom:"1.2rem",padding:"0.65rem 1rem",background:C.surface,border:`1px solid ${C.border}`,borderLeft:`3px solid ${C.teal}`,borderRadius:4}}>
              Pearson correlation between all numeric variables. Red = negative, Teal = positive.
            </div>
            <div ref={corrRef} style={{border:`1px solid ${C.border}`,borderRadius:4,overflow:"hidden"}}>
              <div style={{padding:"0.5rem"}}>
                <CorrHeatmap headers={headers} rows={filteredRows} info={info}/>
              </div>
              <PlotExportBar getEl={() => corrRef.current} filename="correlation_heatmap" />
            </div>
          </div>
        )}
        {tab==="timeseries"&&<TimeSeriesTab rows={filteredRows} headers={headers} info={info} panel={panel}/>}
        {tab==="plot"&&<PlotBuilder headers={headers} rows={filteredRows} style={{marginTop:"0.25rem"}}/>}
      </div>
    </div>
  );
}
