-- Fix auth_rls_initplan: wrap auth.uid() in (select ...) to avoid per-row re-evaluation
-- Affects: synced_projects (new), feedback, profiles (pre-existing)
-- Also adds missing index on feedback.user_id FK

-- synced_projects
drop policy "own rows" on public.synced_projects;
create policy "own rows" on public.synced_projects
  for all
  using ((select auth.uid()) = user_id)
  with check ((select auth.uid()) = user_id);

-- feedback
drop policy "Users can submit feedback" on public.feedback;
create policy "Users can submit feedback" on public.feedback
  for all
  using ((select auth.uid()) = user_id)
  with check ((select auth.uid()) = user_id);

-- profiles
drop policy "read_own" on public.profiles;
create policy "read_own" on public.profiles
  for all
  using ((select auth.uid()) = id);

-- Missing FK index on feedback.user_id
create index if not exists feedback_user_id_idx on public.feedback (user_id);
