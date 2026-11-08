"use client";

import React, { useEffect } from "react";
import { liveQuery, type Subscription } from "dexie";
import { ensureOfflineBootstrap } from "@/lib/offline/bootstrap";
import { createClient } from "@/lib/supabase/client";
import { offlineDb } from "@/lib/offline/db";
import { getActiveOwnerId, setActiveOwnerId } from "@/lib/offline/activeOwner";
import { clearPrivateRouteCache } from "@/lib/offline/privacy";
import { shouldIsolateOwner } from "@/lib/offline/signOutCoordinator";
import { requestSync, startSyncEngine } from "@/lib/offline/sync";

// Keep this in sync with public/sw.js. A new worker version gets one fresh route-warm
// signature without permanently disabling future warming.
const ROUTE_WARM_VERSION = "finance-tracker-shell-v6";
const FIXED_OFFLINE_ROUTES = [
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

export function OfflineDataProvider({ children }: { children: React.ReactNode }) {
  useEffect(() => {
    // Offline changes sync on app open, foreground, reconnect and after local saves.
    startSyncEngine();
    const supabase = createClient();
    let cancelled = false;
    let authenticatedUserId: string | null = null;
    let watchedUserId: string | null = null;
    let accountRouteSubscription: Subscription | null = null;
    const bootstrapJobs = new Map<string, Promise<void>>();
    const routeWarmJobs = new Map<string, Promise<void>>();
    const warmedRouteSignatures = new Set<string>();
    let privateCacheReset: Promise<void> = Promise.resolve();

    const warmRoutesOnce = (userId: string, activeAccountIds: string[]) => {
      if (process.env.NODE_ENV !== "production" || !("serviceWorker" in navigator)) return;

      const sortedAccountIds = [...new Set(activeAccountIds)].sort();
      const signature = [ROUTE_WARM_VERSION, userId, ...sortedAccountIds].join("|");
      if (warmedRouteSignatures.has(signature) || routeWarmJobs.has(signature)) return;

      const routes = [
        ...FIXED_OFFLINE_ROUTES,
        ...sortedAccountIds.map((accountId) => `/accounts/${accountId}`),
      ];
      const job = navigator.serviceWorker.ready
        .then((registration) => {
          if (cancelled || authenticatedUserId !== userId) return;
          const worker = navigator.serviceWorker.controller ?? registration.active;
          if (!worker) return;
          worker.postMessage({ type: "CACHE_ROUTES", routes });
          warmedRouteSignatures.add(signature);
        })
        .catch((error: unknown) => {
          if (navigator.onLine) {
            console.warn(
              "Offline route warming failed:",
              error instanceof Error ? error.message : error
            );
          }
        })
        .finally(() => routeWarmJobs.delete(signature));

      routeWarmJobs.set(signature, job);
    };

    const watchAccountRoutes = (userId: string) => {
      accountRouteSubscription?.unsubscribe();
      watchedUserId = userId;
      accountRouteSubscription = liveQuery(() =>
        offlineDb.accounts.where("ownerId").equals(userId).toArray()
      ).subscribe({
        next: (accounts) => {
          if (cancelled || authenticatedUserId !== userId) return;
          warmRoutesOnce(
            userId,
            accounts.filter((account) => !account.deleted_at).map((account) => account.id)
          );
        },
        error: (error: unknown) => {
          console.warn(
            "Unable to read account routes for offline caching:",
            error instanceof Error ? error.message : error
          );
        },
      });
    };

    const bootstrap = (userId: string) => {
      const previousUserId = authenticatedUserId ?? getActiveOwnerId();
      if (shouldIsolateOwner(previousUserId, userId)) {
        // Never let a newly authenticated user inherit another owner's warmed pages or active
        // IndexedDB selection. The old owner's rows remain partitioned and recoverable.
        setActiveOwnerId(null);
        accountRouteSubscription?.unsubscribe();
        accountRouteSubscription = null;
        watchedUserId = null;
        warmedRouteSignatures.clear();
        privateCacheReset = clearPrivateRouteCache();
      }
      authenticatedUserId = userId;
      const current = bootstrapJobs.get(userId);
      if (current) return current;

      const job = new Promise<void>((resolve) => window.setTimeout(resolve, 0))
        .then(() => privateCacheReset)
        .then(() => {
          if (cancelled || authenticatedUserId !== userId) return;
          return ensureOfflineBootstrap(userId);
        })
        .then(() => {
          if (cancelled || authenticatedUserId !== userId) return;
          if (watchedUserId !== userId) watchAccountRoutes(userId);
        })
        .catch((error: unknown) => {
          if (navigator.onLine) {
            console.warn(
              "Offline data refresh failed:",
              error instanceof Error ? error.message : error
            );
          }
        })
        .finally(() => bootstrapJobs.delete(userId));

      bootstrapJobs.set(userId, job);
      return job;
    };

    // Authoritative initial authentication check. INITIAL_SESSION below is ignored so this
    // startup path cannot schedule the same bootstrap and route-warm work twice.
    void supabase.auth.getUser().then(({ data }) => {
      if (!cancelled && data.user) void bootstrap(data.user.id);
    });

    const { data: authListener } = supabase.auth.onAuthStateChange((event, session) => {
      if ((event === "SIGNED_IN" || event === "USER_UPDATED") && session?.user) {
        requestSync(500);
        void bootstrap(session.user.id);
      }
      if (event === "SIGNED_OUT") {
        // Queued offline changes stay in IndexedDB under their owner; they're just not shown.
        setActiveOwnerId(null);
        authenticatedUserId = null;
        accountRouteSubscription?.unsubscribe();
        accountRouteSubscription = null;
        watchedUserId = null;
        warmedRouteSignatures.clear();
        privateCacheReset = clearPrivateRouteCache();
      }
    });

    if (navigator.storage?.persist) {
      void navigator.storage.persist().catch(() => false);
    }

    return () => {
      cancelled = true;
      accountRouteSubscription?.unsubscribe();
      authListener.subscription.unsubscribe();
    };
  }, []);

  return children;
}

