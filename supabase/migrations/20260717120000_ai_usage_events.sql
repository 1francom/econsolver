-- AI usage instrumentation (Franco 2026-07-17).
--
-- Purpose: the free-tier AI spend is a market-research budget — it must produce
-- data. This table is the raw event log the proxy writes after every AI call.
-- From it we derive: weekly actives, retention, which tasks/features get used,
-- and (once the global free pool lands) whether anyone tops the pool cap — the
-- clearest signal of real demand.
--
-- Writes go ONLY through the SECURITY DEFINER function log_ai_usage() called by
-- api/anthropic.js under the caller's JWT. RLS is enabled with NO client-facing
-- policies, so no anon/authenticated role can read or write the table directly —
-- reads are done from the Supabase dashboard / service role for analytics.
--
-- ⚠️ Franco: apply this migration in the Supabase dashboard / MCP.

create table if not exists public.ai_usage_events (
  id                     bigint generated always as identity primary key,
  user_id                uuid,
  is_anonymous           boolean not null default false,
  tier                   text    not null default 'free',
  task_type              text    not null default 'misc',
  model                  text,
  input_tokens           integer not null default 0,
  output_tokens          integer not null default 0,
  cache_read_tokens      integer not null default 0,
  cache_creation_tokens  integer not null default 0,
  advisor_tokens         integer not null default 0,   -- reserved for the advisor-tool phase
  cost                   integer not null default 0,   -- credits charged for this call
  created_at             timestamptz not null default now()
);

create index if not exists ai_usage_events_created_at_idx on public.ai_usage_events (created_at);
create index if not exists ai_usage_events_user_id_idx    on public.ai_usage_events (user_id);
create index if not exists ai_usage_events_task_idx       on public.ai_usage_events (task_type, created_at);

alter table public.ai_usage_events enable row level security;
-- Intentionally NO policies: table is write-only via the definer RPC below and
-- read-only from the dashboard/service role. Direct client access is denied.

-- Definer RPC — inserts one usage row for the calling user. tier/is_anonymous are
-- resolved server-side (never trusted from the client) so the log can't be spoofed.
create or replace function public.log_ai_usage(
  p_task                  text,
  p_model                 text,
  p_input                 integer default 0,
  p_output                integer default 0,
  p_cache_read            integer default 0,
  p_cache_creation        integer default 0,
  p_advisor               integer default 0,
  p_cost                  integer default 0
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid        uuid := auth.uid();
  v_is_anon    boolean := false;
  v_tier       text := 'free';
begin
  if v_uid is null then
    return; -- unauthenticated: nothing to log
  end if;
  select coalesce(u.is_anonymous, false) into v_is_anon from auth.users u where u.id = v_uid;
  select coalesce(p.tier, 'free')        into v_tier    from public.profiles p where p.id = v_uid;

  insert into public.ai_usage_events (
    user_id, is_anonymous, tier, task_type, model,
    input_tokens, output_tokens, cache_read_tokens, cache_creation_tokens,
    advisor_tokens, cost
  ) values (
    v_uid, v_is_anon, coalesce(v_tier, 'free'), coalesce(p_task, 'misc'), p_model,
    coalesce(p_input, 0), coalesce(p_output, 0), coalesce(p_cache_read, 0), coalesce(p_cache_creation, 0),
    coalesce(p_advisor, 0), coalesce(p_cost, 0)
  );
end;
$$;

grant execute on function public.log_ai_usage(
  text, text, integer, integer, integer, integer, integer, integer
) to authenticated, anon;
