// ─── ECON STUDIO · spatial/shared/leaflet.js ─────────────────────────────────
// Basemap config, web-mercator tile math, Leaflet CDN loader. Pure JS, no deps.

export const BASEMAPS = {
  light: {
    label: "Light",
    url: "https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}{r}.png",
    attribution: "&copy; <a href='https://www.openstreetmap.org/copyright'>OpenStreetMap</a> &copy; <a href='https://carto.com/attributions'>CARTO</a>",
  },
  dark: {
    label: "Dark",
    url: "https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png",
    attribution: "&copy; <a href='https://www.openstreetmap.org/copyright'>OpenStreetMap</a> &copy; <a href='https://carto.com/attributions'>CARTO</a>",
  },
  osm: {
    label: "OSM",
    url: "https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png",
    attribution: "&copy; <a href='https://www.openstreetmap.org/copyright'>OpenStreetMap</a>",
  },
};

// ── OSM / CARTO tile helpers for Plot tab ────────────────────────────────────
export const CARTO_TILE = "https://a.basemaps.cartocdn.com/light_all/{z}/{x}/{y}.png";
export function lonToTx(lon, z) { return Math.floor((lon + 180) / 360 * (1 << z)); }
export function latToTy(lat, z) { const s = Math.sin(lat * Math.PI / 180); return Math.floor((0.5 - Math.log((1 + s) / (1 - s)) / (4 * Math.PI)) * (1 << z)); }
export function txToLon(tx, z) { return tx / (1 << z) * 360 - 180; }
export function tyToLat(ty, z) { return Math.atan(Math.sinh(Math.PI * (1 - 2 * ty / (1 << z)))) * 180 / Math.PI; }
export function pickTileZ(lonRange, latRange) {
  for (let z = 14; z >= 3; z--) {
    const tw = 360 / (1 << z);
    if (lonRange / tw <= 8 && latRange / tw <= 8) return z;
  }
  return 8;
}

export function addBasemap(L, map, basemap = "light") {
  const cfg = BASEMAPS[basemap] ?? BASEMAPS.light;
  return L.tileLayer(cfg.url, {
    attribution: cfg.attribution,
    maxZoom: 19,
    detectRetina: true,
    crossOrigin: true,
  }).addTo(map);
}

// ─── LEAFLET CDN LOADER ───────────────────────────────────────────────────────
let _leafletPromiseST = null;
export function loadLeaflet() {
  if (typeof window !== "undefined" && window.L) return Promise.resolve(window.L);
  if (_leafletPromiseST) return _leafletPromiseST;
  _leafletPromiseST = new Promise((resolve, reject) => {
    if (!document.getElementById("leaflet-css")) {
      const link = document.createElement("link");
      link.id = "leaflet-css";
      link.rel = "stylesheet";
      link.href = "https://unpkg.com/leaflet@1.9.4/dist/leaflet.css";
      link.integrity = "sha384-sHL9NAb7lN7rfvG5lfHpm643Xkcjzp4jFvuavGOndn6pjVqS6ny56CAt3nsEVT4H";
      link.crossOrigin = "anonymous";
      document.head.appendChild(link);
    }
    const script = document.createElement("script");
    script.src = "https://unpkg.com/leaflet@1.9.4/dist/leaflet.js";
    script.integrity = "sha384-cxOPjt7s7Iz04uaHJceBmS+qpjv2JkIHNVcuOrM+YHwZOmJGBXI00mdUXEq65HTH";
    script.crossOrigin = "anonymous";
    script.onload = () => { _leafletPromiseST = null; resolve(window.L); };
    script.onerror = () => { _leafletPromiseST = null; reject(new Error("Leaflet load failed")); };
    document.head.appendChild(script);
  });
  return _leafletPromiseST;
}
