// ─── LITUX · core/validation/logVarDetection.js ─────────────────────────────
// Shared log-transformed-variable name detection, used by both the AI
// narrative (services/AI/AIService.js) and the deterministic per-coefficient
// "Economic Interpretation" panel (components/modeling/resultDisplay.jsx) so
// the two surfaces agree on which variables get elasticity/semi-elasticity
// framing. Pure JS — no React, no API calls.
//
// Covers log_x/ln_x/log(x) (underscore or call form) as well as camelCase and
// suffix conventions (logGDP, lnIncome, gdp_log, gdpLog).

const LOG_NAME_RE         = /^(log_|ln_|log\()/i;
const LOG_CAMEL_PREFIX_RE = /^(log|ln)[A-Z]/;
const LOG_SUFFIX_RE       = /(_log|_ln)$/i;
const LOG_CAMEL_SUFFIX_RE = /[a-z](Log|Ln)$/;

export function isLogVarName(v) {
  if (typeof v !== "string" || !v) return false;
  return LOG_NAME_RE.test(v) || LOG_CAMEL_PREFIX_RE.test(v) ||
         LOG_SUFFIX_RE.test(v) || LOG_CAMEL_SUFFIX_RE.test(v);
}

// Columns produced by a pipeline `log` step, keyed by output column name
// (step.nn) — catches renamed columns that don't match any name pattern.
export function logColsFromPipeline(pipeline) {
  return new Set(
    (pipeline ?? [])
      .filter(s => s?.type === "log" && s?.nn)
      .map(s => s.nn)
  );
}

export function isLogVar(v, logCols = null) {
  return (logCols?.has(v) ?? false) || isLogVarName(v);
}

// Log-log / log-level / level-log / level-level, for framing coefficient text.
export function detectFunctionalForm(yVar = "", xVar = "", logCols = null) {
  const yLog = isLogVar(yVar, logCols);
  const xLog = isLogVar(xVar, logCols);
  if (yLog && xLog)  return "log-log";
  if (yLog && !xLog) return "log-level";
  if (!yLog && xLog) return "level-log";
  return "level-level";
}
