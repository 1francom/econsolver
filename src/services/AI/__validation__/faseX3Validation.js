// ─── Fase X3 · AI Service Hardening — deterministic audit harness ─────────────
// Browser harness (mocks globalThis.fetch). Run in dev console:
//   await window.__validation.faseX3()
//
// Covers the auto-runnable acceptance gates:
//   Task 1 — prompt caching audit  (SHARED_CONTEXT cached block + ≥per-model min tok + beta header)
//   Task 2 — model routing         (haiku / sonnet-4-6 / opus-4-7 per call shape)
//   Task 3 — privacy filter audit  (no raw PII in any outbound request body)
//   Task 6 — LocalAI shape contract (documented return shapes — consumers can't crash)
//
// Tasks 4 (unit-inference accuracy) and 5 (coef-narrative guardrails) require LIVE
// API calls + human judgment → see faseX3LiveEval.js, run manually with a key.
//
// NOTE vs plan (2026-05-22): the plan's Task 2 model IDs were stale. Current routing
// per AIService.js is haiku-4-5 (units) / sonnet-4-6 (narratives) / opus-4-7 (coach
// specialist). This harness asserts against the live constants, not the plan text.

import {
  inferVariableUnits,
  interpretRegression,
  suggestCleaning,
  compareModels,
  nlToPipeline,
  researchCoach,
} from "../AIService.js";
import { SHARED_CONTEXT } from "../Prompts/index.js";
import * as LocalAI from "../LocalAI.js";

// Models expected on the wire (mirror AIService.js constants).
const M_FAST    = "claude-haiku-4-5-20251001";
const M_MAIN    = "claude-sonnet-4-6";
const M_ADVISOR = "claude-opus-4-7";

// ── seeded PII fixture ────────────────────────────────────────────────────────
const PII = {
  name:    "Johnathan Smith",
  email:   "jsmith@example.com",
  phone:   "+1 415 555 0199",
  address: "742 Evergreen Terrace",
  income:  5234.56,
};
const PII_HEADERS = ["respondent_name", "contact_email", "monthly_income", "region", "gdp_growth"];
const PII_ROWS = [
  { respondent_name: PII.name,            contact_email: PII.email,          monthly_income: PII.income, region: "Bavaria", gdp_growth: 2.1 },
  { respondent_name: "Maria Gonzalez",    contact_email: "mg@test.org",      monthly_income: 4180.22,    region: "Hesse",   gdp_growth: 1.7 },
  { respondent_name: "Wei Chen",          contact_email: "wchen@mail.net",   monthly_income: 6720.91,    region: "Saxony",  gdp_growth: 2.4 },
];

// ── fetch mock ────────────────────────────────────────────────────────────────
function mockResponse(bodyObj) {
  if (bodyObj.stream) {
    const enc = new TextEncoder();
    const sse =
      'data: {"type":"content_block_delta","delta":{"type":"text_delta","text":"ok"}}\n\n' +
      'data: [DONE]\n\n';
    const stream = new ReadableStream({ start(c) { c.enqueue(enc.encode(sse)); c.close(); } });
    return new Response(stream, { status: 200, headers: { "Content-Type": "text/event-stream" } });
  }
  // Non-stream: "{}" parses as JSON for object/array-parsing callers and is harmless
  // free text for narrative callers.
  return new Response(JSON.stringify({ content: [{ type: "text", text: "{}" }] }), {
    status: 200, headers: { "Content-Type": "application/json" },
  });
}

function installMock() {
  const calls = [];
  const orig = globalThis.fetch;
  globalThis.fetch = async (url, opts = {}) => {
    const u = String(url);
    // Let Supabase / auth traffic fall through to a benign empty response.
    if (!u.includes("anthropic")) {
      return new Response(JSON.stringify({}), { status: 200, headers: { "Content-Type": "application/json" } });
    }
    let body = {};
    try { body = opts.body ? JSON.parse(opts.body) : {}; } catch { /* ignore */ }
    calls.push({ url: u, headers: opts.headers || {}, body });
    return mockResponse(body);
  };
  return { calls, restore: () => { globalThis.fetch = orig; } };
}

// ── assertions on a captured Anthropic call ───────────────────────────────────
const estTokens = (s) => Math.ceil((s || "").length / 4);
// Anthropic min cacheable prefix: 2048 tokens for Haiku, 1024 for Sonnet/Opus.
// Only the cache_control-bearing block (system[0] = SHARED_CONTEXT) is cached,
// so the cached block alone — NOT the combined system — must clear the minimum.
const cacheMinTok = (model) => /haiku/i.test(model || "") ? 2048 : 1024;

function auditCaching(call) {
  const sys = call.body.system;
  const isArr = Array.isArray(sys) && sys.length >= 1;
  const cached = isArr ? sys[0] : null;
  const isDirect = call.url.includes("api.anthropic.com");
  const cachedText = cached?.text || "";
  return {
    hasCachedBlock:  !!cached && cached.cache_control?.type === "ephemeral",
    cachedIsShared:  !!cached && cached.text === SHARED_CONTEXT,
    tokensOk:        estTokens(cachedText) >= cacheMinTok(call.body.model),
    headerOk:        isDirect ? call.headers["anthropic-beta"] === "prompt-caching-2024-07-31" : true,
    isDirect,
  };
}

export async function runFaseX3Validation() {
  const results = [];
  const cell = (name, ok, detail = "") => results.push({ cell: name, ok: !!ok, detail });

  const { calls, restore } = installMock();
  try {
    // ── exercise each public call shape, capturing its outbound request ────────
    const grab = async (fn) => { calls.length = 0; await fn(); return [...calls]; };

    const cUnits = await grab(() => inferVariableUnits(PII_HEADERS, PII_ROWS));
    const cInterp = await grab(() => interpretRegression(
      { varNames: ["(Intercept)", "x1"], beta: [0.1, 0.5], se: [0.05, 0.1], pVals: [0.2, 0.01], R2: 0.4, n: 100,
        spec: { yVar: "y", xVars: ["x1"] } },
      null, null, PII_ROWS,
    ));
    const cClean = await grab(() => suggestCleaning({
      meta: { nRows: 100, nCols: 3, completeness: 0.9, numericCols: 2, categoricalCols: 1, mixedCols: 0 },
      flags: [], columns: [], correlations: [],
    }));
    const cCompare = await grab(() => compareModels([
      { label: "A", varNames: ["x1"], beta: [0.5], se: [0.1], pVals: [0.01], n: 100, spec: { yVar: "y" } },
      { label: "B", varNames: ["x1"], beta: [0.3], se: [0.1], pVals: [0.04], n: 100, spec: { yVar: "y" } },
    ]));
    const cNl = await grab(() => nlToPipeline({ command: "log of income", columns: [{ name: "income", dtype: "number", samples: [1, 2] }] }));
    const cCoach = await grab(() => researchCoach({ question: "Is my instrument valid?", modelResult: { varNames: ["x1"], beta: [0.5], se: [0.1], pVals: [0.01], spec: { yVar: "y", xVars: ["x1"] } } }));

    // ── Task 1: caching on EVERY captured call ─────────────────────────────────
    const allCalls = [...cUnits, ...cInterp, ...cClean, ...cCompare, ...cNl, ...cCoach];
    cell("calls captured", allCalls.length >= 6, `${allCalls.length} anthropic requests`);
    let cachedAll = true, sharedAll = true, tokAll = true, hdrAll = true, anyDirect = false;
    for (const c of allCalls) {
      const a = auditCaching(c);
      cachedAll = cachedAll && a.hasCachedBlock;
      sharedAll = sharedAll && a.cachedIsShared;
      tokAll    = tokAll && a.tokensOk;
      hdrAll    = hdrAll && a.headerOk;
      anyDirect = anyDirect || a.isDirect;
    }
    cell("caching: SHARED_CONTEXT block is system[0] w/ ephemeral cache_control", cachedAll);
    cell("caching: cached block text === SHARED_CONTEXT", sharedAll);
    cell("caching: cached block clears per-model min (2048 Haiku / 1024 Sonnet-Opus, est)", tokAll);
    cell(anyDirect ? "caching: anthropic-beta header on direct calls" : "caching: header N/A (proxy mode — added server-side)", hdrAll);

    // ── Task 2: model routing determinism ──────────────────────────────────────
    cell("routing: inferVariableUnits → haiku", cUnits.every(c => c.body.model === M_FAST), modelsOf(cUnits));
    cell("routing: interpretRegression → sonnet-4-6", cInterp.every(c => c.body.model === M_MAIN), modelsOf(cInterp));
    cell("routing: suggestCleaning → sonnet-4-6", cClean.every(c => c.body.model === M_MAIN), modelsOf(cClean));
    cell("routing: compareModels → sonnet-4-6", cCompare.every(c => c.body.model === M_MAIN), modelsOf(cCompare));
    cell("routing: nlToPipeline → sonnet-4-6", cNl.every(c => c.body.model === M_MAIN), modelsOf(cNl));
    // researchCoach: one opus specialist (non-stream) + one sonnet stream
    cell("routing: researchCoach specialist → opus-4-7", cCoach.some(c => !c.body.stream && c.body.model === M_ADVISOR), modelsOf(cCoach));
    cell("routing: researchCoach narrative stream → sonnet-4-6", cCoach.some(c => c.body.stream && c.body.model === M_MAIN), modelsOf(cCoach));

    // ── Task 3: privacy filter — no raw PII in any outbound body ────────────────
    const leak = (callsArr) => {
      const blob = JSON.stringify(callsArr.map(c => c.body));
      return [PII.name, PII.email, PII.phone, PII.address, String(PII.income)].filter(s => blob.includes(s));
    };
    const unitsLeak = leak(cUnits);
    cell("privacy: inferVariableUnits emits no raw PII", unitsLeak.length === 0, unitsLeak.join(", "));
    const interpLeak = leak(cInterp);
    cell("privacy: interpretRegression (no-row-data path) emits no raw PII", interpLeak.length === 0, interpLeak.join(", "));

    // ── Task 3 (mechanism): the choke point callAI now uses, verified directly ──
    const { detectPII } = await import("../../Privacy/piiDetector.js");
    const { filterSampleRows } = await import("../../Privacy/privacyFilter.js");
    const safeVals = (col, vals) => {
      const rows = vals.map(v => ({ [col]: v }));
      const cfg = detectPII([col], rows);
      const { rows: out } = filterSampleRows([col], rows, cfg);
      return out.map(r => { const k = Object.keys(r)[0]; return k === undefined ? undefined : r[k]; }).filter(v => v !== undefined);
    };
    cell("privacy: HIGH col (name) → 0 sample values egress", safeVals("respondent_name", [PII.name, "x", "y"]).length === 0);
    cell("privacy: HIGH col (email) → 0 sample values egress", safeVals("contact_email", [PII.email, "a@b.co", "c@d.eu"]).length === 0);
    const incomeSafe = safeVals("monthly_income", [PII.income, 4180.22, 6720.91]);
    cell("privacy: MEDIUM col (income) → values masked/rounded (≠ raw)", incomeSafe.length > 0 && !incomeSafe.includes(PII.income));
    cell("privacy: NONE col (gdp_growth) → passthrough", JSON.stringify(safeVals("gdp_growth", [2.1, 1.7, 2.4])) === JSON.stringify([2.1, 1.7, 2.4]));

    // ── Task 6: LocalAI documented shape contracts ─────────────────────────────
    const ns = LocalAI.normalizeStrings(["Berlin", "berlin", "Munich"]);
    cell("LocalAI.normalizeStrings → {clusters[], map{}}", Array.isArray(ns.clusters) && ns.map && typeof ns.map === "object");
    const pf = LocalAI.detectPII([{ c: "a@b.com" }, { c: "d@e.com" }, { c: "f@g.com" }], ["c"]);
    cell("LocalAI.detectPII → PIIFlag[] w/ {col,matchType,confidence}", Array.isArray(pf) && pf.every(f => "col" in f && "matchType" in f && "confidence" in f));
    const ms = LocalAI.inferMissingStrategy("income", { naPct: 0.1, isNum: true, mean: 5, std: 1, median: 5, uCount: 50 });
    cell("LocalAI.inferMissingStrategy → {strategy,rationale}", typeof ms.strategy === "string" && typeof ms.rationale === "string");
    const so = LocalAI.scoreOutliers([1, 2, 3, 4, 100]);
    cell("LocalAI.scoreOutliers → {iqrCount,recommendation,...}", typeof so.iqrCount === "number" && typeof so.recommendation === "string");
    const st = LocalAI.suggestColumnType(["1", "2", "3"]);
    cell("LocalAI.suggestColumnType → {type,confidence,castable}", typeof st.type === "string" && typeof st.confidence === "number" && typeof st.castable === "boolean");
  } finally {
    restore();
  }

  const passed = results.filter(r => r.ok).length;
  console.log(`faseX3: ${passed}/${results.length} checks pass`);
  console.table(results.map(r => ({ cell: r.cell, ok: r.ok, detail: r.detail })));
  return results;
}

function modelsOf(callsArr) {
  return callsArr.map(c => `${c.body.stream ? "stream:" : ""}${c.body.model}`).join(" | ");
}

if (typeof window !== "undefined") {
  window.__validation = window.__validation ?? {};
  window.__validation.faseX3 = runFaseX3Validation;
}
