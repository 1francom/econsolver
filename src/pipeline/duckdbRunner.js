// ─── ECON STUDIO · pipeline/duckdbRunner.js ───────────────────────────────────
// Async SQL-backed pipeline for DuckDB-loaded datasets (>10 MB CSV or .parquet).
// Translates supported step types to SQL; falls back to sync JS for the rest.
//
// Exports:
//   runPipelineDuck(rawTableName, rawHeaders, steps, conn) → { rows, headers }
//
// Strategy: process steps in SQL as long as they have translations; on the first
// untranslatable step, extract rows from DuckDB and hand off the remainder to
// the synchronous runPipeline() — avoids complex row re-registration.

import { getDuckDB } from "../services/data/duckdb.js";
import { runPipeline } from "./runner.js";

const MAX_EXTRACT = 2_000_000;

// Step types with direct SQL translations
const SQL_STEPS = new Set([
  "filter", "arrange", "rename", "drop",
  "group_summarize", "log", "sq", "std",
  "lag", "lead", "diff",
]);

// ── Escaping helpers ───────────────────────────────────────────────────────────

/** Escape a column name for DuckDB double-quoted identifiers. */
function esc(col) {
  return `"${String(col).replace(/"/g, '""')}"`;
}

/** Escape a value for use in a LIKE pattern (escapes %, _). */
function escapeLike(val) {
  return String(val).replace(/\\/g, "\\\\").replace(/%/g, "\\%").replace(/_/g, "\\_");
}

/** Produce a SQL literal for a filter value. Uses numeric literal when possible. */
function valSQL(val) {
  if (val === null || val === undefined || val === "") return "NULL";
  const n = Number(val);
  if (!Number.isNaN(n) && isFinite(n) && String(val).trim() !== "") return String(n);
  return `'${String(val).replace(/'/g, "''")}'`;
}

// ── Predicate → SQL WHERE clause ──────────────────────────────────────────────

function condToSQL(cond) {
  const { col, op, val, conditions, combinator } = cond;

  // Multi-condition branch
  if (conditions?.length) {
    const sep = combinator === "OR" ? " OR " : " AND ";
    return "(" + conditions.map(c => condToSQL(c)).join(sep) + ")";
  }

  const c = esc(col);
  switch (op) {
    case "==":           return `${c} = ${valSQL(val)}`;
    case "!=":           return `${c} != ${valSQL(val)}`;
    case ">":            return `${c} > ${valSQL(val)}`;
    case "<":            return `${c} < ${valSQL(val)}`;
    case ">=":           return `${c} >= ${valSQL(val)}`;
    case "<=":           return `${c} <= ${valSQL(val)}`;
    case "contains":     return `${c} LIKE '%${escapeLike(val)}%' ESCAPE '\\'`;
    case "not_contains": return `${c} NOT LIKE '%${escapeLike(val)}%' ESCAPE '\\'`;
    case "starts_with":  return `${c} LIKE '${escapeLike(val)}%' ESCAPE '\\'`;
    case "ends_with":    return `${c} LIKE '%${escapeLike(val)}' ESCAPE '\\'`;
    case "is_null":      return `${c} IS NULL`;
    case "is_not_null":  return `${c} IS NOT NULL`;
    default:             return "TRUE";
  }
}

// ── Step → SQL ────────────────────────────────────────────────────────────────

/** Returns a unique table name for an intermediate step result. */
function nextTbl() {
  return `_es_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;
}

/**
 * Attempt to translate one step to SQL.
 * Returns { tableName, headers } on success, or null if the step can't be translated.
 */
async function applyStepSQL(step, tbl, headers, conn) {
  const next = nextTbl();

  switch (step.type) {

    case "filter": {
      const where = condToSQL(step);
      await conn.query(
        `CREATE OR REPLACE TABLE "${next}" AS SELECT * FROM "${tbl}" WHERE ${where}`
      );
      return { tableName: next, headers };
    }

    case "arrange": {
      const dir = step.dir === "desc" ? "DESC" : "ASC";
      await conn.query(
        `CREATE OR REPLACE TABLE "${next}" AS SELECT * FROM "${tbl}" ORDER BY ${esc(step.col)} ${dir}`
      );
      return { tableName: next, headers };
    }

    case "rename": {
      const newHeaders = headers.map(h => (h === step.col ? step.newName : h));
      const sel = headers
        .map(h => (h === step.col ? `${esc(h)} AS ${esc(step.newName)}` : esc(h)))
        .join(", ");
      await conn.query(`CREATE OR REPLACE TABLE "${next}" AS SELECT ${sel} FROM "${tbl}"`);
      return { tableName: next, headers: newHeaders };
    }

    case "drop": {
      const newHeaders = headers.filter(h => h !== step.col);
      if (!newHeaders.length) return null; // can't drop all cols
      const sel = newHeaders.map(esc).join(", ");
      await conn.query(`CREATE OR REPLACE TABLE "${next}" AS SELECT ${sel} FROM "${tbl}"`);
      return { tableName: next, headers: newHeaders };
    }

    case "group_summarize": {
      const { by, aggs = [] } = step;
      if (!by?.length || !aggs.length) return null;

      const FN_MAP = {
        mean: "AVG", sum: "SUM", count: "COUNT",
        min: "MIN", max: "MAX", sd: "STDDEV_SAMP", median: "MEDIAN",
      };
      const groupList = by.map(esc).join(", ");
      const aggExprs = aggs.map(({ col, fn, nn }) => {
        const sqlFn = FN_MAP[fn] || "COUNT";
        return `${sqlFn}(${esc(col)}) AS ${esc(nn)}`;
      }).join(", ");
      const newHeaders = [...by, ...aggs.map(a => a.nn).filter(c => !by.includes(c))];

      await conn.query(
        `CREATE OR REPLACE TABLE "${next}" AS SELECT ${groupList}, ${aggExprs} FROM "${tbl}" GROUP BY ${groupList}`
      );
      return { tableName: next, headers: newHeaders };
    }

    case "log": {
      const newHeaders = headers.includes(step.nn) ? headers : [...headers, step.nn];
      await conn.query(
        `CREATE OR REPLACE TABLE "${next}" AS SELECT *, LN(${esc(step.col)}) AS ${esc(step.nn)} FROM "${tbl}"`
      );
      return { tableName: next, headers: newHeaders };
    }

    case "sq": {
      const newHeaders = headers.includes(step.nn) ? headers : [...headers, step.nn];
      await conn.query(
        `CREATE OR REPLACE TABLE "${next}" AS SELECT *, POW(${esc(step.col)}, 2) AS ${esc(step.nn)} FROM "${tbl}"`
      );
      return { tableName: next, headers: newHeaders };
    }

    case "std": {
      // s.mu and s.sd are pre-computed at step-creation time
      if (step.sd == null || step.sd === 0) return null;
      const newHeaders = headers.includes(step.nn) ? headers : [...headers, step.nn];
      await conn.query(
        `CREATE OR REPLACE TABLE "${next}" AS SELECT *, (${esc(step.col)} - ${step.mu}) / ${step.sd} AS ${esc(step.nn)} FROM "${tbl}"`
      );
      return { tableName: next, headers: newHeaders };
    }

    case "lag":
    case "lead": {
      const isLag = step.type === "lag";
      const n = step.n || 1;
      const newHeaders = headers.includes(step.nn) ? headers : [...headers, step.nn];
      const partBy = step.ec ? `PARTITION BY ${esc(step.ec)}` : "";
      const orderBy = step.tc ? `ORDER BY ${esc(step.tc)}` : "ORDER BY (SELECT NULL)";
      const winFn = isLag ? "LAG" : "LEAD";
      await conn.query(
        `CREATE OR REPLACE TABLE "${next}" AS SELECT *, ${winFn}(${esc(step.col)}, ${n}) OVER (${partBy} ${orderBy}) AS ${esc(step.nn)} FROM "${tbl}"`
      );
      return { tableName: next, headers: newHeaders };
    }

    case "diff": {
      const newHeaders = headers.includes(step.nn) ? headers : [...headers, step.nn];
      const partBy = step.ec ? `PARTITION BY ${esc(step.ec)}` : "";
      const orderBy = step.tc ? `ORDER BY ${esc(step.tc)}` : "ORDER BY (SELECT NULL)";
      await conn.query(
        `CREATE OR REPLACE TABLE "${next}" AS SELECT *, ${esc(step.col)} - LAG(${esc(step.col)}, 1) OVER (${partBy} ${orderBy}) AS ${esc(step.nn)} FROM "${tbl}"`
      );
      return { tableName: next, headers: newHeaders };
    }

    default:
      return null;
  }
}

// ── Row extraction ─────────────────────────────────────────────────────────────

/** Convert Arrow BigInt values to JS Number. */
function arrowToObj(row) {
  const obj = {};
  for (const [k, v] of Object.entries(row))
    obj[k] = typeof v === "bigint" ? Number(v) : v;
  return obj;
}

async function extractRows(tableName, conn, limit = MAX_EXTRACT) {
  const result = await conn.query(`SELECT * FROM "${tableName}" LIMIT ${limit}`);
  return result.toArray().map(arrowToObj);
}

async function countRows(tableName, conn) {
  const r = await conn.query(`SELECT COUNT(*) AS n FROM "${tableName}"`);
  return Number(r.toArray()[0].n);
}

// ── Public: run full pipeline on a DuckDB table ────────────────────────────────

/**
 * Run the pipeline starting from a DuckDB table.
 * Translates steps to SQL where possible; on the first untranslatable step,
 * extracts rows and hands the remainder to the sync JS runner.
 *
 * @param {string}   rawTableName  - DuckDB table name from duckdb.js loaders
 * @param {string[]} rawHeaders    - Column names for rawTableName
 * @param {object[]} steps         - Pipeline steps (same format as runner.js)
 * @param {object}   conn          - DuckDB connection from getDuckDB()
 * @returns {{ rows, headers, _duckdb }}
 */
export async function runPipelineDuck(rawTableName, rawHeaders, steps, conn) {
  let tableName = rawTableName;
  let headers   = [...rawHeaders];

  for (let i = 0; i < steps.length; i++) {
    const step = steps[i];

    if (SQL_STEPS.has(step.type)) {
      try {
        const result = await applyStepSQL(step, tableName, headers, conn);
        if (result) {
          ({ tableName, headers } = result);
          continue;
        }
      } catch (e) {
        console.warn(`[duckdbRunner] SQL step "${step.type}" failed, falling to JS:`, e.message);
      }
    }

    // ── Fallback: extract current table → finish in JS ──────────────────────
    const extractedRows = await extractRows(tableName, conn);
    const remaining     = steps.slice(i);
    // context is empty here — join steps referencing other datasets are
    // already handled by the JS path in WranglingModule for secondary datasets
    const { rows, headers: finalHeaders } = runPipeline(extractedRows, headers, remaining, {});
    return { rows, headers: finalHeaders };
  }

  // All steps translated — return preview only; full data stays in DuckDB
  const PREVIEW = 500;
  const rowCount = await countRows(tableName, conn);
  const rows = await extractRows(tableName, conn, PREVIEW);
  return {
    rows, // preview only — ModelingTab calls extractAllRows() before estimating
    headers,
    _duckdb: { tableName, rowCount },
  };
}
