// ECON STUDIO - symbolicSolve.js
// Algebraic equation solver for the Calculate module.
//
// Design goal:
//   keep symbolic parameters symbolic, solve the common economist cases fast,
//   and hand off genuinely non-polynomial systems to the numeric solvers.
//
// Current scope:
//   - one equation in one unknown
//   - linear and quadratic polynomials in that unknown
//   - arbitrary symbolic parameter expressions as coefficients
//   - LHS = RHS or expression = 0 forms

const N = v => ({ k: "n", v });
const V = n => ({ k: "v", n });
const U = a => ({ k: "u", a });
const B = (o, l, r) => ({ k: "b", o, l, r });
const F = (n, a) => ({ k: "f", n, a });

function lex(src) {
  const toks = [];
  let i = 0;
  while (i < src.length) {
    const c = src[i];
    if (/\s/.test(c)) { i++; continue; }
    if (/[\d.]/.test(c)) {
      const j = i;
      while (/[\d.]/.test(src[i] ?? "")) i++;
      if (/[eE]/.test(src[i] ?? "")) {
        i++;
        if (/[+-]/.test(src[i] ?? "")) i++;
        while (/\d/.test(src[i] ?? "")) i++;
      }
      const value = parseFloat(src.slice(j, i));
      if (!Number.isFinite(value)) throw new Error(`Invalid number near '${src.slice(j, i)}'`);
      toks.push({ t: "n", v: value });
      continue;
    }
    if (/[a-zA-Z_]/.test(c)) {
      const j = i;
      while (/[a-zA-Z0-9_]/.test(src[i] ?? "")) i++;
      toks.push({ t: "id", v: src.slice(j, i) });
      continue;
    }
    if (c === "*" && src[i + 1] === "*") {
      toks.push({ t: "op", v: "^" });
      i += 2;
      continue;
    }
    if ("+-*/^(),".includes(c)) {
      toks.push({ t: "op", v: c });
      i++;
      continue;
    }
    throw new Error(`Unexpected character: '${c}'`);
  }
  toks.push({ t: "eof" });
  return toks;
}

function parse(src) {
  const tok = lex(src);
  let p = 0;
  const at = () => tok[p];
  const adv = () => tok[p++];
  const eat = v => {
    if (at().v !== v) throw new Error(`Expected '${v}', got '${at().v ?? "EOF"}'`);
    adv();
  };

  function expr() { return addSub(); }
  function addSub() {
    let n = mulDiv();
    while (at().v === "+" || at().v === "-") {
      const o = adv().v;
      n = B(o, n, mulDiv());
    }
    return n;
  }
  function mulDiv() {
    let n = pow();
    while (at().v === "*" || at().v === "/") {
      const o = adv().v;
      n = B(o, n, pow());
    }
    return n;
  }
  function pow() {
    const base = unary();
    if (at().v === "^") {
      adv();
      return B("^", base, unary());
    }
    return base;
  }
  function unary() {
    if (at().v === "-") { adv(); return U(unary()); }
    if (at().v === "+") { adv(); return unary(); }
    return atom();
  }
  function atom() {
    const t = at();
    if (t.t === "n") { adv(); return N(t.v); }
    if (t.t === "id") {
      const name = adv().v;
      if (at().v === "(") {
        adv();
        const arg = expr();
        eat(")");
        return F(name, arg);
      }
      return V(name);
    }
    if (t.v === "(") {
      adv();
      const n = expr();
      eat(")");
      return n;
    }
    throw new Error(`Unexpected token: '${t.v ?? t.t}'`);
  }

  const tree = expr();
  if (at().t !== "eof") throw new Error(`Unexpected token after expression: '${at().v}'`);
  return tree;
}

function splitEquation(src) {
  let depth = 0;
  for (let i = 0; i < src.length; i++) {
    const c = src[i];
    if (c === "(") depth++;
    else if (c === ")") depth--;
    else if (c === "=" && depth === 0) {
      const prev = src[i - 1], next = src[i + 1];
      if (prev !== "!" && prev !== "<" && prev !== ">" && prev !== "=" && next !== "=") {
        return [src.slice(0, i), src.slice(i + 1)];
      }
    }
  }
  return [src, "0"];
}

function isZero(nd) {
  return nd?.k === "n" && Math.abs(nd.v) < 1e-12;
}

function isOne(nd) {
  return nd?.k === "n" && Math.abs(nd.v - 1) < 1e-12;
}

function simp(nd) {
  if (!nd || nd.k === "n" || nd.k === "v") return nd ?? N(0);
  if (nd.k === "f") return F(nd.n, simp(nd.a));
  if (nd.k === "u") {
    const a = simp(nd.a);
    if (a.k === "n") return N(-a.v);
    if (a.k === "u") return a.a;
    if (a.k === "b" && a.o === "+") return simp(B("+", U(a.l), U(a.r)));
    if (a.k === "b" && a.o === "-") return simp(B("-", a.r, a.l));
    return U(a);
  }

  const l = simp(nd.l), r = simp(nd.r);
  if (l.k === "n" && r.k === "n") {
    if (nd.o === "+") return N(l.v + r.v);
    if (nd.o === "-") return N(l.v - r.v);
    if (nd.o === "*") return N(l.v * r.v);
    if (nd.o === "/" && r.v !== 0) return N(l.v / r.v);
    if (nd.o === "^") return N(Math.pow(l.v, r.v));
  }

  switch (nd.o) {
    case "+":
      if (isZero(l)) return r;
      if (isZero(r)) return l;
      if (r.k === "u") return simp(B("-", l, r.a));
      return B("+", l, r);
    case "-":
      if (isZero(r)) return l;
      if (isZero(l)) return simp(U(r));
      if (r.k === "u") return simp(B("+", l, r.a));
      return B("-", l, r);
    case "*":
      if (isZero(l) || isZero(r)) return N(0);
      if (isOne(l)) return r;
      if (isOne(r)) return l;
      if (l.k === "n" && l.v === -1) return simp(U(r));
      if (r.k === "n" && r.v === -1) return simp(U(l));
      return B("*", l, r);
    case "/":
      if (isZero(l)) return N(0);
      if (isOne(r)) return l;
      return B("/", l, r);
    case "^":
      if (isZero(r)) return N(1);
      if (isOne(r)) return l;
      if (isOne(l)) return N(1);
      return B("^", l, r);
    default:
      return B(nd.o, l, r);
  }
}

function containsVar(nd, variable) {
  if (!nd) return false;
  if (nd.k === "v") return nd.n === variable;
  if (nd.k === "u") return containsVar(nd.a, variable);
  if (nd.k === "f") return containsVar(nd.a, variable);
  if (nd.k === "b") return containsVar(nd.l, variable) || containsVar(nd.r, variable);
  return false;
}

const zeroPoly = () => [N(0), N(0), N(0)];
const constantPoly = c => [simp(c), N(0), N(0)];

function addPoly(a, b) {
  return a.map((c, i) => simp(B("+", c, b[i])));
}

function subPoly(a, b) {
  return a.map((c, i) => simp(B("-", c, b[i])));
}

function mulPoly(a, b) {
  const out = zeroPoly();
  for (let i = 0; i < a.length; i++) {
    for (let j = 0; j < b.length; j++) {
      if (i + j > 2) {
        if (!isZero(a[i]) && !isZero(b[j])) return null;
        continue;
      }
      out[i + j] = simp(B("+", out[i + j], B("*", a[i], b[j])));
    }
  }
  return out;
}

function divPoly(a, den) {
  return a.map(c => simp(B("/", c, den)));
}

function powPoly(base, exp) {
  if (exp === 0) return constantPoly(N(1));
  if (exp === 1) return base;
  if (exp === 2) return mulPoly(base, base);
  return null;
}

function polynomialCoeffs(nd, variable) {
  if (!containsVar(nd, variable)) return constantPoly(nd);
  if (nd.k === "v" && nd.n === variable) return [N(0), N(1), N(0)];
  if (nd.k === "u") {
    const a = polynomialCoeffs(nd.a, variable);
    return a ? a.map(c => simp(U(c))) : null;
  }
  if (nd.k === "f") return null;
  if (nd.k !== "b") return null;

  const l = polynomialCoeffs(nd.l, variable);
  const r = polynomialCoeffs(nd.r, variable);
  if (nd.o === "+") return l && r ? addPoly(l, r) : null;
  if (nd.o === "-") return l && r ? subPoly(l, r) : null;
  if (nd.o === "*") return l && r ? mulPoly(l, r) : null;
  if (nd.o === "/") {
    if (!l || containsVar(nd.r, variable)) return null;
    return divPoly(l, nd.r);
  }
  if (nd.o === "^") {
    if (!l || nd.r.k !== "n" || !Number.isInteger(nd.r.v) || nd.r.v < 0 || nd.r.v > 2) return null;
    return powPoly(l, nd.r.v);
  }
  return null;
}

const PREC = { "+": 1, "-": 1, "*": 3, "/": 3, "^": 5 };

function print(nd, ctx = { prec: 0 }) {
  if (!nd) return "?";
  if (nd.k === "n") return Number.isInteger(nd.v) ? String(nd.v) : String(Number(nd.v.toPrecision(12)));
  if (nd.k === "v") return nd.n;
  if (nd.k === "f") return `${nd.n}(${print(nd.a)})`;
  if (nd.k === "u") {
    const s = print(nd.a, { prec: 4 });
    return nd.a.k === "b" && (nd.a.o === "+" || nd.a.o === "-") ? `-(${s})` : `-${s}`;
  }

  const prec = PREC[nd.o] ?? 0;
  let ls = print(nd.l);
  let rs = print(nd.r);
  if (nd.l.k === "b" && PREC[nd.l.o] < prec) ls = `(${ls})`;
  if (nd.r.k === "b") {
    const rp = PREC[nd.r.o];
    if (rp < prec || (rp === prec && (nd.o === "-" || nd.o === "/"))) rs = `(${rs})`;
  }

  let result;
  if (nd.o === "+") result = nd.r.k === "u" ? `${ls} - ${print(nd.r.a, { prec })}` : `${ls} + ${rs}`;
  else if (nd.o === "-") result = `${ls} - ${rs}`;
  else if (nd.o === "*") result = `${ls} * ${rs}`;
  else if (nd.o === "/") result = `${ls} / ${rs}`;
  else if (nd.o === "^") result = `${nd.l.k === "b" || nd.l.k === "u" ? `(${print(nd.l)})` : ls}^${rs}`;
  else result = `${ls} ${nd.o} ${rs}`;

  return ctx.prec > prec ? `(${result})` : result;
}

function degree(coeffs) {
  for (let i = 2; i >= 0; i--) if (!isZero(coeffs[i])) return i;
  return 0;
}

function normalizeEquation(input) {
  const [lhs, rhs] = splitEquation(input);
  return simp(B("-", parse(lhs.trim()), parse(rhs.trim())));
}

export function solveAlgebraicEquation(input, variable = "x") {
  const solveVar = variable.trim() || "x";
  const equation = input.trim();
  if (!equation) return { error: "Enter an equation or expression." };
  if (!/^[a-zA-Z_][a-zA-Z0-9_]*$/.test(solveVar)) {
    return { error: "Solve variable must be a valid identifier." };
  }

  try {
    const normalizedAst = normalizeEquation(equation);
    const coeffs = polynomialCoeffs(normalizedAst, solveVar);
    if (!coeffs) {
      return {
        error: "No closed-form polynomial isolation found for this equation.",
        variable: solveVar,
        normalized: `${print(normalizedAst)} = 0`,
        recommendation: [
          "Use the numeric root solver when all parameters have values.",
          "For symbolic systems or non-polynomial terms, reduce to FOCs first, then solve the implied linear/quadratic equation where possible.",
          "Future efficient path: add pattern rules for log/exp inverses, then a small Gaussian-elimination layer for linear symbolic systems.",
        ],
      };
    }

    const d = degree(coeffs);
    const [c, b, a] = coeffs.map(simp);
    if (d === 0) {
      return {
        variable: solveVar,
        normalized: `${print(c)} = 0`,
        degree: 0,
        method: isZero(c) ? "identity" : "constant",
        solutions: [],
        message: isZero(c)
          ? "Identity: every value of the variable satisfies the equation."
          : "No solution for the requested variable unless the constant expression equals zero.",
      };
    }

    if (d === 1) {
      const sol = simp(B("/", U(c), b));
      return {
        variable: solveVar,
        normalized: `${print(simp(B("+", B("*", b, V(solveVar)), c)))} = 0`,
        degree: 1,
        method: "linear isolation",
        coefficients: { constant: print(c), linear: print(b) },
        solutions: [{ expr: print(sol), condition: `${print(b)} != 0` }],
        recommendation: ["Closed form is O(1): collect coefficients once, then isolate the unknown."],
      };
    }

    const disc = simp(B("-", B("^", b, N(2)), B("*", B("*", N(4), a), c)));
    const denom = simp(B("*", N(2), a));
    const rootPlus = simp(B("/", B("+", U(b), F("sqrt", disc)), denom));
    const rootMinus = simp(B("/", B("-", U(b), F("sqrt", disc)), denom));

    return {
      variable: solveVar,
      normalized: `${print(simp(B("+", B("+", B("*", a, B("^", V(solveVar), N(2))), B("*", b, V(solveVar))), c)))} = 0`,
      degree: 2,
      method: "quadratic formula",
      coefficients: { quadratic: print(a), linear: print(b), constant: print(c) },
      discriminant: print(disc),
      solutions: [
        { expr: print(rootPlus), condition: `${print(a)} != 0` },
        { expr: print(rootMinus), condition: `${print(a)} != 0` },
      ],
      recommendation: [
        "Closed form is O(1) after coefficient collection.",
        "If the quadratic coefficient is zero, rerun as a linear equation.",
      ],
    };
  } catch (e) {
    return { error: e.message };
  }
}
