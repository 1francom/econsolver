// ─── ECON STUDIO · components/wrangling/MergeTab.jsx ───────────────────────
import { useState, useMemo } from "react";
import { useTheme, Lbl, Collapsible, Btn } from "./shared.jsx";
import { applyStep } from "../../pipeline/runner.js";

const emptyJoin = () => ({ rightId:"", leftKey:"", rightKey:"", how:"left", suffix:"_r" });

// ─── MERGE TAB ───────────────────────────────────────────────────────────────
// JOIN and APPEND operations against other loaded datasets.
// RHS uses the CLEANED (post-pipeline) data of the referenced dataset — that is
// what runner.js joins against (WranglingModule's buildDatasetContext replays
// each right dataset's own pipeline first). This comment used to claim "raw
// (pre-pipeline)", which described the PREVIEW's bug rather than the behaviour.
function MergeTab({ rows, headers, filename, allDatasets, onAdd, joinContext = null }) {
  const { C, T } = useTheme();
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
      for (const h of rightOf(sj.rightId).headers) {
        if (h === sj.rightKey) continue;
        const dest = next.includes(h) ? `${h}${sj.suffix || "_r"}` : h;
        if (!next.includes(dest)) next.push(dest);
      }
      chain.push(next);
    }
    return chain; // chain[i] = headers available as left side for staged join i
  }, [joins, headers, allDatasets]);

  // Context object for applyStep. Prefer the CLEANED right side supplied by
  // WranglingModule (buildDatasetContext replays each right dataset's pipeline) —
  // that is what the real join runs against. Falling back to raw would make the
  // preview report matches against data the join never sees.
  const joinCtx = useMemo(() => {
    if (joinContext?.datasets && Object.keys(joinContext.datasets).length) return joinContext;
    const datasets = {};
    allDatasets.forEach(d => { datasets[d.id] = { rows: d.rawData.rows, headers: d.rawData.headers }; });
    return { datasets };
  }, [joinContext, allDatasets]);

  // Resolve one right dataset, cleaned when available, raw otherwise. The
  // context is built lazily from `referencedDatasetIds(pipeline)`, so a dataset
  // the user has only just picked in this panel is not in it yet.
  const rightOf = (id) => {
    if (joinCtx.datasets[id]) return joinCtx.datasets[id];
    const d = allDatasets.find(x => x.id === id);
    return d ? { rows: d.rawData.rows, headers: d.rawData.headers } : { rows: [], headers: [] };
  };

  // Match preview for every staged join — materializes the row chain through prior
  // joins (via applyStep) so join 2+ can report a real match % too, not just join 0.
  const matchPreviews = useMemo(() => {
    const previews = [];
    let curRows = rows;
    for (let i = 0; i < joins.length; i++) {
      const j = joins[i];
      const r = allDatasets.find(d => d.id === j.rightId);
      if (!r || !j.leftKey || !j.rightKey) { previews.push(null); break; }
      const rRows = rightOf(j.rightId).rows;
      const rKeys = new Set(rRows.map(rr => String(rr[j.rightKey] ?? "")));
      let matched = 0, keyNulls = 0;
      curRows.forEach(row => {
        const v = row[j.leftKey];
        if (v === null || v === undefined) { keyNulls++; return; }
        if (rKeys.has(String(v))) matched++;
      });
      const validRows = curRows.length - keyNulls;
      // Cardinality of the right side per key — this is what decides whether the
      // join expands. "100% matched" says nothing about the OUTPUT row count,
      // which is the number that surprised people: a 20-row metadata table
      // joined onto a 200-row panel reads 100% and returns 200, not 20.
      const rightCounts = new Map();
      rRows.forEach(rr => {
        const k = String(rr[j.rightKey] ?? "");
        rightCounts.set(k, (rightCounts.get(k) ?? 0) + 1);
      });
      let maxPerKey = 0;
      rightCounts.forEach(n => { if (n > maxPerKey) maxPerKey = n; });
      const noCols = j.how === "semi" || j.how === "anti";
      let outRows = 0;
      curRows.forEach(row => {
        const n = rightCounts.get(String(row[j.leftKey] ?? "")) ?? 0;
        if (noCols) outRows += (j.how === "semi" ? (n > 0 ? 1 : 0) : (n > 0 ? 0 : 1));
        else outRows += n > 0 ? n : ((j.how === "left" || j.how === "full") ? 1 : 0);
      });
      previews.push({ matched, total: curRows.length, validRows, keyNulls,
                       pct: validRows ? matched / validRows : 0,
                       maxPerKey: noCols ? 0 : maxPerKey, outRows });
      // Materialize this join's output so the NEXT staged join previews against real rows.
      if (i < joins.length - 1) {
        if (j.how === "semi" || j.how === "anti") {
          curRows = curRows.filter(row => {
            const v = row[j.leftKey];
            const has = v !== null && v !== undefined && rKeys.has(String(v));
            return j.how === "semi" ? has : !has;
          });
        } else {
          curRows = applyStep(curRows, headerChain[i] || headers, { ...j, type: "join" }, joinCtx).rows;
        }
      }
    }
    return previews;
  }, [joins, allDatasets, rows, headerChain, headers, joinCtx]);

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
    borderRadius:2, cursor:"pointer", fontSize: T.caption.fontSize, fontFamily: T.code.fontFamily,
    textAlign:"left", transition:"all 0.1s",
  });

  // ── Empty state — no other datasets loaded ──
  if (!allDatasets.length) {
    return (
      <div>
      <Lbl color={C.blue}>Merge &amp; append</Lbl>
      <div style={{padding:"2.5rem 1.5rem",textAlign:"center",border:`1px dashed ${C.border2}`,borderRadius:4}}>
        <div style={{fontSize: T.display.fontSize,marginBottom:10}}>⊞</div>
        <div style={{fontSize: T.code.fontSize,color:C.textDim,lineHeight:1.8,fontFamily: T.code.fontFamily}}>
          No other datasets loaded.<br/>
          Use the <span style={{color:C.teal}}>Dataset Manager</span> sidebar
          to load a second file — then join or append it here.
        </div>
      </div>
      </div>
    );
  }

  return (
    <div>
      {/* ════════════ JOIN ════════════ */}
      <Collapsible title="Join" color={C.blue}>
      {(
        <div>
          {/* Context note */}
          <div style={{padding:"0.55rem 0.9rem",background:C.surface,border:`1px solid ${C.border}`,
            borderLeft:`3px solid ${C.blue}`,borderRadius:4,marginBottom:"1.2rem",
            fontSize: T.caption.fontSize,color:C.textMuted,fontFamily: T.code.fontFamily,lineHeight:1.6}}>
            Equivalent to dplyr's <span style={{color:C.blue}}>left_join()</span> / <span style={{color:C.blue}}>inner_join()</span>.
            Stage multiple joins below — they apply sequentially, so a later join can use
            a column added by an earlier one. Each right dataset is referenced in its
            <em> cleaned</em> state — its own pipeline runs first. A key with several
            matches on the right produces several rows, exactly as in dplyr; use
            <em> Attach lookup columns</em> when you want one row per left row.
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
                  <span style={{fontSize: T.caption.fontSize,color:C.teal,letterSpacing:"0.18em",
                    textTransform:"uppercase",fontFamily: T.code.fontFamily}}>Join {idx+1}</span>
                  <span style={{flex:1}}/>
                  {joins.length > 1 && (
                    <button onClick={()=>removeJoin(idx)}
                      style={{padding:"0.18rem 0.55rem",border:`1px solid ${C.border2}`,
                        background:"transparent",color:C.textMuted,borderRadius:3,
                        cursor:"pointer",fontSize: T.caption.fontSize,fontFamily: T.code.fontFamily}}
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
                        fontSize: T.code.fontSize,fontFamily: T.code.fontFamily,transition:"all 0.1s"}}>
                      {j.rightId===d.id?"✓ ":""}{d.filename}
                      <span style={{fontSize: T.caption.fontSize,color:C.textMuted,marginLeft:6}}>
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

                  {/* Match preview — materialized through the chain for every staged join */}
                  {matchPreviews[idx] && (() => {
                    const mp = matchPreviews[idx];
                    const mc = mp.pct > 0.8 ? C.green : mp.pct > 0.4 ? C.yellow : C.red;
                    return (
                      <div style={{padding:"0.55rem 0.8rem",background:C.surface2,
                        border:`1px solid ${mc}30`,borderLeft:`3px solid ${mc}`,
                        borderRadius:4,marginBottom:"1rem"}}>
                        <div style={{display:"flex",alignItems:"center",gap:10,marginBottom:4}}>
                          <div style={{flex:1,height:4,background:C.border,borderRadius:2,overflow:"hidden"}}>
                            <div style={{width:`${mp.pct*100}%`,height:"100%",background:mc,borderRadius:2,transition:"width 0.3s"}}/>
                          </div>
                          <span style={{fontSize: T.code.fontSize,color:mc,fontFamily: T.code.fontFamily,flexShrink:0}}>
                            {(mp.pct*100).toFixed(1)}%
                          </span>
                        </div>
                        <div style={{fontSize: T.code.fontSize,color:C.textDim,fontFamily: T.code.fontFamily}}>
                          <span style={{color:mc}}>{mp.matched.toLocaleString()}</span>
                          {" of "}{mp.validRows.toLocaleString()} left rows matched
                          {" · "}
                          <span style={{color:C.textMuted}}>result: {mp.outRows.toLocaleString()} rows</span>
                        </div>
                        {mp.maxPerKey > 1 && (
                          <div style={{fontSize: T.caption.fontSize,color:C.gold,fontFamily: T.code.fontFamily,marginTop:4}}>
                            1:m — right key '{j.rightKey}' has up to {mp.maxPerKey} rows per key, so matched
                            rows are duplicated (same as dplyr). Want one row per left row instead?
                            Use <b>Attach lookup columns</b>.
                          </div>
                        )}
                        {mp.keyNulls > 0 && (
                          <div style={{fontSize: T.caption.fontSize,color:C.orange,fontFamily: T.code.fontFamily,marginTop:4}}>
                            ⚠ {mp.keyNulls} row{mp.keyNulls!==1?"s":""} have null in key column '{j.leftKey}'.
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
                              borderRadius:3,cursor:"pointer",fontSize: T.code.fontSize,fontFamily: T.code.fontFamily}}>
                            {j.how===k?"✓ ":""}{l}
                          </button>
                        ))}
                      </div>
                    </div>
                    {noCols ? (
                      <div style={{fontSize: T.caption.fontSize,color:C.textMuted,fontFamily: T.code.fontFamily,alignSelf:"center"}}>
                        Filters rows only - no columns added.
                      </div>
                    ) : (
                      <div>
                        <Lbl color={C.textDim}>Suffix for column conflicts</Lbl>
                        <input value={j.suffix} onChange={e=>updateJoin(idx,{suffix:e.target.value})} placeholder="_r"
                          style={{width:"100%",boxSizing:"border-box",padding:"0.35rem 0.55rem",
                            background:C.surface2,border:`1px solid ${C.border2}`,borderRadius:3,
                            color:C.text,fontFamily: T.code.fontFamily,fontSize: T.code.fontSize,outline:"none"}}/>
                      </div>
                    )}
                  </div>

                  {/* Formula preview */}
                  {j.leftKey && j.rightKey && (
                    <div style={{padding:"0.42rem 0.7rem",background:C.surface2,border:`1px solid ${C.border}`,
                      borderRadius:3,fontSize: T.code.fontSize,color:C.textDim,fontFamily: T.code.fontFamily}}>
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
                cursor:"pointer",fontSize: T.code.fontSize,fontFamily: T.code.fontFamily}}>
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
      </Collapsible>
      <Collapsible title="Append rows" color={C.violet}>
      {(
        <div>
          <div style={{padding:"0.55rem 0.9rem",background:C.surface,border:`1px solid ${C.border}`,
            borderLeft:`3px solid ${C.violet}`,borderRadius:4,marginBottom:"1.2rem",
            fontSize: T.caption.fontSize,color:C.textMuted,fontFamily: T.code.fontFamily,lineHeight:1.6}}>
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
                  fontSize: T.code.fontSize,fontFamily: T.code.fontFamily,transition:"all 0.1s"}}>
                {appendId===d.id?"✓ ":""}{d.filename}
                <span style={{fontSize: T.caption.fontSize,color:C.textMuted,marginLeft:6}}>
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
                  <div style={{fontSize: T.h2.fontSize,color,fontFamily: T.code.fontFamily,marginBottom:3}}>{val}</div>
                  <div style={{fontSize: T.caption.fontSize,color:C.textMuted,fontFamily: T.code.fontFamily}}>{label}</div>
                </div>
              ))}
            </div>
            {appendPreview.onlyLeft > 0 || appendPreview.onlyRight > 0 ? (
              <div style={{padding:"0.5rem 0.75rem",background:`${C.yellow}08`,
                border:`1px solid ${C.yellow}30`,borderLeft:`3px solid ${C.yellow}`,
                borderRadius:4,marginBottom:"1rem",fontSize: T.caption.fontSize,color:C.textMuted,fontFamily: T.code.fontFamily,lineHeight:1.6}}>
                ⚠ Schema mismatch — {appendPreview.onlyLeft} column{appendPreview.onlyLeft!==1?"s":""} found
                only in left, {appendPreview.onlyRight} only in right.
                These will be filled with null for the rows that lack them.
              </div>
            ) : (
              <div style={{padding:"0.5rem 0.75rem",background:`${C.green}08`,
                border:`1px solid ${C.green}30`,borderLeft:`3px solid ${C.green}`,
                borderRadius:4,marginBottom:"1rem",fontSize: T.caption.fontSize,color:C.green,fontFamily: T.code.fontFamily}}>
                ✓ Schemas match exactly — clean append.
              </div>
            )}
            <div style={{padding:"0.48rem 0.75rem",background:C.surface,border:`1px solid ${C.border}`,
              borderRadius:3,marginBottom:"1rem",fontSize: T.code.fontSize,color:C.textDim,fontFamily: T.code.fontFamily}}>
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

      {/* ════════════ COMBINE ════════════ */}
      </Collapsible>
      <Collapsible title="Combine — set operations" color={C.gold}>
      {(
        <div>
          <div style={{padding:"0.55rem 0.9rem",background:C.surface,border:`1px solid ${C.border}`,
            borderLeft:`3px solid ${C.gold}`,borderRadius:4,marginBottom:"1.2rem",
            fontSize: T.caption.fontSize,color:C.textMuted,fontFamily: T.code.fontFamily,lineHeight:1.6}}>
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
                  borderRadius:3,cursor:"pointer",fontSize: T.code.fontSize,fontFamily: T.code.fontFamily}}>
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
                  borderRadius:3,cursor:"pointer",fontSize: T.code.fontSize,fontFamily: T.code.fontFamily}}>
                {combineId===d.id?"✓ ":""}{d.filename}
                <span style={{fontSize: T.caption.fontSize,color:C.textMuted,marginLeft:6}}>
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
                  borderRadius:3,color:C.text,fontFamily: T.code.fontFamily,fontSize: T.code.fontSize,outline:"none"}}/>
            </div>
          )}

          {combinePreview && (
            <div style={{padding:"0.55rem 0.8rem",background:C.surface2,border:`1px solid ${C.border}`,
              borderRadius:4,marginBottom:"1rem",fontSize: T.code.fontSize,color:C.textDim,fontFamily: T.code.fontFamily,lineHeight:1.6}}>
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
      </Collapsible>

    </div>
  );
}



export default MergeTab;
