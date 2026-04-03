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

// ─── PATTERN CONSTANTS ────────────────────────────────────────────────────────
export const NA_PAT = /^(na|n\/a|nan|null|none|missing|#n\/a|\.|\s*)$/i;

// ─── APPLY STEP ───────────────────────────────────────────────────────────────
export function applyStep(rows, headers, s, context = {}) {
  let R = rows, H = [...headers];
  switch (s.type) {
    case "rename":
      R = rows.map(r => { const c = {...r}; c[s.newName] = c[s.col]; delete c[s.col]; return c; });
      H = headers.map(h => h === s.col ? s.newName : h);
      break;

    case "drop":
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

      // Detect shape: compound predicate vs legacy flat
      if (s.predicate) {
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
        const fn = new Function("value", "rowIndex", `return (${s.js});`);
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
      // s.aggs:   array of { col, fn, nn }
      //           fn: "mean" | "sum" | "count" | "min" | "max" | "sd" | "median"
      //           nn: output column name
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
        (s.aggs || []).forEach(({ col, fn, nn }) => {
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
      const newCols = rHeaders.filter(h => h !== s.rightKey);
      const rightMap = new Map();
      rRows.forEach(r => { const k = String(r[s.rightKey] ?? ""); if (!rightMap.has(k)) rightMap.set(k, r); });
      const outRows = [];
      rows.forEach(r => {
        const k = String(r[s.leftKey] ?? "");
        const match = rightMap.get(k);
        if (match) {
          const merged = {...r};
          newCols.forEach(h => { const dest = H.includes(h) ? `${h}${s.suffix || "_r"}` : h; merged[dest] = match[h] ?? null; });
          outRows.push(merged);
        } else if (s.how === "left" || !s.how) {
          const merged = {...r};
          newCols.forEach(h => { const dest = H.includes(h) ? `${h}${s.suffix || "_r"}` : h; merged[dest] = null; });
          outRows.push(merged);
        }
      });
      R = outRows;
      newCols.forEach(h => { const dest = H.includes(h) ? `${h}${s.suffix || "_r"}` : h; if (!H.includes(dest)) H = [...H, dest]; });
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
    case "type_cast": {
      // Convert a column to a target type in-place.
      // s.col:    column name
      // s.to:     "number" | "string" | "boolean"
      // Unparseable values → null (never silently corrupt)
      R = rows.map(r => {
        const v = r[s.col];
        if (v === null || v === undefined) return r;
        let out = null;
        if (s.to === "number") {
          const n = Number(v);
          out = isFinite(n) ? n : null;
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

      const toFloat = raw => {
        if (raw == null) return null;
        let str = String(raw).trim();

        if (customRx) {
          const m = str.match(customRx);
          if (!m) return null;
          str = m[1] ?? m[0];
        }

        // Strip non-numeric prefix/suffix (currency symbols, whitespace)
        str = str.replace(/[^\d.,\-+eE]/g, "");
        if (!str) return null;

        // Detect decimal convention
        let det = locale;
        if (det === "auto") {
          // If string ends in ",dd" (1-2 digits after comma) → EU decimal
          det = /,\d{1,2}$/.test(str) ? "comma" : "dot";
        }

        let normalised;
        if (det === "comma") {
          // EU: 1.200,50  → remove dots (thousands), replace comma with dot
          normalised = str.replace(/\./g, "").replace(",", ".");
        } else {
          // US: 1,200.50 → remove commas (thousands)
          normalised = str.replace(/,/g, "");
        }

        const n = parseFloat(normalised);
        return isFinite(n) ? n : null;
      };

      R = rows.map(r => ({ ...r, [s.nn]: toFloat(r[s.col]) }));
      if (!H.includes(s.nn)) H = [...H, s.nn];
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

    // ── factor_interactions ───────────────────────────────────────────────────
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

  }
  return { rows: R, headers: H };
}

// ─── RUN PIPELINE ─────────────────────────────────────────────────────────────
export function runPipeline(rows, headers, pipeline, context = {}) {
  let s = { rows, headers };
  for (const step of pipeline) s = applyStep(s.rows, s.headers, step, context);
  return s;
}
