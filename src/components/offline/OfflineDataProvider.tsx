"use client";

import React, { useEffect } from "react";
import { ensureOfflineBootstrap } from "@/lib/offline/bootstrap";
import { createClient } from "@/lib/supabase/client";

export function OfflineDataProvider({ children }: { children: React.ReactNode }) {
  useEffect(() => {
    const supabase = createClient();
    let cancelled = false;

    const bootstrap = (userId: string) => {
      window.setTimeout(() => {
        if (cancelled) return;
        void ensureOfflineBootstrap(userId).catch((error: unknown) => {
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

    const { data: authListener } = supabase.auth.onAuthStateChange((_event, session) => {
      if (session?.user) bootstrap(session.user.id);
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

