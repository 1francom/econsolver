// ─── ECON STUDIO · services/data/fetchers/observatorio.js ────────────────────
// Observatorio Lucía Pérez femicide/travesticide registry.
// Data arrives via admin-ajax.php (discovered with tools/data-discovery).
// Privacy-first: only analytical columns ever enter Litux (PII stripped here).

const PROXY_URL = "https://zxknjfezkatuldipdskw.supabase.co/functions/v1/observatorio-proxy";

// Spanish month names → number. Accent-stripped, lowercased before lookup.
// Includes both "setiembre" and "septiembre" spellings.
const SPANISH_MONTHS = {
  enero: 1, febrero: 2, marzo: 3, abril: 4, mayo: 5, junio: 6,
  julio: 7, agosto: 8, setiembre: 9, septiembre: 9, octubre: 10,
  noviembre: 11, diciembre: 12,
};

const stripAccents = s =>
  s.normalize("NFD").replace(/[\u0300-\u036f]/g, "");

const pad2 = n => String(n).padStart(2, "0");

// Coverage is 1984→present; assume 4-digit years (no YY pivot).
export function normalizeFecha(raw) {
  if (raw == null) return null;
  const s = stripAccents(String(raw).trim().toLowerCase());
  if (!s) return null;

  // ISO: 2024-05-15
  let m = s.match(/^(\d{4})-(\d{1,2})-(\d{1,2})$/);
  if (m) return `${m[1]}-${pad2(m[2])}-${pad2(m[3])}`;

  // Numeric: 15/05/2024 or 15-05-2024
  m = s.match(/^(\d{1,2})[/-](\d{1,2})[/-](\d{4})$/);
  if (m) return `${m[3]}-${pad2(m[2])}-${pad2(m[1])}`;

  // Long form: "15 de mayo de 2024"
  m = s.match(/^(\d{1,2})\s+de\s+([a-z]+)\s+de\s+(\d{4})$/);
  if (m) {
    const month = SPANISH_MONTHS[m[2]];
    if (month) return `${m[3]}-${pad2(month)}-${pad2(m[1])}`;
  }
  return null;
}

// Keep only whitelisted keys — drops names/ages/free-text PII at the boundary.
export function applyWhitelist(row, allow) {
  const out = {};
  for (const k of allow) if (k in row) out[k] = row[k];
  return out;
}

// Dedup policy:
//   - idKey present  → dedup on id (keep last), default ON.
//   - hashKeys only  → collisions reported but NOT dropped unless useHash=true.
export function dedupeIncidents(rows, { idKey = null, hashKeys = null, useHash = false } = {}) {
  if (idKey && rows.some(r => r[idKey] != null)) {
    const byId = new Map();
    for (const r of rows) byId.set(r[idKey], r); // keep last
    return {
      rows: [...byId.values()],
      nDuplicatesDropped: rows.length - byId.size,
      nPotentialDuplicates: 0,
    };
  }
  if (hashKeys && hashKeys.length) {
    const seen = new Map();
    const kept = [];
    let collisions = 0;
    for (const r of rows) {
      const key = hashKeys.map(k => String(r[k] ?? "")).join("\u0001");
      if (seen.has(key)) {
        collisions++;
        if (useHash) continue; // drop only when explicitly opted in
      } else {
        seen.set(key, true);
      }
      kept.push(r);
    }
    return {
      rows: kept,
      nDuplicatesDropped: useHash ? collisions : 0,
      nPotentialDuplicates: useHash ? 0 : collisions,
    };
  }
  return { rows, nDuplicatesDropped: 0, nPotentialDuplicates: 0 };
}
