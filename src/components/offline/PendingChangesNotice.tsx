"use client";

import React from "react";
import { useLiveQuery } from "dexie-react-hooks";
import { CloudOff } from "lucide-react";
import { useActiveOwnerId } from "@/lib/offline/activeOwner";
import { offlineDb } from "@/lib/offline/db";

/**
 * Shows how many changes made on this device are waiting to reach Supabase, for the signed-in
 * user only. Hidden when there are none. Reads the outbox live, so it updates on every save.
 */
export function PendingChangesNotice() {
  const ownerId = useActiveOwnerId();
  const count = useLiveQuery(
    () => (ownerId ? offlineDb.outbox.where("ownerId").equals(ownerId).count() : 0),
    [ownerId],
    0
  );

  if (!ownerId || !count) return null;

  return (
    <div
      role="status"
      aria-live="polite"
      className="pointer-events-none fixed inset-x-0 top-[calc(max(0.75rem,env(safe-area-inset-top))+4rem)] z-30 flex justify-center px-4 sm:top-[calc(max(0.75rem,env(safe-area-inset-top))+4.5rem)]"
    >
      <p className="flex items-center gap-1.5 rounded-full border border-warning/25 bg-canvas/95 px-3 py-1 text-[11px] font-medium text-warning shadow-glass">
        <CloudOff className="h-3.5 w-3.5" aria-hidden="true" />
        {count === 1 ? "1 change saved on this device, not synced yet" : `${count} changes saved on this device, not synced yet`}
      </p>
    </div>
  );
}
