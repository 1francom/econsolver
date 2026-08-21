// ─── ECON STUDIO · services/export/artifactIO.js ─────────────────────────────
// Build + parse the two module-level artifact files, mirroring Clean's
// pipeline.json round-trip:
//   model.json  — pinned model SPECS (the recipe; never coefficients)
//   plots.json  — saved PlotBuilder history entries
//
// PURE JS, no React import: the allowed-id vocabularies (estimator ids, SE type
// ids, geoms, palette schemes) are PARAMETERS, not imports, because they live in
// .jsx files that a node harness cannot load. Callers inside React pass the real
// ones; __validation__/artifactIOValidation.mjs passes its own.

const MODEL_KIND = "litux/model-specs";
const PLOTS_KIND = "litux/plots";

// Session-local identity that must never travel: a foreign id points at a
// dataset/entry that does not exist in the importing session.
const PLOT_STRIP = ["id", "savedAt", "datasetId", "datasetName"];

function err(msg) { return { ok: false, error: msg }; }

function readJSON(text) {
  try { return { ok: true, value: JSON.parse(text) }; }
  catch { return err("Not valid JSON."); }
}

// Names the file you actually supplied, so feeding plots.json to the model
// importer says so instead of failing on a missing field.
function kindMismatch(got, want) {
  const human = got === MODEL_KIND ? "a model file" : got === PLOTS_KIND ? "a plots file" : "an unrecognised file";
  return err(`This is ${human}${got ? ` (kind: ${got})` : ""} — expected ${want}.`);
}

// ── model.json ───────────────────────────────────────────────────────────────

export function buildModelFile(pins = []) {
  return {
    version: 1,
    kind: MODEL_KIND,
    exportedAt: new Date().toISOString(),
    models: pins.map(p => ({
      label:  p.label ?? p.modelLabel ?? null,
      type:   p.type ?? p.spec?.model ?? null,
      family: p.spec?.family ?? "linear",
      spec:   p.spec ?? {},
    })),
  };
}

// vocab = { modelIds: string[], seTypeIds: string[] }
export function parseModelFile(text, vocab = {}) {
  const read = readJSON(text);
  if (!read.ok) return read;
  const p = read.value;
  if (p?.kind !== MODEL_KIND) return kindMismatch(p?.kind, "a model file");
  if (!Array.isArray(p.models)) return err("Expected a `models` array.");
  if (!p.models.length)         return err("This file is empty — no models to import.");

  const modelIds  = new Set(vocab.modelIds ?? []);
  const seTypeIds = new Set(vocab.seTypeIds ?? []);
  const families  = new Set(vocab.families ?? []);
  const badTypes = [], badSE = [], badFam = [];
  for (const m of p.models) {
    if (!m || typeof m !== "object") return err("A model entry is not an object.");
    if (!modelIds.has(m.type)) badTypes.push(String(m.type));
    const se = m.spec?.seType;
    if (se != null && !seTypeIds.has(se)) badSE.push(String(se));
    const fam = m.family ?? m.spec?.family;
    if (fam != null && !families.has(fam)) badFam.push(String(fam));
  }
  if (badTypes.length)
    return err(`Unknown estimator${badTypes.length > 1 ? "s" : ""}: ${[...new Set(badTypes)].join(", ")}. This file was built with a newer or older version.`);
  if (badFam.length)
    return err(`Unknown outcome family${badFam.length > 1 ? "ies" : ""}: ${[...new Set(badFam)].join(", ")}.`);
  if (badSE.length)
    return err(`Unknown SE type${badSE.length > 1 ? "s" : ""}: ${[...new Set(badSE)].join(", ")}.`);

  return { ok: true, models: p.models, exportedAt: p.exportedAt ?? null };
}

// ── plots.json ───────────────────────────────────────────────────────────────

export function buildPlotsFile(entries = []) {
  return {
    version: 1,
    kind: PLOTS_KIND,
    exportedAt: new Date().toISOString(),
    plots: entries.map(e => {
      const out = { ...e };
      for (const k of PLOT_STRIP) delete out[k];
      return out;
    }),
  };
}

// vocab = { geoms: string[], schemes: string[] }
export function parsePlotsFile(text, vocab = {}) {
  const read = readJSON(text);
  if (!read.ok) return read;
  const p = read.value;
  if (p?.kind !== PLOTS_KIND) return kindMismatch(p?.kind, "a plots file");
  if (!Array.isArray(p.plots)) return err("Expected a `plots` array.");
  if (!p.plots.length)         return err("This file is empty — no plots to import.");

  const geoms   = new Set(vocab.geoms ?? []);
  const schemes = new Set(vocab.schemes ?? []);
  const badGeoms = [], badSchemes = [];
  for (const e of p.plots) {
    if (!e || typeof e !== "object")  return err("A plot entry is not an object.");
    if (!Array.isArray(e.layers) || !e.layers.length)
      return err(`Plot "${e.name ?? "(unnamed)"}" has no layers.`);
    for (const l of e.layers) if (!geoms.has(l?.geom)) badGeoms.push(String(l?.geom));
    if (e.scheme != null && !schemes.has(e.scheme)) badSchemes.push(String(e.scheme));
  }
  if (badGeoms.length)
    return err(`Unknown geom${badGeoms.length > 1 ? "s" : ""}: ${[...new Set(badGeoms)].join(", ")}. This file was built with a newer or older version.`);
  if (badSchemes.length)
    return err(`Unknown palette${badSchemes.length > 1 ? "s" : ""}: ${[...new Set(badSchemes)].join(", ")}.`);

  return { ok: true, plots: p.plots, exportedAt: p.exportedAt ?? null };
}

// Shared download helper — same shape as ExportMenu's downloadPipeline.
export function downloadJSON(payload, filename) {
  const blob = new Blob([JSON.stringify(payload, null, 2)], { type: "application/json" });
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = filename;
  a.click();
  URL.revokeObjectURL(a.href);
}
