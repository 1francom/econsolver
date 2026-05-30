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
};
