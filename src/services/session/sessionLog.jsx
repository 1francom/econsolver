// ─── ECON STUDIO · services/session/sessionLog.jsx ───────────────────────────
// Lightweight cross-module operation log.
// Each module appends an entry when the user executes an operation so the
// Report AI can generate a faithful unified replication script.
//
// Shape of a log entry:
//   {
//     id:           string,   // crypto.randomUUID()
//     module:       "spatial" | "calculate" | "simulate",
//     timestamp:    number,   // Date.now()
//     opType:       string,   // e.g. "buffer_assign", "equation", "mc_run"
//     params:       object,   // everything needed to reproduce or describe
//     reproducible: boolean,  // true → emit code; false → emit comment
//     label:        string,   // human-readable one-liner
//   }

import { createContext, useContext, useState, useCallback, useEffect } from "react";
import { getTimeline, appendTimeline, saveTimeline } from "../Persistence/timeline.js";

const SessionLogContext = createContext(null);

// pid: project id — when provided, the log is the in-memory mirror of the
// persisted execution timeline (IDB `timeline_<pid>`): hydrated on mount,
// appended-through on every entry. Without pid it degrades to the legacy
// ephemeral in-memory log (Fase 1.2 of the replication-fidelity spec).
export function SessionLogProvider({ children, pid = null }) {
  const [log, setLog] = useState([]);

  // Hydrate from the persisted timeline once per project.
  useEffect(() => {
    if (!pid) return;
    let cancelled = false;
    getTimeline(pid)
      .then(events => { if (!cancelled && events.length) setLog(events); })
      .catch(() => {});
    return () => { cancelled = true; };
  }, [pid]);

  const appendLog = useCallback((entry) => {
    const full = {
      id:           crypto.randomUUID(),
      timestamp:    Date.now(),
      reproducible: true,
      ...entry,
    };
    setLog(prev => [...prev, full]);
    if (pid) appendTimeline(pid, full).catch(() => {});
  }, [pid]);

  const clearLog = useCallback(() => {
    setLog([]);
    if (pid) saveTimeline(pid, []).catch(() => {});
  }, [pid]);

  return (
    <SessionLogContext.Provider value={{ log, appendLog, clearLog }}>
      {children}
    </SessionLogContext.Provider>
  );
}

export function useSessionLog() {
  const ctx = useContext(SessionLogContext);
  if (!ctx) throw new Error("useSessionLog must be used inside SessionLogProvider");
  return ctx;
}

// Optional variant for components that may render outside the provider
// (tests/legacy embeds): returns a no-op appendLog instead of throwing.
const NOOP_CTX = { log: [], appendLog: () => {}, clearLog: () => {} };
export function useSessionLogOptional() {
  return useContext(SessionLogContext) ?? NOOP_CTX;
}
