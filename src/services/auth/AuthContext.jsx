// ─── AUTH CONTEXT ─────────────────────────────────────────────────────────────
// Provides { user, session, loading } to the entire app.
// Initialises from the persisted Supabase session on mount.
import { createContext, useContext, useEffect, useRef, useState } from "react";
import { getSession, onAuthStateChange, getProfile, getCredits, signInAnonymously, signOut as authSignOut } from "./authService.js";
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

  // Guards against re-minting an anonymous Supabase identity on every render
  // (each anon sign-in is a fresh row with a fresh 20-credit balance — this
  // must only ever run once per browser per guest entry).
  const anonAttempted = useRef(false);

  // Guest mode is backed by a real anonymous Supabase session so the AI proxy's
  // JWT check and per-user credit metering work exactly like a real account
  // (see authService.signInAnonymously). Local flag flips the UI open instantly;
  // the anonymous sign-in happens in the background and is a no-op once a
  // session (anonymous or real) already exists.
  async function enterGuest(captchaToken) {
    enterGuestStore();
    setGuest(true);
    await ensureAnonymousSession(captchaToken);
  }

  async function ensureAnonymousSession(captchaToken) {
    if (anonAttempted.current || session) return;
    anonAttempted.current = true;
    try {
      await signInAnonymously(captchaToken); // onAuthStateChange → applySession wires session/credits
    } catch (e) {
      anonAttempted.current = false; // let a retry (e.g. after solving captcha) try again
      console.error("[Auth] anonymous sign-in failed — AI Coach will require a real account until this succeeds:", e.message ?? e);
      throw e;
    }
  }

  async function exitGuest() {
    exitGuestStore();
    setGuest(false);
    anonAttempted.current = false;
    if (session?.user?.is_anonymous) {
      try { await authSignOut(); } catch { /* best-effort cleanup */ }
    }
  }

  async function applySession(s) {
    setSession(s);
    const u = s?.user ?? null;
    setUser(u);
    setCurrentUser(u?.id ?? null);
    if (u && !u.is_anonymous) {
      // A real account supersedes guest mode — never both at once.
      exitGuestStore();
      setGuest(false);
    } else if (u?.is_anonymous) {
      // Anonymous session restored (e.g. page reload) — keep guest UI state in sync.
      anonAttempted.current = true;
      setGuest(true);
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
    if (u.is_anonymous) return; // guests never have cloud-synced projects

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
    getSession().then(s => {
      applySession(s);
      // Returning guest (local flag survived a reload) but no anonymous
      // session came back — e.g. it expired. Re-establish one.
      if (!s && isGuest()) ensureAnonymousSession();
    }).catch(() => {
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
