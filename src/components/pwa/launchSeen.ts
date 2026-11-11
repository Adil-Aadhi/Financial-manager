/**
 * The launch splash plays once per app launch (a browsing session), including when that first
 * launch happens offline. Later full document loads in the same session (offline navigation
 * fallbacks, returning to Home) must not replay it. sessionStorage is cleared when the PWA is
 * closed, so a real cold launch animates again.
 */
export const LAUNCH_SEEN_KEY = "at:launch-seen";

/** Runs before first paint: hides the server-rendered splash if it was already shown. */
export const launchSeenScript = `try{if(sessionStorage.getItem("${LAUNCH_SEEN_KEY}")==="1")document.documentElement.setAttribute("data-launch-seen","1")}catch(e){}`;

export function hasSeenLaunch(): boolean {
  try {
    return sessionStorage.getItem(LAUNCH_SEEN_KEY) === "1";
  } catch {
    return false;
  }
}

export function markLaunchSeen() {
  try {
    sessionStorage.setItem(LAUNCH_SEEN_KEY, "1");
  } catch {
    // Storage can be blocked; the splash then behaves as before.
  }
}
