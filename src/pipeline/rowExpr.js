// ─── ECON STUDIO · pipeline/rowExpr.js ───────────────────────────────────────
// Single owner of how a ROW EXPRESSION (mutate, if_else / case_when conditions,
// formula filters, vector_assign rules, grouped_mutate arguments) treats a
// missing value. The convention is R's (Franco, 2026-09-22):
//
//   NA op x   → NA   for every arithmetic and comparison operator
//   NA & FALSE → FALSE,  NA & TRUE → NA      (Kleene three-valued logic)
//   NA | TRUE  → TRUE,   NA | FALSE → NA
//   !NA → NA,  -NA → NA,  cond ? a : b with cond NA → NA
//   NA %in% c(1, 2) → FALSE,  NA %in% c(1, NA) → TRUE   (%in% is never NA)
//
// Expressions used to be handed to `new Function` verbatim, so they ran on JS
// semantics, where a missing value is `null` and `null` is 0 in an ordering
// comparison: `x >= 0` and `x < 1` were TRUE for a missing x, `x + 1` was 1.
// That is the `Number(null) === 0` bug class again, and it also made the app
// disagree with every exported script (R: NA; pandas: FALSE; Stata: missing is
// +∞, so `x > 0` is TRUE and `x < 1` FALSE). Two more JS-isms went with it:
// `^` was bitwise XOR (R, Stata and the exports read it as a power), and `%`
// truncated toward zero (R's %%, pandas' % and Stata's mod() floor).
//
// The expression is PARSED — operators cannot be overloaded in JS — and each
// operation compiles to a call into NA_OPS. Precedence follows R (the exports
// emit fully-parenthesised code from the same tree, so they cannot disagree):
// in particular `!` binds looser than a comparison, so `!x == 0` is !(x == 0).
// Anything outside the grammar (arrow functions, assignment…) falls back to the
// old verbatim evaluation, so no saved pipeline stops running.
//
// SECURITY: the compiled source is built only from the parsed tree — identifiers
// and literals of the user's expression plus calls into `__na` — and every
// caller runs isSafeExpr on the raw expression first, exactly as before. This
// is the same sandbox the runner has always used, narrowed, not widened.

import { translateRInOperator } from "./exprGuard.js";

export const isNA = (v) =>
  v === null || v === undefined || (typeof v === "number" && Number.isNaN(v));

const truth = (v) => !!v && v !== "0" && v !== "false";

// ─── runtime ─────────────────────────────────────────────────────────────────

export const NA_OPS = Object.freeze({
  ar(op, a, b) {
    if (isNA(a) || isNA(b)) return null;
    switch (op) {
      case "+": return a + b;
      case "-": return a - b;
      case "*": return a * b;
      case "/": return a / b;
      case "%": return a - b * Math.floor(a / b);   // floored, like R %% / Stata mod()
      case "^": return Math.pow(a, b);
      default:  throw new Error(`operator ${op}`);
    }
  },
  cmp(op, a, b) {
    if (isNA(a) || isNA(b)) return null;
    switch (op) {
      case "==":  return a == b;          // eslint-disable-line eqeqeq
      case "!=":  return a != b;          // eslint-disable-line eqeqeq
      case "===": return a === b;
      case "!==": return a !== b;
      case "<":   return a < b;
      case "<=":  return a <= b;
      case ">":   return a > b;
      case ">=":  return a >= b;
      default:    throw new Error(`operator ${op}`);
    }
  },
  and(a, bf) {
    if (!isNA(a) && !truth(a)) return false;
    const b = bf();
    if (!isNA(b) && !truth(b)) return false;
    return isNA(a) || isNA(b) ? null : true;
  },
  or(a, bf) {
    if (!isNA(a) && truth(a)) return true;
    const b = bf();
    if (!isNA(b) && truth(b)) return true;
    return isNA(a) || isNA(b) ? null : false;
  },
  not: (a) => (isNA(a) ? null : !truth(a)),
  neg: (a) => (isNA(a) ? null : -a),
  tern: (c, af, bf) => (isNA(c) ? null : truth(c) ? af() : bf()),
  inop(l, r) {
    const set = Array.isArray(r) ? r : [r];
    // eslint-disable-next-line eqeqeq
    return isNA(l) ? set.some(isNA) : set.some(v => !isNA(v) && v == l);
  },
  range(lo, hi) {
    if (isNA(lo) || isNA(hi)) return [];
    const out = [], step = hi >= lo ? 1 : -1;
    for (let v = lo; step > 0 ? v <= hi : v >= hi; v += step) out.push(v);
    return out;
  },
  c: (...xs) => [].concat(...xs),
  get: (o, k) => (isNA(o) ? null : (o[k] ?? null)),
  mcall(o, name, args) {
    if (isNA(o)) return null;
    if (o === Math && args.some(isNA)) return null;
    const f = o[name];
    if (typeof f !== "function") throw new TypeError(`${name} is not a function`);
    return f.apply(o, args);
  },
});

// ─── parser ──────────────────────────────────────────────────────────────────

const NUM_RE = /^(?:\d+\.?\d*|\.\d+)(?:[eE][+-]?\d+)?/;

function tokenize(src) {
  const toks = [];
  const s = String(src);
  let i = 0;
  while (i < s.length) {
    const c = s[i];
    if (/\s/.test(c)) { i++; continue; }
    if (/[0-9]/.test(c) || (c === "." && /[0-9]/.test(s[i + 1] ?? ""))) {
      const m = s.slice(i).match(NUM_RE);
      toks.push({ k: "num", v: m[0] }); i += m[0].length; continue;
    }
    if (c === '"' || c === "'") {
      let j = i + 1, v = "";
      while (j < s.length && s[j] !== c) {
        if (s[j] === "\\" && j + 1 < s.length) {
          const e = s[j + 1];
          v += e === "n" ? "\n" : e === "t" ? "\t" : e;
          j += 2; continue;
        }
        v += s[j++];
      }
      if (j >= s.length) throw new Error("unterminated string");
      toks.push({ k: "str", v }); i = j + 1; continue;
    }
    if (/[A-Za-z_$]/.test(c)) {
      let j = i; while (j < s.length && /[A-Za-z0-9_$]/.test(s[j])) j++;
      toks.push({ k: "id", v: s.slice(i, j) }); i = j; continue;
    }
    if (s.startsWith("%in%", i)) { toks.push({ k: "op", v: "%in%" }); i += 4; continue; }
    if (s.startsWith("%%", i))   { toks.push({ k: "op", v: "%" });    i += 2; continue; }
    const three = s.slice(i, i + 3), two = s.slice(i, i + 2);
    if (three === "===" || three === "!==") { toks.push({ k: "op", v: three }); i += 3; continue; }
    if (["==", "!=", "<=", ">=", "&&", "||", "**"].includes(two)) { toks.push({ k: "op", v: two }); i += 2; continue; }
    if ("+-*/%<>!&|^(),.[]?:".includes(c)) { toks.push({ k: "op", v: c }); i++; continue; }
    throw new Error(`unsupported character "${c}"`);
  }
  return toks;
}

const NA_WORDS = new Set(["NA", "null", "undefined", "NA_real_", "NA_integer_", "NA_character_"]);

/**
 * Parse a row expression into a small AST. Throws on anything outside the
 * grammar. Node types: num str bool null col arr call member index mcall
 * bin(op ∈ + - * / % ^ == != === !== < <= > >=) and or not neg tern in range.
 */
export function parseRowExpr(src) {
  const t = tokenize(src);
  if (!t.length) throw new Error("empty expression");
  let p = 0;
  let noRange = 0;   // inside a ternary's then-branch `:` belongs to the ternary
  const peek = () => t[p];
  const isOp = (...vs) => peek()?.k === "op" && vs.includes(peek().v);
  const take = () => t[p++];
  const expect = (v) => { if (!isOp(v)) throw new Error(`expected "${v}"`); p++; };
  const nested = (fn) => { const s = noRange; noRange = 0; const e = fn(); noRange = s; return e; };
  const args = (close) => nested(() => {
    const out = [];
    if (!isOp(close)) { do { out.push(ternary()); } while (isOp(",") && take()); }
    expect(close);
    return out;
  });

  const primary = () => {
    const tk = take();
    if (!tk) throw new Error("unexpected end of expression");
    if (tk.k === "num") return { t: "num", v: Number(tk.v) };
    if (tk.k === "str") return { t: "str", v: tk.v };
    if (tk.k === "op" && tk.v === "(") { const e = nested(ternary); expect(")"); return e; }
    if (tk.k === "op" && tk.v === "[") return { t: "arr", items: args("]") };
    if (tk.k === "id") {
      if (tk.v === "true" || tk.v === "TRUE")  return { t: "bool", v: true };
      if (tk.v === "false" || tk.v === "FALSE") return { t: "bool", v: false };
      if (NA_WORDS.has(tk.v)) return { t: "null" };
      // R's dotted predicate, typed from habit.
      if (tk.v === "is" && isOp(".") && t[p + 1]?.v === "na" && t[p + 2]?.v === "(") {
        p += 3; return { t: "call", fn: "isna", args: args(")") };
      }
      if (isOp("(")) { take(); return { t: "call", fn: tk.v, args: args(")") }; }
      return { t: "col", name: tk.v };
    }
    throw new Error(`unexpected "${tk.v}"`);
  };
  const postfix = () => {
    let e = primary();
    for (;;) {
      if (isOp(".")) {
        take();
        const nm = take();
        if (nm?.k !== "id") throw new Error("expected a name after '.'");
        if (isOp("(")) { take(); e = { t: "mcall", obj: e, name: nm.v, args: args(")") }; }
        else e = { t: "member", obj: e, name: nm.v };
      } else if (isOp("[")) {
        take(); const idx = nested(ternary); expect("]");
        e = { t: "index", obj: e, idx };
      } else return e;
    }
  };
  const pow = () => {
    const b = postfix();
    if (isOp("^", "**")) { take(); return { t: "bin", op: "^", l: b, r: unary() }; }
    return b;
  };
  function unary() {
    if (isOp("-")) { take(); return { t: "neg", e: unary() }; }
    if (isOp("+")) { take(); return unary(); }
    if (isOp("!")) { take(); return { t: "not", e: notE() }; }
    return pow();
  }
  const range = () => {
    const l = unary();
    if (!noRange && isOp(":")) { take(); return { t: "range", lo: l, hi: unary() }; }
    return l;
  };
  const special = () => {
    let l = range();
    while (isOp("%in%")) { take(); l = { t: "in", l, r: range() }; }
    return l;
  };
  const leftAssoc = (next, ops) => () => {
    let l = next();
    while (isOp(...ops)) { const op = take().v; l = { t: "bin", op, l, r: next() }; }
    return l;
  };
  const mul = leftAssoc(special, ["*", "/", "%"]);
  const add = leftAssoc(mul, ["+", "-"]);
  const cmp = leftAssoc(add, ["==", "!=", "===", "!==", "<", "<=", ">", ">="]);
  function notE() {
    if (isOp("!")) { take(); return { t: "not", e: notE() }; }
    return cmp();
  }
  const andE = () => {
    let l = notE();
    while (isOp("&&", "&")) { take(); l = { t: "and", l, r: notE() }; }
    return l;
  };
  const orE = () => {
    let l = andE();
    while (isOp("||", "|")) { take(); l = { t: "or", l, r: andE() }; }
    return l;
  };
  function ternary() {
    const c = orE();
    if (!isOp("?")) return c;
    take();
    noRange++; const a = ternary(); noRange--;
    expect(":");
    return { t: "tern", c, a, b: ternary() };
  }

  const ast = ternary();
  if (p < t.length) throw new Error(`unexpected "${t[p].v}"`);
  return ast;
}

// ─── JS compiler ─────────────────────────────────────────────────────────────

export const ARITH_OPS = new Set(["+", "-", "*", "/", "%", "^"]);

function emitJS(n) {
  const e = emitJS;
  switch (n.t) {
    case "num":    return Number.isFinite(n.v) ? String(n.v) : "NaN";
    case "str":    return JSON.stringify(n.v);
    case "bool":   return n.v ? "true" : "false";
    case "null":   return "null";
    case "col":    return n.name;
    case "arr":    return `[${n.items.map(e).join(", ")}]`;
    case "call":   return n.fn === "c" ? `__na.c(${n.args.map(e).join(", ")})` : `${n.fn}(${n.args.map(e).join(", ")})`;
    case "member": return `__na.get(${e(n.obj)}, ${JSON.stringify(n.name)})`;
    case "index":  return `__na.get(${e(n.obj)}, ${e(n.idx)})`;
    case "mcall":  return `__na.mcall(${e(n.obj)}, ${JSON.stringify(n.name)}, [${n.args.map(e).join(", ")}])`;
    case "bin":    return `__na.${ARITH_OPS.has(n.op) ? "ar" : "cmp"}(${JSON.stringify(n.op)}, ${e(n.l)}, ${e(n.r)})`;
    case "and":    return `__na.and(${e(n.l)}, () => (${e(n.r)}))`;
    case "or":     return `__na.or(${e(n.l)}, () => (${e(n.r)}))`;
    case "not":    return `__na.not(${e(n.e)})`;
    case "neg":    return `__na.neg(${e(n.e)})`;
    case "tern":   return `__na.tern(${e(n.c)}, () => (${e(n.a)}), () => (${e(n.b)}))`;
    case "in":     return `__na.inop(${e(n.l)}, ${e(n.r)})`;
    case "range":  return `__na.range(${e(n.lo)}, ${e(n.hi)})`;
    default:       throw new Error(`node ${n.t}`);
  }
}

/** NA-aware JS source for `src` (references `__na`), or null if it does not parse. */
export function compileRowExpr(src) {
  try { return emitJS(parseRowExpr(src)); } catch { return null; }
}

/**
 * Build an evaluator for a row expression over the given parameter names.
 * NA-aware when the expression parses; otherwise the old verbatim evaluation
 * (with R's %in% rewritten), so no saved pipeline stops running. Throws a
 * SyntaxError exactly where the old `new Function` did.
 */
export function makeRowFn(src, params) {
  const js = compileRowExpr(src);
  const body = js !== null
    ? `"use strict"; return (${js});`
    : `"use strict"; return (${translateRInOperator(src)});`;
  // eslint-disable-next-line no-new-func
  const f = new Function(...params, "__na", body);
  const fn = (...a) => f(...a, NA_OPS);
  fn.naAware = js !== null;
  return fn;
}
