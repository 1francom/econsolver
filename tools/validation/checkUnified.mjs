// ─── ECON STUDIO · tools/validation/checkUnified.mjs ─────────────────────────
// Does the Report's unified replication script RUN, and do its models give the
// numbers Litux gives? For a project export:
//   1. rebuild every dataset from its raw file + lineage (loadProjectUnit);
//   2. re-estimate every pinned model in Litux (the app's own dispatch);
//   3. build the unified script (services/export/unifiedScript.js) with every
//      model, Explore pin and saved plot, plus a dump after each model;
//   4. run it in R, Stata and Python and compare each model's coefficients and
//      SEs against Litux (1e-6 / 1e-4 relative).
// Coefficients are matched by VALUE, not by name — each language spells factor
// levels differently (continent_Americas / factor(continent)Americas /
// 2.continent_n / C(continent)[T.Americas]) and that spelling is not what is
// being tested.
//
//   node tools/validation/checkUnified.mjs PS5
//
// Until a project is re-exported with its pins, DEMO_MODELS supplies the
// course's own models for that unit (PS5_code_solutions.R).

import { mkdirSync, copyFileSync, existsSync, readFileSync, writeFileSync, rmSync } from "node:fs";
import { execFileSync } from "node:child_process";
import path from "node:path";
import { loadProjectUnit, VAL } from "./lib/loadProject.mjs";
import { RSCRIPT, STATA, PYTHON, LANGS } from "./lib/runScripts.mjs";
import { buildUnifiedScript, modelConfigFromResult } from "../../src/services/export/unifiedScript.js";
import { buildEstimationConfigFromSpec, runEstimationOnRows } from "../../src/components/modeling/runEstimation.js";

const MODEL_IDS = ["OLS", "WLS", "FE", "FD", "LSDV", "TWFE", "EventStudy", "2SLS", "RDD", "FuzzyRDD", "DiD",
  "GMM", "LIML", "SunAbraham", "CallawayCS", "SyntheticControl", "SpatialRegression", "SpatialRDD"];

// spec = what the Model tab's "Export models" writes: { label, type, family, spec }
const DEMO_MODELS = {
  PS5: [
    { label: "reduced form 2014", type: "OLS", family: "linear", dataset: "subset_2014",
      spec: { model: "OLS", yVar: "gdvote", xVarsRaw: ["logdist"] } },
    { label: "first stage DiD", type: "OLS", family: "linear", dataset: "subset_2014_2015",
      spec: { model: "OLS", yVar: "trarrprop", xVarsRaw: ["logdist_post", "post", "municipality"], factorVars: ["municipality"] } },
    { label: "IV DiD", type: "2SLS", family: "linear", dataset: "subset_2014_2015",
      spec: { model: "2SLS", yVar: "gdvote", xVarsRaw: ["trarrprop"], wVarsRaw: ["post", "municipality"], zVars: ["logdist_post"], factorVars: ["municipality"] } },
    { label: "binary DiD, HC1", type: "OLS", family: "linear", dataset: "subset_2014_2015",
      spec: { model: "OLS", yVar: "gdvote", xVarsRaw: ["treat_x_post", "post", "municipality"], factorVars: ["municipality"], seType: "HC1" } },
  ],
};

// Pins and a plot to exercise the non-model blocks (Stata runs them inside
// preserve/restore after `use`-ing their dataset).
const DEMO_EXTRAS = {
  PS5: {
    pins: [{ label: "mean vote share by year", dataset: "PS5_dinas2019_data.RData",
      params: { kind: "timeseries", yCol: "gdvote", timeCol: "year", groupCol: null, agg: "mean" } },
      // A pin taken under an Explore filter, grouped: exercises both fixes —
      // the filter must be applied and each group must get its own line.
      { label: "vote share by year, treated only", dataset: "PS5_dinas2019_data.RData",
        params: { kind: "timeseries", yCol: "gdvote", timeCol: "year", groupCol: "municipality", agg: "mean",
          filters: [{ col: "trarrprop", op: "gt", val: "0" }, { col: "municipality", op: "in", val: "2, 3, 4" }] } }],
    plots: [{ name: "vote vs distance 2014", datasetName: "subset_2014",
      layers: [{ id: "a", geom: "point", aes: { x: "logdist", y: "gdvote", color: "" }, visible: true, position: "identity" },
               { id: "b", geom: "smooth", aes: { x: "logdist", y: "gdvote", color: "" }, visible: true, position: "identity" }] }],
  },
};

const unit = process.argv[2];
if (!unit) { console.log("usage: node tools/validation/checkUnified.mjs <unit>"); process.exit(1); }
const proj = await loadProjectUnit(unit);
const dir = path.join(VAL, "results", "unified", unit);
mkdirSync(dir, { recursive: true });
for (const w of proj.warnings) console.log(`   ! ${w}`);

const dsByRef = (ref) => [...proj.datasets.values()].find(d => d.id === ref || d.name === ref || d.filename === ref);

// ── Litux: re-estimate every model ───────────────────────────────────────────
const specs = proj.models.length ? proj.models : (DEMO_MODELS[unit] ?? []);
if (!proj.models.length && specs.length) console.log(`   (no pinned models in the export — using the ${specs.length} demo models for ${unit})`);
const items = [];
const litux = new Map();   // mN -> [{b, se, name}]
let fails = 0;
for (const m of specs) {
  const ds = dsByRef(m.dataset ?? m.spec?.filename);
  if (!ds) { console.log(`   skip ${m.label}: dataset ${m.dataset ?? m.spec?.filename} not reproducible`); continue; }
  const panel = proj.payload.pipelines?.[ds.id]?.panel ?? null;
  const { cfg } = buildEstimationConfigFromSpec({ model: m.type, family: m.family, ...(m.spec ?? {}) },
    { headers: ds.clean.headers, datasetIds: [...proj.datasets.keys()], panel, modelIds: MODEL_IDS,
      defaultFactorVars: [], availableDatasets: [] });
  const d = runEstimationOnRows(ds.clean.rows, cfg, { filename: ds.filename, datasetId: ds.id });
  if (d?.error || !d?.result) { console.log(`   FAIL ${m.label}: Litux ${d?.error ?? "no result"}`); fails++; continue; }
  const r = d.result.type === "FE" ? (d.panelFE ?? d.result.fe ?? d.result) : d.result.type === "FD" ? (d.panelFD ?? d.result.fd ?? d.result) : d.result;
  items.push({ kind: "model", label: m.label, dataset: ds.id, model: modelConfigFromResult(r), pipeline: ds.steps });
  litux.set(`m${items.length}`, (r.varNames ?? []).map((n, i) => ({ name: n, b: r.beta[i], se: r.se[i] })));
}
// Explore pins and saved plots only have to RUN — they carry no numbers here.
// One whose dataset cannot be rebuilt (or that predates the dataset binding) is
// skipped and reported: binding it to some other dataset would test nothing.
for (const [, pins] of Object.entries(proj.explorePins ?? {})) {
  for (const p of (Array.isArray(pins) ? pins : [])) {
    const ds = dsByRef(p.dataset ?? p.params?.dataset);
    if (!ds) { console.log(`   skip pin "${p.label}": ${p.dataset ?? p.params?.dataset ?? "no dataset recorded (pinned before pins recorded one)"}`); continue; }
    items.push({ kind: "explore", label: p.label, dataset: ds.id, params: p.params });
  }
}
for (const [, file] of Object.entries(proj.plots ?? {})) {
  for (const e of (file?.plots ?? [])) {
    const ds = dsByRef(e.datasetId) ?? dsByRef(e.datasetName);
    if (!ds) { console.log(`   skip plot "${e.name}": ${e.datasetName ?? e.datasetId ?? "no dataset recorded (saved before plots recorded one)"}`); continue; }
    items.push({ kind: "plot", label: e.name ?? "plot", dataset: ds.id, entry: e });
  }
}

if (!proj.models.length && DEMO_EXTRAS[unit]) {
  for (const p of DEMO_EXTRAS[unit].pins) { const ds = dsByRef(p.dataset); if (ds) items.push({ kind: "explore", label: p.label, dataset: ds.id, params: p.params }); }
  for (const e of DEMO_EXTRAS[unit].plots) { const ds = dsByRef(e.datasetName); if (ds) items.push({ kind: "plot", label: e.name, dataset: ds.id, entry: e }); }
}

// ── Build + run per language ──────────────────────────────────────────────────
const wsDatasets = {};
for (const d of proj.datasets.values()) {
  if (d.file) {
    copyFileSync(d.file, path.join(dir, path.basename(d.file)));
    const dta = d.file.replace(/\.(rdata|rda)$/i, ".dta");
    if (dta !== d.file && existsSync(dta)) copyFileSync(dta, path.join(dir, path.basename(dta)));
  }
  wsDatasets[d.id] = { id: d.id, name: d.name, filename: d.file ? path.basename(d.file) : d.filename,
    loadOpts: d.loadOpts, pipeline: d.steps ?? [], origin: d.origin ?? null };
}
const fwd = (p) => p.replace(/\\/g, "/");
const dumpFile = (lang, name) => fwd(path.join(dir, `${lang}_${name}.csv`));
const DUMP = {
  r: (name) => `write.csv(data.frame(term = names(coef(fit)), b = unname(coef(fit)), se = unname(sqrt(diag(vcov(fit))))), "${dumpFile("r", name)}", row.names = FALSE)`,
  python: (name) => [
    `_se = getattr(model, "bse", None)`,
    `_se = model.std_errors if _se is None else _se`,
    `pd.DataFrame({"term": model.params.index, "b": model.params.values, "se": _se.values}).to_csv(r"${dumpFile("python", name)}", index=False)`,
  ],
  stata: (name) => [
    `matrix __b = e(b)`,
    `matrix __V = e(V)`,
    `local __n : colfullnames __b`,
    `file open __f using "${dumpFile("stata", name)}", write replace`,
    `file write __f "term,b,se" _n`,
    `local __i 0`,
    `foreach __c of local __n {`,
    `  local ++__i`,
    `  file write __f "\`__c'," %24.0g (__b[1,\`__i']) "," %24.0g (sqrt(__V[\`__i',\`__i'])) _n`,
    `}`,
    `file close __f`,
  ],
};
const EXT = { r: "R", stata: "do", python: "py" };

function readDump(file) {
  if (!existsSync(file)) return null;
  return readFileSync(file, "utf8").trim().split(/\r?\n/).slice(1).map(l => {
    const parts = l.split(",");
    return { term: parts.slice(0, -2).join(","), b: Number(parts.at(-2)), se: Number(parts.at(-1)) };
  });
}

console.log(`\n══ ${unit} unified script — ${items.filter(i => i.kind === "model").length} models, ${items.filter(i => i.kind !== "model").length} other blocks`);
for (const lang of LANGS) {
  for (const name of litux.keys()) rmSync(dumpFile(lang, name), { force: true });
  const script = buildUnifiedScript({ lang, datasets: wsDatasets, globalPipeline: proj.globalPipeline, items, afterModel: (name) => DUMP[lang](name) });
  const file = path.join(dir, `unified.${EXT[lang]}`);
  writeFileSync(file, script);
  let err = "";
  try {
    if (lang === "r") execFileSync(RSCRIPT, [file], { cwd: dir, stdio: ["ignore", "pipe", "pipe"], timeout: 1200000 });
    else if (lang === "python") execFileSync(PYTHON, [file], { cwd: dir, stdio: ["ignore", "pipe", "pipe"], timeout: 1200000, env: { ...process.env, MPLBACKEND: "Agg" } });
    else execFileSync(STATA, ["/e", "do", path.basename(file)], { cwd: dir, stdio: "ignore", timeout: 1200000 });
  } catch (e) { err = String(e.stderr ?? e.message ?? "").split("\n").filter(Boolean).slice(-3).join(" | "); }
  if (lang === "stata") {
    const log = path.join(dir, "unified.log");
    const txt = existsSync(log) ? readFileSync(log, "latin1") : "";
    const m = txt.match(/^r\((\d+)\);/m);
    if (m) {
      const lines = txt.split(/\r?\n/); const i = lines.findIndex(l => /^r\(\d+\);/.test(l));
      err = `r(${m[1]}) ${lines.slice(Math.max(0, i - 4), i).join(" | ")}`;
    }
  }
  console.log(`\n   ${lang}: ${err ? `script stopped — ${err.slice(0, 300)}` : "ran to the end"}`);
  if (err) fails++;
  for (const [name, coefs] of litux) {
    const dump = readDump(dumpFile(lang, name));
    const label = items.filter(i => i.kind === "model")[Number(name.slice(1)) - 1]?.label;
    if (!dump) { console.log(`     FAIL ${name} ${label}: no results written`); fails++; continue; }
    const bad = [];
    for (const c of coefs) {
      const hit = dump.find(d => Math.abs(d.b - c.b) <= 1e-6 * Math.max(1, Math.abs(c.b)));
      if (!hit) { bad.push(`${c.name} b=${c.b.toPrecision(8)} not found`); continue; }
      if (Math.abs(hit.se - c.se) > 1e-4 * Math.max(1, Math.abs(c.se))) bad.push(`${c.name} se ${c.se.toPrecision(6)} vs ${hit.se.toPrecision(6)}`);
    }
    if (bad.length) { fails++; console.log(`     DIFF ${name} ${label}: ${bad.slice(0, 3).join(" | ")}${bad.length > 3 ? ` (+${bad.length - 3})` : ""}`); }
    else console.log(`     ok   ${name} ${label}: ${coefs.length} coefficients`);
  }
}
console.log(`\n${fails ? `${fails} failure(s)` : "unified script reproduced every model"}`);
if (fails) process.exitCode = 1;
