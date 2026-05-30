// Backend A — maps the casAdapter surface (§5.1) onto nerdamer.
// nerdamer loads from CDN as a global; we never bundle it.
const NERDAMER_URL = "https://cdn.jsdelivr.net/npm/nerdamer@1.1.13/all.min.js";

let loadPromise = null;

function loadNerdamer() {
  if (typeof window !== "undefined" && window.nerdamer) return Promise.resolve(window.nerdamer);
  if (loadPromise) return loadPromise;
  loadPromise = new Promise((resolve, reject) => {
    const s = document.createElement("script");
    s.src = NERDAMER_URL;
    s.async = true;
    s.onload = () => (window.nerdamer ? resolve(window.nerdamer) : reject(new Error("nerdamer global missing after load")));
    s.onerror = () => reject(new Error("failed to load nerdamer from CDN"));
    document.head.appendChild(s);
  });
  return loadPromise;
}

let N = null; // cached nerdamer global once ready

export const nerdamerBackend = {
  name: "nerdamer",
  async ready() { N = await loadNerdamer(); },

  // A CasExpr for this backend is just the nerdamer expression's string form.
  parse(src) { return N(src).toString(); },

  freeSymbols(expr) {
    // nerdamer(expr).variables() -> array of variable names
    return N(expr).variables().slice().sort();
  },

  toLatex(expr) { return N(expr).toTeX(); },

  // Numeric evaluation by substitution — through nerdamer's parser, never raw eval (§10).
  evalAt(expr, scope) {
    const subs = {};
    for (const [k, v] of Object.entries(scope)) subs[k] = String(v);
    return Number(N(expr, subs).evaluate().text());
  },

  diff(expr, varName) { return N.diff(expr, varName).toString(); },
  simplify(expr) { return N(expr).expand().toString(); },

  // Roots of expr = 0 for varName. Returns CasSolution {closed, solutions}.
  solve(expr, varName) {
    try {
      const sols = N.solve(expr, varName); // nerdamer vector, e.g. [2,-2]
      const arr = sols.toString().replace(/^\[|\]$/g, "").split(",").map((s) => s.trim()).filter(Boolean);
      return { closed: arr.length > 0, solutions: arr.map((s) => ({ [varName]: s })) };
    } catch {
      return { closed: false, solutions: [] };
    }
  },

  // Symbolic system solve. eqs are expressions implicitly = 0; vars is the list to solve for.
  solveSystem(eqs, vars) {
    try {
      const equations = eqs.map((e) => `${e}=0`);
      const res = N.solveEquations(equations, vars); // may throw or return [] on hard nonlinear
      if (!res || !res.length) return { closed: false, solutions: [] };
      const sol = {};
      for (const pair of res) sol[pair[0]] = pair[1].toString(); // [var, value] pairs
      const closed = vars.every((v) => v in sol);
      return { closed, solutions: closed ? [sol] : [] };
    } catch {
      return { closed: false, solutions: [] };
    }
  },

  substitute(expr, scope) {
    let e = N(expr);
    for (const [k, v] of Object.entries(scope)) e = e.sub(k, String(v));
    return e.toString();
  },

  // Compile to a numeric function over freeVars. SECURITY (§10): nerdamer's
  // buildFunction produces a pure numeric fn from its own AST — it sees only the
  // declared freeVars, never window/globals/fetch. No app-side dynamic compile.
  compile(expr, freeVars) {
    const fn = N(expr).buildFunction(freeVars);
    return (scope) => fn(...freeVars.map((v) => scope[v]));
  },
};
