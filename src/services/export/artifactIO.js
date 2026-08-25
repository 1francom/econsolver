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
//
// Hardening note (Task 4b): every parser here is a DENY-BY-DEFAULT vocabulary
// check — an empty or missing `modelIds`/`geoms` rejects the file rather than
// waving it through, the same shape as this repo's `condToSQL` filter bug
// (`default: return "TRUE"`) had the opposite of. Never "simplify" a
// `!ids.size` check into a skip — see artifactIOValidation.mjs's
// "deny-by-default" section, which exists specifically to pin this.

const MODEL_KIND = "litux/model-specs";
const PLOTS_KIND = "litux/plots";

const CURRENT_VERSION = 1;

// Keys that can repoint an object's prototype the moment a caller does
// `Object.assign({}, entry)` or `{...entry}` — JSON.parse itself never
// pollutes (it uses CreateDataProperty), but it DOES leave "__proto__" as an
// ordinary OWN key on the parsed object, and that own key is exactly what a
// later spread/assign reads from. Stripped recursively from every parsed
// (and, for plots, every built) object so the dangerous key never survives
// past this module.
const DANGEROUS_KEYS = ["__proto__", "constructor", "prototype"];

// Session-local identity that must never travel: a foreign id points at a
// dataset/entry that does not exist in the importing session. "id"/"savedAt"
// only ever mean anything at the top level of a saved-plot entry (a layer's
// own "id" is a local React key, not session identity, so it is left alone).
// "datasetId"/"datasetName" are stripped recursively — `datasetName` is often
// a real filename, so leaving it in a nested layer/meta object is a privacy
// leak in a file users email each other.
const PLOT_STRIP_TOP  = ["id", "savedAt"];
const PLOT_STRIP_DEEP = ["datasetId", "datasetName", ...DANGEROUS_KEYS];

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

// A file built by a NEWER version of this app may have renamed or repurposed
// a key this build doesn't know about — silently misparsing that is worse
// than refusing it. Absent version is treated as 1 (every file built before
// this field existed). Anything that isn't a positive integer (`"banana"`,
// `2.5`, `0`) is rejected the same as a too-new version, not waved through.
function checkVersion(v) {
  if (v === undefined) return null;
  if (typeof v !== "number" || !Number.isInteger(v) || v < 1)
    return err(`This file has an invalid version (${safeStr(v)}).`);
  if (v > CURRENT_VERSION)
    return err(`This file was exported by a newer version of Litux (version ${v}) — this build only supports up to version ${CURRENT_VERSION}. Update the app to import it.`);
  return null;
}

// ── untrusted-string helpers ─────────────────────────────────────────────────
// A file's ids/labels/values are attacker-controlled: cap list length so one
// hostile file can't produce a 500 000-character error string, truncate each
// value so one long value can't do the same alone, and escape the handful of
// characters that matter if the message is ever echoed into HTML.
function truncateText(v, len = 40) {
  const s = String(v);
  return s.length > len ? s.slice(0, len) + "…" : s;
}
function sanitizeText(s) {
  return String(s).replace(/[<>&]/g, c => ({ "<": "&lt;", ">": "&gt;", "&": "&amp;" }[c]));
}
function safeStr(v, len = 40) { return sanitizeText(truncateText(v, len)); }

function fmtList(values, max = 5, len = 40) {
  const uniq = [...new Set(values.map(v => safeStr(v, len)))];
  const shown = uniq.slice(0, max);
  const more = uniq.length - shown.length;
  return shown.join(", ") + (more > 0 ? `, and ${more} more` : "");
}
// Same cap, for pre-formatted per-entry messages (already safe strings).
function capList(msgs, max = 5) {
  const shown = msgs.slice(0, max);
  const more = msgs.length - shown.length;
  return shown.join(" ") + (more > 0 ? ` (and ${more} more)` : "");
}

function labelOf(entry, i, field) {
  const v = entry && typeof entry === "object" ? entry[field] : undefined;
  return typeof v === "string" && v.length ? v : `#${i + 1}`;
}
function safeLabel(entry, i, field) { return safeStr(labelOf(entry, i, field), 60); }

// Rebuilds `value` from scratch, dropping any occurrence of `keys` at ANY
// depth (objects and arrays alike). Never mutates the input.
function deepStripKeys(value, keys) {
  if (Array.isArray(value)) return value.map(v => deepStripKeys(v, keys));
  if (value && typeof value === "object") {
    const out = {};
    for (const k of Object.keys(value)) {
      if (keys.includes(k)) continue;
      out[k] = deepStripKeys(value[k], keys);
    }
    return out;
  }
  return value;
}

// ── model.json ───────────────────────────────────────────────────────────────

export function buildModelFile(pins = []) {
  const list = Array.isArray(pins) ? pins : [];
  return {
    version: CURRENT_VERSION,
    kind: MODEL_KIND,
    exportedAt: new Date().toISOString(),
    models: list.map(p => ({
      label:  p?.label ?? p?.modelLabel ?? null,
      type:   p?.type ?? p?.spec?.model ?? null,
      family: p?.spec?.family ?? "linear",
      spec:   p?.spec ?? {},
    })),
  };
}

// vocab = { modelIds: string[], seTypeIds: string[], families: string[] }
// vocab is DENY-BY-DEFAULT: an empty or missing list rejects every entry
// rather than admitting anything. `vocab ?? {}` (not just the default param)
// so an explicit `null` from a not-yet-loaded caller degrades the same way.
export function parseModelFile(text, vocab = {}) {
  vocab = vocab ?? {};
  const read = readJSON(text);
  if (!read.ok) return read;
  const p = read.value;
  if (p?.kind !== MODEL_KIND) return kindMismatch(p?.kind, "a model file");

  const versionErr = checkVersion(p.version);
  if (versionErr) return versionErr;

  if (!Array.isArray(p.models)) return err("Expected a `models` array.");
  if (!p.models.length)         return err("This file is empty — no models to import.");

  const modelIds  = new Set(vocab.modelIds ?? []);
  const seTypeIds = new Set(vocab.seTypeIds ?? []);
  const families  = new Set(vocab.families ?? []);

  // Two separate failure classes (mirrors modelSpec.js's applySpec):
  //   shapeErrors — the FIELD has the wrong TYPE (an array where a string was
  //     expected, spec:null, …). Naming the entry is the only useful thing to
  //     report — the "value" itself (`String(["OLS"])` === "OLS") is
  //     misleading, since it looks exactly like a legitimate id.
  //   badTypes/badSE/badFam — the field is a well-shaped string, just not one
  //     this build recognises.
  const shapeErrors = [];
  const badTypes = [], badSE = [], badFam = [];

  p.models.forEach((m, i) => {
    if (!m || typeof m !== "object" || Array.isArray(m)) {
      shapeErrors.push(`Entry #${i + 1} is not an object.`);
      return;
    }
    const label = () => safeLabel(m, i, "label");

    if (m.type !== undefined && typeof m.type !== "string") {
      shapeErrors.push(`Model "${label()}": type must be a string.`);
    } else if (!modelIds.has(m.type)) {
      badTypes.push(m.type === undefined ? "(missing)" : m.type);
    }

    if (m.spec !== undefined && (m.spec === null || typeof m.spec !== "object" || Array.isArray(m.spec))) {
      shapeErrors.push(`Model "${label()}": spec is not an object.`);
    } else {
      const spec = m.spec ?? {};
      if (spec.seType !== undefined) {
        if (typeof spec.seType !== "string") shapeErrors.push(`Model "${label()}": seType must be a string.`);
        else if (!seTypeIds.has(spec.seType)) badSE.push(spec.seType);
      }
      const fam = m.family !== undefined ? m.family : spec.family;
      if (fam !== undefined) {
        if (typeof fam !== "string") shapeErrors.push(`Model "${label()}": family must be a string.`);
        else if (!families.has(fam)) badFam.push(fam);
      }
    }
  });

  // Report every failing category at once — a file with both an unknown
  // estimator AND an unknown SE type should say so in one pass, not abort on
  // the first and hide the second behind a re-import.
  const problems = [];
  if (shapeErrors.length) problems.push(capList(shapeErrors));
  if (badTypes.length)
    problems.push(`Unknown estimator${badTypes.length > 1 ? "s" : ""}: ${fmtList(badTypes)}. This file was built with a newer or older version.`);
  if (badFam.length)
    problems.push(`Unknown outcome family${badFam.length > 1 ? "ies" : ""}: ${fmtList(badFam)}.`);
  if (badSE.length)
    problems.push(`Unknown SE type${badSE.length > 1 ? "s" : ""}: ${fmtList(badSE)}.`);
  if (problems.length) return err(problems.join(" "));

  return {
    ok: true,
    models: p.models.map(m => deepStripKeys(m, DANGEROUS_KEYS)),
    exportedAt: typeof p.exportedAt === "string" ? p.exportedAt : null,
  };
}

// ── plots.json ───────────────────────────────────────────────────────────────

export function buildPlotsFile(entries = []) {
  const list = Array.isArray(entries) ? entries : [];
  return {
    version: CURRENT_VERSION,
    kind: PLOTS_KIND,
    exportedAt: new Date().toISOString(),
    plots: list.map(e => {
      const out = deepStripKeys(e, PLOT_STRIP_DEEP);
      if (out && typeof out === "object") for (const k of PLOT_STRIP_TOP) delete out[k];
      return out;
    }),
  };
}

// vocab = { geoms: string[], schemes: string[] }
// Same deny-by-default contract as parseModelFile — see the header note.
export function parsePlotsFile(text, vocab = {}) {
  vocab = vocab ?? {};
  const read = readJSON(text);
  if (!read.ok) return read;
  const p = read.value;
  if (p?.kind !== PLOTS_KIND) return kindMismatch(p?.kind, "a plots file");

  const versionErr = checkVersion(p.version);
  if (versionErr) return versionErr;

  if (!Array.isArray(p.plots)) return err("Expected a `plots` array.");
  if (!p.plots.length)         return err("This file is empty — no plots to import.");

  const geoms   = new Set(vocab.geoms ?? []);
  const schemes = new Set(vocab.schemes ?? []);
  const shapeErrors = [];
  const badGeoms = [], badSchemes = [];

  p.plots.forEach((e, i) => {
    if (!e || typeof e !== "object" || Array.isArray(e)) {
      shapeErrors.push(`Entry #${i + 1} is not an object.`);
      return;
    }
    const label = safeLabel(e, i, "name");

    if (!Array.isArray(e.layers) || !e.layers.length) {
      shapeErrors.push(`Plot "${label}" has no layers.`);
      return;
    }
    e.layers.forEach((l, li) => {
      if (!l || typeof l !== "object" || Array.isArray(l)) {
        shapeErrors.push(`Plot "${label}", layer #${li + 1} is not an object.`);
        return;
      }
      if (l.geom !== undefined && typeof l.geom !== "string") {
        shapeErrors.push(`Plot "${label}", layer #${li + 1}: geom must be a string.`);
      } else if (!geoms.has(l.geom)) {
        badGeoms.push(l.geom === undefined ? "(missing)" : l.geom);
      }
    });

    if (e.scheme !== undefined && e.scheme !== null) {
      if (typeof e.scheme !== "string") shapeErrors.push(`Plot "${label}": scheme must be a string.`);
      else if (!schemes.has(e.scheme)) badSchemes.push(e.scheme);
    }
  });

  const problems = [];
  if (shapeErrors.length) problems.push(capList(shapeErrors));
  if (badGeoms.length)
    problems.push(`Unknown geom${badGeoms.length > 1 ? "s" : ""}: ${fmtList(badGeoms)}. This file was built with a newer or older version.`);
  if (badSchemes.length)
    problems.push(`Unknown palette${badSchemes.length > 1 ? "s" : ""}: ${fmtList(badSchemes)}.`);
  if (problems.length) return err(problems.join(" "));

  return {
    ok: true,
    plots: p.plots.map(e => deepStripKeys(e, DANGEROUS_KEYS)),
    exportedAt: typeof p.exportedAt === "string" ? p.exportedAt : null,
  };
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
