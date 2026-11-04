"use client";

import React, { useState } from "react";
import { Landmark, ArrowRight, ArrowDownLeft, ArrowUpRight, DollarSign } from "lucide-react";
import { Modal } from "@/components/ui/Modal";
import { Input } from "@/components/ui/Input";
import { Button } from "@/components/ui/Button";
import { Alert } from "@/components/ui/Alert";
import { cn } from "@/lib/cn";

export interface QuickTransactionModalProps {
  isOpen: boolean;
  onClose: () => void;
  selectedAccount?: {
    id?: string;
    name: string;
  } | null;
}

export function QuickTransactionModal({
  isOpen,
  onClose,
  selectedAccount,
}: QuickTransactionModalProps) {
  const [type, setType] = useState<"expense" | "income">("expense");
  const [amount, setAmount] = useState("");
  const [note, setNote] = useState("");
  const [submitted, setSubmitted] = useState(false);

  const accountName = selectedAccount?.name || "Selected Account";

  const handleClose = () => {
    setAmount("");
    setNote("");
    setSubmitted(false);
    onClose();
  };

  const handleSubmit = (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    if (!amount) return;

    // Fast simulation / confirmation as full form is postponed
    setSubmitted(true);
    setTimeout(() => {
      handleClose();
    }, 1100);
  };

  return (
    <Modal
      isOpen={isOpen}
      onClose={handleClose}
      title="Quick Transaction"
      description="Record an entry directly against the current account."
      size="md"
    >
      <form onSubmit={handleSubmit} noValidate className="space-y-5">
        {submitted && (
          <Alert variant="success" onClose={() => setSubmitted(false)}>
            Transaction recorded for {accountName}.
          </Alert>
        )}

        {/* Current Account Indicator (Automatically Selected) */}
        <div className="flex items-center justify-between rounded-2xl border border-line bg-glass-hover p-3.5">
          <div className="flex items-center gap-3">
            <span className="flex h-9 w-9 items-center justify-center rounded-xl bg-accent-soft text-accent">
              <Landmark className="h-5 w-5" />
            </span>
            <div>
              <p className="text-[11px] font-medium text-fg-subtle">
                Selected Account
              </p>
              <p className="text-sm font-semibold text-fg">{accountName}</p>
            </div>
          </div>
          <span className="rounded-full border border-line bg-glass px-2.5 py-0.5 text-[10px] font-semibold text-accent">
            Auto-selected
          </span>
        </div>

        {/* Income / Expense Toggle */}
        <div className="grid grid-cols-2 gap-2 rounded-xl border border-line bg-glass-input p-1">
          <button
            type="button"
            onClick={() => setType("expense")}
            className={cn(
              "flex items-center justify-center gap-2 rounded-lg py-2 text-xs font-semibold transition-all cursor-pointer",
              type === "expense"
                ? "bg-danger/15 text-danger shadow-xs"
                : "text-fg-muted hover:text-fg"
            )}
          >
            <ArrowUpRight className="h-3.5 w-3.5" />
            <span>Expense</span>
          </button>
          <button
            type="button"
            onClick={() => setType("income")}
            className={cn(
              "flex items-center justify-center gap-2 rounded-lg py-2 text-xs font-semibold transition-all cursor-pointer",
              type === "income"
                ? "bg-positive/15 text-positive shadow-xs"
                : "text-fg-muted hover:text-fg"
            )}
          >
            <ArrowDownLeft className="h-3.5 w-3.5" />
            <span>Income</span>
          </button>
        </div>

        {/* Amount */}
        <Input
          label="Amount"
          id="quick-tx-amount"
          type="number"
          step="any"
          placeholder="0.00"
          value={amount}
          onChange={(e) => setAmount(e.target.value)}
          leftIcon={<DollarSign className="h-4 w-4" />}
          required
          autoFocus
        />

        {/* Note / Description */}
        <Input
          label="Note (optional)"
          id="quick-tx-note"
          placeholder="e.g. Groceries, Coffee, Salary"
          value={note}
          onChange={(e) => setNote(e.target.value)}
        />

        {/* Action Buttons */}
        <div className="flex items-center justify-end gap-3 pt-3 border-t border-line">
          <Button type="button" variant="ghost" onClick={handleClose}>
            Cancel
          </Button>

          <Button
            type="submit"
            variant="primary"
            disabled={!amount || submitted}
            rightIcon={<ArrowRight className="h-4 w-4" />}
          >
            {submitted ? "Saved!" : "Record Entry"}
          </Button>
        </div>
      </form>
    </Modal>
  );
}
