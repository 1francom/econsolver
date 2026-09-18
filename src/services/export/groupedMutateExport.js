// ─── ECON STUDIO · services/export/groupedMutateExport.js ────────────────────
// Single owner of the `grouped_mutate` step's emission in R, Python and Stata.
// There were SIX copies (stepTranslators plus one per exporter) and none of
// them reproduced runner.js — found by the real-data harness on LM6:
//   R      dropped the row filter (mean over every row of the group)
//   Python used the WHOLE frame inside the per-group lambda and called an
//          undefined `mean`, so the script crashed
//   Stata  emitted `egen new = mean(<first by-column>)` for any expression
// and the non-expression modes ignored their row conditions ("applied in-app —
// review") while Stata emitted `egen … any()`, which does not exist.
//
// runner.js is the definition. Per group:
//   1. keep the rows passing the step's filter (evalPredicate semantics);
//   2. evaluate every aggregate call over those rows — the argument is a ROW
//      expression, missing values are skipped (sum of none = 0, mean/min/max of
//      none = missing, any of none = 0, all of none = 0, count = rows kept);
//   3. evaluate the outer expression on those group scalars and write it to
//      EVERY row of the group (filtered-out rows included); a boolean → 1/0.
// The non-expression modes are the same thing with a single aggregate and no
// filter: mean/sum/min/max/first/last over a column, count(), any/all over
// the step's row conditions.
//
// The expression is PARSED rather than regex-rewritten, because the three
// targets disagree on precedence: in pandas `a != 0 & b == 1` groups as
// `a != (0 & b) == 1`. Every binary operation is emitted fully parenthesised.
//
// Anything outside this small grammar throws; callers turn that into an
// explicit "translate manually" comment instead of a wrong script.

import { predicateToR, predicateToPython, predicateToStata } from "../../pipeline/predicateExport.js";
import { AGG_FNS } from "../../pipeline/groupExpr.js";

// ─── parser ───────────────────────────────────────────────────────────────────

function tokenize(src) {
  const toks = [];
  let i = 0;
  const s = String(src);
  while (i < s.length) {
    const c = s[i];
    if (/\s/.test(c)) { i++; continue; }
    if (/[0-9]/.test(c) || (c === "." && /[0-9]/.test(s[i + 1] ?? ""))) {
      let j = i; while (j < s.length && /[0-9.eE]/.test(s[j])) j++;
      toks.push({ k: "num", v: s.slice(i, j) }); i = j; continue;
    }
    if (c === '"' || c === "'") {
      let j = i + 1, v = "";
      while (j < s.length && s[j] !== c) { if (s[j] === "\\") j++; v += s[j++]; }
      toks.push({ k: "str", v }); i = j + 1; continue;
    }
    if (/[A-Za-z_$]/.test(c)) {
      let j = i; while (j < s.length && /[A-Za-z0-9_$.]/.test(s[j])) j++;
      let name = s.slice(i, j).replace(/^Math\./, "");
      toks.push({ k: "id", v: name }); i = j; continue;
    }
    const three = s.slice(i, i + 3), two = s.slice(i, i + 2);
    if (three === "===" || three === "!==") { toks.push({ k: "op", v: three.slice(0, 2) }); i += 3; continue; }
    if (["==", "!=", "<=", ">=", "&&", "||", "**"].includes(two)) { toks.push({ k: "op", v: two }); i += 2; continue; }
    if ("+-*/%<>!&|^(),".includes(c)) { toks.push({ k: "op", v: c }); i++; continue; }
    throw new Error(`unsupported character "${c}"`);
  }
  return toks;
}

function parse(src) {
  const t = tokenize(src);
  let p = 0;
  const peek = () => t[p];
  const isOp = (...vs) => peek()?.k === "op" && vs.includes(peek().v);
  const take = () => t[p++];
  const expect = (v) => { if (!isOp(v)) throw new Error(`expected "${v}"`); p++; };

  const bin = (next, ops, norm = x => x) => () => {
    let l = next();
    while (isOp(...ops)) { const op = norm(take().v); l = { t: "bin", op, l, r: next() }; }
    return l;
  };
  const primary = () => {
    const tk = take();
    if (!tk) throw new Error("unexpected end of expression");
    if (tk.k === "num") return { t: "num", v: Number(tk.v) };
    if (tk.k === "str") return { t: "str", v: tk.v };
    if (tk.k === "op" && tk.v === "(") { const e = orE(); expect(")"); return e; }
    if (tk.k === "id") {
      if (tk.v === "true" || tk.v === "TRUE")  return { t: "bool", v: true };
      if (tk.v === "false" || tk.v === "FALSE") return { t: "bool", v: false };
      if (tk.v === "null" || tk.v === "NA")    return { t: "null" };
      if (isOp("(")) {
        take();
        const args = [];
        if (!isOp(")")) { do { args.push(orE()); } while (isOp(",") && take()); }
        expect(")");
        return { t: "call", fn: tk.v, args };
      }
      return { t: "col", name: tk.v };
    }
    throw new Error(`unexpected "${tk.v}"`);
  };
  const pow = () => {
    const b = primary();
    if (isOp("**", "^")) { take(); return { t: "bin", op: "^", l: b, r: unary() }; }
    return b;
  };
  const unary = () => {
    if (isOp("-")) { take(); return { t: "neg", e: unary() }; }
    if (isOp("+")) { take(); return unary(); }
    return pow();
  };
  const mul = bin(unary, ["*", "/", "%"]);
  const add = bin(mul, ["+", "-"]);
  const cmp = () => {
    const l = add();
    if (isOp("==", "!=", "<", "<=", ">", ">=")) { const op = take().v; return { t: "bin", op, l, r: add() }; }
    return l;
  };
  const notE = () => {
    if (isOp("!")) { take(); return { t: "not", e: notE() }; }
    return cmp();
  };
  const andE = bin(notE, ["&&", "&"], () => "&");
  const orE  = bin(andE, ["||", "|"], () => "|");

  const ast = orE();
  if (p < t.length) throw new Error(`unexpected "${t[p].v}"`);
  return ast;
}

// Hoist aggregate calls in dependency order (inner before outer), replacing
// each with a reference — the same contract as groupExpr.extractAggregateCalls.
function hoist(node, aggs) {
  switch (node.t) {
    case "bin":  return { ...node, l: hoist(node.l, aggs), r: hoist(node.r, aggs) };
    case "not":
    case "neg":  return { ...node, e: hoist(node.e, aggs) };
    case "call": {
      const args = node.args.map(a => hoist(a, aggs));
      if (AGG_FNS.includes(node.fn)) {
        if (args.length > 1) throw new Error(`${node.fn}() takes one argument`);
        if (!args.length && node.fn !== "count") throw new Error(`${node.fn}() needs an argument`);
        const id = aggs.length;
        aggs.push({ name: node.fn, arg: args[0] ?? null });
        return { t: "agg", id };
      }
      return { ...node, args };
    }
    default: return node;
  }
}

/**
 * Normalise every grouped_mutate shape to { by, newCol, filter, aggs, outer }.
 * `filter` is a predicate node or null; each agg's `arg` is an AST, a
 * predicate node ({t:"pred"}), or null (count()).
 */
export function planGroupedMutate(step) {
  const by = step.by ?? [];
  if (!by.length || !step.newCol) throw new Error("incomplete config (needs group columns and an output name)");
  const fn = step.fn ?? "mean";
  const condsToNode = (conds) => conds?.length
    ? { type: "and", children: conds.map(c => ({ type: "condition", col: c.col, op: c.op, value: c.val ?? c.value })) }
    : null;

  if (fn === "expr") {
    if (!step.expr) throw new Error("empty expression");
    const aggs = [];
    const outer = hoist(parse(step.expr), aggs);
    return { by, newCol: step.newCol, filter: condsToNode(step.filter), aggs, outer };
  }
  if (fn === "any" || fn === "all") {
    const pred = condsToNode(step.condition);
    return { by, newCol: step.newCol, filter: null, outer: { t: "agg", id: 0 },
      aggs: [{ name: fn, arg: pred ? { t: "pred", node: pred } : { t: "bool", v: true } }] };
  }
  if (fn === "count") {
    return { by, newCol: step.newCol, filter: null, outer: { t: "agg", id: 0 }, aggs: [{ name: "count", arg: null }] };
  }
  if (!["sum", "mean", "min", "max", "first", "last"].includes(fn)) throw new Error(`unsupported function "${fn}"`);
  if (!step.col) throw new Error(`${fn} needs a column`);
  return { by, newCol: step.newCol, filter: null, outer: { t: "agg", id: 0 },
    aggs: [{ name: fn, arg: { t: "col", name: step.col } }] };
}

// ─── shared emitter core ─────────────────────────────────────────────────────

const dq = (v) => String(v ?? "").replace(/\\/g, "\\\\").replace(/"/g, '\\"');
const numLit = (v) => (Number.isInteger(v) ? String(v) : String(v));

function emitExpr(node, L) {
  const e = (n) => emitExpr(n, L);
  switch (node.t) {
    case "num":  return numLit(node.v);
    case "str":  return `"${dq(node.v)}"`;
    case "bool": return L.bool(node.v);
    case "null": return L.nullLit;
    case "col":  return L.col(node.name);
    case "agg":  return L.agg(node.id);
    case "pred": return L.pred(node.node);
    case "neg":  return `(-${e(node.e)})`;
    case "not":  return L.not(e(node.e));
    case "bin":  return L.bin(node.op, e(node.l), e(node.r));
    case "call": {
      const f = L.fns[node.fn];
      if (!f) throw new Error(`function ${node.fn}() has no ${L.name} equivalent here`);
      return f(...node.args.map(e));
    }
    default: throw new Error(`cannot emit ${node.t}`);
  }
}

// ─── R ────────────────────────────────────────────────────────────────────────
// Evaluated per group inside mutate(): columns are the group's vectors, the
// mask `.k` selects the filtered rows, and each aggregate is one .lx_* helper
// applied to the argument restricted to `.k`.

const rName = (c) => (/^[A-Za-z_][A-Za-z0-9_.]*$/.test(c) ? c : `\`${c}\``);

const R_LANG = {
  name: "R", nullLit: "NA",
  bool: (v) => (v ? "TRUE" : "FALSE"),
  col: rName,
  agg: (id) => `.a${id}`,
  pred: (node) => predicateToR(node, { name: rName }),
  not: (x) => `(!${x})`,
  bin: (op, l, r) => `(${l} ${op === "%" ? "%%" : op} ${r})`,
  fns: {
    log: (x) => `log(${x})`, log2: (x) => `log2(${x})`, log10: (x) => `log10(${x})`,
    sqrt: (x) => `sqrt(${x})`, exp: (x) => `exp(${x})`, abs: (x) => `abs(${x})`,
    round: (x) => `round(${x})`, floor: (x) => `floor(${x})`, ceil: (x) => `ceiling(${x})`,
    sign: (x) => `sign(${x})`, isna: (x) => `is.na(${x})`, notna: (x) => `(!is.na(${x}))`,
    ifelse: (c, a, b) => `ifelse(${c}, ${a}, ${b})`,
    pmin: (a, b) => `pmin(${a}, ${b})`, pmax: (a, b) => `pmax(${a}, ${b})`,
    between: (v, lo, hi) => `((${v} >= ${lo}) & (${v} <= ${hi}))`,
    clamp: (v, lo, hi) => `pmin(pmax(${v}, ${lo}), ${hi})`,
    coalesce: (a, b) => `dplyr::coalesce(${a}, ${b})`,
  },
};

const R_HELPERS = [
  `.lx_num  <- function(v) { v <- suppressWarnings(as.numeric(v)); v[!is.na(v)] }`,
  `.lx_any  <- function(v) as.integer(any(!is.na(v) & as.logical(v)))`,
  `.lx_all  <- function(v) as.integer(length(v) > 0 && all(!is.na(v) & as.logical(v)))`,
  `.lx_sum  <- function(v) sum(.lx_num(v))`,
  `.lx_mean <- function(v) { v <- .lx_num(v); if (length(v)) mean(v) else NA_real_ }`,
  `.lx_min  <- function(v) { v <- .lx_num(v); if (length(v)) min(v)  else NA_real_ }`,
  `.lx_max  <- function(v) { v <- .lx_num(v); if (length(v)) max(v)  else NA_real_ }`,
  `.lx_first <- function(v) if (length(v)) v[[1]] else NA`,
  `.lx_last  <- function(v) if (length(v)) v[[length(v)]] else NA`,
];

export function groupedMutateR(step, df = "df") {
  const plan = planGroupedMutate(step);
  const mask = plan.filter ? predicateToR(plan.filter, { name: rName }) : "TRUE";
  const body = [
    `    .k <- rep_len(${mask}, dplyr::n()); .k[is.na(.k)] <- FALSE`,
    ...plan.aggs.map((a, i) => {
      if (a.name === "count") return `    .a${i} <- sum(.k)`;
      const arg = emitExpr(a.arg, R_LANG);
      return `    .a${i} <- .lx_${a.name}(rep_len(${arg}, dplyr::n())[.k])`;
    }),
    `    .v <- ${emitExpr(plan.outer, R_LANG)}`,
    `    if (is.logical(.v)) as.integer(.v) else .v`,
  ];
  return [
    `# grouped_mutate: ${step.desc ?? plan.newCol} — per group${plan.filter ? ", aggregates over the filtered rows only" : ""}; missing values skipped`,
    ...R_HELPERS,
    `${df} <- ${df} |>`,
    `  dplyr::group_by(${plan.by.map(rName).join(", ")}) |>`,
    `  dplyr::mutate(${rName(plan.newCol)} = local({`,
    ...body,
    `  })) |>`,
    `  dplyr::ungroup()`,
  ].join("\n");
}

// ─── Python (pandas) ─────────────────────────────────────────────────────────
// Vectorised over the whole frame: the argument of each aggregate becomes a
// column, is masked, and is reduced with groupby().transform(), which already
// broadcasts the group value back to every row. The outer expression then
// combines those per-row group scalars.

const pyStr = (s) => `"${dq(s)}"`;

function pyLang(df) {
  return {
    name: "Python", nullLit: "np.nan",
    bool: (v) => (v ? "True" : "False"),
    col: (c) => `${df}[${pyStr(c)}]`,
    agg: (id) => `_a${id}`,
    pred: (node) => predicateToPython(node, { df }),
    not: (x) => `(~${x})`,
    bin: (op, l, r) => `(${l} ${op === "^" ? "**" : op} ${r})`,
    fns: {
      log: (x) => `np.log(${x})`, log2: (x) => `np.log2(${x})`, log10: (x) => `np.log10(${x})`,
      sqrt: (x) => `np.sqrt(${x})`, exp: (x) => `np.exp(${x})`, abs: (x) => `np.abs(${x})`,
      round: (x) => `np.round(${x})`, floor: (x) => `np.floor(${x})`, ceil: (x) => `np.ceil(${x})`,
      sign: (x) => `np.sign(${x})`, isna: (x) => `pd.isna(${x})`, notna: (x) => `pd.notna(${x})`,
      ifelse: (c, a, b) => `np.where(${c}, ${a}, ${b})`,
      pmin: (a, b) => `np.minimum(${a}, ${b})`, pmax: (a, b) => `np.maximum(${a}, ${b})`,
      between: (v, lo, hi) => `((${v} >= ${lo}) & (${v} <= ${hi}))`,
      clamp: (v, lo, hi) => `np.clip(${v}, ${lo}, ${hi})`,
      coalesce: (a, b) => `pd.Series(${a}, index=${df}.index).fillna(${b})`,
    },
  };
}

export function groupedMutatePython(step, df = "df") {
  const plan = planGroupedMutate(step);
  const L = pyLang(df);
  const g = (s) => `${s}.groupby(_keys, dropna=False)`;
  const lines = [
    `# grouped_mutate: ${step.desc ?? plan.newCol} — per group${plan.filter ? ", aggregates over the filtered rows only" : ""}; missing values skipped`,
    `_keys = [${plan.by.map(c => `${df}[${pyStr(c)}]`).join(", ")}]`,
    plan.filter
      ? `_k = pd.Series(${predicateToPython(plan.filter, { df })}, index=${df}.index).fillna(False).astype(bool)`
      : `_k = pd.Series(True, index=${df}.index)`,
  ];
  plan.aggs.forEach((a, i) => {
    if (a.name === "count") { lines.push(`_a${i} = ${g("_k")}.transform("sum")`); return; }
    lines.push(`_t = pd.Series(${emitExpr(a.arg, L)}, index=${df}.index)`);
    switch (a.name) {
      case "any":
        lines.push(`_a${i} = ${g("(_t.fillna(0).astype(bool) & _k)")}.transform("max").astype(int)`); break;
      case "all":
        lines.push(`_a${i} = (${g("(~_k | _t.fillna(0).astype(bool))")}.transform("min") & ${g("_k")}.transform("max")).astype(int)`); break;
      case "sum": case "mean": case "min": case "max":
        lines.push(`_a${i} = ${g(`pd.to_numeric(_t, errors="coerce").astype(float).where(_k)`)}.transform("${a.name}")`); break;
      case "first": case "last":
        lines.push(`_c = ${g("_k")}.cumsum()`);
        lines.push(`_a${i} = ${g(`pd.to_numeric(_t, errors="coerce").astype(float).where(_k & (_c == ${a.name === "first" ? "1" : `${g("_k")}.transform("sum")`}))`)}.transform("max")`);
        break;
      default: throw new Error(`unsupported aggregate ${a.name}`);
    }
  });
  lines.push(`_v = pd.Series(${emitExpr(plan.outer, L)}, index=${df}.index)`);
  lines.push(`${df}[${pyStr(plan.newCol)}] = _v.astype(int) if _v.dtype == bool else _v`);
  return lines.join("\n");
}

// ─── Stata ───────────────────────────────────────────────────────────────────
// egen over the group, restricted with cond(_lx_k, arg, .). Stata's missing
// compares as +infinity, so every aggregate guards with !missing() — without it
// `any(x != 0)` would count a missing x as nonzero. Row order is saved first
// and restored at the end: bysort re-sorts the data in place.

const stVar = (c) => String(c).replace(/[^A-Za-z0-9_]/g, "_");

const ST_LANG = {
  name: "Stata", nullLit: ".",
  bool: (v) => (v ? "1" : "0"),
  col: stVar,
  agg: (id) => `_lx_a${id}`,
  pred: (node) => predicateToStata(node, { name: stVar }),
  not: (x) => `(!${x})`,
  bin: (op, l, r) => (op === "%" ? `mod(${l}, ${r})` : `(${l} ${op} ${r})`),
  fns: {
    log: (x) => `ln(${x})`, log2: (x) => `(ln(${x})/ln(2))`, log10: (x) => `log10(${x})`,
    sqrt: (x) => `sqrt(${x})`, exp: (x) => `exp(${x})`, abs: (x) => `abs(${x})`,
    round: (x) => `round(${x})`, floor: (x) => `floor(${x})`, ceil: (x) => `ceil(${x})`,
    sign: (x) => `sign(${x})`, isna: (x) => `missing(${x})`, notna: (x) => `(!missing(${x}))`,
    ifelse: (c, a, b) => `cond(${c}, ${a}, ${b})`,
    pmin: (a, b) => `min(${a}, ${b})`, pmax: (a, b) => `max(${a}, ${b})`,
    between: (v, lo, hi) => `inrange(${v}, ${lo}, ${hi})`,
    clamp: (v, lo, hi) => `min(max(${v}, ${lo}), ${hi})`,
    coalesce: (a, b) => `cond(missing(${a}), ${b}, ${a})`,
  },
};

export function groupedMutateStata(step) {
  const plan = planGroupedMutate(step);
  const by = plan.by.map(stVar).join(" ");
  const out = stVar(plan.newCol);
  const lines = [
    `* grouped_mutate: ${step.desc ?? plan.newCol} — per group${plan.filter ? ", aggregates over the filtered rows only" : ""}; missing values skipped`,
    `capture drop ${out}`,
    `capture drop _lx_*`,
    `gen long _lx_o = _n`,
    `gen byte _lx_k = ${plan.filter ? predicateToStata(plan.filter, { name: stVar }) : "1"}`,
    `replace _lx_k = 0 if missing(_lx_k)`,
    `bysort ${by}: egen double _lx_nk = total(_lx_k)`,
  ];
  plan.aggs.forEach((a, i) => {
    const A = `_lx_a${i}`;
    if (a.name === "count") { lines.push(`gen double ${A} = _lx_nk`); return; }
    const t = `_lx_t${i}`;
    lines.push(`gen double ${t} = ${emitExpr(a.arg, ST_LANG)}`);
    switch (a.name) {
      case "any": lines.push(`bysort ${by}: egen double ${A} = max(_lx_k & !missing(${t}) & ${t} != 0)`); break;
      case "all":
        lines.push(`bysort ${by}: egen double ${A} = min(!_lx_k | (!missing(${t}) & ${t} != 0))`);
        lines.push(`replace ${A} = ${A} * (_lx_nk > 0)`);
        break;
      case "sum":  lines.push(`bysort ${by}: egen double ${A} = total(cond(_lx_k, ${t}, .))`); break;
      case "mean": case "min": case "max":
        lines.push(`bysort ${by}: egen double ${A} = ${a.name}(cond(_lx_k, ${t}, .))`); break;
      case "first": case "last":
        lines.push(`bysort ${by} (_lx_o): gen double _lx_c${i} = sum(_lx_k)`);
        lines.push(`bysort ${by}: egen double ${A} = max(cond(_lx_k & _lx_c${i} == ${a.name === "first" ? "1" : "_lx_nk"}, ${t}, .))`);
        break;
      default: throw new Error(`unsupported aggregate ${a.name}`);
    }
  });
  lines.push(`gen double ${out} = ${emitExpr(plan.outer, ST_LANG)}`);
  lines.push(`sort _lx_o`);
  lines.push(`drop _lx_*`);
  return lines.join("\n");
}

/** Wrap an emitter so an untranslatable step becomes an explicit comment. */
export function safeGroupedMutate(lang, step, df) {
  const cmt = lang === "stata" ? "*" : "#";
  try {
    return lang === "r" ? groupedMutateR(step, df)
      : lang === "python" ? groupedMutatePython(step, df)
      : groupedMutateStata(step);
  } catch (e) {
    return `${cmt} grouped_mutate (${step.desc ?? step.newCol ?? "?"}): cannot be translated automatically — ${e.message}. Reproduce it by hand.`;
  }
}
