// ─── AUTH CONTEXT ─────────────────────────────────────────────────────────────
// Provides { user, session, loading } to the entire app.
// Initialises from the persisted Supabase session on mount.
import { createContext, useContext, useEffect, useState } from "react";
import { getSession, onAuthStateChange, getTier } from "./authService.js";
import { setCurrentUser } from "../Persistence/indexedDB.js";

const AuthContext = createContext(null);

export function AuthProvider({ children }) {
  const [session, setSession] = useState(undefined); // undefined = still loading
  const [user,    setUser]    = useState(null);
  const [tier,    setTier]    = useState("free");

  async function applySession(s) {
    setSession(s);
    const u = s?.user ?? null;
    setUser(u);
    setCurrentUser(u?.id ?? null);
    setTier(u ? await getTier(u.id) : "free");
  }

  useEffect(() => {
    getSession().then(applySession).catch(() => {
      setSession(null);
      setUser(null);
      setCurrentUser(null);
      setTier("free");
    });

    const unsub = onAuthStateChange(applySession);
    return unsub;
  }, []);

  const loading = session === undefined;

  return (
    <AuthContext.Provider value={{ user, session, loading, tier }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used inside <AuthProvider>");
  return ctx;
}
