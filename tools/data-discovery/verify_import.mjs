// Safe verification harness — runs the real admin-ajax.php JSON through the
// in-app parser and prints ONLY PII-stripped aggregates, so we can confirm the
// positional column mapping is correct without any victim data entering output.
//
//   node tools/data-discovery/verify_import.mjs out/registro.json
//
// Save the clipboard from the browser console snippet to out/registro.json
// first (out/ is gitignored).
import { readFileSync } from "node:fs";
import { parseRegistryText } from "../../src/services/data/fetchers/observatorio.js";

const path = process.argv[2];
if (!path) { console.error("usage: node verify_import.mjs <file.json>"); process.exit(1); }

const { rows, headers, meta } = parseRegistryText(readFileSync(path, "utf8"));

const distinct = k => [...new Set(rows.map(r => r[k]).filter(Boolean))];
const sample = (k, n = 12) => distinct(k).slice(0, n);

console.log("headers     :", headers.join(", "));
console.log("nObs        :", meta.nObs, "(payload recordsTotal should be ~5321)");
console.log("coverage    :", meta.coverage.minDate, "→", meta.coverage.maxDate);
console.log("unparsedDate:", meta.nUnparsedDates);
console.log("dupsDropped :", meta.nDuplicatesDropped);
console.log("provincia   :", sample("provincia"), `(+${Math.max(0, distinct("provincia").length - 12)} more)`);
console.log("vinculo     :", sample("vinculo"));
console.log("edad range  :", (() => {
  const ages = rows.map(r => Number(r.edad)).filter(n => Number.isFinite(n));
  return ages.length ? `${Math.min(...ages)}–${Math.max(...ages)}` : "none";
})());

// PII leak guard: no key/value should look like a free-text name or fiscal.
const banned = ["nombre", "fiscal", "id"];
const keyLeak = headers.filter(h => banned.includes(h));
const valLeak = rows.some(r => Object.values(r).some(v =>
  typeof v === "string" && /\b(fiscal|fiscalía)\b/i.test(v)));
console.log("PII guard   :", keyLeak.length === 0 && !valLeak ? "OK (no name/fiscal columns)" : `LEAK: ${keyLeak.join(",")}${valLeak ? " + fiscal text in values" : ""}`);

// Spot-check the first 3 rows so you can eyeball column alignment.
console.log("\nfirst 3 rows (PII-stripped):");
for (const r of rows.slice(0, 3)) console.log("  ", JSON.stringify(r));
