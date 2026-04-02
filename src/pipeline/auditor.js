// ─── ECON STUDIO · pipeline/auditor.js ───────────────────────────────────────
// Pure computation. Zero React imports.
//
// Produces a human-readable, serialisable audit trail for a pipeline execution.
// Used by:
//   • AuditTrail.jsx          (supervisor / replication view in UI)
//   • rScript.js              (inline comments in generated R script)
//   • exportMarkdown()        (replication package README)
//
// Exports:
//   auditPipeline(rawRows, rawHeaders, steps, context?)
//     → AuditTrail
//
//   auditTrailToMarkdown(trail)
//     → string  (ready to embed in replication package)
//
// ─── AuditTrail shape ─────────────────────────────────────────────────────────
//
//   meta: {
//     generatedAt,
//     rawRows, rawCols,
//     finalRows, finalCols,
//     stepsTotal, stepsApplied, stepsFailed,
//     rowsRemoved, rowsAdded, colsAdded, colsRemoved,
//   }
//
//   entries: AuditEntry[]
//   {
//     index,           // 0-based step index
//     type,            // step type string
//     label,           // human-readable label from registry.toLabel()
//     category,        // "cleaning" | "features" | "reshape" | "merge"
//     status,          // "ok" | "noop" | "error"
//     error,           // string | null — only if status === "error"
//
//     // Row delta
//     rowsBefore, rowsAfter, rowsDelta,
//
//     // Column delta
//     colsBefore, colsAfter,
//     colsAdded,       // string[]
//     colsRemoved,     // string[]
//
//     // Null delta (affected column only, when applicable)
//     nullsBefore, nullsAfter, nullsDelta,
//     affectedCol,     // string | null
//
//     // Human-readable decision sentence
//     decision,        // e.g. "Dropped 3 rows where wage is null."
//
//     durationMs,      // wall-clock time for this step
//   }

import { applyStep } from "./runner.js";
import { stepLabel, getStepDef } from "./registry.js";

// ─── HELPERS ──────────────────────────────────────────────────────────────────

function countNulls(rows, col) {
  if (!col) return 0;
  return rows.filter(r => r[col] === null || r[col] === undefined).length;
}

// Build a human-readable decision sentence for a step given its before/after state.
function buildDecision(step, before, after) {
  const { type } = step;
  const rowDelta = after.rows.length - before.rows.length;
  const addedCols = after.headers.filter(h => !before.headers.includes(h));
  const removedCols = before.headers.filter(h => !after.headers.includes(h));

  switch (type) {
    case "rename":
      return `Renamed column "${step.col}" to "${step.newName}".`;

    case "drop":
      return `Dropped column "${step.col}". Dataset now has ${after.headers.length} columns.`;

    case "filter": {
      const removed = Math.abs(rowDelta);
      const opMap = { notna: "is not null", eq: `= "${step.value}"`, neq: `≠ "${step.value}"`,
                      gt: `> ${step.value}`, lt: `< ${step.value}`,
                      gte: `≥ ${step.value}`, lte: `≤ ${step.value}` };
      return `Filtered rows where ${step.col} ${opMap[step.op] ?? step.op}. ` +
             `Removed ${removed} row${removed !== 1 ? "s" : ""} (${before.rows.length} → ${after.rows.length}).`;
    }

    case "drop_na": {
      const removed = Math.abs(rowDelta);
      const cols    = step.cols?.length ? step.cols.join(", ") : "all columns";
      return `Dropped ${removed} row${removed !== 1 ? "s" : ""} with null values in [${cols}] ` +
             `(mode: ${step.how ?? "any"}). ${before.rows.length} → ${after.rows.length} rows.`;
    }

    case "fill_na": {
      const filled = countNulls(before.rows, step.col) - countNulls(after.rows, step.col);
      const strat  = step.strategy ?? "mean";
      const detail = strat === "constant" ? ` (value: ${step.value})` : "";
      return `Filled ${filled} null value${filled !== 1 ? "s" : ""} in "${step.col}" using ${strat}${detail}.`;
    }

    case "type_cast":
      return `Cast column "${step.col}" to ${step.to}. ` +
             `${countNulls(after.rows, step.col) - countNulls(before.rows, step.col) > 0
               ? `${countNulls(after.rows, step.col) - countNulls(before.rows, step.col)} unparseable values became null.`
               : "No parsing errors."}`;

    case "quickclean":
      return `Normalised text case in "${step.col}" to ${step.mode ?? "lower"}.`;

    case "recode": {
      const n = Object.keys(step.map ?? {}).length;
      return `Recoded ${n} value mapping${n !== 1 ? "s" : ""} in "${step.col}".`;
    }

    case "normalize_cats": {
      const n = Object.keys(step.map ?? {}).length;
      return `Unified ${n} category variant${n !== 1 ? "s" : ""} in "${step.col}" to canonical forms.`;
    }

    case "winz": {
      const winsorized = before.rows.filter(r => {
        const v = r[step.col];
        return typeof v === "number" && (v < step.lo || v > step.hi);
      }).length;
      return `Winsorized "${step.col}" to [${Number(step.lo).toFixed(4)}, ${Number(step.hi).toFixed(4)}]. ` +
             `${winsorized} value${winsorized !== 1 ? "s" : ""} clipped → "${step.nn || step.col}".`;
    }

    case "log":
      return `Created log("${step.col}") → "${step.nn}". ` +
             `${countNulls(after.rows, step.nn)} null${countNulls(after.rows, step.nn) !== 1 ? "s" : ""} (non-positive values).`;

    case "sq":
      return `Created "${step.col}"² → "${step.nn}".`;

    case "std":
      return `Standardised "${step.col}" (μ=${Number(step.mu).toFixed(4)}, σ=${Number(step.sd).toFixed(4)}) → "${step.nn}".`;

    case "dummy": {
      const n = addedCols.length;
      return `One-hot encoded "${step.col}" with prefix "${step.pfx}". Created ${n} dummy column${n !== 1 ? "s" : ""}: [${addedCols.join(", ")}].`;
    }

    case "lag":
      return `Created lag(${step.n ?? 1}) of "${step.col}" → "${step.nn}"` +
             `${step.ec ? ` (grouped by entity "${step.ec}", time "${step.tc}")` : " (no panel index)"}.`;

    case "lead":
      return `Created lead(${step.n ?? 1}) of "${step.col}" → "${step.nn}"` +
             `${step.ec ? ` (grouped by entity "${step.ec}", time "${step.tc}")` : " (no panel index)"}.`;

    case "diff":
      return `Created first-difference Δ"${step.col}" → "${step.nn}"` +
             `${step.ec ? ` (grouped by entity "${step.ec}", time "${step.tc}")` : " (no panel index — may cross units)"}.`;

    case "ix":
      return `Created interaction "${step.c1}" × "${step.c2}" → "${step.nn}".`;

    case "did":
      return `Created DiD interaction "${step.tc}" × "${step.pc}" (treat×post) → "${step.nn}".`;

    case "date_extract": {
      const parts = step.parts ?? [];
      return `Extracted date parts [${parts.join(", ")}] from "${step.col}" → ` +
             `[${parts.map(p => step.names?.[p] ?? p).join(", ")}].`;
    }

    case "mutate":
      return `Created "${step.nn}" = ${step.expr}. ` +
             `${countNulls(after.rows, step.nn)} null${countNulls(after.rows, step.nn) !== 1 ? "s" : ""} (expression errors or non-finite results).`;

    case "ai_tr":
      return `Applied AI-generated transformation to "${step.col}".`;

    case "arrange":
      return `Sorted dataset by "${step.col}" ${step.dir === "desc" ? "descending" : "ascending"}.`;

    case "group_summarize": {
      const aggs = step.aggs ?? [];
      return `Collapsed to ${after.rows.length} group${after.rows.length !== 1 ? "s" : ""} by [${(step.by ?? []).join(", ")}]. ` +
             `Computed: ${aggs.map(a => `${a.fn}(${a.col}) → ${a.nn}`).join(", ")}.`;
    }

    case "join":
      return `${(step.how ?? "left").toUpperCase()} JOIN with dataset "${step.rightId}" on ` +
             `${step.leftKey} = ${step.rightKey}. ` +
             `Added ${addedCols.length} column${addedCols.length !== 1 ? "s" : ""}. ` +
             `${Math.abs(rowDelta) > 0 ? `${rowDelta > 0 ? "+" : ""}${rowDelta} rows.` : "Row count unchanged."}`;

    case "append":
      return `Appended dataset "${step.rightId}" (UNION ALL). ` +
             `${before.rows.length} + ${rowDelta} = ${after.rows.length} rows. ` +
             `${addedCols.length > 0 ? `New columns: [${addedCols.join(", ")}].` : "Schemas matched."}`;


    case "fill_na_grouped": {
      const filled = countNulls(before.rows, step.col) - countNulls(after.rows, step.col);
      return `Missing values in "${step.col}" were imputed using the within-group ` +
             `${step.strategy || "mean"} of "${step.groupCol}". ` +
             `${filled} null value${filled !== 1 ? "s" : ""} filled. ` +
             `Groups with no observed values retain null.`;
    }

    case "trim_outliers": {
      const removed = Math.abs(rowDelta);
      return `Dropped ${removed} row${removed !== 1 ? "s" : ""} where "${step.col}" ` +
             `fell outside [${Number(step.lo).toFixed(4)}, ${Number(step.hi).toFixed(4)}]. ` +
             `${before.rows.length} → ${after.rows.length} observations. ` +
             `Bounds fixed at step-creation time.`;
    }

    case "flag_outliers": {
      const flagged = after.rows.filter(r => r[step.nn] === 1).length;
      const method  = step.method || "iqr";
      const detail  = method === "zscore"
        ? `Z-score method (|z| > ${step.threshold ?? 3})`
        : "IQR method (Q1 − 1.5·IQR, Q3 + 1.5·IQR)";
      return `Flagged ${flagged} outlier observation${flagged !== 1 ? "s" : ""} in "${step.col}" ` +
             `using the ${detail}. ` +
             `Binary indicator stored in "${step.nn}" (1 = outlier, 0 = inlier). ` +
             `Rows retained.`;
    }

    case "extract_regex": {
      const nullsOut  = countNulls(after.rows, step.nn);
      const total     = after.rows.length;
      const parsed    = total - nullsOut;
      const localeStr = { auto: "auto-detected", dot: "US/UK dot decimal", comma: "EU/LATAM comma decimal" }[step.locale || "auto"] || step.locale;
      return `Extracted numeric values from string column "${step.col}" → "${step.nn}" ` +
             `(${localeStr} convention${step.regex ? `, custom regex: /${step.regex}/` : ""}). ` +
             `${parsed} of ${total} values parsed successfully; ${nullsOut} could not be parsed (→ null).`;
    }

    case "pivot_longer": {
      const pivotN = (step.cols || []).length;
      return `Reshaped from wide to long format. ` +
             `${pivotN} column${pivotN !== 1 ? "s" : ""} [${(step.cols || []).join(", ")}] pivoted into ` +
             `key column "${step.namesTo}" and value column "${step.valuesTo}". ` +
             `${before.rows.length} rows × ${before.headers.length} cols → ` +
             `${after.rows.length} rows × ${after.headers.length} cols.`;
    }

    case "factor_interactions": {
      const n = addedCols.length;
      return `Generated ${n} factor interaction${n !== 1 ? "s" : ""}: ` +
             `"${step.contCol}" × [${(step.dummyCols || []).join(", ")}]. ` +
             `New columns: [${addedCols.join(", ")}]. ` +
             `Null produced where either factor is null or non-numeric.`;
    }

    case "date_parse": {
      const nullsOut = countNulls(after.rows, step.nn || step.col);
      const parsed   = after.rows.length - nullsOut;
      return `Parsed "${step.col}" as ${step.fmt || "auto"} date format → "${step.nn || step.col}" (ISO YYYY-MM-DD). ` +
             `${parsed} values converted; ${nullsOut} could not be parsed (→ null).`;
    }

    default:
      return stepLabel(step);
  }
}

// ─── MAIN EXPORT ─────────────────────────────────────────────────────────────
export function auditPipeline(rawRows, rawHeaders, steps, context = {}) {
  const generatedAt = new Date().toISOString();
  const entries     = [];

  let current = { rows: rawRows, headers: rawHeaders };

  for (let i = 0; i < steps.length; i++) {
    const step  = steps[i];
    const t0    = performance.now();
    const before = { rows: current.rows, headers: [...current.headers] };

    let after, status = "ok", error = null;

    try {
      after = applyStep(before.rows, before.headers, step, context);

      // Detect no-op: rows and headers identical
      const sameRows = after.rows.length === before.rows.length;
      const sameCols = after.headers.length === before.headers.length &&
                       after.headers.every((h, j) => h === before.headers[j]);
      if (sameRows && sameCols) {
        // Could still be a value-level change (recode, fill_na, etc.) — only
        // mark noop for steps where structural identity implies no change
        const structuralSteps = new Set(["arrange", "rename", "drop", "filter",
                                          "drop_na", "join", "append", "group_summarize"]);
        if (structuralSteps.has(step.type)) status = "noop";
      }
    } catch (err) {
      after  = before; // keep state unchanged on error
      status = "error";
      error  = err?.message ?? String(err);
    }

    const durationMs = performance.now() - t0;

    const addedCols   = after.headers.filter(h => !before.headers.includes(h));
    const removedCols = before.headers.filter(h => !after.headers.includes(h));

    // Null delta for the primary affected column
    const affectedCol = step.col || step.nn || step.c1 || null;
    const nullsBefore = affectedCol ? countNulls(before.rows, affectedCol) : null;
    const nullsAfter  = affectedCol ? countNulls(after.rows,  affectedCol) : null;

    const def = getStepDef(step.type);

    entries.push({
      index:      i,
      type:       step.type,
      label:      stepLabel(step),
      category:   def?.category ?? "unknown",
      status,
      error,

      rowsBefore:  before.rows.length,
      rowsAfter:   after.rows.length,
      rowsDelta:   after.rows.length - before.rows.length,

      colsBefore:  before.headers.length,
      colsAfter:   after.headers.length,
      colsAdded:   addedCols,
      colsRemoved: removedCols,

      nullsBefore,
      nullsAfter,
      nullsDelta: (nullsBefore != null && nullsAfter != null) ? nullsAfter - nullsBefore : null,
      affectedCol,

      decision:   status === "error"
        ? `ERROR: ${error}`
        : buildDecision(step, before, after),

      durationMs: parseFloat(durationMs.toFixed(2)),
    });

    current = after;
  }

  // ── Meta ──────────────────────────────────────────────────────────────────
  const applied = entries.filter(e => e.status === "ok").length;
  const failed  = entries.filter(e => e.status === "error").length;
  const noops   = entries.filter(e => e.status === "noop").length;

  const totalRowsRemoved = entries.reduce((s, e) => s + Math.max(0, -e.rowsDelta), 0);
  const totalRowsAdded   = entries.reduce((s, e) => s + Math.max(0,  e.rowsDelta), 0);
  const totalColsAdded   = entries.reduce((s, e) => s + e.colsAdded.length, 0);
  const totalColsRemoved = entries.reduce((s, e) => s + e.colsRemoved.length, 0);

  const meta = {
    generatedAt,
    rawRows:      rawRows.length,
    rawCols:      rawHeaders.length,
    finalRows:    current.rows.length,
    finalCols:    current.headers.length,
    stepsTotal:   steps.length,
    stepsApplied: applied,
    stepsFailed:  failed,
    stepsNoop:    noops,
    rowsRemoved:  totalRowsRemoved,
    rowsAdded:    totalRowsAdded,
    colsAdded:    totalColsAdded,
    colsRemoved:  totalColsRemoved,
  };

  return { meta, entries, finalHeaders: current.headers };
}

// ─── MARKDOWN EXPORT ─────────────────────────────────────────────────────────
// Produces a replication-package-ready .md file.
export function auditTrailToMarkdown(trail) {
  const { meta, entries } = trail;
  const ts = new Date(meta.generatedAt).toLocaleString("en-GB", { timeZone: "UTC" });

  const statusIcon = { ok: "✅", noop: "⬜", error: "❌" };
  const catIcon    = { cleaning: "⬡", features: "⊕", reshape: "◈", merge: "⊞", unknown: "·" };

  const lines = [
    `# Pipeline Audit Trail`,
    `Generated: ${ts} UTC`,
    ``,
    `## Summary`,
    `| Metric | Value |`,
    `|--------|-------|`,
    `| Raw dataset | ${meta.rawRows.toLocaleString()} rows × ${meta.rawCols} cols |`,
    `| Final dataset | ${meta.finalRows.toLocaleString()} rows × ${meta.finalCols} cols |`,
    `| Steps total | ${meta.stepsTotal} |`,
    `| Applied | ${meta.stepsApplied} |`,
    `| No-op | ${meta.stepsNoop} |`,
    `| Errors | ${meta.stepsFailed} |`,
    `| Rows removed | ${meta.rowsRemoved.toLocaleString()} |`,
    `| Rows added | ${meta.rowsAdded.toLocaleString()} |`,
    `| Columns added | ${meta.colsAdded} |`,
    `| Columns removed | ${meta.colsRemoved} |`,
    ``,
    `## Step-by-step decisions`,
    ``,
  ];

  entries.forEach((e, i) => {
    const icon = statusIcon[e.status] ?? "·";
    const cat  = catIcon[e.category] ?? "·";
    lines.push(`### ${icon} Step ${i + 1} — \`${e.type}\``);
    lines.push(`**${cat} ${e.label}**`);
    lines.push(``);
    lines.push(e.decision);
    lines.push(``);

    const stats = [];
    if (e.rowsDelta !== 0)
      stats.push(`Rows: ${e.rowsBefore.toLocaleString()} → ${e.rowsAfter.toLocaleString()} (${e.rowsDelta > 0 ? "+" : ""}${e.rowsDelta})`);
    if (e.colsAdded.length > 0)
      stats.push(`Columns added: [${e.colsAdded.join(", ")}]`);
    if (e.colsRemoved.length > 0)
      stats.push(`Columns removed: [${e.colsRemoved.join(", ")}]`);
    if (e.nullsDelta != null && e.nullsDelta !== 0)
      stats.push(`Nulls in "${e.affectedCol}": ${e.nullsBefore} → ${e.nullsAfter} (${e.nullsDelta > 0 ? "+" : ""}${e.nullsDelta})`);
    stats.push(`Duration: ${e.durationMs}ms`);

    if (stats.length) {
      lines.push(stats.map(s => `- ${s}`).join("\n"));
      lines.push(``);
    }
  });

  if (meta.stepsFailed > 0) {
    lines.push(`## ❌ Errors`);
    entries.filter(e => e.status === "error").forEach(e => {
      lines.push(`- **Step ${e.index + 1} (\`${e.type}\`)**: ${e.error}`);
    });
    lines.push(``);
  }

  return lines.join("\n");
}
