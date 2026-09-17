// ─── ECON STUDIO · services/data/duckdbExplore.js ────────────────────────────
// SQL counterparts of the two JS computations Explore needed the FULL table
// for: column info (validator.js buildInfo) and the Summary table's
// per-variable stats. With these, a DuckDB-backed dataset opens in Explore
// without materialising every row into JS objects — which is what made a large
// dataset take seconds (and hundreds of MB) just to show the first tab.
//
// Both take `run(sql) → Promise<Array<object>>`, so the browser passes a DuckDB
// connection wrapper and the node harness passes the node build: the SQL is
// checked against the JS implementations it replaces
// (__validation__/duckdbExploreValidation.mjs).

const q = (c) => `"${String(c).replace(/"/g, '""')}"`;
const num = (v) => (v === null || v === undefined ? null : Number(v));

const NUMERIC_TYPE = /^(TINYINT|SMALLINT|INTEGER|BIGINT|HUGEINT|UTINYINT|USMALLINT|UINTEGER|UBIGINT|UHUGEINT|FLOAT|REAL|DOUBLE|DECIMAL.*|INT\d*)$/i;

export async function columnTypes(run, table) {
  const rows = await run(`DESCRIBE ${q(table)}`);
  const out = {};
  for (const r of rows) out[r.column_name] = String(r.column_type);
  return out;
}

// buildInfo()'s shape, from SQL. Semantics match the JS version: std is the
// population SD, q1/q3 are the order statistics at floor(k·p) of the sorted
// finite values (0-based), the median averages the two middle values, and
// outliers are counted against the 1.5·IQR fences. Non-numeric columns get
// uVals (≤ 20 of their distinct values) only when they have ≤ 30 distinct
// values, the only case in which a categorical control needs them.
export async function fetchColumnInfoSQL(run, table, headers, { chunk = 20 } = {}) {
  const types = await columnTypes(run, table);
  const info = {};
  for (let s = 0; s < headers.length; s += chunk) {
    const cols = headers.slice(s, s + chunk);
    const sel = ["count(*) AS n"];
    cols.forEach((c, i) => {
      const x = q(c);
      sel.push(`count(${x}) AS nn_${i}`, `count(DISTINCT ${x}) AS u_${i}`);
      if (NUMERIC_TYPE.test(types[c] ?? "")) {
        // isfinite() filters the ±inf / NaN the JS version drops.
        const f = `CASE WHEN isfinite(${x}::DOUBLE) THEN ${x}::DOUBLE END`;
        sel.push(
          `count(${f}) AS k_${i}`,
          `sum(${f}) AS sum_${i}`,
          `stddev_pop(${f}) AS sd_${i}`,
          `min(${f}) AS min_${i}`, `max(${f}) AS max_${i}`,
          `quantile_cont(${f}, 0.5) AS med_${i}`,
        );
      }
    });
    const [agg] = await run(`SELECT ${sel.join(", ")} FROM ${q(table)}`);
    const n = num(agg.n);

    // q1/q3 as order statistics need k first: row_number over the sorted values.
    const numCols = cols.map((c, i) => [c, i]).filter(([c]) => NUMERIC_TYPE.test(types[c] ?? ""));
    const qs = {};
    for (const [c, i] of numCols) {
      const k = num(agg[`k_${i}`]);
      if (!k) continue;
      const i1 = Math.floor(k * 0.25), i3 = Math.floor(k * 0.75);
      const x = q(c);
      const rows = await run(
        `SELECT rn, v FROM (SELECT ${x}::DOUBLE AS v, row_number() OVER (ORDER BY ${x}::DOUBLE) - 1 AS rn
           FROM ${q(table)} WHERE isfinite(${x}::DOUBLE)) WHERE rn IN (${i1}, ${i3})`);
      const at = Object.fromEntries(rows.map(r => [num(r.rn), num(r.v)]));
      qs[c] = { q1: at[i1] ?? null, q3: at[i3] ?? null };
    }
    // Outliers against the fences, one pass for the whole chunk.
    const outSel = numCols
      .filter(([c]) => qs[c]?.q1 != null && qs[c]?.q3 != null)
      .map(([c, i]) => {
        const iqr = qs[c].q3 - qs[c].q1;
        const lo = qs[c].q1 - 1.5 * iqr, hi = qs[c].q3 + 1.5 * iqr;
        return `count(CASE WHEN isfinite(${q(c)}::DOUBLE) AND (${q(c)}::DOUBLE < ${lo} OR ${q(c)}::DOUBLE > ${hi}) THEN 1 END) AS o_${i}`;
      });
    const out = outSel.length ? (await run(`SELECT ${outSel.join(", ")} FROM ${q(table)}`))[0] : {};

    // Distinct values for low-cardinality non-numeric columns.
    const catCols = cols.map((c, i) => [c, i]).filter(([c, i]) => !NUMERIC_TYPE.test(types[c] ?? "") && num(agg[`u_${i}`]) <= 30);
    const uv = catCols.length
      ? (await run(`SELECT ${catCols.map(([c, i]) => `list_slice(list(DISTINCT ${q(c)}) FILTER (WHERE ${q(c)} IS NOT NULL), 1, 20) AS uv_${i}`).join(", ")} FROM ${q(table)}`))[0]
      : {};

    cols.forEach((c, i) => {
      const nn = num(agg[`nn_${i}`]), u = num(agg[`u_${i}`]);
      const isNumType = NUMERIC_TYPE.test(types[c] ?? "");
      const k = isNumType ? num(agg[`k_${i}`]) : 0;
      const mean = k ? num(agg[`sum_${i}`]) / k : null;
      const q1 = qs[c]?.q1 ?? null, q3 = qs[c]?.q3 ?? null;
      const iqr = q1 != null && q3 != null ? q3 - q1 : null;
      const na = n - nn;
      info[c] = {
        isNum: isNumType && nn > 0,
        isCat: !isNumType && nn > 0 && u <= 30,
        naCount: na,
        naPct: n ? na / n : 0,
        total: n,
        uCount: u,
        uVals: Array.from(uv[`uv_${i}`] ?? []).slice(0, 20),
        mean,
        std: k ? num(agg[`sd_${i}`]) : null,
        median: k ? num(agg[`med_${i}`]) : null,
        q1, q3, iqr,
        min: k ? num(agg[`min_${i}`]) : null,
        max: k ? num(agg[`max_${i}`]) : null,
        outliers: num(out[`o_${i}`]) ?? 0,
      };
    });
  }
  return info;
}

// The Summary table's statsFor(), for many columns and optional groups:
// { groups: [key...], counts: { [groupKey]: rows }, stats: { [col]: { [groupKey]: {mean,std,min,max,median,q1,q3,n,p5,...} } } }.
// Quantiles are linear-interpolated (quantile_cont), std is the population SD —
// both exactly what the JS table computes. Rows whose group value is NULL are
// dropped, and group keys are ordered like the JS default sort (by String()).
export async function fetchSummaryStatsSQL(run, table, cols, { groupBy = null, quantiles = [] } = {}) {
  const ALL = "__all__";
  const probs = [0.25, 0.5, 0.75, ...quantiles.map(p => p / 100)];
  const sel = [groupBy ? `${q(groupBy)} AS g` : `'${ALL}' AS g`, "count(*) AS gn"];
  cols.forEach((c, i) => {
    const f = `CASE WHEN isfinite(${q(c)}::DOUBLE) THEN ${q(c)}::DOUBLE END`;
    sel.push(
      `count(${f}) AS n_${i}`, `avg(${f}) AS mean_${i}`, `stddev_pop(${f}) AS sd_${i}`,
      `min(${f}) AS min_${i}`, `max(${f}) AS max_${i}`,
      `quantile_cont(${f}, [${probs.join(", ")}]) AS qs_${i}`,
    );
  });
  const sql = `SELECT ${sel.join(", ")} FROM ${q(table)}`
    + (groupBy ? ` WHERE ${q(groupBy)} IS NOT NULL GROUP BY ${q(groupBy)}` : "");
  const rows = await run(sql);
  const keyOf = (v) => (v !== null && typeof v === "object" && "valueOf" in v ? v.valueOf() : v);
  const groups = groupBy
    ? rows.map(r => keyOf(r.g)).sort((a, b) => (String(a) < String(b) ? -1 : String(a) > String(b) ? 1 : 0))
    : ["All"];
  const byKey = new Map(rows.map(r => [groupBy ? keyOf(r.g) : "All", r]));
  const stats = {};
  const counts = Object.fromEntries(groups.map(g => [g, num(byKey.get(g)?.gn) ?? 0]));
  cols.forEach((c, i) => {
    stats[c] = {};
    for (const g of groups) {
      const r = byKey.get(g);
      const n = num(r?.[`n_${i}`]) ?? 0;
      if (!n) { stats[c][g] = { mean: null, std: null, min: null, max: null, median: null, q1: null, q3: null, n: 0 }; continue; }
      const qv = Array.from(r[`qs_${i}`] ?? [], num);
      const extra = {};
      quantiles.forEach((p, j) => { extra[`p${p}`] = qv[3 + j] ?? null; });
      stats[c][g] = {
        mean: num(r[`mean_${i}`]), std: num(r[`sd_${i}`]),
        min: num(r[`min_${i}`]), max: num(r[`max_${i}`]),
        median: qv[1] ?? null, q1: qv[0] ?? null, q3: qv[2] ?? null, n, ...extra,
      };
    }
  });
  return { groups, stats, counts };
}

// Rows of a DuckDB result as plain objects with JS numbers (BigInt → Number).
export function plainRows(arrowTable) {
  return arrowTable.toArray().map(r => {
    const o = {};
    for (const [k, v] of Object.entries(r.toJSON ? r.toJSON() : r)) {
      o[k] = typeof v === "bigint" ? Number(v) : v;
    }
    return o;
  });
}

// Browser runner: the app's DuckDB connection, rows as plain objects.
export async function runDuckSQL(sql) {
  const { getDuckDB } = await import("./duckdb.js");
  const { conn } = await getDuckDB();
  return plainRows(await conn.query(sql));
}
