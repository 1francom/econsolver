// src/services/data/__validation__/distinctValuesFallbackValidation.mjs
import { jsDistinctValues } from "../distinctValuesFallback.js";

let pass = 0, fail = 0;
function check(label, cond) {
  console.log(`  ${cond ? "PASS" : "FAIL"}  ${label}`);
  cond ? pass++ : fail++;
}

// Basic counting + descending sort by count
const rows1 = [
  { country: "USA" }, { country: "USA" }, { country: "USA" },
  { country: "Chile" }, { country: "Chile" },
  { country: "Peru" },
];
const r1 = jsDistinctValues(rows1, "country");
check("total distinct = 3", r1.total === 3);
check("most frequent first", r1.values[0].value === "USA" && r1.values[0].count === 3);
check("least frequent last", r1.values[2].value === "Peru" && r1.values[2].count === 1);

// Nulls/undefined excluded from both the list and the total
const rows2 = [{ x: 1 }, { x: null }, { x: undefined }, { x: 1 }, { x: 2 }];
const r2 = jsDistinctValues(rows2, "x");
check("nulls/undefined excluded from total", r2.total === 2);
check("nulls/undefined excluded from values", r2.values.every(v => v.value != null));

// Cap at `limit`, total still reflects the true distinct count
const rows3 = Array.from({ length: 800 }, (_, i) => ({ id: i }));
const r3 = jsDistinctValues(rows3, "id", 500);
check("capped list length", r3.values.length === 500);
check("total reflects true distinct count beyond the cap", r3.total === 800);

// Empty input
const r4 = jsDistinctValues([], "x");
check("empty input -> total 0", r4.total === 0);
check("empty input -> empty values", r4.values.length === 0);

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail === 0 ? 0 : 1);
