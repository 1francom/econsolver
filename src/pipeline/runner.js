// ─── ECON STUDIO · pipeline/runner.js ────────────────────────────────────────
// Pure computation layer. Zero React imports.
// Extracted from WranglingModule.jsx — single source of truth for pipeline logic.
//
// Exports:
//   applyStep(rows, headers, step, context) → { rows, headers }
//   runPipeline(rows, headers, steps, context) → { rows, headers }
//
// context shape: { datasets: { [id]: { rows, headers } } }
// All steps are plain serialisable JSON — safe for localStorage persistence.
//
// Step schema (every step carries these base fields):
//   { id, type, datasetId, ...typeSpecificFields }
//   datasetId — ID of the dataset this step belongs to (matches sessionState dataset id / pid).
//               Used by the exporter (phase 9.5) to build the topological DAG.
//               runner.js ignores it — behavior is unchanged.

import { geocodeRowsFromCache } from "../services/data/geocoding.js";
import { PROTECTED_ROW_ID_COLS } from "../services/data/rowIdentity.js";

// ─── PATTERN CONSTANTS ────────────────────────────────────────────────────────
export const NA_PAT = /^(na|n\/a|nan|null|none|missing|#n\/a|\.|\s*)$/i;

// Row-identity columns (__row_id, __ri) are invariant — pipeline steps
// must not drop, rename, or overwrite them. See services/data/rowIdentity.js.
function assertNotProtected(col, stepType) {
  if (PROTECTED_ROW_ID_COLS.includes(col)) {
    throw new Error(
      `Pipeline step "${stepType}" is not allowed to touch protected row-identity column "${col}". ` +
      `__row_id and __ri must persist unchanged across all steps so cell-edit translations to R / Stata / Python remain valid.`
    );
  }
}

// ─── SMART NUMBER HELPERS ─────────────────────────────────────────────────────
// Column-level locale detection. Votes over all values to decide whether
// the column uses EU (dot=thousands, comma=decimal) or US (comma=thousands,
// dot=decimal) formatting. Used by extract_regex auto mode and CleanTab preview.
export function detectNumberLocale(values) {
  let eu = 0, us = 0;
  for (const v of values.filter(v => v != null).slice(0, 100)) {
    const s = String(v).replace(/[^\d.,]/g, "");
    const dots   = (s.match(/\./g) || []).length;
    const commas = (s.match(/,/g) || []).length;
    if (dots   > 1) eu += 3;          // 2.792.046 — dot is thousands
    if (commas > 1) us += 3;          // 1,580,025 — comma is thousands
    if (/,\d{1,2}$/.test(s)) eu += 2; // ends ,XX  — decimal comma (EU)
    if (/\.\d{1,2}$/.test(s)) us += 2;// ends .XX  — decimal dot  (US)
  }
  return eu >= us ? "EU" : "US";
}

// Per-value smart number parser.
// Handles: space-thousands, multiple-dot (EU), multiple-comma (US), mixed.
// colLocale is only used for the truly ambiguous "3 digits + comma + 3 digits"
// case where the column-level vote is the only available signal.
export function parseSmartNumber(raw, colLocale = "US") {
  if (raw == null) return null;
  let s = String(raw).trim();
  s = s.replace(/\s/g, "");                    // space-thousands: "4 253 525" → "4253525"
  s = s.replace(/^[^\d\-]+/, "").replace(/[^\d.,]+$/, ""); // strip currency/% prefix-suffix
  const str = s.replace(/[^\d.,\-]/g, "");
  if (!str) return null;

  const dots   = (str.match(/\./g) || []).length;
  const commas = (str.match(/,/g) || []).length;
  let norm;

  if (dots > 1 && commas === 0) {
    // 3.970.127 — multiple dots, no comma → EU thousands only
    norm = str.replace(/\./g, "");
  } else if (commas > 1 && dots === 0) {
    // 1,255,974 — multiple commas, no dot → US thousands only
    norm = str.replace(/,/g, "");
  } else if (dots > 0 && commas > 0) {
    // Both present — last separator is decimal
    norm = str.lastIndexOf(".") > str.lastIndexOf(",")
      ? str.replace(/,/g, "")               // 1,580,025.00 → dot decimal (US)
      : str.replace(/\./g, "").replace(",", "."); // 2.792.046,00 → comma decimal (EU)
  } else if (commas === 1 && dots === 0) {
    const [before, after] = str.split(",");
    if (after.length !== 3) {
      // 547,3419 or 912,0422 — non-3-digit tail → decimal comma
      norm = str.replace(",", ".");
    } else if (before.length >= 4) {
      // 9522,937 — 4+ digits before comma → thousands
      norm = str.replace(",", "");
    } else {
      // 837,450 — truly ambiguous (3 + comma + 3) → use column locale
      norm = colLocale === "EU" ? str.replace(",", ".") : str.replace(",", "");
    }
  } else if (dots === 1 && commas === 0) {
    const [before, after] = str.split(".");
    if (after.length !== 3) {
      // 3.14 or 3.14159 → decimal dot
      norm = str;
    } else if (before.length >= 4) {
      // 12345.678 → 4+ digits before → decimal (not thousands)
      norm = str;
    } else {
      // 3.970 — ambiguous → EU: thousands, US: decimal
      norm = colLocale === "EU" ? str.replace(".", "") : str;
    }
  } else {
    norm = str; // plain integer or single-separator decimal
  }

  const n = parseFloat(norm);
  return isFinite(n) ? n : null;
}

// ─── APPLY STEP ───────────────────────────────────────────────────────────────
export function applyStep(rows, headers, s, context = {}) {
  let R = rows, H = [...headers];
  switch (s.type) {
    case "rename":
      assertNotProtected(s.col,     "rename");
      assertNotProtected(s.newName, "rename");
      R = rows.map(r => { const c = {...r}; c[s.newName] = c[s.col]; delete c[s.col]; return c; });
      H = headers.map(h => h === s.col ? s.newName : h);
      break;

    case "drop":
      assertNotProtected(s.col, "drop");
      R = rows.map(r => { const c = {...r}; delete c[s.col]; return c; });
      H = headers.filter(h => h !== s.col);
      break;

    case "filter": {
      // ── predicate evaluator ──────────────────────────────────────────────────
      // Supports two shapes:
      //   Legacy:   { col, op, value }
      //   Compound: { predicate: PredicateNode }
      //
      // PredicateNode:
      //   { type:"and"|"or", children: PredicateNode[] }
      //   { type:"condition", col, op, value, values }
      //
      // Operators: notna | isna | eq | neq | gt | gte | lt | lte |
      //            in | nin | between | contains | startswith | endswith | regex

      function evalPredicate(node, row) {
        if (node.type === "and") return node.children.every(c => evalPredicate(c, row));
        if (node.type === "or")  return node.children.some(c  => evalPredicate(c, row));

        // leaf condition
        const v = row[node.col];
        const op = node.op;

        if (op === "notna")     return v !== null && v !== undefined;
        if (op === "isna")      return v === null || v === undefined;

        // For remaining ops null values never match
        if (v === null || v === undefined) return false;

        const sv = String(v);
        const nv = typeof v === "number" ? v : parseFloat(v);
        const val = node.value;
        const nval = parseFloat(val);

        if (op === "eq")        return sv === String(val);
        if (op === "neq")       return sv !== String(val);
        if (op === "gt")        return isFinite(nv) && nv > nval;
        if (op === "gte")       return isFinite(nv) && nv >= nval;
        if (op === "lt")        return isFinite(nv) && nv < nval;
        if (op === "lte")       return isFinite(nv) && nv <= nval;

        // in / nin: node.values is string[]
        if (op === "in") {
          const vals = Array.isArray(node.values) ? node.values : [String(val)];
          return vals.map(String).includes(sv);
        }
        if (op === "nin") {
          const vals = Array.isArray(node.values) ? node.values : [String(val)];
          return !vals.map(String).includes(sv);
        }

        // between: node.lo, node.hi (inclusive both ends)
        if (op === "between") {
          const lo = parseFloat(node.lo ?? node.value);
          const hi = parseFloat(node.hi ?? node.value2);
          return isFinite(nv) && nv >= lo && nv <= hi;
        }

        // string ops (case-insensitive)
        const svl = sv.toLowerCase();
        const vall = String(val ?? "").toLowerCase();
        if (op === "contains")   return svl.includes(vall);
        if (op === "startswith") return svl.startsWith(vall);
        if (op === "endswith")   return svl.endsWith(vall);
        if (op === "regex") {
          try { return new RegExp(val, "i").test(sv); } catch { return false; }
        }

        return true;
      }

      // Detect shape: formula expr > compound predicate > legacy flat
      if (s.expr) {
        // Formula mode: evaluate a boolean expression per row.
        // Pattern is consistent with the mutate sandbox already in this file.
        const safeH = H.filter(h => /^[a-zA-Z_$][a-zA-Z0-9_$]*$/.test(h));
        // eslint-disable-next-line no-new-func
        let filterFn; try { filterFn = new Function(...safeH, `"use strict"; return !!(${s.expr});`); } catch { break; }
        R = rows.filter(r => {
          try { return filterFn(...safeH.map(h => r[h] ?? null)); } catch { return true; }
        });
      } else if (s.predicate) {
        R = rows.filter(r => evalPredicate(s.predicate, r));
      } else {
        // Legacy flat shape — still fully supported
        const legacyNode = {
          type: "condition",
          col: s.col, op: s.op, value: s.value, values: s.values,
          lo: s.lo, hi: s.hi,
        };
        R = rows.filter(r => evalPredicate(legacyNode, r));
      }
      break;
    }

    case "fill_na": {
      // Strategies: mean | median | mode | constant | forward_fill | backward_fill
      const strategy = s.strategy || "mean";
      const numVals = rows.map(r => r[s.col]).filter(v => typeof v === "number" && isFinite(v));

      let fillVal = s.value ?? null; // used by "constant"

      if (strategy === "mean" && numVals.length) {
        fillVal = numVals.reduce((a, b) => a + b, 0) / numVals.length;
      } else if (strategy === "median" && numVals.length) {
        const sorted = [...numVals].sort((a, b) => a - b);
        const mid = Math.floor(sorted.length / 2);
        fillVal = sorted.length % 2 === 0 ? (sorted[mid - 1] + sorted[mid]) / 2 : sorted[mid];
      } else if (strategy === "mode") {
        const freq = {};
        rows.forEach(r => { const v = r[s.col]; if (v != null) freq[v] = (freq[v] || 0) + 1; });
        let best = null, bestN = -1;
        Object.entries(freq).forEach(([k, n]) => { if (n > bestN) { bestN = n; best = k; } });
        // Attempt numeric coercion for numeric columns; keep string otherwise
        fillVal = numVals.length > 0 ? parseFloat(best) : best;
      }

      if (strategy === "forward_fill") {
        let last = null;
        R = rows.map(r => {
          const v = r[s.col];
          if (v !== null && v !== undefined) { last = v; return r; }
          return { ...r, [s.col]: last };
        });
      } else if (strategy === "backward_fill") {
        let last = null;
        R = [...rows].reverse().map(r => {
          const v = r[s.col];
          if (v !== null && v !== undefined) { last = v; return r; }
          return { ...r, [s.col]: last };
        }).reverse();
      } else {
        R = rows.map(r => {
          const v = r[s.col];
          const isMissing = v === null || v === undefined;
          return isMissing ? { ...r, [s.col]: fillVal } : r;
        });
      }
      break;
    }

    case "ai_tr": {
      try {
        const js = (s.js || "").trim();
        // s.js may be a full arrow/function expression ("v => {...}", "function(v){...}")
        // or a raw function body ("if (v == null) return null; ...").
        // Detect by checking for arrow or function keyword at the start.
        const isFnExpr = /^(\(?\s*[\w$,\s]*\s*\)?\s*=>|\bfunction\b)/.test(js);
        const fn = isFnExpr
          ? new Function(`return (${js})`)()          // eval to get the arrow fn, then call per row
          : new Function("value", "rowIndex", js);    // body format — wrap directly
        R = rows.map((r, i) => ({ ...r, [s.col]: fn(r[s.col], i) }));
      } catch {}
      break;
    }

    case "log":
      R = rows.map(r => { const v = r[s.col]; return { ...r, [s.nn]: (typeof v === "number" && v > 0) ? Math.log(v) : null }; });
      if (!H.includes(s.nn)) H = [...H, s.nn];
      break;

    case "sq":
      R = rows.map(r => { const v = r[s.col]; return { ...r, [s.nn]: typeof v === "number" ? v * v : null }; });
      if (!H.includes(s.nn)) H = [...H, s.nn];
      break;

    case "std": {
      R = rows.map(r => { const v = r[s.col]; return { ...r, [s.nn]: (typeof v === "number" && s.sd > 0) ? (v - s.mu) / s.sd : null }; });
      if (!H.includes(s.nn)) H = [...H, s.nn];
      break;
    }

    case "winz":
      R = rows.map(r => { const v = r[s.col]; if (typeof v !== "number") return r; return { ...r, [s.nn || s.col]: Math.max(s.lo, Math.min(s.hi, v)) }; });
      if (s.nn && s.nn !== s.col && !H.includes(s.nn)) H = [...H, s.nn];
      break;

    case "ix":
      R = rows.map(r => { const a = r[s.c1], b = r[s.c2]; return { ...r, [s.nn]: (typeof a === "number" && typeof b === "number") ? a * b : null }; });
      if (!H.includes(s.nn)) H = [...H, s.nn];
      break;

    case "did":
      R = rows.map(r => { const t = r[s.tc], p = r[s.pc]; return { ...r, [s.nn]: (typeof t === "number" && typeof p === "number") ? t * p : null }; });
      if (!H.includes(s.nn)) H = [...H, s.nn];
      break;

    case "dummy": {
      const cats = [...new Set(rows.map(r => r[s.col]).filter(v => v != null))];
      R = rows.map(r => { const a = {...r}; cats.forEach(c => { a[`${s.pfx}_${c}`] = r[s.col] === c ? 1 : 0; }); return a; });
      cats.forEach(c => { const d = `${s.pfx}_${c}`; if (!H.includes(d)) H = [...H, d]; });
      break;
    }

    case "lag":
    case "lead": {
      const isL = s.type === "lag", n = s.n || 1;
      if (s.ec && s.tc) {
        const em = {};
        rows.forEach((r, idx) => { const e = r[s.ec]; if (!em[e]) em[e] = []; em[e].push({ idx, t: r[s.tc] }); });
        const rv = new Array(rows.length).fill(null);
        Object.values(em).forEach(g => {
          g.sort((a, b) => a.t - b.t);
          g.forEach((item, pos) => { const sp = isL ? pos - n : pos + n; if (sp >= 0 && sp < g.length) rv[item.idx] = rows[g[sp].idx][s.col]; });
        });
        R = rows.map((r, i) => ({ ...r, [s.nn]: rv[i] }));
      } else {
        R = rows.map((r, i) => { const si = isL ? i - n : i + n; return { ...r, [s.nn]: (si >= 0 && si < rows.length) ? rows[si][s.col] : null }; });
      }
      if (!H.includes(s.nn)) H = [...H, s.nn];
      break;
    }

    case "diff": {
      if (s.ec && s.tc) {
        const em = {};
        rows.forEach((r, idx) => { const e = r[s.ec]; if (!em[e]) em[e] = []; em[e].push({ idx, t: r[s.tc] }); });
        const rv = new Array(rows.length).fill(null);
        Object.values(em).forEach(g => {
          g.sort((a, b) => a.t - b.t);
          for (let p = 1; p < g.length; p++) {
            const c = rows[g[p].idx][s.col], pv = rows[g[p - 1].idx][s.col];
            if (typeof c === "number" && typeof pv === "number") rv[g[p].idx] = c - pv;
          }
        });
        R = rows.map((r, i) => ({ ...r, [s.nn]: rv[i] }));
      } else {
        R = rows.map((r, i) => {
          if (i === 0) return { ...r, [s.nn]: null };
          const c = r[s.col], p = rows[i - 1][s.col];
          return { ...r, [s.nn]: (typeof c === "number" && typeof p === "number") ? c - p : null };
        });
      }
      if (!H.includes(s.nn)) H = [...H, s.nn];
      break;
    }

    case "arrange": {
      // s.col: column to sort by
      // s.dir: "asc" | "desc"  (default: "asc")
      const dir = s.dir === "desc" ? -1 : 1;
      R = [...rows].sort((a, b) => {
        const av = a[s.col], bv = b[s.col];
        if (av === null || av === undefined) return 1;
        if (bv === null || bv === undefined) return -1;
        if (typeof av === "number" && typeof bv === "number") return dir * (av - bv);
        return dir * String(av).localeCompare(String(bv));
      });
      break;
    }

    case "group_summarize": {
      // Collapse rows to one row per group.
      // s.by:     array of grouping column names
      // s.aggs:   array of { col, fn, nn, q? }
      //           fn: "mean" | "sum" | "count" | "min" | "max" | "sd" | "median" | "quantile"
      //           nn: output column name
      const quantile7 = (sorted, p) => {
        const n = sorted.length;
        if (n === 0) return NaN;
        const h = (n - 1) * p;
        const lo = Math.floor(h);
        const hi = Math.ceil(h);
        return sorted[lo] + (sorted[hi] - sorted[lo]) * (h - lo);
      };
      const byKey = row => s.by.map(b => String(row[b] ?? "")).join("||");
      const groups = new Map();
      rows.forEach(r => {
        const k = byKey(r);
        if (!groups.has(k)) groups.set(k, { _key: k, _rows: [], _first: r });
        groups.get(k)._rows.push(r);
      });

      R = [];
      for (const { _first, _rows } of groups.values()) {
        const out = {};
        s.by.forEach(b => { out[b] = _first[b]; });
        (s.aggs || []).forEach(({ col, fn, nn, q }) => {
          const vals = _rows.map(r => r[col]).filter(v => typeof v === "number" && isFinite(v));
          if (fn === "count") { out[nn] = _rows.length; return; }
          if (!vals.length)  { out[nn] = null; return; }
          if (fn === "sum")    { out[nn] = vals.reduce((a, b) => a + b, 0); return; }
          if (fn === "min")    { out[nn] = Math.min(...vals); return; }
          if (fn === "max")    { out[nn] = Math.max(...vals); return; }
          const mean = vals.reduce((a, b) => a + b, 0) / vals.length;
          if (fn === "mean")   { out[nn] = mean; return; }
          if (fn === "sd") {
            out[nn] = vals.length > 1
              ? Math.sqrt(vals.reduce((s, v) => s + (v - mean) ** 2, 0) / (vals.length - 1))
              : 0;
            return;
          }
          if (fn === "median") {
            const sorted = [...vals].sort((a, b) => a - b);
            const mid = Math.floor(sorted.length / 2);
            out[nn] = sorted.length % 2 === 0 ? (sorted[mid - 1] + sorted[mid]) / 2 : sorted[mid];
            return;
          }
          if (fn === "quantile") {
            const p = Math.min(1, Math.max(0, Number.isFinite(Number(q)) ? Number(q) : 0.5));
            const sorted = [...vals].sort((a, b) => a - b);
            out[nn] = quantile7(sorted, p);
            return;
          }
          out[nn] = null;
        });
        R.push(out);
      }

      // Rebuild headers: grouping cols + aggregation output cols
      const newCols = (s.aggs || []).map(a => a.nn);
      H = [...s.by, ...newCols.filter(c => !s.by.includes(c))];
      break;
    }

    case "recode": {
      const map = s.map || {};
      R = rows.map(r => { const v = r[s.col]; const k = v != null ? String(v) : null; return { ...r, [s.col]: k != null && map[k] !== undefined ? map[k] : v }; });
      break;
    }

    case "quickclean": {
      const mode = s.mode || "lower";
      R = rows.map(r => {
        const v = r[s.col];
        if (typeof v !== "string") return r;
        const t = v.trim();
        let out = t;
        if (mode === "lower") out = t.toLowerCase();
        else if (mode === "upper") out = t.toUpperCase();
        else if (mode === "title") out = t.replace(/\b\w/g, c => c.toUpperCase()).replace(/\B\w/g, c => c.toLowerCase());
        return { ...r, [s.col]: out };
      });
      break;
    }

    case "distinct": {
      // s.subset: string[] (cols to dedup on; empty = all)  s.keep: "first"|"last"
      const cols = (Array.isArray(s.subset) && s.subset.length) ? s.subset : H;
      const keep = s.keep === "last" ? "last" : "first";
      const keyOf = r => JSON.stringify(cols.map(h => r[h] ?? null));
      if (keep === "first") {
        const seen = new Set();
        R = rows.filter(r => { const k = keyOf(r); if (seen.has(k)) return false; seen.add(k); return true; });
      } else {
        const lastIdx = new Map();
        rows.forEach((r, i) => lastIdx.set(keyOf(r), i));
        const keepIdx = new Set(lastIdx.values());
        R = rows.filter((_, i) => keepIdx.has(i));
      }
      break;
    }

    // ── date_parse ────────────────────────────────────────────────────────────
    // Converts a raw date column (numeric YYYYMMDD, string YYYYMMDD, or any
    // JS-parseable string) into a normalised "YYYY-MM-DD" string in-place
    // (or into a new column if s.nn is set and differs from s.col).
    //
    // Supported input formats (auto-detected):
    //   • integer / string  YYYYMMDD   → "2020-01-01"
    //   • string  YYYY-MM-DD / YYYY/MM/DD / DD-MM-YYYY / DD/MM/YYYY / MM-DD-YYYY
    //   • any JS-parseable string (fallback via new Date())
    //
    // s.col      – source column
    // s.nn       – (optional) output column; defaults to s.col (in-place)
    // s.fmt      – hint: "YYYYMMDD" | "DDMMYYYY" | "MMDDYYYY" | "auto" (default)
    case "date_parse": {
      const outCol = s.nn && s.nn !== s.col ? s.nn : s.col;
      const fmt = s.fmt || "auto";

      const parseToISO = v => {
        if (v === null || v === undefined) return null;
        const raw = String(v).trim();

        // ── Numeric / 8-char YYYYMMDD ──────────────────────────────────────
        if (fmt === "YYYYMMDD" || (fmt === "auto" && /^\d{8}$/.test(raw))) {
          const yr = raw.slice(0, 4), mo = raw.slice(4, 6), dy = raw.slice(6, 8);
          const y = +yr, m = +mo, d = +dy;
          if (y >= 1000 && y <= 9999 && m >= 1 && m <= 12 && d >= 1 && d <= 31)
            return `${yr}-${mo}-${dy}`;
          return null;
        }

        // ── 6-digit YYMMDD (e.g. 911202 → 1991-12-02) ──────────────────────
        // Century rule: yy >= 70 → 1900+yy, else 2000+yy
        if (fmt === "YYMMDD" || (fmt === "auto" && /^\d{6}$/.test(raw))) {
          const yy = +raw.slice(0, 2), mo = +raw.slice(2, 4), dy = +raw.slice(4, 6);
          if (mo >= 1 && mo <= 12 && dy >= 1 && dy <= 31) {
            const yr = yy >= 70 ? 1900 + yy : 2000 + yy;
            return `${yr}-${String(mo).padStart(2,"0")}-${String(dy).padStart(2,"0")}`;
          }
          return null;
        }

        // ── 6-digit DDMMYY (e.g. 021291 → 1991-12-02) ──────────────────────
        if (fmt === "DDMMYY") {
          const dd = +raw.slice(0, 2), mo = +raw.slice(2, 4), yy = +raw.slice(4, 6);
          if (mo >= 1 && mo <= 12 && dd >= 1 && dd <= 31) {
            const yr = yy >= 70 ? 1900 + yy : 2000 + yy;
            return `${yr}-${String(mo).padStart(2,"0")}-${String(dd).padStart(2,"0")}`;
          }
          return null;
        }

        // ── 6-digit MMDDYY (e.g. 120291 → 1991-12-02) ──────────────────────
        if (fmt === "MMDDYY") {
          const mo = +raw.slice(0, 2), dd = +raw.slice(2, 4), yy = +raw.slice(4, 6);
          if (mo >= 1 && mo <= 12 && dd >= 1 && dd <= 31) {
            const yr = yy >= 70 ? 1900 + yy : 2000 + yy;
            return `${yr}-${String(mo).padStart(2,"0")}-${String(dd).padStart(2,"0")}`;
          }
          return null;
        }

        // ── DD-MM-YYYY or DD/MM/YYYY ────────────────────────────────────────
        if (fmt === "DDMMYYYY") {
          const m = raw.match(/^(\d{1,2})[-/.](\d{1,2})[-/.](\d{4})$/);
          if (m) return `${m[3]}-${m[2].padStart(2,"0")}-${m[1].padStart(2,"0")}`;
          return null;
        }

        // ── MM-DD-YYYY or MM/DD/YYYY ────────────────────────────────────────
        if (fmt === "MMDDYYYY") {
          const m = raw.match(/^(\d{1,2})[-/.](\d{1,2})[-/.](\d{4})$/);
          if (m) return `${m[3]}-${m[1].padStart(2,"0")}-${m[2].padStart(2,"0")}`;
          return null;
        }

        // ── auto: try common separators ─────────────────────────────────────
        // YYYY-MM-DD or YYYY/MM/DD already in ISO form
        if (/^\d{4}[-/]\d{1,2}[-/]\d{1,2}/.test(raw)) {
          const d = new Date(raw.replace(/\//g, "-").slice(0, 10));
          if (!isNaN(d.getTime())) return d.toISOString().slice(0, 10);
          return null;
        }

        // Fallback: JS Date parser (handles "Jan 1 2020", RFC-2822, etc.)
        const d = new Date(raw);
        if (!isNaN(d.getTime())) return d.toISOString().slice(0, 10);
        return null;
      };

      R = rows.map(r => ({ ...r, [outCol]: parseToISO(r[s.col]) }));
      if (outCol !== s.col && !H.includes(outCol)) H = [...H, outCol];
      break;
    }

    // ── date_extract ──────────────────────────────────────────────────────────
    // Extracts calendar features from an ISO "YYYY-MM-DD" string column
    // (run date_parse first if the source is raw numeric YYYYMMDD).
    //
    // Supported parts: year | month | day | dow | week | quarter | isweekend
    case "date_extract": {
      // Robust parser: handles ISO strings ("2020-01-15"), JS Date objects,
      // and legacy numeric YYYYMMDD integers as a safety net.
      const parseDate = v => {
        if (v == null) return null;
        let s2 = String(v).trim();
        // Safety net: bare 8-digit number → try YYYYMMDD
        if (/^\d{8}$/.test(s2))
          s2 = `${s2.slice(0,4)}-${s2.slice(4,6)}-${s2.slice(6,8)}`;
        // Use UTC noon to avoid DST boundary issues
        const d = new Date(`${s2.slice(0,10)}T12:00:00Z`);
        return isNaN(d.getTime()) ? null : d;
      };

      // ISO week number (Mon-based, ISO 8601)
      const isoWeek = d => {
        const thu = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
        const dayNum = (thu.getUTCDay() + 6) % 7; // Mon=0
        thu.setUTCDate(thu.getUTCDate() - dayNum + 3);
        const firstThu = new Date(Date.UTC(thu.getUTCFullYear(), 0, 4));
        return 1 + Math.round((thu.getTime() - firstThu.getTime()) / 604800000);
      };

      s.parts.forEach(part => {
        const nn = s.names[part];
        if (!nn) return;
        R = R.map(r => {
          const d = parseDate(r[s.col]);
          if (!d) return { ...r, [nn]: null };
          if (part === "year")      return { ...r, [nn]: d.getUTCFullYear() };
          if (part === "month")     return { ...r, [nn]: d.getUTCMonth() + 1 };     // 1–12
          if (part === "day")       return { ...r, [nn]: d.getUTCDate() };           // 1–31
          if (part === "dow")       return { ...r, [nn]: d.getUTCDay() };            // 0=Sun…6=Sat
          if (part === "week")      return { ...r, [nn]: isoWeek(d) };               // ISO week 1–53
          if (part === "quarter")   return { ...r, [nn]: Math.ceil((d.getUTCMonth() + 1) / 3) }; // 1–4
          if (part === "isweekend") {
            const dow = d.getUTCDay();
            return { ...r, [nn]: (dow === 0 || dow === 6) ? 1 : 0 };
          }
          return r;
        });
        if (!H.includes(nn)) H = [...H, nn];
      });
      break;
    }

    case "join": {
      const right = context?.datasets?.[s.rightId];
      if (!right) break;
      const rRows = right.rows, rHeaders = right.headers;
      const how = s.how || "left";
      const newCols = rHeaders.filter(h => h !== s.rightKey);
      const destOf = h => (H.includes(h) ? `${h}${s.suffix || "_r"}` : h);

      // Build right lookup (first match wins, matching prior behavior).
      const rightMap = new Map();
      rRows.forEach(r => { const k = String(r[s.rightKey] ?? ""); if (!rightMap.has(k)) rightMap.set(k, r); });

      // Filtering joins: add NO columns, just keep/drop left rows.
      if (how === "semi" || how === "anti") {
        R = rows.filter(r => {
          const k = String(r[s.leftKey] ?? "");
          const has = rightMap.has(k);
          return how === "semi" ? has : !has;
        });
        break;
      }

      // Right join: iterate right rows, attach matching left.
      if (how === "right") {
        const leftMap = new Map();
        rows.forEach(r => { const k = String(r[s.leftKey] ?? ""); if (!leftMap.has(k)) leftMap.set(k, r); });
        R = rRows.map(rr => {
          const k = String(rr[s.rightKey] ?? "");
          const lm = leftMap.get(k);
          const merged = {};
          H.forEach(h => { merged[h] = lm ? (lm[h] ?? null) : null; });
          newCols.forEach(h => { merged[destOf(h)] = rr[h] ?? null; });
          return merged;
        });
        newCols.forEach(h => { const d = destOf(h); if (!H.includes(d)) H = [...H, d]; });
        break;
      }

      // Left / inner / full.
      const matchedRightKeys = new Set();
      const outRows = [];
      rows.forEach(r => {
        const k = String(r[s.leftKey] ?? "");
        const match = rightMap.get(k);
        if (match) {
          matchedRightKeys.add(k);
          const merged = { ...r };
          newCols.forEach(h => { merged[destOf(h)] = match[h] ?? null; });
          outRows.push(merged);
        } else if (how === "left" || how === "full") {
          const merged = { ...r };
          newCols.forEach(h => { merged[destOf(h)] = null; });
          outRows.push(merged);
        }
        // inner: drop unmatched left rows
      });
      if (how === "full") {
        rRows.forEach(rr => {
          const k = String(rr[s.rightKey] ?? "");
          if (matchedRightKeys.has(k)) return;
          const merged = {};
          H.forEach(h => { merged[h] = null; });
          newCols.forEach(h => { merged[destOf(h)] = rr[h] ?? null; });
          outRows.push(merged);
        });
      }
      R = outRows;
      newCols.forEach(h => { const d = destOf(h); if (!H.includes(d)) H = [...H, d]; });
      break;
    }

    case "append": {
      const right = context?.datasets?.[s.rightId];
      if (!right) break;
      const rRows = right.rows, rHeaders = right.headers;
      const onlyRight = rHeaders.filter(h => !H.includes(h));
      R = [
        ...rows.map(r => { const c = {...r}; onlyRight.forEach(h => { c[h] = null; }); return c; }),
        ...rRows.map(r => { const c = {}; [...H, ...onlyRight].forEach(h => { c[h] = r[h] ?? null; }); return c; }),
      ];
      onlyRight.forEach(h => { if (!H.includes(h)) H = [...H, h]; });
      break;
    }

    case "bind_cols": {
      const right = context?.datasets?.[s.rightId];
      if (!right) break;
      const rRows = right.rows, rHeaders = right.headers;
      const m = Math.min(rows.length, rRows.length); // truncate to shorter
      const destOf = h => (H.includes(h) ? `${h}${s.suffix || "_r"}` : h);
      R = [];
      for (let i = 0; i < m; i++) {
        const merged = { ...rows[i] };
        rHeaders.forEach(h => { merged[destOf(h)] = rRows[i][h] ?? null; });
        R.push(merged);
      }
      rHeaders.forEach(h => { const d = destOf(h); if (!H.includes(d)) H = [...H, d]; });
      break;
    }

    case "union": {
      // vertical stack + drop full-row duplicates over the union column set
      const right = context?.datasets?.[s.rightId];
      if (!right) break;
      const rRows = right.rows, rHeaders = right.headers;
      const onlyRight = rHeaders.filter(h => !H.includes(h));
      const allCols = [...H, ...onlyRight];
      const stacked = [
        ...rows.map(r => { const c = {}; allCols.forEach(h => { c[h] = r[h] ?? null; }); return c; }),
        ...rRows.map(r => { const c = {}; allCols.forEach(h => { c[h] = r[h] ?? null; }); return c; }),
      ];
      const seen = new Set();
      R = stacked.filter(r => {
        const key = JSON.stringify(allCols.map(h => r[h]));
        if (seen.has(key)) return false;
        seen.add(key); return true;
      });
      onlyRight.forEach(h => { if (!H.includes(h)) H = [...H, h]; });
      break;
    }

    case "intersect":
    case "setdiff": {
      // keep current rows that DO (intersect) / do NOT (setdiff) appear in the
      // other dataset, matched on shared columns
      const right = context?.datasets?.[s.rightId];
      if (!right) break;
      const shared = H.filter(h => right.headers.includes(h));
      const rightKeys = new Set(
        right.rows.map(r => JSON.stringify(shared.map(h => r[h] ?? null)))
      );
      R = rows.filter(r => {
        const key = JSON.stringify(shared.map(h => r[h] ?? null));
        const inRight = rightKeys.has(key);
        return s.type === "intersect" ? inRight : !inRight;
      });
      break; // headers unchanged
    }

    case "mutate": {
      const helpers = {
        ifelse:   (c, t, f) => c ? t : f,
        between:  (x, lo, hi) => (typeof x === "number" && x >= lo && x <= hi) ? 1 : 0,
        log:      (x) => (typeof x === "number" && x > 0) ? Math.log(x) : null,
        log2:     (x) => (typeof x === "number" && x > 0) ? Math.log2(x) : null,
        log10:    (x) => (typeof x === "number" && x > 0) ? Math.log10(x) : null,
        sqrt:     (x) => (typeof x === "number" && x >= 0) ? Math.sqrt(x) : null,
        exp:      (x) => typeof x === "number" ? Math.exp(x) : null,
        abs:      (x) => typeof x === "number" ? Math.abs(x) : null,
        round:    (x, d = 0) => typeof x === "number" ? Math.round(x * 10 ** d) / 10 ** d : null,
        floor:    (x) => typeof x === "number" ? Math.floor(x) : null,
        ceil:     (x) => typeof x === "number" ? Math.ceil(x) : null,
        sign:     (x) => typeof x === "number" ? Math.sign(x) : null,
        isna:     (x) => (x === null || x === undefined) ? 1 : 0,
        notna:    (x) => (x !== null && x !== undefined) ? 1 : 0,
        coalesce: (...args) => args.find(v => v !== null && v !== undefined) ?? null,
        pmin:     (a, b) => (typeof a === "number" && typeof b === "number") ? Math.min(a, b) : null,
        pmax:     (a, b) => (typeof a === "number" && typeof b === "number") ? Math.max(a, b) : null,
        min:      (a, b) => (typeof a === "number" && typeof b === "number") ? Math.min(a, b) : null,
        max:      (a, b) => (typeof a === "number" && typeof b === "number") ? Math.max(a, b) : null,
        pow:      (x, n) => (typeof x === "number" && typeof n === "number") ? Math.pow(x, n) : null,
        clamp:    (x, lo, hi) => typeof x === "number" ? Math.max(lo, Math.min(hi, x)) : null,
        rescale:  (x, oMin, oMax, nMin = 0, nMax = 1) => (typeof x === "number" && oMax !== oMin) ? (nMin + (x - oMin) * (nMax - nMin) / (oMax - oMin)) : null,
        case_when: (...pairs) => {
          for (let i = 0; i < pairs.length - 1; i += 2) { if (pairs[i]) return pairs[i + 1]; }
          return pairs.length % 2 === 1 ? pairs[pairs.length - 1] : null;
        },
      };
      const safeH = H.filter(h => /^[a-zA-Z_$][a-zA-Z0-9_$]*$/.test(h));
      const pNames = [...Object.keys(helpers), "row", ...safeH];
      let fn;
      try { fn = new Function(...pNames, `"use strict";return (${s.expr});`); } catch { break; }
      R = rows.map(r => {
        const pVals = [...Object.values(helpers), r, ...safeH.map(h => r[h] ?? null)];
        let val = null;
        try {
          val = fn(...pVals);
          if (val === undefined || val === null || (typeof val === "number" && !isFinite(val))) val = null;
        } catch {}
        return { ...r, [s.nn]: val };
      });
      if (!H.includes(s.nn)) H = [...H, s.nn];
      break;
    }

    case "if_else": {
      // s.cond:     JS boolean expression string (column names available as variables)
      // s.trueVal:  literal value or column name for true branch
      // s.falseVal: literal value or column name for false branch
      // s.nn:       output column name
      const safeH_ife = H.filter(h => /^[a-zA-Z_$][a-zA-Z0-9_$]*$/.test(h));
      // eslint-disable-next-line no-new-func
      let ifeFn; try { ifeFn = new Function(...safeH_ife, `"use strict"; return !!(${s.cond});`); } catch { break; }
      R = rows.map(r => {
        let result = false;
        try { result = ifeFn(...safeH_ife.map(h => r[h] ?? null)); } catch {}
        // trueVal/falseVal: if it matches a header, use that column's value; else use as literal
        const tv = H.includes(s.trueVal)  ? r[s.trueVal]  : s.trueVal;
        const fv = H.includes(s.falseVal) ? r[s.falseVal] : s.falseVal;
        return { ...r, [s.nn]: result ? tv : fv };
      });
      if (!H.includes(s.nn)) H = [...H, s.nn];
      break;
    }

    case "case_when": {
      // s.cases:      [{ cond: string, val: string|number }, ...]
      // s.defaultVal: fallback value when no condition matches
      // s.nn:         output column name
      const safeH_cw = H.filter(h => /^[a-zA-Z_$][a-zA-Z0-9_$]*$/.test(h));
      const caseFns = (s.cases ?? []).map(c => {
        // eslint-disable-next-line no-new-func
        try { return new Function(...safeH_cw, `"use strict"; return !!(${c.cond});`); }
        catch { return null; }
      });
      R = rows.map(r => {
        const args = safeH_cw.map(h => r[h] ?? null);
        for (let i = 0; i < (s.cases ?? []).length; i++) {
          if (!caseFns[i]) continue;
          try { if (caseFns[i](...args)) return { ...r, [s.nn]: s.cases[i].val }; } catch {}
        }
        return { ...r, [s.nn]: s.defaultVal ?? null };
      });
      if (!H.includes(s.nn)) H = [...H, s.nn];
      break;
    }

    case "type_cast": {
      // Convert a column to a target type in-place.
      // s.col:    column name
      // s.to:     "number" | "number_smart" | "string" | "boolean"
      //   number       — strict: bare Number(), NaN → null
      //   number_smart — locale-aware: detectNumberLocale + parseSmartNumber
      //                  handles EU/US/space-thousands mixed formats
      // Unparseable values → null (never silently corrupt)
      const colLocaleCache = s.to === "number_smart"
        ? detectNumberLocale(rows.map(r => r[s.col]))
        : null;
      R = rows.map(r => {
        const v = r[s.col];
        if (v === null || v === undefined) return r;
        let out = null;
        if (s.to === "number") {
          const n = Number(v);
          out = isFinite(n) ? n : null;
        } else if (s.to === "number_smart") {
          out = parseSmartNumber(v, colLocaleCache);
        } else if (s.to === "string") {
          out = String(v);
        } else if (s.to === "boolean") {
          // Truthy strings: "1", "true", "yes", "y" (case-insensitive)
          if (typeof v === "number") out = v !== 0 ? 1 : 0;
          else out = /^(1|true|yes|y)$/i.test(String(v).trim()) ? 1 : 0;
        }
        return { ...r, [s.col]: out };
      });
      break;
    }

    case "drop_na": {
      // Remove rows where the target column(s) are null/undefined.
      // s.cols:  string[] — columns to check (required)
      // s.how:   "any" (default) | "all"
      //   "any" → drop row if ANY of s.cols is null
      //   "all" → drop row only if ALL of s.cols are null
      const cols = s.cols || (s.col ? [s.col] : H);
      const isNull = v => v === null || v === undefined;
      R = rows.filter(r => {
        const nulls = cols.filter(c => isNull(r[c]));
        if (s.how === "all") return nulls.length < cols.length;
        return nulls.length === 0; // "any" — default
      });
      break;
    }

    case "normalize_cats": {
      // Apply a value-replacement map to a categorical column.
      // Equivalent to running fuzzyGroups + applying canonical mapping.
      // s.col:  column name
      // s.map:  Record<originalValue, canonicalValue>  (plain JSON — serializable)
      // Values not in map are left unchanged.
      const map = s.map || {};
      R = rows.map(r => {
        const v = r[s.col];
        if (v === null || v === undefined) return r;
        const k = String(v);
        return { ...r, [s.col]: map[k] !== undefined ? map[k] : v };
      });
      break;
    }


    // ── fill_na_grouped ───────────────────────────────────────────────────────
    // Impute nulls using the within-group mean or median.
    // Equivalent to dplyr group_by(...groupCols) |>
    //   mutate(col = ifelse(is.na(col), mean(col, na.rm=TRUE), col))
    //
    // s.col       – column to impute
    // s.groupCol  – string OR string[] of grouping columns
    //               (e.g. "country" or ["country","sector"])
    // s.strategy  – "mean" | "median"
    case "fill_na_grouped": {
      const strategy  = s.strategy || "mean";
      // Normalise groupCol to always be an array
      const groupCols = Array.isArray(s.groupCol)
        ? s.groupCol
        : (s.groupCol ? [s.groupCol] : []);

      if (!groupCols.length) break; // nothing to do

      // Composite key: "valA||valB" for multi-column groups
      const makeKey = r => groupCols.map(c => String(r[c] ?? "")).join("||");

      // 1. Build per-group statistic from non-null values
      const groups = {};
      rows.forEach(r => {
        const k = makeKey(r);
        const v = r[s.col];
        if (!groups[k]) groups[k] = [];
        if (typeof v === "number" && isFinite(v)) groups[k].push(v);
      });

      const groupStat = {};
      Object.entries(groups).forEach(([k, vals]) => {
        if (!vals.length) { groupStat[k] = null; return; }
        if (strategy === "median") {
          const sorted = [...vals].sort((a, b) => a - b);
          const mid = Math.floor(sorted.length / 2);
          groupStat[k] = sorted.length % 2 === 0
            ? (sorted[mid - 1] + sorted[mid]) / 2
            : sorted[mid];
        } else {
          groupStat[k] = vals.reduce((a, b) => a + b, 0) / vals.length;
        }
      });

      // 2. Impute nulls; non-null values untouched
      R = rows.map(r => {
        const v = r[s.col];
        if (v !== null && v !== undefined) return r;
        const fill = groupStat[makeKey(r)] ?? null;
        return { ...r, [s.col]: fill };
      });
      break;
    }

    // ── grouped_mutate ────────────────────────────────────────────────────────
    // dplyr group_by() %>% mutate() equivalent. All rows stay; a new column is
    // computed per group and broadcast back to every row in that group.
    //
    // s.by        – string[] — grouping columns
    // s.fn        – "any"|"all"|"sum"|"mean"|"min"|"max"|"count"|"first"|"last"
    // s.col       – source column (required for non-conditional fns)
    // s.condition – [{col, op, val}][] — filter conditions for any/all
    // s.newCol    – output column name
    case "grouped_mutate": {
      const { by, fn, col, condition, newCol } = s;
      if (!by?.length || !newCol) { R = rows; break; }

      // Build group membership
      const makeKey = r => by.map(b => String(r[b] ?? "")).join("\x00");
      const groupMap = new Map();
      rows.forEach(r => {
        const k = makeKey(r);
        if (!groupMap.has(k)) groupMap.set(k, []);
        groupMap.get(k).push(r);
      });

      // Evaluate one condition against a row
      function matchOne(r, { col: c, op, val }) {
        const rv = r[c], nv = Number(val);
        if (op === "notna") return rv !== null && rv !== undefined;
        if (op === "isna")  return rv === null  || rv === undefined;
        if (op === "==" || op === "=")   return String(rv) === String(val) || rv === nv;
        if (op === "!=" || op === "<>") return String(rv) !== String(val) && rv !== nv;
        if (op === ">")  return Number(rv) >  nv;
        if (op === ">=") return Number(rv) >= nv;
        if (op === "<")  return Number(rv) <  nv;
        if (op === "<=") return Number(rv) <= nv;
        return true;
      }

      // ── fn:"expr" mode — group-aware expression evaluation ────────────────
      if (fn === "expr") {
        const { expr: exprStr, filter: filt, newCol: nc } = s;
        if (!exprStr || !nc) { R = rows; break; }

        function makeGH(filtRows) {
          const toArr = v => {
            if (Array.isArray(v)) return v;
            if (typeof v === "string") return filtRows.map(r => r[v]);
            return [];
          };
          const nums = v => toArr(v).filter(x => x !== null && x !== undefined && isFinite(+x)).map(Number);
          return {
            any:   v => Array.isArray(v) ? (v.some(x=>x&&x!=="0"&&x!=="false")?1:0) : typeof v==="string" ? (filtRows.map(r=>r[v]).some(x=>x&&x!=="0"&&x!=="false")?1:0) : (v?1:0),
            all:   v => Array.isArray(v) ? ((v.length>0&&v.every(x=>x&&x!=="0"&&x!=="false"))?1:0) : typeof v==="string" ? (()=>{const a=filtRows.map(r=>r[v]);return(a.length>0&&a.every(x=>x&&x!=="0"&&x!=="false"))?1:0;})() : (v?1:0),
            sum:   v => nums(v).reduce((a, b) => a + b, 0),
            mean:  v => { const a = nums(v); return a.length ? a.reduce((x,y)=>x+y,0)/a.length : null; },
            min:   v => { const a = nums(v); return a.length ? Math.min(...a) : null; },
            max:   v => { const a = nums(v); return a.length ? Math.max(...a) : null; },
            count: ()=> filtRows.length,
            first: v => toArr(v)[0] ?? null,
            last:  v => { const a = toArr(v); return a[a.length-1] ?? null; },
          };
        }

        function matchFilt(r, { col: c, op, val }) {
          const rv = r[c], nv = Number(val);
          if (op === "notna") return rv !== null && rv !== undefined;
          if (op === "isna")  return rv === null  || rv === undefined;
          if (op === "==" || op === "=")   return String(rv) === String(val) || rv === nv;
          if (op === "!=" || op === "<>") return String(rv) !== String(val) && rv !== nv;
          if (op === ">")  return Number(rv) >  nv;
          if (op === ">=") return Number(rv) >= nv;
          if (op === "<")  return Number(rv) <  nv;
          if (op === "<=") return Number(rv) <= nv;
          return true;
        }

        const rowValsExpr = new Map();
        for (const [, grp] of groupMap) {
          const filtRows = filt?.length ? grp.filter(r => filt.every(c => matchFilt(r, c))) : grp;
          const colArrays = {};
          const allHeaders = grp.length ? Object.keys(grp[0]) : [];
          allHeaders.forEach(h => { colArrays[h] = filtRows.map(r => r[h]); });
          const gh = makeGH(filtRows);
          const ROW_H = {
            ifelse:(t,a,b)=>t?a:b, between:(v,lo,hi)=>v>=lo&&v<=hi,
            log:Math.log, log2:Math.log2, log10:Math.log10, sqrt:Math.sqrt,
            exp:Math.exp, abs:Math.abs, round:Math.round, floor:Math.floor,
            ceil:Math.ceil, sign:Math.sign,
            isna:  v=>v===null||v===undefined||(typeof v==="number"&&isNaN(v)),
            notna: v=>v!==null&&v!==undefined&&!(typeof v==="number"&&isNaN(v)),
            coalesce:(...a)=>a.find(v=>v!==null&&v!==undefined)??null,
            pmin:Math.min, pmax:Math.max,
            clamp:(v,lo,hi)=>Math.min(Math.max(v,lo),hi),
            rescale:(v,omin,omax,nmin=0,nmax=1)=>nmin+((v-omin)/(omax-omin))*(nmax-nmin),
            case_when:(...pairs)=>{for(let i=0;i<pairs.length-1;i+=2)if(pairs[i])return pairs[i+1];return pairs.length%2===1?pairs[pairs.length-1]:null;},
          };
          let groupVal;
          try {
            // NOTE: new Function() is the intentional sandbox used throughout this
            // codebase for user-authored math expressions (same pattern in mutate,
            // ai_tr, CalculateTab, SimulateTab). Input is researcher-typed formula,
            // not external/untrusted data. Scope is locked to injected column arrays
            // and helper functions — no globals accessible.
            const evalFn = new Function( // eslint-disable-line no-new-func
              ...Object.keys(colArrays), ...Object.keys(gh), ...Object.keys(ROW_H),
              `"use strict"; return (${exprStr});`
            );
            groupVal = evalFn(...Object.values(colArrays), ...Object.values(gh), ...Object.values(ROW_H));
          } catch { groupVal = null; }
          if (typeof groupVal === "boolean") groupVal = groupVal ? 1 : 0;
          grp.forEach(r => rowValsExpr.set(r, groupVal));
        }
        R = rows.map(r => ({ ...r, [nc]: rowValsExpr.get(r) ?? null }));
        if (!H.includes(nc)) H = [...H, nc];
        break;
      }

      const rowVals = new Map();
      for (const [, grp] of groupMap) {
        let val;
        if (fn === "any" || fn === "all") {
          const flags = grp.map(r => !condition?.length || condition.every(c => matchOne(r, c)));
          val = fn === "any" ? flags.some(Boolean) : flags.every(Boolean);
        } else if (fn === "count") {
          val = grp.length;
        } else {
          const nums = grp.map(r => r[col]).filter(v => v !== null && v !== undefined && isFinite(+v)).map(Number);
          if      (fn === "sum")   val = nums.reduce((a, b) => a + b, 0);
          else if (fn === "mean")  val = nums.length ? nums.reduce((a, b) => a + b, 0) / nums.length : null;
          else if (fn === "min")   val = nums.length ? Math.min(...nums) : null;
          else if (fn === "max")   val = nums.length ? Math.max(...nums) : null;
          else if (fn === "first") val = grp[0]?.[col] ?? null;
          else if (fn === "last")  val = grp[grp.length - 1]?.[col] ?? null;
        }
        grp.forEach(r => rowVals.set(r, val));
      }

      R = rows.map(r => ({ ...r, [newCol]: rowVals.get(r) ?? null }));
      if (!H.includes(newCol)) H = [...H, newCol];
      break;
    }

    // ── trim_outliers ─────────────────────────────────────────────────────────
    // Row-dropping complement to winsorize. Removes rows where the value lies
    // outside [lo, hi]. Bounds are stored at step-creation time for full
    // reproducibility (same semantics as winz).
    //
    // s.col  – numeric column
    // s.lo   – lower bound (e.g. p1 value)
    // s.hi   – upper bound (e.g. p99 value)
    case "trim_outliers": {
      R = rows.filter(r => {
        const v = r[s.col];
        if (typeof v !== "number" || !isFinite(v)) return true; // keep NAs
        return v >= s.lo && v <= s.hi;
      });
      break;
    }

    // ── flag_outliers ─────────────────────────────────────────────────────────
    // Creates a binary dummy column (0/1) marking IQR or Z-score outliers.
    // Does NOT remove rows — flags them for researcher inspection.
    //
    // s.col    – numeric column to examine
    // s.nn     – output column name (e.g. "wage_outlier")
    // s.method – "iqr" (default) | "zscore"
    //   iqr:    outlier if v < Q1 − 1.5·IQR  or  v > Q3 + 1.5·IQR
    //   zscore: outlier if |z| > s.threshold (default 3)
    // s.threshold – Z-score threshold (only used when method="zscore", default 3)
    case "flag_outliers": {
      const method = s.method || "iqr";
      const numVals = rows.map(r => r[s.col])
        .filter(v => typeof v === "number" && isFinite(v))
        .sort((a, b) => a - b);

      let isOutlier;

      if (method === "zscore") {
        const thr = s.threshold ?? 3;
        const mean = numVals.reduce((a, b) => a + b, 0) / (numVals.length || 1);
        const sd   = numVals.length > 1
          ? Math.sqrt(numVals.reduce((s, v) => s + (v - mean) ** 2, 0) / numVals.length)
          : 0;
        isOutlier = v => (typeof v === "number" && isFinite(v) && sd > 0)
          ? Math.abs((v - mean) / sd) > thr
          : false;
      } else {
        // IQR method
        const q1  = numVals[Math.floor(numVals.length * 0.25)] ?? 0;
        const q3  = numVals[Math.floor(numVals.length * 0.75)] ?? 0;
        const iqr = q3 - q1;
        const lo  = q1 - 1.5 * iqr;
        const hi  = q3 + 1.5 * iqr;
        isOutlier = v => (typeof v === "number" && isFinite(v))
          ? v < lo || v > hi
          : false;
      }

      R = rows.map(r => ({ ...r, [s.nn]: isOutlier(r[s.col]) ? 1 : 0 }));
      if (!H.includes(s.nn)) H = [...H, s.nn];
      break;
    }

    // ── extract_regex ─────────────────────────────────────────────────────────
    // Extracts numeric content from dirty strings and coerces to float.
    // Handles: thousands separators (. or ,), decimal comma ("1.200,50" → 1200.50),
    // currency prefixes ("US$ ", "€ ", "R$"), percent suffixes.
    //
    // s.col    – source string column
    // s.nn     – output column name (numeric)
    // s.regex  – (optional) custom capture group regex; default extracts first number
    // s.locale – "dot" (1,200.50 → US) | "comma" (1.200,50 → EU) | "auto" (default)
    case "extract_regex": {
      const locale   = s.locale || "auto";
      const customRx = s.regex ? new RegExp(s.regex) : null;

      // Column-level locale detection (done once, not per-row)
      const colLocale = locale === "auto"
        ? detectNumberLocale(rows.map(r => r[s.col]))
        : locale === "comma" ? "EU" : "US";

      const toFloat = raw => {
        if (raw == null) return null;
        let str = String(raw).trim();
        if (customRx) {
          const m = str.match(customRx);
          if (!m) return null;
          str = m[1] ?? m[0];
        }
        return parseSmartNumber(str, colLocale);
      };

      R = rows.map(r => ({ ...r, [s.nn]: toFloat(r[s.col]) }));
      if (!H.includes(s.nn)) H = [...H, s.nn];
      break;
    }

    // ── clean_strings ────────────────────────────────────────────────────────
    // Normalizes a string column in-place.
    // s.col        — column to clean
    // s.stripPunct — bool (default true): strip trailing . , - –
    // s.normSep    — bool (default false): replace - / , separators with space
    // s.midWordSep — bool (default false): remove . - _ and lone spaces between letters
    //                e.g. "Cla.ude" → "Claude", "Cla ude" → "Claude" (single-token only)
    // s.ocrNoise   — bool (default false): fix common OCR/leet char substitutions mid-word.
    //                Patterns consume optional surrounding whitespace so "Fr@ nco" → "Franco".
    //                @ → a, 3 → e, 0 → o, 1 → i, | → l, $ → s, ! → i
    // s.case       — "keep" | "lower" | "upper" | "title" (default "keep")
    case "clean_strings": {
      R = rows.map(r => {
        let v = r[s.col];
        if (typeof v !== "string") return r;
        v = v.trim();
        v = v.replace(/\s+/g, " ");                           // collapse internal spaces
        if (s.ocrNoise) {
          // @ consumes surrounding spaces so "Fr@ nco" → "Franco"
          v = v.replace(/(?<=[a-zA-Z])\s*@\s*(?=[a-zA-Z])/g, "a");
          // 3+ with lookbehind only: handles word-final (Claud3→Claude) and runs (D33ps33k→Deepseek)
          v = v.replace(/(?<=[a-zA-Z])3+/g, m => "e".repeat(m.length));
          v = v.replace(/(?<=[a-zA-Z])0+/g, m => "o".repeat(m.length));
          v = v.replace(/(?<=[a-zA-Z])1+/g, m => "i".repeat(m.length));
          v = v.replace(/(?<=[a-zA-Z])\|+/g, m => "l".repeat(m.length));
          v = v.replace(/(?<=[a-zA-Z])\$+/g, m => "s".repeat(m.length));
          v = v.replace(/(?<=[a-zA-Z])!+/g, m => "i".repeat(m.length));
        }
        if (s.midWordSep) {
          // Remove . - _ between letters: "Cla.ude" → "Claude"
          v = v.replace(/(?<=[a-zA-Z])[.\-_]+(?=[a-zA-Z])/g, "");
          // Collapse spaces between letters only when there is exactly one space
          // (i.e. the value looks like a single broken token, not "New York")
          v = v.replace(/(?<=[a-zA-Z]) (?=[a-zA-Z])/g, (_, offset, str) => {
            const spaceCount = (str.match(/ /g) || []).length;
            return spaceCount === 1 ? "" : " ";
          });
        }
        if (s.normSep)              v = v.replace(/\s*[-–,]\s*/g, " ").trim();
        if (s.stripPunct !== false) v = v.replace(/[.,\-–]+$/, "").trim();
        const cs = s.case || "keep";
        if      (cs === "lower") v = v.toLowerCase();
        else if (cs === "upper") v = v.toUpperCase();
        else if (cs === "title") v = v.replace(/\w\S*/g, w =>
          w[0].toUpperCase() + w.slice(1).toLowerCase());
        return { ...r, [s.col]: v };
      });
      break;
    }

    // ── pivot_longer ──────────────────────────────────────────────────────────
    // Wide → Long reshape. Two modes:
    //
    // MODE A — Simple (one group of columns → key/value pair):
    //   s.mode     – "simple" (default)
    //   s.cols     – string[] of column names to pivot
    //   s.namesTo  – name for the new key column  (e.g. "year")
    //   s.valuesTo – name for the new value column (e.g. "gdp")
    //   s.idCols   – columns to keep as-is (default: all non-pivot cols)
    //   s.namesSep – (optional) separator to split col name → extract key value
    //                e.g. sep="_" on "income_2019" → key="2019", value=income
    //   s.namesPrefix – (optional) prefix to strip from col name before storing as key
    //                   e.g. prefix="income_" on "income_2019" → key="2019"
    //
    // MODE B — Multi-variable (.value semantics, equiv to R names_to=c(".value","year")):
    //   s.mode     – "multi"
    //   s.groups   – [{ prefix, colName }]  e.g. [{prefix:"income_",colName:"income"},
    //                                              {prefix:"hours_", colName:"hours"}]
    //   s.keySep   – separator between prefix and key value (e.g. "_")
    //   s.keyName  – name for the extracted key column (e.g. "year")
    //   s.idCols   – columns to keep as-is
    //
    // Result: one row per (original row × unique key value).
    // With mode="multi" and groups=[income_,hours_], key="year":
    //   income_2019, income_2020, hours_2019, hours_2020
    //   → rows with year=2019: income=..., hours=...
    //      rows with year=2020: income=..., hours=...
    case "pivot_longer": {
      const mode = s.mode || "simple";

      if (mode === "multi") {
        // ── Multi-variable pivot (.value semantics) ───────────────────────────
        const groups  = s.groups  || [];   // [{prefix, colName}]
        const keySep  = s.keySep  || "_";
        const keyName = s.keyName || "year";
        const allPivotCols = new Set(
          groups.flatMap(g => H.filter(h => h.startsWith(g.prefix)))
        );
        const idCols = s.idCols || H.filter(h => !allPivotCols.has(h));

        // Collect all unique key values across all groups
        const keyValues = new Set();
        groups.forEach(({ prefix }) => {
          H.filter(h => h.startsWith(prefix)).forEach(h => {
            keyValues.add(h.slice(prefix.length));
          });
        });

        const outRows = [];
        rows.forEach(r => {
          for (const kv of keyValues) {
            const newRow = {};
            idCols.forEach(id => { newRow[id] = r[id] ?? null; });
            newRow[keyName] = kv;
            groups.forEach(({ prefix, colName }) => {
              newRow[colName] = r[`${prefix}${kv}`] ?? null;
            });
            outRows.push(newRow);
          }
        });

        const valueColNames = groups.map(g => g.colName);
        R = outRows;
        H = [...new Set([...idCols, keyName, ...valueColNames])];

      } else {
        // ── Simple pivot (original behaviour + optional name extraction) ──────
        const pivotCols   = s.cols || [];
        const namesTo     = s.namesTo    || "name";
        const valuesTo    = s.valuesTo   || "value";
        const namesSep    = s.namesSep   || null;   // e.g. "_" → split on last "_"
        const namesPrefix = s.namesPrefix || null;  // e.g. "income_" → strip prefix
        const idCols      = s.idCols || H.filter(h => !pivotCols.includes(h));

        // Extract the key value from a column name
        const extractKey = col => {
          if (namesPrefix && col.startsWith(namesPrefix))
            return col.slice(namesPrefix.length);
          if (namesSep) {
            const idx = col.lastIndexOf(namesSep);
            if (idx >= 0) return col.slice(idx + namesSep.length);
          }
          return col; // fallback: use full column name
        };

        const outRows = [];
        rows.forEach(r => {
          pivotCols.forEach(col => {
            const newRow = {};
            idCols.forEach(id => { newRow[id] = r[id] ?? null; });
            newRow[namesTo]  = extractKey(col);
            newRow[valuesTo] = r[col] ?? null;
            outRows.push(newRow);
          });
        });

        R = outRows;
        H = [...new Set([...idCols, namesTo, valuesTo])];
      }
      break;
    }

    // pivot_wider
    // Long -> Wide reshape. Mirrors tidyr::pivot_wider() for one value per
    // id/name cell; duplicate id/name pairs keep the later row's value.
    //
    // Inline equivalence check:
    // rows = [{id:1, year:"2020", value:10}, {id:1, year:"2021", value:12}, {id:2, year:"2020", value:8}]
    // pivot_wider(idCols:["id"], namesFrom:"year", valuesFrom:"value", valuesFill:0)
    // => [{id:1, 2020:10, 2021:12}, {id:2, 2020:8, 2021:0}]
    case "pivot_wider": {
      const valuesFrom = Array.isArray(s.valuesFrom)
        ? s.valuesFrom.filter(Boolean)
        : [s.valuesFrom].filter(Boolean);
      const namesFrom = s.namesFrom;
      if (!namesFrom || !valuesFrom.length) break;

      const idCols = Array.isArray(s.idCols) ? s.idCols : [];
      const namesPrefix = s.namesPrefix || "";
      const fill = s.valuesFill ?? null;
      const nameValues = [...new Set(rows.map(r => r[namesFrom]).filter(v => v !== null && v !== undefined && v !== ""))];
      const multiValue = valuesFrom.length > 1;
      const wideCol = (nameVal, valueCol) => {
        const base = `${namesPrefix}${String(nameVal)}`;
        return multiValue ? `${base}_${valueCol}` : base;
      };

      const outById = new Map();
      rows.forEach(r => {
        const idKey = JSON.stringify(idCols.map(id => r[id] ?? null));
        if (!outById.has(idKey)) {
          const out = {};
          idCols.forEach(id => { out[id] = r[id] ?? null; });
          nameValues.forEach(nv => valuesFrom.forEach(vf => { out[wideCol(nv, vf)] = fill; }));
          outById.set(idKey, out);
        }
        const nameVal = r[namesFrom];
        if (nameVal === null || nameVal === undefined || nameVal === "") return;
        const out = outById.get(idKey);
        valuesFrom.forEach(vf => { out[wideCol(nameVal, vf)] = r[vf] ?? fill; });
      });

      const valueColNames = nameValues.flatMap(nv => valuesFrom.map(vf => wideCol(nv, vf)));
      R = [...outById.values()];
      H = [...new Set([...idCols, ...valueColNames])];
      break;
    }

    // ── factor_interactions ──────────────────────────────────────────────────
    // Generates the full set of continuous × factor interactions:
    // for each dummy column in dummyCols, creates contCol × dummy → new column.
    // Equivalent to R: model.matrix(~ cont_var * factor_var - 1).
    //
    // s.contCol   – continuous numeric column
    // s.dummyCols – string[] of binary (0/1) columns (usually output of "dummy" step)
    // s.prefix    – (optional) prefix for output columns; default "<contCol>_x_"
    case "factor_interactions": {
      const prefix    = s.prefix || `${s.contCol}_x_`;
      const dummyCols = s.dummyCols || [];

      dummyCols.forEach(dc => {
        const outCol = `${prefix}${dc}`;
        R = R.map(r => {
          const cont  = r[s.contCol];
          const dummy = r[dc];
          const val   = (typeof cont === "number" && isFinite(cont) &&
                         typeof dummy === "number")
            ? cont * dummy
            : null;
          return { ...r, [outCol]: val };
        });
        if (!H.includes(outCol)) H = [...H, outCol];
      });
      break;
    }

    // ── patch ─────────────────────────────────────────────────────────────────
    // Direct cell edit created by the Data Viewer cell editor.
    // Tagged internal:true so History.jsx groups all patches into a collapsible
    // "Cell edits" section rather than listing them individually.
    //
    // s.ri    — __ri value identifying the target row (stable original index,
    //           assigned at load time; survives filter/sort/rename/feature steps
    //           but NOT pivot_longer / group_summarize which reshape row count)
    // s.col   — column name to overwrite
    // s.value — new value (number | string | null)
    case "geocode": {
      const latCol = s.latCol || "lat";
      const lonCol = s.lonCol || "lon";
      R = geocodeRowsFromCache(rows, s);
      if (!H.includes(latCol)) H = [...H, latCol];
      if (!H.includes(lonCol)) H = [...H, lonCol];
      break;
    }

    case "balance_panel": {
      const entityCol = s.entityCol;
      const timeCol = s.timeCol;
      const slotCol = s.slotCol || "";
      const outcomeCols = s.outcomeCols || [];
      const staticCols = s.staticCols || [];
      const fillValue = s.fillValue ?? 0;
      if (!entityCol || !timeCol) break;

      const uniq = col => [...new Set(rows.map(r => r[col]).filter(v => v !== null && v !== undefined && v !== ""))];
      const entities = s.entities?.length ? s.entities : uniq(entityCol);
      const times = s.times?.length ? s.times : uniq(timeCol).sort();
      const slots = slotCol ? (s.slots?.length ? s.slots : uniq(slotCol).sort()) : [null];

      const keyOf = (e, t, sl) => `${String(e)}\u0001${String(t)}\u0001${slotCol ? String(sl) : ""}`;
      const rowByKey = new Map();
      rows.forEach(r => {
        const k = keyOf(r[entityCol], r[timeCol], slotCol ? r[slotCol] : null);
        if (!rowByKey.has(k)) rowByKey.set(k, r);
      });

      const staticByEntity = new Map();
      rows.forEach(r => {
        const e = r[entityCol];
        if (e === null || e === undefined || staticByEntity.has(e)) return;
        const vals = {};
        staticCols.forEach(c => { vals[c] = r[c] ?? null; });
        staticByEntity.set(e, vals);
      });

      const out = [];
      entities.forEach(e => {
        times.forEach(t => {
          slots.forEach(sl => {
            const match = rowByKey.get(keyOf(e, t, sl));
            const row = {
              [entityCol]: e,
              [timeCol]: t,
              ...(slotCol ? { [slotCol]: sl } : {}),
              ...(staticByEntity.get(e) || {}),
            };
            outcomeCols.forEach(c => {
              const v = match?.[c];
              row[c] = v === null || v === undefined || v === "" ? fillValue : v;
            });
            out.push(row);
          });
        });
      });
      R = out;
      H = [...new Set([entityCol, timeCol, ...(slotCol ? [slotCol] : []), ...staticCols, ...outcomeCols])];
      break;
    }

    case "patch":
      // Guard: s.ri must be a defined number — prevents a stale step with ri:undefined
      // from matching every row (undefined === undefined is true for all rows).
      R = s.ri != null
        ? rows.map(r => r.__ri === s.ri ? { ...r, [s.col]: s.value } : r)
        : rows;
      break;

    // ── inject_column ──────────────────────────────────────────────────────────
    // Splices a pre-computed dense column (model fitted values, residuals,
    // first-stage fitted values, SC gap, etc.) extracted from an estimation
    // result back into the dataset. s.values is a plain array aligned to the
    // current pipeline row order at extraction time. If the row count has
    // changed since extraction (pipeline mutated upstream), the step no-ops with
    // a warning rather than corrupting the dataset.
    case "inject_column": {
      const { colName, values } = s;
      if (colName) {
        if (Array.isArray(values) && values.length === rows.length) {
          R = rows.map((r, i) => ({ ...r, [colName]: values[i] }));
          H = H.includes(colName) ? H : [...H, colName];
        } else {
          console.warn(
            `inject_column "${colName}": length mismatch ` +
            `(stored=${values?.length}, current=${rows.length}) — step skipped. ` +
            `Re-extract this column after any pipeline changes.`
          );
        }
      }
      break;
    }

  }
  return { rows: R, headers: H };
}

// ─── RUN PIPELINE ─────────────────────────────────────────────────────────────
export function runPipeline(rows, headers, pipeline, context = {}) {
  let s = { rows, headers };
  for (const step of pipeline) s = applyStep(s.rows, s.headers, step, context);
  return s;
}

/**
 * Async variant: mutate and ai_tr steps run in the expression Worker (isolated
 * from localStorage / indexedDB). All other steps run synchronously via applyStep.
 * Use when the pipeline contains at least one mutate or ai_tr step.
 */
export async function runPipelineAsync(rows, headers, pipeline, context = {}) {
  const { evalColumn, evalFilter } = await import("../services/exprEvalService.js");
  let s = { rows, headers };
  for (const step of pipeline) {
    const isWorkerStep =
      step.type === "mutate" || step.type === "ai_tr" ||
      step.type === "if_else" || step.type === "case_when" ||
      (step.type === "filter" && step.expr);

    if (!isWorkerStep) {
      s = applyStep(s.rows, s.headers, step, context);
      continue;
    }

    try {
      if (step.type === "filter" && step.expr) {
        const { mask } = await evalFilter(step.expr, s.rows);
        s = { rows: s.rows.filter((_, i) => mask[i]), headers: s.headers };
      } else {
        const { newColValues } = await evalColumn(step, s.rows);
        const outCol = step.type === "ai_tr" ? step.col : (step.nn ?? step.col);
        const newRows = s.rows.map((r, i) => ({ ...r, [outCol]: newColValues[i] ?? null }));
        const newHeaders = s.headers.includes(outCol) ? s.headers : [...s.headers, outCol];
        s = { rows: newRows, headers: newHeaders };
      }
    } catch (e) {
      console.warn("[runPipelineAsync] worker eval failed, falling back to sync:", e.message);
      s = applyStep(s.rows, s.headers, step, context);
    }
  }
  return s;
}
