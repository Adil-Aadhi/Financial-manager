"use client";

import React, { useState, useTransition } from "react";
import { DollarSign, Landmark, Trash2 } from "lucide-react";
import {
  trashAccountAction,
  updateAccountAction,
} from "@/app/actions/accounts";
import type { AccountListItem } from "@/components/accounts/AccountList";
import { AccountGroupSelector } from "@/components/accounts/AccountGroupSelector";
import {
  normalizeAccountGroup,
  type AccountGroup,
} from "@/lib/accounts";
import {
  changedIncludeInSummary,
  normalizeIncludeInSummary,
} from "@/lib/accountSummary";
import { markOfflineDataStale } from "@/lib/offline/bootstrap";
import { runMutation, trashAccountLocally, updateAccountLocally } from "@/lib/offline/mutations";
import { Alert } from "@/components/ui/Alert";
import { Button } from "@/components/ui/Button";
import { Checkbox } from "@/components/ui/Checkbox";
import { Input } from "@/components/ui/Input";
import { Modal } from "@/components/ui/Modal";

export function EditAccountModal({
  account,
  isOpen,
  onClose,
  onSaved,
}: {
  account: AccountListItem;
  isOpen: boolean;
  onClose: () => void;
  /** Called after a successful save with the group the account now belongs to. */
  onSaved?: (group: AccountGroup) => void;
}) {
  const [name, setName] = useState(account.name);
  const [accountGroup, setAccountGroup] = useState<AccountGroup>(
    normalizeAccountGroup(account.account_group)
  );
  const [includeInSummary, setIncludeInSummary] = useState(
    normalizeIncludeInSummary(account.include_in_summary)
  );
  const [openingAmount, setOpeningAmount] = useState(
    String(Number(account.opening_balance) || 0)
  );
  const [error, setError] = useState<string | null>(null);
  const [nameError, setNameError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  const handleSubmit = (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setError(null);
    setNameError(null);

    const trimmedName = name.trim();
    if (!trimmedName) {
      setNameError("Account Name is required");
      return;
    }

    const parsedAmount = Number(openingAmount);
    if (!Number.isFinite(parsedAmount)) {
      setError("Enter a valid opening amount.");
      return;
    }

    startTransition(async () => {
      const changedSummaryInclusion = changedIncludeInSummary(
        account.include_in_summary,
        includeInSummary
      );
      const input = {
        accountId: account.id,
        name: trimmedName,
        openingAmount: parsedAmount,
        accountGroup,
        ...(changedSummaryInclusion !== undefined
          ? { includeInSummary: changedSummaryInclusion }
          : {}),
      };
      const result = await runMutation({
        local: (ownerId) => updateAccountLocally(ownerId, input),
        remote: () => updateAccountAction(input),
      });

      if (!result.success) {
        setError(result.error || "Unable to update this account.");
        return;
      }

      if (!result.queued) markOfflineDataStale(["accounts", "dashboard"]);
      onSaved?.(accountGroup);
      onClose();
    });
  };

  return (
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      title="Edit Account"
      description="Update the account name, opening amount, group, or summary inclusion."
      size="md"
    >
      <form onSubmit={handleSubmit} noValidate className="space-y-5">
        {error && (
          <Alert variant="error" onClose={() => setError(null)}>
            {error}
          </Alert>
        )}

        <Input
          label="Account Name"
          id={`edit-account-name-${account.id}`}
          value={name}
          onChange={(event) => {
            setName(event.target.value);
            if (nameError) setNameError(null);
          }}
          error={nameError || undefined}
          leftIcon={<Landmark className="h-4 w-4" />}
          disabled={isPending}
          required
          autoFocus
        />

        <Input
          label="Opening Amount"
          id={`edit-account-opening-${account.id}`}
          type="number"
          step="any"
          value={openingAmount}
          onChange={(event) => setOpeningAmount(event.target.value)}
          leftIcon={<DollarSign className="h-4 w-4" />}
          disabled={isPending}
          required
        />

        <AccountGroupSelector value={accountGroup} onChange={setAccountGroup} disabled={isPending} />

        <Checkbox
          id={`edit-account-summary-${account.id}`}
          checked={includeInSummary}
          onChange={(event) => setIncludeInSummary(event.target.checked)}
          label="Include in Financial Summaries"
          description="Include this account in dashboard totals, consolidated reports and category breakdowns."
          disabled={isPending}
        />

        <div className="flex items-center justify-end gap-3 border-t border-line pt-3">
          <Button
            type="button"
            variant="ghost"
            onClick={onClose}
            disabled={isPending}
          >
            Cancel
          </Button>
          <Button type="submit" variant="primary" isLoading={isPending}>
            {isPending ? "Saving…" : "Save Changes"}
          </Button>
        </div>
      </form>
    </Modal>
  );
}

export function DeleteAccountModal({
  account,
  isOpen,
  onClose,
}: {
  account: AccountListItem;
  isOpen: boolean;
  onClose: () => void;
}) {
  const [confirmation, setConfirmation] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  const handleSubmit = (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setError(null);

    if (confirmation !== "CONFIRM") {
      setError("Type CONFIRM to continue.");
      return;
    }

    startTransition(async () => {
      const result = await runMutation({
        local: (ownerId) => trashAccountLocally(ownerId, account.id, confirmation),
        remote: () => trashAccountAction(account.id, confirmation),
      });

      if (!result.success) {
        setError(result.error || "Unable to move this account to Trash.");
        return;
      }

      if (!result.queued) markOfflineDataStale(["accounts", "dashboard"]);
      onClose();
    });
  };

  return (
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      title="Move Account to Trash?"
      description={`You can restore ${account.name} and its transactions for 10 days.`}
      size="sm"
    >
      <form onSubmit={handleSubmit} noValidate className="space-y-5">
        {error && (
          <Alert variant="error" onClose={() => setError(null)}>
            {error}
          </Alert>
        )}

        <div className="rounded-2xl border border-danger/25 bg-danger/8 p-4">
          <div className="flex items-start gap-3">
            <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-danger/12 text-danger">
              <Trash2 className="h-4 w-4" />
            </span>
            <div>
              <p className="text-sm font-semibold text-fg">{account.name}</p>
              <p className="mt-1 text-xs leading-relaxed text-fg-muted">
                After 10 days, the account and all associated transactions are
                permanently deleted.
              </p>
            </div>
          </div>
        </div>

        <Input
          label="Type CONFIRM to continue"
          id={`delete-account-confirm-${account.id}`}
          value={confirmation}
          onChange={(event) => setConfirmation(event.target.value)}
          placeholder="CONFIRM"
          disabled={isPending}
          autoComplete="off"
          autoFocus
        />

        <div className="flex items-center justify-end gap-3 border-t border-line pt-3">
          <Button
            type="button"
            variant="ghost"
            onClick={onClose}
            disabled={isPending}
          >
            Cancel
          </Button>
          <Button
            type="submit"
            variant="danger"
            isLoading={isPending}
            disabled={confirmation !== "CONFIRM"}
          >
            {isPending ? "Moving…" : "Move to Trash"}
          </Button>
        </div>
      </form>
    </Modal>
  );
}
