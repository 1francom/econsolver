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

export async function getMapHistory(pid) {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const t   = db.transaction(STORE, "readonly");
    const s   = t.objectStore(STORE);
    const req = s.get(`mapHistory_${pid}`);
    req.onsuccess = () => resolve(req.result?.history ?? []);
    req.onerror   = e => reject(e.target.error);
  });
}

export async function saveMapHistory(pid, history) {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const t   = db.transaction(STORE, "readwrite");
    const s   = t.objectStore(STORE);
    s.put({ id: `mapHistory_${pid}`, history, ts: Date.now() });
    t.oncomplete = () => resolve();
    t.onerror    = e => reject(e.target.error);
  });
}

export async function getGeoPlotConfig(pid) {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const t   = db.transaction(STORE, "readonly");
    const s   = t.objectStore(STORE);
    const req = s.get(`geoPlotConfig_${pid}`);
    req.onsuccess = () => resolve(req.result?.config ?? null);
    req.onerror   = e => reject(e.target.error);
  });
}

export async function saveGeoPlotConfig(pid, config) {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const t   = db.transaction(STORE, "readwrite");
    const s   = t.objectStore(STORE);
    s.put({ id: `geoPlotConfig_${pid}`, config, ts: Date.now() });
    t.oncomplete = () => resolve();
    t.onerror    = e => reject(e.target.error);
  });
}
