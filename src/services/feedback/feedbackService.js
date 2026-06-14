// ─── FEEDBACK SERVICE ─────────────────────────────────────────────────────────
// Submits user feedback to the Supabase feedback table.
// RLS: authenticated users can INSERT their own rows only.
// The feedback-collector agent reads via service_role key (bypasses RLS).
import { supabase } from "../auth/authService.js";

// SECURITY (BugTriage 2026-06-13, XSS via feedback form): neutralise any HTML /
// script payload at this single write choke point so the stored value is inert
// everywhere it is later consumed — the feedback-collector agent's markdown
// dump (ClaudeFB.md / BugTriage.md), any future in-app feedback viewer, etc.
// Escaping `&<>` makes the content harmless in HTML/markdown/JSX while keeping
// it readable for triage. NOTE: this is defense-in-depth, NOT a security
// boundary — a determined actor can POST to Supabase directly, so the durable
// invariant is: any future feedback viewer must render the description as
// escaped text (React's default), never as raw HTML. A server-side trigger /
// validation on the `feedback` table is the recommended hard boundary.
const MAX_FEEDBACK_LEN = 5000;
function sanitizeFeedback(text) {
  return String(text ?? "")
    .slice(0, MAX_FEEDBACK_LEN)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .trim();
}

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
      description: sanitizeFeedback(description),
    });

  if (error) throw error;
}
