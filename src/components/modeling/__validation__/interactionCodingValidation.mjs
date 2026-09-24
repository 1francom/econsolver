// ─── ECON STUDIO · interactionCodingValidation.mjs ───────────────────────────
// R's coding rule for a factor inside an interaction: contrasts (a reference
// dropped) only if the rest of the term is itself in the model. For `x:f` that
// is `x` as a main effect. Without it every level is coded — one slope per
// group — and dropping a reference forces that group's slope to ZERO.
//
// Found on real data (Franco, 2026-09-18): `gdp ~ education:continent |
// country + year` gave 4 slopes in Litux and 5 in fixest, every slope biased,
// within R² 0.1162 vs 0.1367. T3 pins the fixed estimate against numbers from
// R 4.4.1 fixest::feols on the same deterministic fixture (also matched by the
// exported Stata reghdfe and Python PanelOLS scripts, run by hand).
//   node src/components/modeling/__validation__/interactionCodingValidation.mjs
import assert from "node:assert/strict";
import { expandInteractions } from "../helpers.js";
import { dispatchEstimation } from "../runners/estimationDispatch.js";

let pass = 0;
const check = (name, fn) => { try { fn(); pass++; console.log(`  ok   ${name}`); }
  catch (e) { console.error(`  FAIL ${name}\n       ${e.message}`); process.exitCode = 1; } };

const rows = [
  { x: 1, f: "a", g: "p" }, { x: 2, f: "b", g: "q" }, { x: 3, f: "c", g: "p" }, { x: 4, f: "a", g: "q" },
];
const fv = new Set(["f", "g"]);
const ixCols = (xVars, terms) => expandInteractions(rows, xVars, [], terms, fv).xVars.filter(v => v.includes(":"));

check("T1 x:f without x codes every level of f", () => {
  assert.deepEqual(ixCols([], [{ var1: "x", var2: "f", type: ":" }]), ["x:f_a", "x:f_b", "x:f_c"]);
});

check("T2 with x as a main effect (or via *) the reference is dropped", () => {
  assert.deepEqual(ixCols(["x"], [{ var1: "x", var2: "f", type: ":" }]), ["x:f_b", "x:f_c"]);
  assert.deepEqual(ixCols([], [{ var1: "x", var2: "f", type: "*" }]), ["x:f_b", "x:f_c"]);
  // f's OWN main effect does not count — R still gives one slope per level.
  assert.deepEqual(ixCols(["f"], [{ var1: "x", var2: "f", type: ":" }]), ["x:f_a", "x:f_b", "x:f_c"]);
  // factor × factor is untouched by this rule (still an open item).
  assert.deepEqual(ixCols([], [{ var1: "f", var2: "g", type: ":" }]), ["f_b:g_q", "f_c:g_q"]);
});

// The fixture from the R comparison — deterministic LCG, unbalanced panel.
function fixture() {
  let s = 12345; const rnd = () => (s = (s * 1664525 + 1013904223) % 4294967296) / 4294967296;
  const conts = ["Africa", "Americas", "Asia", "Europe", "Oceania"];
  const slope = { Africa: -2.0, Americas: -0.2, Asia: 0.3, Europe: 2.4, Oceania: -1.0 };
  const out = [];
  for (let c = 0; c < 60; c++) {
    const cont = conts[c % 5];
    const cfe = rnd() * 10;
    for (let y = 1990; y < 2010; y++) {
      if (rnd() < 0.05) continue;
      const edu = 2 + rnd() * 8 + (y - 1990) * 0.1;
      out.push({ country: `C${c}`, year: y, continent: cont, education: edu,
        gdp: cfe + (y - 1990) * 0.3 + slope[cont] * edu + (rnd() - 0.5) * 3 });
    }
  }
  return out;
}

check("T3 two-way FE group slopes match fixest::feols to 1e-8", () => {
  const d = dispatchEstimation(fixture(), {
    model: "FE", family: "linear", yVar: ["gdp"], xVars: [], wVars: [], zVars: [],
    factorVars: new Set(["continent"]), factorRefs: {},
    interactionTerms: [{ var1: "education", var2: "continent", type: ":" }],
    weightVar: [], postVar: [], treatVar: [], runningVar: [], treatTimeCol: [],
    panel: { entityCol: "country", timeCol: "year" }, feCols: ["country", "year"],
    seType: "classical", clusterVar: null,
    seOpts: { seType: "classical", clusterVar: null, clusterVar2: null, timeVar: "year", maxLag: null },
    poissonExtraFE: [],
  });
  assert.ok(!d.error, d.error);
  const r = d.panelFE ?? d.result;
  // R: feols(gdp ~ education:factor(continent) | country + year, df)
  const R = {
    "education:continent_Africa":   [-2.0466234221, 0.02603005393],
    "education:continent_Americas": [-0.1955888160, 0.02541124123],
    "education:continent_Asia":     [ 0.2865222958, 0.02525615133],
    "education:continent_Europe":   [ 2.4101085113, 0.02401487519],
    "education:continent_Oceania":  [-0.9835766629, 0.02497404579],
  };
  assert.deepEqual([...r.varNames].sort(), Object.keys(R).sort());
  r.varNames.forEach((v, i) => {
    assert.ok(Math.abs(r.beta[i] - R[v][0]) < 1e-8, `${v} β ${r.beta[i]} vs ${R[v][0]}`);
    assert.ok(Math.abs(r.se[i] - R[v][1]) < 1e-8, `${v} SE ${r.se[i]} vs ${R[v][1]}`);
  });
  assert.equal(r.df, 1057);
});

check("T4 an interaction-only string factor reaches factorMap (Stata must encode it)", () => {
  const d = dispatchEstimation(fixture(), {
    model: "OLS", family: "linear", yVar: ["gdp"], xVars: [], wVars: [], zVars: [],
    factorVars: new Set(["continent"]), factorRefs: {},
    interactionTerms: [{ var1: "education", var2: "continent", type: ":" }],
    weightVar: [], postVar: [], treatVar: [], runningVar: [], treatTimeCol: [], panel: null,
    seType: "classical", clusterVar: null,
    seOpts: { seType: "classical", clusterVar: null, clusterVar2: null, timeVar: null, maxLag: null },
    poissonExtraFE: [],
  });
  assert.ok(!d.error, d.error);
  const fm = d.result.factorMap ?? {};
  const levels = Object.values(fm).filter(e => e.factor === "continent").map(e => e.level).sort();
  assert.deepEqual(levels, ["Africa", "Americas", "Asia", "Europe", "Oceania"]);
});

console.log(`\ninteractionCoding: ${pass} checks passed${process.exitCode ? " (with failures)" : ""}`);
