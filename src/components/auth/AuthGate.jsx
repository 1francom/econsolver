// ─── AUTH GATE ────────────────────────────────────────────────────────────────
// Wraps the entire app. Shows LoginForm until a valid Supabase session exists.
import { useAuth } from "../../services/auth/AuthContext.jsx";
import LoginForm from "./LoginForm.jsx";
import { useTheme } from "../../ThemeContext.jsx";


function LoadingScreen() {
  const { C, T } = useTheme();
  return (
    <div style={{
      minHeight: "100vh",
      background: C.bg,
      display: "flex",
      alignItems: "center",
      justifyContent: "center",
      fontFamily: T.code.fontFamily,
    }}>
      <div style={{ textAlign: "center" }}>
        <div style={{
          width: 20,
          height: 20,
          border: `2px solid ${C.border2}`,
          borderTopColor: C.teal,
          borderRadius: "50%",
          animation: "spin 0.7s linear infinite",
          margin: "0 auto 1rem",
        }} />
        <div style={{ fontSize: T.caption.fontSize, color: C.textMuted, letterSpacing: "0.22em", textTransform: "uppercase" }}>
          Loading
        </div>
      </div>
    </div>
  );
}

export default function AuthGate({ children }) {
  const { user, loading, guest } = useAuth();

  if (loading)         return <LoadingScreen />;
  if (!user && !guest) return <LoginForm />;
  return children;
}
