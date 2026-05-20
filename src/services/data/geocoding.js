// ECON STUDIO - services/data/geocoding.js
// Browser-side geocoding helpers. Photon requests are async and UI-driven;
// pipeline replay can only use values that already exist in sessionStorage.

const CACHE_KEY = "econ_geocode_cache_v1";

export const GEOCODE_BBOX_PRESETS = {
  none:   { label: "No bounding box", bbox: null },
  munich: { label: "Munich", bbox: [11.35, 48.02, 11.75, 48.25] },
  caba:   { label: "CABA", bbox: [-58.54, -34.72, -58.32, -34.52] },
};

export function normalizeAddress(value) {
  return String(value ?? "").trim().replace(/\s+/g, " ");
}

export function geocodeCacheKey(address, opts = {}) {
  const provider = opts.provider || "photon";
  const endpoint = opts.endpoint || "";
  const bbox = Array.isArray(opts.bbox) ? opts.bbox.join(",") : "";
  return [provider, endpoint, bbox, normalizeAddress(address).toLowerCase()].join("|");
}

function readCacheObject() {
  if (typeof sessionStorage === "undefined") return {};
  try { return JSON.parse(sessionStorage.getItem(CACHE_KEY) || "{}"); }
  catch { return {}; }
}

function writeCacheObject(cache) {
  if (typeof sessionStorage === "undefined") return;
  try { sessionStorage.setItem(CACHE_KEY, JSON.stringify(cache)); } catch {}
}

export function readGeocodeCache(address, opts = {}) {
  const key = geocodeCacheKey(address, opts);
  return readCacheObject()[key] ?? null;
}

export function writeGeocodeCache(address, result, opts = {}) {
  const key = geocodeCacheKey(address, opts);
  const cache = readCacheObject();
  cache[key] = result;
  writeCacheObject(cache);
  return result;
}

export function parseBBox(value) {
  if (Array.isArray(value) && value.length === 4) {
    const nums = value.map(Number);
    return nums.every(Number.isFinite) ? nums : null;
  }
  const nums = String(value ?? "")
    .split(",")
    .map(s => Number(s.trim()));
  return nums.length === 4 && nums.every(Number.isFinite) ? nums : null;
}

function photonUrl(address, { bbox, limit = 1 } = {}) {
  const url = new URL("https://photon.komoot.io/api/");
  url.searchParams.set("q", address);
  url.searchParams.set("limit", String(limit));
  url.searchParams.set("lang", "en");
  if (bbox) url.searchParams.set("bbox", bbox.join(","));
  return url.toString();
}

function nominatimUrl(address, { endpoint, apiKey, bbox, limit = 1 } = {}) {
  const url = new URL(endpoint);
  url.searchParams.set("q", address);
  url.searchParams.set("format", "jsonv2");
  url.searchParams.set("limit", String(limit));
  if (bbox) {
    const [minLon, minLat, maxLon, maxLat] = bbox;
    url.searchParams.set("viewbox", [minLon, maxLat, maxLon, minLat].join(","));
    url.searchParams.set("bounded", "1");
  }
  if (apiKey) url.searchParams.set("key", apiKey);
  return url.toString();
}

function parsePhoton(json) {
  const feature = json?.features?.[0];
  const coords = feature?.geometry?.coordinates;
  if (!Array.isArray(coords) || coords.length < 2) return null;
  return {
    lat: Number(coords[1]),
    lon: Number(coords[0]),
    label: feature?.properties?.name || feature?.properties?.street || null,
    raw: feature?.properties ?? null,
  };
}

function parseNominatim(json) {
  const item = Array.isArray(json) ? json[0] : null;
  if (!item) return null;
  return {
    lat: Number(item.lat),
    lon: Number(item.lon),
    label: item.display_name || null,
    raw: item,
  };
}

export async function geocodeAddress(address, opts = {}) {
  const clean = normalizeAddress(address);
  if (!clean) return null;

  const cached = readGeocodeCache(clean, opts);
  if (cached) return cached;

  const provider = opts.provider || "photon";
  const url = provider === "custom"
    ? nominatimUrl(clean, opts)
    : photonUrl(clean, opts);

  const res = await fetch(url, { headers: { Accept: "application/json" } });
  if (!res.ok) throw new Error(`Geocoder request failed (${res.status})`);
  const json = await res.json();
  const result = provider === "custom" ? parseNominatim(json) : parsePhoton(json);
  const safe = result && Number.isFinite(result.lat) && Number.isFinite(result.lon)
    ? result
    : { lat: null, lon: null, label: null, raw: null };
  return writeGeocodeCache(clean, safe, opts);
}

export function geocodeRowsFromCache(rows, step) {
  const addressCol = step.addressCol || step.col;
  const latCol = step.latCol || "lat";
  const lonCol = step.lonCol || "lon";
  const bbox = parseBBox(step.bbox);
  const opts = {
    provider: step.provider || "photon",
    endpoint: step.endpoint || "",
    bbox,
  };
  return rows.map(row => {
    const hit = readGeocodeCache(row[addressCol], opts);
    return {
      ...row,
      [latCol]: hit?.lat ?? null,
      [lonCol]: hit?.lon ?? null,
    };
  });
}
