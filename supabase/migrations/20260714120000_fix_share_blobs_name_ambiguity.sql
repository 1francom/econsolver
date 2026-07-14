-- Fix ambiguous "name" reference in share_blobs_owner_select and
-- share_blobs_recipient_read (both created 2026-07-06 by
-- fix_project_shares_email_case). project_shares already had its own
-- `name` column (project display name, added by project_shares_add_name
-- on 2026-06-06) by the time these two policies were written, so the
-- unqualified `name` inside each EXISTS subquery bound to the closer
-- inner scope (project_shares.name) instead of the intended outer
-- storage.objects.name (the artifact path) — Postgres resolves this
-- silently, no error at CREATE POLICY time. split_part(ps.name, '/', 2)
-- is therefore always '' (project names don't contain '/'), so both
-- policies always evaluated to "no matching row" — i.e. always denied.
--
-- Verified live via pg_policies before this fix:
--   share_blobs_owner_select:   ... split_part(ps.name, '/'::text, 2) ...
--   share_blobs_recipient_read: ... split_part(ps.name, '/'::text, 2) ...
-- (the sibling share_blobs_owner_insert/update/delete policies were
-- created earlier, before project_shares.name existed, so they locked in
-- the correct objects.name binding and were never affected.)
--
-- Real-world impact: (1) owner artifact upload with upsert:true needs
-- SELECT to resolve insert-vs-update, so createShare() failed with
-- "new row violates row-level security policy" on every new share;
-- (2) recipients could never actually download share artifacts (always
-- "Object not found"), surfacing as a misleading "your account email
-- must exactly match..." message in pullShare()'s error mapping.
--
-- Fix: explicitly qualify every storage-object path reference as
-- objects.name so it can never re-bind to project_shares.name again.

drop policy "share_blobs_owner_select" on storage.objects;
create policy "share_blobs_owner_select" on storage.objects
  for select to authenticated
  using (
    bucket_id = 'synced-blobs'
    and split_part(objects.name, '/', 1) = 'shares'
    and exists (
      select 1 from public.project_shares ps
      where ps.token = split_part(objects.name, '/', 2)
        and ps.owner_id = (select auth.uid())
    )
  );

drop policy "share_blobs_recipient_read" on storage.objects;
create policy "share_blobs_recipient_read" on storage.objects
  for select to authenticated
  using (
    bucket_id = 'synced-blobs'
    and split_part(objects.name, '/', 1) = 'shares'
    and exists (
      select 1 from public.project_shares ps
      where ps.token = split_part(objects.name, '/', 2)
        and ps.recipient_email = lower((select auth.jwt() ->> 'email'))
    )
  );
