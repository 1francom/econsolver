// ─── ECON STUDIO · components/wrangling/History.jsx ──────────────────────────
// Pipeline step sidebar. Displays the ordered list of applied steps with
// remove buttons. Isolated here so persistence logic (IndexedDB, undo/redo,
// step reordering) can be added without touching other tab files.
//
// Props:
//   pipeline  — step[]
//   onRm(i)   — remove step at index i
//   onClear() — clear all steps

import { C, mono, Lbl } from "./shared.jsx";

// ── Step type → accent color ──────────────────────────────────────────────────
const TYPE_COLOR = {
  recode:C.teal, quickclean:C.teal, winz:C.orange, log:C.blue, sq:C.blue,
  std:C.blue, drop:C.red, filter:C.yellow, ai_tr:C.purple, dummy:C.green,
  did:C.gold, lag:C.orange, lead:C.orange, diff:C.orange, ix:C.blue,
  date_parse:C.gold, date_extract:C.violet, join:C.teal, append:C.violet,
  mutate:C.green, pivot_longer:C.teal, group_summarize:C.orange,
  fill_na:C.yellow, fill_na_grouped:C.yellow,
  trim_outliers:C.red, flag_outliers:C.orange,
};

// ── Step type → short icon ────────────────────────────────────────────────────
const TYPE_ICON = {
  recode:"⬡", quickclean:"⚡", winz:"~", log:"ln", sq:"x²", std:"z",
  drop:"✕", filter:"⊧", ai_tr:"✦", dummy:"D", did:"×", lag:"L",
  lead:"F", diff:"Δ", ix:"×", rename:"↩", date_parse:"⟳", date_extract:"📅",
  join:"⊞", append:"⊕", mutate:"ƒ", pivot_longer:"⟲", group_summarize:"⊞",
  fill_na:"□", fill_na_grouped:"◈", trim_outliers:"✂", flag_outliers:"⚑",
};

 function History({ pipeline, onRm, onClear }) {
  if (!pipeline.length) return null;

  return (
    <div style={{
      width:230, flexShrink:0,
      borderLeft:`1px solid ${C.border}`,
      background:C.surface, overflowY:"auto", padding:"1rem",
    }}>
      <div style={{display:"flex",alignItems:"center",marginBottom:"0.8rem",gap:6}}>
        <Lbl mb={0}>Pipeline</Lbl>
        <button
          onClick={onClear}
          style={{marginLeft:"auto",fontSize:9,background:"transparent",border:"none",
            color:C.textMuted,cursor:"pointer",fontFamily:mono,padding:"2px 4px"}}>
          clear all
        </button>
      </div>

      <div style={{display:"flex",flexDirection:"column",gap:1}}>
        {pipeline.map((s, i) => {
          const col = TYPE_COLOR[s.type] || C.textMuted;
          const ico = TYPE_ICON[s.type]  || "·";
          return (
            <div key={s.id || i} style={{
              display:"flex", alignItems:"center", gap:4,
              padding:"0.35rem 0.5rem",
              background:C.surface2, borderRadius:3,
              border:`1px solid ${C.border}`,
              borderLeft:`2px solid ${col}`,
            }}>
              <span style={{fontSize:8,color:col,fontFamily:mono,
                flexShrink:0,minWidth:14,textAlign:"center"}}>
                {ico}
              </span>
              <span style={{flex:1,fontSize:10,color:C.textDim,fontFamily:mono,
                overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}}>
                {s.desc || s.type}
              </span>
              <button
                onClick={() => onRm(i)}
                style={{background:"transparent",border:"none",color:C.textMuted,
                  cursor:"pointer",fontSize:11,padding:"0 2px",flexShrink:0}}>
                ×
              </button>
            </div>
          );
        })}
      </div>
    </div>
  );
}

export default History;
