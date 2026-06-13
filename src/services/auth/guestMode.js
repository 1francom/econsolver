// ─── GUEST MODE ───────────────────────────────────────────────────────────────
// Lets a visitor use Litux without an account ("try without signing up").
// The entire core (Data/Clean/Model/Spatial/Report) runs locally on IndexedDB
// and never needs a Supabase user — only cloud sync does. Guest mode simply lets
// the app render with no user; guest work persists locally like any session.
//
// The flag lives in localStorage so it survives reloads and tab close on this
// browser (matches "guest data persists locally"). The website CTA opens the app
// with `?guest=1`; consumeGuestParam() turns that into the persistent flag.

const KEY = "litux_guest";

export function isGuest() {
  try {
    return localStorage.getItem(KEY) === "1";
  } catch {
    return false;
  }
}

export function enterGuest() {
  try {
    localStorage.setItem(KEY, "1");
  } catch {
    // localStorage unavailable (private mode quota, etc.) — guest mode just
    // won't persist across reloads, which is acceptable.
  }
}

export function exitGuest() {
  try {
    localStorage.removeItem(KEY);
  } catch {
    // ignore
  }
}

// Reads `?guest=1` from the URL once, promotes it to the persistent flag, then
// strips the param so refreshes and bookmarks stay clean. Returns true if the
// param was present.
export function consumeGuestParam() {
  if (typeof window === "undefined") return false;
  let params;
  try {
    params = new URLSearchParams(window.location.search);
  } catch {
    return false;
  }
  if (params.get("guest") !== "1") return false;

  enterGuest();
  params.delete("guest");
  const q = params.toString();
  const url = window.location.pathname + (q ? `?${q}` : "") + window.location.hash;
  try {
    window.history.replaceState({}, "", url);
  } catch {
    // history API unavailable — harmless, the flag is already set.
  }
  return true;
}
