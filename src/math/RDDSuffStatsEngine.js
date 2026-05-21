// ECON STUDIO - src/math/RDDSuffStatsEngine.js
// Sharp and fuzzy RDD solvers over DuckDB kernel-weighted sufficient stats.

import { pValue } from "./LinearEngine.js";
import { runWLSFromSuffStats } from "./WLSEngine.js";
import { buildRDDSuffStats } from "../services/data/duckdbRDD.js";
import { computeIKBandwidthSQL } from "../services/data/duckdbRDDBandwidth.js";
import { computeWLSHCMeat } from "../services/data/duckdbWLSRobustSE.js";
import { runMcCrarySQL } from "../services/data/duckdbRDDMcCrary.js";

async function solveSharpRDD({
  tableName,
  yCol,
  runningCol,
  cutoff,
  bandwidth,
  controls,
  dummySQL,
  seType,
}) {
  const suff = await buildRDDSuffStats({
    tableName,
    yCol,
    runningCol,
    cutoff,
    bandwidth,
    controls,
    dummySQL,
  });
  const classical = runWLSFromSuffStats({ ...suff, meat: null, hcType: null });
  if (!classical) return null;
  if (seType !== "HC0" && seType !== "HC1") {
    return { result: classical, suff };
  }

  const mm = await computeWLSHCMeat({
    tableName,
    yCol,
    xCols: suff.xCols,
    wCol: null,
    weightSQL: suff.weightSQL,
    dummySQL: suff.dummySQL,
    beta: classical.beta,
  });
  const robust = runWLSFromSuffStats({
    ...suff,
    meat: mm.meat,
    hcType: seType === "HC1" ? "HC1" : null,
  });
  return robust ? { result: robust, suff } : null;
}

export async function runSharpRDDFromSuffStats({
  tableName,
  yCol,
  runningCol,
  cutoff,
  bandwidth = null,
  controls = [],
  dummySQL = {},
  seType = "classical",
}) {
  let h = bandwidth;
  let ikDetails = null;
  if (!(h > 0) || !Number.isFinite(h)) {
    const ik = await computeIKBandwidthSQL({ tableName, yCol, runningCol, cutoff });
    h = ik.h;
    ikDetails = ik.components;
  }
  if (!(h > 0) || !Number.isFinite(h)) {
    return { error: "Bandwidth selection failed - check the running variable spread." };
  }

  const solved = await solveSharpRDD({
    tableName,
    yCol,
    runningCol,
    cutoff,
    bandwidth: h,
    controls,
    dummySQL,
    seType,
  });
  if (!solved) return { error: "RDD local WLS is singular within the bandwidth." };

  const { result, suff } = solved;
  const mcCrary = await runMcCrarySQL({
    tableName,
    runningCol,
    cutoff,
  });
  return {
    ...result,
    varNames: suff.varNames,
    cutoff,
    h,
    bandwidth: h,
    kernelType: "triangular",
    kernel: "triangular",
    valid: [],
    xc: [],
    D: [],
    Y: [],
    W: [],
    leftFit: [],
    rightFit: [],
    late: result.beta[1] ?? null,
    lateSE: result.se[1] ?? null,
    lateP: result.pVals[1] ?? null,
    ikDetails,
    mcCrary,
  };
}

export async function runFuzzyRDDFromSuffStats({
  tableName,
  yCol,
  treatCol,
  runningCol,
  cutoff,
  bandwidth = null,
  controls = [],
  dummySQL = {},
  seType = "classical",
}) {
  const reduced = await runSharpRDDFromSuffStats({
    tableName,
    yCol,
    runningCol,
    cutoff,
    bandwidth,
    controls,
    dummySQL,
    seType,
  });
  if (reduced.error) return reduced;

  const first = await runSharpRDDFromSuffStats({
    tableName,
    yCol: treatCol,
    runningCol,
    cutoff,
    bandwidth: reduced.h,
    controls,
    dummySQL,
    seType,
  });
  if (first.error) return first;
  if (!Number.isFinite(first.late) || Math.abs(first.late) < 1e-12) {
    return { error: "Fuzzy RDD first-stage jump is near zero." };
  }

  const late = reduced.late / first.late;
  const varLate = (reduced.lateSE ** 2) / (first.late ** 2)
    + ((reduced.late ** 2) * (first.lateSE ** 2)) / (first.late ** 4);
  const lateSE = Math.sqrt(Math.max(0, varLate));
  const lateT = lateSE > 0 ? late / lateSE : NaN;
  const df = Math.max(1, Math.min(reduced.df ?? 1, first.df ?? 1));
  const p = Number.isFinite(lateT) ? pValue(lateT, df) : NaN;

  return {
    beta: [NaN, late, NaN, NaN],
    se: [NaN, lateSE, NaN, NaN],
    tStats: [NaN, lateT, NaN, NaN],
    pVals: [NaN, p, NaN, NaN],
    varNames: ["(Intercept)", "D (LATE)", "running - c", "Z x (running - c)"],
    R2: null,
    n: reduced.n,
    df,
    late,
    lateSE,
    lateT,
    lateP: p,
    firstStageFstat: null,
    firstStageJumpD: first.late,
    firstStageR2: first.R2 ?? null,
    weak: Math.abs(first.late) < 0.1,
    waldRatio: late,
    reducedForm: reduced,
    bandwidth: reduced.h,
    h: reduced.h,
    kernel: "triangular",
    kernelType: "triangular",
    cutoff,
    leftFit: [],
    rightFit: [],
    Yhat: [],
    valid: [],
    xc: [],
    above: [],
    D: [],
    Y: [],
    W: [],
    Dhat: [],
    _fuzzyDeltaMethod: true,
    mcCrary: reduced.mcCrary ?? null,
  };
}
