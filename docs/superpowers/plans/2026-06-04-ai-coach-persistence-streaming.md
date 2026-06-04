# AI Coach — Persisted Conversations + Streaming + Stop — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give the AI Research Coach per-project persisted multi-conversation memory, plus streamed responses with a real Stop button that halts token billing.

**Architecture:** Two independent tracks. Track 1 adds an IndexedDB `coach_chats` store (DB v6) and rebuilds `AIContextSidebar` state from a single `history` array into `{ conversations, activeId }`, scoped by project `pid`. Track 2 adds a sibling `streamClaude` to `AIService.js` (preserving the single-egress + prompt-caching invariants), streams the Sonnet step of `researchCoach`, makes `api/anthropic.js` pass through SSE bytes, and wires an `AbortController`-backed Stop button into the sidebar.

**Tech Stack:** React 19, Vite 8, IndexedDB (no wrapper), Anthropic Messages API (SSE streaming), Vercel Node serverless functions.

**Source spec:** `docs/superpowers/specs/2026-06-04-ai-coach-persistence-streaming-design.md`

---

## Verification model (read first)

This project has **no JS unit-test runner** (`package.json` scripts: `dev`, `build`, `lint`, `preview` only). Per project convention (CLAUDE.md + working conventions), behavior is validated by Franco **in the browser**. So every task uses these gates instead of red-green TDD:

- **`npm run lint`** — ESLint; catches syntax, unused vars, React-hook-rule violations. Must pass clean.
- **`npm run build`** — Vite build; catches import/compile errors. Must succeed.
- **Browser validation** — explicit manual checklist where the change is behavioral. Franco runs `npm run dev` and confirms.

Commit only after lint + build pass.

---

## File structure

| File | Responsibility | Change |
|------|----------------|--------|
| `src/services/Persistence/indexedDB.js` | `coach_chats` store + save/load/delete API + cleanup wiring | Modify |
| `src/services/AI/AIService.js` | `streamClaude` (new) + `researchCoach` streaming params | Modify |
| `api/anthropic.js` | SSE pass-through when `body.stream === true` | Modify |
| `src/App.jsx` | thread `pid` prop into both `AIContextSidebar` render sites | Modify |
| `src/components/AIContextSidebar.jsx` | conversation state model, persistence, switcher UI, streaming + Stop | Modify |

Tasks are ordered so each leaves the app in a working state: Track-1 storage/engine plumbing first (Tasks 1–4), then the UI that consumes it (Tasks 5–8).

---

## Task 1: IndexedDB `coach_chats` store (DB v6) + API

**Files:**
- Modify: `src/services/Persistence/indexedDB.js`

- [ ] **Step 1: Bump version + add store constant**

In `indexedDB.js`, change the version constant (currently `const DB_VERSION = 5;` near line 47) and add a store name constant next to the others:

```js
const DB_VERSION           = 6;
const STORE_PIPE           = "pipelines";
const STORE_RAW            = "raw_data";
const STORE_PROJ           = "projects";
const STORE_WORKBENCH      = "workbench";
const STORE_COACH          = "coach_chats";
```

- [ ] **Step 2: Create the store in `onupgradeneeded`**

Immediately after the existing v5 block (the `if (oldVer < 5) { ... STORE_WORKBENCH ... }` block, ~line 143-146), add:

```js
      // v6: coach_chats store — AI Coach conversations, keyed by project pid.
      if (oldVer < 6) {
        db.createObjectStore(STORE_COACH, { keyPath: "pid" });
      }
```

- [ ] **Step 3: Add the coach-chats API**

After the WORKBENCH API section (after `deleteWorkbenchRecord`, ~line 458, before `clearAllLocalData`), add:

```js
// ─── COACH CHATS API ──────────────────────────────────────────────────────────
// AI Coach conversations, one record per project pid.
//   Value : { pid, conversations: Conversation[], ts }
//   Conversation : { id, title, createdAt, updatedAt, messages: Message[] }
//   Message      : { role: "user"|"assistant", text, images? }

/**
 * Persist all conversations for a project. Overwrites the record.
 * Returns { stored: bool }.
 */
export async function saveCoachChats(pid, conversations) {
  if (!pid) return { stored: false };
  try {
    const db = await openDB();
    await tx(STORE_COACH, db, "readwrite", s =>
      s.put({ pid, conversations: Array.isArray(conversations) ? conversations : [], ts: Date.now() })
    );
    return { stored: true };
  } catch (err) {
    console.warn("[IDB] saveCoachChats failed:", err.message);
    return { stored: false };
  }
}

/**
 * Load the coach-chats record for a project. Returns { pid, conversations, ts } or null.
 */
export async function loadCoachChats(pid) {
  if (!pid) return null;
  try {
    const db = await openDB();
    return await new Promise((resolve, reject) => {
      const t   = db.transaction(STORE_COACH, "readonly");
      const req = t.objectStore(STORE_COACH).get(pid);
      req.onsuccess = e => resolve(e.target.result ?? null);
      req.onerror   = e => reject(e.target.error);
    });
  } catch {
    return null;
  }
}

/**
 * Delete the coach-chats record for a project.
 */
export async function deleteCoachChats(pid) {
  try {
    const db = await openDB();
    await tx(STORE_COACH, db, "readwrite", s => s.delete(pid));
  } catch { /* non-fatal */ }
}
```

- [ ] **Step 4: Wire cleanup into `deleteProject`**

`deleteProject` currently only deletes the project record (lines 406-409). Coach chats are a child of the pid, so delete them too:

```js
export async function deleteProject(pid) {
  const db = await openDB();
  await tx(STORE_PROJ, db, "readwrite", s => s.delete(pid));
  await deleteCoachChats(pid);
}
```

- [ ] **Step 5: Wire cleanup into `clearAllLocalData`**

In `clearAllLocalData` (lines 460-469), add a coach-chats clear alongside the workbench clear:

```js
  try {
    const db = await openDB();
    await tx(STORE_WORKBENCH, db, "readwrite", s => s.clear());
    await tx(STORE_COACH,     db, "readwrite", s => s.clear());
  } catch { /* non-fatal */ }
```

- [ ] **Step 6: Lint + build**

Run: `npm run lint && npm run build`
Expected: lint clean, build succeeds.

- [ ] **Step 7: Commit**

```bash
git add src/services/Persistence/indexedDB.js
git commit -m "feat(persistence): coach_chats IndexedDB store (v6) + save/load/delete API"
```

---

## Task 2: `streamClaude` in `AIService.js`

**Files:**
- Modify: `src/services/AI/AIService.js`

- [ ] **Step 1: Add `streamClaude` next to `callClaude`**

Insert immediately **after** `callClaude` ends (after its closing brace, ~line 174). It reuses the same module-level `MAX_TOK`, `MODEL`, `API_URL`, `_proxyEnabled`, `getAuthToken`, `getApiKey`, `SHARED_CONTEXT` that `callClaude` uses:

```js
// ─── STREAMING VARIANT ────────────────────────────────────────────────────────
// Same egress + caching invariants as callClaude (SHARED_CONTEXT cached block,
// anthropic-beta header). Parses the Anthropic SSE stream and forwards each text
// delta to onText. Honors an AbortController signal — on abort, resolves with the
// partial text accumulated so far (abort is NOT thrown as an error).
export async function streamClaude({ system, messages, maxTokens = MAX_TOK, model = MODEL, signal, onText }) {
  const systemArray = [
    { type: "text", text: SHARED_CONTEXT, cache_control: { type: "ephemeral" } },
  ];
  if (system) systemArray.push({ type: "text", text: system });

  const body = {
    model,
    max_tokens: maxTokens,
    stream:     true,
    system:     systemArray,
    messages:   messages ?? [],
  };

  let res;
  try {
    if (_proxyEnabled) {
      const token = await getAuthToken();
      res = await fetch("/api/anthropic", {
        method:  "POST",
        headers: {
          "Content-Type":  "application/json",
          "Authorization": token ? `Bearer ${token}` : "",
        },
        body:   JSON.stringify(body),
        signal,
      });
    } else {
      const apiKey = getApiKey();
      if (!apiKey) throw new Error("No API key — enter your Anthropic key in Settings (⚙), or set VITE_AI_PROXY_ENABLED=true.");
      res = await fetch(API_URL, {
        method:  "POST",
        headers: {
          "Content-Type":      "application/json",
          "x-api-key":         apiKey,
          "anthropic-version": "2023-06-01",
          "anthropic-beta":    "prompt-caching-2024-07-31",
          "anthropic-dangerous-direct-browser-access": "true",
        },
        body:   JSON.stringify(body),
        signal,
      });
    }
  } catch (networkErr) {
    if (networkErr.name === "AbortError") return "";
    throw new Error(`Network error: ${networkErr.message ?? "could not reach API"}`);
  }

  if (!res.ok) {
    let errBody;
    try { errBody = await res.json(); } catch { errBody = { error: res.statusText }; }
    if (res.status === 403 && errBody?.error === "premium_required") throw new Error("PREMIUM_REQUIRED");
    if (res.status === 401) throw new Error("Session expired — please sign in again.");
    throw new Error(`API error ${res.status}: ${errBody?.error ?? res.statusText}`);
  }

  const reader  = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  let full   = "";

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      const events = buffer.split("\n\n");
      buffer = events.pop() ?? ""; // last chunk may be incomplete
      for (const evt of events) {
        const dataLine = evt.split("\n").find(l => l.startsWith("data:"));
        if (!dataLine) continue;
        const json = dataLine.slice(5).trim();
        if (!json || json === "[DONE]") continue;
        let parsed;
        try { parsed = JSON.parse(json); } catch { continue; }
        if (parsed.type === "content_block_delta" && parsed.delta?.type === "text_delta") {
          const piece = parsed.delta.text ?? "";
          full += piece;
          onText?.(piece);
        } else if (parsed.type === "error") {
          throw new Error(parsed.error?.message ?? "stream error");
        }
      }
    }
  } catch (err) {
    if (err.name === "AbortError") return full; // partial answer retained
    throw err;
  }

  return full;
}
```

- [ ] **Step 2: Lint + build**

Run: `npm run lint && npm run build`
Expected: lint clean (note: `streamClaude` is exported but not yet imported anywhere — that is fine, it is a public export), build succeeds.

- [ ] **Step 3: Commit**

```bash
git add src/services/AI/AIService.js
git commit -m "feat(ai): streamClaude SSE streaming variant with AbortController support"
```

---

## Task 3: `researchCoach` streaming path

**Files:**
- Modify: `src/services/AI/AIService.js`

- [ ] **Step 1: Add `signal` + `onText` params to the signature**

Change the `researchCoach` signature (line 735) to:

```js
export async function researchCoach({ question, images = [], modelResult, dataDictionary = null, history = [], metadataReport = null, signal = undefined, onText = undefined }) {
```

- [ ] **Step 2: Stream the Sonnet step**

Replace the final return of the `try` block (currently `return await callClaude({ system: taskPrompt, messages: apiMessages, maxTokens: 800 });`, line 777) with:

```js
    return await streamClaude({ system: taskPrompt, messages: apiMessages, maxTokens: 800, signal, onText });
```

The Opus insight step above it (the `callClaude` with `model: MODEL_ADVISOR`, lines 747-752) stays blocking and unchanged — it is intentionally not streamed (250 tokens, not reclaimable). When `signal`/`onText` are omitted, `streamClaude` still resolves with the full text, so non-streaming callers behave identically.

- [ ] **Step 3: Lint + build**

Run: `npm run lint && npm run build`
Expected: lint clean, build succeeds.

- [ ] **Step 4: Commit**

```bash
git add src/services/AI/AIService.js
git commit -m "feat(ai): researchCoach streams Sonnet step via streamClaude (signal + onText)"
```

---

## Task 4: `api/anthropic.js` SSE pass-through

**Files:**
- Modify: `api/anthropic.js`

- [ ] **Step 1: Add streaming branch before the buffered JSON return**

Replace the final two lines (currently `const data = await anthropicRes.json();` and `return res.status(anthropicRes.status).json(data);`, lines 92-93) with:

```js
  // Streaming pass-through: forward the upstream SSE bytes unchanged so the
  // browser sees text deltas as they arrive and an abort halts generation.
  if (body.stream) {
    res.status(anthropicRes.status);
    res.setHeader("Content-Type",  "text/event-stream; charset=utf-8");
    res.setHeader("Cache-Control", "no-cache, no-transform");
    res.setHeader("Connection",    "keep-alive");
    if (!anthropicRes.ok || !anthropicRes.body) {
      const errText = await anthropicRes.text();
      res.end(errText);
      return;
    }
    const reader = anthropicRes.body.getReader();
    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        res.write(Buffer.from(value));
      }
    } catch {
      // client disconnect / upstream abort — fall through to end()
    }
    res.end();
    return;
  }

  const data = await anthropicRes.json();
  return res.status(anthropicRes.status).json(data);
```

The JWT validation + tier check (lines 26-60) run before this and are unchanged. Non-streaming requests keep the buffered `.json()` path.

- [ ] **Step 2: Lint + build**

Run: `npm run lint && npm run build`
Expected: lint clean, build succeeds.

- [ ] **Step 3: Commit**

```bash
git add api/anthropic.js
git commit -m "feat(proxy): stream Anthropic SSE through /api/anthropic when stream=true"
```

---

## Task 5: Thread `pid` into both `AIContextSidebar` render sites

**Files:**
- Modify: `src/App.jsx:2323`, `src/App.jsx:2337`

- [ ] **Step 1: Add `pid` prop to the project-scoped render site**

At the first render site (inside the `{pid && (…)}` block, ~line 2323), add `pid={pid}`:

```jsx
          <AIContextSidebar
            isOpen={sidebarOpen}
            onClose={()=>setSidebarOpen(false)}
            screen={activeTab}
            cleanedData={tabOutput(activeTab)}
            modelResult={activeResult}
            prefillMessage={coachPrefill}
            pid={pid}
          />
```

- [ ] **Step 2: Add `pid` prop to the fallback render site**

At the second render site (~line 2337, the no-project fallback), also pass `pid={pid}` (it will be `null` when no project is loaded, which the sidebar handles as an ephemeral in-memory conversation):

```jsx
      <AIContextSidebar
        isOpen={sidebarOpen}
        onClose={()=>setSidebarOpen(false)}
        screen={activeTab}
        cleanedData={tabOutput(activeTab)}
        modelResult={activeResult}
        prefillMessage={coachPrefill}
        pid={pid}
      />
```

- [ ] **Step 3: Lint + build**

Run: `npm run lint && npm run build`
Expected: lint clean, build succeeds (sidebar ignores the unknown-yet prop until Task 6).

- [ ] **Step 4: Commit**

```bash
git add src/App.jsx
git commit -m "feat(app): pass project pid into AIContextSidebar render sites"
```

---

## Task 6: Conversation state model + persistence in `AIContextSidebar`

**Files:**
- Modify: `src/components/AIContextSidebar.jsx`

This task changes state from a single `history` array to `{ conversations, activeId }`, loads/saves per `pid`, and auto-titles — **without** changing the UI chrome or the API call yet (still uses the existing blocking pattern via `researchCoach`, which already streams internally and resolves with full text). Switcher UI is Task 7; Stop button is Task 8.

- [ ] **Step 1: Import the persistence API + accept the `pid` prop**

Add to the imports at the top of the file:

```js
import { loadCoachChats, saveCoachChats } from "../services/Persistence/indexedDB.js";
```

Change the component signature (line 253) to accept `pid`:

```js
export default function AIContextSidebar({ isOpen, onClose, screen, cleanedData, modelResult, prefillMessage = null, pid = null }) {
```

- [ ] **Step 2: Add conversation helpers above the component**

Place just above `export default function AIContextSidebar` (after `PREMIUM_TIERS`, line 251):

```js
function makeConversation() {
  const now = Date.now();
  return {
    id:        `c_${now}_${Math.random().toString(36).slice(2, 7)}`,
    title:     "New chat",
    createdAt: now,
    updatedAt: now,
    messages:  [],
  };
}

function deriveTitle(text) {
  const trimmed = (text || "").trim();
  if (!trimmed) return "New chat";
  const words = trimmed.split(/\s+/).slice(0, 6).join(" ");
  return words.length < trimmed.length ? words + "…" : words;
}

// Drop the transient multipart `content` field before persisting — it is
// rebuilt from text + images at send time, keeping stored records small.
function stripForStorage(conversations) {
  return conversations.map(c => ({
    ...c,
    messages: c.messages.map(({ content, ...m }) => m),
  }));
}
```

- [ ] **Step 3: Replace the `history` state with conversation state**

Replace the `const [history, setHistory] = useState([]);` line (line 258) with:

```js
  const [conversations, setConversations] = useState([]);
  const [activeId,      setActiveId]      = useState(null);
  const active  = conversations.find(c => c.id === activeId) ?? null;
  const history = active?.messages ?? [];
```

`history` is now derived, so all existing reads of `history` (the `.map` render at line 470, the effect dep at line 293, the `history.length` checks) keep working unchanged.

- [ ] **Step 4: Add a helper to mutate the active conversation**

Add inside the component, after the `active`/`history` derivation:

```js
  function updateActive(mutateMessages) {
    setConversations(prev => prev.map(c => {
      if (c.id !== activeId) return c;
      const messages = mutateMessages(c.messages);
      let title = c.title;
      if ((!c.title || c.title === "New chat") && messages.length) {
        const firstUser = messages.find(m => m.role === "user");
        if (firstUser) title = deriveTitle(firstUser.text);
      }
      return { ...c, messages, title, updatedAt: Date.now() };
    }));
  }
```

- [ ] **Step 5: Load conversations on open / pid change**

Add this effect (near the other effects, after the existing `useEffect` at lines 288-293):

```js
  useEffect(() => {
    if (!isOpen) return;
    let cancelled = false;
    (async () => {
      if (!pid) {
        // No project loaded — ephemeral single conversation, not persisted.
        setConversations(prev => {
          if (prev.length) return prev;
          const seed = makeConversation();
          setActiveId(seed.id);
          return [seed];
        });
        return;
      }
      const rec   = await loadCoachChats(pid);
      if (cancelled) return;
      const convs = rec?.conversations?.length ? rec.conversations : [makeConversation()];
      setConversations(convs);
      setActiveId(convs[0].id);
    })();
    return () => { cancelled = true; };
  }, [pid, isOpen]);
```

- [ ] **Step 6: Debounced persist on change**

Add this effect after the load effect:

```js
  useEffect(() => {
    if (!pid || !conversations.length) return;
    const t = setTimeout(() => {
      saveCoachChats(pid, stripForStorage(conversations)).catch(() => {});
    }, 500);
    return () => clearTimeout(t);
  }, [pid, conversations]);
```

- [ ] **Step 7: Rewrite `submit` to mutate the active conversation**

Replace the `setHistory(prev => [...prev, userEntry]);` call inside `submit` (line 325) and the final `setHistory(prev => [...prev, { role: "assistant", text: reply }]);` (line 353). The cleanest change: capture `priorHistory` before appending, append the user entry via `updateActive`, then append the assistant reply via `updateActive`. Replace the body of `submit` from line 324 (`const userEntry = …`) through line 354 (`setLoading(false);`) with:

```js
    const userEntry = { role: "user", text: q || "(image)", images: imgs.length > 0 ? imgs : undefined, content: apiContent };
    const priorHistory = history; // snapshot BEFORE append — used for API context
    updateActive(msgs => [...msgs, userEntry]);
    setInput("");
    setPendingImages([]);
    setLoading(true);

    const reply = await researchCoach({
      question: q || "(image)",
      images: imgs,
      modelResult,
      dataDictionary: cleanedData?.dataDictionary ?? null,
      metadataReport,
      history: priorHistory.map((h, idx) => ({
        role: h.role,
        content: h.role === "user" && idx === 0
          ? (() => {
              const prefix = `CONTEXT:\n${contextStr}\n\n────────────────────────────\n`;
              if (h.images?.length) {
                return [
                  ...h.images.map(img => ({ type: "image", source: { type: "base64", media_type: img.mediaType, data: img.base64 } })),
                  { type: "text", text: prefix + h.text },
                ];
              }
              return prefix + h.text;
            })()
          : (h.content ?? h.text),
      })),
    });

    updateActive(msgs => [...msgs, { role: "assistant", text: reply }]);
    setLoading(false);
```

- [ ] **Step 8: Fix the existing clear button to use conversation state**

The input-side clear button (lines 497-503) calls `setHistory([])`, which no longer exists. Replace its `onClick` so it clears the **active** conversation's messages:

```jsx
            <button onClick={() => { updateActive(() => []); setInput(""); setPendingImages([]); }}
```

(Leave the rest of that button's JSX unchanged. The full conversation switcher comes in Task 7.)

- [ ] **Step 9: Lint + build**

Run: `npm run lint && npm run build`
Expected: lint clean (no remaining references to `setHistory`/`history` as state), build succeeds.

- [ ] **Step 10: Browser validation**

Run `npm run dev`. With a project loaded:
1. Ask a question, get a reply. Reload the page, reopen the coach → the conversation is restored.
2. Open a **different** project → its coach shows no (or its own) conversation, not the first project's.
3. The conversation's title becomes the first ~6 words of your opening question.
4. With **no** project loaded, the coach still works (ephemeral, not persisted across reload).

- [ ] **Step 11: Commit**

```bash
git add src/components/AIContextSidebar.jsx
git commit -m "feat(coach): per-project persisted conversation state model + auto-title"
```

---

## Task 7: Conversation switcher UI (list, new, delete, rename)

**Files:**
- Modify: `src/components/AIContextSidebar.jsx`

- [ ] **Step 1: Add switcher state + actions**

Add near the other `useState` calls in the component:

```js
  const [showChats, setShowChats] = useState(false);
  const [renameId,  setRenameId]  = useState(null);
  const [renameVal, setRenameVal] = useState("");

  function newChat() {
    const c = makeConversation();
    setConversations(prev => [c, ...prev]);
    setActiveId(c.id);
    setShowChats(false);
  }
  function selectChat(id) {
    setActiveId(id);
    setShowChats(false);
  }
  function deleteChat(id) {
    setConversations(prev => {
      const next = prev.filter(c => c.id !== id);
      if (next.length === 0) {
        const seed = makeConversation();
        setActiveId(seed.id);
        return [seed];
      }
      if (id === activeId) setActiveId(next[0].id);
      return next;
    });
  }
  function commitRename(id) {
    const title = renameVal.trim();
    if (title) setConversations(prev => prev.map(c => c.id === id ? { ...c, title } : c));
    setRenameId(null);
    setRenameVal("");
  }
```

- [ ] **Step 2: Add the "Chats" toggle to the header**

In the header block, the left side currently shows the "AI Research Coach" label + screen label (lines 428-439). Add a chats toggle button right after that `<div>` (before the close `✕` button at line 440). Insert:

```jsx
          <button onClick={() => setShowChats(s => !s)}
            style={{ background: "transparent", border: `1px solid ${C.border2}`, borderRadius: 3, color: C.textMuted, cursor: "pointer", fontFamily: mono, fontSize: 9, padding: "0.25rem 0.5rem", marginLeft: "auto", marginRight: 8 }}>
            ☰ Chats ({conversations.length})
          </button>
```

- [ ] **Step 3: Add the conversation dropdown panel**

Immediately after the header `<div>` closes (after line 444, before the `{/* Message area */}` comment), insert the dropdown:

```jsx
        {showChats && (
          <div style={{ borderBottom: `1px solid ${C.border}`, background: C.surface, maxHeight: 240, overflowY: "auto", flexShrink: 0 }}>
            <button onClick={newChat}
              style={{ width: "100%", textAlign: "left", padding: "0.5rem 1rem", background: "transparent", border: "none", borderBottom: `1px solid ${C.border}`, color: C.violet, cursor: "pointer", fontFamily: mono, fontSize: 10 }}>
              + New chat
            </button>
            {conversations.map(c => (
              <div key={c.id}
                style={{ display: "flex", alignItems: "center", gap: 6, padding: "0.4rem 0.75rem 0.4rem 1rem", background: c.id === activeId ? C.surface2 : "transparent", borderBottom: `1px solid ${C.border}` }}>
                {renameId === c.id ? (
                  <input autoFocus value={renameVal}
                    onChange={e => setRenameVal(e.target.value)}
                    onKeyDown={e => { if (e.key === "Enter") commitRename(c.id); if (e.key === "Escape") { setRenameId(null); setRenameVal(""); } }}
                    onBlur={() => commitRename(c.id)}
                    style={{ flex: 1, background: C.bg, border: `1px solid ${C.violet}`, borderRadius: 3, color: C.text, fontFamily: mono, fontSize: 10, padding: "0.2rem 0.35rem", outline: "none" }} />
                ) : (
                  <button onClick={() => selectChat(c.id)}
                    style={{ flex: 1, textAlign: "left", background: "transparent", border: "none", color: c.id === activeId ? C.teal : C.textDim, cursor: "pointer", fontFamily: mono, fontSize: 10, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                    {c.title}
                  </button>
                )}
                <button onClick={() => { setRenameId(c.id); setRenameVal(c.title); }}
                  title="Rename"
                  style={{ background: "transparent", border: "none", color: C.textMuted, cursor: "pointer", fontFamily: mono, fontSize: 10, padding: "0 2px" }}>✎</button>
                <button onClick={() => deleteChat(c.id)}
                  title="Delete"
                  style={{ background: "transparent", border: "none", color: C.textMuted, cursor: "pointer", fontFamily: mono, fontSize: 10, padding: "0 2px" }}
                  onMouseEnter={e => { e.currentTarget.style.color = C.red; }}
                  onMouseLeave={e => { e.currentTarget.style.color = C.textMuted; }}>✕</button>
              </div>
            ))}
          </div>
        )}
```

- [ ] **Step 4: Lint + build**

Run: `npm run lint && npm run build`
Expected: lint clean, build succeeds.

- [ ] **Step 5: Browser validation**

Run `npm run dev`. With a project loaded:
1. Click **☰ Chats** → dropdown lists conversations; active one highlighted.
2. **+ New chat** → starts an empty thread and switches to it.
3. Switch between two threads → each shows its own messages.
4. **✎** rename a thread → title updates and persists across reload.
5. **✕** delete a thread → it disappears; deleting the last one seeds a fresh empty thread.

- [ ] **Step 6: Commit**

```bash
git add src/components/AIContextSidebar.jsx
git commit -m "feat(coach): conversation switcher UI — new, switch, rename, delete"
```

---

## Task 8: Streaming + Stop button in the sidebar

**Files:**
- Modify: `src/components/AIContextSidebar.jsx`

- [ ] **Step 1: Add an AbortController ref**

Add near the other refs (after `inputRef`, line 263):

```js
  const abortRef = useRef(null);
```

- [ ] **Step 2: Make `submit` stream**

Replace the `researchCoach({ … })` call and the trailing `updateActive(msgs => [...msgs, { role: "assistant", text: reply }]); setLoading(false);` from Task 6 (Step 7) with a streaming version. The new `submit` body from `updateActive(msgs => [...msgs, userEntry]);` onward becomes:

```js
    updateActive(msgs => [...msgs, userEntry]);
    setInput("");
    setPendingImages([]);
    setLoading(true);

    const controller = new AbortController();
    abortRef.current = controller;

    try {
      await researchCoach({
        question: q || "(image)",
        images: imgs,
        modelResult,
        dataDictionary: cleanedData?.dataDictionary ?? null,
        metadataReport,
        signal: controller.signal,
        onText: (piece) => {
          updateActive(msgs => {
            const copy = msgs.slice();
            const last = copy[copy.length - 1];
            if (last && last.role === "assistant") {
              copy[copy.length - 1] = { ...last, text: last.text + piece };
            } else {
              copy.push({ role: "assistant", text: piece });
            }
            return copy;
          });
        },
        history: priorHistory.map((h, idx) => ({
          role: h.role,
          content: h.role === "user" && idx === 0
            ? (() => {
                const prefix = `CONTEXT:\n${contextStr}\n\n────────────────────────────\n`;
                if (h.images?.length) {
                  return [
                    ...h.images.map(img => ({ type: "image", source: { type: "base64", media_type: img.mediaType, data: img.base64 } })),
                    { type: "text", text: prefix + h.text },
                  ];
                }
                return prefix + h.text;
              })()
            : (h.content ?? h.text),
        })),
      });
    } finally {
      setLoading(false);
      abortRef.current = null;
    }
```

Note: the `priorHistory` snapshot line from Task 6 stays directly above `updateActive(msgs => [...msgs, userEntry]);`. The assistant bubble is no longer pre-appended — the first `onText` delta creates it, so an aborted-before-first-token request leaves no empty bubble.

- [ ] **Step 3: Show ThinkingBubble only until the first token**

The current render shows `{loading && <ThinkingBubble />}` (line 471). Change it so the spinner hides once the assistant bubble starts filling:

```jsx
          {loading && history[history.length - 1]?.role !== "assistant" && <ThinkingBubble />}
```

- [ ] **Step 4: Turn the Ask button into Stop while streaming**

Replace the send button (lines 524-534) with a version that becomes **Stop** while loading:

```jsx
          <button
            onClick={loading ? () => abortRef.current?.abort() : () => safeSubmit()}
            disabled={!loading && !input.trim() && pendingImages.length === 0}
            style={{
              padding: "0.45rem 0.85rem", borderRadius: 3, flexShrink: 0,
              background: loading ? C.red : ((input.trim() || pendingImages.length > 0) ? C.violet : "transparent"),
              border: `1px solid ${loading ? C.red : ((input.trim() || pendingImages.length > 0) ? C.violet : C.border2)}`,
              color: loading ? C.bg : ((input.trim() || pendingImages.length > 0) ? C.bg : C.textMuted),
              fontFamily: mono, fontSize: 10, fontWeight: 700,
              cursor: loading || input.trim() ? "pointer" : "not-allowed",
              transition: "all 0.13s",
            }}
          >{loading ? "Stop" : "Ask"}</button>
```

- [ ] **Step 5: Lint + build**

Run: `npm run lint && npm run build`
Expected: lint clean, build succeeds.

- [ ] **Step 6: Browser validation**

Run `npm run dev`. With a project loaded:
1. Ask a question → the answer renders **token-by-token** (not all at once).
2. Ask a long question → the **Stop** button (red) appears while streaming. Click it mid-stream → the partial answer stays, no error bubble, and the browser **Network** tab shows the `/api/anthropic` (or `api.anthropic.com` in dev) request **cancelled**.
3. The aborted partial answer persists across reload like any message.
4. Confirm prompt caching still works: in dev, the network response/usage shows `cache_read_input_tokens > 0` on the second call in a session.

- [ ] **Step 7: Commit**

```bash
git add src/components/AIContextSidebar.jsx
git commit -m "feat(coach): streaming responses + Stop button (AbortController) — token-saving halt"
```

---

## Task 9: Update spec/plan tracking + docs

**Files:**
- Modify: `ClaudePlan.md`
- Modify: `CLAUDE.md` (file-structure note for the new IDB store) — optional but recommended

- [ ] **Step 1: Flip the spec index status to DONE**

In `ClaudePlan.md`, change the `2026-06-04-ai-coach-persistence-streaming-design.md` row status from `OPEN` to `DONE` (after Franco confirms browser validation), keeping the notes.

- [ ] **Step 2: Note the new IDB store in CLAUDE.md (optional)**

In the `indexedDB.js` line of CLAUDE.md's file structure, append a mention of `loadCoachChats/saveCoachChats` so the docs reflect reality.

- [ ] **Step 3: Commit**

```bash
git add ClaudePlan.md CLAUDE.md
git commit -m "docs: mark AI coach persistence/streaming spec DONE; note coach_chats store"
```

---

## Self-review

**Spec coverage:**
- Per-project persistence (IDB v6 `coach_chats`) → Task 1 + Task 6 ✓
- Multiple named conversations, manual new → Task 6 (state) + Task 7 (UI) ✓
- Auto-title from first message, rename optional → Task 6 (`deriveTitle`) + Task 7 (rename) ✓
- `streamClaude` in AIService, invariants preserved → Task 2 ✓
- `researchCoach` keeps Opus blocking, streams Sonnet → Task 3 ✓
- Proxy SSE pass-through → Task 4 ✓
- pid prop threaded → Task 5 ✓
- Streaming UI + Stop, partial retained, no error bubble → Task 8 ✓
- Token-savings semantics (abort closes connection) → Task 2 (`signal` on fetch) + Task 8 (`abort()`) ✓
- `content` not persisted → Task 6 (`stripForStorage`) ✓
- Cleanup on deleteProject / clearAllLocalData → Task 1 ✓
- Browser validation per project convention → Tasks 6, 7, 8 ✓

**Placeholder scan:** No TBD/TODO; every code step shows complete code. ✓

**Type consistency:** `makeConversation`, `deriveTitle`, `stripForStorage`, `updateActive`, `newChat`/`selectChat`/`deleteChat`/`commitRename`, `abortRef`, `saveCoachChats`/`loadCoachChats`/`deleteCoachChats` are defined once and referenced consistently. `researchCoach` `signal`/`onText` params (Task 3) match the call in Task 8. Message shape `{ role, text, images?, content? }` consistent across submit, render, and `stripForStorage`. ✓

**Known follow-ups (not blockers):** the two sidebar render sites both receive `pid`; if both ever mount simultaneously they would share the same project's chats (acceptable — same data). Streaming requires Vercel to flush `res.write` without buffering; if production buffers, confirm no compression middleware wraps `/api/anthropic`.
