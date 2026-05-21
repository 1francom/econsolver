// ── Fase 4b: browser validation harness ────────────────────────────────────
// Validates TWFE + panel robust SE (cluster, HC2, HC3, DK-HAC) against R
// fixest / plm / clubSandwich golden values in fase4bBenchmarks.json.
//
// Usage (dev console after `npm run dev`):
//   const r = await window.__validation.fase4b();
//   console.table(r.map(c => ({ cell: c.cell, ok: c.ok, maxCoefDiff: c.maxCoefDiff, maxSeDiff: c.maxSeDiff })));

import { getDuckDB } from "../duckdb.js";
import { buildWithinSuffStats }         from "../duckdbWithin.js";
import { computeWithinHCMeat }          from "../duckdbWithinRobustSE.js";
import { computeWithinClusterMeat }     from "../duckdbWithinClusterSE.js";
import { computeWithinHCMeatWithLeverage } from "../duckdbWithinHC23.js";
import { computeWithinDriscollKraayMeat }  from "../duckdbWithinHAC.js";
import {
  runFEFromSuffStats, runFDFromSuffStats, runTWFEFromSuffStats,
} from "../../../math/PanelSuffStatsEngine.js";

const BENCHMARKS_URL = new URL("./fase4bBenchmarks.json", import.meta.url).href;
const DATA_URL       = new URL("./fase4b_data.csv",        import.meta.url).href;

// Tolerance: coefficients 1e-6, SE 1e-4, HAC/HC2/HC3 cells 1e-3
const TOL_COEF = 1e-6;
const TOL_SE_STRICT = 1e-4;
const TOL_SE_APPROX = 1e-3; // for cells with df-adjustment differences

const APPROX_CELLS = new Set(["fe_hc2", "fe_hc3", "fe_hac", "fd_hac", "twfe_hc2", "twfe_hc3", "twfe_hac"]);

async function loadTable() {
  const { db } = await getDuckDB();
  const resp = await fetch(DATA_URL);
  const csv  = await resp.text();
  await db.registerFileText("fase4b_data.csv", csv);
  await db.query(`CREATE OR REPLACE TABLE fase4b_panel AS SELECT * FROM read_csv_auto('fase4b_data.csv')`);
  return "fase4b_panel";
}

function maxAbsDiff(a, b) {
  return Math.max(...a.map((v, i) => Math.abs(v - (b[i] ?? NaN))));
}

export async function runFase4bNumericalValidation() {
  const [benchmarks, tableName] = await Promise.all([
    fetch(BENCHMARKS_URL).then(r => r.json()),
    loadTable(),
  ]);

  const results = [];

  // Define the 12 cells
  const cells = [
    // FE
    { id: "fe_cluster",  mode: "FE",   seType: "clustered" },
    { id: "fe_hc2",      mode: "FE",   seType: "HC2" },
    { id: "fe_hc3",      mode: "FE",   seType: "HC3" },
    { id: "fe_hac",      mode: "FE",   seType: "HAC" },
    // FD
    { id: "fd_cluster",  mode: "FD",   seType: "clustered" },
    { id: "fd_hc2",      mode: "FD",   seType: "HC2" },
    { id: "fd_hc3",      mode: "FD",   seType: "HC3" },
    { id: "fd_hac",      mode: "FD",   seType: "HAC" },
    // TWFE
    { id: "twfe_cluster", mode: "TWFE", seType: "clustered" },
    { id: "twfe_hc2",     mode: "TWFE", seType: "HC2" },
    { id: "twfe_hc3",     mode: "TWFE", seType: "HC3" },
    { id: "twfe_hac",     mode: "TWFE", seType: "HAC" },
  ];

  for (const cell of cells) {
    const ref = benchmarks[cell.id];
    if (!ref) {
      results.push({ cell: cell.id, ok: false, message: "No benchmark found" });
      continue;
    }

    try {
      const suff = await buildWithinSuffStats(
        tableName, "y", ["x1", "x2"], "id",
        { mode: cell.mode, timeCol: "t" },
      );
      if (!suff) throw new Error("buildWithinSuffStats returned null");

      const solver = cell.mode === "FE"   ? runFEFromSuffStats
        : cell.mode === "FD"   ? runFDFromSuffStats
        : runTWFEFromSuffStats;

      const rCls = solver({ ...suff, meat: null, hcType: null });
      if (!rCls) throw new Error("classical solve returned null");

      let meat = null;
      let engineHcType = null;

      if (cell.seType === "clustered") {
        const m = await computeWithinClusterMeat({
          withinCTEPrefix: suff.withinCTEPrefix,
          k: 2, beta: rCls._betaFull,
        });
        meat = m.meat;

      } else if (cell.seType === "HC2" || cell.seType === "HC3") {
        const m = await computeWithinHCMeatWithLeverage({
          withinCTEPrefix: suff.withinCTEPrefix,
          k: 2, beta: rCls._betaFull, Ainv: rCls.XtXinv, hcType: cell.seType,
        });
        meat = m.meat;
        engineHcType = cell.seType;

      } else if (cell.seType === "HAC") {
        const m = await computeWithinDriscollKraayMeat({
          withinCTEPrefix: suff.withinCTEPrefix,
          k: 2, beta: rCls._betaFull,
        });
        meat = m.meat;
      }

      const rFinal = solver({ ...suff, meat, hcType: engineHcType });
      if (!rFinal) throw new Error("robust solve returned null");

      const coefDiff = maxAbsDiff(rFinal.beta, ref.coef);
      const seDiff   = maxAbsDiff(rFinal.se,   ref.se);
      const tolSe    = APPROX_CELLS.has(cell.id) ? TOL_SE_APPROX : TOL_SE_STRICT;
      const ok       = coefDiff <= TOL_COEF && seDiff <= tolSe;

      results.push({
        cell: cell.id,
        ok,
        maxCoefDiff: coefDiff,
        maxSeDiff:   seDiff,
        tolCoef: TOL_COEF,
        tolSe,
        beta:     rFinal.beta,
        se:       rFinal.se,
        refCoef:  ref.coef,
        refSe:    ref.se,
        message:  ok ? "PASS" : `FAIL coef=${coefDiff.toExponential(2)} se=${seDiff.toExponential(2)}`,
      });
    } catch (err) {
      results.push({ cell: cell.id, ok: false, message: `ERROR: ${err.message}` });
    }
  }

  const nPass = results.filter(r => r.ok).length;
  console.log(`Fase 4b: ${nPass}/${results.length} cells pass`);
  console.table(results.map(r => ({
    cell: r.cell, ok: r.ok,
    coef: r.maxCoefDiff?.toExponential(2),
    se:   r.maxSeDiff?.toExponential(2),
    msg: r.message,
  })));
  return results;
}

// Expose at window.__validation.fase4b
if (typeof window !== "undefined") {
  window.__validation = window.__validation ?? {};
  window.__validation.fase4b = runFase4bNumericalValidation;
}
