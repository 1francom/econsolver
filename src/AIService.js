// ─── ECON STUDIO · AIService.js ───────────────────────────────────────────────
// Centralised LLM service layer. All Anthropic API calls live here.
// Exports:
//   inferVariableUnits(headers, sampleRows)  → Promise<Record<string,string>>
//   interpretRegression(result, dataDictionary) → Promise<string>

const API_URL   = "https://api.anthropic.com/v1/messages";
const MODEL     = "claude-sonnet-4-20250514";
const MAX_TOK   = 1000;

// ─── MOCK FALLBACKS ───────────────────────────────────────────────────────────
// Used when the API key is absent or the network call fails (CORS in dev, etc.)
function mockNarrative(core) {
  const { varNames = [], beta = [], pVals = [], R2, n, modelLabel = "OLS", yVar = "y" } = core;
  const regs = varNames
    .filter(v => v !== "(Intercept)")
    .map((v, _) => {
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
async function callClaude({ system, user, maxTokens = MAX_TOK }) {
  const body = {
    model: MODEL,
    max_tokens: maxTokens,
    messages: [{ role: "user", content: user }],
  };
  if (system) body.system = system;

  let res;
  try {
    res = await fetch(API_URL, {
      method:  "POST",
      headers: { "Content-Type": "application/json" },
      body:    JSON.stringify(body),
    });
  } catch (networkErr) {
    // CORS pre-flight failures or offline — surface a clear error
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
// Sends column headers + up to 3 sample rows to the model.
// Returns a plain JS object: { colName: "human-readable description", … }
//
// Example output:
//   { wage: "hourly wage in USD", educ: "years of education",
//     female: "dummy 1=female", country: "country of residence" }

const INFER_SYSTEM = `\
You are a senior econometrician at LMU Munich specialising in dataset curation.
Your job: given column headers and sample values from a CSV, infer a concise,
human-readable description for each variable — the kind you would write in a
paper's "Variable Definitions" table.

STRICT RULES:
1. Return ONLY a valid JSON object. No markdown fences, no preamble, no trailing text.
2. Every header must appear as a key in the JSON.
3. Values must be short strings (≤ 10 words).
4. For binary/dummy columns (values are 0 and 1 only), begin the description with
   "dummy 1=" followed by what 1 represents (e.g. "dummy 1=female", "dummy 1=union member").
5. For counts, include the unit (e.g. "number of schools in grid cell").
6. For monetary values, include the currency if inferable (e.g. "hourly wage in USD").
7. For log-transformed columns (name starts with log_ or ln_), prefix with "log of".
8. For squared columns (name ends with _sq or _2), include "squared" in description.
9. For identifiers (id, entity_id, etc.), write "entity identifier".
10. Use English only.`;

export async function inferVariableUnits(headers, sampleRows) {
  if (!headers?.length) return {};

  // Build a compact sample table (max 3 rows)
  const sample = sampleRows.slice(0, 3);
  const sampleText = [
    headers.join(" | "),
    ...sample.map(r => headers.map(h => {
      const v = r[h];
      return v === null || v === undefined ? "NA" : String(v);
    }).join(" | ")),
  ].join("\n");

  const userPrompt = `Headers and sample data:\n\n${sampleText}\n\nReturn the JSON object now.`;

  const identity = () => {
    const fb = {};
    headers.forEach(h => { fb[h] = h; });
    return fb;
  };

  let raw;
  try {
    raw = await callClaude({ system: INFER_SYSTEM, user: userPrompt, maxTokens: 600 });
  } catch (err) {
    // Network error or missing API key — return identity map silently
    console.warn("[AIService] inferVariableUnits failed:", err.message);
    return identity();
  }

  // Strip accidental markdown fences just in case
  const cleaned = raw.replace(/```json\s*/gi, "").replace(/```\s*/g, "").trim();

  try {
    const parsed = JSON.parse(cleaned);
    // Guarantee every header has an entry (fallback to the header name itself)
    const result = {};
    headers.forEach(h => { result[h] = parsed[h] ?? h; });
    return result;
  } catch {
    return identity();
  }
}

// ─── 2. INTERPRET REGRESSION ─────────────────────────────────────────────────
// Generates a two-paragraph academic narrative for a regression result.
// dataDictionary: Record<string,string>  (may be null/undefined — handled gracefully)
//
// Functional form detection (from yVar / xVar names):
//   log(y) ~ log(x) → log-log → elasticity interpretation
//   log(y) ~ x      → log-level → semi-elasticity (β×100 % change)
//   y ~ log(x)      → level-log → (β/100) unit change per 1% change in x

function detectFunctionalForm(yVar = "", xVars = []) {
  const yLog  = /^(log_|ln_|log\()/i.test(yVar);
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
    .map((v, _) => {
      const i = varNames.indexOf(v);
      const b  = beta[i];
      const s  = se[i];
      const p  = pVals[i];
      if (b == null || !isFinite(b) || s == null || !isFinite(s)) {
        return `  ${v}: β=N/A, SE=N/A, 95%CI=[N/A,N/A], p=N/A`;
      }
      const ci_lo = (b - 1.96 * s).toFixed(4);
      const ci_hi = (b + 1.96 * s).toFixed(4);
      const sig = p == null ? "p=N/A" : p < 0.01 ? "p<0.01 ***" : p < 0.05 ? "p<0.05 **" : p < 0.1 ? "p<0.1 *" : `p=${p.toFixed(3)} n.s.`;
      return `  ${v}: β=${b.toFixed(4)}, SE=${s.toFixed(4)}, 95%CI=[${ci_lo},${ci_hi}], ${sig}`;
    })
    .join("\n");
}

const INTERPRET_SYSTEM = `\
You are a senior econometrician at LMU Munich writing a results section for a
peer-reviewed journal. You receive a regression output and a data dictionary that
maps column names to human-readable descriptions with units.

────────────────────────────────────────────────────────────────────
NATURAL LANGUAGE RULES (MANDATORY — violations will be rejected):
────────────────────────────────────────────────────────────────────
1. NEVER write "a 1 unit increase in [variable]".
   Instead, use the data dictionary to phrase the change naturally:
     • Count variables  → "one additional [unit]" (e.g. "one additional year of education")
     • Continuous vars  → "a one-[unit] increase" (e.g. "a one-percentage-point rise in the
       unemployment rate")
     • Dummy variables  → interpret as a discrete group difference
       (e.g. "union members earn ... more than non-union workers")
     • If the dictionary says "dummy 1=X", phrase it as comparing X vs. non-X.

2. FUNCTIONAL FORM RULES:
     • Log-Log  → interpret β as an elasticity: "a 1% increase in [X] is associated
       with a β% change in [Y]."
     • Log-Level → semi-elasticity: "one additional [unit of X] is associated with a
       β×100 percent change in [Y]."
     • Level-Log → "a 1% increase in [X] is associated with a β/100 change in [Y] [units]."
     • Level-Level → standard marginal effect with natural units from the dictionary.

3. Quote exact β values and p-values. Mention 95% CIs for significant regressors.

4. DUMMIES: Never say "a one-unit increase in female." Say "women earn X more/less than men."

────────────────────────────────────────────────────────────────────
FORMAT RULES (also mandatory):
────────────────────────────────────────────────────────────────────
• Write exactly TWO paragraphs in English. Nothing else — no headers, bullets, markdown.
• Paragraph 1 (4–6 sentences): statistical findings — sign, magnitude, significance of
  each regressor, R², N, which predictors are significant and what CIs imply.
• Paragraph 2 (4–6 sentences): economic plausibility, model reliability — are magnitudes
  sensible? R² in context? Flag unexpected signs, possible OVB, multicollinearity risk
  (large SE relative to β). For DiD: parallel trends. For 2SLS: instrument validity.
• Do NOT start with "This study", "The results", or "In this".
• Do NOT reproduce variable names in ALL-CAPS.
• Paragraphs separated by exactly one blank line.
• English only.`;

export async function interpretRegression(result, dataDictionary = null) {
  if (!result) throw new Error("No result object provided.");

  // Resolve the core result object (2SLS wraps in .second)
  const core = result.second ?? result;
  const {
    varNames = [], beta = [], se = [], pVals = [],
    R2 = null, adjR2 = null, n = null, df = null,
    Fstat = null, Fpval = null,
    att = null, attP = null,
    modelLabel = "OLS", yVar = "y", xVars = [],
  } = core;

  // Intercept
  const b0idx = varNames.indexOf("(Intercept)");
  const b0     = b0idx >= 0 ? beta[b0idx] : null;
  const regressors = varNames
    .filter(v => v !== "(Intercept)")
    .map(v => {
      const i = varNames.indexOf(v);
      return { v, b: beta[i], s: se[i], p: pVals[i] };
    });

  // Estimated equation — guard NaN/undefined betas (e.g. FE result without intercept)
  const eqParts = (b0 != null && isFinite(b0)) ? [b0.toFixed(4)] : [];
  regressors.forEach(({ v, b }) => {
    if (b == null || !isFinite(b)) { eqParts.push(`[N/A]·${v}`); return; }
    eqParts.push(`${b >= 0 ? "+ " : "– "}${Math.abs(b).toFixed(4)}·${v}`);
  });
  const equation = `${yVar} = ${eqParts.join(" ")}`;

  // Fit summary
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

  const funcForm     = detectFunctionalForm(yVar, xVars.length ? xVars : regressors.map(r => r.v));
  const coeffLines   = buildCoeffLines(core);
  const dictSection  = buildDictionarySection(dataDictionary);

  const userPrompt = `\
REGRESSION OUTPUT
Model type: ${modelLabel}
Dependent variable: ${yVar}
Functional form: ${funcForm}
Estimated equation: ${equation}
Fit statistics: ${fitLines}
${dictSection}
Coefficient details:
${coeffLines}

Write the two-paragraph interpretation now.`;

  try {
    return await callClaude({
      system:    INTERPRET_SYSTEM,
      user:      userPrompt,
      maxTokens: MAX_TOK,
    });
  } catch (err) {
    // No API key, CORS in dev, or network failure → return mock so UI stays functional
    console.warn("[AIService] interpretRegression failed:", err.message);
    return mockNarrative(core);
  }
}
