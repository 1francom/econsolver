// ─── ECON STUDIO · components/wrangling/MergeTab.jsx ───────────────────────
import { useState, useMemo } from "react";
import { C, mono, Lbl, Tabs, Btn } from "./shared.jsx";

// ─── MERGE TAB ───────────────────────────────────────────────────────────────
// JOIN and APPEND operations against other loaded datasets.
// RHS always uses raw (pre-pipeline) data of the referenced dataset.
function MergeTab({ rows, headers, filename, allDatasets, onAdd }) {
  const [subTab, setSubTab]       = useState("join");
  // JOIN state
  const [rightId, setRightId]     = useState("");
  const [leftKey, setLeftKey]     = useState("");
  const [rightKey, setRightKey]   = useState("");
  const [how, setHow]             = useState("left");
  const [suffix, setSuffix]       = useState("_r");
  // APPEND state
  const [appendId, setAppendId]   = useState("");

  const rightDs   = allDatasets.find(d => d.id === rightId);
  const appendDs  = allDatasets.find(d => d.id === appendId);
  const rightHdrs = rightDs?.rawData?.headers || [];

  const matchPreview = useMemo(() => {
    if (!rightDs || !leftKey || !rightKey) return null;
    const rKeys = new Set(rightDs.rawData.rows.map(r => String(r[rightKey] ?? "")));
    let matched = 0, keyNulls = 0;
    rows.forEach(r => {
      const v = r[leftKey];
      if (v === null || v === undefined) { keyNulls++; return; }
      if (rKeys.has(String(v))) matched++;
    });
    const validRows = rows.length - keyNulls;
    const pct = validRows ? matched / validRows : 0;
    return { matched, total: rows.length, validRows, keyNulls, pct };
  }, [rightDs, leftKey, rightKey, rows]);

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

  function doJoin() {
    if (!rightId || !leftKey || !rightKey) return;
    onAdd({ type:"join", rightId, leftKey, rightKey, how, suffix,
      desc:`${how.toUpperCase()} JOIN ${rightDs?.filename} on ${leftKey} = ${rightKey}` });
    setRightId(""); setLeftKey(""); setRightKey("");
  }
  function doAppend() {
    if (!appendId) return;
    onAdd({ type:"append", rightId:appendId,
      desc:`APPEND ${appendDs?.filename} (+${appendDs?.rawData?.rows?.length} rows)` });
    setAppendId("");
  }

  const colBtnStyle = (sel, color) => ({
    padding:"0.28rem 0.55rem", border:`1px solid ${sel?color:C.border}`,
    background:sel?`${color}18`:"transparent", color:sel?color:C.textDim,
    borderRadius:2, cursor:"pointer", fontSize:10, fontFamily:mono,
    textAlign:"left", transition:"all 0.1s",
  });
  const joinTypBtn = (k,l) => (
    <button key={k} onClick={()=>setHow(k)}
      style={{padding:"0.32rem 0.75rem",border:`1px solid ${how===k?C.teal:C.border2}`,
        background:how===k?`${C.teal}18`:"transparent",color:how===k?C.teal:C.textDim,
        borderRadius:3,cursor:"pointer",fontSize:11,fontFamily:mono,transition:"all 0.1s"}}>
      {how===k?"✓ ":""}{l}
    </button>
  );

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
      <Tabs tabs={[["join","⊞ Join"],["append","⊕ Append"]]} active={subTab} set={setSubTab} accent={C.teal} sm/>

      {/* ════════════ JOIN ════════════ */}
      {subTab==="join" && (
        <div>
          {/* Context note */}
          <div style={{padding:"0.55rem 0.9rem",background:C.surface,border:`1px solid ${C.border}`,
            borderLeft:`3px solid ${C.blue}`,borderRadius:4,marginBottom:"1.2rem",
            fontSize:10,color:C.textMuted,fontFamily:mono,lineHeight:1.6}}>
            Equivalent to dplyr's <span style={{color:C.blue}}>left_join()</span> / <span style={{color:C.blue}}>inner_join()</span>.
            The right dataset is joined against its <em>raw</em> (pre-pipeline) state.
            Apply cleaning to it first if needed.
          </div>

          {/* Right dataset picker */}
          <Lbl color={C.teal}>Right dataset</Lbl>
          <div style={{display:"flex",flexWrap:"wrap",gap:6,marginBottom:"1.4rem"}}>
            {allDatasets.map(d=>(
              <button key={d.id}
                onClick={()=>{ setRightId(d.id); setLeftKey(""); setRightKey(""); }}
                style={{padding:"0.4rem 0.9rem",border:`1px solid ${rightId===d.id?C.teal:C.border2}`,
                  background:rightId===d.id?`${C.teal}18`:"transparent",
                  color:rightId===d.id?C.teal:C.textDim,borderRadius:3,cursor:"pointer",
                  fontSize:11,fontFamily:mono,transition:"all 0.1s"}}>
                {rightId===d.id?"✓ ":""}{d.filename}
                <span style={{fontSize:9,color:C.textMuted,marginLeft:6}}>
                  {d.rawData.rows.length.toLocaleString()}×{d.rawData.headers.length}
                </span>
              </button>
            ))}
          </div>

          {rightDs && (<>
            {/* Key column selectors — two-column grid */}
            <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:"1.2rem",marginBottom:"1.2rem"}}>
              <div>
                <Lbl color={C.gold}>Left key — this dataset</Lbl>
                <div style={{display:"flex",flexDirection:"column",gap:3,maxHeight:180,overflowY:"auto",
                  padding:"0.4rem",background:C.surface2,border:`1px solid ${C.border}`,borderRadius:3}}>
                  {headers.map(h=>(
                    <button key={h} onClick={()=>setLeftKey(h)} style={colBtnStyle(leftKey===h,C.gold)}>
                      {leftKey===h?"✓ ":""}{h}
                    </button>
                  ))}
                </div>
              </div>
              <div>
                <Lbl color={C.blue}>Right key — {rightDs.filename}</Lbl>
                <div style={{display:"flex",flexDirection:"column",gap:3,maxHeight:180,overflowY:"auto",
                  padding:"0.4rem",background:C.surface2,border:`1px solid ${C.border}`,borderRadius:3}}>
                  {rightHdrs.map(h=>(
                    <button key={h} onClick={()=>setRightKey(h)} style={colBtnStyle(rightKey===h,C.blue)}>
                      {rightKey===h?"✓ ":""}{h}
                    </button>
                  ))}
                </div>
              </div>
            </div>

            {/* Match preview bar */}
            {matchPreview && (() => {
              const mc = matchPreview.pct > 0.8 ? C.green : matchPreview.pct > 0.4 ? C.yellow : C.red;
              return (
                <div style={{padding:"0.65rem 0.9rem",background:C.surface,
                  border:`1px solid ${mc}30`,borderLeft:`3px solid ${mc}`,
                  borderRadius:4,marginBottom:"1.2rem"}}>
                  <div style={{display:"flex",alignItems:"center",gap:10,marginBottom:4}}>
                    <div style={{flex:1,height:4,background:C.border,borderRadius:2,overflow:"hidden"}}>
                      <div style={{width:`${matchPreview.pct*100}%`,height:"100%",background:mc,borderRadius:2,transition:"width 0.3s"}}/>
                    </div>
                    <span style={{fontSize:11,color:mc,fontFamily:mono,flexShrink:0}}>
                      {(matchPreview.pct*100).toFixed(1)}%
                    </span>
                  </div>
                  <div style={{fontSize:11,color:C.textDim,fontFamily:mono}}>
                    <span style={{color:mc}}>{matchPreview.matched.toLocaleString()}</span>
                    {" of "}{matchPreview.validRows.toLocaleString()} left rows matched
                  </div>
                  {matchPreview.keyNulls > 0 && (
                    <div style={{fontSize:10,color:C.orange,fontFamily:mono,marginTop:4}}>
                      ⚠ {matchPreview.keyNulls} row{matchPreview.keyNulls!==1?"s":""} have null in key column '{leftKey}' — excluded from join, kept with null right-side values in LEFT JOIN.
                    </div>
                  )}
                  {matchPreview.pct < 0.5 && (
                    <div style={{fontSize:10,color:C.yellow,fontFamily:mono,marginTop:4}}>
                      ⚠ Low match rate — verify key columns use compatible formats (e.g. "DEU" vs "Germany").
                    </div>
                  )}
                </div>
              );
            })()}

            {/* Join type + suffix */}
            <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:"1.2rem",marginBottom:"1.2rem"}}>
              <div>
                <Lbl color={C.teal}>Join type</Lbl>
                <div style={{display:"flex",gap:4}}>
                  {[["left","LEFT"],["inner","INNER"]].map(([k,l])=>joinTypBtn(k,l))}
                </div>
                <div style={{fontSize:9,color:C.textMuted,fontFamily:mono,marginTop:5,lineHeight:1.5}}>
                  {how==="left"
                    ? "Keep all left rows. Right columns = null when unmatched."
                    : "Keep only rows that matched on both sides."}
                </div>
              </div>
              <div>
                <Lbl color={C.textDim}>Suffix for column conflicts</Lbl>
                <input value={suffix} onChange={e=>setSuffix(e.target.value)} placeholder="_r"
                  style={{width:"100%",boxSizing:"border-box",padding:"0.38rem 0.6rem",
                    background:C.surface2,border:`1px solid ${C.border2}`,borderRadius:3,
                    color:C.text,fontFamily:mono,fontSize:11,outline:"none"}}/>
                <div style={{fontSize:9,color:C.textMuted,fontFamily:mono,marginTop:4}}>
                  Added to right columns whose name already exists in left.
                </div>
              </div>
            </div>

            {/* Formula preview */}
            {leftKey && rightKey && (
              <div style={{padding:"0.48rem 0.75rem",background:C.surface,border:`1px solid ${C.border}`,
                borderRadius:3,marginBottom:"1rem",fontSize:11,color:C.textDim,fontFamily:mono}}>
                <span style={{color:C.gold}}>this</span> {how.toUpperCase()} JOIN{" "}
                <span style={{color:C.teal}}>{rightDs.filename}</span>
                {" ON "}<span style={{color:C.gold}}>{leftKey}</span>
                {" = "}<span style={{color:C.teal}}>{rightKey}</span>
                {" → "}<span style={{color:C.green}}>
                  +{rightHdrs.filter(h=>h!==rightKey).length} columns
                </span>
              </div>
            )}
            <Btn onClick={doJoin} color={C.teal} v="solid"
              dis={!leftKey||!rightKey}
              ch={`Add ${how.toUpperCase()} JOIN to pipeline →`}/>
          </>)}
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
