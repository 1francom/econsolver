// ─── ECON STUDIO · utils/nextPaint.js ────────────────────────────────────────
// Resolves after the browser has painted the current state. Await it between
// `setRunning(true)` and a synchronous computation: React's state update is
// only drawn once the main thread is free, so without this the "running…"
// indicator never appears — the UI just freezes and then jumps to the result.
export function nextPaint() {
  return new Promise(resolve => {
    if (typeof requestAnimationFrame !== "function") { setTimeout(resolve, 0); return; }
    requestAnimationFrame(() => setTimeout(resolve, 0));
  });
}
