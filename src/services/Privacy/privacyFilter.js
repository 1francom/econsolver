// ─── ECON STUDIO · services/privacy/privacyFilter.js ─────────────────────────
// Orchestrator: applies PII rules before any data leaves the browser.
// This is the single choke point that AIService.js must go through.
//
// Exports:
//   filterSampleRows(headers, sampleRows, piiConfig)  → { headers, rows, redacted }
//   filterVariableNames(names, piiConfig)             → { names, aliases, hasRedactions }
//   buildEgressReport(redacted, aliases)              → EgressReport (shown to user)
//
// piiConfig shape (comes from PrivacyConfigPanel / piiDetector):
//   Record<string, { sensitivity: string, suppress: boolean, alias?: string }>
//
// Design principle:
//   HIGH   → column suppressed entirely from sample rows; name replaced with alias in prompt
//   MEDIUM → column name replaced with alias; numeric values rounded; strings masked
//   LOW    → column name kept; no value modification
//   NONE   → passthrough

import { PII_SENSITIVITY, isPII } from "./piiDetector.js";
import { suppressColumns, buildPseudoMap, applyPseudoMap, maskStringValue } from "./anonymizer.js";

// ─── SAMPLE ROW FILTER ────────────────────────────────────────────────────────
/**
 * Clean sample rows before sending to inferVariableUnits.
 *
 * @param {string[]}             headers
 * @param {Record<string,any>[]} sampleRows    — typically 3 rows
 * @param {Record<string,{sensitivity:string, alias?:string}>} piiConfig
 * @returns {{ headers: string[], rows: Record<string,any>[], redacted: RedactedCol[] }}
 */
export function filterSampleRows(headers, sampleRows, piiConfig = {}) {
  const redacted = [];

  // Separate columns by action required
  const toSuppress = [];
  const toAlias    = [];  // medium: rename col, round/mask values

  for (const col of headers) {
    const cfg = piiConfig[col] ?? {};
    const sensitivity = cfg.sensitivity ?? PII_SENSITIVITY.NONE;

    if (sensitivity === PII_SENSITIVITY.HIGH || cfg.suppress === true) {
      toSuppress.push(col);
      redacted.push({ col, action: "suppressed", alias: null });
    } else if (sensitivity === PII_SENSITIVITY.MEDIUM) {
      toAlias.push({ col, alias: cfg.alias ?? _autoAlias(col, toAlias.length) });
      redacted.push({ col, action: "aliased", alias: cfg.alias ?? _autoAlias(col, toAlias.length - 1) });
    }
    // LOW and NONE: passthrough
  }

  // 1. Suppress HIGH columns
  let { rows, headers: cleanHeaders } = suppressColumns(sampleRows, headers, toSuppress);

  // 2. Alias MEDIUM columns (rename key + sanitize values)
  for (const { col, alias } of toAlias) {
    if (!cleanHeaders.includes(col)) continue;

    // Rename header
    cleanHeaders = cleanHeaders.map(h => h === col ? alias : h);

    // Sanitize values: round numbers, mask strings
    rows = rows.map(r => {
      const val = r[col];
      let sanitized;
      if (val == null) {
        sanitized = null;
      } else if (typeof val === "number") {
        // Round to 2 significant figures to reduce re-identification
        sanitized = _roundSigFigs(val, 2);
      } else {
        sanitized = maskStringValue(val);
      }
      const nr = { ...r };
      delete nr[col];
      nr[alias] = sanitized;
      return nr;
    });
  }

  return { headers: cleanHeaders, rows, redacted };
}

// ─── VARIABLE NAME FILTER ─────────────────────────────────────────────────────
/**
 * Replace PII column names with aliases in regression output before prompt assembly.
 * Used by promptBuilder when variable names appear in coefficient tables.
 *
 * @param {string[]} names             — varNames array from model result
 * @param {Record<string,any>} piiConfig
 * @returns {{ names: string[], aliasMap: Record<string,string>, hasRedactions: boolean }}
 */
export function filterVariableNames(names, piiConfig = {}) {
  const aliasMap = {};
  let hasRedactions = false;

  const filtered = names.map((name, i) => {
    if (name === "(Intercept)") return name;

    const cfg = piiConfig[name] ?? {};
    const sensitivity = cfg.sensitivity ?? PII_SENSITIVITY.NONE;

    if (!isPII(sensitivity)) return name;

    const alias = cfg.alias ?? _autoAlias(name, i);
    aliasMap[name] = alias;
    hasRedactions = true;
    return alias;
  });

  return { names: filtered, aliasMap, hasRedactions };
}

// ─── EGRESS REPORT ────────────────────────────────────────────────────────────
/**
 * Build a human-readable report of what will/won't be sent.
 * Shown in PrivacyConfigPanel before the user confirms API call.
 *
 * @returns {EgressReport}
 *   { safe: string[], suppressed: string[], aliased: {original, alias}[], summary: string }
 */
export function buildEgressReport(headers, piiConfig = {}) {
  const safe       = [];
  const suppressed = [];
  const aliased    = [];

  for (const col of headers) {
    const cfg = piiConfig[col] ?? {};
    const s   = cfg.sensitivity ?? PII_SENSITIVITY.NONE;

    if (s === PII_SENSITIVITY.HIGH || cfg.suppress === true) {
      suppressed.push(col);
    } else if (s === PII_SENSITIVITY.MEDIUM) {
      aliased.push({ original: col, alias: cfg.alias ?? _autoAlias(col, aliased.length) });
    } else {
      safe.push(col);
    }
  }

  const parts = [];
  if (safe.length)       parts.push(`${safe.length} column${safe.length !== 1 ? "s" : ""} sent as-is`);
  if (aliased.length)    parts.push(`${aliased.length} aliased`);
  if (suppressed.length) parts.push(`${suppressed.length} suppressed`);

  return {
    safe,
    suppressed,
    aliased,
    summary: parts.join(" · "),
  };
}

// ─── HELPERS ──────────────────────────────────────────────────────────────────
function _autoAlias(col, index) {
  // Derive a stable, readable alias: "salary" → "var_salary" to be obvious in the prompt
  return `var_${col.toLowerCase().replace(/[^a-z0-9]/g, "_")}`;
}

function _roundSigFigs(value, sigFigs) {
  if (!isFinite(value) || value === 0) return value;
  const factor = Math.pow(10, sigFigs - Math.floor(Math.log10(Math.abs(value))) - 1);
  return Math.round(value * factor) / factor;
}
