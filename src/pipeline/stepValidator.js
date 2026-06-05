// ─── ECON STUDIO · pipeline/stepValidator.js ─────────────────────────────────
// Validates AI-emitted pipeline steps against STEP_REGISTRY before they are
// previewed/applied. Pure JS, no React. Threads the header set forward so a
// step that creates a new column makes it available to later steps.
import { STEP_REGISTRY } from "./registry.js";
import { isSafeExpr } from "./exprGuard.js";

const REG_BY_TYPE = Object.fromEntries(STEP_REGISTRY.map(s => [s.type, s]));

function coarseOk(field, value) {
  switch (field.type) {
    case "col":    return typeof value === "string" && value.length > 0;
    case "cols":   return Array.isArray(value) && value.every(v => typeof v === "string");
    case "number": return typeof value === "number" && isFinite(value);
    case "text":   return typeof value === "string";
    case "select":
      return !field.options || field.options.some(o => o.value === value);
    default:       return true; // map/aggs/parts/boolean — accept, runner guards
  }
}

// Keys that are optional even if present in the schema (have sensible runner defaults).
const OPTIONAL_KEYS = new Set(["suffix", "regex", "locale", "namesPrefix", "valuesFill", "keep"]);

export function validateAISteps(steps, headers, { allowedCategories = ["cleaning", "features"] } = {}) {
  const valid = [];
  const rejected = [];
  let H = Array.isArray(headers) ? headers.slice() : [];

  for (const step of Array.isArray(steps) ? steps : []) {
    const reg = REG_BY_TYPE[step?.type];
    if (!reg) { rejected.push({ step, reason: `unknown step type "${step?.type}"` }); continue; }
    if (!allowedCategories.includes(reg.category)) {
      rejected.push({ step, reason: `type "${step.type}" is category "${reg.category}", not allowed` });
      continue;
    }

    // schema key presence + coarse type
    let bad = null;
    for (const field of reg.schema || []) {
      const v = step[field.key];
      if (v === undefined || v === null || v === "") {
        if (OPTIONAL_KEYS.has(field.key)) continue;
        bad = `missing required key "${field.key}"`; break;
      }
      if (!coarseOk(field, v)) { bad = `key "${field.key}" has wrong type`; break; }
    }
    if (bad) { rejected.push({ step, reason: bad }); continue; }

    // column references must exist in the running header set
    const refs = [];
    for (const field of reg.schema || []) {
      if (field.type === "col" && step[field.key]) refs.push(step[field.key]);
      if (field.type === "cols" && Array.isArray(step[field.key])) refs.push(...step[field.key]);
    }
    const missingCol = refs.find(c => !H.includes(c));
    if (missingCol) { rejected.push({ step, reason: `references unknown column "${missingCol}"` }); continue; }

    // regex must compile
    if (step.regex) {
      try { new RegExp(step.regex); }
      catch { rejected.push({ step, reason: `invalid regex` }); continue; }
    }

    // SECURITY: reject steps carrying a disallowed dynamic expression
    const exprs = [];
    if (typeof step.expr === "string") exprs.push(step.expr);
    if (typeof step.cond === "string") exprs.push(step.cond);
    if (Array.isArray(step.cases)) step.cases.forEach(c => { if (typeof c?.cond === "string") exprs.push(c.cond); });
    if (Array.isArray(step.rules)) step.rules.forEach(r => { if (typeof r?.expr === "string") exprs.push(r.expr); });
    if (exprs.some(e => !isSafeExpr(e))) { rejected.push({ step, reason: "unsafe expression (forbidden identifier)" }); continue; }

    // thread new output column forward
    if (typeof step.nn === "string" && step.nn && !H.includes(step.nn)) H = [...H, step.nn];
    valid.push(step);
  }

  return { valid, rejected };
}
