// ─── AUTH SERVICE ─────────────────────────────────────────────────────────────
// Thin wrapper around Supabase auth. All auth calls go through here.
// Supabase anon key is public by design — security is enforced via RLS.
import { createClient } from "@supabase/supabase-js";

const SUPABASE_URL  = import.meta.env.VITE_SUPABASE_URL;
const SUPABASE_ANON = import.meta.env.VITE_SUPABASE_ANON_KEY;

// Guard: if env vars are missing (e.g. Vercel project not configured yet),
// keep supabase null and let every function return gracefully so the login
// form still renders instead of crashing the app.
export let supabase = null;
try {
  if (SUPABASE_URL && SUPABASE_ANON) {
    supabase = createClient(SUPABASE_URL, SUPABASE_ANON, {
      auth: {
        persistSession: true,
        autoRefreshToken: true,
        detectSessionInUrl: false,
      },
    });
  }
} catch (e) {
  console.error("[Auth] Supabase init failed:", e);
}

// ─── Auth helpers ─────────────────────────────────────────────────────────────

export async function signIn(email, password, captchaToken) {
  if (!supabase) throw new Error("Authentication not configured. Set VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY in Vercel environment variables.");
  const { data, error } = await supabase.auth.signInWithPassword({
    email, password,
    options: captchaToken ? { captchaToken } : undefined,
  });
  if (error) throw error;
  return data;
}

export async function signUp(email, password, captchaToken) {
  if (!supabase) throw new Error("Authentication not configured. Set VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY in Vercel environment variables.");
  const { data, error } = await supabase.auth.signUp({
    email, password,
    options: captchaToken ? { captchaToken } : undefined,
  });
  if (error) throw error;
  return data;
}

export async function signOut() {
  if (!supabase) return;
  const { error } = await supabase.auth.signOut();
  if (error) throw error;
}

// Backs guest mode with a real (anonymous) Supabase session so the AI proxy's
// JWT check and per-user credit metering work identically to a real account.
// Requires "Anonymous Sign-Ins" enabled in the Supabase project's Auth settings.
export async function signInAnonymously(captchaToken) {
  if (!supabase) throw new Error("Authentication not configured.");
  const { data, error } = await supabase.auth.signInAnonymously({
    options: captchaToken ? { captchaToken } : undefined,
  });
  if (error) throw error;
  return data;
}

export async function getSession() {
  if (!supabase) return null;
  const { data: { session } } = await supabase.auth.getSession();
  return session;
}

export async function getTier(userId) {
  if (!supabase || !userId) return "free";
  const { data } = await supabase
    .from("profiles")
    .select("tier")
    .eq("id", userId)
    .single();
  return data?.tier ?? "free";
}

// Fetch tier + credits in a single round-trip.
export async function getProfile(userId) {
  if (!supabase || !userId) return { tier: "free", credits: null };
  const { data } = await supabase
    .from("profiles")
    .select("tier, credits")
    .eq("id", userId)
    .single();
  return { tier: data?.tier ?? "free", credits: data?.credits ?? null };
}

// Re-fetch the current user's credit balance.
export async function getCredits(userId) {
  if (!supabase || !userId) return null;
  const { data } = await supabase
    .from("profiles")
    .select("credits")
    .eq("id", userId)
    .single();
  return data?.credits ?? null;
}

export function onAuthStateChange(callback) {
  if (!supabase) return () => {};
  const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, session) => {
    callback(session);
  });
  return () => subscription.unsubscribe();
}
