// Browser harness for workbenchStore factories + validator.
// Exposes window.__validation.workbenchStore() -> { cells, allPass }.
// No IndexedDB round-trip here (that needs a live DB); pure shape checks.
import {
  newSession, newEquation, validateSession, validateSessions,
} from "../../components/calculate/workbench/workbenchStore.js";

export function runWorkbenchStoreValidation() {
  const cells = [];

  // Cell 1: newSession has the §3 shape with one fresh id.
  {
    const s = newSession();
    const pass = typeof s.id === "string" && Array.isArray(s.equations)
      && Array.isArray(s.params) && Array.isArray(s.choiceVars)
      && Array.isArray(s.view.xRange) && s.view.xRange.length === 2;
    cells.push({ name: "newSession-shape", expected: "§3 shape", got: Object.keys(s), pass });
  }

  // Cell 2: newEquation defaults — objective, plot on, max.
  {
    const e = newEquation();
    const pass = e.kind === "objective" && e.ops.plot === true
      && e.ops.deriv === false && e.sense === "max" && e.relation.op === "=";
    cells.push({ name: "newEquation-defaults", expected: "objective/plot/max", got: e, pass });
  }

  // Cell 3: validateSession drops a malformed equation and coerces bad fields.
  {
    const dirty = {
      id: "s1", name: 123, // bad type -> coerced
      equations: [
        null,                                   // dropped
        { expr: "A*K^a", kind: "weird", sense: "sideways" }, // coerced
      ],
      params: [{ name: "A", value: "nope" }],   // value coerced to 1
      choiceVars: ["K", 5],                      // 5 dropped
      view: { xRange: [0, 5], positiveQuad: false },
    };
    const v = validateSession(dirty);
    const eq = v.equations[0];
    const pass = v.equations.length === 1
      && eq.kind === "objective" && eq.sense === "max"
      && v.params[0].value === 1
      && v.choiceVars.length === 1 && v.choiceVars[0] === "K"
      && v.view.positiveQuad === false;
    cells.push({ name: "validate-coerce-drop", expected: "1 eq, sanitized", got: v, pass });
  }

  // Cell 4: validateSessions on non-array returns [].
  {
    const pass = Array.isArray(validateSessions("garbage")) && validateSessions("garbage").length === 0;
    cells.push({ name: "validate-nonarray", expected: "[]", got: validateSessions("garbage"), pass });
  }

  // Cell 5: expr length is bounded (defense-in-depth §10.5).
  {
    const big = "x+".repeat(400) + "x"; // > 512 chars
    const v = validateSession({ equations: [{ expr: big }] });
    const pass = v.equations[0].expr.length <= 512;
    cells.push({ name: "expr-bounded", expected: "<=512", got: v.equations[0].expr.length, pass });
  }

  const allPass = cells.every((c) => c.pass);
  return { cells, allPass };
}

if (typeof window !== "undefined") {
  window.__validation = window.__validation || {};
  window.__validation.workbenchStore = runWorkbenchStoreValidation;
}
