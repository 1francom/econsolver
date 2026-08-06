// ─── ECON STUDIO · components/panels/FloatingPanel.jsx ────────────────────────
// Floating, non-modal, minimizable frame. Unlike AuditTrail.jsx's full-screen
// dimmed overlay this does NOT block the rest of the UI — the point is to stay
// visible as a reference while the user keeps working elsewhere.
//
// Presentational only: it does not know what it displays or where it is mounted.
//
// SCOPE IS THE MOUNT POINT, not a prop:
//   * mounted inside a module → inherits that module's display:none, so it hides
//     when the user leaves and returns with its state intact
//   * mounted in PanelHost (App level) → no display:none reaches it, so it
//     follows the user across tabs
// The `tab` prop below is NOT that decision — it only tells the stack registry
// whether this panel currently occupies a slot.

import { useTheme } from "../../ThemeContext.jsx";
import { usePanelSlot } from "./PanelStack.jsx";
import { PANEL_MARGIN } from "./panelStackMath.js";

const TITLE_BAR_HEIGHT = 30;
// Minimized, the panel shows only its title and buttons, so it has no reason to
// keep a wide panel's width — it would sit there as a long empty strip.
const MINIMIZED_WIDTH = 230;

/**
 * @param id          stable id used by the stack registry
 * @param tab         workspace tab that owns this panel, or null for app-scoped
 * @param title       left-hand label in the title bar
 * @param meta        optional right-hand muted label (counts, position, …)
 * @param width       px, default 320
 * @param bodyHeight  px of scrollable body when expanded, default 320
 */
export default function FloatingPanel({
  id, tab = null, title, meta = null,
  width = 320, bodyHeight = 320,
  minimized, onToggleMinimize, onClose, children,
}) {
  const { C, T } = useTheme();
  const height = minimized ? TITLE_BAR_HEIGHT : TITLE_BAR_HEIGHT + bodyHeight;
  // Never null: usePanelSlot already collapses the hidden case to PANEL_MARGIN.
  const bottom = usePanelSlot(id, height, tab);
  const shownWidth = minimized ? Math.min(width, MINIMIZED_WIDTH) : width;

  return (
    <div style={{
      position: "fixed", bottom, right: PANEL_MARGIN, zIndex: 900,
      width: shownWidth, maxWidth: `calc(100vw - ${PANEL_MARGIN * 2}px)`,
      transition: "width 0.12s",
      background: C.bg, border: `1px solid ${C.border2}`, borderRadius: 5,
      boxShadow: "0 8px 28px #000a", overflow: "hidden",
      fontFamily: T.code.fontFamily,
    }}>
      <div style={{
        display: "flex", alignItems: "center", gap: 8,
        padding: "0.5rem 0.7rem", background: C.surface,
        borderBottom: minimized ? "none" : `1px solid ${C.border}`,
        cursor: "default",
      }}>
        <span style={{
          fontSize: T.caption.fontSize, color: C.teal, letterSpacing: "0.1em",
          textTransform: "uppercase", flex: 1,
          overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap",
        }}>{title}</span>
        {meta && (
          <span style={{ fontSize: T.caption.fontSize, color: C.textMuted }}>{meta}</span>
        )}
        <button onClick={onToggleMinimize} title={minimized ? "Expand" : "Minimize"}
          style={{ background: "none", border: "none", color: C.textDim, cursor: "pointer", fontSize: 13, padding: "0 4px" }}>
          {minimized ? "▢" : "—"}
        </button>
        <button onClick={onClose} title="Close"
          style={{ background: "none", border: "none", color: C.textDim, cursor: "pointer", fontSize: 13, padding: "0 4px" }}>
          ✕
        </button>
      </div>
      {!minimized && (
        <div style={{ maxHeight: bodyHeight, overflowY: "auto" }}>{children}</div>
      )}
    </div>
  );
}
