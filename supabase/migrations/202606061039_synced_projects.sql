-- Franco: review + apply, then run advisor.
-- Phase 4a-1 opt-in E2EE cloud sync metadata and encrypted blob storage.
-- Do not apply automatically from Codex.

create table public.synced_projects (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null references auth.users(id) on delete cascade,
  pid         text not null,
  name        text,
  salt        text not null,
  verifier    text not null,
  manifest    text not null,
  version     bigint not null default 1,
  updated_at  timestamptz not null default now(),
  unique (user_id, pid)
);

alter table public.synced_projects enable row level security;

create policy "own rows" on public.synced_projects
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);

grant select, insert, update, delete on public.synced_projects to authenticated;

insert into storage.buckets (id, name, public)
values ('synced-blobs', 'synced-blobs', false)
on conflict (id) do update
set public = false;

create policy "read own synced blobs" on storage.objects
  for select to authenticated
  using (
    bucket_id = 'synced-blobs'
    and (storage.foldername(name))[1] = auth.uid()::text
  );

create policy "insert own synced blobs" on storage.objects
  for insert to authenticated
  with check (
    bucket_id = 'synced-blobs'
    and (storage.foldername(name))[1] = auth.uid()::text
  );

create policy "update own synced blobs" on storage.objects
  for update to authenticated
  using (
    bucket_id = 'synced-blobs'
    and (storage.foldername(name))[1] = auth.uid()::text
  )
  with check (
    bucket_id = 'synced-blobs'
    and (storage.foldername(name))[1] = auth.uid()::text
  );

create policy "delete own synced blobs" on storage.objects
  for delete to authenticated
  using (
    bucket_id = 'synced-blobs'
    and (storage.foldername(name))[1] = auth.uid()::text
  );
