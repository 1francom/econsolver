// ─── ECON STUDIO · spatial/shared/color.js ───────────────────────────────────
// Categorical palette + value→color scale builder (numeric gradient / discrete / categorical).

import { arrMin, arrMax } from "./constants.js";

export const CAT_PALETTE = ["#6ec8b4","#c8a96e","#6e9ec8","#c47070","#a87ec8","#7ab896","#c88e6e","#c8c46e","#6ec8c4"];

export function buildColorScale(rows, col) {
  if (!col) return { getColor: () => null, legend: null };
  const vals = rows.map(r => r[col]).filter(v => v !== null && v !== undefined && v !== "");
  if (!vals.length) return { getColor: () => null, legend: null };
  const isNum = vals.every(v => !isNaN(parseFloat(v)));
  if (isNum) {
    const nums = vals.map(Number);
    const mn = arrMin(nums), mx = arrMax(nums), rng = mx - mn || 1;
    const colorAt = value => {
      const t = (Number(value) - mn) / rng;
      const r = Math.round(110 + t * 90);
      const g = Math.round(200 - t * 31);
      const b = Math.round(180 - t * 70);
      return `rgb(${r},${g},${b})`;
    };
    const uniq = [...new Set(nums)].sort((a, b) => a - b);
    const isDiscreteCount = uniq.length <= 24 && uniq.every(v => Number.isInteger(v)) && mn >= 0;
    if (isDiscreteCount) {
      const cmap = Object.fromEntries(uniq.map(v => [String(v), colorAt(v)]));
      const getColor = row => {
        const v = row[col];
        if (v === null || v === undefined || v === "") return null;
        return cmap[String(Number(v))] ?? colorAt(v);
      };
      return { getColor, legend: { type: "numeric-discrete", values: uniq, cmap, col } };
    }
    const getColor = row => {
      const v = row[col];
      if (v === null || v === undefined || v === "") return null;
      const t = (Number(v) - mn) / rng;
      const r = Math.round(110 + t * 90);   // 110→200
      const g = Math.round(200 - t * 31);   // 200→169
      const b = Math.round(180 - t * 70);   // 180→110
      return `rgb(${r},${g},${b})`;
    };
    return { getColor, legend: { type: "gradient", min: mn, max: mx, col } };
  }
  const cats = [...new Set(vals)];
  const cmap = Object.fromEntries(cats.map((c, i) => [c, CAT_PALETTE[i % CAT_PALETTE.length]]));
  return { getColor: row => cmap[row[col]] ?? "#888", legend: { type: "categorical", cats: cats.slice(0, 8), cmap, col } };
}
