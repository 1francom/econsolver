import { assignVector, mulberry32, computeQuota } from "../vectorAssign.js";

let pass = 0, fail = 0;
function check(name, cond) {
  if (cond) { pass++; console.log("  [pass]", name); }
  else { fail++; console.log("  [FAIL]", name); }
}

const rows = Array.from({ length: 1000 }, (_, i) => ({ i, income: i }));
const values = ["a", "b", "c", "d"];

// 1. Determinism: same seed -> identical output
const r1 = assignVector(rows, { values, mode: "random", seed: 7 });
const r2 = assignVector(rows, { values, mode: "random", seed: 7 });
check("random is deterministic for a fixed seed", r1.every((v, i) => v === r2[i]));

// 2. Different seed -> different output (extremely likely)
const r3 = assignVector(rows, { values, mode: "random", seed: 8 });
check("random changes with the seed", r1.some((v, i) => v !== r3[i]));

// 3. Recycle wraps the vector by position
const rec = assignVector(rows, { values, mode: "recycle" });
check("recycle row 0 = values[0]", rec[0] === "a");
check("recycle row 5 = values[1]", rec[5] === "b"); // 5 % 4 = 1
check("recycle wraps", rec[4] === "a");             // 4 % 4 = 0

// 4. Quota exact counts
const counts = computeQuota(1000, [0.25, 0.25, 0.25, 0.25]);
check("quota sums to n", counts.reduce((a, b) => a + b, 0) === 1000);
check("quota even split = 250 each", counts.every(c => c === 250));
const q = assignVector(rows, { values, mode: "quota", weights: [0.25, 0.25, 0.25, 0.25], seed: 1 });
const tally = {}; q.forEach(v => (tally[v] = (tally[v] || 0) + 1));
check("quota assignment honors exact counts", values.every(v => tally[v] === 250));

// 5. Quota with uneven weights still sums to n
const c2 = computeQuota(1000, [0.6, 0.4]);
check("uneven quota sums to n", c2[0] + c2[1] === 1000 && c2[0] === 600);

// 6. Conditional uses evalRule + elseValue
const cond = assignVector(rows, {
  values, mode: "conditional",
  evalRule: (r) => (r.income > 500 ? "hi" : undefined),
  elseValue: "lo",
});
check("conditional matches rule", cond[600] === "hi");
check("conditional falls through to else", cond[100] === "lo");

// 7. Empty pool -> all null
check("empty pool -> null", assignVector(rows, { values: [], mode: "random" }).every(v => v === null));

console.log(`\nvectorAssign: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
