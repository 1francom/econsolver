// ─── ECON STUDIO · components/wrangling/MergeTab.jsx ───────────────────────
import { useState, useMemo } from "react";
import { useTheme, mono, Lbl, Tabs, Btn, Grid } from "./shared.jsx";
import VectorAssignForm from "./VectorAssignForm.jsx";

const emptyJoin = () => ({ rightId:"", leftKey:"", rightKey:"", how:"left", suffix:"_r" });

// ─── MERGE TAB ───────────────────────────────────────────────────────────────
// JOIN and APPEND operations against other loaded datasets.
// RHS always uses raw (pre-pipeline) data of the referenced dataset.
function MergeTab({ rows, headers, filename, allDatasets, onAdd }) {
  const { C } = useTheme();
  const [subTab, setSubTab]       = useState("join");
  // JOIN state — array of staged joins, runs in order through runner.js
  const [joins, setJoins]         = useState([emptyJoin()]);
  // APPEND state
  const [appendId, setAppendId]   = useState("");
  const [combineId, setCombineId] = useState("");
  const [combineOp, setCombineOp] = useState("union");
  const [combineSuffix, setCombineSuffix] = useState("_r");

  const appendDs  = allDatasets.find(d => d.id === appendId);
  const combineDs = allDatasets.find(d => d.id === combineId);

  const updateJoin = (i, patch) =>
    setJoins(js => js.map((j, k) => k === i ? { ...j, ...patch } : j));
  const removeJoin = i =>
    setJoins(js => js.length > 1 ? js.filter((_, k) => k !== i) : [emptyJoin()]);
  const addJoin = () =>
    setJoins(js => [...js, emptyJoin()]);

  // Simulate header chain through staged joins so each row's left-key picker
  // can reference columns added by earlier joins.
  const headerChain = useMemo(() => {
    const chain = [headers.slice()];
    for (let i = 0; i < joins.length; i++) {
      const sj = joins[i];
      const right = allDatasets.find(d => d.id === sj.rightId);
      const prev = chain[i];
      if (!right || !sj.rightKey || sj.how === "anti" || sj.how === "semi") { chain.push(prev.slice()); continue; }
      const next = prev.slice();
      for (const h of right.rawData.headers) {
        if (h === sj.rightKey) continue;
        const dest = next.includes(h) ? `${h}${sj.suffix || "_r"}` : h;
        if (!next.includes(dest)) next.push(dest);
      }
      chain.push(next);
    }
    return chain; // chain[i] = headers available as left side for staged join i
  }, [joins, headers, allDatasets]);

  // Match preview for the first staged join only (against the actual live `rows`).
  // Subsequent joins act on a chained intermediate dataset we don't materialize here.
  const firstMatchPreview = useMemo(() => {
    const j0 = joins[0];
    const r0 = allDatasets.find(d => d.id === j0?.rightId);
    if (!r0 || !j0.leftKey || !j0.rightKey) return null;
    const rKeys = new Set(r0.rawData.rows.map(r => String(r[j0.rightKey] ?? "")));
    let matched = 0, keyNulls = 0;
    rows.forEach(r => {
      const v = r[j0.leftKey];
      if (v === null || v === undefined) { keyNulls++; return; }
      if (rKeys.has(String(v))) matched++;
    });
    const validRows = rows.length - keyNulls;
    return { matched, total: rows.length, validRows, keyNulls,
             pct: validRows ? matched / validRows : 0 };
  }, [joins, allDatasets, rows]);

  const appendPreview = useMemo(() => {
    if (!appendDs) return null;
    const rSet = new Set(appendDs.rawData.headers);
    const lSet = new Set(headers);
    return {
      shared:    headers.filter(h => rSet.has(h)).length,
      onlyLeft:  headers.filter(h => !rSet.has(h)).length,
      onlyRight: appendDs.rawData.headers.filter(h => !lSet.has(h)).length,
      rightRows: appendDs.rawData.rows.length,
    };
  }, [appendDs, headers]);

  const combinePreview = useMemo(() => {
    if (!combineDs) return null;
    const rH = combineDs.rawData.headers, rN = combineDs.rawData.rows.length;
    const shared = headers.filter(h => rH.includes(h));
    if (combineOp === "bind_cols") {
      return { kind:"bind_cols", outRows: Math.min(rows.length, rN),
        mismatch: rows.length !== rN, lN: rows.length, rN,
        outCols: headers.length + rH.length };
    }
    return { kind:"set", shared, rN };
  }, [combineDs, combineOp, headers, rows.length]);

  const completeJoins = joins.filter(j => j.rightId && j.leftKey && j.rightKey);

  function doJoinAll() {
    if (!completeJoins.length) return;
    for (const j of completeJoins) {
      const rDs = allDatasets.find(d => d.id === j.rightId);
      onAdd({ type:"join", rightId:j.rightId, leftKey:j.leftKey, rightKey:j.rightKey,
        how:j.how, suffix:j.suffix,
        desc:`${j.how.toUpperCase()} JOIN ${rDs?.filename} on ${j.leftKey} = ${j.rightKey}` });
    }
    setJoins([emptyJoin()]);
  }
  function doAppend() {
    if (!appendId) return;
    onAdd({ type:"append", rightId:appendId,
      desc:`APPEND ${appendDs?.filename} (+${appendDs?.rawData?.rows?.length} rows)` });
    setAppendId("");
  }
  function doCombine() {
    if (!combineId) return;
    const base = { rightId: combineId };
    if (combineOp === "bind_cols") base.suffix = combineSuffix;
    onAdd({ type: combineOp, ...base,
      desc: `${combineOp.toUpperCase()} ${combineDs?.filename}` });
    setCombineId("");
  }
  const colBtnStyle = (sel, color) => ({
    padding:"0.28rem 0.55rem", border:`1px solid ${sel?color:C.border}`,
    background:sel?`${color}18`:"transparent", color:sel?color:C.textDim,
    borderRadius:2, cursor:"pointer", fontSize:10, fontFamily:mono,
    textAlign:"left", transition:"all 0.1s",
  });

  // ── Empty state — no other datasets loaded ──
  if (!allDatasets.length) {
    return (
      <div style={{padding:"2.5rem 1.5rem",textAlign:"center",border:`1px dashed ${C.border2}`,borderRadius:4}}>
        <div style={{fontSize:22,marginBottom:10}}>⊞</div>
        <div style={{fontSize:12,color:C.textDim,lineHeight:1.8,fontFamily:mono}}>
          No other datasets loaded.<br/>
          Use the <span style={{color:C.teal}}>Dataset Manager</span> sidebar
          to load a second file — then join or append it here.
        </div>
      </div>
    );
  }

  return (
    <div>
      {/* ── Sub-tabs: JOIN / APPEND ── */}
      <Tabs tabs={[["join","⊞ Join"],["append","⊕ Append"],["combine","⊜ Combine"],["vector","⊕ Vector"]]} active={subTab} set={setSubTab} accent={C.teal} sm/>

      {/* ════════════ JOIN ════════════ */}
      {subTab==="join" && (
        <div>
          {/* Context note */}
          <div style={{padding:"0.55rem 0.9rem",background:C.surface,border:`1px solid ${C.border}`,
            borderLeft:`3px solid ${C.blue}`,borderRadius:4,marginBottom:"1.2rem",
            fontSize:10,color:C.textMuted,fontFamily:mono,lineHeight:1.6}}>
            Equivalent to dplyr's <span style={{color:C.blue}}>left_join()</span> / <span style={{color:C.blue}}>inner_join()</span>.
            Stage multiple joins below — they apply sequentially, so a later join can use
            a column added by an earlier one. Each right dataset is referenced in its
            <em> raw</em> (pre-pipeline) state.
          </div>

          {/* ── Staged joins ────────────────────────────────────────────── */}
          {joins.map((j, idx) => {
            const rDs = allDatasets.find(d => d.id === j.rightId);
            const rHdrs = rDs?.rawData?.headers || [];
            const leftHdrs = headerChain[idx] || headers;
            const noCols = j.how === "anti" || j.how === "semi";
            return (
              <div key={idx} style={{
                marginBottom:"1.2rem", padding:"0.9rem", background:C.surface,
                border:`1px solid ${C.border}`, borderRadius:4,
              }}>
                <div style={{display:"flex",alignItems:"center",gap:8,marginBottom:"0.7rem"}}>
                  <span style={{fontSize:10,color:C.teal,letterSpacing:"0.18em",
                    textTransform:"uppercase",fontFamily:mono}}>Join {idx+1}</span>
                  <span style={{flex:1}}/>
                  {joins.length > 1 && (
                    <button onClick={()=>removeJoin(idx)}
                      style={{padding:"0.18rem 0.55rem",border:`1px solid ${C.border2}`,
                        background:"transparent",color:C.textMuted,borderRadius:3,
                        cursor:"pointer",fontSize:10,fontFamily:mono}}
                      title="Remove this join">× Remove</button>
                  )}
                </div>

                {/* Right dataset picker */}
                <Lbl color={C.teal}>Right dataset</Lbl>
                <div style={{display:"flex",flexWrap:"wrap",gap:6,marginBottom:"1rem"}}>
                  {allDatasets.map(d=>(
                    <button key={d.id}
                      onClick={()=>updateJoin(idx,{rightId:d.id,leftKey:"",rightKey:""})}
                      style={{padding:"0.35rem 0.75rem",border:`1px solid ${j.rightId===d.id?C.teal:C.border2}`,
                        background:j.rightId===d.id?`${C.teal}18`:"transparent",
                        color:j.rightId===d.id?C.teal:C.textDim,borderRadius:3,cursor:"pointer",
                        fontSize:11,fontFamily:mono,transition:"all 0.1s"}}>
                      {j.rightId===d.id?"✓ ":""}{d.filename}
                      <span style={{fontSize:9,color:C.textMuted,marginLeft:6}}>
                        {d.rawData.rows.length.toLocaleString()}×{d.rawData.headers.length}
                      </span>
                    </button>
                  ))}
                </div>

                {rDs && (<>
                  {/* Key column selectors */}
                  <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:"1rem",marginBottom:"1rem"}}>
                    <div>
                      <Lbl color={C.gold}>Left key — {idx===0?"this dataset":"after prior joins"}</Lbl>
                      <div style={{display:"flex",flexDirection:"column",gap:3,maxHeight:160,overflowY:"auto",
                        padding:"0.4rem",background:C.surface2,border:`1px solid ${C.border}`,borderRadius:3}}>
                        {leftHdrs.map(h=>(
                          <button key={h} onClick={()=>updateJoin(idx,{leftKey:h})} style={colBtnStyle(j.leftKey===h,C.gold)}>
                            {j.leftKey===h?"✓ ":""}{h}
                          </button>
                        ))}
                      </div>
                    </div>
                    <div>
                      <Lbl color={C.blue}>Right key — {rDs.filename}</Lbl>
                      <div style={{display:"flex",flexDirection:"column",gap:3,maxHeight:160,overflowY:"auto",
                        padding:"0.4rem",background:C.surface2,border:`1px solid ${C.border}`,borderRadius:3}}>
                        {rHdrs.map(h=>(
                          <button key={h} onClick={()=>updateJoin(idx,{rightKey:h})} style={colBtnStyle(j.rightKey===h,C.blue)}>
                            {j.rightKey===h?"✓ ":""}{h}
                          </button>
                        ))}
                      </div>
                    </div>
                  </div>

                  {/* Match preview — only for join 0 (we don't materialize the chain) */}
                  {idx===0 && firstMatchPreview && (() => {
                    const mc = firstMatchPreview.pct > 0.8 ? C.green : firstMatchPreview.pct > 0.4 ? C.yellow : C.red;
                    return (
                      <div style={{padding:"0.55rem 0.8rem",background:C.surface2,
                        border:`1px solid ${mc}30`,borderLeft:`3px solid ${mc}`,
                        borderRadius:4,marginBottom:"1rem"}}>
                        <div style={{display:"flex",alignItems:"center",gap:10,marginBottom:4}}>
                          <div style={{flex:1,height:4,background:C.border,borderRadius:2,overflow:"hidden"}}>
                            <div style={{width:`${firstMatchPreview.pct*100}%`,height:"100%",background:mc,borderRadius:2,transition:"width 0.3s"}}/>
                          </div>
                          <span style={{fontSize:11,color:mc,fontFamily:mono,flexShrink:0}}>
                            {(firstMatchPreview.pct*100).toFixed(1)}%
                          </span>
                        </div>
                        <div style={{fontSize:11,color:C.textDim,fontFamily:mono}}>
                          <span style={{color:mc}}>{firstMatchPreview.matched.toLocaleString()}</span>
                          {" of "}{firstMatchPreview.validRows.toLocaleString()} left rows matched
                        </div>
                        {firstMatchPreview.keyNulls > 0 && (
                          <div style={{fontSize:10,color:C.orange,fontFamily:mono,marginTop:4}}>
                            ⚠ {firstMatchPreview.keyNulls} row{firstMatchPreview.keyNulls!==1?"s":""} have null in key column '{j.leftKey}'.
                          </div>
                        )}
                      </div>
                    );
                  })()}

                  {/* Join type + suffix */}
                  <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:"1rem",marginBottom:"1rem"}}>
                    <div>
                      <Lbl color={C.teal}>Join type</Lbl>
                      <div style={{display:"flex",gap:4}}>
                        {[["left","LEFT"],["inner","INNER"],["right","RIGHT"],["full","FULL"],["semi","SEMI"],["anti","ANTI"]].map(([k,l])=>(
                          <button key={k} onClick={()=>updateJoin(idx,{how:k})}
                            style={{padding:"0.3rem 0.7rem",border:`1px solid ${j.how===k?C.teal:C.border2}`,
                              background:j.how===k?`${C.teal}18`:"transparent",color:j.how===k?C.teal:C.textDim,
                              borderRadius:3,cursor:"pointer",fontSize:11,fontFamily:mono}}>
                            {j.how===k?"✓ ":""}{l}
                          </button>
                        ))}
                      </div>
                    </div>
                    {noCols ? (
                      <div style={{fontSize:10,color:C.textMuted,fontFamily:mono,alignSelf:"center"}}>
                        Filters rows only - no columns added.
                      </div>
                    ) : (
                      <div>
                        <Lbl color={C.textDim}>Suffix for column conflicts</Lbl>
                        <input value={j.suffix} onChange={e=>updateJoin(idx,{suffix:e.target.value})} placeholder="_r"
                          style={{width:"100%",boxSizing:"border-box",padding:"0.35rem 0.55rem",
                            background:C.surface2,border:`1px solid ${C.border2}`,borderRadius:3,
                            color:C.text,fontFamily:mono,fontSize:11,outline:"none"}}/>
                      </div>
                    )}
                  </div>

                  {/* Formula preview */}
                  {j.leftKey && j.rightKey && (
                    <div style={{padding:"0.42rem 0.7rem",background:C.surface2,border:`1px solid ${C.border}`,
                      borderRadius:3,fontSize:11,color:C.textDim,fontFamily:mono}}>
                      <span style={{color:C.gold}}>{idx===0?"this":`(after ${idx} join${idx>1?"s":""})`}</span>{" "}
                      {j.how.toUpperCase()} JOIN{" "}
                      <span style={{color:C.teal}}>{rDs.filename}</span>
                      {" ON "}<span style={{color:C.gold}}>{j.leftKey}</span>
                      {" = "}<span style={{color:C.teal}}>{j.rightKey}</span>
                      {" -> "}{noCols
                        ? <span style={{color:C.yellow}}>row filter ({j.how})</span>
                        : <span style={{color:C.green}}>+{rHdrs.filter(h=>h!==j.rightKey).length} columns</span>}
                    </div>
                  )}
                </>)}
              </div>
            );
          })}

          {/* Add-another + submit */}
          <div style={{display:"flex",alignItems:"center",gap:10,marginBottom:"1rem"}}>
            <button onClick={addJoin}
              style={{padding:"0.4rem 0.85rem",border:`1px dashed ${C.teal}`,
                background:"transparent",color:C.teal,borderRadius:3,
                cursor:"pointer",fontSize:11,fontFamily:mono}}>
              + Add another join
            </button>
            <span style={{flex:1}}/>
            <Btn onClick={doJoinAll} color={C.teal} v="solid"
              dis={completeJoins.length===0}
              ch={completeJoins.length<=1
                ? `Add JOIN to pipeline →`
                : `Add ${completeJoins.length} joins to pipeline →`}/>
          </div>
        </div>
      )}

      {/* ════════════ APPEND ════════════ */}
      {subTab==="append" && (
        <div>
          <div style={{padding:"0.55rem 0.9rem",background:C.surface,border:`1px solid ${C.border}`,
            borderLeft:`3px solid ${C.violet}`,borderRadius:4,marginBottom:"1.2rem",
            fontSize:10,color:C.textMuted,fontFamily:mono,lineHeight:1.6}}>
            Vertically stacks rows from another dataset — equivalent to dplyr's{" "}
            <span style={{color:C.violet}}>bind_rows()</span> / SQL's UNION ALL.
            Columns are matched by name. Mismatched columns are filled with null.
          </div>

          <Lbl color={C.violet}>Dataset to append</Lbl>
          <div style={{display:"flex",flexWrap:"wrap",gap:6,marginBottom:"1.4rem"}}>
            {allDatasets.map(d=>(
              <button key={d.id} onClick={()=>setAppendId(d.id)}
                style={{padding:"0.4rem 0.9rem",border:`1px solid ${appendId===d.id?C.violet:C.border2}`,
                  background:appendId===d.id?`${C.violet}18`:"transparent",
                  color:appendId===d.id?C.violet:C.textDim,borderRadius:3,cursor:"pointer",
                  fontSize:11,fontFamily:mono,transition:"all 0.1s"}}>
                {appendId===d.id?"✓ ":""}{d.filename}
                <span style={{fontSize:9,color:C.textMuted,marginLeft:6}}>
                  {d.rawData.rows.length.toLocaleString()}×{d.rawData.headers.length}
                </span>
              </button>
            ))}
          </div>

          {appendPreview && (<>
            {/* Schema overlap stats */}
            <div style={{display:"grid",gridTemplateColumns:"repeat(3,1fr)",gap:8,marginBottom:"1.2rem"}}>
              {[
                [appendPreview.shared,   "shared columns", C.green],
                [appendPreview.onlyLeft, "only in left",   C.yellow],
                [appendPreview.onlyRight,"only in right",  C.yellow],
              ].map(([val,label,color])=>(
                <div key={label} style={{padding:"0.65rem",background:C.surface2,
                  border:`1px solid ${C.border}`,borderRadius:3,textAlign:"center"}}>
                  <div style={{fontSize:20,color,fontFamily:mono,marginBottom:3}}>{val}</div>
                  <div style={{fontSize:9,color:C.textMuted,fontFamily:mono}}>{label}</div>
                </div>
              ))}
            </div>
            {appendPreview.onlyLeft > 0 || appendPreview.onlyRight > 0 ? (
              <div style={{padding:"0.5rem 0.75rem",background:`${C.yellow}08`,
                border:`1px solid ${C.yellow}30`,borderLeft:`3px solid ${C.yellow}`,
                borderRadius:4,marginBottom:"1rem",fontSize:10,color:C.textMuted,fontFamily:mono,lineHeight:1.6}}>
                ⚠ Schema mismatch — {appendPreview.onlyLeft} column{appendPreview.onlyLeft!==1?"s":""} found
                only in left, {appendPreview.onlyRight} only in right.
                These will be filled with null for the rows that lack them.
              </div>
            ) : (
              <div style={{padding:"0.5rem 0.75rem",background:`${C.green}08`,
                border:`1px solid ${C.green}30`,borderLeft:`3px solid ${C.green}`,
                borderRadius:4,marginBottom:"1rem",fontSize:10,color:C.green,fontFamily:mono}}>
                ✓ Schemas match exactly — clean append.
              </div>
            )}
            <div style={{padding:"0.48rem 0.75rem",background:C.surface,border:`1px solid ${C.border}`,
              borderRadius:3,marginBottom:"1rem",fontSize:11,color:C.textDim,fontFamily:mono}}>
              Result: <span style={{color:C.violet}}>
                {(rows.length+appendPreview.rightRows).toLocaleString()}
              </span> rows × <span style={{color:C.violet}}>
                {headers.length+appendPreview.onlyRight}
              </span> cols
            </div>
            <Btn onClick={doAppend} color={C.violet} v="solid" ch="Add APPEND to pipeline →"/>
          </>)}
        </div>
      )}

      {subTab==="combine" && (
        <div>
          <div style={{padding:"0.55rem 0.9rem",background:C.surface,border:`1px solid ${C.border}`,
            borderLeft:`3px solid ${C.gold}`,borderRadius:4,marginBottom:"1.2rem",
            fontSize:10,color:C.textMuted,fontFamily:mono,lineHeight:1.6}}>
            Set & bind operations against another dataset - dplyr <span style={{color:C.gold}}>bind_cols</span> /{" "}
            <span style={{color:C.gold}}>union</span> / <span style={{color:C.gold}}>intersect</span> /{" "}
            <span style={{color:C.gold}}>setdiff</span>.
          </div>

          <Lbl color={C.gold}>Operation</Lbl>
          <div style={{display:"flex",gap:4,flexWrap:"wrap",marginBottom:"1.2rem"}}>
            {[["union","Union (stack + dedup)"],["bind_cols","Bind columns (by position)"],
              ["intersect","Intersect (rows in both)"],["setdiff","Set diff (rows not in other)"]].map(([k,l])=>(
              <button key={k} onClick={()=>setCombineOp(k)}
                style={{padding:"0.35rem 0.7rem",border:`1px solid ${combineOp===k?C.gold:C.border2}`,
                  background:combineOp===k?`${C.gold}18`:"transparent",color:combineOp===k?C.gold:C.textDim,
                  borderRadius:3,cursor:"pointer",fontSize:11,fontFamily:mono}}>
                {combineOp===k?"✓ ":""}{l}
              </button>
            ))}
          </div>

          <Lbl color={C.gold}>Other dataset</Lbl>
          <div style={{display:"flex",flexWrap:"wrap",gap:6,marginBottom:"1.2rem"}}>
            {allDatasets.map(d=>(
              <button key={d.id} onClick={()=>setCombineId(d.id)}
                style={{padding:"0.4rem 0.9rem",border:`1px solid ${combineId===d.id?C.gold:C.border2}`,
                  background:combineId===d.id?`${C.gold}18`:"transparent",color:combineId===d.id?C.gold:C.textDim,
                  borderRadius:3,cursor:"pointer",fontSize:11,fontFamily:mono}}>
                {combineId===d.id?"✓ ":""}{d.filename}
                <span style={{fontSize:9,color:C.textMuted,marginLeft:6}}>
                  {d.rawData.rows.length.toLocaleString()}×{d.rawData.headers.length}
                </span>
              </button>
            ))}
          </div>

          {combineOp==="bind_cols" && (
            <div style={{marginBottom:"1rem"}}>
              <Lbl color={C.textDim}>Suffix for column conflicts</Lbl>
              <input value={combineSuffix} onChange={e=>setCombineSuffix(e.target.value)} placeholder="_r"
                style={{padding:"0.35rem 0.55rem",background:C.surface2,border:`1px solid ${C.border2}`,
                  borderRadius:3,color:C.text,fontFamily:mono,fontSize:11,outline:"none"}}/>
            </div>
          )}

          {combinePreview && (
            <div style={{padding:"0.55rem 0.8rem",background:C.surface2,border:`1px solid ${C.border}`,
              borderRadius:4,marginBottom:"1rem",fontSize:11,color:C.textDim,fontFamily:mono,lineHeight:1.6}}>
              {combinePreview.kind==="bind_cols" ? (<>
                Result: <span style={{color:C.gold}}>{combinePreview.outRows.toLocaleString()}</span> rows ×{" "}
                <span style={{color:C.gold}}>{combinePreview.outCols}</span> cols
                {combinePreview.mismatch && (
                  <div style={{color:C.yellow,marginTop:4}}>
                    Row counts differ ({combinePreview.lN.toLocaleString()} vs {combinePreview.rN.toLocaleString()}) - truncated to shorter.
                  </div>
                )}
              </>) : (<>
                Matched on shared columns: <span style={{color:C.gold}}>{combinePreview.shared.join(", ") || "(none - no overlap!)"}</span>
              </>)}
            </div>
          )}

          <Btn onClick={doCombine} color={C.gold} v="solid" dis={!combineId}
            ch={`Add ${combineOp.toUpperCase()} to pipeline →`}/>
        </div>
      )}

      {subTab==="vector" && (
        <VectorAssignForm rows={rows} headers={headers} onAdd={onAdd}/>
      )}

      {/* ════════════ RESULT PREVIEW ════════════ */}
      <div style={{marginTop:"2rem"}}>
        <div style={{display:"flex",alignItems:"center",gap:10,marginBottom:"0.7rem"}}>
          <Lbl mb={0}>Current dataset — pipeline output</Lbl>
          <span style={{fontSize:9,color:C.textMuted,fontFamily:mono}}>
            {rows.length.toLocaleString()} rows × {headers.length} cols
          </span>
          <button
            onClick={()=>{
              // Serialize to CSV and trigger download
              const esc = v => {
                if(v===null||v===undefined) return "";
                const s = String(v);
                return s.includes(",")||s.includes('"')||s.includes("\n")
                  ? `"${s.replace(/"/g,'""')}"` : s;
              };
              const lines = [
                headers.map(esc).join(","),
                ...rows.map(r=>headers.map(h=>esc(r[h])).join(","))
              ];
              const blob = new Blob([lines.join("\r\n")],{type:"text/csv"});
              const a = document.createElement("a");
              a.href = URL.createObjectURL(blob);
              a.download = (filename ? filename.replace(/\.[^.]+$/, "") : "pipeline_output") + "_merged.csv";
              a.click();
              URL.revokeObjectURL(a.href);
            }}
            style={{
              marginLeft:"auto", padding:"0.25rem 0.65rem",
              background:"transparent", border:`1px solid ${C.border2}`,
              borderRadius:3, color:C.textDim, cursor:"pointer",
              fontFamily:mono, fontSize:10, transition:"all 0.12s",
            }}
            onMouseEnter={e=>{e.currentTarget.style.borderColor=C.teal;e.currentTarget.style.color=C.teal;}}
            onMouseLeave={e=>{e.currentTarget.style.borderColor=C.border2;e.currentTarget.style.color=C.textDim;}}
          >
            ↓ Export CSV
          </button>
        </div>
        <Grid headers={headers} rows={rows} max={8}/>
      </div>
    </div>
  );
}



export default MergeTab;
