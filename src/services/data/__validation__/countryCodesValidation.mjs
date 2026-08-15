// Integrity + known-case harness for countryCodes.js. Not an econometric
// engine, so the R-benchmark convention (6dp coef / 4dp SE) doesn't apply —
// see the "Validation" section of docs/superpowers/specs/2026-07-28-country-code-transform-design.md.
//
// Checks:
//   (a) no duplicate iso2/iso3 key in COUNTRY_TABLE
//   (b) no alias (or name) claimed by two different countries
//   (c) matchCountry() resolves a fixed list of known tricky cases
import assert from "node:assert/strict";
import { COUNTRY_TABLE, matchCountry } from "../countryCodes.js";

const failures = [];

// (a) duplicate iso2/iso3
const iso2Seen = new Map();
const iso3Seen = new Map();
for (const e of COUNTRY_TABLE) {
  if (iso2Seen.has(e.iso2)) failures.push(`duplicate iso2 "${e.iso2}": ${iso2Seen.get(e.iso2)} vs ${e.name}`);
  iso2Seen.set(e.iso2, e.name);
  if (iso3Seen.has(e.iso3)) failures.push(`duplicate iso3 "${e.iso3}": ${iso3Seen.get(e.iso3)} vs ${e.name}`);
  iso3Seen.set(e.iso3, e.name);
}

// (b) no alias/name claimed twice — this is the exact silent-collision risk
// the lookup index would otherwise hide (last one written to the Map wins).
const nameSeen = new Map();
for (const e of COUNTRY_TABLE) {
  const keys = [e.name, ...e.aliases];
  for (const k of keys) {
    const lk = k.toLowerCase();
    if (nameSeen.has(lk) && nameSeen.get(lk) !== e.iso3) {
      failures.push(`"${k}" claimed by both ${nameSeen.get(lk)} and ${e.iso3}`);
    }
    nameSeen.set(lk, e.iso3);
  }
}

// (c) known tricky cases
const CASES = [
  ["usa", "USA"],
  ["U.S.", "USA"],
  ["US", "USA"],
  ["  Germany  ", "DEU"],           // whitespace
  ["SWAZILAND", "SWZ"],             // case + historical name
  ["Czech Republic", "CZE"],        // historical name -> current
  ["Congo, Dem. Rep.", "COD"],      // WB Country Name convention
  ["South Korea", "KOR"],
  ["Korea, Rep.", "KOR"],
  ["Cote d'Ivoire", "CIV"],
  ["Türkiye", "TUR"],
  ["gb", "GBR"],
  ["GBR", "GBR"],
];
for (const [raw, expectIso3] of CASES) {
  const m = matchCountry(raw);
  if (!m) { failures.push(`matchCountry(${JSON.stringify(raw)}) -> null, expected ${expectIso3}`); continue; }
  if (m.iso3 !== expectIso3) failures.push(`matchCountry(${JSON.stringify(raw)}) -> ${m.iso3}, expected ${expectIso3}`);
}

// negative case — must NOT match
if (matchCountry("Narnia") !== null) failures.push(`matchCountry("Narnia") should be null`);
if (matchCountry("") !== null) failures.push(`matchCountry("") should be null`);
if (matchCountry(null) !== null) failures.push(`matchCountry(null) should be null`);

// continent taxonomy sanity — 5-way, no Antarctica, no split Americas
const CONTINENTS = new Set(COUNTRY_TABLE.map(e => e.continent));
const EXPECTED = new Set(["Africa", "Americas", "Asia", "Europe", "Oceania"]);
for (const c of CONTINENTS) {
  if (!EXPECTED.has(c)) failures.push(`unexpected continent value "${c}" — taxonomy must be exactly Africa/Americas/Asia/Europe/Oceania`);
}
// spot-check the transcontinental cases the spec calls out explicitly
const spotChecks = [["CYP", "Asia"], ["GEO", "Asia"], ["ARM", "Asia"], ["AZE", "Asia"], ["KAZ", "Asia"], ["TUR", "Asia"], ["RUS", "Europe"]];
for (const [iso3, expected] of spotChecks) {
  const e = COUNTRY_TABLE.find(x => x.iso3 === iso3);
  if (!e) { failures.push(`spot-check: ${iso3} missing from table`); continue; }
  if (e.continent !== expected) failures.push(`${iso3} classed ${e.continent}, expected ${expected} (R countrycode convention)`);
}

if (failures.length) {
  assert.fail("\n  " + failures.join("\n  ") + "\n");
}

console.log(`countryCodes OK (${COUNTRY_TABLE.length} entries)`);
