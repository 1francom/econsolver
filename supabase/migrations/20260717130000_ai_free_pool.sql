-- Global monthly free-tier AI spend pool (Franco 2026-07-17).
--
-- Per-user credits (profiles.credits) still cap each head; THIS is an ADDITIONAL
-- aggregate ceiling on the whole free tier's real AI cost, tracked in micro-USD,
-- so the monthly free-AI budget is bounded (it's market-research spend). When the
-- current calendar month's aggregate spend reaches the cap, free/guest AI degrades
-- to a local canned message until the next month (a fresh bucket row = fresh 0).
-- Paid tiers never touch this pool. Enforced in api/anthropic.js via the two RPCs
-- below (free_pool_exhausted before the call, add_free_pool_spend after).
--
-- ⚠️ Franco: apply this migration in the Supabase dashboard / MCP. Until then, the
--    proxy fails OPEN on free_pool_exhausted (never blocks the coach).

create table if not exists public.ai_pool_config (
  id         integer primary key default 1,
  cap_micros bigint  not null,
  constraint ai_pool_config_singleton check (id = 1)
);
-- Default cap ≈ €50/month. EUR→USD ~1.08 → ~$54 → 54,000,000 micro-USD. Tune here.
insert into public.ai_pool_config (id, cap_micros)
values (1, 54000000)
on conflict (id) do nothing;

create table if not exists public.ai_free_pool (
  period       date        primary key default date_trunc('month', now())::date,
  spent_micros bigint      not null default 0,
  updated_at   timestamptz not null default now()
);

alter table public.ai_pool_config enable row level security;
alter table public.ai_free_pool  enable row level security;
-- No client-facing policies: both tables are touched only through the definer
-- RPCs below (and read from the dashboard/service role for instrumentation).

-- True when the current calendar month's aggregate free-tier spend has reached the
-- configured cap. Fail-safe: a missing config or bucket row reads as NOT exhausted,
-- so a misconfiguration never hard-blocks the coach.
create or replace function public.free_pool_exhausted()
returns boolean
language sql
security definer
set search_path = public
stable
as $$
  select coalesce(
    (select fp.spent_micros
       from public.ai_free_pool fp
      where fp.period = date_trunc('month', now())::date)
    >= (select c.cap_micros from public.ai_pool_config c where c.id = 1),
    false
  );
$$;

-- Adds real micro-USD spend to the current month's bucket (upsert). Aggregate
-- across the whole free tier — NOT per user.
create or replace function public.add_free_pool_spend(p_micros bigint)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if coalesce(p_micros, 0) <= 0 then
    return;
  end if;
  insert into public.ai_free_pool (period, spent_micros, updated_at)
  values (date_trunc('month', now())::date, p_micros, now())
  on conflict (period) do update
    set spent_micros = public.ai_free_pool.spent_micros + excluded.spent_micros,
        updated_at   = now();
end;
$$;

grant execute on function public.free_pool_exhausted()          to authenticated, anon;
grant execute on function public.add_free_pool_spend(bigint)    to authenticated, anon;
