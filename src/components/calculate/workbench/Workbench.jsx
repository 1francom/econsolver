import { useState, useEffect, useRef, useCallback, useMemo } from "react";
import { useTheme } from "../../../ThemeContext.jsx";
import SessionTabs from "./SessionTabs.jsx";
import EquationsPanel from "./EquationsPanel.jsx";
import ParametersPanel from "./ParametersPanel.jsx";
import { cas } from "../../../math/cas/casAdapter.js";
import { newSession, newCondition, loadWorkbench, saveWorkbench, flushWorkbench } from "./workbenchStore.js";
import WorkbenchCanvas from "./WorkbenchCanvas.jsx";
import { runCard, runSweepFamily, runSweepLocus, runConditions } from "./operations.js";
import ResultsPanel from "./ResultsPanel.jsx";
import SweepPanel from "./SweepPanel.jsx";
import ConditionsPanel from "./ConditionsPanel.jsx";
import LocusCanvas from "./LocusCanvas.jsx";
import ViewControls from "./ViewControls.jsx";
import { buildWorkbenchScript } from "./exportScript.js";

const mono = "'IBM Plex Mono', monospace";

export default function Workbench({ pid }) {
  const { C } = useTheme();
  const storeKey = pid || "scratch";
  const [sessions, setSessions] = useState([newSession()]);
  const [activeId, setActiveId] = useState(null);
  const loadedRef = useRef(false);
  const sessionsRef = useRef(sessions);
  useEffect(() => { sessionsRef.current = sessions; }, [sessions]);

  // Load on mount / pid change.
  useEffect(() => {
    let cancelled = false;
    loadedRef.current = false;
    loadWorkbench(storeKey).then((loaded) => {
      if (cancelled) return;
      setSessions(loaded);
      setActiveId(loaded[0]?.id ?? null);
      loadedRef.current = true;
    });
    return () => { cancelled = true; };
  }, [storeKey]);

  // Debounced autosave after first load.
  useEffect(() => {
    if (!loadedRef.current) return;
    saveWorkbench(storeKey, sessions);
  }, [sessions, storeKey]);

  // Flush on unmount.
  useEffect(() => () => {
    if (loadedRef.current) flushWorkbench(storeKey, sessionsRef.current).catch(() => {});
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const active = sessions.find((s) => s.id === activeId) || sessions[0];

  // Detected free symbols across all cards, minus each objective's axis. Memoized
  // so a card's local re-render (e.g. the copied-flash) doesn't re-parse every expr.
  const detectedSymbols = useMemo(() => {
    if (!active) return [];
    const axes = new Set(active.equations.filter((e) => e.kind !== "constraint").map((e) => e.axis).filter(Boolean));
    const set = new Set();
    for (const e of active.equations) {
      const src = e.kind === "constraint"
        ? `(${e.relation.lhs}) - (${e.relation.rhs})`
        : e.expr;
      if (!src || !src.trim()) continue;
      try { for (const sym of cas.freeSymbols(src)) set.add(sym); } catch { /* skip */ }
    }
    for (const a of axes) set.delete(a);
    return Array.from(set).sort();
  }, [active]);

  // Track nerdamer CDN readiness so results recompute once the backend loads.
  const [casReady, setCasReady] = useState(false);
  useEffect(() => { cas.ready().then(() => setCasReady(true)).catch(() => {}); }, []);

  // Escalation to the SymPy/Pyodide backend (§5.3). Bumping casBackend forces a
  // results recompute once the heavier exact solver is active.
  const [casBackend, setCasBackend] = useState(cas.backend());
  const [escalating, setEscalating] = useState(false);
  const [escalateError, setEscalateError] = useState(null);
  const escalate = useCallback(async () => {
    if (cas.backend() === "sympy") return;
    setEscalating(true);
    setEscalateError(null);
    try {
      await cas.escalate();
      setCasBackend("sympy");
    } catch (e) {
      setEscalateError(e?.message || "failed to load exact solver");
    } finally {
      setEscalating(false);
    }
  }, []);

  // Live results: recompute every active op on every card when the session changes
  // or once nerdamer finishes loading.
  const results = useMemo(() => {
    const out = {};
    if (!active) return out;
    for (const eq of active.equations) {
      try { out[eq.id] = runCard(eq, active); } catch { out[eq.id] = {}; }
    }
    return out;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [active.equations, active.params, active.choiceVars, active.view, casReady, casBackend]);

  // Comparative-statics family of curves (Step 1), computed separately so it
  // never bloats the per-op results object.
  const family = useMemo(() => {
    if (!active) return null;
    try { return runSweepFamily(active); } catch { return null; }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [active.equations, active.params, active.view, active.sweep, casReady, casBackend]);

  // Comparative-statics optimum locus (Step 2): x* / f(x*) vs the swept param.
  const locus = useMemo(() => {
    if (!active) return null;
    try { return runSweepLocus(active); } catch { return null; }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [active.equations, active.params, active.view, active.sweep, casReady, casBackend]);

  // Named-equation intersection / FOC conditions (item C). Recomputed on any
  // equation/param/condition change; markers flow into the canvas.
  const conditionResults = useMemo(() => {
    if (!active) return [];
    try { return runConditions(active); } catch { return []; }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [active.equations, active.params, active.conditions, active.view, casReady, casBackend]);

  // Equation names available to reference inside conditions.
  const equationNames = useMemo(
    () => Array.from(new Set(active.equations.map((e) => (e.label || "").trim()).filter(Boolean))),
    [active.equations],
  );

  // Mutate the active session immutably.
  const updateActive = useCallback((mutator) => {
    setSessions((prev) => prev.map((s) => (s.id === (activeId ?? prev[0]?.id) ? mutator(s) : s)));
  }, [activeId]);

  // Equation CRUD on the active session.
  const addEquation = useCallback((eq) =>
    updateActive((s) => ({ ...s, equations: [...s.equations, eq] })), [updateActive]);
  const patchEquation = useCallback((id, patch) =>
    updateActive((s) => ({ ...s, equations: s.equations.map((e) => (e.id === id ? { ...e, ...patch } : e)) })), [updateActive]);
  const removeEquation = useCallback((id) =>
    updateActive((s) => ({ ...s, equations: s.equations.filter((e) => e.id !== id) })), [updateActive]);

  // Parameter slider + role toggle.
  const onParamChange = useCallback((name, patch) =>
    updateActive((s) => {
      const exists = s.params.some((p) => p.name === name);
      const params = exists
        ? s.params.map((p) => (p.name === name ? { ...p, ...patch } : p))
        : [...s.params, { name, value: 1, min: 0, max: 10, step: 0.1, ...patch }];
      return { ...s, params };
    }), [updateActive]);
  const onToggleRole = useCallback((name) =>
    updateActive((s) => {
      const isChoice = s.choiceVars.includes(name);
      return { ...s, choiceVars: isChoice ? s.choiceVars.filter((v) => v !== name) : [...s.choiceVars, name] };
    }), [updateActive]);

  // Plot view (x limits / graph height).
  const onViewChange = useCallback((patch) =>
    updateActive((s) => ({ ...s, view: { ...s.view, ...patch } })), [updateActive]);

  // Comparative-statics sweep config.
  const onSweepChange = useCallback((patch) =>
    updateActive((s) => ({ ...s, sweep: { ...s.sweep, ...patch } })), [updateActive]);

  // Condition CRUD on the active session. New condition seeds w.r.t with the
  // first objective's axis as a sensible default.
  const addCondition = useCallback(() =>
    updateActive((s) => {
      const obj = s.equations.find((e) => e.kind !== "constraint");
      return { ...s, conditions: [...(s.conditions || []), newCondition({ wrt: obj?.axis || "" })] };
    }), [updateActive]);
  const patchCondition = useCallback((id, patch) =>
    updateActive((s) => ({ ...s, conditions: (s.conditions || []).map((c) => (c.id === id ? { ...c, ...patch } : c)) })), [updateActive]);
  const removeCondition = useCallback((id) =>
    updateActive((s) => ({ ...s, conditions: (s.conditions || []).filter((c) => c.id !== id) })), [updateActive]);

  function addSession() {
    const s = newSession({ name: `Session ${sessions.length + 1}` });
    setSessions((prev) => [...prev, s]);
    setActiveId(s.id);
  }
  function renameSession(id, name) {
    setSessions((prev) => prev.map((s) => (s.id === id ? { ...s, name } : s)));
  }
  function closeSession(id) {
    setSessions((prev) => {
      const next = prev.filter((s) => s.id !== id);
      const safe = next.length ? next : [newSession()];
      if (id === activeId) setActiveId(safe[0].id);
      return safe;
    });
  }

  // Export the active session's equations as a reproducible script.
  function exportScript(lang) {
    const ext = lang === "r" ? "R" : lang === "stata" ? "do" : "py";
    const text = buildWorkbenchScript(lang, active);
    const a = document.createElement("a");
    a.href = URL.createObjectURL(new Blob([text], { type: "text/plain" }));
    a.download = `workbench.${ext}`;
    a.click();
    URL.revokeObjectURL(a.href);
  }

  if (!active) return null;

  return (
    <div style={{ fontFamily: mono, color: C.text, border: `1px solid ${C.border2}`,
      borderRadius: 10, padding: "1.2rem 1.4rem", marginBottom: "2rem",
      background: "linear-gradient(180deg, " + C.surface + ", " + C.bg + ")" }}>

      <div style={{ display: "flex", alignItems: "baseline", gap: 12, marginBottom: 12 }}>
        <div style={{ fontSize: 9, color: C.teal, letterSpacing: "0.26em", textTransform: "uppercase" }}>Equation Workbench</div>
        <div style={{ fontSize: 11, color: C.textDim || "#888" }}>symbolic-first · solve · plot · differentiate · optimize</div>
        <div style={{ marginLeft: "auto", display: "flex", gap: 6 }}>
          {[["↓R", "r", C.gold], ["↓Stata", "stata", C.teal], ["↓py", "python", C.blue]].map(([label, lang, color]) => (
            <button key={lang} onClick={() => exportScript(lang)}
              title={`Export equations as ${label.replace("↓", "")} script`}
              style={{ fontSize: 10, padding: "3px 8px", borderRadius: 4, cursor: "pointer",
                background: "transparent", color, border: `1px solid ${color}`, fontFamily: mono }}>
              {label}
            </button>
          ))}
        </div>
      </div>

      <SessionTabs
        sessions={sessions} activeId={active.id}
        onSelect={setActiveId} onAdd={addSession}
        onRename={renameSession} onClose={closeSession} />

      {/* Top: inputs (left) + outputs (right). Bottom: full-width plot. */}
      <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
        <div style={{ display: "grid", gridTemplateColumns: "minmax(0,1fr) minmax(0,1fr)", gap: 14, alignItems: "start" }}>
          <div data-wb-inputs>
            <EquationsPanel
              equations={active.equations} view={active.view}
              onAdd={addEquation} onPatch={patchEquation} onRemove={removeEquation} />
            <ParametersPanel
              detectedSymbols={detectedSymbols}
              params={active.params} choiceVars={active.choiceVars}
              onParamChange={onParamChange} onToggleRole={onToggleRole} />
            <SweepPanel
              detectedSymbols={detectedSymbols.filter((s) => !active.choiceVars.includes(s))}
              params={active.params} sweep={active.sweep} onChange={onSweepChange} />
            <ConditionsPanel
              conditions={active.conditions} results={conditionResults} names={equationNames}
              onAdd={addCondition} onPatch={patchCondition} onRemove={removeCondition} />
          </div>
          <div data-wb-outputs>
            <ResultsPanel session={active} equations={active.equations} results={results}
              backend={casBackend} escalating={escalating} escalateError={escalateError} onEscalate={escalate} />
          </div>
        </div>
        <div data-wb-canvas>
          <ViewControls view={active.view} onChange={onViewChange} />
          <WorkbenchCanvas equations={active.equations} results={results} family={family}
            conditions={conditionResults} view={active.view} height={active.view.height} />
          {locus && <LocusCanvas locus={locus} />}
        </div>
      </div>
    </div>
  );
}
