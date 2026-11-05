"use client";

import { useEffect } from "react";
import { ensureOfflineBootstrap, OFFLINE_DATA_STALE_EVENT } from "@/lib/offline/bootstrap";
import { useOnlineStatus } from "@/lib/offline/useOnlineStatus";

function refresh(ownerId: string, force: boolean, label: string) {
  void ensureOfflineBootstrap(ownerId, force).catch((error: unknown) => {
    if (navigator.onLine) {
      console.warn(`Unable to refresh ${label}:`, error instanceof Error ? error.message : error);
    }
  });
}

/**
 * Keeps this owner's IndexedDB snapshot current in the background without re-downloading it
 * on every navigation:
 * - mount, reconnect, or new server props: refresh only when the snapshot is older than the
 *   freshness window, or a server mutation has happened since the last refresh;
 * - a successful server mutation (markOfflineDataStale): refresh immediately.
 * The page keeps rendering from IndexedDB throughout; useLiveQuery picks up the new rows.
 */
export function useOfflineRefresh(ownerId: string, serverVersion: string, label: string) {
  const isOnline = useOnlineStatus();

  useEffect(() => {
    if (!isOnline) return;
    refresh(ownerId, false, label);
  }, [isOnline, label, ownerId, serverVersion]);

  useEffect(() => {
    const onStale = () => refresh(ownerId, true, label);
    window.addEventListener(OFFLINE_DATA_STALE_EVENT, onStale);
    return () => window.removeEventListener(OFFLINE_DATA_STALE_EVENT, onStale);
  }, [label, ownerId]);
}
