// src/math/__validation__/panelWithinEngineValidation.js
// Structural checks for demeanByFE — run with: node src/math/__validation__/panelWithinEngineValidation.js
import { demeanByFE, feDegreesOfFreedom } from "../PanelWithinEngine.js";

function assert(cond, msg) { if (!cond) throw new Error(`FAIL: ${msg}`); console.log(`  ok — ${msg}`); }

// Fixture: 3 units × 4 periods, balanced, y = 2 + unit_effect + time_effect + noise
const rows = [];
const unitFx = { A: 0, B: 5, C: -3 };
const timeFx = { 1: 0, 2: 1, 3: 2, 4: 3 };
for (const u of ["A", "B", "C"]) {
  for (const t of [1, 2, 3, 4]) {
    rows.push({ unit: u, time: t, y: 2 + unitFx[u] + timeFx[t], x: t + (u === "A" ? 0 : u === "B" ? 1 : 2) });
  }
}

console.log("Test 1: D=1 (unit only) — after demeaning, __dm_y should have zero within-unit variance in the FE-only part");
const r1 = demeanByFE(rows, ["unit"], ["y", "x"]);
const grand = r1.grandMeans.y;
assert(Math.abs(grand - rows.reduce((s, r) => s + r.y, 0) / rows.length) < 1e-9, "grand mean matches raw mean");

console.log("Test 2: D=2 (unit + time) converges — group means of the demeaned column within each dim ≈ 0 (up to re-centering)");
const r2 = demeanByFE(rows, ["unit", "time"], ["y", "x"]);
for (const u of ["A", "B", "C"]) {
  const sub = r2.demeaned.filter(r => r.unit === u);
  const mean = sub.reduce((s, r) => s + r.__dm_y, 0) / sub.length;
  assert(Math.abs(mean - r2.grandMeans.y) < 1e-6, `unit ${u} demeaned group mean ≈ grand mean`);
}

console.log("Test 3: feDegreesOfFreedom matches n - kReg - (nUnits-1) - (nTimes-1) - 1 for the 2-way case");
const df = feDegreesOfFreedom(12, 1, [3, 4]);
assert(df === 12 - 1 - 2 - 3 - 1, `df = ${df} matches hand calc`);

console.log("\nAll structural checks passed. R comparison still required (Task 8) before calling this validated.");
