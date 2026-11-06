"use client";

import React, { useState, useTransition } from "react";
import { Landmark, DollarSign } from "lucide-react";
import { Modal } from "@/components/ui/Modal";
import { Input } from "@/components/ui/Input";
import { Button } from "@/components/ui/Button";
import { Alert } from "@/components/ui/Alert";
import { Checkbox } from "@/components/ui/Checkbox";
import { AccountGroupSelector } from "@/components/accounts/AccountGroupSelector";
import { DEFAULT_NEW_ACCOUNT_GROUP, type AccountGroup } from "@/lib/accounts";
import { createAccountAction } from "@/app/actions/accounts";
import { markOfflineDataStale } from "@/lib/offline/bootstrap";
import { createAccountLocally, runMutation } from "@/lib/offline/mutations";

export interface AddAccountModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSuccess?: (account: { id: string; name: string }) => void;
}

export function AddAccountModal({
  isOpen,
  onClose,
  onSuccess,
}: AddAccountModalProps) {
  const [name, setName] = useState("");
  const [startingAmount, setStartingAmount] = useState<string>("0");
  const [accountGroup, setAccountGroup] = useState<AccountGroup>(DEFAULT_NEW_ACCOUNT_GROUP);
  const [includeInSummary, setIncludeInSummary] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [nameError, setNameError] = useState<string | null>(null);
  const [successMessage, setSuccessMessage] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  const handleReset = () => {
    setName("");
    setStartingAmount("0");
    setAccountGroup(DEFAULT_NEW_ACCOUNT_GROUP);
    setIncludeInSummary(true);
    setError(null);
    setNameError(null);
    setSuccessMessage(null);
  };

  const handleModalClose = () => {
    handleReset();
    onClose();
  };

  const handleSubmit = (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    setError(null);
    setNameError(null);
    setSuccessMessage(null);

    const trimmed = name.trim();
    if (!trimmed) {
      setNameError("Account Name is required");
      return;
    }

    startTransition(async () => {
      const parsedAmount = parseFloat(startingAmount) || 0;
      const input = {
        name: trimmed,
        startingAmount: parsedAmount,
        accountGroup,
        includeInSummary,
      };
      let created: { id: string; name: string } | undefined;
      const res = await runMutation({
        local: (ownerId) => createAccountLocally(ownerId, input),
        remote: async () => {
          const result = await createAccountAction(input);
          created = result.account;
          return result;
        },
      });

      if (!res.success) {
        setError(res.error || "Failed to create account. Please try again.");
      } else {
        if (!res.queued) markOfflineDataStale();
        setSuccessMessage(
          res.queued
            ? `Account "${trimmed}" saved on this device. It will sync later.`
            : `Account "${trimmed}" created successfully.`
        );
        if (onSuccess && created) {
          onSuccess(created);
        }
        setTimeout(() => {
          handleModalClose();
        }, 1000);
      }
    });
  };

  return (
    <Modal
      isOpen={isOpen}
      onClose={handleModalClose}
      title="Add Account"
      description="Create a new bank, cash, or credit account to track your finances."
      size="md"
    >
      <form onSubmit={handleSubmit} noValidate className="space-y-5">
        {error && (
          <Alert variant="error" onClose={() => setError(null)}>
            {error}
          </Alert>
        )}

        {successMessage && (
          <Alert variant="success" onClose={() => setSuccessMessage(null)}>
            {successMessage}
          </Alert>
        )}

        {/* Account Name (Required) */}
        <Input
          label="Account Name"
          id="account-name"
          name="name"
          placeholder="e.g. HDFC Checking, Chase Freedom, Cash Wallet"
          value={name}
          onChange={(e) => {
            setName(e.target.value);
            if (nameError) setNameError(null);
          }}
          error={nameError || undefined}
          leftIcon={<Landmark className="h-4 w-4" />}
          disabled={isPending}
          required
          autoFocus
        />

        {/* Starting Amount (Optional, default to 0) */}
        <Input
          label="Starting Amount"
          id="account-starting-amount"
          name="startingAmount"
          type="number"
          step="any"
          placeholder="0.00"
          value={startingAmount}
          onChange={(e) => setStartingAmount(e.target.value)}
          helperText="Optional initial balance. Defaults to 0."
          leftIcon={<DollarSign className="h-4 w-4" />}
          disabled={isPending}
        />

        <AccountGroupSelector value={accountGroup} onChange={setAccountGroup} disabled={isPending} />

        <Checkbox
          id="account-include-in-summary"
          checked={includeInSummary}
          onChange={(event) => setIncludeInSummary(event.target.checked)}
          label="Include in Financial Summaries"
          description="Include this account in dashboard totals, consolidated reports and category breakdowns."
          disabled={isPending}
        />

        {/* Action Buttons */}
        <div className="flex items-center justify-end gap-3 pt-3 border-t border-line">
          <Button
            type="button"
            variant="ghost"
            onClick={handleModalClose}
            disabled={isPending}
          >
            Cancel
          </Button>

          <Button
            type="submit"
            variant="primary"
            isLoading={isPending}
            className="w-full sm:w-auto"
          >
            {isPending ? "Creating account…" : "Create Account"}
          </Button>
        </div>
      </form>
    </Modal>
  );
}
