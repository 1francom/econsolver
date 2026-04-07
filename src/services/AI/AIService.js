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
//   callClaude({ system, user, messages?, maxTokens, model? })  — shared caller
//   inferVariableUnits(headers, sampleRows)                     → Promise<Record<string,string>>
//   interpretRegression(result, dataDictionary)                 → Promise<string>
//   suggestCleaning(dataQualityReport)                          → Promise<CleaningSuggestion[]>
//   researchCoach({ question, modelResult, dataDictionary?, history? }) → Promise<string>

import {
  SHARED_CONTEXT,
  INFER_UNITS_PROMPT,
  INTERPRET_REGRESSION_PROMPT,
  CLEANING_SUGGESTIONS_PROMPT,
  RESEARCH_COACH_PROMPT,
} from "./prompts/index.js";

const API_URL   = "https://api.anthropic.com/v1/messages";
const MODEL     = "claude-sonnet-4-6";        // narratives, cleaning, research coach
const MODEL_FAST = "claude-haiku-4-5-20251001"; // unit inference — cheap, fast
const MAX_TOK   = 700;

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
// messages: optional array of { role:'user'|'assistant', content: string }
// If provided, used directly (multi-turn). Otherwise `user` is wrapped as a single turn.
export async function callClaude({ system, user, messages, maxTokens = MAX_TOK, model = MODEL }) {
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
    model,
    max_tokens: maxTokens,
    system:     systemArray,
    messages:   messages ?? [{ role: "user", content: user }],
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
    raw = await callClaude({ system: taskPrompt, user: userPrompt, maxTokens: 600, model: MODEL_FAST });
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

// Classifies each regressor and returns a VARIABLE METADATA block for the prompt.
// The model reads this block to pick the right natural-language pattern (rule A–G).
function _classifyVariables(varNames, dataDictionary = {}) {
  // Common demographic / group dummies: name → { oneLabel, zeroLabel }
  const DEMO_MAP = {
    female:   { one: "female",   zero: "male"        },
    male:     { one: "male",     zero: "female"       },
    urban:    { one: "urban",    zero: "rural"        },
    rural:    { one: "rural",    zero: "urban"        },
    married:  { one: "married",  zero: "unmarried"    },
    employed: { one: "employed", zero: "unemployed"   },
    black:    { one: "Black",    zero: "non-Black"    },
    white:    { one: "White",    zero: "non-White"    },
    hispanic: { one: "Hispanic", zero: "non-Hispanic" },
    union:    { one: "union member", zero: "non-union" },
    migrant:  { one: "migrant", zero: "non-migrant"   },
    immigrant:{ one: "immigrant", zero: "non-immigrant"},
    public:   { one: "public sector", zero: "private sector" },
    private:  { one: "private sector", zero: "public sector" },
    formal:   { one: "formal sector", zero: "informal sector"},
  };

  // Treatment / post variable name patterns
  const TREATMENT_RE = /^(treated?|treatment|D|T|W|assignment|eligible|assigned)$/i;
  const POST_RE      = /^(post|after|wave\d*|period\d*|t\d+|follow_?up)$/i;
  // DiD interaction: "treat_post", "D_post", "treat×post", "treated_post", etc.
  const DID_RE       = /(treat|treated?|D|T)[_×x](post|after|wave|period)|(post|after|wave|period)[_×x](treat|treated?|D|T)/i;

  const lines = [];

  varNames.forEach(v => {
    if (v === "(Intercept)") return;

    const vl  = v.toLowerCase();
    const dict = dataDictionary?.[v] ?? "";

    // ── Data dictionary "dummy 1=X" ───────────────────────────────────────
    const dummyMatch = dict.match(/^dummy\s+1\s*=\s*(.+)$/i);
    if (dummyMatch) {
      const oneLabel = dummyMatch[1].trim();
      lines.push(`  ${v}: binary-dummy | 1="${oneLabel}", 0=reference/comparison group`);
      return;
    }

    // ── DiD interaction (check before individual treatment/post) ──────────
    if (DID_RE.test(v)) {
      lines.push(`  ${v}: did-interaction | coefficient = ATT under parallel trends`);
      return;
    }

    // ── Generic interaction term ──────────────────────────────────────────
    if (v.includes("×") || /_x_/i.test(v) || /interaction/i.test(dict)) {
      lines.push(`  ${v}: interaction-term | interpret as conditional/moderation effect`);
      return;
    }

    // ── Treatment indicator ───────────────────────────────────────────────
    if (TREATMENT_RE.test(v)) {
      lines.push(`  ${v}: treatment-indicator | 1=treated group, 0=control group`);
      return;
    }

    // ── Post / time dummy ─────────────────────────────────────────────────
    if (POST_RE.test(v)) {
      lines.push(`  ${v}: time-dummy | 1=post-treatment period, 0=pre-treatment period`);
      return;
    }

    // ── Known demographic dummies ─────────────────────────────────────────
    const demoKey = Object.keys(DEMO_MAP).find(k => vl === k || vl === `is_${k}` || vl === `d_${k}`);
    if (demoKey) {
      const { one, zero } = DEMO_MAP[demoKey];
      lines.push(`  ${v}: binary-dummy | 1="${one}", 0="${zero}"`);
      return;
    }

    // ── Log-transformed ───────────────────────────────────────────────────
    if (/^(log_|ln_|log\()/i.test(v) || /^log of/i.test(dict)) {
      lines.push(`  ${v}: log-var | ${dict || "log-transformed continuous variable"}`);
      return;
    }

    // ── Squared term ──────────────────────────────────────────────────────
    if (/_sq$|_2$|²/.test(v) || /squared/i.test(dict)) {
      lines.push(`  ${v}: squared-term | non-linear component, interpret jointly with linear term`);
      return;
    }

    // ── Continuous with dictionary ────────────────────────────────────────
    if (dict && !/^entity identifier$/i.test(dict)) {
      lines.push(`  ${v}: continuous | ${dict}`);
      return;
    }

    // ── Fallback — unknown ────────────────────────────────────────────────
    lines.push(`  ${v}: continuous | (no description available)`);
  });

  return lines.length ? `VARIABLE METADATA:\n${lines.join("\n")}` : "";
}

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

  const allXVars    = xVars.length ? xVars : regressors.map(r => r.v);
  const funcForm    = detectFunctionalForm(yVar, allXVars);
  const coeffLines  = buildCoeffLines(core);
  const dictSection = buildDictionarySection(dataDictionary);
  const metaBlock   = _classifyVariables(varNames, dataDictionary);

  const userPrompt = `\
REGRESSION OUTPUT
Model type: ${modelLabel}
Dependent variable: ${yVar}
Functional form: ${funcForm}
Estimated equation: ${yVar} = ${eqParts.join(" ")}
Fit statistics: ${fitLines}
${dictSection}
${metaBlock ? metaBlock + "\n" : ""}
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

// ─── 3. SUGGEST CLEANING ──────────────────────────────────────────────────────
// Accepts the DataQualityReport produced by buildDataQualityReport() and returns
// an array of prioritised cleaning suggestions with pipeline step types.
//
// Returns: Promise<CleaningSuggestion[]>
//   CleaningSuggestion: { col, issue, suggested_step, params, rationale, severity }
//   On failure: returns [] (never throws — caller renders empty state gracefully).

function _serializeReport(report) {
  const { meta, flags, columns, correlations, panelSummary } = report;
  const lines = [];

  // ── Dataset overview ──────────────────────────────────────────────────────
  lines.push(
    `DATASET: N=${meta.nRows.toLocaleString()} rows, K=${meta.nCols} cols, ` +
    `completeness=${(meta.completeness * 100).toFixed(1)}%, ` +
    `numeric=${meta.numericCols}, categorical=${meta.categoricalCols}, mixed=${meta.mixedCols}`
  );

  // ── Panel summary ─────────────────────────────────────────────────────────
  if (panelSummary) {
    lines.push(
      `PANEL: ${panelSummary.balance}, ${panelSummary.nEntities} entities, ` +
      `${panelSummary.nPeriods} periods, attrition=${(panelSummary.attritionPct * 100).toFixed(1)}%` +
      (panelSummary.hasDups ? ", DUPLICATE (i,t) PAIRS DETECTED" : "") +
      (panelSummary.hasGaps ? ", gaps present" : "")
    );
  }

  // ── Flags (top-level actionable issues) ───────────────────────────────────
  const actionableFlags = flags.filter(f => f.severity !== "ok").slice(0, 15);
  if (actionableFlags.length > 0) {
    lines.push(`\nFLAGS (${actionableFlags.length}, ordered by severity):`);
    actionableFlags.forEach(f => {
      const colLabel = f.col ? `\`${f.col}\`` : "dataset-level";
      lines.push(`  [${f.severity}] ${colLabel} — ${f.title}`);
      lines.push(`    ${f.detail}`);
      if (f.suggestedStep) lines.push(`    Suggested pipeline step: ${f.suggestedStep}`);
    });
  }

  // ── Per-column detail for non-ok columns ──────────────────────────────────
  const problemCols = columns.filter(c => c.severity !== "ok").slice(0, 12);
  if (problemCols.length > 0) {
    lines.push(`\nCOLUMN DETAIL:`);
    problemCols.forEach(c => {
      const statParts = [];
      if (c.stats.naPct > 0)    statParts.push(`missing=${(c.stats.naPct * 100).toFixed(1)}%`);
      if (c.stats.mean != null) statParts.push(`mean=${c.stats.mean.toFixed(3)}, sd=${c.stats.std?.toFixed(3)}`);
      if (c.stats.uCount != null) statParts.push(`unique=${c.stats.uCount}`);
      if (c.outlierReport) {
        statParts.push(`IQR_outliers=${c.outlierReport.iqrCount}(${(c.outlierReport.iqrPct * 100).toFixed(1)}%)`);
        statParts.push(`skew=${c.outlierReport.skewness.toFixed(2)}(${c.outlierReport.skewLabel})`);
        if (c.outlierReport.extremeLow?.length)  statParts.push(`min_vals=[${c.outlierReport.extremeLow.join(",")}]`);
        if (c.outlierReport.extremeHigh?.length) statParts.push(`max_vals=[${c.outlierReport.extremeHigh.join(",")}]`);
      }
      if (c.missingPattern?.isSystematic) statParts.push("systematic_missingness=true");

      lines.push(`  \`${c.col}\` [${c.type}, ${c.severity}]: ${statParts.join(", ")}`);
    });
  }

  // ── High correlations ─────────────────────────────────────────────────────
  if (correlations.length > 0) {
    lines.push(`\nHIGH CORRELATIONS (|r| ≥ 0.85):`);
    correlations.slice(0, 6).forEach(({ a, b, r }) => {
      lines.push(`  \`${a}\` ↔ \`${b}\`: r=${r.toFixed(4)}`);
    });
  }

  return lines.join("\n");
}

export async function suggestCleaning(dataQualityReport) {
  if (!dataQualityReport) return [];

  const reportText  = _serializeReport(dataQualityReport);
  const taskPrompt  = CLEANING_SUGGESTIONS_PROMPT.replace(SHARED_CONTEXT, "").trim();
  const userPrompt  = `DATA QUALITY REPORT:\n\n${reportText}\n\nReturn the JSON array now.`;

  let raw;
  try {
    raw = await callClaude({ system: taskPrompt, user: userPrompt, maxTokens: 1800 });
  } catch (err) {
    console.warn("[AIService] suggestCleaning failed:", err.message);
    return [];
  }

  const cleaned = raw.replace(/```json\s*/gi, "").replace(/```\s*/g, "").trim();
  try {
    const parsed = JSON.parse(cleaned);
    if (!Array.isArray(parsed)) return [];
    // Validate shape — drop any suggestion missing required fields
    return parsed.filter(s =>
      typeof s.issue === "string" &&
      typeof s.rationale === "string" &&
      ["high", "medium", "low"].includes(s.severity)
    );
  } catch (err) {
    console.warn("[AIService] suggestCleaning — JSON parse failed:", err.message);
    return [];
  }
}

// ─── 4. RESEARCH COACH ────────────────────────────────────────────────────────
// Multi-turn conversational advisor. Serialises the active model result into
// a compact context block, then appends the conversation history + new question.
//
// history: [{ role:'user'|'assistant', text: string }]  (previous turns)
// Returns: Promise<string>  — the assistant's reply text

function _serializeModelContext(result, dataDictionary) {
  if (!result) return "No model has been estimated yet.";

  // 2SLS wraps in .second
  const core = result.second ?? result;
  const {
    varNames = [], beta = [], se = [], pVals = [],
    R2, adjR2, n, Fstat, Fpval,
    att, attSE, attP,
    modelLabel = "OLS", yVar = "y", xVars = [],
  } = core;

  const lines = [];
  lines.push(`ACTIVE MODEL: ${modelLabel}`);
  lines.push(`Dependent variable: ${yVar}`);

  const regressors = varNames.filter(v => v !== "(Intercept)");
  if (regressors.length) lines.push(`Regressors: ${regressors.join(", ")}`);

  // Fit stats
  const fitParts = [];
  if (n     != null)                fitParts.push(`N=${n}`);
  if (R2    != null && isFinite(R2))   fitParts.push(`R²=${R2.toFixed(4)}`);
  if (adjR2 != null && isFinite(adjR2)) fitParts.push(`Adj.R²=${adjR2.toFixed(4)}`);
  if (Fstat != null && isFinite(Fstat)) {
    const fp = Fpval != null ? (Fpval < 0.001 ? "<0.001" : Fpval.toFixed(4)) : "?";
    fitParts.push(`F=${Fstat.toFixed(2)}(p=${fp})`);
  }
  if (att != null && isFinite(att)) {
    const ap = attP != null ? (attP < 0.001 ? "<0.001" : attP.toFixed(4)) : "?";
    fitParts.push(`ATT=${att.toFixed(4)}(SE=${attSE?.toFixed(4) ?? "?"},p=${ap})`);
  }
  if (fitParts.length) lines.push(`Fit: ${fitParts.join(", ")}`);

  // Coefficients
  lines.push("Coefficients:");
  varNames.forEach(v => {
    const i = varNames.indexOf(v);
    const b = beta[i], s = se[i], p = pVals[i];
    const bStr = (b != null && isFinite(b)) ? b.toFixed(4) : "N/A";
    const sStr = (s != null && isFinite(s)) ? s.toFixed(4) : "N/A";
    const sig  = p == null ? "p=N/A"
               : p < 0.01 ? "p<0.01 ***"
               : p < 0.05 ? "p<0.05 **"
               : p < 0.1  ? "p<0.1 *"
               : `p=${p.toFixed(3)} n.s.`;
    lines.push(`  ${v}: β=${bStr}, SE=${sStr}, ${sig}`);
  });

  // 2SLS first stage (if present)
  if (result.firstStages?.length) {
    result.firstStages.forEach(fs => {
      if (fs.Fstat != null) {
        lines.push(`First-stage F (${fs.endogVar ?? "endog"}): ${fs.Fstat.toFixed(2)}`);
      }
    });
  }

  // RDD specifics
  if (result.type === "RDD" && result.main) {
    const r = result.main;
    lines.push(`LATE at cutoff=${r.cutoff}: ${r.late?.toFixed(4) ?? "N/A"} (SE=${r.lateSE?.toFixed(4) ?? "N/A"}, p=${r.lateP?.toFixed(4) ?? "N/A"})`);
    lines.push(`Bandwidth: ${result.h?.toFixed(4) ?? "N/A"}, Kernel: ${r.kernelType ?? "N/A"}`);
  }

  // Data dictionary
  if (dataDictionary && Object.keys(dataDictionary).length) {
    lines.push("Data dictionary:");
    Object.entries(dataDictionary).slice(0, 20).forEach(([k, v]) => {
      lines.push(`  ${k}: "${v}"`);
    });
  }

  return lines.join("\n");
}

export async function researchCoach({ question, modelResult, dataDictionary = null, history = [] }) {
  if (!question?.trim()) return "";

  const modelContext = _serializeModelContext(modelResult, dataDictionary);
  const taskPrompt   = RESEARCH_COACH_PROMPT.replace(SHARED_CONTEXT, "").trim();

  // First user message always includes the model context (pinned to the top of the conversation)
  const contextPrefix = `MODEL CONTEXT:\n${modelContext}\n\n────────────────────────────\n`;

  // Build messages array from history
  const apiMessages = [];
  history.forEach((turn, idx) => {
    const content = (turn.role === "user" && idx === 0)
      ? contextPrefix + turn.text
      : turn.text;
    apiMessages.push({ role: turn.role, content });
  });

  // New user turn — prepend context only if history is empty (first question)
  const newContent = apiMessages.length === 0
    ? contextPrefix + question.trim()
    : question.trim();
  apiMessages.push({ role: "user", content: newContent });

  try {
    return await callClaude({ system: taskPrompt, messages: apiMessages, maxTokens: 500 });
  } catch (err) {
    console.warn("[AIService] researchCoach failed:", err.message);
    return "The research coach is unavailable — check your API key and network connection.";
  }
}
