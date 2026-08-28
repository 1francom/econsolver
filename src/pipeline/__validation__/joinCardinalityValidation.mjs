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

// -- lookup: attach columns from a right side that MUST be unique per key ----
// Stata `merge m:1` / dplyr relationship = "many-to-one". This is the op people
// actually want when pinning metadata onto a panel. It never expands, and it
// REFUSES to run rather than silently picking one of several matches -- which is
// exactly what the old first-match join did.
const lookup = (rightId) => ({ type: "lookup", rightId, leftKey: "id", rightKey: "id", suffix: "_r" });

const attached = applyStep(panel, ["id", "year", "robos"], lookup("comunas"), ctx);
assert.equal(attached.rows.length, 6, "lookup never changes the left row count");
assert.equal(attached.rows[0].nombre, "A");
assert.equal(attached.rows.find(r => r.id === "9").nombre, null, "unmatched left row kept with null");
assert.deepEqual(attached.headers, ["id", "year", "robos", "nombre"]);

// The wrong direction must FAIL LOUDLY, not truncate the panel to one year.
assert.throws(
  () => applyStep(comunas, ["id", "nombre"], lookup("panel"), ctx),
  /not unique/,
  "lookup against a panel must throw, not collapse it"
);

console.log("joinCardinalityValidation: lookup OK");

// -- Translators must stop faking the old first-match behaviour --------------
// R/Python/Stata each emitted a dedup of the right side (distinct / drop_duplicates
// / bysort keep if _n==1) to reproduce the collapsing JS join. Now that the join
// expands, that dedup makes the SCRIPT disagree with the app.
const { toR, toPython, toStata } = await import("../stepTranslators.js");

const dsNames = { comunas: { name: "comunas", filename: "comunas.csv" } };
const jStep = { type: "join", how: "left", rightId: "comunas", leftKey: "id", rightKey: "id", suffix: "_r" };
const lStep = { type: "lookup", rightId: "comunas", leftKey: "id", rightKey: "id", suffix: "_r" };

const rJoin = toR(jStep, "df_panel", dsNames);
assert.doesNotMatch(rJoin, /distinct/, "R join must not dedup the right side any more");
assert.match(rJoin, /left_join/);
assert.match(rJoin, /suffix = c\("", "_r"\)/, "R must emit the asymmetric suffix Litux uses");

const pyJoin = toPython(jStep, "df_panel", dsNames);
assert.doesNotMatch(pyJoin, /drop_duplicates/, "Python join must not dedup the right side any more");

const stJoin = toStata(jStep, "df", dsNames);
assert.doesNotMatch(stJoin, /_n == 1/, "Stata join must not dedup the right side any more");
assert.match(stJoin, /merge 1:m/, "Stata join must allow expansion");

// lookup keeps the uniqueness contract in every language
assert.match(toR(lStep, "df_panel", dsNames), /relationship = "many-to-one"/);
assert.match(toPython(lStep, "df_panel", dsNames), /validate="m:1"/);
assert.match(toStata(lStep, "df", dsNames), /merge m:1/);

// -- the shared module and the three LOCAL transpileStep copies must agree ---
// rScript.js / pythonScript.js / stataScript.js each carry their own join case.
// They had silently diverged: the local R/Python ones already emitted a real
// dplyr/pandas join (so THAT export path always disagreed with the collapsing JS
// runner), while stataScript used `merge 1:1`, which errors outright on a 1:m
// join. Nothing compared them, so nothing caught it.
const { generateStataScript } = await import("../../services/export/stataScript.js");
const stataLocal = generateStataScript({
  filename: "d.csv", model: {},
  allDatasets: { comunas: { name: "comunas", filename: "comunas.csv" } },
  pipeline: [jStep],
});
assert.match(stataLocal, /merge 1:m/, "stataScript.js's local join must match the shared module's cardinality");
assert.doesNotMatch(stataLocal, /merge 1:1/, "merge 1:1 errors on any repeated key");
// Stata cannot express a true many-to-many merge; both emitters must SAY so
// rather than emit code that silently means something else.
assert.match(stataLocal, /joinby/, "the m:m limitation must be stated in the script, not hidden");
assert.match(toStata(jStep, "df", dsNames), /joinby/, "same note in the shared module");

console.log("joinCardinalityValidation: translators OK");
