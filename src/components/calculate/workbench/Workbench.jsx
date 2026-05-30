import { useState, useEffect, useRef, useCallback, useMemo } from "react";
import { useTheme } from "../../../ThemeContext.jsx";
import SessionTabs from "./SessionTabs.jsx";
import EquationsPanel from "./EquationsPanel.jsx";
import ParametersPanel from "./ParametersPanel.jsx";
import { cas } from "../../../math/cas/casAdapter.js";
import { newSession, loadWorkbench, saveWorkbench, flushWorkbench } from "./workbenchStore.js";

const mono = "'IBM Plex Mono', monospace";

export default function Workbench({ pid }) {
  const { C } = useTheme();
  const storeKey = pid ?? "scratch";
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

  if (!active) return null;

  return (
    <div style={{ fontFamily: mono, color: C.text, border: `1px solid ${C.line || "#222"}`,
      borderRadius: 10, padding: "1.2rem 1.4rem", marginBottom: "2rem",
      background: "linear-gradient(180deg, " + (C.panel || "#0d0d0d") + ", " + C.bg + ")" }}>

      <div style={{ display: "flex", alignItems: "baseline", gap: 12, marginBottom: 12 }}>
        <div style={{ fontSize: 9, color: C.teal, letterSpacing: "0.26em", textTransform: "uppercase" }}>Equation Workbench</div>
        <div style={{ fontSize: 11, color: C.textDim || "#888" }}>symbolic-first · solve · plot · differentiate · optimize</div>
      </div>

      <SessionTabs
        sessions={sessions} activeId={active.id}
        onSelect={setActiveId} onAdd={addSession}
        onRename={renameSession} onClose={closeSession} />

      {/* Three-panel layout placeholder — filled by Tasks 4–8. */}
      <div style={{ display: "grid", gridTemplateColumns: "minmax(0,1fr) minmax(0,1.2fr)", gap: 14 }}>
        <div data-wb-left>
          <EquationsPanel
            equations={active.equations}
            onAdd={addEquation} onPatch={patchEquation} onRemove={removeEquation} />
          <ParametersPanel
            detectedSymbols={detectedSymbols}
            params={active.params} choiceVars={active.choiceVars}
            onParamChange={onParamChange} onToggleRole={onToggleRole} />
        </div>
        <div data-wb-right>
          <div style={{ fontSize: 11, color: C.textDim || "#888" }}>Canvas + results land here (Tasks 7–8).</div>
        </div>
      </div>
    </div>
  );
}
