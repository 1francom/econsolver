-- Fix RLS silently blocking project shares when the recipient's account
-- email has different letter-casing than the address the owner typed.
--
-- createShare() (src/services/sync/shareEngine.js) lowercases recipient_email
-- before insert, but the recipient-facing policies compared it against the
-- raw auth.jwt() ->> 'email' claim, which preserves whatever case the
-- recipient used at signup (Supabase Auth does not canonicalize case). A
-- mixed-case account email made the comparison fail, so the recipient's
-- SELECT returned zero rows and pullShare() reported "Share not found or
-- you are not the intended recipient." even for a correctly-addressed share.

drop policy "share_recipient_read" on public.project_shares;
create policy "share_recipient_read" on public.project_shares
  for select
  using (lower((select auth.jwt() ->> 'email')) = recipient_email);

drop policy "share_blobs_recipient_read" on storage.objects;
create policy "share_blobs_recipient_read" on storage.objects
  for select to authenticated
  using (
    bucket_id = 'synced-blobs'
    and split_part(name, '/', 1) = 'shares'
    and exists (
      select 1 from public.project_shares ps
      where ps.token = split_part(name, '/', 2)
        and ps.recipient_email = lower((select auth.jwt() ->> 'email'))
    )
  );
