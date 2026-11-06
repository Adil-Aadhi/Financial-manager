"use client";

import React, { useState } from "react";
import type { AccountGroup } from "@/lib/accounts";
import type { SupportedCurrency } from "@/lib/supabase/profile";
import {
  DeleteAccountModal,
  EditAccountModal,
} from "@/components/accounts/AccountModals";
import { SortableAccountCardList } from "@/components/accounts/SortableAccountCardList";

export interface AccountListItem {
  id: string;
  name: string;
  opening_balance: number | string | null;
  currency: string | null;
  account_group?: AccountGroup | string | null;
  include_in_summary?: boolean | null;
  total_income?: number | string | null;
  total_expense?: number | string | null;
}

/** Account summary cards with drag-and-drop reordering, edit, Trash, and detail actions. */
export function AccountList({
  accounts,
  ownerId,
  fallbackCurrency,
  actionsEnabled = true,
  onAccountSaved,
  onCustomOrderChange,
}: {
  accounts: AccountListItem[];
  ownerId?: string;
  fallbackCurrency: SupportedCurrency;
  actionsEnabled?: boolean;
  /** Called after an account edit is saved, with the account's (possibly new) group. */
  onAccountSaved?: (group: AccountGroup) => void;
  onCustomOrderChange?: (hasCustom: boolean) => void;
}) {
  const [editingAccount, setEditingAccount] =
    useState<AccountListItem | null>(null);
  const [deletingAccount, setDeletingAccount] =
    useState<AccountListItem | null>(null);

  return (
    <>
      <SortableAccountCardList
        accounts={accounts}
        ownerId={ownerId}
        fallbackCurrency={fallbackCurrency}
        actionsEnabled={actionsEnabled}
        onEdit={setEditingAccount}
        onDelete={setDeletingAccount}
        onCustomOrderChange={onCustomOrderChange}
      />

      {editingAccount && (
        <EditAccountModal
          key={editingAccount.id}
          account={editingAccount}
          isOpen
          onClose={() => setEditingAccount(null)}
          onSaved={onAccountSaved}
        />
      )}

      {deletingAccount && (
        <DeleteAccountModal
          key={deletingAccount.id}
          account={deletingAccount}
          isOpen
          onClose={() => setDeletingAccount(null)}
        />
      )}
    </>
  );
}
