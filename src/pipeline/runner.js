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
      R = rows.filter(r => {
        const v = r[s.col];
        if (s.op === "notna") return v !== null && v !== undefined;
        const n = parseFloat(s.value);
        if (s.op === "eq")  return String(v) === String(s.value);
        if (s.op === "neq") return String(v) !== String(s.value);
        if (s.op === "gt")  return typeof v === "number" && v > n;
        if (s.op === "lt")  return typeof v === "number" && v < n;
        if (s.op === "gte") return typeof v === "number" && v >= n;
        if (s.op === "lte") return typeof v === "number" && v <= n;
        return true;
      });
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

    case "date_extract": {
      const parseDate = v => {
        if (v == null) return null;
        const d = new Date(String(v).trim());
        return isNaN(d.getTime()) ? null : d;
      };
      s.parts.forEach(part => {
        const nn = s.names[part];
        if (!nn) return;
        R = R.map(r => {
          const d = parseDate(r[s.col]);
          if (!d) return { ...r, [nn]: null };
          if (part === "year")      return { ...r, [nn]: d.getFullYear() };
          if (part === "month")     return { ...r, [nn]: d.getMonth() + 1 };  // 1–12
          if (part === "dow")       return { ...r, [nn]: d.getDay() };         // 0=Sun…6=Sat
          if (part === "isweekend") { const dow = d.getDay(); return { ...r, [nn]: (dow === 0 || dow === 6) ? 1 : 0 }; }
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
