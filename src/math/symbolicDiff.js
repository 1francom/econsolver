// ─── ECON STUDIO · src/math/symbolicDiff.js ───────────────────────────────────
// Symbolic differentiation engine for the Calculate tab.
// Pure JS — no external dependencies. No React.
//
// API:
//   symbolicDiff(exprStr, variable) → { expr: string } | { error: string }
//
// Supported:
//   Arithmetic:   + - * / ^ (also ** alias for ^)
//   Unary:        -
//   Known fns:    sin cos tan exp ln log sqrt abs
//   Unknown fns:  any other call f(u) → derivative written as f'(u)·u'
//
// Examples:
//   symbolicDiff("2*x^2 - c(x)", "x")    → "4*x - c'(x)"
//   symbolicDiff("p(q)*q - c(q)", "q")   → "p'(q)*q + p(q) - c'(q)"
//   symbolicDiff("ln(1+x)", "x")         → "1 / (1 + x)"

// ─── AST CONSTRUCTORS ─────────────────────────────────────────────────────────
const N  = v       => ({ k: 'n', v });               // numeric literal
const V  = n       => ({ k: 'v', n });               // variable name
const U  = a       => ({ k: 'u', a });               // unary minus
const B  = (o,l,r) => ({ k: 'b', o, l, r });        // binary op: + - * / ^
const F  = (n,a)   => ({ k: 'f', n, a });            // function call f(a)

// ─── TOKENIZER ────────────────────────────────────────────────────────────────
function lex(src) {
  const toks = [];
  let i = 0;
  while (i < src.length) {
    const c = src[i];
    if (/\s/.test(c)) { i++; continue; }
    // numeric literal (including decimals and scientific notation)
    if (/[\d.]/.test(c)) {
      const j = i;
      while (i < src.length && /[\d.]/.test(src[i])) i++;
      if (/[eE]/.test(src[i] ?? '')) {
        i++;
        if (/[+\-]/.test(src[i] ?? '')) i++;
        while (/\d/.test(src[i] ?? '')) i++;
      }
      toks.push({ t: 'n', v: parseFloat(src.slice(j, i)) }); continue;
    }
    // identifier
    if (/[a-zA-Z_]/.test(c)) {
      const j = i;
      while (/[a-zA-Z0-9_]/.test(src[i] ?? '')) i++;
      toks.push({ t: 'id', v: src.slice(j, i) }); continue;
    }
    // ** → ^
    if (c === '*' && src[i + 1] === '*') { toks.push({ t: 'op', v: '^' }); i += 2; continue; }
    // single-char ops + parens + comma
    if ('+−-*/^(),'.includes(c)) { toks.push({ t: 'op', v: c === '−' ? '-' : c }); i++; continue; }
    throw new Error(`Unexpected character: '${c}'`);
  }
  toks.push({ t: 'eof' });
  return toks;
}

// ─── PARSER (recursive descent) ───────────────────────────────────────────────
function parse(src) {
  const tok = lex(src);
  let p = 0;
  const at  = ()  => tok[p];
  const adv = ()  => tok[p++];
  const eat = v   => {
    if (at().v !== v) throw new Error(`Expected '${v}', got '${at().v ?? 'EOF'}'`);
    adv();
  };

  function expr()   { return addSub(); }
  function addSub() {
    let n = mulDiv();
    while (at().v === '+' || at().v === '-') { const o = adv().v; n = B(o, n, mulDiv()); }
    return n;
  }
  function mulDiv() {
    let n = pow();
    while (at().v === '*' || at().v === '/') { const o = adv().v; n = B(o, n, pow()); }
    return n;
  }
  function pow() {
    const base = unary();
    if (at().v === '^') { adv(); return B('^', base, unary()); } // left-assoc
    return base;
  }
  function unary() {
    if (at().v === '-') { adv(); return U(unary()); }
    if (at().v === '+') { adv(); return unary(); }
    return atom();
  }
  function atom() {
    const t = at();
    if (t.t === 'n')  { adv(); return N(t.v); }
    if (t.t === 'id') {
      const name = adv().v;
      if (at().v === '(') {
        adv(); // eat '('
        const arg = expr();
        eat(')');
        return F(name, arg);
      }
      return V(name);
    }
    if (t.v === '(') { adv(); const n = expr(); eat(')'); return n; }
    throw new Error(`Unexpected token: '${t.v ?? t.t}'`);
  }

  const tree = expr();
  if (at().t !== 'eof') throw new Error(`Unexpected token after expression: '${at().v}'`);
  return tree;
}

// ─── SIMPLIFIER ───────────────────────────────────────────────────────────────
// One pass of basic algebraic identities + constant folding.
function simp(nd) {
  if (!nd || nd.k === 'n' || nd.k === 'v') return nd ?? N(0);
  if (nd.k === 'f') return F(nd.n, simp(nd.a));
  if (nd.k === 'u') {
    const a = simp(nd.a);
    if (a.k === 'n') return N(-a.v);
    if (a.k === 'u') return a.a;              // --x = x
    return U(a);
  }
  const l = simp(nd.l), r = simp(nd.r);
  // constant folding
  if (l.k === 'n' && r.k === 'n') {
    if (nd.o === '+') return N(l.v + r.v);
    if (nd.o === '-') return N(l.v - r.v);
    if (nd.o === '*') return N(l.v * r.v);
    if (nd.o === '/' && r.v !== 0) return N(l.v / r.v);
    if (nd.o === '^') return N(Math.pow(l.v, r.v));
  }
  switch (nd.o) {
    case '+':
      if (l.k === 'n' && l.v === 0) return r;
      if (r.k === 'n' && r.v === 0) return l;
      if (r.k === 'u') return simp(B('-', l, r.a)); // a+(−b) = a−b
      return B('+', l, r);
    case '-':
      if (r.k === 'n' && r.v === 0) return l;
      if (l.k === 'n' && l.v === 0) return simp(U(r));
      if (r.k === 'u') return simp(B('+', l, r.a)); // a−(−b) = a+b
      return B('-', l, r);
    case '*':
      if ((l.k === 'n' && l.v === 0) || (r.k === 'n' && r.v === 0)) return N(0);
      if (l.k === 'n' && l.v === 1)  return r;
      if (r.k === 'n' && r.v === 1)  return l;
      if (l.k === 'n' && l.v === -1) return simp(U(r));
      if (r.k === 'n' && r.v === -1) return simp(U(l));
      return B('*', l, r);
    case '/':
      if (l.k === 'n' && l.v === 0) return N(0);
      if (r.k === 'n' && r.v === 1) return l;
      return B('/', l, r);
    case '^':
      if (r.k === 'n' && r.v === 0) return N(1);
      if (r.k === 'n' && r.v === 1) return l;
      if (l.k === 'n' && l.v === 1) return N(1);
      return B('^', l, r);
  }
  return B(nd.o, l, r);
}

// ─── DIFFERENTIATOR ───────────────────────────────────────────────────────────
function diff(nd, v) {
  const D = n => simp(diff(n, v));

  if (nd.k === 'n')  return N(0);
  if (nd.k === 'v')  return nd.n === v ? N(1) : N(0);
  if (nd.k === 'u')  return simp(U(D(nd.a)));

  if (nd.k === 'b') {
    const { o, l, r } = nd;
    if (o === '+') return simp(B('+', D(l), D(r)));
    if (o === '-') return simp(B('-', D(l), D(r)));
    if (o === '*') // product rule: (l·r)' = l'·r + l·r'
      return simp(B('+', B('*', D(l), r), B('*', l, D(r))));
    if (o === '/') // quotient rule: (l/r)' = (l'r − l·r') / r²
      return simp(B('/', B('-', B('*', D(l), r), B('*', l, D(r))), B('^', r, N(2))));
    if (o === '^') {
      const lp = D(l);
      if (r.k === 'n') {
        // power rule: n·l^(n−1)·l'
        const n = r.v;
        const base = n === 2 ? l : n === 1 ? N(1) : B('^', l, N(n - 1));
        if (n === 0) return N(0);
        if (n === 1) return lp;
        return simp(B('*', B('*', N(n), base), lp));
      }
      // general: l^r · (r'·ln(l) + r·l'/l)
      const rp = D(r);
      return simp(B('*', nd,
        B('+', B('*', rp, F('ln', l)), B('*', r, B('/', lp, l)))
      ));
    }
  }

  if (nd.k === 'f') {
    const { n, a } = nd;
    const ap = D(a);
    // chain rule helper: inner · a'
    const chain = inner => (ap.k === 'n' && ap.v === 1) ? inner : simp(B('*', inner, ap));
    switch (n) {
      case 'sin':   return chain(F('cos', a));
      case 'cos':   return chain(simp(U(F('sin', a))));
      case 'tan':   return chain(B('/', N(1), B('^', F('cos', a), N(2))));
      case 'exp':   return chain(F('exp', a));
      case 'ln':
      case 'log':   return chain(B('/', N(1), a));
      case 'log10': return chain(B('/', N(1), B('*', a, F('ln', N(10)))));
      case 'sqrt':  return chain(B('/', N(1), B('*', N(2), F('sqrt', a))));
      case 'abs':   return chain(B('/', a, F('abs', a)));
      default:      return chain(F(n + "'", a)); // unknown: f'(a)·a'
    }
  }

  return N(0);
}

// ─── PRETTY PRINTER ───────────────────────────────────────────────────────────
const PREC = { '+': 1, '-': 1, '*': 3, '/': 3, '^': 5 };

function print(nd, ctx = { prec: 0, side: 'l' }) {
  if (!nd) return '?';
  if (nd.k === 'n') return String(nd.v);
  if (nd.k === 'v') return nd.n;
  if (nd.k === 'f') return `${nd.n}(${print(nd.a, { prec: 0, side: 'l' })})`;
  if (nd.k === 'u') {
    const s = print(nd.a, { prec: 4, side: 'l' });
    return (nd.a.k === 'b' && (nd.a.o === '+' || nd.a.o === '-')) ? `-(${s})` : `-${s}`;
  }

  const prec = PREC[nd.o] ?? 0;
  let ls = print(nd.l, { prec, side: 'l' });
  let rs = print(nd.r, { prec, side: 'r' });

  // Wrap left child if it has lower precedence
  if (nd.l.k === 'b' && PREC[nd.l.o] < prec) ls = `(${ls})`;
  // Wrap right child: lower prec, OR same prec on right of non-commutative op
  if (nd.r.k === 'b') {
    const rp = PREC[nd.r.o];
    if (rp < prec || (rp === prec && (nd.o === '-' || nd.o === '/'))) rs = `(${rs})`;
  }

  let result;
  switch (nd.o) {
    case '+':
      // a + (-b) → show as a - b
      if (nd.r.k === 'u') {
        const inner = print(nd.r.a, { prec, side: 'r' });
        result = `${ls} - ${inner}`;
      } else {
        result = `${ls} + ${rs}`;
      }
      break;
    case '-':
      // a - (b ± c) needs parens on right
      if (nd.r.k === 'b' && (nd.r.o === '+' || nd.r.o === '-')) rs = `(${rs})`;
      result = `${ls} - ${rs}`;
      break;
    case '*': result = `${ls} * ${rs}`; break;
    case '/': result = `${ls} / ${rs}`; break;
    case '^':
      // base needs parens if composite
      if (nd.l.k === 'b' || nd.l.k === 'u') ls = `(${print(nd.l, { prec: 0, side: 'l' })})`;
      result = `${ls}^${rs}`;
      break;
    default: result = `${ls} ${nd.o} ${rs}`;
  }

  return ctx.prec > prec ? `(${result})` : result;
}

// ─── LATEX NAME CONVERTER ─────────────────────────────────────────────────────
const GREEK_NAMES = {
  alpha:'\\alpha', beta:'\\beta', gamma:'\\gamma', delta:'\\delta',
  epsilon:'\\epsilon', zeta:'\\zeta', eta:'\\eta', theta:'\\theta',
  iota:'\\iota', kappa:'\\kappa', lambda:'\\lambda', mu:'\\mu',
  nu:'\\nu', xi:'\\xi', pi:'\\pi', rho:'\\rho', sigma:'\\sigma',
  tau:'\\tau', upsilon:'\\upsilon', phi:'\\phi', chi:'\\chi',
  psi:'\\psi', omega:'\\omega',
  Gamma:'\\Gamma', Delta:'\\Delta', Lambda:'\\Lambda', Sigma:'\\Sigma',
  Pi:'\\Pi', Phi:'\\Phi', Psi:'\\Psi', Omega:'\\Omega',
};

export function latexName(name) {
  const sub = name.match(/^([a-zA-Z]+)_(\w+)$/);
  if (sub) {
    const base = GREEK_NAMES[sub[1]] ?? sub[1];
    return `${base}_{${sub[2]}}`;
  }
  return GREEK_NAMES[name] ?? name;
}

// ─── LATEX PRINTER ────────────────────────────────────────────────────────────
function printLatex(nd) {
  if (!nd) return '?';
  if (nd.k === 'n') return String(nd.v);
  if (nd.k === 'v') return latexName(nd.n);
  if (nd.k === 'u') {
    const s = printLatex(nd.a);
    return (nd.a.k === 'b' && (nd.a.o === '+' || nd.a.o === '-')) ? `-(${s})` : `-${s}`;
  }
  if (nd.k === 'f') {
    const arg = printLatex(nd.a);
    switch (nd.n) {
      case 'sqrt': return `\\sqrt{${arg}}`;
      case 'ln':   return `\\ln\\left(${arg}\\right)`;
      case 'log':  return `\\log\\left(${arg}\\right)`;
      case 'exp':  return `e^{${arg}}`;
      case 'sin':  return `\\sin\\left(${arg}\\right)`;
      case 'cos':  return `\\cos\\left(${arg}\\right)`;
      case 'tan':  return `\\tan\\left(${arg}\\right)`;
      case 'abs':  return `\\left|${arg}\\right|`;
      default:     return `${latexName(nd.n)}\\left(${arg}\\right)`;
    }
  }
  if (nd.k === 'b') {
    const { o, l, r } = nd;
    if (o === '/') return `\\frac{${printLatex(l)}}{${printLatex(r)}}`;
    if (o === '^') {
      const base = (l.k === 'b' || l.k === 'u') ? `\\left(${printLatex(l)}\\right)` : printLatex(l);
      return `${base}^{${printLatex(r)}}`;
    }
    if (o === '*') {
      const ls = printLatex(l);
      const rs = printLatex(r);
      const wl = (l.k === 'b' && (l.o === '+' || l.o === '-')) ? `\\left(${ls}\\right)` : ls;
      const wr = (r.k === 'b' && (r.o === '+' || r.o === '-')) ? `\\left(${rs}\\right)` : rs;
      const needDot = l.k === 'n';
      return needDot ? `${wl} \\cdot ${wr}` : `${wl} ${wr}`;
    }
    if (o === '+') {
      const ls = printLatex(l);
      if (r.k === 'u') return `${ls} - ${printLatex(r.a)}`;
      return `${ls} + ${printLatex(r)}`;
    }
    if (o === '-') {
      const ls = printLatex(l);
      const rs = (r.k === 'b' && (r.o === '+' || r.o === '-')) ? `\\left(${printLatex(r)}\\right)` : printLatex(r);
      return `${ls} - ${rs}`;
    }
  }
  return '?';
}

// ─── DETECT SYMBOLIC FUNCTIONS IN EXPRESSION ─────────────────────────────────
// Returns list of non-builtin function names found in the parsed AST.
const BUILTINS = new Set(['sin','cos','tan','exp','ln','log','log10','sqrt','abs']);

function findSymbolicFns(nd, found = new Set()) {
  if (!nd) return found;
  if (nd.k === 'f') { if (!BUILTINS.has(nd.n)) found.add(nd.n); findSymbolicFns(nd.a, found); }
  else if (nd.k === 'b') { findSymbolicFns(nd.l, found); findSymbolicFns(nd.r, found); }
  else if (nd.k === 'u') findSymbolicFns(nd.a, found);
  return found;
}

// ─── PUBLIC API ───────────────────────────────────────────────────────────────
export function symbolicDiff(exprStr, varName = 'x') {
  try {
    const ast   = parse(exprStr.trim());
    const dAst  = simp(diff(ast, varName.trim()));
    const symbolicFns = [...findSymbolicFns(ast)];
    return {
      expr: print(dAst, { prec: 0, side: 'l' }),
      latex: printLatex(dAst),
      symbolicFns,  // list of function names treated as unknown
    };
  } catch (e) {
    return { error: e.message };
  }
}
