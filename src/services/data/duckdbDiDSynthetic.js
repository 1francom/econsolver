// ECON STUDIO - DuckDB synthetic regressors for DiD / Event Study.
// These helpers only assemble payloads consumed by the existing OLS and
// within-sufficient-statistics builders. They do not execute SQL.

function esc(col) {
  return `"${String(col).replace(/"/g, '""')}"`;
}

function assertFiniteHorizon(name, value) {
  if (!Number.isFinite(value) || value < 0) {
    throw new Error(`${name} must be a non-negative number`);
  }
}

/**
 * DiD 2x2: y ~ post + treated + post x treated [+ controls].
 */
export function buildDiD2x2Synthetic({ postCol, treatCol, controls = [] }) {
  if (!postCol || !treatCol) {
    throw new Error("DiD2x2 requires postCol and treatCol");
  }

  const interName = "__did_post_x_treat";
  return {
    xColsExpanded: [postCol, treatCol, interName, ...controls],
    dummySQL: {
      [interName]: `CASE WHEN ${esc(postCol)} = 1 AND ${esc(treatCol)} = 1 THEN 1 ELSE 0 END`,
    },
    attIdx: 3,
    varNames: ["(Intercept)", "Post", "Treated", "Post x Treated (ATT)", ...controls],
  };
}

/**
 * Current TWFE DiD UI contract: the selected treatment column is already the
 * post-treatment indicator consumed by runTWFEDiD.
 */
export function buildTWFEDiDSynthetic({ treatCol, controls = [] }) {
  if (!treatCol) {
    throw new Error("TWFEDiD requires treatCol");
  }

  return {
    xColsExpanded: [treatCol, ...controls],
    dummySQL: {},
    attIdx: 0,
    varNames: ["Treatment (ATT)", ...controls],
  };
}

/**
 * Event Study dummies for the current JS engine contract:
 *   - never-treated units have a null treatment-time column
 *   - k = -1 is the reference period
 *   - periods outside the visible horizon are binned at each endpoint
 */
export function buildEventStudySynthetic({
  timeCol,
  treatTimeCol,
  kPre,
  kPost,
  controls = [],
  refK = -1,
}) {
  if (!timeCol || !treatTimeCol) {
    throw new Error("EventStudy requires timeCol and treatTimeCol");
  }
  assertFiniteHorizon("EventStudy kPre", kPre);
  assertFiniteHorizon("EventStudy kPost", kPost);

  const dummySQL = {};
  const eventTerms = [];
  const eventTimeSQL = `TRY_CAST(${esc(treatTimeCol)} AS DOUBLE)`;
  const relativeTimeSQL = `(TRY_CAST(${esc(timeCol)} AS DOUBLE) - ${eventTimeSQL})`;
  for (let k = -kPre; k <= kPost; k++) {
    if (k === refK) continue;
    const name = `__ev_k${k >= 0 ? "_p" : "_m"}${Math.abs(k)}`;
    dummySQL[name] =
      `CASE WHEN ${eventTimeSQL} IS NOT NULL ` +
      `AND ${relativeTimeSQL} = ${k} THEN 1 ELSE 0 END`;
    eventTerms.push({ k, name });
  }

  const preBin = "__ev_pre_bin";
  const postBin = "__ev_post_bin";
  dummySQL[preBin] =
    `CASE WHEN ${eventTimeSQL} IS NOT NULL ` +
    `AND ${relativeTimeSQL} < ${-kPre} THEN 1 ELSE 0 END`;
  dummySQL[postBin] =
    `CASE WHEN ${eventTimeSQL} IS NOT NULL ` +
    `AND ${relativeTimeSQL} > ${kPost} THEN 1 ELSE 0 END`;

  return {
    xColsExpanded: [...eventTerms.map(t => t.name), preBin, postBin, ...controls],
    dummySQL,
    eventTerms,
    refK,
    varNames: [
      ...eventTerms.map(({ k }) => `Event k=${k >= 0 ? `+${k}` : k}`),
      "Pre-window bin",
      "Post-window bin",
      ...controls,
    ],
  };
}
