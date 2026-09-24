// ─── ECON STUDIO · services/export/ifElseStep.js ─────────────────────────────
// Single owner of the `if_else` step's emission in R, Python and Stata (there
// were six copies). runner.js is the definition:
//
//   nn = cond ? trueVal : falseVal, where a branch value that NAMES A COLUMN
//   takes that column's value in the row, and anything else is a literal
//   (typed numbers become numbers). A condition that is NA gives NA, as
//   dplyr::if_else does — the app's row expressions follow R's missing-value
//   rules (pipeline/rowExpr.js), and the condition is emitted from the same
//   tree (rowExprExport.js). A condition that ERRORS takes the FALSE branch.
//
// Every copy emitted the branch as a literal, so PS5's
// `if_else(year == 2015, logdist, 0)` exported as the STRING "logdist": in R a
// type error or a column of NA after the numeric cast — the IV-DiD instrument
// never existed in the replication script. Whether a value is a column depends
// on the table at that step, which the exporter does not know, so an
// identifier-like value is resolved AT RUN TIME in the script.

import { coerceLiteral } from "../../pipeline/literals.js";
import { jsExprToR, jsExprToPython, jsExprToStata } from "../../pipeline/stepTranslators.js";
import { rowExprR, rowCondPy, rowExprSt, stataAssignLines } from "./rowExprExport.js";

const dq = (v) => String(v ?? "").replace(/\\/g, "\\\\").replace(/"/g, '\\"');
// Could this value be a column name? Numbers and blanks cannot.
const maybeColumn = (v) => typeof v === "string" && v.trim() !== "" && typeof coerceLiteral(v) !== "number";

const rName = (c) => (/^[A-Za-z_][A-Za-z0-9_.]*$/.test(c) ? c : `\`${c}\``);
const rLit = (v) => {
  const c = coerceLiteral(v);
  if (c === null || c === undefined || c === "") return "NA";
  return typeof c === "number" ? String(c) : `"${dq(c)}"`;
};
const pyLit = (v) => {
  const c = coerceLiteral(v);
  if (c === null || c === undefined || c === "") return "np.nan";
  return typeof c === "number" ? String(c) : `"${dq(c)}"`;
};

const tryOr = (f, g) => { try { return f(); } catch { return g(); } };

export function ifElseR(step, df = "df") {
  const cond = tryOr(() => rowExprR(step.cond), () => jsExprToR(step.cond));
  if (!cond) throw new Error("condition cannot be translated");
  const val = (v) => maybeColumn(v)
    ? `(if (${JSON.stringify(v)} %in% names(${df})) ${df}[[${JSON.stringify(v)}]] else ${rLit(v)})`
    : rLit(v);
  // Base ifelse, not dplyr::if_else: the branches may legitimately differ in
  // type (a column vs a literal). A missing condition gives NA, as in the app.
  return `${df} <- ${df} |> dplyr::mutate(${rName(step.nn)} = ifelse(${cond}, ${val(step.trueVal)}, ${val(step.falseVal)}))`;
}

export function ifElsePython(step, df = "df") {
  const val = (v) => maybeColumn(v)
    ? `(${df}[${JSON.stringify(v)}] if ${JSON.stringify(v)} in ${df}.columns else ${pyLit(v)})`
    : pyLit(v);
  let mask;
  try { mask = rowCondPy(step.cond, df); } catch { mask = null; }
  if (mask) {
    // <NA> condition → NA, as in the app.
    return [
      `_lx_c = ${mask}`,
      `${df}[${JSON.stringify(step.nn)}] = pd.Series(${val(step.trueVal)}, index=${df}.index).where(_lx_c.fillna(False).astype(bool), ${val(step.falseVal)}).mask(_lx_c.isna())`,
    ].join("\n");
  }
  const cond = jsExprToPython(step.cond, df);
  if (!cond) throw new Error("condition cannot be translated");
  return `${df}[${JSON.stringify(step.nn)}] = np.where(pd.Series(${cond}, index=${df}.index).fillna(False).astype(bool), ${val(step.trueVal)}, ${val(step.falseVal)})`;
}

export function ifElseStata(step) {
  let lowered = null;
  try { lowered = rowExprSt(step.cond); } catch { /* text fallback below */ }
  const cond = lowered ? lowered.v : jsExprToStata(step.cond);
  if (!cond) throw new Error("condition cannot be translated");
  const nn = String(step.nn).replace(/[^A-Za-z0-9_]/g, "_");
  const lines = [`capture drop ${nn}`];
  // A column name becomes a local holding either the variable or a quoted
  // literal, decided by `confirm variable` when the do-file runs.
  const val = (v, slot) => {
    if (!maybeColumn(v)) {
      const c = coerceLiteral(v);
      return c === null || c === undefined || c === "" ? "." : typeof c === "number" ? String(c) : `"${dq(c)}"`;
    }
    const name = String(v).replace(/[^A-Za-z0-9_]/g, "_");
    lines.push(`capture confirm variable ${name}`);
    lines.push(`if _rc local _lx_${slot} \`""${dq(v)}""'`);
    lines.push(`else local _lx_${slot} ${name}`);
    return `\`_lx_${slot}'`;
  };
  const tv = val(step.trueVal, "tv");
  const fv = val(step.falseVal, "fv");
  if (lowered) {
    // Missing wherever the condition is NA (the lowering's `m`), as in the app.
    lines.push(...stataAssignLines(step.nn, { v: `cond(${cond}, ${tv}, ${fv})`, m: lowered.m }));
    return lines.join("\n");
  }
  // Text fallback: cond()'s 4th argument is the missing-condition case.
  lines.push(`gen ${nn} = cond(${cond}, ${tv}, ${fv}, ${fv})`);
  return lines.join("\n");
}

export function safeIfElse(lang, step, df) {
  const cmt = lang === "stata" ? "*" : "#";
  try {
    return lang === "r" ? ifElseR(step, df) : lang === "python" ? ifElsePython(step, df) : ifElseStata(step);
  } catch (e) {
    return `${cmt} if_else: ${step.nn} = if (${step.cond}) … — ${e.message}; translate manually`;
  }
}
