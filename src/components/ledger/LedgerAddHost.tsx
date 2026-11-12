"use client";

import { useEffect } from "react";
import { CalendarSync, HandCoins, ReceiptText, UserPlus, Wallet } from "lucide-react";
import { Modal } from "@/components/ui/Modal";
import { LEDGER_ADD_EVENT } from "@/lib/ledger";
import { ExpenseDetailsModal } from "./ExpenseDetails";
import { ExpenseFormModal } from "./ExpenseForm";
import { GroupDetailsModal } from "./GroupDetails";
import { GroupFormModal, MemberFormModal } from "./GroupForm";
import { useLedger, type LedgerModalState } from "./LedgerProvider";
import { ManualDueFormModal } from "./ManualDueForm";
import { MemberPaymentModal } from "./MemberPaymentModal";
import { ObligationDetailsModal } from "./ObligationParts";
import { PaymentModal } from "./PaymentModal";
import { PersonDetailsModal } from "./PersonDetails";
import { PersonFormModal } from "./PersonForm";

const CHOICES: Array<{ label: string; description: string; icon: React.ReactNode; modal: LedgerModalState }> = [
  { label: "Manual due", description: "Someone owes you money", icon: <HandCoins className="h-5 w-5" />, modal: { kind: "due" } },
  { label: "Shared expense", description: "You paid, others owe a share", icon: <ReceiptText className="h-5 w-5" />, modal: { kind: "expense" } },
  { label: "Recurring group", description: "People who pay you regularly", icon: <CalendarSync className="h-5 w-5" />, modal: { kind: "group" } },
  { label: "Payment", description: "Someone paid you back", icon: <Wallet className="h-5 w-5" />, modal: { kind: "payment" } },
  { label: "Person", description: "Add someone to reuse later", icon: <UserPlus className="h-5 w-5" />, modal: { kind: "person" } },
];

/**
 * Renders the ledger's modals and listens for the global add button (FABContext dispatches
 * LEDGER_ADD_EVENT on /ledger pages). Modals stack: closing one returns to the previous.
 */
export function LedgerAddHost() {
  const { modals, open } = useLedger();

  useEffect(() => {
    const onAdd = () => open({ kind: "chooser" });
    window.addEventListener(LEDGER_ADD_EVENT, onAdd);
    return () => window.removeEventListener(LEDGER_ADD_EVENT, onAdd);
  }, [open]);

  return (
    <>
      {modals.map((modal, index) => {
        const key = `${index}:${modal.kind}`;
        switch (modal.kind) {
          case "chooser":
            return <ChooserModal key={key} />;
          case "person":
            return <PersonFormModal key={key} personId={modal.personId} />;
          case "personDetails":
            return <PersonDetailsModal key={key} personId={modal.personId} />;
          case "due":
            return <ManualDueFormModal key={key} obligationId={modal.obligationId} />;
          case "expense":
            return <ExpenseFormModal key={key} expenseId={modal.expenseId} />;
          case "expenseDetails":
            return <ExpenseDetailsModal key={key} expenseId={modal.expenseId} />;
          case "group":
            return <GroupFormModal key={key} groupId={modal.groupId} />;
          case "groupDetails":
            return <GroupDetailsModal key={key} groupId={modal.groupId} />;
          case "member":
            return <MemberFormModal key={key} groupId={modal.groupId} />;
          case "memberPayment":
            return <MemberPaymentModal key={key} memberId={modal.memberId} />;
          case "payment":
            return <PaymentModal key={key} obligationId={modal.obligationId} paymentId={modal.paymentId} />;
          case "obligation":
            return <ObligationDetailsModal key={key} obligationId={modal.obligationId} />;
        }
      })}
    </>
  );
}

function ChooserModal() {
  const { data, close, open } = useLedger();
  const choose = (modal: LedgerModalState) => {
    // Replace the chooser with the chosen form (both updates apply in order).
    close();
    open(modal);
  };
  return (
    <Modal isOpen onClose={close} title="Add to ledger" description={data.available ? undefined : "Apply the Personal Ledger migration first."} size="sm">
      <ul className="space-y-2">
        {CHOICES.map((choice) => (
          <li key={choice.label}>
            <button
              type="button"
              disabled={!data.available}
              onClick={() => choose(choice.modal)}
              className="flex w-full items-center gap-3 rounded-xl border border-line bg-glass-hover/50 px-3 py-3 text-left transition-colors hover:bg-glass-hover disabled:cursor-not-allowed disabled:opacity-55"
            >
              <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-accent-soft text-accent">{choice.icon}</span>
              <span className="min-w-0">
                <span className="block text-sm font-semibold text-fg">{choice.label}</span>
                <span className="block text-xs text-fg-subtle">{choice.description}</span>
              </span>
            </button>
          </li>
        ))}
      </ul>
    </Modal>
  );
}
