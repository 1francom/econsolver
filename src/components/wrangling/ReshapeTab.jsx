// ─── ECON STUDIO · components/wrangling/ReshapeTab.jsx ─────────────────────
import { useState, useMemo } from "react";
import { useTheme, mono, Lbl, Tabs, Btn } from "./shared.jsx";

// ─── RESHAPE TAB ──────────────────────────────────────────────────────────────
// pivot_longer (wide→long) + sort rows.
// Group & Summarize lives in ExplorerModule for non-destructive descriptive stats.
function ReshapeTab({ rows, headers, info, onAdd }) {
  const { C } = useTheme();
  const [sub, setSub] = useState("pivot");

  // ── pivot_longer state ────────────────────────────────────────────────────
  const [pivMode,   setPivMode]  = useState("multi");  // "simple" | "multi"
  // Simple mode
  const [pivCols,   setPivCols]  = useState([]);
  const [namesTo,   setNamesTo]  = useState("year");
  const [valuesTo,  setValuesTo] = useState("value");
  const [namesSep,  setNamesSep] = useState("_");      // extract key from col name
  // Multi mode
  const [pivGroups, setPivGroups] = useState([]);      // [{prefix, colName}]
  const [keyName,   setKeyName]   = useState("year");

  // ── arrange state ─────────────────────────────────────────────────────────
  const [arrCols,   setArrCols]   = useState([]);     // [{col, dir}] sort keys

  // ── pivot helpers ─────────────────────────────────────────────────────────
  // Simple mode
  const allPivotColsSimple = pivCols;
  const idColsSimple = headers.filter(h => !pivCols.includes(h));

  // Multi mode: detect all columns matching any group prefix
  const allPivotColsMulti = useMemo(() => {
    const s = new Set();
    pivGroups.forEach(({ prefix }) => {
      headers.filter(h => h.startsWith(prefix) && prefix.length > 0).forEach(h => s.add(h));
    });
    return [...s];
  }, [pivGroups, headers]);

  const idColsMulti = headers.filter(h => !allPivotColsMulti.includes(h));

  // Detect unique key values for multi mode preview
  const multiKeyValues = useMemo(() => {
    const kvs = new Set();
    pivGroups.forEach(({ prefix }) => {
      headers.filter(h => h.startsWith(prefix) && prefix.length > 0)
        .forEach(h => kvs.add(h.slice(prefix.length)));
    });
    return [...kvs].sort();
  }, [pivGroups, headers]);

  // Auto-detect column groups from headers (e.g. income_2018..2022 → prefix "income_")
  const detectedGroups = useMemo(() => {
    // Find columns matching pattern: prefix_suffix where suffix is digits
    const patMap = {};
    headers.forEach(h => {
      const m = h.match(/^(.+?)_(\d+)$/);
      if (m) {
        const prefix = m[1] + "_";
        if (!patMap[prefix]) patMap[prefix] = [];
        patMap[prefix].push(h);
      }
    });
    // Only suggest prefixes with 2+ columns
    return Object.entries(patMap)
      .filter(([, cols]) => cols.length >= 2)
      .map(([prefix]) => ({ prefix, colName: prefix.replace(/_$/, "") }));
  }, [headers]);

  function togglePivCol(h) {
    setPivCols(p => p.includes(h) ? p.filter(x => x !== h) : [...p, h]);
  }

  function addGroup(prefix = "", colName = "") {
    setPivGroups(p => [...p, { prefix, colName }]);
  }
  function updateGroup(i, patch) {
    setPivGroups(p => p.map((g, j) => j !== i ? g : { ...g, ...patch }));
  }
  function removeGroup(i) {
    setPivGroups(p => p.filter((_, j) => j !== i));
  }

  function doPivot() {
    if (pivMode === "multi") {
      const validGroups = pivGroups.filter(g => g.prefix.trim() && g.colName.trim());
      if (!validGroups.length || !keyName.trim()) return;
      const idCols = idColsMulti;
      onAdd({
        type: "pivot_longer", mode: "multi",
        groups: validGroups, keyName: keyName.trim(), idCols,
        desc: `Pivot longer (multi): [${validGroups.map(g => g.colName).join(", ")}] by ${keyName}`,
      });
      setPivGroups([]); setKeyName("year");
    } else {
      if (!pivCols.length || !namesTo.trim() || !valuesTo.trim()) return;
      const idCols = idColsSimple;
      const sep = namesSep.trim() || null;
      onAdd({
        type: "pivot_longer", mode: "simple",
        cols: pivCols, namesTo: namesTo.trim(), valuesTo: valuesTo.trim(),
        namesSep: sep, idCols,
        desc: `Pivot longer: [${pivCols.slice(0,3).join(", ")}${pivCols.length > 3 ? "…" : ""}] → ${namesTo}/${valuesTo}`,
      });
      setPivCols([]); setNamesTo("year"); setValuesTo("value");
    }
  }

  const canPivot = pivMode === "multi"
    ? pivGroups.some(g => g.prefix.trim() && g.colName.trim()) && keyName.trim()
    : pivCols.length > 0 && namesTo.trim() && valuesTo.trim();

  const inS = { padding:"0.38rem 0.6rem", background:C.surface2,
    border:`1px solid ${C.border2}`, borderRadius:3, color:C.text,
    fontFamily:mono, fontSize:11, outline:"none" };

  return (
    <div>
      <Tabs tabs={[["pivot","⟲ Pivot longer"],["arrange","↕ Sort rows"]]}
        active={sub} set={setSub} accent={C.teal} sm/>

      {/* ══════════════ PIVOT LONGER ══════════════════════════════════════ */}
      {sub === "pivot" && (
        <div>
          <div style={{padding:"0.65rem 1rem",background:C.surface,
            border:`1px solid ${C.border}`,borderLeft:`3px solid ${C.teal}`,
            borderRadius:4,marginBottom:"1.2rem",fontSize:11,color:C.textDim,lineHeight:1.6}}>
            Converts <span style={{color:C.gold}}>wide format</span> to{" "}
            <span style={{color:C.teal}}>long format</span>.
            Equivalent to <code style={{color:C.green}}>tidyr::pivot_longer()</code>.
          </div>

          {/* Mode selector */}
          <div style={{display:"flex",gap:4,marginBottom:"1.2rem"}}>
            {[
              ["multi",  "⊞ Multi-variable", "income_2019 + hours_2019 → income, hours per year"],
              ["simple", "⟲ Simple",         "one group of columns → single key/value pair"],
            ].map(([k, l, hint]) => (
              <button key={k} onClick={() => setPivMode(k)} style={{
                flex:1, padding:"0.5rem 0.75rem", textAlign:"left",
                border:`1px solid ${pivMode===k ? C.teal : C.border2}`,
                background: pivMode===k ? `${C.teal}12` : "transparent",
                color: pivMode===k ? C.teal : C.textDim,
                borderRadius:4, cursor:"pointer", fontFamily:mono, transition:"all 0.1s",
              }}>
                <div style={{fontSize:11, marginBottom:2}}>{pivMode===k ? "✓ " : ""}{l}</div>
                <div style={{fontSize:9, color:C.textMuted}}>{hint}</div>
              </button>
            ))}
          </div>

          {/* ══ MULTI-VARIABLE MODE ══════════════════════════════════════════ */}
          {pivMode === "multi" && (
            <div>
              {/* Auto-detect banner */}
              {detectedGroups.length > 0 && pivGroups.length === 0 && (
                <div style={{padding:"0.6rem 0.9rem",background:`${C.gold}08`,
                  border:`1px solid ${C.gold}30`,borderLeft:`3px solid ${C.gold}`,
                  borderRadius:4,marginBottom:"1rem",fontSize:10,fontFamily:mono,color:C.textDim}}>
                  <span style={{color:C.gold}}>Auto-detected {detectedGroups.length} variable group{detectedGroups.length!==1?"s":""}:</span>{" "}
                  {detectedGroups.map(g => (
                    <span key={g.prefix} style={{color:C.text,marginRight:6}}>{g.prefix}*</span>
                  ))}
                  <button onClick={() => setPivGroups(detectedGroups)}
                    style={{marginLeft:8,padding:"0.15rem 0.55rem",
                      border:`1px solid ${C.gold}`,borderRadius:2,
                      background:"transparent",color:C.gold,cursor:"pointer",
                      fontSize:9,fontFamily:mono}}>
                    Use all →
                  </button>
                </div>
              )}

              {/* Key column name */}
              <div style={{marginBottom:"1rem"}}>
                <Lbl color={C.violet}>Key column name <span style={{color:C.textMuted}}>(extracted from suffix)</span></Lbl>
                <input value={keyName} onChange={e => setKeyName(e.target.value)}
                  placeholder="year"
                  style={{...inS, width:200, boxSizing:"border-box"}}/>
              </div>

              {/* Variable groups */}
              <Lbl color={C.teal}>Variable groups</Lbl>
              {pivGroups.length === 0 && (
                <div style={{padding:"0.6rem 0.9rem",background:C.surface,
                  border:`1px dashed ${C.border2}`,borderRadius:4,
                  fontSize:11,color:C.textMuted,fontFamily:mono,marginBottom:"0.8rem"}}>
                  Add one group per variable (e.g. income_ → income, hours_ → hours).
                </div>
              )}
              <div style={{display:"flex",flexDirection:"column",gap:5,marginBottom:"0.8rem"}}>
                {pivGroups.map((g, i) => {
                  const matchedCols = headers.filter(h => g.prefix && h.startsWith(g.prefix));
                  return (
                    <div key={i} style={{display:"grid",gridTemplateColumns:"1fr 1fr auto",
                      gap:6,alignItems:"center",padding:"0.5rem 0.65rem",
                      background:C.surface2,border:`1px solid ${C.border}`,borderRadius:4}}>
                      <div>
                        <input value={g.prefix}
                          onChange={e => updateGroup(i, { prefix: e.target.value })}
                          placeholder="column prefix (e.g. income_)"
                          style={{...inS, width:"100%", boxSizing:"border-box"}}/>
                        {matchedCols.length > 0 && (
                          <div style={{fontSize:9,color:C.teal,fontFamily:mono,marginTop:2}}>
                            matches: {matchedCols.slice(0,4).join(", ")}{matchedCols.length>4?`… +${matchedCols.length-4}`:""}
                          </div>
                        )}
                      </div>
                      <input value={g.colName}
                        onChange={e => updateGroup(i, { colName: e.target.value })}
                        placeholder="output column name (e.g. income)"
                        style={{...inS, width:"100%", boxSizing:"border-box"}}/>
                      <button onClick={() => removeGroup(i)} style={{
                        background:"transparent",border:`1px solid ${C.border2}`,
                        borderRadius:2,color:C.textMuted,cursor:"pointer",
                        fontSize:11,padding:"0.2rem 0.4rem"}}>✕</button>
                    </div>
                  );
                })}
              </div>
              <button onClick={() => addGroup()}
                style={{padding:"0.25rem 0.7rem",border:`1px dashed ${C.teal}`,
                  background:"transparent",color:C.teal,borderRadius:3,
                  cursor:"pointer",fontSize:10,fontFamily:mono,marginBottom:"1.2rem"}}>
                + add variable group
              </button>

              {/* Multi preview */}
              {pivGroups.some(g=>g.prefix&&g.colName) && multiKeyValues.length > 0 && (
                <div style={{padding:"0.55rem 0.85rem",background:`${C.teal}08`,
                  border:`1px solid ${C.teal}30`,borderRadius:3,marginBottom:"1rem",
                  fontSize:11,fontFamily:mono,color:C.textDim,lineHeight:1.8}}>
                  <span style={{color:C.gold}}>→</span>{" "}
                  {rows.length} rows × {headers.length} cols{" "}
                  <span style={{color:C.textMuted}}>→</span>{" "}
                  <span style={{color:C.teal}}>{rows.length * multiKeyValues.length}</span> rows × {idColsMulti.length + 1 + pivGroups.filter(g=>g.colName).length} cols
                  <div style={{fontSize:9,color:C.textMuted,marginTop:3}}>
                    Key: <span style={{color:C.violet}}>{keyName||"?"}</span>{" = "}
                    {multiKeyValues.slice(0,6).map(k=>(
                      <span key={k} style={{color:C.text,marginRight:4}}>{k}</span>
                    ))}
                    {multiKeyValues.length>6 && <span>+{multiKeyValues.length-6} more</span>}
                  </div>
                  <div style={{fontSize:9,color:C.textMuted,marginTop:2}}>
                    Value cols: {pivGroups.filter(g=>g.colName).map(g=>(
                      <span key={g.colName} style={{color:C.teal,marginRight:4}}>{g.colName}</span>
                    ))}
                  </div>
                </div>
              )}
            </div>
          )}

          {/* ══ SIMPLE MODE ═════════════════════════════════════════════════ */}
          {pivMode === "simple" && (
            <div>
              <Lbl color={C.teal}>Columns to pivot</Lbl>
              <div style={{marginBottom:"0.5rem",display:"flex",gap:6}}>
                <button onClick={()=>setPivCols(numC)}
                  style={{padding:"0.2rem 0.55rem",border:`1px solid ${C.border2}`,
                    background:"transparent",color:C.textDim,borderRadius:2,
                    cursor:"pointer",fontSize:9,fontFamily:mono}}>select all numeric</button>
                <button onClick={()=>setPivCols([])}
                  style={{padding:"0.2rem 0.55rem",border:`1px solid ${C.border2}`,
                    background:"transparent",color:C.textDim,borderRadius:2,
                    cursor:"pointer",fontSize:9,fontFamily:mono}}>clear</button>
              </div>
              <div style={{display:"flex",flexWrap:"wrap",gap:4,marginBottom:"1rem",
                maxHeight:140,overflowY:"auto",padding:"0.5rem",
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

              <div style={{display:"grid",gridTemplateColumns:"1fr 1fr 100px",gap:"0.8rem",marginBottom:"1rem"}}>
                {[
                  ["Key column", namesTo, setNamesTo, C.violet, "e.g. year"],
                  ["Value column", valuesTo, setValuesTo, C.teal, "e.g. gdp"],
                  ["Name separator", namesSep, setNamesSep, C.textDim, "e.g. _"],
                ].map(([label, val, setter, color, ph]) => (
                  <div key={label}>
                    <Lbl color={color}>{label}</Lbl>
                    <input value={val} onChange={e => setter(e.target.value)}
                      placeholder={ph}
                      style={{...inS, width:"100%", boxSizing:"border-box"}}/>
                  </div>
                ))}
              </div>
              <div style={{fontSize:9,color:C.textMuted,fontFamily:mono,marginBottom:"1rem"}}>
                Separator splits column name to extract key value — e.g.{" "}
                <span style={{color:C.text}}>income_2019</span> with sep{" "}
                <span style={{color:C.text}}>_</span> → key={" "}
                <span style={{color:C.violet}}>2019</span>
              </div>

              {pivCols.length > 0 && (
                <div style={{padding:"0.5rem 0.75rem",background:C.surface,
                  border:`1px solid ${C.border}`,borderRadius:3,marginBottom:"1rem",
                  fontSize:10,color:C.textMuted,fontFamily:mono,lineHeight:1.7}}>
                  <span style={{color:C.textDim}}>ID cols: </span>
                  {idColsSimple.slice(0,5).map(h=>(
                    <span key={h} style={{color:C.gold,marginRight:5}}>{h}</span>
                  ))}
                  {idColsSimple.length>5 && <span>+{idColsSimple.length-5} more</span>}
                </div>
              )}
            </div>
          )}

          <Btn onClick={doPivot} color={C.teal} v="solid"
            dis={!canPivot} ch="Pivot longer →"/>
        </div>
      )}

      {/* ══════════════ ARRANGE ════════════════════════════════════════════ */}
      {sub === "arrange" && (
        <div>
          <div style={{padding:"0.65rem 1rem",background:C.surface,
            border:`1px solid ${C.border}`,borderLeft:`3px solid ${C.blue}`,
            borderRadius:4,marginBottom:"1.2rem",fontSize:11,color:C.textDim,lineHeight:1.6}}>
            Sort rows by one or more columns. Equivalent to{" "}
            <code style={{color:C.green}}>dplyr::arrange()</code>.{" "}
            Multiple keys are applied in priority order — first key wins.
          </div>

          <div style={{display:"flex",alignItems:"center",gap:8,marginBottom:"0.7rem"}}>
            <Lbl mb={0} color={C.blue}>Sort keys</Lbl>
          </div>

          {arrCols.length === 0 && (
            <div style={{padding:"0.65rem 1rem",background:C.surface,
              border:`1px dashed ${C.border2}`,borderRadius:4,
              fontSize:11,color:C.textMuted,fontFamily:mono,marginBottom:"0.8rem"}}>
              Add at least one sort key below.
            </div>
          )}

          <div style={{display:"flex",flexDirection:"column",gap:5,marginBottom:"0.9rem"}}>
            {arrCols.map((ak, i) => (
              <div key={i} style={{display:"grid",
                gridTemplateColumns:"20px 1fr auto auto",
                gap:6,alignItems:"center",padding:"0.45rem 0.65rem",
                background:C.surface2,border:`1px solid ${C.border}`,borderRadius:4}}>
                <div style={{display:"flex",flexDirection:"column",gap:1}}>
                  <button onClick={()=>setArrCols(p=>{const n=[...p];if(i>0){[n[i],n[i-1]]=[n[i-1],n[i]];}return n;})}
                    disabled={i===0}
                    style={{background:"transparent",border:"none",
                      color:i===0?C.textMuted:C.textDim,cursor:i===0?"default":"pointer",
                      fontSize:9,padding:"1px 2px",lineHeight:1}}>▲</button>
                  <button onClick={()=>setArrCols(p=>{const n=[...p];if(i<p.length-1){[n[i],n[i+1]]=[n[i+1],n[i]];}return n;})}
                    disabled={i===arrCols.length-1}
                    style={{background:"transparent",border:"none",
                      color:i===arrCols.length-1?C.textMuted:C.textDim,
                      cursor:i===arrCols.length-1?"default":"pointer",
                      fontSize:9,padding:"1px 2px",lineHeight:1}}>▼</button>
                </div>
                <select value={ak.col}
                  onChange={e=>setArrCols(p=>p.map((x,j)=>j!==i?x:{...x,col:e.target.value}))}
                  style={{padding:"0.38rem 0.6rem",background:C.surface2,
                    border:`1px solid ${C.border2}`,borderRadius:3,color:C.text,
                    fontFamily:mono,fontSize:11,outline:"none",width:"100%"}}>
                  <option value="">— column —</option>
                  {headers.map(h=><option key={h} value={h}>{h}</option>)}
                </select>
                <div style={{display:"flex",gap:3}}>
                  {[["asc","↑ asc"],["desc","↓ desc"]].map(([d,l])=>(
                    <button key={d}
                      onClick={()=>setArrCols(p=>p.map((x,j)=>j!==i?x:{...x,dir:d}))}
                      style={{padding:"0.22rem 0.5rem",fontSize:9,fontFamily:mono,
                        border:`1px solid ${ak.dir===d?C.blue:C.border2}`,
                        background:ak.dir===d?`${C.blue}18`:"transparent",
                        color:ak.dir===d?C.blue:C.textDim,
                        borderRadius:2,cursor:"pointer",transition:"all 0.1s"}}>{l}</button>
                  ))}
                </div>
                <button onClick={()=>setArrCols(p=>p.filter((_,j)=>j!==i))}
                  style={{background:"transparent",border:`1px solid ${C.border2}`,
                    borderRadius:2,color:C.textMuted,cursor:"pointer",
                    fontSize:11,padding:"0.2rem 0.4rem"}}>✕</button>
              </div>
            ))}
          </div>

          {/* Quick-add chips */}
          <div style={{display:"flex",flexWrap:"wrap",gap:3,marginBottom:"1rem"}}>
            <span style={{fontSize:9,color:C.textMuted,fontFamily:mono,
              alignSelf:"center",marginRight:2}}>add:</span>
            {headers.filter(h=>!arrCols.some(ak=>ak.col===h)).map(h=>(
              <button key={h} onClick={()=>setArrCols(p=>[...p,{col:h,dir:"asc"}])}
                style={{padding:"0.18rem 0.5rem",border:`1px solid ${C.border2}`,
                  background:"transparent",color:C.textDim,borderRadius:2,
                  cursor:"pointer",fontSize:9,fontFamily:mono,transition:"all 0.1s"}}
                onMouseEnter={e=>{e.currentTarget.style.borderColor=C.blue;e.currentTarget.style.color=C.blue;}}
                onMouseLeave={e=>{e.currentTarget.style.borderColor=C.border2;e.currentTarget.style.color=C.textDim;}}>
                + {h}
              </button>
            ))}
          </div>

          {/* dplyr preview */}
          {arrCols.some(ak=>ak.col) && (
            <div style={{padding:"0.55rem 0.85rem",background:`${C.blue}08`,
              border:`1px solid ${C.blue}30`,borderRadius:3,marginBottom:"1rem",
              fontSize:11,fontFamily:mono,color:C.textDim}}>
              <span style={{color:C.gold}}>→</span>{" "}
              arrange(<span style={{color:C.blue}}>
                {arrCols.filter(ak=>ak.col).map((ak,i,arr)=>(
                  <span key={i}>
                    {ak.dir==="desc"?<span>desc(<span style={{color:C.text}}>{ak.col}</span>)</span>:<span style={{color:C.text}}>{ak.col}</span>}
                    {i<arr.length-1?", ":""}
                  </span>
                ))}
              </span>)
            </div>
          )}

          <Btn
            onClick={()=>{
              const valid = arrCols.filter(ak=>ak.col);
              if(!valid.length) return;
              // Emit in reverse so first key has highest priority after chaining
              [...valid].reverse().forEach(ak=>{
                onAdd({type:"arrange",col:ak.col,dir:ak.dir,
                  desc:`sort ${ak.col} ${ak.dir==="desc"?"↓":"↑"}`});
              });
              setArrCols([]);
            }}
            color={C.blue} v="solid"
            dis={!arrCols.some(ak=>ak.col)}
            ch={`Sort rows →${arrCols.filter(ak=>ak.col).length>1?` (${arrCols.filter(ak=>ak.col).length} keys)`:""}`}
          />
        </div>
      )}
    </div>
  );
}

export default ReshapeTab;
