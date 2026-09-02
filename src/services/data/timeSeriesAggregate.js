// ─── ECON STUDIO · services/data/timeSeriesAggregate.js ─────────────────────
// Aggregating rows into time-series points, in JS and in SQL.
//
// Lifted out of ExplorerModule so the Time-series tab, the pin Compare view and
// the multi-series (plot.zoo) chart can all read the SAME aggregation instead of
// growing private copies that drift.

import { queryDuckDB } from "./duckdb.js";

// Aggregate rows into time-series points — SHARED by TimeSeriesTab and the pin
// Compare so both render identical data. Returns [{ grp, pts:[{t,y}] }].
export function aggregateTimeSeries(rows, tCol, yCol, grpCol, agg) {
  if (!tCol || !yCol || !rows?.length) return [];
  const valid = rows.filter(r =>
    typeof r[tCol] === "number" && isFinite(r[tCol]) &&
    (agg === "count" || (typeof r[yCol] === "number" && isFinite(r[yCol])))
  );
  if (!valid.length) return [];
  const groups = grpCol ? [...new Set(valid.map(r => String(r[grpCol] ?? "")))] : ["_all_"];
  return groups.map(grp => {
    const subset = grpCol ? valid.filter(r => String(r[grpCol] ?? "") === grp) : valid;
    const byT = {};
    subset.forEach(r => { const t = r[tCol]; (byT[t] = byT[t] || []).push(agg !== "count" ? r[yCol] : 1); });
    const pts = Object.entries(byT).map(([t, vals]) => {
      const tv = parseFloat(t);
      let y;
      if (agg === "mean")   y = vals.reduce((s, v) => s + v, 0) / vals.length;
      if (agg === "sum")    y = vals.reduce((s, v) => s + v, 0);
      if (agg === "count")  y = vals.length;
      if (agg === "median") { const s = [...vals].sort((a, b) => a - b); y = s[Math.floor(s.length / 2)]; }
      return { t: tv, y };
    }).sort((a, b) => a.t - b.t);
    return { grp, pts };
  }).filter(s => s.pts.length > 0);
}

// SQL equivalent of aggregateTimeSeries() — GROUP BY (grpCol, tCol) inside DuckDB, so
// only the resulting (group × period) points cross into JS, correct and fast at any
// row count. Falls back to the JS version above for small/non-DuckDB datasets and
// filtered views. Reused for flatY too (grpCol="", agg="mean" — always the mean of
// yCol per period, independent of the chart's own agg selector).
export async function fetchAggregateTimeSeriesSQL(duckTable, tCol, yCol, grpCol, agg) {
  const esc = s => `"${String(s).replace(/"/g, '""')}"`;
  const AGG_SQL = {
    mean:   c => `avg(${c})`,
    sum:    c => `sum(${c})`,
    count:  () => `count(*)`,
    median: c => `percentile_cont(0.5) WITHIN GROUP (ORDER BY ${c})`,
  };
  const grpSel = grpCol ? `${esc(grpCol)} AS grp, ` : "";
  const groupBy = grpCol ? `${esc(grpCol)}, ${esc(tCol)}` : esc(tCol);
  const where = [`${esc(tCol)} IS NOT NULL`, ...(agg !== "count" ? [`${esc(yCol)} IS NOT NULL`] : [])].join(" AND ");
  const sql = `SELECT ${grpSel}${esc(tCol)} AS t, ${AGG_SQL[agg](esc(yCol))} AS y FROM "${duckTable}" WHERE ${where} GROUP BY ${groupBy} ORDER BY ${groupBy}`;
  const { rows } = await queryDuckDB(sql);
  const byGrp = new Map();
  rows.forEach(r => {
    const grp = grpCol ? String(r.grp ?? "") : "_all_";
    if (!byGrp.has(grp)) byGrp.set(grp, []);
    byGrp.get(grp).push({ t: Number(r.t), y: r.y == null ? null : Number(r.y) });
  });
  return Array.from(byGrp.entries()).map(([grp, pts]) => ({ grp, pts: pts.filter(p => p.y != null) })).filter(s => s.pts.length > 0);
}
