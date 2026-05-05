// ─── AUTH CONTEXT ─────────────────────────────────────────────────────────────
// Provides { user, session, loading } to the entire app.
// Initialises from the persisted Supabase session on mount.
import { createContext, useContext, useEffect, useState } from "react";
import { getSession, onAuthStateChange } from "./authService.js";

const AuthContext = createContext(null);

export function AuthProvider({ children }) {
  const [session, setSession] = useState(undefined); // undefined = still loading
  const [user,    setUser]    = useState(null);

  useEffect(() => {
    // Restore persisted session on first load
    getSession().then(s => {
      setSession(s);
      setUser(s?.user ?? null);
    });

    // Keep in sync with Supabase auth state changes (login, logout, token refresh)
    const unsub = onAuthStateChange(s => {
      setSession(s);
      setUser(s?.user ?? null);
    });

    return unsub;
  }, []);

  const loading = session === undefined;

  return (
    <AuthContext.Provider value={{ user, session, loading }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used inside <AuthProvider>");
  return ctx;
}
