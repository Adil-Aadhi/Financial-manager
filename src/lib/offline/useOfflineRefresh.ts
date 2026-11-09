"use client";

import { useEffect } from "react";
import { setActiveOwnerId } from "@/lib/offline/activeOwner";
import { ensureOfflineBootstrap, OFFLINE_DATA_STALE_EVENT } from "@/lib/offline/bootstrap";
import { useOnlineStatus } from "@/lib/offline/useOnlineStatus";

const staleRefreshers = new Set<() => void>();

function notifyStaleRefreshers() {
  staleRefreshers.forEach((refreshStale) => refreshStale());
}

function subscribeToStaleData(refreshStale: () => void) {
  staleRefreshers.add(refreshStale);
  if (staleRefreshers.size === 1) {
    window.addEventListener(OFFLINE_DATA_STALE_EVENT, notifyStaleRefreshers);
  }
  return () => {
    staleRefreshers.delete(refreshStale);
    if (staleRefreshers.size === 0) {
      window.removeEventListener(OFFLINE_DATA_STALE_EVENT, notifyStaleRefreshers);
    }
  };
}

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

  // Local-first mutations use this to know whose data the page shows (see activeOwner.ts).
  useEffect(() => {
    setActiveOwnerId(ownerId);
  }, [ownerId]);

  useEffect(() => {
    if (!isOnline) return;
    refresh(ownerId, false, label);
  }, [isOnline, label, ownerId, serverVersion]);

  useEffect(() => {
    const onStale = () => refresh(ownerId, true, label);
    return subscribeToStaleData(onStale);
  }, [label, ownerId]);
}
