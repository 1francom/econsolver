// ─── ECON STUDIO · spatial/shared/crs.js ─────────────────────────────────────
// proj4 CDN loader, projected-CRS presets, WKT projection detection, metric grid.

import { makeProjectedGrid } from "../../../../math/SpatialEngine.js";

// ─── PROJ4 CDN LOADER ─────────────────────────────────────────────────────────
let _proj4Promise = null;
export function loadProj4() {
  if (typeof window !== "undefined" && window.proj4) return Promise.resolve(window.proj4);
  if (_proj4Promise) return _proj4Promise;
  _proj4Promise = new Promise((resolve, reject) => {
    const s = document.createElement("script");
    s.src = "https://unpkg.com/proj4@2.9.0/dist/proj4.js";
    s.integrity = "sha384-U14wzrePlI+UpXk1Jpe45fK/C0yeI7rtwKzi9eM3Lj7LYjXlHNy0YacuWZIk7Hic";
    s.crossOrigin = "anonymous";
    s.onload = () => { _proj4Promise = null; resolve(window.proj4); };
    s.onerror = () => { _proj4Promise = null; reject(new Error("proj4 load failed")); };
    document.head.appendChild(s);
  });
  return _proj4Promise;
}

// Proj4 string presets for common projected CRS.
export const PRESET_CRS = {
  "UTM 31N": "+proj=utm +zone=31 +datum=WGS84 +units=m +no_defs",
  "UTM 32N": "+proj=utm +zone=32 +datum=WGS84 +units=m +no_defs",
  "UTM 33N": "+proj=utm +zone=33 +datum=WGS84 +units=m +no_defs",
  "UTM 34N": "+proj=utm +zone=34 +datum=WGS84 +units=m +no_defs",
  "GK4 (DE)": "+proj=tmerc +lat_0=0 +lon_0=12 +k=1 +x_0=4500000 +y_0=0 +ellps=bessel +datum=potsdam +units=m +no_defs",
  "RD New (NL)": "+proj=sterea +lat_0=52.15616055555555 +lon_0=5.38720621111111 +k=0.9999079 +x_0=155000 +y_0=463000 +ellps=bessel +towgs84=565.417,50.3319,465.552,-0.398957,0.343988,-1.8774,4.0725 +units=m +no_defs",
  "OSGB36 (UK)": "+proj=tmerc +lat_0=49 +lon_0=-2 +k=0.9996012717 +x_0=400000 +y_0=-100000 +ellps=airy +datum=OSGB36 +units=m +no_defs",
};

// Detect if a WKT string contains projected (non-WGS84) coordinates by
// sampling the first coordinate pair.
export function isProjectedWKT(wkt) {
  if (!wkt || typeof wkt !== "string") return false;
  const m = wkt.match(/(-?[\d.]+)\s+(-?[\d.]+)/);
  if (!m) return false;
  const x = parseFloat(m[1]), y = parseFloat(m[2]);
  return Math.abs(x) > 180 || Math.abs(y) > 90;
}

export function makeCabaMetricGrid(wkt, cellsize, clipBorder = true) {
  return makeProjectedGrid(wkt, cellsize, clipBorder, {
    sourceCrs: isProjectedWKT(wkt) ? "EPSG:32721" : "EPSG:4326",
    metricCrs: "EPSG:32721",
    outputCrs: "EPSG:4326",
  });
}
