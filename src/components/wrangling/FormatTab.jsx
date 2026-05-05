// ─── ECON STUDIO · components/wrangling/FormatTab.jsx ────────────────────────
// Three-tier formatting for numbers and strings.
//
// Tier 1 — Locale presets / quick options  (deterministic, one-click)
// Tier 2 — Manual rule builder             (strip / replace / cast)
// Tier 3 — AI Clean                        (Claude Haiku reads samples, writes JS)
//
// Numbers → extract_regex (locale preset) | ai_tr (manual/AI)
// Strings → clean_strings (quick)         | ai_tr (manual/AI)

import { useState, useMemo } from "react";
import { useTheme, mono, Lbl, Btn } from "./shared.jsx";
import { callAI } from "./utils.js";
import { detectNumberLocale, parseSmartNumber } from "../../pipeline/runner.js";

// ─── HELPERS ─────────────────────────────────────────────────────────────────

const LOCALE_PRESETS = [
  {
    id: "smart", label: "Smart (mixed)",
    desc: "Per-value detection — handles EU, space, and plain integers in the same column",
    locale: "smart",
  },
  {
    id: "auto",  label: "Auto-detect",
    desc: "Column-level vote: picks EU or US for the whole column",
    locale: "auto",
  },
  {
    id: "comma", label: "EU  (1.234,56)",
    desc: "Dot = thousands · Comma = decimal",
    locale: "comma",
  },
  {
    id: "dot",   label: "US  (1,234.56)",
    desc: "Comma = thousands · Dot = decimal",
    locale: "dot",
  },
  {
    id: "space", label: "Space (1 234 567)",
    desc: "Space = thousands separator",
    locale: "space",
  },
];

const STRIP_CHARS = [
  { id: "dot",    label: ".",  chars: "\\." },
  { id: "comma",  label: ",",  chars: "," },
  { id: "dollar", label: "$",  chars: "\\$" },
  { id: "euro",   label: "€",  chars: "€" },
  { id: "pound",  label: "£",  chars: "£" },
  { id: "pct",    label: "%",  chars: "%" },
  { id: "paren",  label: "()", chars: "[()]" },
  { id: "space",  label: "· space", chars: "\\s" },
];

function buildManualJS(strips, replaceFrom, replaceTo, castMode) {
  const lines = [];
  const stripRx = strips.map(c => c.chars).join("");
  if (stripRx) lines.push(`s = s.replace(/[${stripRx}]/g, '');`);
  if (replaceFrom) {
    const escaped = replaceFrom.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    lines.push(`s = s.replace(/${escaped}/g, ${JSON.stringify(replaceTo || "")});`);
  }
  if (castMode === "number") lines.push("const n = parseFloat(s); return isFinite(n) ? n : null;");
  else                        lines.push("return s.trim();");
  return `v => { if (v == null) return null; let s = String(v).trim(); ${lines.join(" ")} }`;
}

function applyManualPreview(raw, strips, replaceFrom, replaceTo, castMode) {
  try {
    // eslint-disable-next-line no-new-func
    const fn = new Function("v", `
      if (v == null) return null;
      let s = String(v).trim();
      ${strips.map(c => `s = s.replace(/[${c.chars}]/g, '');`).join("\n")}
      ${replaceFrom ? `s = s.replace(/${replaceFrom.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}/g, ${JSON.stringify(replaceTo || "")});` : ""}
      ${castMode === "number" ? "const n = parseFloat(s); return isFinite(n) ? n : null;" : "return s.trim();"}
    `);
    return fn(raw);
  } catch { return null; }
}

// ─── NUMBER FORMATTER ─────────────────────────────────────────────────────────
function NumberFormatter({ col, rows, onAdd }) {
  const { C } = useTheme();
  const [tier,         setTier]         = useState("preset");  // preset | manual | ai
  const [localeId,     setLocaleId]     = useState("smart");
  const [strips,       setStrips]       = useState([]);
  const [replaceFrom,  setReplaceFrom]  = useState("");
  const [replaceTo,    setReplaceTo]    = useState("");
  const [aiState,      setAiState]      = useState("idle");    // idle | loading | done | err
  const [aiResult,     setAiResult]     = useState(null);

  const samples = useMemo(() =>
    rows.map(r => r[col]).filter(v => v != null).slice(0, 8),
  [col, rows]);

  // Full column (up to 200 rows) used for success-count stats
  const allVals = useMemo(() =>
    rows.map(r => r[col]).filter(v => v != null),
  [rows, col]);

  // Tier 1 preview — 8 sample rows + parse success stats over the full column
  const presetPreview = useMemo(() => {
    const locale    = LOCALE_PRESETS.find(p => p.id === localeId)?.locale ?? "auto";
    const colLocale = locale === "auto" || locale === "smart"
      ? detectNumberLocale(samples)
      : locale === "comma" ? "EU" : "US";

    const parseVal = v => {
      if (locale === "space") return parseSmartNumber(String(v).trim().replace(/\s/g, ""), colLocale);
      return parseSmartNumber(String(v).trim(), colLocale);
    };

    const previewRows = samples.map(v => ({ raw: String(v), parsed: parseVal(v) }));

    // Success rate over the full column (not just 8 samples)
    const total  = allVals.length;
    const parsed = allVals.filter(v => parseVal(v) != null).length;

    return { rows: previewRows, total, parsed };
  }, [samples, allVals, localeId]);

  // Tier 2 preview
  const manualPreview = useMemo(() =>
    samples.map(v => ({
      raw: String(v),
      out: applyManualPreview(v, strips, replaceFrom, replaceTo, "number"),
    })),
  [samples, strips, replaceFrom, replaceTo]);

  function toggleStrip(s) {
    setStrips(prev =>
      prev.find(x => x.id === s.id) ? prev.filter(x => x.id !== s.id) : [...prev, s]
    );
  }

  async function runAI() {
    setAiState("loading"); setAiResult(null);
    const r = await callAI(
      "Parse these values as clean numbers. Strip any currency symbols, thousands separators, and handle both EU (comma decimal) and US (dot decimal) formats. Return null for unparseable values.",
      col, samples, "transform"
    );
    setAiResult(r); setAiState(r ? "done" : "err");
  }

  function apply() {
    if (tier === "preset") {
      const raw    = LOCALE_PRESETS.find(p => p.id === localeId)?.locale ?? "auto";
      const locale = raw === "smart" ? "auto" : raw; // "smart" uses the same auto path in runner
      onAdd({ type: "extract_regex", col, nn: col, locale,
              regex: "", desc: `Format numbers in '${col}' [${localeId}]` });
    } else if (tier === "manual") {
      const js = buildManualJS(strips, replaceFrom, replaceTo, "number");
      onAdd({ type: "ai_tr", col, js, desc: `Format numbers in '${col}' (manual rules)` });
    } else if (tier === "ai" && aiResult) {
      onAdd({ type: "ai_tr", col, js: aiResult.js,
              desc: `AI format: '${col}' — ${aiResult.description}` });
    }
  }

  const canApply = tier === "preset" ||
    (tier === "manual" && (strips.length > 0 || replaceFrom)) ||
    (tier === "ai" && aiResult);

  const tierBtn = (id, label) => (
    <button key={id} onClick={() => setTier(id)} style={{
      padding: "0.28rem 0.75rem",
      border: `1px solid ${tier === id ? C.teal : C.border2}`,
      background: tier === id ? `${C.teal}18` : "transparent",
      color: tier === id ? C.teal : C.textDim,
      borderRadius: 3, cursor: "pointer", fontSize: 10, fontFamily: mono,
    }}>{label}</button>
  );

  const inS = {
    padding: "0.38rem 0.6rem", background: C.surface2,
    border: `1px solid ${C.border2}`, borderRadius: 3, color: C.text,
    fontFamily: mono, fontSize: 11, outline: "none",
  };

  return (
    <div>
      {/* Tier selector */}
      <div style={{ display: "flex", gap: 4, marginBottom: "1rem" }}>
        {tierBtn("preset", "Locale preset")}
        {tierBtn("manual", "Manual rules")}
        {tierBtn("ai",     "✦ AI clean")}
      </div>

      {/* ── Tier 1: Locale preset ── */}
      {tier === "preset" && (
        <div>
          <div style={{ display: "flex", flexWrap: "wrap", gap: 6, marginBottom: "1rem" }}>
            {LOCALE_PRESETS.map(p => (
              <button key={p.id} onClick={() => setLocaleId(p.id)} style={{
                padding: "0.4rem 0.85rem", textAlign: "left",
                border: `1px solid ${localeId === p.id ? C.teal : C.border2}`,
                background: localeId === p.id ? `${C.teal}14` : C.surface2,
                color: localeId === p.id ? C.teal : C.textDim,
                borderRadius: 4, cursor: "pointer", fontSize: 11, fontFamily: mono,
              }}>
                <div style={{ fontWeight: 600 }}>{p.label}</div>
                <div style={{ fontSize: 9, color: C.textMuted, marginTop: 2 }}>{p.desc}</div>
              </button>
            ))}
          </div>
          {/* Success rate bar */}
          <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: "0.7rem" }}>
            <div style={{ flex: 1, height: 5, background: C.border, borderRadius: 3, overflow: "hidden" }}>
              <div style={{
                width: `${presetPreview.total ? (presetPreview.parsed / presetPreview.total * 100) : 0}%`,
                height: "100%",
                background: presetPreview.parsed === presetPreview.total ? C.teal : C.gold,
                borderRadius: 3, transition: "width 0.2s",
              }} />
            </div>
            <span style={{ fontSize: 10, fontFamily: mono, color: C.textMuted, whiteSpace: "nowrap" }}>
              {presetPreview.parsed}/{presetPreview.total} parsed
            </span>
          </div>
          <PreviewTable rows={presetPreview.rows.map(r => ({ raw: r.raw, out: r.parsed == null ? "null ✗" : String(r.parsed) }))} C={C} />
        </div>
      )}

      {/* ── Tier 2: Manual rules ── */}
      {tier === "manual" && (
        <div>
          <Lbl color={C.teal} mb={6}>Strip characters</Lbl>
          <div style={{ display: "flex", flexWrap: "wrap", gap: 5, marginBottom: "1rem" }}>
            {STRIP_CHARS.map(sc => {
              const on = !!strips.find(x => x.id === sc.id);
              return (
                <button key={sc.id} onClick={() => toggleStrip(sc)} style={{
                  padding: "0.25rem 0.65rem",
                  border: `1px solid ${on ? C.gold : C.border2}`,
                  background: on ? `${C.gold}18` : "transparent",
                  color: on ? C.gold : C.textDim,
                  borderRadius: 3, cursor: "pointer", fontSize: 11, fontFamily: mono,
                }}>{sc.label}</button>
              );
            })}
          </div>
          <Lbl color={C.teal} mb={6}>Replace (gsub)</Lbl>
          <div style={{ display: "flex", gap: 8, alignItems: "center", marginBottom: "1rem" }}>
            <input value={replaceFrom} onChange={e => setReplaceFrom(e.target.value)}
              placeholder='Find (e.g. ",")'
              style={{ ...inS, width: 120 }} />
            <span style={{ color: C.textMuted, fontFamily: mono }}>→</span>
            <input value={replaceTo} onChange={e => setReplaceTo(e.target.value)}
              placeholder='Replace with'
              style={{ ...inS, width: 120 }} />
          </div>
          <PreviewTable rows={manualPreview.map(r => ({ raw: r.raw, out: r.out == null ? "null ✗" : String(r.out) }))} C={C} />
        </div>
      )}

      {/* ── Tier 3: AI clean ── */}
      {tier === "ai" && (
        <div>
          <div style={{
            fontSize: 11, color: C.textDim, fontFamily: mono, lineHeight: 1.65,
            padding: "0.6rem 0.85rem", background: `${C.purple}08`,
            border: `1px solid ${C.purple}20`, borderRadius: 4, marginBottom: "1rem",
          }}>
            Claude Haiku analyzes your sample values and writes a JS transform to parse them correctly.
            Works on exotic formats: <span style={{ color: C.gold }}>"$1.2M"</span>,{" "}
            <span style={{ color: C.gold }}>"(3.450)"</span>,{" "}
            <span style={{ color: C.gold }}>"1,5 Mio."</span>
          </div>
          <Lbl color={C.textMuted} mb={6}>Sample values Claude will see</Lbl>
          <div style={{
            padding: "0.5rem 0.75rem", background: C.surface2, borderRadius: 3,
            border: `1px solid ${C.border}`, marginBottom: "1rem",
            fontSize: 11, fontFamily: mono, color: C.textDim, lineHeight: 1.8,
          }}>
            {samples.map((v, i) => <span key={i} style={{ marginRight: 12 }}>{String(v)}</span>)}
          </div>
          <Btn onClick={runAI} color={C.purple} v="solid"
            dis={aiState === "loading"}
            ch={aiState === "loading" ? "Analyzing…" : "✦ Ask Claude"} />
          {aiState === "done" && aiResult && (
            <div style={{ marginTop: "0.9rem", padding: "0.6rem 0.85rem", background: `${C.purple}08`, border: `1px solid ${C.purple}30`, borderRadius: 4 }}>
              <div style={{ fontSize: 11, color: C.purple, fontFamily: mono, marginBottom: 6 }}>
                ✦ {aiResult.description}
              </div>
              <div style={{ fontSize: 10, color: C.textMuted, fontFamily: mono }}>
                Preview: {aiResult.preview?.slice(0, 5).join(" · ") || "—"}
              </div>
            </div>
          )}
          {aiState === "err" && (
            <div style={{ fontSize: 11, color: C.red, fontFamily: mono, marginTop: 8 }}>
              AI unavailable. Check connection or API key.
            </div>
          )}
        </div>
      )}

      {/* Apply */}
      {canApply && (
        <div style={{ marginTop: "1rem", display: "flex", gap: 8, alignItems: "center" }}>
          <Btn onClick={apply} color={C.teal} v="solid" ch={`Apply to '${col}'`} />
          <span style={{ fontSize: 10, color: C.textMuted, fontFamily: mono }}>
            Writes result back to the same column
          </span>
        </div>
      )}
    </div>
  );
}

// ─── STRING FORMATTER ─────────────────────────────────────────────────────────
function StringFormatter({ col, rows, onAdd }) {
  const { C } = useTheme();
  const [tier,        setTier]        = useState("quick");
  const [opts,        setOpts]        = useState({ stripPunct: true, normSep: false, ocrNoise: false, midWordSep: false, case: "title" });
  const [replaceFrom, setReplaceFrom] = useState("");
  const [replaceTo,   setReplaceTo]   = useState("");
  const [aiState,     setAiState]     = useState("idle");
  const [aiResult,    setAiResult]    = useState(null);

  const samples = useMemo(() =>
    rows.map(r => r[col]).filter(v => v != null).slice(0, 8),
  [col, rows]);

  const quickPreview = useMemo(() =>
    samples.map(v => {
      let s = String(v).trim().replace(/\s+/g, " ");
      if (opts.ocrNoise) {
        s = s.replace(/(?<=[a-zA-Z])\s*@\s*(?=[a-zA-Z])/g, "a");
        s = s.replace(/(?<=[a-zA-Z])3+/g, m => "e".repeat(m.length));
        s = s.replace(/(?<=[a-zA-Z])0+/g, m => "o".repeat(m.length));
        s = s.replace(/(?<=[a-zA-Z])1+/g, m => "i".repeat(m.length));
        s = s.replace(/(?<=[a-zA-Z])\|+/g, m => "l".repeat(m.length));
        s = s.replace(/(?<=[a-zA-Z])\$+/g, m => "s".repeat(m.length));
        s = s.replace(/(?<=[a-zA-Z])!+/g, m => "i".repeat(m.length));
      }
      if (opts.midWordSep) {
        s = s.replace(/(?<=[a-zA-Z])[.\-_]+(?=[a-zA-Z])/g, "");
        s = s.replace(/(?<=[a-zA-Z]) (?=[a-zA-Z])/g, (_, offset, str) => {
          const spaceCount = (str.match(/ /g) || []).length;
          return spaceCount === 1 ? "" : " ";
        });
      }
      if (opts.normSep)    s = s.replace(/\s*[-–,]\s*/g, " ").trim();
      if (opts.stripPunct) s = s.replace(/[.,\-–]+$/, "").trim();
      if      (opts.case === "lower") s = s.toLowerCase();
      else if (opts.case === "upper") s = s.toUpperCase();
      else if (opts.case === "title") s = s.replace(/\w\S*/g, w => w[0].toUpperCase() + w.slice(1).toLowerCase());
      return { raw: String(v), out: s };
    }),
  [samples, opts]);

  // For manual rules, prioritize rows that match replaceFrom so the preview is meaningful
  const manualSamples = useMemo(() => {
    if (!replaceFrom) return samples;
    try {
      const rx = new RegExp(replaceFrom.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"));
      const allVals = rows.map(r => r[col]).filter(v => v != null);
      const hits    = allVals.filter(v => rx.test(String(v)));
      const rest    = allVals.filter(v => !rx.test(String(v)));
      return [...hits, ...rest].slice(0, 8);
    } catch { return samples; }
  }, [rows, col, replaceFrom, samples]);

  const manualPreview = useMemo(() =>
    manualSamples.map(v => ({
      raw: String(v),
      out: applyManualPreview(v, [], replaceFrom, replaceTo, "string"),
    })),
  [manualSamples, replaceFrom, replaceTo]);

  async function runAI() {
    setAiState("loading"); setAiResult(null);
    const r = await callAI(
      "Normalize these string values. Fix casing, strip trailing punctuation, remove extra spaces, normalize separators to single spaces. Also detect and fix OCR/scan artifacts: special characters used as letters (@ → a, 0 → o, 1 → i, | → l), dots or spaces inserted mid-word (Cla.ude → Claude, Cla ude → Claude), and canonicalize corrupted variants to the most common clean form found in the sample.",
      col, samples, "transform"
    );
    setAiResult(r); setAiState(r ? "done" : "err");
  }

  function apply() {
    if (tier === "quick") {
      onAdd({ type: "clean_strings", col, ...opts,
              desc: `Format strings in '${col}'` });
    } else if (tier === "manual" && replaceFrom) {
      const js = buildManualJS([], replaceFrom, replaceTo, "string");
      onAdd({ type: "ai_tr", col, js, desc: `Format strings in '${col}' (gsub)` });
    } else if (tier === "ai" && aiResult) {
      onAdd({ type: "ai_tr", col, js: aiResult.js,
              desc: `AI format: '${col}' — ${aiResult.description}` });
    }
  }

  const canApply = tier === "quick" ||
    (tier === "manual" && replaceFrom) ||
    (tier === "ai" && aiResult);

  const tierBtn = (id, label) => (
    <button key={id} onClick={() => setTier(id)} style={{
      padding: "0.28rem 0.75rem",
      border: `1px solid ${tier === id ? C.gold : C.border2}`,
      background: tier === id ? `${C.gold}18` : "transparent",
      color: tier === id ? C.gold : C.textDim,
      borderRadius: 3, cursor: "pointer", fontSize: 10, fontFamily: mono,
    }}>{label}</button>
  );

  const inS = {
    padding: "0.38rem 0.6rem", background: C.surface2,
    border: `1px solid ${C.border2}`, borderRadius: 3, color: C.text,
    fontFamily: mono, fontSize: 11, outline: "none",
  };

  return (
    <div>
      <div style={{ display: "flex", gap: 4, marginBottom: "1rem" }}>
        {tierBtn("quick",  "Quick options")}
        {tierBtn("manual", "Manual rules")}
        {tierBtn("ai",     "✦ AI clean")}
      </div>

      {/* ── Tier 1: Quick options ── */}
      {tier === "quick" && (
        <div>
          <div style={{ display: "flex", flexWrap: "wrap", gap: 10, marginBottom: "0.9rem", alignItems: "center" }}>
            {[["stripPunct", "Strip trailing punct  . , - –"],
              ["normSep",    "Normalize separators  (- , → space)"],
              ["midWordSep", "Remove mid-word separators  (Cla.ude → Claude)"],
              ["ocrNoise",   "Fix OCR/leet noise  (3 → e, @ → a, 0 → o, 1 → i, | → l)"],
            ].map(([k, l]) => (
              <label key={k} style={{ display: "flex", alignItems: "center", gap: 5, fontSize: 11, fontFamily: mono, color: C.textDim, cursor: "pointer" }}>
                <input type="checkbox" checked={!!opts[k]}
                  onChange={e => setOpts(o => ({ ...o, [k]: e.target.checked }))}
                  style={{ accentColor: C.gold }} />
                {l}
              </label>
            ))}
            <select value={opts.case} onChange={e => setOpts(o => ({ ...o, case: e.target.value }))}
              style={{ padding: "0.28rem 0.55rem", background: C.surface2, border: `1px solid ${C.border2}`, borderRadius: 3, color: C.textDim, fontFamily: mono, fontSize: 11 }}>
              {[["keep","Keep case"],["lower","lowercase"],["upper","UPPERCASE"],["title","Title Case"]].map(([v,l]) => (
                <option key={v} value={v}>{l}</option>
              ))}
            </select>
          </div>
          <PreviewTable rows={quickPreview} C={C} />
        </div>
      )}

      {/* ── Tier 2: Manual gsub ── */}
      {tier === "manual" && (
        <div>
          <Lbl color={C.gold} mb={6}>gsub — find &amp; replace (all occurrences)</Lbl>
          <div style={{ display: "flex", gap: 8, alignItems: "center", marginBottom: "1rem" }}>
            <input value={replaceFrom} onChange={e => setReplaceFrom(e.target.value)}
              placeholder='Pattern (e.g. "-")'
              style={{ ...inS, width: 140 }} />
            <span style={{ color: C.textMuted, fontFamily: mono }}>→</span>
            <input value={replaceTo} onChange={e => setReplaceTo(e.target.value)}
              placeholder='Replacement (empty = delete)'
              style={{ ...inS, flex: 1 }} />
          </div>
          <PreviewTable rows={manualPreview.map(r => ({ raw: r.raw, out: r.out == null ? "null" : String(r.out) }))} C={C} />
        </div>
      )}

      {/* ── Tier 3: AI clean ── */}
      {tier === "ai" && (
        <div>
          <div style={{
            fontSize: 11, color: C.textDim, fontFamily: mono, lineHeight: 1.65,
            padding: "0.6rem 0.85rem", background: `${C.purple}08`,
            border: `1px solid ${C.purple}20`, borderRadius: 4, marginBottom: "1rem",
          }}>
            Claude Haiku sees your sample strings and writes a JS transform to normalize them.
            Best for mixed-case, contaminated text, unusual separators, and OCR corruption
            (e.g. <span style={{ color: C.gold }}>"Cl@de"</span>,{" "}
            <span style={{ color: C.gold }}>"Cla ude"</span>,{" "}
            <span style={{ color: C.gold }}>"Cla.ude"</span> → "Claude").
          </div>
          <div style={{
            padding: "0.5rem 0.75rem", background: C.surface2, borderRadius: 3,
            border: `1px solid ${C.border}`, marginBottom: "1rem",
            fontSize: 11, fontFamily: mono, color: C.textDim, lineHeight: 1.8,
          }}>
            {samples.map((v, i) => <span key={i} style={{ marginRight: 12 }}>"{String(v)}"</span>)}
          </div>
          <Btn onClick={runAI} color={C.purple} v="solid"
            dis={aiState === "loading"}
            ch={aiState === "loading" ? "Analyzing…" : "✦ Ask Claude"} />
          {aiState === "done" && aiResult && (
            <div style={{ marginTop: "0.9rem", padding: "0.6rem 0.85rem", background: `${C.purple}08`, border: `1px solid ${C.purple}30`, borderRadius: 4 }}>
              <div style={{ fontSize: 11, color: C.purple, fontFamily: mono, marginBottom: 6 }}>
                ✦ {aiResult.description}
              </div>
              <div style={{ fontSize: 10, color: C.textMuted, fontFamily: mono }}>
                Preview: {aiResult.preview?.slice(0, 5).join(" · ") || "—"}
              </div>
            </div>
          )}
          {aiState === "err" && (
            <div style={{ fontSize: 11, color: C.red, fontFamily: mono, marginTop: 8 }}>
              AI unavailable. Check connection or API key.
            </div>
          )}
        </div>
      )}

      {canApply && (
        <div style={{ marginTop: "1rem", display: "flex", gap: 8, alignItems: "center" }}>
          <Btn onClick={apply} color={C.gold} v="solid" ch={`Apply to '${col}'`} />
          <span style={{ fontSize: 10, color: C.textMuted, fontFamily: mono }}>
            Modifies column in-place
          </span>
        </div>
      )}
    </div>
  );
}

// ─── SHARED PREVIEW TABLE ────────────────────────────────────────────────────
function PreviewTable({ rows, C }) {
  if (!rows?.length) return null;
  return (
    <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 11, fontFamily: mono, marginBottom: "0.5rem" }}>
      <thead>
        <tr>
          <th style={{ textAlign: "left", color: C.textMuted, padding: "0.22rem 0.5rem", borderBottom: `1px solid ${C.border}`, width: "50%" }}>Raw</th>
          <th style={{ textAlign: "left", color: C.textMuted, padding: "0.22rem 0.5rem", borderBottom: `1px solid ${C.border}` }}>→ Result</th>
        </tr>
      </thead>
      <tbody>
        {rows.map((r, i) => {
          const unchanged = String(r.raw) === String(r.out);
          const isNull    = r.out === "null ✗" || r.out === "null";
          return (
            <tr key={i} style={{ background: i % 2 === 0 ? C.surface2 : "transparent" }}>
              <td style={{ padding: "0.22rem 0.5rem", color: C.textDim }}>{r.raw}</td>
              <td style={{ padding: "0.22rem 0.5rem",
                color: isNull ? C.red : unchanged ? C.textMuted : C.teal }}>
                {r.out}
                {unchanged && !isNull && <span style={{ color: C.textMuted, marginLeft: 4, fontSize: 9 }}>(unchanged)</span>}
              </td>
            </tr>
          );
        })}
      </tbody>
    </table>
  );
}

// ─── FORMAT TAB ───────────────────────────────────────────────────────────────
// mode prop — when passed from WranglingModule, locks to "numbers" or "strings" (no toggle shown)
export default function FormatTab({ rows, headers, info, onAdd, mode: modeProp }) {
  const { C } = useTheme();
  const [mode,   setMode]   = useState(modeProp ?? "numbers");
  const [selCol, setSelCol] = useState("");

  // Numbers tab: ALL columns — user decides which one to reformat
  // (dirty string-encoded numbers AND already-clean numeric columns are both valid targets)
  const NUM_PAT = /^[\s\d.,\-+eE$€£¥R%()]+$/;
  const numCols = headers; // no filtering — show everything

  const strCols = headers.filter(h => info[h] && !info[h].isNum);

  const activeCols = mode === "numbers" ? numCols : strCols;

  const chipStyle = (active) => ({
    padding: "0.28rem 0.75rem",
    border: `1px solid ${active ? C.teal : C.border2}`,
    background: active ? `${C.teal}14` : "transparent",
    color: active ? C.teal : C.textDim,
    borderRadius: 3, cursor: "pointer", fontSize: 11, fontFamily: mono,
    transition: "all 0.12s",
  });

  return (
    <div>
      {/* Mode toggle — only shown when not locked by parent */}
      {!modeProp && (
        <div style={{
          display: "flex", gap: 4, marginBottom: "1.2rem",
          padding: "0.55rem 0.75rem", background: C.surface2,
          borderRadius: 4, border: `1px solid ${C.border}`,
        }}>
          {[["numbers", "⬡ Numbers", numCols.length],
            ["strings", "◈ Strings", strCols.length]].map(([k, l, n]) => (
            <button key={k} onClick={() => { setMode(k); setSelCol(""); }} style={{
              padding: "0.3rem 0.85rem", display: "flex", alignItems: "center", gap: 6,
              border: `1px solid ${mode === k ? C.teal : C.border2}`,
              background: mode === k ? `${C.teal}14` : "transparent",
              color: mode === k ? C.teal : C.textDim,
              borderRadius: 4, cursor: "pointer", fontSize: 11, fontFamily: mono,
            }}>
              {l}
              <span style={{ fontSize: 9, color: mode === k ? C.teal : C.textMuted,
                background: `${mode === k ? C.teal : C.border2}30`,
                borderRadius: 10, padding: "0.1rem 0.45rem" }}>{n}</span>
            </button>
          ))}
        </div>
      )}

      {/* Column picker */}
      {activeCols.length === 0 ? (
        <div style={{ fontSize: 11, color: C.textMuted, fontFamily: mono, padding: "0.75rem" }}>
          {mode === "numbers"
            ? "No columns found."
            : "No string columns detected."}
        </div>
      ) : (
        <>
          <Lbl mb={6}>Select column to format</Lbl>
          <div style={{ display: "flex", flexWrap: "wrap", gap: 5, marginBottom: "1.2rem" }}>
            {activeCols.map(h => (
              <button key={h} onClick={() => setSelCol(h)} style={chipStyle(selCol === h)}>
                {selCol === h ? "✓ " : ""}{h}
                <span style={{ fontSize: 9, color: C.textMuted, marginLeft: 4 }}>
                  ({info[h]?.uCount ?? "?"})
                </span>
              </button>
            ))}
          </div>

          {selCol && (
            <div style={{ border: `1px solid ${C.teal}25`, borderRadius: 4, padding: "1rem", background: C.surface }}>
              <div style={{
                fontSize: 10, color: C.teal, letterSpacing: "0.15em", textTransform: "uppercase",
                fontFamily: mono, marginBottom: "0.9rem",
              }}>
                {mode === "numbers" ? "⬡ Format Numbers" : "◈ Format Strings"} — <span style={{ color: C.text }}>{selCol}</span>
              </div>
              {mode === "numbers"
                ? <NumberFormatter col={selCol} rows={rows} onAdd={step => { onAdd(step); setSelCol(""); }} />
                : <StringFormatter col={selCol} rows={rows} onAdd={step => { onAdd(step); setSelCol(""); }} />
              }
            </div>
          )}
        </>
      )}
    </div>
  );
}
