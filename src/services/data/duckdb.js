/**
 * DuckDB-WASM singleton service.
 * Lazy-initialised on first use. Uses jsDelivr CDN bundles — no local WASM files needed.
 *
 * Public API:
 *   loadParquet(file)           → { headers, rows, _duckdb: { tableName, rowCount, truncated } }
 *   loadLargeCSV(file)          → same shape
 *   queryDuckDB(sql)            → { headers, rows }
 *   getDuckDB()                 → { db, conn }   (advanced use)
 */

import * as duckdb from "@duckdb/duckdb-wasm";

const MAX_ROWS = 500_000; // rows extracted into JS memory

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
  await conn.query(createSQL);
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

export async function queryDuckDB(sql) {
  const { conn } = await getDuckDB();
  const result = await conn.query(sql);
  const headers = result.schema.fields.map(f => f.name);
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
  const { tableName: tbl, rowCount } = await registerAndCreate(
    file,
    tableName,
    `CREATE OR REPLACE TABLE "${tableName}" AS SELECT * FROM parquet_scan('${file.name}')`
  );

  const limit = Math.min(rowCount, MAX_ROWS);
  const { headers, rows } = await queryDuckDB(
    `SELECT * FROM "${tbl}" LIMIT ${limit}`
  );

  return {
    headers,
    rows,
    _duckdb: { tableName: tbl, rowCount, truncated: rowCount > MAX_ROWS },
  };
}

/**
 * Load a large CSV/TSV via DuckDB's fast scanner.
 * Intended for files too large for the JS text parser.
 */
export async function loadLargeCSV(file) {
  const ext = file.name.split(".").pop().toLowerCase();
  const tableName = `csv_${Date.now()}`;
  const delim = ext === "tsv" ? `delim='\\t', ` : "";
  const { tableName: tbl, rowCount } = await registerAndCreate(
    file,
    tableName,
    `CREATE OR REPLACE TABLE "${tableName}" AS SELECT * FROM read_csv('${file.name}', ${delim}header=true, auto_detect=true)`
  );

  const limit = Math.min(rowCount, MAX_ROWS);
  const { headers, rows } = await queryDuckDB(
    `SELECT * FROM "${tbl}" LIMIT ${limit}`
  );

  return {
    headers,
    rows,
    _duckdb: { tableName: tbl, rowCount, truncated: rowCount > MAX_ROWS },
  };
}
