// ─── ECON STUDIO · spatial/shared/constants.js ───────────────────────────────
// Shared constants and tiny helpers for the Spatial module. Pure JS, no deps.

export const mono = "'IBM Plex Mono','JetBrains Mono',Consolas,monospace";

export const arrMin = a => a.reduce((m, v) => v < m ? v : m, a[0]);
export const arrMax = a => a.reduce((m, v) => v > m ? v : m, a[0]);

export const BUFFER_RADIUS_PRESETS = [
  ["50m", 50],
  ["100m", 100],
  ["200m", 200],
  ["300m", 300],
  ["500m", 500],
  ["1km", 1000],
  ["2km", 2000],
  ["5km", 5000],
];

export const formatRadiusLabel = radiusMeters => {
  const r = Number(radiusMeters);
  if (!isFinite(r)) return "buffer";
  return r >= 1000 && r % 1000 === 0 ? `${r / 1000}km` : `${Math.round(r)}m`;
};
