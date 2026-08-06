// ─── ECON STUDIO · components/panels/panelStackMath.js ────────────────────────
// Pure slot math for the floating-panel stack. Deliberately free of React so a
// node harness can exercise it — the component layer only registers panels and
// reads offsets back.

export const PANEL_MARGIN = 16; // gap from the viewport's bottom/right edge
export const PANEL_GAP    = 8;  // gap between two stacked panels

/**
 * @param {{id: string, height: number, tab: string|null}[]} panels
 *        Registration order. `tab` is the workspace tab that owns the panel, or
 *        null for an app-scoped panel that is always on screen.
 * @param {(string|null)[]} panes  Tabs currently rendered (App shows up to two,
 *        and carries a null for an unused pane).
 * @returns {Map<string, number|null>} id → bottom offset in px, null when hidden.
 *
 * A panel whose tab is off screen is still MOUNTED and still registered — App
 * hides tab panels with display:none rather than unmounting them, so their state
 * survives. It must therefore consume no vertical space, or the panels above it
 * float over an invisible gap.
 */
export function computeSlots(panels, panes = []) {
  const onScreen = panes ?? [];
  const slots = new Map();
  let bottom = PANEL_MARGIN;
  for (const p of panels ?? []) {
    // Only panels that HAVE a tab are membership-checked. An app-scoped panel
    // (tab === null) must not be matched against the nulls App puts in `panes`
    // for an unused pane.
    const visible = p.tab == null || onScreen.includes(p.tab);
    if (!visible) { slots.set(p.id, null); continue; }
    slots.set(p.id, bottom);
    bottom += p.height + PANEL_GAP;
  }
  return slots;
}
