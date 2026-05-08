// ─── FEEDBACK SERVICE ─────────────────────────────────────────────────────────
// Submits user feedback to the Supabase feedback table.
// RLS: authenticated users can INSERT their own rows only.
// The feedback-collector agent reads via service_role key (bypasses RLS).
import { supabase } from "../auth/authService.js";

export async function submitFeedback({ module, type, description }) {
  if (!supabase) throw new Error("Supabase not configured.");

  const { data: { user } } = await supabase.auth.getUser();

  const { error } = await supabase
    .from("feedback")
    .insert({
      user_id:    user?.id   ?? null,
      user_email: user?.email ?? null,
      module,
      type,
      description: description.trim(),
    });

  if (error) throw error;
}
