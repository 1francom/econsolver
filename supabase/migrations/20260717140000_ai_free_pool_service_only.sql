-- Harden add_free_pool_spend (Franco 2026-07-17).
--
-- add_free_pool_spend mutates SHARED state (the aggregate free-tier pool) with a
-- caller-supplied amount. Granted to anon/authenticated (as it was), anyone with
-- the public anon key could POST /rest/v1/rpc/add_free_pool_spend and zero out the
-- free pool for the whole month. Restrict it to the proxy's service-role client.
--
-- NOT tightened (intentionally): log_ai_usage resolves the row's identity from
-- auth.uid(), so a direct caller can only insert self-attributed rows (self-
-- limiting, same as spend_credits); free_pool_exhausted() is read-only. Both stay
-- callable by authenticated/anon and keep running under the user's JWT.

revoke execute on function public.add_free_pool_spend(bigint) from public, anon, authenticated;
grant  execute on function public.add_free_pool_spend(bigint) to   service_role;
