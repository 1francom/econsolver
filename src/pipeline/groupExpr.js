// ─── ECON STUDIO · pipeline/groupExpr.js ────────────────────────────────────
// Makes R's aggregate-over-a-row-expression idiom work in `grouped_mutate`'s
// expression mode:
//
//   mutate(treat = any(trarrprop != 0 & year == 2015))
//
// Why it needed anything at all: the evaluator injects each column as an ARRAY
// over the group, which is right for `mean(wage)` but wrong the moment the
// argument is an expression. R vectorises `trarrprop != 0` elementwise; JS does
// not, so `[0,5] != 0` coerces the array to a string and compares that. The
// result was `any(false)` → 0 for every group — a silently wrong answer, not an
// error (feedback 2026-07-31, filed twice: once as a feature, once as a bug).
//
// JS cannot overload `!=` or `&`, so the fix is a source transform: pull each
// aggregate call's argument out, compile it as a ROW-level function (columns
// injected as scalars), map it over the group to build the vector R would have
// built, reduce that, and substitute the resulting scalar back into the outer
// expression.
//
// Note that `&` and `|` need no rewriting once the argument is row-level: on
// booleans JS's bitwise operators return 1/0, which is truthy-equivalent to R's
// elementwise `&`/`|` for this purpose.

export const AGG_FNS = ["any", "all", "sum", "mean", "min", "max", "count", "first", "last"];

const IDENT_START = /[A-Za-z_$]/;
const IDENT_CHAR  = /[A-Za-z0-9_$]/;

/** Index of the `)` matching the `(` at `open`, or -1. Skips string literals. */
function matchParen(src, open) {
  let depth = 0;
  for (let i = open; i < src.length; i++) {
    const c = src[i];
    if (c === '"' || c === "'" || c === "`") {
      const q = c;
      i++;
      while (i < src.length) {
        if (src[i] === "\\") { i += 2; continue; }
        if (src[i] === q) break;
        i++;
      }
      continue;
    }
    if (c === "(") depth++;
    else if (c === ")") { depth--; if (depth === 0) return i; }
  }
  return -1;
}

/**
 * Replace every aggregate call with a placeholder identifier.
 *
 * Calls come back in DEPENDENCY order — inner before outer — so evaluating them
 * in array order always has what it needs. That is what makes a nested form
 * like `any(x > mean(x))` mean what R means: `mean(x)` is a group scalar, and
 * the comparison around it is row-level.
 *
 * @returns {{ source: string, calls: {name:string, inner:string, placeholder:string}[] }}
 */
export function extractAggregateCalls(expr, counter = { n: 0 }) {
  const src = String(expr ?? "");
  const calls = [];
  let out = "";
  let i = 0;

  while (i < src.length) {
    const ch = src[i];

    // Copy string literals through untouched — a quoted "any(" is not a call.
    if (ch === '"' || ch === "'" || ch === "`") {
      const q = ch;
      out += ch; i++;
      while (i < src.length) {
        if (src[i] === "\\") { out += src[i] + (src[i + 1] ?? ""); i += 2; continue; }
        out += src[i];
        if (src[i] === q) { i++; break; }
        i++;
      }
      continue;
    }

    if (IDENT_START.test(ch)) {
      let j = i;
      while (j < src.length && IDENT_CHAR.test(src[j])) j++;
      const name = src.slice(i, j);
      let k = j;
      while (k < src.length && /\s/.test(src[k])) k++;
      // `df.any(...)` is a property access, not our aggregate.
      const prev = out.replace(/\s+$/, "").slice(-1);
      if (AGG_FNS.includes(name) && src[k] === "(" && prev !== ".") {
        const close = matchParen(src, k);
        const inner = close > 0 ? src.slice(k + 1, close) : "";
        // `count()` takes no argument — leave it to the plain group helper.
        if (close > 0 && inner.trim() !== "") {
          const nested = extractAggregateCalls(inner, counter);
          calls.push(...nested.calls);
          const placeholder = `__agg${counter.n++}__`;
          calls.push({ name, inner: nested.source, placeholder });
          out += placeholder;
          i = close + 1;
          continue;
        }
      }
      out += name;
      i = j;
      continue;
    }

    out += ch;
    i++;
  }

  return { source: out, calls };
}

// Matches the existing group-helper semantics: the string forms "0"/"false"
// that survive a CSV round-trip count as false, so a 0/1 dummy stored as text
// does not silently make every group TRUE.
const truthy = x => !!x && x !== "0" && x !== "false";
const nums = v => v.filter(x => x !== null && x !== undefined && isFinite(+x)).map(Number);

/** Reduce a per-row vector the way the named aggregate would. */
export function reduceAggregate(name, vec) {
  const v = Array.isArray(vec) ? vec : [vec];
  switch (name) {
    case "any":   return v.some(truthy) ? 1 : 0;
    case "all":   return (v.length > 0 && v.every(truthy)) ? 1 : 0;
    case "count": return v.length;
    case "first": return v[0] ?? null;
    case "last":  return v[v.length - 1] ?? null;
    case "sum":   return nums(v).reduce((a, b) => a + b, 0);
    case "mean": { const a = nums(v); return a.length ? a.reduce((x, y) => x + y, 0) / a.length : null; }
    case "min":  { const a = nums(v); return a.length ? Math.min(...a) : null; }
    case "max":  { const a = nums(v); return a.length ? Math.max(...a) : null; }
    default:     return null;
  }
}
