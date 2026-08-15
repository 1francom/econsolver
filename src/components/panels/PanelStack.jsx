// ─── ECON STUDIO · components/panels/PanelStack.jsx ───────────────────────────
// Registry for floating panels. Panels live in different React trees — one
// inside WranglingModule, one at App level — so they cannot coordinate through
// layout. This context is the only place that knows about all of them at once.
//
// The provider is given App's `panes` and decides visibility itself, so no
// component has to thread an "am I the active tab" boolean down through the
// tree to reach a panel.

import { createContext, useContext, useState, useCallback, useMemo, useEffect } from "react";
import { computeSlots, PANEL_MARGIN } from "./panelStackMath.js";

const PanelStackContext = createContext(null);

export function PanelStackProvider({ panes = [], children }) {
  const [panels, setPanels] = useState([]); // registration order

  const register = useCallback((id, height, tab) => {
    setPanels(prev => {
      const i = prev.findIndex(p => p.id === id);
      if (i === -1) return [...prev, { id, height, tab }];
      // Bail out when nothing changed. This runs on every panel render, and an
      // unconditional setState here would loop forever.
      if (prev[i].height === height && prev[i].tab === tab) return prev;
      const next = prev.slice();
      next[i] = { id, height, tab };
      return next;
    });
  }, []);

  const unregister = useCallback((id) => {
    setPanels(prev => prev.filter(p => p.id !== id));
  }, []);

  // `panes` is App state, so its identity is stable between renders unless the
  // pane layout actually changes.
  const slots = useMemo(() => computeSlots(panels, panes), [panels, panes]);
  const value = useMemo(() => ({ register, unregister, slots }), [register, unregister, slots]);

  return <PanelStackContext.Provider value={value}>{children}</PanelStackContext.Provider>;
}

/**
 * Register a panel and read back its bottom offset in px.
 *
 * Returns PANEL_MARGIN when the panel is hidden or the provider is absent — in
 * both cases the value is unobservable, so the fallback is arbitrary but safe.
 * It never returns null, so callers do not need their own guard.
 */
export function usePanelSlot(id, height, tab = null) {
  const ctx = useContext(PanelStackContext);
  const register   = ctx?.register;
  const unregister = ctx?.unregister;
  useEffect(() => {
    if (!register || !unregister) return;
    register(id, height, tab);
    return () => unregister(id);
  }, [register, unregister, id, height, tab]);
  return ctx?.slots.get(id) ?? PANEL_MARGIN;
}
