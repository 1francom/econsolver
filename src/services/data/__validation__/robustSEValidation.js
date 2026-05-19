// Structural tests for duckdbRobustSE.js. Numerical validation against R
// sandwich::vcovHC lives in fase1RValidation harness (Task 10).
import { computeHCMeat } from "../duckdbRobustSE.js";

let passes = 0, fails = 0;
const check = (n, c) => c ? (passes++, console.log(`  ✓ ${n}`)) : (fails++, console.error(`  ✗ ${n}`));

async function validateImport() {
  console.log("\n[computeHCMeat]");
  check("computeHCMeat is a function", typeof computeHCMeat === "function");

  const mod = await import("../duckdbRobustSE.js");
  check("computeHCMeatWithLeverage is a function",
    typeof mod.computeHCMeatWithLeverage === "function");
}

export async function runRobustSEValidation() {
  passes = 0; fails = 0;
  await validateImport();
  console.log(`\n${passes} passed, ${fails} failed`);
  return fails === 0;
}
