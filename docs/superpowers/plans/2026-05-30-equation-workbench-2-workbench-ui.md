# Equation Workbench — Plan 2: Workbench UI Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the interactive Workbench UI on top of the already-validated Plan 1 symbolic engine — sessions, equation/constraint cards, a shared parameter pool, a live plotting canvas, and a symbolic+numeric results panel — persisted per-project to IndexedDB.

**Architecture:** A new `src/components/calculate/workbench/` folder holds small focused React files. All symbolic work goes through the `cas` facade (`src/math/cas/casAdapter.js`); all numeric fallback through `src/math/calcEngine.js`. A pure-JS `operations.js` module bridges cards → engine → the §5.6 dual result contract, and is browser-harness-testable like the engines. Persistence reuses the existing `services/persistence/indexedDB.js` with a new `workbench` store, wrapped by `workbenchStore.js`. The Workbench mounts at the TOP of `CalculateTab.jsx` as the hero section; the existing MathPad / FunctionGrapher / Monte Carlo sections stay untouched (their removal/reorg is Plan 3, so each plan ships independently).

**Tech Stack:** React 19, Vite 8, plain JS, inline styles via the `C` palette + IBM Plex Mono (`mono`). nerdamer (CDN, via `cas`), KaTeX (CDN) for LaTeX, raw `<canvas>` for plotting (same pattern as the existing `FunctionGrapher`). No JS test runner — verification is the in-browser `window.__validation.*` harness plus explicit click-path checks.

**Scope:** Spec §9 build-order slices **3–8**. Slices 9 (AI Interpret) and 10 (tab reorg / Monte Carlo move) are Plan 3.

**Reference spec:** `docs/superpowers/specs/2026-05-30-equation-workbench-design.md` — keep §3 (session model), §5.6 (result contract), §7 (component layout), §8 (design language), §10 (security) open while implementing.

**Security invariants (spec §10) that every task must honor:**
- Symbolic eval: user input is passed only as a **string to nerdamer's parser** through `cas.*` — never compiled by app-side code. `cas.compile` (nerdamer `buildFunction`) is the only numeric-evaluator path; do NOT introduce a `Function` constructor anywhere in the Workbench files.
- LaTeX: render via KaTeX with `trust:false`; never `innerHTML` a raw expression string.
- Persistence: session JSON is **untrusted on read** — `validateSessions` re-shapes every loaded record and drops malformed expressions before they reach the engine.

---

### Task 1: IndexedDB `workbench` store (v5)

Add a per-project `workbench` object store to the existing DB and raw load/save helpers. The store key is `pid`; the value is `{ pid, sessions, ts }`.

**Files:**
- Modify: `src/services/persistence/indexedDB.js` (DB version, upgrade block, new API section)

- [ ] **Step 1: Bump the DB version and name the store constant**

In `src/services/persistence/indexedDB.js`, change the version constant (currently `const DB_VERSION = 4;` at line 42) and add a store-name constant beside the others (lines 43–45):

```js
const DB_VERSION           = 5;
const STORE_PIPE           = "pipelines";
const STORE_RAW            = "raw_data";
const STORE_PROJ           = "projects";
const STORE_WORKBENCH      = "workbench";
const RAW_DATA_LIMIT_BYTES = 100 * 1024 * 1024; // 100 MB hard cap
```

- [ ] **Step 2: Add the v5 upgrade branch**

Inside `req.onupgradeneeded`, after the existing `if (oldVer < 4 && oldVer >= 1) { … }` block and before the closing `}` of the handler (after line 135), add:

```js
      // v5: workbench store — Equation Workbench sessions, keyed by project pid.
      if (oldVer < 5) {
        db.createObjectStore(STORE_WORKBENCH, { keyPath: "pid" });
      }
```

- [ ] **Step 3: Add the raw workbench API**

After the PROJECTS API section (after line 406, before `clearAllLocalData`), add:

```js
// ─── WORKBENCH API ────────────────────────────────────────────────────────────
// Equation Workbench sessions, one record per project pid.
//   Value : { pid, sessions: Session[], ts }

/**
 * Persist the full session array for a project. Overwrites the record.
 * Returns { stored: bool }.
 */
export async function saveWorkbenchRecord(pid, sessions) {
  if (!pid) throw new Error("saveWorkbenchRecord: pid required");
  const db = await openDB();
  await tx(STORE_WORKBENCH, db, "readwrite", s =>
    s.put({ pid, sessions: Array.isArray(sessions) ? sessions : [], ts: Date.now() })
  );
  return { stored: true };
}

/**
 * Load the workbench record for a project. Returns { pid, sessions, ts } or null.
 */
export async function loadWorkbenchRecord(pid) {
  if (!pid) return null;
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const t   = db.transaction(STORE_WORKBENCH, "readonly");
    const req = t.objectStore(STORE_WORKBENCH).get(pid);
    req.onsuccess = e => resolve(e.target.result ?? null);
    req.onerror   = e => reject(e.target.error);
  });
}

/**
 * Delete the workbench record for a project.
 */
export async function deleteWorkbenchRecord(pid) {
  try {
    const db = await openDB();
    await tx(STORE_WORKBENCH, db, "readwrite", s => s.delete(pid));
  } catch { /* non-fatal */ }
}
```

- [ ] **Step 4: Include the workbench store in the full-wipe path**

`clearAllLocalData` (line 408) only clears pipelines/projects. Update it so a full reset also drops workbench sessions:

```js
export async function clearAllLocalData() {
  await clearAllPipelines(); // clears STORE_PIPE + STORE_RAW
  await clearAllProjects();  // clears STORE_PROJ
  try {
    const db = await openDB();
    await tx(STORE_WORKBENCH, db, "readwrite", s => s.clear());
  } catch { /* non-fatal */ }
  try { localStorage.clear(); } catch (_) {}
  try { sessionStorage.clear(); } catch (_) {}
}
```

- [ ] **Step 5: Lint the file**

Run: `npx eslint src/services/persistence/indexedDB.js`
Expected: no output (clean).

- [ ] **Step 6: Commit**

```bash
git add src/services/persistence/indexedDB.js
git commit -m "feat(workbench): IndexedDB v5 workbench store + raw load/save helpers"
```

---

### Task 2: `workbenchStore.js` — session factories + validated load/save

A pure-JS domain wrapper over the Task 1 raw helpers. Owns the session/equation JSON factories (§3 shape), the untrusted-on-read validator (§10.5), and a debounced autosave. No React.

**Files:**
- Create: `src/components/calculate/workbench/workbenchStore.js`
- Create: `src/math/__validation__/workbenchStoreValidation.js`
- Modify: `src/main.jsx` (register the new harness)

- [ ] **Step 1: Write the store module**

Create `src/components/calculate/workbench/workbenchStore.js`:

```js
// Domain wrapper over services/persistence/indexedDB.js for Equation Workbench
// sessions. Pure JS, no React. Owns the §3 JSON factories, the §10.5
// untrusted-on-read validator, and a debounced autosave.
import {
  loadWorkbenchRecord,
  saveWorkbenchRecord,
} from "../../../services/persistence/indexedDB.js";

let _seq = 0;
const uid = (p) => `${p}_${Date.now().toString(36)}_${(_seq++).toString(36)}`;

// ── Factories (§3 session model) ──────────────────────────────────────────────

export function newEquation(overrides = {}) {
  return {
    id: uid("eq"),
    label: "f",
    expr: "",
    kind: "objective",          // "objective" | "constraint"
    axis: "",                   // x-axis symbol (objectives only)
    ops: { plot: true, deriv: false, integral: false, solveZero: false, optimize: false },
    sense: "max",               // "max" | "min"
    relation: { lhs: "", op: "=", rhs: "" }, // constraint only
    ...overrides,
  };
}

export function newSession(overrides = {}) {
  return {
    id: uid("ses"),
    name: "Session 1",
    equations: [],
    params: [],                 // [{ name, value, min, max, step }]
    choiceVars: [],
    view: { xRange: [0.01, 10], positiveQuad: true },
    results: {},                // { [equationId]: { [op]: ResultContract } }
    ...overrides,
  };
}

// ── Validation (§10.5 — treat stored JSON as untrusted) ───────────────────────

const OPS = ["plot", "deriv", "integral", "solveZero", "optimize"];

function isFiniteNum(x) { return typeof x === "number" && Number.isFinite(x); }
function str(x, fallback = "") { return typeof x === "string" ? x : fallback; }

function validateEquation(raw) {
  if (!raw || typeof raw !== "object") return null;
  const base = newEquation();
  const ops = {};
  for (const k of OPS) ops[k] = !!(raw.ops && raw.ops[k]);
  const rel = raw.relation && typeof raw.relation === "object" ? raw.relation : {};
  return {
    id: str(raw.id, base.id),
    label: str(raw.label, "f").slice(0, 24),
    expr: str(raw.expr, "").slice(0, 512),   // bounded; re-parsed through cas downstream
    kind: raw.kind === "constraint" ? "constraint" : "objective",
    axis: str(raw.axis, ""),
    ops,
    sense: raw.sense === "min" ? "min" : "max",
    relation: { lhs: str(rel.lhs, "").slice(0, 256), op: "=", rhs: str(rel.rhs, "").slice(0, 256) },
  };
}

function validateParam(raw) {
  if (!raw || typeof raw !== "object" || typeof raw.name !== "string") return null;
  return {
    name: raw.name.slice(0, 24),
    value: isFiniteNum(raw.value) ? raw.value : 1,
    min: isFiniteNum(raw.min) ? raw.min : 0,
    max: isFiniteNum(raw.max) ? raw.max : 10,
    step: isFiniteNum(raw.step) && raw.step > 0 ? raw.step : 0.1,
  };
}

export function validateSession(raw) {
  if (!raw || typeof raw !== "object") return null;
  const base = newSession();
  const equations = Array.isArray(raw.equations)
    ? raw.equations.map(validateEquation).filter(Boolean)
    : [];
  const params = Array.isArray(raw.params)
    ? raw.params.map(validateParam).filter(Boolean)
    : [];
  const choiceVars = Array.isArray(raw.choiceVars)
    ? raw.choiceVars.filter((v) => typeof v === "string").map((v) => v.slice(0, 24))
    : [];
  const view = raw.view && typeof raw.view === "object" ? raw.view : {};
  const xr = Array.isArray(view.xRange) && view.xRange.length === 2
    && isFiniteNum(view.xRange[0]) && isFiniteNum(view.xRange[1])
    ? [view.xRange[0], view.xRange[1]] : base.view.xRange;
  return {
    id: str(raw.id, base.id),
    name: str(raw.name, "Session").slice(0, 40),
    equations,
    params,
    choiceVars,
    view: { xRange: xr, positiveQuad: view.positiveQuad !== false },
    results: {}, // never trust cached results; recompute live
  };
}

export function validateSessions(rawSessions) {
  if (!Array.isArray(rawSessions)) return [];
  return rawSessions.map(validateSession).filter(Boolean);
}

// ── Load / save ───────────────────────────────────────────────────────────────

export async function loadWorkbench(pid) {
  const rec = await loadWorkbenchRecord(pid);
  const sessions = validateSessions(rec?.sessions);
  return sessions.length ? sessions : [newSession()];
}

let _saveTimer = null;
export function saveWorkbench(pid, sessions, { debounceMs = 500 } = {}) {
  if (_saveTimer) clearTimeout(_saveTimer);
  _saveTimer = setTimeout(() => {
    saveWorkbenchRecord(pid, sessions).catch((e) =>
      console.error("[workbenchStore] save failed:", e),
    );
  }, debounceMs);
}

// Flush immediately (e.g. on unmount). Returns the save promise.
export function flushWorkbench(pid, sessions) {
  if (_saveTimer) { clearTimeout(_saveTimer); _saveTimer = null; }
  return saveWorkbenchRecord(pid, sessions);
}
```

- [ ] **Step 2: Write the validation harness**

Create `src/math/__validation__/workbenchStoreValidation.js`:

```js
// Browser harness for workbenchStore factories + validator.
// Exposes window.__validation.workbenchStore() -> { cells, allPass }.
// No IndexedDB round-trip here (that needs a live DB); pure shape checks.
import {
  newSession, newEquation, validateSession, validateSessions,
} from "../../components/calculate/workbench/workbenchStore.js";

export function runWorkbenchStoreValidation() {
  const cells = [];

  // Cell 1: newSession has the §3 shape with one fresh id.
  {
    const s = newSession();
    const pass = typeof s.id === "string" && Array.isArray(s.equations)
      && Array.isArray(s.params) && Array.isArray(s.choiceVars)
      && Array.isArray(s.view.xRange) && s.view.xRange.length === 2;
    cells.push({ name: "newSession-shape", expected: "§3 shape", got: Object.keys(s), pass });
  }

  // Cell 2: newEquation defaults — objective, plot on, max.
  {
    const e = newEquation();
    const pass = e.kind === "objective" && e.ops.plot === true
      && e.ops.deriv === false && e.sense === "max" && e.relation.op === "=";
    cells.push({ name: "newEquation-defaults", expected: "objective/plot/max", got: e, pass });
  }

  // Cell 3: validateSession drops a malformed equation and coerces bad fields.
  {
    const dirty = {
      id: "s1", name: 123, // bad type -> coerced
      equations: [
        null,                                   // dropped
        { expr: "A*K^a", kind: "weird", sense: "sideways" }, // coerced
      ],
      params: [{ name: "A", value: "nope" }],   // value coerced to 1
      choiceVars: ["K", 5],                      // 5 dropped
      view: { xRange: [0, 5], positiveQuad: false },
    };
    const v = validateSession(dirty);
    const eq = v.equations[0];
    const pass = v.equations.length === 1
      && eq.kind === "objective" && eq.sense === "max"
      && v.params[0].value === 1
      && v.choiceVars.length === 1 && v.choiceVars[0] === "K"
      && v.view.positiveQuad === false;
    cells.push({ name: "validate-coerce-drop", expected: "1 eq, sanitized", got: v, pass });
  }

  // Cell 4: validateSessions on non-array returns [].
  {
    const pass = Array.isArray(validateSessions("garbage")) && validateSessions("garbage").length === 0;
    cells.push({ name: "validate-nonarray", expected: "[]", got: validateSessions("garbage"), pass });
  }

  // Cell 5: expr length is bounded (defense-in-depth §10.5).
  {
    const big = "x+".repeat(400) + "x"; // > 512 chars
    const v = validateSession({ equations: [{ expr: big }] });
    const pass = v.equations[0].expr.length <= 512;
    cells.push({ name: "expr-bounded", expected: "<=512", got: v.equations[0].expr.length, pass });
  }

  const allPass = cells.every((c) => c.pass);
  return { cells, allPass };
}

if (typeof window !== "undefined") {
  window.__validation = window.__validation || {};
  window.__validation.workbenchStore = runWorkbenchStoreValidation;
}
```

- [ ] **Step 3: Register the harness in main.jsx**

In `src/main.jsx`, the existing DEV block imports the engine harness:

```js
if (import.meta.env.DEV) {
  // Self-registers window.__validation.workbench() for in-browser symbolic-engine checks.
  import('./math/__validation__/workbenchEngineValidation.js')
}
```

Replace it with:

```js
if (import.meta.env.DEV) {
  // Self-registers window.__validation.workbench() for in-browser symbolic-engine checks.
  import('./math/__validation__/workbenchEngineValidation.js')
  // Self-registers window.__validation.workbenchStore() for session-store shape checks.
  import('./math/__validation__/workbenchStoreValidation.js')
}
```

- [ ] **Step 4: Lint**

Run: `npx eslint src/components/calculate/workbench/workbenchStore.js src/math/__validation__/workbenchStoreValidation.js`
Expected: no output.

- [ ] **Step 5: Franco validates in browser**

Start the dev server (`npm run dev`), open the app, open the browser console, and run:

```js
await window.__validation.workbenchStore()
```

Expected: `{ cells: Array(5), allPass: true }`. Expand and confirm every `pass: true`.

- [ ] **Step 6: Commit**

```bash
git add src/components/calculate/workbench/workbenchStore.js src/math/__validation__/workbenchStoreValidation.js src/main.jsx
git commit -m "feat(workbench): session-store domain wrapper + untrusted-on-read validator"
```

---

### Task 3: Workbench shell + session tabs + mount

The React shell that owns the session array, loads/saves via Task 2, and renders session tabs over an empty layout. Mount it at the TOP of CalculateTab and thread `pid` down from App.

**Files:**
- Create: `src/components/calculate/workbench/SessionTabs.jsx`
- Create: `src/components/calculate/workbench/Workbench.jsx`
- Modify: `src/components/tabs/CalculateTab.jsx` (signature + mount)
- Modify: `src/App.jsx` (pass `pid`)

- [ ] **Step 1: Write SessionTabs.jsx**

Create `src/components/calculate/workbench/SessionTabs.jsx`:

```jsx
import { useState } from "react";
import { useTheme } from "../../../ThemeContext.jsx";

const mono = "'IBM Plex Mono', monospace";

// Top bar: switch / add / rename (double-click) / close sessions.
export default function SessionTabs({ sessions, activeId, onSelect, onAdd, onRename, onClose }) {
  const { C } = useTheme();
  const [editingId, setEditingId] = useState(null);
  const [draft, setDraft] = useState("");

  function startRename(s) { setEditingId(s.id); setDraft(s.name); }
  function commitRename() {
    if (editingId && draft.trim()) onRename(editingId, draft.trim().slice(0, 40));
    setEditingId(null);
  }

  return (
    <div style={{ display: "flex", alignItems: "center", gap: 6, flexWrap: "wrap", marginBottom: 14 }}>
      {sessions.map((s) => {
        const active = s.id === activeId;
        return (
          <div key={s.id}
            onClick={() => onSelect(s.id)}
            onDoubleClick={() => startRename(s)}
            style={{
              display: "flex", alignItems: "center", gap: 6, cursor: "pointer",
              padding: "5px 10px", borderRadius: 6, fontFamily: mono, fontSize: 12,
              background: active ? C.teal + "22" : "transparent",
              border: `1px solid ${active ? C.teal : C.line || "#222"}`,
              color: active ? C.teal : C.textDim || "#888",
            }}>
            {editingId === s.id ? (
              <input autoFocus value={draft}
                onChange={(e) => setDraft(e.target.value)}
                onBlur={commitRename}
                onKeyDown={(e) => { if (e.key === "Enter") commitRename(); if (e.key === "Escape") setEditingId(null); }}
                style={{ background: C.bg, color: C.text, border: `1px solid ${C.teal}`, fontFamily: mono, fontSize: 12, width: 90, padding: "2px 4px" }} />
            ) : (
              <span>{s.name}</span>
            )}
            {sessions.length > 1 && (
              <span onClick={(e) => { e.stopPropagation(); onClose(s.id); }}
                style={{ color: C.red || "#c86e6e", fontSize: 13, lineHeight: 1 }}>×</span>
            )}
          </div>
        );
      })}
      <button onClick={onAdd}
        style={{ padding: "5px 10px", borderRadius: 6, fontFamily: mono, fontSize: 12,
          background: "transparent", border: `1px dashed ${C.gold}`, color: C.gold, cursor: "pointer" }}>
        + Session
      </button>
    </div>
  );
}
```

- [ ] **Step 2: Write Workbench.jsx shell**

Create `src/components/calculate/workbench/Workbench.jsx`. This task ships the shell with an empty-layout placeholder; later tasks fill the three panels.

```jsx
import { useState, useEffect, useRef, useCallback } from "react";
import { useTheme } from "../../../ThemeContext.jsx";
import SessionTabs from "./SessionTabs.jsx";
import { newSession, loadWorkbench, saveWorkbench, flushWorkbench } from "./workbenchStore.js";

const mono = "'IBM Plex Mono', monospace";

export default function Workbench({ pid }) {
  const { C } = useTheme();
  const storeKey = pid ?? "scratch";
  const [sessions, setSessions] = useState([newSession()]);
  const [activeId, setActiveId] = useState(null);
  const loadedRef = useRef(false);

  // Load on mount / pid change.
  useEffect(() => {
    let cancelled = false;
    loadedRef.current = false;
    loadWorkbench(storeKey).then((loaded) => {
      if (cancelled) return;
      setSessions(loaded);
      setActiveId(loaded[0]?.id ?? null);
      loadedRef.current = true;
    });
    return () => { cancelled = true; };
  }, [storeKey]);

  // Debounced autosave after first load.
  useEffect(() => {
    if (!loadedRef.current) return;
    saveWorkbench(storeKey, sessions);
  }, [sessions, storeKey]);

  // Flush on unmount.
  useEffect(() => () => {
    if (loadedRef.current) flushWorkbench(storeKey, sessions).catch(() => {});
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const active = sessions.find((s) => s.id === activeId) || sessions[0];

  // Mutate the active session immutably.
  const updateActive = useCallback((mutator) => {
    setSessions((prev) => prev.map((s) => (s.id === (activeId ?? prev[0]?.id) ? mutator(s) : s)));
  }, [activeId]);

  function addSession() {
    const s = newSession({ name: `Session ${sessions.length + 1}` });
    setSessions((prev) => [...prev, s]);
    setActiveId(s.id);
  }
  function renameSession(id, name) {
    setSessions((prev) => prev.map((s) => (s.id === id ? { ...s, name } : s)));
  }
  function closeSession(id) {
    setSessions((prev) => {
      const next = prev.filter((s) => s.id !== id);
      const safe = next.length ? next : [newSession()];
      if (id === activeId) setActiveId(safe[0].id);
      return safe;
    });
  }

  if (!active) return null;

  return (
    <div style={{ fontFamily: mono, color: C.text, border: `1px solid ${C.line || "#222"}`,
      borderRadius: 10, padding: "1.2rem 1.4rem", marginBottom: "2rem",
      background: "linear-gradient(180deg, " + (C.panel || "#0d0d0d") + ", " + C.bg + ")" }}>

      <div style={{ display: "flex", alignItems: "baseline", gap: 12, marginBottom: 12 }}>
        <div style={{ fontSize: 9, color: C.teal, letterSpacing: "0.26em", textTransform: "uppercase" }}>Equation Workbench</div>
        <div style={{ fontSize: 11, color: C.textDim || "#888" }}>symbolic-first · solve · plot · differentiate · optimize</div>
      </div>

      <SessionTabs
        sessions={sessions} activeId={active.id}
        onSelect={setActiveId} onAdd={addSession}
        onRename={renameSession} onClose={closeSession} />

      {/* Three-panel layout placeholder — filled by Tasks 4–8. */}
      <div style={{ display: "grid", gridTemplateColumns: "minmax(0,1fr) minmax(0,1.2fr)", gap: 14 }}>
        <div data-wb-left>
          <div style={{ fontSize: 11, color: C.textDim || "#888" }}>Equations + parameters land here (Tasks 4–5).</div>
        </div>
        <div data-wb-right>
          <div style={{ fontSize: 11, color: C.textDim || "#888" }}>Canvas + results land here (Tasks 7–8).</div>
        </div>
      </div>

      {/* updateActive is wired to child panels in later tasks; referenced here to keep lint quiet. */}
      <span style={{ display: "none" }} data-wb-active={active.id} ref={() => void updateActive} />
    </div>
  );
}
```

- [ ] **Step 3: Thread `pid` from App.jsx into CalculateTab**

In `src/App.jsx`, the `<CalculateTab>` mount (around line 2268) passes `rows`/`headers`/`onAddDataset`/`onAddColumn`/`onCreateDataset` but not `pid`. Add `pid={pid}` to that element (the `pid` state already exists at line ~1878):

```jsx
<CalculateTab
  pid={pid}
  rows={/* existing */ rows}
  headers={/* existing */ headers}
  onAddDataset={/* existing */ onAddDataset}
  onAddColumn={/* existing */ onAddColumn}
  onCreateDataset={/* existing */ onCreateDataset}
/>
```

> Apply this as a surgical edit: add only the `pid={pid}` line to the existing JSX element. Do not rewrite the other props.

- [ ] **Step 4: Accept `pid` in CalculateTab and mount the Workbench**

In `src/components/tabs/CalculateTab.jsx`, update the signature (line 1416):

```jsx
export default function CalculateTab({ pid, rows = [], headers = [], onAddDataset, onAddColumn, onCreateDataset }) {
```

Add the import at the top of the file (next to the other component imports):

```jsx
import Workbench from "../calculate/workbench/Workbench.jsx";
```

Then mount the Workbench at the very top of the left scroll column — immediately after the opening `<div style={{ overflowY: "auto", … }}>` at line 1787, before the `<HintBox …>`:

```jsx
      <div style={{ overflowY: "auto", padding: "1.8rem 1.5rem 1.8rem 2.4rem" }}>

      <Workbench pid={pid} />

      <HintBox title="How to calculate" sections={[
```

> The existing MathPad / FunctionGrapher / Monte Carlo sections stay exactly as-is. The Workbench is additive (hero on top). Reorg/removal is Plan 3.

- [ ] **Step 5: Lint**

Run: `npx eslint src/components/calculate/workbench/Workbench.jsx src/components/calculate/workbench/SessionTabs.jsx src/components/tabs/CalculateTab.jsx src/App.jsx`
Expected: no output.

- [ ] **Step 6: Franco validates in browser**

`npm run dev`, open the app, go to the **Calculate** tab. Expect:
1. An "Equation Workbench" hero card at the top with one "Session 1" tab and a "+ Session" button.
2. Click **+ Session** → a "Session 2" tab appears and becomes active.
3. Double-click a tab → it becomes an editable input; type a new name + Enter → renames.
4. Click the **×** on a tab → it closes (the × only shows when ≥2 sessions exist).
5. Reload the page → the sessions you created persist (loaded from IndexedDB).
6. The old Variable Workspace / Math Pad / Monte Carlo sections still render below, unchanged.

- [ ] **Step 7: Commit**

```bash
git add src/components/calculate/workbench/Workbench.jsx src/components/calculate/workbench/SessionTabs.jsx src/components/tabs/CalculateTab.jsx src/App.jsx
git commit -m "feat(workbench): session shell + tabs, mounted as CalculateTab hero with pid persistence"
```

---

### Task 4: KaTeX loader helper + ParametersPanel

A shared KaTeX CDN loader (used by ResultsPanel later) and the shared parameter slider pool. Parameters auto-populate from symbols detected across all equation cards via `extractSymbols`; each symbol toggles between **Parameter** (slider) and **Choice variable** (optimized over).

**Files:**
- Create: `src/components/calculate/workbench/katexLoader.js`
- Create: `src/components/calculate/workbench/ParametersPanel.jsx`

- [ ] **Step 1: Write the KaTeX loader**

Create `src/components/calculate/workbench/katexLoader.js`. (CalculateTab already loads KaTeX inline; this is a reusable promise-cached loader so Workbench files don't duplicate the snippet.)

```js
// Lazy KaTeX CDN loader, promise-cached. Mirrors the existing CalculateTab CDN
// pattern. Render path (§10.4): katex.renderToString(latex, { trust:false }).
const KATEX_JS  = "https://cdn.jsdelivr.net/npm/katex@0.16.11/dist/katex.min.js";
const KATEX_CSS = "https://cdn.jsdelivr.net/npm/katex@0.16.11/dist/katex.min.css";

let loadPromise = null;

export function loadKatex() {
  if (typeof window !== "undefined" && window.katex) return Promise.resolve(window.katex);
  if (loadPromise) return loadPromise;
  loadPromise = new Promise((resolve, reject) => {
    if (!document.querySelector(`link[href="${KATEX_CSS}"]`)) {
      const link = document.createElement("link");
      link.rel = "stylesheet"; link.href = KATEX_CSS;
      document.head.appendChild(link);
    }
    const s = document.createElement("script");
    s.src = KATEX_JS; s.async = true;
    s.onload = () => (window.katex ? resolve(window.katex) : reject(new Error("katex global missing")));
    s.onerror = () => reject(new Error("failed to load KaTeX from CDN"));
    document.head.appendChild(s);
  });
  return loadPromise;
}

// Safe render to an HTML string. SECURITY (§10.4): trust:false — no \href/\url.
// Returns null on failure so callers can fall back to plain-text display.
export function renderLatex(katex, latex) {
  try {
    return katex.renderToString(latex, { displayMode: true, throwOnError: true, trust: false });
  } catch {
    return null;
  }
}
```

- [ ] **Step 2: Write ParametersPanel.jsx**

Create `src/components/calculate/workbench/ParametersPanel.jsx`:

```jsx
import { useTheme } from "../../../ThemeContext.jsx";

const mono = "'IBM Plex Mono', monospace";

// Shared slider pool for one session. Each detected symbol is either a
// Parameter (slider, fixed value) or a Choice variable (optimized over).
// Props:
//   detectedSymbols : string[]  — union of free symbols across all cards minus axes
//   params          : [{name,value,min,max,step}]
//   choiceVars      : string[]
//   onParamChange   : (name, patch) => void
//   onToggleRole    : (name) => void   // Parameter <-> Choice var
export default function ParametersPanel({ detectedSymbols, params, choiceVars, onParamChange, onToggleRole }) {
  const { C } = useTheme();
  const paramMap = Object.fromEntries(params.map((p) => [p.name, p]));

  if (!detectedSymbols.length) {
    return (
      <div style={{ fontFamily: mono, fontSize: 11, color: C.textDim || "#888", padding: "8px 0" }}>
        Parameters appear here once an equation has free symbols.
      </div>
    );
  }

  return (
    <div style={{ fontFamily: mono, marginTop: 12 }}>
      <div style={{ fontSize: 9, color: C.gold, letterSpacing: "0.22em", textTransform: "uppercase", marginBottom: 8 }}>
        Parameters
      </div>
      {detectedSymbols.map((sym) => {
        const isChoice = choiceVars.includes(sym);
        const p = paramMap[sym] || { name: sym, value: 1, min: 0, max: 10, step: 0.1 };
        return (
          <div key={sym} style={{ marginBottom: 10, opacity: isChoice ? 0.6 : 1 }}>
            <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 3 }}>
              <span style={{ fontSize: 12, color: C.teal, minWidth: 34 }}>{sym}</span>
              <button onClick={() => onToggleRole(sym)}
                title="Toggle Parameter / Choice variable"
                style={{ fontSize: 9, padding: "2px 6px", borderRadius: 4, cursor: "pointer",
                  background: "transparent", color: isChoice ? C.gold : C.blue,
                  border: `1px solid ${isChoice ? C.gold : C.blue}` }}>
                {isChoice ? "choice var" : "parameter"}
              </button>
              {!isChoice && (
                <span style={{ fontSize: 12, color: C.text, marginLeft: "auto" }}>
                  {Number(p.value).toFixed(2)}
                </span>
              )}
            </div>
            {!isChoice && (
              <input type="range" min={p.min} max={p.max} step={p.step} value={p.value}
                onChange={(e) => onParamChange(sym, { value: Number(e.target.value) })}
                style={{ width: "100%", accentColor: C.teal }} />
            )}
          </div>
        );
      })}
    </div>
  );
}
```

- [ ] **Step 3: Lint**

Run: `npx eslint src/components/calculate/workbench/katexLoader.js src/components/calculate/workbench/ParametersPanel.jsx`
Expected: no output.

- [ ] **Step 4: Commit**

```bash
git add src/components/calculate/workbench/katexLoader.js src/components/calculate/workbench/ParametersPanel.jsx
git commit -m "feat(workbench): KaTeX loader helper + shared parameter/choice-var slider pool"
```

> No standalone browser check here — these are leaf components wired up and validated in Task 5 (parameters) and Task 8 (KaTeX render).

---

### Task 5: Equation cards + template library + panel wiring

The card UI (expr input, axis selector, op toggles, sense, copy-LaTeX), the template seed library, and the wiring that renders EquationsPanel + ParametersPanel inside the Workbench left column with live symbol detection.

**Files:**
- Create: `src/components/calculate/workbench/templates.js`
- Create: `src/components/calculate/workbench/EquationCard.jsx`
- Create: `src/components/calculate/workbench/EquationsPanel.jsx`
- Modify: `src/components/calculate/workbench/Workbench.jsx` (render panels, derive detected symbols)

- [ ] **Step 1: Write templates.js**

Create `src/components/calculate/workbench/templates.js`. Each template is a partial equation seed merged through `newEquation`.

```js
// Card-seed library migrated from the old Math Pad. Each entry is a partial
// equation spec; EquationsPanel merges it through newEquation().
export const TEMPLATES = [
  { group: "Production", label: "Cobb-Douglas Y", seed: {
      label: "Y", expr: "A*K^alpha*L^(1-alpha)", axis: "K",
      ops: { plot: true, deriv: true, integral: false, solveZero: false, optimize: false } } },
  { group: "Production", label: "Solow output/worker", seed: {
      label: "y", expr: "A*k^alpha", axis: "k",
      ops: { plot: true, deriv: true, integral: false, solveZero: false, optimize: false } } },
  { group: "Profit", label: "Profit π(q)", seed: {
      label: "pi", expr: "(a - b*q)*q - F - c*q", axis: "q",
      ops: { plot: true, deriv: true, integral: false, solveZero: false, optimize: true }, sense: "max" } },
  { group: "Utility", label: "Cobb-Douglas U", seed: {
      label: "U", expr: "x^a*y^(1-a)", axis: "x",
      ops: { plot: true, deriv: true, integral: false, solveZero: false, optimize: false } } },
  { group: "Cost", label: "Marginal damage ∫MD", seed: {
      label: "MD", expr: "d*E", axis: "E",
      ops: { plot: true, deriv: false, integral: true, solveZero: false, optimize: false } } },
  { group: "Constraint", label: "Budget p·x+q·y=m", seed: {
      kind: "constraint", label: "budget",
      relation: { lhs: "p*x + q*y", op: "=", rhs: "m" },
      ops: { plot: false, deriv: false, integral: false, solveZero: false, optimize: false } } },
  { group: "Constraint", label: "Emissions cap E≤cap", seed: {
      kind: "constraint", label: "cap",
      relation: { lhs: "E", op: "=", rhs: "cap" },
      ops: { plot: false, deriv: false, integral: false, solveZero: false, optimize: false } } },
];
```

- [ ] **Step 2: Write EquationCard.jsx**

Create `src/components/calculate/workbench/EquationCard.jsx`:

```jsx
import { useState } from "react";
import { useTheme } from "../../../ThemeContext.jsx";
import { cas } from "../../../math/cas/casAdapter.js";

const mono = "'IBM Plex Mono', monospace";
const OPS = [
  { key: "plot", glyph: "▦", title: "Plot curve" },
  { key: "deriv", glyph: "f′", title: "Symbolic derivative" },
  { key: "integral", glyph: "∫", title: "Definite integral" },
  { key: "solveZero", glyph: "=0", title: "Solve f(x)=0" },
  { key: "optimize", glyph: "◇", title: "Optimize" },
];

// One equation/constraint card. Props:
//   eq, index, symbolsOf(eq)->string[], onPatch(patch), onRemove()
export default function EquationCard({ eq, index, onPatch, onRemove }) {
  const { C } = useTheme();
  const [copied, setCopied] = useState(false);
  const accent = [C.teal, C.gold, C.blue][index % 3];
  const isConstraint = eq.kind === "constraint";

  // Free symbols of the expr/relation, for the axis dropdown (objectives only).
  let symbols = [];
  try {
    const src = isConstraint ? `(${eq.relation.lhs}) - (${eq.relation.rhs})` : eq.expr;
    if (src && src.trim()) symbols = cas.freeSymbols(src);
  } catch { symbols = []; }

  function copyLatex() {
    try {
      const src = isConstraint ? `(${eq.relation.lhs}) - (${eq.relation.rhs})` : eq.expr;
      const latex = cas.toLatex(src);
      navigator.clipboard?.writeText(latex);
      setCopied(true); setTimeout(() => setCopied(false), 1200);
    } catch { /* ignore */ }
  }

  return (
    <div style={{ border: `1px solid ${accent}55`, borderLeft: `3px solid ${accent}`,
      borderRadius: 8, padding: "10px 12px", marginBottom: 10, fontFamily: mono }}>

      <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 8 }}>
        <input value={eq.label} onChange={(e) => onPatch({ label: e.target.value.slice(0, 24) })}
          style={{ width: 54, background: C.bg, color: accent, border: `1px solid ${C.line || "#222"}`,
            fontFamily: mono, fontSize: 12, padding: "3px 5px" }} />
        <span style={{ fontSize: 11, color: C.textDim || "#888" }}>{isConstraint ? "s.t." : "="}</span>

        {isConstraint ? (
          <div style={{ display: "flex", alignItems: "center", gap: 4, flex: 1 }}>
            <input value={eq.relation.lhs} placeholder="p*x + q*y"
              onChange={(e) => onPatch({ relation: { ...eq.relation, lhs: e.target.value.slice(0, 256) } })}
              style={inp(C)} />
            <span style={{ color: C.text }}>=</span>
            <input value={eq.relation.rhs} placeholder="m"
              onChange={(e) => onPatch({ relation: { ...eq.relation, rhs: e.target.value.slice(0, 256) } })}
              style={inp(C)} />
          </div>
        ) : (
          <input value={eq.expr} placeholder="A*K^alpha*L^(1-alpha)"
            onChange={(e) => onPatch({ expr: e.target.value.slice(0, 512) })}
            style={{ ...inp(C), flex: 1 }} />
        )}

        <button onClick={onRemove} title="Remove card"
          style={{ color: C.red || "#c86e6e", background: "transparent", border: "none", cursor: "pointer", fontSize: 14 }}>×</button>
      </div>

      {!isConstraint && (
        <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
          <label style={{ fontSize: 10, color: C.textDim || "#888" }}>axis</label>
          <select value={eq.axis} onChange={(e) => onPatch({ axis: e.target.value })}
            style={{ background: C.bg, color: C.text, border: `1px solid ${C.line || "#222"}`, fontFamily: mono, fontSize: 11, padding: "2px 4px" }}>
            <option value="">—</option>
            {symbols.map((s) => <option key={s} value={s}>{s}</option>)}
          </select>

          {OPS.map((op) => {
            const on = !!eq.ops[op.key];
            return (
              <button key={op.key} title={op.title}
                onClick={() => onPatch({ ops: { ...eq.ops, [op.key]: !on } })}
                style={{ fontSize: 11, padding: "3px 7px", borderRadius: 4, cursor: "pointer",
                  background: on ? accent + "22" : "transparent", color: on ? accent : C.textDim || "#888",
                  border: `1px solid ${on ? accent : C.line || "#222"}` }}>
                {op.glyph}
              </button>
            );
          })}

          {eq.ops.optimize && (
            <button onClick={() => onPatch({ sense: eq.sense === "max" ? "min" : "max" })}
              style={{ fontSize: 10, padding: "3px 7px", borderRadius: 4, cursor: "pointer",
                background: "transparent", color: C.gold, border: `1px solid ${C.gold}` }}>
              {eq.sense}
            </button>
          )}

          <button onClick={copyLatex} title="Copy LaTeX"
            style={{ fontSize: 10, padding: "3px 7px", borderRadius: 4, marginLeft: "auto", cursor: "pointer",
              background: "transparent", color: copied ? C.teal : C.textDim || "#888", border: `1px solid ${C.line || "#222"}` }}>
            {copied ? "copied" : "LaTeX"}
          </button>
        </div>
      )}
    </div>
  );
}

function inp(C) {
  return { background: C.bg, color: C.text, border: `1px solid ${C.line || "#222"}`,
    fontFamily: mono, fontSize: 12, padding: "3px 5px", minWidth: 60 };
}
```

- [ ] **Step 3: Write EquationsPanel.jsx**

Create `src/components/calculate/workbench/EquationsPanel.jsx`:

```jsx
import { useState } from "react";
import { useTheme } from "../../../ThemeContext.jsx";
import EquationCard from "./EquationCard.jsx";
import { TEMPLATES } from "./templates.js";
import { newEquation } from "./workbenchStore.js";

const mono = "'IBM Plex Mono', monospace";

// Props: equations[], onAdd(eq), onPatch(id, patch), onRemove(id)
export default function EquationsPanel({ equations, onAdd, onPatch, onRemove }) {
  const { C } = useTheme();
  const [showTemplates, setShowTemplates] = useState(false);

  return (
    <div style={{ fontFamily: mono }}>
      <div style={{ display: "flex", gap: 8, marginBottom: 10 }}>
        <button onClick={() => onAdd(newEquation())}
          style={btn(C, C.teal)}>+ Equation</button>
        <button onClick={() => onAdd(newEquation({ kind: "constraint", label: "g" }))}
          style={btn(C, C.blue)}>+ Constraint</button>
        <button onClick={() => setShowTemplates((v) => !v)}
          style={btn(C, C.gold)}>{showTemplates ? "Hide" : "Templates"}</button>
      </div>

      {showTemplates && (
        <div style={{ border: `1px solid ${C.line || "#222"}`, borderRadius: 8, padding: 10, marginBottom: 12 }}>
          {Object.entries(groupBy(TEMPLATES)).map(([group, items]) => (
            <div key={group} style={{ marginBottom: 8 }}>
              <div style={{ fontSize: 9, color: C.gold, letterSpacing: "0.2em", textTransform: "uppercase", marginBottom: 4 }}>{group}</div>
              <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
                {items.map((t) => (
                  <button key={t.label}
                    onClick={() => { onAdd(newEquation(t.seed)); setShowTemplates(false); }}
                    style={{ fontSize: 11, padding: "3px 8px", borderRadius: 4, cursor: "pointer",
                      background: "transparent", color: C.text, border: `1px solid ${C.line || "#333"}` }}>
                    {t.label}
                  </button>
                ))}
              </div>
            </div>
          ))}
        </div>
      )}

      {equations.length === 0 && (
        <div style={{ fontSize: 11, color: C.textDim || "#888", padding: "6px 0" }}>
          Add an equation or pick a template to begin.
        </div>
      )}

      {equations.map((eq, i) => (
        <EquationCard key={eq.id} eq={eq} index={i}
          onPatch={(patch) => onPatch(eq.id, patch)}
          onRemove={() => onRemove(eq.id)} />
      ))}
    </div>
  );
}

function groupBy(arr) {
  const out = {};
  for (const t of arr) (out[t.group] = out[t.group] || []).push(t);
  return out;
}
function btn(C, color) {
  return { fontSize: 11, padding: "5px 10px", borderRadius: 6, cursor: "pointer",
    background: "transparent", color, border: `1px solid ${color}`, fontFamily: mono };
}
```

- [ ] **Step 4: Wire panels into Workbench.jsx**

In `src/components/calculate/workbench/Workbench.jsx`, add imports near the top:

```jsx
import EquationsPanel from "./EquationsPanel.jsx";
import ParametersPanel from "./ParametersPanel.jsx";
import { cas } from "../../../math/cas/casAdapter.js";
```

Add session-mutation helpers inside the component (after `updateActive` is defined):

```jsx
  // Equation CRUD on the active session.
  const addEquation = useCallback((eq) =>
    updateActive((s) => ({ ...s, equations: [...s.equations, eq] })), [updateActive]);
  const patchEquation = useCallback((id, patch) =>
    updateActive((s) => ({ ...s, equations: s.equations.map((e) => (e.id === id ? { ...e, ...patch } : e)) })), [updateActive]);
  const removeEquation = useCallback((id) =>
    updateActive((s) => ({ ...s, equations: s.equations.filter((e) => e.id !== id) })), [updateActive]);

  // Detected free symbols across all cards, minus each objective's axis.
  function detectSymbols(session) {
    const axes = new Set(session.equations.filter((e) => e.kind !== "constraint").map((e) => e.axis).filter(Boolean));
    const set = new Set();
    for (const e of session.equations) {
      const src = e.kind === "constraint"
        ? `(${e.relation.lhs}) - (${e.relation.rhs})`
        : e.expr;
      if (!src || !src.trim()) continue;
      try { for (const sym of cas.freeSymbols(src)) set.add(sym); } catch { /* skip */ }
    }
    for (const a of axes) set.delete(a);
    return Array.from(set).sort();
  }

  // Parameter slider + role toggle.
  const onParamChange = useCallback((name, patch) =>
    updateActive((s) => {
      const exists = s.params.some((p) => p.name === name);
      const params = exists
        ? s.params.map((p) => (p.name === name ? { ...p, ...patch } : p))
        : [...s.params, { name, value: 1, min: 0, max: 10, step: 0.1, ...patch }];
      return { ...s, params };
    }), [updateActive]);
  const onToggleRole = useCallback((name) =>
    updateActive((s) => {
      const isChoice = s.choiceVars.includes(name);
      return { ...s, choiceVars: isChoice ? s.choiceVars.filter((v) => v !== name) : [...s.choiceVars, name] };
    }), [updateActive]);
```

Replace the left-column placeholder `<div data-wb-left>…</div>` with:

```jsx
        <div data-wb-left>
          <EquationsPanel
            equations={active.equations}
            onAdd={addEquation} onPatch={patchEquation} onRemove={removeEquation} />
          <ParametersPanel
            detectedSymbols={detectSymbols(active)}
            params={active.params} choiceVars={active.choiceVars}
            onParamChange={onParamChange} onToggleRole={onToggleRole} />
        </div>
```

Remove the now-unused hidden `<span … data-wb-active … ref={() => void updateActive} />` line added in Task 3 (the CRUD helpers reference `updateActive`, so the lint-quieting hack is no longer needed).

- [ ] **Step 5: Lint**

Run: `npx eslint src/components/calculate/workbench/`
Expected: no output.

- [ ] **Step 6: Franco validates in browser**

`npm run dev`, Calculate tab:
1. Click **Templates** → pick **Cobb-Douglas Y** → a teal card appears with `Y = A*K^alpha*L^(1-alpha)`, axis pre-set to `K`, plot+deriv toggles lit.
2. The **Parameters** section below shows sliders for `A`, `L`, `alpha` (not `K` — it's the axis). Drag one → value updates.
3. Click the **parameter / choice var** toggle on `K`'s row… (note `K` is the axis so it won't appear; toggle one that does, e.g. add a second card `U = x^a*y^(1-a)` and toggle `y`) → it flips to "choice var" and its slider disappears.
4. **+ Constraint** → a blue card with `g  s.t.  [lhs] = [rhs]` inputs.
5. Click **LaTeX** on a card → "copied" flashes; paste elsewhere to confirm valid LaTeX.
6. Reload → cards + parameter values persist.

- [ ] **Step 7: Commit**

```bash
git add src/components/calculate/workbench/
git commit -m "feat(workbench): equation/constraint cards + template library + shared param pool wiring"
```

---

### Task 6: `operations.js` — card → engine → §5.6 result contract

A pure-JS module (no React, harness-testable) that takes one equation card + the session's parameter scope and produces the dual symbolic+numeric result contract for each active op. This is the consumption boundary between the UI and the Plan 1 engine; isolating it keeps the engine wiring testable without rendering.

**Files:**
- Create: `src/components/calculate/workbench/operations.js`
- Create: `src/math/__validation__/workbenchOpsValidation.js`
- Modify: `src/main.jsx` (register harness)

- [ ] **Step 1: Write operations.js**

Create `src/components/calculate/workbench/operations.js`:

```js
// Pure-JS bridge: equation card + parameter scope -> §5.6 result contracts.
// No React. All symbolic work via cas.*; numeric fallback via calcEngine.
// SECURITY (§10.1/§10.2): user expressions only ever reach cas.* (nerdamer's
// parser) and cas.compile (nerdamer buildFunction) — never an app-side compile.
import { cas, buildOpResult } from "../../../math/cas/casAdapter.js";
import { optimizeUnconstrained, optimizeConstrained } from "../../../math/calcEngine.js";

// Build a numeric scope { name: value } from the param pool.
export function paramScope(params) {
  const scope = {};
  for (const p of params) scope[p.name] = p.value;
  return scope;
}

// Sample a compiled fn over [a,b] at n points, holding params fixed.
// Returns [{x, y}] skipping non-finite y. axis is the swept symbol.
export function sampleCurve(expr, axis, freeVars, scope, [a, b], n = 240) {
  let f;
  try { f = cas.compile(expr, freeVars); } catch { return []; }
  const pts = [];
  const dx = (b - a) / (n - 1);
  for (let i = 0; i < n; i++) {
    const x = a + i * dx;
    let y;
    try { y = f({ ...scope, [axis]: x }); } catch { y = NaN; }
    if (Number.isFinite(y)) pts.push({ x, y });
  }
  return pts;
}

// ── Per-op result builders ────────────────────────────────────────────────────

export function runPlot(eq, scope, view) {
  const freeVars = safeFree(eq.expr);
  const points = eq.axis ? sampleCurve(eq.expr, eq.axis, freeVars, scope, view.xRange) : [];
  return buildOpResult("plot", { symbolicExpr: eq.expr, numeric: { points }, closed: true });
}

export function runDeriv(eq, scope, view) {
  if (!eq.axis) return buildOpResult("deriv", { symbolicExpr: null, numeric: {}, closed: false, error: "no axis" });
  let d;
  try { d = cas.diff(eq.expr, eq.axis); } catch (e) {
    return buildOpResult("deriv", { symbolicExpr: null, numeric: {}, closed: false, error: String(e?.message || e) });
  }
  const freeVars = safeFree(d);
  const points = sampleCurve(d, eq.axis, freeVars, scope, view.xRange);
  return buildOpResult("deriv", { symbolicExpr: d, numeric: { points }, closed: true });
}

export function runIntegral(eq, scope, view) {
  // Numeric definite integral (trapezoid) over the visible range; symbolic
  // antiderivative is best-effort (nerdamer integration is a known weak spot).
  const [a, b] = view.xRange;
  const pts = eq.axis ? sampleCurve(eq.expr, eq.axis, safeFree(eq.expr), scope, [a, b]) : [];
  let area = 0;
  for (let i = 1; i < pts.length; i++) area += (pts[i].x - pts[i - 1].x) * (pts[i].y + pts[i - 1].y) / 2;
  let anti = null, closed = false;
  try { anti = cas.parse(`integrate(${eq.expr}, ${eq.axis})`); closed = true; } catch { /* numeric only */ }
  return buildOpResult("integral", {
    symbolicExpr: closed ? anti : null,
    numeric: { value: area, a, b, points: pts },
    closed,
    error: null,
  });
}

export function runSolveZero(eq, scope, view) {
  if (!eq.axis) return buildOpResult("solveZero", { symbolicExpr: null, numeric: {}, closed: false, error: "no axis" });
  const sol = cas.solve(eq.expr, eq.axis); // { closed, solutions:[{[axis]: expr}] }
  // Numeric roots within the visible range, evaluating each symbolic root at scope.
  const roots = [];
  if (sol.closed) {
    for (const s of sol.solutions) {
      try {
        const v = cas.evalAt(s[eq.axis], scope);
        if (Number.isFinite(v) && v >= view.xRange[0] && v <= view.xRange[1]) roots.push(v);
      } catch { /* skip non-numeric root */ }
    }
  }
  return buildOpResult("solveZero", {
    symbolicExpr: sol.closed ? eq.expr : null,
    numeric: { roots, solutions: sol.solutions },
    closed: sol.closed,
    error: sol.closed ? null : "no closed-form root",
  });
}

export function runOptimize(eq, session, scope) {
  const constraints = session.equations.filter((e) => e.kind === "constraint");
  if (constraints.length === 0) return runOptimizeA(eq, session, scope);
  return runOptimizeC(eq, session, constraints, scope);
}

// Unconstrained (A): symbolic FOC, numeric scan+Newton fallback.
function runOptimizeA(eq, session, scope) {
  const axis = eq.axis;
  if (!axis) return buildOpResult("optimize", { symbolicExpr: null, numeric: {}, closed: false, error: "no axis" });
  let fp = null, symbolicClosed = false, foc = null;
  try { fp = cas.diff(eq.expr, axis); foc = cas.solve(fp, axis); symbolicClosed = foc.closed; } catch { /* fall to numeric */ }

  // Numeric optimum over the visible range, params fixed.
  let f;
  try { f = cas.compile(eq.expr, safeFree(eq.expr)); } catch {
    return buildOpResult("optimize", { symbolicExpr: fp, numeric: {}, closed: false, error: "compile failed" });
  }
  const fn = (x) => f({ ...scope, [axis]: x });
  const [a, b] = session.view.xRange;
  const r = optimizeUnconstrained(fn, a, b, eq.sense);
  return buildOpResult("optimize", {
    symbolicExpr: fp,
    numeric: { mode: "unconstrained", x: r.x, value: r.value, kind: r.kind, foc: foc?.solutions ?? [] },
    closed: symbolicClosed,
    error: null,
  });
}

// Constrained (C): Lagrangian FOC; symbolic system + numeric solveSystem fallback.
function runOptimizeC(eq, session, constraints, scope) {
  const choiceVars = session.choiceVars.length
    ? session.choiceVars
    : Array.from(new Set(constraints.flatMap((c) => safeFree(`(${c.relation.lhs}) - (${c.relation.rhs})`)))).slice(0, 2);
  const gExprs = constraints.map((c) => `(${c.relation.lhs}) - (${c.relation.rhs})`);
  const foc = cas.lagrangianFOC(eq.expr, gExprs, choiceVars); // { L, equations, multipliers }

  // Symbolic system solve (best effort).
  let symbolicClosed = false, symbolicSol = [];
  try {
    const sys = cas.solveSystem(foc.equations, [...choiceVars, ...foc.multipliers]);
    symbolicClosed = sys.closed; symbolicSol = sys.solutions;
  } catch { /* numeric fallback below */ }

  // Numeric fallback through calcEngine.optimizeConstrained.
  let numeric = {};
  try {
    const r = optimizeConstrained(eq.expr, gExprs, choiceVars, scope);
    numeric = r.error
      ? { mode: "constrained", error: r.error }
      : { mode: "constrained", choices: r.choices, multipliers: r.multipliers, objectiveValue: r.objectiveValue };
  } catch (e) { numeric = { mode: "constrained", error: String(e?.message || e) }; }

  return buildOpResult("optimize", {
    symbolicExpr: foc.L,
    numeric: { ...numeric, multiplierNames: foc.multipliers, choiceVars, symbolicSolutions: symbolicSol },
    closed: symbolicClosed,
    error: null,
  });
}

// Run every active op on a card; returns { [op]: ResultContract }.
export function runCard(eq, session) {
  const scope = paramScope(session.params);
  const out = {};
  if (eq.kind === "constraint") return out; // constraints contribute to optimize only
  if (eq.ops.plot)      out.plot      = runPlot(eq, scope, session.view);
  if (eq.ops.deriv)     out.deriv     = runDeriv(eq, scope, session.view);
  if (eq.ops.integral)  out.integral  = runIntegral(eq, scope, session.view);
  if (eq.ops.solveZero) out.solveZero = runSolveZero(eq, scope, session.view);
  if (eq.ops.optimize)  out.optimize  = runOptimize(eq, session, scope);
  return out;
}

function safeFree(expr) {
  try { return cas.freeSymbols(expr); } catch { return []; }
}
```

- [ ] **Step 2: Write the ops harness**

Create `src/math/__validation__/workbenchOpsValidation.js`:

```js
// Browser harness for workbench operations.js. Needs cas.ready() (nerdamer CDN).
// Exposes window.__validation.workbenchOps() -> Promise<{cells, allPass}>.
import { cas } from "../cas/casAdapter.js";
import { newSession, newEquation } from "../../components/calculate/workbench/workbenchStore.js";
import { runCard } from "../../components/calculate/workbench/operations.js";

const approx = (a, b, tol = 1e-3) => Math.abs(a - b) <= tol;

export async function runWorkbenchOpsValidation() {
  await cas.ready();
  const cells = [];

  // Cell 1: plot of Y=A*K^a*L^(1-a) yields finite points; deriv ∂Y/∂K closed.
  {
    const s = newSession({
      params: [{ name: "A", value: 1 }, { name: "L", value: 9 }, { name: "alpha", value: 0.3 }],
      view: { xRange: [0.5, 8], positiveQuad: true },
    });
    const eq = newEquation({ label: "Y", expr: "A*K^alpha*L^(1-alpha)", axis: "K",
      ops: { plot: true, deriv: true, integral: false, solveZero: false, optimize: false } });
    const res = runCard(eq, { ...s, equations: [eq] });
    const pass = res.plot.numeric.points.length > 100
      && res.deriv.symbolic.closed === true
      && approx(res.deriv.numeric.points.find((p) => approx(p.x, 4, 0.05))?.y ?? NaN, 0.529231, 1e-2);
    cells.push({ name: "plot+deriv-MPK", expected: "MPK(4)≈0.529", got: { n: res.plot.numeric.points.length, deriv: res.deriv.symbolic.latex }, pass });
  }

  // Cell 2: solveZero on x^2-4 finds root 2 in [0,5].
  {
    const eq = newEquation({ expr: "x^2-4", axis: "x", ops: { plot: false, deriv: false, integral: false, solveZero: true, optimize: false } });
    const s = newSession({ view: { xRange: [0, 5], positiveQuad: true }, equations: [eq] });
    const res = runCard(eq, s);
    const pass = res.solveZero.symbolic.closed === true && res.solveZero.numeric.roots.some((r) => approx(r, 2));
    cells.push({ name: "solveZero-x2-4", expected: "root 2", got: res.solveZero.numeric.roots, pass });
  }

  // Cell 3: unconstrained optimize of 4*sqrt(K)-K-2 → K*≈4, max.
  {
    const eq = newEquation({ expr: "4*sqrt(K)-K-2", axis: "K", sense: "max",
      ops: { plot: false, deriv: false, integral: false, solveZero: false, optimize: true } });
    const s = newSession({ view: { xRange: [0.01, 20], positiveQuad: true }, equations: [eq] });
    const res = runCard(eq, s);
    const pass = approx(res.optimize.numeric.x, 4, 1e-2) && res.optimize.numeric.kind === "max";
    cells.push({ name: "optimizeA-profit", expected: "K*≈4 max", got: res.optimize.numeric, pass });
  }

  // Cell 4: constrained optimize x^0.4*y^0.6 s.t. 2x+5y=100 → x≈20,y≈12.
  {
    const obj = newEquation({ expr: "x^0.4*y^0.6", axis: "x",
      ops: { plot: false, deriv: false, integral: false, solveZero: false, optimize: true } });
    const con = newEquation({ kind: "constraint", label: "b",
      relation: { lhs: "2*x+5*y", op: "=", rhs: "100" } });
    const s = newSession({ choiceVars: ["x", "y"], equations: [obj, con] });
    const res = runCard(obj, s);
    const c = res.optimize.numeric.choices || {};
    const pass = approx(c.x, 20, 1e-1) && approx(c.y, 12, 1e-1);
    cells.push({ name: "optimizeC-utility", expected: "x≈20,y≈12", got: res.optimize.numeric, pass });
  }

  // Cell 5: integral of x^2 over [0,1] ≈ 0.333 (numeric trapezoid).
  {
    const eq = newEquation({ expr: "x^2", axis: "x", ops: { plot: false, deriv: false, integral: true, solveZero: false, optimize: false } });
    const s = newSession({ view: { xRange: [0, 1], positiveQuad: true }, equations: [eq] });
    const res = runCard(eq, s);
    const pass = approx(res.integral.numeric.value, 0.3333, 1e-2);
    cells.push({ name: "integral-x2", expected: "≈0.333", got: res.integral.numeric.value, pass });
  }

  const allPass = cells.every((c) => c.pass);
  return { cells, allPass };
}

if (typeof window !== "undefined") {
  window.__validation = window.__validation || {};
  window.__validation.workbenchOps = runWorkbenchOpsValidation;
}
```

- [ ] **Step 3: Register in main.jsx**

In `src/main.jsx`, extend the DEV block to also import the ops harness:

```js
if (import.meta.env.DEV) {
  // Self-registers window.__validation.workbench() for in-browser symbolic-engine checks.
  import('./math/__validation__/workbenchEngineValidation.js')
  // Self-registers window.__validation.workbenchStore() for session-store shape checks.
  import('./math/__validation__/workbenchStoreValidation.js')
  // Self-registers window.__validation.workbenchOps() for card→engine→result checks.
  import('./math/__validation__/workbenchOpsValidation.js')
}
```

- [ ] **Step 4: Lint**

Run: `npx eslint src/components/calculate/workbench/operations.js src/math/__validation__/workbenchOpsValidation.js`
Expected: no output.

- [ ] **Step 5: Franco validates in browser**

`npm run dev`, open console, run:

```js
await window.__validation.workbenchOps()
```

Expected: `{ cells: Array(5), allPass: true }`. Confirm every cell `pass: true` — these mirror the Plan 1 engine ground truths (MPK 0.529231, profit K*=4, utility x*=20/y*=12) routed through the operations layer.

- [ ] **Step 6: Commit**

```bash
git add src/components/calculate/workbench/operations.js src/math/__validation__/workbenchOpsValidation.js src/main.jsx
git commit -m "feat(workbench): operations layer — card→cas/calcEngine→§5.6 result contract + harness"
```

---

### Task 7: WorkbenchCanvas — live plotting

A raw `<canvas>` plotter (same primitive as the existing `FunctionGrapher`) that draws each card's plot curve, the dashed f′ overlay, integral area shading, and root/optimum markers — recomputing live from the operations layer whenever cards or sliders change.

**Files:**
- Create: `src/components/calculate/workbench/WorkbenchCanvas.jsx`
- Modify: `src/components/calculate/workbench/Workbench.jsx` (compute results, render canvas + right column)

- [ ] **Step 1: Write WorkbenchCanvas.jsx**

Create `src/components/calculate/workbench/WorkbenchCanvas.jsx`:

```jsx
import { useRef, useEffect } from "react";
import { useTheme } from "../../../ThemeContext.jsx";

const mono = "'IBM Plex Mono', monospace";

// Draws plot curves + f′ overlays + integral shading + markers for a session.
// Props: equations[], results { [eqId]: { [op]: contract } }, view
export default function WorkbenchCanvas({ equations, results, view }) {
  const { C } = useTheme();
  const canvasRef = useRef(null);
  const wrapRef = useRef(null);

  useEffect(() => {
    const canvas = canvasRef.current, wrap = wrapRef.current;
    if (!canvas || !wrap) return;
    const ro = new ResizeObserver(() => draw());
    ro.observe(wrap);
    draw();
    return () => ro.disconnect();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [equations, results, view, C]);

  function draw() {
    const canvas = canvasRef.current, wrap = wrapRef.current;
    if (!canvas || !wrap) return;
    const dpr = window.devicePixelRatio || 1;
    const W = wrap.clientWidth, H = 320;
    canvas.width = W * dpr; canvas.height = H * dpr;
    canvas.style.width = W + "px"; canvas.style.height = H + "px";
    const ctx = canvas.getContext("2d");
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, W, H);

    const pad = { l: 44, r: 14, t: 14, b: 28 };
    const plotW = W - pad.l - pad.r, plotH = H - pad.t - pad.b;

    // Collect all curves to derive Y-range.
    const objectives = equations.filter((e) => e.kind !== "constraint");
    const allPts = [];
    for (const eq of objectives) {
      const r = results[eq.id];
      if (r?.plot?.numeric?.points) allPts.push(...r.plot.numeric.points);
    }
    const [x0, x1] = view.xRange;
    let y0 = Infinity, y1 = -Infinity;
    for (const p of allPts) { if (p.y < y0) y0 = p.y; if (p.y > y1) y1 = p.y; }
    if (!Number.isFinite(y0) || !Number.isFinite(y1) || y0 === y1) { y0 = -1; y1 = 1; }
    const padY = (y1 - y0) * 0.08; y0 -= padY; y1 += padY;

    const sx = (x) => pad.l + ((x - x0) / (x1 - x0)) * plotW;
    const sy = (y) => pad.t + (1 - (y - y0) / (y1 - y0)) * plotH;

    // Axes.
    ctx.strokeStyle = C.line || "#222"; ctx.lineWidth = 1;
    ctx.beginPath(); ctx.moveTo(pad.l, pad.t); ctx.lineTo(pad.l, pad.t + plotH); ctx.lineTo(pad.l + plotW, pad.t + plotH); ctx.stroke();
    if (y0 < 0 && y1 > 0) { const yz = sy(0); ctx.strokeStyle = (C.line || "#222"); ctx.beginPath(); ctx.moveTo(pad.l, yz); ctx.lineTo(pad.l + plotW, yz); ctx.stroke(); }
    ctx.fillStyle = C.textDim || "#888"; ctx.font = `10px ${mono}`;
    ctx.fillText(y1.toFixed(2), 4, pad.t + 8);
    ctx.fillText(y0.toFixed(2), 4, pad.t + plotH);
    ctx.fillText(String(x0), pad.l, H - 8);
    ctx.fillText(String(x1), pad.l + plotW - 18, H - 8);

    const palette = [C.teal, C.gold, C.blue];

    objectives.forEach((eq, i) => {
      const color = palette[i % 3];
      const r = results[eq.id];
      if (!r) return;

      // Integral shading (under curve, gold-tinted) first so curves sit on top.
      if (r.integral?.numeric?.points?.length) {
        ctx.fillStyle = (C.gold || "#c8a96e") + "22";
        const pts = r.integral.numeric.points;
        ctx.beginPath(); ctx.moveTo(sx(pts[0].x), sy(0));
        for (const p of pts) ctx.lineTo(sx(p.x), sy(p.y));
        ctx.lineTo(sx(pts[pts.length - 1].x), sy(0)); ctx.closePath(); ctx.fill();
      }

      // Plot curve.
      if (r.plot?.numeric?.points?.length) {
        ctx.strokeStyle = color; ctx.lineWidth = 1.6; ctx.beginPath();
        r.plot.numeric.points.forEach((p, k) => { const X = sx(p.x), Y = sy(p.y); k ? ctx.lineTo(X, Y) : ctx.moveTo(X, Y); });
        ctx.stroke();
      }

      // f′ dashed overlay.
      if (r.deriv?.numeric?.points?.length) {
        ctx.strokeStyle = color; ctx.lineWidth = 1; ctx.setLineDash([4, 3]); ctx.globalAlpha = 0.7; ctx.beginPath();
        r.deriv.numeric.points.forEach((p, k) => { const X = sx(p.x), Y = sy(p.y); k ? ctx.lineTo(X, Y) : ctx.moveTo(X, Y); });
        ctx.stroke(); ctx.setLineDash([]); ctx.globalAlpha = 1;
      }

      // Root markers (red circles).
      if (r.solveZero?.numeric?.roots?.length) {
        ctx.strokeStyle = C.red || "#c86e6e"; ctx.lineWidth = 1.4;
        for (const root of r.solveZero.numeric.roots) {
          ctx.beginPath(); ctx.arc(sx(root), sy(0), 4, 0, Math.PI * 2); ctx.stroke();
        }
      }

      // Optimum marker (filled red dot) for unconstrained optimize.
      const opt = r.optimize?.numeric;
      if (opt && opt.mode === "unconstrained" && Number.isFinite(opt.x) && Number.isFinite(opt.value)) {
        ctx.fillStyle = C.red || "#c86e6e";
        ctx.beginPath(); ctx.arc(sx(opt.x), sy(opt.value), 4.5, 0, Math.PI * 2); ctx.fill();
      }
    });
  }

  const hasObjective = equations.some((e) => e.kind !== "constraint");
  return (
    <div ref={wrapRef} style={{ width: "100%", fontFamily: mono }}>
      {!hasObjective && (
        <div style={{ fontSize: 11, color: C.textDim || "#888", padding: "6px 0" }}>
          Add an objective equation with an axis to plot.
        </div>
      )}
      <canvas ref={canvasRef} style={{ display: "block", borderRadius: 6, background: C.bg }} />
    </div>
  );
}
```

- [ ] **Step 2: Compute results + render canvas in Workbench.jsx**

In `src/components/calculate/workbench/Workbench.jsx`, add imports:

```jsx
import WorkbenchCanvas from "./WorkbenchCanvas.jsx";
import { runCard } from "./operations.js";
```

(Merge `useMemo` into the existing `react` import line — `import { useState, useEffect, useRef, useCallback, useMemo } from "react";`.)

Add cas-ready tracking near the existing effects:

```jsx
  const [casReady, setCasReady] = useState(false);
  useEffect(() => { cas.ready().then(() => setCasReady(true)).catch(() => {}); }, []);
```

Compute live results for the active session, after `active` is derived:

```jsx
  // Live results: recompute every active op on every card when the session changes
  // or once nerdamer finishes loading.
  const results = useMemo(() => {
    const out = {};
    for (const eq of active.equations) {
      try { out[eq.id] = runCard(eq, active); } catch { out[eq.id] = {}; }
    }
    return out;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [active.equations, active.params, active.choiceVars, active.view, casReady]);
```

Replace the right-column placeholder `<div data-wb-right>…</div>` with:

```jsx
        <div data-wb-right>
          <WorkbenchCanvas equations={active.equations} results={results} view={active.view} />
        </div>
```

(The ResultsPanel is added below the canvas in Task 8; leave it out for now.)

- [ ] **Step 3: Lint**

Run: `npx eslint src/components/calculate/workbench/`
Expected: no output.

- [ ] **Step 4: Franco validates in browser**

`npm run dev`, Calculate tab:
1. Add **Cobb-Douglas Y** template → a teal increasing curve renders, with a dashed teal f′ (MPK) overlay sloping down.
2. Drag the `alpha` slider → both curves redraw live.
3. Add a card `pi = (a-b*q)*q - F - c*q`, axis `q`, toggle **◇ optimize** → a filled red dot marks the profit-maximizing `q*` on the parabola.
4. Add `x^2-4`, axis `x`, toggle **=0** → a red circle marks the root near `x=2`.
5. Add `MD = d*E`, axis `E`, toggle **∫** → gold shading fills under the line.
6. Resize the window → the canvas re-fits (ResizeObserver).

- [ ] **Step 5: Commit**

```bash
git add src/components/calculate/workbench/
git commit -m "feat(workbench): live canvas — curves, f′ overlay, integral shading, root/optimum markers"
```

---

### Task 8: ResultsPanel — symbolic headline + numeric readout

The text results panel: for each card's active ops, show the symbolic LaTeX as the headline (rendered via `katex.render` into a DOM node with `trust:false` — no `innerHTML` of any expression string, satisfying §10.4), the numeric value/roots/optimum/λ readout, a `numeric-fallback` badge when no closed form was available, and copy buttons.

**Files:**
- Create: `src/components/calculate/workbench/ResultsPanel.jsx`
- Modify: `src/components/calculate/workbench/katexLoader.js` (add DOM-node render helper)
- Modify: `src/components/calculate/workbench/Workbench.jsx` (render below canvas)

- [ ] **Step 1: Add a DOM-node render helper to katexLoader.js**

In `src/components/calculate/workbench/katexLoader.js`, add a helper that renders directly into a DOM element (KaTeX builds and inserts sanitized nodes itself — no raw-string injection):

```js
// Render LaTeX into an existing DOM node. SECURITY (§10.4): trust:false; KaTeX
// constructs the DOM itself, so no expression string is ever set as innerHTML
// by app code. throwOnError:false → renders the source string in error color
// rather than throwing.
export function renderInto(katex, el, latex) {
  if (!el) return;
  try {
    katex.render(latex, el, { displayMode: true, throwOnError: false, trust: false });
  } catch {
    el.textContent = latex; // last-resort plain text
  }
}
```

- [ ] **Step 2: Write ResultsPanel.jsx**

Create `src/components/calculate/workbench/ResultsPanel.jsx`:

```jsx
import { useEffect, useRef } from "react";
import { useTheme } from "../../../ThemeContext.jsx";
import { loadKatex, renderInto } from "./katexLoader.js";

const mono = "'IBM Plex Mono', monospace";

const OP_LABEL = { plot: "f(x)", deriv: "f′", integral: "∫ f", solveZero: "f = 0", optimize: "optimum" };

// Renders one LaTeX string safely (§10.4): katex.render into a ref node,
// trust:false. Never assigns any expression string as innerHTML.
function Latex({ latex }) {
  const { C } = useTheme();
  const ref = useRef(null);
  useEffect(() => {
    let alive = true;
    const el = ref.current;
    if (!el) return;
    if (!latex) { el.textContent = "—"; return; }
    el.textContent = latex; // plain-text placeholder until KaTeX loads
    loadKatex().then((k) => { if (alive && ref.current) renderInto(k, ref.current, latex); }).catch(() => {});
    return () => { alive = false; };
  }, [latex]);
  return <span ref={ref} style={{ fontFamily: mono, color: C.text }} />;
}

export default function ResultsPanel({ equations, results }) {
  const { C } = useTheme();
  const objectives = equations.filter((e) => e.kind !== "constraint");

  function copy(text) { try { navigator.clipboard?.writeText(text); } catch { /* ignore */ } }

  if (!objectives.length) return null;

  return (
    <div style={{ fontFamily: mono, marginTop: 14 }}>
      <div style={{ fontSize: 9, color: C.teal, letterSpacing: "0.22em", textTransform: "uppercase", marginBottom: 8 }}>Results</div>
      {objectives.map((eq, i) => {
        const accent = [C.teal, C.gold, C.blue][i % 3];
        const r = results[eq.id] || {};
        const ops = Object.keys(r);
        if (!ops.length) return null;
        return (
          <div key={eq.id} style={{ borderLeft: `3px solid ${accent}`, paddingLeft: 10, marginBottom: 12 }}>
            <div style={{ fontSize: 11, color: accent, marginBottom: 4 }}>{eq.label}</div>
            {ops.map((op) => {
              const res = r[op];
              if (!res) return null;
              const fallback = res.source === "numeric-fallback";
              return (
                <div key={op} style={{ marginBottom: 8 }}>
                  <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 2 }}>
                    <span style={{ fontSize: 10, color: C.textDim || "#888", minWidth: 56 }}>{OP_LABEL[op] || op}</span>
                    {fallback && (
                      <span style={{ fontSize: 8, color: C.gold, border: `1px solid ${C.gold}`, borderRadius: 3, padding: "1px 4px" }}>
                        numeric-fallback
                      </span>
                    )}
                    {res.symbolic?.latex && (
                      <button onClick={() => copy(res.symbolic.latex)}
                        style={{ fontSize: 8, marginLeft: "auto", background: "transparent", color: C.textDim || "#888",
                          border: `1px solid ${C.line || "#222"}`, borderRadius: 3, padding: "1px 5px", cursor: "pointer" }}>
                        copy LaTeX
                      </button>
                    )}
                  </div>
                  {res.symbolic?.latex && (
                    <div style={{ fontSize: 13, color: C.text, marginBottom: 3, overflowX: "auto" }}>
                      <Latex latex={res.symbolic.latex} />
                    </div>
                  )}
                  <NumericReadout op={op} numeric={res.numeric} C={C} />
                </div>
              );
            })}
          </div>
        );
      })}
    </div>
  );
}

function NumericReadout({ op, numeric, C }) {
  if (!numeric) return null;
  const dim = C.textDim || "#888";
  const fmt = (x) => (Number.isFinite(x) ? x.toFixed(4) : "—");
  if (op === "integral") return <span style={{ fontSize: 11, color: dim }}>∫ over [{numeric.a}, {numeric.b}] = <b style={{ color: C.text }}>{fmt(numeric.value)}</b></span>;
  if (op === "solveZero") return <span style={{ fontSize: 11, color: dim }}>roots: <b style={{ color: C.text }}>{(numeric.roots || []).map(fmt).join(", ") || "none in view"}</b></span>;
  if (op === "optimize") {
    if (numeric.mode === "unconstrained")
      return <span style={{ fontSize: 11, color: dim }}>x* = <b style={{ color: C.text }}>{fmt(numeric.x)}</b>, f(x*) = <b style={{ color: C.text }}>{fmt(numeric.value)}</b> ({numeric.kind})</span>;
    // constrained
    if (numeric.error) return <span style={{ fontSize: 11, color: C.red || "#c86e6e" }}>{numeric.error}</span>;
    const choices = numeric.choices || {};
    const mults = numeric.multipliers || {};
    return (
      <div style={{ fontSize: 11, color: dim }}>
        {Object.entries(choices).map(([k, v]) => <span key={k} style={{ marginRight: 10 }}>{k}* = <b style={{ color: C.text }}>{fmt(v)}</b></span>)}
        {Object.entries(mults).map(([k, v]) => <span key={k} style={{ marginRight: 10, color: C.gold }}>λ({k.replace("lambda_", "")}) = {fmt(v)}</span>)}
        {Number.isFinite(numeric.objectiveValue) && <span>value = <b style={{ color: C.text }}>{fmt(numeric.objectiveValue)}</b></span>}
      </div>
    );
  }
  return null; // plot/deriv numeric is markers-only
}
```

- [ ] **Step 3: Render ResultsPanel in Workbench.jsx**

Add the import:

```jsx
import ResultsPanel from "./ResultsPanel.jsx";
```

Render it below the canvas in the right column:

```jsx
        <div data-wb-right>
          <WorkbenchCanvas equations={active.equations} results={results} view={active.view} />
          <ResultsPanel equations={active.equations} results={results} />
        </div>
```

- [ ] **Step 4: Lint**

Run: `npx eslint src/components/calculate/workbench/`
Expected: no output.

- [ ] **Step 5: Franco validates in browser**

`npm run dev`, Calculate tab:
1. Cobb-Douglas Y with f′ on → Results shows **f′** with the rendered LaTeX `∂Y/∂K` (KaTeX, not plain text).
2. Profit card with optimize → Results shows `x* = …, f(x*) = … (max)`.
3. Constrained: `x^0.4*y^0.6` optimize + budget constraint `2*x+5*y = 100`, choice vars x,y → Results shows `x* ≈ 20`, `y* ≈ 12`, and a gold `λ(1)` shadow-price line.
4. Try an intractable expr (e.g. `sin(x)+x^5-3`, axis x, =0) → a `numeric-fallback` badge appears if no closed root.
5. Click **copy LaTeX** → confirm valid LaTeX in clipboard.

- [ ] **Step 6: Commit**

```bash
git add src/components/calculate/workbench/
git commit -m "feat(workbench): results panel — KaTeX symbolic headline, numeric readout, λ shadow prices"
```

---

### Task 9: Full integration validation + lint sweep

Confirm all three harnesses pass together, the dev build is clean, and the full slice-3-to-8 flow works end-to-end.

**Files:** none (verification only)

- [ ] **Step 1: Lint the whole workbench surface**

Run: `npx eslint src/components/calculate/workbench/ src/math/cas/ src/math/__validation__/workbench*.js src/main.jsx`
Expected: no output.

- [ ] **Step 2: Production build smoke test**

Run: `npm run build`
Expected: build succeeds with no errors (chunk-size warnings are acceptable).

- [ ] **Step 3: Franco runs all three harnesses in the browser**

`npm run dev`, open console:

```js
await window.__validation.workbench()        // Plan 1 engine — Array(7), allPass:true
await window.__validation.workbenchStore()   // Array(5), allPass:true
await window.__validation.workbenchOps()     // Array(5), allPass:true
```

Expected: all three return `allPass: true`.

- [ ] **Step 4: Franco runs the end-to-end flow**

On the Calculate tab, in a fresh session:
1. Template **Profit π(q)** → curve + f′ overlay + red optimum dot + Results `q* …`.
2. Add constraint, set choice vars, confirm constrained optimize reports λ shadow price.
3. Create a second session, add a different equation, switch tabs → each session keeps its own cards/params.
4. Reload the page → both sessions and all parameter values restore from IndexedDB.
5. The legacy Variable Workspace / Math Pad / Monte Carlo sections still work below the Workbench.

- [ ] **Step 5: Final commit (if any verification fixups were needed)**

```bash
git add -A
git commit -m "chore(workbench): Plan 2 integration validation pass (slices 3-8)"
```

---

## Plan 2 complete

Slices 3–8 of spec §9 are implemented: session model + store, shell + tabs, cards + params + templates, operations + result contract, canvas, results panel. The CAS boundary (`cas.*`) and §5.6 result shape are preserved throughout, `src/math/` stays React-free, and persistence round-trips per `pid`.

**Deferred to Plan 3 (slices 9–10):**
- AI "Interpret" premium (`INTERPRET_OPTIMIZATION_PROMPT` + `interpretOptimization` in `AIService.js`).
- Tab reorg: move Monte Carlo / Sampling / Permutation to "Stat Simulation"; rename the tab; fold Probability/Distributions into collapsibles; remove the legacy MathPad/FunctionGrapher now that the Workbench supersedes them.

**Deferred to the escalation slice:** `sympyBackend.js` behind the same `cas` surface; also revisit self-hosting nerdamer (Edge tracking-prevention flagged the CDN's storage access during Plan 1 validation — harmless, but worth removing the third-party dependency at that point).
