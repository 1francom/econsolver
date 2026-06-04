import { test } from "node:test";
import assert from "node:assert/strict";
import { normalizeFecha, applyWhitelist, dedupeIncidents } from "./observatorio.js";

test("normalizeFecha — Spanish long form", () => {
  assert.equal(normalizeFecha("15 de mayo de 2024"), "2024-05-15");
  assert.equal(normalizeFecha("3 de enero de 1984"), "1984-01-03");
  assert.equal(normalizeFecha("9 de setiembre de 2001"), "2001-09-09"); // setiembre
});

test("normalizeFecha — numeric and ISO", () => {
  assert.equal(normalizeFecha("15/05/2024"), "2024-05-15");
  assert.equal(normalizeFecha("2024-05-15"), "2024-05-15");
});

test("normalizeFecha — accent + case insensitive", () => {
  assert.equal(normalizeFecha("15 de Mayo de 2024"), "2024-05-15");
  assert.equal(normalizeFecha("15 de DICIEMBRE de 2024"), "2024-12-15");
});

test("normalizeFecha — unparseable returns null", () => {
  assert.equal(normalizeFecha("sin fecha"), null);
  assert.equal(normalizeFecha(""), null);
  assert.equal(normalizeFecha(null), null);
});

test("applyWhitelist keeps only allowed keys", () => {
  const row = { fecha: "x", provincia: "y", nombre: "Victim Name", edad: 30 };
  const out = applyWhitelist(row, ["fecha", "provincia", "comuna", "barrio", "vinculo"]);
  assert.deepEqual(Object.keys(out).sort(), ["fecha", "provincia"]);
  assert.equal("nombre" in out, false); // PII dropped
});

test("dedupeIncidents — id-based default on", () => {
  const rows = [{ id: 1, fecha: "a" }, { id: 1, fecha: "a2" }, { id: 2, fecha: "b" }];
  const r = dedupeIncidents(rows, { idKey: "id" });
  assert.equal(r.rows.length, 2);
  assert.equal(r.nDuplicatesDropped, 1);
});

test("dedupeIncidents — hash OFF by default, only reports collisions", () => {
  const rows = [
    { fecha: "2024-05-15", provincia: "BA", vinculo: "pareja" },
    { fecha: "2024-05-15", provincia: "BA", vinculo: "pareja" }, // distinct event, same key
  ];
  const r = dedupeIncidents(rows, { hashKeys: ["fecha", "provincia", "vinculo"] });
  assert.equal(r.rows.length, 2);              // nothing dropped
  assert.equal(r.nPotentialDuplicates, 1);     // collision surfaced
});

test("dedupeIncidents — hash opt-in drops collisions", () => {
  const rows = [
    { fecha: "2024-05-15", provincia: "BA", vinculo: "pareja" },
    { fecha: "2024-05-15", provincia: "BA", vinculo: "pareja" },
  ];
  const r = dedupeIncidents(rows, { hashKeys: ["fecha", "provincia", "vinculo"], useHash: true });
  assert.equal(r.rows.length, 1);
  assert.equal(r.nDuplicatesDropped, 1);
});

import { parseRegistry, parseRegistryText } from "./observatorio.js";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const fixture = JSON.parse(
  readFileSync(fileURLToPath(new URL("./__fixtures__/observatorio_sample.json", import.meta.url)))
);

test("parseRegistry — positional schema, strips name/fiscal PII, normalizes dates", () => {
  const { rows, headers, meta } = parseRegistry(fixture);
  // PII gone: no name, no fiscal, no raw id|nombre cell leaks through
  assert.equal(rows.every(r => !("nombre" in r) && !("fiscal" in r) && !("id" in r)), true);
  assert.equal(rows.every(r => !Object.values(r).some(v => typeof v === "string" && v.includes("FAKE NAME"))), true);
  assert.equal(rows.every(r => !Object.values(r).some(v => typeof v === "string" && v.includes("Fiscal"))), true);
  // whitelist headers only
  assert.deepEqual(headers, ["fecha", "provincia", "partido", "localidad", "vinculo", "edad", "hijxs"]);
  // id-dedup default on: id:3 appears twice → one dropped
  assert.equal(meta.nDuplicatesDropped, 1);
  // analytical columns preserved
  const r1 = rows.find(r => r.provincia === "Buenos Aires");
  assert.equal(r1.fecha, "2024-05-15");
  assert.equal(r1.partido, "La Plata");
  assert.equal(r1.edad, "31");
  // the "sin dato" row keeps fecha:null + raw preserved
  const bad = rows.find(r => r.provincia === "Mendoza");
  assert.equal(bad.fecha, null);
  assert.equal(bad._fecha_raw, "sin dato");
  assert.equal(meta.nUnparsedDates, 1);
});

test("parseRegistry — meta coverage spans min/max parsed dates", () => {
  const { meta } = parseRegistry(fixture);
  assert.equal(meta.coverage.minDate, "1984-01-03");
  assert.equal(meta.coverage.maxDate, "2024-05-15");
  assert.equal(meta.source, "Observatorio Lucía Pérez");
});

test("parseRegistryText — parses a JSON string the same as parseRegistry", () => {
  const text = JSON.stringify(fixture);
  const { rows, meta } = parseRegistryText(text);
  assert.equal(rows.length, 4);
  assert.equal(meta.nDuplicatesDropped, 1);
});

test("parseRegistryText — bad JSON throws a helpful error", () => {
  assert.throws(() => parseRegistryText("not json {"), /Could not parse JSON/);
});

const marchasFixture = JSON.parse(
  readFileSync(fileURLToPath(new URL("./__fixtures__/observatorio_marchas_sample.json", import.meta.url)))
);

test("parseRegistry — marchas schema auto-detected by column count", () => {
  const { headers, meta } = parseRegistry(marchasFixture);
  assert.equal(meta.padron, "marchas");
  assert.deepEqual(headers, ["fecha", "provincia", "localidad", "convocatoria"]);
});

test("parseRegistry — marchas keeps convocatoria tag, drops HTML link + id", () => {
  const { rows } = parseRegistry(marchasFixture);
  // convocatoria is the campaign tag (not PII) and survives
  const niunamenos = rows.find(r => r.convocatoria === "NiUnaMenos");
  assert.ok(niunamenos);
  assert.equal(niunamenos.fecha, "2016-06-03");
  assert.equal(niunamenos.provincia, "CABA");
  assert.equal(niunamenos.localidad, "CABA");
  // id never surfaces, the "Ampliar" HTML link is never read into any value
  assert.equal(rows.every(r => !("id" in r)), true);
  assert.equal(rows.every(r => !Object.values(r).some(v => typeof v === "string" && /<a |Ampliar|href/.test(v))), true);
});

test("parseRegistry — marchas dedup + unparsed date + coverage", () => {
  const { rows, meta } = parseRegistry(marchasFixture);
  // id:3 (8M) duplicated → one dropped
  assert.equal(meta.nDuplicatesDropped, 1);
  // "sin dato" row in Mendoza keeps fecha:null + raw preserved
  const bad = rows.find(r => r.provincia === "Mendoza");
  assert.equal(bad.fecha, null);
  assert.equal(bad._fecha_raw, "sin dato");
  assert.equal(meta.nUnparsedDates, 1);
  // coverage spans the parsed dates
  assert.equal(meta.coverage.minDate, "2015-06-03");
  assert.equal(meta.coverage.maxDate, "2020-03-08");
});
