// ─── ECON STUDIO · services/modelBuffer.js ────────────────────────────────────
// Module-level singleton that holds pinned EstimationResult objects across
// component remounts and tab switches.
//
// API:
//   add(result)       → string  — adds result (FIFO eviction at 8), returns its id
//   remove(id)                  — removes by id
//   get(id)           → result | undefined
//   getAll()          → EstimationResult[]
//   clear()
//   count()           → number

const MAX = 8;

// Generates a short collision-resistant id  (timestamp + random hex)
function genId() {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
}

let _buf = [];   // EstimationResult[] — ordered oldest→newest

export function add(result) {
  if (!result) return null;
  // Evict oldest if full
  if (_buf.length >= MAX) _buf = _buf.slice(_buf.length - MAX + 1);
  const id = result.id ?? genId();
  const entry = { ...result, id };
  _buf = [..._buf, entry];
  return id;
}

export function remove(id) {
  _buf = _buf.filter(r => r.id !== id);
}

export function get(id) {
  return _buf.find(r => r.id === id);
}

export function getAll() {
  return [..._buf];
}

export function clear() {
  _buf = [];
}

export function count() {
  return _buf.length;
}
