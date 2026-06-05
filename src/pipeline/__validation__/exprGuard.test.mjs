import { isSafeExpr, assertSafeExpr } from "../exprGuard.js";

let pass = 0, fail = 0;
const check = (n, c) => c ? (pass++, console.log("  [pass]", n)) : (fail++, console.log("  [FAIL]", n));

// benign expressions must pass
for (const e of [
  "log(wage)*educ",
  "ifelse(age>18,1,0)",
  "case_when(x>0,1,x<0,-1,0)",
  "income_num / 1000",
  "round(gdp, 2)",
  "worker_count * 2",      // column named with lowercase 'worker' — not blocked
  "location_id + 1",       // 'location' as a column — not blocked
]) check("benign passes: " + e, isSafeExpr(e));

// malicious expressions must be rejected
for (const e of [
  "fetch('https://evil.tld')",
  "localStorage.getItem('k')",
  "window.location.href",
  "({}).constructor.constructor('return 1')()",
  "globalThis.fetch",
  "x.__proto__",
  "import('y')",
  "`${x}`",
  "self.postMessage(1)",
  "document.cookie",
  "navigator.sendBeacon('x', d)",
]) check("malicious rejected: " + e, !isSafeExpr(e));

// edge cases
check("null is safe", isSafeExpr(null));
check("number is safe", isSafeExpr(42));
check("empty string is safe", isSafeExpr(""));

let threw = false;
try { assertSafeExpr("fetch('x')"); } catch { threw = true; }
check("assertSafeExpr throws on unsafe", threw);

let ok = true;
try { assertSafeExpr("log(x)"); } catch { ok = false; }
check("assertSafeExpr passes benign", ok);

console.log(`\nexprGuard: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
