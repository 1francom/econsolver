// ─── ECON STUDIO · components/wrangling/ReshapeTab.jsx ─────────────────────
import { useState, useMemo } from "react";
import { useTheme, mono, Lbl, Tabs, Btn } from "./shared.jsx";

function GroupTransformSection({ headers, onAdd, C }) {
  const [by, setBy]   = useState([]);
  const [col, setCol] = useState("");
  const [fn, setFn]   = useState("mean");
  const [nn, setNn]   = useState("");
  const toggle = h => setBy(s => s.includes(h) ? s.filter(x=>x!==h) : [...s, h]);
  const auto = `${fn}_${col}_by_${by.join("_")}`;
  return (
    <div style={{marginBottom:"1.2rem"}}>
      <Lbl color={C.gold}>Group transform - broadcast a group stat back to every row</Lbl>
      <div style={{fontSize:10,color:C.textMuted,fontFamily:mono,marginBottom:6}}>
        Like group_by() |&gt; mutate(): adds a column, keeps all rows.
      </div>
      <Lbl color={C.gold}>Group by</Lbl>
      <div style={{display:"flex",flexWrap:"wrap",gap:4,marginBottom:8}}>
        {headers.map(h=>(
          <button key={h} onClick={()=>toggle(h)}
            style={{padding:"0.2rem 0.5rem",border:`1px solid ${by.includes(h)?C.gold:C.border2}`,
              background:by.includes(h)?`${C.gold}18`:"transparent",color:by.includes(h)?C.gold:C.textDim,
              borderRadius:3,cursor:"pointer",fontSize:10,fontFamily:mono}}>{h}</button>
        ))}
      </div>
      <div style={{display:"flex",gap:8,marginBottom:8,flexWrap:"wrap"}}>
        <select value={col} onChange={e=>setCol(e.target.value)}
          style={{padding:"0.3rem",background:C.surface2,border:`1px solid ${C.border2}`,borderRadius:3,color:C.text,fontFamily:mono,fontSize:11}}>
          <option value="">- column -</option>
          {headers.map(h=><option key={h} value={h}>{h}</option>)}
        </select>
        <select value={fn} onChange={e=>setFn(e.target.value)}
          style={{padding:"0.3rem",background:C.surface2,border:`1px solid ${C.border2}`,borderRadius:3,color:C.text,fontFamily:mono,fontSize:11}}>
          {["mean","sum","sd","min","max","count","median","rank"].map(f=><option key={f} value={f}>{f}</option>)}
        </select>
        <input value={nn} onChange={e=>setNn(e.target.value)} placeholder={auto}
          style={{flex:1,minWidth:120,padding:"0.3rem 0.5rem",background:C.surface2,border:`1px solid ${C.border2}`,borderRadius:3,color:C.text,fontFamily:mono,fontSize:11,outline:"none"}}/>
      </div>
      <Btn onClick={()=>onAdd({type:"group_transform",by,col,fn,nn:nn||auto,
        desc:`group_transform ${fn}(${col}) by ${by.join(", ")} -> ${nn||auto}`})}
        color={C.gold} v="solid" dis={!col||!by.length} ch="Add group transform ->"/>
    </div>
  );
}

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

  // pivot_wider state
  const [wideOpen,        setWideOpen]        = useState(false);
  const [wideIdCols,      setWideIdCols]      = useState([]);
  const [wideNamesFrom,   setWideNamesFrom]   = useState("");
  const [wideValuesFrom,  setWideValuesFrom]  = useState("");
  const [wideValuesFill,  setWideValuesFill]  = useState("0");
  const [wideNamesPrefix, setWideNamesPrefix] = useState("");

  // ── arrange state ─────────────────────────────────────────────────────────
  const [arrCols,   setArrCols]   = useState([]);     // [{col, dir}] sort keys

  // group_summarize state
  const [sumByCols, setSumByCols] = useState([]);
  const [sumAggs,   setSumAggs]   = useState([]);

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

  const wideIdCandidates = useMemo(() => (
    headers.filter(h => h !== wideNamesFrom && h !== wideValuesFrom)
  ), [headers, wideNamesFrom, wideValuesFrom]);
  const wideSelectedIdCols = useMemo(() => (
    wideIdCols.filter(h => wideIdCandidates.includes(h))
  ), [wideIdCols, wideIdCandidates]);
  const wideEffectiveIdCols = wideSelectedIdCols;
  const wideNameValues = useMemo(() => {
    if (!wideNamesFrom) return [];
    return [...new Set(rows.map(r => r[wideNamesFrom]).filter(v => v !== null && v !== undefined && v !== ""))];
  }, [rows, wideNamesFrom]);
  const wideOutputCols = useMemo(() => (
    wideNameValues.map(v => `${wideNamesPrefix}${String(v)}`)
  ), [wideNameValues, wideNamesPrefix]);
  const wideRowCount = useMemo(() => (
    new Set(rows.map(r => JSON.stringify(wideEffectiveIdCols.map(id => r[id] ?? null)))).size
  ), [rows, wideEffectiveIdCols]);
  const sumNumCols = headers.filter(h => info[h]?.isNum);
  const SUM_FN_OPTS = [
    ["mean","Mean"],["median","Median"],["sum","Sum"],
    ["count","Count"],["min","Min"],["max","Max"],["sd","Std dev"],
    ["quantile","Quantile (p...)"],
  ];

  function sumAggName(agg) {
    if (!agg.col) return "";
    if (agg.fn === "quantile") {
      let q = Number(agg.q ?? 0.9);
      if (!Number.isFinite(q)) q = 0.9;
      return `${agg.col}_p${Math.round(Math.min(1, Math.max(0, q)) * 100)}`;
    }
    return `${agg.fn}_${agg.col}`;
  }

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

  function toggleWideIdCol(h) {
    setWideIdCols(p => p.includes(h) ? p.filter(x => x !== h) : [...p, h]);
  }

  function toggleSumByCol(h) {
    setSumByCols(p => p.includes(h) ? p.filter(x => x !== h) : [...p, h]);
  }
  function addSumAgg(col = "", fn = "mean") {
    const agg = { col, fn, q: fn === "quantile" ? 0.9 : undefined };
    setSumAggs(a => [...a, { ...agg, nn: sumAggName(agg) }]);
  }
  function updSumAgg(i, patch) {
    setSumAggs(a => a.map((x, j) => {
      if (j !== i) return x;
      const oldAuto = sumAggName(x);
      const updated = { ...x, ...patch };
      if (updated.fn === "quantile" && updated.q == null) updated.q = 0.9;
      if ((!x.nn || x.nn === oldAuto) && (patch.col !== undefined || patch.fn !== undefined || patch.q !== undefined)) {
        updated.nn = sumAggName(updated);
      }
      return updated;
    }));
  }
  function rmSumAgg(i) { setSumAggs(a => a.filter((_, j) => j !== i)); }

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

  function doWider() {
    if (!wideNamesFrom || !wideValuesFrom) return;
    const fill = wideValuesFill === "" ? null : Number(wideValuesFill);
    onAdd({
      type: "pivot_wider",
      idCols: wideSelectedIdCols,
      namesFrom: wideNamesFrom,
      valuesFrom: wideValuesFrom,
      valuesFill: fill === null || Number.isFinite(fill) ? fill : null,
      namesPrefix: wideNamesPrefix,
      desc: `Pivot wider: ${wideNamesFrom} -> ${wideValuesFrom}`,
    });
    setWideIdCols([]); setWideNamesFrom(""); setWideValuesFrom("");
    setWideValuesFill("0"); setWideNamesPrefix("");
  }

  function doSummarizeStep() {
    const validAggs = sumAggs.filter(a => a.col && a.fn && a.nn.trim())
      .map(a => ({
        col: a.col,
        fn: a.fn,
        nn: a.nn.trim(),
        ...(a.fn === "quantile" ? { q: Number.isFinite(Number(a.q)) ? Math.min(1, Math.max(0, Number(a.q))) : 0.9 } : {}),
      }));
    if (!sumByCols.length || !validAggs.length) return;
    onAdd({
      type: "group_summarize",
      by: sumByCols,
      aggs: validAggs,
      desc: `Group summarize by [${sumByCols.join(", ")}] (${validAggs.length} aggs)`,
    });
    setSumByCols([]); setSumAggs([]);
  }

  const canPivot = pivMode === "multi"
    ? pivGroups.some(g => g.prefix.trim() && g.colName.trim()) && keyName.trim()
    : pivCols.length > 0 && namesTo.trim() && valuesTo.trim();
  const canWider = Boolean(wideNamesFrom && wideValuesFrom);
  const canSummarize = sumByCols.length > 0 && sumAggs.some(a => a.col && a.fn && a.nn.trim());

  const inS = { padding:"0.38rem 0.6rem", background:C.surface2,
    border:`1px solid ${C.border2}`, borderRadius:3, color:C.text,
    fontFamily:mono, fontSize:11, outline:"none" };

  return (
    <div>
      <Tabs tabs={[["pivot","⟲ Pivot longer"],["arrange","↕ Sort rows"],["summarize","⊞ Summarize"]]}
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
                <button onClick={()=>setPivCols(headers.filter(h=>info[h]?.isNum))}
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

          <div style={{marginTop:"1.2rem",paddingTop:"1rem",borderTop:`1px solid ${C.border}`}}>
            <button onClick={() => setWideOpen(o => !o)}
              style={{width:"100%",padding:"0.55rem 0.75rem",display:"flex",
                justifyContent:"space-between",alignItems:"center",
                background:C.surface,border:`1px solid ${C.border}`,
                borderLeft:`3px solid ${C.violet}`,borderRadius:4,
                color:C.text,cursor:"pointer",fontFamily:mono,fontSize:11}}>
              <span>Pivot Wider</span>
              <span style={{color:C.violet}}>{wideOpen ? "hide" : "show"}</span>
            </button>

            {wideOpen && (
              <div style={{padding:"0.9rem 0 0"}}>
                <div style={{padding:"0.65rem 1rem",background:C.surface,
                  border:`1px solid ${C.border}`,borderLeft:`3px solid ${C.violet}`,
                  borderRadius:4,marginBottom:"1rem",fontSize:11,color:C.textDim,lineHeight:1.6}}>
                  Converts <span style={{color:C.teal}}>long format</span> to{" "}
                  <span style={{color:C.gold}}>wide format</span>.
                  Equivalent to <code style={{color:C.green}}>tidyr::pivot_wider()</code>.
                </div>

                <Lbl color={C.gold}>ID columns</Lbl>
                <div style={{marginBottom:"0.5rem",display:"flex",gap:6}}>
                  <button onClick={()=>setWideIdCols(wideIdCandidates)}
                    style={{padding:"0.2rem 0.55rem",border:`1px solid ${C.border2}`,
                      background:"transparent",color:C.textDim,borderRadius:2,
                      cursor:"pointer",fontSize:9,fontFamily:mono}}>select all ids</button>
                  <button onClick={()=>setWideIdCols([])}
                    style={{padding:"0.2rem 0.55rem",border:`1px solid ${C.border2}`,
                      background:"transparent",color:C.textDim,borderRadius:2,
                      cursor:"pointer",fontSize:9,fontFamily:mono}}>clear</button>
                </div>
                <div style={{display:"flex",flexWrap:"wrap",gap:4,marginBottom:"1rem",
                  maxHeight:110,overflowY:"auto",padding:"0.5rem",
                  background:C.surface2,border:`1px solid ${C.border}`,borderRadius:4}}>
                  {wideIdCandidates.map(h => {
                    const sel = wideSelectedIdCols.includes(h);
                    return (
                      <button key={h} onClick={() => toggleWideIdCol(h)} style={{
                        padding:"0.25rem 0.6rem",
                        border:`1px solid ${sel ? C.gold : C.border2}`,
                        background: sel ? `${C.gold}18` : "transparent",
                        color: sel ? C.gold : info[h]?.isNum ? C.blue : C.textDim,
                        borderRadius:3,cursor:"pointer",fontSize:10,fontFamily:mono,
                        transition:"all 0.1s",
                      }}>
                        {h}
                      </button>
                    );
                  })}
                </div>

                <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:"0.8rem",marginBottom:"1rem"}}>
                  <div>
                    <Lbl color={C.violet}>Names from</Lbl>
                    <select value={wideNamesFrom} onChange={e => setWideNamesFrom(e.target.value)}
                      style={{...inS, width:"100%", boxSizing:"border-box"}}>
                      <option value="">- column -</option>
                      {headers.map(h=><option key={h} value={h}>{h}</option>)}
                    </select>
                  </div>
                  <div>
                    <Lbl color={C.teal}>Values from</Lbl>
                    <select value={wideValuesFrom} onChange={e => setWideValuesFrom(e.target.value)}
                      style={{...inS, width:"100%", boxSizing:"border-box"}}>
                      <option value="">- column -</option>
                      {headers.map(h=><option key={h} value={h}>{h}</option>)}
                    </select>
                  </div>
                </div>

                <div style={{display:"grid",gridTemplateColumns:"120px 1fr",gap:"0.8rem",marginBottom:"1rem"}}>
                  <div>
                    <Lbl color={C.textDim}>Fill</Lbl>
                    <input type="number" value={wideValuesFill}
                      onChange={e => setWideValuesFill(e.target.value)}
                      style={{...inS, width:"100%", boxSizing:"border-box"}}/>
                  </div>
                  <div>
                    <Lbl color={C.textDim}>Names prefix</Lbl>
                    <input value={wideNamesPrefix} onChange={e => setWideNamesPrefix(e.target.value)}
                      placeholder="optional"
                      style={{...inS, width:"100%", boxSizing:"border-box"}}/>
                  </div>
                </div>

                {canWider && (
                  <div style={{padding:"0.55rem 0.85rem",background:`${C.violet}08`,
                    border:`1px solid ${C.violet}30`,borderRadius:3,marginBottom:"1rem",
                    fontSize:11,fontFamily:mono,color:C.textDim,lineHeight:1.7}}>
                    <span style={{color:C.gold}}>{"->"}</span>{" "}
                    {rows.length} rows x {headers.length} cols{" "}
                    <span style={{color:C.textMuted}}>{"->"}</span>{" "}
                    <span style={{color:C.violet}}>{wideRowCount}</span> rows x {wideEffectiveIdCols.length + wideOutputCols.length} cols
                    <div style={{fontSize:9,color:C.textMuted,marginTop:3}}>
                      New cols: {wideOutputCols.slice(0,6).map(h=>(
                        <span key={h} style={{color:C.text,marginRight:4}}>{h}</span>
                      ))}
                      {wideOutputCols.length>6 && <span>+{wideOutputCols.length-6} more</span>}
                    </div>
                  </div>
                )}

                <Btn onClick={doWider} color={C.violet} v="solid"
                  dis={!canWider} ch="Pivot wider ->"/>
              </div>
            )}
          </div>
        </div>
      )}

      {sub === "summarize" && (
        <div>
          <div style={{padding:"0.65rem 1rem",background:C.surface,
            border:`1px solid ${C.border}`,borderLeft:`3px solid ${C.gold}`,
            borderRadius:4,marginBottom:"1.2rem",fontSize:11,color:C.textDim,lineHeight:1.6}}>
            Collapse rows to one row per group and compute summary statistics.
          </div>

          <GroupTransformSection headers={headers} onAdd={onAdd} C={C}/>

          <Lbl color={C.gold}>Group by</Lbl>
          <div style={{display:"flex",flexWrap:"wrap",gap:4,marginBottom:"1.2rem",
            maxHeight:120,overflowY:"auto",padding:"0.5rem",
            background:C.surface2,border:`1px solid ${C.border}`,borderRadius:4}}>
            {headers.map(h => {
              const sel = sumByCols.includes(h);
              return (
                <button key={h} onClick={() => toggleSumByCol(h)} style={{
                  padding:"0.25rem 0.6rem",
                  border:`1px solid ${sel ? C.gold : C.border2}`,
                  background: sel ? `${C.gold}18` : "transparent",
                  color: sel ? C.gold : info[h]?.isNum ? C.blue : C.textDim,
                  borderRadius:3,cursor:"pointer",fontSize:10,fontFamily:mono,
                  transition:"all 0.1s",
                }}>
                  {sel ? "✓ " : ""}{h}
                </button>
              );
            })}
          </div>

          <div style={{display:"flex",alignItems:"center",gap:8,marginBottom:"0.6rem"}}>
            <Lbl mb={0} color={C.blue}>Aggregations</Lbl>
            <button onClick={()=>addSumAgg()} style={{
              padding:"0.2rem 0.55rem",border:`1px solid ${C.blue}`,
              background:`${C.blue}10`,color:C.blue,borderRadius:2,
              cursor:"pointer",fontSize:9,fontFamily:mono}}>+ add row</button>
          </div>

          {sumNumCols.length > 0 && (
            <div style={{display:"flex",flexWrap:"wrap",gap:3,marginBottom:"0.8rem"}}>
              <span style={{fontSize:9,color:C.textMuted,fontFamily:mono,alignSelf:"center",marginRight:2}}>quick add:</span>
              {sumNumCols.map(h => (
                <button key={h} onClick={()=>addSumAgg(h,"mean")}
                  style={{padding:"0.18rem 0.5rem",border:`1px solid ${C.border2}`,
                    background:"transparent",color:C.textDim,borderRadius:2,
                    cursor:"pointer",fontSize:9,fontFamily:mono,transition:"all 0.1s"}}>
                  + {h}
                </button>
              ))}
            </div>
          )}

          {sumAggs.length === 0 && (
            <div style={{padding:"0.65rem 1rem",background:C.surface,
              border:`1px dashed ${C.border2}`,borderRadius:4,
              fontSize:11,color:C.textMuted,fontFamily:mono,marginBottom:"1rem"}}>
              Add at least one aggregation.
            </div>
          )}

          <div style={{display:"flex",flexDirection:"column",gap:6,marginBottom:"1.2rem"}}>
            {sumAggs.map((agg, i) => (
              <div key={i} style={{display:"grid",
                gridTemplateColumns:agg.fn==="quantile" ? "1fr 140px 95px 1fr auto" : "1fr 140px 1fr auto",
                gap:6,alignItems:"end",padding:"0.5rem 0.65rem",
                background:C.surface2,border:`1px solid ${C.border}`,borderRadius:4}}>
                <div>
                  <Lbl color={C.teal}>Column</Lbl>
                  <select value={agg.col} onChange={e=>updSumAgg(i,{col:e.target.value})}
                    style={{...inS,width:"100%",boxSizing:"border-box"}}>
                    <option value="">- column -</option>
                    {sumNumCols.map(h=><option key={h} value={h}>{h}</option>)}
                  </select>
                </div>
                <div>
                  <Lbl color={C.violet}>Function</Lbl>
                  <select value={agg.fn} onChange={e=>{
                    const fn = e.target.value;
                    updSumAgg(i,{fn,...(fn==="quantile" && agg.q == null ? {q:0.9} : {})});
                  }} style={{...inS,width:"100%",boxSizing:"border-box"}}>
                    {SUM_FN_OPTS.map(([v,l])=><option key={v} value={v}>{l}</option>)}
                  </select>
                </div>
                {agg.fn === "quantile" && (
                  <div>
                    <Lbl color={C.gold}>Percentile</Lbl>
                    <input type="number" min="0" max="100" step="1"
                      value={Math.round((agg.q ?? 0.9) * 100)}
                      onChange={e=>{
                        const raw = Number(e.target.value);
                        const pct = Number.isFinite(raw) ? Math.min(100, Math.max(0, raw)) : 90;
                        updSumAgg(i,{q:pct/100});
                      }}
                      style={{...inS,width:"100%",boxSizing:"border-box"}}/>
                  </div>
                )}
                <div>
                  <Lbl color={C.textDim}>Output</Lbl>
                  <input value={agg.nn}
                    onChange={e=>setSumAggs(a=>a.map((x,j)=>j!==i?x:{...x,nn:e.target.value}))}
                    placeholder={sumAggName(agg) || "output_col"}
                    style={{...inS,width:"100%",boxSizing:"border-box"}}/>
                </div>
                <button onClick={()=>rmSumAgg(i)} style={{
                  background:"transparent",border:`1px solid ${C.border2}`,
                  borderRadius:2,color:C.textMuted,cursor:"pointer",
                  fontSize:11,padding:"0.34rem 0.5rem"}}>×</button>
              </div>
            ))}
          </div>

          <Btn onClick={doSummarizeStep} color={C.gold} v="solid"
            dis={!canSummarize} ch="Summarize ->"/>
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
