// ─── ECON STUDIO · ACF layer export validation ───────────────────────────────
//   node src/services/export/__validation__/plotAcfValidation.mjs
//
// The correlogram layer is the one geom with no ggplot equivalent, so its three
// emitters diverge more than usual: base-R acf()/pacf() beside the ggplot chain,
// statsmodels plot_acf/plot_pacf on the panel axis, Stata ac/pac after a tsset.
// This pins what each must contain — in particular the conventions that are
// silent when wrong: the PACF method, the transform spelling, and the fact that
// an ACF-only plot must NOT emit an empty ggplot chain.

import { buildGgplot, buildMatplotlibPlot, buildStataPlot } from "../plotScript.js";
import { SERIES_TRANSFORMS } from "../../../math/timeSeries.js";

let pass = 0;
const failures = [];

function must(label, text, needle) {
  if (typeof text === "string" && text.includes(needle)) pass++;
  else failures.push(`${label}: expected to contain ${JSON.stringify(needle)}\n    got: ${String(text).replace(/\n/g, "\n         ")}`);
}
function mustNot(label, text, needle) {
  if (typeof text === "string" && !text.includes(needle)) pass++;
  else failures.push(`${label}: must NOT contain ${JSON.stringify(needle)}`);
}

const layer = (opts = {}) => ({
  geom: "acf", visible: true, aes: { x: "ret" }, fill: "#6ec8b4", opacity: 1,
  opts: { maxLag: 20, kind: "acf", transform: "raw", ci: 0.95, showCI: true, ...opts },
});
const entry = (opts = {}, extra = {}) => ({ layers: [layer(opts)], ...extra });

// ── R ────────────────────────────────────────────────────────────────────────
const r = buildGgplot(entry());
must("R acf call", r, "acf(x, lag.max = 20)");
mustNot("R ACF-only emits no empty ggplot chain", r, "ggplot(df)");
must("R pacf", buildGgplot(entry({ kind: "pacf" })), "pacf(x, lag.max = 20)");
must("R band off", buildGgplot(entry({ showCI: false })), "ci = 0");
must("R 99% band", buildGgplot(entry({ ci: 0.99 })), "ci = 0.99");
mustNot("R omits ci at the 95% default", buildGgplot(entry()), "ci =");
for (const t of SERIES_TRANSFORMS.filter(t => t.id !== "raw")) {
  must(`R transform ${t.id}`, buildGgplot(entry({ transform: t.id })), `x <- ${t.rExpr("x")}`);
}
// A mixed plot keeps BOTH: the ggplot chain for the other layers and the
// correlogram beside it.
const mixed = buildGgplot({ layers: [
  { geom: "line", visible: true, aes: { x: "t", y: "ret" }, fill: "#6ec8b4", opacity: 1, opts: {} },
  layer(),
] });
must("R mixed keeps ggplot", mixed, "geom_line(");
must("R mixed keeps acf",    mixed, "acf(x, lag.max = 20)");

// ── Python ───────────────────────────────────────────────────────────────────
const py = buildMatplotlibPlot(entry());
must("py import", py, "from statsmodels.graphics.tsaplots import plot_acf, plot_pacf");
must("py acf call", py, 'plot_acf(df["ret"].dropna().astype(float), lags=20, ax=ax)');
mustNot("py omits alpha at the 95% default", py, "alpha=");
const pyPacf = buildMatplotlibPlot(entry({ kind: "pacf" }));
// The convention that is silent when wrong: statsmodels' stattools default
// ("ywadjusted") differs from R's pacf() in the third decimal.
must("py pacf pins method", pyPacf, 'method="ywm"');
must("py band off", buildMatplotlibPlot(entry({ showCI: false })), "alpha=None");
must("py 99% band", buildMatplotlibPlot(entry({ ci: 0.99 })), "alpha=0.01");
mustNot("py 99% band has no float dust", buildMatplotlibPlot(entry({ ci: 0.99 })), "0.010000000");
must("py abs transform", buildMatplotlibPlot(entry({ transform: "abs" })), 'np.abs(df["ret"]');
must("py abs imports numpy", buildMatplotlibPlot(entry({ transform: "abs" })), "import numpy as np");
must("py square transform", buildMatplotlibPlot(entry({ transform: "square" })), "**2");

// ── Stata ────────────────────────────────────────────────────────────────────
const st = buildStataPlot(entry());
must("stata tsset", st, "tsset _acft");
must("stata ac", st, "ac ret, lags(20)");
must("stata gap note", st, "gaps count as missing observations");
must("stata pac", buildStataPlot(entry({ kind: "pacf" })), "pac ret, lags(20)");
const stAbs = buildStataPlot(entry({ transform: "abs" }));
must("stata transform var", stAbs, "generate double _acfx = abs(ret)");
must("stata plots the transform", stAbs, "ac _acfx, lags(20)");
must("stata band-off note", buildStataPlot(entry({ showCI: false })), "no equivalent");
// tsset must be emitted BEFORE the graph command, or the do-file errors out.
const stLines = st.split("\n");
const okOrder = stLines.findIndex(l => l.startsWith("tsset")) < stLines.findIndex(l => l.startsWith("ac "));
if (okOrder) pass++; else failures.push("stata: tsset must precede the ac command");

// ── Degenerate input is dropped, not half-emitted ────────────────────────────
const noCol = { layers: [{ ...layer(), aes: { x: "" } }] };
for (const [label, fn] of [["R", buildGgplot], ["python", buildMatplotlibPlot], ["stata", buildStataPlot]]) {
  const out = fn(noCol);
  if (typeof out === "string" && !out.includes("acf") && !out.includes("ac _") && !/\bac \b/.test(out)) pass++;
  else failures.push(`${label}: a correlogram layer with no column must emit no correlogram command`);
}

console.log(`\nACF layer export validation — ${pass} checks passed, ${failures.length} failed`);
if (failures.length) {
  for (const f of failures) console.log("  ✗ " + f);
  process.exit(1);
}
console.log("✓ all green");
