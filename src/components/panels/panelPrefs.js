// ─── ECON STUDIO · components/panels/panelPrefs.js ────────────────────────────
// Per-project floating-panel UI state.
//
// Every key is scoped by pid. Unscoped sessionStorage is how project state bled
// between projects before (see CLAUDE.md's "project state bleed" entry), so this
// is an invariant rather than a nicety.

const key = (pid, name) => `litux:panel_${name}:${pid ?? "none"}`;

export function readPanelPref(pid, name, fallback) {
  if (!pid) return fallback;
  try {
    const raw = sessionStorage.getItem(key(pid, name));
    return raw == null ? fallback : JSON.parse(raw);
  } catch {
    return fallback;
  }
}

export function writePanelPref(pid, name, value) {
  if (!pid) return;
  try {
    sessionStorage.setItem(key(pid, name), JSON.stringify(value));
  } catch {
    // Private-mode quota failures must never break the panel.
  }
}
