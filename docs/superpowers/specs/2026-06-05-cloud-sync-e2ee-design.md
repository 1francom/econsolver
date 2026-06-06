# Phase 4a-1 — Opt-in Cloud Sync with E2EE (design)

**Date:** 2026-06-05
**Status:** OPEN
**Author:** Claude.
**Source:** roadmap item #4. Builds on Phase 4b (local persistence completeness — all project artifacts in IndexedDB v9). Adds **opt-in, end-to-end-encrypted** cross-device sync. Sharing with other users is **deferred** (Phase 4a-2).

## Model

**Local-by-default, opt-in cloud — like GitHub/OneDrive.** The app stays fully local and private. A user may *publish* a specific project to the cloud; published projects sync across that user's own devices. Everything uploaded is **end-to-end encrypted** with a key the server never sees ("zero-knowledge"): the server stores only ciphertext.

### Privacy reconciliation (vs the "data never leaves the browser" invariant)
The invariant is preserved in spirit: **plaintext** never leaves the browser. Only ciphertext the server cannot read is uploaded, and only for projects the user explicitly publishes. CLAUDE.md line 288 should be amended to: *"plaintext data never leaves the browser; opt-in cloud sync uploads only client-side-encrypted blobs the server cannot decrypt."*

### Key management
- **Separate sync passphrase**, set the first time the user enables cloud. Key derivation: **Argon2id** (preferred) or **PBKDF2-SHA-256** (fallback) over the passphrase + a per-user random salt → a 256-bit master key. Payloads encrypted with **AES-256-GCM** (random IV per blob).
- The passphrase and master key **never** go to the server. The server stores only: the salt (needed to re-derive on a new device), ciphertext, IV, and a verifier (an encrypted known token to check "is this passphrase correct" without revealing the key).
- **Forgot passphrase → no data loss:** local IndexedDB is untouched and fully usable offline. To restore cloud sync, set a new passphrase and **re-publish from local** (re-encrypt + overwrite).
- **Optional recovery key:** on enabling cloud, offer a one-time downloadable **recovery key file** (the raw master key, base64) the user stores safely; importing it on a new device unlocks the cloud copy without the passphrase. Still zero-knowledge.

### Sync behavior
- **Pull on login:** list the user's published projects; offer to pull/restore any not present locally (decrypt → write to IndexedDB).
- **Push debounced:** when a *published* project changes locally, debounce-encrypt-upload.
- **Conflict = prompt to choose** (the user's chosen policy): detect divergence (both local and server changed since last sync, by `version`/`updated_at`); show a chooser ("keep this device's / keep cloud's / keep both as a fork").

## Architectural invariants

- **Single API egress** principle extends: all sync calls go through one `services/sync/` module (no scattered Supabase calls).
- **E2EE boundary:** encryption/decryption happens only client-side in `services/sync/crypto.js`; the master key lives in memory (and optionally `sessionStorage` for the tab session — never `localStorage`, never the server).
- **Untrusted-pull guard:** a decrypted, pulled pipeline is **untrusted input** (account compromise, tampered blob). Before applying, run every code-bearing step through `pipeline/exprGuard.assertSafeExpr` — reuse the import path's check. Reject/▢ unsafe steps exactly as `ImportPipelineButton` does.
- **Local-first:** sync never blocks local work; all sync is async/background; offline degrades to local-only silently.

---

## Part A — Supabase schema + RLS (greenfield)

A migration creates:

```sql
-- One row per published project, per user. Metadata + small encrypted manifest.
create table public.synced_projects (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null references auth.users(id) on delete cascade,
  pid         text not null,                 -- client project id
  name        text,                          -- ENCRYPTED (display handled client-side) or plaintext label per user choice
  salt        text not null,                 -- KDF salt (per user; same across their projects)
  verifier    text not null,                 -- AES-GCM(known-token) to validate passphrase
  manifest    text not null,                 -- AES-GCM(JSON: artifact list + blob refs + sizes)
  version     bigint not null default 1,     -- bumped each push; for conflict detection
  updated_at  timestamptz not null default now(),
  unique (user_id, pid)
);
alter table public.synced_projects enable row level security;
create policy "own rows" on public.synced_projects
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);
```

- **Large artifacts (datasets, etc.)** → **Supabase Storage** bucket `synced-blobs`, path `${user_id}/${pid}/${artifactKey}`, each object an AES-GCM ciphertext. Storage RLS: a user can only read/write objects under their own `user_id/` prefix.
- The `manifest` lists artifacts (`pipelines`, `raw_data` per dataset, `model_buffer`, `spatial_maps`, `plotHistory`, `workbench/equations`, `coach_chats`, project meta) with their storage keys, byte sizes, and per-artifact IVs.
- The per-user `salt` is stored once (first publish) and reused so all the user's projects derive the same master key.

> Apply via a tracked migration in `supabase/migrations/` (also resolves THREAT_MODEL §3.7's "db pull migrations into repo" gap for these tables). Verify with the Supabase advisor (no RLS lints).

## Part B — Crypto module (`src/services/sync/crypto.js`, NEW, pure)

WebCrypto-based, no key material leaves this module:
- `deriveKey(passphrase, saltB64) → CryptoKey` (Argon2id via a small WASM lib if bundled, else PBKDF2-SHA-256 ≥310k iters; pick one and document).
- `encryptJSON(key, obj) → { ct, iv }`, `decryptJSON(key, ct, iv) → obj` (AES-256-GCM).
- `encryptBytes(key, Uint8Array)` / `decryptBytes` for dataset blobs.
- `makeVerifier(key)` / `checkVerifier(key, verifier)` — encrypt/validate a fixed token.
- `exportRecoveryKey(key) → base64` / `importRecoveryKey(base64) → CryptoKey`.
- Node harness: round-trip encrypt→decrypt for JSON + bytes; wrong key fails; verifier accepts right key / rejects wrong.

## Part C — Sync engine (`src/services/sync/syncEngine.js`, NEW)

- `enableCloud(pid, passphrase)` — derive key, store salt+verifier, encrypt + upload the project bundle, mark project `published`.
- `pushProject(pid)` — debounced; diff artifacts vs last-pushed hashes; upload changed blobs; update `manifest` + bump `version`.
- `pullProject(pid)` — download manifest + blobs, decrypt, **assertSafeExpr-validate pipelines**, write to IndexedDB.
- `listCloudProjects()` — for the pull-on-login picker.
- `detectConflict(pid)` — compare local `lastSyncedVersion` vs server `version` and local dirty flag → `none | local-ahead | server-ahead | diverged`.
- `resolveConflict(pid, choice)` — `keep-local` (force push), `keep-cloud` (force pull), `fork` (new pid).
- All network via one Supabase client; all crypto via Part B; never logs plaintext or keys.

## Part D — UI

- **Publish/Sync control** in the project/Dataset Manager: "☁ Publish to cloud" → passphrase set dialog (first time) + recovery-key download offer; thereafter a sync-status chip (synced / syncing / offline / conflict).
- **Passphrase unlock** on login if the user has cloud projects: prompt for passphrase (or import recovery key) to derive the key for this session.
- **Conflict chooser** modal: side-by-side "this device vs cloud" (name, last-modified, artifact counts) → keep-local / keep-cloud / keep-both.
- **Pull-on-login picker:** list cloud projects not present locally → "Restore on this device".
- All copy makes the zero-knowledge model explicit ("we can't read or recover your passphrase").

## Part E — Settings / lifecycle

- `services/auth` `onAuthStateChange`: on login, if cloud projects exist, trigger the unlock + pull-picker; on logout, drop the in-memory master key.
- Unpublish: delete cloud rows + storage objects for a pid (local copy stays).
- Amend CLAUDE.md privacy invariant line (see Privacy reconciliation).

---

## Testing / validation

- Node harness for `crypto.js` (round-trips, wrong-key failure, verifier).
- Node/structural harness for `detectConflict` state logic (local-ahead / server-ahead / diverged).
- `npm run build` clean; Supabase advisor clean (RLS).
- Browser (Franco): publish a project on device A (set passphrase, download recovery key) → log in on device B → unlock with passphrase → pull → verify pipelines/models/maps/equations restore and a malicious step in a tampered blob is rejected by the pull guard → edit on both → conflict prompt appears.

## File checklist

- [ ] `supabase/migrations/<ts>_synced_projects.sql` — table + RLS + storage bucket policy.
- [ ] `src/services/sync/crypto.js` (+ `__validation__/crypto.test.mjs`) — NEW.
- [ ] `src/services/sync/syncEngine.js` — NEW.
- [ ] `src/services/sync/supabaseClient.js` — single client (or reuse existing).
- [ ] `src/services/Persistence/indexedDB.js` — `published` flag on projects; `lastSyncedVersion`/dirty tracking.
- [ ] UI: publish control + passphrase dialog + recovery-key + conflict modal + pull picker (Dataset Manager / Settings).
- [ ] `src/components/auth/*` or App lifecycle — unlock + pull-on-login hook.
- [ ] Reuse `pipeline/exprGuard.assertSafeExpr` in `pullProject`.
- [ ] `CLAUDE.md` — amend privacy invariant; note `services/sync/`. `THREAT_MODEL.md` — new § for E2EE sync (key model, threat coverage). `ClaudePlan.md` — status.

## Out of scope (later)
- **Sharing** with other users / collaborative editing / key exchange (Phase 4a-2).
- Server-side search/compute over synced data (impossible by design — server can't read it).
- Real-time multi-device live collaboration (this is sync-on-change, not CRDT).
- Passphrase rotation re-encryption flow (MVP: re-publish from local achieves it).
