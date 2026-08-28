// Litux's `join` must mean dplyr's join, not a first-match lookup.
//
// The JS runner collapsed left/inner/full/right to ONE output row per left row
// (runner.js built a first-match Map). The DuckDB path (duckdbRunner.js "join")
// emits a real SQL LEFT JOIN and expands. So the same step returned 20 rows on a
// small dataset and 200 on a DuckDB-backed one, with nothing said either way.
import assert from "node:assert/strict";
import { applyStep } from "../runner.js";

// 3 comunas x 2 years = 6 panel rows; 3 metadata rows.
const comunas = [
  { id: "1", nombre: "A" },
  { id: "2", nombre: "B" },
  { id: "3", nombre: "C" },
];
const panel = [
  { id: "1", year: 2020, robos: 10 },
  { id: "1", year: 2021, robos: 11 },
  { id: "2", year: 2020, robos: 20 },
  { id: "2", year: 2021, robos: 21 },
  { id: "9", year: 2020, robos: 90 },  // no matching comuna
  { id: "9", year: 2021, robos: 91 },
];
const ctx = {
  datasets: {
    comunas: { rows: comunas, headers: ["id", "nombre"] },
    panel:   { rows: panel,   headers: ["id", "year", "robos"] },
  },
};
const join = (how, rightId) => ({ type: "join", how, rightId, leftKey: "id", rightKey: "id", suffix: "_r" });

// -- 1:m -- the case that was broken -----------------------------------------
// left_join(comunas, panel): comunas 1 and 2 match 2 rows each, comuna 3 matches
// none and is kept with nulls. dplyr gives 2 + 2 + 1 = 5.
const oneToMany = applyStep(comunas, ["id", "nombre"], join("left", "panel"), ctx);
assert.equal(oneToMany.rows.length, 5, "left join must expand 1:m (was collapsing to 3)");
assert.equal(oneToMany.rows.filter(r => r.id === "1").length, 2);
assert.equal(oneToMany.rows.find(r => r.id === "3").robos, null, "unmatched left row kept with null");
assert.deepEqual(oneToMany.headers, ["id", "nombre", "year", "robos"]);

// -- m:1 -- must be unchanged ------------------------------------------------
const manyToOne = applyStep(panel, ["id", "year", "robos"], join("left", "comunas"), ctx);
assert.equal(manyToOne.rows.length, 6, "m:1 left join must keep every left row exactly once");
assert.equal(manyToOne.rows.find(r => r.id === "9").nombre, null);

// -- inner -- drops unmatched left, still expands ----------------------------
const inner = applyStep(comunas, ["id", "nombre"], join("inner", "panel"), ctx);
assert.equal(inner.rows.length, 4, "inner join: 2 comunas x 2 years, comuna 3 dropped");

// -- full -- expands, then appends every unmatched right ROW -----------------
// 4 matched pairs + comuna 3 (no right) + id 9's TWO rows (no left) = 7.
const full = applyStep(comunas, ["id", "nombre"], join("full", "panel"), ctx);
assert.equal(full.rows.length, 7, "full join must append every unmatched right row, not one per key");

// -- right -- iterate right, expand over all left matches --------------------
const right = applyStep(comunas, ["id", "nombre"], join("right", "panel"), ctx);
assert.equal(right.rows.length, 6, "right join keeps every right row");
assert.equal(right.rows.filter(r => r.nombre === null).length, 2, "id 9's rows get null left cols");

// -- semi / anti -- filtering joins never expand -----------------------------
assert.equal(applyStep(comunas, ["id", "nombre"], join("semi", "panel"), ctx).rows.length, 2);
assert.equal(applyStep(comunas, ["id", "nombre"], join("anti", "panel"), ctx).rows.length, 1);

// -- suffix -- only the RIGHT side's conflicting column is renamed -----------
const clash = { datasets: { r: { rows: [{ id: "1", nombre: "X" }], headers: ["id", "nombre"] } } };
const suffixed = applyStep([{ id: "1", nombre: "A" }], ["id", "nombre"],
  { type: "join", how: "left", rightId: "r", leftKey: "id", rightKey: "id", suffix: "_r" }, clash);
assert.deepEqual(suffixed.headers, ["id", "nombre", "nombre_r"]);
assert.equal(suffixed.rows[0].nombre, "A");
assert.equal(suffixed.rows[0].nombre_r, "X");

console.log("joinCardinalityValidation: join OK");
