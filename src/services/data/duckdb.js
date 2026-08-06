/**
 * DuckDB-WASM singleton service.
 * Lazy-initialised on first use. Uses jsDelivr CDN bundles — no local WASM files needed.
 *
 * Public API:
 *   loadParquet(file)           → { headers, rows, _duckdb: { tableName, rowCount } }
 *
 * NOTE: DuckDB holds the FULL table; `rows` is only a PREVIEW_ROWS-sized sample
 * for the grid. This module truncates nothing — it used to carry a `truncated`
 * flag and a 2,000,000-row MAX_ROWS cap, but neither was ever applied: the flag
 * was hardcoded true at every call site and the cap was referenced nowhere, so
 * the UI claimed "showing 2,000,000 of 214,558" — more rows than the table even
 * had. The only real cap lives elsewhere: `duckdbRunner.extractRows` limits how
 * many rows are materialised into JS memory (MAX_EXTRACT, also 2,000,000). That
 * bounds the JS array, never the DuckDB table.
 *   loadLargeCSV(file)          → same shape
 *   queryDuckDB(sql)            → { headers, rows }
 *   getDuckDB()                 → { db, conn }   (advanced use)
 */

import * as duckdb from "@duckdb/duckdb-wasm";
import { tableFromJSON } from "apache-arrow";
import { PROTECTED_ROW_ID_COLS } from "./rowIdentity.js";
import {
  loadFromOPFS,
  loadFromOPFSKey,
  saveToOPFS,
  cacheKey as getParquetCacheKey,
} from "./parquetCache.js";

const PREVIEW_ROWS = 500;      // rows extracted into JS memory; rest served via getTablePage

// ── Singleton ──────────────────────────────────────────────────────────────────
let _db   = null;
let _conn = null;
let _initPromise = null;

async function initDuckDB() {
  const JSDELIVR_BUNDLES = duckdb.getJsDelivrBundles();
  const bundle = await duckdb.selectBundle(JSDELIVR_BUNDLES);

  // Web Worker from blob URL — works in any bundler without special config
  const workerUrl = URL.createObjectURL(
    new Blob([`importScripts("${bundle.mainWorker}");`], { type: "text/javascript" })
  );
  const worker = new Worker(workerUrl);
  const logger = new duckdb.VoidLogger();
  const db = new duckdb.AsyncDuckDB(logger, worker);
  await db.instantiate(bundle.mainModule, bundle.pthreadWorker);
  URL.revokeObjectURL(workerUrl);

  _conn = await db.connect();
  _db   = db;
  return { db: _db, conn: _conn };
}

export async function getDuckDB() {
  if (_db && _conn) return { db: _db, conn: _conn };
  if (!_initPromise) _initPromise = initDuckDB();
  return _initPromise;
}

// ── Core helpers ───────────────────────────────────────────────────────────────

async function registerAndCreate(file, tableName, createSQL) {
  const { db, conn } = await getDuckDB();
  await db.registerFileHandle(
    file.name,
    file,
    duckdb.DuckDBDataProtocol.BROWSER_FILEREADER,
    true
  );
  try {
    await conn.query(createSQL);
  } finally {
    try { await db.dropFile(file.name); } catch { /* best effort */ }
  }
  // Materialise row identity HERE, before the callers' saveToOPFS runs — that
  // way the cached Parquet carries __ri and every restore gets it for free.
  await ensureRiColumn(conn, tableName);
  const countRes = await conn.query(`SELECT COUNT(*) AS n FROM "${tableName}"`);
  const rowCount = Number(countRes.toArray()[0].n);
  return { conn, tableName, rowCount };
}

/** Convert an Arrow table row to a plain JS object, handling BigInt. */
function arrowRowToObj(row) {
  const obj = {};
  for (const [k, v] of Object.entries(row))
    obj[k] = typeof v === "bigint" ? Number(v) : v;
  return obj;
}

// ── Row identity ───────────────────────────────────────────────────────────────
// Cell editing (the `patch` pipeline step) matches rows by the stable `__ri`
// column, which `ensureRowIdentity` adds to JS row OBJECTS but deliberately not
// to `headers` — so it rides along invisibly and no variable picker ever sees
// it. For DuckDB-backed datasets the JS rows are only a 500-row preview: the
// TABLE is the source of truth, and `CREATE TABLE … AS SELECT *` never had the
// column. Every patch then compared `undefined === ri` in the JS fallback and
// silently edited nothing. The fix mirrors the JS contract at the SQL level:
// materialise `__ri` into the table once, and strip protected columns from
// `headers` at the JS boundary (the row objects keep them).
const RI_COL = "__ri";

export function stripProtected(headers) {
  return headers.filter(h => !PROTECTED_ROW_ID_COLS.includes(h));
}

async function tableColumns(conn, tableName) {
  const res = await conn.query(`DESCRIBE "${tableName}"`);
  return res.toArray().map(r => String(r.column_name));
}

// Add __ri (0-based load order) to a table that lacks it. Respects an existing
// __ri column — a re-imported file that already carries one keeps it, matching
// ensureRowIdentity's behaviour on JS rows. INTEGER cast so Arrow hands back a
// plain number, not a BigInt, and `r.__ri === s.ri` compares like with like.
// row_number() OVER () follows scan order, i.e. file order at load time — the
// same contract as the JS index.
async function ensureRiColumn(conn, tableName) {
  const cols = await tableColumns(conn, tableName);
  if (cols.includes(RI_COL)) return;
  const tmp = `${tableName}__ri_tmp`;
  await conn.query(
    `CREATE OR REPLACE TABLE "${tmp}" AS SELECT *, CAST(row_number() OVER () AS INTEGER) - 1 AS ${RI_COL} FROM "${tableName}"`
  );
  await conn.query(`DROP TABLE "${tableName}"`);
  await conn.query(`ALTER TABLE "${tmp}" RENAME TO "${tableName}"`);
}

/**
 * Fetch one page of rows from a DuckDB table — used by DataViewer for pagination.
 * Never materialises the full dataset into JS.
 */
export async function getTablePage(tableName, offset, limit, sort = null, where = null) {
  const { conn } = await getDuckDB();
  // The sort MUST be pushed into SQL: this function returns one page, so
  // ordering the returned rows in JS would sort only the 100 rows already on
  // screen and silently present that as the sorted table.
  let orderBy = "";
  if (sort?.col) {
    const c = String(sort.col).replace(/"/g, '""');
    // NULLS LAST in both directions matches dplyr::arrange, where NA always
    // sorts last regardless of desc().
    orderBy = ` ORDER BY "${c}" ${sort.dir === "desc" ? "DESC" : "ASC"} NULLS LAST`;
  }
  // The filter must be pushed down for exactly the same reason as the sort, and
  // the consequence of not doing it was worse: `rows` in JS is only the
  // PREVIEW_ROWS-sized sample, so filtering there searched the first 500 rows of
  // a 900k-row table and presented the result as the whole table.
  const whereSQL = where ? ` WHERE ${where}` : "";
  const result = await conn.query(
    `SELECT * FROM "${tableName}"${whereSQL}${orderBy} LIMIT ${limit} OFFSET ${offset}`
  );
  return result.toArray().map(arrowRowToObj);
}

/**
 * Count rows matching a WHERE fragment. Needed because a filtered view can no
 * longer use the cached total row count for pagination.
 */
export async function getFilteredRowCount(tableName, where = null) {
  const { conn } = await getDuckDB();
  const whereSQL = where ? ` WHERE ${where}` : "";
  const result = await conn.query(`SELECT COUNT(*) AS n FROM "${tableName}"${whereSQL}`);
  return Number(result.toArray()[0].n);
}

/**
 * Compute exact column statistics via SQL — used at step-creation time
 * so that winsorize bounds and z-score params are based on the full dataset.
 * Returns { mean, sd, p1, p99 } (all numbers, null if column has no valid values).
 */
export async function computeColStats(tableName, col) {
  const { conn } = await getDuckDB();
  const c = col.replace(/"/g, '""');
  const result = await conn.query(`
    SELECT
      avg("${c}")                         AS mean,
      stddev_pop("${c}")                  AS sd,
      percentile_cont(0.01) WITHIN GROUP (ORDER BY "${c}") AS p1,
      percentile_cont(0.99) WITHIN GROUP (ORDER BY "${c}") AS p99
    FROM "${tableName}"
    WHERE "${c}" IS NOT NULL
  `);
  const row = result.toArray()[0];
  const n = v => (v === null || v === undefined) ? null : Number(v);
  return { mean: n(row.mean), sd: n(row.sd), p1: n(row.p1), p99: n(row.p99) };
}

export async function getDistinctValues(tableName, col, limit = 500) {
  const { conn } = await getDuckDB();
  const c = col.replace(/"/g, '""');
  const listResult = await conn.query(`
    SELECT "${c}" AS value, COUNT(*) AS n
    FROM "${tableName}"
    WHERE "${c}" IS NOT NULL
    GROUP BY "${c}"
    ORDER BY n DESC
    LIMIT ${limit}
  `);
  const totalResult = await conn.query(`
    SELECT COUNT(DISTINCT "${c}") AS total
    FROM "${tableName}"
    WHERE "${c}" IS NOT NULL
  `);
  const rows = listResult.toArray().map(arrowRowToObj);
  const total = Number(totalResult.toArray()[0].total);
  return {
    values: rows.map(r => ({ value: r.value, count: r.n })),
    total,
  };
}

/**
 * Extract ALL rows from a DuckDB table into JS.
 * Only called at estimation time — never on tab transitions.
 */
export async function extractAllRows(tableName) {
  const { conn } = await getDuckDB();
  const result = await conn.query(`SELECT * FROM "${tableName}"`);
  return result.toArray().map(arrowRowToObj);
}

export async function queryDuckDB(sql) {
  const { conn } = await getDuckDB();
  const result = await conn.query(sql);
  // Protected identity columns stay OUT of headers (so no picker or grid ever
  // shows them) but IN the row objects (so `patch` can match on __ri) — the
  // same contract ensureRowIdentity establishes for pure-JS datasets.
  const headers = stripProtected(result.schema.fields.map(f => f.name));
  const rows    = result.toArray().map(arrowRowToObj);
  return { headers, rows };
}

// ── Public loaders ─────────────────────────────────────────────────────────────

/**
 * Load a .parquet file via DuckDB.
 * Returns { headers, rows } for the pipeline + _duckdb metadata for the UI.
 */
export async function loadParquet(file) {
  const tableName = `parquet_${Date.now()}`;
  const opfsCacheKey = getParquetCacheKey(file);
  const { db, conn } = await getDuckDB();
  const cacheHit = await loadFromOPFS(db, tableName, file);
  if (cacheHit) {
    await ensureRiColumn(conn, tableName); // Parquets cached before the __ri fix lack the column
    const countRes = await conn.query(`SELECT COUNT(*) AS n FROM "${tableName}"`);
    const rowCount = Number(countRes.toArray()[0].n);
    window.__validation?.fase9?.recordHit?.();
    const { headers, rows } = await queryDuckDB(
      `SELECT * FROM "${tableName}" LIMIT ${PREVIEW_ROWS}`
    );
    return {
      headers,
      rows,
      _duckdb: { tableName, rowCount, cached: true, opfsCacheKey },
    };
  }

  window.__validation?.fase9?.recordMiss?.();
  const { tableName: tbl, rowCount } = await registerAndCreate(
    file,
    tableName,
    `CREATE OR REPLACE TABLE "${tableName}" AS SELECT * FROM parquet_scan('${file.name}')`
  );

  const { headers, rows } = await queryDuckDB(
    `SELECT * FROM "${tbl}" LIMIT ${PREVIEW_ROWS}`
  );
  const persisted = await saveToOPFS(db, tbl, file);
  if (!persisted) window.__validation?.fase9?.recordErr?.();

  return {
    headers,
    rows, // preview only — full data served via getTablePage / extractAllRows
    _duckdb: { tableName: tbl, rowCount, cached: false, persisted, opfsCacheKey: persisted ? opfsCacheKey : null },
  };
}

/** Restore a project dataset from its durable OPFS cache key after a tab reopen. */
export async function restoreCachedParquet(opfsCacheKey, tablePrefix = "project") {
  if (!opfsCacheKey) return null;
  const safePrefix = String(tablePrefix).replace(/[^a-zA-Z0-9_]/g, "_");
  const tableName = `${safePrefix}_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
  const { db, conn } = await getDuckDB();
  const cacheHit = await loadFromOPFSKey(db, tableName, opfsCacheKey);
  if (!cacheHit) return null;

  await ensureRiColumn(conn, tableName); // Parquets cached before the __ri fix lack the column
  const countRes = await conn.query(`SELECT COUNT(*) AS n FROM "${tableName}"`);
  const rowCount = Number(countRes.toArray()[0].n);
  const { headers, rows } = await queryDuckDB(
    `SELECT * FROM "${tableName}" LIMIT ${PREVIEW_ROWS}`
  );
  window.__validation?.fase9?.recordHit?.();
  return {
    headers,
    rows,
    _duckdb: { tableName, rowCount, cached: true, opfsCacheKey },
  };
}

/**
 * Load a large CSV/TSV via DuckDB's fast scanner.
 * Intended for files too large for the JS text parser.
 */
// Common missing-value sentinels across World Bank, OECD, Stata, Excel exports.
const NULL_STRINGS = `['..', '.', 'NA', 'N/A', 'n/a', 'na', 'NULL', 'null', 'None', 'none', 'missing', '#N/A', '#NA', 'NaN']`;

export async function loadLargeCSV(file) {
  const ext = file.name.split(".").pop().toLowerCase();
  const tableName = `csv_${Date.now()}`;
  const opfsCacheKey = getParquetCacheKey(file);
  const { db, conn } = await getDuckDB();

  // ── Fase 9: OPFS Parquet cache ─────────────────────────────────────────────
  const cacheHit = await loadFromOPFS(db, tableName, file);
  if (cacheHit) {
    await ensureRiColumn(conn, tableName); // Parquets cached before the __ri fix lack the column
    const countRes = await conn.query(`SELECT COUNT(*) AS n FROM "${tableName}"`);
    const rowCount = Number(countRes.toArray()[0].n);
    window.__validation?.fase9?.recordHit?.();
    const { headers, rows } = await queryDuckDB(
      `SELECT * FROM "${tableName}" LIMIT ${PREVIEW_ROWS}`
    );
    return {
      headers,
      rows,
      _duckdb: { tableName, rowCount, cached: true, opfsCacheKey },
    };
  }
  window.__validation?.fase9?.recordMiss?.();
  // ───────────────────────────────────────────────────────────────────────────

  const delim = ext === "tsv" ? `delim='\\t', ` : "";
  const { tableName: tbl, rowCount } = await registerAndCreate(
    file,
    tableName,
    `CREATE OR REPLACE TABLE "${tableName}" AS SELECT * FROM read_csv('${file.name}', ${delim}header=true, auto_detect=true, nullstr=${NULL_STRINGS})`
  );

  // Wait for the durable copy so a close/reopen cannot race the OPFS write.
  const persisted = await saveToOPFS(db, tbl, file);
  if (!persisted) window.__validation?.fase9?.recordErr?.();

  const { headers, rows } = await queryDuckDB(
    `SELECT * FROM "${tbl}" LIMIT ${PREVIEW_ROWS}`
  );

  return {
    headers,
    rows, // preview only — full data served via getTablePage / extractAllRows
    _duckdb: { tableName: tbl, rowCount, cached: false, persisted, opfsCacheKey: persisted ? opfsCacheKey : null },
  };
}

/**
 * Parse a browser-only format once, then keep only a preview in React state.
 * OPFS restores skip the expensive JS parser on subsequent loads.
 */
export async function loadLargeParsedData(file, parse, tablePrefix = "data") {
  const tableName = `${tablePrefix}_${Date.now()}`;
  const opfsCacheKey = getParquetCacheKey(file);
  const { db, conn } = await getDuckDB();

  const cacheHit = await loadFromOPFS(db, tableName, file);
  if (cacheHit) {
    await ensureRiColumn(conn, tableName); // Parquets cached before the __ri fix lack the column
    const countRes = await conn.query(`SELECT COUNT(*) AS n FROM "${tableName}"`);
    const rowCount = Number(countRes.toArray()[0].n);
    window.__validation?.fase9?.recordHit?.();
    const { headers, rows } = await queryDuckDB(
      `SELECT * FROM "${tableName}" LIMIT ${PREVIEW_ROWS}`
    );
    return {
      headers,
      rows,
      _duckdb: { tableName, rowCount, cached: true, opfsCacheKey },
    };
  }

  window.__validation?.fase9?.recordMiss?.();
  const parsed = await parse();
  if (!parsed?.rows?.length) return parsed;

  const arrowTable = tableFromJSON(parsed.rows);
  await conn.insertArrowTable(arrowTable, { name: tableName, create: true });
  const rowCount = parsed.rows.length;
  // Before saveToOPFS, so the cached Parquet carries __ri too.
  await ensureRiColumn(conn, tableName);

  const persisted = await saveToOPFS(db, tableName, file);
  if (!persisted) window.__validation?.fase9?.recordErr?.();

  const { headers, rows } = await queryDuckDB(
    `SELECT * FROM "${tableName}" LIMIT ${PREVIEW_ROWS}`
  );
  return {
    ...parsed,
    headers,
    rows,
    _duckdb: { tableName, rowCount, cached: false, persisted, opfsCacheKey: persisted ? opfsCacheKey : null },
  };
}
