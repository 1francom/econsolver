// ─── ECON STUDIO · pipeline/exporter.js ──────────────────────────────────────
// Script generation for pipeline export.
//
// Two entry points:
//   generateCleanScript({ language, datasetName, filename, pipeline, allDatasets })
//     → single-dataset script (used by Clean tab export bar)
//
//   generateWorkspaceScript({ language, datasets, globalPipeline })
//     → multi-dataset script with topological DAG ordering (used by full export)
//
// Pure JS, no React imports.

import { toR, toStata, toPython } from "./stepTranslators.js";

// ─── LANGUAGE METADATA ───────────────────────────────────────────────────────

const LANG = {
  r:      { ext: "R",    comment: "#",  blockComment: (s) => `# ${"─".repeat(70)}\n# ${s}\n# ${"─".repeat(70)}` },
  stata:  { ext: "do",  comment: "*",  blockComment: (s) => `* ${"─".repeat(70)}\n* ${s}\n* ${"─".repeat(70)}` },
  python: { ext: "py",  comment: "#",  blockComment: (s) => `# ${"─".repeat(70)}\n# ${s}\n# ${"─".repeat(70)}` },
};

// ─── HEADERS ─────────────────────────────────────────────────────────────────

function rHeader(datasetName) {
  return [
    `# ${"─".repeat(70)}`,
    `# Litux — Replication Script (R)`,
    `# Dataset: ${datasetName}`,
    `# Generated: ${new Date().toISOString().slice(0, 10)}`,
    `# ${"─".repeat(70)}`,
    ``,
    `library(dplyr)`,
    `library(tidyr)`,
    `library(stringr)`,
    `library(lubridate)`,
    `library(readr)`,
    ``,
  ].join("\n");
}

function stataHeader(datasetName) {
  return [
    `* ${"─".repeat(70)}`,
    `* Litux — Replication Script (Stata)`,
    `* Dataset: ${datasetName}`,
    `* Generated: ${new Date().toISOString().slice(0, 10)}`,
    `* ${"─".repeat(70)}`,
    ``,
    `version 17`,
    `set more off`,
    ``,
  ].join("\n");
}

function pythonHeader(datasetName) {
  return [
    `# ${"─".repeat(70)}`,
    `# Litux — Replication Script (Python)`,
    `# Dataset: ${datasetName}`,
    `# Generated: ${new Date().toISOString().slice(0, 10)}`,
    `# ${"─".repeat(70)}`,
    ``,
    `import pandas as pd`,
    `import numpy as np`,
    ``,
  ].join("\n");
}

// ─── SAFE IDENTIFIER HELPERS ──────────────────────────────────────────────────

function toDfVar(name) {
  // Convert dataset name to a safe R/Python variable name
  return "df_" + name.replace(/[^a-zA-Z0-9_]/g, "_").replace(/^[0-9]/, "_");
}

function toStataFile(name) {
  return name.replace(/[^a-zA-Z0-9_]/g, "_") + ".dta";
}

// ─── SINGLE-DATASET SCRIPT ────────────────────────────────────────────────────

/**
 * Generate a script for a single dataset's local pipeline.
 *
 * @param {object} opts
 * @param {"r"|"stata"|"python"} opts.language
 * @param {string} opts.datasetName   - Human-readable name
 * @param {string} opts.filename      - Original filename (csv/xlsx/dta…)
 * @param {object[]} opts.pipeline    - Array of step objects
 * @param {object}  opts.allDatasets  - { id: { name, filename } } — for resolving join/append names
 * @returns {string}
 */
export function generateCleanScript({ language, datasetName, filename, pipeline, allDatasets = {} }) {
  const lang = LANG[language];
  if (!lang) throw new Error(`Unknown language: ${language}`);

  if (language === "r") {
    const df   = toDfVar(datasetName);
    const file = filename ? `"${filename}"` : `"<path_to_${datasetName.replace(/\s+/g, "_")}.csv>"`;
    const lines = [
      rHeader(datasetName),
      `# ── Load dataset ──`,
      `${df} <- readr::read_csv(${file})`,
      ``,
    ];
    if (pipeline.length) {
      lines.push(`# ── Pipeline steps ──`);
      for (const step of pipeline) {
        lines.push(toR(step, df, allDatasets));
      }
      lines.push(``);
    }
    lines.push(`# ── Result ──`);
    lines.push(`head(${df})`);
    return lines.join("\n");
  }

  if (language === "stata") {
    const file = filename ? `"${filename}"` : `"<path_to_${datasetName.replace(/\s+/g, "_")}.dta>"`;
    const lines = [
      stataHeader(datasetName),
      `* ── Load dataset ──`,
      `import delimited ${file}, clear`,
      ``,
    ];
    if (pipeline.length) {
      lines.push(`* ── Pipeline steps ──`);
      for (const step of pipeline) {
        lines.push(toStata(step, "df", allDatasets));
      }
      lines.push(``);
    }
    lines.push(`* ── Preview ──`);
    lines.push(`list in 1/5`);
    return lines.join("\n");
  }

  if (language === "python") {
    const df   = toDfVar(datasetName);
    const file = filename ? `"${filename}"` : `"<path_to_${datasetName.replace(/\s+/g, "_")}.csv>"`;
    const lines = [
      pythonHeader(datasetName),
      `# ── Load dataset ──`,
      `${df} = pd.read_csv(${file})`,
      ``,
    ];
    if (pipeline.length) {
      lines.push(`# ── Pipeline steps ──`);
      for (const step of pipeline) {
        lines.push(toPython(step, df, allDatasets));
      }
      lines.push(``);
    }
    lines.push(`# ── Preview ──`);
    lines.push(`print(${df}.head())`);
    return lines.join("\n");
  }

  return "";
}

// ─── TOPOLOGICAL SORT ─────────────────────────────────────────────────────────

/**
 * Return dataset IDs in topological order based on G-step dependencies.
 * A dataset that is used as the "right" operand in a join must be available
 * before the left dataset can be joined.
 *
 * @param {object[]} datasets      - Array of { id, name }
 * @param {object[]} globalPipeline - G-steps with leftDatasetId / rightDatasetId
 * @returns {string[]} ordered dataset IDs
 */
function topoSort(datasets, globalPipeline) {
  const ids = datasets.map(d => d.id);

  // Build adjacency: rightId must be processed before leftId
  const deps = {}; // id → Set of ids it depends on
  for (const id of ids) deps[id] = new Set();

  for (const g of globalPipeline) {
    if (g.rightDatasetId && deps[g.leftDatasetId]) {
      deps[g.leftDatasetId].add(g.rightDatasetId);
    }
  }

  // Kahn's algorithm
  const inDegree = {};
  for (const id of ids) inDegree[id] = 0;
  for (const id of ids) {
    for (const dep of deps[id]) {
      if (inDegree[dep] !== undefined) inDegree[dep]++;
    }
  }

  const queue  = ids.filter(id => inDegree[id] === 0);
  const result = [];

  while (queue.length) {
    const curr = queue.shift();
    result.push(curr);
    for (const id of ids) {
      if (deps[id].has(curr)) {
        deps[id].delete(curr);
        if (deps[id].size === 0) queue.push(id);
      }
    }
  }

  // Append any ids not reached (cycles → append as-is)
  for (const id of ids) {
    if (!result.includes(id)) result.push(id);
  }

  return result;
}

// ─── MULTI-DATASET (WORKSPACE) SCRIPT ────────────────────────────────────────

/**
 * Generate a workspace-level script with all datasets in topological order.
 *
 * @param {object} opts
 * @param {"r"|"stata"|"python"} opts.language
 * @param {object}  opts.datasets        - { id: { id, name, filename, pipeline } }
 * @param {object[]} opts.globalPipeline - G-steps array
 * @returns {string}
 */
export function generateWorkspaceScript({ language, datasets, globalPipeline = [] }) {
  const dsList = Object.values(datasets);
  if (!dsList.length) return `# No datasets in session`;

  const allDatasets = Object.fromEntries(dsList.map(d => [d.id, { name: d.name, filename: d.filename }]));

  // Topological order
  const orderedIds = topoSort(dsList, globalPipeline);
  const ordered    = orderedIds.map(id => datasets[id]).filter(Boolean);

  // ── R ──
  if (language === "r") {
    const lines = [rHeader("Workspace — All Datasets")];
    for (const ds of ordered) {
      const df   = toDfVar(ds.name);
      const file = ds.filename
        ? `"${ds.filename}"`
        : `"<path_to_${ds.name.replace(/\s+/g, "_")}.csv>"`;
      lines.push(`# ${"─".repeat(60)}`);
      lines.push(`# Dataset: ${ds.name}`);
      lines.push(`# ${"─".repeat(60)}`);
      lines.push(`${df} <- readr::read_csv(${file})`);
      for (const step of (ds.pipeline ?? [])) {
        lines.push(toR(step, df, allDatasets));
      }
      lines.push(``);
    }
    if (globalPipeline.length) {
      lines.push(`# ${"─".repeat(60)}`);
      lines.push(`# Cross-dataset interactions`);
      lines.push(`# ${"─".repeat(60)}`);
      for (const g of globalPipeline) {
        const leftDs  = datasets[g.leftDatasetId];
        const rightDs = datasets[g.rightDatasetId];
        if (!leftDs) continue;
        const leftDf  = toDfVar(leftDs.name);
        const rightDf = rightDs ? toDfVar(rightDs.name) : "right_df";
        if (g.opType === "join" || g.opType === "left_join" || g.opType === "inner_join") {
          const how = g.opType === "inner_join" ? "inner_join" : "left_join";
          const lk  = g.params?.leftKey  ? `"${g.params.leftKey}"`  : "<left_key>";
          const rk  = g.params?.rightKey ? `"${g.params.rightKey}"` : "<right_key>";
          lines.push(`${leftDf} <- dplyr::${how}(${leftDf}, ${rightDf}, by = c(${lk} = ${rk}))`);
        } else if (g.opType === "append") {
          lines.push(`${leftDf} <- dplyr::bind_rows(${leftDf}, ${rightDf})`);
        } else {
          lines.push(`# G-step: ${g.opType} — ${leftDs.name} ← ${rightDs?.name ?? "?"}`);
        }
      }
      lines.push(``);
    }
    return lines.join("\n");
  }

  // ── Stata ──
  if (language === "stata") {
    const lines = [stataHeader("Workspace — All Datasets")];
    // Stata needs to pre-save all datasets, then use them in order
    lines.push(`* Pre-materialization pass — save all cleaned datasets to .dta`);
    lines.push(``);

    for (const ds of ordered) {
      const file    = ds.filename
        ? `"${ds.filename}"`
        : `"<path_to_${ds.name.replace(/\s+/g, "_")}.csv>"`;
      const dtaFile = toStataFile(ds.name);
      lines.push(`* ${"─".repeat(60)}`);
      lines.push(`* Dataset: ${ds.name}`);
      lines.push(`* ${"─".repeat(60)}`);
      lines.push(`import delimited ${file}, clear`);
      for (const step of (ds.pipeline ?? [])) {
        lines.push(toStata(step, "df", allDatasets));
      }
      lines.push(`save "${dtaFile}", replace`);
      lines.push(``);
    }

    if (globalPipeline.length) {
      lines.push(`* ${"─".repeat(60)}`);
      lines.push(`* Cross-dataset interactions`);
      lines.push(`* ${"─".repeat(60)}`);
      for (const g of globalPipeline) {
        const leftDs  = datasets[g.leftDatasetId];
        const rightDs = datasets[g.rightDatasetId];
        if (!leftDs) continue;
        const leftFile  = toStataFile(leftDs.name);
        const rightFile = rightDs ? toStataFile(rightDs.name) : "<right_dataset.dta>";
        const lk        = g.params?.leftKey ?? "<left_key>";
        if (g.opType === "join" || g.opType === "left_join" || g.opType === "inner_join") {
          lines.push(`use "${leftFile}", clear`);
          lines.push(`merge m:1 ${toStataFile(lk)} using "${rightFile}"`);
          lines.push(`drop if _merge == 2`);
          lines.push(`drop _merge`);
          lines.push(`save "${leftFile}", replace`);
        } else if (g.opType === "append") {
          lines.push(`use "${leftFile}", clear`);
          lines.push(`append using "${rightFile}"`);
          lines.push(`save "${leftFile}", replace`);
        } else {
          lines.push(`* G-step: ${g.opType} — ${leftDs.name} ← ${rightDs?.name ?? "?"}`);
        }
      }
      lines.push(``);
    }
    return lines.join("\n");
  }

  // ── Python ──
  if (language === "python") {
    const lines = [pythonHeader("Workspace — All Datasets")];
    for (const ds of ordered) {
      const df   = toDfVar(ds.name);
      const file = ds.filename
        ? `"${ds.filename}"`
        : `"<path_to_${ds.name.replace(/\s+/g, "_")}.csv>"`;
      lines.push(`# ${"─".repeat(60)}`);
      lines.push(`# Dataset: ${ds.name}`);
      lines.push(`# ${"─".repeat(60)}`);
      lines.push(`${df} = pd.read_csv(${file})`);
      for (const step of (ds.pipeline ?? [])) {
        lines.push(toPython(step, df, allDatasets));
      }
      lines.push(``);
    }
    if (globalPipeline.length) {
      lines.push(`# ${"─".repeat(60)}`);
      lines.push(`# Cross-dataset interactions`);
      lines.push(`# ${"─".repeat(60)}`);
      for (const g of globalPipeline) {
        const leftDs  = datasets[g.leftDatasetId];
        const rightDs = datasets[g.rightDatasetId];
        if (!leftDs) continue;
        const leftDf  = toDfVar(leftDs.name);
        const rightDf = rightDs ? toDfVar(rightDs.name) : "right_df";
        const lk = g.params?.leftKey  ? `"${g.params.leftKey}"`  : "<left_key>";
        const rk = g.params?.rightKey ? `"${g.params.rightKey}"` : "<right_key>";
        if (g.opType === "join" || g.opType === "left_join" || g.opType === "inner_join") {
          const how = g.opType === "inner_join" ? "inner" : "left";
          lines.push(`${leftDf} = pd.merge(${leftDf}, ${rightDf}, left_on=${lk}, right_on=${rk}, how="${how}")`);
        } else if (g.opType === "append") {
          lines.push(`${leftDf} = pd.concat([${leftDf}, ${rightDf}], ignore_index=True)`);
        } else {
          lines.push(`# G-step: ${g.opType} — ${leftDs.name} ← ${rightDs?.name ?? "?"}`);
        }
      }
      lines.push(``);
    }
    return lines.join("\n");
  }

  return "";
}
