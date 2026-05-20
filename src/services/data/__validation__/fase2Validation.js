// Structural + numerical validation for Fase 2: clustered, twoway, HAC,
// White, Breusch-Godfrey. Mirrors robustSEValidation.runFase1NumericalValidation.

import { buildOLSSuffStats }        from "../duckdbOLS.js";
import { expandFactors }            from "../duckdbFactors.js";
import { computeClusterMeat,
         computeTwowayClusterMeat,
         countClusters }            from "../duckdbClusterSE.js";
import { computeHACMeat }           from "../duckdbHACSE.js";
import { whiteTestSQL,
         breuschGodfreySQL }        from "../duckdbDiagnostics.js";
import { runOLSFromSuffStats }      from "../../../math/LinearEngine.js";

const close4 = (a, b) => Math.abs(a - b) < 1e-4;
const close6 = (a, b) => Math.abs(a - b) < 1e-6;

export async function runFase2NumericalValidation(tableName = "fase2") {
  const benchResp = await fetch(new URL("./fase2Benchmarks.json", import.meta.url));
  const B = await benchResp.json();

  let p = 0, f = 0;
  const c = (n, ok) => ok ? (p++, console.log(`  ✓ ${n}`)) : (f++, console.error(`  ✗ ${n}`));

  const { xColsExpanded, dummySQL } = await expandFactors({
    xCols: ["x1", "x2"], tableName,
  });
  const suff      = await buildOLSSuffStats(tableName, "y", xColsExpanded, { dummySQL });
  const classical = runOLSFromSuffStats({ ...suff });

  B.beta.forEach((b, i) =>
    c(`β[${i}] matches R (6dp)`, close6(classical.beta[i], b)));

  // ── Clustered (one-way, by firm) ─────────────────────────────────────────
  const card = await countClusters(tableName, "firm");
  c(`countClusters reports G=${card.G}`, card.G === 200);
  const cl = await computeClusterMeat({
    tableName, yCol: "y", xColsExpanded, dummySQL,
    beta: classical.beta, clusterCol: "firm",
  });
  const rCl = runOLSFromSuffStats({ ...suff, meat: cl.meat, hcType: null });
  B.se_clustered.forEach((s, i) =>
    c(`SE clustered[${i}] (4dp)`, close4(rCl.se[i], s)));

  // ── Two-way (firm × year, CGM) ────────────────────────────────────────────
  const tw = await computeTwowayClusterMeat({
    tableName, yCol: "y", xColsExpanded, dummySQL,
    beta: classical.beta, clusterCol: "firm", clusterCol2: "year",
  });
  const rTw = runOLSFromSuffStats({ ...suff, meat: tw.meat, hcType: null });
  B.se_twoway.forEach((s, i) =>
    c(`SE twoway[${i}] (4dp)`, close4(rTw.se[i], s)));

  // ── HAC (Newey-West, auto bandwidth, ordered by __ri inside firm) ────────
  const hac = await computeHACMeat({
    tableName, yCol: "y", xColsExpanded, dummySQL,
    beta: classical.beta, orderCol: "__ri", entityCol: "firm",
  });
  const rHac = runOLSFromSuffStats({ ...suff, meat: hac.meat, hcType: null });
  c(`HAC bandwidth L matches R (${B.L_hac})`, hac.L === B.L_hac);
  B.se_hac.forEach((s, i) =>
    c(`SE HAC[${i}] (4dp)`, close4(rHac.se[i], s)));

  // ── White test ───────────────────────────────────────────────────────────
  const w = await whiteTestSQL({
    tableName, yCol: "y", xColsExpanded, dummySQL, beta: classical.beta,
  });
  const auxW = runOLSFromSuffStats({
    n: w.n, XtX: w.XtXAux, XtY: w.XtYAux,
    YtY: w.YtYAux, sumY: w.sumYAux, varNames: w.varNamesAux,
  });
  // R² = 1 - SSR/SST with SST = YtY - n·meanY² and SSR returned via auxW.
  const meanY2 = (w.sumYAux / w.n);
  const SST    = w.YtYAux - w.n * meanY2 * meanY2;
  const SSR    = auxW.ssr;  // engine returns ssr in result
  const r2W    = 1 - SSR / SST;
  const whiteStat = w.n * r2W;
  c(`White stat (4dp): ${whiteStat.toFixed(4)} vs ${B.white_stat.toFixed(4)}`,
    close4(whiteStat, B.white_stat));
  c(`White df matches`, w.pAux - 1 === B.white_df);

  // ── Breusch-Godfrey lag 1 ────────────────────────────────────────────────
  const bg = await breuschGodfreySQL({
    tableName, yCol: "y", xColsExpanded, dummySQL, beta: classical.beta,
    maxLag: 1, orderCol: "__ri", entityCol: "firm",
  });
  const auxBG = runOLSFromSuffStats({
    n: bg.n, XtX: bg.XtXAux, XtY: bg.XtYAux,
    YtY: bg.YtYAux, sumY: bg.sumYAux, varNames: bg.varNamesAux,
  });
  const meanYBG = bg.sumYAux / bg.n;
  const SST_bg  = bg.YtYAux - bg.n * meanYBG * meanYBG;
  const r2_bg   = 1 - auxBG.ssr / SST_bg;
  const bgStat  = bg.n * r2_bg;
  c(`BG stat (4dp): ${bgStat.toFixed(4)} vs ${B.bg_stat.toFixed(4)}`,
    close4(bgStat, B.bg_stat));
  c(`BG df matches`, bg.p === B.bg_df);

  console.log(`\n${p} passed, ${f} failed`);
  return f === 0;
}

if (typeof window !== "undefined") {
  window.__validation = window.__validation ?? {};
  window.__validation.fase2 = runFase2NumericalValidation;
}
