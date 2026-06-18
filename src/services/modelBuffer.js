// ─── ECON STUDIO · services/modelBuffer.js ────────────────────────────────────
// Module-level singleton that holds pinned EstimationResult objects across
// component remounts and tab switches.
//
// API:
//   add(result)       → string  — adds result (FIFO eviction at 8), returns its id
//   remove(id)                  — removes by id
//   setLabel(id,label)          — renames a pinned model's label
//   reorder(ids)                — reorders buffer to match id array
//   get(id)           → result | undefined
//   getAll()          → EstimationResult[]
//   clear()
//   count()           → number

import { saveModelBuffer, loadModelBuffer } from "./Persistence/indexedDB.js";
import { trimResult } from "./Persistence/trimResult.js";

const MAX = 8;

// Generates a short collision-resistant id  (timestamp + random hex)
function genId() {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
}

let _buf = [];        // EstimationResult[] — ordered oldest→newest
let _pid = null;      // current project; null = pre-project, in-memory only
let _saveTimer = null;

// Debounced persist of the (trimmed) buffer under the current project.
function _persist() {
  if (!_pid) return;  // no project bound → in-memory only, never save
  clearTimeout(_saveTimer);
  _saveTimer = setTimeout(() => {
    saveModelBuffer(_pid, _buf.map(trimResult).filter(Boolean));
  }, 400);
}

// Bind the buffer to a project: loads that project's pinned models into the
// buffer (replacing current contents). Returns a Promise.
export async function setProject(pid) {
  _pid = pid || null;
  if (!_pid) { _buf = []; return; }
  const rec = await loadModelBuffer(_pid);
  _buf = Array.isArray(rec?.models) ? rec.models : [];
}

export function add(result) {
  if (!result) return null;
  // Evict oldest if full
  if (_buf.length >= MAX) _buf = _buf.slice(_buf.length - MAX + 1);
  const id = result.id ?? genId();
  const entry = { ...result, id };
  _buf = [..._buf, entry];
  _persist();
  return id;
}

export function remove(id) {
  _buf = _buf.filter(r => r.id !== id);
  _persist();
}

// Rename a pinned model's label (used by ModelBufferBar inline rename).
export function setLabel(id, label) {
  _buf = _buf.map(r => r.id === id ? { ...r, label } : r);
  _persist();
}

// Reorder the buffer to match `ids` (array of model ids); unknown ids dropped,
// missing ids kept in their current relative order at the end.
export function reorder(ids) {
  const byId = new Map(_buf.map(r => [r.id, r]));
  const next = [];
  for (const id of ids) { if (byId.has(id)) { next.push(byId.get(id)); byId.delete(id); } }
  for (const r of _buf) { if (byId.has(r.id)) next.push(r); }
  _buf = next;
  _persist();
}

export function get(id) {
  return _buf.find(r => r.id === id);
}

export function getAll() {
  return [..._buf];
}

export function clear() {
  _buf = [];
  _persist();
}

export function count() {
  return _buf.length;
}
