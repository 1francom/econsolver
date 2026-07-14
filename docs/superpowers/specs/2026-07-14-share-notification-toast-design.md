# Share notification toast + share-link removal — design

**Status:** approved by Franco 2026-07-14, ready for implementation plan.

## Context

Project sharing (owner → recipient, via `src/services/sync/shareEngine.js` +
`project_shares` table) was just fixed (2026-07-14, migration
`fix_share_blobs_name_ambiguity`) — a name-resolution bug in the storage RLS
policies meant share artifacts were never actually reaching storage. Now that
sharing works end-to-end, two follow-on UX gaps surfaced:

1. `DatasetManager.jsx`'s "Share created" confirmation shows a share URL
   (`http://.../?share=TOKEN`) with a Copy button and an "Open in email
   client" link — but the recipient never needs it. `App.jsx` already has a
   fully working "Shared with me" card (`sharedWithMe` state, fed by
   `listSharedWithMe()`) with a one-click "Import →" button per share, driven
   entirely by the recipient's account email via RLS — no token/URL required.
   The link is dead weight and implies a distribution step that doesn't exist.
2. There is no signal to the recipient that a new share has arrived. They
   only find out by opening the app and noticing the "Shared with me" card.

## Scope

- Remove the share-link UI (URL input, Copy button, "Open in email client"
  link) from `DatasetManager.jsx`, keeping the "✓ Share created for X" line.
- Add a small auto-dismissing toast — `"{owner email} shared a project with
  you"` — that appears once, for 5 seconds, the first time the recipient's
  app loads after a new share is created for them. Plain toast: no
  click-to-navigate behavior (confirmed with Franco — keep it dumb).

Out of scope: real-time (mid-session) notification, a general-purpose toast
system for other features, editing/managing notification preferences.

## Design

### 1. `owner_email` column (new, denormalized)

`listSharedWithMe()` returns `owner_id` (a UUID) but not the owner's email —
`profiles` RLS (`read_own`) only lets a user read their own row, so the
recipient's client cannot resolve who `owner_id` belongs to. Rather than add
a new cross-table RLS grant (`profiles` stays locked to `read_own`, no new
surface for enumerating other users' emails), denormalize: add
`owner_email text` to `project_shares`, populated once at `createShare()`
insert time from the owner's own already-known session email.

Migration (new file in `supabase/migrations/`):
```sql
alter table public.project_shares add column owner_email text;
```
No RLS policy changes needed — `owner_email` is just another column on a row
already covered by the existing `share_owner_all` / `share_recipient_read`
policies.

`createShare()` (`shareEngine.js`) insert payload gains `owner_email:
(await supabase.auth.getUser()).data.user.email` (or reuse an already-fetched
session/user object if one exists in scope — check before adding a second
`getUser()` call).

`listSharedWithMe()`'s `.select(...)` gains `owner_email` to the column list.

### 2. "Already notified?" tracking — new IndexedDB store

Per this repo's IndexedDB-only invariant (no localStorage for persisted
state), add one small object store to `src/services/Persistence/indexedDB.js`,
following the exact pattern of the existing stores (`STORE_WORKBENCH`,
`STORE_COACH`, etc.):

- `STORE_NOTIFIED_SHARES = "notified_shares"`, `keyPath: "id"` (the
  `project_shares.id` UUID), value `{ id, notifiedAt }`.
- Add to `REQUIRED_STORES`, create in `onupgradeneeded` (bumps DB version by
  1, same mechanism as every prior store addition).
- Two functions: `getNotifiedShareIds()` → `Promise<Set<string>>`, and
  `markSharesNotified(ids: string[])` → `Promise<void>` (bulk put).

This store is a per-browser-profile "have I shown this toast yet" ledger, not
project/pipeline data — it doesn't need per-project scoping or export/import
handling, and is intentionally excluded from the share/sync bundle (nothing
in `shareEngine.js`'s `artifactEntries()` should reference it).

### 3. Detection flow (on app load / sign-in only — no polling, no Realtime)

In `App.jsx`, the existing effect that fetches `listSharedWithMe()` on
`[user?.id]` change gains a diff step right after the fetch resolves:

```js
const notifiedIds = await getNotifiedShareIds();
const newShares = shared.filter(s => !notifiedIds.has(s.id));
if (newShares.length) {
  setToastQueue(q => [...q, ...newShares]);
  await markSharesNotified(newShares.map(s => s.id));
}
```

Mark-as-notified happens immediately (not on toast dismiss) — a share is
"seen" the moment it's queued, so a page refresh mid-toast doesn't re-fire
it. This only ever fires on the effect's existing trigger (sign-in / app
load with a user present) — never a fresh poll, never Realtime. If the
recipient is mid-session when a share arrives, they won't see a toast until
their next reload/sign-in; acceptable per Franco's choice of the "on load
only" detection strategy (this app is not a real-time collab tool).

### 4. `ShareNotificationToast` component (new file)

`src/components/ShareNotificationToast.jsx` — small fixed-position card,
top-right corner, `C`-palette dark/teal/gold styling, IBM Plex Mono, inline
styles only (no CSS files, no new deps).

Props: `queue: {id, owner_email, name, pid}[]`, `onDismiss: (id) => void`.

Behavior:
- Shows one toast at a time from the queue (if `queue.length > 1`, show the
  next one after the current one's exit, not stacked simultaneously — keeps
  the corner uncluttered).
- Text: `"{owner_email} shared a project with you"` (fall back to "Someone"
  if `owner_email` is somehow null — legacy rows created before this
  migration won't have it backfilled).
- Auto-dismiss after 5000ms via `setTimeout`, cleared on unmount/queue
  change.
- Small `×` close button for early dismissal.
- No click-to-navigate — plain, dumb toast per Franco's confirmation.

Mounted once in `App.jsx`, next to where `sharedWithMe`/`toastQueue` state
already lives.

### 5. `DatasetManager.jsx` share-link removal

Delete the `<input value={shareResult.shareUrl}>` + Copy button
([DatasetManager.jsx:1144-1150](../../../src/components/workspace/DatasetManager.jsx))
and the `mailto:` "Open in email client" link
([DatasetManager.jsx:1155-1158](../../../src/components/workspace/DatasetManager.jsx)).
Keep the `✓ Share created for {shareEmail}` confirmation line
([DatasetManager.jsx:1138](../../../src/components/workspace/DatasetManager.jsx)).
`shareResult.shareUrl` becomes dead data on the return value of `createShare()`
— leave `createShare()`'s return shape alone (still useful if a future
feature wants the URL back), just stop rendering it.

## Testing / validation

- `npm run build` + `npm run lint:undef` green (standing rule for this repo
  — no browser validation from me; Franco validates in-browser).
- Franco to verify in browser: create a share → confirmation shows no link;
  sign in as the recipient (fresh session / reload) → toast appears once for
  5s with the correct owner email, "Shared with me" card still lists the
  share and imports correctly; reload again → toast does not reappear for
  the same share; create a second share while recipient is signed in →
  toast appears on their *next* load, not live.

## Invariants carried into implementation

- IndexedDB only for the notified-shares ledger — no localStorage.
- No changes to `share_blobs_*` / `share_owner_all` / `share_recipient_read`
  RLS policies — this feature only adds a column, doesn't touch access
  control.
- Inline styles via the `C` object — no CSS files, no new CDN dependencies.
- `createShare()`'s return shape (`{ shareId, token, shareUrl }`) is
  unchanged — only its consumer stops rendering `shareUrl`.
