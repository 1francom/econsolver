// ─── LOGIN FORM ───────────────────────────────────────────────────────────────
// Welcome page + email/password login. Shown when the user is not authenticated.
import { useState } from "react";
import { signIn, signUp } from "../../services/auth/authService.js";
import { useTheme } from "../../ThemeContext.jsx";

const mono = "'IBM Plex Mono','JetBrains Mono',Consolas,monospace";

export default function LoginForm() {
  const { C, theme, setTheme } = useTheme();
  const [mode,     setMode]     = useState("login"); // "login" | "signup"
  const [email,    setEmail]    = useState("");
  const [password, setPassword] = useState("");
  const [confirm,  setConfirm]  = useState("");
  const [loading,  setLoading]  = useState(false);
  const [error,    setError]    = useState(null);

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
    setLoading(true);
    try {
      if (mode === "login") {
        await signIn(email.trim(), password);
      } else {
        await signUp(email.trim(), password);
        // signUp with email confirmation OFF signs the user in immediately
      }
      // AuthContext will update automatically via onAuthStateChange
    } catch (err) {
      setError(err.message ?? (mode === "login" ? "Sign-in failed." : "Sign-up failed."));
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
    fontFamily: mono,
    fontSize: 12,
    outline: "none",
    boxSizing: "border-box",
    transition: "border-color 0.15s",
  };

  const labelStyle = {
    fontSize: 9,
    color: C.textMuted,
    letterSpacing: "0.22em",
    textTransform: "uppercase",
    fontFamily: mono,
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
      fontFamily: mono,
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
          fontSize: 16,
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
          fontSize: 36,
          fontWeight: 700,
          color: C.teal,
          letterSpacing: "0.12em",
          marginBottom: "0.75rem",
        }}>
          Litux
        </div>
        <div style={{
          fontSize: 11,
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
                fontFamily: mono,
                fontSize: 9,
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

          {error && (
            <div style={{
              fontSize: 10,
              color: "#e07070",
              background: "#e0707015",
              border: "1px solid #e0707040",
              borderRadius: 3,
              padding: "0.5rem 0.75rem",
            }}>
              {error}
            </div>
          )}

          <button
            type="submit"
            disabled={loading}
            style={{
              marginTop: "0.5rem",
              padding: "0.65rem",
              background: loading ? C.surface2 : C.teal,
              color: loading ? C.textMuted : C.bg,
              border: "none",
              borderRadius: 3,
              fontFamily: mono,
              fontSize: 11,
              fontWeight: 700,
              letterSpacing: "0.1em",
              cursor: loading ? "not-allowed" : "pointer",
              transition: "all 0.15s",
            }}
          >
            {loading
              ? (mode === "login" ? "Signing in…" : "Creating account…")
              : (mode === "login" ? "Log in" : "Create account")}
          </button>

        </form>
      </div>

      {/* ── Footer note ── */}
      <div style={{
        marginTop: "2rem",
        fontSize: 9,
        color: C.textMuted,
        letterSpacing: "0.1em",
        opacity: 0.5,
      }}>
        Litux · test phase
      </div>

    </div>
  );
}
