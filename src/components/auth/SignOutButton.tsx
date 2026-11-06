"use client";

import React, { useState, useTransition } from "react";
import { useLiveQuery } from "dexie-react-hooks";
import { AlertTriangle, Loader2, LogOut } from "lucide-react";
import { cn } from "@/lib/cn";
import { Alert } from "@/components/ui/Alert";
import { Button } from "@/components/ui/Button";
import { Modal } from "@/components/ui/Modal";
import { getActiveOwnerId, setActiveOwnerId, useActiveOwnerId } from "@/lib/offline/activeOwner";
import { offlineDb } from "@/lib/offline/db";
import { clearPrivateRouteCache, removeLocalOwnerData } from "@/lib/offline/privacy";
import { coordinateSignOut } from "@/lib/offline/signOutCoordinator";
import { createClient } from "@/lib/supabase/client";

interface SignOutButtonProps {
  className?: string;
  /** "icon" = square icon button, "row" = full-width list row. */
  variant?: "icon" | "row";
}

export function SignOutButton({ className, variant = "row" }: SignOutButtonProps) {
  const [isPending, startTransition] = useTransition();
  const [open, setOpen] = useState(false);
  const ownerId = useActiveOwnerId();
  const pendingCount = useLiveQuery(
    () => (ownerId ? offlineDb.outbox.where("ownerId").equals(ownerId).count() : 0),
    [ownerId],
    0
  );

  const signOut = (removeFromDevice: boolean) => {
    startTransition(async () => {
      const signingOutOwnerId = getActiveOwnerId();

      await coordinateSignOut({
        // Privacy cleanup happens before the server action/redirect, so an expired server cookie
        // or a terminated request cannot leave private pages selected on this device.
        clearActiveOwner: () => setActiveOwnerId(null),
        clearPrivateCache: clearPrivateRouteCache,
        signOutBrowser: () => createClient().auth.signOut({ scope: "local" }),
        removeLocalData:
          removeFromDevice && signingOutOwnerId
            ? () => removeLocalOwnerData(signingOutOwnerId)
            : undefined,
        navigateToLogin: () => window.location.replace("/login"),
      });
    });
  };
  const onClick = () => setOpen(true);
  const Icon = isPending ? Loader2 : LogOut;

  const button =
    variant === "icon" ? (
      <button
        type="button"
        onClick={onClick}
        disabled={isPending}
        aria-label="Sign out"
        title="Sign out"
        className={cn(
          "flex h-9 w-9 shrink-0 cursor-pointer items-center justify-center rounded-xl text-fg-subtle transition-colors hover:bg-danger/10 hover:text-danger disabled:opacity-50",
          className
        )}
      >
        <Icon className={cn("h-4 w-4", isPending && "animate-spin")} />
      </button>
    ) : (
      <button
        type="button"
        onClick={onClick}
        disabled={isPending}
        className={cn(
          "flex h-11 w-full cursor-pointer items-center gap-3 rounded-xl px-3 text-sm font-medium text-danger transition-colors hover:bg-danger/10 disabled:opacity-50",
          className
        )}
      >
        <Icon className={cn("h-[18px] w-[18px]", isPending && "animate-spin")} />
        {isPending ? "Signing out…" : "Sign out"}
      </button>
    );

  return (
    <>
      {button}
      <Modal
        isOpen={open}
        onClose={() => !isPending && setOpen(false)}
        title="Sign out?"
        description="Choose what this device should keep."
        size="sm"
      >
        <div className="space-y-4">
          {pendingCount > 0 && (
            <Alert variant="warning">
              <span className="inline-flex items-start gap-2">
                <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
                <span>
                  {pendingCount} unsynced change{pendingCount === 1 ? " is" : "s are"} saved on
                  this device. Removing local data will permanently discard {pendingCount === 1 ? "it" : "them"}.
                </span>
              </span>
            </Alert>
          )}
          <p className="text-sm text-fg-muted">
            Keeping local data is safest and lets this same account continue syncing after the
            next sign-in. Other users cannot see it.
          </p>
          <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
            <Button variant="ghost" onClick={() => setOpen(false)} disabled={isPending}>
              Cancel
            </Button>
            <Button variant="danger" onClick={() => signOut(true)} disabled={isPending}>
              Remove data & sign out
            </Button>
            <Button onClick={() => signOut(false)} disabled={isPending}>
              Keep data & sign out
            </Button>
          </div>
        </div>
      </Modal>
    </>
  );
}
