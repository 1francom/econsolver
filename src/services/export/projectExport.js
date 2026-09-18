// ─── ECON STUDIO · services/export/projectExport.js ──────────────────────────
// "Export project" — one plain JSON file with everything a project IS, minus
// the data itself: the dataset registry (filename + load options), each
// dataset's pipeline, the cross-dataset global pipeline, pinned model specs,
// saved plots and maps, Explore pins, and the Calculate/Simulate workbench.
//
// It is a RECIPE, not a snapshot: rows never leave IndexedDB, so the file is
// small and carries no data the user did not intend to move. Feed it the same
// source files and everything reproduces — which is exactly what the real-data
// validation harness does headlessly (docs/superpowers/plans/
// 2026-09-17-real-data-validation.md), and what makes the file a usable local
// backup of the work itself.
//
// Deliberately NOT exported: cloud-sync metadata (per-machine), coach chats
// (conversation, not recipe), and raw rows.

import {
  listProjects, loadProjectPipelines, loadDatasetRegistry, loadSessionMeta,
  loadModelBuffer, loadSpatialMaps, loadWorkbenchRecord,
} from "../Persistence/indexedDB.js";
import { getPlotHistory, getMapHistory, getExplorePins } from "../Persistence/plotHistory.js";
import { getArtifactOrder } from "../Persistence/artifactOrder.js";
import { buildModelFile, buildPlotsFile } from "./artifactIO.js";

export const PROJECT_EXPORT_KIND = "litux/project-export";
export const PROJECT_EXPORT_VERSION = 1;
// Suffixes PlotBuilder instances append to their history key (see buildProjectExport).
export const PLOT_KEY_SUFFIXES = ["_model", "_spec", "_bacon"];

// Sync/session bookkeeping is about THIS browser, not about the project.
const PROJECT_META_DROP = new Set([
  "published", "dirty", "lastSyncedVersion", "syncedAt", "cloudVersion", "shareToken",
]);

const pickProjectMeta = (p = {}) =>
  Object.fromEntries(Object.entries(p).filter(([k]) => !PROJECT_META_DROP.has(k)));

// The panel declaration carries validatePanel's cached output, whose `pres`
// matrix is entities × periods: on a 17 × 754 panel it was 99% of a 363 KB
// export (13.8k lines) for a two-step pipeline. It is derived data — the app
// recomputes it from entityCol/timeCol — so only the verdicts the UI reads
// (balance, blockFD) and the few duplicate examples are kept.
function compactPanel(panel) {
  if (!panel?.validation) return panel ?? null;
  const { balance, blockFD, dups } = panel.validation;
  return { ...panel, validation: { balance, blockFD, dups } };
}

export const compactPipelines = (pipes = {}) =>
  Object.fromEntries(Object.entries(pipes).map(([id, p]) =>
    [id, p && typeof p === "object" ? { ...p, panel: compactPanel(p.panel) } : p]));

// Plot/map/pin histories are keyed per project AND per dataset (ExplorerModule
// passes `projectPid ?? pid`, PlotBuilder's history is per dataset), so every
// key is collected and kept under its own id rather than merged — merging would
// lose which dataset a plot belongs to.
async function collectByKey(fn, keys) {
  const out = {};
  for (const key of keys) {
    try {
      const v = await fn(key);
      if (Array.isArray(v) ? v.length : v) out[key] = v;
    } catch { /* a missing history is just absent */ }
  }
  return out;
}

/**
 * @param {string} pid
 * @returns {Promise<object>} the export payload (also what `parseProjectExport` accepts)
 */
export async function buildProjectExport(pid) {
  if (!pid) throw new Error("buildProjectExport: pid required");
  const project = (await listProjects()).find(p => p.pid === pid);
  if (!project) throw new Error("Project not found.");

  const registry   = (await loadDatasetRegistry(pid)) ?? [];
  const pipeRecord = (await loadProjectPipelines(pid)) ?? {};
  const session    = (await loadSessionMeta(pid)) ?? {};
  // loadModelBuffer returns the STORE RECORD { pid, models, ts }, not the list —
  // reading it as the list exported every project with `models: []`.
  const pins       = (await loadModelBuffer(pid))?.models ?? [];
  const keys       = [pid, ...registry.map(d => d?.id).filter(Boolean)];

  return {
    kind:    PROJECT_EXPORT_KIND,
    version: PROJECT_EXPORT_VERSION,
    exportedAt: new Date().toISOString(),
    project: pickProjectMeta(project),
    // Registry rows already hold filename + loadOpts + headers + rowCount, i.e.
    // everything needed to re-read the source file exactly as the app did.
    datasets: registry,
    // { [datasetId]: { steps, panel, dataDictionary, branchPointIndex } }
    pipelines: compactPipelines(pipeRecord.datasetPipelines ?? {}),
    globalPipeline: session.globalPipeline ?? [],
    calcWorkspace:  session.calcWorkspace  ?? null,
    // Model specs only — buildModelFile never writes coefficients.
    models: buildModelFile(pins),
    // Plot histories also live under suffixed keys: the Model tab's Plot Builder
    // saves as `<pid>_model` (result plots) and `<pid>_spec` (spec curve), and
    // Explore's Goodman-Bacon mode as `<pid>_bacon`. Collecting only the bare
    // keys silently left every Model-tab plot out of the export.
    plots:       await collectByKey(async k => buildPlotsFile(await getPlotHistory(k), { keepDataset: true }),
      keys.flatMap(k => [k, ...PLOT_KEY_SUFFIXES.map(s => `${k}${s}`)])),
    maps:        await collectByKey(getMapHistory, keys),
    explorePins: await collectByKey(getExplorePins, keys),
    spatialMaps: (await loadSpatialMaps(pid)) ?? null,
    workbench:   (await loadWorkbenchRecord(pid)) ?? null,
    artifactOrder: (await getArtifactOrder(pid)) ?? null,
  };
}

/**
 * Validate a file produced by buildProjectExport. Deny-by-default on the kind,
 * the same shape as artifactIO's parsers: a file that is not ours must not be
 * half-applied.
 */
export function parseProjectExport(text) {
  let payload;
  try { payload = JSON.parse(text); }
  catch { throw new Error("Not a valid JSON file."); }
  if (payload?.kind !== PROJECT_EXPORT_KIND) {
    throw new Error(`Not a Litux project export (kind: ${payload?.kind ?? "missing"}).`);
  }
  if (Number(payload.version) > PROJECT_EXPORT_VERSION) {
    throw new Error(`This file was written by a newer version of Litux (v${payload.version}).`);
  }
  if (!Array.isArray(payload.datasets)) throw new Error("Project export has no dataset list.");
  return payload;
}

export function projectExportFilename(payload) {
  const name = String(payload?.project?.name || payload?.project?.pid || "project")
    .replace(/[^\w.-]+/g, "_").slice(0, 60);
  return `${name}.litux.json`;
}
