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

const WHITELIST = ["fecha", "provincia", "comuna", "barrio", "vinculo"];

// Map real payload keys → canonical names. Defaults assume Spanish keys; if
// discovery (Task 4) found different names, edit the right-hand sides here.
const FIELD_MAP = {
  id:        "id",
  fecha:     "fecha",
  provincia: "provincia",
  comuna:    "comuna",
  barrio:    "barrio",
  vinculo:   "vinculo",
};

function recordsFrom(payload) {
  if (Array.isArray(payload)) return payload;
  for (const k of ["data", "rows", "value", "records"]) {
    if (Array.isArray(payload?.[k])) return payload[k];
  }
  throw new Error("Observatorio payload has no recognizable record list (schema drift?).");
}

// Pure: payload → { rows, headers, meta }. Incident-level, PII-stripped.
export function parseRegistry(payload, { dedup = {} } = {}) {
  const raw = recordsFrom(payload);
  if (!raw.length) throw new Error("Observatorio payload contained zero records.");

  // 1. canonical-rename via FIELD_MAP
  const renamed = raw.map(r => {
    const o = {};
    for (const [canon, srcKey] of Object.entries(FIELD_MAP)) {
      if (srcKey in r) o[canon] = r[srcKey];
    }
    return o;
  });

  // 2. dedup (id default on; hash opt-in)
  const dd = dedupeIncidents(renamed, {
    idKey: "id",
    hashKeys: ["fecha", "provincia", "vinculo"],
    useHash: false,
    ...dedup,
  });

  // 3. normalize dates + strip PII to whitelist
  let nUnparsedDates = 0;
  let minDate = null, maxDate = null;
  const rows = dd.rows.map(r => {
    const iso = normalizeFecha(r.fecha);
    const out = applyWhitelist(r, WHITELIST);
    if (iso) {
      out.fecha = iso;
      if (!minDate || iso < minDate) minDate = iso;
      if (!maxDate || iso > maxDate) maxDate = iso;
    } else {
      out.fecha = null;
      out._fecha_raw = r.fecha ?? null;
      nUnparsedDates++;
    }
    return out;
  });

  return {
    rows,
    headers: WHITELIST,
    meta: {
      source: "Observatorio Lucía Pérez",
      nObs: rows.length,
      fetchedAt: new Date().toISOString(),
      coverage: { minDate, maxDate },
      nUnparsedDates,
      nDuplicatesDropped: dd.nDuplicatesDropped,
      nPotentialDuplicates: dd.nPotentialDuplicates,
    },
  };
}

// Live fetch: POST the discovered request descriptor to the proxy, then parse.
export async function fetchObservatorioRegistry(opts = {}) {
  const res = await fetch(PROXY_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(opts),
  });
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(`Observatorio proxy error ${res.status}${body.detail ? ": " + String(body.detail).slice(0, 200) : ""}`);
  }
  const json = await res.json();
  if (json.error) throw new Error(`Observatorio API error: ${json.error}`);
  return parseRegistry(json, opts);
}
