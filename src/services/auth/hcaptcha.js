// ─── hCaptcha CDN loader ──────────────────────────────────────────────────────
// Loads the hCaptcha script once (singleton, same pattern as the spatial module's
// Leaflet/proj4 loaders) and exposes it as window.hcaptcha. Explicit render mode
// so React controls exactly when/where the widget mounts.

export const HCAPTCHA_SITE_KEY = import.meta.env.VITE_HCAPTCHA_SITE_KEY ?? "";

let _hcaptchaPromise = null;
export function loadHCaptcha() {
  if (typeof window !== "undefined" && window.hcaptcha) return Promise.resolve(window.hcaptcha);
  if (_hcaptchaPromise) return _hcaptchaPromise;
  _hcaptchaPromise = new Promise((resolve, reject) => {
    const script = document.createElement("script");
    script.src = "https://js.hcaptcha.com/1/api.js?render=explicit";
    script.async = true;
    script.defer = true;
    script.onload = () => { _hcaptchaPromise = null; resolve(window.hcaptcha); };
    script.onerror = () => { _hcaptchaPromise = null; reject(new Error("hCaptcha script failed to load")); };
    document.head.appendChild(script);
  });
  return _hcaptchaPromise;
}
