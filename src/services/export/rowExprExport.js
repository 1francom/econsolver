// ─── ECON STUDIO · services/export/rowExprExport.js ──────────────────────────
// Single owner of how a ROW EXPRESSION is written out in R, Python and Stata:
// mutate, formula filters, case_when conditions and if_else conditions. It
// emits from the SAME tree the app evaluates (pipeline/rowExpr.js parses it),
// so the precedence cannot drift, and it reproduces the app's missing-value
// convention — R's — in all three languages:
//
//   R       native: NA propagates, & and | are three-valued.
//   Python  every column is read through `.convert_dtypes()`, i.e. pandas'
//           nullable dtypes, whose comparisons return <NA> and whose & and |
//           are Kleene — exactly R's rules. (Plain float64 would make
//           `NaN != 0` TRUE and `NaN > 0` FALSE.) A mutate result is written
//           back as float64 / object so the next steps and statsmodels see an
//           ordinary column; a logical result becomes 1.0/0.0/NaN.
//   Stata   has no NA logic of its own (missing is +∞, so `x > 0` is TRUE), so
//           each node is lowered to a pair (value, is-missing) and the result
//           is set to missing where the pair says so. & and | keep the
//           Kleene rule: FALSE & NA is FALSE, TRUE | NA is TRUE.
//
// A non-finite result (log(0), x/0) is missing in the app; the R and Python
// emissions turn Inf into NA the same way, and Stata already returns missing.
//
// Anything the tree cannot express in a language (member calls, a %in% whose
// right side is not a literal list…) THROWS, and callers fall back to the old
// text translation, which carries the old missing-value behaviour.

import { parseRowExpr, ARITH_OPS } from "../../pipeline/rowExpr.js";
import { rName, stVar } from "../../pipeline/stepTranslators.js";
import { coerceLiteral } from "../../pipeline/literals.js";

// ─── shared tree helpers ─────────────────────────────────────────────────────

const ALIAS = { ceil: "ceiling", min: "pmin", max: "pmax" };

/** A call node — including `Math.log(x)` — as { fn, args }, or null. */
function asCall(n) {
  if (n.t === "call") return { fn: ALIAS[n.fn] ?? n.fn, args: n.args };
  if (n.t === "mcall" && n.obj.t === "col" && n.obj.name === "Math") return { fn: ALIAS[n.name] ?? n.name, args: n.args };
  return null;
}

function isLogical(n) {
  if (n.t === "raw") return !!n.logical;
  if (["and", "or", "not", "in", "bool"].includes(n.t)) return true;
  if (n.t === "bin") return !ARITH_OPS.has(n.op);
  const c = asCall(n);
  return !!c && ["isna", "notna", "between"].includes(c.fn);
}

// Could the value be ±Inf/NaN where the app would store a missing value?
function mayBeNonFinite(n) {
  if (!n || typeof n !== "object") return false;
  if (n.t === "bin" && ["/", "%", "^"].includes(n.op)) return true;
  const c = asCall(n);
  if (c && ["log", "log2", "log10", "sqrt", "exp", "pow", "rescale"].includes(c.fn)) return true;
  return Object.values(n).some(v => Array.isArray(v) ? v.some(mayBeNonFinite) : mayBeNonFinite(v));
}

// The literal items on the right of %in%.
function inItems(r) {
  if (r.t === "arr") return r.items;
  if (r.t === "call" && r.fn === "c") return r.args;
  if (["num", "str", "bool", "null"].includes(r.t)) return [r];
  return null;
}
const isLiteral = (n) => ["num", "str", "bool", "null"].includes(n.t) ||
  (n.t === "neg" && n.e.t === "num");
const litValue = (n) => (n.t === "neg" ? -n.e.v : n.t === "null" ? null : n.v);

function rangeItems(n) {
  if (!isLiteral(n.lo) || !isLiteral(n.hi)) return null;
  const lo = litValue(n.lo), hi = litValue(n.hi);
  if (!Number.isInteger(lo) || !Number.isInteger(hi)) return null;
  return { lo, hi };
}

const cmpOp = (op) => (op === "===" ? "==" : op === "!==" ? "!=" : op);

// ─── R ───────────────────────────────────────────────────────────────────────

function rCall(fn, a) {
  switch (fn) {
    case "isna":  return `is.na(${a[0]})`;
    case "notna": return `(!is.na(${a[0]}))`;
    case "ifelse": return `ifelse(${a[0]}, ${a[1]}, ${a[2]})`;
    case "between": return `dplyr::between(${a[0]}, ${a[1]}, ${a[2]})`;
    case "log": case "log2": case "log10": case "sqrt": case "exp":
    case "abs": case "floor": case "ceiling": case "sign":
      return `${fn}(${a[0]})`;
    case "round": return a.length > 1 ? `round(${a[0]}, ${a[1]})` : `round(${a[0]})`;
    case "coalesce": return `dplyr::coalesce(${a.join(", ")})`;
    case "pmin": case "pmax": return `${fn}(${a.join(", ")})`;
    case "pow": return `((${a[0]})^(${a[1]}))`;
    case "clamp": return `pmin(pmax(${a[0]}, ${a[1]}), ${a[2]})`;
    case "as_integer": return `as.integer(${a[0]})`;
    case "as_factor": return `as.character(${a[0]})`;
    case "rescale": {
      const [x, o1, o2, n1 = "0", n2 = "1"] = a;
      return `(${n1} + (${x} - ${o1}) * (${n2} - ${n1}) / (${o2} - ${o1}))`;
    }
    case "case_when": {
      const pairs = [];
      for (let i = 0; i + 1 < a.length; i += 2) pairs.push(`${a[i]} ~ ${a[i + 1]}`);
      return `dplyr::case_when(${pairs.join(", ")}, .default = ${a.length % 2 ? a[a.length - 1] : "NA"})`;
    }
    case "c": return `c(${a.join(", ")})`;
    default: throw new Error(`no R translation for ${fn}()`);
  }
}

function toR(n) {
  switch (n.t) {
    case "num":   return Number.isFinite(n.v) ? String(n.v) : "NA_real_";
    case "str":   return JSON.stringify(n.v);
    case "bool":  return n.v ? "TRUE" : "FALSE";
    case "null":  return "NA";
    case "col":   return rName(n.name);
    case "arr":   return `c(${n.items.map(toR).join(", ")})`;
    case "bin":   return ARITH_OPS.has(n.op)
      ? `(${toR(n.l)} ${n.op === "%" ? "%%" : n.op} ${toR(n.r)})`
      : `(${toR(n.l)} ${cmpOp(n.op)} ${toR(n.r)})`;
    case "and":   return `(${toR(n.l)} & ${toR(n.r)})`;
    case "or":    return `(${toR(n.l)} | ${toR(n.r)})`;
    case "not":   return `(!${toR(n.e)})`;
    case "neg":   return `(-${toR(n.e)})`;
    case "tern":  return `ifelse(${toR(n.c)}, ${toR(n.a)}, ${toR(n.b)})`;
    case "in":    return `(${toR(n.l)} %in% ${toR(n.r)})`;
    case "range": return `(${toR(n.lo)}:${toR(n.hi)})`;
    case "raw":   return n.r;
    default: {
      const c = asCall(n);
      if (c) return rCall(c.fn, c.args.map(toR));
      throw new Error(`no R translation for ${n.t}`);
    }
  }
}

/** R expression for a row expression (throws when untranslatable). */
export function rowExprR(src) { return toR(parseRowExpr(src)); }

/** R value for a mutate: Inf/NaN become NA, as they do in the app. */
export function rowExprValueR(src) {
  const ast = parseRowExpr(src);
  const e = toR(ast);
  return mayBeNonFinite(ast) ? `(function(v) { if (is.numeric(v)) v[!is.finite(v)] <- NA; v })(${e})` : e;
}

// ─── Python (pandas, nullable dtypes) ────────────────────────────────────────

function pyLit(v) {
  if (v === null || v === undefined || v === "") return "pd.NA";
  if (typeof v === "boolean") return v ? "True" : "False";
  if (typeof v === "number") return Number.isFinite(v) ? String(v) : "pd.NA";
  return JSON.stringify(String(v));
}

function pyCtx(df) {
  const S = (x) => `pd.Series(${x}, index=${df}.index)`;
  const B = (x) => `pd.Series(${x}, index=${df}.index, dtype="boolean")`;
  const bool = (n) => (isLogical(n) ? toPy(n) : `(${toPy(n)} != 0)`);
  // cond NA → NA (R's ifelse / if_else)
  const ifelse = (c, a, b) => {
    const m = B(bool(c));
    return `${S(toPy(a))}.where(${m}.fillna(False).astype(bool), ${toPy(b)}).mask(${m}.isna())`;
  };
  function call(fn, a) {
    const p = a.map(toPy);
    switch (fn) {
      case "isna":  return `${S(p[0])}.isna()`;
      case "notna": return `${S(p[0])}.notna()`;
      case "ifelse": return ifelse(a[0], a[1], a[2]);
      case "between": return `((${p[0]} >= ${p[1]}) & (${p[0]} <= ${p[2]}))`;
      case "log": case "log2": case "log10": case "sqrt": case "exp":
      case "abs": case "floor": case "sign":
        return `np.${fn}(${p[0]})`;
      case "ceiling": return `np.ceil(${p[0]})`;
      case "round": return `np.round(${p[0]}, ${p[1] ?? 0})`;
      case "coalesce": return `${S(p[0])}${p.slice(1).map(x => `.fillna(${x})`).join("")}`;
      case "pmin": return p.slice(1).reduce((acc, x) => `np.minimum(${acc}, ${x})`, p[0]);
      case "pmax": return p.slice(1).reduce((acc, x) => `np.maximum(${acc}, ${x})`, p[0]);
      case "pow": return `((${p[0]}) ** (${p[1]}))`;
      case "clamp": return `np.minimum(np.maximum(${p[0]}, ${p[1]}), ${p[2]})`;
      case "as_integer": return `np.trunc(${p[0]})`;
      case "as_factor": return `${S(p[0])}.astype("string")`;
      case "rescale": {
        const [x, o1, o2, n1 = "0", n2 = "1"] = p;
        return `(${n1} + (${x} - ${o1}) * (${n2} - ${n1}) / (${o2} - ${o1}))`;
      }
      case "case_when": {
        let acc = S(a.length % 2 ? toPy(a[a.length - 1]) : "pd.NA");
        for (let i = a.length - (a.length % 2 ? 3 : 2); i >= 0; i -= 2) {
          acc = `${S(toPy(a[i + 1]))}.where(${B(bool(a[i]))}.fillna(False).astype(bool), ${acc})`;
        }
        return acc;
      }
      default: throw new Error(`no Python translation for ${fn}()`);
    }
  }
  function toPy(n) {
    switch (n.t) {
      case "num":  return Number.isFinite(n.v) ? String(n.v) : "pd.NA";
      case "str":  return JSON.stringify(n.v);
      case "bool": return n.v ? "True" : "False";
      case "null": return "pd.NA";
      case "raw":  return n.py;
      case "col":  return `${df}[${JSON.stringify(n.name)}].convert_dtypes()`;
      case "bin":  return ARITH_OPS.has(n.op)
        ? `(${toPy(n.l)} ${n.op === "^" ? "**" : n.op} ${toPy(n.r)})`
        : `(${toPy(n.l)} ${cmpOp(n.op)} ${toPy(n.r)})`;
      case "and":  return `(${bool(n.l)} & ${bool(n.r)})`;
      case "or":   return `(${bool(n.l)} | ${bool(n.r)})`;
      case "not":  return `(${bool(n.e)} == False)`;
      case "neg":  return `(-${toPy(n.e)})`;
      case "tern": return ifelse(n.c, n.a, n.b);
      case "in": {
        let items;
        if (n.r.t === "range") {
          const rg = rangeItems(n.r);
          if (!rg) throw new Error("%in% range needs integer bounds");
          items = rg.lo <= rg.hi ? `list(range(${rg.lo}, ${rg.hi + 1}))` : `list(range(${rg.lo}, ${rg.hi - 1}, -1))`;
          return `${S(toPy(n.l))}.isin(${items})`;
        }
        const it = inItems(n.r);
        if (!it || !it.every(isLiteral)) throw new Error("%in% needs a literal list");
        const vals = it.map(litValue);
        const lst = `[${vals.filter(v => v !== null).map(pyLit).join(", ")}]`;
        const base = `${S(toPy(n.l))}.isin(${lst})`;
        return vals.some(v => v === null) ? `(${base} | ${S(toPy(n.l))}.isna())` : base;
      }
      default: {
        const c = asCall(n);
        if (c) return call(c.fn, c.args);
        throw new Error(`no Python translation for ${n.t}`);
      }
    }
  }
  return { toPy, bool, S, B };
}

/** Python expression (a nullable Series or scalar) for a row expression. */
export function rowExprPy(src, df = "df") { return pyCtx(df).toPy(parseRowExpr(src)); }

/** Python boolean mask for a condition: <NA> where the condition is NA. */
export function rowCondPy(src, df = "df") {
  const c = pyCtx(df);
  return c.B(c.bool(parseRowExpr(src)));
}

/**
 * Python lines that compute a nullable result and write it back to `col` as an
 * ordinary column: numeric and logical results become float64 (NA → NaN,
 * ±Inf → NaN, TRUE/FALSE → 1.0/0.0), anything else object with None.
 */
export function pyAssignLines(col, e, df = "df") {
  return [
    `_lx_v = pd.Series(${e}, index=${df}.index)`,
    `if pd.api.types.is_numeric_dtype(_lx_v) or pd.api.types.is_bool_dtype(_lx_v):`,
    `    _lx_v = pd.Series(_lx_v.astype("Float64").to_numpy(dtype="float64", na_value=np.nan), index=${df}.index).replace([np.inf, -np.inf], np.nan)`,
    `else:`,
    `    _lx_v = _lx_v.astype(object).where(_lx_v.notna(), None)`,
    `${df}[${JSON.stringify(col)}] = _lx_v`,
  ];
}

// ─── Stata (value, missing) lowering ─────────────────────────────────────────

const OR = (...ms) => {
  const xs = [...new Set(ms.filter(m => m !== "0"))];
  return !xs.length ? "0" : xs.length === 1 ? xs[0] : `(${xs.join(" | ")})`;
};
const stStr = (s) => (String(s).includes('"') ? `\`"${s}"'` : `"${s}"`);
const K = (v) => ({ v, m: "0" });
const notMiss = (m) => (m === "0" ? "" : `!${m} & `);

function stCall(fn, args) {
  const a = args.map(toSt);
  const m = OR(...a.map(x => x.m));
  const f1 = (name) => ({ v: `${name}(${a[0].v})`, m: a[0].m });
  switch (fn) {
    case "isna":  return K(OR(a[0].m, `missing(${a[0].v})`));
    case "notna": return K(`!${OR(a[0].m, `missing(${a[0].v})`)}`);
    case "ifelse": return stTern(args[0], args[1], args[2]);
    case "between": return { v: `inrange(${a[0].v}, ${a[1].v}, ${a[2].v})`, m };
    case "log":   return f1("ln");
    case "log10": case "sqrt": case "exp": case "abs": case "floor": case "sign": return f1(fn);
    case "log2":  return { v: `(ln(${a[0].v})/ln(2))`, m: a[0].m };
    case "ceiling": return f1("ceil");
    case "round": {
      if (a.length < 2) return f1("round");
      if (!isLiteral(args[1])) throw new Error("round() digits must be a number");
      return { v: `round(${a[0].v}, 1e-${litValue(args[1])})`, m: a[0].m };
    }
    case "pmin": case "pmax": return { v: `${fn === "pmin" ? "min" : "max"}(${a.map(x => x.v).join(", ")})`, m };
    case "pow": return { v: `((${a[0].v})^(${a[1].v}))`, m };
    case "clamp": return { v: `min(max(${a[0].v}, ${a[1].v}), ${a[2].v})`, m };
    case "as_integer": return f1("int");
    case "coalesce": {
      let v = a[a.length - 1].v;
      for (let i = a.length - 2; i >= 0; i--) v = `cond(${a[i].m === "0" ? "1" : `!${a[i].m}`}, ${a[i].v}, ${v})`;
      const allM = a.some(x => x.m === "0") ? "0" : `(${a.map(x => x.m).join(" & ")})`;
      return { v, m: allM };
    }
    case "rescale": {
      const [x, o1, o2, n1 = K("0"), n2 = K("1")] = a;
      return { v: `(${n1.v} + (${x.v} - ${o1.v}) * (${n2.v} - ${n1.v}) / (${o2.v} - ${o1.v}))`, m: OR(x.m, o1.m, o2.m, n1.m, n2.m) };
    }
    case "case_when": {
      const hasDef = a.length % 2 === 1;
      let v = hasDef ? a[a.length - 1].v : ".";
      let mm = hasDef ? a[a.length - 1].m : "1";
      for (let i = a.length - (hasDef ? 3 : 2); i >= 0; i -= 2) {
        const hit = `(${notMiss(a[i].m)}(${a[i].v}))`;
        v = `cond(${hit}, ${a[i + 1].v}, ${v})`;
        mm = mm === "0" && a[i + 1].m === "0" ? "0" : `cond(${hit}, ${a[i + 1].m}, ${mm})`;
      }
      return { v, m: mm };
    }
    default: throw new Error(`no Stata translation for ${fn}()`);
  }
}

function stTern(cn, an, bn) {
  const c = toSt(cn), a = toSt(an), b = toSt(bn);
  const m = c.m === "0" && a.m === "0" && b.m === "0" ? "0"
    : OR(c.m, a.m === "0" && b.m === "0" ? "0" : `cond(${c.v}, ${a.m}, ${b.m})`);
  return { v: `cond(${c.v}, ${a.v}, ${b.v})`, m };
}

function toSt(n) {
  switch (n.t) {
    case "num":  return Number.isFinite(n.v) ? K(String(n.v)) : { v: ".", m: "1" };
    case "str":  return K(stStr(n.v));
    case "bool": return K(n.v ? "1" : "0");
    case "null": return { v: ".", m: "1" };
    case "raw":  return n.st;
    case "col": { const c = stVar(n.name); return { v: c, m: `missing(${c})` }; }
    case "bin": {
      const l = toSt(n.l), r = toSt(n.r);
      const m = OR(l.m, r.m);
      if (n.op === "%") return { v: `mod(${l.v}, ${r.v})`, m };
      if (n.op === "^") return { v: `((${l.v})^(${r.v}))`, m };
      return { v: `(${l.v} ${cmpOp(n.op)} ${r.v})`, m };
    }
    case "and": {
      const l = toSt(n.l), r = toSt(n.r);
      if (l.m === "0" && r.m === "0") return { v: `(${l.v} & ${r.v})`, m: "0" };
      const falsy = `((${notMiss(l.m)}!(${l.v})) | (${notMiss(r.m)}!(${r.v})))`;
      return { v: `(${l.v} & ${r.v})`, m: `(${OR(l.m, r.m)} & !${falsy})` };
    }
    case "or": {
      const l = toSt(n.l), r = toSt(n.r);
      if (l.m === "0" && r.m === "0") return { v: `(${l.v} | ${r.v})`, m: "0" };
      const truthy = `((${notMiss(l.m)}(${l.v})) | (${notMiss(r.m)}(${r.v})))`;
      return { v: `(${l.v} | ${r.v})`, m: `(${OR(l.m, r.m)} & !${truthy})` };
    }
    case "not": { const e = toSt(n.e); return { v: `(!(${e.v}))`, m: e.m }; }
    case "neg": { const e = toSt(n.e); return { v: `(-(${e.v}))`, m: e.m }; }
    case "tern": return stTern(n.c, n.a, n.b);
    case "in": {
      const l = toSt(n.l);
      if (n.r.t === "range") {
        const rg = rangeItems(n.r);
        if (!rg) throw new Error("%in% range needs integer bounds");
        const [lo, hi] = rg.lo <= rg.hi ? [rg.lo, rg.hi] : [rg.hi, rg.lo];
        return K(`(${notMiss(l.m)}inrange(${l.v}, ${lo}, ${hi}) & ${l.v} == floor(${l.v}))`);
      }
      const it = inItems(n.r);
      if (!it || !it.every(isLiteral)) throw new Error("%in% needs a literal list");
      const vals = it.map(litValue);
      const lits = vals.filter(v => v !== null).map(v => (typeof v === "number" ? String(v) : typeof v === "boolean" ? (v ? "1" : "0") : stStr(v)));
      const isStr = vals.some(v => typeof v === "string");
      const size = isStr ? 9 : 249;           // inlist() argument limits
      const chunks = [];
      for (let i = 0; i < lits.length; i += size) chunks.push(`inlist(${l.v}, ${lits.slice(i, i + size).join(", ")})`);
      const hit = chunks.length ? (chunks.length > 1 ? `(${chunks.join(" | ")})` : chunks[0]) : "0";
      const anyMiss = OR(l.m, `missing(${l.v})`);
      return K(vals.some(v => v === null)
        ? `(${anyMiss} | ${hit})`
        : `(!${anyMiss} & ${hit})`);
    }
    default: {
      const c = asCall(n);
      if (c) return stCall(c.fn, c.args);
      throw new Error(`no Stata translation for ${n.t}`);
    }
  }
}

/**
 * Entry points on an already-parsed tree, for emitters with their own parser
 * (grouped_mutate). A `{ t: "raw", r, py, st: { v, m }, logical? }` node
 * carries an operand already written in each language — a hoisted aggregate.
 */
export const rowAstR  = (ast) => toR(ast);
export const rowAstPy = (ast, df = "df") => pyCtx(df).toPy(ast);
export const rowAstSt = (ast) => toSt(ast);

/** Stata { v, m } lowering for a row expression (throws when untranslatable). */
export function rowExprSt(src) { return toSt(parseRowExpr(src)); }

/** Stata condition that is TRUE only where the row expression is TRUE (NA → false). */
export function rowCondSt(src) {
  const { v, m } = rowExprSt(src);
  return m === "0" ? `(${v})` : `(!${m} & (${v}))`;
}

/**
 * Stata lines that set `out` to a value computed with `v`, then to missing
 * wherever `m` holds. The storage type is decided at run time: numeric gets
 * double, a string result keeps its type and gets "" for missing. The result
 * goes through a temporary so `x = x + 1` still reads the old x.
 */
export function stataAssignLines(out, { v, m }) {
  const o = stVar(out);
  const lines = [
    "capture drop _lx_v",
    `capture generate double _lx_v = ${v}`,
    `if _rc generate _lx_v = ${v}`,
  ];
  if (m !== "0") {
    lines.push("capture confirm string variable _lx_v");
    lines.push(`if _rc replace _lx_v = . if ${m}`);
    lines.push(`else replace _lx_v = "" if ${m}`);
  }
  lines.push(`capture drop ${o}`, `rename _lx_v ${o}`);
  return lines;
}

// ─── steps ───────────────────────────────────────────────────────────────────

const litR = (v) => { const c = coerceLiteral(v); return c === null || c === undefined || c === "" ? "NA" : typeof c === "number" ? String(c) : JSON.stringify(String(c)); };
const litSt = (v) => { const c = coerceLiteral(v); return c === null || c === undefined || c === "" ? { v: ".", m: "1" } : K(typeof c === "number" ? String(c) : stStr(c)); };

/** mutate step → one statement per language (throws when untranslatable). */
export function mutateStep(lang, step, df = "df") {
  if (lang === "r") return `${df} <- ${df} |> dplyr::mutate(${rName(step.nn)} = ${rowExprValueR(step.expr)})`;
  if (lang === "python") return pyAssignLines(step.nn, rowExprPy(step.expr, df), df).join("\n");
  return stataAssignLines(step.nn, rowExprSt(step.expr)).join("\n");
}

/** Formula-mode filter: a row whose condition is NA is dropped (dplyr::filter). */
export function filterExprStep(lang, expr, df = "df") {
  if (lang === "r") return `${df} <- ${df} |> dplyr::filter(${rowExprR(expr)})`;
  if (lang === "python") return `${df} = ${df}[${rowCondPy(expr, df)}.fillna(False).astype(bool)]`;
  return `keep if ${rowCondSt(expr)}`;
}

/**
 * case_when step: the FIRST condition that is TRUE wins; an NA condition does
 * not match (dplyr::case_when); no match → the default.
 */
export function caseWhenStep(lang, step, df = "df") {
  const cases = (step.cases ?? []).filter(c => String(c.cond ?? "").trim());
  if (!cases.length) throw new Error("no conditions");
  if (lang === "r") {
    const br = cases.map(c => `    ${rowExprR(c.cond)} ~ ${litR(c.val)}`);
    return `${df} <- ${df} |> dplyr::mutate(${rName(step.nn)} = dplyr::case_when(\n${br.join(",\n")},\n    .default = ${litR(step.defaultVal)}\n  ))`;
  }
  if (lang === "python") {
    const S = (x) => `pd.Series(${x}, index=${df}.index)`;
    let acc = S(pyLit(coerceLiteral(step.defaultVal)));
    for (const c of [...cases].reverse()) {
      acc = `${S(pyLit(coerceLiteral(c.val)))}.where(${rowCondPy(c.cond, df)}.fillna(False).astype(bool), ${acc})`;
    }
    return `${df}[${JSON.stringify(step.nn)}] = ${acc}`;
  }
  // Stata: one nested cond(), so the first TRUE condition wins.
  let cur = litSt(step.defaultVal);
  for (const c of [...cases].reverse()) {
    const hit = rowCondSt(c.cond), val = litSt(c.val);
    cur = { v: `cond(${hit}, ${val.v}, ${cur.v})`, m: val.m === "0" && cur.m === "0" ? "0" : `cond(${hit}, ${val.m}, ${cur.m})` };
  }
  return stataAssignLines(step.nn, cur).join("\n");
}
