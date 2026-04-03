// ─── ECON STUDIO · components/wrangling/ReshapeTab.jsx ─────────────────────
import { useState, useMemo } from "react";
import { C, mono, Lbl, Tabs, Btn } from "./shared.jsx";

// ─── RESHAPE TAB ──────────────────────────────────────────────────────────────
// pivot_longer (wide→long) + group_summarize (collapse rows).
// Both are structurally destructive — they change the shape of the dataset,
// not just add columns. Kept separate from Feature Engineering deliberately.
function ReshapeTab({ rows, headers, info, onAdd, onRmLastStep }) {
  const [sub, setSub] = useState("pivot");

  // ── pivot_longer state ────────────────────────────────────────────────────
  const [pivCols,  setPivCols]  = useState([]);   // columns to pivot
  const [namesTo,  setNamesTo]  = useState("variable");
  const [valuesTo, setValuesTo] = useState("value");
  // idCols = all non-pivot cols (auto)

  // ── group_summarize state ─────────────────────────────────────────────────
  const [byCols,    setByCols]    = useState([]);
  const [aggs,      setAggs]      = useState([]);      // [{col, fn, nn}]
  const [sumResult, setSumResult] = useState(null);    // {rows, headers, by, aggs} after collapse
  const [latexOpen, setLatexOpen] = useState(false);   // show/hide LaTeX panel
  const [copied,    setCopied]    = useState(false);   // copy feedback
  const [hoveredCol, setHoveredCol] = useState(null);  // tooltip on group-by chips

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
  function addAgg(col = "", fn = "mean") {
    const nn = col ? `${fn}_${col}` : "";
    setAggs(a => [...a, { col, fn, nn }]);
  }
  function updAgg(i, patch) {
    setAggs(a => a.map((x, j) => {
      if (j !== i) return x;
      const updated = { ...x, ...patch };
      // Auto-suggest nn only when it's empty or still matches the old auto-suggestion
      const oldAuto = `${x.fn}_${x.col}`;
      const shouldAutoUpdate = !x.nn || x.nn === oldAuto;
      if (shouldAutoUpdate && (patch.col !== undefined || patch.fn !== undefined)) {
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
    const step = {
      type: "group_summarize",
      by: byCols,
      aggs: validAggs.map(a => ({ ...a, nn: a.nn.trim() })),
      desc: `group_by [${byCols.join(", ")}] → summarize (${validAggs.map(a => `${a.fn}(${a.col})`).join(", ")})`,
    };
    onAdd(step);

    // Compute result locally for inline display — same logic as runner.js
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
        if (fn === "count")  { out[nn] = _rows.length; return; }
        if (!vals.length)    { out[nn] = null; return; }
        if (fn === "sum")    { out[nn] = vals.reduce((a,b)=>a+b,0); return; }
        if (fn === "min")    { out[nn] = Math.min(...vals); return; }
        if (fn === "max")    { out[nn] = Math.max(...vals); return; }
        const mean = vals.reduce((a,b)=>a+b,0)/vals.length;
        if (fn === "mean")   { out[nn] = mean; return; }
        if (fn === "sd")     { out[nn] = vals.length>1 ? Math.sqrt(vals.reduce((s,v)=>s+(v-mean)**2,0)/(vals.length-1)) : 0; return; }
        if (fn === "median") { const s=[...vals].sort((a,b)=>a-b),m=Math.floor(s.length/2); out[nn]=s.length%2===0?(s[m-1]+s[m])/2:s[m]; return; }
        out[nn] = null;
      });
      outRows.push(out);
    }
    // Sort by group columns so Argentina×Agriculture, Argentina×Manufacturing... are together
    outRows.sort((a, b) => {
      for (const col of step.by) {
        const av = String(a[col] ?? ""), bv = String(b[col] ?? "");
        if (av < bv) return -1;
        if (av > bv) return  1;
      }
      return 0;
    });
    setSumResult({ rows: outRows, headers: outHeaders, by: step.by, aggs: step.aggs });
    setLatexOpen(false); setCopied(false);
    // Keep byCols/aggs so user can re-run with tweaks — they clear manually
  }

  // "Clear result" also removes the last group_summarize step from the pipeline
  function clearResult(onUndo) {
    setSumResult(null); setLatexOpen(false); setCopied(false);
    if (onUndo) onUndo(); // caller passes rmLastStep
  }

  // Build LaTeX tabular string from sumResult
  function buildLatex(res) {
    const cols = res.headers;
    const numCols = new Set(res.aggs.map(a => a.nn));
    const fmt = v => {
      if (v === null || v === undefined) return "";
      if (typeof v === "number") return v.toFixed(2);
      return String(v);
    };
    const colSpec = cols.map(h => numCols.has(h) ? "r" : "l").join(" ");
    const header  = cols.map(h => h.replace(/_/g,"\_")).join(" & ") + " \\\\";
    const body    = res.rows.map(r =>
      cols.map(h => fmt(r[h])).join(" & ") + " \\\\"
    ).join("\n    ");
    return [
      "\\begin{table}[htbp]",
      "  \\centering",
      `  \\caption{Summary statistics by ${res.by.join(", ")}}`,
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

          {/* Group by — chips with unique-value tooltip on hover */}
          <Lbl color={C.orange}>Group by <span style={{color:C.textMuted}}>(categorical columns)</span></Lbl>
          <div style={{display:"flex",flexWrap:"wrap",gap:4,marginBottom:"0.5rem"}}>
            {headers.map(h => {
              const isCat = !info[h]?.isNum;
              const sel   = byCols.includes(h);
              const uVals = info[h]?.uVals?.map(v => String(v)) || [];
              return (
                <div key={h} style={{position:"relative"}}>
                  <button
                    onClick={() => isCat && setByCols(p => p.includes(h) ? p.filter(x=>x!==h) : [...p,h])}
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
                  {hoveredCol===h && uVals.length>0 && (
                    <div style={{
                      position:"absolute",top:"calc(100% + 4px)",left:0,
                      background:C.surface2,border:`1px solid ${C.border2}`,
                      borderRadius:4,padding:"0.5rem 0.65rem",
                      zIndex:50,minWidth:120,maxWidth:220,
                      boxShadow:"0 6px 20px #000a",
                      fontSize:10,fontFamily:mono,color:C.textDim,
                      pointerEvents:"none",
                    }}>
                      <div style={{fontSize:9,color:C.orange,letterSpacing:"0.12em",
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
            Hover a column to preview its unique values
          </div>

          {/* Aggregations */}
          <div style={{display:"flex",alignItems:"center",gap:8,marginBottom:"0.6rem"}}>
            <Lbl mb={0} color={C.blue}>Aggregations</Lbl>
            <button onClick={()=>addAgg()} style={{
              padding:"0.2rem 0.55rem",border:`1px solid ${C.blue}`,
              background:`${C.blue}10`,color:C.blue,borderRadius:2,
              cursor:"pointer",fontSize:9,fontFamily:mono,
            }}>+ add row</button>
          </div>

          {/* Quick-add chips — click a column to add mean(col) instantly */}
          {numC.length > 0 && (
            <div style={{display:"flex",flexWrap:"wrap",gap:3,marginBottom:"0.8rem"}}>
              <span style={{fontSize:9,color:C.textMuted,fontFamily:mono,
                alignSelf:"center",marginRight:2}}>quick add:</span>
              {numC.map(h => (
                <button key={h} onClick={()=>addAgg(h,"mean")}
                  style={{padding:"0.18rem 0.5rem",border:`1px solid ${C.border2}`,
                    background:"transparent",color:C.textDim,borderRadius:2,
                    cursor:"pointer",fontSize:9,fontFamily:mono,transition:"all 0.1s"}}
                  onMouseEnter={e=>{e.currentTarget.style.borderColor=C.blue;e.currentTarget.style.color=C.blue;}}
                  onMouseLeave={e=>{e.currentTarget.style.borderColor=C.border2;e.currentTarget.style.color=C.textDim;}}
                  title={`Add mean(${h})`}>
                  + {h}
                </button>
              ))}
            </div>
          )}

          {aggs.length === 0 && (
            <div style={{padding:"0.65rem 1rem",background:C.surface,
              border:`1px dashed ${C.border2}`,borderRadius:4,
              fontSize:11,color:C.textMuted,fontFamily:mono,marginBottom:"1.2rem"}}>
              Add aggregations above — each row is one output column.
            </div>
          )}

          <div style={{display:"flex",flexDirection:"column",gap:6,marginBottom:"1.2rem"}}>
            {aggs.map((agg, i) => (
              <div key={i} style={{display:"grid",gridTemplateColumns:"1fr 140px 1fr auto",
                gap:6,alignItems:"center",padding:"0.5rem 0.65rem",
                background:C.surface2,border:`1px solid ${C.border}`,borderRadius:4}}>
                <select value={agg.col} onChange={e=>updAgg(i,{col:e.target.value})}
                  style={{...inS,width:"100%"}}>
                  <option value="">— column —</option>
                  {numC.map(h=><option key={h} value={h}>{h}</option>)}
                </select>
                <select value={agg.fn} onChange={e=>updAgg(i,{fn:e.target.value})}
                  style={{...inS}}>
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

          {/* dplyr preview */}
          {canSummarize && (
            <div style={{padding:"0.55rem 0.85rem",background:`${C.orange}08`,
              border:`1px solid ${C.orange}30`,borderRadius:3,marginBottom:"1rem",
              fontSize:11,fontFamily:mono,color:C.textDim,lineHeight:1.8}}>
              <span style={{color:C.gold}}>→</span>{" "}
              group_by [<span style={{color:C.orange}}>{byCols.join(", ")}</span>]{" "}
              |&gt; summarise(<br/>
              {aggs.filter(a=>a.col&&a.fn&&a.nn.trim()).map((a,i)=>(
                <span key={i}>
                  {"  "}<span style={{color:C.teal}}>{a.nn}</span>{" = "}
                  <span style={{color:C.blue}}>{a.fn}</span>({a.col})
                  {i<aggs.length-1?",":""}<br/>
                </span>
              ))}
              )
            </div>
          )}

          {/* Action row */}
          <div style={{display:"flex",gap:8,alignItems:"center",marginBottom:"1.5rem"}}>
            <Btn onClick={doSummarize} color={C.orange} v="solid"
              dis={!canSummarize} ch="Collapse rows →"/>
            {sumResult && (
              <button onClick={()=>clearResult(onRmLastStep)} style={{
                background:"transparent",border:`1px solid ${C.border2}`,
                borderRadius:3,color:C.red,cursor:"pointer",
                fontSize:10,fontFamily:mono,padding:"0.25rem 0.65rem",
                transition:"all 0.1s",
              }}
                onMouseEnter={e=>{e.currentTarget.style.borderColor=C.red;}}
                onMouseLeave={e=>{e.currentTarget.style.borderColor=C.border2;}}
              >✕ Clear &amp; undo</button>
            )}
          </div>

          {/* ── Inline result panel ──────────────────────────────────────── */}
          {sumResult && (
            <div style={{border:`1px solid ${C.orange}40`,borderRadius:4,overflow:"hidden"}}>

              {/* Result header */}
              <div style={{padding:"0.55rem 0.9rem",background:`${C.orange}0a`,
                borderBottom:`1px solid ${C.orange}30`,
                display:"flex",alignItems:"center",gap:8}}>
                <span style={{fontSize:10,color:C.orange,letterSpacing:"0.15em",
                  textTransform:"uppercase",fontFamily:mono,flex:1}}>
                  ⊞ Result — {sumResult.rows.length} group{sumResult.rows.length!==1?"s":""}
                  <span style={{color:C.textMuted,marginLeft:8,fontSize:9}}>
                    × {sumResult.headers.length} cols
                  </span>
                </span>

                {/* LaTeX toggle */}
                <button onClick={()=>{setLatexOpen(o=>!o);setCopied(false);}} style={{
                  padding:"0.22rem 0.6rem",background:latexOpen?`${C.gold}18`:"transparent",
                  border:`1px solid ${latexOpen?C.gold:C.border2}`,borderRadius:2,
                  color:latexOpen?C.gold:C.textDim,cursor:"pointer",fontSize:9,fontFamily:mono,
                  transition:"all 0.1s",
                }}>{ } LaTeX {latexOpen?"▾":"▸"}</button>

                {/* CSV download */}
                <button onClick={()=>{
                  const esc=v=>{if(v===null||v===undefined)return"";const s=String(v);return s.includes(",")||s.includes('"')||s.includes("\n")?`"${s.replace(/"/g,'""')}"`  :s;};
                  const lines=[sumResult.headers.map(esc).join(","),...sumResult.rows.map(r=>sumResult.headers.map(h=>esc(r[h])).join(","))];
                  const blob=new Blob([lines.join("\r\n")],{type:"text/csv"});
                  const a=document.createElement("a");a.href=URL.createObjectURL(blob);
                  a.download=`summary_${sumResult.by.join("_")}.csv`;a.click();URL.revokeObjectURL(a.href);
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

              {/* LaTeX panel — collapsible */}
              {latexOpen && (()=>{
                const tex = buildLatex(sumResult);
                return(
                  <div style={{padding:"0.75rem 0.9rem",background:"#0a0c08",
                    borderBottom:`1px solid ${C.border}`}}>
                    <div style={{display:"flex",alignItems:"center",gap:8,marginBottom:6}}>
                      <span style={{fontSize:9,color:C.gold,letterSpacing:"0.15em",
                        textTransform:"uppercase",fontFamily:mono,flex:1}}>
                        LaTeX — tabular
                      </span>
                      <button onClick={()=>{
                        navigator.clipboard.writeText(tex).then(()=>{
                          setCopied(true);
                          setTimeout(()=>setCopied(false),1800);
                        });
                      }} style={{
                        padding:"0.22rem 0.75rem",
                        background:copied?`${C.green}18`:`${C.gold}10`,
                        border:`1px solid ${copied?C.green:C.gold}`,
                        borderRadius:3,color:copied?C.green:C.gold,
                        cursor:"pointer",fontSize:10,fontFamily:mono,
                        transition:"all 0.15s",fontWeight:600,
                      }}>
                        {copied ? "✓ Copied" : "⎘ Copy"}
                      </button>
                    </div>
                    <pre style={{
                      margin:0,padding:0,
                      fontSize:10,color:"#8ab88a",fontFamily:mono,
                      lineHeight:1.6,overflowX:"auto",
                      whiteSpace:"pre",
                    }}>{tex}</pre>
                  </div>
                );
              })()}

              {/* Result table */}
              <div style={{overflowX:"auto",maxHeight:340,overflowY:"auto"}}>
                <table style={{borderCollapse:"collapse",fontSize:11,
                  width:"100%",fontFamily:mono}}>
                  <thead>
                    <tr style={{background:C.surface2,position:"sticky",top:0}}>
                      {sumResult.headers.map(h=>{
                        const isBy  = sumResult.by.includes(h);
                        const aggDef = sumResult.aggs.find(a=>a.nn===h);
                        return(
                          <th key={h} style={{
                            padding:"0.4rem 0.75rem",
                            textAlign: isBy ? "left" : "right",
                            fontWeight:400,fontSize:10,
                            color: isBy ? C.orange : C.blue,
                            whiteSpace:"nowrap",
                            borderBottom:`1px solid ${C.border}`,
                          }}>
                            {h}
                            <span style={{fontSize:8,color:C.textMuted,marginLeft:4}}>
                              {isBy ? "group" : aggDef?.fn}
                            </span>
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
                          return(
                            <td key={h} style={{
                              padding:"0.32rem 0.75rem",
                              color:isNull?C.textMuted:isNum?C.blue:C.text,
                              borderBottom:`1px solid ${C.border}`,
                              whiteSpace:"nowrap",
                              textAlign:isBy?"left":"right",
                            }}>
                              {isNull?"·":isNum?v.toFixed(2):String(v)}
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


export default ReshapeTab;
