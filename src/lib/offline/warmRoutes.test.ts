import { readFileSync } from "node:fs";
import { beforeEach, describe, expect, it } from "vitest";
import { offlineDb } from "./db";
import { FIXED_OFFLINE_ROUTES, LEDGER_ENTRY_ROUTE, LEDGER_ROUTES, createOnDemandRouteWarmer, type RouteWarmerEnv } from "./warmRoutes";

/** The startup list exactly as it was before the Personal Ledger existed. */
const ORIGINAL_STARTUP_ROUTES = [
  "/home", "/transactions", "/categories", "/trash", "/reports", "/settings",
  "/daily-budget", "/subscriptions", "/bills", "/installments",
];

describe("startup page warming", () => {
  it("is exactly the list from before the Personal Ledger: existing pages unchanged, no ledger page", () => {
    expect([...FIXED_OFFLINE_ROUTES]).toEqual(ORIGINAL_STARTUP_ROUTES);
    expect(FIXED_OFFLINE_ROUTES.some((route) => route.startsWith("/ledger"))).toBe(false);
  });

  it("the provider that runs at startup uses that list and mentions no ledger page", () => {
    const source = readFileSync("src/components/offline/OfflineDataProvider.tsx", "utf8");
    expect(source).toContain('import { FIXED_OFFLINE_ROUTES } from "@/lib/offline/warmRoutes"');
    expect(source).not.toMatch(/["'`]\/ledger/);
    // The warming itself is unchanged: same message, same version-keyed signature, same delay.
    expect(source).toContain('type: "CACHE_ROUTES"');
    expect(source).toContain("ROUTE_WARM_DELAY_MS = 2_000");
    expect(source).toContain('const ROUTE_WARM_VERSION = "account-tracker-shell-v2"');
    expect(source).toContain("...FIXED_OFFLINE_ROUTES,");
  });

  it("the on-demand warmer never touches the offline database, sync or snapshot code", () => {
    const source = readFileSync("src/lib/offline/warmRoutes.ts", "utf8");
    for (const forbidden of ["offline/db", "offline/sync", "offline/bootstrap", "offline/mutations", "setTimeout", "setInterval"]) {
      expect(source).not.toContain(forbidden);
    }
  });
});

function makeEnv(overrides: Partial<RouteWarmerEnv> = {}) {
  const posted: string[][] = [];
  const checked: string[] = [];
  const env: RouteWarmerEnv = {
    isProduction: () => true,
    isOnline: () => true,
    isVisible: () => true,
    hasCached: async (route) => {
      checked.push(route);
      return false;
    },
    postToWorker: async (routes) => {
      posted.push(routes);
      return true;
    },
    ...overrides,
  };
  return { env, posted, checked };
}

describe("on-demand ledger warming", () => {
  it("warms only the page asked for, not all six", async () => {
    const { env, posted } = makeEnv();
    const warm = createOnDemandRouteWarmer(env, LEDGER_ROUTES);
    expect(await warm([LEDGER_ENTRY_ROUTE])).toEqual(["/ledger"]);
    expect(posted).toEqual([["/ledger"]]);
  });

  it("warms a section page when the user shows intent to open it, one page at a time", async () => {
    const { env, posted } = makeEnv();
    const warm = createOnDemandRouteWarmer(env, LEDGER_ROUTES);
    await warm(["/ledger"]);
    await warm(["/ledger/people"]);
    expect(posted).toEqual([["/ledger"], ["/ledger/people"]]);
  });

  it("repeated navigation and repeated triggers create no further requests", async () => {
    const { env, posted } = makeEnv();
    const warm = createOnDemandRouteWarmer(env, LEDGER_ROUTES);
    await warm(["/ledger"]);
    await warm(["/ledger"]);
    await warm(["/ledger", "/ledger"]);
    // Two triggers at the same moment also collapse into one request.
    await Promise.all([warm(["/ledger/dues"]), warm(["/ledger/dues"]), warm(["/ledger/dues"])]);
    expect(posted).toEqual([["/ledger"], ["/ledger/dues"]]);
  });

  it("skips a page the browser already has stored, so a previously cached page stays as it is", async () => {
    const { env, posted } = makeEnv({ hasCached: async (route) => route === "/ledger/payments" });
    const warm = createOnDemandRouteWarmer(env, LEDGER_ROUTES);
    expect(await warm(["/ledger/payments"])).toEqual([]);
    expect(posted).toEqual([]);
    expect(await warm(["/ledger/payments", "/ledger/people"])).toEqual(["/ledger/people"]);
  });

  it("does nothing offline, in the background, or outside a production build", async () => {
    for (const blocked of [{ isOnline: () => false }, { isVisible: () => false }, { isProduction: () => false }]) {
      const { env, posted, checked } = makeEnv(blocked);
      const warm = createOnDemandRouteWarmer(env, LEDGER_ROUTES);
      expect(await warm(["/ledger"])).toEqual([]);
      expect(posted).toEqual([]);
      expect(checked).toEqual([]);
    }
  });

  it("only ever warms ledger pages, never an account, transaction or arbitrary route", async () => {
    const { env, posted } = makeEnv();
    const warm = createOnDemandRouteWarmer(env, LEDGER_ROUTES);
    expect(await warm(["/transactions", "/home", "/accounts/1", "/ledger/../home", "/api/x"])).toEqual([]);
    expect(posted).toEqual([]);
  });

  describe("a warming failure", () => {
    it("never throws, whatever fails", async () => {
      for (const broken of [
        { postToWorker: async () => { throw new Error("worker gone"); } },
        { hasCached: async () => { throw new Error("cache unavailable"); } },
        { isOnline: () => { throw new Error("no navigator"); } },
      ] satisfies Array<Partial<RouteWarmerEnv>>) {
        const { env } = makeEnv(broken);
        await expect(createOnDemandRouteWarmer(env, LEDGER_ROUTES)([ "/ledger" ])).resolves.toEqual([]);
      }
    });

    it("leaves the page free to be asked for again (it loads normally and can be warmed later)", async () => {
      let attempt = 0;
      const posted: string[][] = [];
      const { env } = makeEnv({
        postToWorker: async (routes) => {
          attempt += 1;
          if (attempt === 1) return false; // no service worker yet
          posted.push(routes);
          return true;
        },
      });
      const warm = createOnDemandRouteWarmer(env, LEDGER_ROUTES);
      expect(await warm(["/ledger"])).toEqual([]);
      expect(await warm(["/ledger"])).toEqual(["/ledger"]);
      expect(posted).toEqual([["/ledger"]]);
    });
  });
});

describe("warming does not touch the sync queue or local data", () => {
  const ownerId = "11111111-1111-4111-8111-111111111111";

  beforeEach(async () => {
    await offlineDb.delete();
    await offlineDb.open();
    await offlineDb.outbox.add({
      opId: "op-1", ownerId, entity: "transaction", entityId: "t1", op: "CREATE", payload: {}, baseUpdatedAt: null,
      createdAt: "x", updatedAt: "x", status: "failed", attempts: 2, error: "boom",
    });
  });

  it("leaves the outbox, retry state and snapshot rows exactly as they were, even when warming fails", async () => {
    const before = await offlineDb.outbox.toArray();
    const { env } = makeEnv({ postToWorker: async () => { throw new Error("nope"); } });
    const warm = createOnDemandRouteWarmer(env, LEDGER_ROUTES);
    for (const route of LEDGER_ROUTES) await warm([route]);
    expect(await offlineDb.outbox.toArray()).toEqual(before);
    expect(await offlineDb.accounts.count()).toBe(0);
    expect(await offlineDb.transactions.count()).toBe(0);
  });
});
