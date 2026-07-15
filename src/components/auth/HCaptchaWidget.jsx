// ─── HCAPTCHA WIDGET ──────────────────────────────────────────────────────────
// Thin React wrapper around the explicit-render hCaptcha widget. Required before
// login, signup, or guest entry once "Enable Captcha protection" is on in
// Supabase Auth settings — every auth call (signIn/signUp/signInAnonymously)
// needs a fresh captchaToken from this widget.
import { useEffect, useRef, forwardRef, useImperativeHandle, useState } from "react";
import { loadHCaptcha, HCAPTCHA_SITE_KEY } from "../../services/auth/hcaptcha.js";

const HCaptchaWidget = forwardRef(function HCaptchaWidget({ onVerify }, ref) {
  const containerRef = useRef(null);
  const widgetIdRef = useRef(null);
  const [error, setError] = useState(null);

  useEffect(() => {
    let alive = true;
    if (!HCAPTCHA_SITE_KEY) {
      setError("Captcha not configured (VITE_HCAPTCHA_SITE_KEY missing).");
      return;
    }
    loadHCaptcha().then(hcaptcha => {
      if (!alive || !containerRef.current) return;
      widgetIdRef.current = hcaptcha.render(containerRef.current, {
        sitekey: HCAPTCHA_SITE_KEY,
        callback: token => onVerify?.(token),
        "expired-callback": () => onVerify?.(null),
        "error-callback": () => onVerify?.(null),
      });
    }).catch(e => { if (alive) setError(e.message); });

    return () => {
      alive = false;
      if (widgetIdRef.current != null && window.hcaptcha) {
        try { window.hcaptcha.remove(widgetIdRef.current); } catch { /* ignore */ }
      }
    };
  }, []);

  useImperativeHandle(ref, () => ({
    reset() {
      if (widgetIdRef.current != null && window.hcaptcha) {
        try { window.hcaptcha.reset(widgetIdRef.current); } catch { /* ignore */ }
      }
      onVerify?.(null);
    },
  }));

  if (error) return <div style={{ fontSize: 12, color: "#c86e6e" }}>{error}</div>;
  return <div ref={containerRef} />;
});

export default HCaptchaWidget;
