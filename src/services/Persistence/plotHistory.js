// ─── Plot history persistence — IndexedDB via the shared openDB singleton ──────
import { openDB } from "./indexedDB.js";

const STORE = "pipelines"; // reuse existing store — key: plotHistory_<pid>

export async function getPlotHistory(pid) {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const t   = db.transaction(STORE, "readonly");
    const s   = t.objectStore(STORE);
    const req = s.get(`plotHistory_${pid}`);
    req.onsuccess = () => resolve(req.result?.history ?? []);
    req.onerror   = e => reject(e.target.error);
  });
}

export async function savePlotHistory(pid, history) {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const t   = db.transaction(STORE, "readwrite");
    const s   = t.objectStore(STORE);
    s.put({ id: `plotHistory_${pid}`, history, ts: Date.now() });
    t.oncomplete = () => resolve();
    t.onerror    = e => reject(e.target.error);
  });
}
