// ─── ECON STUDIO · services/privacy/piiDetector.js ───────────────────────────
// Automatic PII detection for dataset columns.
// Works entirely locally — no network calls.
//
// Exports:
//   detectPII(headers, sampleRows)  → Record<string, PIIResult>
//   PII_SENSITIVITY                 → enum-like constant object
//
// PIIResult shape:
//   { sensitivity: "high"|"medium"|"low"|"none", reasons: string[], autoDetected: true }
//
// Consumers: privacyFilter.js, PrivacyConfigPanel.jsx

export const PII_SENSITIVITY = Object.freeze({
  HIGH:   "high",    // direct identifiers — must suppress or pseudonymize before egress
  MEDIUM: "medium",  // quasi-identifiers — suppress names before egress, values ok
  LOW:    "low",     // potentially sensitive but context-dependent
  NONE:   "none",    // safe to send as-is
});

// ─── NAME PATTERN RULES ───────────────────────────────────────────────────────
// Each rule: { pattern: RegExp, sensitivity, reason }
// Matched against the lowercased column name.

const NAME_RULES = [
  // Direct identifiers
  { pattern: /\b(ssn|social.?security|national.?id|passport|tax.?id|nif|cpf|rg|dni)\b/,    sensitivity: PII_SENSITIVITY.HIGH,   reason: "National/tax identifier" },
  { pattern: /\b(email|e.?mail|correo)\b/,                                                   sensitivity: PII_SENSITIVITY.HIGH,   reason: "Email address" },
  { pattern: /\b(phone|telefon|tel|mobile|cel|handy)\b/,                                     sensitivity: PII_SENSITIVITY.HIGH,   reason: "Phone number" },
  { pattern: /\b(name|nombre|nachname|vorname|surname|firstname|lastname|fullname)\b/,        sensitivity: PII_SENSITIVITY.HIGH,   reason: "Person name" },
  { pattern: /\b(address|adresse|street|calle|straße|zip|postcode|plz|postal)\b/,             sensitivity: PII_SENSITIVITY.HIGH,   reason: "Physical address" },
  { pattern: /\b(ip.?addr|ipv[46]|mac.?addr)\b/,                                             sensitivity: PII_SENSITIVITY.HIGH,   reason: "Network identifier" },
  { pattern: /\b(iban|bic|account.?num|routing|credit.?card|card.?num)\b/,                   sensitivity: PII_SENSITIVITY.HIGH,   reason: "Financial account identifier" },
  { pattern: /\b(patient.?id|person.?id|individual.?id|respondent.?id|subject.?id)\b/,       sensitivity: PII_SENSITIVITY.HIGH,   reason: "Individual identifier" },

  // Quasi-identifiers — high re-identification risk when combined
  { pattern: /\b(lat|latitude|lon|longitude|coord|gps|geo)\b/,                               sensitivity: PII_SENSITIVITY.MEDIUM, reason: "Geographic coordinates" },
  { pattern: /\b(birth|birthdate|dob|date.?of.?birth|geburt|geburtstag)\b/,                  sensitivity: PII_SENSITIVITY.MEDIUM, reason: "Date of birth" },
  { pattern: /\b(gender|sex|geschlecht)\b/,                                                   sensitivity: PII_SENSITIVITY.MEDIUM, reason: "Gender" },
  { pattern: /\b(race|ethnicity|religion|nationalit|citizenship|herkunft)\b/,                 sensitivity: PII_SENSITIVITY.MEDIUM, reason: "Sensitive demographic" },
  { pattern: /\b(salary|income|wage|earning|lohn|gehalt|renda|ingreso)\b/,                    sensitivity: PII_SENSITIVITY.MEDIUM, reason: "Income/salary" },
  { pattern: /\b(health|diagnos|disease|illness|kranken|icd|medical)\b/,                     sensitivity: PII_SENSITIVITY.MEDIUM, reason: "Health information" },
  { pattern: /\b(political|union|party|parteimitglied|religion|glaube)\b/,                   sensitivity: PII_SENSITIVITY.MEDIUM, reason: "Political/religious affiliation" },

  // Low sensitivity — context-dependent
  { pattern: /\b(age|alter|edad|jahrgang|birth.?year|ano.?nasc)\b/,                          sensitivity: PII_SENSITIVITY.LOW,    reason: "Age (aggregated)" },
  { pattern: /\b(region|district|bezirk|comarca|municipio|gemeinde)\b/,                      sensitivity: PII_SENSITIVITY.LOW,    reason: "Sub-national geography" },
  { pattern: /\b(firm.?id|company.?id|employer.?id|establishment)\b/,                        sensitivity: PII_SENSITIVITY.LOW,    reason: "Firm identifier" },
];

// ─── VALUE PATTERN RULES ──────────────────────────────────────────────────────
// Applied to string values in sample rows when column name doesn't match.

const VALUE_PATTERNS = [
  { pattern: /^[\w.+-]+@[\w-]+\.[\w.]{2,}$/,                                     sensitivity: PII_SENSITIVITY.HIGH,   reason: "Email address (value pattern)" },
  { pattern: /^\+?[\d\s\-().]{7,15}$/,                                            sensitivity: PII_SENSITIVITY.HIGH,   reason: "Phone number (value pattern)" },
  { pattern: /^[A-Z]{2}\d{2}[\dA-Z]{10,30}$/,                                    sensitivity: PII_SENSITIVITY.HIGH,   reason: "IBAN (value pattern)" },
  { pattern: /^\d{3}-\d{2}-\d{4}$/,                                               sensitivity: PII_SENSITIVITY.HIGH,   reason: "SSN (value pattern)" },
  { pattern: /^-?\d{1,3}\.\d{4,}$/,                                               sensitivity: PII_SENSITIVITY.MEDIUM, reason: "High-precision coordinate (value pattern)" },
];

// ─── SENSITIVITY ORDERING ─────────────────────────────────────────────────────
const RANK = { high: 3, medium: 2, low: 1, none: 0 };
function maxSensitivity(a, b) {
  return RANK[a] >= RANK[b] ? a : b;
}

// ─── CORE FUNCTION ────────────────────────────────────────────────────────────
/**
 * Analyze all columns and return a PII assessment for each.
 *
 * @param {string[]} headers
 * @param {Record<string,any>[]} sampleRows  — up to 10 rows is enough
 * @returns {Record<string, { sensitivity: string, reasons: string[], autoDetected: true }>}
 */
export function detectPII(headers, sampleRows = []) {
  const result = {};

  for (const col of headers) {
    const colLower = col.toLowerCase();
    let sensitivity = PII_SENSITIVITY.NONE;
    const reasons = [];

    // 1. Name-based rules
    for (const rule of NAME_RULES) {
      if (rule.pattern.test(colLower)) {
        sensitivity = maxSensitivity(sensitivity, rule.sensitivity);
        reasons.push(rule.reason);
        break; // first match wins — avoid duplicate reasons for same column
      }
    }

    // 2. Value-based rules (only if not already HIGH from name)
    if (sensitivity !== PII_SENSITIVITY.HIGH && sampleRows.length > 0) {
      const values = sampleRows
        .map(r => r[col])
        .filter(v => v != null && typeof v === "string" && v.length > 0);

      for (const val of values) {
        for (const rule of VALUE_PATTERNS) {
          if (rule.pattern.test(val.trim())) {
            sensitivity = maxSensitivity(sensitivity, rule.sensitivity);
            if (!reasons.includes(rule.reason)) reasons.push(rule.reason);
            break;
          }
        }
      }
    }

    result[col] = { sensitivity, reasons, autoDetected: true };
  }

  return result;
}

/**
 * Returns true if the column should be treated as PII before API egress.
 * "medium" and above are considered PII by default.
 * Callers can override the threshold.
 *
 * @param {string} sensitivity
 * @param {"high"|"medium"|"low"} threshold  default "medium"
 */
export function isPII(sensitivity, threshold = PII_SENSITIVITY.MEDIUM) {
  return RANK[sensitivity] >= RANK[threshold];
}
