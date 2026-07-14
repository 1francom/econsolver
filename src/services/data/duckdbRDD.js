// ECON STUDIO - src/services/data/duckdbRDD.js
// DuckDB local RDD design payloads: synthetic threshold terms + kernel weights.

import { buildWLSSuffStats } from "./duckdbWLS.js";

function esc(c) {
  return `"${String(c).replace(/"/g, '""')}"`;
}

function literal(n) {
  if (!Number.isFinite(n)) throw new Error("RDD numeric literal must be finite.");
  return String(n);
}

export function buildRDDLocalDesign({
  runningCol,
  cutoff,
  bandwidth,
  controls = [],
  dummySQL = {},
}) {
  if (!(bandwidth > 0) || !Number.isFinite(bandwidth)) {
    throw new Error("RDD bandwidth must be a positive finite number.");
  }

  const r = `TRY_CAST(${esc(runningCol)} AS DOUBLE)`;
  const c = literal(cutoff);
  const h = literal(bandwidth);
  const u = `((${r}) - ${c})`;
  const treatment = `CASE WHEN (${r}) >= ${c} THEN 1.0 ELSE 0.0 END`;
  const kernel = `GREATEST(0.0, 1.0 - ABS(${u}) / ${h})`;
  const syntheticSQL = {
    __rdd_treat: treatment,
    __rdd_u: u,
    __rdd_treat_u: `(${treatment}) * (${u})`,
  };

  return {
    xCols: ["__rdd_treat", "__rdd_u", "__rdd_treat_u", ...controls],
    dummySQL: { ...dummySQL, ...syntheticSQL },
    weightSQL: kernel,
    varNames: [
      "(Intercept)",
      "D (treatment)",
      `${runningCol} - c`,
      `D x (${runningCol} - c)`,
      ...controls,
    ],
  };
}

export async function buildRDDSuffStats({
  tableName,
  yCol,
  runningCol,
  cutoff,
  bandwidth,
  controls = [],
  dummySQL = {},
}) {
  const design = buildRDDLocalDesign({
    runningCol,
    cutoff,
    bandwidth,
    controls,
    dummySQL,
  });
  const suff = await buildWLSSuffStats(
    tableName,
    yCol,
    design.xCols,
    null,
    { dummySQL: design.dummySQL, weightSQL: design.weightSQL },
  );
  return { ...suff, ...design };
}
