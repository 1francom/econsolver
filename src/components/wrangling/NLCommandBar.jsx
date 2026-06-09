// ─── ECON STUDIO · components/wrangling/NLCommandBar.jsx ──────────────────────
// Natural-language command bar: AI proposes declarative pipeline steps, which
// are validated against the registry and previewed via a non-destructive
// dry-run before the user applies them. Spans the wrangling module.
import { useState, useMemo } from "react";
import { useTheme, Btn, Lbl } from "./shared.jsx";
import { nlToPipeline } from "../../services/AI/AIService.js";
import { validateAISteps } from "../../pipeline/stepValidator.js";
import { runPipeline } from "../../pipeline/runner.js";

export default function NLCommandBar({ rows = [], headers = [], onAddSteps }) {
  const { C, T } = useTheme();
  const [command, setCommand] = useState("");
  const [busy, setBusy]       = useState(false);
  const [result, setResult]   = useState(null); // { interpretation, valid, rejected, notes, preview, newCols } | { error }

  // Build column context (name + coarse dtype + up to 5 samples) from current data.
  const columns = useMemo(() => headers.map(h => {
    const samples = [];
    for (const r of rows) { if (r[h] != null) { samples.push(r[h]); if (samples.length >= 5) break; } }
    const dtype = samples.length && samples.every(v => typeof v === "number") ? "number" : "string";
    return { name: h, dtype, samples };
  }), [rows, headers]);

  async function run() {
    if (!command.trim()) return;
    setBusy(true); setResult(null);
    const resp = await nlToPipeline({ command, columns });
    if (resp.error) { setResult({ error: resp.error }); setBusy(false); return; }
    const { valid, rejected } = validateAISteps(resp.steps, headers);

    // dry-run preview: apply valid steps on top of current rows (no datasets needed for cleaning/features)
    let preview = [], newCols = [];
    try {
      const out = runPipeline(rows, headers, valid, { datasets: {} });
      newCols = out.headers.filter(h => !headers.includes(h));
      preview = out.rows.slice(0, 5);
    } catch { /* preview is best-effort */ }

    setResult({ interpretation: resp.interpretation, notes: resp.notes, valid, rejected, preview, newCols });
    setBusy(false);
  }

  function apply() {
    if (result?.valid?.length) onAddSteps?.(result.valid);
    setResult(null); setCommand("");
  }

  const box = {
    background: C.surface2, border: `1px solid ${C.border2}`, borderRadius: 4,
    color: C.text, fontFamily: T.code.fontFamily, fontSize: T.code.fontSize, padding: "0.5rem 0.7rem", outline: "none",
  };

  return (
    <div style={{ marginBottom: "1rem", padding: "0.8rem", background: C.surface,
      border: `1px solid ${C.border}`, borderLeft: `3px solid ${C.blue}`, borderRadius: 4 }}>
      <Lbl color={C.blue}>AI command — describe what to do to your data</Lbl>
      <div style={{ display: "flex", gap: 8 }}>
        <input value={command} onChange={e => setCommand(e.target.value)}
          onKeyDown={e => { if (e.key === "Enter") run(); }}
          placeholder='e.g. "split geometry into lat and lon"'
          style={{ ...box, flex: 1 }} disabled={busy} />
        <Btn onClick={run} color={C.blue} v="solid" dis={busy || !command.trim()}
          ch={busy ? "Thinking…" : "Ask AI →"} />
      </div>

      {result?.error && (
        <div style={{ marginTop: 8, color: C.red, fontFamily: T.code.fontFamily, fontSize: T.code.fontSize }}>⚠ {result.error}</div>
      )}

      {result && !result.error && (
        <div style={{ marginTop: 10, padding: "0.6rem 0.8rem", background: C.surface2,
          border: `1px solid ${C.border}`, borderRadius: 4 }}>
          <div style={{ fontSize: T.code.fontSize, color: C.textDim, fontFamily: T.code.fontFamily, marginBottom: 6 }}>
            {result.interpretation}
          </div>
          {result.valid.map((s, i) => {
            // Surface any dynamic expression so the user sees exactly what will run.
            const code = s.expr ?? s.cond
              ?? (Array.isArray(s.rules) ? s.rules.map(r => r.expr).filter(Boolean).join(" ; ") : null);
            return (
              <div key={`v${i}`} style={{ fontSize: T.code.fontSize, color: C.green, fontFamily: T.code.fontFamily }}>
                ✓ {i + 1}. {s.type} — {s.desc ?? ""}
                {code && (
                  <div style={{ color: C.textMuted, fontSize: T.caption.fontSize, marginLeft: 14, wordBreak: "break-all" }}>
                    ↳ {String(code).slice(0, 200)}
                  </div>
                )}
              </div>
            );
          })}
          {result.rejected.map((r, i) => (
            <div key={`r${i}`} style={{ fontSize: T.code.fontSize, color: C.yellow, fontFamily: T.code.fontFamily }}>
              ✗ {r.step?.type ?? "?"} — {r.reason}
            </div>
          ))}
          {result.notes && (
            <div style={{ fontSize: T.caption.fontSize, color: C.textMuted, fontFamily: T.code.fontFamily, marginTop: 4 }}>{result.notes}</div>
          )}
          {result.newCols.length > 0 && (
            <div style={{ marginTop: 8, fontSize: T.caption.fontSize, color: C.textDim, fontFamily: T.code.fontFamily }}>
              New columns: <span style={{ color: C.blue }}>{result.newCols.join(", ")}</span>
              <div style={{ marginTop: 4 }}>
                {result.preview.map((r, i) => (
                  <div key={`p${i}`}>{result.newCols.map(c => `${c}=${r[c]}`).join("  ")}</div>
                ))}
              </div>
            </div>
          )}
          <div style={{ display: "flex", gap: 8, marginTop: 10 }}>
            <Btn onClick={apply} color={C.green} v="solid" dis={!result.valid.length}
              ch={`Apply ${result.valid.length} step${result.valid.length !== 1 ? "s" : ""} →`} />
            <Btn onClick={() => setResult(null)} color={C.textDim} v="ghost" ch="Discard" />
          </div>
        </div>
      )}
    </div>
  );
}
