// ─── ECON STUDIO · AIService.js ───────────────────────────────────────────────
// Centralised LLM service layer. All Anthropic API calls live here.
//
// PROMPT CACHING:
//   Anthropic caches blocks marked cache_control: {type:"ephemeral"}.
//   SHARED_CONTEXT is the cached block — prepended automatically in callClaude.
//   Header required: "anthropic-beta": "prompt-caching-2024-07-31"
//   Cache TTL: 5 minutes (refreshed on each hit). ~10% of input token cost.
//
// Exports:
//   callClaude({ system, user, maxTokens })  — shared caller (used by utils.js)
//   inferVariableUnits(headers, sampleRows)  → Promise<Record<string,string>>
//   interpretRegression(result, dataDictionary) → Promise<string>

import {
  SHARED_CONTEXT,
  INFER_UNITS_PROMPT,
  INTERPRET_REGRESSION_PROMPT,
} from "./prompts/index.js";

const API_URL = "https://api.anthropic.com/v1/messages";
const MODEL   = "claude-sonnet-4-20250514";
const MAX_TOK = 700;

// ─── MOCK FALLBACKS ───────────────────────────────────────────────────────────
function mockNarrative(core) {
  const { varNames = [], beta = [], pVals = [], R2, n, modelLabel = "OLS", yVar = "y" } = core;
  const regs = varNames
    .filter(v => v !== "(Intercept)")
    .map(v => {
      const i = varNames.indexOf(v);
      const b = beta[i], p = pVals[i];
      if (b == null || !isFinite(b)) return null;
      const dir = b >= 0 ? "positive" : "negative";
      const sig = p != null && p < 0.05 ? "statistically significant" : "not significant at the 5% level";
      return `The coefficient on ${v} is ${b.toFixed(4)} (${sig}), suggesting a ${dir} association with ${yVar}.`;
    })
    .filter(Boolean);

  const p1 = [
    `**[Mock AI Narrative — no API key detected]**`,
    `The ${modelLabel} model on ${yVar} (N=${n ?? "?"}, R²=${R2?.toFixed(4) ?? "N/A"}) yields the following estimates.`,
    ...regs.slice(0, 5),
  ].join(" ");

  const p2 = [
    `From an economic standpoint, the magnitudes should be interpreted with caution pending peer review.`,
    `Model fit (R²=${R2?.toFixed(4) ?? "N/A"}) should be evaluated relative to the literature.`,
    `Verify instrument validity, parallel trends, or OVB as appropriate for this specification.`,
    `Replace this placeholder by configuring a valid Anthropic API key.`,
  ].join(" ");

  return `${p1}\n\n${p2}`;
}

// ─── SHARED CALLER ────────────────────────────────────────────────────────────
// system: string — task-specific prompt (WITHOUT SHARED_CONTEXT — added here).
// The API receives system as an array:
//   [
//     { type:"text", text: SHARED_CONTEXT, cache_control:{type:"ephemeral"} },
//     { type:"text", text: system }
//   ]
// SHARED_CONTEXT is cached; task-specific prompt is not (may vary per call).
// If system is falsy, only SHARED_CONTEXT is sent (still cached).
export async function callClaude({ system, user, maxTokens = MAX_TOK }) {
  const systemArray = [
    {
      type: "text",
      text: SHARED_CONTEXT,
      cache_control: { type: "ephemeral" },
    },
  ];
  if (system) {
    systemArray.push({ type: "text", text: system });
  }

  const body = {
    model:      MODEL,
    max_tokens: maxTokens,
    system:     systemArray,
    messages:   [{ role: "user", content: user }],
  };

  let res;
  try {
    res = await fetch(API_URL, {
      method:  "POST",
      headers: {
        "Content-Type":   "application/json",
        "anthropic-beta": "prompt-caching-2024-07-31",
      },
      body: JSON.stringify(body),
    });
  } catch (networkErr) {
    throw new Error(`Network error: ${networkErr.message ?? "could not reach Anthropic API"}`);
  }

  if (!res.ok) {
    const err = await res.text().catch(() => res.statusText);
    throw new Error(`Anthropic API error ${res.status}: ${err}`);
  }

  const data = await res.json();
  const text = data.content?.find(b => b.type === "text")?.text ?? "";
  if (!text) throw new Error("Empty response from model.");
  return text;
}

// ─── 1. INFER VARIABLE UNITS ─────────────────────────────────────────────────
export async function inferVariableUnits(headers, sampleRows) {
  if (!headers?.length) return {};

  const sample = sampleRows.slice(0, 3);
  const sampleText = [
    headers.join(" | "),
    ...sample.map(r => headers.map(h => {
      const v = r[h];
      return v === null || v === undefined ? "NA" : String(v);
    }).join(" | ")),
  ].join("\n");

  const userPrompt = `Headers and sample data:\n\n${sampleText}\n\nReturn the JSON object now.`;

  const identity = () => { const fb = {}; headers.forEach(h => { fb[h] = h; }); return fb; };

  // Strip SHARED_CONTEXT from the exported prompt (callClaude adds it as cached block)
  const taskPrompt = INFER_UNITS_PROMPT.replace(SHARED_CONTEXT, "").trim();

  let raw;
  try {
    raw = await callClaude({ system: taskPrompt, user: userPrompt, maxTokens: 600 });
  } catch (err) {
    console.warn("[AIService] inferVariableUnits failed:", err.message);
    return identity();
  }

  const cleaned = raw.replace(/```json\s*/gi, "").replace(/```\s*/g, "").trim();
  try {
    const parsed = JSON.parse(cleaned);
    const result = {};
    headers.forEach(h => { result[h] = parsed[h] ?? h; });
    return result;
  } catch {
    return identity();
  }
}

// ─── 2. INTERPRET REGRESSION ─────────────────────────────────────────────────
function detectFunctionalForm(yVar = "", xVars = []) {
  const yLog    = /^(log_|ln_|log\()/i.test(yVar);
  const anyXLog = xVars.some(v => /^(log_|ln_|log\()/i.test(v));
  if (yLog && anyXLog)  return "log-log";
  if (yLog && !anyXLog) return "log-level";
  if (!yLog && anyXLog) return "level-log";
  return "level-level";
}

function buildDictionarySection(dataDictionary) {
  if (!dataDictionary || !Object.keys(dataDictionary).length) return "";
  const lines = Object.entries(dataDictionary)
    .map(([k, v]) => `  ${k}: "${v}"`)
    .join("\n");
  return `\nDATA DICTIONARY (variable → human-readable unit/description):\n${lines}\n`;
}

function buildCoeffLines(result) {
  const { varNames = [], beta = [], se = [], pVals = [] } = result;
  return varNames
    .filter(v => v !== "(Intercept)")
    .map(v => {
      const i = varNames.indexOf(v);
      const b = beta[i], s = se[i], p = pVals[i];
      if (b == null || !isFinite(b) || s == null || !isFinite(s)) {
        return `  ${v}: β=N/A, SE=N/A, 95%CI=[N/A,N/A], p=N/A`;
      }
      const ci_lo = (b - 1.96 * s).toFixed(4);
      const ci_hi = (b + 1.96 * s).toFixed(4);
      const sig = p == null ? "p=N/A"
        : p < 0.01 ? "p<0.01 ***"
        : p < 0.05 ? "p<0.05 **"
        : p < 0.1  ? "p<0.1 *"
        : `p=${p.toFixed(3)} n.s.`;
      return `  ${v}: β=${b.toFixed(4)}, SE=${s.toFixed(4)}, 95%CI=[${ci_lo},${ci_hi}], ${sig}`;
    })
    .join("\n");
}

export async function interpretRegression(result, dataDictionary = null) {
  if (!result) throw new Error("No result object provided.");

  const core = result.second ?? result;
  const {
    varNames = [], beta = [], se = [], pVals = [],
    R2 = null, adjR2 = null, n = null, df = null,
    Fstat = null, Fpval = null,
    att = null, attP = null,
    modelLabel = "OLS", yVar = "y", xVars = [],
  } = core;

  const b0idx = varNames.indexOf("(Intercept)");
  const b0     = b0idx >= 0 ? beta[b0idx] : null;
  const regressors = varNames
    .filter(v => v !== "(Intercept)")
    .map(v => { const i = varNames.indexOf(v); return { v, b: beta[i], s: se[i], p: pVals[i] }; });

  const eqParts = (b0 != null && isFinite(b0)) ? [b0.toFixed(4)] : [];
  regressors.forEach(({ v, b }) => {
    if (b == null || !isFinite(b)) { eqParts.push(`[N/A]·${v}`); return; }
    eqParts.push(`${b >= 0 ? "+ " : "– "}${Math.abs(b).toFixed(4)}·${v}`);
  });

  const fitLines = [
    `R² = ${R2?.toFixed(4) ?? "n/a"}`,
    `Adj. R² = ${adjR2?.toFixed(4) ?? "n/a"}`,
    `N = ${n ?? "?"}`,
    df != null ? `df = ${df}` : null,
    (Fstat != null && isFinite(Fstat))
      ? `F-stat = ${Fstat.toFixed(3)} (p=${Fpval != null ? (Fpval < 0.001 ? "<0.001" : Fpval.toFixed(4)) : "?"})`
      : null,
    (att != null && isFinite(att))
      ? `ATT = ${att.toFixed(4)} (p=${attP != null ? (attP < 0.001 ? "<0.001" : attP.toFixed(4)) : "?"})`
      : null,
  ].filter(Boolean).join(", ");

  const funcForm    = detectFunctionalForm(yVar, xVars.length ? xVars : regressors.map(r => r.v));
  const coeffLines  = buildCoeffLines(core);
  const dictSection = buildDictionarySection(dataDictionary);

  const userPrompt = `\
REGRESSION OUTPUT
Model type: ${modelLabel}
Dependent variable: ${yVar}
Functional form: ${funcForm}
Estimated equation: ${yVar} = ${eqParts.join(" ")}
Fit statistics: ${fitLines}
${dictSection}
Coefficient details:
${coeffLines}

Write the two-paragraph interpretation now.`;

  try {
    const taskPrompt = INTERPRET_REGRESSION_PROMPT.replace(SHARED_CONTEXT, "").trim();
    return await callClaude({ system: taskPrompt, user: userPrompt, maxTokens: MAX_TOK });
  } catch (err) {
    console.warn("[AIService] interpretRegression failed:", err.message);
    return mockNarrative(core);
  }
}
