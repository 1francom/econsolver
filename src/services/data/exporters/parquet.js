/**
 * Parquet exporter — serialises in-memory rows to a Parquet byte buffer
 * via the shared DuckDB-WASM singleton.
 *
 * Used by the replication-bundle pipeline (Phase E) so exported datasets
 * are compact and type-preserving.
 *
 * IMPORTANT
 * ─────────
 * - Reuses the singleton from src/services/data/duckdb.js — never spawns a
 *   second DuckDB instance.
 * - Requires browser context (Web Worker + virtual FS). DuckDB-WASM's worker
 *   loader uses `new Worker(URL.createObjectURL(...))` which is not available
 *   in plain Node — smoke-testing this module via `node -e` will fail at the
 *   `getDuckDB()` step. Full validation must happen in the browser (or under
 *   jsdom/playwright with worker shims).
 *
 * Public API:
 *   rowsToParquet(headers, rows) → Promise<Uint8Array>
 */

import { getDuckDB } from "../duckdb.js";

/**
 * Serialise the given rows to a Parquet byte buffer.
 *
 * Column order follows `headers`; any keys present on rows but missing from
 * `headers` are dropped. By default all columns are included — including
 * pipeline-internal columns like `__row_id` / `__ri`, which downstream
 * replication scripts may need.
 *
 * @param {string[]}                 headers — column names, in output order
 * @param {Array<Record<string, any>>} rows  — plain JS row objects
 * @returns {Promise<Uint8Array>}            — Parquet file bytes (starts with `PAR1`)
 */
export async function rowsToParquet(headers, rows) {
  if (!Array.isArray(headers) || headers.length === 0)
    throw new Error("rowsToParquet: headers must be a non-empty array");
  if (!Array.isArray(rows))
    throw new Error("rowsToParquet: rows must be an array");

  const { db, conn } = await getDuckDB();

  const stamp     = `${Date.now()}_${Math.random().toString(36).slice(2)}`;
  const jsonPath  = `__es_parquet_in_${stamp}.json`;
  const parqPath  = `__es_parquet_out_${stamp}.parquet`;
  const tableName = `__es_parquet_tmp_${stamp}`;

  // Project to declared header order; JSON-encoded as one object per line
  // (ndjson) so DuckDB's read_json_auto can ingest it streaming-style.
  const ndjson = rows
    .map(r => {
      const o = {};
      for (const h of headers) o[h] = r?.[h] ?? null;
      return JSON.stringify(o);
    })
    .join("\n");

  await db.registerFileText(jsonPath, ndjson || "");

  try {
    // read_json_auto handles type inference (numbers, strings, bools, nulls)
    await conn.query(
      `CREATE OR REPLACE TABLE "${tableName}" AS
         SELECT * FROM read_json_auto('${jsonPath}', format='newline_delimited')`
    );

    await conn.query(
      `COPY (SELECT * FROM "${tableName}") TO '${parqPath}' (FORMAT PARQUET)`
    );

    const buf = await db.copyFileToBuffer(parqPath);
    return buf;
  } finally {
    // Best-effort cleanup of temp table + virtual FS entries
    try { await conn.query(`DROP TABLE IF EXISTS "${tableName}"`); } catch { /* ignore */ }
    try { await db.dropFile(jsonPath); } catch { /* ignore */ }
    try { await db.dropFile(parqPath); } catch { /* ignore */ }
  }
}
