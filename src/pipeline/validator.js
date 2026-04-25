// ─── ECON STUDIO · pipeline/validator.js ─────────────────────────────────────
// Pure computation. Zero React imports.
// Extracted from WranglingModule.jsx.
//
// Exports:
//   validatePanel(rows, entityCol, timeCol) → PanelReport | null
//   buildInfo(headers, rows)                → Record<colName, ColStats>

// ─── PANEL VALIDATION ─────────────────────────────────────────────────────────
// Returns a PanelReport describing structure, balance, duplicates, and attrition.
//
// PanelReport shape:
//   entities        string[]          — sorted unique entity IDs
//   times           (string|number)[] — sorted unique time periods
//   balance         "strongly_balanced" | "unbalanced"
//   dups            { e, t, rows }[]  — up to 5 duplicate (entity × time) pairs
//   gaps            { e, m[] }[]      — entities with missing time periods (up to 8)
//   blockFE         boolean           — true if duplicates prevent FE estimation
//   pres            Record<e, Record<t, boolean>>
//   attrition       number            — share of t0 entities absent at tN
//   at0             number            — entity count at first period
//   atN             number            — entity count at last period
export function validatePanel(rows, ec, tc) {
  if (!ec || !tc) return null;

  const entities = [...new Set(rows.map(r => r[ec]))].sort((a, b) => String(a).localeCompare(String(b)));
  const times    = [...new Set(rows.map(r => r[tc]))].sort((a, b) => a - b);

  // Duplicate detection
  const seen = {}, dups = [];
  rows.forEach((r, i) => {
    const k = `${r[ec]}||${r[tc]}`;
    if (seen[k] !== undefined) dups.push({ e: r[ec], t: r[tc], rows: [seen[k] + 2, i + 2] });
    else seen[k] = i;
  });

  // Presence matrix
  const pres = {};
  entities.forEach(e => { pres[e] = {}; times.forEach(t => { pres[e][t] = false; }); });
  rows.forEach(r => { if (pres[r[ec]]) pres[r[ec]][r[tc]] = true; });

  const allHave = entities.every(e => times.every(t => pres[e][t]));

  // Attrition
  const t0 = times[0], tN = times[times.length - 1];
  const at0 = entities.filter(e => pres[e][t0]).length;
  const atN = entities.filter(e => pres[e][tN]).length;
  const attrition = at0 > 0 ? (at0 - atN) / at0 : 0;

  // Gap summary (first 8 entities only to keep output lean)
  const gaps = [];
  entities.slice(0, 8).forEach(e => {
    const m = times.filter(t => !pres[e][t]);
    if (m.length > 0) gaps.push({ e, m });
  });

  return {
    entities, times,
    balance: allHave ? "strongly_balanced" : "unbalanced",
    dups: dups.slice(0, 5),
    gaps,
    blockFE: dups.length > 0,
    pres,
    attrition, at0, atN,
  };
}

// ─── COLUMN STATS ─────────────────────────────────────────────────────────────
// Returns a ColStats object for every column in headers.
//
// ColStats shape:
//   isNum      boolean  — all non-null values are numeric
//   isCat      boolean  — string column with ≤ 30 unique values
//   naCount    number
//   naPct      number   — fraction [0,1]
//   total      number
//   uCount     number   — unique value count
//   uVals      any[]    — up to 20 unique values
//   mean       number|null
//   std        number|null
//   median     number|null
//   q1         number|null
//   q3         number|null
//   iqr        number|null
//   min        number|null
//   max        number|null
//   outliers   number   — IQR-based count
export function buildInfo(headers, rows) {
  const info = {};
  headers.forEach(h => {
    const vals = rows.map(r => r[h]);
    let nc = 0, na = 0, tx = 0;
    const u = new Set();

    vals.forEach(v => {
      if (v === null || v === undefined) { na++; return; }
      u.add(v);
      if (typeof v === "number") nc++; else tx++;
    });

    const num    = vals.filter(v => typeof v === "number" && isFinite(v)).sort((a, b) => a - b);
    const mean   = num.length ? num.reduce((a, b) => a + b, 0) / num.length : null;
    const std    = (num.length && mean != null)
      ? Math.sqrt(num.reduce((s, v) => s + (v - mean) ** 2, 0) / num.length)
      : null;
    const q1     = num[Math.floor(num.length * 0.25)] ?? null;
    const q3     = num[Math.floor(num.length * 0.75)] ?? null;
    const iqr    = (q1 != null && q3 != null) ? q3 - q1 : null;
    const outliers = iqr != null ? num.filter(v => v < q1 - 1.5 * iqr || v > q3 + 1.5 * iqr).length : 0;
    const sorted = [...num];
    const median = sorted.length
      ? (sorted.length % 2 === 0
          ? (sorted[sorted.length / 2 - 1] + sorted[sorted.length / 2]) / 2
          : sorted[Math.floor(sorted.length / 2)])
      : null;

    info[h] = {
      isNum: nc > 0 && tx === 0,
      isCat: tx > 0 && u.size <= 30,
      naCount: na,
      naPct: vals.length ? na / vals.length : 0,
      total: vals.length,
      uCount: u.size,
      uVals: [...u].slice(0, 20),
      mean, std, median, q1, q3, iqr,
      min: num[0] ?? null,
      max: num[num.length - 1] ?? null,
      outliers,
    };
  });
  return info;
}
