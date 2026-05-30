import { useState, useEffect, useRef, useCallback } from "react";
import { useTheme } from "../../../ThemeContext.jsx";
import SessionTabs from "./SessionTabs.jsx";
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

  // Mutate the active session immutably.
  const updateActive = useCallback((mutator) => {
    setSessions((prev) => prev.map((s) => (s.id === (activeId ?? prev[0]?.id) ? mutator(s) : s)));
  }, [activeId]);

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
          <div style={{ fontSize: 11, color: C.textDim || "#888" }}>Equations + parameters land here (Tasks 4–5).</div>
        </div>
        <div data-wb-right>
          <div style={{ fontSize: 11, color: C.textDim || "#888" }}>Canvas + results land here (Tasks 7–8).</div>
        </div>
      </div>

      {/* updateActive is wired to child panels in later tasks; referenced here to keep lint quiet. */}
      <span style={{ display: "none" }} data-wb-active={active.id} ref={() => void updateActive} />
    </div>
  );
}
