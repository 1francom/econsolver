// ─── ECON STUDIO · services/data/fetchers/observatorio.js ────────────────────
// Observatorio Lucía Pérez femicide/travesticide registry.
// The site's admin-ajax.php endpoint sits behind Imunify360 bot-protection, so
// server-side/proxy fetches are blocked by design. Instead the user pulls the
// raw DataTables JSON from their own authenticated browser session and imports
// it here (paste or file). This module is the pure parser for that payload.
// Privacy-first: only analytical columns ever enter Litux (PII stripped here).

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

const cleanCell = v => {
  if (v == null) return null;
  const s = String(v).trim();
  return s === "" ? null : s;
};

// Split "<id> | <label>" → { id, label }. For femicidios the label is the victim
// NAME (PII — dropped); for marchas it is the campaign tag (kept). Tolerates
// optional spaces around the pipe and a missing pipe.
function splitPipe(cell) {
  const s = cell == null ? "" : String(cell);
  const i = s.indexOf("|");
  if (i === -1) return { id: s.trim(), label: null };
  return { id: s.slice(0, i).trim(), label: s.slice(i + 1).trim() || null };
}

// ── Padrón schemas ────────────────────────────────────────────────────────────
// The site serves several padrones through the same admin-ajax.php DataTables
// endpoint, each a POSITIONAL array with a different column layout. A schema maps
// a record → canonical object and declares its PII whitelist. PII columns
// (victim name, fiscal) and HTML links are never read. Auto-detected by column
// count; add a new entry to support another padrón.
const SCHEMAS = [
  {
    name: "femicidios",
    match: cols => cols >= 9,                          // 10-column layout
    whitelist: ["fecha", "provincia", "partido", "localidad", "vinculo", "edad", "hijxs"],
    hashKeys: ["fecha", "provincia", "vinculo"],
    toObject: arr => ({
      id:        splitPipe(arr[0]).id,                 // label = victim NAME → dropped (PII)
      edad:      cleanCell(arr[1]),
      fecha:     cleanCell(arr[2]),                    // D/M/YYYY
      localidad: cleanCell(arr[3]),
      partido:   cleanCell(arr[4]),
      provincia: cleanCell(arr[5]),
      vinculo:   cleanCell(arr[6]),
      hijxs:     cleanCell(arr[7]),
      // arr[8] fiscal (PII) + arr[9] link → never read
    }),
  },
  {
    name: "marchas",
    match: cols => cols === 5,
    whitelist: ["fecha", "provincia", "localidad", "convocatoria"],
    hashKeys: ["fecha", "provincia", "localidad", "convocatoria"],
    toObject: arr => {
      const { id, label } = splitPipe(arr[0]);
      return {
        id,
        convocatoria: label,                           // campaign tag, e.g. "3J" — not PII
        fecha:     cleanCell(arr[1]),                  // D/M/YYYY
        localidad: cleanCell(arr[2]),
        provincia: cleanCell(arr[3]),
        // arr[4] "Ampliar" HTML link → never read
      };
    },
  },
];

function detectSchema(records) {
  const cols = Array.isArray(records[0]) ? records[0].length : 0;
  return SCHEMAS.find(s => s.match(cols)) || null;
}

function recordsFrom(payload) {
  if (Array.isArray(payload)) return payload;
  for (const k of ["data", "rows", "value", "records"]) {
    if (Array.isArray(payload?.[k])) return payload[k];
  }
  throw new Error("Observatorio payload has no recognizable record list (schema drift?).");
}

// Pure: payload → { rows, headers, meta }. Incident/event-level, PII-stripped.
export function parseRegistry(payload, { dedup = {} } = {}) {
  const raw = recordsFrom(payload);
  if (!raw.length) throw new Error("Observatorio payload contained zero records.");

  const schema = detectSchema(raw);
  if (!schema) {
    const cols = Array.isArray(raw[0]) ? raw[0].length : "?";
    throw new Error(`Unrecognized Observatorio padrón (${cols} columns). Add a schema in observatorio.js.`);
  }

  // 1. positional array → canonical object (drops name/fiscal/link per schema)
  const renamed = raw.map(schema.toObject);

  // 2. dedup (id default on; hash opt-in)
  const dd = dedupeIncidents(renamed, {
    idKey: "id",
    hashKeys: schema.hashKeys,
    useHash: false,
    ...dedup,
  });

  // 3. normalize dates + strip to whitelist
  let nUnparsedDates = 0;
  let minDate = null, maxDate = null;
  const rows = dd.rows.map(r => {
    const iso = normalizeFecha(r.fecha);
    const out = applyWhitelist(r, schema.whitelist);
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
    headers: schema.whitelist,
    meta: {
      source: "Observatorio Lucía Pérez",
      padron: schema.name,
      nObs: rows.length,
      fetchedAt: new Date().toISOString(),
      coverage: { minDate, maxDate },
      nUnparsedDates,
      nDuplicatesDropped: dd.nDuplicatesDropped,
      nPotentialDuplicates: dd.nPotentialDuplicates,
    },
  };
}

// Convenience: parse a pasted/loaded JSON string — the raw admin-ajax.php
// response the user saved from their authenticated browser session.
export function parseRegistryText(text, opts = {}) {
  let payload;
  try {
    payload = JSON.parse(text);
  } catch {
    throw new Error(
      "Could not parse JSON. Paste the full admin-ajax.php response, including the outer { data: [...] }."
    );
  }
  return parseRegistry(payload, opts);
}
