// ─── LOGIN FORM ───────────────────────────────────────────────────────────────
// Welcome page + email/password login. Shown when the user is not authenticated.
import { useState } from "react";
import { signIn } from "../../services/auth/authService.js";
import { useTheme } from "../../ThemeContext.jsx";

const mono = "'IBM Plex Mono','JetBrains Mono',Consolas,monospace";

export default function LoginForm() {
  const { C } = useTheme();
  const [email,    setEmail]    = useState("");
  const [password, setPassword] = useState("");
  const [loading,  setLoading]  = useState(false);
  const [error,    setError]    = useState(null);

  async function handleSubmit(e) {
    e.preventDefault();
    setError(null);
    setLoading(true);
    try {
      await signIn(email.trim(), password);
      // AuthContext will update automatically via onAuthStateChange
    } catch (err) {
      setError(err.message ?? "Sign-in failed.");
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
    }}>

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

        <div style={{
          fontSize: 9,
          color: C.textMuted,
          letterSpacing: "0.26em",
          textTransform: "uppercase",
          marginBottom: "1.5rem",
          textAlign: "center",
        }}>
          Sign in to continue
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
              autoComplete="current-password"
              placeholder="••••••••"
              style={inputStyle}
              onFocus={e => e.target.style.borderColor = C.teal}
              onBlur={e => e.target.style.borderColor = C.border2}
            />
          </div>

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
            {loading ? "Signing in…" : "Sign in"}
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
        Access is by invitation only · test phase
      </div>

    </div>
  );
}
