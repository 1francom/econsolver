-- Fix: guests were landing with 30 credits instead of 20. Root cause (confirmed
-- via pg_trigger + a live test row): Supabase's signInAnonymously() inserts the
-- auth.users row first (is_anonymous still false/null at that point), then
-- flips is_anonymous to true via a SEPARATE UPDATE afterward. The previous
-- migration's trigger (20260715130000) was AFTER INSERT only, so NEW.is_anonymous
-- read false at the moment it ran and the seed-20-credits branch never fired —
-- only the base signup trigger's unconditional 30-credit seed ever landed.
--
-- Fix: also fire on UPDATE OF is_anonymous, but ONLY on the true transition
-- (old value not true -> new value true). This is deliberately NOT "fire on
-- every update to auth.users" — that table's rows update on every login/token
-- refresh (last_sign_in_at etc.), and re-running the credit seed on each of
-- those would reset a returning guest's already-spent balance back to 20 every
-- time they re-authenticate.
--
-- ⚠️ Franco: this does NOT retroactively fix anonymous test rows already stuck
-- at 30 (their is_anonymous is already true, so there's no future transition to
-- catch). If you want those test rows corrected too, run a one-off:
--   update public.profiles set credits = 20
--   where id in (select id from auth.users where is_anonymous = true);

drop trigger if exists on_auth_user_created_guest_credits on auth.users;

-- INSERT case: covers the (untested-here, but possible on other Supabase
-- versions) path where is_anonymous is already true on the initial row.
-- An INSERT trigger's WHEN clause cannot reference OLD (no prior row exists),
-- so this one only checks NEW.
create trigger on_auth_user_anonymous_guest_credits_insert
  after insert on auth.users
  for each row
  when (new.is_anonymous is true)
  execute function public.seed_anonymous_guest_credits();

-- UPDATE case: the actual path this Supabase project uses — is_anonymous
-- flips to true via a separate UPDATE after the initial INSERT. Gated to the
-- true transition only (old not true -> new true), never on later updates to
-- the same row (auth.users updates on every login/token refresh; without this
-- guard a returning guest's spent balance would reset to 20 each time).
create trigger on_auth_user_anonymous_guest_credits_update
  after update of is_anonymous on auth.users
  for each row
  when (new.is_anonymous is true and coalesce(old.is_anonymous, false) is distinct from true)
  execute function public.seed_anonymous_guest_credits();
