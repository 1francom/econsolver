// ─── ECON STUDIO · tools/validation/checkNAExpr.mjs ──────────────────────────
// Do row expressions treat MISSING values the same way in Litux, R, Stata and
// Python? The convention is R's (pipeline/rowExpr.js): NA propagates through
// every operator, & and | are three-valued, an NA condition is NA in if_else,
// is dropped by filter and does not match in case_when.
//
// Each step runs on its own against a small fixture full of missing values:
// Litux replays it, the exporters emit it, R / Stata / Python run it, and the
// tables are compared cell by cell. Logical results are compared as 1/0,
// because each language writes TRUE/FALSE, True/False or 1/0.
//
//   node tools/validation/checkNAExpr.mjs
//
// Exit code is non-zero if any language disagrees with the app.

import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { compareTables, VAL, parseDataFile } from "./lib/loadProject.mjs";
import { runPipelineScript, LANGS } from "./lib/runScripts.mjs";
import { runPipeline } from "../../src/pipeline/runner.js";
import { ensureRowIdentity } from "../../src/services/data/rowIdentity.js";

const DIR = path.join(VAL, "results", "naexpr");
mkdirSync(DIR, { recursive: true });

// Every combination the three-valued rules distinguish: x and y each
// positive / zero / negative / missing, a string with a missing value, and a
// group id for the grouped aggregate.
const FIXTURE = [
  "id,x,y,g,grp",
  "1,1,1,a,1",
  "2,2,0,b,1",
  "3,,1,a,1",
  "4,0,,,2",
  "5,-1,2,b,2",
  "6,,,a,2",
  "7,3,-2,,3",
  "8,-4,,b,3",
  "9,0,0,a,3",
  "10,,5,b,4",
].join("\n");
const file = path.join(DIR, "na_fixture.csv");
writeFileSync(file, FIXTURE + "\n");

const mutate = (nn, expr) => ({ type: "mutate", nn, expr });
const CASES = [
  mutate("neq",    "x != 0"),
  mutate("gt",     "x >= 0"),
  mutate("lt",     "x < 1"),
  mutate("and",    "x > 0 & y > 0"),
  mutate("andJS",  "x > 0 && y == 1"),
  mutate("or",     "x > 0 | y > 0"),
  mutate("not",    "!(x > 0)"),
  mutate("arith",  "x + y * 2"),
  mutate("div",    "x / y"),
  mutate("pow",    "x ^ 2"),
  mutate("mod",    "x % 3"),
  mutate("neg",    "-x"),
  mutate("ifel",   "ifelse(x > 0, 1, 0)"),
  mutate("tern",   "x > 0 ? y : 0"),
  mutate("inl",    "x %in% c(1, 2)"),
  mutate("inNA",   "x %in% c(1, NA)"),
  mutate("str",    'g == "a"'),
  mutate("isna",   "isna(x) | y > 1"),
  mutate("logx",   "log(x)"),
  mutate("coal",   "coalesce(x, y, 0)"),
  mutate("betw",   "between(x, 0, 2)"),
  { type: "filter", expr: "x > 0 | y > 0" },
  { type: "filter", expr: "!(x > 0)" },
  { type: "if_else", nn: "ife", cond: "x > 0", trueVal: "y", falseVal: "0" },
  { type: "case_when", nn: "cw", cases: [{ cond: "x > 1", val: "big" }, { cond: "x > 0", val: "small" }, { cond: "y > 0", val: "ypos" }], defaultVal: "other" },
  { type: "grouped_mutate", by: ["grp"], fn: "expr", expr: "any(x != 0 & y == 1)", filter: [], newCol: "anyg" },
  { type: "grouped_mutate", by: ["grp"], fn: "expr", expr: "mean(x) > 0", filter: [], newCol: "meang" },
];

const LOGICAL = { true: 1, false: 0, TRUE: 1, FALSE: 0, True: 1, False: 0 };
const norm = (t) => ({
  headers: t.headers,
  rows: t.rows.map(r => Object.fromEntries(Object.entries(r).map(([k, v]) => [k, v in LOGICAL ? LOGICAL[v] : v]))),
});
const label = (s) => s.type === "mutate" ? `mutate ${s.nn} = ${s.expr}`
  : s.type === "filter" ? `filter ${s.expr}`
  : s.type === "if_else" ? `if_else(${s.cond}, ${s.trueVal}, ${s.falseVal})`
  : s.type === "case_when" ? `case_when(${s.cases.map(c => c.cond).join("; ")})`
  : `grouped ${s.newCol} = ${s.expr}`;

const raw = ensureRowIdentity(await parseDataFile(file));
let fails = 0;
for (const [i, step] of CASES.entries()) {
  const clean = runPipeline(raw.rows, raw.headers, [step], {});
  const ds = { id: `na${i}`, name: `na${i}`, filename: "na_fixture.csv", file, loadOpts: null, rawData: raw, steps: [step], clean };
  const line = [];
  for (const language of LANGS) {
    const res = runPipelineScript({ language, dataset: ds, allDatasets: { [ds.id]: { name: ds.name, filename: file } }, dir: path.join(DIR, language) });
    if (!res.ok) { fails++; line.push(`${language} FAIL ${String(res.err).split("\n").filter(Boolean).slice(-1)[0]?.slice(0, 160)}`); continue; }
    const cmp = compareTables(norm(clean), norm(res.table), { tol: 1e-9 });
    if (cmp.ok) line.push(`${language} ok`);
    else { fails++; line.push(`${language} DIFF ${cmp.diffs.slice(0, 2).join(" | ")}`); }
  }
  console.log(`${line.every(l => l.endsWith(" ok")) ? "ok  " : "BAD "} ${label(step)}\n       ${line.join("\n       ")}`);
}
console.log(`\n${fails ? `${fails} disagreement(s)` : "Litux, R, Stata and Python agree on every expression"}`);
if (fails) process.exitCode = 1;
