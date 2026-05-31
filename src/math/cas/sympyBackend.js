// Backend B — maps the casAdapter surface (§5.1) onto SymPy via Pyodide (WASM).
// Escalation backend: slots in behind the SAME casAdapter facade as nerdamer.
// Pyodide loads from CDN as a global; we never bundle it.
//
// SECURITY (§10.3): Python runs ONLY through a fixed bootstrap of helper
// functions defined here (no user input). User expressions reach Python only as
// string ARGUMENTS to those helpers, parsed via sympy `parse_expr` over a fixed
// transformation set — never `exec`/`eval` of arbitrary Python, never string
// interpolation of user input into executed code. Parse failures return null
// (→ closed:false), never a surfaced stack trace.
import { evalExpression } from "../calcEngine.js";

const PYODIDE_VERSION = "0.26.4";
const PYODIDE_BASE = `https://cdn.jsdelivr.net/pyodide/v${PYODIDE_VERSION}/full/`;

// Fixed Python bootstrap — NO user input is ever interpolated into this string.
const BOOTSTRAP = `
import json
from sympy import Symbol, diff as _diff, simplify as _simplify, solve as _solve, latex as _latex, integrate as _integrate
from sympy.parsing.sympy_parser import (parse_expr, standard_transformations,
                                        implicit_multiplication_application, convert_xor)

_TX = standard_transformations + (implicit_multiplication_application, convert_xor)

def _p(src):
    # Parse a user string into a SymPy expression over a fixed transformation set.
    return parse_expr(str(src), transformations=_TX, evaluate=True)

def cas_parse(src):
    try: return str(_p(src))
    except Exception: return None

def cas_free_symbols(src):
    try: return json.dumps(sorted(str(s) for s in _p(src).free_symbols))
    except Exception: return json.dumps([])

def cas_latex(src):
    try: return _latex(_p(src))
    except Exception: return None

def cas_diff(src, var):
    try: return str(_diff(_p(src), Symbol(str(var))))
    except Exception: return None

def cas_simplify(src):
    try: return str(_simplify(_p(src)))
    except Exception: return None

def cas_integrate(src, var):
    try: return str(_integrate(_p(src), Symbol(str(var))))
    except Exception: return None

def cas_eval_at(src, names_json, vals_json):
    try:
        names = json.loads(names_json); vals = json.loads(vals_json)
        subs = {Symbol(n): v for n, v in zip(names, vals)}
        return float(_p(src).subs(subs).evalf())
    except Exception: return None

def cas_substitute(src, names_json, vals_json):
    try:
        names = json.loads(names_json); vals = json.loads(vals_json)
        subs = {Symbol(n): _p(v) for n, v in zip(names, vals)}
        return str(_p(src).subs(subs))
    except Exception: return None

def cas_solve(src, var):
    try:
        sols = _solve(_p(src), Symbol(str(var)), dict=False)
        return json.dumps([str(s) for s in sols])
    except Exception: return None

def cas_solve_system(srcs_json, vars_json):
    try:
        srcs = json.loads(srcs_json); vars = json.loads(vars_json)
        eqs = [_p(s) for s in srcs]
        syms = [Symbol(str(v)) for v in vars]
        res = _solve(eqs, syms, dict=True)
        out = [{str(k): str(v) for k, v in d.items()} for d in res]
        return json.dumps(out)
    except Exception: return None
`;

let loadPromise = null;

function loadPyodideScript() {
  if (typeof window !== "undefined" && window.loadPyodide) return Promise.resolve(window.loadPyodide);
  if (loadPromise) return loadPromise;
  loadPromise = new Promise((resolve, reject) => {
    const s = document.createElement("script");
    s.src = `${PYODIDE_BASE}pyodide.js`;
    s.async = true;
    s.onload = () => (window.loadPyodide ? resolve(window.loadPyodide) : reject(new Error("loadPyodide global missing after load")));
    s.onerror = () => reject(new Error("failed to load Pyodide from CDN"));
    document.head.appendChild(s);
  });
  return loadPromise;
}

let py = null;          // cached pyodide instance once ready
let fns = null;         // cached helper-function proxies
let readyPromise = null;

async function boot() {
  const loadPyodide = await loadPyodideScript();
  const pyodide = await loadPyodide({ indexURL: PYODIDE_BASE });
  await pyodide.loadPackage("sympy");
  pyodide.runPython(BOOTSTRAP); // fixed bootstrap — no user input
  py = pyodide;
  fns = {
    parse: pyodide.globals.get("cas_parse"),
    freeSymbols: pyodide.globals.get("cas_free_symbols"),
    latex: pyodide.globals.get("cas_latex"),
    diff: pyodide.globals.get("cas_diff"),
    simplify: pyodide.globals.get("cas_simplify"),
    integrate: pyodide.globals.get("cas_integrate"),
    evalAt: pyodide.globals.get("cas_eval_at"),
    substitute: pyodide.globals.get("cas_substitute"),
    solve: pyodide.globals.get("cas_solve"),
    solveSystem: pyodide.globals.get("cas_solve_system"),
  };
}

// Normalize a CasExpr string into a JS-evaluable expression for the
// restricted-scope numeric compiler (§10.2). compile() is fed two flavours of
// string: SymPy-canonical forms (powers as `**`, e.g. from diff/integrate) AND
// raw user exprs that still use the `^` power convention (e.g. eq.expr straight
// from runPlot). JS reads a bare `^` as bitwise XOR, which silently turns a curve
// like K^alpha into an integer staircase — so caret powers MUST be folded to `**`
// first. `Abs(` also folds to the Math-provided `abs(`; lowercase math fns
// (log/exp/sqrt/sin…) already resolve to Math names.
function sympyToJs(expr) {
  return String(expr)
    .replace(/\^/g, "**")
    .replace(/\bAbs\(/g, "abs(");
}

export const sympyBackend = {
  name: "sympy",

  ready() {
    if (!readyPromise) readyPromise = boot();
    return readyPromise;
  },

  // A CasExpr for this backend is the SymPy canonical string form (interchangeable
  // with nerdamer's string CasExpr behind the adapter).
  parse(src) {
    const r = fns.parse(String(src));
    if (r == null) throw new Error("sympy parse failed");
    return r;
  },

  freeSymbols(expr) {
    const r = fns.freeSymbols(String(expr));
    try { return JSON.parse(r); } catch { return []; }
  },

  toLatex(expr) {
    const r = fns.latex(String(expr));
    if (r == null) throw new Error("sympy latex failed");
    return r;
  },

  // Numeric evaluation by substitution → evalf. Mirrors nerdamer's evalAt(expr, scope).
  evalAt(expr, scope) {
    const names = Object.keys(scope);
    const vals = names.map((k) => Number(scope[k]));
    const r = fns.evalAt(String(expr), JSON.stringify(names), JSON.stringify(vals));
    if (r == null) throw new Error("sympy evalAt failed");
    return Number(r);
  },

  diff(expr, varName) {
    const r = fns.diff(String(expr), String(varName));
    if (r == null) throw new Error("sympy diff failed");
    return r;
  },

  simplify(expr) {
    const r = fns.simplify(String(expr));
    return r == null ? String(expr) : r;
  },

  // Roots of expr = 0 for varName. Returns CasSolution {closed, solutions}.
  solve(expr, varName) {
    const r = fns.solve(String(expr), String(varName));
    if (r == null) return { closed: false, solutions: [] };
    let arr;
    try { arr = JSON.parse(r); } catch { return { closed: false, solutions: [] }; }
    return { closed: arr.length > 0, solutions: arr.map((s) => ({ [varName]: s })) };
  },

  // Symbolic system solve. eqs are expressions implicitly = 0; vars is the list to solve for.
  solveSystem(eqs, vars) {
    const r = fns.solveSystem(JSON.stringify(eqs.map(String)), JSON.stringify(vars));
    if (r == null) return { closed: false, solutions: [] };
    let res;
    try { res = JSON.parse(r); } catch { return { closed: false, solutions: [] }; }
    if (!Array.isArray(res) || !res.length) return { closed: false, solutions: [] };
    const sols = res.filter((sol) => vars.every((v) => v in sol));
    return { closed: sols.length > 0, solutions: sols };
  },

  substitute(expr, scope) {
    const names = Object.keys(scope);
    const vals = names.map((k) => scope[k]);
    const r = fns.substitute(String(expr), JSON.stringify(names), JSON.stringify(vals));
    return r == null ? String(expr) : r;
  },

  // Compile to a numeric function over freeVars. SECURITY (§10.2): the SymPy
  // canonical string is evaluated through calcEngine.evalExpression — the SAME
  // restricted-scope `Function` path used by the numeric engine (whitelisted Math
  // identifiers + declared free vars only; no window/globals/fetch/import).
  compile(expr, freeVars) {
    const js = sympyToJs(expr);
    return (scope) => {
      const picked = {};
      for (const v of freeVars) picked[v] = scope[v];
      const r = evalExpression(js, picked);
      return r.error != null ? NaN : r.value;
    };
  },
};
