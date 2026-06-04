# AI Coach — Persisted Conversations + Streaming + Stop

**Date:** 2026-06-04
**Status:** OPEN
**Component:** `src/components/AIContextSidebar.jsx`, `src/services/AI/AIService.js`, `src/services/Persistence/indexedDB.js`, `api/anthropic.js`

## Problem

The AI Research Coach (`AIContextSidebar.jsx`) has three gaps:

1. **No persistence.** Chat history lives in React `useState` (`history`). It survives tab switches while the app stays mounted, but is wiped on reload / new session. Nothing reaches IndexedDB.
2. **Single thread only.** One `history` array per session — no way to keep separate conversations.
3. **No real stop.** `researchCoach` is a blocking, non-streamed two-step call (Opus specialist insight → Sonnet 800-token answer, `await`ed). There is no streaming and no `AbortController`. A "stop" button on a blocking call would only *discard* already-generated, already-billed output — cosmetic, zero token savings.

"Clear chat" already exists (the `✕` button next to the input, `AIContextSidebar.jsx:497`) and is **not** part of this work beyond being repurposed.

## Goals

- Conversations persist **per project (`pid`)** across sessions, scoped like data/pipeline already are.
- **Multiple named conversations** per project, manually created, with a switcher UI. Auto-titled from the first message; rename optional.
- **Streaming responses** with a **Stop** button that genuinely halts generation and stops token billing (Sonnet output only).

## Non-Goals (YAGNI)

- No conversation cap, no cross-project chat search, no chat export.
- No streaming of the Opus insight step (250 tokens, fast, not worth reclaiming).
- No change to the contextual starters, image paste, or premium gate behavior.

---

## Track 1 — Per-project persisted conversations

### Data model

New IndexedDB object store `coach_chats`, **one record per project**, mirroring the existing `workbench` store (`indexedDB.js:419`):

```
Record:        { pid, conversations: Conversation[], ts }
Conversation:  { id, title, createdAt, updatedAt, messages: Message[] }
Message:       { role: "user"|"assistant", text: string, images?: Image[] }
```

`Message` matches the shape `Bubble` already renders. The transient multipart API `content` field is **not persisted** — it is rebuilt at send time from `text` + `images`, keeping records small.

### Persistence API (`indexedDB.js`)

Bump `DB_VERSION` 5 → 6. Add store in `onupgradeneeded`:

```js
// v6: coach_chats store — AI Coach conversations, keyed by project pid.
if (oldVer < 6) {
  db.createObjectStore(STORE_COACH, { keyPath: "pid" });
}
```

Add three functions copied from the workbench pattern:

- `saveCoachChats(pid, conversations)` → `{ pid, conversations, ts }`, returns `{ stored: true }`.
- `loadCoachChats(pid)` → `{ pid, conversations, ts } | null`.
- `deleteCoachChats(pid)` → non-fatal delete.

Wire `deleteCoachChats(pid)` into `deleteProject` cleanup and `STORE_COACH` clear into `clearAllLocalData`.

### UI (`AIContextSidebar.jsx`)

- State: `history` (single array) → `{ conversations: Conversation[], activeId: string }`. The rendered thread = `conversations.find(c => c.id === activeId).messages`.
- **Header conversation switcher:** a "☰ Chats" dropdown listing the project's conversations (title + relative time; active highlighted), a **+ New chat** button, per-row **delete** (`✕`) and **rename** (pencil → inline edit). Repurpose the existing input-side `✕` as "new chat" or remove it (decide in plan; favor moving clear into the dropdown row).
- **Auto-title:** on the first user send in a fresh conversation, set `title` = first ~6 words of the opening question (truncate, ellipsis). Rename overrides it.
- **Prop dependency:** the sidebar must receive the project `pid`. It currently gets `screen`, `cleanedData`, `modelResult`, `prefillMessage`. Trace the pid source in `App.jsx` / `DataStudio.jsx` and thread it as a new prop during planning.
- **Lifecycle:** on open or `pid` change → `loadCoachChats(pid)`; if no record or empty, seed one fresh empty conversation. On every message append → **debounced** `saveCoachChats(pid, conversations)`.
- **Failure mode:** IndexedDB errors are non-fatal — chat keeps working in-memory for the session, consistent with the workbench try/catch convention.

---

## Track 2 — Streaming + Stop

### `streamClaude` (`AIService.js`)

New function **alongside** `callClaude` in the same file (preserves the single-egress-choke-point invariant):

```
streamClaude({ system, messages, maxTokens, model, signal, onText }) → Promise<string>
```

- Sets `body.stream = true`. Keeps the cached `SHARED_CONTEXT` system block (`cache_control: ephemeral`) and the `anthropic-beta: prompt-caching-2024-07-31` header — both invariants intact.
- Reads the `text/event-stream` response; on each `content_block_delta` with a `text_delta`, calls `onText(deltaText)` and accumulates. Resolves with the full accumulated text.
- Passes `signal` to `fetch`. On abort, the reader stops and the function resolves with the **partial** text accumulated so far (abort is not an error).
- Same error mapping as `callClaude`: 403 `premium_required` → `PREMIUM_REQUIRED`, 401 → session-expired, others → `API error N`.

### `researchCoach` streaming path (`AIService.js`)

- Keep the Opus insight step blocking via `callClaude` (250 tokens — cannot reclaim, fast).
- Replace the final `return await callClaude(...)` (`AIService.js:777`) with `streamClaude(...)`, forwarding new optional `signal` and `onText` params from the caller. When `onText`/`signal` are absent, behavior is equivalent to today (still streams internally, resolves with full text).

### Proxy (`api/anthropic.js`) — required server-side change

The proxy currently buffers (`await anthropicRes.json()`, `api/anthropic.js:92`). Add a streaming pass-through:

- When the parsed `body.stream === true`, do **not** call `.json()`. Set response headers `Content-Type: text/event-stream`, `Cache-Control: no-cache`, `Connection: keep-alive`, propagate `anthropicRes.status`, and pipe `anthropicRes.body` to `res` (stream the upstream SSE chunks through unchanged).
- Keep JWT validation + tier check unchanged (runs before forwarding).
- Without this change, streaming/stop only works in the dev direct-browser path, not production. Bonus: streaming also sidesteps the 10s Hobby-plan function timeout noted at `api/anthropic.js:15`.

### UI streaming (`AIContextSidebar.jsx`)

- On submit: append the user message, then append an **empty assistant message**, and create an `AbortController`. Call `researchCoach({ ..., signal, onText })` where `onText` appends the delta to the in-flight assistant message's `text` (state update per chunk; the message area already auto-scrolls on `history` change).
- While streaming, the **"Ask" button becomes "Stop"** (and the standalone send affordance is disabled). Clicking Stop calls `controller.abort()`.
- On abort: retain the partial assistant text, clear `loading`, **no error bubble**. The partial message persists like any other (token billing already stopped at the cut because the connection closed).
- On error mid-stream (network, premium): surface as an assistant error bubble, same as today's `safeSubmit`.

### Token-savings semantics

Aborting closes the fetch → Anthropic halts generation → billed only for the **Sonnet** output tokens streamed up to the cut. The Opus insight (250 tokens) is already spent and not recoverable. This is the explicit reason streaming (not a cosmetic stop) was chosen.

---

## Testing / Validation

Browser validation (project convention — Franco validates before next task):

1. **Persistence:** load a project, chat, reload page → conversation restored. Switch projects → each shows its own chats.
2. **Multiple conversations:** + New chat, switch between threads, delete one, rename one. Auto-title appears after first send.
3. **Streaming:** ask a long question → answer renders token-by-token.
4. **Stop:** hit Stop mid-stream → partial answer retained, no error bubble, browser network tab shows the request cancelled.
5. **Prod + dev parity:** verify streaming works both via the dev direct-browser path and the deployed `/api/anthropic` proxy.
6. **Prompt caching intact:** confirm cache-read usage still reported (cached `SHARED_CONTEXT` block) on streamed calls.

## Open items for the implementation plan

- Locate the project `pid` source and thread it into `AIContextSidebar`.
- Decide the fate of the existing input-side `✕` clear button (move clear into the conversation dropdown row vs. keep as "new chat").
- Debounce interval for `saveCoachChats` (suggest ~500 ms trailing).
