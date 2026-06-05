import { serializeCapabilityMap, serializeAllowedSteps } from "../appCapabilityMap.js";

let pass = 0, fail = 0;
const check = (n, c) => c ? (pass++, console.log("  [pass]", n)) : (fail++, console.log("  [FAIL]", n));

const map = serializeCapabilityMap();
check("map is non-empty", typeof map === "string" && map.length > 100);
for (const tab of ["Data", "Clean", "Explore", "Model", "Simulate", "Calculate", "Report"]) {
  check(`map names tab ${tab}`, map.includes(`[${tab}]`));
}
check("map lists Merge category ops", /Merge:/.test(map));
check("map lists Cleaning category ops", /Cleaning:/.test(map));
check("allowed steps still works", serializeAllowedSteps().includes("ALLOWED PIPELINE STEPS"));

console.log(`\ncapabilityMap: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
