// Backend-agnostic facade (§5.1). App code imports ONLY `cas`, never a backend.
import { nerdamerBackend } from "./nerdamerBackend.js";

let active = nerdamerBackend;          // default backend (Plan 1)
let readyPromise = null;

export const cas = {
  backend() { return active.name; },
  ready() {
    if (!readyPromise) readyPromise = active.ready();
    return readyPromise;
  },
  parse(src) { return active.parse(src); },
  freeSymbols(e) { return active.freeSymbols(e); },
  toLatex(e) { return active.toLatex(e); },
  evalAt(e, scope) { return active.evalAt(e, scope); },
  diff(e, v) { return active.diff(e, v); },
  simplify(e) { return active.simplify(e); },
  // solve / solveSystem / lagrangianFOC / substitute / compile added in later tasks
};

// For the SymPy escalation (backend B), expose a setter behind the same surface.
export function _setCasBackend(backend) { active = backend; readyPromise = null; }
