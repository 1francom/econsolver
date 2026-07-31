// ─── ECON STUDIO · export/__validation__/plotLoadLineValidation.mjs ──────────
// Guards the Explore "Copy plot script" path (BugTriage 2026-07-05: "Plot
// replication code omits the dataset load lines").
//
// The copied script is assembled in PlotBuilder.copyPlotScript as
//   preamble  = ExplorerModule.plotScriptPreamble(lang)   → generateCleanScript
//   { code, dfVar } = resolvePlotPreamble(preamble, ...)
//   body      = buildGgplot / buildMatplotlibPlot / buildStataPlot over dfVar
//   script    = code + "\n\n" + body
// That composition is reproduced verbatim below, so a regression in ANY of the
// three pieces (the load line, the frame-name contract, or the geom body) fails
// here. The JSX wiring itself is not covered — Franco validates that in-browser.
//
// Run:  node src/services/export/__validation__/plotLoadLineValidation.mjs

import { generateCleanScript, toDfVar } from "../../../pipeline/exporter.js";
import { buildGgplot, buildMatplotlibPlot, buildStataPlot, resolvePlotPreamble } from "../plotScript.js";

let pass = 0;
const failures = [];
function check(name, condition, detail = "") {
  if (condition) { pass++; return; }
  failures.push(`${name}${detail ? ` — ${detail}` : ""}`);
}

const ENTRY = {
  title: "BAC density",
  layers: [{ geom: "point", visible: true, aes: { x: "bac1", y: "recidivism" }, opts: {} }],
};

// Mirrors ExplorerModule.plotScriptPreamble.
function preambleFor(language, { filename, pipeline = [], loadOpts = null, filtered = false } = {}) {
  let code = generateCleanScript({ language, datasetName: filename, filename, pipeline, loadOpts, preview: false });
  if (filtered) {
    const c = language === "stata" ? "* " : "# ";
    code += `\n\n${c}NOTE: an Explore filter was active when this plot was built — re-apply it before plotting.`;
  }
  return { code, dfVar: toDfVar(filename) };
}

// Mirrors PlotBuilder.copyPlotScript.
function copiedScript(language, raw, { datasetName }) {
  const baseDfVar = datasetName ? toDfVar(datasetName) : "df";
  const { code, dfVar } = resolvePlotPreamble(raw, { language, baseDfVar });
  const body = language === "python" ? buildMatplotlibPlot(ENTRY, { dfVar })
             : language === "stata"  ? buildStataPlot(ENTRY)
             :                         buildGgplot(ENTRY, { dfVar });
  return code ? `${code}\n\n${body}` : body;
}

// ── T1–T3: the load line is present, in every language ──────────────────────
{
  const opts = { filename: "drunk.csv" };
  const r  = copiedScript("r",      preambleFor("r", opts),      { datasetName: "drunk.csv" });
  const py = copiedScript("python", preambleFor("python", opts), { datasetName: "drunk.csv" });
  const st = copiedScript("stata",  preambleFor("stata", opts),  { datasetName: "drunk.csv" });

  check("T1 R emits read_csv for the source file", r.includes('read_csv("drunk.csv")'), r.slice(0, 120));
  check("T2 Python emits pd.read_csv", py.includes('pd.read_csv("drunk.csv")'), py.slice(0, 120));
  check("T3 Stata emits import delimited", st.includes('import delimited "drunk.csv"'), st.slice(0, 120));
}

// ── T4–T5: the geom is bound to the frame the preamble actually created ─────
{
  const r  = copiedScript("r",      preambleFor("r", { filename: "drunk.csv" }),      { datasetName: "drunk.csv" });
  const py = copiedScript("python", preambleFor("python", { filename: "drunk.csv" }), { datasetName: "drunk.csv" });
  check("T4 R plots over df_drunk, not plot_df", r.includes("ggplot(df_drunk)") && !r.includes("plot_df"), r);
  check("T5 Python plots over df_drunk", py.includes("df_drunk[") && !py.includes("plot_df"), py.slice(0, 400));
}

// ── T6: a string preamble still means ModelingTab's `plot_df` ───────────────
// The model preamble builds its frame from `fit`; renaming it would break every
// model plot copied out of the Modeling tab.
{
  const r = copiedScript("r", "plot_df <- broom::augment(fit)", { datasetName: "drunk.csv" });
  check("T6 string preamble keeps the plot_df contract", r.includes("ggplot(plot_df)"), r);
}

// ── T7: no preamble falls back to the dataset's own name ───────────────────
{
  const r = copiedScript("r", null, { datasetName: "drunk.csv" });
  check("T7 no preamble → df_drunk, no stray blank lines", r.startsWith("library(ggplot2)") && r.includes("ggplot(df_drunk)"), r.slice(0, 80));
}

// ── T8: loadOpts are honoured (a ';' CSV must not export as read_csv) ───────
{
  const raw = preambleFor("r", { filename: "eu.csv", loadOpts: { format: "csv", delimiter: ";" } });
  const r = copiedScript("r", raw, { datasetName: "eu.csv" });
  check("T8 R honours a ';' delimiter", r.includes("read_delim") && r.includes('delim = ";"'), r.slice(0, 160));
}
{
  const raw = preambleFor("python", { filename: "panel.dta" });
  const py = copiedScript("python", raw, { datasetName: "panel.dta" });
  check("T9 .dta infers read_stata", py.includes("pd.read_stata"), py.slice(0, 160));
}

// ── T10: pipeline steps ride along, so the plot sees the same columns ──────
{
  const pipeline = [{ type: "log", col: "bac1", nn: "log_bac1" }];
  const r = copiedScript("r", preambleFor("r", { filename: "drunk.csv", pipeline }), { datasetName: "drunk.csv" });
  check("T10 cleaning steps are replayed before the geom",
    r.includes("Pipeline steps") && r.indexOf("Pipeline steps") < r.indexOf("ggplot("), r.slice(0, 300));
}

// ── T11: preview:false drops the head() trailer, preview:true keeps it ─────
{
  const withPreview = generateCleanScript({ language: "r", datasetName: "d.csv", filename: "d.csv", pipeline: [] });
  const without     = generateCleanScript({ language: "r", datasetName: "d.csv", filename: "d.csv", pipeline: [], preview: false });
  check("T11 preview flag controls the head() trailer",
    withPreview.includes("head(df_d)") && !without.includes("head(df_d)"), without);
}

// ── T12: the un-replayable QuickFilter is disclosed, not silently dropped ──
{
  const raw = preambleFor("r", { filename: "drunk.csv", filtered: true });
  const r = copiedScript("r", raw, { datasetName: "drunk.csv" });
  check("T12 active Explore filter emits a NOTE", /# NOTE: an Explore filter/.test(r), r.slice(-200));
}

console.log(`plotLoadLineValidation — ${pass} passed, ${failures.length} failed`);
failures.forEach(f => console.log(`  ✗ ${f}`));
process.exit(failures.length ? 1 : 0);
