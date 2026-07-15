// ─── LOGIN FORM ───────────────────────────────────────────────────────────────
// Welcome page + email/password login. Shown when the user is not authenticated.
import { useRef, useState } from "react";
import { signIn, signUp } from "../../services/auth/authService.js";
import { useAuth } from "../../services/auth/AuthContext.jsx";
import { useTheme } from "../../ThemeContext.jsx";
import HCaptchaWidget from "./HCaptchaWidget.jsx";
import { HCAPTCHA_SITE_KEY } from "../../services/auth/hcaptcha.js";


export default function LoginForm() {
  const { C, T, theme, setTheme } = useTheme();
  const { enterGuest } = useAuth();
  const [mode,     setMode]     = useState("login"); // "login" | "signup"
  const [email,    setEmail]    = useState("");
  const [password, setPassword] = useState("");
  const [confirm,  setConfirm]  = useState("");
  const [loading,  setLoading]  = useState(false);
  const [error,    setError]    = useState(null);
  // Required once "Enable Captcha protection" is on in Supabase Auth settings —
  // login, signup, and guest entry all go through the same widget/token.
  const [captchaToken, setCaptchaToken] = useState(null);
  const captchaRef = useRef(null);
  const captchaRequired = !!HCAPTCHA_SITE_KEY;

  function switchMode(next) {
    setMode(next);
    setError(null);
    setPassword("");
    setConfirm("");
  }

  async function handleSubmit(e) {
    e.preventDefault();
    setError(null);
    if (mode === "signup" && password !== confirm) {
      setError("Passwords do not match.");
      return;
    }
    if (mode === "signup" && password.length < 6) {
      setError("Password must be at least 6 characters.");
      return;
    }
    if (captchaRequired && !captchaToken) {
      setError("Please complete the captcha.");
      return;
    }
    setLoading(true);
    try {
      if (mode === "login") {
        await signIn(email.trim(), password, captchaToken);
      } else {
        await signUp(email.trim(), password, captchaToken);
        // signUp with email confirmation OFF signs the user in immediately
      }
      // AuthContext will update automatically via onAuthStateChange
    } catch (err) {
      setError(err.message ?? (mode === "login" ? "Sign-in failed." : "Sign-up failed."));
      captchaRef.current?.reset();
    } finally {
      setLoading(false);
    }
  }

  async function handleGuest() {
    if (captchaRequired && !captchaToken) {
      setError("Please complete the captcha.");
      return;
    }
    setError(null);
    setLoading(true);
    try {
      await enterGuest(captchaToken);
    } catch (err) {
      setError(err.message ?? "Guest sign-in failed.");
      captchaRef.current?.reset();
    } finally {
      setLoading(false);
    }
  }

  const inputStyle = {
    width: "100%",
    padding: "0.6rem 0.8rem",
    background: C.surface2,
    border: `1px solid ${C.border2}`,
    borderRadius: 3,
    color: C.text,
    fontFamily: T.code.fontFamily,
    fontSize: T.code.fontSize,
    outline: "none",
    boxSizing: "border-box",
    transition: "border-color 0.15s",
  };

  const labelStyle = {
    fontSize: T.caption.fontSize,
    color: C.textMuted,
    letterSpacing: "0.22em",
    textTransform: "uppercase",
    fontFamily: T.code.fontFamily,
    marginBottom: 5,
    display: "block",
  };

  return (
    <div style={{
      minHeight: "100vh",
      background: C.bg,
      display: "flex",
      flexDirection: "column",
      alignItems: "center",
      justifyContent: "center",
      fontFamily: T.code.fontFamily,
      padding: "2rem",
      position: "relative",
    }}>

      {/* ── Theme toggle ── */}
      <button
        onClick={() => setTheme(theme === "dark" ? "light" : "dark")}
        title={theme === "dark" ? "Switch to light theme" : "Switch to dark theme"}
        style={{
          position: "absolute",
          top: "1rem",
          right: "1rem",
          background: "none",
          border: "none",
          color: C.textMuted,
          fontSize: T.body.fontSize,
          cursor: "pointer",
          padding: "0.4rem",
          lineHeight: 1,
        }}
        onMouseEnter={e => { e.currentTarget.style.color = C.gold; }}
        onMouseLeave={e => { e.currentTarget.style.color = C.textMuted; }}
      >
        {theme === "dark" ? "☀" : "☾"}
      </button>

      {/* ── Brand ── */}
      <div style={{ textAlign: "center", marginBottom: "3rem" }}>
        <div style={{
          fontSize: T.display.fontSize,
          fontWeight: 700,
          color: C.teal,
          letterSpacing: "0.12em",
          marginBottom: "0.75rem",
        }}>
          Litux
        </div>
        <div style={{
          fontSize: T.code.fontSize,
          color: C.textMuted,
          letterSpacing: "0.08em",
          lineHeight: 1.7,
          maxWidth: 340,
        }}>
          Research-grade econometrics — entirely in the browser.
          <br />
          No code required. Privacy-first. Built for empirical researchers.
        </div>
      </div>

      {/* ── Login card ── */}
      <div style={{
        width: "100%",
        maxWidth: 340,
        background: C.surface,
        border: `1px solid ${C.border}`,
        borderRadius: 6,
        padding: "2rem",
      }}>

        {/* ── Mode toggle ── */}
        <div style={{
          display: "flex",
          marginBottom: "1.5rem",
          borderRadius: 4,
          overflow: "hidden",
          border: `1px solid ${C.border2}`,
        }}>
          {["login", "signup"].map(m => (
            <button
              key={m}
              type="button"
              onClick={() => switchMode(m)}
              style={{
                flex: 1,
                padding: "0.45rem 0",
                background: mode === m ? C.teal : "transparent",
                color: mode === m ? C.bg : C.textMuted,
                border: "none",
                fontFamily: T.code.fontFamily,
                fontSize: T.caption.fontSize,
                fontWeight: 700,
                letterSpacing: "0.18em",
                textTransform: "uppercase",
                cursor: "pointer",
                transition: "all 0.15s",
              }}
            >
              {m === "login" ? "Log in" : "Sign up"}
            </button>
          ))}
        </div>

        <form onSubmit={handleSubmit} style={{ display: "flex", flexDirection: "column", gap: "1.1rem" }}>

          <div>
            <label style={labelStyle}>Email</label>
            <input
              type="email"
              value={email}
              onChange={e => setEmail(e.target.value)}
              required
              autoComplete="email"
              placeholder="you@university.edu"
              style={inputStyle}
              onFocus={e => e.target.style.borderColor = C.teal}
              onBlur={e => e.target.style.borderColor = C.border2}
            />
          </div>

          <div>
            <label style={labelStyle}>Password</label>
            <input
              type="password"
              value={password}
              onChange={e => setPassword(e.target.value)}
              required
              autoComplete={mode === "login" ? "current-password" : "new-password"}
              placeholder="••••••••"
              style={inputStyle}
              onFocus={e => e.target.style.borderColor = C.teal}
              onBlur={e => e.target.style.borderColor = C.border2}
            />
          </div>

          {mode === "signup" && (
            <div>
              <label style={labelStyle}>Confirm password</label>
              <input
                type="password"
                value={confirm}
                onChange={e => setConfirm(e.target.value)}
                required
                autoComplete="new-password"
                placeholder="••••••••"
                style={inputStyle}
                onFocus={e => e.target.style.borderColor = C.teal}
                onBlur={e => e.target.style.borderColor = C.border2}
              />
            </div>
          )}

          {captchaRequired && (
            <HCaptchaWidget ref={captchaRef} onVerify={setCaptchaToken} />
          )}

          {error && (
            <div style={{
              fontSize: T.caption.fontSize,
              color: C.red,
              background: `${C.red}15`,
              border: `1px solid ${C.red}40`,
              borderRadius: 3,
              padding: "0.5rem 0.75rem",
            }}>
              {error}
            </div>
          )}

          <button
            type="submit"
            disabled={loading || (captchaRequired && !captchaToken)}
            style={{
              marginTop: "0.5rem",
              padding: "0.65rem",
              background: loading || (captchaRequired && !captchaToken) ? C.surface2 : C.teal,
              color: loading || (captchaRequired && !captchaToken) ? C.textMuted : C.bg,
              border: "none",
              borderRadius: 3,
              fontFamily: T.code.fontFamily,
              fontSize: T.code.fontSize,
              fontWeight: 700,
              letterSpacing: "0.1em",
              cursor: loading || (captchaRequired && !captchaToken) ? "not-allowed" : "pointer",
              transition: "all 0.15s",
            }}
          >
            {loading
              ? (mode === "login" ? "Signing in…" : "Creating account…")
              : (mode === "login" ? "Log in" : "Create account")}
          </button>

        </form>
      </div>

      {/* ── Guest entry ── */}
      <div style={{
        width: "100%",
        maxWidth: 340,
        marginTop: "1rem",
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        gap: "0.5rem",
      }}>
        <div style={{
          width: "100%",
          display: "flex",
          alignItems: "center",
          gap: "0.6rem",
          color: C.textMuted,
          fontSize: T.caption.fontSize,
          letterSpacing: "0.18em",
        }}>
          <div style={{ flex: 1, height: 1, background: C.border2 }} />
          OR
          <div style={{ flex: 1, height: 1, background: C.border2 }} />
        </div>
        <button
          type="button"
          onClick={handleGuest}
          disabled={loading || (captchaRequired && !captchaToken)}
          style={{
            width: "100%",
            padding: "0.6rem",
            background: "transparent",
            color: (captchaRequired && !captchaToken) ? C.textDim : C.text,
            border: `1px solid ${C.border2}`,
            borderRadius: 3,
            fontFamily: T.code.fontFamily,
            fontSize: T.code.fontSize,
            letterSpacing: "0.04em",
            cursor: loading || (captchaRequired && !captchaToken) ? "not-allowed" : "pointer",
            transition: "all 0.15s",
          }}
          onMouseEnter={e => { if (!captchaRequired || captchaToken) { e.currentTarget.style.borderColor = C.teal; e.currentTarget.style.color = C.teal; } }}
          onMouseLeave={e => { e.currentTarget.style.borderColor = C.border2; e.currentTarget.style.color = (captchaRequired && !captchaToken) ? C.textDim : C.text; }}
        >
          Continue without an account →
        </button>
        <div style={{
          fontSize: T.caption.fontSize,
          color: C.textMuted,
          letterSpacing: "0.03em",
          lineHeight: 1.6,
          textAlign: "center",
          opacity: 0.75,
        }}>
          Your work stays in this browser. Create an account later to sync across devices.
        </div>
      </div>

      {/* ── Footer note ── */}
      <div style={{
        marginTop: "2rem",
        fontSize: T.caption.fontSize,
        color: C.textMuted,
        letterSpacing: "0.1em",
        opacity: 0.5,
      }}>
        Litux · test phase
      </div>

    </div>
  );
}
