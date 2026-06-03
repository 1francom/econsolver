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
