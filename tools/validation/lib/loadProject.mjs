// ─── ECON STUDIO · tools/validation/lib/loadProject.mjs ──────────────────────
// Rebuilds a Litux project outside the browser from its `.litux.json` recipe
// plus the ORIGINAL source files: parse each dataset with the app's own
// parsers, then replay its pipeline with the app's own runner. What comes out
// is exactly what the app shows in Clean — the baseline every exported script
// has to reproduce from the same raw file.
//
// Deliberately raw-first: exporting the cleaned CSV from Litux and comparing
// that would test nothing, because the pipeline would already be baked in.

import { readFileSync, existsSync, readdirSync, statSync } from "node:fs";
import path from "node:path";
import { runPipeline, runPipelineAsync } from "../../../src/pipeline/runner.js";
import { buildDatasetContext } from "../../../src/pipeline/datasetContext.js";
import { parseProjectExport } from "../../../src/services/export/projectExport.js";
import { ensureRowIdentity } from "../../../src/services/data/rowIdentity.js";

export const ROOT = path.resolve(import.meta.dirname, "../../..");
export const VAL  = path.join(ROOT, "validation");

// Steps whose expression runs in the browser's Worker; runPipelineAsync would
// try to import it, so those projects are flagged rather than silently skipped.
const WORKER_STEPS = new Set(["mutate", "ai_tr", "if_else", "case_when", "vector_assign", "grouped_mutate"]);

// ── Source files ────────────────────────────────────────────────────────────
// The recipe stores a filename, not a path (the browser has no paths), so the
// file is located by name anywhere under validation/. A name that matches more
// than one file is an error, not a guess.
let fileIndex = null;
function indexFiles(dir = VAL, out = new Map()) {
  for (const entry of readdirSync(dir)) {
    const p = path.join(dir, entry);
    let st; try { st = statSync(p); } catch { continue; }
    if (st.isDirectory()) { if (entry !== "results") indexFiles(p, out); continue; }
    const key = entry.toLowerCase();
    if (!out.has(key)) out.set(key, []);
    out.get(key).push(p);
  }
  return out;
}

export function resolveDataFile(filename) {
  if (!filename) return null;
  fileIndex ??= indexFiles();
  const hits = fileIndex.get(path.basename(filename).toLowerCase()) ?? [];
  if (hits.length === 0) return null;
  if (hits.length > 1) throw new Error(`"${filename}" matches ${hits.length} files under validation/: ${hits.join(", ")}`);
  return hits[0];
}

// ── Parsing: the app's own parsers, chosen the way parseFile does ───────────
export async function parseDataFile(file, loadOpts = null) {
  const buf = readFileSync(file);
  const ab  = buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength);
  const ext = path.extname(file).slice(1).toLowerCase();
  const { parseCSV, detectDelimiter, parseExcelBuffer } = await import("../../../src/services/data/parsers/tabular.js");

  if (ext === "csv" || ext === "txt" || ext === "tsv") {
    const text = new TextDecoder("utf-8").decode(ab);
    const delim = loadOpts?.delimiter && loadOpts.delimiter !== "auto"
      ? loadOpts.delimiter
      : (ext === "tsv" ? "\t" : detectDelimiter(text));
    return parseCSV(text, delim);
  }
  if (ext === "xlsx" || ext === "xls") {
    const { tables } = parseExcelBuffer(ab);
    const want = loadOpts?.sheetName;
    const t = (want && tables.find(x => x.name === want)) || tables[0];
    return { headers: t.headers, rows: t.rows };
  }
  if (ext === "dta")  return (await import("../../../src/services/data/parsers/stata.js")).parseStata(ab);
  if (ext === "rds")  return (await import("../../../src/services/data/parsers/rds.js")).parseRDS(ab);
  if (ext === "rdata" || ext === "rda") {
    const { tables } = await (await import("../../../src/services/data/parsers/rdata.js")).parseRData(ab);
    const want = loadOpts?.objectName;
    const t = (want && tables.find(x => x.name === want)) || tables[0];
    return { headers: t.headers, rows: t.rows };
  }
  throw new Error(`No parser for "${path.basename(file)}"`);
}

/**
 * @returns {Promise<{
 *   unit, payload, datasets: Map<id, {id,name,filename,file,loadOpts,raw,clean,steps,panel,dataDictionary}>,
 *   models, plots, explorePins, globalPipeline, warnings: string[]
 * }>}
 */
export async function loadProjectUnit(unit, { dir = path.join(VAL, unit) } = {}) {
  const file = path.join(dir, "project.litux.json");
  if (!existsSync(file)) throw new Error(`No project export at ${file} — export it from the Dataset Manager.`);
  const payload = parseProjectExport(readFileSync(file, "utf8"));
  const warnings = [];

  // 1. Parse every dataset from its ORIGINAL file.
  const entries = [];
  const derivedMetas = [];
  const producers = new Map((payload.globalPipeline ?? [])
    .filter(g => g.opType === "derive" && g.outputDatasetId).map(g => [g.outputDatasetId, g]));
  for (const meta of payload.datasets) {
    // A dataset built inside Litux has no file of its own: it is rebuilt from
    // its frozen lineage record (step 1b), exactly as the exported script does.
    if (producers.has(meta.id)) { derivedMetas.push(meta); continue; }
    const src = resolveDataFile(meta.filename);
    if (!src) {
      warnings.push(meta.origin
        ? `dataset "${meta.name ?? meta.filename}": derived inside Litux with NO recipe (saved before lineage was recorded) — not reproducible from the project; re-derive it in the app to record one`
        : `dataset "${meta.name ?? meta.id}": source file "${meta.filename}" not found under validation/`);
      continue;
    }
    const parsed = ensureRowIdentity(await parseDataFile(src, meta.loadOpts));
    entries.push({
      id: meta.id,
      name: meta.name ?? meta.filename,
      filename: meta.filename,
      file: src,
      loadOpts: meta.loadOpts ?? null,
      rawData: parsed,
    });
  }

  // 1b. Derived datasets: the parent's RAW file with the parent's pipeline as it
  //     was when the child was saved (the frozen snapshot), which is what the
  //     app materialised as the child's rows.
  for (const meta of derivedMetas) {
    const g = producers.get(meta.id);
    const parent = entries.find(e => e.id === g.right?.datasetId);
    if (!parent) { warnings.push(`dataset "${meta.name ?? meta.filename}": parent ${g.right?.datasetId} unavailable`); continue; }
    const snap = runPipeline(parent.rawData.rows, parent.rawData.headers, g.right.snapshot ?? [], {});
    entries.push({
      id: meta.id,
      name: meta.name ?? meta.filename,
      filename: meta.filename,
      file: null,
      derivedFrom: g,
      loadOpts: null,
      rawData: ensureRowIdentity({ headers: snap.headers, rows: snap.rows }),
    });
  }

  // 2. Replay each pipeline, with joins resolved against the other datasets
  //    exactly as WranglingModule does.
  const pipelineFor = (id) => payload.pipelines?.[id]?.steps ?? [];
  const { datasets: ctxDatasets, warnings: ctxWarn } =
    await buildDatasetContext(entries, pipelineFor, async ds => ds.rawData);
  warnings.push(...ctxWarn);

  const datasets = new Map();
  for (const e of entries) {
    const rec   = payload.pipelines?.[e.id] ?? {};
    const steps = rec.steps ?? [];
    // Node has no Worker: runPipelineAsync then nulls every expression step's
    // output (by design — it never re-evaluates on the main thread), which made
    // the "Litux truth" for if_else/mutate an all-null column. The sync runner
    // evaluates the same expressions in-process, so it is the truth here.
    const needsWorker = typeof Worker !== "undefined" && steps.some(s => WORKER_STEPS.has(s.type));
    let clean;
    try {
      clean = needsWorker
        ? await runPipelineAsync(e.rawData.rows, e.rawData.headers, steps, { datasets: ctxDatasets })
        : runPipeline(e.rawData.rows, e.rawData.headers, steps, { datasets: ctxDatasets });
    } catch (err) {
      warnings.push(`dataset "${e.name}": pipeline failed in Litux (${err?.message ?? err})`);
      clean = { rows: e.rawData.rows, headers: e.rawData.headers };
    }
    datasets.set(e.id, {
      ...e,
      steps,
      panel: rec.panel ?? null,
      dataDictionary: rec.dataDictionary ?? null,
      clean,
    });
  }

  return {
    unit,
    payload,
    datasets,
    models: payload.models?.models ?? [],
    plots: payload.plots ?? {},
    explorePins: payload.explorePins ?? {},
    globalPipeline: payload.globalPipeline ?? [],
    warnings,
  };
}

// ── Comparing a table against what a script produced ────────────────────────
// A pipeline is only reproduced if the CELLS match, so the comparison is
// per column: dtype-aware, NA-aware, and it reports the first rows that differ
// rather than just a count.
const near = (a, b, tol) => Math.abs(a - b) <= tol * Math.max(1, Math.abs(b));
const isNA = (v) => v === null || v === undefined || v === "" || (typeof v === "number" && Number.isNaN(v));

export function compareTables(expected, actual, { tol = 1e-9, ignore = ["__ri", "__row_id"], maxReport = 5 } = {}) {
  const diffs = [];
  const eRows = expected.rows ?? expected, aRows = actual.rows ?? actual;
  const eCols = (expected.headers ?? Object.keys(eRows[0] ?? {})).filter(h => !ignore.includes(h));
  const aCols = (actual.headers ?? Object.keys(aRows[0] ?? {})).filter(h => !ignore.includes(h));

  if (eRows.length !== aRows.length) diffs.push(`rows: ${eRows.length} vs ${aRows.length}`);
  const missing = eCols.filter(c => !aCols.includes(c));
  const extra   = aCols.filter(c => !eCols.includes(c));
  if (missing.length) diffs.push(`columns missing in the script output: ${missing.join(", ")}`);
  if (extra.length)   diffs.push(`columns only in the script output: ${extra.join(", ")}`);

  const shared = eCols.filter(c => aCols.includes(c));
  // Compared as SETS of rows, because a sort with ties breaks positional
  // comparison for reasons that are not a reproduction failure: dplyr, Stata
  // and pandas order tied rows differently, and so does the app. Row ORDER is
  // then checked separately and reported as a note, not a failure.
  const key = (r) => shared.map(c => canon(r[c])).join("");
  const eSorted = [...eRows].sort((x, y) => (key(x) < key(y) ? -1 : key(x) > key(y) ? 1 : 0));
  const aSorted = [...aRows].sort((x, y) => (key(x) < key(y) ? -1 : key(x) > key(y) ? 1 : 0));

  const n = Math.min(eSorted.length, aSorted.length);
  for (const c of shared) {
    let bad = 0; const samples = [];
    for (let i = 0; i < n; i++) {
      const e = eSorted[i][c], a = aSorted[i][c];
      if (isNA(e) && isNA(a)) continue;
      const ok = (typeof e === "number" && typeof a === "number")
        ? near(e, a, tol)
        : String(e ?? "") === String(a ?? "");
      if (!ok) { bad++; if (samples.length < 3) samples.push(`${JSON.stringify(e)} vs ${JSON.stringify(a)}`); }
    }
    if (bad && diffs.length < maxReport + 3) diffs.push(`${c}: ${bad}/${n} rows differ (${samples.join("; ")})`);
  }

  // Order note: same content, different sequence (ties broken differently).
  let orderNote = "";
  if (!diffs.length) {
    const m = Math.min(eRows.length, aRows.length);
    let firstOff = -1;
    for (let i = 0; i < m; i++) if (key(eRows[i]) !== key(aRows[i])) { firstOff = i; break; }
    if (firstOff >= 0) orderNote = `same rows, different order (first at row ${firstOff + 1}) — a sort with ties`;
  }
  return { ok: diffs.length === 0, diffs, orderNote };
}

// Numbers are compared as numbers, so the sort key must not make 10 < 9.
function canon(v) {
  if (isNA(v)) return " ";
  if (typeof v === "number") return v.toFixed(10).padStart(24, " ");
  const n = Number(v);
  return (v !== "" && Number.isFinite(n)) ? n.toFixed(10).padStart(24, " ") : String(v);
}
