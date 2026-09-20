// ─── ECON STUDIO · services/export/unifiedScript.js ──────────────────────────
// The Report's unified replication script, built DETERMINISTICALLY.
//
// Why this exists: the old path concatenated self-contained pieces and handed
// them to an LLM to rewrite. Every piece assumed it ran alone — each model was a
// whole do-file (`clear all` + reload of its dataset), a derived dataset was
// `import delimited "<name>"` as if it were a file, an Explore pin `collapse`d
// whatever happened to be in memory. In R/Python that mostly survives because
// data frames have names; in Stata, with one dataset in memory, the do-file
// could not run (LMU PS4 died at line 8). When the model rewrote it, it also
// rewrote the DATA PREP — PS5's `municipality != 1` filter vanished from the
// subsets and N came out one too high. And when the model call failed, the raw
// concatenation was returned as if it were the script.
//
// The structure now:
//   1. Data — every dataset built ONCE, from its raw file and its lineage
//      (generateWorkspaceScript: the same code checkPipelines.mjs runs and
//      compares cell by cell against the app). Stata saves each as <name>.dta.
//   2. Analysis — models, Explore pins, plots, maps and spatial ops in the order
//      the caller gives, each bound to ITS OWN dataset: `use "<name>.dta"` in
//      Stata (pins and plots inside preserve/restore, since they collapse), the
//      df_<name> variable in R and Python. A model contributes its estimation
//      lines only — it no longer reloads anything.
//   3. Results — the stored models side by side.
// No LLM touches this code. The Report may add AI commentary as a separate
// comment block (see generateScriptNotes), never by rewriting the script.

import { generateWorkspaceScript, toDfVar, toStataFile } from "../../pipeline/exporter.js";
import { rModelCode, rModelPackages } from "./rScript.js";
import { stataModelLines } from "./stataScript.js";
import { pythonModelLines, pythonModelPackages } from "./pythonScript.js";
import { transpileExploreStat } from "./exploreStatScript.js";
import { buildGgplot, buildMatplotlibPlot, buildStataPlot } from "./plotScript.js";
import { exportSpecExtras } from "./exportSpecExtras.js";

const RULE = "─".repeat(66);
const cmtOf = (lang) => (lang === "stata" ? "*" : "#");
const section = (lang, title) => `${cmtOf(lang)} ${"═".repeat(70)}\n${cmtOf(lang)} ${title}\n${cmtOf(lang)} ${"═".repeat(70)}`;
const sub = (lang, title) => `${cmtOf(lang)} ── ${title} ${RULE.slice(0, Math.max(4, 62 - title.length))}`;


/**
 * Resolve an item's dataset (by id, name or filename) against the build map.
 * @returns {{ id, name } | null}
 */
export function resolveDataset(datasets, ref) {
  if (!ref) return null;
  const list = Object.values(datasets ?? {});
  return list.find(d => d.id === ref) ?? list.find(d => d.name === ref) ?? list.find(d => d.filename === ref) ?? null;
}

/**
 * The exporter `model` object for a pinned/active EstimationResult — the same
 * fields the Code panel and the Report have always passed. One owner, so the
 * Report and the validation harness cannot build different configs.
 */
export function modelConfigFromResult(result) {
  const spec = result?.spec ?? {};
  return {
    ...exportSpecExtras(result),
    type:       result?.type      ?? "OLS",
    yVar:       spec.yVar       ?? "",
    xVars:      spec.xVars      ?? [],
    wVars:      spec.wVars      ?? [],
    zVars:      spec.zVars      ?? [],
    entityCol:  spec.entityCol  ?? null,
    timeCol:    spec.timeCol    ?? null,
    postVar:    spec.postVar    ?? null,
    treatVar:   spec.treatVar   ?? null,
    runningVar: spec.runningVar ?? null,
    cutoff:     spec.cutoff     ?? null,
    bandwidth:  spec.bandwidth  ?? null,
    kernel:     spec.kernel     ?? "triangular",
    factorVars:       spec.factorVars       ?? [],
    factorRefs:       spec.factorRefs       ?? {},
    factorMap:        result?.factorMap     ?? null,
    interactionTerms: spec.interactionTerms ?? [],
    xVarsRaw:         spec.xVarsRaw         ?? null,
    wVarsRaw:         spec.wVarsRaw         ?? null,
    seType:      spec.seType ?? result?.seType ?? "classical",
    clusterVar:  spec.clusterVar  ?? null,
    clusterVar2: spec.clusterVar2 ?? null,
    noIntercept: spec.noIntercept ?? false,
  };
}

function useLine(ds) {
  return `use "${toStataFile(ds.name)}", clear`;
}

/**
 * @param {object} p
 * @param {"r"|"python"|"stata"} p.lang
 * @param {Record<string,{id,name,filename,pipeline,loadOpts,origin?}>} p.datasets
 * @param {object[]} p.globalPipeline
 * @param {Array<
 *   {kind:"model", label, dataset, model, pipeline?} |
 *   {kind:"explore", label, dataset, params} |
 *   {kind:"plot", label, dataset, entry} |
 *   {kind:"code", label, code}
 * >} p.items   in the order they should appear
 * @param {string} [p.title]
 * @returns {string}
 */
export function buildUnifiedScript({ lang, datasets = {}, globalPipeline = [], items = [], title = "Unified replication script", afterModel = null }) {
  const cm = cmtOf(lang);
  const out = [];
  const date = new Date().toISOString().slice(0, 10);

  // ── Header + setup ─────────────────────────────────────────────────────────
  out.push(section(lang, `Litux — ${title} (${lang === "r" ? "R" : lang === "stata" ? "Stata" : "Python"}) · ${date}`));
  out.push(`${cm} 1. Data: every dataset is built once, from its raw file and its recorded`);
  out.push(`${cm}    lineage, exactly as Litux built it.`);
  out.push(`${cm} 2. Analysis: models, descriptive stats and plots, each on its own dataset.`);
  out.push(`${cm} 3. Results.`);
  out.push(`${cm} Run it from the folder that holds the data files.`);
  out.push("");

  const models = items.filter(i => i.kind === "model");
  if (lang === "r") {
    const pkgs = new Set();
    for (const m of models) for (const p of rModelPackages(m.model, m.pipeline ?? [])) pkgs.add(p);
    if (pkgs.size) {
      out.push(`${cm} install.packages(c(${[...pkgs].sort().map(p => `"${p}"`).join(", ")}))  # if needed`);
    }
  } else if (lang === "python") {
    const pkgs = new Set();
    for (const m of models) for (const p of pythonModelPackages(m.model, m.pipeline ?? [])) pkgs.add(p);
    out.push("import pandas as pd");
    out.push("import numpy as np");
    if (pkgs.has("statsmodels") || models.length) {
      out.push("import statsmodels.formula.api as smf");
      out.push("import statsmodels.api as sm");
      out.push("from patsy.contrasts import Treatment");
      out.push("from patsy import dmatrix");
    }
    if (pkgs.has("linearmodels")) {
      out.push("from linearmodels.panel import PanelOLS, FirstDifferenceOLS, BetweenOLS");
      out.push("from linearmodels.iv import IV2SLS");
    }
    if (pkgs.has("scipy")) out.push("from scipy import stats");
    out.push("import matplotlib.pyplot as plt");
  } else {
    out.push("clear all");
    out.push("set more off");
    out.push("version 17");
  }
  out.push("");

  // ── 1. Data ────────────────────────────────────────────────────────────────
  out.push(section(lang, "1. Data"));
  const ws = generateWorkspaceScript({ language: lang, datasets, globalPipeline });
  // The workspace script opens with its own `version 17` / `set more off`; this
  // script already set them (plus `clear all`), so the repeat is dropped.
  const NL = String.fromCharCode(10);
  out.push(lang === "stata"
    ? ws.perDataset.split(NL).filter(l => !/^(version 17|set more off)$/.test(l.trim())).join(NL)
    : ws.perDataset);
  if (ws.crossDataset?.trim()) out.push(ws.crossDataset);
  out.push("");

  // ── 2. Analysis ────────────────────────────────────────────────────────────
  out.push(section(lang, "2. Analysis"));
  const stored = [];   // { name, label }
  let mi = 0;
  for (const it of items) {
    const ds = it.kind === "code" ? null : resolveDataset(datasets, it.dataset);
    const dfVar = ds ? toDfVar(ds.name) : "df";
    const unbound = it.kind !== "code" && !ds
      ? [`${cm} NOTE: the dataset of this block (${it.dataset ?? "unknown"}) is not in this project — bind it by hand.`]
      : [];
    out.push("");
    out.push(sub(lang, `${it.label ?? it.kind}${ds ? ` · ${ds.name}` : ""}`));
    out.push(...unbound);

    if (it.kind === "model") {
      mi += 1;
      const name = `m${mi}`;
      if (lang === "stata") {
        if (ds) out.push(useLine(ds));
        out.push(...stataModelLines(it.model));
        out.push(`estimates store ${name}`);
      } else if (lang === "r") {
        // A local working copy, not a text substitution: some blocks narrow `df`
        // for their own fit (an RDD bandwidth window), which must not leak into
        // the next block's data.
        out.push(`df <- ${dfVar}`);
        out.push(rModelCode(it.model));
        // Every R estimator block leaves its fit in `fit` (rdrobust objects are
        // not tabulable, so they are printed where they are fitted instead).
        if (!/RDD/.test(it.model?.type ?? "")) out.push(`.lx_models[[${JSON.stringify(it.label ?? name)}]] <- fit`);
      } else {
        out.push(`df = ${dfVar}.copy()`);
        out.push(pythonModelLines(it.model).join("\n"));
      }
      // Validation hook (tools/validation/checkUnified.mjs): extra lines right
      // after the fit, while the language's "current model" is still this one.
      if (afterModel) out.push(...[].concat(afterModel(name, it) ?? []));
      stored.push({ name, label: it.label ?? name });
    } else if (it.kind === "explore") {
      const code = transpileExploreStat(it.params, lang, dfVar);
      if (!code) { out.push(`${cm} (no code translation for this Explore item)`); continue; }
      if (lang === "stata") {
        // Descriptive commands often collapse the data — never let them change
        // what the next block sees.
        out.push("preserve");
        if (ds) out.push(useLine(ds));
        out.push(code);
        out.push("restore");
      } else out.push(code);
    } else if (it.kind === "plot") {
      if (lang === "stata") {
        const code = buildStataPlot(it.entry, { dataVar: dfVar });
        out.push("preserve");
        if (ds) out.push(useLine(ds));
        out.push(code || `${cm} (no Stata translation for this plot)`);
        out.push("restore");
      } else if (lang === "r") {
        out.push(buildGgplot(it.entry, { dfVar }) || `${cm} (no R translation for this plot)`);
      } else {
        out.push(buildMatplotlibPlot(it.entry, { dfVar }) || `${cm} (no Python translation for this plot)`);
      }
    } else {
      out.push(it.code ?? `${cm} (empty)`);
    }
  }
  out.push("");

  // ── 3. Results ─────────────────────────────────────────────────────────────
  if (stored.length) {
    out.push(section(lang, "3. Results"));
    if (lang === "stata") {
      out.push(`estimates table ${stored.map(s => s.name).join(" ")}, b(%9.4f) se(%9.4f) stats(N r2)`);
      stored.forEach(s => out.push(`${cm}   ${s.name} = ${s.label}`));
    } else if (lang === "r") {
      out.push(`# Printed to the console — no pandoc needed (a .docx output would require it).`);
      out.push(`if (length(.lx_models)) print(modelsummary::modelsummary(.lx_models, output = "markdown", stars = TRUE))`);
    } else {
      out.push(`# Each model's summary is printed where it is fitted.`);
    }
  }
  let script = out.join("\n");
  if (lang === "r" && stored.length) {
    // The collector must exist before the first model block.
    script = script.replace(section(lang, "2. Analysis"), `${section(lang, "2. Analysis")}\n.lx_models <- list()`);
  }
  return script + "\n";
}
