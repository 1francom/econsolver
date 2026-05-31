// Domain wrapper over services/persistence/indexedDB.js for Equation Workbench
// sessions. Pure JS, no React. Owns the §3 JSON factories, the §10.5
// untrusted-on-read validator, and a debounced autosave.
import {
  loadWorkbenchRecord,
  saveWorkbenchRecord,
} from "../../../services/Persistence/indexedDB.js";

let _seq = 0;
const uid = (p) => `${p}_${Date.now().toString(36)}_${(_seq++).toString(36)}`;

// ── Factories (§3 session model) ──────────────────────────────────────────────

export function newEquation(overrides = {}) {
  return {
    id: uid("eq"),
    label: "f",
    expr: "",
    kind: "objective",          // "objective" | "constraint"
    axis: "",                   // x-axis symbol (objectives only)
    color: null,                // curve color override (#rrggbb); null → palette
    optColor: null,             // optimum-marker color override; null → red
    ops: { plot: true, deriv: false, integral: false, solveZero: false, optimize: false },
    integralRange: null,        // [a, b] integration bounds; null → use view.xRange
    integralRef: null,          // welfare reference y; null → plain area under curve
    sense: "max",               // "max" | "min"
    relation: { lhs: "", op: "=", rhs: "" }, // constraint only
    ...overrides,
  };
}

// Intersection condition: solve (lhs) = (rhs) for the w.r.t variable(s).
// lhs/rhs are short refs ("1", "1'", a literal like "0"/"100"). wrt is
// comma-separated variable names.
export function newCondition(overrides = {}) {
  return { id: uid("cond"), lhs: "", rhs: "", wrt: "", enabled: true, ...overrides };
}

export function newSession(overrides = {}) {
  return {
    id: uid("ses"),
    name: "Session 1",
    equations: [],
    params: [],                 // [{ name, value, min, max, step }]
    choiceVars: [],
    view: { xRange: [0.01, 10], yRange: null, positiveQuad: true, height: 460,
            xLabel: "", yLabel: "", refLines: [], annotations: [] },
    // Comparative statics: sweep one parameter; null param → feature dormant.
    sweep: { param: null, from: null, to: null, steps: 5, showFamily: true, locus: "off" },
    conditions: [],             // [{ id, lhs, rhs, wrt, enabled }] — intersection/FOC conditions
    results: {},                // { [equationId]: { [op]: ResultContract } }
    ...overrides,
  };
}

// ── Validation (§10.5 — treat stored JSON as untrusted) ───────────────────────

const OPS = ["plot", "deriv", "integral", "solveZero", "optimize"];

function isFiniteNum(x) { return typeof x === "number" && Number.isFinite(x); }
function str(x, fallback = "") { return typeof x === "string" ? x : fallback; }
function hexColor(x) { return typeof x === "string" && /^#[0-9a-fA-F]{6}$/.test(x) ? x.toLowerCase() : null; }

function validateEquation(raw) {
  if (!raw || typeof raw !== "object") return null;
  const base = newEquation();
  const ops = {};
  for (const k of OPS) ops[k] = !!(raw.ops && raw.ops[k]);
  const rel = raw.relation && typeof raw.relation === "object" ? raw.relation : {};
  const ir = Array.isArray(raw.integralRange) && raw.integralRange.length === 2
    && isFiniteNum(raw.integralRange[0]) && isFiniteNum(raw.integralRange[1])
    ? [raw.integralRange[0], raw.integralRange[1]] : null;
  return {
    id: str(raw.id, base.id),
    label: str(raw.label, "f").slice(0, 24),
    expr: str(raw.expr, "").slice(0, 512),   // bounded; re-parsed through cas downstream
    kind: raw.kind === "constraint" ? "constraint" : "objective",
    axis: str(raw.axis, ""),
    color: hexColor(raw.color),
    optColor: hexColor(raw.optColor),
    ops,
    integralRange: ir,
    integralRef: isFiniteNum(raw.integralRef) ? raw.integralRef : null,
    sense: raw.sense === "min" ? "min" : "max",
    relation: { lhs: str(rel.lhs, "").slice(0, 256), op: "=", rhs: str(rel.rhs, "").slice(0, 256) },
  };
}

function validateParam(raw) {
  if (!raw || typeof raw !== "object" || typeof raw.name !== "string") return null;
  return {
    name: raw.name.slice(0, 24),
    value: isFiniteNum(raw.value) ? raw.value : 1,
    min: isFiniteNum(raw.min) ? raw.min : 0,
    max: isFiniteNum(raw.max) ? raw.max : 10,
    step: isFiniteNum(raw.step) && raw.step > 0 ? raw.step : 0.1,
  };
}

export function validateSession(raw) {
  if (!raw || typeof raw !== "object") return null;
  const base = newSession();
  const equations = Array.isArray(raw.equations)
    ? raw.equations.map(validateEquation).filter(Boolean)
    : [];
  const params = Array.isArray(raw.params)
    ? raw.params.map(validateParam).filter(Boolean)
    : [];
  const choiceVars = Array.isArray(raw.choiceVars)
    ? raw.choiceVars.filter((v) => typeof v === "string").map((v) => v.slice(0, 24))
    : [];
  const view = raw.view && typeof raw.view === "object" ? raw.view : {};
  const xr = Array.isArray(view.xRange) && view.xRange.length === 2
    && isFiniteNum(view.xRange[0]) && isFiniteNum(view.xRange[1])
    ? [view.xRange[0], view.xRange[1]] : base.view.xRange;
  const yr = Array.isArray(view.yRange) && view.yRange.length === 2
    && isFiniteNum(view.yRange[0]) && isFiniteNum(view.yRange[1])
    ? [view.yRange[0], view.yRange[1]] : null;
  const height = isFiniteNum(view.height)
    ? Math.min(900, Math.max(240, view.height)) : base.view.height;
  const refLines = Array.isArray(view.refLines)
    ? view.refLines
        .filter((l) => l && typeof l === "object" && (l.kind === "v" || l.kind === "h") && isFiniteNum(l.value))
        .slice(0, 12)
        .map((l) => ({ kind: l.kind, value: l.value, label: str(l.label, "").slice(0, 24) }))
    : [];
  const annotations = Array.isArray(view.annotations)
    ? view.annotations
        .filter((a) => a && typeof a === "object" && isFiniteNum(a.x) && isFiniteNum(a.y))
        .slice(0, 24)
        .map((a) => ({ id: str(a.id, uid("ann")), x: a.x, y: a.y, text: str(a.text, "").slice(0, 64), color: hexColor(a.color) }))
    : [];
  const sw = raw.sweep && typeof raw.sweep === "object" ? raw.sweep : {};
  const sweep = {
    param: typeof sw.param === "string" && sw.param ? sw.param.slice(0, 24) : null,
    from: isFiniteNum(sw.from) ? sw.from : null,
    to: isFiniteNum(sw.to) ? sw.to : null,
    steps: isFiniteNum(sw.steps) ? Math.min(12, Math.max(2, Math.round(sw.steps))) : 5,
    showFamily: sw.showFamily !== false,
    locus: sw.locus === "argmax" || sw.locus === "value" ? sw.locus : "off",
  };
  const conditions = Array.isArray(raw.conditions)
    ? raw.conditions
        .filter((c) => c && typeof c === "object")
        .slice(0, 12)
        .map((c) => ({
          id: str(c.id, uid("cond")),
          lhs: str(c.lhs, "").slice(0, 64),
          rhs: str(c.rhs, "").slice(0, 64),
          wrt: str(c.wrt, "").slice(0, 64),
          enabled: c.enabled !== false,
        }))
    : [];
  return {
    id: str(raw.id, base.id),
    name: str(raw.name, "Session").slice(0, 40),
    equations,
    params,
    choiceVars,
    view: { xRange: xr, yRange: yr, positiveQuad: view.positiveQuad !== false, height,
            xLabel: str(view.xLabel, "").slice(0, 48), yLabel: str(view.yLabel, "").slice(0, 48), refLines, annotations },
    sweep,
    conditions,
    results: {}, // never trust cached results; recompute live
  };
}

export function validateSessions(rawSessions) {
  if (!Array.isArray(rawSessions)) return [];
  return rawSessions.map(validateSession).filter(Boolean);
}

// ── Load / save ───────────────────────────────────────────────────────────────

export async function loadWorkbench(pid) {
  const rec = await loadWorkbenchRecord(pid);
  const sessions = validateSessions(rec?.sessions);
  return sessions.length ? sessions : [newSession()];
}

// NOTE: single module-level timer (one Workbench is mounted at a time).
// Callers MUST flushWorkbench before switching pid to avoid dropping a pending save.
let _saveTimer = null;
export function saveWorkbench(pid, sessions, { debounceMs = 500 } = {}) {
  if (_saveTimer) clearTimeout(_saveTimer);
  _saveTimer = setTimeout(() => {
    _saveTimer = null;
    saveWorkbenchRecord(pid, sessions).catch((e) =>
      console.error("[workbenchStore] save failed:", e),
    );
  }, debounceMs);
}

// Flush immediately (e.g. on unmount). Returns the save promise.
export function flushWorkbench(pid, sessions) {
  if (_saveTimer) { clearTimeout(_saveTimer); _saveTimer = null; }
  return saveWorkbenchRecord(pid, sessions);
}
