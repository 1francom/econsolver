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

  }
  return { rows: R, headers: H };
}

// ─── RUN PIPELINE ─────────────────────────────────────────────────────────────
export function runPipeline(rows, headers, pipeline, context = {}) {
  let s = { rows, headers };
  for (const step of pipeline) s = applyStep(s.rows, s.headers, step, context);
  return s;
}
