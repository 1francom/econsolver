// ─── ECON STUDIO · spatial/shared/leaflet.js ─────────────────────────────────
// Basemap config, web-mercator tile math, Leaflet CDN loader. Pure JS, no deps.

const ESRI_ATTR = "Tiles &copy; <a href='https://www.esri.com'>Esri</a> &mdash; Esri, DeLorme, NAVTEQ";

export const BASEMAPS = {
  light: {
    label: "Light",
    url: "https://server.arcgisonline.com/ArcGIS/rest/services/Canvas/World_Light_Gray_Base/MapServer/tile/{z}/{y}/{x}",
    labelsUrl: "https://server.arcgisonline.com/ArcGIS/rest/services/Canvas/World_Light_Gray_Reference/MapServer/tile/{z}/{y}/{x}",
    attribution: ESRI_ATTR,
    maxZoom: 16,
    retina: false,
  },
  dark: {
    label: "Dark",
    url: "https://server.arcgisonline.com/ArcGIS/rest/services/Canvas/World_Dark_Gray_Base/MapServer/tile/{z}/{y}/{x}",
    labelsUrl: "https://server.arcgisonline.com/ArcGIS/rest/services/Canvas/World_Dark_Gray_Reference/MapServer/tile/{z}/{y}/{x}",
    attribution: ESRI_ATTR,
    maxZoom: 16,
    retina: false,
  },
  osm: {
    label: "OSM",
    url: "https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png",
    labelsUrl: null,
    attribution: "&copy; <a href='https://www.openstreetmap.org/copyright'>OpenStreetMap</a>",
    maxZoom: 19,
    retina: true,
  },
};

// ── Tile math helpers for the Plot tab's canvas underlay ────────────────────────────────────
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
  const opts = {
    attribution: cfg.attribution,
    maxZoom: cfg.maxZoom ?? 19,
    detectRetina: cfg.retina !== false,
    crossOrigin: true,
  };
  const base = L.tileLayer(cfg.url, opts).addTo(map);
  // Esri's canvas basemaps ship place labels as a separate reference layer.
  if (cfg.labelsUrl) L.tileLayer(cfg.labelsUrl, { ...opts, attribution: "" }).addTo(map);
  return base;
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
