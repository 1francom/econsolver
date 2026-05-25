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
  // original 11
  "filter", "arrange", "rename", "drop",
  "group_summarize", "log", "sq", "std",
  "lag", "lead", "diff",
  // Fase 10 additions
  "winz", "ix", "did", "factor_interactions", "trim_outliers", "flag_outliers",
  "type_cast", "quickclean", "recode", "normalize_cats", "clean_strings", "extract_regex",
  "drop_na", "fill_na", "fill_na_grouped",
  "dummy",
  "date_parse", "date_extract",
  "pivot_longer",
  "join", "append",
  "grouped_mutate",
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
async function applyStepSQL(step, tbl, headers, conn, context = {}) {
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

    // ── Group 1: Scalar expressions ──────────────────────────────────────────

    case "winz": {
      const outCol = (step.nn && step.nn !== step.col) ? step.nn : step.col;
      const expr = `GREATEST(${step.lo}, LEAST(${step.hi}, ${esc(step.col)}))`;
      const newHeaders = outCol !== step.col
        ? (headers.includes(outCol) ? headers : [...headers, outCol])
        : headers;
      const sel = outCol !== step.col
        ? `*, ${expr} AS ${esc(outCol)}`
        : headers.map(h => h === step.col ? `${expr} AS ${esc(step.col)}` : esc(h)).join(", ");
      await conn.query(`CREATE OR REPLACE TABLE "${next}" AS SELECT ${sel} FROM "${tbl}"`);
      return { tableName: next, headers: newHeaders };
    }

    case "ix": {
      const newHeaders = headers.includes(step.nn) ? headers : [...headers, step.nn];
      await conn.query(
        `CREATE OR REPLACE TABLE "${next}" AS SELECT *, ${esc(step.c1)} * ${esc(step.c2)} AS ${esc(step.nn)} FROM "${tbl}"`
      );
      return { tableName: next, headers: newHeaders };
    }

    case "did": {
      const newHeaders = headers.includes(step.nn) ? headers : [...headers, step.nn];
      await conn.query(
        `CREATE OR REPLACE TABLE "${next}" AS SELECT *, ${esc(step.tc)} * ${esc(step.pc)} AS ${esc(step.nn)} FROM "${tbl}"`
      );
      return { tableName: next, headers: newHeaders };
    }

    case "factor_interactions": {
      const prefix = step.prefix || `${step.contCol}_x_`;
      const dummyCols = step.dummyCols || [];
      if (!dummyCols.length) return null;
      const newHeaders = [...headers];
      const newColExprs = dummyCols.map(dc => {
        const outCol = prefix + dc;
        if (!newHeaders.includes(outCol)) newHeaders.push(outCol);
        return `${esc(step.contCol)} * ${esc(dc)} AS ${esc(outCol)}`;
      });
      await conn.query(
        `CREATE OR REPLACE TABLE "${next}" AS SELECT *, ${newColExprs.join(", ")} FROM "${tbl}"`
      );
      return { tableName: next, headers: newHeaders };
    }

    case "trim_outliers": {
      if (step.lo == null || step.hi == null) return null;
      await conn.query(
        `CREATE OR REPLACE TABLE "${next}" AS SELECT * FROM "${tbl}" WHERE ${esc(step.col)} IS NULL OR (${esc(step.col)} >= ${step.lo} AND ${esc(step.col)} <= ${step.hi})`
      );
      return { tableName: next, headers };
    }

    case "flag_outliers": {
      const method = step.method || "iqr";
      const newHeaders = headers.includes(step.nn) ? headers : [...headers, step.nn];
      if (method === "zscore") {
        const thr = step.threshold ?? 3;
        await conn.query(`
          CREATE OR REPLACE TABLE "${next}" AS
          WITH _stats AS (
            SELECT AVG(${esc(step.col)}) AS mu, STDDEV_SAMP(${esc(step.col)}) AS sigma
            FROM "${tbl}" WHERE ${esc(step.col)} IS NOT NULL
          )
          SELECT t.*,
            CASE WHEN t.${esc(step.col)} IS NULL OR s.sigma = 0 OR s.sigma IS NULL THEN 0
                 WHEN ABS((t.${esc(step.col)} - s.mu) / s.sigma) > ${thr} THEN 1
                 ELSE 0 END AS ${esc(step.nn)}
          FROM "${tbl}" t, _stats s
        `);
      } else {
        await conn.query(`
          CREATE OR REPLACE TABLE "${next}" AS
          WITH _bounds AS (
            SELECT
              PERCENTILE_CONT(0.25) WITHIN GROUP (ORDER BY ${esc(step.col)}) AS q1,
              PERCENTILE_CONT(0.75) WITHIN GROUP (ORDER BY ${esc(step.col)}) AS q3
            FROM "${tbl}" WHERE ${esc(step.col)} IS NOT NULL
          )
          SELECT t.*,
            CASE WHEN t.${esc(step.col)} IS NULL THEN 0
                 WHEN t.${esc(step.col)} < b.q1 - 1.5*(b.q3-b.q1)
                   OR t.${esc(step.col)} > b.q3 + 1.5*(b.q3-b.q1) THEN 1
                 ELSE 0 END AS ${esc(step.nn)}
          FROM "${tbl}" t, _bounds b
        `);
      }
      return { tableName: next, headers: newHeaders };
    }

    // ── Group 2: String operations ────────────────────────────────────────────

    case "type_cast": {
      if (step.to === "number_smart") return null;
      let castExpr;
      if (step.to === "number") {
        castExpr = `TRY_CAST(${esc(step.col)} AS DOUBLE)`;
      } else if (step.to === "string") {
        castExpr = `CAST(${esc(step.col)} AS VARCHAR)`;
      } else if (step.to === "boolean") {
        castExpr = `CASE WHEN LOWER(TRIM(CAST(${esc(step.col)} AS VARCHAR))) IN ('1','true','yes','y') THEN 1 ELSE 0 END`;
      } else {
        return null;
      }
      const sel = headers.map(h => h === step.col ? `${castExpr} AS ${esc(step.col)}` : esc(h)).join(", ");
      await conn.query(`CREATE OR REPLACE TABLE "${next}" AS SELECT ${sel} FROM "${tbl}"`);
      return { tableName: next, headers };
    }

    case "quickclean": {
      const mode = step.mode || "lower";
      let expr;
      if (mode === "lower") expr = `LOWER(TRIM(${esc(step.col)}))`;
      else if (mode === "upper") expr = `UPPER(TRIM(${esc(step.col)}))`;
      else if (mode === "title") expr = `INITCAP(TRIM(${esc(step.col)}))`;
      else return null;
      const sel = headers.map(h => h === step.col ? `${expr} AS ${esc(step.col)}` : esc(h)).join(", ");
      await conn.query(`CREATE OR REPLACE TABLE "${next}" AS SELECT ${sel} FROM "${tbl}"`);
      return { tableName: next, headers };
    }

    case "recode":
    case "normalize_cats": {
      const map = step.map || {};
      const entries = Object.entries(map);
      if (!entries.length) return { tableName: tbl, headers };
      const whenClauses = entries
        .map(([k, v]) => `WHEN ${esc(step.col)} = ${valSQL(k)} THEN ${valSQL(v)}`)
        .join(" ");
      const expr = `CASE ${whenClauses} ELSE ${esc(step.col)} END`;
      const sel = headers.map(h => h === step.col ? `${expr} AS ${esc(step.col)}` : esc(h)).join(", ");
      await conn.query(`CREATE OR REPLACE TABLE "${next}" AS SELECT ${sel} FROM "${tbl}"`);
      return { tableName: next, headers };
    }

    case "clean_strings": {
      // Fall back for lookbehind regex patterns DuckDB doesn't support
      if (step.ocrNoise || step.midWordSep) return null;
      let expr = `TRIM(${esc(step.col)})`;
      expr = `REGEXP_REPLACE(${expr}, '\\s+', ' ', 'g')`;
      if (step.normSep) expr = `REGEXP_REPLACE(${expr}, '\\s*[-\u2013,]\\s*', ' ', 'g')`;
      if (step.stripPunct !== false) expr = `REGEXP_REPLACE(${expr}, '[.,\\-\u2013]+$', '', 'g')`;
      const cs = step.case || "keep";
      if (cs === "lower") expr = `LOWER(${expr})`;
      else if (cs === "upper") expr = `UPPER(${expr})`;
      else if (cs === "title") expr = `INITCAP(${expr})`;
      const sel = headers.map(h => h === step.col ? `${expr} AS ${esc(step.col)}` : esc(h)).join(", ");
      await conn.query(`CREATE OR REPLACE TABLE "${next}" AS SELECT ${sel} FROM "${tbl}"`);
      return { tableName: next, headers };
    }

    case "extract_regex": {
      // Only SQL-ize simple case: no custom regex, non-EU locale
      if (step.regex || step.locale === "comma") return null;
      const newHeaders = headers.includes(step.nn) ? headers : [...headers, step.nn];
      const expr = `TRY_CAST(REGEXP_EXTRACT(CAST(${esc(step.col)} AS VARCHAR), '[0-9]+\\.?[0-9]*') AS DOUBLE)`;
      await conn.query(
        `CREATE OR REPLACE TABLE "${next}" AS SELECT *, ${expr} AS ${esc(step.nn)} FROM "${tbl}"`
      );
      return { tableName: next, headers: newHeaders };
    }

    // ── Group 3: Drop / fill missing ─────────────────────────────────────────

    case "drop_na": {
      const cols = step.cols || (step.col ? [step.col] : headers);
      if (!cols.length) return null;
      const where = step.how === "all"
        ? `NOT (${cols.map(c => `${esc(c)} IS NULL`).join(" AND ")})`
        : cols.map(c => `${esc(c)} IS NOT NULL`).join(" AND ");
      await conn.query(
        `CREATE OR REPLACE TABLE "${next}" AS SELECT * FROM "${tbl}" WHERE ${where}`
      );
      return { tableName: next, headers };
    }

    case "fill_na": {
      const strategy = step.strategy || "mean";
      if (strategy === "mode") return null;
      const col = esc(step.col);

      if (strategy === "median") {
        const medSel = headers.map(h =>
          h === step.col
            ? `COALESCE(${col}, (SELECT PERCENTILE_CONT(0.5) WITHIN GROUP (ORDER BY ${col}) FROM "${tbl}" WHERE ${col} IS NOT NULL)) AS ${col}`
            : esc(h)
        ).join(", ");
        await conn.query(`CREATE OR REPLACE TABLE "${next}" AS SELECT ${medSel} FROM "${tbl}"`);
        return { tableName: next, headers };
      }

      let expr;
      if (strategy === "constant") {
        expr = `COALESCE(${col}, ${valSQL(step.value)})`;
      } else if (strategy === "mean") {
        expr = `COALESCE(${col}, AVG(${col}) OVER ())`;
      } else if (strategy === "forward_fill") {
        expr = `LAST_VALUE(${col} IGNORE NULLS) OVER (ORDER BY rowid ROWS BETWEEN UNBOUNDED PRECEDING AND CURRENT ROW)`;
      } else if (strategy === "backward_fill") {
        expr = `FIRST_VALUE(${col} IGNORE NULLS) OVER (ORDER BY rowid ROWS BETWEEN CURRENT ROW AND UNBOUNDED FOLLOWING)`;
      } else {
        return null;
      }

      const sel = headers.map(h => h === step.col ? `${expr} AS ${col}` : esc(h)).join(", ");
      await conn.query(`CREATE OR REPLACE TABLE "${next}" AS SELECT ${sel} FROM "${tbl}"`);
      return { tableName: next, headers };
    }

    case "fill_na_grouped": {
      const strategy = step.strategy || "mean";
      const groupCols = Array.isArray(step.groupCol)
        ? step.groupCol
        : (step.groupCol ? [step.groupCol] : []);
      if (!groupCols.length) return null;
      const col = esc(step.col);
      const partBy = `PARTITION BY ${groupCols.map(esc).join(", ")}`;

      if (strategy === "median") {
        const gmedSel = headers.map(h =>
          h === step.col
            ? `COALESCE(t.${col}, g.gmed) AS ${col}`
            : `t.${esc(h)}`
        ).join(", ");
        await conn.query(`
          CREATE OR REPLACE TABLE "${next}" AS
          WITH _gmed AS (
            SELECT ${groupCols.map(esc).join(", ")},
              PERCENTILE_CONT(0.5) WITHIN GROUP (ORDER BY ${col}) AS gmed
            FROM "${tbl}" WHERE ${col} IS NOT NULL
            GROUP BY ${groupCols.map(esc).join(", ")}
          )
          SELECT ${gmedSel}
          FROM "${tbl}" t
          LEFT JOIN _gmed g ON ${groupCols.map(c => `t.${esc(c)} = g.${esc(c)}`).join(" AND ")}
        `);
        return { tableName: next, headers };
      }

      if (strategy !== "mean") return null;

      const expr = `COALESCE(${col}, AVG(${col}) OVER (${partBy}))`;
      const sel = headers.map(h => h === step.col ? `${expr} AS ${col}` : esc(h)).join(", ");
      await conn.query(`CREATE OR REPLACE TABLE "${next}" AS SELECT ${sel} FROM "${tbl}"`);
      return { tableName: next, headers };
    }

    // ── Group 4: One-hot encoding ─────────────────────────────────────────────

    case "dummy": {
      if (!step.pfx || !step.col) return null;
      const catRes = await conn.query(
        `SELECT DISTINCT ${esc(step.col)} AS cat FROM "${tbl}" WHERE ${esc(step.col)} IS NOT NULL ORDER BY cat`
      );
      const cats = catRes.toArray().map(r => String(r.cat));
      if (!cats.length) return null;
      const newHeaders = [...headers];
      const newColExprs = cats.map(c => {
        const dc = `${step.pfx}_${c}`;
        if (!newHeaders.includes(dc)) newHeaders.push(dc);
        return `CASE WHEN ${esc(step.col)} = ${valSQL(c)} THEN 1 ELSE 0 END AS ${esc(dc)}`;
      });
      await conn.query(
        `CREATE OR REPLACE TABLE "${next}" AS SELECT *, ${newColExprs.join(", ")} FROM "${tbl}"`
      );
      return { tableName: next, headers: newHeaders };
    }

    // ── Group 5: Date functions ───────────────────────────────────────────────

    case "date_parse": {
      const fmt = step.fmt || "auto";
      if (["YYMMDD", "DDMMYY", "MMDDYY"].includes(fmt)) return null;
      const outCol = (step.nn && step.nn !== step.col) ? step.nn : step.col;
      const srcExpr = `CAST(${esc(step.col)} AS VARCHAR)`;
      let expr;
      if (fmt === "YYYYMMDD") {
        expr = `STRFTIME(TRY_STRPTIME(${srcExpr}, '%Y%m%d'), '%Y-%m-%d')`;
      } else if (fmt === "DDMMYYYY") {
        expr = `STRFTIME(TRY_STRPTIME(${srcExpr}, '%d%m%Y'), '%Y-%m-%d')`;
      } else if (fmt === "MMDDYYYY") {
        expr = `STRFTIME(TRY_STRPTIME(${srcExpr}, '%m%d%Y'), '%Y-%m-%d')`;
      } else {
        expr = `STRFTIME(TRY_CAST(${esc(step.col)} AS DATE), '%Y-%m-%d')`;
      }
      const newHeaders = outCol !== step.col
        ? (headers.includes(outCol) ? headers : [...headers, outCol])
        : headers;
      const sel = outCol !== step.col
        ? `*, ${expr} AS ${esc(outCol)}`
        : headers.map(h => h === step.col ? `${expr} AS ${esc(step.col)}` : esc(h)).join(", ");
      await conn.query(`CREATE OR REPLACE TABLE "${next}" AS SELECT ${sel} FROM "${tbl}"`);
      return { tableName: next, headers: newHeaders };
    }

    case "date_extract": {
      const parts = step.parts || [];
      const names = step.names || {};
      if (!parts.length) return null;
      const PART_SQL = {
        year:      c => `YEAR(${c})`,
        month:     c => `MONTH(${c})`,
        day:       c => `DAY(${c})`,
        dow:       c => `DAYOFWEEK(${c})`,
        week:      c => `WEEKOFYEAR(${c})`,
        quarter:   c => `QUARTER(${c})`,
        isweekend: c => `CASE WHEN DAYOFWEEK(${c}) IN (0, 6) THEN 1 ELSE 0 END`,
      };
      const newHeaders = [...headers];
      const newColExprs = [];
      for (const part of parts) {
        const nn = names[part];
        if (!nn || !PART_SQL[part]) continue;
        newColExprs.push(`${PART_SQL[part](esc(step.col))} AS ${esc(nn)}`);
        if (!newHeaders.includes(nn)) newHeaders.push(nn);
      }
      if (!newColExprs.length) return null;
      await conn.query(
        `CREATE OR REPLACE TABLE "${next}" AS SELECT *, ${newColExprs.join(", ")} FROM "${tbl}"`
      );
      return { tableName: next, headers: newHeaders };
    }

    // ── Group 6: Reshape ──────────────────────────────────────────────────────

    case "pivot_longer": {
      if ((step.mode || "simple") !== "simple") return null;
      if (step.namesSep || step.namesPrefix) return null;
      const pivotCols = step.cols || [];
      if (!pivotCols.length) return null;
      const namesTo  = step.namesTo  || "name";
      const valuesTo = step.valuesTo || "value";
      const idCols   = step.idCols || headers.filter(h => !pivotCols.includes(h));
      const newHeaders = [...new Set([...idCols, namesTo, valuesTo])];
      const onCols = pivotCols.map(esc).join(", ");
      await conn.query(`
        CREATE OR REPLACE TABLE "${next}" AS
        SELECT ${newHeaders.map(esc).join(", ")}
        FROM (UNPIVOT "${tbl}" ON ${onCols} INTO NAME ${esc(namesTo)} VALUE ${esc(valuesTo)})
      `);
      return { tableName: next, headers: newHeaders };
    }

    // ── Group 7: Cross-dataset ────────────────────────────────────────────────

    case "join": {
      const right = context?.datasets?.[step.rightId];
      if (!right?._duckdb?.tableName) return null;
      const rightTbl = right._duckdb.tableName;
      const rightHeaders = right.headers || [];
      const how = step.how === "inner" ? "INNER" : "LEFT";
      const suffix = step.suffix || "_r";
      const newCols = rightHeaders.filter(h => h !== step.rightKey);
      const newHeaders = [...headers];
      const rightSelExprs = newCols.map(h => {
        const dest = headers.includes(h) ? h + suffix : h;
        if (!newHeaders.includes(dest)) newHeaders.push(dest);
        return `r.${esc(h)} AS ${esc(dest)}`;
      });
      const leftSel  = headers.map(h => `l.${esc(h)}`).join(", ");
      const rightSel = rightSelExprs.length ? ", " + rightSelExprs.join(", ") : "";
      await conn.query(`
        CREATE OR REPLACE TABLE "${next}" AS
        SELECT ${leftSel}${rightSel}
        FROM "${tbl}" l
        ${how} JOIN "${rightTbl}" r ON l.${esc(step.leftKey)} = r.${esc(step.rightKey)}
      `);
      return { tableName: next, headers: newHeaders };
    }

    case "append": {
      const right = context?.datasets?.[step.rightId];
      if (!right?._duckdb?.tableName) return null;
      const rightTbl = right._duckdb.tableName;
      const rightHeaders = right.headers || [];
      const allHeaders = [...new Set([...headers, ...rightHeaders])];
      const leftSel  = allHeaders.map(h => headers.includes(h)      ? esc(h) : `NULL AS ${esc(h)}`).join(", ");
      const rightSel = allHeaders.map(h => rightHeaders.includes(h) ? esc(h) : `NULL AS ${esc(h)}`).join(", ");
      await conn.query(`
        CREATE OR REPLACE TABLE "${next}" AS
        SELECT ${leftSel} FROM "${tbl}"
        UNION ALL
        SELECT ${rightSel} FROM "${rightTbl}"
      `);
      return { tableName: next, headers: allHeaders };
    }

    // ── Group 8: Window aggregate (broadcast) ─────────────────────────────────

    case "grouped_mutate": {
      const { by, fn, col: gmCol, newCol } = step;
      if (!by?.length || !newCol) return null;
      if (fn === "expr" || fn === "any" || fn === "all") return null;
      const partBy = `PARTITION BY ${by.map(esc).join(", ")}`;
      const FN_MAP = {
        sum:   c => `SUM(${c}) OVER (${partBy})`,
        mean:  c => `AVG(${c}) OVER (${partBy})`,
        min:   c => `MIN(${c}) OVER (${partBy})`,
        max:   c => `MAX(${c}) OVER (${partBy})`,
        count: () => `COUNT(*) OVER (${partBy})`,
        first: c => `FIRST_VALUE(${c}) OVER (${partBy} ORDER BY rowid)`,
        last:  c => `LAST_VALUE(${c}) OVER (${partBy} ORDER BY rowid ROWS BETWEEN UNBOUNDED PRECEDING AND UNBOUNDED FOLLOWING)`,
      };
      const fnFn = FN_MAP[fn];
      if (!fnFn) return null;
      const newHeaders = headers.includes(newCol) ? headers : [...headers, newCol];
      const expr = fnFn(gmCol ? esc(gmCol) : "NULL");
      await conn.query(
        `CREATE OR REPLACE TABLE "${next}" AS SELECT *, ${expr} AS ${esc(newCol)} FROM "${tbl}"`
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
export async function runPipelineDuck(rawTableName, rawHeaders, steps, conn, context = {}) {
  let tableName = rawTableName;
  let headers   = [...rawHeaders];

  for (let i = 0; i < steps.length; i++) {
    const step = steps[i];

    if (SQL_STEPS.has(step.type)) {
      try {
        const result = await applyStepSQL(step, tableName, headers, conn, context);
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
    const { rows, headers: finalHeaders } = runPipeline(extractedRows, headers, remaining, context);
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
