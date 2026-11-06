"use client";

import React, { useEffect, useState } from "react";
import { useLiveQuery } from "dexie-react-hooks";
import { AlertTriangle, Clock3, GitCompareArrows } from "lucide-react";
import { Alert } from "@/components/ui/Alert";
import { Button } from "@/components/ui/Button";
import { Modal } from "@/components/ui/Modal";
import { describeChange } from "@/lib/offline/describeChange";
import { offlineDb, type OutboxEntry } from "@/lib/offline/db";
import { discardChange, dismissConflicts, retryAllFailed, retryChange, syncNow, useSyncState } from "@/lib/offline/sync";

/**
 * Lists this user's changes that couldn't sync (with the server's reason), what is still
 * waiting, and any last-write-wins decisions. Retry puts a change back in the queue; Discard
 * removes it only after the user confirms.
 */
export function SyncReviewSheet({ ownerId, isOpen, onClose }: { ownerId: string; isOpen: boolean; onClose: () => void }) {
  const sync = useSyncState();
  const entries = useLiveQuery(() => offlineDb.outbox.where("ownerId").equals(ownerId).sortBy("seq"), [ownerId], []);
  const conflicts = useLiveQuery(() => offlineDb.syncConflicts.where("ownerId").equals(ownerId).toArray(), [ownerId], []);
  const [labels, setLabels] = useState<Record<number, string>>({});
  const [confirming, setConfirming] = useState<OutboxEntry | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let cancelled = false;
    void Promise.all(entries.map(async (entry) => [entry.seq!, await describeChange(entry)] as const)).then((pairs) => {
      if (!cancelled) setLabels(Object.fromEntries(pairs));
    });
    return () => {
      cancelled = true;
    };
  }, [entries]);

  const failed = entries.filter((entry) => entry.status === "failed");
  const waiting = entries.filter((entry) => entry.status !== "failed");

  if (confirming) {
    return (
      <Modal isOpen={isOpen} onClose={() => setConfirming(null)} title="Discard this change?" size="sm">
        <div className="space-y-4">
          <p className="text-sm text-fg-muted">
            <span className="font-semibold text-fg">{labels[confirming.seq!] ?? "This change"}</span> will be removed from
            this device and never sent. Your data here goes back to what the server has. Later changes that depend on it
            may then fail too.
          </p>
          <div className="flex justify-end gap-2">
            <Button variant="ghost" onClick={() => setConfirming(null)} disabled={busy}>
              Keep it
            </Button>
            <Button
              variant="danger"
              isLoading={busy}
              onClick={async () => {
                setBusy(true);
                await discardChange(confirming.seq!);
                setBusy(false);
                setConfirming(null);
              }}
            >
              Discard change
            </Button>
          </div>
        </div>
      </Modal>
    );
  }

  return (
    <Modal isOpen={isOpen} onClose={onClose} title="Changes on this device" description="Waiting to sync with your account." size="md">
      <div className="space-y-4">
        {sync.phase === "paused-auth" && <Alert variant="warning">{sync.message ?? "Sign in again to sync your changes."}</Alert>}

        {failed.length > 0 && (
          <section className="space-y-2">
            <h3 className="flex items-center gap-1.5 text-xs font-semibold text-danger">
              <AlertTriangle className="h-3.5 w-3.5" /> Couldn&apos;t sync ({failed.length})
            </h3>
            <p className="text-xs text-fg-subtle">
              Related changes wait behind these; independent records can continue syncing safely.
            </p>
            <ul className="space-y-2">
              {failed.map((entry) => (
                <li key={entry.seq} className="rounded-2xl border border-danger/25 bg-danger/8 p-3">
                  <p className="text-sm font-semibold text-fg">{labels[entry.seq!] ?? "A change"}</p>
                  <p className="mt-0.5 text-xs text-fg-muted">{entry.error}</p>
                  <div className="mt-2 flex gap-2">
                    <Button size="sm" variant="outline" onClick={() => void retryChange(entry.seq!)}>
                      Retry
                    </Button>
                    <Button size="sm" variant="ghost" className="text-danger" onClick={() => setConfirming(entry)}>
                      Discard…
                    </Button>
                  </div>
                </li>
              ))}
            </ul>
          </section>
        )}

        {waiting.length > 0 && (
          <section className="space-y-2">
            <h3 className="flex items-center gap-1.5 text-xs font-semibold text-fg-muted">
              <Clock3 className="h-3.5 w-3.5" /> Waiting to sync ({waiting.length})
            </h3>
            <ul className="divide-y divide-line rounded-2xl border border-line">
              {waiting.slice(0, 20).map((entry) => (
                <li key={entry.seq} className="flex items-center justify-between gap-3 px-3 py-2 text-sm">
                  <span className="min-w-0 truncate text-fg">{labels[entry.seq!] ?? "A change"}</span>
                  <span className="shrink-0 text-[11px] text-fg-subtle">{entry.status === "syncing" ? "Sending…" : entry.error ? "Will retry" : "Queued"}</span>
                </li>
              ))}
            </ul>
            {waiting.length > 20 && <p className="text-xs text-fg-subtle">and {waiting.length - 20} more</p>}
          </section>
        )}

        {conflicts.length > 0 && (
          <section className="space-y-2">
            <h3 className="flex items-center gap-1.5 text-xs font-semibold text-fg-muted">
              <GitCompareArrows className="h-3.5 w-3.5" /> Edited on another device too ({conflicts.length})
            </h3>
            <ul className="space-y-1.5">
              {conflicts.map((conflict) => (
                <li key={conflict.id} className="rounded-xl border border-line px-3 py-2 text-xs text-fg-muted">
                  <span className="font-semibold text-fg">{conflict.summary}</span>:{" "}
                  {conflict.outcome === "kept-local"
                    ? "your change here was newer, so it was kept."
                    : "a newer change made elsewhere was kept instead of this one."}
                </li>
              ))}
            </ul>
            <Button size="sm" variant="ghost" onClick={() => void dismissConflicts(ownerId)}>
              Dismiss
            </Button>
          </section>
        )}

        {entries.length === 0 && conflicts.length === 0 && <p className="text-sm text-fg-muted">Everything is synced.</p>}

        <div className="flex justify-end gap-2 border-t border-line pt-3">
          {failed.length > 1 && (
            <Button variant="outline" onClick={() => void retryAllFailed(ownerId)}>
              Retry all
            </Button>
          )}
          <Button onClick={() => void syncNow()} disabled={sync.phase === "syncing" || entries.length === 0}>
            {sync.phase === "syncing" ? "Syncing…" : "Sync now"}
          </Button>
        </div>
      </div>
    </Modal>
  );
}
