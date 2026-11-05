"use client";

import React, { useState, useTransition } from "react";
import { Calendar, Clock3, RotateCcw, Trash2 } from "lucide-react";
import { restoreAccountAction } from "@/app/actions/accounts";
import { Alert } from "@/components/ui/Alert";
import { Button } from "@/components/ui/Button";
import { EmptyState } from "@/components/ui/EmptyState";
import { formatMoney } from "@/lib/format";
import { cn } from "@/lib/cn";
import type { SupportedCurrency } from "@/lib/supabase/profile";

export interface TrashedAccountListItem {
  id: string;
  name: string;
  opening_balance: number | string | null;
  currency: string | null;
  deleted_at: string;
}

export function AccountTrashList({
  accounts,
  fallbackCurrency,
}: {
  accounts: TrashedAccountListItem[];
  fallbackCurrency: SupportedCurrency;
}) {
  const [error, setError] = useState<string | null>(null);
  const [restoringId, setRestoringId] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();
  const [now] = useState(() => Date.now());

  const restoreAccount = (accountId: string) => {
    setError(null);
    setRestoringId(accountId);

    startTransition(async () => {
      const result = await restoreAccountAction(accountId);

      if (!result.success) {
        setError(result.error || "Unable to restore this account.");
        setRestoringId(null);
        return;
      }

      setRestoringId(null);
    });
  };

  if (accounts.length === 0) {
    return (
      <EmptyState
        icon={<Trash2 className="h-5 w-5" />}
        title="Trash is empty"
        description="No soft-deleted accounts. Accounts you move to Trash will be preserved here for 10 days before permanent deletion."
        className="py-12"
      />
    );
  }

  return (
    <div className="space-y-3 p-1">
      {error && (
        <Alert variant="error" onClose={() => setError(null)}>
          {error}
        </Alert>
      )}

      {accounts.map((account) => {
        const currency =
          (account.currency as SupportedCurrency) || fallbackCurrency;
        const deletedAt = new Date(account.deleted_at);
        const restoreBy = new Date(
          deletedAt.getTime() + 10 * 24 * 60 * 60 * 1000
        );
        const msRemaining = restoreBy.getTime() - now;
        const daysRemaining = Math.max(
          0,
          Math.ceil(msRemaining / (24 * 60 * 60 * 1000))
        );
        const isExpired = msRemaining <= 0;

        const formattedDeletedDate = deletedAt.toLocaleDateString("en-IN", {
          day: "numeric",
          month: "short",
          year: "numeric",
          timeZone: "Asia/Kolkata",
        });

        const formattedRestoreBy = restoreBy.toLocaleDateString("en-IN", {
          day: "numeric",
          month: "short",
          year: "numeric",
          timeZone: "Asia/Kolkata",
        });

        const retentionBadgeText = isExpired
          ? "Retention expired"
          : `${daysRemaining} day${daysRemaining === 1 ? "" : "s"} remaining`;

        return (
          <div
            key={account.id}
            className="flex flex-col gap-4 rounded-2xl border border-line bg-glass-hover p-4 sm:flex-row sm:items-center sm:justify-between"
          >
            <div className="flex min-w-0 items-start gap-3.5">
              <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-danger/10 text-danger">
                <Trash2 className="h-5 w-5" />
              </span>
              <div className="min-w-0">
                <div className="flex flex-wrap items-center gap-2">
                  <p className="truncate text-base font-semibold text-fg">
                    {account.name}
                  </p>
                  <span
                    className={cn(
                      "rounded-md border px-2 py-0.5 text-[11px] font-medium tracking-tight",
                      isExpired
                        ? "border-danger/25 bg-danger/10 text-danger"
                        : "border-warning/25 bg-warning/10 text-warning"
                    )}
                  >
                    {retentionBadgeText}
                  </span>
                </div>

                <p className="mt-1 font-mono text-sm text-fg-muted">
                  <span className="font-sans text-xs text-fg-subtle">
                    Opening amount:{" "}
                  </span>
                  {formatMoney(Number(account.opening_balance) || 0, currency)}
                </p>

                <div className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-fg-subtle">
                  <span className="flex items-center gap-1.5">
                    <Calendar className="h-3.5 w-3.5" />
                    Deleted on {formattedDeletedDate}
                  </span>
                  <span className="flex items-center gap-1.5">
                    <Clock3 className="h-3.5 w-3.5" />
                    Permanently deleted after {formattedRestoreBy}
                  </span>
                </div>
              </div>
            </div>

            <Button
              variant="outline"
              size="sm"
              leftIcon={<RotateCcw className="h-3.5 w-3.5" />}
              isLoading={isPending && restoringId === account.id}
              disabled={isPending || isExpired}
              onClick={() => restoreAccount(account.id)}
              className="w-full shrink-0 sm:w-auto"
            >
              Restore
            </Button>
          </div>
        );
      })}
    </div>
  );
}
