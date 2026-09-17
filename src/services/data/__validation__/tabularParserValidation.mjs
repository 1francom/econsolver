// ─── ECON STUDIO · tabularParserValidation.mjs ───────────────────────────────
// CSV tokenising edge cases. T1 is the one that shipped broken: a header row
// whose LAST name is quoted grew a phantom trailing column ("col", all nulls) —
// exactly what R's write.csv and many Excel exports produce. Found by the
// real-data validation harness, which read an R script's own output back.
//   node src/services/data/__validation__/tabularParserValidation.mjs
import assert from "node:assert/strict";
import { parseCSV, detectDelimiter } from "../parsers/tabular.js";

let pass = 0;
const check = (name, fn) => { try { fn(); pass++; console.log(`  ok   ${name}`); }
  catch (e) { console.error(`  FAIL ${name}\n       ${e.message}`); process.exitCode = 1; } };

check("T1 a quoted last header adds no phantom column", () => {
  assert.deepEqual(parseCSV(`"a","b"\n1,2`, ",").headers, ["a", "b"]);
  assert.deepEqual(parseCSV(`a,"b"\n"x","y"`, ",").rows[0], { a: "x", b: "y" });
});

check("T2 a REAL trailing empty field is still a column", () => {
  // "a,b," is three fields — the fix must not swallow a genuine trailing comma.
  assert.equal(parseCSV(`a,b,\n1,2,3`, ",").headers.length, 3);
  assert.equal(parseCSV(`"a","b",\n1,2,3`, ",").headers.length, 3);
});

check("T3 quoting rules: embedded delimiter, escaped quote, empty field", () => {
  assert.deepEqual(parseCSV(`a,b\n1,"x,y"`, ",").rows[0], { a: 1, b: "x,y" });
  assert.deepEqual(parseCSV(`a\n"say ""hi"""`, ",").rows[0], { a: 'say "hi"' });
  assert.deepEqual(parseCSV(`a,b\n,2`, ",").rows[0], { a: null, b: 2 });
});

check("T4 NA sentinels become null, thousands separators are numbers", () => {
  // The thousands separator only survives inside a quoted field — unquoted,
  // "1,234" is simply two fields.
  assert.deepEqual(parseCSV(`a,b,c\nNA,n/a,"1,234"`, ",").rows[0], { a: null, b: null, c: 1234 });
});

check("T5 duplicate headers are disambiguated, blanks named", () => {
  assert.deepEqual(parseCSV(`a,a,\n1,2,3`, ",").headers, ["a", "a_2", "col"]);
});

check("T6 delimiter detection reads the header only", () => {
  assert.equal(detectDelimiter(`a;b;c\n1;2;"x,y,z"`), ";");
  assert.equal(detectDelimiter(`a\tb\n1\t2`), "\t");
  assert.equal(detectDelimiter(`a,b\n1,2`), ",");
});

console.log(`\ntabularParser: ${pass} checks passed${process.exitCode ? " (with failures)" : ""}`);
