// ─── Explore-pin replication harness ─────────────────────────────────────────
// `node src/services/export/__validation__/exploreStatValidation.mjs`
// Every pinnable Explore kind must produce real R / Python / Stata code
// (non-empty, no undefined/[object Object]).

import { transpileExploreStat, filterScopeBlock } from "../exploreStatScript.js";
import { buildGgplot, buildMatplotlibPlot } from "../plotScript.js";

let pass = 0, fail = 0;
const check = (n, c, extra) => {
  if (c) { pass++; console.log("  [pass]", n); }
  else   { fail++; console.log("  [FAIL]", n, extra != null ? "→ " + extra : ""); }
};
const GARBAGE = /undefined|\[object Object\]/;

const FIX = {
  summary:       { kind: "summary", columns: ["wage", "educ"], groupBy: "region" },
  head:          { kind: "head", n: 10 },
  tail:          { kind: "tail", n: 5 },
  histogram:     { kind: "histogram", col: "wage", bins: 30, transform: "log" },
  barchart:      { kind: "barchart", col: "region", order: "count" },
  spaghetti:     { kind: "spaghetti", col: "y", entityCol: "id", timeCol: "t" },
  timeseries:    { kind: "timeseries", yCol: "price", timeCol: "date", groupCol: "city", agg: "mean" },
  correlation:   { kind: "correlation", method: "pearson", cols: ["a", "b", "c"] },
  acf_pacf:      { kind: "acf_pacf", yCol: "gdp", timeCol: "year", maxLag: 12 },
  adf:           { kind: "adf", yCol: "gdp", timeCol: "year", lagOrder: 2 },
  overdispersion:{ kind: "overdispersion", col: "count", test: "cameron-trivedi" },
};

console.log("── explore pin → R / Python / Stata coverage ──");
for (const [kind, params] of Object.entries(FIX)) {
  for (const lang of ["r", "python", "stata"]) {
    const code = transpileExploreStat(params, lang, "df");
    const ok = typeof code === "string" && code.trim().length > 0 && !GARBAGE.test(code);
    check(`${lang}: ${kind}`, ok, code ? (code.split("\n").find(l => GARBAGE.test(l)) ?? (ok ? "" : "empty")) : "null");
  }
}

console.log("\n── the pin's active Explore filter is APPLIED ──");
{
  // The filter used to be MENTIONED in a NOTE and left to the user, so the
  // script plotted the whole dataset while the pin on screen showed a subset.
  const f = [{ col: "y", op: "gt", value: 0 }];
  const r = transpileExploreStat({ kind: "histogram", col: "x", bins: 10, filters: f }, "r", "df");
  // dplyr::filter drops NA itself, so the R predicate needs no is.na guard.
  check("R filters into its own frame", /^\.pin_d <- dplyr::filter\(df, y > 0\)$/m.test(r) && /ggplot2::ggplot\(\.pin_d,/.test(r));
  const py = transpileExploreStat({ kind: "histogram", col: "x", bins: 10, filters: f }, "python", "df");
  check("Python filters into its own frame", /^_pin_d = df\[/m.test(py) && /_pin_d\[/.test(py));
  const st = transpileExploreStat({ kind: "histogram", col: "x", bins: 10, filters: f }, "stata", "df");
  check("Stata keeps the rows (the caller wraps pins in preserve/restore)", /^keep if \(!missing\(y\) & y > 0\)$/m.test(st));
  // A condition the app itself ignores must not narrow the sample either.
  const inert = transpileExploreStat({ kind: "histogram", col: "x", filters: [{ col: "y", op: "gt", val: "" }] }, "r", "df");
  check("a half-typed numeric condition is not emitted", !/pin_d/.test(inert));
}

console.log("\n-- saved-plot row scope --");
{
  // A saved Plot Builder plot carries the filter it was drawn on. Its copied
  // script has to filter too, or the code plots a wider sample than the canvas.
  const f = [{ col: "country", op: "in", val: ["Spain", "India"] }];
  const rs = filterScopeBlock(f, "r", "df", { varName: ".plot_d" });
  check("R scope filters into its own frame", /^\.plot_d <- dplyr::filter\(df, /.test(rs.pre[0]) && rs.df === ".plot_d");
  const pys = filterScopeBlock(f, "python", "df", { varName: "_plot_d" });
  check("Python scope filters into its own frame", /^_plot_d = df\[/.test(pys.pre[0]) && pys.df === "_plot_d");
  const sts = filterScopeBlock(f, "stata", "df", { wrapStata: true });
  check("Stata scope wraps keep-if in preserve/restore",
    sts.pre[0] === "preserve" && /^keep if /.test(sts.pre[1]) && sts.post[0] === "restore");
  const unwrapped = filterScopeBlock(f, "stata", "df");
  check("Stata scope omits preserve when the caller already wrapped it",
    /^keep if /.test(unwrapped.pre[0]) && unwrapped.post.length === 0);
  check("no filter -> no lines and the original frame",
    filterScopeBlock(null, "r", "df").pre.length === 0 && filterScopeBlock([], "r", "df").df === "df");

  // The plot body must read the SCOPED frame, not the original.
  const entry = { layers: [{ id: "l1", geom: "point", aes: { x: "gdp", y: "education" } }], title: "", xLabel: "", yLabel: "" };
  const g = buildGgplot(entry, { dfVar: rs.df });
  check("ggplot body reads the scoped frame", /ggplot\(\.plot_d/.test(g), (g || "").slice(0, 60));
  const mp = buildMatplotlibPlot(entry, { dfVar: pys.df });
  check("matplotlib body reads the scoped frame", /_plot_d/.test(mp) && !/\bdf\[/.test(mp), (mp || "").slice(0, 80));
}

console.log("\n── transform variants ──");
check("log transform → log()",  /log\(wage\)/.test(transpileExploreStat({ kind: "histogram", col: "wage", transform: "log" }, "r", "df")));
check("sqrt transform → sqrt()", /sqrt\(wage\)/.test(transpileExploreStat({ kind: "histogram", col: "wage", transform: "sqrt" }, "r", "df")));

console.log(`\nexploreStat: ${pass} passed, ${fail} failed`);
if (fail > 0) process.exit(1);
