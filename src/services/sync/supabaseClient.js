import { supabase } from "../auth/authService.js";

export function getSyncSupabase() {
  if (!supabase) {
    throw new Error("Cloud sync is not configured. Set VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY.");
  }
  return supabase;
}

export async function getCurrentUserId() {
  const client = getSyncSupabase();
  const { data, error } = await client.auth.getUser();
  if (error) throw error;
  return data?.user?.id ?? null;
}
