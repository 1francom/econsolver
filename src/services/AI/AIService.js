// ─── LITUX · AIService.js ───────────────────────────────────────────────
// Centralised LLM service layer. All Anthropic API calls live here.
//
// PROMPT CACHING:
//   Anthropic caches blocks marked cache_control: {type:"ephemeral"}.
//   SHARED_CONTEXT is the cached block — prepended automatically in callClaude.
//   Header required: "anthropic-beta": "prompt-caching-2024-07-31"
//   Cache TTL: 5 minutes (refreshed on each hit). ~10% of input token cost.
//
// Exports:
//   callClaude({ system, user, messages?, maxTokens, model? })       — shared caller
//   inferVariableUnits(headers, sampleRows)                          → Promise<Record<string,string>>
//   interpretRegression(result, dataDictionary)                      → Promise<string>
//   suggestCleaning(dataQualityReport)                               → Promise<CleaningSuggestion[]>
//   compareModels(modelA, modelB, dataDictionary?)                   → Promise<string>
//   researchCoach({ question, modelResult, dataDictionary?, history? }) → Promise<string>

import {
  SHARED_CONTEXT,
  INFER_UNITS_PROMPT,
  INTERPRET_REGRESSION_PROMPT,
  CLEANING_SUGGESTIONS_PROMPT,
  COMPARE_MODELS_PROMPT,
  RESEARCH_COACH_PROMPT,
  COACH_DISPATCH_PROMPT,
  UNIFIED_SCRIPT_PROMPT,
  INTERPRET_MARGINAL_EFFECTS_PROMPT,
  INTERPRET_OPTIMIZATION_PROMPT,
  NL_TO_PIPELINE_PROMPT,
  buildMetadataContext,
} from "./Prompts/index.js";
import { serializeSnapshot, loadOptsToScriptHint } from "./sessionSnapshot.js";
import { toDfVar } from "../../pipeline/exporter.js";
import { buildRLoadLine, buildPyLoadLine, buildStataLoadLine } from "../export/loadLine.js";
import { serializeAllowedSteps, serializeCapabilityMap } from "./appCapabilityMap.js";
import { filterVariableNames, filterSampleRows } from "../Privacy/privacyFilter.js";
import { detectPII } from "../Privacy/piiDetector.js";
import { getSession } from "../auth/authService.js";

const API_URL       = "https://api.anthropic.com/v1/messages";
const MODEL         = "claude-sonnet-4-6";        // orchestrator: narratives, cleaning, comparison
const MODEL_FAST    = "claude-haiku-4-5-20251001"; // unit inference — cheap, fast
const MODEL_ADVISOR = "claude-opus-4-7";           // specialist: focused technical sub-questions
const MAX_TOK       = 700;

// Static app capability map — built once, sent as a cached block to the coach.
let _capabilityMapCache = null;
function getCapabilityMap() {
  if (_capabilityMapCache == null) _capabilityMapCache = serializeCapabilityMap();
  return _capabilityMapCache;
}

// ── API routing ───────────────────────────────────────────────────────────────
// VITE_AI_PROXY_ENABLED=true  → /api/anthropic Vercel Function (key never reaches browser)
// VITE_AI_PROXY_ENABLED=false → direct Anthropic call using localStorage/env key (dev only)
const _proxyEnabled = import.meta.env.VITE_AI_PROXY_ENABLED === "true";

// Dev fallback: localStorage key > env var. Only used when proxy is disabled.
function getApiKey() {
  return localStorage.getItem("litux_api_key") || import.meta.env.VITE_ANTHROPIC_KEY || "";
}

// Retrieve the Supabase JWT for the currently signed-in user.
// Returns empty string when no session exists (graceful — proxy will 401).
async function getAuthToken() {
  try {
    const session = await getSession();
    return session?.access_token ?? "";
  } catch {
    return "";
  }
}

// ─── MOCK FALLBACKS ───────────────────────────────────────────────────────────
function mockNarrative(result) {
  const { varNames = [], beta = [], pVals = [], R2, n } = result;
  const modelLabel = result.label ?? result.modelLabel ?? "OLS";
  const yVar = result.spec?.yVar ?? result.yVar ?? "y";
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
    if (_proxyEnabled) {
      // Production: key lives in Vercel env — never reaches the browser.
      // JWT identifies the user; /api/anthropic validates tier server-side.
      const token = await getAuthToken();
      res = await fetch("/api/anthropic", {
        method:  "POST",
        headers: {
          "Content-Type":  "application/json",
          "Authorization": token ? `Bearer ${token}` : "",
        },
        body: JSON.stringify(body),
      });
    } else {
      // Dev fallback: direct Anthropic call with localStorage / env key.
      const apiKey = getApiKey();
      if (!apiKey) throw new Error("No API key — enter your Anthropic key in Settings (⚙), or set VITE_AI_PROXY_ENABLED=true.");
      res = await fetch(API_URL, {
        method:  "POST",
        headers: {
          "Content-Type":   "application/json",
          "x-api-key":      apiKey,
          "anthropic-version": "2023-06-01",
          "anthropic-beta": "prompt-caching-2024-07-31",
          "anthropic-dangerous-direct-browser-access": "true",
        },
        body: JSON.stringify(body),
      });
    }
  } catch (networkErr) {
    throw new Error(`Network error: ${networkErr.message ?? "could not reach API"}`);
  }

  if (!res.ok) {
    let errBody;
    try { errBody = await res.json(); } catch { errBody = { error: res.statusText }; }
    if (res.status === 403 && errBody?.error === "premium_required") {
      throw new Error("PREMIUM_REQUIRED");
    }
    if (res.status === 401) {
      throw new Error("Session expired — please sign in again.");
    }
    throw new Error(`API error ${res.status}: ${errBody?.error ?? res.statusText}`);
  }

  const data = await res.json();
  const text = data.content?.find(b => b.type === "text")?.text ?? "";
  if (!text) throw new Error("Empty response from model.");
  return text;
}

// ─── STREAMING VARIANT ────────────────────────────────────────────────────────
// Same egress + caching invariants as callClaude (SHARED_CONTEXT cached block,
// anthropic-beta header). Parses the Anthropic SSE stream and forwards each text
// delta to onText. Honors an AbortController signal — on abort, resolves with the
// partial text accumulated so far (abort is NOT thrown as an error).
export async function streamClaude({ system, messages, maxTokens = MAX_TOK, model = MODEL, signal, onText, extraCached = null }) {
  const systemArray = [
    { type: "text", text: SHARED_CONTEXT, cache_control: { type: "ephemeral" } },
  ];
  if (extraCached) systemArray.push({ type: "text", text: extraCached, cache_control: { type: "ephemeral" } });
  if (system) systemArray.push({ type: "text", text: system });

  const body = {
    model,
    max_tokens: maxTokens,
    stream:     true,
    system:     systemArray,
    messages:   messages ?? [],
  };

  let res;
  try {
    if (_proxyEnabled) {
      const token = await getAuthToken();
      res = await fetch("/api/anthropic", {
        method:  "POST",
        headers: {
          "Content-Type":  "application/json",
          "Authorization": token ? `Bearer ${token}` : "",
        },
        body:   JSON.stringify(body),
        signal,
      });
    } else {
      const apiKey = getApiKey();
      if (!apiKey) throw new Error("No API key — enter your Anthropic key in Settings (⚙), or set VITE_AI_PROXY_ENABLED=true.");
      res = await fetch(API_URL, {
        method:  "POST",
        headers: {
          "Content-Type":      "application/json",
          "x-api-key":         apiKey,
          "anthropic-version": "2023-06-01",
          "anthropic-beta":    "prompt-caching-2024-07-31",
          "anthropic-dangerous-direct-browser-access": "true",
        },
        body:   JSON.stringify(body),
        signal,
      });
    }
  } catch (networkErr) {
    if (networkErr.name === "AbortError") return "";
    throw new Error(`Network error: ${networkErr.message ?? "could not reach API"}`);
  }

  if (!res.ok) {
    let errBody;
    try { errBody = await res.json(); } catch { errBody = { error: res.statusText }; }
    if (res.status === 403 && errBody?.error === "premium_required") throw new Error("PREMIUM_REQUIRED");
    if (res.status === 401) throw new Error("Session expired — please sign in again.");
    throw new Error(`API error ${res.status}: ${errBody?.error ?? res.statusText}`);
  }

  const reader  = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  let full   = "";

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      const events = buffer.split("\n\n");
      buffer = events.pop() ?? ""; // last chunk may be incomplete
      for (const evt of events) {
        const dataLine = evt.split("\n").find(l => l.startsWith("data:"));
        if (!dataLine) continue;
        const json = dataLine.slice(5).trim();
        if (!json || json === "[DONE]") continue;
        let parsed;
        try { parsed = JSON.parse(json); } catch { continue; }
        if (parsed.type === "content_block_delta" && parsed.delta?.type === "text_delta") {
          const piece = parsed.delta.text ?? "";
          full += piece;
          onText?.(piece);
        } else if (parsed.type === "error") {
          throw new Error(parsed.error?.message ?? "stream error");
        }
      }
    }
  } catch (err) {
    if (err.name === "AbortError") return full; // partial answer retained
    throw err;
  }

  return full;
}

// ─── 1. INFER VARIABLE UNITS ─────────────────────────────────────────────────
export async function inferVariableUnits(headers, sampleRows) {
  if (!headers?.length) return {};

  const sample = sampleRows.slice(0, 3);

  // Privacy-first hard constraint: auto-detect PII and strip it through the
  // sanctioned privacyFilter choke point before any network egress. HIGH columns
  // (names, emails, SSNs…) are suppressed entirely; MEDIUM columns are aliased and
  // their sample values masked/rounded. Non-PII columns pass through unchanged so
  // unit inference quality is preserved.
  const piiConfig = detectPII(headers, sample);
  const { headers: safeHeaders, rows: safeRows, redacted } = filterSampleRows(headers, sample, piiConfig);
  if (redacted.length) {
    console.info(
      `[AIService] inferVariableUnits: ${redacted.length} PII column(s) filtered before egress — ` +
      redacted.map(r => `${r.col}→${r.action}`).join(", "),
    );
  }

  const sampleText = [
    safeHeaders.join(" | "),
    ...safeRows.map(r => safeHeaders.map(h => {
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

  // AI keys its response by the (possibly aliased) headers it was shown. Map any
  // aliased keys back to the original column names before returning.
  const aliasToOrig = {};
  for (const r of redacted) {
    if (r.action === "aliased" && r.alias) aliasToOrig[r.alias] = r.col;
  }

  const cleaned = raw.replace(/```json\s*/gi, "").replace(/```\s*/g, "").trim();
  try {
    const parsed = JSON.parse(cleaned);
    const remapped = {};
    for (const [k, val] of Object.entries(parsed)) remapped[aliasToOrig[k] ?? k] = val;
    const result = {};
    headers.forEach(h => { result[h] = remapped[h] ?? h; });
    return result;
  } catch {
    return identity();
  }
}

// ─── 2. INTERPRET REGRESSION ─────────────────────────────────────────────────

// Classifies each regressor and returns a VARIABLE METADATA block for the prompt.
// The model reads this block to pick the right natural-language pattern (rule A–G).
function _classifyVariables(varNames, dataDictionary = {}, rows = null) {
  // Value-based binary detection: if every non-null value is 0 or 1 → binary.
  // Uses Number() coercion to handle string "0"/"1" and boolean true/false from pipeline steps.
  const isBinaryInData = v => {
    if (!rows?.length) return false;
    const vals = rows.map(r => r[v]).filter(x => x !== null && x !== undefined);
    return vals.length > 0 && vals.every(x => {
      const n = Number(x);
      return (n === 0 || n === 1) && !isNaN(n);
    });
  };

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

    // ── Standardized (z-score) ────────────────────────────────────────────
    if (/_std$|_z$|_zscore$/i.test(v) || /standardized/i.test(dict)) {
      const base = v.replace(/_std$|_z$|_zscore$/i, "");
      lines.push(`  ${v}: standardized | one SD increase in "${base}" — do NOT say "one unit increase"`);
      return;
    }

    // ── Lagged / leading variable ─────────────────────────────────────────
    if (/_lag\d*$|_l\d+$|_lead\d*$/i.test(v) || /lagged/i.test(dict)) {
      const isLead = /_lead/i.test(v);
      lines.push(`  ${v}: ${isLead ? "lead" : "lag"}-var | effect operates with temporal delay — state the lag explicitly`);
      return;
    }

    // ── Generic binary: value-check OR suffix ─────────────────────────────
    if (isBinaryInData(v) ||
        /_d$|_dummy$|_bin$|_flag$|_indicator$|_eligible$|_treat$|_control$/i.test(v)) {
      const dictLabel = dict && !/^entity identifier$/i.test(dict) ? dict : null;
      lines.push(dictLabel
        ? `  ${v}: binary-dummy | 1="${dictLabel}", 0=reference/comparison group`
        : `  ${v}: binary-dummy | binary indicator — name the active group (1=?) and reference group (0=?)`);
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

export async function interpretRegression(result, dataDictionary = null, metadataReport = null, rows = null, { snapshot = null } = {}) {
  if (!result) throw new Error("No result object provided.");

  const {
    varNames = [], beta = [], se = [], pVals = [],
    R2 = null, adjR2 = null, n = null, df = null,
    Fstat = null, Fpval = null,
    att = null, attP = null,
  } = result;
  const modelLabel = result.label ?? result.modelLabel ?? "OLS";
  const yVar  = result.spec?.yVar  ?? result.yVar  ?? "y";
  const xVars = result.spec?.xVars ?? result.xVars ?? [];

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
  const coeffLines  = buildCoeffLines(result);
  const dictSection = buildDictionarySection(dataDictionary);
  const metaBlock   = _classifyVariables(varNames, dataDictionary, rows);

  const metaCtx     = metadataReport ? buildMetadataContext(metadataReport) : "";
  const snapshotBlk = snapshot ? "\nSESSION CONTEXT:\n" + serializeSnapshot(snapshot) + "\n" : "";
  const userPrompt = `\
REGRESSION OUTPUT
Model type: ${modelLabel}
Estimator type: ${result.type ?? "OLS"}
Dependent variable: ${yVar}
Functional form: ${funcForm}
Estimated equation: ${yVar} = ${eqParts.join(" ")}
Fit statistics: ${fitLines}
${dictSection}
${metaBlock ? metaBlock + "\n" : ""}
Coefficient details:
${coeffLines}
${metaCtx ? "\n" + metaCtx : ""}${snapshotBlk}
Write the two-paragraph interpretation now.`;

  try {
    const taskPrompt = INTERPRET_REGRESSION_PROMPT.replace(SHARED_CONTEXT, "").trim();
    return await callClaude({ system: taskPrompt, user: userPrompt, maxTokens: MAX_TOK });
  } catch (err) {
    console.warn("[AIService] interpretRegression failed:", err.message);
    return mockNarrative(result);
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

// ─── 3b. NL → PIPELINE STEPS ─────────────────────────────────────────────────
// Translates a natural-language command into declarative pipeline steps drawn
// from STEP_REGISTRY (cleaning + features). Validation/preview happen in the
// caller (stepValidator + runPipeline) so this stays a thin generation layer.
//
// command: string   columns: [{ name, dtype, samples: [...] }]
// Returns { interpretation, steps, notes } | { error }
export async function nlToPipeline({ command, columns = [], allowedCategories = ["cleaning", "features"], signal } = {}) {
  if (!command?.trim()) return { error: "empty command" };

  const taskPrompt = NL_TO_PIPELINE_PROMPT.replace(SHARED_CONTEXT, "").trim();
  const colBlock = columns.map(c => {
    const samples = (c.samples ?? []).slice(0, 5).map(v => JSON.stringify(v)).join(", ");
    return `  ${c.name} (${c.dtype ?? "?"}): ${samples}`;
  }).join("\n");
  const userPrompt =
    `${serializeAllowedSteps(allowedCategories)}\n\n` +
    `CURRENT COLUMNS:\n${colBlock}\n\n` +
    `INSTRUCTION: ${command.trim()}\n\nReturn the JSON now.`;

  let raw;
  try {
    raw = await callClaude({ system: taskPrompt, user: userPrompt, maxTokens: 1500, signal });
  } catch (err) {
    console.warn("[AIService] nlToPipeline failed:", err.message);
    return { error: err.message };
  }

  const cleaned = raw.replace(/```json\s*/gi, "").replace(/```\s*/g, "").trim();
  try {
    const parsed = JSON.parse(cleaned);
    return {
      interpretation: typeof parsed.interpretation === "string" ? parsed.interpretation : "",
      steps: Array.isArray(parsed.steps) ? parsed.steps : [],
      notes: typeof parsed.notes === "string" ? parsed.notes : "",
    };
  } catch (err) {
    console.warn("[AIService] nlToPipeline — JSON parse failed:", err.message);
    return { error: "Could not parse the AI response. Try rephrasing." };
  }
}

// ─── 4. COMPARE MODELS ───────────────────────────────────────────────────────
// Comparative analysis of 2–8 regression results.
// Accepts either (models: EstimationResult[], dataDictionary?) for N-way,
// or legacy (modelA, modelB, dataDictionary?) for 2-way.
// Returns Promise<string> — three paragraphs of plain text.

function _formatModelBlock(label, raw) {
  const {
    varNames = [], beta = [], se = [], pVals = [],
    R2, adjR2, n, Fstat, Fpval, att, attP, late, lateP,
  } = raw;
  const modelLabel = raw.label ?? raw.modelLabel ?? "OLS";
  const yVar = raw.spec?.yVar ?? raw.yVar ?? "y";

  const lines = [
    `${label}: ${modelLabel} | dep.var: ${yVar} | N=${n ?? "?"} | R²=${R2?.toFixed(4) ?? "?"} | Adj.R²=${adjR2?.toFixed(4) ?? "?"}`,
  ];
  if (Fstat  != null && isFinite(Fstat))  lines.push(`  F=${Fstat.toFixed(3)} (p=${Fpval != null ? (Fpval < 0.001 ? "<0.001" : Fpval.toFixed(4)) : "?"})`);
  if (att    != null && isFinite(att))    lines.push(`  ATT=${att.toFixed(4)} (p=${attP  != null ? (attP  < 0.001 ? "<0.001" : attP.toFixed(4))  : "?"})`);
  if (late   != null && isFinite(late))   lines.push(`  LATE=${late.toFixed(4)} (p=${lateP != null ? (lateP < 0.001 ? "<0.001" : lateP.toFixed(4)) : "?"})`);

  lines.push("  Coefficients:");
  varNames.filter(v => v !== "(Intercept)").forEach(v => {
    const i = varNames.indexOf(v);
    const b = beta[i], s = se[i], p = pVals[i];
    const sig = p == null ? "p=N/A" : p < 0.01 ? "p<0.01***" : p < 0.05 ? "p<0.05**" : p < 0.1 ? "p<0.1*" : `p=${p.toFixed(3)}`;
    lines.push(`    ${v}: β=${b?.toFixed(4) ?? "N/A"}, SE=${s?.toFixed(4) ?? "N/A"}, ${sig}`);
  });
  return lines.join("\n");
}

export async function compareModels(modelsOrA, dataDictionaryOrB = null, legacyDict = null) {
  // Normalise overloaded signature
  let models, dataDictionary;
  if (Array.isArray(modelsOrA)) {
    // N-way call: compareModels(models[], dataDictionary?)
    models        = modelsOrA;
    dataDictionary = dataDictionaryOrB;
  } else {
    // Legacy 2-way call: compareModels(modelA, modelB, dataDictionary?)
    models        = [modelsOrA, dataDictionaryOrB].filter(Boolean);
    dataDictionary = legacyDict;
  }

  if (!models?.length || models.length < 2) return "Provide at least two model results to compare.";

  const modelBlocks = models.map((m, i) => {
    const label = `${m.label ?? m.type ?? "Model"} (${i+1})`;
    return _formatModelBlock(label, m);
  }).join("\n\n");

  const dictSection = (dataDictionary && Object.keys(dataDictionary).length)
    ? `\nDATA DICTIONARY:\n${Object.entries(dataDictionary).map(([k,v]) => `  ${k}: "${v}"`).join("\n")}\n`
    : "";

  const userPrompt = `${modelBlocks}${dictSection}\n\nWrite the three-paragraph comparative analysis now.`;

  try {
    const taskPrompt = COMPARE_MODELS_PROMPT.replace(SHARED_CONTEXT, "").trim();
    return await callClaude({ system: taskPrompt, user: userPrompt, maxTokens: 800 });
  } catch (err) {
    console.warn("[AIService] compareModels failed:", err.message);
    return "Model comparison unavailable — check API key and connection.";
  }
}

// ─── 5. RESEARCH COACH ────────────────────────────────────────────────────────
// Multi-turn conversational advisor. Serialises the active model result into
// a compact context block, then appends the conversation history + new question.
//
// history: [{ role:'user'|'assistant', text: string }]  (previous turns)
// Returns: Promise<string>  — the assistant's reply text

function _serializeModelContext(result, dataDictionary) {
  if (!result) return "No model has been estimated yet.";

  const {
    varNames = [], beta = [], se = [], pVals = [],
    R2, adjR2, n, Fstat, Fpval,
    att, attSE, attP,
  } = result;
  const modelLabel = result.label ?? result.modelLabel ?? "OLS";
  const yVar  = result.spec?.yVar  ?? result.yVar  ?? "y";
  const xVars = result.spec?.xVars ?? result.xVars ?? [];

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

  // RDD specifics (Sharp / Spatial — both expose rddData + late/lateSE/lateP)
  if (result.type === "RDD" || result.type === "SpatialRDD") {
    const rdd = result.rddData ?? {};
    const isSpatial = result.type === "SpatialRDD";
    if (isSpatial) {
      lines.push(`LATE at the geographic boundary: ${result.late?.toFixed(4) ?? "N/A"} (SE=${result.lateSE?.toFixed(4) ?? "N/A"}, p=${result.lateP?.toFixed(4) ?? "N/A"})`);
      if (result.nTreated != null && result.nControl != null)
        lines.push(`Treated/control split in bandwidth: ${result.nTreated}/${result.nControl}`);
      if (result.distCol)      lines.push(`Distance-to-boundary column: ${result.distCol}`);
      if (result.treatmentCol) lines.push(`Treated-side indicator column: ${result.treatmentCol}`);
    } else {
      lines.push(`LATE at cutoff=${rdd.cutoff ?? result.spec?.cutoff}: ${result.late?.toFixed(4) ?? "N/A"} (SE=${result.lateSE?.toFixed(4) ?? "N/A"}, p=${result.lateP?.toFixed(4) ?? "N/A"})`);
    }
    lines.push(`Bandwidth: ${rdd.h?.toFixed(4) ?? "N/A"}, Kernel: ${rdd.kernelType ?? "N/A"}`);
  }

  // Synthetic Control specifics
  if (result.type === "SyntheticControl") {
    lines.push(`Treated unit: ${result.scTreatedUnit ?? "?"}, Treatment time: ${result.scTreatTime ?? "?"}`);
    lines.push(`Pre-RMSPE: ${result.scRmspePre?.toFixed(6) ?? "N/A"}, Post-RMSPE: ${result.scRmspePost?.toFixed(6) ?? "N/A"}`);
    if (result.scPValue != null) lines.push(`Placebo p-value: ${result.scPValue.toFixed(3)}`);
    const topWeights = Object.entries(result.scWeights ?? {})
      .sort(([, a], [, b]) => b - a).filter(([, w]) => w > 0.001).slice(0, 5)
      .map(([u, w]) => `${u}:${(w * 100).toFixed(1)}%`).join(", ");
    if (topWeights) lines.push(`Top donor weights: ${topWeights}`);
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

function _specialistSnapshotLine(snapshot) {
  if (!snapshot) return "";
  const steps  = snapshot.pipeline?.length ? `${snapshot.pipeline.length} pipeline steps` : "no pipeline";
  const se     = snapshot.inferenceOpts?.seType ? `, SE=${snapshot.inferenceOpts.seType}` : "";
  const pinned = snapshot.pinnedModels?.length ? `, ${snapshot.pinnedModels.length} pinned models` : "";
  return `\nSESSION: ${steps}${se}${pinned}.`;
}

export async function researchCoach({ question, images = [], modelResult, dataDictionary = null, history = [], metadataReport = null, snapshot = null, signal = undefined, onText = undefined }) {
  if (!question?.trim()) return "";

  const modelContext  = _serializeModelContext(modelResult, dataDictionary);
  const taskPrompt    = RESEARCH_COACH_PROMPT.replace(SHARED_CONTEXT, "").trim();
  const metaCtx       = metadataReport ? "\n" + buildMetadataContext(metadataReport) : "";
  const snapshotBlk   = snapshot ? "\nSESSION CONTEXT:\n" + serializeSnapshot(snapshot) + "\n" : "";
  const contextPrefix = `MODEL CONTEXT:\n${modelContext}${metaCtx}${snapshotBlk}\n\n────────────────────────────\n`;

  try {
    // ── Step 1: Opus specialist — focused technical sub-question (≤250 tokens) ─
    // Opus answers only the hardest methodological/identification part of the question.
    // Short prompt + short answer → cheap. Sonnet uses this insight to write better.
    const opusInsight = await callClaude({
      system: "You are a specialist econometrician advising a PhD researcher. Given the research context below, identify and answer the single most important technical or methodological concern in the question. Focus on identification strategy, causal assumptions, instrument validity, or statistical interpretation. Be direct and specific. Maximum 3 sentences.",
      user:   `RESEARCH CONTEXT:\n${modelContext}${_specialistSnapshotLine(snapshot)}\n\nRESEARCHER QUESTION: ${question.trim()}`,
      maxTokens: 250,
      model: MODEL_ADVISOR,
    }).catch(() => null); // non-fatal — Sonnet proceeds without it if Opus fails

    // ── Step 2: Sonnet orchestrates full research advice ──────────────────────
    // Incorporates Opus's specialist insight as a grounding block.
    const apiMessages = [];
    history.forEach((turn, idx) => {
      // content may be a string (text-only) or array (multipart with images)
      const content = turn.content ?? turn.text;
      apiMessages.push({ role: turn.role, content });
    });

    const specialistBlock = opusInsight ? `[Specialist insight: ${opusInsight}]\n\n` : "";
    const textContent = apiMessages.length === 0
      ? specialistBlock + contextPrefix + question.trim()
      : specialistBlock + question.trim();

    // Build last user message — multipart if images present
    const newContent = images.length > 0
      ? [
          ...images.map(img => ({ type: "image", source: { type: "base64", media_type: img.mediaType, data: img.base64 } })),
          { type: "text", text: textContent },
        ]
      : textContent;
    apiMessages.push({ role: "user", content: newContent });

    return await streamClaude({ system: taskPrompt, messages: apiMessages, maxTokens: 800, signal, onText, extraCached: getCapabilityMap() });
  } catch (err) {
    if (err.message === "PREMIUM_REQUIRED") throw err; // let caller handle the gate
    console.warn("[AIService] researchCoach failed:", err.message);
    return "The research coach is unavailable — check your API key and network connection.";
  }
}

// ─── 5b. COACH → CLEANING DISPATCH ────────────────────────────────────────────
// Cheap, non-streaming structured call run AFTER a coach reply. Decides whether
// the user's question maps to a single-column cleaning action the Clean-tab AI
// command bar (NLCommandBar → nlToPipeline) can execute and preview.
//
// Returns: Promise<{ col, instruction, label } | null>  — null = no dispatch.
// Routed to the fast/cheap model; any failure returns null (safe default — the
// streamed coach reply is unaffected).
export async function coachDispatch({ question, headers = [], sampleRows = [], pipeline = [], dataDictionary = null } = {}) {
  if (!question?.trim() || !headers.length) return null;

  const taskPrompt = COACH_DISPATCH_PROMPT.replace(SHARED_CONTEXT, "").trim();

  // Compact column block: name (+ dictionary label) + up to 4 sample values.
  const colBlock = headers.map(h => {
    const samples = [];
    for (const r of sampleRows) {
      if (r?.[h] != null) { samples.push(JSON.stringify(r[h])); if (samples.length >= 4) break; }
    }
    const dict = dataDictionary?.[h] ? ` — ${dataDictionary[h]}` : "";
    return `  ${h}${dict}: ${samples.join(", ")}`;
  }).join("\n");
  const pipeBlock = pipeline.length
    ? pipeline.map(s => `  [${s.type}]${s.col ? ` ${s.col}` : ""}`).join("\n")
    : "  (none)";

  const userPrompt =
    `DATASET COLUMNS:\n${colBlock}\n\n` +
    `CURRENT PIPELINE STEPS:\n${pipeBlock}\n\n` +
    `RESEARCHER QUESTION: ${question.trim()}\n\nReturn the JSON now.`;

  let raw;
  try {
    raw = await callClaude({ system: taskPrompt, user: userPrompt, maxTokens: 220, model: MODEL_FAST });
  } catch (err) {
    console.warn("[AIService] coachDispatch failed:", err.message);
    return null;
  }

  const cleaned = raw.replace(/```json\s*/gi, "").replace(/```\s*/g, "").trim();
  try {
    const parsed = JSON.parse(cleaned);
    const d = parsed?.dispatch;
    if (!d || typeof d !== "object") return null;
    // Validate col is an exact header match — never trust a fabricated name.
    if (!headers.includes(d.col)) return null;
    if (typeof d.instruction !== "string" || !d.instruction.trim()) return null;
    return {
      col: d.col,
      instruction: d.instruction.trim(),
      label: (typeof d.label === "string" && d.label.trim()) ? d.label.trim() : `Limpiar columna ${d.col}`,
    };
  } catch {
    return null; // parse failure → no dispatch (safe default)
  }
}

// ─── 6. INTERPRET MARGINAL EFFECTS ───────────────────────────────────────────
// Phase 11.5 — Interprets coefficient table + optional prediction point.
//
// model: { varNames, beta, se, pVals, label, spec }  (EstimationResult shape)
// dataDictionary: Record<string,string> | null
// prediction: { yhat, se, ciLow, ciHigh, xVec } | null
//
// Returns: Promise<string> — 1-2 plain-text paragraphs.

export async function interpretMarginalEffects({ model, dataDictionary = null, prediction = null }) {
  if (!model) throw new Error("No model provided.");

  const { varNames = [], beta = [], se = [], pVals = [] } = model;
  const modelLabel = model.label ?? model.modelLabel ?? "OLS";
  const yVar = model.spec?.yVar ?? model.yVar ?? "y";

  // Build coefficient table
  const coeffLines = varNames
    .filter(v => v !== "(Intercept)")
    .map(v => {
      const i = varNames.indexOf(v);
      const b = beta[i], s = se[i], p = pVals[i];
      const sig = p == null ? "p=N/A" : p < 0.01 ? "p<0.01***" : p < 0.05 ? "p<0.05**" : p < 0.1 ? "p<0.1*" : `p=${p.toFixed(3)} n.s.`;
      return `  ${v}: β=${b?.toFixed(4) ?? "N/A"}, SE=${s?.toFixed(4) ?? "N/A"}, ${sig}`;
    })
    .join("\n");

  const dictLines = (dataDictionary && Object.keys(dataDictionary).length)
    ? "\nDATA DICTIONARY:\n" + Object.entries(dataDictionary).map(([k, v]) => `  ${k}: "${v}"`).join("\n")
    : "";

  const predBlock = prediction
    ? `\nPREDICTION POINT:\n  ŷ = ${prediction.yhat?.toFixed(6) ?? "N/A"}, SE = ${prediction.se?.toFixed(6) ?? "N/A"}, 95% CI = [${prediction.ciLow?.toFixed(4) ?? "N/A"}, ${prediction.ciHigh?.toFixed(4) ?? "N/A"}]`
    : "";

  const userPrompt = `MODEL: ${modelLabel} | Dependent variable: ${yVar}\n\nCOEFFICIENT TABLE:\n${coeffLines}${dictLines}${predBlock}\n\nWrite the interpretation now.`;

  const taskPrompt = INTERPRET_MARGINAL_EFFECTS_PROMPT.replace(SHARED_CONTEXT, "").trim();
  try {
    return await callClaude({ system: taskPrompt, user: userPrompt, maxTokens: 500 });
  } catch (err) {
    console.warn("[AIService] interpretMarginalEffects failed:", err.message);
    throw err; // let caller show error — no mock needed here
  }
}

// ─── 6b. INTERPRET OPTIMIZATION (EQUATION WORKBENCH · Slice 9) ────────────────
// Term-by-term economic interpretation of a symbolic-first workbench session:
// objective(s), constraints, derivatives, FOCs, optima, λ shadow prices, params.
// Routes through callClaude (single egress choke point). §10.6: variable/symbol
// names pass through the privacy filter before egress. Premium-gated server-side.
export async function interpretOptimization({ session, results = {}, dataDictionary = null, piiConfig = {} }) {
  if (!session) throw new Error("No session provided.");

  const equations = Array.isArray(session.equations) ? session.equations : [];
  const params = Array.isArray(session.params) ? session.params : [];
  const objectives = equations.filter((e) => e.kind !== "constraint");
  const constraints = equations.filter((e) => e.kind === "constraint");
  if (!objectives.length) throw new Error("No objective to interpret.");

  // §10.6 — redact any PII-flagged symbol names before egress.
  const symbolNames = [
    ...params.map((p) => p.name),
    ...(Array.isArray(session.choiceVars) ? session.choiceVars : []),
  ].filter(Boolean);
  const { aliasMap, hasRedactions } = filterVariableNames(symbolNames, piiConfig);
  const alias = (s) => (typeof s === "string" && aliasMap[s]) || s;
  const redact = (txt) => {
    if (!txt || !hasRedactions) return txt;
    let out = txt;
    for (const [real, a] of Object.entries(aliasMap)) {
      out = out.split(real).join(a);
    }
    return out;
  };

  const fmt = (x) => (Number.isFinite(x) ? Number(x).toPrecision(4) : "N/A");

  const lines = [];

  objectives.forEach((eq) => {
    lines.push(`OBJECTIVE ${eq.label} (${eq.sense === "min" ? "minimize" : "maximize"}): ${redact(eq.expr)}`);
    const r = results[eq.id] || {};
    if (r.deriv?.symbolic?.expr) lines.push(`  derivative: ${redact(r.deriv.symbolic.expr)}`);
    if (r.solveZero?.symbolic?.expr) lines.push(`  FOC roots (symbolic): ${redact(r.solveZero.symbolic.expr)}`);
    if (r.solveZero?.numeric?.roots?.length) lines.push(`  FOC roots (numeric): ${r.solveZero.numeric.roots.map(fmt).join(", ")}`);
    const opt = r.optimize;
    if (opt) {
      const src = opt.source === "numeric-fallback" ? " [numeric-fallback]" : "";
      if (opt.symbolic?.expr) lines.push(`  optimum (symbolic)${src}: ${redact(opt.symbolic.expr)}`);
      const num = opt.numeric;
      if (num) {
        if (num.mode === "unconstrained") {
          lines.push(`  optimum (numeric): x* = ${fmt(num.x)}, f(x*) = ${fmt(num.value)} (${num.kind})`);
        } else {
          const choices = num.choices || {};
          const mults = num.multipliers || {};
          const cStr = Object.entries(choices).map(([k, v]) => `${alias(k)}* = ${fmt(v)}`).join(", ");
          const lStr = Object.entries(mults).map(([k, v]) => `λ(${redact(k.replace("lambda_", ""))}) = ${fmt(v)}`).join(", ");
          if (cStr) lines.push(`  optimum (numeric): ${cStr}`);
          if (lStr) lines.push(`  shadow prices: ${lStr}`);
          if (Number.isFinite(num.objectiveValue)) lines.push(`  objective value: ${fmt(num.objectiveValue)}`);
        }
      }
    }
  });

  if (constraints.length) {
    lines.push("CONSTRAINTS:");
    constraints.forEach((c) => {
      const rel = c.relation || {};
      lines.push(`  ${redact(rel.lhs || "")} ${rel.op || "="} ${redact(rel.rhs || "")}`);
    });
  }

  if (params.length) {
    lines.push("PARAMETERS:");
    params.forEach((p) => lines.push(`  ${alias(p.name)} = ${fmt(p.value)}`));
  }

  const dictLines = (dataDictionary && Object.keys(dataDictionary).length)
    ? "\nVARIABLE DICTIONARY:\n" + Object.entries(dataDictionary).map(([k, v]) => `  ${alias(k)}: "${v}"`).join("\n")
    : "";

  const userPrompt = `${lines.join("\n")}${dictLines}\n\nWrite the interpretation now.`;

  const taskPrompt = INTERPRET_OPTIMIZATION_PROMPT.replace(SHARED_CONTEXT, "").trim();
  try {
    return await callClaude({ system: taskPrompt, user: userPrompt, maxTokens: 650 });
  } catch (err) {
    console.warn("[AIService] interpretOptimization failed:", err.message);
    throw err;
  }
}

// ─── 7. GENERATE UNIFIED SCRIPT ──────────────────────────────────────────────
// Phase 9.10 — AI-polished, fully-documented replication script.
//
// sections: {
//   clean?:    string  — deterministic script from exporter.js generateCleanScript()
//   model?:    string  — model spec script (R/Stata/Python from CodeEditor)
//   calculate?: string — CalculateTab export script (optional)
//   simulate?:  string — SimulateTab export script (optional)
// }
// language: "r" | "stata" | "python"
// dataDictionary: Record<string,string> | null
//
// Returns: Promise<string> — the unified script text (no markdown fences).
// On failure: returns a fallback that concatenates the sections with headers.

export async function generateUnifiedScript(sections, language, dataDictionary = null, { snapshot = null, userInstruction = null, manualEditNote = null } = {}) {
  const langLabel = language === "r" ? "R" : language === "stata" ? "Stata" : "Python";
  const cmt       = language === "stata" ? "*" : "#";

  const sectionBlocks = [];

  if (sections.clean?.trim()) {
    sectionBlocks.push(`${cmt} ── SECTION: CLEAN ──\n${sections.clean.trim()}`);
  }
  if (sections.calculate?.trim()) {
    sectionBlocks.push(`${cmt} ── SECTION: CALCULATE ──\n${sections.calculate.trim()}`);
  }
  if (sections.simulate?.trim()) {
    sectionBlocks.push(`${cmt} ── SECTION: SIMULATE ──\n${sections.simulate.trim()}`);
  }
  if (sections.model?.trim()) {
    sectionBlocks.push(`${cmt} ── SECTION: MODEL ──\n${sections.model.trim()}`);
  }

  if (!sectionBlocks.length) {
    return `${cmt} No script sections available to unify.`;
  }

  const dictSection = (dataDictionary && Object.keys(dataDictionary).length)
    ? `\n\nDATA DICTIONARY:\n${Object.entries(dataDictionary).slice(0, 30).map(([k, v]) => `  ${k}: "${v}"`).join("\n")}`
    : "";

  // ── Session snapshot block (load opts, pipeline order, panel, etc.) ───────
  const snapshotBlk = snapshot ? `\n\nSESSION SNAPSHOT:\n${serializeSnapshot(snapshot)}` : "";
  // Multi-dataset sessions: one authoritative load call per dataset, each bound
  // to its df_<name> identifier. Single-dataset sessions keep the legacy hint.
  let loadHint = "";
  if (snapshot?.datasets?.length) {
    const calls = snapshot.datasets.map(d => {
      const cmt = language === "stata" ? "*" : "#";
      // Recipe-backed derive-children are rebuilt in-script from their parent —
      // a file load here would duplicate the dataset (and reference a file that
      // does not exist).
      if (d.derived) {
        return `  ${cmt} ${toDfVar(d.name)} is DERIVED in-script from its parent dataset — do not load it from a file.`;
      }
      // Datasets with no file extension on their name are produced INSIDE Litux
      // (spatial grids/results, or other in-app saves) — there is no source file
      // to read. Spatial outputs are regenerated by the deterministic "Spatial
      // operations" section appended to the script, so DON'T auto-load them.
      // Emit a do-not-load note plus a COMMENTED fallback the user can enable if
      // a given dataset turns out not to be reproduced elsewhere.
      const rawFile = d.filename ?? d.name;
      const hasExt  = /\.[A-Za-z0-9]+$/.test(rawFile);
      const dfv     = toDfVar(d.name);
      if (!hasExt) {
        const file = `${rawFile}.csv`;
        const load = language === "stata"
          ? buildStataLoadLine(file, d.loadOpts)
          : (language === "python" ? buildPyLoadLine(file, d.loadOpts) : buildRLoadLine(file, d.loadOpts)).replace(/^df\b/, dfv);
        return `  ${cmt} ${dfv} is produced inside Litux (e.g. a spatial grid/result) — it is regenerated by the Spatial operations section below; do NOT load it from a file.\n`
             + `  ${cmt} ${load}  ${cmt} <- uncomment ONLY if this dataset is not reproduced elsewhere (export it from Litux first)`;
      }
      if (language === "stata")  return `  ${buildStataLoadLine(rawFile, d.loadOpts)}`;
      const line = language === "python"
        ? buildPyLoadLine(rawFile, d.loadOpts)
        : buildRLoadLine(rawFile, d.loadOpts);
      return `  ${line.replace(/^df\b/, dfv)}`;
    });
    loadHint = `\n\nREQUIRED LOAD CALLS (${langLabel}) — emit ALL of these verbatim, one per session dataset:\n${calls.join("\n")}`;
  } else if (snapshot?.dataLoadOpts) {
    loadHint = `\n\nREQUIRED LOAD CALL (${langLabel}): ${loadOptsToScriptHint(snapshot.dataLoadOpts, language)}`;
  }

  // ── Structuring instruction (Fase 0.2) — how the user wants the script
  //    sectioned/presented. High priority: placed right after TARGET LANGUAGE.
  //    Prompt rule 9 honors it but never lets it override dependency order.
  const structureBlk = userInstruction?.trim()
    ? `\n\nSTRUCTURE INSTRUCTION:\n${userInstruction.trim()}`
    : "";

  // ── Manual-edit caveat (Fase 0.3, D2) — R/Stata sessions with cell edits.
  const manualEditBlk = manualEditNote?.trim()
    ? `\n\nMANUAL EDITS NOTE:\n${manualEditNote.trim()}`
    : "";

  const userPrompt = [
    `TARGET LANGUAGE: ${langLabel}`,
    structureBlk,
    manualEditBlk,
    dictSection,
    snapshotBlk,
    loadHint,
    `\nSECTION SCRIPTS:\n`,
    sectionBlocks.join("\n\n"),
    `\nGenerate the unified ${langLabel} replication script now.`,
  ].join("");

  // Fallback: plain concatenation with headers
  const fallback = () => {
    const header = [
      `${cmt} ${"─".repeat(70)}`,
      `${cmt} Litux — Unified Replication Script (${langLabel})`,
      `${cmt} Generated: ${new Date().toISOString().slice(0, 10)}`,
      `${cmt} ${"─".repeat(70)}`,
      "",
    ].join("\n");
    return header + sectionBlocks.join("\n\n");
  };

  try {
    const taskPrompt = UNIFIED_SCRIPT_PROMPT.replace(SHARED_CONTEXT, "").trim();
    return await callClaude({ system: taskPrompt, user: userPrompt, maxTokens: 6000 });
  } catch (err) {
    console.warn("[AIService] generateUnifiedScript failed:", err.message);
    return fallback();
  }
}
