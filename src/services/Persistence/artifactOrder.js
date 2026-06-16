// ─── Unified artifact ordering — IndexedDB via the shared openDB singleton ─────
// A project's global display/replication order across plots, maps, and models.
// Stored in the existing `pipelines` store under key `artifactOrder_<pid>` as an
// array of namespaced ids ("plot:<id>" | "map:<id>" | "model:<id>"). Layers over
// the three existing stores — no migration, no schema bump.
import { openDB } from "./indexedDB.js";

// "plot" + "ph_x4" → "plot:ph_x4"
export function makeArtifactId(type, id) {
  return `${type}:${id}`;
}

// "plot:ph_x4" → { type: "plot", id: "ph_x4" }  (id may itself contain ":")
export function parseArtifactId(key) {
  const i = String(key).indexOf(":");
  if (i < 0) return { type: null, id: String(key) };
  return { type: key.slice(0, i), id: key.slice(i + 1) };
}

// Sort `artifacts` (each must expose `.artifactId`) by `order` (array of
// namespaced ids). Items present in `order` come first in that order; items not
// in `order` are appended, sorted by `.savedAt` ascending (stable for ties).
export function orderArtifacts(artifacts, order) {
  const rank = new Map((order ?? []).map((k, i) => [k, i]));
  const known = [];
  const unknown = [];
  for (const a of artifacts ?? []) {
    if (rank.has(a.artifactId)) known.push(a);
    else unknown.push(a);
  }
  known.sort((x, y) => rank.get(x.artifactId) - rank.get(y.artifactId));
  unknown.sort((x, y) => (x.savedAt ?? 0) - (y.savedAt ?? 0));
  return [...known, ...unknown];
}

const STORE = "pipelines";

export async function getArtifactOrder(pid) {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const t = db.transaction(STORE, "readonly");
    const req = t.objectStore(STORE).get(`artifactOrder_${pid}`);
    req.onsuccess = () => resolve(req.result?.order ?? []);
    req.onerror = e => reject(e.target.error);
  });
}

export async function saveArtifactOrder(pid, order) {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const t = db.transaction(STORE, "readwrite");
    t.objectStore(STORE).put({ id: `artifactOrder_${pid}`, order, ts: Date.now() });
    t.oncomplete = () => resolve();
    t.onerror = e => reject(e.target.error);
  });
}
