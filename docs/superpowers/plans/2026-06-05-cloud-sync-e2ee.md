# Phase 4a-1 — Opt-in E2EE Cloud Sync — Implementation Plan (for Codex)

> Source spec (authoritative for detail): `docs/superpowers/specs/2026-06-05-cloud-sync-e2ee-design.md`.
> Executor: **Codex, solo.** Build in the task order below; commit per task; `npm run build` must stay clean after each code task.

## Locked decisions (do not re-litigate)
- **KDF = PBKDF2-SHA-256, ≥ 310,000 iterations** (built into WebCrypto — **no WASM/Argon2 dependency**). Cipher = **AES-256-GCM**, random 12-byte IV per blob.
- **Zero-knowledge:** passphrase + derived key NEVER sent to the server or logged. Master key lives in memory; may cache in `sessionStorage` for the tab session only — never `localStorage`, never the server.
- **Local-by-default:** sync is opt-in per project and fully async; offline degrades to local-only silently; sync never blocks local work.
- **Untrusted-pull guard:** every decrypted pipeline runs through `pipeline/exprGuard.assertSafeExpr` before being written to IndexedDB — reuse the exact field-scan from `ImportPipelineButton.jsx` (`expr/cond/cases[].cond/rules[].expr/js`); reject the pull if any step is unsafe.
- **Migration is reviewed before apply:** write the SQL file; do NOT auto-apply to the live DB — Franco reviews and applies (or asks you to). After apply, run the Supabase advisor and confirm zero RLS lints.
- Single sync client + single crypto module; no scattered Supabase calls.

## Branch / collision
Work on `Main-`. New files under `src/services/sync/` + a migration + UI hooks. Touches `indexedDB.js` (add `published`/`lastSyncedVersion`), App/Settings/DatasetManager for UI, and `CLAUDE.md`/`THREAT_MODEL.md`/`ClaudePlan.md`. No other contributor is active.

---

## Task 1 — Crypto module + harness  (spec Part B)
**Create** `src/services/sync/crypto.js`, `src/services/sync/__validation__/crypto.test.mjs`.
- Implement (WebCrypto): `deriveKey(passphrase, saltB64)` (PBKDF2-SHA-256 ≥310k → AES-GCM 256 CryptoKey, `extractable:true` only as needed for recovery export), `encryptJSON/decryptJSON`, `encryptBytes/decryptBytes` (AES-GCM, `{ct,iv}` base64), `makeVerifier/checkVerifier` (encrypt a fixed token, validate by decrypt-equals), `exportRecoveryKey/importRecoveryKey` (raw key ↔ base64), `randomSaltB64()`.
- Harness (Node, `node:crypto` webcrypto): JSON round-trip; bytes round-trip; wrong key → decrypt throws; verifier accepts right key, rejects wrong; recovery key export→import round-trips and decrypts.
- Gate: `node src/services/sync/__validation__/crypto.test.mjs` all pass; `npm run build`.
- Commit: `feat(sync): E2EE crypto module (PBKDF2 + AES-GCM) + harness`.

## Task 2 — Supabase schema migration  (spec Part A)
**Create** `supabase/migrations/<timestamp>_synced_projects.sql`:
- `synced_projects` table exactly as in the spec (user_id FK, pid, name, salt, verifier, manifest, version, updated_at, unique(user_id,pid)) + RLS `own rows` policy.
- Storage bucket `synced-blobs` + policies restricting objects to the owner's `auth.uid()/` path prefix (read+write+delete own only).
- Do **not** apply. Add a header comment: "Franco: review + apply, then run advisor."
- Gate: SQL parses (no build impact). Commit: `feat(sync): synced_projects schema + storage RLS migration (apply pending review)`.

## Task 3 — Sync client + IndexedDB sync metadata
**Create** `src/services/sync/supabaseClient.js` (reuse the existing Supabase client if one exists — search `createClient`; otherwise a thin singleton from `VITE_SUPABASE_URL`/anon key).
**Modify** `src/services/Persistence/indexedDB.js`: add per-project sync metadata to the `projects` record — `published: boolean`, `lastSyncedVersion: number`, `dirty: boolean` — with small helpers `markDirty(pid)`, `setSyncMeta(pid, {...})`, `getSyncMeta(pid)`. (Bump DB version only if a new store is needed; these fields live on the existing `projects` record, so no schema bump — just merge on save.)
- Gate: `npm run build`. Commit: `feat(sync): supabase client + project sync metadata`.

## Task 4 — Sync engine  (spec Part C)
**Create** `src/services/sync/syncEngine.js`:
- `enableCloud(pid, passphrase)` — `randomSaltB64`, derive key, build manifest, encrypt artifacts (pipelines, raw_data per dataset, model_buffer, spatial_maps, plotHistory, workbench, coach_chats, project meta — read them from `indexedDB.js`), upload blobs to Storage, insert `synced_projects` row with salt+verifier+manifest+version=1, set local `published=true`.
- `pushProject(pid)` — debounced; re-encrypt changed artifacts (hash compare), upload, update manifest, `version = version+1`, clear `dirty`.
- `pullProject(pid, key)` — download manifest+blobs, decrypt, **assertSafeExpr-validate pipelines (reject on unsafe)**, write to IndexedDB, set `lastSyncedVersion`.
- `listCloudProjects()`, `detectConflict(pid)` (`none|local-ahead|server-ahead|diverged` from `lastSyncedVersion` vs server `version` + local `dirty`), `resolveConflict(pid, choice)` (`keep-local`→force push, `keep-cloud`→force pull, `fork`→new pid), `unpublish(pid)` (delete row+objects; local stays), `lockSession(passphrase|recoveryKey)` (derive+verify, hold key in memory), `clearSession()`.
- Never log plaintext/keys.
- Add a structural Node harness for `detectConflict` state logic.
- Gate: harness + `npm run build`. Commit: `feat(sync): sync engine (publish/push/pull/conflict) with untrusted-pull guard`.

## Task 5 — UI  (spec Part D)
- **Publish/sync control** in DatasetManager (or project header): "☁ Publish to cloud" → passphrase-set dialog (first time, with strength hint + "we can't recover this" warning) + **recovery-key download** offer; afterwards a status chip (synced/syncing/offline/conflict).
- **Unlock-on-login** dialog (passphrase or import recovery key) when the user has cloud projects.
- **Conflict chooser** modal (this device vs cloud: name/modified/artifact counts → keep-local/keep-cloud/keep-both).
- **Pull-on-login picker** listing cloud projects absent locally → "Restore on this device".
- Match existing inline-style/`C`-palette conventions. Gate: `npm run build` + Franco browser check. Commit: `feat(sync): cloud publish/unlock/conflict/restore UI`.

## Task 6 — Lifecycle + docs  (spec Part E)
- Hook `auth.onAuthStateChange`: on login with cloud projects → trigger unlock + pull picker; on logout → `clearSession()` (drop in-memory key).
- `CLAUDE.md`: amend the privacy invariant line to "plaintext never leaves the browser; opt-in cloud uploads only client-side-encrypted blobs the server can't decrypt"; note `services/sync/`.
- `THREAT_MODEL.md`: new section for E2EE sync (key model, what the server can/can't see, untrusted-pull guard).
- `ClaudePlan.md`: set the 4a-1 row to DONE (browser+advisor validation pending Franco).
- Commit: `feat(sync): auth lifecycle hooks + docs`.

---

## Validation gates (every task)
`npm run build` clean; Node harnesses (Tasks 1, 4) pass. Franco does the end-to-end browser test from the spec (publish on A → unlock+pull on B → conflict prompt → tampered-blob pull rejected) and applies+advisor-checks the migration.

## Self-review pointers
- Reuse, don't reinvent: artifact read/write goes through existing `indexedDB.js` load/save fns; the pull guard reuses `exprGuard`/the ImportPipelineButton field-scan.
- Keep crypto in `crypto.js` only; keep Supabase calls in `supabaseClient.js`/`syncEngine.js` only.
- Sharing is OUT of scope (Phase 4a-2).
