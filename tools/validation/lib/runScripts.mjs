// ─── ECON STUDIO · tools/validation/lib/runScripts.mjs ───────────────────────
// Emits the scripts Litux would hand the user, runs them for real, and reads
// back what they produced. Two kinds so far:
//
//   runPipelineScript  — Clean's pipeline export: load the RAW file, apply the
//                        steps, write the result. The comparison is against the
//                        table Litux itself produced from the same raw file, so
//                        this is the test of "does the exported pipeline work".
//   runModelScript     — the Code panel's per-model script, with a dump block
//                        appended (the pattern stataEstimatorSweep.mjs uses).
//
// Paths are absolute, so scripts run from a scratch directory without touching
// validation/.

import { writeFileSync, readFileSync, existsSync, mkdirSync, rmSync, copyFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import path from "node:path";
import { generateCleanScript, generateWorkspaceScript, toDfVar, toStataFile } from "../../../src/pipeline/exporter.js";
import { parseCSV } from "../../../src/services/data/parsers/tabular.js";

export const RSCRIPT = process.env.RSCRIPT_EXE ?? "C:/Program Files/R/R-4.4.1/bin/Rscript.exe";
export const STATA   = process.env.STATA_EXE   ?? "C:/Program Files/StataNow19/StataSE-64.exe";
export const PYTHON  = process.env.PYTHON_EXE  ?? "python";

export const LANGS = ["r", "stata", "python"];
const EXT = { r: "R", stata: "do", python: "py" };

const fwd = (p) => String(p).replace(/\\/g, "/");

// Each language writes the cleaned table to `outCsv` so it can be read back and
// compared cell by cell. NA is written empty in all three so the CSV round-trip
// does not invent a literal "NA" string.
function exportLine(language, dfVar, outCsv) {
  if (language === "r")      return `write.csv(${dfVar}, "${fwd(outCsv)}", row.names = FALSE, na = "")`;
  if (language === "python") return `${dfVar}.to_csv(r"${outCsv}", index=False, na_rep="")`;
  // nolabel: write codes, as Litux holds them. The explicit %21.0g on every
  // numeric variable keeps full precision; datafmt alone would write each
  // variable's display format (e.g. %9.0g), and a date format as "1990q1".
  return [
    `quietly ds, has(type numeric)`,
    `if "\`r(varlist)'" != "" format \`r(varlist)' %21.0g`,
    `export delimited using "${fwd(outCsv)}", replace datafmt nolabel`,
  ].join("\n");
}

function run(language, file, cwd) {
  try {
    if (language === "r")      execFileSync(RSCRIPT, [file], { cwd, stdio: ["ignore", "pipe", "pipe"], timeout: 20 * 60 * 1000 });
    else if (language === "python") execFileSync(PYTHON, [file], { cwd, stdio: ["ignore", "pipe", "pipe"], timeout: 20 * 60 * 1000 });
    else execFileSync(STATA, ["/e", "do", path.basename(file)], { cwd, stdio: "ignore", timeout: 20 * 60 * 1000 });
    return { ok: true, err: "" };
  } catch (e) {
    return { ok: false, err: String(e.stderr ?? e.message ?? "").slice(-2000) };
  }
}

// Stata reports failures in its log, not its exit status.
function stataLogError(file) {
  const log = file.replace(/\.do$/, ".log");
  if (!existsSync(log)) return "no log produced";
  const txt = readFileSync(log, "latin1");
  const rc = [...txt.matchAll(/^r\((\d+)\);/gm)].map(m => m[1]);
  if (!rc.length) return "";
  const line = txt.split(/\r?\n/).find(l => /^r\(\d+\);/.test(l.trim()));
  const ctx = txt.split(/\r?\n/).slice(Math.max(0, txt.split(/\r?\n/).indexOf(line) - 3), undefined).slice(0, 4).join(" | ");
  return `r(${rc.join(",")}) ${ctx}`;
}

/**
 * Emit + run the Clean pipeline export for one dataset and read the table back.
 * @returns {{ language, script, ok, err, table }}
 */
export function runPipelineScript({ language, dataset, allDatasets = {}, dir }) {
  mkdirSync(dir, { recursive: true });
  const stem   = `${dataset.id}_pipeline_${language}`;
  const outCsv = path.join(dir, `${stem}.out.csv`);
  const file   = path.join(dir, `${stem}.${EXT[language]}`);
  rmSync(outCsv, { force: true });

  let script = generateCleanScript({
    language,
    datasetName: dataset.name,
    // The recipe stores a bare filename; the script must point at the real file.
    filename: fwd(dataset.file),
    pipeline: dataset.steps,
    allDatasets,
    loadOpts: dataset.loadOpts,
    preview: false,
  });
  const dfVar = language === "stata" ? null : toDfVar(dataset.name);
  script += `\n\n${exportLine(language, dfVar, outCsv)}\n`;
  writeFileSync(file, script);

  const res = run(language, file, dir);
  const err = language === "stata" ? (stataLogError(file) || (res.ok ? "" : res.err)) : (res.ok ? "" : res.err);
  let table = null;
  if (existsSync(outCsv)) {
    const text = readFileSync(outCsv, "utf8");
    table = parseCSV(text, ",");
  }
  return { language, script: file, ok: !err && !!table, err: err || (table ? "" : "no output table written"), table };
}

/**
 * Emit + run the WORKSPACE script (every dataset, derived ones rebuilt from
 * their lineage) and read back one table per dataset. Source files are copied
 * into `dir` and the script runs there with relative paths — the Stata version
 * saves every intermediate as <name>.dta in its working directory, which must
 * never be the real data folder.
 * @param datasets  Map from loadProjectUnit
 * @returns {{ language, script, ok, err, tables: Map<id, table> }}
 */
export function runWorkspaceScript({ language, datasets, globalPipeline, dir }) {
  mkdirSync(dir, { recursive: true });
  const wsDatasets = {};
  for (const d of datasets.values()) {
    if (d.file) copyFileSync(d.file, path.join(dir, path.basename(d.file)));
    // A Stata run of an .RData dataset reads the sibling .dta, as the script says.
    if (d.file && /\.(rdata|rda)$/i.test(d.file)) {
      const dta = d.file.replace(/\.(rdata|rda)$/i, ".dta");
      if (existsSync(dta)) copyFileSync(dta, path.join(dir, path.basename(dta)));
    }
    wsDatasets[d.id] = {
      id: d.id, name: d.name, filename: d.file ? path.basename(d.file) : d.filename,
      loadOpts: d.loadOpts, pipeline: d.steps ?? [],
    };
  }
  const { perDataset, crossDataset } = generateWorkspaceScript({ language, datasets: wsDatasets, globalPipeline });
  const stem = `workspace_${language}`;
  const file = path.join(dir, `${stem}.${EXT[language]}`);
  const outFor = (d) => path.join(dir, `${stem}__${d.id}.out.csv`);
  const exports = [...datasets.values()].map(d => {
    rmSync(outFor(d), { force: true });
    if (language === "stata") return `use "${toStataFile(d.name)}", clear\n${exportLine("stata", null, outFor(d))}`;
    return exportLine(language, toDfVar(d.name), outFor(d));
  });
  writeFileSync(file, `${perDataset}\n\n${crossDataset}\n\n${exports.join("\n")}\n`);

  const res = run(language, file, dir);
  const err = language === "stata" ? (stataLogError(file) || (res.ok ? "" : res.err)) : (res.ok ? "" : res.err);
  const tables = new Map();
  for (const d of datasets.values()) {
    if (existsSync(outFor(d))) tables.set(d.id, parseCSV(readFileSync(outFor(d), "utf8"), ","));
  }
  return { language, script: file, ok: !err, err, tables };
}

/**
 * Run an arbitrary emitted model script with a dump block already appended by
 * the caller; returns the parsed dump.
 */
export function runDumpScript({ language, script, dir, stem, dumpFile }) {
  mkdirSync(dir, { recursive: true });
  const file = path.join(dir, `${stem}.${EXT[language]}`);
  rmSync(dumpFile, { force: true });
  writeFileSync(file, script);
  const res = run(language, file, dir);
  const err = language === "stata" ? (stataLogError(file) || (res.ok ? "" : res.err)) : (res.ok ? "" : res.err);
  const dump = existsSync(dumpFile) ? JSON.parse(readFileSync(dumpFile, "utf8")) : null;
  return { language, script: file, ok: !err && !!dump, err: err || (dump ? "" : "no dump written"), dump };
}
