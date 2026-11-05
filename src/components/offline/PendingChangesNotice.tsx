"use client";

import React, { useEffect, useState } from "react";
import { useLiveQuery } from "dexie-react-hooks";
import { AlertTriangle, CheckCircle2, CloudOff, RefreshCw } from "lucide-react";
import { SyncReviewSheet } from "@/components/offline/SyncReviewSheet";
import { cn } from "@/lib/cn";
import { useActiveOwnerId } from "@/lib/offline/activeOwner";
import { offlineDb } from "@/lib/offline/db";
import { syncNow, useSyncState } from "@/lib/offline/sync";

const SYNCED_VISIBLE_MS = 4_000;

/**
 * Sync status for the signed-in user's offline changes: how many are waiting, whether they are
 * syncing, how many failed, and a confirmation when everything has synced. Tapping it opens
 * the review sheet. Hidden when there is nothing to report.
 */
export function PendingChangesNotice() {
  const ownerId = useActiveOwnerId();
  const sync = useSyncState();
  const [open, setOpen] = useState(false);
  const [showSynced, setShowSynced] = useState(false);
  const counts = useLiveQuery(
    async () => {
      if (!ownerId) return { total: 0, failed: 0, conflicts: 0 };
      const [total, failed, conflicts] = await Promise.all([
        offlineDb.outbox.where("ownerId").equals(ownerId).count(),
        offlineDb.outbox.where("[ownerId+status]").equals([ownerId, "failed"]).count(),
        offlineDb.syncConflicts.where("ownerId").equals(ownerId).count(),
      ]);
      return { total, failed, conflicts };
    },
    [ownerId],
    { total: 0, failed: 0, conflicts: 0 }
  );

  // Show "All changes synced" briefly after each successful sync (timers only: no clock reads
  // during render, which also keeps the prerendered pages deterministic).
  useEffect(() => {
    if (sync.phase !== "synced" || !sync.lastSyncedAt) return;
    const show = window.setTimeout(() => setShowSynced(true), 0);
    const hide = window.setTimeout(() => setShowSynced(false), SYNCED_VISIBLE_MS);
    return () => {
      window.clearTimeout(show);
      window.clearTimeout(hide);
    };
  }, [sync.phase, sync.lastSyncedAt]);

  if (!ownerId) return null;
  const justSynced = counts.total === 0 && sync.phase === "synced" && showSynced;
  const showPill = counts.total > 0 || counts.conflicts > 0 || justSynced;

  let tone: "warning" | "danger" | "positive" = "warning";
  let icon = <CloudOff className="h-3.5 w-3.5" aria-hidden="true" />;
  let text: string;
  if (counts.failed > 0) {
    tone = "danger";
    icon = <AlertTriangle className="h-3.5 w-3.5" aria-hidden="true" />;
    text = `${counts.failed} change${counts.failed === 1 ? "" : "s"} couldn't sync · Review`;
  } else if (counts.total > 0 && sync.phase === "syncing") {
    icon = <RefreshCw className="h-3.5 w-3.5 animate-spin" aria-hidden="true" />;
    text = `Syncing ${counts.total} change${counts.total === 1 ? "" : "s"}…`;
  } else if (counts.total > 0) {
    text =
      sync.phase === "paused-auth"
        ? "Sign in again to sync your changes"
        : `${counts.total} change${counts.total === 1 ? "" : "s"} saved on this device, not synced yet`;
  } else if (justSynced) {
    tone = "positive";
    icon = <CheckCircle2 className="h-3.5 w-3.5" aria-hidden="true" />;
    text = "All changes synced";
  } else {
    text = `${counts.conflicts} change${counts.conflicts === 1 ? "" : "s"} also edited elsewhere · Review`;
  }

  return (
    <>
      {showPill && (
        <div
          role="status"
          aria-live="polite"
          className="pointer-events-none fixed inset-x-0 top-[calc(max(0.75rem,env(safe-area-inset-top))+4rem)] z-30 flex justify-center px-4 sm:top-[calc(max(0.75rem,env(safe-area-inset-top))+4.5rem)]"
        >
          <div
            className={cn(
              "pointer-events-auto flex items-center gap-1 rounded-full border bg-canvas/95 py-0.5 pl-3 pr-1 text-[11px] font-medium shadow-glass",
              tone === "danger" && "border-danger/30 text-danger",
              tone === "warning" && "border-warning/25 text-warning",
              tone === "positive" && "border-positive/25 text-positive"
            )}
          >
            <button type="button" onClick={() => setOpen(true)} className="flex items-center gap-1.5 py-0.5">
              {icon}
              {text}
            </button>
            {counts.total > 0 && sync.phase !== "syncing" && (
              <button
                type="button"
                onClick={() => void syncNow()}
                className="ml-1 rounded-full border border-current/20 px-2 py-0.5 font-semibold"
              >
                Sync now
              </button>
            )}
          </div>
        </div>
      )}
      {open && <SyncReviewSheet ownerId={ownerId} isOpen onClose={() => setOpen(false)} />}
    </>
  );
}
