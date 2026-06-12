// ─── Session execution timeline — IndexedDB via the shared openDB singleton ───
// Fase 1.1 of specs/2026-06-12-replication-fidelity-design.md.
//
// ONE ordered, persisted log of every pipeline-affecting user action in a
// project. The unified replication script ("per execution order" mode, Fase 3)
// is a deterministic walk of this log; sessionLog.jsx hydrates from and
// persists to it.
//
// Event shape (superset of the sessionLog entry — stored verbatim):
//   {
//     id:           string,   // crypto.randomUUID()
//     timestamp:    number,   // Date.now() — defines the global order
//     module:       string,   // "data" | "clean" | "model" | "spatial" | "explore" | "calculate" | "simulate"
//     opType:       string,   // event kind, e.g. "dataset_load", "pipeline_step", "estimate", "spatial_join", "explore_stat"
//     datasetId:    string?,  // which dataset the event touched (when applicable)
//     params:       object,   // everything needed to reproduce or describe
//     reproducible: boolean,  // true → emit code; false → emit comment
//     label:        string,   // human-readable one-liner
//   }
//
// Mirrors plotHistory.js: key `timeline_<pid>` in the existing `pipelines` store.

import { openDB } from "./indexedDB.js";

const STORE = "pipelines"; // reuse existing store — key: timeline_<pid>

export async function getTimeline(pid) {
  if (!pid) return [];
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const t   = db.transaction(STORE, "readonly");
    const s   = t.objectStore(STORE);
    const req = s.get(`timeline_${pid}`);
    req.onsuccess = () => resolve(req.result?.events ?? []);
    req.onerror   = e => reject(e.target.error);
  });
}

// Append one event (read-modify-write; events are user-action-frequency, not hot).
export async function appendTimeline(pid, event) {
  if (!pid || !event) return;
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const t   = db.transaction(STORE, "readwrite");
    const s   = t.objectStore(STORE);
    const req = s.get(`timeline_${pid}`);
    req.onsuccess = () => {
      const events = req.result?.events ?? [];
      events.push(event);
      s.put({ id: `timeline_${pid}`, events, ts: Date.now() });
    };
    req.onerror  = e => reject(e.target.error);
    t.oncomplete = () => resolve();
    t.onerror    = e => reject(e.target.error);
  });
}

// Replace the whole timeline (used by clearLog and future pruning).
export async function saveTimeline(pid, events) {
  if (!pid) return;
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const t = db.transaction(STORE, "readwrite");
    t.objectStore(STORE).put({ id: `timeline_${pid}`, events: events ?? [], ts: Date.now() });
    t.oncomplete = () => resolve();
    t.onerror    = e => reject(e.target.error);
  });
}
