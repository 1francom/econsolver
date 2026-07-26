// ─── ECON STUDIO · workspace/SplitDivider.jsx ──────────────────────────────
// Draggable divider between two panes. Windows-snap behaviour: free drag, a
// magnetic zone at the centre, double-click resets to 50/50, and dragging a
// pane below the minimum width closes it instead of shrinking it to nothing.
import { useEffect, useRef } from "react";
import { useTheme } from "../../ThemeContext.jsx";

const SNAP_ZONE = 0.02;   // fraction of width around 0.5 that snaps to centre
const MIN_PANE  = 360;    // px — below this a pane closes rather than shrink

export default function SplitDivider({ ratio, onRatio, onClosePane, containerRef }) {
  const { C } = useTheme();
  const dragging = useRef(false);

  useEffect(() => {
    function onMove(e) {
      if (!dragging.current) return;
      const el = containerRef.current;
      if (!el) return;
      const r = el.getBoundingClientRect();
      if (r.width <= 0) return;

      let next = (e.clientX - r.left) / r.width;
      if (Math.abs(next - 0.5) < SNAP_ZONE) next = 0.5;

      const minRatio = MIN_PANE / r.width;
      if (next < minRatio)     { dragging.current = false; onClosePane(0); return; }
      if (next > 1 - minRatio) { dragging.current = false; onClosePane(1); return; }
      onRatio(next);
    }
    function onUp() {
      if (!dragging.current) return;
      dragging.current = false;
      document.body.style.cursor = "";
      document.body.style.userSelect = "";
    }
    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", onUp);
    return () => {
      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("mouseup", onUp);
    };
  }, [onRatio, onClosePane, containerRef]);

  return (
    <div
      onMouseDown={() => {
        dragging.current = true;
        document.body.style.cursor = "col-resize";
        document.body.style.userSelect = "none";
      }}
      onDoubleClick={() => onRatio(0.5)}
      title="Drag to resize · double-click to reset to 50/50"
      style={{
        position: "absolute", top: 0, bottom: 0, zIndex: 10,
        left: `calc(${ratio * 100}% - 3px)`, width: 6,
        background: C.border, cursor: "col-resize",
      }}
      onMouseEnter={e => { e.currentTarget.style.background = C.teal; }}
      onMouseLeave={e => { e.currentTarget.style.background = C.border; }}
    />
  );
}
