// ─── Fase X3 · Tasks 4 & 5 — LIVE evaluation (real API calls) ─────────────────
// NOT auto-run. Costs tokens. Requires a configured key / proxy.
// Run by opening the app with ?validation=faseX3live, or in the dev console:
//   await window.__liveEval.faseX3()
//
//   Task 4 — unit-inference accuracy: inferVariableUnits over the labeled fixture,
//            exact-match (normalized) accuracy; acceptance ≥ 95%. Misses are printed
//            so they can be pasted into faseX3UnitInferenceFixtures.json "discrepancies".
//   Task 5 — coefficient-narrative guardrails: interpretRegression per fixture, then
//            heuristic checks for sign inversion + invented/contradicted significance.
//            Heuristics flag suspects — the narratives are printed for HUMAN judgment.

import { inferVariableUnits, interpretRegression } from "../AIService.js";

const UNIT_URL = new URL("./faseX3UnitInferenceFixtures.json", import.meta.url);
const COEF_URL = new URL("./faseX3CoefNarrativeFixtures.json", import.meta.url);

const loadJSON = (url) => fetch(url).then(r => r.json());

// Normalize free text for token matching: lowercase, fold the km² superscript to
// "2", drop punctuation (keep digits + %), collapse whitespace.
const normTokens = (s) => String(s ?? "")
  .toLowerCase()
  .replace(/²/g, "2")
  .replace(/[^a-z0-9% ]+/g, " ")
  .replace(/\s+/g, " ")
  .trim();

// Dimension-aware grade: a fixture is a hit when EVERY accept group has ≥1
// synonym present as a substring of the normalized model answer (AND across
// groups, OR within a group). This grades the unit DIMENSION the model
// identified — currency/count/percent/proportion/years/distance/… — rather than
// exact prose, because inferVariableUnits emits descriptive strings, not the
// fixture's compact canonical label.
function gradeUnit(got, accept) {
  const hay = normTokens(got);
  if (!hay || !Array.isArray(accept) || accept.length === 0) return false;
  return accept.every(group => group.some(syn => hay.includes(normTokens(syn))));
}

// ── Task 4 ────────────────────────────────────────────────────────────────────
export async function runUnitInferenceEval() {
  const fx = await loadJSON(UNIT_URL);
  const vars = fx.variables;
  const headers = vars.map(v => v.name);
  const rows = [0, 1, 2].map(i => {
    const row = {};
    vars.forEach(v => { row[v.name] = v.samples[i % v.samples.length]; });
    return row;
  });

  const got = await inferVariableUnits(headers, rows);

  const misses = [];
  let hits = 0;
  for (const v of vars) {
    if (gradeUnit(got[v.name], v.accept)) hits++;
    else misses.push({
      name: v.name,
      expected: v.expected,
      accept: (v.accept || []).map(g => g.join("|")).join(" & "),
      got: got[v.name],
    });
  }

  const acc = hits / vars.length;
  console.log(`\n[X3 Task 4] unit-inference accuracy: ${(acc * 100).toFixed(1)}% (${hits}/${vars.length}) — dimension-aware token-group grading; acceptance ≥95%`);
  if (misses.length) {
    console.log("[X3 Task 4] misses (each is either a real wrong-dimension answer to fix in the prompt, OR a correct answer whose 'accept' tokens need widening):");
    console.table(misses);
  }
  return { task: 4, accuracy: acc, pass: acc >= 0.95, hits, total: vars.length, misses };
}

// ── Task 5 ────────────────────────────────────────────────────────────────────
const POS_RE = /\b(positive|increase|increases|increasing|higher|raise|raises|rise|rises|greater|more|grows|growth)\b/;
const NEG_RE = /\b(negative|decrease|decreases|decreasing|lower|reduce|reduces|fall|falls|less|fewer|decline|declines|reduction)\b/;
const SIG_RE = /\bsignificant\b/;
const NOTSIG_RE = /\b(not\s+significant|insignificant|statistically\s+insignificant|no\s+significant)\b/;

function sentencesMentioning(text, name) {
  const sents = text.split(/(?<=[.!?])\s+/);
  const n = name.toLowerCase();
  return sents.filter(s => s.toLowerCase().includes(n));
}

export async function runCoefNarrativeEval() {
  const fx = await loadJSON(COEF_URL);
  const out = [];

  for (const c of fx.cases) {
    let narrative = "";
    try {
      narrative = await interpretRegression(c.result, null, null, null);
    } catch (e) {
      out.push({ case: c.label, ok: false, note: `call failed: ${e.message}` });
      continue;
    }
    console.log(`\n──── [X3 Task 5] ${c.label} ────\n${narrative}\n`);

    const flags = [];
    // sign inversion
    for (const [v, want] of Object.entries(c.checks.sign || {})) {
      const sents = sentencesMentioning(narrative, v).join(" ").toLowerCase();
      if (!sents) { flags.push(`${v}: not mentioned`); continue; }
      const saysPos = POS_RE.test(sents);
      const saysNeg = NEG_RE.test(sents);
      if (want === "+" && saysNeg && !saysPos) flags.push(`${v}: expected + but narrative reads negative`);
      if (want === "-" && saysPos && !saysNeg) flags.push(`${v}: expected − but narrative reads positive`);
    }
    // significance contradictions
    for (const v of c.checks.significant || []) {
      const sents = sentencesMentioning(narrative, v).join(" ").toLowerCase();
      if (NOTSIG_RE.test(sents)) flags.push(`${v}: expected significant but narrative says NOT significant`);
    }
    for (const v of c.checks.notSignificant || []) {
      const sents = sentencesMentioning(narrative, v).join(" ").toLowerCase();
      if (SIG_RE.test(sents) && !NOTSIG_RE.test(sents)) flags.push(`${v}: expected NOT significant but narrative claims significant`);
    }

    out.push({ case: c.label, ok: flags.length === 0, note: flags.join("; ") || "no heuristic flags (still review narrative)" });
  }

  console.log("\n[X3 Task 5] heuristic guardrail summary (HUMAN REVIEW REQUIRED):");
  console.table(out);
  return { task: 5, results: out };
}

export async function runFaseX3LiveEval() {
  const t4 = await runUnitInferenceEval();
  const t5 = await runCoefNarrativeEval();
  return { t4, t5 };
}

if (typeof window !== "undefined") {
  window.__liveEval = window.__liveEval ?? {};
  window.__liveEval.faseX3 = runFaseX3LiveEval;
}
