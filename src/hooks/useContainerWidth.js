// ─── ECON STUDIO · hooks/useContainerWidth.js ──────────────────────────────
// Observes one element's content width with ResizeObserver.
// Returns null until the first measurement lands, so callers can avoid
// flashing a collapsed layout before the real width is known.
import { useEffect, useState } from "react";

export function useContainerWidth(ref) {
  const [width, setWidth] = useState(null);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const ro = new ResizeObserver(entries => {
      const w = entries[0]?.contentRect?.width;
      if (typeof w === "number") setWidth(w);
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, [ref]);

  return width;
}
