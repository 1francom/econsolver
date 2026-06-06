-- Project sharing: owner can share an encrypted copy of a project with
-- another user identified by email. The share token is both the URL
-- identifier and the PBKDF2 source for the share encryption key, so
-- possession of the URL is the access credential.

create table public.project_shares (
  id              uuid primary key default gen_random_uuid(),
  owner_id        uuid not null references auth.users(id) on delete cascade,
  pid             text not null,
  recipient_email text not null,
  can_edit        boolean not null default false,
  token           text not null unique,
  salt            text not null,
  verifier        text not null,
  version         bigint not null default 1,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);

alter table public.project_shares enable row level security;

-- Owner: full control over their own shares
create policy "share_owner_all" on public.project_shares
  for all
  using  ((select auth.uid()) = owner_id)
  with check ((select auth.uid()) = owner_id);

-- Recipient: can read shares addressed to their account email
create policy "share_recipient_read" on public.project_shares
  for select
  using ((select auth.jwt() ->> 'email') = recipient_email);

grant select, insert, update, delete on public.project_shares to authenticated;

-- ── Storage policies for share blobs ──────────────────────────────────────────
-- Artifacts live at shares/{token}/{name} inside the existing synced-blobs bucket.

-- Owner can upload share artifacts
create policy "share_blobs_owner_insert" on storage.objects
  for insert to authenticated
  with check (
    bucket_id = 'synced-blobs'
    and split_part(name, '/', 1) = 'shares'
    and exists (
      select 1 from public.project_shares ps
      where ps.token = split_part(name, '/', 2)
        and ps.owner_id = (select auth.uid())
    )
  );

-- Owner can update (re-sync) share artifacts
create policy "share_blobs_owner_update" on storage.objects
  for update to authenticated
  using (
    bucket_id = 'synced-blobs'
    and split_part(name, '/', 1) = 'shares'
    and exists (
      select 1 from public.project_shares ps
      where ps.token = split_part(name, '/', 2)
        and ps.owner_id = (select auth.uid())
    )
  );

-- Owner can delete share artifacts (on revoke)
create policy "share_blobs_owner_delete" on storage.objects
  for delete to authenticated
  using (
    bucket_id = 'synced-blobs'
    and split_part(name, '/', 1) = 'shares'
    and exists (
      select 1 from public.project_shares ps
      where ps.token = split_part(name, '/', 2)
        and ps.owner_id = (select auth.uid())
    )
  );

-- Recipient can download share artifacts (email match via project_shares row)
create policy "share_blobs_recipient_read" on storage.objects
  for select to authenticated
  using (
    bucket_id = 'synced-blobs'
    and split_part(name, '/', 1) = 'shares'
    and exists (
      select 1 from public.project_shares ps
      where ps.token = split_part(name, '/', 2)
        and ps.recipient_email = (select auth.jwt() ->> 'email')
    )
  );
