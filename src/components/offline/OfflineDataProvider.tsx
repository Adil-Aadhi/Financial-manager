"use client";

import React, { useEffect } from "react";
import { ensureOfflineBootstrap } from "@/lib/offline/bootstrap";
import { createClient } from "@/lib/supabase/client";
import { offlineDb } from "@/lib/offline/db";

async function cacheAuthenticatedRoutes(userId: string) {
  if (process.env.NODE_ENV !== "production" || !("serviceWorker" in navigator)) return;
  const registration = await navigator.serviceWorker.ready;
  const worker = navigator.serviceWorker.controller ?? registration.active;
  if (!worker) return;

  const accounts = await offlineDb.accounts.where("ownerId").equals(userId).toArray();
  worker.postMessage({
    type: "CACHE_ROUTES",
    routes: [
      "/home",
      "/transactions",
      "/categories",
      "/trash",
      "/reports",
      "/settings",
      ...accounts.filter((account) => !account.deleted_at).map((account) => `/accounts/${account.id}`),
    ],
  });
}

export function OfflineDataProvider({ children }: { children: React.ReactNode }) {
  useEffect(() => {
    const supabase = createClient();
    let cancelled = false;

    const bootstrap = (userId: string) => {
      window.setTimeout(() => {
        if (cancelled) return;
        void ensureOfflineBootstrap(userId)
          .then(() => cacheAuthenticatedRoutes(userId))
          .catch((error: unknown) => {
            if (navigator.onLine) {
              console.warn(
                "Offline data refresh failed:",
                error instanceof Error ? error.message : error
              );
            }
          });
      }, 0);
    };

    void supabase.auth.getUser().then(({ data }) => {
      if (data.user) bootstrap(data.user.id);
    });

    const { data: authListener } = supabase.auth.onAuthStateChange((event, session) => {
      if (session?.user) bootstrap(session.user.id);
      if (event === "SIGNED_OUT") {
        navigator.serviceWorker?.controller?.postMessage({ type: "CLEAR_PRIVATE_ROUTES" });
      }
    });

    if (navigator.storage?.persist) {
      void navigator.storage.persist().catch(() => false);
    }

    return () => {
      cancelled = true;
      authListener.subscription.unsubscribe();
    };
  }, []);

  return children;
}

