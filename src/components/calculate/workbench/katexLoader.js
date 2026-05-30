// Lazy KaTeX CDN loader, promise-cached. Mirrors the existing CalculateTab CDN
// pattern. Render path (§10.4): katex.renderToString(latex, { trust:false }).
const KATEX_JS  = "https://cdn.jsdelivr.net/npm/katex@0.16.11/dist/katex.min.js";
const KATEX_CSS = "https://cdn.jsdelivr.net/npm/katex@0.16.11/dist/katex.min.css";

let loadPromise = null;

export function loadKatex() {
  if (typeof window !== "undefined" && window.katex) return Promise.resolve(window.katex);
  if (loadPromise) return loadPromise;
  loadPromise = new Promise((resolve, reject) => {
    if (!document.querySelector(`link[href="${KATEX_CSS}"]`)) {
      const link = document.createElement("link");
      link.rel = "stylesheet"; link.href = KATEX_CSS;
      document.head.appendChild(link);
    }
    const s = document.createElement("script");
    s.src = KATEX_JS; s.async = true;
    s.onload = () => {
      if (window.katex) { resolve(window.katex); }
      else { loadPromise = null; reject(new Error("katex global missing")); }
    };
    s.onerror = () => { loadPromise = null; reject(new Error("failed to load KaTeX from CDN")); };
    document.head.appendChild(s);
  });
  return loadPromise;
}

// Safe render to an HTML string. SECURITY (§10.4): trust:false — no \href/\url.
// Returns null on failure so callers can fall back to plain-text display.
export function renderLatex(katex, latex) {
  try {
    return katex.renderToString(latex, { displayMode: true, throwOnError: true, trust: false });
  } catch {
    return null;
  }
}
