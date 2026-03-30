// ─── ECON STUDIO · services/privacy/index.js ──────────────────────────────────
// Barrel re-export. Consumers import from here, never from sub-files directly.
// This lets us refactor internals without touching import paths elsewhere.
//
// Usage:
//   import { detectPII, filterSampleRows, buildEgressReport } from "../services/privacy";

export { detectPII, isPII, PII_SENSITIVITY }            from "./piiDetector.js";
export { buildPseudoMap, applyPseudoMap,
         suppressColumns, maskStringValue,
         maskNumericValue, generalizeNumeric }           from "./anonymizer.js";
export { filterSampleRows, filterVariableNames,
         buildEgressReport }                             from "./privacyFilter.js";
