// ─── ECON STUDIO · services/AI/sessionSnapshot.js ───────────────────────────
// Consolidates per-module session state into a single blob that the Report-AI
// (`interpretRegression` + `generateUnifiedScript`) can use to produce a
// faithful end-to-end replication script — including the dataset's original
// load options (e.g. `sep=";"`, sheet name, encoding).
//
// Shape:
//   {
//     dataLoadOpts:   { filename, format, delimiter?, encoding?, sheetName?, engine? } | null,
//     pipeline:       Step[],
//     dataDictionary: Record<string, string> | null,
//     panelIndex:     { entityCol, timeCol, balance, blockFD } | null,
//     activeResult:   EstimationResult | null,
//     inferenceOpts:  { seType, clusterVar?, bandwidth? } | null,
//     estimatorMeta:  Record<string, any> | null,
//     pinnedModels:   EstimationResult[],
//     subsets:        { [label: string]: EstimationResult } | null,
//   }
//
// Usage:
//   const snap = buildSessionSnapshot({ cleanedData, result, sessionState });
//   await interpretRegression(result, dataDictionary, null, rows, { snapshot: snap });
//   await generateUnifiedScript(sections, "r", dataDictionary, { snapshot: snap });

import { trimResult } from "../Persistence/trimResult.js";

// Helper: keep payloads small for the cached system prompt budget.
function trimPipeline(pipeline) {
  if (!Array.isArray(pipeline)) return [];
  // Keep all steps — but strip any heavy embedded data (e.g. precomputed maps)
  return pipeline.map(s => {
    const { _rows, _cache, _runtime, ...rest } = s ?? {};
    return rest;
  });
}

function trimDict(dict, max = 60) {
  if (!dict || typeof dict !== "object") return null;
  const entries = Object.entries(dict).filter(([, v]) => v && String(v).trim());
  if (!entries.length) return null;
  return Object.fromEntries(entries.slice(0, max));
}

// trimResult is now the shared helper imported above (services/Persistence/trimResult.js).

export function buildSessionSnapshot({
  cleanedData = null,
  result = null,
  pinnedModels = null,
  subsets = null,
  inferenceOpts = null,
  estimatorMeta = null,
  sessionLog = null,
} = {}) {
  const filename = cleanedData?.filename ?? result?.spec?.filename ?? null;
  const loadOpts = cleanedData?.loadOpts ?? result?.spec?.dataLoadOpts ?? null;

  const dataLoadOpts = filename
    ? { filename, ...(loadOpts ?? { format: "csv" }) }
    : loadOpts ?? null;

  return {
    dataLoadOpts,
    pipeline:       trimPipeline(cleanedData?.pipeline ?? result?.spec?.pipeline ?? []),
    dataDictionary: trimDict(cleanedData?.dataDictionary ?? result?.spec?.dataDictionary),
    panelIndex:     cleanedData?.panelIndex ?? null,
    activeResult:   trimResult(result),
    inferenceOpts:  inferenceOpts ?? (result?.seType ? { seType: result.seType } : null),
    estimatorMeta:  estimatorMeta ?? null,
    pinnedModels:   Array.isArray(pinnedModels) ? pinnedModels.map(trimResult).filter(Boolean) : [],
    subsets:        subsets && typeof subsets === "object"
      ? Object.fromEntries(Object.entries(subsets).map(([k, v]) => [k, trimResult(v)]))
      : null,
    sessionLog:     Array.isArray(sessionLog) ? sessionLog : [],
  };
}

// ─── SERIALIZATION FOR AI PROMPTS ───────────────────────────────────────────
// Produces a compact, human-readable text block that gets concatenated into
// the user payload of any AI call that needs session awareness.
export function serializeSnapshot(snapshot) {
  if (!snapshot) return "";
  const lines = [];

  // ── Data load context ──────────────────────────────────────────────────────
  if (snapshot.dataLoadOpts) {
    const o = snapshot.dataLoadOpts;
    const parts = [];
    if (o.filename)  parts.push(`filename="${o.filename}"`);
    if (o.format)    parts.push(`format=${o.format}`);
    if (o.delimiter && o.delimiter !== "auto") parts.push(`delimiter=${JSON.stringify(o.delimiter)}`);
    if (o.encoding && o.encoding !== "utf-8")  parts.push(`encoding="${o.encoding}"`);
    if (o.sheetName) parts.push(`sheet="${o.sheetName}"`);
    if (o.engine)    parts.push(`engine=${o.engine}`);
    if (parts.length) {
      lines.push("DATA LOAD OPTIONS (use these EXACTLY when writing the load step):");
      lines.push("  " + parts.join(", "));
    }
  }

  // ── Pipeline ───────────────────────────────────────────────────────────────
  if (snapshot.pipeline?.length) {
    lines.push(`\nPIPELINE (${snapshot.pipeline.length} steps, executed in order):`);
    snapshot.pipeline.forEach((s, i) => {
      const desc = s.desc ?? s.description ?? "";
      lines.push(`  ${i + 1}. ${s.type}${desc ? " — " + desc : ""}`);
    });
  }

  // ── Panel ──────────────────────────────────────────────────────────────────
  if (snapshot.panelIndex) {
    const p = snapshot.panelIndex;
    lines.push(`\nPANEL: entity=${p.entityCol}, time=${p.timeCol}, balance=${p.balance ?? "?"}`);
  }

  // ── Data dictionary ────────────────────────────────────────────────────────
  if (snapshot.dataDictionary && Object.keys(snapshot.dataDictionary).length) {
    lines.push("\nDATA DICTIONARY:");
    Object.entries(snapshot.dataDictionary).forEach(([k, v]) => {
      lines.push(`  ${k}: ${String(v).replace(/\n/g, " ").slice(0, 120)}`);
    });
  }

  // ── Inference options ──────────────────────────────────────────────────────
  if (snapshot.inferenceOpts?.seType) {
    const io = snapshot.inferenceOpts;
    const extras = [];
    if (io.clusterVar)  extras.push(`cluster=${io.clusterVar}`);
    if (io.clusterVar2) extras.push(`cluster2=${io.clusterVar2}`);
    if (io.bandwidth)   extras.push(`bandwidth=${io.bandwidth}`);
    lines.push(`\nSE TYPE: ${io.seType}${extras.length ? " (" + extras.join(", ") + ")" : ""}`);
  }

  // ── Active model spec ──────────────────────────────────────────────────────
  if (snapshot.activeResult) {
    const r = snapshot.activeResult;
    const spec = r.spec ?? {};
    lines.push(`\nACTIVE MODEL: ${r.label ?? r.type ?? "model"}`);
    if (spec.yVar)        lines.push(`  Dependent: ${spec.yVar}`);
    if (spec.xVars?.length) lines.push(`  Regressors: ${spec.xVars.join(", ")}`);
    if (spec.zVars?.length) lines.push(`  Instruments: ${spec.zVars.join(", ")}`);
    if (spec.entityCol)   lines.push(`  Entity: ${spec.entityCol}, Time: ${spec.timeCol}`);
    if (spec.runningVar)  lines.push(`  RDD running var: ${spec.runningVar}, cutoff=${spec.cutoff}, h=${spec.bandwidth}`);
  }

  // ── Pinned models ──────────────────────────────────────────────────────────
  if (snapshot.pinnedModels?.length) {
    lines.push(`\nPINNED MODELS (${snapshot.pinnedModels.length}):`);
    snapshot.pinnedModels.forEach((m, i) => {
      lines.push(`  (${i + 1}) ${m.label ?? m.type}: ${m.spec?.yVar ?? "?"} ~ ${(m.spec?.xVars ?? []).join(" + ") || "?"}`);
    });
  }

  // ── Subsets ────────────────────────────────────────────────────────────────
  if (snapshot.subsets && Object.keys(snapshot.subsets).length) {
    lines.push(`\nSUBSETS (${Object.keys(snapshot.subsets).length}):`);
    Object.entries(snapshot.subsets).forEach(([name, m]) => {
      lines.push(`  ${name}: n=${m?.n ?? "?"}, β̂=${m?.beta?.[1]?.toFixed?.(4) ?? "?"}`);
    });
  }

  // ── Session log (cross-module operations) ─────────────────────────────────
  if (snapshot.sessionLog?.length) {
    lines.push(`\nMODULE OPERATIONS (${snapshot.sessionLog.length}, chronological):`);
    snapshot.sessionLog
      .slice()
      .sort((a, b) => a.timestamp - b.timestamp)
      .forEach((entry, i) => {
        const flag = entry.reproducible ? "" : " [non-reproducible]";
        const params = entry.params
          ? " — " + Object.entries(entry.params).map(([k, v]) => `${k}=${JSON.stringify(v)}`).join(", ")
          : "";
        lines.push(`  ${i + 1}. [${entry.module}] ${entry.opType}${params}${flag}`);
        if (entry.label) lines.push(`     ${entry.label}`);
      });
  }

  return lines.join("\n");
}

// Map dataLoadOpts to a small set of language-specific load hints so the AI
// can be told *how* to emit the load line for each target language.
export function loadOptsToScriptHint(loadOpts, language) {
  if (!loadOpts) return "";
  const { format, delimiter, encoding, sheetName, filename } = loadOpts;
  const f = filename ? `"${filename}"` : '"<DATA_FILE>"';
  const sepStr = delimiter && delimiter !== "auto" && delimiter !== ","
    ? JSON.stringify(delimiter) : null;
  const lang = String(language ?? "r").toLowerCase();

  if (lang === "r") {
    if (format === "excel") return `readxl::read_excel(${f}${sheetName ? `, sheet = "${sheetName}"` : ""})`;
    if (format === "stata") return `haven::read_dta(${f})`;
    if (format === "rds")   return `readRDS(${f})`;
    if (format === "parquet") return `arrow::read_parquet(${f})`;
    if (sepStr || encoding) {
      const args = [f];
      if (sepStr)   args.push(`delim = ${sepStr}`);
      if (encoding && encoding !== "utf-8") args.push(`locale = readr::locale(encoding = "${encoding}")`);
      return `readr::read_delim(${args.join(", ")})`;
    }
    return `readr::read_csv(${f})`;
  }
  if (lang === "python") {
    if (format === "excel") return `pd.read_excel(${f}${sheetName ? `, sheet_name="${sheetName}"` : ""})`;
    if (format === "stata") return `pd.read_stata(${f})`;
    if (format === "parquet") return `pd.read_parquet(${f})`;
    const args = [f];
    if (sepStr) args.push(`sep=${sepStr}`);
    if (encoding && encoding !== "utf-8") args.push(`encoding="${encoding}"`);
    return `pd.read_csv(${args.join(", ")})`;
  }
  if (lang === "stata") {
    if (format === "excel") return `import excel ${f}, firstrow${sheetName ? ` sheet("${sheetName}")` : ""} clear`;
    if (format === "stata") return `use ${f}, clear`;
    const opts = [];
    if (sepStr) opts.push(`delimiter(${delimiter === "\t" ? "tab" : sepStr})`);
    if (encoding && encoding !== "utf-8") opts.push(`encoding("${encoding}")`);
    opts.push("clear");
    return `import delimited ${f}, ${opts.join(" ")}`;
  }
  return "";
}
