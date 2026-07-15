-- Guest mode (try Litux without an account) is now backed by a real Supabase
-- Anonymous Auth session (see signInAnonymously() in src/services/auth/authService.js).
-- Anonymous sign-ins still insert a row into auth.users (is_anonymous = true) and flow
-- through whatever profile-seeding trigger already runs on new-user insert — this
-- migration does NOT know that trigger's body, so instead of touching it, it adds a
-- second AFTER INSERT trigger that force-sets the credit balance to 20 for anonymous
-- users only. This is intentionally trigger-order-agnostic: it upserts, so it works
-- whether it fires before or after the existing profile-seeding trigger.
--
-- ⚠️ Franco: before applying this —
--   1. Enable "Anonymous Sign-Ins" in Supabase Dashboard → Authentication → Providers.
--      (src/services/auth/authService.js:signInAnonymously will fail with an
--      "Anonymous sign-ins are disabled" error until this is on.)
--   2. Confirm your existing new-user trigger does a plain INSERT (not
--      "ON CONFLICT DO NOTHING") into public.profiles — if it does, this migration's
--      trigger (whichever fires second) will hit a duplicate-key error. If so, either
--      rename/reorder so this one fires first, or add "ON CONFLICT (id) DO NOTHING" to
--      your existing trigger's insert.
--   3. This gives 20 credits ONCE per anonymous identity, with no monthly reset —
--      spend_credits()'s tier-based monthly reset applies to 'free'/'pro'/'premium'
--      tiers; anonymous users keep tier='free' here so cost logic is unaffected, but
--      if spend_credits() resets by tier rather than by user signup date, a guest
--      could get refilled to 30 (not 20) on reset. Check spend_credits()'s reset
--      logic and adjust if guests should never refill, or should refill to 20.

create or replace function public.seed_anonymous_guest_credits()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.is_anonymous then
    insert into public.profiles (id, tier, credits)
    values (new.id, 'free', 20)
    on conflict (id) do update set credits = 20;
  end if;
  return new;
end;
$$;

drop trigger if exists on_auth_user_created_guest_credits on auth.users;
create trigger on_auth_user_created_guest_credits
  after insert on auth.users
  for each row
  execute function public.seed_anonymous_guest_credits();
