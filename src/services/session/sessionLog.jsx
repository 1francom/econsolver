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

import { createContext, useContext, useState, useCallback } from "react";

const SessionLogContext = createContext(null);

export function SessionLogProvider({ children }) {
  const [log, setLog] = useState([]);

  const appendLog = useCallback((entry) => {
    setLog(prev => [...prev, {
      id:           crypto.randomUUID(),
      timestamp:    Date.now(),
      reproducible: true,
      ...entry,
    }]);
  }, []);

  const clearLog = useCallback(() => setLog([]), []);

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
