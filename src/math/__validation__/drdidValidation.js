// ─── ECON STUDIO · src/math/__validation__/drdidValidation.js ─────────────────
// Validation harness for compute2x2 (doubly-robust 2×2 DiD).
// Franco pastes R fixtures from drdidValidation.R into R_FIXTURES below.
// Then: window.__validation.drdid shows pass/total in browser console.

import { compute2x2 } from "../did/drdid.js";

const SAMPLE = {
  deltaY: [1.9, 2.1, 1.7, 2.3, 2.0, 1.8,  0.4, 0.6, 0.5, 0.3, 0.7, 0.5],
  D:      [1,   1,   1,   1,   1,   1,     0,   0,   0,   0,   0,   0  ],
  X:      [
    [1, 0.2], [1, 0.5], [1,-0.1], [1, 0.8], [1, 0.3], [1, 0.0],
    [1, 1.1], [1, 0.9], [1, 1.4], [1, 1.0], [1, 1.2], [1, 0.7],
  ],
};
const n = SAMPLE.deltaY.length;
const weights = Array(n).fill(1);

// R fixtures — Franco pastes output from drdidValidation.R here:
// e.g.: R_FIXTURES["reg"] = { att: 1.700000, se: 0.058926 };
const R_FIXTURES = {
  reg: { att: NaN, se: NaN },
  ipw: { att: NaN, se: NaN },
  dr:  { att: NaN, se: NaN },
};

export function runDrdidValidation() {
  const rows = [];
  for (const m of ["reg", "ipw", "dr"]) {
    const result = compute2x2({ ...SAMPLE, estMethod: m, weights });
    const { att, inf } = result;

    // se = sqrt(mean(inf²)) / n   — matches DRDID R package convention
    let s2 = 0;
    for (let i = 0; i < n; i++) s2 += inf[i] * inf[i];
    const se = Math.sqrt(s2 / n) / n;

    const rf = R_FIXTURES[m];
    const okAtt = !isNaN(rf.att) ? Math.abs(att - rf.att) < 1e-4 : null;
    const okSE  = !isNaN(rf.se)  ? Math.abs(se  - rf.se)  < 1e-4 : null;

    rows.push({
      method: m,
      att: +att.toFixed(6),
      attR: rf.att,
      diffAtt: !isNaN(rf.att) ? +(Math.abs(att - rf.att)).toFixed(6) : null,
      se: +se.toFixed(6),
      seR: rf.se,
      diffSE: !isNaN(rf.se) ? +(Math.abs(se - rf.se)).toFixed(6) : null,
      okAtt,
      okSE,
      warning: result.warning ?? null,
    });
  }
  console.table(rows);

  if (typeof window !== "undefined") {
    window.__validation = window.__validation ?? {};
    window.__validation.drdid = {
      rows,
      pass: rows.filter(r => r.okAtt === true && r.okSE === true).length,
      total: rows.length,
      noFixture: rows.filter(r => r.okAtt === null || r.okSE === null).length,
    };
  }
  return rows;
}

// Allow running directly: node src/math/__validation__/drdidValidation.js
if (typeof process !== "undefined" && process.argv?.[1]?.includes("drdidValidation")) {
  runDrdidValidation();
}
