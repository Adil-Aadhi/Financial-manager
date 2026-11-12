/**
 * Which pages the app warms (stores for offline use), and when.
 *
 * FIXED_OFFLINE_ROUTES are warmed once per page load for every signed-in user (OfflineDataProvider).
 * It is exactly the list the app had before the Personal Ledger existed: the ledger's six pages are
 * NOT in it, so users who never open the ledger cost the server nothing extra at startup.
 *
 * Ledger pages are warmed on demand instead (createOnDemandRouteWarmer below): the entry page when
 * the ledger is opened and its data is on this device, and a section page when the user shows
 * intent to open it. It uses the same service-worker message as startup warming (CACHE_ROUTES), so
 * the worker's own caching, concurrency limit and sign-out cleanup apply unchanged.
 */

export const FIXED_OFFLINE_ROUTES = [
  "/home",
  "/transactions",
  "/categories",
  "/trash",
  "/reports",
  "/settings",
  "/daily-budget",
  "/subscriptions",
  "/bills",
  "/installments",
] as const;

export const LEDGER_ENTRY_ROUTE = "/ledger";
export const LEDGER_ROUTES = [
  "/ledger",
  "/ledger/recurring",
  "/ledger/expenses",
  "/ledger/dues",
  "/ledger/people",
  "/ledger/payments",
] as const;

export interface RouteWarmerEnv {
  /** Page warming only runs in production builds, like startup warming. */
  isProduction(): boolean;
  isOnline(): boolean;
  isVisible(): boolean;
  /** Whether the browser already has this page stored (any cache). */
  hasCached(route: string): Promise<boolean>;
  /** Asks the service worker to store these pages. false when there is no worker to ask. */
  postToWorker(routes: string[]): Promise<boolean>;
}

/**
 * A warmer for an allow-list of pages. Each page is requested at most once per page load, pages the
 * browser already has are skipped, and nothing it does can throw: a failure just means the page is
 * not stored yet and loads normally (and can be asked for again later). It never touches the
 * offline database, the outbox or the snapshot, and uses no timers.
 */
export function createOnDemandRouteWarmer(env: RouteWarmerEnv, allowed: readonly string[]) {
  const requested = new Set<string>();

  return async function warm(routes: readonly string[]): Promise<string[]> {
    try {
      if (!env.isProduction() || !env.isOnline() || !env.isVisible()) return [];

      const fresh = [...new Set(routes)].filter((route) => allowed.includes(route) && !requested.has(route));
      // Claim the pages before awaiting, so two quick triggers can't request the same page twice.
      fresh.forEach((route) => requested.add(route));

      const missing: string[] = [];
      for (const route of fresh) {
        if (!(await env.hasCached(route))) missing.push(route);
      }
      if (missing.length === 0) return [];

      const posted = await env.postToWorker(missing);
      if (!posted) {
        missing.forEach((route) => requested.delete(route)); // allow a later attempt
        return [];
      }
      return missing;
    } catch {
      // Warming is an optimisation. Never let it surface as an error.
      return [];
    }
  };
}

/** The real browser wiring. */
const browserEnv: RouteWarmerEnv = {
  isProduction: () => process.env.NODE_ENV === "production",
  isOnline: () => typeof navigator !== "undefined" && navigator.onLine,
  isVisible: () => typeof document !== "undefined" && document.visibilityState === "visible",
  hasCached: async (route) => {
    if (typeof window === "undefined" || !("caches" in window)) return false;
    return !!(await window.caches.match(route, { ignoreVary: true }));
  },
  postToWorker: async (routes) => {
    if (typeof navigator === "undefined" || !("serviceWorker" in navigator)) return false;
    const registration = await navigator.serviceWorker.ready;
    const worker = navigator.serviceWorker.controller ?? registration.active;
    if (!worker) return false;
    worker.postMessage({ type: "CACHE_ROUTES", routes });
    return true;
  },
};

/** Warms Personal Ledger pages on demand. Safe to call from anywhere on a ledger page. */
export const warmLedgerRoutes = createOnDemandRouteWarmer(browserEnv, LEDGER_ROUTES);
