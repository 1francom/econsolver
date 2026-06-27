// ─── AUTH CONTEXT ─────────────────────────────────────────────────────────────
// Provides { user, session, loading } to the entire app.
// Initialises from the persisted Supabase session on mount.
import { createContext, useContext, useEffect, useState } from "react";
import { getSession, onAuthStateChange, getProfile, getCredits } from "./authService.js";
import { setCurrentUser } from "../Persistence/indexedDB.js";
import { clearSession, listCloudProjects } from "../sync/syncEngine.js";
import { consumeGuestParam, isGuest, enterGuest as enterGuestStore, exitGuest as exitGuestStore } from "./guestMode.js";

const AuthContext = createContext(null);

export function AuthProvider({ children }) {
  const [session, setSession] = useState(undefined); // undefined = still loading
  const [user,    setUser]    = useState(null);
  const [tier,    setTier]    = useState("free");
  const [credits, setCredits] = useState(null);
  // Guest mode lets the app render with no account. Initialised synchronously on
  // first render so there is no flash of the login screen when arriving via ?guest=1.
  const [guest,   setGuest]   = useState(() => {
    consumeGuestParam(); // promotes ?guest=1 → persistent flag and strips the param
    return isGuest();
  });

  function enterGuest() {
    enterGuestStore();
    setGuest(true);
  }

  function exitGuest() {
    exitGuestStore();
    setGuest(false);
  }

  async function applySession(s) {
    setSession(s);
    const u = s?.user ?? null;
    setUser(u);
    setCurrentUser(u?.id ?? null);
    if (u) {
      // A real account supersedes guest mode — never both at once.
      exitGuestStore();
      setGuest(false);
    }
    if (!u) {
      clearSession();
      setTier("free");
      setCredits(null);
      if (typeof window !== "undefined") {
        window.dispatchEvent(new CustomEvent("econsolver:cloud-logout"));
      }
      return;
    }

    const profile = await getProfile(u.id);
    setTier(profile.tier);
    setCredits(profile.credits);
    try {
      const projects = await listCloudProjects();
      if (projects.length && typeof window !== "undefined") {
        window.dispatchEvent(new CustomEvent("econsolver:cloud-login", { detail: { projects } }));
      }
    } catch {
      // Cloud sync may not be configured or the migration may still be pending.
    }
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

  async function refreshCredits() {
    if (!user) return;
    const cr = await getCredits(user.id);
    setCredits(cr);
  }

  return (
    <AuthContext.Provider value={{ user, session, loading, tier, credits, setCredits, refreshCredits, guest, enterGuest, exitGuest }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used inside <AuthProvider>");
  return ctx;
}
